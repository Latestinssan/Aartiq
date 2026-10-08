const { app, session } = require('electron');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const https = require('https');
const Store = require('electron-store');
const { extractCRX, extractZip, isCRXFile, isExtensionDirectory } = require('./crx-extractor');
const { assertUrlDeclaresExtensionId, assertCrxIdMatchesUrl } = require('./crx-id-binding');

class ChromeExtensionManager extends EventEmitter {
  constructor() {
    super();
    this.store = new Store({ name: 'extensions', defaults: { installedExtensions: [], extensionsEnabled: true } });
    this.extensionsDir = path.join(app.getPath('userData'), 'extensions');
    this.loadedExtensions = new Map();
    this.disabledExtensions = new Set();
    if (!fs.existsSync(this.extensionsDir)) {
      fs.mkdirSync(this.extensionsDir, { recursive: true });
    }
  }

  async loadPersistedExtensions() {
    const installed = this.store.get('installedExtensions', []);
    const extensionsEnabled = this.store.get('extensionsEnabled', true);
    if (!extensionsEnabled) return;
    for (const ext of installed) {
      if (!ext.enabled) {
        this.disabledExtensions.add(ext.id);
        continue;
      }
      try {
        if (fs.existsSync(ext.path)) {
          await this.loadExtensionFromPath(ext.path);
        } else {
          this.removeFromStore(ext.id);
        }
      } catch (error) {
        console.error('[ChromeExtensionManager] Failed to load persisted extension:', ext.id, error);
      }
    }
  }

  async installFromFolder(folderPath) {
    if (!isExtensionDirectory(folderPath)) {
      throw new Error('Invalid extension: manifest.json not found');
    }
    const manifest = this.readManifest(folderPath);
    const extId = this.generateExtensionId(manifest.name);
    const destPath = path.join(this.extensionsDir, extId);
    if (fs.existsSync(destPath)) {
      fs.rmSync(destPath, { recursive: true });
    }
    this.copyDirectory(folderPath, destPath);
    const extension = await this.loadExtensionFromPath(destPath);
    const extensionInfo = this.extensionToInfo(extension, destPath, true);
    this.addToStore(extensionInfo);
    this.emit('extension-installed', extensionInfo);
    return extensionInfo;
  }

  async installFromCRX(crxPath) {
    if (!isCRXFile(crxPath)) {
      throw new Error('Invalid CRX file');
    }
    const tempDir = path.join(app.getPath('temp'), `crx-${Date.now()}`);
    extractCRX(crxPath, tempDir);
    const manifest = this.readManifest(tempDir);
    const extId = this.generateExtensionId(manifest.name);
    const destPath = path.join(this.extensionsDir, extId);
    if (fs.existsSync(destPath)) {
      fs.rmSync(destPath, { recursive: true });
    }
    fs.renameSync(tempDir, destPath);
    const extension = await this.loadExtensionFromPath(destPath);
    const extensionInfo = this.extensionToInfo(extension, destPath, true);
    this.addToStore(extensionInfo);
    this.emit('extension-installed', extensionInfo);
    return extensionInfo;
  }

  async uninstall(extensionId) {
    const extension = this.loadedExtensions.get(extensionId);
    if (extension) {
      session.defaultSession.removeExtension(extensionId);
      this.loadedExtensions.delete(extensionId);
    }
    const installed = this.store.get('installedExtensions', []);
    const ext = installed.find(e => e.id === extensionId);
    if (ext) {
      if (fs.existsSync(ext.path)) {
        fs.rmSync(ext.path, { recursive: true });
      }
      this.removeFromStore(extensionId);
      this.disabledExtensions.delete(extensionId);
      this.emit('extension-removed', extensionId);
      return true;
    }
    return false;
  }

  async enable(extensionId) {
    const installed = this.store.get('installedExtensions', []);
    const ext = installed.find(e => e.id === extensionId);
    if (!ext) throw new Error('Extension not found');
    if (!this.loadedExtensions.has(extensionId)) {
      await this.loadExtensionFromPath(ext.path);
    }
    ext.enabled = true;
    this.store.set('installedExtensions', installed);
    this.disabledExtensions.delete(extensionId);
    this.emit('extension-updated', { id: extensionId, enabled: true });
  }

  async disable(extensionId) {
    const extension = this.loadedExtensions.get(extensionId);
    if (extension) {
      session.defaultSession.removeExtension(extensionId);
      this.loadedExtensions.delete(extensionId);
    }
    const installed = this.store.get('installedExtensions', []);
    const ext = installed.find(e => e.id === extensionId);
    if (ext) {
      ext.enabled = false;
      this.store.set('installedExtensions', installed);
      this.disabledExtensions.add(extensionId);
      this.emit('extension-updated', { id: extensionId, enabled: false });
    }
  }

  getInstalledExtensions() {
    const installed = this.store.get('installedExtensions', []);
    const extensions = [];
    for (const ext of installed) {
      try {
        const manifest = this.readManifest(ext.path);
        extensions.push({
          id: ext.id,
          name: manifest.name,
          version: manifest.version,
          description: manifest.description || '',
          enabled: ext.enabled,
          path: ext.path,
          permissions: manifest.permissions || [],
          host_permissions: manifest.host_permissions || [],
          manifest_version: manifest.manifest_version,
          icons: this.getExtensionIcons(ext.path, manifest),
        });
      } catch (error) {
        console.error('[ChromeExtensionManager] Failed to read manifest for', ext.id, error);
      }
    }
    return extensions;
  }

  getExtensionById(extensionId) {
    const extensions = this.getInstalledExtensions();
    return extensions.find(e => e.id === extensionId) || null;
  }

  isExtensionsEnabled() {
    return this.store.get('extensionsEnabled', true);
  }

  async setExtensionsEnabled(enabled) {
    this.store.set('extensionsEnabled', enabled);
    if (enabled) {
      await this.loadPersistedExtensions();
    } else {
      for (const [id] of this.loadedExtensions) {
        session.defaultSession.removeExtension(id);
      }
      this.loadedExtensions.clear();
    }
  }

  setupWebStoreInterception() {
    session.defaultSession.on('will-download', (_event, item) => {
      const url = item.getURL();
      const mimeType = item.getMimeType();
      if (mimeType === 'application/x-chrome-extension' || url.includes('.crx') || url.includes('chrome.google.com/webstore')) {
        const tempPath = path.join(app.getPath('temp'), item.getFilename());
        item.setSavePath(tempPath);
        item.once('done', (_, state) => {
          if (state === 'completed') {
            this.installFromCRX(tempPath).then((info) => {
              if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            }).catch(error => {
              console.error('[ChromeExtensionManager] Web Store install failed:', error);
              if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            });
          }
        });
      }
    });
  }

  async loadExtensionFromPath(extensionPath) {
    const extension = await session.defaultSession.loadExtension(extensionPath, { allowFileAccess: true });
    this.loadedExtensions.set(extension.id, extension);
    return extension;
  }

  readManifest(extensionPath) {
    const manifestPath = path.join(extensionPath, 'manifest.json');
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  }

  generateExtensionId(name) {
    const base = name.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 32);
    const timestamp = Date.now().toString(36);
    return `${base}-${timestamp}`;
  }

  copyDirectory(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this.copyDirectory(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  extensionToInfo(extension, extensionPath, enabled) {
    const manifest = this.readManifest(extensionPath);
    return {
      id: extension.id,
      name: extension.name,
      version: manifest.version,
      description: manifest.description || '',
      enabled,
      path: extensionPath,
      permissions: manifest.permissions || [],
      host_permissions: manifest.host_permissions || [],
      manifest_version: manifest.manifest_version,
      icons: this.getExtensionIcons(extensionPath, manifest),
    };
  }

  getExtensionIcons(extensionPath, manifest) {
    const icons = [];
    if (manifest.icons) {
      for (const [size, iconPath] of Object.entries(manifest.icons)) {
        const fullPath = path.join(extensionPath, iconPath);
        if (fs.existsSync(fullPath)) {
          icons.push({ size: parseInt(size), url: `file://${fullPath.replace(/\\/g, '/')}` });
        }
      }
    }
    return icons;
  }

  /**
   * Install an extension from the Chrome Web Store by URL. Fail-closed in two
   * steps: the URL must declare the exact extension id it serves, and the
   * CRX3 package signature is verified and bound to that declared id before
   * any code is extracted — a package that fails either check is rejected and
   * never loaded.
   */
  async installFromWebStore(crxUrl) {
    // Refuse an unbindable request before spending the download: without a
    // declared id there is nothing to compare the verified package against,
    // and a valid signature alone only proves self-consistency — anyone can
    // mint a key and sign a package that verifies as that key's own id.
    assertUrlDeclaresExtensionId(crxUrl);
    const buf = await this._downloadBuffer(crxUrl);
    const { verifyCrx } = require('./crx-verifier');
    const verified = verifyCrx(buf);
    if (!verified.valid) {
      throw new Error(`CRX signature invalid: ${verified.error}`);
    }
    // Identity, not just self-consistency: the package's crx_id must equal
    // the id the URL declared — a URL promising extension X installs X or
    // nothing at all, so substituting any other (even validly signed)
    // package fails closed here.
    assertCrxIdMatchesUrl(crxUrl, verified.extensionId);
    const zipBuf = buf.subarray(verified.zipStart);
    const tempDir = path.join(app.getPath('temp'), `cws-${Date.now()}`);
    extractZip(zipBuf, tempDir);
    // Validates the archive actually carries a readable manifest.json before
    // anything is installed; the id itself comes from the signed header.
    this.readManifest(tempDir);
    // The verified crx_id — no name-derived fallback: a store package without
    // a verifiable id is rejected by the verifier, and a URL that declared one
    // has already been matched against it above.
    const extId = verified.extensionId;
    const destPath = path.join(this.extensionsDir, extId);
    if (fs.existsSync(destPath)) fs.rmSync(destPath, { recursive: true });
    this.copyDirectory(tempDir, destPath);
    fs.rmSync(tempDir, { recursive: true });
    const extension = await this.loadExtensionFromPath(destPath);
    const extensionInfo = this.extensionToInfo(extension, destPath, true);
    this.addToStore(extensionInfo);
    this.emit('extension-installed', extensionInfo);
    return extensionInfo;
  }

  /**
   * Import extensions from a real Chrome/Chromium profile into Aartiq. The
   * profile path is auto-detected when omitted.
   */
  async importFromChrome(profileDir) {
    const { importFromChrome: importChrome, findChromeProfile } = require('./chrome-importer');
    const dir = profileDir || findChromeProfile();
    if (!dir) throw new Error('Chrome profile not found.');
    const imported = importChrome(dir, this.extensionsDir);
    const loaded = [];
    for (const ext of imported) {
      try {
        const extension = await this.loadExtensionFromPath(ext.destPath);
        const info = this.extensionToInfo(extension, ext.destPath, true);
        this.addToStore(info);
        loaded.push(info);
        this.emit('extension-installed', info);
      } catch (e) {
        console.error('[ChromeExtensionManager] import failed', ext.id, e);
      }
    }
    return loaded;
  }

  /** Grade an installed extension's permission footprint. */
  analyzePermissions(extensionId) {
    const ext = this.getExtensionById(extensionId);
    if (!ext) throw new Error('Extension not found');
    const manifest = this.readManifest(ext.path);
    const { analyzePermissions } = require('./permission-analyzer');
    return analyzePermissions(manifest);
  }

  _downloadBuffer(url) {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject);
    });
  }

  addToStore(extensionInfo) {
    const installed = this.store.get('installedExtensions', []);
    const filtered = installed.filter(e => e.id !== extensionInfo.id);
    filtered.push({ id: extensionInfo.id, path: extensionInfo.path, enabled: extensionInfo.enabled });
    this.store.set('installedExtensions', filtered);
  }

  removeFromStore(extensionId) {
    const installed = this.store.get('installedExtensions', []);
    this.store.set('installedExtensions', installed.filter(e => e.id !== extensionId));
  }
}

module.exports = { ChromeExtensionManager };

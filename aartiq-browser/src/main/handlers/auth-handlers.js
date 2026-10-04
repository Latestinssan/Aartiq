const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const VAULT_KEYCHAIN_SERVICE_PREFIX = 'com.aartiq.vault.';
const AUTH_KEYCHAIN_SERVICE = 'com.aartiq.auth.session';

const nativeKeychain = (() => {
  try { return require('../../lib/native-keychain'); }
  catch (e) { return null; }
})();

const macosKeychain = (() => {
  if (process.platform !== 'darwin') return null;
  try { return require('../../lib/macos-keychain'); }
  catch (e) { return null; }
})();

const nativeCredentialDialog = (() => {
  try { return require('../../lib/native-credential-dialog'); }
  catch (e) { return null; }
})();

function getKeychainService(site) {
  return `${VAULT_KEYCHAIN_SERVICE_PREFIX}${site || 'unknown'}`;
}

function getKeychainAccount(entry) {
  return entry.username || 'default';
}

function getKeychainLabel(entry) {
  return `Aartiq: ${entry.site || 'unknown'} (${entry.username || 'default'})`;
}

async function syncToNativeKeychain(entry) {
  if (!nativeKeychain || !entry || !entry.password) return false;
  try {
    const result = await nativeKeychain.addPassword({
      account: getKeychainAccount(entry),
      service: getKeychainService(entry.site),
      password: entry.password,
      label: getKeychainLabel(entry),
    });
    return result && result.success;
  } catch {
    return false;
  }
}

async function removeFromNativeKeychain(entry) {
  if (!nativeKeychain || !entry) return false;
  try {
    const result = await nativeKeychain.deletePassword({
      account: getKeychainAccount(entry),
      service: getKeychainService(entry.site),
    });
    return result && result.success;
  } catch {
    return false;
  }
}

async function readFromNativeKeychain(entry) {
  if (!nativeKeychain || !entry) return null;
  try {
    const result = await nativeKeychain.getPassword({
      account: getKeychainAccount(entry),
      service: getKeychainService(entry.site),
    });
    if (result && result.success && result.password) {
      return result.password;
    }
    return null;
  } catch {
    return null;
  }
}

async function listICloudKeychainEntries() {
  if (!macosKeychain) return [];
  try {
    const result = await macosKeychain.listEntries({
      servicePrefix: VAULT_KEYCHAIN_SERVICE_PREFIX,
    });
    if (result && result.success && Array.isArray(result.entries)) {
      return result.entries.map(item => {
        const site = (item.service || '').replace(VAULT_KEYCHAIN_SERVICE_PREFIX, '');
        return {
          id: item.service || `${site}-${item.account}`,
          site,
          username: item.account === 'default' ? '' : (item.account || ''),
          password: item.password || '',
          title: item.label || '',
        };
      });
    }
    return [];
  } catch {
    return [];
  }
}

async function storeAuthInKeychain(key, value) {
  if (!nativeKeychain) return false;
  try {
    const result = await nativeKeychain.addPassword({
      account: key,
      service: AUTH_KEYCHAIN_SERVICE,
      password: typeof value === 'string' ? value : JSON.stringify(value),
      label: `Aartiq Auth: ${key}`,
    });
    return result && result.success;
  } catch {
    return false;
  }
}

async function readAuthFromKeychain(key) {
  if (!nativeKeychain) return null;
  try {
    const result = await nativeKeychain.getPassword({
      account: key,
      service: AUTH_KEYCHAIN_SERVICE,
    });
    if (result && result.success && result.password) {
      try { return JSON.parse(result.password); }
      catch { return result.password; }
    }
    return null;
  } catch {
    return null;
  }
}

async function deleteAuthFromKeychain(key) {
  if (!nativeKeychain) return false;
  try {
    const result = await nativeKeychain.deletePassword({
      account: key,
      service: AUTH_KEYCHAIN_SERVICE,
    });
    return result && result.success;
  } catch {
    return false;
  }
}

const VAULT_UNLOCK_TTL_MS = 5 * 60 * 1000;
let vaultUnlockExpiresAt = 0;

function isVaultUnlockStillValid() {
  return vaultUnlockExpiresAt > Date.now();
}

function rememberVaultUnlock() {
  vaultUnlockExpiresAt = Date.now() + VAULT_UNLOCK_TTL_MS;
}

function clearVaultUnlock() {
  vaultUnlockExpiresAt = 0;
}

async function verifyVaultAccess({ reason, actionText, store, permissionStore }) {
  const settings = permissionStore ? permissionStore.getSettings() : {};
  if (settings.requireDeviceUnlockForVaultAccess === false) {
    return { success: true, mode: 'vault-device-unlock-disabled' };
  }

  if (isVaultUnlockStillValid()) {
    return { success: true, mode: 'vault-device-unlock-cached' };
  }

  const { verifyNativeDeviceAccess, hasNativeDeviceUnlockSupport } = require('../../lib/native-os-verifier');

  if (!hasNativeDeviceUnlockSupport()) {
    return { success: false, error: 'Native device unlock is required for Neural Vault access on this build.' };
  }

  const nativeVerification = await verifyNativeDeviceAccess({
    reason: reason || 'Unlock Neural Vault to use saved credentials in Aartiq.',
    actionText: actionText || 'Neural Vault credential access',
    riskLevel: 'high',
  });

  if (!nativeVerification.supported) {
    return { success: false, error: nativeVerification.error || 'Native device unlock is unavailable for Neural Vault access.' };
  }

  if (!nativeVerification.approved) {
    return { success: false, error: nativeVerification.error || 'Neural Vault access was denied.' };
  }

  rememberVaultUnlock();
  if (permissionStore && permissionStore.logAudit) {
    permissionStore.logAudit(`vault.unlock: ${actionText || 'credential access'} (${nativeVerification.mode})`);
  }
  return { success: true, mode: nativeVerification.mode };
}

module.exports = function registerAuthHandlers(ipcMain, handlers) {
  const { mainWindow, store, permissionStore } = handlers;

  // ---------------------------------------------------------------------------
  // Main-process Firebase sign-in.
  //
  // Cloud sync and P2P run in the MAIN process, but Google sign-in happens in
  // the renderer (popup / OAuth window). The renderer forwards its Google id
  // token (or a custom token) here so both processes end up signed into the
  // SAME Firebase account/uid — that shared uid is what the device-registry
  // bridge (devices/{uid}) and the shared pairing master key are keyed on.
  // ---------------------------------------------------------------------------
  async function signInMainProcessFirebase(payload) {
    try {
      const firebaseService = require('../../lib/FirebaseService').default;
      if (!firebaseService.app) {
        return { success: false, error: 'Firebase config not available in main process yet' };
      }
      let user = null;
      if (payload?.provider === 'custom' && payload.token) {
        user = await firebaseService.signInWithCustomToken(payload.token);
      } else if (payload?.provider === 'google' && payload.idToken) {
        const { GoogleAuthProvider } = require('firebase/auth');
        user = await firebaseService.signInWithCredential(
          GoogleAuthProvider.credential(payload.idToken)
        );
      } else {
        return { success: false, error: 'Unsupported sign-in payload' };
      }
      if (user) {
        console.log('[Auth] Main process signed into Firebase:', user.uid);
        return { success: true, uid: user.uid };
      }
      return { success: false, error: 'Sign-in returned no user' };
    } catch (error) {
      console.error('[Auth] Main process Firebase sign-in failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  ipcMain.handle('sign-in-firebase-main', async (event, payload) => {
    return signInMainProcessFirebase(payload);
  });

  function getVaultEntries() {
    return store.get('vault_entries') || [];
  }

  function setVaultEntries(entries) {
    store.set('vault_entries', entries);
  }

  function maskVaultEntry(entry = {}) {
    return {
      id: entry.id,
      site: entry.site || '',
      username: entry.username || '',
      created: entry.created || null,
      hasPassword: !!entry.password,
      passwordMasked: entry.password ? '••••••••••••' : '',
      type: entry.type || 'login',
      title: entry.title || '',
      formData: entry.formData || undefined,
      hasTotp: !!entry.totpSecret,
    };
  }

  const maskAllEntries = () => getVaultEntries().map(maskVaultEntry);

  async function syncKeychainToLocalStore() {
    if (!macosKeychain) return;
    try {
      const keychainEntries = await listICloudKeychainEntries();
      if (keychainEntries.length === 0) return;

      const localEntries = getVaultEntries();
      const localBySiteUser = new Map(
        localEntries.map(e => [`${e.site}|${e.username || ''}`, e])
      );

      let changed = false;
      for (const kEntry of keychainEntries) {
        const key = `${kEntry.site}|${kEntry.username || ''}`;
        const existing = localBySiteUser.get(key);
        if (existing) {
          if (!existing.password && kEntry.password) {
            existing.password = kEntry.password;
            changed = true;
          }
        } else {
          localEntries.push({
            id: kEntry.id,
            site: kEntry.site,
            username: kEntry.username,
            password: kEntry.password,
            created: new Date().toISOString(),
            type: 'login',
          });
          changed = true;
        }
      }

      if (changed) {
        setVaultEntries(localEntries);
        console.log(`[Vault] Synced ${keychainEntries.length} iCloud Keychain entries to local store`);
      }
    } catch (err) {
      console.warn('[Vault] iCloud Keychain sync error:', err.message);
    }
  }

  syncKeychainToLocalStore();

  ipcMain.on('save-auth-token', async (event, { token, user, ...rest }) => {
    store.set('auth_token', token);
    store.set('auth_user', user);
    if (rest.rememberMe) {
      store.set('auth_remember', true);
    }
    await storeAuthInKeychain('auth_token', token);
    if (user) await storeAuthInKeychain('auth_user', user);
  });

  ipcMain.on('save-auth-session', async (event, sessionPayload) => {
    store.set('auth_session', sessionPayload);
    await storeAuthInKeychain('auth_session', sessionPayload);
  });

  ipcMain.handle('get-auth-token', async () => {
    let token = store.get('auth_token');
    if (!token && nativeKeychain) {
      token = await readAuthFromKeychain('auth_token');
      if (token) store.set('auth_token', token);
    }
    return token;
  });

  ipcMain.handle('get-user-info', async () => {
    let user = store.get('auth_user');
    if (!user && nativeKeychain) {
      user = await readAuthFromKeychain('auth_user');
      if (user) store.set('auth_user', user);
    }
    return user;
  });

  ipcMain.handle('get-auth-session', async () => {
    let session = store.get('auth_session');
    if (!session && nativeKeychain) {
      session = await readAuthFromKeychain('auth_session');
      if (session) store.set('auth_session', session);
    }
    return session;
  });

  ipcMain.on('clear-auth', async () => {
    store.delete('auth_token');
    store.delete('auth_user');
    store.delete('auth_session');
    await deleteAuthFromKeychain('auth_token');
    await deleteAuthFromKeychain('auth_user');
    await deleteAuthFromKeychain('auth_session');
  });

  ipcMain.handle('get-passwords-for-site', async (event, domain) => {
    const entries = getVaultEntries();
    const { domainMatches } = require('../../core/vault-handlers');
    const matches = entries.filter(entry =>
      domain ? domainMatches(entry.site, domain) : true
    );
    return matches;
  });

  ipcMain.handle('get-autofill-data', async (event, domain) => {
    try {
      const entries = getVaultEntries();
      const { domainMatches } = require('../../core/vault-handlers');
      const matches = entries.filter(entry => {
        if (!domain) return false;
        return domainMatches(entry.site, domain);
      });
      if (!matches.length) return { credentials: [], cards: [], addresses: [] };
      const credentials = matches.filter(e => (e.type || 'login') === 'login').map(e => ({
        id: e.id, username: e.username || '', password: e.password || '',
        title: e.title || '', site: e.site || '',
      }));
      const cards = matches.filter(e => e.type === 'card' || e.type === 'credit-card').map(e => ({
        id: e.id, number: e.number || e.cardNumber || '', name: e.name || e.cardName || '',
        expiry: e.expiry || '', expMonth: e.expMonth || '', expYear: e.expYear || '',
        cvc: e.cvc || '', site: e.site || '',
      }));
      const addresses = matches.filter(e => e.type === 'address').map(e => ({
        id: e.id, street: e.street || e.streetAddress || '', line2: e.line2 || '',
        city: e.city || '', state: e.state || '', zip: e.zip || e.postalCode || '',
        country: e.country || '', site: e.site || '',
      }));
      return { credentials, cards, addresses };
    } catch (e) {
      console.error('[Autofill] get-autofill-data error:', e);
      return { credentials: [], cards: [], addresses: [] };
    }
  });

  ipcMain.handle('vault-list-entries', async () => {
    return { success: true, entries: maskAllEntries() };
  });

  ipcMain.handle('vault-save-entry', async (event, payload = {}) => {
    const verification = await verifyVaultAccess({
      reason: 'Unlock Neural Vault to save a new credential.',
      actionText: `Save credential for ${payload.site || 'new site'}`,
      store,
      permissionStore,
    });
    if (!verification.success) {
      return { success: false, error: verification.error };
    }

    const entries = getVaultEntries();
    const site = (payload.site || '').toLowerCase().replace(/^https?:\/\//i, '').split('/')[0];
    const username = `${payload.username || ''}`.trim();
    const password = `${payload.password || ''}`;

    if (!site || !password) {
      return { success: false, error: 'Site and password are required.' };
    }

    const incomingId = `${payload.id || ''}`.trim();
    const nextEntry = {
      id: incomingId || Date.now().toString(),
      site,
      username,
      password,
      type: payload.type || 'login',
      title: payload.title || '',
      created: payload.created || new Date().toISOString(),
    };

    const existingIndex = entries.findIndex(e => e.id === nextEntry.id || (e.site === site && e.username === username));
    if (existingIndex >= 0) {
      const oldEntry = entries[existingIndex];
      entries[existingIndex] = { ...entries[existingIndex], ...nextEntry };
      await removeFromNativeKeychain(oldEntry);
    } else if (!entries.some(e => e.site === site && e.username === username && e.password === password)) {
      entries.push(nextEntry);
    }

    await syncToNativeKeychain(nextEntry);
    setVaultEntries(entries);
    clearVaultUnlock();
    const { appendAudit } = require('../../core/vault-handlers');
    appendAudit(null, { action: 'save', entryId: nextEntry.id, site: nextEntry.site, type: nextEntry.type, timestamp: new Date().toISOString() });
    return { success: true, entries: maskAllEntries() };
  });

  ipcMain.handle('vault-delete-entry', async (event, entryId) => {
    const entry = getVaultEntries().find(e => e.id === entryId);
    if (!entry) return { success: false, error: 'Entry not found' };

    const verification = await verifyVaultAccess({
      reason: 'Unlock Neural Vault to delete a saved credential.',
      actionText: `Delete credential for ${entry.site || 'unknown'}`,
      store,
      permissionStore,
    });
    if (!verification.success) {
      return { success: false, error: verification.error };
    }

    setVaultEntries(getVaultEntries().filter(e => e.id !== entryId));
    await removeFromNativeKeychain(entry);
    clearVaultUnlock();
    const { appendAudit } = require('../../core/vault-handlers');
    appendAudit(null, { action: 'delete', entryId: entry.id, site: entry.site, timestamp: new Date().toISOString() });
    return { success: true, entries: maskAllEntries() };
  });

  ipcMain.handle('vault-read-secret', async (event, entryId) => {
    const entry = getVaultEntries().find(e => e.id === entryId);
    if (!entry) return { success: false, error: 'Entry not found' };

    const verification = await verifyVaultAccess({
      reason: 'Unlock Neural Vault to reveal a saved password.',
      actionText: `Reveal password for ${entry.site || 'unknown'}${entry.username ? ' • ' + entry.username : ''}`,
      store,
      permissionStore,
    });
    if (!verification.success) {
      return { success: false, error: verification.error };
    }

    let password = entry.password;
    if (!password && nativeKeychain) {
      password = await readFromNativeKeychain(entry);
      if (password) {
        entry.password = password;
        setVaultEntries(getVaultEntries());
      }
    }

    const { appendAudit } = require('../../core/vault-handlers');
    appendAudit(null, { action: 'read', entryId: entry.id, site: entry.site, timestamp: new Date().toISOString() });
    return { success: true, password: password || '' };
  });

  ipcMain.handle('vault-copy-secret', async (event, entryId) => {
    const entry = getVaultEntries().find(e => e.id === entryId);
    if (!entry) return { success: false, error: 'Entry not found' };

    const verification = await verifyVaultAccess({
      reason: 'Unlock Neural Vault to copy a saved password.',
      actionText: `Copy password for ${entry.site || 'unknown'}${entry.username ? ' • ' + entry.username : ''}`,
      store,
      permissionStore,
    });
    if (!verification.success) {
      return { success: false, error: verification.error };
    }

    let password = entry.password;
    if (!password && nativeKeychain) {
      password = await readFromNativeKeychain(entry);
      if (password) {
        entry.password = password;
        setVaultEntries(getVaultEntries());
      }
    }

    if (!password) return { success: false, error: 'No password found' };

    const { clipboard } = require('electron');
    clipboard.writeText(password);
    const { appendAudit } = require('../../core/vault-handlers');
    appendAudit(null, { action: 'copy', entryId: entry.id, site: entry.site, timestamp: new Date().toISOString() });
    return { success: true };
  });

  const neverSaveDomains = new Set(store.get('never_save_domains') || []);

  function persistNeverSaveDomains() {
    store.set('never_save_domains', [...neverSaveDomains]);
  }

  async function showNativeCredentialDialog({ domain, url, username, password, type }) {
    if (neverSaveDomains.has(domain)) return;

    if (nativeCredentialDialog) {
      try {
        const result = await nativeCredentialDialog.showCredentialDialog({ domain, username, password });
        if (result.action === 'save') {
          const entries = getVaultEntries();
          const normalizedDomain = domain.toLowerCase().replace(/^https?:\/\//i, '').split('/')[0];
          const entry = {
            id: Date.now().toString(),
            site: normalizedDomain,
            username: username || '',
            password,
            type: type || 'login',
            created: new Date().toISOString(),
          };
          if (!entries.some(e => e.site === normalizedDomain && e.username === username)) {
            entries.push(entry);
            setVaultEntries(entries);
            await syncToNativeKeychain(entry);
          }
          return;
        }
        if (result.action === 'never') {
          neverSaveDomains.add(domain);
          persistNeverSaveDomains();
          return;
        }
        return;
      } catch {
      }
    }

    if (mainWindow) {
      mainWindow.webContents.send('show-password-save-dialog', { domain, url, username, password, type });
    }
  }

  ipcMain.on('propose-password-save', (event, { domain, url, username, password, type }) => {
    showNativeCredentialDialog({ domain, url, username, password, type });
  });

  ipcMain.on('propose-form-collection-save', (event, { domain, title, data, type }) => {
    if (mainWindow) {
      mainWindow.webContents.send('show-form-save-dialog', { domain, title, data, type });
    }
  });

  let authWindow = null;

  ipcMain.on('open-auth-window', (event, authUrl) => {
    const isOAuthUrl = authUrl.includes('accounts.google.com') ||
      authUrl.includes('firebase') ||
      authUrl.includes('oauth') ||
      authUrl.includes('auth');

    if (isOAuthUrl) {
      const { shell, BrowserWindow } = require('electron');
      if (authUrl.includes('accounts.google.com')) {
        if (authWindow && !authWindow.isDestroyed()) { authWindow.destroy(); authWindow = null; }
        shell.openExternal(authUrl);
        return;
      }

      if (authWindow && !authWindow.isDestroyed()) {
        authWindow.focus();
        authWindow.loadURL(authUrl);
        return;
      }

      const isMacPlatform = process.platform === 'darwin';
      const isWinPlatform = process.platform === 'win32';
      authWindow = new BrowserWindow({
        width: 540, height: 780,
        frame: isMacPlatform,
        backgroundColor: '#02030a',
        parent: mainWindow,
        show: false,
        titleBarStyle: 'hidden',
        webPreferences: {
          preload: path.join(__dirname, '..', '..', 'auth-preload.js'),
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      if (!isMacPlatform) authWindow.setMenuBarVisibility(false);
      authWindow.webContents.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");

      authWindow.webContents.setWindowOpenHandler(({ url }) => {
        const isPopupAuthUrl = url.includes('accounts.google.com') ||
          url.includes('googleusercontent.com') ||
          url.includes('firebaseapp.com') ||
          url.includes('/__/auth/') ||
          url.includes('login.microsoftonline.com') ||
          url.includes('login.live.com') ||
          url.includes('microsoft.com') ||
          url.includes('oauth');

        if (isPopupAuthUrl) {
          return {
            action: 'allow',
            overrideBrowserWindowOptions: {
              width: 520,
              height: 720,
              center: true,
              autoHideMenuBar: true,
              modal: false,
              parent: authWindow || mainWindow,
              backgroundColor: '#02030a',
              webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: false,
              },
            }
          };
        }

        return { action: 'allow' };
      });

      const closeAuthWindowSafely = () => {
        if (authWindow && !authWindow.isDestroyed()) { authWindow.destroy(); authWindow = null; }
      };

      const dispatchAuthCallback = (deepLinkUrl) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('auth-callback', deepLinkUrl);
          mainWindow.focus();
        }
        setTimeout(closeAuthWindowSafely, 300);
      };

      authWindow.webContents.on('will-navigate', (event, url) => {
        if (url.startsWith('aartiq-browser://')) { event.preventDefault(); dispatchAuthCallback(url); }
      });

      authWindow.webContents.on('will-redirect', (event, url) => {
        if (url.startsWith('aartiq-browser://')) { event.preventDefault(); dispatchAuthCallback(url); }
        else if (url.startsWith('http://localhost') && url.includes('code=')) {
          event.preventDefault();
          const code = new URLSearchParams(new URL(url).search).get('code');
          if (code) { ipcMain.emit('gmail-oauth-code', null, code); closeAuthWindowSafely(); }
        }
      });

      authWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        if (validatedURL?.startsWith('aartiq-browser://')) dispatchAuthCallback(validatedURL);
      });

      authWindow.webContents.on('console-message', (event) => {
        const message = event.message || '';
        try {
          if (message.includes('comet-auth-success')) {
            const data = JSON.parse(message);
            if (data.type === 'comet-auth-success' && data.data) {
              const d = data.data;
              const params = new URLSearchParams({ auth_status: 'success', uid: d.uid || '', email: d.email || '' });
              if (d.name) params.set('name', d.name);
              if (d.photo) params.set('photo', d.photo);
              if (d.idToken) params.set('id_token', d.idToken);
              if (d.id_token) params.set('id_token', d.id_token);
              if (d.firebaseConfig) params.set('firebase_config', btoa(JSON.stringify(d.firebaseConfig)));
              dispatchAuthCallback(`aartiq-browser://auth?${params.toString()}`);

              // Hand the session to the MAIN process too (cloud sync / P2P
              // live there). Persist the provided Firebase config so the main
              // process can initialize, then sign in with the same Google id
              // token → same uid as the renderer (same Google account).
              try {
                if (d.firebaseConfig && store) {
                  store.set('persistent_firebase-config', d.firebaseConfig);
                  require('../../lib/FirebaseService').default.reinitialize();
                }
              } catch (e) { /* config mirror is best-effort */ }
              const googleIdToken = d.idToken || d.id_token;
              if (googleIdToken) {
                signInMainProcessFirebase({ provider: 'google', idToken: googleIdToken }).catch(() => {});
              }
            }
          }
        } catch (e) { }
      });

      authWindow.loadURL(authUrl);
      authWindow.once('ready-to-show', () => authWindow.show());
      authWindow.on('closed', () => { authWindow = null; });
    } else {
      require('electron').shell.openExternal(authUrl);
    }
  });

  ipcMain.on('close-auth-window', () => {
    if (authWindow && !authWindow.isDestroyed()) authWindow.close();
    authWindow = null;
  });

  // ============================================================================
  // VAULT MIGRATION — Proactive re-encryption of legacy vault data
  // ============================================================================

  const { migrateVaultToModernFormat, checkVaultMigrationStatus } = require('../../core/vault-handlers');

  /**
   * Check if any vault entries contain legacy encrypted data (LCL: or E2EE:).
   * Safe to call at startup — read-only, no modifications.
   */
  ipcMain.handle('vault-check-migration', async () => {
    try {
      return checkVaultMigrationStatus();
    } catch (e) {
      console.error('[Vault Migration] Check failed:', e);
      return { needsMigration: false, legacyCount: 0, error: e.message };
    }
  });

  /**
   * Proactively migrate all legacy vault entries to the current E2EE2: format.
   * Decrypts LCL: and E2EE: prefixed data, re-encrypts with PBKDF2 600K SHA-256.
   * Safe to call multiple times — already-migrated entries are skipped.
   */
  ipcMain.handle('vault-migrate-to-modern', async () => {
    try {
      const verification = await verifyVaultAccess({
        reason: 'Vault migration requires authentication to access encryption keys.',
        actionText: 'Migrate vault to modern encryption format',
        store,
        permissionStore,
      });
      if (!verification.success) {
        return { success: false, error: verification.error };
      }

      const { migrateVaultToModernFormat } = require('../../core/vault-handlers');
      const result = await migrateVaultToModernFormat();
      return { success: true, ...result };
    } catch (e) {
      console.error('[Vault Migration] Migration failed:', e);
      return { success: false, error: e.message };
    }
  });

  // ============================================================================
  // TOTP 2FA Support
  // ============================================================================

  ipcMain.handle('vault-generate-totp', async (event, entryId) => {
    try {
      const entries = getVaultEntries();
      const entry = entries.find(e => e.id === entryId);
      if (!entry) return { success: false, error: 'Entry not found' };
      if (!entry.totpSecret) return { success: false, error: 'No TOTP secret configured for this entry' };

      const { generateTotpCode, getTotpRemainingSeconds } = require('../../core/vault-handlers');
      const code = generateTotpCode(entry.totpSecret);
      const remaining = getTotpRemainingSeconds();
      return { success: true, code, remaining, entryId };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault-save-totp-secret', async (event, entryId, totpSecret) => {
    try {
      const entries = getVaultEntries();
      const entry = entries.find(e => e.id === entryId);
      if (!entry) return { success: false, error: 'Entry not found' };

      const verification = await verifyVaultAccess({
        reason: 'Unlock Neural Vault to save a TOTP secret.',
        actionText: `Save TOTP for ${entry.site || 'unknown'}`,
        store, permissionStore,
      });
      if (!verification.success) return { success: false, error: verification.error };

      entry.totpSecret = totpSecret;
      setVaultEntries(entries);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault-remove-totp-secret', async (event, entryId) => {
    try {
      const entries = getVaultEntries();
      const entry = entries.find(e => e.id === entryId);
      if (!entry) return { success: false, error: 'Entry not found' };

      const verification = await verifyVaultAccess({
        reason: 'Unlock Neural Vault to remove a TOTP secret.',
        actionText: `Remove TOTP for ${entry.site || 'unknown'}`,
        store, permissionStore,
      });
      if (!verification.success) return { success: false, error: verification.error };

      delete entry.totpSecret;
      setVaultEntries(entries);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ============================================================================
  // Vault Audit Log
  // ============================================================================

  ipcMain.handle('vault-read-audit-log', async (event, limit = 100) => {
    try {
      const { readAuditLog } = require('../../core/vault-handlers');
      const entries = readAuditLog(null, limit);
      return { success: true, entries };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  console.log('[Handlers] Auth handlers registered (native keychain + vault migration + TOTP + audit)');
};

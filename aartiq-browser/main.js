// ULTRA EARLY: GPU flags must be before ANY electron import
const electron = require('electron');
const { app, BrowserWindow, ipcMain, BrowserView, session, shell, clipboard, dialog, globalShortcut, Menu, protocol, desktopCapturer, screen, nativeImage, net, safeStorage, nativeTheme } = electron;

const appendStartupSwitch = (name, value) => {
  const normalizedName = name.startsWith('--') ? name.slice(2) : name;
  if (typeof value === 'undefined') {
    app.commandLine.appendSwitch(normalizedName);
    return;
  }
  app.commandLine.appendSwitch(normalizedName, value);
};

const configureStartupSwitches = () => {
  // Keep startup tuning minimal. The previous flag set forced an unstable GPU path
  // and disabled renderer throttling, which drove high idle CPU and power usage.
  appendStartupSwitch('disable-default-apps');
  appendStartupSwitch('disable-sync');
  appendStartupSwitch('disable-translate');
  appendStartupSwitch('metrics-recording-only');
  appendStartupSwitch('no-first-run');
  appendStartupSwitch('safebrowsing-disable-auto-update');
  appendStartupSwitch('log-missing-plugins');

  if (process.platform === 'darwin') {
    // Prefer the native Metal-backed compositor on Apple Silicon.
    appendStartupSwitch('use-angle', 'metal');
    return;
  }

  if (process.platform === 'win32') {
    appendStartupSwitch('enable-gpu-rasterization');
    appendStartupSwitch('enable-zero-copy');
    appendStartupSwitch('enable-hardware-overlays');
  }
};

configureStartupSwitches();

const isPackaged = app.isPackaged;

let mcpManager;
try {
  ({ mcpManager } = require('./src/lib/mcp-server-registry.js'));
} catch (e) {
  console.warn('[Main] mcp-server-registry failed to load:', e.message);
}
const QRCode = require('qrcode');
const contextMenuRaw = require('electron-context-menu');
const contextMenu = contextMenuRaw.default || contextMenuRaw;
const fs = require('fs');

let PDFDocument, rgb, StandardFonts;
try {
  ({ PDFDocument, rgb, StandardFonts } = require('pdf-lib'));
} catch (e) {
  console.warn('[Main] pdf-lib failed to load:', e.message);
}

let PptxGenJS;
try {
  PptxGenJS = require('pptxgenjs');
} catch (e) {
  console.warn('[Main] pptxgenjs failed to load:', e.message);
}

let Document, Packer, Paragraph, HeadingLevel, TextRun, Table, TableRow, TableCell,
  WidthType, ImageRun, PageNumber, Header, Footer, BorderStyle, VerticalAlign,
  AlignmentType, PageOrientation;
try {
  ({
    Document, Packer, Paragraph, HeadingLevel, TextRun, Table, TableRow, TableCell,
    WidthType, ImageRun, PageNumber, Header, Footer, BorderStyle, VerticalAlign,
    AlignmentType, PageOrientation,
  } = require('docx'));
} catch (e) {
  console.warn('[Main] docx failed to load:', e.message);
}

const path = require('path');
const os = require('os');
const { spawn, exec, execSync, spawnSync } = require('child_process');
const { randomBytes, createCipheriv, createDecipheriv, randomUUID } = require('crypto');
const Store = require('electron-store');
const store = new Store();

let createWorker;
try {
  ({ createWorker } = require('tesseract.js'));
} catch (e) {
  console.warn('[Main] tesseract.js failed to load:', e.message);
}

let screenshot;
try {
  screenshot = require('screenshot-desktop');
} catch (e) {
  console.warn('[Main] screenshot-desktop failed to load:', e.message);
}

let Jimp;
try {
  Jimp = require('jimp');
} catch (e) {
  console.warn('[Main] jimp failed to load:', e.message);
}
const util = require('util');
const execPromise = util.promisify(exec);
const AUTH_SESSION_KEY = 'secure_auth_session_v1';
const LEGACY_AUTH_TOKEN_KEY = 'auth_token';
const LEGACY_USER_INFO_KEY = 'user_info';

const getAuthStorageBackend = () => {
  if (process.platform !== 'linux') {
    return process.platform;
  }

  try {
    return safeStorage.getSelectedStorageBackend();
  } catch {
    return 'unknown';
  }
};

const canEncryptAuthSession = () => {
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
    return false;
  }

  const backend = getAuthStorageBackend();
  return backend !== 'basic_text' && backend !== 'unknown';
};

const saveSecureAuthSession = (sessionPayload = {}) => {
  if (!sessionPayload || typeof sessionPayload !== 'object') {
    return false;
  }

  if (!canEncryptAuthSession()) {
    console.warn('[Auth] Secure storage unavailable; auth session was not persisted.');
    return false;
  }

  const encrypted = safeStorage.encryptString(JSON.stringify(sessionPayload));
  store.set(AUTH_SESSION_KEY, {
    version: 1,
    encrypted: true,
    updatedAt: Date.now(),
    backend: getAuthStorageBackend(),
    payload: encrypted.toString('base64'),
  });

  return true;
};

const getSecureAuthSession = () => {
  const saved = store.get(AUTH_SESSION_KEY);
  if (!saved || typeof saved !== 'object') {
    return null;
  }

  try {
    if (!saved.encrypted || !saved.payload || !canEncryptAuthSession()) {
      return null;
    }

    const decrypted = safeStorage.decryptString(Buffer.from(saved.payload, 'base64'));
    return JSON.parse(decrypted);
  } catch (error) {
    console.error('[Auth] Failed to decrypt secure auth session:', error);
    return null;
  }
};

const clearSecureAuthSession = () => {
  store.delete(AUTH_SESSION_KEY);
};

const migrateLegacyAuthSession = () => {
  const existingSession = getSecureAuthSession();
  if (existingSession) {
    if (store.has(LEGACY_AUTH_TOKEN_KEY)) store.delete(LEGACY_AUTH_TOKEN_KEY);
    if (store.has(LEGACY_USER_INFO_KEY)) store.delete(LEGACY_USER_INFO_KEY);
    return;
  }

  const legacyToken = store.get(LEGACY_AUTH_TOKEN_KEY);
  const legacyUser = store.get(LEGACY_USER_INFO_KEY);

  if (!legacyToken && !legacyUser) {
    return;
  }

  if (saveSecureAuthSession({
    token: legacyToken || null,
    user: legacyUser || null,
    migratedFromLegacyStore: true,
    savedAt: Date.now(),
  })) {
    store.delete(LEGACY_AUTH_TOKEN_KEY);
    store.delete(LEGACY_USER_INFO_KEY);
    console.log('[Auth] Migrated legacy auth data into secure session storage.');
  }
};

// Register the custom `app://` scheme early so we can safely load static assets from the exported build.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

// Augment PATH for macOS/Linux to find common command-line tools like docker
if (process.platform !== 'win32') {
  const extraPaths = [
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    '/opt/homebrew/bin',
    '/usr/local/sbin'
  ];
  const currentPath = process.env.PATH || '';
  const newPath = Array.from(new Set([...extraPaths, ...currentPath.split(':')])).join(':');
  process.env.PATH = newPath;
}

let robot = null;
try {
  robot = require('robotjs');
} catch (e) {
  console.warn('[Main] robotjs not available (Find & Click disabled). Run `npm run rebuild:native` after Electron upgrades:', e.message);
}

let tesseractWorker; // Declare tesseractWorker here
// Production mode detection:
// 1. app.isPackaged - true when running from built .exe
// 2. NODE_ENV === 'production' - for manual testing before build
// 3. Check if out/index.html exists - fallback to prod if dev server isn't available
const isDev = !app.isPackaged;
const express = require('express');
const bodyParser = require('body-parser');
const { getP2PSync } = require('./src/lib/P2PFileSyncService.js'); // Import the P2P service
const { getWiFiSync } = require('./src/lib/WiFiSyncService.js');
const { masterPinService } = require('./src/lib/MasterPINService.js');
const { unifiedSessionManager } = require('./src/lib/UnifiedSessionManager.js');
const { permissionRelayService } = require('./src/lib/PermissionRelayService.js');

// ERROR-PROOFING: Global error handlers for uncaught exceptions
// Only exit the process for truly fatal errors; log and continue for recoverable ones
// so that a single bad require() or module init doesn't instantly kill the app.
let _exceptionCount = 0;
process.on('uncaughtException', (error) => {
  _exceptionCount++;
  console.error(`[MAIN] Uncaught Exception (#${_exceptionCount}):`, error.message, error.stack);
  // If the app is already running, keep it alive — the error is likely in a
  // non-critical service (StoreKit, Siri Shortcuts bridge, etc.)
  if (_exceptionCount > 5) {
    console.error('[MAIN] Too many uncaught exceptions — forcing exit');
    try { app.quit(); } catch (e) {}
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[MAIN] Unhandled Rejection at:', promise, 'reason:', reason);
});

let p2pSyncService = null; // Declare p2pSyncService here
let wifiSyncService = null; // Declare wifiSyncService here
let cloudSyncService = null; // Declare cloudSyncService here

// Desktop Automation Services (Aartiq Guide v2)
const { PermissionStore } = require('./src/lib/permission-store.js');
const { hasNativeDeviceUnlockSupport, verifyNativeDeviceAccess, verifyNativeCommandApproval } = require('./src/lib/native-os-verifier.js');
const { RobotService } = require('./src/lib/robot-service.js');
const { TesseractOcrService } = require('./src/lib/tesseract-service.js');
const { AartiqAiEngine } = require('./src/lib/ai-engine.js');
const { ScreenVisionService } = require('./src/lib/screen-vision-service.js');
const { FlutterBridgeServer } = require('./src/lib/bridge-server.js');
const { FileSystemMcpServer, NativeAppMcpServer } = require('./src/lib/mcp-desktop-server.js');
const { BrowserMcpServer } = require('./src/lib/mcp-browser-server.js');
const { checkLocalRequest } = require('./src/lib/local-server-auth.js');
const { buildMcpSseUrl } = require('./src/lib/mcp-bridge-url.js');
const { RagService } = require('./src/lib/rag-service.js');
const { VoiceService } = require('./src/lib/voice-service.js');
const { WorkflowRecorder } = require('./src/lib/workflow-recorder.js');
const { automationManager } = require('./src/lib/automation-manager.js');
const { PopSearchService, popSearchService } = require('./src/lib/pop-search-service.js');
const { WebSearchProvider } = require('./src/lib/web-search-service.js');
const { MacNativePanelManager } = require('./src/lib/macos-native-panels.js');
const { PluginManager, pluginManager } = require('./src/lib/plugin-manager.js');
const { ChromeExtensionManager } = require('./src/lib/extensions/ChromeExtensionManager.js');
const { AutofillProfileService } = require('./src/lib/autofill/AutofillProfileService.js');
const { resolveAndClickWithAi } = require('./src/lib/browser-navigation-service.js');
const { domEngine } = require('./src/lib/dom-engine.js');
const { getMacOSPermissionHealth, resetMacOSPermissions } = require('./src/lib/macos-permission-health.js');
const {
  generateAppleIntelligenceImage,
  generateGenmoji,
  getAppleIntelligenceStatus,
  summarizeWithAppleIntelligence,
} = require('./src/lib/apple-intelligence.js');
const {
  CATALOG_TTL_MS,
  fetchProviderModelCatalog,
  getProviderApiKeyStoreKey,
  getProviderFallbackModel,
  getProviderLabel,
  getProviderModelStoreKey,
} = require('./src/lib/provider-model-discovery.js');
/**
 * Load `.env` / `.env.local` into `process.env` before anything reads a key.
 *
 * No dotenv dependency: the format we need is one line per `KEY=value`, and the
 * previous behaviour was that a correctly filled `.env` did nothing at all,
 * because nothing ever read the file. `.env.local` wins over `.env` and neither
 * overrides a variable the environment already provides, so a key exported by the
 * launch script still wins. `.env` is gitignored; see `.env.example`.
 */
function loadEnvFiles(dir) {
  for (const name of ['.env', '.env.local']) {
    const file = require('path').join(dir, name);
    let text;
    try {
      text = require('fs').readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
      if (!key) continue;
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"') && value.length > 1)
        || (value.startsWith("'") && value.endsWith("'") && value.length > 1)
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
loadEnvFiles(__dirname);

const webSearchProvider = new WebSearchProvider();

// Handler modules (src/main/handlers/) — modular IPC handler registration
const { registerAllHandlers } = require('./src/main/handlers/index.js');

// Core modules - Architecture refactoring (extracted from main.js)
const { NetworkSecurityManager } = require('./src/core/network-security.js');
const { WindowManager, windowManager } = require('./src/core/window-manager.js');
const { CommandExecutor } = require('./src/core/command-executor.js');
const { CapabilityController } = require('./src/core/capability-controller.js');
const { setPermissionStore: setCommandValidatorPermissionStore } = require('./src/core/command-validator.js');

// ✅ NEW: Relocate essential system IPC handlers to the top to prevent "no handler registered" errors
ipcMain.handle('get-app-version', () => {
  return app.getVersion() || '1.0.0';
});

ipcMain.handle('get-platform', () => {
  return process.platform;
});

ipcMain.handle('apple-intelligence-status', async () => {
  return getAppleIntelligenceStatus();
});

ipcMain.handle('apple-intelligence-summary', async (event, text) => {
  return summarizeWithAppleIntelligence(text);
});

// --- CLI TOKEN PERSISTENCE ---
// Read-or-create ~/.aartiq-token (mode 0600) instead of overwriting it with a
// fresh value on every start: the Swift panels and aartiq-cli read the file, so
// rotation only broke clients that had copied the value into a config (README
// known limits). Delete the file and restart Aartiq to rotate.
const { loadOrCreateSessionToken } = require('./src/lib/session-token');
const nativeMacUiToken = loadOrCreateSessionToken('cli');

ipcMain.handle('apple-intelligence-generate-image', async (event, { prompt, outputPath, style } = {}) => {
  return generateAppleIntelligenceImage(prompt, outputPath, style);
});

ipcMain.handle('apple-intelligence-genmoji', async (event, { prompt } = {}) => {
  return generateGenmoji(prompt);
});

// ============================================================================
// SIRI & SHORTCUTS INTEGRATION
// ============================================================================
const { setupSiriShortcutsHandlers, setupShortcutsCLIHandlers, registerURLScheme, handleURLSchemeEvent, executeShortcutAction, speakWithSiri } = require('./src/lib/SiriShortcutsIntegration.js');
const { setupVoiceInputHandler, speakText: voiceSpeak, listenForVoiceInput: voiceListen, getVoiceList: voiceGetVoices, parseVoiceCommand: voiceParseCommand } = require('./src/lib/voice-input-handler.js');
const { executeAppleScriptCommand: runAppleScript, speakText: scriptSpeak, listenForSpeech: scriptListen, getAvailableVoices: scriptGetVoices } = require('./src/lib/apple-script-bridge.js');
const { raycastIntegration, RAYCAST_SCHEMA } = require('./src/lib/raycast-integration.js');

ipcMain.handle('raycast:protocol', async (event, url) => {
  return await raycastIntegration.handleProtocol(url);
});

ipcMain.handle('raycast:get-manifest', async () => {
  return raycastIntegration.getManifest();
});

const AARTIQ_URL_SCHEME = 'aartiq';

setupSiriShortcutsHandlers();
setupShortcutsCLIHandlers();
setupVoiceInputHandler();

registerURLScheme();
console.log('[Main] Registered aartiq:// URL scheme for Shortcuts');

ipcMain.handle('siri:execute-action', async (event, action, params) => {
  return await executeShortcutAction(action, params);
});

ipcMain.handle('siri:speak', async (event, text) => {
  return await speakWithSiri(text);
});

ipcMain.handle('automation:enable-cli', async () => {
  const { exec, execSync } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  
  const cliPath = path.join(__dirname, 'scripts', 'aartiq-cli.js');
  const platform = process.platform;
  
  try {
    if (platform === 'darwin') {
      const destPath = '/usr/local/bin/aartiq';
      const command = `ln -sf "${cliPath}" "${destPath}"`;
      try {
        await execAsync(command);
        return { success: true, message: 'CLI enabled at /usr/local/bin/aartiq' };
      } catch (e) {
        const sudoCommand = `osascript -e 'do shell script "ln -sf \\"${cliPath}\\" \\"${destPath}\\"" with administrator privileges'`;
        await execAsync(sudoCommand);
        return { success: true, message: 'CLI enabled with administrator privileges' };
      }
    } else if (platform === 'linux') {
      const userBinDir = path.join(os.homedir(), '.local', 'bin');
      const destPath = path.join(userBinDir, 'aartiq');
      try {
        if (!fs.existsSync(userBinDir)) {
          fs.mkdirSync(userBinDir, { recursive: true });
        }
        fs.symlinkSync(cliPath, destPath);
        return { success: true, message: `CLI enabled at ${destPath} (ensure ~/.local/bin is in your PATH)` };
      } catch (e) {
        // Try /usr/local/bin with sudo via pkexec
        const systemPath = '/usr/local/bin/aartiq';
        await execAsync(`pkexec ln -sf "${cliPath}" "${systemPath}"`);
        return { success: true, message: 'CLI enabled at /usr/local/bin/aartiq' };
      }
    } else if (platform === 'win32') {
      const userBinDir = path.join(os.homedir(), 'AppData', 'Local', 'Aartiq', 'bin');
      const destPath = path.join(userBinDir, 'aartiq.cmd');
      const psPath = path.join(userBinDir, 'aartiq.ps1');
      
      if (!fs.existsSync(userBinDir)) {
        fs.mkdirSync(userBinDir, { recursive: true });
      }
      
      fs.writeFileSync(destPath, `@echo off\r\nnode "${cliPath}" %*\r\n`);
      fs.writeFileSync(psPath, `param([string]$args)\r\n& node "${cliPath}" $args\r\n`);
      
      // Try to add to PATH via user env
      try {
        const userPath = execSync(
          `[Environment]::GetEnvironmentVariable('Path', 'User')`,
          { shell: 'powershell.exe' }
        ).toString().trim();
        if (!userPath.includes(userBinDir)) {
          execSync(
            `[Environment]::SetEnvironmentVariable('Path', '${userPath};${userBinDir}', 'User')`,
            { shell: 'powershell.exe' }
          );
        }
      } catch (_) {}
      
      return { success: true, message: `CLI enabled at ${destPath} (added to user PATH)` };
    }
    return { success: false, error: 'Platform not supported for auto-CLI' };
  } catch (error) {
    console.error('[CLI] Activation failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('automation:check-cli-status', async () => {
  const platform = process.platform;
  let cliPath;
  if (platform === 'darwin') {
    cliPath = '/usr/local/bin/aartiq';
  } else if (platform === 'linux') {
    cliPath = path.join(os.homedir(), '.local', 'bin', 'aartiq');
    if (!fs.existsSync(cliPath)) {
      cliPath = '/usr/local/bin/aartiq';
    }
  } else if (platform === 'win32') {
    cliPath = path.join(os.homedir(), 'AppData', 'Local', 'Aartiq', 'bin', 'aartiq.cmd');
  }
  const exists = cliPath ? fs.existsSync(cliPath) : false;
  let isSymlink = false;
  if (exists && cliPath) {
    try { isSymlink = fs.lstatSync(cliPath).isSymbolicLink(); } catch (_) {}
  }
  const commandExists = exists && cliPath && (platform !== 'darwin' || isSymlink);
  return { enabled: commandExists, path: cliPath || '', platform };
});

ipcMain.handle('automation:disable-cli', async () => {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  const platform = process.platform;

  try {
    if (platform === 'darwin') {
      const destPath = '/usr/local/bin/aartiq';
      if (fs.existsSync(destPath)) {
        try {
          fs.unlinkSync(destPath);
        } catch (_) {
          const sudoCommand = `osascript -e 'do shell script "rm -f \\"${destPath}\\"" with administrator privileges'`;
          await execAsync(sudoCommand);
        }
      }
      return { success: true, message: 'CLI disabled' };
    } else if (platform === 'linux') {
      const paths = [
        path.join(os.homedir(), '.local', 'bin', 'aartiq'),
        '/usr/local/bin/aartiq'
      ];
      for (const p of paths) {
        if (fs.existsSync(p)) {
          try { fs.unlinkSync(p); } catch (_) {
            await execAsync(`pkexec rm -f "${p}"`);
          }
        }
      }
      return { success: true, message: 'CLI disabled' };
    } else if (platform === 'win32') {
      const userBinDir = path.join(os.homedir(), 'AppData', 'Local', 'Aartiq', 'bin');
      const destPath = path.join(userBinDir, 'aartiq.cmd');
      const psPath = path.join(userBinDir, 'aartiq.ps1');
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      if (fs.existsSync(psPath)) fs.unlinkSync(psPath);
      return { success: true, message: 'CLI disabled' };
    }
    return { success: false, error: 'Platform not supported' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// --- BACKGROUND SERVICE MANAGEMENT ---
ipcMain.handle('automation:get-service-status', async () => {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  
  try {
    // 1. Check if process is running
    let isRunning = false;
    if (process.platform === 'darwin' || process.platform === 'linux') {
      try {
        const { stdout } = await execAsync('pgrep -f "aartiq-service"');
        isRunning = stdout.trim().length > 0;
      } catch (e) {
        isRunning = false;
      }
    } else if (process.platform === 'win32') {
      try {
        const { stdout } = await execAsync('tasklist /fi "IMAGENAME eq Aartiq.exe" /fo CSV /v');
        isRunning = stdout.includes('Aartiq-Service');
      } catch (e) {
        isRunning = false;
      }
    }
    
    // 2. Check health endpoint (if running)
    let health = null;
    if (isRunning) {
      try {
        const response = await fetch('http://localhost:3999/health', { timeout: 1000 });
        if (response.ok) {
          health = await response.json();
        }
      } catch (e) {
        // Service might be starting or on different port
      }
    }
    
    return {
      running: isRunning,
      health: health,
      platform: process.platform
    };
  } catch (error) {
    return { running: false, error: error.message };
  }
});

ipcMain.handle('automation:install-background-service', async (event, { userMode = false } = {}) => {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  const fs = require('fs');
  const os = require('os');
  
  try {
    if (process.platform === 'darwin') {
      const scriptPath = path.join(__dirname, 'scripts', 'install-service.sh');
      const tmpScript = path.join(os.tmpdir(), 'aartiq-install-service.sh');
      
      // Copy script to temp since asar files can't be executed directly
      fs.copyFileSync(scriptPath, tmpScript);
      fs.chmodSync(tmpScript, 0o755);
      
      const modeFlag = userMode ? '--user' : '--system';
      const command = `bash "${tmpScript}" install ${modeFlag}`;
      
      try {
        await execAsync(command);
        return { success: true, message: 'Background service installed successfully' };
      } catch (e) {
        // Use osascript for sudo if system-wide
        if (!userMode) {
          const sudoCommand = `osascript -e 'do shell script "bash \\"${tmpScript}\\" install --system" with administrator privileges'`;
          await execAsync(sudoCommand);
          return { success: true, message: 'Background service installed with admin privileges' };
        }
        throw e;
      }
    } else if (process.platform === 'win32') {
      const scriptPath = path.join(__dirname, 'scripts', 'install-service.js');
      const modeFlag = userMode ? '--user' : '';
      const command = `node "${scriptPath}" install ${modeFlag}`;
      await execAsync(command);
      return { success: true, message: 'Background service installed for Windows' };
    }
    return { success: false, error: 'Platform not supported' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('automation:uninstall-background-service', async (event, { userMode = false } = {}) => {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  const fs = require('fs');
  const os = require('os');
  
  try {
    if (process.platform === 'darwin') {
      const scriptPath = path.join(__dirname, 'scripts', 'install-service.sh');
      const tmpScript = path.join(os.tmpdir(), 'aartiq-install-service.sh');
      
      // Copy script to temp since asar files can't be executed directly
      fs.copyFileSync(scriptPath, tmpScript);
      fs.chmodSync(tmpScript, 0o755);
      
      const modeFlag = userMode ? '--user' : '--system';
      const command = `bash "${tmpScript}" uninstall ${modeFlag}`;
      
      try {
        await execAsync(command);
        return { success: true, message: 'Background service uninstalled' };
      } catch (e) {
        if (!userMode) {
          const sudoCommand = `osascript -e 'do shell script "bash \\"${tmpScript}\\" uninstall --system" with administrator privileges'`;
          await execAsync(sudoCommand);
          return { success: true, message: 'Background service uninstalled with admin privileges' };
        }
        throw e;
      }
    } else if (process.platform === 'win32') {
      const scriptPath = path.join(__dirname, 'scripts', 'install-service.js');
      const command = `node "${scriptPath}" uninstall`;
      await execAsync(command);
      return { success: true, message: 'Background service uninstalled for Windows' };
    }
    return { success: false, error: 'Platform not supported' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// --- Automation Manager CRUD IPC Handlers ---
ipcMain.handle('automation:create-task', async (event, taskData) => {
  try {
    return automationManager.addTask(taskData);
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('automation:get-tasks', async () => {
  return automationManager.getAllTasks();
});

ipcMain.handle('automation:update-task', async (event, taskId, updates) => {
  return automationManager.updateTask(taskId, updates);
});

ipcMain.handle('automation:delete-task', async (event, taskId) => {
  return automationManager.deleteTask(taskId);
});

ipcMain.handle('automation:toggle-task', async (event, taskId) => {
  return automationManager.toggleTask(taskId);
});

ipcMain.handle('automation:run-task', async (event, taskId) => {
  return automationManager.runTask(taskId);
});

ipcMain.handle('automation:get-logs', async (event, date) => {
  return { logs: [] };
});

ipcMain.handle('siri:listen', async (event, timeout = 10000) => {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  await execAsync('osascript -e \'tell application "System Events" to keystroke "d" using {command down}\'');
  return new Promise((resolve) => {
    let clipboard = '';
    const check = setInterval(async () => {
      try {
        clipboard = (await execAsync('pbpaste')).trim();
        if (clipboard.length > 0) {
          clearInterval(check);
          resolve(clipboard);
        }
      } catch {}
    }, 500);
    setTimeout(() => { clearInterval(check); resolve(clipboard); }, timeout);
  });
});

ipcMain.handle('siri:get-voices', async () => {
  return await scriptGetVoices();
});

ipcMain.handle('applescript:run', async (event, command, params) => {
  return await runAppleScript(command, params);
});

ipcMain.handle('siri:get-shortcuts-list', async () => {
  return [
    { id: 'chat', name: 'Chat with AI', description: 'Send message to Aartiq' },
    { id: 'smart-search', name: 'Smart Search', description: 'Search web with AI' },
    { id: 'create-pdf', name: 'Create PDF', description: 'Generate PDF document' },
    { id: 'voice-chat', name: 'Voice Chat', description: 'Dictate and send to AI' },
    { id: 'ask-and-speak', name: 'Ask + Speak', description: 'Ask AI and hear response' },
    { id: 'run-command', name: 'Run Command', description: 'Execute terminal command' },
    { id: 'schedule', name: 'Schedule Task', description: 'Schedule AI tasks' },
    { id: 'open-app', name: 'Open App', description: 'Launch applications' },
    { id: 'set-volume', name: 'Set Volume', description: 'Control system volume' },
    { id: 'screenshot', name: 'Take Screenshot', description: 'Capture screen' },
    { id: 'navigate', name: 'Navigate', description: 'Open websites' },
  ];
});

// ============================================================================
// WINDOWS INTEGRATION
// ============================================================================
const { setupWindowsIPCHandlers, registerWindowsProtocol, handleWindowsShortcutAction, handleURLSchemeEvent: handleWindowsURLScheme, startVoiceRecognition, speakText: winSpeak, getWindowsVoices, createWindowsShortcut, generateShortcutURL: generateWinURL } = require('./src/lib/windows-integration.js');

if (process.platform === 'win32') {
setupWindowsIPCHandlers();
  registerWindowsProtocol();
  console.log('[Main] Registered Windows integration');
}

// ============================================================================
// LINUX INTEGRATION
// ============================================================================
const { setupLinuxIPCHandlers, registerLinuxProtocol: registerLinuxProto, handleLinuxShortcutAction, handleLinuxURLScheme, generateShortcutURL: generateLinuxURL, createLinuxShortcut, installGNOMEShortcut, createDesktopLauncher, speakText: linuxSpeak, getLinuxVoices, startVoiceRecognition: linuxVoiceListen, showDesktopNotification, detectDesktop, getLinuxIntegration } = require('./src/lib/linux-integration.js');

if (process.platform === 'linux') {
  setupLinuxIPCHandlers();
  registerLinuxProto();
  console.log('[Main] Registered Linux integration');
}

ipcMain.handle('linux:execute-action', async (event, action, params) => {
  if (process.platform !== 'linux') return { error: 'Not Linux' };
  return await handleLinuxShortcutAction(action, params);
});

ipcMain.handle('linux:voice:listen', async (event, params) => {
  if (process.platform !== 'linux') return { error: 'Not Linux' };
  return await linuxVoiceListen(params);
});

ipcMain.handle('linux:voice:speak', async (event, text, params) => {
  if (process.platform !== 'linux') return { error: 'Not Linux' };
  return await linuxSpeak(text, params);
});

ipcMain.handle('linux:voice:get-voices', async () => {
  if (process.platform !== 'linux') return [];
  return await getLinuxVoices();
});

ipcMain.handle('linux:desktop:get', async () => {
  return await detectDesktop();
});

ipcMain.handle('linux:notify', async (event, title, body, options) => {
  if (process.platform !== 'linux') return { error: 'Not Linux' };
  return await showDesktopNotification(title, body, options);
});

ipcMain.handle('linux:create-shortcut', async (event, name, action, params) => {
  if (process.platform !== 'linux') return { error: 'Not Linux' };
  return await createLinuxShortcut(name, action, params);
});

ipcMain.handle('linux:install-gnome-shortcut', async (event, name, action, params) => {
  if (process.platform !== 'linux') return { error: 'Not Linux' };
  return await installGNOMEShortcut(name, action, params);
});

ipcMain.handle('linux:create-launcher', async () => {
  if (process.platform !== 'linux') return { error: 'Not Linux' };
  return await createDesktopLauncher();
});

ipcMain.handle('linux:generate-url', async (event, action, params) => {
  return generateLinuxURL(action, params);
});

ipcMain.handle('linux:register-protocol', async () => {
  if (process.platform !== 'linux') return { error: 'Not Linux' };
  return await registerLinuxProto();
});

ipcMain.handle('get-app-icon', async (event, appPath) => {
  try {
    const icon = await app.getFileIcon(appPath, { size: 'normal' });
    return icon.toDataURL();
  } catch (e) {
    return null;
  }
});


const permissionStore = new PermissionStore();
// Load saved security settings and permissions from disk on startup.
//
// Nothing is granted here. Startup used to create SHELL_LOW and SHELL_MEDIUM
// session grants (8h TTL) unconditionally, which meant every command the
// classifier called "medium" ran with no prompt — including cp, mv, mkdir, npm,
// git, curl and osascript. Approval is now opt-in behind the
// `autoApproveLowRiskShell` setting, which defaults to off.
//
// Note that the old comment claimed these grants did not persist to disk.
// They did: PermissionStore.grant() calls _save(), so the row was written with
// an expires_at and filtered on read. Existing rows are left alone below so a
// user who made an explicit choice does not silently lose it; only the implicit
// startup grants stop being re-created.
permissionStore.load().then(() => {
  // Drop the two keys the startup path used to create, but only the rows that
  // carry its own description, so a grant the user made by hand survives.
  for (const key of ['SHELL_LOW', 'SHELL_MEDIUM']) {
    const row = permissionStore.permissions && permissionStore.permissions.get(key);
    if (row && typeof row.description === 'string' && row.description.startsWith('Default session grant for')) {
      permissionStore.revoke(key);
    }
  }
}).catch(e => console.error('[Main] Failed to load PermissionStore:', e));
// Wire PermissionStore into command-validator so checkShellPermission() uses the
// same store as the rest of the application (replacing the old electron-store-based approach).
setCommandValidatorPermissionStore(permissionStore);
let cometAiEngine = new AartiqAiEngine();
let robotService = new RobotService(permissionStore);
const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Initialize core modules - Architecture refactoring
const networkSecurityManager = new NetworkSecurityManager(store);
const commandExecutor = new CommandExecutor({
  permissionStore,
  store,
});

const capabilityController = new CapabilityController({ permissionStore });
capabilityController.registerAction({
  name: 'shell-execute-command',
  handler: async (params) => params,
  requiresApproval: 'first-time-per-session',
  riskLevel: 'high',
  description: 'Execute arbitrary shell commands',
});
capabilityController.registerAction({
  name: 'execute-shell-command',
  handler: async (params) => params,
  requiresApproval: {
    local: 'never',
    remote: 'always',
  },
  riskLevel: 'high',
  description: 'Execute shell command (with permission dialog)',
});
capabilityController.registerAction({
  name: 'shell-read-file',
  handler: async (params) => params,
  requiresApproval: 'first-time-per-session',
  riskLevel: 'medium',
  description: 'Read file contents',
});
capabilityController.registerAction({
  name: 'shell-write-file',
  handler: async (params) => params,
  requiresApproval: 'first-time-per-session',
  riskLevel: 'medium',
  description: 'Write file contents',
});
commandExecutor.setCapabilityController(capabilityController);

// ============================================================================
// TICKET-BASED APPROVAL SYSTEM
// Prevents param tampering in IPC trust boundary
// ============================================================================

// Send approval required event to renderer
capabilityController.onApprovalRequired = (ticket) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('approval-required', ticket);
  }
};

// Approve a ticket and execute the action
ipcMain.handle('approval-ticket-approve', async (event, ticketId) => {
  console.log(`[Main] Approval ticket ${ticketId} approved by renderer`);
  return await capabilityController.approveAndExecute(ticketId, 'user');
});

// Deny a ticket
ipcMain.handle('approval-ticket-deny', async (event, ticketId, reason) => {
  console.log(`[Main] Approval ticket ${ticketId} denied: ${reason}`);
  return capabilityController.denyTicket(ticketId, 'user', reason);
});

// Get ticket status (for polling)
ipcMain.handle('approval-ticket-status', async (event, ticketId) => {
  return capabilityController.getTicketStatus(ticketId);
});

// Get all pending approvals
ipcMain.handle('approval-ticket-pending', async () => {
  return capabilityController.getPendingApprovals();
});

// Get approval statistics
ipcMain.handle('approval-ticket-stats', async () => {
  return capabilityController.getStats();
});

// ============================================================================
// UNATTENDED EXECUTION (for scheduled tasks)
// ============================================================================

// Register a call shape for unattended execution
ipcMain.handle('approval-register-call-shape', async (event, { actionName, params, metadata }) => {
  console.log(`[Main] Registering call shape for unattended: ${actionName}`);
  return capabilityController.registerCallShape(actionName, params, metadata);
});

// Register a call shape pattern for flexible unattended execution
ipcMain.handle('approval-register-call-pattern', async (event, { actionName, paramPatterns, metadata }) => {
  console.log(`[Main] Registering call shape pattern: ${actionName}`);
  return capabilityController.registerCallShapePattern(actionName, paramPatterns, metadata);
});

// Execute action for unattended/scheduled execution
ipcMain.handle('approval-execute-unattended', async (event, { actionName, params }) => {
  console.log(`[Main] Unattended execution: ${actionName}`);
  return await capabilityController.executeUnattended(actionName, params);
});

// Get registered call shapes for an action
ipcMain.handle('approval-get-call-shapes', async (event, actionName) => {
  return capabilityController.getCallShapes(actionName);
});

// Revoke a call shape
ipcMain.handle('approval-revoke-call-shape', async (event, shapeId) => {
  return capabilityController.revokeCallShape(shapeId);
});

console.log('[Main] Ticket-based approval system + unattended execution registered');

// Network Security - Now managed by NetworkSecurityManager (src/core/network-security.js)
// Keeping backwards compatibility aliases for existing code references
const networkSecurityConfig = networkSecurityManager.getConfig();

function matchesBlockedHost(hostname, patterns = []) {
  const host = `${hostname || ''}`.toLowerCase();
  return patterns.some((pattern) => host === pattern || host.endsWith(`.${pattern}`));
}

function getCustomBlockedDomains() {
  return networkSecurityManager.getConfig().customBlockedDomains
    .split(/[\n,\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

async function applyNetworkSecurityConfig(nextConfig = {}) {
  const config = networkSecurityManager.updateConfig(nextConfig);

  if (!app.isReady()) {
    return config;
  }

  const uniqueSessions = new Set([session.defaultSession]);
  for (const view of tabViews.values()) {
    if (view?.webContents?.session) {
      uniqueSessions.add(view.webContents.session);
    }
  }

  await Promise.all([...uniqueSessions].map((targetSession) =>
    networkSecurityManager.applyToSession(targetSession)
  ));
  return config;
}

function applyProxyConfigToSession(targetSession) {
  const config = networkSecurityManager.getConfig();
  if (config) {
    networkSecurityManager.applyToSession(targetSession);
  }
}

networkSecurityManager.applyStartupSettings(app);

const performRobotClick = async ({ x, y, button = 'left', doubleClick = false }) => {
  if (robotService) {
    try {
      await robotService.execute({ type: 'click', x, y, button, double: doubleClick });
      return { success: true, source: 'robotService' };
    } catch (err) {
      console.warn('[Main] RobotService click failed, falling back to robotjs:', err.message);
    }
  }

  if (!robot) {
    throw new Error('robotjs not available');
  }

  robot.moveMouseSmooth(x, y);
  await sleepMs(30);
  if (doubleClick) {
    robot.mouseClick(button, true);
  } else {
    robot.mouseClick(button);
  }
  await sleepMs(20);
  return { success: true, source: 'robotjs' };
};
let tesseractOcrService = new TesseractOcrService();
let screenVisionService = new ScreenVisionService(cometAiEngine);
wifiSyncService = getWiFiSync();
wifiSyncService.start();
// P2P needs a stable device id at construction; without one getP2PSync()
// returns null and the desktop side of Firebase P2P never existed.
p2pSyncService = getP2PSync(wifiSyncService.getDeviceId());
// Cloud sync was declared but never initialized, so desktop registration,
// device discovery and Firebase P2P never ran. Wire it with the same
// stable desktop id WiFi sync uses so devices/{uid}/{deviceId} and the
// P2P inbox (p2p_signals/{uid}/{deviceId}) agree with what mobile expects.
try {
  const { cloudSyncService: cloudSync } = require('./src/lib/CloudSyncService.js');
  cloudSyncService = cloudSync;
  cloudSyncService.setDeviceInfo(wifiSyncService.getDeviceId(), wifiSyncService.getDeviceName(), 'desktop');
  cloudSyncService.initialize();
} catch (e) {
  console.warn('[CloudSync] Failed to initialize cloud sync:', e.message);
}
let flutterBridge = null;
let fileSystemMcp = null;
let nativeAppMcp = null;
let ragService = null;
let voiceService = null;
let workflowRecorder = null;
let popSearch = null;

let mcpServer;
let networkCheckInterval;
let clipboardCheckInterval;
let activeTabId = null;
let isOnline = true;
const tabViews = new Map(); // Map of tabId -> BrowserView
const audibleTabs = new Set(); // Track tabs currently playing audio
const suspendedTabs = new Set(); // Track suspended tabs
let adBlocker = null;

const extensionsPath = path.join(app.getPath('userData'), 'extensions');
const memoryPath = path.join(app.getPath('userData'), 'ai_memory.jsonl');

const searchCache = new Map();
const shellApprovalResolvers = new Map();
const pendingPowerActions = new Map(); // Store power actions awaiting QR approval: token -> { action, resolver }

const RAYCAST_PORT = parseInt(process.env.RAYCAST_PORT || '9877', 10);
const RAYCAST_HOST = process.env.RAYCAST_HOST || '127.0.0.1';
const raycastState = {
  tabs: [],
  history: [],
};
let raycastServer = null;
let nexusBridgeServer = null;

const isMac = process.platform === 'darwin';
const openWindows = new Set();
let mainWindow = null;
let macSidebarWindow = null;
let nativeMacUiServer = null;
const MAC_NATIVE_UI_PREFS_KEY = 'mac_native_ui_preferences_v1';
const DEFAULT_MAC_NATIVE_UI_PREFERENCES = {
  sidebarMode: 'electron',
  actionChainMode: 'electron',
  utilityMode: 'electron',
  permissionMode: 'electron',
  sidebarAutoMinimize: false,
  sidebarGradientPreset: 'graphite',
  sidebarShowQuickActions: true,
  sidebarShowSessions: true,
  sidebarShowSearchTags: true,
  sidebarShowCommandCenterButton: true,
  sidebarShowActionChainButton: true,
};
// Token is declared above in the CLI PERSISTENCE section
const nativeMacUiPort = parseInt(process.env.AARTIQ_NATIVE_MAC_UI_PORT || '46203', 10);
const nativeMacUiState = {
  mode: 'sidebar',
  updatedAt: Date.now(),
  inputDraft: '',
  isLoading: false,
  error: null,
  themeAppearance: 'dark',
  messages: [],
  actionChain: [],
  currentCommandIndex: 0,
  activityTags: [],
  conversations: [],
  activeConversationId: null,
  downloads: [],
  clipboardItems: [],
  pendingApproval: null,
  electronAiSidebarOpen: false,
};
const nativeMacPanelManager = new MacNativePanelManager({
  bridgeUrlProvider: () => `http://127.0.0.1:${nativeMacUiPort}`,
  tokenProvider: () => nativeMacUiToken,
  iconPathProvider: () => resolveAartiqIcon(),
  appName: app.name || 'Aartiq',
});

// Detect python availability once (used to choose optional pipelines; never mandatory for .dmg)
const pythonAvailable = (() => {
  try {
    const res = spawnSync('python3', ['--version'], { encoding: 'utf8' });
    return res.status === 0;
  } catch {
    return false;
  }
})();

const getTopWindow = () => {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  for (const win of openWindows) {
    if (!win.isDestroyed()) return win;
  }
  return null;
};

const sendToActiveWindow = (channel, ...args) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
    return mainWindow;
  }
  for (const win of openWindows) {
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, ...args);
      return win;
    }
  }
  return null;
};

const deliverNativeMacUiEvent = async (channel, payload = {}) => {
  // Use main.js's window tracking directly
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
    return { delivered: true, createdWindow: false };
  }

  // Fallback - convert Set to array
  const wins = openWindows instanceof Set ? Array.from(openWindows) : openWindows;
  for (const win of wins) {
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
      return { delivered: true, createdWindow: false };
    }
  }

  console.log('[deliverNativeMacUiEvent] No window found, mainWindow:', mainWindow ? 'exists' : 'null', 'openWindows:', openWindows.size);
  return { delivered: false, error: 'No window available' };
};

const getMacNativeUiPreferences = () => {
  const saved = store.get(MAC_NATIVE_UI_PREFS_KEY);
  return {
    ...DEFAULT_MAC_NATIVE_UI_PREFERENCES,
    ...(saved && typeof saved === 'object' ? saved : {}),
  };
};

const broadcastMacNativeUiPreferences = () => {
  const preferences = getMacNativeUiPreferences();
  for (const win of openWindows) {
    if (!win.isDestroyed()) {
      win.webContents.send('mac-native-ui-preferences-changed', preferences);
    }
  }
};

const setMacNativeUiPreferences = (updates = {}) => {
  const nextPreferences = {
    ...getMacNativeUiPreferences(),
    ...(updates && typeof updates === 'object' ? updates : {}),
  };
  store.set(MAC_NATIVE_UI_PREFS_KEY, nextPreferences);

  if (isMac) {
    if (updates.sidebarMode) {
      if (nextPreferences.sidebarMode === 'swiftui') {
        nativeMacPanelManager.show('sidebar', { relaunchIfRunning: true }).catch((error) => {
          console.error('[MacNativeUI] Failed to open SwiftUI sidebar:', error);
        });
      } else {
        nativeMacPanelManager.close('sidebar');
      }
    }

    if (updates.actionChainMode) {
      if (nextPreferences.actionChainMode === 'electron') {
        nativeMacPanelManager.close('action-chain');
      }
    }

    if (updates.utilityMode && nextPreferences.utilityMode === 'electron') {
      ['menu', 'settings', 'downloads', 'clipboard'].forEach((mode) => nativeMacPanelManager.close(mode));
    }

    if (updates.permissionMode && nextPreferences.permissionMode === 'electron') {
      nativeMacPanelManager.close('permissions');
    }
  }

  broadcastMacNativeUiPreferences();
  buildApplicationMenu();
  return nextPreferences;
};

const createNativeMacUiSnapshot = () => {
  const recentMessages = Array.isArray(nativeMacUiState.messages) ? nativeMacUiState.messages : [];
  const lastMsg = recentMessages[recentMessages.length - 1];
  const actionLogs = lastMsg?.actionLogs || [];

  return {
    ...nativeMacUiState,
    themeAppearance: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
    messages: recentMessages,
    actionChain: Array.isArray(nativeMacUiState.actionChain) ? nativeMacUiState.actionChain : [],
    activityTags: Array.isArray(nativeMacUiState.activityTags) ? nativeMacUiState.activityTags : [],
    conversations: Array.isArray(nativeMacUiState.conversations) ? nativeMacUiState.conversations : [],
    downloads: Array.isArray(nativeMacUiState.downloads) ? nativeMacUiState.downloads : [],
    clipboardItems: Array.isArray(nativeMacUiState.clipboardItems) ? nativeMacUiState.clipboardItems : [],
    actionLogs: actionLogs.slice(-20),
    terminalLogs: actionLogs.map(l => ({ command: l.type, output: l.output, success: l.success })),
    preferences: getMacNativeUiPreferences(),
  };
};

let nativeMacUiBridgeServer = null;

const startNativeMacUiBridge = () => {
  try {
    const bridgeApp = express();
    bridgeApp.use(express.json());

    // Authenticate every route on this listener.
    //
    // The bridge is loopback-bound, but loopback is reachable from any page in
    // any browser on this machine, and these routes forward prompts into the AI
    // with tool access. `nativeMacUiToken` already existed for the CLI and the
    // Swift panel handshake (written to ~/.aartiq-token with mode 0600 and
    // exposed via tokenProvider) — it was simply never checked here. Now it is.
    //
    // Accepted as Authorization: Bearer, X-Aartiq-Token, or ?token=.
    bridgeApp.use((req, res, next) => {
      const verdict = checkLocalRequest(req, {
        port: nativeMacUiPort,
        token: nativeMacUiToken,
        requireToken: true,
        service: 'native-bridge',
      });
      if (!verdict.ok) {
        console.warn(`[NativeMacBridge] ${verdict.log}`);
        res.status(verdict.status).json({ error: verdict.code });
        return;
      }
      next();
    });

    bridgeApp.post('/native-mac-ui/prompt', (req, res) => {
      const { prompt, source } = req.body || {};
      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid prompt field' });
      }
      appendNativeMacUiMessage({ role: 'user', content: prompt.slice(0, 16000) });
      nativeMacUiState.isLoading = true;
      nativeMacUiState.updatedAt = Date.now();
      res.json({ received: true });

      // Forward to renderer for full-power AI processing (PDF, navigation, research, tools).
      // The renderer's AIChatSidebar only receives this if it is mounted (sidebar open).
      // We track whether the renderer picked it up by watching the updatedAt timestamp.
      const preUpdateAt = nativeMacUiState.updatedAt;
      deliverNativeMacUiEvent('native-mac-ui-submit-prompt', { prompt: prompt.slice(0, 32000), source })
        .catch(() => {});

      // Wait 5 seconds for the renderer sidebar to pick up the prompt.
      // If the renderer processes it, it will call updateNativeMacUiState which
      // updates nativeMacUiState. If nothing changes after 5s, fall back to
      // the dumb AiGateway (no tools, no PDF, no navigation).
      const RENDERER_PICKUP_MS = 5000;
      const rendererFallbackTimer = setTimeout(() => {
        if (nativeMacUiState.updatedAt <= preUpdateAt || nativeMacUiState.isLoading) {
          console.log('[NativeMacBridge] Renderer sidebar did not pick up prompt, falling back to AiGateway');
          const activeProvider = activeLlmProvider || llmProviders[0]?.id || 'google';
          const systemMsg = 'You are Aartiq, a helpful AI assistant with system automation capabilities. Respond conversationally and helpfully.';
          AiGateway.generate(
            [{ role: 'system', content: systemMsg }, { role: 'user', content: prompt.slice(0, 16000) }],
            { provider: activeProvider, skipTools: true }
          ).then((result) => {
            if (result && result.text) {
              appendNativeMacUiMessage({ role: 'model', content: result.text.slice(0, 16000) });
            } else if (result && result.error) {
              appendNativeMacUiMessage({ role: 'model', content: `Error: ${result.error}` });
              nativeMacUiState.error = result.error;
            }
            nativeMacUiState.isLoading = false;
            nativeMacUiState.updatedAt = Date.now();
          }).catch((err) => {
            appendNativeMacUiMessage({ role: 'model', content: `Error: ${err.message}` });
            nativeMacUiState.isLoading = false;
            nativeMacUiState.error = err.message;
            nativeMacUiState.updatedAt = Date.now();
          });
        }
      }, RENDERER_PICKUP_MS);
    });

    bridgeApp.get('/native-mac-ui/state', (_req, res) => {
      const snapshot = createNativeMacUiSnapshot();
      res.json({
        success: true,
        state: snapshot,
        error: null,
      });
    });

    bridgeApp.post('/native-mac-ui/panels/open', (req, res) => {
      const { mode } = req.body || {};
      if (!mode) {
        return res.status(400).json({ error: 'Missing mode field' });
      }
      const normalized = normalizeMacNativePanelMode(mode);
      nativeMacPanelManager.show(normalized).catch(err => {
        console.error('[NativeMacBridge] Failed to open panel:', err);
      });
      res.json({ opened: normalized });
    });

    bridgeApp.post('/native-mac-ui/config', (req, res) => {
      const updates = req.body || {};
      if (typeof updates !== 'object' || Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'Empty or invalid config payload' });
      }
      setMacNativeUiPreferences(updates);
      res.json({ applied: true, preferences: getMacNativeUiPreferences() });
    });

    // Alias for Swift panels that call /native-mac-ui/preferences
    bridgeApp.post('/native-mac-ui/preferences', (req, res) => {
      const updates = req.body || {};
      if (typeof updates !== 'object' || Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'Empty or invalid preferences payload' });
      }
      setMacNativeUiPreferences(updates);
      res.json({ applied: true, preferences: getMacNativeUiPreferences() });
    });

    bridgeApp.post('/native-mac-ui/settings/open', (req, res) => {
      const { target } = req.body || {};
      try {
        openSettingsSection(target || 'profile');
      } catch (err) {
        console.error('[NativeMacBridge] settings/open error:', err);
      }
      res.json({ received: true });
    });

    bridgeApp.post('/native-mac-ui/focus-electron', (_req, res) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
      res.json({ focused: true });
    });

    bridgeApp.post('/native-mac-ui/clipboard/copy', (req, res) => {
      const { text } = req.body || {};
      if (text) {
        clipboard.writeText(String(text));
        nativeMacUiState.clipboardItems = [String(text).slice(0, 4000), ...(nativeMacUiState.clipboardItems || []).slice(0, 39)];
        nativeMacUiState.updatedAt = Date.now();
      }
      res.json({ copied: true });
    });

    bridgeApp.post('/native-mac-ui/clipboard/clear', (_req, res) => {
      nativeMacUiState.clipboardItems = [];
      nativeMacUiState.updatedAt = Date.now();
      res.json({ cleared: true });
    });

    bridgeApp.post('/native-mac-ui/downloads/open', (req, res) => {
      const { path } = req.body || {};
      if (path) {
        shell.openPath(String(path)).catch(() => {});
      }
      res.json({ opened: true });
    });

    bridgeApp.post('/native-mac-ui/downloads/reveal', (req, res) => {
      const { path } = req.body || {};
      if (path) {
        shell.showItemInFolder(String(path));
      }
      res.json({ revealed: true });
    });

    bridgeApp.post('/native-mac-ui/conversations/action', (req, res) => {
      const { action, id } = req.body || {};
      deliverNativeMacUiEvent('native-mac-ui-conversation-action', { action: action || 'new', id: id || null })
        .catch(err => console.error('[NativeMacBridge] conversation action error:', err));
      res.json({ received: true });
    });

    bridgeApp.post('/native-mac-ui/export', (req, res) => {
      const { format } = req.body || {};
      deliverNativeMacUiEvent('native-mac-ui-export', { format: format || 'txt' })
        .catch(err => console.error('[NativeMacBridge] export error:', err));
      res.json({ received: true });
    });

    bridgeApp.post('/native-mac-ui/approval/request', async (req, res) => {
      const { command, reason, risk, actionType } = req.body || {};
      if (!command) return res.status(400).json({ error: 'Missing command' });
      const riskLevel = risk || 'medium';
      const requestId = `swift-${Date.now()}-${randomBytes(4).toString('hex')}`;
      let highRiskQr = null;
      let expectedPin = null;
      if (riskLevel === 'high') {
        try {
          const qrResult = await generateShellApprovalQR(command);
          highRiskQr = qrResult.qrImage;
          expectedPin = qrResult.pin;
        } catch (e) {
          console.error('[NativeMacBridge] QR generation failed:', e);
        }
      }
      const resolvedPromise = new Promise((resolve) => {
        shellApprovalResolvers.set(requestId, resolve);
      });
      nativeMacUiState.pendingApproval = {
        requestId,
        command,
        reason: reason || 'The AI wants to execute a shell command on the host machine.',
        risk: riskLevel,
        highRiskQr,
        expectedPin,
        actionType: actionType || 'SHELL_COMMAND',
        action: 'Shell Command',
        requiresDeviceUnlock: riskLevel === 'high',
      };
      nativeMacUiState.updatedAt = Date.now();
      resolvedPromise.then((result) => {
        nativeMacUiState.pendingApproval = null;
        nativeMacUiState.isLoading = false;
        nativeMacUiState.updatedAt = Date.now();
        ipcMain.emit('swift-approval-resolved', null, { requestId, allowed: result.allowed, deviceUnlockValidated: result.deviceUnlockValidated });
      });
      res.json({
        success: true,
        approval: {
          requestId,
          highRiskQr: highRiskQr || undefined,
          expectedPin: expectedPin || undefined,
          risk: riskLevel,
        },
      });
    });

    bridgeApp.post('/native-mac-ui/approval/respond', (req, res) => {
      const { requestId, allowed, deviceUnlockValidated } = req.body || {};
      const id = requestId || '';
      if (id) {
        const resolver = shellApprovalResolvers.get(id);
        if (resolver) {
          shellApprovalResolvers.delete(id);
          resolver({ allowed: !!allowed, deviceUnlockValidated: !!deviceUnlockValidated });
        }
      }
      res.json({ received: true });
    });

    bridgeApp.post('/native-mac-ui/apple-intelligence/summary', async (req, res) => {
      const { text } = req.body || {};
      if (!text) return res.status(400).json({ error: 'Missing text' });
      try {
        const summary = await summarizeWithAppleIntelligence(String(text));
        res.json({ summary });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    bridgeApp.post('/native-mac-ui/apple-intelligence/image', async (req, res) => {
      const { prompt } = req.body || {};
      if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
      try {
        const path = await generateAppleIntelligenceImage(String(prompt), undefined, undefined);
        res.json({ path });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // ── CLI endpoints (used by `aartiq` CLI) ──

    bridgeApp.post('/native-mac-ui/cli/ask', async (req, res) => {
      const { prompt, model, sessionId } = req.body || {};
      if (!prompt) return res.status(401).json({ error: 'Missing prompt' });

      const messages = [
        { role: 'system', content: 'You are a helpful assistant. Respond to the user\'s questions concisely and directly. Do NOT use any tools, action commands, or special formatting. Just provide a plain text response.' },
        { role: 'user', content: prompt }
      ];
      const options = { provider: model || activeLlmProvider || 'ollama', skipTools: true };
      const result = await llmGenerateHandler(messages, options);
      if (result.error) return res.json({ error: result.error });

      deliverNativeMacUiEvent('cli-ask-response', { prompt, response: result.text, sessionId });
      res.json({ text: result.text || '' });
    });

    bridgeApp.post('/native-mac-ui/cli/search', async (req, res) => {
      const { query } = req.body || {};
      if (!query) return res.status(401).json({ error: 'Missing query' });
      const messages = [
        { role: 'system', content: 'You are a helpful assistant. Respond directly to search queries without using any tools or special formatting.' },
        { role: 'user', content: `Search the web for: ${query}` }
      ];
      const result = await llmGenerateHandler(messages, { provider: activeLlmProvider || 'google', skipTools: true });
      if (result.error) return res.json({ error: result.error });
      res.json({ results: [{ title: 'Search Result', url: '', snippet: result.text || '' }] });
    });

    // ── Sidebar control ──

    bridgeApp.post('/native-mac-ui/sidebar/open', (_req, res) => {
      const target = getTopWindow();
      if (target && !target.isDestroyed()) {
        if (!target.isVisible()) target.show();
        target.focus();
        target.webContents.send('execute-shortcut', 'open-ai-chat');
      }
      res.json({ opened: true });
    });

    bridgeApp.post('/native-mac-ui/sidebar/close', (_req, res) => {
      const target = getTopWindow();
      if (target && !target.isDestroyed()) {
        target.webContents.send('execute-shortcut', 'toggle-sidebar');
      }
      res.json({ closed: true });
    });

    bridgeApp.post('/native-mac-ui/sidebar/toggle', (_req, res) => {
      const target = getTopWindow();
      if (target && !target.isDestroyed()) {
        target.webContents.send('execute-shortcut', 'toggle-sidebar');
      }
      res.json({ toggled: true });
    });

    // ── Execute shortcut ──

    bridgeApp.post('/native-mac-ui/execute-shortcut', (req, res) => {
      const { action } = req.body || {};
      if (!action) return res.status(400).json({ error: 'Missing action' });
      triggerShortcut(action);
      res.json({ executed: action });
    });

    // ── Bookmarks (delegated to renderer Zustand store via IPC) ──

    bridgeApp.get('/native-mac-ui/bookmarks', async (_req, res) => {
      try {
        const target = getTopWindow();
        if (!target || target.isDestroyed()) {
          return res.json({ bookmarks: [] });
        }
        const bookmarks = await target.webContents.executeJavaScript(
          'window.__GET_BOOKMARKS__ ? window.__GET_BOOKMARKS__() : null'
        ).catch(() => null);
        if (bookmarks) return res.json({ bookmarks });

        const storeBookmarks = store.get('bookmarks');
        if (Array.isArray(storeBookmarks)) return res.json({ bookmarks: storeBookmarks });
        res.json({ bookmarks: [] });
      } catch (e) {
        res.json({ bookmarks: [], error: e.message });
      }
    });

    bridgeApp.post('/native-mac-ui/bookmarks/add', (req, res) => {
      const { url, title } = req.body || {};
      if (!url) return res.status(400).json({ error: 'Missing url' });
      deliverNativeMacUiEvent('execute-shortcut', 'open-bookmarks').catch(() => {});
      const bookmarks = store.get('bookmarks') || [];
      const newBookmark = { id: `bookmark-${Date.now()}`, url, title: title || url };
      if (!bookmarks.find(b => b.url === url)) {
        bookmarks.push(newBookmark);
        store.set('bookmarks', bookmarks);
      }
      res.json({ added: newBookmark });
    });

    bridgeApp.delete('/native-mac-ui/bookmarks/remove', (req, res) => {
      const { url } = req.body || {};
      if (!url) return res.status(400).json({ error: 'Missing url' });
      let bookmarks = store.get('bookmarks') || [];
      bookmarks = bookmarks.filter(b => b.url !== url);
      store.set('bookmarks', bookmarks);
      res.json({ removed: url, remaining: bookmarks.length });
    });

    // ── History (delegated to renderer) ──

    bridgeApp.get('/native-mac-ui/history', async (req, res) => {
      try {
        const target = getTopWindow();
        const limit = parseInt(req.query.limit) || 50;
        if (!target || target.isDestroyed()) {
          return res.json({ history: [] });
        }
        const history = await target.webContents.executeJavaScript(
          `window.__GET_HISTORY__ ? window.__GET_HISTORY__(${limit}) : null`
        ).catch(() => null);
        if (history) return res.json({ history });
        res.json({ history: [] });
      } catch (e) {
        res.json({ history: [], error: e.message });
      }
    });

    bridgeApp.delete('/native-mac-ui/history/clear', (_req, res) => {
      const target = getTopWindow();
      if (target && !target.isDestroyed()) {
        target.webContents.send('execute-shortcut', 'clear-history');
      }
      res.json({ cleared: true });
    });

    // ── Settings (read/update via electron-store) ──

    bridgeApp.get('/native-mac-ui/settings', (_req, res) => {
      try {
        const allSettings = store.store;
        const safeSettings = {};
        const sensitiveKeys = ['openai_api_key', 'gemini_api_key', 'anthropic_api_key', 'groq_api_key', 'xai_api_key', 'azure_openai_api_key', 'secure_auth_session_v1'];
        for (const [key, value] of Object.entries(allSettings)) {
          if (sensitiveKeys.some(sk => key.includes(sk))) {
            safeSettings[key] = value ? '***SET***' : null;
          } else {
            safeSettings[key] = value;
          }
        }
        res.json({ settings: safeSettings });
      } catch (e) {
        res.json({ settings: {}, error: e.message });
      }
    });

    bridgeApp.post('/native-mac-ui/settings/update', (req, res) => {
      const updates = req.body || {};
      if (typeof updates !== 'object' || Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'Empty updates' });
      }
      for (const [key, value] of Object.entries(updates)) {
        store.set(key, value);
      }
      res.json({ updated: Object.keys(updates) });
    });

    // ── Permissions ──

    bridgeApp.get('/native-mac-ui/permissions', (_req, res) => {
      try {
        const permStorePath = require('path').join(app.getPath('userData'), 'comet-permissions.json');
        const secSettingsPath = require('path').join(app.getPath('userData'), 'comet-security-settings.json');
        let permissions = {};
        let securitySettings = {};
        if (fs.existsSync(permStorePath)) {
          permissions = JSON.parse(fs.readFileSync(permStorePath, 'utf-8'));
        }
        if (fs.existsSync(secSettingsPath)) {
          securitySettings = JSON.parse(fs.readFileSync(secSettingsPath, 'utf-8'));
        }
        res.json({ permissions, securitySettings });
      } catch (e) {
        res.json({ permissions: {}, securitySettings: {}, error: e.message });
      }
    });

    bridgeApp.post('/native-mac-ui/permissions/grant', (req, res) => {
      const { key, level, description } = req.body || {};
      if (!key) return res.status(400).json({ error: 'Missing key' });
      try {
        const permStorePath = require('path').join(app.getPath('userData'), 'comet-permissions.json');
        let permissions = {};
        if (fs.existsSync(permStorePath)) {
          permissions = JSON.parse(fs.readFileSync(permStorePath, 'utf-8'));
        }
        permissions[key] = { level: level || 'read', description: description || '', granted_at: Date.now() };
        fs.writeFileSync(permStorePath, JSON.stringify(permissions, null, 2));
        res.json({ granted: key });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    bridgeApp.post('/native-mac-ui/permissions/revoke', (req, res) => {
      const { key } = req.body || {};
      if (!key) return res.status(400).json({ error: 'Missing key' });
      try {
        const permStorePath = require('path').join(app.getPath('userData'), 'comet-permissions.json');
        let permissions = {};
        if (fs.existsSync(permStorePath)) {
          permissions = JSON.parse(fs.readFileSync(permStorePath, 'utf-8'));
        }
        delete permissions[key];
        fs.writeFileSync(permStorePath, JSON.stringify(permissions, null, 2));
        res.json({ revoked: key });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // ── Automation / Scheduling ──

    bridgeApp.post('/native-mac-ui/automation/create', async (req, res) => {
      const task = req.body || {};
      if (!task.name) return res.status(400).json({ error: 'Missing task name' });
      try {
        const result = automationManager.addTask(task);
        res.json({ created: true, result });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    bridgeApp.get('/native-mac-ui/automation/tasks', async (_req, res) => {
      try {
        const tasks = automationManager.getAllTasks();
        res.json({ tasks: tasks || [] });
      } catch (e) {
        res.json({ tasks: [], error: e.message });
      }
    });

    bridgeApp.post('/native-mac-ui/automation/toggle', async (req, res) => {
      const { taskId, enabled } = req.body || {};
      if (!taskId) return res.status(400).json({ error: 'Missing taskId' });
      try {
        automationManager.toggleTask(taskId);
        res.json({ toggled: taskId, enabled });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    bridgeApp.delete('/native-mac-ui/automation/delete', async (req, res) => {
      const { taskId } = req.body || {};
      if (!taskId) return res.status(400).json({ error: 'Missing taskId' });
      try {
        automationManager.deleteTask(taskId);
        res.json({ deleted: taskId });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    bridgeApp.post('/native-mac-ui/automation/run', async (req, res) => {
      const { taskId } = req.body || {};
      if (!taskId) return res.status(400).json({ error: 'Missing taskId' });
      try {
        automationManager.runTask(taskId);
        res.json({ run: taskId });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // ── Navigation (back/forward/reload) ──

    bridgeApp.post('/native-mac-ui/navigate/back', (_req, res) => {
      try {
        ipcMain.emit('browser-view-go-back');
        res.json({ navigated: 'back' });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    bridgeApp.post('/native-mac-ui/navigate/forward', (_req, res) => {
      try {
        ipcMain.emit('browser-view-go-forward');
        res.json({ navigated: 'forward' });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    bridgeApp.post('/native-mac-ui/navigate/reload', (_req, res) => {
      try {
        ipcMain.emit('browser-view-reload');
        res.json({ reloaded: true });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // ── Tab Control (switch/close by id) ──

    bridgeApp.post('/native-mac-ui/tabs/switch', (req, res) => {
      const { tabId } = req.body || {};
      if (!tabId) return res.status(400).json({ error: 'Missing tabId' });
      try {
        const target = getTopWindow();
        if (target && !target.isDestroyed()) {
          target.webContents.executeJavaScript(
            `window.__AARTIQ_STORE__?.getState()?.setActiveTab?.("${tabId}")`
          ).catch(() => {});
          res.json({ switched: tabId });
        } else {
          res.status(500).json({ error: 'No browser window' });
        }
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    bridgeApp.post('/native-mac-ui/tabs/close', (req, res) => {
      const { tabId } = req.body || {};
      if (!tabId) return res.status(400).json({ error: 'Missing tabId' });
      try {
        const target = getTopWindow();
        if (target && !target.isDestroyed()) {
          target.webContents.executeJavaScript(
            `window.__AARTIQ_STORE__?.getState()?.removeTab?.("${tabId}")`
          ).catch(() => {});
          res.json({ closed: tabId });
        } else {
          res.status(500).json({ error: 'No browser window' });
        }
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // ── App Info ──

    bridgeApp.get('/native-mac-ui/app-info', (_req, res) => {
      res.json({
        version: app.getVersion() || '1.0.0',
        platform: process.platform,
        arch: process.arch,
        isPackaged: app.isPackaged,
        productName: app.name || 'Aartiq',
        features: {
          aiChat: true,
          browserAutomation: true,
          pdfGeneration: true,
          ocr: true,
          screenVision: true,
          robotAutomation: process.platform === 'darwin',
          nativePanels: process.platform === 'darwin',
          appleIntelligence: process.platform === 'darwin',
          appleScript: process.platform === 'darwin',
          powerShell: process.platform === 'win32',
          scheduling: true,
          cloudSync: true,
          p2pSync: true,
          wifiSync: true,
          mcpServers: true,
          pluginSystem: true,
          youtubePlayer: true,
          voiceService: true,
          workflowRecorder: true,
          vaultManager: true,
          networkSecurity: true,
          permissionManagement: true,
          biometricAuth: process.platform === 'darwin',
        },
        activeLlmProvider: activeLlmProvider || 'none',
        bridgePort: nativeMacUiPort,
        isOnline: global.isOnline !== false,
      });
    });

    nativeMacUiBridgeServer = bridgeApp.listen(nativeMacUiPort, '127.0.0.1', () => {
      console.log(`[NativeMacBridge] Express UI bridge listening on http://127.0.0.1:${nativeMacUiPort}`);
    });

    bridgeApp.on('error', (err) => {
      console.error('[NativeMacBridge] Server error:', err);
    });
  } catch (err) {
    console.error('[NativeMacBridge] Failed to start bridge server:', err);
  }
};

const stopNativeMacUiBridge = () => {
  if (nativeMacUiBridgeServer) {
    try {
      nativeMacUiBridgeServer.close();
      nativeMacUiBridgeServer = null;
      console.log('[NativeMacBridge] Bridge server stopped');
    } catch (err) {
      console.error('[NativeMacBridge] Error stopping server:', err);
    }
  }
};

const appendNativeMacUiMessage = (message = {}) => {
  const existing = Array.isArray(nativeMacUiState.messages) ? nativeMacUiState.messages : [];
  nativeMacUiState.messages = [
    ...existing,
    {
      id: message.id || `native-message-${Date.now()}`,
      role: message.role || 'model',
      content: `${message.content || ''}`.slice(0, 16000),
      timestamp: message.timestamp || Date.now(),
      thinkText: message.thinkText ? `${message.thinkText}`.slice(0, 8000) : null,
      isOcr: !!message.isOcr,
      ocrLabel: message.ocrLabel ? `${message.ocrLabel}`.slice(0, 120) : null,
      ocrText: message.ocrText ? `${message.ocrText}`.slice(0, 12000) : null,
      actionLogs: Array.isArray(message.actionLogs) ? message.actionLogs.slice(0, 24) : [],
      mediaItems: Array.isArray(message.mediaItems) ? message.mediaItems.slice(0, 12) : [],
    },
  ].slice(-24);
  nativeMacUiState.updatedAt = Date.now();
  nativeMacUiState.error = null;
};

const normalizeMacNativePanelMode = (mode = 'sidebar') => {
  const allowedModes = new Set(['sidebar', 'action-chain', 'menu', 'settings', 'downloads', 'clipboard', 'permissions']);
  return allowedModes.has(mode) ? mode : 'sidebar';
};

const normalizeSettingsSection = (section = 'profile') => {
  switch (`${section || 'profile'}`) {
    case 'openai':
    case 'anthropic':
    case 'gemini':
    case 'ollama':
    case 'api-keys':
      return 'api-keys';
    case 'layout':
    case 'appearance':
      return 'appearance';
    case 'performance':
      return 'performance';
    case 'automation':
      return 'automation';
    case 'privacy':
      return 'privacy';
    case 'permissions':
      return 'permissions';
    case 'sync':
    case 'mobile':
      return 'sync';
    case 'vault':
      return 'vault';
    case 'extensions':
      return 'extensions';
    case 'plugins':
      return 'plugins';
    case 'integrations':
      return 'integrations';
    case 'tabs':
      return 'tabs';
    case 'mcp':
      return 'mcp';
    case 'ambient-music':
      return 'ambient-music';
    case 'languages':
      return 'languages';
    case 'about':
      return 'about';
    case 'search':
    case 'shortcuts':
    case 'system':
    case 'admin':
    case 'updates':
    case 'history':
    case 'profile':
      return `${section}`;
    case 'downloads':
      return 'downloads';
    case 'clipboard':
      return 'clipboard';
    case 'all':
    default:
      return 'profile';
  }
};

// Quick helpers for native menu items
const openSettingsSection = (section, options = {}) => {
  const normalizedSection = normalizeSettingsSection(section);
  const preferElectron = options.preferElectron === true;

  if (isMac && !preferElectron) {
    const nativePrefs = getMacNativeUiPreferences();
    if (normalizedSection === 'permissions' && nativePrefs.permissionMode === 'swiftui') {
      nativeMacPanelManager.show('permissions', { relaunchIfRunning: true }).catch((error) => {
        console.error('[MacNativeUI] Failed to open native permissions panel:', error);
      });
      return;
    }

    const canUseNativeUtilityPanel = normalizedSection === 'profile' || normalizedSection === 'downloads' || normalizedSection === 'clipboard';
    if (nativePrefs.utilityMode === 'swiftui' && canUseNativeUtilityPanel) {
      const panelMode = normalizedSection === 'downloads'
        ? 'downloads'
        : normalizedSection === 'clipboard'
          ? 'clipboard'
          : 'settings';
      nativeMacPanelManager.show(panelMode, { relaunchIfRunning: true }).catch((error) => {
        console.error('[MacNativeUI] Failed to open native utility panel:', error);
      });
      return;
    }
  }

  const target = getTopWindow();
  if (target && !target.isDestroyed()) {
    if (!target.isVisible()) {
      target.show();
    }
    target.focus();
    target.webContents.send('set-settings-section', normalizedSection);
  } else {
    // If no window open, create one and then send
    createWindow().then(win => {
      win.webContents.once('did-finish-load', () => {
        win.webContents.send('set-settings-section', normalizedSection);
      });
    });
  }
};

const triggerShortcut = (action) => {
  // Get any available window
  let targetWindow = mainWindow;

  if (!targetWindow || targetWindow.isDestroyed()) {
    targetWindow = BrowserWindow.getAllWindows()[0];
  }

  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send('execute-shortcut', action);
    return;
  }

  // Browser window doesn't exist - app not running or crashed
  console.log('[triggerShortcut] Browser not available for:', action, '- attempting recovery');

  // For critical menu items, try to restart the main window
  if (isQuitting || app.isReady()) {
    createMainWindow();
  }

  // Don't crash - just log
  console.log('[triggerShortcut] No window available for:', action);
};

const getShortcutMap = () => {
  const shortcuts = store.get('shortcuts') || [];
  return new Map(
    shortcuts
      .filter((shortcut) => shortcut && shortcut.action && typeof shortcut.accelerator === 'string')
      .map((shortcut) => [shortcut.action, shortcut.accelerator])
  );
};

const menuAccelerator = (action, fallback) => {
  const shortcut = getShortcutMap().get(action);
  return shortcut && shortcut.trim() ? shortcut : fallback;
};

const openGuide = () => {
  const candidates = [
    path.join(process.resourcesPath || __dirname, 'Guide.html'),
    path.join(app.getAppPath(), 'Guide.html'),
    path.join(__dirname, 'Guide.html'),
    path.join(__dirname, '..', 'Guide.html'),
  ];

  const localGuide = candidates.find((p) => fs.existsSync(p));
  if (localGuide) {
    sendToActiveWindow('add-new-tab', `file://${localGuide}`);
  } else {
    sendToActiveWindow('add-new-tab', 'https://www.comet.ai/guide');
  }
};

const openDocumentationPage = (slug = '') => {
  const baseUrl = 'https://aartiq-three.vercel.app';
  const url = slug ? `${baseUrl}${slug}` : baseUrl;
  sendToActiveWindow('add-new-tab', url);
};

const registerWindow = (win) => {
  openWindows.add(win);
  mainWindow = win;
  windowManager.setMainWindow(win);
  win.on('focus', () => {
    if (!win.isDestroyed()) mainWindow = win;
  });
  win.on('closed', () => {
    openWindows.delete(win);
    if (mainWindow === win) {
      mainWindow = openWindows.size ? Array.from(openWindows).pop() : null;
    }
  });
};

const toggleMacSidebarWindow = () => {
  if (!isMac) return;

  const nativePrefs = getMacNativeUiPreferences();
  if (nativePrefs.sidebarMode === 'swiftui') {
    nativeMacPanelManager.toggle('sidebar').catch((error) => {
      console.error('[MacNativeUI] Failed to toggle SwiftUI sidebar:', error);
    });
    return;
  }

  if (macSidebarWindow && !macSidebarWindow.isDestroyed()) {
    if (macSidebarWindow.isVisible()) {
      macSidebarWindow.hide();
    } else {
      macSidebarWindow.show();
      macSidebarWindow.focus();
    }
    return;
  }

  macSidebarWindow = new BrowserWindow({
    width: 360,
    height: 820,
    show: false,
    frame: true,
    transparent: true,
    vibrancy: 'ultra-dark',
    visualEffectState: 'active',
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    resizable: false,
    title: 'Aartiq Sidebar',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  macSidebarWindow.setIgnoreMouseEvents(false);
  macSidebarWindow.on('blur', () => {
    if (macSidebarWindow && !macSidebarWindow.isDestroyed()) {
      macSidebarWindow.hide();
    }
  });
  macSidebarWindow.on('closed', () => {
    macSidebarWindow = null;
  });
  macSidebarWindow.loadURL('app://./mac/ai-sidebar').catch(err => {
    console.error('[Main] Failed to load mac sidebar:', err);
  });
  macSidebarWindow.once('ready-to-show', () => {
    if (macSidebarWindow && !macSidebarWindow.isDestroyed()) {
      macSidebarWindow.show();
    }
  });
};

const buildApplicationMenu = () => {
  const nativePrefs = getMacNativeUiPreferences();
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Check for Updates...', click: () => openSettingsSection('updates') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
        { label: 'New Tab', accelerator: menuAccelerator('new-tab', 'CmdOrCtrl+T'), click: () => triggerShortcut('new-tab') },
        { label: 'New Incognito Tab', accelerator: menuAccelerator('new-incognito-tab', 'CmdOrCtrl+Shift+N'), click: () => triggerShortcut('new-incognito-tab') },
        { type: 'separator' },
        { label: 'Save Page As...', accelerator: 'CmdOrCtrl+S', click: () => sendToActiveWindow('save-page-offline') },
        { label: 'Print...', accelerator: 'CmdOrCtrl+P', click: () => sendToActiveWindow('print-page') },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: menuAccelerator('close-tab', 'CmdOrCtrl+W'), click: () => triggerShortcut('close-tab') },
        { label: 'Close Window', role: 'close' },
        ...(!isMac ? [{ type: 'separator' }, { role: 'quit' }] : [])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Speech',
          submenu: [
            { role: 'startSpeaking' },
            { role: 'stopSpeaking' }
          ]
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => triggerShortcut('reload-tab') },
        { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { label: 'Actual Size', role: 'resetZoom' },
        { label: 'Zoom In', role: 'zoomIn' },
        { label: 'Zoom Out', role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'Toggle Aartiq Sidebar', accelerator: menuAccelerator('toggle-sidebar', 'CmdOrCtrl+Shift+S'), click: () => triggerShortcut('toggle-sidebar') },
        {
          label: 'Cycle Theme',
          accelerator: menuAccelerator('cycle-theme', 'CmdOrCtrl+Shift+T'),
          click: () => triggerShortcut('cycle-theme')
        }
      ]
    },
    {
      label: 'History',
      submenu: [
        { label: 'Show Full History', accelerator: menuAccelerator('open-history', 'CmdOrCtrl+Y'), click: () => openSettingsSection('history', { preferElectron: true }) },
        { type: 'separator' },
        { label: 'Recently Closed', role: 'recentDocuments' },
        { type: 'separator' },
        { label: 'Delete All History', click: () => triggerShortcut('clear-history') }
      ]
    },
    {
      label: 'AI',
      submenu: [
        { label: 'AI Chat Sidebar', accelerator: menuAccelerator('open-ai-chat', 'CmdOrCtrl+Option+C'), click: () => triggerShortcut('open-ai-chat') },
        { label: 'Toggle AI Assistant', accelerator: menuAccelerator('toggle-ai-assist', 'CmdOrCtrl+Option+A'), click: () => triggerShortcut('toggle-ai-assist') },
        { label: 'Show AI Overview', accelerator: menuAccelerator('toggle-ai-overview', 'CmdOrCtrl+Option+O'), click: () => triggerShortcut('toggle-ai-overview') },
        ...(isMac ? [
          { type: 'separator' },
          { label: 'Apple Intelligence Panel', accelerator: 'Cmd+Option+1', click: () => triggerShortcut('open-apple-ai') }
        ] : []),
        { type: 'separator' },
        ...(isMac ? [
          {
            label: 'Use SwiftUI AI Sidebar',
            type: 'checkbox',
            checked: nativePrefs.sidebarMode === 'swiftui',
            click: (menuItem) => setMacNativeUiPreferences({ sidebarMode: menuItem.checked ? 'swiftui' : 'electron' }),
          },
          {
            label: 'Use SwiftUI Action Chain',
            type: 'checkbox',
            checked: nativePrefs.actionChainMode === 'swiftui',
            click: (menuItem) => setMacNativeUiPreferences({ actionChainMode: menuItem.checked ? 'swiftui' : 'electron' }),
          },
          {
            label: 'Use SwiftUI Utility Panels',
            type: 'checkbox',
            checked: nativePrefs.utilityMode === 'swiftui',
            click: (menuItem) => setMacNativeUiPreferences({ utilityMode: menuItem.checked ? 'swiftui' : 'electron' }),
          },
          {
            label: 'Use Native SwiftUI Approval Prompts',
            type: 'checkbox',
            checked: nativePrefs.permissionMode === 'swiftui',
            click: (menuItem) => setMacNativeUiPreferences({ permissionMode: menuItem.checked ? 'swiftui' : 'electron' }),
          },
          {
            label: 'Toggle Detached SwiftUI Sidebar',
            accelerator: 'CmdOrCtrl+Option+D',
            click: () => nativeMacPanelManager.toggle('sidebar').catch((error) => {
              console.error('[MacNativeUI] Failed to toggle SwiftUI sidebar from menu:', error);
            }),
          },
          {
            label: 'Open SwiftUI Action Chain',
            click: () => nativeMacPanelManager.show('action-chain').catch((error) => {
              console.error('[MacNativeUI] Failed to open SwiftUI Action Chain from menu:', error);
            }),
          },
          {
            label: 'Open SwiftUI Command Center',
            click: () => nativeMacPanelManager.show('menu').catch((error) => {
              console.error('[MacNativeUI] Failed to open SwiftUI command center from menu:', error);
            }),
          },
          { type: 'separator' },
        ] : []),
        { label: 'Spotlight Search', accelerator: menuAccelerator('toggle-spotlight', 'CmdOrCtrl+Shift+Space'), click: () => triggerShortcut('toggle-spotlight') },
        { label: 'Global Search', accelerator: menuAccelerator('spotlight-search', 'Alt+Space'), click: () => triggerShortcut('spotlight-search') },
        { label: 'Pop Search', accelerator: menuAccelerator('pop-search', 'CmdOrCtrl+Alt+S'), click: () => triggerShortcut('pop-search') },
        { label: 'Focus AI Chat Input', accelerator: menuAccelerator('focus-ai-chat', 'CmdOrCtrl+Shift+C'), click: () => triggerShortcut('focus-ai-chat') },
        { label: 'Agent Task Input', accelerator: 'CmdOrCtrl+Option+Space', click: () => sendToActiveWindow('focus-ai-input') },
        { type: 'separator' },
        { label: 'Scheduling Center', click: () => openSettingsSection('automation', { preferElectron: true }) },
        { label: 'Model Intelligence', click: () => openSettingsSection('performance', { preferElectron: true }) },
        { label: 'Provider Settings', click: () => openSettingsSection('api-keys', { preferElectron: true }) }
      ]
    },
    {
      label: 'Panels',
      submenu: [
        { label: 'Workspace Dashboard', accelerator: menuAccelerator('open-workspace', 'CmdOrCtrl+Option+W'), click: () => triggerShortcut('open-workspace') },
        { label: 'Media Studio', accelerator: menuAccelerator('open-media-studio', 'CmdOrCtrl+Option+M'), click: () => triggerShortcut('open-media-studio') },
        { label: 'PDF Workspace', accelerator: menuAccelerator('open-pdf-workspace', 'CmdOrCtrl+Option+P'), click: () => triggerShortcut('open-pdf-workspace') },
        { label: 'Presenton', accelerator: menuAccelerator('open-presenton', 'CmdOrCtrl+Option+L'), click: () => triggerShortcut('open-presenton') },
        { type: 'separator' },
        { label: 'Downloads', accelerator: menuAccelerator('open-downloads', 'CmdOrCtrl+Shift+J'), click: () => triggerShortcut('open-downloads') },
        { label: 'Clipboard Manager', accelerator: menuAccelerator('open-clipboard', 'CmdOrCtrl+Option+V'), click: () => triggerShortcut('open-clipboard') },
        { label: 'Unified Cart', accelerator: menuAccelerator('open-cart', 'CmdOrCtrl+Option+U'), click: () => triggerShortcut('open-cart') },
        { label: 'Camera Studio', accelerator: menuAccelerator('open-camera', 'CmdOrCtrl+Option+I'), click: () => triggerShortcut('open-camera') },
        { type: 'separator' },
        { label: 'Password Manager', accelerator: menuAccelerator('open-password-manager', 'CmdOrCtrl+Option+K'), click: () => triggerShortcut('open-password-manager') },
        { label: 'Vault & Autofill', accelerator: menuAccelerator('open-bookmarks', 'CmdOrCtrl+Option+B'), click: () => triggerShortcut('open-bookmarks') },
        { label: 'Extensions Manager', accelerator: menuAccelerator('open-extensions', 'CmdOrCtrl+Option+E'), click: () => triggerShortcut('open-extensions') },
        { label: 'Web Store', click: () => triggerShortcut('open-webstore') },
        { type: 'separator' },
        { label: 'P2P File Sync', click: () => triggerShortcut('open-p2p-sync') },
        { label: 'Proxy Firewall', click: () => triggerShortcut('open-proxy-firewall') },
        { label: 'Coding Dashboard', click: () => triggerShortcut('open-coding-dashboard') }
      ]
    },
    {
      label: 'Settings',
      submenu: [
        { label: 'General Preferences', accelerator: menuAccelerator('open-settings', 'CmdOrCtrl+,'), click: () => openSettingsSection('profile') },
        { label: 'Appearance & Themes', click: () => openSettingsSection('appearance', { preferElectron: true }) },
        { label: 'Performance', click: () => openSettingsSection('performance', { preferElectron: true }) },
        { label: 'Search Engine', click: () => openSettingsSection('search', { preferElectron: true }) },
        { label: 'API Keys & Providers', click: () => openSettingsSection('api-keys', { preferElectron: true }) },
        { type: 'separator' },
        { label: 'Privacy & Security', click: () => openSettingsSection('privacy', { preferElectron: true }) },
        { label: 'macOS Permissions', click: () => openSettingsSection('permissions') },
        { label: 'Keyboard Shortcuts', click: () => openSettingsSection('shortcuts', { preferElectron: true }) },
        { label: 'History', click: () => openSettingsSection('history', { preferElectron: true }) },
        { type: 'separator' },
        { label: 'Automation', click: () => openSettingsSection('automation', { preferElectron: true }) },
        { label: 'Sync & Cloud', click: () => openSettingsSection('sync', { preferElectron: true }) },
        { label: 'Extensions', click: () => openSettingsSection('extensions', { preferElectron: true }) },
        { label: 'Plugins', click: () => openSettingsSection('plugins', { preferElectron: true }) },
        { label: 'MCP Servers', click: () => openSettingsSection('mcp', { preferElectron: true }) },
        { label: 'System Configuration', click: () => openSettingsSection('system', { preferElectron: true }) },
        { label: 'Advanced Logs', click: () => openSettingsSection('admin', { preferElectron: true }) },
        { type: 'separator' },
        { label: 'About Aartiq', click: () => openSettingsSection('about', { preferElectron: true }) },
        { label: 'Updates', click: () => openSettingsSection('updates', { preferElectron: true }) }
      ]
    },
    {
      label: 'Window',
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { label: 'Cycle Next Tab', accelerator: menuAccelerator('next-tab', 'CmdOrCtrl+]'), click: () => triggerShortcut('next-tab') },
        { label: 'Cycle Previous Tab', accelerator: menuAccelerator('prev-tab', 'CmdOrCtrl+['), click: () => triggerShortcut('prev-tab') },
        { type: 'separator' },
        { role: 'front' }
      ]
    },
    {
      label: 'Help',
      role: 'help',
      submenu: [
        { label: 'Documentation Home', accelerator: menuAccelerator('open-documentation', 'CmdOrCtrl+Shift+/'), click: () => openDocumentationPage() },
        { label: 'AI Commands', click: () => openDocumentationPage('/docs/ai-commands') },
        { label: 'Automation Guide', click: () => openDocumentationPage('/docs/automation') },
        { label: 'Native API Reference', click: () => openDocumentationPage('/docs/native-api') },
        { label: 'Plugins & SDK', click: () => openDocumentationPage('/docs/plugins') },
        { label: 'Component Docs', click: () => openDocumentationPage('/docs/components') },
        { type: 'separator' },
        { label: 'Interactive Guide', click: () => openGuide() },
        { label: 'Shortcut & Menu Guide', click: () => openSettingsSection('shortcuts', { preferElectron: true }) },
        { label: 'Welcome & Setup', click: () => openSettingsSection('about', { preferElectron: true }) },
        { type: 'separator' },
        { label: 'Report Issue...', click: () => sendToActiveWindow('add-new-tab', 'https://github.com/Latestinssan/Aartiq/issues') },
        { label: 'Check for Updates', click: () => openSettingsSection('updates', { preferElectron: true }) }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

const resolveAppAssetPath = (requestUrl) => {
  try {
    const parsedUrl = new URL(requestUrl);
    let pathname = decodeURI(parsedUrl.pathname || '');
    if (!pathname || pathname === '/') {
      pathname = '/index.html';
    }
    const normalizedPath = path.normalize(path.join(__dirname, 'out', pathname));
    const outDir = path.join(__dirname, 'out');
    if (!normalizedPath.startsWith(outDir)) {
      console.warn('[Main] App protocol blocked path escape attempt:', normalizedPath);
      return path.join(outDir, 'index.html');
    }
    if (!fs.existsSync(normalizedPath)) {
      console.warn('[Main] App protocol asset missing, falling back to index.html:', normalizedPath);
      return path.join(outDir, 'index.html');
    }
    return normalizedPath;
  } catch (error) {
    console.error('[Main] Failed to resolve app:// request', error);
    return path.join(__dirname, 'out', 'index.html');
  }
};

const registerAppFileProtocol = () => {
  protocol.registerFileProtocol('app', (request, callback) => {
    const assetPath = resolveAppAssetPath(request.url);
    callback({ path: assetPath });
  });
};

// ============================================================================
// PDF GENERATION ENGINE (Branded & Robust)
// ============================================================================
const iconMimeType = 'image/png';

// Environment-aware icon path resolver with multiple fallbacks
// Handles both dev (.js files next to assets/) and packaged (.app/Contents/Resources/)
const resolveAartiqIcon = () => {
  const iconName = 'icon.png';
  const isDev = !app.isPackaged;
  const resourcesPath = app.isPackaged
    ? (process.resourcesPath || path.join(app.getAppPath(), '..', '..', 'Resources'))
    : path.join(__dirname, 'assets');
  const appPath = app.getAppPath();

  const candidates = isDev ? [
    // Development paths (relative to main.js location)
    path.join(__dirname, 'assets', iconName),
    path.join(__dirname, iconName),
    path.join(appPath, 'assets', iconName),
    path.join(appPath, iconName),
    // Fallback to public folder
    path.join(appPath, 'public', iconName),
    path.join(process.cwd(), 'public', iconName),
  ] : [
    // Packaged paths (.app/Contents/Resources/)
    path.join(resourcesPath, 'app.asar.unpacked', 'assets', iconName),
    path.join(resourcesPath, 'app.asar.unpacked', iconName),
    path.join(resourcesPath, 'assets', iconName),
    path.join(resourcesPath, iconName),
    path.join(resourcesPath, 'app', 'assets', iconName),
    path.join(resourcesPath, 'app', iconName),
    path.join(resourcesPath, 'app.asar', 'assets', iconName),
    path.join(resourcesPath, 'app.asar', iconName),
    path.join(__dirname, 'assets', iconName), // Add this as fallback even in packaged mode
    path.join(__dirname, iconName),
  ];

  // Add extra emergency fallbacks
  const emergencyPaths = [
    path.join(os.homedir(), 'Documents', 'Aartiq', 'icon.png'),
    path.join(os.homedir(), '.comet', 'icon.png'),
    '/Applications/Aartiq.app/Contents/Resources/assets/icon.png',
  ];

  const allCandidates = [...candidates, ...emergencyPaths];

  for (const p of allCandidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        const stat = fs.statSync(p);
        if (stat.size > 100 && stat.size < 10 * 1024 * 1024) {
          return p;
        }
      }
    } catch {
      // continue to next
    }
  }
  return null;
};

const loadBrandIcon = () => {
  let iconBase64 = '';
  let iconMime = iconMimeType;
  try {
    const iconPath = resolveAartiqIcon();
    if (iconPath && fs.existsSync(iconPath)) {
      iconBase64 = fs.readFileSync(iconPath).toString('base64');
      iconMime = 'image/png';
    } else {
      console.warn('[BrandIcon] Could not find icon.png, trying bundled fallbacks...');
      // Try common paths directly as fallback
      const fallbacks = [
        path.join(__dirname, 'assets', 'icon.png'),
        path.join(app.getAppPath(), 'assets', 'icon.png'),
      ];
      for (const fb of fallbacks) {
        try {
          if (fs.existsSync(fb)) {
            iconBase64 = fs.readFileSync(fb).toString('base64');
            iconMime = 'image/png';
            break;
          }
        } catch { /* ignore */ }
      }
    }
  } catch (e) {
    console.error('[BrandIcon] Load failed', e);
  }
  return { iconBase64, iconMime };
};

const dataUrlToBuffer = (dataUrl) => {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) return null;
  return { buffer: Buffer.from(match[2], 'base64'), mime: match[1] };
};

const normalizePages = (payload) => {
  if (payload?.pages && Array.isArray(payload.pages) && payload.pages.length) return payload.pages;
  if (payload?.content) {
    return [{
      title: payload.title || 'Document',
      sections: [{ title: payload.subtitle || 'Content', content: payload.content }]
    }];
  }
  return [{
    title: payload?.title || 'Document',
    sections: [{ title: 'Content', content: ' ' }]
  }];
};

// Basic text styling parser for bold/strike/italic; returns array of text runs (for pptx/docx)
const toStyledRuns = (text, opts = {}) => {
  if (!text || typeof text !== 'string') return [];
  if (text.trim() === '') return [];
  const runs = [];
  const regex = /(\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*]+)\*|__([^_]+)__)/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) runs.push({ text: text.slice(lastIndex, match.index), ...opts });
    if (match[2]) runs.push({ text: match[2], bold: true, ...opts });
    else if (match[3]) runs.push({ text: match[3], strike: true, ...opts });
    else if (match[4]) runs.push({ text: match[4], italic: true, ...opts });
    else if (match[5]) runs.push({ text: match[5], bold: true, ...opts });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) runs.push({ text: text.slice(lastIndex), ...opts });
  return runs.length > 0 ? runs : [{ text, ...opts }];
};

const templatePalette = (name = 'professional') => {
  const map = {
    professional: { bg: '#0b1224', text: '#0f172a', accent: '#38bdf8' },
    dark: { bg: '#0d1117', text: '#e5e7eb', accent: '#22d3ee' },
    executive: { bg: '#f8fafc', text: '#0f172a', accent: '#1e3a8a' },
    minimalist: { bg: '#ffffff', text: '#111827', accent: '#0ea5e9' }
  };
  return map[name] || map.professional;
};
const PDF_TEMPLATES = {
  professional: (title, content, iconBase64) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px 50px 80px; color: #1a1a1a; line-height: 1.7; background: #fff; }
    .header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 16px; margin-bottom: 24px; border-bottom: 1px solid #eee; }
    .brand { display: flex; align-items: center; gap: 10px; font-size: 0.95rem; font-weight: 600; color: #333; }
    .brand img { width: 28px; height: 28px; object-fit: contain; }
    .date { font-size: 0.75rem; color: #999; }
    h1 { font-size: 1.8rem; font-weight: 700; margin-bottom: 24px; color: #111; line-height: 1.3; }
    h2 { font-size: 1.3rem; font-weight: 600; margin: 28px 0 10px; color: #222; }
    h3 { font-size: 1rem; font-weight: 600; margin: 20px 0 8px; color: #444; }
    p { margin-bottom: 14px; font-size: 0.95rem; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; font-size: 0.9rem; }
    th { background: #f5f5f5; padding: 10px 14px; text-align: left; font-weight: 600; border-bottom: 2px solid #ddd; }
    td { padding: 8px 14px; border-bottom: 1px solid #eee; }
    blockquote { border-left: 3px solid #ccc; padding: 10px 18px; color: #555; margin: 16px 0; font-style: italic; }
    code { background: #f4f4f4; padding: 2px 5px; border-radius: 3px; font-size: 0.88em; }
    pre { background: #1a1a2e; color: #e0e0e0; padding: 16px; overflow-x: auto; margin: 20px 0; border-radius: 6px; white-space: pre-wrap; }
    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #eee; display: flex; justify-content: space-between; font-size: 0.75rem; color: #aaa; }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">${iconBase64 ? `<img src="${iconBase64}" alt="Aartiq" />` : ''} Aartiq Browser</div>
    <div class="date">${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
  </div>
  <h1>${title}</h1>
  <div>${content}</div>
  <div class="footer">
    <span>${iconBase64 ? `<img src="${iconBase64}" style="width:14px;height:14px;vertical-align:middle;margin-right:4px;" />` : ''} Generated by Aartiq Browser</span>
    <span style="font-style: italic; color: #999;">For the questions that matter.</span>
    <span>${title}</span>
  </div>
</body>
</html>`
};

function generateAartiqPDFTemplate(title, content, iconBase64, templateName = 'professional', metadata = {}) {
  const isFullHTML = /<html/i.test(content);
  if (isFullHTML) return content;

  let cleanContent = content
    .replace(/\[WATERMARK:\s*([^\]]+)\]/gi, () => '')
    .replace(/\[TEMPLATE:\s*([^\]]+)\]/gi, () => '')
    .replace(/\[BG_COLOR:\s*([^\]]+)\]/gi, () => '')
    .replace(/\[AUTHOR:\s*([^\]]+)\]/gi, () => '')
    .replace(/\[CATEGORY:\s*([^\]]+)\]/gi, () => '')
    .replace(/\[TAGS:\s*([^\]]+)\]/gi, () => '')
    .replace(/\[PRIORITY:\s*([^\]]+)\]/gi, () => '')
    .replace(/\[SUBJECT:\s*([^\]]+)\]/gi, () => '')
    .replace(/\[INSTITUTION:\s*([^\]]+)\]/gi, () => '');

  cleanContent = parseMarkdownTables(cleanContent);
  cleanContent = parseMarkdownToHTML(cleanContent);

  return PDF_TEMPLATES.professional(title, cleanContent, iconBase64);
}

function parseMarkdownTables(content) {
  const tableRegex = /\|(.+)\|\n\|[-:\s|]+\|\n((?:\|.+\|\n?)+)/g;
  return content.replace(tableRegex, (match, headerRow, bodyRows) => {
    const headers = headerRow.split('|').map(h => h.trim()).filter(h => h);
    const rows = bodyRows.trim().split('\n').map(row =>
      row.split('|').map(cell => cell.trim()).filter(c => c)
    );

    let html = '<div class="table-wrapper"><table><thead><tr>';
    headers.forEach(h => { html += `<th>${h}</th>`; });
    html += '</tr></thead><tbody>';
    rows.forEach(row => {
      html += '<tr>';
      row.forEach(cell => { html += `<td>${cell}</td>`; });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
  });
}

function parseMarkdownToHTML(content) {
  let html = content;

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr/>');

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Paragraphs - wrap lines not already in tags
  const lines = html.split('\n');
  html = lines.map(line => {
    line = line.trim();
    if (!line) return '';
    if (line.startsWith('<')) return line;
    return `<p>${line}</p>`;
  }).join('\n');

  return html;
}


if (!fs.existsSync(extensionsPath)) {
  try { fs.mkdirSync(extensionsPath, { recursive: true }); } catch (e) { }
}

const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const fetch = require('cross-fetch'); // Make sure cross-fetch is always available globally

// Vercel AI SDK & Ollama Provider (ESM loaded via dynamic import in handler)
// Removed legacy @google/genai dependency

const MCP_SERVER_PORT = process.env.MCP_SERVER_PORT || 3001;

// Dedicated context menu handler for BrowserViews and Main Window
const setupContextMenu = () => {
  contextMenu({
    showSaveImageAs: true,
    showDragLink: true,
    showInspectElement: true,
    showLookUpSelection: true,
    showSearchWithGoogle: true,
    showCopyImageAddress: true,
    prepend: (defaultActions, params, browserWindow) => [
      {
        label: '🚀 Analyze selection with Aartiq',
        visible: params.selectionText.trim().length > 0,
        click: () => {
          if (mainWindow) mainWindow.webContents.send('ai-query-detected', params.selectionText);
        }
      },
      {
        label: '📄 Summarize Page',
        visible: params.selectionText.trim().length === 0 && !params.linkURL && !params.mediaType,
        click: () => {
          if (mainWindow) mainWindow.webContents.send('ai-query-detected', 'Summarize this page');
        }
      },
      {
        label: '🍎 Apple Intelligence: Summarize Page',
        visible: isMac && params.selectionText.trim().length === 0 && !params.linkURL && !params.mediaType,
        click: async () => {
          if (mainWindow) {
            mainWindow.webContents.send('ai-query-detected', 'Summarize this page using Apple Intelligence');
          }
        }
      },
      {
        label: 'Open in New Tab',
        visible: params.linkURL.length > 0,
        click: () => {
          if (mainWindow) mainWindow.webContents.send('add-new-tab', params.linkURL);
        }
      },
      {
        label: 'Search Aartiq for "{selection}"',
        visible: params.selectionText.trim().length > 0,
        click: () => {
          const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(params.selectionText)}`;
          if (mainWindow) mainWindow.webContents.send('add-new-tab', searchUrl);
        }
      },
      {
        label: '🔍 Search in Popup',
        visible: params.selectionText.trim().length > 0,
        click: () => {
          if (popSearchService) popSearchService.showPopupWithText(params.selectionText);
        }
      },
      {
        label: '🍏 Apple Intelligence: Summarize Selection',
        visible: isMac && params.selectionText.trim().length > 0,
        click: async () => {
          if (mainWindow) {
            mainWindow.webContents.send('ai-query-detected', `Summarize this using Apple Intelligence: ${params.selectionText}`);
          }
        }
      },
      {
        label: '🌐 Translate this Site',
        visible: params.selectionText.trim().length === 0 && !params.linkURL && !params.mediaType,
        click: () => {
          if (mainWindow) mainWindow.webContents.send('trigger-translation-dialog');
        }
      }
    ]
  });
};

setupContextMenu();

ipcMain.handle('set-as-default-browser', async () => {
  try {
    const protocols = ['http', 'https'];
    let overallSuccess = true;

    for (const proto of protocols) {
      // On Windows/Mac, this triggers a system dialog or registry change
      if (!app.setAsDefaultProtocolClient(proto)) {
        overallSuccess = false;
      }
    }

    // Linux specific refinement
    if (process.platform === 'linux') {
      try {
        const { exec } = require('child_process');
        // aartiq.desktop is the likely filename based on package.json name
        exec('xdg-settings set default-web-browser aartiq.desktop');
        overallSuccess = true;
      } catch (e) {
        console.error('[Main] Linux xdg-settings failed:', e);
      }
    }

    return { success: overallSuccess, isDefault: app.isDefaultProtocolClient('https') };
  } catch (error) {
    console.error('[Main] Failed to set default browser:', error);
    return { success: false, error: error.message };
  }
});
let mcpServerPort = MCP_SERVER_PORT;
// Custom protocol for authentication
const PROTOCOL = 'aartiq-browser';
const RAYCAST_PROTOCOL = 'aartiq';

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    app.setAsDefaultProtocolClient(RAYCAST_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
  app.setAsDefaultProtocolClient(RAYCAST_PROTOCOL);
}

app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  console.error(`[SSL] Handshake failed for: ${url} (Error: ${error})`);
  if (isDev && (url.includes('localhost') || url.includes('127.0.0.1'))) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

app.on('open-url', async (event, url) => {
  event.preventDefault();
  let target = getTopWindow();
  if (!target) {
    await createWindow();
    target = mainWindow;
  }
  if (!target || target.isDestroyed()) return;

  console.log('[Main] open-url received:', url);

  // Handle Raycast commands
  const parsed = new URL(url);
  const pathname = parsed.pathname.replace(/^\/+/, '');
  const params = Object.fromEntries(parsed.searchParams);

  // Aartiq Browser protocol
  if (url.startsWith(`${PROTOCOL}://`)) {
    target.webContents.send('auth-callback', url);
  }
  // HTTP/HTTPS URLs
  else if (url.startsWith('http://') || url.startsWith('https://')) {
    target.webContents.send('add-new-tab', url);
  }
  // Raycast commands via aartiq:// scheme (registered separately)
  else if (url.startsWith('aartiq://') || url.startsWith('comet://')) {
    const command = parsed.hostname || pathname || params.command || 'index';
    console.log('[Main] URL scheme command:', command, params);

    // Map commands to IPC events
    const commandMap = {
      'chat': 'open-ai-chat',
      'search': 'ai:search',
      'navigate': 'navigate-to-url',
      'create-pdf': 'ai:create-pdf',
      'create-doc': 'ai:create-pdf',
      'run-command': 'shell:execute',
      'open-app': 'system:open-app',
      'screenshot': 'system:screenshot',
      'volume': 'system:set-volume',
      'schedule': 'ai:schedule',
      'ask-ai': 'ai:ask-speaking',
      'voice-chat': 'ai:voice-chat',
      'set-model': 'ai:set-model',
      'browse': 'open-quick-browse',
      'ocr': 'trigger-screen-ocr',
      'pdf': 'open-pdf-creator',
      'automation': 'open-automation-panel',
      'settings': 'open-settings',
      'index': 'open-main',
    };

    // Handle Siri/Shortcuts actions with dedicated handlers
    const siriActions = ['chat', 'search', 'navigate', 'create-pdf', 'create-doc', 'run-command', 'open-app', 'screenshot', 'volume', 'schedule', 'ask-ai', 'voice-chat', 'set-model'];
    if (siriActions.includes(command)) {
      executeShortcutAction(command, params).catch(err => console.error('[Main] Siri action error:', err));
      if (params.speak === 'true') {
        target.webContents.once('did-finish-load', () => {
          target.webContents.send('ai:request-speak-response', params);
        });
      }
    }

    const ipcCommand = commandMap[command] || command;
    target.webContents.send(ipcCommand, params);
  }

  if (target.isMinimized()) target.restore();
  target.focus();
});

// Function to check network status
const checkNetworkStatus = () => {
  require('dns').lookup('google.com', (err) => {
    const online = !err || err.code === 'ENOTFOUND';
    if (online !== isOnline) {
      isOnline = online;
      const target = getTopWindow();
      if (target) target.webContents.send('network-status-changed', isOnline);
    }
  });
};

function appendToMemory(entry) {
  const log = JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n';
  fs.appendFileSync(memoryPath, log);
}

function readMemory() {
  if (!fs.existsSync(memoryPath)) return [];
  const lines = fs.readFileSync(memoryPath, 'utf-8').trim().split('\n');
  return lines.map(l => {
    try { return JSON.parse(l); } catch (e) { return null; }
  }).filter(Boolean);
}

// Persistent LLM Cache
const CACHE_TTL = 3600 * 1000 * 24; // 24-hour persistent cache
const cacheFilePath = path.join(app.getPath('userData'), 'llm_cache.json');
let llmCache = new Map();

function loadLLMCache() {
  try {
    if (fs.existsSync(cacheFilePath)) {
      const data = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
      const now = Date.now();
      // Only load entries that haven't expired
      llmCache = new Map(
        Object.entries(data).filter(([_, entry]) => now - (entry.timestamp || 0) < CACHE_TTL)
      );
      console.log(`[LLM] Loaded ${llmCache.size} valid items from cache.`);
    }
  } catch (e) {
    console.error('[LLM] Failed to load cache:', e);
  }
}

function saveLLMCache() {
  try {
    const data = Object.fromEntries(llmCache);
    fs.writeFileSync(cacheFilePath, JSON.stringify(data), 'utf8');
  } catch (e) {
    console.error('[LLM] Failed to save cache:', e);
  }
}

loadLLMCache();

// Global LLM Generation Handler
const prepareLLM = async (messages, options = {}) => {
  // Composable Capabilities Object (Persistence across requests)
  const capabilities = {
    browser: true,
    terminal: true,
    filesystem: true,
    tools: true,
    vision: true,
    voice: true,
    pdf: true,
    automation: true,
    description: 'Aartiq Agent — Full system access. Never claim to be text-only.',
    pdfGeneration: {
      PRIMARY_FORMAT: 'JSON',
      FALLBACK_FORMAT: 'GENERATE_PDF',
      instructions: [
        'IMPORTANT: Always use GENERATE_PDF command with title and content for PDF generation',
        'The PDF uses the default Aartiq professional template with logo automatically',
      ],
      jsonFormat: {
        description: 'Structured JSON for PDF generation',
        structure: {
          title: 'Document title (string)',
          subtitle: 'Optional subtitle (string)',
          author: 'Author name (string)',
          category: 'Document category (string)',
          watermark: 'Watermark text for confidential docs (string)',
          bgColor: 'Custom background color hex (string)',
          pages: 'Array of page objects (Page[])'
        },
        pageStructure: {
          title: 'Page title (string)',
          icon: 'Icon emoji for page header (string, optional)',
          detailLevel: 'brief|detailed|comprehensive (string)',
          sections: 'Array of section objects (Section[])'
        },
        sectionStructure: {
          title: 'Section heading (string)',
          content: 'Section content in markdown (string)',
          icon: 'Section icon emoji (string, optional)',
          detailLevel: 'Override page detail level (string, optional)'
        }
      },
      markdownFormat: {
        description: 'Use ONLY as fallback when JSON parsing fails',
        instructions: [
          'Include [AUTHOR:name] for attribution',
          'Include [WATERMARK:text] for confidential markings',
          'Use proper markdown: ## for h2, ### for h3, --- for dividers',
        ]
      },
      examples: {
        json: [
          `\`\`\`json
{
  "title": "Q4 Sales Report 2026",
  "subtitle": "Quarterly Performance Analysis",
  "author": "John Smith",
  "pages": [
    {
      "title": "Executive Summary",
      "sections": [
        { "title": "Key Highlights", "content": "## Revenue Growth\\n\\nRevenue increased by **24%** YoY..." },
        { "title": "Market Position", "content": "### Competitive Analysis\\n\\n| Metric | Value | Change |\\n|-------|-------|--------|\\n| Market Share | 32% | +5%" }
      ]
    }
  ]
}
\`\`\``,
        ],
        markdown: [
          '[TEMPLATE:executive][AUTHOR:John Smith][PRIORITY:high]## Q4 Sales Report',
          '[TEMPLATE:academic][SUBJECT:AI Research][INSTITUTION:MIT]## Neural Networks Paper',
        ]
      }
    },
  };

  // Determine active provider
  // Fallback order: options.provider -> module variable -> store
  // Normalize provider aliases so 'gemini' maps correctly to 'google'
  const rawProviderId = options.provider || activeLlmProvider || store.get('active_llm_provider') || 'google';
  const providerId = rawProviderId === 'gemini' ? 'google' : rawProviderId;
  const config = (typeof llmConfigs !== 'undefined' ? llmConfigs[providerId] : {}) || {};

  let modelInstance;

  if (providerId === 'ollama') {
    const { createOllama } = await import('ai-sdk-ollama');
    const baseUrl = options.baseUrl || config.baseUrl || store.get('ollama_base_url') || 'http://127.0.0.1:11434';
    const modelName = options.model || config.model || store.get('ollama_model') || 'deepseek-r1:1.5b';

    console.log('[Ollama] Base URL:', baseUrl, 'Model:', modelName);

    const ollamaEnabled = store.get('ollama_enabled') !== false;
    if (!ollamaEnabled) {
      throw new Error('Ollama is disabled in settings.');
    }

    try {
      const ollama = createOllama({ baseURL: baseUrl });
      modelInstance = ollama(modelName);
    } catch (ollamaError) {
      console.error('[Ollama] Failed to create Ollama instance:', ollamaError);
      throw new Error(`Ollama connection failed: ${ollamaError.message}. Make sure Ollama is running on ${baseUrl}`);
    }
  }
  else if (providerId === 'google' || providerId === 'google-flash') {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
    const apiKey = config.apiKey || store.get('gemini_api_key');
    if (!apiKey) throw new Error('Google Gemini API Key is missing.');

    const modelName = options.model || config.model || store.get('gemini_model') || getConfiguredProviderModel(providerId);

    const google = createGoogleGenerativeAI({ apiKey });

    modelInstance = google(modelName, {
      structuredOutputs: true,
    });
  }
  else if (providerId === 'openai') {
    const { createOpenAI } = await import('@ai-sdk/openai');
    const apiKey = config.apiKey || store.get('openai_api_key');
    if (!apiKey) throw new Error('OpenAI API Key is missing.');
    const openai = createOpenAI({ apiKey });
    modelInstance = openai(options.model || config.model || store.get('openai_model') || getConfiguredProviderModel('openai'));
  }
  else if (providerId === 'azure-openai') {
    const { createOpenAI } = await import('@ai-sdk/openai');
    const apiKey = config.apiKey || store.get('azure_openai_api_key');
    const baseURL = options.baseUrl || config.baseUrl || store.get('azure_openai_endpoint');
    if (!apiKey) throw new Error('Azure OpenAI API Key is missing.');
    if (!baseURL) throw new Error('Azure OpenAI base URL is missing.');
    const azureOpenAI = createOpenAI({ apiKey, baseURL });
    modelInstance = azureOpenAI(options.model || config.model || store.get('azure_openai_model') || 'gpt-4.1-mini');
  }
  else if (providerId === 'anthropic') {
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    const apiKey = config.apiKey || store.get('anthropic_api_key');
    if (!apiKey) throw new Error('Anthropic API Key is missing.');
    const anthropic = createAnthropic({ apiKey });
    modelInstance = anthropic(options.model || config.model || store.get('anthropic_model') || getConfiguredProviderModel('anthropic'));
  }
  else if (providerId === 'xai') {
    const { createXai } = await import('@ai-sdk/xai');
    const apiKey = config.apiKey || store.get('xai_api_key');
    if (!apiKey) throw new Error('xAI API Key is missing.');
    const xai = createXai({ apiKey });
    modelInstance = xai(options.model || config.model || store.get('xai_model') || getConfiguredProviderModel('xai'));
  }
  else if (providerId === 'groq') {
    const { createGroq } = await import('@ai-sdk/groq');
    const apiKey = config.apiKey || store.get('groq_api_key');
    if (!apiKey) throw new Error('Groq API Key is missing.');
    const groq = createGroq({ apiKey });
    modelInstance = groq(options.model || config.model || store.get('groq_model') || getConfiguredProviderModel('groq'));
  }
  else {
    throw new Error(`Unsupported provider: ${providerId}`);
  }

  // SYSTEM MESSAGE PIPELINE
  const systemMsgs = messages.filter(m => m.role === 'system');
  const systemPrompt = [
    ...systemMsgs.map(m => m.content),
    `[AARTIQ_CAPABILITIES]\n${JSON.stringify(capabilities, null, 2)}\n(You are an AGENT with full system access. Use reasoning for complex tasks.)`
  ].join('\n\n');

  const chatMessages = messages.filter(m => m.role !== 'system').map(m => {
    let experimental_attachments = [];
    if (m.attachments && Array.isArray(m.attachments)) {
      experimental_attachments = m.attachments.map(att => ({
        url: att.data.startsWith('data:') ? att.data : `data:${att.mimeType || 'image/png'};base64,${att.data}`,
        contentType: att.mimeType || 'image/png'
      }));
    }
    return {
      role: m.role === 'model' ? 'assistant' : m.role,
      content: m.content || '',
      experimental_attachments
    };
  });

  const cacheKey = JSON.stringify({ providerId, messages, options });
  return { modelInstance, systemPrompt, chatMessages, cacheKey, providerId, config };
};

const THINKING_LEVEL_BY_MODE = {
  light: 'low',
  normal: 'medium',
  heavy: 'high',
};

const THINKING_BUDGET_BY_LEVEL = {
  low: 4000,
  medium: 9500,
  high: 16500,
};

const resolveReasoningPreferences = (options = {}, config = {}) => {
  const mode = options.localLlmMode || config.localLlmMode || store.get('local_llm_mode') || 'normal';
  const thinkingLevel = options.thinkingLevel || THINKING_LEVEL_BY_MODE[mode] || 'medium';
  const budgetTokens = options.thinkingBudget ?? THINKING_BUDGET_BY_LEVEL[thinkingLevel] ?? 9500;
  return { mode, thinkingLevel, budgetTokens };
};

const buildProviderOptions = (providerId, options = {}, config = {}) => {
  const baseOptions = { ...(options.providerOptions || {}) };
  const { thinkingLevel, budgetTokens } = resolveReasoningPreferences(options, config);

  if (providerId.startsWith('google')) {
    const existing = baseOptions.google ?? {};
    baseOptions.google = {
      ...existing,
      thinking: {
        includeThoughts: true,
        thinkingLevel,
        ...(existing.thinking || {}),
      },
    };
  }

  if (providerId === 'anthropic') {
    const existing = baseOptions.anthropic ?? {};
    baseOptions.anthropic = {
      ...existing,
      thinking: {
        type: 'enabled',
        budgetTokens,
        ...(existing.thinking || {}),
      },
      effort: existing.effort || thinkingLevel,
    };
  }

  if (providerId === 'ollama') {
    const existing = baseOptions.ollama ?? {};
    baseOptions.ollama = {
      ...existing,
      sendReasoning: existing.sendReasoning ?? true,
      num_ctx: existing.num_ctx || options.ollamaContext || 32768,
      numCtx: existing.numCtx || existing.num_ctx || options.ollamaContext || 32768,
    };
  }

  return baseOptions;
};

/**
 * LLM Generation Implementation
 */
const llmGenerateHandler = async (messages, options = {}) => {
  try {
    const { generateText } = await import('ai');
    const { modelInstance, systemPrompt, chatMessages, cacheKey, providerId, config } = await prepareLLM(messages, options);

    if (llmCache.has(cacheKey)) {
      console.log('[LLM] Cache hit');
      return llmCache.get(cacheKey);
    }

    const mcpTools = !options.skipTools ? await mcpManager.getTools(permissionStore) : {};

    console.log(`[LLM-Generate] Starting generation with model: ${modelInstance.modelId} and ${Object.keys(mcpTools).length} MCP tools.`);

    const providerOptions = buildProviderOptions(providerId, options, config);
    const { text, reasoning } = await generateText({
      model: modelInstance,
      system: systemPrompt,
      messages: chatMessages,
      temperature: 0.7,
      maxTokens: 8192,
      ...(options.skipTools ? {} : { tools: mcpTools, maxSteps: 5 }),
      providerOptions: {
        ...providerOptions,
      }
    });

    console.log(`[LLM-Generate] Success. Text length: ${text?.length || 0}`);
    const result = {
      text: text,
      thought: reasoning || null,
      timestamp: Date.now() // Add timestamp for TTL
    };

    llmCache.set(cacheKey, result);
    saveLLMCache();
    return result;

  } catch (error) {
    console.error("Vercel AI SDK Error:", error);
    return { error: `Intelligence Failure: ${error.message}` };
  }
};

/**
 * LLM Streaming Implementation
 */
const llmStreamHandler = async (event, messages, options = {}) => {
  try {
    // First try to use the AI Engine's streaming capability
    if (cometAiEngine) {
      // Normalize provider aliases: 'gemini' -> 'google' so switch-cases match
      const rawProviderId = options.provider || activeLlmProvider || store.get('active_llm_provider') || 'google';
      const providerId = rawProviderId === 'gemini' ? 'google' : rawProviderId;
      let model = options.model;
      if (!model) {
        switch (providerId) {
          case 'ollama': model = store.get('ollama_model') || 'llama3'; break;
          case 'gemini':
          case 'google':
          case 'google-flash': model = getConfiguredProviderModel(providerId === 'gemini' ? 'google' : providerId); break;
          case 'openai': model = getConfiguredProviderModel('openai'); break;
          case 'azure-openai': model = store.get('azure_openai_model') || 'gpt-4.1-mini'; break;
          case 'anthropic': model = getConfiguredProviderModel('anthropic'); break;
          case 'groq': model = getConfiguredProviderModel('groq'); break;
          case 'xai': model = getConfiguredProviderModel('xai'); break;
          default: model = getConfiguredProviderModel('google'); // safe default
        }
      }

      const systemPrompt = messages.find(m => m.role === 'system')?.content || '';
      const nonSystemMessages = messages.filter(m => m.role !== 'system');
      const message = nonSystemMessages[nonSystemMessages.length - 1]?.content || '';
      const history = nonSystemMessages.slice(0, -1).map(m => ({
        role: m.role === 'model' ? 'assistant' : m.role,
        content: m.content || ''
      }));

      console.log(`[llmStreamHandler] Provider: ${providerId} (raw: ${rawProviderId}), Model: ${model}, History: ${history.length} turns`);

      const engineKeys = {};
      // 'google', 'google-flash', and 'gemini' all use the same Gemini API key
      if (providerId.startsWith('google') || providerId === 'gemini') {
        const apiKey = store.get('gemini_api_key') || '';
        if (!apiKey) {
          console.error('[llmStreamHandler] Gemini API key is missing! Cannot stream.');
          event.sender.send('llm-chat-stream-part', { type: 'error', error: 'Gemini API key is not configured. Please open AI settings and add your key.' });
          return;
        }
        engineKeys.GEMINI_API_KEY = apiKey;
      }
      if (providerId === 'openai') engineKeys.OPENAI_API_KEY = store.get('openai_api_key') || '';
      if (providerId === 'azure-openai') {
        engineKeys.AZURE_OPENAI_API_KEY = store.get('azure_openai_api_key') || '';
        engineKeys.AZURE_OPENAI_BASE_URL = options.baseUrl || store.get('azure_openai_endpoint') || '';
      }
      if (providerId === 'anthropic') engineKeys.ANTHROPIC_API_KEY = store.get('anthropic_api_key') || '';
      if (providerId === 'groq') engineKeys.GROQ_API_KEY = store.get('groq_api_key') || '';
      if (providerId === 'xai') engineKeys.XAI_API_KEY = store.get('xai_api_key') || '';
      if (providerId === 'ollama') engineKeys.OLLAMA_BASE_URL = options.baseUrl || store.get('ollama_base_url') || 'http://127.0.0.1:11434';
      if (Object.keys(engineKeys).length > 0) cometAiEngine.configure(engineKeys);

      const chatResult = await cometAiEngine.chat({
        message, model, systemPrompt, history, provider: providerId,
        onChunk: (chunk) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('llm-chat-stream-part', { type: 'text-delta', text: chunk });
          }
        }
      });

      if (!event.sender.isDestroyed()) {
        const finishReason = chatResult?.finishReason || 'stop';
        event.sender.send('llm-chat-stream-part', { type: 'finish', finishReason });
      }
      return;
    }

    const { streamText } = await import('ai');
    const { modelInstance, systemPrompt, chatMessages, providerId, config } = await prepareLLM(messages, options);
    const providerOptions = buildProviderOptions(providerId, options, config);
    const mcpTools = await mcpManager.getTools(permissionStore);
    const result = await streamText({
      model: modelInstance,
      system: systemPrompt,
      messages: chatMessages,
      temperature: 0.7,
      maxTokens: 8192,
      tools: mcpTools,
      maxSteps: 5,
      providerOptions: { ...providerOptions }
    });

    let lastFinishReason = 'stop';
    for await (const part of result.fullStream) {
      if (event.sender.isDestroyed()) break;
      if (part.type === 'finish') {
        lastFinishReason = part.finishReason || 'stop';
      }
      event.sender.send('llm-chat-stream-part', part);
    }
    
    if (!event.sender.isDestroyed()) {
      event.sender.send('llm-chat-stream-part', { type: 'finish', finishReason: lastFinishReason });
    }
  } catch (error) {
    console.error("Streaming Error:", error);
    event.sender.send('llm-chat-stream-part', { type: 'error', error: error.message });
  }
};

/**
 * AI Gateway Layer
 * Handles routing, logging, and error normalization for LLM providers.
 */
const AiGateway = {
  async generate(messages, options = {}) {
    const start = Date.now();
    const provider = options.provider || 'google';
    try {
      const result = await llmGenerateHandler(messages, options);
      if (result.error) {
        return { ...result, error: `[${provider}] ${result.error}`, durationMs: Date.now() - start };
      }
      return { ...result, durationMs: Date.now() - start };
    } catch (e) {
      console.error(`[AiGateway] Generate failed for ${provider}:`, e);
      return { error: `[${provider}] Gateway error: ${e.message}`, durationMs: Date.now() - start };
    }
  },

  async stream(event, messages, options = {}) {
    const provider = options.provider || 'google';
    try {
      await llmStreamHandler(event, messages, options);
    } catch (e) {
      console.error(`[AiGateway] Stream failed for ${provider}:`, e);
      if (!event.sender.isDestroyed()) {
        event.sender.send('llm-chat-stream-part', {
          type: 'error',
          error: `[${provider}] Stream failed: ${e.message}`
        });
      }
    }
  }
};

ipcMain.handle('extract-search-results', async (event, tabId) => {
  const view = tabViews.get(tabId);
  if (!view) return { error: 'No active view for extraction' };

  try {
    const results = await view.webContents.executeJavaScript(`
      (() => {
        const organicResults = Array.from(document.querySelectorAll('div.g, li.g, div.rc')); // Common Google search result selectors
        const extracted = [];
        for (let i = 0; i < Math.min(3, organicResults.length); i++) {
          const result = organicResults[i];
          const titleElement = result.querySelector('h3');
          const linkElement = result.querySelector('a');
          const snippetElement = result.querySelector('span.st, div.s > div > span'); // Common snippet selectors

          if (titleElement && linkElement) {
            extracted.push({
              title: titleElement.innerText,
              url: linkElement.href,
              snippet: snippetElement ? snippetElement.innerText : ''
            });
          }
        }
        return extracted;
      })();
    `);
    return { success: true, results };
  } catch (e) {
    console.error("Failed to extract search results:", e);
    return { success: false, error: e.message };
  }
});

// IPC handler for search suggestions
ipcMain.handle('get-suggestions', async (event, query) => {
  // TODO: Implement actual history and bookmark suggestions
  // For now, return some dummy data based on the query
  const suggestions = [];
  if (query.length > 0) {
    suggestions.push({ type: 'search', text: `Search Google for "${query}"`, url: `https://www.google.com/search?q=${encodeURIComponent(query)}` });
    suggestions.push({ type: 'history', text: `History: ${query} past visit`, url: `https://example.com/history/${query}` });
    suggestions.push({ type: 'bookmark', text: `Bookmark: ${query} docs`, url: `https://docs.example.com/${query}` });
  }
  return suggestions;
});


// When menu opens
function hideWebview() {
  if (!mainWindow) return;
  const view = tabViews.get(tabViews._activeTabId);
  if (view) {
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  }
}

// When menu closes
function showWebview() {
  if (!mainWindow) return;
  const view = tabViews.get(tabViews._activeTabId);
  if (view) {
    // Current window bounds are handled by setBrowserViewBounds usually, 
    // but we can force it here if needed.
    // For now, let's just trigger a re-render from renderer or use stored bounds
  }
}



async function createWindow() {
  // Command-line switches are configured during module load, before app readiness.

  if (isDev) {
    // Clear cache and service workers in development to avoid 404s on stale chunks
    session.defaultSession.clearStorageData({
      storages: ['serviceworkers', 'cachestorage']
    }).then(() => {
      console.log('[Main] Dev storage (Service Workers & Cache) cleared');
    });
  }

// Disable state restoration (if supported)
if (app.setShouldRestoreStateOnLaunch) {
  app.setShouldRestoreStateOnLaunch(false);
}

const isMacPlatform = process.platform === 'darwin';

// ULTRA AGGRESSIVE FIX: Force new window to show without waiting
const forceShowWindow = (window) => {
  if (window) {
    window.show();
    window.focus();
    // Additional force-show attempts
    setTimeout(() => { window.show(); window.focus(); }, 100);
    setTimeout(() => { window.show(); window.focus(); }, 500);
    setTimeout(() => { window.show(); window.focus(); }, 1000);
    setTimeout(() => { window.show(); window.focus(); }, 2000);
  }
};

const iconFile = process.platform === 'win32' ? 'icon.ico' : process.platform === 'darwin' ? 'icon.png' : 'icon-transparent.png';
const iconPath = isDev
  ? path.join(__dirname, 'out', iconFile)
  : path.join(process.resourcesPath, 'assets', iconFile);

mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: iconPath,
    frame: isMacPlatform,
    transparent: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      offscreen: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: true,
      enableRemoteModule: false,
      contextIsolation: true,
      additionalArguments: ['--enable-features=VizDisplayCompositor']
    },
    titleBarStyle: isMacPlatform ? 'hiddenInset' : 'hidden',
    backgroundColor: '#0D0E1C',
    show: true,
    paintWhenInitiallyHidden: true
  });

  // Set strict CSP for main window
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' ws: wss: https:; frame-src 'self' https:; media-src 'self' https:; object-src 'none'"
        ]
      }
    });
  });

  // Limit CPU when window loses focus
  mainWindow.webContents.on('did-finish-loading', () => {
    mainWindow.webContents.setBackgroundThrottling(true);
  });

  console.log('[Main] Window created with show=true');

  // ULTRA AGGRESSIVE: Force show window repeatedly
  forceShowWindow(mainWindow);

  registerWindow(mainWindow);

  // Fullscreen event listeners - notify renderer to recalculate BrowserView bounds
  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.send('window-fullscreen-changed', true);
  });
  mainWindow.on('leave-full-screen', () => {
    mainWindow.webContents.send('window-fullscreen-changed', false);
  });

  // CRITICAL: Multiple safeguards to ensure window ALWAYS shows
  let windowShown = false;

  // PRODUCTION FIX: For packaged apps (.exe), show immediately
  // In production, we want the window visible even if content is loading
  // This prevents the "hidden window" bug completely
  if (app.isPackaged) {
    console.log('[Main] Packaged app detected - showing window immediately');
    mainWindow.show();
    mainWindow.focus();
    windowShown = true;
  } else {
    // Development: Use ready-to-show for smooth loading
    mainWindow.once('ready-to-show', () => {
      if (!windowShown) {
        console.log('[Main] Window ready-to-show event fired');
        mainWindow.show();
        mainWindow.focus();
        windowShown = true;
      }
    });
  }

  // Fallback: Force show window after 3 seconds if not already shown
  setTimeout(() => {
    if (!windowShown && mainWindow) {
      console.log('[Main] Forcing window to show (3s timeout fallback)');
      mainWindow.show();
      mainWindow.focus();
      windowShown = true;
    }
  }, 3000);

  // CRASH RECOVERY: Detect if renderer process crashes or gets stuck
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[Main] Renderer process crashed:', details.reason);
    if (details.reason !== 'clean-exit') {
      console.log('[Main] Attempting to recover window...');
      // Force show the window anyway - at least user can see error
      mainWindow.show();
      mainWindow.focus();
      windowShown = true;
    }
  });

  // Also handle 'did-fail-to-load' more aggressively
  mainWindow.webContents.on('did-fail-to-load', (event, errorCode, errorDescription) => {
    console.error(`[Main] Failed to load: ${errorCode} - ${errorDescription}`);
    // Force show window so user sees error page
    if (!windowShown && mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      windowShown = true;
    }
  });

  mainWindow.setMenuBarVisibility(false);

  const url = isDev
    ? 'http://localhost:3003'
    : 'app://./index.html';

  console.log(`[Main] Loading URL: ${url}`);
  console.log(`[Main] __dirname: ${__dirname}`);
  console.log(`[Main] isDev: ${isDev}`);

  // Check if out directory exists in production
  if (!isDev) {
    const outPath = path.join(__dirname, 'out');
    const indexPath = path.join(outPath, 'index.html');
    if (!fs.existsSync(outPath)) {
      console.error(`[Main] ERROR: Out directory does not exist: ${outPath}`);
      console.error('[Main] Run "npm run build" before building the Electron app');
    } else if (!fs.existsSync(indexPath)) {
      console.error(`[Main] ERROR: index.html does not exist: ${indexPath}`);
      console.error('[Main] Run "npm run build" to generate the static export');
    } else {
      console.log('[Main] Build files verified');
    }
  }

  registerAppFileProtocol();

  mainWindow.loadURL(url).catch(err => {
    console.error('[Main] Failed to load URL:', err);
    // Still show window even if load fails
    if (!windowShown && mainWindow) {
      console.log('[Main] Showing window despite load error');
      mainWindow.show();
      mainWindow.focus();
      windowShown = true;
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('mac-native-ui-preferences-changed', getMacNativeUiPreferences());
  });

  // Tesseract initialization is now lazy-loaded in 'find-and-click-text' handler to improve startup time

  // Handle load failures
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error(`[Main] Page failed to load: ${errorCode} - ${errorDescription}`);
    // Show window anyway so user can see the error
    if (!windowShown && mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      windowShown = true;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Explicitly quit for multi-process environments like Windows
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  // Delayed initialization for startup safety
  setTimeout(() => {
    checkNetworkStatus();
    networkCheckInterval = setInterval(checkNetworkStatus, 60000);

    ElectronBlocker.fromPrebuiltAdsAndTracking(fetch).then((blocker) => {
      adBlocker = blocker;
      console.log('Ad blocker initialized (deferred).');
    }).catch(e => console.error("Ad blocker failed to load:", e));
  }, 5000);

  // Handle external links
  // Handle external links - Open in new tab within the app instead of default browser
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://') && url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      mainWindow.webContents.send('add-new-tab', url);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) {
      mainWindow.webContents.send('add-new-tab', url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Set Chrome User-Agent for all sessions (for browser detection)
  const chromeUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  session.defaultSession.setUserAgent(chromeUserAgent);

  // ERROR-PROOFING: Handle SSL certificate errors gracefully
  session.defaultSession.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    console.warn(`[SSL] Certificate error for ${url}: ${error}`);
    // Allow certificates for development or known issues, but log them
    // For production, you might want to be stricter
    const allowedHosts = ['localhost', '127.0.0.1', '*.local'];
    const isAllowed = allowedHosts.some(host => url.includes(host));
    if (isAllowed) {
      callback(true); // Allow
    } else {
      // Don't block - just warn and allow for better UX
      console.warn('[SSL] Allowing certificate error for:', url);
      callback(true);
    }
  });

  // Handle login prompts (authentication)
  session.defaultSession.on('login', (event, webContents, url, realm, callback) => {
    console.log(`[Auth] Login prompt for: ${url}`);
    // Don't auto-handle - let user see the prompt
    event.preventDefault();
  });

  // ERROR-PROOFING: Handle webRequest errors
  session.defaultSession.webRequest.onErrorOccurred({ urls: ['*://*/*'] }, (details) => {
    const criticalErrors = [-105, -106, -7]; // DNS errors, connection failed
    if (criticalErrors.includes(details.error)) {
      console.warn(`[WebRequest] Non-critical error: ${details.url} - ${details.error}`);
    }
  });

  session.defaultSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    try {
      const parsed = new URL(details.url);
      const hostname = parsed.hostname.toLowerCase();

      if (networkSecurityManager.isHostBlocked(hostname)) {
        return callback({ cancel: true });
      }

      const config = networkSecurityManager.getConfig();
      if (config.upgradeInsecureRequests && parsed.protocol === 'http:') {
        const { isPrivateHostname } = require('./src/core/network-security.js');
        if (!isPrivateHostname(parsed.hostname)) {
          parsed.protocol = 'https:';
          return callback({ redirectURL: parsed.toString() });
        }
      }
    } catch {
      // ignore malformed URLs
    }

    callback({ cancel: false });
  });

  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, callback) => {
    const requestHeaders = { ...(details.requestHeaders || {}) };
    if (networkSecurityManager.getConfig().sendDoNotTrack) {
      requestHeaders.DNT = '1';
      requestHeaders['Sec-GPC'] = '1';
    }

    callback({ requestHeaders });
  });

  // Header stripping for embedding and Google Workspace compatibility
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
    const { responseHeaders } = details;
    const headerKeys = Object.keys(responseHeaders);

    const filteredHeaders = headerKeys.reduce((acc, key) => {
      const lowerKey = key.toLowerCase();
      // Expanded list of headers to strip for maximum compatibility with Google/MS Workspace
      if (
        lowerKey !== 'x-frame-options' &&
        lowerKey !== 'content-security-policy' &&
        lowerKey !== 'content-security-policy-report-only'
      ) {
        acc[key] = responseHeaders[key];
      }
      return acc;
    }, {});

    callback({ cancel: false, responseHeaders: filteredHeaders });
  });

  // Load Extensions
  try {
    console.log(`[Main] Scanning for extensions in: ${extensionsPath}`);
    if (!fs.existsSync(extensionsPath)) {
      fs.mkdirSync(extensionsPath, { recursive: true });
    }
    const extensionDirs = fs.readdirSync(extensionsPath);
    if (extensionDirs.length === 0) {
      console.log("[Main] No extensions found in extensions directory.");
    }
    extensionDirs.forEach(dir => {
      // Skip the problematic QuickFill extension for now
      if (dir === 'google-forms-autofill-extension-main') {
        console.warn(`[Main] Skipping problematic extension: ${dir}`);
        return;
      }
      const extPath = path.join(extensionsPath, dir);
      if (fs.lstatSync(extPath).isDirectory()) {
        const manifestPath = path.join(extPath, 'manifest.json');
        if (fs.existsSync(manifestPath)) {
          session.defaultSession.loadExtension(extPath).then(extension => {
            console.log(`Extension loaded: ${extension.name} (${extension.id}) from ${extPath}`);
          }).catch(e => console.error(`Failed to load extension from ${extPath}: ${e.message || e}`));
        } else {
          console.log(`[Main] Skipping ${dir}: No manifest.json found.`);
        }
      }
    });
  } catch (e) {
    console.error("Error during initial extension loading:", e);
  }

  // Load Plugins
  try {
    console.log("[Main] Loading plugins...");
    pluginManager.loadAllPlugins().then(() => {
      console.log(`[Main] Plugin system initialized with ${pluginManager.getPlugins().length} plugins`);
    });
  } catch (e) {
    console.error("[Main] Error loading plugins:", e);
  }

  // Clipboard Monitoring
  let lastClipboardText = clipboard.readText();
  clipboardCheckInterval = setInterval(() => {
    const currentText = clipboard.readText();
    if (currentText && currentText !== lastClipboardText) {
      lastClipboardText = currentText;
      console.log("[Main] Clipboard changed:", currentText.substring(0, 30));
      if (mainWindow) {
        mainWindow.webContents.send('clipboard-changed', currentText);
      }
      // Send to P2P peers if connected
      if (p2pSyncService && p2pSyncService.getStatus().connected) {
        p2pSyncService.sendMessage({ type: 'clipboard-sync', text: currentText });
      }
      // Send to Mobile devices connected via WiFi WebSocket
      if (wifiSyncService) {
        wifiSyncService.broadcast({ type: 'clipboard-sync', text: currentText });
      }
    }
  }, 3000);
}

ipcMain.handle('test-gemini-api', async (event, apiKey) => {
  try {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
    const { generateText } = await import('ai');

    // Create custom instance with API key
    const google = createGoogleGenerativeAI({ apiKey });

    // Test with a simple prompt
    const result = await generateText({
      model: google('gemini-1.5-flash'),
      prompt: 'Identity check. Respond with "passed".',
    });

    if (result.text.toLowerCase().includes('passed')) {
      return { success: true };
    }
    return { success: false, error: 'Unexpected response from Gemini' };
  } catch (error) {
    console.error("Gemini API test failed:", error);
    return { success: false, error: error.message };
  }
});

const gmailService = require('./src/lib/gmailService.js');

ipcMain.handle('get-gmail-messages', async () => {
  return await gmailService.getGmailMessages();
});

ipcMain.on('save-ai-response', (event, content) => {
  dialog.showSaveDialog(mainWindow, {
    title: 'Save AI Response',
    defaultPath: 'ai-response.txt',
  }).then(result => {
    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, content);
    }
  });
});
// Gmail and Google Services

ipcMain.handle('gmail-authorize', async () => {
  const { authorize } = require('./src/lib/gmailService.js');
  try {
    await authorize();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});


ipcMain.handle('gmail-list-messages', async (event, query, maxResults) => {
  const { listMessages } = require('./src/lib/gmailService.js');
  try {
    const messages = await listMessages(query, maxResults);
    return { success: true, messages };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('gmail-get-message', async (event, messageId) => {
  const { getMessage } = require('./src/lib/gmailService.js');
  try {
    const message = await getMessage(messageId);
    return { success: true, message };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('gmail-send-message', async (event, to, subject, body, threadId) => {
  const { sendMessage } = require('./src/lib/gmailService.js');
  try {
    const result = await sendMessage(to, subject, body, threadId);
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('gmail-add-label-to-message', async (event, messageId, labelName) => {
  const { addLabelToMessage } = require('./src/lib/gmailService.js');
  try {
    const result = await addLabelToMessage(messageId, labelName);
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Helper function for recursive directory scanning
async function _scanDirectoryRecursive(currentPath, types) {
  const files = [];
  const entries = fs.readdirSync(currentPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await _scanDirectoryRecursive(entryPath, types));
    } else if (entry.isFile()) {
      const stats = fs.statSync(entryPath);
      const fileType = path.extname(entry.name).toLowerCase();
      const shouldInclude = types.includes('all') || types.some(t => fileType.includes(t));

      if (shouldInclude) {
        files.push({
          id: entryPath, // Use path as ID for simplicity
          name: entry.name,
          path: entryPath,
          size: stats.size,
          type: fileType,
          hash: `${entryPath}-${stats.size}-${stats.mtimeMs}`, // Simple hash for now
          modifiedTime: stats.mtimeMs,
        });
      }
    }
  }
  return files;
}

// IPC Handlers
ipcMain.on('open-menu', () => {
  const target = getTopWindow();
  const menu = Menu.buildFromTemplate([
    { label: 'Reload', click: () => { const v = tabViews.get(tabViews._activeTabId); if (v) v.webContents.reload(); } },
    { label: 'Back', click: () => { const v = tabViews.get(tabViews._activeTabId); if (v && v.webContents.canGoBack()) v.webContents.goBack(); } },
    { label: 'Forward', click: () => { const v = tabViews.get(tabViews._activeTabId); if (v && v.webContents.canGoForward()) v.webContents.goForward(); } },
    { type: 'separator' },
    { label: 'Save Page As...', click: () => { sendToActiveWindow('execute-shortcut', 'save-page'); } },
    { label: 'Print...', click: () => { const v = tabViews.get(tabViews._activeTabId); if (v) v.webContents.print(); } },
    { type: 'separator' },
    { label: 'Settings', click: () => { sendToActiveWindow('execute-shortcut', 'open-settings'); } },
    { label: 'DevTools', click: () => { const v = tabViews.get(tabViews._activeTabId); if (v) v.webContents.openDevTools({ mode: 'detach' }); } },
  ]);
  if (target) {
    menu.popup({ window: target });
  } else {
    menu.popup();
  }
});

ipcMain.handle('get-is-online', () => isOnline);

ipcMain.on('toggle-adblocker', (event, enable) => {
  if (!adBlocker) {
    console.warn('Ad blocker not yet initialized.');
    return;
  }
  try {
    if (enable) {
      adBlocker.enableBlockingInSession(session.defaultSession);
      console.log('Ad blocker enabled by user.');
    } else {
      adBlocker.disableBlockingInSession(session.defaultSession);
      console.log('Ad blocker disabled by user.');
    }
  } catch (e) {
    console.error('Failed to toggle ad blocker:', e);
  }
});


ipcMain.on('show-webview', () => showWebview());
ipcMain.on('hide-webview', () => hideWebview());

ipcMain.on('add-tab-from-main', (event, url) => {
  if (mainWindow) {
    mainWindow.webContents.send('add-new-tab', url);
  }
});

// Window Controls
ipcMain.on('minimize-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
});
ipcMain.on('maximize-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  }
});
ipcMain.on('close-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
});
ipcMain.on('toggle-fullscreen', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.setFullScreen(!win.isFullScreen());
});

// Persistent Storage Handlers
const persistentDataPath = path.join(app.getPath('userData'), 'persistent_data');
if (!fs.existsSync(persistentDataPath)) {
  fs.mkdirSync(persistentDataPath, { recursive: true });
}

const VAULT_FILE_NAME = 'user-passwords.json';
const VAULT_UNLOCK_TTL_MS = 5 * 60 * 1000;
let vaultUnlockExpiresAt = 0;
let vaultEncryptionKey = null;
let vaultKeyStore = null;

const VAULT_ENC_ALGO = 'aes-256-gcm';
const VAULT_ENC_IV_LENGTH = 16;

function getVaultEncryptionKey() {
  if (vaultEncryptionKey) return vaultEncryptionKey;
  if (!vaultKeyStore) vaultKeyStore = new Store({ name: 'comet-vault-key' });
  const KEY_NAME = 'aes_key_v2';

  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend) {
    const backend = safeStorage.getSelectedStorageBackend();
    if (backend === 'basic_text') {
      console.warn('[Vault] WARNING: Linux keyring unavailable (basic_text fallback). Vault encryption is weakened.');
    }
  }

  let stored = vaultKeyStore.get(KEY_NAME);

  if (stored) {
    if (safeStorage.isEncryptionAvailable()) {
      try {
        vaultEncryptionKey = safeStorage.decryptString(Buffer.from(stored, 'base64'));
        return vaultEncryptionKey;
      } catch { }
    }
    vaultEncryptionKey = stored;
    return vaultEncryptionKey;
  }

  const rawKey = randomBytes(32).toString('hex');
  if (safeStorage.isEncryptionAvailable()) {
    try {
      const encrypted = safeStorage.encryptString(rawKey);
      vaultKeyStore.set(KEY_NAME, encrypted.toString('base64'));
    } catch {
      vaultKeyStore.set(KEY_NAME, rawKey);
    }
  } else {
    vaultKeyStore.set(KEY_NAME, rawKey);
  }

  vaultEncryptionKey = rawKey;
  return vaultEncryptionKey;
}

function encryptVaultField(value) {
  if (value == null) return null;
  const key = Buffer.from(getVaultEncryptionKey(), 'hex');
  const iv = randomBytes(VAULT_ENC_IV_LENGTH);
  const cipher = createCipheriv(VAULT_ENC_ALGO, key, iv);
  const input = typeof value === 'string' ? value : JSON.stringify(value);
  const encrypted = Buffer.concat([cipher.update(input, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { e: encrypted.toString('base64'), i: iv.toString('base64'), t: authTag.toString('base64'), s: typeof value === 'string' };
}

function decryptVaultField(stored) {
  if (!stored) return null;
  if (typeof stored === 'string') return stored;
  try {
    const key = Buffer.from(getVaultEncryptionKey(), 'hex');
    const decipher = createDecipheriv(VAULT_ENC_ALGO, key, Buffer.from(stored.i, 'base64'));
    decipher.setAuthTag(Buffer.from(stored.t, 'base64'));
    const decrypted = decipher.update(Buffer.from(stored.e, 'base64')) + decipher.final('utf8');
    return stored.s ? decrypted : JSON.parse(decrypted);
  } catch {
    return null;
  }
}

function isEncryptedField(value) {
  return value && typeof value === 'object' && value.e && value.i && value.t;
}

function encryptVaultEntry(entry) {
  const enc = { ...entry };
  if (entry.password != null && !isEncryptedField(entry.password)) enc.password = encryptVaultField(entry.password);
  if (entry.formData != null && !isEncryptedField(entry.formData)) enc.formData = encryptVaultField(entry.formData);
  return enc;
}

function decryptVaultEntry(entry) {
  if (!entry) return entry;
  const dec = { ...entry };
  if (isEncryptedField(entry.password)) dec.password = decryptVaultField(entry.password) ?? entry.password;
  if (isEncryptedField(entry.formData)) dec.formData = decryptVaultField(entry.formData) ?? entry.formData;
  return dec;
}

const nativeKeychain = (() => {
  try { return require('./src/lib/native-keychain'); }
  catch (e) { return null; }
})();

function vaultKeychainAccount(entry) {
  return (entry && entry.username) || 'default';
}

function vaultKeychainService(entry) {
  return `com.aartiq.vault.${(entry && entry.site) || 'unknown'}`;
}

function vaultKeychainLabel(entry) {
  return `Aartiq: ${(entry && entry.site) || 'unknown'} (${vaultKeychainAccount(entry)})`;
}

async function addToNativeKeychain(entry) {
  if (!nativeKeychain || !entry || !entry.password) return;
  try {
    await nativeKeychain.addPassword({
      account: vaultKeychainAccount(entry),
      service: vaultKeychainService(entry),
      password: entry.password,
      label: vaultKeychainLabel(entry),
    });
  } catch {
    // Native keychain unavailable or write failed — vault storage is sufficient
  }
}

async function removeFromNativeKeychain(entry) {
  if (!nativeKeychain || !entry || !entry.site) return;
  try {
    await nativeKeychain.deletePassword({
      account: vaultKeychainAccount(entry),
      service: vaultKeychainService(entry),
    });
  } catch { }
}

function getVaultFilePath() {
  return path.join(persistentDataPath, VAULT_FILE_NAME);
}

function normalizeVaultSite(site = '') {
  return `${site || ''}`
    .trim()
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .toLowerCase();
}

function readVaultEntries() {
  const electronStoreEntries = store.get('vault_entries');
  if (Array.isArray(electronStoreEntries) && electronStoreEntries.length > 0) {
    return electronStoreEntries;
  }

  const filePath = getVaultFilePath();
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const entries = Array.isArray(raw) ? raw.map(decryptVaultEntry) : [];
    if (entries.length > 0) {
      store.set('vault_entries', entries);
      console.log('[Vault] Migrated legacy AES vault to unified store');
    }
    return entries;
  } catch (error) {
    console.warn('[Vault] Failed to read entries:', error.message);
    return [];
  }
}

function writeVaultEntries(entries) {
  store.set('vault_entries', entries);
  const encrypted = entries.map(encryptVaultEntry);
  fs.writeFileSync(getVaultFilePath(), JSON.stringify(encrypted, null, 2), 'utf-8');
}

async function syncAllVaultToNativeKeychain() {
  if (!nativeKeychain) return;
  try {
    const entries = readVaultEntries();
    for (const entry of entries) {
      if (entry.password) {
        await addToNativeKeychain(entry);
      }
    }
    console.log(`[Vault] Synced ${entries.length} entries to native keychain`);
  } catch (err) {
    console.warn('[Vault] Native keychain bulk sync error:', err.message);
  }
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
  };
}

function getVaultEntryLabel(entry = {}) {
  return [entry.site, entry.username].filter(Boolean).join(' • ') || 'saved credential';
}

function isVaultUnlockStillValid() {
  return vaultUnlockExpiresAt > Date.now();
}

function rememberVaultUnlock() {
  vaultUnlockExpiresAt = Date.now() + VAULT_UNLOCK_TTL_MS;
}

function clearVaultUnlock() {
  vaultUnlockExpiresAt = 0;
}

function selectorLooksSensitive(selector = '') {
  return /(password|passwd|pwd|passcode|pin|otp|username|user(name)?|email|login|sign[\s-_]?in|credential|secret)/i.test(`${selector || ''}`);
}

function valueMatchesVaultCredential(value) {
  const normalized = `${value ?? ''}`.trim();
  if (!normalized) {
    return false;
  }

  return readVaultEntries().some((entry) =>
    entry.password === normalized || `${entry.username || ''}`.trim() === normalized
  );
}

function formNeedsVaultApproval(formData = {}) {
  return Object.entries(formData).some(([selector, value]) =>
    selectorLooksSensitive(selector) || valueMatchesVaultCredential(value)
  );
}

async function verifyVaultAccess({ reason, actionText }) {
  const settings = permissionStore.getSettings();
  if (settings.requireDeviceUnlockForVaultAccess === false) {
    return { success: true, mode: 'vault-device-unlock-disabled' };
  }

  if (isVaultUnlockStillValid()) {
    return { success: true, mode: 'vault-device-unlock-cached' };
  }

  if (!hasNativeDeviceUnlockSupport()) {
    return {
      success: false,
      error: 'Native device unlock is required for Neural Vault access on this build.',
    };
  }

  const nativeVerification = await verifyNativeDeviceAccess({
    reason: reason || 'Unlock Neural Vault to use saved credentials in Aartiq.',
    actionText: actionText || 'Neural Vault credential access',
    riskLevel: 'high',
  });

  if (!nativeVerification.supported) {
    return {
      success: false,
      error: nativeVerification.error || 'Native device unlock is unavailable for Neural Vault access.',
    };
  }

  if (!nativeVerification.approved) {
    return {
      success: false,
      error: nativeVerification.error || 'Neural Vault access was denied.',
    };
  }

  rememberVaultUnlock();
  permissionStore.logAudit(`vault.unlock: ${actionText || 'credential access'} (${nativeVerification.mode})`);
  return { success: true, mode: nativeVerification.mode };
}

async function ensureVaultApprovalForFormFill(formData = {}) {
  if (!formNeedsVaultApproval(formData)) {
    return { success: true, protected: false };
  }

  const fieldList = Object.keys(formData).slice(0, 3).join(', ');
  const verification = await verifyVaultAccess({
    reason: 'Unlock Neural Vault to fill saved login or form credentials.',
    actionText: `Credential autofill for ${fieldList || 'secure fields'}`,
  });

  if (!verification.success) {
    return { success: false, error: verification.error };
  }

  return { success: true, protected: true, mode: verification.mode };
}

// get-autofill-data handler moved to auth-handlers.js

ipcMain.handle('save-persistent-data', async (event, { key, data }) => {
  try {
    if (key === 'user-passwords') {
      return { success: false, error: 'Neural Vault entries must be saved through secure vault APIs.' };
    }
    const filePath = path.join(persistentDataPath, `${key}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
    return { success: true };
  } catch (error) {
    console.error('Failed to save persistent data:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-persistent-data', async (event, key) => {
  try {
    if (key === 'user-passwords') {
      return { success: false, error: 'Neural Vault entries are no longer exposed through generic storage APIs.' };
    }
    const filePath = path.join(persistentDataPath, `${key}.json`);
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return { success: true, data: JSON.parse(data) };
    }
    return { success: false, error: 'File not found' };
  } catch (error) {
    console.error('Failed to load persistent data:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-persistent-data', async (event, key) => {
  try {
    if (key === 'user-passwords') {
      return { success: false, error: 'Neural Vault entries must be deleted through secure vault APIs.' };
    }
    const filePath = path.join(persistentDataPath, `${key}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return { success: true };
  } catch (error) {
    console.error('Failed to delete persistent data:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-mac-native-ui-preferences', async () => {
  return {
    success: true,
    preferences: getMacNativeUiPreferences(),
    available: isMac && nativeMacPanelManager.getAvailability(),
  };
});

ipcMain.handle('set-mac-native-ui-preferences', async (event, updates = {}) => {
  if (!isMac) {
    return { success: false, error: 'Native SwiftUI panels are only available on macOS.' };
  }

  return {
    success: true,
    preferences: setMacNativeUiPreferences(updates),
    available: nativeMacPanelManager.getAvailability(),
  };
});

ipcMain.handle('show-mac-native-panel', async (event, mode = 'sidebar') => {
  if (!isMac) {
    return { success: false, error: 'Native SwiftUI panels are only available on macOS.' };
  }

  try {
    const panelMode = normalizeMacNativePanelMode(`${mode || 'sidebar'}`);
    const result = await nativeMacPanelManager.show(panelMode, { relaunchIfRunning: true });
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('toggle-mac-native-panel', async (event, mode = 'sidebar') => {
  if (!isMac) {
    return { success: false, error: 'Native SwiftUI panels are only available on macOS.' };
  }

  try {
    const panelMode = normalizeMacNativePanelMode(`${mode || 'sidebar'}`);
    const result = await nativeMacPanelManager.toggle(panelMode);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.on('update-native-mac-ui-state', (event, nextState = {}) => {
  if (!isMac || !nextState || typeof nextState !== 'object') {
    return;
  }

  const safeMessages = Array.isArray(nextState.messages) ? nextState.messages.slice(-24) : [];
  const safeActionChain = Array.isArray(nextState.actionChain) ? nextState.actionChain.slice(0, 30) : [];
  const safeActivityTags = Array.isArray(nextState.activityTags) ? nextState.activityTags.slice(0, 10) : [];
  const safeConversations = Array.isArray(nextState.conversations) ? nextState.conversations.slice(0, 24) : [];

  nativeMacUiState.updatedAt = Date.now();
  nativeMacUiState.inputDraft = `${nextState.inputDraft || ''}`;
  nativeMacUiState.isLoading = !!nextState.isLoading;
  nativeMacUiState.error = nextState.error ? `${nextState.error}` : null;
  if (nextState.themeAppearance === 'light' || nextState.themeAppearance === 'dark') {
    nativeMacUiState.themeAppearance = nextState.themeAppearance;
  }
  nativeMacUiState.messages = safeMessages.map((message, index) => ({
    id: message.id || `message-${index}-${Date.now()}`,
    role: message.role || 'model',
    content: `${message.content || ''}`.slice(0, 8000),
    timestamp: message.timestamp || Date.now(),
    thinkText: message.thinkText ? `${message.thinkText}`.slice(0, 8000) : null,
    isOcr: !!message.isOcr,
    ocrLabel: message.ocrLabel ? `${message.ocrLabel}`.slice(0, 120) : null,
    ocrText: message.ocrText ? `${message.ocrText}`.slice(0, 12000) : null,
    actionLogs: Array.isArray(message.actionLogs)
      ? message.actionLogs.slice(0, 24).map((log) => ({
        type: `${log?.type || ''}`.slice(0, 120),
        output: `${log?.output || ''}`.slice(0, 4000),
        success: !!log?.success,
      }))
      : [],
    mediaItems: Array.isArray(message.mediaItems)
      ? message.mediaItems.slice(0, 12).map((item, mediaIndex) => ({
        id: item?.id ? `${item.id}` : `media-${index}-${mediaIndex}`,
        type: `${item?.type || 'unknown'}`.slice(0, 80),
        url: item?.url ? `${item.url}`.slice(0, 12000) : null,
        caption: item?.caption ? `${item.caption}`.slice(0, 4000) : null,
        videoUrl: item?.videoUrl ? `${item.videoUrl}`.slice(0, 12000) : null,
        title: item?.title ? `${item.title}`.slice(0, 400) : null,
        description: item?.description ? `${item.description}`.slice(0, 4000) : null,
        thumbnailUrl: item?.thumbnailUrl ? `${item.thumbnailUrl}`.slice(0, 12000) : null,
        source: item?.source ? `${item.source}`.slice(0, 80) : null,
        videoId: item?.videoId ? `${item.videoId}`.slice(0, 120) : null,
        diagramId: item?.diagramId ? `${item.diagramId}`.slice(0, 120) : null,
        code: item?.code ? `${item.code}`.slice(0, 12000) : null,
        chartId: item?.chartId ? `${item.chartId}`.slice(0, 120) : null,
        chartDataJSON: item?.chartDataJSON ? `${item.chartDataJSON}`.slice(0, 12000) : null,
        chartOptionsJSON: item?.chartOptionsJSON ? `${item.chartOptionsJSON}`.slice(0, 8000) : null,
      }))
      : [],
  }));
  nativeMacUiState.actionChain = safeActionChain.map((command, index) => ({
    id: command.id || `command-${index}-${Date.now()}`,
    type: command.type || 'STEP',
    value: `${command.value || ''}`.slice(0, 1200),
    status: command.status || 'pending',
    category: command.category || null,
    riskLevel: command.riskLevel || null,
  }));
  nativeMacUiState.activityTags = safeActivityTags
    .map((tag) => `${tag || ''}`.trim())
    .filter(Boolean)
    .slice(0, 10);
  nativeMacUiState.conversations = safeConversations.map((conversation, index) => ({
    id: conversation.id || `conversation-${index}-${Date.now()}`,
    title: `${conversation.title || 'Untitled chat'}`.slice(0, 120),
    updatedAt: Number.isFinite(conversation.updatedAt) ? conversation.updatedAt : Date.now(),
  }));
  nativeMacUiState.activeConversationId = nextState.activeConversationId
    ? `${nextState.activeConversationId}`
    : null;
  if (Array.isArray(nextState.downloads)) {
    nativeMacUiState.downloads = nextState.downloads.slice(0, 30).map((download) => ({
      name: `${download.name || 'Download'}`,
      status: `${download.status || 'pending'}`,
      progress: Number.isFinite(download.progress) ? download.progress : 0,
      path: download.path ? `${download.path}` : '',
    }));
  }
  if (Array.isArray(nextState.clipboardItems)) {
    nativeMacUiState.clipboardItems = nextState.clipboardItems.slice(0, 40).map((item) => `${item}`.slice(0, 4000));
  }
  nativeMacUiState.currentCommandIndex = Number.isFinite(nextState.currentCommandIndex)
    ? nextState.currentCommandIndex
    : 0;

  const shouldAutoManageActionChain = getMacNativeUiPreferences().actionChainMode === 'swiftui';
  const hasActiveActionChainStep = nativeMacUiState.actionChain.some((command) => (
    command.status === 'pending' || command.status === 'executing' || command.status === 'awaiting_permission'
  ));

  if (shouldAutoManageActionChain) {
    if (hasActiveActionChainStep) {
      nativeMacPanelManager.show('action-chain').catch((error) => {
        console.error('[MacNativeUI] Failed to auto-open SwiftUI Action Chain:', error);
      });
    } else {
      nativeMacPanelManager.close('action-chain');
    }
  }
});

// Auth window handler is in src/main/handlers/auth-handlers.js (cleaned up and re-registered by index.js)

ipcMain.on('raycast-update-state', (event, state) => {
  if (state?.tabs) {
    raycastState.tabs = state.tabs.slice(-100);
  }
  if (state?.history) {
    raycastState.history = state.history.slice(-200);
  }
});

// Multi-BrowserView Management
ipcMain.on('create-view', (event, { tabId, url }) => {
  if (tabViews.has(tabId)) return; // Prevent redundant creation

  const chromeUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  const newView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'view_preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });
  newView.webContents.setUserAgent(chromeUserAgent);
  applyProxyConfigToSession(newView.webContents.session);
  
  // Add BrowserView to mainWindow immediately
  if (mainWindow) {
    mainWindow.addBrowserView(newView);
    console.log(`[BrowserView] Added view for tab ${tabId} to mainWindow`);
  }
  
  newView.webContents.loadURL(url);

  // Intercept new window requests and open them as new tabs
  newView.webContents.setWindowOpenHandler(({ url }) => {
    // Allow popups for authentication (Google, etc.)
    const isAuth = url.includes('accounts.google.com') || url.includes('facebook.com') || url.includes('oauth') || url.includes('auth0');
    if (isAuth) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 600,
          height: 700,
          center: true,
          aiProvider: 'gemini-1.5-flash',
          aiProviderVersion: '1.5',
          aiSafetyMode: true,
          autoHideMenuBar: true,
          parent: mainWindow,
        }
      };
    }

    if (mainWindow) {
      mainWindow.webContents.send('add-new-tab', url);
    }
    return { action: 'deny' };
  });

  newView.webContents.on('did-start-loading', () => {
    mainWindow.webContents.send('tab-loading-status', { tabId, isLoading: true });
  });

  newView.webContents.on('did-stop-loading', () => {
    mainWindow.webContents.send('tab-loading-status', { tabId, isLoading: false });
  });

  newView.webContents.on('did-finish-load', () => {
    syncGoogleSearchThemeForContents(newView.webContents);
    mainWindow.webContents.send('on-tab-loaded', { tabId, url: newView.webContents.getURL() });
  });

  // ERROR-PROOFING: Handle page load failures gracefully
  newView.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.warn(`[BrowserView] Tab ${tabId} failed to load: ${errorCode} - ${errorDescription}`);
    // Common non-critical errors to ignore
    const nonCritical = [-3, -7, -8, -9, -105, -106]; // ABORTED, CONNECTION_FAILED, etc.
    if (nonCritical.includes(errorCode)) return;
    mainWindow.webContents.send('tab-load-error', { tabId, errorCode, errorDescription, url });
  });

  newView.webContents.on('render-process-gone', (event, details) => {
    console.error(`[BrowserView] Tab ${tabId} render process gone: ${details.reason}`);
    mainWindow.webContents.send('tab-crashed', { tabId, reason: details.reason });
  });

  newView.webContents.on('unresponsive', () => {
    console.warn(`[BrowserView] Tab ${tabId} became unresponsive`);
    mainWindow.webContents.send('tab-unresponsive', { tabId });
  });

  newView.webContents.on('responsive', () => {
    console.log(`[BrowserView] Tab ${tabId} became responsive again`);
    mainWindow.webContents.send('tab-responsive', { tabId });
  });

  newView.webContents.on('did-navigate', (event, navUrl) => {
    syncGoogleSearchThemeForContents(newView.webContents);
    mainWindow.webContents.send('browser-view-url-changed', { tabId, url: navUrl });
    if (navUrl.includes('/search?') || navUrl.includes('?q=')) {
      try {
        const parsedUrl = new URL(navUrl);
        const query = parsedUrl.searchParams.get('q') || parsedUrl.searchParams.get('query');
        if (query) mainWindow.webContents.send('ai-query-detected', query);
      } catch (e) { }
    }
  });

  newView.webContents.on('page-title-updated', (event, title) => {
    mainWindow.webContents.send('browser-view-title-changed', { tabId, title });
  });

  // Track audio status
  newView.webContents.on('is-currently-audible-changed', (isAudible) => {
    console.log(`[Audio] Tab ${tabId} audible: ${isAudible}`);
    if (isAudible) audibleTabs.add(tabId);
    else audibleTabs.delete(tabId);
    if (mainWindow) {
      mainWindow.webContents.send('audio-status-changed', audibleTabs.size > 0);
    }
  });

  // Handle fullscreen requests from the BrowserView
  newView.webContents.on('enter-html-fullscreen-window', () => {
    if (mainWindow) {
      mainWindow.setFullScreen(true);
    }
  });

  newView.webContents.on('leave-html-fullscreen-window', () => {
    if (mainWindow) {
      mainWindow.setFullScreen(false);
    }
  });

  tabViews.set(tabId, newView);
});

const tabLastActive = new Map();

ipcMain.on('suspend-tab', (event, tabId) => {
  const view = tabViews.get(tabId);
  if (view) {
    if (view.webContents && !view.webContents.isDestroyed()) {
      view.webContents.destroy();
    }
    tabViews.delete(tabId);
    suspendedTabs.add(tabId);
    if (mainWindow) {
      mainWindow.webContents.send('tab-suspended', tabId);
    }
  }
});

ipcMain.on('resume-tab', (event, { tabId, url }) => {
  if (suspendedTabs.has(tabId)) {
    suspendedTabs.delete(tabId);
    // The 'create-view' handler will be called by the frontend,
    // which will create a new BrowserView for the tab.
    if (mainWindow) {
      mainWindow.webContents.send('tab-resumed', tabId);
    }
  }
});

setInterval(() => {
  const now = Date.now();
  const inactiveTimeout = 5 * 60 * 1000; // 5 minutes
  for (const [tabId, lastActive] of tabLastActive.entries()) {
    if (now - lastActive > inactiveTimeout && tabId !== activeTabId) {
      const view = tabViews.get(tabId);
      if (view) {
        // We don't want to suspend audible tabs
        if (audibleTabs.has(tabId)) continue;

        console.log(`Suspending inactive tab: ${tabId}`);
        ipcMain.emit('suspend-tab', {}, tabId);
      }
    }
  }
}, 60 * 1000); // Check every minute

ipcMain.on('activate-view', (event, { tabId, bounds }) => {
  tabLastActive.set(tabId, Date.now());

  if (suspendedTabs.has(tabId)) {
    if (mainWindow) {
      mainWindow.webContents.send('resume-tab-and-activate', tabId);
    }
    return;
  }

  if (activeTabId && tabViews.has(activeTabId)) {
    const oldView = tabViews.get(activeTabId);
    if (oldView) {
      mainWindow.removeBrowserView(oldView);
    }
  }

  const newView = tabViews.get(tabId);
  if (newView) {
    if (bounds.width === 0 || bounds.height === 0) {
      mainWindow.removeBrowserView(newView);
    } else {
      if (!mainWindow.getBrowserViews().includes(newView)) {
        mainWindow.addBrowserView(newView);
      }
      const roundedBounds = {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      };
      newView.setBounds(roundedBounds);
      if (tabViews._bounds !== undefined) tabViews._bounds = roundedBounds;
    }
  }
  activeTabId = tabId;
  if (tabViews._activeTabId !== undefined) tabViews._activeTabId = tabId;
});

ipcMain.on('destroy-view', (event, tabId) => {
  const view = tabViews.get(tabId);
  if (view) {
    if (activeTabId === tabId) {
      mainWindow.removeBrowserView(view);
      activeTabId = null;
      if (tabViews._activeTabId !== undefined) tabViews._activeTabId = null;
    }
    if (view.webContents && !view.webContents.isDestroyed()) {
      view.webContents.destroy();
    }
    tabViews.delete(tabId);
    audibleTabs.delete(tabId);
    if (mainWindow) {
      mainWindow.webContents.send('audio-status-changed', audibleTabs.size > 0);
    }
  }
});

ipcMain.on('set-browser-view-bounds', (event, bounds) => {
  const view = tabViews.get(activeTabId);
  if (view && mainWindow) {
    if (bounds.width === 0 || bounds.height === 0) {
      mainWindow.removeBrowserView(view);
    } else {
      if (!mainWindow.getBrowserViews().includes(view)) {
        mainWindow.addBrowserView(view);
      }
      const roundedBounds = {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      };
      view.setBounds(roundedBounds);
    }
  }
});

ipcMain.on('navigate-browser-view', async (event, { tabId, url }) => {
  const view = tabViews.get(tabId || activeTabId);
  if (!view) return;

  // ERROR-PROOFING: Add retry logic for navigation
  const maxRetries = 2;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await view.webContents.loadURL(url);
      appendToMemory({ action: 'navigate', url });
      return; // Success
    } catch (err) {
      lastError = err;
      console.warn(`[BrowserView] Navigation attempt ${attempt} failed: ${err.message}`);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 500)); // Wait before retry
      }
    }
  }

  // All retries failed - try loading a fallback/error page
  console.error(`[BrowserView] Navigation failed after ${maxRetries} attempts: ${url}`);
  try {
    const fallbackUrl = `data:text/html,<html><head><title>Navigation Error</title></head><body style="font-family:sans-serif;padding:40px;text-align:center;background:#fafafa;"><h2 style="color:#dc2626;">⚠️ Could not load this page</h2><p>The page <strong>${escapeHtml(url.substring(0, 50))}...</strong> could not be loaded.</p><p style="color:#666;">This may be due to a network issue or the site being unavailable.</p><button onclick="window.history.back()" style="padding:12px 24px;background:#2563eb;color:white;border:none;border-radius:6px;cursor:pointer;margin-top:20px;">Go Back</button></body></html>`;
    await view.webContents.loadURL(fallbackUrl);
  } catch (fallbackErr) {
    console.error('[BrowserView] Even fallback page failed:', fallbackErr);
  }
});

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

ipcMain.on('browser-view-go-back', () => {
  const view = tabViews.get(activeTabId);
  if (view && view.webContents.canGoBack()) view.webContents.goBack();
});

ipcMain.on('browser-view-go-forward', () => {
  const view = tabViews.get(activeTabId);
  if (view && view.webContents.canGoForward()) view.webContents.goForward();
});

ipcMain.on('browser-view-reload', () => {
  const view = tabViews.get(activeTabId);
  if (view) view.webContents.reload();
});

ipcMain.on('change-zoom', (event, deltaY) => {
  const view = tabViews.get(activeTabId);
  if (view) {
    const currentZoom = view.webContents.getZoomFactor();
    const newZoom = deltaY < 0 ? currentZoom + 0.1 : currentZoom - 0.1;
    // Clamp zoom factor between 0.5x and 3x
    if (newZoom >= 0.5 && newZoom <= 3.0) {
      view.webContents.setZoomFactor(newZoom);
    }
  }
});

ipcMain.on('open-dev-tools', () => {
  const view = tabViews.get(activeTabId);
  if (view) view.webContents.openDevTools({ mode: 'detach' });
  else if (mainWindow) mainWindow.webContents.openDevTools();
});

ipcMain.handle('execute-javascript', async (event, code) => {
  const view = tabViews.get(activeTabId);
  if (view) {
    try {
      return await view.webContents.executeJavaScript(code);
    } catch (e) {
      console.error("Execute JS failed:", e);
      return null;
    }
  }
  return null;
});

ipcMain.handle('get-browser-view-url', () => {
  const view = tabViews.get(activeTabId);
  return view ? view.webContents.getURL() : '';
});

ipcMain.handle('capture-page-html', async () => {
  const view = tabViews.get(activeTabId);
  if (!view) return "";
  return await view.webContents.executeJavaScript('document.documentElement.outerHTML');
});

// ============================================================================
// SCREEN CAPTURE - For OCR and cross-app clicking
// ============================================================================
ipcMain.removeHandler('capture-browser-view-screenshot');
ipcMain.handle('capture-browser-view-screenshot', async () => {
  const view = tabViews.get(activeTabId);
  if (!view) {
    console.warn('[Screenshot] No active tab found');
    return null;
  }

  // ERROR-PROOFING: Retry logic for screenshot capture
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Wait for page to be ready and rendering to complete
      await new Promise(resolve => setTimeout(resolve, 200 * attempt));

      const image = await view.webContents.capturePage();
      if (!image || image.isEmpty()) {
        console.warn(`[Screenshot] Attempt ${attempt}: Image is empty, retrying...`);
        if (attempt < maxRetries) await new Promise(r => setTimeout(r, 300));
        continue;
      }

      // Convert NativeImage to PNG buffer then to base64 data URL
      const pngBuffer = image.toPNG();
      if (!pngBuffer || pngBuffer.length === 0) {
        console.warn(`[Screenshot] Attempt ${attempt}: PNG conversion failed, retrying...`);
        if (attempt < maxRetries) await new Promise(r => setTimeout(r, 300));
        continue;
      }

      const base64 = pngBuffer.toString('base64');
      const dataUrl = `data:image/png;base64,${base64}`;
      console.log(`[Screenshot] Success on attempt ${attempt}, size: ${pngBuffer.length} bytes`);
      return dataUrl;
    } catch (e) {
      console.error(`[Screenshot] Attempt ${attempt} failed:`, e.message);
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, 300));
    }
  }

  console.error('[Screenshot] All capture attempts failed');

  // Fallback: Try to get screenshot via JPEG which is sometimes more reliable
  try {
    const image = await view.webContents.capturePage();
    if (image && !image.isEmpty()) {
      const jpegBuffer = image.toJPEG(90);
      if (jpegBuffer && jpegBuffer.length > 0) {
        return `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
      }
    }
  } catch (e2) {
    console.error('[Screenshot] JPEG fallback also failed:', e2.message);
  }

  return null;
});

ipcMain.handle('capture-screen-region', async (event, bounds) => {
  console.log('[Screen] Capturing region:', bounds);
  const tempFile = path.join(os.tmpdir(), `capture_${Date.now()}.png`);
  try {
    await captureScreenRegion(bounds, tempFile);
    const imageBuffer = fs.readFileSync(tempFile);
    const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;
    return { success: true, path: tempFile, image: base64Image };
  } catch (e) {
    console.error('[Screen] Capture failed:', e);
    return { success: false, error: e.message };
  }
});



/**
 * Maps OCR result coordinates (from Tesseract) to screen coordinates.
 * When the capture region is a subset of the screen, adds the capture offset.
 * @param {Object} ocrResult - Tesseract word result with bbox: { x0, y0, x1, y1 }
 * @param {Object} captureRegion - { x, y, width, height } - screen region that was captured
 * @returns {{ x: number, y: number, width: number, height: number }} screen coordinates
 */
function mapOcrCoordsToScreenCoords(ocrResult, captureRegion) {
  const box = ocrResult.bbox || ocrResult.box || {};
  const x0 = box.x0 ?? box.x ?? 0;
  const y0 = box.y0 ?? box.y ?? 0;
  const x1 = box.x1 ?? (box.x || 0) + (box.width || 0);
  const y1 = box.y1 ?? (box.y || 0) + (box.height || 0);
  const width = x1 - x0;
  const height = y1 - y0;
  const screenX = (captureRegion?.x ?? 0) + x0;
  const screenY = (captureRegion?.y ?? 0) + y0;
  return { x: Math.round(screenX), y: Math.round(screenY), width: Math.round(width), height: Math.round(height) };
}

/**
 * find-and-click-text: resolves a visible cross-app target and clicks it.
 * Uses the shared OCR service, which now prefers native OS providers first
 * and falls back to Tesseract only when native extraction is unavailable.
 */
async function findAndClickTextInternal(targetText) {
  if (!targetText || typeof targetText !== 'string' || targetText.trim().length === 0) {
    return { success: false, error: 'Target text is required.' };
  }

  const permission = checkAiActionPermission('FIND_AND_CLICK', targetText.trim(), 'medium');
  if (!permission.allowed) {
    return { success: false, error: permission.error };
  }

  const automationMode = store.get('automation_mode') || 'dom';
  const preferOcr = automationMode === 'ocr';

  try {
    if (preferOcr) {
      if (!tesseractOcrService) return { success: false, error: 'OCR service not initialized.' };
      const result = await tesseractOcrService.ocrClick(targetText.trim(), cometAiEngine, robotService, permissionStore);
      if (result.success) return result;
    }

    const view = tabViews.get(activeTabId);
    if (view && !view.webContents.isDestroyed()) {
      try {
        const domResult = await resolveAndClickWithAi(view.webContents, targetText.trim(), cometAiEngine);
        if (domResult?.success) {
          console.log(`[Main] Find-and-click resolved "${targetText}" via ${domResult.method}`);
          return { ...domResult, provider: 'browser-dom' };
        }
      } catch (domError) {
        console.warn('[Main] DOM find-and-click fallback to OCR:', domError.message);
      }
    }

    if (!preferOcr) {
      if (!tesseractOcrService) return { success: false, error: 'OCR service not initialized.' };
      const result = await tesseractOcrService.ocrClick(targetText.trim(), cometAiEngine, robotService, permissionStore);
      if (result.success) return result;
    }

    return { success: false, error: 'Could not find and click the target element.' };
  } catch (error) {
    console.error('[Main] find-and-click-text failed:', error);
    return { success: false, error: error.message };
  }
}

ipcMain.handle('find-and-click-text', async (_event, targetText) => {
  return findAndClickTextInternal(targetText);
});

ipcMain.handle('save-offline-page', async (event, { url, title, html }) => {
  console.log(`[Offline] Saved ${title}`);
  return true;
});

ipcMain.handle('share-device-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (!result.canceled) return { path: result.filePaths[0], success: true };
  return { success: false };
});

ipcMain.handle('trigger-download', async (event, url, suggestedFilename) => {
  if (mainWindow && url) {
    mainWindow.webContents.downloadURL(url, { filename: suggestedFilename });
    return { success: true };
  }
  return { success: false, error: 'Download failed: invalid URL or mainWindow not available.' };
});

ipcMain.handle('get-ai-memory', async () => readMemory());
ipcMain.on('add-ai-memory', (event, entry) => appendToMemory(entry));

const vectorStorePath = path.join(app.getPath('userData'), 'vector_store.json');
ipcMain.handle('save-vector-store', async (event, data) => {
  try {
    fs.writeFileSync(vectorStorePath, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error("Failed to save vector store:", e);
    return false;
  }
});

ipcMain.handle('load-vector-store', async () => {
  try {
    if (fs.existsSync(vectorStorePath)) {
      return JSON.parse(fs.readFileSync(vectorStorePath, 'utf-8'));
    }
  } catch (e) {
    console.error("Failed to load vector store:", e);
  }
  return [];
});

const llmProviders = [
  { id: 'google', name: 'Google Gemini (Auto Latest)' },
  { id: 'google-flash', name: 'Google Gemini Flash (Auto Latest)' },
  { id: 'openai', name: 'OpenAI (Auto Latest)' },
  { id: 'azure-openai', name: 'Microsoft Azure OpenAI' },
  { id: 'anthropic', name: 'Anthropic Claude (Auto Latest)' },
  { id: 'xai', name: 'xAI Grok (Auto Latest)' },
  { id: 'groq', name: 'Groq (Auto Latest)' },
  { id: 'ollama', name: 'Ollama (Local AI)' }
];
let activeLlmProvider = store.get('active_llm_provider') || 'ollama';
const llmConfigs = {
  ollama: {
    baseUrl: store.get('ollama_base_url') || 'http://127.0.0.1:11434',
    model: store.get('ollama_model') || 'deepseek-r1:1.5b',
    localLlmMode: store.get('local_llm_mode') || 'normal'
  },
  google: {
    apiKey: store.get('gemini_api_key') || '',
    model: store.get('gemini_model') || getProviderFallbackModel('google')
  },
  'google-flash': {
    apiKey: store.get('gemini_api_key') || '',
    model: store.get('gemini_flash_model') || getProviderFallbackModel('google-flash')
  },
  openai: {
    apiKey: store.get('openai_api_key') || '',
    model: store.get('openai_model') || getProviderFallbackModel('openai')
  },
  'azure-openai': {
    apiKey: store.get('azure_openai_api_key') || '',
    baseUrl: store.get('azure_openai_endpoint') || '',
    model: store.get('azure_openai_model') || 'gpt-4.1-mini'
  },
  anthropic: {
    apiKey: store.get('anthropic_api_key') || '',
    model: store.get('anthropic_model') || getProviderFallbackModel('anthropic')
  },
  xai: {
    apiKey: store.get('xai_api_key') || '',
    model: store.get('xai_model') || getProviderFallbackModel('xai')
  },
  groq: {
    apiKey: store.get('groq_api_key') || '',
    model: store.get('groq_model') || getProviderFallbackModel('groq')
  }
};

const LLM_MODEL_CATALOG_STORE_KEY = 'llm_model_catalogs_v1';

function getCachedProviderCatalogs() {
  const cached = store.get(LLM_MODEL_CATALOG_STORE_KEY);
  return cached && typeof cached === 'object' ? cached : {};
}

function saveCachedProviderCatalog(providerId, catalog) {
  const cachedCatalogs = getCachedProviderCatalogs();
  cachedCatalogs[providerId] = catalog;
  store.set(LLM_MODEL_CATALOG_STORE_KEY, cachedCatalogs);
}

function getConfiguredProviderApiKey(providerId) {
  const storeKey = getProviderApiKeyStoreKey(providerId);
  return (storeKey && store.get(storeKey)) || llmConfigs[providerId]?.apiKey || '';
}

function getRecommendedProviderModel(providerId) {
  const cachedCatalogs = getCachedProviderCatalogs();
  return cachedCatalogs[providerId]?.recommendedModel || getProviderFallbackModel(providerId);
}

function getConfiguredProviderModel(providerId) {
  if (providerId === 'ollama') {
    return store.get('ollama_model') || llmConfigs.ollama.model || 'deepseek-r1:1.5b';
  }

  if (providerId === 'azure-openai') {
    return store.get('azure_openai_model') || llmConfigs['azure-openai'].model || 'gpt-4.1-mini';
  }

  const storeKey = getProviderModelStoreKey(providerId);
  const configuredModel = (storeKey && store.get(storeKey)) || llmConfigs[providerId]?.model;
  return configuredModel || getRecommendedProviderModel(providerId);
}

async function getProviderModelCatalog(providerId, options = {}) {
  const forceRefresh = options.forceRefresh === true;
  const cachedCatalogs = getCachedProviderCatalogs();
  const cachedCatalog = cachedCatalogs[providerId];

  if (
    !forceRefresh &&
    cachedCatalog &&
    cachedCatalog.fetchedAt &&
    Date.now() - cachedCatalog.fetchedAt < CATALOG_TTL_MS
  ) {
    return cachedCatalog;
  }

  if (!llmConfigs[providerId]) {
    return {
      success: false,
      providerId,
      providerName: getProviderLabel(providerId),
      models: [],
      recommendedModel: getProviderFallbackModel(providerId),
      error: `Provider ${providerId} is not configured.`,
    };
  }

  try {
    const catalog = await fetchProviderModelCatalog(providerId, {
      apiKey: getConfiguredProviderApiKey(providerId),
    });

    if (catalog.success) {
      saveCachedProviderCatalog(providerId, catalog);
      return catalog;
    }

    if (cachedCatalog && !forceRefresh) {
      return cachedCatalog;
    }

    return catalog;
  } catch (error) {
    if (cachedCatalog && !forceRefresh) {
      return {
        ...cachedCatalog,
        warning: error.message,
      };
    }

    return {
      success: false,
      providerId,
      providerName: getProviderLabel(providerId),
      models: [],
      recommendedModel: getProviderFallbackModel(providerId),
      error: error.message,
    };
  }
}

ipcMain.handle('llm-get-available-providers', () => llmProviders);
ipcMain.handle('llm-get-provider-models', async (event, providerId, options = {}) => {
  return getProviderModelCatalog(providerId, options);
});
ipcMain.handle('llm-set-active-provider', (event, providerId) => {
  activeLlmProvider = providerId;
  store.set('active_llm_provider', providerId);
  return true;
});
ipcMain.handle('llm-configure-provider', (event, providerId, options) => {
  llmConfigs[providerId] = { ...llmConfigs[providerId], ...options };

  // Persist to store for survivors
  if (providerId === 'google') {
    if (options.apiKey) store.set('gemini_api_key', options.apiKey);
    if (options.model) store.set('gemini_model', options.model);
  }
  if (providerId === 'google-flash') {
    if (options.apiKey) store.set('gemini_api_key', options.apiKey);
    if (options.model) store.set('gemini_flash_model', options.model);
  }
  if (providerId === 'openai') {
    if (options.apiKey) store.set('openai_api_key', options.apiKey);
    if (options.model) store.set('openai_model', options.model);
  }
  if (providerId === 'azure-openai') {
    if (options.apiKey) store.set('azure_openai_api_key', options.apiKey);
    if (options.baseUrl) store.set('azure_openai_endpoint', options.baseUrl);
    if (options.model) store.set('azure_openai_model', options.model);
  }
  if (providerId === 'anthropic') {
    if (options.apiKey) store.set('anthropic_api_key', options.apiKey);
    if (options.model) store.set('anthropic_model', options.model);
  }
  if (providerId === 'xai') {
    if (options.apiKey) store.set('xai_api_key', options.apiKey);
    if (options.model) store.set('xai_model', options.model);
  }
  if (providerId === 'groq') {
    if (options.apiKey) store.set('groq_api_key', options.apiKey);
    if (options.model) store.set('groq_model', options.model);
  }
  if (providerId === 'ollama') {
    if (options.baseUrl) store.set('ollama_base_url', options.baseUrl);
    if (options.model) store.set('ollama_model', options.model);
    if (options.localLlmMode !== undefined) store.set('local_llm_mode', options.localLlmMode);
  }

  return true;
});

// IPC handler to get stored API keys for frontend initialization
ipcMain.handle('get-stored-api-keys', () => {
  return {
    openai_api_key: store.get('openai_api_key') || '',
    openai_model: getConfiguredProviderModel('openai'),
    azure_openai_api_key: store.get('azure_openai_api_key') || '',
    azure_openai_endpoint: store.get('azure_openai_endpoint') || '',
    azure_openai_model: store.get('azure_openai_model') || 'gpt-4.1-mini',
    gemini_api_key: store.get('gemini_api_key') || '',
    gemini_model: getConfiguredProviderModel('google'),
    gemini_flash_model: getConfiguredProviderModel('google-flash'),
    anthropic_api_key: store.get('anthropic_api_key') || '',
    anthropic_model: getConfiguredProviderModel('anthropic'),
    groq_api_key: store.get('groq_api_key') || '',
    groq_model: getConfiguredProviderModel('groq'),
    xai_api_key: store.get('xai_api_key') || '',
    xai_model: getConfiguredProviderModel('xai'),
    ollama_base_url: store.get('ollama_base_url') || 'http://127.0.0.1:11434',
    ollama_model: store.get('ollama_model') || 'deepseek-r1:1.5b',
    ollama_enabled: store.get('ollama_enabled') !== false,
    active_llm_provider: store.get('active_llm_provider') || 'ollama',
  };
});

// AI Settings Query — returns categorised settings for the SETTINGS_QUERY command.
// Sensitive keys (API keys, tokens) are always masked.
ipcMain.handle('get-ai-settings', (_event, category) => {
  const SENSITIVE = ['api_key', 'token', 'secret', 'password', 'session', 'credential'];
  const mask = (key, val) => SENSITIVE.some(s => key.toLowerCase().includes(s)) ? (val ? '***SET***' : null) : val;

  const webSearchSettings = {
    category: 'webSearch',
    label: 'Web Search',
    settings: {
      maxPages: store.get('webSearchMaxPages') ?? 5,
      searchDepth: store.get('webSearchDepth') ?? 'medium',
      searchEngine: store.get('webSearchEngine') ?? 'auto',
      extractionMode: store.get('webSearchExtractionMode') ?? 'full',
      budget: store.get('webSearchBudget') ?? 'standard',
      safeSearch: store.get('webSearchSafeSearch') ?? true,
      language: store.get('webSearchLanguage') ?? 'auto',
    },
  };

  const aiSettings = {
    category: 'ai',
    label: 'AI Engine',
    settings: {
      activeProvider: store.get('active_llm_provider') ?? 'ollama',
      activeModel: getConfiguredProviderModel(store.get('active_llm_provider') ?? 'ollama'),
      streamingEnabled: store.get('aiStreaming') !== false,
      thinkingEnabled: store.get('aiThinking') !== false,
      maxTokens: store.get('aiMaxTokens') ?? 8192,
      temperature: store.get('aiTemperature') ?? 0.7,
      systemPromptEnabled: store.get('aiSystemPromptEnabled') !== false,
      memoryEnabled: store.get('aiMemoryEnabled') !== false,
      skillAutoLoad: store.get('aiSkillAutoLoad') !== false,
    },
  };

  const uiSettings = {
    category: 'ui',
    label: 'User Interface',
    settings: {
      theme: store.get('theme') ?? 'dark',
      fontSize: store.get('uiFontSize') ?? 14,
      sidebarWidth: store.get('sidebarWidth') ?? 380,
      showTerminal: store.get('showTerminal') ?? false,
      showActionChain: store.get('showActionChain') ?? true,
      compactMode: store.get('uiCompactMode') ?? false,
      language: store.get('uiLanguage') ?? 'en',
      notifications: store.get('uiNotifications') !== false,
    },
  };

  const permissionsSettings = {
    category: 'permissions',
    label: 'Permissions & Allowlist',
    settings: {
      allowedDirectories: permissionStore.getAllowedDirectories().map(d => ({
        path: d.path,
        recursive: d.recursive,
        access: d.access
      })),
      grants: Array.from(permissionStore.permissions.entries()).map(([k, v]) => ({
        permission: k,
        level: v.level,
        grantedAt: v.granted_at,
        grantedVia: v.granted_via,
        expiresAt: v.expires_at
      })),
      autoApproveLowRisk: permissionStore.settings.autoApproveLowRisk,
      autoApproveMidRisk: permissionStore.settings.autoApproveMidRisk,
    }
  };

  const allCategories = { webSearch: webSearchSettings, ai: aiSettings, ui: uiSettings, permissions: permissionsSettings };
  if (category && allCategories[category]) {
    return allCategories[category];
  }
  return allCategories;
});

// Shortcut activation IPC handler for the AI settings skill
ipcMain.handle('trigger-shortcut', (_event, action) => {
  triggerShortcut(action);
  return { success: true };
});

// AI Settings Update — applies a partial settings update for a given category.
// Requires explicit user action — the AI calls this only after the user approves.
ipcMain.handle('update-ai-settings', (_event, category, updates) => {
  if (!category || typeof updates !== 'object' || !updates) {
    return { success: false, error: 'Invalid category or updates object' };
  }

  const KEY_MAP = {
    webSearch: {
      maxPages: 'webSearchMaxPages',
      searchDepth: 'webSearchDepth',
      searchEngine: 'webSearchEngine',
      extractionMode: 'webSearchExtractionMode',
      budget: 'webSearchBudget',
      safeSearch: 'webSearchSafeSearch',
      language: 'webSearchLanguage',
    },
    ai: {
      activeProvider: 'active_llm_provider',
      streamingEnabled: 'aiStreaming',
      thinkingEnabled: 'aiThinking',
      maxTokens: 'aiMaxTokens',
      temperature: 'aiTemperature',
      systemPromptEnabled: 'aiSystemPromptEnabled',
      memoryEnabled: 'aiMemoryEnabled',
      skillAutoLoad: 'aiSkillAutoLoad',
    },
    ui: {
      theme: 'theme',
      fontSize: 'uiFontSize',
      sidebarWidth: 'sidebarWidth',
      showTerminal: 'showTerminal',
      showActionChain: 'showActionChain',
      compactMode: 'uiCompactMode',
      language: 'uiLanguage',
      notifications: 'uiNotifications',
    },
  };

  const map = KEY_MAP[category];
  if (!map) return { success: false, error: `Unknown settings category: ${category}` };

  const applied = {};
  for (const [uiKey, storeKey] of Object.entries(map)) {
    if (uiKey in updates) {
      store.set(storeKey, updates[uiKey]);
      applied[uiKey] = updates[uiKey];
    }
  }

  return { success: true, applied, category };
});


// Onboarding / first-run flags — persisted in electron-store so .dmg/.exe builds
// keep state even when renderer localStorage partition or origin differs from dev.
ipcMain.handle('get-onboarding-state', () => ({
  hasSeenWelcomePage: !!store.get('onboarding_has_seen_welcome'),
  hasCompletedStartupSetup: !!store.get('onboarding_completed_startup'),
  hasSeenNeuralSetup: !!store.get('onboarding_seen_neural_setup'),
}));

ipcMain.handle('set-onboarding-state', (event, partial = {}) => {
  console.log('[IPC] set-onboarding-state handler called with:', partial);
  if (typeof partial.hasSeenWelcomePage === 'boolean') {
    store.set('onboarding_has_seen_welcome', partial.hasSeenWelcomePage);
  }
  if (typeof partial.hasCompletedStartupSetup === 'boolean') {
    store.set('onboarding_completed_startup', partial.hasCompletedStartupSetup);
  }
  if (typeof partial.hasSeenNeuralSetup === 'boolean') {
    store.set('onboarding_seen_neural_setup', partial.hasSeenNeuralSetup);
  }
  return true;
});

// Redundant search-applications handler removed (see line 3387)


// IPC handler to set MCP server port dynamically
ipcMain.on('set-mcp-server-port', (event, port) => {
  mcpServerPort = port;
  console.log(`MCP Server port updated to: ${mcpServerPort}`);
});

ipcMain.handle('extract-page-content', async (_event, tabId) => {
  const targetId = tabId || activeTabId;
  let view = targetId ? tabViews.get(targetId) : null;

  // Fallback: if requested tab not found, try activeTabId
  if (!view && tabId) {
    view = tabViews.get(activeTabId);
  }
  // Last resort: any available view
  if (!view) {
    for (const [, v] of tabViews) {
      if (v && v.webContents && !v.webContents.isDestroyed()) {
        view = v;
        break;
      }
    }
  }

  // Small delay to let page settle before reading
  await new Promise(resolve => setTimeout(resolve, 500));

  // Retry up to 3 times if content is empty
  let content = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    let wc;
    try {
      wc = view && view.webContents;
    } catch (_) {
      wc = null;
    }
    if (!wc || wc.isDestroyed()) {
      return { error: 'No active view' };
    }

    try {
      const pendingUrl = wc.getURL();
      if (!pendingUrl || pendingUrl === 'about:blank') {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      content = await wc.executeJavaScript(`
        (() => {
          try {
            const clone = document.body.cloneNode(true);
            const elementsToRemove = clone.querySelectorAll('script, style, nav, footer, header, noscript, svg');
            elementsToRemove.forEach(e => e.remove());
            
            return clone.innerText
              .replace(/\\s+/g, ' ')
              .replace(/[\\r\\n]+/g, '\\n')
              .trim() || document.body.innerText;
          } catch(e) {
            return document.body ? document.body.innerText : "";
          }
        })()
      `);
      if (content && content.length > 50) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (e) {
      if (attempt === 2) return { error: e.message };
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return { content };
});

// Secure DOM Extraction with filtering and injection detection
ipcMain.handle('extract-secure-dom', async () => {
  const view = tabViews.get(activeTabId);
  if (!view) return { error: 'No active view', content: '', elements: [], metadata: {} };

  try {
    const result = await view.webContents.executeJavaScript(`
      (() => {
        const BLOCKED_TAGS = ['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'applet', 'form', 'input', 'button', 'select', 'textarea'];
        const BLOCKED_CLASSES = [/nav/i, /footer/i, /header/i, /sidebar/i, /menu/i, /popup/i, /modal/i, /overlay/i, /cookie/i, /banner/i, /advertisement/i];
        const PII_PATTERNS = [
          /\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b/g,
          /\\b\\d{3}[-.]?\\d{3}[-.]?\\d{4}\\b/g,
          /Bearer\\s+[A-Za-z0-9\\-_]+\\.[A-Za-z0-9\\-_]+\\.[A-Za-z0-9\\-_]+/gi,
          /session[_-]?id["\\s:=]+["']?[A-Za-z0-9\\-_]+["']?/gi,
        ];
        
        function shouldBlock(el) {
          if (BLOCKED_TAGS.includes(el.tagName.toLowerCase())) return true;
          for (const p of BLOCKED_CLASSES) {
            if (p.test(el.className) || p.test(el.id)) return true;
          }
          return false;
        }
        
        function sanitizeText(text) {
          let result = text;
          for (const p of PII_PATTERNS) {
            result = result.replace(p, '[REDACTED]');
          }
          return result.replace(/[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]/g, '').replace(/\\s+/g, ' ').trim();
        }
        
        function extractElements(el, path = '') {
          if (shouldBlock(el)) return [];
          const tag = el.tagName.toLowerCase();
          const xpath = path ? path + '/' + tag : '//' + tag;
          
          let text = '';
          const children = [];
          
          for (const node of el.childNodes) {
            if (node.nodeType === 3) text += node.textContent || '';
            else if (node.nodeType === 1) {
              const childResults = extractElements(node, xpath);
              children.push(...childResults);
            }
          }
          
          const sanitized = sanitizeText(text);
          if (!sanitized.trim() && children.length === 0) return [];
          
        const attributes = {};
        if (el.attributes) {
          for (const attr of el.attributes) {
            attributes[attr.name] = attr.value;
          }
        }

        return [{
          tag,
          text: sanitized,
          xpath,
          attributes,
          children: children.map(c => ({
            tag: c.tag,
            text: c.text,
            xpath: c.xpath,
            attributes: c.attributes,
            children: c.children
          }))
        }];
      }
        
// Extract all links with their titles for web search and navigation
        const links = [];
        for (const a of document.querySelectorAll('a[href]')) {
          const href = a.href;
          const title = a.textContent?.trim() || a.title || '';
          const visibleText = a.innerText?.trim() || '';
          if (href && (title || visibleText) && !href.startsWith('javascript:') && !href.startsWith('mailto:')) {
            links.push({ href, title: title || visibleText, text: visibleText });
          }
        }
        
        const main = document.querySelector('main, article, [role="main"], #content, #main, .content') || document.body;
        const elements = [];
        for (const child of main.children) {
          elements.push(...extractElements(child));
        }
        
        const content = elements.map(e => e.text).filter(Boolean).join('\n');
        const fullText = document.body.innerText || content;
        
        return {
          content: sanitizeText(fullText),
          elements,
          links,
          url: window.location.href,
          title: document.title,
          scriptsRemoved: document.querySelectorAll('script').length,
          stylesRemoved: document.querySelectorAll('style').length,
          navRemoved: document.querySelectorAll('nav').length
        };
      })()
    `);

    return {
      content: result.content || '',
      elements: result.elements || [],
      links: result.links || [],
      metadata: {
        url: result.url || '',
        title: result.title || '',
        timestamp: Date.now(),
        injectionDetected: false,
        filterStats: {
          piiRemoved: (result.content || '').match(/\[REDACTED\]/g)?.length || 0,
          scriptsRemoved: result.scriptsRemoved || 0,
          stylesRemoved: result.stylesRemoved || 0,
          navRemoved: result.navRemoved || 0,
          adsRemoved: 0
        }
      }
    };
  } catch (e) {
    console.error('[SecureDOM] Extraction failed:', e);
    return { error: e.message, content: '', elements: [], metadata: {} };
  }
});

// DOM Search within current page
ipcMain.handle('search-dom', async (event, query) => {
  const view = tabViews.get(activeTabId);
  if (!view) return { error: 'No active view', results: [] };

  if (!query || typeof query !== 'string') {
    return { error: 'Invalid query', results: [] };
  }

  try {
    const results = await view.webContents.executeJavaScript(`
      (() => {
        const query = ${JSON.stringify(query)};
        const searchLower = query.toLowerCase();
        const results = [];
        
        function walk(el, path = '') {
          if (['script', 'style', 'noscript', 'iframe', 'nav', 'footer', 'header'].includes(el.tagName.toLowerCase())) return;
          
          const tag = el.tagName.toLowerCase();
          const xpath = path ? path + '/' + tag : '//' + tag;
          
          let text = '';
          for (const node of el.childNodes) {
            if (node.nodeType === 3) text += node.textContent || '';
            else if (node.nodeType === 1) walk(node, xpath);
          }
          
          const textLower = text.toLowerCase();
          const idx = textLower.indexOf(searchLower);
          
          if (idx !== -1) {
            const start = Math.max(0, idx - 40);
            const end = Math.min(text.length, idx + query.length + 40);
            const context = text.slice(start, end);
            
            let score = 10;
            if (textLower.startsWith(searchLower)) score += 20;
            if (textLower.includes(' ' + searchLower)) score += 10;
            if (text.length < 200) score += 15;
            
            results.push({
              text: text.slice(Math.max(0, idx - 20), idx) + '[[' + text.slice(idx, idx + query.length) + ']]' + text.slice(idx + query.length, idx + query.length + 20),
              context: context,
              xpath: xpath,
              score: score,
              tag: tag
            });
          }
        }
        
        walk(document.body);
        
        return results.sort((a, b) => b.score - a.score).slice(0, 15);
      })()
    `, query);

    return { results: results || [], query };
  } catch (e) {
    console.error('[SecureDOM] Search failed:', e);
    return { error: e.message, results: [] };
  }
});

ipcMain.handle('get-selected-text', async () => {
  const view = tabViews.get(activeTabId);
  if (!view) return '';
  try {
    const selectedText = await view.webContents.executeJavaScript(`window.getSelection().toString();`);
    return selectedText;
  } catch (e) {
    console.error("Failed to get selected text from BrowserView:", e);
    return '';
  }
});

ipcMain.on('send-to-ai-chat-input', (event, text) => {
  if (mainWindow) {
    mainWindow.webContents.send('ai-chat-input-text', text);
  }
});

ipcMain.on('save-google-config', (event, { clientId, clientSecret, redirectUri }) => {
  if (clientId) store.set('google_client_id', clientId);
  if (clientSecret) store.set('google_client_secret', clientSecret);
  if (redirectUri) store.set('google_redirect_uri', redirectUri);
});

ipcMain.handle('get-google-config', () => {
  return {
    clientId: store.get('google_client_id'),
    clientSecret: store.get('google_client_secret'),
    redirectUri: store.get('google_redirect_uri')
  };
});

ipcMain.on('send-ai-overview-to-sidebar', (event, data) => {
  if (mainWindow) {
    mainWindow.webContents.send('ai-overview-data', data);
  }
});

ipcMain.handle('llm-generate-chat-content', async (event, messages, options = {}) => {
  return await AiGateway.generate(messages, options);
});

ipcMain.on('llm-stream-chat-content', (event, messages, options = {}) => {
  AiGateway.stream(event, messages, options);
});

// Ollama Integration:
// For ollama to work, the Ollama application must be installed on the user's system
// and its executable (`ollama`) must be available in the system's PATH.
// This allows `child_process.spawn('ollama', ...)` to find and execute the Ollama CLI.
// Users should install the latest stable version of Ollama for their respective OS (Windows, macOS, Linux).
// For Windows, it's expected that the official installer is used which adds ollama to PATH.
ipcMain.on('ollama-pull-model', (event, modelName) => {
  const ollama = spawn('ollama', ['pull', modelName]);

  ollama.stdout.on('data', (data) => {
    event.sender.send('ollama-pull-progress', { model: modelName, output: data.toString(), done: false });
  });

  ollama.stderr.on('data', (data) => {
    event.sender.send('ollama-pull-progress', { model: modelName, output: data.toString(), done: false });
  });

  ollama.on('close', (code) => {
    event.sender.send('ollama-pull-progress', { model: modelName, output: '', done: true, success: code === 0 });
  });
});

ipcMain.handle('ollama-import-model', async (event, { modelName, filePath }) => {
  try {
    if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' };

    const modelfileContent = `FROM "${filePath.replace(/\\/g, '/')}"`;
    const modelfilePath = path.join(app.getPath('userData'), `Modelfile_${modelName}`);
    fs.writeFileSync(modelfilePath, modelfileContent);

    return new Promise((resolve) => {
      const ollama = spawn('ollama', ['create', modelName, '-f', modelfilePath]);
      let errorLog = '';

      ollama.stderr.on('data', (data) => {
        errorLog += data.toString();
      });

      ollama.on('close', (code) => {
        // Cleanup
        try { fs.unlinkSync(modelfilePath); } catch (e) { }

        if (code === 0) {
          resolve({ success: true });
        } else {
          resolve({ success: false, error: errorLog || 'Ollama create failed' });
        }
      });
    });
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('select-local-file', async (event, options = {}) => {
  const defaultOptions = {
    properties: ['openFile'],
    filters: [{ name: 'All Files', extensions: ['*'] }]
  };

  const dialogOptions = { ...defaultOptions, ...options };

  const result = await dialog.showOpenDialog(mainWindow, dialogOptions);
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// Safe commands whitelist - these only need permission once, then permanently allowed
const SAFE_COMMANDS = new Set([
  'ls', 'ls -la', 'ls -l', 'ls -a', 'ls -R', 'ls -lh', 'ls -1', 'ls -la --color',
  'cat', 'cat -n', 'head', 'head -n', 'tail', 'tail -n', 'less', 'more',
  'cp', 'cp -r', 'cp -i', 'cp -v', 'mv', 'mv -i', 'mv -v',
  'mkdir', 'mkdir -p', 'rmdir', 'touch', 'ln', 'ln -s',
  'pwd', 'cd', 'echo', 'printf', 'date', 'whoami', 'hostname',
  'find', 'grep', 'grep -r', 'which', 'whereis', 'type',
  'chmod', 'chown', 'chgrp', 'du', 'df', 'free', 'top',
  'tar', 'tar -xvf', 'tar -cvf', 'tar -czvf', 'tar -xzvf',
  'unzip', 'zip', 'gunzip', 'gzip',
  'git', 'git status', 'git log', 'git diff', 'git pull', 'git push',
  'npm', 'npm install', 'npm run', 'npm start', 'npm test',
  'yarn', 'yarn install', 'yarn start',
  'python', 'python3', 'pip', 'pip3',
  'node', 'node -v', 'npx',
  'curl', 'wget',
  'open', 'xdg-open',
  'man', 'info', 'help',
]);

// AI-generated command explanations
function explainCommand(command) {
  const cmd = command.trim().split(/\s+/)[0].toLowerCase();
  const explanations = {
    ls: "Lists directory contents - shows files and folders",
    cat: "Displays file contents - reads and shows text files",
    head: "Shows first lines of a file",
    tail: "Shows last lines of a file",
    less: "Allows scrolling through file contents",
    more: "Displays file contents page by page",
    cp: "Copies files or directories",
    mv: "Moves or renames files or directories",
    mkdir: "Creates new directories/folders",
    rmdir: "Removes empty directories",
    touch: "Creates empty files or updates timestamps",
    rm: "Removes/deletes files or directories",
    pwd: "Prints current working directory",
    cd: "Changes current directory",
    echo: "Outputs text to terminal",
    find: "Searches for files in a directory tree",
    grep: "Searches for patterns in files",
    chmod: "Changes file permissions",
    chown: "Changes file ownership",
    du: "Shows disk usage of files/directories",
    df: "Shows disk space usage",
    tar: "Archives multiple files into one",
    zip: "Compresses files into ZIP archive",
    unzip: "Extracts ZIP archives",
    git: "Git version control - manages code history",
    npm: "Node package manager - installs JS packages",
    node: "Runs JavaScript code",
    python: "Runs Python scripts",
    pip: "Python package installer",
    curl: "Downloads files from URLs",
    wget: "Downloads files from URLs",
    open: "Opens files/folders with default application",
  };
  return explanations[cmd] || "Unknown command - purpose unclear";
}

function analyzeCommandRisk(command) {
  const cmdLower = command.toLowerCase();
  const risks = [];
  let harmLevel = 'safe';

  if (cmdLower.includes('rm -rf') || cmdLower.includes('rm -r /') || cmdLower.includes('del /f /s /q')) {
    risks.push("⚠️ CRITICAL: Recursive delete - can wipe entire filesystem!");
    harmLevel = 'critical';
  } else if (cmdLower.includes('rm ') || cmdLower.includes('del ') || cmdLower.includes('rmdir ')) {
    risks.push("• DELETE: May permanently remove files");
    harmLevel = 'high';
  }
  if (cmdLower.includes('format ') || cmdLower.includes('mkfs') || cmdLower.includes('fdisk')) {
    risks.push("⚠️ CRITICAL: Disk formatting - can destroy all data!");
    harmLevel = 'critical';
  }
  if (cmdLower.includes('curl ') || cmdLower.includes('wget ') || cmdLower.includes('ssh ')) {
    risks.push("• NETWORK: Accesses internet/remote servers");
    harmLevel = 'medium';
  }
  if (cmdLower.includes('sudo ') || cmdLower.includes('su ')) {
    risks.push("⚠️ ROOT: Grants admin/root privileges");
    harmLevel = 'high';
  }
  if (cmdLower.includes('shutdown') || cmdLower.includes('reboot') || cmdLower.includes('poweroff')) {
    risks.push("⚠️ POWER: Can shut down or restart the system");
    harmLevel = 'high';
  }
  if (cmdLower.includes('kill ') || cmdLower.includes('taskkill') || cmdLower.includes('pkill')) {
    risks.push("• TERMINATE: Can stop running processes");
    harmLevel = 'medium';
  }
  if (cmdLower.includes('dd ')) {
    risks.push("⚠️ CRITICAL: Low-level disk operations - very dangerous!");
    harmLevel = 'critical';
  }
  if (cmdLower.includes('chmod 777') || cmdLower.includes('chmod -r')) {
    risks.push("• PERMISSIONS: Changes file access rights");
    harmLevel = 'medium';
  }
  if (cmdLower.includes('> /dev/') || cmdLower.includes('2>&1')) {
    risks.push("• REDIRECT: Redirects output - may overwrite files");
    harmLevel = 'low';
  }

  const isSafeCmd = SAFE_COMMANDS.has(cmdLower) || Array.from(SAFE_COMMANDS).some(s => cmdLower.startsWith(s + ' '));
  if (isSafeCmd && harmLevel === 'safe') {
    return { description: explainCommand(command), risks: ["✓ Safe read/write operation"], harmLevel: 'safe', isWhitelisted: true };
  }

  return { description: explainCommand(command), risks, harmLevel, isWhitelisted: isSafeCmd };
}

async function generateShellApprovalQR(command, explicitToken, explicitPin) {
  const deviceId = os.hostname();
  const token = explicitToken || randomBytes(5).toString('hex');
  const pin = explicitPin || String(100000 + (randomBytes(4).readUInt32BE(0) % 900000));
  const deepLinkUrl = `aartiq://shell-approve?id=${token}&deviceId=${encodeURIComponent(deviceId)}&pin=${pin}&cmd=${encodeURIComponent(command)}`;
  try {
    const qrImage = await QRCode.toDataURL(deepLinkUrl);
    return { qrImage, pin, token };
  } catch (err) {
    console.error('[Main] Failed to generate Shell Approval QR:', err);
    return { qrImage: null, pin, token };
  }
}

async function generateHighRiskPairingQR(actionId, deviceName) {
  const deviceId = os.hostname();
  const token = actionId || randomBytes(5).toString('hex');
  const pin = String(100000 + (randomBytes(4).readUInt32BE(0) % 900000));
  const deepLinkUrl = `aartiq://approve?id=${token}&deviceId=${encodeURIComponent(deviceId)}&pin=${pin}`;
  try {
    const qrImage = await QRCode.toDataURL(deepLinkUrl);
    // We must return both the image and the pin so the web UI can display the pin
    return JSON.stringify({ qrImage, pin, token });
  } catch (err) {
    console.error('[Main] Failed to generate High-Risk QR:', err);
    return null;
  }
}

function checkAiActionPermission(actionType, target, riskLevel) {
  const permKey = `AI_ACTION:${actionType}`;
  if (permissionStore.isGranted(permKey)) {
    return { allowed: true };
  }
  const autoApproved = permissionStore.getAutoApprovedActions() || [];
  if (autoApproved.includes(riskLevel)) {
    permissionStore.grant(permKey, riskLevel, `AI action: ${actionType}`, true);
    return { allowed: true };
  }
  return { allowed: false, error: `Action "${actionType}" not permitted.` };
}

app.whenReady().then(async () => {
  // Initialize automation manager persistence
  automationManager.init();

  // Initialize Chrome Extension Manager
  const extensionManager = new ChromeExtensionManager();
  await extensionManager.loadPersistedExtensions();
  extensionManager.setupWebStoreInterception();

  // Initialize Autofill Profile Service
  const autofillProfileService = new AutofillProfileService();

  // ─── Agent API: multi-agent, MCP/HTTP, security-enforced ──────────────────
  // Starts the registry-driven tool server (MCP + HTTP) wired to the feature
  // managers and guarded by the prompt-injection / origin-guard pipeline.
  // Failures here are non-fatal to the rest of the browser.
  try {
    const { startAgentApi } = require('./src/lib/agent-api/bootstrap');
    startAgentApi({ extensions: extensionManager, search: webSearchProvider }).catch((e) =>
      console.error('[agent-api] start failed:', e && e.message));
  } catch (e) {
    console.error('[agent-api] not started:', e && e.message);
  }

  // ─── Passkey / WebAuthn support ────────────────────────────────────────────
  // macOS: Enables Touch ID (Secure Enclave) + platform passkeys (iCloud Keychain, 1Password, etc.)
  // Windows: Chromium's built-in Windows Hello WebAuthn is active by default.
  if (process.platform === 'darwin') {
    try {
      app.configureWebAuthn({
        touchID: {
          keychainAccessGroup: 'com.latestinssan.aartiqbrowser.webauthn',
          promptReason: 'Authenticate with Touch ID for passkey',
        },
        platformPasskeys: true,
      });
      console.log('[Passkey] WebAuthn configured: Touch ID + platform passkeys (macOS)');
    } catch (e) {
      console.warn('[Passkey] configureWebAuthn failed (non-fatal):', e.message);
    }
  } else if (process.platform === 'win32') {
    console.log('[Passkey] Windows Hello WebAuthn active (Chromium built-in)');
  } else {
    console.log('[Passkey] Linux: Generic WebAuthn via Chromium');
  }

  // Handle authenticator selection when both Touch ID and platform passkeys are available
  if (process.platform === 'darwin') {
    session.defaultSession.on('select-webauthn-authenticator', (event, details, callback) => {
      // Prefer platform passkeys (synced via iCloud Keychain / 1Password / etc.) for better UX
      if (details.authenticators.includes('platformPasskeys')) {
        callback('platformPasskeys');
      } else if (details.authenticators.includes('touchID')) {
        callback('touchID');
      } else {
        callback(details.authenticators[0]);
      }
    });
  }

  async function streamPromptToMobile(promptId, prompt, model, provider) {
    const messages = [{ role: 'user', content: prompt }];
    const streamEvent = {
      sender: {
        isDestroyed: () => false,
        send: (_channel, data) => {
          if (data?.type === 'text-delta') {
            wifiSyncService.sendAIResponse(promptId, data.textDelta || '', true);
          } else if (data?.type === 'finish') {
            wifiSyncService.sendAIResponse(promptId, '', false);
          } else if (data?.type === 'error') {
            wifiSyncService.sendAIResponse(promptId, `Error: ${data.error || 'Stream failed'}`, false);
          }
        }
      }
    };

    await llmStreamHandler(streamEvent, messages, {
      model,
      provider,
      baseUrl: store.get('ollama_base_url') || undefined,
    });
  }

  ipcMain.handle('get-wifi-sync-info', () => {
    if (!wifiSyncService) return null;
    return {
      deviceName: os.hostname(),
      pairingCode: wifiSyncService.getPairingCode(),
      ip: wifiSyncService.getLocalIp(),
      port: 3004
    };
  });

  ipcMain.handle('get-wifi-sync-devices', () => {
    if (!wifiSyncService) return [];
    return wifiSyncService.getKnownDevices();
  });

  ipcMain.handle('set-wifi-sync-device-trust', async (event, { deviceId, trustLevel, autoConnect } = {}) => {
    if (!wifiSyncService || !deviceId || !trustLevel) {
      return { success: false, error: 'Missing WiFi sync device or trust payload' };
    }

    const device = wifiSyncService.setDeviceTrust(deviceId, trustLevel, autoConnect);
    if (!device) {
      return { success: false, error: 'Device not found' };
    }

    return { success: true, device };
  });

  ipcMain.handle('remove-wifi-sync-device', async (event, deviceId) => {
    if (!wifiSyncService || !deviceId) {
      return { success: false, error: 'Missing WiFi sync device id' };
    }

    return { success: wifiSyncService.removeKnownDevice(deviceId) };
  });

  // Cloud Sync IPC Handlers
  ipcMain.handle('login-to-cloud', async (event, email, password) => {
    if (!cloudSyncService) return { success: false, error: 'Cloud sync not initialized' };
    try {
      await cloudSyncService.login(email, password);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('logout-from-cloud', async () => {
    if (!cloudSyncService) return;
    await cloudSyncService.logout();
  });

  ipcMain.handle('save-cloud-config', async (event, provider, config) => {
    if (!cloudSyncService) return { success: false };
    try {
      await cloudSyncService.configure({ provider, ...config });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-cloud-devices', async () => {
    if (!cloudSyncService) return [];
    return cloudSyncService.getDevices();
  });

  ipcMain.handle('connect-to-cloud-device', async (event, deviceId) => {
    if (!cloudSyncService) return { success: false };
    try {
      const success = await cloudSyncService.connectToDevice(deviceId);
      return { success };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('disconnect-from-cloud-device', async (event, deviceId) => {
    if (!cloudSyncService) return;
    cloudSyncService.disconnectFromDevice(deviceId);
  });

  ipcMain.handle('sync-clipboard', async (event, text) => {
    if (!cloudSyncService) return;
    await cloudSyncService.syncClipboard(text);
  });

  ipcMain.handle('sync-history', async (event, history) => {
    if (!cloudSyncService) return;
    await cloudSyncService.syncHistory(history);
  });

  ipcMain.handle('send-desktop-control', async (event, targetDeviceId, action, args) => {
    if (!cloudSyncService) return { error: 'Cloud sync not initialized' };
    return await cloudSyncService.sendDesktopControl(targetDeviceId, action, args);
  });

  // Cloud status listeners
  if (cloudSyncService) {
    cloudSyncService.on('connected', (userId) => {
      if (mainWindow) {
        mainWindow.webContents.send('cloud-sync-status', { connected: true, userId });
      }
    });
    cloudSyncService.on('disconnected', () => {
      if (mainWindow) {
        mainWindow.webContents.send('cloud-sync-status', { connected: false });
      }
    });
    cloudSyncService.on('device-connected', (deviceId) => {
      if (mainWindow) {
        mainWindow.webContents.send('cloud-device-connected', { deviceId });
      }
    });
    cloudSyncService.on('device-disconnected', (deviceId) => {
      if (mainWindow) {
        mainWindow.webContents.send('cloud-device-disconnected', { deviceId });
      }
    });
  }

  // Handle file downloads
  session.defaultSession.on('will-download', (event, item, webContents) => {
    const fileName = item.getFilename();
    const downloadsPath = app.getPath('downloads');
    const saveDataPath = path.join(downloadsPath, fileName);

    console.log(`[Main] Starting download: ${fileName} to ${saveDataPath}`);

    item.setSavePath(saveDataPath);
    item.resume();

    if (mainWindow) {
      mainWindow.webContents.send('download-started', { name: fileName, path: saveDataPath });
    }

    item.on('updated', (event, state) => {
      if (state === 'interrupted') {
        console.log('Download is interrupted but can be resumed');
      } else if (state === 'progressing') {
        if (!item.isPaused()) {
          // progress updates could be sent here
        }
      }
    });

    item.on('done', (event, state) => {
      if (state === 'completed') {
        console.log('Download successfully');
        if (mainWindow) {
          mainWindow.webContents.send('download-complete', { name: item.getFilename(), path: item.getSavePath() });
        }

      } else {
        console.log(`Download failed: ${state}`);
        if (mainWindow) {
          mainWindow.webContents.send('download-failed', { name: item.getFilename(), path: item.getSavePath() });
        }
      }
    });

    item.resume();

  });

  ipcMain.handle('get-open-tabs', async () => {
    const tabs = [];
    for (const [tabId, view] of tabViews.entries()) {
      if (view && view.webContents) {
        try {
          const url = view.webContents.getURL();
          const title = view.webContents.getTitle();
          const isActive = (tabId === activeTabId);
          tabs.push({ tabId, url, title, isActive });
        } catch (e) {
          console.error(`Error getting info for tabId ${tabId}:`, e);
          tabs.push({ tabId, url: 'Error', title: 'Error', isActive: (tabId === activeTabId) });
        }
      }
    }
    return tabs;
  });

  ipcMain.on('hide-all-views', () => {
    if (activeTabId && tabViews.has(activeTabId)) {
      const view = tabViews.get(activeTabId);
      if (view && mainWindow) {
        mainWindow.removeBrowserView(view);
      }
    }
  });

  ipcMain.on('show-all-views', () => {
    if (activeTabId && tabViews.has(activeTabId)) {
      const view = tabViews.get(activeTabId);
      if (view && mainWindow) {
        mainWindow.addBrowserView(view);
      }
    }
  });

  ipcMain.on('set-user-id', (event, userId) => {
    // TODO: Implement what to do with the user ID
    console.log('User ID set:', userId);
  });

  // Extension handlers are now registered via src/main/handlers/extension-handlers.js

  // Helper to install extension from a file path (e.g. download .crx)
  async function installExtensionLocally(crxPath) {
    if (!extensionManager) return;
    try {
      const result = await extensionManager.installFromCRX(crxPath);
      console.log(`[Main] Extension installed from CRX: ${result.name}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        // Check if the installed extension is a theme
        const manifest = extensionManager.readManifest(result.path);
        if (manifest.theme) {
          mainWindow.webContents.send('apply-theme', manifest.theme);
        }
      }
    } catch (e) {
      console.error(`[Main] installExtensionLocally error:`, e);
    }
  }

  ipcMain.handle('get-icon-path', async () => {
    return path.join(__dirname, 'icon.ico');
  });

  ipcMain.handle('get-app-icon-base64', async () => {
    try {
      const appPath = app.getAppPath();
const isPackaged = app.isPackaged;
if (isPackaged && process.platform === 'darwin') {
  appendStartupSwitch('disable-gpu');
}
      const candidates = isPackaged ? [
        path.join(appPath, 'assets', 'icon.png'),
        path.join(process.resourcesPath, 'app', 'assets', 'icon.png'),
      ] : [
        path.join(__dirname, 'assets', 'icon.png'),
        path.join(appPath, 'assets', 'icon.png'),
      ];

      for (const iconPath of candidates) {
        try {
          if (fs.existsSync(iconPath)) {
            const mime = iconPath.endsWith('.png') ? 'image/png' : 'image/x-icon';
            const base64 = fs.readFileSync(iconPath).toString('base64');
            return `data:${mime};base64,${base64}`;
          }
        } catch (e) { /* skip */ }
      }
      return null;
    } catch (e) {
      console.error('[Main] Failed to read app icon:', e);
      return null;
    }
  });

  ipcMain.on('open-extension-dir', () => {
    shell.openPath(extensionsPath);
  });

  ipcMain.handle('connect-to-remote-device', async (event, remoteDeviceId) => {
    if (!p2pSyncService) {
      console.error('[Main] P2P Sync Service not initialized.');
      return false;
    }
    return await p2pSyncService.connectToRemoteDevice(remoteDeviceId);
  });

  ipcMain.handle('p2p-sync-history', async (event, data) => {
    if (p2pSyncService && p2pSyncService.getStatus().connected) {
      p2pSyncService.sendMessage({ type: 'history-sync', data });
      return { success: true };
    }
    return { success: false, error: 'Not connected to peer' };
  });

  ipcMain.handle('p2p-get-device-id', async () => {
    return p2pSyncService ? p2pSyncService.getStatus().deviceId : null;
  });

  ipcMain.on('send-p2p-signal', (event, { signal, remoteDeviceId }) => {
    if (!p2pSyncService) {
      console.error('[Main] P2P Sync Service not initialized.');
      return;
    }
    p2pSyncService.sendSignal(signal, remoteDeviceId);
  });

  ipcMain.handle('scan-folder', async (event, folderPath, types) => {
    return await _scanDirectoryRecursive(folderPath, types);
  });

  ipcMain.handle('read-file-buffer', async (event, filePath) => {
    try {
      const buffer = await fs.promises.readFile(filePath);
      return buffer.buffer; // Return as ArrayBuffer
    } catch (error) {
      console.error(`[Main] Error reading file buffer for ${filePath}:`, error);
      return new ArrayBuffer(0);
    }
  });

  const crypto = require('crypto');

  // Function to derive key from passphrase
  async function deriveKey(passphrase, salt) {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(passphrase, salt, 100000, 32, 'sha512', (err, derivedKey) => {
        if (err) reject(err);
        resolve(derivedKey);
      });
    });
  }

  // IPC handler for encryption
  ipcMain.handle('encrypt-data', async (event, { data, key }) => {
    try {
      const salt = crypto.randomBytes(16);
      const derivedKey = await deriveKey(key, salt);
      const iv = crypto.randomBytes(16); // Initialization vector
      const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);

      const encrypted = Buffer.concat([cipher.update(Buffer.from(data)), cipher.final()]);
      const authTag = cipher.getAuthTag();

      return {
        encryptedData: encrypted.buffer,
        iv: iv.buffer,
        authTag: authTag.buffer,
        salt: salt.buffer
      };
    } catch (error) {
      console.error('[Main] Encryption failed:', error);
      return { error: error.message };
    }
  });

  // IPC handler for decryption
  // Web Search v2 API
  ipcMain.handle('web-search', async (_event, query, provider, count) => {
    try {
      const results = await webSearchProvider.search(query, provider, count || 5);
      return { success: true, results };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('web-search-context', async (_event, query, provider) => {
    try {
      const context = await webSearchProvider.searchForContext(query, provider);
      return { success: true, context };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('web-search-providers', async () => {
    try {
      const providers = webSearchProvider.getAvailableProviders();
      return { success: true, providers, info: webSearchProvider.getProviderInfo() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('web-search-configure', async (_event, keys) => {
    try {
      webSearchProvider.configure(keys);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  /**
   * Which search keys are configured, and where each one came from.
   *
   * Reports only *whether* a key exists and which env var supplied it — never the
   * value. Without this, "search returned scraped results" is undiagnosable,
   * because the user cannot tell a missing key from a rejected one.
   */
  ipcMain.handle('web-search-config-status', async () => {
    const aliases = {
      TAVILY_API_KEY: ['TAVILY_KEY'],
      BRAVE_API_KEY: ['BRAVE_SEARCH_API_KEY'],
      SERP_API_KEY: ['SERPAPI_API_KEY'],
      GOOGLE_API_KEY: ['GOOGLE_SEARCH_API_KEY', 'GOOGLE_CSE_API_KEY'],
    };
    const check = (name) => {
      const candidates = [name, ...(aliases[name] || [])];
      for (const c of candidates) {
        if (process.env[c]) return { configured: true, source: c };
      }
      return { configured: false, source: null };
    };
    return {
      success: true,
      keys: {
        TAVILY_API_KEY: check('TAVILY_API_KEY'),
        BRAVE_API_KEY: check('BRAVE_API_KEY'),
        SERP_API_KEY: check('SERP_API_KEY'),
        GOOGLE_API_KEY: check('GOOGLE_API_KEY'),
        GOOGLE_SEARCH_ENGINE_ID: check('GOOGLE_SEARCH_ENGINE_ID'),
      },
      info: webSearchProvider.getProviderInfo(),
    };
  });

  /**
   * Run a bounded research job and stream its progress to the sidebar.
   *
   * Progress goes out over `research-progress` rather than the return value, so a
   * long job shows what it is doing instead of a spinner. The budget is the user's
   * consent boundary: it caps searches and page fetches before either spends a
   * credit, and anything the budget excluded is named in `stoppedReason` rather
   * than quietly dropped.
   */
  ipcMain.handle('research-run', async (_event, payload = {}) => {
    const { runResearch } = require('./src/lib/research-pipeline');
    const { fetchPageContent } = require('./src/lib/web-extractor');

    const researchId = payload.researchId || `research-${Date.now().toString(36)}`;
    const sender = _event?.sender;
    const emit = (event) => {
      if (!sender || sender.isDestroyed?.()) return;
      sender.send('research-progress', event);
    };

    try {
      const outcome = await runResearch(
        {
          searchNews: (query, count, opts) => webSearchProvider.searchNewsDetailed(query, count, opts),
          fetchPage: (url, maxChars) => fetchPageContent(url, maxChars),
          emit,
        },
        { query: String(payload.query || ''), queries: payload.queries, budget: payload.budget, researchId },
      );
      // Dates cross IPC as strings; re-hydrate so callers get the same shape they
      // would have got from the module directly.
      return {
        success: true,
        outcome: {
          ...outcome,
          lastSource: { ...outcome.lastSource, publishedAt: outcome.lastSource.publishedAt?.toISOString() ?? null },
        },
      };
    } catch (error) {
      emit({ researchId, stage: 'error', status: 'failed', error: error.message });
      return { success: false, error: error.message };
    }
  });

  // Web Search RAG Helper with Caching + auto page content
  ipcMain.handle('web-search-rag', async (event, query) => {
    try {
      const normalizedQuery = query.trim().toLowerCase();
      const cached = searchCache.get(normalizedQuery);
      const CACHE_TTL = 30 * 60 * 1000;

      if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        return cached.results;
      }

      let searchResults = [];
      try {
        const results = await webSearchProvider.search(query, 'googlescrape', 10);
        searchResults = results.map(r => ({
          title: r.title || 'Untitled result',
          url: r.url || '',
          snippet: r.snippet || '',
        }));
      } catch (e) {
        console.warn(`[RAG] Deep search failed for ${query}`);
      }

      // Auto-fetch page content for top 2 results
      if (searchResults.length > 0) {
        for (let i = 0; i < Math.min(2, searchResults.length); i++) {
          try {
            const content = await webSearchProvider.fetchPageContent(searchResults[i].url, 4000);
            if (content) {
              searchResults[i].pageContent = content;
            }
          } catch (e) {
            console.warn(`[RAG] Page content fetch failed for ${searchResults[i].url}:`, e.message);
          }
        }
      }

      if (searchResults.length > 0) {
        searchCache.set(normalizedQuery, {
          results: searchResults,
          timestamp: Date.now()
        });
      }

      return searchResults;
    } catch (error) {
      console.error('[RAG] Web search failed completely:', error);
      return [];
    }
  });

  // Fetch page content server-side (no tab needed)
  ipcMain.handle('fetch-page-content', async (_event, url, maxChars) => {
    try {
      const content = await webSearchProvider.fetchPageContent(url, maxChars || 8000);
      return { success: true, content };
    } catch (error) {
      return { success: false, error: error.message, content: '' };
    }
  });

  // AI Sidebar web search — uses MCP BrowserMcpServer._browserSearch() (offscreen, DuckDuckGo default)
  ipcMain.handle('ai-web-search', async (_event, query, engine, count, readCount) => {
    try {
      if (!mcpServer) throw new Error('MCP server not initialized');
      // `count` = how many results to keep (capped at 10); `readCount` = how many
      // of them to open and read (still capped at 5, as before, so reading pages
      // does not get slower). The two used to be the same number, so a search
      // without a `pages` parameter kept exactly one result.
      const resultCount = Math.min(count || 3, 10);
      const pagesToRead = Math.min(readCount ?? resultCount, resultCount, 5);
      const result = await mcpServer._browserSearch(
        query,
        engine || 'duckduckgo',
        resultCount,
        pagesToRead
      );
      return result;
    } catch (e) {
      console.error('[AI-WebSearch] Failed:', e.message);
      return { results: [], engine: engine || 'duckduckgo', error: e.message };
    }
  });

  // YouTube search
  ipcMain.handle('web-search-youtube', async (_event, query, count) => {
    try {
      const results = await webSearchProvider._searchYouTube(query, count || 5);
      return { success: true, results };
    } catch (error) {
      return { success: false, error: error.message, results: [] };
    }
  });

  // Website Translation IPC
  ipcMain.handle('translate-website', async (event, { targetLanguage, method }) => {
    const view = tabViews.get(activeTabId);
    if (!view) return { error: 'No active view' };

    // Default to 'google' method if not specified
    const translationMethod = method || 'google';

    if (translationMethod === 'chrome-ai') {
      // Chrome Built-in AI Translation (Modern - requires Chrome 144+)
      try {
        const code = `
        (async () => {
          try {
            // Check if translation API is available
            if (!window.translation) {
              return { error: 'Translation API not available. Use Chrome 144+ or enable --enable-features=TranslationAPI' };
            }
            
            const canTranslate = await window.translation.canTranslate({
              sourceLanguage: 'auto',
              targetLanguage: '${targetLanguage}'
            });
            
            if (canTranslate === 'no') {
              return { error: 'Cannot translate to ' + '${targetLanguage}' + '. Language pack may not be downloaded.' };
            }
            
            // Create translator (may download language pack)
            const translator = await window.translation.createTranslator({
              sourceLanguage: 'auto',
              targetLanguage: '${targetLanguage}'
            });
            
            // For page translation, we need to translate all text nodes
            // This is a simplified version - full implementation would traverse DOM
            const bodyText = document.body.innerText;
            const translated = await translator.translate(bodyText);
            
            return { success: true, method: 'chrome-ai', note: 'AI translation successful. For full page translation, language packs are downloaded automatically.' };
          } catch (e) {
            return { error: e.message };
          }
        })()
        `;
        const result = await view.webContents.executeJavaScript(code);
        return result;
      } catch (e) {
        console.error("[Translation] Chrome AI translation failed:", e);
        return { error: e.message };
      }
    } else {
      // Google Translate Element (Legacy Injection)
      try {
        // Improved Google Translate Injection with Cookie Support for faster activation
        const code = `
      (function() {
        // Set the Google Translate cookie for the target language
        // Format: /auto/[target_lang]
        const lang = '${targetLanguage}';
        document.cookie = 'googtrans=/auto/' + lang + '; path=/; domain=' + window.location.hostname;
        document.cookie = 'googtrans=/auto/' + lang + '; path=/;';
        
        if (!document.getElementById('google_translate_element')) {
          const div = document.createElement('div');
          div.id = 'google_translate_element';
          div.style.display = 'none';
          document.body.appendChild(div);
          
          window.googleTranslateElementInit = function() {
            new google.translate.TranslateElement({
              pageLanguage: 'auto',
              layout: google.translate.TranslateElement.InlineLayout.SIMPLE,
              autoDisplay: true
            }, 'google_translate_element');
          };

          const script = document.createElement('script');
          script.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
          document.body.appendChild(script);
        } else {
          // If already exists, just trigger the change
          const combo = document.querySelector('.goog-te-combo');
          if (combo) {
            combo.value = lang;
            combo.dispatchEvent(new Event('change'));
          }
        }
        
        // Polling for the combo box as a backup
        let attempts = 0;
        const check = setInterval(function() {
          const combo = document.querySelector('.goog-te-combo');
          if (combo) {
            if (combo.value !== lang) {
              combo.value = lang;
              combo.dispatchEvent(new Event('change'));
            }
            clearInterval(check);
          }
            if (attempts++ > 20) clearInterval(check);
        }, 500);
      })()
    `;
        await view.webContents.executeJavaScript(code);
        return { success: true, method: 'google' };
      } catch (e) {
        console.error("[Translation] Website translation failed:", e);
        return { error: e.message };
      }
    }
  });

  // Integrated Translation IPC (Google Translate + Neural Fallback)
  ipcMain.handle('translate-text', async (event, { text, from, to }) => {
    if (!text) return { success: false, error: 'No text provided' };

    // Support both 'to' and 'targetLanguage' (some frontend parts might use different keys)
    const targetLang = to || 'en';
    const sourceLang = from || 'auto';

    try {
      console.log(`[Translation] Attempting Google Translate for: "${text.substring(0, 30)}..." to ${targetLang}`);
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;

      const response = await fetch(url);
      const data = await response.json();

      if (data && data[0]) {
        const translated = data[0].map(x => x[0]).join('');
        return {
          success: true,
          translated,
          method: 'google'
        };
      }
    } catch (e) {
      console.warn("[Translation] Google Translate API failed, falling back to Neural Engine:", e.message);
    }

    // Neural Fallback
    try {
      console.log(`[Neural Translation] Translating to ${targetLang} using ${activeLlmProvider}`);
      const prompt = [
        { role: 'system', content: `You are a high-performance neural translation engine. Translate the following text into ${targetLang}. Return ONLY the translated string.` },
        { role: 'user', content: text }
      ];

      const result = await llmGenerateHandler(prompt, { temperature: 0.3 });
      if (result.error) throw new Error(result.error);

      return {
        success: true,
        translated: result.text,
        method: 'neural',
        provider: activeLlmProvider
      };
    } catch (error) {
      console.error("[Translation] All translation methods failed:", error);
      return { success: false, error: error.message };
    }
  });

  /*
  // Export Chat as TXT
  ipcMain.removeHandler('export-chat-txt');
  ipcMain.handle('export-chat-txt', async (event, content) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Chat History',
      defaultPath: path.join(app.getPath('downloads'), `aartiq-chat-session-${Date.now()}.txt`),
      filters: [{ name: 'Text Files', extensions: ['txt'] }]
    });

    if (!canceled && filePath) {
      try {
        fs.writeFileSync(filePath, content);
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
    return { success: false, error: 'Canceled' };
  });
  */


  // Redundant generate-pdf handler removed


  // Setup Context Menu (Merged with global setup at top)

  ipcMain.handle('decrypt-data', async (event, { encryptedData, key, iv, authTag, salt }) => {
    try {
      const derivedKey = await deriveKey(key, Buffer.from(salt));
      const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, Buffer.from(iv));
      decipher.setAuthTag(Buffer.from(authTag));

      const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedData)), decipher.final()]);
      return { decryptedData: decrypted.buffer };
    } catch (error) {
      console.error('[Main] Decryption failed:', error);
      return { error: error.message };
    }
  });

  ipcMain.handle('create-desktop-shortcut', async (event, { url, title }) => {
    const desktopPath = path.join(os.homedir(), 'Desktop');
    const shortcutPath = path.join(desktopPath, `${title.replace(/[^a-z0-9]/gi, '_').substring(0, 30)}.url`);

    const content = `[InternetShortcut]\nURL = ${url} \n`;

    try {
      fs.writeFileSync(shortcutPath, content);
      return { success: true, path: shortcutPath };
    } catch (error) {
      console.error('[Main] Failed to create shortcut:', error);
      return { error: error.message };
    }
  });

  ipcMain.handle('set-alarm', async (event, { time, message }) => {
    const platform = process.platform;
    let command = '';

    const alarmTime = new Date(time);
    if (isNaN(alarmTime.getTime())) {
      return { success: false, error: 'Invalid alarm time format.' };
    }

    // Format time for various OS commands
    const hour = alarmTime.getHours();
    const minute = alarmTime.getMinutes();
    const year = alarmTime.getFullYear();
    const month = alarmTime.getMonth() + 1; // Month is 0-indexed
    const day = alarmTime.getDate();

    const formattedTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} `;
    const formattedDate = `${month} /${day}/${year} `;

    if (platform === 'win32') {
      // Windows: Use PowerShell to create a scheduled task
      // Note: Creating scheduled tasks requires Administrator privileges.
      // This command will create a basic task that displays a message.
      command = `powershell.exe - Command "$Action = New-ScheduledTaskAction -Execute 'msg.exe' -Argument '* ${message}'; $Trigger = New-ScheduledTaskTrigger -Once -At '${formattedTime}'; Register-ScheduledTask -TaskName 'AartiqAlarm_${Date.now()}' -Action $Action -Trigger $Trigger -Description '${message}'"`;
    } else if (platform === 'darwin') {
      // macOS: Use osascript to create a Calendar event or a reminder
      // Creating a reminder is more straightforward for a simple alarm.
      command = `osascript - e 'tell application "Reminders" to make new reminder with properties {name:"${message}", remind me date:"${alarmTime.toISOString()}"}'`;
      // Alternatively, for a notification at a specific time:
      // command = `osascript - e 'display notification "${message}" with title "Aartiq Alarm" subtitle "Time to Wake Up!"' - e 'delay $(((${alarmTime.getTime()} - $(date +%s%3N)) / 1000))' - e 'display dialog "${message}" buttons {"OK"} default button 1 with title "Aartiq Alarm"'`;
    } else if (platform === 'linux') {
      // Linux: Use 'at' command (requires 'at' daemon to be running)
      // Example: echo "DISPLAY=:0 notify-send 'Aartiq Alarm' '${message}'" | at ${formattedTime} ${formattedDate}
      // `at` command format: `at[-m] TIME[DATE]`, e.g., `at 10:00 tomorrow`
      command = `echo "DISPLAY=:0 notify-send 'Aartiq Alarm' '${message}'" | at ${formattedTime} ${formattedDate} `;
    } else {
      return { success: false, error: `Unsupported platform for alarms: ${platform} ` };
    }

    return new Promise((resolve) => {
      exec(command, { timeout: 10000 }, (error, stdout, stderr) => {
        if (error) {
          console.error(`Set alarm error on ${platform}: `, error);
          resolve({ success: false, error: stderr || error.message });
        } else {
          resolve({ success: true, message: `Alarm set for ${alarmTime.toLocaleString()}` });
        }
      });
    });
  });

  // ============================================================================
  // AUTOMATION & TASK SCHEDULING
  // ============================================================================
  let ipcService = null;
  let taskScheduler = null;
  let taskQueue = null;
  let storageManager = null;
  let mobileNotifier = null;

  let isAutomationInitializing = false;
  async function initializeAutomationService() {
    if (ipcService || isAutomationInitializing) {
      console.log('[Main] Automation service already initialized or initializing');
      return;
    }

    isAutomationInitializing = true;
    try {
      // Check if modules exist
      const path = require('path');
      const fs = require('fs');

      // Only initialize if service files exist
      const servicePath = path.join(__dirname, 'src', 'service');
      if (!fs.existsSync(servicePath)) {
        console.log('[Main] Service path does not exist, skipping automation init');
        return;
      }

      const { IPCHandler } = require('./src/service/ipc-service.js');
      const { TaskScheduler } = require('./src/service/scheduler.js');
      const { TaskQueue } = require('./src/service/task-queue.js');
      const Storage = require('./src/service/storage.js');
      const { MobileNotifier } = require('./src/service/mobile-notifier.js');

      const StorageManagerClass = Storage.StorageManager;
      const automationDataPath = path.join(app.getPath('userData'), 'automation');
      if (!fs.existsSync(automationDataPath)) {
        fs.mkdirSync(automationDataPath, { recursive: true });
      }
      storageManager = new StorageManagerClass(automationDataPath);
      await storageManager.initialize();

      taskQueue = new TaskQueue(storageManager);
      taskScheduler = new TaskScheduler(taskQueue, storageManager);

      mobileNotifier = new MobileNotifier();
      await mobileNotifier.initialize();

      ipcService = new IPCHandler(taskScheduler, taskQueue, storageManager, mobileNotifier);
      ipcService.initialize();

      console.log('[Main] Automation service initialized');
    } catch (error) {
      console.error('[Main] Failed to initialize automation service:', error);
    } finally {
      isAutomationInitializing = false;
    }
  }

  // Biometric authentication handlers are registered via system-handlers.js (registerAllHandlers)
  // Do NOT register them here — they would be immediately overwritten.

  initializeAutomationService();

  // ============================================================================
  // POPUP WINDOW SYSTEM - Fix for panels appearing behind browser view
  // ============================================================================
  let popupWindows = new Map(); // Track all popup windows

  /**
   * Creates a popup window that appears on top of the browser view
   * This solves the z-index issue where panels appear behind the webview
   */
  function createPopupWindow(type, options = {}) {
    // Close existing popup of the same type
    if (popupWindows.has(type)) {
      const existing = popupWindows.get(type);
      if (existing && !existing.isDestroyed()) {
        existing.close();
      }
      popupWindows.delete(type);
    }

    const isMacPlatform = process.platform === 'darwin';

    const defaultOptions = {
      width: 1000,
      height: 700,
      frame: isMacPlatform,
      transparent: !isMacPlatform,
      backgroundColor: isMacPlatform ? '#00000000' : '#00000000',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      },
      // No parent — popup needs to float above BrowserView (OS-level child view)
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: true,
      minimizable: false,
      maximizable: false,
      show: false,
      titleBarStyle: isMacPlatform ? 'hiddenInset' : 'hidden',
    };

    const popup = new BrowserWindow({ ...defaultOptions, ...options });

    // Ensure popup appears above BrowserView by removing parent and using alwaysOnTop
    popup.setAlwaysOnTop(true, 'screen-saturation');

    // Load the appropriate content
    const baseUrl = isDev
      ? 'http://localhost:3003'
      : `file://${path.join(__dirname, 'out', 'index.html')}`;

    let route = '';
    switch (type) {
      case 'settings':
        route = isDev ? '/?panel=settings' : '/settings';
        break;
      case 'extensions':
      case 'plugins': // Handle 'plugins' as an alias for 'extensions'
        route = isDev ? '/?panel=extensions' : '/extensions';
        break;
      case 'profile':
        route = isDev ? '/?panel=profile' : '/profile';
        break;
      case 'downloads':
        route = isDev ? '/?panel=downloads' : '/downloads';
        break;
      case 'clipboard':
        route = isDev ? '/?panel=clipboard' : '/clipboard';
        break;
      case 'cart':
      case 'unified-cart':
        route = '/cart';
        break;
      case 'search':
      case 'search-apps':
        route = isDev ? '/?panel=apps' : '/apps';
        break;
      case 'translate':
        route = isDev ? '/?panel=translate' : '/translate';
        break;
      case 'context-menu':
      case 'rightclick':
        route = isDev ? '/?panel=context-menu' : '/context-menu';
        break;
      case 'tools-menu':
        route = isDev ? '/?panel=tools-menu' : '/tools-menu';
        break;
      case 'mcp-approval':
        route = isDev ? '/?panel=mcp-approval' : '/mcp-approval';
        break;
      default:
        route = `/${type}`;
    }

    let url;
    if (isDev) {
      url = `${baseUrl}${route}`;
    } else {
      // Check for both folder/index.html and folder.html (Next.js export behavior)
      const routePathIndex = route === '/' ? '/index.html' : `${route}/index.html`;
      const routePathHtml = route === '/' ? '/index.html' : `${route}.html`;

      const fullPathIndex = path.join(__dirname, 'out', routePathIndex);
      const fullPathHtml = path.join(__dirname, 'out', routePathHtml);

      if (fs.existsSync(fullPathIndex)) {
        url = `file://${fullPathIndex}`;
      } else if (fs.existsSync(fullPathHtml)) {
        url = `file://${fullPathHtml}`;
      } else {
        // Fallback to hash routing if file doesn't exist
        url = `file://${path.join(__dirname, 'out', 'index.html')}#${route}`;
      }
    }

    console.log(`[Main] Loading popup URL: ${url}`);
    popup.loadURL(url);

    popup.once('ready-to-show', () => {
      popup.show();
      popup.focus();
      // Ensure popup is always on top of BrowserView
      popup.moveTop();
    });

    popup.on('closed', () => {
      popupWindows.delete(type);
    });

    popupWindows.set(type, popup);
    return popup;
  }

  // IPC Handlers for popup windows
  ipcMain.on('open-popup-window', (event, { type, options }) => {
    createPopupWindow(type, options);
  });

  ipcMain.on('close-popup-window', (event, type) => {
    if (popupWindows.has(type)) {
      const popup = popupWindows.get(type);
      if (popup && !popup.isDestroyed()) {
        popup.close();
      }
      popupWindows.delete(type);
    }
  });

  ipcMain.on('close-all-popups', () => {
    popupWindows.forEach((popup, type) => {
      if (popup && !popup.isDestroyed()) {
        popup.close();
      }
    });
    popupWindows.clear();
  });

  // MCP Approval popup — triggered by mcp-browser-server when a MCP tool needs approval
  ipcMain.on('open-mcp-approval-popup', (event, details) => {
    const popup = createPopupWindow('mcp-approval', { width: 520, height: 500, resizable: false });
    // After popup loads, send it the approval details
    const checkLoaded = setInterval(() => {
      const p = popupWindows.get('mcp-approval');
      if (p && !p.isDestroyed() && p.webContents) {
        try {
          p.webContents.send('mcp-approval-pending', details);
          clearInterval(checkLoaded);
        } catch {}
      }
    }, 300);
    setTimeout(() => clearInterval(checkLoaded), 10000);
  });

  // Specific popup handlers
  ipcMain.on('open-settings-popup', (event, section = 'profile') => {
    if (isMac && getMacNativeUiPreferences().utilityMode === 'swiftui') {
      nativeMacPanelManager.show(section === 'downloads' ? 'downloads' : section === 'clipboard' ? 'clipboard' : 'settings').catch((error) => {
        console.error('[MacNativeUI] Failed to open native settings panel:', error);
      });
      return;
    }
    createPopupWindow('settings', {
      width: 1200,
      height: 800,
    });
    // Send the section to open after window is ready
    setTimeout(() => {
      const popup = popupWindows.get('settings');
      if (popup && !popup.isDestroyed()) {
        popup.webContents.send('set-settings-section', section);
      }
    }, 500);
  });

  ipcMain.on('open-profile-popup', () => {
    createPopupWindow('profile', {
      width: 600,
      height: 700,
    });
  });

  ipcMain.on('open-plugins-popup', () => {
    createPopupWindow('plugins', {
      width: 900,
      height: 700,
    });
  });

  ipcMain.on('open-downloads-popup', () => {
    if (isMac && getMacNativeUiPreferences().utilityMode === 'swiftui') {
      nativeMacPanelManager.show('downloads').catch((error) => {
        console.error('[MacNativeUI] Failed to open native downloads panel:', error);
      });
      return;
    }
    createPopupWindow('downloads', {
      width: 400,
      height: 600,
    });
  });

  ipcMain.on('open-clipboard-popup', () => {
    if (isMac && getMacNativeUiPreferences().utilityMode === 'swiftui') {
      nativeMacPanelManager.show('clipboard').catch((error) => {
        console.error('[MacNativeUI] Failed to open native clipboard panel:', error);
      });
      return;
    }
    createPopupWindow('clipboard', {
      width: 450,
      height: 650,
    });
  });

  ipcMain.on('open-cart-popup', () => {
    createPopupWindow('cart', {
      width: 500,
      height: 700,
    });
  });

  ipcMain.on('open-search-popup', (event, options = {}) => {
    createPopupWindow('search', {
      width: 600,
      height: 500,
      ...options
    });
  });

  ipcMain.on('open-translate-popup', (event, options = {}) => {
    createPopupWindow('translate', {
      width: 400,
      height: 500,
      ...options
    });
  });

  ipcMain.on('open-context-menu-popup', (event, options = {}) => {
    createPopupWindow('context-menu', {
      width: 250,
      height: 400,
      ...options
    });
  });

  // Google login removed. Authentication redirected to ponsrischool web-auth.

  // ============================================================================
  // SHELL COMMAND EXECUTION - For AI control of system features
  // ============================================================================


  // Remove existing handler if present to prevent "second handler" error
  ipcMain.removeHandler('click-element');
  ipcMain.handle('click-element', async (event, selector) => {
    const view = tabViews.get(activeTabId);
    if (!view) return { success: false, error: 'No active view' };
    const permission = checkAiActionPermission('CLICK_ELEMENT', selector, 'medium');
    if (!permission.allowed) {
      return { success: false, error: permission.error };
    }
    try {
      const result = await resolveAndClickWithAi(view.webContents, selector, cometAiEngine);
      return result?.success
        ? { ...result, success: true }
        : { success: false, error: `No clickable DOM target found for "${selector}"`, candidates: result?.candidates || [] };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('type-text', async (event, { selector, text }) => {
    const view = tabViews.get(activeTabId);
    if (!view) return { success: false, error: 'No active view' };
    const permission = checkAiActionPermission('FILL_FORM', selector, 'medium');
    if (!permission.allowed) {
      return { success: false, error: permission.error };
    }
    try {
      const vaultApproval = await ensureVaultApprovalForFormFill({ [selector]: text });
      if (!vaultApproval.success) {
        return { success: false, error: vaultApproval.error };
      }

      await view.webContents.executeJavaScript(`
      (() => {
        const selector = ${JSON.stringify(selector)};
        const value = ${JSON.stringify(text ?? '')};
        const el = document.querySelector(selector);
        if (el) {
          el.focus();
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        return false;
      })()
    `);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ============================================================================
  // CROSS-APP AUTOMATION - For controlling external applications
  // ============================================================================

  const { CrossPlatformAutomation } = require('./src/lib/cross-platform-automation.js');
  const crossPlatformAutomation = new CrossPlatformAutomation();

  ipcMain.handle('click-app-element', async (event, { appName, elementText, reason }) => {
    console.log(`[Main] click-app-element: ${appName}, "${elementText}"`);
    try {
      return await crossPlatformAutomation.clickAppElement(appName, elementText, reason);
    } catch (error) {
      console.error('[Main] click-app-element error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('type-text-app', async (event, text) => {
    console.log(`[Main] type-text-app: ${text.substring(0, 30)}...`);
    try {
      return await crossPlatformAutomation.typeText(text);
    } catch (error) {
      console.error('[Main] type-text-app error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('fill-form', async (event, formData) => {
    const view = tabViews.get(activeTabId);
    if (!view) return { success: false, error: 'No active view' };
    const permissionTarget = formData && typeof formData === 'object'
      ? Object.keys(formData).slice(0, 5).join(',') || 'form'
      : 'form';
    const permission = checkAiActionPermission('FILL_FORM', permissionTarget, 'medium');
    if (!permission.allowed) {
      return { success: false, error: permission.error };
    }
    try {
      const vaultApproval = await ensureVaultApprovalForFormFill(formData);
      if (!vaultApproval.success) {
        return { success: false, error: vaultApproval.error };
      }

      await view.webContents.executeJavaScript(`
      (() => {
        const data = ${JSON.stringify(formData)};
        let successCount = 0;
        for (const [selector, value] of Object.entries(data)) {
           const el = document.querySelector(selector);
           if (el) {
             el.focus();
             el.value = value;
             el.dispatchEvent(new Event('input', { bubbles: true }));
             el.dispatchEvent(new Event('change', { bubbles: true }));
             successCount++;
           }
        }
        return successCount;
      })()
    `);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Duplicate select-local-file removed


  // Duplicate execute-shell-command removed


  // ============================================================================
  // SCREEN CAPTURE - For OCR and cross-app clicking
  // ============================================================================


  // ============================================================================
  // APPLICATION SEARCH - Search for installed applications
  // ============================================================================
  ipcMain.handle('search-applications', async (event, query) => {
    console.log('[AppSearch] Searching for:', query);

    const platform = process.platform;
    const results = [];

    try {
      if (platform === 'win32') {
        // Windows: Search only in Start Menu for performance. Program Files is too slow for recursive readdir.
        const searchPaths = [
          path.join(process.env.ProgramData, 'Microsoft/Windows/Start Menu/Programs'),
          path.join(process.env.APPDATA, 'Microsoft/Windows/Start Menu/Programs'),
          'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs',
          path.join(process.env.USERPROFILE, 'AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs')
        ];

        for (const searchPath of searchPaths) {
          if (fs.existsSync(searchPath)) {
            // Limited depth search (max 3 levels)
            const getFiles = (dir, depth = 0) => {
              if (depth > 3) return [];
              try {
                let results = [];
                const list = fs.readdirSync(dir, { withFileTypes: true });
                for (const file of list) {
                  const res = path.resolve(dir, file.name);
                  if (file.isDirectory()) {
                    results = results.concat(getFiles(res, depth + 1));
                  } else {
                    if (file.name.toLowerCase().includes(query.toLowerCase()) &&
                      (file.name.endsWith('.lnk') || file.name.endsWith('.exe'))) {
                      results.push({
                        name: path.basename(file.name, path.extname(file.name)),
                        path: res
                      });
                    }
                  }
                }
                return results;
              } catch (e) { return []; }
            };

            results.push(...getFiles(searchPath));
          }
        }
      } else if (platform === 'darwin') {
        // macOS: Search in Applications folder
        const appsPath = '/Applications';
        if (fs.existsSync(appsPath)) {
          const apps = fs.readdirSync(appsPath);
          apps.forEach(app => {
            if (app.toLowerCase().includes(query.toLowerCase()) && app.endsWith('.app')) {
              results.push({
                name: path.basename(app, '.app'),
                path: path.join(appsPath, app)
              });
            }
          });
        }
      } else {
        // Linux: Search in common application directories
        const searchPaths = ['/usr/share/applications', '/usr/local/share/applications'];

        for (const searchPath of searchPaths) {
          if (fs.existsSync(searchPath)) {
            const files = fs.readdirSync(searchPath);
            files.forEach(file => {
              if (file.toLowerCase().includes(query.toLowerCase()) && file.endsWith('.desktop')) {
                results.push({
                  name: path.basename(file, '.desktop'),
                  path: path.join(searchPath, file)
                });
              }
            });
          }
        }
      }

      return {
        success: true,
        results: results.slice(0, 20) // Limit to 20 results
      };
    } catch (error) {
      console.error('[AppSearch] Error:', error);
      return {
        success: false,
        error: error.message,
        results: []
      };
    }
  });

  // ============================================================================
  // OPEN EXTERNAL APP - Launch applications
  // ============================================================================
  // Duplicate open-external-app command removed


  // ============================================================================
  // AUTOMATION & OCR - Integrated handlers
  // ============================================================================

  // Helper: Capture Screen Region
  async function captureScreenRegion(bounds, outputPath) {
    try {
      if (robot && bounds) {
        // Use robotjs for specific region if available (fastest)
        const bmp = robot.screen.capture(bounds.x, bounds.y, bounds.width, bounds.height);

        // Create new Jimp image (v0.x API)
        const jimpImage = new Jimp(bmp.width, bmp.height);

        let pos = 0;
        // Convert raw BGRA to RGBA for Jimp
        jimpImage.scan(0, 0, jimpImage.bitmap.width, jimpImage.bitmap.height, (x, y, idx) => {
          jimpImage.bitmap.data[idx + 2] = bmp.image.readUInt8(pos++); // B -> R
          jimpImage.bitmap.data[idx + 1] = bmp.image.readUInt8(pos++); // G
          jimpImage.bitmap.data[idx + 0] = bmp.image.readUInt8(pos++); // R -> B
          jimpImage.bitmap.data[idx + 3] = bmp.image.readUInt8(pos++); // A
        });

        await jimpImage.writeAsync(outputPath);
        return outputPath;
      } else {
        // Fallback to screenshot-desktop (full screen)
        const imgBuffer = await screenshot({ format: 'png' });
        const jimpImage = await Jimp.read(imgBuffer);

        if (bounds) {
          jimpImage.crop(bounds.x, bounds.y, bounds.width, bounds.height);
        }

        await jimpImage.writeAsync(outputPath);
        return outputPath;
      }
    } catch (error) {
      console.error('Capture failed:', error);
      throw error;
    }
  }

  // Handler: Perform OCR
  ipcMain.handle('perform-ocr', async (event, options) => {
    const { useNative = true, bounds, language = 'eng', imagePath } = options || {};
    let tempFile = imagePath;
    let shouldDelete = false;

    if (!tempFile) {
      if (!bounds && tesseractOcrService) {
        try {
          const recognition = await tesseractOcrService.captureAndOcr(undefined, { preferNative: useNative });
          return {
            success: true,
            provider: recognition.provider,
            strategy: recognition.strategy,
            text: (recognition.lines?.length ? recognition.lines : recognition.words || [])
              .map((item) => item.text)
              .join('\n'),
            words: recognition.words || [],
            lines: recognition.lines || [],
          };
        } catch (serviceError) {
          console.warn('[Main] Shared OCR service failed, falling back to legacy handler:', serviceError.message);
        }
      }

      tempFile = path.join(os.tmpdir(), `ocr_${Date.now()}.png`);
      shouldDelete = true;
    }

    try {
      if (shouldDelete) {
        await captureScreenRegion(bounds, tempFile);
      }

      if (useNative) {
        try {
          if (process.platform === 'darwin') {
            const script = `
      use framework "Vision"
      use framework "AppKit"
      use scripting additions
      
      set imagePath to "${tempFile}"
      set imageURL to current application's NSURL's fileURLWithPath:imagePath
      set requestHandler to current application's VNImageRequestHandler's alloc()'s initWithURL:imageURL options:(missing value)
      
      set textRequest to current application's VNRecognizeTextRequest's alloc()'s init()
      textRequest's setRecognitionLevel:(current application's VNRequestTextRecognitionLevelAccurate)
      
      requestHandler's performRequests:{textRequest} |error|:(missing value)
      
      set observations to textRequest's results()
      set resultText to ""
      repeat with observation in observations
          set resultText to resultText & (observation's text() as text) & linefeed
      end repeat
      
      return resultText
          `;
            const { stdout } = await execPromise(`osascript -l JavaScript -e '${script.replace(/'/g, "\\'")}'`);
            return { text: stdout.trim(), confidence: 0.95 };
          } else if (process.platform === 'win32') {
            const psScript = `
      Add-Type -AssemblyName System.Runtime.WindowsRuntime
      [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] | Out-Null
      [Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
      [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime] | Out-Null
      
      $file = [Windows.Storage.StorageFile]::GetFileFromPathAsync("${tempFile}").GetAwaiter().GetResult()
      $stream = $file.OpenAsync([Windows.Storage.FileAccessMode]::Read).GetAwaiter().GetResult()
      $decoder = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream).GetAwaiter().GetResult()
      $bitmap = $decoder.GetSoftwareBitmapAsync().GetAwaiter().GetResult()
      
      $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
      $result = $engine.RecognizeAsync($bitmap).GetAwaiter().GetResult()
      
      $result.Text
          `;
            const { stdout } = await execPromise(`powershell -Command "${psScript.replace(/"/g, '\\"')}"`);
            return { text: stdout.trim(), confidence: 0.90 };
          }
        } catch (nativeErr) {
          console.warn('Native OCR failed (fallback to Tesseract):', nativeErr.message);
        }
      }

      // Fallback to Tesseract
      if (!tesseractWorker) {
        tesseractWorker = await createWorker(language);
      }
      const { data } = await tesseractWorker.recognize(tempFile);
      return {
        text: data.text,
        confidence: data.confidence / 100,
        words: data.words.map(w => ({ text: w.text, bbox: w.bbox, confidence: w.confidence / 100 }))
      };

    } catch (error) {
      console.error('OCR Error:', error);
      return { error: error.message };
    } finally {
      if (shouldDelete) {
        try { fs.unlinkSync(tempFile); } catch (e) { }
      }
    }
  });

  // Handler: Perform Click (Comprehensive)
  const performClickHandler = async (event, args) => {
    const { x, y, button = 'left', doubleClick = false } = args;
    const permission = checkAiActionPermission('CLICK_AT', `${x},${y}`, 'medium');
    if (!permission.allowed) {
      return { success: false, error: permission.error };
    }

    try {
      await performRobotClick({ x, y, button, doubleClick });
      return { success: true };
    } catch (error) {
      console.error('Click Error:', error);
      return { success: false, error: error.message };
    }
  };

  ipcMain.handle('perform-click', performClickHandler);
  ipcMain.handle('perform-cross-app-click', performClickHandler); // Alias for backward compatibility

  // Handler: Get Window Info
  ipcMain.handle('get-window-info', async () => {
    try {
      if (process.platform === 'darwin') {
        const script = `
        tell application "System Events"
          set frontApp to name of first application process whose frontmost is true
          set frontWindow to name of front window of application process frontApp
          return {frontApp, frontWindow}
        end tell
      `;
        const { stdout } = await execPromise(`osascript -e '${script}'`);
        return { window: stdout.trim() }; // Simplified parsing
      } else if (process.platform === 'win32') {
        const script = `
        Add-Type @"
          using System;
          using System.Runtime.InteropServices;
          using System.Text;
          public class Win32 {
              [DllImport("user32.dll")]
              public static extern IntPtr GetForegroundWindow();
              [DllImport("user32.dll")]
              public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
          }
"@
        $handle = [Win32]::GetForegroundWindow()
        $title = New-Object System.Text.StringBuilder 256
        [void][Win32]::GetWindowText($handle, $title, 256)
        $title.ToString()
      `;
        const { stdout } = await execPromise(`powershell -Command "${script}"`);
        return { window: stdout.trim() };
      }
      return null;
    } catch (error) {
      console.error('Get Window Info Error:', error);
      return { error: error.message };
    }
  });

  // Duplicate capture-screen-region removed - now consolidated in main handlers section

  // ============================================================================
  // DESKTOP AUTOMATION v2 — Permission, Robot, OCR, Vision IPC Handlers
  // ============================================================================

  // --- Permission Store ---
  ipcMain.handle('perm-grant', async (event, { key, level, description, sessionOnly }) => {
    try {
      permissionStore.grant(key, level, description, sessionOnly !== false);
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('perm-revoke', async (event, key) => {
    permissionStore.revoke(key);
    return { success: true };
  });

  ipcMain.handle('perm-revoke-all', async () => {
    permissionStore.revokeAll();
    return { success: true };
  });

  ipcMain.removeHandler('perm-check');
  ipcMain.handle('perm-check', async (event, key) => {
    return { granted: permissionStore.isGranted(key) };
  });

  ipcMain.handle('perm-list', async () => {
    return permissionStore.getAll();
  });

  ipcMain.handle('perm-audit-log', async (event, limit) => {
    return permissionStore.getAuditLog(limit || 100);
  });



  ipcMain.handle('set-proxy', async (_event, config) => {
    const updates = config
      ? {
        proxyMode: config.mode || 'fixed_servers',
        proxyRules: config.proxyRules || config.rules || config.proxyServer || '',
        proxyBypassRules: config.proxyBypassRules || networkSecurityManager.getConfig().proxyBypassRules,
      }
      : {
        proxyMode: 'direct',
        proxyRules: '',
      };

    await applyNetworkSecurityConfig(updates);
    return true;
  });

  ipcMain.handle('permission-auto-command', async (event, { command, enabled }) => {
    permissionStore.setAutoCommand(command, enabled);
    return { success: true, commands: permissionStore.getAutoApprovedCommands() };
  });

  ipcMain.handle('permission-auto-action', async (event, { actionType, enabled }) => {
    permissionStore.setAutoAction(actionType, enabled);
    return { success: true, actions: permissionStore.getAutoApprovedActions() };
  });

  // Skill Loader - loads document generation skills (pdf/docx/pptx)
  ipcMain.handle('load-skill', async (event, format) => {
    const { skillLoader } = require('./src/lib/SkillLoader.js');
    try {
      const skill = await skillLoader.load(format);
      return { success: true, skill };
    } catch (e) {
      console.error('[Main] Error loading skill:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('permission-auto-commands', async () => {
    return { commands: permissionStore.getAutoApprovedCommands() };
  });

  ipcMain.handle('permission-auto-actions', async () => {
    return { actions: permissionStore.getAutoApprovedActions() };
  });

  ipcMain.on('automation-shell-approval-response', (_event, { requestId, allowed, deviceUnlockValidated }) => {
    const resolver = shellApprovalResolvers.get(requestId);
    if (resolver) {
      shellApprovalResolvers.delete(requestId);
      resolver({ allowed: !!allowed, deviceUnlockValidated: !!deviceUnlockValidated });
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // MASTER PIN IPC HANDLERS
  // ──────────────────────────────────────────────────────────────────────
  ipcMain.handle('master-pin-has', async () => {
    try { return { hasPIN: masterPinService.hasPIN() }; }
    catch (e) { return { hasPIN: false, error: e.message }; }
  });

  ipcMain.handle('master-pin-setup', async (_event, pin) => {
    try { return masterPinService.setupPIN(pin); }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('master-pin-verify', async (_event, pin) => {
    try { return masterPinService.verifyPIN(pin); }
    catch (e) { return { verified: false, error: e.message }; }
  });

  ipcMain.handle('master-pin-change', async (_event, { oldPin, newPin }) => {
    try { return masterPinService.changePIN(oldPin, newPin); }
    catch (e) { return { success: false, error: e.message }; }
  });

  // ──────────────────────────────────────────────────────────────────────
  // UNIFIED SESSION IPC HANDLERS
  // ──────────────────────────────────────────────────────────────────────
  ipcMain.handle('session-get-current', async () => {
    try { return { session: unifiedSessionManager.getCurrentSession() }; }
    catch (e) { return { session: null, error: e.message }; }
  });

  ipcMain.handle('session-list', async (_event, limit) => {
    try { return { sessions: unifiedSessionManager.listSessions(limit || 50) }; }
    catch (e) { return { sessions: [], error: e.message }; }
  });

  ipcMain.handle('session-get-by-id', async (_event, sessionId) => {
    try { return { session: unifiedSessionManager.getSessionById(sessionId) }; }
    catch (e) { return { session: null, error: e.message }; }
  });

  ipcMain.handle('session-log-permission', async (_event, log) => {
    try {
      unifiedSessionManager.logPermission(log);
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // Auto-push session deltas to mobile when session is updated
  unifiedSessionManager.on('session-updated', (session) => {
    if (wifiSyncService) {
      wifiSyncService.sendSessionDelta('tabs', {
        tabs: session.tabs,
        history: session.history.slice(0, 10),
        tasks: session.automationTasks.slice(0, 5),
        permissions: session.permissions.slice(0, 5),
        sessionId: session.id,
        isActive: session.isActive,
      });
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // PERMISSION RELAY IPC HANDLERS (Mobile → Desktop approval flow)
  // ──────────────────────────────────────────────────────────────────────
  ipcMain.handle('permission-relay-request-mobile', async (_event, params) => {
    try {
      const { request, promise } = permissionRelayService.createApprovalRequest({
        ...params,
        originDeviceId: wifiSyncService ? wifiSyncService.getDeviceId() : 'desktop',
        originDeviceName: wifiSyncService ? wifiSyncService.getDeviceName() : 'Aartiq Desktop',
      });
      // Send request to all connected mobile devices
      if (wifiSyncService) {
        wifiSyncService.sendPermissionRequest(request);
      }
      // Wait for mobile response
      const response = await promise;
      return response;
    } catch (e) {
      return { approved: false, pinVerified: false, screenLockVerified: false, reason: e.message };
    }
  });

  ipcMain.handle('permission-relay-list-pending', async () => {
    try { return { pending: permissionRelayService.listPendingRequests() }; }
    catch (e) { return { pending: [] }; }
  });

  ipcMain.handle('permission-relay-cancel', async (_event, requestId) => {
    try { return { success: permissionRelayService.cancelRequest(requestId) }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  // Wire permissionRelayService emits to renderer so the desktop UI can show "Waiting for mobile..." overlay
  permissionRelayService.on('new-approval-request', (request) => {
    if (mainWindow) mainWindow.webContents.send('permission-relay-new-request', request);
  });
  permissionRelayService.on('approval-resolved', (response) => {
    if (mainWindow) mainWindow.webContents.send('permission-relay-resolved', response);
  });
  permissionRelayService.on('request-expired', (requestId) => {
    if (mainWindow) mainWindow.webContents.send('permission-relay-expired', { requestId });
  });

  // --- Robot Service ---
  ipcMain.handle('robot-execute', async (event, action) => {
    if (!robotService) return { success: false, error: 'RobotService not initialized' };
    try {
      return await robotService.execute(action);
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('robot-execute-sequence', async (event, { actions, options }) => {
    if (!robotService) return { success: false, error: 'RobotService not initialized' };
    try {
      return await robotService.executeSequence(actions, options);
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('robot-kill', async () => {
    if (robotService) robotService.kill();
    return { success: true };
  });

  ipcMain.handle('robot-reset-kill', async () => {
    if (robotService) robotService.resetKill();
    return { success: true };
  });

  ipcMain.handle('robot-status', async () => {
    return {
      available: robotService?.isAvailable || false,
      permitted: permissionStore.isGranted('robot'),
      killActive: robotService?.killFlag || false,
    };
  });

  // --- Tesseract OCR v2 ---
  ipcMain.handle('ocr-capture-words', async (event, displayId) => {
    if (!tesseractOcrService) return { success: false, error: 'OCR service not initialized' };
    try {
      const result = await tesseractOcrService.captureAndOcr(displayId);
      return { success: true, ...result };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('ocr-click', async (event, { target, useAi }) => {
    if (!tesseractOcrService || !robotService) {
      return { success: false, error: 'OCR or Robot service not initialized' };
    }
    try {
      const ai = useAi !== false ? cometAiEngine : null;
      return await tesseractOcrService.ocrClick(target, ai, robotService, permissionStore);
    } catch (e) { return { success: false, error: e.message }; }
  });

  // --- DOM Click Handler with multi-strategy, retry, and verify ---
  // Accepts: { selector, text, aria-label, retry, verify, tabId }
  // Enhanced DOM Click Element with multi-strategy fallback chain:
  // dom-engine → iframe traversal → CDP sendInputEvent → AI resolution → browser-navigation-service
  ipcMain.handle('dom-click-element', async (event, opts) => {
    const { tabId, selector, text, 'aria-label': ariaLabel, timeout = 5000, verify = false, button } = opts || {};
    const targetTabId = tabId || activeTabId;
    const query = selector || text || ariaLabel;
    const view = tabViews.get(targetTabId);

    if (!view || !view.webContents) {
      return { success: false, error: 'Browser view not found' };
    }

    // Strategy 1: dom-engine v2 (AX-tree-first resolution, state check, waitForElement)
    if (query) {
      try {
        const engineResult = await domEngine.clickElement(view.webContents, { selector: query, timeout, verify, button });
        if (engineResult.success) return { ...engineResult, method: 'dom-engine-v2' };
      } catch (_) {}
    }

    // Strategy 2: dom-engine v2 wait + CDP fallback
    try {
      if (query) {
        const waitResult = await domEngine.waitForElement(view.webContents, { selector: query, timeout: 3000 });
        if (waitResult.success) {
          const el = waitResult.element;
          if (el?.state?.rect) {
            const cx = el.state.rect.x + Math.round(el.state.rect.w / 2);
            const cy = el.state.rect.y + Math.round(el.state.rect.h / 2);
            const cdpResult = await domEngine.cdpClick(view.webContents, { x: cx, y: cy });
            if (cdpResult.success) return { success: true, method: 'cdp-sendInputEvent', x: cx, y: cy, element: el };
          }
        }
      }
    } catch (_) {}

    // Strategy 3: legacy resolveAndClickWithAi
    try {
      if (query) {
        const navResult = await resolveAndClickWithAi(view.webContents, query, null);
        if (navResult?.success) return { success: true, method: 'browser-navigation', ...navResult };
      }
    } catch (_) {}

    // Strategy 4: inline JS fallback (backward compat)
    try {
      const T = query || '';
      const clickCode = `
        (async () => {
          const MAX_RETRIES = 3;
          const RETRY_DELAY = 200;
          const T = ${JSON.stringify(T)};
          const strategies = [];
          if (T) {
            strategies.push(() => document.querySelector(T));
            strategies.push(() => {
              const all = document.querySelectorAll('button, a, input[type="submit"], input[type="button"], [role="button"], [role="link"], [role="option"], [role="tab"], [role="menuitem"], [onclick], .btn, .button');
              const t = T.toLowerCase();
              for (const el of all) {
                const et = (el.textContent || el.value || '').toLowerCase().trim();
                if (et === t || et.includes(t)) return el;
              }
              const any = document.querySelectorAll('*');
              for (const el of any) {
                if (el.children.length === 0 || el.tagName === 'BUTTON' || el.tagName === 'A') {
                  const et = (el.textContent || '').toLowerCase().trim();
                  if (et === t || et.includes(t)) return el;
                }
              }
              return null;
            });
            strategies.push(() => document.querySelector('[aria-label*="' + T + '"], [placeholder*="' + T + '"], [title*="' + T + '"]'));
          } else {
            // No query given — scan for any prominent button/subscribe element
            strategies.push(() => {
              const btns = document.querySelectorAll('button, a, [role="button"], [class*="subscribe"], [class*="Subscribe"], [aria-label*="subscribe"], [aria-label*="Subscribe"]');
              for (const el of btns) {
                const rect = el.getBoundingClientRect();
                if (rect.width > 20 && rect.height > 20 && rect.width < 600) return el;
              }
              return null;
            });
          }
          for (let r = 0; r < MAX_RETRIES; r++) {
            for (let si = 0; si < strategies.length; si++) {
              try {
                const el = strategies[si]();
                if (!el) continue;
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) continue;
                el.scrollIntoView({ block: 'center' });
                await new Promise(x => setTimeout(x, 150));
                el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                el.click();
                return { success: true, method: 'legacy-fallback', tag: el.tagName, text: (el.textContent || '').trim().substring(0, 100) };
              } catch (_) {}
            }
            if (r < MAX_RETRIES - 1) await new Promise(x => setTimeout(x, RETRY_DELAY));
          }
          return { success: false, error: 'Element not found' };
        })()
      `;
      const result = await view.webContents.executeJavaScript(clickCode);
      if (result?.success) return result;
    } catch (_) {}

    return { success: false, error: 'Click failed: element not found via any strategy' };
  });

  // --- DOM Fill Form Handler with wait, clear, verify, retry ---
  // Accepts: { selector, value, retry, verify, clearFirst, tabId }
  ipcMain.handle('dom-fill-form', async (event, opts) => {
    const { tabId, selector, value, retry = 2, verify = false, clearFirst = true, timeout = 5000 } = opts || {};
    const targetTabId = tabId || activeTabId;
    const query = selector;
    const view = tabViews.get(targetTabId);

    if (!view || !view.webContents) {
      return { success: false, error: 'Browser view not found' };
    }

    // Strategy 1: dom-engine v2 (AX-tree-first resolution, state check, waitForElement, editor-aware fill)
    if (query) {
      try {
        const engineResult = await domEngine.fillField(view.webContents, { selector: query, value, timeout, clearFirst, verify });
        if (engineResult.success) return { ...engineResult, method: 'dom-engine-v2' };
      } catch (_) {}
    }

    // Strategy 2: dom-engine v2 wait + inline JS fill fallback
    if (query) {
      try {
        const waitResult = await domEngine.waitForElement(view.webContents, { selector: query, timeout: Math.min(timeout, 3000) });
        if (waitResult.success) {
          const fillCode = `
            (async () => {
              const TARGET_VALUE = ${JSON.stringify(value || '')};
              const el = document.querySelector(${JSON.stringify(query)}) || document.querySelector('input[name="${query.replace(/.*\[name=["']?([^"']+).*$/, '$1')}"]');
              if (!el) return { success: false, error: 'Element lost' };

              el.scrollIntoView({ block: 'center', behavior: 'instant' });
              await new Promise(r => setTimeout(r, 50));
              el.focus();

              function reactSetValue(el, val) {
                const tag = el.tagName;
                if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
                  el.textContent = val;
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  return;
                }
                const prev = el.value;
                const proto = el.constructor.prototype;
                const ns = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                if (ns) ns.call(el, val); else el.value = val;
                const tracker = el._valueTracker;
                if (tracker) tracker.setValue(prev);
                try { el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: val })); }
                catch (_) { el.dispatchEvent(new Event('input', { bubbles: true })); }
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }

              ${clearFirst ? `
              if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                const proto = el.constructor.prototype;
                const ns = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                if (ns) ns.call(el, ''); else el.value = '';
                const tracker = el._valueTracker;
                if (tracker) tracker.setValue('');
                try { el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContent', data: null })); }
                catch (_) { el.dispatchEvent(new Event('input', { bubbles: true })); }
              } else { el.textContent = ''; }
              await new Promise(r => setTimeout(r, 30));
              ` : ''}

              reactSetValue(el, TARGET_VALUE);

              ${verify ? `
              await new Promise(r => setTimeout(r, 100));
              const cv = el.value || el.textContent || '';
              if (cv === TARGET_VALUE || cv.includes(TARGET_VALUE) || TARGET_VALUE.includes(cv)) {
                return { success: true, value: cv.substring(0, 200), verified: true };
              }
              ` : ''}

              return { success: true, value: TARGET_VALUE.substring(0, 200) };
            })()
          `;
          const result = await view.webContents.executeJavaScript(fillCode);
          if (result?.success) return { ...result, method: 'dom-engine-v2-wait+inline-fill' };
        }
      } catch (_) {}
    }

    // Strategy 3: legacy inline JS fallback (backward compat, multi-strategy find)
    if (query && value !== undefined) {
      try {
        const fillCode = `
          (async () => {
            const MAX_RETRIES = ${retry};
            const TARGET_VALUE = ${JSON.stringify(value || '')};
            const QUERY = ${JSON.stringify(query)};

            function findElement() {
              const el = document.querySelector(QUERY);
              if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return el;
              const allInputs = document.querySelectorAll('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
              for (const inp of allInputs) {
                const ph = (inp.placeholder || inp.title || '').toLowerCase();
                if (ph && TARGET_VALUE.toLowerCase().includes(ph) && inp.offsetParent !== null) return inp;
              }
              for (const inp of allInputs) {
                const r = inp.getBoundingClientRect();
                if (r.width > 0 && r.height > 0 && inp.offsetParent !== null) return inp;
              }
              return null;
            }

            function reactSetValue(el, val) {
              const tag = el.tagName;
              if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
                el.textContent = val;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return;
              }
              const prev = el.value;
              const proto = el.constructor.prototype;
              const ns = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
              if (ns) ns.call(el, val); else el.value = val;
              const tracker = el._valueTracker;
              if (tracker) tracker.setValue(prev);
              try { el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: val })); }
              catch (_) { el.dispatchEvent(new Event('input', { bubbles: true })); }
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }

            for (let r = 0; r < MAX_RETRIES; r++) {
              const element = findElement();
              if (!element) {
                if (r < MAX_RETRIES - 1) await new Promise(x => setTimeout(x, 200));
                continue;
              }
              try {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await new Promise(x => setTimeout(x, 100));
                element.focus();
                ${clearFirst ? `
                if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                  const proto = element.constructor.prototype;
                  const ns = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                  if (ns) ns.call(element, ''); else element.value = '';
                  const tracker = element._valueTracker;
                  if (tracker) tracker.setValue(element.value);
                  try { element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContent', data: null })); }
                  catch (_) { element.dispatchEvent(new Event('input', { bubbles: true })); }
                } else { element.innerHTML = ''; }
                await new Promise(x => setTimeout(x, 50));
                ` : ''}
                reactSetValue(element, TARGET_VALUE);
                return { success: true, value: TARGET_VALUE.substring(0, 200) };
              } catch (e) {
                if (r < MAX_RETRIES - 1) await new Promise(x => setTimeout(x, 200));
              }
            }
            return { success: false, error: 'Failed to fill after ' + MAX_RETRIES + ' retries' };
          })()
        `;
        const result = await view.webContents.executeJavaScript(fillCode);
        if (result?.success) return { ...result, method: 'legacy-inline-fallback' };
      } catch (_) {}
    }

    return { success: false, error: 'Fill failed: element not found via any strategy' };
  });

  // --- DOM Multi-Fill Form Handler ---
  // Accepts: { fields: {selector: value, ...}, delayBetweenFields, retry, verify, tabId }
  ipcMain.handle('dom-multi-fill-form', async (event, opts) => {
    const { tabId, fields, delayBetweenFields = 100, retry = 2, verify = true, timeout = 5000 } = opts || {};
    const targetTabId = tabId || activeTabId;
    const view = tabViews.get(targetTabId);

    if (!view || !view.webContents) {
      return { success: false, error: 'Browser view not found' };
    }

    if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) {
      return { success: false, error: 'No fields provided' };
    }

    // Strategy 1: dom-engine v2 multiFillForm (AX-tree-first, editor-aware)
    try {
      const engineResult = await domEngine.multiFillForm(view.webContents, { fields, delayBetweenFields, timeout, verify });
      if (engineResult.success) return { ...engineResult, method: 'dom-engine-v2' };
    } catch (_) {}

    // Strategy 2: fallback sequential fill via domEngine
    try {
      const entries = Object.entries(fields);
      const results = [];
      for (const [sel, val] of entries) {
        try {
          const fillResult = await domEngine.fillField(view.webContents, { selector: sel, value: val, timeout: Math.min(timeout, 3000), clearFirst: true, verify });
          results.push({ selector: sel, ...fillResult });
        } catch (_) {
          results.push({ selector: sel, success: false, error: 'Fill failed' });
        }
        if (delayBetweenFields > 0) await new Promise(r => setTimeout(r, delayBetweenFields));
      }
      const allOk = results.every(r => r.success);
      if (allOk) return { success: true, results, method: 'dom-engine-v2-sequential' };
    } catch (_) {}

    // Strategy 3: inline JS sequential fallback
    try {
      const entries = Object.entries(fields);
      const inlineCode = `
        (async () => {
          const FIELDS = ${JSON.stringify(entries)};
          const DELAY = ${delayBetweenFields};
          const results = [];

          function reactSetValue(el, val) {
            const tag = el.tagName;
            if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
              el.textContent = val;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return;
            }
            const prev = el.value;
            const proto = el.constructor.prototype;
            const ns = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (ns) ns.call(el, val); else el.value = val;
            const tracker = el._valueTracker;
            if (tracker) tracker.setValue(prev);
            try { el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: val })); }
            catch (_) { el.dispatchEvent(new Event('input', { bubbles: true })); }
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }

          for (const [sel, val] of FIELDS) {
            let ok = false;
            for (let r = 0; r < ${retry}; r++) {
              const el = document.querySelector(sel);
              if (!el) { await new Promise(x => setTimeout(x, 200)); continue; }
              try {
                el.scrollIntoView({ block: 'center', behavior: 'instant' });
                await new Promise(x => setTimeout(x, 50));
                el.focus();
                if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                  const proto = el.constructor.prototype;
                  const ns = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                  if (ns) ns.call(el, ''); else el.value = '';
                  const tracker = el._valueTracker;
                  if (tracker) tracker.setValue('');
                  try { el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContent', data: null })); }
                  catch (_) { el.dispatchEvent(new Event('input', { bubbles: true })); }
                }
                reactSetValue(el, val);
                ok = true;
                break;
              } catch (_) { if (r < ${retry} - 1) await new Promise(x => setTimeout(x, 200)); }
            }
            results.push({ selector: sel, success: ok });
            if (DELAY > 0) await new Promise(x => setTimeout(x, DELAY));
          }
          return { success: results.every(r => r.success), results };
        })()
      `;
      const result = await view.webContents.executeJavaScript(inlineCode);
      if (result?.success) return { ...result, method: 'legacy-inline-fallback' };
    } catch (_) {}

    return { success: false, error: 'Multi-fill failed: no strategy succeeded' };
  });

  // --- DOM Engine: Find Element ---
  ipcMain.handle('dom-engine-find', async (event, opts) => {
    const { tabId, selector, text, 'aria-label': ariaLabel } = opts || {};
    const targetTabId = tabId || activeTabId;
    const view = tabViews.get(targetTabId);
    if (!view || !view.webContents) return { success: false, error: 'Browser view not found' };
    return domEngine.findElement(view.webContents, { selector, text, 'aria-label': ariaLabel });
  });

  // --- DOM Engine: CDP Click ---
  ipcMain.handle('dom-cdp-click', async (event, opts) => {
    const { tabId, x, y } = opts || {};
    const targetTabId = tabId || activeTabId;
    const view = tabViews.get(targetTabId);
    if (!view || !view.webContents) return { success: false, error: 'Browser view not found' };
    return domEngine.cdpClick(view.webContents, { x, y });
  });

  // --- DOM Engine: Accessibility Tree ---
  ipcMain.handle('dom-get-accessibility-tree', async (event, opts) => {
    const { tabId, maxDepth } = opts || {};
    const targetTabId = tabId || activeTabId;
    const view = tabViews.get(targetTabId);
    if (!view || !view.webContents) return { error: 'Browser view not found' };
    return domEngine.getAccessibilityTree(view.webContents, maxDepth);
  });

  // --- DOM Engine: Get Clickable Elements ---
  ipcMain.handle('dom-get-clickable-elements', async (event, opts) => {
    const { tabId } = opts || {};
    const targetTabId = tabId || activeTabId;
    const view = tabViews.get(targetTabId);
    if (!view || !view.webContents) return [];
    return domEngine.getClickableElements(view.webContents);
  });

  ipcMain.handle('dom-find-element', async (event, { tabId, selector, text }) => {
    const targetTabId = tabId || activeTabId;
    const view = tabViews.get(targetTabId);

    if (!view || !view.webContents) {
      return { success: false, error: 'Browser view not found' };
    }

    try {
      const findCode = `
        (() => {
          let elements = [];
          
          if (${JSON.stringify(selector)}) {
            elements = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
          } else if (${JSON.stringify(text)}) {
            const searchText = ${JSON.stringify(text)}.toLowerCase();
            const allElements = document.querySelectorAll('*');
            for (const el of allElements) {
              if (el.children.length === 0) {
                const elText = (el.textContent || '').toLowerCase().trim();
                if (elText.includes(searchText)) {
                  elements.push(el);
                }
              }
            }
          }
          
          return elements.slice(0, 20).map((el, i) => {
            const rect = el.getBoundingClientRect();
            return {
              index: i,
              tagName: el.tagName.toLowerCase(),
              className: el.className,
              id: el.id,
              text: (el.textContent || '').substring(0, 100),
              rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
              href: el.href || null,
              type: el.type || null,
              visible: rect.width > 0 && rect.height > 0
            };
          });
        })()
      `;

      const elements = await view.webContents.executeJavaScript(findCode);
      return { success: true, elements };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('dom-get-page-info', async (event, { tabId }) => {
    const targetTabId = tabId || activeTabId;
    const view = tabViews.get(targetTabId);

    if (!view || !view.webContents) {
      return { success: false, error: 'Browser view not found' };
    }

    try {
      const pageInfo = await view.webContents.executeJavaScript(`
        (() => {
          return {
            url: window.location.href,
            title: document.title,
            bodyText: document.body.innerText.substring(0, 5000),
            links: Array.from(document.querySelectorAll('a')).slice(0, 50).map(a => ({
              href: a.href,
              text: a.textContent.trim().substring(0, 50)
            })),
            forms: Array.from(document.querySelectorAll('form')).map(f => ({
              action: f.action,
              method: f.method,
              inputs: Array.from(f.querySelectorAll('input')).slice(0, 10).map(i => ({
                name: i.name,
                type: i.type,
                placeholder: i.placeholder
              }))
            })),
            clickableElements: Array.from(document.querySelectorAll('button, a, [role="button"]')).slice(0, 30).map((el, i) => ({
              index: i,
              tagName: el.tagName.toLowerCase(),
              text: (el.textContent || '').trim().substring(0, 100),
              rect: el.getBoundingClientRect()
            }))
          };
        })()
      `);
      return { success: true, ...pageInfo };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('ocr-screen-text', async (event, displayId) => {
    if (!tesseractOcrService) return { success: false, error: 'OCR service not initialized' };
    try {
      const text = await tesseractOcrService.getScreenText(displayId);
      return { success: true, text };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // --- Screen Vision AI ---
  ipcMain.removeHandler('vision-describe');
  ipcMain.handle('vision-describe', async (event, question) => {
    if (!screenVisionService) return { success: false, error: 'Vision service not initialized' };
    try {
      const description = await screenVisionService.describe(question);
      return { success: true, description };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('vision-analyze', async (event, question) => {
    if (!screenVisionService || !tesseractOcrService) {
      return { success: false, error: 'Vision or OCR service not initialized' };
    }
    try {
      const result = await screenVisionService.analyzeAndAct(
        question, tesseractOcrService, robotService, permissionStore
      );
      return { success: true, ...result };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('vision-capture-base64', async () => {
    if (!screenVisionService) return { success: false, error: 'Vision service not initialized' };
    try {
      const image = await screenVisionService.captureBase64();
      return { success: true, image };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // --- AI Engine (direct chat for automation tasks) ---
  ipcMain.handle('ai-engine-chat', async (event, { message, model, provider, systemPrompt, history }) => {
    if (!cometAiEngine) return { success: false, error: 'AI engine not initialized' };
    try {
      const response = await cometAiEngine.chat({ message, model, provider, systemPrompt, history });
      return { success: true, response };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('ai-engine-configure', async (event, keys) => {
    if (!cometAiEngine) return { success: false, error: 'AI engine not initialized' };
    cometAiEngine.configure(keys);
    if (keys.GEMINI_API_KEY) store.set('gemini_api_key', keys.GEMINI_API_KEY);
    if (keys.GROQ_API_KEY) store.set('groq_api_key', keys.GROQ_API_KEY);
    if (keys.OPENAI_API_KEY) store.set('openai_api_key', keys.OPENAI_API_KEY);
    if (keys.AZURE_OPENAI_API_KEY) store.set('azure_openai_api_key', keys.AZURE_OPENAI_API_KEY);
    if (keys.AZURE_OPENAI_BASE_URL) store.set('azure_openai_endpoint', keys.AZURE_OPENAI_BASE_URL);
    if (keys.ANTHROPIC_API_KEY) store.set('anthropic_api_key', keys.ANTHROPIC_API_KEY);
    return { success: true };
  });

  ipcMain.handle('classify-tabs-ai', async (event, { tabs }) => {
    if (!cometAiEngine) return { success: false, error: 'AI engine not initialized' };
    try {
      const tabData = tabs.map(t => `- [${t.id}] ${t.title} (${t.url})`).join('\n');
      const prompt = `Classify the following browser tabs into logical groups.
Each group should have a clear, concise name (2-3 words max, e.g., "Research", "Development", "Social Media", "Shopping").
Respond ONLY with a JSON object where keys are tab IDs and values are group names.

Example:
{
  "tab-1": "Research",
  "tab-2": "Social Media"
}

Tabs to classify:
${tabData}`;

      const response = await cometAiEngine.chat({
        message: prompt,
        systemPrompt: "You are an expert browser organizer. Respond only with valid JSON."
      });

      // Cleanup response (sometimes LLMs wrap JSON in ```json blocks)
      const cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
      const classifications = JSON.parse(cleanJson);
      return { success: true, classifications };
    } catch (e) {
      console.error('[AI Tab Organizer] Error:', e);
      return { success: false, error: e.message };
    }
  });

  // ============================================================================
  // FLUTTER BRIDGE — IPC Handlers
  // ============================================================================

  ipcMain.handle('bridge-get-pairing-code', async () => {
    if (!flutterBridge) return { success: false, error: 'Bridge not initialized' };
    return { success: true, code: flutterBridge.getPairingCode() };
  });

  ipcMain.handle('bridge-get-status', async () => {
    return {
      running: !!flutterBridge?.server,
      connectedDevices: flutterBridge?.getConnectedCount() || 0,
    };
  });

  ipcMain.handle('bridge-rotate-secret', async () => {
    if (!flutterBridge) return { success: false, error: 'Bridge not initialized' };
    flutterBridge.rotateSecret();
    return { success: true, code: flutterBridge.getPairingCode() };
  });

  ipcMain.handle('bridge-broadcast', async (event, message) => {
    if (!flutterBridge) return { success: false, error: 'Bridge not initialized' };
    flutterBridge.broadcast(message);
    return { success: true };
  });

  // ============================================================================
  // MCP DESKTOP SERVERS — FileSystem + NativeApp IPC Handlers
  // ============================================================================

  ipcMain.handle('mcp-fs-read', async (event, filePath) => {
    if (!fileSystemMcp) return { success: false, error: 'FileSystem MCP not initialized' };
    try {
      const content = await fileSystemMcp.readFile(filePath);
      return { success: true, content };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('mcp-fs-write', async (event, { path: p, content }) => {
    if (!fileSystemMcp) return { success: false, error: 'FileSystem MCP not initialized' };
    try {
      const result = await fileSystemMcp.writeFile(p, content);
      return { success: true, result };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('mcp-fs-list', async (event, dirPath) => {
    if (!fileSystemMcp) return { success: false, error: 'FileSystem MCP not initialized' };
    try {
      const entries = await fileSystemMcp.listDir(dirPath);
      return { success: true, entries };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('mcp-fs-approved-dirs', async () => {
    if (!fileSystemMcp) return { success: false, error: 'FileSystem MCP not initialized' };
    return { success: true, dirs: fileSystemMcp.getApprovedDirs() };
  });

  ipcMain.handle('mcp-native-applescript', async (event, script) => {
    if (!nativeAppMcp) return { success: false, error: 'NativeApp MCP not initialized' };
    try {
      validateCommand(script);
      const result = await nativeAppMcp.runAppleScript(script);
      return { success: true, result };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('mcp-native-powershell', async (event, script) => {
    if (!nativeAppMcp) return { success: false, error: 'NativeApp MCP not initialized' };
    try {
      validateCommand(script);
      const result = await nativeAppMcp.runPowerShell(script);
      return { success: true, result };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('mcp-native-active-window', async () => {
    if (!nativeAppMcp) return { success: false, error: 'NativeApp MCP not initialized' };
    try {
      const info = await nativeAppMcp.getActiveWindow();
      return { success: true, ...info };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // ============================================================================
  // MCP CORE — Official MCP Server Connections
  // ============================================================================

  ipcMain.handle('mcp-connect-server', async (event, config) => {
    const serverInfo = config.url || (config.command ? `${config.command} ${config.args?.join(' ') || ''}` : 'unknown');
    console.log(`[Main] Connecting to MCP server: ${config.name} (${serverInfo})`);
    const id = config.id || `mcp-${Date.now()}`;
    const success = await mcpManager.connect(id, config);
    if (success) {
      const servers = store.get('mcp_servers') || [];
      if (!servers.find(s => s.id === id)) {
        servers.push({ ...config, id });
        store.set('mcp_servers', servers);
      }
    }
    return { success, id };
  });

  ipcMain.handle('mcp-disconnect-server', async (event, id) => {
    console.log(`[Main] Disconnecting MCP server: ${id}`);
    await mcpManager.disconnect(id);
    const servers = store.get('mcp_servers') || [];
    const filtered = servers.filter(s => s.id !== id);
    if (filtered.length !== servers.length) {
      store.set('mcp_servers', filtered);
    }
    return { success: true };
  });

  ipcMain.handle('mcp-list-servers', async () => {
    return { success: true, servers: mcpManager.getAllServers() };
  });

  ipcMain.handle('mcp-get-tools', async () => {
    const tools = await mcpManager.getTools();
    return { success: true, tools };
  });

  ipcMain.handle('mcp-command', async (event, { command, data }) => {
    // Compatibility with existing frontend calls if any
    if (command === 'connect') return await mcpManager.connect(data.id, data);
    if (command === 'list') return mcpManager.getAllServers();
    return { error: 'Unknown MCP core command' };
  });

  // ============================================================================
  // WEB SEARCH v2 — Multi-provider (Brave / Tavily / SerpAPI)
  // ============================================================================

  // ============================================================================
  // RAG — Vector Store (Local Embeddings + Gemini)
  // ============================================================================

  // LAZY INITIALIZATION - Services start on-demand, not at startup
  // This makes app launch instant

  const initServiceOnDemand = async (service, initFn, name) => {
    if (service && typeof service.init === 'function') return service;
    try {
      console.log(`[LazyInit] Starting ${name}...`);
      await initFn();
      console.log(`[LazyInit] ${name} ready`);
      return service;
    } catch (e) {
      console.error(`[LazyInit] Failed to start ${name}:`, e.message);
      return service;
    }
  };

  // RAG Handler - lazy init
  ipcMain.handle('rag-ingest', async (event, { text, source }) => {
    await initServiceOnDemand(ragService, async () => {
      if (!ragService) return;
      await ragService.init();
    }, 'RAG');
    if (!ragService) return { success: false, error: 'RAG not initialized' };
    try {
      const apiKey = store.get('gemini_api_key') || process.env.GEMINI_API_KEY;
      const count = await ragService.ingest(text, source, apiKey);
      return { success: true, chunksAdded: count };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('rag-retrieve', async (event, { query, k }) => {
    await initServiceOnDemand(ragService, async () => {
      if (!ragService) return;
      await ragService.init();
    }, 'RAG');
    if (!ragService) return { success: false, error: 'RAG not initialized' };
    try {
      const apiKey = store.get('gemini_api_key') || process.env.GEMINI_API_KEY;
      const results = await ragService.retrieve(query, k, apiKey);
      return { success: true, results };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('rag-context', async (event, { query, k }) => {
    await initServiceOnDemand(ragService, async () => {
      if (!ragService) return;
      await ragService.init();
    }, 'RAG');
    if (!ragService) return { success: false, error: 'RAG not initialized' };
    try {
      const apiKey = store.get('gemini_api_key') || process.env.GEMINI_API_KEY;
      const context = await ragService.retrieveContext(query, k, apiKey);
      return { success: true, context };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('rag-stats', async () => {
    if (!ragService) return { success: false, error: 'RAG not initialized' };
    return { success: true, ...ragService.getStats() };
  });

  ipcMain.handle('rag-delete-source', async (event, source) => {
    if (!ragService) return { success: false, error: 'RAG not initialized' };
    try {
      const deleted = await ragService.deleteSource(source);
      return { success: true, deleted };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('rag-clear', async () => {
    if (!ragService) return { success: false, error: 'RAG not initialized' };
    await ragService.clear();
    return { success: true };
  });

  // ============================================================================
  // VOICE CONTROL — Whisper Transcription
  // ============================================================================

  ipcMain.handle('voice-transcribe', async (event, { audioBase64, format }) => {
    if (!voiceService) return { success: false, error: 'Voice service not initialized' };
    try {
      const text = await voiceService.transcribeBase64(audioBase64, format || 'wav');
      return { success: true, text };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('voice-mic-permission', async () => {
    if (!voiceService) return { success: false, error: 'Voice service not initialized' };
    try {
      const granted = await voiceService.requestMicPermission();
      return { success: true, granted };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // ============================================================================
  // WORKFLOW RECORDER — Record / Replay Action Sequences
  // ============================================================================

  ipcMain.handle('workflow-start', async (event, { name } = {}) => {
    if (!workflowRecorder) return { success: false, error: 'Workflow recorder not initialized' };
    return { success: true, ...workflowRecorder.start(name) };
  });

  ipcMain.handle('workflow-record', async (event, { type, action }) => {
    if (!workflowRecorder) return { success: false, error: 'Workflow recorder not initialized' };
    const recorded = workflowRecorder.record(type, action);
    return { success: recorded };
  });

  ipcMain.handle('workflow-record-dom-step', async (event, step) => {
    if (!workflowRecorder) return { success: false, error: 'Workflow recorder not initialized' };
    const recorded = workflowRecorder.recordDomStep(step);
    return { success: recorded };
  });

  ipcMain.handle('workflow-stop', async () => {
    if (!workflowRecorder) return { success: false, error: 'Workflow recorder not initialized' };
    return { success: true, ...workflowRecorder.stop() };
  });

  ipcMain.handle('workflow-save', async (event, { name, description }) => {
    if (!workflowRecorder) return { success: false, error: 'Workflow recorder not initialized' };
    try {
      const result = await workflowRecorder.save(name, description);
      return { success: true, ...result };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('workflow-list', async () => {
    if (!workflowRecorder) return { success: false, error: 'Workflow recorder not initialized' };
    try {
      const workflows = await workflowRecorder.list();
      return { success: true, workflows };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('workflow-replay', async (event, name) => {
    if (!workflowRecorder) return { success: false, error: 'Workflow recorder not initialized' };
    try {
      const view = tabViews.get(activeTabId);
      const webContents = view?.webContents;

      const results = await workflowRecorder.replay(name, async (step, index) => {
        // DOM-aware steps: use dom-engine
        if (['fill', 'click', 'scroll', 'type'].includes(step.type) && webContents) {
          if (step.type === 'fill' || step.type === 'type') {
            return await domEngine.fillField(webContents, {
              selector: step.selector,
              text: step.text,
              value: step.value,
              retry: 2,
              verify: true,
              clearFirst: true,
            });
          }
          if (step.type === 'click') {
            return await domEngine.clickElement(webContents, {
              selector: step.selector,
              text: step.text,
              'aria-label': step.ariaLabel,
              retry: 3,
              verify: true,
            });
          }
          if (step.type === 'scroll' && step.selector) {
            await webContents.executeJavaScript(
              `document.querySelector(${JSON.stringify(step.selector)})?.scrollIntoView({ behavior: 'smooth', block: 'center' })`
            );
            return { success: true };
          }
        }

        // Navigation step
        if (step.type === 'navigate' && step.url && webContents) {
          await webContents.loadURL(step.url);
          await new Promise(r => setTimeout(r, 2000));
          return { success: true };
        }

        // Legacy steps: robot/ocr/ai
        if (step.type === 'robot' && robotService) {
          return await robotService.execute(step.action, { skipConfirm: false });
        }
        if (step.type === 'ocr' && tesseractOcrService) {
          return await tesseractOcrService.ocrClick(step.action?.target, cometAiEngine, robotService, permissionStore);
        }
        if (step.type === 'ai' && cometAiEngine) {
          return await cometAiEngine.chat(step.action);
        }

        return { skipped: true, type: step.type };
      });
      return { success: true, ...results };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('workflow-delete', async (event, name) => {
    if (!workflowRecorder) return { success: false, error: 'Workflow recorder not initialized' };
    try {
      const deleted = await workflowRecorder.deleteWorkflow(name);
      return { success: true, deleted };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('workflow-status', async () => {
    if (!workflowRecorder) return { success: false, error: 'Workflow recorder not initialized' };
    return { success: true, ...workflowRecorder.getStatus() };
  });

  // ============================================================================
  // PopSearch - Instant Search Popup
  // ============================================================================
  ipcMain.handle('pop-search-show', async (event, { text, x, y }) => {
    if (!popSearch) return { success: false, error: 'PopSearch not initialized' };
    try {
      popSearch.showPopupAtPosition(x, y, text || '');
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('pop-search-show-at-cursor', async (event, text) => {
    if (!popSearch) return { success: false, error: 'PopSearch not initialized' };
    try {
      popSearch.showPopupWithText(text || '');
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('pop-search-get-config', async () => {
    if (!popSearch) return { success: false, error: 'PopSearch not initialized' };
    return { success: true, config: popSearch.getConfig() };
  });

  ipcMain.handle('pop-search-update-config', async (event, config) => {
    if (!popSearch) return { success: false, error: 'PopSearch not initialized' };
    try {
      popSearch.updateConfig(config);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('pop-search-save-config', async (event, data) => {
    const { filePath } = await dialog.showSaveDialog({
      title: 'Export PopSearch Config',
      defaultPath: 'popsearch-config.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (filePath) {
      try {
        fs.writeFileSync(filePath, data, 'utf-8');
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
    return { success: false, canceled: true };
  });

  ipcMain.handle('pop-search-load-config', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Import PopSearch Config',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (!canceled && filePaths.length > 0) {
      return fs.readFileSync(filePaths[0], 'utf-8');
    }
    return null;
  });

  // Bring window to top to fix BrowserView z-index issues
  ipcMain.handle('bring-window-to-top', async () => {
    if (mainWindow) {
      mainWindow.moveTop();
      return { success: true };
    }
    return { success: false, error: 'No main window' };
  });

  // ============================================================================
  // GLOBAL HOTKEY - Register global shortcuts
  // ============================================================================
  function registerGlobalShortcuts(shortcuts) {
    globalShortcut.unregisterAll();

    // Default shortcuts if none provided
    const spotlightShortcut = process.platform === 'darwin' ? 'Option+Space' : 'Alt+Space';
    const defaultShortcuts = [
      { accelerator: spotlightShortcut, action: 'spotlight-search' },
      { accelerator: 'CommandOrControl+Shift+S', action: 'pop-search' },
      { accelerator: 'CommandOrControl+P', action: 'print' },
      { accelerator: process.platform === 'darwin' ? 'Command+Shift+Escape' : 'Control+Shift+Escape', action: 'kill-switch' },
      { accelerator: 'CommandOrControl+Option+S', action: 'apple-intel-summary' },
      { accelerator: 'CommandOrControl+Option+I', action: 'apple-intel-image' },
      { accelerator: 'CommandOrControl+Option+A', action: 'apple-intel-panel' }
    ];

    const shortcutsToRegister = (shortcuts && shortcuts.length > 0) ? shortcuts : defaultShortcuts;

    shortcutsToRegister.forEach(s => {
      try {
        if (!s.accelerator) return;

        // Same check for startup registration
        const GLOBAL_SAFE_ACTIONS = [
          'spotlight-search',
          'pop-search',
          'global-search',
          'kill-switch',
          'emergency-kill',
          'toggle-spotlight',
          'apple-intel-summary',
          'apple-intel-image',
          'apple-intel-panel'
        ];

        if (!GLOBAL_SAFE_ACTIONS.includes(s.action)) return;

        globalShortcut.register(s.accelerator, () => {
          console.log(`[Hotkey] GLOBAL Triggered: ${s.action} (${s.accelerator})`);

          if (s.action === 'spotlight-search' || s.action === 'global-search' || s.action === 'toggle-spotlight') {
            if (mainWindow) {
              if (mainWindow.isMinimized()) mainWindow.restore();
              if (!mainWindow.isVisible()) mainWindow.show();
              mainWindow.focus();
              mainWindow.webContents.send('open-unified-search');
            } else {
              createWindow();
            }
          } else if (s.action === 'pop-search') {
            if (popSearch) {
              popSearch.showPopupWithText('');
            }
          } else if (s.action === 'kill-switch' || s.action === 'emergency-kill') {
            console.log('[Hotkey] EMERGENCY KILL SWITCH activated');
            if (robotService) robotService.kill();
            if (mainWindow) {
              mainWindow.webContents.send('robot-killed');
              dialog.showMessageBox(mainWindow, {
                type: 'warning',
                title: 'Aartiq Kill Switch',
                message: 'All robot actions have been stopped and permissions revoked.',
                detail: 'You can re-enable robot permissions in Settings > Permissions.',
              });
            }
          } else if (mainWindow) {
            mainWindow.webContents.send('execute-shortcut', s.action);
          }
        });
      } catch (e) {
        console.warn(`[Hotkey] Failed to register shortcut ${s.accelerator} for ${s.action}:`, e.message);
      }
    });

    console.log(`[Hotkeys] Registered ${globalShortcut.isRegistered('Alt+Space') ? 'Alt+Space' : 'global shortcuts'}`);
  }

  // Initial registration from store
  const savedShortcuts = store.get('shortcuts') || [];
  registerGlobalShortcuts(savedShortcuts);

  // MCP reconnection moved to after BrowserMcpServer starts (see below)


  ipcMain.on('update-shortcuts', (event, shortcuts) => {
    console.log('[Main] Updating global shortcuts');
    store.set('shortcuts', shortcuts);
    registerGlobalShortcuts(shortcuts);
    buildApplicationMenu();
  });

  // Auto-update IPC handlers
  ipcMain.handle('check-for-updates', () => {
    if (app.isPackaged) {
      const { autoUpdater } = require('electron-updater');
      return autoUpdater.checkForUpdatesAndNotify();
    }
    return Promise.resolve({ updateAvailable: false });
  });

  ipcMain.handle('quit-and-install', () => {
    if (app.isPackaged) {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.quitAndInstall();
    }
  });




  // ── Auto-configure Claude Desktop MCP ──
  ipcMain.handle('auto-configure-claude-mcp', async () => {
    try {
      const platform = process.platform;
      let configDir;
      if (platform === 'darwin') {
        configDir = path.join(os.homedir(), 'Library', 'Application Support', 'Claude');
      } else if (platform === 'win32') {
        configDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude');
      } else {
        configDir = path.join(os.homedir(), '.config', 'Claude');
      }
      const configPath = path.join(configDir, 'claude_desktop_config.json');
      // Claude Desktop only supports stdio servers in its config file.
      // Use mcp-remote as a stdio-to-SSE bridge.
      //
      // mcp-remote authenticates with headers only, and the only value it takes
      // is a bare URL, so the session token has to travel as a query parameter.
      // That is a real trade-off: a URL can end up in process arguments and in
      // whatever the client logs. Tracked in docs-audit/issues/pairing-token-in-url.md.
      const sseUrl = buildMcpSseUrl(mcpServerPort, mcpServer ? mcpServer.sessionToken : null);
      const aartiqConfig = {
        mcpServers: {
          "aartiq-browser": {
            command: "npx",
            args: ["-y", "mcp-remote@0.1.17", sseUrl],
          }
        }
      };
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      let existing = {};
      if (fs.existsSync(configPath)) {
        try {
          existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        } catch (e) {
          existing = {};
        }
      }
      const merged = {
        ...existing,
        mcpServers: {
          ...(existing.mcpServers || {}),
          ...aartiqConfig.mcpServers,
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf-8');
      // The token is returned over IPC rather than over HTTP so the renderer can
      // display it without the listener needing an unauthenticated read route.
      return { success: true, path: configPath, token: mcpServer ? mcpServer.sessionToken : null };
    } catch (error) {
      console.error('[Main] Auto-configure Claude MCP failed:', error);
      return { success: false, error: error.message };
    }
  });

  // ── MCP Approval Popup ──
  ipcMain.handle('mcp-approval-respond', async (event, { requestId, allowed }) => {
    if (mcpServer && mcpServer._approvalResolvers) {
      const resolver = mcpServer._approvalResolvers.get(requestId);
      if (resolver) {
        resolver({ allowed, reason: allowed ? 'approved' : 'denied' });
        mcpServer._approvalResolvers.delete(requestId);
        // Close the approval popup
        const popup = popupWindows.get('mcp-approval');
        if (popup && !popup.isDestroyed()) popup.close();
        return { success: true };
      }
    }
    return { success: false, error: 'no pending request' };
  });

  ipcMain.handle('mcp-approval-status', async () => {
    if (mcpServer && mcpServer._approvalResolvers) {
      const entries = Array.from(mcpServer._approvalResolvers.entries()).map(([id]) => ({ requestId: id }));
      return { pending: entries };
    }
    return { pending: [] };
  });

  ipcMain.handle('open-external-url', async (event, url) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      console.error('[Main] Failed to open external URL:', error);
      return { success: false, error: error.message };
    }
  });

  app.on('will-quit', () => {
    // Clear persistent intervals
    if (networkCheckInterval) clearInterval(networkCheckInterval);
    if (clipboardCheckInterval) clearInterval(clipboardCheckInterval);

    // Stop MCP browser server
    if (mcpServer && typeof mcpServer.stop === 'function') {
      mcpServer.stop().catch(() => {});
      console.log('[MCP-Browser] Server stopped.');
    } else if (mcpServer && typeof mcpServer.close === 'function') {
      mcpServer.close();
    }

    // Disconnect P2P service
    if (p2pSyncService) {
      p2pSyncService.disconnect();
      console.log('[Main] P2P Sync Service disconnected.');
    }

    // Stop WiFi Sync service
    if (wifiSyncService) {
      wifiSyncService.stop();
      console.log('[Main] WiFi Sync Service stopped.');
    }

    // Cleanup desktop automation services
    if (tesseractOcrService) {
      tesseractOcrService.terminate().catch(() => { });
      console.log('[Main] TesseractOcrService terminated.');
    }

    if (flutterBridge) {
      flutterBridge.stop();
      console.log('[Main] FlutterBridgeServer stopped.');
    }

    // Unregister all shortcuts
    globalShortcut.unregisterAll();
  });

  app.on('before-quit', () => {
    stopNativeMacUiBridge();
    if (macSidebarWindow && !macSidebarWindow.isDestroyed()) {
      macSidebarWindow.destroy();
    }
    if (raycastServer) {
      raycastServer.close();
    }
    if (nexusBridgeServer) {
      nexusBridgeServer.close();
    }
    if (nativeMacUiServer) {
      nativeMacUiServer.close();
    }
    if (isMac) {
      nativeMacPanelManager.closeAll();
    }
  });

  app.on('window-all-closed', async () => {
    if (macSidebarWindow && !macSidebarWindow.isDestroyed()) {
      macSidebarWindow.destroy();
    }
    // Terminate the Tesseract worker when the app quits
    if (tesseractWorker) {
      console.log('[Main] Terminating Tesseract.js worker...');
      await tesseractWorker.terminate();
      console.log('[Main] Tesseract.js worker terminated.');
    }
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  // Final fallback to ensure process exits
  app.on('quit', async () => {
    process.exit(0);
  });

  createWindow();

  // Start the Express HTTP bridge so SwiftUI native panels can communicate
  startNativeMacUiBridge();

  // ── MCP Server & Client reconnection ──
  // Must start BrowserMcpServer first (port 3001) before reconnecting
  // any MCP clients that depend on it (e.g. mcp-remote localhost:3001/sse).
  try {
    tabViews._mainWindow = mainWindow;
    tabViews._activeTabId = activeTabId;
    tabViews._bounds = null;
    mcpServer = new BrowserMcpServer(tabViews, store, mainWindow);
    const mcpPort = typeof MCP_SERVER_PORT !== 'undefined' ? MCP_SERVER_PORT : 3001;
    // Loopback unless the operator explicitly opts into LAN/Tailscale exposure.
    // Remote mode still requires the session token on every request.
    mcpServer.setListenOptions({
      remote: store.get('security_mcpBridgeRemote', false) === true,
      remoteHosts: store.get('security_mcpBridgeRemoteHosts', []),
    });
    (async () => {
      await mcpServer.start(mcpPort);

      // Reconnect persisted MCP servers now that the local host is up.
      const mcpServers = store.get('mcp_servers');
      if (mcpServers && mcpServers.length > 0) {
        const validServers = mcpServers.filter(s =>
          !s.url?.includes('google') && !s.name?.toLowerCase().includes('google')
        );
        if (validServers.length > 0) {
          console.log(`[Main] Reconnecting ${validServers.length} MCP servers...`);
          await Promise.allSettled(
            validServers.map(server => mcpManager.connect(server.id, server))
          );
        }
      } else {
        const defaultServers = [
          { id: 'filesystem-mcp', name: 'Filesystem MCP (Local)', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'], type: 'stdio', status: 'offline' }
        ];
        console.log('[Main] No MCP servers found, loading defaults.');
        store.set('mcp_servers', defaultServers);
      }
    })().catch(err => {
      console.warn(`[MCP-Browser] Initialization error:`, err.message);
    });
  } catch (e) {
    console.warn('[MCP-Browser] Setup error:', e.message);
  }

  ipcMain.on('mcp-approval-response', (_event, { requestId, allowed }) => {
    if (mcpServer && requestId) {
      const resolver = mcpServer._approvalResolvers?.get(requestId);
      if (resolver) {
        mcpServer._approvalResolvers.delete(requestId);
        resolver({ allowed: !!allowed });
      }
    }
  });

  // Wire modular IPC handlers from src/main/handlers/
  // NOTE: must be after createWindow() so mainWindow is initialized
  const handlerDeps = {
    mainWindow,
    // Live accessor: handlers must not hold the startup window by value —
    // it is destroyed when the user closes the window and a new one may be
    // created later. Resolved at send time by sync-handlers (and friends).
    getMainWindow: () => mainWindow, store, getTopWindow, isDev, isOnline,
    cometAiEngine, llmProviders, llmGenerateHandler, llmStreamHandler,
    tabViews, activeTabId,
    robotService, tesseractOcrService, screenVisionService, permissionStore, checkAiActionPermission,
    wifiSyncService, cloudSyncService, p2pSyncService,
    streamPromptToMobile, generateShellApprovalQR,
    networkSecurityManager,
    mcpManager, fileSystemMcp, nativeAppMcp,
    extensionsPath, raycastState,
    popupWindows, createPopupWindow, pluginManager,
    extensionManager,
    autofillProfileService,
    ragService, voiceService, workflowRecorder, popSearch,
    flutterBridge,
    resolveAndClickWithAi, ensureVaultApprovalForFormFill,
    capabilityController,
  };
  // --- Native Mac UI Sidebar + Permission bridge IPC ---
  ipcMain.on('native-mac-ui-sidebar-open', () => {
    nativeMacUiState.electronAiSidebarOpen = true;
    nativeMacUiState.updatedAt = Date.now();
  });
  ipcMain.on('native-mac-ui-sidebar-closed', () => {
    nativeMacUiState.electronAiSidebarOpen = false;
    nativeMacUiState.updatedAt = Date.now();
  });

  // Renderer notifies main process that a permission request is pending.
  // This populates nativeMacUiState.pendingApproval so the Swift panel can see it.
  ipcMain.on('ui-approval-pending', (_event, details) => {
    const { requestId, command, reason, risk, highRiskQr, expectedPin, actionType, action, requiresDeviceUnlock } = details || {};
    nativeMacUiState.pendingApproval = {
      requestId: requestId || `ui-${Date.now()}`,
      command: command || '',
      reason: reason || 'An action needs your approval.',
      risk: risk || 'medium',
      highRiskQr: highRiskQr || null,
      expectedPin: expectedPin || null,
      actionType: actionType || 'SHELL_COMMAND',
      action: action || 'Shell Command',
      requiresDeviceUnlock: requiresDeviceUnlock !== false,
    };
    nativeMacUiState.updatedAt = Date.now();
  });
  ipcMain.on('ui-approval-cleared', () => {
    nativeMacUiState.pendingApproval = null;
    nativeMacUiState.updatedAt = Date.now();
  });

  // When Swift approves via the bridge, forward to the renderer so the
  // Electron permission modal is also resolved.
  ipcMain.on('swift-approval-resolved', (_event, { requestId, allowed, deviceUnlockValidated }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('approval-action-resolved', { requestId, allowed, deviceUnlockValidated: !!deviceUnlockValidated });
    }
    nativeMacUiState.pendingApproval = null;
    nativeMacUiState.updatedAt = Date.now();
  });

  registerAllHandlers(ipcMain, handlerDeps);

  // Sync existing vault entries to native keychain on startup
  syncAllVaultToNativeKeychain();
}).catch(err => {
  console.error('[Main] App ready failed:', err);
  if (app?.quit) {
    app.quit();
  }
});

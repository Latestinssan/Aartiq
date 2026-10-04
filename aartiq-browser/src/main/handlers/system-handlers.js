const { ipcMain, session } = require('electron');
const { exec, execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { PermissionStore } = require('../../lib/permission-store');

// Shared permission store for the sandbox-aware file handlers below. Default
// directories (Home, Desktop, Documents, Downloads, …) are available
// synchronously at construction; persisted user entries load asynchronously.
const permissionStore = new PermissionStore();
permissionStore.load().catch(() => {});


module.exports = function registerSystemHandlers(ipcMain, handlers) {
  const { mainWindow, store, extensionsPath, tabViews, capabilityController } = handlers;

  // =========================================================================
  // execute-shell-command — The primary shell execution IPC channel.
  //
  // Call path: AIChatSidebar.tsx → preload → 'execute-shell-command' → here
  //
  // Route through:
  //   1. utils.execShellCommand → validateCommand + checkShellPermission
  //   2. CapabilityController.executeAction (ticket-based approval)
  //
  // Audit-doc line items: 3b, 3c, 3d.
  // =========================================================================
  ipcMain.handle('execute-shell-command', async (event, { rawCommand, preApproved, reason, riskLevel }) => {
    // Route through capability controller first — rejects unregistered actions
    if (capabilityController) {
      const capResult = await capabilityController.executeAction('execute-shell-command', {
        rawCommand, preApproved, reason, riskLevel,
      });
      if (!capResult.approved) {
        if (capResult.needsApproval) {
          return { success: false, error: 'Approval required', needsApproval: true, ticketId: capResult.ticketId, metadata: capResult.metadata };
        }
        return { success: false, error: capResult.reason || 'Blocked by capability controller.' };
      }
    }

    const { execShellCommand } = require('./utils.js');
    return await execShellCommand(rawCommand, preApproved, reason, riskLevel);
  });

  // =========================================================================
  // Directory Permission Bridge — interactive path-access requests
  //
  // When a shell command tries to access a path outside the allowlist the
  // bridge emits 'directory-permission-request' to the renderer, which shows
  // a warning panel.  The renderer responds via 'directory-permission-response'.
  // =========================================================================
  (() => {
    const bridge = require('../../core/directory-permission-bridge');
    // Give the bridge a reference to the window so it can emit events
    if (mainWindow) {
      bridge.setMainWindow(mainWindow);
    }

    // Handle renderer response (granted or denied)
    ipcMain.on('directory-permission-response', (event, { requestId, granted }) => {
      bridge.resolvePermission(requestId, !!granted);
    });
  })();

  // =========================================================================
  // Shell Permission Bridge — interactive command execution requests
  // =========================================================================
  (() => {
    const shellBridge = require('../../core/shell-permission-bridge');
    if (mainWindow) {
      shellBridge.setMainWindow(mainWindow);
    }

    ipcMain.on('shell-permission-response', (event, { requestId, granted, remember }) => {
      shellBridge.resolvePermission(requestId, !!granted, !!remember);
    });
  })();



  ipcMain.handle('search-applications', async (event, query) => {
    const { searchApplications } = require('./utils.js');
    return await searchApplications(query);
  });

  ipcMain.handle('open-external-app', async (event, appPath) => {
    const { shell } = require('electron');
    const { exec } = require('child_process');
    try {
      if (process.platform === 'darwin') {
        if (appPath.includes('/')) {
          shell.openPath(appPath);
        } else {
          await new Promise((resolve, reject) => {
            exec(`open -a "${appPath}"`, (err) => {
              if (err) reject(err); else resolve(true);
            });
          });
        }
      } else if (process.platform === 'win32') {
        await new Promise((resolve, reject) => {
          exec(`start "" "${appPath}"`, { shell: true }, (err) => {
            if (err) reject(err); else resolve(true);
          });
        });
      } else {
        exec(`xdg-open "${appPath}"`, { shell: true });
      }
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('show-item-in-folder', async (event, filePath) => {
    const { shell } = require('electron');
    try {
      // Chat messages use home-relative paths (`~/Documents/report.pdf`);
      // shell.showItemInFolder does not expand `~`, so resolve it here.
      let resolved = String(filePath);
      if (resolved === '~') {
        resolved = require('os').homedir();
      } else if (resolved.startsWith('~/') || resolved.startsWith('~\\')) {
        resolved = require('os').homedir() + resolved.slice(1);
      }
      shell.showItemInFolder(resolved);
      return { success: true };
    }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('set-volume', async (event, level) => {
    // Sanitize: validate numeric input 0–100 before use.
    // Use execFile (no shell interpretation) to prevent injection via level value.
    const sanitizedLevel = Math.min(100, Math.max(0, parseInt(level, 10) || 0));
    if (process.platform === 'darwin') {
      return new Promise((resolve) => {
        execFile('osascript', ['-e', `set volume output volume ${sanitizedLevel}`], { timeout: 5000 }, (err) => {
          resolve(err ? { success: false, error: err.message } : { success: true });
        });
      });
    }
    return { success: true };
  });

  ipcMain.handle('set-brightness', async (event, level) => {
    // Sanitize: validate numeric input 0–100 before use.
    // Use execFile (no shell interpretation) to prevent injection via level value.
    const sanitizedLevel = Math.min(100, Math.max(0, parseInt(level, 10) || 0));
    if (process.platform === 'darwin') {
      return new Promise((resolve) => {
        execFile('brightness', [String(sanitizedLevel)], { timeout: 5000 }, (err) => {
          resolve(err ? { success: false, error: err.message } : { success: true });
        });
      });
    }
    return { success: true };
  });

  ipcMain.handle('set-browser-font', async (event, { fontFamily, fontSize }) => {
    try {
      const activeTabId = tabViews._activeTabId;
      const view = activeTabId ? tabViews.get(activeTabId) : null;
      if (!view || view.webContents.isDestroyed()) return { success: false, error: 'No active browser view' };

      const css = `
        *, *::before, *::after {
          font-family: ${fontFamily} !important;
        }
        ${fontSize ? `body { font-size: ${fontSize}px !important; }` : ''}
      `;
      await view.webContents.insertCSS(css);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('set-alarm', async (event, { time, message }) => {
    // Sanitize inputs: validate time is a valid date, sanitize message to prevent
    // AppleScript injection via unsanitized string interpolation.
    const alarmTime = new Date(time);
    if (isNaN(alarmTime.getTime())) {
      return { success: false, error: 'Invalid time format' };
    }
    // Escape single quotes in message to prevent AppleScript injection
    const safeMessage = String(message || 'Reminder').replace(/'/g, "'\\''");
    if (process.platform === 'darwin') {
      return new Promise((resolve) => {
        execFile('osascript', [
          '-e',
          `tell application "Reminders" to make new reminder with properties {name:"${safeMessage}", remind me date:"${alarmTime.toISOString()}"}`,
        ], { timeout: 5000 }, (err) => {
          resolve(err ? { success: false, error: err.message } : { success: true });
        });
      });
    }
    return { success: true };
  });

  ipcMain.handle('encrypt-data', async (event, { data, key }) => {
    try {
      // Migrate from legacy PBKDF2 (100K, SHA-512) to the modern scheme
      // matching crypto-utils.ts: PBKDF2 600K iterations, SHA-256, AES-256-GCM.
      const salt = crypto.randomBytes(16);
      const iv = crypto.randomBytes(12); // 12 bytes for GCM (matches crypto-utils.ts IV_BYTES)
      const derivedKey = await new Promise((resolve, reject) => {
        crypto.pbkdf2(key, salt, 600_000, 32, 'sha256', (err, dk) => {
          if (err) reject(err); else resolve(dk);
        });
      });
      const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
      const encrypted = Buffer.concat([cipher.update(Buffer.from(data, 'utf8')), cipher.final()]);
      const authTag = cipher.getAuthTag();
      // Format: E2EE2: prefix + base64(salt || iv || ciphertext || authTag)
      // This matches the crypto-utils.ts format for interoperability.
      const combined = Buffer.concat([salt, iv, encrypted, authTag]);
      const prefixedData = `E2EE2:${combined.toString('base64')}`;
      return { encryptedData: prefixedData };
    } catch (error) { return { error: error.message }; }
  });

  ipcMain.handle('decrypt-data', async (event, { encryptedData, key }) => {
    try {
      let salt, iv, ciphertext, authTag;
      const dataStr = typeof encryptedData === 'string' ? encryptedData : '';
      if (dataStr.startsWith('E2EE2:')) {
        // New format: E2EE2: + base64(salt || iv || ciphertext || authTag)
        const combined = Buffer.from(dataStr.slice(6), 'base64');
        salt = combined.slice(0, 16);
        iv = combined.slice(16, 28);
        authTag = combined.slice(combined.length - 16);
        ciphertext = combined.slice(28, combined.length - 16);
      } else if (dataStr.startsWith('E2EE:') || dataStr.startsWith('LCL:')) {
        // Legacy format: handle migration
        if (dataStr.startsWith('LCL:')) {
          // LCL is plaintext base64 — just decode
          const decoded = Buffer.from(dataStr.slice(4), 'base64').toString('utf8');
          return { decryptedData: decoded };
        }
        // E2EE: legacy format (iv || ciphertext, SHA-512 PBKDF2 100K)
        const raw = Buffer.from(dataStr.slice(5), 'base64');
        iv = raw.slice(0, 12);
        ciphertext = raw.slice(12);
        const derivedKey = await new Promise((resolve, reject) => {
          crypto.pbkdf2(key, Buffer.alloc(0), 100_000, 32, 'sha512', (err, dk) => {
            if (err) reject(err); else resolve(dk);
          });
        });
        const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return { decryptedData: decrypted.toString('utf8'), migrated: true };
      } else {
        // Assume raw buffer format from old IPC (encryptedData as buffer-like)
        const rawBuf = Buffer.from(encryptedData);
        // Legacy: iv(16) || salt || ciphertext || authTag — try best-effort
        return { error: 'Unrecognized ciphertext format. Data may need re-encryption.' };
      }
      // Decrypt with new scheme (600K PBKDF2 SHA-256)
      const derivedKey = await new Promise((resolve, reject) => {
        crypto.pbkdf2(key, salt, 600_000, 32, 'sha256', (err, dk) => {
          if (err) reject(err); else resolve(dk);
        });
      });
      const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return { decryptedData: decrypted.toString('utf8') };
    } catch (error) { return { error: error.message }; }
  });

  ipcMain.handle('create-desktop-shortcut', async (event, { url, title }) => {
    const desktopPath = path.join(require('os').homedir(), 'Desktop');
    const shortcutPath = path.join(desktopPath, `${title.replace(/[^a-z0-9]/gi, '_').substring(0, 30)}.url`);
    const content = `[InternetShortcut]\nURL = ${url}\n`;
    try { fs.writeFileSync(shortcutPath, content); return { success: true, path: shortcutPath }; }
    catch (error) { return { error: error.message }; }
  });

  // ============================================================================
  // BIOMETRIC AUTHENTICATION (Windows Hello + Touch ID + Linux)
  // ============================================================================
  try {
    const { BiometricAuthManager, CrossPlatformBiometricAuth } = require('../../service/biometric-auth.js');
    const biometricAuth = new BiometricAuthManager();
    const crossPlatformAuth = new CrossPlatformBiometricAuth();

    ipcMain.handle('biometric-check', async () => {
      try { return await biometricAuth.quickCheck(); }
      catch { return { available: false, type: 'none' }; }
    });
    ipcMain.handle('biometric-authenticate', async (event, reason) => {
      try { return await biometricAuth.authenticate(reason || 'Authenticate to proceed'); }
      catch (err) { return { success: false, error: err.message }; }
    });
    ipcMain.handle('biometric-execute', async (event, actions, reason) => {
      try { return await crossPlatformAuth.executeWithAuth(actions, reason || 'Execute critical action'); }
      catch (err) { return { success: false, error: err.message }; }
    });
    console.log('[Handlers] Cross-platform biometric authentication registered');
  } catch (error) {
    console.warn('[Handlers] Biometric auth initialization failed, registering fallback handlers:', error.message);
    ipcMain.handle('biometric-check', async () => ({ available: false, type: 'none' }));
    ipcMain.handle('biometric-authenticate', async () => ({ success: false, error: 'Biometric authentication unavailable' }));
    ipcMain.handle('biometric-execute', async () => ({ success: false, error: 'Biometric execution unavailable' }));
  }

  ipcMain.on('raycast-update-state', (event, state) => {
    const { raycastState } = handlers;
    if (raycastState) {
      if (state?.tabs) raycastState.tabs = state.tabs.slice(-100);
      if (state?.history) raycastState.history = state.history.slice(-200);
    }
  });

  ipcMain.handle('check-python-available', async () => {
    try {
      const { execSync } = require('child_process');
      execSync('python3 --version', { timeout: 3000 });
      return true;
    } catch {
      try {
        const { execSync } = require('child_process');
        execSync('python --version', { timeout: 3000 });
        return true;
      } catch {
        return false;
      }
    }
  });

  // =========================================================================
  // FILE MANAGEMENT — Dedicated handlers that route around the shell sandbox.
  // These use isPathAllowed() directly on both source and dest paths, then
  // perform the operation via Node.js fs APIs (no subprocess spawn).
  // =========================================================================

  ipcMain.handle('file-move', async (event, { source, dest }) => {
    const { isPathAllowed } = require('../../core/directory-allowlist');
    try {
      const dirs = permissionStore?.getAllowedDirectories?.() || [];
      const srcCheck = isPathAllowed(source, dirs, 'read');
      if (!srcCheck.allowed) {
        return { success: false, error: `Source path denied: ${srcCheck.reason}` };
      }
      const destCheck = isPathAllowed(dest, dirs, 'write');
      if (!destCheck.allowed) {
        return { success: false, error: `Destination path denied: ${destCheck.reason}` };
      }
      const resolved = require('path').resolve(source);
      const resolvedDest = require('path').resolve(dest);
      fs.renameSync(resolved, resolvedDest);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('file-copy', async (event, { source, dest }) => {
    const { isPathAllowed } = require('../../core/directory-allowlist');
    try {
      const dirs = permissionStore?.getAllowedDirectories?.() || [];
      const srcCheck = isPathAllowed(source, dirs, 'read');
      if (!srcCheck.allowed) {
        return { success: false, error: `Source path denied: ${srcCheck.reason}` };
      }
      const destCheck = isPathAllowed(dest, dirs, 'write');
      if (!destCheck.allowed) {
        return { success: false, error: `Destination path denied: ${destCheck.reason}` };
      }
      fs.copyFileSync(require('path').resolve(source), require('path').resolve(dest));
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('file-open', async (event, filePath) => {
    const { isPathAllowed } = require('../../core/directory-allowlist');
    try {
      const dirs = permissionStore?.getAllowedDirectories?.() || [];
      const check = isPathAllowed(filePath, dirs, 'read');
      if (!check.allowed) {
        return { success: false, error: `Access denied: ${check.reason}` };
      }
      const { shell } = require('electron');
      await shell.openPath(require('path').resolve(filePath));
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('file-print', async (event, filePath) => {
    const { isPathAllowed } = require('../../core/directory-allowlist');
    try {
      const dirs = permissionStore?.getAllowedDirectories?.() || [];
      const check = isPathAllowed(filePath, dirs, 'read');
      if (!check.allowed) {
        return { success: false, error: `Access denied: ${check.reason}` };
      }
      const resolved = require('path').resolve(filePath);
      if (mainWindow && !mainWindow.isDestroyed()) {
        const fileContent = fs.readFileSync(resolved);
        const ext = require('path').extname(resolved).toLowerCase();
        if (ext === '.pdf') {
          mainWindow.webContents.send('print-pdf', { filePath: resolved });
        } else {
          mainWindow.webContents.send('print-file', { filePath: resolved, content: fileContent.toString() });
        }
        return { success: true };
      }
      return { success: false, error: 'No active window for printing' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('file-check-access', async (event, { filePath, operation }) => {
    const { isPathAllowed } = require('../../core/directory-allowlist');
    try {
      const dirs = permissionStore?.getAllowedDirectories?.() || [];
      const result = isPathAllowed(filePath, dirs, operation || 'read');
      return result;
    } catch (e) {
      return { allowed: false, reason: e.message, matchedEntry: null };
    }
  });

  // =========================================================================
  // DIRECTORY ACCESS REQUEST — Batched multi-directory approval
  // =========================================================================

  ipcMain.handle('request-directory-access', async (event, { requests }) => {
    if (!Array.isArray(requests) || requests.length === 0) {
      return { success: false, error: 'No directory requests provided' };
    }

    const results = [];
    for (const req of requests) {
      const { isPathAllowed } = require('../../core/directory-allowlist');
      const dirs = permissionStore?.getAllowedDirectories?.() || [];
      const operation = req.access === 'read-write' ? 'write' : 'read';
      const check = isPathAllowed(req.path, dirs, operation);
      results.push({
        path: req.path,
        access: req.access || 'read',
        reason: req.reason || '',
        allowed: check.allowed,
        needsApproval: !check.allowed,
        matchedEntry: check.matchedEntry,
      });
    }

    const needsApproval = results.filter(r => r.needsApproval);
    if (needsApproval.length === 0) {
      return { success: true, results, approved: true };
    }

    // Request approval through capability controller
    if (capabilityController) {
      const ticket = capabilityController.ticketManager.issueTicket(
        'request-directory-access',
        { requests: needsApproval },
        { riskLevel: 'medium', description: `Access to ${needsApproval.length} directory(ies)` }
      );
      if (capabilityController.onApprovalRequired) {
        capabilityController.onApprovalRequired(ticket);
      }
      return {
        success: false,
        needsApproval: true,
        ticketId: ticket.ticketId,
        results,
        pendingPaths: needsApproval.map(r => r.path),
      };
    }

    return { success: false, error: 'No approval system available', results };
  });

  console.log('[Handlers] System handlers registered');
};
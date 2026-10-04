const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { exec } = require('child_process');

exports.getAppIcon = async function(appPath) {
  if (!appPath || process.platform !== 'darwin') return null;
  return appPath;
};

exports.getAppIconBase64 = async function() {
  try {
    const { app } = require('electron');
    const appPath = app.getAppPath();
    const isPackaged = app.isPackaged;
    const candidates = isPackaged ? [
      path.join(appPath, 'assets', 'icon-transparent.png'),
      path.join(appPath, 'assets', 'icon.png'),
      path.join(appPath, 'app.asar.unpacked', 'assets', 'icon-transparent.png'),
      path.join(appPath, 'app.asar.unpacked', 'assets', 'icon.png'),
      path.join(process.resourcesPath, 'app', 'assets', 'icon-transparent.png'),
      path.join(process.resourcesPath, 'app', 'assets', 'icon.png'),
      path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'icon-transparent.png'),
      path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'icon.png'),
      path.join(process.resourcesPath, 'assets', 'icon-transparent.png'),
      path.join(process.resourcesPath, 'assets', 'icon.png'),
    ] : [
      path.join(__dirname, '../../assets/icon-transparent.png'),
      path.join(__dirname, '../../assets/icon.png'),
      path.join(appPath, 'assets/icon-transparent.png'),
      path.join(appPath, 'assets/icon.png'),
    ];
    for (const iconPath of candidates) {
      if (fs.existsSync(iconPath)) {
        const mime = iconPath.endsWith('.png') ? 'image/png' : 'image/x-icon';
        return `data:${mime};base64,${fs.readFileSync(iconPath).toString('base64')}`;
      }
    }
    return null;
  } catch (e) { return null; }
};

exports.scanDirectoryRecursive = async function(folderPath, types) {
  const results = [];
  const scan = async (dir, depth = 0) => {
    if (depth > 5) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await scan(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (!types || types.includes(ext)) {
            results.push({ name: entry.name, path: fullPath, size: fs.statSync(fullPath).size });
          }
        }
      }
    } catch (e) {}
  };
  await scan(folderPath);
  return results;
};

exports.searchApplications = async function(query) {
  const platform = process.platform;
  const results = [];
  try {
    if (platform === 'win32') {
      const searchPaths = [path.join(process.env.ProgramData, 'Microsoft/Windows/Start Menu/Programs'), path.join(process.env.APPDATA, 'Microsoft/Windows/Start Menu/Programs')];
      for (const searchPath of searchPaths) {
        if (fs.existsSync(searchPath)) {
          const getFiles = (dir, depth = 0) => {
            if (depth > 3) return [];
            let res = [];
            try {
              const list = fs.readdirSync(dir, { withFileTypes: true });
              for (const file of list) {
                const resPath = path.resolve(dir, file.name);
                if (file.isDirectory()) res = res.concat(getFiles(resPath, depth + 1));
                else if (file.name.toLowerCase().includes(query.toLowerCase()) && (file.name.endsWith('.lnk') || file.name.endsWith('.exe'))) res.push({ name: path.basename(file.name, path.extname(file.name)), path: resPath });
              }
            } catch (e) { return []; }
            return res;
          };
          results.push(...getFiles(searchPath));
        }
      }
    } else if (platform === 'darwin') {
      const appsPath = '/Applications';
      if (fs.existsSync(appsPath)) {
        const apps = fs.readdirSync(appsPath);
        apps.forEach(app => {
          if (app.toLowerCase().includes(query.toLowerCase()) && app.endsWith('.app')) {
            results.push({ name: path.basename(app, '.app'), path: path.join(appsPath, app) });
          }
        });
      }
    }
  } catch (e) { console.error('Search apps error:', e); }
  return { success: true, results: results.slice(0, 20) };
};

/**
 * Execute a shell command through the full validation + permission pipeline.
 *
 * Call path: AIChatSidebar.tsx → preload → execute-shell-command IPC → here
 *
 * 1. Validate command via SecurityValidator (dangerous patterns, blocked list)
 * 2. Check permission store via checkShellPermission (risk-tiered)
 * 3. Execute via sandboxed executor (OS-level filesystem/network confinement)
 *
 * Audit-doc line items: 3b (system-handlers.js execute-shell-command),
 * 3c (shell-executor.js), 3d (command-validator.js checkShellPermission),
 * §6 (OS-level sandboxing).
 */
/**
 * Extract file paths from a shell command string.
 * Handles quoted paths, unquoted paths after common flags, and bare paths.
 */
function extractPathsFromCommand(command) {
  const paths = new Set();
  // Match quoted paths (single or double quotes)
  const quoted = command.match(/(?:"([^"]+)"|'([^']+)')/g);
  if (quoted) {
    for (const q of quoted) {
      const p = q.slice(1, -1);
      if (p.startsWith('/') || p.startsWith('~/') || p.startsWith('.')) {
        paths.add(p);
      }
    }
  }
  // Match common file operation flags followed by paths
  const flagPattern = /(?:-[^o\s]*\s+)?((?:\/[\w./-]+|(?:~\/|\.\.?\/)[\w./-]+))/g;
  let match;
  while ((match = flagPattern.exec(command)) !== null) {
    const p = match[1];
    if (p && !p.startsWith('-')) {
      paths.add(p);
    }
  }
  return [...paths];
}

exports.execShellCommand = async function(rawCommand, preApproved, reason, riskLevel) {
  const { validateCommand, checkShellPermission, analyzeCommandRisk } = require('../../core/command-validator');
  const { validateCommand: securityValidate } = require('../../lib/SecurityValidator');
  const { executeSandboxed, executeShellScript } = require('../../core/sandbox-executor');

  let command;
  try {
    if (preApproved) {
      command = rawCommand.trim();
      if (!command) throw new Error('Invalid command: empty command');
      if (command.length > 10000) throw new Error('Command too long (max 10000 characters)');
    } else {
      command = validateCommand(rawCommand);
    }
  } catch (e) {
    return { success: false, error: e.message };
  }

  // 2. Determine risk level if not provided
  const effectiveRisk = riskLevel || analyzeCommandRisk(command);

  // 3. Directory allowlist check — if blocked, collect all blocked paths and request interactive permission at once
  try {
    const { PermissionStore } = require('../../lib/permission-store');
    const bridge = require('../../core/directory-permission-bridge');
    const store = new PermissionStore();
    await store.load();
    const allowedDirs = store.getAllowedDirectories();
    const paths = extractPathsFromCommand(command);

    const blockedPaths = [];
    for (const p of paths) {
      if (!store.isDirectoryAllowed(p)) {
        blockedPaths.push(p);
      }
    }

    if (blockedPaths.length > 0) {
      store.logAudit(`directory-allowlist.blocked: ${blockedPaths.join(', ')} in command: ${command}`);

      // Ask renderer to show a permission panel for all blocked paths at once
      const granted = await bridge.requestDirectoryPermission(blockedPaths, command);

      if (!granted) {
        return {
          success: false,
          error: `Access denied: "${blockedPaths.join(', ')}" is outside allowed directories. Add in Settings > Permissions > Directory Allowlist.`,
          blockedPath: blockedPaths[0],
          blockedPaths,
          allowedDirectories: allowedDirs,
        };
      }

      // User granted — add all blocked directories (parent folders) to the allowlist
      const nodePath = require('path');
      const fs = require('fs');
      const os = require('os');
      for (const p of blockedPaths) {
        let dirToAdd;
        try {
          const expanded = p.replace(/^~(?=\/|$)/, os.homedir());
          dirToAdd = (fs.existsSync(expanded) && fs.statSync(expanded).isDirectory()) ? expanded : nodePath.dirname(expanded);
        } catch (e) {
          dirToAdd = nodePath.dirname(p);
        }
        store.addAllowedDirectory(dirToAdd, { access: 'read', recursive: true });
        store.logAudit(`directory-allowlist.granted-via-panel: ${dirToAdd} for command: ${command} (read-only)`);
      }
    }
  } catch (e) {
    // If permission store fails to load, continue without directory check
    console.warn('[execShellCommand] Directory allowlist check skipped:', e.message);
  }

  // 4. Permission check — prompt user via permission dialog if not authorized
  if (!preApproved) {
    let authorized = checkShellPermission(command, reason, effectiveRisk);
    if (!authorized) {
      const shellBridge = require('../../core/shell-permission-bridge');
      const { granted, remember } = await shellBridge.requestShellPermission(command, reason, effectiveRisk);
      if (!granted) {
        return { success: false, error: 'Shell command execution denied by user.' };
      }
      if (remember) {
        // Only persist a grant when the command is eligible for one. The dialog
        // already hides "Allow Always" for these, but this is the enforcement
        // point: a renderer that sends remember:true anyway must not create a
        // grant the UI would not have offered.
        const { alwaysApprovalEligibility } = require('../../lib/shell-command-tiers');
        const verdict = alwaysApprovalEligibility(command);
        if (!verdict.eligible) {
          console.warn(
            `[execShellCommand] Ignoring "Always" for this command (${verdict.reason}); ` +
            'allowing it once, but not storing a grant.',
          );
        } else {
          try {
            const { PermissionStore } = require('../../lib/permission-store');
            const { normalizeCommandPattern } = require('../../lib/shell-command-tiers');
            const store = new PermissionStore();
            await store.load();
            // Full normalised command line, not the first word. A grant for
            // `grep pattern notes.md` no longer covers `grep pattern ~/.ssh/id_rsa`.
            store.setAutoCommand(normalizeCommandPattern(command), true);
          } catch (e) {
            console.warn('[execShellCommand] Failed to save auto-approved command:', e.message);
          }
        }
      }
    }
  }

  // 5. Execute via sandboxed executor (OS-level confinement).
  //
  //    The sandbox is FAIL-CLOSED: if the platform sandbox cannot be built or
  //    verified, the command is NOT run and a structured error is returned.
  //    There is no automatic fallback to unsandboxed execution.
  //
  //    Risk-tiered policy:
  //      - low risk      → unsandboxed (explicit escape hatch; env still
  //                        sanitized, result reports sandboxed:false)
  //      - medium+ risk  → sandboxed (filesystem confined, network denied on
  //                        macOS/Linux; Windows now enforces both via the
  //                        AppContainer principal)
  //      - high/critical → sandboxed + deny all network (on Windows this is
  //                        the AppContainer's zero-capability default)
  const useSandbox = effectiveRisk !== 'low';
  const denyNetwork = effectiveRisk === 'high' || effectiveRisk === 'critical';
  const networkAllowlist = denyNetwork ? [] : undefined;

  // Build the directory allowlist for the sandbox profile. Missing/removed
  // directories are a policy error inside the sandbox (fail closed); the
  // command simply does not run.
  let directoryAllowlist = null;
  try {
    const { PermissionStore } = require('../../lib/permission-store');
    const store = new PermissionStore();
    await store.load();
    directoryAllowlist = store.getAllowedDirectories();
  } catch (e) {
    // Fall through with null allowlist (sandbox grants workspace + system only).
  }

  const { resolveExecutionMode } = require('../../core/sandbox-executor');
  const sandboxOptions = {
    useSandbox,
    timeout: 30000,
    directoryAllowlist,
    networkAllowlist,
  };

  // Direct execution (spawn binary + verbatim args) is preferred. Commands
  // containing shell syntax (pipes, redirects, globs, builtins, env prefixes)
  // go through explicit shell mode — never via string-reconstructed sh -c.
  const mode = resolveExecutionMode(command);

  let raw;
  if (mode.mode === 'invalid') {
    return { success: false, error: 'Invalid command: empty command' };
  }
  if (mode.mode === 'shell') {
    raw = await executeShellScript(command, sandboxOptions);
  } else {
    raw = await executeSandboxed(mode.tokens[0], mode.tokens.slice(1), sandboxOptions);
  }

  // Normalize the sandbox result → frontend { success, output, error }.
  // Fail-closed results carry { success:false, code, error, sandboxed:false }.
  const success = raw.success === true;
  const stdoutText = raw.stdout ? String(raw.stdout).trim() : '';
  const stderrText = raw.stderr ? String(raw.stderr).trim() : '';
  const combinedOutput = [stdoutText, !success && stderrText ? stderrText : ''].filter(Boolean).join('\n');
  return {
    success,
    output: combinedOutput || (success ? '(no output)' : undefined),
    error: raw.error
      || (!success && stderrText ? stderrText : undefined)
      || (success ? undefined : `Command exited with code ${raw.code ?? 'unknown'}`),
    code: raw.code,
    sandboxed: raw.sandboxed === true,
    sandboxPlatform: raw.sandboxPlatform,
  };
};

exports.deriveKey = async function(passphrase, salt) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(passphrase, salt, 100000, 32, 'sha512', (err, derivedKey) => {
      if (err) reject(err);
      resolve(derivedKey);
    });
  });
};

exports.validateCommand = function(script) {
  const { validateCommand: securityValidate } = require('../../lib/SecurityValidator');
  const result = securityValidate(script);
  if (!result.valid) {
    throw new Error(result.errors.join('; '));
  }
};

exports.getProviderModels = async function(providerId, options) {
  return [];
};

exports.testGeminiApi = async function(apiKey) {
  return { success: true };
};

// ============================================================================
// NATIVE UI HELPERS
// ============================================================================

exports.deliverNativeMacUiEvent = async function(channel, payload = {}, mainWindow) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
    return { success: true };
  }
  return { success: false, error: 'No active window' };
};

exports.createNativeMacUiSnapshot = function(store) {
  const Store = require('electron-store');
  const s = store || new Store();
  return {
    theme: s.get('theme') || 'system',
    llmProvider: s.get('ai_provider') || 'google',
    model: s.get('gemini_model') || 'gemini-2.0-flash',
    timestamp: Date.now()
  };
};

exports.normalizeMacNativePanelMode = function(mode = 'sidebar') {
  const allowed = ['sidebar', 'mini', 'glass', 'panel', 'settings'];
  return allowed.includes(mode.toLowerCase()) ? mode.toLowerCase() : 'sidebar';
};

// ============================================================================
// SYNC & APPROVAL HELPERS
// ============================================================================

exports.generateShellApprovalQR = async function(command, explicitToken, explicitPin) {
  const QRCode = require('qrcode');
  const os = require('os');
  const deviceId = os.hostname();
  const { randomBytes } = require('crypto');
  const token = explicitToken || randomBytes(5).toString('hex');
  const pin = explicitPin || String(100000 + (randomBytes(4).readUInt32BE(0) % 900000));
  const deepLinkUrl = `aartiq://approve?id=${token}&deviceId=${encodeURIComponent(deviceId)}&pin=${pin}&command=${encodeURIComponent(command)}`;
  
  const qrImage = await QRCode.toDataURL(deepLinkUrl);
  return { qrImage, pin, token };
};
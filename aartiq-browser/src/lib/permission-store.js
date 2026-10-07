const path = require('path');
const fs = require('fs');
const os = require('os');
const { app } = require('electron');
const {
  normalizeCommandPattern,
  alwaysApprovalEligibility,
  isAutoApproveEligibleTier,
  ALWAYS_GRANT_TTL_MS,
} = require('./shell-command-tiers');

const {
  DEFAULT_ALLOWED_DIRECTORIES,
  isSensitivePath,
  canonicalizePath,
} = require('../core/directory-allowlist');

const PERM_LEVELS = ['read', 'interact', 'write', 'execute', 'send'];

/**
 * System roots addAllowedDirectory must not grant (mismatch-inventory M12).
 *
 * The filesystem root and the directories the operating system itself lives
 * in. A recursive grant over any of these is the whole machine, not a
 * directory, so it is refused at the door and the refusal is written to the
 * audit trail.
 *
 * The rule is exact match, not a prefix ban: `/etc/aartiq` is not `/etc`.
 * That boundary is deliberate and pinned by
 * tests/permission-store-system-root.test.js — widening it to a prefix ban is
 * a one-line change to `isSystemRoot` plus the boundary test in that file,
 * and is the maintainer's call.
 *
 * Seeded defaults never pass through this function (they are written into
 * settings directly), so `/tmp` and the read-only /Applications entries are
 * unaffected.
 */
const SYSTEM_ROOTS = new Set([
  '/', '/bin', '/boot', '/dev', '/etc', '/lib', '/lib32', '/lib64', '/libx32',
  '/proc', '/run', '/sbin', '/sys', '/usr', '/var',
  '/library', '/system',
]);

const WINDOWS_SYSTEM_ROOTS = new Set([
  'c:\\windows', 'c:\\program files', 'c:\\program files (x86)',
]);

/** @param {string} resolved path.resolve() output already. */
function isSystemRoot(resolved) {
  const noTrailing = resolved.replace(/[\\/]+$/, '');
  if (noTrailing === '') return true; // '/', '//', 'C:\' with nothing after
  const lower = noTrailing.toLowerCase();
  if (SYSTEM_ROOTS.has(lower)) return true;
  if (/^[a-z]:$/.test(lower)) return true; // bare drive root: 'C:'
  if (WINDOWS_SYSTEM_ROOTS.has(lower)) return true;
  return false;
}

class PermissionStore {
  constructor() {
    this.permissions = new Map();
    this.auditLog = [];
    this.storePath = null;
    this.loaded = false;
    this.settings = {
      // Shell auto-approval is opt-in and off.
      //
      // `autoApproveLowRiskShell` is the only setting that can let a shell
      // command run without the approval dialog, and only for the `low` tier.
      // `autoApproveLowRisk` is kept as an alias because stored settings files
      // and other callers still set it; `canAutoExecute` honours either.
      autoApproveLowRiskShell: false,
      autoApproveLowRisk: false,
      // Applies to MCP tool actions, not to shell commands. Kept so the action
      // path is unchanged; it deliberately no longer reaches `canAutoExecute`.
      autoApproveMidRisk: false,
      requireDeviceUnlockForManualApproval: true,
      requireDeviceUnlockForVaultAccess: true,
      requireBiometricPerSession: true,
      autoApprovedCommands: [],
      autoApprovedActions: [],
      // Parallel to autoApprovedCommands: same keys, plus the lifetime each
      // grant was given. Strings stay strings so every existing consumer —
      // IPC payloads, the settings panel, stored files — is unchanged.
      autoApprovedCommandGrants: {},
      allowedDirectories: [...DEFAULT_ALLOWED_DIRECTORIES],
    };
    this.autoApprovedCommands = new Set();
    this.autoApprovedActions = new Set();
  }

  async load() {
    if (this.loaded) return;
    const userDataPath = (app && typeof app.getPath === 'function')
      ? app.getPath('userData')
      : (this.storePath ? path.dirname(this.storePath) : os.tmpdir());
    if (!this.storePath) {
      this.storePath = path.join(userDataPath, 'comet-permissions.json');
      this.settingsPath = path.join(userDataPath, 'comet-security-settings.json');
      this.auditPath = path.join(userDataPath, 'aartiq-audit.jsonl');
    }

    // Migration: the audit trail was comet-audit.jsonl until the Comet → Aartiq
    // rename (mismatch-inventory M16). Rename on first load so an existing
    // trail keeps its history. If both names exist the new one wins and the
    // legacy file is left untouched — merging two audit trails would invent
    // order between entries nobody can re-verify.
    const legacyAuditPath = path.join(userDataPath, 'comet-audit.jsonl');
    if (!fs.existsSync(this.auditPath) && fs.existsSync(legacyAuditPath)) {
      try {
        fs.renameSync(legacyAuditPath, this.auditPath);
      } catch (e) {
        console.warn('[PermissionStore] Legacy comet-audit.jsonl not renamed:', e.message);
      }
    }

    try {
      if (fs.existsSync(this.storePath)) {
        const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf-8'));
        for (const [key, row] of Object.entries(raw)) {
          if (row.expires_at && Date.now() > row.expires_at) continue;
          this.permissions.set(key, row);
        }
      }
      if (fs.existsSync(this.settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8'));
        this.settings = { ...this.settings, ...settings };
        this._syncAutoApprovedCommands();
        this._migrateLegacyAutoApprovedCommands();
        this._reconcileAutoCommandGrants();
        this._syncAutoApprovedActions();
        this._checkBroadGrantsMigration();
      } else {
        this._checkBroadGrantsMigration();
      }
    } catch (e) {
      console.warn('[PermissionStore] Failed to load:', e.message);
    }
    this.loaded = true;
  }

  getSettings() {
    return { ...this.settings };
  }

  _syncAutoApprovedCommands() {
    this.autoApprovedCommands = new Set(
      Array.isArray(this.settings.autoApprovedCommands)
        ? this.settings.autoApprovedCommands.map(cmd => (cmd || '').toLowerCase())
        : []
    );
    this.settings.autoApprovedCommands = [...this.autoApprovedCommands];
  }

  /**
   * One-time migration of the first-word "Allow Always" entries.
   *
   * The old key format could not be translated faithfully: `curl` in the stored
   * set might have come from any of an unbounded number of `curl` invocations,
   * and the original command line was not kept. Reconstructing one would invent
   * history.
   *
   * So each legacy entry is judged on its own terms:
   *   - a binary that is still eligible for a persistent grant is kept. The new
   *     key is an exact match, so a kept entry now covers only the bare
   *     invocation — narrower than before, never wider.
   *   - a network-capable, script-capable or destructive binary is dropped, and
   *     the drop is written to the audit log. This is the entry that used to
   *     carry the most authority for the least visibility.
   *
   * Nothing is dropped silently: every removal produces an audit line, and the
   * behaviour change is recorded in the release note.
   */
  _migrateLegacyAutoApprovedCommands() {
    const legacy = [];
    const current = [];
    for (const entry of this.autoApprovedCommands) {
      const normalized = normalizeCommandPattern(entry);
      const isLegacyFirstWord = typeof entry === 'string' && !/\s/.test(String(entry).trim());
      if (!isLegacyFirstWord) {
        current.push(normalized);
        continue;
      }
      const verdict = alwaysApprovalEligibility(entry);
      if (verdict.eligible) {
        legacy.push(normalized);
      } else {
        this.logAudit(`settings.dropLegacyAutoApprovedCommand: ${normalized} (${verdict.reason})`);
        console.warn(
          `[PermissionStore] Dropped a stored "Always" grant for "${normalized}" — ${verdict.reason}. ` +
          'An Allow Always grant is no longer offered for this command; answer Allow Once, or ' +
          're-approve it if the exact command should be allowed to repeat.',
        );
      }
    }
    this.autoApprovedCommands = new Set([...current, ...legacy]);
    this.settings.autoApprovedCommands = [...this.autoApprovedCommands];
  }

  /** The grant-lifetime map; self-healing if a stored settings file lacks it. */
  _autoCommandGrants() {
    if (
      !this.settings.autoApprovedCommandGrants ||
      typeof this.settings.autoApprovedCommandGrants !== 'object'
    ) {
      this.settings.autoApprovedCommandGrants = {};
    }
    return this.settings.autoApprovedCommandGrants;
  }

  /** Copy of the grant lifetimes, for the IPC surface and the settings panel. */
  getAutoCommandGrantRecords() {
    return { ...this._autoCommandGrants() };
  }

  /**
   * Give every stored grant its clock, and sweep the ones whose clock ran out.
   *
   * Grants written before lifetimes existed (plain strings) get a full first
   * lifetime starting at this load — expiring them all at once would revoke
   * every user's approvals in a single release for a policy they never saw.
   * Records whose grant is gone, or whose expiry has passed, are removed with
   * an audit line; nothing is dropped silently.
   */
  _reconcileAutoCommandGrants() {
    const grants = this._autoCommandGrants();
    const now = Date.now();
    let changed = false;

    for (const key of this.autoApprovedCommands) {
      const record = grants[key];
      if (
        !record ||
        typeof record.granted_at !== 'number' ||
        typeof record.expires_at !== 'number'
      ) {
        grants[key] = { granted_at: now, expires_at: now + ALWAYS_GRANT_TTL_MS };
        this.logAudit(
          `settings.autoApprovedCommandGrantBackfilled: ${key} (expires ${new Date(now + ALWAYS_GRANT_TTL_MS).toISOString()})`,
        );
        changed = true;
      }
    }

    for (const [key, record] of Object.entries(grants)) {
      if (!this.autoApprovedCommands.has(key)) {
        delete grants[key];
        changed = true;
      } else if (now > record.expires_at) {
        delete grants[key];
        this.autoApprovedCommands.delete(key);
        this.logAudit(
          `settings.expireAutoApprovedCommand: ${key} (expired ${new Date(record.expires_at).toISOString()})`,
        );
        console.warn(
          `[PermissionStore] "Allow Always" grant expired for "${key}" — the approval dialog will ask again.`,
        );
        changed = true;
      }
    }

    if (changed) {
      this.settings.autoApprovedCommands = [...this.autoApprovedCommands];
      this._saveSettings();
    }
  }

  /**
   * True when the key's grant has run out. The sweep in load() normally gets
   * there first; this covers a grant that expires while the process is
   * running, and a settings file edited under us. A granted key with no
   * record (a hand-edited file) gets a fresh first lifetime rather than
   * silently losing an approval that is still there in plain sight.
   */
  _autoCommandGrantExpired(key) {
    const grants = this._autoCommandGrants();
    const record = grants[key];
    const now = Date.now();
    if (!record || typeof record.expires_at !== 'number') {
      grants[key] = { granted_at: now, expires_at: now + ALWAYS_GRANT_TTL_MS };
      this.settings.autoApprovedCommands = [...this.autoApprovedCommands];
      this._saveSettings();
      return false;
    }
    if (now <= record.expires_at) return false;
    delete grants[key];
    this.autoApprovedCommands.delete(key);
    this.settings.autoApprovedCommands = [...this.autoApprovedCommands];
    this.logAudit(
      `settings.expireAutoApprovedCommand: ${key} (expired ${new Date(record.expires_at).toISOString()})`,
    );
    console.warn(
      `[PermissionStore] "Allow Always" grant expired for "${key}" — the approval dialog will ask again.`,
    );
    this._saveSettings();
    return true;
  }

  _syncAutoApprovedActions() {
    this.autoApprovedActions = new Set(
      Array.isArray(this.settings.autoApprovedActions)
        ? this.settings.autoApprovedActions.map(action => this._normalizeActionType(action))
        : []
    );
    this.settings.autoApprovedActions = [...this.autoApprovedActions];
  }

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    this._syncAutoApprovedCommands();
    this._syncAutoApprovedActions();
    this._saveSettings();
  }

  _saveSettings() {
    if (!this.settingsPath) return;
    try {
      fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2));
    } catch (e) {
      console.error('[PermissionStore] Failed to save settings:', e.message);
    }
  }

  setAutoCommand(command, enabled) {
    const key = this._normalizeCommand(command);
    if (!key) return;
    const grants = this._autoCommandGrants();
    if (enabled) {
      this.autoApprovedCommands.add(key);
      // A grant is not permanent: it carries the clock that will bring the
      // user back to the dialog. See ALWAYS_GRANT_TTL_MS in shell-command-tiers.
      grants[key] = {
        granted_at: Date.now(),
        expires_at: Date.now() + ALWAYS_GRANT_TTL_MS,
      };
    } else {
      this.autoApprovedCommands.delete(key);
      delete grants[key];
    }
    this.settings.autoApprovedCommands = [...this.autoApprovedCommands];
    this._saveSettings();
  }

  getAutoApprovedCommands() {
    return [...this.autoApprovedCommands];
  }

  setAutoAction(actionType, enabled) {
    const key = this._normalizeActionType(actionType);
    if (!key) return;
    if (enabled) {
      this.autoApprovedActions.add(key);
    } else {
      this.autoApprovedActions.delete(key);
    }
    this.settings.autoApprovedActions = [...this.autoApprovedActions];
    this._saveSettings();
  }

  getAutoApprovedActions() {
    return [...this.autoApprovedActions];
  }

  // --- Directory Allowlist CRUD ---

  getAllowedDirectories() {
    const dirs = Array.isArray(this.settings.allowedDirectories)
      ? this.settings.allowedDirectories
      : [...DEFAULT_ALLOWED_DIRECTORIES];

    const result = [];
    const seen = new Set();
    for (const d of dirs) {
      let entry = typeof d === 'string'
        ? { path: d, recursive: true, access: 'read-write', grantedAt: 0, grantedVia: 'migrated' }
        : { ...d };

      // Expand a leading ~ to the user's home directory (covers entries added
      // or migrated without tilde expansion) and resolve to an absolute path.
      if (typeof entry.path === 'string') {
        entry.path = entry.path.replace(/^~(?=\/|\\\\|$)/, os.homedir());
        entry.path = path.resolve(entry.path);
      }

      // Drop stale / non-existent entries instead of letting them fail closed at
      // sandbox-profile time (which would block ALL commands). Interactive
      // permission for any *new* path a command needs is requested separately
      // via the directory-permission bridge in execShellCommand.
      if (!entry.path || !fs.existsSync(entry.path) || !fs.statSync(entry.path).isDirectory()) {
        console.warn('[PermissionStore] Skipping non-existent allowlist entry:', entry.path);
        continue;
      }

      const key = entry.path;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(entry);
    }
    return result;
  }

  addAllowedDirectory(dirPath, options = {}) {
    if (!dirPath || typeof dirPath !== 'string') return false;
    const resolved = path.resolve(dirPath);
    if (isSystemRoot(resolved)) {
      this.logAudit(`directory-allowlist.add.rejected system-root: ${resolved}`);
      return false;
    }
    if (isSensitivePath(resolved)) {
      this.logAudit(`directory-allowlist.add.rejected sensitive-path: ${resolved}`);
      return false;
    }
    if (!Array.isArray(this.settings.allowedDirectories)) {
      this.settings.allowedDirectories = [...DEFAULT_ALLOWED_DIRECTORIES];
    }

    // Normalize existing entries to objects
    this.settings.allowedDirectories = this.settings.allowedDirectories.map(d =>
      typeof d === 'string'
        ? { path: d, recursive: true, access: 'read-write', grantedAt: 0, grantedVia: 'migrated' }
        : d
    );

    if (this.settings.allowedDirectories.some(d => path.resolve(d.path) === resolved)) {
      return false;
    }

    this.settings.allowedDirectories.push({
      path: resolved,
      recursive: options.recursive !== false,
      access: options.access === 'read-write' ? 'read-write' : 'read',
      grantedAt: Date.now(),
      grantedVia: options.grantedVia || 'settings',
    });
    this._saveSettings();
    this.logAudit(`directory-allowlist.add: ${resolved} (${options.access === 'read-write' ? 'read-write' : 'read'}, recursive=${options.recursive !== false})`);
    return true;
  }

  _checkBroadGrantsMigration() {
    if (this.settings.hasSeenBroadGrantWarning) return;

    const broadTargets = [
      os.homedir(),
      path.join(os.homedir(), 'Desktop'),
      path.join(os.homedir(), 'Documents'),
      path.join(os.homedir(), 'Downloads'),
    ].map(p => path.resolve(p));

    const currentDirs = Array.isArray(this.settings.allowedDirectories)
      ? this.settings.allowedDirectories
      : [];

    const foundBroad = [];
    for (const d of currentDirs) {
      const p = typeof d === 'string' ? d : d?.path;
      if (!p) continue;
      const resolved = path.resolve(p.replace(/^~(?=\/|\\|$)/, os.homedir()));
      if (broadTargets.includes(resolved)) {
        foundBroad.push(resolved);
      }
    }

    if (foundBroad.length > 0) {
      this.broadGrantWarning = {
        warning: 'Broad directory grants detected. For improved security, consider narrowing access to a dedicated workspace folder.',
        broadGrants: foundBroad,
        suggestedAction: 'narrow',
      };
      this.logAudit(`directory-allowlist.broad-grants-warning: ${foundBroad.join(', ')}`);
    }
  }

  getBroadGrantWarning() {
    return this.broadGrantWarning || null;
  }

  narrowBroadGrants() {
    const broadTargets = new Set([
      os.homedir(),
      path.join(os.homedir(), 'Desktop'),
      path.join(os.homedir(), 'Documents'),
      path.join(os.homedir(), 'Downloads'),
    ].map(p => path.resolve(p)));

    const currentDirs = Array.isArray(this.settings.allowedDirectories)
      ? this.settings.allowedDirectories
      : [];

    const kept = currentDirs.filter(d => {
      const p = typeof d === 'string' ? d : d?.path;
      if (!p) return false;
      const resolved = path.resolve(p.replace(/^~(?=\/|\\|$)/, os.homedir()));
      return !broadTargets.has(resolved);
    });

    const defaultWorkspace = DEFAULT_ALLOWED_DIRECTORIES[0].path;
    if (!kept.some(d => path.resolve(typeof d === 'string' ? d : d.path) === defaultWorkspace)) {
      kept.unshift(DEFAULT_ALLOWED_DIRECTORIES[0]);
    }

    this.settings.allowedDirectories = kept;
    this.settings.hasSeenBroadGrantWarning = true;
    this.broadGrantWarning = null;
    this._saveSettings();
    this.logAudit('directory-allowlist.narrowed-broad-grants');
    return true;
  }

  dismissBroadGrantWarning() {
    this.settings.hasSeenBroadGrantWarning = true;
    this.broadGrantWarning = null;
    this._saveSettings();
  }

  updateAllowedDirectory(dirPath, updates) {
    if (!dirPath || typeof dirPath !== 'string') return false;
    const resolved = path.resolve(dirPath);
    if (!Array.isArray(this.settings.allowedDirectories)) return false;

    this.settings.allowedDirectories = this.settings.allowedDirectories.map(d => {
      const entry = typeof d === 'string'
        ? { path: d, recursive: true, access: 'read-write', grantedAt: 0, grantedVia: 'migrated' }
        : d;
      if (path.resolve(entry.path) === resolved) {
        return { ...entry, ...updates, path: resolved };
      }
      return entry;
    });
    this._saveSettings();
    this.logAudit(`directory-allowlist.update: ${resolved} ${JSON.stringify(updates)}`);
    return true;
  }

  removeAllowedDirectory(dirPath) {
    if (!dirPath || typeof dirPath !== 'string') return false;
    const resolved = path.resolve(dirPath);
    if (!Array.isArray(this.settings.allowedDirectories)) return false;
    const before = this.settings.allowedDirectories.length;
    this.settings.allowedDirectories = this.settings.allowedDirectories.filter(d => {
      const entryPath = typeof d === 'string' ? d : d.path;
      return path.resolve(entryPath) !== resolved;
    });
    if (this.settings.allowedDirectories.length === before) return false;
    this._saveSettings();
    this.logAudit(`directory-allowlist.remove: ${resolved}`);
    return true;
  }

  isDirectoryAllowed(dirPath, operation = 'read') {
    if (!dirPath || typeof dirPath !== 'string') return false;
    const { isPathAllowed } = require('../core/directory-allowlist');
    const dirs = this.getAllowedDirectories();
    const result = isPathAllowed(dirPath, dirs, operation);
    return result.allowed;
  }

  isAutoExecutable(riskLevel) {
    if (riskLevel === 'low' && (this.settings.autoApproveLowRiskShell || this.settings.autoApproveLowRisk)) return true;
    if (riskLevel === 'medium' && this.settings.autoApproveMidRisk) return true;
    return false;
  }

  /**
   * Shell-command auto-approval, kept separate from isAutoExecutable().
   *
   * `low` is the only tier that can be auto-approved, and only behind
   * `autoApproveLowRiskShell` (default off). `medium` and `high` never are:
   * `medium` covers cp, mv, mkdir, npm, git, curl and osascript, and
   * auto-running those would hand over the authority the approval dialog exists
   * to check. `autoApproveMidRisk` still applies to MCP tool actions through
   * canAutoExecuteAction, which is a different question.
   */
  isShellAutoExecutable(riskLevel) {
    if (!isAutoApproveEligibleTier(riskLevel)) return false;
    return this.settings.autoApproveLowRiskShell === true || this.settings.autoApproveLowRisk === true;
  }

  canAutoExecute(command, riskLevel) {
    const key = this._normalizeCommand(command);
    if (this.autoApprovedCommands.has(key)) {
      if (this._autoCommandGrantExpired(key)) {
        // The grant outlived its lifetime: it is gone, and only the opt-in
        // low-tier fallback can still auto-approve this command.
        return this.isShellAutoExecutable(riskLevel);
      }
      return true;
    }
    return this.isShellAutoExecutable(riskLevel);
  }

  canAutoExecuteAction(actionType, riskLevel) {
    const normalizedRisk = this._normalizeRisk(riskLevel);
    if (normalizedRisk === 'high') return false;

    const key = this._normalizeActionType(actionType);
    if (this.autoApprovedActions.has(key)) return true;
    return this.isAutoExecutable(normalizedRisk);
  }

  /**
   * Key for the persisted "Allow Always" command set.
   *
   * Was `command.trim().split(/\s+/)[0].toLowerCase()` — the first word alone, so
   * one answer covered every later invocation of that binary. It is now the full
   * normalised command line, which means a grant matches one specific command.
   *
   * Legacy entries that hold a bare binary with no arguments are migrated by
   * `_migrateLegacyAutoApprovedCommands` on load: kept where the binary is still
   * eligible for a persistent grant, dropped with an audit entry where it is
   * not.
   */
  _normalizeCommand(command) {
    return normalizeCommandPattern(command);
  }

  _normalizeActionType(actionType) {
    if (!actionType) return '';
    return `${actionType}`.trim().toUpperCase();
  }

  _normalizeRisk(riskLevel) {
    const normalized = `${riskLevel || 'medium'}`.trim().toLowerCase();
    if (normalized === 'critical') return 'high';
    if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
      return normalized;
    }
    return 'medium';
  }

  _save() {
    if (!this.storePath) return;
    try {
      const obj = Object.fromEntries(this.permissions);
      fs.writeFileSync(this.storePath, JSON.stringify(obj, null, 2));
    } catch (e) {
      console.error('[PermissionStore] Failed to save:', e.message);
    }
  }

  grant(key, level, description, sessionOnly = true) {
    if (!PERM_LEVELS.includes(level)) {
      throw new Error(`Invalid permission level: ${level}`);
    }
    const expiresAt = sessionOnly ? Date.now() + (8 * 60 * 60 * 1000) : null;
    this.permissions.set(key, {
      key,
      level,
      granted_at: Date.now(),
      expires_at: expiresAt,
      description,
    });
    this._save();
    this.logAudit(`permission.grant: ${key} (${level}) — ${description}`);
  }

  revoke(key) {
    this.permissions.delete(key);
    this._save();
    this.logAudit(`permission.revoke: ${key}`);
  }

  revokeAll() {
    this.permissions.clear();
    this._save();
    this.logAudit('permission.revokeAll');
  }

  isGranted(key) {
    const row = this.permissions.get(key);
    if (!row) return false;
    if (row.expires_at && Date.now() > row.expires_at) {
      this.permissions.delete(key);
      this._save();
      return false;
    }
    return true;
  }

  getLevel(key) {
    const row = this.permissions.get(key);
    if (!row) return null;
    if (row.expires_at && Date.now() > row.expires_at) {
      this.permissions.delete(key);
      this._save();
      return null;
    }
    return row.level;
  }

  getAll() {
    const result = [];
    for (const [key, row] of this.permissions) {
      if (row.expires_at && Date.now() > row.expires_at) {
        this.permissions.delete(key);
        continue;
      }
      result.push({ ...row });
    }
    return result;
  }

  logAudit(entry) {
    const line = JSON.stringify({ entry, timestamp: Date.now(), date: new Date().toISOString() });
    console.log(`[Audit] ${entry}`);
    if (this.auditPath) {
      try {
        fs.appendFileSync(this.auditPath, line + '\n');
      } catch (e) {
        console.error('[Audit] Write failed:', e.message);
      }
    }
  }

  getAuditLog(limit = 100) {
    if (!this.auditPath || !fs.existsSync(this.auditPath)) return [];
    try {
      const lines = fs.readFileSync(this.auditPath, 'utf-8').trim().split('\n');
      return lines.slice(-limit).map(l => {
        try { return JSON.parse(l); } catch { return { entry: l }; }
      });
    } catch (e) {
      return [];
    }
  }
}

module.exports = { PermissionStore };

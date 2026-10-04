/**
 * directory-allowlist.js — User-controlled directory allowlist for AI file access.
 *
 * Replaces the single hardcoded sandbox-workspace with a dynamic, user-controlled
 * set of directories that the AI can access. Mirrors mobile OS file permission
 * patterns: scoped, explicit, revocable, and requested exactly when needed.
 *
 * Items addressed:
 *   §1 — Data model (allowlist entries with path, recursive, access, grantedAt, grantedVia)
 *   §2 — Path canonicalization via fs.realpath (symlink/traversal prevention)
 *   §8 — Read/write separation (enforced in isPathAllowed)
 *
 * Audit-doc line items: §7 (directory allowlist system).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Cross-platform dedicated workspace: app-owned sandbox-workspace folder
const DEFAULT_WORKSPACE_PATH = path.join(os.homedir(), '.aartiq', 'sandbox-workspace');

function _getDefaultDirectories() {
  // Windows has no POSIX /tmp; use the real temp directory so default
  // allowlist entries resolve to existing paths (fail-closed validation).
  const tmpDefault = process.platform === 'win32' ? os.tmpdir() : '/tmp';
  return [
    { path: DEFAULT_WORKSPACE_PATH, recursive: true, access: 'read-write', grantedAt: 0, grantedVia: 'default' },
    { path: tmpDefault, recursive: true, access: 'read-write', grantedAt: 0, grantedVia: 'default' },
  ];
}

const DEFAULT_ALLOWED_DIRECTORIES = _getDefaultDirectories();

// ---------------------------------------------------------------------------
// Sensitive Path Deny List (security-critical: credential and profile isolation)
// ---------------------------------------------------------------------------

const SENSITIVE_BASENAMES = new Set([
  '.bash_history',
  '.zsh_history',
  '.history',
  '.sh_history',
  '.zhistory',
  '.node_repl_history',
  '.python_history',
  '.netrc',
  '.git-credentials',
  '.npmrc',
  '.pypirc',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'id_dsa',
  'id_xmss',
  'known_hosts',
  'authorized_keys',
]);

function getSensitiveDirectories() {
  const home = os.homedir();
  const dirs = [
    path.join(home, '.ssh'),
    path.join(home, '.gnupg'),
    path.join(home, '.gpg'),
    path.join(home, '.aws'),
    path.join(home, '.config', 'gcloud'),
    path.join(home, '.gcloud'),
    path.join(home, '.azure'),
    path.join(home, '.kube'),
    path.join(home, '.config', '1Password'),
    path.join(home, '.config', 'Bitwarden'),
    path.join(home, '.password-store'),
  ];

  if (process.platform === 'darwin') {
    dirs.push(
      path.join(home, 'Library', 'Keychains'),
      '/Library/Keychains',
      path.join(home, 'Library', 'Safari'),
      path.join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
      path.join(home, 'Library', 'Application Support', 'Firefox'),
      path.join(home, 'Library', 'Application Support', 'Microsoft Edge'),
      path.join(home, 'Library', 'Application Support', 'BraveSoftware'),
      path.join(home, 'Library', 'Application Support', '1Password'),
      path.join(home, 'Library', 'Application Support', 'Bitwarden'),
    );
  } else if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    dirs.push(
      path.join(localAppData, 'Microsoft', 'Credentials'),
      path.join(localAppData, 'Google', 'Chrome'),
      path.join(appData, 'Google', 'Chrome'),
      path.join(appData, 'Mozilla', 'Firefox'),
      path.join(localAppData, 'Microsoft', 'Edge'),
      path.join(localAppData, 'BraveSoftware'),
      path.join(appData, '1Password'),
      path.join(appData, 'Bitwarden'),
    );
  } else {
    dirs.push(
      path.join(home, '.config', 'google-chrome'),
      path.join(home, '.mozilla', 'firefox'),
      path.join(home, '.config', 'microsoft-edge'),
      path.join(home, '.config', 'BraveSoftware'),
    );
  }

  return dirs.map(d => path.normalize(d));
}

/**
 * Check if a path points to a sensitive credential or browser profile location.
 * Uses realpath resolution to prevent symlink bypass.
 *
 * @param {string} targetPath - Path to inspect
 * @returns {boolean}
 */
function isSensitivePath(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') return false;

  const { canonical } = canonicalizePath(targetPath);
  const pathToTest = canonical || path.resolve(targetPath.replace(/^~(?=\/|\\|$)/, os.homedir()));
  const normalized = path.normalize(pathToTest);
  const base = path.basename(normalized);

  // 1. .env files
  if (base === '.env' || base.startsWith('.env.')) {
    return true;
  }

  // 2. Sensitive filenames / credentials / keychains
  if (SENSITIVE_BASENAMES.has(base) || base.endsWith('.kdbx') || base.endsWith('.keychain') || base.endsWith('.keychain-db')) {
    return true;
  }

  // 3. Sensitive directories and subpaths
  const sensitiveDirs = getSensitiveDirectories();
  for (const sDir of sensitiveDirs) {
    if (normalized === sDir || normalized.startsWith(sDir + path.sep)) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Path Canonicalization (§2 — security-critical)
// ---------------------------------------------------------------------------

/**
 * Canonicalize a path: resolve symlinks, normalize .. and . segments.
 *
 * Uses fs.realpathSync (which follows symlinks) and path.resolve for normalization.
 * If the path doesn't exist yet (e.g. for a file-to-be-created), we fall back to
 * path.resolve + path.normalize without symlink resolution, and check the parent.
 *
 * @param {string} requestedPath — the path to canonicalize
 * @returns {{ canonical: string, resolved: boolean }} — canonical path and whether
 *   the full path was realpath-resolved (false means only parent was resolved)
 */
function canonicalizePath(requestedPath) {
  if (!requestedPath || typeof requestedPath !== 'string') {
    return { canonical: '', resolved: false };
  }

  // Expand ~ to home directory
  const expanded = requestedPath.replace(/^~(?=\/|$)/, os.homedir());
  const absPath = path.resolve(expanded);

  try {
    // Full realpath resolution (follows symlinks)
    const real = fs.realpathSync(absPath);
    return { canonical: real, resolved: true };
  } catch (e) {
    // Path doesn't exist yet — resolve via parent directory
    try {
      const parent = path.dirname(absPath);
      const realParent = fs.realpathSync(parent);
      const basename = path.basename(absPath);
      return { canonical: path.join(realParent, basename), resolved: false };
    } catch (e2) {
      // Parent doesn't exist either — fall back to normalized absolute path
      return { canonical: path.normalize(absPath), resolved: false };
    }
  }
}

/**
 * Check if a requested path falls within an allowlisted directory.
 *
 * @param {string} requestedPath — the path to check
 * @param {Array} allowlist — array of allowlist entries (from PermissionStore)
 * @param {string} operation — 'read' or 'write'
 * @returns {{ allowed: boolean, reason: string, matchedEntry: object|null }}
 */
function isPathAllowed(requestedPath, allowlist, operation = 'read') {
  if (!requestedPath || typeof requestedPath !== 'string') {
    return { allowed: false, reason: 'Invalid path', matchedEntry: null };
  }

  if (!Array.isArray(allowlist) || allowlist.length === 0) {
    return { allowed: false, reason: 'No directories in allowlist', matchedEntry: null };
  }

  if (operation !== 'read' && operation !== 'write') {
    return { allowed: false, reason: `Invalid operation: ${operation}`, matchedEntry: null };
  }

  const { canonical } = canonicalizePath(requestedPath);
  if (!canonical) {
    return { allowed: false, reason: 'Failed to resolve path', matchedEntry: null };
  }

  // Sensitive paths are ALWAYS denied, even if allowed by user or parent dir
  if (isSensitivePath(requestedPath) || isSensitivePath(canonical)) {
    return {
      allowed: false,
      reason: `Access denied: path "${requestedPath}" is in a sensitive security/credential location.`,
      matchedEntry: null,
      isSensitive: true,
    };
  }

  for (const entry of allowlist) {
    if (!entry || !entry.path) continue;

    const { canonical: entryCanonical } = canonicalizePath(entry.path);
    if (!entryCanonical) continue;

    const isRecursive = entry.recursive !== false; // default true
    const isMatch = isRecursive
      ? canonical.startsWith(entryCanonical + path.sep) || canonical === entryCanonical
      : path.dirname(canonical) === entryCanonical;

    if (isMatch) {
      // Check access level (§8 — read/write separation)
      if (operation === 'write' && entry.access !== 'read-write') {
        return {
          allowed: false,
          reason: `Directory "${entry.path}" is read-only. Grant read-write access in Settings.`,
          matchedEntry: entry,
        };
      }
      return { allowed: true, reason: '', matchedEntry: entry };
    }
  }

  return {
    allowed: false,
    reason: `Path "${requestedPath}" is outside all allowed directories.`,
    matchedEntry: null,
  };
}

/**
 * Get the list of canonical paths from the allowlist for sandbox profile generation.
 *
 * @param {Array} allowlist — array of allowlist entries
 * @returns {{ readDirs: string[], writeDirs: string[] }}
 */
function getSandboxDirs(allowlist) {
  const readDirs = new Set();
  const writeDirs = new Set();

  if (!Array.isArray(allowlist)) return { readDirs: [...readDirs], writeDirs: [...writeDirs] };

  for (const entry of allowlist) {
    if (!entry || !entry.path) continue;
    const { canonical } = canonicalizePath(entry.path);
    if (!canonical) continue;
    if (isSensitivePath(canonical)) continue; // Never allow sensitive paths in sandbox

    if (entry.access === 'read-write') {
      writeDirs.add(canonical);
      readDirs.add(canonical);
    } else {
      readDirs.add(canonical);
    }

    // Also include the platform temp dir for write (Windows has no /tmp).
    const tmpPath = process.platform === 'win32' ? os.tmpdir() : '/tmp';
    const { canonical: tmpCanonical } = canonicalizePath(tmpPath);
    if (tmpCanonical) {
      writeDirs.add(tmpCanonical);
      readDirs.add(tmpCanonical);
    }
  }

  return { readDirs: [...readDirs], writeDirs: [...writeDirs] };
}

module.exports = {
  DEFAULT_WORKSPACE_PATH,
  DEFAULT_ALLOWED_DIRECTORIES,
  canonicalizePath,
  isPathAllowed,
  getSandboxDirs,
  isSensitivePath,
  getSensitiveDirectories,
};

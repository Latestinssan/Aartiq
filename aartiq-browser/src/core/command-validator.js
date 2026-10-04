const { exec, spawn } = require('child_process');
const { validateCommand: securityValidate, getShellRisk } = require('../lib/SecurityValidator');
const { normalizeCommandPattern, alwaysApprovalEligibility } = require('../lib/shell-command-tiers');

// PermissionStore is injected at init time via setPermissionStore().
// This replaces the old electron-store-based approach which was not wired
// into the same PermissionStore used by the rest of the application.
let permissionStore = null;

function setPermissionStore(store) {
  permissionStore = store;
}

function validateCommand(cmd) {
  if (!cmd || typeof cmd !== 'string') {
    throw new Error('Invalid command: command must be a non-empty string');
  }
  const trimmed = cmd.trim();
  if (trimmed.length === 0) {
    throw new Error('Invalid command: empty command');
  }
  if (trimmed.length > 10000) {
    throw new Error('Command too long (max 10000 characters)');
  }
  // Delegate dangerous-pattern and blocked-command checks to SecurityValidator.
  const result = securityValidate(trimmed);
  if (!result.valid) {
    throw new Error(result.errors.join('; '));
  }
  return trimmed;
}

function analyzeCommandRisk(cmd) {
  // Delegate to the single-source-of-truth risk classifier.
  return getShellRisk(cmd);
}

function explainCommand(cmd) {
  const cmds = {
    'ls': 'List directory contents',
    'll': 'List detailed directory contents',
    'cd': 'Change directory',
    'pwd': 'Print working directory',
    'cat': 'Display file contents',
    'mkdir': 'Create a new directory',
    'touch': 'Create an empty file',
    'rm': 'Remove a file',
    'cp': 'Copy files or directories',
    'mv': 'Move or rename files',
    'curl': 'Fetch data from URL',
    'wget': 'Download files from URL',
    'git': 'Git version control',
    'npm': 'Node package manager',
    'npx': 'Execute npm packages',
    'node': 'Run Node.js scripts',
    'python': 'Run Python scripts',
    'open': 'Open files or applications',
  };
  const firstWord = cmd.split(/\s+/)[0].toLowerCase();
  return cmds[firstWord] || `Execute command: ${firstWord}`;
}

/**
 * Check whether a shell command is permitted.
 *
 * Resolves the tiering documented in the Security Model:
 *   - critical risk  → always denied (must go through biometric approval)
 *   - high risk      → denied unless the command (or 'shell_high') is granted
 *   - medium risk    → denied unless the command (or 'shell_medium'/'shell_all') is granted
 *   - low risk       → denied unless the command (or 'shell_low'/'shell_medium'/'shell_all') is granted
 *
 * Returns true only when an explicit grant exists in the PermissionStore.
 * When no PermissionStore is configured the function returns false (safe default).
 *
 * Audit-doc line item: section 3d (command-validator.js) — replaced no-op
 * `return true` with real permission-store check.
 */
function checkShellPermission(command, reason, riskLevel = 'medium') {
  if (!permissionStore) {
    console.warn('[CommandValidator] No PermissionStore configured — denying shell command');
    return false;
  }

  const normalizedRisk = String(riskLevel || 'medium').toLowerCase();

  // Critical-risk commands are never auto-approved through this gate;
  // they must go through the biometric / high-risk QR approval flow.
  if (normalizedRisk === 'critical') {
    return false;
  }

  // Command-specific grant.
  //
  // Keyed on the full normalised command line, not the first word. The previous
  // key was `SHELL_CMD:<firstWord>`, so answering "Always" to one `curl` covered
  // every later `curl` regardless of where it pointed — see
  // docs-audit/issues/allow-always-granularity.md for the residual gap.
  const cmdKey = buildShellCommandKey(command);
  if (cmdKey && permissionStore.isGranted(cmdKey)) {
    // Verify the grant's level is sufficient for the risk level
    const level = permissionStore.getLevel(cmdKey);
    if (isLevelSufficient(level, normalizedRisk)) {
      return true;
    }
  }

  // Check category-level grants (shell_high, shell_medium, shell_low, shell_all)
  const riskToPermKey = {
    high: 'SHELL_HIGH',
    medium: 'SHELL_MEDIUM',
    low: 'SHELL_LOW',
  };
  const requiredKey = riskToPermKey[normalizedRisk] || 'SHELL_MEDIUM';

  // For a given risk level, any higher-level grant is also sufficient
  const sufficientKeys = [];
  if (normalizedRisk === 'low') {
    sufficientKeys.push('SHELL_LOW', 'SHELL_MEDIUM', 'SHELL_HIGH', 'SHELL_ALL');
  } else if (normalizedRisk === 'medium') {
    sufficientKeys.push('SHELL_MEDIUM', 'SHELL_HIGH', 'SHELL_ALL');
  } else if (normalizedRisk === 'high') {
    sufficientKeys.push('SHELL_HIGH', 'SHELL_ALL');
  }

  for (const key of sufficientKeys) {
    if (permissionStore.isGranted(key)) {
      return true;
    }
  }

  // Also check the auto-approval settings (respects user's auto-approve policy)
  if (permissionStore.canAutoExecute && permissionStore.canAutoExecute(command, normalizedRisk)) {
    return true;
  }

  return false;
}

/**
 * The PermissionStore key for a per-command "Allow Always" grant.
 *
 * Exported so the approval dialog and the grant-recording path build the same
 * key this function looks up. Two builders that disagree is exactly how an
 * "Always" answer silently stops working.
 */
function buildShellCommandKey(command) {
  const pattern = normalizeCommandPattern(command);
  return pattern ? `SHELL_CMD:${pattern}` : '';
}

/**
 * Whether "Allow Always" should be offered for a command.
 *
 * False for network-capable and script-capable binaries and for anything with a
 * URL in its arguments. The user still gets Allow Once or Deny.
 */
function isAlwaysApprovalAllowed(command) {
  return alwaysApprovalEligibility(command).eligible;
}

/**
 * Map a PermissionStore level string to a numeric score so we can compare
 * whether a grant is sufficient for the requested risk level.
 */
function isLevelSufficient(level, riskLevel) {
  const levelScores = { read: 1, interact: 2, write: 3, execute: 4, send: 5 };
  const riskMinScores = { low: 1, medium: 2, high: 3 };
  const score = levelScores[level] || 0;
  const min = riskMinScores[riskLevel] || 2;
  return score >= min;
}

module.exports = {
  validateCommand,
  analyzeCommandRisk,
  explainCommand,
  checkShellPermission,
  buildShellCommandKey,
  isAlwaysApprovalAllowed,
  setPermissionStore,
};
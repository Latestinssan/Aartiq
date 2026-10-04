// ============================================================================
// SecurityValidator.js — Single source of truth for shell command validation
// ============================================================================
//
// IMPORTANT: This file provides a fast first-pass regex-based reject layer.
// It is NOT the primary security defense. Text-based filters are bypassable
// by construction (e.g., encoded payloads, argument injection, TOCTOU races).
//
// Primary enforcement happens at:
//   1. Permission store (checkShellPermission in command-validator.js) — risk-tiered
//   2. Capability controller (capability-controller.js) — ticket-based approval
//   3. OS-level sandboxing (sandbox-executor.js) — filesystem/network confinement
//
// This regex layer catches obvious dangerous patterns early (cheap, fast) but
// must not be treated as sufficient on its own. See the NVIDIA AI Red Team
// guidance and agentsh syscall-policy approach for industry context.
// ============================================================================

const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Per-command risk table, destructive-pattern floor, blocked-command set and
// the "Allow Always" eligibility rule. Owned by shell-command-tiers.js so the
// runtime classifier and the docs generator read one file; this module
// re-exports what it used to declare so existing importers are unaffected.
const {
  BLOCKED_COMMANDS,
  DESTRUCTIVE_COMMAND_PATTERNS,
  SHELL_COMMAND_TIERS,
  classifyShellCommand,
  normalizeCommandPattern,
  alwaysApprovalEligibility,
  isAutoApproveEligibleTier,
  extractBaseBinary,
} = require('./shell-command-tiers');

// Patterns that indicate genuinely dangerous/destructive commands.
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//i,           // rm -rf /
  /rm\s+-rf\s+~\//i,          // rm -rf ~/
  /:\s*\|/i,                  // fork bomb
  /\$\(/i,                    // command substitution $(...)
  /\\x[0-9a-f]{2}/i,         // hex-encoded chars
  /;\s*rm\s/i,                // ; rm ...
  /mkfs/i,                    // format filesystem
  /dd\s+if=/i,                // dd write
  /[>|]\/dev\/sd/i,           // write to device
  /chown\s+root/i,            // chown root
  /chmod\s+777/i,             // chmod 777
  /shutdown/i,
  /reboot/i,
  /halt\b/i,
  /poweroff/i,
  /init\s+[06]/i,             // init runlevels 0,6 = halt/reboot
  /iptables|ufw|firewall/i,   // firewall changes
];

// Rejected before any tier is consulted. Declared in shell-command-tiers.js.
const HIGH_RISK_FILE_COMMANDS = new Set([
  'rm', 'del', 'format', 'fdisk', 'dd', 'mkfs',
  'chmod', 'chown',
  'shutdown', 'reboot', 'halt', 'poweroff',
  'iptables', 'ufw', 'firewall-cmd',
  'mount', 'umount', 'eject',
]);

// Destructive-pattern floor: declared in shell-command-tiers.js and re-exported
// below. Any match raises a command to at least `high`.

const AUTO_EXEC_ALLOWED = new Set([
  'NAVIGATE', 'SHELL_COMMAND_LIGHT',
]);

const RISK_LEVELS = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};

// --- Core validation ---

function containsDangerousPattern(input) {
  if (!input || typeof input !== 'string') return false;
  return DANGEROUS_PATTERNS.some(pattern => pattern.test(input));
}

function containsDestructivePattern(input) {
  if (!input || typeof input !== 'string') return false;
  return DESTRUCTIVE_COMMAND_PATTERNS.some(pattern => pattern.test(input));
}

function validateCommand(command) {
  const errors = [];
  const warnings = [];

  if (!command || typeof command !== 'string') {
    return { valid: false, errors: ['Command must be a non-empty string'], warnings: [] };
  }

  if (command.length > 10000) {
    errors.push('Command exceeds maximum length of 10000 characters');
  }

  if (containsDangerousPattern(command)) {
    errors.push('Command contains dangerous patterns');
  }

  const firstWord = command.trim().split(/\s+/)[0].toLowerCase();

  if (BLOCKED_COMMANDS.has(firstWord)) {
    errors.push(`Command "${firstWord}" is blocked for security reasons`);
  }

  if (HIGH_RISK_FILE_COMMANDS.has(firstWord)) {
    warnings.push(`Command "${firstWord}" is classified as HIGH RISK and requires explicit approval`);
  }

  if (command.includes('..')) {
    warnings.push('Command contains path traversal pattern (..)');
  }

  if (command.includes('$(') || command.includes('`')) {
    warnings.push('Command contains command substitution');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// --- Risk classification ---
//
// The per-command table lives in shell-command-tiers.js, which the docs
// generator also reads. This function is only the entry point.

function getShellRisk(command) {
  return classifyShellCommand(command).tier;
}

// --- Sanitization ---

function sanitizeShellCommand(command) {
  if (!command || typeof command !== 'string') return '';
  // Strip shell metacharacters that could cause injection.
  // Note: this intentionally breaks legitimate commands with pipes/redirects —
  // callers that need pipes should not sanitize.
  return command.replace(/[;&|`$<>\\]/g, '').trim();
}

// --- Other validators (unchanged) ---

function validateOcrCoordinates(x, y, screenBounds) {
  const errors = [];

  if (typeof x !== 'number' || typeof y !== 'number') {
    errors.push('Coordinates must be numbers');
    return { valid: false, errors };
  }

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    errors.push('Coordinates must be finite numbers');
  }

  if (x < 0 || y < 0) {
    errors.push('Coordinates cannot be negative');
  }

  if (screenBounds) {
    if (x > screenBounds.width || y > screenBounds.height) {
      errors.push('Coordinates are outside screen bounds');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function validateFilePath(filePath, allowedDirs = []) {
  const errors = [];

  if (!filePath || typeof filePath !== 'string') {
    errors.push('File path must be a non-empty string');
    return { valid: false, errors };
  }

  if (filePath.includes('..')) {
    errors.push('File path contains path traversal (../)');
  }

  if (filePath.includes('\0')) {
    errors.push('File path contains null byte');
  }

  const resolvedPath = path.resolve(filePath);

  if (allowedDirs.length > 0) {
    const isAllowed = allowedDirs.some(dir =>
      resolvedPath.startsWith(path.resolve(dir))
    );

    if (!isAllowed) {
      errors.push('File path is not in allowed directories');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    resolvedPath,
  };
}

function validateUrl(url) {
  const errors = [];

  if (!url || typeof url !== 'string') {
    errors.push('URL must be a non-empty string');
    return { valid: false, errors };
  }

  try {
    const parsed = new URL(url);

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      errors.push('URL must use HTTP or HTTPS protocol');
    }

    if (parsed.hostname === 'localhost' || /^127\./.test(parsed.hostname)) {
      errors.push('Access to localhost is restricted');
    }

    return { valid: errors.length === 0, errors, parsed };
  } catch (e) {
    errors.push('Invalid URL format');
    return { valid: false, errors };
  }
}

function validateAiCommand(command) {
  const errors = [];
  const warnings = [];

  if (!command || typeof command !== 'object') {
    errors.push('AI command must be an object');
    return { valid: false, errors, warnings };
  }

  const knownCommands = [
    'NAVIGATE', 'SHELL_COMMAND', 'CREATE_PDF', 'CREATE_PDF_JSON',
    'CLICK_ELEMENT', 'FIND_AND_CLICK', 'OCR_SCREEN', 'OCR_COORDINATES',
    'SET_VOLUME', 'OPEN_APP', 'SCROLL_DOWN', 'SCROLL_UP',
    'SHELL_COMMAND_LIGHT', 'SCHEDULE_TASK', 'PLUGIN_COMMAND',
    'DELETE_FILE', 'REMOVE_FILE', 'FORMAT_DISK', 'PARTITION_DISK',
    'WRITE_DISK', 'POWER_ACTION', 'FIREWALL_CHANGE', 'PERMISSION_CHANGE',
  ];

  if (command.command && !knownCommands.includes(command.command)) {
    warnings.push(`Unknown command type: ${command.command}`);
  }

  if (command.params) {
    if (command.params.path && typeof command.params.path === 'string') {
      const pathValidation = validateFilePath(command.params.path);
      if (!pathValidation.valid) {
        errors.push(...pathValidation.errors.map(e => `path: ${e}`));
      }
    }

    if (command.params.url && typeof command.params.url === 'string') {
      const urlValidation = validateUrl(command.params.url);
      if (!urlValidation.valid) {
        errors.push(...urlValidation.errors.map(e => `url: ${e}`));
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function getRiskLevel(commandType) {
  const riskMap = {
    'NAVIGATE': RISK_LEVELS.LOW,
    'SHELL_COMMAND_LIGHT': RISK_LEVELS.LOW,
    'CREATE_PDF': RISK_LEVELS.LOW,
    'CREATE_PDF_JSON': RISK_LEVELS.LOW,
    'SET_VOLUME': RISK_LEVELS.LOW,
    'SCROLL_DOWN': RISK_LEVELS.LOW,
    'SCROLL_UP': RISK_LEVELS.LOW,
    'OCR_SCREEN': RISK_LEVELS.MEDIUM,
    'OCR_COORDINATES': RISK_LEVELS.MEDIUM,
    'OPEN_APP': RISK_LEVELS.MEDIUM,
    'SHELL_COMMAND': RISK_LEVELS.HIGH,
    'CLICK_ELEMENT': RISK_LEVELS.HIGH,
    'FIND_AND_CLICK': RISK_LEVELS.HIGH,
    'SCHEDULE_TASK': RISK_LEVELS.HIGH,
    'PLUGIN_COMMAND': RISK_LEVELS.HIGH,
    'DELETE_FILE': RISK_LEVELS.HIGH,
    'REMOVE_FILE': RISK_LEVELS.HIGH,
    'FORMAT_DISK': RISK_LEVELS.HIGH,
    'PARTITION_DISK': RISK_LEVELS.HIGH,
    'WRITE_DISK': RISK_LEVELS.HIGH,
    'POWER_ACTION': RISK_LEVELS.HIGH,
    'FIREWALL_CHANGE': RISK_LEVELS.HIGH,
    'PERMISSION_CHANGE': RISK_LEVELS.HIGH,
  };

  return riskMap[commandType] || RISK_LEVELS.MEDIUM;
}

function canAutoExecute(commandType) {
  return AUTO_EXEC_ALLOWED.has(commandType);
}

class SecurityValidator {
  constructor(options = {}) {
    this.allowedDirs = options.allowedDirs || [
      os.homedir(),
      '/tmp',
      '/Applications',
      '/System/Applications',
    ];
    this.enableDeepValidation = options.enableDeepValidation !== false;
  }

  validateShell(command) {
    return validateCommand(command);
  }

  validateAiCommand(command) {
    return validateAiCommand(command);
  }

  validateFilePath(filePath) {
    return validateFilePath(filePath, this.allowedDirs);
  }

  validateUrl(url) {
    return validateUrl(url);
  }

  validateCoordinates(x, y, bounds) {
    return validateOcrCoordinates(x, y, bounds);
  }

  sanitizeCommand(command) {
    return sanitizeShellCommand(command);
  }

  getRiskLevel(commandType) {
    return getRiskLevel(commandType);
  }

  canAutoExecute(commandType) {
    return canAutoExecute(commandType);
  }
}

const globalValidator = new SecurityValidator();

module.exports = {
  SecurityValidator,
  globalValidator,
  validateCommand,
  validateAiCommand,
  validateFilePath,
  validateUrl,
  validateOcrCoordinates,
  sanitizeShellCommand,
  containsDangerousPattern,
  containsDestructivePattern,
  getShellRisk,
  getRiskLevel,
  canAutoExecute,
  RISK_LEVELS,
  BLOCKED_COMMANDS,
  DANGEROUS_PATTERNS,
  // Re-exported from shell-command-tiers.js. Callers that already import from
  // SecurityValidator should not need a second import path.
  SHELL_COMMAND_TIERS,
  DESTRUCTIVE_COMMAND_PATTERNS,
  classifyShellCommand,
  normalizeCommandPattern,
  alwaysApprovalEligibility,
  isAutoApproveEligibleTier,
  extractBaseBinary,
};

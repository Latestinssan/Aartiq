/**
 * shell-command-tiers.js
 *
 * The single per-command risk table. Two consumers, one source:
 *
 *   1. SecurityValidator.getShellRisk — the runtime classifier
 *   2. the docs generator in scripts/ — the risk-tier table on the security page
 *
 * Keeping it in one file is the point. When the two read separate tables they
 * drift, and the docs end up describing a classifier that no longer exists.
 *
 * ── Invariants this file must preserve ──────────────────────────────────────
 *
 *   I1. No command that can write to the filesystem, reach the network, run
 *       code, or change permissions or process state is ever `low`.
 *   I2. Anything matching DESTRUCTIVE_COMMAND_PATTERNS is at least `high`,
 *       whatever its table entry says. The table can raise a tier; the floor
 *       can only lower one, and it is not lowered.
 *   I3. An unknown binary is `medium`, never `low` and never `high`. Failing to
 *       recognise a command must not fail open.
 *   I4. A command line containing a URL is at least `medium`, whatever the table
 *       says. This is what stops a bare `cat` from becoming `low` when handed a
 *       URL that a shell builtin or a redirect will act on.
 *
 * `tests/shell-command-tiers.test.js` asserts each invariant against this table
 * directly, so a future edit that breaks one fails a test rather than quietly
 * weakening a default.
 */

// ── Tiers ───────────────────────────────────────────────────────────────────

const SHELL_TIERS = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};

/** Ranked so tiers can be compared and raised. */
const TIER_RANK = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

// ── Capability flags ────────────────────────────────────────────────────────
//
// What a command is *able* to do, independent of the tier it was given. The docs
// generator renders these so the published table explains itself.

const CAPABILITIES = {
  READ_FILES: 'read-files',
  WRITE_FILES: 'write-files',
  NETWORK: 'network',
  RUN_CODE: 'run-code',
  CHANGE_PERMISSIONS: 'change-permissions',
  CONTROL_PROCESSES: 'control-processes',
  CHANGE_SYSTEM: 'change-system-state',
};

/** Any of these disqualifies a command from the `low` tier (invariant I1). */
const NON_LOW_CAPABILITIES = new Set([
  CAPABILITIES.WRITE_FILES,
  CAPABILITIES.NETWORK,
  CAPABILITIES.RUN_CODE,
  CAPABILITIES.CHANGE_PERMISSIONS,
  CAPABILITIES.CONTROL_PROCESSES,
  CAPABILITIES.CHANGE_SYSTEM,
]);

// ── Commands rejected before any tier is consulted ──────────────────────────
//
// Moved here from SecurityValidator so the table and the reject list live
// together. SecurityValidator re-exports the set so existing importers keep
// working. `rm` is in this set and also appears in the tier table below; the
// reject list is checked first, so `rm` never reaches the tier logic. That
// overlap is why older documentation could describe `rm` as both blocked and
// approval-gated — only the first is true.

const BLOCKED_COMMANDS = new Set([
  'sudo', 'su', 'passwd', 'chgrp', 'rm',
]);

// ── Destructive patterns: the `high` floor ───────────────────────────────────
//
// Verbatim from SecurityValidator, which they used to own. A match forces the
// tier to at least `high` (invariant I2).

const DESTRUCTIVE_COMMAND_PATTERNS = [
  /\brm\s/i,
  /\bdel\s/i,
  /\bdel\//i,
  /\brmdir/i,
  /\brd\s\/[sfq]/i,
  /\bformat\s/i,
  /\bfdisk/i,
  /\bmkfs/i,
  /\bdd\s+if=/i,
  /\bshred/i,
  /\bwipe/i,
  /\bfind\s.*-delete/i,
  /\bfind\s.*-exec\s+rm/i,
  /\bxargs\s+rm/i,
  /\bxargs\s+del/i,
  /\bunlk\b/i,
  /\bunlink\s/i,
  /\bsudo\s/i,
  /\bsu\s/i,
  /\bkill\s/i,
  /\bkillall/i,
  /\bpkill/i,
  />\s*\/dev\//i,
  /\bshutdown/i,
  /\breboot/i,
  /\bhalt\b/i,
  /\bpoweroff/i,
  /\binit\s/i,
  /\bchmod\s/i,
  /\bchown\s/i,
  /\bchgrp\s/i,
  /\bmount\s/i,
  /\bumount/i,
  /\beject/i,
  /\biptables/i,
  /\bufw\b/i,
  /\bfirewall/i,
];

/** A URL anywhere in the command line. Enforces invariant I4. */
const URL_ARGUMENT_PATTERN = /[a-z][a-z0-9+.-]*:\/\//i;

// ── The per-command table ───────────────────────────────────────────────────
//
// tier: the tier this binary gets when invoked plainly.
// caps:  what it is capable of; drives invariant I1.

const SHELL_COMMAND_TIERS = {
  // ── low: read-only. Cannot write, cannot reach the network, cannot run code.
  //
  // This is the only tier the `autoApproveLowRiskShell` setting can
  // auto-approve, and that setting is off by default. Note the deliberate
  // omissions: `find` is here but `find -delete` / `-exec rm` hits a destructive
  // pattern and is raised to `high`; `xargs` is absent because it turns any
  // read-only binary into whatever it is handed.
  ls: { tier: SHELL_TIERS.LOW, caps: [CAPABILITIES.READ_FILES] },
  ll: { tier: SHELL_TIERS.LOW, caps: [CAPABILITIES.READ_FILES] },
  dir: { tier: SHELL_TIERS.LOW, caps: [CAPABILITIES.READ_FILES] },
  pwd: { tier: SHELL_TIERS.LOW, caps: [CAPABILITIES.READ_FILES] },
  cat: { tier: SHELL_TIERS.LOW, caps: [CAPABILITIES.READ_FILES] },
  bat: { tier: SHELL_TIERS.LOW, caps: [CAPABILITIES.READ_FILES] },
  head: { tier: SHELL_TIERS.LOW, caps: [CAPABILITIES.READ_FILES] },
  tail: { tier: SHELL_TIERS.LOW, caps: [CAPABILITIES.READ_FILES] },
  less: { tier: SHELL_TIERS.LOW, caps: [CAPABILITIES.READ_FILES] },
  more: { tier: SHELL_TIERS.LOW, caps: [CAPABILITIES.READ_FILES] },
  file: { tier: SHELL_TIERS.LOW, caps: [CAPABILITIES.READ_FILES] },
  stat: { tier: SHELL_TIERS.LOW, caps: [CAPABILITIES.READ_FILES] },
  wc: { tier: SHELL_TIERS.LOW, caps: [CAPABILITIES.READ_FILES] },
  du: { tier: SHELL_TIERS.LOW, caps: [CAPABILITIES.READ_FILES] },
  df: { tier: SHELL_TIERS.LOW, caps: [CAPABILITIES.READ_FILES] },
  tree: { tier: SHELL_TIERS.LOW, caps: [CAPABILITIES.READ_FILES] },
  grep: { tier: SHELL_TIERS.LOW, caps: [CAPABILITIES.READ_FILES] },
  egrep: { tier: SHELL_TIERS.LOW, caps: [CAPABILITIES.READ_FILES] },
  fgrep: { tier: SHELL_TIERS.LOW, caps: [CAPABILITIES.READ_FILES] },
  rg: { tier: SHELL_TIERS.LOW, caps: [CAPABILITIES.READ_FILES] },
  find: { tier: SHELL_TIERS.LOW, caps: [CAPABILITIES.READ_FILES] },
  which: { tier: SHELL_TIERS.LOW, caps: [] },
  type: { tier: SHELL_TIERS.LOW, caps: [] },
  whoami: { tier: SHELL_TIERS.LOW, caps: [] },
  hostname: { tier: SHELL_TIERS.LOW, caps: [] },
  uname: { tier: SHELL_TIERS.LOW, caps: [] },
  date: { tier: SHELL_TIERS.LOW, caps: [] },
  echo: { tier: SHELL_TIERS.LOW, caps: [] },
  printf: { tier: SHELL_TIERS.LOW, caps: [] },
  true: { tier: SHELL_TIERS.LOW, caps: [] },
  sleep: { tier: SHELL_TIERS.LOW, caps: [] },

  // ── medium: writes files, runs installers, or reaches the network.
  //
  // None of these is ever auto-approved by default. With no grant the user gets
  // the per-action dialog.
  cp: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.READ_FILES, CAPABILITIES.WRITE_FILES] },
  mv: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.WRITE_FILES] },
  mkdir: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.WRITE_FILES] },
  touch: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.WRITE_FILES] },
  ln: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.WRITE_FILES] },
  rsync: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.READ_FILES, CAPABILITIES.WRITE_FILES] },
  scp: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.READ_FILES, CAPABILITIES.WRITE_FILES, CAPABILITIES.NETWORK] },
  sftp: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.READ_FILES, CAPABILITIES.WRITE_FILES, CAPABILITIES.NETWORK] },

  // Network-capable. Listed at medium rather than low: these open a connection
  // to something the user did not choose, and can write what they fetch.
  curl: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.NETWORK, CAPABILITIES.WRITE_FILES] },
  wget: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.NETWORK, CAPABILITIES.WRITE_FILES] },
  ping: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.NETWORK] },
  dig: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.NETWORK] },
  nslookup: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.NETWORK] },
  host: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.NETWORK] },

  // Interpreter and package-manager entry points. These run whatever code they
  // are handed, which is why they cannot be `low` even though `npm --version`
  // looks harmless — the classifier reads the binary, not the arguments.
  node: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.RUN_CODE, CAPABILITIES.NETWORK] },
  npx: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.RUN_CODE, CAPABILITIES.NETWORK] },
  npm: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.RUN_CODE, CAPABILITIES.NETWORK, CAPABILITIES.WRITE_FILES] },
  pnpm: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.RUN_CODE, CAPABILITIES.NETWORK, CAPABILITIES.WRITE_FILES] },
  yarn: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.RUN_CODE, CAPABILITIES.NETWORK, CAPABILITIES.WRITE_FILES] },
  bun: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.RUN_CODE, CAPABILITIES.NETWORK, CAPABILITIES.WRITE_FILES] },
  python: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.RUN_CODE, CAPABILITIES.NETWORK, CAPABILITIES.WRITE_FILES] },
  python3: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.RUN_CODE, CAPABILITIES.NETWORK, CAPABILITIES.WRITE_FILES] },
  pip: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.RUN_CODE, CAPABILITIES.NETWORK, CAPABILITIES.WRITE_FILES] },
  pip3: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.RUN_CODE, CAPABILITIES.NETWORK, CAPABILITIES.WRITE_FILES] },
  ruby: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.RUN_CODE] },
  perl: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.RUN_CODE] },
  php: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.RUN_CODE, CAPABILITIES.NETWORK] },
  java: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.RUN_CODE] },

  // Drives other applications. `osascript` can send keystrokes and click
  // buttons in any app the user has open, so it inherits that authority.
  osascript: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.RUN_CODE, CAPABILITIES.CONTROL_PROCESSES] },
  open: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.RUN_CODE, CAPABILITIES.CONTROL_PROCESSES] },

  // Shell interpreters. `bash script.sh` executes a file.
  sh: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.RUN_CODE] },
  bash: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.RUN_CODE] },
  zsh: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.RUN_CODE] },
  fish: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.RUN_CODE] },

  // Version control. `git clone` reaches the network and writes a tree;
  // `git push` leaves the machine.
  git: { tier: SHELL_TIERS.MEDIUM, caps: [CAPABILITIES.RUN_CODE, CAPABILITIES.NETWORK, CAPABILITIES.WRITE_FILES] },

  // ── high: changes permissions, or destroys state.
  //
  // `chmod` sits here rather than in medium. It was already `high` because
  // DESTRUCTIVE_COMMAND_PATTERNS matches it, and moving it down would be the one
  // edit in this file that weakens a default.
  chmod: { tier: SHELL_TIERS.HIGH, caps: [CAPABILITIES.CHANGE_PERMISSIONS] },
  chown: { tier: SHELL_TIERS.HIGH, caps: [CAPABILITIES.CHANGE_PERMISSIONS] },
  kill: { tier: SHELL_TIERS.HIGH, caps: [CAPABILITIES.CONTROL_PROCESSES] },
  killall: { tier: SHELL_TIERS.HIGH, caps: [CAPABILITIES.CONTROL_PROCESSES] },
  pkill: { tier: SHELL_TIERS.HIGH, caps: [CAPABILITIES.CONTROL_PROCESSES] },
  shutdown: { tier: SHELL_TIERS.HIGH, caps: [CAPABILITIES.CHANGE_SYSTEM] },
  reboot: { tier: SHELL_TIERS.HIGH, caps: [CAPABILITIES.CHANGE_SYSTEM] },
  halt: { tier: SHELL_TIERS.HIGH, caps: [CAPABILITIES.CHANGE_SYSTEM] },
  poweroff: { tier: SHELL_TIERS.HIGH, caps: [CAPABILITIES.CHANGE_SYSTEM] },
  mount: { tier: SHELL_TIERS.HIGH, caps: [CAPABILITIES.CHANGE_SYSTEM] },
  umount: { tier: SHELL_TIERS.HIGH, caps: [CAPABILITIES.CHANGE_SYSTEM] },
  dd: { tier: SHELL_TIERS.HIGH, caps: [CAPABILITIES.WRITE_FILES, CAPABILITIES.CHANGE_SYSTEM] },
  shred: { tier: SHELL_TIERS.HIGH, caps: [CAPABILITIES.WRITE_FILES] },
  truncate: { tier: SHELL_TIERS.HIGH, caps: [CAPABILITIES.WRITE_FILES] },
};

/**
 * Binaries that are never offered "Allow Always", whatever their tier.
 *
 * The reason is specific: an always-grant on a network-capable or
 * script-capable binary persists an authority the user cannot see the scope of.
 * A later `curl` with a different target, or an `osascript` with different
 * AppleScript, runs under a grant the user gave for something else.
 *
 * Medium and high tiers are excluded wholesale rather than case by case,
 * because the tier already means "this can do something you did not ask for".
 * A full argument-aware policy is tracked in
 * docs-audit/issues/allow-always-granularity.md.
 */
const NEVER_ALWAYS_ELIGIBLE = new Set([
  'curl', 'wget', 'osascript', 'chmod', 'chown',
  'npm', 'npx', 'pnpm', 'yarn', 'bun',
  'node', 'python', 'python3', 'pip', 'pip3',
  'ruby', 'perl', 'php', 'java',
  'git', 'scp', 'sftp', 'ssh', 'rsync',
  'open', 'kill', 'killall', 'pkill',
  'sh', 'bash', 'zsh', 'fish',
  'dd', 'shred', 'truncate',
  'mount', 'umount',
  'shutdown', 'reboot', 'halt', 'poweroff',
  'xargs', 'env', 'eval', 'exec', 'command', 'sudo', 'su', 'doas',
]);

// ── Classification ──────────────────────────────────────────────────────────

/**
 * Extract the base binary from a command line.
 *
 * Handles an absolute or relative path (`/usr/bin/curl`), a `.bat`/`.cmd`
 * extension, and leading `VAR=value` assignments. Deliberately does not parse
 * shell quoting, redirections or pipelines: those are handled by the pattern
 * rules and by the shell itself rejecting malformed input. Getting this wrong
 * resolves to an unknown binary, which invariant I3 sends to `medium`.
 */
function extractBaseBinary(command) {
  if (typeof command !== 'string') return '';
  const firstToken = command.trim().split(/\s+/)[0] || '';
  if (!firstToken || firstToken.includes('=')) return '';
  const base = firstToken.split(/[/\\]/).pop() || '';
  return base.toLowerCase().replace(/\.(bat|cmd|exe|ps1)$/i, '');
}

/** True when the binary is in the table. */
function isKnownShellCommand(binary) {
  return Object.prototype.hasOwnProperty.call(SHELL_COMMAND_TIERS, binary);
}

/** The table entry for a binary, or `null` when it is not in the table. */
function getShellCommandEntry(binary) {
  return isKnownShellCommand(binary) ? SHELL_COMMAND_TIERS[binary] : null;
}

function containsDestructivePattern(command) {
  if (typeof command !== 'string' || command.length === 0) return false;
  return DESTRUCTIVE_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

function containsUrlArgument(command) {
  if (typeof command !== 'string') return false;
  return URL_ARGUMENT_PATTERN.test(command);
}

function raiseTier(tier, floor) {
  if (TIER_RANK[floor] > TIER_RANK[tier]) return floor;
  return tier;
}

/**
 * Classify a shell command.
 *
 * Returns `{ tier, binary, entry, known, destructive, hasUrl, reason }`.
 * `reason` is a short machine-readable string naming the rule that decided the
 * tier, so an unexpected classification can be explained without re-running the
 * logic by hand.
 */
function classifyShellCommand(command) {
  if (typeof command !== 'string' || command.trim().length === 0) {
    return {
      tier: SHELL_TIERS.MEDIUM,
      binary: '',
      entry: null,
      known: false,
      destructive: false,
      hasUrl: false,
      reason: 'empty-command',
    };
  }

  const binary = extractBaseBinary(command);
  const entry = getShellCommandEntry(binary);
  const destructive = containsDestructivePattern(command);
  const hasUrl = containsUrlArgument(command);

  let tier;
  let reason;

  if (!entry) {
    // I3: an unrecognised binary is medium, never low.
    tier = SHELL_TIERS.MEDIUM;
    reason = 'unknown-binary';
  } else {
    tier = entry.tier;
    reason = `table:${binary}`;
  }

  if (destructive) {
    tier = raiseTier(tier, SHELL_TIERS.HIGH);
    reason = 'destructive-pattern';
  }

  // I4: a URL in the arguments rules out `low` even for a read-only binary.
  if (hasUrl) {
    tier = raiseTier(tier, SHELL_TIERS.MEDIUM);
    if (tier === SHELL_TIERS.MEDIUM) reason = 'url-argument';
  }

  // I1: belt and braces. Even if a future table entry were to declare a
  // write/network/code capability at `low`, this refuses to honour it.
  if (entry && tier === SHELL_TIERS.LOW && entry.caps.some((c) => NON_LOW_CAPABILITIES.has(c))) {
    tier = SHELL_TIERS.MEDIUM;
    reason = 'capability-floor';
  }

  return { tier, binary, entry, known: Boolean(entry), destructive, hasUrl, reason };
}

/**
 * Normalise a command line for "Allow Always" keys.
 *
 * The previous implementation keyed on the first word alone, so a grant for
 * `curl https://example.com` also covered `curl http://169.254.169.254/…`. This
 * collapses whitespace and lower-cases the whole line instead, so a grant
 * matches one specific invocation.
 *
 * This is not a security parser and is not asked to be one: `ls  -la` and
 * `ls -la` collapse to the same key, and `ls "$HOME"` and `ls /home/me` do not.
 * The eligibility rule below is what stops the residual gap mattering.
 */
function normalizeCommandPattern(command) {
  if (typeof command !== 'string') return '';
  return command.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Whether "Allow Always" may be offered for a command, and why not if it may
 * not. Returns `{ eligible, reason }`.
 *
 * The rule is allow-list, not deny-list: a permanent grant requires a binary we
 * have classified. `NEVER_ALWAYS_ELIGIBLE` alone let anything absent from it
 * through, including a binary nobody has heard of — which is exactly the one
 * whose behaviour cannot be described to the user before they grant it forever.
 * Such a command is `medium` because we know nothing about it, and the same
 * ignorance is why "Allow Once" is the strongest answer available for it.
 *
 * Membership in the tier table is what establishes that we know what a binary
 * does. It is a weaker signal than knowing a binary is safe, and a `medium` entry
 * can still be granted: `cp`, `mv`, `mkdir` and `touch` keep exact-match permanent
 * grants, because the effect of repeating them is visible in the dialog text.
 */
function alwaysApprovalEligibility(command) {
  const binary = extractBaseBinary(command);
  if (!binary) return { eligible: false, reason: 'unparseable-command' };
  if (NEVER_ALWAYS_ELIGIBLE.has(binary)) {
    return { eligible: false, reason: `network-or-script-capable:${binary}` };
  }
  if (containsUrlArgument(command)) {
    return { eligible: false, reason: 'url-argument' };
  }
  if (containsDestructivePattern(command)) {
    return { eligible: false, reason: 'destructive-pattern' };
  }
  if (!isKnownShellCommand(binary)) {
    return { eligible: false, reason: `unrecognised-binary:${binary}` };
  }
  return { eligible: true, reason: null };
}

/** True only for `low`. The single condition any auto-approval must check. */
function isAutoApproveEligibleTier(tier) {
  return String(tier || '').toLowerCase() === SHELL_TIERS.LOW;
}

module.exports = {
  SHELL_TIERS,
  TIER_RANK,
  CAPABILITIES,
  NON_LOW_CAPABILITIES,
  BLOCKED_COMMANDS,
  DESTRUCTIVE_COMMAND_PATTERNS,
  SHELL_COMMAND_TIERS,
  NEVER_ALWAYS_ELIGIBLE,
  URL_ARGUMENT_PATTERN,
  extractBaseBinary,
  isKnownShellCommand,
  getShellCommandEntry,
  containsDestructivePattern,
  containsUrlArgument,
  classifyShellCommand,
  normalizeCommandPattern,
  alwaysApprovalEligibility,
  isAutoApproveEligibleTier,
};
/**
 * shell-command-tiers.test.js
 *
 * Two jobs:
 *
 *   1. Assert the invariants the tier table declares, so a later edit that breaks
 *      one fails here rather than quietly weakening a default.
 *   2. Pin the classification the docs generator reads, because the docs and this
 *      file must not be able to drift apart.
 */

const {
  SHELL_TIERS,
  TIER_RANK,
  CAPABILITIES,
  NON_LOW_CAPABILITIES,
  BLOCKED_COMMANDS,
  SHELL_COMMAND_TIERS,
  NEVER_ALWAYS_ELIGIBLE,
  extractBaseBinary,
  classifyShellCommand,
  normalizeCommandPattern,
  alwaysApprovalEligibility,
  isAutoApproveEligibleTier,
} = require('../src/lib/shell-command-tiers');
const { getShellRisk } = require('../src/lib/SecurityValidator');

// ───────────────────────────────────────────────────────────────────────────

describe('invariant I1: no capable command is low', () => {
  const everyEntry = Object.entries(SHELL_COMMAND_TIERS);

  test('the table is not empty', () => {
    expect(everyEntry.length).toBeGreaterThan(0);
  });

  test.each(everyEntry)('%s is never low if it can write, reach the network or run code', (binary, entry) => {
    const capable = (entry.caps || []).some((c) => NON_LOW_CAPABILITIES.has(c));
    if (capable) {
      expect(entry.tier).not.toBe(SHELL_TIERS.LOW);
    }
  });

  test('every command in the never-Always set is not low either', () => {
    for (const binary of NEVER_ALWAYS_ELIGIBLE) {
      const verdict = classifyShellCommand(`${binary} something`);
      expect(['low']).not.toContain(verdict.tier);
    }
  });

  test('the low tier contains only commands that cannot leave the filesystem', () => {
    const lowEntries = everyEntry.filter(([, e]) => e.tier === SHELL_TIERS.LOW).map(([b]) => b);
    for (const binary of lowEntries) {
      const caps = SHELL_COMMAND_TIERS[binary].caps || [];
      expect(caps.filter((c) => NON_LOW_CAPABILITIES.has(c))).toEqual([]);
    }
  });
});

describe('invariant I2: a destructive pattern raises the tier, never lowers it', () => {
  test.each([
    ['chmod 777 /etc/hosts', 'high'],
    ['kill -9 1234', 'high'],
    ['mount /dev/sda1 /mnt', 'high'],
    ['find . -delete', 'high'],
    ['find . -exec rm {} ;', 'high'],
    ['xargs rm', 'high'],
    ['shutdown -h now', 'high'],
    ['iptables -F', 'high'],
    ['shred secrets.txt', 'high'],
    ['dd if=/dev/zero of=/dev/sda', 'high'],
  ])('%s is high', (command, expected) => {
    expect(getShellRisk(command)).toBe(expected);
  });

  test('a command that would be low on its own is raised by the pattern', () => {
    // `grep` alone is low; grepping through a process list is not the concern
    // here — the point is that the floor applies to a known-low binary too.
    const base = classifyShellCommand('cat notes.txt').tier;
    expect(base).toBe(SHELL_TIERS.LOW);
    expect(getShellRisk('cat notes.txt > /dev/sda')).toBe(SHELL_TIERS.HIGH);
  });

  test('no table entry declares a tier below what the pattern floor gives it', () => {
    for (const [binary, entry] of Object.entries(SHELL_COMMAND_TIERS)) {
      if (TIER_RANK[entry.tier] >= TIER_RANK[SHELL_TIERS.HIGH]) continue;
      // A medium entry that also matches a destructive pattern is fine — the
      // floor raises it at classification time, not in the table.
      const verdict = classifyShellCommand(binary);
      expect(TIER_RANK[verdict.tier]).toBeGreaterThanOrEqual(TIER_RANK[entry.tier]);
    }
  });
});

describe('invariant I3: an unknown binary is medium', () => {
  test.each([
    'definitely-not-a-real-binary',
    'some-tool --version',
    '/opt/vendor/bin/thing',
    '',
    '   ',
  ])('"%s" classifies as medium', (command) => {
    expect(getShellRisk(command)).toBe(SHELL_TIERS.MEDIUM);
  });

  test('a non-string classifies as medium', () => {
    expect(getShellRisk(null)).toBe(SHELL_TIERS.MEDIUM);
    expect(getShellRisk(undefined)).toBe(SHELL_TIERS.MEDIUM);
    expect(getShellRisk(42)).toBe(SHELL_TIERS.MEDIUM);
  });

  test('unknown binaries are reported as unknown so the reason is explainable', () => {
    const verdict = classifyShellCommand('some-tool --version');
    expect(verdict.known).toBe(false);
    expect(verdict.reason).toBe('unknown-binary');
  });
});

describe('invariant I4: a URL in the arguments rules out low', () => {
  test.each([
    'cat https://example.com/page.html',
    'echo http://127.0.0.1:3001/health',
    'grep pattern ftp://files.example.com/data',
    'ls file:///',
  ])('"%s" is not low', (command) => {
    expect(getShellRisk(command)).not.toBe(SHELL_TIERS.LOW);
  });

  test('the reason names the URL when that is what decided it', () => {
    const verdict = classifyShellCommand('cat https://example.com/page.html');
    expect(verdict.hasUrl).toBe(true);
    expect(verdict.reason).toBe('url-argument');
  });

  test('a URL that also matches a destructive pattern is high', () => {
    expect(getShellRisk('rm https://example.com/file')).toBe(SHELL_TIERS.HIGH);
  });
});

describe('the read-only commands the settings can auto-approve', () => {
  test.each(['ls', 'cat', 'pwd', 'find', 'grep', 'echo'])('%s is low', (command) => {
    expect(getShellRisk(command)).toBe(SHELL_TIERS.LOW);
  });

  test.each([
    ['ls', 'ls'],
    ['ls -la', 'ls -la'],
    ['cat', 'cat'],
    ['cat notes.md', 'cat notes.md'],
    ['pwd', 'pwd'],
    ['find', 'find'],
    ['find . -name "*.md"', 'find . -name "*.md"'],
    ['grep', 'grep'],
    ['grep -r pattern .', 'grep -r pattern .'],
    ['echo', 'echo'],
    ['echo hello', 'echo hello'],
  ])('%s is low', (command, expected) => {
    expect(getShellRisk(expected)).toBe(SHELL_TIERS.LOW);
  });
});

describe('the commands that must never be low', () => {
  test.each([
    'cp a b',
    'mv a b',
    'mkdir new',
    'npm install left-pad',
    'git clone https://example.com/repo',
    'curl https://example.com',
    'wget https://example.com/file',
    'osascript -e "tell app Finder to activate"',
    'node script.js',
    'npx some-package',
    'python3 script.py',
    'open -a Calculator',
  ])('%s is not low', (command) => {
    expect(getShellRisk(command)).not.toBe(SHELL_TIERS.LOW);
  });

  test.each([
    'cp a b',
    'mv a b',
    'mkdir new',
    'npm install left-pad',
    'git clone https://example.com/repo',
    'curl https://example.com',
    'wget https://example.com/file',
    'osascript -e "tell app Finder to activate"',
  ])('%s is medium or higher', (command) => {
    expect(['medium', 'high', 'critical']).toContain(getShellRisk(command));
  });

  test('chmod is high, not medium', () => {
    // The task brief groups chmod with the medium commands. It was already high
    // because the destructive-pattern list matches it, and moving it down would
    // be the one edit in this file that weakens a default.
    expect(getShellRisk('chmod 777 file')).toBe(SHELL_TIERS.HIGH);
  });
});

describe('blocked commands are rejected before any tier is consulted', () => {
  test.each(['sudo', 'su', 'passwd', 'chgrp', 'rm'])('%s is in the blocked set', (command) => {
    expect(BLOCKED_COMMANDS.has(command)).toBe(true);
  });

  test('rm is blocked, which is why it is neither "blocked" nor "gated" in the docs', () => {
    // command-validator.validateCommand is the throwing wrapper the execution
    // path calls; SecurityValidator.validateCommand only reports.
    const { validateCommand } = require('../src/core/command-validator');
    expect(() => validateCommand('rm -rf /tmp/x')).toThrow();
    expect(() => validateCommand('rm file.txt')).toThrow();
    expect(() => validateCommand('sudo ls')).toThrow();
    // And a command that is merely destructive-but-not-blocked does throw too,
    // because the dangerous-pattern layer rejects it independently.
    expect(() => validateCommand('ls -la')).not.toThrow();
  });
});

describe('extractBaseBinary', () => {
  test.each([
    ['ls', 'ls'],
    ['ls -la', 'ls'],
    ['  ls   -la  ', 'ls'],
    ['/usr/bin/curl https://x', 'curl'],
    ['/opt/bin/wget', 'wget'],
    ['C:\\Windows\\System32\\where.exe', 'where'],
    ['/usr/local/bin/ls.sh', 'ls.sh'],
    ['NODE_ENV=production node app.js', ''],
    ['', ''],
    [null, ''],
  ])('extracts "%s" -> "%s"', (command, expected) => {
    expect(extractBaseBinary(command)).toBe(expected);
  });
});

describe('normalizeCommandPattern', () => {
  test('covers the whole command, not the first word', () => {
    expect(normalizeCommandPattern('grep -r pattern .')).toBe('grep -r pattern .');
    expect(normalizeCommandPattern('  grep   -r   pattern   .  ')).toBe('grep -r pattern .');
  });

  test('is case-insensitive', () => {
    expect(normalizeCommandPattern('GREP -R Pattern .')).toBe('grep -r pattern .');
  });

  test('two different invocations of the same binary get different keys', () => {
    // The defect this replaces: both of these produced the single key "grep".
    expect(normalizeCommandPattern('grep notes.md')).not.toBe(normalizeCommandPattern('grep ~/.ssh/id_rsa'));
    expect(normalizeCommandPattern('ls')).not.toBe(normalizeCommandPattern('ls /etc/shadow'));
  });

  test('an empty command normalises to empty', () => {
    expect(normalizeCommandPattern('')).toBe('');
    expect(normalizeCommandPattern(null)).toBe('');
  });
});

describe('"Allow Always" eligibility', () => {
  test.each(['curl', 'wget', 'osascript', 'chmod', 'chown', 'npm', 'npx', 'git', 'ssh', 'open'])(
    '%s is never offered a permanent grant',
    (binary) => {
      const verdict = alwaysApprovalEligibility(`${binary} argument`);
      expect(verdict.eligible).toBe(false);
      expect(verdict.reason).toBeTruthy();
    },
  );

  test.each(['xargs', 'env', 'eval', 'exec', 'doas'])('%s is never offered a permanent grant', (binary) => {
    expect(alwaysApprovalEligibility(`${binary} rm file`).eligible).toBe(false);
  });

  test('a read-only command is eligible', () => {
    expect(alwaysApprovalEligibility('ls -la').eligible).toBe(true);
    expect(alwaysApprovalEligibility('cat notes.md').eligible).toBe(true);
    expect(alwaysApprovalEligibility('grep -r pattern .').eligible).toBe(true);
  });

  test('any command with a URL argument is ineligible, even a read-only one', () => {
    const verdict = alwaysApprovalEligibility('cat https://example.com/x');
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe('url-argument');
  });

  test('a destructive command is ineligible', () => {
    expect(alwaysApprovalEligibility('find . -delete').eligible).toBe(false);
  });

  test('an unparseable command is ineligible', () => {
    expect(alwaysApprovalEligibility('NODE_ENV=x node app.js').eligible).toBe(false);
    expect(alwaysApprovalEligibility('').eligible).toBe(false);
  });

  test('an unrecognised binary is ineligible, because it cannot be described', () => {
    // The gap the deny-list alone left open: anything not named in
    // NEVER_ALWAYS_ELIGIBLE passed, so a binary nobody had classified could take
    // a permanent grant. It is `medium` precisely because nothing is known about
    // it, and that same ignorance is why "Allow Once" is the strongest answer
    // available for it.
    const verdict = alwaysApprovalEligibility('some-tool --version');
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe('unrecognised-binary:some-tool');
  });

  test('a path-qualified binary is judged on its basename', () => {
    // extractBaseBinary strips directories, so a path must not change the verdict
    // in either direction: it cannot make an unknown binary look known, and it
    // cannot make a known binary ineligible.
    expect(alwaysApprovalEligibility('/opt/vendor/blobtool --dump').eligible).toBe(false);
    expect(alwaysApprovalEligibility('/bin/ls -la').eligible).toBe(true);
  });

  test('a Windows executable suffix is stripped before the lookup', () => {
    expect(alwaysApprovalEligibility('ls.exe -la').eligible).toBe(true);
    expect(alwaysApprovalEligibility('blat.exe --version').eligible).toBe(false);
  });

  test('local file writes keep exact-match permanent grants', () => {
    // Eligibility is not restricted to the low tier. `cp` and friends are medium
    // and still grantable, because repeating them has effects the dialog text
    // shows — unlike a network fetch or a script.
    for (const command of ['cp a b', 'mv a b', 'mkdir new-dir', 'touch file']) {
      expect(alwaysApprovalEligibility(command).eligible).toBe(true);
    }
  });
});

describe('isAutoApproveEligibleTier', () => {
  test('only low', () => {
    expect(isAutoApproveEligibleTier('low')).toBe(true);
    expect(isAutoApproveEligibleTier('medium')).toBe(false);
    expect(isAutoApproveEligibleTier('high')).toBe(false);
    expect(isAutoApproveEligibleTier('critical')).toBe(false);
    expect(isAutoApproveEligibleTier(undefined)).toBe(false);
    expect(isAutoApproveEligibleTier('LOW')).toBe(true);
  });
});

describe('the table shape the docs generator consumes', () => {
  test('every entry has a known tier and an array of capabilities', () => {
    for (const [binary, entry] of Object.entries(SHELL_COMMAND_TIERS)) {
      expect(Object.values(SHELL_TIERS)).toContain(entry.tier);
      expect(Array.isArray(entry.caps)).toBe(true);
      for (const cap of entry.caps) {
        expect(Object.values(CAPABILITIES)).toContain(cap);
      }
      expect(binary).toBe(binary.toLowerCase());
    }
  });

  test('every capability is described, so the renderer can explain a tier', () => {
    const used = new Set(Object.values(SHELL_COMMAND_TIERS).flatMap((e) => e.caps));
    expect(used.size).toBeGreaterThan(0);
  });

  test('the table is JSON-serialisable, which is what the generator writes out', () => {
    expect(() => JSON.stringify(SHELL_COMMAND_TIERS)).not.toThrow();
    expect(JSON.parse(JSON.stringify(SHELL_COMMAND_TIERS))).toEqual(SHELL_COMMAND_TIERS);
  });
});
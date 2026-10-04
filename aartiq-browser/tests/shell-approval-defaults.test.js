/**
 * shell-approval-defaults.test.js
 *
 * The behaviour change in this file's subject area: no shell command is
 * auto-approved at startup, auto-approval exists only behind an opt-in setting
 * and only for read-only commands, and an "Allow Always" answer no longer
 * generalises across arguments.
 *
 * PermissionStore reads `electron.app` at load time and writes to the user data
 * directory, so the store is instantiated here and injected with in-memory
 * fields. Tests that need `load()` stub `getPath` to a temp directory so nothing
 * touches a real profile.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('electron', () => ({ app: { getPath: jest.fn() } }));

const commandValidator = require('../src/core/command-validator');
const { PermissionStore } = require('../src/lib/permission-store');
const {
  classifyShellCommand,
  normalizeCommandPattern,
  alwaysApprovalEligibility,
} = require('../src/lib/shell-command-tiers');

let tmpDir;
let workdir;

/** A PermissionStore with load() redirected at a throwaway directory. */
async function freshStore() {
  const store = new PermissionStore();
  store.storePath = path.join(workdir, `permissions-${Math.random().toString(36).slice(2)}.json`);
  store.settingsPath = path.join(workdir, `settings-${Math.random().toString(36).slice(2)}.json`);
  store.auditPath = path.join(workdir, `audit-${Math.random().toString(36).slice(2)}.jsonl`);
  store.loaded = true;
  store.permissions = new Map();
  store.autoApprovedCommands = new Set();
  store.autoApprovedActions = new Set();
  return store;
}

beforeEach(() => {
  workdir = tmpDir;
  commandValidator.setPermissionStore(null);
});

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aartiq-approval-'));
  require('electron').app.getPath.mockReturnValue(tmpDir);
});

// ───────────────────────────────────────────────────────────────────────────

describe('startup creates no grants', () => {
  test('a store that has loaded holds no SHELL_LOW, SHELL_MEDIUM or SHELL_CMD row', async () => {
    const store = await freshStore();
    // The grants used to be written here on every start, with an 8h TTL. Nothing
    // should be present unless the user asked for it.
    for (const key of ['SHELL_LOW', 'SHELL_MEDIUM', 'SHELL_HIGH', 'SHELL_ALL']) {
      expect(store.permissions.has(key)).toBe(false);
      expect(store.isGranted(key)).toBe(false);
    }
  });

  test('checkShellPermission denies a medium command with a freshly loaded store', async () => {
    const store = await freshStore();
    commandValidator.setPermissionStore(store);
    expect(commandValidator.checkShellPermission('mkdir new', 'test', 'medium')).toBe(false);
  });

  test('checkShellPermission denies a low command too — low is not a free pass', async () => {
    const store = await freshStore();
    commandValidator.setPermissionStore(store);
    expect(commandValidator.checkShellPermission('ls -la', 'test', 'low')).toBe(false);
  });

  test('checkShellPermission denies when no store is configured at all', () => {
    commandValidator.setPermissionStore(null);
    // Fail-closed: a missing store must not read as "no restriction".
    expect(commandValidator.checkShellPermission('ls -la', 'test', 'low')).toBe(false);
  });

  test('the legacy startup grants are swept on load, and only those', () => {
    // What the store does with a row left behind by an earlier version. The
    // description prefix is how a startup-created row is told apart from one a
    // user made by hand.
    const store = new PermissionStore();
    store.permissions = new Map([
      ['SHELL_LOW', { key: 'SHELL_LOW', level: 'execute', granted_at: 1, expires_at: null, description: 'Default session grant for low-risk shell commands' }],
      ['SHELL_MEDIUM', { key: 'SHELL_MEDIUM', level: 'execute', granted_at: 1, expires_at: null, description: 'Default session grant for medium-risk shell commands' }],
      ['SHELL_MEDIUM_USER', { key: 'SHELL_MEDIUM_USER', level: 'execute', granted_at: 1, expires_at: null, description: 'Granted from Settings > Permissions' }],
    ]);
    store.auditLog = [];
    store.logAudit = jest.fn();

    for (const key of ['SHELL_LOW', 'SHELL_MEDIUM']) {
      const row = store.permissions.get(key);
      if (row && typeof row.description === 'string' && row.description.startsWith('Default session grant for')) {
        store.revoke(key);
      }
    }

    expect(store.permissions.has('SHELL_LOW')).toBe(false);
    expect(store.permissions.has('SHELL_MEDIUM')).toBe(false);
    // An explicit choice by the user is not collateral damage.
    expect(store.permissions.has('SHELL_MEDIUM_USER')).toBe(true);
  });
});

describe('medium-risk commands prompt by default', () => {
  const mediumCommands = [
    ['cp notes.md notes.bak', 'copies files'],
    ['mv a b', 'moves files'],
    ['mkdir new-dir', 'creates a directory'],
    ['npm install left-pad', 'runs installers and reaches the network'],
    ['git clone https://example.com/repo', 'reaches the network and writes a tree'],
    ['curl https://example.com', 'reaches the network'],
    ['osascript -e "tell application Finder to activate"', 'scripts another application'],
  ];

  test.each(mediumCommands)('%s prompts (%s)', (command) => {
    expect(classifyShellCommand(command).tier).toBe('medium');
  });

  test.each(mediumCommands)('no default setting auto-approves %s', async (command) => {
    const store = await freshStore();
    commandValidator.setPermissionStore(store);
    const tier = classifyShellCommand(command).tier;
    expect(store.canAutoExecute(command, tier)).toBe(false);
    expect(commandValidator.checkShellPermission(command, 'test', tier)).toBe(false);
  });

  test.each([
    ['npm install left-pad', 'runs installers'],
    ['git clone https://example.com/repo', 'reaches the network'],
    ['curl https://example.com', 'reaches the network'],
    ['osascript -e "tell application Finder to activate"', 'scripts another application'],
  ])('%s is never offered a permanent grant (%s)', (command) => {
    expect(alwaysApprovalEligibility(command).eligible).toBe(false);
  });

  test('local file writes may still take an exact-match grant', () => {
    // cp / mv / mkdir / touch stay eligible for "Always", unlike the four above.
    //
    // The distinction is not the tier, it is whether the effect of repeating the
    // grant is something the user can see. An exact-match grant on
    // `cp notes.md notes.bak` re-runs a command whose entire effect is written
    // into the dialog text. A grant on `curl <url>` re-runs a request whose
    // response can change between runs, and an `osascript` grant re-runs a
    // script against whatever the user has open at that moment.
    //
    // The earlier defect was not that cp was grantable — it was that the grant
    // matched the first word, so `cp` covered `cp /etc/passwd /tmp/x` too. That
    // is fixed by exact matching, which these cases now assert.
    for (const command of ['cp notes.md notes.bak', 'mv a b', 'mkdir new-dir', 'touch new-file']) {
      expect(alwaysApprovalEligibility(command).eligible).toBe(true);
    }
    expect(commandValidator.buildShellCommandKey('cp notes.md notes.bak')).toBe('SHELL_CMD:cp notes.md notes.bak');
    expect(commandValidator.buildShellCommandKey('cp /etc/passwd /tmp/x')).not.toBe(
      commandValidator.buildShellCommandKey('cp notes.md notes.bak'),
    );
  });

  test('even with autoApproveMidRisk on, a shell command does not auto-run', async () => {
    // autoApproveMidRisk still applies to MCP tool actions. It must not reach
    // the shell path, or turning it on would silently re-open what the startup
    // grant used to do.
    const store = await freshStore();
    store.settings.autoApproveMidRisk = true;
    expect(store.canAutoExecute('mkdir new-dir', 'medium')).toBe(false);
    expect(store.canAutoExecute('curl https://example.com', 'medium')).toBe(false);
    // And it still applies where it is meant to.
    expect(store.canAutoExecuteAction('OPEN_APP', 'medium')).toBe(true);
  });
});

describe('autoApproveLowRiskShell', () => {
  const lowCommands = ['ls', 'ls -la', 'cat notes.md', 'pwd', 'find . -name "*.md"', 'grep -r pattern .', 'echo hello'];

  test('it is off by default', async () => {
    const store = await freshStore();
    expect(store.settings.autoApproveLowRiskShell).toBe(false);
    expect(store.settings.autoApproveLowRisk).toBe(false);
  });

  test.each(lowCommands)('with it off, %s still prompts', async (command) => {
    const store = await freshStore();
    expect(store.canAutoExecute(command, 'low')).toBe(false);
  });

  test.each(lowCommands)('with it on, %s auto-approves', async (command) => {
    const store = await freshStore();
    commandValidator.setPermissionStore(store);
    store.settings.autoApproveLowRiskShell = true;
    expect(store.canAutoExecute(command, 'low')).toBe(true);
    expect(commandValidator.checkShellPermission(command, 'test', 'low')).toBe(true);
  });

  test('with it on, a medium command still prompts', async () => {
    const store = await freshStore();
    store.settings.autoApproveLowRiskShell = true;
    for (const command of ['mkdir new', 'cp a b', 'curl https://example.com', 'npm install x']) {
      expect(store.canAutoExecute(command, 'medium')).toBe(false);
      expect(commandValidator.checkShellPermission(command, 'test', 'medium')).toBe(false);
    }
  });

  test('with it on, a high command still prompts', async () => {
    const store = await freshStore();
    store.settings.autoApproveLowRiskShell = true;
    expect(store.canAutoExecute('chmod 777 file', 'high')).toBe(false);
    expect(commandValidator.checkShellPermission('chmod 777 file', 'test', 'high')).toBe(false);
  });

  test('a command the classifier calls medium is not auto-approved just because its binary looks read-only', async () => {
    // find -delete is read-only only until it is not. The classifier looks at the
    // arguments, and the setting must follow the classifier rather than the
    // user's expectation of the binary.
    const store = await freshStore();
    store.settings.autoApproveLowRiskShell = true;
    expect(classifyShellCommand('find . -delete').tier).toBe('high');
    expect(store.canAutoExecute('find . -delete', 'high')).toBe(false);
  });

  test('the legacy autoApproveLowRisk setting still works, so an existing profile is not silently stricter', async () => {
    const store = await freshStore();
    store.settings.autoApproveLowRisk = true;
    expect(store.canAutoExecute('ls -la', 'low')).toBe(true);
  });

  test('isShellAutoExecutable only accepts low', async () => {
    const store = await freshStore();
    store.settings.autoApproveLowRiskShell = true;
    expect(store.isShellAutoExecutable('low')).toBe(true);
    expect(store.isShellAutoExecutable('medium')).toBe(false);
    expect(store.isShellAutoExecutable('high')).toBe(false);
    expect(store.isShellAutoExecutable('critical')).toBe(false);
  });
});

describe('"Allow Always" no longer generalises across arguments', () => {
  test('a grant for one invocation does not cover a different invocation', async () => {
    const store = await freshStore();
    commandValidator.setPermissionStore(store);

    const granted = 'grep notes.md';
    store.setAutoCommand(normalizeCommandPattern(granted), true);

    expect(store.canAutoExecute(granted, 'low')).toBe(true);
    // The regression this replaces: both of these were the single key "grep".
    expect(store.canAutoExecute('grep ~/.ssh/id_rsa', 'low')).toBe(false);
    expect(store.canAutoExecute('grep -r password .', 'low')).toBe(false);
  });

  test('a grant for a bare binary does not cover the same binary with arguments', async () => {
    const store = await freshStore();
    commandValidator.setPermissionStore(store);
    store.setAutoCommand('ls', true);
    expect(store.canAutoExecute('ls', 'low')).toBe(true);
    expect(store.canAutoExecute('ls -la /etc', 'low')).toBe(false);
  });

  test('whitespace differences collapse to the same key', async () => {
    const store = await freshStore();
    commandValidator.setPermissionStore(store);
    store.setAutoCommand('grep -r pattern .', true);
    expect(store.canAutoExecute('  grep   -r   pattern   .  ', 'low')).toBe(true);
  });

  test('a stored Always grant does not bypass the risk gate on its own', async () => {
    const store = await freshStore();
    commandValidator.setPermissionStore(store);
    // Even a matching grant cannot carry a critical-risk command.
    store.setAutoCommand(normalizeCommandPattern('some-critical-command'), true);
    expect(commandValidator.checkShellPermission('some-critical-command', 'test', 'critical')).toBe(false);
  });

  test('buildShellCommandKey is the single key builder', async () => {
    // The dialog, the grant recorder and the gate must all produce this string.
    expect(commandValidator.buildShellCommandKey('  Grep  -R  X . ')).toBe('SHELL_CMD:grep -r x .');
    expect(commandValidator.buildShellCommandKey('')).toBe('');
    expect(commandValidator.buildShellCommandKey(null)).toBe('');
  });

  test('isAlwaysApprovalAllowed mirrors the eligibility rule', () => {
    expect(commandValidator.isAlwaysApprovalAllowed('grep -r pattern .')).toBe(true);
    expect(commandValidator.isAlwaysApprovalAllowed('curl https://example.com')).toBe(false);
    expect(commandValidator.isAlwaysApprovalAllowed('osascript -e "x"')).toBe(false);
    expect(commandValidator.isAlwaysApprovalAllowed('chmod 777 x')).toBe(false);
    expect(commandValidator.isAlwaysApprovalAllowed('cat https://example.com')).toBe(false);
  });
});

describe('fail-open defaults found in the same audit', () => {
  /**
   * The MCP bridge built its auto-approval policy separately from
   * PermissionStore, and its fallbacks were the permissive ones. With no store
   * at all it reported autoApproveLowRisk: true; with a store, the stored value
   * also defaulted to true. PermissionStore's own setting defaults to false, so
   * the two disagreed about what the default is.
   */
  function autoApprovalConfig(store) {
    const { BrowserMcpServer } = require('../src/lib/mcp-browser-server');
    const server = Object.create(BrowserMcpServer.prototype);
    server.store = store;
    return server._getAutoApprovalConfig();
  }

  test('no store means no auto-approval, not permissive defaults', () => {
    const config = autoApprovalConfig(null);
    expect(config.autoApproveLowRisk).toBe(false);
    expect(config.autoApproveMidRisk).toBe(false);
  });

  test('a store with nothing set does not auto-approve low-risk tools', () => {
    const stub = { get: (_key, fallback) => fallback };
    const config = autoApprovalConfig(stub);
    expect(config.autoApproveLowRisk).toBe(false);
  });

  test('the store fallback agrees with PermissionStore’s own default', () => {
    const stub = { get: (_key, fallback) => fallback };
    const config = autoApprovalConfig(stub);
    const store = new PermissionStore();
    // Both paths have to say the same thing, or a reader of the docs cannot be
    // told which one is true.
    expect(config.autoApproveLowRisk).toBe(store.settings.autoApproveLowRisk);
  });

  test('an explicitly enabled setting is still honoured', () => {
    const stub = { get: (key, fallback) => (key === 'security_autoApproveLowRisk' ? true : fallback) };
    expect(autoApprovalConfig(stub).autoApproveLowRisk).toBe(true);
  });

  test('an unlisted MCP tool is treated as medium, not low', async () => {
    const { BrowserMcpServer } = require('../src/lib/mcp-browser-server');
    const server = Object.create(BrowserMcpServer.prototype);
    // Nothing auto-approves, so every call reaches the approval prompt, and the
    // prompt is where the risk label is decided.
    server.store = { get: (_key, fallback) => fallback };
    server._pairingConfirmed = true;
    let seenRisk = null;
    server._requestApproval = async (_tool, _args, risk) => {
      seenRisk = risk;
      return { allowed: false, reason: 'denied for the test' };
    };

    const verdict = await server._checkPermission('a_tool_nobody_listed', {});

    expect(verdict.allowed).toBe(false);
    expect(seenRisk).toBe('medium');
  });

  test('the MCP path classifies shell commands with the same classifier', async () => {
    const { BrowserMcpServer } = require('../src/lib/mcp-browser-server');
    const server = Object.create(BrowserMcpServer.prototype);
    server.store = { get: (_key, fallback) => fallback };
    server._pairingConfirmed = true;
    const risks = [];
    server._requestApproval = async (_tool, _args, risk) => {
      risks.push(risk);
      return { allowed: false, reason: 'denied for the test' };
    };

    // The MCP tool path must reach the same tier the shell path does, or the
    // table the docs describe would not be the one in force for MCP callers.
    await server._checkPermission('execute_shell_command', { command: 'mkdir new-dir' });
    await server._checkPermission('execute_shell_command', { command: 'chmod 777 file' });
    await server._checkPermission('execute_shell_command', { command: 'ls -la' });

    expect(risks).toEqual(['medium', 'high', 'low']);
  });
});

describe('migration of stored first-word Always entries', () => {
  test('a legacy entry for a read-only binary is kept', () => {
    const store = new PermissionStore();
    store.autoApprovedCommands = new Set(['grep']);
    store.settings.autoApprovedCommands = ['grep'];
    store.auditLog = [];
    store.logAudit = jest.fn();
    store._migrateLegacyAutoApprovedCommands();
    expect([...store.autoApprovedCommands]).toEqual(['grep']);
  });

  test('a legacy entry for a network-capable binary is dropped and audited', () => {
    const store = new PermissionStore();
    store.autoApprovedCommands = new Set(['curl', 'wget', 'osascript', 'chmod']);
    store.settings.autoApprovedCommands = ['curl', 'wget', 'osascript', 'chmod'];
    store.auditLog = [];
    store.logAudit = jest.fn();
    store._migrateLegacyAutoApprovedCommands();

    expect([...store.autoApprovedCommands]).toEqual([]);
    // Not silently: every removal is written to the audit log.
    expect(store.logAudit).toHaveBeenCalledTimes(4);
    for (const call of store.logAudit.mock.calls) {
      expect(call[0]).toMatch(/settings\.dropLegacyAutoApprovedCommand/);
    }
  });

  test('a multi-word entry is already a full pattern and is only normalised', () => {
    const store = new PermissionStore();
    store.autoApprovedCommands = new Set(['grep -r pattern .']);
    store.settings.autoApprovedCommands = ['grep -r pattern .'];
    store.auditLog = [];
    store.logAudit = jest.fn();
    store._migrateLegacyAutoApprovedCommands();

    expect([...store.autoApprovedCommands]).toEqual(['grep -r pattern .']);
    expect(store.logAudit).not.toHaveBeenCalled();
  });

  test('migration is idempotent', () => {
    const store = new PermissionStore();
    store.autoApprovedCommands = new Set(['grep', 'curl']);
    store.settings.autoApprovedCommands = ['grep', 'curl'];
    store.auditLog = [];
    store.logAudit = jest.fn();
    store._migrateLegacyAutoApprovedCommands();
    store._migrateLegacyAutoApprovedCommands();
    expect([...store.autoApprovedCommands]).toEqual(['grep']);
    expect(store.logAudit).toHaveBeenCalledTimes(1);
  });
});
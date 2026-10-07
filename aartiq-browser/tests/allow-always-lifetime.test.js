/**
 * allow-always-lifetime.test.js
 *
 * docs-audit/issues/allow-always-granularity.md, gap 2:
 *
 *   "**A grant is permanent, and the world it applies to is not.** A grant
 *    recorded for `grep -r deploy .` keeps applying as the contents of that
 *    directory change… **Give every grant a lifetime** … `PermissionStore.grant`
 *    already supports an `expires_at`; per-command grants currently never set
 *    one."
 *
 * These tests pin the fix: every "Allow Always" grant carries
 * granted_at/expires_at, a legacy string-only grant is given a first lifetime
 * when it is loaded, an expired grant is swept with an audit line and the gate
 * refuses it, and the settings panel can read the lifetimes without being able
 * to rewrite them.
 */

const fs = require('fs');
const path = require('path');
const { PermissionStore } = require('../src/lib/permission-store');
const { ALWAYS_GRANT_TTL_MS } = require('../src/lib/shell-command-tiers');

let workdir;
let seq = 0;

/** A PermissionStore with its three paths redirected at a throwaway directory. */
function makeStore() {
  const store = new PermissionStore();
  const id = `${Date.now()}-${(seq += 1)}`;
  store.storePath = path.join(workdir, `permissions-${id}.json`);
  store.settingsPath = path.join(workdir, `settings-${id}.json`);
  store.auditPath = path.join(workdir, `audit-${id}.jsonl`);
  store.loaded = true;
  store.permissions = new Map();
  store.autoApprovedCommands = new Set();
  store.autoApprovedActions = new Set();
  return store;
}

/** The same store, but load() will actually run against a prepared file. */
function makeUnloadedStore(settingsJson) {
  const store = makeStore();
  fs.writeFileSync(store.settingsPath, JSON.stringify(settingsJson, null, 2));
  store.loaded = false;
  return store;
}

function auditText(store) {
  return fs.existsSync(store.auditPath) ? fs.readFileSync(store.auditPath, 'utf8') : '';
}

beforeEach(() => {
  workdir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'aartiq-grant-lifetime-'));
  jest.restoreAllMocks();
});

afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe('the policy constant', () => {
  test('every Allow Always grant lasts 30 days', () => {
    // Policy lives in shell-command-tiers.js next to the eligibility rule, so
    // the dialog, the grant recorder and the gate read one file.
    expect(ALWAYS_GRANT_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe('granting and revoking', () => {
  test('setAutoCommand writes granted_at/expires_at and persists them', () => {
    const store = makeStore();
    store.setAutoCommand('mkdir build-artifacts', true);

    const key = 'mkdir build-artifacts';
    expect([...store.autoApprovedCommands]).toEqual([key]);

    const record = store.getAutoCommandGrantRecords()[key];
    expect(record.granted_at).toBeGreaterThan(0);
    expect(record.expires_at - record.granted_at).toBe(ALWAYS_GRANT_TTL_MS);

    const onDisk = JSON.parse(fs.readFileSync(store.settingsPath, 'utf8'));
    expect(onDisk.autoApprovedCommandGrants[key]).toEqual(record);
    // The command list itself is unchanged in shape: still plain strings.
    expect(onDisk.autoApprovedCommands).toEqual([key]);
  });

  test('revoking removes the record with the grant', () => {
    const store = makeStore();
    store.setAutoCommand('touch report.txt', true);
    store.setAutoCommand('touch report.txt', false);

    expect(store.autoApprovedCommands.size).toBe(0);
    expect(store.getAutoCommandGrantRecords()).toEqual({});
    const onDisk = JSON.parse(fs.readFileSync(store.settingsPath, 'utf8'));
    expect(onDisk.autoApprovedCommandGrants).toEqual({});
  });

  test('updateSettings (the renderer round-trip) cannot rewrite a grant clock', () => {
    // security-settings-update only forwards whitelisted toggles, and
    // updateSettings spreads — neither path includes the grants map.
    const store = makeStore();
    store.setAutoCommand('cp src dist', true);
    const before = store.getAutoCommandGrantRecords();

    store.updateSettings({ autoApproveLowRisk: true });

    expect(store.getAutoCommandGrantRecords()).toEqual(before);
    expect(store.settings.autoApproveLowRisk).toBe(true);
  });
});

describe('the gate honours the clock', () => {
  test('a live grant auto-executes', () => {
    const store = makeStore();
    store.setAutoCommand('touch report.txt', true);
    expect(store.canAutoExecute('touch report.txt', 'medium')).toBe(true);
  });

  test('a grant that expires mid-session is refused, swept, and audited', () => {
    const store = makeStore();
    store.setAutoCommand('touch report.txt', true);
    store.settings.autoApprovedCommandGrants['touch report.txt'].expires_at = Date.now() - 1;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    expect(store.canAutoExecute('touch report.txt', 'medium')).toBe(false);

    // Swept from the set, the settings array and the records together.
    expect(store.autoApprovedCommands.has('touch report.txt')).toBe(false);
    expect(store.getAutoCommandGrantRecords()).toEqual({});
    expect(JSON.parse(fs.readFileSync(store.settingsPath, 'utf8')).autoApprovedCommands).toEqual([]);
    expect(auditText(store)).toMatch(/settings\.expireAutoApprovedCommand: touch report\.txt/);
    expect(warn).toHaveBeenCalled();
  });

  test('expiry only removes the grant — the opt-in low-tier fallback is untouched', () => {
    const store = makeStore();
    store.setAutoCommand('touch report.txt', true);
    store.settings.autoApprovedCommandGrants['touch report.txt'].expires_at = Date.now() - 1;
    store.settings.autoApproveLowRiskShell = true;

    // The grant is gone (medium never auto-approves), but autoApproveLowRiskShell
    // still answers for low-tier commands exactly as before.
    expect(store.canAutoExecute('touch report.txt', 'medium')).toBe(false);
    expect(store.canAutoExecute('ls -la', 'low')).toBe(true);
  });

  test('a granted key with no record gets a first lifetime instead of vanishing', () => {
    const store = makeStore();
    store.setAutoCommand('grep -r deploy .', true);
    delete store.settings.autoApprovedCommandGrants['grep -r deploy .'];

    expect(store.canAutoExecute('grep -r deploy .', 'medium')).toBe(true);
    const record = store.getAutoCommandGrantRecords()['grep -r deploy .'];
    expect(record.expires_at - record.granted_at).toBe(ALWAYS_GRANT_TTL_MS);
  });
});

describe('migration of grants written before lifetimes existed', () => {
  test('a string-only grant keeps working and gains a full first lifetime', () => {
    const store = makeUnloadedStore({ autoApprovedCommands: ['mkdir build-artifacts'] });
    store.load();

    // The command list keeps its plain strings — every existing consumer of
    // that array is unchanged — and the record map gains the clock.
    expect([...store.autoApprovedCommands]).toEqual(['mkdir build-artifacts']);
    const record = store.getAutoCommandGrantRecords()['mkdir build-artifacts'];
    expect(record.granted_at).toBeGreaterThan(0);
    expect(record.expires_at - record.granted_at).toBe(ALWAYS_GRANT_TTL_MS);

    // Backfilled, so the next load finds it on disk rather than re-dating it.
    const onDisk = JSON.parse(fs.readFileSync(store.settingsPath, 'utf8'));
    expect(onDisk.autoApprovedCommandGrants['mkdir build-artifacts']).toEqual(record);
    expect(auditText(store)).toMatch(/settings\.autoApprovedCommandGrantBackfilled: mkdir build-artifacts/);
  });

  test('an already-expired grant is swept at load with an audit line', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const store = makeUnloadedStore({
      autoApprovedCommands: ['touch stale.txt'],
      autoApprovedCommandGrants: {
        'touch stale.txt': { granted_at: 1, expires_at: 2 },
      },
    });
    store.load();

    expect(store.autoApprovedCommands.size).toBe(0);
    expect(store.getAutoCommandGrantRecords()).toEqual({});
    expect(JSON.parse(fs.readFileSync(store.settingsPath, 'utf8')).autoApprovedCommands).toEqual([]);
    expect(auditText(store)).toMatch(/settings\.expireAutoApprovedCommand: touch stale\.txt/);
    expect(warn).toHaveBeenCalled();
  });

  test('a healthy grant survives the load untouched', () => {
    const record = { granted_at: 1_000, expires_at: Date.now() + 24 * 60 * 60 * 1000 };
    const store = makeUnloadedStore({
      autoApprovedCommands: ['grep -r deploy .'],
      autoApprovedCommandGrants: { 'grep -r deploy .': record },
    });
    store.load();

    expect([...store.autoApprovedCommands]).toEqual(['grep -r deploy .']);
    expect(store.getAutoCommandGrantRecords()['grep -r deploy .']).toEqual(record);
    // Nothing changed, so nothing was rewritten or re-audited.
    expect(auditText(store)).toBe('');
  });

  test('reconcile is idempotent — a second load adds no clock and no audit line', () => {
    const store = makeUnloadedStore({ autoApprovedCommands: ['mkdir build-artifacts'] });
    store.load();
    const first = store.getAutoCommandGrantRecords()['mkdir build-artifacts'];

    store.loaded = false;
    store.load();

    expect(store.getAutoCommandGrantRecords()['mkdir build-artifacts']).toEqual(first);
    const lines = auditText(store).trim().split('\n');
    expect(lines).toHaveLength(1);
  });
});

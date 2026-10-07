/**
 * native-bridge-permissions.test.js
 *
 * The native macOS bridge's /permissions endpoints wrote comet-permissions.json
 * directly, bypassing the loaded PermissionStore:
 *
 *   - the store's Map never saw the grant, so the approval gate ignored it
 *     until a restart, and
 *   - the store's next _save() from any other path wrote its Map over the raw
 *     file and silently dropped the grant it did not contain.
 *
 * The routes now go through `permissionStore.grant/revoke`, and the GET
 * returns the live state. These tests pin: immediate effectiveness, survival
 * across a store save from another path, level validation (fail closed),
 * audit lines, and unchanged route contracts.
 */

const fs = require('fs');
const path = require('path');
const { PermissionStore } = require('../src/lib/permission-store');
const { registerPermissionRoutes } = require('../src/lib/native-bridge-permission-routes');

let workdir;
let seq = 0;

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

/** A fake express app capturing registered handlers by method + path. */
function makeApp() {
  const routes = { GET: {}, POST: {} };
  return {
    routes,
    get: (p, handler) => { routes.GET[p] = handler; },
    post: (p, handler) => { routes.POST[p] = handler; },
  };
}

function fakeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

const GET = '/native-mac-ui/permissions';
const GRANT = '/native-mac-ui/permissions/grant';
const REVOKE = '/native-mac-ui/permissions/revoke';

function auditText(store) {
  return fs.existsSync(store.auditPath) ? fs.readFileSync(store.auditPath, 'utf8') : '';
}

beforeEach(() => {
  workdir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'aartiq-bridge-perm-'));
});

afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe('route registration', () => {
  test('all three routes are registered', () => {
    const app = makeApp();
    registerPermissionRoutes(app, makeStore());
    expect(app.routes.GET[GET]).toEqual(expect.any(Function));
    expect(app.routes.POST[GRANT]).toEqual(expect.any(Function));
    expect(app.routes.POST[REVOKE]).toEqual(expect.any(Function));
  });
});

describe('POST /permissions/grant', () => {
  test('the grant is effective immediately — the gate sees it without a restart', () => {
    const store = makeStore();
    const app = makeApp();
    registerPermissionRoutes(app, store);
    const res = fakeRes();

    app.routes.POST[GRANT]({ body: { key: 'SHELL_CMD:mkdir build', level: 'write', description: 'panel' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ granted: 'SHELL_CMD:mkdir build' });
    // The exact bug: isGranted is what checkShellPermission reads, and the
    // old raw write never reached it.
    expect(store.isGranted('SHELL_CMD:mkdir build')).toBe(true);
    expect(store.permissions.get('SHELL_CMD:mkdir build')).toEqual(
      expect.objectContaining({ level: 'write', description: 'panel', granted_at: expect.any(Number), expires_at: null }),
    );
    expect(auditText(store)).toMatch(/permission\.grant: SHELL_CMD:mkdir build \(write\)/);
  });

  test('the grant survives a save from a different path (the lost-update bug)', () => {
    const store = makeStore();
    const app = makeApp();
    registerPermissionRoutes(app, store);
    app.routes.POST[GRANT]({ body: { key: 'SHELL_CMD:touch report' } }, fakeRes());

    // Any other mutation saves the whole Map — with the raw write, that
    // _save() was what silently dropped the bridge grant from the file.
    store.grant('SHELL_CMD:from-dialog', 'read', 'dialog answer', false);

    const onDisk = JSON.parse(fs.readFileSync(store.storePath, 'utf8'));
    expect(Object.keys(onDisk).sort()).toEqual(['SHELL_CMD:from-dialog', 'SHELL_CMD:touch report']);
    expect(store.isGranted('SHELL_CMD:touch report')).toBe(true);
  });

  test('an invalid level fails closed instead of being stored verbatim', () => {
    const store = makeStore();
    const app = makeApp();
    registerPermissionRoutes(app, store);
    const res = fakeRes();

    app.routes.POST[GRANT]({ body: { key: 'SHELL_CMD:rm -rf ~', level: 'root' } }, res);

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/Invalid permission level/);
    expect(store.isGranted('SHELL_CMD:rm -rf ~')).toBe(false);
    expect(fs.existsSync(store.storePath)).toBe(false); // nothing written
  });

  test('a missing key is a 400, with no write', () => {
    const store = makeStore();
    const app = makeApp();
    registerPermissionRoutes(app, store);
    const res = fakeRes();

    app.routes.POST[GRANT]({ body: {} }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Missing key' });
    expect(fs.existsSync(store.storePath)).toBe(false);
  });

  test('no body at all does not throw', () => {
    const store = makeStore();
    const app = makeApp();
    registerPermissionRoutes(app, store);
    const res = fakeRes();

    app.routes.POST[GRANT]({}, res);
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /permissions/revoke', () => {
  test('revoking removes the grant from Map, file and audit trail', () => {
    const store = makeStore();
    const app = makeApp();
    registerPermissionRoutes(app, store);
    app.routes.POST[GRANT]({ body: { key: 'SHELL_CMD:mkdir build' } }, fakeRes());

    const res = fakeRes();
    app.routes.POST[REVOKE]({ body: { key: 'SHELL_CMD:mkdir build' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ revoked: 'SHELL_CMD:mkdir build' });
    expect(store.isGranted('SHELL_CMD:mkdir build')).toBe(false);
    expect(JSON.parse(fs.readFileSync(store.storePath, 'utf8'))).toEqual({});
    expect(auditText(store)).toMatch(/permission\.revoke: SHELL_CMD:mkdir build/);
  });

  test('a missing key is a 400', () => {
    const app = makeApp();
    registerPermissionRoutes(app, makeStore());
    const res = fakeRes();
    app.routes.POST[REVOKE]({}, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Missing key' });
  });
});

describe('GET /permissions', () => {
  test('returns the live store state, not a file snapshot', () => {
    const store = makeStore();
    const app = makeApp();
    registerPermissionRoutes(app, store);
    app.routes.POST[GRANT]({ body: { key: 'SHELL_CMD:grep -r deploy .', level: 'read', description: 'panel' } }, fakeRes());
    store.settings.autoApproveLowRisk = true;

    const res = fakeRes();
    app.routes.GET[GET]({}, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.permissions['SHELL_CMD:grep -r deploy .']).toEqual(
      expect.objectContaining({ level: 'read', granted_at: expect.any(Number) }),
    );
    expect(res.body.securitySettings).toEqual(expect.objectContaining({ autoApproveLowRisk: true }));
    // A grant made directly in the dialog (the other writer) is visible too —
    // both directions of the old file/Map split are gone.
    store.grant('SHELL_CMD:from-dialog', 'read', 'dialog answer', false);
    const res2 = fakeRes();
    app.routes.GET[GET]({}, res2);
    expect(res2.body.permissions['SHELL_CMD:from-dialog']).toEqual(expect.any(Object));
  });
});

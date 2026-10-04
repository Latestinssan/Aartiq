/**
 * permission-store-system-root.test.js
 *
 * M12 of the docs/source audit: addAllowedDirectory accepted anything —
 * including `/`, `/dev` and `/etc` — so one settings entry could hand the
 * sandbox a recursive read-write grant over the whole machine. The docs half
 * was fixed earlier (the security page states the live defaults and labels
 * the app-data + temp default as tests-only); this is the code half:
 * system roots are refused at the door.
 *
 * The rule is exact-match on the roots themselves: `/`, the POSIX system
 * directories, and Windows drive roots / Windows system directories. A path
 * UNDER a root (`/etc/aartiq`) is still accepted — the audit's verdict was
 * "reject system roots", and a prefix ban would be a wider behaviour change
 * than the verdict asked for. The boundary test below is the line to change
 * if the maintainer wants the tighter rule.
 *
 * Seeded defaults are unaffected: they are written into settings directly,
 * never through add().
 *
 * Mutation record: docs-audit/mutation-check-system-roots.txt.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('electron', () => ({ app: { getPath: jest.fn() } }));

const { PermissionStore } = require('../src/lib/permission-store');

let workdir;

function freshStore() {
  const store = new PermissionStore();
  store.settingsPath = path.join(workdir, `settings-${Math.random().toString(36).slice(2)}.json`);
  store.auditPath = path.join(workdir, `audit-${Math.random().toString(36).slice(2)}.jsonl`);
  store.loaded = true;
  store.permissions = new Map();
  store.autoApprovedCommands = new Set();
  store.autoApprovedActions = new Set();
  return store;
}

beforeAll(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'aartiq-roots-'));
  require('electron').app.getPath.mockReturnValue(workdir);
});

afterAll(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe('M12 — addAllowedDirectory refuses system roots', () => {
  test('the filesystem root is rejected, not allowlisted', () => {
    const store = freshStore();
    const before = store.settings.allowedDirectories.length;
    expect(store.addAllowedDirectory('/')).toBe(false);
    expect(store.settings.allowedDirectories.length).toBe(before);
  });

  test.each(['/etc', '/dev', '/System', '/Library', '/usr', '/var', '/proc'])(
    'system root %s is rejected',
    (p) => {
      const store = freshStore();
      expect(store.addAllowedDirectory(p)).toBe(false);
      expect(store.settings.allowedDirectories.some((d) => d.path === path.resolve(p))).toBe(false);
    },
  );

  test('a trailing slash does not smuggle a root past the check', () => {
    const store = freshStore();
    expect(store.addAllowedDirectory('/etc/')).toBe(false);
    expect(store.addAllowedDirectory('//')).toBe(false);
  });

  test('a normal directory is still accepted', () => {
    const store = freshStore();
    expect(store.addAllowedDirectory('/Users/tester/projects/aartiq-notes')).toBe(true);
    expect(
      store.settings.allowedDirectories.some(
        (d) => d.path === '/Users/tester/projects/aartiq-notes',
      ),
    ).toBe(true);
  });

  test('boundary: a path under a root is not a root (exact-match rule, see header)', () => {
    const store = freshStore();
    expect(store.addAllowedDirectory('/etc/aartiq')).toBe(true);
  });

  test('a rejection is written to the audit trail', () => {
    const store = freshStore();
    store.addAllowedDirectory('/');
    const audit = fs.readFileSync(store.auditPath, 'utf8');
    expect(audit).toMatch(/directory-allowlist\.add\.rejected system-root/);
  });
});

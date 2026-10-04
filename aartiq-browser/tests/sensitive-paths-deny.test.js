/**
 * sensitive-paths-deny.test.js
 *
 * Tests for Issue 2: Default directory allowlist narrowing & sensitive-path deny list.
 * - Single dedicated workspace folder + temp directory default
 * - Sensitive paths explicitly denied even if parent directory allowed
 * - Symlink bypass to sensitive paths is denied (realpath resolution)
 * - addAllowedDirectory rejects sensitive paths and defaults to read-only
 * - Existing users with broad grants keep them with a one-time migration warning
 * - narrowBroadGrants narrows broad grants to dedicated workspace + temp
 * - Sandbox profile generation enforces deny list
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

jest.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
}));

const {
  isPathAllowed,
  isSensitivePath,
  canonicalizePath,
  DEFAULT_ALLOWED_DIRECTORIES,
  DEFAULT_WORKSPACE_PATH,
  getSensitiveDirectories,
} = require('../src/core/directory-allowlist');

const {
  generateSeatbeltProfile,
  validateAllowlist,
} = require('../src/core/sandbox-executor');

const { PermissionStore } = require('../src/lib/permission-store');

describe('Issue 2: Sensitive-path deny list and directory narrowing', () => {
  describe('Default allowlist reconciliation', () => {
    it('seeds only dedicated workspace and temp directory by default', () => {
      assert.strictEqual(DEFAULT_ALLOWED_DIRECTORIES.length, 2);
      assert.strictEqual(DEFAULT_ALLOWED_DIRECTORIES[0].path, DEFAULT_WORKSPACE_PATH);
      assert.ok(
        DEFAULT_ALLOWED_DIRECTORIES[1].path === '/tmp' ||
        DEFAULT_ALLOWED_DIRECTORIES[1].path === os.tmpdir()
      );
      // Home, Desktop, Documents, Downloads are NOT in defaults
      const paths = DEFAULT_ALLOWED_DIRECTORIES.map((d) => d.path);
      assert.ok(!paths.includes(os.homedir()));
      assert.ok(!paths.includes(path.join(os.homedir(), 'Desktop')));
      assert.ok(!paths.includes(path.join(os.homedir(), 'Documents')));
      assert.ok(!paths.includes(path.join(os.homedir(), 'Downloads')));
    });

    it('PermissionStore uses reconciled defaults', () => {
      const store = new PermissionStore();
      const defaultDirs = store.settings.allowedDirectories;
      assert.strictEqual(defaultDirs.length, 2);
      assert.strictEqual(defaultDirs[0].path, DEFAULT_WORKSPACE_PATH);
    });
  });

  describe('Sensitive-path detection and denial', () => {
    // Broad allowlist granting full home directory
    const broadAllowlist = [
      { path: os.homedir(), recursive: true, access: 'read-write', grantedAt: Date.now() },
      { path: '/tmp', recursive: true, access: 'read-write', grantedAt: Date.now() },
    ];

    it('denies ~/.ssh even when home is allowlisted', () => {
      const sshKey = path.join(os.homedir(), '.ssh', 'id_rsa');
      const res = isPathAllowed(sshKey, broadAllowlist, 'read');
      assert.strictEqual(res.allowed, false);
      assert.strictEqual(res.isSensitive, true);
    });

    it('denies ~/.aws credentials even when home is allowlisted', () => {
      const awsCreds = path.join(os.homedir(), '.aws', 'credentials');
      const res = isPathAllowed(awsCreds, broadAllowlist, 'read');
      assert.strictEqual(res.allowed, false);
      assert.strictEqual(res.isSensitive, true);
    });

    it('denies ~/.gnupg and ~/.gpg keys even when home is allowlisted', () => {
      const gpgKey = path.join(os.homedir(), '.gnupg', 'secring.gpg');
      const res = isPathAllowed(gpgKey, broadAllowlist, 'read');
      assert.strictEqual(res.allowed, false);
      assert.strictEqual(res.isSensitive, true);
    });

    it('denies cloud and cluster credentials (~/.config/gcloud, ~/.azure, ~/.kube)', () => {
      const gcloud = path.join(os.homedir(), '.config', 'gcloud', 'credentials.db');
      const azure = path.join(os.homedir(), '.azure', 'tokens.json');
      const kube = path.join(os.homedir(), '.kube', 'config');

      assert.strictEqual(isPathAllowed(gcloud, broadAllowlist, 'read').allowed, false);
      assert.strictEqual(isPathAllowed(azure, broadAllowlist, 'read').allowed, false);
      assert.strictEqual(isPathAllowed(kube, broadAllowlist, 'read').allowed, false);
    });

    it('denies shell history files (.bash_history, .zsh_history)', () => {
      const bashHist = path.join(os.homedir(), '.bash_history');
      const zshHist = path.join(os.homedir(), '.zsh_history');

      assert.strictEqual(isPathAllowed(bashHist, broadAllowlist, 'read').allowed, false);
      assert.strictEqual(isPathAllowed(zshHist, broadAllowlist, 'read').allowed, false);
    });

    it('denies .env files even within an allowed workspace directory', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-test-'));
      try {
        const workspaceAllowlist = [
          { path: tmpDir, recursive: true, access: 'read-write', grantedAt: Date.now() },
        ];
        const envFile = path.join(tmpDir, '.env');
        const envProd = path.join(tmpDir, '.env.production');
        fs.writeFileSync(envFile, 'SECRET_KEY=12345');
        fs.writeFileSync(envProd, 'API_KEY=abcdef');

        assert.strictEqual(isPathAllowed(envFile, workspaceAllowlist, 'read').allowed, false);
        assert.strictEqual(isPathAllowed(envProd, workspaceAllowlist, 'read').allowed, false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('denies access via symlink pointing to sensitive path (realpath resolution)', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'symlink-test-'));
      try {
        const workspaceAllowlist = [
          { path: tmpDir, recursive: true, access: 'read-write', grantedAt: Date.now() },
        ];

        // Create symlink pointing to ~/.ssh
        const linkPath = path.join(tmpDir, 'link-to-ssh');
        const sshTarget = path.join(os.homedir(), '.ssh');
        try {
          fs.symlinkSync(sshTarget, linkPath);
        } catch (e) {
          // If symlink creation not permitted in environment, skip
          return;
        }

        const probeFile = path.join(linkPath, 'id_rsa');
        const res = isPathAllowed(probeFile, workspaceAllowlist, 'read');
        assert.strictEqual(res.allowed, false, 'Symlink traversal to sensitive target must be denied');
        assert.strictEqual(res.isSensitive, true);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('PermissionStore addAllowedDirectory validation and defaults', () => {
    let tmpDir;
    let store;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-test-'));
      store = new PermissionStore();
      store.storePath = path.join(tmpDir, 'comet-permissions.json');
      store.settingsPath = path.join(tmpDir, 'comet-security-settings.json');
      store.auditPath = path.join(tmpDir, 'aartiq-audit.jsonl');
      store.loaded = true;
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('rejects adding sensitive paths to allowlist', () => {
      const sshPath = path.join(os.homedir(), '.ssh');
      const added = store.addAllowedDirectory(sshPath);
      assert.strictEqual(added, false);
    });

    it('defaults new directories to read-only access when not specified', () => {
      const subDir = path.join(tmpDir, 'new-folder');
      fs.mkdirSync(subDir);
      const added = store.addAllowedDirectory(subDir);
      assert.strictEqual(added, true);

      const dirs = store.getAllowedDirectories();
      const entry = dirs.find((d) => path.resolve(d.path) === path.resolve(subDir));
      assert.ok(entry);
      assert.strictEqual(entry.access, 'read');
    });

    it('allows read-write only when explicitly requested', () => {
      const subDir = path.join(tmpDir, 'rw-folder');
      fs.mkdirSync(subDir);
      const added = store.addAllowedDirectory(subDir, { access: 'read-write' });
      assert.strictEqual(added, true);

      const dirs = store.getAllowedDirectories();
      const entry = dirs.find((d) => path.resolve(d.path) === path.resolve(subDir));
      assert.ok(entry);
      assert.strictEqual(entry.access, 'read-write');
    });
  });

  describe('Migration: broad grants warning and narrowing', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('shows warning for existing broad grants and keeps them until user narrows', async () => {
      // Simulate existing user settings with broad grants
      const oldSettings = {
        allowedDirectories: [
          { path: os.homedir(), recursive: true, access: 'read-write' },
          { path: path.join(os.homedir(), 'Documents'), recursive: true, access: 'read-write' },
          { path: '/tmp', recursive: true, access: 'read-write' },
        ],
      };
      const settingsPath = path.join(tmpDir, 'comet-security-settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify(oldSettings));

      const store = new PermissionStore();
      store.storePath = path.join(tmpDir, 'comet-permissions.json');
      store.settingsPath = settingsPath;
      store.auditPath = path.join(tmpDir, 'aartiq-audit.jsonl');

      await store.load();

      // Existing grants kept
      const warning = store.getBroadGrantWarning();
      assert.ok(warning);
      assert.ok(warning.broadGrants.length >= 1);
      assert.strictEqual(store.settings.allowedDirectories.length, 3);

      // User chooses to narrow broad grants
      store.narrowBroadGrants();

      // Broad grants removed, default workspace kept
      assert.strictEqual(store.getBroadGrantWarning(), null);
      const paths = store.settings.allowedDirectories.map((d) => d.path);
      assert.ok(!paths.includes(os.homedir()));
      assert.ok(!paths.includes(path.join(os.homedir(), 'Documents')));
      assert.ok(paths.includes(DEFAULT_WORKSPACE_PATH));
    });
  });

  describe('OS Sandbox profile enforcement of sensitive deny list', () => {
    it('generateSeatbeltProfile includes explicit deny blocks for sensitive directories', () => {
      const profile = generateSeatbeltProfile({
        directoryAllowlist: [{ path: os.homedir(), access: 'read-write' }],
      });
      assert.ok(profile.includes('(deny file-read*'));
      assert.ok(profile.includes('(deny file-write*'));
      assert.ok(profile.includes('.ssh'));
      assert.ok(profile.includes('.aws'));
      assert.ok(profile.includes('.gnupg'));
    });

    it('validateAllowlist rejects sensitive directory entries', () => {
      assert.throws(() => {
        validateAllowlist([{ path: path.join(os.homedir(), '.ssh') }]);
      }, (err) => err.code === 'SANDBOX_POLICY_INVALID' && /sensitive/i.test(err.message));
    });
  });
});

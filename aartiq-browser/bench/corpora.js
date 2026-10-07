'use strict';
/**
 * Deterministic input corpora for the security hot-path benchmarks.
 *
 * Literal values only — no RNG, no dates, no machine-specific state in the
 * command/path lists — so every run, on every machine, measures the same
 * work. The few runtime-derived values (repo root, home, tmpdir) only pin the
 * *location* of real directories; they do not change what the functions do
 * with them. See ../BENCHMARKS.md for the protocol.
 */

const os = require('os');
const path = require('path');

/** aartiq-browser/ regardless of the caller's cwd (npm run bench, jest, CI). */
const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * Command lines for classifyShellCommand / normalizeCommandPattern /
 * alwaysApprovalEligibility / canAutoExecute. Covers every tier in the
 * classifier table, the destructive and URL rules, script/network-capable
 * binaries, unknown binaries, quoting, env prefixes, chains, pipes, and the
 * empty-string edge — i.e. every branch the dialog and the gate can take.
 */
const COMMANDS = [
  // low / ordinary file work
  'ls -la',
  'mkdir -p build/nested/output',
  'grep -rn "deploy" .',
  'cat notes.md',
  'echo hello > out.txt',
  'cp src/index.ts src/index.ts.bak',
  'mv a.txt b.txt',
  'touch bench/.keep',
  'find . -name "*.test.js" -type f',
  'wc -l README.md',
  'sort -u data.txt',
  'head -20 server.log',
  'pwd && whoami',
  'df -h',
  'which node',
  'env | sort',
  // version control / known tooling
  'git status',
  'git log --oneline -10',
  'git diff --stat',
  'git push origin main && git tag v1.2.3',
  'node scripts/check.js',
  'npm run build',
  'npm install',
  'npx tsc --noEmit',
  // network-capable (never low, never Allow Always)
  'curl https://example.com/api',
  'curl -X POST http://127.0.0.1:46203/sync -d @payload.json',
  'curl --header "Authorization: Bearer x" https://api.internal/v1',
  'wget https://example.com/file.tar.gz',
  'pip install requests --index-url https://pypi.org/simple',
  'ssh deploy@10.0.0.5 "systemctl status"',
  'rsync -avz ./build/ user@host:/srv/app/',
  // script-capable
  'python3 -m http.server 8080',
  'osascript -e \'tell app "Finder" to activate\'',
  // destructive (raised tier, no Allow Always)
  'rm -rf build/cache',
  'rm important-backup.tar',
  'chmod 777 /tmp/shared',
  'sudo systemctl restart nginx',
  'dd if=/dev/zero of=/dev/sda bs=1M',
  'mkfs.ext4 /dev/sdb1',
  'iptables -F',
  // archives / misc
  'tar -czf backup.tgz src/',
  'unzip -q release.zip -d ./out',
  'systemctl status nginx',
  'ps aux | grep node',
  // unknown / unclassified binaries (medium by default, Allow Once only)
  'unknown-tool --flag value',
  'foo.bar-baz --x',
  // edge shapes
  '"quoted binary" --run',
  'PATH=/opt/bin:$PATH service restart',
  '  chmod 644 config.json  ',
  'mkdir build &&   touch build/.keep',
  '',
];

/**
 * Paths for canonicalizePath / isPathAllowed. Deliberate mix:
 *   - `~` expansion and dot-segments (string work),
 *   - real directories that exist on every checkout (realpath syscalls),
 *   - paths whose parent does and does not exist (the two fallbacks),
 *   - sensitive credential locations (always-denied branch),
 *   - paths inside and outside the allowlist (match and miss).
 */
const PATHS = [
  '~/notes/todo.md',
  '~/projects/app/src/index.js',
  '~/projects/app/../app/./src/component.tsx',
  '~/.ssh/id_ed25519',
  '~/.ssh/config',
  '~/.aws/credentials',
  '~/.gnupg/pubring.kbx',
  '~/.aartiq-bench/reports/q3.csv',
  '~/.aartiq-bench/scratch/tmp.bin',
  path.join(REPO_ROOT, 'bench', 'run.js'), // exists → realpath
  path.join(REPO_ROOT, 'bench', 'not-yet-written.js'), // parent exists
  path.join(REPO_ROOT, 'build', 'missing', 'nested', 'out.js'), // parent missing
  path.join(REPO_ROOT, 'src', 'lib', 'permission-store.js'),
  path.join(REPO_ROOT, 'tests', '..', 'package.json'),
  path.join(os.tmpdir(), 'aartiq-bench', 'artifact.txt'),
  path.join(os.tmpdir(), 'other-app', 'data.db'),
  './relative/path/child.txt',
  './',
  'plain-file.md',
  path.join('/usr', 'local', 'share', 'doc', 'readme.txt'),
  path.join('/var', 'tmp', 'x'),
  path.join('/opt', 'app', 'data', 'db.sqlite'),
  // deep nesting — exercises the prefix walk
  Array.from({ length: 12 }, (_, i) => `seg${i}`).join(path.sep) + path.sep + 'deep.txt',
];

/**
 * The allowlist checked against PATHS: real directories (realpath on every
 * call), a non-recursive entry, a read-only entry, a sensitive entry (denied
 * regardless of membership), and one that does not exist (normalize fallback).
 */
const ALLOWLIST = [
  { path: REPO_ROOT, recursive: true, access: 'read-write', grantedAt: 0, grantedVia: 'bench' },
  { path: path.join(REPO_ROOT, 'src'), recursive: true, access: 'read-write', grantedAt: 0, grantedVia: 'bench' },
  { path: path.join(REPO_ROOT, 'bench'), recursive: false, access: 'read-write', grantedAt: 0, grantedVia: 'bench' },
  { path: os.tmpdir(), recursive: true, access: 'read-write', grantedAt: 0, grantedVia: 'bench' },
  { path: path.join(REPO_ROOT, 'tests'), recursive: true, access: 'read', grantedAt: 0, grantedVia: 'bench' },
  { path: path.join(os.homedir(), 'projects'), recursive: true, access: 'read-write', grantedAt: 0, grantedVia: 'bench' },
  { path: path.join(os.homedir(), '.aartiq-bench'), recursive: true, access: 'read-write', grantedAt: 0, grantedVia: 'bench' },
  { path: path.join(os.homedir(), 'nonexistent-bench-dir'), recursive: true, access: 'read-write', grantedAt: 0, grantedVia: 'bench' },
  { path: path.join(os.homedir(), '.ssh'), recursive: true, access: 'read-write', grantedAt: 0, grantedVia: 'bench' },
  { path: path.join('/usr', 'local', 'share'), recursive: true, access: 'read-write', grantedAt: 0, grantedVia: 'bench' },
];

/**
 * A valid request through checkLocalRequest: loopback Host, app Origin
 * (matches DEFAULT_ALLOWED_ORIGIN_PATTERNS), a well-formed 64-hex token in
 * the Authorization header, and a loopback socket address. Every call walks
 * Host → Origin → lockout map → URL parse → extractToken → timingSafeEqual →
 * clear — the full accept path of the per-request gate.
 */
const AUTH_TOKEN = '6f1c2b3a4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8';

const authOptions = {
  port: 3001,
  token: AUTH_TOKEN,
  requireToken: true,
  allowRemote: false,
  remoteHosts: [],
  service: 'bench',
};

function makeAuthRequest() {
  return {
    method: 'GET',
    url: '/api/state',
    headers: {
      host: '127.0.0.1:3001',
      origin: 'http://localhost:3003',
      authorization: `Bearer ${AUTH_TOKEN}`,
    },
    socket: { remoteAddress: '127.0.0.1' },
  };
}

/** Fixed PIN/salt for the KDF benches — same bytes every run. */
const KDF_PIN = '135790';
const KDF_SALT = Buffer.from('aartiq-bench-salt-v1', 'utf8');

module.exports = {
  REPO_ROOT,
  COMMANDS,
  PATHS,
  ALLOWLIST,
  AUTH_TOKEN,
  authOptions,
  makeAuthRequest,
  KDF_PIN,
  KDF_SALT,
};

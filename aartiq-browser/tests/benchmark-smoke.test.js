/**
 * benchmark-smoke.test.js — the harness must run and be self-consistent.
 *
 * The benchmarks themselves are NOT a CI gate: absolute timings are
 * machine-dependent and must never fail a build. What is gated is that
 *
 *   - `node bench/run.js --quick` executes end-to-end (exit 0),
 *   - every expected benchmark is present and produced well-formed timings
 *     (the runner also throws on malformed results — exit 0 implies the
 *     observed === calls guards held),
 *   - the environment block is captured,
 *   - the PBKDF2 numbers are plausible floors: 600 000 SHA-256 iterations
 *     cannot finish in under 5 ms on any real CPU, so a floor of 5 ms proves
 *     the KDF bench actually did the documented work rather than short-
 *     circuiting,
 *   - and the cheap gates are cheaper than the KDF — a sanity ordering.
 *
 * See BENCHMARKS.md for how to run and compare real numbers.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BENCH_RUNNER = path.join(__dirname, '..', 'bench', 'run.js');

const EXPECTED_RESULTS = [
  'shell-classify',
  'always-eligibility',
  'grant-gate',
  'path-allowlist',
  'auth-gate',
  'kdf-pbkdf2-600k-sha256',
  'kdf-masterpin-100k-sha256',
];

let output;

beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aartiq-bench-smoke-'));
  const jsonPath = path.join(dir, 'results.json');
  const proc = spawnSync(
    process.execPath,
    [BENCH_RUNNER, '--quick', '--json', jsonPath],
    { encoding: 'utf8', timeout: 25000 },
  );
  output = {
    status: proc.status,
    stdout: proc.stdout || '',
    stderr: proc.stderr || '',
    json: fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, 'utf8')) : null,
  };
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the runner completes in quick mode', () => {
  expect(output.stderr).toBe('');
  expect(output.status).toBe(0);
  expect(output.stdout).toContain('Aartiq security hot-path benchmarks');
  expect(output.json).not.toBeNull();
});

test('every benchmark is present, in order, with valid timings', () => {
  const { meta, results } = output.json;
  expect(results.map((r) => r.name)).toEqual(EXPECTED_RESULTS);

  for (const r of results) {
    expect(r.itersPerRep).toBeGreaterThanOrEqual(1);
    expect(r.reps).toBe(meta.reps);
    expect(meta.reps).toBeGreaterThanOrEqual(3); // median of 3+ is meaningful
    expect(r.samplesNsPerOp).toHaveLength(r.reps);
    for (const s of r.samplesNsPerOp) {
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBeGreaterThan(0);
    }
    expect(Number.isFinite(r.medianNsPerOp)).toBe(true);
    expect(r.medianNsPerOp).toBeGreaterThan(0);
    expect(r.medianOpsPerSec).toBeGreaterThan(0);
    expect(r.spreadPct).toBeGreaterThanOrEqual(0);
    expect(r.what.length).toBeGreaterThan(10);
    expect(r.source.length).toBeGreaterThan(3);
  }
});

test('the environment block is captured next to the numbers', () => {
  const meta = output.json.meta;
  expect(meta.quick).toBe(true);
  expect(meta.node).toBe(process.version);
  expect(meta.platform).toBe(process.platform);
  expect(meta.arch).toBe(process.arch);
  expect(meta.cpu.length).toBeGreaterThan(0);
  expect(meta.cpuCount).toBeGreaterThanOrEqual(1);
  expect(Number.isFinite(Date.parse(meta.date))).toBe(true);
});

test('the KDF benches did their documented work (plausible floors)', () => {
  const byName = Object.fromEntries(output.json.results.map((r) => [r.name, r]));
  // 600 000 SHA-256 PBKDF2 cannot run in under 5 ms on real hardware — a
  // result below the floor would mean the bench short-circuited.
  expect(byName['kdf-pbkdf2-600k-sha256'].medianNsPerOp).toBeGreaterThan(5e6);
  expect(byName['kdf-masterpin-100k-sha256'].medianNsPerOp).toBeGreaterThan(5e5);
  // …and every other gate must be orders of magnitude cheaper.
  for (const name of ['shell-classify', 'always-eligibility', 'grant-gate', 'auth-gate']) {
    expect(byName[name].medianNsPerOp).toBeLessThan(byName['kdf-masterpin-100k-sha256'].medianNsPerOp);
  }
});

test('--only rejects unknown benchmark names instead of silently measuring nothing', () => {
  const proc = spawnSync(
    process.execPath,
    [BENCH_RUNNER, '--quick', '--only', 'does-not-exist'],
    { encoding: 'utf8', timeout: 10000 },
  );
  expect(proc.status).toBe(1);
  expect(proc.stderr).toContain('unknown benchmark');
});

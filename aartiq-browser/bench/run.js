#!/usr/bin/env node
'use strict';
/**
 * bench/run.js — reproducible micro-benchmarks for the security-critical hot
 * paths: the shell classifier, the Allow Always eligibility rule, the grant
 * gate, the directory allowlist, the per-request auth gate, and the PBKDF2
 * cost the docs promise.
 *
 * Protocol (the part that makes runs comparable):
 *   1. Fixed corpora — bench/corpora.js is literal, no RNG, no dates.
 *   2. Warmup — a discarded prefix so JIT and caches are settled.
 *   3. R measured repetitions of N iterations each, timed with
 *      process.hrtime.bigint(); median/min/max/spread are reported. Compare
 *      medians, read spread as the noise bar.
 *   4. Guards — every call's result is structurally validated; a malformed
 *      result or a non-positive/non-finite timing fails the run outright.
 *   5. Environment — node/v8/platform/arch/CPU are captured next to the
 *      numbers, because absolute figures are only meaningful on the machine
 *      that produced them.
 *
 * Usage:
 *   npm run bench                 full run (~6s)
 *   npm run bench -- --quick      reduced iterations (~1s; used by CI smoke)
 *   npm run bench -- --json out.json
 *   npm run bench -- --only auth-gate,path-allowlist
 *   npm run bench -- --reps 9
 *
 * See BENCHMARKS.md for interpretation and comparison rules.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const {
  classifyShellCommand,
  normalizeCommandPattern,
  alwaysApprovalEligibility,
  ALWAYS_GRANT_TTL_MS,
} = require('../src/lib/shell-command-tiers');
const { isPathAllowed } = require('../src/core/directory-allowlist');
const { checkLocalRequest } = require('../src/lib/local-server-auth');
const { MasterPINService } = require('../src/lib/MasterPINService');
const { PermissionStore } = require('../src/lib/permission-store');
const corpora = require('./corpora');

const DEFAULT_REPS = 5;
const QUICK_REPS = 3;
const QUICK_SCALE = 1 / 50;

/** Parse argv into options. Unknown flags fail loudly — silent typos in a
 *  measurement tool are worse than an error. */
function parseArgs(argv) {
  const opts = { quick: false, reps: null, json: null, only: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--quick':
        opts.quick = true;
        break;
      case '--reps':
        opts.reps = Number(argv[++i]);
        if (!Number.isInteger(opts.reps) || opts.reps < 1) throw new Error('--reps expects a positive integer');
        break;
      case '--json':
        opts.json = argv[++i];
        if (!opts.json) throw new Error('--json expects a file path');
        break;
      case '--only':
        opts.only = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
        if (!opts.only.length) throw new Error('--only expects a comma-separated benchmark name');
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        throw new Error(`unknown flag: ${arg} (see --help)`);
    }
  }
  return opts;
}

/**
 * Build the seven benchmarks. `observe` turns each result into 1 (well-formed)
 * or anything else; the runner requires observed === calls, so a gate that
 * starts returning garbage fails the run instead of timing as "faster".
 */
function buildBenches() {
  // A real PermissionStore, file paths pointed at a throwaway directory so
  // nothing touches the user's actual grants, then grants injected in exactly
  // the shape canAutoExecute reads: normalized key in the Set + a
  // {granted_at, expires_at} record with a *future numeric* expires_at (a
  // missing/non-numeric one triggers the legacy backfill + settings save on
  // every lookup, which would both poison the timing and write files).
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'aartiq-bench-store-'));
  const store = new PermissionStore();
  store.storePath = path.join(scratch, 'permissions.json');
  store.settingsPath = path.join(scratch, 'settings.json');
  store.auditPath = path.join(scratch, 'audit.jsonl');
  store.permissions = new Map();
  store.autoApprovedCommands = new Set();
  store.autoApprovedActions = new Set();
  if (!store.settings.autoApprovedCommandGrants) store.settings.autoApprovedCommandGrants = {};
  const grantedAt = Date.now();
  const expiresAt = grantedAt + ALWAYS_GRANT_TTL_MS;
  corpora.COMMANDS.forEach((cmd, i) => {
    if (i % 2 !== 0) return; // half granted, half not → both gate paths timed
    const key = normalizeCommandPattern(cmd);
    store.autoApprovedCommands.add(key);
    store.settings.autoApprovedCommandGrants[key] = { granted_at: grantedAt, expires_at: expiresAt };
  });

  const N_COMMANDS = corpora.COMMANDS.length;
  const N_PATHS = corpora.PATHS.length;
  const opsPerRead = (i) => i & 1 ? 'write' : 'read';

  const benches = [
    {
      name: 'shell-classify',
      what: 'classifyShellCommand — tier + capability/URL/destructive rules for one command line',
      source: 'src/lib/shell-command-tiers.js',
      iters: 5000,
      run: (i) => classifyShellCommand(corpora.COMMANDS[i % N_COMMANDS]),
      observe: (r) => (r && typeof r.tier === 'string' && typeof r.known === 'boolean' ? 1 : 0),
    },
    {
      name: 'always-eligibility',
      what: 'alwaysApprovalEligibility — may "Allow Always" be offered, and why not',
      source: 'src/lib/shell-command-tiers.js',
      iters: 10000,
      run: (i) => alwaysApprovalEligibility(corpora.COMMANDS[i % N_COMMANDS]),
      observe: (r) => (r && typeof r.eligible === 'boolean' ? 1 : 0),
    },
    {
      name: 'grant-gate',
      what: 'normalizeCommandPattern + canAutoExecute — the auto-approve lookup (half granted, half not)',
      source: 'src/lib/permission-store.js',
      iters: 10000,
      run: (i) => {
        const cmd = corpora.COMMANDS[i % N_COMMANDS];
        return store.canAutoExecute(cmd, 'medium');
      },
      observe: (r) => (typeof r === 'boolean' ? 1 : 0),
    },
    {
      name: 'path-allowlist',
      what: 'isPathAllowed — canonicalize (realpath) + sensitive deny + allowlist walk',
      source: 'src/core/directory-allowlist.js',
      iters: 3000,
      run: (i) => isPathAllowed(
        corpora.PATHS[i % N_PATHS],
        corpora.ALLOWLIST,
        opsPerRead(i),
      ),
      observe: (r) => (r && typeof r.allowed === 'boolean' ? 1 : 0),
    },
    {
      name: 'auth-gate',
      what: 'checkLocalRequest — Host, Origin, lockout map, URL parse, constant-time token compare',
      source: 'src/lib/local-server-auth.js',
      iters: 20000,
      run: () => checkLocalRequest(makeAuthOnce(), corpora.authOptions),
      observe: (r) => (r && r.ok === true && r.service === 'bench' ? 1 : 0),
    },
    {
      name: 'kdf-pbkdf2-600k-sha256',
      what: 'PBKDF2 600 000 iterations, SHA-256 — the cost the E2EE docs claim (Documentation.tsx, crypto-utils)',
      source: 'node:crypto (documented parameters)',
      iters: 2,
      warmup: 1,
      run: () => crypto.pbkdf2Sync(corpora.KDF_PIN, corpora.KDF_SALT, 600000, 32, 'sha256'),
      observe: (r) => (r && Buffer.isBuffer(r) && r.length === 32 ? 1 : 0),
    },
    {
      name: 'kdf-masterpin-100k-sha256',
      what: 'MasterPINService.hashPin — PBKDF2 100 000 iterations, SHA-256 (unlock path, matches Flutter)',
      source: 'src/lib/MasterPINService.js',
      iters: 5,
      warmup: 1,
      run: () => MasterPINService.hashPin(corpora.KDF_PIN, corpora.KDF_SALT),
      observe: (r) => (typeof r === 'string' && r.length === 64 ? 1 : 0),
    },
  ];

  // One request object reused: checkLocalRequest reads it without mutation on
  // the accept path, so rebuilding it per call would time allocation instead
  // of the gate. Keep it alive across runs.
  let authReq = null;
  function makeAuthOnce() {
    if (!authReq) authReq = corpora.makeAuthRequest();
    return authReq;
  }

  return { benches, cleanup: () => fs.rmSync(scratch, { recursive: true, force: true }) };
}

function median(sorted) {
  return sorted[Math.floor(sorted.length / 2)];
}

function measure(bench, { reps, scale }) {
  const iters = Math.max(1, Math.round(bench.iters * scale));
  const warmupOps = Math.max(1, Math.min(iters, bench.warmup || 500));

  let observed = 0;
  for (let i = 0; i < warmupOps; i++) observed += bench.observe(bench.run(i));

  const samples = [];
  for (let r = 0; r < reps; r++) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < iters; i++) observed += bench.observe(bench.run(i));
    const t1 = process.hrtime.bigint();
    const nsPerOp = Number(t1 - t0) / iters;
    if (!Number.isFinite(nsPerOp) || nsPerOp <= 0) {
      throw new Error(`${bench.name}: non-positive timing (${nsPerOp}) — clock or harness broken`);
    }
    samples.push(nsPerOp);
  }

  const expected = warmupOps + iters * reps;
  if (observed !== expected) {
    throw new Error(
      `${bench.name}: ${observed}/${expected} calls returned a malformed result — ` +
      'the gate under measurement is not behaving as designed',
    );
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const med = median(sorted);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  return {
    name: bench.name,
    what: bench.what,
    source: bench.source,
    itersPerRep: iters,
    reps,
    warmupOps,
    samplesNsPerOp: samples,
    medianNsPerOp: med,
    minNsPerOp: min,
    maxNsPerOp: max,
    spreadPct: ((max - min) / med) * 100,
    medianOpsPerSec: 1e9 / med,
  };
}

function envInfo() {
  const cpus = os.cpus();
  return {
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    cpu: cpus.length ? cpus[0].model.trim() : 'unknown',
    cpuCount: cpus.length,
    totalMemBytes: os.totalmem(),
  };
}

function fmtNs(ns) {
  if (ns >= 1e6) return `${(ns / 1e6).toFixed(2)} ms`;
  if (ns >= 1e3) return `${(ns / 1e3).toFixed(2)} µs`;
  return `${ns.toFixed(1)} ns`;
}

function fmtOps(ops) {
  if (ops >= 1000) return `${Math.round(ops).toLocaleString('en-US')}/s`;
  return `${ops.toFixed(1)}/s`;
}

function pad(s, n) {
  return String(s).padEnd(n);
}
function padL(s, n) {
  return String(s).padStart(n);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(
      'Usage: node bench/run.js [--quick] [--reps N] [--json <path>] [--only <name,...>]\n' +
      'See BENCHMARKS.md for the protocol.\n',
    );
    return 0;
  }

  const reps = opts.reps || (opts.quick ? QUICK_REPS : DEFAULT_REPS);
  const scale = opts.quick ? QUICK_SCALE : 1;

  const { benches, cleanup } = buildBenches();
  let selected = benches;
  if (opts.only) {
    const known = new Set(benches.map((b) => b.name));
    const unknown = opts.only.filter((n) => !known.has(n));
    if (unknown.length) throw new Error(`unknown benchmark(s): ${unknown.join(', ')} — known: ${[...known].join(', ')}`);
    selected = benches.filter((b) => opts.only.includes(b.name));
  }

  try {
    const results = selected.map((b) => measure(b, { reps, scale }));
    const meta = {
      date: new Date().toISOString(),
      quick: !!opts.quick,
      reps,
      scale,
      ...envInfo(),
    };

    const w = { name: 24, iters: 8, reps: 5, med: 14, ops: 12, minmax: 24, spread: 8 };
    const line = (cells) => process.stdout.write(
      pad(cells[0], w.name) + padL(cells[1], w.iters) + padL(cells[2], w.reps) +
      padL(cells[3], w.med) + padL(cells[4], w.ops) + padL(cells[5], w.minmax) + padL(cells[6], w.spread) + '\n',
    );

    process.stdout.write(`Aartiq security hot-path benchmarks — ${meta.date}\n`);
    process.stdout.write(
      `env: node ${meta.node} (v8 ${meta.v8}), ${meta.platform} ${meta.arch}, ` +
      `${meta.cpu} ×${meta.cpuCount}${opts.quick ? ', quick mode' : ''}\n\n`,
    );
    line(['bench', 'iters', 'reps', 'median', 'rate', 'min–max', 'spread']);
    for (const r of results) {
      line([
        r.name,
        r.itersPerRep,
        r.reps,
        fmtNs(r.medianNsPerOp),
        fmtOps(r.medianOpsPerSec),
        `${fmtNs(r.minNsPerOp)}–${fmtNs(r.maxNsPerOp)}`,
        `${r.spreadPct.toFixed(1)}%`,
      ]);
    }
    process.stdout.write('\nPer-benchmark detail:\n');
    for (const r of results) {
      process.stdout.write(`  ${r.name}\n    ${r.what}\n    ${r.source}\n`);
    }
    process.stdout.write('\nCompare medians on the same machine; spread is the noise bar. See BENCHMARKS.md.\n');

    if (opts.json) {
      const out = path.resolve(process.cwd(), opts.json);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, `${JSON.stringify({ meta, results }, null, 2)}\n`);
      process.stdout.write(`JSON written: ${out}\n`);
    }
    return 0;
  } finally {
    cleanup();
  }
}

try {
  process.exitCode = main();
} catch (err) {
  process.stderr.write(`bench failed: ${err && err.message ? err.message : err}\n`);
  process.exitCode = 1;
}

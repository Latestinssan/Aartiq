# Reproducible benchmarks — the security-critical hot paths

Micro-benchmarks for the code that runs on **every** command, file path and
local HTTP request the app gates. They exist to answer two questions honestly:

1. *What does the security check actually cost per call?* — so a future
   change that makes a gate 10× slower is visible, and a change that makes it
   cheaper is provable.
2. *Do the documented cost claims reproduce on real hardware?* — the E2EE
   docs promise PBKDF2 with 600 000 iterations; the `kdf-*` benchmarks run
   exactly those parameters so anyone can check the claim in seconds.

## What is measured

| Benchmark | Source | Why it is hot |
| --- | --- | --- |
| `shell-classify` | `src/lib/shell-command-tiers.js` | `classifyShellCommand` runs once per shell command before any approval decision (tier, destructive, URL, capabilities). |
| `always-eligibility` | `src/lib/shell-command-tiers.js` | `alwaysApprovalEligibility` decides whether the dialog may offer *Allow Always* at all — the allow-list rule from `allow-always-granularity`. |
| `grant-gate` | `src/lib/permission-store.js` | `normalizeCommandPattern` + `canAutoExecute`: the lookup that lets a granted command run without the dialog. The store is preloaded so half the corpus hits a live grant and half misses — both paths are timed. |
| `path-allowlist` | `src/core/directory-allowlist.js` | `isPathAllowed` canonicalizes with `realpath` (system calls), applies the always-deny sensitive-path rule, then walks the allowlist with read/write separation. |
| `auth-gate` | `src/lib/local-server-auth.js` | `checkLocalRequest` is the per-request gate on the three local listeners: Host (DNS-rebinding defense), Origin allow-list, failed-auth lockout map, URL parse, constant-time token compare. |
| `kdf-pbkdf2-600k-sha256` | documented parameters (`Documentation.tsx`, `crypto-utils.ts`, `system-handlers.js`) | The documented cost of the current E2EE scheme: PBKDF2-SHA-256, 600 000 iterations. |
| `kdf-masterpin-100k-sha256` | `src/lib/MasterPINService.js` | `hashPin` — the Master PIN unlock path (PBKDF2-SHA-256, 100 000 iterations, matches Flutter). |

## Running

```bash
npm run bench                 # full protocol: warmup + 5 reps (~3 s here)
npm run bench -- --quick      # reduced iterations (~1 s; what CI smoke runs)
npm run bench -- --reps 9     # more repetitions for a tighter median
npm run bench -- --only auth-gate,path-allowlist
npm run bench -- --json results.json
```

Run it **inside `aartiq-browser/`**. Node 24 (the version CI uses) recommended.

## The protocol — what makes runs comparable

1. **Fixed corpora.** `bench/corpora.js` is literal: 51 command lines
   covering every classifier tier and dialog rule, 23 paths covering
   `~`-expansion, dot-segments, sensitive locations, real and missing
   directories, and a 10-entry allowlist. No RNG, no dates — every machine
   measures the same work.
2. **Warmup, then N reps.** A discarded warmup prefix settles the JIT, then
   5 repetitions of N iterations are timed with `process.hrtime.bigint()`.
3. **Median, min–max, spread.** Compare **medians**; `spread` (min–max ÷
   median) is the noise bar for that run. A spread above ~10 % on the
   sub-microsecond benches usually means the machine was busy.
4. **Guards.** Every result is structurally validated — observed must equal
   calls — and a non-positive or non-finite timing fails the run. A gate that
   starts returning garbage slows the benchmark *down*; it cannot fail it
   quietly.
5. **Environment capture.** `node`/`v8`/`platform`/`arch`/CPU model and
   count are printed with the numbers and written into the JSON, because
   absolute figures are only meaningful together with the machine that
   produced them.

## Comparing runs (before/after a change)

```bash
npm run bench -- --json before.json   # on the old revision
npm run bench -- --json after.json    # on the new revision
```

Rules that keep the comparison honest:

- **Same machine, same Node, same power state.** Compare across machines and
  you are comparing CPUs.
- **Compare medians, not single samples.** Look at `spreadPct`; if the two
  runs' medians differ by less than their spreads, you measured noise.
- **Run full mode, not `--quick`.** Quick mode exists for CI smoke and has
  correspondingly wider spreads.
- **The KDF benches are the exception to "faster is better".** Their cost is
  the security parameter: a *lower* `kdf-*` number means the documented work
  got cheaper somewhere — check you did not silently reduce iterations.

## What is deliberately *not* a gate

CI (`tests/benchmark-smoke.test.js`) runs `--quick` and asserts only that the
harness works: all seven benches present, timings positive and finite,
environment captured, the PBKDF2 floors plausible (600 k iterations cannot
finish under 5 ms), the cheap gates cheaper than the KDF, and `--only`
rejecting unknown names. **No absolute timing threshold is ever asserted** —
CI runners are too variable, and a timing-based CI gate would be flaky by
construction. Real numbers are for humans comparing runs, per the rules above.

## Extending

Add a corpus to `bench/corpora.js` (literal values only), a bench entry in
`buildBenches()` in `bench/run.js` with `name`/`what`/`source`/`iters`/`run`/
`observe`, and add the name to `EXPECTED_RESULTS` in
`tests/benchmark-smoke.test.js` so the suite fails until the new bench is
wired in. Pick `iters` so one rep is roughly 10–200 ms: small enough that the
full run stays a few seconds, large enough that `hrtime` noise is a rounding
error.

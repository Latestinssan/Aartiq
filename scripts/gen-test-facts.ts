/**
 * gen-test-facts.ts — generate the test facts that every published page reads.
 *
 * Runs the full suite with jest's JSON reporter and writes
 *   Aartiq-Landing-Page/src/data/test-facts.generated.json
 *
 * Why this exists: the same commit produces a different passed/skipped split on
 * different platforms (ubuntu 537/40, macOS 551/26 of 577 declared). A hand-typed
 * number is therefore wrong for someone on every run. Generate it instead.
 *
 * Also counts COMMAND_REGISTRY rather than letting anyone type a command count.
 *
 * Usage:
 *   node scripts/gen-test-facts.ts                 # run jest, then write
 *   node scripts/gen-test-facts.ts --from <file>   # reuse an existing jest JSON
 *   node scripts/gen-test-facts.ts --ci-artifact <runId>  # pull a CI log summary
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import os from "node:os";
import type { GeneratedTestFacts } from "../../Aartiq-Landing-Page/src/data/project-facts.ts";

const REPO = join(import.meta.dirname, "..");
const BROWSER = join(REPO, "aartiq-browser");
/**
 * The landing page is a separate repository that normally sits beside this one.
 * `AARTIQ_LANDING_DIR` overrides that, so a worktree writes its facts into the
 * tree it was pointed at instead of into whatever sits beside the worktree.
 * See the same note in scripts/gen-repo-facts.ts.
 */
const LANDING = process.env.AARTIQ_LANDING_DIR ?? join(REPO, "..", "Aartiq-Landing-Page");
const LANDING_DATA = join(LANDING, "src", "data");

// ---------------------------------------------------------------------------
// Skip-reason classification
//
// Every skipped test must land in exactly one bucket, and the bucket records the
// file + the evidence that put it there. If we cannot explain a skip, it is
// reported as "unclassified" rather than quietly folded into a total — an
// unexplained skip is a documentation defect, not a rounding error.
// ---------------------------------------------------------------------------

interface Rule {
  id: string;
  label: string;
  /** Returns evidence text if this rule explains the suite's skips. */
  match: (ctx: SkipCtx) => string | null;
}

interface SkipCtx {
  suite: string;
  source: string;
  platform: NodeJS.Platform;
}

const readSource = (absPath: string): string => {
  try {
    return existsSync(absPath) ? readFileSync(absPath, "utf8") : "";
  } catch {
    return "";
  }
};

/** Suites that only mean anything on one OS. */
const PLATFORM_SUITES: Record<string, NodeJS.Platform[]> = {
  "windows-job-sandbox": ["win32"],
  "linux-bwrap-sandbox": ["linux"],
};

const RULES: Rule[] = [
  {
    id: "crx3-verifier",
    label: "CRX3 signature-verifier bug",
    match: ({ suite, source }) => {
      if (!suite.includes("crx-verifier")) return null;
      // Evidence: the suite is disabled wholesale and the file says why.
      if (!/describe\.skip/.test(source)) return null;
      const comment = source.match(/\/\*\*?([\s\S]*?)\*\/\s*describe\.skip/);
      const why = (comment?.[1] ?? "").replace(/\s+/g, " ").trim();
      return why
        ? `src/tests/${suite}.test.ts — describe.skip. Reason in file: "${why.slice(0, 160)}"`
        : `src/tests/${suite}.test.ts — describe.skip`;
    },
  },
  {
    id: "missing-native-tooling",
    label: "Missing native OS-automation tooling",
    match: ({ suite, source }) => {
      // Only matches a suite that registers its tests conditionally on tooling.
      if (!/itWhenAvailable|automationAvailable|hasNativeTool/.test(source)) return null;
      const names = [...source.matchAll(/\b(xdotool|xte|cliclick)\b/g)].map((m) => m[1]);
      const tools = [...new Set(names)];
      const comment = source.match(/\/\/([\s\S]*?)\nconst itWhenAvailable/);
      const why = (comment?.[1] ?? "").replace(/\s+/g, " ").trim();
      return `${suite} — tests registered via itWhenAvailable, skipped when the backend is absent` +
        (tools.length ? ` (looks for ${tools.join(", ")})` : "") +
        (why ? `. Reason in file: "${why.slice(0, 160)}"` : "");
    },
  },
  {
    id: "platform-skipped",
    label: "Platform-skipped",
    match: ({ suite, platform }) => {
      const wanted = PLATFORM_SUITES[suite];
      if (!wanted) return null;
      if (wanted.includes(platform)) {
        return `${suite} targets ${wanted.join("/")} but the suite is still skipping — investigate`;
      }
      return `${suite} requires ${wanted.join(" or ")}; generated on ${platform}`;
    },
  },
];

function classify(ctx: SkipCtx): { reason: string; detail: string } {
  for (const rule of RULES) {
    const detail = rule.match(ctx);
    if (detail) return { reason: rule.label, detail };
  }
  return {
    reason: "UNCLASSIFIED — investigate and add a rule",
    detail: `${ctx.suite}: skipped for a reason this script cannot explain`,
  };
}

// ---------------------------------------------------------------------------
// COMMAND_REGISTRY count
// ---------------------------------------------------------------------------

/**
 * Counts top-level keys of the COMMAND_REGISTRY object literal. The literal is a
 * flat `{ KEY: { desc, example } }` with one key per line, so counting the lines
 * that open a top-level key is exact. If the shape ever changes this throws
 * rather than reporting a wrong number.
 */
function countCommandRegistry(): { count: number; source: string } {
  const file = join(BROWSER, "src", "lib", "AICommandParser.ts");
  const src = readFileSync(file, "utf8");
  const start = src.indexOf("export const COMMAND_REGISTRY = {");
  if (start === -1) throw new Error("COMMAND_REGISTRY not found in AICommandParser.ts");
  const open = src.indexOf("{", start);
  // Walk braces so nested `{ desc: ..., example: ... }` values do not confuse us.
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error("could not find the end of COMMAND_REGISTRY");
  const body = src.slice(open + 1, end);

  const keys = new Set<string>();
  for (const line of body.split("\n")) {
    // Each entry is a single line, so anything anchored to the start of a line is
    // a top-level key. Indentation is not assumed — it has already changed once.
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*):\s*\{/);
    if (m) keys.add(m[1]);
  }
  if (keys.size === 0) {
    throw new Error(
      "COMMAND_REGISTRY parsed as 0 keys — its shape changed. Update countCommandRegistry() rather than publishing 0.",
    );
  }
  return {
    count: keys.size,
    source: "src/lib/AICommandParser.ts — COMMAND_REGISTRY",
  };
}

// ---------------------------------------------------------------------------
// Obtain the jest JSON
// ---------------------------------------------------------------------------

function runJest(outFile: string) {
  console.log(`> jest --json --outputFile=${outFile}`);
  const res = spawnSync(
    "npx",
    ["jest", "--ci", "--runInBand", "--forceExit", "--json", `--outputFile=${outFile}`],
    {
      cwd: BROWSER,
      // Deliberately no NODE_OPTIONS: --experimental-vm-modules changed how
      // jest resolves react-markdown's ESM entry, so the default export arrived
      // as a namespace object and the SSR tests in tests/markdown-render,
      // tests/citation-links and tests/file-paths failed under this generator
      // while CI — plain `npx jest` — passed them. Node 24.9+ require()s the
      // ESM-only transitive deps synchronously (see the comment in
      // .github/workflows/jest.yml), so keep this invocation identical to CI's.
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    },
  );
  // Jest exits non-zero when tests fail; the JSON is still the useful artefact.
  const combined = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const m = combined.match(/^Tests:\s+.*$/m);
  if (m) console.log(`  ${m[0].trim()}`);
  const s = combined.match(/^Test Suites:\s+.*$/m);
  if (s) console.log(`  ${s[0].trim()}`);
  if (!existsSync(outFile)) {
    console.error(combined.slice(-4000));
    throw new Error(`jest produced no JSON at ${outFile}`);
  }
  return outFile;
}

function fetchCiArtifact(runId: string): string {
  const outFile = join(tmpdir(), `aartiq-jest-ci-${runId}.json`);
  console.log(`> gh api run ${runId} (per-job logs)`);
  const jobsRes = spawnSync(
    "gh",
    ["api", `repos/Latestinssan/Aartiq/actions/runs/${runId}/jobs`, "--jq", ".jobs[].id"],
    { encoding: "utf8" },
  );
  if (jobsRes.status !== 0) throw new Error("gh api jobs failed — is gh installed and authenticated?");
  const ids = (jobsRes.stdout ?? "").trim().split("\n").filter(Boolean);
  if (!ids.length) throw new Error(`no jobs found for run ${runId}`);
  // Fold every job's summary into one aggregate report.
  const merged = { testResults: [], numTotalTestSuites: 0, numPassedTestSuites: 0, numFailedTestSuites: 0, numPendingTestSuites: 0, numTotalTests: 0, numPassedTests: 0, numFailedTests: 0, numPendingTests: 0 };
  for (const id of ids) {
    const log = spawnSync(
      "gh",
      ["api", "--allow-escape-sequences", `repos/Latestinssan/Aartiq/actions/jobs/${id}/logs`],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    const text = log.stdout ?? "";
    const t = text.match(/Tests:\s+(\d+) skipped,\s+(\d+) passed,\s+(\d+) failed,\s+(\d+) total/);
    if (!t) continue;
    const [, skipped, passed, failed, total] = t.map(Number);
    merged.numPendingTests += skipped;
    merged.numPassedTests += passed;
    merged.numFailedTests += failed;
    merged.numTotalTests += total;
    merged.testResults.push({ name: `ci-job-${id}`, status: failed ? "failed" : "passed", assertionResults: [], _ci: { passed, skipped, failed, total } });
  }
  writeFileSync(outFile, JSON.stringify(merged, null, 2));
  return outFile;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const fromIdx = argv.indexOf("--from");
  const ciIdx = argv.indexOf("--ci-artifact");

  const jsonPath =
    fromIdx !== -1
      ? argv[fromIdx + 1]
      : ciIdx !== -1
        ? fetchCiArtifact(argv[ciIdx + 1])
        : runJest(join(tmpdir(), `aartiq-jest-${Date.now()}.json`));

  const raw = JSON.parse(readFileSync(jsonPath, "utf8"));
  const platform = process.platform;

  // ---- per-suite + totals -------------------------------------------------
  const perSuite = raw.testResults
    .map((t: any) => {
      const suite = basename(String(t.name)).replace(/\.test\.(js|ts)$/, "");
      const results: any[] = t.assertionResults ?? [];
      let passed = 0;
      let skipped = 0;
      let failed = 0;
      for (const a of results) {
        if (a.status === "passed") passed++;
        else if (a.status === "failed") failed++;
        else skipped++;
      }
      // A CI job contributes its summary but carries no individual test records.
      if (t._ci) ({ passed, skipped, failed } = t._ci);
      return { suite, passed, skipped, failed, declared: results.length || passed + skipped + failed, _path: String(t.name) };
    })
    .sort((a: any, b: any) => b.declared - a.declared || a.suite.localeCompare(b.suite));

  const totals = perSuite.reduce(
    (acc: any, s: any) => ({
      declared: acc.declared + s.declared,
      passed: acc.passed + s.passed,
      skipped: acc.skipped + s.skipped,
      failed: acc.failed + s.failed,
    }),
    { declared: 0, passed: 0, skipped: 0, failed: 0 },
  );

  // ---- skip breakdown, with reasons --------------------------------------
  const buckets = new Map<string, { count: number; details: Set<string> }>();
  for (const s of perSuite) {
    if (!s.skipped) continue;
    const suiteFile = existsSync(s._path) ? s._path : join(BROWSER, "tests", `${s.suite}.test.js`);
    const { reason, detail } = classify({
      suite: s.suite,
      source: readSource(suiteFile),
      platform,
    });
    const b = buckets.get(reason) ?? { count: 0, details: new Set<string>() };
    b.count += s.skipped;
    b.details.add(detail);
    buckets.set(reason, b);
  }
  const skipBreakdown = [...buckets.entries()]
    .map(([reason, b]) => ({
      reason,
      count: b.count,
      // Semicolons, never pipes — a pipe is a markdown table cell separator and
      // would silently split this string across columns when rendered.
      detail: [...b.details].sort().join("; "),
    }))
    .sort((a, b) => b.count - a.count);

  const registry = countCommandRegistry();

  const facts: GeneratedTestFacts = {
    generatedAt: new Date().toISOString(),
    environment: {
      os: `${os.type()} ${os.release()}`,
      platform,
      arch: process.arch,
      node: process.versions.node,
      label:
        platform === "darwin" ? "macOS (local)" : platform === "linux" ? "Linux (local)" : `${platform} (local)`,
    },
    suites: {
      total: raw.numTotalTestSuites ?? perSuite.length,
      passed: raw.numPassedTestSuites ?? 0,
      failed: raw.numFailedTestSuites ?? 0,
      skipped: raw.numPendingTestSuites ?? 0,
    },
    tests: totals,
    skipBreakdown,
    perSuite: perSuite.map(({ _path, ...rest }: any) => rest),
    commandCount: registry.count,
    commandCountSource: registry.source,
  };

  mkdirSync(LANDING_DATA, { recursive: true });
  const out = join(LANDING_DATA, "test-facts.generated.json");
  writeFileSync(out, JSON.stringify(facts, null, 2) + "\n");

  console.log(`\nWrote ${out}`);
  console.log(`  ${facts.tests.passed} passed / ${facts.tests.skipped} skipped / ${facts.tests.failed} failed of ${facts.tests.declared} declared`);
  console.log(`  environment: ${facts.environment.label}`);
  console.log(`  commandCount: ${facts.commandCount} (${facts.commandCountSource})`);
  console.log("  skip reasons:");
  for (const s of skipBreakdown) console.log(`    ${String(s.count).padStart(4)}  ${s.reason}`);

  const unclassified = skipBreakdown.find((s) => s.reason.startsWith("UNCLASSIFIED"));
  if (unclassified) {
    console.warn(`\n! ${unclassified.count} skip(s) could not be explained — published pages will show this as unexplained.`);
  }
  const drift = totals.passed + totals.skipped + totals.failed - totals.declared;
  if (drift !== 0) {
    console.warn(`! passed+skipped+failed (${totals.passed + totals.skipped + totals.failed}) != declared (${totals.declared})`);
  }
}

main();

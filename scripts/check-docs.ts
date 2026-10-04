/**
 * check-docs.ts — `npm run docs:check`. Fails when the docs have drifted.
 *
 * (a) every README `<!-- SSOT:START name -->` block differs from generated output
 * (b) a hard-coded literal of a tracked fact appears outside the SSOT / generated files
 * (c) the benchmark version is behind the current version without the
 *     "benchmarked on vX" label next to the figures
 * (d) an internal documentation link points at something that does not exist
 * (e) a risk-tier table disagrees between README and the landing site
 * (f) a file in `public/` shadows an app route, so the route never reaches users
 * (g) a distribution claim names an artifact, store or listing the build does not produce
 *
 * Exit code 1 on any failure. Warnings print but do not fail the build.
 */

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, relative, resolve, dirname, extname } from "node:path";
import {
  version,
  benchmarks,
  security,
  legal,
  network,
  ci,
  platforms,
  type SecurityLayer,
} from "../../Aartiq-Landing-Page/src/data/project-facts.ts";

const REPO = join(import.meta.dirname, "..");
const LANDING = join(REPO, "..", "Aartiq-Landing-Page");

// Keep this identical to the renderers in sync-docs.ts. Rather than importing them
// (they are not exported), we run sync in check mode — see README_CHECK below.
const problems: string[] = [];
const warnings: string[] = [];

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "out", ".vercel", ".turbo",
  "__pycache__", "coverage", "builds", "Pods", "target", ".dart_tool",
]);

function walk(root: string, exts?: string[]): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (SKIP_DIRS.has(name) || name.startsWith(".")) {
        // Exception: tracked dotfiles are rare, but never descend into skip dirs.
        if (SKIP_DIRS.has(name)) continue;
        if (name.startsWith(".") && name !== ".github") continue;
      }
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) stack.push(full);
      else if (!exts || exts.includes(extname(full))) out.push(full);
    }
  }
  return out;
}

const rel = (p: string) => relative(join(REPO, ".."), p).replace(/\\/g, "/");
const relInRepo = (p: string) => relative(REPO, p).replace(/\\/g, "/");

/**
 * Blank the body of every generated SSOT block while preserving line count.
 *
 * Content inside a block is produced by sync-docs.ts from the SSOT, so scanning it
 * for hard-coded literals would just be scanning the SSOT with extra steps. What we
 * actually want is everything a human typed between the markers — i.e. outside them.
 */
function blankGeneratedBlocks(text: string): string {
  // Replace every non-newline character with a space: line count AND byte length
  // both stay exactly the same, so offsets computed from the blanked text still
  // line up with the original file when we ask "is this position inside a code
  // sample?".
  return text.replace(/<!-- SSOT:START [^>]+ -->[\s\S]*?<!-- SSOT:END [^>]+ -->/g, (block) =>
    block.replace(/[^\n]/g, " "),
  );
}

// ---------------------------------------------------------------------------
// Exempt locations
//
// Facts may appear where they ARE the fact (the SSOT and generated output), where
// they are the SOURCE of the fact (product code), or where they are a HISTORICAL
// RECORD of a past state (release notes). Everything else is a claim that must be
// generated or imported rather than typed.
// ---------------------------------------------------------------------------

function isExempt(file: string): boolean {
  const p = relInRepo(file);
  const landingRel = relative(LANDING, file).replace(/\\/g, "/");

  // The SSOT itself, and everything it imports.
  if (p.startsWith("Landing_Page/")) {
    // release-notes.ts is a historical record; the .md files are live docs and stay in scope.
    return p.endsWith("release-notes.ts");
  }
  if (landingRel.startsWith("src/data/")) return true;
  // The generator scripts and the checker itself necessarily contain the values.
  if (p.startsWith("scripts/")) return true;
  if (p === "package.json") return true;
  // The audit is allowed to quote every value it is auditing.
  if (p.endsWith("docs-audit/consistency-report.md")) return true;
  // Product code is the source of the fact, not a claim about it, and is out of scope.
  if (p.startsWith("aartiq-browser/")) return true;
  if (p.startsWith("aartiq-mcp/") || p.startsWith("flutter_browser_app/")) return true;
  // CI definitions carry their own ports and counts.
  if (p.startsWith(".github/")) return true;
  // HISTORICAL RECORD: release notes describe the state at that release. Rewriting
  // a past release note's numbers would falsify the record, so they are exempt.
  if (p.startsWith("release_notes/")) return true;
  if (landingRel.startsWith("src/lib/release-notes.ts")) return true;
  // Same reasoning for dated audit reports: "Before (0.3.6) → After (0.3.7)" is a
  // record of a change, not a claim about today's version.
  if (p.includes("Audit Report/")) return true;
  return false;
}

// ---------------------------------------------------------------------------
// (b) tracked literals
// ---------------------------------------------------------------------------

interface Literal {
  label: string;
  pattern: RegExp;
  /** Why a bare number isn't enough, for the harder ones. */
  why: string;
  /**
   * The line must ALSO match this. Used where the raw string appears in ordinary,
   * unrelated code too — `127.0.0.1` in an OAuth redirect handler is not a claim
   * about how a server binds, but `binds to 127.0.0.1` is.
   */
  claimContext?: RegExp;
}

const LITERALS: Literal[] = [
  // Test counts — the numbers this whole effort exists to stop people typing.
  { label: "537", pattern: /\b537\b/, why: "ubuntu CI passing count — must come from test-facts.generated.json" },
  { label: "577", pattern: /\b577\b/, why: "declared test count — must come from test-facts.generated.json" },
  { label: "551 (passing count)", pattern: /\b551 (?:passed|passing)/i, why: "macOS passing count — must come from test-facts.generated.json" },
  { label: "CI run id", pattern: /\b34769503518\b/, why: "latest run id — must come from the ci block" },
  // Ports are network facts.
  { label: "port 3001", pattern: /\b3001\b/, why: "MCP bridge port — from network.servers" },
  { label: "port 3003", pattern: /\b3003\b/, why: "Next.js dev port — from network.devRenderer" },
  { label: "port 3004", pattern: /\b3004\b/, why: "WiFi sync port — from network.servers" },
  { label: "port 46203", pattern: /\b46203\b/, why: "native bridge / agent-api port — from network.servers" },
  { label: "port 3999", pattern: /\b3999\b/, why: "background service port — from network.servers" },
  { label: "port 3005", pattern: /\b3005\b/, why: "UDP discovery destination — from network.servers" },
  // Bind address.
  { label: "0.0.0.0", pattern: /\b0\.0\.0\.0\b/, why: "bind address — a security claim, from network.servers" },
  {
    label: "127.0.0.1 bind claim",
    pattern: /\b127\.0\.0\.1\b/,
    why: "bind address — a security claim, from network.servers",
    // Loopback shows up in unrelated code (OAuth redirect validation, etc). Only
    // flag it where the line is actually making a claim about listening/binding.
    claimContext: /\b(bind|bound|binding|listen|listening|loopback|expos\w*|interface|external|stack|host)\b/i,
  },
  // Version strings. A mention that agrees with the SSOT is fine; one that
  // disagrees is the stale-version bug this rule exists to catch, and is always
  // an error. Major versions are capped at two digits so Chromium-style
  // identifiers (126.0.6478.57) are not mistaken for release tags.
  { label: "version string", pattern: /\bv?\d{1,2}\.\d+\.\d+\b/, why: "a project release other than the current one" },
  // Layer-count claims. Only unqualified assertions are flagged; historical phrasing
  // such as "expanded from 3 layers to 6 layers" is in exempt release notes.
  { label: "three-layer security claim", pattern: /three[- ]layers?|\b3[- ]layers?\b/i, why: "the model has had six layers since v0.3.5 — from security.layers" },
  { label: "unqualified six-layer claim", pattern: /(?:the )?(?:six|6)[- ]layers? (?:of|on|in)\b/i, why: "prose that restates the layer count — from security.layerSummary" },
  // Benchmark figures.
  { label: "benchmark figure 0.32s", pattern: /\b0\.32\s?s\b/, why: "benchmark — from benchmarks.results" },
  { label: "benchmark figure 0.31s", pattern: /\b0\.31\s?s\b/, why: "benchmark — from benchmarks.results" },
  // CI job numbers in phrase form (bare 61/104/78 are too generic to scan for).
  { label: "CI job summary", pattern: /\b\d+\s*(?:passed|skipped|platform-skipped)\b/i, why: "CI results — from the ci block / generated test facts" },
  { label: "suite pass summary", pattern: /\b\d+\/\d+\s*se?uites?\b/i, why: "suite counts — from test-facts.generated.json" },
];

/**
 * Every version this project has actually released, read from
 * `release_notes/v*.md`.
 *
 * A token in this set that is not the current release is a stale project
 * version — exactly what a typed version string becomes one release later.
 * Version numbers belonging to other things (a plugin example at `1.0.0`, an
 * extension at `2.1.0`, Electron at `14.2.1`, the Firebase SDK at `7.20.0`, an
 * npm package at `v2.0.0`) are not in the set and are never flagged: nothing
 * here can tell them apart by shape alone, so the release history does it.
 *
 * A hard-coded copy of the *current* version is allowed through rather than
 * failed — it is correct today, and it turns stale (and therefore caught) on the
 * next release.
 */
const PROJECT_RELEASES = new Set<string>([version.semver]);
{
  const dir = join(REPO, "release_notes");
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      const m = f.match(/^v(\d+\.\d+(?:\.\d+)*)\.md$/);
      if (m) PROJECT_RELEASES.add(m[1]);
    }
  }
}

/**
 * Lines where a release number is history or illustration rather than a claim
 * about the current build: "fixed in v0.2.9", "git tag v0.2.4-stable",
 * "e.g. 0.2.7", "Example Release Entry".
 */
const HISTORY_CONTEXT =
  /\b(?:git tag|for example|UPDATE THIS|fixed in|resolves|regression|previous|older|earlier|towards|historical|example)\b|e\.g\./i;

function checkLiterals() {
  const files = [
    ...walk(REPO, [".md"]),
    ...walk(join(LANDING, "src"), [".ts", ".tsx", ".txt"]),
    ...walk(LANDING, [".md", ".txt"]),
  ].filter((f) => !isExempt(f));

  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const isTs = /\.(ts|tsx|txt)$/.test(file);
    const lines = blankGeneratedBlocks(text).split("\n");
    let offset = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const start = offset;
      offset += line.length + 1;
      if (!line) continue;
      // Sample code rather than a claim: a fenced markdown block, or a template
      // literal constant in TS/TSX holding rendered content.
      if (isTs ? isInsideTemplate(text, start) : isInsideFence(text, start)) continue;
      // A line that interpolates SSOT data is a generated sentence, not a typed
      // literal — `${net.mcpBridge.port}` is the port, wherever it is printed.
      if (/\$\{(?:net|network|version|ci|tests|benchmarks|security|derived|legal|repo|skills|project)\./.test(line))
        continue;
      for (const lit of LITERALS) {
        if (!lit.pattern.test(line)) continue;
        if (lit.claimContext && !lit.claimContext.test(line)) continue;

        if (lit.label === "version string") {
          // "benchmarked on v0.3.4" is the label rule (c) REQUIRES — a figure
          // legitimately dated to an older release is not a stale claim.
          if (/benchmarked on v/i.test(line)) continue;
          const stale = [...line.matchAll(/\bv?(\d{1,2}\.\d+\.\d+)\b/g)]
            .map((m) => m[1])
            .filter((v) => v !== version.semver && PROJECT_RELEASES.has(v));
          if (!stale.length) continue;
          if (HISTORY_CONTEXT.test(line)) continue;
          problems.push(
            `[b] ${rel(file)}:${i + 1} cites release ${stale.join(", ")} but the current release is ` +
              `v${version.semver}\n      ${line.trim().slice(0, 160)}`,
          );
          continue;
        }

        problems.push(
          `[b] ${rel(file)}:${i + 1} hard-codes ${lit.label} → ${lit.why}\n      ${line.trim().slice(0, 160)}`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// (a) README marker blocks must match generated output exactly
// ---------------------------------------------------------------------------

async function checkReadmeBlocks() {
  const README = join(REPO, "README.md");
  if (!existsSync(README)) {
    problems.push("[a] README.md not found");
    return;
  }
  const { execFileSync } = await import("node:child_process");
  const before = readFileSync(README, "utf8");
  try {
    execFileSync("node", [join(REPO, "scripts", "sync-docs.ts"), "--check"], {
      stdio: "inherit",
      cwd: REPO,
    });
  } catch {
    problems.push("[a] README marker blocks are stale or missing — run `npm run docs:sync`");
  }
  const after = readFileSync(README, "utf8");
  if (before !== after) {
    problems.push("[a] sync-docs.ts modified README.md during check — the committed README was stale");
    writeFileSync(README, before);
  }

  // Every declared block must exist, and none may be declared in README but
  // absent from the block registry (or vice versa).
  const names = [...before.matchAll(/<!-- SSOT:START ([^\s]+) -->/g)].map((m) => m[1]);
  const ends = [...before.matchAll(/<!-- SSOT:END ([^\s]+) -->/g)].map((m) => m[1]);
  for (const n of names) if (!ends.includes(n)) problems.push(`[a] README block "${n}" has no END marker`);
  for (const n of ends) if (!names.includes(n)) problems.push(`[a] README block "${n}" has no START marker`);
}

// ---------------------------------------------------------------------------
// (c) benchmark version must be labelled
// ---------------------------------------------------------------------------

function checkBenchmarks() {
  const stale = benchmarks.benchmarkVersion !== benchmarks.currentVersion;
  const label = `benchmarked on v${benchmarks.benchmarkVersion}`;

  const files = [
    join(REPO, "README.md"),
    ...walk(join(LANDING, "src"), [".ts", ".tsx"]),
    ...walk(LANDING, [".md"]),
  ].filter((f) => existsSync(f) && !isExempt(f));

  /**
   * The headline figures only — "0.32s" and "0.31s".
   *
   * `details` is deliberately excluded: it contains values like "1.2 GB" and
   * "14.7%" whose digits turn up in animation durations, grid ratios, and SVG
   * path data, which would flag pages that never mention a benchmark. A token
   * only counts when a unit is attached to it directly.
   */
  const figureTokens = benchmarks.results
    .map((r) => r.value.match(/(\d+\.\d+)(?=[a-z%])/i)?.[1])
    .filter((v): v is string => !!v);

  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!figureTokens.some((t) => text.includes(t))) continue;
    if (!text.includes(label) && !text.includes(`v${benchmarks.benchmarkVersion}`)) {
      problems.push(
        `[c] ${rel(file)} publishes benchmark figures without the required "${label}" label ` +
          `(benchmark v${benchmarks.benchmarkVersion} vs current v${benchmarks.currentVersion})`,
      );
    }
    if (stale && !text.includes(benchmarks.currentVersion)) {
      warnings.push(
        `${rel(file)} cites benchmarks but never states the current version v${benchmarks.currentVersion}`,
      );
    }
  }

  // The provenance claim was verified false and must not come back.
  const overview = join(LANDING, "src", "app", "docs", "overview", "page.tsx");
  if (existsSync(overview)) {
    const t = readFileSync(overview, "utf8");
    if (/benchmark scripts (?:are|is) (?:also )?included/i.test(t)) {
      problems.push(
        '[c] Aartiq-Landing-Page/src/app/docs/overview/page.tsx still claims the benchmark scripts are ' +
          "included in the repository. No such script exists anywhere in either repo.",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// (d) internal documentation links must resolve
// ---------------------------------------------------------------------------

/** True when `index` falls inside a ``` fenced block in a markdown file. */
function isInsideFence(text: string, index: number): boolean {
  return (text.slice(0, index).match(/^```/gm) ?? []).length % 2 === 1;
}

/**
 * True when `index` falls inside a backtick template literal in TS/TSX.
 *
 * Doc pages hold much of their rendered text in template constants (an
 * extension's `popup.js`, an llms.txt body). Those are sample code, not links to
 * files in this repository, so a bare `src="popup.js"` inside one must not be
 * read as an internal link.
 */
function isInsideTemplate(text: string, index: number): boolean {
  return (text.slice(0, index).match(/`/g) ?? []).length % 2 === 1;
}

function checkLinks() {
  const docFiles = [
    join(REPO, "README.md"),
    ...walk(REPO, [".md"]),
    ...walk(join(LANDING, "src"), [".ts", ".tsx"]),
    ...walk(LANDING, [".md"]),
  ].filter((f) => existsSync(f));

  const seen = new Set<string>();
  for (const file of docFiles) {
    if (seen.has(file) || isExempt(file)) continue;
    seen.add(file);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    const isTs = /\.(ts|tsx)$/.test(file);
    /** Sample code rather than an internal link. */
    const isSample = (index: number) =>
      isTs ? isInsideTemplate(text, index) : isInsideFence(text, index);

    const candidates: { target: string; sampled: boolean }[] = [];
    // markdown: [text](target) — target may not contain whitespace or parens.
    for (const m of text.matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/g))
      candidates.push({ target: m[1], sampled: isSample(m.index ?? 0) });
    // tsx: href="literal" / src="literal". Only fully literal values — anything
    // containing {, } or a newline is an expression, not a path we can resolve.
    for (const m of text.matchAll(/\b(?:href|src)\s*=\s*"([^"\n]+)"/g))
      candidates.push({ target: m[1], sampled: isSample(m.index ?? 0) });
    for (const m of text.matchAll(/\b(?:href|src)\s*=\s*'([^'\n]+)'/g))
      candidates.push({ target: m[1], sampled: isSample(m.index ?? 0) });

    for (const { target: raw, sampled } of candidates) {
      if (sampled) continue;
      let target = raw.trim();
      if (!target) continue;
      if (/^(https?:|mailto:|tel:|#|data:|app:|javascript:|blob:|file:|vscode:)/i.test(target)) continue;
      if (target.includes("${") || target.includes("{") || target.includes("}")) continue;

      const [path] = target.split("#");
      if (!path) continue;
      const decoded = (() => {
        try {
          return decodeURIComponent(path);
        } catch {
          return path;
        }
      })();

      if (decoded.startsWith("/")) {
        // Absolute site path: resolve against the Next app router, then public/.
        const base = decoded.replace(/^\//, "").replace(/\.html$/, "");
        const candidatesOnDisk = [
          join(LANDING, "src", "app", base, "page.tsx"),
          join(LANDING, "src", "app", `${base}.tsx`),
          join(LANDING, "src", "app", base),
          join(LANDING, "public", base),
        ];
        if (candidatesOnDisk.some((c) => existsSync(c))) continue;
        problems.push(`[d] ${rel(file)} links to "${target}" — no such route or asset`);
        continue;
      }

      const abs = resolve(dirname(file), decoded);
      if (!existsSync(abs)) {
        problems.push(`[d] ${rel(file)} links to "${target}" — not found at ${rel(abs)}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// (e) risk-tier tables must agree
// ---------------------------------------------------------------------------

function checkRiskTables() {
  const expected = security.riskTiers.map((t) => t.id).join(",");

  // e1 — README must carry the risk-table block, containing every tier.
  const README = join(REPO, "README.md");
  if (existsSync(README)) {
    const md = readFileSync(README, "utf8");
    const m = md.match(/<!-- SSOT:START risk-table -->\n([\s\S]*?)<!-- SSOT:END risk-table -->/);
    if (!m) {
      problems.push("[e] README has no risk-table block");
    } else {
      const body = m[1];
      for (const t of security.riskTiers) {
        if (!new RegExp(`\\*\\*${t.id}\\*\\*`).test(body)) {
          problems.push(`[e] README risk table is missing the ${t.id} tier`);
        }
      }
      // Approval wording must not contradict the SSOT.
      for (const phrase of ["never auto-approved", "Explicit authorization", "Stronger confirmation"]) {
        if (body.includes(phrase)) {
          problems.push(`[e] README risk table says "${phrase}", which the source does not support`);
        }
      }
    }
  }

  // e2 — no landing page may build its own risk table. It must import from the SSOT,
  // or omit the table entirely.
  const landingFiles = [
    ...walk(join(LANDING, "src"), [".ts", ".tsx"]),
    ...walk(LANDING, [".md", ".txt"]),
  ].filter((f) => !isExempt(f));

  for (const file of landingFiles) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    // Generated content: sync-docs.ts rendered the table from `security.riskTiers`,
    // so it cannot disagree with it by construction.
    if (text.includes("<!-- SSOT:START risk-table -->")) continue;
    // A hand-written tier table looks like all four tier names in a small region.
    const tierHits = ["low", "medium", "high", "critical"].filter((t) =>
      new RegExp(`\\b${t}\\b`, "i").test(text),
    ).length;
    const isMarkdownTable = /^\|.*\|\s*$/m.test(text);
    const importsFacts =
      text.includes("from \"@/data/facts\"") ||
      text.includes("from \"@/data/project-facts\"") ||
      text.includes("from '@/data/facts'") ||
      text.includes("from '@/data/project-facts'");

    if (tierHits === 4 && isMarkdownTable && !importsFacts) {
      problems.push(
        `[e] ${rel(file)} appears to contain a hand-written risk-tier table that does not import the SSOT`,
      );
    }

    // Claiming critical is "never auto-approved" without the source's own caveat.
    if (/critical[^\n]{0,120}never (?:silently )?auto[- ]approved/i.test(text) && !importsFacts) {
      problems.push(
        `[e] ${rel(file)} asserts critical is never auto-approved but does not import the SSOT, ` +
          "so it omits the caveat that no registry ever assigns the tier and no biometric/QR gate exists",
      );
    }
  }

  // e3 — the published tier list can never be truncated to fewer than four.
  if (security.riskTiers.map((t) => t.id).join(",") !== expected) {
    problems.push("[e] security.riskTiers shape changed unexpectedly");
  }
  if (security.riskTiers.length !== 4) {
    problems.push(`[e] security.riskTiers has ${security.riskTiers.length} entries, expected 4`);
  }
}

// ---------------------------------------------------------------------------
// Sanity checks on the SSOT itself
// ---------------------------------------------------------------------------

function checkSsotIntegrity() {
  // CI inventory: count the real workflow files rather than trusting the number.
  const wfDir = join(REPO, ".github", "workflows");
  if (existsSync(wfDir)) {
    const onDisk = readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)).length;
    if (onDisk !== ci.workflows.count) {
      problems.push(
        `[ssot] ci.workflows.count is ${ci.workflows.count} but .github/workflows holds ${onDisk} file(s) — ` +
          "a workflow was added or removed. Update project-facts.ts (AGENTS.md renders this number).",
      );
    }
  }

  if (security.layers.length !== 6) {
    problems.push(`[ssot] security.layers has ${security.layers.length} entries; the documented model has 6`);
  }
  const allowed = new Set(["enforcement boundary", "policy layer", "heuristic/first-pass", "mitigation"]);
  for (const l of security.layers as SecurityLayer[]) {
    if (!allowed.has(l.strength)) problems.push(`[ssot] layer ${l.id} has invalid strength "${l.strength}"`);
    if (!l.description) problems.push(`[ssot] layer ${l.id} has no description`);
  }
  if (legal.licenseConflict.resolved !== false && legal.licenseConflict.resolved !== true) {
    problems.push("[ssot] legal.licenseConflict.resolved must be a boolean");
  }
  if (version.status !== "stable" && version.status !== "alpha") {
    problems.push(`[ssot] version.status "${version.status}" must be stable or alpha`);
  }

  // A version badge must never fall back to a typed-in number. `useVersion()` starts
  // empty and fills in from /api/version after hydration, so a literal fallback is
  // what a visitor actually sees on first paint. The navbar shipped `v0.3.0` this
  // way while the release was 0.3.7 — and because 0.3.0 predates the release notes
  // the stale-version rule keys off, nothing flagged it.
  for (const file of [...walk(join(LANDING, "src"), [".ts", ".tsx"]), ...walk(REPO, [".md"])]) {
    if (isExempt(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/\bversion\s*(?:\|\||\?\?)\s*['"]v?(\d+\.\d+\.\d+)['"]/g)) {
      problems.push(
        `[ssot] ${rel(file)} falls back to the literal version "${m[1]}" when the version is unknown — ` +
          `that string is what renders before hydration. Use APP_VERSION.version (project-facts semver ${version.semver}).`,
      );
    }
  }
  // The monitoring-only channel figures are flagged TODO(verify) — they must never
  // be rendered as fact.
  if (security.monitoringOnlyChannels.verified === false) {
    warnings.push(
      "security.monitoringOnlyChannels is TODO(verify): the 22/9 IPC figures are not present in " +
        "docs-audit/action-inventory.md. Nothing renders them; re-derive or drop.",
    );
  }
  for (const s of network.servers) {
    if (s.bindsAllInterfacesWhen === null && s.defaultBindAddress !== "127.0.0.1" && !s.note) {
      problems.push(`[ssot] server ${s.id} binds broadly but explains why in no note`);
    }
  }
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Duplicate copies must not drift from the file they were copied from
// ---------------------------------------------------------------------------

/**
 * `Aartiq/Landing_Page/` holds two files left over from before the site moved
 * into its own repository. Nothing in this repo imports them, so they rot
 * silently — the copy there still described a seven-layer model and a different
 * release than the live file. A copy either matches its original or it is not a
 * copy.
 */
function checkDuplicateDocs() {
  const residual = join(REPO, "Landing_Page");
  if (!existsSync(residual)) return;
  for (const file of walk(residual)) {
    const relPath = relative(residual, file).replace(/\\/g, "/");
    const original = join(LANDING, relPath);
    if (!existsSync(original)) {
      warnings.push(`Landing_Page/${relPath} has no counterpart in Aartiq-Landing-Page/ — delete it or explain it.`);
      continue;
    }
    if (readFileSync(file, "utf8") !== readFileSync(original, "utf8")) {
      problems.push(
        `[dup] Landing_Page/${relPath} has drifted from Aartiq-Landing-Page/${relPath} — ` +
          "two copies of one document. Copy the canonical file over, or remove the residual one.",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Static files must not shadow the routes that are supposed to be live
// ---------------------------------------------------------------------------

/**
 * Next.js serves `public/<path>` at the site root with higher precedence than an
 * App Router route at the same path. That makes `public/llms.txt` and
 * `public/llms-full.txt` silent duplicates of `src/app/llms.txt/route.ts` and
 * `src/app/llms-full.txt/route.ts`.
 *
 * This was not theoretical: both static copies were committed on the same day as
 * the routes, kept being edited in parallel, and the static copy won at runtime.
 * Every SSOT fix applied to the routes — the corrected port table, the retired
 * Nexus entry — was invisible to `https://aartiq.ponsrischool.in/llms-full.txt`,
 * which kept serving a stale hard-coded `v0.3.7`. Nothing failed; the site just
 * published the wrong file for a month.
 *
 * So: a file in `public/` may not occupy a path that the app also routes. Either
 * the file is the source of truth (delete the route) or the route is (delete the
 * file). Two answers to one URL is the bug.
 */
function checkPublicShadowing() {
  const publicDir = join(LANDING, "public");
  const appDir = join(LANDING, "src", "app");
  if (!existsSync(publicDir) || !existsSync(appDir)) return;

  const routePaths = new Set<string>();
  for (const entry of readdirSync(appDir, { withFileTypes: true })) {
    // A directory name maps to the URL segment verbatim: `src/app/llms.txt/route.ts`
    // serves `/llms.txt`, so the name must be compared unmodified. A nested
    // `route.ts` deeper than one level (`src/app/docs/security/route.ts` ->
    // `/docs/security`) is not a whole-directory route and cannot be shadowed by a
    // single file in `public/`, so only depth-1 directories are collected here.
    if (!entry.isDirectory()) continue;
    routePaths.add(entry.name);
  }

  for (const name of readdirSync(publicDir)) {
    if (routePaths.has(name)) {
      problems.push(
        `[shadow] public/${name} shadows the app route src/app/${name}/route.ts — ` +
          "Next.js serves the static file, so the route's content never reaches users. " +
          `Delete one of them: public/${name} or src/app/${name}/.`,
      );
    }
  }
}

/**
 * Rule (g) — distribution claims.
 *
 * The build configuration is the only authority on what is actually shipped, and
 * it is narrower than the marketing copy was:
 *
 *   win.target   = ["nsis", "appx"]  -> .exe, and .appx renamed to .msix by
 *                                       windows-msix.yml before upload
 *   mac.target   = ["dmg", "zip"]    -> .dmg, .zip
 *   linux.target = ["AppImage"]      -> .AppImage ONLY. No .deb is produced
 *                                       anywhere: no workflow and no
 *                                       electron-builder target mentions it.
 *   Android      -> release .apk via flutter_distributor / `flutter build apk`
 *   iOS          -> `flutter build ios --release --no-codesign`, zipped to
 *                    ios_no_sign.ipa, uploaded as a CI artifact. Never published.
 *
 * A Microsoft Store listing is real (`9nd6wg2rp7cm`, corroborated by the README
 * badge, four release notes and three release-workflow templates). Google Play
 * and AltStore listings are not, and the site used to advertise both anyway.
 */
/**
 * Rule (g) applies to text a visitor actually reads, not to code that merely
 * tolerates a filename. `UpdatesSettings.tsx` matching `.deb` and `build.yml`
 * globbing `release/*.deb` are both "if one ever shows up, handle it" — neither
 * asserts that one is published. Only rendered copy can make a claim.
 */
function isDocSurface(file: string): boolean {
  const r = rel(file);
  if (isExempt(file)) return false;
  // The SSOT names `.deb` precisely in order to deny it; helpers match on it
  // defensively. Neither is a user-visible claim.
  if (/Aartiq-Landing-Page\/src\/(data|lib)\//.test(r)) return false;
  if (/\/scripts\//.test(r)) return false;
  if (/\/\.github\//.test(r)) return false;
  if (/Aartiq\/aartiq-browser\//.test(r)) return false;
  if (/Aartiq\/flutter_browser_app\//.test(r)) return false;
  if (/\.md$/.test(r)) return true;
  // Landing pages, layouts, route handlers and the components they render.
  if (/Aartiq-Landing-Page\/src\/(app|components)\//.test(r)) return true;
  return false;
}

/**
 * A line that denies the claim instead of making it. The honest forms are the ones
 * that actually shipped: "there is no Google Play listing", "No .deb package is
 * produced by any build workflow", "not distributed".
 */
function isDocLineNegated(line: string): boolean {
  return /\b(?:no|not|never|without|nor|cannot|can't|isn't|aren't)\b/i.test(line);
}

function checkDistributionClaims() {
  const files = [...walk(REPO), ...walk(LANDING)].filter(isDocSurface);

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const where = rel(file);

    // Judged line by line. A file-wide "is this honest somewhere?" test is exactly
    // the mistake this rule exists to catch: one correct sentence used to excuse any
    // number of wrong ones in the same file.
    const lines = text.split("\n");

    for (const line of lines) {
      if (isDocLineNegated(line)) continue;

      // g1 — no store listing exists other than the Microsoft Store.
      if (/play\.google\.com/i.test(line) || /\bGoogle Play\b/i.test(line)) {
        problems.push(
          `[g] ${where} advertises a Google Play listing, but no build workflow publishes one`,
        );
      }
      if (/\bAltStore\b/i.test(line)) {
        problems.push(`[g] ${where} advertises an AltStore listing, which does not exist`);
      }
      if (/(?:on|in|from) the App Store|App Store (?:listing|distribution)/i.test(line)) {
        problems.push(`[g] ${where} advertises an App Store listing, but iOS is built unsigned and never published`);
      }

      // g2 — `.deb` is not an artifact any workflow produces.
      if (/\.deb\b/.test(line)) {
        problems.push(
          `[g] ${where} offers a .deb, but electron-builder's linux target is ["AppImage"] only ` +
            "and no workflow builds one",
        );
      }
    }
  }

  // g3 — the Store product ID must be the one the repository actually uses.
  const win = platforms.find((p) => p.id === "windows");
  const readme = join(REPO, "README.md");
  if (win?.storeUrl && existsSync(readme)) {
    const badge = readFileSync(readme, "utf8").match(/apps\.microsoft\.com\/detail\/([a-z0-9]+)/i)?.[1];
    if (!badge) {
      problems.push("[g] README.md has no Microsoft Store product ID to corroborate platforms[].storeUrl");
    } else if (!win.storeUrl.endsWith(badge)) {
      problems.push(
        `[g] project-facts platforms[windows].storeUrl points at "${win.storeUrl}" but README.md and the ` +
          `release workflows use "${badge}"`,
      );
    }
  }

  // g4 — only the Microsoft Store may be described as a store we are distributed on.
  for (const p of platforms) {
    const store = (p as { store?: string }).store;
    if (store && store !== "Microsoft Store") {
      problems.push(`[g] platform ${p.id} claims store "${store}", which has no evidence behind it`);
    }
    if (p.distributed && p.id === "ios") {
      problems.push("[g] iOS is built unsigned in CI; it must not be marked distributed");
    }
  }
}

async function main() {
  checkSsotIntegrity();
  await checkReadmeBlocks();
  checkLiterals();
  checkBenchmarks();
  checkRiskTables();
  checkLinks();
  checkDuplicateDocs();
  checkPublicShadowing();
  checkDistributionClaims();

  if (warnings.length) {
    console.log(`\n${warnings.length} warning(s):`);
    for (const w of warnings) console.log(`  ! ${w}`);
  }

  if (problems.length) {
    console.error(`\n✗ docs:check failed — ${problems.length} problem(s):\n`);
    for (const p of problems) console.error(`  ${p}`);
    console.error("\nFix the docs (or the SSOT), then run: npm run docs:sync && npm run docs:check");
    process.exit(1);
  }

  console.log("\n✓ docs:check passed — README, landing site, and SSOT agree.");
}

await main();

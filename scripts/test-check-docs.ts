#!/usr/bin/env node
/**
 * Negative test for docs:check.
 *
 * A gate that has never been seen failing is not a gate. Each case mutates one
 * file, expects `check-docs.ts` to exit non-zero for the right reason, and puts
 * the file back. Run: node scripts/test-check-docs.ts
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";

const REPO = join(import.meta.dirname, "..");
const LANDING = join(REPO, "..", "Aartiq-Landing-Page");

const README = join(REPO, "README.md");
const OVERVIEW = join(LANDING, "src", "app", "docs", "overview", "page.tsx");
const SECURITY = join(LANDING, "src", "app", "docs", "security", "page.tsx");
const LLMS_FULL = join(LANDING, "src", "app", "llms-full.txt", "route.ts");
const NAVBAR = join(LANDING, "src", "components", "Navbar.tsx");
const FSOT = join(LANDING, "src", "data", "project-facts.ts");

function run() {
  try {
    execFileSync("node", [join(REPO, "scripts", "check-docs.ts")], {
      cwd: REPO,
      stdio: "pipe",
    });
    return { ok: true, out: "" };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

/** Apply `mutate`, expect failure containing `needle`, then restore. */
function expectFailure(label, file, mutate, needle) {
  const before = readFileSync(file, "utf8");
  const after = mutate(before);
  if (after === before) {
    console.log(`✗ ${label} — mutation did not change the file (test bug)`);
    return false;
  }
  writeFileSync(file, after);
  let res;
  try {
    res = run();
  } finally {
    writeFileSync(file, before);
  }
  if (res.ok) {
    console.log(`✗ ${label} — docs:check PASSED but should have failed`);
    return false;
  }
  if (!res.out.includes(needle)) {
    console.log(`✗ ${label} — failed, but not for the expected reason.`);
    console.log(`    wanted: ${needle}`);
    console.log(`    got:    ${res.out.split("\n").filter(Boolean).slice(-6).join("\n          ")}`);
    return false;
  }
  console.log(`✓ ${label}`);
  return true;
}

/**
 * Some rules are about a file that must NOT exist, or about a value inside the
 * SSOT module. Those need arbitrary setup/teardown rather than an in-place edit.
 */
function expectFailureWithSetup(label, setup, teardown, needle) {
  setup();
  let res;
  try {
    res = run();
  } finally {
    teardown();
  }
  if (res.ok) {
    console.log(`✗ ${label} — docs:check PASSED but should have failed`);
    return false;
  }
  if (!res.out.includes(needle)) {
    console.log(`✗ ${label} — failed, but not for the expected reason.`);
    console.log(`    wanted: ${needle}`);
    console.log(`    got:    ${res.out.split("\n").filter(Boolean).slice(-6).join("\n          ")}`);
    return false;
  }
  console.log(`✓ ${label}`);
  return true;
}

const cases = [
  [
    "(a) stale README marker block",
    README,
    (s) => s.replace("<!-- SSOT:START ci -->", "<!-- SSOT:START ci -->\n| tampered |"),
    "[a]",
  ],
  [
    "(b) hard-coded CI passing count",
    SECURITY,
    (s) => s.replace("{tests.tests.declared}", "577"),
    "hard-codes 577",
  ],
  [
    "(b) hard-coded three-layer claim",
    SECURITY,
    (s) => s.replace(
      "const TIER_STYLE = {",
      '// tampered\nconst _tamper = "three-layer security model";\nconst TIER_STYLE = {',
    ),
    "three-layer",
  ],
  [
    "(b) stale project version in a doc",
    OVERVIEW,
    (s) => s.replace("(v{benchmarks.currentVersion})", "(v0.3.6)"),
    "cites release 0.3.6",
  ],
  [
    "(c) benchmark figures published without the version label",
    OVERVIEW,
    (s) => s.replace(
      "<p className=\"text-5xl font-black text-emerald-400\">{benchmarks.results[0].value.replace(\"s\", \"\")}",
      "<p className=\"text-5xl font-black text-emerald-400\">0.32",
    ),
    "[c]",
  ],
  [
    "(c) resurrected false claim about benchmark scripts",
    OVERVIEW,
    (s) => s.replace(
      "{benchmarks.provenance}",
      '"All benchmark scripts are included in the repository. "',
    ),
    "benchmark scripts are ",
  ],
  [
    "(d) broken internal link",
    OVERVIEW,
    (s) => s.replace('href="/docs/getting-started"', 'href="/docs/does-not-exist"'),
    "[d]",
  ],
  [
    "(e) hand-written risk table with no SSOT import",
    SECURITY,
    (s) =>
      s
        .replace('import { tests, derived, ci, security, net, version } from "@/data/facts";', "")
        .replace(
          "const TIER_STYLE = {",
          'const tamper = "| low | medium | high | critical |";\nconst TIER_STYLE = {',
        ),
    "[e]",
  ],
  [
    "(ssot) workflow count disagrees with disk",
    join(REPO, "scripts", "check-docs.ts"),
    (s) => s.replace("ci.workflows.count", "12 /* tampered */"),
    "[ssot]",
  ],
  [
    "(g) .deb offered that no workflow builds",
    LLMS_FULL,
    (s) =>
      s.replace(
        "Download Aartiq-x.x.x.AppImage",
        "Download Aartiq-x.x.x.AppImage or aartiq_amd64.deb, then run dpkg -i",
      ),
    "[g]",
  ],
  [
    "(g) invented Google Play listing",
    LLMS_FULL,
    (s) =>
      s.replace(
        "Download Aartiq-x.x.x.apk from the downloads page and side-load it. There is no Google Play listing.",
        "Download Aartiq from Google Play.",
      ),
    "[g]",
  ],
  [
    "(ssot) version badge falls back to a typed-in version",
    NAVBAR,
    (s) => s.replace("version || APP_VERSION.version", "version || '0.3.0'"),
    "falls back to the literal version",
  ],
];

let pass = 0;
for (const [label, file, mutate, needle] of cases) {
  if (!existsSync(file)) {
    console.log(`✗ ${label} — ${file} missing`);
    continue;
  }
  if (expectFailure(label, file, mutate, needle)) pass++;
}

// (f) A stale static copy in `public/` outranks the app route at runtime, so every
// SSOT fix applied to the route is invisible. This is the bug that shipped a stale
// `v0.3.7` llms-full.txt while the route beside it was already correct.
const SHADOW = join(LANDING, "public", "llms-full.txt");
if (expectFailureWithSetup(
  "(f) public/ copy shadows the llms-full.txt route",
  () => writeFileSync(SHADOW, "# Aartiq\n\n> stale hand-maintained copy\n"),
  () => rmSync(SHADOW, { force: true }),
  "[shadow]",
)) pass++;

// (g) The Store product ID in the SSOT must match the one the repo publishes.
{
  const before = readFileSync(FSOT, "utf8");
  const after = before.replace("9nd6wg2rp7cm", "9zzzzzzzzzzz");
  if (after === before) {
    console.log("✗ (g) Store product ID drift — could not find the ID to tamper with (test bug)");
  } else {
    writeFileSync(FSOT, after);
    let res;
    try {
      res = run();
    } finally {
      writeFileSync(FSOT, before);
    }
    if (res.ok) {
      console.log("✗ (g) Store product ID drift — docs:check PASSED but should have failed");
    } else if (!res.out.includes("[g]")) {
      console.log("✗ (g) Store product ID drift — failed for the wrong reason:\n" + res.out);
    } else {
      console.log("✓ (g) Store product ID drift from the repository is caught");
      pass++;
    }
  }
}

// The clean tree must pass.
const clean = run();
if (clean.ok) {
  console.log(`✓ clean tree passes`);
  pass++;
} else {
  console.log(`✗ clean tree FAILED:\n${clean.out}`);
}

console.log(`\n${pass}/${cases.length + 3} checks behaved as expected`);
if (pass !== cases.length + 3) process.exit(1);

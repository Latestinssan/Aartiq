/**
 * sync-docs.ts — render SSOT values into README.md marker blocks.
 *
 * Each block lives between
 *   <!-- SSOT:START name -->
 *   ...generated...
 *   <!-- SSOT:END name -->
 *
 * and is rewritten wholesale from the single source of truth. Anything a human
 * writes outside a marker is never touched; anything inside one is replaced.
 * `check-docs.ts` fails if a block ever drifts from what this script produces.
 *
 * Usage:
 *   node scripts/sync-docs.ts           # rewrite blocks in place
 *   node scripts/sync-docs.ts --check   # exit 1 if anything is out of date
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  GeneratedTestFacts,
  GeneratedRepoFacts,
  GeneratedShellTiers,
} from "../../Aartiq-Landing-Page/src/data/project-facts.ts";

const REPO = join(import.meta.dirname, "..");

/**
 * The landing page is a separate repository that normally sits beside this one.
 * `AARTIQ_LANDING_DIR` overrides that: inside a git worktree the sibling path is
 * not the landing repo, and following it would read one tree and write another.
 * scripts/gen-shell-tiers.ts and scripts/check-docs.ts use the same variable.
 */
const LANDING = process.env.AARTIQ_LANDING_DIR ?? join(REPO, "..", "Aartiq-Landing-Page");

const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(LANDING, rel), "utf8")) as T;

// Node requires explicit import attributes for JSON, which the bundler-style bare
// import in facts.ts cannot carry. So scripts take authored facts straight from
// project-facts.ts (pure, no imports) and read generated JSON directly. facts.ts
// is the page-facing merge of exactly these.
//
// The facts module is loaded dynamically rather than with a static `import`,
// because a static specifier is resolved against this file's own location at load
// time and cannot be pointed at AARTIQ_LANDING_DIR. Reading the JSON off disk
// instead of importing it keeps all three inputs on the same resolution rule.
const facts = (await import(
  pathToFileURL(join(LANDING, "src", "data", "project-facts.ts")).href
)) as typeof import("../../Aartiq-Landing-Page/src/data/project-facts.ts");

const { version, security, network, ci, benchmarks, legal } = facts;

const tests = readJson<GeneratedTestFacts>("src/data/test-facts.generated.json");
const repoStats = readJson<GeneratedRepoFacts>("src/data/repo-facts.generated.json");
const shellTiers = readJson<GeneratedShellTiers>("src/data/shell-tiers.generated.json");

const README = join(REPO, "README.md");

const start = (name: string) => `<!-- SSOT:START ${name} -->`;
const end = (name: string) => `<!-- SSOT:END ${name} -->`;

// ---------------------------------------------------------------------------
// Renderers — one per marker block
// ---------------------------------------------------------------------------

const row = (cells: string[]) => `| ${cells.join(" | ")} |`;
const table = (head: string[], body: string[][]) =>
  [
    row(head),
    row(head.map(() => "---")),
    ...body.map((r) => row(r.map(esc))),
  ].join("\n");

/** A literal `|` inside a cell would end the column, so escape it. */
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

/** Version + release, used by the badge and the docs table. */
function renderVersion(): string {
  return [
    `**${version.tag}** — released ${version.releaseDate}.`,
    ``,
    `Latest release: [${version.tag}](${version.repository}/releases/tag/${version.tag}) · [full release notes](${version.releaseNotes})`,
  ].join("\n");
}

/**
 * Six layers, with the count in the prose computed from the array itself.
 */
function renderLayers(): string {
  return [
    security.layerSummary,
    ``,
    table(
      ["#", "Layer", "Strength"],
      security.layers.map((l, i) => [String(i + 1), l.name, l.strength]),
    ),
  ].join("\n");
}

/** Risk tiers, including the limitation that stops each row reading as a guarantee. */
function renderRiskTable(): string {
  return table(
    ["Tier", "Approval behaviour", "Auto-approved?", "Examples"],
    security.riskTiers.map((t) => [
      `**${t.id}**`,
      t.approvalMethod,
      t.autoApprove,
    t.examples.length ? t.examples.map((e) => `\`${e}\``).join(", ") : "_none assigned by any registry_",
  ]),
  );
}

/** CI trigger policy + per-job results. */
function renderCI(): string {
  const env = tests.environment.label;
  const when = tests.generatedAt.slice(0, 10);
  const local = `${tests.tests.passed} passed / ${tests.tests.skipped} skipped / ${tests.tests.failed} failed of ${tests.tests.declared} declared`;

  const lines: string[] = [
    `**${ci.workflow}** — ${ci.trigger.type}.`,
    ``,
    `${ci.trigger.detail}`,
    ``,
    `Latest green run: [#${ci.latestRun.id}](${ci.latestRun.url}) (run #${ci.latestRun.runNumber}, \`${ci.latestRun.event}\`, ${ci.latestRun.date}, \`${ci.latestRun.headSha}\`, ${ci.latestRun.conclusion}).`,
    ``,
    `**${ci.jobs.defined} jobs.** ${ci.jobs.detail} Node ${ci.jobs.nodeVersion}. ${ci.jobs.timeout}`,
    ``,
    `Test counts are generated, not typed. On ${env} the full suite reports **${local}** (generated ${when}).`,
    ``,
    `> ${ci.platformVarianceNote}`,
    ``,
    `> Per-job results and the skip breakdown for this run live on the [testing page](https://aartiq.ponsrischool.in/docs/testing#ci-run).`,
  ];
  return lines.join("\n");
}

/** Benchmarks, always stamped with the version they were taken on. */
function renderBenchmarks(): string {
  const b = benchmarks;
  const hw = b.hardware;
  const lines: string[] = [
    `Measured on a **${hw.machine} ${hw.chip}**, ${hw.cores}-core CPU, ${hw.memoryGb} GB RAM, ${hw.os}.`,
    ``,
    `**${b.date} — ${`benchmarked on v${b.benchmarkVersion}`}.** Current release: v${b.currentVersion}.`,
    ``,
    table(["Metric", "Result"], b.results.map((r) => [r.metric, `**${r.value}**`])),
    ``,
    `> ${b.caveat}`,
  ];
  if (b.benchmarkVersion !== b.currentVersion) {
    lines.push(
      ``,
      `> These figures predate the current release (v${b.currentVersion}) and were taken on v${b.benchmarkVersion}. ${b.provenance}`,
    );
  } else {
    lines.push(``, `> ${b.provenance}`);
  }
  return lines.join("\n");
}

/**
 * Licence table — publishes the conflict while one exists, and nothing but the
 * table once the copies agree. A conflict is worth a warning; a resolution is
 * not worth a paragraph, so the resolved state renders the table, the MIT note
 * and the trademark, and stops there. rule (j) still fails if the copies ever
 * disagree again.
 */
function renderLicense(): string {
  const c = legal.licenseConflict;
  const lines: string[] = [
    table(
      ["Component", "Licence", "Licence file", "Status"],
      legal.table.map((r) => [r.component, r.license, `\`${r.licenseFile}\``, r.status]),
    ),
  ];
  if (!c.resolved) {
    lines.push(
      ``,
      `> [!WARNING]`,
      `> **Licence conflict — unresolved, and it needs a human decision.**`,
      `> The repository root is ${c.rootLicense}, but \`${c.browserLicenseFile.split(" — ")[0]}\` is a restrictive EULA that forbids modification, derivative works, and redistribution, and it is the licence the Windows installer displays.`,
    );
    for (const e of c.evidence) lines.push(`> - ${e}`);
    lines.push(
      `>`,
      `> This file does not pick a side. Until the conflict is settled, treat the Apache-2.0 label on this component as unconfirmed.`,
    );
  }
  lines.push(
    ``,
    `The MCP server is MIT-licensed for compatibility with Claude Desktop and other MCP clients.`,
    ``,
    `### Trademark`,
    ``,
    legal.trademark.paragraph,
  );
  return lines.join("\n");
}

/** Every network listener, with its bind address and auth state. */
function renderNetwork(): string {
  return table(
    ["Service", "Port", "Default bind address", "Authentication"],
    network.servers.map((s) => [
      s.name,
      typeof s.port === "number" ? `${s.port}` : `${s.port} (env-overridable)`,
      `\`${s.defaultBindAddress}\``,
      s.auth,
    ]),
  );
}

/**
 * AGENTS.md's Communication Protocols table. It is a port table by another name,
 * so it renders from `network.servers` — plus discovery, which is not a listener
 * and used to be listed as one.
 */
function renderProtocols(): string {
  const rows: string[][] = [
    [
      "HTTP (Next.js, dev)",
      `${network.devRenderer.port}`,
      `${network.devRenderer.purpose}`,
    ],
    ...network.servers.map((s) => [
      s.name,
      `${s.port}`,
      `${s.id} — binds \`${s.defaultBindAddress}\``,
    ]),
    ["UDP discovery", `${network.discovery.port}`, `${network.discovery.status}`],
  ];
  for (const r of network.retiredPorts) {
    rows.push([r.name, `${r.port}`, `retired — ${r.status}`]);
  }
  return table(["Protocol / Service", "Port", "Notes"], rows);
}

/** AI-GUIDE.md's "Current Version" metadata list. */
function renderCurrentVersion(): string {
  return [
    `- **Version:** \`${version.semver}\` (${version.status})`,
    `- **Codename:** ${version.codename}`,
    `- **Release Date:** ${version.releaseDate}`,
  ].join("\n");
}

/** AGENTS.md's CI/CD paragraph, from the verified workflow inventory. */
function renderWorkflows(): string {  const w = ci.workflows;
  return [
    `${w.count} GitHub Actions workflows live in \`.github/workflows/\`. ${w.note}`,
    ``,
    `The test suite (\`${ci.workflow}\`) is one of the manual ones: ${ci.trigger.detail}`,
  ].join("\n");
}

/** Repo stats, or nothing at all if they could not be fetched. */
function renderRepo(): string {
  if (!repoStats.live && repoStats.stars === 0) {
    return `_Repository statistics are unavailable at build time and were omitted rather than published stale._`;
  }
  const asOf = repoStats.staleSince
    ? ` _(cached; last live fetch ${repoStats.staleSince.slice(0, 10)})_`
    : "";
  return [
    table(
      ["Stars", "Forks", "Contributors", "Visibility"],
      [[String(repoStats.stars), String(repoStats.forks), String(repoStats.contributors), repoStats.visibility]],
    ),
    ``,
    `_Fetched from the GitHub API${asOf}. Refresh with \`npm run docs:repo-facts\`._`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Block registry
// ---------------------------------------------------------------------------

const BLOCKS: Record<string, () => string> = {
  version: renderVersion,
  layers: renderLayers,
  "risk-table": renderRiskTable,
  ci: renderCI,
  benchmarks: renderBenchmarks,
  license: renderLicense,
  network: renderNetwork,
  repo: renderRepo,
  /** AGENTS.md only */
  protocols: renderProtocols,
  workflows: renderWorkflows,
  /** AI-GUIDE.md only */
  "current-version": renderCurrentVersion,
};

/**
 * Each file owns its own set of blocks. A block is only required where a target
 * declares it, so AGENTS.md does not have to carry the README's risk table and
 * vice versa.
 */
const README_ONLY = new Set(["protocols", "workflows", "current-version"]);
const TARGETS: { path: string; blocks: string[] }[] = [
  { path: join(REPO, "README.md"), blocks: Object.keys(BLOCKS).filter((n) => !README_ONLY.has(n)) },
  { path: join(REPO, "AGENTS.md"), blocks: ["protocols", "workflows"] },
  {
    path: join(LANDING, "AI-GUIDE.md"),
    blocks: ["current-version", "risk-table"],
  },
];

/**
 * Whole files that are copied out of the landing repository into the monorepo.
 *
 * `Aartiq/Landing_Page/` predates the site moving to its own repository. Rather
 * than delete content the user may still want, `docs:sync` keeps the residual
 * copy identical to the canonical one — a copy that has drifted is worse than no
 * copy at all. `check-docs.ts` fails on `[dup]` if they ever diverge.
 */
const MIRRORS: { source: string; dest: string }[] = [
  {
    source: join(LANDING, "AI-GUIDE.md"),
    dest: join(REPO, "Landing_Page", "AI-GUIDE.md"),
  },
  {
    source: join(LANDING, "src", "lib", "release-notes.ts"),
    dest: join(REPO, "Landing_Page", "src", "lib", "release-notes.ts"),
  },
];

/** Replace one block's contents, or report it as missing. */
function replaceBlock(md: string, name: string, body: string): { md: string; status: "ok" | "missing" } {
  const s = start(name);
  const e = end(name);
  const si = md.indexOf(s);
  const ei = md.indexOf(e);
  if (si === -1 || ei === -1 || ei < si) return { md, status: "missing" };
  return { md: `${md.slice(0, si + s.length)}\n${body}\n${md.slice(ei)}`, status: "ok" };
}

function main() {
  const check = process.argv.includes("--check");
  const problems: string[] = [];

  for (const target of TARGETS) {
    if (!existsSync(target.path)) {
      problems.push(`marker target not found: ${target.path}`);
      continue;
    }
    let md = readFileSync(target.path, "utf8");
    const missing: string[] = [];
    const stale: string[] = [];

    for (const name of target.blocks) {
      const before = md;
      const res = replaceBlock(md, name, BLOCKS[name]());
      md = res.md;
      if (res.status === "missing") missing.push(name);
      else if (check && before !== md) stale.push(name);
    }

    if (missing.length) problems.push(`${target.path}: missing marker blocks: ${missing.join(", ")}`);
    if (stale.length) problems.push(`${target.path}: out-of-date marker blocks: ${stale.join(", ")}`);

    if (check) continue;
    writeFileSync(target.path, md);
    console.log(
      `Synced ${target.blocks.length - missing.length}/${target.blocks.length} block(s) into ${target.path}`,
    );
  }

  // Residual copies: either verify they match (check) or refresh them (sync).
  for (const m of MIRRORS) {
    if (!existsSync(m.source)) {
      problems.push(`mirror source not found: ${m.source}`);
      continue;
    }
    const src = readFileSync(m.source, "utf8");
    const dest = existsSync(m.dest) ? readFileSync(m.dest, "utf8") : null;
    if (check) {
      if (dest === null) problems.push(`mirror destination missing: ${m.dest}`);
      else if (dest !== src) problems.push(`${m.dest} has drifted from ${m.source}`);
      continue;
    }
    if (dest !== src) {
      writeFileSync(m.dest, src);
      console.log(`Mirrored ${relative(REPO, m.source)} → ${relative(REPO, m.dest)}`);
    }
  }

  if (check) {
    if (problems.length) {
      console.error(`Marker blocks are out of sync with the SSOT:\n  ${problems.join("\n  ")}`);
      console.error("Run: npm run docs:sync");
      process.exit(1);
    }
    console.log("All marker blocks are up to date.");
    return;
  }

  if (problems.length) {
    for (const p of problems) console.warn(`! ${p}`);
  }
}

main();

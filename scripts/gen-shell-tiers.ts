/**
 * gen-shell-tiers.ts — generate the published shell-risk table from the code that enforces it.
 *
 * Writes Aartiq-Landing-Page/src/data/shell-tiers.generated.json
 *
 * Why this exists: the landing pages published a hand-written four-row risk table
 * for months. It described a startup session grant that auto-approved low and
 * medium commands by default, which is not what the code has done since the
 * defaults were fixed, and it listed `medium` as the default tier for every
 * command that was not a regex-detected destructive pattern, which was true only
 * because the classifier had no `low` tier at all.
 *
 * A hand-maintained table about a classifier is a table that will be wrong. This
 * reads `src/lib/shell-command-tiers.js` — the single table the runtime
 * classifier and the "Allow Always" rule both use — and writes out what it finds.
 * If a command changes tier, `npm run docs:check` fails until the published
 * numbers are regenerated.
 *
 * The prose about *approval behaviour* stays in project-facts.ts; only the facts
 * that the code can answer are generated here. A generator cannot tell you why a
 * limit exists, and a limit that is only asserted by a generator is not a limit.
 *
 * Usage:
 *   node scripts/gen-shell-tiers.ts            # write the file
 *   node scripts/gen-shell-tiers.ts --check     # fail if the file is stale
 */

import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GeneratedShellTiers } from "../../Aartiq-Landing-Page/src/data/project-facts.ts";

const REPO = join(import.meta.dirname, "..");
const SOURCE = join(REPO, "aartiq-browser", "src", "lib", "shell-command-tiers.js");

/**
 * The landing page is a separate repository that normally sits beside this one.
 * `AARTIQ_LANDING_DIR` overrides that, which is what a git worktree or a CI
 * checkout needs: inside a worktree the sibling path is not the landing repo, and
 * writing to it would edit the wrong tree.
 */
const LANDING = process.env.AARTIQ_LANDING_DIR ?? join(REPO, "..", "Aartiq-Landing-Page");
const OUT = join(LANDING, "src", "data", "shell-tiers.generated.json");

/** The tier module is CommonJS; this file is TypeScript run by Node's type stripping. */
const require_ = createRequire(import.meta.url);
const tiers = require_(SOURCE) as {
  SHELL_TIERS: Record<string, string>;
  TIER_RANK: Record<string, number>;
  CAPABILITIES: Record<string, string>;
  NON_LOW_CAPABILITIES: Set<string>;
  BLOCKED_COMMANDS: Set<string>;
  SHELL_COMMAND_TIERS: Record<string, { tier: string; caps: string[]; note?: string }>;
  NEVER_ALWAYS_ELIGIBLE: Set<string>;
  classifyShellCommand: (command: string) => {
    tier: string;
    reason: string;
    known: boolean;
    hasUrl: boolean;
    binary: string;
  };
  alwaysApprovalEligibility: (command: string) => { eligible: boolean; reason: string | null };
  isAutoApproveEligibleTier: (tier: string) => boolean;
};

/**
 * Commands probed so the generated file records observed classification, not just
 * the table's intent. Each is a real example a reader would try.
 *
 * `chmod` is here on purpose. It reads like a medium command, but it already
 * matched a destructive pattern and stayed high; moving it down would have been
 * the one edit in that work that weakened a default, so the published table says
 * high and a reader can see why.
 */
const PROBES = [
  "ls -la",
  "cat notes.md",
  "pwd",
  "find . -name '*.md'",
  "grep -r pattern .",
  "echo hello",
  "cp notes.md notes.bak",
  "mv a b",
  "mkdir new-dir",
  "chmod 644 file",
  "npm install left-pad",
  "git clone https://example.com/repo",
  "curl https://example.com",
  "wget https://example.com/file",
  "osascript -e 'tell application Finder to activate'",
  "node script.js",
  "open -a Calculator",
  "some-tool --version",
  "find . -delete",
  "kill -9 1234",
  "dd if=/dev/zero of=/dev/sda",
  "cat https://example.com/page.html",
];

function build(): GeneratedShellTiers {
  const entries = Object.entries(tiers.SHELL_COMMAND_TIERS)
    .map(([binary, entry]) => ({
      binary,
      tier: entry.tier,
      // Stable ordering so the generated file does not churn between runs.
      caps: [...entry.caps].sort(),
      ...(entry.note ? { note: entry.note } : {}),
    }))
    .sort((a, b) => a.binary.localeCompare(b.binary));

  const probes = PROBES.map((command) => {
    const verdict = tiers.classifyShellCommand(command);
    return {
      command,
      tier: verdict.tier,
      reason: verdict.reason,
      /** Whether the binary is in the table at all, as opposed to falling back. */
      knownBinary: verdict.known,
      alwaysGrantEligible: tiers.alwaysApprovalEligibility(command).eligible,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    source: "aartiq-browser/src/lib/shell-command-tiers.js",
    tiers: tiers.SHELL_TIERS,
    capabilities: tiers.CAPABILITIES,
    /**
     * The four rules the table declares. Published as data so a reader can check
     * a command against them, and asserted directly in
     * tests/shell-command-tiers.test.js so an edit that breaks one fails there.
     */
    invariants: [
      "No command that can write, reach the network, run code or change permissions is low.",
      "A destructive pattern raises the tier and never lowers one.",
      "An unknown binary is medium, never low.",
      "A URL anywhere in the arguments rules out low.",
    ],
    autoApprove: {
      /** The only setting that can let a shell command run without a dialog. */
      setting: "autoApproveLowRiskShell",
      defaultValue: false,
      /** The legacy alias, still honoured so an existing profile is not silently stricter. */
      legacyAlias: "autoApproveLowRisk",
      /** Which tiers it covers. */
      tiers: Object.keys(tiers.SHELL_TIERS).filter((t) => tiers.isAutoApproveEligibleTier(t)),
      appliesTo: "shell commands only",
      doesNotApply: "autoApproveMidRisk no longer reaches the shell path; it still applies to MCP tool actions.",
    },
    alwaysGrant: {
      scope: "the full normalised command line",
      note:
        "Keyed on the whole command, not the first word. Eligibility is an allow-list, " +
        "not a deny-list: an Allow Always grant requires a binary that appears in the table " +
        "below, so a binary we have never classified is offered Allow Once only. Withheld " +
        "also for network-capable, script-capable and destructive commands, and for any " +
        "command with a URL in its arguments. Every grant expires after 30 days and the " +
        "dialog asks again. Allow Once is always available.",
      neverEligible: [...tiers.NEVER_ALWAYS_ELIGIBLE].sort(),
    },
    blockedCommands: [...tiers.BLOCKED_COMMANDS].sort(),
    counts: {
      commandsInTable: entries.length,
      low: entries.filter((e) => e.tier === tiers.SHELL_TIERS.LOW).length,
      medium: entries.filter((e) => e.tier === tiers.SHELL_TIERS.MEDIUM).length,
      high: entries.filter((e) => e.tier === tiers.SHELL_TIERS.HIGH).length,
      critical: entries.filter((e) => e.tier === tiers.SHELL_TIERS.CRITICAL).length,
      blocked: tiers.BLOCKED_COMMANDS.size,
    },
    entries,
    probes,
  };
}

function main() {
  const check = process.argv.includes("--check");
  const next = JSON.stringify(build(), null, 2) + "\n";

  if (check) {
    let current = "";
    try {
      current = readFileSync(OUT, "utf8");
    } catch {
      console.error(`! ${OUT} does not exist — run: npm run docs:shell-tiers`);
      process.exit(1);
    }
    // generatedAt is the only field expected to differ between runs.
    const strip = (s: string) => s.replace(/"generatedAt": "[^"]*"/, '"generatedAt": "<stale>"');
    if (strip(current) !== strip(next)) {
      console.error("! shell-tiers.generated.json is stale — run: npm run docs:shell-tiers");
      process.exit(1);
    }
    console.log("shell tiers: generated file is up to date");
    return;
  }

  writeFileSync(OUT, next);
  const parsed = JSON.parse(next) as GeneratedShellTiers;
  console.log(
    `shell tiers: ${parsed.counts.commandsInTable} commands ` +
      `(${parsed.counts.low} low / ${parsed.counts.medium} medium / ${parsed.counts.high} high), ` +
      `${parsed.counts.blocked} blocked, ${parsed.probes.length} probes`,
  );
}

main();

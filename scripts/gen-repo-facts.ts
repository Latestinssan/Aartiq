/**
 * gen-repo-facts.ts — fetch repository stats from the GitHub API, with a cached fallback.
 *
 * Writes Aartiq-Landing-Page/src/data/repo-facts.generated.json
 *
 * Star/fork/contributor counts rot constantly, so they are fetched rather than
 * typed. If the fetch fails (offline, no `gh`, rate-limited) the previous cached
 * file is reused and flagged `live: false` + `staleSince`, so a page can decide
 * to omit the number instead of publishing something knowingly out of date.
 *
 * Usage:
 *   node scripts/gen-repo-facts.ts
 *   node scripts/gen-repo-facts.ts --offline     # keep whatever is cached
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { GeneratedRepoFacts } from "../../Aartiq-Landing-Page/src/data/project-facts.ts";

const REPO = join(import.meta.dirname, "..");
const OUT = join(REPO, "..", "Aartiq-Landing-Page", "src", "data", "repo-facts.generated.json");
const SLUG = "Latestinssan/Aartiq";

function gh(args: string[]): string | null {
  const res = spawnSync("gh", ["api", ...args], { encoding: "utf8" });
  return res.status === 0 ? (res.stdout ?? "").trim() : null;
}

function readCache(): GeneratedRepoFacts | null {
  if (!existsSync(OUT)) return null;
  try {
    return JSON.parse(readFileSync(OUT, "utf8")) as GeneratedRepoFacts;
  } catch {
    return null;
  }
}

function main() {
  const offline = process.argv.includes("--offline");
  const cache = readCache();

  if (offline) {
    if (!cache) throw new Error("--offline but no cached repo-facts.generated.json exists");
    console.log("offline: keeping cached repo facts");
    return;
  }

  const meta = gh([`repos/${SLUG}`, "--jq", "{full_name,stargazers_count,forks_count,created_at,pushed_at,visibility}"]);
  if (!meta) {
    if (cache) {
      console.warn(`! could not reach the GitHub API — reusing cache from ${cache.generatedAt}`);
      const stale: GeneratedRepoFacts = { ...cache, live: false, staleSince: cache.staleSince ?? cache.generatedAt };
      writeFileSync(OUT, JSON.stringify(stale, null, 2) + "\n");
      return;
    }
    console.warn(`! could not reach the GitHub API and no cache exists — writing a zeroed, non-live record.`);
    const empty: GeneratedRepoFacts = {
      generatedAt: new Date().toISOString(),
      live: false,
      fullName: SLUG,
      stars: 0,
      forks: 0,
      contributors: 0,
      createdAt: "",
      pushedAt: "",
      visibility: "unknown",
      staleSince: new Date().toISOString(),
    };
    mkdirSync(join(OUT, ".."), { recursive: true });
    writeFileSync(OUT, JSON.stringify(empty, null, 2) + "\n");
    return;
  }

  const repo = JSON.parse(meta);
  // --paginate with -q prints one login per line.
  const contribRaw = gh([`repos/${SLUG}/contributors`, "--paginate", "--jq", ".[].login"]);
  const contributors = contribRaw ? contribRaw.split("\n").filter(Boolean).length : 0;

  const facts: GeneratedRepoFacts = {
    generatedAt: new Date().toISOString(),
    live: true,
    fullName: repo.full_name,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    contributors,
    createdAt: repo.created_at,
    pushedAt: repo.pushed_at,
    visibility: repo.visibility,
  };

  mkdirSync(join(OUT, ".."), { recursive: true });
  writeFileSync(OUT, JSON.stringify(facts, null, 2) + "\n");
  console.log(`Wrote ${OUT}`);
  console.log(`  ${facts.stars} stars · ${facts.forks} forks · ${facts.contributors} contributors · ${facts.visibility}`);
}

main();

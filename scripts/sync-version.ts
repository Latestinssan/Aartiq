/**
 * sync-version.ts — keep aartiq-browser/package.json and flutter_browser_app/pubspec.yaml
 * from drifting apart.
 *
 * Why this exists
 * ---------------
 * One git tag covers both deliverables (the Electron desktop app and the Flutter
 * mobile companion), but each kept its own version. `auto-tag.yml` and `release.yml`
 * both derive the release tag from `aartiq-browser/package.json`, so package.json was
 * effectively the source of truth — while pubspec.yaml silently rotted. At the time of
 * writing: package.json 0.3.7, pubspec 0.3.5+10, newest tag v0.3.7. Every Android build
 * therefore shipped versionName 0.3.5.
 *
 * The `+N` build number is the part that actually hurts. Nothing in CI passed
 * `--build-number`, so Flutter fell back to pubspec's `+10` on every run: versionCode was
 * pinned at 10 across v0.3.5 → v0.3.7 and Google Play rejects a re-used versionCode on
 * the second upload. Deriving it from semver (major*1000000 + minor*1000 + patch) makes it
 * increase automatically whenever the version does, so nobody has to remember.
 *
 * Usage:
 *   node scripts/sync-version.ts                  # sync pubspec from package.json
 *   node scripts/sync-version.ts --check          # exit 1 if drifted (for CI)
 *   node scripts/sync-version.ts set 0.3.8        # set both, then sync
 *   node scripts/sync-version.ts --preserve-build # keep the existing +N, change name only
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "..");
const PKG = join(REPO, "aartiq-browser", "package.json");
const PUBSPEC = join(REPO, "flutter_browser_app", "pubspec.yaml");

/** Semver build number, e.g. 0.3.8 -> 3008. Monotonic while versions increase. */
function buildNumberFor(version: string): number {
  const core = version.split("-")[0]; // drop prerelease suffix (0.3.8-rc.1 -> 0.3.8)
  const parts = core.split(".").map((n) => Number.parseInt(n, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`cannot derive a build number from "${version}" — expected major.minor.patch`);
  }
  const [major, minor, patch] = parts;
  const build = major * 1_000_000 + minor * 1_000 + patch;
  if (build > 2_100_000_000) throw new Error(`build number ${build} exceeds the Android maximum`);
  return build;
}

type PubspecVersion = { name: string; build: number | null };

function readPubspecVersion(): PubspecVersion {
  // [^\S\n] is "whitespace except newline". A plain \s would swallow the line
  // break and the blank line after it when matching in multiline mode.
  const line = readFileSync(PUBSPEC, "utf8").match(/^version:[^\S\n]*(\S+)[^\S\n]*$/m);
  if (!line) throw new Error(`no top-level "version:" line found in ${PUBSPEC}`);
  const [name, build] = line[1].split("+");
  return { name, build: build === undefined ? null : Number.parseInt(build, 10) };
}

/** Rewrite only the `version:` line, leaving the rest of the YAML byte-for-byte alone. */
function writePubspecVersion(next: string): boolean {
  const src = readFileSync(PUBSPEC, "utf8");
  const updated = src.replace(/^version:[^\S\n]*\S+[^\S\n]*$/m, `version: ${next}`);
  if (updated === src) return false;
  writeFileSync(PUBSPEC, updated);
  return true;
}

function pkgVersion(): string {
  return JSON.parse(readFileSync(PKG, "utf8")).version as string;
}

function pkgSetVersion(version: string): boolean {
  const src = readFileSync(PKG, "utf8");
  const match = src.match(/^(\s*"version"\s*:\s*)"([^"]*)"/m);
  if (!match) throw new Error(`could not find a "version" field in ${PKG}`);
  if (match[2] === version) return false; // already correct — a no-op, not an error
  writeFileSync(PKG, src.replace(/^(\s*"version"\s*:\s*)"[^"]*"/m, `$1"${version}"`));
  return true;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const preserveBuild = args.includes("--preserve-build");

  if (args[0] === "set") {
    const version = args[1];
    if (!version) throw new Error('usage: sync-version.ts set <major.minor.patch>');
    buildNumberFor(version); // validate the shape *before* touching package.json
    console.log(
      pkgSetVersion(version) ? `package.json -> ${version}` : `package.json already at ${version}`,
    );
  }

  const version = pkgVersion();
  const current = readPubspecVersion();
  const build = preserveBuild ? current.build : buildNumberFor(version);
  if (build === null) throw new Error(`pubspec.yaml has no build number and --preserve-build was passed`);

  const want = `${version}+${build}`;
  const have = `${current.name}+${current.build}`;

  if (have === want) {
    console.log(`in sync: package.json ${version} / pubspec.yaml ${have}`);
    return;
  }

  if (check) {
    console.error(
      `version drift:\n` +
        `  aartiq-browser/package.json  ${version}\n` +
        `  flutter_browser_app/pubspec  ${have}\n` +
        `\nThe release tag comes from package.json, so the mobile app would ship a stale\n` +
        `versionName. Fix with:  npm run version:sync`,
    );
    process.exitCode = 1;
    return;
  }

  writePubspecVersion(want);
  console.log(`pubspec.yaml: ${have} -> ${want}`);
  if (preserveBuild) console.log(`  (build number held at ${build} because of --preserve-build)`);
  console.log(`  versionCode that Play will see: ${build}`);
}

try {
  main();
} catch (err) {
  console.error(`sync-version: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
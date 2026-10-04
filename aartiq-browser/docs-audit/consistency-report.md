# Documentation Consistency Audit

**Audited:** 2026-10-03
**Scope:** `Aartiq/README.md`, `Aartiq-Landing-Page/` (homepage + all `/docs` pages), `Aartiq/release_notes/`
**Method:** every value below was verified against source, a live `jest` run, or the GitHub API. Nothing is asserted from prose.
**Rule applied:** code wins. Where docs disagreed with code, the doc is the defect.

Repositories audited:

| Repo | Remote | Role |
|---|---|---|
| `Aartiq/` | `Latestinssan/Aartiq` (public) | Product monorepo, README, release notes, CI |
| `Aartiq-Landing-Page/` | `Preet3627/Aartiq-Landing-Page` (private) | Next.js site that is actually built and deployed |

---

## Verification evidence used

| Evidence | How obtained |
|---|---|
| Test counts (local, macOS/arm64) | `npx jest --ci --runInBand --forceExit --json` — 577 declared, 551 passed, 26 skipped, 0 failed |
| Test counts (CI, run `34769503518`) | `gh api .../actions/jobs/<id>/logs` — jest summary lines from all four jobs |
| CI trigger policy | `.github/workflows/jest.yml` read in full |
| Run metadata | `gh api repos/Latestinssan/Aartiq/actions/runs/34769503518` |
| Repo stats | `gh api repos/Latestinssan/Aartiq` and `/contributors --paginate` |
| Release metadata | `gh api repos/Latestinssan/Aartiq/releases/latest` |
| Command count | `COMMAND_REGISTRY` at `src/lib/AICommandParser.ts:62-136`, 73 keys enumerated |
| Risk tiers / allowlist | `src/core/command-validator.js`, `src/core/capability-controller.js`, `src/core/shell-permission-bridge.js`, `src/lib/SecurityValidator.js`, `src/lib/permission-store.js`, `src/core/directory-allowlist.js` |
| Ports / bind addresses | every `.listen(` / `WebSocketServer` / `createServer` in `aartiq-browser/` |

---

## 1. Master consistency table

`✓` = doc matches code · `✗` = doc contradicts code · `?` = unsourced, no backing artifact

| # | Fact | Locations and their values | Verified value | Source of truth |
|---|---|---|---|---|
| 1 | **Version** | README badge `0.3.7` (:10); README "Current release: v0.3.7" (:255); homepage "release v0.3.7" (:1163); security page `577`/`537` context | `0.3.7` | `aartiq-browser/package.json:3`; release tag `v0.3.7` |
| 2 | **Release date** | not stated anywhere | `2026-09-13T14:43:57Z` | `gh api .../releases/latest` |
| 3 | **Security layer count** | **README: `three-layer`?** no — README silent; `AI-GUIDE.md:68` "Three-layer"; `docs/metadata.ts:83` "Three-layer"; `docs/overview/page.tsx:45,156` "Three-Layer"; `llms-full.txt/route.ts:140` "three-layer"; `layout.tsx:198` "Three-Layer"; `page.tsx:84` "Three-Layer"; `Features.tsx:26` "Three-Layer"; `search-index.ts:219` "Three-layer" — **vs** `features/page.tsx:667` "six-layer"; `security/page.tsx:414,453,469` "six layers"; `llms.txt/route.ts:20,27,62` "Six-layer"; `AGENTS.md:15` "six-layer" | **6** | `release_notes/v0.3.5.md:28` "expanded from 3 layers to 6 layers"; `security/page.tsx:414` enumerates all six |
| 4 | **Passing tests** | README "537 passed" (:157); `security/page.tsx:1257` "537 passing"; `page.tsx:100` `"537"`; `page.tsx:958` "537 Automated Tests"; `page.tsx:959` "537 passing"; `docs/testing/page.tsx:55,101` "537" | **CI (ubuntu): 537** · **local (macOS): 551** | job log `103756390843`; local jest JSON |
| 5 | **Declared tests** | README "577 declared" (:157); `security/page.tsx:1256`; `docs/testing/page.tsx:55,96` | **577** (both platforms) | both jest runs |
| 6 | **Skipped tests** | README "40 environment-skipped" (:157); `page.tsx:959` "40 environment-skipped"; `docs/testing/page.tsx:107` "40" | **CI: 40** · **local macOS: 26** | job log; local jest JSON |
| 7 | **Skip reasons** | README (:164) names only the CRX3 verifier | CI 40 = CRX3 **3** + platform **25** (win 5 + linux 7 + automation) … see §3 | local jest JSON + test sources |
| 8 | **CI run id / trigger** | README "dispatched on demand … #34769503518" (:155); `docs/testing/page.tsx:55` "run 34769503518" | run `34769503518`, **`workflow_dispatch`**, run #52, head `acc703ae`, all 4 jobs `success` | `jest.yml` `on:` block; `gh api` |
| 9 | **CI job count** | README "all four jobs" (:155) | **4 job definitions**, all green on that run (conditionals can reduce to 3 or 1) | `jest.yml` |
| 10 | **Windows job tests** | README "61 passed / 30 platform-skipped" (:158); `docs/testing/page.tsx:55` "91 = green" | **61 passed / 30 skipped / 91** | job log `103756390761` |
| 11 | **macOS job tests** | README "104 passed" (:159); `docs/testing/page.tsx:55` "104" | **104 passed / 104** | job log `103756390919` |
| 12 | **Linux job tests** | README "57 passed / 21 skipped" (:160); `docs/testing/page.tsx:55` "78" | **57 passed / 21 skipped / 78** | job log `103756390895` |
| 13 | **AI command count** | homepage `page.tsx:101` `"AI Commands", "25"` | **73** | `COMMAND_REGISTRY`, `AICommandParser.ts:63-135` (73 contiguous keys; 72 distinct — `ANALYSE_TABS`/`ANALYZE_TABS` are duplicates) |
| 14 | **IPC channels "22 gated / 9 monitoring-only"** | asserted in task brief; sourced to `docs-audit/action-inventory.md` | **UNSOURCED — these numbers do not exist in that file** | `action-inventory.md` contains no `22`, no `9`, and no count of either kind |
| 15 | **MCP bridge bind address** | `mcp-settings/page.tsx:194` "The MCP bridge and the agent API bind to 127.0.0.1 by default (0.0.0.0 only if remote is explicitly enabled). Nothing in the MCP stack listens on an external interface." | **FALSE.** Binds **all interfaces**, unconditionally. `this.httpServer.listen(port, cb)` — no host argument. `CORS: *`. No connect auth (SSE auto-confirms the pairing token). | `src/lib/mcp-browser-server.js:1619-1624`, `:1518-1521`, `:1574-1578` |
| 16 | **WiFi sync bind address** | implied localhost by `AGENTS.md` port table | **Binds all interfaces.** `new WebSocketServer({ port })` — no `host` option | `src/lib/WiFiSyncService.ts:65` |
| 17 | **Native bridge auth** | `CHANGELOG.md:246` "Secure token-based auth via `~/.aartiq-token`" | **Token is sent by clients and never read by the server.** No `req.headers` auth anywhere in `main.js` | `main.js:1236-1237`, `:1859`; clients `scripts/aartiq-cli.js:286-290` |
| 18 | **Native bridge bind** | — | `127.0.0.1`, hard-coded literal, no override | `main.js:1859` |
| 19 | **Agent API bind** | `docs/skills/page.tsx:102` "binds to 127.0.0.1 by default (0.0.0.0 only if remote is enabled)" | Correct, and additionally: `remote` is `false` by default and **no code path anywhere sets it true** | `src/lib/agent-api/providers.ts:21,25,77-80` |
| 20 | **Port 46203** | not mentioned | **Claimed by two servers at once** — agent-api (`providers.ts:21`) and native Express bridge (`main.js:1079`) both default to `46203`/`127.0.0.1`. The bridge's `EADDRINUSE` is logged and swallowed (`main.js:1863-1865`). | `TODO(verify)` — inferred from call order (`startAgentApi` `main.js:6063` precedes `startNativeMacUiBridge` `main.js:9104`), **not observed at runtime** |
| 21 | **Undocumented listener** | absent from all docs | Background service binds **`0.0.0.0:3999`**, serves `~/Documents/Aartiq/public`, `CORS: *`, no auth | `src/service/service-main.js:255,261,209` |
| 22 | **Nexus bridge :9922** | `AGENTS.md` "Communication Protocols" table | **NOT FOUND** in the tree. Dead variable only | `main.js:1057`, `:9070-9072` |
| 23 | **UDP 3005** | `AGENTS.md` "UDP 3005 device discovery" | Port is a **broadcast send destination**, not a listener; the socket binds ephemeral `0` | `WiFiSyncService.ts:172,189` |
| 24 | **Workflow count** | `AGENTS.md` "14 GitHub Actions workflows" | **13** | `ls .github/workflows/` |
| 25 | **Workflow triggers** | `AGENTS.md` "All workflows are triggered manually or by tag push" | 11 of 13 are `workflow_dispatch` only; `release.yml` and `sync-component-docs.yml` are `push` | per-file `on:` blocks |
| 26 | **Platforms** | homepage `"Platforms", "4"`; README install table 4 rows | 4 *distributed* (Win/macOS/Linux/Android). **iOS is also built in CI** (`flutter build ios --release --no-codesign`) but unsigned and not distributed | `build.yml:12,55` |
| 27 | **Microsoft Store** | README badge + table row | Well evidenced: MSIX workflow, publisher DN, Store-aware updater | `windows-msix.yml`, `package.json:190` |
| 28 | **Benchmark numbers** | README 0.32s / 0.31s / <1% (:258-262); `docs/overview/page.tsx:381-499` | **?** No benchmark script, raw result file, or instrumentation exists in either repo | searched exhaustively |
| 29 | **"All benchmark scripts are included in the repository"** | `docs/overview/page.tsx:399` | **FALSE.** No such script exists | — |
| 30 | **Benchmark version label** | README "Benchmark version: v0.3.4" + "Current release: v0.3.7" (:254-255) | Correctly labeled, and stale by 3 releases. This is the *good* pattern — see `check-docs.ts` rule (c) | — |
| 31 | **Browser license** | README table "Aartiq Browser … Apache License 2.0" (:427); `AGENTS.md`; badge (:9) | **CONFLICT.** Root `LICENSE` is Apache-2.0, but `aartiq-browser/LICENSE.txt` is a **restrictive EULA** (no modification, no derivative works, no redistribution) and it is the license the Windows NSIS installer displays (`package.json:190`) | see §4 — **legal, needs human decision** |
| 32 | **MCP license** | README "MIT" (:428) | **MIT** ✓ | `aartiq-mcp/LICENSE:1-3`, `aartiq-mcp/package.json:10` |
| 33 | **Trademark paragraph** | README (:434-440); restates the Apache grant "permits modification and redistribution" | Internally contradicts finding 31 — an EULA grants neither | see §4 |
| 34 | **Landing page license** | not stated | No `LICENSE` file, no `license` field, `"private": true` | `Aartiq-Landing-Page/package.json` |
| 35 | **AI providers** | README lists 10 (:232-242) | All 10 exist. **xAI and Azure have no provider class** (routed via OpenAI-compatible, absent from `LLMProviderId`); **LM Studio is agent-bridge-only** — no UI lets a user pick it as a chat provider | `llm-factory.ts:8-18`, `agent-api/providers.ts:22-39` |
| 36 | **Undocumented providers** | absent from README | `deepseek`, `openrouter`, `cerebras`, `llama` are in the factory but in no UI list | `llm-factory.ts:12,16-18` |
| 37 | **Provider count badge** | `AISetupGuide.tsx:572` "All 8 Providers" | Array at `:389-462` has **9** entries | — |
| 38 | **Critical risk tier** | README table "Explicit authorization; never silently auto-approved" (:88); `security/page.tsx:910` "never auto-approved" | **No registry ever assigns `critical`.** It is only synthesized at runtime by remote-origin escalation. Deny-at-gate is real and unconditional, but then un-denied by a plain Allow/Deny dialog — **no biometric, no QR** on the desktop shell path | `command-validator.js:85-89`, `main/handlers/utils.js:223-229`, `sync-handlers.js:232-236` |
| 39 | **Low/medium auto-approve** | docs imply low = "Automatic / policy-controlled", medium = "Explicit approval" (README :85-86) | **medium is auto-approved by default** via an unconditional session grant at startup; so is low | `main.js:826-831`, `permission-store.js:299` |
| 40 | **Risk is per-capability** | README :90 "assigned to the capability … rather than inferred from prompt text" | **Correct for AI/MCP actions, wrong for shell strings** — raw shell risk is inferred from command text (`getShellRisk` → regex) | `capability-controller.js:30`; `SecurityValidator.js:164-168` |
| 41 | **Default directory allowlist** | `security/page.tsx:170` "restricted to explicitly approved directories"; `system-handlers.js:9-11` comment lists Home/Desktop/Documents/Downloads | **Two conflicting defaults are live at once.** `directory-allowlist.js:24-43` grants only app-data + tmp (and a test forbids the home grant), but `permission-store.js:8-16` — the module actually consumed by `getAllowedDirectories()` — still seeds **read-write across all of `$HOME`** | see §5 |
| 42 | **Command policy** | not documented | `config/command-policy.json` blocks 24 commands (incl. `curl`, `wget`) and requires approval for ~50 more; the legacy fallback policy blocked only 7 with an empty approval list | `config/command-policy.json`; `lib/command-validator.js:45-52` |
| 43 | **"1 CM" story** | homepage `:781`, `:1364`, `:1376-1379` (3×); `docs/overview/page.tsx:576-579` | Duplicate within homepage — needs to appear **once per page** | — |
| 44 | **Tagline** | `og-image.tsx:118`; `docs/overview/page.tsx:204`; README header + footer | Consistent wording, different pages | — |
| 45 | **Self-labels** | `page.tsx:927` "Inspect, don't trust"; `page.tsx:964` "Honest Limitations"; `docs/testing/page.tsx:204` "Honesty First"; `mcp-settings/page.tsx:426` "Why this page is honest…"; `security/page.tsx:218,588` "Honest macOS residual" / "Honest limits"; `features/page.tsx:551` "No marketing language" | Must be removed per task rules; content retained | — |
| 46 | **`docs-audit/action-inventory.md` staleness** | `:101,108` "Line 107: `return true` — no real check" | **Fixed since** — `command-validator.js:74-75` documents replacing the no-op | — |

---

## 2. The three-layer / six-layer split

This is the single largest consistency defect: **nine landing-page locations still describe a model the project abandoned in v0.3.5.**

Ground truth, from `release_notes/v0.3.5.md:28` and the enumerated model at `security/page.tsx:414`:

1. visual sandbox & SecureDOM
2. syntactic firewall
3. human-in-the-loop
4. directory allowlist
5. OS-level sandboxing (Seatbelt / bubblewrap / AppContainer + Job Object)
6. capability-scoped execution

Fixed: `security/page.tsx` (already correct), `features/page.tsx:667`, `llms.txt/route.ts`, `AGENTS.md`.
Stale "three-layer": `AI-GUIDE.md:68`, `docs/metadata.ts:83`, `docs/overview/page.tsx:45` + `:156`, `llms-full.txt/route.ts:140`, `layout.tsx:198`, `page.tsx:84`, `Features.tsx:26`, `search-index.ts:219`.

The stale string also survives inside historical release notes (`release-notes.ts:839`, "Three-layer security model") — that one is **correct and must stay**, because it describes the model as it stood in v0.3.0.

---

## 3. Test counts are environment-specific — the reason they must be generated

This is the finding that justifies Phase 2 outright. Same commit, same 577 declared tests, two different pass/skip splits:

| Suite | macOS (local, this audit) | Ubuntu (CI run `34769503518`) |
|---|---|---|
| Passing | **551** | **537** |
| Skipped | **26** | **40** |
| Declared | 577 | 577 |
| Suites | 1 skipped, 25 passed / 26 | 1 skipped, 25 passed / 26 |

Skip breakdown, macOS run, by reason:

| Reason | Count | Suites | Evidence |
|---|---|---|---|
| Missing native tooling | 11 | `automation` | `tests/automation.test.js:6-10` — registers `it.skip` when the native backend is absent (`xdotool`/`xte` on Linux; `cliclick` on macOS — confirmed in run output) |
| Platform-skipped (Linux) | 7 | `linux-bwrap-sandbox` | requires Linux + bubblewrap |
| Platform-skipped (Windows) | 5 | `windows-job-sandbox` | requires Windows AppContainer |
| **CRX3 verifier bug** | **3** | `extensions.crx-verifier` | `src/tests/extensions.crx-verifier.test.ts:13-15` — `describe.skip`, Node 24 / OpenSSL header-parse hang |

11 + 7 + 5 + 3 = **26** ✓ and the CRX3 figure is **3**, matching the task brief exactly.

Conclusion: `537` and `40` are *ubuntu* numbers and `551`/`26` are *macOS* numbers. Typing either into a page guarantees it is wrong for someone. These must be generated per-environment and labelled with the environment.

Per-suite generated table (macOS run), for reference:

| Suite | Pass | Skip | Declared |
|---|---:|---:|---:|
| sandbox-security | 64 | 0 | 64 |
| extraction | 58 | 0 | 58 |
| skill-loading | 54 | 0 | 54 |
| tab-intelligence | 51 | 0 | 51 |
| security-validator | 42 | 0 | 42 |
| security-fixes | 40 | 0 | 40 |
| dom-engine | 40 | 0 | 40 |
| component-tests | 37 | 0 | 37 |
| directory-allowlist | 36 | 0 | 36 |
| webauthn-service | 26 | 0 | 26 |
| approval-ticket-security | 21 | 0 | 21 |
| dom-handlers | 16 | 0 | 16 |
| automation | 5 | 11 | 16 |
| linux-bwrap-sandbox | 7 | 7 | 14 |
| windows-job-sandbox | 8 | 5 | 13 |
| snapshot | 6 | 0 | 6 |
| guardrails.origin-guard | 6 | 0 | 6 |
| guardrails.prompt-injection | 6 | 0 | 6 |
| agent-api.registry | 5 | 0 | 5 |
| agent.tab-lock | 5 | 0 | 5 |
| home-intelligence | 4 | 0 | 4 |
| agent.trust | 4 | 0 | 4 |
| theme | 4 | 0 | 4 |
| **extensions.crx-verifier** | **0** | **3** | **3** |
| autofill.vault | 3 | 0 | 3 |
| extensions.permission-analyzer | 3 | 0 | 3 |
| **Total** | **551** | **26** | **577** |

---

## 4. License conflict — needs a human decision, not a docs edit

| Path | Content |
|---|---|
| `Aartiq/LICENSE` | Apache License 2.0, full text |
| `Aartiq/aartiq-browser/LICENSE.txt` | **EULA.** "You may not: reverse engineer… modify or create derivative works… resell or distribute." Line 4 nonetheless asserts "This Is Open Source Software." |
| `Aartiq/aartiq-mcp/LICENSE` | MIT ✓ |
| `Aartiq-Landing-Page/` | none; `"private": true` |

`aartiq-browser/package.json:190` sets `"nsis": { "license": "LICENSE.txt" }`, so the **EULA is the license shown in the Windows installer**.

GitHub's API reports the repo license as `Apache-2.0` because it detects the root `LICENSE` — so the repo page, the README badge, and `AGENTS.md` all display Apache-2.0 while the shipped installer displays a no-redistribution EULA. The README's own trademark section ("permits the use, modification, and redistribution of the source code") contradicts the EULA directly.

**This is a legal determination, not a documentation one.** No docs edit can resolve it. The SSOT records both artifacts and flags the conflict; it does not assert either interpretation as settled. Escalated as the top item in the final report.

---

## 5. Honest limitations to preserve and consolidate

These are already written and must survive the cleanup, consolidated rather than deleted:

| Location | Content |
|---|---|
| README :164 | runtime sandbox tests only run on their own OS; OS-automation tests skip without native tools; CRX3 suite is **skipped, never counted as passing** |
| `security/page.tsx:55` | visual extraction "does NOT prevent prompt injection entirely" |
| `security/page.tsx:57` | "cannot guarantee semantic immunity against jailbreaks" |
| `security/page.tsx:108` | "SecurityValidator.js does not guarantee that non-blocked commands are safe" |
| `security/page.tsx:170` | allowlist "is a policy layer; the enforcement boundary is the OS sandbox" |
| `security/page.tsx:218` | macOS residual: Seatbelt starts from `(allow default)`; Mach IPC usable; **Apple Events cannot be filtered** by current `sandbox-exec` |
| `security/page.tsx:228` | "verify the actual PowerShell/C++/Node implementation … rather than trusting the documentation alone" |
| `docs/testing/page.tsx:55` | runtime tests only EXECUTE on their own OS |
| README :264 | "Startup measurements represent time to the first visible window, not complete service initialization" |
| `SecurityValidator.js:5-16` | the regex layer "is NOT the primary security defense… bypassable by construction" |
| `sandbox-executor.js:36-48` | honest sandbox limitations, incl. Apple Events |

---

## 6. Findings that must be marked `TODO(verify)`

| # | Item | Why unverified |
|---|---|---|
| 1 | **Port 46203 collision** — agent-api takes the port, native bridge's `EADDRINUSE` is swallowed, so `/native-mac-ui/*` routes 404 | Derived from call ordering and defaults. No app was executed. Needs a live `npm run electron-start` to confirm |
| 2 | **Benchmark figures** (0.32s / 0.31s / <1% on v0.3.4) | No script, raw output, or instrumentation in either repo. Not disproven — unsourceable |
| 3 | **Benchmark hardware string** "MacBook Pro M4 Pro, 12-core CPU, 24 GB RAM, macOS 26.5" | Same |
| 4 | **`docs-audit/action-inventory.md:101,108`** "no real check" | Fixed in code, so the audit file is stale; its `SHELL_COMMAND → CRITICAL — NO permission dialog` row is **also** stale, since `system-handlers.js` now routes through `execShellCommand`'s gate. Needs a re-run, not a docs edit |

---

## 7. What this audit did **not** touch

- No file under `aartiq-browser/` was modified. That directory was read only, to establish ground truth.
- No product behaviour, dependency, or workflow was changed.
- No marketing self-label was deleted without checking that the underlying content survived elsewhere — see final report.

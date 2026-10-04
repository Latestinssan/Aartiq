# Documentation / Source Mismatch Inventory

**Repo state audited:** `origin/main` @ 72085f01 (Aartiq), `docs/honest-feature-docs` @ b2ca958 (Aartiq-Landing-Page, PR #4).
**Audit date:** 2026-10-04. **Source code is the source of truth for every verdict below** — each row
cites the claim (file:line), the source that contradicts or confirms it (file:line), and the
disposition. Where runtime behavior could not be exercised, the verdict says *could not verify*
rather than guessing.

**Verdict key:** `docs wrong` (claim must change), `code wrong` (behavior must change — own PR,
failing test first, flagged for maintainer review), `both` (claim + behavior), `already fixed`
(verified fixed on this base), `could not verify`.

---

## M1 — MCP bridge loopback claims

| | |
|---|---|
| **Claim A** | `Aartiq-Landing-Page/src/app/mcp-settings/page.tsx:195-199` — "the server has always called `listen(port)` with no host argument, which binds `0.0.0.0`/`::`" (also implied by `src/lib/search-index.ts:75`, "MCP SSE bridge listens on every interface"). |
| **Claim B (true)** | `Aartiq/README.md:226`, `Aartiq-Landing-Page/src/app/docs/security/page.tsx:968` — loopback by default. |
| **Source** | `aartiq-browser/src/lib/mcp-browser-server.js:1678,1681` — `const host = resolveBindHost(...); httpServer.listen(port, host)`. `resolveBindHost` returns `127.0.0.1` unless `security_mcpBridgeRemote` is true (`aartiq-browser/src/main.js:9161`, default false; `src/lib/local-server-auth.js:179-182` is the gate for the remote override). |
| **Verdict** | **docs wrong** (Claim A). Claim B matches source. |
| **Disposition** | PR1: rewrite `mcp-settings/page.tsx:195-199` and `search-index.ts:75` to the true statement (loopback default, `security_mcpBridgeRemote` opt-in). PR2: add a real bind-address test. **→ Done:** PR1 rewrote the pages; PR2 added the M1 block of `tests/network-listener-hardening.test.js` (call-site assertion + a real socket bound through `resolveBindHost`). |

## M2 — WiFi sync listener: "every local listener requires a token"

| | |
|---|---|
| **Claim A** | `Aartiq-Landing-Page/src/app/docs/security/page.tsx:969` — "Every local listener requires a per-process token on every request." |
| **Claim B (true)** | `Aartiq/README.md:227,245` — port 3004 and 3999 require no authentication. |
| **Source** | `aartiq-browser/src/renderer/ipc/WiFiSyncService.ts:65` — `server.listen(port, undefined)` → all interfaces, no host. Handshake/`session-status` (`:206-260`), `execute-command` (`:260`), `desktop-control` (`:264`) — no token re-check after handshake, no origin restriction. Token exists only on ports 3001/46203 (`local-server-auth.ts`). |
| **Verdict** | **docs wrong** (Claim A). Code hardening (token/origin on 3004/3999) is a **security-behavior change — deferred to maintainer**, not done silently. |
| **Disposition** | PR1: replace the "every listener" sentence with an explicit per-listener table (3001/46203 have per-process tokens; 3004/3999 do not). Gate test asserts the page cannot claim a token while `WiFiSyncService.ts` has no auth import. |

## M3 — Service + PDF sync bind `0.0.0.0` with wildcard CORS

| | |
|---|---|
| **Claim** | `Aartiq/README.md:230`, `src/data/project-facts.ts:469-473` (landing), `Aartiq/AGENTS.md:125` — "binds to `0.0.0.0` for Phone/Laptop File Sync … no authentication, CORS allows `*`". |
| **Source** | `aartiq-browser/src/service/service-main.js:255` (`listen(port, '0.0.0.0')`), `:209` (`Access-Control-Allow-Origin: *`); `src/service/pdf-sync.js:51,59` same. |
| **Verdict** | **docs match code, but code is the defect** (`code wrong`). |
| **Disposition** | PR2 (own security-behavior PR): default bind `127.0.0.1` (env override `AARTIQ_SERVICE_HOST`), drop wildcard CORS; failing test first. Docs updated in same PR. **→ Done in PR2:** `src/service/service-bind.js`, both listeners patched, `tests/network-listener-hardening.test.js` written failing-first (5 failed / 4 passed before the fix, 9 then 10 green after), 11 mutations all killed — `mutation-check-network-hardening.txt`. |

## M4 — Port 46203 double-bind

| | |
|---|---|
| **Claim** | `Aartiq/README.md:228-229,250` carries `TODO(verify)` on the collision; `project-facts.ts:450-464` (landing) claims "Native bridge `127.0.0.1:46203`" and "agent API … 46203" as if both answer. |
| **Source** | `src/lib/agent-api/providers.ts:21` — `port: 46203`; `src/main.js:1090` — `nativeMacUiPort: 46203`. Startup order: agent API at `main.js:6100`, native bridge at `main.js:9147` (later) → the agent API wins, bridge gets EADDRINUSE; `providers.ts`/`server.ts` `listen` has no error handler and `main.js:1939` attaches its error listener to the `app`, not the server → failure swallowed. Swift hardcodes 46203 (`aartiq-browser/macos/Runner/Models.swift:73`), CLI reads `AARTIQ_BRIDGE_PORT` default 46203 (`bin/aartiq-cli.js:21`), `aartiq-mcp/server/index.js:12` default 46203. |
| **Verdict** | **code wrong** (collision) + docs overclaim. Runtime consequence on this machine: **could not verify** which service answers (requires running app). |
| **Disposition** | PR2: agent API moves to **46204**, native bridge keeps 46203 (Swift/CLI hardcode it), `aartiq-mcp` env default → 46204; failing test asserting distinct ports first; docs tables updated. **→ Done in PR2 with one deviation from the brief:** `aartiq-mcp` keeps **46203**. Source decides — `aartiq-mcp/server/bridge-client.js` calls only `/native-mac-ui/*` routes, which `bridgeApp` in `main.js` serves on the native-bridge port; pointing it at 46204 would break every MCP tool call. The pairing is pinned by test (index.js `AARTIQ_BRIDGE_PORT || '46203'` + `DEFAULT_PORT = 46203` + route shape) and mutation-checked both ways. |

## M5 — v0.3.4 release notes: loopback claim at time of tag

| | |
|---|---|
| **Claim** | `Aartiq/release_notes/v0.3.4.md:11,48,63` and `Aartiq-Landing-Page/src/lib/release-notes.ts:167` — "MCP server binds to `127.0.0.1` only". |
| **Source** | `git show v0.3.4:aartiq-browser/src/lib/mcp-browser-server.js` (tagged 70255306) line 1620 — `httpServer.listen(port, cb)` with **no host argument** → all interfaces at v0.3.4. The loopback bind landed later (current `main.js:9161` setting). |
| **Verdict** | **docs wrong as of the tag** (claim only became true in v0.3.8). |
| **Disposition** | PR1: annotate `release_notes/v0.3.4.md` (correction note in the existing house style, cf. `:157-159`): the 127.0.0.1 bind shipped in v0.3.8; at v0.3.4 the port bound all interfaces. |

## M6 — Active Ports metric

| | |
|---|---|
| **Claim** | `Aartiq-Landing-Page/src/app/docs/overview/page.tsx:463-465` — derived from `project-facts.network.servers`: "127.0.0.1:3001, 127.0.0.1:3004, 127.0.0.1:46203, 127.0.0.1:3999" while its note field lists **five** service ids (both 46203 services). |
| **Source** | `src/data/project-facts.ts:416-464` — five servers, two sharing 46203. |
| **Verdict** | **both** — after M4 the ports become 3001/3004/46203/46204/3999 and the derived metric must list `port + service name` pairs, not a bare port list. |
| **Disposition** | PR2: fix `project-facts.network.servers` values/notes; overview metric text auto-derives (re-synced with `npm run docs:sync`). **→ Done in PR2:** ports are now 3001 / 3004 / 46203 / 46204 / 3999 — five distinct entries, deduplicated from the same five ids the note field lists. |

## M7 — QR + PIN approval flow

| | |
|---|---|
| **Claim A** | `security/page.tsx:197-202,214` — "High Risk (shell/power): QR + PIN". |
| **Claim B** | `security/page.tsx:855-858` — "QR flow used for two things only: power actions, remote-origin shell. A high-risk command typed at the desktop does not go through it." |
| **Source** | (a) `src/renderer/components/ClickPermissionModal.tsx:221,235-271,295` — desktop AI high-risk actions **do** require `mobileApproved && pinVerified` (QR + PIN) to press Approve. (b) Power actions: `src/main/ipc/sync-handlers.js:294-300` QR. (c) Remote-origin shell QR branch at `sync-handlers.js:249` is **dead**: `execute-shell-command` is registered with `requiresApproval: 'never'` (`main.js:869`; `capability-controller.js:77-88` → `capResult.approved === true`), so the `else` path executes directly at `:265`. (d) Non-AI/native shell path: `permission-store.js` → `checkShellPermission` deny → `shell-permission-bridge.js:11` renderer panel **Allow Once / Always / Deny** (`useAIActionSecurityManager.tsx:666-711`). (e) MCP high-risk tools: HTML popup QR `mcp-browser-server.js:158`; biometric dialog is a **native-approval-manager button label, no biometric API** (`native-approval-manager.js`, Touch ID strings `:30,42`). |
| **Verdict** | **both claims wrong**. Truth: QR+PIN is used for (a) power actions, (b) desktop AI-initiated high-risk actions, (c) high-risk MCP tool calls. Remote-origin shell *escalates risk* (`sync-handlers.js:232-236`) but its QR branch is unreachable — flagged for maintainer, not silently changed. Native shell bridge uses Allow Once/Always/Deny. |
| **Disposition** | PR1: rewrite `How It Works` (`:847-858`) and the approval-tier cards from these citations. **Note:** the brief's suggested wording ("QR only for power + remote shell; desktop = Allow/Deny") contradicts `ClickPermissionModal` — source wins. |

## M8 — Approval-tier cards are one table for two different systems

| | |
|---|---|
| **Claim** | `security/page.tsx:184-209` — four risk-tier cards; High card mixes "QR + PIN" (AI-action system) with "Allow Once / Always" (shell-bridge system). |
| **Source** | Two independent systems: shell tiers from `permission-store.js:64-121` + `shell-command-tiers.test.js` (critical: denied at `utils.js:218-229`, then plain Allow/Deny); AI-action tiers from `useAIActionSecurityManager.tsx:604-720` + `ClickPermissionModal.tsx`. Risk-tier data rows `project-facts.ts:309-348` already match the shell classifier (verified against `shell-tiers.generated.json` + `check-docs` rule (e)). |
| **Verdict** | **docs wrong** (structure misrepresents). |
| **Disposition** | PR1: split into two labeled tables — "AI browser actions" and "Shell commands" — each with its source citation; gate test asserts both headings exist. |

## M9 — Critical tier "ticket-based flow" claim

| | |
|---|---|
| **Claim** | `security/page.tsx:203-208` — "Routed through capability controller's ticket flow (final layer)." |
| **Source** | `src/main/utils.js:218-229` — critical → logged, `return false`; then plain Allow/Deny. Ticket flow applies to MCP high-risk (`mcp-browser-server.js:139-161`, `approval-gate.js`) and approve (not "critical") HTML actions — not to critical shell commands. No registry assigns `critical` except remote-shell escalation `sync-handlers.js:236`. `project-facts.ts:339-348` states this correctly. |
| **Verdict** | **docs wrong.** |
| **Disposition** | PR1: correct the card; gate asserts no "ticket-based flow" on the critical row. |

## M10 — "The code just doesn't work yet" claim

| | |
|---|---|
| **Claim** | `Aartiq/release_notes/v0.3.5.md:18` (historical release note, also mirrored in `release-notes.ts`). |
| **Source** | Current base has no such claim on current docs; the two failing tests named there now pass on `origin/main` (approval-gate-concurrency, linux-ipc-registration — see PR3 record). |
| **Verdict** | historical, already-fixed — **already fixed** (105f4dc0 "docs: unhold v0.3.5"). No change. |

## M11 — Security page says "5 enforcement layers" and "six independent layers"

| | |
|---|---|
| **Claim** | `security/page.tsx:479` ("six independent security layers"), `:503-504` stat card — "5 Enforcement Layers Beyond The Firewall". |
| **Source** | `Aartiq/README.md:164` — "Only 2 of them are enforcement boundaries: the sandbox … and approval." `:165-166` — approval tokens are re-validated (gate), security-prompt tokens self-report (not enforcement). |
| **Verdict** | **docs wrong** (card). |
| **Disposition** | PR1: stat card → "2 enforcement boundaries (OS-applied)", label quoting README wording; keep six-layer list but drop "independent". |

## M12 — Permission defaults: two different sources / system-root allowlisting

| | |
|---|---|
| **Claim** | `security/page.tsx:247-250` — "Four default paths (Home + Desktop + Documents + Downloads)" + "newer default also ships app-data + temp". |
| **Source** | **Live:** `src/lib/permission-store.js:13-21` — home/Desktop/Documents/Downloads read-write, `/tmp`, `/Applications`, `/System/Applications` read; consumed by `getAllowedDirectories` `permission-store.js:197-200`. **Tests-only default:** `directory-allowlist.js:24-43` (app-data + temp) — referenced only by `directory-allowlist.test.js`. `addAllowedDirectory` (`permission-store.js:375+`) accepts `/dev`, `/etc`, `/` — no system-root validation. UI path (AutomationSettings localStorage) also has no validation. |
| **Verdict** | **both** — docs must state the live defaults only (with the test-only default labeled as such), and **code must validate** system roots. |
| **Disposition** | PR1: docs. **PR5 → Done, flagged:** `addAllowedDirectory` now refuses system roots (filesystem root, the OS directories, Windows drive roots / system directories) with an audit entry, failing-first in `tests/permission-store-system-root.test.js` (10 failed / 2 passed before the fix, 12/12 after) — **exact match only**: `/` is refused, `/usr/local` is not, pinned as the boundary case so widening the ban is a deliberate maintainer decision, not an accident. Mutation record: `docs-audit/mutation-check-system-roots.txt` (3/3 killed). The UI path (AutomationSettings localStorage) and the tests-only default in `directory-allowlist.js` are untouched — out of scope here. |

## M13 — "allowlisted domains" (stale claim)

| | |
|---|---|
| **Claim** | was `search-index.ts:42`, `mcp-settings/page.tsx:174`, `Aartiq/AI-GUIDE.md:185`. |
| **Source** | grep over both worktrees (excluding history/node_modules): **0 matches** — fixed by `1866387b` "docs: remove stale 'allowlisted domains' claim". |
| **Verdict** | **already fixed.** No change; gate coverage by `docs-search-index-match-source` remains. |

## M14 — Licence conflict

| | |
|---|---|
| **Claim** | `README.md:287` = MIT; `package.json` no `license` field; `aartiq-browser/LICENSE.txt` = commercial EULA (bans redistribution, CI bundling, seat exceeds subscription) while `nsis-installer.nsi:23` points the installer at it; landing `project-facts.ts:728-750` documents the conflict; `AI-GUIDE.md:13-17` says no licence. |
| **Decision (user)** | **Browser becomes Apache-2.0** — `aartiq-browser/LICENSE.txt` replaced with Apache-2.0 (matching root), installer keeps pointing at it, `license` field added, decision recorded in `docs-audit/licence-decision.md`. |
| **Disposition** | PR4 + check-docs rule failing on installer/root licence mismatch + negative test. **→ Done in PR4:** `LICENSE.txt` is byte-identical to the root `LICENSE` (old 24-line EULA preserved verbatim inside `licence-decision.md`), `package.json` declares `"license": "Apache-2.0"`, landing `legal.licenseConflict.resolved` flipped with the decision as its evidence and the table row moved `conflicted` → `verified`, `check-docs.ts` rule (j) checks installer file + manifest field + SSOT flag (4 negative cases in `test-check-docs.ts`), and `tests/licence-audit-rename.test.js` pins the shipped files (6 tests; 5 failed before the fix). The `AI-GUIDE.md:13-17` part of the claim no longer reproduces: grep `licen` over both AI-GUIDE copies returns 0 matches, so there was nothing left to fix there. |

## M15 — Two different status statements

| | |
|---|---|
| **Claim A** | `README.md:28-31` (IMPORTANT block) — "single-maintainer … open a GitHub issue … I triage in the order things break." |
| **Claim B** | `Aartiq-Landing-Page/src/app/docs/overview/page.tsx:541-557` — "re-understanding / design pause … next session runs a strict path." |
| **Verdict** | **both wrong as a pair** (contradictory). |
| **Disposition** | PR1: one status paragraph, used verbatim in both places; flagged for maintainer approval of final wording. |

## M16 — Comet → Aartiq identity strings

| | |
|---|---|
| **Source (live strings)** | `src/lib/permission-store.js:55-57` audit file `comet-audit.jsonl`; `src/main/ipc/file-handlers.js:428,472` default exports `comet-chat-*.json`; `src/main/main.js:6921` `comet-chat-prompt-defaults.json`. Docs citing them: landing `security/page.tsx:250`, `features/page.tsx:452`. Already clean: `bin field` (`package.json:6` = `aartiq`), Swift panels (grep "Comet" in `macos/` → 0), audit record itself (no "comet" content, `docs/cli-ref.md:39`). |
| **Verdict** | **docs + code strings wrong** (renaming touches persisted filenames → needs migration). |
| **Disposition** | PR4: rename to `aartiq-audit.jsonl` / `aartiq-chat-*` **with migration** (rename-on-first-load if old file exists) + test; update citing docs. Other historical `Comet*` identifiers (e.g. `cometAiEngine`) are internal names with no user-visible string — out of scope, recorded here. **→ Done in PR4:** `permission-store.js` writes `aartiq-audit.jsonl` and renames a legacy `comet-audit.jsonl` on first load (never clobbering an existing new file — both exist untouched if both did); `file-handlers.js` defaults `aartiq-chat-<ts>.txt/.pdf`; `main.js` defaults `aartiq-chat-session-<ts>.txt`; citing docs updated (`security/page.tsx:250`, `features/page.tsx:452`). **Two corrections recorded here:** (1) the claim's `main.js:6921 comet-chat-prompt-defaults.json` string does not exist on `origin/main` — the only `comet-chat` reference in `main.js` was `comet-chat-session` at `:6802` (source wins); (2) `comet-permissions.json`, `comet-security-settings.json` and the `comet-vault-key` store name remain — persisted in `permission-store.js`/`main.js` but cited by no doc, so renaming them is a separate migration and is left for the maintainer. |

## M17 — Tool counts

| | |
|---|---|
| **Claims** | "36 tools across 11 categories" — landing `skills/page.tsx:109`, `features/page.tsx:306` (a repo-wide grep found no "36 tools" in Aartiq `origin/main` markdown — that claim lives only on the landing repo and the user's unpushed branch); "60+ tools" — `mcp-settings/page.tsx:141,270`, `search-index.ts:75-76`, `package.json:4`. |
| **Source on `origin/main`** | `aartiq-mcp/server/index.js` `TOOLS` = **64** tools, 11 category comment blocks; `src/lib/agent-api/tools.ts` = **198 lines**, 28 tools, 9 categories (SECURITY, AGENTS, SNAPSHOTS, FORMS, EXTENSIONS, THEME, NAVIGATION, TABS, SYSTEM) — **no** `page_find`/`news_search` (those exist only on the unpushed local `docs/honest-feature-docs` branch of the user's checkout, `tools.ts:416`); MCP bridge = **25** tools (`server/index.js` count over `name:` entries). |
| **Verdict** | **docs wrong** — and **critical note:** landing PR #4's skills page cites `tools.ts:416-418` (a line that does not exist on `origin/main`) documenting an unpushed feature branch. |
| **Disposition** | PR1: publish exact per-server counts from `origin/main` (aartiq-mcp 64, agent API 28/9, bridge 25) + a count-registry gate test. The unpushed-branch divergence is flagged in the final report — when that branch lands, counts must be regenerated. |

## M18 — Benchmarks

| | |
|---|---|
| **Claim** | `README.md:343-344` — 0.32 s / 0.31 s / <1 % with "benchmarked on v0.3.4 (not this release)", `TODO(verify)` + "figures cannot be reproduced from this repository"; landing `project-facts.ts:591-614` + `overview/page.tsx:397-399` provenance label (exempt literals, `src/data/`). |
| **Source** | **No benchmark script exists** (grep `benchmark` over repo → only prose). False "scripts included" claim already removed (no hits on overview page; `test-check-docs.ts` gate (c) enforces provenance labels). |
| **Verdict** | **could not verify** the figures (no script → cannot re-run). Provenance labeling is present and enforced; retention vs. removal of the v0.3.4 numbers is left as a maintainer choice, recorded rather than guessed. |
| **Disposition** | PR1: inventory record only; no new claims. |

## M19 — Test counts in README / TEST_RESULTS block

| | |
|---|---|
| **Claim** | `README.md:194-201` (SSOT `ci` block): "876 tests total, 850 pass, 26 skipped, 0 fail". |
| **Source** | Baseline full jest run on this base (macOS arm64, node v24.14.0): **1006 total, 980 pass, 26 skipped, 0 fail, 36 suites** — JSON at `docs-audit/../baseline2-jest.json` (`$T/baseline2-jest.json`). |
| **Verdict** | **docs wrong (stale).** |
| **Disposition** | PR1: `npm run docs:test-facts -- --from <baseline JSON>` regenerates `test-facts.generated.json` and the README block (re-derived, not hand-edited). |

## M20 — Search perception claim

| | |
|---|---|
| **Claim** | `security/page.tsx:103-105,334` — screenshots/OCR "the primary way Aartiq perceives and controls a page". |
| **Source** | `mcp-browser-server.js:1429,1395` (`_browserSearch`/`news-search` → `view.loadURL` + `extractFromHtml`), `web-extractor` READ_PAGE_CONTENT pipeline; OCR/screenshots only for `OCR_SCREEN`/vision commands (`mcp-browser-server.js` OCR handler). Injection scan applies to extracted text (`sandbox-service.js:66`, `security-validator.js:69-94`). |
| **Verdict** | **docs wrong.** |
| **Disposition** | PR1: describe the per-command pipeline (DOM extraction vs OCR), keep the "untrusted model input" treatment which is accurate. |

## M21 — CRX3 signature claim

| | |
|---|---|
| **Claim** | `README.md:278` — "the signature is verified with the embedded public key before Chrome Extension Manager loads the package" (present tense, unconditional); `release-notes.ts:69,91`, `v0.3.6.md:14,43` "verified before any code loads" (historical). |
| **Source** | Code path exists and is fail-closed: `src/lib/extensions/ChromeExtensionManager.js:256-266` — `installFromWebStore` calls `verifyCrx` before extracting any bytes. **But** the suite that exercises the verifier is `describe.skip` — `src/tests/extensions.crx-verifier.test.ts:16` (3 tests), reason at `:12-15`: "verifyCrx() wedges the Node 24/OpenSSL verifier … hanging jest in-band". Runtime behavior inside Electron's OpenSSL: **could not verify** (suite never runs). Baseline 26 skipped includes these 3. |
| **Verdict** | **docs wrong** — verification cannot be claimed while its suite never runs. |
| **Disposition** | PR1: `README.md:278` → past-tense/package-parsed statement + explicit "suite skipped (hangs on Node 24 OpenSSL)" pointer. Historical release notes left as-is (exempt literals, immutable record), annotated interpretation lives here. |

---

## Additional findings (not in the original brief)

| ID | Finding | Evidence | Disposition |
|---|---|---|---|
| **X1** | `sync-component-docs.yml` pushes to `Latestinssan/Aartiq-Landing-Page` — repo does not exist (real remote is `Latestinssan2/Aartiq-Landing-Page`). | `.github/workflows/sync-component-docs.yml` `repository:` field; `git remote -v` on landing clone. | PR1: workflow cannot work as written — flag for maintainer (changing the push target is a CI-behavior change). |
| **X2** | Landing PR #4 (skills page) documents agent-API tools that are **not on `origin/main`** (36/11, `page_find`/`news_search` citing `tools.ts:416`). | `skills/page.tsx:109-125` vs `origin/main` `tools.ts` (198 lines). | PR1 corrects to main's 28/9; final report flags the unpushed-branch divergence prominently. |
| **X3** | `CHANGELOG.md:9` — "Every route on the local listeners now requires a per-process token" — overclaims (3004/3999 have none). | `CHANGELOG.md:9` vs `WiFiSyncService.ts`. | PR1: scope the sentence to the three tokened listeners (3001, 46203 ×2), and keep the 3004 sentence below it which is already honest. |
| **X4** | `mcp-settings/page.tsx:154` "both servers default to same port 46203" — states the defect as normal. | vs M4. | PR2 (after port split): state 46204 (agent API) / 46203 (native bridge). **→ Done in PR2:** the sentence now says BridgeClient targets the native bridge and the agent API moved to `${net.agentApi.port}`. |
| **X5** | `privacy/page.tsx:191` "all listen on 127.0.0.1 only … per-process token" — **true for the three bridges it lists** (3001, 46203 ×2); does not cover 3004/3999. | `local-server-auth.ts:110-135` wraps all three bridge routes; `mcp-browser-server.js:1666-1697`; `agent-api/server.ts:139-165`. | No change needed (already scoped correctly); recorded as verified. |

---

## Test-count baseline (for M19)

```
$ npx jest --json > baseline2-jest.json   # worktree, landing paired to docs/honest-feature-docs
macOS (darwin/arm64), node v24.14.0, 36 suites
total 1006 | passed 980 | failed 0 | skipped 26
```

Every mismatch above is either fixed in one of the five PRs, verified as already fixed, or
recorded with an explicit "could not verify" + maintainer flag. Mutation checks for each new
gate live next to this file (`mutation-check-*.txt`, `red-evidence/`).

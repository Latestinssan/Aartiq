# Aartiq Browser - Recent Changes

## Unreleased — agent page tools, claim-level research verification, listener auth, shell approval defaults

Not yet tagged. The version number is the maintainer's to choose. Two
independent bodies of work sit below: agent page tools with claim-level
research verification, then local listener authentication with shell approval
defaults.

### Agent tools and research verification

#### Single-page search and DOM control
- New Agent API tools: `page_find` (search one already-open page, no network request and no other tab touched), `dom_query`, `get_page_text`, `web_search`, `news_search`, `search_providers`.
- `page_find` defaults to `mode="tree"`, matching accessible name, value, href and role across the whole snapshot and returning refs that `click_ref` / `fill_ref` accept. Nodes nested inside structural wrappers are found, and actionable-only filtering does not hide them. `mode="text"` scans rendered prose and returns context snippets.
- `search_providers` reports which provider is configured, whether it scrapes, and whether it has a news index — so "why are these results undated" is answerable instead of mysterious.

#### Search prefers APIs and says so when it scrapes
- Tavily is the recommended single key (1,000 free credits/month, no card). SerpAPI (250/month) and Brave (card + attribution required) also work. Google Custom Search JSON is marked deprecated — closed to new customers, existing keys end 2027-01-01.
- With no key configured, search still runs by scraping a search engine's HTML. That path is rate-limited, slower, breaks without warning when the markup changes, and returns no publication dates. It is labelled as scraped wherever it is reported rather than presented as equivalent.

#### Form filling split from form submission
- `fill_form` (verb `input`) fills and never submits. `form_submit` (verb `sideEffecting`) goes through the approval gate. They are separate tools rather than one tool with a `submit` flag, so the side effect cannot be reached by passing a parameter.
- `autofill_match`, `vault_list` and `vault_unlock` join the Forms category.
- No field is written that the user did not specify, and a readOnly or disabled field is reported as not filled rather than counted as success.
- `fillFormScript` no longer falls back to `document.forms[0]`, so a fill cannot land in an arbitrary form, and it no longer submits.

#### Element refs fail loudly instead of addressing the wrong thing
- Refs bind by a `data-aartiq-ax` stamp the collector writes onto actionable nodes, with `backendNodeId` as first-priority identity. A stale ref now errors instead of scripting whatever element happens to occupy that position after the page shifts.
- The collector stamps only actionable elements. Blanket stamping perturbed page code that queries the DOM.
- `SnapshotManager` no longer prunes `depth` after recursing, which had been flattening the tree it returned.

#### Claim-level cross-verification, and last source only when dates are real
- New `src/lib/research-pipeline.ts` runs a bounded plan → search → fetch → extract → cross-verify → rank → generate job behind Deep Research, with the search provider, page fetcher and progress emitter injected so the whole pipeline tests without network access.
- Claims are keyed on `subject|verb`, so "450 million dollars" and "450 million euros" remain one claim with two conflicting figures instead of being matched into agreement.
- Corroboration requires ≥2 distinct domains, and domains are re-derived from each claim's URL rather than trusted from the caller — `news.reuters.com` and `uk.reuters.com` no longer pass as two independent sources.
- A last source is named only when publication timestamps are reliable. Otherwise the answer is "unknown" with the reason attached, so callers do not retry and guess.
- Search budget options are per-run with defaults; an absent option takes the default instead of clamping to a minimum.
- Progress streams to the chat sidebar over `research-progress`, and a "Sources disagree" panel renders unresolved contradictions inline.
- Known limit, stated rather than hidden: claim extraction surfaces numeric claims with a named subject, so disputed qualitative findings never reach the contradictions panel. A false negative rather than a false positive; the coverage figure reflects numeric agreement specifically.

#### Fixes found by the new tests
- `typeScript` emitted a bare `clearFirst` identifier, throwing `ReferenceError` on every `type_ref`.
- Contenteditable detection relied only on `el.isContentEditable`, so `fill_form` reported success on a plain div.
- The number regex required whitespace after a magnitude, so "raised 100 million." was read as `100` and turned agreement into a false contradiction.
- Subject extraction keyed on articles and pronouns merged every claim into `the|company`.
- Terminal pipeline status was keyed on pages attempted rather than pages read.

### Testing
- `tests/agent-api-bridge-tools.test.js` (35), `tests/page-scripts-forms.test.js` (48), `tests/snapshot-ref-binding.test.js` (23), `tests/web-search-service.test.js` (27), `tests/research-pipeline.test.js` (60), `tests/research-progress-plumbing.test.js` (24).

---

The sections below are the local listener authentication and shell approval
work, unchanged.

### Security

#### Local listeners require a credential
- The MCP browser bridge (port 3001) now binds `127.0.0.1` by default instead of every network interface. Exposure over LAN/Tailscale is a setting, off by default, and still requires the token.
- Every route on the local listeners — including SSE and every POST route — now requires a per-process token. The token is generated by the server; the route that previously accepted a caller-chosen token is gone.
- Requests are validated against the `Host` header (loopback host and that listener's own port) and any browser `Origin` must be on an allow-list of the app's own origins.
- Pairing no longer completes merely because a client opened the SSE stream. Reaching the stream already requires the token.
- The wildcard CORS header was replaced by reflecting an `Origin` that has already been accepted.
- The same checks apply to the Agent API HTTP server and the native macOS bridge, whose CLI token already existed but which no route previously read. `x-agent-id` remains an identifier, not an authenticator.
- `remote` must now be a real boolean; a config containing `"remote": "false"` no longer opens a listener to the network.
- Rejections are logged with the reason, method and path. No token value is logged.

#### Shell commands no longer auto-run
- Removed the unconditional startup grants for low and medium shell commands (8h TTL). Because every non-destructive command was classified medium, those grants meant `cp`, `mv`, `mkdir`, `npm`, `git`, `curl` and `osascript` ran with no prompt for eight hours after each launch.
- Auto-approval is now the `autoApproveLowRiskShell` setting, default off, and covers read-only commands only. Medium-risk commands prompt every time.
- `autoApproveMidRisk` no longer applies to shell commands; it still applies to MCP tool actions.
- Explicit grants created in Settings → Permissions are not affected.

#### Risk classifier
- The classifier gained a `low` tier. It previously returned `high` for a destructive pattern and `medium` for everything else, so `low` was never produced for a shell command.
- The per-command table now lives in one file read by both the classifier and the documentation generator, so the two cannot drift apart.
- Network-capable and script-capable commands (`curl`, `wget`, `npm`, `npx`, `git`, `node`, `python`, `osascript`, …) are not `low`. An unrecognised command is `medium`, never `low`. A command line containing a URL is never `low`. `chmod` remains `high`.

#### "Allow Always" scope
- Permanent grants were keyed on the first word, so one answer authorised every later invocation of that binary. Grants are now keyed on the whole command line.
- Permanent grants are no longer offered for network-capable, script-capable and destructive commands, or for anything with a URL in its arguments. Allow Once is always available.
- Existing grants migrate on first load: eligible ones are kept and narrowed to the exact command line; network-capable, script-capable and destructive ones are dropped with an audit-log entry.

### Behaviour changes users may notice
- The Claude Desktop config now carries the session token in the `mcp-remote` URL, because `mcp-remote` accepts a bare URL and nothing else. The token changes on every Aartiq start, so a config written by an earlier version is answered with 401 until Auto-Configure is run again.

### Testing
- `tests/local-server-auth.test.js` (41 cases, real sockets), `tests/shell-command-tiers.test.js` (189 cases), `tests/shell-approval-defaults.test.js` (55 cases).

Full detail, including what was deliberately left unfixed, is in
`release_notes/UNRELEASED.md` and `aartiq-browser/docs-audit/security-defaults-verification.md`.

## Version 0.3.7 — Windows AppContainer OS-Level Sandboxing

### Security

#### Windows OS-Level Sandboxing (AppContainer)
- The Windows sandbox upgraded from Job-Object containment to a full **AppContainer** (Windows 8+), matching the OS-enforced guarantees already provided by Seatbelt (macOS) and bubblewrap (Linux).
- The target runs under a **restricted token** (dangerous privileges DELETED, Low mandatory integrity label) created from the helper's own primary token, then launched as an **AppContainer** via the `SECURITY_CAPABILITIES` startup-info attribute list (the Microsoft LaunchAppContainer pattern). The OS builds the AppContainer token at creation time; the target never runs a single instruction uncontained.
- **Directory allowlist enforced by the OS**: the target's package SID is granted ACL access ONLY to the allowlisted directories, the sandbox workspace, and the resolved executable (via `icacls`). Anything not allowlisted stays DENIED. Grants are revoked and the AppContainer profile deleted after every run.
- **Network denied by the OS**: the AppContainer carries ZERO capabilities, so it cannot initiate network connections. High/critical-risk commands now get network isolation on Windows ("deny all" network policy).
- **Isolated temp state**: `TEMP`/`TMP`/`LOCALAPPDATA` are rerouted into the per-run AppContainer profile folder (`GetAppContainerFolderPath`).
- **Fail closed**: any step (profile creation, SID derivation, ACL grant, suspended start, job assignment verification) failing denies the command with `SANDBOX_SETUP_FAILED`; execution never falls back to an unsandboxed process.
- `isolation` results now report `{ filesystem: true, network: true, process: true }` on win32; results also carry `appContainer`, `restrictedToken`, and `integrityLevel` fields.

#### macOS Seatbelt Hardening
- The generated profile now **denies AF_UNIX sockets** (`(deny system-socket)`) in addition to the existing `(deny network*)` IP-socket block. Local IPC sockets (syslog, Docker, P2P services) are no longer reachable from the sandbox.
- **Signal confinement**: `(deny signal)` by default, re-allowed only for the sandbox's own processes (`(allow signal (target self))` and `(target children)`); a sandboxed command can no longer signal unrelated host processes.
- **Executable-mapping strictness**: `(deny file-map-executable)` with `(allow file-map-executable ...)` mirrors the existing process-exec allowlist.
- **mount/umount denied** (`(deny file-write-mount file-write-umount)`) so the file allowlist cannot be widened at runtime.
- These hardening rules are asserted in `tests/sandbox-security.test.js` and proven at runtime on macOS (AF_UNIX bind denied, cross-process signal denied, self-signal allowed).

#### Linux bubblewrap Hardening
- Sandbox namespaces expanded to **pid/net/ipc/uts/user/cgroup + a new session** (`--unshare-user`, `--unshare-cgroup`, `--new-session`), closing escape routes through cgroups, user namespaces, and controlling terminals.
- The capability pre-flight probe now exercises the same expanded flags, so environments where those namespaces cannot be created fail closed instead of degrading.

#### CI Platform Matrix
- `.github/workflows/jest.yml` now runs the sandbox suites on **all three platforms**: `windows-latest` (AppContainer runtime), `macos-latest` (Seatbelt runtime enforcement), and `ubuntu-latest` (bubblewrap; runtime blocks skip if the runner restricts user namespaces, while fail-closed contract tests always run).
- Windows AppContainer runtime invariants (suspended start, OS-enforced ACL allowlist, verified Job Object, grandchild containment, kill-on-close) execute on every push/PR on `windows-latest`.

### Files Changed (Key)

### Files Changed (Key)

| File | Change |
|------|--------|
| `src/core/win-job-runner.ps1` | Rewritten: AppContainer profile, package-SID ACL grants, `CreateProcessAsUser` + `SECURITY_CAPABILITIES` attribute list, restricted Low-IL token, job verified-assignment |
| `src/core/sandbox-executor.js` | `WIN_ISOLATION` now full; stages an AppContainer `sandbox` payload; empty `networkAllowlist` = enforced deny-all |
| `src/main/handlers/utils.js` | High/critical commands request "deny all network" on every platform incl. Windows |
| `tests/windows-job-sandbox.test.js` | AppContainer invariants + OS-allowlist runtime tests |
| `tests/sandbox-security.test.js` | Windows isolation contract updated |

### Overview
A major release focused on security hardening, DOM automation reliability, native OS verification, and AI skill management. Replaces PowerShell-based biometrics with native WebAuthn/FIDO2, introduces a directory allowlist for AI file access, upgrades the DOM engine to v2 with cascading fallbacks, and adds deep research with execution tracking.

### Security

#### Native WebAuthn/FIDO2 Verification
- **New `webauthn-service.js`**: Unified WebAuthn service wrapping `@beeper/webauthn-authenticator` (NAPI-RS bindings to `webauthn-authenticator-rs`)
- **Challenge-Response**: Each verification generates a 256-bit random nonce; the authenticator signs it with a TPM-backed private key
- **TPM-Backed Keys**: Private keys never leave the hardware security module — stored in TPM 2.0
- **Credential Storage**: WebAuthn credentials stored in `~/.aartiq/webauthn-credentials.json` (mode 0600)
- **No more PowerShell spawning**: Eliminated 1-3s PowerShell process overhead, temp `.ps1` files, and plaintext token storage
- Platform support: Windows 10 1903+ (webauthn.dll), macOS 12+ (caBLE via AuthenticationServices), Linux (password fallback)

#### Vault & Credential Security
- **Vault encryption key moved to native OS keychain** — no longer stored in plaintext config files
- **Vault migration** to Windows Job Object containment for process isolation

#### Directory Allowlist for AI File Access
- New allowlist system restricts which directories the AI can read/write via shell commands
- Prevents unauthorized file access outside user-approved paths

#### Security Patch
- Patched shell injection vulnerability, credential storage exposure, and Shift+Tab permission bypass

### AI & Automation

#### On-Demand Skill Loading
- AI loads skills dynamically based on task context instead of loading all at startup
- Action chain capabilities demo and settings management for skills
- SkillLoader rewritten in pure JS with correct require paths (`.ts` → `.js`) and validation allowlist fixes

#### Deep Research Pipeline
- Upgraded deep research with execution tracking UI
- Real-time progress visibility for multi-step research tasks

#### AI Provider Settings
- Configurable AI providers in settings UI
- Tagline gradient styling

### DOM Engine v2

#### Cascading Fallbacks
- `dom-fill-form` and `dom-multi-fill-form` upgraded to DOM engine v2
- Multi-strategy fallback chain for element interaction — tries CSS selector, text content, ARIA role, placeholder, and broad element scan
- `dom-click-element` hardened with default fallback strategies when no specific params match
- YouTube-specific selectors for subscribe button and other common interactive elements

#### Zoom Factor Guard
- Fixed `NaN` crash when `getZoomFactor()` returns before view is ready
- Guarded with `Number.isFinite()` check and try/catch

#### Test Suite
- 110 Jest tests for DOM engine v2, skill loading, and DOM handler cascading fallbacks

### Settings & UI

#### Dynamic Browser Controls
- Settings panel triggers for real-time browser control adjustments
- UI polish across settings panels

#### MSIX / Windows Fixes
- Fixed black taskbar icon background (cyan overlay) on Windows
- Job Object containment for Windows Store compliance

### Files Changed (Key)

| File | Change |
|------|--------|
| `src/lib/webauthn-service.js` | New: Unified WebAuthn/FIDO2 service |
| `src/lib/native-os-verifier.js` | Updated: WebAuthn primary, PowerShell fallback |
| `src/service/windows-hello-auth.js` | Rewritten: WebAuthn challenge-response |
| `src/service/biometric-auth.js` | Updated: WebAuthn for Windows |
| `src/main/handlers/browser-handlers.js` | DOM click fallback strategies, zoom guard |
| `main.js` | DOM click fallbacks, zoom guard, skill loading |
| `src/components/AIChatSidebar.tsx` | FIND_AND_CLICK / CLICK_ELEMENT param fallbacks |
| `src/lib/skill-loader.js` | On-demand skill loading |
| `src/service/permission-api.js` | Directory allowlist, permission gating |
| `package.json` | Added `@beeper/webauthn-authenticator` |

### Dependencies Added
- `@beeper/webauthn-authenticator` — NAPI-RS bindings for WebAuthn/FIDO2 authenticator operations

---

## Version 0.3.3 - Claude Desktop MCP Server (2026-07-13)

### Overview
Complete rewrite of the Claude Desktop MCP server from 21 standalone tools to 64 integrated tools. Claude Desktop now has full control over a running Aartiq browser — AI chat with RAG/web search/PDF generation, bookmarks, history, settings, scheduling, permissions, security, and panel management.

### Changes

#### Claude Desktop MCP Server (64 Tools)
- **Architecture rewrite**: MCP server runs as Node.js stdio process → HTTP bridge (port 46203) → running Aartiq browser
- **No standalone mode**: All tools require the browser to be running, so Claude gets the full AI pipeline (RAG, web search, PDF, navigation, structured output) instead of dumb standalone commands
- **AI sidebar integration**: `send_ai_prompt` goes through the actual sidebar component, not the simplified `/cli/ask` endpoint
- **8 tool categories**: AI Chat (8), Tabs (8), Page Interaction (2), Bookmarks & History (5), Document & Media (3), Settings (8), Scheduling (6), Permissions & Security (8), System (5), Panels (9), App Knowledge (3)

#### New Bridge Endpoints (main.js)
- Sidebar control: `GET /sidebar-state`, `POST /sidebar/open|close|toggle`
- Bookmarks: `GET /bookmarks`, `POST /bookmarks/add|remove`
- History: `GET /history`, `POST /history/clear`
- Settings: `GET /settings`, `POST /settings/update`
- Permissions: `GET /permissions`, `POST /permissions/grant|revoke`
- Automation: `GET /automation/tasks`, `POST /automation/tasks/create|toggle|delete|run`
- App info: `GET /app-info`

#### Prompt Handler Fix
- Fixed `native-mac-ui-submit-prompt` handler to wait 5s for the renderer sidebar to pick up the prompt before falling back to the dumb AiGateway path
- Ensures full-power AI pipeline runs when sidebar is mounted

#### Files
- `aartiq-mcp/server/index.js` — Rewritten: 64 tools
- `aartiq-mcp/server/bridge-client.js` — New: HTTP bridge client with prompt-wait logic
- `aartiq-browser/main.js` — Added bridge endpoints + prompt handler fix
- `aartiq-mcp/manifest.json` — Updated to v2.0.0
- `aartiq-mcp/package.json` — Updated to v2.0.0

---

## Version 0.3.0 - Microsoft Store & Security Hardening (2026-07-07)

### Overview
Major milestone: Aartiq is now available on the Microsoft Store. This release hardens SecureDOMParser with base64 payload decoding, fixes security severity inconsistencies, and overhauls the Windows title bar for a native experience.

### Changes

#### Microsoft Store
- **Store Listing**: Aartiq is now published on the Microsoft Store — direct install link added across all READMEs.
- **MSIX Pipeline**: Automated Windows MSIX build workflow with identity injection for Store submission.
- **Code Signing**: Self-signed certificate generation for MSIX sideloading, upload dev-cert.cer for enterprise deployment.
- **Windows Compliance**: MSIX MinVersion set to 10.0.17763.0 per Store requirements.
- **Transparent Logo**: Icon switched to logo-transparent.png for clean MSIX/AppX packaging across Windows and Linux.

#### Security Hardening
- **Base64 Payload Decoding**: `SecureDOMParser.analyze()` now extracts and decodes base64 strings from content, then re-scans the decoded output against all injection patterns. Previously, only encoding *function calls* were detected — raw base64 strings containing shell commands would pass through. (Fixes the "decoding obfuscated payloads" gap.)
- **Consistent Shell Severity**: `getSeverity()` now returns `'critical'` for *all* shellPrimitives matches — `dd if=`, `mkfs`, `shutdown`, `format C:`, `halt`, `systemctl stop`, etc. Previously these fell through to `'info'` and were never redacted from sanitized content.
- **Credential URL Regex Fix**: The `apiKeyPatterns` entry now requires a URL scheme prefix (`https://`, `ftp://`, etc.) — previously it matched ordinary text like `foo:bar@baz`, causing false-positive over-redaction.
- **Privacy Policy**: Added privacy policy with contact info for Store submission.

#### Windows Title Bar Redesign
- Replaced macOS-style traffic light buttons with standard minimize/maximize/close layout on non-Mac platforms.
- Window buttons now render inline in TitleBar, WelcomeScreen, and StartupSetupUI.
- Hover/active states, spacing, and sizing tuned for native feel.

#### Fixes
- Fixed BrowserView not preserving cookies/auth across restarts (fixed persistent partition).
- Fixed settings page crash.
- Fixed navigation success detection for redirect-heavy pages; added retry logic for JS-heavy page extraction.
- Fixed deepseek-r1 model defaults not removable by user.
- Fixed WelcomeScreen broken IPC icon load — uses /logo-transparent.png directly.
- Fixed 16x16 icon replaced with 256x256 for Windows builder.
- Fixed artifact upload directory flattening for CI release.
- Fixed app:registerAppFileProtocol() not being called.
- Fixed OCR/robot service initialization; added DOM/OCR preference toggle.
- Fixed macOS app launch issues with ad-hoc signing.

#### Technical
- Enhanced store/selectors for better state management.
- Refactored web search service.
- Updated browser/file handlers.
- Enhanced UI components (StartupSetupUI, WelcomeScreen, TitleBar, VirtualizedTabBar).
- Updated READMEs with Microsoft Store links and website URL.
- Setup UI now displays correctly on first run (onboarding flow).

---

## Version 0.2.96 - Nexus-AI Bridge & Native Panels Update (2026-06-17)

### Overview
Added the Nexus Bridge API server (port 9922) for full browser automation from Nexus-AI. Updated native macOS panels with improved stability.

### Changes

#### Nexus Bridge API (Port 9922)
- **New HTTP Server**: Express server on port 9922 with 15 endpoints for Nexus-AI integration.
- **Browser Automation**: `GET /api/tabs`, `POST /api/create-tab`, `POST /api/close-tab`, `POST /api/navigate-tab`.
- **JavaScript Execution**: `POST /api/execute-script` for running arbitrary JS in the active tab.
- **Page Capture**: `GET /api/capture-page` (full HTML), `GET /api/extract-content` (plain text).
- **UI Automation**: `POST /api/find-and-click`, `POST /api/type-text`, `GET /api/get-selected-text`.
- **Navigation**: `POST /api/go-back`, `POST /api/go-forward`, `POST /api/reload`.
- **Auth Sync**: `POST /api/auth-sync` shares authentication state with Nexus-AI.
- **Configurable Port**: Set via `NEXUS_BRIDGE_PORT` env var (default: 9922).

#### Native Panels
- Updated NativePanels binaries (clipboard, downloads, permissions, menu, settings, sidebar, action-chain, apple-ai).

#### Technical
- CLI auto-installer now uses `execSync` for macOS symlink creation.
- CloudSync service reliability improvements.
- BrowserViewContainer UI fixes.

---

## Version 0.2.9.4 - Terminal Control & AI Reliability (2026-04-23)

### Overview
Introduces the Aartiq CLI for terminal-based control and hardens AI automation with auto-continuation and finalized Siri integration.

### Changes

#### Aartiq CLI
- **New CLI Tool**: `scripts/aartiq-cli.js` allows controlling the browser via terminal.
- **Commands**: `aartiq ask`, `aartiq search`, `comet screenshot`.
- **Authentication**: Secure token-based auth via `~/.aartiq-token`.
- **Global Access**: Registered as `comet` binary in `package.json`.

#### AI Reliability & Automation
- **Auto-Continuation**: Implemented "Keep-Alive" loop in `AIChatSidebar.tsx` to handle truncated AI responses.
- **Siri & Shortcuts**: Finalized zero-setup `AppIntents` for macOS Shortcuts/Siri.
- **Deep Link Sync**: Unified routing for `aartiq://` across CLI and Siri.

#### Technical
- Added CLI endpoints to native bridge server in `main.js`.
- Captured `finishReason` in LLM streams for better continuation logic.
- Updated root `README.md` and `AI-GUIDE.md` with new standards.

---

## Version 0.2.10 - Code Refactoring (2026-04-17)

### Overview
Major refactoring to split large files into smaller, more maintainable modules.

### Changes

#### main.js Refactoring
- Extracted shell command execution to `src/core/shell-executor.js`
- Extracted system controls (volume, brightness) to `src/core/system-controls.js`
- Extracted command validation to `src/core/command-validator.js`
- Extracted PDF generation helpers to `src/core/pdf-generator.js`
- Extracted vault handlers to `src/core/vault-handlers.js`
- Extracted Gmail handlers to `src/core/gmail-handlers.js`
- Extracted IPC handlers to `src/core/ipc-handlers.js`
- Added unified `src/core/index.js` module exports

#### TypeScript Fixes
- Excluded broken Thuki components from tsconfig
- `npx tsc --noEmit` now passes with 0 errors

#### Cleanup
- Removed duplicate `release_notes/CHANGELOG.md`
- Updated README.md

---

## Version 0.2.7.1 - TypeScript Compilation Fixes (2026-04-06)

### Overview
Patch release addressing TypeScript compilation errors and type safety improvements.

### Changes

#### TypeScript Fixes
- **Security.ts**: Fixed regex pattern type casting with explicit `RegExp[]` casting
- **electron.d.ts**: Added complete plugins API interface (12 methods + 3 event listeners)
- **PluginSettings.tsx**: Added proper type mapping and callback annotations
- **AIChatSidebar.tsx**: Fixed `result.output` → `result.result`
- **AIUtils.ts**: Fixed `data.title` → `title` in buildCleanPDFContent

#### Build System
- Replaced ES2018 `gs` regex flags with compatible `[\s\S]*?` pattern
- Updated tsconfig.json target from ES2017 to ES2020

### Verification
- `npx tsc --noEmit` passes with 0 errors
- `npm run predev` compiles successfully

---

## Version 0.2.4-stable - PDF & OCR Improvements (Current)

### Overview
Comet v0.2.4-stable introduces major improvements to PDF generation, OCR/screenshot functionality, and bug fixes for duplicate commands.

### March 26, 2026 - Update Details

#### New Features

1. **Enhanced PDF Generation with JSON Support**
   - AI can now generate structured JSON-based PDFs with multi-page support
   - New `buildEnhancedPDFFromJSON` function for JSON-to-PDF conversion
   - Added `generateSmartPDF` with automatic fallback (JSON → markdown)
   - Page detail levels: brief, standard, detailed - AI controls content density per page
   - Icon library with 70+ emoji icons for PDF sections
   - Table of Contents auto-generation for multi-page PDFs

2. **Screenshot & OCR Improvements**
   - Fixed `SCREENSHOT_AND_ANALYZE` command with proper error handling
   - Now uses `captureBrowserViewScreenshot` for accurate browser content capture
   - Added Tesseract.js OCR on captured images
   - Fallback chain: Browser screenshot → Tesseract OCR → Vision AI → Basic OCR
   - ScreenVisionService now has Claude-to-Gemini fallback

3. **Error-Proof Browser**
   - Added `did-fail-load`, `render-process-gone`, `unresponsive` handlers for BrowserView
   - Navigation retry logic (2 attempts before fallback error page)
   - SSL certificate handling - allows dev certificates, logs warnings
   - Global uncaught exception handlers in main process
   - Non-critical error filtering (Criteo, GPU warnings)

4. **Download Panel Fixes**
   - Fixed duplicate file entries showing in downloads panel
   - Proper useEffect cleanup for download event listeners
   - Added "Click to Open" functionality for completed downloads
   - Downloads now store full file path for opening

#### Bug Fixes

1. **Command Parsing - No More Duplicates**
   - Root cause: Two separate parsers (AICommandParser + AICommandOutput) extracting same commands
   - Added deduplication in `parseAICommands` using `Set<string>` tracking `type:value`
   - HTML comment format now supported in main parser: `<!-- AI_COMMANDS_START -->`
   - Removed redundant `parseCommandsFromAIOutput` call in AIChatSidebar

2. **PDF Generation - No More Duplicates**
   - Fixed duplicate PDF generation by deduplicating commands before execution

3. **CSS Fixes for PDF**
   - Removed rounded corners from tables, code blocks, images
   - Changed `overflow: hidden` to `overflow: visible` to prevent text hiding
   - Added `table-layout: fixed` for proper table rendering

#### Technical Changes
- Added new types: `PDFDetailLevel`, `PDFPage`, `PDFSection`, `EnhancedPDFData`
- Added `PDF_ICONS` constant with 70+ icon mappings
- Added `getIcon()` function for icon resolution
- Added `open-file` IPC handler for opening downloaded files
- Updated download events to include file path: `{ name, path }`

---

## Version 0.2.5 - Shell Command Auto-Execution

### Overview
Comet v0.2.5 introduces fully automatic shell command execution with zero permission dialogs. Shell commands now run directly without blocking popups.

### March 24, 2026 - Update Details

#### New Features

1. **Auto-Executing Shell Commands**
   - All shell commands now execute automatically without any permission dialogs
   - Removed the blocking permission dialog that appeared for every command
   - Commands go directly to execution after validation

2. **New Permission Settings Panel**
   - Added dedicated "Permissions" section in Settings (Settings > Permissions)
   - Lists macOS system permissions: Screen Recording, Accessibility, Automation
   - "Open Settings" buttons to quickly access System Preferences
   - Shell command status and auto-approval information

3. **Improved JSON Command Parsing**
   - Fixed regex pattern for `{"commands": [...]}` format
   - JSON commands now parse correctly from AI responses
   - Supports both legacy tag format and new JSON format

4. **Updated AI Instructions**
   - AI now knows permissions are handled automatically
   - Removed "requires permission" text from SHELL_COMMAND docs
   - AI no longer asks user for permission - commands execute directly

#### Technical Changes
- `checkShellPermission()` now returns `true` for ALL commands (no dialogs)
- Removed dialog.showMessageBox call from permission check
- Added PermissionSettings component in Settings panel
- Added IPC handler `open-system-settings` for opening macOS Preferences
- Updated preload.js with openSystemSettings API

#### Removed
- Permission dialog from shell command execution
- Blocking "macOS Permissions Required" dialog that appeared on every command

---

## Version 0.2.5 - Shell Command Improvements (Earlier)

### Overview
Comet v0.2.5 introduces major improvements to shell command permissions and the "Always Allow" functionality.

### Removed Features
- **ORGANIZE_FOLDER command**: Removed native folder organization command
- AI now uses shell commands (ls, mkdir, mv) to organize folders instead

### New Features

#### 1. Smart Shell Permission Dialog
- **AI-powered command explanations**: Each shell command now shows what it does
- **Safety level indicator**: Shows safe/medium/high/critical risk levels
- **Command analysis**: Automatic detection of potential harms

#### 2. Safe Commands Whitelist
- Commands like `ls`, `cp`, `mv`, `cat`, `mkdir`, `touch`, `find`, `grep`, `tar`, `git`, `npm`, `node`, `python`, `curl`, `wget`, `open` are recognized as safe
- After first approval, these commands are permanently allowed (no repeated prompts)
- Stored in permission store across sessions

#### 3. Permanent "Always Allow"
- Fixed the session-only bug: "Always Allow" now persists across browser restarts
- Permissions stored in `comet-permissions.json` in user data folder
- No more re-approving same commands after restart

#### 4. Shift+Tab Quick Allow
- **Fixed**: Shift+Tab now works for ALL risk levels (including high-risk)
- Press Shift+Tab to instantly approve any permission dialog
- Visual glow feedback when activated

#### 5. Folder Organization via Shell
- When user asks to organize a folder, AI now:
  1. Runs `ls <folder>` to see contents
  2. Runs `mkdir -p` to create category folders (Images, Documents, Videos, etc.)
  3. Runs `mv` to move files into appropriate folders
- All commands go through normal permission flow

### Technical Changes
- `checkShellPermission()` now checks permission store at start
- `execute-shell-command` IPC accepts `preApproved` flag to skip duplicate dialogs
- Added SAFE_COMMANDS whitelist in main.js
- Added `explainCommand()` function for AI-generated explanations
- Added `analyzeCommandRisk()` function for risk assessment

### Bug Fixes
- Fixed "Always Allow" not working (was using session-only flag incorrectly)
- Fixed Shift+Tab not working for high-risk commands
- Fixed double permission dialogs for shell commands

---

## Version 0.2.4 - JSON Command Update

### 🎯 Overview
Comet v0.2.4 introduces a comprehensive restructuring of command parsing with dedicated JSON formats, separating PDF generation, action tags, and shell commands from main chat while maintaining full integration in export logs.

### 📦 New Command Parsers

#### 1. PDF Command Parser (`PDFCommandParser.ts`)
- **Dedicated JSON format** for PDF generation commands
- Support for extended options: title, subtitle, author, filename, screenshot, attachments, liveData
- Automatic live data detection for news/reports
- PDF command validation and sanitization
- Export format for PDF logs

#### 2. Action Tag Parser (`ActionTagParser.ts`)
- **Structured JSON format** for all action tags
- Category classification: navigation, browser, system, media, automation, utility, gmail, meta
- Permission level tracking: low, medium, high
- Confidence scoring for command parsing
- Value extraction with pipe-separated options support

#### 3. Shell Command Parser (`ShellCommandParser.ts`)
- **Robust shell command validation** with comprehensive security checks
- Dangerous pattern detection: recursive deletes, fork bombs, disk writes, shutdown commands
- Risk level assessment: low, medium, high, critical
- Blocked commands list with safe alternatives
- Platform-specific command transformations
- Sanitization and timeout management

### 🏪 Action Logs Store (`ActionLogsStore.ts`)
- **Separate log management** for PDF, actions, shell, OCR, and DOM
- Persistent storage to localStorage
- JSON and text export formats
- Summary statistics for each log type

### 🔧 Unified Command Parser (`AICommandParser.ts`)
- **Integrated parser** combining all command types
- Unified parsing result with metadata
- Legacy support for backward compatibility
- Export formatting with JSON structure
- Category and risk metadata

### 🎨 UI/UX Improvements

#### Action Chain Queue
- JSON format display for commands
- Category icons and color coding
- Permission status indicators
- Risk level badges for shell commands

#### Export Functionality
- Separate JSON sections for PDF, actions, and shell logs
- Structured export format for all command types
- Full action chain traceability

#### Collapsible Chat Elements
- OCR results in collapsible panels
- DOM extraction results with filter statistics
- Visual distinction between result types

### 📋 Supported Commands (v0.2.4)

#### Navigation Commands
- `[NAVIGATE: url]` - Navigate to URL
- `[OPEN_VIEW: view_name]` - Switch workspace view
- `[RELOAD]` / `[GO_BACK]` / `[GO_FORWARD]` - Browser navigation

#### Browser Commands
- `[SEARCH: query]` - Default engine search
- `[WEB_SEARCH: query]` - Real-time web search with RAG
- `[READ_PAGE_CONTENT]` - Read active tab content
- `[LIST_OPEN_TABS]` - List all open tabs
- `[DOM_SEARCH: query]` - Search page DOM
- `[DOM_READ_FILTERED: query]` - Read DOM with filtering

#### Automation Commands
- `[CLICK_ELEMENT: selector | reason]` - Click by CSS selector
- `[FIND_AND_CLICK: text | reason]` - Find and click text
- `[FILL_FORM: selector | value]` - Fill form field
- `[SCROLL_TO: selector]` - Scroll to element

#### Media Commands
- `[SCREENSHOT_AND_ANALYZE]` - Capture and analyze screen
- `[OCR_SCREEN]` / `[OCR_COORDINATES: x,y,w,h]` - OCR extraction
- `[SHOW_IMAGE: url | caption]` - Display image
- `[SHOW_VIDEO: url | title | description]` - Display video card

#### System Commands
- `[SHELL_COMMAND: command]` - Execute terminal command
- `[SET_VOLUME: percentage]` - Set system volume
- `[SET_BRIGHTNESS: percentage]` - Set screen brightness
- `[OPEN_APP: app_name]` - Launch application
- `[SET_THEME: dark|light|system]` - Change theme

#### Utility Commands
- `[GENERATE_PDF: title | options...]` - Create branded PDF
- `[GENERATE_DIAGRAM: mermaid_code]` - Create Mermaid diagram
- `[OPEN_PDF: file_path]` - Open PDF in viewer
- `[ORGANIZE_FOLDER: path]` - Organize folder by type
- `[WAIT: milliseconds]` - Pause execution

#### Gmail Commands
- `[GMAIL_AUTHORIZE]` - Authorize Gmail access
- `[GMAIL_LIST_MESSAGES: query | max]` - List messages
- `[GMAIL_GET_MESSAGE: id]` - Get message content
- `[GMAIL_SEND_MESSAGE: to|subject|body]` - Send email
- `[GMAIL_ADD_LABEL: id|label]` - Add label

#### Meta Commands
- `[THINK: reasoning]` - Show AI reasoning
- `[PLAN: description]` - Show AI plan
- `[EXPLAIN_CAPABILITIES]` - List all capabilities
- `[OPEN_MCP_SETTINGS]` - Open MCP settings

### 📁 File Structure (v0.2.4)

```
src/lib/
├── AICommandParser.ts      # Unified parser (enhanced)
├── PDFCommandParser.ts     # NEW: PDF command parser
├── ActionTagParser.ts      # NEW: Action tag parser
├── ShellCommandParser.ts   # NEW: Shell command parser
└── ActionLogsStore.ts      # NEW: Action logs store
```

### 🔒 Security Improvements

#### Shell Command Protection
- 20+ dangerous pattern signatures
- Fork bomb detection
- Recursive delete prevention
- Privilege escalation blocking
- Network shell pattern detection
- Encoded command detection

#### Command Validation
- Length limits (1000 chars max)
- Blocked command list
- Safe alternative suggestions
- Sanitization of special characters

### 📊 Export Format (v0.2.4)

#### PDF Commands Export
\`\`\`json
{
  "type": "PDF_COMMANDS_EXPORT",
  "version": "1.0",
  "commands": [...]
}
\`\`\`

#### Action Tags Export
\`\`\`json
{
  "type": "ACTION_TAGS_EXPORT",
  "version": "1.0",
  "summary": { "total": 5, "byCategory": {...} },
  "commands": [...]
}
\`\`\`

#### Shell Commands Export
\`\`\`json
{
  "type": "SHELL_COMMANDS_EXPORT",
  "version": "1.0",
  "summary": { "riskLevels": {...} },
  "commands": [...]
}
\`\`\`

### 🐛 Bug Fixes

- Fixed duplicate command parsing in switch statements
- Fixed OCR result display in collapsible panels
- Fixed DOM extraction statistics display
- Fixed PDF screenshot capture timing
- Fixed shell command permission prompts

### 🚀 Performance

- Optimized command parsing with single-pass algorithms
- Reduced memory footprint for log storage
- Improved regex patterns for faster matching
- Lazy loading of parser modules

---

## Version 0.2.3 - Neural Action Queue

### 🎯 Overview
Enhanced AI reliability with the Neural Action Queue for autonomous web interaction.

### Changes
- Neural Action Queue for sequential command execution
- Full MCP integration for external data fetching
- Command chain visualization
- Improved permission handling

---

## Version 0.2.2 - Intelligence Update

### Changes
- Universal Neural Translation
- Neural Analysis Sidebar
- Find & Click (OCR)
- Persistent Neural Memory
- Google OAuth Integration

---

## Version 0.1.9 - Browser Enhancements & Bug Fixes

### 🔧 Major Fixes

#### 1. **Google Login Removed**
- Removed Google OAuth integration from main process (`main.js`)
- Updated authentication to use landing page web-auth flow
- Renamed `googleToken` → `authToken` for generic auth handling
- Updated UI to show "Authorize Workspace" instead of "Authorize via Google"
- Removed `google-oauth-login` IPC handler

#### 2. **Persistent LLM Cache Implemented**
- Added persistent cache storage to `llm_cache.json` in user data directory
- Cache survives app restarts, saving tokens and improving response times
- Automatic cache loading on startup
- Cache persists after each LLM generation

#### 3. **Enhanced External App Opening (Windows)**
- Improved `open-external-app` handler for Windows
- Now uses `start ""` command for better app discovery
- Supports both absolute paths and app names in PATH
- Fallback mechanisms for macOS and Linux

#### 4. **Screen Capture Handler Consolidation**
- Removed duplicate `capture-screen-region` handlers
- Consolidated to single implementation using `captureScreenRegion` helper
- Cleaner error handling and logging

#### 5. **Tesseract.js Initialization Fix**
- Fixed "Cannot read properties of null (reading 'host')" error
- Added explicit CDN paths for worker, language data, and core WASM
- Improved error logging for Tesseract initialization failures
- Uses jsdelivr and tessdata CDNs for reliable loading

#### 6. **Enhanced Calculator Functionality**
- Supports advanced math operations: `^` (power), `%`, bitwise operators
- Supports Math functions: `Math.sin()`, `Math.sqrt()`, `Math.PI`, etc.
- Safer evaluation using `new Function()` instead of `eval()`
- Better validation for mathematical expressions

#### 7. **Parallel AI Command Execution**
- AI can now execute multiple non-sequential commands simultaneously
- Sequential commands (navigation, form filling, clicks) run in order
- Parallel commands (volume, brightness, app opening) run immediately
- Improved command queue processing with better error handling

### 🎨 UI/UX Improvements

- Updated Settings Panel to use generic "Authorize Workspace" button
- Removed Google branding from authentication flows
- Improved login prompt messaging
- Better error messages for auth failures

### 🔒 Security Enhancements

- Shell command permission system remains in place
- User authorization required for new shell commands
- Improved command validation and sanitization

### 📝 Code Quality

- Removed dangling code from screen capture refactoring
- Fixed TypeScript lint errors for renamed auth properties
- Improved code organization in main process
- Better separation of concerns for auth handling

### 🐛 Bug Fixes

- Fixed profile photo visibility issues
- Resolved app path resolution on Windows
- Fixed cache persistence across sessions
- Corrected IPC handler naming conflicts

### 🚀 Performance

- LLM cache reduces redundant API calls
- Parallel command execution improves AI responsiveness
- Optimized screen capture workflow

### 🔐 Code Signing Setup

- **Windows**: Added code signing configuration for electron-builder
  - Supports `.pfx` certificates from trusted CAs
  - Automatic signing of executables and DLLs
  - GitHub Actions integration with secrets
  - See `CODE_SIGNING.md` for complete setup guide

- **Configuration Added**:
  - Certificate file path: `certs/aartiq-browser.pfx`
  - SHA256 signing algorithm
  - RFC3161 timestamping for long-term validity
  - Environment variable support (`CSC_LINK`, `CSC_KEY_PASSWORD`)

- **GitHub Secrets Required**:
  - `WINDOWS_CERTIFICATE`: Base64-encoded PFX file
  - `WINDOWS_CERTIFICATE_PASSWORD`: Certificate password

**Note**: Code signing certificate must be purchased separately (~$100-$400/year). See `CODE_SIGNING.md` for provider recommendations and setup instructions.

### 🐛 Crash Fix: Duplicate IPC Handler

**Issue**: "Attempted to register a second handler for 'capture-screen-region'"

**Cause**: Multiple app instances or hot reload during development

**Solutions**:
1. Close all app instances and restart
2. Kill lingering processes in Task Manager
3. Clear app cache if issue persists
4. Use `npm run check-dups` to verify no duplicate handlers

See `CRASH_FIX.md` for detailed troubleshooting guide.

---

## MCP Integration & AI Agency (Current)

### 🔗 Model Context Protocol (MCP) Support
- **Full MCP Integration**: Connect external Model Context Protocol (MCP) servers to gain new tools and access remote data.
- **Preset Servers**: Out-of-the-box support for GitHub, Google Drive, Dropbox, and more.
- **Centralized MCP Panel**: New dedicated settings section to manage all connected servers.
- **"Refresh All" Functionality**: One-click tool list synchronization for all active servers.
- **Dynamic Tool Discovery**: Automatic detection and display of available tools for each server.

### 🤖 AI Agency Improvements
- **New AI Command**: Added `[OPEN_MCP_SETTINGS]` to allow the AI to programmatically open the integration panel.
- **Permission-Gated Execution**: AI can only execute MCP tools from servers authorized by the user.
- **Smart Integration Prompts**: AI now recognizes when to ask for a new server connection to fulfill a user request.
- **Refined System Instructions**: Enhanced AI's understanding of external file fetching and repository access.

### 🎨 UI/UX Enhancements
- **Deep-Linked Settings**: Programmatic navigation to specific settings sections (e.g., straight to MCP).
- **Responsive Server Cards**: Premium UI for managing server status, tools, and connections.
- **Improved Information Hierarchy**: Better visibility for active tools and server states.

---

## Migration Notes

### For Developers

1. **Auth Token Changes**: If you're using `googleToken` in your code, update to `authToken`
2. **Client ID**: `googleClientId` → `clientId`, `googleRedirectUri` → `redirectUri`
3. **Login Handlers**: `handleGoogleLogin` → `handleLogin`, `handleGoogleSignOut` → `handleSignOut`

### For Users

- Authentication now goes through the landing page exclusively
- Existing sessions should continue working
- Cache will start building automatically on first use

---

## Known Issues

- `.exe` signing still pending (shows "unknown developer" warning)
- `robotjs` availability varies by platform (affects "Find & Click")
- Some Tesseract initialization may still fail on slow connections

## Next Steps

1. Implement code signing for Windows executables
2. Add alternative to `robotjs` for cross-platform click simulation
3. Implement offline Tesseract language data bundling
4. Add more comprehensive error recovery for AI commands
5. Implement request queuing for rate-limited APIs

# Aartiq Browser (Desktop)

> **Aartiq — For the questions that matter.**

The Electron desktop application for Aartiq — an AI-native browser with OS automation capabilities.

## Overview

This package contains the desktop browser built with Electron + Next.js. It includes the main process, renderer UI, AI chat sidebar, security layer, MCP bridge, DOM engine v2, and native OS automation backends.

## Quick Start

```bash
# From repository root
cd aartiq-browser
npm install
npm run dev              # Next.js frontend (port 3003)
npm run electron-start   # Electron shell
```

## Project Structure

```
aartiq-browser/
├── main.js                 # Electron main process entry
├── preload.js              # Secure IPC bridge
├── package.json
├── next.config.js
├── src/
│   ├── components/         # React UI (126+ components)
│   │   ├── AIChatSidebar.tsx
│   │   ├── CommandPalette.tsx
│   │   ├── ActionChain.tsx
│   │   └── ...
│   ├── lib/                # Core services
│   │   ├── AICommandParser.ts
│   │   ├── DOMEngine.ts
│   │   ├── Security.ts
│   │   ├── webauthn-service.js     # WebAuthn/FIDO2 native verification
│   │   ├── AdvancedDocumentEngine.ts
│   │   ├── WiFiSyncService.ts
│   │   ├── tesseract-service.js
│   │   └── plugin-manager.js
│   ├── service/            # Background services
│   │   ├── biometric-auth.js        # Cross-platform biometric auth
│   │   ├── windows-hello-auth.js    # Windows Hello WebAuthn
│   │   └── ...
│   ├── store/              # Zustand state + selectors
│   ├── automation/         # Cross-platform OS automation
│   │   ├── mac.js
│   │   ├── win.js
│   │   ├── linux.js
│   │   └── fallback.js
│   └── lib/native-panels/  # SwiftUI panels (macOS)
└── scripts/                # Build & install scripts
```

## Key Services (src/lib/)

| File | Purpose |
|------|---------|
| `Security.ts` / `SecurityValidator.js` | Command validation, risk levels, injection detection |
| `webauthn-service.js` | WebAuthn/FIDO2 native verification (Windows Hello, macOS Touch ID via caBLE) |
| `AIChatSidebar.tsx` | Main AI chat interface |
| `AICommandParser.ts` | Parses AI output into executable commands |
| `DOMEngine.ts` | Centralized DOM interaction engine v2 with cascading fallbacks |
| `skill-loader.js` | On-demand AI skill loading and management |
| `AdvancedDocumentEngine.ts` | PDF/XLSX/PPTX generation |
| `WiFiSyncService.ts` | WebSocket sync desktop↔mobile with permanent authentication tokens |
| `MasterPINService.ts` | Master PIN (PBKDF2-SHA256, 100k rounds) stored in Native OS Keychain |
| `UnifiedSessionManager.ts` | Unified session manager (tabs, history, tasks, permissions, sync snapshots) |
| `PermissionRelayService.ts` | Dual-gate permission relay (Master PIN + Android Screen Lock) for remote approvals |
| `DeviceIdentifier.ts` | Hardware detection & real friendly computer name detection |
| `P2PFileSyncService.ts` | Peer-to-peer file transfer |
| `CloudSyncService.ts` | Firebase cloud sync |
| `SiriShortcutsIntegration.ts` | macOS Siri/Shortcuts bridge |
| `tesseract-service.js` | OCR via Tesseract.js |
| `plugin-manager.js` | Dynamic plugin loading |
| `context-compactor.ts` | Token-aware message history compaction |
| `command-validator.js` | Pre-execution command validation with audit log |
| `policy-generator.ts` | Natural language → structured policy rules |
| `policy-engine.ts` | Dual-layer (local+cloud) policy evaluation |
| `approval-gate.js` | SHA-256 input-bound approval tickets |
| `entity-extractor.ts` | Regex extraction of prices, PII, API keys from page content |
| `domain-tracker.ts` | Per-domain cumulative agent time tracking |
| `guardrails/` | Two-tier content sanitization (normal/strict) |
| `task-lifecycle.ts` | Formal task state machine with guarded transitions |
| `approval-waiter.ts` | Promise-based async approval with timeout |
| `agent/` | Planner + Navigator multi-agent architecture |
| `action-replay.ts` | Action replay with element remapping and retry |
| `event-bus.ts` | Typed pub/sub event system |
| `llm-factory.ts` | Multi-provider LLM factory (10+ providers) |
| `content-tagging.ts` | XML tagging for anti-prompt-injection |
| `structured-output.ts` | Dual-path JSON parser with repair fallback |
| `sw-resilience.js` | Service worker lifecycle approval persistence |
| `agent-api/` | Tool registry, transports and security pipeline for external agents |
| `research-pipeline.ts` | Bounded search → fetch → claim cross-verification for Deep Research |
| `researchState.ts` | Reducer for streaming research progress into the UI |
| `web-search-service.js` | Multi-provider web/news search, with HTML scraping as fallback |
| `web-extractor.js` | Page fetch + content extraction used by the research pipeline |

## Security

### Native OS Verification (WebAuthn/FIDO2)

Aartiq uses **WebAuthn/FIDO2** for cryptographic identity verification when approving high-risk AI actions. This replaces older PowerShell-based verification with proper low-level OS verification.

1. **Challenge-Response**: Each verification generates a 256-bit random challenge
2. **TPM-Backed Keys**: Private keys are stored in the device's TPM and never leave hardware
3. **Biometric/PIN**: Windows Hello prompts for fingerprint, face recognition, or PIN
4. **Attestation**: TPM 2.0 attestation verifies the key is genuine hardware-backed

| Platform | Method | API |
|----------|--------|-----|
| Windows 10 1903+ | WebAuthn via `webauthn.dll` | `win10Register` / `win10Authenticate` |
| macOS 12+ | caBLE WebAuthn via AuthenticationServices | `cableRegister` / `cableAuthenticate` |
| Linux | Falls back to password prompt | N/A |

### Directory Allowlist

AI file access is restricted to user-approved directories via a configurable allowlist. Shell commands that read or write outside allowed paths are blocked.

### Master PIN & Unified Mobile Permission Relay

- **Native OS Keychain Integration:** Master PIN credentials (PBKDF2-SHA256, 100,000 iterations) are stored and encrypted using native OS backends via Electron's `safeStorage` (Apple Keychain / Windows DPAPI / Linux Secret Service) and `native-keychain.js`.
- **Permanent Sync Authentication:** Paired mobile devices receive cryptographic permanent tokens stored in native secure storage, eliminating repetitive code pairing.
- **Dual-Gate Verification:** For remote or high-risk automations, approvals require the shared Master PIN + Android device screen lock (Biometric fingerprint/face or system PIN/pattern).
- **Unified Session Manager:** All active tabs, browsing history, automation tasks, and permission audits are continuously recorded and synchronized locally over LAN (`:3004`) or remotely via Firebase Realtime Database.
- **Real Hardware Detection:** Automatic detection of friendly computer names (e.g. *"Sandip’s MacBook Pro"*) and hardware models with realistic device illustration graphics.

### Vault & Credentials

- Vault encryption key stored in native OS keychain (not plaintext config)
- Windows AppContainer OS-level sandboxing (restricted Low-IL token + Job Object; directory allowlist and network policy enforced by the OS via the AppContainer package SID)
- WebAuthn credentials in `~/.aartiq/webauthn-credentials.json` (mode `0600`)

## Context Compaction

Long AI conversations can exceed the LLM's context window. `context-compactor.ts` provides token-aware message history compaction that runs automatically during chat:

### How It Works

1. **Token Estimation**: Each message is scanned and its token count is estimated (~0.4 tokens per ASCII char, ~0.8 per Unicode char, +4 per message overhead)
2. **Compaction Trigger**: When total tokens exceed `maxTokens` (default 64K for chat, 128K general), compaction activates
3. **Preservation Rules**:
   - **System messages** — always preserved (instructions, skill context, preferences)
   - **Recent messages** — last 6 exchanges kept in full
   - **Middle messages** — compressed into a structured summary block
4. **Summary Generation**: Middle messages are grouped into blocks (≤2000 tokens each) and summarized per block using a template that captures the last user query and AI response
5. **Size Check**: If the compressed history is actually larger than the original (e.g., very few messages), the original is kept
6. **Last-Resort Truncation**: If still over the limit after compression, messages are progressively truncated from the oldest

### Integration Points

Compaction runs at three points in `AIChatSidebar.tsx`:
- After building the initial message history for a new AI request
- After appending the assistant's response
- After appending action execution results

### Configuration

```typescript
interface CompactionOptions {
  maxTokens: number;          // Token limit before compaction (default: 64000)
  preserveSystem: boolean;    // Always keep system messages (default: true)
  preserveRecentCount: number;// Recent exchanges to keep in full (default: 6)
}
```

## DOM Engine v2

Centralized DOM interaction engine with cascading fallback strategies:

- **Element Resolution**: CSS selector → text content → ARIA role → placeholder → broad scan
- **Multi-field Forms**: `dom-multi-fill-form` for atomic form filling
- **Click Hardening**: Default fallback strategies ensure buttons are found even with empty params
- **110 Jest Tests**: covering engine v2, skill loading, and handler fallbacks (declared test blocks)

## Agent API

36 tools over two transports — HTTP (`POST /api/<method>`) and MCP over stdio —
served from one registry, so MCP clients and HTTP callers cannot drift apart.
The registry in `src/lib/agent-api/registry.ts` is the single enforcement point:

```
verb gate → tab lock → handler → untrusted-output injection scan
```

A rejected gate returns an error result and never the action.

| Category | Tools |
|----------|-------|
| Security | `security_scan`, `security_audit`, `security_killswitch`, `trust_list` |
| Agents | `agent_register`, `agent_list`, `agent_revoke`, `tab_handoff` |
| Snapshots | `snapshot`, `click_ref`, `fill_ref`, `type_ref`, `element_action` |
| Page | `page_find`, `dom_query`, `get_page_text` |
| Search | `web_search`, `news_search`, `search_providers` |
| Forms | `fill_form`, `form_submit`, `autofill_match`, `vault_list`, `vault_unlock` |
| Extensions | `extension_list`, `extension_install_webstore`, `extension_import_chrome`, `extension_analyze` |
| Theme | `theme_resolve`, `ui_mode_set` |
| Navigation | `navigate` |
| Tabs | `list_tabs`, `new_tab`, `close_tab` |
| System | `browser_status`, `open_panel` |

### Reading and searching one page

`page_find` searches a page that is **already open** — no network request, no
other tab touched. Use it instead of `web_search` when the answer is on screen,
because a search sends the user's query to a third party to find somebody
else's page. `mode="tree"` matches accessible names, values, hrefs and roles and
returns refs you can act on; `mode="text"` scans rendered prose and returns
context snippets. `get_page_text` returns the tab's text.

The four search tools differ in what they give back, and the difference matters
more than it looks:

- `web_search` — links and snippets. No dependable publication dates.
- `news_search` — real publication dates, which is the only thing that makes
  "which source is most recent" answerable.
- `search_providers` — reports which provider is configured, whether it scrapes,
  and whether it has a news index.

**Provider preference is API-first.** Tavily is the recommended single key
(1,000 free credits/month, no card). SerpAPI and Brave also work. With no key at
all, search still runs by scraping a search engine's HTML — rate-limited,
slower, and broken without warning when the markup changes, and with no
publication dates. See `.env.example` section 5.

### Filling forms without submitting them

`fill_form` and `form_submit` are deliberately separate tools rather than one
tool with a `submit` flag. `fill_form` carries the `input` verb and never
submits; `form_submit` is `sideEffecting` and goes through approval. A caller
cannot reach the side effect by passing a parameter.

Refs bind to elements by a `data-aartiq-ax` stamp the collector writes onto
actionable nodes (with `backendNodeId` as first-priority identity), so a stale
ref fails loudly instead of silently addressing a different element after the
page shifts.

## Deep Research Pipeline

`src/lib/research-pipeline.ts` runs the bounded search → fetch → verify job
behind Deep Research, with dependencies injected (search provider, page fetcher,
progress emitter) so the whole thing is testable without network access.

```
plan → search → fetch pages → extract claims → cross-verify → rank → generate
```

- **Budget.** Per-run options with defaults; an absent option takes the default
  rather than clamping to a minimum.
- **Claim-level cross-verification.** Claims are keyed on `subject|verb`, so
  "450 million dollars" and "450 million euros" stay one claim with two
  conflicting figures instead of being matched away.
- **Source diversity.** A claim needs corroboration from ≥2 distinct domains.
  Domains are re-derived from each claim's URL, so `news.reuters.com` and
  `uk.reuters.com` do not pass as two independent sources.
- **Last-source tracking.** Only reported when publication timestamps are
  reliable. Otherwise the answer is "unknown", with the reason attached, so
  callers do not retry and guess anyway.

Progress streams to the UI over the `research-progress` channel (`runResearch`
in `preload.js` → `applyResearchProgress` in `researchState.ts`), and a
"Sources disagree" panel renders the unresolved contradictions inline.

Known limit, stated rather than hidden: claim extraction surfaces numeric claims
with a named subject, so disputed *qualitative* findings never reach the
contradictions panel. That is a false negative rather than a false positive, and
the coverage figure reflects numeric agreement specifically.

## Build

```bash
# Development
npm run dev
npm run electron-start

# Production build
npm run build
npm run electron-build

# Platform-specific
npm run build:win
npm run build:mac
npm run build:linux
```

## License

Apache License 2.0 — see [LICENSE](LICENSE) in the repository root.
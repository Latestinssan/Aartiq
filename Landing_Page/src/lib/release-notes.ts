// Auto-generated release notes
// Add new releases following the format below

export interface ReleaseEntry {
  version: string;
  date: string;
  codename: string;
  channel: 'alpha' | 'beta' | 'stable';
  changes: {
    new?: string[];
    fix?: string[];
    change?: string[];
    docs?: string[];
    security?: string[];
  };
}

export const releases: ReleaseEntry[] = [
  {
    version: '0.3.7',
    date: '2026-09-13',
    codename: 'AppContainer',
    channel: 'stable',
    changes: {
      new: [
        'Windows AppContainer OS-level sandboxing — commands run as an AppContainer under a restricted, Low-integrity token inside a verified Job Object; OS-enforced filesystem and network isolation matching Seatbelt and bubblewrap',
        'Hardened macOS Seatbelt profiles — additionally deny AF_UNIX sockets (system-socket), confine signals to the sandbox, deny mount/umount, and restrict executable mappings',
        'Hardened Linux bubblewrap — namespaces expanded to user/cgroup plus a new session; capability pre-flight probes the same flags and fails closed',
      ],
      security: [
        'Windows directory allowlist enforced by the OS via ACL grants on the AppContainer package SID (icacls); grants revoked and the AppContainer profile deleted after each run',
        'Windows network denied by zero AppContainer capabilities; high/critical-risk commands get deny-all network on every platform',
        'macOS (deny system-socket) closes AF_UNIX IPC (syslog, Docker, P2P) not covered by the existing network* block',
        'macOS signal confinement — (deny signal) by default, allowed only for the sandbox self and children',
        'Linux user and cgroup namespaces closed via --unshare-user and --unshare-cgroup; --new-session isolates the controlling terminal',
      ],
      docs: [
        'Security docs, testing docs, and release notes updated to describe AppContainer and the hardened macOS/Linux profiles, with honest remaining limitations',
      ],
    },
  },
  {
    version: '0.3.6',
    date: '2026-08-19',
    codename: 'Aegis',
    channel: 'stable',
    changes: {
      new: [
        'Agent API Tool Server — browser capabilities exposed to AI agents through a single security-enforced tool registry over MCP and HTTP',
        'Security-enforced tool calls — every tool call routes through the SecurityPipeline (agent trust, fail-closed origin/verb policy, prompt-injection scan)',
        'Multiple agents, one browser — several agents can connect; each is trust-scoped and a per-tab lock prevents two agents driving the same tab',
        'Accessibility snapshots with stable @ref ids — AX-tree nodes carry identity-bound references that stay stable and are never reused',
        'Encrypted autofill vault — credentials and profiles stored AES-GCM under a passphrase; field matcher maps inputs without exposing unrelated entries',
        'Chrome extension import + CRX3 verification — load from disk or the Web Store; packages are signature-verified (RSA-SHA256) before any code loads',
        'UI themes and modes — selectable themes plus normal/focus/reader/zen/presentation modes',
        'Local model providers — LM Studio and Ollama on-device, plus an OpenClaw-compatible local-agent bridge',
      ],
      fix: [
        'Agent-trust gating no longer fails open — SecurityPipeline and AgentRegistry now share one AgentTrustRegistry so trust is enforced at the gate',
        'Autofill vault tests use a passphrase that satisfies the minimum length requirement',
      ],
      change: [
        'New src/lib/agent-api modules (types, registry, bridge, providers, tools, server, bootstrap) for the tool registry and transports',
        'New src/lib/guardrails modules (prompt-injection, origin-guard, agent-trust, spotlight) plus a SecurityPipeline gate',
        'New src/lib/agent modules (agent-registry, tab-lock) for multi-agent coordination and per-tab leases',
        'New src/lib/snapshot, autofill/matcher, autofill/vault, extensions/chrome-importer, extensions/crx-verifier, extensions/permission-analyzer, theme/resolver',
        'main.js starts the Agent API during app readiness, wrapped so a failure never blocks the browser',
      ],
      docs: [
        'README documents the Agent API & Tool Server, multi-agent support, AX-tree snapshots, form filling, CRX3-verified extension install, UI modes, and local models',
      ],
      security: [
        'Fail-closed origin/verb policy — actions are denied unless an explicit policy permits them; a kill switch denies everything',
        'Agent-trust scoping — each connected agent is limited to the verbs and origins its trust level allows',
        'Prompt-injection scan — tool output that may carry attacker content is scanned and quarantined before reaching the model',
        'CRX3 signature verification — Web Store packages are verified before any code loads; failure rejects the package',
        'Encrypted autofill vault — stored credentials are AES-GCM encrypted; plaintext is never written to disk',
        'Per-tab locking — two agents cannot act on the same tab concurrently',
      ],
    },
  },
  {
    version: '0.3.5',
    date: '2026-07-22',
    codename: 'Nebula',
    channel: 'stable',
    changes: {
      new: [
        'Directory Allowlist System — AI file access restricted to explicitly approved directories with read/write separation',
        'Path canonicalization via fs.realpath() — resolves symlinks before allowlist checking to prevent traversal attacks',
        'Just-in-time permission prompts — request-directory-access IPC handler for on-demand directory approval',
        'Batched multi-directory approval — approve multiple paths in a single ticket via CapabilityController',
        'Settings UI for directory allowlist — access level dropdown (Read Only / Read & Write), recursive toggle, revoke buttons',
        'OS-Level Sandboxing — platform-specific sandboxing with Seatbelt (macOS), bubblewrap (Linux), and Job Objects (Windows)',
        'Windows Job Object containment — process limits and kill-on-close (process confinement only; no OS-level filesystem/network isolation)',
        'File management handlers — file-move, file-copy, file-open, file-print route around shell sandbox using Node.js fs APIs',
        'Vault Migration — proactive re-encryption of legacy LCL: and E2EE: vault data to modern E2EE2: format',
        'Vault migration IPC handlers — vault-check-migration and vault-migrate-to-modern for startup migration',
      ],
      fix: [
        'CapabilityController.approveAndExecute() now calls approveTicket before redeemTicket',
        'command-validator.js checkShellPermission() uses real PermissionStore with DI pattern',
        'execShellCommand() pipeline: validateCommand → checkShellPermission → directory allowlist → executeSandboxed',
      ],
      change: [
        'Security model expanded from 3 layers to 6 layers of defense-in-depth',
        'PermissionStore allowlist entries now support {path, recursive, access, grantedAt, grantedVia} format',
        'Sandbox profiles generated dynamically from allowlist — no stale cached profiles',
        'Environment variables sanitized in all sandboxed processes — API keys never exposed',
        'sandbox-executor.js exports new Windows sandbox functions',
        'preload.js exposes new IPC bridges: vaultCheckMigration, vaultMigrateToModern',
      ],
      docs: [
        'Security page updated with 6 defense-in-depth layers, 10 threat scenarios',
        'AI-GUIDE.md updated with new security architecture (layers 4–7)',
        'Search index updated with directory allowlist, OS sandboxing, capability-scoped execution entries',
        'llms.txt updated with six-layer security description',
      ],
      security: [
        'Directory allowlist prevents AI from accessing sensitive directories outside the approved set',
        'Symlink traversal attacks blocked via fs.realpath() resolution before allowlist checking',
        'Read/write separation enforced — read-only grants cannot delete or overwrite files',
        'Windows: Job Objects confine processes with process limits and kill-on-close (process containment only)',
        'Windows: sandbox setup failures fail closed — denied with SANDBOX_SETUP_FAILED, never run unsandboxed',
        'macOS: Seatbelt profiles restrict filesystem writes and network access per execution',
        'Linux: bubblewrap creates isolated namespaces with read-only system paths',
        'Legacy vault data (LCL:, E2EE:) proactively migrated to E2EE2: format with 600K PBKDF2',
        'All 36 directory-allowlist tests passing',
      ]
    }
  },
  {
    version: '0.3.4',
    date: '2026-07-20',
    codename: 'Nebula',
    channel: 'stable',
    changes: {
      new: [
        'Token-based Claude Desktop MCP pairing — auto-confirm on local SSE connection, no chat token paste needed',
        'MCP pairing token with 10-min expiry — generated on auto-configure, sent to local server via POST /pairing/token',
        'Auto-confirm pairing when mcp-remote connects to /sse — only local processes can reach 127.0.0.1:3001',
        'UI polls /pairing/status every 2s — shows "Waiting for connection..." → "Claude Desktop connected!"',
        'Searchable command palette (⌘K) — quick access to all actions, settings, and navigation',
        'Trust model — every action answers 5 trust questions before execution (intent, scope, risk, reversibility, context)',
        'Keyboard shortcuts for AI controls — play/pause/stop with global hotkeys',
        'Action cards with explainability — each action shows reason, risk level, and required permission',
        'Enhanced agent state indicator — visual states for idle, planning, executing, paused, error, and complete',
        'Timestamped vertical timeline for action chain — chronological view of all agent actions',
        'Smart message rendering with expandable results — collapsible tool outputs in chat',
        'Workflow recording and playback with DOM-aware steps — record actions and replay with live DOM context',
        'AutomationManager persistence and CRUD — create, read, update, delete saved automations',
        'DOM click element with multi-strategy fallback chain — tries multiple click strategies for reliability',
        'MULTI_FILL_FORM command — atomic multi-field form filling with optional delay, retry, and verification',
        'Centralized DOM interaction engine — unified API for all DOM operations (click, fill, scroll, extract)',
      ],
      fix: [
        'Added FILL_FORM, CLICK_AT, SCROLL_TO, MULTI_FILL_FORM, RECORD_WORKFLOW, PLAY_WORKFLOW to COMMAND_REGISTRY',
        'Crash-proof main.js PDF templates — simplified generation with source favicons',
        'Fixed React hydration errors with ClientOnlyPage wrapper',
        'Shell noise hidden — clean progress results instead of raw terminal output',
        'SEARCH_RESULTS auto-navigates and reads full page content',
        'Removed automatic pre-flight web search — AI now decides when to search',
        'Replaced failing web search with MCP backend, skill-based prompt injection, and DOM_SEARCH fallbacks',
        'Fixed multiFillForm type signature — now accepts Record<string, string> fields',
        'Fixed pullOllamaModel type — callback-based, matches preload implementation',
        'Fixed importOllamaModel type — renamed from ollamaImportModel, takes { filePath } object',
        'Fixed ollamaListModels return type with proper models array structure',
        'Fixed LLMProviderSettings store property mismatches: azureOpenaiApiKey, azureOpenaiEndpoint, azureOpenaiModel',
        'Removed non-existent openAppleIntelligence electronAPI call',
        'Fixed OPEN_APP routing for VS Code and other desktop applications',
        'Fixed Swift type-checker timeout in downloads panel build',
        'Resolved all TypeScript build errors in aartiq-browser',
      ],
      change: [
        'MCP pairing flow simplified: auto-configure → restart Claude → auto-verify (no copy/paste tokens)',
        'MCP server auto-confirms pairing on local SSE connection (security boundary: 127.0.0.1 only)',
        'Removed manual PIN/prompt copy-paste flow that failed due to LLM safety training',
        'Updated electron.d.ts with correct multiFillForm, pullOllamaModel, importOllamaModel, ollamaListModels types',
        'Complete UX polish — agent state, action chain, planning screen, compressible steps, action cards, live terminal, permission dialogs, batch permissions, high-risk warnings, auto-approve',
        'Tool output bubbles simplified to minimal expandable text in AI sidebar',
      ],
      docs: [
        'Created Claude MCP Architecture guide',
        'Updated README for 64-tool MCP server',
        'Updated AI-GUIDE.md with v0.3.4 version and token-based pairing workflow',
        'Updated changelog with accurate v0.3.4 details',
      ],
      security: [
        'MCP server binds to 127.0.0.1 only — no external network exposure for pairing',
        'Pairing tokens expire after 10 minutes',
        'Biometric approval (Touch ID / Windows Hello) required for high-risk actions',
        'Medium-risk approval required — every action must pass 5 trust questions',
        'Per-action approval prompts with native OS dialogs for medium-risk operations',
        'Encrypted local vault (AES-256-GCM) with OS keychain backup for credentials',
      ]
    }
  },
  {
    version: '0.3.3',
    date: '2026-07-13',
    codename: 'Nebula',
    channel: 'stable',
    changes: {
      new: [
        'Claude Desktop MCP server — 64 tools across 11 categories (AI chat, tabs, bookmarks, history, settings, scheduling, permissions, security, panels, app knowledge)',
        'MCP HTTP bridge architecture — stdio MCP server communicates with the running browser over HTTP (port 46203)',
        'MCP AI sidebar integration — send_ai_prompt routes through the actual sidebar for full capabilities: RAG, web search, PDF generation, navigation, structured output',
        'MCP bookmark management — Claude can add, list, and remove bookmarks',
        'MCP history access — Claude can browse and clear browsing history',
        'MCP settings control — Claude can read and modify any browser setting',
        'MCP scheduled tasks — Claude can create, list, toggle, delete, and run scheduled tasks',
        'MCP permission management — Claude can list, grant, and revoke permissions',
        'MCP security management — Claude can read security settings, update them, and change firewall levels',
        'MCP panel control — Claude can open any browser panel (settings, history, bookmarks, downloads, clipboard, permissions, sync, command center)',
        'MCP app knowledge — built-in explain_feature, list_all_features, get_security_overview tools',
        'MCP web search tool — real browser-based search with DuckDuckGo default, Google fallback, ad filtering',
        'Standalone MCP server package and Claude Desktop extension bundle (.mcpb)',
        'Cross-platform native approval manager — Windows and Linux dialogs for MCP permission prompts',
        'Native Swift ApprovalCard with QR code, PIN entry, and keyboard shortcuts (Shift+Tab, Esc)',
        'AI preference learning and cross-session memory privacy toggles',
        'Vector memory stats and clear functionality',
        'Biometric Every Action security toggle — optional per-action Touch ID approval',
      ],
      fix: [
        'Fixed prompt handler to wait 5s for renderer sidebar pickup before falling back to AiGateway path',
        'Reclassified destructive file commands (rm, unlink, del) as high risk instead of silently blocking',
        'Fixed MCP web_search stealth browser for Google — avoids bot detection with real browser user agent',
        'Fixed MCP web_search to use real browser instead of API keys, default to DuckDuckGo, filter ads, auto-fallback from Google',
        'Fixed MCP _getSearchView to return webContents consistently instead of BrowserView',
        'PDF generation uses transparent icon, fixes UTF-8 encoding, adds page break rules',
        'Fixed MCP server startup ordering and added auto-configure for Claude Desktop',
        'Fixed Windows minimize/maximize/close buttons on right side of title bar',
        'Fixed TypeScript type errors in SchedulingIntentDetector and automation tests',
        'Resolved all TypeScript build errors in aartiq-browser',
      ],
      change: [
        'Extracted auth handlers from main.js into dedicated auth-handlers.js module',
        'Added ~16 bridge endpoints in main.js for sidebar, bookmarks, history, settings, permissions, automation, app-info',
        'New bridge-client.js — HTTP client with prompt-wait logic (opens sidebar, sends prompt, polls state until AI responds)',
        'MCP manifest and package bumped to v2.0.0',
        'Removed extra macOS entitlements (keychain, iCloud, associated-domains, TCC)',
        'Replaced sidebar rail with inline three-dot tools dropdown',
        'Replaced popup BrowserWindows with IPC-forwarded actions',
        'Rebranded Swift native panels from Comet to Aartiq',
        'Firebase config loaded from /api/config endpoint instead of env vars',
      ],
      docs: [
        'Rewrote README with badges, comparison table, architecture diagram, and 64-tool MCP table',
        'Created Claude Desktop MCP setup guide and available tools documentation',
        'Added MCP permission model and approval UX documentation',
        'Added v0.3.3 release notes and changelog entry',
        'Updated landing page changelog with accurate v0.3.3 details',
      ],
      security: [
        'MCP tool risk classification — Low/Medium/High with corresponding approval UX per tool',
        'Destructive file operations (deletion, disk writes) classified as high risk',
        'Batch shell approval with per-command toggles and irreversible command warnings',
        'Permission approval layer with biometric auth for Claude Desktop MCP tools',
        'Approval preload script for MCP approval popup IPC',
      ]
    }
  },
  {
    version: '0.3.2',
    date: '2026-07-10',
    codename: 'Nebula',
    channel: 'stable',
    changes: {
      new: [
        'Plugin & Extension System — dynamic plugin SDK with manifest-based loading, page analyzer plugin, auto-seed, toggle fix, and handler fixes',
        'Component Scanner with Code Analysis — extracts imports, interfaces, hooks, exports, and API usage for per-component live documentation',
        'Agent Skill Cards — modular skill documentation files for automation, browsing, documents, scheduling, security, research, MCP, apple-intelligence, and image generation',
        'AI User Preference Auto-Learning — AI detects and remembers user preferences (response style, tone, language, behavior) across sessions',
        'SAVE_PREFERENCE command — AI can persist preferences via SAVE_PREFERENCE:key:value in responses',
        'Cross-session RAG persistence — past conversations ingested into vector memory and available as RAG context in future sessions',
        'Biometric per-session tracking — first low-risk shell action triggers Touch ID; subsequent ones auto-approve within the session',
        'Batch shell command approval — consecutive shell commands in one combined modal with per-command toggles (Select All / Deselect All)',
        'Irreversible command warnings — red/amber banners for destructive commands (rm -rf, dd, mkfs, etc.) before approval',
        'macOS Siri Shortcuts bridge — native Swift binary exposes Aartiq AI commands to Siri and Apple Shortcuts',
        'AES-256-GCM vault encryption with native keychain backup (macOS/Windows/Linux)',
        'Neural Vault credential management — cross-platform native keychain integration (macOS iCloud Keychain, Windows Credential Manager, Linux secret-tool)',
        'Native OS credential save dialogs — macOS NSAlert, Windows .NET Forms, Linux zenity',
        'Autofill engine — form detection, classification (28+ field types), and credential/card/address autofill',
      ],
      fix: [
        'Fixed Neural Vault save not persisting on macOS — iCloud Keychain sync now fully functional',
        'Fixed get-passwords-for-site handler (was referencing non-existent keychain.js)',
        'Fixed TypeScript type error in SchedulingIntentDetector (extracted cast to any)',
        'Fixed bare return statements in automation tests (replaced with this.skip())',
        'Fixed model/provider selection not persisting across restarts — llm-set-active-provider and llm-configure-provider handlers now use correct electron-store keys',
        'Fixed get-stored-api-keys returning wrong data shape — frontend can now restore all provider models on startup',
        'Fixed extract-page-content race condition with webContents null check retry',
        'Fixed Shift+Tab bypass — restricted to non-high-risk commands only',
        'Fixed scheduling task CRUD — update, delete, toggle, run methods added to preload',
        'Fixed webContents null/destroyed guards in browser-handlers.js IPC handlers',
        'Fixed build errors — backtick in template literal, electronAPI type scope, ExtensionManager toggle type mismatch',
      ],
      change: [
        'Upgraded Electron to v43.1.0',
        'Renamed CLI binary from "comet" to "aartiq" in package.json bin field',
        'API keys now stored in native OS keychain instead of plaintext electron-store',
        'Added build-siri-bridge step to all macOS build and dist scripts',
        'Added RAG IPC handlers (ragIngest, ragRetrieve, ragContext) to preload.js',
        'Conversations now auto-ingest into BrowserAI vector memory on save for cross-session RAG',
        'Component scanner enhanced with deep code analysis (imports, interfaces, hooks, exports)',
        'Removed stale release-optimized workflow',
      ],
      docs: [
        'Updated README with v0.3.2 features — plugin system, component scanner, skill cards',
        'Updated Landing_Page release notes, search index, and llms.txt for v0.3.2',
        'Fixed comet-browser → aartiq-browser references in getting-started and contributing docs',
      ],
      security: [
        'Session-scoped biometric authentication — Touch ID required once per session for shell commands',
        'Batch shell approval modal with per-command granular control',
        'AES-256-GCM vault for sensitive credential storage with OS keychain backup',
        'API keys migrated from plaintext electron-store to native OS keychain',
        'Mobile high-risk approval relay via sync handlers and cloud messages',
      ]
    }
  },
  {
    version: '0.3.1',
    date: '2026-07-08',
    codename: 'Nebula',
    channel: 'stable',
    changes: {
      new: [
        'AI User Preference Auto-Learning — AI detects and remembers user preferences (response style, tone, language, behavior) across sessions',
        'SAVE_PREFERENCE command — AI can persist preferences via SAVE_PREFERENCE:key:value in responses',
        'Cross-session RAG persistence — past conversations are ingested into vector memory and available as RAG context in future sessions',
        'AI user preference IPC system — persistent JSON-based storage for AI-observed preferences in userData',
        'Biometric per-session tracking — first low-risk shell action triggers Touch ID; subsequent ones auto-approve within the session',
        'Batch shell command approval — consecutive shell commands shown in one combined modal with per-command toggles (Select All / Deselect All)',
        'Irreversible command warnings — prominent red/amber banners for destructive commands (rm -rf, dd, mkfs, etc.) before approval',
        'macOS Siri Shortcuts bridge — native Swift binary exposes Aartiq AI commands to Siri and Apple Shortcuts',
        'Agent skill cards — new modular skill documentation files (automation, browsing, documents, scheduling, security, research, MCP, apple-intelligence, image-generation)',
        'AES-256-GCM vault encryption with native keychain backup (macOS/Windows/Linux)',
      ],
      fix: [
        'Fixed model/provider selection not persisting across restarts — llm-set-active-provider and llm-configure-provider handlers now use correct electron-store keys',
        'Fixed get-stored-api-keys returning wrong data shape (boolean flags instead of actual model/API key values) — frontend can now restore all provider models on startup',
        'Fixed extract-page-content race condition with webContents null check retry',
        'Fixed Shift+Tab bypass — restricted to non-high-risk commands only',
        'Fixed scheduling task CRUD — update, delete, toggle, run methods added to preload',
        'Fixed webContents null/destroyed guards in browser-handlers.js IPC handlers',
      ],
      change: [
        'Upgraded Electron to v43.1.0',
        'Renamed CLI binary from "comet" to "aartiq" in package.json bin field',
        'Added build-siri-bridge step to all macOS build and dist scripts',
        'Bumped version to 0.3.1',
        'Added RAG IPC handlers (ragIngest, ragRetrieve, ragContext) to preload.js for renderer-to-main RAG access',
        'Conversations now auto-ingest into BrowserAI vector memory on save for cross-session RAG',
      ],
      docs: [
        'Updated README with AI user preference, RAG persistence, biometric session, and Siri Shortcuts features',
        'Updated Landing_Page release notes, search index, and llms.txt for v0.3.1',
        'Fixed comet-browser → aartiq-browser references in getting-started and contributing docs',
      ],
      security: [
        'Session-scoped biometric authentication — Touch ID required once per session for shell commands',
        'Batch shell approval modal with per-command granular control',
        'AES-256-GCM vault for sensitive credential storage with OS keychain backup',
        'Mobile high-risk approval relay via sync handlers and cloud messages',
      ]
    }
  },
  {
    version: '0.3.0',
    date: '2026-07-07',
    codename: 'Nebula',
    channel: 'stable',
    changes: {
      new: [
        'Microsoft Store availability — Aartiq is now listed on the Microsoft Store',
        'Windows title bar redesign — standard minimize/maximize/close layout replaces traffic lights on non-Mac',
        'Windows MSIX build pipeline with automated identity injection for Store submission',
        'Self-signed code signing certificate generation for MSIX sideloading',
        'Startup onboarding flow with native window controls',
      ],
      fix: [
        'Security: base64-encoded payloads now decoded and re-scanned for shell commands (was fully bypassable)',
        'Security: all shellPrimitives now consistently treated as critical severity (dd, mkfs, shutdown, etc.)',
        'Security: Credential URL regex fixed to require protocol prefix (eliminates false positives)',
        'Fixed BrowserView not preserving cookies/auth across restarts (persistent partition)',
        'Fixed settings page crash',
        'Fixed navigation detection for redirect-heavy pages; added retry for JS-heavy extraction',
        'Fixed deepseek-r1 model defaults not removable',
        'Fixed WelcomeScreen broken IPC icon load',
        'Fixed 16x16 icon → 256x256 for Windows builder',
        'Fixed MSIX MinVersion to 10.0.17763.0 for Store compliance',
        'Fixed artifact upload directory flattening for CI release',
        'Fixed app:registerAppFileProtocol() not being called',
        'Fixed OCR/robot service initialization and DOM/OCR preference toggle',
      ],
      change: [
        'Bumped version to 0.3.0',
        'Transparent logo used across Windows/Linux builds',
        'Enhanced store/selectors for state management',
        'Refactored web search service',
        'Updated browser/file handlers',
      ],
      docs: [
        'Added Microsoft Store links across all READMEs and landing pages',
        'Added privacy policy with contact info for Store submission',
        'Updated AI-GUIDE.md with current version and release checklist',
        'Updated release notes for v0.3.0',
      ],
      security: [
        'SecureDOMParser now decodes and re-scans base64 payloads against injection patterns',
        'Consistent critical severity for all shell primitive matches',
        'Credential URL pattern requires URI scheme prefix',
      ]
    }
  },
  {
    version: '0.2.99',
    date: '2026-07-06',
    codename: 'Nebula',
    channel: 'alpha',
    changes: {
      change: [
        'Official rebrand from Aartiq-AI to Aartiq across Landing_Page',
        'Updated all product names, URLs, logos, and branding references',
        'Migrated domain references: browser.ponsrischool.in → aartiq.ponsrischool.in',
        'Updated deep link schemes: aartiq-browser:// → aartiq-browser://, aartiq:// → aartiq://',
        'Updated API headers: X-Aartiq-App-Token → X-Aartiq-App-Token',
        'Replaced logo from /icon.png to /logo-transparent.png',
        'Added Google Search Console verification tag for aartiq.ponsrischool.in',
        'Expanded SEO keywords and JSON-LD structured data for maximum search visibility',
        'Updated AI-GUIDE.md with new project structure and branding',
        'Removed deprecated REFACTOR ATTEMPT entry from release notes',
        'Ran component scanner and synced component-data.json',
        'Set up Landing_Page as standalone git repository for Vercel deployment',
      ],
      docs: [
        'Updated AI-GUIDE.md with Aartiq project structure, URLs, and repository references',
        'Cleaned up release-notes.ts changelog (removed stale REFACTOR ATTEMPT entry)',
        'Synced component scanner data with Landing_Page'
      ]
    }
  },
  {
    version: '0.2.98',
    date: '2026-06-27',
    codename: 'Nebula',
    channel: 'alpha',
    changes: {
      security: [
        'Wired capability controller into main.js and command-executor.js — shell execution now gated by registered actions',
        'Added decryptLegacyBlob() for old-format E2EE: blobs (SHA-256 key derivation, no salt, 12-byte IV)',
        'Added migrateToNewFormat() to transparently upgrade legacy blobs to PBKDF2-based E2EE2: format',
        'Added runtime DOMPurify guard: gracefully degrades when window/document unavailable (main process safety)',
        'Removed dead checkCSSAttacks() — CSS safety is handled by DOMPurify or style stripping',
        'Audited Security.ts vs Security.js — Security.js does not exist in this repo; all callers import Security.ts directly',
        'Audited 31 AI-action IPC channels: 22 gated, 9 monitoring-only — documented in docs-audit/action-inventory.md',
      ],
      change: [
        'Replaced regex HTML sanitization with DOMPurify — eliminates two decades of known bypass techniques',
        'Replaced base64 "encryption" fallback with real AES-256-GCM + PBKDF2 (600K iterations) — no silent downgrades',
        'Refactored URL validation to protocol allowlist (http:, https:, mailto:) instead of denylist',
        'Encryption now requires a passphrase (min 8 chars) and throws typed errors on failure — no silent base64 fallback',
        'Decryption uses AES-GCM authenticated encryption — wrong passphrase or tampered data throws DecryptionError',
        'Added encodeLocalOnly() as an explicit, honesty-named escape hatch for non-sensitive local data',
        'Created main-process capability-controller.js (CommonJS) matching Security.ts TypeScript implementation',
        'Security docs stats updated to reflect audit reality: 22 gated + 9 monitoring-only channels',
      ],
      docs: [
        'Created docs-audit/action-inventory.md — comprehensive inventory of all 31 AI-action IPC channels',
        'Updated security docs with PBKDF2 parameters, capability-scoped execution model, and wiring details',
      ],
    }
  },
  {
    version: '0.2.9.4.3',
    date: '2026-04-23',
    codename: 'Nebula',
    channel: 'stable',
    changes: {
      new: [
        'Enhanced CLI with model selection - Reads configured models from browser',
        'Interactive model selection - Choose model by number',
        'Chat sessions with history - Stored in ~/.aartiq/',
        'Live streaming output',
        'Last used model saved automatically',
        'Supports all providers: ollama, openai, anthropic, gemini, xai, groq'
      ],
      fix: [
        'Fixed scripts not found in packaged app - Copy to temp before execution',
        'Added scripts/ to build files'
      ],
      docs: [
        'Added Aartiq CLI documentation'
      ]
    }
  },
  {
    version: '0.2.9.4.2',
    date: '2026-04-23',
    codename: 'Nebula',
    channel: 'stable',
    changes: {
      fix: [
        'Fixed macOS app not launching - removed restricted entitlements',
        'Removed com.apple.security.cs.allow-jit',
        'Removed com.apple.security.cs.allow-unsigned-executable-memory',
        'Removed com.apple.security.cs.disable-library-validation',
        'App now works with ad-hoc code signing (no Apple Developer required)'
      ],
      docs: [
        'Created v0.2.9.4.2 release notes in /release_notes/'
      ]
    }
  },
  {
    version: '0.2.9.4.1',
    date: '2026-04-23',
    codename: 'Nebula',
    channel: 'stable',
    changes: {
      new: [
        'Desktop Control from Mobile - Control desktop AI chat from mobile app',
        'Enhanced QR Scanner - Improved QR code scanning for pairing',
        'AI Streaming - Real-time AI response streaming to mobile',
        'Sync Settings UI - Connection status and settings management'
      ],
      fix: [
        'Improved camera handling on iOS for QR scanning',
        'Fixed TypeScript types for WiFiSyncService',
        'Fixed clipboard sync loop prevention',
        'Added proper echo prevention for desktop control'
      ],
      change: [
        'Updated WiFiSyncService with desktop-control handler',
        'Updated ConnectDesktopPage with improved QR scanner',
        'Updated SyncService with AI streaming support'
      ],
      docs: [
        'Created v0.2.9.4.1 release notes in /release_notes/'
      ]
    }
  },
  {
    version: '0.2.9.4.4',
    date: '2026-04-23',
    codename: 'Nebula',
    channel: 'stable',
    changes: {
      new: [
        'Aartiq CLI - Powerful terminal-based browser control (comet ask, comet search)',
        'Automatic Response Continuation - Fixed AI interruptions with seamless "Keep-Alive" stitching',
        'Finalized Siri & Apple Shortcuts - Zero-setup AppIntents for hands-free automation',
        'Secure CLI Authentication - Token-based authorization via ~/.aartiq-token',
        'Deep Link Sync - Unified routing for CLI, Siri, and deep-link triggers'
      ],
      fix: [
        'Fixed AI mid-task interruption issues by implementing auto-continuation loop',
        'Fixed permission errors in CLI command execution',
        'Resolved deep link routing conflicts in packaged builds'
      ],
      change: [
        'Updated main.js with CLI native bridge endpoints',
        'Enhanced AIChatSidebar with recursive generation support',
        'Synchronized versioning to v0.2.9.4 across all components'
      ],
      docs: [
        'Updated README.md with comprehensive CLI usage guide',
        'Updated Apple Integration docs with Siri phrase reference',
        'Synchronized AI-GUIDE.md with latest stable version standards'
      ]
    }
  },
  {
    version: '0.2.9.3',
    date: '2026-04-20',
    codename: 'Omni',
    channel: 'stable',
    changes: {
      new: [
        'Siri Shortcuts Integration - Native macOS App Intents with 12 pre-configured shortcuts',
        'URL Scheme Handler - aartiq:// protocol for Shortcuts app triggers',
        'AppleScript Bridge - Voice command automation via osascript',
        'Voice Input Handler - macOS Dictation + Text-to-Speech integration',
        'Shortcuts Templates - Pre-built templates for common AI actions',
        'Windows Shortcuts Integration - Windows Shortcuts, Voice Control, Copilot',
        'Windows Voice Recognition - System.Speech for TTS/STT',
        'Windows Copilot Integration - com.microsoft.copilot: protocol',
        'Linux Integration - GNOME/KDE desktop integration',
        'Linux Voice (TTS) - espeak with 80+ voices',
        'Linux Notifications - notify-send, kdialog support',
        'Linux Desktop Shortcuts - .desktop file generation',
        'Native Click Alternatives - Platform-specific automation (macOS steve, Windows nut.js/xa11y)',
        'Native OCR Alternatives - uniOCR, RustO! (PaddleOCR) with 99.3% accuracy',
        'Cross-Platform Automation Fallback Chain - nut.js → xa11y → robotjs',
        'Cross-Platform OCR Fallback Chain - uniOCR → RustO! → Platform Native → Tesseract'
      ],
      fix: [
        'Removed Protected Ecosystem footer from PDF generation',
        'Fixed macOS build with ad-hoc signing (--c mac.signingIdentity=-)',
        'Fixed GitHub Actions build error: empty password for code signing'
      ],
      change: [
        'Main.js: 8,290 lines (current), Preload.js: 682 lines',
        'Robot-service.js: 292 lines, Tesseract-service.js: 1,125 lines',
        'Automation index.js: 147 lines',
        'Linux integration.js: 495 lines, Windows integration.js: 385 lines',
        'SiriShortcutsIntegration.js: 260 lines',
        'All platform integrations now have consistent API structure'
      ],
      docs: [
        'Created Apple Integration docs page (/docs/apple-integration)',
        'Created Windows Integration docs page (/docs/windows-integration)',
        'Created Linux Integration docs page (/docs/linux-integration)',
        'Updated search index with all platform integration entries',
        'Updated components page with correct line counts'
      ],
      security: [
        'Updated security contact'
      ]
    }
  },
  {
    version: '0.2.9.1',
    date: '2026-04-17',
    codename: 'Nebula',
    channel: 'stable',
    changes: {
      new: [
        'Native AI Sidebar V2 - Thuki-inspired SwiftUI floating assistant',
        'Morphing Container - Spotlight-style input bar transforms to full chat',
        'Command Suggestions - /screen, /think, /search, /summarize with real-time filtering',
        'Multi-Provider LLM Integration - Ollama, OpenAI, Anthropic, Gemini',
        'Auto-Start Login Item Integration - Start sidebar at system login',
        'Native Swift Module - N-API bridge for Electron + SwiftUI',
        'Context Quotes - Selected text pre-fills as quoted context',
        'Smart Auto-Scroll - Follows content unless user scrolls up',
        'Typing Indicator - Pulsing dots animation during AI response',
        'Conversation History - Date-grouped organization'
      ],
      fix: [
        'Fixed BrowserView not appearing after app launch - added immediate addBrowserView call',
        'Fixed hasSeenWelcomePage/hasCompletedStartupSetup defaults blocking BrowserView bounds'
      ],
      change: [

        'Modular IPC Handlers: Moved all handlers to src/main/handlers/ modules (14+ modules)',
        'Lazy Service Loading: Services now load on-demand for faster startup',
        'Removed landing page from default startup - app now opens directly to browser',
        'Added Sidebar Version selector to macOS menu (Aartiq > Sidebar Version)',
        'Added Sidebar Version toggle in settings panel'
      ],
      docs: [
        'Created comprehensive release notes',
        'Added full Apache 2.0 attribution for Thuki',
        'Updated README with Native Sidebar V2 documentation and main.js refactor',
        'Updated AI-GUIDE.md with main.js refactor details',
        'Created ACKNOWLEDGMENTS.md with Thuki license compliance'
      ],
      security: [
        'Thuki is Apache 2.0 licensed - attribution added per Section 4d'
      ]
    }
  },
  {
    version: '0.2.9',
    date: '2026-04-13',
    codename: 'Nebula',
    channel: 'stable',
    changes: {
      new: [
        'Context-Aware BrowserView Virtualization - Detaches engine when using internal tools to save 40-60% CPU',
        'Professional PDF Orchestration with automated Table of Contents (TOC) and native structural analysis',
        'SecureDOM Reader & In-Page DOM Search - Sanitized page analysis with XSS filtering',
        'Standardized 56px UI Header Architecture for consistent vertical rhythm'
      ],
      fix: [
        'CRITICAL: Fixed "App not working" crash caused by React hook (useEffect) dependency mismatch in Sidebar',
        'Fixed transparent logo visibility in production/packaged builds using nativeImage',
        'Fixed double-header gap between TitleBar and main workspace'
      ],
      change: [
        'Updated landing page "Get Started" flow to integrate with StartupSetupUI',
        'Gated window resize events to improve responsiveness when BrowserView is detached'
      ],
      docs: [
        'Updated AI-GUIDE.md with SecureDOM and In-Page search documentation',
        'Updated Security docs with new Sandbox + Filtering architectural details',
        'Synchronized versioning to v0.2.9 across all platforms'
      ]
    }
  },
  {
    version: '0.2.8.2',
    date: '2026-04-12',
    codename: 'Nebula',
    channel: 'stable',
    changes: {
      new: [
        'Advanced Document Generation Engine with PDF, Excel (XLSX), PowerPoint (PPTX), and Mermaid diagram support',
        'Mermaid to PDF converter with SVG rendering and multi-page PDF export',
        'Custom typing animation hooks (useTypingAnimation, useStreamingParser) with multiple cursor styles',
        'Raycast extension with 6 commands (chat, browse, ocr, pdf, automation, settings)'
      ],
      fix: [
        'Fixed Google Cloud Sync sign-in - added frontend auth-callback listener',
        'Fixed OCR collapsible display using explicit type casting',
        'Fixed thinking indicator to use theme-specific colors from gradient preset',
        'Fixed mobile shell approval deep link handler for QR codes'
      ],
      change: [
        'Updated TypeScript target to ES2020 for better compatibility',
        'Added AI streaming parser hook for smooth message parsing during streaming'
      ],
      docs: [
        'Updated AI-GUIDE.md with complete documentation workflow',
        'Updated all search indexes with new commands and features',
        'Updated version to 0.2.8.2'
      ]
    }
  },
  {
    version: '0.2.8',
    date: '2026-04-08',
    codename: 'Nebula',
    channel: 'alpha',
    changes: {
      new: [
        'Created comprehensive Automation Layer documentation (docs/AUTOMATION.md)',
        'Created Plugin System API documentation (docs/PLUGIN_API.md)',
        'Added Jest test suite with 79 passing tests',
        'Extracted shared types to AIChatSidebar/types.ts for modularization',
        'Created AIChatSidebar/helpers.ts with utility functions'
      ],
      fix: [],
      change: [
        'Updated GitHub Actions to use Node.js 20 LTS for stability',
        'Changed CI/CD to use npm ci for deterministic installs',
        'Added test job dependency before build in CI pipeline',
        'Updated package.json with npm test, npm run test:watch, npm run test:coverage scripts',
        'Updated GitHub Actions action versions to v4',
        'Added proper Linux dependencies (libx11-xcb-dev, libxcb-dri3-dev, etc.)'
      ],
      docs: [
        'Updated ARCHITECTURE.md with references to AUTOMATION.md and PLUGIN_API.md',
        'Updated AI-GUIDE.md last updated date'
      ]
    }
  },
  {
    version: '0.2.7.1',
    date: '2026-04-06',
    codename: 'Stardust',
    channel: 'alpha',
    changes: {
      new: [],
      fix: [
        'Fixed Next.js 16 Turbopack/webpack config conflict - added turbopack: {} to next.config.js',
        'Fixed "Can\'t resolve fs" build errors in user-preferences module',
        'Fixed package.json duplicate optionalDependencies JSON parse error',
        'Fixed TypeScript compilation errors for npm run dev',
        'Added complete plugins API type definitions to electron.d.ts',
        'Fixed PluginSettings.tsx type mapping and callback annotations',
        'Fixed AIChatSidebar.tsx result property access (output → result)',
        'Fixed AIUtils.ts data.title undefined reference',
        'Replaced ES2018 gs regex flags with compatible [\\s\\S]*? pattern'
      ],
      change: [
        'Updated tsconfig.json target from ES2017 to ES2020'
      ],
      docs: [
        'Updated AI-GUIDE.md with TypeScript compilation guide'
      ]
    }
  },
  {
    version: '0.2.7',
    date: '2026-04-05',
    codename: 'Stardust',
    channel: 'alpha',
    changes: {
      new: [
        'Added Components documentation page with overview of all UI components and services',
        'Enhanced SEO with JSON-LD structured data for better AI crawler indexing',
        'Created robots.txt allowing all AI crawlers (GPTBot, ClaudeBot, Gemini, Perplexity)',
        'Added PWA manifest.json for app install capability',
        'Added AI-GUIDE.md for AI code writers'
      ],
      fix: [
        'Fixed document-generation broken link (now points to /docs/ai-commands#pdf)',
        'Fixed Components tab in docs sidebar navigation',
        'Removed macOS-only @next/swc-darwin-arm64 causing Vercel build failure'
      ],
      change: [
        'Updated sitemap.xml with all doc pages for better indexing',
        'Enhanced metadata with OpenGraph, Twitter cards, and canonical URLs',
        'Updated docs layout to use dynamic version from version.ts'
      ],
      docs: [
        'Created comprehensive Components reference page',
        'Updated docs sidebar with Components tab',
        'Added SEO optimization guide in AI-GUIDE.md'
      ]
    }
  },
  {
    version: '0.2.6',
    date: '2026-04-01',
    codename: 'Stardust',
    channel: 'alpha',
    changes: {
      new: [
        'Added Swift UI improvements with THINK UI',
        'Added Liquid Glass Theme for macOS native UI',
        'Added MermaidView for Swift (MermaidJS via WKWebView)',
        'Added macOS menu with direct settings access'
      ],
      fix: [
        'Fixed OCR click JSON parsing with regex fallback',
        'Added robotJS for external app clicking',
        'Fixed AI message rendering on Swift (br, bold, math)',
        'Removed Swift title bar (.windowStyle(.hiddenTitleBar))'
      ],
      docs: [
        'Added cross-app OCR/click documentation in AI guide',
        'Updated AIConstants.ts with cross-app documentation'
      ]
    }
  },
  {
    version: '0.2.5',
    date: '2026-03-29',
    codename: 'Stardust',
    channel: 'stable',
    changes: {
      new: [
        'Initial stable release',
        'Core AI agent with chain-of-thought reasoning',
        'Three-layer security model',
        'WiFi Sync between desktop and mobile',
        'PDF generation with 5 templates'
      ]
    }
  }
];

export function getLatestRelease(): ReleaseEntry {
  return releases[0];
}

export function getReleaseByVersion(version: string): ReleaseEntry | undefined {
  return releases.find(r => r.version === version);
}
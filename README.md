# Aartiq™ — For The Questions That Matter

> "The most important question isn't what you ask AI. It's what AI asks you before it acts."

Aartiq™ is an open-source AI browser that plans tasks, explains non-trivial actions, requests permission when required, and executes through controlled capabilities.

**Plan → Explain → Ask → Execute**

<!-- SSOT:START version -->
**v0.3.8** — released 2026-10-04.

Latest release: [v0.3.8](https://github.com/Latestinssan/Aartiq/releases/tag/v0.3.8) · [full release notes](release_notes/v0.3.8.md)
<!-- SSOT:END version -->

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-cyan.svg)](LICENSE)
[![Version](https://img.shields.io/github/v/release/Latestinssan/Aartiq?label=Version&color=blue)](https://github.com/Latestinssan/Aartiq/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Latestinssan/Aartiq/total?color=success&label=Downloads)](https://github.com/Latestinssan/Aartiq/releases)
[![Windows](https://img.shields.io/badge/Windows-Supported-blue?logo=windows)](https://github.com/Latestinssan/Aartiq/releases/latest)
[![macOS](https://img.shields.io/badge/macOS-Supported-blue?logo=apple)](https://github.com/Latestinssan/Aartiq/releases/latest)
[![Linux](https://img.shields.io/badge/Linux-Supported-blue?logo=linux)](https://github.com/Latestinssan/Aartiq/releases/latest)
[![Android](https://img.shields.io/badge/Android-Supported-blue?logo=android)](https://github.com/Latestinssan/Aartiq/releases/latest)
[![Microsoft Store](https://img.shields.io/badge/Microsoft%20Store-Listed-blue?logo=microsoft)](https://apps.microsoft.com/detail/9nd6wg2rp7cm?hl=en-GB&gl=IN)

<p align="center">
  <img width="1912" height="1168" alt="Aartiq Browser" src="https://github.com/user-attachments/assets/fe9131d4-cfcf-4d3b-aea5-9cc451b4fbd1" />
</p>

---

## Why Aartiq?

Traditional browsers help you navigate the web. AI assistants help you understand information. **Aartiq is built for the space between the two: helping AI carry out tasks while keeping the user in control.**

Instead of manually opening tabs, searching websites, filling forms, creating documents, moving files, and repeating workflows, you describe the goal — Aartiq turns it into structured actions, evaluates them against its permission model, requests approval when required, and executes through registered capabilities.

Three commitments shape every part of it:

- **Permission-first.** The model never gets raw access to system primitives — only registered capabilities, each one classified, scoped and approval-gated before it can run.
- **Fail-closed.** If a control cannot be established or verified, the action does not run. There is no fallback path that runs it anyway — and when a test cannot run, it is counted as skipped, never as passing.
- **Local-first, evidence over claims.** User data stays on the device, sync is end-to-end encrypted, and credentials live in the OS keychain. Published numbers — test counts, ports, tiers — are generated from source rather than typed, and every claim ships with its known limits.

> **AI can act. You decide what it is allowed to do.**

---

## See Aartiq in Action

**Prompt:**

> *"Search for today's news, create a PDF summary, move it to my Desktop, and open it."*

<p align="center">
  <img width="744" height="480" alt="Aartiq task execution demo" src="https://github.com/user-attachments/assets/051f5188-6e20-4b58-8087-74b9dd61b2e2" />
</p>

| Plan | Permission | Results |
|:----:|:----------:|:-------:|
| <img width="516" height="573" alt="image" src="https://github.com/user-attachments/assets/f1c17873-077e-4b00-8ca7-87cc7cb4eebe" /> | <img width="516" height="573" alt="image" src="https://github.com/user-attachments/assets/a42e7c35-1f10-445a-b0a4-7660361a4f12" /> | <img width="516" height="573" alt="image" src="https://github.com/user-attachments/assets/aca29055-ce34-400c-9329-1bba7127d1b4" /> |

Aartiq searches the web, gathers information, creates the document, requests approval for actions that require it, moves the resulting file, and opens it — the flow is always **Understand → Plan → Explain → Ask → Execute → Result**.

---

## Permission-First AI

Every tool call — navigation, tab control, form filling, extension management, snapshots, theming, or OS actions — is routed through the `SecurityPipeline` before it runs. The pipeline performs risk classification, capability matching, and approval-gating.

Actions that require approval are presented before execution with information about what will happen and what resource or capability is involved.

### Risk-Based Permissions

Risk tiers are assigned to the capability being invoked, not inferred from the wording of the prompt. They are advisory labels — the control that actually confines execution is OS sandboxing. What each tier does *not* guarantee is stated on the [Security Model page](https://aartiq.ponsrischool.in/docs/security), which carries the full table.

<!-- SSOT:START risk-table -->
| Tier | Approval behaviour | Auto-approved? | Examples |
| --- | --- | --- | --- |
| **low** | Asked every time, unless you turn on autoApproveLowRiskShell. With it off — the default — a low-risk command shows the same dialog as any other. | Only behind the opt-in autoApproveLowRiskShell setting, which defaults to off. Nothing is granted at startup. | `ls`, `cat`, `pwd`, `find`, `grep`, `echo`, `NAVIGATE` |
| **medium** | Asked every time. autoApproveMidRisk does not reach shell commands — it still applies to MCP tool actions, which is a separate question. | No. There is no setting that auto-approves a medium shell command. | `cp`, `mv`, `mkdir`, `touch`, `npm`, `git`, `node`, `python`, `curl`, `wget`, `osascript` |
| **high** | Asked every time, then offered as Allow Once / Always / Deny. | Only if a grant exists for that exact command line, or a SHELL_HIGH / SHELL_ALL grant was made deliberately. | `chmod`, `find . -delete`, `kill`, `dd`, `mount`, `iptables`, `shutdown` |
| **critical** | Denied at the policy gate unconditionally, then offered to the user as an interactive Allow / Deny prompt. | Never. Refused before the grant store and the auto-approve settings are consulted, and unreachable from every one of them. | _none assigned by any registry_ |
<!-- SSOT:END risk-table -->

For the complete command catalog, risk assignments, and implementation details:

**[AI Command Reference](https://aartiq.ponsrischool.in/docs/ai-commands)**

---

## How It Works

1. **You describe the goal**, not the clicks.
2. **The orchestrator plans** it as structured commands, using the AI provider you chose.
3. **Every command is classified** — risk tier, capability match, scope — before anything runs.
4. **Approval is requested** when the policy says so, with a description of what will happen.
5. **Execution is controlled** — browser, files, OS and OCR run through registered capabilities, sandboxed per platform.

---

## Security

Aartiq uses a defense-in-depth security model with risk-based permissions, capability controls, directory allowlists, platform-specific sandboxing, encrypted vault storage, and explicit approval workflows.

The security model, including which layers actually enforce and which only advise:

<!-- SSOT:START layers -->
The model has 6 layers. Only 2 of them are enforcement boundaries in the strict sense — controls the OS applies that application code cannot bypass. The rest are policy and first-pass checks, and are labelled as such rather than presented as equally strong.

| # | Layer | Strength |
| --- | --- | --- |
| 1 | Visual Sandbox & SecureDOM | heuristic/first-pass |
| 2 | Syntactic Firewall | heuristic/first-pass |
| 3 | Human-in-the-Loop Approval | policy layer |
| 4 | Directory Allowlist | policy layer |
| 5 | OS-Level Sandboxing | enforcement boundary |
| 6 | Capability-Scoped Execution | enforcement boundary |
<!-- SSOT:END layers -->

The full model — risk levels, layer-by-layer detail, encryption & vault migration, remote-device security, and the Windows AppContainer sandbox with its audit report — is documented on the [Security Model page](https://aartiq.ponsrischool.in/docs/security).

### Continuous integration

<!-- SSOT:START ci -->
**.github/workflows/jest.yml** — on-demand.

Manual dispatch only. There is no push or pull_request trigger, so a green run is not evidence about the latest commit.

Latest green run: [#37772437527](https://github.com/Latestinssan/Aartiq/actions/runs/37772437527) (run #83, `workflow_dispatch`, 2026-10-08, `a31a5bf5`, success).

**5 jobs.** All five jobs were green on the run above — four Jest jobs (full suite, macOS Seatbelt, Linux bubblewrap, Windows AppContainer) plus a typecheck job (tsc --noEmit) that reports no test counts; per-job results live on the testing page. Dispatch inputs can reduce the Jest jobs to 3 (skip-full-suite) or 1 (windows-test-pattern), so this is a default-dispatch count rather than an invariant. Node 24. 30 minutes on the full-suite job, 10 minutes on the typecheck job; the three sandbox jobs have no timeout configured.

Test counts are generated, not typed. On macOS (local) the full suite reports **1426 passed / 12 skipped / 0 failed of 1438 declared** (generated 2026-10-08).

> The per-job figures on the testing page belong to their run and commit, not to the current tree, which may have grown since — for a current figure use the generated macOS line above. The same commit yields a different pass/skip split per platform, which is why every published count carries its environment.

> Per-job results and the skip breakdown for this run live on the [testing page](https://aartiq.ponsrischool.in/docs/testing#ci-run).
<!-- SSOT:END ci -->

The suite covers approval gating, params-hash verification, fail-closed sandboxing, directory allowlists, capability scoping, and agent token-binding.

### Network listeners

Every socket the application opens, and what actually protects it:

<!-- SSOT:START network -->
| Service | Port | Default bind address | Authentication |
| --- | --- | --- | --- |
| MCP browser bridge | 3001 | `127.0.0.1` | A token required on every route including SSE, read-or-created in ~/.aartiq-mcp-token (mode 0600) so a configured client survives restarts. Host must be the loopback host and this listener's own port; any browser Origin must be on an allow-list of the app's own origins. |
| WiFi sync (desktop ↔ mobile) | 3004 | `all interfaces (0.0.0.0 / ::)` | Short-lived 15-minute access tokens and 7-day refresh tokens bound to device ID. Every sync action — unpair included — requires an active, unexpired token, with brute-force lockout. The WebSocket upgrade itself refuses foreign Origins and Host headers that do not name this machine (DNS rebinding). |
| Native macOS / CLI bridge | 46203 | `127.0.0.1` | A token required on every route, read from ~/.aartiq-token (mode 0600), plus the same Host and Origin checks. |
| Agent API tool server | 46204 | `127.0.0.1` | A token required on every HTTP route, read-or-created in ~/.aartiq-agent-token (mode 0600) so an agent configured once keeps working across restarts, plus the same Host and Origin checks. An unknown x-agent-id is still auto-registered, but as a limited-trust agent — it no longer stands in for authentication. |
| Background task service (separate Electron app) | 3999 | `127.0.0.1` | Authentication token required on all file endpoints (Bearer, X-Aartiq-Token, or ?token=) compared in constant time against the service token (options.authToken, AARTIQ_PDF_SYNC_TOKEN, or a generated per-process token), plus Host header validation against DNS rebinding. |
<!-- SSOT:END network -->

One of these binds all interfaces by default with no switch to restrict it. If you run Aartiq on a shared or untrusted network, that is the part to think about first.

### Known limits

The full list — product-wide, not just the test suite — lives on the [testing page](https://aartiq.ponsrischool.in/docs/testing#known-limits), kept in the same source of truth that renders the blocks above so there is exactly one copy of it. It stays unsummarised there: what advises instead of enforcing, what text matching cannot know, and what is exposed by design.

---

## Capabilities

- **Agent API & tool server** — one security-enforced tool registry over two transports: **MCP** (Claude Desktop and other MCP clients) and **HTTP** (local scripts, the in-product assistant, remote access over Tailscale / LAN). Both pass every call through the security pipeline.
- **Multiple agents, one browser** — each connection gets a trust level that scopes its verbs and origins; a per-tab lock manager stops two agents colliding on form filling.
- **Accessibility snapshots with stable `@ref` ids** — an AX tree whose interactive nodes carry identity-bound ids that survive navigation and DOM changes, instead of raw DOM dumps.
- **Form filling** — credentials and profiles live in an encrypted vault (AES-GCM, passphrase-derived key); a field matcher autocompletes page inputs from it.
- **Chrome extensions** — loaded from an unpacked directory or installed from the Web Store, checked as CRX3 before extraction: `installFromWebStore` calls the verifier and rejects an invalid signature (fail-closed), requires the download URL to declare the extension id it serves (`…x=id%3D<32-char id>…`), and refuses the install unless the verified package's crx_id equals that declared id — a URL promising one extension can only ever install that exact extension — `src/lib/extensions/ChromeExtensionManager.js:257-300` and `src/lib/extensions/crx-id-binding.js`. The verifier's suite runs in CI and checks Chromium's CRX3 format — a bounds-checked header parse, the crx_id ↔ signing-key binding, and the signature over the signed header plus the zip archive — `src/tests/extensions.crx-verifier.test.ts:25`. What it does not implement is Chrome's publisher-key allowlisting: a package signed with some other key can only come through as that key's own extension, never as an existing one's.
- **UI themes and modes** — normal, focus, reader, zen and presentation modes that change what is shown and how the assistant presents itself, independent of authentication state.

---

## Example Prompts

Try Aartiq with tasks such as:

| Prompt                                                    | Example workflow                              |
| --------------------------------------------------------- | --------------------------------------------- |
| `Search for React tutorials and open the top 3`           | Searches the web and opens relevant results   |
| `Summarize this page and save it as a PDF`                | Reads the page and generates a structured PDF |
| `Create a PowerPoint about climate change`                | Generates a structured presentation           |
| `Schedule a daily backup at 9 AM`                         | Creates a recurring background task           |
| `Fill this form with my details`                          | Identifies and fills supported form fields    |

For every available command and its risk classification:

**[AI Command Reference →](https://aartiq.ponsrischool.in/docs/ai-commands)**

---

## AI Providers

Google Gemini · OpenAI GPT · Anthropic Claude · Groq · xAI · Azure OpenAI · Ollama (local) · LM Studio (local) · Apple Intelligence on macOS. Provider availability depends on the platform and configuration; local models (Ollama, LM Studio) keep request content on the device, and an OpenClaw-compatible local-agent bridge is also supported for remote inference.

---

## Performance

Aartiq opens the Chromium window immediately and loads background services asynchronously, so the interface is usable before every subsystem has finished starting. Long-running automation runs as a background task, not a blocking modal.

### Startup benchmark

<!-- SSOT:START benchmarks -->
Measured on a **MacBook Pro M4 Pro**, 12-core CPU, 24 GB RAM, macOS 26.5.

**2026-07-20 — benchmarked on v0.3.4.** Current release: v0.3.8.

| Metric | Result |
| --- | --- |
| First visible window | **0.32s** |
| Warm start | **0.31s** |
| Idle CPU after initialization | **<1%** |

> Startup means time to first visible window, not complete service initialisation. Results vary by hardware, operating system, and configuration.

> These figures predate the current release (v0.3.8) and were taken on v0.3.4. TODO(verify) — no script, raw output file, or instrumentation exists in either repository for these startup figures, so they cannot currently be reproduced or checked. A separate harness for the security-critical hot paths does ship in the repository (`npm run bench`, see BENCHMARKS.md): it measures the permission classifier, Always eligibility, grant gate, auth gate, path allowlist and key derivation — not application startup. A published page also claimed the startup benchmark scripts were included in the repository; that claim was false and has been removed.
<!-- SSOT:END benchmarks -->

### Security hot paths

The permission-critical hot paths have their own reproducible harness: `npm run bench` drives fixed corpora — classifier, Allow Always eligibility, grant gate, path allowlist, auth gate, PBKDF2 key derivation — through warmup and five repetitions, reporting median and spread. Protocol, numbers and comparison rules: **[BENCHMARKS.md](aartiq-browser/BENCHMARKS.md)**. CI gates only that the harness runs; it deliberately sets no absolute timing thresholds.

Detailed measurements and methodology:

**[Performance Benchmarks →](https://aartiq.ponsrischool.in/docs/overview#performance-benchmarks)**

---

## Installation

### Pre-built Binaries

| Platform              | Format           |
| --------------------- | ---------------- |
| Windows               | `.exe` / `.msix` |
| Windows               | Microsoft Store  |
| macOS — Apple Silicon | `.dmg`           |
| macOS — Intel         | `.dmg`           |
| Linux                 | `.AppImage`      |
| Android               | `.apk`           |

Download the latest release from:

**[Aartiq Releases →](https://github.com/Latestinssan/Aartiq/releases)**

### macOS

If macOS blocks the application:

```bash
xattr -cr /Applications/Aartiq.app
```

### Build From Source

```bash
git clone https://github.com/Latestinssan/Aartiq.git
cd Aartiq/aartiq-browser

npm install

# Next.js development server
npm run dev

# Electron shell
npm run electron-start
```

### Android

```bash
cd flutter_browser_app

flutter pub get
flutter run
```

---

## Documentation

The GitHub README provides the product overview. Detailed architecture and implementation documentation lives on the Aartiq documentation site.

**[Overview](https://aartiq.ponsrischool.in/docs/overview) · [Security](https://aartiq.ponsrischool.in/docs/security) · [Command Reference](https://aartiq.ponsrischool.in/docs/ai-commands) · [Testing & CI](https://aartiq.ponsrischool.in/docs/testing) · [Components](https://aartiq.ponsrischool.in/docs/components) · [API Reference](https://aartiq.ponsrischool.in/docs/api-reference) · [Automation](https://aartiq.ponsrischool.in/docs/automation) · [Cloud Sync](https://aartiq.ponsrischool.in/docs/cloud-sync) · [Troubleshooting](https://aartiq.ponsrischool.in/docs/troubleshooting) · [Changelog](https://aartiq.ponsrischool.in/docs/changelog)**

Release notes for each version live in [release_notes/](release_notes).

---

## Contributors

Built by [Latestinssan](https://github.com/Latestinssan) with contributions from the community.

<!-- SSOT:START repo -->
| Stars | Forks | Contributors | Visibility |
| --- | --- | --- | --- |
| 6 | 2 | 3 | public |

_Fetched from the GitHub API. Refresh with `npm run docs:repo-facts`._
<!-- SSOT:END repo -->

<a href="https://github.com/Latestinssan/Aartiq/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Latestinssan/Aartiq" />
</a>

---

> [!IMPORTANT]
>
> ## 🚧 Project Status — AI-Assisted Development
>
> Aartiq is a solo project in active AI-assisted development: AI agents handle day-to-day issue triage, analysis, and fix preparation, and a human reviews and approves every change to security, permissions, user data, or releases before it ships. The repository stays public, existing releases stay available, and bug reports go to GitHub issues, triaged in the order things break. In short:
>
> - Every change to security, permissions, user data, releases, or project direction is reviewed and approved by a human before it ships.
> - CI must be green before any release goes out (see the Security section above for the current test numbers).
> - The maintainer remains responsible for the project's direction and correctness.
>
> **Why this setup:** it lets a solo project keep shipping fixes and improvements without requiring full-time human bandwidth on every routine task, while keeping a human in the loop for anything consequential — which is the same philosophy Aartiq applies to its own permission model.
>
> Issues, PRs, and questions are welcome — response time may vary, but nothing ships without review.
>
> — Latestinssan

### Terminology

Capability, approval ticket, risk tier, fail-closed — the vocabulary this README uses is defined in the [glossary on the documentation site](https://aartiq.ponsrischool.in/docs/overview).

---

## License

<!-- SSOT:START license -->
| Component | Licence | Licence file | Status |
| --- | --- | --- | --- |
| Aartiq Browser — desktop, mobile, and core code | Apache-2.0 | `LICENSE + aartiq-browser/LICENSE.txt` | verified |
| Aartiq MCP Server — aartiq-mcp/ | MIT | `aartiq-mcp/LICENSE` | verified |
| Landing page / documentation site | Unlicensed (private repository) | `none` | verified |

The MCP server is MIT-licensed for compatibility with Claude Desktop and other MCP clients.

### Trademark

Aartiq™ is a trademark of Latestinssan. The open-source licence permits use, modification, and redistribution of the source code. It does not grant permission to use the Aartiq name, logo, trademarks, or visual identity. Modified distributions must be rebranded under a different name and must not present themselves as official Aartiq releases.
<!-- SSOT:END license -->

---

<p align="center">

### For The Questions That Matter.

**The most important question isn't what you ask AI.
It's what AI asks you before it acts.**

**Plan → Explain → Ask → Execute**

**Aartiq™**

© 2026 Aartiq™. All rights reserved.

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

Risk tiers are assigned to the capability being invoked, not inferred from the wording of the prompt. They are advisory labels — the control that actually confines execution is OS sandboxing. Read the last column before relying on any row.

<!-- SSOT:START risk-table -->
| Tier | Approval behaviour | Auto-approved? | Examples | What it does not guarantee |
| --- | --- | --- | --- | --- |
| **low** | Asked every time, unless you turn on autoApproveLowRiskShell. With it off — the default — a low-risk command shows the same dialog as any other. | Only behind the opt-in autoApproveLowRiskShell setting, which defaults to off. Nothing is granted at startup. | `ls`, `cat`, `pwd`, `find`, `grep`, `echo`, `NAVIGATE` | The setting covers the whole low tier rather than named commands, so turning it on is a decision about a category. It is also independent of the MCP tool path: shell commands read autoApproveLowRiskShell from the permission store, MCP tool calls read a separate security_autoApproveLowRisk key, both default to off, and enabling one does not enable the other. |
| **medium** | Asked every time. autoApproveMidRisk does not reach shell commands — it still applies to MCP tool actions, which is a separate question. | No. There is no setting that auto-approves a medium shell command. | `cp`, `mv`, `mkdir`, `touch`, `npm`, `git`, `node`, `python`, `curl`, `wget`, `osascript` | An unrecognised command lands here rather than in low, so this tier also means "we have never heard of it". "Allow Always" is withheld for network-capable and script-capable binaries, but a local write like cp or mkdir can still take an exact-match Always grant — valid for 30 days. |
| **high** | Asked every time, then offered as Allow Once / Always / Deny. | Only if a grant exists for that exact command line, or a SHELL_HIGH / SHELL_ALL grant was made deliberately. | `chmod`, `find . -delete`, `kill`, `dd`, `mount`, `iptables`, `shutdown` | An Allow Always grant is never offered for a destructive command, so the Always button is absent here and Allow Once is the strongest answer available. `chmod` sits in this tier because it matches a destructive pattern, not because it is privileged in the usual sense — it was already high and moving it down would have weakened a default. |
| **critical** | Denied at the policy gate unconditionally, then offered to the user as an interactive Allow / Deny prompt. | Never. Refused before the grant store and the auto-approve settings are consulted, and unreachable from every one of them. | _none assigned by any registry_ | No command in the tier table is assigned this tier. It is only synthesised at runtime for commands arriving from a remote device. Remote-origin shell execution strictly requires single-use, input-hash-bound QR+PIN ticket redemption. |
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

| # | Layer | Strength | Source |
| --- | --- | --- | --- |
| 1 | Visual Sandbox & SecureDOM | heuristic/first-pass | `src/lib/Security.ts` |
| 2 | Syntactic Firewall | heuristic/first-pass | `src/lib/SecurityValidator.js` |
| 3 | Human-in-the-Loop Approval | policy layer | `src/core/capability-controller.js, src/core/shell-permission-bridge.js` |
| 4 | Directory Allowlist | policy layer | `src/core/directory-allowlist.js` |
| 5 | OS-Level Sandboxing | enforcement boundary | `src/core/sandbox-executor.js` |
| 6 | Capability-Scoped Execution | enforcement boundary | `src/core/capability-controller.js, src/core/approval-ticket-manager.js` |
<!-- SSOT:END layers -->

The full model — risk levels, layer-by-layer detail, encryption & vault migration, and remote-device security — is documented on the [Security Model page](https://aartiq.ponsrischool.in/docs/security).

### Continuous integration

<!-- SSOT:START ci -->
**.github/workflows/jest.yml** — on-demand.

Manual dispatch only. There is no push or pull_request trigger, so a green run is not evidence about the latest commit.

Latest green run: [#37621797787](https://github.com/Latestinssan/Aartiq/actions/runs/37621797787) (run #75, `workflow_dispatch`, 2026-10-07, `029cc82c`, success).

| Job | Runner | Passed | Skipped | Failed | Declared |
| --- | --- | --- | --- | --- | --- |
| Run Jest (aartiq-browser) | `ubuntu-latest` | 1395 | 40 | 0 | 1435 |
| Run Jest (Windows AppContainer sandbox runtime) | `windows-latest` | 61 | 30 | 0 | 91 |
| Run Jest (macOS Seatbelt sandbox runtime) | `macos-latest` | 105 | 0 | 0 | 105 |
| Run Jest (Linux bubblewrap sandbox runtime) | `ubuntu-latest` | 57 | 21 | 0 | 78 |

**5 jobs.** All five jobs were green on the run above — the four Jest jobs tabled here plus a typecheck job (tsc --noEmit) that reports no test counts. Dispatch inputs can reduce the Jest jobs to 3 (skip-full-suite) or 1 (windows-test-pattern), so this is a default-dispatch count rather than an invariant. Node 24. 30 minutes on the full-suite job, 10 minutes on the typecheck job; the three sandbox jobs have no timeout configured.

Test counts are generated, not typed. On macOS (local) the full suite reports **1409 passed / 26 skipped / 0 failed of 1435 declared** (generated 2026-10-07).

> The per-job figures above belong to that run and commit, not to the current tree, which has grown since — for a current figure use the generated macOS line above. The same commit yields a different pass/skip split per platform, which is why every published count carries its environment.

### Skip breakdown — macOS (local), 2026-10-07

| Reason | Skipped | Evidence |
| --- | --- | --- |
| Platform-skipped | 12 | linux-bwrap-sandbox requires linux; generated on darwin; windows-job-sandbox requires win32; generated on darwin |
| Missing native OS-automation tooling | 11 | automation — tests registered via itWhenAvailable, skipped when the backend is absent (looks for xdotool, xte). Reason in file: "jest-circus has no `this.skip()` (Jasmine-only). Register the OS // automation tests as skipped unless the native backend exists on this // runner (xdotool / xt" |
| CRX3 signature-verifier bug | 3 | src/tests/extensions.crx-verifier.test.ts — describe.skip |
<!-- SSOT:END ci -->

The suite covers approval gating, params-hash verification, fail-closed sandboxing, directory allowlists, capability scoping, and agent token-binding.

### Windows sandboxing

AppContainer + Job Object sandboxing on Windows shipped in the previous release, v0.3.7: AppContainer adds OS-layer isolation — filesystem via package-SID ACL grants and network via zero capabilities — by starting the target with `CreateProcessW` in a suspended state inside the AppContainer and applying the Job Object at creation, so nothing runs even momentarily unsandboxed. Before that release the Job Object confined processes only.

* **CI-verified on real Windows** (`windows-latest`): the runtime matrix passes — suspended AppContainer start, OS-enforced ACL allowlist, verified job assignment, grandchild containment, secret isolation, and `KILL_ON_JOB_CLOSE` all return verified sandbox results.
* **Audited:** design + source review in [`Audit Report/2026-09-13_Windows_AppContainer_Sandbox_Audit/SECURITY_AUDIT.md`](Audit%20Report/2026-09-13_Windows_AppContainer_Sandbox_Audit/SECURITY_AUDIT.md).
* **Fail-closed:** any policy or setup failure returns a structured `SANDBOX_*` error; there is no fallback path that runs the command unsandboxed.

### Network listeners

Every socket the application opens, and what actually protects it:

<!-- SSOT:START network -->
| Service | Port | Default bind address | Reachable from LAN when | Authentication |
| --- | --- | --- | --- | --- |
| MCP browser bridge | 3001 | `127.0.0.1` | the security_mcpBridgeRemote setting is exactly true (defaults to false; no UI control sets it) | A token required on every route including SSE, read-or-created in ~/.aartiq-mcp-token (mode 0600) so a configured client survives restarts. Host must be the loopback host and this listener's own port; any browser Origin must be on an allow-list of the app's own origins. |
| WiFi sync (desktop ↔ mobile) | 3004 | `all interfaces (0.0.0.0 / ::)` | the phone reaches this over the LAN, so all interfaces is the default; `AARTIQ_WIFI_SYNC_HOST` narrows the bind to an address you name (127.0.0.1 closes it to this machine) | Short-lived 15-minute access tokens and 7-day refresh tokens bound to device ID. Every sync action — unpair included — requires an active, unexpired token, with brute-force lockout. The WebSocket upgrade itself refuses foreign Origins and Host headers that do not name this machine (DNS rebinding). |
| Native macOS / CLI bridge | 46203 | `127.0.0.1` | never — the host is a literal in the source, not a switch anyone can flip | A token required on every route, read from ~/.aartiq-token (mode 0600), plus the same Host and Origin checks. |
| Agent API tool server | 46204 | `127.0.0.1` | config.remote === true (defaults to false; no UI, env var, or IPC path sets it) | A token required on every HTTP route, read-or-created in ~/.aartiq-agent-token (mode 0600) so an agent configured once keeps working across restarts, plus the same Host and Origin checks. An unknown x-agent-id is still auto-registered, but as a limited-trust agent — it no longer stands in for authentication. |
| Background task service (separate Electron app) | 3999 | `127.0.0.1` | AARTIQ_SERVICE_HOST is set to a routable address (defaults to 127.0.0.1; no switch in the app) | Authentication token required on all file endpoints (Bearer, X-Aartiq-Token, or ?token=) compared in constant time against the service token (options.authToken, AARTIQ_PDF_SYNC_TOKEN, or a generated per-process token), plus Host header validation against DNS rebinding. |
<!-- SSOT:END network -->

One of these binds all interfaces by default with no switch to restrict it. If you run Aartiq on a shared or untrusted network, that is the part to think about first.

### Known limits

<!-- SSOT:START known-limits -->
- Runtime sandbox tests execute only on their own OS. There is no single job that exercises Seatbelt, bubblewrap, and AppContainer at once.
- OS-automation tests skip wherever the native tooling is absent (xdotool/xte on Linux, cliclick on macOS).
- The CRX3 signature-verifier suite is skipped because verifyCrx() hangs on a Node 24 / OpenSSL header parse. It is counted as skipped, never as passing, until the verifier is fixed.
- SecurityValidator.js does not guarantee that non-blocked commands are safe — it is a fast first-pass reject layer.
- Visual extraction reduces the DOM-based prompt-injection surface. It does not prevent prompt injection, and it cannot give semantic immunity against instructions rendered into the viewport.
- Seatbelt profiles start from (allow default), so not every IPC class is denied by default; Mach IPC stays usable because node/python/shell require it.
- Apple Events cannot be filtered by the current sandbox-exec — the operation is not exposed — so a sandboxed command could still ask another app to act on its behalf.
- The WiFi sync server (3004) binds every network interface on purpose — the phone reaches it over the LAN — so the LAN exposure itself is the limit: the upgrade now refuses foreign Origins and Host headers that do not name this machine, every sync action (unpair included) requires the device's short-lived access token, and AARTIQ_WIFI_SYNC_HOST narrows the bind when that exposure is not wanted. The background task service (3999) and the PDF sync server bound 0.0.0.0 with a wildcard CORS header until the bind default became 127.0.0.1, with AARTIQ_SERVICE_HOST as the explicit opt-in and no CORS allow-origin header sent at all. See network.servers.
- The session tokens for the MCP bridge, the Agent API and the native bridge persist in mode-0600 files in your home directory (~/.aartiq-mcp-token, ~/.aartiq-agent-token, ~/.aartiq-token), so a client configured once keeps working across restarts — but remote mode is still not a finished design: there is no per-client credential to revoke, no pairing UI, and the binds are not operator-named.
- "Allow Always" is keyed on the full normalised command line, which is narrower than before but is still text matching — it records what the command says, not what it will do — and every grant now expires after 30 days, swept with an audit-log entry, so the dialog asks again. See aartiq-browser/docs-audit/issues/allow-always-granularity.md.
- An Allow Always grant requires a binary that appears in the classifier's table. One that does not — including anything we have never seen — is offered Allow Once only, because a grant that repeats a command nobody can describe is a promise about behaviour rather than about the text. Local writes such as cp, mv, mkdir and touch are in the table and keep exact-match Always grants, which expire after 30 days.
- The native bridge and the Agent API both defaulted to port 46203, so if both started one failed to bind and the error was logged and swallowed — not visible from outside. The Agent API now defaults to 46204 and the native bridge keeps 46203, so the two no longer collide.
<!-- SSOT:END known-limits -->

---

## Capabilities

- **Agent API & tool server** — one security-enforced tool registry over two transports: **MCP** for clients such as Claude Desktop, and **HTTP** for local scripts, the in-product assistant, and remote access over Tailscale / LAN. Both pass every call through the security pipeline.
- **Multiple agents, one browser** — each connection is registered with a trust level that scopes its verbs and origins, and a per-tab lock manager stops two agents colliding on form filling.
- **Accessibility snapshots with stable `@ref` ids** — agents receive an AX tree whose interactive nodes carry identity-bound ids that stay stable across navigation and DOM changes, instead of raw DOM dumps.
- **Form filling** — stored credentials and profiles live in an encrypted vault (AES-GCM, passphrase-derived key), and a field matcher autocompletes page inputs from it.
- **Chrome extensions** — loaded from an unpacked directory or installed from the Web Store, checked as CRX3 before extraction: `installFromWebStore` calls the verifier and rejects an invalid signature (fail-closed) — `src/lib/extensions/ChromeExtensionManager.js:256-266`. The verifier's own test suite is currently skipped because `verifyCrx` hangs on Node 24's OpenSSL (`src/tests/extensions.crx-verifier.test.ts:12-16`), so signature verification is not covered by CI and is not claimed here to be runtime-verified.
- **UI themes and modes** — normal, focus, reader, zen and presentation modes that change what is shown and how the assistant presents itself, independent of authentication state.

---

## Example Prompts

Try Aartiq with tasks such as:

| Prompt                                                    | Example workflow                              |
| --------------------------------------------------------- | --------------------------------------------- |
| `Search for React tutorials and open the top 3`           | Searches the web and opens relevant results   |
| `Summarize this page and save it as a PDF`                | Reads the page and generates a structured PDF |
| `Set brightness to 50% and open VS Code`                  | Uses supported system capabilities            |
| `Create a PowerPoint about climate change`                | Generates a structured presentation           |
| `Schedule a daily backup at 9 AM`                         | Creates a recurring background task           |
| `Read the text in this screenshot`                        | Uses OCR / visual intelligence                |
| `Fill this form with my details`                          | Identifies and fills supported form fields    |
| `Search for electron performance and extract the results` | Performs browser-based research               |

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

| Topic                   | Documentation                                                          |
| ----------------------- | ---------------------------------------------------------------------- |
| Overview & Architecture | [Overview](https://aartiq.ponsrischool.in/docs/overview)               |
| Security Model          | [Security](https://aartiq.ponsrischool.in/docs/security)               |
| AI Commands             | [Command Reference](https://aartiq.ponsrischool.in/docs/ai-commands)   |
| API Reference           | [API Reference](https://aartiq.ponsrischool.in/docs/api-reference)     |
| Components              | [Components](https://aartiq.ponsrischool.in/docs/components)           |
| Automation              | [Automation](https://aartiq.ponsrischool.in/docs/automation)           |
| Cloud Sync              | [Cloud Sync](https://aartiq.ponsrischool.in/docs/cloud-sync)           |
| Troubleshooting         | [Troubleshooting](https://aartiq.ponsrischool.in/docs/troubleshooting) |
| Changelog               | [Changelog](https://aartiq.ponsrischool.in/docs/changelog)             |
| Release notes (source)  | [release_notes/](release_notes)                                         |

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

<!-- SSOT:START glossary -->
| Term | Definition |
| --- | --- |
| **Capability** | A registered action the model may invoke. Capabilities are the only way to affect the system — there is no unrestricted access to system primitives. |
| **Approval ticket** | A single-use, time-limited token that authorises one capability execution and is consumed on use. |
| **Skill** | A named, loadable instruction bundle that shapes how the assistant approaches a class of task. Distinct from a capability: a skill changes behaviour, a capability changes the system. |
| **Risk tier** | An advisory label (low / medium / high / critical) attached to a capability or derived for a command. It is not itself an enforcement boundary — see security.riskTiers. |
| **Enforcement boundary** | A control the OS applies, which application code cannot bypass. Only OS sandboxing and capability scoping qualify. |
| **Fail-closed** | If a control cannot be established or verified, the action does not run. There is no fallback path that runs it anyway. |
| **Monitoring-only** | Code that observes and reports but does not block. It never gates an action, and should never be counted as if it did. |
| **Agent API** | The HTTP and MCP transports that expose the capability registry to external agents. Both pass every call through the security pipeline. |
| **Local-first** | User data stays on the device. Local models keep request content local; sync is end-to-end encrypted; credentials live in the OS keychain. |
<!-- SSOT:END glossary -->

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

**Aartiq™** is a trademark of Latestinssan.

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

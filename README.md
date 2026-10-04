# Aartiq™ — For The Questions That Matter

> "The most important question isn't what you ask AI. It's what AI asks you before it acts."

Aartiq™ is an open-source AI browser that plans tasks, explains non-trivial actions, requests permission when required, and executes through controlled capabilities.

**Plan → Explain → Ask → Execute**

<!-- SSOT:START version -->
**v0.3.7** — released 2026-09-13.

Latest release: [v0.3.7](https://github.com/Latestinssan/Aartiq/releases/tag/v0.3.7) · [full release notes](release_notes/v0.3.7.md)
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

Traditional browsers help you navigate the web.

AI assistants help you understand information.

**Aartiq is built for the space between the two: helping AI carry out tasks while keeping the user in control.**

Instead of manually opening tabs, searching websites, filling forms, creating documents, moving files, and repeating workflows, you describe the goal.

Aartiq can turn that goal into structured actions, evaluate those actions against its permission model, request approval when required, and execute through registered capabilities.

> **AI can act. You decide what it is allowed to do.**

---

## See Aartiq in Action

**Prompt:**

> *"Search for today's news, create a PDF summary, move it to my Desktop, and open it."*

<p align="center">
  <img width="744" height="480" alt="Aartiq task execution demo" src="https://github.com/user-attachments/assets/051f5188-6e20-4b58-8087-74b9dd61b2e2" />
</p>

The workflow:

```text
Understand
    ↓
Plan
    ↓
Explain
    ↓
Ask
    ↓
Execute
    ↓
Result
````
## Permission Workflow

| Plan | Permission | Results |
|:----:|:----------:|:-------:|
| <img width="516" height="573" alt="image" src="https://github.com/user-attachments/assets/f1c17873-077e-4b00-8ca7-87cc7cb4eebe" /> | <img width="516" height="573" alt="image" src="https://github.com/user-attachments/assets/a42e7c35-1f10-445a-b0a4-7660361a4f12" /> | <img width="516" height="573" alt="image" src="https://github.com/user-attachments/assets/aca29055-ce34-400c-9329-1bba7127d1b4" /> |

Aartiq searches the web, gathers information, creates the document, requests approval for actions that require it, moves the resulting file, and opens it.

---

## Permission-First AI

Aartiq evaluates each command against its registered capability and permission policy.

Actions that require approval are presented before execution with information about what will happen and what resource or capability is involved.

### Risk-Based Permissions

Risk tiers are assigned to the capability being invoked, not inferred from the wording of the prompt. They are advisory labels — the control that actually confines execution is OS sandboxing. Read the last column before relying on any row.

<!-- SSOT:START risk-table -->
| Tier | Approval behaviour | Auto-approved? | Examples | What it does not guarantee |
| --- | --- | --- | --- | --- |
| **low** | Auto-approved. A session grant for low-risk shell commands is created at startup, so no dialog appears. | Yes, by default — unconditional session grant (8h TTL, not written to disk). | `ls`, `cat`, `pwd`, `find`, `grep`, `echo`, `NAVIGATE` | Auto-approval is the default, not an opt-in. The grant is issued at startup before you choose anything. |
| **medium** | Auto-approved. A session grant for medium-risk shell commands is created at startup alongside the low-risk one. | Yes, by default — same unconditional session grant. | `cp`, `mv`, `mkdir`, `chmod`, `npm`, `git`, `curl`, `osascript` | The shell classifier only ever emits medium or high, so medium is the DEFAULT tier for any command that is not a regex-detected destructive pattern. |
| **high** | Explicit confirmation. Denied by default, then offered as Allow Once / Always / Deny. | Only if a SHELL_HIGH or SHELL_ALL grant exists, or the user has explicitly auto-approved that binary. | `sudo`, `rm`, `dd`, `shutdown`, `kill`, `mount`, `SHELL_COMMAND` | "Allow Always" persists on the FIRST WORD of the command, so approving `curl <url>` permanently allowlists `curl` generally. |
| **critical** | Denied at the policy gate unconditionally, then offered to the user as an interactive Allow / Deny prompt. | Never. Four independent guards refuse it, and it is unreachable from every permission grant and auto-approve setting. | _none assigned by any registry_ | No registry assigns this tier — it is only synthesised at runtime for commands arriving from a remote device. On the desktop shell path it uses no biometric and no QR confirmation, just a dialog. |
<!-- SSOT:END risk-table -->

For the complete command catalog, risk assignments, and implementation details:

**[AI Command Reference](https://aartiq.ponsrischool.in/docs/ai-commands)**

---

## How It Works

Aartiq converts natural-language goals into structured, permission-aware execution.

```text
┌───────────────────────────┐
│           USER            │
│     Natural-language      │
│           goal            │
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│      AI ORCHESTRATOR      │
│ GPT • Claude • Gemini ... │
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│      TASK PLANNING        │
│   Structured Commands     │
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│   PERMISSION & SECURITY   │
│ Risk • Capability • Scope │
└─────────────┬─────────────┘
              │
              ▼
        ┌──────────────┐
        │   APPROVAL   │
        │   REQUIRED?  │
        └──────┬───────┘
               │
               ▼
┌───────────────────────────┐
│     CONTROLLED EXECUTION  │
│ Browser • Files • OS • OCR│
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│          RESULT           │
└───────────────────────────┘
```

Actions are exposed through registered capabilities rather than allowing the model unrestricted access to arbitrary system primitives.

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

Latest green run: [#34769503518](https://github.com/Latestinssan/Aartiq/actions/runs/34769503518) (run #52, `workflow_dispatch`, 2026-09-13, `acc703ae`, success).

| Job | Runner | Passed | Skipped | Failed | Declared |
| --- | --- | --- | --- | --- | --- |
| Run Jest (aartiq-browser) | `ubuntu-latest` | 537 | 40 | 0 | 577 |
| Run Jest (Windows AppContainer sandbox runtime) | `windows-latest` | 61 | 30 | 0 | 91 |
| Run Jest (macOS Seatbelt sandbox runtime) | `macos-latest` | 104 | 0 | 0 | 104 |
| Run Jest (Linux bubblewrap sandbox runtime) | `ubuntu-latest` | 57 | 21 | 0 | 78 |

**4 jobs.** All four jobs were green on the run above. Dispatch inputs can reduce this to 3 (skip-full-suite) or 1 (windows-test-pattern), so this is a default-dispatch count rather than an invariant. Node 24. 30 minutes on the full-suite job; the three sandbox jobs have no timeout configured.

Test counts are generated, not typed. On macOS (local) the full suite reports **551 passed / 26 skipped / 0 failed of 577 declared** (generated 2026-10-04).

> On ubuntu-latest the full suite reports 537 passed / 40 skipped. A local macOS run of the same 577 declared tests reports 551 passed / 26 skipped. Quote the environment with the number.

### Skip breakdown — macOS (local), 2026-10-04

| Reason | Skipped | Evidence |
| --- | --- | --- |
| Platform-skipped | 12 | linux-bwrap-sandbox requires linux; generated on darwin; windows-job-sandbox requires win32; generated on darwin |
| Missing native OS-automation tooling | 11 | automation — tests registered via itWhenAvailable, skipped when the backend is absent (looks for xdotool, xte). Reason in file: "jest-circus has no `this.skip()` (Jasmine-only). Register the OS // automation tests as skipped unless the native backend exists on this // runner (xdotool / xt" |
| CRX3 signature-verifier bug | 3 | src/tests/extensions.crx-verifier.test.ts — describe.skip |
<!-- SSOT:END ci -->

The suite covers approval gating, params-hash verification, fail-closed sandboxing, directory allowlists, capability scoping, and agent token-binding.

### Windows sandboxing (v0.3.7+)

v0.3.7 adds **AppContainer + Job Object** sandboxing on Windows. Before v0.3.7 the Job Object confined processes only; AppContainer adds OS-layer isolation — filesystem via package-SID ACL grants and network via zero capabilities — by starting the target with `CreateProcessW` in a suspended state inside the AppContainer and applying the Job Object at creation, so nothing runs even momentarily unsandboxed.

* **CI-verified on real Windows** (`windows-latest`): the runtime matrix passes — suspended AppContainer start, OS-enforced ACL allowlist, verified job assignment, grandchild containment, secret isolation, and `KILL_ON_JOB_CLOSE` all return verified sandbox results.
* **Audited:** design + source review in [`Audit Report/2026-09-13_Windows_AppContainer_Sandbox_Audit/SECURITY_AUDIT.md`](Audit%20Report/2026-09-13_Windows_AppContainer_Sandbox_Audit/SECURITY_AUDIT.md).
* **Fail-closed:** any policy or setup failure returns a structured `SANDBOX_*` error; there is no fallback path that runs the command unsandboxed.

### Network listeners

Every socket the application opens, and what actually protects it:

<!-- SSOT:START network -->
| Service | Port | Default bind address | Reachable from LAN when | Authentication |
| --- | --- | --- | --- | --- |
| MCP browser bridge | 3001 | `all interfaces (0.0.0.0 / ::)` | **always** — there is no switch to restrict it | None on connect. CORS is '*'. A pairing token exists but SSE auto-confirms it; only per-tool risk approval gates individual calls. |
| WiFi sync (desktop ↔ mobile) | 3004 | `all interfaces (0.0.0.0 / ::)` | **always** — there is no switch to restrict it | Handshake pairing code only. The command and desktop-control message types are not re-checked against it. |
| Native macOS / CLI bridge | 46203 | `127.0.0.1` | **always** — there is no switch to restrict it | None. Clients send X-Aartiq-Native-Token; the server never reads it. |
| Agent API tool server | 46203 | `127.0.0.1` | config.remote === true (defaults to false; no UI, env var, or IPC path sets it) | None. An anonymous caller is auto-registered as a limited-trust agent. |
| Background task service (separate Electron app) | 3999 | `0.0.0.0` | **always** — there is no switch to restrict it | None. Serves ~/Documents/Aartiq/public with Access-Control-Allow-Origin: *. |
<!-- SSOT:END network -->

Two of these bind all interfaces by default with no switch to restrict them. If you run Aartiq on a shared or untrusted network, that is the part to think about first.

### Known limits

<!-- SSOT:START known-limits -->
- Runtime sandbox tests execute only on their own OS. There is no single job that exercises Seatbelt, bubblewrap, and AppContainer at once.
- OS-automation tests skip wherever the native tooling is absent (xdotool/xte on Linux, cliclick on macOS).
- The CRX3 signature-verifier suite is skipped because verifyCrx() hangs on a Node 24 / OpenSSL header parse. It is counted as skipped, never as passing, until the verifier is fixed.
- SecurityValidator.js does not guarantee that non-blocked commands are safe — it is a fast first-pass reject layer.
- Visual extraction reduces the DOM-based prompt-injection surface. It does not prevent prompt injection, and it cannot give semantic immunity against instructions rendered into the viewport.
- Seatbelt profiles start from (allow default), so not every IPC class is denied by default; Mach IPC stays usable because node/python/shell require it.
- Apple Events cannot be filtered by the current sandbox-exec — the operation is not exposed — so a sandboxed command could still ask another app to act on its behalf.
- The MCP bridge and the WiFi sync server bind all network interfaces by default and are reachable from the local network. See network.servers.
- The native bridge accepts an X-Aartiq-Native-Token header but does not verify it; any local process can call its routes.
<!-- SSOT:END known-limits -->

---

## Agent API & Tool Server

Aartiq exposes its browser capabilities to AI agents through a single, security-enforced tool registry served over two transports:

* **MCP** (Model Context Protocol) for clients such as Claude Desktop, and
* **HTTP** for local scripts, the in-product assistant, and remote access over Tailscale / LAN.

Every tool call — navigation, tab control, form filling, extension management, snapshots, theming, or OS actions — is routed through the `SecurityPipeline` before it runs. The pipeline performs risk classification, capability matching, and approval-gating.

### Multiple agents, one browser

More than one agent can be connected to the same browser at once. Each connection is registered with a trust level that scopes its verbs and origins. A per-tab lock manager ensures two agents can't collide on form filling.

### Accessibility snapshots with stable `@ref` ids

Instead of raw DOM dumps, agents receive an accessibility (AX) tree. Each interactive node carries an identity-bound `@ref` id derived from the page's backend node id, so a reference stays stable across navigation and DOM changes.

### Form filling

Stored credentials and profiles are kept in an encrypted vault (AES-GCM, passphrase-derived key; the same E2EE2 scheme used elsewhere). A field matcher maps page inputs to stored values by autocompleting password fields and typed text.

### Chrome extensions

Extensions can be loaded from an on-disk unpacked directory or installed from the Chrome Web Store. Web Store packages are validated as CRX3: the signature is verified with the embedded public key.

### UI themes and modes

The interface supports selectable themes and UI modes (normal, focus, reader, zen, presentation) that adjust what is shown and how the assistant presents itself, independent of the underlying authentication state.

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

Aartiq supports multiple AI backends, including:

* Google Gemini
* OpenAI GPT
* Anthropic Claude
* Groq
* xAI
* Azure OpenAI
* Ollama (local)
* LM Studio (local, OpenAI-compatible)
* Apple Intelligence on macOS

Provider availability depends on the platform and configuration. Local models (Ollama, LM Studio) keep request content on the device; an OpenClaw-compatible local-agent bridge is also supported for remote inference.

---

## Performance

Aartiq opens the Chromium window immediately and loads background services asynchronously, so the interface is usable before every subsystem has finished starting. Long-running automation runs as a background task, not a blocking modal.

### Benchmark

<!-- SSOT:START benchmarks -->
Measured on a **MacBook Pro M4 Pro**, 12-core CPU, 24 GB RAM, macOS 26.5.

**2026-07-20 — benchmarked on v0.3.4.** Current release: v0.3.7.

| Metric | Result |
| --- | --- |
| First visible window | **0.32s** |
| Warm start | **0.31s** |
| Idle CPU after initialization | **<1%** |

> Startup means time to first visible window, not complete service initialisation. Results vary by hardware, operating system, and configuration.

> These figures predate the current release (v0.3.7) and were taken on v0.3.4. TODO(verify) — no benchmark script, raw output file, or instrumentation exists in either repository. These figures cannot currently be reproduced or checked. A published page also claimed the benchmark scripts were included in the repository; that claim was false and has been removed.
<!-- SSOT:END benchmarks -->

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
> ## 🚧 Project Status: AI-Assisted Maintenance
>
> Aartiq was built solo, from scratch, over the past several months — no team, no funding, just one developer learning as it went. It's now a working, tested, cross-platform AI browser with a real permission and sandboxing model behind it.
>
> **Development has shifted to an AI-assisted maintenance model.** AI agents now handle a meaningful share of day-to-day work — reviewing issues, analyzing bugs, improving docs, and preparing fixes. This does **not** mean the project is unmaintained or unaccountable:
>
> - Every change to security, permissions, user data, releases, or project direction is reviewed and approved by a human before it ships.
> - CI must be green before any release goes out (see the Security section above for the current test numbers).
> - The maintainer remains responsible for the project's direction and correctness.
>
> **Why this setup:** it lets a solo project keep shipping fixes and improvements without requiring full-time human bandwidth on every routine task, while keeping a human in the loop for anything consequential — which is the same philosophy Aartiq applies to its own permission model.
>
> Bigger roadmap items (new features, larger refactors, community contribution workflows) are paused until there's more bandwidth or contributors to support them. Bug fixes, security patches, and documentation stay actively maintained.
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
| Aartiq Browser — desktop, mobile, and core code | Apache-2.0 | `LICENSE` | conflicted |
| Aartiq MCP Server — aartiq-mcp/ | MIT | `aartiq-mcp/LICENSE` | verified |
| Landing page / documentation site | Unlicensed (private repository) | `none` | verified |

> [!WARNING]
> **Licence conflict — unresolved, and it needs a human decision.**
> The repository root is Apache-2.0 (LICENSE), but `aartiq-browser/LICENSE.txt` is a restrictive EULA that forbids modification, derivative works, and redistribution, and it is the licence the Windows installer displays.
> - aartiq-browser/package.json:190 sets nsis.license = LICENSE.txt, so Windows installers show the EULA.
> - The EULA's own line 4 asserts 'This Is Open Source Software' while sections 2 forbids modification and redistribution.
> - The README trademark section says the licence 'permits the use, modification, and redistribution of the source code', contradicting the EULA.
> - gh api reports license: Apache-2.0 because it detects the root LICENSE only.
>
> This file does not pick a side. Until the conflict is settled, treat the Apache-2.0 label on this component as unconfirmed.

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

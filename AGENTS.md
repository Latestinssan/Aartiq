# Aartiq Architecture

## Overview

Aartiq is a cross-platform AI-native browser with OS automation capabilities. It consists of three main components connected via WebSocket and IPC.

## Product Philosophy

Aartiq is guided by a small set of firm principles that should inform every engineering and product decision:

- **Local-first, privacy-first.** User data stays with the user. AI runs locally (Ollama) when possible, sync is end-to-end encrypted (E2EE2:), and credentials are stored in the OS keychain — never plaintext, never cloud-by-default.
- **AI-native, not AI-bolted-on.** The assistant is a first-class citizen of the browser, capable of reading, acting, automating, and creating with explicit user permission.
- **Human-in-the-loop, always.** Autonomy is permission-gated. Destructive or high-risk actions require approval, biometrics (Touch ID / Windows Hello), or QR confirmation. The machine proposes; the human disposes.
- **Open by default.** Aartiq is open source (Apache-2.0 browser core / MIT MCP server). Trust is earned by reading the code, not a privacy policy.
- **Secure by architecture.** A six-layer defense-in-depth model — visual sandbox & SecureDOM, syntactic firewall, human-in-the-loop, directory allowlist, OS-level sandboxing (Seatbelt / bubblewrap / AppContainer + Job Objects), and capability-scoped execution — keeps automation safe. Sandbox failures fail closed.
- **Empower, don't replace.** Aartiq augments human productivity (scheduling, document generation, research, OS control) with the user firmly in control.

When contributing, prefer designs that preserve local-first execution, minimize data egress, keep the human in the approval loop for risky actions, and stay open and auditable.

## Founder

- **Founder & Creator:** Latestinssan (GitHub: [Latestinssan](https://github.com/Latestinssan))
- **Brand aliases:** Aartiq is also referred to as **PONSRISCHOOL BROWSER** and **AARTIQ PONSRISCHOOL**, developed under the Ponsri School umbrella.
- **Project home:** https://aartiq.ponsrischool.in
- **Repository:** https://github.com/Latestinssan/Aartiq
- **Founded:** 2024
- **License:** Apache-2.0 (browser core) / MIT (MCP server)

## Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   aartiq-browser (Electron)                   │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ main.js      │  │ Next.js UI   │  │ Background       │   │
│  │ (IPC, window │◄─┤ (React/TS)   │  │ Service          │   │
│  │  management) │  │ dev server   │  │ (scheduler,      │   │
│  └──────┬───────┘  └──────┬───────┘  │  notifications)  │   │
│         │                 │           └──────────────────┘   │
│         ▼                 ▼                                   │
│  ┌──────────────────────────────────────────────────┐        │
│  │  src/lib/ (services, automation, security, OCR)  │        │
│  └──────────────────────────────────────────────────┘        │
│         │                                                     │
│         ▼                                                     │
│  ┌──────────────────────────────────────────────────┐        │
│  │  Swift Native Panels (macOS only)                 │        │
│  │  - SidebarView, SettingsView, CommandCenterView   │        │
│  │  - SiriShortcutsProvider, AppleIntelligence       │        │
│  └──────────────────────────────────────────────────┘        │
└──────────────────┬──────────────────────────────────────────┘
                   │ WebSocket (WiFi sync — see Communication Protocols)
                   ▼
┌─────────────────────────────────────────────────────────────┐
│               flutter_browser_app (Mobile)                   │
│  - WiFi sync, remote desktop control, PDF viewer             │
│  - Automation dashboard, push notifications                  │
└─────────────────────────────────────────────────────────────┘
```

## Directory Layout

| Path | Purpose |
|------|---------|
| `aartiq-browser/` | Electron desktop application |
| `aartiq-browser/main.js` | Main process entry point |
| `aartiq-browser/src/components/` | React UI components |
| `aartiq-browser/src/lib/` | Services, automation, utilities |
| `aartiq-browser/src/lib/native-panels/` | Swift native macOS panels (14 files) |
| `aartiq-browser/src/service/` | Background task scheduler |
| `aartiq-browser/scripts/` | Build and service installation scripts |
| `flutter_browser_app/` | Flutter mobile companion |
| `Landing_Page/` | Residual copy of two docs carried over from before the site moved out (`AI-GUIDE.md`, `src/lib/release-notes.ts`). The live site is the separate `Aartiq-Landing-Page` repository |
| `aartiq-browser/docs-audit/` | Phase-0 consistency audit: verified fact table, evidence log |
| `scripts/` | `gen-test-facts.ts`, `gen-repo-facts.ts`, `sync-docs.ts`, `check-docs.ts` (`npm run docs:check`) |

## Key Services (src/lib/)

| File | Purpose |
|------|---------|
| `Security.ts` / `SecurityValidator.js` | Command validation, risk levels, injection detection |
| `AIChatSidebar.tsx` | Main AI chat interface |
| `AICommandParser.ts` | Parses AI output into executable commands |
| `YouTubePlayer.tsx` | Inline YouTube iframe video player component |
| `WiFiSyncService.ts` | WebSocket sync between desktop and mobile |
| `P2PFileSyncService.ts` | Peer-to-peer file transfer |
| `CloudSyncService.ts` | Firebase cloud sync |
| `AdvancedDocumentEngine.ts` | PDF/XLSX/PPTX generation |
| `SiriShortcutsIntegration.ts` | macOS Siri and Shortcuts bridge |
| `tesseract-service.js` | OCR via Tesseract.js |
| `plugin-manager.js` | Dynamic plugin loading |
| `agent-api/` | External agent tools over HTTP + MCP (verb gate → tab lock → handler) |
| `research-pipeline.ts` | Bounded search/fetch/verify job behind Deep Research |
| `researchState.ts` | Reduces streamed `research-progress` events into chat UI state |
| `BackgroundNotifications.tsx` | Shows completed background task events on re-open |
| `AutomationPlanApproval.tsx` | Pre-execution plan with risk assessment + permission gates |
| `AutomationSettings.tsx` (enhanced) | Directory allowlisting for background automations |
| `WidgetContainer.tsx` | Collapsible/draggable/removable widget wrapper |
| `CustomizationPanel.tsx` | Widget enable/disable/reorder modal |
| `PrivacyControls.tsx` | Memory/preference/tab/animations toggles |
| `AIVisualTheme.tsx` | Glow mode, color, intensity sliders |
| `AITabAnimation.tsx` | CSS keyframe AI status animations |
| `widgets/DashboardWidget.tsx` | Greeting + stats + contextual tab actions |
| `widgets/MemoryWidget.tsx` | Learned preferences + session memory with search |
| `widgets/SessionTimelineWidget.tsx` | Live action chain step display |
| `widgets/TabIntelligenceWidget.tsx` | Domain-grouped tabs with smart icons |
| `widgets/QuickActionsWidget.tsx` | AI-powered contextual + hardcoded suggestions |
| `widgets/CapabilitiesWidget.tsx` | Lists AI capabilities |
| `widgets/TasksWidget.tsx` | Past automation runs with retry failed |

## Communication Protocols

<!-- SSOT:START protocols -->
| Protocol / Service | Port | Notes |
| --- | --- | --- |
| HTTP (Next.js, dev) | 3003 | Next.js dev server. Development only — never started in a packaged build. |
| MCP browser bridge | 3001 | mcp-bridge — binds `127.0.0.1` |
| WiFi sync (desktop ↔ mobile) | 3004 | wifi-sync — binds `all interfaces (0.0.0.0 / ::)` |
| Native macOS / CLI bridge | 46203 | native-bridge — binds `127.0.0.1` |
| Agent API tool server | 46204 | agent-api — binds `127.0.0.1` |
| Background task service (separate Electron app) | 3999 | background-service — binds `127.0.0.1` |
| UDP discovery | 3005 | UDP broadcast destination, not a listener. The discovery socket binds an ephemeral port. |
| Nexus bridge | 9922 | retired — Not present. A dead variable remains in main.js. |
| Raycast HTTP API | 9877 | retired — Not present. Port constant is declared and never read. |
| Flutter bridge | 9876 | retired — Implemented and correctly token-gated, but never instantiated. |
<!-- SSOT:END protocols -->

## CI/CD

<!-- SSOT:START workflows -->
13 GitHub Actions workflows live in `.github/workflows/`. release.yml fires on version tag push, sync-component-docs.yml fires on push to main for a path filter, and the remaining eleven are workflow_dispatch.

The test suite (`.github/workflows/jest.yml`) is one of the manual ones: Manual dispatch only. There is no push or pull_request trigger, so a green run is not evidence about the latest commit.
<!-- SSOT:END workflows -->

## Dependencies

- **Desktop**: Electron, Next.js, React, TypeScript, Framer Motion, Firebase, Mermaid
- **Mobile**: Flutter, flutter_inappwebview, Firebase Auth/DB, WebRTC
- **AI SDKs**: Vercel AI SDK (OpenAI, Anthropic, Google, Groq, xAI)
- **macOS**: SwiftUI, AppIntents, Apple Intelligence frameworks

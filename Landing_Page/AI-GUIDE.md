# Aartiq - AI Agent Guide

This guide helps AI code writers understand the Aartiq project structure, write proper release notes, maintain documentation, and ensure the landing page and docs stay consistent.

## Project Structure

```
Aartiq-Landing-Page/                 # THIS REPO — the public site + docs
├── src/
│   ├── app/                        # Next.js App Router pages
│   │   ├── docs/                   # Documentation pages
│   │   ├── api/                    # API routes
│   │   ├── llms.txt/               # Dynamic llms.txt generation
│   │   └── sitemap.ts              # XML sitemap for SEO (served at /sitemap.xml)
│   ├── components/                 # React components (docs/ + shared UI)
│   ├── data/                       # project-facts.ts (the fact SSOT) + generated facts
│   └── lib/                        # Version re-export, release notes, search index
├── public/
│   ├── LLM.md                      # Static AI-readable overview
│   ├── robots.txt                  # AI crawler permissions
│   └── .well-known/                # AI plugin manifest
├── AI-GUIDE.md                     # This file
└── README.md

Aartiq/                             # The product — a separate repository
├── aartiq-browser/                 # Electron desktop app (main.js, src/)
├── aartiq-mcp/                     # MCP server (MIT)
├── flutter_browser_app/            # Flutter mobile companion
├── Landing_Page/                   # Residual copy of AI-GUIDE.md + src/lib/release-notes.ts only
└── scripts/                        # gen-test-facts.ts, gen-repo-facts.ts, sync-docs.ts, check-docs.ts
```

---

## Version System

### Current Version
<!-- SSOT:START current-version -->
- **Version:** `0.3.8` (stable)
- **Codename:** Palisade
- **Release Date:** 2026-10-04
<!-- SSOT:END current-version -->

### Version Pattern
- Format: `Major.Minor.Patch` (e.g., `0.2.7`)
- Channels: `alpha` → `beta` → `stable`
- Single source of truth: `src/data/project-facts.ts` (`version`). `src/lib/version.ts` re-exports it; nothing defines a version on its own.

### Files to Update on Version Change
Version is written once, in `src/data/project-facts.ts`:

```typescript
// src/data/project-facts.ts — the single source of truth
export const version = {
  semver: '0.3.8',        // UPDATE THIS
  codename: 'Palisade',
  releaseDate: '2026-10-04',
  status: 'stable',
  // ...
};
```

`src/lib/version.ts` only re-exports it, so nothing defines a version on its own.
After a change, run `npm run docs:sync` followed by `npm run docs:check` in the
`Aartiq` repo — that re-renders every `SSOT:START version` block and fails if any
page still hard-codes the old value.

---

## Documentation Structure

### All Docs Pages (`/docs/*`)

| Page | Path | Description | When to Update |
|------|------|-------------|----------------|
| Getting Started | `/docs/getting-started` | Installation, setup, AI providers | New platform support |
| Keyboard Shortcuts | `/docs/keyboard-shortcuts` | Docs search and global hotkeys | New shortcuts |
| Overview | `/docs/overview` | Features, architecture, tech stack | Major features |
| Components | `/docs/components` | UI components, services | New components |
| Changelog | `/docs/changelog` | Release notes | Every release |
| Cloud Sync | `/docs/cloud-sync` | WiFi P2P, E2EE sync, mobile | Sync changes |
| AI Commands | `/docs/ai-commands` | All JSON commands for AI | New/modified commands |
| Skills | `/docs/skills` | Skill guides loaded on demand | New skills |
| Security Model | `/docs/security` | Six-layer security model | Security changes |
| Automation | `/docs/automation` | Background scheduling, cron | New automation features |
| Native API | `/docs/native-api` | macOS SwiftUI panels, IPC | New APIs |
| Apple Integration | `/docs/apple-integration` | Siri, Shortcuts, Voice, Raycast | macOS integration |
| Windows Integration | `/docs/windows-integration` | Shortcuts, Voice, Copilot | Windows integration |
| Linux Integration | `/docs/linux-integration` | bubblewrap sandbox, desktop entry | Linux changes |
| Deep Links | `/docs/deep-links` | URL schemes (`aartiq-browser://`) | New protocols |
| Plugins | `/docs/plugins` | Plugin system, SDK, hooks | Plugin changes |
| Extensions | `/docs/extensions` | Browser extensions | Extension features |
| API Reference | `/docs/api-reference` | Full IPC/API documentation | Any API changes |
| Troubleshooting | `/docs/troubleshooting` | Common issues, solutions | New issues found |
| Testing & Test Series | `/docs/testing` | Test suite, CI runs, platform matrix | Test/CI changes |
| Contributing | `/docs/contributing` | Development guide, standards | Dev process changes |
| Aartiq CLI | `/docs/native-api#cli` | Terminal-based browser control | CLI feature changes |

---

## Landing Page Structure

### Key Pages

| Page | Path | Purpose |
|------|------|---------|
| Home | `/` | Landing page with features, download |
| Downloads | `/downloads` | All platform downloads |
| Auth | `/auth` | Firebase authentication |
| Docs | `/docs` | Documentation hub |

### Components Location
```
src/components/
├── docs/
│   └── SearchModal.tsx      # Docs search modal
├── layout/
│   └── ...                 # Layout components
└── ui/
    └── ...                 # Shared UI components
```

---

## AI Commands Reference

### Command Format
Aartiq uses structured JSON commands. Always respond with JSON format:

```json
{
  "command": "COMMAND_NAME",
  "params": {
    "key": "value"
  }
}
```

### All Supported Commands

The registry is `COMMAND_REGISTRY` in `aartiq-browser/src/lib/AICommandParser.ts`
(73 commands). The public reference with parameters and examples is
`/docs/ai-commands`; every command below is registered.

| Command | Category | Description |
|---------|----------|-------------|
| `NAVIGATE` | Navigation | Go to a URL |
| `SEARCH` | Navigation | Web search |
| `WEB_SEARCH` | Navigation | Real-time search with RAG |
| `SEARCH_RESULTS` | Navigation | Get search result URLs (no tab) |
| `RELOAD` | Navigation | Refresh the current tab |
| `GO_BACK` | Navigation | Back in history |
| `GO_FORWARD` | Navigation | Forward in history |
| `READ_PAGE_CONTENT` | Browser | Extract page text |
| `LIST_OPEN_TABS` | Browser | List open tabs |
| `SWITCH_TAB` | Browser | Switch to a tab |
| `CLOSE_TAB` | Browser | Close a tab |
| `CLICK_ELEMENT` | Browser | Click a DOM element |
| `FIND_AND_CLICK` | Browser | Find text and click near it |
| `CLICK_AT` | Browser | Click at screen coordinates |
| `FILL_FORM` | Browser | Fill form fields |
| `MULTI_FILL_FORM` | Browser | Fill multiple fields atomically |
| `DOM_SEARCH` | Browser | Search within the page DOM |
| `DOM_READ_FILTERED` | Browser | Read DOM text through the injection check |
| `SCROLL_TO` | Browser | Scroll to an element |
| `SCREENSHOT_AND_ANALYZE` | Browser | Capture and analyze a screenshot |
| `DEEP_RESEARCH` | Browser | Iterative deep research |
| `ORGANIZE_TABS` | Browser | AI tab grouping |
| `GROUP_TABS` | Browser | Group tabs by ai/domain/priority/recency |
| `OPEN_VIEW` | Browser | Switch browser workspace views |
| `ANALYSE_TABS` | Browser | Analyse all open tabs |
| `ANALYZE_TABS` | Browser | US-spelling variant of ANALYSE_TABS |
| `SUMMARIZE_TABS` | Browser | Summarize open tabs |
| `READ_TAB_CONTENT` | Browser | Read one specific tab |
| `COMPARE_TABS` | Browser | Compare content across tabs |
| `FIND_INFORMATION_IN_TABS` | Browser | Search across open tabs |
| `CREATE_TAB_RESEARCH_CONTEXT` | Browser | Build a research context from open tabs |
| `CREATE_PDF_JSON` | PDF | Generate a structured PDF (preferred) |
| `CREATE_FILE_JSON` | PDF | Create PDF/PPTX/DOCX from JSON |
| `GENERATE_PDF` | PDF | Create PDF from markdown (fallback) |
| `GENERATE_DIAGRAM` | PDF | Create Mermaid diagrams |
| `SHELL_COMMAND` | Shell | Execute a terminal command (approval-gated) |
| `SET_VOLUME` | System | Set system volume |
| `SET_BRIGHTNESS` | System | Set display brightness |
| `OPEN_APP` | System | Launch an application |
| `ENABLE_CLI` | System | Enable the Aartiq CLI tool |
| `OCR_SCREEN` | OCR | Screen/region text recognition |
| `GENERATE_IMAGE` | Media | Generate an AI image |
| `APPLE_INTELLIGENCE_IMAGE` | Media | Generate image (Apple local) |
| `APPLE_INTELLIGENCE_SUMMARY` | Media | Summarize text (Apple local) |
| `PLAY_VIDEO` | Media | Play YouTube inline |
| `SEARCH_VIDEO` | Media | Search and play YouTube |
| `SCHEDULE_TASK` | Scheduling | Schedule a recurring task |
| `OPEN_SCHEDULING_MODAL` | Scheduling | Open the scheduling modal pre-filled |
| `LIST_AUTOMATIONS` | Automation | List scheduled tasks |
| `DELETE_AUTOMATION` | Automation | Remove a scheduled task |
| `RECORD_WORKFLOW` | Automation | Record a workflow |
| `PLAY_WORKFLOW` | Automation | Replay a recorded workflow |
| `OPEN_AUTOMATION_SETTINGS` | Automation | Open automation settings |
| `OPEN_MCP_SETTINGS` | Automation | Open MCP server settings |
| `LIST_BOOKMARKS` | Bookmarks | List saved bookmarks |
| `ADD_BOOKMARK` | Bookmarks | Add a bookmark |
| `REMOVE_BOOKMARK` | Bookmarks | Remove a bookmark |
| `CLEAR_BOOKMARKS` | Bookmarks | Clear all bookmarks |
| `LIST_HISTORY` | History | List/search browsing history |
| `CLEAR_HISTORY` | History | Clear all history |
| `LIST_SKILLS` | Skills | List available skill guides |
| `LOAD_SKILL` | Skills | Load a skill guide |
| `SETTINGS_QUERY` | Settings | Read current settings |
| `SETTINGS_UPDATE` | Settings | Request a settings change |
| `OPEN_SETTINGS_PANEL` | Settings | Open a settings panel |
| `SET_THEME` | Settings | Switch dark/light mode |
| `SET_CHAT_STYLE` | Settings | Customize chat font and glow |
| `THINK` | Meta | Chain-of-thought reasoning |
| `PLAN` | Meta | Plan execution steps |
| `EXPLAIN_CAPABILITIES` | Meta | List AI features |
| `WAIT` | Meta | Pause execution (ms) |
| `STATUS` | Meta | Show a custom status indicator |
| `PLUGIN_COMMAND` | Integration | Execute a plugin command |

---

### Six-Layer Security Architecture

1. **Visual Sandbox & SecureDOM** - AI reads external apps via `OCR_SCREEN` and internal pages via the SecureDOM reader (`READ_PAGE_CONTENT`, `DOM_SEARCH`, `DOM_READ_FILTERED`). Raw HTML is sanitized and screened for prompt injection before it reaches the agent. First-pass heuristic.
2. **Syntactic Firewall** - Pattern analysis blocks dangerous shell commands and prompt-injection attempts. A first-pass heuristic only — text filters are bypassable and are not the primary defence.
3. **Human-in-the-Loop Approval** - The user approves critical actions (shell, native clicks, settings changes) before they run. Policy layer.
4. **Directory Allowlist** - AI file access is restricted to explicitly approved directories with read/write separation; symlinks are resolved via `fs.realpath()`. Policy layer.
5. **OS-Level Sandboxing** - Platform sandboxes — Seatbelt (macOS), bubblewrap (Linux), AppContainer + Job Objects (Windows) — enforce filesystem, network and process boundaries at the kernel level. Setup failure fails closed and never falls back to unsandboxed execution. Enforcement boundary.
6. **Capability-Scoped Execution** - Actions run only through registered capabilities with single-use approval tickets; unregistered actions are rejected. Enforcement boundary.

Only layers 5 and 6 are enforcement boundaries in the strict sense; the first four are policy and first-pass checks. The [Security page](https://aartiq.ponsrischool.in/docs/security) carries the full breakdown.

### Risk Levels

The four tiers, their real approval behaviour, and their auto-approval defaults —
rendered from the project's single source of truth. What each tier does *not*
guarantee is documented on the
[Security page](https://aartiq.ponsrischool.in/docs/security), which carries the full table.

<!-- SSOT:START risk-table -->
| Tier | Approval behaviour | Auto-approved? | Examples |
| --- | --- | --- | --- |
| **low** | Asked every time, unless you turn on autoApproveLowRiskShell. With it off — the default — a low-risk command shows the same dialog as any other. | Only behind the opt-in autoApproveLowRiskShell setting, which defaults to off. Nothing is granted at startup. | `ls`, `cat`, `pwd`, `find`, `grep`, `echo`, `NAVIGATE` |
| **medium** | Asked every time. autoApproveMidRisk does not reach shell commands — it still applies to MCP tool actions, which is a separate question. | No. There is no setting that auto-approves a medium shell command. | `cp`, `mv`, `mkdir`, `touch`, `npm`, `git`, `node`, `python`, `curl`, `wget`, `osascript` |
| **high** | Asked every time, then offered as Allow Once / Always / Deny. | Only if a grant exists for that exact command line, or a SHELL_HIGH / SHELL_ALL grant was made deliberately. | `chmod`, `find . -delete`, `kill`, `dd`, `mount`, `iptables`, `shutdown` |
| **critical** | Denied at the policy gate unconditionally, then offered to the user as an interactive Allow / Deny prompt. | Never. Refused before the grant store and the auto-approve settings are consulted, and unreachable from every one of them. | _none assigned by any registry_ |
<!-- SSOT:END risk-table -->

### When to Update Security Docs

- New permission types added
- New risk levels or approval workflows
- Changes to encryption or authentication
- New blocked patterns in firewall

---

## LLM/AI Crawlability

### Files for AI Crawlers

| File | Location | Purpose |
|------|----------|---------|
| `LLM.md` | `/public/LLM.md` | Static overview text for LLMs |
| `robots.txt` | `/public/robots.txt` | AI crawler permissions |
| `ai-plugin.json` | `/public/.well-known/` | AI plugin manifest |

### Generated Routes
- `/llms.txt` - Generated at `src/app/llms.txt/route.ts`
- `/sitemap.xml` - Generated at `src/app/sitemap.ts`
- `/api/search` - Search API at `src/app/api/search/route.ts`

### Update When
- New doc pages added → Update `src/app/sitemap.ts` and `src/app/llms.txt/route.ts`
- New features → Update `src/app/llms.txt/route.ts` (and `public/LLM.md`)
- New AI commands → Update `src/app/llms.txt/route.ts` and `src/lib/search-index.ts`

---

## Keyboard Shortcuts

### Docs Search
| Shortcut | Action |
|----------|--------|
| `⌘K` (Mac) / `Ctrl+K` (Windows) | Open search |
| `Esc` | Close search modal |
| `↑` / `↓` | Navigate results |
| `Enter` | Select result |

### Docs Navigation
| Shortcut | Action |
|----------|--------|
| Mobile hamburger | Open sidebar |
| Sidebar links | Navigate to doc pages |

---

## Search Index

### Location
`src/lib/search-index.ts`

### Structure
```typescript
export interface SearchResult {
  id: string;
  title: string;
  description: string;
  content: string;        // Keywords for search
  url: string;            // Full URL path
  section?: string;       // Section name
  keywords: string[];    // Search keywords
  type: "page" | "section" | "command" | "api" | "guide";
}
```

### When to Update Search Index

1. **New doc page** → Add full SearchResult entry
2. **New section** → Add section entry with type: "section"
3. **New AI command** → Add command entry with type: "command"
4. **New API** → Add API entry with type: "api"
5. **Feature change** → Update relevant entry's content/keywords

### Example Search Entry for New Command
```typescript
{
  id: "ai-command-example",
  title: "EXAMPLE_COMMAND",
  description: "Description of what it does",
  content: "command keywords for search",
  url: "/docs/ai-commands#category",
  section: "Category Name",
  keywords: ["keyword1", "keyword2", "keyword3"],
  type: "command"
}
```

---

## Release Notes Format

### Location
`src/lib/release-notes.ts`

### Structure
```typescript
export interface ReleaseEntry {
  version: string;
  date: string;
  codename: string;
  channel: 'alpha' | 'beta' | 'stable';
  changes: {
    new?: string[];        // New features
    fix?: string[];        // Bug fixes
    change?: string[];     // Changes/modifications
    docs?: string[];        // Documentation updates
    security?: string[];    // Security patches
  };
}
```

### Example Release Entry
```typescript
{
  version: '0.3.8',
  date: '2026-10-04',
  codename: 'Palisade',
  channel: 'stable',
  changes: {
    new: [
      'Added new AI command EXAMPLE_COMMAND',
      'Implemented new security feature',
    ],
    fix: [
      'Fixed issue with search functionality',
    ],
    change: [
      'Updated search index structure',
    ],
    docs: [
      'Added documentation for new command',
      'Updated keyboard shortcuts guide',
    ]
  }
}
```

---

## Release Checklist

When preparing a new release, ensure all these are updated:

### 1. Version Update
- [x] Update the `version` object in `src/data/project-facts.ts`, then run `npm run docs:sync` and `npm run docs:check` in the `Aartiq` repo
- [x] Add entry to `src/lib/release-notes.ts`

### 2. Documentation
- [x] Update relevant doc pages in `/docs/`
- [x] Add new doc pages if needed
- [x] Update sidebar navigation in `layout.tsx`

### 3. Search Index
- [x] Add new entries to `src/lib/search-index.ts`
- [x] Update keywords for changed features
- [x] Add new command/API entries

### 4. AI Crawlability
- [x] Update `src/app/sitemap.ts` with new pages
- [x] Update `src/app/llms.txt/route.ts` with new features
- [x] Update `public/LLM.md` if the overview changed

### 5. Build & Test
- [ ] Run `npm run build` to verify no errors
- [ ] Test search functionality
- [ ] Verify all links work

### 6. GitHub
- [ ] Create git tag: `git tag v{x.y.z}`
- [ ] Push: `git push origin v{x.y.z}`
- [ ] Create GitHub release with notes

#### Release record: the previous release was v0.3.7 (AppContainer), tagged 2026-09-13; the current release is v0.3.8 (Palisade), published 2026-10-04.
---

## Common Patterns

### Adding New Doc Page

1. Create file: `src/app/docs/{name}/page.tsx`
2. Add to sidebar: Update `navigation` array in `layout.tsx`
3. Add to search: Add entry in `search-index.ts`
4. Add to sitemap: Update `src/app/sitemap.ts`
5. Add to llms.txt: Update `src/app/llms.txt/route.ts`

### Adding New AI Command

1. Register the command in `COMMAND_REGISTRY` (`aartiq-browser/src/lib/AICommandParser.ts`) and add any shared constants in `aartiq-browser/src/components/ai/AIConstants.ts`
2. Add the handler in `aartiq-browser/src/lib/AICommandParser.ts`
3. Document in `src/app/docs/ai-commands/page.tsx`
4. Add to search index with type: "command"
5. Add to `src/app/llms.txt/route.ts`

### Adding New API/Feature

1. Implement in `aartiq-browser/`
2. Document in relevant doc page
3. Add to `src/app/docs/api-reference/page.tsx`
4. Update search index
5. Update `src/app/llms.txt/route.ts`

### Adding New IPC Handler (User Preferences Pattern)

When adding new features that need server-side storage:

1. **Add IPC handler in main.js**: Use `ipcMain.handle('feature:action', async (event, data) => {...})`
2. **Add preload API in preload.js**: Expose via `contextBridge.exposeInMainWorld('electronAPI', {...})`
3. **Add TypeScript types in electron.d.ts**: Add to the `electronAPI` interface
4. **Add client API in lib/**: Create a client-side module that calls `window.electronAPI`
5. **Avoid Node.js in renderer**: Never import `fs`, `electron-store`, or similar in `.ts` files used by renderer

**Why?** Next.js 16+ with Turbopack cannot bundle Node.js modules. Use IPC to main process instead.

---

## Component Automation

### Auto-Updating Component Line Counts

We use a script to automatically scan and update component metadata in the documentation.

#### Location
`aartiq-browser/scripts/component-scanner.js`

#### Usage
```bash
# Scan and output JSON
cd aartiq-browser
node scripts/component-scanner.js

# Preview changes (dry run)
node scripts/component-scanner.js --dry

# Update component-data.json
node scripts/component-scanner.js --update
```

#### Features
- **Auto-detects tags**: React, Node.js, Swift, macOS, Windows, Linux, AI, Security, etc.
- **Line counting**: Automatically counts lines in all source files
- **Description extraction**: Reads JSDoc comments or guesses from filename
- **Categories**: Groups by directory (components, core, automation, service, lib)

#### Output
The script generates `component-data.json` with:
```json
{
  "generated": "2026-10-08T17:17:38.884Z",
  "version": "0.3.8",
  "desktop": {
    "total": 381,
    "totalLines": 117706,
    "components": [
      {
        "name": "AIAssistOverlay.tsx",
        "path": "AIAssistOverlay.tsx",
        "lines": 282,
        "description": "Assist Overlay",
        "tags": ["React", "Security", "AI", "macOS"],
        "lastModified": "2026-10-08",
        "codeAnalysis": { ... }
      }
    ]
  }
}
```

#### Adding New Components to Documentation

1. **Create the component** in `aartiq-browser/src/components/`
2. **Add JSDoc description** (optional but recommended):
   ```javascript
   /**
    * @description Brief description of what this component does
    */
   export default function MyComponent() { }
   ```
3. **Run the scanner** to update line counts:
   ```bash
   node scripts/component-scanner.js --update
   ```
4. **Manually add** to `docs/components/page.tsx` if not auto-included

#### For AI Agents (LLMs)

When asked to document new components or update the component list:

1. **Run the scanner first**: `node scripts/component-scanner.js --dry`
2. **Identify new/changed files** from the output
3. **Update components/page.tsx** with accurate line counts
4. **Use the generated tags** for proper categorization
5. **Verify** with `npm run build`

---

## Code Standards

### File Naming
- Components: PascalCase (`SearchModal.tsx`)
- Pages: kebab-case (`getting-started/page.tsx`)
- Utilities: camelCase (`searchIndex.ts`)

### Component Structure
```typescript
// Use client directive for interactive components
"use client";

import { useState, useEffect } from "react";
// ... imports

export default function PageName() {
  // ... component logic
  return (
    <div>
      {/* JSX */}
    </div>
  );
}
```

### Styling
- Use Tailwind CSS classes
- Follow existing color scheme (sky, purple, amber accents)
- Use `font-outfit` class for text

---

## Quick Reference

### Key Files
| File | Purpose |
|------|---------|
| `src/lib/version.ts` | Version info |
| `src/lib/release-notes.ts` | Release history |
| `src/lib/search-index.ts` | Search data |
| `src/app/docs/layout.tsx` | Docs layout & sidebar |
| `src/app/layout.tsx` | Root layout & SEO |
| `src/components/docs/SearchModal.tsx` | Search UI |

### Important URLs
- Website: https://aartiq.ponsrischool.in
- Docs: https://aartiq.ponsrischool.in/docs
- GitHub: https://github.com/Latestinssan/Aartiq
- Releases: https://github.com/Latestinssan/Aartiq/releases

---

## App Stability Fixes (2026-04-13)

### React Hook Mismatch
- **Issue:** The app would crash on `npm run dev` with "The final argument passed to useEffect changed size between renders".
- **Fix:** Purged the `idle-minimization` state dependencies and stabilized the `useEffect` hooks in `AIChatSidebar.tsx` and `ClientOnlyPage.tsx`.

### Transperent Logo Correction
- **Issue:** Packaged/Production builds showed a white background behind the logo instead of transparency.
- **Fix:** Updated `main.js` to correctly initialize the app icon using `nativeImage` from the correct asset path.

---

*Last Updated: 2026-10-11*
*For AI code writers - maintain consistency and update all related files*

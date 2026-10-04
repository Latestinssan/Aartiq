# Aartiq Architecture Documentation

## Overview

Aartiq is a cross-platform AI-powered browser with advanced automation capabilities. The architecture is designed for modularity, security, and cross-platform compatibility.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Aartiq System                           │
├─────────────────┬─────────────────┬────────────────────────────┤
│   Desktop App   │   Mobile App     │   Background Services      │
│   (Electron)   │   (Flutter)      │   (Electron Main Process)  │
├─────────────────┴─────────────────┴────────────────────────────┤
│                      Shared Libraries                           │
│   • Security Validation    • AI Command Parser                   │
│   • Automation Layer       • Plugin System                       │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Desktop Browser (Electron)

**Technology Stack:**
- Electron (main process + renderer)
- Next.js 14 (React frontend)
- TypeScript/JavaScript
- Framer Motion (animations)

**Key Files:**
| File | Lines | Purpose |
|------|-------|---------|
| `main.js` | ~8,300 | Main Electron process, IPC handlers, window management |
| `preload.js` | ~680 | Context bridge, secure IPC exposure |
| `src/components/AIChatSidebar.tsx` | 4,477 | AI chat interface, command execution |
| `src/components/SettingsPanel.tsx` | ~1,000 | Settings management UI |

**Architecture Layers:**

#### Core Modules (`src/core/`)
| Module | Lines | Purpose |
|--------|-------|---------|
| `network-security.js` | 207 | Network security configuration, proxy, DNS |
| `window-manager.js` | 179 | Window lifecycle, focus management |
| `command-executor.js` | 384 | IPC handler registration, system commands |

#### Automation Layer (`src/automation/`)
Cross-platform automation abstraction with native OS support:

| File | OS | Purpose |
|------|-----|---------|
| `index.js` | All | Main AutomationLayer class, OS detection, fallback |
| `mac.js` | macOS | AppleScript automation, native bridge support |
| `win.js` | Windows | PowerShell + Win32 API automation |
| `linux.js` | Linux | xdotool/xte/X11 automation |
| `fallback.js` | All | Robotjs conditional loader |

**Automation Features:**
- Click/move mouse with smooth interpolation
- Keyboard input and key shortcuts
- Screenshot capture
- Screen reading via Secure DOM Parser
- Cross-platform support with native fallbacks

#### Services (`src/lib/`)
| Service | Purpose |
|---------|---------|
| `robot-service.js` | Desktop automation coordinator |
| `SecureDOMReader.js` | Fast, secure DOM parsing with XSS prevention |
| `DOMSearchDisplay.js` | Visual element search results |
| `screen-vision-service.js` | AI-powered screen analysis |
| `ai-engine.js` | AI model orchestration |
| `plugin-manager.js` | Plugin lifecycle management |
| `SecurityValidator.js` | Command validation, shell sanitization |
| `AICommandParser.js` | AI command extraction and parsing |
| `agent-api/` | External agent tool registry, HTTP + MCP transports, verb gate |
| `research-pipeline.ts` | Bounded search → fetch → claim cross-verification |
| `researchState.ts` | Streaming research progress reducer for the chat sidebar |
| `web-search-service.js` | Multi-provider web/news search, HTML scraping as fallback |

#### Workers (`src/workers/`)
| File | Purpose |
|------|---------|
| `task-queue.js` | Priority task queue with retry logic |

**Task Queue Features:**
- Priority-based execution
- Concurrent task limiting
- Exponential backoff retry
- Task types: OCR, PDF, AI, Automation, General

### 2. Mobile App (Flutter)

**Technology Stack:**
- Flutter 3.x
- Dart
- iOS/Android native code

**Key Pages:**
| Page | Lines | Purpose |
|------|-------|---------|
| `desktop_control_page.dart` | ~700 | Remote desktop control, AI chat, shell |
| `automation_page.dart` | ~460 | Mobile automation, task management |
| `pdf_viewer_page.dart` | ~320 | PDF viewing and sharing |
| `remote_settings_page.dart` | ~400 | Remote settings from mobile |

**Services:**
- `sync_service.dart` - WiFi sync with desktop
- `clipboard_monitor.dart` - Clipboard monitoring and sync

### 3. Background Service (`src/service/`)

Runs scheduled tasks even when browser is closed:

| File | Purpose |
|------|---------|
| `service-main.js` | Entry point, system tray |
| `scheduler.js` | Cron-based task scheduling |
| `task-queue.js` | Priority task execution |
| `model-selector.js` | AI model selection |
| `ollama-manager.js` | Local Ollama integration |
| `notifications.js` | Desktop notifications |
| `mobile-notifier.js` | Mobile push notifications |
| `pdf-sync.js` | PDF sync server |
| `sleep-handler.js` | Sleep/wake recovery |
| `ipc-service.js` | Browser ↔ Service IPC |

### 4. Plugin System (`src/lib/plugin-manager.js`)

**Plugin Types:**
- `ai-model` - AI model plugins
- `command` - Command plugins
- `integration` - Integration plugins
- `theme` - Theme plugins
- `automation` - Automation plugins

**Plugin SDK Features:**
- Command registration
- Event hooks
- Configuration management
- Sandboxed file operations

## Security Architecture

### Capability-Scoped Execution (`capability-controller.js` + `Security.ts`)

Actions are gated by an allowlist of registered capabilities:
1. **Capability Controller** (`src/core/capability-controller.js`, `Security.ts`) - Only explicitly registered actions can execute
2. **Command Validation** (`SecurityValidator.js`) - Shell command safety (legacy regex layer, warnings only)
3. **URL Validation** - Protocol allowlist (http:, https:, mailto:)
4. **File Path Validation** - Path traversal prevention
5. **AI Command Validation** - Structured command parsing
6. **HTML Sanitization** - DOMPurify (replaced legacy regex sanitization in v0.2.98)

**Encryption**: AES-256-GCM + PBKDF2 (600K iterations). No silent base64 fallback.

**Risk Levels:**
- `LOW` - Safe, auto-executable
- `MEDIUM` - Requires confirmation
- `HIGH` - Requires explicit approval
- `CRITICAL` - Blocked by default

**Auto-Executable Commands:**
```javascript
const SAFE_COMMANDS = [
  'ls', 'pwd', 'echo', 'cat', 'grep', 'find',
  'curl', 'wget', 'git status', 'git log'
];
```

### Network Security (`src/core/network-security.js`)

**Features:**
- Proxy configuration (system, direct, fixed_servers, auto_detect)
- Secure DNS (Cloudflare, Google, Quad9)
- Ad blocking
- Tracker blocking
- Malware blocking
- WebRTC leak prevention
- DNT header support

## CI/CD Pipeline

### GitHub Actions Workflows

**`build-stable.yml`** - Deterministic builds:
- Node 20 LTS
- `npm ci` for deterministic installs
- Electron caching
- Native module rebuilding
- Separate jobs per platform (no matrix race conditions)

**`release-stable.yml`** - Release workflow:
- Version parsing from package.json
- Artifact upload to GitHub releases

### Build Configuration

**Key package.json settings:**
```json
{
  "scripts": {
    "rebuild": "electron-rebuild -f -w robotjs",
    "rebuild:native": "electron-rebuild -f -w robotjs sharp",
    "postinstall": "electron-builder install-app-deps"
  },
  "build": {
    "npmRebuild": true,
    "files": [
      "src/automation/**/*",
      "src/core/**/*"
    ]
  }
}
```

## Data Flow

### AI Command Execution

```
User Input → AIChatSidebar → AI Engine → Command Parser → Security Validator
                                                                    ↓
                                                            Permission Check
                                                                    ↓
                                                            Task Queue
                                                                    ↓
                                                            Automation Layer
                                                                    ↓
                                                            Robot Service / Native
```

### WiFi Sync Flow

```
Desktop (Port 3004) ←→ WebSocket ←→ Mobile App
         ↓
    UDP Discovery (Port 3005)
         ↓
    6-digit Pairing Code
         ↓
    Encrypted Communication
```

## File Structure

```
aartiq-browser/
├── main.js                    # Main process (~8,300 lines)
├── preload.js                 # Context bridge (~680 lines)
├── package.json
├── src/
│   ├── automation/           # Native automation (5 files)
│   ├── core/                 # Architecture refactoring (3 files)
│   ├── components/
│   │   ├── AIChatSidebar.tsx # AI interface (4,477 lines)
│   │   ├── SettingsPanel.tsx # Settings UI (1,000 lines)
│   │   └── ai/              # AI sub-components (20 files)
│   ├── lib/                  # Services (30+ files)
│   ├── workers/              # Task queue (task-queue.js)
│   ├── service/              # Background service (12 files)
│   └── tests/               # Unit tests
└── .github/workflows/        # CI/CD

flutter_browser_app/
├── lib/
│   ├── main.dart
│   ├── sync_service.dart
│   └── pages/               # 14 pages
└── pubspec.yaml
```

## Dependencies

### Core Dependencies
| Package | Purpose |
|---------|---------|
| `electron` | Desktop app framework |
| `next` | React framework |
| `framer-motion` | Animations |
| `robotjs` | Automation (fallback) |
| `tesseract.js` | OCR |
| `pdf-lib` | PDF generation |
| `sharp` | Image processing |

### Development Dependencies
| Package | Purpose |
|---------|---------|
| `@electron/rebuild` | Native module rebuilding |
| `electron-builder` | App packaging |

## Performance Considerations

### Startup Optimization
- Lazy Tesseract initialization
- Deferred ad blocker loading (5s delay)
- On-demand service initialization

### Memory Optimization
- BrowserView-based tab isolation
- Efficient clipboard monitoring (2s polling)
- PDF generation in workers

### CI Optimization
- Electron caching (up to 500MB)
- Separate platform builds (no matrix race conditions)
- Native module caching

## Testing Strategy

### Unit Tests
- `src/tests/security-validator.test.js` - 30+ test cases
- `src/tests/automation.test.js` - Automation layer tests
- `src/tests/component-tests.test.js` - Component tests

### Test Coverage Areas
- Command validation
- URL sanitization
- File path security
- Automation layer
- Task queue

## Future Enhancements

1. **Worker Threads** - Offload heavy tasks to worker threads
2. **Service Worker** - Better caching and offline support
3. **WebAssembly** - Performance-critical computations
4. **Plugin Marketplace** - Community plugin hosting
5. **Mobile Widgets** - iOS/Android widgets for quick actions

## Glossary

| Term | Definition |
|------|------------|
| BrowserView | Embedded web content in Electron |
| IPC | Inter-Process Communication |
| WebSocket | Real-time bidirectional communication |
| SecureDOMParser | Fast, secure DOM extraction with XSS prevention |
| MCP | Model Context Protocol |
| RAG | Retrieval-Augmented Generation |

## Contributing

When contributing to the architecture:

1. Follow modular patterns (single responsibility)
2. Add unit tests for new modules
3. Update this documentation
4. Ensure CI passes
5. Maintain backwards compatibility

---

## Related Documentation

For detailed information on specific subsystems, see:

- **[AUTOMATION.md](./docs/AUTOMATION.md)** - Automation Layer architecture, platform-specific backends, and usage guide
- **[PLUGIN_API.md](./docs/PLUGIN_API.md)** - Plugin system architecture, SDK reference, and plugin development guide

---

*Last Updated: 2026-04-08*
*Version: 0.2.8*

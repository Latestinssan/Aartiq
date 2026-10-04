# Feature triage — what the docs claim vs. what the code does

Step 1 of the test-first feature-reality pass. This document is the human-readable
view of `Landing_Page/data/features.manifest.json`; the manifest is the machine-readable
one and is the single source of truth for the status generators added in later steps.

- **Baseline audited:** `Aartiq` branch `security/loopback-and-auth` at `897849a6`
- **Docs audited:** `Aartiq-Landing-Page` `src/app/docs/{deep-links,apple-integration,windows-integration,linux-integration,keyboard-shortcuts,native-api,api-reference}`
- **Method:** read-only reconnaissance. Every status below cites a file and a function.
- **Test ids:** the `tests` column is empty everywhere. That is the point — nothing is
  proven yet, so no docs page may currently render any feature as available.

## Headline numbers

| Status | Count |
| --- | --- |
| `works` (real entry point, still unproven by a test) | 14 |
| `partial` (something real happens, but not what the docs say) | 14 |
| `missing` (no entry point, or never wired to anything) | 27 |
| `unsafe-by-design` (external origin acts without approval; do not implement as documented) | 6 |

| Decision | Count |
| --- | --- |
| `implement` | 28 |
| `remove-from-docs` | 14 |
| `maintainer-decides` (blocked) | 19 |

## The four findings that drive everything else

**1. `aartiq://` only works on macOS.** `main.js:2869` registers `app.on('open-url')`, which
Electron emits on macOS only. There is no `second-instance` handler and `process.argv` is
read at `main.js:2850` solely to register the protocol — never parsed for a link.
`windows-integration.js:423 handleURLSchemeEvent` and `linux-integration.js:449
handleLinuxURLScheme` are both imported into `main.js` (lines 738 and 749) and never called.
Every row in the Windows action table and the Linux action table therefore describes an
inert link. The handler layers under them are largely real; only dispatch is missing.

**2. Unknown actions become renderer IPC channel names.** `main.js:2932` is
`const ipcCommand = commandMap[command] || command;` followed by
`target.webContents.send(ipcCommand, params)`. A link nobody anticipated chooses its own
channel name and carries its own parameters. It is inert today only because no listener
exists for those names — it becomes live the moment one is added. This is undocumented, so
it is a code fix, not a docs edit: replace the fallback with an explicit reject.

**3. Four shell-execution paths have no approval, and two of them interpolate a URL
parameter into a shell string.** `linux-integration.js:156` builds
`gtk-launch ${appName} 2>/dev/null || kioclient exec ${appName}` with no quoting;
`linux-integration.js:234` does the same for notification text; `SiriShortcutsIntegration.js:216`
does it for `open -a "${appName}"`; `raycast-integration.js:177` executes
`execPromise(command)` with no permission check at all. `linux-integration.js:36 executeCommand`
uses `exec(command, args)` — with the default empty `args` the string goes through a shell.
The approval machinery already exists (`approval-gate.js`, `command-validator.js`
`checkShellPermission`, `capability-controller.js`) and none of these consult it.

**4. The docs advertise a skip-confirmation switch.** `apple-integration:133-142` documents
`aartiq://run-command?command=ls%20-la&confirm=true` with `confirm` described as
"Auto-confirm (true/false)", and `SiriShortcutsIntegration.js:41` ships that template. Windows
gates on `confirm === 'true'` at `windows-integration.js:116`. Per the ground rules this is
**removed, not implemented**: the parameter comes out of the docs and out of `APP_SHORTCUTS`,
and `run-command` goes through the approval gate.

## Triage table

| Feature | Platform | Doc location | Status | Evidence | Test ids | Decision | Risk | Approval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
`deeplink.dispatch.macos` | macos | `docs/deep-links:35-58`<br>`docs/apple-integration:99` | works | `aartiq-browser/main.js:2869 app.on('open-url')`<br>`aartiq-browser/main.js:2894 scheme dispatch (aartiq:// and comet://)` | — | implement | medium | `none`
`deeplink.dispatch.windows` | windows | `docs/windows-integration:99-240`<br>`docs/deep-links:479-486` | missing | `aartiq-browser/main.js:2869 app.on('open-url') is macOS-only`<br>`aartiq-browser/main.js: no app.on('second-instance') handler`<br>`aartiq-browser/main.js:2850 process.argv is read only to register the protocol, never pa…`<br>`aartiq-browser/src/lib/windows-integration.js:423 handleURLSchemeEvent is exported and i…` | — | implement | high | `in-app dialog`
`deeplink.dispatch.linux` | linux | `docs/linux-integration:136-147`<br>`docs/deep-links:479-486` | missing | `aartiq-browser/src/lib/linux-integration.js:449 handleLinuxURLScheme is imported at main…`<br>`aartiq-browser/main.js: no second-instance handler, no argv parsing` | — | implement | high | `in-app dialog`
`deeplink.unknown-passthrough` | macos | — | unsafe-by-design | `aartiq-browser/main.js:2932 const ipcCommand = commandMap[command] \|\| command;`<br>`aartiq-browser/main.js:2933 target.webContents.send(ipcCommand, params)` | — | remove-from-docs | critical | `n/a`
`deeplink.chat` | macos | `docs/apple-integration:100-106`<br>`docs/windows-integration:100-108`<br>`docs/linux-integration:137` | works | `aartiq-browser/src/lib/SiriShortcutsIntegration.js:139 executeShortcutAction chat/ask-ai…` | — | implement | low | `none`
`deeplink.search` | macos | `docs/apple-integration:107-113`<br>`docs/windows-integration:109-118` | works | `aartiq-browser/src/lib/SiriShortcutsIntegration.js:163 executeShortcutAction search open…` | — | implement | low | `none`
`deeplink.navigate` | macos | `docs/apple-integration:114-119`<br>`docs/windows-integration:119-128` | partial | `aartiq-browser/src/lib/SiriShortcutsIntegration.js:92 normalizeNavigationTarget`<br>`aartiq-browser/src/lib/SiriShortcutsIntegration.js:155 executeShortcutAction navigate` | — | implement | medium | `none`
`deeplink.create-pdf` | macos | `docs/apple-integration:120-132` | partial | `aartiq-browser/src/lib/SiriShortcutsIntegration.js:172 executeShortcutAction create-pdf …` | — | maintainer-decides | low | `none`
`deeplink.create-doc` | macos | `docs/apple-integration:186-193` | missing | `aartiq-browser/main.js:2904 'create-doc': 'ai:create-pdf'`<br>`'create-doc' is not in the siriActions list at main.js:2922` | — | maintainer-decides | low | `none`
`deeplink.run-command` | macos | `docs/apple-integration:133-142`<br>`docs/linux-integration:141`<br>`docs/windows-integration:129-138` | partial | `aartiq-browser/src/lib/SiriShortcutsIntegration.js:182 executeShortcutAction run-command…`<br>`aartiq-browser/main.js:2905 'run-command': 'shell:execute'` | — | implement | high | `capability ticket (approval-gate)`
`deeplink.open-app` | macos | `docs/apple-integration:160-166`<br>`docs/windows-integration:139-147`<br>`docs/linux-integration:142` | unsafe-by-design | `aartiq-browser/src/lib/SiriShortcutsIntegration.js:216 await execPromise(`open -a "${app…` | — | implement | high | `in-app dialog`
`deeplink.screenshot` | macos | `docs/apple-integration:167-171`<br>`docs/windows-integration:148-156` | missing | `aartiq-browser/main.js:2907 'screenshot': 'system:screenshot'`<br>`'screenshot' is not in the siriActions list at main.js:2922` | — | maintainer-decides | low | `none`
`deeplink.volume` | macos | `docs/apple-integration:152-159`<br>`docs/linux-integration:144`<br>`docs/windows-integration:157-165` | works | `aartiq-browser/src/lib/SiriShortcutsIntegration.js:201 executeShortcutAction volume clam…` | — | implement | low | `none`
`deeplink.schedule` | macos | `docs/apple-integration:143-151`<br>`docs/windows-integration:166-175`<br>`docs/linux-integration:145` | partial | `aartiq-browser/src/lib/SiriShortcutsIntegration.js:191 executeShortcutAction schedule in…` | — | maintainer-decides | medium | `in-app dialog`
`deeplink.ask-ai` | macos | `docs/linux-integration:146`<br>`docs/windows-integration:176-184` | works | `aartiq-browser/src/lib/SiriShortcutsIntegration.js:139 executeShortcutAction chat/ask-ai…` | — | implement | low | `none`
`deeplink.voice-chat` | macos | `docs/apple-integration:222-228` | partial | `aartiq-browser/src/lib/SiriShortcutsIntegration.js:148 executeShortcutAction voice-chat …` | — | maintainer-decides | low | `none`
`deeplink.set-model` | macos | `docs/apple-integration:177-181` | missing | `aartiq-browser/main.js:2912 'set-model': 'ai:set-model'`<br>`aartiq-browser/src/lib/SiriShortcutsIntegration.js has no set-model branch` | — | maintainer-decides | medium | `in-app dialog`
`deeplink.browse` | macos | — | missing | `aartiq-browser/main.js:2913 'browse': 'open-quick-browse'` | — | remove-from-docs | low | `none`
`deeplink.ocr` | macos | — | missing | `aartiq-browser/main.js:2914 'ocr': 'trigger-screen-ocr'` | — | remove-from-docs | low | `none`
`deeplink.pdf` | macos | — | missing | `aartiq-browser/main.js:2915 'pdf': 'open-pdf-creator'` | — | remove-from-docs | low | `none`
`deeplink.automation` | macos | `docs/deep-links:129`<br>`docs/deep-links:138` | missing | `aartiq-browser/main.js:2916 'automation': 'open-automation-panel'` | — | implement | low | `none`
`deeplink.settings` | macos | `docs/deep-links:130` | missing | `aartiq-browser/main.js:2917 'settings': 'open-settings'`<br>`aartiq-browser/src/app/ClientOnlyPage.tsx:1374 handles 'open-settings' only as an execut…` | — | implement | low | `none`
`deeplink.index` | macos | — | missing | `aartiq-browser/main.js:2918 'index': 'open-main'` | — | remove-from-docs | low | `none`
`deeplink.auth-callback` | macos | — | partial | `aartiq-browser/main.js:2886-2888 forwards the whole URL to the renderer as auth-callback`<br>`aartiq-browser/src/app/layout.tsx:51 and src/components/SettingsPanel.tsx:89 listen on a…`<br>`aartiq-browser/preload.js:205 onAuthCallback` | — | maintainer-decides | high | `n/a`
`siri.appintents` | macos | `docs/apple-integration:63-90`<br>`docs/apple-integration:331` | works | `aartiq-browser/src/lib/native-panels/AppIntents.swift:83-529 twenty AppIntent structs`<br>`aartiq-browser/src/lib/native-panels/AppIntents.swift:532 AartiqShortcutsProvider.appSho…` | — | implement | medium | `n/a`
`siri.shortcuts-library` | macos | `docs/apple-integration:92-193` | partial | `aartiq-browser/src/lib/SiriShortcutsIntegration.js:12-79 APP_SHORTCUTS (11 templates)`<br>`aartiq-browser/src/lib/SiriShortcutsIntegration.js:41 run-command template carries confi…` | — | implement | high | `capability ticket (approval-gate)`
`voice.wake-word` | macos, windows | `docs/windows-integration:176-196`<br>`docs/apple-integration:196-238` | missing | `grep for 'wake word'/'wakeword' across src/ and main.js returns nothing`<br>`aartiq-browser/src/lib/voice-input-handler.js:189 macOSSpeechRecognitionCommands has no …` | — | maintainer-decides | high | `n/a`
`voice.macos-phrases` | macos | `docs/apple-integration:222-238` | partial | `aartiq-browser/src/lib/voice-input-handler.js:189-199 nine triggers, all built on the na…`<br>`aartiq-browser/src/lib/voice-input-handler.js:201 parseVoiceCommand defaults to chat for…` | — | maintainer-decides | medium | `n/a`
`voice.windows-commands` | windows | `docs/windows-integration:176-196`<br>`docs/windows-integration:513-535` | missing | `aartiq-browser/src/lib/windows-integration.js:229 handleVoiceAction only supports comman…`<br>`aartiq-browser/src/lib/windows-integration.js:253 startVoiceRecognition uses System.Spee…` | — | maintainer-decides | high | `n/a`
`voice.linux-tts` | linux | `docs/linux-integration:78-96` | works | `aartiq-browser/src/lib/linux-integration.js:254 speakText calls espeak with an argv array` | — | implement | low | `none`
`voice.linux-stt` | linux | `docs/linux-integration:84-86` | missing | `grep 'pocketsphinx' across src/ returns nothing` | — | remove-from-docs | low | `n/a`
`apple-intelligence.summary` | macos | `docs/apple-integration:307-322`<br>`docs/native-api:202`<br>`docs/api-reference:166` | works | `aartiq-browser/src/lib/apple-intelligence.swift:315 case "summary"`<br>`aartiq-browser/src/lib/native-panels/ViewModel.swift:333 POST /native-mac-ui/apple-intel…` | — | implement | low | `none`
`apple-intelligence.generate-image` | macos | `docs/apple-integration:324-334`<br>`docs/native-api:203`<br>`docs/api-reference:167` | works | `aartiq-browser/src/lib/apple-intelligence.swift:374 case "image"`<br>`aartiq-browser/src/lib/native-panels/ViewModel.swift:344 POST /native-mac-ui/apple-intel…` | — | implement | low | `none`
`apple-intelligence.genmoji` | macos | `docs/apple-integration:50` | partial | `aartiq-browser/src/lib/apple-intelligence.swift:435 case "genmoji" + generateGenmoji`<br>`aartiq-browser/main.js:350 apple-intelligence-genmoji IPC handler`<br>`aartiq-browser/src/lib/apple-intelligence.js builds the helper binary with swiftc at run…` | — | maintainer-decides | low | `n/a`
`apple-intelligence.writing-tools` | macos | `docs/apple-integration:51` | missing | `aartiq-browser/src/lib/native-panels/AppleIntelligencePanelView.swift:721 writingToolsView`<br>`no WritingTools API is called anywhere` | — | maintainer-decides | low | `n/a`
`apple-intelligence.priority-notifications` | macos | `docs/apple-integration:52` | missing | `grep for 'priority notification' across src/, main.js and the Swift panels returns nothing` | — | maintainer-decides | medium | `n/a`
`copilot.open` | windows | `docs/windows-integration:242-245` | works | `aartiq-browser/src/lib/windows-integration.js:229 handleCopilotAction opens com.microsof…` | — | implement | low | `none`
`copilot.panel` | windows | `docs/windows-integration:243` | missing | `grep 'copilot-panel' across src/ and main.js returns nothing` | — | maintainer-decides | medium | `n/a`
`copilot.dual-chat` | windows | `docs/windows-integration:249` | missing | `grep 'dual-chat' across src/ and main.js returns nothing` | — | maintainer-decides | high | `n/a`
`copilot.compare` | windows | `docs/windows-integration:250` | missing | `grep for a 'compare' action returns only an unrelated id in src/lib/homeIntelligence.ts:…` | — | maintainer-decides | medium | `n/a`
`copilot.shortcuts` | windows | `docs/windows-integration:242-251`<br>`docs/keyboard-shortcuts:55-63` | missing | `aartiq-browser/src/lib/constants.ts:1 shortcutDefinitions contains none of these acceler…`<br>`aartiq-browser/main.js:8870 defaultShortcuts contains none of these accelerators` | — | remove-from-docs | medium | `n/a`
`copilot.vscode` | windows | `docs/windows-integration:513-535` | missing | `the PowerShell snippets reference no Aartiq surface at all` | — | remove-from-docs | low | `n/a`
`http-api.port-3000` | macos, windows, linux | `docs/windows-integration:477`<br>`docs/windows-integration:835-847`<br>`docs/deep-links:139` | missing | `no listener on 3000 anywhere; grep for 3000 finds only timeouts and one UI placeholder a…`<br>`aartiq-browser/src/lib/url-utils.js:20 mentions 3000 in a comment only` | — | remove-from-docs | critical | `n/a`
`http-api.native-bridge` | macos | `docs/mcp-settings:239`<br>`docs/native-api:191-207` | works | `aartiq-browser/main.js:1245 startNativeMacUiBridge`<br>`aartiq-browser/main.js:1259 checkLocalRequest(requireToken: true) on every route`<br>`aartiq-browser/src/lib/local-server-auth.js checkLocalRequest / extractToken / isHostAll…`<br>`aartiq-browser/src/lib/agent-api/server.ts:70 resolveAgent, :79 callTool` | — | implement | high | `n/a`
`cli.aartiq` | macos | `docs/native-api:191-207` | partial | `aartiq-browser/scripts/aartiq-cli.js:22 PORT/HOST from AARTIQ_NATIVE_MAC_UI_PORT, defaul…`<br>`aartiq-browser/scripts/aartiq-cli.js:161-169 hardcoded fallback token` | — | implement | high | `n/a`
`raycast.extension` | macos | `docs/apple-integration:239-304` | missing | `aartiq-browser/raycast-extension/package.json declares exactly one command, search-tabs`<br>`aartiq-browser/raycast-extension/src/search-tabs.tsx:15 targets http://127.0.0.1:9877/ra…`<br>`aartiq-browser/main.js:1061 RAYCAST_PORT 9877 is declared and never read; no listener ex…`<br>`AGENTS.md protocols table: Raycast HTTP API 9877 retired` | — | maintainer-decides | medium | `n/a`
`raycast.commands` | macos | `docs/apple-integration:239-304` | missing | `aartiq-browser/raycast-extension/package.json commands array has one entry`<br>`aartiq-browser/src/lib/raycast-integration.js:16 setupDefaultCommands registers 12 handl…` | — | maintainer-decides | medium | `n/a`
`raycast.run-command` | macos | — | unsafe-by-design | `aartiq-browser/src/lib/raycast-integration.js:177 handleRunCommand calls execPromise(com…`<br>`aartiq-browser/src/lib/raycast-integration.js:31 handleProtocol is exposed to the render…` | — | implement | critical | `capability ticket (approval-gate)`
`raycast.open` | macos | — | unsafe-by-design | `aartiq-browser/src/lib/raycast-integration.js:66-71 handleOpen builds an `open -a` shell…` | — | implement | high | `in-app dialog`
`linux.url-scheme-actions` | linux | `docs/linux-integration:136-147` | missing | `aartiq-browser/src/lib/linux-integration.js:81 handleLinuxShortcutAction has 12 handlers`<br>`aartiq-browser/src/lib/linux-integration.js:449 handleLinuxURLScheme is never called (se…` | — | implement | high | `in-app dialog`
`linux.notify` | linux | `docs/linux-integration:147` | partial | `aartiq-browser/src/lib/linux-integration.js:228 handleNotifyAction`<br>`aartiq-browser/src/lib/linux-integration.js:234 GNOME branch interpolates title/message/…`<br>`aartiq-browser/src/lib/linux-integration.js:36 executeCommand uses exec(command, args)` | — | implement | high | `in-app dialog`
`linux.open-app` | linux | `docs/linux-integration:142` | unsafe-by-design | `aartiq-browser/src/lib/linux-integration.js:156-167 handleOpenAppAction builds `gtk-laun…` | — | implement | critical | `in-app dialog`
`linux.run-command` | linux | `docs/linux-integration:141` | unsafe-by-design | `aartiq-browser/src/lib/linux-integration.js:146 handleShellCommandAction sends ai:run-co…`<br>`aartiq-browser/src/lib/windows-integration.js:116 is the Windows equivalent, which at le…` | — | implement | high | `capability ticket (approval-gate)`
`linux.volume` | linux | `docs/linux-integration:117-134` | works | `aartiq-browser/src/lib/linux-integration.js:177 handleVolumeAction uses argv arrays for …` | — | implement | low | `none`
`linux.screenshots` | linux | `docs/linux-integration:131` | missing | `aartiq-browser/src/lib/linux-integration.js:169 handleScreenshotAction only sends ai:scr…`<br>`no scrot or ImageMagick call exists in src/lib/linux-integration.js` | — | remove-from-docs | low | `n/a`
`linux.gnome-integration` | linux | `docs/linux-integration:38-56` | partial | `aartiq-browser/src/lib/linux-integration.js:70 detectDesktop and :228 notifications are …`<br>`aartiq-browser/src/lib/linux-integration.js installGNOMEShortcut creates a .desktop file`<br>`grep for tray icon / StatusNotifierItem in src/lib/linux-integration.js returns nothing` | — | remove-from-docs | low | `n/a`
`linux.kde-integration` | linux | `docs/linux-integration:58-76` | partial | `aartiq-browser/src/lib/linux-integration.js:236 KDE branch uses kdialog with an argv array`<br>`aartiq-browser/src/lib/linux-integration.js:184 KMix volume via qdbus`<br>`grep for 'KRunner' returns nothing; no tray code exists` | — | remove-from-docs | low | `n/a`
`linux.desktop-shortcuts` | linux | `docs/linux-integration:98-115`<br>`docs/linux-integration:149-159` | works | `aartiq-browser/src/lib/linux-integration.js installGNOMEShortcut`<br>`aartiq-browser/src/lib/linux-integration.js createDesktopLauncher`<br>`aartiq-browser/main.js:753 registerLinuxProto installs the aartiq:// handler` | — | implement | low | `none`
`keyboard.docs-table` | macos, windows, linux | `docs/keyboard-shortcuts:40-100` | partial | `aartiq-browser/src/lib/constants.ts:1 shortcutDefinitions is the real table`<br>`aartiq-browser/main.js:8870 defaultShortcuts is the real global-shortcut set`<br>`aartiq-browser/src/components/KeyboardShortcutSettings.tsx:4 renders shortcutDefinitions` | — | remove-from-docs | low | `n/a`
`keyboard.shift-tab-approval` | macos, windows, linux | `docs/keyboard-shortcuts:58`<br>`docs/keyboard-shortcuts:94` | missing | `grep 'Shift' + Tab across src/ returns no approval binding`<br>`aartiq-browser/src/lib/approval-gate.js issues SHA-256 input-bound one-time tickets; the…` | — | remove-from-docs | high | `n/a`
`keyboard.global-hotkeys` | macos, windows, linux | — | works | `aartiq-browser/main.js:8865 registerGlobalShortcuts`<br>`aartiq-browser/main.js:8870-8880 defaultShortcuts`<br>`aartiq-browser/src/app/ClientOnlyPage.tsx:1360 onShortcut switch` | — | maintainer-decides | low | `n/a`

## Blocked on maintainer decisions

Nineteen features are marked `maintainer-decides`. Per the step-1 stop gate, nothing is
implemented and nothing is deleted until these are answered.

### Voice and wake word (scope, not a bug)

- `voice.wake-word` — "Hey Aartiq" appears nowhere in the codebase; there is no wake-word
  state machine at all. Always-listening means the microphone runs outside any user gesture
  in an app that is also a general web browser. That is a product decision.
- `voice.macos-phrases` — the shipped trigger set is nine phrases built on the name
  "comet" (`voice-input-handler.js:189`). The docs describe something else. Also
  `parseVoiceCommand` falls through to `chat`, so ambient speech becomes a prompt.
- `voice.windows-commands` — the code is honest dictation (`System.Speech` +
  `DictationGrammar`, raw text, no phrase parsing). The docs describe a grammar plus twelve
  shortcuts. The doc snippets are also fictional: `Install-Module SpeechRecognition` and
  `Start-SpeechRecognition -Callback` are not cmdlets, and `SAPI.SpSharedRecognizer` is not
  a valid ProgID.

**Question:** which name ships — the implemented one or the documented one — and is wake-word
listening in scope at all?

### Copilot

- `copilot.open` is real and thin: it launches Copilot and ignores `params.command`. Not
  blocked, but the docs must stop implying a conversation.
- `copilot.panel`, `copilot.dual-chat`, `copilot.compare` — none exist. `dual-chat` sends the
  same prompt to two providers, so it is a data-egress decision. The shortcut column for all
  eight rows (`Ctrl+Shift+C`, `Ctrl+Alt+E/R/T/D`, `Ctrl+D`, `Ctrl+Shift+P`) is not registered
  anywhere, and `Ctrl+D` / `Ctrl+Shift+P` collide with existing Windows bindings.

**Question:** does Aartiq ship an embedded Copilot surface at all, and if so which of the
three actions?

### Apple Intelligence

- `apple-intelligence.genmoji` — the handler exists (`main.js:350`, `apple-intelligence.swift:435`,
  gated on macOS 15.4+) and is simply absent from `native-api` and `api-reference`. The docs
  understate it. Document it, or leave it out?
- `apple-intelligence.writing-tools` — the only "Writing Tools" in the tree is a SwiftUI
  section label in `AppleIntelligencePanelView.swift:721`, i.e. a rewrite panel Aartiq draws
  itself. That is not the OS feature the Apple page implies.
- `apple-intelligence.priority-notifications` — zero matches anywhere. Rendered on the Apple
  page as a shipped feature.

**Question:** for Writing Tools, document the in-app panel honestly or drop the row? For
Priority Notifications, drop it? For Genmoji, document it?

### Also blocked (same gate, lower stakes)

- `http-api.port-3000` — remove the Power Automate section, or rewrite it against the real
  46203 bridge? Port 3000 has never existed.
- `raycast.extension`, `raycast.commands` — give the extension a real transport, or mark it
  unpublished as unpublished? Its one declared command targets retired port 9877.
- `deeplink.create-pdf`, `deeplink.create-doc`, `deeplink.schedule`, `deeplink.screenshot`,
  `deeplink.set-model`, `deeplink.voice-chat` — wire these to their real implementations, or
  downgrade the docs to what actually happens?
- `deeplink.auth-callback` — the OAuth callback URL reaches the renderer unvalidated.
- `keyboard.global-hotkeys` — real and undocumented; document it as the honest replacement for
  the keyboard-shortcuts page?

## Doc defects recorded as evidence (fix in step 5, not here)

- **Non-functional snippets that must be replaced by code that runs in a test:** nonexistent
  cmdlets (`Get-EventLog`, `Install-Module SpeechRecognition`, `Start-SpeechRecognition -Callback`);
  mixed VBScript inside a `language="powershell"` block with `{Hwnd}` and an invalid ProgID;
  the registry `.reg` block, which renders doubled backslashes and `\"` instead of `""`;
  unencoded `&` inside URL parameter values on the Linux, Windows and deep-links pages;
  four-field cron expressions where the scheduler expects five.
- **Action fragmentation:** 18 distinct `aartiq://` actions spread over three pages with no
  index, inconsistent per-platform availability, and `screenshot` missing from the Linux
  page's own action table while appearing in its shortcut templates.
- **Keyboard shortcuts:** the page cites `src/lib/KeyboardShortcutService.ts`, which does not
  exist (the real table is `src/lib/constants.ts`); eight rows are not key combinations;
  `Shift+Tab` is listed twice; and the table shares almost no accelerator with the code.
- **Stale external references:** `Windows 12` and Firebase Dynamic Links are cited as current.

## Privacy note (does not block Step 1)

`AGENTS.md` and several site files carry a school-derived brand name and vanity domain, and
the docs are published under it. None of that is reproduced in the manifest, this file, or in
any code, test, commit or PR text for this work — the ground rule is that the maintainer stays
pseudonymous. Raising it here so it can be decided separately; it is out of scope for the
manifest and touching it is not part of any planned step.

## What Step 2 does with this

1. Write failing tests first, one per `implement` row, each importing the real module named in
   `evidence`. No mocks of the unit under test; one real integration path per feature.
2. Capture `docs-audit/red-evidence/<feature>.txt` from this baseline commit before touching
   implementation. A test that does not fail here, or fails for the wrong reason, gets rewritten.
3. `scripts/check-tests-honest.ts` enforces no `skip`/`todo`/`only`, no empty assertion bodies,
   no `expect(true)`, no feature test that imports nothing from the implementation, and no drop
   in assertion count against the red commit.
4. `scripts/gen-feature-status.ts` renders Verified / Manual-verified(date) / Experimental /
   Not implemented. Only rows with a passing test may appear in an available-features list;
   everything else moves to "Planned / not available".
5. `scripts/check-docs.ts` fails when a page documents a manifest row whose status is
   `missing` or `partial`, or names a test id that does not exist.

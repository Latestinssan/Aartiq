# Security defaults verification

Phase A0. Read-only pass over the code as it stands on `security/loopback-and-auth`,
before any change in this branch. Every statement below names the file and the
function it came from.

This document deliberately describes weaknesses at the level needed to fix them.
It contains no exploitation steps and no payloads.

---

## 1. Listeners, bind addresses, and what causes a wide bind

| Server | File | Function | Default bind | Why |
| --- | --- | --- | --- | --- |
| MCP browser bridge (3001) | `src/lib/mcp-browser-server.js` | `BrowserMcpServer.start` | **all interfaces** | `this.httpServer.listen(port, cb)` passes no host argument, so Node binds `::` / `0.0.0.0`. The log line in the same function prints `http://localhost:${port}/sse`, which does not describe what was opened. |
| Native macOS bridge (46203) | `main.js` | `startNativeMacUiBridge` | `127.0.0.1` | `bridgeApp.listen(nativeMacUiPort, '127.0.0.1', cb)` passes an explicit loopback host. |
| Agent API HTTP | `src/lib/agent-api/server.ts` | `AgentApiServer.startHttp` | `127.0.0.1`, or `0.0.0.0` when opted in | `bindHost(this.config)` returns `'0.0.0.0'` if `config.remote` is true, else `config.host` (`src/lib/agent-api/providers.ts`, `bindHost`; default `host: '127.0.0.1'`). This is the one listener that already has an explicit remote switch. |
| WiFi sync (3004) | `src/lib/WiFiSyncService.ts` | `WiFiSyncServer` constructor | **all interfaces** | `new WebSocketServer({ port: this.port })` passes no host, so `ws` binds `::` / `0.0.0.0`. |
| Background task service (3999) | `src/service/service-main.js`, `src/service/pdf-sync.js` | service entry points | `0.0.0.0` | `pdf-sync.js` sets `this.port = options.port \|\| 3999` and serves on all interfaces; `service-main.js` sets `port: 3999` with the comment "For serving files to mobile". |

Retired: the Nexus bridge port (9922) and the Raycast HTTP port (9877) are declared
constants with no listener. No rows for them here.

Only two of the five listeners pass an explicit host. The two widest are the MCP
bridge and WiFi sync, and both do so by omission rather than by choice.

---

## 2. How the 3001 server authenticates today

**It does not.** In `BrowserMcpServer.start` the request handler is registered with
`http.createServer(async (req, res) => {...})` and the first thing it does is set
`Access-Control-Allow-Origin: '*'`. After the `OPTIONS` short-circuit there is no
token comparison, no `Host` check and no `Origin` check anywhere in the function.

Every route is therefore reachable without credentials:

| Route | Method | Auth |
| --- | --- | --- |
| `/health` | GET | none |
| `/pairing/status` | GET | none |
| `/pairing/token` | POST | none |
| `/sse` | GET | none |
| `/messages` | POST | none (only requires an open SSE transport) |

What does exist is a *pairing* mechanism that is not wired to the HTTP surface:

- `BrowserMcpServer.setPairingToken` stores a token with a 10-minute expiry and
  resets `_pairingConfirmed` to false.
- The `confirm_pairing` MCP tool (registered in the same file) compares the token
  the caller passes against `_pairingToken` and sets `_pairingConfirmed`.
- **However**, the `/sse` branch of the request handler contains this: if
  `this._pairingToken` is set and `_pairingConfirmed` is false, it sets
  `_pairingConfirmed = true` and logs that pairing was auto-confirmed. So merely
  opening the SSE stream confirms pairing. `confirm_pairing` is unreachable in
  practice, because any client that connects to `/sse` is already confirmed.
- `POST /pairing/token` calls `setPairingToken` with a caller-supplied string. With
  no auth on that route, a client that can reach the port chooses the token.

So the 10-minute pairing window is not an authentication boundary today: it is
recorded state that the SSE branch sets on its own.

**Does pairing depend on a non-loopback address? No.** The generated client config
is `mcp-remote@0.1.17 http://127.0.0.1:3001/sse` — written by
`autoConfigureClaudeMcp` in `main.js`, and mirrored in `src/components/McpSettings.tsx`
and `src/components/ai/AISetupGuide.tsx`. `mcp-remote` runs on the same machine, and
the renderer polls `http://127.0.0.1:3001/pairing/status` and posts to
`http://127.0.0.1:3001/pairing/token`. Every caller already uses loopback, so
restricting the bind to `127.0.0.1` does not break the documented flow.

What the flow does need is a way to carry a credential, because `mcp-remote` takes a
bare URL and the current URL carries nothing. The URL is the natural carrier.

---

## 3. Can a page in the user's own browser reach 3001

At the code level, nothing prevents it. Three specific facts combine:

1. The handler sets `Access-Control-Allow-Origin: '*'` unconditionally.
2. The `OPTIONS` branch answers `204` with `Access-Control-Allow-Headers: Content-Type`,
   so a preflight for a JSON POST is approved.
3. No route inspects `Origin` or `Host`.

`/health` is a plain GET and needs no preflight, so a cross-origin read succeeds.
`/sse` is also a GET and is reachable as an `EventSource`, which is enough to trigger
the pairing auto-confirm described above. `POST /messages` needs a live transport and
the session identifier the SSE stream hands out, so it is the hardest step, not an
impossible one.

Because there is no `Host` validation, the server also cannot tell a request aimed at
`127.0.0.1` from one whose hostname resolves to `127.0.0.1`, which is the shape a DNS
rebinding attempt takes.

Honest scoping: browsers ship their own protections against public pages reaching
loopback addresses, and those protections vary by browser and version. This audit
does not claim any specific browser is bypassable today. The finding is that the
application contributes no defence of its own — it depends entirely on browser
behaviour it does not control and does not test against. The fix below removes that
dependency rather than arguing about it.

---

## 4. The startup session grant for low and medium shell commands

Created in `main.js`, in the `permissionStore.load().then(...)` callback that runs
during startup:

```
if (!permissionStore.isGranted('SHELL_LOW'))   permissionStore.grant('SHELL_LOW', 'execute', ..., true);
if (!permissionStore.isGranted('SHELL_MEDIUM')) permissionStore.grant('SHELL_MEDIUM', 'execute', ..., true);
```

- `PermissionStore.grant(key, level, description, sessionOnly)` sets
  `expires_at = Date.now() + 8 * 60 * 60 * 1000` when `sessionOnly` is true, so the
  TTL is 8 hours.
- **No setting controls it.** It is unconditional, and it runs before any user
  preference is consulted.

A comment above the block states the grants "do NOT persist to disk". That comment is
wrong: `PermissionStore.grant` calls `this._save()`, and `_save` writes the whole
permissions map to `storePath` as JSON. The grant is written to disk with an
`expires_at`; it is filtered on read by `PermissionStore.isGranted`, which deletes and
re-saves the row once it has expired. It is time-limited, not session-only.

**Which setting, if any, controls it:** none.
`PermissionStore.settings` has `autoApproveLowRisk` and `autoApproveMidRisk`, both
defaulting to `false`, and they are read by `PermissionStore.isAutoExecutable`. Those
settings are bypassed here, because the code takes the grant path before reaching them.

**What else assumes the grant exists:**

- `checkShellPermission` in `src/core/command-validator.js` maps risk to keys with
  `riskToPermKey` (`high`→`SHELL_HIGH`, `medium`→`SHELL_MEDIUM`, `low`→`SHELL_LOW`)
  and treats any *higher* key as sufficient: a `low` command is satisfied by
  `SHELL_LOW`, `SHELL_MEDIUM`, `SHELL_HIGH` or `SHELL_ALL`.
- Because `SHELL_MEDIUM` is granted at startup, **every command the classifier calls
  `medium` is auto-approved with no prompt for the next 8 hours.**
- Only after the grant checks does `checkShellPermission` consult
  `permissionStore.canAutoExecute`, which is where `autoApproveLowRisk` /
  `autoApproveMidRisk` would apply.

---

## 5. Which commands the classifier treats as medium

`SecurityValidator.getShellRisk(command)` is the classifier, and it is binary:

```
if (!command || typeof command !== 'string') return 'medium';
if (containsDestructivePattern(command)) return 'high';
return 'medium';
```

**It never returns `low`.** For shell commands the only two outcomes are `high` and
`medium`. Consequences:

- The `SHELL_LOW` startup grant is unreachable dead weight for the shell path, since
  nothing is ever classified `low`.
- `RISK_LEVELS.LOW` exists in `SecurityValidator.js` and `low` is handled throughout
  `checkShellPermission` and `PermissionStore`, but the shell classifier never emits it.

So "low risk" is not a shell tier today. It is a tier the code is written to support
and nothing populates.

Separately, `SecurityValidator.validateCommand` rejects outright when the first word is
in `BLOCKED_COMMANDS` — `{ sudo, su, passwd, chgrp, rm }` — by throwing before any risk
tier is consulted. `rm` is in that set. It is also present in
`HIGH_RISK_FILE_COMMANDS` and matched by a destructive pattern, so `rm` appears in all
three lists; in practice the block wins and `rm` never reaches the tier logic. This is
the source of the documentation contradiction where `rm` is described as both blocked
and approval-gated.

The commands named in the task, at their actual tier today:

| Command | Tier today | Can it modify files / reach the network / run other apps |
| --- | --- | --- |
| `ls`, `cat`, `pwd`, `echo` | medium | read-only, or writes to stdout |
| `find` | medium | read-only; `find … -delete` and `-exec rm` raise it to `high` |
| `grep` | medium | read-only |
| `cp` | medium | **writes files** |
| `mv` | medium | **writes files** |
| `mkdir` | medium | **writes the filesystem** |
| `chmod` | **high** (destructive pattern) | **changes permissions** |
| `npm` | medium | **`npm install` runs installers and reaches the network** |
| `git` | medium | **`git clone` reaches the network and writes** |
| `curl` | medium | **reaches the network, writes files with `-o`** |
| `wget` | medium | **reaches the network and writes** |
| `osascript` | medium | **scripts other applications** |

Combined with the `SHELL_MEDIUM` startup grant from §4, each of the bolded rows
currently executes without a prompt. The classifier offers no tier in which a
network-capable or script-capable command is "low", because "low" is unreachable.

---

## 6. Where "Allow Always" is stored, and what it keys on

Two independent stores, both keyed on the **first word only**.

**Session grants — `PermissionStore`, checked by `checkShellPermission`:**

```
const firstWord = (command || '').trim().split(/\s+/)[0].toLowerCase();
const cmdKey = `SHELL_CMD:${firstWord}`;
```

Answering "Always" once for any `curl` invocation grants the key `SHELL_CMD:curl`,
which then satisfies every later `curl` regardless of its arguments, for as long as the
grant lives.

**Persisted settings — `PermissionStore.autoApprovedCommands`, checked by
`canAutoExecute`:**

```
_normalizeCommand(command) {
  if (!command) return '';
  return command.trim().split(/\s+/)[0].toLowerCase();
}
```

The set is loaded from `settings.autoApprovedCommands` on `PermissionStore.load`, with
each entry lower-cased, and written back on save. Same first-word granularity, and this
one **persists across restarts**.

Both are arbitrary strings from the command line, so neither distinguishes
`ls -la` from `ls /etc/shadow`, nor `curl https://example.com` from a URL that writes
a file over a local path. This is the concrete defect behind "Allow Always" being
coarser than the UI implies.

---

## Summary of what Part A changes, and why each is justified

| # | Finding | Evidence | Change |
| --- | --- | --- | --- |
| 1 | MCP bridge binds all interfaces | `BrowserMcpServer.start`, `listen(port)` with no host | bind `127.0.0.1`; `remote` opt-in requires a token |
| 2 | No auth on any 3001 route | `BrowserMcpServer.start` request handler | token on every route including `/sse` |
| 3 | `/sse` auto-confirms pairing | `BrowserMcpServer.start`, `/sse` branch | remove; pairing requires a valid token |
| 4 | `Access-Control-Allow-Origin: '*'` | same handler | replaced by an explicit allow-list check on `Origin` |
| 5 | No `Host` validation | same handler | accept only the loopback host and port |
| 6 | Agent API HTTP has no token/Host/Origin check; unknown `x-agent-id` is auto-registered with `defaultTrust` | `AgentApiServer.startHttp`, `resolveAgent` | same three checks; `x-agent-id` stays an identifier only |
| 7 | Native bridge: 40+ unauthenticated routes, loopback-bound | `startNativeMacUiBridge`; the server never reads the token | add token + `Host`/`Origin` checks |
| 7a | **Correction to an earlier draft of row 7.** That draft said the string `X-Aartiq-Native-Token` appears nowhere in the repository. It does: `scripts/aartiq-cli.js` sets it on all three native-bridge calls, and `src/lib/native-panels/ViewModel.swift` and `AppIntents.swift` set it on all eight requests they make. The first version of the gate accepted only `Authorization: Bearer`, `X-Aartiq-Token` and `?token=`, so it answered 401 to the CLI and the macOS native panels. `extractToken` now reads `X-Aartiq-Native-Token` too, and a test reads the shipped clients and asserts every credential header they set is accepted. | `scripts/aartiq-cli.js:288,372,486`; `ViewModel.swift:293,326,336,347`; `AppIntents.swift:802,812` | fixed; see `tests/local-server-auth.test.js` |
| 8 | Startup grants `SHELL_LOW` and `SHELL_MEDIUM` unconditionally | `main.js` `permissionStore.load().then(...)` | removed; replaced by the opt-in `autoApproveLowRiskShell` setting |
| 9 | Grant comment claims no disk persistence; `grant()` calls `_save()` | `PermissionStore.grant` / `_save` | comment corrected |
| 10 | `getShellRisk` never returns `low` | `SecurityValidator.getShellRisk` | per-command tier table in one data file, consumed by classifier and docs |
| 11 | "Allow Always" keys on first word, in two stores | `checkShellPermission`, `PermissionStore._normalizeCommand` | bind to a normalized full pattern; suppress Always for network/script-capable commands |

Items 8 through 11 change user-visible behaviour and are recorded in the release note
per A3. Item 10 introduces a real `low` tier, which means the `SHELL_LOW` path becomes
reachable for the first time — worth stating plainly, because it is the one place where
this work makes the system *more* permissive, and only behind a setting that defaults
to off.

## Items deliberately not fixed here

Written up as issue drafts in `docs-audit/issues/`:

- `allow-always-granularity.md` — full argument-aware policy for "Allow Always".
- `remote-mode-auth-design.md` — how LAN/Tailscale mode should authenticate.
- `wifi-sync-bind-address.md` — WiFi sync binds all interfaces by omission.
- `pdf-sync-bind-address.md` — background service serves on `0.0.0.0`.
- `pairing-token-in-url.md` — the token must travel in the `mcp-remote` URL, which
  means it can land in process arguments and logs.

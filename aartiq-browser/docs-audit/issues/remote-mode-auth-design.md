# Remote / LAN mode authentication design

**Label:** security
**Status:** open — token required, design not settled

## Summary

The MCP browser bridge and the Agent API can be exposed beyond loopback. Remote
mode is off by default, must be set to a real boolean, and requires the same
per-process token as loopback mode. That is a working default, not a finished
design: the remote case is the one where the token matters most and is hardest to
distribute.

Specific gaps.

1. **The token is per-process, so it rotates on every restart.** For a loopback
   client that writes its config each time this is fine. For a phone, another
   machine, or a scheduled client, it means the credential is not stable enough
   to configure once.
2. **The token travels in a URL.** `mcp-remote` accepts only a bare URL, so the
   session token is a query parameter and can land in process arguments and client
   logs. On loopback that is a local concern; in remote mode the client may be
   remote too.
3. **`remoteHosts` is an allow-list of names, and there is no provisioning path.**
   Nothing in the app writes a token to a remote client.
4. **There is no rate limit or lockout on repeated 401s**, so a remote deployment
   gets unlimited guesses at a token that does not expire within the process.

## Affected functions

- `setListenOptions(options)` and `start(port)` — `src/lib/mcp-browser-server.js`
- `resolveBindHost(config)` — `src/lib/local-server-auth.js`
- `checkLocalRequest(req, options)` — same file
- `bindHost(config)` — `src/lib/agent-api/providers.ts`
- `AgentApiServer.startHttp()` — `src/lib/agent-api/server.ts`
- `setListenOptions({ remote, remoteHosts })` call site — `main.js`, at MCP server
  startup

## Suggested fix

Decide the remote credential model before shipping remote mode to anyone.

- **Stable, operator-managed credential.** A token the operator sets, stored in
  the app's settings rather than generated per process, so a client can be
  configured once. Trade-off: it persists on disk and must be rotatable.
- **Pairing, as the name already implies.** A short-lived code, exchanged once
  for a longer-lived per-client credential, so several clients can be revoked
  individually. This matches how the native macOS bridge already issues a token
  and how the WiFi sync pairing flow already presents a code, so there is a
  pattern in the codebase to follow.
- **Bind to a named interface rather than `0.0.0.0`.** `resolveBindHost` accepts
  a `bindHost` override but the config does not currently expose one; binding a
  specific address is easier to reason about than binding everything and filtering.

Add a failed-authentication counter regardless of which model is chosen, and log
repeated rejections the way loopback rejections are logged now.
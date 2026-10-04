# Background task service binds 0.0.0.0

**Label:** security
**Status:** open — bind default fixed (loopback + env opt-in, no wildcard CORS); credential (token / `Host` / `Origin`) still missing

## Summary

The background task service listens on port 3999 and serves on all interfaces.
Two files are involved:

- `src/service/pdf-sync.js` — `this.port = options.port || 3999`, and the server
  is created without a host filter.
- `src/service/service-main.js` — `port: 3999`, with the comment "For serving
  files to mobile".

The stated purpose is serving files to a phone, so a non-loopback bind may well be
intended. The problem is that it is not expressed as a decision: there is no
setting, no host argument, and no note saying which interface it opened. That is
the same shape as the MCP bridge defect fixed in this work, where a wide bind came
from an omitted argument rather than a chosen configuration.

This is a separate Electron app from the main process, so the token in
`src/lib/local-server-auth.js` is not in scope for it as written; applying that
gate means deciding how the service receives the credential.

## Affected code

- `src/service/pdf-sync.js` — port default and server construction
- `src/service/service-main.js` — `port: 3999` configuration

## Suggested fix

- Decide whether the port is meant to be reachable from another device. If not,
  bind loopback and pass an explicit host.
- If it is, make it an explicit setting that defaults to loopback, mirroring
  `resolveBindHost` in `src/lib/local-server-auth.js`.
- Whatever the bind, add the token, `Host` and `Origin` checks this service
  currently lacks. It serves files, so an unauthenticated read is a disclosure
  and not only a state change.
- Document the answer on the security page's network table either way, so the
  published list of listeners matches the code.

## Resolution

**Bind — fixed.** `src/service/service-bind.js` resolves the host:
`127.0.0.1` unless `AARTIQ_SERVICE_HOST` says otherwise, and both
`service-main.js` and `pdf-sync.js` pass it to `listen()`. The wildcard
`Access-Control-Allow-Origin` header is gone — neither listener sends one at
all. The default, the opt-in, and the missing header are pinned by
`tests/network-listener-hardening.test.js`, with the mutation record in
`docs-audit/mutation-check-network-hardening.txt`. The README network table
and the landing SSOT were updated in the same change.

**Token / `Host` / `Origin` — still open.** This service is a separate
Electron app, so the per-process token in `local-server-auth.js` does not
reach it as written. Deciding how it would receive a credential is a
maintainer decision and was not made here.
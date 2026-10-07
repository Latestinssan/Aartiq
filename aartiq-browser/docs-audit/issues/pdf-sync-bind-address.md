# Background task service binds 0.0.0.0

**Label:** security
**Status:** partially resolved — bind fixed (loopback + env opt-in, no wildcard CORS); token and Host checks shipped; explicit `Origin` rejection remains open

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
  lacked. It serves files, so an unauthenticated read is a disclosure
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

**Token / `Host` — fixed.** The service now owns its credential, which was the
open question above: `pdf-sync.js` takes `options.authToken` or
`AARTIQ_PDF_SYNC_TOKEN` (falling back to a generated token for the process) and
requires it on all file endpoints, accepted as `Authorization: Bearer`,
`X-Artiq-Token` or `?token=` and compared in constant time. Requests pass a
Host allow-list first — loopback names plus the resolved service host, 403 on
anything else, 401 on a missing or wrong token. The main process's
`local-server-auth.js` token remains out of scope for this separate app; the
credential is the service's own.

**`Origin` — still open.** There is no explicit request-Origin rejection: the
listener sends no `Access-Control-Allow-Origin` header at all, so a browser
gets no cross-origin read, and non-browser access is gated by Host + token.
Whether a direct foreign-`Origin` request should also be refused is the
maintainer decision this issue was always waiting on.
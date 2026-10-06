# WiFi sync binds all interfaces by omission

**Label:** security
**Status:** resolved — by choice, bounded, and documented

## Summary

*(The original finding, kept verbatim; see Resolution for what has since
changed.)*

`WiFiSyncServer` in `src/lib/WiFiSyncService.ts` creates its WebSocket server with
`new WebSocketServer({ port: this.port })`, passing no host. The `ws` library
therefore binds every interface rather than loopback.

This is the same shape of defect the MCP browser bridge had, and it was fixed
there by passing an explicit host. Here it is by omission rather than by choice,
which makes it easy to miss in review: nothing in the file says the port is
network-exposed.

The function is reached from the desktop app's WiFi sync settings, and the port
also appears in the discovery broadcast, so the socket being on every interface
appears to be intentional for the phone-to-desktop case. That intent is the
question this issue is about.

The server currently has no token, `Host` or `Origin` check of its own, unlike
the listeners changed in this work. The pairing code it presents (`pairingCode`
in `getWifiSyncInfo`, surfaced in `src/components/SyncSettings.tsx`) is a code
shown to the user, and whether it is verified before a connection is accepted is
not established here.

## Affected function

- `WiFiSyncServer` constructor — `src/lib/WiFiSyncService.ts`

## Resolution

The intent question is answered: **LAN exposure is deliberate** — the phone
reaches this socket over the network, and the pairing QR (`getConnectUri()`)
and the UDP discovery broadcast hand out a routable address. Restricting the
bind to loopback by default would break pairing out of the box. What shipped
instead bounds that exposure rather than pretending it away:

1. **The bind choice is explicit and switchable.** The constructor documents
   why all interfaces is the default, and `AARTIQ_WIFI_SYNC_HOST` narrows the
   bind (127.0.0.1 or one interface address) when the exposure is not wanted.
   The README listener table's "no switch to restrict it" claim was wrong even
   before this work — the env var already existed — and has been corrected.

2. **The upgrade is gated, fail closed** (`_isUpgradeAllowed`,
   `verifyClient` in `start()`): an `Origin` that is not one of the app's own
   (the shared allow-list in `src/lib/local-server-auth.js`, so a browser page
   anywhere on the machine is refused; a native phone client sends no Origin)
   or a `Host` header that does not name this machine (DNS-rebinding guard,
   mirroring `checkLocalRequest`, widened for the LAN address the QR uses) is
   rejected with 403 before any socket exists.

3. **The pairing code gates the handshake, tokens gate the rest.** The
   `handshake` route accepts only a matching pairing code or a valid token from
   a trusted device; every other sync route — now including `unpair-device`,
   which could previously be called by any connected socket — sits behind the
   access-token gate in `_handleMessage`'s default branch.

Covered by `tests/wifi-sync-upgrade.test.js` (upgrade matrix over unit and real
sockets, unpair gate) and the docs gate
`tests/docs-listener-claims-match-source.test.js` (M2), which pins the landing
page's description of this listener to the source.

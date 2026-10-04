# WiFi sync binds all interfaces by omission

**Label:** security
**Status:** open

## Summary

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

## Suggested fix

- Pass an explicit host, as `src/lib/local-server-auth.js` does for the other
  listeners: loopback by default, and a named interface when the phone is on the
  same network.
- Reuse `checkLocalRequest` for the `Host` and `Origin` checks. Note that the
  phone is not a browser and sends no `Origin`, so the origin allow-list needs a
  rule for that case rather than a new one.
- Establish and document whether the pairing code gates the connection. If it
  does, say where; if it does not, that is a separate finding.
- Consider whether the device identity carried in the sync messages is verified
  at all, independent of the address the socket is on.
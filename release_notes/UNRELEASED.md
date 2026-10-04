# Unreleased

## Security

### File-sync listeners bind loopback by default

The background task service (3999) and the PDF sync server listened on
`0.0.0.0` with `Access-Control-Allow-Origin: *` and no switch to stop them —
the README said so plainly. Both now listen on `127.0.0.1`. Setting
`AARTIQ_SERVICE_HOST` opts a routable host back in for phone/laptop file
access. Neither listener sends a CORS allow-origin header any more, so a page
open in any browser on the machine cannot read their responses; the mobile
clients are native HTTP clients and never needed it.

WiFi sync (3004) is untouched: it still binds every interface with only the
pairing handshake protecting it. That remains open.

### The agent API and the native bridge no longer share port 46203

Both defaulted to 46203, so whichever started second lost the bind and the
error was logged and swallowed — not visible from outside. The agent API now
defaults to 46204. The native bridge keeps 46203 because the Swift CLI, the
command-line tool and the compiled panel binaries hard-code it. `aartiq-mcp`
also keeps 46203: its BridgeClient calls only the native bridge's
`/native-mac-ui/*` routes.

Both changes are pinned by `tests/network-listener-hardening.test.js`, with
the mutation record in `aartiq-browser/docs-audit/mutation-check-network-hardening.txt`.

## Licensing

### The browser ships Apache-2.0 everywhere

The repository root, the README badge and GitHub's API all reported
Apache-2.0 while `aartiq-browser/LICENSE.txt` was a restrictive EULA — the
file the Windows installer displayed. The EULA is replaced with the same
Apache-2.0 text the root carries, and `package.json` now declares
`"license": "Apache-2.0"`, so installer, manifest and repository agree. The
decision and the full EULA it replaced are recorded in
`aartiq-browser/docs-audit/licence-decision.md`; `docs:check` rule (j) fails
if the copies ever diverge again.

## Changed

### Comet → Aartiq file names

The permission audit trail is `aartiq-audit.jsonl` now; a legacy
`comet-audit.jsonl` is renamed on first load, and an existing
`aartiq-audit.jsonl` is never overwritten. Chat export dialogs default to
`aartiq-chat-<timestamp>.txt` / `.pdf` instead of `comet-chat-*`.

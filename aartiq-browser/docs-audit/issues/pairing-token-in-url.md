# Session token travels in the mcp-remote URL

**Label:** security
**Status:** open — accepted trade-off, not resolved

## Summary

The MCP browser bridge now requires a per-process token on every request. The
Claude Desktop config Aartiq writes uses `mcp-remote`, which accepts only a bare
URL as its argument, so the token has to travel as a query parameter:

```
npx -y mcp-remote@0.1.17 "http://127.0.0.1:3001/sse?token=<token>"
```

A URL is a worse carrier than a header. It can end up in the process argument
list, in the client's own logs, and in anything that records process arguments
on the machine. It is also a token that a user can be asked to paste.

The alternative is not obviously better. `mcp-remote` supports sending headers
through configuration in some setups, but the value it takes from
`claude_desktop_config.json` is a command and an argument list, so there is no
header to set there. Keeping the bridge on a non-loopback address would let a
header work and would be worse.

## Affected code

- `buildMcpSseUrl(port, token)` — `src/lib/mcp-bridge-url.js`
- `extractToken(req, url)` — `src/lib/local-server-auth.js`
- the `auto-configure-claude-mcp` handler — `main.js`
- `inspectMcpSseUrl(url)` — `src/lib/mcp-bridge-url.js`, used to recognise an
  outdated config

## Suggested fix

- Check whether a pinned newer `mcp-remote` accepts headers or an environment
  variable for them. If it does, prefer that carrier and keep the query
  parameter only as a fallback.
- Otherwise, reduce how long the token lives in the URL: the argument list is
  read at process start, but a client that reconnects may re-read or re-log it.
- Scrub the token from the URL after the handshake where the transport allows it,
  so it does not remain in a client's stored connection state.
- Consider a short-lived exchange code in the URL that mints a longer-lived
  in-memory credential, so the value in the process list is not the value that
  keeps working.
- Whichever is chosen, keep `buildMcpSseUrl` the single builder so the config
  writer, the setup screens and the copy button cannot diverge.
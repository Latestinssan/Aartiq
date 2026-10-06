# Session token travels in the mcp-remote URL

**Label:** security
**Status:** resolved — the token rides an Authorization header; the query parameter remains accepted for old configs

## Summary

*(The original finding, kept verbatim; see Resolution for what has since
changed.)*

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

## Resolution

The first item of the suggested fix checked out, so the rest was unnecessary.

The published `mcp-remote@0.1.17` package — the exact version Aartiq pins —
does accept headers: `parseCommandLineArgs` reads `--header "Name:value"`
arguments, and a second pass expands `${VAR}` in each header value from
`process.env`. So the config Aartiq writes now looks like this:

```json
{
  "command": "npx",
  "args": ["-y", "mcp-remote@0.1.17", "http://127.0.0.1:3001/sse",
           "--header", "Authorization:${AARTIQ_MCP_AUTH}"],
  "env": { "AARTIQ_MCP_AUTH": "Bearer <session token>" }
}
```

The token is in the `env` block, never in `args`: it does not enter the
process argument list, and mcp-remote's own pre-expansion log line prints the
`${AARTIQ_MCP_AUTH}` placeholder rather than the value.

- Single builder: `buildMcpRemoteServerConfig(port, token)` in
  `src/lib/mcp-bridge-url.js`, used by the `auto-configure-claude-mcp`
  handler, the MCP settings screen, its copy button and the AI setup guide's
  copy button (which previously passed the *token* as the port —
  `mcpSseUrl(claudeMcpToken)` — and emitted a broken URL; the shared builder
  fixed that divergence too).
- Query parameter kept as a fallback: `extractToken` still reads `?token=`, so
  configs written before this change keep working until they are re-configured.
- Covered by `tests/local-server-auth.test.js`: the built args contain no
  token, the produced header authenticates against the bridge, and a
  token-less config still carries no secret.
/**
 * mcp-bridge-url.js
 *
 * Builds the SSE URL and the stdio-bridge entry a local MCP client connects
 * with.
 *
 * `mcp-remote@0.1.17` — the stdio bridge Claude Desktop spawns — takes a bare
 * URL *and* accepts `--header "Name:value"` arguments, expanding `${VAR}` in a
 * header value from its own environment (verified in the published package:
 * parseCommandLineArgs reads `--header`, then replaces `${...}` from
 * process.env). So the session token travels as an `Authorization` header fed
 * from the config's `env` block and never enters the argument list, where a URL
 * query parameter would end up in process listings and client logs.
 *
 * Configs written before this existed carry `?token=` in the URL; the bridge
 * still accepts that carrier (extractToken reads headers first, then the query
 * parameter), so upgrading breaks nothing — re-running Auto-Configure migrates
 * a config to the header. Tracked in docs-audit/issues/pairing-token-in-url.md.
 *
 * One place builds the URL and the config entry so the writer, the setup
 * screens and the copy button cannot disagree.
 */

const MCP_REMOTE_SPEC = 'mcp-remote@0.1.17';

/** Env name whose placeholder mcp-remote expands inside the header value. */
const MCP_REMOTE_AUTH_ENV = 'AARTIQ_MCP_AUTH';

/**
 * The SSE endpoint, optionally with the legacy `?token=` carrier.
 *
 * New configs use buildMcpRemoteServerConfig (header carrier); the query
 * parameter remains accepted for configs written before that.
 *
 * @param {number|string} port
 * @param {string|null|undefined} [token]
 * @returns {string}
 */
function buildMcpSseUrl(port, token) {
  const base = `http://127.0.0.1:${port}/sse`;
  if (!token) return base;
  return `${base}?token=${encodeURIComponent(token)}`;
}

/**
 * The `aartiq-browser` entry for claude_desktop_config.json — also what the
 * setup screens render and their copy buttons put on the clipboard: a
 * token-free URL plus an Authorization header whose value comes from the env
 * block, so no secret appears in `args`.
 *
 * mcp-remote turns the args entry into `Authorization: <env value>` before any
 * request, so the value must be a complete header value — `Bearer <token>`.
 *
 * @param {number|string} port
 * @param {string|null|undefined} [token] session token; omitted when unknown
 * @returns {{ command: string, args: string[], env?: Record<string, string> }}
 */
function buildMcpRemoteServerConfig(port, token) {
  const config = {
    command: 'npx',
    args: [
      '-y',
      MCP_REMOTE_SPEC,
      buildMcpSseUrl(port),
      '--header',
      'Authorization:${' + MCP_REMOTE_AUTH_ENV + '}',
    ],
  };
  if (token) {
    config.env = { [MCP_REMOTE_AUTH_ENV]: `Bearer ${token}` };
  }
  return config;
}

/**
 * Whether a config URL points at this bridge *and* carries a token.
 *
 * Used by the setup screens to explain a config that stopped working after an
 * upgrade: an old config still names the right port but has no token, so the
 * bridge answers 401 and the client reports a connection failure with nothing
 * more specific.
 *
 * @param {string} url
 * @returns {{ pointsAtBridge: boolean, carriesToken: boolean }}
 */
function inspectMcpSseUrl(url) {
  const value = typeof url === 'string' ? url : '';
  const pointsAtBridge = /^https?:\/\/127\.0\.0\.1:\d+\/sse(\?|$)/i.test(value);
  const carriesToken = /[?&]token=[^&]+/i.test(value);
  return { pointsAtBridge, carriesToken };
}

module.exports = {
  MCP_REMOTE_SPEC,
  MCP_REMOTE_AUTH_ENV,
  buildMcpSseUrl,
  buildMcpRemoteServerConfig,
  inspectMcpSseUrl,
};

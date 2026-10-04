/**
 * mcp-bridge-url.js
 *
 * Builds the SSE URL a local MCP client has to connect to.
 *
 * The token is a query parameter rather than a header because `mcp-remote` — the
 * stdio bridge Claude Desktop uses — takes a bare URL and nothing else. That is
 * a real trade-off: a URL can land in process arguments and in client logs. It
 * is tracked in docs-audit/issues/pairing-token-in-url.md, and the alternative
 * (a loopback-only bind) is not sufficient on its own because any page in any
 * browser on the machine can reach 127.0.0.1.
 *
 * One place builds this string so the config Aartiq writes, the config the setup
 * screen shows, and the config the copy button produces cannot disagree.
 */

/**
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

module.exports = { buildMcpSseUrl, inspectMcpSseUrl };
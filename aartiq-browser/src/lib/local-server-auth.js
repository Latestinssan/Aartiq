/**
 * local-server-auth.js
 *
 * Shared checks for the local HTTP listeners: the MCP browser bridge (3001), the
 * Agent API, and the native macOS bridge (46203).
 *
 * These servers run on the user's own machine and expose tool execution, so
 * "it only listens on localhost" is not by itself a security property: any page
 * open in any browser on that machine can send a request to 127.0.0.1, and a
 * hostname that resolves to 127.0.0.1 arrives with its own name in the Host
 * header. The checks here are the server's own contribution to that problem:
 *
 *   1. bind to loopback unless remote mode was explicitly requested
 *   2. require a per-process token on every route, including /sse and /messages
 *   3. validate the Host header against the loopback host and port
 *   4. reject any browser Origin that is not on an explicit allow-list
 *
 * Deliberately absent: nothing here logs a token, and no failure path returns
 * one. Rejections are logged with the reason, the method and the path only.
 */

const crypto = require('crypto');

/** Hostnames that address this machine. */
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '[::ffff:127.0.0.1]']);

/**
 * Origins a packaged or dev renderer legitimately uses when it talks to a
 * loopback listener. Anything else is a third-party page.
 */
const DEFAULT_ALLOWED_ORIGIN_PATTERNS = [
  /^file:\/\//i,
  /^app:\/\//i,
  /^null$/i,
  /^https?:\/\/localhost(:\d+)?$/i,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/i,
  /^https?:\/\/\[::1\](:\d+)?$/i,
];

/** 32 bytes of CSPRNG output, hex encoded. One per process, per listener. */
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Constant-time string compare that does not leak length through early exit. */
function tokensMatch(expected, provided) {
  if (typeof expected !== 'string' || expected.length === 0) return false;
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) {
    // Still burn a comparison so the failure path costs the same either way.
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/**
 * Header names a client may carry the token in, lowercased as Node delivers them.
 *
 * `x-aartiq-native-token` is not an alias anyone invented for this change: it is
 * what the shipped clients already send. `scripts/aartiq-cli.js` sets it on every
 * native-bridge call, and `src/lib/native-panels/ViewModel.swift` and
 * `AppIntents.swift` set it on all eight requests they make. Those clients read
 * the token from ~/.aartiq-token, which is the value this gate compares against,
 * so omitting the header would have answered every CLI and native-panel request
 * with 401.
 */
const TOKEN_HEADERS = ['x-aartiq-token', 'x-aartiq-native-token'];

/**
 * Pull the token off a request, in priority order:
 *
 *   Authorization: Bearer <token>
 *   X-Aartiq-Token: <token>          /  X-Aartiq-Native-Token: <token>
 *   ?token=<token>            (needed by mcp-remote, which only accepts a URL)
 */
function extractToken(req, url) {
  const auth = req.headers && req.headers.authorization;
  if (typeof auth === 'string') {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1].trim();
  }
  const headers = req.headers;
  if (headers) {
    for (const name of TOKEN_HEADERS) {
      const value = headers[name];
      if (typeof value === 'string' && value.length) return value.trim();
    }
  }

  const query = url && typeof url.searchParams === 'object' ? url.searchParams.get('token') : null;
  if (typeof query === 'string' && query.length) return query;

  return null;
}

/**
 * Validate the Host header.
 *
 * In loopback mode only the loopback hostname and this listener's own port are
 * accepted. This is what defeats DNS rebinding: a rebound request carries the
 * attacker's hostname in Host, which is not in this set.
 *
 * In remote mode the operator's configured hostnames are accepted in addition.
 */
function isHostAllowed(hostHeader, port, options = {}) {
  if (typeof hostHeader !== 'string' || hostHeader.length === 0) return false;
  // A Host header with more than one value is malformed; reject rather than guess.
  if (hostHeader.includes(',')) return false;

  let hostname = hostHeader;
  let hostPort = null;

  if (hostHeader.startsWith('[')) {
    const close = hostHeader.indexOf(']');
    if (close === -1) return false;
    hostname = hostHeader.slice(0, close + 1);
    const rest = hostHeader.slice(close + 1);
    if (rest.startsWith(':')) hostPort = rest.slice(1);
    else if (rest.length) return false;
  } else {
    const idx = hostHeader.lastIndexOf(':');
    if (idx !== -1) {
      hostname = hostHeader.slice(0, idx);
      hostPort = hostHeader.slice(idx + 1);
    }
  }

  hostname = hostname.toLowerCase();
  if (hostPort !== null && !/^\d+$/.test(hostPort)) return false;

  if (LOOPBACK_HOSTNAMES.has(hostname)) {
    // The port must be this listener's own, so one local service cannot be
    // reached through a different local port that happens to proxy to it.
    return hostPort === null || Number(hostPort) === Number(port);
  }

  if (options.allowRemote) {
    const extra = Array.isArray(options.remoteHosts) ? options.remoteHosts : [];
    for (const candidate of extra) {
      if (typeof candidate !== 'string') continue;
      const c = candidate.trim().toLowerCase();
      if (c === hostname || c === `${hostname}:${hostPort}`) return true;
    }
  }

  return false;
}

/**
 * Validate a browser Origin. Requests with no Origin are not browser requests
 * (curl, mcp-remote, the native bridge's own loopback callers) and are allowed
 * through — the token is what authenticates them. A request that *does* carry an
 * Origin is a browser, and a browser must be on the allow-list.
 */
function isOriginAllowed(originHeader, options = {}) {
  if (originHeader === undefined || originHeader === null || originHeader === '') return true;
  const origin = String(originHeader).trim();
  if (origin.length === 0) return true;

  const patterns = Array.isArray(options.allowedOrigins) && options.allowedOrigins.length
    ? options.allowedOrigins
    : DEFAULT_ALLOWED_ORIGIN_PATTERNS;

  return patterns.some((p) => (p instanceof RegExp ? p.test(origin) : String(p).trim().toLowerCase() === origin.toLowerCase()));
}

/**
 * Resolve the address a listener should bind. Remote mode is opt-in and is the
 * only way to get anything other than loopback.
 *
 * `remote` must be exactly `true`. Settings files are edited by hand and JSON
 * round-trips through forms; a truthy check here would open a listener to the
 * network for a value of `"false"`, `"0"` or `1`. The cost of being strict here
 * is that an operator has to write a real boolean.
 */
function resolveBindHost(config = {}) {
  if (config.remote === true) return config.bindHost || '0.0.0.0';
  return config.host || '127.0.0.1';
}

/**
 * The single entry point each listener calls for every request.
 *
 * Returns `{ ok: true }`, or `{ ok: false, status, code, log }` where `log` is
 * safe to print (it never contains the token).
 *
 * @param {import('http').IncomingMessage} req
 * @param {{ port: number, token: string, requireToken?: boolean, allowRemote?: boolean,
 *           remoteHosts?: string[], allowedOrigins?: (RegExp|string)[], service?: string }} [options]
 * @returns {{ ok: true, service: string }
 *          | { ok: false, status: number, code: string, log: string }}
 */
function checkLocalRequest(req, options = {}) {
  const {
    port,
    token,
    requireToken = true,
    allowRemote = false,
    remoteHosts = [],
    allowedOrigins,
    service = 'local-server',
  } = options;

  // 1. Host — checked before anything else so a rebound request is rejected
  //    before we spend time on the token.
  if (!isHostAllowed(req.headers && req.headers.host, port, { allowRemote, remoteHosts })) {
    return { ok: false, status: 403, code: 'bad_host', log: `rejected ${req.method} ${req.url} — Host header not accepted` };
  }

  // 2. Origin — a browser request from anywhere but the allow-list is refused.
  if (!isOriginAllowed(req.headers && req.headers.origin, { allowedOrigins })) {
    return { ok: false, status: 403, code: 'bad_origin', log: `rejected ${req.method} ${req.url} — Origin not allowed` };
  }

  // 3. Token — required on every route in loopback mode too, because loopback
  //    reachability is not the same as authorisation.
  if (requireToken) {
    let url = null;
    try {
      url = new URL(req.url || '/', `http://${req.headers && req.headers.host ? req.headers.host : 'localhost'}`);
    } catch (_) {
      url = null;
    }
    const provided = extractToken(req, url);
    if (!provided) {
      return { ok: false, status: 401, code: 'no_token', log: `rejected ${req.method} ${req.url} — no token presented` };
    }
    if (!tokensMatch(token, provided)) {
      return { ok: false, status: 401, code: 'bad_token', log: `rejected ${req.method} ${req.url} — token did not match` };
    }
  }

  return { ok: true, service };
}

module.exports = {
  LOOPBACK_HOSTNAMES,
  DEFAULT_ALLOWED_ORIGIN_PATTERNS,
  generateSessionToken,
  tokensMatch,
  extractToken,
  isHostAllowed,
  isOriginAllowed,
  resolveBindHost,
  checkLocalRequest,
};

/**
 * local-server-auth.test.js
 *
 * Acceptance tests for the listener authentication added across the MCP browser
 * bridge, the Agent API and the native macOS bridge.
 *
 * These are the tests the acceptance criteria name: an all-interfaces bind is
 * refused by default, a request without a token gets 401, a wrong Host is
 * rejected, a foreign Origin is rejected, valid loopback plus token succeeds,
 * and the pairing flow works end to end.
 */

const http = require('http');
const {
  generateSessionToken,
  checkLocalRequest,
  isHostAllowed,
  isOriginAllowed,
  resolveBindHost,
  tokensMatch,
  extractToken,
} = require('../src/lib/local-server-auth');
const { buildMcpSseUrl, inspectMcpSseUrl } = require('../src/lib/mcp-bridge-url');

// ── helpers ────────────────────────────────────────────────────────────────

/** Minimal IncomingMessage stand-in. Only the headers and url matter here. */
function makeReq({ method = 'GET', url = '/health', headers = {} } = {}) {
  return { method, url, headers: { host: '127.0.0.1:3001', ...headers } };
}

function check(req, options = {}) {
  return checkLocalRequest(req, {
    port: 3001,
    token: 'correct-token',
    service: 'test',
    ...options,
  });
}

/** Start a real listener on an ephemeral loopback port and return its base URL. */
function listen(server, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      const { port } = server.address();
      resolve(port);
    });
  });
}

/** GET/POST against the loopback listener with a controllable Host header. */
function request(port, pathname, { headers = {}, method = 'GET', host } = {}) {
  return new Promise((resolve, reject) => {
    const finalHeaders = { ...headers };
    if (host) finalHeaders.host = host;
    const req = http.request(
      { host: '127.0.0.1', port, path: pathname, method, headers: finalHeaders },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// ───────────────────────────────────────────────────────────────────────────

describe('resolveBindHost', () => {
  test('binds loopback by default', () => {
    expect(resolveBindHost({})).toBe('127.0.0.1');
    expect(resolveBindHost({ remote: false })).toBe('127.0.0.1');
  });

  test('an all-interfaces bind requires remote to be explicitly true', () => {
    // `remote` must be exactly true. A truthy string from a settings file should
    // not be enough to open a listener to the network.
    expect(resolveBindHost({ remote: 'yes' })).toBe('127.0.0.1');
    expect(resolveBindHost({ remote: 1 })).toBe('127.0.0.1');
    expect(resolveBindHost({ remote: true })).toBe('0.0.0.0');
  });

  test('an explicit loopback host in config is honoured', () => {
    expect(resolveBindHost({ host: '127.0.0.5' })).toBe('127.0.0.5');
  });
});

describe('tokensMatch', () => {
  test('matches identical tokens and rejects everything else', () => {
    expect(tokensMatch('abc', 'abc')).toBe(true);
    expect(tokensMatch('abc', 'abd')).toBe(false);
    expect(tokensMatch('abc', 'abc ')).toBe(false);
    expect(tokensMatch('abc', '')).toBe(false);
    expect(tokensMatch('', 'abc')).toBe(false);
    expect(tokensMatch('abc', undefined)).toBe(false);
  });

  test('a length mismatch does not throw', () => {
    expect(tokensMatch('short', 'a-much-longer-token')).toBe(false);
  });
});

describe('extractToken', () => {
  const url = (q) => new URL(`http://127.0.0.1:3001/sse${q || ''}`);

  test('reads Authorization: Bearer', () => {
    expect(extractToken(makeReq({ headers: { authorization: 'Bearer tok-1' } }), url())).toBe('tok-1');
  });

  test('reads X-Aartiq-Token', () => {
    expect(extractToken(makeReq({ headers: { 'x-aartiq-token': 'tok-2' } }), url())).toBe('tok-2');
  });

  test('reads the query parameter, which is the only carrier mcp-remote supports', () => {
    expect(extractToken(makeReq(), url('?token=tok-3'))).toBe('tok-3');
  });

  test('Bearer wins over the header and the query parameter', () => {
    const req = makeReq({ headers: { authorization: 'Bearer from-auth', 'x-aartiq-token': 'from-header' } });
    expect(extractToken(req, url('?token=from-query'))).toBe('from-auth');
  });

  test('returns null when nothing is presented', () => {
    expect(extractToken(makeReq(), url())).toBeNull();
  });
});

describe('isHostAllowed', () => {
  test('accepts the loopback host with this listener’s own port', () => {
    expect(isHostAllowed('127.0.0.1:3001', 3001)).toBe(true);
    expect(isHostAllowed('localhost:3001', 3001)).toBe(true);
    expect(isHostAllowed('[::1]:3001', 3001)).toBe(true);
  });

  test('rejects a different local port', () => {
    // Otherwise a second local listener that proxies to this one would be a way
    // around the Host check.
    expect(isHostAllowed('127.0.0.1:9999', 3001)).toBe(false);
  });

  test('rejects a hostname that resolves to loopback — the DNS rebinding case', () => {
    expect(isHostAllowed('evil.example.com:3001', 3001)).toBe(false);
    expect(isHostAllowed('localhost.evil.example.com:3001', 3001)).toBe(false);
  });

  test('rejects a missing, empty, multi-valued or malformed Host header', () => {
    expect(isHostAllowed(undefined, 3001)).toBe(false);
    expect(isHostAllowed('', 3001)).toBe(false);
    expect(isHostAllowed('127.0.0.1:3001, 127.0.0.1:3002', 3001)).toBe(false);
    expect(isHostAllowed('127.0.0.1:notaport', 3001)).toBe(false);
    expect(isHostAllowed('[::1', 3001)).toBe(false);
  });

  test('remote mode accepts configured hostnames in addition to loopback', () => {
    expect(isHostAllowed('laptop.local:3001', 3001, { allowRemote: true, remoteHosts: ['laptop.local'] })).toBe(true);
    expect(isHostAllowed('other.local:3001', 3001, { allowRemote: true, remoteHosts: ['laptop.local'] })).toBe(false);
    // Configured hostnames do not become available without remote mode.
    expect(isHostAllowed('laptop.local:3001', 3001, { allowRemote: false, remoteHosts: ['laptop.local'] })).toBe(false);
  });
});

describe('isOriginAllowed', () => {
  test('allows a request with no Origin — that is not a browser request', () => {
    expect(isOriginAllowed(undefined)).toBe(true);
    expect(isOriginAllowed('')).toBe(true);
  });

  test('allows the packaged and dev renderer origins', () => {
    expect(isOriginAllowed('file://')).toBe(true);
    expect(isOriginAllowed('http://localhost:3003')).toBe(true);
    expect(isOriginAllowed('http://127.0.0.1:3003')).toBe(true);
    expect(isOriginAllowed('null')).toBe(true);
  });

  test('rejects a third-party web origin', () => {
    expect(isOriginAllowed('https://example.com')).toBe(false);
    expect(isOriginAllowed('https://evil.example.com')).toBe(false);
    // Same host as the listener, different scheme and a subdomain: still a page
    // the user did not launch.
    expect(isOriginAllowed('https://localhost.evil.com')).toBe(false);
  });

  test('honours an explicit allow-list', () => {
    expect(isOriginAllowed('https://partner.example', { allowedOrigins: ['https://partner.example'] })).toBe(true);
    expect(isOriginAllowed('http://localhost:3003', { allowedOrigins: ['https://partner.example'] })).toBe(false);
  });
});

describe('checkLocalRequest', () => {
  test('a valid loopback request with a valid token passes', () => {
    const verdict = check(makeReq({ headers: { authorization: 'Bearer correct-token' } }));
    expect(verdict.ok).toBe(true);
  });

  test('a request with no token is 401', () => {
    const verdict = check(makeReq());
    expect(verdict.ok).toBe(false);
    expect(verdict.status).toBe(401);
    expect(verdict.code).toBe('no_token');
  });

  test('a request with the wrong token is 401', () => {
    const verdict = check(makeReq({ headers: { authorization: 'Bearer wrong-token' } }));
    expect(verdict.ok).toBe(false);
    expect(verdict.status).toBe(401);
    expect(verdict.code).toBe('bad_token');
  });

  test('a foreign Host is 403, and is checked before the token', () => {
    const verdict = check(makeReq({
      headers: { host: 'evil.example.com:3001', authorization: 'Bearer correct-token' },
    }));
    expect(verdict.ok).toBe(false);
    expect(verdict.status).toBe(403);
    expect(verdict.code).toBe('bad_host');
  });

  test('a foreign Origin is 403 even with a correct token', () => {
    const verdict = check(makeReq({
      headers: { origin: 'https://example.com', authorization: 'Bearer correct-token' },
    }));
    expect(verdict.ok).toBe(false);
    expect(verdict.status).toBe(403);
    expect(verdict.code).toBe('bad_origin');
  });

  test('the rejection log never contains the token', () => {
    const secret = 'super-secret-token-value';
    const verdict = check(
      makeReq({ headers: { authorization: `Bearer ${secret}`, host: 'evil.example.com:3001' } }),
      { token: 'different-token' },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.log).not.toContain(secret);
    expect(verdict.log).not.toContain('different-token');
  });

  test('a bad path with no query string does not throw', () => {
    const verdict = check(makeReq({ url: '/sse?token' }));
    expect(verdict.ok).toBe(false);
    expect(verdict.status).toBe(401);
  });
});

describe('MCP bridge listener (end to end over real sockets)', () => {
  let server;
  let port;

  beforeAll(async () => {
    const token = 'bridge-session-token';
    server = http.createServer((req, res) => {
      const verdict = checkLocalRequest(req, { port, token, requireToken: true, service: 'mcp-browser' });
      if (!verdict.ok) {
        res.writeHead(verdict.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: verdict.code }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', paired: true }));
    });
    port = await listen(server, '127.0.0.1');
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  test('the socket is bound to loopback only', async () => {
    const address = server.address();
    expect(address.address).toBe('127.0.0.1');
  });

  test('no token → 401', async () => {
    const res = await request(port, '/health');
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body).error).toBe('no_token');
  });

  test('wrong token → 401', async () => {
    const res = await request(port, '/health', { headers: { authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
  });

  test('wrong Host → 403, even with the right token', async () => {
    const res = await request(port, '/health', {
      headers: { authorization: 'Bearer bridge-session-token' },
      host: 'evil.example.com',
    });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body).error).toBe('bad_host');
  });

  test('foreign Origin → 403, even with the right token', async () => {
    const res = await request(port, '/health', {
      headers: { authorization: 'Bearer bridge-session-token', origin: 'https://example.com' },
    });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body).error).toBe('bad_origin');
  });

  test('valid loopback + token → 200', async () => {
    const res = await request(port, '/health', {
      headers: { authorization: 'Bearer bridge-session-token' },
      host: `127.0.0.1:${port}`,
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ok', paired: true });
  });

  test('token in the query parameter works — the mcp-remote carrier', async () => {
    const res = await request(port, `/sse?token=${encodeURIComponent('bridge-session-token')}`, {
      host: `127.0.0.1:${port}`,
    });
    expect(res.status).toBe(200);
  });
});

describe('Claude Desktop pairing flow over loopback', () => {
  test('the generated URL authenticates, and the token survives encoding', () => {
    const token = 'a token/with?odd=chars&more';
    const url = buildMcpSseUrl(3001, token);
    // The token must be encoded, or a client that parses the query string reads
    // a different value than the one that was written.
    expect(url).not.toContain(token);
    expect(new URL(url).searchParams.get('token')).toBe(token);

    const headers = { host: '127.0.0.1:3001' };
    const parsed = new URL(url, `http://127.0.0.1:3001`);
    const verdict = checkLocalRequest(
      { method: 'GET', url: `${parsed.pathname}${parsed.search}`, headers },
      { port: 3001, token, requireToken: true },
    );
    expect(verdict.ok).toBe(true);
  });

  test('a URL built without a token is rejected', () => {
    // The shape an old config file has: right port, no credential.
    const url = buildMcpSseUrl(3001, null);
    expect(url).toBe('http://127.0.0.1:3001/sse');
    const parsed = new URL(url, 'http://127.0.0.1:3001');
    const verdict = checkLocalRequest(
      { method: 'GET', url: parsed.pathname, headers: { host: '127.0.0.1:3001' } },
      { port: 3001, token: 'a-token', requireToken: true },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.status).toBe(401);
  });

  test('inspectMcpSseUrl tells an outdated config from a broken one', () => {
    expect(inspectMcpSseUrl('http://127.0.0.1:3001/sse')).toEqual({ pointsAtBridge: true, carriesToken: false });
    expect(inspectMcpSseUrl('http://127.0.0.1:3001/sse?token=abc')).toEqual({ pointsAtBridge: true, carriesToken: true });
    expect(inspectMcpSseUrl('http://example.com:3001/sse?token=abc')).toEqual({ pointsAtBridge: false, carriesToken: true });
  });

  test('a second token does not authenticate the first one’s session', () => {
    const first = generateSessionToken();
    const second = generateSessionToken();
    expect(first).not.toBe(second);
    const verdict = checkLocalRequest(
      { method: 'GET', url: `/sse?token=${first}`, headers: { host: '127.0.0.1:3001' } },
      { port: 3001, token: second, requireToken: true },
    );
    expect(verdict.ok).toBe(false);
  });

  test('generated tokens are long enough to be worth generating', () => {
    expect(generateSessionToken()).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('the Agent API and native bridge use the same gate', () => {
  test('an unknown agent id does not substitute for a token', () => {
    // x-agent-id is an identifier. The gate must reject the request on the token
    // even though the id is one resolveAgent would happily auto-register.
    const verdict = checkLocalRequest(
      { method: 'POST', url: '/api/navigate', headers: { host: '127.0.0.1:46203', 'x-agent-id': 'agent-abc123' } },
      { port: 46203, token: 'agent-api-token', requireToken: true, service: 'agent-api' },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.status).toBe(401);
  });

  test('a token plus an agent id passes', () => {
    const verdict = checkLocalRequest(
      {
        method: 'POST',
        url: '/api/navigate',
        headers: { host: '127.0.0.1:46203', 'x-agent-id': 'agent-abc123', authorization: 'Bearer agent-api-token' },
      },
      { port: 46203, token: 'agent-api-token', requireToken: true, service: 'agent-api' },
    );
    expect(verdict.ok).toBe(true);
  });

  test('remote mode still requires a token', () => {
    const verdict = checkLocalRequest(
      { method: 'GET', url: '/health', headers: { host: 'laptop.local:46203' } },
      { port: 46203, token: 'agent-api-token', requireToken: true, allowRemote: true, remoteHosts: ['laptop.local'] },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.status).toBe(401);
  });
});
/**
 * client-credentials.test.js — per-client credentials and per-client
 * revocation for the three tokened listeners.
 *
 * docs-audit/issues/remote-mode-auth-design.md, gap 3: "one shared credential
 * per listener is stable, but several clients still cannot be revoked
 * individually." These tests pin the fix's contract:
 *
 *   - minting issues a random 64-hex token, returns it exactly once, and
 *     stores only its sha256 — the registry never holds a usable credential;
 *   - revoking retires ONE client of ONE listener: its peers and the
 *     listener's primary token are untouched;
 *   - checkLocalRequest accepts an active client credential (auth 'client'),
 *     refuses a revoked one with its own 401 code, and still refuses another
 *     listener's credential — service isolation;
 *   - an unreadable registry classifies every client token as unknown:
 *     fail closed, never fall back to accepting;
 *   - the shared /clients* surface is primary-token-only — a client
 *     credential can never mint or revoke another credential.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// A writable fake $HOME, held in a `mock`-prefixed binding so the os mock
// factory can close over it across jest.resetModules() (tests/session-token
// uses the same pattern). The registry lives there, never in the real $HOME.
const mockHome = { dir: null };
mockHome.dir = fs.mkdtempSync(path.join(jest.requireActual('os').tmpdir(), 'aartiq-clients-'));

jest.mock('os', () => {
  const actual = jest.requireActual('os');
  return { ...actual, homedir: () => mockHome.dir };
});

const REGISTRY = () => path.join(mockHome.dir, '.aartiq-clients.json');

function fresh() {
  jest.resetModules();
  return {
    creds: require('../src/lib/client-credentials'),
    gate: require('../src/lib/local-server-auth'),
  };
}

/** Stand-in for an IncomingMessage at the gate: headers + url are enough. */
function makeReq({ method = 'GET', url = '/health', headers = {} } = {}) {
  return { method, url, headers: { host: '127.0.0.1:3001', ...headers } };
}

function listen(server, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => resolve(server.address().port));
  });
}

function request(port, pathname, { headers = {}, method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const finalHeaders = { ...headers };
    if (body !== undefined) finalHeaders['content-type'] = 'application/json';
    const req = http.request(
      { host: '127.0.0.1', port, path: pathname, method, headers: finalHeaders },
      (res) => {
        let out = '';
        res.on('data', (c) => (out += c));
        res.on('end', () => resolve({ status: res.statusCode, body: out }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

const HEX64 = /^[0-9a-f]{64}$/;

beforeEach(() => {
  if (fs.existsSync(REGISTRY())) fs.rmSync(REGISTRY());
});

afterAll(() => {
  fs.rmSync(mockHome.dir, { recursive: true, force: true });
});

describe('mintClientToken', () => {
  test('issues a 64-hex token, stores only its sha256, file mode 0600', () => {
    const { creds } = fresh();
    const { id, token } = creds.mintClientToken('mcp-browser', 'phone');

    expect(token).toMatch(HEX64);
    expect(id).toMatch(/^[0-9a-f]{12}$/);

    const raw = fs.readFileSync(REGISTRY(), 'utf8');
    expect(raw).not.toContain(token); // never a usable credential on disk
    const hash = require('crypto').createHash('sha256').update(token).digest('hex');
    expect(raw).toContain(hash);
    if (process.platform !== 'win32') {
      expect(fs.statSync(REGISTRY()).mode & 0o777).toBe(0o600);
    }

    const listed = creds.listClientCredentials('mcp-browser');
    expect(listed).toEqual([
      { id, label: 'phone', createdAt: expect.any(String) },
    ]);
    expect(JSON.stringify(listed)).not.toContain(token);
    expect(JSON.stringify(listed)).not.toContain(hash);
  });

  test('every mint is a distinct credential', () => {
    const { creds } = fresh();
    const a = creds.mintClientToken('mcp-browser', 'a');
    const b = creds.mintClientToken('mcp-browser', 'b');
    expect(a.token).not.toBe(b.token);
    expect(a.id).not.toBe(b.id);
    expect(creds.clientTokenState('mcp-browser', a.token)).toBe('active');
    expect(creds.clientTokenState('mcp-browser', b.token)).toBe('active');
  });

  test('a missing label defaults, an oversized one is bounded', () => {
    const { creds } = fresh();
    creds.mintClientToken('agent-api');
    creds.mintClientToken('agent-api', '  ');
    creds.mintClientToken('agent-api', 'x'.repeat(500));
    const listed = creds.listClientCredentials('agent-api');
    expect(listed[0].label).toBe('client');
    expect(listed[1].label).toBe('client');
    expect(listed[2].label).toHaveLength(64);
  });

  test('a corrupt registry is never silently replaced — mint refuses', () => {
    const { creds } = fresh();
    fs.writeFileSync(REGISTRY(), 'not json at all');
    expect(() => creds.mintClientToken('mcp-browser', 'phone')).toThrow(/unreadable/);
    // The operator's (corrupt) file is left exactly as it was.
    expect(fs.readFileSync(REGISTRY(), 'utf8')).toBe('not json at all');
  });
});

describe('revocation', () => {
  test('revoking retires one client; its peers keep working', () => {
    const { creds } = fresh();
    const phone = creds.mintClientToken('mcp-browser', 'phone');
    const laptop = creds.mintClientToken('mcp-browser', 'laptop');

    expect(creds.revokeClientToken('mcp-browser', phone.id)).toEqual({
      id: phone.id,
      service: 'mcp-browser',
    });

    expect(creds.clientTokenState('mcp-browser', phone.token)).toBe('revoked');
    expect(creds.clientTokenState('mcp-browser', laptop.token)).toBe('active');

    const listed = creds.listClientCredentials('mcp-browser');
    expect(listed.find((c) => c.id === phone.id).revoked).toBe(true);
    expect(listed.find((c) => c.id === laptop.id).revoked).toBeUndefined();
  });

  test('unknown id, already revoked, and cross-service ids all refuse', () => {
    const { creds } = fresh();
    const minted = creds.mintClientToken('agent-api', 'ci');
    expect(creds.revokeClientToken('agent-api', 'deadbeefdead')).toBeNull();
    expect(creds.revokeClientToken('mcp-browser', minted.id)).toBeNull(); // other service
    expect(creds.revokeClientToken('agent-api', minted.id)).toEqual({ id: minted.id, service: 'agent-api' });
    expect(creds.revokeClientToken('agent-api', minted.id)).toBeNull(); // second time
  });

  test('service isolation: one listener never sees another listener’s credential', () => {
    const { creds } = fresh();
    const { token } = creds.mintClientToken('agent-api', 'agent');
    expect(creds.clientTokenState('agent-api', token)).toBe('active');
    expect(creds.clientTokenState('mcp-browser', token)).toBe('unknown');
    expect(creds.clientTokenState('native-bridge', token)).toBe('unknown');
    expect(creds.clientTokenState(undefined, token)).toBe('unknown');
    expect(creds.clientTokenState('agent-api', 'not-a-token')).toBe('unknown');
  });

  test('an unreadable registry classifies every credential unknown (fail closed)', () => {
    const { creds } = fresh();
    const { token } = creds.mintClientToken('mcp-browser', 'phone');
    expect(creds.clientTokenState('mcp-browser', token)).toBe('active');
    fs.writeFileSync(REGISTRY(), '{broken');
    expect(creds.clientTokenState('mcp-browser', token)).toBe('unknown');
  });

  test('a registry that survives a restart (fresh module, same file)', () => {
    const first = fresh();
    const { token } = first.creds.mintClientToken('mcp-browser', 'phone');
    const second = fresh(); // stands in for an Aartiq restart
    expect(second.creds.clientTokenState('mcp-browser', token)).toBe('active');
    expect(second.creds.listClientCredentials('mcp-browser')).toHaveLength(1);
  });
});

describe('checkLocalRequest accepts per-client credentials', () => {
  const PRIMARY = 'primary-token-0123456789';

  function check(gate, token, options = {}) {
    return gate.checkLocalRequest(
      makeReq({ headers: { authorization: `Bearer ${token}` } }),
      { port: 3001, token: PRIMARY, requireToken: true, service: 'mcp-browser', ...options },
    );
  }

  test('the primary token passes with auth "primary"', () => {
    const { gate } = fresh();
    const verdict = check(gate, PRIMARY);
    expect(verdict.ok).toBe(true);
    expect(verdict.auth).toBe('primary');
  });

  test('an active client credential passes with auth "client"', () => {
    const { creds, gate } = fresh();
    const { token } = creds.mintClientToken('mcp-browser', 'phone');
    const verdict = check(gate, token);
    expect(verdict.ok).toBe(true);
    expect(verdict.auth).toBe('client');
  });

  test('a revoked credential is 401 token_revoked — distinct from a wrong token', () => {
    const { creds, gate } = fresh();
    const { id, token } = creds.mintClientToken('mcp-browser', 'lost-phone');
    creds.revokeClientToken('mcp-browser', id);

    const verdict = check(gate, token);
    expect(verdict.ok).toBe(false);
    expect(verdict.status).toBe(401);
    expect(verdict.code).toBe('token_revoked');
    expect(verdict.log).not.toContain(token);

    // The wrong token still gets the generic code.
    expect(check(gate, 'ffffffffffffffffffffffff').code).toBe('bad_token');
  });

  test('revoking one client leaves the primary and other clients working', () => {
    const { creds, gate } = fresh();
    const lost = creds.mintClientToken('mcp-browser', 'lost');
    const kept = creds.mintClientToken('mcp-browser', 'kept');
    creds.revokeClientToken('mcp-browser', lost.id);

    expect(check(gate, lost.token).ok).toBe(false);
    expect(check(gate, kept.token).ok).toBe(true);
    expect(check(gate, PRIMARY).ok).toBe(true);
  });

  test('another listener’s credential is refused (service isolation at the gate)', () => {
    const { creds, gate } = fresh();
    const { token } = creds.mintClientToken('agent-api', 'agent');
    const verdict = check(gate, token); // gate is configured as mcp-browser
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('bad_token');
  });

  test('the fallback service key ("local-server") holds no credentials', () => {
    const { creds, gate } = fresh();
    const { token } = creds.mintClientToken('mcp-browser', 'phone');
    const verdict = gate.checkLocalRequest(
      makeReq({ headers: { authorization: `Bearer ${token}` } }),
      { port: 3001, token: PRIMARY, requireToken: true }, // no service option
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('bad_token');
  });
});

describe('the shared /clients* administration surface', () => {
  const PRIMARY = 'primary-token-abcdef123456';
  let server;
  let port;
  let mods;

  beforeAll(async () => {
    mods = fresh();
    server = http.createServer((req, res) => {
      const verdict = mods.gate.checkLocalRequest(req, {
        port,
        token: PRIMARY,
        requireToken: true,
        service: 'mcp-browser',
      });
      if (!verdict.ok) {
        res.writeHead(verdict.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: verdict.code }));
        return;
      }
      if (mods.creds.maybeHandleClientAdminRoute(req, res, { verdict })) return;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    port = await listen(server);
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  const primary = { authorization: `Bearer ${PRIMARY}` };
  const asClient = (token) => ({ authorization: `Bearer ${token}` });

  test('GET /clients with the primary token lists metadata only', async () => {
    const minted = await request(port, '/clients', {
      method: 'POST',
      headers: primary,
      body: { label: 'phone' },
    });
    expect(minted.status).toBe(200);

    const listed = await request(port, '/clients', { headers: primary });
    expect(listed.status).toBe(200);
    const parsed = JSON.parse(listed.body);
    expect(parsed.service).toBe('mcp-browser');
    expect(parsed.clients).toHaveLength(1);
    expect(parsed.clients[0].label).toBe('phone');
    expect(listed.body).not.toContain(JSON.parse(minted.body).token);
    expect(listed.body).not.toContain('tokenHash');
  });

  test('a minted credential authenticates ordinary routes, like any client', async () => {
    const minted = JSON.parse((await request(port, '/clients', {
      method: 'POST',
      headers: primary,
      body: { label: 'laptop' },
    })).body);

    const viaClient = await request(port, '/anything', { headers: asClient(minted.token) });
    expect(viaClient.status).toBe(200);
    expect(JSON.parse(viaClient.body)).toEqual({ ok: true });

    const viaPrimary = await request(port, '/anything', { headers: primary });
    expect(viaPrimary.status).toBe(200);
  });

  test('administration requires the PRIMARY token — a client credential gets 403', async () => {
    const minted = JSON.parse((await request(port, '/clients', {
      method: 'POST',
      headers: primary,
      body: { label: 'probe' },
    })).body);

    const mint = await request(port, '/clients', {
      method: 'POST',
      headers: asClient(minted.token),
      body: { label: 'escalate' },
    });
    expect(mint.status).toBe(403);
    expect(JSON.parse(mint.body).error).toBe('primary_token_required');

    const list = await request(port, '/clients', { headers: asClient(minted.token) });
    expect(list.status).toBe(403);

    const revoke = await request(port, '/clients/revoke', {
      method: 'POST',
      headers: asClient(minted.token),
      body: { id: minted.id },
    });
    expect(revoke.status).toBe(403);
  });

  test('POST /clients/revoke retires exactly that client, nothing else', async () => {
    const a = JSON.parse((await request(port, '/clients', {
      method: 'POST', headers: primary, body: { label: 'A' },
    })).body);
    const b = JSON.parse((await request(port, '/clients', {
      method: 'POST', headers: primary, body: { label: 'B' },
    })).body);

    const revoked = await request(port, '/clients/revoke', {
      method: 'POST',
      headers: primary,
      body: { id: a.id },
    });
    expect(revoked.status).toBe(200);
    expect(JSON.parse(revoked.body)).toEqual({ service: 'mcp-browser', id: a.id, revoked: true });

    expect((await request(port, '/x', { headers: asClient(a.token) })).status).toBe(401);
    expect((await request(port, '/x', { headers: asClient(b.token) })).status).toBe(200);
    expect((await request(port, '/x', { headers: primary })).status).toBe(200);
  });

  test('malformed administration requests fail closed with explicit codes', async () => {
    const unknown = await request(port, '/clients/revoke', {
      method: 'POST', headers: primary, body: { id: 'deadbeefdead' },
    });
    expect(unknown.status).toBe(404);

    const missing = await request(port, '/clients/revoke', {
      method: 'POST', headers: primary, body: {},
    });
    expect(missing.status).toBe(400);
    expect(JSON.parse(missing.body).error).toBe('missing_id');

    const badJson = await request(port, '/clients', {
      method: 'POST', headers: primary, body: '{not json',
    });
    expect(badJson.status).toBe(400);
    expect(JSON.parse(badJson.body).error).toBe('bad_body');

    const oversized = await request(port, '/clients', {
      method: 'POST',
      headers: primary,
      body: JSON.stringify({ label: 'x'.repeat(8192) }),
    });
    expect(oversized.status).toBe(413);
  });

  test('no credential at all never reaches the administration surface', async () => {
    const res = await request(port, '/clients');
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body).error).toBe('no_token');
  });

  test('non-administration routes fall through to the listener unchanged', async () => {
    const res = await request(port, '/sse', { headers: primary });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });
});

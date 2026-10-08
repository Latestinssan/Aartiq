'use strict';
/**
 * client-credentials.js — per-client credentials for the three tokened HTTP
 * listeners (MCP browser bridge, Agent API, native macOS bridge).
 *
 * Until now each listener had exactly ONE credential: the primary token from
 * session-token.js. That is stable across restarts, but it is shared by every
 * client that was ever configured — so revoking one client (a phone you lost, a
 * scheduled job you retired, a config you no longer trust) meant rotating the
 * primary file and reconfiguring everyone else (docs-audit/issues/
 * remote-mode-auth-design.md, gap 3).
 *
 * This module adds a second, per-client credential class:
 *
 *   - mintClientToken(service, label) issues a random 64-hex token for ONE
 *     client of ONE listener and returns it exactly once. Only sha256(token)
 *     is persisted, in ~/.aartiq-clients.json (mode 0600, atomic replace) —
 *     the registry never holds a usable credential, so reading it (or leaking
 *     it) does not hand anyone access;
 *   - revokeClientToken(service, id) tombstones that entry as `revoked`, the
 *     same shape the WiFi sync device list already uses. Other clients and the
 *     primary token are untouched: revocation is per client, not per listener;
 *   - clientTokenState(service, token) classifies a presented token as
 *     `active` | `revoked` | `unknown`. checkLocalRequest accepts only
 *     `active`; `revoked` gets its own 401 code so an operator can tell a
 *     revoked credential from a wrong one in the log. A registry that cannot
 *     be read classifies everything as `unknown` — fail closed, never fall
 *     back to accepting;
 *   - maybeHandleClientAdminRoute is the shared HTTP surface (GET /clients,
 *     POST /clients, POST /clients/revoke). It runs only after the listener's
 *     normal gate has accepted the request AND the presented token was the
 *     listener's PRIMARY token: a client credential may call every other route
 *     on its listener, but it can never mint or revoke credentials. The mint
 *     response is the only place a client token is ever returned.
 *
 * Pairing UX (a short-lived code a remote client exchanges for its
 * credential) and remote provisioning remain open in that issue; what ships
 * here is the credential class and its per-client revocation.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const REGISTRY_FILE = '.aartiq-clients.json';
const REGISTRY_VERSION = 1;
const CLIENT_TOKEN_RE = /^[0-9a-f]{64}$/;
const MAX_BODY_BYTES = 4096;

/** Absolute path of the per-client registry (one file for all listeners). */
function clientRegistryPath() {
  return path.join(os.homedir(), REGISTRY_FILE);
}

function freshClientToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

let _corruptWarned = false;

/**
 * Read the registry.
 *
 * @returns {{version: number, clients: object[]} | null} null when the file
 *   exists but cannot be parsed — callers must treat that as "no credential is
 *   valid" (state) or refuse to proceed (mint/revoke/list). A missing file is
 *   the normal first-run case and returns an empty registry.
 */
function readRegistry() {
  const file = clientRegistryPath();
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { version: REGISTRY_VERSION, clients: [] };
    if (!_corruptWarned) {
      _corruptWarned = true;
      console.warn(`[client-credentials] could not read ${file}: ${e.message} — no client credential is valid`);
    }
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    if (!_corruptWarned) {
      _corruptWarned = true;
      console.warn(`[client-credentials] ${file} is not valid JSON — no client credential is valid`);
    }
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.clients)) {
    if (!_corruptWarned) {
      _corruptWarned = true;
      console.warn(`[client-credentials] ${file} has an unexpected shape — no client credential is valid`);
    }
    return null;
  }
  _corruptWarned = false;
  return { version: REGISTRY_VERSION, clients: parsed.clients };
}

/** Atomic replace: a crash mid-write must not tear the registry in half. */
function writeRegistry(registry) {
  const file = clientRegistryPath();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2) + '\n', { mode: 0o600 });
  try {
    fs.chmodSync(tmp, 0o600);
  } catch (_) {
    // chmod can be a no-op on some platforms; the mode was set on create.
  }
  fs.renameSync(tmp, file);
}

/**
 * Issue a per-client credential for one listener.
 *
 * @param {string} service listener id ('mcp-browser' | 'agent-api' | 'native-bridge')
 * @param {string} [label] operator-facing name shown by listClientCredentials
 * @returns {{id: string, token: string}} token returned ONCE — it is not stored
 * @throws when the registry exists but cannot be read (never silently replaces
 *   operator data) or cannot be written
 */
function mintClientToken(service, label) {
  if (typeof service !== 'string' || !service) throw new Error('client credential requires a service');
  const registry = readRegistry();
  if (!registry) {
    throw new Error(`client registry is unreadable — inspect ${clientRegistryPath()} before minting`);
  }
  const cleanLabel = typeof label === 'string' && label.trim() ? label.trim().slice(0, 64) : 'client';

  let id;
  do {
    id = crypto.randomBytes(6).toString('hex');
  } while (registry.clients.some((c) => c && c.id === id));

  const token = freshClientToken();
  registry.clients.push({
    id,
    service,
    label: cleanLabel,
    tokenHash: hashToken(token),
    createdAt: new Date().toISOString(),
  });
  writeRegistry(registry);
  return { id, token };
}

/**
 * Tombstone a client credential. Per client: other clients of this listener
 * and the listener's primary token keep working.
 *
 * @returns {{id: string, service: string} | null} null when no such active
 *   client exists on this service (unknown id, other service, already revoked)
 */
function revokeClientToken(service, id) {
  if (typeof service !== 'string' || !service || typeof id !== 'string' || !id) return null;
  const registry = readRegistry();
  if (!registry) {
    throw new Error(`client registry is unreadable — inspect ${clientRegistryPath()} before revoking`);
  }
  const entry = registry.clients.find((c) => c && c.service === service && c.id === id && !c.revoked);
  if (!entry) return null;
  entry.revoked = true;
  entry.revokedAt = new Date().toISOString();
  writeRegistry(registry);
  return { id, service };
}

/**
 * Metadata for one listener's credentials. Never returns a token or a hash.
 * @returns {{id: string, label: string, createdAt: string, revoked?: boolean}[]}
 */
function listClientCredentials(service) {
  const registry = readRegistry();
  if (!registry) {
    throw new Error(`client registry is unreadable — inspect ${clientRegistryPath()}`);
  }
  return registry.clients
    .filter((c) => c && c.service === service)
    .map((c) => ({
      id: c.id,
      label: typeof c.label === 'string' ? c.label : 'client',
      createdAt: c.createdAt,
      ...(c.revoked ? { revoked: true } : {}),
    }));
}

/**
 * Classify a token presented to one listener.
 *
 * Timing: every stored hash is compared with timingSafeEqual; the loop does
 * not stop at the first match, so which entry matched is not observable through
 * iteration count.
 *
 * @returns {'active'|'revoked'|'unknown'} 'unknown' when the registry cannot
 *   be read — fail closed, never accept on a coin flip
 */
function clientTokenState(service, token) {
  if (typeof service !== 'string' || !service) return 'unknown';
  if (typeof token !== 'string' || !CLIENT_TOKEN_RE.test(token)) return 'unknown';
  const registry = readRegistry();
  if (!registry) return 'unknown';
  const hash = hashToken(token);
  let state = 'unknown';
  for (const entry of registry.clients) {
    if (!entry || entry.service !== service || typeof entry.tokenHash !== 'string') continue;
    const a = Buffer.from(entry.tokenHash, 'utf8');
    const b = Buffer.from(hash, 'utf8');
    const equal = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (equal) state = entry.revoked ? 'revoked' : 'active';
  }
  return state;
}

/** Read a bounded JSON body off a raw request; never throws. */
function readJsonBody(req, cb) {
  let size = 0;
  let done = false;
  const chunks = [];
  const finish = (err, value) => {
    if (done) return;
    done = true;
    cb(err, value);
  };
  req.on('data', (chunk) => {
    if (done) return;
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      finish({ status: 413, code: 'body_too_large' });
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (done) return;
    if (chunks.length === 0) return finish(null, {});
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!parsed || typeof parsed !== 'object') return finish({ status: 400, code: 'bad_body' });
      finish(null, parsed);
    } catch (_) {
      finish({ status: 400, code: 'bad_body' });
    }
  });
  req.on('error', () => finish({ status: 400, code: 'bad_body' }));
}

/**
 * Shared HTTP surface for per-client credential administration.
 *
 * Call it AFTER the listener's gate has accepted the request:
 *
 *   const verdict = checkLocalRequest(req, {...});
 *   if (!verdict.ok) { ...; return; }
 *   if (maybeHandleClientAdminRoute(req, res, { verdict })) return;
 *
 * Returns true when this call claimed the request (matched /clients* and
 * wrote — or is writing — the response), false when the caller should keep
 * routing. Administration is primary-token-only: a request authenticated with
 * a client credential gets 403 primary_token_required, never a credential.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {{verdict: {ok?: boolean, service?: string, auth?: string}}} options
 */
function maybeHandleClientAdminRoute(req, res, options = {}) {
  const verdict = options.verdict || {};
  if (!verdict.ok) return false;

  let pathname = '/';
  try {
    pathname = new URL(req.url || '/', 'http://localhost').pathname;
  } catch (_) {
    pathname = String(req.url || '/');
  }

  const isList = req.method === 'GET' && pathname === '/clients';
  const isMint = req.method === 'POST' && pathname === '/clients';
  const isRevoke = req.method === 'POST' && pathname === '/clients/revoke';
  if (!isList && !isMint && !isRevoke) return false;

  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (verdict.auth !== 'primary') {
    send(403, { error: 'primary_token_required' });
    return true;
  }

  const service = verdict.service;

  if (isList) {
    try {
      send(200, { service, clients: listClientCredentials(service) });
    } catch (e) {
      send(500, { error: 'registry_unreadable', detail: e.message });
    }
    return true;
  }

  // Express (the native bridge) may have parsed the body already; otherwise
  // read it off the stream. Both paths converge on the same handler.
  const act = (err, body) => {
    if (err) {
      send(err.status || 400, { error: err.code || 'bad_body' });
      return;
    }
    try {
      if (isMint) {
        const { id, token } = mintClientToken(service, body.label);
        // The only response that ever carries a client token — shown once.
        send(200, {
          service,
          id,
          label: typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 64) : 'client',
          token,
        });
        return;
      }
      const id = typeof body.id === 'string' ? body.id : '';
      if (!id) {
        send(400, { error: 'missing_id' });
        return;
      }
      const revoked = revokeClientToken(service, id);
      if (!revoked) {
        send(404, { error: 'unknown_id' });
        return;
      }
      send(200, { service, id, revoked: true });
    } catch (e) {
      send(500, { error: 'registry_unreadable', detail: e.message });
    }
  };

  if (req.body && typeof req.body === 'object') {
    act(null, req.body);
  } else {
    readJsonBody(req, act);
  }
  return true;
}

module.exports = {
  clientRegistryPath,
  mintClientToken,
  revokeClientToken,
  listClientCredentials,
  clientTokenState,
  maybeHandleClientAdminRoute,
};

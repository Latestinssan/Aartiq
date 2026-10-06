'use strict';
/**
 * session-token.js — stable credentials for Aartiq's HTTP listeners.
 *
 * Two tokens used to be generated per process: the MCP browser bridge's session
 * token and the Agent API's. Both end up in client configuration (the Claude
 * Desktop config the auto-configurer writes, a phone or scheduled agent's
 * header), so a fresh value on every restart made "configure once" impossible —
 * the documented work-around was to re-run Auto-Configure after every restart
 * (README known limits; docs-audit/issues/remote-mode-auth-design.md, gap 1).
 *
 * Each listener now reads-or-creates its own file in $HOME, mode 0600:
 *
 *   ~/.aartiq-mcp-token     MCP browser bridge (port 3001)
 *   ~/.aartiq-agent-token   Agent API (port 46204)
 *   ~/.aartiq-token         native macOS bridge / CLI (the file it always used;
 *                           it used to be overwritten with a fresh value on
 *                           every start instead of read back)
 *
 * Rotation is an operator action: delete the file and restart Aartiq (or call
 * rotateSessionToken()). The value is still generated server-side whenever the
 * file is absent or unreadable — `POST /pairing/token` reports the token in
 * use, it never lets a caller choose it.
 *
 * If $HOME is unwritable (sandbox, read-only mount), the token falls back to
 * the old session-scoped behaviour instead of failing listener startup.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TOKEN_FILES = {
  mcp: '.aartiq-mcp-token',
  agent: '.aartiq-agent-token',
  cli: '.aartiq-token', // native bridge / aartiq-cli — the pre-existing path
};

/**
 * randomBytes(32).toString('hex'). The cli file predates this module and held
 * randomBytes(24) (48 hex), written by both main.js and `regenerate-cli-token`
 * — accept that too so a legacy or regenerated file is kept, not replaced.
 */
const TOKEN_RE = /^(?:[0-9a-f]{48}|[0-9a-f]{64})$/;

/**
 * Absolute path of the token file for a listener kind.
 * @param {'mcp'|'agent'} kind
 */
function sessionTokenPath(kind) {
  const file = TOKEN_FILES[kind];
  if (!file) {
    throw new Error(`unknown session token kind: ${kind}`);
  }
  return path.join(os.homedir(), file);
}

function freshToken() {
  return crypto.randomBytes(32).toString('hex');
}

function writeTokenFile(filePath, token) {
  fs.writeFileSync(filePath, token, { mode: 0o600 });
  // writeFileSync only applies the mode when it creates the file; make sure an
  // existing file (or a umask-narrowed create) ends up 0600 too.
  try {
    fs.chmodSync(filePath, 0o600);
  } catch (_) {
    // chmod is a no-op/EPERM on some platforms; the write already succeeded.
  }
}

/**
 * The listener's token: the persisted one, or a newly generated token that is
 * persisted (or, if it cannot be persisted, kept for this process only).
 * Never throws.
 *
 * @param {'mcp'|'agent'} kind
 * @returns {string} 64 hex chars
 */
function loadOrCreateSessionToken(kind) {
  const filePath = sessionTokenPath(kind);
  try {
    if (fs.existsSync(filePath)) {
      const current = fs.readFileSync(filePath, 'utf8').trim();
      if (TOKEN_RE.test(current)) {
        return current;
      }
      console.warn(`[session-token] ${filePath} does not hold a valid token — replacing it`);
    }
  } catch (e) {
    console.warn(`[session-token] could not read ${filePath}: ${e.message}`);
  }

  const token = freshToken();
  try {
    writeTokenFile(filePath, token);
  } catch (e) {
    console.warn(
      `[session-token] could not persist ${filePath}: ${e.message} — token is valid until Aartiq exits`
    );
  }
  return token;
}

/**
 * Issue a new token for a listener and persist it. Callers that surface the
 * value (Auto-Configure, get-cli-token-style IPC) must re-read it afterwards.
 * Throws if the file cannot be written — callers surface that to the operator.
 *
 * @param {'mcp'|'agent'} kind
 * @returns {string} the rotated token
 */
function rotateSessionToken(kind) {
  const filePath = sessionTokenPath(kind);
  const token = freshToken();
  writeTokenFile(filePath, token);
  return token;
}

module.exports = {
  TOKEN_FILES,
  sessionTokenPath,
  loadOrCreateSessionToken,
  rotateSessionToken,
};

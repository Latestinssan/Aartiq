/**
 * local-server-auth-lockout.test.js — failed-authentication accounting.
 *
 * docs-audit/issues/remote-mode-auth-design.md: "no rate limit or lockout on
 * repeated 401s, so a remote deployment gets unlimited guesses at a token that
 * does not expire."
 *
 * The token is 256 bits, so guessing is infeasible anyway; the counter makes
 * the attempts observable (one log line per address per window) and stops a
 * non-loopback address from retrying at all. Loopback never locks: its failure
 * mode is a stale local client config, and locking 127.0.0.1 would turn that
 * into a self-inflicted DoS.
 */

const {
  checkLocalRequest,
  AUTH_FAILURE_LIMIT_LOCAL,
  AUTH_FAILURE_LIMIT_REMOTE: REMOTE_LIMIT,
  AUTH_LOCKOUT_MS,
  resetFailedAuthCounters,
} = require('../src/lib/local-server-auth');

const REMOTE_IP = '203.0.113.7';

/** IncomingMessage stand-in with a controllable socket address. */
function makeReq(remoteAddress, authorization) {
  return {
    method: 'GET',
    url: '/health',
    headers: { host: '127.0.0.1:3001', authorization },
    socket: { remoteAddress },
  };
}

function check(req) {
  return checkLocalRequest(req, {
    port: 3001,
    token: 'correct-token',
    service: 'test',
  });
}

const wrong = (ip) => check(makeReq(ip, 'Bearer wrong-token'));
const right = (ip) => check(makeReq(ip, 'Bearer correct-token'));

beforeEach(() => {
  resetFailedAuthCounters();
  jest.restoreAllMocks();
});

describe('remote addresses are counted and then locked', () => {
  test('after the limit, even the correct token is refused with 429', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    for (let i = 0; i < REMOTE_LIMIT; i++) {
      expect(wrong(REMOTE_IP).status).toBe(401);
    }

    // One log line naming the address — the observable half of the fix.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/203\.0\.113\.7/);

    const locked = right(REMOTE_IP);
    expect(locked.status).toBe(429);
    expect(locked.code).toBe('auth_locked');

    // A different address is untouched by someone else's failures.
    expect(right('203.0.113.8').ok).toBe(true);
  });

  test('the lock expires and a successful auth clears the history', () => {
    let now = Date.now();
    const dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (let i = 0; i < REMOTE_LIMIT; i++) wrong(REMOTE_IP);
      expect(right(REMOTE_IP).status).toBe(429);

      // Lockout window passes: the address is admitted again.
      now += AUTH_LOCKOUT_MS + 1;
      expect(right(REMOTE_IP).ok).toBe(true);

      // A success cleared the record, so the next streak starts from zero —
      // 19 more failures do not lock (they would have on top of the old 20).
      for (let i = 0; i < 19; i++) expect(wrong(REMOTE_IP).status).toBe(401);
      expect(right(REMOTE_IP).ok).toBe(true);
    } finally {
      dateSpy.mockRestore();
      warn.mockRestore();
    }
  });

  test('IPv4-mapped IPv6 and plain IPv4 for the same client share one counter', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 10; i++) wrong(`::ffff:${REMOTE_IP}`);
    for (let i = 0; i < 10; i++) wrong(REMOTE_IP);
    expect(right(REMOTE_IP).status).toBe(429);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('loopback never locks', () => {
  test('a stale local config keeps getting honest 401s; the threshold is only logged', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    for (let i = 0; i < AUTH_FAILURE_LIMIT_LOCAL + 5; i++) {
      expect(wrong('127.0.0.1').status).toBe(401);
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/127\.0\.0\.1/);

    // The moment the config is fixed, the correct token is accepted.
    expect(right('127.0.0.1').ok).toBe(true);
    warn.mockRestore();
  });

  test('a request with no socket (unit stand-in) is treated as local', () => {
    const bare = { method: 'GET', url: '/health', headers: { host: '127.0.0.1:3001', authorization: 'Bearer wrong' } };
    for (let i = 0; i < AUTH_FAILURE_LIMIT_LOCAL + 1; i++) {
      expect(check(bare).status).toBe(401);
    }
    expect(check({ ...bare, headers: { host: '127.0.0.1:3001', authorization: 'Bearer correct-token' } }).ok).toBe(true);
  });
});

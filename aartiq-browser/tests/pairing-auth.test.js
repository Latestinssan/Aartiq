/**
 * pairing-auth.test.js — Master-key signal authentication for the Firebase
 * P2P bridge (desktop side).
 *
 * Both devices on the same Google account share pairing/{uid}/masterKey.
 * Every signal carries auth = sha256(masterKey + ':' + timestamp); receivers
 * fail closed when the key or the signature is missing/mismatched, and the
 * timestamp window bounds replay.
 */

const {
  computeSignalAuth,
  verifySignalAuth,
  AUTH_WINDOW_MS,
} = require('../src/lib/pairing-auth');

describe('pairing-auth (master key signal auth)', () => {
  const key = 'a'.repeat(64);
  const now = 1_700_000_000_000;

  it('computes a deterministic sha256 signature', () => {
    const sig = computeSignalAuth(key, now);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(computeSignalAuth(key, now)).toBe(sig);
    // Different timestamp or key → different signature
    expect(computeSignalAuth(key, now + 1)).not.toBe(sig);
    expect(computeSignalAuth('b'.repeat(64), now)).not.toBe(sig);
  });

  it('accepts a signature produced with the same key', () => {
    const auth = computeSignalAuth(key, now);
    expect(verifySignalAuth(key, auth, now, now)).toBe(true);
  });

  it('rejects a signature from a different master key', () => {
    const auth = computeSignalAuth('c'.repeat(64), now);
    expect(verifySignalAuth(key, auth, now, now)).toBe(false);
  });

  it('fails closed on missing key, auth, or timestamp', () => {
    const auth = computeSignalAuth(key, now);
    expect(verifySignalAuth(null, auth, now, now)).toBe(false);
    expect(verifySignalAuth('', auth, now, now)).toBe(false);
    expect(verifySignalAuth(key, null, now, now)).toBe(false);
    expect(verifySignalAuth(key, auth, null, now)).toBe(false);
    expect(verifySignalAuth(key, auth, 'not-a-number', now)).toBe(false);
  });

  it('rejects tampered signatures', () => {
    const auth = computeSignalAuth(key, now);
    const flipped = (auth[0] === '0' ? '1' : '0') + auth.slice(1);
    expect(verifySignalAuth(key, flipped, now, now)).toBe(false);
    expect(verifySignalAuth(key, auth.slice(0, 10), now, now)).toBe(false);
  });

  it('rejects signals outside the replay window', () => {
    const stale = now - AUTH_WINDOW_MS - 1;
    const auth = computeSignalAuth(key, stale);
    expect(verifySignalAuth(key, auth, stale, now)).toBe(false);

    const fresh = now - 1000;
    expect(verifySignalAuth(key, computeSignalAuth(key, fresh), fresh, now)).toBe(true);
  });
});

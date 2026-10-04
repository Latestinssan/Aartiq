// Shared master-key signal authentication for the Firebase P2P bridge.
//
// Both devices signed into the same Google account read the same account
// scoped master key (pairing/{uid}/masterKey). Every WebRTC signal carries
// `auth = sha256(masterKey + ':' + timestamp)` so a device that does not
// hold the same master key cannot inject offers/answers/candidates. The key
// itself never appears in a signal payload (it would end up in RTDB logs).
//
// The Dart twin lives in flutter_browser_app/lib/services/pairing_auth.dart.
'use strict';

const crypto = require('crypto');

/** Signals older (or newer) than this are rejected to bound replay. */
const AUTH_WINDOW_MS = 5 * 60 * 1000;

function computeSignalAuth(masterKey, timestamp) {
    return crypto
        .createHash('sha256')
        .update(`${masterKey}:${timestamp}`)
        .digest('hex');
}

function verifySignalAuth(masterKey, auth, timestamp, now = Date.now()) {
    if (typeof masterKey !== 'string' || masterKey.length === 0) return false;
    if (typeof auth !== 'string' || auth.length === 0) return false;
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return false;
    if (Math.abs(now - timestamp) > AUTH_WINDOW_MS) return false;

    const expected = computeSignalAuth(masterKey, timestamp);
    if (expected.length !== auth.length) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(auth, 'utf8'));
    } catch (_) {
        return false;
    }
}

module.exports = { computeSignalAuth, verifySignalAuth, AUTH_WINDOW_MS };

import 'package:flutter_browser/services/pairing_auth.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const key = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const now = 1700000000000;

  group('computeSignalAuth', () {
    test('is deterministic and hex-encoded sha256', () {
      final sig = computeSignalAuth(key, now);
      expect(RegExp(r'^[0-9a-f]{64}$').hasMatch(sig), isTrue);
      expect(computeSignalAuth(key, now), sig);
    });

    test('changes with timestamp or key', () {
      final sig = computeSignalAuth(key, now);
      expect(computeSignalAuth(key, now + 1), isNot(sig));
      expect(computeSignalAuth('b' * 64, now), isNot(sig));
    });
  });

  group('verifySignalAuth', () {
    final now = DateTime.fromMillisecondsSinceEpoch(1700000000000);

    test('accepts a signature produced with the same key', () {
      final ts = now.millisecondsSinceEpoch;
      final auth = computeSignalAuth(key, ts);
      expect(verifySignalAuth(key, auth, ts, now: now), isTrue);
    });

    test('rejects a signature from a different master key', () {
      final ts = now.millisecondsSinceEpoch;
      final auth = computeSignalAuth('c' * 64, ts);
      expect(verifySignalAuth(key, auth, ts, now: now), isFalse);
    });

    test('fails closed on missing key, auth, or timestamp', () {
      final ts = now.millisecondsSinceEpoch;
      final auth = computeSignalAuth(key, ts);
      expect(verifySignalAuth(null, auth, ts, now: now), isFalse);
      expect(verifySignalAuth('', auth, ts, now: now), isFalse);
      expect(verifySignalAuth(key, null, ts, now: now), isFalse);
      expect(verifySignalAuth(key, auth, null, now: now), isFalse);
      expect(verifySignalAuth(key, auth, 'not-a-number', now: now), isFalse);
    });

    test('rejects tampered signatures', () {
      final ts = now.millisecondsSinceEpoch;
      final auth = computeSignalAuth(key, ts);
      final flipped = (auth[0] == '0' ? '1' : '0') + auth.substring(1);
      expect(verifySignalAuth(key, flipped, ts, now: now), isFalse);
      expect(verifySignalAuth(key, auth.substring(0, 10), ts, now: now),
          isFalse);
    });

    test('rejects signals outside the replay window', () {
      final stale = now.millisecondsSinceEpoch - authWindowMs - 1;
      expect(
          verifySignalAuth(key, computeSignalAuth(key, stale), stale,
              now: now),
          isFalse);

      final fresh = now.millisecondsSinceEpoch - 1000;
      expect(
          verifySignalAuth(key, computeSignalAuth(key, fresh), fresh,
              now: now),
          isTrue);
    });
  });
}

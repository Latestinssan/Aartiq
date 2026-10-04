import 'dart:convert';

import 'package:crypto/crypto.dart';

/// Shared master-key signal authentication for the Firebase P2P bridge.
///
/// Both devices signed into the same Google account read the same
/// account-scoped master key (`pairing/{uid}/masterKey`). Every WebRTC signal
/// carries `auth = sha256(masterKey + ':' + timestamp)` so a device that does
/// not hold the same master key cannot inject offers/answers/candidates. The
/// key itself never appears in a signal payload.
///
/// The JS twin lives in aartiq-browser/src/lib/pairing-auth.js.
const int authWindowMs = 5 * 60 * 1000;

String computeSignalAuth(String masterKey, int timestamp) {
  return sha256.convert(utf8.encode('$masterKey:$timestamp')).toString();
}

bool verifySignalAuth(
  String? masterKey,
  dynamic auth,
  dynamic timestamp, {
  DateTime? now,
}) {
  if (masterKey == null || masterKey.isEmpty) return false;
  if (auth is! String || auth.isEmpty) return false;
  if (timestamp is! int) return false;

  final reference = (now ?? DateTime.now()).millisecondsSinceEpoch;
  if ((reference - timestamp).abs() > authWindowMs) return false;

  return computeSignalAuth(masterKey, timestamp) == auth;
}

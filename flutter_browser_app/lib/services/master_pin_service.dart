import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Stores and verifies the Aartiq Master PIN using PBKDF2-SHA256.
/// The raw PIN NEVER leaves the device — only the hash, its salt and the
/// PBKDF2 cost the hash was derived at travel during pairing.
class MasterPinService {
  static final MasterPinService _instance = MasterPinService._internal();
  factory MasterPinService() => _instance;
  MasterPinService._internal();

  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );
  static const _saltKey = 'aartiq_master_pin_salt';
  static const _hashKey = 'aartiq_master_pin_hash';
  static const _iterationsKey = 'aartiq_master_pin_iterations';
  static const _attemptsKey = 'aartiq_master_pin_attempts';
  static const _lockUntilKey = 'aartiq_master_pin_lock_until';

  static const int _maxAttempts = 5;
  static const int _lockoutMinutes = 10;

  /// PBKDF2 cost for every record created from now on (matches desktop
  /// MasterPINService).
  static const int _iterations = 600000;

  /// Cost of records written before the per-record `_iterationsKey` existed,
  /// and the floor no stored/claimed cost is ever verified below.
  static const int _legacyIterations = 100000;
  static const int _keyLength = 32;

  /// The PBKDF2 cost a record's hash verifies at. Absent, malformed, or
  /// below-legacy claims resolve to the legacy cost and are never honoured
  /// below it: a wrong value can only cause a mismatch (fail closed), never a
  /// cheaper comparison than the legacy one.
  static int _resolveIterations(int? raw) {
    if (raw != null && raw >= _legacyIterations) return raw;
    return _legacyIterations;
  }

  /// Compute PBKDF2-SHA256 hash (matches desktop MasterPINService)
  static String _pbkdf2(String pin, String salt, int iterations) {
    final saltBytes = utf8.encode(salt);
    final pinBytes = utf8.encode(pin);

    // Manual PBKDF2 using dart:crypto Hmac
    final hmacSha256 = Hmac(sha256, pinBytes);

    // Single-block PBKDF2: PRF(password, salt || INT(1)) iterated `iterations` times
    var saltWithBlock = [...saltBytes, 0, 0, 0, 1];
    var u = hmacSha256.convert(saltWithBlock).bytes;
    var result = List<int>.from(u);

    for (int i = 1; i < iterations; i++) {
      u = hmacSha256.convert(u).bytes;
      for (int j = 0; j < result.length; j++) {
        result[j] ^= u[j];
      }
    }
    return result.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  }

  Future<bool> hasPIN() async {
    final salt = await _storage.read(key: _saltKey);
    final hash = await _storage.read(key: _hashKey);
    return salt != null && hash != null && salt.isNotEmpty && hash.isNotEmpty;
  }

  Future<({bool success, String? error})> setupPIN(String pin) async {
    if (pin.length != 6 || !RegExp(r'^\d{6}$').hasMatch(pin)) {
      return (success: false, error: 'Master PIN must be exactly 6 numeric digits');
    }

    // Generate a 16-byte random salt (hex encoded)
    final saltBytes = List<int>.generate(16, (_) => DateTime.now().microsecondsSinceEpoch % 256);
    final salt = saltBytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
    final hash = _pbkdf2(pin, salt, _iterations);

    await _storage.write(key: _saltKey, value: salt);
    await _storage.write(key: _hashKey, value: hash);
    await _storage.write(key: _iterationsKey, value: _iterations.toString());
    await _storage.delete(key: _attemptsKey);
    await _storage.delete(key: _lockUntilKey);
    return (success: true, error: null);
  }

  Future<({bool verified, bool locked, int remainingAttempts, String? error})>
      verifyPIN(String pin) async {
    final salt = await _storage.read(key: _saltKey);
    final storedHash = await _storage.read(key: _hashKey);

    if (salt == null || storedHash == null) {
      return (verified: false, locked: false, remainingAttempts: _maxAttempts, error: 'Master PIN not configured');
    }

    // Check lockout
    final lockUntilStr = await _storage.read(key: _lockUntilKey);
    if (lockUntilStr != null) {
      final lockUntil = DateTime.fromMillisecondsSinceEpoch(int.parse(lockUntilStr));
      if (DateTime.now().isBefore(lockUntil)) {
        final minutesLeft = lockUntil.difference(DateTime.now()).inMinutes + 1;
        return (
          verified: false,
          locked: true,
          remainingAttempts: 0,
          error: 'Too many failed attempts. Try again in $minutesLeft minute(s).',
        );
      }
      // Lockout expired — clear it
      await _storage.delete(key: _lockUntilKey);
      await _storage.write(key: _attemptsKey, value: '0');
    }

    final storedIterationsStr = await _storage.read(key: _iterationsKey);
    final storedIterations = _resolveIterations(int.tryParse(storedIterationsStr ?? ''));
    final enteredHash = _pbkdf2(pin, salt, storedIterations);
    if (enteredHash == storedHash) {
      await _storage.write(key: _attemptsKey, value: '0');
      if (storedIterations < _iterations) {
        // Lazy migration: the plaintext PIN is in hand only here, on a proven
        // match — re-hash records below the target cost now. A wrong PIN
        // never reaches this branch, so legacy records keep verifying at
        // their stored cost until they first prove correct.
        await _storage.write(key: _hashKey, value: _pbkdf2(pin, salt, _iterations));
        await _storage.write(key: _iterationsKey, value: _iterations.toString());
      }
      return (verified: true, locked: false, remainingAttempts: _maxAttempts, error: null);
    } else {
      final attemptsStr = await _storage.read(key: _attemptsKey) ?? '0';
      final attempts = int.parse(attemptsStr) + 1;
      await _storage.write(key: _attemptsKey, value: attempts.toString());

      final remaining = _maxAttempts - attempts;
      if (remaining <= 0) {
        final lockUntil = DateTime.now().add(Duration(minutes: _lockoutMinutes));
        await _storage.write(key: _lockUntilKey, value: lockUntil.millisecondsSinceEpoch.toString());
        return (
          verified: false,
          locked: true,
          remainingAttempts: 0,
          error: 'Account locked for $_lockoutMinutes minutes after $_maxAttempts failed attempts.',
        );
      }

      return (
        verified: false,
        locked: false,
        remainingAttempts: remaining,
        error: 'Incorrect Master PIN. $remaining attempt(s) remaining.',
      );
    }
  }

  /// Verify the PIN entered by the user against a hash+salt received from the desktop during pairing.
  /// This is how mobile confirms it knows the same Master PIN as the desktop.
  /// [remoteIterations] is the PBKDF2 cost the desktop derived its hash at;
  /// senders predating that field hashed at the legacy cost, which is the
  /// fallback.
  Future<({bool verified, String? error})> verifyAgainstRemoteHash(
      String pin, String remoteSalt, String remoteHash,
      [int? remoteIterations]) async {
    if (pin.length != 6 || !RegExp(r'^\d{6}$').hasMatch(pin)) {
      return (verified: false, error: 'Invalid PIN format');
    }
    final iterations = _resolveIterations(remoteIterations);
    final computedHash = _pbkdf2(pin, remoteSalt, iterations);
    if (computedHash == remoteHash) {
      // Store locally so future verifications work offline — at the cost the
      // hash was actually made at (verifyPIN re-hashes to target on unlock).
      await _storage.write(key: _saltKey, value: remoteSalt);
      await _storage.write(key: _hashKey, value: remoteHash);
      await _storage.write(key: _iterationsKey, value: iterations.toString());
      await _storage.delete(key: _attemptsKey);
      await _storage.delete(key: _lockUntilKey);
      return (verified: true, error: null);
    }
    return (verified: false, error: 'PIN does not match the desktop Master PIN');
  }

  Future<({bool success, String? error})> changePIN(String oldPin, String newPin) async {
    final verify = await verifyPIN(oldPin);
    if (!verify.verified) return (success: false, error: verify.error);
    return setupPIN(newPin);
  }

  Future<void> clearPIN() async {
    await _storage.delete(key: _saltKey);
    await _storage.delete(key: _hashKey);
    await _storage.delete(key: _iterationsKey);
    await _storage.delete(key: _attemptsKey);
    await _storage.delete(key: _lockUntilKey);
  }
}

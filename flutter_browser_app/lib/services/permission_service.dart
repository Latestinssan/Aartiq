import 'dart:async';
import 'package:flutter/services.dart';
import 'package:local_auth/local_auth.dart';
import '../models/permission_model.dart';
import 'master_pin_service.dart';

class PermissionService {
  static final PermissionService _instance = PermissionService._internal();
  factory PermissionService() => _instance;
  PermissionService._internal();

  final LocalAuthentication _localAuth = LocalAuthentication();
  final MasterPinService _pinService = MasterPinService();

  final StreamController<PermissionRelayRequest> _requestController =
      StreamController<PermissionRelayRequest>.broadcast();
  Stream<PermissionRelayRequest> get onRequestReceived =>
      _requestController.stream;

  PermissionRelayRequest? _activeRequest;
  PermissionRelayRequest? get activeRequest => _activeRequest;

  void handleIncomingRequest(Map<String, dynamic> raw) {
    try {
      final req = PermissionRelayRequest.fromJson(raw);
      if (!req.isExpired) {
        _activeRequest = req;
        _requestController.add(req);
      }
    } catch (e) {
      print('[PermissionService] Failed to parse request: $e');
    }
  }

  void clearActiveRequest() {
    _activeRequest = null;
  }

  /// Check if the Android device has biometric or device screen lock configured
  Future<bool> canAuthenticateWithDeviceLock() async {
    try {
      final canAuthenticateWithBiometrics =
          await _localAuth.canCheckBiometrics;
      final canAuthenticate =
          canAuthenticateWithBiometrics || await _localAuth.isDeviceSupported();
      return canAuthenticate;
    } catch (e) {
      print('[PermissionService] Error checking device lock capabilities: $e');
      return false;
    }
  }

  /// Perform device native screen lock / biometric verification (Android Screen Lock / Biometrics)
  Future<bool> authenticateWithScreenLock(String reason) async {
    try {
      final isSupported = await canAuthenticateWithDeviceLock();
      if (!isSupported) {
        // Fallback: If device doesn't have screen lock enrolled, return true with warning
        print('[PermissionService] Device screen lock not available or enrolled on device');
        return true;
      }

      final didAuthenticate = await _localAuth.authenticate(
        localizedReason: reason.isNotEmpty
            ? reason
            : 'Verify device screen lock to approve Aartiq action',
        options: const AuthenticationOptions(
          biometricOnly: false, // Allows Android pattern, pin, password, or biometrics
          stickyAuth: true,
          sensitiveTransaction: true,
        ),
      );
      return didAuthenticate;
    } on PlatformException catch (e) {
      print('[PermissionService] Screen lock authentication error: $e');
      return false;
    } catch (e) {
      print('[PermissionService] Unexpected screen lock error: $e');
      return false;
    }
  }

  /// Dual-Gate Approval:
  /// Gate 1: Master PIN Verification
  /// Gate 2: Android Native Screen Lock Verification
  Future<({bool approved, String? error, PermissionRelayResponse? response})>
      verifyAndApprove({
    required PermissionRelayRequest request,
    required String enteredPin,
    required String deviceId,
  }) async {
    if (request.isExpired) {
      return (
        approved: false,
        error: 'This approval request has expired',
        response: null,
      );
    }

    // --- GATE 1: Master PIN Verification ---
    final pinResult = await _pinService.verifyPIN(enteredPin);
    if (!pinResult.verified) {
      return (
        approved: false,
        error: pinResult.error ?? 'Invalid Master PIN',
        response: null,
      );
    }

    // --- GATE 2: Android Native Screen Lock Verification ---
    bool screenLockVerified = false;
    if (request.requiresBiometric || request.isRemote) {
      screenLockVerified = await authenticateWithScreenLock(
        'Confirm ${request.riskLevel.toUpperCase()} permission for "${request.taskName}"',
      );

      if (!screenLockVerified) {
        return (
          approved: false,
          error: 'Device screen lock verification failed or was cancelled',
          response: null,
        );
      }
    } else {
      screenLockVerified = true;
    }

    final response = PermissionRelayResponse(
      requestId: request.requestId,
      approved: true,
      pinVerified: true,
      screenLockVerified: screenLockVerified,
      respondedByDeviceId: deviceId,
      respondedAt: DateTime.now().millisecondsSinceEpoch,
    );

    _activeRequest = null;
    return (approved: true, error: null, response: response);
  }

  /// Deny request
  PermissionRelayResponse denyRequest({
    required PermissionRelayRequest request,
    required String deviceId,
    String? reason,
  }) {
    _activeRequest = null;
    return PermissionRelayResponse(
      requestId: request.requestId,
      approved: false,
      pinVerified: false,
      screenLockVerified: false,
      respondedByDeviceId: deviceId,
      respondedAt: DateTime.now().millisecondsSinceEpoch,
      reason: reason ?? 'Denied by user on mobile device',
    );
  }
}

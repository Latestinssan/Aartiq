import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:firebase_database/firebase_database.dart';
import 'package:flutter/services.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';
import 'package:flutter/material.dart';
import 'main.dart';
import 'models/permission_model.dart';
import 'models/session_model.dart';
import 'services/permission_service.dart';
import 'services/device_info_service.dart';
import 'services/pairing_auth.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'pages/permission_approval_page.dart';

class SyncService {
  static final SyncService _instance = SyncService._internal();
  factory SyncService() => _instance;
  SyncService._internal();

  // Device memory for persistent local devices
  static const String _deviceMemoryKey = 'paired_devices_memory';
  List<Map<String, dynamic>> _savedDevices = [];
  final Set<String> _pendingDiscoveryReconnects = <String>{};

  DatabaseReference? _signalRef;
  StreamSubscription<DatabaseEvent>? _p2pSignalsSubscription;
  String? _pairingMasterKey;
  final List<Map<String, dynamic>> _pendingRemoteCandidates = [];
  RTCPeerConnection? _peerConnection;
  RTCDataChannel? _dataChannel;
  bool isConnected = false;
  String? userId;
  String? deviceId;
  String? remoteDeviceId;

  final StreamController<String> _clipboardController =
      StreamController<String>.broadcast();
  Stream<String> get onClipboardSynced => _clipboardController.stream;

  final StreamController<Map> _historyController =
      StreamController<Map>.broadcast();
  Stream<Map> get onHistorySynced => _historyController.stream;

  Future<void> loadSavedDevices() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final savedJson = prefs.getString(_deviceMemoryKey);
      if (savedJson != null) {
        _savedDevices = List<Map<String, dynamic>>.from(
          (jsonDecode(savedJson) as List)
              .map((d) => _normalizeSavedDevice(Map<String, dynamic>.from(d))),
        );
        print(
            '[Sync] Loaded ${_savedDevices.length} saved devices from memory');
      }
    } catch (e) {
      print('[Sync] Error loading saved devices: $e');
    }
  }

  Future<void> saveDeviceToMemory(Map<String, dynamic> device) async {
    try {
      final normalizedDevice = _normalizeSavedDevice(device);
      final existingIndex = _savedDevices.indexWhere(
        (d) => d['deviceId'] == normalizedDevice['deviceId'],
      );
      if (existingIndex >= 0) {
        _savedDevices[existingIndex] = {
          ..._savedDevices[existingIndex],
          ...normalizedDevice,
        };
      } else {
        _savedDevices.add(normalizedDevice);
      }
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_deviceMemoryKey, jsonEncode(_savedDevices));
      print('[Sync] Saved device to memory: ${normalizedDevice['deviceName']}');
    } catch (e) {
      print('[Sync] Error saving device: $e');
    }
  }

  Future<void> removeDeviceFromMemory(String deviceId) async {
    try {
      _savedDevices.removeWhere((d) => d['deviceId'] == deviceId);
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_deviceMemoryKey, jsonEncode(_savedDevices));
      print('[Sync] Removed device from memory: $deviceId');
    } catch (e) {
      print('[Sync] Error removing device: $e');
    }
  }

  /// Clears ALL saved devices and the last-device key from storage.
  /// Use this as a recovery step when connections fail with unexpected ports.
  Future<void> forgetAllDevices() async {
    try {
      _savedDevices.clear();
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_deviceMemoryKey);
      await prefs.remove(_lastDeviceKey);
      print('[Sync] All saved devices cleared.');
    } catch (e) {
      print('[Sync] Error clearing all devices: $e');
    }
  }

  List<Map<String, dynamic>> getSavedDevices() => _savedDevices;

  /// Sanitize port: the Aartiq desktop sync server always listens on 3004.
  /// If a saved device has a port outside the valid range 1–65535 or outside
  /// expected sync ports (3004), fall back to 3004 to avoid stale port errors.
  int _sanitizePort(dynamic rawPort) {
    final p = rawPort is int ? rawPort : int.tryParse('$rawPort') ?? 0;
    if (p >= 1024 && p <= 65535) return p;
    return 3004;
  }

  Map<String, dynamic> _normalizeSavedDevice(Map<String, dynamic> device) {
    return {
      'deviceId': device['deviceId'],
      'deviceName': device['deviceName'] ?? 'Desktop Device',
      'deviceType': device['deviceType'] ?? 'desktop',
      'ip': device['ip'],
      'port': _sanitizePort(device['port']),
      'timestamp': device['timestamp'] ?? DateTime.now().millisecondsSinceEpoch,
      'lastConnected': device['lastConnected'] ?? device['timestamp'],
      'lastSeen':
          device['lastSeen'] ?? device['lastConnected'] ?? device['timestamp'],
      'autoConnect': device['autoConnect'] ?? true,
      'trusted': device['trusted'] ?? false,
      'connectionMode': device['connectionMode'] ?? 'local',
      'isOnline': device['isOnline'] ?? false,
    };
  }

  Map<String, dynamic>? getSavedDevice(String deviceId) {
    try {
      return _savedDevices
          .firstWhere((device) => device['deviceId'] == deviceId);
    } catch (_) {
      return null;
    }
  }

  Future<void> _updateSavedDevice(
    String deviceId, {
    String? deviceName,
    String? ip,
    int? port,
    bool? trusted,
    bool? autoConnect,
    bool? isOnline,
    String? connectionMode,
    int? lastConnected,
    int? lastSeen,
  }) async {
    final existing = getSavedDevice(deviceId) ?? {'deviceId': deviceId};
    await saveDeviceToMemory({
      ...existing,
      if (deviceName != null) 'deviceName': deviceName,
      if (ip != null) 'ip': ip,
      if (port != null) 'port': port,
      if (trusted != null) 'trusted': trusted,
      if (autoConnect != null) 'autoConnect': autoConnect,
      if (isOnline != null) 'isOnline': isOnline,
      if (connectionMode != null) 'connectionMode': connectionMode,
      if (lastConnected != null) 'lastConnected': lastConnected,
      if (lastSeen != null) 'lastSeen': lastSeen,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
    });
  }

  Future<void> initialize(String userId, {String? customDeviceId}) async {
    this.userId = userId;
    // Load saved devices from persistent memory
    await loadSavedDevices();

    if (customDeviceId != null) {
      this.deviceId = customDeviceId;
    } else {
      try {
        final dir = await getApplicationDocumentsDirectory();
        final file = File('${dir.path}/device_id.txt');
        if (await file.exists()) {
          this.deviceId = await file.readAsString();
        } else {
          this.deviceId = const Uuid().v4();
          await file.writeAsString(this.deviceId!);
        }
      } catch (e) {
        print('[Sync] Error loading/saving device ID: $e');
        this.deviceId = const Uuid().v4();
      }
    }
    print('[Sync] Initialized for user: $userId, device: $deviceId');
  }

  Future<void> connect(String targetDeviceId) async {
    // Bridge: resolve the peer's P2P inbox id from the Firebase registry
    // (devices/{uid}/{id}/p2pId), falling back to the id we were given.
    final resolvedTarget = await _resolveP2pId(targetDeviceId);
    this.remoteDeviceId = resolvedTarget;
    _subscribeOwnSignals();

    await _setupPeerConnection();

    // Create an offer to start connection
    _dataChannel = await _peerConnection!.createDataChannel(
      'sync-channel',
      RTCDataChannelInit(),
    );
    _setupDataChannel();

    RTCSessionDescription offer = await _peerConnection!.createOffer();
    await _peerConnection!.setLocalDescription(offer);
    unawaited(_sendSignal({'sdp': offer.toMap()}));
  }

  /// Listen on our OWN signal inbox (p2p_signals/{uid}/{ourId}) exactly once.
  /// Required so a desktop-initiated offer is answered even when the phone
  /// never called [connect] itself.
  void _subscribeOwnSignals() {
    final owner = _p2pUserId;
    final me = _p2pDeviceId;
    if (owner == null || me == null || _p2pSignalsSubscription != null) return;
    _signalRef = FirebaseDatabase.instance.ref('p2p_signals/$owner/$me');
    _p2pSignalsSubscription = _signalRef!.onValue.listen((event) {
      final value = event.snapshot.value;
      if (value is Map) {
        _handleSignal(Map<String, dynamic>.from(value));
      }
    });
  }

  /// Resolve a device's P2P inbox id from devices/{uid}/{deviceId}/p2pId.
  Future<String> _resolveP2pId(String deviceIdOrP2pId) async {
    final owner = _p2pUserId;
    if (owner == null) return deviceIdOrP2pId;
    try {
      final snapshot = await FirebaseDatabase.instance
          .ref('devices/$owner/$deviceIdOrP2pId/p2pId')
          .get();
      final p2pId = snapshot.value;
      if (p2pId is String && p2pId.isNotEmpty) return p2pId;
    } catch (e) {
      print('[Sync] p2pId lookup failed: $e');
    }
    return deviceIdOrP2pId;
  }

  Future<void> _setupPeerConnection() async {
    final Map<String, dynamic> configuration = {
      'iceServers': [
        {'urls': 'stun:stun.l.google.com:19302'},
        {'urls': 'stun:stun1.l.google.com:19302'},
      ],
    };

    _peerConnection = await createPeerConnection(configuration);

    _peerConnection!.onIceCandidate = (candidate) {
      _sendSignal({'candidate': candidate.toMap()});
    };

    _peerConnection!.onDataChannel = (channel) {
      _dataChannel = channel;
      _setupDataChannel();
    };

    _peerConnection!.onConnectionState = (state) {
      print('[Sync] Peer Connection State: $state');
    };
  }

  void _setupDataChannel() {
    if (_dataChannel == null) return;

    _dataChannel!.onMessage = (data) {
      _handleMessage(data.text);
    };
    _dataChannel!.onDataChannelState = (state) {
      isConnected = state == RTCDataChannelState.RTCDataChannelOpen;
      print('[Sync] Data Channel State: $state');
    };
  }

  String? _lastSentClipboard;

  void _handleMessage(String text) {
    try {
      final msg = jsonDecode(text);
      if (msg['type'] == 'clipboard-sync') {
        _lastSentClipboard = msg['text'];
        Clipboard.setData(ClipboardData(text: msg['text']));
        _clipboardController.add(msg['text']);
        print('[Sync] Clipboard synced: ${msg['text']}');
      } else if (msg['type'] == 'history-sync') {
        _historyController.add(msg['data']);
        print('[Sync] History synced');
      }
    } catch (e) {
      print('[Sync] Error handling message: $e');
    }
  }

  String? get _p2pUserId => userId ?? _cloudUserId;
  String? get _p2pDeviceId => deviceId ?? _cloudDeviceId;

  void _handleSignal(Map data) {
    if (data['sender'] == _p2pDeviceId) return;
    _verifyAndHandleSignal(data);
  }

  /// Master-key gate: only signals signed with the same account-scoped
  /// pairing master key both devices share are processed.
  Future<void> _verifyAndHandleSignal(Map data) async {
    var masterKey = await _ensurePairingMasterKey();
    if (!verifySignalAuth(masterKey, data['auth'], data['timestamp'])) {
      // One refresh in case our cached key is stale (e.g. the account key was
      // re-created), then reject for good.
      masterKey = await _ensurePairingMasterKey(forceRefresh: true);
      if (!verifySignalAuth(masterKey, data['auth'], data['timestamp'])) {
        print('[Sync] Rejected P2P signal: master-key authentication failed');
        return;
      }
    }

    final signal = data['signal'];
    if (signal is! Map) return;

    if (signal['sdp'] != null) {
      if (_peerConnection == null) {
        // Desktop-initiated offer arrived before we connected ourselves.
        await _setupPeerConnection();
      }
      try {
        await _peerConnection!.setRemoteDescription(
          RTCSessionDescription(signal['sdp']['sdp'], signal['sdp']['type']),
        );
      } catch (e) {
        print('[Sync] setRemoteDescription failed: $e');
        return;
      }
      if (signal['sdp']['type'] == 'offer') {
        final answer = await _peerConnection!.createAnswer();
        await _peerConnection!.setLocalDescription(answer);
        unawaited(_sendSignal({'sdp': answer.toMap()}));
      }
      await _flushPendingRemoteCandidates();
    } else if (signal['candidate'] != null) {
      if (_peerConnection == null) {
        _pendingRemoteCandidates
            .add(Map<String, dynamic>.from(signal['candidate'] as Map));
        return;
      }
      await _peerConnection!.addCandidate(
        RTCIceCandidate(
          signal['candidate']['candidate'],
          signal['candidate']['sdpMid'],
          signal['candidate']['sdpMLineIndex'],
        ),
      );
    }
  }

  Future<void> _flushPendingRemoteCandidates() async {
    final pending = _pendingRemoteCandidates.toList();
    _pendingRemoteCandidates.clear();
    for (final candidate in pending) {
      try {
        await _peerConnection?.addCandidate(
          RTCIceCandidate(
            candidate['candidate'],
            candidate['sdpMid'],
            candidate['sdpMLineIndex'],
          ),
        );
      } catch (e) {
        print('[Sync] Failed to add queued ICE candidate: $e');
      }
    }
  }

  /// Create-or-read the account-scoped master key both devices need to
  /// connect. First device to sign in generates it; the other reads the
  /// identical value. A transaction guarantees a single winner.
  Future<String?> _ensurePairingMasterKey({bool forceRefresh = false}) async {
    if (!forceRefresh && _pairingMasterKey != null) return _pairingMasterKey;
    final owner = _p2pUserId;
    if (owner == null) return null;
    try {
      final keyRef =
          FirebaseDatabase.instance.ref('pairing/$owner/masterKey');
      final result = await keyRef.runTransaction((Object? current) {
        if (current is String && current.isNotEmpty) {
          return Transaction.success(current);
        }
        return Transaction.success(_randomHex(32));
      });
      final key = result.snapshot.value;
      if (key is String && key.isNotEmpty) {
        _pairingMasterKey = key;
        return key;
      }
    } catch (e) {
      print('[Sync] Failed to ensure pairing master key: $e');
    }
    return null;
  }

  String _randomHex(int byteCount) {
    final rng = Random.secure();
    return List.generate(
      byteCount,
      (_) => rng.nextInt(256).toRadixString(16).padLeft(2, '0'),
    ).join();
  }

  Future<void> _sendSignal(Map signal) async {
    final owner = _p2pUserId;
    if (owner == null || remoteDeviceId == null) return;
    final masterKey = await _ensurePairingMasterKey();
    if (masterKey == null) {
      print(
          '[Sync] Not sending P2P signal: shared pairing master key unavailable');
      return;
    }
    final timestamp = DateTime.now().millisecondsSinceEpoch;
    await FirebaseDatabase.instance
        .ref('p2p_signals/$owner/$remoteDeviceId')
        .set({
      'signal': signal,
      'sender': _p2pDeviceId,
      'timestamp': timestamp,
      'auth': computeSignalAuth(masterKey, timestamp),
    });
  }

  void sendClipboard(String text) {
    if (text == _lastSentClipboard) return;
    _lastSentClipboard = text;
    if (isConnected && _dataChannel != null) {
      _dataChannel!.send(
        RTCDataChannelMessage(
          jsonEncode({'type': 'clipboard-sync', 'text': text}),
        ),
      );
    }
  }

  void sendHistory(Map data) {
    if (isConnected && _dataChannel != null) {
      _dataChannel!.send(
        RTCDataChannelMessage(
          jsonEncode({'type': 'history-sync', 'data': data}),
        ),
      );
    }
  }

  // Desktop connection via WiFi
  WebSocket? _desktopSocket;
  String? _desktopIp;
  int? _desktopPort;
  bool isConnectedToDesktop = false;
  bool _isReconnecting = false;
  Timer? _reconnectTimer;
  Timer? _desktopHeartbeatTimer;
  DateTime? _lastDesktopPongAt;
  static const String _lastDeviceKey = 'last_connected_device';
  String _desktopConnectionMode = 'none';
  String? _connectedDesktopLabel;

  // UDP Discovery
  RawDatagramSocket? _discoverySocket;
  final StreamController<Map<String, dynamic>> _discoveredDevicesController =
      StreamController<Map<String, dynamic>>.broadcast();
  Stream<Map<String, dynamic>> get onDeviceDiscovered =>
      _discoveredDevicesController.stream;
  final Set<String> _discoveredDeviceIds = {};

  final StreamController<Map> _commandResponseController =
      StreamController<Map>.broadcast();
  Stream<Map> get onCommandResponse => _commandResponseController.stream;

  final StreamController<Map> _aiStreamController =
      StreamController<Map>.broadcast();
  Stream<Map> get onAIStream => _aiStreamController.stream;

  final StreamController<Map> _desktopStatusController =
      StreamController<Map>.broadcast();
  Stream<Map> get onDesktopStatus => _desktopStatusController.stream;

  final StreamController<Map> _desktopToMobileController =
      StreamController<Map>.broadcast();
  Stream<Map> get onDesktopToMobile => _desktopToMobileController.stream;

  // Desktop Control - Full AI Chat
  final StreamController<Map<String, dynamic>> _desktopControlController =
      StreamController<Map<String, dynamic>>.broadcast();
  Stream<Map<String, dynamic>> get onDesktopControl =>
      _desktopControlController.stream;

  // File transfer from desktop
  final StreamController<Map<String, dynamic>> _fileTransferController =
      StreamController<Map<String, dynamic>>.broadcast();
  Stream<Map<String, dynamic>> get onFileTransfer => _fileTransferController.stream;

  // Unified Session Streams
  final StreamController<UnifiedSessionModel> _sessionController =
      StreamController<UnifiedSessionModel>.broadcast();
  Stream<UnifiedSessionModel> get onSessionUpdated => _sessionController.stream;

  final StreamController<List<SessionSummaryModel>> _pastSessionsController =
      StreamController<List<SessionSummaryModel>>.broadcast();
  Stream<List<SessionSummaryModel>> get onPastSessionsUpdated =>
      _pastSessionsController.stream;

  UnifiedSessionModel? lastKnownCurrentSession;
  List<SessionSummaryModel> lastKnownPastSessions = [];

  // Permission Relay Request Stream
  final StreamController<PermissionRelayRequest> _permissionRelayController =
      StreamController<PermissionRelayRequest>.broadcast();
  Stream<PermissionRelayRequest> get onPermissionRelayRequest =>
      _permissionRelayController.stream;

  final Map<String, dynamic> _cloudDeviceCache = {};
  StreamSubscription<DatabaseEvent>? _cloudDevicesSubscription;
  StreamSubscription<DatabaseEvent>? _cloudAIResponsesSubscription;
  StreamSubscription<DatabaseEvent>? _cloudPermissionRequestsSubscription;

  Future<void> startDiscovery() async {
    _discoveredDeviceIds.clear();
    try {
      _discoverySocket =
          await RawDatagramSocket.bind(InternetAddress.anyIPv4, 3005);
      _discoverySocket!.listen((RawSocketEvent event) {
        if (event == RawSocketEvent.read) {
          Datagram? dg = _discoverySocket!.receive();
          if (dg != null) {
            try {
              String message = utf8.decode(dg.data);
              Map<String, dynamic> data = jsonDecode(message);
              if (data['type'] == 'aartiq-beacon') {
                String? deviceId = data['deviceId'];
                if (deviceId != null &&
                    !_discoveredDeviceIds.contains(deviceId)) {
                  _discoveredDeviceIds.add(deviceId);
                  _discoveredDevicesController.add({
                    'deviceId': deviceId,
                    'deviceName': data['deviceName'] ?? 'Unknown Desktop',
                    'ip': dg.address.address,
                    'port': data['port'] ?? 3004,
                  });
                }

                if (deviceId != null) {
                  unawaited(_updateSavedDevice(
                    deviceId,
                    deviceName: data['deviceName'] ?? 'Unknown Desktop',
                    ip: dg.address.address,
                    port: data['port'] ?? 3004,
                    isOnline: true,
                    lastSeen: DateTime.now().millisecondsSinceEpoch,
                    connectionMode: 'local',
                  ));

                  final savedDevice = getSavedDevice(deviceId);
                  final canAutoReconnect = savedDevice != null &&
                      savedDevice['trusted'] == true &&
                      savedDevice['autoConnect'] != false &&
                      !isConnectedToDesktop &&
                      !_isReconnecting &&
                      !_pendingDiscoveryReconnects.contains(deviceId);

                  if (canAutoReconnect) {
                    _pendingDiscoveryReconnects.add(deviceId);
                    unawaited(connectToDesktop(
                      dg.address.address,
                      data['port'] ?? 3004,
                      deviceId,
                    ).catchError((error) {
                      print(
                          '[Sync] Trusted discovery reconnect failed: $error');
                    }).whenComplete(() {
                      _pendingDiscoveryReconnects.remove(deviceId);
                    }));
                  }
                }
              }
            } catch (e) {
              print('[Sync] Error parsing discovery beacon: $e');
            }
          }
        }
      });
      print('[Sync] UDP discovery started on port 3005');
    } catch (e) {
      print('[Sync] Failed to start UDP discovery: $e');
    }
  }

  void stopDiscovery() {
    _discoverySocket?.close();
    _discoverySocket = null;
    print('[Sync] UDP discovery stopped');
  }

  Future<void> connectToDesktop(String ip, int port, String deviceId,
      {String? pairingCode}) async {
    try {
      _desktopIp = ip;
      _desktopPort = port;
      remoteDeviceId = deviceId;
      Map<String, dynamic>? handshakeAck;

      // Connect via WebSocket
      _desktopSocket = await WebSocket.connect('ws://$ip:$port')
          .timeout(const Duration(seconds: 5));

      final completer = Completer<void>();

      // Listen for messages
      _desktopSocket!.listen(
        (data) {
          try {
            final msg = jsonDecode(data);
            if (msg['type'] == 'handshake-ack' &&
                msg['authenticated'] == true) {
              handshakeAck = Map<String, dynamic>.from(msg);
              if (!completer.isCompleted) completer.complete();
            } else if (msg['type'] == 'error' && msg['code'] == 'AUTH_FAILED') {
              if (!completer.isCompleted)
                completer.completeError('AUTH_FAILED');
            }
          } catch (_) {}
          _handleDesktopMessage(data);
        },
        onDone: () {
          print('[Sync] Desktop connection closed');
          isConnectedToDesktop = false;
          _stopDesktopHeartbeat();
          if (remoteDeviceId != null) {
            unawaited(_updateSavedDevice(
              remoteDeviceId!,
              isOnline: false,
              lastSeen: DateTime.now().millisecondsSinceEpoch,
            ));
          }
          if (!completer.isCompleted) completer.completeError('Disconnected');
          _scheduleReconnect();
        },
        onError: (error) {
          print('[Sync] Desktop connection error: $error');
          isConnectedToDesktop = false;
          _stopDesktopHeartbeat();
          if (remoteDeviceId != null) {
            unawaited(_updateSavedDevice(
              remoteDeviceId!,
              isOnline: false,
              lastSeen: DateTime.now().millisecondsSinceEpoch,
            ));
          }
          if (!completer.isCompleted) completer.completeError(error);
          _scheduleReconnect();
        },
      );

      // Load native OS metadata and permanent token
      final meta = await DeviceInfoService().getDeviceMetadata();
      const secureStorage = FlutterSecureStorage(
        aOptions: AndroidOptions(encryptedSharedPreferences: true),
      );
      final storedPermanentToken =
          await secureStorage.read(key: 'aartiq_permanent_token_$deviceId');

      // Send handshake with real device model and permanent token
      _desktopSocket!.add(
        jsonEncode({
          'type': 'handshake',
          'deviceId': meta.deviceId,
          // The phone's pre-migration id (device_id.txt UUID). The desktop
          // falls back to it when the new id is unknown so an already-paired
          // phone stays trusted instead of hitting "Invalid pairing code" on
          // reconnect.
          'legacyDeviceId': this.deviceId,
          'deviceName': meta.deviceName, // Real device name (e.g. "Google Pixel 8 Pro")
          'deviceModel': meta.model,
          'deviceImage': meta.deviceImage,
          'deviceType': meta.deviceType,
          'platform': meta.platform,
          'permanentToken': storedPermanentToken,
          'pairingCode': pairingCode,
        }),
      );

      // Wait for authentication response
      await completer.future.timeout(const Duration(seconds: 10));

      // Save received permanent token to Native OS Secure Storage
      final receivedPermanentToken = handshakeAck?['permanentToken'] as String?;
      if (receivedPermanentToken != null && receivedPermanentToken.isNotEmpty) {
        await secureStorage.write(
          key: 'aartiq_permanent_token_$deviceId',
          value: receivedPermanentToken,
        );
        // The desktop announces its pre-migration id too; store the token
        // under it as well so reconnects that use either id form authenticate.
        final legacyDesktopId = handshakeAck?['legacyDeviceId'] as String?;
        if (legacyDesktopId != null &&
            legacyDesktopId.isNotEmpty &&
            legacyDesktopId != deviceId) {
          await secureStorage.write(
            key: 'aartiq_permanent_token_$legacyDesktopId',
            value: receivedPermanentToken,
          );
        }
        print('[Sync] Permanent sync authentication token saved to Native OS');
      }

      isConnectedToDesktop = true;
      _desktopConnectionMode = 'local';
      _connectedDesktopLabel =
          handshakeAck?['deviceName'] ?? handshakeAck?['hostname'] ?? ip;
      _isReconnecting = false;
      _reconnectTimer?.cancel();
      _startDesktopHeartbeat();
      _saveDeviceLocally(ip, port, deviceId);
      await saveDeviceToMemory({
        'deviceId': deviceId,
        'deviceName': _connectedDesktopLabel,
        'deviceModel': handshakeAck?['model'] ?? 'MacBook / PC',
        'deviceImage': handshakeAck?['deviceImage'] ?? 'macbook',
        'deviceType': 'desktop',
        'ip': ip,
        'port': port,
        'trusted': true,
        'permanentSynced': true,
        'autoConnect': true,
        'isOnline': true,
        'connectionMode': 'local',
        'lastConnected': DateTime.now().millisecondsSinceEpoch,
        'lastSeen': DateTime.now().millisecondsSinceEpoch,
      });
      print('[Sync] Permanently Connected & Authenticated to $_connectedDesktopLabel at $ip:$port');
    } catch (e) {
      _desktopSocket?.close();
      _desktopSocket = null;
      isConnectedToDesktop = false;
      _stopDesktopHeartbeat();
      print('[Sync] Failed to connect to desktop: $e');
      if (_isReconnecting) {
        _scheduleReconnect();
      }
      rethrow;
    }
  }

  Future<void> _saveDeviceLocally(String ip, int port, String deviceId) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final deviceData = jsonEncode({
        'ip': ip,
        'port': port,
        'deviceId': deviceId,
        'timestamp': DateTime.now().millisecondsSinceEpoch,
      });
      await prefs.setString(_lastDeviceKey, deviceData);
      print('[Sync] Saved device info for auto-reconnect: $ip:$port');
    } catch (e) {
      print('[Sync] Failed to save device info: $e');
    }
  }

  Future<void> tryAutoReconnect() async {
    if (isConnectedToDesktop || _isReconnecting) return;

    try {
      await loadSavedDevices();
      final trustedDevices = _savedDevices
          .where((device) =>
              device['trusted'] == true && device['autoConnect'] != false)
          .toList()
        ..sort((a, b) =>
            (b['lastConnected'] ?? 0).compareTo(a['lastConnected'] ?? 0));

      for (final device in trustedDevices) {
        final ip = device['ip'];
        final port = device['port'];
        final deviceId = device['deviceId'];
        if (ip is String && ip.isNotEmpty && deviceId is String) {
          print('[Sync] Attempting trusted auto-reconnect to $ip:$port...');
          _isReconnecting = true;
          try {
            await connectToDesktop(ip, port ?? 3004, deviceId);
            return;
          } catch (error) {
            print('[Sync] Trusted auto-reconnect failed for $deviceId: $error');
          }
        }
      }

      final prefs = await SharedPreferences.getInstance();
      final deviceJson = prefs.getString(_lastDeviceKey);
      if (deviceJson == null) return;

      final deviceData = jsonDecode(deviceJson);
      final ip = deviceData['ip'];
      final port = deviceData['port'];
      final deviceId = deviceData['deviceId'];

      print('[Sync] Attempting auto-reconnect to $ip:$port...');
      _isReconnecting = true;
      await connectToDesktop(ip, port, deviceId);
    } catch (e) {
      print('[Sync] Auto-reconnect failed: $e');
      _isReconnecting = false;
      _scheduleReconnect();
    }
  }

  void _scheduleReconnect() {
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(const Duration(seconds: 10), () {
      if (!isConnectedToDesktop) {
        tryAutoReconnect();
      }
    });
  }

  void _startDesktopHeartbeat() {
    _desktopHeartbeatTimer?.cancel();
    _lastDesktopPongAt = DateTime.now();
    _desktopHeartbeatTimer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (!isConnectedToDesktop || _desktopSocket == null) {
        return;
      }

      final lastPong = _lastDesktopPongAt;
      if (lastPong != null &&
          DateTime.now().difference(lastPong) > const Duration(seconds: 45)) {
        print('[Sync] Desktop heartbeat timed out, reconnecting...');
        _desktopSocket?.close();
        return;
      }

      try {
        _desktopSocket!.add(jsonEncode({
          'type': 'ping',
          'timestamp': DateTime.now().millisecondsSinceEpoch,
        }));
      } catch (error) {
        print('[Sync] Heartbeat ping failed: $error');
        _desktopSocket?.close();
      }
    });
  }

  void _stopDesktopHeartbeat() {
    _desktopHeartbeatTimer?.cancel();
    _desktopHeartbeatTimer = null;
    _lastDesktopPongAt = null;
  }

  void _handleDesktopMessage(dynamic data) {
    try {
      final msg = jsonDecode(data);

      if (msg['type'] == 'command-response') {
        _commandResponseController.add(msg);
        print('[Sync] Command response received: ${msg['output']}');
      } else if (msg['type'] == 'pong') {
        _lastDesktopPongAt = DateTime.now();
      } else if (msg['type'] == 'handshake-ack') {
        final ackDeviceId = remoteDeviceId;
        if (ackDeviceId != null) {
          unawaited(_updateSavedDevice(
            ackDeviceId,
            deviceName: msg['deviceName'] ?? msg['hostname'],
            trusted: msg['trusted'] == true,
            isOnline: true,
            lastSeen: DateTime.now().millisecondsSinceEpoch,
          ));
        }
      } else if (msg['type'] == 'clipboard-sync') {
        _lastSentClipboard = msg['text'];
        Clipboard.setData(ClipboardData(text: msg['text']));
        _clipboardController.add(msg['text']);
      } else if (msg['type'] == 'agent-task') {
        final task = msg['task'];
        if (task != null) {
          navigatorKey.currentState
              ?.pushNamed('/agent-chat', arguments: {'task': task});
        }
      } else if (msg['type'] == 'error' && msg['code'] == 'AUTH_FAILED') {
        isConnectedToDesktop = false;
        print('[Sync] Authentication failed: ${msg['message']}');
      } else if (msg['type'] == 'ai-stream-response') {
        _aiStreamController.add({
          'promptId': msg['promptId'],
          'response': msg['response'],
          'isStreaming': msg['isStreaming'] ?? false,
        });
        print('[Sync] AI stream response received');
      } else if (msg['type'] == 'desktop-status') {
        _desktopStatusController.add(msg);
        print(
            '[Sync] Desktop status: screenOn=${msg['screenOn']}, activeApp=${msg['activeApp']}');
      } else if (msg['type'] == 'desktop-to-mobile') {
        _desktopToMobileController.add(msg);
        print('[Sync] Desktop to mobile message: ${msg['action']}');
      } else if (msg['type'] == 'desktop-control-response') {
        _desktopControlController.add(msg);
        print('[Sync] Desktop control response: ${msg['action']}');
      } else if (msg['type'] == 'file-transfer') {
        _fileTransferController.add({
          'filename': msg['filename'],
          'mimeType': msg['mimeType'],
          'data': msg['data'],
          'size': msg['size'],
          'source': msg['source'],
          'timestamp': msg['timestamp'],
        });
        print('[Sync] File transfer received: ${msg['filename']} (${msg['mimeType']})');
      } else if (msg['type'] == 'device-trust-updated') {
        final updatedDeviceId = msg['deviceId']?.toString();
        if (updatedDeviceId != null) {
          unawaited(_updateSavedDevice(
            updatedDeviceId,
            trusted: msg['trustLevel'] == 'trusted',
            autoConnect: msg['autoConnect'] != false,
            deviceName: msg['deviceName']?.toString(),
            lastSeen: DateTime.now().millisecondsSinceEpoch,
          ));
        }
      } else if (msg['type'] == 'permission-relay-request') {
        print('[Sync] Received permission-relay-request: ${msg['payload']?['requestId']}');
        final reqMap = Map<String, dynamic>.from(msg['payload'] ?? {});
        final req = PermissionRelayRequest.fromJson(reqMap);
        _permissionRelayController.add(req);
        PermissionService().handleIncomingRequest(reqMap);

        // Auto-navigate to PermissionApprovalPage
        navigatorKey.currentState?.push(
          MaterialPageRoute(
            builder: (_) => PermissionApprovalPage(request: req),
          ),
        );
      } else if (msg['type'] == 'session-sync-response') {
        print('[Sync] Received session-sync-response');
        if (msg['currentSession'] != null) {
          final current = UnifiedSessionModel.fromJson(
              Map<String, dynamic>.from(msg['currentSession']));
          lastKnownCurrentSession = current;
          _sessionController.add(current);
        }
        if (msg['pastSessions'] != null) {
          final past = (msg['pastSessions'] as List<dynamic>)
              .map((p) =>
                  SessionSummaryModel.fromJson(Map<String, dynamic>.from(p)))
              .toList();
          lastKnownPastSessions = past;
          _pastSessionsController.add(past);
        }
      } else if (msg['type'] == 'session-delta') {
        print('[Sync] Received session-delta');
        requestSessionSync();
      } else if (msg['type'] == 'pin-sync-response') {
        print('[Sync] Received pin-sync-response: hasPin=${msg['hasPin']}');
      }
    } catch (e) {
      print('[Sync] Error handling desktop message: $e');
    }
  }

  /// Request current & past sessions from connected desktop or cloud
  Future<void> requestSessionSync() async {
    if (isConnectedToDesktop && _desktopSocket != null) {
      _desktopSocket!.add(jsonEncode({
        'type': 'session-sync-request',
        'timestamp': DateTime.now().millisecondsSinceEpoch,
      }));
      print('[Sync] Sent session-sync-request to desktop');
    } else if (userId != null) {
      try {
        final snap = await FirebaseDatabase.instance
            .ref('sessions/$userId/current')
            .get();
        if (snap.exists && snap.value != null) {
          final current = UnifiedSessionModel.fromJson(
              Map<String, dynamic>.from(snap.value as Map));
          lastKnownCurrentSession = current;
          _sessionController.add(current);
        }
      } catch (e) {
        print('[Sync] Error loading cloud sessions: $e');
      }
    }
  }

  /// Send permission approval response back to desktop (WebSocket or Firebase)
  Future<void> sendPermissionResponse(PermissionRelayResponse response) async {
    if (isConnectedToDesktop && _desktopSocket != null) {
      _desktopSocket!.add(jsonEncode({
        'type': 'permission-relay-response',
        'payload': response.toJson(),
        'timestamp': DateTime.now().millisecondsSinceEpoch,
      }));
      print(
          '[Sync] Sent permission-relay-response via WebSocket: ${response.requestId}');
    } else if (userId != null) {
      try {
        final ref = FirebaseDatabase.instance
            .ref('permissionResponses/$userId/${response.requestId}');
        await ref.set(response.toJson());
        print(
            '[Sync] Sent permission-relay-response via Firebase: ${response.requestId}');
      } catch (e) {
        print('[Sync] Error sending permission response to Firebase: $e');
      }
    }
  }

  /// Send a command to execute on the desktop
  Future<Map?> executeOnDesktop(
    String command, {
    Map<String, dynamic>? args,
  }) async {
    if (!isConnectedToDesktop || _desktopSocket == null) {
      throw Exception('Not connected to desktop');
    }

    final commandId = const Uuid().v4();

    _desktopSocket!.add(
      jsonEncode({
        'type': 'execute-command',
        'commandId': commandId,
        'command': command,
        'args': args ?? {},
        'timestamp': DateTime.now().millisecondsSinceEpoch,
      }),
    );

    // Wait for response (with timeout)
    try {
      final response = await onCommandResponse
          .firstWhere(
            (msg) => msg['commandId'] == commandId,
            orElse: () => {'error': 'Timeout'},
          )
          .timeout(const Duration(seconds: 30));

      return response;
    } catch (e) {
      print('[Sync] Command execution failed: $e');
      return {'error': e.toString()};
    }
  }

  /// Send a prompt to be executed on desktop (for AI features)
  Future<Map?> sendPromptToDesktop(String prompt, {String? model}) async {
    return executeOnDesktop('ai-prompt', args: {
      'prompt': prompt,
      'model': model,
    });
  }

  /// Disconnect from desktop
  void disconnectFromDesktop() {
    if (_desktopConnectionMode == 'local') {
      _desktopSocket?.close();
    }
    _stopDesktopHeartbeat();
    _desktopSocket = null;
    isConnectedToDesktop = false;
    _desktopIp = null;
    _desktopPort = null;
    _desktopConnectionMode = 'none';
    _connectedDesktopLabel = null;
    remoteDeviceId = null;
    stopDiscovery();
    print('[Sync] Disconnected from desktop');
  }

  /// Get current connection info
  Map<String, dynamic> getConnectionInfo() {
    return {
      'isConnected': isConnectedToDesktop,
      'desktopIp': _desktopIp,
      'desktopPort': _desktopPort,
      'remoteDeviceId': remoteDeviceId,
      'mode': _desktopConnectionMode,
      'label': _connectedDesktopLabel,
    };
  }

  /// Desktop Control - Full AI Chat Interface
  Future<Map?> executeDesktopControl(
    String action, {
    String? prompt,
    Map<String, dynamic>? args,
    String? promptId,
  }) async {
    if (_desktopConnectionMode == 'cloud') {
      if (remoteDeviceId == null) {
        throw Exception('No cloud desktop selected');
      }

      final activePromptId = promptId ?? const Uuid().v4();

      if (action == 'send-prompt') {
        if (prompt == null || prompt.trim().isEmpty) {
          return {'success': false, 'error': 'Prompt is required'};
        }
        sendPromptToCloudDevice(
          remoteDeviceId!,
          prompt,
          promptId: activePromptId,
        );
        return {
          'success': true,
          'promptId': activePromptId,
          'commandId': activePromptId,
          'mode': 'cloud',
        };
      }

      if (action == 'get-status') {
        final device =
            _cloudDeviceCache[remoteDeviceId] as Map<String, dynamic>? ?? {};
        return {
          'success': true,
          'desktopName':
              device['deviceName'] ?? _connectedDesktopLabel ?? 'Cloud Desktop',
          'platform': device['platform'] ?? 'cloud',
          'connectionMode': 'cloud',
          'online': device['online'] ?? true,
          'activeApp': 'Remote Aartiq Desktop',
          'screenOn': true,
        };
      }

      return {
        'success': false,
        'error':
            'This desktop control action is only available on local network right now. Cloud mode currently supports AI sidebar prompts.',
        'mode': 'cloud',
      };
    }

    if (!isConnectedToDesktop || _desktopSocket == null) {
      throw Exception('Not connected to desktop');
    }

    final commandId = const Uuid().v4();

    _desktopSocket!.add(
      jsonEncode({
        'type': 'desktop-control',
        'commandId': commandId,
        'action': action,
        'prompt': prompt,
        'promptId': promptId ?? commandId,
        'args': args ?? {},
        'timestamp': DateTime.now().millisecondsSinceEpoch,
      }),
    );

    try {
      if (action == 'send-prompt') {
        return {
          'success': true,
          'promptId': commandId,
          'commandId': commandId,
        };
      }

      final response = await onDesktopControl
          .firstWhere(
            (msg) => msg['commandId'] == commandId,
            orElse: () => {'error': 'Timeout'},
          )
          .timeout(const Duration(seconds: 30));

      return response;
    } catch (e) {
      print('[Sync] Desktop control failed: $e');
      return {'error': e.toString()};
    }
  }

  /// Request desktop status
  Future<Map?> getDesktopStatus() async {
    return executeDesktopControl('get-status');
  }

  /// Take screenshot from desktop
  Future<Map?> takeDesktopScreenshot() async {
    return executeDesktopControl('screenshot');
  }

  /// Execute shell command via desktop (triggers QR scanner on Mac if needed)
  Future<Map?> executeShellViaDesktop(String command,
      {bool requireApproval = true}) async {
    return executeDesktopControl('shell-command', args: {
      'command': command,
      'requireApproval': requireApproval,
    });
  }

  /// Get clipboard from desktop
  Future<String?> getDesktopClipboard() async {
    final result = await executeDesktopControl('get-clipboard');
    return result?['clipboard'];
  }

  /// Open URL on desktop browser
  Future<Map?> openUrlOnDesktop(String url) async {
    return executeDesktopControl('open-url', args: {'url': url});
  }

  /// Click at coordinates on desktop
  Future<Map?> clickOnDesktop(int x, int y) async {
    return executeDesktopControl('click', args: {'x': x, 'y': y});
  }

  /// Request desktop to show QR for shell approval
  Future<Map?> requestShellApprovalQR(String commandId, String command) async {
    return executeDesktopControl('show-shell-qr', args: {
      'commandId': commandId,
      'command': command,
    });
  }

  // Cloud Sync Methods
  String? _cloudUserId;
  String? _cloudDeviceId;
  bool _cloudConnected = false;
  bool _cloudInitialized = false;
  DatabaseReference? _cloudDevicesRef;
  final StreamController<Map<String, dynamic>> _cloudDevicesController =
      StreamController<Map<String, dynamic>>.broadcast();
  Stream<Map<String, dynamic>> get onCloudDevicesUpdated =>
      _cloudDevicesController.stream;

  Future<void> initializeCloud(String userId, {String? deviceId}) async {
    if (_cloudInitialized && _cloudUserId == userId) return;
    _cloudUserId = userId;
    _cloudConnected = true;
    if (deviceId != null) {
      _cloudDeviceId = deviceId;
    } else {
      try {
        final dir = await getApplicationDocumentsDirectory();
        final file = File('${dir.path}/device_id.txt');
        if (await file.exists()) {
          _cloudDeviceId = await file.readAsString();
        } else {
          _cloudDeviceId = const Uuid().v4();
          await file.writeAsString(_cloudDeviceId!);
        }
      } catch (e) {
        print('[CloudSync] Error loading/saving device ID: $e');
        _cloudDeviceId = const Uuid().v4();
      }
    }
    print('[CloudSync] Initialized for user: $userId, device: $_cloudDeviceId');
    // Bridge: publish this device's P2P id under the shared Google account so
    // the desktop can find our signal inbox, and make sure both devices hold
    // the same pairing master key before any P2P traffic.
    await _registerCloudDevice();
    await _ensurePairingMasterKey();
    _subscribeOwnSignals();
    _startCloudDeviceListener();
    _startCloudAIResponseListener();
    _startCloudPermissionRequestListener();
    _startCloudSessionListener();
    _cloudInitialized = true;
  }

  /// Publish this device in devices/{uid}/{deviceId} with its P2P inbox id so
  /// both devices can address each other through the Firebase registry.
  Future<void> _registerCloudDevice() async {
    if (_cloudUserId == null || _cloudDeviceId == null) return;
    try {
      final meta = await DeviceInfoService().getDeviceMetadata();
      final deviceRef = FirebaseDatabase.instance
          .ref('devices/$_cloudUserId/$_cloudDeviceId');
      await deviceRef.set({
        'deviceId': _cloudDeviceId,
        // The inbox under p2p_signals/{uid}/{p2pId} this device listens on.
        'p2pId': _cloudDeviceId,
        'deviceName': meta.deviceName,
        'deviceModel': meta.model,
        'deviceImage': meta.deviceImage,
        'deviceType': 'mobile',
        'platform': meta.platform,
        'lastSeen': DateTime.now().millisecondsSinceEpoch,
        'online': true,
      });
      await deviceRef.onDisconnect().update({
        'online': false,
        'lastSeen': DateTime.now().millisecondsSinceEpoch,
      });
      print('[CloudSync] Device registered: $_cloudDeviceId (p2pId: $_cloudDeviceId)');
    } catch (e) {
      print('[CloudSync] Device registration failed: $e');
    }
  }

  void _startCloudPermissionRequestListener() {
    if (_cloudUserId == null) return;

    _cloudPermissionRequestsSubscription?.cancel();
    final permRef =
        FirebaseDatabase.instance.ref('permissionRequests/$_cloudUserId');

    _cloudPermissionRequestsSubscription =
        permRef.onChildAdded.listen((event) {
      if (event.snapshot.value != null && event.snapshot.value is Map) {
        final data = Map<String, dynamic>.from(event.snapshot.value as Map);
        final req = PermissionRelayRequest.fromJson(data);
        if (!req.isExpired) {
          _permissionRelayController.add(req);
          PermissionService().handleIncomingRequest(data);
          navigatorKey.currentState?.push(
            MaterialPageRoute(
              builder: (_) => PermissionApprovalPage(request: req),
            ),
          );
        }
      }
    });
  }

  void _startCloudSessionListener() {
    if (_cloudUserId == null) return;

    final sessionRef =
        FirebaseDatabase.instance.ref('sessions/$_cloudUserId/current');
    sessionRef.onValue.listen((event) {
      if (event.snapshot.value != null && event.snapshot.value is Map) {
        final current = UnifiedSessionModel.fromJson(
            Map<String, dynamic>.from(event.snapshot.value as Map));
        lastKnownCurrentSession = current;
        _sessionController.add(current);
      }
    });
  }

  void _startCloudDeviceListener() {
    if (_cloudUserId == null) return;

    _cloudDevicesRef = FirebaseDatabase.instance.ref('devices/$_cloudUserId');
    _cloudDevicesSubscription?.cancel();
    _cloudDevicesSubscription = _cloudDevicesRef!.onValue.listen((event) {
      if (event.snapshot.value != null) {
        final Map<dynamic, dynamic> data = event.snapshot.value as Map;
        _cloudDeviceCache
          ..clear()
          ..addAll(
            data.map((key, value) => MapEntry(
                  key.toString(),
                  Map<String, dynamic>.from(value as Map),
                )),
          );
        _cloudDevicesController.add(Map<String, dynamic>.from(data));
      }
    });
  }

  void _startCloudAIResponseListener() {
    if (_cloudUserId == null || _cloudDeviceId == null) return;

    _cloudAIResponsesSubscription?.cancel();
    final responsesRef = FirebaseDatabase.instance
        .ref('aiResponses/$_cloudUserId/$_cloudDeviceId');

    _cloudAIResponsesSubscription = responsesRef.onValue.listen((event) {
      final data = event.snapshot.value;
      if (data is Map && data['response'] != null) {
        _aiStreamController.add({
          'promptId': data['promptId'],
          'response': data['response'],
          'isStreaming': data['isStreaming'] ?? false,
          'mode': 'cloud',
        });
      }
    });
  }

  Future<bool> connectToCloudDevice(String targetDeviceId) async {
    if (_cloudUserId == null || _cloudDeviceId == null) return false;

    try {
      final connectionRef = FirebaseDatabase.instance
          .ref('connections/$_cloudUserId/$_cloudDeviceId/$targetDeviceId');

      await connectionRef.set({
        'requestedAt': DateTime.now().millisecondsSinceEpoch,
        'status': 'pending'
      });

      // Wait for acceptance
      final completer = Completer<bool>();

      FirebaseDatabase.instance
          .ref(
              'connections/$_cloudUserId/$targetDeviceId/$_cloudDeviceId/status')
          .onValue
          .listen((event) {
        if (event.snapshot.value == 'accepted') {
          if (!completer.isCompleted) completer.complete(true);
        } else if (event.snapshot.value == 'rejected') {
          if (!completer.isCompleted) completer.complete(false);
        }
      });

      final connected =
          await completer.future.timeout(const Duration(seconds: 30));
      if (connected) {
        remoteDeviceId = targetDeviceId;
        isConnectedToDesktop = true;
        _desktopConnectionMode = 'cloud';
        final device =
            _cloudDeviceCache[targetDeviceId] as Map<String, dynamic>?;
        _connectedDesktopLabel =
            device?['deviceName']?.toString() ?? 'Cloud Desktop';
        _desktopIp = null;
        _desktopPort = null;
      }
      return connected;
    } catch (e) {
      print('[CloudSync] Connection failed: $e');
      return false;
    }
  }

  void disconnectFromCloudDevice(String targetDeviceId) {
    if (_cloudUserId == null || _cloudDeviceId == null) return;
    _cloudDevicesRef?.child(targetDeviceId).update({'online': false});
    if (remoteDeviceId == targetDeviceId) {
      isConnectedToDesktop = false;
      _desktopConnectionMode = 'none';
      _connectedDesktopLabel = null;
      remoteDeviceId = null;
    }
  }

  Future<void> syncClipboardToCloud(String text) async {
    if (_cloudUserId == null) return;
    final clipboardRef =
        FirebaseDatabase.instance.ref('clipboard/$_cloudUserId');
    await clipboardRef.set({
      'content': text,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
      'deviceId': _cloudDeviceId
    });
  }

  Future<void> syncHistoryToCloud(List<Map> history) async {
    if (_cloudUserId == null) return;
    final historyRef = FirebaseDatabase.instance.ref('history/$_cloudUserId');
    await historyRef.set(
        {'items': history, 'timestamp': DateTime.now().millisecondsSinceEpoch});
  }

  void sendPromptToCloudDevice(String deviceId, String prompt,
      {String? promptId}) {
    if (_cloudUserId == null) return;
    final promptRef =
        FirebaseDatabase.instance.ref('prompts/$_cloudUserId/$deviceId');
    promptRef.set({
      'promptId': promptId ?? 'prompt_${DateTime.now().millisecondsSinceEpoch}',
      'fromDeviceId': _cloudDeviceId,
      'prompt': prompt,
      'timestamp': DateTime.now().millisecondsSinceEpoch
    });
  }

  void forwardPromptToCloudDesktops(String prompt, {String? promptId}) async {
    if (_cloudUserId == null) return;

    // Get all online desktop devices
    final devicesSnapshot =
        await FirebaseDatabase.instance.ref('devices/$_cloudUserId').get();
    if (devicesSnapshot.value != null) {
      final Map<dynamic, dynamic> devices = devicesSnapshot.value as Map;
      for (final entry in devices.entries) {
        if (entry.key != _cloudDeviceId &&
            entry.value['deviceType'] == 'desktop' &&
            entry.value['online'] == true) {
          sendPromptToCloudDevice(entry.key, prompt, promptId: promptId);
        }
      }
    }
  }

  bool get isCloudConnected => _cloudConnected;
  bool get isCloudDesktopSession => _desktopConnectionMode == 'cloud';
  String get desktopConnectionMode => _desktopConnectionMode;
  String? get connectedDesktopLabel => _connectedDesktopLabel;

  Future<String?> saveReceivedFile(Map<String, dynamic> fileData) async {
    try {
      final directory = await getApplicationDocumentsDirectory();
      final downloadsDir = Directory('${directory.path}/Aartiq');
      if (!await downloadsDir.exists()) {
        await downloadsDir.create(recursive: true);
      }

      final filename = fileData['filename'] as String? ?? 'received_file';
      final base64Data = fileData['data'] as String?;
      if (base64Data == null || base64Data.isEmpty) return null;

      final bytes = base64Decode(base64Data);
      final filePath = '${downloadsDir.path}/$filename';
      final file = File(filePath);
      await file.writeAsBytes(bytes);

      print('[Sync] File saved: $filePath (${(bytes.length / 1024).toStringAsFixed(1)} KB)');
      return filePath;
    } catch (e) {
      print('[Sync] Failed to save file: $e');
      return null;
    }
  }
}

import 'dart:io';
import 'dart:ui' show PlatformDispatcher, Size;
import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

class MobileDeviceMetadata {
  final String deviceId;
  final String deviceName;        // Real friendly name, e.g. "Google Pixel 8 Pro"
  final String model;             // Model code, e.g. "Pixel 8 Pro"
  final String manufacturer;      // e.g. "Google", "Samsung"
  final String platform;          // "android" | "ios"
  final String deviceType;        // "phone" | "tablet"
  final String deviceImage;       // "android-phone" | "iphone" | "android-tablet" | "ipad"
  final String osVersion;         // e.g. "Android 14 (API 34)"

  MobileDeviceMetadata({
    required this.deviceId,
    required this.deviceName,
    required this.model,
    required this.manufacturer,
    required this.platform,
    required this.deviceType,
    required this.deviceImage,
    required this.osVersion,
  });

  Map<String, dynamic> toJson() {
    return {
      'deviceId': deviceId,
      'deviceName': deviceName,
      'model': model,
      'manufacturer': manufacturer,
      'platform': platform,
      'deviceType': deviceType,
      'deviceImage': deviceImage,
      'osVersion': osVersion,
    };
  }
}

class DeviceInfoService {
  static final DeviceInfoService _instance = DeviceInfoService._internal();
  factory DeviceInfoService() => _instance;
  DeviceInfoService._internal();

  final DeviceInfoPlugin _deviceInfoPlugin = DeviceInfoPlugin();
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );
  static const _deviceIdKey = 'aartiq_native_device_id';

  MobileDeviceMetadata? _cachedMetadata;

  /// Physical pixels of the main screen. `device_info_plus` does not expose
  /// Android's DisplayMetrics, so the Flutter view is where size comes from.
  static Size get _physicalScreen {
    final views = PlatformDispatcher.instance.views;
    return views.isEmpty ? Size.zero : views.first.physicalSize;
  }

  Future<String> getOrCreateDeviceId() async {
    String? id = await _storage.read(key: _deviceIdKey);
    if (id == null || id.isEmpty) {
      id = 'mobile-${const Uuid().v4().substring(0, 8)}';
      await _storage.write(key: _deviceIdKey, value: id);
    }
    return id;
  }

  Future<MobileDeviceMetadata> getDeviceMetadata() async {
    if (_cachedMetadata != null) {
      return _cachedMetadata!;
    }

    final deviceId = await getOrCreateDeviceId();
    String deviceName = 'Aartiq Mobile';
    String model = 'Mobile Device';
    String manufacturer = 'Android';
    String platform = Platform.operatingSystem;
    String deviceType = 'phone';
    String deviceImage = 'android-phone';
    String osVersion = Platform.operatingSystemVersion;

    try {
      if (Platform.isAndroid) {
        final androidInfo = await _deviceInfoPlugin.androidInfo;
        manufacturer = androidInfo.manufacturer;
        model = androidInfo.model;
        final brand = androidInfo.brand;

        // Capitalize manufacturer
        final mfgClean = manufacturer.isNotEmpty
            ? '${manufacturer[0].toUpperCase()}${manufacturer.substring(1)}'
            : 'Android';

        // Check if model already includes manufacturer (e.g. "Pixel 8 Pro")
        if (model.toLowerCase().contains(mfgClean.toLowerCase())) {
          deviceName = model;
        } else {
          deviceName = '$mfgClean $model';
        }

        // Check for tablet. device_info_plus does not expose DisplayMetrics,
        // so use Android's own feature flags plus a physical screen size
        // check read from the Flutter view.
        final screen = _physicalScreen;
        if (androidInfo.systemFeatures.contains('android.hardware.type.television') ||
            androidInfo.systemFeatures.contains('android.hardware.type.tablet') ||
            (screen.width > 1600 && screen.height > 2400)) {
          deviceType = 'tablet';
          deviceImage = 'android-tablet';
        } else {
          deviceType = 'phone';
          deviceImage = 'android-phone';
        }

        osVersion = 'Android ${androidInfo.version.release} (API ${androidInfo.version.sdkInt})';
      } else if (Platform.isIOS) {
        final iosInfo = await _deviceInfoPlugin.iosInfo;
        manufacturer = 'Apple';
        model = iosInfo.utsname.machine;
        deviceName = iosInfo.name; // e.g. "Sandip's iPhone"
        platform = 'ios';
        if (iosInfo.model.toLowerCase().contains('ipad')) {
          deviceType = 'tablet';
          deviceImage = 'ipad';
        } else {
          deviceType = 'phone';
          deviceImage = 'iphone';
        }
        osVersion = '${iosInfo.systemName} ${iosInfo.systemVersion}';
      }
    } catch (e) {
      print('[DeviceInfoService] Error detecting device: $e');
    }

    _cachedMetadata = MobileDeviceMetadata(
      deviceId: deviceId,
      deviceName: deviceName,
      model: model,
      manufacturer: manufacturer,
      platform: platform,
      deviceType: deviceType,
      deviceImage: deviceImage,
      osVersion: osVersion,
    );

    return _cachedMetadata!;
  }
}

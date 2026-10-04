import 'package:flutter/foundation.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

class Util {
  /// Schemes that make sense when typed in the address bar: the ones the
  /// WebView renders itself plus the ones that belong to other apps
  /// (`tel:`, `mailto:`, `market:`, …). Anything that is not in this list and
  /// looks like a scheme (`example.com:8080` is not one) is not a scheme.
  static const List<String> knownSchemes = [
    'http',
    'https',
    'file',
    'data',
    'javascript',
    'about',
    'chrome',
    'blob',
    'content',
    'filesystem',
    'tel',
    'sms',
    'mms',
    'mailto',
    'geo',
    'intent',
    'market',
    'itms-apps',
    'itms',
    'whatsapp',
    'telegram',
    'tg',
    'signal',
    'skype',
    'zoom',
    'facetime',
    'callto',
    'maps',
    'googlemaps',
    'comgooglemaps',
    'spotify',
    'youtube',
    'instagram',
    'fb',
    'twitter',
    'snapchat',
    'tiktok',
    'discord',
    'slack',
    'ftp',
    'ftps',
    'sftp',
    'irc',
    'news',
    'nntp',
    'bitcoin',
    'magnet',
    'aartiq',
    'app-settings',
  ];

  /// The scheme [input] starts with, lower-cased, or `null` when the input
  /// does not start with a known `scheme:` prefix.
  static String? schemeOf(String input) {
    final match =
        RegExp(r'^([A-Za-z][A-Za-z0-9+.\-]*):').firstMatch(input.trim());
    if (match == null) {
      return null;
    }
    final scheme = match.group(1)!.toLowerCase();
    return knownSchemes.contains(scheme) ? scheme : null;
  }

  /// Turns address bar input into a [WebUri]: known schemes are used as
  /// typed, host-like input gets an implicit `https://`, and everything else
  /// is sent to the configured search engine.
  static WebUri resolveAddressInput(String input, String searchUrl) {
    final value = input.trim();
    if (value.isEmpty) {
      return WebUri('about:blank');
    }

    // tel:+1 555 0100, mailto:…, https://…, aartiq://… → use exactly as typed.
    if (schemeOf(value) != null) {
      return _tryParse(value) ?? WebUri(value);
    }

    // localhost:8080, 192.168.0.10:8080, example.com/page → open as a URL.
    final looksLikeHost = value.startsWith('localhost') ||
        (!value.contains(' ') && value.split('.').length > 1);
    if (looksLikeHost) {
      final withScheme = value.contains('://') ? value : 'https://$value';
      return _tryParse(withScheme) ?? WebUri(searchUrl + value);
    }

    return WebUri(searchUrl + value);
  }

  static WebUri? _tryParse(String value) {
    try {
      return WebUri.uri(Uri.parse(value));
    } catch (_) {
      return null;
    }
  }

  static bool urlIsSecure(Uri url) {
    return (url.scheme == "https") || Util.isLocalizedContent(url);
  }

  static bool isLocalizedContent(Uri url) {
    return (url.scheme == "file" ||
        url.scheme == "chrome" ||
        url.scheme == "data" ||
        url.scheme == "javascript" ||
        url.scheme == "about");
  }

  static bool isMobile() {
    return isAndroid() || isIOS();
  }

  static bool isAndroid() {
    return !kIsWeb && defaultTargetPlatform == TargetPlatform.android;
  }

  static bool isIOS() {
    return !kIsWeb && defaultTargetPlatform == TargetPlatform.iOS;
  }

  static bool isDesktop() {
    return !isMobile();
  }

  static bool isMacOS() {
    return !kIsWeb && defaultTargetPlatform == TargetPlatform.macOS;
  }

  static bool isWindows() {
    return !kIsWeb && defaultTargetPlatform == TargetPlatform.windows;
  }
}
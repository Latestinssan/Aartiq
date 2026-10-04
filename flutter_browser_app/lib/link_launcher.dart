import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:url_launcher/url_launcher.dart';

import 'util.dart';

/// Single place for handing a link to something outside the in-app WebView:
/// the system browser, the dialer, mail, chat apps, the app stores, or an
/// Android `intent://` deep link.
///
/// Every "open this outside the app" code path goes through here so that
/// links no app can handle are reported the same way everywhere (a snackbar
/// with a copy action) instead of silently doing nothing.
class LinkLauncher {
  /// Schemes the in-app WebView renders by itself. Everything else is handed
  /// to the operating system.
  static const Set<String> internalSchemes = {
    'http',
    'https',
    'file',
    'chrome',
    'data',
    'javascript',
    'about',
    'blob',
  };

  /// Whether the WebView can render [url] itself.
  static bool canLoadInWebView(Uri url) => isInternalScheme(schemeOf(url));

  static bool isInternalScheme(String? scheme) =>
      scheme != null && internalSchemes.contains(scheme.toLowerCase());

  /// Store links that a real browser hands over to the store app instead of
  /// rendering them (Play Store on Android, App Store on iOS).
  static bool isStoreLink(Uri url) {
    final host = url.host.toLowerCase();
    if (Util.isAndroid()) {
      return host == 'play.google.com';
    }
    if (Util.isIOS()) {
      return host == 'apps.apple.com' || host == 'itunes.apple.com';
    }
    return false;
  }

  /// Scheme of [url] read from its raw string, so it also works for URLs that
  /// `Uri.parse` rejects (e.g. `intent://not:valid_uri`).
  static String schemeOf(Uri url) => schemeOfRaw(rawValueOf(url));

  /// Same as [schemeOf], for a raw URL string. Returns an empty string when no
  /// scheme can be recognized.
  static String schemeOfRaw(String raw) {
    final match =
        RegExp(r'^([A-Za-z][A-Za-z0-9+.\-]*):').firstMatch(raw.trim());
    return (match?.group(1) ?? '').toLowerCase();
  }

  /// The URL exactly as it was received ([WebUri] keeps unparseable strings
  /// as-is, while [Uri.toString] would lose them).
  static String rawValueOf(Uri url) =>
      url is WebUri ? url.rawValue : url.toString();

  /// The URL an Android `intent://…` deep link points at, if it has one.
  @visibleForTesting
  static Uri? parseAndroidIntentTarget(String raw) =>
      _AndroidIntent.parse(raw)?.target;

  /// The browser fallback URL of an Android `intent://…` deep link: where to
  /// go when the target app is not installed.
  @visibleForTesting
  static Uri? parseAndroidIntentFallback(String raw) =>
      _AndroidIntent.parse(raw)?.fallback;

  /// Opens [url] outside the app. Returns `true` when something handled it;
  /// otherwise the user gets feedback explaining why nothing happened.
  static Future<bool> openExternalUrl(Uri url, {BuildContext? context}) async {
    final raw = rawValueOf(url).trim();
    final scheme = schemeOfRaw(raw);

    if (raw.isNotEmpty) {
      try {
        if (scheme == 'intent') {
          // url_launcher cannot parse Android intent:// URIs, so unwrap them.
          return await _openAndroidIntent(raw, context);
        }
        if (await _launch(Uri.parse(raw))) {
          return true;
        }
      } catch (_) {
        // Fall through to the failure feedback below.
      }
    }

    if (context != null && context.mounted) {
      _showCannotOpen(context, scheme, raw);
    }
    return false;
  }

  static Future<bool> _launch(Uri url) async {
    try {
      return await launchUrl(url, mode: LaunchMode.externalApplication);
    } catch (_) {
      return false;
    }
  }

  /// Rebuilds a usable URL out of an `intent://…#Intent;scheme=…;end` deep
  /// link, falling back to the URL the page provided for browsers.
  static Future<bool> _openAndroidIntent(
      String raw, BuildContext? context) async {
    final intent = _AndroidIntent.parse(raw);

    final target = intent?.target;
    if (target != null && await _launch(target)) {
      return true;
    }
    final fallback = intent?.fallback;
    if (fallback != null && await _launch(fallback)) {
      return true;
    }

    if (context != null && context.mounted) {
      _showCannotOpen(context, 'intent', raw);
    }
    return false;
  }

  static void _showCannotOpen(BuildContext? context, String scheme, String raw) {
    if (context == null || !context.mounted) {
      return;
    }
    final messenger = ScaffoldMessenger.maybeOf(context);
    if (messenger == null) {
      return;
    }
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(
        content: Text(scheme.isEmpty
            ? "This link can't be opened on this device"
            : "No app on this device can open $scheme: links"),
        action: SnackBarAction(
          label: "COPY",
          onPressed: () {
            Clipboard.setData(ClipboardData(text: raw));
          },
        ),
      ),
    );
  }
}

/// The parts of an Android `intent://` URL that matter to a browser: the URL
/// it points at and the URL to show when the target app is not installed.
class _AndroidIntent {
  final Uri? target;
  final Uri? fallback;

  const _AndroidIntent({this.target, this.fallback});

  static _AndroidIntent? parse(String raw) {
    if (!raw.toLowerCase().startsWith('intent:')) {
      return null;
    }

    final intentIndex = raw.indexOf('#Intent;');
    if (intentIndex == -1) {
      return null;
    }

    // "intent://host/path?query#Intent;…" → "host/path?query"
    var body = raw.substring('intent:'.length, intentIndex);
    if (body.startsWith('//')) {
      body = body.substring(2);
    }

    var params = raw.substring(intentIndex + '#Intent;'.length);
    if (params.toLowerCase().endsWith(';end')) {
      params = params.substring(0, params.length - ';end'.length);
    }

    String? scheme;
    String? fallbackUrl;
    for (final param in params.split(';')) {
      final separator = param.indexOf('=');
      if (separator <= 0) {
        continue;
      }
      switch (param.substring(0, separator)) {
        case 'scheme':
          scheme = param.substring(separator + 1);
          break;
        case 'S.browser_fallback_url':
          try {
            fallbackUrl = Uri.decodeComponent(param.substring(separator + 1));
          } catch (_) {
            // Ignore a malformed fallback and keep going.
          }
          break;
      }
    }

    if (scheme == null || scheme.isEmpty) {
      return null;
    }

    return _AndroidIntent(
      target: _parse('$scheme://$body'),
      fallback: fallbackUrl != null ? _parse(fallbackUrl) : null,
    );
  }

  static Uri? _parse(String value) {
    try {
      return Uri.parse(value);
    } catch (_) {
      return null;
    }
  }
}

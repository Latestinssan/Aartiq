import 'package:flutter_browser/link_launcher.dart';
import 'package:flutter_browser/util.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const searchUrl = 'https://www.google.com/search?q=';

  group('Util.schemeOf', () {
    test('recognizes known schemes', () {
      expect(Util.schemeOf('tel:+1 555 0100'), 'tel');
      expect(Util.schemeOf('HTTPS://example.com'), 'https');
      expect(Util.schemeOf('mailto:someone@example.com'), 'mailto');
      expect(Util.schemeOf('intent://foo#Intent;scheme=bar;end'), 'intent');
      expect(Util.schemeOf('file:///sdcard/a.pdf'), 'file');
    });

    test('does not mistake host:port or prose for a scheme', () {
      expect(Util.schemeOf('example.com:8080'), isNull);
      expect(Util.schemeOf('localhost:3000'), isNull);
      expect(Util.schemeOf('some words to search'), isNull);
      expect(Util.schemeOf(''), isNull);
    });
  });

  group('Util.resolveAddressInput', () {
    test('keeps known schemes as typed', () {
      expect(Util.resolveAddressInput('tel:+91 98765 43210', searchUrl)
          .toString(), startsWith('tel:'));
      expect(Util.resolveAddressInput('https://example.com', searchUrl)
          .toString(), 'https://example.com');
      expect(Util.resolveAddressInput('file:///tmp/a.html', searchUrl)
          .toString(), 'file:///tmp/a.html');
      expect(Util.resolveAddressInput('aartiq://auth', searchUrl).toString(),
          'aartiq://auth');
    });

    test('adds an implicit https:// to host-like input', () {
      expect(Util.resolveAddressInput('example.com', searchUrl).toString(),
          'https://example.com');
      expect(Util.resolveAddressInput('localhost:3000', searchUrl).toString(),
          'https://localhost:3000');
      expect(
          Util.resolveAddressInput('192.168.0.10:8080/x', searchUrl)
              .toString(),
          'https://192.168.0.10:8080/x');
    });

    test('sends anything else to the search engine', () {
      expect(
          Util.resolveAddressInput('flutter inappwebview', searchUrl)
              .toString(),
          startsWith(searchUrl));
      expect(
          Util.resolveAddressInput('what is a browser', searchUrl).toString(),
          startsWith(searchUrl));
      expect(Util.resolveAddressInput('', searchUrl).toString(),
          'about:blank');
    });
  });

  group('LinkLauncher scheme detection', () {
    test('reads the scheme from raw, unparseable URLs', () {
      expect(LinkLauncher.schemeOfRaw('intent://not:valid_uri'), 'intent');
      expect(LinkLauncher.schemeOfRaw('https://example.com'), 'https');
      expect(LinkLauncher.schemeOfRaw('  MAILTO:a@b.com'), 'mailto');
      expect(LinkLauncher.schemeOfRaw('/relative/path'), '');
    });

    test('knows what the WebView renders itself', () {
      expect(LinkLauncher.isInternalScheme('https'), isTrue);
      expect(LinkLauncher.isInternalScheme('file'), isTrue);
      expect(LinkLauncher.isInternalScheme('tel'), isFalse);
      expect(LinkLauncher.isInternalScheme('intent'), isFalse);
      expect(LinkLauncher.isInternalScheme(''), isFalse);
      expect(LinkLauncher.isInternalScheme(null), isFalse);
    });
  });

  group('Android intent:// deep links', () {
    test('unwraps the target URL', () {
      expect(
          LinkLauncher.parseAndroidIntentTarget(
              'intent://scan/#Intent;scheme=zxing;'
              'package=com.google.zxing.client.android;end')?.toString(),
          'zxing://scan/');
      expect(
          LinkLauncher.parseAndroidIntentTarget(
              'intent://example.com/path?x=1#Intent;scheme=https;'
              'package=com.example.app;end')?.toString(),
          'https://example.com/path?x=1');
    });

    test('keeps the browser fallback URL', () {
      expect(
          LinkLauncher.parseAndroidIntentFallback(
              'intent://foo#Intent;scheme=app;'
              'S.browser_fallback_url=https%3A%2F%2Fexample.com%2Fmissing;'
              'end')?.toString(),
          'https://example.com/missing');
    });

    test('rejects links it cannot make sense of', () {
      expect(LinkLauncher.parseAndroidIntentTarget('intent://not:valid_uri'),
          isNull);
      expect(LinkLauncher.parseAndroidIntentTarget('intent:no-params'), isNull);
      expect(
          LinkLauncher.parseAndroidIntentTarget(
              'https://example.com#Intent;scheme=https;end'),
          isNull);
    });
  });
}

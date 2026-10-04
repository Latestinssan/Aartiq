import 'dart:async';

// import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_browser/custom_image.dart';
import 'package:flutter_browser/tab_viewer.dart';
import 'package:flutter_browser/app_bar/browser_app_bar.dart';
import 'package:flutter_browser/models/webview_model.dart';
import 'package:flutter_browser/link_launcher.dart';
import 'package:flutter_browser/util.dart';
import 'package:flutter_browser/webview_tab.dart';
import 'package:flutter_browser/clipboard_monitor.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:provider/provider.dart';

import 'pages/aartiq_home_page.dart';
import 'pages/ai_chat_page.dart';
import 'app_bar/tab_viewer_app_bar.dart';
import 'models/browser_model.dart';
import 'models/window_model.dart';

class Browser extends StatefulWidget {
  const Browser({super.key});

  @override
  State<Browser> createState() => _BrowserState();
}

class _BrowserState extends State<Browser> with SingleTickerProviderStateMixin {
  static const platform =
      MethodChannel('com.aartiq.intent_data');

  var _isRestored = false;
  final ClipboardMonitor _clipboardMonitor = ClipboardMonitor();
  String? _copiedText;
  bool _showCopiedBanner = false;

  @override
  void initState() {
    super.initState();
    getIntentData();
    _startClipboardMonitoring();
  }

  void _startClipboardMonitoring() {
    _clipboardMonitor.startMonitoring();
    _clipboardMonitor.clipboardStream.listen((text) {
      if (mounted && text.isNotEmpty) {
        setState(() {
          _copiedText = text;
          _showCopiedBanner = true;
        });
        Future.delayed(const Duration(seconds: 5), () {
          if (mounted) {
            setState(() {
              _showCopiedBanner = false;
            });
          }
        });
      }
    });
  }

  void _processCopiedTextWithAI() {
    if (_copiedText != null && _copiedText!.isNotEmpty) {
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (context) => FullScreenAIChat(initialMessage: _copiedText!),
        ),
      );
    }
    setState(() {
      _showCopiedBanner = false;
    });
  }

  @override
  void dispose() {
    _clipboardMonitor.stopMonitoring();
    super.dispose();
  }

  getIntentData() async {
    if (!Util.isAndroid()) return;
    try {
      final dynamic raw = await platform.invokeMethod('getIntentData');
      if (raw == null) return;

      // New format: Map<String, String?> from updated MainActivity
      final Map<String, dynamic> data = Map<String, dynamic>.from(raw is Map ? raw : {});
      final String? action = data['action'] as String?;
      final String? query  = data['query']  as String?;
      final String? url    = data['url']    as String?;

      if (!mounted) return;

      if (action == 'view' && url != null && url.isNotEmpty) {
        // aartiq:// links are routed by AppLinks in main.dart; re-launching
        // them here would bounce straight back into this app forever.
        if (LinkLauncher.schemeOf(WebUri(url)) != 'aartiq') {
          // Standard deep-link / browser URL → open in WebView tab
          final windowModel = Provider.of<WindowModel>(context, listen: false);
          if (LinkLauncher.canLoadInWebView(WebUri(url))) {
            windowModel.addTab(WebViewTab(
              key: GlobalKey(),
              webViewModel: WebViewModel(url: WebUri(url)),
            ));
          } else {
            // tel:, mailto:, intent:, … → handled by another app
            LinkLauncher.openExternalUrl(WebUri(url), context: context);
          }
        }
      } else if (action == 'search') {
        // Widget search bar tapped (no typed query yet) → just open the app
        // If a query was pre-filled (e.g. from OS web-search intent) navigate to it
        final windowModel = Provider.of<WindowModel>(context, listen: false);
        final browserModel = Provider.of<BrowserModel>(context, listen: false);
        final settings     = browserModel.getSettings();
        if (query != null && query.isNotEmpty) {
          final uri =
              Util.resolveAddressInput(query, settings.searchEngine.searchUrl);
          if (LinkLauncher.canLoadInWebView(uri)) {
            windowModel.addTab(WebViewTab(
              key: GlobalKey(),
              webViewModel: WebViewModel(url: uri),
            ));
          } else {
            LinkLauncher.openExternalUrl(uri, context: context);
          }
        }
        // If no query → app is open, user lands on home page / search bar
      } else if (action == 'voice') {
        // Mic icon: open the app on home so the user can tap the mic there
        // (Full voice recognition requires a separate plugin; placeholder navigation)
      } else if (action == 'ai') {
        // AI sparkle → open full-screen AI chat
        Navigator.of(context).pushNamed('/ai-chat',
            arguments: {'initialMessage': query?.isNotEmpty == true ? query : 'Hello!'});
      }
    } catch (e) {
      debugPrint('[Widget] getIntentData error: $e');
    }
  }

  restore() async {
    final browserModel = Provider.of<BrowserModel>(context, listen: false);
    final windowModel = Provider.of<WindowModel>(context, listen: false);
    browserModel.restore();
    windowModel.restoreInfo();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_isRestored) {
      _isRestored = true;
      restore();
    }
    precacheImage(const AssetImage("assets/icon/icon.png"), context);
  }

  @override
  Widget build(BuildContext context) {
    return _buildBrowser();
  }

  Widget _buildBrowser() {
    final currentWebViewModel =
        Provider.of<WebViewModel>(context, listen: true);
    final browserModel = Provider.of<BrowserModel>(context, listen: true);
    final windowModel = Provider.of<WindowModel>(context, listen: true);

    browserModel.addListener(() {
      browserModel.save();
    });
    windowModel.addListener(() {
      windowModel.saveInfo();
    });
    currentWebViewModel.addListener(() {
      windowModel.saveInfo();
    });

    var canShowTabScroller =
        browserModel.showTabScroller && windowModel.webViewTabs.isNotEmpty;

    return IndexedStack(
      index: canShowTabScroller ? 1 : 0,
      children: [
        _buildWebViewTabs(),
        canShowTabScroller ? _buildWebViewTabsViewer() : Container()
      ],
    );
  }

  Widget _buildWebViewTabs() {
    return WillPopScope(
        onWillPop: () async {
          final windowModel = Provider.of<WindowModel>(context, listen: false);
          final webViewModel = windowModel.getCurrentTab()?.webViewModel;
          final webViewController = webViewModel?.webViewController;

          if (webViewController != null) {
            if (await webViewController.canGoBack()) {
              webViewController.goBack();
              return false;
            }
          }

          if (webViewModel != null && webViewModel.tabIndex != null) {
            setState(() {
              windowModel.closeTab(webViewModel.tabIndex!);
            });
            if (mounted) {
              FocusScope.of(context).unfocus();
            }
            return false;
          }

          return windowModel.webViewTabs.isEmpty;
        },
        child: Listener(
          onPointerUp: (_) {
            if (Util.isIOS() || Util.isAndroid()) {
              FocusScopeNode currentFocus = FocusScope.of(context);
              if (!currentFocus.hasPrimaryFocus &&
                  currentFocus.focusedChild != null) {
                currentFocus.focusedChild!.unfocus();
              }
            }
          },
          child: Scaffold(
              appBar: BrowserAppBar(), 
              body: Stack(
                children: [
                  _buildWebViewTabsContent(),
                  if (_showCopiedBanner && _copiedText != null)
                    Positioned(
                      bottom: 100,
                      left: 20,
                      right: 20,
                      child: _buildClipboardBanner(),
                    ),
                ],
              ),
            ),
        ));
  }

  Widget _buildClipboardBanner() {
    return Material(
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [
              const Color(0xFF00E5FF).withOpacity(0.9),
              const Color(0xFFD500F9).withOpacity(0.9),
            ],
          ),
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(
              color: const Color(0xFF00E5FF).withOpacity(0.4),
              blurRadius: 20,
              spreadRadius: 2,
            ),
          ],
        ),
        child: Row(
          children: [
            const Icon(Icons.auto_awesome, color: Colors.white, size: 28),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text(
                    'Text copied!',
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                    ),
                  ),
                  Text(
                    _copiedText!.length > 50 
                        ? '${_copiedText!.substring(0, 50)}...' 
                        : _copiedText!,
                    style: const TextStyle(
                      color: Colors.white70,
                      fontSize: 12,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            ElevatedButton(
              onPressed: _processCopiedTextWithAI,
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.white,
                foregroundColor: const Color(0xFF00E5FF),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(20),
                ),
              ),
              child: const Text('Ask AI'),
            ),
            const SizedBox(width: 8),
            IconButton(
              icon: const Icon(Icons.close, color: Colors.white70, size: 20),
              onPressed: () => setState(() => _showCopiedBanner = false),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildWebViewTabsContent() {
    final windowModel = Provider.of<WindowModel>(context, listen: true);

    if (windowModel.webViewTabs.isEmpty) {
      return AartiqHomePage(
        onSearch: (value) {
          final windowModel = Provider.of<WindowModel>(context, listen: false);
          final browserModel =
              Provider.of<BrowserModel>(context, listen: false);
          final settings = browserModel.getSettings();

          var url = Util.resolveAddressInput(
              value, settings.searchEngine.searchUrl);

          // tel:, mailto:, market:, … belong to other apps, not a new tab.
          if (!LinkLauncher.canLoadInWebView(url)) {
            LinkLauncher.openExternalUrl(url, context: context);
            return;
          }

          windowModel.addTab(WebViewTab(
            key: GlobalKey(),
            webViewModel: WebViewModel(url: url),
          ));
        },
      );
    }

    for (final webViewTab in windowModel.webViewTabs) {
      var isCurrentTab =
          webViewTab.webViewModel.tabIndex == windowModel.getCurrentTabIndex();

      if (isCurrentTab) {
        Future.delayed(const Duration(milliseconds: 100), () {
          webViewTabStateKey.currentState?.onShowTab();
        });
      } else {
        webViewTabStateKey.currentState?.onHideTab();
      }
    }

    var stackChildren = <Widget>[
      windowModel.getCurrentTab() ?? Container(),
      _createProgressIndicator()
    ];

    return Column(
      children: [
        Expanded(
            child: Stack(
          children: stackChildren,
        ))
      ],
    );
  }

  Widget _createProgressIndicator() {
    return Selector<WebViewModel, double>(
        selector: (context, webViewModel) => webViewModel.progress,
        builder: (context, progress, child) {
          if (progress >= 1.0) {
            return Container();
          }
          return PreferredSize(
              preferredSize: const Size(double.infinity, 4.0),
              child: SizedBox(
                  height: 4.0,
                  child: Container(
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Color(0xFF00E5FF), Color(0xFFD500F9), Color(0xFF00E5FF)],
                        stops: [0.0, 0.5, 1.0],
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: const Color(0xFF00E5FF).withOpacity(0.5),
                          blurRadius: 8,
                          spreadRadius: 1,
                        ),
                      ],
                    ),
                    child: FractionallySizedBox(
                      alignment: Alignment.centerLeft,
                      widthFactor: progress,
                      child: Container(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            colors: [
                              const Color(0xFF00E5FF),
                              Color.lerp(const Color(0xFF00E5FF), const Color(0xFFD500F9), progress)!,
                            ],
                          ),
                        ),
                      ),
                    ),
                  )));
        });
  }

  Widget _buildWebViewTabsViewer() {
    final browserModel = Provider.of<BrowserModel>(context, listen: true);
    final windowModel = Provider.of<WindowModel>(context, listen: true);

    return WillPopScope(
        onWillPop: () async {
          browserModel.showTabScroller = false;
          return false;
        },
        child: Scaffold(
            appBar: const TabViewerAppBar(),
            body: TabViewer(
              currentIndex: windowModel.getCurrentTabIndex(),
              children: windowModel.webViewTabs.map((webViewTab) {
                webViewTabStateKey.currentState?.pause();
                var screenshotData = webViewTab.webViewModel.screenshot;
                Widget screenshotImage = Container(
                  decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.surface),
                  width: double.infinity,
                  child: screenshotData != null
                      ? Image.memory(screenshotData)
                      : null,
                );

                var url = webViewTab.webViewModel.url;
                var faviconUrl = webViewTab.webViewModel.favicon != null
                    ? webViewTab.webViewModel.favicon!.url
                    : (url != null && ["http", "https"].contains(url.scheme)
                        ? Uri.parse("${url.origin}/favicon.ico")
                        : null);

                var isCurrentTab = windowModel.getCurrentTabIndex() ==
                    webViewTab.webViewModel.tabIndex;

                return Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Material(
                      color: isCurrentTab
                          ? Colors.blue
                          : (webViewTab.webViewModel.isIncognitoMode
                              ? Colors.black
                              : Theme.of(context).colorScheme.surface),
                      child: ListTile(
                        leading: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: <Widget>[
                            // CachedNetworkImage(
                            //   placeholder: (context, url) =>
                            //   url == "about:blank"
                            //       ? Container()
                            //       : CircularProgressIndicator(),
                            //   imageUrl: faviconUrl,
                            //   height: 30,
                            // )
                            CustomImage(
                                url: faviconUrl, maxWidth: 30.0, height: 30.0)
                          ],
                        ),
                        title: Text(
                            webViewTab.webViewModel.title ??
                                webViewTab.webViewModel.url?.toString() ??
                                "",
                            maxLines: 2,
                            style: TextStyle(
                              color: webViewTab.webViewModel.isIncognitoMode ||
                                      isCurrentTab
                                  ? Colors.white
                                  : Theme.of(context).colorScheme.onSurface,
                            ),
                            overflow: TextOverflow.ellipsis),
                        subtitle:
                            Text(webViewTab.webViewModel.url?.toString() ?? "",
                                style: TextStyle(
                                  color:
                                      webViewTab.webViewModel.isIncognitoMode ||
                                              isCurrentTab
                                          ? Colors.white60
                                          : Theme.of(context)
                                              .colorScheme
                                              .onSurface
                                              .withOpacity(0.6),
                                ),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis),
                        isThreeLine: true,
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: <Widget>[
                            IconButton(
                              icon: Icon(
                                Icons.close,
                                size: 20.0,
                                color:
                                    webViewTab.webViewModel.isIncognitoMode ||
                                            isCurrentTab
                                        ? Colors.white60
                                        : Colors.black54,
                              ),
                              onPressed: () {
                                setState(() {
                                  if (webViewTab.webViewModel.tabIndex !=
                                      null) {
                                    windowModel.closeTab(
                                        webViewTab.webViewModel.tabIndex!);
                                    if (windowModel.webViewTabs.isEmpty) {
                                      browserModel.showTabScroller = false;
                                    }
                                  }
                                });
                              },
                            )
                          ],
                        ),
                      ),
                    ),
                    Expanded(
                      child: screenshotImage,
                    )
                  ],
                );
              }).toList(),
              onTap: (index) async {
                browserModel.showTabScroller = false;
                windowModel.showTab(index);
              },
            )));
  }
}

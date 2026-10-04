import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/services.dart';
import 'package:flutter_browser/models/browser_model.dart';
import 'package:flutter_browser/models/webview_model.dart';
import 'package:flutter_browser/models/window_model.dart';
import 'package:flutter_browser/util.dart';
import 'package:flutter_downloader/flutter_downloader.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:provider/provider.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:sqflite/sqflite.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:window_manager_plus/window_manager_plus.dart';
import 'package:path/path.dart' as p;
import 'package:firebase_core/firebase_core.dart';
import 'package:receive_sharing_intent/receive_sharing_intent.dart';
import 'package:app_links/app_links.dart';
import 'sync_service.dart';
import 'auth_service.dart';

import 'browser.dart';
import 'pages/aartiq_home_page.dart';
import 'pages/splash_screen.dart';
import 'pages/connect_desktop_page.dart';
import 'pages/settings/main.dart';
import 'package:google_fonts/google_fonts.dart';
import 'pages/ai_chat_page.dart';
import 'pages/agent_chat_page.dart';
import 'pages/desktop_control_page.dart';
import 'pages/automation_page.dart';
import 'pages/remote_settings_page.dart';
import 'pages/pdf_viewer_page.dart';
import 'pages/auth_page.dart';
import 'pages/action_approval_page.dart';
import 'pages/permission_approval_page.dart';
import 'pages/session_viewer_page.dart';
import 'models/permission_model.dart';

// ignore: non_constant_identifier_names
late final String WEB_ARCHIVE_DIR;
// ignore: non_constant_identifier_names
late final double TAB_VIEWER_BOTTOM_OFFSET_1;
// ignore: non_constant_identifier_names
late final double TAB_VIEWER_BOTTOM_OFFSET_2;
// ignore: non_constant_identifier_names
late final double TAB_VIEWER_BOTTOM_OFFSET_3;
// ignore: constant_identifier_names
const double TAB_VIEWER_TOP_OFFSET_1 = 0.0;
// ignore: constant_identifier_names
const double TAB_VIEWER_TOP_OFFSET_2 = 10.0;
// ignore: constant_identifier_names
const double TAB_VIEWER_TOP_OFFSET_3 = 20.0;
// ignore: constant_identifier_names
const double TAB_VIEWER_TOP_SCALE_TOP_OFFSET = 250.0;
// ignore: constant_identifier_names
const double TAB_VIEWER_TOP_SCALE_BOTTOM_OFFSET = 230.0;

WebViewEnvironment? webViewEnvironment;
Database? db;

int windowId = 0;
String? windowModelId;

// Global key to handle navigation from sharing intents
final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();

void _handleSharedMedia(List<SharedMediaFile> sharedFiles) {
  if (sharedFiles.isEmpty) return;

  final file = sharedFiles.first;

  // Navigate to AI chat with the shared content
  Future.delayed(const Duration(milliseconds: 500), () {
    if (file.type == SharedMediaType.image) {
      navigatorKey.currentState?.pushNamed('/ai-chat',
          arguments: {'initialMessage': 'Explain this image: ${file.path}'});
    } else {
      String message = file.path;
      if (message.startsWith('>>')) {
        navigatorKey.currentState?.pushNamed('/agent-chat',
            arguments: {'task': message.substring(2).trim()});
      } else {
        navigatorKey.currentState
            ?.pushNamed('/ai-chat', arguments: {'initialMessage': message});
      }
    }
  });

  // Clear the sharing intent
  ReceiveSharingIntent.instance.reset();
}

void main(List<String> args) async {
  WidgetsFlutterBinding.ensureInitialized();

  // Handle sharing intents for receiving images from other apps
  if (!Util.isDesktop()) {
    ReceiveSharingIntent.instance.getInitialMedia().then((sharedFiles) {
      if (sharedFiles.isNotEmpty) {
        _handleSharedMedia(sharedFiles);
      }
    });
    ReceiveSharingIntent.instance.getMediaStream().listen((sharedFiles) {
      _handleSharedMedia(sharedFiles);
    });
  }

  if (Util.isDesktop()) {
    windowId = args.isNotEmpty ? int.tryParse(args[0]) ?? 0 : 0;
    windowModelId = args.length > 1 ? args[1] : null;
    await WindowManagerPlus.ensureInitialized(windowId);
  }

  final appDocumentsDir = await getApplicationDocumentsDirectory();

  if (Util.isDesktop()) {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  }
  db = await databaseFactory.openDatabase(
    p.join(appDocumentsDir.path, "databases", "myDb.db"),
    options: OpenDatabaseOptions(
      version: 1,
      singleInstance: false,
      onCreate: (Database db, int version) async {
        await db.execute(
          'CREATE TABLE browser (id INTEGER PRIMARY KEY, json TEXT)',
        );
        await db.execute(
          'CREATE TABLE windows (id TEXT PRIMARY KEY, json TEXT)',
        );
      },
    ),
  );

  if (Util.isDesktop()) {
    WindowOptions windowOptions = WindowOptions(
      center: true,
      backgroundColor: Colors.transparent,
      titleBarStyle:
          Util.isWindows() ? TitleBarStyle.normal : TitleBarStyle.hidden,
      minimumSize: const Size(1280, 720),
      size: const Size(1280, 720),
    );
    WindowManagerPlus.current.waitUntilReadyToShow(windowOptions, () async {
      if (!Util.isWindows()) {
        await WindowManagerPlus.current.setAsFrameless();
        await WindowManagerPlus.current.setHasShadow(true);
      }
      await WindowManagerPlus.current.show();
      await WindowManagerPlus.current.focus();
    });
  }

  WEB_ARCHIVE_DIR = (await getApplicationSupportDirectory()).path;

  TAB_VIEWER_BOTTOM_OFFSET_1 = 150.0;
  TAB_VIEWER_BOTTOM_OFFSET_2 = 160.0;
  TAB_VIEWER_BOTTOM_OFFSET_3 = 170.0;

  if (!kIsWeb && defaultTargetPlatform == TargetPlatform.windows) {
    final availableVersion = await WebViewEnvironment.getAvailableVersion();
    assert(
      availableVersion != null,
      'Failed to find an installed WebView2 Runtime or non-stable Microsoft Edge installation.',
    );

    webViewEnvironment = await WebViewEnvironment.create(
      settings: WebViewEnvironmentSettings(userDataFolder: 'aartiq'),
    );
  }

  if (Util.isMobile()) {
    await FlutterDownloader.initialize(debug: kDebugMode);
  }

  if (Util.isMobile()) {
    await Permission.camera.request();
    await Permission.microphone.request();
    await Permission.storage.request();
  }

  try {
    await Firebase.initializeApp();
    await AuthService().initialize();
    await SyncService().initialize(AuthService().userId ?? 'aartiq-guest');

    if (AuthService().isAuthenticated) {
      SyncService().tryAutoReconnect();
    }

    // Firebase bridge: publish this device's P2P id under the account and
    // sync the shared pairing master key once a real Firebase session exists
    // (both devices signed into the same Google account → same uid).
    AuthService().onAuthStateChanged.listen((user) {
      if (user != null && AuthService().currentFirebaseUser != null) {
        unawaited(
            SyncService().initializeCloud(user['userId'] as String));
      }
    });

    Timer.periodic(const Duration(seconds: 3), (timer) async {
      final data = await Clipboard.getData(Clipboard.kTextPlain);
      if (data?.text != null) {
        SyncService().sendClipboard(data!.text!);
      }
    });
  } catch (e) {
    print('[Sync] Firebase/Sync initialization error: $e');
  }

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (context) => BrowserModel()),
        ChangeNotifierProvider(create: (context) => WebViewModel()),
        ChangeNotifierProxyProvider<WebViewModel, WindowModel>(
          update: (context, webViewModel, windowModel) {
            windowModel!.setCurrentWebViewModel(webViewModel);
            return windowModel;
          },
          create: (BuildContext context) => WindowModel(id: null),
        ),
      ],
      child: const AartiqApp(),
    ),
  );
}

class AartiqApp extends StatefulWidget {
  const AartiqApp({super.key});

  @override
  State<AartiqApp> createState() => _AartiqAppState();
}

class _AartiqAppState extends State<AartiqApp> with WindowListener {
  late final AppLifecycleListener? _appLifecycleListener;
  late final AppLinks _appLinks;
  StreamSubscription<Uri>? _linkSubscription;

  @override
  void initState() {
    super.initState();
    _initDeepLinks();

    if (Util.isDesktop()) {
      WindowManagerPlus.current.addListener(this);

      if (WindowManagerPlus.current.id > 0 && Platform.isMacOS) {
        _appLifecycleListener = AppLifecycleListener(
          onStateChange: _handleStateChange,
        );
      } else {
        _appLifecycleListener = null;
      }
    } else {
      _appLifecycleListener = null;
    }
  }

  Future<void> _initDeepLinks() async {
    _appLinks = AppLinks();

    // Check initial link if app was in cold state (terminated)
    try {
      final initialUri = await _appLinks.getInitialLink();
      if (initialUri != null) {
        _handleDeepLink(initialUri);
      }
    } catch (e) {
      print("Failed to get initial uri: $e");
    }

    // Attach a listener to the stream
    _linkSubscription = _appLinks.uriLinkStream.listen((uri) {
      _handleDeepLink(uri);
    }, onError: (err) {
      print("Failed to handle incoming uri: $err");
    });
  }

  void _handleDeepLink(Uri uri) {
    print('[DeepLink] Received: $uri');
    if (uri.scheme == 'aartiq') {
      if (uri.host == 'connect' || uri.host == 'approve') {
        // Delay to allow navigator to initialize
        Future.delayed(const Duration(milliseconds: 500), () {
          navigatorKey.currentState?.pushNamed('/connect-desktop',
              arguments: {'qrData': uri.toString()});
        });
      } else if (uri.host == 'shell-approve' || uri.host == 'shell') {
        // Shell approval QR code - redirect to approval screen
        final id = uri.queryParameters['id'];
        final deviceId = uri.queryParameters['deviceId'];
        final pin = uri.queryParameters['pin'];
        final command = uri.queryParameters['command'] ?? '';

        Future.delayed(const Duration(milliseconds: 500), () {
          navigatorKey.currentState?.pushNamed('/action-approval', arguments: {
            'approvalId': id,
            'deviceId': deviceId,
            'pin': pin,
            'command': command,
            'fromQR': true,
          });
        });
      } else if (uri.host == 'auth') {
        // Auth deep link - redirect to auth page
        Future.delayed(const Duration(milliseconds: 500), () {
          navigatorKey.currentState
              ?.pushNamedAndRemoveUntil('/auth', (route) => false);
        });
      } else if (uri.host == 'chat') {
        // Handle chat deep link - extract message from path/query
        final message = uri.queryParameters['message'] ?? 'Hello';
        Future.delayed(const Duration(milliseconds: 500), () {
          navigatorKey.currentState?.pushNamed('/ai-chat',
              arguments: {'initialMessage': Uri.decodeComponent(message)});
        });
      }
    }
  }

  void _handleStateChange(AppLifecycleState state) {
    if (WindowManagerPlus.current.id > 0 &&
        Platform.isMacOS &&
        state == AppLifecycleState.hidden) {
      // Corrected way to notify internal observers if needed
      // But typically AppLifecycleListener handles this.
    }
  }

  @override
  void dispose() {
    if (Util.isDesktop()) {
      WindowManagerPlus.current.removeListener(this);
    }
    _appLifecycleListener?.dispose();
    _linkSubscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Aartiq',
      navigatorKey: navigatorKey,
      debugShowCheckedModeBanner: false,
      themeMode: ThemeMode.dark,
      darkTheme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        scaffoldBackgroundColor: Colors.black,
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF00E5FF),
          secondary: Color(0xFFD500F9),
          surface: Color(0xFF121212),
          background: Colors.black,
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: Colors.transparent,
          elevation: 0,
        ),
        textTheme: GoogleFonts.outfitTextTheme(ThemeData.dark().textTheme),
      ),
      theme: ThemeData(
        visualDensity: VisualDensity.adaptivePlatformDensity,
        scaffoldBackgroundColor: Colors.black,
      ),
      initialRoute: '/',
      routes: {
        '/': (context) => const SplashScreen(),
        '/auth': (context) => AuthPage(
              onAuthComplete: () {
                unawaited(SyncService()
                    .initialize(AuthService().userId ?? 'aartiq-guest')
                    .then((_) => SyncService().tryAutoReconnect()));
                navigatorKey.currentState
                    ?.pushNamedAndRemoveUntil('/home', (route) => false);
              },
              onGuestMode: () {
                unawaited(SyncService().initialize('aartiq-guest'));
                navigatorKey.currentState
                    ?.pushNamedAndRemoveUntil('/home', (route) => false);
              },
            ),
        '/home': (context) => const AartiqHomePage(),
        '/connect-desktop': (context) => const ConnectDesktopPage(),
        '/browser': (context) => const Browser(),
        '/settings': (context) => const SettingsPage(),
        '/ai-chat': (context) {
          final args = ModalRoute.of(context)!.settings.arguments
              as Map<String, dynamic>?;
          final message = args?['initialMessage'] ?? "Hello, how can I help?";
          return FullScreenAIChat(initialMessage: message);
        },
        '/agent-chat': (context) {
          final args = ModalRoute.of(context)!.settings.arguments
              as Map<String, dynamic>?;
          final task = args?['task'] ?? "";
          return AgentChatPage(initialTask: task);
        },
        '/desktop-control': (context) => const DesktopControlPage(),
        '/automation': (context) => const AutomationPage(),
        '/remote-settings': (context) => const RemoteSettingsPage(),
        '/pdf-viewer': (context) {
          final args = ModalRoute.of(context)!.settings.arguments
              as Map<String, dynamic>?;
          return PDFViewerPage(
            filePath: args?['filePath'],
            fileUrl: args?['fileUrl'],
            fileName: args?['fileName'],
          );
        },
        '/action-approval': (context) {
          final args = ModalRoute.of(context)!.settings.arguments
              as Map<String, dynamic>?;
          return ActionApprovalPage(
            approvalId: args?['approvalId'],
            deviceId: args?['deviceId'],
            pin: args?['pin'],
            command: args?['command'] ?? '',
            fromQR: args?['fromQR'] ?? false,
          );
        },
        '/session-viewer': (context) => const SessionViewerPage(),
        '/permission-approval': (context) {
          final args = ModalRoute.of(context)!.settings.arguments
              as Map<String, dynamic>?;
          return PermissionApprovalPage(
            request: PermissionRelayRequest.fromJson(args ?? {}),
          );
        },
      },
    );
  }

  @override
  void onWindowFocus([int? windowId]) {
    setState(() {});
    if (Util.isDesktop() && !Util.isWindows()) {
      WindowManagerPlus.current.setAsFrameless();
      WindowManagerPlus.current.setHasShadow(true);
    }
  }

  @override
  void onWindowBlur([int? windowId]) {}
}

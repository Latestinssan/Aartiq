import 'package:flutter_browser/util.dart';

class PopupMenuActions {
  // ignore: constant_identifier_names
  static const String OPEN_NEW_WINDOW = "Open New Window";
  // ignore: constant_identifier_names
  static const String SAVE_WINDOW = "Save Window";
  // ignore: constant_identifier_names
  static const String SAVED_WINDOWS = "Saved Windows";
  // ignore: constant_identifier_names
  static const String NEW_TAB = "New tab";
  // ignore: constant_identifier_names
  static const String NEW_INCOGNITO_TAB = "New incognito tab";
  // ignore: constant_identifier_names
  static const String FAVORITES = "Favorites";
  // ignore: constant_identifier_names
  static const String HISTORY = "History";
  // ignore: constant_identifier_names
  static const String WEB_ARCHIVES = "Web Archives";
  // ignore: constant_identifier_names
  static const String SHARE = "Share";
  // ignore: constant_identifier_names
  static const String OPEN_IN_BROWSER = "Open in external browser";
  // ignore: constant_identifier_names
  static const String FIND_ON_PAGE = "Find on page";
  // ignore: constant_identifier_names
  static const String DESKTOP_MODE = "Desktop site";
  // ignore: constant_identifier_names
  static const String SETTINGS = "Settings";
  // ignore: constant_identifier_names
  static const String DEVELOPERS = "Developers";
  // ignore: constant_identifier_names
  static const String INAPPWEBVIEW_PROJECT = "InAppWebView Project";
  // ignore: constant_identifier_names
  static const String ASK_AI = "Ask AI";
  // ignore: constant_identifier_names
  static const String SYNC_WITH_DESKTOP = "Sync with Desktop";
  // ignore: constant_identifier_names
  static const String ADD_TO_HOME_SCREEN = "Add to Home screen";
  // ignore: constant_identifier_names
  static const String DOWNLOAD = "Download Screenshot";
  // ignore: constant_identifier_names
  static const String ANALYZE_PAGE = "Analyze Page";
  // ignore: constant_identifier_names
  static const String OCR_SCAN = "OCR Scan";
  // ignore: constant_identifier_names
  static const String EXTRACT_DOM = "Extract DOM";

  static List<String> get choices {
    if (Util.isMobile()) {
      return [
        NEW_TAB,
        NEW_INCOGNITO_TAB,
        ASK_AI,
        SYNC_WITH_DESKTOP,
        HISTORY,
        FAVORITES,
        SHARE,
        OPEN_IN_BROWSER,
        DESKTOP_MODE,
        ADD_TO_HOME_SCREEN,
        DOWNLOAD,
        FIND_ON_PAGE,
        SETTINGS,
        DEVELOPERS,
      ];
    }
    return [
      OPEN_NEW_WINDOW,
      SAVE_WINDOW,
      SAVED_WINDOWS,
      NEW_TAB,
      NEW_INCOGNITO_TAB,
      ASK_AI,
      SYNC_WITH_DESKTOP,
      HISTORY,
      FAVORITES,
      SHARE,
      OPEN_IN_BROWSER,
      DESKTOP_MODE,
      FIND_ON_PAGE,
      SETTINGS,
      DEVELOPERS,
    ];
  }
}

import 'package:flutter/material.dart';
import '../auth_service.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:provider/provider.dart';
import '../models/browser_model.dart';
import '../models/window_model.dart';
import '../models/webview_model.dart';
import '../webview_tab.dart';
import 'ai_chat_page.dart';
import 'agent_chat_page.dart';
import '../url_predictor.dart';
import 'dart:ui';

class AartiqHomePage extends StatefulWidget {
  final Function(String)? onSearch;

  const AartiqHomePage({Key? key, this.onSearch}) : super(key: key);

  @override
  State<AartiqHomePage> createState() => _AartiqHomePageState();
}

class _AartiqHomePageState extends State<AartiqHomePage>
    with SingleTickerProviderStateMixin {
  final TextEditingController _searchController = TextEditingController();
  late AnimationController _animationController;
  late Animation<double> _fadeAnimation;
  List<String> _suggestions = [];

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    );
    _fadeAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _animationController, curve: Curves.easeIn),
    );
    _animationController.forward();
  }

  @override
  void dispose() {
    _animationController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  void _handleSearch([String? forcedQuery]) {
    final query = forcedQuery ?? _searchController.text;
    if (query.isNotEmpty) {
      final windowModel = Provider.of<WindowModel>(context, listen: false);

      if (query.startsWith('>>')) {
        final task = query.substring(2).trim();
        if (task.isEmpty) return;
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (context) => AgentChatPage(initialTask: task),
          ),
        );
        return;
      } else if (query.startsWith('>')) {
        final prompt = query.substring(1).trim();
        if (prompt.isEmpty) return;
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (context) => FullScreenAIChat(initialMessage: prompt),
          ),
        );
        return;
      }

      String url = query;
      if (!query.startsWith('http://') && !query.startsWith('https://')) {
        if (query.contains('.') && !query.contains(' ')) {
          url = 'https://$query';
        } else {
          final browserModel =
              Provider.of<BrowserModel>(context, listen: false);
          final searchEngine = browserModel.getSettings().searchEngine;
          url = '${searchEngine.searchUrl}${Uri.encodeComponent(query)}';
        }
      }

      windowModel.addTab(
        WebViewTab(
          key: GlobalKey(),
          webViewModel: WebViewModel(url: WebUri(url)),
        ),
      );

      Navigator.pushNamed(context, '/browser');
    }
  }

  @override
  Widget build(BuildContext context) {
    final browserModel = Provider.of<BrowserModel>(context);
    final settings = browserModel.getSettings();
    final isVibrant = settings.theme == "Vibrant";

    return Scaffold(
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: isVibrant
                ? [
                    const Color(0xFF0F0C29),
                    const Color(0xFF302B63),
                    const Color(0xFF24243E)
                  ]
                : [const Color(0xFF000000), const Color(0xFF0A0A0A)],
          ),
        ),
        child: Stack(
          children: [
            if (isVibrant) ...[
              Positioned(
                top: -100,
                right: -100,
                child: Container(
                  width: 300,
                  height: 300,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: const Color(0xFF00E5FF).withOpacity(0.05),
                  ),
                ),
              ),
              Positioned(
                bottom: -50,
                left: -50,
                child: Container(
                  width: 200,
                  height: 200,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: const Color(0xFFD500F9).withOpacity(0.05),
                  ),
                ),
              ),
            ],
            FadeTransition(
              opacity: _fadeAnimation,
              child: SafeArea(
                child: CustomScrollView(
                  slivers: [
                    SliverFillRemaining(
                      hasScrollBody: false,
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 24.0),
                        child: Column(
                          children: [
                            const SizedBox(height: 16),
                            Align(
                              alignment: Alignment.topRight,
                              child: GestureDetector(
                                onTap: () => Navigator.pushNamed(context, '/settings'),
                                child: StreamBuilder<Map<String, dynamic>?>(
                                  stream: AuthService().onAuthStateChanged,
                                  initialData: AuthService().isAuthenticated
                                      ? {
                                          'photoUrl': AuthService().photoUrl,
                                        }
                                      : null,
                                  builder: (context, snapshot) {
                                    final user = snapshot.data;
                                    final isLoggedIn = user != null &&
                                        !user['userId'].toString().startsWith('guest_');
                                    final photoUrl = user?['photoUrl'];

                                    if (isLoggedIn && photoUrl != null) {
                                      return Container(
                                        decoration: BoxDecoration(
                                          shape: BoxShape.circle,
                                          border: Border.all(
                                            color: const Color(0xFF00E5FF).withOpacity(0.5),
                                            width: 1.5,
                                          ),
                                        ),
                                        child: CircleAvatar(
                                          radius: 18,
                                          backgroundImage: NetworkImage(photoUrl),
                                        ),
                                      );
                                    }
                                    return Container(
                                      padding: const EdgeInsets.all(8),
                                      decoration: BoxDecoration(
                                        shape: BoxShape.circle,
                                        color: Colors.white.withOpacity(0.05),
                                        border: Border.all(color: Colors.white10),
                                      ),
                                      child: const Icon(
                                        Icons.settings_outlined,
                                        color: Color(0xFF00E5FF),
                                        size: 20,
                                      ),
                                    );
                                  },
                                ),
                              ),
                            ),
                            const SizedBox(height: 32),
                            _buildModernLogo(settings),
                            const SizedBox(height: 40),
                            _buildAddressSearchBar(settings),
                            _buildSuggestions(),
                            const SizedBox(height: 48),
                            _buildBookmarksSection(settings, browserModel),
                            const Spacer(),
                            _buildQuickFeatures(context),
                            const SizedBox(height: 40),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildModernLogo(BrowserSettings settings) {
    return Column(
      children: [
        Container(
          width: 180,
          height: 180,
          decoration: const BoxDecoration(
            shape: BoxShape.circle,
            color: Colors.transparent,
          ),
          child: Center(
            child: Image.asset(
              'assets/icon/icon.png',
              width: 140,
              height: 140,
              fit: BoxFit.cover,
              errorBuilder: (context, error, stackTrace) => const Icon(
                  Icons.rocket_launch,
                  size: 140,
                  color: Colors.white),
            ),
          ),
        ),
        const SizedBox(height: 20),
        Text(
          settings.logoName.toUpperCase(),
          style: const TextStyle(
            color: Colors.white,
            fontSize: 24,
            fontWeight: FontWeight.w900,
            letterSpacing: 10,
          ),
        ),
      ],
    );
  }

  Widget _buildAddressSearchBar(BrowserSettings settings) {
    return Container(
      height: 60,
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.08),
        borderRadius: BorderRadius.circular(30),
        border: Border.all(color: Colors.white.withOpacity(0.1)),
      ),
      child: Row(
        children: [
          const SizedBox(width: 20),
          const Icon(Icons.search, color: Colors.white54, size: 24),
          const SizedBox(width: 16),
          Expanded(
            child: TextField(
              controller: _searchController,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white, fontSize: 16),
              decoration: InputDecoration(
                hintText: "Search or enter address",
                hintStyle: TextStyle(color: Colors.white.withOpacity(0.3)),
                border: InputBorder.none,
              ),
              onChanged: (value) {
                if (settings.urlPredictorEnabled) {
                  setState(() {
                    _suggestions = URLPredictor.getPredictions(value);
                  });
                } else if (_suggestions.isNotEmpty) {
                  setState(() {
                    _suggestions = [];
                  });
                }
              },
              onSubmitted: (_) => _handleSearch(),
            ),
          ),
          const SizedBox(width: 16),
          _buildActionButton(Icons.add, () => _handleSearch()),
          const SizedBox(width: 8),
        ],
      ),
    );
  }

  Widget _buildActionButton(IconData icon, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: Colors.white.withOpacity(0.05),
          shape: BoxShape.circle,
        ),
        child: Icon(icon, color: Colors.white.withOpacity(0.6), size: 20),
      ),
    );
  }

  Widget _buildSuggestions() {
    if (_suggestions.isEmpty) return const SizedBox.shrink();
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.8),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: Colors.white.withOpacity(0.05)),
      ),
      child: Column(
        children: _suggestions
            .map((s) => ListTile(
                  title: Text(s,
                      style:
                          const TextStyle(color: Colors.white70, fontSize: 14)),
                  leading: const Icon(Icons.history,
                      color: Colors.white24, size: 18),
                  onTap: () {
                    _searchController.text = s;
                    _handleSearch();
                  },
                ))
            .toList(),
      ),
    );
  }

  Widget _buildBookmarksSection(
      BrowserSettings settings, BrowserModel browserModel) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              "BOOKMARKS",
              style: TextStyle(
                  color: Colors.white38,
                  fontSize: 10,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 2),
            ),
            IconButton(
              icon: const Icon(Icons.add, color: Colors.white24, size: 16),
              onPressed: () => _showAddShortcutDialog(settings, browserModel),
            ),
          ],
        ),
        const SizedBox(height: 16),
        Wrap(
          spacing: 24,
          runSpacing: 24,
          children: settings.homePageShortcuts
              .map((e) => _buildBookmarkItem(e))
              .toList(),
        ),
      ],
    );
  }

  Widget _buildBookmarkItem(Map<String, String> shortcut) {
    final customLogo = shortcut['logo'];
    return GestureDetector(
      onTap: () => _handleSearch(shortcut['url']),
      onLongPress: () => _showEditShortcutDialog(shortcut),
      child: Column(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.05),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: Colors.white.withOpacity(0.05)),
            ),
            child: Center(
              child: customLogo != null && customLogo.isNotEmpty
                  ? ClipRRect(
                      borderRadius: BorderRadius.circular(12),
                      child: Image.network(
                        customLogo,
                        width: 36,
                        height: 36,
                        fit: BoxFit.cover,
                        errorBuilder: (context, error, stackTrace) =>
                            const Icon(Icons.public,
                                color: Colors.white54, size: 24),
                      ),
                    )
                  : const Icon(Icons.public, color: Colors.white54, size: 24),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            shortcut['name']!,
            style: const TextStyle(color: Colors.white54, fontSize: 10),
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }

  Widget _buildQuickFeatures(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: [
        _buildFeatureIcon(Icons.history_edu_rounded, "Sessions",
            () => Navigator.pushNamed(context, '/session-viewer')),
        _buildFeatureIcon(Icons.bookmark, "Bookmarks",
            () => Navigator.pushNamed(context, '/bookmarks')),
        _buildFeatureIcon(Icons.terminal_rounded, "Control",
            () => Navigator.pushNamed(context, '/desktop-control')),
        _buildFeatureIcon(Icons.qr_code, "Sync",
            () => Navigator.pushNamed(context, '/connect-desktop')),
      ],
    );
  }

  Widget _buildFeatureIcon(IconData icon, String label, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Column(
        children: [
          Icon(icon, color: Colors.white30, size: 24),
          const SizedBox(height: 8),
          Text(label,
              style: const TextStyle(color: Colors.white30, fontSize: 10)),
        ],
      ),
    );
  }

  void _showAgentDialog() {
    final controller = TextEditingController();
    showDialog(
      context: context,
      builder: (context) => BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
        child: AlertDialog(
          backgroundColor: Colors.black.withOpacity(0.8),
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(32),
              side: const BorderSide(color: Colors.white12)),
          title: const Text("Aartiq Neural Agent",
              style:
                  TextStyle(color: Colors.white, fontWeight: FontWeight.w900)),
          content: TextField(
            controller: controller,
            style: const TextStyle(color: Colors.white),
            decoration: InputDecoration(
              hintText: "Issue a command...",
              hintStyle: TextStyle(color: Colors.white24),
              filled: true,
              fillColor: Colors.white.withOpacity(0.05),
              border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(16),
                  borderSide: BorderSide.none),
            ),
            onSubmitted: (val) {
              Navigator.pop(context);
              Navigator.push(
                  context,
                  MaterialPageRoute(
                      builder: (c) => AgentChatPage(initialTask: val)));
            },
          ),
        ),
      ),
    );
  }

  void _showAddShortcutDialog(
      BrowserSettings settings, BrowserModel browserModel) {
    final nameController = TextEditingController();
    final urlController = TextEditingController();
    final logoController = TextEditingController();
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF1A1A1A),
        title:
            const Text("Add Shortcut", style: TextStyle(color: Colors.white)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
                controller: nameController,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(labelText: "Name")),
            TextField(
                controller: urlController,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(labelText: "URL")),
            TextField(
                controller: logoController,
                style: const TextStyle(color: Colors.white),
                decoration:
                    const InputDecoration(labelText: "Logo URL (optional)")),
          ],
        ),
        actions: [
          ElevatedButton(
            onPressed: () {
              if (nameController.text.isNotEmpty &&
                  urlController.text.isNotEmpty) {
                final newShortcuts =
                    List<Map<String, String>>.from(settings.homePageShortcuts);
                newShortcuts.add({
                  'name': nameController.text,
                  'url': urlController.text,
                  'logo': logoController.text,
                });
                settings.homePageShortcuts = newShortcuts;
                browserModel.updateSettings(settings);
                browserModel.save();
                Navigator.pop(context);
                setState(() {});
              }
            },
            child: const Text("Add"),
          ),
        ],
      ),
    );
  }

  void _showEditShortcutDialog(Map<String, String> shortcut) {
    final browserModel = Provider.of<BrowserModel>(context, listen: false);
    final settings = browserModel.getSettings();
    final nameController = TextEditingController(text: shortcut['name']);
    final urlController = TextEditingController(text: shortcut['url']);
    final logoController = TextEditingController(text: shortcut['logo'] ?? '');

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF1A1A1A),
        title:
            const Text("Edit Shortcut", style: TextStyle(color: Colors.white)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
                controller: nameController,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(labelText: "Name")),
            TextField(
                controller: urlController,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(labelText: "URL")),
            TextField(
                controller: logoController,
                style: const TextStyle(color: Colors.white),
                decoration:
                    const InputDecoration(labelText: "Logo URL (optional)")),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () {
              final index = settings.homePageShortcuts.indexOf(shortcut);
              if (index != -1) {
                settings.homePageShortcuts.removeAt(index);
                browserModel.updateSettings(settings);
                browserModel.save();
              }
              Navigator.pop(context);
              setState(() {});
            },
            child: const Text("Delete", style: TextStyle(color: Colors.red)),
          ),
          ElevatedButton(
            onPressed: () {
              if (nameController.text.isNotEmpty &&
                  urlController.text.isNotEmpty) {
                final index = settings.homePageShortcuts.indexOf(shortcut);
                if (index != -1) {
                  settings.homePageShortcuts[index] = {
                    'name': nameController.text,
                    'url': urlController.text,
                    'logo': logoController.text,
                  };
                  browserModel.updateSettings(settings);
                  browserModel.save();
                }
                Navigator.pop(context);
                setState(() {});
              }
            },
            child: const Text("Save"),
          ),
        ],
      ),
    );
  }
}

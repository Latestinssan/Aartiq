import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_browser/auth_service.dart';
import 'package:flutter_browser/models/browser_model.dart';
import 'package:flutter_browser/pages/settings/android_settings.dart';
import 'package:flutter_browser/pages/settings/cross_platform_settings.dart';
import 'package:flutter_browser/pages/settings/ios_settings.dart';
import 'package:flutter_browser/util.dart';
import 'package:provider/provider.dart';

class SettingsPage extends StatefulWidget {
  const SettingsPage({super.key});

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  /// Same channel the Android side uses for intent data; it also exposes
  /// `openDefaultBrowserSettings`.
  static const MethodChannel _systemChannel =
      MethodChannel('com.aartiq.intent_data');
  Widget _buildGoogleProfileSection(BuildContext context, Map<String, dynamic>? user, bool isLoggedIn) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.05),
        borderRadius: BorderRadius.circular(15),
        border: Border.all(
          color: const Color(0xFF00E5FF).withOpacity(0.2),
        ),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            const Color(0xFF00E5FF).withOpacity(0.05),
            Colors.white.withOpacity(0.02),
          ],
        ),
      ),
      child: isLoggedIn
          ? Row(
              children: [
                CircleAvatar(
                  radius: 28,
                  backgroundColor: const Color(0xFF00E5FF).withOpacity(0.1),
                  backgroundImage: user?['photoUrl'] != null
                      ? NetworkImage(user!['photoUrl'])
                      : null,
                  child: user?['photoUrl'] == null
                      ? const Icon(Icons.person, color: Color(0xFF00E5FF), size: 30)
                      : null,
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        user?['displayName'] ?? 'Aartiq User',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          fontFamily: 'Outfit',
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        user?['email'] ?? 'No email associated',
                        style: TextStyle(
                          color: Colors.white.withOpacity(0.6),
                          fontSize: 13,
                          fontFamily: 'Outfit',
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.logout_outlined, color: Colors.redAccent),
                  onPressed: () async {
                    await AuthService().signOut();
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Signed out successfully')),
                      );
                    }
                  },
                ),
              ],
            )
          : InkWell(
              onTap: () async {
                final success = await AuthService().signInWithGoogle();
                if (success && context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Signed in with Google successfully')),
                  );
                } else if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Failed to sign in with Google')),
                  );
                }
              },
              borderRadius: BorderRadius.circular(15),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 28,
                    backgroundColor: Colors.white.withOpacity(0.1),
                    child: const Icon(Icons.login, color: Color(0xFF00E5FF), size: 28),
                  ),
                  const SizedBox(width: 16),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Sign in with Google',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                            fontFamily: 'Outfit',
                          ),
                        ),
                        SizedBox(height: 4),
                        Text(
                          'Sync your tabs, settings & history',
                          style: TextStyle(
                            color: Colors.white60,
                            fontSize: 12,
                            fontFamily: 'Outfit',
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Icon(Icons.chevron_right, color: Colors.white30),
                ],
              ),
            ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Text(
          'Settings',
          style: TextStyle(fontFamily: 'Outfit', fontWeight: FontWeight.bold),
        ),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Color(0xFF00E5FF)),
          onPressed: () => Navigator.pop(context),
        ),
      ),
      body: StreamBuilder<Map<String, dynamic>?>(
        stream: AuthService().onAuthStateChanged,
        initialData: AuthService().isAuthenticated
            ? {
                'userId': AuthService().userId,
                'email': AuthService().userEmail,
                'displayName': AuthService().displayName,
                'photoUrl': AuthService().photoUrl,
              }
            : null,
        builder: (context, snapshot) {
          final user = snapshot.data;
          final isLoggedIn = user != null &&
              user['userId'] != null &&
              !user['userId'].toString().startsWith('guest_');

          return ListView(
            padding: const EdgeInsets.all(20),
            children: [
              _buildGoogleProfileSection(context, user, isLoggedIn),
              const SizedBox(height: 25),
              _buildSectionHeader('Appearance & Theme'),
              _buildSettingsTile(
                context,
                'Themes',
                'Dark, Vibrant, Glass, Minimal',
                Icons.palette_outlined,
                () => _openSettingsTab(
                  context,
                  const _ThemesSettingsTab(),
                  'Themes',
                ),
              ),
              _buildSettingsTile(
                context,
                'Layout',
                'Default, Compact, Sidebar',
                Icons.dashboard_customize_outlined,
                () => _openSettingsTab(
                  context,
                  const _LayoutSettingsTab(),
                  'Layout',
                ),
              ),
              const SizedBox(height: 20),
              _buildSectionHeader('AI Models'),
              _buildSettingsTile(
                context,
                'AI Model Settings',
                'Configure Gemini, OpenAI, Groq models',
                Icons.psychology_outlined,
                () => _openSettingsTab(
                  context,
                  const _AIModelsSettingsTab(),
                  'AI Models',
                ),
              ),
              const SizedBox(height: 20),
              _buildSectionHeader('Sync & Connection'),
              _buildSettingsTile(
                context,
                'Connect Desktop',
                'Sync with PC browser',
                Icons.desktop_windows_outlined,
                () => Navigator.pushNamed(context, '/connect-desktop'),
              ),
              const SizedBox(height: 20),
              _buildSectionHeader('Browser Preferences'),
              _buildSettingsTile(
                context,
                'General Settings',
                'Search engine, home page, etc.',
                Icons.language_outlined,
                () => _openSettingsTab(
                  context,
                  const CrossPlatformSettings(),
                  'General Settings',
                ),
              ),
              _buildSettingsTile(
                context,
                'Android Specific',
                'Native Android browser settings',
                Icons.android_outlined,
                () => _openSettingsTab(
                  context,
                  const AndroidSettings(),
                  'Android Settings',
                ),
              ),
              _buildSettingsTile(
                context,
                'iOS Specific',
                'Native iOS browser settings',
                Icons.apple_outlined,
                () =>
                    _openSettingsTab(context, const IOSSettings(), 'iOS Settings'),
              ),
              _buildSettingsTile(
                context,
                'Set as Default Browser',
                'Make Aartiq your primary browser',
                Icons.star_outline,
                () => _setAsDefaultBrowser(context),
              ),
              const SizedBox(height: 20),
              _buildSectionHeader('Maintenance'),
              _buildSettingsTile(
                context,
                'Reset Browser Settings',
                'Restore default settings',
                Icons.refresh_outlined,
                () => _showResetDialog(context),
                isDestructive: true,
              ),
            ],
          );
        },
      ),
    );
  }

  void _openSettingsTab(BuildContext context, Widget child, String title) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => Scaffold(
          backgroundColor: Colors.black,
          appBar: AppBar(
            backgroundColor: Colors.transparent,
            elevation: 0,
            title: Text(title, style: const TextStyle(fontFamily: 'Outfit')),
            leading: IconButton(
              icon: const Icon(Icons.arrow_back, color: Color(0xFF00E5FF)),
              onPressed: () => Navigator.pop(context),
            ),
          ),
          body: child,
        ),
      ),
    );
  }

  Widget _buildSectionHeader(String title) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10, left: 5),
      child: Text(
        title.toUpperCase(),
        style: TextStyle(
          color: const Color(0xFF00E5FF).withOpacity(0.7),
          fontSize: 12,
          fontWeight: FontWeight.bold,
          letterSpacing: 1.2,
        ),
      ),
    );
  }

  Widget _buildSettingsTile(
    BuildContext context,
    String title,
    String subtitle,
    IconData icon,
    VoidCallback onTap, {
    bool isDestructive = false,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.05),
        borderRadius: BorderRadius.circular(15),
        border: Border.all(
          color: isDestructive
              ? Colors.redAccent.withOpacity(0.3)
              : const Color(0xFF00E5FF).withOpacity(0.1),
        ),
      ),
      child: ListTile(
        onTap: onTap,
        leading: Icon(
          icon,
          color: isDestructive ? Colors.redAccent : const Color(0xFF00E5FF),
        ),
        title: Text(
          title,
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w600,
          ),
        ),
        subtitle: Text(
          subtitle,
          style: TextStyle(color: Colors.white.withOpacity(0.5), fontSize: 13),
        ),
        trailing: Icon(
          Icons.chevron_right,
          color: Colors.white.withOpacity(0.3),
        ),
      ),
    );
  }

  void _setAsDefaultBrowser(BuildContext context) async {
    if (Util.isAndroid()) {
      // Ask Android for the browser role (Android 10+), falling back to the
      // Default apps settings screen.
      String? status;
      try {
        status = await _systemChannel
            .invokeMethod<String>('openDefaultBrowserSettings');
      } catch (e) {
        status = null;
      }

      if (!context.mounted) return;

      final String message;
      switch (status) {
        case 'already':
          message = 'Aartiq is already your default browser.';
          break;
        case 'granted':
          message = 'Aartiq is now your default browser.';
          break;
        case 'settings':
          message = 'Pick Aartiq in the Default apps list to finish.';
          break;
        case 'denied':
          message = 'Aartiq was not set as the default browser.';
          break;
        default:
          message = 'Could not open the default browser settings.';
      }

      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(message)));
      return;
    }

    if (Util.isIOS()) {
      // iOS does not expose an API for this — walk the user through Settings.
      showDialog(
        context: context,
        builder: (context) => AlertDialog(
          backgroundColor: const Color(0xFF121212),
          title: const Text(
            'Set as Default Browser',
            style: TextStyle(color: Colors.white),
          ),
          content: const Text(
            'iPhone apps cannot change this themselves.\n\n'
            'Open Settings → Aartiq → Default Browser App and choose Aartiq.',
            style: TextStyle(color: Colors.white70),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text(
                'OK',
                style: TextStyle(color: Color(0xFF00E5FF)),
              ),
            ),
          ],
        ),
      );
      return;
    }

    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please set Aartiq as default in your System Settings.'),
        ),
      );
    }
  }

  void _showResetDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF121212),
        title: const Text(
          'Reset Settings?',
          style: TextStyle(color: Colors.white),
        ),
        content: const Text(
          'This will restore all browser settings to their defaults. This action cannot be undone.',
          style: TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text(
              'CANCEL',
              style: TextStyle(color: Colors.white60),
            ),
          ),
          TextButton(
            onPressed: () {
              final browserModel = Provider.of<BrowserModel>(
                context,
                listen: false,
              );
              browserModel.updateSettings(BrowserSettings());
              browserModel.save();
              Navigator.pop(context);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Settings reset successfully')),
              );
            },
            child: const Text(
              'RESET',
              style: TextStyle(color: Colors.redAccent),
            ),
          ),
        ],
      ),
    );
  }
}

class _ThemesSettingsTab extends StatelessWidget {
  const _ThemesSettingsTab();

  @override
  Widget build(BuildContext context) {
    return Consumer<BrowserModel>(
      builder: (context, browserModel, child) {
        final settings = browserModel.getSettings();
        return ListView(
          padding: const EdgeInsets.all(20),
          children: [
            _buildThemeOption(context, browserModel, settings, 'Dark',
                Colors.black, 'Classic dark theme'),
            _buildThemeOption(context, browserModel, settings, 'Vibrant',
                const Color(0xFF1A1A2E), 'Colorful gradient theme'),
            _buildThemeOption(context, browserModel, settings, 'Glass',
                const Color(0xFF2D2D3A), 'Glassmorphism style'),
            _buildThemeOption(context, browserModel, settings, 'Minimal',
                const Color(0xFF121212), 'Clean minimal look'),
            _buildThemeOption(context, browserModel, settings, 'Ocean',
                const Color(0xFF0A192F), 'Deep ocean blue'),
            _buildThemeOption(context, browserModel, settings, 'Sunset',
                const Color(0xFF2C1332), 'Warm sunset colors'),
            _buildThemeOption(context, browserModel, settings, 'Forest',
                const Color(0xFF1B2D1B), 'Nature green theme'),
            _buildThemeOption(context, browserModel, settings, 'Purple',
                const Color(0xFF1E1B2E), 'Purple night theme'),
          ],
        );
      },
    );
  }

  Widget _buildThemeOption(
      BuildContext context,
      BrowserModel browserModel,
      BrowserSettings settings,
      String themeName,
      Color color,
      String description) {
    final isSelected = settings.theme == themeName;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: isSelected
            ? color.withOpacity(0.3)
            : Colors.white.withOpacity(0.05),
        borderRadius: BorderRadius.circular(15),
        border: Border.all(
          color: isSelected ? const Color(0xFF00E5FF) : Colors.transparent,
          width: 2,
        ),
      ),
      child: ListTile(
        onTap: () {
          settings.theme = themeName;
          browserModel.updateSettings(settings);
          browserModel.save();
          (context as Element).markNeedsBuild();
        },
        leading: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: Colors.white24),
          ),
        ),
        title: Text(
          themeName,
          style:
              const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
        ),
        subtitle: Text(
          description,
          style: TextStyle(color: Colors.white.withOpacity(0.5), fontSize: 12),
        ),
        trailing: isSelected
            ? const Icon(Icons.check_circle, color: Color(0xFF00E5FF))
            : const Icon(Icons.circle_outlined, color: Colors.white24),
      ),
    );
  }
}

class _LayoutSettingsTab extends StatelessWidget {
  const _LayoutSettingsTab();

  @override
  Widget build(BuildContext context) {
    return Consumer<BrowserModel>(
      builder: (context, browserModel, child) {
        final settings = browserModel.getSettings();
        return ListView(
          padding: const EdgeInsets.all(20),
          children: [
            _buildLayoutOption(context, browserModel, settings, 'Default',
                'Standard browser layout'),
            _buildLayoutOption(context, browserModel, settings, 'Compact',
                'Smaller UI elements'),
            _buildLayoutOption(context, browserModel, settings, 'Sidebar',
                'Side navigation panel'),
            _buildLayoutOption(context, browserModel, settings, 'Fullscreen',
                'Hide UI for maximum space'),
          ],
        );
      },
    );
  }

  Widget _buildLayoutOption(BuildContext context, BrowserModel browserModel,
      BrowserSettings settings, String layout, String description) {
    final isSelected = settings.layout == layout;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: isSelected
            ? Colors.white.withOpacity(0.1)
            : Colors.white.withOpacity(0.05),
        borderRadius: BorderRadius.circular(15),
        border: Border.all(
          color: isSelected ? const Color(0xFF00E5FF) : Colors.transparent,
          width: 2,
        ),
      ),
      child: ListTile(
        onTap: () {
          settings.layout = layout;
          browserModel.updateSettings(settings);
          browserModel.save();
          (context as Element).markNeedsBuild();
        },
        leading: Icon(
          layout == 'Default'
              ? Icons.view_agenda_outlined
              : layout == 'Compact'
                  ? Icons.view_comfortable_outlined
                  : layout == 'Sidebar'
                      ? Icons.view_sidebar_outlined
                      : Icons.fullscreen_outlined,
          color: isSelected ? const Color(0xFF00E5FF) : Colors.white54,
        ),
        title: Text(
          layout,
          style:
              const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
        ),
        subtitle: Text(
          description,
          style: TextStyle(color: Colors.white.withOpacity(0.5), fontSize: 12),
        ),
        trailing: isSelected
            ? const Icon(Icons.check_circle, color: Color(0xFF00E5FF))
            : const Icon(Icons.circle_outlined, color: Colors.white24),
      ),
    );
  }
}

class _AIModelsSettingsTab extends StatefulWidget {
  const _AIModelsSettingsTab();

  @override
  State<_AIModelsSettingsTab> createState() => _AIModelsSettingsTabState();
}

class _AIModelsSettingsTabState extends State<_AIModelsSettingsTab> {
  String _selectedProvider = 'Google';
  late BrowserModel _browserModel;

  final TextEditingController _apiKeyController = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _browserModel = Provider.of<BrowserModel>(context, listen: false);
      _updateApiKeyController();
    });
  }

  void _updateApiKeyController() {
    final settings = _browserModel.getSettings();
    if (_selectedProvider == 'Google') {
      _apiKeyController.text = settings.geminiApiKey;
    } else if (_selectedProvider == 'OpenAI') {
      _apiKeyController.text = settings.openaiApiKey;
    } else {
      _apiKeyController.text = settings.claudeApiKey;
    }
  }

  void _saveApiKey(String key) {
    final settings = _browserModel.getSettings();
    if (_selectedProvider == 'Google') {
      settings.geminiApiKey = key;
    } else if (_selectedProvider == 'OpenAI') {
      settings.openaiApiKey = key;
    } else {
      settings.claudeApiKey = key;
    }
    _browserModel.updateSettings(settings);
    _browserModel.save();
  }

  void _saveModel(String modelId, String provider) {
    final settings = _browserModel.getSettings();
    settings.geminiModel = modelId;
    settings.aiProvider = provider;
    _browserModel.updateSettings(settings);
    _browserModel.save();
  }

  String _getCurrentModel() {
    return _browserModel.getSettings().geminiModel;
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<BrowserModel>(
      builder: (context, browserModel, child) {
        _browserModel = browserModel;
        final currentModel = browserModel.getSettings().geminiModel;

        return ListView(
          padding: const EdgeInsets.all(20),
          children: [
            const Text(
              'SELECT PROVIDER',
              style: TextStyle(
                  color: Color(0xFF00E5FF),
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1),
            ),
            Wrap(
              spacing: 10,
              children: [
                _buildProviderChip('Google', Icons.cloud),
                _buildProviderChip('OpenAI', Icons.psychology),
                _buildProviderChip('Groq', Icons.speed),
              ],
            ),
            const SizedBox(height: 25),
            const Text(
              'API KEY',
              style: TextStyle(
                  color: Color(0xFF00E5FF),
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1),
            ),
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.05),
                borderRadius: BorderRadius.circular(12),
                border:
                    Border.all(color: const Color(0xFF00E5FF).withOpacity(0.2)),
              ),
              child: TextField(
                controller: _apiKeyController,
                obscureText: true,
                style: const TextStyle(color: Colors.white, fontSize: 14),
                decoration: const InputDecoration(
                  hintText: 'Enter your API key...',
                  hintStyle: TextStyle(color: Colors.white24),
                  border: InputBorder.none,
                ),
                onChanged: _saveApiKey,
              ),
            ),
            const SizedBox(height: 25),
            if (_selectedProvider == 'Google') ...[
              const Text(
                'GOOGLE GEMINI MODELS',
                style: TextStyle(
                    color: Color(0xFF00E5FF),
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 1),
              ),
              const SizedBox(height: 10),
              _buildModelTile('gemini-2.5-flash', 'Gemini 2.5 Flash ✨',
                  'Stable, fast, cost-effective', currentModel, 'Google'),
              _buildModelTile('gemini-2.5-flash-lite', 'Gemini 2.5 Flash Lite',
                  'Lowest cost, 1.5x faster', currentModel, 'Google'),
              _buildModelTile('gemini-2.5-pro', 'Gemini 2.5 Pro',
                  'Flagship, deep understanding', currentModel, 'Google'),
              _buildModelTile('gemini-2.0-flash', 'Gemini 2.0 Flash',
                  'Fast response model', currentModel, 'Google'),
              _buildModelTile('gemini-2.0-pro', 'Gemini 2.0 Pro',
                  'Advanced capabilities', currentModel, 'Google'),
              _buildModelTile('gemini-1.5-pro', 'Gemini 1.5 Pro',
                  '1M token context', currentModel, 'Google'),
              _buildModelTile('gemini-1.5-flash', 'Gemini 1.5 Flash',
                  'Balanced speed/quality', currentModel, 'Google'),
            ],
            if (_selectedProvider == 'OpenAI') ...[
              const Text(
                'OPENAI MODELS (GPT-5 Series)',
                style: TextStyle(
                    color: Color(0xFF00E5FF),
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 1),
              ),
              const SizedBox(height: 10),
              _buildModelTile('gpt-5.2', 'GPT-5.2 ✨',
                  'Current flagship reasoning', currentModel, 'OpenAI'),
              _buildModelTile('gpt-5.3-codex', 'GPT-5.3 Codex',
                  'Best agentic coding', currentModel, 'OpenAI'),
              _buildModelTile('gpt-4.1', 'GPT-4.1',
                  '1M token, best non-reasoning', currentModel, 'OpenAI'),
              _buildModelTile('gpt-4.1-mini', 'GPT-4.1 Mini',
                  'Fast & affordable', currentModel, 'OpenAI'),
              _buildModelTile('gpt-4.1-nano', 'GPT-4.1 Nano',
                  'Cheapest & fastest', currentModel, 'OpenAI'),
              _buildModelTile('o3', 'o3 Reasoning', 'Math & science reasoning',
                  currentModel, 'OpenAI'),
              _buildModelTile('o4-mini', 'o4-mini',
                  'Fast cost-efficient reasoning', currentModel, 'OpenAI'),
            ],
            if (_selectedProvider == 'Groq') ...[
              const Text(
                'GROQ MODELS (Ultra-Low Latency)',
                style: TextStyle(
                    color: Color(0xFF00E5FF),
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 1),
              ),
              const SizedBox(height: 10),
              _buildModelTile('llama-3.3-70b-versatile', 'Llama 3.3 70B ✨',
                  'Best all-round, 128K context', currentModel, 'Groq'),
              _buildModelTile('llama-3.1-8b-instant', 'Llama 3.1 8B Instant',
                  'Fastest ~900 t/s', currentModel, 'Groq'),
              _buildModelTile(
                  'deepseek-r1-distill-llama-70b',
                  'DeepSeek R1 70B 🧠',
                  'Reasoning model, math/coding',
                  currentModel,
                  'Groq'),
              _buildModelTile('groq/compound', 'Groq Compound',
                  'Agentic with web search', currentModel, 'Groq'),
              _buildModelTile('qwen/qwen3-32b', 'Qwen3 32B',
                  'Thinking mode support', currentModel, 'Groq'),
              _buildModelTile('moonshotai/kimi-k2-instruct-0905',
                  'Kimi K2 0905', '1T param MoE agentic', currentModel, 'Groq'),
              _buildModelTile('openai/gpt-oss-120b', 'GPT-OSS 120B',
                  'Highest intel on Groq', currentModel, 'Groq'),
            ],
          ],
        );
      },
    );
  }

  Widget _buildProviderChip(String provider, IconData icon) {
    final isSelected = _selectedProvider == provider;
    return GestureDetector(
      onTap: () {
        setState(() => _selectedProvider = provider);
        _updateApiKeyController();
      },
      child: Container(
        margin: const EdgeInsets.only(right: 10),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: isSelected
              ? const Color(0xFF00E5FF).withOpacity(0.2)
              : Colors.white.withOpacity(0.05),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isSelected ? const Color(0xFF00E5FF) : Colors.transparent,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon,
                size: 16,
                color: isSelected ? const Color(0xFF00E5FF) : Colors.white54),
            const SizedBox(width: 6),
            Text(
              provider,
              style: TextStyle(
                color: isSelected ? const Color(0xFF00E5FF) : Colors.white,
                fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildModelTile(String modelId, String name, String description,
      String currentModel, String provider) {
    final isSelected = currentModel == modelId;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: isSelected
            ? Colors.white.withOpacity(0.1)
            : Colors.white.withOpacity(0.03),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: isSelected ? const Color(0xFF00E5FF) : Colors.transparent,
        ),
      ),
      child: ListTile(
        dense: true,
        title: Text(
          name,
          style: TextStyle(
            color: isSelected ? const Color(0xFF00E5FF) : Colors.white,
            fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
          ),
        ),
        subtitle: Text(
          description,
          style: TextStyle(color: Colors.white.withOpacity(0.4), fontSize: 11),
        ),
        trailing: isSelected
            ? const Icon(Icons.check_circle, color: Color(0xFF00E5FF), size: 20)
            : null,
        onTap: () {
          _saveModel(modelId, provider);
          setState(() {});
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
                content: Text('Selected: $name'),
                duration: const Duration(seconds: 1)),
          );
        },
      ),
    );
  }
}

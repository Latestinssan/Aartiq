import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../sync_service.dart';

class DesktopControlPage extends StatefulWidget {
  const DesktopControlPage({Key? key}) : super(key: key);

  @override
  State<DesktopControlPage> createState() => _DesktopControlPageState();
}

class _DesktopControlPageState extends State<DesktopControlPage>
    with SingleTickerProviderStateMixin {
  final TextEditingController _promptController = TextEditingController();
  final List<Map<String, dynamic>> _messages = [];
  final ScrollController _scrollController = ScrollController();
  bool _isLoading = false;
  bool _isConnected = false;
  Map<String, dynamic>? _desktopStatus;
  String? _selectedModel;
  StreamSubscription? _aiSubscription;
  StreamSubscription? _statusSubscription;
  StreamSubscription? _desktopToMobileSubscription;
  StreamSubscription? _desktopControlActionSubscription;
  String? _currentPromptId;
  final List<String> _actionLogs = [];
  String _connectionMode = 'none';
  String? _connectionLabel;

  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    final connectionInfo = SyncService().getConnectionInfo();
    _isConnected = SyncService().isConnectedToDesktop;
    _connectionMode = connectionInfo['mode'] as String? ?? 'none';
    _connectionLabel = connectionInfo['label'] as String?;
    _listenToStreams();
    _fetchDesktopStatus();
  }

  void _listenToStreams() {
    _aiSubscription = SyncService().onAIStream.listen((data) {
      if (!mounted) return;
      if (data['promptId'] != _currentPromptId) return;

      final chunk = data['response'] as String? ?? '';
      final isStreaming = data['isStreaming'] ?? false;
      setState(() {
        if (_messages.isNotEmpty) {
          _messages[_messages.length - 1]['content'] += chunk;
          _messages[_messages.length - 1]['isStreaming'] = isStreaming;
        }
        if (!isStreaming) {
          _isLoading = false;
          _currentPromptId = null;
        }
      });
      _scrollToBottom();
    });

    _statusSubscription = SyncService().onDesktopStatus.listen((status) {
      if (mounted) {
        setState(() {
          _desktopStatus = Map<String, dynamic>.from(status);
        });
      }
    });

    _desktopToMobileSubscription =
        SyncService().onDesktopToMobile.listen((msg) {
      if (mounted && msg['action'] == 'shell-approval-qr') {
        _showShellApprovalDialog(
          msg['command'] as String,
          msg['pin'] as String,
          msg['qrData'] as String?,
        );
      } else if (mounted && msg['action'] == 'power-approval-qr') {
        // Handle shutdown/restart/sleep/lock QR approval
        _showPowerApprovalDialog(
          msg['powerAction'] as String,
          msg['pin'] as String,
          msg['qrData'] as String?,
        );
      } else if (mounted && msg['action'] == 'file-generated') {
        _showFileReadyDialog(
          msg['name'] as String,
          msg['url'] as String,
          msg['type'] as String?,
        );
      }
    });

    _desktopControlActionSubscription =
        SyncService().onDesktopControl.listen((msg) {
      if (!mounted) return;
      final action = msg['action'] ?? 'desktop-control';
      final detail = msg['output'] ?? msg['error'] ?? 'Done';
      final verb = msg['success'] == true ? '✓' : '⚠️';
      _appendActionLog('$verb $action • $detail');
    });
  }

  Future<void> _fetchDesktopStatus() async {
    if (!_isConnected) return;
    try {
      final status = await SyncService().getDesktopStatus();
      final connectionInfo = SyncService().getConnectionInfo();
      if (mounted && status != null) {
        setState(() {
          _desktopStatus = Map<String, dynamic>.from(status);
          _connectionMode =
              connectionInfo['mode'] as String? ?? _connectionMode;
          _connectionLabel =
              connectionInfo['label'] as String? ?? _connectionLabel;
        });
      }
    } catch (e) {
      print('[DesktopControl] Failed to get status: $e');
    }
  }

  Future<void> _sendPrompt() async {
    final prompt = _promptController.text.trim();
    if (prompt.isEmpty || !_isConnected || _isLoading) return;

    setState(() {
      _isLoading = true;
      _messages.add({
        'role': 'user',
        'content': prompt,
        'timestamp': DateTime.now(),
      });
      _messages.add({
        'role': 'assistant',
        'content': '',
        'isStreaming': true,
        'timestamp': DateTime.now(),
      });
    });

    _promptController.clear();
    _scrollToBottom();

    try {
      final response = await SyncService().executeDesktopControl(
        'send-prompt',
        prompt: prompt,
        args: _selectedModel != null ? {'model': _selectedModel} : null,
      );

      if (mounted) {
        setState(() {
          if (response == null || response['success'] != true) {
            final error = response?['error'] ?? 'Failed to send prompt';
            if (_messages.isNotEmpty) {
              _messages[_messages.length - 1]['content'] = 'Error: $error';
              _messages[_messages.length - 1]['isStreaming'] = false;
            }
            _isLoading = false;
            _currentPromptId = null;
          } else {
            _currentPromptId = response['promptId'];
          }
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          if (_messages.isNotEmpty) {
            _messages[_messages.length - 1]['content'] = 'Error: $e';
            _messages[_messages.length - 1]['isStreaming'] = false;
          }
        });
      }
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _appendActionLog(String text) {
    setState(() {
      _actionLogs.insert(0, text);
      if (_actionLogs.length > 5) {
        _actionLogs.removeLast();
      }
    });
  }

  void _showFileReadyDialog(String name, String url, String? type) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('File Generated'),
        content:
            Text('Desktop has generated "$name". Would you like to view it?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Close'),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(context);
              if (type == 'pdf') {
                Navigator.of(context).pushNamed(
                  '/pdf-viewer',
                  arguments: {'fileUrl': url, 'fileName': name},
                );
              } else {
                // If DOCX/PPTX, PDF viewer might not handle it directly unless we pass it to system share/open
                Navigator.of(context).pushNamed(
                  '/pdf-viewer', // assuming it falls back to download/open externally
                  arguments: {'fileUrl': url, 'fileName': name},
                );
              }
            },
            child: const Text('View File'),
          ),
        ],
      ),
    );
  }

  void _showShellApprovalDialog(String command, String pin, String? qrData) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF1E1E1E),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: Row(
          children: [
            const Icon(Icons.shield, color: Colors.orange),
            const SizedBox(width: 10),
            const Text('Shell Approval Required',
                style: TextStyle(color: Colors.white)),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.orange.withOpacity(0.1),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                command,
                style: const TextStyle(
                    color: Colors.orange,
                    fontFamily: 'monospace',
                    fontSize: 12),
              ),
            ),
            const SizedBox(height: 20),
            const Text('Approve on your mobile using the QR code below:',
                style: TextStyle(color: Colors.white70)),
            if (qrData != null) ...[
              const SizedBox(height: 10),
              Image.memory(base64Decode(qrData.split(',').last),
                  width: 200, height: 200),
            ],
            const SizedBox(height: 10),
            Text('PIN: $pin',
                style: const TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.bold)),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child:
                const Text('Cancel', style: TextStyle(color: Colors.white54)),
          ),
        ],
      ),
    );
  }

  void _showPowerApprovalDialog(
      String powerAction, String pin, String? qrData) {
    final actionLabels = {
      'shutdown': 'Shutdown Desktop',
      'restart': 'Restart Desktop',
      'sleep': 'Sleep Desktop',
      'lock': 'Lock Screen'
    };
    final actionLabel = actionLabels[powerAction] ?? powerAction;
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF1E1E1E),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: Row(
          children: [
            const Icon(Icons.power_settings_new, color: Colors.red),
            const SizedBox(width: 10),
            Text('Power Action Required',
                style: TextStyle(color: Colors.white)),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.red.withOpacity(0.1),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                actionLabel,
                style: const TextStyle(
                    color: Colors.red,
                    fontWeight: FontWeight.bold,
                    fontSize: 16),
              ),
            ),
            const SizedBox(height: 20),
            const Text('Approve this power action on your desktop:',
                style: TextStyle(color: Colors.white70)),
            if (qrData != null) ...[
              const SizedBox(height: 10),
              Image.memory(base64Decode(qrData.split(',').last),
                  width: 200, height: 200),
            ],
            const SizedBox(height: 10),
            Text('PIN: $pin',
                style: const TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.bold)),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child:
                const Text('Cancel', style: TextStyle(color: Colors.white54)),
          ),
        ],
      ),
    );
  }

  @override
  void dispose() {
    _aiSubscription?.cancel();
    _statusSubscription?.cancel();
    _desktopToMobileSubscription?.cancel();
    _desktopControlActionSubscription?.cancel();
    _promptController.dispose();
    _scrollController.dispose();
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_isConnected) {
      return Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(
          backgroundColor: Colors.transparent,
          title: const Text('Desktop Control',
              style: TextStyle(color: Colors.white)),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back, color: Colors.white),
            onPressed: () => Navigator.pop(context),
          ),
        ),
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.desktop_access_disabled,
                  size: 80, color: Colors.white24),
              const SizedBox(height: 20),
              const Text('Not Connected to Desktop',
                  style: TextStyle(color: Colors.white70, fontSize: 18)),
              const SizedBox(height: 10),
              const Text('Connect to a desktop to use Desktop Control',
                  style: TextStyle(color: Colors.white38)),
              const SizedBox(height: 30),
              ElevatedButton.icon(
                onPressed: () =>
                    Navigator.pushNamed(context, '/connect-desktop'),
                icon: const Icon(Icons.link),
                label: const Text('Connect Desktop'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF00E5FF),
                  foregroundColor: Colors.black,
                ),
              ),
            ],
          ),
        ),
      );
    }

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        title: Row(
          children: [
            Container(
              width: 10,
              height: 10,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: _isCloudMode ? const Color(0xFF9C27B0) : Colors.green,
              ),
            ),
            const SizedBox(width: 10),
            Text(
              _isCloudMode ? 'Cloud Desktop Control' : 'Desktop Control',
              style: const TextStyle(color: Colors.white),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.history_edu_rounded, color: Color(0xFF00E5FF)),
            tooltip: 'Aartiq Sessions',
            onPressed: () {
              Navigator.pushNamed(context, '/session-viewer');
            },
          ),
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white70),
            onPressed: _fetchDesktopStatus,
          ),
          IconButton(
            icon: const Icon(Icons.link_off, color: Colors.white70),
            onPressed: () {
              SyncService().disconnectFromDesktop();
              Navigator.pop(context);
            },
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: const Color(0xFF00E5FF),
          labelColor: const Color(0xFF00E5FF),
          unselectedLabelColor: Colors.white54,
          tabs: const [
            Tab(icon: Icon(Icons.chat), text: 'AI Chat'),
            Tab(icon: Icon(Icons.terminal), text: 'Shell'),
            Tab(icon: Icon(Icons.touch_app), text: 'Control'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildAIChatTab(),
          _buildShellTab(),
          _buildControlTab(),
        ],
      ),
    );
  }

  Widget _buildAIChatTab() {
    return Column(
      children: [
        _buildConnectionBanner(),
        Expanded(
          child: _messages.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.smart_toy,
                          size: 60, color: Colors.white12),
                      const SizedBox(height: 15),
                      Text(
                          _isCloudMode
                              ? 'AI Chat via Cloud Desktop'
                              : 'AI Chat via Desktop',
                          style: const TextStyle(
                              color: Colors.white38, fontSize: 16)),
                      const SizedBox(height: 5),
                      Text(
                          _isCloudMode
                              ? 'Messages are routed through your signed-in desktop over Firebase.'
                              : 'Messages are processed on your desktop GPU',
                          style: const TextStyle(
                              color: Colors.white24, fontSize: 12)),
                    ],
                  ),
                )
              : ListView.builder(
                  controller: _scrollController,
                  padding: const EdgeInsets.all(16),
                  itemCount: _messages.length,
                  itemBuilder: (context, index) =>
                      _buildMessageBubble(_messages[index]),
                ),
        ),
        if (_actionLogs.isNotEmpty) _buildActionLogPanel(),
        _buildPromptInput(),
      ],
    );
  }

  Widget _buildConnectionBanner() {
    final accent =
        _isCloudMode ? const Color(0xFF9C27B0) : const Color(0xFF00E5FF);
    final label =
        _connectionLabel ?? (_isCloudMode ? 'Cloud Desktop' : 'Local Desktop');
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 16, 16, 0),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: accent.withOpacity(0.12),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: accent.withOpacity(0.28)),
      ),
      child: Row(
        children: [
          Icon(
            _isCloudMode ? Icons.cloud_done : Icons.wifi,
            color: accent,
            size: 18,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              _isCloudMode
                  ? 'Connected to $label through your same-account cloud session. AI chat is available here; direct shell and desktop control remain local-only for safety.'
                  : 'Connected to $label on your local network with full remote desktop controls available.',
              style: const TextStyle(color: Colors.white70, fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildActionLogPanel() {
    final visibleLogs = _actionLogs.take(3).toList();
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 6, 16, 6),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.04),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('AI Actions',
              style: TextStyle(color: Colors.white54, fontSize: 11)),
          const SizedBox(height: 6),
          ...visibleLogs.map((log) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Text(log,
                    style:
                        const TextStyle(color: Colors.white70, fontSize: 12)),
              )),
        ],
      ),
    );
  }

  Widget _buildMessageBubble(Map<String, dynamic> msg) {
    final isUser = msg['role'] == 'user';
    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 5),
        padding: const EdgeInsets.all(12),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.75,
        ),
        decoration: BoxDecoration(
          color: isUser
              ? const Color(0xFF00E5FF).withOpacity(0.2)
              : Colors.white.withOpacity(0.05),
          borderRadius: BorderRadius.circular(15),
          border: Border.all(
            color: isUser
                ? const Color(0xFF00E5FF).withOpacity(0.3)
                : Colors.white.withOpacity(0.1),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(isUser ? Icons.person : Icons.smart_toy,
                    size: 14,
                    color: isUser ? const Color(0xFF00E5FF) : Colors.white38),
                const SizedBox(width: 5),
                Text(isUser ? 'You' : 'Desktop AI',
                    style: TextStyle(
                        color:
                            isUser ? const Color(0xFF00E5FF) : Colors.white54,
                        fontSize: 11)),
                if (msg['isStreaming'] == true) ...[
                  const SizedBox(width: 8),
                  SizedBox(
                      width: 12,
                      height: 12,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white38)),
                ],
              ],
            ),
            const SizedBox(height: 8),
            SelectableText(
              msg['content'] ?? '',
              style: const TextStyle(color: Colors.white, height: 1.4),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPromptInput() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.03),
        border: Border(top: BorderSide(color: Colors.white.withOpacity(0.1))),
      ),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: _promptController,
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                hintText: 'Ask the AI via your desktop...',
                hintStyle: const TextStyle(color: Colors.white24),
                filled: true,
                fillColor: Colors.white.withOpacity(0.05),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(25),
                  borderSide: BorderSide.none,
                ),
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
              ),
              onSubmitted: (_) => _sendPrompt(),
            ),
          ),
          const SizedBox(width: 10),
          Container(
            decoration: const BoxDecoration(
                shape: BoxShape.circle, color: Color(0xFF00E5FF)),
            child: IconButton(
              onPressed: _isLoading ? null : _sendPrompt,
              icon: _isLoading
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.black))
                  : const Icon(Icons.send, color: Colors.black),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildShellTab() {
    if (_isCloudMode) {
      return _buildCloudLimitedPanel(
        icon: Icons.terminal,
        title: 'Shell Control Stays Local',
        description:
            'High-risk shell commands are available only on a local desktop session. Cloud mode currently supports AI sidebar prompts.',
      );
    }
    return _ShellCommandPanel(isConnected: _isConnected);
  }

  Widget _buildControlTab() {
    if (_isCloudMode) {
      return _buildCloudLimitedPanel(
        icon: Icons.touch_app,
        title: 'Direct Control Stays Local',
        description:
            'Mouse, keyboard, browser, and automation controls are enabled only when your phone is connected to the desktop on the local network.',
      );
    }
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildStatusCard(),
          const SizedBox(height: 20),
          const Text('Quick Actions',
              style: TextStyle(
                  color: Colors.white70,
                  fontSize: 16,
                  fontWeight: FontWeight.bold)),
          const SizedBox(height: 15),
          _buildQuickActions(),
          const SizedBox(height: 20),
          const Text('Browser Controls',
              style: TextStyle(
                  color: Colors.white70,
                  fontSize: 16,
                  fontWeight: FontWeight.bold)),
          const SizedBox(height: 15),
          _buildBrowserControls(),
        ],
      ),
    );
  }

  Widget _buildCloudLimitedPanel({
    required IconData icon,
    required String title,
    required String description,
  }) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Container(
          padding: const EdgeInsets.all(22),
          decoration: BoxDecoration(
            color: Colors.white.withOpacity(0.05),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: Colors.white10),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 42, color: const Color(0xFF9C27B0)),
              const SizedBox(height: 14),
              Text(
                title,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                description,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white60, height: 1.5),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStatusCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.05),
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: Colors.white.withOpacity(0.1)),
      ),
      child: Row(
        children: [
          Container(
            width: 50,
            height: 50,
            decoration: BoxDecoration(
              color: Colors.green.withOpacity(0.2),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(Icons.desktop_windows, color: Colors.green),
          ),
          const SizedBox(width: 15),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_desktopStatus?['desktopName'] ?? 'Desktop',
                    style: const TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.bold)),
                Text(
                    'Platform: ${_desktopStatus?['platform'] ?? 'Unknown'} • ${_isCloudMode ? 'Cloud' : 'Local'}',
                    style:
                        const TextStyle(color: Colors.white54, fontSize: 12)),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: Colors.green.withOpacity(0.2),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: const [
                Icon(Icons.check_circle, color: Colors.green, size: 14),
                SizedBox(width: 5),
                Text('Connected',
                    style: TextStyle(color: Colors.green, fontSize: 12)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildQuickActions() {
    return GridView.count(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisCount: 3,
      mainAxisSpacing: 10,
      crossAxisSpacing: 10,
      children: [
        _buildActionTile(
            Icons.screenshot, 'Screenshot', () => _takeScreenshot()),
        _buildActionTile(
            Icons.content_copy, 'Clipboard', () => _getClipboard()),
        _buildActionTile(Icons.mouse, 'Click', () => _showClickDialog()),
        _buildActionTile(Icons.keyboard, 'Type', () => _showTypeDialog()),
        _buildActionTile(Icons.refresh, 'Reload', () => _sendCommand('reload')),
        _buildActionTile(
            Icons.arrow_back, 'Back', () => _sendCommand('go-back')),
        _buildActionTile(Icons.power_settings_new, 'Shutdown',
            () => _sendPowerCommand('shutdown')),
        _buildActionTile(
            Icons.restart_alt, 'Restart', () => _sendPowerCommand('restart')),
        _buildActionTile(Icons.lock, 'Lock', () => _sendPowerCommand('lock')),
      ],
    );
  }

  Widget _buildActionTile(IconData icon, String label, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white.withOpacity(0.05),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Colors.white.withOpacity(0.1)),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: const Color(0xFF00E5FF), size: 24),
            const SizedBox(height: 5),
            Text(label,
                style: const TextStyle(color: Colors.white70, fontSize: 11)),
          ],
        ),
      ),
    );
  }

  Widget _buildBrowserControls() {
    return Column(
      children: [
        _buildTextInputRow('Open URL', Icons.link, (url) async {
          await SyncService().openUrlOnDesktop(url);
          if (mounted)
            ScaffoldMessenger.of(context)
                .showSnackBar(SnackBar(content: Text('Opening: $url')));
        }),
      ],
    );
  }

  Widget _buildTextInputRow(
      String hint, IconData icon, Function(String) onSubmit) {
    final controller = TextEditingController();
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: controller,
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                hintText: hint,
                hintStyle: const TextStyle(color: Colors.white24),
                prefixIcon: Icon(icon, color: Colors.white38),
                filled: true,
                fillColor: Colors.white.withOpacity(0.05),
                border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide.none),
              ),
              onSubmitted: (value) {
                if (value.isNotEmpty) onSubmit(value);
                controller.clear();
              },
            ),
          ),
          const SizedBox(width: 10),
          Container(
            decoration: BoxDecoration(
              color: const Color(0xFF00E5FF),
              borderRadius: BorderRadius.circular(12),
            ),
            child: IconButton(
              icon: const Icon(Icons.send, color: Colors.black),
              onPressed: () {
                if (controller.text.isNotEmpty) {
                  onSubmit(controller.text);
                  controller.clear();
                }
              },
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _takeScreenshot() async {
    final result = await SyncService().takeDesktopScreenshot();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(result?['output'] ?? 'Screenshot captured')),
      );
    }
  }

  Future<void> _getClipboard() async {
    final clipboard = await SyncService().getDesktopClipboard();
    if (mounted && clipboard != null) {
      Clipboard.setData(ClipboardData(text: clipboard));
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Clipboard copied to mobile')),
      );
    }
  }

  void _showClickDialog() {
    showDialog(
      context: context,
      builder: (context) {
        final xController = TextEditingController(text: '500');
        final yController = TextEditingController(text: '500');
        return AlertDialog(
          backgroundColor: const Color(0xFF1E1E1E),
          title: const Text('Click at Position',
              style: TextStyle(color: Colors.white)),
          content: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: xController,
                  keyboardType: TextInputType.number,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                      labelText: 'X',
                      labelStyle: TextStyle(color: Colors.white54)),
                ),
              ),
              const SizedBox(width: 15),
              Expanded(
                child: TextField(
                  controller: yController,
                  keyboardType: TextInputType.number,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                      labelText: 'Y',
                      labelStyle: TextStyle(color: Colors.white54)),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Cancel',
                    style: TextStyle(color: Colors.white54))),
            ElevatedButton(
              onPressed: () {
                SyncService().clickOnDesktop(
                    int.parse(xController.text), int.parse(yController.text));
                Navigator.pop(context);
              },
              style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF00E5FF)),
              child: const Text('Click', style: TextStyle(color: Colors.black)),
            ),
          ],
        );
      },
    );
  }

  void _showTypeDialog() {
    showDialog(
      context: context,
      builder: (context) {
        final controller = TextEditingController();
        return AlertDialog(
          backgroundColor: const Color(0xFF1E1E1E),
          title: const Text('Type Text', style: TextStyle(color: Colors.white)),
          content: TextField(
            controller: controller,
            style: const TextStyle(color: Colors.white),
            decoration: const InputDecoration(
                hintText: 'Enter text...',
                hintStyle: TextStyle(color: Colors.white24)),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Cancel',
                    style: TextStyle(color: Colors.white54))),
            ElevatedButton(
              onPressed: () {
                SyncService().executeDesktopControl('type-text',
                    args: {'text': controller.text});
                Navigator.pop(context);
              },
              style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF00E5FF)),
              child: const Text('Type', style: TextStyle(color: Colors.black)),
            ),
          ],
        );
      },
    );
  }

  Future<void> _sendCommand(String action) async {
    await SyncService().executeDesktopControl(action);
  }

  Future<void> _sendPowerCommand(String action) async {
    // Power commands always require QR verification
    await SyncService().executeDesktopControl(action);
  }

  bool get _isCloudMode => _connectionMode == 'cloud';
}

class _ShellCommandPanel extends StatefulWidget {
  final bool isConnected;
  const _ShellCommandPanel({required this.isConnected});

  @override
  State<_ShellCommandPanel> createState() => _ShellCommandPanelState();
}

class _ShellCommandPanelState extends State<_ShellCommandPanel> {
  final TextEditingController _commandController = TextEditingController();
  final List<Map<String, dynamic>> _history = [];
  bool _isRunning = false;

  Future<void> _executeCommand() async {
    final command = _commandController.text.trim();
    if (command.isEmpty || !widget.isConnected || _isRunning) return;

    setState(() {
      _isRunning = true;
      _history.add({'cmd': command, 'output': '', 'status': 'running'});
    });

    _commandController.clear();

    try {
      final result = await SyncService().executeShellViaDesktop(command);
      if (mounted) {
        setState(() {
          if (_history.isNotEmpty) {
            _history[_history.length - 1] = {
              'cmd': command,
              'output': result?['output'] ?? result?['error'] ?? 'No output',
              'status': result?['success'] == true ? 'success' : 'error',
            };
          }
          _isRunning = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          if (_history.isNotEmpty) {
            _history[_history.length - 1] = {
              'cmd': command,
              'output': 'Error: $e',
              'status': 'error',
            };
          }
          _isRunning = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Container(
          padding: const EdgeInsets.all(12),
          margin: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: const Color(0xFF1E1E1E),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: Colors.white.withOpacity(0.1)),
          ),
          child: Row(
            children: [
              const Text('\$ ',
                  style: TextStyle(
                      color: Color(0xFF00E5FF),
                      fontFamily: 'monospace',
                      fontSize: 16)),
              Expanded(
                child: TextField(
                  controller: _commandController,
                  style: const TextStyle(
                      color: Colors.white, fontFamily: 'monospace'),
                  decoration: const InputDecoration(
                    hintText: 'Enter shell command...',
                    hintStyle: TextStyle(color: Colors.white24),
                    border: InputBorder.none,
                    isDense: true,
                    contentPadding: EdgeInsets.zero,
                  ),
                  enabled: !_isRunning,
                  onSubmitted: (_) => _executeCommand(),
                ),
              ),
              if (_isRunning)
                const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: Color(0xFF00E5FF)),
                )
              else
                IconButton(
                  icon: const Icon(Icons.play_arrow, color: Color(0xFF00E5FF)),
                  onPressed: _executeCommand,
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                ),
            ],
          ),
        ),
        Expanded(
          child: _history.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: const [
                      Icon(Icons.terminal, size: 50, color: Colors.white12),
                      SizedBox(height: 10),
                      Text('Execute commands on your desktop',
                          style: TextStyle(color: Colors.white24)),
                    ],
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  itemCount: _history.length,
                  itemBuilder: (context, index) {
                    final item = _history[index];
                    return Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.white.withOpacity(0.03),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Text('\$ ',
                                  style: TextStyle(
                                      color: Color(0xFF00E5FF),
                                      fontFamily: 'monospace',
                                      fontSize: 13)),
                              Expanded(
                                child: Text(item['cmd'],
                                    style: const TextStyle(
                                        color: Colors.white,
                                        fontFamily: 'monospace',
                                        fontSize: 13)),
                              ),
                              if (item['status'] == 'running')
                                const SizedBox(
                                    width: 15,
                                    height: 15,
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2, color: Colors.white38)),
                              if (item['status'] == 'success')
                                const Icon(Icons.check_circle,
                                    size: 15, color: Colors.green),
                              if (item['status'] == 'error')
                                const Icon(Icons.error,
                                    size: 15, color: Colors.red),
                            ],
                          ),
                          if (item['output'].isNotEmpty &&
                              item['status'] != 'running') ...[
                            const SizedBox(height: 8),
                            Text(
                              item['output'],
                              style: const TextStyle(
                                  color: Colors.white70,
                                  fontFamily: 'monospace',
                                  fontSize: 12),
                            ),
                          ],
                        ],
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }

  @override
  void dispose() {
    _commandController.dispose();
    super.dispose();
  }
}

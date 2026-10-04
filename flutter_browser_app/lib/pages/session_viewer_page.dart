import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/session_model.dart';
import '../sync_service.dart';
import '../widgets/device_image_widget.dart';

class SessionViewerPage extends StatefulWidget {
  const SessionViewerPage({Key? key}) : super(key: key);

  @override
  State<SessionViewerPage> createState() => _SessionViewerPageState();
}

class _SessionViewerPageState extends State<SessionViewerPage>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final SyncService _syncService = SyncService();
  bool _isLoading = false;

  UnifiedSessionModel? _currentSession;
  List<SessionSummaryModel> _pastSessions = [];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _loadSessions();

    // Listen to real-time session stream from SyncService
    _syncService.onSessionUpdated.listen((session) {
      if (mounted) {
        setState(() {
          _currentSession = session;
        });
      }
    });

    _syncService.onPastSessionsUpdated.listen((past) {
      if (mounted) {
        setState(() {
          _pastSessions = past;
        });
      }
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadSessions() async {
    setState(() => _isLoading = true);
    try {
      await _syncService.requestSessionSync();
      _currentSession = _syncService.lastKnownCurrentSession;
      _pastSessions = _syncService.lastKnownPastSessions;
    } catch (e) {
      print('[SessionViewer] Error loading sessions: $e');
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  String _formatTime(int ms) {
    if (ms <= 0) return '';
    final dt = DateTime.fromMillisecondsSinceEpoch(ms);
    return DateFormat('MMM d, h:mm a').format(dt);
  }

  Color _getRiskColor(String risk) {
    switch (risk.toLowerCase()) {
      case 'critical':
        return const Color(0xFFEF4444);
      case 'high':
        return const Color(0xFFF97316);
      case 'medium':
        return const Color(0xFFF59E0B);
      case 'low':
      default:
        return const Color(0xFF10B981);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isConnected = _syncService.isConnectedToDesktop;

    return Scaffold(
      backgroundColor: const Color(0xFF0D0D1A),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new, color: Colors.white, size: 20),
          onPressed: () => Navigator.pop(context),
        ),
        title: const Text(
          'Aartiq Sessions',
          style: TextStyle(
            color: Colors.white,
            fontSize: 17,
            fontWeight: FontWeight.bold,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: Color(0xFF00E5FF)),
            onPressed: _isLoading ? null : _loadSessions,
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: const Color(0xFF00E5FF),
          labelColor: const Color(0xFF00E5FF),
          unselectedLabelColor: Colors.white54,
          tabs: const [
            Tab(text: 'Current Session'),
            Tab(text: 'Past Sessions'),
          ],
        ),
      ),
      body: _isLoading
          ? const Center(
              child: CircularProgressIndicator(color: Color(0xFF00E5FF)),
            )
          : TabBarView(
              controller: _tabController,
              children: [
                _buildCurrentSessionTab(isConnected),
                _buildPastSessionsTab(),
              ],
            ),
    );
  }

  Widget _buildCurrentSessionTab(bool isConnected) {
    final session = _currentSession;
    if (session == null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              isConnected ? Icons.hourglass_empty : Icons.wifi_off_rounded,
              color: Colors.white38,
              size: 48,
            ),
            const SizedBox(height: 16),
            Text(
              isConnected
                  ? 'Waiting for session sync data from desktop...'
                  : 'Desktop not connected. Connect via WiFi or Google Cloud.',
              style: const TextStyle(color: Colors.white70, fontSize: 14),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _loadSessions,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF00E5FF),
                foregroundColor: Colors.black,
              ),
              child: const Text('Refresh Sync'),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadSessions,
      color: const Color(0xFF00E5FF),
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Session Overview Banner
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFF14142B),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFF00E5FF).withOpacity(0.3)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const DeviceImageWidget(
                        deviceType: 'macbook',
                        size: 42,
                        isOnline: true,
                        isPermanentSynced: true,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Container(
                                  width: 8,
                                  height: 8,
                                  decoration: const BoxDecoration(
                                    color: Color(0xFF10B981),
                                    shape: BoxShape.circle,
                                  ),
                                ),
                                const SizedBox(width: 6),
                                Expanded(
                                  child: Text(
                                    session.deviceName,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 14,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 2),
                            Text(
                              'Permanent Sync Active • ${_formatTime(session.startedAt)}',
                              style: const TextStyle(
                                color: Color(0xFF00E5FF),
                                fontSize: 10,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  const Divider(color: Colors.white10, height: 1),
                  const SizedBox(height: 12),
                  const SizedBox(height: 12),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                    children: [
                      _buildMetric('${session.tabs.length}', 'Tabs'),
                      _buildMetric('${session.automationTasks.length}', 'Tasks'),
                      _buildMetric('${session.history.length}', 'History'),
                      _buildMetric('${session.permissions.length}', 'Perms'),
                    ],
                  ),
                ],
              ),
            ),

            const SizedBox(height: 20),

            // Open Tabs Section
            const Text(
              'OPEN TABS',
              style: TextStyle(
                color: Colors.white54,
                fontSize: 11,
                letterSpacing: 1.2,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            if (session.tabs.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 8),
                child: Text('No active tabs', style: TextStyle(color: Colors.white38)),
              )
            else
              ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: session.tabs.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (ctx, idx) {
                  final tab = session.tabs[idx];
                  return Container(
                    decoration: BoxDecoration(
                      color: const Color(0xFF14142B),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: tab.isActive
                            ? const Color(0xFF00E5FF).withOpacity(0.5)
                            : Colors.white10,
                      ),
                    ),
                    child: ListTile(
                      dense: true,
                      leading: Icon(
                        tab.isActive ? Icons.tab_rounded : Icons.tab_unselected_rounded,
                        color: tab.isActive ? const Color(0xFF00E5FF) : Colors.white38,
                        size: 18,
                      ),
                      title: Text(
                        tab.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 13,
                          fontWeight: tab.isActive ? FontWeight.bold : FontWeight.normal,
                        ),
                      ),
                      subtitle: Text(
                        tab.url,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: Colors.white38, fontSize: 11),
                      ),
                      trailing: tab.isActive
                          ? Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: const Color(0xFF00E5FF).withOpacity(0.2),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: const Text(
                                'Active',
                                style: TextStyle(
                                  color: Color(0xFF00E5FF),
                                  fontSize: 10,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            )
                          : null,
                    ),
                  );
                },
              ),

            const SizedBox(height: 20),

            // Automation Tasks Section
            if (session.automationTasks.isNotEmpty) ...[
              const Text(
                'AUTOMATION TASKS',
                style: TextStyle(
                  color: Colors.white54,
                  fontSize: 11,
                  letterSpacing: 1.2,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: session.automationTasks.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (ctx, idx) {
                  final task = session.automationTasks[idx];
                  final riskColor = _getRiskColor(task.riskLevel);
                  return Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: const Color(0xFF14142B),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: Colors.white10),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: riskColor.withOpacity(0.15),
                                borderRadius: BorderRadius.circular(6),
                                border: Border.all(color: riskColor.withOpacity(0.4)),
                              ),
                              child: Text(
                                task.riskLevel.toUpperCase(),
                                style: TextStyle(
                                  color: riskColor,
                                  fontSize: 9,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                task.name,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 13,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ),
                            Text(
                              task.status.toUpperCase(),
                              style: TextStyle(
                                color: task.status == 'completed'
                                    ? const Color(0xFF10B981)
                                    : task.status == 'failed'
                                        ? const Color(0xFFEF4444)
                                        : const Color(0xFF00E5FF),
                                fontSize: 10,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ],
                        ),
                        if (task.command != null) ...[
                          const SizedBox(height: 6),
                          Text(
                            task.command!,
                            style: const TextStyle(
                              color: Color(0xFF00E5FF),
                              fontFamily: 'monospace',
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ],
                    ),
                  );
                },
              ),
              const SizedBox(height: 20),
            ],

            // Recent Permission Logs
            if (session.permissions.isNotEmpty) ...[
              const Text(
                'RECENT PERMISSION DECISIONS',
                style: TextStyle(
                  color: Colors.white54,
                  fontSize: 11,
                  letterSpacing: 1.2,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: session.permissions.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (ctx, idx) {
                  final perm = session.permissions[idx];
                  final isApproved = perm.decision == 'approved';
                  return Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: const Color(0xFF14142B),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: Colors.white10),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          isApproved ? Icons.verified_user_rounded : Icons.gpp_bad_rounded,
                          color: isApproved ? const Color(0xFF10B981) : const Color(0xFFEF4444),
                          size: 18,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                perm.action,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 12,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              Text(
                                '${perm.decision.toUpperCase()} by ${perm.approvedBy}',
                                style: const TextStyle(color: Colors.white38, fontSize: 10),
                              ),
                            ],
                          ),
                        ),
                        Text(
                          _formatTime(perm.timestamp),
                          style: const TextStyle(color: Colors.white24, fontSize: 10),
                        ),
                      ],
                    ),
                  );
                },
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildPastSessionsTab() {
    if (_pastSessions.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: const [
            Icon(Icons.history_rounded, color: Colors.white24, size: 48),
            SizedBox(height: 12),
            Text(
              'No past session history synced yet',
              style: TextStyle(color: Colors.white38, fontSize: 14),
            ),
          ],
        ),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: _pastSessions.length,
      separatorBuilder: (_, __) => const SizedBox(height: 10),
      itemBuilder: (ctx, idx) {
        final item = _pastSessions[idx];
        return Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: const Color(0xFF14142B),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: Colors.white10),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const DeviceImageWidget(
                    deviceType: 'macbook',
                    size: 28,
                    isOnline: false,
                    isPermanentSynced: true,
                  ),
                  const SizedBox(width: 10),
                  Text(
                    item.deviceName,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const Spacer(),
                  Text(
                    _formatTime(item.startedAt),
                    style: const TextStyle(color: Colors.white38, fontSize: 11),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              if (item.activeUrl != null) ...[
                Text(
                  item.activeUrl!,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFF00E5FF),
                    fontSize: 12,
                  ),
                ),
                const SizedBox(height: 8),
              ],
              Row(
                children: [
                  _buildTag('${item.tabsCount} tabs'),
                  const SizedBox(width: 6),
                  _buildTag('${item.historyCount} pages'),
                  const SizedBox(width: 6),
                  _buildTag('${item.tasksCount} tasks'),
                  const SizedBox(width: 6),
                  _buildTag('${item.permissionsCount} perms'),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildMetric(String value, String label) {
    return Column(
      children: [
        Text(
          value,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 18,
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          label,
          style: const TextStyle(color: Colors.white38, fontSize: 11),
        ),
      ],
    );
  }

  Widget _buildTag(String text) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.06),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        text,
        style: const TextStyle(color: Colors.white54, fontSize: 10),
      ),
    );
  }
}

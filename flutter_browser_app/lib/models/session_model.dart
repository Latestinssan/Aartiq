class SessionTabModel {
  final String id;
  final String url;
  final String title;
  final String? favicon;
  final int position;
  final bool isActive;
  final int openedAt;
  final int lastAccessedAt;

  SessionTabModel({
    required this.id,
    required this.url,
    required this.title,
    this.favicon,
    required this.position,
    required this.isActive,
    required this.openedAt,
    required this.lastAccessedAt,
  });

  factory SessionTabModel.fromJson(Map<String, dynamic> json) {
    return SessionTabModel(
      id: json['id'] ?? '',
      url: json['url'] ?? '',
      title: json['title'] ?? 'New Tab',
      favicon: json['favicon'],
      position: json['position'] ?? 0,
      isActive: json['isActive'] ?? false,
      openedAt: json['openedAt'] ?? DateTime.now().millisecondsSinceEpoch,
      lastAccessedAt:
          json['lastAccessedAt'] ?? DateTime.now().millisecondsSinceEpoch,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'url': url,
      'title': title,
      'favicon': favicon,
      'position': position,
      'isActive': isActive,
      'openedAt': openedAt,
      'lastAccessedAt': lastAccessedAt,
    };
  }
}

class SessionHistoryModel {
  final String id;
  final String url;
  final String title;
  final int visitedAt;
  final int? duration;
  final String? referrer;

  SessionHistoryModel({
    required this.id,
    required this.url,
    required this.title,
    required this.visitedAt,
    this.duration,
    this.referrer,
  });

  factory SessionHistoryModel.fromJson(Map<String, dynamic> json) {
    return SessionHistoryModel(
      id: json['id'] ?? '',
      url: json['url'] ?? '',
      title: json['title'] ?? '',
      visitedAt: json['visitedAt'] ?? DateTime.now().millisecondsSinceEpoch,
      duration: json['duration'],
      referrer: json['referrer'],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'url': url,
      'title': title,
      'visitedAt': visitedAt,
      'duration': duration,
      'referrer': referrer,
    };
  }
}

class SessionTaskModel {
  final String id;
  final String name;
  final String status; // 'completed' | 'failed' | 'running' | 'queued'
  final String riskLevel; // 'low' | 'medium' | 'high' | 'critical'
  final int steps;
  final int completedSteps;
  final int startedAt;
  final int? completedAt;
  final String? command;
  final String? error;

  SessionTaskModel({
    required this.id,
    required this.name,
    required this.status,
    required this.riskLevel,
    required this.steps,
    required this.completedSteps,
    required this.startedAt,
    this.completedAt,
    this.command,
    this.error,
  });

  factory SessionTaskModel.fromJson(Map<String, dynamic> json) {
    return SessionTaskModel(
      id: json['id'] ?? '',
      name: json['name'] ?? 'Task',
      status: json['status'] ?? 'queued',
      riskLevel: (json['riskLevel'] ?? 'low').toString().toLowerCase(),
      steps: json['steps'] ?? 1,
      completedSteps: json['completedSteps'] ?? 0,
      startedAt: json['startedAt'] ?? DateTime.now().millisecondsSinceEpoch,
      completedAt: json['completedAt'],
      command: json['command'],
      error: json['error'],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'status': status,
      'riskLevel': riskLevel,
      'steps': steps,
      'completedSteps': completedSteps,
      'startedAt': startedAt,
      'completedAt': completedAt,
      'command': command,
      'error': error,
    };
  }
}

class SessionPermissionLogModel {
  final String id;
  final int timestamp;
  final String action;
  final String riskLevel;
  final String decision; // 'approved' | 'rejected' | 'auto_approved' | 'pending'
  final String approvedBy; // 'desktop' | 'mobile' | 'auto'
  final String? verificationMethod;
  final String? deviceId;
  final String? details;

  SessionPermissionLogModel({
    required this.id,
    required this.timestamp,
    required this.action,
    required this.riskLevel,
    required this.decision,
    required this.approvedBy,
    this.verificationMethod,
    this.deviceId,
    this.details,
  });

  factory SessionPermissionLogModel.fromJson(Map<String, dynamic> json) {
    return SessionPermissionLogModel(
      id: json['id'] ?? '',
      timestamp: json['timestamp'] ?? DateTime.now().millisecondsSinceEpoch,
      action: json['action'] ?? '',
      riskLevel: (json['riskLevel'] ?? 'medium').toString().toLowerCase(),
      decision: json['decision'] ?? 'pending',
      approvedBy: json['approvedBy'] ?? 'desktop',
      verificationMethod: json['verificationMethod'],
      deviceId: json['deviceId'],
      details: json['details'],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'timestamp': timestamp,
      'action': action,
      'riskLevel': riskLevel,
      'decision': decision,
      'approvedBy': approvedBy,
      'verificationMethod': verificationMethod,
      'deviceId': deviceId,
      'details': details,
    };
  }
}

class UnifiedSessionModel {
  final String id;
  final String deviceId;
  final String deviceName;
  final String platform;
  final int startedAt;
  final int? endedAt;
  final bool isActive;
  final List<SessionTabModel> tabs;
  final List<SessionHistoryModel> history;
  final List<SessionTaskModel> automationTasks;
  final List<SessionPermissionLogModel> permissions;
  final int version;

  UnifiedSessionModel({
    required this.id,
    required this.deviceId,
    required this.deviceName,
    required this.platform,
    required this.startedAt,
    this.endedAt,
    required this.isActive,
    required this.tabs,
    required this.history,
    required this.automationTasks,
    required this.permissions,
    required this.version,
  });

  factory UnifiedSessionModel.fromJson(Map<String, dynamic> json) {
    final devInfo = json['deviceInfo'] as Map<String, dynamic>? ?? {};
    return UnifiedSessionModel(
      id: json['id'] ?? '',
      deviceId: json['deviceId'] ?? devInfo['deviceId'] ?? '',
      deviceName: devInfo['deviceName'] ?? json['deviceName'] ?? 'Desktop',
      platform: devInfo['platform'] ?? json['platform'] ?? 'desktop',
      startedAt: json['startedAt'] ?? DateTime.now().millisecondsSinceEpoch,
      endedAt: json['endedAt'],
      isActive: json['isActive'] ?? true,
      tabs: (json['tabs'] as List<dynamic>? ?? [])
          .map((t) => SessionTabModel.fromJson(Map<String, dynamic>.from(t)))
          .toList(),
      history: (json['history'] as List<dynamic>? ?? [])
          .map((h) => SessionHistoryModel.fromJson(Map<String, dynamic>.from(h)))
          .toList(),
      automationTasks: (json['automationTasks'] as List<dynamic>? ?? [])
          .map((t) => SessionTaskModel.fromJson(Map<String, dynamic>.from(t)))
          .toList(),
      permissions: (json['permissions'] as List<dynamic>? ?? [])
          .map((p) =>
              SessionPermissionLogModel.fromJson(Map<String, dynamic>.from(p)))
          .toList(),
      version: json['version'] ?? 1,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'deviceId': deviceId,
      'deviceName': deviceName,
      'platform': platform,
      'startedAt': startedAt,
      'endedAt': endedAt,
      'isActive': isActive,
      'tabs': tabs.map((t) => t.toJson()).toList(),
      'history': history.map((h) => h.toJson()).toList(),
      'automationTasks': automationTasks.map((t) => t.toJson()).toList(),
      'permissions': permissions.map((p) => p.toJson()).toList(),
      'version': version,
    };
  }
}

class SessionSummaryModel {
  final String id;
  final String deviceId;
  final String deviceName;
  final int startedAt;
  final int? endedAt;
  final bool isActive;
  final int tabsCount;
  final int historyCount;
  final int tasksCount;
  final int permissionsCount;
  final String? activeUrl;

  SessionSummaryModel({
    required this.id,
    required this.deviceId,
    required this.deviceName,
    required this.startedAt,
    this.endedAt,
    required this.isActive,
    required this.tabsCount,
    required this.historyCount,
    required this.tasksCount,
    required this.permissionsCount,
    this.activeUrl,
  });

  factory SessionSummaryModel.fromJson(Map<String, dynamic> json) {
    return SessionSummaryModel(
      id: json['id'] ?? '',
      deviceId: json['deviceId'] ?? '',
      deviceName: json['deviceName'] ?? 'Desktop',
      startedAt: json['startedAt'] ?? DateTime.now().millisecondsSinceEpoch,
      endedAt: json['endedAt'],
      isActive: json['isActive'] ?? false,
      tabsCount: json['tabsCount'] ?? 0,
      historyCount: json['historyCount'] ?? 0,
      tasksCount: json['tasksCount'] ?? 0,
      permissionsCount: json['permissionsCount'] ?? 0,
      activeUrl: json['activeUrl'],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'deviceId': deviceId,
      'deviceName': deviceName,
      'startedAt': startedAt,
      'endedAt': endedAt,
      'isActive': isActive,
      'tabsCount': tabsCount,
      'historyCount': historyCount,
      'tasksCount': tasksCount,
      'permissionsCount': permissionsCount,
      'activeUrl': activeUrl,
    };
  }
}

class PlanOperationDetail {
  final String id;
  final String type;
  final String description;
  final String target;
  final String risk; // 'low' | 'medium' | 'high' | 'critical'
  final String? command;
  final String? details;
  final bool policyDenied;

  PlanOperationDetail({
    required this.id,
    required this.type,
    required this.description,
    required this.target,
    required this.risk,
    this.command,
    this.details,
    this.policyDenied = false,
  });

  factory PlanOperationDetail.fromJson(Map<String, dynamic> json) {
    return PlanOperationDetail(
      id: json['id'] ?? '',
      type: json['type'] ?? 'automation',
      description: json['description'] ?? '',
      target: json['target'] ?? '',
      risk: (json['risk'] ?? 'medium').toString().toLowerCase(),
      command: json['command'],
      details: json['details'],
      policyDenied: json['policyDenied'] ?? false,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'type': type,
      'description': description,
      'target': target,
      'risk': risk,
      'command': command,
      'details': details,
      'policyDenied': policyDenied,
    };
  }
}

class PermissionRelayRequest {
  final String requestId;
  final String taskName;
  final String taskType;
  final String? description;
  final String? command;
  final String riskLevel; // 'low' | 'medium' | 'high' | 'critical'
  final List<PlanOperationDetail> operations;
  final List<String> directories;
  final List<String> urls;
  final String estimatedDuration;
  final bool requiresNetwork;
  final bool requiresFileAccess;
  final List<String> factors;
  final List<String> mitigations;
  final bool requiresBiometric;
  final bool isRemote;
  final String originDeviceId;
  final String originDeviceName;
  final int createdAt;
  final int expiresAt;

  PermissionRelayRequest({
    required this.requestId,
    required this.taskName,
    required this.taskType,
    this.description,
    this.command,
    required this.riskLevel,
    required this.operations,
    required this.directories,
    required this.urls,
    required this.estimatedDuration,
    required this.requiresNetwork,
    required this.requiresFileAccess,
    required this.factors,
    required this.mitigations,
    required this.requiresBiometric,
    required this.isRemote,
    required this.originDeviceId,
    required this.originDeviceName,
    required this.createdAt,
    required this.expiresAt,
  });

  factory PermissionRelayRequest.fromJson(Map<String, dynamic> json) {
    return PermissionRelayRequest(
      requestId: json['requestId'] ?? '',
      taskName: json['taskName'] ?? 'Automation Plan',
      taskType: json['taskType'] ?? 'automation',
      description: json['description'],
      command: json['command'],
      riskLevel: (json['riskLevel'] ?? 'medium').toString().toLowerCase(),
      operations: (json['operations'] as List<dynamic>? ?? [])
          .map((op) => PlanOperationDetail.fromJson(Map<String, dynamic>.from(op)))
          .toList(),
      directories: List<String>.from(json['directories'] ?? []),
      urls: List<String>.from(json['urls'] ?? []),
      estimatedDuration: json['estimatedDuration'] ?? '1 min',
      requiresNetwork: json['requiresNetwork'] ?? false,
      requiresFileAccess: json['requiresFileAccess'] ?? false,
      factors: List<String>.from(json['factors'] ?? []),
      mitigations: List<String>.from(json['mitigations'] ?? []),
      requiresBiometric: json['requiresBiometric'] ?? false,
      isRemote: json['isRemote'] ?? false,
      originDeviceId: json['originDeviceId'] ?? 'desktop',
      originDeviceName: json['originDeviceName'] ?? 'Aartiq Desktop',
      createdAt: json['createdAt'] ?? DateTime.now().millisecondsSinceEpoch,
      expiresAt: json['expiresAt'] ??
          (DateTime.now().millisecondsSinceEpoch + 5 * 60 * 1000),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'requestId': requestId,
      'taskName': taskName,
      'taskType': taskType,
      'description': description,
      'command': command,
      'riskLevel': riskLevel,
      'operations': operations.map((op) => op.toJson()).toList(),
      'directories': directories,
      'urls': urls,
      'estimatedDuration': estimatedDuration,
      'requiresNetwork': requiresNetwork,
      'requiresFileAccess': requiresFileAccess,
      'factors': factors,
      'mitigations': mitigations,
      'requiresBiometric': requiresBiometric,
      'isRemote': isRemote,
      'originDeviceId': originDeviceId,
      'originDeviceName': originDeviceName,
      'createdAt': createdAt,
      'expiresAt': expiresAt,
    };
  }

  bool get isExpired => DateTime.now().millisecondsSinceEpoch > expiresAt;
}

class PermissionRelayResponse {
  final String requestId;
  final bool approved;
  final bool pinVerified;
  final bool screenLockVerified;
  final String? respondedByDeviceId;
  final int respondedAt;
  final String? reason;

  PermissionRelayResponse({
    required this.requestId,
    required this.approved,
    required this.pinVerified,
    required this.screenLockVerified,
    this.respondedByDeviceId,
    required this.respondedAt,
    this.reason,
  });

  Map<String, dynamic> toJson() {
    return {
      'requestId': requestId,
      'approved': approved,
      'pinVerified': pinVerified,
      'screenLockVerified': screenLockVerified,
      'respondedByDeviceId': respondedByDeviceId,
      'respondedAt': respondedAt,
      'reason': reason,
    };
  }
}

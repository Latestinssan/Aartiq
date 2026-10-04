import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../models/permission_model.dart';
import '../services/permission_service.dart';
import '../sync_service.dart';
import '../widgets/device_image_widget.dart';

class PermissionApprovalPage extends StatefulWidget {
  final PermissionRelayRequest request;

  const PermissionApprovalPage({Key? key, required this.request})
      : super(key: key);

  @override
  State<PermissionApprovalPage> createState() => _PermissionApprovalPageState();
}

class _PermissionApprovalPageState extends State<PermissionApprovalPage> {
  final TextEditingController _pinController = TextEditingController();
  final PermissionService _permService = PermissionService();
  bool _isProcessing = false;
  bool _obscurePin = true;
  String? _errorMessage;
  bool _expandedOps = false;
  bool _expandedDirs = false;

  Color _getRiskColor(String risk) {
    switch (risk.toLowerCase()) {
      case 'critical':
        return const Color(0xFFEF4444); // Red
      case 'high':
        return const Color(0xFFF97316); // Orange
      case 'medium':
        return const Color(0xFFF59E0B); // Amber
      case 'low':
      default:
        return const Color(0xFF10B981); // Emerald
    }
  }

  Color _getRiskBgColor(String risk) {
    switch (risk.toLowerCase()) {
      case 'critical':
        return const Color(0x28EF4444);
      case 'high':
        return const Color(0x28F97316);
      case 'medium':
        return const Color(0x28F59E0B);
      case 'low':
      default:
        return const Color(0x2810B981);
    }
  }

  IconData _getRiskIcon(String risk) {
    switch (risk.toLowerCase()) {
      case 'critical':
        return Icons.cancel_outlined;
      case 'high':
        return Icons.warning_amber_rounded;
      case 'medium':
        return Icons.report_problem_outlined;
      case 'low':
      default:
        return Icons.check_circle_outline_rounded;
    }
  }

  @override
  void dispose() {
    _pinController.dispose();
    super.dispose();
  }

  Future<void> _handleApprove() async {
    final pin = _pinController.text.trim();
    if (pin.length != 6) {
      setState(() {
        _errorMessage = 'Please enter your 6-digit Master PIN';
      });
      HapticFeedback.vibrate();
      return;
    }

    setState(() {
      _isProcessing = true;
      _errorMessage = null;
    });

    try {
      final syncSvc = SyncService();
      final myDeviceId = syncSvc.deviceId ?? 'mobile-device';

      final result = await _permService.verifyAndApprove(
        request: widget.request,
        enteredPin: pin,
        deviceId: myDeviceId,
      );

      if (!result.approved || result.response == null) {
        setState(() {
          _isProcessing = false;
          _errorMessage = result.error ?? 'Verification failed';
        });
        HapticFeedback.vibrate();
        return;
      }

      // Send response back to desktop (via local WebSocket or remote Cloud)
      await syncSvc.sendPermissionResponse(result.response!);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: const [
                Icon(Icons.verified_rounded, color: Colors.black),
                SizedBox(width: 8),
                Text(
                  'Permission approved & sent to desktop!',
                  style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold),
                ),
              ],
            ),
            backgroundColor: const Color(0xFF00E5FF),
            duration: const Duration(seconds: 3),
          ),
        );
        Navigator.pop(context, true);
      }
    } catch (e) {
      setState(() {
        _isProcessing = false;
        _errorMessage = 'Error during approval: $e';
      });
    }
  }

  Future<void> _handleDeny() async {
    final syncSvc = SyncService();
    final myDeviceId = syncSvc.deviceId ?? 'mobile-device';

    final response = _permService.denyRequest(
      request: widget.request,
      deviceId: myDeviceId,
      reason: 'Rejected on mobile device',
    );

    await syncSvc.sendPermissionResponse(response);

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Permission request was denied'),
          backgroundColor: Colors.redAccent,
        ),
      );
      Navigator.pop(context, false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final risk = widget.request.riskLevel;
    final riskColor = _getRiskColor(risk);
    final riskBg = _getRiskBgColor(risk);

    final criticalCount =
        widget.request.operations.where((o) => o.risk == 'critical').length;
    final highCount =
        widget.request.operations.where((o) => o.risk == 'high').length;
    final medCount =
        widget.request.operations.where((o) => o.risk == 'medium').length;
    final lowCount =
        widget.request.operations.where((o) => o.risk == 'low').length;

    return Scaffold(
      backgroundColor: const Color(0xFF0D0D1A),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new, color: Colors.white, size: 20),
          onPressed: () => Navigator.pop(context),
        ),
        title: Row(
          children: [
            const Icon(Icons.shield_outlined, color: Color(0xFF00E5FF), size: 20),
            const SizedBox(width: 8),
            const Text(
              'EXECUTION PLAN',
              style: TextStyle(
                color: Colors.white,
                fontSize: 14,
                letterSpacing: 1.5,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
        actions: [
          Container(
            margin: const EdgeInsets.only(right: 16),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.08),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  widget.request.isRemote ? Icons.cloud_outlined : Icons.wifi_rounded,
                  size: 14,
                  color: const Color(0xFF00E5FF),
                ),
                const SizedBox(width: 4),
                Text(
                  widget.request.originDeviceName,
                  style: const TextStyle(color: Colors.white70, fontSize: 11),
                ),
              ],
            ),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // --- Origin Device Header Card with Real Device Image ---
            Container(
              margin: const EdgeInsets.only(bottom: 16),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              decoration: BoxDecoration(
                color: const Color(0xFF14142B),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: Colors.white12),
              ),
              child: Row(
                children: [
                  const DeviceImageWidget(
                    deviceType: 'macbook',
                    size: 48,
                    isOnline: true,
                    isPermanentSynced: true,
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          widget.request.originDeviceName,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 14,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: const Color(0xFF00E5FF).withOpacity(0.15),
                                borderRadius: BorderRadius.circular(6),
                                border: Border.all(
                                    color: const Color(0xFF00E5FF)
                                        .withOpacity(0.3)),
                              ),
                              child: const Text(
                                'PERMANENT SYNC ACTIVE',
                                style: TextStyle(
                                  color: Color(0xFF00E5FF),
                                  fontSize: 9,
                                  fontWeight: FontWeight.bold,
                                  letterSpacing: 0.5,
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Text(
                              widget.request.isRemote ? 'Remote Cloud' : 'Local WiFi',
                              style: const TextStyle(
                                  color: Colors.white38, fontSize: 11),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            // --- Overall Risk Banner ---
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: riskBg,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: riskColor.withOpacity(0.4), width: 1.5),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(_getRiskIcon(risk), color: riskColor, size: 28),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Text(
                              'RISK LEVEL: ${risk.toUpperCase()}',
                              style: TextStyle(
                                color: riskColor,
                                fontWeight: FontWeight.w900,
                                letterSpacing: 1,
                                fontSize: 13,
                              ),
                            ),
                            const Spacer(),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 8, vertical: 2),
                              decoration: BoxDecoration(
                                color: Colors.black26,
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Text(
                                widget.request.estimatedDuration,
                                style: const TextStyle(
                                  color: Colors.white70,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 6),
                        Text(
                          widget.request.taskName,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 17,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        if (widget.request.description != null) ...[
                          const SizedBox(height: 4),
                          Text(
                            widget.request.description!,
                            style: const TextStyle(
                              color: Colors.white70,
                              fontSize: 13,
                            ),
                          ),
                        ],
                        const SizedBox(height: 10),
                        // Operation Counts Pills
                        Wrap(
                          spacing: 6,
                          runSpacing: 4,
                          children: [
                            if (criticalCount > 0)
                              _buildPill('$criticalCount Critical', const Color(0xFFEF4444)),
                            if (highCount > 0)
                              _buildPill('$highCount High', const Color(0xFFF97316)),
                            if (medCount > 0)
                              _buildPill('$medCount Medium', const Color(0xFFF59E0B)),
                            if (lowCount > 0)
                              _buildPill('$lowCount Low', const Color(0xFF10B981)),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 16),

            // --- Risk Factors & Mitigations ---
            if (widget.request.factors.isNotEmpty ||
                widget.request.mitigations.isNotEmpty)
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: const Color(0xFF14142B),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: Colors.white10),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (widget.request.factors.isNotEmpty) ...[
                      const Text(
                        'RISK FACTORS',
                        style: TextStyle(
                          color: Colors.white54,
                          fontSize: 11,
                          letterSpacing: 1.2,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 6),
                      ...widget.request.factors.map(
                        (f) => Padding(
                          padding: const EdgeInsets.only(bottom: 4),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('• ', style: TextStyle(color: Colors.redAccent)),
                              Expanded(
                                child: Text(
                                  f,
                                  style: const TextStyle(
                                      color: Colors.white70, fontSize: 13),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                    if (widget.request.mitigations.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      const Text(
                        'SECURITY MITIGATIONS',
                        style: TextStyle(
                          color: Colors.white54,
                          fontSize: 11,
                          letterSpacing: 1.2,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 6),
                      ...widget.request.mitigations.map(
                        (m) => Padding(
                          padding: const EdgeInsets.only(bottom: 4),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Icon(Icons.check_circle_rounded,
                                  color: Color(0xFF10B981), size: 14),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text(
                                  m,
                                  style: const TextStyle(
                                      color: Colors.white70, fontSize: 13),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),

            const SizedBox(height: 16),

            // --- Operations Accordion ---
            if (widget.request.operations.isNotEmpty)
              Container(
                decoration: BoxDecoration(
                  color: const Color(0xFF14142B),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: Colors.white10),
                ),
                child: Column(
                  children: [
                    ListTile(
                      dense: true,
                      title: Text(
                        'Operations (${widget.request.operations.length} steps)',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      trailing: Icon(
                        _expandedOps
                            ? Icons.keyboard_arrow_up
                            : Icons.keyboard_arrow_down,
                        color: Colors.white54,
                      ),
                      onTap: () {
                        setState(() {
                          _expandedOps = !_expandedOps;
                        });
                      },
                    ),
                    if (_expandedOps)
                      ListView.separated(
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
                        itemCount: widget.request.operations.length,
                        separatorBuilder: (_, __) =>
                            const Divider(color: Colors.white10),
                        itemBuilder: (ctx, idx) {
                          final op = widget.request.operations[idx];
                          final opColor = _getRiskColor(op.risk);
                          return Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: _getRiskBgColor(op.risk),
                                      borderRadius: BorderRadius.circular(6),
                                      border: Border.all(
                                          color: opColor.withOpacity(0.4)),
                                    ),
                                    child: Text(
                                      op.risk.toUpperCase(),
                                      style: TextStyle(
                                        color: opColor,
                                        fontSize: 9,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      op.description,
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontSize: 13,
                                        fontWeight: FontWeight.w500,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              if (op.command != null &&
                                  op.command!.isNotEmpty) ...[
                                const SizedBox(height: 6),
                                Container(
                                  width: double.infinity,
                                  padding: const EdgeInsets.all(8),
                                  decoration: BoxDecoration(
                                    color: Colors.black45,
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  child: Text(
                                    op.command!,
                                    style: const TextStyle(
                                      color: Color(0xFF00E5FF),
                                      fontFamily: 'monospace',
                                      fontSize: 12,
                                    ),
                                  ),
                                ),
                              ],
                            ],
                          );
                        },
                      ),
                  ],
                ),
              ),

            const SizedBox(height: 16),

            // --- Affected Directories ---
            if (widget.request.directories.isNotEmpty)
              Container(
                margin: const EdgeInsets.only(bottom: 16),
                decoration: BoxDecoration(
                  color: const Color(0xFF14142B),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: Colors.white10),
                ),
                child: Column(
                  children: [
                    ListTile(
                      dense: true,
                      leading: const Icon(Icons.folder_outlined,
                          color: Color(0xFF00E5FF), size: 18),
                      title: Text(
                        'Target Directories (${widget.request.directories.length})',
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 13,
                            fontWeight: FontWeight.w600),
                      ),
                      trailing: Icon(
                        _expandedDirs
                            ? Icons.keyboard_arrow_up
                            : Icons.keyboard_arrow_down,
                        color: Colors.white54,
                      ),
                      onTap: () {
                        setState(() {
                          _expandedDirs = !_expandedDirs;
                        });
                      },
                    ),
                    if (_expandedDirs)
                      Padding(
                        padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: widget.request.directories
                              .map(
                                (d) => Padding(
                                  padding: const EdgeInsets.only(bottom: 4),
                                  child: Text(
                                    d,
                                    style: const TextStyle(
                                      color: Colors.white70,
                                      fontFamily: 'monospace',
                                      fontSize: 12,
                                    ),
                                  ),
                                ),
                              )
                              .toList(),
                        ),
                      ),
                  ],
                ),
              ),

            // --- DUAL-GATE VERIFICATION BOX ---
            Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                color: const Color(0xFF171738),
                borderRadius: BorderRadius.circular(18),
                border: Border.all(
                  color: const Color(0xFF00E5FF).withOpacity(0.3),
                  width: 1.5,
                ),
                boxShadow: [
                  BoxShadow(
                    color: const Color(0xFF00E5FF).withOpacity(0.08),
                    blurRadius: 16,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.lock_person_outlined,
                          color: Color(0xFF00E5FF), size: 22),
                      const SizedBox(width: 8),
                      const Text(
                        'DUAL VERIFICATION GATE',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                          letterSpacing: 1.2,
                          fontSize: 13,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    widget.request.requiresBiometric || widget.request.isRemote
                        ? 'Requires Master PIN + Device Screen Lock (Fingerprint/PIN) to authorize execution.'
                        : 'Requires Master PIN to authorize execution.',
                    style: const TextStyle(color: Colors.white70, fontSize: 12),
                  ),
                  const SizedBox(height: 14),

                  // PIN Input Field
                  TextField(
                    controller: _pinController,
                    keyboardType: TextInputType.number,
                    maxLength: 6,
                    obscureText: _obscurePin,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 24,
                      letterSpacing: 8,
                      fontWeight: FontWeight.bold,
                    ),
                    textAlign: TextAlign.center,
                    decoration: InputDecoration(
                      hintText: '••••••',
                      hintStyle: TextStyle(
                        color: Colors.white24,
                        letterSpacing: 8,
                        fontSize: 24,
                      ),
                      counterText: '',
                      filled: true,
                      fillColor: Colors.black38,
                      suffixIcon: IconButton(
                        icon: Icon(
                          _obscurePin
                              ? Icons.visibility_outlined
                              : Icons.visibility_off_outlined,
                          color: Colors.white54,
                          size: 20,
                        ),
                        onPressed: () {
                          setState(() {
                            _obscurePin = !_obscurePin;
                          });
                        },
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: const BorderSide(color: Colors.white24),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: const BorderSide(
                            color: Color(0xFF00E5FF), width: 2),
                      ),
                    ),
                  ),

                  if (_errorMessage != null) ...[
                    const SizedBox(height: 10),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 8),
                      decoration: BoxDecoration(
                        color: Colors.red.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: Colors.redAccent, width: 1),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.error_outline,
                              color: Colors.redAccent, size: 16),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              _errorMessage!,
                              style: const TextStyle(
                                  color: Colors.redAccent, fontSize: 12),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],

                  const SizedBox(height: 20),

                  // Action Buttons
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: _isProcessing ? null : _handleDeny,
                          style: OutlinedButton.styleFrom(
                            side: const BorderSide(color: Colors.white24),
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                          ),
                          child: const Text(
                            'Deny',
                            style: TextStyle(
                              color: Colors.white70,
                              fontWeight: FontWeight.bold,
                              fontSize: 14,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        flex: 2,
                        child: ElevatedButton(
                          onPressed: _isProcessing ? null : _handleApprove,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFF00E5FF),
                            foregroundColor: Colors.black,
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                          ),
                          child: _isProcessing
                              ? const SizedBox(
                                  width: 20,
                                  height: 20,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2.5,
                                    color: Colors.black,
                                  ),
                                )
                              : Row(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: const [
                                    Icon(Icons.fingerprint_rounded, size: 18),
                                    SizedBox(width: 6),
                                    Text(
                                      'Verify & Approve',
                                      style: TextStyle(
                                        fontSize: 14,
                                        fontWeight: FontWeight.w900,
                                      ),
                                    ),
                                  ],
                                ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  Widget _buildPill(String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withOpacity(0.4)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }
}

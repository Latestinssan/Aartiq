import 'package:flutter/material.dart';

class DeviceImageWidget extends StatelessWidget {
  final String deviceType; // 'macbook' | 'imac' | 'windows-laptop' | 'windows-pc' | 'android-phone' | 'iphone' | 'tablet'
  final double size;
  final bool isOnline;
  final bool isPermanentSynced;

  const DeviceImageWidget({
    Key? key,
    required this.deviceType,
    this.size = 64,
    this.isOnline = true,
    this.isPermanentSynced = false,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Stack(
      alignment: Alignment.center,
      children: [
        _buildDeviceBody(),
        // Online / Permanent Sync Indicator Badge
        Positioned(
          bottom: 0,
          right: 0,
          child: Container(
            padding: const EdgeInsets.all(2),
            decoration: const BoxDecoration(
              color: Color(0xFF0D0D1A),
              shape: BoxShape.circle,
            ),
            child: Container(
              width: size * 0.22,
              height: size * 0.22,
              decoration: BoxDecoration(
                color: isPermanentSynced
                    ? const Color(0xFF00E5FF)
                    : (isOnline ? const Color(0xFF10B981) : Colors.white24),
                shape: BoxShape.circle,
                border: Border.all(color: Colors.black, width: 1.5),
                boxShadow: [
                  if (isOnline)
                    BoxShadow(
                      color: (isPermanentSynced
                              ? const Color(0xFF00E5FF)
                              : const Color(0xFF10B981))
                          .withOpacity(0.6),
                      blurRadius: 6,
                    ),
                ],
              ),
              child: isPermanentSynced
                  ? Center(
                      child: Icon(
                        Icons.lock_rounded,
                        size: size * 0.12,
                        color: Colors.black,
                      ),
                    )
                  : null,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildDeviceBody() {
    final type = deviceType.toLowerCase();

    if (type.contains('macbook') || type.contains('laptop')) {
      return _buildLaptopGraphic();
    } else if (type.contains('imac') || type.contains('pc') || type.contains('desktop')) {
      return _buildDesktopGraphic();
    } else if (type.contains('iphone')) {
      return _buildIPhoneGraphic();
    } else {
      return _buildAndroidPhoneGraphic();
    }
  }

  Widget _buildLaptopGraphic() {
    return Container(
      width: size,
      height: size * 0.75,
      padding: EdgeInsets.symmetric(horizontal: size * 0.05),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          // Screen Bezel
          Container(
            width: size * 0.8,
            height: size * 0.5,
            decoration: BoxDecoration(
              color: const Color(0xFF1C1C24),
              borderRadius: BorderRadius.circular(size * 0.06),
              border: Border.all(color: const Color(0xFF4A4A5A), width: 1.5),
            ),
            child: Center(
              child: Container(
                width: size * 0.72,
                height: size * 0.42,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFF0A0E1A), Color(0xFF152238)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(size * 0.04),
                ),
                child: Center(
                  child: Icon(
                    Icons.language_rounded,
                    color: const Color(0xFF00E5FF),
                    size: size * 0.22,
                  ),
                ),
              ),
            ),
          ),
          // Keyboard Deck & Base
          Container(
            width: size * 0.95,
            height: size * 0.08,
            decoration: BoxDecoration(
              color: const Color(0xFF33333F),
              borderRadius: BorderRadius.vertical(bottom: Radius.circular(size * 0.04)),
              border: Border.all(color: const Color(0xFF555566), width: 0.8),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDesktopGraphic() {
    return Container(
      width: size,
      height: size * 0.85,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          // Monitor Screen
          Container(
            width: size * 0.88,
            height: size * 0.55,
            decoration: BoxDecoration(
              color: const Color(0xFF1C1C24),
              borderRadius: BorderRadius.circular(size * 0.06),
              border: Border.all(color: const Color(0xFF4A4A5A), width: 1.5),
            ),
            child: Center(
              child: Icon(
                Icons.computer_rounded,
                color: const Color(0xFF00E5FF),
                size: size * 0.3,
              ),
            ),
          ),
          // Stand Neck
          Container(
            width: size * 0.12,
            height: size * 0.12,
            color: const Color(0xFF33333F),
          ),
          // Stand Base
          Container(
            width: size * 0.45,
            height: size * 0.05,
            decoration: BoxDecoration(
              color: const Color(0xFF444455),
              borderRadius: BorderRadius.circular(size * 0.02),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAndroidPhoneGraphic() {
    return Container(
      width: size * 0.55,
      height: size * 0.9,
      decoration: BoxDecoration(
        color: const Color(0xFF1E1E2C),
        borderRadius: BorderRadius.circular(size * 0.12),
        border: Border.all(color: const Color(0xFF00E5FF).withOpacity(0.5), width: 1.5),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF00E5FF).withOpacity(0.12),
            blurRadius: 10,
          ),
        ],
      ),
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Punch-hole camera dot
          Positioned(
            top: size * 0.06,
            child: Container(
              width: size * 0.06,
              height: size * 0.06,
              decoration: const BoxDecoration(
                color: Colors.black,
                shape: BoxShape.circle,
              ),
            ),
          ),
          Center(
            child: Icon(
              Icons.phone_android_rounded,
              color: const Color(0xFF00E5FF),
              size: size * 0.35,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildIPhoneGraphic() {
    return Container(
      width: size * 0.55,
      height: size * 0.9,
      decoration: BoxDecoration(
        color: const Color(0xFF1E1E2C),
        borderRadius: BorderRadius.circular(size * 0.14),
        border: Border.all(color: const Color(0xFFD500F9).withOpacity(0.5), width: 1.5),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFFD500F9).withOpacity(0.12),
            blurRadius: 10,
          ),
        ],
      ),
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Dynamic Island Notch
          Positioned(
            top: size * 0.06,
            child: Container(
              width: size * 0.22,
              height: size * 0.06,
              decoration: BoxDecoration(
                color: Colors.black,
                borderRadius: BorderRadius.circular(size * 0.03),
              ),
            ),
          ),
          Center(
            child: Icon(
              Icons.phone_iphone_rounded,
              color: const Color(0xFFD500F9),
              size: size * 0.35,
            ),
          ),
        ],
      ),
    );
  }
}

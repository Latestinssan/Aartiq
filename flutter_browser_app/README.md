# Aartiq Mobile

![Aartiq](assets/icon/icon.png)

A next-generation AI-native mobile companion browser created using Flutter. Connects seamlessly with Aartiq Desktop for remote control, unified session synchronization, and dual-gate security approval.

- **Official Website**: [https://aartiq.ponsrischool.in](https://aartiq.ponsrischool.in)
- **Repository**: [https://github.com/Latestinssan/Aartiq](https://github.com/Latestinssan/Aartiq)

---

## Core Capabilities

### 1. Dual-Gate Permission Approval
- **Exact Desktop Risk Tiers**: Displays automation plans with the same risk categorization (`CRITICAL` 🔴, `HIGH` 🟠, `MEDIUM` 🟡, `LOW` 🟢), step-by-step shell operation code blocks, risk factors, and security mitigations as the desktop application.
- **Gate 1 — Master PIN**: Required 6-digit PIN hashed using PBKDF2-SHA256 (600,000 rounds; PINs created at the earlier 100,000-round cost keep verifying and are re-hashed on first successful unlock) stored securely in Android Keystore / iOS Keychain.
- **Gate 2 — Android Screen Lock / Biometrics**: Android native device verification (`local_auth`) using biometric fingerprint/face or device PIN/pattern. Both gates must succeed to authorize remote and high-risk executions.

### 2. Unified Session Synchronization
- **Live Active Session**: Stream active tabs, running automation tasks, browsing history, and permission decision audits in real time.
- **Past Sessions Archive**: Browse historical desktop sessions with tab counts, visited URLs, and automation records.
- **Two Sync Channels**:
  - **Local LAN**: Real-time WebSocket connection on port `3004` with UDP broadcast discovery on port `3005`.
  - **Remote Cloud**: Firebase Realtime Database for devices signed in with the same Google Account.

### 3. Permanent Sync Authentication
- Once paired, desktop and mobile establish a cryptographically secure 256-bit permanent token stored in native OS secure storage (`FlutterSecureStorage` with Android Keystore encryption).
- Subsequent connections auto-authenticate permanently without re-entering pairing codes.

### 4. Real Device Hardware Detection & Device Images
- Real device identification (`device_info_plus`): Detects friendly computer names (e.g. *"Sandip’s MacBook Pro"*) and mobile models (e.g. *"Google Pixel 8 Pro"*).
- Visual device graphics (`DeviceImageWidget`): Displays hardware-accurate illustrations (MacBook, iMac, Android phone, iPhone) with live status and permanent sync badges across the app.

---

## Setup & Running

```bash
cd flutter_browser_app

# Install dependencies
flutter pub get

# Run on Android / iOS
flutter run
```

### Android Native Requirements
- `MainActivity.kt` extends `FlutterFragmentActivity` (required for Android Biometric & Screen Lock authentication).
- `AndroidManifest.xml` includes `USE_BIOMETRIC` permission.

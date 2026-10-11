# ⚙️ Aartiq Browser Setup & Deployment Guide

This guide covers the technical setup for Firebase, MySQL, Vercel deployment, and building native binaries.

## 🔑 Firebase Configuration

Aartiq uses Firebase for Authentication and secondary state synchronization.

1.  **Project Setup:** Create a project at [Firebase Console](https://console.firebase.google.com).
2.  **Enable Auth:** Enable "Google" as an Authentication provider.
3.  **App Config:** Create a Web App and copy the configuration to your `.env.local`:
    ```env
    NEXT_PUBLIC_FIREBASE_API_KEY=your_key
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_id
    NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
    ```
4.  **Security Note:** Firebase initialization in `Aartiq-Landing-Page/src/lib/firebase.ts` uses these environment variables. Ensure they are set in your hosting environment (e.g., Vercel).
5.  **Admin SDK (Desktop Backend):** If you are using administrative features in the Electron main process:
    -   Download your service account JSON from Firebase Console.
    -   Save it as `aartiq-browser/config/firebase-admin.json`.
    -   **NEVER** commit this file to GitHub. It is already added to `.gitignore`.

## 🗄️ MySQL Master Sync

For cross-device synchronization, setup a MySQL/MariaDB database:

- Set `MYSQL_URL` or individual `MYSQL_*` variables in your environment.
- The browser will automatically attempt to initialize tables on the first sync.

## 🌐 Vercel Deployment

The landing page and web-lite version of Aartiq can be hosted on Vercel:

1.  **Push to GitHub:** Ensure your repository is up to date.
2.  **Connect to Vercel:** Import your repository.
3.  **Environment Variables:** Add all `NEXT_PUBLIC_*` variables in the Vercel dashboard.
4.  **Build Command:** `next build`
5.  **Output Directory:** `.next`

Your project will be live at `https://your-domain.vercel.app` (or your custom domain like `browser.ponsrischool.in`).

## 📦 Building Native Binaries

To generate production installers:

```bash
# Windows
npm run build-electron -- --win

npm install --prefix . --install-strategy=nested --no-workspaces --ignore-workspace-root-check
# macOS
npm run build-electron -- --mac

# Linux
npm run build-electron -- --linux
```

The resulting installers will be in the `/release` or `/dist` folder.

## 🧩 Extension Management

Load local Chrome extensions by placing them in your OS UserData directory:
1. Go to **Settings > Extensions**.
2. Click **View Extensions Dir**.
3. Drop your extension folder (with `manifest.json`) inside.
4. Restart Aartiq.

## 📱 Mobile (Flutter) Configuration

To enable P2P synchronization on Android and iOS:

1.  **Add Android App:**
    -   Use Package Name: `com.aartiq`.
    -   Register the app in Firebase Console.
    -   Download `google-services.json` and place it in `flutter_browser_app/android/app/`.

2.  **Add iOS App:**
    -   Use Bundle ID: `com.aartiq`.
    -   Download `GoogleService-Info.plist` and place it in `flutter_browser_app/ios/Runner/`.

3.  **Realtime Database:** Ensure **Realtime Database** is enabled in your Firebase project (required for P2P signaling).

4.  **Google Auth (Android):** Add your SHA-1 fingerprint to the Firebase console to enable Google Sign-in.
    -   To get debug SHA-1: `cd android && ./gradlew signingReport`.

---

*Version: 0.2.0-stable (Sync Update)*

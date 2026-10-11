# Contributing to Aartiq Browser

First off, thank you for considering contributing to Aartiq Browser! It's people like you that make building open-source software such a rewarding experience.

This project is built by a student developer, and help from the community is highly appreciated to move it towards v1.0.0.

## 🤝 Code of Conduct

We are committed to providing a friendly, safe, and welcoming environment for all, regardless of level of experience, gender identity and expression, sexual orientation, disability, personal appearance, body size, race, ethnicity, age, religion, nationality, or other similar characteristic.

## 🐛 Reporting Bugs

A great way to contribute is to report bugs. If you encounter a problem, please visit our [Official Website](https://browser.ponsrischool.in) for support or reporting mechanisms.
1.  **A clear title**: "Settings panel crashes on Windows 11"
2.  **Description**: What were you doing? What happened? What did you expect?
3.  **Steps to reproduce**: Numbered steps to make the bug happen.
4.  **Environment**: OS (e.g., Windows 10, macOS 14), Browser version (if applicable).

## 💡 Suggesting Enhancements

If you have an idea for a feature or an improvement:
1.  Check existing issues to avoiding duplication.
2.  Open a new issue with the tag `enhancement` or `feature request`.
3.  Describe your idea clearly and why it would be useful.

## 💻 Development Workflow

1.  **Fork the repository** on GitHub: [https://github.com/Latestinssan/Aartiq](https://github.com/Latestinssan/Aartiq)
2.  **Clone the Repo** locally:
    ```bash
    git clone https://github.com/YOUR-USERNAME/Aartiq.git
    cd Aartiq
    ```
3.  **Create a branch** for your feature or fix:
    ```bash
    git checkout -b feature/amazing-new-feature
    # or
    git checkout -b fix/critical-bug
    ```

### 🖥️ Desktop (Electron + Next.js)

The desktop code is located in `aartiq-browser`.

1.  Navigate to the directory:
    ```bash
    cd aartiq-browser
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Setup environment variables:
    ```bash
    cp .env.example .env.local
    # Edit .env.local with your API keys if working on AI features
    ```
4.  Run the development environment:
    *   **Terminal 1 (Next.js Renderer)**: `npm run dev`
    *   **Terminal 2 (Electron Main)**: `npm run electron-start`

### 📱 Mobile (Flutter)

The mobile code is located in `flutter_browser_app` (a Flutter app in the same repository).

1.  Navigate to the directory:
    ```bash
    cd flutter_browser_app
    ```
2.  Install dependencies:
    ```bash
    flutter pub get
    ```
3.  Run on an emulator or device:
    ```bash
    flutter run
    ```

## 📥 Submitting a Pull Request

1.  **Commit your changes** with clear, descriptive messages:
    ```bash
    git commit -m "Fix: Resolve splash screen freeze on Android"
    ```
2.  **Push to your fork**:
    ```bash
    git push origin feature/amazing-new-feature
    ```
3.  **Open a Pull Request** (PR) on the main repository.
    *   Reference any issues your PR fixes (e.g., "Fixes #123").
    *   Provide screenshots or videos for UI changes.

## 🎨 Code Style

-   **TypeScript/JavaScript**: We follow standard React/Next.js best practices.
-   **Flutter**: We follow standard Dart linting rules.
-   **Commits**: Use semantic commit messages if possible (e.g., `feat:`, `fix:`, `docs:`, `style:`, `refactor:`).

## 🚀 Creating Releases

### Quick Release (Tag Push)
```bash
git tag v0.3.8
git push origin v0.3.8
```
The CI will automatically build all platforms and create a GitHub release.

### Manual Release
1. Go to **Actions** → **🚀 Publish Release** (release.yml)
2. Click **Run workflow**
3. Enter version number and options

### Landing Page Auto-Detection
The landing page automatically fetches downloads from GitHub releases using:
```
https://api.github.com/repos/Latestinssan/Aartiq/releases/latest
```

## ❓ Need Help?

If you have questions, feel free to contact us via the official website at [https://browser.ponsrischool.in](https://browser.ponsrischool.in).

Thank you for contributing! 🚀

## 🏆 Contributors

We recognize the people who have helped shape Aartiq beyond code contributions.

### Shashank Shekhar

> *Microsoft Store Advisor · UI/UX Feedback*

**GitHub:** [theshekhr](https://github.com/theshekhr)

- **Microsoft Store Guidance:** Shared his store submission experience and encouraged pursuing a store listing
- **UI/UX Feedback:** Flagged macOS-specific UI on Windows, pushed for platform-native design
- **Design Direction:** Suggested ad-blocking and a clean, minimal UI inspired by Zen Browser

### eddzsh

> *Security Architecture · Electron IPC Trust Boundary · Approval System Design*

**Reddit:** [eddzsh](https://www.reddit.com/user/eddzsh)

eddzsh is the security architect behind Aartiq's ticket-based approval system. Through detailed discussions on r/electronjs, he designed the exact pattern Aartiq now uses for its permission model. His contributions include:

- **Ticket-Based Approval Pattern:** Designed the signed ticket system where main process issues a request ID, stores exact params server-side, and only lets the approval event redeem that specific ticket
- **Hash Verification at Propose Time:** Proposed hashing the exact payload at propose time and diffing it against execution — catching race conditions where the AI assembles different params after approval
- **Pre-Registered Call Shapes:** Designed the system for unattended/scheduled execution where exact call shapes (tool + fixed args) are registered during interactive sessions and verified at runtime
- **Pattern-Based Approval:** Suggested scoping approvals to patterns instead of literal values for scheduled tasks with variable args (e.g., dated filenames)
- **Trust Boundary Design:** Articulated the core principle that "nothing stops params being tampered with in transit" and built the foundation to prevent it

### Dxrkaa

> *First Issue Reporter · Early Adopter · Bug Hunter*

**GitHub:** [Dxrkaa](https://github.com/Dxrkaa) · **Issue:** [#6](https://github.com/Latestinssan/Aartiq/issues/6)

Dxrkaa opened the first community-reported bug on Aartiq. His contributions include:

- **First Issue Report:** Opened [Issue #6](https://github.com/Latestinssan/Aartiq/issues/6) reporting that the latest version failed to launch on Windows (process running in Task Manager but no window visible)
- **Early Adoption:** Was among the first external users to install and test Aartiq on Windows
- **Bug Discovery:** Identified a critical launch regression that was fixed in v0.2.9
- **Community Catalyst:** The first issue report marked the beginning of Aartiq's public bug-tracking lifecycle

---

## 📝 License

Aartiq uses a **dual-license** model:

- **Aartiq Browser** (desktop, mobile, all core code): [Apache License 2.0](LICENSE)
- **Aartiq MCP Server** (`aartiq-mcp/`): [MIT License](aartiq-mcp/LICENSE)

The MCP server is licensed under MIT for maximum compatibility with the Claude Desktop ecosystem and other MCP clients. All other components remain under Apache 2.0.

By contributing, you agree that your contributions will be licensed under the same license as the component you are contributing to.

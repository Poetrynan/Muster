# 🐛 Muster v0.1.3 — Version Display Hotfix

> v0.1.3 fixes version-number inconsistencies left over from the v0.1.2 release:
> the About page and the login footer still showed v0.1.1, and the update-check
> baseline was stale, which would have prompted v0.1.2 users with a false
> "new version available" notice.

---

## 🐛 Fixed in v0.1.3

### 1. About page showed the wrong version ❌→✅
The Settings → About page (and the login-page footer, in all four languages)
still displayed v0.1.1. The version baseline is now **v0.1.3** everywhere:
About page, login footer (zh/en/ja/ko), update-check baseline.

### 2. Stale update-check baseline ❌→✅
`APP_CURRENT_VERSION` had not been bumped for the multi-platform release, so
installed v0.1.2 users would always see a false "update available" prompt.
The baseline is now v0.1.3 and matches the installer versions.

### 3. README installer names synchronized ❌→✅
The English/中文/日本語/한국어 READMEs now reference the current installer
names (`Muster_0.1.3_*`) for Windows and both macOS variants.

---

## 🪟🍏 Downloads

| Platform | Type | File |
|---|---|---|
| 🪟 **Windows** | 64-bit NSIS Setup (Recommended) | `Muster_0.1.3_x64-setup.exe` |
| 🪟 **Windows** | 64-bit MSI Installer | `Muster_0.1.3_x64_en-US.msi` |
| 🍏 **macOS** | Apple Silicon (M1 / M2 / M3 / M4) | `Muster_0.1.3_aarch64.dmg` |
| 🍏 **macOS** | Intel x86_64 | `Muster_0.1.3_x64.dmg` |

> **macOS first launch:** right-click the app → **Open** (or run `xattr -dr com.apple.quarantine /Applications/Muster.app`) to bypass Gatekeeper for unsigned development builds.

---

# 🎉 Muster v0.1.2 — Multi-Platform Release (Windows & macOS)

> **Muster** is a modern, high-performance desktop companion for Monash Moodle. It aggregates your deadlines, course resources, grades, and announcements into a clean, lightning-fast native interface.
>
> **v0.1.2** is our first **multi-platform release**, adding official macOS application support (Apple Silicon & Intel DMG installers) alongside extensive reliability fixes, instant course loading, and accurate assignment tracking.

---

## 🌟 What's New in v0.1.2

### 1. 🍏 Official macOS Support (Apple Silicon & Intel)
- **Native DMG Installers**: Separate optimized builds for Apple Silicon (M1/M2/M3/M4) and Intel-based Macs.
- **WKWebView Cookie Sync**: Direct HttpOnly session extraction from macOS WebKit data store for seamless Okta SSO authentication.
- **macOS Menu Bar Tray**: Integrated status bar tray menu with a custom macOS monochrome template icon.
- **Apple Keychain Integration**: Session cookies and credentials are secure in Apple's native Keychain.

> [!TIP]
> **macOS First-Launch Note (Gatekeeper)**:
> As an open-source student project, Muster binaries are self-signed. On first launch, macOS Gatekeeper may display a security prompt. Simply navigate to **System Settings → Privacy & Security** and click **"Open Anyway"** (or run `xattr -cr /Applications/Muster.app` in Terminal).

---

### 2. 🪟 Submission Tracking & Course Sync Fixes
- **Real Submission State**: Assignments now reflect live Moodle submission state (**Submitted**, **Graded**, or **To be submitted**) instead of defaulting to pending.
- **Quiz Integration**: Quizzes and weightings are merged into unified deadline tables across all units.
- **No Login Flash**: Returning users go straight to the dashboard with zero white flash.
- **Instant Tab Switching**: All course tabs (Overview, Handbook, Schedule, Recordings, Contacts) are cached upon login for instant rendering.
- **Download Manager**: Course resources download with live progress bars, transfer speeds, and direct "Show in folder" actions.

---

## 🖼️ Feature Walkthrough

### 📊 Consolidated Dashboard
<p align="center">
  <img src="https://raw.githubusercontent.com/Poetrynan/Muster/main/assets/preview/dashboard.svg" alt="Muster Dashboard" width="800" />
</p>

### 📝 Assignment Tracker & Real Submission Status
<p align="center">
  <img src="https://raw.githubusercontent.com/Poetrynan/Muster/main/assets/preview/assignments.svg" alt="Muster Assignments" width="800" />
</p>

### 📢 Smart Announcement Centre
<p align="center">
  <img src="https://raw.githubusercontent.com/Poetrynan/Muster/main/assets/preview/announcements.svg" alt="Muster Announcements" width="800" />
</p>

### 📥 High-Speed Download Manager
<p align="center">
  <img src="https://raw.githubusercontent.com/Poetrynan/Muster/main/assets/preview/downloads.svg" alt="Muster Download Manager" width="600" />
</p>

### 🤖 AI-Powered Course Summaries
<p align="center">
  <img src="https://raw.githubusercontent.com/Poetrynan/Muster/main/assets/preview/ai-summary.svg" alt="Muster AI Summary" width="700" />
</p>

---

## 📦 Downloads & Installation

| Platform | Architecture / Type | File Name | Status |
| :--- | :--- | :--- | :--- |
| 🪟 **Windows** | 64-bit NSIS Setup (Recommended) | `Muster_0.1.2_x64-setup.exe` | ✅ Stable |
| 🪟 **Windows** | 64-bit MSI Installer | `Muster_0.1.2_x64_en-US.msi` | ✅ Stable |
| 🍏 **macOS** | Apple Silicon (M1 / M2 / M3 / M4) | `Muster_0.1.2_aarch64.dmg` | 🧪 New |
| 🍏 **macOS** | Intel x86_64 | `Muster_0.1.2_x64.dmg` | 🧪 New |

---

*Made with ❤️ for students by Poetrynan. Released under the PolyForm Noncommercial License 1.0.0.*

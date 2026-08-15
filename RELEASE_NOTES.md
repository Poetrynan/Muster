# 🎉 Muster v0.1.0 — Initial Public Release

> **Muster** is a modern, high-performance desktop companion for Monash Moodle. It aggregates your deadlines, course resources, grades, and announcements into a clean, lightning-fast native interface.

---

## 🌟 Key Features & Visual Walkthrough

### 1. 📊 Consolidated Dashboard & Urgency Tracker
Get a bird's-eye view of your entire semester. Merged deadlines are automatically classified into **Due in 7 days**, **Pending**, and **Completed**, with direct one-click access.

<p align="center">
  <img src="assets/preview/dashboard.svg" alt="Muster Dashboard" width="800" />
</p>

---

### 2. 📝 Assignment Tracker & Real Submission Status
Track all assignments and quizzes across units. Real-time submission status, weightings, due dates, and grading feedback in one unified list.

<p align="center">
  <img src="assets/preview/assignments.svg" alt="Muster Assignments" width="800" />
</p>

---

### 3. 📢 Smart Notification & Announcement Centre
Never miss an urgent update from your lecturers. Announcements are automatically classified by topic (Exam, Assignment, Quiz, General) with direct links to discussion threads.

<p align="center">
  <img src="assets/preview/announcements.svg" alt="Muster Announcements" width="800" />
</p>

---

### 4. 📥 High-Speed Multi-Thread Download Manager
Download course slides, PDFs, and assignment specs with live progress, transfer speed indicators, and instant folder reveal.

<p align="center">
  <img src="assets/preview/downloads.svg" alt="Muster Download Manager" width="600" />
</p>

---

### 5. 🤖 AI-Powered Course Summaries
Streamline your revision with live AI summaries. Stream Markdown summaries of lecture topics, objectives, and key takeaways directly within the app using your own API key.

<p align="center">
  <img src="assets/preview/ai-summary.svg" alt="Muster AI Summary" width="700" />
</p>

---

## 🔒 Security & Privacy Guarantee

- **Zero Telemetry**: No third-party analytics or external tracking servers.
- **OS-Level Keyring**: Moodle sessions are stored in your operating system's secure credential vault (Windows Credential Manager / macOS Keychain).
- **Client-Side AI**: Your AI API keys remain in memory and in your local sandbox, never shared or stored remotely.

---

## 📦 Downloads & Installation

> [!NOTE]
> **Platform Support**: Muster supports **Windows 10 / 11 (64-bit)** and now includes a beta build for **Apple Silicon Macs running macOS 12 or later**.

| Platform | Package Type | File | Status |
| :--- | :--- | :--- | :--- |
| **Windows** (Recommended) | NSIS Installer | `Muster_0.1.0_x64-setup.exe` | ✅ Available |
| **Windows** | Enterprise MSI | `Muster_0.1.0_x64_en-US.msi` | ✅ Available |
| **Windows** | Standalone Executable | `muster.exe` | ✅ Available |
| **macOS** | Apple Silicon DMG | `Muster_0.1.0_aarch64.dmg` | 🧪 Beta |

> [!IMPORTANT]
> The macOS beta uses an ad-hoc signature and is not notarized by Apple. On first launch, macOS may block the app. After attempting to open Muster, go to **System Settings → Privacy & Security** and choose **Open Anyway**. Intel Macs are not supported.

---

*Made with ❤️ for students by Poetrynan. Released under the PolyForm Noncommercial License 1.0.0.*

# Muster

<p align="center">
  <a href="README.md"><img src="https://img.shields.io/badge/EN-English-blue?style=flat-square" alt="English"></a>
  <a href="README.zh-CN.md"><img src="https://img.shields.io/badge/中文-简体中文-red?style=flat-square" alt="简体中文"></a>
  <a href="README.ja.md"><img src="https://img.shields.io/badge/日本語-日本語-9cf?style=flat-square" alt="日本語"></a>
  <a href="README.ko.md"><img src="https://img.shields.io/badge/한국어-한국어-ff69b4?style=flat-square" alt="한국어"></a>
</p>

<p align="center">
  <img src="assets/banner.svg" alt="For The Better Monash · works with Moodle" width="480">
</p>

> **For The Better Monash · works with Moodle™** — an all-in-one desktop companion for your own Moodle coursework.

<p align="center">
  <a href="https://github.com/Poetrynan/Muster/stargazers"><img src="https://img.shields.io/github/stars/Poetrynan/Muster?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Stars"></a>
  <a href="https://github.com/Poetrynan/Muster"><img src="https://img.shields.io/badge/GitHub-Repository-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Repository"></a>
  <a href="https://github.com/Poetrynan/Muster/releases"><img src="https://img.shields.io/badge/version-0.1.1-38bdf8?style=for-the-badge" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-PolyForm%20Noncommercial%201.0.0-38bdf8?style=for-the-badge" alt="License: PolyForm Noncommercial 1.0.0"></a>
</p>

> **For The Better Monash** — Muster is an independent, free project created by a Monash student with a simple goal: to make everyday learning through Moodle more efficient and accessible. Courses, deadlines, announcements and resources all in one place — less time digging through Moodle, more time actually learning. When students study better, Monash gets better, one small step at a time.
>
> Muster is **not** a Monash University or Moodle product. It is not affiliated with Monash University or Moodle Pty Ltd. "Monash" and "Moodle" are trademarks of their respective owners, used here only to describe what this software works with.
>
> Muster runs locally on the user's device and does not collect or transmit Moodle credentials or course data. It only accesses resources that the authenticated user is already authorised to access.
>
> Source code is publicly available under the **PolyForm Noncommercial License 1.0.0** — free of charge for personal, non-commercial use.
>
> Muster is provided for personal, non-commercial study use only. If you breach the license or the terms of use (including but not limited to selling this software for profit or violating your institution's policies), you bear all resulting legal liability yourself; the original author bears none.

Muster is a desktop app for students. It aggregates everything scattered across Moodle — courses, assignments, deadlines, quizzes, announcements and resources — into one clean dashboard, so you never miss a due date again.

## ✨ Highlights

### 📅 Unified Deadline Calendar
Every assignment, quiz and exam deadline from all your courses is merged into one timeline, grouped by **today / next 7 days / this month**. No more digging through each course page to find out what is due.
> For example: one glance tells you — Quiz 1 is due in 3 days, AT3 in 2 weeks.

<p align="center"><img src="assets/preview/dashboard.svg" alt="Muster dashboard showing merged deadlines grouped by urgency" width="840"></p>

### 🔔 Smart Reminders
System notifications fire before a deadline, when new materials are synced, when a course posts a new announcement, and when grades are released. You pick how early to be reminded (1 / 3 / 7 days).
> For example: you get a notification "Applied Task AT3 — due in 3 days" while working on something else.

### 📄 Assignment Tracking
Assignments are sorted by due date with the **real submission status** from Moodle (submitted / graded / pending). Past-semester items are automatically archived into a quiet "past courses" section — they never nag you again.
> For example: the progress bar only counts assignments that actually have a submission status, so it is honest.

<p align="center"><img src="assets/preview/assignments.svg" alt="Muster assignment list with real Moodle submission status" width="840"></p>

### 🗂️ Announcement Intelligence
Announcements are auto-classified (assignment / quiz / exam / material / grade), grouped by course, sorted unread-first, with a one-tap type filter. No more scrolling a flat wall of posts.
> For example: filter to "exam" and instantly see every exam-related notice across all courses.

<p align="center"><img src="assets/preview/announcements.svg" alt="Muster notification centre with auto-classified announcements" width="840"></p>

### 📥 Download Manager
Batch-download course materials (PDFs, slides, folders) to a local folder with live progress and speed, and open the folder after download. Study offline, anywhere.
> For example: before a long flight, download this week's lectures in one click.

<p align="center"><img src="assets/preview/downloads.svg" alt="Muster download manager with live progress and speed" width="640"></p>

### 🤖 AI Course Summaries
One click summarizes the week's materials, assignments and announcements — with **streaming output** (text types in live) and full Markdown rendering. The summary language follows your interface language.
> For example: open a course, tap "generate", and get a structured summary: overview → key resources → assignments & quizzes → next steps.

<p align="center"><img src="assets/preview/ai-summary.svg" alt="Muster AI course summary streaming in live with Markdown rendering" width="760"></p>

### 🔒 Privacy-First
All data stays on your machine. Authentication goes through Monash Okta SSO directly — no plain-text password is ever stored, and session cookies are protected by the OS credential store.
> For example: uninstall the app and nothing of yours is left on any server.


## 🚀 Getting Started

> **Platforms**: Muster supports **Windows 10 / 11 (64-bit)** and **macOS 12+ (Apple Silicon & Intel)**.

1. Download the latest installer from the [Releases](https://github.com/Poetrynan/Muster/releases) page:
   - **Windows**: `Muster_0.1.1_x64-setup.exe` (or `.msi`)
   - **macOS (Apple Silicon M1/M2/M3/M4)**: `Muster_0.1.1_aarch64.dmg`
   - **macOS (Intel)**: `Muster_0.1.1_x64.dmg`
2. Launch the app and sign in with your Monash account (Okta SSO).
3. Click **Sync with Moodle** — courses, assignments, resources and announcements will be fetched automatically.

> For developers who want to build from source: see the project structure and run `npm install && npm run build && npx tauri build` (a Rust toolchain is required).

## 🔐 Data & Privacy

- All authentication goes directly through Monash Okta SSO — the app never stores your plain-text Moodle password.
- Session cookies are kept in your OS credential store and never leave your machine.
- Course materials remain the property of their respective owners; this tool only helps you browse and organize them locally.
- Synchronisation is deliberately low-frequency and gently rate-limited (requests are spaced and capped), so Muster always stays well within normal, human-scale usage levels.

## ⚠️ Disclaimer

Muster is an independent personal productivity tool. It is not a Monash University or Moodle product and is not affiliated with Monash University or Moodle Pty Ltd. It only accesses the courses your own account is already entitled to; you remain responsible for complying with your institution's acceptable-use policy and with the copyright in any material you download. See [TERMS.md](TERMS.md) for the full end-user terms.

## 💬 Feedback & Support

Found a bug? Have an idea? Open an [Issue](https://github.com/Poetrynan/Muster/issues) — every piece of feedback shapes the next version.

## 📄 License

Licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE) — free for any noncommercial use, including personal study. Commercial use is not permitted.

© 2026 Poetrynan · Trademark information: [NOTICE](NOTICE) · End-user terms: [TERMS.md](TERMS.md) · Third-party attributions: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)

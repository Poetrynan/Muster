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

> **For The Better Monash · works with Moodle™** — 내 Moodle 학업을 한곳에 모아주는 데스크톱 앱.

<p align="center">
  <a href="https://github.com/Poetrynan/Muster/stargazers"><img src="https://img.shields.io/github/stars/Poetrynan/Muster?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Stars"></a>
  <a href="https://github.com/Poetrynan/Muster"><img src="https://img.shields.io/badge/GitHub-Repository-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Repository"></a>
  <a href="https://github.com/Poetrynan/Muster/releases"><img src="https://img.shields.io/badge/version-0.1.9-38bdf8?style=for-the-badge" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-PolyForm%20Noncommercial%201.0.0-38bdf8?style=for-the-badge" alt="License: PolyForm Noncommercial 1.0.0"></a>
</p>

> **For The Better Monash（더 나은 Monash를 위해）** — Muster는 Monash 학생이 만든 독립적이고 무료인 프로젝트로, Moodle을 통한 일상적인 학습을 더 효율적이고 편리하게 만들겠다는 단순한 목표에서 시작되었습니다. 강의, 과제, 마감일, 공지, 자료를 한곳에 모아 — 헤매는 시간을 줄이고, 진짜 배우는 시간을 늘립니다. 학생들이 더 잘 배울수록 Monash도 더 나아진다고 믿습니다.
>
> Muster는 Monash University 또는 Moodle의 공식 제품이 아닙니다. Monash University 및 Moodle Pty Ltd와 제휴 관계가 없습니다. "Monash"와 "Moodle"은 각 권리자의 상표이며, 본 소프트웨어가 연동하는 대상을 설명하기 위해서만 사용됩니다.
>
> Muster는 사용자 기기에서 로컬로 실행되며, Moodle 자격 증명이나 강좌 데이터를 수집하거나 전송하지 않습니다. 인증된 사용자가 이미 접근 권한을 가진 리소스에만 접근합니다.
>
> 소스 코드는 **PolyForm Noncommercial License 1.0.0**에 따라 공개되어 있으며, 개인·비상업적 용도로 완전히 무료입니다.
>
> Muster는 개인·비상업적 학습 용도로만 제공됩니다. 라이선스 또는 이용 약관을 위반한 경우(본 소프트웨어의 유료 판매나 소속 기관 정책 위반 등을 포함하되 이에 국한되지 않음) 발생하는 모든 법적 책임은 사용자 본인이 부담하며, 원저작자는 책임을 지지 않습니다.

Muster는 학생을 위한 데스크톱 앱입니다. Moodle 곳곳에 흩어진 코스·과제·마감·퀴즈·공지·자료를 하나의 대시보드에 모아, 마감을 놓치지 않게 해줍니다.

## ✨ 주요 기능

### 📅 통합 마감 달력
모든 코스의 과제·퀴즈·시험 마감을 하나의 타임라인으로 통합하고 **오늘 / 앞으로 7일 / 이번 달**으로 그룹화. 코스 페이지를 하나씩 뒤질 필요가 없습니다.
> 예: 한눈에 "Quiz 1은 3일 후, AT3는 2주 후"를 알 수 있습니다.

<p align="center"><img src="assets/preview/dashboard.svg" alt="Muster 대시보드: 모든 코스의 마감을 긴급도순으로 통합" width="840"></p>

### 🔔 스마트 알림
마감 전 시스템 알림 + 새 자료·새 공지·성적 공개 알림. 알림 시점(1/3/7일 전)을 직접 고를 수 있습니다.
> 예: 다른 일을 하다가 "Applied Task AT3 — 3일 후 마감" 알림이 도착합니다.

### 📄 과제 추적
마감일 정렬 + Moodle의 **실제 제출 상태**(제출됨/채점됨/미처리). 지난 학기 과제는 자동 보관되어 더 이상 방해하지 않습니다.
> 예: 진행률 바는 제출 상태를 추적할 수 있는 과제만 세기 때문에 숫자가 정직합니다.

<p align="center"><img src="assets/preview/assignments.svg" alt="Muster 과제 목록: Moodle의 실제 제출 상태 표시" width="840"></p>

### 🗂️ 공지 자동 분류
공지를 자동 판별(과제/퀴즈/시험/자료/성적)하고 코스별로 그룹핑, 읽지 않음 우선, 원탭 타입 필터.
> 예: "시험" 필터만 눌러도 모든 코스의 시험 관련 공지가 한 번에 나옵니다.

<p align="center"><img src="assets/preview/announcements.svg" alt="Muster 알림 센터: 공지 자동 분류 및 코스별 그룹핑" width="840"></p>

### 📥 다운로드 매니저
코스 자료(PDF/슬라이드/폴더)를 로컬에 일괄 다운로드. 진행률·속도 실시간 표시, 완료 후 폴더 자동 오픈.
> 예: 장거리 비행 전에 이번 주 강의 자료를 원클릭으로 다운로드.

<p align="center"><img src="assets/preview/downloads.svg" alt="Muster 다운로드 매니저: 진행률과 속도 실시간 표시" width="640"></p>

### 🤖 AI 코스 요약
주간 자료·과제·공지를 원클릭 요약 — **스트리밍 출력**(글자가 실시간으로 표시) + 완전한 Markdown 렌더링. 요약 언어는 UI 언어를 따라갑니다.
> 예: 코스를 열고 "생성"을 누르면 개요 → 자료 → 과제·퀴즈 → 다음 단계의 구조화된 요약이 나옵니다.

<p align="center"><img src="assets/preview/ai-summary.svg" alt="Muster AI 코스 요약: 스트리밍 출력과 완전한 Markdown 렌더링" width="760"></p>

### 🔒 프라이버시 우선
모든 데이터는 로컬 저장. 인증은 Monash Okta SSO를 직접 사용하며 평문 비밀번호를 저장하지 않습니다. 세션 쿠키는 OS 자격 증명 저장소로 보호.
> 예: 앱을 삭제해도 서버에 남는 내 데이터는 없습니다.


## 🚀 시작하기

> **지원 플랫폼**: Muster는 **Windows 10 / 11 (64-bit)** 및 **macOS 12+ (Apple Silicon & Intel)** 를 지원합니다.

1. [Releases](https://github.com/Poetrynan/Muster/releases) 페이지에서 내 운영체제에 맞는 설치 파일을 다운로드합니다:
   - **Windows**: `Muster_0.1.9_x64-setup.exe` (또는 `.msi`)
   - **macOS (Apple Silicon M1/M2/M3/M4)**: `Muster_0.1.9_aarch64.dmg`
   - **macOS (Intel)**: `Muster_0.1.9_x64.dmg`
2. 앱을 실행하고 Monash 계정으로 로그인합니다 (Okta SSO).
3. **Moodle 데이터 동기화** 를 클릭하면 과목, 과제, 자료, 공지사항을 자동으로 불러옵니다.

> 소스에서 빌드하려면: `npm install && npm run build && npx tauri build` 실행 (Rust 툴체인 필요).

## 🔐 데이터 및 프라이버시

- 모든 인증은 Monash Okta SSO를 통해 직접 수행됩니다. 앱은 평문 비밀번호를 저장하지 않습니다.
- 세션 쿠키는 OS 자격 증명 저장소에 보관되며 외부로 전송되지 않습니다.
- 코스 자료의 저작권은 각 권리자에게 있으며, 이 앱은 로컬 열람·정리만 제공합니다.
- 동기화는 의도적으로 낮은 빈도로 실행되며 요청 간격과 동시 실행 수에도 상한을 두었습니다. 따라서 항상 일반적인 사람의 사용 수준에 머무르며, 소속 기관 서버에 부담을 주지 않습니다.

## ⚠️ 면책 조항

Muster는 독립적인 개인 생산성 도구이며 Monash University나 Moodle의 공식 제품이 아닙니다. 양측과 제휴 관계가 없습니다. 본인 계정이 이미 권한을 가진 코스만 접근합니다. 소속 기관의 정보시스템 이용 정책과 자료의 저작권 준수는 사용자 본인의 책임입니다. 자세한 내용은 [TERMS.md](TERMS.md)를 참고하세요.

## 💬 피드백 및 지원

버그를 발견하셨나요? [Issues](https://github.com/Poetrynan/Muster/issues)에서 알려주세요.

## 📄 라이선스

이 프로젝트는 [PolyForm Noncommercial License 1.0.0](LICENSE)에 따라 제공됩니다. 개인 학습을 포함한 비상업적 용도로는 무료로 사용할 수 있으나, 상업적 사용은 허용되지 않습니다.

© 2026 Poetrynan · 상표 안내: [NOTICE](NOTICE) · 최종 사용자 약관: [TERMS.md](TERMS.md) · 제3자 라이선스 표시: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)

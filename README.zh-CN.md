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

> **For The Better Monash · works with Moodle™** — 帮你把自己的 Moodle 课业整理到一处的桌面助手。

<p align="center">
  <a href="https://github.com/Poetrynan/Muster/stargazers"><img src="https://img.shields.io/github/stars/Poetrynan/Muster?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Stars"></a>
  <a href="https://github.com/Poetrynan/Muster"><img src="https://img.shields.io/badge/GitHub-Repository-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Repository"></a>
  <a href="https://github.com/Poetrynan/Muster/releases"><img src="https://img.shields.io/badge/version-0.1.6-38bdf8?style=for-the-badge" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-PolyForm%20Noncommercial%201.0.0-38bdf8?style=for-the-badge" alt="License: PolyForm Noncommercial 1.0.0"></a>
</p>

> **为了更好的 Monash** — Muster 由一名 Monash 学生独立开发、完全免费，初衷很简单：让同学们通过 Moodle 的日常学习更高效、更轻松。课程、作业、截止日期、通知和资料全部集中在一个面板——少花时间翻找，多花时间真正学习。每位学生学得更高效，Monash 就会变得更好，这是我们一点一滴的坚持。
>
> Muster **并非** Monash University 或 Moodle 的官方产品，与两者无任何隶属关系。"Monash" 与 "Moodle" 商标归各自所有者所有，此处仅用于描述本软件的兼容对象。
>
> Muster 完全在本地运行，不收集、不上传任何 Moodle 登录凭据或课程数据，仅访问已登录用户本人有权访问的资源。
>
> 源代码依据 **PolyForm Noncommercial License 1.0.0** 公开——个人非商业用途完全免费。
>
> Muster 仅供个人非商业学习使用。若违反许可协议与使用条款（包括但不限于私自售卖本软件、违反所在院校政策），由此产生的一切法律责任由使用者自行承担，与原作者无关。

Muster 是一款面向学生的桌面应用，把散落在 Moodle 各处的课程、作业、截止日期、测验、公告与资料聚合到一个清爽的仪表盘里——从此不再错过任何截止。

## ✨ 核心亮点

### 📅 统一截止日历
把所有课程的作业、测验、考试截止时间汇总到一条时间线，按 **今天 / 未来 7 天 / 本月** 分组展示。再也不用挨个课程翻 Moodle 找截止日期。
> 举个例子：扫一眼就知道——Quiz 1 还有 3 天，AT3 还有 2 周。

<p align="center"><img src="assets/preview/dashboard.svg" alt="Muster 仪表盘：所有课程的截止时间按紧急度汇总" width="840"></p>

### 🔔 智能提醒
截止前系统通知；新资料同步、新公告发布、成绩发布都会提醒。提前几天提醒由你定（1 / 3 / 7 天）。
> 举个例子：你在忙别的事，通知弹出"Applied Task AT3 —— 3 天后截止"。

### 📄 作业追踪
作业按截止日期排序，显示 Moodle 的**真实提交状态**（已提交 / 已评分 / 待处理）。上学期的遗留自动归档到"历史课程"，不再用红色警示打扰你。
> 举个例子：进度条只统计真实可追踪的作业，数字是诚实的。

<p align="center"><img src="assets/preview/assignments.svg" alt="Muster 作业列表：来自 Moodle 的真实提交状态" width="840"></p>

### 🗂️ 公告智能分类
公告自动识别类型（作业 / 测验 / 考试 / 资料 / 成绩），按课程分组、未读优先，一键类型筛选。不再面对一堵平铺的消息墙。
> 举个例子：点一下"考试"，所有课程的通知里和考试相关的全出来了。

<p align="center"><img src="assets/preview/announcements.svg" alt="Muster 通知中心：公告自动分类并按课程分组" width="840"></p>

### 📥 下载管理器
课件（PDF / 幻灯片 / 文件夹）批量下载到本地，实时显示进度和速度，下载完自动打开文件夹。没网也能复习。
> 举个例子：坐长途飞机前，一键把本周课件全部下载。

<p align="center"><img src="assets/preview/downloads.svg" alt="Muster 下载管理器：实时进度与速度" width="640"></p>

### 🤖 AI 课程总结
一键总结本周资料、作业和公告——**流式输出**（文字实时逐段出现）+ 完整 Markdown 渲染。总结语言跟随你的界面语言。
> 举个例子：打开课程点"生成"，得到结构化总结：课程概览 → 资源要点 → 作业与测验 → 待办建议。

<p align="center"><img src="assets/preview/ai-summary.svg" alt="Muster AI 课程总结：流式输出并完整渲染 Markdown" width="760"></p>

### 🔒 隐私优先
所有数据只留在本机。认证直接走 Monash Okta SSO——从不存储明文密码，会话 Cookie 由操作系统凭据库保护。
> 举个例子：卸载应用后，没有任何你的数据残留在服务器上。


## 🚀 快速上手
 
> **支持平台**：Muster 支持 **Windows 10 / 11 (64位)** 与 **macOS 12+ (Apple Silicon M系列与 Intel 芯片)**。

1. 在 [Releases](https://github.com/Poetrynan/Muster/releases) 页面下载适合你系统的安装包：
   - **Windows**：`Muster_0.1.6_x64-setup.exe`（或 `.msi`）
   - **macOS (Apple Silicon M1/M2/M3/M4)**：`Muster_0.1.6_aarch64.dmg`
   - **macOS (Intel)**：`Muster_0.1.6_x64.dmg`
2. 打开客户端，点击登录并使用你的 Monash 学生账号完成认证（Okta SSO）。
3. 点击 **同步 Moodle 数据** —— 所有课程、作业、课件和通知将自动拉取到本地。

> 想从源码构建的开发者：查看项目结构后运行 `npm install && npm run build && npx tauri build`（需要 Rust 工具链）。

## 🔐 数据与隐私

- 所有认证直接走 Monash Okta SSO —— 应用从不存储你的明文 Moodle 密码。
- 会话 Cookie 保存在操作系统凭据库，绝不离开你的电脑。
- 课程资料版权归各权利人所有；本工具仅帮助你在本地浏览与整理。
- 同步刻意保持低频并做了请求限速（请求间隔与并发数受控），始终处于正常人工使用水平，不会对院校服务器造成压力。

## ⚠️ 免责声明

Muster 是独立开发的个人生产力工具，并非 Monash University 或 Moodle 官方出品，与两者无任何隶属关系。它只访问你本人账号已获授权的课程；你需自行遵守所在院校的信息系统使用规范，以及所下载材料的版权规定。完整终端用户条款见 [TERMS.md](TERMS.md)。

## 💬 反馈与支持

发现 Bug？有想法？欢迎在 [Issues](https://github.com/Poetrynan/Muster/issues) 提出 —— 每一条反馈都会影响下一个版本。

## 📄 许可证

本项目采用 [PolyForm Noncommercial License 1.0.0](LICENSE) —— 任何非商业用途（含个人学习）均免费，不允许商业使用。

© 2026 Poetrynan · 商标声明见 [NOTICE](NOTICE) · 终端用户条款见 [TERMS.md](TERMS.md) · 第三方依赖声明见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)

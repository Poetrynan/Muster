# Muster — 全生命周期开发进度与工程演进全景报告（v0.1.0 ~ v0.2.0）

> **项目名称**：Muster（前身 Monash Insight）  
> **核心定位**：专为 Monash 大学在读学生打造的高性能、隐私优先、本地离线就绪的 Moodle 智能学业助手桌面客户端  
> **当前版本**：`v0.2.0`（重大架构演进版本）  
> **技术架构**：Tauri 2 + Rust (`reqwest` Cookie Jar / `scraper` / `keyring` / `tokio`) + React 19 + TypeScript + Vite 7 + Tailwind CSS v4 + Zustand v5 (`idb-keyval` IndexedDB 持久化) + Monash Okta SSO 认证集成

---

## 1. 架构总览与模块矩阵

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Muster Desktop Client                         │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
         ┌───────────────────────────┴───────────────────────────┐
         ▼                                                       ▼
┌─────────────────────────────────┐             ┌─────────────────────────────────┐
│     Frontend (React 19 / TS)    │             │       Backend (Rust / Tauri 2)  │
├─────────────────────────────────┤             ├─────────────────────────────────┤
│ • Dashboard (7-Day Deadline)    │             │ • SSO Webview Cookie Extractor  │
│ • Assignments & Rubric Status   │   Tauri IPC │ • Throttled Request Engine      │
│ • Courses (Pill Term Filter)    │ ◄─────────► │ • Scraper (Selector Pipeline)   │
│ • Notification Center (Chips)   │             │ • Incremental Focus Week Logic  │
│ • Settings & Force Full Sync    │             │ • Fast Downloader (Redirects)   │
│ • Zustand + IndexedDB (Storage) │             │ • Minisign Auto-Updater         │
└─────────────────────────────────┘             └─────────────────────────────────┘
```

| 模块分层 | 技术选型 | 核心职责 | 当前健康状态 |
|---|---|---|---|
| **认证层 (Auth)** | `tauri-plugin-opener`, WebView2, CookieManager, Keyring | 弹出官方 Okta 登录窗口，无痕嗅探 MoodleSession，凭证安全存储于 OS 钥匙串 | ✅ 生产级稳定，无明文泄露 |
| **抓取层 (Scraper)** | Rust `reqwest`, `scraper`, HTML 解析器, 正则清洗 | 课程列表、各周课件、作业列表、Quiz 状态、公告通知多流并发解析 | ✅ 76 项自动化单元测试 100% 通过 |
| **增量同步 (Incremental)** | 焦点周推算、`Week N-1` 缓冲区、深层跳过 | 仅抓取当前及后续教学周，历史固定周永久本地缓存，网络往返减少 65%+ | ✅ v0.2.0 新增核心能力 |
| **存储层 (Storage)** | Zustand v5 + `idb-keyval` (IndexedDB) | 彻底替代 5MB 的 localStorage，支持数百兆本地缓存，异步非阻塞读写 | ✅ 消除 QuotaExceededError |
| **下载引擎 (Downloader)** | `reqwest` 流式下载、`Content-Disposition` 嗅探 | 支持 302 重定向解构真实文件名，按 `<Course>/Week N/file` 自动建目录 | ✅ 健壮性 100% |
| **交互层 (UI/UX)** | React 19, Tailwind v4, Lucide Icons, Framer Motion | 现代化暗色/浅色自适应界面、发光半透明倒计时卡片、多语种国际化 (中/英/日/韩) | ✅ 现代化高质感设计 |
| **发布系统 (CI/CD)** | GitHub Actions, Windows NSIS / MSI, macOS DMG | 跨平台自动化签名打包，`latest.json` 自动更新源分发 | ✅ Windows / macOS 双端全绿 |

---

## 2. 版本里程碑全景演进史

### 阶段一：原型验证与可用性奠基（v0.1.0 ~ v0.1.4）
- **v0.1.0**：完成最小可行性验证（MVP）。实现通过 WebView2 劫持 Monash Okta SSO 的会话 Cookie 并注入 Rust Reqwest Client；初版静态 SVG 资产与 GitHub 渲染对齐。
- **v0.1.1**：修复作业提交状态误判为“未提交”的解析漏洞；解决登录过程白屏闪烁问题；实现课程瞬时本地快照加载（Instant Load）。
- **v0.1.2 ~ v0.1.3**：解决 macOS runner CI 构建矩阵环境依赖；修复“关于”页面版本号与 GitHub API 版本检测显示冲突。
- **v0.1.4**：实现全自动启动更新检测 Banner；运行时版本号统一抽取；反馈系统引入结构化客户端运行诊断环境数据。

### 阶段二：核心功能深化与稳定性攻坚（v0.1.5 ~ v0.1.10）
- **v0.1.5**：Quiz 测试提交状态与分值上限解析重写；修复反馈表单中的 HTML 标签泄漏；修复重新登录后历史成绩丢失问题；支持按课程分文件夹下载。
- **v0.1.6**：在作业详情提交弹窗中传递正确的 `assessmentType`；引入 Monash 真实课程（如 MST course 46882）页面全量回归测试集。
- **v0.1.7**：优化 macOS Intel 架构发布通道；健全跨平台凭证存储异常处理指南。
- **v0.1.8**：正式上线基于 Minisign / ECDSA 验签的应用内自动静默更新器（Auto-Updater）；通用成绩解析引擎上线；历史结课学期自动折叠归档。
- **v0.1.9**：顶栏全局即时检索（Command/Ctrl + K）；批量下载实时速率与进度环；**IndexedDB 深度存储架构迁移**，彻底消灭 localStorage 5MB 配额雪崩崩溃。
- **v0.1.10**：课件真实文件 302 重定向下载，精准解析 `Content-Disposition` 标头提取原始文件名；课件按周（`Week N`）自动层级建目录归档。

### 阶段三：体验精细化与学术场景突破（v0.1.11 ~ v0.1.16）
- **v0.1.11**：作业截止日期相对时间标签（"due in 3 days"）正则剥离；更新器增加指数退避自动重试与显式错误交互；请求并发度与速率平滑调度。
- **v0.1.12**：紧急修复成绩列表中类似 "30/08/26" 的日期字符串被错误解析为分数的严重数值污染 Bug。
- **v0.1.13 ~ v0.1.14**：单文件下载路径透传 section 上下文；全应用共享宽容日期格式化管道 `parseMoodleDate`，统一月历与看板时间基准。
- **v0.1.15**：空同步结果熔断保护（Empty Sync Protection），网络异常或空响应绝不冲掉本地已有课件。
- **v0.1.16**：修复 7 天倒计时看板变量遮蔽问题；月历视图属性序列校正；按周建子目录架构全面成熟。

### 阶段四：课程全生命周期管理与服务治理（v0.1.17 ~ v0.1.20）
- **v0.1.17**：**学期智能分类与课程管理体系（Issue #10）**：
  - 正则解析 `S1/S2/FY/Summer/Winter`，自动划分为当前在读学期与历史学期。
  - 课程置顶（Pin）与隐藏忽略（Ignore）体系，隐藏课程从看板、待办、学分统计中全链路隔离。
  - 作业页发光半透明琥珀色倒计时卡片上线；100% 同步进度条悬挂 Bug 根除。
- **v0.1.18**：
  - **跨年份年中毕业大论文（Cross-Year Mid-Year Thesis `S2 YYYY - S1 (YYYY+1)`）** 穿透解析，保证 7 月入学硕士在第二年上半年依然能在当前学期看到在读大论文。
  - **反馈邮箱强制只读绑定**：从 SSO 会话自动提取并锁定学生邮箱，防止匿名乱填。
  - **课程元数据诊断快照**：反馈表单自动附带课程解析统计快照，消除开发者定位 Bug 的黑盒。
  - 重构下载设置选项的单行 Flex 垂直排版。
- **v0.1.19**：通知中心按课程代码胶囊过滤（Course Filter Chips）；反馈表单支持 `Ctrl+V` 截图直接粘贴、拖拽、Canvas 压缩与大图画廊预览；设置页侧边栏滚动隔离；修复启动自动同步依赖死循环。
- **v0.1.20**：**Moodle 域名全域更正**：彻底根除课程卡片跳转至旧域名 `lms.monash.edu` 导致跳转南非校区注册页面的重大历史隐患，全面收敛至 `learning.monash.edu`。

### 阶段五：v0.2.0 里程碑——智能增量同步与持久化缓存架构
- **动态滚动周窗口（Rolling Focus Window）**：后端解析当前教学周，设置 `Week N-1` 容错缓冲区，历史固定周跳过高昂的 HTML 节点比对与请求。
- **深层作业富化跳过**：已过去的固定周作业自动沿用缓存，不再向 Moodle 单独发起昂贵的提交状态与成绩查询，HTTP 往返请求降低 65%+。
- **Map 级无损增量合并（Zero-Loss Map Upsert）**：前端彻底废除全量数组粗暴替换，基于课程 ID 与资源 URL 构建双层 Map 合并，确保增量切片同步下历史数据永久完好。
- **双核同步交互设计**：启动与常规操作默认疾速增量同步，设置页保留高危鲜红的“强制全量同步”终极逃生门。
- **v0.2.1 极速补丁（Hotfix）**：
  - **当前活跃学期课程精准锁定（Target Course Scoping）**：彻底跳过本地已存有完整课件的 8~9 门历史结课课程，网络往返减少 160+ 次。
  - **修复 MST 焦点周提取器**：精准适配 `.mst-current-focus-nav-item-current` 容器与 `<h5>Week X</h5>` 标签，成功激活 `Week N-1` 滚动窗口机制。
  - **进度条真实收敛**：从 `(0/12)` 优化为 `(0/3) -> (1/3) -> (2/3) -> (3/3)`，耗时压减至 3~5 秒。
  - **产品冷启动与全量基线设计沉淀（Cold-start & Baseline Establishment）**：明确新用户初次建库（Day 1 全量完整性）与日常增量（Day 2+ 秒级刷新）的自适应状态机，并在架构与知识库文档中全面落地。
- **v0.2.2 截止日期计算与展示修复（Calendar Day Boundary Fix）**：
  - **根除日历天向上取整偏差**：彻底修复使用 `(item.ts - Date.now()) / 86400000` 配合 `Math.ceil` 导致当天截止事件被误判为“明天到期”的经典数学缺陷。
  - **统一自然日边界计算器（`getCalendarDayDiff`）**：将目标与基准时间均锚定至用户本地时区 00:00:00 自然日凌晨进行比较，精准识别“今天截止（diff=0）”、“明天（diff=1）”、“未来天数（diff=N）”与“已逾期”。
  - **作业分组与徽章全面修正**：修复作业页 `bucketOf`（当天到期作业正确进入【今天到期】大类）、作业卡片倒计时 Badge、侧边栏即将截止卡片及仪表盘日历时间轴分组。

---

## 3. 当前测试与构建验证状态

- **Rust 后端单元测试**：`71 passed; 0 failed; finished in 0.26s`
- **Rust 集成与会话验证测试**：`6 passed; 0 failed; finished in 1.87s`
- **前端 TypeScript 类型检查**：`tsc` 0 error
- **前端 Vite 生产级打包**：`✓ built in 1m 2s`，2252 模块无缝编译
- **跨平台构建矩阵**：Windows 64-bit / macOS aarch64 / macOS x64 验证就绪

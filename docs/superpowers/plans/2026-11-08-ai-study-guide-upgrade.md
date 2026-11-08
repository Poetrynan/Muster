# Muster AI 学习导读升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让学生选择课程和教学周后，直接获得可靠的事实、优先行动、复习计划与可定位来源，不要求从聊天提问开始。

**Architecture:** 同步快照经过范围选择和规则计算，生成有版本与预算的证据包；模型只解释和规划，输出验证后升级为卡片。正文、缓存和基础事实作为独立降级层。

**Tech Stack:** 现有 React 19、TypeScript、Zustand/IndexedDB、Tailwind、Tauri/Rust、reqwest、Vitest、浏览器布局测试；第一阶段不加入向量数据库，不引入额外代理框架。

**Spec:** ../specs/2026-11-08-ai-study-guide-research.md

## Global Constraints

- 这是调研后待执行的计划。本轮没有实现以下任务，不以已有测试通过代替新设计验收。
- 保留工作树内其他登录、反馈、弹窗、状态、URL 提示和用户自行修改；禁止 git reset/checkout 整文件来撤回聊天。
- 单课程/周次 + 结构化事实是首版边界。未读取 PDF 正文时不产出讲义知识点总结。
- 日期、分数、权重、已提交状态由程序提供；来源未知或规则不明时降级为未知/估计。
- 所有新增事实卡具备 sourceId，引用存在性验证与语义支持核验分别计量。
- 四语、浅深主题、三平台；核心事实不依赖 API key。
- 自有供应商 API 兼容，不能假设支持 strict JSON schema。禁止把 reasoning 当正文或把 Markdown 中的附录露给学生。
- 请求以 accountScope/courseId/weekId/inputHash 隔离。不得读取真实账号数据写进公开测试样本。
- 开发执行时再创建隔离工作区并带入必要未提交修改；本轮只做 read-only audit 和文档。

## Task 1: 0.4.2 稳定性与统一降级

**Files:**
- Modify: src/lib/aiStructured.ts; src/services/api.ts; src/pages/AIHubPage.tsx; src/lib/summaryFreshness.ts
- Modify: src-tauri/src/moodle/scraper.rs; src-tauri/src/lib.rs（如需取消命令）
- Test: src/lib/aiStructured.test.ts; src/services/aiContext.test.ts; src/lib/summaryFreshness.test.ts; Rust scraper tests

**Interfaces:**
- Introduce normalized generation state with status: idle/streaming/ready/text-only/partial/failed/stale.
- Store response正文、parsed payload、error、inputHash separately, never infer “empty tasks” from failed parsing.

- [ ] 写失败测试：坏 JSON 有正文、只有 JSON、空成功、只有 reasoning、附录边界拆块、流断开、429，验证已有成功结果不丢失。
- [ ] 写中文/emoji 在 12000-byte 附近的截断测试；前端 UTF-16、后端 UTF-8 边界不同，不能只断言长度。
- [ ] 修改公共解析/流式逻辑：正文与 reasoning 分离；附录始终隐藏；失败不能覆盖旧产物；监听终止时释放。
- [ ] 给摘要、计划、优先级统一接入状态与回退；为请求添加范围快照和旧请求防护，若做取消则传输也终止。
- [ ] 扩展输入哈希：grade/range/weight/categoryId、公告正文、所选周、时区与本地日期、语言、模型和 prompt/schema 版本。可排序集合规范化；有语义的顺序保留。
- [ ] 跑针对性测试，再核对上一轮状态/弹窗/API 提示修复未丢失。单独提交此任务，不带新聊天 UI。

**Acceptance:** 任何解析或网络异常都不变成“没有任务”；中文长上下文不崩溃；原始事实和上次成功结果始终可访问。

## Task 2: 课程、周次与来源快照

**Files:**
- Create: src/lib/studyGuide/types.ts; src/lib/studyGuide/sources.ts; src/lib/studyGuide/sources.test.ts
- Modify: src/services/aiContext.ts; src/services/api.ts（仅按需要添加来源字段）
- Reuse: src/lib/courseHelpers.ts; src/types/index.ts 中的课程/资料/日程类型

**Interfaces:**
- SourceRecord / FactRecord / GuideArtifact：以 spec 字段为基础，先小型显式 TS 类型，运行时校验外部响应。
- selectGuideSources(snapshot, scope) 返回 included、excluded、coverage、conflicts、inputHash。
- scope 必须包含账号、课程、selectedWeek、timezone、localDate；unknownWeek 是合法状态。

- [ ] 写黄金样本：同名课不同学期、跨周公告、未知周资源、休假周、Thesis 跨学期、过期公告和截止延期冲突。
- [ ] 实现确定性范围选择：课程严格隔离；周次来自教学日历或学生选择；公告按相关时间与任务关联，而非仅取前 N 条。
- [ ] 给公告/作业/日程/单元说明建立稳定来源 id、字段定位、可展示片段、内容指纹和同步时间。
- [ ] 显示 coverage（正文/仅标题/缺失）和冲突双方。没有来源时不能假造可跳转链接。
- [ ] 测试无权限、账号切换、资料删除和链接变化。测试用虚构数据。单独提交。

**Acceptance:** 同一快照同一选择结果；当前周资料真实被选择；每条基础事实可回到输入位置，未知周不被偷偷丢弃。

## Task 3: 事实计算与上下文编排

**Files:**
- Create: src/lib/studyGuide/facts.ts; src/lib/studyGuide/facts.test.ts
- Modify: src/services/aiContext.ts; src/services/aiContext.test.ts; src/lib/gradeBreakdown.ts（仅在必要时暴露可信程度）
- Reuse: src/lib/courseSearch.ts 的纯文本工具（仅必要部分），不复用开放式聊天检索作为主流程

**Interfaces:**
- buildGuideFacts(sources, scope) 返回确定事实、未知项、冲突和规则优先级。
- buildGuideContext(facts, sources, budget) 返回 prompt + includedSourceIds + omittedSourceIds + inputHash。

- [ ] 写日期/时区、72小时/7天边界、submitted 待评分、类别继承权重、总权重不完整、隐藏成绩与 hurdle 未知测试。
- [ ] 让程序给出可确认的剩余时间和分数；ambiguous grading rules 不生成确定的 pass/risk 结论。
- [ ] 编排结构：目的与范围、程序事实、近期变化、相关教学目标、必要来源、缺失说明、输出协议；按整条记录分配预算。
- [ ] 超限保留系统协议和关键事实，记录未发送资料；prompt guard 不能因前端 joinWithBudget 提前 return 而丢失。
- [ ] 复用相同 evidence package 支持行动卡与计划；记录长度/截断/范围，无私人原文或 key。单独提交。

**Acceptance:** 模型不必重算日期/分数；用户能看到用了哪些资料、漏了哪些；中文与英文预算规则明确。

## Task 4: 带依据的导读生成与存储

**Files:**
- Create: src/services/studyGuide.ts; src/lib/studyGuide/validate.ts; src/lib/studyGuide/validate.test.ts
- Modify: src/lib/aiStructured.ts; src-tauri/src/moodle/scraper.rs（guide 提示词）；src/types/index.ts; src/stores/useAppStore.ts
- Test: src/stores/useAppStore.test.ts; Rust system prompt contract tests

**Interfaces:**
- generateGuide(snapshot, callbacks, cancellation) 使用已有 generateSummaryStream 适配器。
- validateGuide(output, facts, sourceMap) 返回 acceptedCards、rejectedCards、warnings。
- artifactKey = accountScope/courseId/weekId/schemaVersion；content/inputHash 决定 stale，而不是覆盖另一个课程的结果。

- [ ] 写伪造 sourceId、存在但不支持该日期/数值的来源、模型改权重、跨课程引用、过期请求回写、未知 schema 的测试。
- [ ] 定义 guide 模式：任务标题、factIds/sourceIds、建议理由、可执行目标和估计时长；禁止模型输出任意执行指令。
- [ ] 已知关键字段和程序事实核对；超出依据的卡片拒绝/标记待核实。语义解释仍留人工抽查，不用第二模型分数冒充真实性。
- [ ] 流式阶段显示正文与稳定事实；完成后校验升级成卡；失败走 Task 1 的状态机。默认不自动多次重试扣费，429 尊重退避。
- [ ] 迁移旧 summaries/aiInsights 缓存：保留旧正文为 legacy，提示可更新；迁移幂等，登出/换账号不串数据。单独提交。

**Acceptance:** 来源能定位，关键数字不能被模型覆盖；失败不吞正文；旧缓存仍可读且不冒充新 schema 验证结果。

## Task 5: 0.5.0 导读 UI 与行动闭环

**Files:**
- Create: src/components/StudyGuidePanel.tsx; src/components/GuideCard.tsx; src/components/GuideSources.tsx（确有独立职责才拆分）
- Modify: src/pages/AIHubPage.tsx; src/pages/Dashboard.tsx; src/pages/CourseDetail.tsx; src/i18n/translations.ts
- Modify: src/lib/aiProgress.ts; src/lib/aiProgress.test.ts; src/stores/useAppStore.ts
- Selectively remove: CourseChat 接入和其专用 qaConversation 新代码；先检查被引用处，不删除其他功能共用 qaSources/courseSearch 工具。

**Interfaces:**
- StudyGuidePanel 接收 artifact、facts、coverage、onGenerate、onAdjustTime、onTaskToggle。
- stableTaskId 使用来源+任务类型+课程/周次；不是生成的整句标题。学生编辑内容与模型新建议分离保存。

- [ ] 先画出并确认范围为“课程/周次 → 概览 → 最多3项行动 → 计划 → 依据”，用无真实成绩的静态样例完成布局。
- [ ] 选择性撤回主聊天入口，保留之前的状态、弹窗和 URL 修复。无 key 页面仍显示基础事实和规则行动。
- [ ] 加来源预览和原文入口；每张卡明确“事实/建议/待确认”。相邻页期和最新同步时间可见，主要按钮为生成/更新导读。
- [ ] 计划只询问一个必要约束：本周可用小时，时长为估计；修改和重新生成保留已完成项、用户编辑和稳定 id。
- [ ] 加资料发生变化、陈旧缓存、空资料、离线、断流等状态；不能整屏红字。用户勾选任务不改变 Moodle 提交状态。
- [ ] 实际渲染验证 400/768/1280px、四语、浅深主题、键盘、缩放与长原文。通过后单独提交。

**Acceptance:** 不输入提示词也能找到近期行动并打开依据；课/周切换不串内容；无模型时基础流程仍可用。

## Task 6: 评测、试用与发布

**Files:**
- Create: tests/fixtures/study-guide/（虚构或明确脱敏样本）；scripts/evaluate-study-guide.mjs；docs/ai-study-guide-evaluation.md
- Modify when releasing: package.json; src-tauri/Cargo.toml; src-tauri/Cargo.lock（muster 条目）；src-tauri/tauri.conf.json; dist-aur/PKGBUILD; README*.md; RELEASE_NOTES.md

- [ ] 建立至少40个黄金场景与人工验收表，覆盖 spec 故障矩阵、三种供应商格式和假响应；固定样本/提示词版本。
- [ ] 离线回归先过，真实模型评测使用授权的小样本；记录输入覆盖、非法引用、数字偏差、文本回退率、首字/完成延迟、估算或实际费用，禁止写未经观测的“更快更准”。
- [ ] 邀请5–8名学生，比较现有版本与卡片版完成同一任务的时间、错误和来源查找情况；至少覆盖一轮课程周更新。不要把 EEF 学校研究外推成已验证大学提分效果。
- [ ] 对低频/无用行动调整策略，允许不推荐；完成率与准确率分开判断。门槛不达标则停在试用版，不强推新版本。
- [ ] 按稳定性0.4.2、导读0.5.0分别发布。三平台构建，检查 release draft 发布状态、下载附件、更新清单与从0.4.1升级缓存迁移。版本号和 tag 只在后续明确发布任务执行。
- [ ] Release note 简短、按已实现能力写；简历只在验收后升级表述。

**Acceptance:** 关键事实和数据隔离测试全过；故障时仍可读；新旧缓存可升级；发布草稿与正式发布明确区分。

## 后续可选项目：0.6.0 正文阅读

前置：0.5.x 证明用户需要“知识点/复习”而不仅是安排提醒。
按选定周/文件读取 PDF，先提取文本并保留页码；解析失败或扫描件直接显示覆盖不足，OCR 单独估算，不用文件名补全文。
先测有限正文直放上下文，再测规则选择或 FTS/BM25；只有持续语义漏召回且对照评测证明收益，才引入向量混合检索。不因“AI 功能”就默认搭向量库。
允许导出选中资料清单与上下文供外部工具使用，但不上传登录令牌或私密凭据。

## 执行顺序与检查命令

Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6。Task 2/3 的纯函数可先小样本并行，但数据契约须先锁定。

针对性检查：npx vitest run <changed tests>；npx tsc --noEmit。
发布前：npx vitest run；cargo test --manifest-path src-tauri/Cargo.toml --lib --offline --locked；npm run build；三平台构建及真实应用抽查。
测试未覆盖的模型语义、学习效果和供应商网络行为，必须列为剩余风险，不能用单测数量代替。

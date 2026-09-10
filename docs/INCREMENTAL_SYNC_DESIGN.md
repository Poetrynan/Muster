# Muster 智能增量同步与持久化缓存技术设计文档 (Incremental Sync & Permanent Cache Spec)

> **版本**：v1.0  
> **状态**：设计就绪 / 准备实施  
> **责任人**：AI PM & System Architect  
> **适用模块**：`src-tauri` (Rust Moodle Scraper & API), `src/stores` (Zustand & IndexedDB), `src/pages` (Dashboard & Settings)

---

## 1. 背景与现状痛点 (Background & Problems)

### 1.1 现状行为剖析
当前 Muster 的数据同步机制为**“全量无差别扫描 (Full Brute-force Sync)”**：
每次用户启动应用触发自动同步或点击“立即同步”时，系统无论处于学期第几周，都会对所有已选课程执行以下操作：
1. **周次课件无差别爬取**：
   - 抓取每门课程主页（5 门课 = 5 次请求）；
   - 解析出全部 Section 列表（每门课约 19 个 Section，涵盖 Getting started, Assessment, Week 1 ~ 12 等）；
   - **向所有 19 个 Section 子页面并发发起 HTTP 请求**（5 门课 × 19 = **95 次页面请求**）。
2. **作业与测试状态逐项补齐**：
   - 抓取评估板块（Section 56 = 5 次请求）；
   - 遍历解析到的每个作业/测验，逐个调用详情页（`mod/assign/view.php` / `mod/quiz/view.php`）抓取是否提交、批改评语与最终得分（约 **40 ~ 60 次请求**）。
3. **前端状态覆盖**：
   - 前端接收到全量数组后，在 `updateAllSyncedData` 中直接使用新数组替换原有状态（`const updatedResources = nonEmpty(data.resources, state.allResources)`）。

### 1.2 核心痛点与性能瓶颈
- **无效请求占比 >80%**：学期进入第 6 周后，Week 1 ~ 5 的讲义文件通常完全固定，Week 1 ~ 4 的测验早已截止且打分完毕。每次同步重复请求这些陈旧数据造成严重的算力与带宽浪费；
- **同步耗时较长**：受限于学校防爬限流策略（40ms 启动间隔 + 16 最大并发），150~200 个 HTTP 请求使得全量同步耗时通常在 **3.5 ~ 6.0 秒**；
- **用户体感割裂**：每次看到进度条漫长等待，容易产生“软件响应慢”的不良体感。

---

## 2. 业务需求与设计原则 (Requirements & Principles)

1. **历史内容永久固化 (Permanent Cache)**：
   - 已同步的前序周次课件、已完成且已评分的历史作业，本地 IndexedDB 永久保存，后续同步默认不再重复请求底层 HTML；
2. **当周与未来增量更新 (Delta / Incremental Fetch)**：
   - 自动识别当前激活周次（Current Focus Week），重点下钻当前周及临近周次（`Week N-1 ~ Week N+1`）的变动；
   - 仅对未截止（Pending）或已截止待批改（Awaiting Grade）的活跃作业刷新详情页状态；
3. **防漏机制与边缘回溯 (Safety & Retroactive Updates)**：
   - 若老师在历史周次中补发了课件或修正了作业，必须具备快速探测与按需补偿能力；
4. **强确定性兜底 (Full Refresh Fallback)**：
   - 无论增量如何智能，必须保留“强制全量刷新 (Force Full Sync)”入口，满足学生强迫症和极端异常下的重置诉求。

---

## 3. 系统架构与数据流设计 (Architecture & Data Flow)

### 3.1 总体架构

```
┌────────────────────────────────────────────────────────────────────────┐
│                          Frontend (React / Zustand)                    │
│                                                                        │
│   [本地 IndexedDB 缓存]                                                  │
│   • courseResources: { [courseId]: Resource[] }                        │
│   • assignments: Assignment[] (含 submitted, graded, grade 等字段)        │
│                                                                        │
│   发起同步: syncAll({                                                  │
│      fullRefresh: boolean,                                             │
│      cachedWeekNums: { [courseId]: number[] },                         │
│      completedAssignmentIds: number[]                                  │
│   })                                                                   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Tauri IPC Command (sync_all)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Backend (Rust / Tauri Core)                     │
│                                                                        │
│   MoodleScraper::fetch_all_data(progress, options)                     │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ 1. 课程主页探测 (course/view.php?id=CID)                        │   │
│   │    • 提取当前教学周 (current_focus_week, 如 Week 6)             │   │
│   │    • 提取全部 Section 导航列表                                  │   │
│   └───────────────────────────────┬────────────────────────────────┘   │
│                                   │                                    │
│        ┌──────────────────────────┴──────────────────────────┐         │
│        ▼                                                     ▼         │
│   【资源增量过滤】                                       【作业增量过滤】  │
│   • 属于历史周次 (week_num < current-1)                  • ID 位于       │
│     且前端声明已缓存: 跳过请求                           completedIds:   │
│   • 属于活跃周次 (week >= current-1)                     直接跳过详情页    │
│     或新增周次: 正常抓取                                  • 未结项作业:   │
│                                                          正常抓取详情页    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ 返回增量数据包 (Delta Payload)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                  Frontend Smart Merge (updateAllSyncedData)            │
│   • resources: 以 ID 为键执行 Upsert，历史周次保留，当周覆盖更新       │
│   • assignments: 以 ID 为键更新状态，未重抓的历史作业无缝留存           │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.2 冷启动基线建立 vs. 日常增量生命周期 (Cold-start Baseline Setup vs. Daily Incremental Sync)

系统通过自适应状态机在**“全量基线建立（首次）”**与**“智能增量守护（日常）”**间平滑流转：

| 生命周期阶段 | 触发判断条件 | 抓取范围策略 (Scoping) | 周次与板块策略 (Sections & Tabs) | 预期耗时与体感 |
| :--- | :--- | :--- | :--- | :--- |
| **Day 1：冷启动拓荒 (Baseline Setup)** | `state.courses.length === 0` (本地 IndexedDB 记录为 0) | `targetCourseIds = undefined`：全量抓取所有真实课程（如 12 门全学期课程） | `includeFixedTabs = true`：并发抓取大纲、日程、联系人；`cachedWeeks = {}`：全周次并发下载 | 25~35 秒，进度条清晰显示 `(0/12)...(12/12)`，彻底建立本地离线学业底座 |
| **Day 2+：日常增量守护 (Daily Delta Sync)** | `state.courses.length > 0` | `targetCourseIds = [activeIds]`：精准锁定当前学期 3~4 门在读课，历史结课 0 网络请求 | `includeFixedTabs = false`：固态板块 0 请求；仅抓取当前焦点周 ±1 周，历史周命中跳过 | **3~5 秒**，进度条清爽收敛为 `(0/3) -> (3/3)`，静默秒级刷新 |

---

## 4. 详细模块设计与实现规范 (Module Specifications)

### 4.1 协议层：扩展 `sync_all` 参数与数据结构
在 `src-tauri/src/lib.rs` 与 `src/services/api.ts` 中升级调用契约：

```rust
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOptions {
    /// 是否全量强制重新同步（忽略所有缓存，全量重爬）
    #[serde(default)]
    pub full_refresh: bool,
    /// 包含固定标签页（Unit Information / Schedule / Contacts）
    #[serde(default = "default_true")]
    pub include_fixed_tabs: bool,
    /// 前端已知且已缓存的周次编号映射: course_id -> [1, 2, 3, 4, 5]
    #[serde(default)]
    pub cached_weeks: HashMap<u64, Vec<u32>>,
    /// 前端已知已完结（已截止且已有最终成绩）的作业/测验 ID
    #[serde(default)]
    pub completed_assignment_ids: Vec<u64>,
    /// 增量目标抓取课程列表 (v0.2.1 新增：用于跳过历史学期结课课程)
    #[serde(default)]
    pub target_course_ids: Option<Vec<u64>>,
}
```

### 4.2 Rust 抓取层：增量调度逻辑

#### (1) 课件资源抓取 (`fetch_course_resources`)
1. 抓取 `course/view.php?id={course_id}`（主页 1 次请求无法省去，因为它是感知当前周次与导航的基石）；
2. 嗅探当前激活周次 `current_focus_week`（利用主页现有的 `.mst-current-focus-nav-item` 解析，例如第 6 周）；
3. 遍历 `sections`:
   - 若 `full_refresh == true`：保留原样，全部请求；
   - 若 `full_refresh == false`：
     - 从 section label 解析出 `week_num`（如 "Week 2 - Module 1" $\to$ 2）；
     - 若 `week_num` 存在且 `week_num < current_focus_week - 1`（历史周次），且该 `week_num` 已经存在于前端传来的 `cached_weeks[course_id]` 中，**则直接跳过该 Section 的 HTTP 请求！**
     - 对于当前活跃周（`current_focus_week - 1` 到 `current_focus_week + 1`）以及未识别出周次的关键公共板块（如 Assignment、Getting Started 等），正常发起请求刷新。

#### (2) 作业详情补全 (`enrich_assessment_statuses`)
1. 抓取评估主表（Section 56）；
2. 在进入 `enrich_assessment_statuses` 循环前进行过滤：
   - 若作业 ID 存在于 `completed_assignment_ids` 中（前端证实该作业在历史同步中已截止、已交且已出分）：
   - **直接跳过调用 `fetch_assignment_submission`**（跳过针对 `mod/assign/view.php` 或 `mod/quiz/view.php` 的网络请求）；
   - 保留从 Section 56 主表格解析出的基础数据，原有详细评分状态由前端本地合并保留。

### 4.3 前端存储层：智能 Upsert 合并 (`updateAllSyncedData`)
升级 [`useAppStore.ts`](file:///d:/Muster/src/stores/useAppStore.ts) 中的合并逻辑，彻底解决“数组全量替换导致旧周次丢失”的问题：

```ts
// 课件资源增量合并: 以 ID 为唯一键
const existingResourcesMap = new Map<number, Resource>(
  state.allResources.map((r) => [r.id, r])
);
if (data.resources && Array.isArray(data.resources)) {
  for (const r of data.resources) {
    existingResourcesMap.set(r.id, r);
  }
}
const updatedResources = Array.from(existingResourcesMap.values());

// 作业增量合并: 以 ID 为唯一键
const existingAssignmentsMap = new Map<number, Assignment>(
  state.assignments.map((a) => [a.id, a])
);
if (data.assignments && Array.isArray(data.assignments)) {
  for (const a of data.assignments) {
    const prev = existingAssignmentsMap.get(a.id);
    // 保留历史详情页已抓取到的评分/提交状态，如果本次增量跳过了详情页抓取
    if (prev && a.grade == null && prev.grade != null) {
      existingAssignmentsMap.set(a.id, { ...prev, ...a, grade: prev.grade, graded: prev.graded, submitted: prev.submitted });
    } else {
      existingAssignmentsMap.set(a.id, a);
    }
  }
}
const updatedAssignments = Array.from(existingAssignmentsMap.values());
```

### 4.4 交互层：增加“强制全量重新同步”入口
1. 在首页顶部同步状态栏及设置页面中，保留普通的“立即同步”（默认走极速增量）；
2. 在同步按钮旁或设置页面的高级同步选项中，增加 **“全量深度重新同步 (Full Sync)”** 选项，强制 `fullRefresh = true`，满足排查缺漏的确定性诉求。

---

## 5. 预期量化指标 (Target Metrics)

| 核心指标 | 当前基线 (Baseline) | 优化后目标 (Target) | 预期提升幅度 |
| :--- | :--- | :--- | :--- |
| **中后期单次同步 HTTP 请求总数** | 150 ~ 200 次 | **12 ~ 25 次** | **减少 85% ~ 92%** |
| **5 门课标准增量同步耗时** | 3.5 ~ 5.5 秒 | **0.4 ~ 0.8 秒** | **速度提升 5 ~ 8 倍** |
| **网络下载下行流量消耗** | ~2.5 MB HTML | **~200 KB HTML** | **带宽节省 90%+** |
| **学校 WAF 触发概率** | 偶发突刺风险 | 降至 0 (与常人浏览无异) | **合规安全系数极大提高** |

---

## 6. 实施与验证步骤 (Milestones)

1. **阶段 1：数据模型与协议升级**
   - 在 Rust `lib.rs` / `models.rs` 中定义 `SyncOptions`；
   - 在前端 `api.ts` 中升级 `syncAll(options)` 签名与调用。
2. **阶段 2：Rust Scraper 增量跳过引擎实现**
   - 升级 `fetch_course_resources`：加入活跃周次判断与历史周次跳过逻辑；
   - 升级 `enrich_assessment_statuses`：加入已归档作业跳过逻辑。
3. **阶段 3：前端 Store 增量合并与永久缓存**
   - 升级 `useAppStore.ts` 的 `updateAllSyncedData` 为 ID-level Upsert 合并；
   - 构造当前已缓存周次和已完结作业列表传递给后台。
4. **阶段 4：前端交互与全量刷新入口**
   - Dashboard 与 Settings 增加全量重刷入口；
   - 全流程编译构建、测试用例验证与端到端走查。

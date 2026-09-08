# Muster — 技术问答与工程实战全景知识库（Technical AI PM 学习手册）

> **面向读者**：技术型 AI 产品经理（Technical AI PM）与全栈工程团队  
> **核心宗旨**：架起产品决策、用户真实体验与底层工程代码之间的桥梁。每一个知识点均遵循：  
> **【用户真实场景与疑问】 ➔ 【通俗生动比喻（一秒秒懂）】 ➔ 【底层技术原理与核心代码】 ➔ 【PM 产品意识与决策沉淀】**。

---

## 目录
1. [存储篇：LocalStorage 5MB 崩溃危机与 IndexedDB 异步扩容](#1-存储篇localstorage-5mb-崩溃危机与-indexeddb-异步扩容)
2. [爬虫与下载篇：伪链接 302 重定向与 Content-Disposition 真实文件名](#2-爬虫与下载篇伪链接-302-重定向与-content-disposition-真实文件名)
3. [数据清洗篇：作业截止日相对标签剥离与成绩防日期污染](#3-数据清洗篇作业截止日相对标签剥离与成绩防日期污染)
4. [课程治理篇：学期分类体系、跨年份毕业大论文穿透与置顶隐藏](#4-课程治理篇学期分类体系跨年份毕业大论文穿透与置顶隐藏)
5. [交互体验篇：设置页侧边栏滚动隔离与下载 Flex 布局换行重构](#5-交互体验篇设置页侧边栏滚动隔离与下载-flex-布局换行重构)
6. [服务闭环篇：反馈邮箱强制只读绑定与课程元数据诊断快照](#6-服务闭环篇反馈邮箱强制只读绑定与课程元数据诊断快照)
7. [系统安全与集成篇：Moodle 域名全域收敛与南非校区注册页避坑](#7-系统安全与集成篇moodle-域名全域收敛与南非校区注册页避坑)
8. [架构里程碑篇（v0.2.0）：智能增量同步、双层 Map Upsert 与终极逃生门](#8-架构里程碑篇v020智能增量同步双层-map-upsert-与终极逃生门)

---

## 1. 存储篇：LocalStorage 5MB 崩溃危机与 IndexedDB 异步扩容

### 【用户真实场景与疑问】
> "为什么选课多的老用户在开学几周后，客户端会突然白屏崩溃，或者提示保存失败，甚至登录状态直接被清空？"

### 【通俗生动比喻】
> 浏览器的 `localStorage` 就像你随身背的**超小零钱包**，最多只能塞 5 块钱硬币（5MB 文本限制）。学期初课程少，零钱包够用；到了学期中，十几周的课件列表、各种富文本作业要求全塞进来，相当于有人硬要往零钱包里塞 20 块钱大钞。钱包被当场撑爆（`QuotaExceededError`），里面的东西撒了一地全部丢了。  
> 我们换成的 `IndexedDB` 就像在家里装了一台**无底大保险柜**，能存几百上千兆的数据，而且存取是让专职管家在后台悄悄搬运（异步非阻塞），你数钱的时候（主渲染线程）手一点都不会抖。

### 【底层技术原理与核心代码】
在 Zustand store 中，原有的 `persist` 默认使用浏览器的 `window.localStorage`。当 JSON 字符串超过 5MB 时触发同步异常中断。  
我们引入 `idb-keyval` 实现自定义异步 Storage 驱动：
```typescript
import { get, set, del } from 'idb-keyval';
import { StateStorage } from 'zustand/middleware';

const idbStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    return (await get(name)) ?? null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    await set(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    await del(name);
  },
};
```
- 存储配额从 5MB 跃升至数百 MB；
- 序列化与反序列化脱离 UI 主线程，消除了长文本解析导致的界面卡顿掉帧。

### 【PM 产品意识与决策沉淀】
- **容量评估必须乘以"学期倍数"**：不要只拿包含 1 门课 Demo 的账号做测试。大学生的真实数据会随着周次推进呈现**线性乃至指数级增长**。
- **存储方案要具备向前兼容与熔断兜底能力**。

---

## 2. 爬虫与下载篇：伪链接 302 重定向与 Content-Disposition 真实文件名

### 【用户真实场景与疑问】
> "为什么点击下载课件后，下载下来的文件名字都是 `view.php`，甚至 Windows 提示打不开未知文件？"

### 【通俗生动比喻】
> Moodle 页面上的课件链接就像**快递柜的提货取件码**（`view.php?id=123`），它本身不是包裹。如果你只是把取件码这张纸条下载下来存进电脑，当然打不开它。必须拿着取件码去快递柜刷一下，柜门弹开（HTTP 302 重定向），包裹上面贴着的快递单（HTTP Response Header `Content-Disposition`）才写着真正的大名："计算机视觉第四周课件.pdf"。

### 【底层技术原理与核心代码】
Rust `reqwest` 客户端下载流程改造：
```rust
let response = client.get(&resource_url)
    .send()
    .await?;

// 提取真正的文件名
let filename = if let Some(cd) = response.headers().get(reqwest::header::CONTENT_DISPOSITION) {
    parse_content_disposition(cd.to_str().unwrap_or_default())
} else {
    fallback_filename(&resource_url)
};
```
同时解析 RFC 5987 / 6266 标准支持 UTF-8 多语言字符编码（`filename*=UTF-8''...`），彻底避免乱码。

### 【PM 产品意识与决策沉淀】
- **永远以用户系统文件管理器的最终体感为准**：用户点击下载，预期的是在文件夹中看到整洁的名字，而不是底层的服务端脚本路由。

---

## 3. 数据清洗篇：作业截止日相对标签剥离与成绩防日期污染

### 【用户真实场景与疑问】
> "为什么截止日期一会儿显示 NaN，一会儿归类错误？为什么有些课程的成绩打分变成了 3.75 这种莫名其妙的数字？"

### 【通俗生动比喻】
- **截止日期**：老师在黑板上写"周五交（还有3天交）"，学生如果把括号里的"还有3天交"也当成日期输入日历软件，日历软件肯定报错。
- **成绩污染**：成绩表格里写着提交日期 `30/08/26`（2026年8月30日），结果系统的小机器人数钱太积极，看到斜杠就以为是除法：`30 ÷ 8 = 3.75` 分，把提交日期算成了期末大考得分！

### 【底层技术原理与核心代码】
1. **相对标签剥离器**：
```typescript
export function cleanDueDateString(raw: string): string {
  return raw
    .replace(/\(due in \d+ (days?|hours?|mins?)\)/gi, '')
    .replace(/\(closes in \d+ (days?|hours?)\)/gi, '')
    .trim();
}
```
2. **成绩日期候选排除器（Rust）**：
```rust
fn is_date_shaped(candidate: &str) -> bool {
    // 过滤形如 dd/mm/yy 或 yyyy-mm-dd 的日期文本
    let date_regex = Regex::new(r"^\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?$").unwrap();
    date_regex.is_match(candidate.trim())
}
```

### 【PM 产品意识与决策沉淀】
- **非结构化网页解析的三大定律**：
  1. 绝不盲目信任正则的全局匹配；
  2. 提取分值前必须先运行反模式（Anti-Pattern）黑名单；
  3. 异常数据宁可显示为空，也绝不显示荒谬的假数据。

---

## 4. 课程治理篇：学期分类体系、跨年份毕业大论文穿透与置顶隐藏

### 【用户真实场景与疑问】
> "我明明在读年中入学的毕业设计 FIT5120（学期是 S2 2025 - S1 2026），为什么 2026 年上半年打开 App，这门课在当前学期消失了？"

### 【通俗生动比喻】
> 跨年学制就像**一张两年的健身年卡**。原先的门禁系统偷懒，只看办卡的年份（2025），到了 2026 年初就误以为年卡过期直接锁在门外；但实际上这张卡横跨 2025 S2 到 2026 S1，在 2026 上半年依然是有效的在保状态。

### 【底层技术原理与核心代码】
升级正则表达式为支持跨年双学期模式：
```typescript
export function isCurrentSemester(courseName: string): boolean {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const currentTerm = currentMonth <= 6 ? 'S1' : 'S2';

  // 跨年份年中毕业设计大论文双学期判定
  const crossMatch = courseName.match(/(S[12]|FY)\s*(\d{4})\s*[-–—/]\s*(S[12]|FY)\s*(\d{4})/i);
  if (crossMatch) {
    const [, startTerm, startYearStr, endTerm, endYearStr] = crossMatch;
    const startYear = parseInt(startYearStr, 10);
    const endYear = parseInt(endYearStr, 10);
    // 只要当前时间在该跨年区间内，始终返回 true
    if (currentYear >= startYear && currentYear <= endYear) return true;
  }
  // 单学期标准匹配...
}
```

### 【PM 产品意识与决策沉淀】
- **核心业务场景往往潜藏在长尾特殊学制中**。毕业设计往往是学生大学生涯中最重要的学分，若因学期分类错误导致该课程被归入历史存档，会对用户造成极大的恐慌。

---

## 5. 交互体验篇：设置页侧边栏滚动隔离与下载 Flex 布局换行重构

### 【用户真实场景与疑问】
> "为什么滚动设置页面内容时，左侧侧边栏也跟着一起往上跑了？为什么下载设置的两个开关挤在一行文字被截断了？"

### 【通俗生动比喻】
- **侧边栏跟随滚动**：就像一艘双体帆船，左边船体是方向舵（侧边栏），右边船体是货舱（内容区）。如果两艘船体没有独立龙骨，货舱装货下沉时，把方向舵也拖进了水底。
- **Flex 挤压**：就像在小户型的狭窄玄关硬塞两个大衣柜，门碰门打不开，必须分上下两层独立摆放。

### 【底层技术原理与核心代码】
1. **Flex 滚动容器激活条件**：
   - 父容器必须拥有确定高度：`h-screen overflow-hidden`，严禁仅写 `min-h-screen`。
   - 子内容容器配置 `flex-1 overflow-y-auto [scrollbar-gutter:stable]`。
2. **下载选项单行垂直卡片重构**：
   - 将行内平铺改为垂直堆叠卡片：`flex flex-col gap-4`，每一项独占一行，保证不同窗口缩放下文字不重叠。

### 【PM 产品意识与决策沉淀】
- **设置页是产品工业级品质的试金石**。高质量的设计绝不容忍在不同屏幕分辨率或窗口尺寸下出现控件重叠或异常滚动。

---

## 6. 服务闭环篇：反馈邮箱强制只读绑定与课程元数据诊断快照

### 【用户真实场景与疑问】
> "用户报 Bug 说课只有 3 节没抓全，又不留联系方式，开发者既联系不上他，又不知道抓漏了哪一节，怎么排查？"

### 【通俗生动比喻】
> 就像医院挂号问诊，患者不能戴着面具 anonymous 扔下一句"我肚子疼"就跑掉，医生既联系不上他，也没有病历卡，完全无法诊断。必须推行"实名挂号"并自动附上"基础生理体检快照"。

### 【底层技术原理与核心代码】
1. **身份强制绑定**：从 SSO 会话自动提取登录邮箱，并标记为 `readOnly disabled`：
```tsx
<Input
  type="email"
  value={userEmail}
  readOnly
  disabled
  className="bg-muted text-muted-foreground cursor-not-allowed"
/>
```
2. **静默注入课程诊断快照（Diagnostic Snapshot）**：
```typescript
const diagnosticData = courses.map(c => ({
  id: c.id,
  code: c.courseCode,
  term: c.semester,
  resCount: c.resources.length,
  assignCount: c.assignments.length,
  sections: Array.from(new Set(c.resources.map(r => r.section))),
}));
```

### 【PM 产品意识与决策沉淀】
- **把技术诊断成本收敛在系统内部，而不是推给用户**。非技术用户无法描述 CSS 选择器变化，但系统自动生成的结构化快照让定位 Bug 的时间缩短了 90%。

---

## 7. 系统安全与集成篇：Moodle 域名全域收敛与南非校区注册页避坑

### 【用户真实场景与疑问】
> "点击课程卡片上的‘在浏览器中打开’，居然全部跳到了南非校区的注册页面？"

### 【通俗生动比喻】
> 就像你要打车去"某大学墨尔本校区"，但车载导航的预设快捷键里硬编码的是"某大学南非分校"的经纬度。你一上车油门一踩，直接把你送去了南非，还让你在南非校门口重新出示护照办通行证。

### 【底层技术原理与核心代码】
Monash 多年前已将澳洲全校 Moodle 迁移至统一域名 `learning.monash.edu`，旧子域名 `lms.monash.edu` 被用于外部或南非分校重定向。
全工程将硬编码统一纠正：
```typescript
// 修复前：https://lms.monash.edu/course/view.php?id=${id} （重定向死循环）
// 修复后：
export function openCourseInBrowser(courseId: string) {
  openUrl(`https://learning.monash.edu/course/view.php?id=${courseId}`);
}
```

### 【PM 产品意识与决策沉淀】
- **在第三方系统集成中，永远不要假设域名的永久不变性**。跨域跳转必须通过真实网络抓包确认当前受信任的权威根域。

---

## 8. 架构里程碑篇（v0.2.0）：智能增量同步、双层 Map Upsert 与终极逃生门

### 【用户真实场景与疑问】
> "为什么到了第 6 周，前 5 周的内容明明都固定了，每次点击同步还要重复把所有周次全抓一遍？检测到有新的抓新的、旧的永久保存，具体怎么做到？"

### 【通俗生动比喻】
1. **全量抓取 vs 增量抓取**：
   - **全量抓取（旧版）**：每天下班回家，把衣柜里的衣服全倒在地上重新洗、重新叠一遍。
   - **增量同步（新版）**：今天买了新衬衫（第 6 周），拿衣架挂进衣柜里，前几周的冬装原封不动挂在里面。
2. **全量替换 vs Map Upsert**：
   - **全量替换（`set({ courses: newCourses })`）**：去超市买了西红柿，回家后把手里原本记着米、面、油的常备购物单撕了，换成只有西红柿的纸条，米面油全丢了！
   - **Map Upsert**：拿出常备购物单，西红柿有新的就打个勾更新，新买的草莓加一行，米面油继续稳稳留着。
3. **滚动缓冲区（Week N-1）**：
   - 就像上课铃响后，**回头看一眼上周黑板有没有老师留的补充作业**。容纳老师上周末补发的讲义修订版。
4. **强制全量同步逃生门**：
   - 就像飞机自动驾驶舱里的**机械手动操纵杆**。极端气流下，飞行员可以一键夺回全量控制权。

### 【底层技术原理与核心代码】
1. **Rust 滚动周焦点计算与按需跳过**：
```rust
let focus_week = extract_current_focus_week_num(&sections);
// 仅检查 Week >= (focus_week - 1) 的活动
if week_num < focus_week.saturating_sub(1) {
    continue; // 跳过昂贵的网络详情请求，沿用已有缓存
}
```
2. **前端无损双层 Map 合并（Upsert）**：
```typescript
const courseMap = new Map(existingCourses.map(c => [c.id, c]));
for (const inc of incomingCourses) {
  const exist = courseMap.get(inc.id);
  if (!exist) {
    courseMap.set(inc.id, inc);
  } else {
    // 资源合并（以 URL 为 Key）
    const resMap = new Map(exist.resources.map(r => [r.url, r]));
    for (const r of inc.resources) resMap.set(r.url, r);

    // 作业合并（以 ID 为 Key）
    const assignMap = new Map(exist.assignments.map(a => [a.id, a]));
    for (const a of inc.assignments) assignMap.set(a.id, a);

    courseMap.set(inc.id, {
      ...exist,
      ...inc,
      resources: Array.from(resMap.values()),
      assignments: Array.from(assignMap.values()),
    });
  }
}
```

### 【PM 产品意识与决策沉淀】
- **增量抓取的关键是减少网络 I/O，而不是在本地对比**。
- **无损合并（Upsert）是增量体验的前提，而永久持久化（Permanent Storage）是无损合并的基石**。
- **成熟系统永远保留逃生门（Force Full Sync）**，兼顾日常秒级流畅与极端情况的一键恢复。

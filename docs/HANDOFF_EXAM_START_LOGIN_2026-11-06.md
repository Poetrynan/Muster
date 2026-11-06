# Handoff：考试数据解析错误导致统一登录失败

日期：2026-11-06（Asia/Singapore）  
项目：`D:/Muster`，Windows / PowerShell，Tauri 2 + Rust + React / TypeScript  
当前交接状态：**问题已定位到代码路径，尚未修复。用户要求本轮只分析并写交接文件，由其他 AI 实施。**

## 1. 接手目标与用户要求

用户安装前一轮提供的测试包后，在登录页看到红色提示：`Login Error / Missing exam start`，询问“什么意思？”，随后明确要求分析完写 handoff，由其他 AI 接手。

需要修复两个相关问题：

1. 查明当前真实门户数据为什么无法按 `event.start.time` 读取开始时间，并基于实证修复解析。
2. 考试数据异常不应被当成登录失败，不能因为某条考试记录不可解析就阻断已完成的身份认证。

保留用户已确定的产品行为：

- 考试来源为 `https://home.student.monash/`，不恢复已删除的旧 timetable 数据源。
- 使用一个统一登录窗口，尽量复用学校 SSO；不要进入首页后再弹另一个 Portal 登录窗口。
- 真正需要重新认证时返回应用登录页；同一账号重新认证保留学习进度。
- **考试自动检测，没有手动刷新按钮**。结果相同保留缓存；安排变化才更新。
- 当前检查触发为启动、回到应用、课程同步，以及应用运行期间每六小时；尝试间隔至少五分钟，失败按 5 / 10 / 15 分钟退避。
- 不绕过学校 MFA 或独立会话有效期；不要承诺永久无需重新认证。

## 2. 本轮证据与结论边界

### 用户实际截图

截图文件：`C:/Users/ZhuanZ1/AppData/Local/Temp/codex-clipboard-19a51313-8d89-4f77-8be7-2539267338ac.png`。

- 应用停在登录页，版本标为 `v0.3.2`。
- 顶部有会话需要更新、同账号保留学习进度的提示。
- 下方出现 `Login Error` 和原始后端文本 `Missing exam start`。
- **这条错误不是“密码错误”的证据。**它说明程序进入考试解析分支后，未能按当前要求提取开始时间。
- 截图不能证明当前全部认证流程已成功；按源码路径，此错误会在继续 Moodle 登录前终止流程。

### 已确认的直接原因

`D:/Muster/src-tauri/src/student_portal.rs:35`：

```rust
let start_ms = event["start"]["time"].as_i64().ok_or("Missing exam start")?;
```

条件是至少一条 `eventType == "exam"` 的记录，其 `start.time` 无法转换为 `serde_json::Value::as_i64()` 接受的整数表示。可能是字段缺失、null、类型不同等；**不能把这条错误直接解释为学校没安排考试，或时间一定不存在。**

当前 `parse_portal_exams` 对整个数组严格解析；一条记录出错，整个结果立即 `Err`，不返回其他可解析记录。

### 尚未获得的关键证据

**没有取得此次失败登录对应的真实响应或原生 snapshot 的脱敏结构。**本轮没有重新连接浏览器、操作学校登录、读取凭据或请求学校接口。因此具体字段差异仍待确认，不能声称已找到实际 schema 变更。

待验证的假设包括：缺时间的待发布记录、字符串/浮点数时间、其他时间结构、同一次页面加载先后返回不同完整度的数据，以及实际安装包是否为最新交付文件。以上均为假设。

### 之前确实见过的正常数据

`D:/Muster/.websculpt/explores/muster-portal-exams/trace.md:11` 和 `:13` 记录了此前在已登录 Chrome 上的验证：

```text
GET https://home.student.monash/api/student/userEvents?strict=false
HTTP 200, errorFlags.exams = 0
eventKind = standard, eventType = exam
start = { time: 1794787200000 }
end   = { time: 1794795000000 }
data.unitCode = FIT5201
data.activityType = eExamR (Final)
data.timezoneLocation = Kuala Lumpur
data.campus = MA
```

该记录对应 2026-11-16，马来西亚时间 08:00–10:10。它支持当前正常 fixture，但**不能代表此次失败时的所有事件或 Tauri 回调数据**。旧 trace 的浏览器验证不能替代新安装包端到端验收。

## 3. 已确认的错误传播链

| 文件与位置 | 当前行为与影响 |
| --- | --- |
| `D:/Muster/src-tauri/src/student_portal_capture.js:14` | 截获 `userEvents`，只保留考试事件、考试错误标志、状态及可选 ETag；没有做时间转换。 |
| `D:/Muster/src-tauri/src/student_portal_capture.js:11` | 一旦保存了首个 HTTP 200 结果，后续响应不会覆盖。若首个 200 数据不完整、后面才完整，当前实现可能一直使用首个；目前只是待验证风险。 |
| `D:/Muster/src-tauri/src/student_portal_snapshot.js` | 原生 eval 回调读取上述结果及最少量 Firebase 会话字段；凭据不得写进日志或交接资料。 |
| `D:/Muster/src-tauri/src/student_portal.rs:35` | `start.time.as_i64()` 失败，返回 `Missing exam start`。 |
| `D:/Muster/src-tauri/src/student_portal.rs:105` | `begin_sso` 构造 `PortalCapture` 时直接 `parse_portal_exams(result)?`，考试解析错误变成统一登录函数错误。 |
| `D:/Muster/src-tauri/src/lib.rs:629` | 调用 `begin_sso`，遇错关闭登录窗口并直接返回。 |
| `D:/Muster/src-tauri/src/lib.rs:633` | 只有上述调用成功才在同一窗口继续导航到 Moodle。因此这个错误会阻止 Moodle 登录阶段开始。 |
| `D:/Muster/src/pages/LoginPage.tsx:100` | 仅对包含 `PORTAL_` 的错误做统一提示，其余原始文本直接显示在 Login Error 内，形成截图现象。 |

最明确的架构问题是：**目前把考试数据完整可解析作为继续身份认证的前置条件。**仅翻译错误文案不能解决这个问题。

## 4. 建议修复顺序（尚未实施）

### A. 先补充可安全核对的结构证据

1. 先确认运行程序和新包版本。多个测试包都叫 0.3.2，单凭页脚无法区分；查看进程可执行文件路径及安装时间，不要只看版本号。
2. 在用户授权的应用会话中复现，针对**考试事件**记录结构摘要：事件数量、序号、eventKind、是否有 start/end、对应 JSON 类型、字段名、时间类型分布。必要时比较原始 API 结构与原生 eval 回调接收结构。
3. 优先记录类型与字段名；只有需要验证具体时间转换时，才保留最小脱敏时间样例。不要导出完整响应、Firebase 用户记录、Cookie、Bearer token、refresh token、学生邮箱或学号。
4. 如果看到多次响应，比较首个 200 和后续结果的完整度，检查 capture 的“首个 200 固定”逻辑。
5. 如需联网或浏览器探索，遵循项目环境中适用的浏览器/探索技能，先阅读对应 SKILL；本轮未重新进行该步骤。

### B. 认证状态与考试数据状态分离

建议在认证已得到可信验证后，把考试解析结果作为独立的成功或错误结果继续传递，而不是 `?` 中断登录。

已有可复用的通道：`AppState.pending_exam_result` 类型是 `(String, Result<Option<Vec<ExamSchedule>>, String>)`，已能携带考试错误；后台 `fetch_exams` 会消费它。

一种可行方向（仅供实现者评估，不是已落地补丁）：

- `PortalCapture` 独立保存已验证的会话和 `Result<Vec<ExamSchedule>, ...>`。
- 在可信门户身份验证成立时继续同一窗口的 Moodle SSO。
- Moodle 成功、账号绑定验证成功后保存会话，再把考试解析错误写入 `pending_exam_result`。
- 进入首页，考试区显示可理解的暂不可用/自动重试状态；已有可信缓存继续显示。
- 真正 401、账号不匹配、凭据不可用等仍走相应认证处理，不能为了放行登录而无条件吞掉所有错误。
- 首次无考试缓存时不能伪装成“没有考试”；不得把解析失败转换为成功空数组。

注意：若考试解析失败，不能给这份失败数据接受新 ETag。`begin_sso` 当前在解析前先给 session 赋 ETag；重构时要同时处理这一点。

### C. 基于实证修复解析和数据质量处理

- 当前已知正常 schema 为整数毫秒。只有拿到实际差异后，才增加经验证的其他格式支持。
- 不要猜秒/毫秒、不填当前时间、不硬编码 FIT5201 的日期时间、不通过原样 `as_f64` 后强转来掩盖所有异常。
- 如果门户确有“时间待公布”的记录，应显式建模该状态，避免一条记录阻断整批；具体采用待公布项还是部分结果加警告，需要保证旧的完整缓存不会被不完整结果覆盖。
- 不建议简单 `filter_map(...ok())` 丢弃所有坏记录；这会把“解析失败”伪装为“考试减少/没有考试”。
- 保留时区、开始/结束 UTC 时刻、地点/座位/说明等已有信息。

### D. 错误分类与文案

- 区分身份认证失败、网络失败、数据暂不可用、schema 不兼容。
- 用户可见提示避免直接出现 `Missing exam start` 等实现文本；诊断信息通过脱敏结构错误保留。
- 首页数据错误不能再次弹登录窗口，也不能误触发 `requireReauthentication`。

## 5. 不要回退的已完成改动

- 统一 Portal → Moodle 同窗口流程、后台不弹额外登录窗口。
- OS keyring 按账号保存刷新凭据，不存密码或 access token；不使用旧的无账号绑定明文凭据文件。
- 同账号重新认证保留学习计划和勾选，换账号隔离缓存；无法确认归属的旧缓存一次清理。
- 自动考试检查、五分钟尝试节流、5/10/15 分钟退避。
- 相同安排保持原缓存对象，只有实际变化才更新。
- 仅服务器确实提供 ETag 时使用条件请求；没有 ETag 时读取响应并比较内容。“检测变化”仍可能需要网络请求。
- `student_portal_session.rs:139` 在接受新的 ETag 前校验考试数据；刷新凭据轮换独立保存，失败不抹掉凭据。进程重启首次不信任持久化 ETag，避免缓存未写入时崩溃造成错误 304。
- 前面已经做过的 AI 学习进度持久化、完成任务保留、引用来源编号映射和可点击来源修改，也在同一工作区，勿覆盖。

## 6. 工作区与关键文件

Git HEAD：`c255e9652ea15567d1bc39f67dd097f145a39f6c`。

目前有大量未提交修改及未跟踪新文件。**仅看 `git diff` 会漏掉新门户模块和测试。不要 reset / clean 或覆盖整个工作区。**本轮只新增此 handoff，没有修改业务代码或新增测试，也没有重新打包。

重点阅读：

- `D:/Muster/src-tauri/src/student_portal.rs`
- `D:/Muster/src-tauri/src/student_portal_capture.js`
- `D:/Muster/src-tauri/src/student_portal_snapshot.js`
- `D:/Muster/src-tauri/src/student_portal_session.rs`
- `D:/Muster/src-tauri/src/student_portal_tests.rs`
- `D:/Muster/src-tauri/src/lib.rs`
- `D:/Muster/src/pages/LoginPage.tsx`
- `D:/Muster/src/services/examSchedule.ts`
- `D:/Muster/src/services/examSchedule.test.ts`
- `D:/Muster/src/services/portalCapture.test.js`
- `D:/Muster/src/services/portalSessionCapture.test.js`
- `D:/Muster/src/stores/useAppStore.ts`
- `D:/Muster/src/pages/Dashboard.tsx`
- `D:/Muster/src/i18n/translations.ts`
- `D:/Muster/.websculpt/explores/muster-portal-exams/trace.md`

## 7. 测试现状与必须补充的验收

本轮新执行的现有测试（2026-11-06，未新增源码测试）：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml student_portal_tests --lib --offline
# 8 passed，1 ignored（Windows keyring 专项），75 filtered out

npm test -- --no-isolate --maxWorkers=1 src/services/portalCapture.test.js src/services/portalSessionCapture.test.js src/services/examSchedule.test.ts
# 3 files，12 passed
```

这些测试仍通过，**说明现有测试未覆盖这次真实登录失败，不代表问题已解决**。当前正常 fixture 只有一种整数毫秒格式；原生 WebView 登录与“考试解析异常仍可完成认证”的链路没有覆盖。

前一轮打包前全量结果为前端 84 项通过、Rust 83 项通过 / 1 项忽略。Windows keyring 假凭据专项曾单独通过；本轮没有重复执行该专项。

建议新增并验收：

1. 把本次真实失败记录脱敏后作为回归 fixture，先复现，再修复；不要把猜测格式写成“已观察格式”。
2. 正常考试与缺时间/待公布记录混合，不阻断认证，不静默清空已有完整缓存。
3. 可信身份认证成功、考试 schema 失败时，仍完成 Moodle 登录并进入首页；考试区显示数据错误。
4. 401、账号不匹配等真正认证问题仍正确拦截，后台数据错误不强制退出。
5. 首个 200 不完整、后续 200 完整时的捕获策略（若实证支持该情形）。
6. 失败数据不能推进 ETag，旧缓存不被错误 304 标为最新；刷新凭据轮换继续可靠保存。
7. 相同安排不替换缓存，时间/地点变化会更新；重复 focus、课程同步仍受五分钟限制。
8. 同账号进度保留、不同账号缓存隔离；退出后的迟到响应不得写回。
9. **实际 Windows 新包端到端**：统一登录成功、考试显示或清楚的非登录错误、重启恢复、自动检查、不弹第二个登录窗口。应明确记录真实验证结果，不能只用 fixture 通过代替。

普通 Vitest 在本机 Windows 沙箱曾有临时模块文件 ENOENT，已用 `--no-isolate --maxWorkers=1` 稳定运行。Rust 本地模拟 HTTP 测试在受限沙箱可能遇 EACCES，需要按环境授权运行；不要误判为业务回归。

## 8. 现有安装包与后续打包提示

最近交付的包（**包含本次尚未修复的问题，不要再次作为修复包交付**）：

`D:/Muster/dist-local/Muster_0.3.2_unified-login-auto-exams_20261106_x64-setup.exe`

SHA256：`7EB35067D26E0A7786D4A41E941C3D2EABF7AFF3CC5F32636BD7E8C839D35791`。

此前还有 `portal-fix`、`sso-session-fix` 测试包，版本号同为 0.3.2，勿混用。修复后取独立新文件名，并核对生成时间与复制前后校验值。

之前成功的本地测试包构建方式：

```powershell
# 从 D:/Muster 运行，使用现有本地测试配置；无需修改正式签名/更新器配置。
$env:TEMP = 'D:/Muster/src-tauri/target/local-build-temp'
$env:TMP = $env:TEMP
npm run tauri -- build --bundles nsis --config D:/Muster/.websculpt/local-preview-tauri.json --no-sign -- --offline
```

该临时配置覆盖 `beforeBuildCommand` 为 `npm run build`，并关闭本地包 updater artifacts。发布版编译上次约六分钟，之后生成 NSIS 包。普通沙箱曾有临时文件权限错误，成功构建使用了批准后的执行权限及上述工作区临时目录。

建议交付时提示用户从托盘退出旧版及其旧 SSO 窗口后再安装。不要在没有真实新包登录验证时声称已完整解决学校 SSO。

## 9. 修复进展（2026-11-06，后续接手）

已实施（源码 + 测试，**未重新打包，未做真实 Windows 端到端**）：

- `student_portal.rs`：`PortalCapture.exams` 改为 `Result<Vec<ExamSchedule>, String>`；新增 `capture_from_result`。可信门户会话 + 账号校验通过后，考试解析失败不再中断 `begin_sso`，同窗口继续 Moodle 登录。解析失败时 session 不带 ETag。
- `lib.rs`：登录成功后把考试结果（含错误）写入 `pending_exam_result`，首页考试区显示错误，不触发重新认证；已有缓存保留。
- 解析错误统一为 `PORTAL_EXAM_SCHEMA: exam i/n (eventKind=…): 问题; start=…, end=…`（只含 JSON 类型与字段名，不含值）及 `PORTAL_EXAM_UNAVAILABLE`。下次复现时 stderr（`Portal exam data unusable at sign-in: …`）和前端 `examError` 即为第 A 节所需的脱敏结构证据。
- 前端：`examErrorKey` 将 `PORTAL_EXAM_*` 映射到新的 `dashboard.examsDataUnavailable`（四种语言）。
- 仍为严格整批解析：**未**猜测新时间格式，也未丢弃坏记录。拿到真实结构后再按 C 节扩展。
- 测试：Rust 全量 85 通过 / 1 忽略；Vitest 16 文件 85 通过；`tsc` 通过。
- 新测试包：`D:/Muster/dist-local/Muster_0.3.2_exam-data-decoupled_20261106_x64-setup.exe`，SHA256 `3CFBFC06B8AAB18B7BBFB9223B237AAD8A7906651FB63A84A0FBDA7E6A3062A4`（复制前后一致，生成于 2026-11-06 14:56）。尚待用户真实登录验收。
- 用户实测上述包：登录仍失败（统一提示）。根因：门户 Firebase `email` 是生成的别名（`…+<uuid>@monash.edu`），不是学生邮箱；`save_guarded` 按邮箱比对 Moodle 账号必然 `PORTAL_ACCOUNT_MISMATCH`（此前被考试解析错误提前掩盖）。
- 修复：`PortalSession.owner` 记录同窗口登录的 Moodle 账号（`bind_owner`，拒绝 `student@monash.edu` 占位身份），`validate_account` 优先比对 owner；uid 仍在每次刷新校验。新增 `%LOCALAPPDATA%/com.poetrynan.muster/logs/portal-diagnostics.log`（仅错误码与脱敏结构）；登录页错误追加 `PORTAL_*` 代码。
- 新测试包：`D:/Muster/dist-local/Muster_0.3.2_portal-account-binding_20261106_x64-setup.exe`，SHA256 `261708A47B76C203B85C230390AB4C1779A35877EB309B811AB3DC243EA649C7`（2026-11-06 15:13）。Rust 86 通过 / 1 忽略，Vitest 85 通过。尚待真实登录验收。
- 用户实测上述包：**登录成功进入首页**；考试区显示数据不可读。诊断日志实证：`start=object{time:float}, end=object{time:float}`（原生 WebView2 eval 回调把整数毫秒重序列化为浮点）。修复：`epoch_millis` 仅接受精确整数值且在安全整数范围内的浮点，小数/越界仍报错。
- 用户反馈登录窗口可见、门户与 Moodle 页面依次显示。修复：登录窗口 `.visible(false)` 创建，`reveal_when_interactive` 仅在连续两次检测到登录表单/Okta MFA 时显示，15 秒兜底显示；`student_portal_snapshot.js` 去掉宽泛的 `button[type=submit]`，排除 `learning.monash.edu`。
- 新测试包：`D:/Muster/dist-local/Muster_0.3.2_exam-times-silent-sso_20261106_x64-setup.exe`，SHA256 `6AB8259D4AAB0D4EA2CAAD896FE9F5B75B17FDE58DCA5D4ADFB6D2F20F7BD6AD`（2026-11-06 15:25）。Rust 87 通过 / 1 忽略，Vitest 85 通过。尚待真实登录验收（考试显示、需 MFA 时窗口是否及时出现）。

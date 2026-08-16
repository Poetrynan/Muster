# 🐛 Muster v0.1.1 — Bug-Fix Release

> Muster is a modern, high-performance desktop companion for Monash Moodle.
> This release fixes submission-status bugs, the login-page flash, deadline
> timezone offsets, invisible sync progress and the download experience —
> and makes every course tab load instantly after login.

---

## 🐛 Bug Fixes

### 1. Submitted assignments showed "To be submitted" ❌→✅
The assignment list always displayed "pending" even after you submitted your
work — e.g. a quiz finished and submitted at 9:51 PM still showed
"To be submitted". Muster now reads the **real submission state** from each
assignment/quiz detail page and the course gradebook:

| State | Meaning |
|---|---|
| **Submitted** | You have a finished attempt / submitted-for-grading entry |
| **Graded** | A real grade exists in the gradebook (shown with the score) |
| **To be submitted** | No attempt / no submission yet |

### 2. Ungraded assignments were wrongly marked "Graded"
A hidden action-menu label inside Moodle's grade table ("Actions / Grade
analysis") was being parsed as a grade, so ungraded items could appear as
"Graded". The parser now reads only the actual grade cell.

### 3. Assignment grades were not parsed from detail pages
Moodle's non-breaking spaces (`&nbsp;`) and markup broke the old grade
regex; a grade like `0.50 / 1.00` was never recovered. Fixed.

### 4. Course-detail "Download" button did nothing
The old button tried to open a new browser window (`window.open`), which the
Tauri shell silently blocks. It now downloads through the app's own download
manager (progress bar, speed, "open folder") — identical to the dashboard
resource rows.

### 5. No hover tooltip on the Sync / Download buttons
While syncing or cooling down (60 s), the buttons became `disabled`, and the
browser's native tooltip never shows on disabled buttons. The tooltip now
always appears ("Sync with Moodle" / "Data is up to date…"). The same fix now
covers the resources-page sync button and the resource-row download buttons
(showing "Downloading…" while active).

### 6. Dashboard assignment stats missed quizzes
The dashboard and assignments page pulled data from a Moodle index page that
lists only regular assignments — quizzes (e.g. FIT5201) were missing from the
counts. All views now share one data source that includes quizzes, weights
and categories.

### 7. Login page flashed on every launch for signed-in users ❌→✅
Even with a saved session, the landing page appeared for a moment before the
app switched to the dashboard — the UI rendered the login page first and then
restored the session in the background. The app now waits for the session
check before painting anything, so returning users go straight to the
dashboard with no flash.

### 8. Course tabs only fetched after you clicked them ❌→✅
Previously, the Unit Overview / Unit Info / Schedule / Recordings / Contacts
tabs each started scraping only when you opened that tab, so every tab switch
waited on the network. Now the app fetches **all tabs for all courses right
after login** (or launch): the full sync grabs resources, assignments,
announcements, the unit dashboard, and recordings on every login, and tab
switches render instantly from the in-memory data. Skeletons now only appear
while data is genuinely still loading — not on every tab switch.

### 9. Fetch strategy tuned to how Moodle actually behaves
Based on the real page structure:
- **Dynamic content** (assignments that unlock over the term, announcements,
  week-by-week materials, recordings, and the dashboard's rolling "current
  week") is fetched **live on every login**.
- **Semester-fixed content** (Unit Info handbook, the term schedule, and
  course contacts) is fetched **once and cached** — regular logins skip it,
  saving roughly three page requests per course.

### 10. Deadlines were shifted by 10–11 hours (timezone bug) ❌→✅
Moodle renders deadlines in the course timezone (Australia/Melbourne — AEST in
winter, AEDT in summer), but the parser treated them as UTC. Every deadline was
therefore pushed 10–11 hours into the future, so a deadline on "16 August" was
labelled "tomorrow" when today was already the 16th. The parser now interprets
the wall-clock text in the Melbourne timezone (daylight-saving aware) and stores
a correct UTC instant — the date badge and the relative label finally agree.

### 11. Sync ran with no progress visible anywhere ❌→✅
The progress banner (with the live progress ring) only appeared on the very
first login. On later launches the automatic sync and every manual "sync" click
ran silently — no banner, no percentage. The banner now shows whenever a sync
is running: first run, every launch, and manual syncs.

### 12. Downloads showed a bare spinner, no percentage ❌→✅
Download buttons (course materials, dashboard resources) now show a **circular
progress ring with a live percentage** instead of a spinner with no number,
updating in real time.

### 13. No download manager on the course detail page ❌→✅
The download button (top-right, with an active-download count badge) and its
dropdown panel — identical to the Dashboard — now exist on the course detail
page too, so you never have to go back to the home page to check a download.
Download completion shows the app's stylized toast everywhere (home + course
detail).

### 14. "Open folder" button did nothing ❌→✅
The download panel's "open folder" button called `openPath`, which was blocked
by the app's permission policy. The permission is now fully configured —
including the path scope that Tauri requires (`allow: [{ "path": "/**" }]`,
per tauri-apps/tauri#13971). As a safety net, if opening the folder ever fails
the button falls back to "reveal in folder" (selects the file), whose
permission has always been granted — so the folder always opens.

### 15. Old deadlines survived a logout / re-login ❌→✅
After logging out (or an expired session), the dashboard's "Due in the next 7
days" list could still show deadlines from the previous account, and the grade
section kept an old "x / y" count — while the course list was already empty.
The stored calendar events and grade overview are now cleared on logout, and
the deadline timeline only shows events of courses you actually have, so stale
data can never appear again.

### 16. Duplicated counts in the notification center ❌→✅
Each course group showed the unread badge *and* a second muted total next to it
— when every notification was unread the same number appeared twice in a row.
The redundant total is removed; the unread badge is kept.

### 17. Landing page: unofficial branding + missing ja/ko localization ❌→✅
The login page's brand subtitle now reads "Unofficial Monash Course
Intelligence System" (it is not a Monash product, and the copy now says so).
The landing page previously only had Chinese/English copy and fell back to
English for Japanese/Korean — every string (hero, feature cards, security
notes, sign-in button, footer) is now fully localized in all four interface
languages.

### 18. Reopening the app re-scraped everything within minutes ❌→✅
Closing and reopening Muster always triggered a full re-scrape, which was
annoying when you just wanted a quick look. The launch auto-sync now has a
**1-hour cooldown**: reopen within an hour of the last sync (auto or manual)
and the app renders your local data instantly with no network scraping at all;
after an hour it syncs normally, and the manual sync buttons always work.

---

## ✨ Improvements

### Same data everywhere
Dashboard stats, the assignments page and course-detail tabs now agree with
each other (same quizzes, same statuses, same weights).

### Download manager with progress
Every file download (dashboard resources + course materials) now runs through
a shared download manager that reports **real-time progress** (percentage,
speed) and shows a completion toast. The download button itself displays the
live percentage while in progress.

### Smarter tooltips on disabled buttons
Sync / Download buttons no longer use `disabled` (which swallows native
tooltips) — they switch to `aria-disabled` so the tooltip always shows.

### AI summary timestamp removed
The "Generated at …" line under AI summaries was removed — regenerated
summaries now simply replace the old content without a potentially stale
timestamp.

---

## 🔧 How to get the latest status

1. Open the app and go to the assignments page.
2. After you submit something in Moodle, go back to the **dashboard** and
   click **"Sync with Moodle"** (rate-limited to once per 60 s).
3. Open the assignments page again — statuses are now up to date.

---

## 🛡 Security & Privacy (unchanged)

- **Zero telemetry** — no third-party analytics or tracking.
- **OS-level keyring** — Moodle sessions live in Windows Credential Manager or macOS Keychain.
- **Client-side AI** — your API keys never leave the machine.
- **Polite requests** — all Moodle requests are rate-limited to stay within
  the university's acceptable-use guidelines.

---

## 📦 Downloads & Installation

> [!NOTE]
> **Platform Support**: Muster supports **Windows 10 / 11 (64-bit)** and beta builds for **Apple Silicon and Intel Macs running macOS 12 or later**.

| Platform | Package Type | File | Status |
| :--- | :--- | :--- | :--- |
| **Windows** (Recommended) | NSIS Installer | `Muster_0.1.1_x64-setup.exe` | ✅ Available |
| **Windows** | Enterprise MSI | `Muster_0.1.1_x64_en-US.msi` | ✅ Available |
| **Windows** | Standalone Executable | `muster.exe` | ✅ Available |
| **macOS** | Apple Silicon DMG | `Muster_0.1.1_aarch64.dmg` | 🧪 Beta |
| **macOS** | Intel DMG | `Muster_0.1.1_x64.dmg` | 🧪 Beta |

> [!IMPORTANT]
> The macOS beta uses an ad-hoc signature and is not notarized by Apple. On first launch, macOS may block the app. After attempting to open Muster, go to **System Settings → Privacy & Security** and choose **Open Anyway**. Download the DMG matching your Mac's processor.

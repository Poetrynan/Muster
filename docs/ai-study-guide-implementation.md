# Stability and study-guide MVP — implementation record (2026-11-08)

This implements the approved first two product phases. Version/tag/release remain unchanged. This is an arrangements guide, not a PDF-content tutor.

## Behavior

- Removed the conversational entry, transient chat state and chat-only components. Course/week guide is the main AI flow, with dashboard and course-detail entry points.
- Facts, assessment statuses, deterministic urgency and source previews work without an API key. No automatic paid generation or retries.
- Guide generation streams readable prose and verifies completed card payloads. Reasoning and machine appendices stay hidden. Failed or interrupted generation keeps the previous complete guide, with incomplete prose shown separately.
- Canonical dates/status/grades/weights come from cached facts. Card text cannot restate numeric facts under a different label: factIds supply the program-rendered values. Planning durations are explicit estimates bounded by the student's available time.
- Independent, complete assessment weights can produce arithmetic toward 50; category splits, missing scales or ambiguous rules remain unknown. No claim that hurdles are satisfied.
- Sources carry stable ids, content fingerprints, coverage and snapshots. Linked PDFs are clearly title-only. No vector retrieval or PDF parser was introduced.
- Artifacts and task progress are scoped by cache owner/course/calendar week/teaching week. Personal checks never update Moodle submission status. Original legacy summaries/plans stay available separately.
- Source/context/settings/date changes mark cached guides stale. Whole-record UTF8 evidence budgeting reports omitted sources. No credentials or source-link fields are put in the model evidence.

## Validation

- Existing baseline: 116 frontend tests; previous submission/modal/URL fixes retained.
- Added synthetic tests for course/week isolation, deadline conflicts, conservative score arithmetic, numeric/source validation, streaming failures, damaged cache recovery and account switches.
- Browser checks: 400/768/1280px × en/zh/ja/ko × light/dark (24 combinations), long source text, 200% text scaling, local completion, edited task retention, no-key flow, source access, and browser text-only fallback.
- Browser provider response is a mock; this does not establish real provider compatibility, citation semantics, learning benefit or paid-request latency/cost.
- Final frontend/Rust/build counts and review closure are recorded below after execution.

## Remaining product evaluation

Real-provider smoke testing with authorized credentials, a student pilot, macOS/Linux native runtime checks and release/update checks remain separate. PDF text/page citations and any future retrieval choice remain outside this MVP.

## Review corrections

Independent review exposed and reproduced six issues: week-independent actions, replacement of validated guides by text fallback, unverified prose links, ambiguous numeric fact ownership, damaged cached dates, and a clipped mobile entry. These now have targeted fixes and regressions. A follow-up found JSON-only partial success could render an empty fallback; accepted cards now render with snapshot evidence while the complete primary guide remains intact.

Current calendar-week actions cover upcoming 7 days and recent overdue work; another selected calendar week projects that week in the local timezone. Course-wide grading facts are retained independently. Teaching weeks are never inferred from a calendar offset.

Text-only or partly rejected responses are saved separately from an existing primary guide, including across restarts. Original-source navigation remains in the verified source components; guide-prose links are plain text.

Final review: all confirmed parser, transport and guide findings closed. Final managed-workspace frontend regression: 28 files, 209 tests passed. Browser checks: 24 responsive/theme/language combinations plus 200% text scaling; actual CourseDetail shortcut clicked successfully at 400px. Rust: 100 passed, 1 credential-manager test intentionally ignored. Production build result recorded after completion. No release, tag, commit, or push performed.

Final managed production build: passed (TypeScript + Vite). Final Rust rerun: 100 passed, 1 intentionally ignored. D:\Muster received 37 task files with matching hashes. Final D:\Muster frontend regression: recorded by command output.

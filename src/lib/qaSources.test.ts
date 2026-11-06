import { expect, it, vi } from "vitest";
import { openQaSource, resolveQaSources, safeSourceUrl } from "./qaSources";
import { searchCourseMaterials } from "./courseSearch";

const hits = Array.from({ length: 5 }, (_, i) => ({ sourceId: i + 1, kind: "resource" as const,
  courseId: 1, title: `Notes ${i + 1}`, snippet: "text", score: 1, url: `https://learning.monash.edu/mod/resource/view.php?id=${i}` }));
it("maps non-contiguous inline citations rather than slicing by source count", () => {
  expect(resolveQaSources("See [2] and [5], also [2].", hits).sources.map(s => s.sourceId)).toEqual([2, 5]);
});
it("flags missing/invalid evidence and ignores citations inside code or Markdown links", () => {
  expect(resolveQaSources("No citations", hits).insufficient).toBe(true);
  const result = resolveQaSources("See [99], `[1]`, [2](https://example.com).", hits);
  expect(result.sources).toEqual([]);
  expect(result.insufficient).toBe(true);
});
it("preserves cached URLs through retrieval and rejects unsafe source schemes", () => {
  const found = searchCourseMaterials("notes", [{ sourceId: 0, kind: "resource", courseId: 1, title: "Notes", body: "", url: hits[0].url }]);
  expect(found[0].url).toBe(hits[0].url);
  expect(safeSourceUrl("javascript:alert(1)")).toBeUndefined();
  expect(safeSourceUrl(hits[0].url)).toBe(hits[0].url);
});

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
it("opens Moodle sources with the authenticated webview and falls back if unavailable", async () => {
  mocks.invoke.mockResolvedValueOnce(undefined);
  await openQaSource(hits[1]);
  expect(mocks.invoke).toHaveBeenLastCalledWith("open_in_app_webview", { url: hits[1].url, title: hits[1].title });
  expect(mocks.openUrl).not.toHaveBeenCalled();
  mocks.invoke.mockRejectedValueOnce(new Error("unavailable"));
  await openQaSource(hits[4]);
  expect(mocks.openUrl).toHaveBeenLastCalledWith(hits[4].url);
});
it("never treats a lookalike domain as Monash or opens a dangerous scheme", async () => {
  mocks.invoke.mockClear(); mocks.openUrl.mockClear();
  await openQaSource({ ...hits[0], url: "https://monash.edu.example.com/notes" });
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(mocks.openUrl).toHaveBeenCalledTimes(1);
  await openQaSource({ ...hits[0], url: "javascript:alert(1)" });
  expect(mocks.openUrl).toHaveBeenCalledTimes(1);
});

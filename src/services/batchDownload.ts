import { useAppStore } from "../stores/useAppStore";
import { downloadFile } from "./api";
import { computeSavePath, isDownloadableUrl } from "../lib/utils";
import { showToast } from "../components/ui/toast";
import type { Resource } from "../types";
import type { TranslationKey } from "../i18n/translations";

export interface BatchResult {
  /** Freshly downloaded files this run. */
  done: number;
  /** Files that were already on disk and skipped (skipExisting). */
  skipped: number;
  /** Files that errored out. */
  failed: number;
}

/**
 * Download many resources with bounded concurrency. Each resource resolves its own save
 * directory via `computeSavePath`, so files from different courses land in their own
 * per-course folders. Failures are isolated (one bad file doesn't abort the batch) and
 * `skipExisting` keeps re-runs cheap. Per-file progress still flows through the download
 * manager (upsertDownload); only a single summary toast is shown at the end.
 */
export async function batchDownload(
  resources: Resource[],
  t: (k: TranslationKey, vars?: Record<string, string | number>) => string,
  concurrency = 4
): Promise<BatchResult> {
  const downloadable = resources.filter((r) => r.url && isDownloadableUrl(r.url));
  const result: BatchResult = { done: 0, skipped: 0, failed: 0 };
  if (downloadable.length === 0) {
    showToast(t("dashboard.batchDone", { done: 0, skipped: 0, failed: 0 }));
    return result;
  }

  const { courses, settings, upsertDownload } = useAppStore.getState();
  let cursor = 0;

  const worker = async () => {
    while (cursor < downloadable.length) {
      const r = downloadable[cursor++];
      const key = r.url!;
      upsertDownload({
        key,
        name: r.name,
        received: 0,
        total: null,
        speed: 0,
        status: "downloading",
        lastTick: Date.now(),
      });
      try {
        const dir = computeSavePath(r, {
          downloadPath: settings.downloadPath || "",
          groupByCourse: settings.groupDownloadsByCourse,
          courses,
        });
        const dlResult = await downloadFile(key, dir, true);
        upsertDownload({
          key,
          name: r.name,
          received: 0,
          total: null,
          speed: 0,
          status: "done",
          path: dlResult.path,
          lastTick: Date.now(),
        });
        if (dlResult.skipped) {
          result.skipped++;
        } else {
          result.done++;
        }
      } catch (err) {
        console.error("Batch download failed:", err);
        upsertDownload({
          key,
          name: r.name,
          received: 0,
          total: null,
          speed: 0,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
          lastTick: Date.now(),
        });
        result.failed++;
      }
    }
  };

  const poolSize = Math.min(concurrency, downloadable.length);
  await Promise.all(Array.from({ length: poolSize }, worker));

  showToast(t("dashboard.batchDone", { done: result.done, skipped: result.skipped, failed: result.failed }));
  return result;
}

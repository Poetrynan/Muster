import { useAppStore, getSyncOptions } from "../stores/useAppStore";
import { syncAll } from "./api";
import type { SyncCallbacks, SyncOptions, SyncProgress, SyncResult } from "./api";

/** How the coordinator reaches the backend (injectable for tests). */
export type SyncTransport = (options: SyncOptions, callbacks?: SyncCallbacks) => Promise<SyncResult>;

export interface BackgroundSyncHooks {
  onProgress?: (progress: SyncProgress) => void;
}

interface Inflight {
  promise: Promise<SyncResult>;
  epoch: number;
  /** Courses this run scrapes; undefined = all of them. */
  targets?: Set<number>;
}

let inflight: Inflight | null = null;

export const SYNC_CANCELLED = "SYNC_CANCELLED";

export function isSyncCancelled(err: unknown): boolean {
  return (err instanceof Error ? err.message : String(err)).includes(SYNC_CANCELLED);
}

/** Whether a background sync started by this coordinator is still running. */
export function isBackgroundSyncRunning(): boolean {
  return inflight !== null;
}

/** Whether the running background sync will fetch this course, so a page can show the
 *  loading state and wait for the streamed batch instead of scraping the same pages again. */
export function backgroundSyncCovers(courseId: number): boolean {
  if (!inflight || inflight.epoch !== useAppStore.getState().sessionEpoch) return false;
  return !inflight.targets || inflight.targets.has(courseId);
}

/**
 * Start (or join) the one background sync for the current login session.
 *
 * - Single-flight: while a sync runs, every caller gets the same promise, so the startup
 *   sync, the periodic check and a manual refresh never stack scrapes on the school server.
 * - Streaming: each batch the backend emits (course list first, then one per finished course)
 *   is merged into the store at once, without finishing the sync or stamping lastSync. Pages
 *   read from the store, so nothing waits for the user to open a course or tab.
 * - Session-bound: signing out, signing in again or resetting bumps `sessionEpoch`; the run
 *   is then cancelled in the backend and any late batch or final result is dropped.
 * - Failure keeps whatever was streamed and the previous lastSync.
 */
export function startBackgroundSync(
  fullRefresh = false,
  transport: SyncTransport = syncAll,
  hooks: BackgroundSyncHooks = {}
): Promise<SyncResult> {
  const store = useAppStore;
  const epoch = store.getState().sessionEpoch;
  if (inflight && inflight.epoch === epoch) return inflight.promise;

  const options = getSyncOptions(store.getState(), fullRefresh);
  const targets = options.targetCourseIds ? new Set(options.targetCourseIds) : undefined;
  const controller = new AbortController();
  const alive = () => !controller.signal.aborted && store.getState().sessionEpoch === epoch;
  const unsubscribe = store.subscribe((state) => {
    if (state.sessionEpoch !== epoch) controller.abort();
  });
  const cancelled = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new Error(SYNC_CANCELLED)), { once: true });
  });
  // Keep an unobserved rejection quiet when the run ends normally.
  cancelled.catch(() => undefined);

  const run = async (): Promise<SyncResult> => {
    store.getState().setSyncStatus({ isRunning: true });
    try {
      const pending = transport(options, {
        signal: controller.signal,
        onData: (patch) => {
          if (!alive()) return;
          store.getState().updateAllSyncedData({ ...patch, partial: true });
        },
        onProgress: (progress) => {
          if (alive()) hooks.onProgress?.(progress);
        },
      });
      const data = await Promise.race([pending, cancelled]);
      if (!alive()) throw new Error(SYNC_CANCELLED);
      console.info(
        `[Muster][sync] requests=${data.requestsUsed} unchanged=${data.unchangedCourseIds.length}/${data.courses.length}`
      );
      store.getState().updateAllSyncedData({
        courses: data.courses,
        resources: data.resources,
        assignments: data.assignments,
        announcements: data.announcements,
        tabs: data.tabs,
        unchangedCourseIds: data.unchangedCourseIds,
        newFingerprints: data.fingerprints,
        requestsUsed: data.requestsUsed,
        statusUpdates: data.statusUpdates,
        fullRefresh,
      });
      // Stamp the launch cooldown only after a successful sync.
      store.getState().updateSettings({ lastAutoSyncAt: new Date().toISOString() });
      return data;
    } catch (err) {
      if (!alive()) {
        controller.abort();
        throw new Error(SYNC_CANCELLED);
      }
      store.getState().setSyncStatus({ isRunning: false });
      throw err;
    } finally {
      unsubscribe();
    }
  };

  const promise = run().finally(() => {
    if (inflight?.promise === promise) inflight = null;
  });
  inflight = { promise, epoch, targets };
  return promise;
}

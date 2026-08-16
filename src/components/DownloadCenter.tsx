import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Download, FolderOpen, X } from "lucide-react";
import { useAppStore } from "../stores/useAppStore";
import { useTranslation } from "../i18n/useTranslation";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Dialog } from "./ui/dialog";
import type { DownloadItem } from "../services/api";

const openDownloadFolder = async (filePath: string) => {
  // Preferred: open the containing folder directly (opener:allow-open-path is in
  // the new builds' capabilities). Fallback: revealItemInDir opens the folder and
  // selects the file — its permission is in the default set, so it works even on
  // builds without the extra capability. Either way the folder opens.
  try {
    const { openPath } = await import("@tauri-apps/plugin-opener");
    const dir = filePath.replace(/\\[^\\/]+$/, "").replace(/\/[^/]+$/, "");
    await openPath(dir);
  } catch (err) {
    console.warn("openPath failed, falling back to revealItemInDir:", err);
    try {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(filePath);
    } catch (err2) {
      console.warn("revealItemInDir failed:", err2);
    }
  }
};

interface DownloadCenterProps {
  /** When this value changes the dropdown closes (e.g. the active tab). */
  autoCloseKey?: string | number;
}

/**
 * Shared download center — the exact same toolbar button + dropdown panel +
 * "view all" dialog as the Dashboard, so every page that offers downloads
 * (course detail, assignments, ...) gets the identical download manager entry
 * point and users never have to go back to the home page to check progress.
 */
export function DownloadCenter({ autoCloseKey }: DownloadCenterProps) {
  const { t } = useTranslation();
  const downloads = useAppStore((s) => s.downloads);
  const removeDownload = useAppStore((s) => s.removeDownload);
  const clearDownloads = useAppStore((s) => s.clearDownloads);

  const [dlOpen, setDlOpen] = useState(false);
  const [dlModalOpen, setDlModalOpen] = useState(false);
  const dlPanelRef = useRef<HTMLDivElement>(null);

  const activeDownloadCount = downloads.filter((x) => x.status === "downloading").length;

  // Close the panel when the page/tab changes.
  useEffect(() => {
    setDlOpen(false);
  }, [autoCloseKey]);

  // Outside click / Esc closes the dropdown.
  useEffect(() => {
    if (!dlOpen) return;
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (dlPanelRef.current && !dlPanelRef.current.contains(e.target as Node)) {
        setDlOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDlOpen(false);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [dlOpen]);

  const pctOf = (dl: DownloadItem) =>
    dl.total && dl.total > 0 ? Math.min(100, Math.round((dl.received / dl.total) * 100)) : 0;
  const speedTextOf = (dl: DownloadItem) =>
    dl.speed > 0 ? `${(dl.speed / 1024 / 1024).toFixed(1)} MB/s` : "";
  const sizeTextOf = (dl: DownloadItem) =>
    dl.total && dl.total > 0
      ? `${(dl.received / 1024 / 1024).toFixed(1)} / ${(dl.total / 1024 / 1024).toFixed(1)} MB`
      : dl.received > 0
        ? `${(dl.received / 1024 / 1024).toFixed(1)} MB`
        : "";

  const statusIcon = (dl: DownloadItem) =>
    dl.status === "downloading" ? (
      <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin shrink-0" />
    ) : dl.status === "done" ? (
      <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
    ) : (
      <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
    );

  const renderItem = (dl: DownloadItem, showRemoveAlways: boolean) => (
    <div key={dl.key} className={`border rounded-lg p-2 ${showRemoveAlways ? "bg-card" : ""}`}>
      <div className="flex items-center gap-2">
        {statusIcon(dl)}
        <p className="text-xs font-medium truncate flex-1">{dl.name}</p>
        {(showRemoveAlways || dl.status !== "downloading") && (
          <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => removeDownload(dl.key)}>
            <X className="w-3 h-3" />
          </Button>
        )}
      </div>
      {dl.status === "downloading" && (
        <>
          <div className="h-1.5 w-full bg-muted rounded-full mt-2 overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${pctOf(dl)}%` }} />
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            {pctOf(dl)}% {sizeTextOf(dl) && `· ${sizeTextOf(dl)}`} {speedTextOf(dl) && `· ${speedTextOf(dl)}`}
          </p>
        </>
      )}
      {dl.status === "done" && (
        <div className="flex items-center justify-between mt-1">
          <p className="text-[11px] text-success">{t("downloads.done")}</p>
          {dl.path && (
            <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => openDownloadFolder(dl.path!)}>
              <FolderOpen className="w-3 h-3 mr-1" />
              {t("downloads.openFolder")}
            </Button>
          )}
        </div>
      )}
      {dl.status === "error" && (
        <p className="text-[11px] text-destructive mt-1">
          {t("downloads.failed")}{dl.error ? `: ${dl.error}` : ""}
        </p>
      )}
    </div>
  );

  return (
    <>
      <div className="relative" ref={dlPanelRef}>
        <button
          type="button"
          onClick={() => setDlOpen((v) => !v)}
          className="inline-flex items-center justify-center w-10 h-10 rounded-xl text-foreground hover:bg-muted/50 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 relative"
          aria-label={t("downloads.openPanel")}
          title={t("downloads.title")}
        >
          <Download className="w-5 h-5" />
          {activeDownloadCount > 0 && (
            <span className="absolute top-1 right-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px]">
              {activeDownloadCount}
            </span>
          )}
        </button>
        {dlOpen && (
          <Card className="absolute right-0 top-full mt-2 w-80 shadow-2xl z-50">
            <CardContent className="p-3 space-y-2 max-h-80 overflow-y-auto">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold">{t("downloads.title")}</span>
                {downloads.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearDownloads}>
                    {t("downloads.clearAll")}
                  </Button>
                )}
              </div>
              {downloads.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">{t("downloads.empty")}</p>
              )}
              {downloads.slice(0, 5).map((dl) => renderItem(dl, false))}
              {downloads.length > 5 && (
                <Button variant="outline" size="sm" className="w-full mt-1" onClick={() => setDlModalOpen(true)}>
                  {t("dashboard.downloadsViewAll", { count: downloads.length })}
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Download history modal: view all download tasks (including completed/failed) */}
      <Dialog open={dlModalOpen} onClose={() => setDlModalOpen(false)} className="w-[560px] max-w-[92vw]">
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-foreground">{t("downloads.title")}</h3>
            <span className="text-xs text-muted-foreground">{downloads.length}</span>
          </div>
          {downloads.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">{t("downloads.empty")}</p>
          ) : (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              {downloads.map((dl) => renderItem(dl, true))}
            </div>
          )}
          <div className="flex justify-between mt-4 pt-3 border-t">
            <Button variant="outline" size="sm" onClick={clearDownloads}>
              {t("downloads.clearAll")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDlModalOpen(false)}>
              {t("common.close")}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

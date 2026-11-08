import { useState } from "react";
import { Dialog, DialogHeader, DialogFooter } from "./ui/dialog";
import { Button } from "./ui/button";
import { useTranslation } from "../i18n/useTranslation";
import { useAppStore } from "../stores/useAppStore";
import { logout } from "../services/api";

/**
 * Sign-out confirmation. Signing out always ends the Moodle session and removes the
 * portal credential from the OS keychain (backend `logout`). Local data is kept by
 * default — signing back in with the same account picks it up — and can be removed
 * explicitly for a shared computer. Downloaded files are never touched here.
 */
export function LogoutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<"keep" | "clear" | null>(null);

  const signOut = async (clearData: boolean) => {
    if (busy) return;
    setBusy(clearData ? "clear" : "keep");
    try {
      await logout();
    } catch (err) {
      // A failed backend call must not trap the user in a signed-in UI.
      console.warn("logout failed:", err);
    }
    if (clearData) {
      useAppStore.persist.clearStorage();
    }
    useAppStore.getState().signOut(clearData);
    setBusy(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={busy ? () => {} : onClose} className="max-w-md">
      <DialogHeader title={t("logout.title")} description={t("logout.body")} />
      <p className="text-xs text-muted-foreground">{t("logout.clearHint")}</p>
      <DialogFooter>
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button variant="ghost" onClick={onClose} disabled={busy !== null}>
            {t("logout.cancel")}
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" className="text-destructive" onClick={() => signOut(true)} disabled={busy !== null}>
              {busy === "clear" ? t("logout.working") : t("logout.clear")}
            </Button>
            <Button onClick={() => signOut(false)} disabled={busy !== null} autoFocus>
              {busy === "keep" ? t("logout.working") : t("logout.keep")}
            </Button>
          </div>
        </div>
      </DialogFooter>
    </Dialog>
  );
}

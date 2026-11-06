import { useAppStore } from "../stores/useAppStore";
import { fetchExams } from "./api";
import type { TranslationKey } from "../i18n/translations";
import { inferActiveSemesterKey } from "../lib/courseHelpers";
import { examSignature } from "../lib/examSignature";

export function examErrorKey(error: string | null): TranslationKey {
  if (error?.includes("PORTAL_LOGIN_REQUIRED")) return "dashboard.examsLoginRequired";
  if (error?.includes("PORTAL_ACCOUNT_MISMATCH")) return "dashboard.examsAccountMismatch";
  if (error?.includes("PORTAL_CREDENTIAL")) return "dashboard.examsCredentialFailed";
  if (error?.includes("PORTAL_CAPTURE") || error?.includes("PORTAL_WEBVIEW")) return "dashboard.examsCaptureFailed";
  if (error?.includes("PORTAL_NETWORK") || error?.includes("PORTAL_TIMEOUT")) return "dashboard.examsNetworkFailed";
  if (error?.includes("PORTAL_EXAM_")) return "dashboard.examsDataUnavailable";
  return "dashboard.examsFailed";
}

let inFlight: Promise<void> | undefined;

/** Independent of Moodle sync: failures leave cached exams visible and retryable. */
export function refreshExamSchedule(forceCheck = false): Promise<void> {
  if (inFlight) return inFlight;
  const initial = useAppStore.getState();
  const semester = initial.courses.length ? inferActiveSemesterKey(initial.courses) : undefined;
  const sameSemester = !semester || !initial.examsSemester || semester === initial.examsSemester;
  if (initial.examsAttemptedAt !== undefined && Date.now() - initial.examsAttemptedAt < 300_000) return Promise.resolve();
  if (!forceCheck && sameSemester && initial.examLoadStatus === "success" && initial.examsCheckedAt && Date.now() - Date.parse(initial.examsCheckedAt) < 300_000) {
    return Promise.resolve();
  }
  useAppStore.setState({ examLoadStatus: "loading", examError: null, examsAttemptedAt: Date.now() });
  // reset() replaces this status on logout. Do not apply an old account's result.
  const account = initial.user?.id;
  let timeout: ReturnType<typeof setTimeout>;
  inFlight = (async () => {
    try {
      const exams = await Promise.race([
        fetchExams(initial.examsFetched && sameSemester),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("PORTAL_TIMEOUT")), 180_000); }),
      ]);
      const current = useAppStore.getState();
      if (current.user?.id !== account || current.examLoadStatus !== "loading") return;
      if (exams === null) {
        if (!current.examsFetched) throw new Error("PORTAL_RESPONSE_ERROR");
        useAppStore.setState({ examsCheckedAt: new Date().toISOString(), examLoadStatus: "success", examError: null });
        return;
      }
      if (current.examsFetched && sameSemester && examSignature(current.exams) === examSignature(exams)) {
        useAppStore.setState({ examsCheckedAt: new Date().toISOString(), examsSemester: semester || current.examsSemester, examLoadStatus: "success", examError: null });
        return;
      }
      current.setExams(exams.map(exam => ({ ...exam, courseId: current.courses.find(c =>
        (c.shortName.match(/[A-Z]{3}\d{4}/i)?.[0] ?? "").toUpperCase() === exam.courseCode.toUpperCase()
      )?.id })));
    } catch (error) {
      const current = useAppStore.getState();
      if (current.user?.id === account && current.examLoadStatus === "loading") {
        useAppStore.setState({ examLoadStatus: "error", examError: String(error) });
        if (String(error).includes("PORTAL_LOGIN_REQUIRED") || String(error).includes("PORTAL_ACCOUNT_MISMATCH")) {
          current.requireReauthentication("portal");
        }
      }
    } finally {
      clearTimeout(timeout!);
      inFlight = undefined;
    }
  })();
  return inFlight;
}

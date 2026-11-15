import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle } from "lucide-react";
import { Button } from "../components/ui/button";
import { useAppStore } from "../stores/useAppStore";
import { useTranslation } from "../i18n/useTranslation";
import { LanguageSelect } from "../components/LanguageSelect";
import { startSSOLoginWebView } from "../services/api";
import appIcon from "../assets/app-icon.png";

/**
 * Official Monash brand colours —— monash.edu/brandbook/brand-elements/colours
 *  Primary (the only one): Monash Blue #006DAE / PMS 2945C
 *  Tertiary: Blueberry #121256 (the left panel's solid background)
 */
const MONASH = {
  blue: "#006DAE",
  blueberry: "#121256",
} as const;

/**
 * The login page is forced to light mode: regardless of the global darkMode setting, fixed light tokens are used here.
 * The CSS variables are overridden locally on this page's root node —— a closer scope than `.dark`
 * on documentElement, so bg-background / text-foreground etc. on every child resolve to light values.
 */
const LIGHT_TOKENS = {
  "--color-background": "#FFFFFF",
  "--color-foreground": "#000000",
  "--color-card": "#FFFFFF",
  "--color-muted": "#F5F5F5",
  "--color-muted-foreground": "#666666",
  "--color-border": "#E0E0E0",
  "--color-ring": MONASH.blue,
} as React.CSSProperties;

export function LoginPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { completeLogin, reauthReason } = useAppStore();
  const { t, lang } = useTranslation();

  // Footer version comes from the runtime (tauri.conf.json) — never hardcoded,
  // so a release can never ship with a stale version string.
  useEffect(() => {
    let cancelled = false;
    import("../services/updater")
      .then((m) => m.getCurrentAppVersion())
      .then((v) => {
        if (!cancelled) setAppVersion(v);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLoginResponse = (response: {
    success: boolean;
    message: string;
    user?: any;
  }) => {
    if (response.success) {
      completeLogin(
        response.user || {
          id: 1,
          username: "student",
          fullName: "Monash Student",
          email: "student@monash.edu",
          profileImage: "",
        }
      );
    } else {
      setError(response.message || t("login.errorConnection"));
    }
  };

  const handleSSOLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await startSSOLoginWebView();
      handleLoginResponse(response);
    } catch (err) {
      console.error("SSO login error:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (!errorMessage.includes("窗口已关闭") && !errorMessage.includes("取消")) {
        // Keep the friendly text, but expose the code so a failure can be diagnosed.
        const code = errorMessage.match(/PORTAL_[A-Z_]+/)?.[0];
        setError(code ? `${t("login.unifiedIncomplete")} (${code})` : errorMessage || t("login.errorConnection"));
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Landing copy is fully localized (zh / en / ja / ko). Plain statements of what the
  // app does — no adjectives, no claims the app does not back up.
  const COPY = {
    zh: {
      tagline: "Monash 学生的课程助手",
      heroTitle: "所有课程，一个地方看完",
      heroBody: "登录后，Muster 会把各门课的截止日期、资料和公告整理到一处，之后在后台保持更新。",
      previewTitle: "未来 7 天截止",
      previewItems: [
        { title: "Assignment 2", unit: "FIT1045", due: "2 天后" },
        { title: "Weekly quiz 5", unit: "MAT1830", due: "4 天后" },
        { title: "Lab report", unit: "PHS1011", due: "6 天后" },
      ],
      previewNote: "示例数据",
      footerLocal: "数据只保存在这台电脑上",
      welcome: "登录",
      welcomeBody: "使用 Monash 学生账号，通过学校官方页面登录。",
      signIn: "使用 Monash 账号登录",
      securityNote: "Muster 不会看到你的密码，登录凭证保存在系统钥匙串中。",
      footNote: "非 Monash 官方出品，与 Monash University 无关联",
      errorTitle: "登录错误",
      signingIn: "正在打开登录页面…",
    },
    en: {
      tagline: "A course companion for Monash students",
      heroTitle: "All your units, in one place",
      heroBody: "Once you sign in, Muster collects deadlines, materials and announcements from every unit and keeps them up to date in the background.",
      previewTitle: "Due in the next 7 days",
      previewItems: [
        { title: "Assignment 2", unit: "FIT1045", due: "in 2 days" },
        { title: "Weekly quiz 5", unit: "MAT1830", due: "in 4 days" },
        { title: "Lab report", unit: "PHS1011", due: "in 6 days" },
      ],
      previewNote: "Sample data",
      footerLocal: "Your data stays on this computer",
      welcome: "Sign in",
      welcomeBody: "Use your Monash student account on the university's own sign-in page.",
      signIn: "Sign in with Monash",
      securityNote: "Muster never sees your password. Your session is kept in the system keychain.",
      footNote: "Not a Monash product, not affiliated with Monash University",
      errorTitle: "Sign-in error",
      signingIn: "Opening sign-in page…",
    },
    ja: {
      tagline: "Monash 学生のためのコースアシスタント",
      heroTitle: "すべての科目を、ひとつの場所で",
      heroBody: "ログインすると、Muster が各科目の締め切り・資料・お知らせを一か所にまとめ、その後もバックグラウンドで更新します。",
      previewTitle: "7 日以内の締め切り",
      previewItems: [
        { title: "Assignment 2", unit: "FIT1045", due: "2 日後" },
        { title: "Weekly quiz 5", unit: "MAT1830", due: "4 日後" },
        { title: "Lab report", unit: "PHS1011", due: "6 日後" },
      ],
      previewNote: "サンプルデータ",
      footerLocal: "データはこのコンピューターにのみ保存されます",
      welcome: "ログイン",
      welcomeBody: "Monash の学生アカウントで、大学の公式ページからログインします。",
      signIn: "Monash アカウントでログイン",
      securityNote: "Muster がパスワードを見ることはありません。ログイン情報はシステムのキーチェーンに保存されます。",
      footNote: "Monash 公式製品ではなく、Monash University とは無関係です",
      errorTitle: "ログインエラー",
      signingIn: "ログインページを開いています…",
    },
    ko: {
      tagline: "Monash 학생을 위한 코스 도우미",
      heroTitle: "모든 과목을 한곳에서",
      heroBody: "로그인하면 Muster가 각 과목의 마감일·자료·공지를 한곳에 모으고, 이후에도 백그라운드에서 최신 상태로 유지합니다.",
      previewTitle: "7일 이내 마감",
      previewItems: [
        { title: "Assignment 2", unit: "FIT1045", due: "2일 후" },
        { title: "Weekly quiz 5", unit: "MAT1830", due: "4일 후" },
        { title: "Lab report", unit: "PHS1011", due: "6일 후" },
      ],
      previewNote: "예시 데이터",
      footerLocal: "데이터는 이 컴퓨터에만 저장됩니다",
      welcome: "로그인",
      welcomeBody: "Monash 학생 계정으로 학교 공식 페이지에서 로그인합니다.",
      signIn: "Monash 계정으로 로그인",
      securityNote: "Muster는 비밀번호를 볼 수 없습니다. 로그인 정보는 시스템 키체인에 저장됩니다.",
      footNote: "Monash 공식 제품이 아니며 Monash University와 무관합니다",
      errorTitle: "로그인 오류",
      signingIn: "로그인 페이지를 여는 중…",
    },
  } as const;

  const copy = COPY[lang as keyof typeof COPY] ?? COPY.en;

  return (
    <div
      style={LIGHT_TOKENS}
      className="h-screen w-full flex bg-background text-foreground overflow-hidden"
    >
      {/* ============ Left: what the app is, shown with the product itself ============ */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35 }}
        className="relative w-[52%] p-10 flex flex-col justify-between overflow-hidden"
        style={{ background: MONASH.blueberry }}
      >
        {/* Brand */}
        <div className="flex items-center gap-3 shrink-0">
          <img src={appIcon} alt="" className="w-9 h-9 object-contain" />
          <div>
            <div className="font-bold text-lg text-white tracking-tight leading-tight">Muster</div>
            <p className="text-[13px] text-white/60">{copy.tagline}</p>
          </div>
        </div>

        {/* Statement + a real piece of the interface (sample data) */}
        <div className="max-w-md">
          <h1 className="text-[32px] font-bold text-white tracking-tight leading-[1.2]">
            {copy.heroTitle}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-white/70">{copy.heroBody}</p>

          <figure className="mt-9 rounded-2xl bg-white p-4 text-[#111] shadow-[0_24px_48px_-16px_rgba(0,0,0,0.45)] -rotate-1">
            <figcaption className="mb-3 flex items-baseline justify-between px-1">
              <span className="text-sm font-semibold">{copy.previewTitle}</span>
              <span className="text-[11px] text-[#8a8a8a]">{copy.previewNote}</span>
            </figcaption>
            <ul className="space-y-2">
              {copy.previewItems.map((item, i) => (
                <li
                  key={item.unit}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[#ececec] px-3.5 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{item.title}</p>
                    <p className="text-[11px] text-[#8a8a8a]">{item.unit}</p>
                  </div>
                  <span
                    className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium"
                    style={
                      i === 0
                        ? { background: "#FDECEC", color: "#B42318" }
                        : { background: "#F2F2F2", color: "#555" }
                    }
                  >
                    {item.due}
                  </span>
                </li>
              ))}
            </ul>
          </figure>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-[12px] text-white/50 shrink-0">
          <span>© 2026 Muster</span>
          <span>{copy.footerLocal}</span>
        </div>
      </motion.div>

      {/* ============ Right: the sign-in form (always light) ============ */}
      <div className="relative w-[48%] p-10 flex flex-col justify-between items-center bg-background overflow-hidden">
        <div className="w-full flex items-center justify-end shrink-0">
          <LanguageSelect />
        </div>

        <div className="w-full max-w-sm my-auto space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-foreground tracking-tight">{copy.welcome}</h2>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{copy.welcomeBody}</p>
          </div>

          {reauthReason && (
            <p role="status" className="rounded-lg border border-border bg-muted p-3 text-sm">
              {t(reauthReason === "signedOut" ? "login.signedOut" : "login.reauthRequired")}
            </p>
          )}
          {error && (
            <div
              role="alert"
              aria-live="assertive"
              className="flex items-start gap-2.5 p-3 rounded-lg bg-destructive/10 text-sm text-destructive"
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">{t("login.errorTitle") || copy.errorTitle}</p>
                <p className="mt-0.5 opacity-90 leading-relaxed whitespace-pre-line">{error}</p>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <Button
              type="submit"
              className="w-full h-11 text-sm font-semibold rounded-lg gap-2 text-white transition-colors duration-150 hover:brightness-95 active:brightness-90"
              style={{ background: MONASH.blue }}
              onClick={handleSSOLogin}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>{t("login.signingIn") || copy.signingIn}</span>
                </>
              ) : (
                <span className="text-white">{copy.signIn}</span>
              )}
            </Button>
            <p className="text-xs leading-relaxed text-muted-foreground">{copy.securityNote}</p>
          </div>
        </div>

        <p className="text-xs text-center text-muted-foreground shrink-0">
          {`v${appVersion} · ${copy.footNote}`}
        </p>
      </div>
    </div>
  );
}

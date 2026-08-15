import { useState } from "react";
import { motion } from "framer-motion";
import {
  Globe,
  AlertCircle,
  Sparkles,
  ShieldCheck,
  Zap,
  ArrowRight,
  CheckCircle2,
  Lock,
  Cpu,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { useAppStore } from "../stores/useAppStore";
import { useTranslation } from "../i18n/useTranslation";
import { LanguageSelect } from "../components/LanguageSelect";
import { startSSOLoginWebView } from "../services/api";
import appIcon from "../assets/app-icon.png";

/**
 * Official Monash brand colours —— monash.edu/brandbook/brand-elements/colours
 *  Primary (the only one): Monash Blue #006DAE / PMS 2945C
 *  Tertiary blues (used sparingly as accents): Heritage #ABF5F9 / Electric #285AFF / Blueberry #121256
 */
const MONASH = {
  blue: "#006DAE",
  blueDeep: "#005A96",
  heritage: "#ABF5F9",
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
  const [error, setError] = useState<string | null>(null);
  const { setLoggedIn, setUser } = useAppStore();
  const { t, lang } = useTranslation();

  const handleLoginResponse = (response: {
    success: boolean;
    message: string;
    user?: any;
  }) => {
    if (response.success) {
      setUser(
        response.user || {
          id: 1,
          username: "student",
          fullName: "Monash Student",
          email: "student@monash.edu",
          profileImage: "",
        }
      );
      setLoggedIn(true);
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
        setError(errorMessage || t("login.errorConnection"));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const features = [
    {
      icon: Zap,
      badge: lang === "zh" ? "实时同步" : "Instant",
      title: lang === "zh" ? "全自动课件与资料抓取" : "Auto-Sync Course Data",
      desc:
        lang === "zh"
          ? "自动同步 Moodle 讲义 PDF、课程作业与核心公告，进入课程即刷新。"
          : "Automatically pull lecture slides, tasks and announcements the moment you open a unit.",
    },
    {
      icon: Cpu,
      badge: lang === "zh" ? "AI 驱动" : "AI Powered",
      title: lang === "zh" ? "AI 智能提炼考点精要" : "AI Course Summaries",
      desc:
        lang === "zh"
          ? "一键剖析课程重点，按权重排序评估任务，快速梳理复习脉络。"
          : "Distil key exam points and rank assessments by weight to build a clear revision plan.",
    },
    {
      icon: Lock,
      badge: lang === "zh" ? "安全加密" : "Encrypted",
      title: lang === "zh" ? "Monash 官方 SSO 直连" : "Official Monash SSO",
      desc:
        lang === "zh"
          ? "走 Okta 官方二步验证通道，全程不接触明文密码。"
          : "Sign in through the official Okta 2FA flow — your password is never handled by this app.",
    },
  ];

  // BODY_PLACEHOLDER
  return (
    <div
      style={LIGHT_TOKENS}
      className="h-screen w-full flex bg-background text-foreground overflow-hidden"
    >
      {/* ============ Left: branding / value proposition (Monash blue, always dark) ============ */}
      <div
        className="relative w-[52%] p-10 flex flex-col justify-between overflow-hidden"
        style={{
          background: `linear-gradient(140deg, ${MONASH.blue} 0%, ${MONASH.blue} 32%, ${MONASH.blueDeep} 62%, ${MONASH.blueberry} 100%)`,
        }}
      >
        {/* Dot grid + two soft glows (static, no persistent animation) */}
        <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.07)_1px,transparent_1px)] [background-size:20px_20px] pointer-events-none opacity-40" />
        <div
          className="absolute -top-24 -left-24 w-96 h-96 rounded-full blur-3xl pointer-events-none"
          style={{ background: "rgba(171,245,249,0.22)" }}
        />
        <div
          className="absolute bottom-10 right-10 w-96 h-96 rounded-full blur-3xl pointer-events-none"
          style={{ background: "rgba(18,18,86,0.30)" }}
        />

        {/* Brand header */}
        <div className="relative z-10 flex items-center gap-3 shrink-0">
          <img
            src={appIcon}
            alt="Muster App Icon"
            className="w-10 h-10 object-contain drop-shadow-lg"
          />
          <div>
            <div className="font-extrabold text-xl text-white tracking-tight">
              Muster
            </div>
            <p className="text-[13px] font-medium text-white/85">
              Monash Course Intelligence System
            </p>
          </div>
        </div>

        {/* Hero */}
        <div className="relative z-10 max-w-xl">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[13px] font-medium mb-5 backdrop-blur-md border"
              style={{
                background: "rgba(255,255,255,0.15)",
                color: MONASH.heritage,
                borderColor: "rgba(171,245,249,0.35)",
              }}
            >
              <Sparkles className="w-3.5 h-3.5" style={{ color: MONASH.heritage }} />
              <span>
                {lang === "zh"
                  ? "专为 Monash 学生打造的智能学习助手"
                  : "Next-gen intelligence for Monash Moodle"}
              </span>
            </div>

            <h1 className="text-4xl font-extrabold text-white tracking-tight leading-[1.15] mb-4">
              {lang === "zh" ? (
                <>
                  高效掌控课程动态
                  <br />
                  <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-[#ABF5F9] to-white">
                    告别繁琐信息搜寻
                  </span>
                </>
              ) : (
                <>
                  Master Your Courses
                  <br />
                  <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-[#ABF5F9] to-white">
                    Without the Hassle
                  </span>
                </>
              )}
            </h1>

            <p className="text-[15px] leading-relaxed text-white/[0.88] max-w-lg mb-7">
              {lang === "zh"
                ? "智能聚合 Moodle 讲义与作业动态，利用 AI 提炼考点精要，助力 Monash 学生轻松掌控学习节奏。"
                : "Aggregate lecture slides and deadlines seamlessly, then let AI surface the exam topics that matter most."}
            </p>
          </motion.div>

          {/* Feature cards: desc clamped to two lines, fully readable */}
          <div className="flex flex-col gap-2.5 max-w-lg">
            {features.map((feat, idx) => (
              <motion.div
                key={feat.title}
                initial={{ opacity: 0, x: -15 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: 0.08 * (idx + 1) }}
                className="flex items-start gap-3.5 p-3.5 rounded-xl bg-white/5 hover:bg-white/10 backdrop-blur-md transition-colors duration-200"
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                  style={{ background: "rgba(255,255,255,0.16)", color: MONASH.heritage }}
                >
                  <feat.icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold text-white text-sm">{feat.title}</h3>
                    <span
                      className="text-[11px] font-medium px-1.5 py-0.5 rounded shrink-0"
                      style={{ background: "rgba(255,255,255,0.16)", color: MONASH.heritage }}
                    >
                      {feat.badge}
                    </span>
                  </div>
                  <p className="text-[13px] leading-snug text-white/75 mt-0.5 line-clamp-2">
                    {feat.desc}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Footer info */}
        <div className="relative z-10 flex items-center justify-between pt-3 border-t border-white/10 text-[13px] text-white/75 shrink-0">
          <span>© 2026 Muster</span>
          <span className="flex items-center gap-1.5 text-white/90">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            {lang === "zh" ? "本地存储 · 数据不出设备" : "Local-first · data stays on device"}
          </span>
        </div>
      </div>

      {/* ============ Right: sign-in action (always light) ============ */}
      <div className="relative w-[48%] p-10 flex flex-col justify-between items-center bg-background overflow-hidden">
        {/* Top controls: language selector only */}
        <div className="w-full flex items-center justify-end shrink-0">
          <LanguageSelect />
        </div>

        {/* Sign-in body */}
        <div className="w-full max-w-sm my-auto">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="space-y-5"
          >
            <div>
              <div
                className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-md mb-2.5"
                style={{ background: "rgba(0,109,174,0.12)", color: MONASH.blue }}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Monash SSO Authentication</span>
              </div>
              <h2 className="text-2xl font-extrabold text-foreground tracking-tight">
                {lang === "zh" ? "欢迎回来" : "Welcome back"}
              </h2>
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                {lang === "zh"
                  ? "使用 Monash 学生账号通过官方 SSO 通道验证，无需在本应用输入密码。"
                  : "Verify with your Monash student account via official SSO — no password entered here."}
              </p>
            </div>

            {/* Error message: role=alert + aria-live so screen readers announce it */}
            {error && (
              <motion.div
                role="alert"
                aria-live="assertive"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-start gap-2.5 p-3 rounded-xl bg-destructive/10 text-sm text-destructive"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold">
                    {t("login.errorTitle") || (lang === "zh" ? "登录错误" : "Sign-in error")}
                  </p>
                  <p className="mt-0.5 opacity-90 leading-relaxed whitespace-pre-line">{error}</p>
                </div>
              </motion.div>
            )}

            {/* Primary action + a single security note block */}
            <div className="space-y-3 pt-1">
              <Button
                type="submit"
                className="relative overflow-hidden group w-full h-12 text-sm font-semibold rounded-xl gap-2.5 text-white
                           shadow-[0_10px_24px_rgba(0,109,174,0.30)] hover:shadow-[0_12px_30px_rgba(0,109,174,0.42)]
                           hover:brightness-110 active:scale-[0.98] transition-all duration-200"
                style={{ background: `linear-gradient(90deg, ${MONASH.blue}, #0080CC)` }}
                onClick={handleSSOLogin}
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>{t("login.signingIn") || (lang === "zh" ? "登录中..." : "Signing in...")}</span>
                  </>
                ) : (
                  <>
                    <Globe className="w-4 h-4 text-white" />
                    <span className="text-white">
                      {lang === "zh" ? "Monash SSO 快捷登录" : "Sign in with Monash SSO"}
                    </span>
                    <ArrowRight className="w-4 h-4 ml-auto text-white/85 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </Button>

              <div className="p-3.5 rounded-xl bg-muted text-[13px] text-muted-foreground space-y-2">
                <div className="flex items-center gap-1.5 font-semibold text-foreground">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                  <span>{lang === "zh" ? "安全与隐私" : "Security & privacy"}</span>
                </div>
                <ul className="space-y-1.5">
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span>
                      {lang === "zh"
                        ? "支持 Okta 手机 MFA 二步验证"
                        : "Supports Okta mobile 2FA (MFA)"}
                    </span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span>
                      {lang === "zh"
                        ? "凭证写入系统安全凭据库，明文密码零接触"
                        : "Credentials stored in the OS keyring; no plaintext password"}
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Footer: factual, neutral disclaimer */}
        <p className="text-xs text-center text-muted-foreground shrink-0">
          {lang === "zh"
            ? "v0.1.0 · 非 Monash 官方出品，与 Monash University 无关联"
            : "v0.1.0 · Not a Monash product, not affiliated with Monash University"}
        </p>
      </div>
    </div>
  );
}

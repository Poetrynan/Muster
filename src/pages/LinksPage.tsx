import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ExternalLink,
  Info,
  Search,
  X,
  Globe,
  CalendarCheck,
  GraduationCap,
  Building2,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useTranslation } from "../i18n/useTranslation";
import type { Language } from "../i18n/translations";

interface LinksPageProps {
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Data model — all display strings live here (en + zh; ja/ko fall back to en)
// so the site directory stays self-contained and easy to extend.
// ---------------------------------------------------------------------------

type CategoryId = "portal" | "enrol" | "learning" | "campus" | "community";

type L = { en: string; zh: string };

interface SiteLink {
  id: string;
  name: L;
  desc: L;
  /** Longer explainer shown in the info drawer. */
  detail: L;
  url: string;
  host: string; // shown on the card
  /** Domain used to fetch the real favicon; falls back to the Monash crest on error. */
  faviconDomain: string;
  category: CategoryId;
  /** Optional small badge, e.g. campus scope */
  badge?: L;
}

interface Category {
  id: CategoryId;
  name: L;
  /** Tailwind color classes for the icon chip + card icon tile */
  accent: string;
  icon: typeof Globe;
  /** Optional footnote rendered under the section, e.g. the Australia attendance note */
  note?: L;
}

const CATEGORIES: Category[] = [
  {
    id: "portal",
    name: { en: "Official Portal", zh: "官方统一门户" },
    accent: "indigo",
    icon: Globe,
  },
  {
    id: "enrol",
    name: { en: "Enrolment & Timetable", zh: "选课 · 排课 · 考勤" },
    accent: "emerald",
    icon: CalendarCheck,
    note: {
      en: "Australia campus attendance has no standalone website — check in via the QR code in each unit, or tap M-Pass at building entrances.",
      zh: "澳洲校区考勤无独立网站：在课程内扫二维码签到，或进实验楼时刷 M-Pass 门禁。",
    },
  },
  {
    id: "learning",
    name: { en: "Learning & Exams", zh: "课程 · 考试" },
    accent: "violet",
    icon: GraduationCap,
  },
  {
    id: "campus",
    name: { en: "Campus Services", zh: "咨询 · 图书馆 · 校园服务" },
    accent: "sky",
    icon: Building2,
  },
  {
    id: "community",
    name: { en: "Community & Societies", zh: "第三方 · 社团" },
    accent: "rose",
    icon: Users,
  },
];

const SITES: SiteLink[] = [
  // — 官方统一门户 —
  {
    id: "student-portal",
    name: { en: "Student Portal", zh: "Student Portal 官方门户" },
    desc: {
      en: "One-stop student homepage: timetable, calendar, announcements and shortcuts to WES and other systems.",
      zh: "学校官方一站式学生主页：课表日历、重要通知，以及 WES 等各类系统的直接跳转入口。",
    },
    detail: {
      en: "The official one-stop student homepage. It aggregates your timetable, calendar, key announcements and deadlines, and provides direct shortcuts to WES, Allocate+, results release and other Monash systems — the first place to check each morning.",
      zh: "学校官方一站式学生主页。汇总课表日历、重要通知与截止日期，并提供 WES、Allocate+、出分查询等各类系统的直接跳转入口——每天早上先看这里。",
    },
    url: "https://student.monash.edu/",
    host: "student.monash.edu",
    faviconDomain: "monash.edu",
    category: "portal",
  },
  // — 选课 / 排课 / 考勤 —
  {
    id: "wes",
    name: { en: "WES · Web Enrolment System", zh: "WES 选课与学籍系统" },
    desc: {
      en: "Enrol or drop units, view official results and WAM, download fee statements, request transcripts.",
      zh: "每学期选课/退课、期末官方出分（Results/WAM）、下载学费单、申请在读证明与成绩单。",
    },
    detail: {
      en: "Web Enrolment System — the official academic-record console. Use it to enrol into or discontinue units each semester, view released final results and your WAM (Weighted Average Mark), download fee statements, and request official documents such as enrolment statements and academic transcripts.",
      zh: "官方学籍系统。每学期选课/退课、查看期末正式出分与 WAM 加权平均分、下载学费单（Fee Statement），以及申请在读证明与官方成绩单。",
    },
    url: "https://wes.monash.edu/",
    host: "wes.monash.edu",
    faviconDomain: "monash.edu",
    category: "enrol",
  },
  {
    id: "allocate",
    name: { en: "Allocate+", zh: "Allocate+ 排课系统" },
    desc: {
      en: "Submit tutorial/lab preferences at semester start, then swap classes and view your weekly timetable.",
      zh: "学期初填报 Tutorial/Lab 时间段志愿，开放后换班捡漏、调整课表并查看全周日程。",
    },
    detail: {
      en: "Allocate+ manages your class timetable. Before semester starts you submit preferences for tutorials, labs and seminars; once allocation opens you can swap into other class times, view your final weekly schedule, and spot clashes before they happen.",
      zh: "管理课表分配。学期初填报 Tutorial/Lab/Seminar 时间段志愿（Preference）；分配开放后可换班捡漏、查看最终全周课表，并提前发现时间冲突。",
    },
    url: "https://allocate.monash.edu/",
    host: "allocate.monash.edu",
    faviconDomain: "monash.edu",
    category: "enrol",
  },
  {
    id: "attendance-my",
    name: { en: "Attendance (aPlus+)", zh: "Attendance 考勤签到" },
    desc: {
      en: "Malaysia campus check-in: enter the 5-digit class code each session to record attendance.",
      zh: "马来西亚校区 aPlus+ 考勤打卡：每节课输入 5 位 Code 记录出勤率。",
    },
    detail: {
      en: "aPlus+ attendance system for the Malaysia campus. Each class shows a 5-digit code on screen — enter it before the deadline to record attendance. Your attendance rate may affect exam eligibility, so check in every session.",
      zh: "马来西亚校区 aPlus+ 考勤系统。每节课屏幕会显示 5 位 Code，需在截止前输入打卡记录出勤。出勤率可能影响考试资格，切勿缺卡。",
    },
    url: "https://attendance.monash.edu.my/",
    host: "attendance.monash.edu.my",
    faviconDomain: "monash.edu.my",
    category: "enrol",
    badge: { en: "Malaysia", zh: "马来西亚校区" },
  },
  // — 课程 / 考试 —
  {
    id: "ed",
    name: { en: "Ed Discussion (EdStem)", zh: "Ed 课程答疑社区" },
    desc: {
      en: "Course Q&A and interactive coding assignments for IT, engineering and maths units.",
      zh: "IT/工程/数学等专业的日常讨论区：向老师与助教提问，完成交互式编程作业与 Quiz。",
    },
    detail: {
      en: "Ed is the discussion and assessment platform for many IT, engineering and maths units. Post questions publicly or anonymously, get answers from teaching staff, and complete interactive coding tasks, quizzes and auto-marked programming assignments in the browser.",
      zh: "IT/工程/数学等课程的讨论与评测平台。可公开或匿名发帖向老师/助教提问，也能在浏览器里完成交互式编程任务、Quiz 与自动评分的编程作业。",
    },
    url: "https://edstem.org/",
    host: "edstem.org",
    faviconDomain: "edstem.org",
    category: "learning",
  },
  {
    id: "eassessment",
    name: { en: "eAssessment · eExams", zh: "eAssessment 期末考试系统" },
    desc: {
      en: "Official platform for supervised online eExams and some on-campus computer-based exams.",
      zh: "期末线上受监考考试（Supervised eExam）及部分线下机考的官方答题平台。",
    },
    detail: {
      en: "Monash's official eAssessment platform. End-of-semester supervised eExams run here (with invigilation software), as do some on-campus computer-based tests. Check your exam timetable beforehand and complete the practice exam to get familiar with the interface.",
      zh: "官方期末考试平台。期末线上受监考考试（Supervised eExam）在此进行，也承载部分线下机考。考前确认考试时间表并完成练习考试（Practice Exam）以熟悉界面。",
    },
    url: "https://eassessment.monash.edu/",
    host: "eassessment.monash.edu",
    faviconDomain: "monash.edu",
    category: "learning",
  },
  {
    id: "special-consideration",
    name: { en: "Special Consideration", zh: "Special Consideration 特批申请" },
    desc: {
      en: "Apply for 2–5 day extensions or deferred exams when illness or misfortune affects assessment.",
      zh: "因病（凭 Medical Certificate）或突发事故申请作业延期 2~5 天，或期末缓考（DEF）。",
    },
    detail: {
      en: "Apply for Special Consideration when illness, injury or misfortune affects your assessment. With supporting evidence (e.g. a Medical Certificate) you can request a short extension (2–5 days) for an assignment, or a deferred exam (DEF) at the end of the exam period. Applications are assessed case by case — the earlier, the better.",
      zh: "当生病、受伤或突发事故影响学习时在此申请特批。凭医疗证明（Medical Certificate）等材料可申请作业延期 2~5 天，或考试季末的缓考（DEF）。逐案审批，越早申请越好。",
    },
    url: "https://special-consideration.monash.edu/",
    host: "special-consideration.monash.edu",
    faviconDomain: "monash.edu",
    category: "learning",
  },
  // — 咨询 / 图书馆 / 校园服务 —
  {
    id: "ask-monash",
    name: { en: "Ask.monash · Monash Connect", zh: "Ask.monash 综合咨询" },
    desc: {
      en: "Submit admin enquiries: enrolment changes, CoE, fee deadlines, credit for prior study.",
      zh: "向学校行政提交 Enquiry 工单：学籍变更、签证 CoE、延期缴费、免学分等事务。",
    },
    detail: {
      en: "The official student service desk. Submit an enquiry about enrolment changes, visa and CoE matters, fee payment extensions, credit for prior study, or anything administrative — and track the reply as a ticket. Monash Connect is the in-person counterpart on campus.",
      zh: "学生综合服务工单入口。学籍变更、签证与 CoE、延期缴费、免学分等行政事务都可提交 Enquiry 并追踪回复；Monash Connect 是对应的线下服务点。",
    },
    url: "https://ask.monash.edu/",
    host: "ask.monash.edu",
    faviconDomain: "monash.edu",
    category: "campus",
  },
  {
    id: "library",
    name: { en: "Monash Library", zh: "Monash 图书馆" },
    desc: {
      en: "Search journals, e-books and databases; book study spaces and discussion rooms.",
      zh: "检索学术论文与电子书库，在线预约图书馆自习室与讨论室（Study Spaces）。",
    },
    detail: {
      en: "Search across Monash's journal, e-book and database subscriptions; manage your loans; and book study spaces, discussion rooms and library workshops. Your Monash login gives you off-campus access to most subscribed resources.",
      zh: "检索 Monash 订阅的期刊、电子书与数据库，管理借阅，并在线预约自习室、讨论室与图书馆工作坊。用 Monash 账号登录即可在校外访问大部分订阅资源。",
    },
    url: "https://www.monash.edu/library",
    host: "monash.edu/library",
    faviconDomain: "monash.edu",
    category: "campus",
  },
  {
    id: "mpass",
    name: { en: "M-Pass", zh: "M-Pass 校园一卡通" },
    desc: {
      en: "Top up printing credit and add your digital campus card to Apple/Google Wallet.",
      zh: "充值打印复印余额，将数字校园卡绑定 Apple/Google Wallet 用于门禁与借书。",
    },
    detail: {
      en: "M-Pass is your campus ID. Top up credit for printing and copying on campus, add the digital card to Apple/Google Wallet, and use it for building access, borrowing books and student discounts. Lost your physical card? Block and replace it here.",
      zh: "M-Pass 是校园一卡通。充值打印复印余额、将数字卡绑定 Apple/Google Wallet，用于门禁、借书与学生优惠。实体卡丢了可在此挂失补办。",
    },
    url: "https://www.monash.edu/mpass",
    host: "monash.edu/mpass",
    faviconDomain: "monash.edu",
    category: "campus",
  },
  {
    id: "careerconnect",
    name: { en: "CareerConnect", zh: "CareerConnect 求职就业" },
    desc: {
      en: "Browse on-campus jobs and internships; book resume reviews and career consultations.",
      zh: "查看校内兼职与校外实习岗位，预约简历批改与一对一职业咨询。",
    },
    detail: {
      en: "Monash's career portal. Browse on-campus part-time jobs, internships and graduate programs, book one-on-one career consultations and resume reviews, and register for employer events and career workshops.",
      zh: "学校求职就业平台。浏览校内兼职、实习与校招项目，预约一对一职业咨询与简历批改（Resume Review），报名雇主宣讲会与求职工作坊。",
    },
    url: "https://careerconnect.monash.edu/",
    host: "careerconnect.monash.edu",
    faviconDomain: "monash.edu",
    category: "campus",
  },
  // — 第三方 / 社团 —
  {
    id: "studentvip",
    name: { en: "StudentVIP", zh: "StudentVIP 课程点评" },
    desc: {
      en: "Student-written course reviews and a campus map for finding exact rooms and buildings.",
      zh: "学长学姐给各门课的难度评分与避坑建议；Campus Map 精准导航建筑与教室。",
    },
    detail: {
      en: "A third-party (unofficial) student hub. The most-used features are course reviews written by students — difficulty, workload, teaching quality — and the campus map for finding buildings and room numbers. Great for choosing electives.",
      zh: "第三方（非官方）学生平台。最常用的是学长学姐写的课程点评——难度、工作量、教学质量——以及精准到教室的 Campus Map 地图。选修课前的避坑神器。",
    },
    url: "https://studentvip.com.au/",
    host: "studentvip.com.au",
    faviconDomain: "studentvip.com.au",
    category: "community",
  },
  {
    id: "monash-clubs",
    name: { en: "Monash Clubs", zh: "Monash Clubs 社团平台" },
    desc: {
      en: "Clubs and societies across Clayton and other Australian campuses.",
      zh: "Clayton（澳洲校区）学生社团总平台，浏览与加入各类社团。",
    },
    detail: {
      en: "The central directory of student clubs and societies across Australian campuses — academic, cultural, sport, faith and special-interest groups. Membership usually costs a few dollars a year and unlocks events, competitions and free food.",
      zh: "澳洲校区学生社团总目录——学术、文化、体育、兴趣等各类社团一网打尽。入会通常一年几澳元，可解锁活动、比赛与免费食物。",
    },
    url: "https://monashclubs.org/",
    host: "monashclubs.org",
    faviconDomain: "monashclubs.org",
    category: "community",
  },
  {
    id: "monsu",
    name: { en: "MONSU", zh: "MONSU 学生会" },
    desc: {
      en: "Monash Student Union (Caulfield): events, student services and representation.",
      zh: "Caulfield 校区学生会：活动、服务与学生权益代表。",
    },
    detail: {
      en: "The Monash Student Union serving Caulfield (and Peninsula) students: orientation events, free breakfasts, advocacy and academic-appeal support, clubs administration and a second-hand bookshop.",
      zh: "服务 Caulfield（及 Peninsula）校区的学生会：迎新活动、免费早餐、学业申诉支持与 advocacy、社团管理及二手书店。",
    },
    url: "https://monsu.org/",
    host: "monsu.org",
    faviconDomain: "monsu.org",
    category: "community",
  },
  {
    id: "musa",
    name: { en: "MUSA", zh: "MUSA 学生会" },
    desc: {
      en: "Monash University Student Association — Malaysia campus.",
      zh: "马来西亚校区学生会（MUSA）。",
    },
    detail: {
      en: "The Monash University Student Association — the student body for the Malaysia campus. Runs orientation, cultural festivals and sports tournaments, and represents student interests to the university.",
      zh: "马来西亚校区的学生联合会。运营迎新、文化节与体育联赛，并向校方反映学生诉求。",
    },
    url: "https://musa.monash.edu.my/",
    host: "musa.monash.edu.my",
    faviconDomain: "monash.edu.my",
    category: "community",
    badge: { en: "Malaysia", zh: "马来西亚校区" },
  },
];

// Category → concrete Tailwind classes. Written out explicitly (not dynamic
// strings) so Tailwind's scanner keeps every variant in the bundle.
const ACCENT_STYLES: Record<string, { chip: string; tile: string }> = {
  indigo: {
    chip: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
    tile: "bg-indigo-50 dark:bg-indigo-500/15",
  },
  emerald: {
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    tile: "bg-emerald-50 dark:bg-emerald-500/15",
  },
  violet: {
    chip: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
    tile: "bg-violet-50 dark:bg-violet-500/15",
  },
  sky: {
    chip: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
    tile: "bg-sky-50 dark:bg-sky-500/15",
  },
  rose: {
    chip: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
    tile: "bg-rose-50 dark:bg-rose-500/15",
  },
};

/** Simplified Monash-style crest: an "M" shield used when a favicon can't be loaded. */
function MonashCrest({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label="Monash crest">
      <path
        d="M12 1.5 21 5v7.2c0 5.3-3.6 8.7-9 10.3-5.4-1.6-9-5-9-10.3V5l9-3.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 16V8.6l2.9 3.7 2.6-3.7 2.6 3.7 2.9-3.7V16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Favicon with graceful degradation: DuckDuckGo icon service → Monash crest SVG. */
function SiteIcon({ site, className }: { site: SiteLink; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <MonashCrest className={`${className ?? ""} text-primary`} />;
  }
  return (
    <img
      src={`https://icons.duckduckgo.com/ip3/${site.faviconDomain}.ico`}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}

function pick(lang: Language, l: L): string {
  if (lang === "zh") return l.zh;
  return l.en; // en / ja / ko → English source strings
}

/** Centered info dialog for a site. Closes on backdrop click / ESC. */
function SiteInfoModal({
  site,
  onClose,
  onOpenSite,
  lang,
}: {
  site: SiteLink;
  onClose: () => void;
  onOpenSite: (url: string) => void;
  lang: Language;
}) {
  const cat = CATEGORIES.find((c) => c.id === site.category)!;
  const styles = ACCENT_STYLES[cat.accent];

  return (
    <AnimatePresence>
      {/* Backdrop — clicking anywhere outside closes the dialog */}
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Panel — centered, same motion language as ui/dialog */}
      <motion.div
        key="panel"
        role="dialog"
        aria-modal="true"
        aria-label={pick(lang, site.name)}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-background shadow-2xl flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="p-5 border-b shrink-0">
          <div className="flex items-start gap-3">
            <span className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 overflow-hidden ${styles.tile}`}>
              <SiteIcon site={site} className="w-7 h-7 object-contain" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-semibold leading-snug">{pick(lang, site.name)}</p>
              <p className="text-xs text-muted-foreground truncate mt-0.5">{site.host}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
              <X className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${styles.chip}`}>
              <cat.icon className="w-3.5 h-3.5" />
              {pick(lang, cat.name)}
            </span>
            {site.badge && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground">
                {pick(lang, site.badge)}
              </span>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            {lang === "zh" ? "这个网站是做什么的" : "What this site is for"}
          </h4>
          <p className="text-sm leading-relaxed text-foreground/90">{pick(lang, site.detail)}</p>
        </div>

        {/* Footer */}
        <div className="p-5 border-t shrink-0">
          <Button
            className="w-full gap-2"
            onClick={() => onOpenSite(site.url)}
          >
            <ExternalLink className="w-4 h-4" />
            {lang === "zh" ? "打开网站" : "Open website"}
          </Button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

export function LinksPage({ onBack }: LinksPageProps) {
  const { t, lang } = useTranslation();
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<CategoryId | "all">("all");
  const [drawerSite, setDrawerSite] = useState<SiteLink | null>(null);

  // ESC closes the info drawer
  useEffect(() => {
    if (!drawerSite) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerSite(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerSite]);

  const visibleCategories = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CATEGORIES.map((cat) => ({
      cat,
      sites: SITES.filter(
        (s) =>
          s.category === cat.id &&
          (activeCategory === "all" || activeCategory === cat.id) &&
          (q === "" ||
            s.name.en.toLowerCase().includes(q) ||
            s.name.zh.toLowerCase().includes(q) ||
            s.desc.en.toLowerCase().includes(q) ||
            s.desc.zh.toLowerCase().includes(q) ||
            s.host.toLowerCase().includes(q))
      ),
    })).filter((g) => g.sites.length > 0);
  }, [query, activeCategory]);

  const handleOpen = async (url: string) => {
    try {
      await openUrl(url);
    } catch {
      // silent — opening a link is non-critical
    }
  };

  return (
    <div className="h-screen overflow-hidden bg-background flex">
      {/* Sidebar — same shell pattern as AssignmentsPage / SettingsPage */}
      <motion.aside
        initial={{ x: -280 }}
        animate={{ x: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
        className="w-72 shrink-0 h-full glass border-r flex flex-col"
      >
        <div className="p-4 border-b shrink-0">
          <Button variant="ghost" onClick={onBack} className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            {t("common.back")}
          </Button>
        </div>

        <div className="p-4 shrink-0">
          <h2 className="font-bold text-lg">{t("nav.links")}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {lang === "zh"
              ? "Monash 学生常用网站合集"
              : "Essential websites for Monash students"}
          </p>
        </div>

        {/* Category filter */}
        <nav className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1" aria-label={t("nav.links")}>
          <button
            onClick={() => setActiveCategory("all")}
            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-colors duration-200 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${
              activeCategory === "all"
                ? "nav-active font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
            }`}
          >
            <Globe className="w-4 h-4 shrink-0" />
            <span>{lang === "zh" ? "全部分类" : "All categories"}</span>
            <span className="ml-auto text-xs text-muted-foreground">{SITES.length}</span>
          </button>
          {CATEGORIES.map((cat) => {
            const count = SITES.filter((s) => s.category === cat.id).length;
            const styles = ACCENT_STYLES[cat.accent];
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-colors duration-200 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${
                  activeCategory === cat.id
                    ? "nav-active font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                }`}
              >
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${styles.tile}`}>
                  <cat.icon className={`w-4 h-4 ${styles.chip.split(" ")[1]}`} />
                </span>
                <span className="text-left truncate">{pick(lang, cat.name)}</span>
                <span className="ml-auto text-xs text-muted-foreground">{count}</span>
              </button>
            );
          })}
        </nav>
      </motion.aside>

      {/* Main content */}
      <main id="main-content" className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Search header */}
        <div className="p-6 pb-4 shrink-0">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h3 className="font-bold text-lg">{t("nav.links")}</h3>
              <p className="text-sm text-muted-foreground">
                {lang === "zh"
                  ? "点击卡片打开网站，点右上角 ⓘ 查看说明"
                  : "Click a card to open the site; the info button shows what it's for"}
              </p>
            </div>
            <div className="relative w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={lang === "zh" ? "搜索网站…" : "Search sites…"}
                className="pl-9 pr-8"
                aria-label={lang === "zh" ? "搜索网站" : "Search sites"}
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                  aria-label={t("common.cancel")}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Card grid — scrollable */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 space-y-8">
          {visibleCategories.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Search className="w-10 h-10 text-muted-foreground/40 mb-4" />
              <p className="text-sm text-muted-foreground">
                {lang === "zh" ? "没有匹配的网站" : "No matching sites"}
              </p>
            </div>
          )}

          {visibleCategories.map(({ cat, sites }, groupIdx) => {
            const styles = ACCENT_STYLES[cat.accent];
            return (
              <section key={cat.id} aria-labelledby={`links-cat-${cat.id}`}>
                <div className="flex items-center gap-2.5 mb-3">
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${styles.tile}`}>
                    <cat.icon className={`w-4 h-4 ${styles.chip.split(" ")[1]}`} />
                  </span>
                  <h4 id={`links-cat-${cat.id}`} className="font-semibold text-sm">
                    {pick(lang, cat.name)}
                  </h4>
                  <span className="text-xs text-muted-foreground">{sites.length}</span>
                  <div className="flex-1 h-px bg-border/60" />
                </div>

                {cat.note && (
                  <p className="text-xs text-muted-foreground/90 mb-3 leading-relaxed">
                    {pick(lang, cat.note)}
                  </p>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {sites.map((site, i) => (
                    <motion.div
                      key={site.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, delay: Math.min(groupIdx * 0.05 + i * 0.03, 0.4) }}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleOpen(site.url)}
                      onKeyDown={(e) => {
                        // Enter/Space on the focused card = open the site.
                        // The info button stops propagation on keydown too, so a
                        // focused info button never double-triggers the card.
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleOpen(site.url);
                        }
                      }}
                      className="group rounded-2xl border bg-card text-card-foreground shadow-lg hover:shadow-xl hover:border-primary/40 transition-[box-shadow,border-color] duration-200 cursor-pointer p-4 flex flex-col gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                      aria-label={`${pick(lang, site.name)} (${site.host})`}
                    >
                      <div className="flex items-start gap-3">
                        <span className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 overflow-hidden ${styles.tile}`}>
                          <SiteIcon site={site} className="w-6 h-6 object-contain" />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm leading-snug truncate">
                            {pick(lang, site.name)}
                          </p>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{site.host}</p>
                        </div>
                        {/* Info button — opens the explainer drawer (does NOT open the site) */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDrawerSite(site);
                          }}
                          onKeyDown={(e) => e.stopPropagation()}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground/60 hover:text-primary hover:bg-primary/10 shrink-0 transition-colors duration-200 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                          aria-label={
                            lang === "zh"
                              ? `查看 ${pick(lang, site.name)} 的说明`
                              : `About ${pick(lang, site.name)}`
                          }
                        >
                          <Info className="w-4 h-4" />
                        </button>
                      </div>

                      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                        {pick(lang, site.desc)}
                      </p>

                      {site.badge && (
                        <span className="self-start text-[11px] px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                          {pick(lang, site.badge)}
                        </span>
                      )}
                    </motion.div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </main>

      {/* Site info dialog (centered) */}
      {drawerSite && (
        <SiteInfoModal
          site={drawerSite}
          lang={lang}
          onClose={() => setDrawerSite(null)}
          onOpenSite={handleOpen}
        />
      )}
    </div>
  );
}

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
// Data model — all display strings live here, fully localized in en/zh/ja/ko.
// ---------------------------------------------------------------------------

type CategoryId = "portal" | "enrol" | "learning" | "campus" | "community";

type L = { en: string; zh: string; ja: string; ko: string };

interface SiteLink {
  id: string;
  name: L;
  desc: L;
  /** Longer explainer shown in the info dialog. */
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

// Page-level UI strings (kept alongside the data so this file stays self-contained)
const UI = {
  sidebarSubtitle: {
    en: "Essential websites for Monash students",
    zh: "Monash 学生常用网站合集",
    ja: "Monash 学生のための必須サイト集",
    ko: "Monash 학생 필수 사이트 모음",
  },
  headerSubtitle: {
    en: "Click a card to open the site; the info button shows what it's for",
    zh: "点击卡片打开网站，点右上角 ⓘ 查看说明",
    ja: "カードをクリックでサイトを開く、ⓘ で説明を表示",
    ko: "카드를 클릭하면 사이트가 열리고, ⓘ를 누르면 설명이 표시됩니다",
  },
  searchPlaceholder: {
    en: "Search sites…",
    zh: "搜索网站…",
    ja: "サイトを検索…",
    ko: "사이트 검색…",
  },
  searchAria: {
    en: "Search sites",
    zh: "搜索网站",
    ja: "サイトを検索",
    ko: "사이트 검색",
  },
  allCategories: {
    en: "All categories",
    zh: "全部分类",
    ja: "すべてのカテゴリ",
    ko: "전체 카테고리",
  },
  noMatch: {
    en: "No matching sites",
    zh: "没有匹配的网站",
    ja: "一致するサイトがありません",
    ko: "일치하는 사이트가 없습니다",
  },
  detailHeading: {
    en: "What this site is for",
    zh: "这个网站是做什么的",
    ja: "このサイトの用途",
    ko: "이 사이트의 용도",
  },
  openWebsite: {
    en: "Open website",
    zh: "打开网站",
    ja: "サイトを開く",
    ko: "사이트 열기",
  },
  infoAria: {
    en: "About",
    zh: "查看说明",
    ja: "詳細を見る",
    ko: "설명 보기",
  },
} satisfies Record<string, L>;

const CATEGORIES: Category[] = [
  {
    id: "portal",
    name: {
      en: "Official Portal",
      zh: "官方统一门户",
      ja: "公式ポータル",
      ko: "공식 포털",
    },
    accent: "indigo",
    icon: Globe,
  },
  {
    id: "enrol",
    name: {
      en: "Enrolment & Timetable",
      zh: "选课 · 排课 · 考勤",
      ja: "履修登録 · 時間割 · 出席",
      ko: "수강신청 · 시간표 · 출석",
    },
    accent: "emerald",
    icon: CalendarCheck,
    note: {
      en: "Australia campus attendance has no standalone website — check in via the QR code in each unit, or tap M-Pass at building entrances.",
      zh: "澳洲校区考勤无独立网站：在课程内扫二维码签到，或进实验楼时刷 M-Pass 门禁。",
      ja: "オーストラリアキャンパスの出席登録に専用サイトはありません。各ユニット内の QR コード、または建物入口の M-Pass でチェックインしてください。",
      ko: "호주 캠퍼스 출석은 별도 웹사이트가 없습니다. 각 강좌 내 QR코드로 체크인하거나 건물 입구에서 M-Pass를 태그하세요.",
    },
  },
  {
    id: "learning",
    name: {
      en: "Learning & Exams",
      zh: "课程 · 考试",
      ja: "授業 · 試験",
      ko: "수업 · 시험",
    },
    accent: "violet",
    icon: GraduationCap,
  },
  {
    id: "campus",
    name: {
      en: "Campus Services",
      zh: "咨询 · 图书馆 · 校园服务",
      ja: "相談 · 図書館 · キャンパスサービス",
      ko: "문의 · 도서관 · 캠퍼스 서비스",
    },
    accent: "sky",
    icon: Building2,
  },
  {
    id: "community",
    name: {
      en: "Community & Societies",
      zh: "第三方 · 社团",
      ja: "コミュニティ · サークル",
      ko: "커뮤니티 · 동아리",
    },
    accent: "rose",
    icon: Users,
  },
];

const SITES: SiteLink[] = [
  // — 官方统一门户 —
  {
    id: "student-portal",
    name: {
      en: "Student Portal",
      zh: "Student Portal 官方门户",
      ja: "Student Portal（公式ポータル）",
      ko: "Student Portal(공식 포털)",
    },
    desc: {
      en: "One-stop student homepage: timetable, calendar, announcements and shortcuts to WES and other systems.",
      zh: "学校官方一站式学生主页：课表日历、重要通知，以及 WES 等各类系统的直接跳转入口。",
      ja: "公式の学生ホームページ：時間割・カレンダー・お知らせ、WES など各システムへのショートカットを一箇所に。",
      ko: "공식 올인원 학생 홈페이지: 시간표, 캘린더, 공지사항과 WES 등 시스템 바로가기를 한곳에.",
    },
    detail: {
      en: "The official one-stop student homepage. It aggregates your timetable, calendar, key announcements and deadlines, and provides direct shortcuts to WES, Allocate+, results release and other Monash systems — the first place to check each morning.",
      zh: "学校官方一站式学生主页。汇总课表日历、重要通知与截止日期，并提供 WES、Allocate+、出分查询等各类系统的直接跳转入口——每天早上先看这里。",
      ja: "公式の学生ポータル。時間割・カレンダー・重要なお知らせ・締め切りをまとめ、WES・Allocate+・成績発表などのシステムへ直接アクセスできます。毎朝まず確認する場所です。",
      ko: "공식 학생 포털입니다. 시간표, 캘린더, 주요 공지와 마감일을 한곳에 모으고 WES, Allocate+, 성적 확인 등 시스템으로 바로 이동할 수 있습니다. 매일 아침 가장 먼저 확인하는 곳입니다.",
    },
    url: "https://student.monash.edu/",
    host: "student.monash.edu",
    faviconDomain: "monash.edu",
    category: "portal",
  },
  // — 选课 / 排课 / 考勤 —
  {
    id: "wes",
    name: {
      en: "WES · Web Enrolment System",
      zh: "WES 选课与学籍系统",
      ja: "WES（履修登録システム）",
      ko: "WES(수강신청 시스템)",
    },
    desc: {
      en: "Enrol or drop units, view official results and WAM, download fee statements, request transcripts.",
      zh: "每学期选课/退课、期末官方出分（Results/WAM）、下载学费单、申请在读证明与成绩单。",
      ja: "履修登録・取消、正式な成績と WAM の確認、学費明細のダウンロード、証明書の申請。",
      ko: "수강신청/취소, 공식 성적 및 WAM 확인, 등록금 명세서 다운로드, 증명서 신청.",
    },
    detail: {
      en: "Web Enrolment System — the official academic-record console. Use it to enrol into or discontinue units each semester, view released final results and your WAM (Weighted Average Mark), download fee statements, and request official documents such as enrolment statements and academic transcripts.",
      zh: "官方学籍系统。每学期选课/退课、查看期末正式出分与 WAM 加权平均分、下载学费单（Fee Statement），以及申请在读证明与官方成绩单。",
      ja: "Web Enrolment System — 公式の学籍コンソール。学期ごとの履修登録・取消、正式な成績と WAM（加重平均点）の確認、学費明細のダウンロード、在学証明書や成績証明書の申請ができます。",
      ko: "Web Enrolment System — 공식 학적 시스템입니다. 학기별 수강신청/취소, 정식 성적과 WAM(가중 평균 점수) 확인, 등록금 명세서 다운로드, 재학증명서와 성적증명서 신청이 가능합니다.",
    },
    url: "https://wes.monash.edu/",
    host: "wes.monash.edu",
    faviconDomain: "monash.edu",
    category: "enrol",
  },
  {
    id: "allocate",
    name: {
      en: "Allocate+",
      zh: "Allocate+ 排课系统",
      ja: "Allocate+（時間割割り当て）",
      ko: "Allocate+(시간표 시스템)",
    },
    desc: {
      en: "Submit tutorial/lab preferences at semester start, then swap classes and view your weekly timetable.",
      zh: "学期初填报 Tutorial/Lab 时间段志愿，开放后换班捡漏、调整课表并查看全周日程。",
      ja: "学期開始前にチュートリアル/実習の希望を提出し、開放後にクラス変更や週間時間割の確認ができます。",
      ko: "학기 시작 전 튜토리얼/랩 희망을 제출하고, 개설 후에는 반 변경과 주간 시간표를 확인합니다.",
    },
    detail: {
      en: "Allocate+ manages your class timetable. Before semester starts you submit preferences for tutorials, labs and seminars; once allocation opens you can swap into other class times, view your final weekly schedule, and spot clashes before they happen.",
      zh: "管理课表分配。学期初填报 Tutorial/Lab/Seminar 时间段志愿（Preference）；分配开放后可换班捡漏、查看最终全周课表，并提前发现时间冲突。",
      ja: "Allocate+ はクラス時間割を管理します。学期前にチュートリアル・ラボ・セミナーの希望（Preference）を提出し、割り当て開放後は他の時間帯へ変更、最終的な週間時間割の確認、時間衝突の事前発見ができます。",
      ko: "Allocate+는 수업 시간표를 관리합니다. 학기 시작 전 튜토리얼·랩·세미나 희망(Preference)을 제출하고, 배정이 열리면 다른 시간대로 변경하거나 최종 주간 시간표를 확인하고 시간 충돌을 미리 발견할 수 있습니다.",
    },
    url: "https://allocate.monash.edu/",
    host: "allocate.monash.edu",
    faviconDomain: "monash.edu",
    category: "enrol",
  },
  {
    id: "attendance-my",
    name: {
      en: "Attendance (aPlus+)",
      zh: "Attendance 考勤签到",
      ja: "Attendance（aPlus+ 出席確認）",
      ko: "Attendance(aPlus+ 출석 체크)",
    },
    desc: {
      en: "Malaysia campus check-in: enter the 5-digit class code each session to record attendance.",
      zh: "马来西亚校区 aPlus+ 考勤打卡：每节课输入 5 位 Code 记录出勤率。",
      ja: "マレーシアキャンパスの出席チェックイン：毎回の授業で 5 桁のコードを入力して出席を記録。",
      ko: "말레이시아 캠퍼스 출석 체크: 매 수업마다 5자리 코드를 입력해 출석을 기록합니다.",
    },
    detail: {
      en: "aPlus+ attendance system for the Malaysia campus. Each class shows a 5-digit code on screen — enter it before the deadline to record attendance. Your attendance rate may affect exam eligibility, so check in every session.",
      zh: "马来西亚校区 aPlus+ 考勤系统。每节课屏幕会显示 5 位 Code，需在截止前输入打卡记录出勤。出勤率可能影响考试资格，切勿缺卡。",
      ja: "マレーシアキャンパス用の aPlus+ 出席システム。授業ごとに画面に表示される 5 桁のコードを締め切り前に入力して出席を記録します。出席率は試験受験資格に影響する場合があるため、毎回の出席登録を怠らずに。",
      ko: "말레이시아 캠퍼스용 aPlus+ 출석 시스템입니다. 수업마다 화면에 표시되는 5자리 코드를 마감 전에 입력해 출석을 기록합니다. 출석률은 시험 응시 자격에 영향을 줄 수 있으므로 매 수업마다 체크인하세요.",
    },
    url: "https://attendance.monash.edu.my/",
    host: "attendance.monash.edu.my",
    faviconDomain: "monash.edu.my",
    category: "enrol",
    badge: {
      en: "Malaysia",
      zh: "马来西亚校区",
      ja: "マレーシア",
      ko: "말레이시아 캠퍼스",
    },
  },
  // — 课程 / 考试 —
  {
    id: "ed",
    name: {
      en: "Ed Discussion (EdStem)",
      zh: "Ed 课程答疑社区",
      ja: "Ed Discussion（授業 Q&A）",
      ko: "Ed Discussion(수업 Q&A)",
    },
    desc: {
      en: "Course Q&A and interactive coding assignments for IT, engineering and maths units.",
      zh: "IT/工程/数学等专业的日常讨论区：向老师与助教提问，完成交互式编程作业与 Quiz。",
      ja: "IT・工学・数学系コースの質問コミュニティ。ブラウザ上でインタラクティブなプログラミング課題やクイズも完成できます。",
      ko: "IT·공학·수학 과목의 질의응답 커뮤니티. 브라우저에서 인터랙티브 코딩 과제와 퀴즈도 수행합니다.",
    },
    detail: {
      en: "Ed is the discussion and assessment platform for many IT, engineering and maths units. Post questions publicly or anonymously, get answers from teaching staff, and complete interactive coding tasks, quizzes and auto-marked programming assignments in the browser.",
      zh: "IT/工程/数学等课程的讨论与评测平台。可公开或匿名发帖向老师/助教提问，也能在浏览器里完成交互式编程任务、Quiz 与自动评分的编程作业。",
      ja: "Ed は多くの IT・工学・数学系ユニットで使われるディスカッション&課題プラットフォーム。公開または匿名で質問でき、教員や TA から回答を受け、ブラウザ上でインタラクティブなコーディング課題・クイズ・自動採点のプログラミング課題を完成できます。",
      ko: "Ed는 IT·공학·수학 과목에서 사용하는 토론·과제 플랫폼입니다. 공개 또는 익명으로 질문하고 교수진/TA의 답변을 받으며, 브라우저에서 인터랙티브 코딩 과제, 퀴즈, 자동 채점 프로그래밍 과제를 수행할 수 있습니다.",
    },
    url: "https://edstem.org/",
    host: "edstem.org",
    faviconDomain: "edstem.org",
    category: "learning",
  },
  {
    id: "eassessment",
    name: {
      en: "eAssessment · eExams",
      zh: "eAssessment 期末考试系统",
      ja: "eAssessment（オンライン試験）",
      ko: "eAssessment(온라인 시험)",
    },
    desc: {
      en: "Official platform for supervised online eExams and some on-campus computer-based exams.",
      zh: "期末线上受监考考试（Supervised eExam）及部分线下机考的官方答题平台。",
      ja: "監督付きオンライン試験（Supervised eExam）および一部の学内 CBT の公式プラットフォーム。",
      ko: "감독 온라인 시험(Supervised eExam) 및 일부 교내 CBT의 공식 플랫폼.",
    },
    detail: {
      en: "Monash's official eAssessment platform. End-of-semester supervised eExams run here (with invigilation software), as do some on-campus computer-based tests. Check your exam timetable beforehand and complete the practice exam to get familiar with the interface.",
      zh: "官方期末考试平台。期末线上受监考考试（Supervised eExam）在此进行，也承载部分线下机考。考前确认考试时间表并完成练习考试（Practice Exam）以熟悉界面。",
      ja: "Monash 公式の eAssessment プラットフォーム。学期末の監督付きオンライン試験や一部の学内コンピュータ試験を実施。試験前に時間割を確認し、Practice Exam で操作に慣れておきましょう。",
      ko: "Monash 공식 시험 플랫폼입니다. 학기 말의 감독 온라인 시험과 일부 교내 컴퓨터 시험이 여기서 진행됩니다. 시험 전에 시험 일정을 확인하고 Practice Exam으로 조작에 익숙해지세요.",
    },
    url: "https://eassessment.monash.edu/",
    host: "eassessment.monash.edu",
    faviconDomain: "monash.edu",
    category: "learning",
  },
  {
    id: "special-consideration",
    name: {
      en: "Special Consideration",
      zh: "Special Consideration 特批申请",
      ja: "Special Consideration（特別配慮申請）",
      ko: "Special Consideration(특별 고려 신청)",
    },
    desc: {
      en: "Apply for 2–5 day extensions or deferred exams when illness or misfortune affects assessment.",
      zh: "因病（凭 Medical Certificate）或突发事故申请作业延期 2~5 天，或期末缓考（DEF）。",
      ja: "病気などのやむを得ない事情で課題期限延長（2〜5 日）や追試（DEF）を申請。",
      ko: "질병 등 부득이한 사정으로 과제 연장(2~5일) 또는 대체 시험(DEF)을 신청합니다.",
    },
    detail: {
      en: "Apply for Special Consideration when illness, injury or misfortune affects your assessment. With supporting evidence (e.g. a Medical Certificate) you can request a short extension (2–5 days) for an assignment, or a deferred exam (DEF) at the end of the exam period. Applications are assessed case by case — the earlier, the better.",
      zh: "当生病、受伤或突发事故影响学习时在此申请特批。凭医疗证明（Medical Certificate）等材料可申请作业延期 2~5 天，或考试季末的缓考（DEF）。逐案审批，越早申请越好。",
      ja: "病気・けが・不幸な出来事が学業に影響した場合の特別配慮を申請します。医療証明書などの証拠を添えて、課題の短期延長（2〜5 日）や試験期間末の追試（DEF）をリクエストできます。個別審査のため、できるだけ早く申請を。",
      ko: "질병, 부상 등 불운한 사정이 학업에 영향을 줄 때 특별 고려를 신청합니다. 진단서 등 증빙을 첨부해 과제 단기 연장(2~5일) 또는 시험 기간 말의 대체 시험(DEF)을 요청할 수 있습니다. 개별 심사이므로 최대한 빨리 신청하세요.",
    },
    url: "https://special-consideration.monash.edu/",
    host: "special-consideration.monash.edu",
    faviconDomain: "monash.edu",
    category: "learning",
  },
  // — 咨询 / 图书馆 / 校园服务 —
  {
    id: "ask-monash",
    name: {
      en: "Ask.monash · Monash Connect",
      zh: "Ask.monash 综合咨询",
      ja: "Ask.monash（総合相談窓口）",
      ko: "Ask.monash(종합 문의)",
    },
    desc: {
      en: "Submit admin enquiries: enrolment changes, CoE, fee deadlines, credit for prior study.",
      zh: "向学校行政提交 Enquiry 工单：学籍变更、签证 CoE、延期缴费、免学分等事务。",
      ja: "学籍変更、ビザ・CoE、学費支払い延長、単位認定などの事務質問をチケットで申請・追跡。",
      ko: "학적 변경, 비자·CoE, 등록금 납부 연장, 학점 인정 등 행정 문의를 티켓으로 제출·추적합니다.",
    },
    detail: {
      en: "The official student service desk. Submit an enquiry about enrolment changes, visa and CoE matters, fee payment extensions, credit for prior study, or anything administrative — and track the reply as a ticket. Monash Connect is the in-person counterpart on campus.",
      zh: "学生综合服务工单入口。学籍变更、签证与 CoE、延期缴费、免学分等行政事务都可提交 Enquiry 并追踪回复；Monash Connect 是对应的线下服务点。",
      ja: "公式の学生サービス窓口。履修登録変更、ビザや CoE、学費支払い延長、単位認定などの事務的な問い合わせをチケットとして提出し、返信を追跡できます。対面窓口は Monash Connect です。",
      ko: "공식 학생 서비스 창구입니다. 수강신청 변경, 비자·CoE, 등록금 납부 연장, 학점 인정 등 행정 문의를 티켓으로 제출하고 답변을 추적할 수 있습니다. 대면 창구는 Monash Connect입니다.",
    },
    url: "https://ask.monash.edu/",
    host: "ask.monash.edu",
    faviconDomain: "monash.edu",
    category: "campus",
  },
  {
    id: "library",
    name: {
      en: "Monash Library",
      zh: "Monash 图书馆",
      ja: "Monash Library（図書館）",
      ko: "Monash Library(도서관)",
    },
    desc: {
      en: "Search journals, e-books and databases; book study spaces and discussion rooms.",
      zh: "检索学术论文与电子书库，在线预约图书馆自习室与讨论室（Study Spaces）。",
      ja: "論文・電子書籍・データベースの検索、学習室・グループ討論室の予約。",
      ko: "논문·전자책·데이터베이스 검색, 학습실·토론실 예약.",
    },
    detail: {
      en: "Search across Monash's journal, e-book and database subscriptions; manage your loans; and book study spaces, discussion rooms and library workshops. Your Monash login gives you off-campus access to most subscribed resources.",
      zh: "检索 Monash 订阅的期刊、电子书与数据库，管理借阅，并在线预约自习室、讨论室与图书馆工作坊。用 Monash 账号登录即可在校外访问大部分订阅资源。",
      ja: "Monash が契約するジャーナル・電子書籍・データ베ースを横断検索し、貸出の管理や学習室・ディスカッションルーム・ワークショップの予約ができます。Monash アカウントで学外からも大部分の契約リソースにアクセス可能。",
      ko: "Monash이 구독하는 저널·전자책·데이터베이스를 통합 검색하고, 대출 관리와 학습실·토론실·워크숍 예약이 가능합니다. Monash 계정으로 교외에서도 대부분의 구독 자료에 접근할 수 있습니다.",
    },
    url: "https://www.monash.edu/library",
    host: "monash.edu/library",
    faviconDomain: "monash.edu",
    category: "campus",
  },
  {
    id: "mpass",
    name: {
      en: "M-Pass",
      zh: "M-Pass 校园一卡通",
      ja: "M-Pass（キャンパスカード）",
      ko: "M-Pass(캠퍼스 카드)",
    },
    desc: {
      en: "Top up printing credit and add your digital campus card to Apple/Google Wallet.",
      zh: "充值打印复印余额，将数字校园卡绑定 Apple/Google Wallet 用于门禁与借书。",
      ja: "印刷用残高のチャージ、デジタル学生証を Apple/Google Wallet に追加。",
      ko: "인쇄 잔액 충전, 디지털 학생증을 Apple/Google Wallet에 추가.",
    },
    detail: {
      en: "M-Pass is your campus ID. Top up credit for printing and copying on campus, add the digital card to Apple/Google Wallet, and use it for building access, borrowing books and student discounts. Lost your physical card? Block and replace it here.",
      zh: "M-Pass 是校园一卡通。充值打印复印余额、将数字卡绑定 Apple/Google Wallet，用于门禁、借书与学生优惠。实体卡丢了可在此挂失补办。",
      ja: "M-Pass はキャンパス ID。学内の印刷・コピー用残高チャージ、Apple/Google Wallet へのデジタルカード追加、建物入場・図書貸出・学生割引に利用。紛失時はここでブロック・再発行できます。",
      ko: "M-Pass는 캠퍼스 ID입니다. 교내 인쇄·복사 잔액 충전, Apple/Google Wallet에 디지털 카드 추가, 건물 출입·도서 대출·학생 할인에 사용합니다. 분실 시 여기서 정지·재발급할 수 있습니다.",
    },
    url: "https://www.monash.edu/mpass",
    host: "monash.edu/mpass",
    faviconDomain: "monash.edu",
    category: "campus",
  },
  {
    id: "careerconnect",
    name: {
      en: "CareerConnect",
      zh: "CareerConnect 求职就业",
      ja: "CareerConnect（キャリア支援）",
      ko: "CareerConnect(커리어 지원)",
    },
    desc: {
      en: "Browse on-campus jobs and internships; book resume reviews and career consultations.",
      zh: "查看校内兼职与校外实习岗位，预约简历批改与一对一职业咨询。",
      ja: "学内アルバイト・インターンシップの閲覧、履歴書添削やキャリア相談の予約。",
      ko: "교내 아르바이트·인턴십 조회, 이력서 첨삭 및 커리어 상담 예약.",
    },
    detail: {
      en: "Monash's career portal. Browse on-campus part-time jobs, internships and graduate programs, book one-on-one career consultations and resume reviews, and register for employer events and career workshops.",
      zh: "学校求职就业平台。浏览校内兼职、实习与校招项目，预约一对一职业咨询与简历批改（Resume Review），报名雇主宣讲会与求职工作坊。",
      ja: "Monash のキャリアポータル。学内アルバイト・インターン・新卒プログラムの閲覧、1 対 1 のキャリア相談や履歴書添削の予約、企業説明会やワークショップへの登録ができます。",
      ko: "Monash의 커리어 포털입니다. 교내 아르바이트·인턴십·신입 채용 프로그램 조회, 1:1 커리어 상담과 이력서 첨삭 예약, 기업 설명회·워크숍 등록이 가능합니다.",
    },
    url: "https://careerconnect.monash.edu/",
    host: "careerconnect.monash.edu",
    faviconDomain: "monash.edu",
    category: "campus",
  },
  {
    id: "fees",
    name: {
      en: "Fees & Payments",
      zh: "学费与缴费（澳洲校区）",
      ja: "学費・支払い（オーストラリア）",
      ko: "등록금·납부(호주 캠퍼스)",
    },
    desc: {
      en: "Official fees hub for current students: fee statements, due dates, payment options and refunds.",
      zh: "在校生官方学费中心：学费单查询、缴费截止日期、支付方式与退费政策。",
      ja: "在学生向け公式学費センター：学費明細、支払期限、支払い方法、返金ポリシー。",
      ko: "재학생 공식 등록금 센터: 등록금 명세서, 납부 기한, 납부 방법, 환불 정책.",
    },
    detail: {
      en: "The central fees page for current students. View and download your fee statement, check payment due dates, compare accepted payment methods, and read the refund and deferral policies before you pay.",
      zh: "在校生学费总页面。查看与下载学费单（Fee Statement）、确认缴费截止日期、比对支持的支付方式，并在缴费前了解退费与缓缴政策。",
      ja: "在学生向けの学費総合ページ。学費明細（Fee Statement）の確認・ダウンロード、支払期限の確認、対応する支払い方法の比較、支払い前の返金・猶予ポリシーの確認ができます。",
      ko: "재학생 등록금 종합 페이지입니다. 등록금 명세서(Fee Statement) 확인·다운로드, 납부 기한 확인, 지원되는 납부 방법 비교, 납부 전 환불·유예 정책을 확인할 수 있습니다.",
    },
    url: "https://www.monash.edu/students/admin/fees",
    host: "monash.edu/students/admin/fees",
    faviconDomain: "monash.edu",
    category: "campus",
  },
  {
    id: "fee-payment-my",
    name: {
      en: "Fee Payment Methods (Malaysia)",
      zh: "马来西亚校区缴费方式",
      ja: "学費の支払い方法（マレーシア）",
      ko: "등록금 납부 방법(말레이시아)",
    },
    desc: {
      en: "Official guide to paying Monash Malaysia fees: accepted payment channels and step-by-step instructions.",
      zh: "Monash 马来西亚校区官方缴费方式指引：支持的支付渠道与操作步骤。",
      ja: "Monash マレーシアの学費支払い公式ガイド：利用可能な支払いチャネルと手順の説明。",
      ko: "Monash 말레이시아 등록금 납부 공식 가이드: 지원되는 납부 채널과 절차 안내.",
    },
    detail: {
      en: "Monash Malaysia's official guide to fee payment methods. Compare the accepted channels — bank transfer, credit/debit card, local online banking and more — and follow the step-by-step instructions before making your payment.",
      zh: "马来西亚校区官方缴费方式指南。比对支持的支付渠道——银行转账、信用卡/借记卡、本地网银等——并按分步指引完成缴费。",
      ja: "Monash マレーシアの学費支払い方法の公式ガイド。銀行振込、クレジット/デビットカード、現地ネットバンクなどの対応チャネルを比較し、手順に沿って支払いを完了できます。",
      ko: "말레이시아 캠퍼스의 등록금 납부 방법 공식 가이드입니다. 은행 이체, 신용/체크카드, 현지 인터넷뱅킹 등 지원 채널을 비교하고 절차에 따라 납부를 완료하세요.",
    },
    url: "https://www.monash.edu.my/study/apply/application-form/fee-payment-methods",
    host: "monash.edu.my/study/apply/…",
    faviconDomain: "monash.edu.my",
    category: "campus",
    badge: {
      en: "Malaysia",
      zh: "马来西亚校区",
      ja: "マレーシア",
      ko: "말레이시아 캠퍼스",
    },
  },
  {
    id: "isp-helpdesk",
    name: {
      en: "ISP Helpdesk (Student Pass)",
      zh: "ISP Helpdesk 签证服务台",
      ja: "ISP Helpdesk（学生パス相談）",
      ko: "ISP Helpdesk(학생 비자 서비스)",
    },
    desc: {
      en: "Malaysia campus International Student Pass desk: open tickets for visa/pass questions and track their status.",
      zh: "马来西亚校区国际学生签证（Student Pass）服务台：提交工单咨询签证问题并追踪处理进度。",
      ja: "マレーシアキャンパスの国際学生パス専用サービスデスク。ビザやパスに関する質問をチケットで申請し、進捗を追跡できます。",
      ko: "말레이시아 캠퍼스 국제 학생 비자(Student Pass) 전용 서비스 데스크. 비자 문제를 티켓으로 제출하고 진행 상황을 추적할 수 있습니다.",
    },
    detail: {
      en: "The official helpdesk for International Student Pass (visa) matters at Monash Malaysia. Submit a new ticket with your questions, check the status and history of past requests, and browse the FAQ before filing — most pass-related questions are answered there.",
      zh: "Monash 马来西亚校区国际学生签证（Student Pass）事务官方服务台。提交新工单咨询、查询历史工单状态与回复；建议先查 FAQ，多数签证相关问题都有现成答案。",
      ja: "Monash マレーシアの国際学生パス（ビザ）関連の公式ヘルプデスク。新しいチケットを提出し、過去のリクエストの状況と履歴を確認できます。多くのパス関連の質問は FAQ に掲載されているため、提出前にまず確認を。",
      ko: "Monash 말레이시아의 국제 학생 비자(Student Pass) 관련 공식 헬프데스크입니다. 새 티켓을 제출하고 과거 요청의 상태와 이력을 확인할 수 있습니다. 대부분의 비자 관련 질문은 FAQ에 수록되어 있으니 제출 전에 먼저 확인하세요.",
    },
    url: "https://isphelpdesk.monash.edu.my/",
    host: "isphelpdesk.monash.edu.my",
    faviconDomain: "monash.edu.my",
    category: "campus",
    badge: {
      en: "Malaysia",
      zh: "马来西亚校区",
      ja: "マレーシア",
      ko: "말레이시아 캠퍼스",
    },
  },
  {
    id: "mum-helpdesk",
    name: {
      en: "MUM Helpdesk",
      zh: "MUM Helpdesk 综合服务台",
      ja: "MUM Helpdesk（総合ヘルプデスク）",
      ko: "MUM Helpdesk(종합 서비스 데스크)",
    },
    desc: {
      en: "Monash Malaysia's one-stop helpdesk: submit tickets and browse a rich knowledge base covering fees, library, IT and campus services.",
      zh: "马来西亚校区一站式服务台：提交工单，并查阅涵盖学费、图书馆、IT 与校园服务的知识库。",
      ja: "Monash マレーシアのワンストップヘルプデスク。チケット提出に加え、学費・図書館・IT・キャンパスサービスを網羅するナレッジベースを閲覧できます。",
      ko: "말레이시아 캠퍼스 원스톱 헬프데스크. 티켓 제출과 함께 등록금, 도서관, IT, 캠퍼스 서비스를 다루는 지식 베이스를 제공합니다.",
    },
    detail: {
      en: "The general helpdesk for Monash University Malaysia. Submit a ticket for IT and campus service requests and track it under My Ticket; the Knowledge Base also has self-service answers — fee payment dates and instalment plans, refunds, library loans and opening hours, group room bookings and more.",
      zh: "Monash 马来西亚校区综合服务台。通过 Submit a Ticket 提交工单（My Ticket 追踪进度）；知识库还提供自助答案——学费缴纳日期与分期计划、退费指引、图书馆借阅与开放时间、讨论室预约等。",
      ja: "Monash マレーシアの総合ヘルプデスク。Submit a Ticket からチケットを提出し（My Ticket で追跡）、IT やキャンパスサービスの要求を処理。ナレッジベースには学費の支払期限や分割プラン、返金ガイド、図書館の貸出・開館時間、グループルーム予約などの自己解決コンテンツが揃っています。",
      ko: "Monash 말레이시아 종합 헬프데스크입니다. Submit a Ticket으로 티켓을 제출하고(My Ticket에서 추적) IT·캠퍼스 서비스 요청을 처리합니다. 지식 베이스에는 등록금 납부 기한과 분할 납부, 환불 가이드, 도서관 대출·운영 시간, 스터디룸 예약 등 자가 해결 콘텐츠가 있습니다.",
    },
    url: "https://helpdesk.monash.edu.my/",
    host: "helpdesk.monash.edu.my",
    faviconDomain: "monash.edu.my",
    category: "campus",
    badge: {
      en: "Malaysia",
      zh: "马来西亚校区",
      ja: "マレーシア",
      ko: "말레이시아 캠퍼스",
    },
  },
  // — 第三方 / 社团 —
  {
    id: "studentvip",
    name: {
      en: "StudentVIP",
      zh: "StudentVIP 课程点评",
      ja: "StudentVIP（授業レビュー）",
      ko: "StudentVIP(수강 후기)",
    },
    desc: {
      en: "Student-written course reviews and a campus map for finding exact rooms and buildings.",
      zh: "学长学姐给各门课的难度评分与避坑建议；Campus Map 精准导航建筑与教室。",
      ja: "先輩学生による授業レビューと、教室・建物を探せるキャンパスマップ。",
      ko: "선배 학생들의 수강 후기와 건물·강의실을 찾는 캠퍼스 맵.",
    },
    detail: {
      en: "A third-party (unofficial) student hub. The most-used features are course reviews written by students — difficulty, workload, teaching quality — and the campus map for finding buildings and room numbers. Great for choosing electives.",
      zh: "第三方（非官方）学生平台。最常用的是学长学姐写的课程点评——难度、工作量、教学质量——以及精准到教室的 Campus Map 地图。选修课前的避坑神器。",
      ja: "非公式の学生コミュニティ。難易度・負担・授業の質など学生が書いた授業レビューと、建物や教室番号を探せるキャンパスマップが人気。選択科目選びの必見ツール。",
      ko: "비공식 학생 플랫폼입니다. 난이도·학업 부담·수업의 질 등 학생들이 쓴 수강 후기와 건물·강의실을 정확히 찾는 캠퍼스 맵이 인기입니다. 선택 과목 고를 때 필수 도구.",
    },
    url: "https://studentvip.com.au/",
    host: "studentvip.com.au",
    faviconDomain: "studentvip.com.au",
    category: "community",
  },
  {
    id: "monash-clubs",
    name: {
      en: "Monash Clubs",
      zh: "Monash Clubs 社团平台",
      ja: "Monash Clubs（サークル）",
      ko: "Monash Clubs(동아리)",
    },
    desc: {
      en: "Clubs and societies across Clayton and other Australian campuses.",
      zh: "Clayton（澳洲校区）学生社团总平台，浏览与加入各类社团。",
      ja: "Clayton など豪州キャンパスの学生サークル総合プラットフォーム。",
      ko: "Clayton 등 호주 캠퍼스 학생 동아리 총괄 플랫폼.",
    },
    detail: {
      en: "The central directory of student clubs and societies across Australian campuses — academic, cultural, sport, faith and special-interest groups. Membership usually costs a few dollars a year and unlocks events, competitions and free food.",
      zh: "澳洲校区学生社团总目录——学术、文化、体育、兴趣等各类社团一网打尽。入会通常一年几澳元，可解锁活动、比赛与免费食物。",
      ja: "豪州キャンパスの学生サークル総合ディレクトリ — 学術・文化・スポーツ・信仰・趣味系まで網羅。年会費は数豪ドル程度で、イベントや大会、無料のフード特典などが受けられます。",
      ko: "호주 캠퍼스 학생 동아리 종합 디렉터리 — 학술·문화·스포츠·종교·취미 동아리를 모두 포괄합니다. 연회비는 몇 달러 수준이며 이벤트, 대회, 무료 음식 혜택 등을 누릴 수 있습니다.",
    },
    url: "https://monashclubs.org/",
    host: "monashclubs.org",
    faviconDomain: "monashclubs.org",
    category: "community",
  },
  {
    id: "monsu",
    name: {
      en: "MONSU",
      zh: "MONSU 学生会",
      ja: "MONSU（学生組合）",
      ko: "MONSU(학생회)",
    },
    desc: {
      en: "Monash Student Union (Caulfield): events, student services and representation.",
      zh: "Caulfield 校区学生会：活动、服务与学生权益代表。",
      ja: "Caulfield キャンパスの学生組合：イベント・学生サービス・学生の代表。",
      ko: "Caulfield 캠퍼스 학생회: 이벤트, 학생 서비스, 학생 대변.",
    },
    detail: {
      en: "The Monash Student Union serving Caulfield (and Peninsula) students: orientation events, free breakfasts, advocacy and academic-appeal support, clubs administration and a second-hand bookshop.",
      zh: "服务 Caulfield（及 Peninsula）校区的学生会：迎新活动、免费早餐、学业申诉支持与 advocacy、社团管理及二手书店。",
      ja: "Caulfield（および Peninsula）キャンパスの学生を支える学生組合。オリエンテーション、無料朝食、学業申立てのサポート（advocacy）、サークル運営、中古書店などを運営しています。",
      ko: "Caulfield(및 Peninsula) 캠퍼스 학생을 지원하는 학생회입니다. 오리엔테이션, 무료 아침 식사, 학업 항소 지원(advocacy), 동아리 운영, 중고 서점 등을 운영합니다.",
    },
    url: "https://monsu.org/",
    host: "monsu.org",
    faviconDomain: "monsu.org",
    category: "community",
  },
  {
    id: "musa",
    name: {
      en: "MUSA",
      zh: "MUSA 学生会",
      ja: "MUSA（学生会）",
      ko: "MUSA(학생회)",
    },
    desc: {
      en: "Monash University Student Association — Malaysia campus.",
      zh: "马来西亚校区学生会（MUSA）。",
      ja: "マレーシアキャンパスの学生組織。",
      ko: "말레이시아 캠퍼스의 학생 단체.",
    },
    detail: {
      en: "The Monash University Student Association — the student body for the Malaysia campus. Runs orientation, cultural festivals and sports tournaments, and represents student interests to the university.",
      zh: "马来西亚校区的学生联合会。运营迎新、文化节与体育联赛，并向校方反映学生诉求。",
      ja: "Monash University Student Association — マレーシアキャンパスの学生組織。オリエンテーション、文化祭、スポーツ大会を運営し、大学に学生の意見を届けます。",
      ko: "Monash University Student Association — 말레이시아 캠퍼스의 학생 단체입니다. 오리엔테이션, 문화제, 스포츠 대회를 운영하고 대학에 학생의 목소리를 전달합니다.",
    },
    url: "https://musa.monash.edu.my/",
    host: "musa.monash.edu.my",
    faviconDomain: "monash.edu.my",
    category: "community",
    badge: {
      en: "Malaysia",
      zh: "马来西亚校区",
      ja: "マレーシア",
      ko: "말레이시아 캠퍼스",
    },
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
  switch (lang) {
    case "zh":
      return l.zh;
    case "ja":
      return l.ja;
    case "ko":
      return l.ko;
    default:
      return l.en;
  }
}

/** All four language variants of a string, lowercased — used for search matching. */
function haystack(l: L): string {
  return `${l.en} ${l.zh} ${l.ja} ${l.ko}`.toLowerCase();
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
            {pick(lang, UI.detailHeading)}
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
            {pick(lang, UI.openWebsite)}
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

  // ESC closes the info dialog
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
            haystack(s.name).includes(q) ||
            haystack(s.desc).includes(q) ||
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
          <p className="text-xs text-muted-foreground mt-1">{pick(lang, UI.sidebarSubtitle)}</p>
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
            <span>{pick(lang, UI.allCategories)}</span>
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
              <p className="text-sm text-muted-foreground">{pick(lang, UI.headerSubtitle)}</p>
            </div>
            <div className="relative w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={pick(lang, UI.searchPlaceholder)}
                className="pl-9 pr-8"
                aria-label={pick(lang, UI.searchAria)}
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
              <p className="text-sm text-muted-foreground">{pick(lang, UI.noMatch)}</p>
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
                        {/* Info button — opens the explainer dialog (does NOT open the site) */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDrawerSite(site);
                          }}
                          onKeyDown={(e) => e.stopPropagation()}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground/60 hover:text-primary hover:bg-primary/10 shrink-0 transition-colors duration-200 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                          aria-label={`${pick(lang, UI.infoAria)} — ${pick(lang, site.name)}`}
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

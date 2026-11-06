import { ChevronRight } from "lucide-react";
import { useTranslation } from "../i18n/useTranslation";
import { PASS_MARK, fmtPoints, type CategoryScore, type CourseGrade, type ItemScore } from "../lib/gradeBreakdown";

const OUTCOME_TONE: Record<CourseGrade["outcome"], string> = {
  passed: "text-emerald-600 dark:text-emerald-400",
  "on-track": "text-foreground",
  "at-risk": "text-amber-600 dark:text-amber-400",
  unreachable: "text-destructive",
  "not-started": "text-muted-foreground",
  "no-data": "text-muted-foreground",
};

/** One sentence answering "how far am I from passing?". */
export function useOutlook(grade: CourseGrade): string {
  const { t } = useTranslation();
  const remaining = fmtPoints(grade.pendingWeight);
  switch (grade.outcome) {
    case "passed":
      return t("grades.passed", { earned: fmtPoints(grade.earned) });
    case "unreachable":
      return t("grades.unreachable", { remaining });
    case "not-started":
      return t("grades.notStarted", { remaining });
    case "no-data":
      return t("grades.noStructure");
    default:
      return t("grades.needMore", {
        needed: fmtPoints(grade.needed),
        avg: fmtPoints(grade.requiredAverage ?? 0),
        remaining,
      });
  }
}

/**
 * Final-mark bar on a 0–100 scale: earned, lost on graded work, graded-but-hidden,
 * and still-to-come, with a tick at the pass mark.
 */
export function GradeBar({ grade, label }: { grade: CourseGrade; label: string }) {
  const scale = Math.max(grade.totalWeight, 100);
  const pct = (n: number) => `${Math.max(0, (n / scale) * 100)}%`;
  const lost = Math.max(0, grade.gradedWeight - grade.earned);
  return (
    <div className="relative h-2 w-full rounded-full bg-secondary overflow-visible" role="img" aria-label={label}>
      <div className="absolute inset-0 flex rounded-full overflow-hidden">
        <div className="h-full bg-primary" style={{ width: pct(grade.earned) }} />
        <div className="h-full bg-muted-foreground/25" style={{ width: pct(lost) }} />
        <div className="h-full bg-amber-500/30" style={{ width: pct(grade.hiddenWeight) }} />
      </div>
      <div className="absolute -top-1 -bottom-1 w-px bg-foreground/60" style={{ left: pct(PASS_MARK) }} aria-hidden="true" />
    </div>
  );
}

/** Compact Home row: one course, its bar and the pass outlook. */
export function CourseGradeRow({ code, name, grade, onOpen }: { code: string | null; name: string; grade: CourseGrade; onOpen: () => void }) {
  const { t } = useTranslation();
  const outlook = useOutlook(grade);
  const title = code ? `${code} · ${name}` : name;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t("grades.openCourse", { course: code ?? name })}
      className="w-full text-left px-4 py-3 flex items-center gap-4 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl transition-colors"
    >
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium truncate" title={title}>{title}</p>
          <p className="text-xs text-muted-foreground tabular-nums shrink-0">
            {t("grades.earned", { earned: fmtPoints(grade.earned), graded: fmtPoints(grade.gradedWeight + grade.hiddenWeight) })}
          </p>
        </div>
        <GradeBar grade={grade} label={outlook} />
        <p className={`text-xs ${OUTCOME_TONE[grade.outcome]}`}>{outlook}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
    </button>
  );
}

function itemStatus(item: ItemScore, t: ReturnType<typeof useTranslation>["t"]) {
  if (item.state === "graded") return `${fmtPoints(item.percent!)}%`;
  if (item.state === "hidden") return t("grades.itemHidden");
  return item.placeholder ? t("grades.itemUpcoming") : t("grades.itemPending");
}

function CategoryBlock({ category }: { category: CategoryScore }) {
  const { t } = useTranslation();
  const graded = category.items.filter((i) => i.state !== "pending").length;
  const filled = category.weight > 0 ? (category.earned / category.weight) * 100 : 0;
  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-label={`${category.name} ${fmtPoints(category.weight)}%`}>
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-sm font-semibold truncate">{category.name}</h4>
        <p className="text-sm tabular-nums shrink-0">
          {t("grades.categoryEarned", { earned: fmtPoints(category.earned), weight: fmtPoints(category.weight) })}
        </p>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden" aria-hidden="true">
        <div className="h-full bg-primary" style={{ width: `${Math.min(100, filled)}%` }} />
      </div>
      {category.items[0]?.placeholder ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{t("grades.itemUpcoming")}</p>
      ) : (
        <>
        <p className="mt-1.5 text-xs text-muted-foreground">{t("grades.itemsGraded", { graded, total: category.items.length })}</p>
        <ul className="mt-3 space-y-1.5">
          {category.items.map((item) => (
            <li key={item.id} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="truncate text-muted-foreground" title={item.name}>{item.name}</span>
              <span className={`shrink-0 tabular-nums ${item.state === "graded" ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                {itemStatus(item, t)}
              </span>
            </li>
          ))}
        </ul>
        </>
      )}
    </section>
  );
}

/** Course detail: overall outlook plus one block per assessment category. */
export function GradeBreakdownPanel({ grade }: { grade: CourseGrade }) {
  const { t } = useTranslation();
  const outlook = useOutlook(grade);
  if (grade.outcome === "no-data") return null;
  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="text-base font-semibold">{t("grades.breakdownTitle")}</h3>
        <p className="text-xs text-muted-foreground">{t("grades.passMark", { mark: PASS_MARK })}</p>
      </div>
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground tabular-nums">
          {t("grades.earned", { earned: fmtPoints(grade.earned), graded: fmtPoints(grade.gradedWeight + grade.hiddenWeight) })}
        </p>
        <GradeBar grade={grade} label={outlook} />
        <p className={`text-sm ${OUTCOME_TONE[grade.outcome]}`} role="status">{outlook}</p>
        {grade.hiddenWeight > 0 && (
          <p className="text-xs text-muted-foreground">{t("grades.hidden", { hidden: fmtPoints(grade.hiddenWeight) })}</p>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {grade.categories.map((c) => <CategoryBlock key={c.key} category={c} />)}
      </div>
      <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
        {!grade.weightsComplete && <li>{t("grades.weightsIncomplete", { total: fmtPoints(grade.totalWeight) })}</li>}
        <li>{t("grades.equalSplit")}</li>
        <li>{t("grades.hurdle")}</li>
      </ul>
    </div>
  );
}

import type { Assignment } from "../services/api";

/** Monash overall pass mark. Unit hurdles are not modelled (shown as a note instead). */
export const PASS_MARK = 50;

export type ItemState = "graded" | "hidden" | "pending";

export interface ItemScore {
  id: number;
  name: string;
  /** Share of the final mark (category weight split equally across its items). */
  share: number;
  /** 0–100 when a score could be read. */
  percent: number | null;
  state: ItemState;
  grade?: string;
  /** Stand-in for a category whose items aren't published yet (typically the exam). */
  placeholder?: boolean;
}

export interface CategoryScore {
  key: string;
  name: string;
  weight: number;
  items: ItemScore[];
  /** Final-mark points earned in this category. */
  earned: number;
  gradedWeight: number;
  pendingWeight: number;
  hiddenWeight: number;
}

export type Outcome = "passed" | "on-track" | "at-risk" | "unreachable" | "not-started" | "no-data";

export interface CourseGrade {
  categories: CategoryScore[];
  totalWeight: number;
  earned: number;
  gradedWeight: number;
  pendingWeight: number;
  hiddenWeight: number;
  /** Points still needed for the pass mark (0 when already passed). */
  needed: number;
  /** Average % needed on the still-pending weight, when meaningful. */
  requiredAverage: number | null;
  outcome: Outcome;
  /** Category weights add up to ~100%. */
  weightsComplete: boolean;
}

/**
 * Read a grade string as a percentage. Handles "80.25 / 100", "11.00 out of 13.00",
 * "85%", and a bare score with the gradebook maximum. Letter grades return null.
 */
export function parseScorePercent(grade: string | undefined, max?: number): number | null {
  const g = (grade ?? "").replace(/,/g, "").trim();
  if (!g || g === "-" || g === "–") return null;
  const ratio = g.match(/(-?\d+(?:\.\d+)?)\s*(?:\/|out of)\s*(\d+(?:\.\d+)?)/i);
  if (ratio) {
    const total = Number(ratio[2]);
    return total > 0 ? Math.max(0, (Number(ratio[1]) / total) * 100) : null;
  }
  const pct = g.match(/(-?\d+(?:\.\d+)?)\s*%/);
  if (pct) return Math.max(0, Number(pct[1]));
  const bare = g.match(/^(-?\d+(?:\.\d+)?)$/);
  if (bare && max && max > 0) return Math.max(0, (Number(bare[1]) / max) * 100);
  return null;
}

/** Category rows synced before `isCategory` existed look like "1. Quiz / Test" with no link. */
function isCategoryRow(a: Assignment): boolean {
  return a.isCategory ?? (!a.url && a.weight != null && /^\d+\.\s/.test(a.name));
}

const keyOf = (a: Assignment) => (a.categoryId != null ? `id:${a.categoryId}` : `name:${(a.category ?? "").toLowerCase()}`);

function scoreItem(a: Assignment, share: number): ItemScore {
  const percent = parseScorePercent(a.grade, a.gradeMax);
  const state: ItemState = percent != null ? "graded" : a.status === "graded" ? "hidden" : "pending";
  return { id: a.id, name: a.name, share, percent, state, grade: a.grade };
}

function category(key: string, name: string, weight: number, items: ItemScore[]): CategoryScore {
  const sum = (s: ItemState) => items.filter((i) => i.state === s).reduce((t, i) => t + i.share, 0);
  const earned = items.reduce((t, i) => t + (i.percent != null ? (i.share * i.percent) / 100 : 0), 0);
  return { key, name, weight, items, earned, gradedWeight: sum("graded"), pendingWeight: sum("pending"), hiddenWeight: sum("hidden") };
}

/** Build the per-category breakdown and pass outlook for one course's assessments. */
export function buildCourseGrade(assessments: Assignment[]): CourseGrade {
  const cats = assessments.filter(isCategoryRow);
  const categories: CategoryScore[] = [];

  if (cats.length > 0) {
    // Widget pages: category weight is authoritative and split equally across its items.
    for (const cat of cats) {
      const weight = cat.categoryWeight ?? cat.weight ?? 0;
      if (!(weight > 0)) continue; // e.g. "Supplementary assessment"
      const key = cat.categoryId != null ? `id:${cat.categoryId}` : keyOf(cat);
      const children = assessments.filter((a) => !isCategoryRow(a) && keyOf(a) === key);
      const items = children.length
        ? children.map((a) => scoreItem(a, weight / children.length))
        // Not yet published (typically the final exam): the whole category is still to come.
        : [{ id: cat.id, name: cat.name, share: weight, percent: null, state: "pending" as const, placeholder: true }];
      categories.push(category(key, (cat.category ?? cat.name).trim(), weight, items));
    }
  } else {
    // Older templates: each item carries its own weight; group by category heading for display.
    const groups = new Map<string, Assignment[]>();
    for (const a of assessments) {
      if (!(a.weight && a.weight > 0)) continue;
      const name = a.category?.trim() || "Other";
      groups.set(name, [...(groups.get(name) ?? []), a]);
    }
    for (const [name, list] of groups) {
      const items = list.map((a) => scoreItem(a, a.weight!));
      categories.push(category(`name:${name.toLowerCase()}`, name, items.reduce((t, i) => t + i.share, 0), items));
    }
  }

  const total = (f: (c: CategoryScore) => number) => categories.reduce((t, c) => t + f(c), 0);
  const totalWeight = total((c) => c.weight);
  const earned = total((c) => c.earned);
  const gradedWeight = total((c) => c.gradedWeight);
  const pendingWeight = total((c) => c.pendingWeight);
  const hiddenWeight = total((c) => c.hiddenWeight);
  const needed = Math.max(0, PASS_MARK - earned);
  const requiredAverage = needed > 0 && pendingWeight > 0 ? (needed / pendingWeight) * 100 : null;

  let outcome: Outcome;
  if (totalWeight <= 0) outcome = "no-data";
  else if (earned >= PASS_MARK) outcome = "passed";
  else if (earned + pendingWeight + hiddenWeight < PASS_MARK) outcome = "unreachable";
  else if (gradedWeight <= 0) outcome = "not-started";
  else if (requiredAverage != null && requiredAverage > PASS_MARK) outcome = "at-risk";
  else outcome = "on-track";

  return {
    categories, totalWeight, earned, gradedWeight, pendingWeight, hiddenWeight, needed, requiredAverage, outcome,
    weightsComplete: Math.abs(totalWeight - 100) < 0.5,
  };
}

/** One decimal, trailing ".0" dropped: 32.40 -> "32.4", 50 -> "50". */
export const fmtPoints = (n: number) => String(Math.round(n * 10) / 10);

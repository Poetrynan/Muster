import { useEffect, useSyncExternalStore } from "react";
import { fetchAcademicCalendar, type AcademicTerm } from "../services/api";

// Offline starting data from https://www.monash.edu/students/admin/dates/summary-dates
export const bundledAcademicTerms: readonly AcademicTerm[] = [
  { key: "2026-S1", teachingStart: "2026-03-02", teachingEnd: "2026-05-29", breakStart: "2026-04-06", breakEnd: "2026-04-10" },
  { key: "2026-S2", teachingStart: "2026-07-27", teachingEnd: "2026-10-23", breakStart: "2026-09-21", breakEnd: "2026-09-25" },
  { key: "2027-S1", teachingStart: "2027-03-01", teachingEnd: "2027-05-28", breakStart: "2027-03-29", breakEnd: "2027-04-02" },
  { key: "2027-S2", teachingStart: "2027-07-26", teachingEnd: "2027-10-22", breakStart: "2027-09-20", breakEnd: "2027-09-24" },
  { key: "2028-S1", teachingStart: "2028-02-28", teachingEnd: "2028-05-26", breakStart: "2028-04-17", breakEnd: "2028-04-21" },
  { key: "2028-S2", teachingStart: "2028-07-24", teachingEnd: "2028-10-20", breakStart: "2028-09-18", breakEnd: "2028-09-22" },
];

const cacheKey = "muster.monashAcademicCalendar";
const cacheLifetime = 24 * 60 * 60 * 1000;
const retryDelay = 5 * 60 * 1000;

function isAcademicTerm(value: unknown): value is AcademicTerm {
  if (!value || typeof value !== "object") return false;
  const { key, teachingStart, teachingEnd, breakStart, breakEnd } = value as Partial<AcademicTerm>;
  if (typeof key !== "string" || !/^\d{4}-S[12]$/.test(key)) return false;
  const dates = [teachingStart, breakStart, breakEnd, teachingEnd];
  return dates.every((date) =>
    typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && date.startsWith(key.slice(0, 4)) && Number.isFinite(Date.parse(date))
    && new Date(date).toISOString().slice(0, 10) === date,
  ) && dates.join() === [...dates].sort().join();
}

function loadCalendar(): { fetchedAt: number; terms: AcademicTerm[] } {
  try {
    const cache = JSON.parse(localStorage.getItem(cacheKey) ?? "null");
    if (cache && typeof cache.fetchedAt === "number" && cache.fetchedAt <= Date.now()
      && Array.isArray(cache.terms) && cache.terms.every(isAcademicTerm)) {
      return cache;
    }
  } catch {
    // A missing or unreadable local cache is safe to ignore.
  }
  return { fetchedAt: 0, terms: [] };
}

function mergeTerms(previous: readonly AcademicTerm[], incoming: readonly AcademicTerm[]) {
  return [...new Map([...previous, ...incoming].map((term) => [term.key, term])).values()];
}

const cached = loadCalendar();
let terms = mergeTerms(bundledAcademicTerms, cached.terms);
let nextFetch = cached.fetchedAt + cacheLifetime;
const listeners = new Set<() => void>();

async function refreshCalendar() {
  if (Date.now() < nextFetch) return;
  nextFetch = Date.now() + retryDelay;
  let incoming: AcademicTerm[];
  try {
    incoming = await fetchAcademicCalendar();
  } catch {
    return;
  }
  if (incoming.length === 0 || !incoming.every(isAcademicTerm)) return;

  const fetchedAt = Date.now();
  nextFetch = fetchedAt + cacheLifetime;
  terms = mergeTerms(terms, incoming);
  try {
    localStorage.setItem(cacheKey, JSON.stringify({ fetchedAt, terms }));
  } catch {
    // Keep using the refreshed dates when storage is unavailable.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useAcademicCalendar(): readonly AcademicTerm[] {
  useEffect(() => {
    const refresh = () => { void refreshCalendar(); };
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  return useSyncExternalStore(subscribe, () => terms, () => bundledAcademicTerms);
}

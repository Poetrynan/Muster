import { CalendarDays, Clock, MapPin, User } from "lucide-react";
import { Card, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import type { ExamSchedule } from "../types";
import { getCalendarDayDiff } from "../lib/utils";
import { useTranslation } from "../i18n/useTranslation";

interface ExamCardProps {
  exam: ExamSchedule;
  compact?: boolean;
}

export function ExamCard({ exam, compact = false }: ExamCardProps) {
  const { t, lang } = useTranslation();

  // Parse the exam date for countdown calculation
  const examDate = new Date(exam.date);
  const diff = getCalendarDayDiff(examDate.getTime());
  const isPast = examDate.getTime() < Date.now();

  const badge = isPast || diff === null || diff < 0 ? (
    <Badge variant="secondary">{t("dashboard.examPassed")}</Badge>
  ) : diff === 0 ? (
    <Badge variant="danger" className="font-bold">{t("dashboard.examToday")}</Badge>
  ) : diff === 1 ? (
    <Badge variant="danger" className="font-bold">{t("dashboard.examTomorrow")}</Badge>
  ) : diff <= 7 ? (
    <Badge variant="danger" className="font-bold">{t("dashboard.examInDays", { count: diff })}</Badge>
  ) : (
    <Badge variant="secondary">{t("dashboard.examInDays", { count: diff })}</Badge>
  );

  const dateStr = examDate.toLocaleDateString(lang, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const timeStr = exam.startTime && exam.startTime !== "TBD"
    ? `${exam.startTime} – ${exam.endTime}`
    : null;

  if (compact) {
    return (
      <Card className="card-hover hover-lift">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-red-500/15 text-red-600 dark:text-red-400">
            <CalendarDays className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {exam.courseCode} · {exam.examType}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {dateStr}{timeStr ? ` · ${timeStr}` : ""}
            </p>
          </div>
          <div className="text-right shrink-0">
            {badge}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="card-hover hover-lift">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-red-500/15 text-red-600 dark:text-red-400">
              <CalendarDays className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                {exam.courseCode}
              </p>
              <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                {exam.courseName}
              </p>
            </div>
          </div>
          {badge}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm">
            <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="font-medium">{dateStr}</span>
            {timeStr && (
              <span className="text-muted-foreground flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {timeStr}
              </span>
            )}
          </div>

          {exam.location && exam.location !== "TBD" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="w-3.5 h-3.5" />
              <span>{exam.location}</span>
            </div>
          )}

          {exam.seatNumber && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <User className="w-3.5 h-3.5" />
              <span>{t("dashboard.examSeat")}: {exam.seatNumber}</span>
            </div>
          )}

          {exam.durationMinutes && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              <span>{t("dashboard.examDuration")}: {exam.durationMinutes} {t("dashboard.examMinutes")}</span>
            </div>
          )}
        </div>

        {exam.instructions && (
          <p className="mt-3 text-xs text-muted-foreground border-t border-border pt-2">
            {exam.instructions}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

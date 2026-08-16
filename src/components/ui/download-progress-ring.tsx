import { Loader2 } from "lucide-react";

interface DownloadProgressRingProps {
  /** 0-100; null while the total size is unknown (spinner instead). */
  percent: number | null;
  /** Ring diameter in px. */
  size?: number;
}

/**
 * Circular download progress with a live percentage in the center.
 * Used on every download button (dashboard rows, course materials, ...) so the
 * user always sees real-time progress instead of a bare spinner.
 */
export function DownloadProgressRing({ percent, size = 22 }: DownloadProgressRingProps) {
  const stroke = 2.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  if (percent == null) {
    return <Loader2 className="animate-spin text-primary" style={{ width: size, height: size }} />;
  }
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="progressbar" aria-valuenow={Math.round(clamped)} aria-valuemin={0} aria-valuemax={100}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-primary/15" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          className="stroke-primary transition-all duration-300 ease-out"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped / 100)}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-bold text-primary" style={{ fontSize: Math.max(7, size * 0.36) }}>
        {Math.round(clamped)}
        <span style={{ fontSize: "0.72em" }}>%</span>
      </span>
    </div>
  );
}

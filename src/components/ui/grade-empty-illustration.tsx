/**
 * Grade-progress empty-state illustration: a blank paper waiting for a grade,
 * with a red pen resting on it — echoing the "professors are still sharpening
 * their red pens" copy. Pure inline SVG, theme-neutral tones + red accent.
 */
export function GradeEmptyIllustration({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Ground shadow */}
      <ellipse cx="60" cy="106" rx="32" ry="4.5" fill="#94a3b8" opacity="0.15" />
      {/* Ink dots (waiting, nothing graded yet) */}
      <circle cx="100" cy="28" r="2.2" fill="#ef4444" opacity="0.5" />
      <circle cx="14" cy="24" r="1.8" fill="#94a3b8" opacity="0.6" />
      {/* Paper */}
      <rect x="12" y="36" width="58" height="74" rx="7" fill="#ffffff" stroke="#cbd5e1" strokeWidth="2" />
      {/* Blank grade circle (top-right of the paper) */}
      <circle cx="58" cy="45" r="6.5" fill="none" stroke="#94a3b8" strokeWidth="2" />
      {/* Text lines on the paper */}
      <rect x="20" y="58" width="38" height="3.5" rx="1.75" fill="#e2e8f0" />
      <rect x="20" y="68" width="42" height="3.5" rx="1.75" fill="#e2e8f0" />
      <rect x="20" y="78" width="30" height="3.5" rx="1.75" fill="#e2e8f0" />
      <rect x="20" y="96" width="34" height="3.5" rx="1.75" fill="#e2e8f0" />
      {/* Red pen (rotated, resting on the paper): nib points DOWN toward the paper */}
      <g transform="rotate(-28 62 78)">
        {/* Tail cap (right end) */}
        <rect x="76" y="72.5" width="4" height="10" rx="2" fill="#b91c1c" />
        {/* Barrel */}
        <rect x="40" y="72.5" width="36" height="10" rx="3" fill="#ef4444" />
        {/* Metal ferrule ring near the nib (left end) */}
        <rect x="39.5" y="72.5" width="3.5" height="10" fill="#fca5a5" />
        {/* Tapered nib, pointing left */}
        <polygon points="43,72.5 30,77.5 43,82.5" fill="#b91c1c" />
        {/* Nib tip (lead/ink point) */}
        <polygon points="33,76.4 28,77.5 33,78.6" fill="#f8fafc" />
      </g>
    </svg>
  );
}

/**
 * Empty-state illustration: an open isometric cardboard box with nothing in it.
 * Drawn as inline SVG (theme-neutral slate tones + primary accent star) so it
 * matches the app's flat/soft UI language and works in both light & dark mode.
 */
export function EmptyBox({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Ground shadow */}
      <ellipse cx="60" cy="105" rx="30" ry="4.5" fill="#94a3b8" opacity="0.18" />
      {/* Accent star (top-right) */}
      <path
        d="M98 14 l2.6 6.4 6.4 2.6 -6.4 2.6 -2.6 6.4 -2.6 -6.4 -6.4 -2.6 6.4 -2.6 Z"
        fill="var(--color-primary, #3b82f6)"
      />
      {/* Floating dots */}
      <circle cx="36" cy="24" r="2.2" fill="#94a3b8" opacity="0.7" />
      <circle cx="90" cy="30" r="1.6" fill="#94a3b8" opacity="0.5" />
      {/* Open lid (flap) */}
      <path
        d="M26 48 L10 34 L26 18 L60 32 Z"
        fill="#f1f5f9"
        stroke="#64748b"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M10 34 L44 24" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
      {/* Inner opening (empty) */}
      <path
        d="M34 49 L60 37 L86 49 L60 61 Z"
        fill="#94a3b8"
        opacity="0.55"
      />
      {/* Front panel */}
      <path
        d="M26 48 L60 64 L60 100 L26 84 Z"
        fill="#e2e8f0"
        stroke="#64748b"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* Side panel */}
      <path
        d="M60 64 L94 48 L94 84 L60 100 Z"
        fill="#cbd5e1"
        stroke="#64748b"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* Dust motes drifting out of the empty box */}
      <circle cx="52" cy="38" r="1.8" fill="#64748b" opacity="0.55" />
      <circle cx="70" cy="34" r="1.4" fill="#64748b" opacity="0.4" />
    </svg>
  );
}

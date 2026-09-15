/**
 * Screen-break creature sprites — original inline SVG (an allusion, not a
 * likeness: the same IP posture as the `spidey`/`ironman` flairs), ported from
 * the design study's `FIST`/`EYE` constants. Both are static markup; every
 * per-frame value (scale, rotate, blink, pupil look) is written by the
 * `<ScreenBreak />` rAF loop onto wrapper elements, never here.
 *
 * The eye's iris gradient reads the instance accent where available
 * (`--color-accent`, falling back to the study's stops). The pupil group
 * carries `data-part="pupil"` so the per-frame look offset can find it.
 */

export function FistSprite() {
  return (
    <svg viewBox="0 0 200 200" width="300" height="300">
      <ellipse cx="100" cy="158" rx="54" ry="36" fill="#1f7a3c" stroke="#0b3d1e" strokeWidth="3" />
      <rect x="38" y="60" width="124" height="98" rx="28" fill="#3fb950" stroke="#0b3d1e" strokeWidth="3.5" />
      <g stroke="#14532d" strokeWidth="2.4">
        <rect x="42" y="42" width="27" height="62" rx="13" fill="#4ade80" />
        <rect x="72" y="36" width="27" height="68" rx="13" fill="#4ade80" />
        <rect x="102" y="38" width="27" height="66" rx="13" fill="#4ade80" />
        <rect x="132" y="46" width="26" height="58" rx="13" fill="#4ade80" />
      </g>
      <g fill="#86efac" opacity=".75">
        <ellipse cx="55.5" cy="50" rx="8" ry="5" />
        <ellipse cx="85.5" cy="44" rx="8" ry="5" />
        <ellipse cx="115.5" cy="46" rx="8" ry="5" />
        <ellipse cx="145" cy="54" rx="7.5" ry="5" />
      </g>
      <g fill="none" stroke="#14532d" strokeWidth="2" opacity=".7" strokeLinecap="round">
        <path d="M50 96 q6 8 14 6" />
        <path d="M80 96 q6 8 14 6" />
        <path d="M110 96 q6 8 14 6" />
        <path d="M139 98 q5 7 12 5" />
      </g>
      <rect
        x="28"
        y="104"
        width="36"
        height="72"
        rx="17"
        fill="#4ade80"
        stroke="#14532d"
        strokeWidth="2.6"
        transform="rotate(-38 46 140)"
      />
      <path d="M60 118 q14 14 44 12" fill="none" stroke="#14532d" strokeWidth="2" opacity=".6" strokeLinecap="round" />
    </svg>
  );
}

export function EyeSprite() {
  return (
    <svg viewBox="0 0 200 200" width="460" height="460">
      <defs>
        <radialGradient id="rk-sb-iris" cx="45%" cy="40%">
          <stop offset="0" stopColor="#9dbcff" />
          <stop offset=".55" style={{ stopColor: "var(--color-accent, #5b8af0)" }} />
          <stop offset="1" stopColor="#1e3a8a" />
        </radialGradient>
      </defs>
      <ellipse cx="100" cy="100" rx="96" ry="60" fill="#e9e4d4" />
      <g fill="none" stroke="#c0392b" strokeWidth="1.1" opacity=".55">
        <path d="M10 96 q22 -6 42 4" />
        <path d="M14 108 q18 4 36 -2" />
        <path d="M190 96 q-22 -8 -44 2" />
        <path d="M186 110 q-16 6 -34 -4" />
      </g>
      <g data-part="pupil">
        <circle cx="100" cy="100" r="36" fill="url(#rk-sb-iris)" />
        <circle cx="100" cy="100" r="16" fill="#050508" />
        <circle cx="89" cy="89" r="5.5" fill="#fff" opacity=".85" />
      </g>
    </svg>
  );
}

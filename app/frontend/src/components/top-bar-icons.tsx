import type { ReactNode } from "react";

/**
 * Shared top-bar control glyphs (260801-3q1z) — one definition per mirrored
 * in-bar control, consumed by BOTH the in-bar button forms and their
 * chevron-menu / SplitControl-popover rows, so bar↔menu visual parity is
 * structural (the `OpenTargetIcon` precedent, `open-app-icons.tsx`).
 *
 * Conventions (the OpenTargetIcon shape): ~14px rendered size, `currentColor`
 * stroke/fill (rides the row hover treatments and rk-glint flips for free),
 * `aria-hidden="true"` decoration — the row's accessible name stays its text
 * label — `shrink-0`, and a kebab-case `data-icon` attribute as the test seam
 * (monochrome paths are indistinguishable to queries).
 *
 * Unlike `open-app-icons.tsx`'s fixed 24-viewBox/1.8-stroke `Glyph`, the
 * wrapper here is parameterized by viewBox/strokeWidth/join so each glyph
 * byte-preserves its in-bar original's SVG attributes — the refactor is
 * zero-visual-change to the bar (split/close/refresh: 24-viewBox strokeWidth 2;
 * fixed-width: 14-viewBox strokeWidth 1.5 round caps only; autofit: 14-viewBox
 * strokeWidth 1.5 round caps+joins).
 *
 * Stateful toggles (fixed-width, autofit) expose a variant prop so one
 * definition serves both forms: the in-bar button passes live state
 * (`expanded={fixedWidth}` / `filled={autofit}`), while the menu row renders
 * the DEFAULT — a static identity variant (leading icon = identity; the row's
 * trailing ✓ is the sole state marker, the macOS menu pattern).
 */

function ControlGlyph({
  name,
  viewBox = "0 0 24 24",
  strokeWidth = 2,
  join = true,
  children,
}: {
  name: string;
  viewBox?: string;
  strokeWidth?: number;
  /** strokeLinejoin="round" — off for glyphs whose in-bar original carries
   *  round caps only (FixedWidthToggle). */
  join?: boolean;
  children: ReactNode;
}) {
  return (
    <svg
      width="14"
      height="14"
      viewBox={viewBox}
      data-icon={name}
      aria-hidden="true"
      className="shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      {...(join ? { strokeLinejoin: "round" as const } : {})}
    >
      {children}
    </svg>
  );
}

/** Split vertical — lucide square-split-vertical (top/bottom brackets +
 *  horizontal divider), the 90°-rotated sibling of SplitHorizontalGlyph. */
export function SplitVerticalGlyph() {
  return (
    <ControlGlyph name="split-vertical">
      <path d="M5 8V5c0-1 1-2 2-2h10c1 0 2 1 2 2v3" />
      <path d="M19 16v3c0 1-1 2-2 2H7c-1 0-2-1-2-2v-3" />
      <line x1="4" x2="20" y1="12" y2="12" />
    </ControlGlyph>
  );
}

/** Split horizontal — lucide square-split-horizontal (side brackets +
 *  vertical divider). The SplitControl primary segment's glyph. */
export function SplitHorizontalGlyph() {
  return (
    <ControlGlyph name="split-horizontal">
      <path d="M8 19H5c-1 0-2-1-2-2V7c0-1 1-2 2-2h3" />
      <path d="M16 5h3c1 0 2 1 2 2v10c0 1-1 2-2 2h-3" />
      <line x1="12" x2="12" y1="4" y2="20" />
    </ControlGlyph>
  );
}

/** Close pane — the ✕ (two crossed lines), the in-bar ClosePaneButton glyph. */
export function ClosePaneGlyph() {
  return (
    <ControlGlyph name="close-pane">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </ControlGlyph>
  );
}

/** Refresh — lucide rotate-cw (circular arrow with a top-right arrowhead),
 *  the in-bar RefreshButton glyph. */
export function RefreshGlyph() {
  return (
    <ControlGlyph name="refresh">
      <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
      <path d="M21 3v5h-5" />
    </ControlGlyph>
  );
}

/** Fixed width — the FixedWidthToggle arrows. `expanded` renders the outward
 *  (expand) variant the in-bar toggle shows while fixed-width is ON; the
 *  default is the inward/contract arrows — the static identity form the menu
 *  row uses (state stays on the trailing ✓). */
export function FixedWidthGlyph({ expanded = false }: { expanded?: boolean }) {
  return (
    <ControlGlyph name="fixed-width" viewBox="0 0 14 14" strokeWidth={1.5} join={false}>
      {expanded ? (
        <>
          {/* Arrows pointing outward — expand */}
          <line x1="1" y1="7" x2="5" y2="7" />
          <polyline points="1,5 1,7 1,9" />
          <line x1="9" y1="7" x2="13" y2="7" />
          <polyline points="13,5 13,7 13,9" />
        </>
      ) : (
        <>
          {/* Arrows pointing inward — contract */}
          <line x1="1" y1="7" x2="5" y2="7" />
          <polyline points="5,5 5,7 5,9" />
          <line x1="9" y1="7" x2="13" y2="7" />
          <polyline points="9,5 9,7 9,9" />
        </>
      )}
    </ControlGlyph>
  );
}

/** Board autofit — the frame-with-columns ("panes fill the row"). `filled`
 *  renders the in-bar pressed (on) variant with filled panes; the default
 *  unfilled frame is the static identity form the menu row uses. */
export function AutofitGlyph({ filled = false }: { filled?: boolean }) {
  return (
    <ControlGlyph name="autofit" viewBox="0 0 14 14" strokeWidth={1.5}>
      {/* Outer frame = the board row */}
      <rect x="1" y="2.5" width="12" height="9" rx="1" />
      {/* Two internal dividers = panes sharing the row. When on, the panes are
          filled (they've stretched to fill); when off, just outlines. */}
      <line x1="5" y1="2.5" x2="5" y2="11.5" />
      <line x1="9" y1="2.5" x2="9" y2="11.5" />
      {filled && (
        <>
          <rect x="1.5" y="3" width="3" height="8" fill="currentColor" stroke="none" opacity="0.35" />
          <rect x="5.5" y="3" width="3" height="8" fill="currentColor" stroke="none" opacity="0.35" />
          <rect x="9.5" y="3" width="3" height="8" fill="currentColor" stroke="none" opacity="0.35" />
        </>
      )}
    </ControlGlyph>
  );
}

/** Terminal font — the "Aa" TEXT glyph matching the in-bar TerminalFontControl
 *  trigger ("Aa" reads as "text size"): an aria-hidden span in a fixed ~14px
 *  shrink-0 box, not an SVG. Font size inherits from the host (text-xs on both
 *  the trigger button and the menu rows) so the glyph matches its surface. */
export function TerminalFontGlyph() {
  return (
    <span
      data-icon="terminal-font"
      aria-hidden="true"
      className="w-[14px] shrink-0 inline-flex items-center justify-center font-semibold leading-none"
    >
      Aa
    </span>
  );
}

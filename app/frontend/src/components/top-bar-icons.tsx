import type { ReactNode } from "react";
import type { LayoutShape } from "@/lib/surface-layout";

/**
 * Shared top-bar control glyphs (260801-3q1z) — one definition per mirrored
 * control, consumed by the surviving in-bar button forms AND their
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
 * byte-preserves its original's SVG attributes — the refactor is
 * zero-visual-change to the bar (split/close/refresh: 24-viewBox strokeWidth 2;
 * fixed-width: 14-viewBox strokeWidth 1.5 round caps only; autofit: 14-viewBox
 * strokeWidth 1.5 round caps+joins).
 *
 * The one stateful toggle with an in-bar form (autofit) exposes a variant prop
 * so one definition serves both forms: the in-bar button passes live state
 * (`filled={autofit}`), while the menu row renders the DEFAULT — a static
 * identity variant (leading icon = identity; the row's trailing ✓ is the sole
 * state marker, the macOS menu pattern). Menu-only controls (fixed-width,
 * close-pane, terminal-font) ship the static identity form alone.
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
  /** strokeLinejoin="round" — off for glyphs drawn with round caps only
   *  (FixedWidthGlyph's arrows). */
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

/** Close pane — the ✕ (two crossed lines), the close-pane menu row's glyph. */
export function ClosePaneGlyph() {
  return (
    <ControlGlyph name="close-pane">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </ControlGlyph>
  );
}

/** Close pane (boxed) — lucide square-x (rounded rect + inner cross), the
 *  tty-tile pane segment's Close Pane glyph (260813-w1lf). Deliberately NOT
 *  the bare-✕ ClosePaneGlyph: the box is the misclick-trap distinction from
 *  the tile-close ✕. */
export function ClosePaneBoxedGlyph() {
  return (
    <ControlGlyph name="close-pane-boxed">
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </ControlGlyph>
  );
}

/** Find — lucide search (circle + handle), the tile-header find toggle
 *  (tty and web ⌕ vocabulary). */
export function FindGlyph() {
  return (
    <ControlGlyph name="find">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </ControlGlyph>
  );
}

/** Export — arrow-down-to-line ("pull the buffer down to a file"), the tty
 *  tile header's export-menu trigger. */
export function ExportGlyph() {
  return (
    <ControlGlyph name="export">
      <path d="M12 17V3" />
      <path d="m6 11 6 6 6-6" />
      <path d="M19 21H5" />
    </ControlGlyph>
  );
}

/** Zoom — lucide maximize corner brackets. One glyph serves zoom and unzoom;
 *  state is carried by the button's accent-green + aria-label, never the shape. */
export function ZoomGlyph() {
  return (
    <ControlGlyph name="zoom">
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </ControlGlyph>
  );
}

/** Promote — square with a left-half divider (lucide panel-left shape): "make
 *  this tile slot A", the ◧ semantics. */
export function PromoteGlyph() {
  return (
    <ControlGlyph name="promote">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </ControlGlyph>
  );
}

/** Swap — lucide arrow-left-right, the swap-with-next tile verb. */
export function SwapGlyph() {
  return (
    <ControlGlyph name="swap">
      <path d="M8 3 4 7l4 4" />
      <path d="M4 7h16" />
      <path d="m16 21 4-4-4-4" />
      <path d="M20 17H4" />
    </ControlGlyph>
  );
}

/** Tile close — bare crossed lines. Deliberately NOT boxed: the boxed
 *  square-x is Close Pane's shape (`ClosePaneBoxedGlyph`), and the two
 *  destructive closes in one header never share a shape (the close-distinction
 *  contract). Distinct data-icon from the menu-row `ClosePaneGlyph` — the seam
 *  names the verb, not the drawing. */
export function TileCloseGlyph() {
  return (
    <ControlGlyph name="tile-close">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </ControlGlyph>
  );
}

/** Web back — lucide arrow-left, the web tile URL bar's Back button. */
export function WebBackGlyph() {
  return (
    <ControlGlyph name="web-back">
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </ControlGlyph>
  );
}

/** Web forward — lucide arrow-right, the web tile URL bar's Forward button. */
export function WebForwardGlyph() {
  return (
    <ControlGlyph name="web-forward">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </ControlGlyph>
  );
}

/** Open external — lucide arrow-up-right ("leave the tile"), the web tile
 *  URL bar's Open in browser button. */
export function OpenExternalGlyph() {
  return (
    <ControlGlyph name="open-external">
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
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

/** Fixed width — the inward/contract fixed-width arrows: the static identity
 *  form the menu row uses (state stays on the trailing ✓). The state-driven
 *  `expanded` outward variant went with the in-bar toggle (260814-6b0j). */
export function FixedWidthGlyph() {
  return (
    <ControlGlyph name="fixed-width" viewBox="0 0 14 14" strokeWidth={1.5} join={false}>
      {/* Arrows pointing inward — contract */}
      <line x1="1" y1="7" x2="5" y2="7" />
      <polyline points="5,5 5,7 5,9" />
      <line x1="9" y1="7" x2="13" y2="7" />
      <polyline points="9,5 9,7 9,9" />
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

/** Terminal font — the "Aa" TEXT glyph ("Aa" reads as "text size"): an
 *  aria-hidden span in a fixed ~14px shrink-0 box, not an SVG. Font size
 *  inherits from the host (text-xs on the menu rows) so the glyph matches its
 *  surface. */
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

/** Layout chip face (260812-ab5v R9) — the ▦ preset-grid pictogram: a rounded
 *  frame quartered into a 2×2 tile grid ("the center is a layout of tiles").
 *  14-viewBox/1.5-stroke, the AutofitGlyph register (a tile-frame sibling). */
export function LayoutGlyph() {
  return (
    <ControlGlyph name="layout" viewBox="0 0 14 14" strokeWidth={1.5}>
      <rect x="1" y="2.5" width="12" height="9" rx="1" />
      <line x1="7" y1="2.5" x2="7" y2="11.5" />
      <line x1="1" y1="7" x2="13" y2="7" />
    </ControlGlyph>
  );
}

/** Shield — lucide shield, the protected-server class marker. Rendered on the
 *  server-list surfaces (host TMUX SERVERS tiles, sidebar server group headers)
 *  where `name === DAEMON_SERVER || server.protected` — the visible cause for
 *  the guarded kill fork (typed-name confirm). The surrounding label carries
 *  the accessible name; the glyph stays aria-hidden decoration. */
export function ShieldGlyph() {
  return (
    <ControlGlyph name="shield">
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    </ControlGlyph>
  );
}

/**
 * Per-shape preset glyphs (260812-ab5v R9) — the ▦ chip popover's rows and the
 * overflow menu's `Layout: …` rows, one miniaturized arrangement pictogram per
 * preset (spec § Shape presets ASCII, reduced to strokes): dividers split the
 * frame the way the shape splits the center — `split-h` one vertical divider,
 * `row` two, the `main-*` shapes an off-center A boundary plus the B/C divider
 * on A's far side. `single` is the bare frame.
 */
export function LayoutShapeGlyph({ shape }: { shape: LayoutShape }) {
  return (
    <ControlGlyph name={`layout-${shape}`} viewBox="0 0 14 14" strokeWidth={1.5}>
      <rect x="1" y="2.5" width="12" height="9" rx="1" />
      {shape === "split-h" && <line x1="7" y1="2.5" x2="7" y2="11.5" />}
      {shape === "split-v" && <line x1="1" y1="7" x2="13" y2="7" />}
      {shape === "row" && (
        <>
          <line x1="5" y1="2.5" x2="5" y2="11.5" />
          <line x1="9" y1="2.5" x2="9" y2="11.5" />
        </>
      )}
      {shape === "col" && (
        <>
          <line x1="1" y1="5.5" x2="13" y2="5.5" />
          <line x1="1" y1="8.5" x2="13" y2="8.5" />
        </>
      )}
      {shape === "main-left" && (
        <>
          <line x1="8.5" y1="2.5" x2="8.5" y2="11.5" />
          <line x1="8.5" y1="7" x2="13" y2="7" />
        </>
      )}
      {shape === "main-right" && (
        <>
          <line x1="5.5" y1="2.5" x2="5.5" y2="11.5" />
          <line x1="1" y1="7" x2="5.5" y2="7" />
        </>
      )}
      {shape === "main-top" && (
        <>
          <line x1="1" y1="5.5" x2="13" y2="5.5" />
          <line x1="7" y1="5.5" x2="7" y2="11.5" />
        </>
      )}
    </ControlGlyph>
  );
}

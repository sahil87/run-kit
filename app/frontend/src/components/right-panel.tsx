import { Tip } from "@/components/tip";
import {
  SURFACE_GLYPH,
  SURFACE_LABEL,
  SURFACE_RAIL_HIDDEN,
  type SurfaceKind,
} from "@/lib/surface-layout";

/**
 * RightPanel — the RAIL ONLY (260812-ab5v-surface-layout-core T011; spec
 * docs/specs/surface-layout.md § Verbs — "Rail semantics change"). The panel
 * slot (surface mount + width drag, 260811-2r1w) is SUBSUMED by layout tiles —
 * the divider logic lives in `surface-layout.tsx` now; what remains of this
 * component is the fixed 52px vertical rail on the terminal route's right
 * edge — rendered inside the Shell grid's full-height third column
 * (260812-nm4p), which the top-bar rail toggle collapses; layout tiles live in
 * the content column and survive a rail collapse. The file name and the
 * `right-panel-rail` testid are kept (e2e depends on it); the width/ratio
 * clamps stay in `lib/right-panel.ts`.
 *
 * Rail buttons are OPEN-TILE TOGGLES (R10): one focusable button per AVAILABLE
 * surface (`tty` first — R8's shared registry), LIT (`aria-pressed`) for every
 * open tile (`layout.order`). Clicking an unlit button ADDS the surface
 * (1→2 `split-h`, 2→3 `main-left`); clicking a lit one CLOSES its tile (R7
 * close semantics — the arity collapse). The caller (`app.tsx`'s
 * `togglePanel`) runs the pure mutation + persistence/URL mirroring; a
 * disallowed mutation (closing the last tile) is a null no-op there.
 *
 * At 3 open tiles the remaining unlit buttons render DISABLED with a "Close a
 * tile first" tooltip (plan assumption 5 — the max-3 constraint must be
 * visible, never a silent no-op). The Tip wraps a span so the disabled
 * button's tooltip still fires (disabled buttons swallow pointer events).
 *
 * Icon glyphs replace the phase-1 text labels (user-requested fold-in, R10):
 * `>_` tty, `⧉` web, `⌸` chat, `{}` code — the shared `SURFACE_GLYPH` map; the
 * previous text labels moved into the `Tip` tooltips and the `<Label> tile`
 * aria-labels (e2e hooks). The availability dot (P4) rides every button
 * unchanged — a collapsed tile may hide content, never state that wants a
 * human.
 *
 * Presentational by contract (unchanged): tile state lives in `app.tsx`; this
 * component owns nothing but the rail render.
 */
interface RightPanelProps {
  /** Surfaces available for the current window (`availableSurfaces`, tty first). */
  available: SurfaceKind[];
  /** The OPEN tiles — the resolved layout's `order`. */
  open: SurfaceKind[];
  /** Toggle a surface's tile: unlit → addSurface, lit → closeSurface (the
   *  caller runs the mutation + R3 persistence). */
  onToggle: (surface: SurfaceKind) => void;
}

export function RightPanel({ available, open, onToggle }: RightPanelProps) {
  // Max 3 tiles (Constitution IV): at 3, further adds are disallowed — the
  // unlit buttons render disabled instead of no-oping silently.
  const full = open.length >= 3;
  // Demoted surfaces (SURFACE_RAIL_HIDDEN, 260812-0c6o — currently `chat`)
  // render NO rail button, lit or unlit: the flag hides the toggle at render,
  // never availability (the palette's `Layout: Add/Close Chat` and an already-
  // open chat tile are unaffected — closing happens via the tile's ✕ / palette).
  const shown = available.filter((surface) => !SURFACE_RAIL_HIDDEN.has(surface));
  return (
    <div
      data-testid="right-panel-rail"
      // The rail is the top-bar cluster's vertical twin, mapping the bar's
      // spacing vocabulary: right-aligned chips at pr-3 keep their right edge
      // 12px from the window edge — co-linear with the top-bar chips (the
      // MAJOR seam); gap-3 = the bar's 12px inter-chip gap; py-2 = the 8px the
      // bar's chips keep from its own top/bottom edges. The left side hugs the
      // tile divider at ~6px — dividers are MINOR seams (6px air on both
      // sides, matching the tile-header verbs' inset on the other side), which
      // is what keeps the column at 46px instead of a symmetric-12 52px band.
      className="w-[46px] shrink-0 border-l border-border flex flex-col items-end pr-3 py-2 gap-3"
    >
      {shown.map((surface) => {
        const isOpen = open.includes(surface);
        const disabled = !isOpen && full;
        const label = SURFACE_LABEL[surface];
        return (
          <Tip
            key={surface}
            label={disabled ? "Close a tile first" : label}
            placement="left"
          >
            {/* The span wrapper keeps the tooltip alive on the DISABLED button
                (disabled controls swallow the pointer events Tip listens for). */}
            <span className="inline-flex">
              <button
                type="button"
                onClick={() => onToggle(surface)}
                disabled={disabled}
                aria-pressed={isOpen}
                aria-label={`${label} tile`}
                className={`rk-glint relative w-7 h-7 flex items-center justify-center rounded border text-[11px] font-mono transition-colors focus-visible:outline-2 focus-visible:outline-accent-green disabled:opacity-40 disabled:cursor-not-allowed ${
                  isOpen
                    ? "border-accent-green bg-accent-green/10 text-accent-green"
                    : "border-border hover:border-text-secondary text-text-secondary hover:text-text-primary"
                }`}
              >
                <span aria-hidden="true">{SURFACE_GLYPH[surface]}</span>
                {/* Availability dot (P4) — unchanged: every button renders it in
                    its availability state; the amber attention state is the
                    phase-3 seam. */}
                <span
                  aria-hidden="true"
                  className="absolute top-0.5 right-0.5 w-1 h-1 rounded-full bg-accent-green"
                />
              </button>
            </span>
          </Tip>
        );
      })}
    </div>
  );
}

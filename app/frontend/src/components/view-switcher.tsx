import type { ViewName } from "@/lib/window-view";

/**
 * ViewSwitcher — the ONE switcher UX shared by every window-view lens (spec R4,
 * change 260714-t97o-web-view-lens). A compact segmented chip in the top-bar
 * right cluster's L1 (terminal-only) tier, rendered ONLY when a window's
 * capability set exceeds `{tty}`. Two views render `[tty|web]`; more views grow
 * the segment group (chat/desktop add segments here, NOT a new component).
 *
 * The active segment is inverse-video (accent-green fill), matching the spec's
 * "active segment inverse-video". Hover uses the house `rk-glint` vocabulary
 * (green sweep + border/glyph flip); it is reduced-motion-safe because the
 * glint animation is a CSS `@media (prefers-reduced-motion)` no-op (globals.css)
 * and the component itself runs no JS animation.
 *
 * Generic by contract: it takes the available-view list + the active view + an
 * onSelect callback — it owns no view/URL/localStorage logic (that lives in
 * `window-view.ts` + `app.tsx`), so it stays a pure presentational segmented
 * control.
 */

/** Human labels for the segments. Later lenses add entries here. */
const VIEW_LABEL: Record<ViewName, string> = {
  tty: "Terminal",
  web: "Web",
};

/** Short segment glyph (kept compact for the single-row 375px top bar). */
const VIEW_SHORT: Record<ViewName, string> = {
  tty: ">_",
  web: "web",
};

/**
 * Fixed left-to-right DISPLAY order for the segments — `tty` first (spec R4 /
 * plan R7 render `[tty|web]`). This is deliberately DECOUPLED from
 * `window-view.ts`'s `HINT_ORDER` (`desktop > chat > web > tty`), which governs
 * only default-view precedence — the two orderings answer different questions.
 * Later lenses slot into this display order; any view not listed sorts to the
 * end (defensive — every implemented view is listed).
 */
const DISPLAY_ORDER: ViewName[] = ["tty", "web"];

type ViewSwitcherProps = {
  views: ViewName[];
  active: ViewName;
  onSelect: (view: ViewName) => void;
};

export function ViewSwitcher({ views, active, onSelect }: ViewSwitcherProps) {
  // Rendered only when the capability set exceeds a single view (spec R4). The
  // caller already gates on this, but guard here too so the component is safe to
  // mount unconditionally.
  if (views.length <= 1) return null;

  // Render in the fixed display order (tty-first), independent of the incoming
  // list's order (which is HINT_ORDER, web-first, from `availableViews`). Any
  // view not in DISPLAY_ORDER sorts to the END (rather than being dropped), so a
  // future lens still renders a segment if DISPLAY_ORDER isn't updated in
  // lockstep — matching the "sorts to the end" contract above.
  const listed = DISPLAY_ORDER.filter((v) => views.includes(v));
  const unlisted = views.filter((v) => !DISPLAY_ORDER.includes(v));
  const ordered = [...listed, ...unlisted];

  return (
    <span
      role="group"
      aria-label="Window view"
      className="hidden sm:inline-flex items-center rounded border border-border overflow-hidden"
    >
      {ordered.map((view) => {
        const isActive = view === active;
        return (
          <button
            key={view}
            type="button"
            onClick={() => onSelect(view)}
            aria-pressed={isActive}
            aria-label={`${VIEW_LABEL[view]} view`}
            title={`${VIEW_LABEL[view]} view`}
            className={`rk-glint px-1.5 min-h-[24px] coarse:min-h-[30px] text-[11px] font-mono flex items-center justify-center transition-colors ${
              isActive
                ? "bg-accent-green text-bg-primary"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {VIEW_SHORT[view]}
          </button>
        );
      })}
    </span>
  );
}

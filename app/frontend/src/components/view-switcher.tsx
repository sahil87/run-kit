import type { ViewName } from "@/lib/window-view";

/**
 * ViewSwitcher — the ONE switcher UX shared by every window-view lens (spec R4;
 * change 260714-t97o-web-view-lens, chat folded in from 260714-r7rq). A compact
 * segmented chip in the top-bar right cluster's L1 (terminal) tier, rendered
 * ONLY when a window's capability set exceeds `{tty}`. Two views render
 * `[tty|web]` / `[tty|chat]`; more views grow the segment group (desktop adds a
 * segment here, NOT a new component). Unlike its `hidden sm:*` L1 siblings the
 * chip is visible at ALL breakpoints — chat is a primary mobile use case.
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

/** Human labels for the segments (the accessible names). Later lenses add
 *  entries here. */
const VIEW_LABEL: Record<ViewName, string> = {
  tty: "Terminal",
  web: "Web",
  chat: "Chat",
};

/** Short segment glyph — the lowercase view name (spec R4's `[tty|chat]` style),
 *  kept compact for the single-row 375px top bar. */
const VIEW_SHORT: Record<ViewName, string> = {
  tty: "tty",
  web: "web",
  chat: "chat",
};

/**
 * Fixed left-to-right DISPLAY order for the segments — `tty` first (spec R4
 * renders `[tty|web]` / `[tty|chat]`). This is deliberately DECOUPLED from
 * `window-view.ts`'s `HINT_ORDER` (`chat > web > tty`), which governs only
 * default-view / capability ordering — the two orderings answer different
 * questions. Later lenses slot into this display order; any view not listed
 * sorts to the end (defensive — every implemented view is listed).
 */
const DISPLAY_ORDER: ViewName[] = ["tty", "web", "chat"];

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
      // Visible at ALL breakpoints (no `hidden sm:*` gate) — chat is a primary
      // mobile use case, and web deep links resolve on mobile too. `view-toggle`
      // testid is the unified chip's e2e handle (superseding #351's toggle).
      data-testid="view-toggle"
      className="inline-flex items-center rounded border border-border overflow-hidden"
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

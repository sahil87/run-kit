import type { ViewName } from "@/lib/window-view";
import {
  MENU_ROW_BASE,
  MENU_ROW_REST,
  MENU_ROW_ACTIVE,
} from "@/components/top-bar-overflow-menu";

/**
 * ViewSwitcher — the ONE switcher UX shared by every window-view lens (spec R4;
 * change 260714-t97o-web-view-lens, chat folded in from 260714-r7rq). A compact
 * segmented chip rendered ONLY when a window's capability set exceeds `{tty}`.
 * Two views render `[tty|web]` / `[tty|chat]`; more views grow the segment group
 * (desktop adds a segment here, NOT a new component).
 *
 * MENU-ONLY as of 260722-n2n4: the `view-switcher` overflow-registry entry in
 * `top-bar.tsx` carries `menuOnly: true` (the chat lens isn't fully functional
 * yet, so the pill must not advertise itself inline in the navbar), which makes
 * `ViewSwitcherMenuRows` — the per-view `View: …` rows in the "More controls"
 * chevron menu — the switcher's ONLY rendering at every width. This pill
 * component and its `barRender` wiring stay intact but UNREACHABLE, so the
 * revert when chat ships is deleting that one flag (the pill returns to its
 * former space-driven inline placement, 260717-6anu).
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

/**
 * Order the incoming view list into the fixed left-to-right `DISPLAY_ORDER`
 * (tty-first), independent of the caller's list order (which is HINT_ORDER,
 * web-first, from `availableViews`). Any view NOT in `DISPLAY_ORDER` sorts to the
 * END (rather than being dropped), so a future lens still renders even if
 * `DISPLAY_ORDER` isn't updated in lockstep. Shared by BOTH the in-bar pill and
 * the overflow `ViewSwitcherMenuRows` so bar↔menu ordering can never drift.
 */
function orderViews(views: ViewName[]): ViewName[] {
  const listed = DISPLAY_ORDER.filter((v) => views.includes(v));
  const unlisted = views.filter((v) => !DISPLAY_ORDER.includes(v));
  return [...listed, ...unlisted];
}

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

  // Render in the fixed display order (tty-first) via the shared `orderViews`
  // helper — same ordering the overflow menu rows use, so bar↔menu can't drift.
  const ordered = orderViews(views);

  return (
    <span
      role="group"
      aria-label="Window view"
      // No `hidden sm:*` gate — placement is registry-driven, not a breakpoint
      // cliff. Under the `menuOnly` flag (260722-n2n4) this pill is unreachable
      // (the registry never bar-renders it); when the flag is removed it resumes
      // the space-driven inline/overflow behavior (260717-6anu). `view-toggle`
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

/**
 * ViewSwitcherMenuRows — the menu representation of the view switcher
 * (260717-6anu), and — while the registry entry is `menuOnly` (260722-n2n4) —
 * its ONLY rendering: at every width the switcher appears in the top-bar "More
 * controls" chevron menu as ONE `role="menuitemradio"` row per available view
 * (`View: Terminal` / `View: Web` / `View: Chat`), following the multi-row
 * `menuRender` precedent (NotificationMenuRows) and the palette's `View:`
 * naming vocabulary. Rows render in the pill's fixed `DISPLAY_ORDER`
 * (tty-first), reusing the same `VIEW_LABEL` map + ordering logic as the pill
 * so the two representations can never drift.
 *
 * The ACTIVE view's row is visually marked with the pill's active-segment
 * accent-green treatment and carries `aria-checked` (the single-select radio
 * state supported by `menuitemradio` — `aria-pressed` is NOT valid on a
 * `menuitem`, so the pill's toggle-button aria does not carry over
 * verbatim), so the menu row carries the lens-indicator role in the pill's
 * absence. Clicking a row calls the same `onSelect(view)` callback the pill
 * uses (the menu's role-keyed click handler closes the panel on a
 * `menuitemradio` activation). Presentational — owns no view/URL/localStorage
 * logic.
 *
 * Styling composes the shared menu-row class variants hosted in
 * `top-bar-overflow-menu.tsx` (`MENU_ROW_BASE` + the resting `MENU_ROW_REST` /
 * active `MENU_ROW_ACTIVE` treatment) so the row layout stays in lockstep with
 * every other overflow-menu row and never drifts from `MENU_ROW_CLASS`. The
 * active row's inverse-video accent-green fill matches the pill's active segment
 * so it reads as the current lens. `tabIndex={-1}` per the menu's roving-focus
 * model.
 */
export function ViewSwitcherMenuRows({
  views,
  active,
  onSelect,
}: ViewSwitcherProps) {
  if (views.length <= 1) return null;

  // Same tty-first ordering as the in-bar pill (shared helper).
  const ordered = orderViews(views);

  return (
    <>
      {ordered.map((view) => {
        const isActive = view === active;
        return (
          <button
            key={view}
            type="button"
            role="menuitemradio"
            tabIndex={-1}
            aria-checked={isActive}
            onClick={() => onSelect(view)}
            className={`${MENU_ROW_BASE} ${isActive ? MENU_ROW_ACTIVE : MENU_ROW_REST}`}
          >
            {`View: ${VIEW_LABEL[view]}`}
          </button>
        );
      })}
    </>
  );
}

/**
 * Shared control className constants — the control geometry/state vocabulary
 * consumed by the top bar, its overflow menu, the layout chip, the open
 * split-button, and the status bar. Dependency-free (imports nothing from
 * components) so every control surface imports the SAME definitions without
 * an import cycle.
 *
 * Tailwind's scanner reads literal classes only, so sizes stay literal here
 * and mirror the `--ctl-*` custom properties on `:root` in globals.css for
 * CSS-side consumers — each size-bearing constant names the property it
 * mirrors in a lockstep comment, and the pair MUST change together (the
 * documented-lockstep convention of `COARSE_POINTER_QUERY` and
 * `STATUS_RAIL_WIDTH_PX`).
 */

/**
 * Shared overflow-menu row styling. Decomposed so callers compose exactly the
 * variant they need instead of re-declaring a drifted subset:
 *
 *  - `MENU_ROW_BASE` — layout only (full-width left-aligned flex row, padding,
 *    text size). No color/state tokens.
 *  - `MENU_ROW_REST` — the resting/hover treatment (secondary text → primary
 *    on hover, card hover bg).
 *  - `MENU_ROW_DISABLED` — the disabled-state tokens (dimmed, no hover).
 *  - `MENU_ROW_ACTIVE` — the inverse-video accent-green treatment used to mark
 *    a selected row (e.g. the active shape in `LayoutMenuRows`).
 *  - `MENU_ROW_CLASS` — the default composition (`base + rest + disabled`)
 *    used by every plain menu row.
 */
export const MENU_ROW_BASE =
  "w-full text-left flex items-center gap-2 px-2.5 py-1.5 text-xs transition-colors";
export const MENU_ROW_REST =
  "text-text-secondary hover:text-text-primary hover:bg-bg-card";
export const MENU_ROW_DISABLED =
  "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-secondary";
export const MENU_ROW_ACTIVE = "bg-accent-green text-bg-primary";
/** Default row class — the resting variant plus disabled-state tokens. */
export const MENU_ROW_CLASS = `${MENU_ROW_BASE} ${MENU_ROW_REST} ${MENU_ROW_DISABLED}`;

/**
 * Shared IN-BAR popover row styling — the dropdown rows of the split-button
 * controls themselves (`OpenTargetRow` targets, `SplitControl` directions).
 * Distinct from the chevron overflow menu's `MENU_ROW_*` scale
 * (`text-[11px] px-3` vs `text-xs px-2.5`). Carries disabled-state tokens for
 * rows that gate on a pending action (inert for rows that never disable).
 */
export const POPOVER_ROW_CLASS =
  "w-full text-left flex items-center gap-2 px-3 py-1.5 text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-card transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-secondary";

/**
 * Shared top-bar icon-button sizing. The size is a FIXED square — 28×28 on
 * fine pointers, 40×40 on coarse (the 40px coarse touch floor) — replacing
 * the old copy-pasted `min-w-[24px] min-h-[24px]` floors, which let rendered
 * sizes drift with content (the sidebar toggle rendered visibly smaller than
 * the right cluster). Decomposed like `MENU_ROW_*` so callsites with
 * state-driven colors (pressed/accent toggles) compose exactly what they need
 * around the shared geometry:
 *
 *  - `TOP_BAR_BUTTON_BASE` — geometry only (fixed square, rounded border box,
 *    centering, `shrink-0`). No color tokens.
 *  - `TOP_BAR_BUTTON_REST` — the resting/hover color treatment.
 *  - `TOP_BAR_BUTTON` — the default composition (glint + base + rest) used by
 *    every plain icon button.
 *  - `TOP_BAR_BUTTON_H` — the shared HEIGHT axis alone, for content-width
 *    chips that carry their OWN border (UpdateChip) and must align with the
 *    square buttons without a fixed width.
 *  - `TOP_BAR_SEGMENT_H` — the height for segments INSIDE a bordered chip
 *    wrapper (the split/Open segment groups): the wrapper's border adds 2px,
 *    so segments are 2px shorter to keep the chip's TOTAL box identical to
 *    the squares (26+2 = 28 fine, 38+2 = 40 coarse).
 */
export const TOP_BAR_BUTTON_BASE =
  "w-[28px] h-[28px] coarse:w-[40px] coarse:h-[40px] rounded border transition-colors flex items-center justify-center shrink-0"; // lockstep: --ctl-h-bar (fine) / --ctl-h-bar-coarse
export const TOP_BAR_BUTTON_REST =
  "border-border text-text-secondary hover:border-text-secondary";
export const TOP_BAR_BUTTON = `rk-glint ${TOP_BAR_BUTTON_BASE} ${TOP_BAR_BUTTON_REST}`;
export const TOP_BAR_BUTTON_H = "h-[28px] coarse:h-[40px]"; // lockstep: --ctl-h-bar / --ctl-h-bar-coarse
export const TOP_BAR_SEGMENT_H = "h-[26px] coarse:h-[38px]"; // lockstep: --ctl-h-bar / --ctl-h-bar-coarse minus the 2px wrapper border

/** Trailing menu-row keycap — the right-aligned chord chip on menu rows whose
 *  action has a registry binding. Matches the palette rows' kbd visual weight
 *  (command-palette.tsx), `ml-auto`-pinned to the row's right edge;
 *  `aria-hidden` at the call sites keeps the chord out of the accessible name
 *  (the row's label is the name; the keycap is visual education). */
export const MENU_ROW_KBD_CLASS =
  "ml-auto text-xs text-text-secondary bg-bg-card px-1.5 py-0.5 rounded border border-border";

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
 * The one menu-row scale — every menu/popover row (overflow chevron menu,
 * split-button dropdowns, breadcrumb dropdowns) composes these, so no second
 * row scale can drift in. Decomposed so callers compose exactly the variant
 * they need instead of re-declaring a subset:
 *
 *  - `MENU_ROW_BASE` — layout only (full-width left-aligned flex row, padding,
 *    text size) plus the height floor: 28px fine (the rendered xs/py-1.5
 *    box), 40px coarse (the touch floor). No color/state tokens.
 *  - `MENU_ROW_REST` — the resting/hover treatment (secondary text → primary
 *    on hover, card hover bg).
 *  - `MENU_ROW_DISABLED` — the disabled-state tokens (dimmed, no hover).
 *  - `MENU_ROW_CHECKED` — the ONE checked/selected treatment (scheme C: green
 *    = state): primary ink + hover fill only, worn INSTEAD of `MENU_ROW_REST`
 *    (REST-swap — never stacked, so no hover utility competes).
 *  - `MENU_ROW_CHECK_MARK` — the trailing green ✓ that carries the checked
 *    state (`aria-hidden` at the call site; the row's label stays the
 *    accessible name).
 *  - `MENU_ROW_CLASS` — the default composition (`base + rest + disabled`)
 *    used by every plain menu row.
 */
export const MENU_ROW_BASE =
  "w-full text-left flex items-center gap-2 px-2.5 py-1.5 text-xs min-h-[28px] coarse:min-h-[40px] transition-colors";
export const MENU_ROW_REST =
  "text-text-secondary hover:text-text-primary hover:bg-bg-card";
export const MENU_ROW_DISABLED =
  "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-secondary";
export const MENU_ROW_CHECKED = "text-text-primary hover:bg-bg-card";
export const MENU_ROW_CHECK_MARK = "ml-auto text-accent-green";
/** Default row class — the resting variant plus disabled-state tokens. */
export const MENU_ROW_CLASS = `${MENU_ROW_BASE} ${MENU_ROW_REST} ${MENU_ROW_DISABLED}`;

/**
 * The one popover shell — every floating menu container (overflow menu,
 * split/layout/open popovers, breadcrumb dropdown, F▴ menu) composes this and
 * adds only its own positioning, width, and height/viewport caps at the call
 * site.
 */
export const POPOVER_SHELL =
  "bg-bg-primary border border-border rounded-lg shadow-2xl py-1 z-50";
/** The one menu section-label recipe (aria-hidden decoration — menu semantics
 *  ride the rows). */
export const POPOVER_SECTION_LABEL =
  "px-2.5 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-text-secondary select-none";

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

/**
 * The one latched/on state arm (scheme C: green = state). Compose with a
 * BASE that carries NO hover color utilities (REST swapped out) so nothing
 * competes with the latch border — class stacking ties on specificity and
 * loses on compiled source order. Lockstep: the latch color algebra is
 * documented in docs/memory/run-kit/ui/visual-design.md.
 */
export const LATCHED_ARM =
  "bg-accent-green/15 border-accent-green text-accent-green hover:bg-accent-green/25";
/** Border-axis equivalent for borderless controls (rail toggles, find-bar and
 *  tile-verb glyph buttons) — ring-inset paints inside, so latching never
 *  shifts layout. */
export const LATCHED_ARM_RINGED =
  "bg-accent-green/15 ring-1 ring-inset ring-accent-green text-accent-green hover:bg-accent-green/25";

/**
 * The one switch-track recipe (scheme C: green = state) — every `role="switch"`
 * control (the server-card Protect row, the settings BoolToggle) composes these
 * around its OWN track/knob geometry, which stays per-site. The recipe carries
 * color only: ON is the translucent green track + solid green knob, OFF the
 * recessed-well ground (`bg-bg-inset` — the same "off/empty" surface the marker
 * wells and status rail use) + secondary-ink knob. No second spelling of the
 * track colors may appear at a call site.
 */
export const SWITCH_TRACK_ON = "bg-accent-green/30 border-accent-green";
export const SWITCH_TRACK_OFF = "bg-bg-inset border-border";
export const SWITCH_KNOB_ON = "bg-accent-green";
export const SWITCH_KNOB_OFF = "bg-text-secondary";

/** Trailing menu-row keycap — the right-aligned chord chip on menu rows whose
 *  action has a registry binding. Matches the palette rows' kbd visual weight
 *  (command-palette.tsx), `ml-auto`-pinned to the row's right edge;
 *  `aria-hidden` at the call sites keeps the chord out of the accessible name
 *  (the row's label is the name; the keycap is visual education). */
export const MENU_ROW_KBD_CLASS =
  "ml-auto text-xs text-text-secondary bg-bg-card px-1.5 py-0.5 rounded border border-border";

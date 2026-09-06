// Shared chip classes for every chip in the bottom bar. One definition so all
// chips render the same box (uniformity is asserted by
// tests/e2e/bottom-bar-chip-size.spec.ts).
//
// Chip size splits by pointer: 33×35 on fine pointers (lighter bar, more air
// between chips) while coarse pointers get the 40×40 touch floor and the
// tighter 4px gap, so the 375px single-row budget holds (6×40 + 5×4 = 260px).
// Lockstep: --ctl-chip-h/--ctl-chip-w (fine) and --ctl-chip-coarse in
// globals.css (:root) — the pairs MUST change together.
//
// Decomposed like TOP_BAR_BUTTON_* (controls.ts) so latched chips compose
// BASE + their own state arm with NO competing hover utility (a same-
// specificity `hover:border-*` tie would be decided by compiled source
// order — a latched chip must keep its accent border under hover):
//
//  - `KBD_BASE` — geometry, border box, radius, transition, select guard,
//    pressed fill, focus ring. No hover color utilities.
//  - `KBD_REST` — the neutral-hover arm.
//  - `KBD_CLASS` — the default composition (`base + rest`) used by every
//    plain chip.
export const KBD_BASE =
  "rk-glint min-h-[33px] min-w-[35px] coarse:min-h-[40px] coarse:min-w-[40px] flex items-center justify-center px-1 py-0 text-xs border border-border rounded select-none transition-colors active:bg-bg-card focus-visible:outline-2 focus-visible:outline-accent";
export const KBD_REST = "hover:border-text-secondary";
export const KBD_CLASS = `${KBD_BASE} ${KBD_REST}`;

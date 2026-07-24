// Shared class for every chip in the bottom bar — the BottomBar key chips and
// the ArrowPad trigger. One constant so all chips render the same box
// (uniformity is asserted by tests/e2e/bottom-bar-chip-size.spec.ts).
//
// Chip size splits by pointer: 33×35 on fine pointers (lighter bar, more air
// between chips) while coarse pointers keep the full 36×36 touch target and
// the tighter 4px gap so the 375px single-row budget is unchanged.
export const KBD_CLASS =
  "rk-glint min-h-[33px] min-w-[35px] coarse:min-h-[36px] coarse:min-w-[36px] flex items-center justify-center px-1 py-0 text-xs border border-border rounded select-none transition-colors hover:border-text-secondary active:bg-bg-card focus-visible:outline-2 focus-visible:outline-accent";

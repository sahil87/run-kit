/**
 * Pure fit computation for the gui tile header's measured fold — the third
 * instance of the shipped measured-overflow idiom (after
 * `lib/top-bar-overflow.ts`'s `computeVisibleCount` and
 * `lib/crumb-collapse.ts`). The component (components/gui-toolbar.tsx) owns
 * all DOM measurement (one ResizeObserver + a hidden probe row); this module
 * owns ONLY the decision, so the ladder behavior is unit-testable without
 * layout (jsdom has no layout engine).
 *
 * The ladder: an ordered item list (pin `⚙` · 1 screen size · 2 zoom ·
 * 3 quality · 4 input · 5 launch · 6 health) whose items fit FROM THE FRONT;
 * the folded suffix opens in the `⚙` panel. Items carry a `group` id — a
 * divider is charged BETWEEN two rendered items of different groups. Two
 * items (size, quality) carry a `short` width: degradation is spent before
 * dropping (cheapest move first), LEAST-important label first (quality
 * degrades before size), and all degradation is spent before any item folds.
 *
 * The `⚙` pinned block is conditional (D3 × D4): the fit runs TWO passes —
 * fit once with NO reserve; if every item fits, nothing folds, no `⚙`
 * renders, and nothing is reserved; otherwise re-fit with the pinned block's
 * measured width reserved BEFORE any ladder item. The reserve therefore never
 * causes the fold that justifies it.
 *
 * Hysteresis is one-sided on the EXPAND edge (the crumb-collapse port):
 * collapsing is immediate; expanding to a less-folded state requires the
 * available width to clear the expansion threshold by
 * GUI_TOOLBAR_FOLD_HYSTERESIS_PX, so a drag hovering the boundary cannot flap.
 *
 * Unmeasured environments (jsdom, pre-mount, hidden probes reading 0) keep
 * the previous state; the cold default is FULLY EXPANDED (the safe cold
 * answer — the collapse-first render comes from the component's null initial
 * state + pre-paint measure, not from this module).
 */

/** One-sided hysteresis on the EXPAND edge, in px (matches
 *  CRUMB_COLLAPSE_HYSTERESIS_PX; an own constant keeps this module
 *  dependency-free like both precedents). */
export const GUI_TOOLBAR_FOLD_HYSTERESIS_PX = 24;

export interface GuiToolbarFoldItem {
  /** Measured width at the full label. */
  full: number;
  /** Measured width at the degraded label — present only on degradable items. */
  short?: number;
  /** Group id — a divider is charged between two rendered items whose
   *  groups differ. */
  group: string;
}

export interface GuiToolbarFold {
  /** How many LEADING items render inline; the rest fold into the `⚙` panel. */
  visibleCount: number;
  /** Rendered items at index >= degradeFrom use their degraded label. */
  degradeFrom: number;
}

/** Whether anything folded — drives the conditional `⚙` pinned block. */
export function guiToolbarFolded(fold: GuiToolbarFold, itemCount: number): boolean {
  return fold.visibleCount < itemCount;
}

/** The rendered width of the `count` leading items with degradation applied
 *  from `degradeFrom`, dividers charged at group boundaries. */
function ladderWidth(
  items: readonly GuiToolbarFoldItem[],
  count: number,
  degradeFrom: number,
  dividerWidth: number,
): number {
  let used = 0;
  let lastGroup: string | null = null;
  for (let i = 0; i < count; i++) {
    const item = items[i];
    used += item.short !== undefined && i >= degradeFrom ? item.short : item.full;
    if (lastGroup !== null && item.group !== lastGroup) used += dividerWidth;
    lastGroup = item.group;
  }
  return used;
}

/** Single-pass fit against `budget`: spend every degradation step
 *  (least-important first), then fold from the tail while over budget. */
function fitLadder(
  budget: number,
  items: readonly GuiToolbarFoldItem[],
  dividerWidth: number,
): GuiToolbarFold {
  const n = items.length;
  let degradeFrom = n;
  if (ladderWidth(items, n, degradeFrom, dividerWidth) > budget) {
    // Degrade from the END of the ladder backwards: the least important
    // label gives up its text first. Every degradation is spent before the
    // first fold.
    for (let d = n - 1; d >= 0 && ladderWidth(items, n, degradeFrom, dividerWidth) > budget; d--) {
      if (items[d].short !== undefined) degradeFrom = d;
    }
  }
  let visibleCount = n;
  while (
    visibleCount > 0 &&
    ladderWidth(items, visibleCount, Math.min(degradeFrom, visibleCount), dividerWidth) > budget
  ) {
    visibleCount--;
  }
  return { visibleCount, degradeFrom: Math.min(degradeFrom, visibleCount) };
}

/** The two-pass reserve decision: no reserve while everything fits. */
function decide(
  availableWidth: number,
  items: readonly GuiToolbarFoldItem[],
  pinnedWidth: number,
  dividerWidth: number,
): GuiToolbarFold {
  const pass = fitLadder(availableWidth, items, dividerWidth);
  if (pass.visibleCount === items.length) return pass;
  return fitLadder(availableWidth - pinnedWidth, items, dividerWidth);
}

/** Expansion ordering: more visible items is more expanded; at equal counts,
 *  a LARGER degradeFrom means fewer degraded labels, hence more expanded. */
function expandRank(fold: GuiToolbarFold, itemCount: number): number {
  return fold.visibleCount * (itemCount + 1) + fold.degradeFrom;
}

/**
 * The fold decision for one measurement.
 *
 * - `availableWidth` — the header spring's measured content width.
 * - `items` — the ladder in priority order with measured full/short widths.
 * - `pinnedWidth` — the pinned block's measured width (divider + `⚙`),
 *   reserved ONLY once something folds (the two-pass rule).
 * - `dividerWidth` — one group divider's measured footprint (margins
 *   included).
 * - `prev` — the current fold; the expand edge carries hysteresis, so the
 *   decision is stateful.
 */
export function computeGuiToolbarFold(
  availableWidth: number,
  items: readonly GuiToolbarFoldItem[],
  pinnedWidth: number,
  dividerWidth: number,
  prev: GuiToolbarFold | null,
  hysteresisPx: number = GUI_TOOLBAR_FOLD_HYSTERESIS_PX,
): GuiToolbarFold {
  // Unmeasured environment (jsdom, pre-mount): every PROBE width reads zero —
  // keep the previous state; the cold default is the fully-expanded form (the
  // crumb-collapse rule). A genuinely zero spring (a real measurement — the
  // probe still reads real widths) is NOT degenerate: the fold collapses to
  // the pinned block alone.
  if (items.length === 0 || items.every((i) => i.full <= 0)) {
    return prev ?? { visibleCount: items.length, degradeFrom: items.length };
  }
  const raw = decide(availableWidth, items, pinnedWidth, dividerWidth);
  // One-sided hysteresis on the EXPAND edge: a less-folded rendering must be
  // re-proven against a budget shrunk by the margin; otherwise hold `prev`.
  if (prev && expandRank(raw, items.length) > expandRank(prev, items.length)) {
    const guarded = decide(availableWidth - hysteresisPx, items, pinnedWidth, dividerWidth);
    return expandRank(guarded, items.length) > expandRank(prev, items.length) ? guarded : prev;
  }
  return raw;
}

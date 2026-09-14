/**
 * Pure fit computation for the status bar's measured fold — the fourth
 * instance of the shipped measured-overflow idiom (after
 * `lib/top-bar-overflow.ts`'s `computeVisibleCount`, `lib/crumb-collapse.ts`,
 * and `lib/gui-toolbar-fold.ts`). The component (components/status-bar.tsx)
 * owns all DOM measurement (one ResizeObserver + a hidden probe row); this
 * module owns ONLY the decision, so the fold behavior is unit-testable
 * without layout (jsdom has no layout engine).
 *
 * Unlike the gui toolbar's SUFFIX fold (the tail of an ordered ladder drops),
 * this is a PRIORITY fold: any position may fold, chosen by an explicit
 * per-item `prio` (LOWER dies first), because the bar's never-fold items
 * (`pr`, `fab`, the zen exit, the stale clock chip, the connection dot) are
 * scattered across both clusters. It is a sibling of the gui module, not a
 * generalisation — the two share the two-pass reserve and hysteresis rules
 * and little else.
 *
 * One ladder spans BOTH clusters (the two sides of the bar's `ml-auto`
 * spring no longer degrade independently). The fit charges a fixed PAD +
 * DOT + GAP per bar (horizontal padding, the connection dot, its gap) and
 * `GAP × (renderedInCluster − 1)` per cluster — no gap is charged across
 * the spring (the bar root carries none; the spring alone separates the
 * clusters). The one gap override is `pairGap`: an item whose rendered
 * partner sits with it in a tighter wrapper (the `host`/`version` pair's
 * `gap-1`) charges that width instead of GAP, only while the named partner
 * is its surviving neighbor. While the rendered width exceeds the budget
 * the lowest-`prio`
 * item folds; ties fold the rightmost in display order first; `prio: null`
 * items never fold. The `…` chevron's width is reserved in a SECOND pass
 * only once something folds, so the reserve never causes the fold that
 * justifies it.
 *
 * Truncation is the last resort: when every foldable item has folded and the
 * never-fold set still overflows, the RIGHTMOST never-fold item flagged
 * `truncatable` takes `min-w-0 truncate` (at most one). With nothing
 * truncatable the bar's `overflow-hidden` clips.
 *
 * Hysteresis is one-sided on the EXPAND edge (the crumb-collapse / gui
 * port): collapsing is immediate; expanding to a less-folded state requires
 * the available width to clear the expansion threshold by
 * STATUS_BAR_FOLD_HYSTERESIS_PX, so a drag hovering the boundary cannot
 * flap.
 *
 * Unmeasured environments (jsdom, pre-mount, hidden probes reading 0) keep
 * the previous state; the cold default is FULLY EXPANDED (the safe cold
 * answer — the collapse-first render comes from the component's null
 * initial state + pre-paint measure, not from this module).
 */

/** One-sided hysteresis on the EXPAND edge, in px (matches
 *  CRUMB_COLLAPSE_HYSTERESIS_PX / GUI_TOOLBAR_FOLD_HYSTERESIS_PX; an own
 *  constant keeps this module dependency-free like all three precedents). */
export const STATUS_BAR_FOLD_HYSTERESIS_PX = 24;

/** The bar's horizontal padding (`px-2` on both sides). */
export const STATUS_BAR_FOLD_PAD_PX = 16;
/** The connection dot's footprint — the right cluster's terminator, never
 *  an item. */
export const STATUS_BAR_FOLD_DOT_PX = 8;
/** The bar's `gap-3`, charged BETWEEN rendered items of one cluster. */
export const STATUS_BAR_FOLD_GAP_PX = 12;

export interface StatusBarFoldItem {
  id: string;
  /** Probed natural width (0 = unmeasured). */
  widthPx: number;
  /** Fold priority — LOWER dies first; `null` = never folds. */
  prio: number | null;
  /** Which side of the `ml-auto` spring the item renders on — gaps are
   *  charged per cluster. */
  cluster: "left" | "right";
  /** Eligible for the last-survivor truncation (text-bearing never-fold
   *  items: `pr`, `fab`). */
  truncatable?: boolean;
  /** Pair-gap override: while the named partner is this item's next
   *  surviving same-cluster neighbor, charge `px` between them instead of
   *  GAP (the `host`/`version` wrapper renders `gap-1`, tighter than the
   *  cluster's `gap-3`). Absent or folded partner ⇒ the full GAP — the
   *  wrapper rejoins the cluster as one ordinary child. */
  pairGap?: { withId: string; px: number };
}

export interface StatusBarFold {
  /** Ids folded into the `…` menu, in DISPLAY order. */
  folded: string[];
  /** Set only when the never-fold set alone overflows: the one survivor
   *  that gets `min-w-0 truncate`. */
  truncateId: string | null;
}

/** The rendered width of the surviving items: widths plus
 *  `GAP × (renderedInCluster − 1)` per cluster — a flex row's `gap`
 *  behaviour, with no gap charged across the spring. A surviving item's
 *  `pairGap` replaces the GAP between it and its named partner while the
 *  partner is its next surviving neighbor. */
function renderedWidth(
  items: readonly StatusBarFoldItem[],
  folded: ReadonlySet<string>,
): number {
  let used = 0;
  for (const cluster of ["left", "right"] as const) {
    let prev: StatusBarFoldItem | null = null;
    for (const item of items) {
      if (item.cluster !== cluster || folded.has(item.id)) continue;
      if (prev) {
        const pair = prev.pairGap;
        used += pair && pair.withId === item.id ? pair.px : STATUS_BAR_FOLD_GAP_PX;
      }
      used += item.widthPx;
      prev = item;
    }
  }
  return used;
}

/** Single-pass fit against `budgetPx`: fold the lowest-`prio` item (ties
 *  fold the rightmost in display order) until the survivors fit or only
 *  never-fold items remain; then, if the never-fold set still overflows,
 *  mark the rightmost truncatable survivor. */
function fitOnce(
  items: readonly StatusBarFoldItem[],
  budgetPx: number,
): StatusBarFold {
  const folded = new Set<string>();
  while (renderedWidth(items, folded) > budgetPx) {
    let victim = -1;
    let victimPrio = Infinity;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.prio === null || folded.has(item.id)) continue;
      if (item.prio < victimPrio || (item.prio === victimPrio && i > victim)) {
        victim = i;
        victimPrio = item.prio;
      }
    }
    if (victim === -1) break;
    folded.add(items[victim].id);
  }
  let truncateId: string | null = null;
  if (renderedWidth(items, folded) > budgetPx) {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.prio === null && item.truncatable && !folded.has(item.id)) {
        truncateId = item.id;
        break;
      }
    }
  }
  return {
    folded: items.filter((item) => folded.has(item.id)).map((item) => item.id),
    truncateId,
  };
}

/** The two-pass reserve decision: fit once with NO chevron reserve; only
 *  when something folds does the re-fit charge `chevronPx + GAP` (the
 *  chevron joins the right cluster as one more rendered item). The reserve
 *  therefore never causes the fold that justifies it. */
function decide(
  items: readonly StatusBarFoldItem[],
  availablePx: number,
  chevronPx: number,
): StatusBarFold {
  const budget = availablePx - STATUS_BAR_FOLD_PAD_PX - STATUS_BAR_FOLD_DOT_PX - STATUS_BAR_FOLD_GAP_PX;
  const pass = fitOnce(items, budget);
  if (pass.folded.length === 0) return pass;
  return fitOnce(items, budget - chevronPx - STATUS_BAR_FOLD_GAP_PX);
}

/** Expansion ordering for the hysteresis edge: more rendered items is more
 *  expanded; at equal counts, an untruncated bar is more expanded than a
 *  truncating one. */
function expandRank(fold: StatusBarFold, itemCount: number): number {
  return (itemCount - fold.folded.length) * 2 + (fold.truncateId ? 0 : 1);
}

/**
 * The fold decision for one measurement.
 *
 * - `items` — every candidate segment in display order (left cluster, then
 *   right), with probed natural widths.
 * - `availablePx` — the bar root's `clientWidth`.
 * - `chevronPx` — the `…` button's probed width, reserved ONLY once
 *   something folds (the two-pass rule).
 * - `prev` — the current fold; the expand edge carries hysteresis, so the
 *   decision is stateful. `prev` is first NORMALIZED against the current
 *   candidates: a folded id that vanished from the set or turned never-fold
 *   (the clock chip going stale mid-hold) is dropped, and a `truncateId`
 *   naming a no-longer-truncatable item is cleared — otherwise the rank
 *   comparison counts ghosts and the hold branch can return a fold hiding
 *   a never-fold segment or naming a nonexistent one.
 */
export function computeStatusBarFold(
  items: readonly StatusBarFoldItem[],
  availablePx: number,
  chevronPx: number,
  prev: StatusBarFold | null,
  hysteresisPx: number = STATUS_BAR_FOLD_HYSTERESIS_PX,
): StatusBarFold {
  // Unmeasured environment (jsdom, pre-mount): every PROBE width reads zero
  // — keep the previous state; the cold default is the fully-expanded form
  // (the crumb-collapse rule).
  if (items.length === 0 || items.every((i) => i.widthPx <= 0)) {
    return prev ?? { folded: [], truncateId: null };
  }
  const normalized: StatusBarFold | null = prev
    ? {
        folded: prev.folded.filter((id) => items.some((i) => i.id === id && i.prio !== null)),
        truncateId:
          prev.truncateId !== null &&
          items.some((i) => i.id === prev.truncateId && i.prio === null && i.truncatable)
            ? prev.truncateId
            : null,
      }
    : null;
  const raw = decide(items, availablePx, chevronPx);
  // One-sided hysteresis on the EXPAND edge: a less-folded rendering must be
  // re-proven against a budget shrunk by the margin; otherwise hold `prev`.
  if (normalized && expandRank(raw, items.length) > expandRank(normalized, items.length)) {
    const guarded = decide(items, availablePx - hysteresisPx, chevronPx);
    return expandRank(guarded, items.length) > expandRank(normalized, items.length) ? guarded : normalized;
  }
  return raw;
}

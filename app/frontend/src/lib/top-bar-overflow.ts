/**
 * Pure fit computation for the top-bar right-cluster overflow (260715-h1ck).
 * Follows the `lib/palette-*.ts` pure-helper pattern: dependency-free and
 * unit-testable without mounting the shell. The measurement wiring (the
 * ResizeObserver + child-width reads) lives in the component; this module owns
 * ONLY the arithmetic of "how many leading items fit".
 *
 * The right cluster degrades as a priority+ overflow menu: the exempt trailing
 * items (chevron, dot) always render, and the ordered non-exempt items — the
 * ViewSwitcher is now the FIRST of these (260717-6anu), no longer exempt — are
 * consumed FROM THE FRONT as width shrinks (L1 drops before L2 before L3 — the
 * caller supplies the widths already in pyramid order). Surviving items keep
 * their positions, so the count returned is the number of LEADING items that
 * fit; the remainder overflow into the menu.
 */

/**
 * How many of the ordered non-exempt items fit in `availableWidth` once
 * `reservedWidth` (the trailing exempt chevron + dot + their gap) is set aside.
 *
 * Items are fit greedily from index 0. A gap of `gap` px is charged BETWEEN
 * rendered items only (n items ⇒ n−1 gaps), matching a flex row's `gap`
 * behavior — the reserved block already accounts for the gaps on its own side.
 *
 * Edge cases:
 *  - `availableWidth <= 0` or a budget (`availableWidth - reservedWidth`) that
 *    cannot fit even the first item ⇒ 0 (everything overflows).
 *  - every item fits ⇒ `itemWidths.length` (nothing overflows).
 *
 * All inputs are treated as measured pixel values; nothing is hardcoded here.
 */
export function computeVisibleCount(
  availableWidth: number,
  itemWidths: number[],
  reservedWidth: number,
  gap: number,
): number {
  const budget = availableWidth - reservedWidth;
  if (budget <= 0) return 0;

  let used = 0;
  let count = 0;
  for (const w of itemWidths) {
    // Charge a gap before every item except the first rendered one.
    const next = used + (count > 0 ? gap : 0) + w;
    if (next > budget) break;
    used = next;
    count += 1;
  }
  return count;
}

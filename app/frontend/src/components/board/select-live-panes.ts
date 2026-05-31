/**
 * Pure selection of which desktop board panes keep a live relay WebSocket.
 *
 * Background: on plaintext HTTP/1.1 origins the browser caps persistent
 * connections at ~6 per origin. `DesktopRow` would otherwise hold one relay
 * WebSocket per pinned pane indefinitely (it hardcoded `paused={false}`),
 * starving the SSE stream and REST/chunk fetches. This helper bounds the live
 * set so only genuinely-visible panes (and the focused pane) stay connected,
 * never exceeding the cap.
 *
 * The rules, in priority order:
 *   1. The focused pane is ALWAYS live — exempt from both the visibility gate
 *      and the cap. This preserves `Cmd+]`/`Cmd+[` cycling, imperative focus,
 *      and BottomBar targeting against the focused terminal.
 *   2. Among the remaining visible panes, the most-recently-focused are kept
 *      live first, up to the cap. Least-recently-focused visible panes beyond
 *      the cap are paused (the wide-monitor edge case where more panes fit
 *      on-screen than the cap allows).
 *
 * This is geometry-aware (it only ever considers *visible* panes as live
 * candidates) plus an LRU backstop for the cap — it never pauses the focused
 * pane and never keeps an off-screen non-focused pane live.
 */
export interface SelectLivePanesInput {
  /** Indices of panes currently within the viewport (incl. pre-warm margin). */
  visible: ReadonlySet<number>;
  /** The currently-focused pane index (always kept live). */
  focusedIndex: number;
  /**
   * Pane indices ordered most-recently-focused first. Used to break ties when
   * more visible panes than the cap compete for the remaining live slots.
   * Indices absent from this list are treated as least-recently-focused.
   */
  mruOrder: readonly number[];
  /** Maximum number of simultaneously-live panes. */
  cap: number;
}

/**
 * Returns the set of pane indices that should be live (unpaused). All other
 * panes should be paused. The focused pane is always included; the result size
 * is at most `max(cap, 1)` (the focused pane is exempt from the cap, so a cap
 * of 0 still yields the focused pane).
 */
export function selectLivePanes({
  visible,
  focusedIndex,
  mruOrder,
  cap,
}: SelectLivePanesInput): Set<number> {
  const live = new Set<number>();

  // Rule 1: focused pane is always live, exempt from visibility and cap.
  live.add(focusedIndex);

  // Rule 2: fill remaining live slots from visible panes, most-recently-focused
  // first. Order visible candidates by MRU rank; unranked candidates come last
  // (least-recently-focused), preserving their relative index order for
  // determinism.
  const candidates = [...visible].filter((idx) => idx !== focusedIndex);
  const mruRank = new Map<number, number>();
  mruOrder.forEach((idx, rank) => mruRank.set(idx, rank));
  candidates.sort((a, b) => {
    const ra = mruRank.get(a) ?? Number.POSITIVE_INFINITY;
    const rb = mruRank.get(b) ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    return a - b;
  });

  for (const idx of candidates) {
    if (live.size >= cap) break;
    live.add(idx);
  }

  return live;
}

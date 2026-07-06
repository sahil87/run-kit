/**
 * Attention rollup badge (260706-y1ar; status-pyramid.md § Attention
 * Propagation). A small count chip surfacing how many windows/panes below this
 * surface are `waiting` (an agent blocked on a human). Rendered on the session
 * row, the Cockpit server tile, and the board header. Renders NOTHING when the
 * count is 0 (attention badges are present only when they mean "something needs
 * you"), so callers can mount it unconditionally.
 *
 * Styling follows the existing count-chip vocabulary (session-tiles' fab-stage
 * chip: `text-xs px-1.5 py-0.5 rounded`) but in the CONSTANT yellow of the
 * waiting overlay — the same "yellow = an agent needs you now" glance language
 * the status-dot halo uses (yellow-400, theme-independent). It is text, not
 * motion — the count is legible with color and the accessible label, never
 * color-only. No pulse here (the pulse lives on the per-window dot/seam); the
 * rollup is a quiet count.
 */
export function WaitingBadge({ count, label }: { count: number; label?: string }) {
  if (count <= 0) return null;
  return (
    <span
      data-testid="waiting-badge"
      className="shrink-0 text-xs leading-none px-1.5 py-0.5 rounded bg-yellow-400/15 text-yellow-400 font-medium tabular-nums"
      aria-label={label ?? `${count} agent${count === 1 ? "" : "s"} waiting for input`}
      title={label ?? `${count} agent${count === 1 ? "" : "s"} waiting for input`}
    >
      {count}
      <span aria-hidden="true">{"⚠"}</span>
    </span>
  );
}

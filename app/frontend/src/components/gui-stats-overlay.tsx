import { formatGuiStats, type GuiStats } from "@/lib/gui-stats";

/**
 * GuiStatsOverlay — the gui tile's monospace corner stats line (spec
 * docs/specs/gui.md § Smoothness targets): fps · relay Mbit/s · ping RTT ·
 * desktop size · zoom, absolutely positioned at the canvas wrapper's
 * top-right in the zoom badge's classes (GuiSurface suppresses the badge
 * while the overlay is up — they share the corner and the zoom segment).
 * Unsampled values render `—`.
 */
export function GuiStatsOverlay({ stats }: { stats: GuiStats }) {
  return (
    <div
      data-testid="gui-stats-overlay"
      className="absolute top-2 right-2 z-10 px-1.5 py-0.5 rounded border border-border bg-bg-primary/80 text-text-secondary text-xs font-mono select-none pointer-events-none"
    >
      {formatGuiStats(stats)}
    </div>
  );
}

import { Tip } from "@/components/tip";
import { StatusDot } from "@/components/status-dot";
import { TileCloseGlyph } from "@/components/top-bar-icons";
import { SURFACE_GLYPH, SURFACE_LABEL, type SurfaceKind } from "@/lib/surface-layout";
import type { WindowInfo } from "@/types";

/**
 * The away placeholder (spec docs/specs/surface-layout.md — tiles from other
 * tabs): a bare leaf whose surface is live in ANOTHER tab renders this
 * INSTEAD of mounting the surface (a tty opens no relay stream — the mount is
 * gated on the caller's side, not hidden here). The slot never left the
 * layout, so bring back restores the exact spot. The ✕ dismisses the slot
 * entirely (the remaining tiles fill); it is hidden when the placeholder is
 * the only leaf, since a layout never renders empty — closing there would
 * fall back to this same placeholder. Layout and fill behavior come from the
 * tile wrapper the caller mounts this into (a sole-leaf placeholder fills the
 * tab).
 */
export function SurfacePlaceholder({
  kind,
  holderName,
  statusWindow,
  showClose,
  onBringBack,
  onGoTo,
  onClose,
}: {
  kind: SurfaceKind;
  /** The holder tab's display name (its window name, id as fallback). */
  holderName: string;
  /** The route window's record — the tty status dot reads it exactly as the
   *  sidebar row does. Non-tty kinds carry no dot (the tile-header rule). */
  statusWindow?: WindowInfo | null;
  /** False hides ✕ — the placeholder is the layout's only leaf. */
  showClose: boolean;
  onBringBack: () => void;
  onGoTo: () => void;
  onClose: () => void;
}) {
  const label = SURFACE_LABEL[kind];
  return (
    <div
      data-testid="surface-placeholder"
      className="relative flex-1 min-h-0 m-3 rounded-md border border-dashed border-border flex flex-col items-center justify-center gap-2 font-mono text-[11px] text-text-secondary select-none"
    >
      {showClose && (
        <Tip label={`Close ${label}`}>
          <button
            type="button"
            aria-label={`Close ${label}`}
            onClick={onClose}
            className="absolute top-1 right-1 inline-flex items-center justify-center h-[24px] w-[24px] coarse:h-[26px] coarse:w-[26px] rounded transition-colors hover:bg-bg-card hover:text-signal-red"
          >
            <TileCloseGlyph />
          </button>
        </Tip>
      )}
      <span className="flex items-center gap-1.5">
        {kind === "tty" && statusWindow && <StatusDot win={statusWindow} />}
        <span aria-hidden="true">{SURFACE_GLYPH[kind]}</span>
        <span>
          <span className="text-text-primary">{label}</span> is in tab {holderName}
        </span>
      </span>
      <span className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBringBack}
          className="rounded border border-accent-green px-2 py-0.5 text-accent-green transition-colors hover:bg-accent-green/10"
        >
          bring back
        </button>
        <button
          type="button"
          onClick={onGoTo}
          className="rounded border border-border px-2 py-0.5 text-text-secondary transition-colors hover:bg-bg-card hover:text-text-primary"
        >
          go to {holderName}
        </button>
      </span>
    </div>
  );
}

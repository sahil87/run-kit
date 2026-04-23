import type { LanePin } from "@/hooks/use-pinned-lanes";
import type { WindowInfo } from "@/types";

type LaneHeaderProps = {
  pin: LanePin;
  connected: boolean;
  onUnpin: () => void;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  windowInfo?: WindowInfo;
  onDoubleClick?: () => void;
};

export function LaneHeader({ pin, connected, onUnpin, draggable, onDragStart, onDragEnd, windowInfo, onDoubleClick }: LaneHeaderProps) {
  const terminalHref = `/${encodeURIComponent(pin.server)}/${encodeURIComponent(pin.session)}/${pin.windowIndex}`;
  return (
    <div
      className="group/header relative flex items-center justify-between px-2 py-1 bg-bg-card border-b border-border text-sm select-none shrink-0"
      onDoubleClick={onDoubleClick}
    >
      {/* Drag grip — centered tab that slides down on hover */}
      {draggable && (
        <span
          className="absolute left-1/2 -translate-x-1/2 top-0 -translate-y-full group-hover/header:translate-y-0 opacity-0 group-hover/header:opacity-100 transition-all duration-150 cursor-grab active:cursor-grabbing bg-bg-card border border-border border-t-0 rounded-b px-2 py-0.5 z-20"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            const header = e.currentTarget.parentElement;
            if (header) e.dataTransfer.setDragImage(header, 0, 0);
            onDragStart?.();
          }}
          onDragEnd={() => onDragEnd?.()}
          title="Drag to reorder"
        >
          <svg width="16" height="4" viewBox="0 0 16 4" fill="currentColor" className="text-text-secondary" aria-hidden="true">
            <circle cx="2" cy="2" r="1.2" />
            <circle cx="6" cy="2" r="1.2" />
            <circle cx="10" cy="2" r="1.2" />
            <circle cx="14" cy="2" r="1.2" />
          </svg>
        </span>
      )}
      <span className="text-text-secondary truncate mr-2">
        <span className="text-text-primary">{pin.server}</span>
        <span className="mx-1" aria-hidden="true">&middot;</span>
        <span>{pin.session}</span>
        <span className="mx-1" aria-hidden="true">&middot;</span>
        <span>{windowInfo?.name ?? pin.windowIndex}</span>
      </span>

      <div className="flex items-center gap-2 shrink-0">
        {/* Connection status dot */}
        <span
          className={`block w-2 h-2 rounded-full ${
            connected ? "bg-accent-green" : "bg-text-secondary"
          }`}
          role="status"
          aria-label={connected ? "Connected" : "Disconnected"}
        />

        {/* Open in terminal link */}
        <a
          href={terminalHref}
          className="text-accent hover:underline text-xs"
          title="Open in terminal"
        >
          Open
        </a>

        {/* Unpin button */}
        <button
          type="button"
          onClick={onUnpin}
          className="text-text-secondary hover:text-text-primary text-xs leading-none"
          aria-label="Unpin lane"
          title="Unpin"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

import type { LanePin } from "@/hooks/use-pinned-lanes";

type LaneHeaderProps = {
  pin: LanePin;
  connected: boolean;
  onUnpin: () => void;
};

export function LaneHeader({ pin, connected, onUnpin }: LaneHeaderProps) {
  const terminalHref = `/${encodeURIComponent(pin.server)}/${encodeURIComponent(pin.session)}/${pin.windowIndex}`;

  return (
    <div className="flex items-center justify-between px-2 py-1 bg-bg-card border-b border-border text-sm select-none shrink-0">
      <span className="text-text-secondary truncate mr-2">
        <span className="text-text-primary">{pin.server}</span>
        <span className="mx-1" aria-hidden="true">&middot;</span>
        <span>{pin.session}</span>
        <span className="mx-1" aria-hidden="true">&middot;</span>
        <span>{pin.windowIndex}</span>
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

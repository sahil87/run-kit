import { CollapsiblePanel } from "./collapsible-panel";
import { HostMetrics } from "../host-metrics";
import { useHostMetrics, useMetrics } from "@/contexts/session-context";

type HostPanelProps = {
  /** Health of whatever source feeds this panel: the current server's
   *  subscription on server routes, the host-metrics source on the board route
   *  (where no server-scoped signal exists) — derived by `BottomPanels`. */
  isConnected: boolean;
};

export function HostPanel({ isConnected }: HostPanelProps) {
  // Server-scoped metrics win when present; fall back to the host-global
  // metrics broadcast (available on EVERY route) when they are null — the
  // board route has no `currentServer`, so the server-scoped slice is null by
  // construction there (260720-zx4i). The two arrive on the same tick when a
  // server is attached, so the fallback is harmless on server routes too.
  const serverMetrics = useMetrics();
  const hostMetrics = useHostMetrics();
  const metrics = serverMetrics ?? hostMetrics;
  const hostnameHeader = metrics ? (
    <>
      <span className="truncate text-text-primary font-mono">{metrics.hostname}</span>
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
          isConnected ? "bg-accent-green" : "bg-text-secondary"
        }`}
        title={isConnected ? "SSE connected" : "SSE disconnected"}
      />
    </>
  ) : null;

  return (
    <CollapsiblePanel title="Host" storageKey="runkit-panel-host" defaultOpen={true} headerRight={hostnameHeader}>
      {!metrics ? (
        <div className="text-xs text-text-secondary">No metrics</div>
      ) : (
        <HostMetrics metrics={metrics} />
      )}
    </CollapsiblePanel>
  );
}

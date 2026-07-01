import { CollapsiblePanel } from "./collapsible-panel";
import { HostMetrics } from "../host-metrics";
import { useMetrics } from "@/contexts/session-context";

type HostPanelProps = {
  isConnected: boolean;
};

export function HostPanel({ isConnected }: HostPanelProps) {
  const metrics = useMetrics();
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

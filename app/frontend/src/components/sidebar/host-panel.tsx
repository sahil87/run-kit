import { useState, useEffect, useRef } from "react";
import { CollapsiblePanel } from "./collapsible-panel";
import { sparkline } from "@/lib/sparkline";
import { gaugeBar, gaugeColor, formatMemory } from "@/lib/gauge";
import { useMetrics } from "@/contexts/session-context";

/** Format uptime seconds as "Nd Nh" or "Nh Nm" if < 1 day. */
function formatUptime(secs: number): string {
  if (secs <= 0) return "0m";
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Format bytes as compact disk display (e.g., "82/250G"). */
function formatDisk(used: number, total: number): string {
  const GB = 1024 * 1024 * 1024;
  const usedG = used / GB;
  const totalG = total / GB;
  return `${Math.round(usedG)}/${Math.round(totalG)}G`;
}

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
        <div className="flex flex-col gap-0 text-xs font-mono">
          {/* CPU sparkline — label+pct fixed, sparkline clips oldest (left) data on narrow panels */}
          <div className="flex items-baseline gap-[1ch]">
            <span className="text-text-secondary shrink-0">cpu</span>
            <div className="text-accent flex-1 min-w-0 overflow-hidden" dir="rtl">
              <span className="whitespace-nowrap" dir="ltr">{sparkline(metrics.cpu.samples)}</span>
            </div>
            <span className="text-text-primary shrink-0">{Math.round(metrics.cpu.current)}%</span>
          </div>

          {/* Memory gauge */}
          <MemoryLine used={metrics.memory.used} total={metrics.memory.total} />

          {/* Disk + Uptime */}
          <div className="text-text-secondary truncate">
            <span>dsk </span>
            <span>{formatDisk(metrics.disk.used, metrics.disk.total)}</span>
            <span> &middot; up </span>
            <span>{formatUptime(metrics.uptime)}</span>
          </div>

          {/* Load averages */}
          <LoadLine
            avg1={metrics.load.avg1}
            avg5={metrics.load.avg5}
            avg15={metrics.load.avg15}
            cpus={metrics.load.cpus}
          />
        </div>
      )}
    </CollapsiblePanel>
  );
}

function MemoryLine({ used, total }: { used: number; total: number }) {
  const percent = total > 0 ? (used / total) * 100 : 0;
  const ratio = total > 0 ? used / total : 0;
  const color = gaugeColor(percent);
  const gaugeRef = useRef<HTMLDivElement>(null);
  const [charCount, setCharCount] = useState(10);

  useEffect(() => {
    const el = gaugeRef.current;
    if (!el) return;
    const measure = () => {
      // Measure how many monospace characters fit in the container
      const fontSize = parseFloat(getComputedStyle(el).fontSize);
      const chWidth = fontSize * 0.6; // standard monospace char-width ratio
      if (chWidth > 0) setCharCount(Math.max(4, Math.floor(el.clientWidth / chWidth)));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex items-baseline gap-[1ch]">
      <span className="text-text-secondary shrink-0">mem</span>
      <div ref={gaugeRef} className="flex-1 min-w-0 overflow-hidden whitespace-nowrap">
        <span className={color}>{gaugeBar(ratio, charCount)}</span>
      </div>
      <span className="text-text-primary shrink-0">{formatMemory(used, total)}</span>
    </div>
  );
}

function LoadLine({
  avg1,
  avg5,
  avg15,
  cpus,
}: {
  avg1: number;
  avg5: number;
  avg15: number;
  cpus: number;
}) {
  const normalize = (v: number) => (cpus > 0 ? Math.round((v / cpus) * 100) : 0);
  const p1 = normalize(avg1);
  const p5 = normalize(avg5);
  const p15 = normalize(avg15);
  const redClass = "text-red-500";

  return (
    <div className="truncate">
      <span className="text-text-secondary">ld&nbsp; </span>
      <span className={p1 > 90 ? redClass : "text-text-primary"}>{p1}%</span>
      <span className="text-text-secondary"> </span>
      <span className={p5 > 90 ? redClass : "text-text-primary"}>{p5}%</span>
      <span className="text-text-secondary"> </span>
      <span className={p15 > 90 ? redClass : "text-text-primary"}>{p15}%</span>
    </div>
  );
}

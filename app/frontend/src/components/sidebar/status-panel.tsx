import { BrailleSpinner } from "@/components/braille-spinner";
import { formatDuration, parseFabChange } from "@/lib/format";
import type { WindowInfo } from "@/types";

type StatusPanelProps = {
  window: WindowInfo | null;
  nowSeconds: number;
};

/** Shorten an absolute path by replacing $HOME with ~ and truncating deep paths */
function shortenPath(cwd: string): string {
  // Step 1: Home substitution
  let path = cwd;
  const homePatterns = [/^\/home\/[^/]+/, /^\/Users\/[^/]+/, /^\/root(?=\/|$)/];
  for (const pattern of homePatterns) {
    const match = path.match(pattern);
    if (match) {
      const rest = path.slice(match[0].length);
      path = rest.startsWith("/") ? "~" + rest : "~";
      break;
    }
  }

  // Step 2: Truncation — keep last 2 segments if more than 2
  let segments: string[];
  if (path.startsWith("~/")) {
    segments = path.slice(2).split("/").filter(Boolean);
  } else {
    segments = path.split("/").filter(Boolean);
  }
  if (segments.length > 2) {
    return "\u2026/" + segments.slice(-2).join("/");
  }
  return path;
}

/** Build the process/activity string for line 3 fallback */
function getProcessLine(win: WindowInfo, nowSeconds: number): string {
  const command = win.panes?.find((p) => p.isActive)?.command ?? win.paneCommand ?? "";
  if (win.activity === "active") return command || "active";

  let idle = "";
  if (win.agentState === "idle" && win.agentIdleDuration) {
    idle = win.agentIdleDuration;
  } else if (win.activityTimestamp) {
    const elapsed = nowSeconds - win.activityTimestamp;
    if (elapsed > 0) idle = formatDuration(elapsed);
  }

  if (command && idle) return `${command} \u2014 idle ${idle}`;
  if (idle) return `idle ${idle}`;
  return command || "";
}

export function StatusPanel({ window: win, nowSeconds }: StatusPanelProps) {
  if (!win) {
    return (
      <div className="shrink-0 border-t border-border px-3 sm:px-4 py-2 h-[68px] flex items-center">
        <span className="text-xs text-text-secondary">No window selected</span>
      </div>
    );
  }

  const activePaneCwd = win.panes?.find((p) => p.isActive)?.cwd ?? win.worktreePath;
  const cwd = shortenPath(activePaneCwd);
  const paneCount = win.panes?.length ?? 0;
  const activePaneIndex = win.panes?.findIndex((p) => p.isActive) ?? 0;

  // Line 2: window name + pane info
  const windowLine = paneCount > 1
    ? `${win.name} \u00b7 pane ${activePaneIndex + 1} of ${paneCount}`
    : win.name;

  // Line 3: fab state (preferred) or process info (fallback)
  const fabChange = parseFabChange(win.fabChange ?? "");
  const fabLine = fabChange && win.fabStage
    ? `${fabChange.id} ${fabChange.slug} \u00b7 ${win.fabStage}`
    : null;
  const processLine = getProcessLine(win, nowSeconds);
  const line3 = fabLine ?? processLine;
  const isActive = win.activity === "active";

  return (
    <div className="shrink-0 border-t border-border px-3 sm:px-4 py-1.5 min-h-[52px] flex flex-col justify-center gap-0">
      {/* Line 1: CWD */}
      <div className="text-xs truncate" title={activePaneCwd}>
        <span className="text-text-secondary">cwd </span>
        <span className="text-text-primary">{cwd}</span>
      </div>
      {/* Line 2: window + pane info */}
      <div className="text-xs truncate">
        <span className="text-text-secondary">win </span>
        <span className="text-text-secondary">{windowLine}</span>
      </div>
      {/* Line 3: fab state or process */}
      {line3 && (
        <div className="text-xs truncate">
          <span className="text-text-secondary">{fabLine ? "fab " : "run "}</span>
          {isActive && <BrailleSpinner className={fabLine ? "text-accent" : "text-accent-green"} />}{isActive && " "}
          <span className={fabLine ? "text-accent" : "text-text-secondary"}>{line3}</span>
        </div>
      )}
    </div>
  );
}

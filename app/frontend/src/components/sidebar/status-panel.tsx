import { BrailleSpinner } from "@/components/braille-spinner";
import { CollapsiblePanel } from "./collapsible-panel";
import { formatDuration, parseFabChange } from "@/lib/format";
import type { WindowInfo } from "@/types";

type WindowPanelProps = {
  window: WindowInfo | null;
  nowSeconds: number;
};

const HOME_PATTERNS = [/^\/home\/[^/]+/, /^\/Users\/[^/]+/, /^\/root(?=\/|$)/];

/** Shorten an absolute path by replacing $HOME with ~ and truncating deep paths */
function shortenPath(cwd: string): string {
  // Step 1: Home substitution
  let path = cwd;
  for (const pattern of HOME_PATTERNS) {
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

/** Build the process/activity string for the run line */
function getProcessLine(win: WindowInfo, nowSeconds: number): string {
  const command = win.panes?.find((p) => p.isActive)?.command ?? win.paneCommand ?? "";
  if (win.activity === "active") return command || "active";

  // When agent state is present, idle info goes in the dedicated agent row
  if (win.agentState) return command || "";

  let idle = "";
  if (win.activityTimestamp) {
    const elapsed = nowSeconds - win.activityTimestamp;
    if (elapsed > 0) idle = formatDuration(elapsed);
  }

  if (command && idle) return `${command} \u2014 idle ${idle}`;
  if (idle) return `idle ${idle}`;
  return command || "";
}

/** Build the agent state string when an agent is present */
function getAgentLine(win: WindowInfo): string | null {
  if (!win.agentState) return null;
  if (win.agentIdleDuration) return `${win.agentState} ${win.agentIdleDuration}`;
  return win.agentState;
}

export function WindowPanel({ window: win, nowSeconds }: WindowPanelProps) {
  const headerRight = win ? (
    <span className="truncate text-text-secondary font-mono">
      {win.name}
    </span>
  ) : null;

  return (
    <CollapsiblePanel title="Pane" storageKey="runkit-panel-window" defaultOpen={true} headerRight={headerRight}>
      {!win ? (
        <span className="text-xs text-text-secondary">No window selected</span>
      ) : (
        <WindowContent win={win} nowSeconds={nowSeconds} />
      )}
    </CollapsiblePanel>
  );
}

function WindowContent({ win, nowSeconds }: { win: WindowInfo; nowSeconds: number }) {
  const activePane = win.panes?.find((p) => p.isActive);
  const activePaneCwd = activePane?.cwd ?? win.worktreePath;
  const cwd = shortenPath(activePaneCwd);
  const paneCount = win.panes?.length ?? 0;
  const activePaneIndex = activePane?.paneIndex ?? 0;
  const paneId = activePane?.paneId ?? "";

  // Git branch from active pane
  const gitBranch = activePane?.gitBranch ?? "";

  // Fab state (preferred) or process info (fallback)
  const fabChange = parseFabChange(win.fabChange ?? "");
  const fabLine = fabChange && win.fabStage
    ? `${fabChange.id} ${fabChange.slug} \u00b7 ${win.fabStage}`
    : null;
  const processLine = getProcessLine(win, nowSeconds);
  const runLine = fabLine ?? processLine;
  const isActive = win.activity === "active";

  // Agent state (dedicated row)
  const agentLine = getAgentLine(win);

  return (
    <div className="flex flex-col gap-0 text-xs">
      {/* Tmux pane info */}
      <div className="truncate">
        <span className="text-text-secondary">tmx </span>
        <span className="text-text-secondary">
          pane {activePaneIndex + 1}/{paneCount}{paneId && ` ${paneId}`}
        </span>
      </div>
      {/* CWD */}
      <div className="truncate" title={activePaneCwd}>
        <span className="text-text-secondary">cwd </span>
        <span className="text-text-primary">{cwd}</span>
      </div>
      {/* Git branch */}
      {gitBranch && (
        <div className="truncate">
          <span className="text-text-secondary">git </span>
          <span className="text-accent">{gitBranch}</span>
        </div>
      )}
      {/* Fab state or process */}
      {runLine && (
        <div className="truncate">
          <span className="text-text-secondary">{fabLine ? "fab " : "run "}</span>
          {isActive && <BrailleSpinner className={fabLine ? "text-accent" : "text-accent-green"} />}{isActive && " "}
          <span className={fabLine ? "text-accent" : "text-text-secondary"}>{runLine}</span>
        </div>
      )}
      {/* Agent state */}
      {agentLine && (
        <div className="truncate">
          <span className="text-text-secondary">agt </span>
          <span className="text-text-primary">{agentLine}</span>
        </div>
      )}
    </div>
  );
}

/** @deprecated Use WindowPanel instead */
export const StatusPanel = WindowPanel;

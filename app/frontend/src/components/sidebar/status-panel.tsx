import { useState, useRef, useEffect, type ReactNode } from "react";
import { BrailleSpinner } from "@/components/braille-spinner";
import { CollapsiblePanel } from "./collapsible-panel";
import { copyToClipboard } from "@/lib/clipboard";
import { formatDuration, parseFabChange } from "@/lib/format";
import type { WindowInfo } from "@/types";

type CopyableRowKey = "tmx" | "cwd" | "git" | "fab";

const COPY_FEEDBACK_MS = 1000;

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

/** Reusable interactive row that copies a value on click and shows inline "copied" feedback. */
function CopyableRow({ prefix, copied, onCopy, children, className, title }: {
  prefix: string;
  copied: boolean;
  onCopy: () => void;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      className={`truncate text-left w-full cursor-pointer hover:bg-bg-inset focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent bg-transparent border-0 p-0 m-0 font-inherit text-inherit ${className ?? ""}`}
      title={title}
    >
      <span className="text-text-secondary">{copied ? "copied \u2713 " : `${prefix} `}</span>
      {children}
    </button>
  );
}

function WindowContent({ win, nowSeconds }: { win: WindowInfo; nowSeconds: number }) {
  const [copiedRow, setCopiedRow] = useState<CopyableRowKey | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  function handleCopy(key: CopyableRowKey, value: string) {
    if (window.getSelection()?.toString()) return;
    void copyToClipboard(value);
    setCopiedRow(key);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setCopiedRow(null);
      timerRef.current = null;
    }, COPY_FEEDBACK_MS);
  }

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
      {paneId ? (
        <CopyableRow prefix="tmx" copied={copiedRow === "tmx"} onCopy={() => handleCopy("tmx", paneId)}>
          <span className="text-text-secondary">
            pane {activePaneIndex + 1}/{paneCount}{paneId && ` ${paneId}`}
          </span>
        </CopyableRow>
      ) : (
        <div className="truncate">
          <span className="text-text-secondary">tmx </span>
          <span className="text-text-secondary">
            pane {activePaneIndex + 1}/{paneCount}
          </span>
        </div>
      )}
      {/* CWD */}
      <CopyableRow prefix="cwd" copied={copiedRow === "cwd"} onCopy={() => handleCopy("cwd", activePaneCwd)} title={activePaneCwd}>
        <span className="text-text-primary">{cwd}</span>
      </CopyableRow>
      {/* Git branch */}
      {gitBranch && (
        <CopyableRow prefix="git" copied={copiedRow === "git"} onCopy={() => handleCopy("git", gitBranch)}>
          <span className="text-accent">{gitBranch}</span>
        </CopyableRow>
      )}
      {/* Fab state or process */}
      {fabLine && runLine ? (
        <CopyableRow prefix="fab" copied={copiedRow === "fab"} onCopy={() => handleCopy("fab", fabChange!.id)}>
          {isActive && <BrailleSpinner className="text-accent" />}{isActive && " "}
          <span className="text-accent">{runLine}</span>
        </CopyableRow>
      ) : runLine ? (
        <div className="truncate">
          <span className="text-text-secondary">run </span>
          {isActive && <BrailleSpinner className="text-accent-green" />}{isActive && " "}
          <span className="text-text-secondary">{runLine}</span>
        </div>
      ) : null}
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

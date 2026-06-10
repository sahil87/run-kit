import { useState, useRef, useEffect, type ReactNode } from "react";
import { BrailleSnake } from "@/components/braille-snake";
import { ClockSpinner } from "@/components/clock-spinner";
import { StarTwinkle } from "@/components/star-twinkle";
import { CollapsiblePanel } from "./collapsible-panel";
import { ICON_CLASS } from "./icons";
import { copyToClipboard } from "@/lib/clipboard";
import { formatDuration, parseFabChange } from "@/lib/format";
import type { WindowInfo } from "@/types";

type CopyableRowKey = "tmx" | "cwd" | "git" | "fab" | "pr";

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

type PrSegment = { text: string; color: string };

/** GitHub-style state colors: open=green, merged=purple, closed=red. */
const PR_STATE_COLORS: Record<NonNullable<WindowInfo["prState"]>, string> = {
  open: "text-accent-green",
  merged: "text-purple-400",
  closed: "text-red-400",
};

const PR_CHECKS_COLORS: Record<string, string> = {
  pass: "text-accent-green",
  fail: "text-red-400",
  pending: "text-yellow-400",
};

const PR_REVIEW_COLORS: Record<string, string> = {
  approved: "text-accent-green",
  changes_requested: "text-red-400",
  review_required: "text-yellow-400",
};

/**
 * Build the PR status line for the pane panel as colored segments, e.g.
 * "#241 · open · checks pass" for an open PR, or "#241 · merged" once it
 * lands. Returns null unless the window is change-bound (`fabChange`) AND
 * carries a `prNumber` — the same gate the sidebar/dashboard PR surface uses.
 * For a merged/closed PR the checks and review parts are suppressed (they're
 * historical once the PR is no longer open); only the terminal state is shown.
 * A draft PR keeps the neutral token for its state — draft is "not ready",
 * not a healthy green.
 */
function getPrSegments(win: WindowInfo): PrSegment[] | null {
  if (!win.fabChange || !win.prNumber) return null;
  const segments: PrSegment[] = [{ text: `#${win.prNumber}`, color: "text-text-primary" }];
  if (win.prState) {
    segments.push({
      text: `${win.prState}${win.prIsDraft ? " (draft)" : ""}`,
      color: win.prIsDraft ? "text-text-secondary" : PR_STATE_COLORS[win.prState],
    });
  }
  const isOpen = !win.prState || win.prState === "open";
  if (isOpen && win.prChecks && win.prChecks !== "none") {
    segments.push({ text: `checks ${win.prChecks}`, color: PR_CHECKS_COLORS[win.prChecks] });
  }
  if (isOpen && win.prReview && win.prReview !== "none") {
    segments.push({
      text: `review: ${win.prReview.replace(/_/g, " ")}`,
      color: PR_REVIEW_COLORS[win.prReview],
    });
  }
  return segments;
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

/** Reusable interactive row that copies a value on click and shows inline "copied" feedback.
 *  The `group` class enables `group-hover:text-accent` on the value span so callers can
 *  reveal the accent color on hover as a clickability affordance. */
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
      className={`group truncate text-left w-full cursor-pointer hover:bg-bg-inset focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent bg-transparent border-0 p-0 m-0 font-inherit text-inherit ${className ?? ""}`}
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

  const gitBranch = activePane?.gitBranch ?? "";

  const fabChange = parseFabChange(win.fabChange ?? "");
  const fabLine = fabChange && win.fabStage
    ? `${fabChange.id} ${fabChange.slug} \u00b7 ${win.fabStage}`
    : null;
  const processLine = getProcessLine(win, nowSeconds);
  const agentLine = getAgentLine(win);
  const prSegments = getPrSegments(win);
  const prText = prSegments?.map((s) => s.text).join(" · ") ?? "";

  return (
    <div className="flex flex-col gap-0 text-xs">
      {/* tmx */}
      {paneId ? (
        <CopyableRow prefix="tmx" copied={copiedRow === "tmx"} onCopy={() => handleCopy("tmx", paneId)}>
          <span className={ICON_CLASS} aria-hidden="true">{"\uF489"}</span>
          {" "}
          <span className="text-text-secondary group-hover:text-accent">
            pane {activePaneIndex + 1}/{paneCount}{paneId && ` ${paneId}`}
          </span>
        </CopyableRow>
      ) : (
        <div className="truncate">
          <span className="text-text-secondary">tmx </span>
          <span className={ICON_CLASS} aria-hidden="true">{"\uF489"}</span>
          {" "}
          <span className="text-text-secondary">
            pane {activePaneIndex + 1}/{paneCount}
          </span>
        </div>
      )}

      {/* cwd */}
      <CopyableRow prefix="cwd" copied={copiedRow === "cwd"} onCopy={() => handleCopy("cwd", activePaneCwd)} title={activePaneCwd}>
        <span className={ICON_CLASS} aria-hidden="true">{"\uF413"}</span>
        {" "}
        <span className="text-text-secondary group-hover:text-accent">{cwd}</span>
      </CopyableRow>

      {/* git */}
      {gitBranch && (
        <CopyableRow prefix="git" copied={copiedRow === "git"} onCopy={() => handleCopy("git", gitBranch)}>
          <span className={ICON_CLASS} aria-hidden="true">{"\uF418"}</span>
          {" "}
          <span className="text-text-primary group-hover:text-accent">{gitBranch}</span>
        </CopyableRow>
      )}

      {/* pr — live PR status for a change-bound window with a PR. The row body
          copies the PR URL on click (consistent with every other row). When a
          PR URL is present, a hover-revealed open link (right-aligned, always
          shown on touch) opens the PR in a new tab — the open + copy affordances
          are split the same way the sidebar window row splits its row-body
          action from its hover action buttons. Gated via getPrSegments. */}
      {prSegments && (
        <div className="group/pr relative">
          <CopyableRow
            prefix={"pr\u00A0"}
            copied={copiedRow === "pr"}
            onCopy={() => handleCopy("pr", win.prUrl ?? prText)}
            title={win.prUrl ?? undefined}
            className={win.prUrl ? "pr-6" : undefined}
          >
            <span className={ICON_CLASS} aria-hidden="true">{"\uF407"}</span>
            {" "}
            <span data-testid="pr-line">
              {prSegments.map((seg, i) => (
                <span key={seg.text}>
                  {i > 0 && <span className="text-text-secondary group-hover:text-accent">{" \u00B7 "}</span>}
                  <span className={`${seg.color} group-hover:text-accent`}>{seg.text}</span>
                </span>
              ))}
            </span>
          </CopyableRow>
          {win.prUrl && (
            <a
              href={win.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              aria-label={`Open PR #${win.prNumber} in a new tab`}
              title="Open PR in a new tab"
              className="absolute right-0 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-opacity cursor-pointer opacity-0 group-hover/pr:opacity-100 coarse:opacity-100 text-[12px] px-0.5 min-h-[20px] flex items-center justify-center"
            >
              {"\u2197"}
            </a>
          )}
        </div>
      )}

      {/* run */}
      {processLine && (
        <div className="truncate">
          <span className="text-text-secondary">run </span>
          <BrailleSnake className={ICON_CLASS} />{" "}
          <span className="text-text-secondary">{processLine}</span>
        </div>
      )}

      {/* agt */}
      {agentLine && (
        <div className="truncate">
          <span className="text-text-secondary">agt </span>
          <StarTwinkle className={ICON_CLASS} />{" "}
          <span className="text-text-secondary">{agentLine}</span>
        </div>
      )}

      {/* fab */}
      {fabLine && (
        <CopyableRow prefix="fab" copied={copiedRow === "fab"} onCopy={() => handleCopy("fab", fabChange!.id)}>
          <ClockSpinner className={ICON_CLASS} />{" "}
          <span className="text-text-primary group-hover:text-accent">{fabLine}</span>
        </CopyableRow>
      )}

    </div>
  );
}

/** @deprecated Use WindowPanel instead */
export const StatusPanel = WindowPanel;

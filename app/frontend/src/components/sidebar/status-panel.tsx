import { useState, useRef, useEffect, type ReactNode } from "react";
import { useNow } from "@/hooks/use-now";
import { BrailleSnake } from "@/components/braille-snake";
import { ClockSpinner } from "@/components/clock-spinner";
import { StarTwinkle } from "@/components/star-twinkle";
import { CollapsiblePanel } from "./collapsible-panel";
import { ICON_CLASS } from "./icons";
import { copyToClipboard } from "@/lib/clipboard";
import { formatDuration, parseFabChange } from "@/lib/format";
import { PR_STATE_COLORS, PR_CHECKS_COLORS, PR_REVIEW_COLORS } from "@/components/pr-status-line";
import { StatusDot } from "@/components/status-dot";
import type { WindowInfo } from "@/types";

type CopyableRowKey = "tmx" | "cwd" | "git" | "fab" | "pr";

const COPY_FEEDBACK_MS = 1000;

type WindowPanelProps = {
  window: WindowInfo | null;
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

/**
 * Build the L0 `out` register string (status-pyramid.md register view). L0
 * speaks about bytes, not intent: `active \u00b7 <command>` while output flows, else
 * `<command> \u00b7 idle Xm since last output` (or `idle Xm` with no command). This
 * register ALWAYS shows its own elapsed value \u2014 the duration-mute rule (which
 * hides elapsed when output flows) applies only to the tip's one-line summary,
 * never here in the uncontested register view, so the waiting-pierce rule is
 * automatic (see spec \u00a7 Duration-Text Ladder).
 */
function getOutputLine(win: WindowInfo, nowSeconds: number): string {
  const command = win.panes?.find((p) => p.isActive)?.command ?? win.paneCommand ?? "";
  if (win.activity === "active") return command ? `active \u00b7 ${command}` : "active";

  let idle = "";
  if (win.activityTimestamp) {
    const elapsed = nowSeconds - win.activityTimestamp;
    if (elapsed > 0) idle = formatDuration(elapsed);
  }
  const idleText = idle ? `idle ${idle} since last output` : "";
  if (command && idleText) return `${command} \u2014 ${idleText}`;
  if (idleText) return idleText;
  return command || "idle";
}

/** Build the L1 `agt` register string when an agent is present: e.g.
 *  `waiting 3m` / `active` / `idle 12m`. Null when no `agentState`. */
function getAgentLine(win: WindowInfo): string | null {
  if (!win.agentState) return null;
  if (win.agentIdleDuration) return `${win.agentState} ${win.agentIdleDuration}`;
  return win.agentState;
}

type PrSegment = { text: string; color: string };

// PR segment color vocabulary (PR_STATE_COLORS / PR_CHECKS_COLORS /
// PR_REVIEW_COLORS) is imported from pr-status-line.tsx — the single source of
// truth shared with the sidebar dot and the dashboard PR line.

/**
 * Build the L3 `PR` register line for the pane panel as colored segments, e.g.
 * "#241 · open · checks pass" for an open PR, or "#241 · merged" once it
 * lands. Returns null unless the window carries a `prNumber`. Gated ONLY on
 * `prNumber` — NOT on `fabChange` — because the L3 register shows the PR for
 * ANY pane on a branch with a PR (derivation is universal, Constitution
 * Principle X; the ladder's per-family dot ownership is a separate concern —
 * see statusDotState). For a merged/closed PR the checks and review parts are
 * suppressed (they're
 * historical once the PR is no longer open); only the terminal state is shown.
 * The state segment color is purely the GitHub state (open→green via
 * PR_STATE_COLORS), NOT a health verdict — health is conveyed by the checks and
 * review segments here plus the sidebar dot. A draft is not dimmed: its state
 * follows PR_STATE_COLORS like any open PR, so an open draft shows green. This
 * reflects the project's "green = health, not merge-readiness" story (a draft
 * with passing checks is healthy, just not flipped to ready) and keeps all
 * three PR surfaces (sidebar dot, these segments, PrStatusLine) consistent.
 */
function getPrSegments(win: WindowInfo): PrSegment[] | null {
  if (!win.prNumber) return null;
  const segments: PrSegment[] = [{ text: `#${win.prNumber}`, color: "text-text-primary" }];
  if (win.prState) {
    segments.push({
      text: `${win.prState}${win.prIsDraft ? " (draft)" : ""}`,
      color: PR_STATE_COLORS[win.prState],
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

export function WindowPanel({ window: win }: WindowPanelProps) {
  const headerRight = win ? (
    <span className="flex min-w-0 items-center gap-1.5 text-text-secondary font-mono">
      <StatusDot win={win} />
      <span className="truncate">{win.name}</span>
    </span>
  ) : null;

  return (
    <CollapsiblePanel title="Pane" storageKey="runkit-panel-window" defaultOpen={true} headerRight={headerRight}>
      {!win ? (
        <span className="text-xs text-text-secondary">No window selected</span>
      ) : (
        <WindowContent win={win} />
      )}
    </CollapsiblePanel>
  );
}

/** Reusable interactive row that copies a value on click and shows inline "copied" feedback.
 *  The `group` class enables `group-hover:text-accent` on the value span so callers can
 *  reveal the accent color on hover as a clickability affordance. */
function CopyableRow({ prefix, copied, onCopy, children, title }: {
  prefix: string;
  copied: boolean;
  onCopy: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      className="group truncate text-left w-full cursor-pointer hover:bg-bg-inset focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent bg-transparent border-0 p-0 m-0 font-inherit text-inherit"
      title={title}
    >
      <span className="text-text-secondary">{copied ? "copied \u2713 " : `${prefix} `}</span>
      {children}
    </button>
  );
}

/** Open-first PR row (rendered only when a PR URL is present). The row BODY is a
 *  real anchor opening the PR in a new tab (native middle/Ctrl+click, right-click
 *  -> "Copy link address"); an always-visible inline `\u2197` right after the
 *  (possibly truncated) segment text signals "this row opens"; and the copy
 *  affordance is role-swapped to a hover-revealed icon on the right \u2014 the same
 *  row-body vs hover-icon split the sidebar window row uses. Takes `prUrl` as a
 *  typed `string` so neither the anchor nor the copy handler needs a non-null
 *  assertion (type narrowing over `!`). */
function PrLinkRow({ prUrl, prNumber, copied, onCopy, children }: {
  prUrl: string;
  prNumber: number | undefined;
  copied: boolean;
  onCopy: (url: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="group/pr relative">
      <a
        href={prUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={prUrl}
        aria-label={`Open PR #${prNumber} in a new tab`}
        className="group flex items-center truncate w-full pr-6 hover:bg-bg-inset focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
      >
        {/* Non-collapsing spacing: the anchor is a flex container, so a
            whitespace-only {" "} text node between flex items is dropped and a
            trailing collapsible space trimmed. The gaps before the icon and
            before the segments therefore live as NBSPs INSIDE the prefix/icon
            spans, not as separate text nodes. CopyableRow renders `${prefix} `
            (3-char prefix + a gap space = 4 monospace advances before its
            icon), so the at-rest prefix here is "PR"+NBSP+NBSP (also 4 advances)
            to keep the icon/content column-aligned with tmx/cwd/git/fab and the
            no-URL pr branch. The "copied \u2713"+NBSP feedback is 9 advances,
            matching CopyableRow's "copied \u2713 " copied rendering. */}
        <span className="text-text-secondary shrink-0">
          {copied ? "copied \u2713\u00a0" : "PR\u00a0\u00a0"}
        </span>
        <span className={`${ICON_CLASS} shrink-0`} aria-hidden="true">{"\uf407\u00a0"}</span>
        <span data-testid="pr-line" className="min-w-0 truncate">
          {children}
        </span>
        <span
          className="shrink-0 pl-1 text-text-secondary group-hover:text-accent text-[12px]"
          aria-hidden="true"
        >
          {"\u2197"}
        </span>
      </a>
      {/* Hover-revealed copy icon (the copy role swapped off the row body). Inert
          at rest on fine pointers (pointer-events-none) so a stray click near the
          row's right edge falls through to the anchor; interactivity is restored
          on hover, coarse pointers, and keyboard focus within
          (has-[:focus-visible]). The button is a SIBLING of the anchor (not
          enclosed by it), so the click cannot navigate on its own \u2014 the
          preventDefault() is belt-and-suspenders. Color follows the window-row
          cluster precedent (text-text-secondary hover:text-text-primary), NOT
          ICON_CLASS: ICON_CLASS carries text-accent-bright, which would fight
          text-text-secondary at equal specificity, so only its font/size pieces
          are kept. */}
      <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center z-10 pointer-events-none group-hover/pr:pointer-events-auto coarse:pointer-events-auto has-[:focus-visible]:pointer-events-auto">
        <button
          type="button"
          aria-label="Copy PR URL"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onCopy(prUrl);
          }}
          className="font-bold text-[14px] leading-none text-text-secondary hover:text-text-primary transition-opacity cursor-pointer opacity-0 group-hover/pr:opacity-100 coarse:opacity-100 focus-visible:opacity-100 px-0.5 min-h-[20px] flex items-center justify-center bg-transparent border-0"
        >
          {"\uf0c5"}
        </button>
      </div>
    </div>
  );
}

function WindowContent({ win }: { win: WindowInfo }) {
  // The `run` line's idle duration ticks once per second. Reading the clock
  // here (the leaf that composes the line) keeps the tick off the sidebar tree
  // — the bottom panel is a single instance, so its per-second re-render is
  // negligible and does not touch the memoized ServerGroup/SessionRow/WindowRow.
  const nowSeconds = useNow();
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
  // The active pane's cwd was deleted on disk (e.g. an archived worktree). Keep
  // the stale path as a breadcrumb but recolor the row and tag it "(deleted)".
  const cwdMissing = activePane?.cwdMissing ?? false;
  const paneCount = win.panes?.length ?? 0;
  const activePaneIndex = activePane?.paneIndex ?? 0;
  const paneId = activePane?.paneId ?? "";

  const gitBranch = activePane?.gitBranch ?? "";

  const fabChange = parseFabChange(win.fabChange ?? "");
  // L2 `fab` register: `<id> <slug> \u00b7 <stage>[ \u00b7 <displayState>]`. The
  // displayState segment is appended when present (`fab pane map` may omit it
  // on older binaries), completing the register per status-pyramid.md.
  const fabLine = fabChange && win.fabStage
    ? `${fabChange.id} ${fabChange.slug} \u00b7 ${win.fabStage}${win.fabDisplayState ? ` \u00b7 ${win.fabDisplayState}` : ""}`
    : null;
  const outputLine = getOutputLine(win, nowSeconds);
  const agentLine = getAgentLine(win);
  const prSegments = getPrSegments(win);
  const prText = prSegments?.map((s) => s.text).join(" · ") ?? "";
  // The colored PR segment spans (separator + segment) are identical in the
  // anchor (URL-present) and CopyableRow (no-URL) branches — build them once so
  // the segment styling can't drift between the two.
  const segmentSpans = prSegments?.map((seg, i) => (
    <span key={seg.text}>
      {i > 0 && <span className="text-text-secondary group-hover:text-accent">{" · "}</span>}
      <span className={`${seg.color} group-hover:text-accent`}>{seg.text}</span>
    </span>
  ));

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
      <CopyableRow
        prefix="cwd"
        copied={copiedRow === "cwd"}
        onCopy={() => handleCopy("cwd", activePaneCwd)}
        title={cwdMissing ? `${activePaneCwd} (no longer exists)` : activePaneCwd}
      >
        <span className={ICON_CLASS} aria-hidden="true">{"\uF413"}</span>
        {" "}
        {cwdMissing ? (
          <span className="text-red-400">
            {cwd} <span data-testid="cwd-deleted">(deleted)</span>
          </span>
        ) : (
          <span className="text-text-secondary group-hover:text-accent">{cwd}</span>
        )}
      </CopyableRow>

      {/* git */}
      {gitBranch && (
        <CopyableRow prefix="git" copied={copiedRow === "git"} onCopy={() => handleCopy("git", gitBranch)}>
          <span className={ICON_CLASS} aria-hidden="true">{"\uF418"}</span>
          {" "}
          <span className="text-text-primary group-hover:text-accent">{gitBranch}</span>
        </CopyableRow>
      )}

      {/* PR (L3 register) — live PR status for ANY pane with a derived PR
          (ungated from fabChange; universal derivation, Principle X). Open-first
          (260703-41ks): when a PR URL is present, the row BODY is a real anchor
          that opens the PR in a new tab (native middle/Ctrl+click, right-click
          -> "Copy link address"), with an always-visible inline arrow (↗)
          right after the (possibly truncated) segment text signalling "this row
          opens", and the copy affordance role-swapped to a hover-revealed icon
          on the right — the same row-body vs hover-icon split the sidebar window
          row uses for its icon cluster. When there is no URL there is nothing to
          open, so the row stays a plain copy row (unchanged). Gated via
          getPrSegments. */}
      {prSegments && (
        win.prUrl ? (
          <PrLinkRow
            prUrl={win.prUrl}
            prNumber={win.prNumber}
            copied={copiedRow === "pr"}
            onCopy={(url) => handleCopy("pr", url)}
          >
            {segmentSpans}
          </PrLinkRow>
        ) : (
          <CopyableRow prefix={"PR\u00A0"} copied={copiedRow === "pr"} onCopy={() => handleCopy("pr", prText)}>
            <span className={ICON_CLASS} aria-hidden="true">{"\uF407"}</span>
            {" "}
            <span data-testid="pr-line">
              {segmentSpans}
            </span>
          </CopyableRow>
        )
      )}

      {/* ── The four orthogonal signal registers (status-pyramid.md § Row
          Minimalism): out (L0) / agt (L1) / fab (L2) / PR (L3, rendered just
          above), fixed-width 3-char keys matching tmx/cwd/git. One line per
          layer, never collapsed, so the sidebar StatusDot is a pure function of
          what this panel shows and can be mentally derived from it. Absent
          layers render as absent (a plain shell pane shows only `out`). The
          identity rows (tmx/cwd/git) are pane metadata, orthogonal to these
          signal registers. ── */}

      {/* out (L0) — tmux activity + elapsed. Always rendered: L0 is the
          floor layer whose precondition is "always", so it is the one register
          a plain shell pane still shows. Its elapsed is never muted here (the
          register view is uncontested for space — the waiting-pierce rule). */}
      <div className="truncate" data-testid="register-output">
        <span className="text-text-secondary">out </span>
        <BrailleSnake className={`${ICON_CLASS} font-normal`} />{" "}
        <span className="text-text-secondary">{outputLine}</span>
      </div>

      {/* agt (L1) — agentState + epoch duration. Absent when no agent. */}
      {agentLine && (
        <div className="truncate" data-testid="register-agent">
          <span className="text-text-secondary">agt </span>
          <StarTwinkle className={`${ICON_CLASS} font-normal`} />{" "}
          <span className="text-text-secondary">{agentLine}</span>
        </div>
      )}

      {/* fab (L2) — change · stage · displayState. Absent when no fab change. */}
      {fabLine && (
        <CopyableRow prefix="fab" copied={copiedRow === "fab"} onCopy={() => handleCopy("fab", fabChange!.id)}>
          <ClockSpinner className={`${ICON_CLASS} font-normal`} />{" "}
          <span className="text-text-primary group-hover:text-accent">{fabLine}</span>
        </CopyableRow>
      )}

    </div>
  );
}

/** @deprecated Use WindowPanel instead */
export const StatusPanel = WindowPanel;

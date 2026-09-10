import { formatDuration, parseFabChange } from "@/lib/format";
import { PR_STATE_COLORS, PR_CHECKS_COLORS, PR_REVIEW_COLORS } from "@/components/pr-status-model";
import type { WindowInfo } from "@/types";

/**
 * Shared register-line resolvers for the status pyramid's five orthogonal
 * signal registers (`out` L0 / `agt` L1 / `fab` L2 / `PR` L3 / `opr` L4 — see
 * docs/specs/status-pyramid.md § Row Minimalism). Extracted from
 * `status-panel.tsx` (93dy) so the TWO register surfaces — the bottom PANE
 * panel's `WindowContent` and the sidebar row-hover flyout card
 * (`row-flyout-card.tsx`) — render from ONE source and cannot drift. Pure
 * functions over the streamed `WindowInfo`; no React.
 */

/**
 * Build the L0 `out` register string. L0 speaks about bytes, not intent:
 * `active · <command>` while output flows, else `<command> — idle Xm since
 * last output` (or `idle Xm` with no command). This register ALWAYS shows its
 * own elapsed value — the duration-mute rule (which hides elapsed when output
 * flows) applied only to the retired one-line tip summary, never here in the
 * uncontested register view, so the waiting-pierce rule is automatic (see spec
 * § Duration-Text Ladder).
 */
export function getOutputLine(win: WindowInfo, nowSeconds: number): string {
  const command = win.panes?.find((p) => p.isActive)?.command ?? win.paneCommand ?? "";
  if (win.activity === "active") return command ? `active · ${command}` : "active";

  let idle = "";
  if (win.activityTimestamp) {
    const elapsed = nowSeconds - win.activityTimestamp;
    if (elapsed > 0) idle = formatDuration(elapsed);
  }
  const idleText = idle ? `idle ${idle} since last output` : "";
  if (command && idleText) return `${command} — ${idleText}`;
  if (idleText) return idleText;
  return command || "idle";
}

/** Build the L1 `agt` register string when an agent is present: e.g.
 *  `waiting 3m` / `active` / `idle 12m`. Null when no `agentState`. */
export function getAgentLine(win: WindowInfo): string | null {
  if (!win.agentState) return null;
  if (win.agentIdleDuration) return `${win.agentState} ${win.agentIdleDuration}`;
  return win.agentState;
}

export type FabParts = { id: string; slug: string; stage: string; displayState?: string };

/** Resolve the L2 `fab` register into its parts so a surface can compose them
 *  across lines (the row-hover flyout card leads with the decisive tokens and
 *  moves the slug to a continuation line). Null when the window has no
 *  parseable fab change or no stage. */
export function getFabParts(win: WindowInfo): FabParts | null {
  const fabChange = parseFabChange(win.fabChange ?? "");
  if (!fabChange || !win.fabStage) return null;
  const parts: FabParts = { id: fabChange.id, slug: fabChange.slug, stage: win.fabStage };
  if (win.fabDisplayState) parts.displayState = win.fabDisplayState;
  return parts;
}

/** Build the L2 `fab` register string: `<id> <slug> · <stage>[ ·
 *  <displayState>]`. The displayState segment is appended when present
 *  (`fab pane map` may omit it on older binaries). Null when the window has no
 *  parseable fab change or no stage. */
export function getFabLine(win: WindowInfo): string | null {
  const parts = getFabParts(win);
  if (!parts) return null;
  return `${parts.id} ${parts.slug} · ${parts.stage}${parts.displayState ? ` · ${parts.displayState}` : ""}`;
}

export type PrSegment = { text: string; color: string };

export type OperatorLoopFacts = { stale: boolean; lastTickAt?: number };
export type OperatorParts = { head: string; facets?: string };

/** L4 `opr` register. Null unless `win.monitored === true` (degrade-to-absent,
 *  the NoteLine gate). `head` leads with the decisive tokens:
 *  `watched · <monitoredStage> · tick <age> ago`; the stage segment is omitted
 *  when absent, the tick segment when `lastTickAt` is 0/absent (never ticked).
 *  `facets` = `<monitoredRepo> · <monitoredBranch>` (empty segments omitted;
 *  undefined when both absent). `stale` is consumed verbatim — the threshold
 *  is server-derived, never recomputed here. */
export function getOperatorParts(
  win: WindowInfo,
  operator: OperatorLoopFacts | undefined,
  nowSeconds: number,
): OperatorParts | null {
  if (win.monitored !== true) return null;
  let head = "watched";
  if (win.monitoredStage) head += ` · ${win.monitoredStage}`;
  if (operator?.lastTickAt) {
    head += ` · tick ${formatDuration(nowSeconds - operator.lastTickAt)} ago`;
  }
  const facets = [win.monitoredRepo, win.monitoredBranch].filter(Boolean).join(" · ");
  const parts: OperatorParts = { head };
  if (facets) parts.facets = facets;
  return parts;
}

/**
 * Build the L3 `PR` register line as colored segments, e.g.
 * "#241 · open · checks pass" for an open PR, or "#241 · merged" once it
 * lands. Returns null unless the window carries a `prNumber`. Gated ONLY on
 * `prNumber` — NOT on `fabChange` — because the L3 register shows the PR for
 * ANY pane on a branch with a PR (derivation is universal, Constitution
 * Principle X; the ladder's per-family dot ownership is a separate concern —
 * see statusDotState). For a merged/closed PR the checks and review parts are
 * suppressed (they're historical once the PR is no longer open); only the
 * terminal state is shown. The state segment color is purely the GitHub state
 * (open→green via PR_STATE_COLORS), NOT a health verdict — health is conveyed
 * by the checks and review segments here plus the sidebar dot. A draft is not
 * dimmed: its state follows PR_STATE_COLORS like any open PR, so an open draft
 * shows green. This reflects the project's "green = health, not
 * merge-readiness" story (a draft with passing checks is healthy, just not
 * flipped to ready) and keeps the PR surfaces consistent.
 */
export function getPrSegments(win: WindowInfo): PrSegment[] | null {
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


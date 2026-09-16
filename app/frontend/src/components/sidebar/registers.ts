import { formatDuration, parseFabChange } from "@/lib/format";
import { PR_STATE_COLORS, PR_CHECKS_COLORS, PR_REVIEW_COLORS } from "@/components/pr-status-model";
import type { WindowInfo } from "@/types";

/**
 * Shared register-line resolvers for the status pyramid's five orthogonal
 * signal registers (`out` L0 / `agt` L1 / `fab` L2 / `PR` L3 / `opr` L4 — see
 * docs/specs/status-pyramid.md § Row Minimalism). Extracted from
 * `status-panel.tsx` so the THREE register surfaces — the bottom PANE
 * panel's `WindowContent`, the sidebar row-hover flyout card
 * (`row-flyout-card.tsx`), and the status bar's window cluster — render from
 * ONE source and cannot drift. Pure functions over the streamed `WindowInfo`;
 * no React.
 *
 * The `tmx` identity-row label (`getTmxLabel`) also lives here — it is pane
 * metadata, not a register, but it has three consumers (the PANE panel, the
 * status-bar strip, the status-bar overflow row) that must render one string.
 * `splitDatePrefix` (the git row / bar `⑂` segment's dim date prefix) lives
 * here for the same reason — one rule, two surfaces. The parts resolvers
 * (`getFabParts`, `getPrParts`) exist so a surface can split a register across
 * lines without owning the split rule.
 */

/**
 * Build the `tmx` identity-row label: the active pane's id leads — `%107` for
 * a one-pane window (the overwhelming case; `pane 1/1` says nothing), `%109 ·
 * 3/3` for multi-pane, where the ordinal only disambiguates. The ordinal is
 * the ACTIVE pane's 1-based position in `win.panes` — never `paneIndex + 1`:
 * `paneIndex` is tmux's `#{pane_index}`, which already honours
 * `pane-base-index`. The id segment comes ONLY from the active pane —
 * consumers copy `activePane.paneId`, and a label must never show an id that
 * nothing copies — so with no pane marked active (or an empty active
 * `paneId`) the id and its ` · ` separator are omitted and the ordinal falls
 * back to 1 (`1/3`). A single (or zero) pane with no id yields the empty
 * string — the panel and the bar render the row passive in that case.
 */
export function getTmxLabel(win: WindowInfo): string {
  const panes = win.panes ?? [];
  const activeIdx = panes.findIndex((p) => p.isActive);
  const ordinal = (activeIdx >= 0 ? activeIdx : 0) + 1;
  const paneId = activeIdx >= 0 ? panes[activeIdx].paneId : "";
  if (panes.length <= 1) return paneId;
  return paneId ? `${paneId} · ${ordinal}/${panes.length}` : `${ordinal}/${panes.length}`;
}

/**
 * Build the L0 `out` register string. L0 speaks about bytes, not intent:
 * `<cmd> · flowing` while output flows (or bare `flowing` with no command),
 * else `<cmd> · idle <dur>` from `activityTimestamp` (or `idle <dur>`), else
 * `<cmd>` / bare `idle` with no usable timestamp. "flowing" is the spec's own
 * L0 word (spec § Duration-Text Ladder), keeping L0 lexically distinct from
 * the L1 `active` agent state; the "since last output" narration lives in the
 * tier-1 `Output activity` tip, not on the register. This register ALWAYS
 * shows its own elapsed value — the duration-mute rule applied only to the
 * retired one-line tip summary, never here in the uncontested register view,
 * so the waiting-pierce rule is automatic.
 */
export function getOutputLine(win: WindowInfo, nowSeconds: number): string {
  const command = win.panes?.find((p) => p.isActive)?.command ?? win.paneCommand ?? "";
  if (win.activity === "active") return command ? `${command} · flowing` : "flowing";

  let idle = "";
  if (win.activityTimestamp) {
    const elapsed = nowSeconds - win.activityTimestamp;
    if (elapsed > 0) idle = formatDuration(elapsed);
  }
  const idleText = idle ? `idle ${idle}` : "";
  if (command && idleText) return `${command} · ${idleText}`;
  if (idleText) return idleText;
  return command || "idle";
}

/** Build the L1 `agt` register string when an agent is present: e.g.
 *  `waiting 3m` / `active` / `idle 12m`. Null when no `agentState`.
 *  `agentIdleDuration` is populated for `active` too, but rendered only for
 *  the two rest states. */
export function getAgentLine(win: WindowInfo): string | null {
  if (!win.agentState) return null;
  if (win.agentIdleDuration && (win.agentState === "waiting" || win.agentState === "idle"))
    return `${win.agentState} ${win.agentIdleDuration}`;
  return win.agentState;
}

export type FabParts = { id: string; slug?: string; stage: string; displayState?: string };

/** Resolve the L2 `fab` register into its parts so a surface can compose them
 *  across lines (the row-hover flyout card leads with the decisive tokens and
 *  moves the slug to a continuation line). Null when the window has no
 *  parseable fab change or no stage.
 *
 *  The slug is written ONCE: pass the active pane's git branch as `branch`;
 *  when the branch carries the change (`branch.endsWith(`${id}-${slug}`)` — a
 *  fab pane's branch IS the change folder name, already shown by the `git`
 *  row) `slug` is omitted. Otherwise the slug stays — its presence beside a
 *  `main` or hand-named branch is itself the signal that the pane is off its
 *  change branch. */
export function getFabParts(win: WindowInfo, branch?: string): FabParts | null {
  const fabChange = parseFabChange(win.fabChange ?? "");
  if (!fabChange || !win.fabStage) return null;
  const parts: FabParts = { id: fabChange.id, stage: win.fabStage };
  if (!(branch && branch.endsWith(`${fabChange.id}-${fabChange.slug}`))) parts.slug = fabChange.slug;
  if (win.fabDisplayState) parts.displayState = win.fabDisplayState;
  return parts;
}

/** Build the L2 `fab` register string: `<id>[ <slug>] · <stage>[ ·
 *  <displayState>]` — the slug segment is omitted when `branch` carries the
 *  change (see getFabParts). The displayState segment is appended when present
 *  (`fab pane map` may omit it on older binaries). Null when the window has no
 *  parseable fab change or no stage. The plain-text form — copy/aria/title —
 *  so surfaces that colour the state token compose from getFabParts instead. */
export function getFabLine(win: WindowInfo, branch?: string): string | null {
  const parts = getFabParts(win, branch);
  if (!parts) return null;
  return `${parts.id}${parts.slug ? ` ${parts.slug}` : ""} · ${parts.stage}${parts.displayState ? ` · ${parts.displayState}` : ""}`;
}

/** Split a branch's leading fab-style date prefix (`^\d{6}-`) from the rest,
 *  so the `git` row and the status bar's `⑂` segment can dim the least
 *  scannable part of the branch (`prefix` empty when absent). Copy values
 *  always use the full branch, never this split. */
export function splitDatePrefix(branch: string): { prefix: string; rest: string } {
  const m = /^\d{6}-/.exec(branch);
  return m ? { prefix: m[0], rest: branch.slice(m[0].length) } : { prefix: "", rest: branch };
}

export type PrSegment = { text: string; color: string };

export type OperatorLoopFacts = { stale: boolean; lastTickAt?: number };
export type OperatorParts = { head: string; facets?: string };

/** L4 `opr` register. Precedence: `win.monitored === true` WINS — the watched
 *  head leads with the decisive tokens: `watched · <monitoredStage> · tick
 *  <age> ago`; the stage segment is omitted when absent, the tick segment when
 *  `lastTickAt` is 0/absent (never ticked). `facets` = `<monitoredRepo> ·
 *  <monitoredBranch>` (empty segments omitted; undefined when both absent).
 *  Otherwise `win.owner === "operator"` yields the done head
 *  `{ head: "done · operator-touched" }` — no facets, no tick age, and the
 *  `operator` facts are ignored entirely for that branch: a done row has no
 *  live loop, so stale never applies to it (consumers gate data-stale on the
 *  watched branch). Null otherwise (degrade-to-absent, the NoteLine gate).
 *  `stale` is consumed verbatim — the threshold is server-derived, never
 *  recomputed here. */
export function getOperatorParts(
  win: WindowInfo,
  operator: OperatorLoopFacts | undefined,
  nowSeconds: number,
): OperatorParts | null {
  if (win.monitored !== true) {
    return win.owner === "operator" ? { head: "done · operator-touched" } : null;
  }
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

/** The L3 `PR` register as two groups so a surface can compose it across
 *  lines: `identity` (`#<n>` + the state segment) leads; `health` (`checks
 *  <c>`, `review: <r>`) is the expendable tail — the PANE panel moves it to a
 *  continuation line, while `getPrSegments` joins both for the one-line
 *  surfaces (the flyout card, the status bar). */
export type PrParts = { identity: PrSegment[]; health: PrSegment[] };

/**
 * Resolve the L3 `PR` register into identity + health parts, e.g.
 * identity `#241 · open`, health `checks pass · review: approved` for an open
 * PR; identity `#241 · merged` with EMPTY health once it lands. Returns null
 * unless the window carries a `prNumber`. Gated ONLY on `prNumber` — NOT on
 * `fabChange` — because the L3 register shows the PR for ANY pane on a branch
 * with a PR (derivation is universal, Constitution Principle X; the ladder's
 * per-family dot ownership is a separate concern — see statusDotState). For a
 * merged/closed PR the checks and review parts are suppressed (they're
 * historical once the PR is no longer open); only the terminal state is shown.
 * The state segment color is purely the GitHub state (open→green via
 * PR_STATE_COLORS), NOT a health verdict — health is conveyed by the checks
 * and review segments here plus the sidebar dot. A draft is not dimmed: its
 * state follows PR_STATE_COLORS like any open PR, so an open draft shows
 * green. This reflects the project's "green = health, not merge-readiness"
 * story (a draft with passing checks is healthy, just not flipped to ready)
 * and keeps the PR surfaces consistent.
 */
export function getPrParts(win: WindowInfo): PrParts | null {
  if (!win.prNumber) return null;
  const identity: PrSegment[] = [{ text: `#${win.prNumber}`, color: "text-text-primary" }];
  if (win.prState) {
    identity.push({
      text: `${win.prState}${win.prIsDraft ? " (draft)" : ""}`,
      color: PR_STATE_COLORS[win.prState],
    });
  }
  const health: PrSegment[] = [];
  const isOpen = !win.prState || win.prState === "open";
  if (isOpen && win.prChecks && win.prChecks !== "none") {
    health.push({ text: `checks ${win.prChecks}`, color: PR_CHECKS_COLORS[win.prChecks] });
  }
  if (isOpen && win.prReview && win.prReview !== "none") {
    health.push({
      text: `review: ${win.prReview.replace(/_/g, " ")}`,
      color: PR_REVIEW_COLORS[win.prReview],
    });
  }
  return { identity, health };
}

/** Build the L3 `PR` register as ONE flat list of colored segments —
 *  `[...identity, ...health]` from getPrParts — e.g. "#241 · open · checks
 *  pass" for an open PR, or "#241 · merged" once it lands. The one-line form
 *  for the flyout card and the status bar; null without `prNumber`. */
export function getPrSegments(win: WindowInfo): PrSegment[] | null {
  const parts = getPrParts(win);
  if (!parts) return null;
  return [...parts.identity, ...parts.health];
}

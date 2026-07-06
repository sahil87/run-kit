import { refreshPrStatus } from "@/api/client";
import type { WindowInfo } from "@/types";

/** State glyph: open=●, merged=✓, closed=✗. Falls back to ● for unknown. */
function stateGlyph(state: WindowInfo["prState"]): string {
  switch (state) {
    case "merged":
      return "✓";
    case "closed":
      return "✗";
    default:
      return "●";
  }
}

/**
 * Colored checks/review segments for the live PR line, e.g. a green "checks
 * pass" and a red "review: changes requested". Each segment carries its own
 * color token from the shared vocabulary so the dashboard line matches the Pane
 * panel segment-by-segment. Mirrors getPrSegments' rule: checks/review are
 * historical once the PR is no longer open, so they're suppressed for a
 * merged/closed PR (only the terminal state shows). `none`/absent is dropped.
 */
function summarySegments(win: WindowInfo): { text: string; color: string }[] {
  const isOpen = !win.prState || win.prState === "open";
  if (!isOpen) return [];
  const parts: { text: string; color: string }[] = [];
  if (win.prChecks && win.prChecks !== "none") {
    parts.push({ text: `checks ${win.prChecks}`, color: PR_CHECKS_COLORS[win.prChecks] });
  }
  if (win.prReview && win.prReview !== "none") {
    parts.push({ text: `review: ${win.prReview.replace(/_/g, " ")}`, color: PR_REVIEW_COLORS[win.prReview] });
  }
  return parts;
}

/** Fail-ish states get the red token; everything else uses the secondary token. */
export function isFailish(win: WindowInfo): boolean {
  return win.prChecks === "fail" || win.prReview === "changes_requested";
}

/**
 * Per-segment PR color vocabulary, shared by the PR text surfaces — the
 * dashboard line (PrStatusLine, below) and the Pane panel segments
 * (status-panel.tsx getPrSegments, which imports these). (The sidebar StatusDot
 * no longer uses these — it renders from the lifecycle PHASE_HUE/SHAPE maps; see
 * status-dot.tsx.) GitHub-style: open=green, merged=purple, closed=red; checks/review
 * pass/approved=green, fail/changes_requested=red, pending/review_required=
 * yellow. No new hex — `text-accent-green` is the theme token (themes.ts); the
 * other four are the established PR Tailwind tokens. This is the single source
 * of truth so a token rename touches one place and every surface stays in step.
 */
export const PR_STATE_COLORS: Record<NonNullable<WindowInfo["prState"]>, string> = {
  open: "text-accent-green",
  merged: "text-purple-400",
  closed: "text-red-400",
};

export const PR_CHECKS_COLORS: Record<string, string> = {
  pass: "text-accent-green",
  fail: "text-red-400",
  pending: "text-yellow-400",
};

export const PR_REVIEW_COLORS: Record<string, string> = {
  approved: "text-accent-green",
  changes_requested: "text-red-400",
  review_required: "text-yellow-400",
};

/**
 * The five "traffic-light" states for the sidebar PR dot, generalizing the old
 * single red triage dot. GREEN MEANS HEALTH, NOT MERGE-READINESS — a draft with
 * passing checks is `healthy` (green), just not flipped to ready.
 */
export type PrDotState = "merged" | "fail" | "pending" | "healthy" | "neutral";

/**
 * Derive the PR dot state from the live PR fields on a window. First match wins
 * — the precedence order IS the design:
 *   1. `merged` first — a landed PR; historical checks/review are noise (mirrors
 *      status-panel suppressing checks/review once `!open`). `closed` is NOT
 *      here, so it falls through to `neutral`. Transient by design (Constitution
 *      II): an aged-out merge resets to `neutral`, never persisted.
 *   2. `fail` BEFORE `healthy` — an approved PR with a freshly-pushed failing
 *      commit MUST read red, never green. This branch IS `isFailish` (single
 *      source of truth shared with PrStatusLine).
 *   3. `pending` — checks still running.
 *   4. `healthy` — checks pass (draft included; green = health, so no draft
 *      contradiction and deliberately NO `&& approved` requirement).
 *   5. `neutral` — open with no decisive signal yet, closed-unmerged, or an
 *      aged-out merge. Renders as a dim/hollow dot.
 */
export function prDotState(win: WindowInfo): PrDotState {
  if (win.prState === "merged") return "merged";
  if (isFailish(win)) return "fail";
  if (win.prChecks === "pending") return "pending";
  if (win.prChecks === "pass") return "healthy";
  return "neutral";
}

/**
 * Lifecycle status-dot model (palette v3 — status-pyramid.md) — TWO orthogonal
 * axes plus an additive attention overlay:
 *   - `phase` → CORE HUE (which journey + position in it)
 *   - `shape` → STATUS (health, using ONE shape vocabulary across fab AND PR)
 *   - `waiting` → ATTENTION overlay (additive constant-yellow halo; NEVER
 *     touches core hue/shape). See status-dot.tsx for the halo rendering.
 *
 * The core hue + shape are owned by TWO ladders joined at the top — first
 * precondition wins:
 *   fabChange ?  (prNumber ? purple-PR : stage==intake ? blue : green)   [cool = fab]
 *             :  (fresh agentState ? (prNumber ? orange-PR : yellow) : gray)  [warm = agent / floor]
 * The glance rule: cool core = my pipeline, warm core = my ad-hoc agents,
 * gray = just a terminal, yellow HALO = needs me now.
 */
export type DotShape = "ring" | "solid" | "failed" | "done" | "skipped";

/**
 * Palette-v3 phase model (status-pyramid.md § The Channel Model). The amber
 * `execution`/`completion` grouping RETIRES — apply/review/hydrate/ship/review-pr
 * all collapse to a single `apply` (green) phase (the "green collapse": the old
 * ship/review-pr green barely rendered, since /git-pr creates the PR mid-ship
 * and purple takes the dot the moment prNumber exists). The two families:
 *   cool = fab pipeline: `intake` (blue) → `apply` (green) → `pr` (purple)
 *   warm = ad-hoc agent: `agent` (yellow) → `agentPr` (orange)
 *   `none` = gray floor (no journey)
 */
export type DotPhase = "intake" | "apply" | "pr" | "agent" | "agentPr" | "none";

export type StatusDotState = {
  phase: DotPhase; // → core hue
  shape: DotShape; // → shape
  /** Attention overlay: when true, an additive constant-yellow halo wraps the
   *  dot (core hue + shape untouched). Set from the window's rolled-up
   *  `agentState === "waiting"`. Ladder-exempt — overlays any tier. */
  waiting?: boolean;
};

/**
 * fabStage → cool-family phase (palette v3): only `intake` gets its own blue
 * hue; every other fab stage (apply/review/hydrate/ship/review-pr) collapses to
 * the single green `apply` phase. Unknown/absent → `apply` (a live fab window
 * with an unrecognized stage still reads as the green working tier, not gray) —
 * the purple `pr` phase is chosen in `statusDotState`, never here.
 */
export function fabPhase(stage: string | undefined): DotPhase {
  if (stage === "intake") return "intake";
  return "apply";
}

/**
 * fabDisplayState → shape (the unified shape vocabulary). An unknown/absent
 * display-state on a fab window defaults to `solid` — a live fab window with a
 * future/unrecognized state should still read as a live dot, not vanish.
 */
export function fabShape(displayState: string | undefined): DotShape {
  switch (displayState) {
    case "pending":
      return "ring";
    case "failed":
      return "failed";
    case "done":
      return "done";
    case "skipped":
      return "skipped";
    case "active":
    case "ready":
    default:
      return "solid";
  }
}

/**
 * PR fields → shape, reusing the existing `prDotState` semantics so the PR
 * surfaces stay in lock-step: merged→done, fail→failed, pending→ring,
 * healthy→solid. The PR is the purple `phase`; this maps only its status to a
 * shape.
 *
 * `neutral` splits by `prState`: a **closed-unmerged** PR maps to `skipped`
 * (the gray hollow ring, labelled "PR — closed" — matching docs/specs/status-dot.md
 * line 61/82 and `PR_SHAPE_LABEL.skipped`), while an open / aged-out-merge
 * neutral maps to `solid` (purple, "PR — open"). The closed check runs only on
 * the `neutral` fall-through, AFTER `prDotState`'s precedence — so a CLOSED PR
 * with failing checks still reads `failed` (`isFailish` wins inside
 * `prDotState`). `prDotState`'s own behavior is UNCHANGED (R9): the
 * closed→skipped mapping lives here in `prShape`, not in `prDotState`.
 */
export function prShape(win: WindowInfo): DotShape {
  switch (prDotState(win)) {
    case "merged":
      return "done";
    case "fail":
      return "failed";
    case "pending":
      return "ring";
    case "healthy":
      return "solid";
    case "neutral":
    default:
      // Closed-unmerged → the gray `skipped` ring; open / aged-out-merge → solid.
      return win.prState === "closed" ? "skipped" : "solid";
  }
}

/**
 * phase → core-hue token (palette v3, status-pyramid.md § The Channel Model).
 * Two families + floor: cool fab (blue intake → green apply-collapsed → purple
 * PR), warm ad-hoc agent (yellow working → orange PR), gray floor. The amber
 * `execution`/`completion` tokens are GONE (green collapse). No raw hex —
 * `text-blue-400`/`text-yellow-400`/`text-orange-400` are standard Tailwind
 * classes; the rest are the established shared tokens.
 */
export const PHASE_HUE: Record<DotPhase, string> = {
  intake: "text-blue-400",
  apply: "text-accent-green",
  pr: "text-purple-400",
  agent: "text-yellow-400",
  agentPr: "text-orange-400",
  none: "text-text-secondary",
};

/**
 * Is there a fresh agent on this window? #314 clears stale/shell-reconciled
 * values server-side (the reconciler treats a plain-shell pane as no-agent and
 * the rollup omits it), so a non-empty rolled-up `agentState` on the window IS
 * fresh — no client-side staleness heuristic is needed. `waiting` is a valid
 * fresh state too (it maps to a yellow SOLID core + the additive halo).
 */
function hasFreshAgent(win: WindowInfo): boolean {
  return win.agentState === "active" || win.agentState === "waiting" || win.agentState === "idle";
}

/**
 * Two ladders joined at the top (palette v3 — status-pyramid.md § The Tier
 * Ladder). First precondition wins for the CORE hue + shape; `waiting` is an
 * additive overlay computed independently (ladder-exempt).
 *
 *   fabChange ?  (prNumber ? purple-PR : intake ? blue : green)     [cool = fab]
 *             :  (fresh agent ? (prNumber ? orange-PR : yellow) : gray floor)  [warm/floor]
 *
 * D1 (resolved): PR dot-ownership is PER-FAMILY — purple requires
 * `fabChange && prNumber`, orange requires `fresh agent && prNumber`. A plain
 * pane with neither a fab change nor a fresh agent stays on the gray floor even
 * when its branch has a PR (the PR still shows in the L3 register / tip /
 * PR-status line — derivation stays universal, Principle X — but never as a
 * mystifying floor-pane dot).
 *
 * D2 (closed-unmerged fallback): a CLOSED-unmerged PR never owns the dot — it
 * falls through to the underlying tier (a fab window shows its live green stage,
 * not a dead PR's skipped ring; decision-table row 20). A merged PR still owns
 * the dot as the purple/orange done square — durably, because the backend keeps
 * deriving it statelessly (`gh pr list --state all`), not via any grace window.
 * `ownsDot` gates PR ownership on `prNumber` present AND not closed.
 */
function prOwnsDot(win: WindowInfo): boolean {
  return !!win.prNumber && win.prState !== "closed";
}

export function statusDotState(win: WindowInfo): StatusDotState {
  const waiting = win.agentState === "waiting";
  if (win.fabChange) {
    // Cool family — fab pipeline.
    if (prOwnsDot(win)) return { phase: "pr", shape: prShape(win), waiting };
    return { phase: fabPhase(win.fabStage), shape: fabShape(win.fabDisplayState), waiting };
  }
  if (hasFreshAgent(win)) {
    // Warm family — ad-hoc agent.
    if (prOwnsDot(win)) return { phase: "agentPr", shape: prShape(win), waiting };
    // A waiting/active agent is mid-turn → solid; only a resting `idle` agent is a ring.
    return { phase: "agent", shape: win.agentState === "idle" ? "ring" : "solid", waiting };
  }
  // L0 floor — no fab change, no fresh agent: monochrome tmux activity.
  return { phase: "none", shape: win.activity === "active" ? "solid" : "ring", waiting };
}

/**
 * One-line live PR status for a change-bound window. Renders ONLY when the
 * window is change-bound (`fabChange`) AND has a `prNumber` — returns null
 * otherwise. Shared by the sidebar WindowRow and the dashboard window cards so
 * the gate, glyphs, and color tokens stay identical.
 *
 * Layout: `PR #<n> <glyph> <state> · <checks/review summary>`. `PR #<n>` is an
 * external link (new tab) whose click is stopped from bubbling so it never
 * selects/navigates the window. Clicking the rest of the line triggers a
 * best-effort `refreshPrStatus()` (the refreshed status arrives via SSE).
 *
 * Each segment is colored from the shared PR vocabulary (PR_STATE_COLORS /
 * PR_CHECKS_COLORS / PR_REVIEW_COLORS) — the SAME tokens the sidebar dot and the
 * Pane panel use — so a merged PR reads purple, a passing check green, a failing
 * one red, on every surface. The container itself stays `text-text-secondary`
 * (the default for `PR #<n>`, glyph, and separators); only the state and
 * checks/review words take a state color.
 */
export function PrStatusLine({ win }: { win: WindowInfo }) {
  if (!win.fabChange || !win.prNumber) return null;

  const summary = summarySegments(win);
  const draftSuffix = win.prIsDraft ? " (draft)" : "";

  return (
    <div
      className="flex items-center gap-1 text-xs text-text-secondary min-w-0 truncate"
      data-testid="pr-status-line"
      // Clicking the line (but not the link) kicks an on-demand refresh. This
      // is a best-effort progressive enhancement, NOT a semantic control — the
      // PR link below is the real, keyboard-accessible action — so we use a
      // plain onClick with no button role / tabIndex (a non-operable
      // role="button" would be an a11y lie). Errors are ignored (gh may be
      // absent/unauth server-side).
      onClick={(e) => {
        e.stopPropagation();
        void refreshPrStatus().catch(() => {});
      }}
      title="Refresh PR status"
    >
      {win.prUrl ? (
        <a
          href={win.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          // Don't let the link click select the window or trigger the refresh.
          onClick={(e) => e.stopPropagation()}
          className="hover:text-text-primary hover:underline shrink-0 coarse:py-1"
          data-testid="pr-status-link"
        >
          PR #{win.prNumber}
        </a>
      ) : (
        <span className="shrink-0">PR #{win.prNumber}</span>
      )}
      {win.prState && (
        <span className={`shrink-0 ${PR_STATE_COLORS[win.prState]}`}>
          {/* Glyph is decorative — the state word carries the meaning, so only
              the glyph is hidden from screen readers (the line is the sole PR
              signal on the dashboard, which has no accompanying dot). */}
          <span aria-hidden="true">{stateGlyph(win.prState)}</span> {win.prState}
          {draftSuffix}
        </span>
      )}
      {summary.map((seg) => (
        <span key={seg.text} className={`min-w-0 truncate ${seg.color}`}>
          {"·"} {seg.text}
        </span>
      ))}
    </div>
  );
}

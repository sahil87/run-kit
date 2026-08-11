import type { WindowInfo } from "@/types";

// NOTE (260715-jykd): the `PrStatusLine` dashboard component was retired here —
// it had zero live mount sites and was the sole consumer of the old
// POST /api/pr-status/refresh endpoint (now POST /api/status/refresh). Its
// PR-specific helpers (stateGlyph/summarySegments) went with it. This module is
// RETAINED as the single source of truth for the shared PR color vocabulary
// (PR_STATE_COLORS/PR_CHECKS_COLORS/PR_REVIEW_COLORS) AND the lifecycle
// status-dot model (statusDotState/fabPhase/fabShape/PHASE_HUE/...) —
// both still imported by status-dot.tsx, status-dot-label.ts, the register
// module (sidebar/registers.ts), the sidebar row (window-row.tsx — rest PR
// glyph gate/color), the session tiles (session-tiles.tsx — same glyph), and
// the row flyout card (sidebar/row-flyout-card.tsx).

/** Fail-ish states get the red token; everything else uses the secondary token. */
export function isFailish(win: WindowInfo): boolean {
  return win.prChecks === "fail" || win.prReview === "changes_requested";
}

/**
 * Per-segment PR color vocabulary, shared by the PR text surfaces — the Pane
 * panel segments (status-panel.tsx getPrSegments, which imports these). (The
 * sidebar StatusDot no longer uses these — it renders from the lifecycle
 * PHASE_HUE/SHAPE maps; see status-dot.tsx.) GitHub-style: open=green,
 * merged=purple, closed=red; checks/review
 * pass/approved=green, fail/changes_requested=red, pending/review_required=
 * yellow. No new hex — `text-accent-green` is the theme token (themes.ts); the
 * other four are the `--color-signal-*` theme tokens (globals.css). This is
 * the single source of truth so a token rename touches one place and every
 * surface stays in step.
 */
export const PR_STATE_COLORS: Record<NonNullable<WindowInfo["prState"]>, string> = {
  open: "text-accent-green",
  merged: "text-signal-purple",
  closed: "text-signal-red",
};

export const PR_CHECKS_COLORS: Record<string, string> = {
  pass: "text-accent-green",
  fail: "text-signal-red",
  pending: "text-signal-yellow",
};

export const PR_REVIEW_COLORS: Record<string, string> = {
  approved: "text-accent-green",
  changes_requested: "text-signal-red",
  review_required: "text-signal-yellow",
};

/**
 * The five "traffic-light" states for the PR signal, generalizing the old
 * single red triage dot. GREEN MEANS HEALTH, NOT MERGE-READINESS — a draft with
 * passing checks is `healthy` (green), just not flipped to ready. Consumed by
 * the glyph color chain (`prGlyphColor`) and the PR text surfaces — never by
 * the status DOT, which carries no PR state.
 */
export type PrDotState = "merged" | "fail" | "pending" | "healthy" | "neutral";

/**
 * Derive the PR state from the live PR fields on a window. First match wins
 * — the precedence order IS the design:
 *   1. `merged` first — a landed PR; historical checks/review are noise (mirrors
 *      status-panel suppressing checks/review once `!open`). `closed` is NOT
 *      here, so it falls through to `neutral`. Transient by design (Constitution
 *      II): an aged-out merge resets to `neutral`, never persisted.
 *   2. `fail` BEFORE `healthy` — an approved PR with a freshly-pushed failing
 *      commit MUST read red, never green. This branch IS `isFailish` (the
 *      single source of truth for the fail-ish check).
 *   3. `pending` — checks still running.
 *   4. `healthy` — checks pass (draft included; green = health, so no draft
 *      contradiction and deliberately NO `&& approved` requirement).
 *   5. `neutral` — open with no decisive signal yet, closed-unmerged, or an
 *      aged-out merge.
 */
export function prDotState(win: WindowInfo): PrDotState {
  if (win.prState === "merged") return "merged";
  if (isFailish(win)) return "fail";
  if (win.prChecks === "pending") return "pending";
  if (win.prChecks === "pass") return "healthy";
  return "neutral";
}

/**
 * Lifecycle status-dot model (compositional vocabulary — status-pyramid.md) —
 * TWO orthogonal axes plus an additive attention overlay:
 *   - `phase` → CORE HUE (which journey + position in it)
 *   - `shape` → STATUS (health — the SAME meaning in every hue)
 *   - `waiting` → ATTENTION overlay (additive constant-yellow halo; NEVER
 *     touches core hue/shape). See status-dot.tsx for the halo rendering.
 *
 * The dot tells the LOCAL story only (what runs in this pane: which journey,
 * is it healthy, does it need me). The REMOTE story — the branch's PR on
 * GitHub — lives on the row's rest-state PR glyph (`prOwnsGlyph` /
 * `prGlyphColor`), never on the dot. The core hue + shape are owned by two
 * ladders joined at the top — first precondition wins:
 *   fabChange ?  (stage ∈ {intake,apply,review} ? blue-building : green-prReady)
 *             :  (fresh agentState ? yellow agent : gray floor)
 * The glance rule: blue = still cooking, green = out the door / done,
 * yellow core = my ad-hoc agents, gray = just a terminal, yellow HALO = needs
 * me now.
 */
export type DotShape = "ring" | "solid" | "failed";

/**
 * Compositional phase model (status-pyramid.md § The Channel Model). Four hues:
 *   cool = fab pipeline: `building` (blue — intake·apply·review) →
 *   `prReady` (green — ship·review-pr·done: local work complete, "PR is ready")
 *   warm = ad-hoc agent: `agent` (yellow)
 *   `none` = gray floor (no journey)
 * The purple/orange PR hues are RETIRED from the dot — PR state is the row
 * glyph's channel (`prGlyphColor`).
 */
export type DotPhase = "building" | "prReady" | "agent" | "none";

export type StatusDotState = {
  phase: DotPhase; // → core hue
  shape: DotShape; // → shape
  /** Attention overlay: when true, an additive constant-yellow halo wraps the
   *  dot (core hue + shape untouched). Set from the window's rolled-up
   *  `agentState === "waiting"`. Ladder-exempt — overlays any tier. */
  waiting?: boolean;
};

/**
 * fabStage → fab phase: the two-stop split. `intake`/`apply`/`review` are the
 * pre-PR BUILDING stages (blue); every other stage — `ship`/`review-pr`/`done`,
 * plus unknown/absent — reads `prReady` (green: the change has completed its
 * local work). The split is STAGE-based, never `prNumber`-based — the dot must
 * not consult PR fields (alignment with PR existence stays emergent, since
 * /git-pr creates the PR mid-ship).
 */
export function fabPhase(stage: string | undefined): DotPhase {
  if (stage === "intake" || stage === "apply" || stage === "review") return "building";
  return "prReady";
}

/**
 * fabDisplayState → shape. `done` maps to `ring` — a parked-done change is
 * RESTING (journey complete), so it shares the at-rest ring; its green hue says
 * "done", the merged glyph (if any) says how it ended. An unknown/absent
 * display-state on a fab window defaults to `solid` — a live fab window with a
 * future/unrecognized state should still read as a live dot, not vanish.
 * A `skipped` display-state never reaches here — `statusDotState` treats a
 * skipped change as not fab-owned (ladder fall-through).
 */
export function fabShape(displayState: string | undefined): DotShape {
  switch (displayState) {
    case "pending":
      return "ring";
    case "failed":
      return "failed";
    case "done":
      return "ring";
    case "active":
    case "ready":
    default:
      return "solid";
  }
}

/**
 * phase → core-hue token (compositional vocabulary, status-pyramid.md § The
 * Channel Model). Four hues: blue building → green PR-ready (cool fab), yellow
 * ad-hoc agent (warm), gray floor. `text-purple-400`/`text-orange-400` are
 * GONE from the dot — purple stays in the glyph/segment vocabularies. No raw
 * hex — `text-signal-blue`/`text-signal-yellow` are the per-theme signal
 * tokens (globals.css); the rest are the established shared tokens.
 */
export const PHASE_HUE: Record<DotPhase, string> = {
  building: "text-signal-blue",
  prReady: "text-accent-green",
  agent: "text-signal-yellow",
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
 * Gate for the row's rest-state PR glyph (93dy → aqo6 → xuej): `prNumber`
 * present with a KNOWN owned state — `open`, `merged`, or `closed`. Open,
 * failing, and merged PRs all earn the glyph; a dead closed PR earns it too,
 * in its distinct closed-icon muted form (the ✕ shape says "closed", the
 * `text-text-secondary` token says "dead — ignore"). The gate is a positive
 * allowlist, not `!== "closed"`: the backend's branch channel deliberately
 * maps an unconfident state to `""` (MapBranchState — serialized as an
 * ABSENT `prState` via omitempty), and a stateless PR MUST NOT own the glyph
 * any more than it owned the old dot — a `!==` check would let it through
 * and paint a glyph for an unknown PR. Deliberately NOT family-gated: the
 * glyph shows for any owned PR, even on a plain floor pane (derivation is
 * universal, Principle X). Formerly `prOwnsDot` — renamed when the PR was
 * evicted from the dot: this predicate now gates ONLY the glyph, never any
 * dot tier.
 */
export function prOwnsGlyph(win: WindowInfo): boolean {
  return !!win.prNumber && (win.prState === "open" || win.prState === "merged" || win.prState === "closed");
}

/**
 * Color token for the rest-state PR glyph (window row + session tiles),
 * reusing the shared PR vocabulary so the glyph stays in lock-step with the
 * segments. SIX-WAY mapping, and the branch order IS the design:
 *   1. `text-text-secondary` for a CLOSED PR (xuej) — a dead PR renders
 *      muted (the established inert/no-journey token, shared with draft;
 *      the ✕ closed icon is what separates closed from draft). Closed sits
 *      ABOVE fail on purpose: a closed PR's check/review state is historical
 *      noise, the same first-match rationale that puts `merged` above `fail`
 *      in `prDotState`. (The GitHub-exact red variant was considered and
 *      rejected by the user: dead PRs should not draw rest-state attention.)
 *   2. `text-signal-red` for a fail-ish PR (`prDotState` → `fail`, i.e.
 *      `isFailish`). FAIL STAYS ON TOP of everything open — a draft whose
 *      checks fail (or that has changes requested) is a problem first and a
 *      draft second, the same `isFailish`-dominates rule `prDotState`
 *      encodes by ordering `fail` ahead of `healthy`.
 *   3. `text-text-secondary` for an OPEN DRAFT (e30p) — GitHub renders drafts
 *      gray, and this is already the "inert / no journey" token in this model
 *      (`PHASE_HUE.none`). Draft sits ABOVE pending on purpose: drafts stay
 *      muted even while their checks run (pending would un-mute them). The
 *      branch is GATED ON `prState === "open"` so the merged→purple and
 *      closed paths are untouched BY CONSTRUCTION (a closed draft reads
 *      closed, GitHub semantics).
 *   4. `text-signal-yellow` for open with `prChecks === "pending"` — CHECKS
 *      RUNNING (aqo6): the row-level signal that replaced the dot's retired
 *      purple pending ring; same token choice as `PR_CHECKS_COLORS.pending`.
 *   5. `text-accent-green` for open otherwise (checks pass or no decisive
 *      signal).
 *   6. `text-signal-purple` for merged.
 * Unknown/absent states never reach here (the `prOwnsGlyph` allowlist admits
 * only `open`/`merged`/`closed`), so the merged fall-through in branch 5/6
 * is safe by construction. No new color
 * system — all are established tokens (PR_STATE_COLORS /
 * `--color-text-secondary`).
 *
 * NOTE: this is the GLYPH axis — the remote story. The status dot never
 * renders PR state at all (the local/remote split); draft, pending, merged,
 * and closed are glyph-only distinctions.
 */
export function prGlyphColor(win: WindowInfo): string {
  if (win.prState === "closed") return "text-text-secondary"; // dead PR: muted; stale checks are noise
  if (prDotState(win) === "fail") return "text-signal-red";
  if (win.prState === "open" && win.prIsDraft) return "text-text-secondary";
  if (win.prState === "open" && win.prChecks === "pending") return "text-signal-yellow";
  return win.prState === "open" ? "text-accent-green" : "text-signal-purple";
}

/**
 * Two ladders joined at the top (status-pyramid.md § The Tier Ladder). First
 * precondition wins for the CORE hue + shape; `waiting` is an additive overlay
 * computed independently (ladder-exempt).
 *
 *   fabChange ?  (stage ∈ {intake,apply,review} ? blue-building : green-prReady,
 *                 shape by fabDisplayState)
 *             :  (fresh agent ? yellow (solid mid-turn / ring idle) : gray floor)
 *
 * NO PR BRANCH: the dot tells the local story only — a window's PR (open,
 * failing, merged, whatever) never owns the dot in any family. The remote
 * story lives on the row's rest-state glyph (`prOwnsGlyph`/`prGlyphColor`) and
 * the register surfaces (derivation stays universal, Principle X).
 *
 * A `skipped` fabDisplayState makes the window NOT fab-owned — the change has
 * left its journey, so the ladder falls through (fresh agent → yellow, else
 * the gray floor), rather than rendering any fab hue.
 */
export function statusDotState(win: WindowInfo): StatusDotState {
  const waiting = win.agentState === "waiting";
  if (win.fabChange && win.fabDisplayState !== "skipped") {
    // Cool family — fab pipeline: blue building → green PR-ready.
    return { phase: fabPhase(win.fabStage), shape: fabShape(win.fabDisplayState), waiting };
  }
  if (hasFreshAgent(win)) {
    // Warm family — ad-hoc agent.
    // A waiting/active agent is mid-turn → solid; only a resting `idle` agent is a ring.
    return { phase: "agent", shape: win.agentState === "idle" ? "ring" : "solid", waiting };
  }
  // L0 floor — no fab change, no fresh agent: monochrome tmux activity.
  return { phase: "none", shape: win.activity === "active" ? "solid" : "ring", waiting };
}

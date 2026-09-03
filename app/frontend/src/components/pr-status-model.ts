import type { WindowInfo } from "@/types";

// This module is the single source of truth for the shared PR color vocabulary
// (PR_STATE_COLORS/PR_CHECKS_COLORS/PR_REVIEW_COLORS) AND the lifecycle
// status-dot model (statusDotState/fabPhase/PHASE_HUE/...) —
// both imported by status-dot.tsx, status-dot-label.ts, the register
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
 * Lifecycle status-dot model (compositional vocabulary — status-pyramid.md) —
 * TWO orthogonal axes plus two additive overlay flags:
 *   - `phase` → CORE HUE (which journey + position in it)
 *   - `shape` → LIVENESS (work happening NOW vs at rest — the SAME meaning in
 *     every hue)
 *   - `failed` → FAILURE overlay (additive red center over either shape; the
 *     only dot-red)
 *   - `waiting` → ATTENTION overlay (additive constant-yellow halo; NEVER
 *     touches core hue/shape). See status-dot.tsx for both overlays' rendering.
 *
 * The dot tells the LOCAL story only (what runs in this pane: which journey,
 * is anyone working, did the pipeline fail here, does it need me). The REMOTE
 * story — the branch's PR on GitHub — lives on the row's rest-state PR glyph
 * (`prOwnsGlyph` / `prGlyphColor`), never on the dot. The core hue + shape are
 * owned by two ladders joined at the top — first precondition wins:
 *   fabChange ?  (stage ∈ {intake,apply,review} ? blue-building : green-prReady)
 *             :  (fresh agentState ? yellow agent : gray floor)
 * The glance rule: blue = still cooking, green = out the door / done,
 * yellow core = my ad-hoc agents, gray = just a terminal, yellow HALO = needs
 * me now, red CENTER = the pipeline failed here.
 */
export type DotShape = "ring" | "solid";

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
  shape: DotShape; // → liveness shape
  /** Failure overlay: when true, an additive red center flags the dot over
   *  either shape (inside the hollow ring at rest; as a bullseye — dark gap
   *  ring cut between fill and center — over solid, so failure is never
   *  color alone). Set iff the window is fab-owned and
   *  `fabDisplayState === "failed"`. */
  failed?: boolean;
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
 * Is there a fresh agent on this window? Stale/shell-reconciled values are
 * cleared server-side (the reconciler treats a plain-shell pane as no-agent
 * and the rollup omits it), so a non-empty rolled-up `agentState` on the
 * window IS fresh — no client-side staleness heuristic is needed. `waiting`
 * is a valid fresh state too (it maps to a ring under the additive halo —
 * blocked is at rest).
 */
function hasFreshAgent(win: WindowInfo): boolean {
  return win.agentState === "active" || win.agentState === "waiting" || win.agentState === "idle";
}

/**
 * Gate for the row's rest-state PR glyph (93dy → aqo6 → xuej): `prNumber`
 * present with a KNOWN owned state — `open`, `merged`, or `closed`. Open,
 * failing, and merged PRs all earn the glyph; a dead closed PR earns it too,
 * in its distinct closed-icon red form (the ✕ shape says "closed", the
 * `text-signal-red` token is GitHub's closed color). The gate is a positive
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
 *   1. `text-signal-red` for a CLOSED PR — GitHub's closed red, and the
 *      same token `PR_STATE_COLORS.closed` already paints the status-panel /
 *      flyout "closed" segment, so glyph and text agree. Closed and fail-ish
 *      share red; the ✕ closed icon (not the color) separates them. Closed
 *      sits ABOVE fail on purpose: a closed PR's check/review state is
 *      historical noise, and a closed PR with PASSING checks must not fall
 *      through to green.
 *   2. `text-signal-purple` for MERGED — the same landed-PR rationale:
 *      historical checks/review are noise (mirrors status-panel suppressing
 *      checks/review once `!open`), so merged sits above fail too.
 *   3. `text-signal-red` for a fail-ish PR (`isFailish` — the single source
 *      of truth for the fail-ish check). FAIL STAYS ON TOP of everything
 *      open — a draft whose checks fail (or that has changes requested) is a
 *      problem first and a draft second.
 *   4. `text-text-secondary` for an OPEN DRAFT (e30p) — GitHub renders drafts
 *      gray, and this is already the "inert / no journey" token in this model
 *      (`PHASE_HUE.none`); draft is the ONLY gray glyph state, and it also
 *      carries its own shape (`GitPullRequestDraftIcon`). Draft sits ABOVE
 *      pending on purpose: drafts stay
 *      muted even while their checks run (pending would un-mute them). The
 *      branch is GATED ON `prState === "open"` so the closed path is
 *      untouched BY CONSTRUCTION (a closed draft reads closed, GitHub
 *      semantics).
 *   5. `text-signal-yellow` for open with `prChecks === "pending"` — CHECKS
 *      RUNNING (aqo6): the row-level signal that replaced the dot's retired
 *      purple pending ring; same token choice as `PR_CHECKS_COLORS.pending`.
 *   6. `text-accent-green` for open otherwise (checks pass or no decisive
 *      signal).
 * Unknown/absent states never reach here (the `prOwnsGlyph` allowlist admits
 * only `open`/`merged`/`closed`), so the purple fall-through on the last
 * line is safe by construction. No new color
 * system — all are established tokens (PR_STATE_COLORS /
 * `--color-text-secondary`).
 *
 * NOTE: this is the GLYPH axis — the remote story. The status dot never
 * renders PR state at all (the local/remote split); draft, pending, merged,
 * and closed are glyph-only distinctions.
 */
export function prGlyphColor(win: WindowInfo): string {
  if (win.prState === "closed") return "text-signal-red"; // dead PR: GitHub red; the ✕ shape separates it from fail-ish
  if (win.prState === "merged") return "text-signal-purple"; // landed: stale checks are noise too
  if (isFailish(win)) return "text-signal-red";
  if (win.prState === "open" && win.prIsDraft) return "text-text-secondary";
  if (win.prState === "open" && win.prChecks === "pending") return "text-signal-yellow";
  return win.prState === "open" ? "text-accent-green" : "text-signal-purple";
}

/**
 * Two ladders joined at the top (status-pyramid.md § The Tier Ladder). First
 * precondition wins for the CORE hue; SHAPE is liveness, derived per family;
 * `failed` and `waiting` are additive overlay flags computed independently
 * (ladder-exempt).
 *
 *   fabChange ?  (stage ∈ {intake,apply,review} ? blue-building : green-prReady,
 *                 shape by agent liveness, failed flag by fabDisplayState)
 *             :  (fresh agent ? yellow (solid mid-turn / ring at rest)
 *                             : gray floor, shape by tmux activity)
 *
 * SHAPE = LIVENESS, per family (the L0 output fallback is the floor's ALONE —
 * flowing output in a fab worktree must not render a journey hue solid):
 *   - journey hues (fab blue/green, ad-hoc yellow): `solid` iff the rolled-up
 *     `agentState === "active"` (mid-turn). `waiting`, `idle`, and absent all
 *     yield `ring` — a waiting agent is blocked, therefore at rest.
 *   - floor (gray): `activity === "active"` → solid, else ring (unchanged).
 * `agentState` is PID-reconciled server-side, so a solid cannot outlive its
 * process — but solid is not proof of progress (a wedged live agent stays
 * solid until the reserved `stuck` overlay exists).
 *
 * FAILED = an additive overlay flag, not a shape: `failed` is true iff the
 * window is fab-owned with `fabDisplayState === "failed"`. It composes with
 * either shape — ring + red center = "failed, nobody on it — act"; solid +
 * red center (bullseye) = "failed, rework live". This is the ONLY dot-red.
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
    // Cool family — fab pipeline: blue building → green PR-ready. Shape is
    // agent liveness; the failed flag is the one thing fabDisplayState still
    // contributes besides the skipped gate above.
    return {
      phase: fabPhase(win.fabStage),
      shape: win.agentState === "active" ? "solid" : "ring",
      failed: win.fabDisplayState === "failed",
      waiting,
    };
  }
  if (hasFreshAgent(win)) {
    // Warm family — ad-hoc agent: solid mid-turn (`active`); `waiting` and
    // `idle` are both at rest (ring).
    return { phase: "agent", shape: win.agentState === "active" ? "solid" : "ring", waiting };
  }
  // L0 floor — no fab change, no fresh agent: monochrome tmux activity.
  return { phase: "none", shape: win.activity === "active" ? "solid" : "ring", waiting };
}

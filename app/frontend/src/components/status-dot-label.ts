import type { DotPhase, DotShape, StatusDotState } from "@/components/pr-status-model";
import type { WindowInfo } from "@/types";

/**
 * Shared label resolver for the status dot, extracted into its own module so
 * both `status-dot.tsx` (the dot) and `sidebar/row-flyout-card.tsx` (the
 * row-hover register flyout card, which reuses the label as its header) can
 * import it without forming an import cycle. `status-dot.tsx` re-exports
 * `dotLabel` to keep its public surface stable.
 *
 * Compositional vocabulary: the label is a pure function of what the DOT
 * shows — hue word + liveness word + overlay flags — with NO PR words. The
 * dot tells the local story only; PR facts ("merged", "checks running")
 * belong to the glyph and the register surfaces, which already render them.
 * The exact fab stage likewise lives in the `fab` register, not here.
 */

/** Human word for the fab PHASE/hue axis. */
const FAB_PHASE_LABEL: Record<Extract<DotPhase, "building" | "prReady">, string> = {
  building: "building",
  prReady: "PR-ready",
};

/**
 * Fab-hue liveness word, composed from the shape plus the additive failure
 * flag: solid = "worker live", ring = "at rest"; a flagged (failed) solid is
 * the bullseye — "failed — rework live" — and a flagged ring is
 * "failed — at rest". `failed` only occurs on fab tiers (the only dot-red).
 */
function fabLivenessWord(state: StatusDotState): string {
  if (state.failed) {
    return state.shape === "solid" ? "failed — rework live" : "failed — at rest";
  }
  return state.shape === "solid" ? "worker live" : "at rest";
}

// Ad-hoc agent liveness words. The agent tier only ever produces `solid`
// (agentState active — mid-turn) or `ring` (idle or waiting — both at rest) —
// see statusDotState. `ring` reads "idle", NOT a fab-stage word; a waiting
// agent's attention is carried by the additive waiting suffix below, not the
// core word.
const AGENT_SHAPE_LABEL: Record<DotShape, string> = {
  ring: "idle",
  solid: "active",
};

/**
 * The core (journey) portion of the label — everything except the additive
 * attention suffix. Compositional vocabulary (status-pyramid.md):
 *   - fab tiers (`building` / `prReady`): hue word + liveness word + failed
 *     flag ("building — worker live", "PR-ready — at rest",
 *     "building — failed — rework live"). Keyed on the PHASE, so a fab window
 *     whose `skipped` display-state fell through the ladder reads its
 *     floor/agent word, matching the dot it actually renders.
 *   - warm agent tier (`phase === "agent"`): the agent-native state word via
 *     AGENT_SHAPE_LABEL ("agent — active"/"agent — idle"). A waiting agent
 *     renders the ring and reads "agent — idle"; the waiting suffix below
 *     carries the attention.
 *   - L0 floor: the bare tmux activity word ("active"/"idle"), no journey.
 */
function coreLabel(win: WindowInfo, state: StatusDotState): string {
  if (state.phase === "building" || state.phase === "prReady") {
    return `${FAB_PHASE_LABEL[state.phase]} — ${fabLivenessWord(state)}`;
  }
  if (state.phase === "agent") return `agent — ${AGENT_SHAPE_LABEL[state.shape]}`;
  return win.activity; // L0 floor: "active" | "idle"
}

/**
 * Compose the full accessible label = core journey label + additive attention
 * suffix. The `waiting` overlay is ADDITIVE on every tier (status-pyramid.md
 * § Accessibility): a review-failed window that is waiting 3m reads
 * "building — failed — at rest — agent waiting 3m"; a plain waiting agent
 * reads "agent — idle — agent waiting 2m". The duration is taken from the
 * rk-computed `agentIdleDuration` (populated for `waiting` and `idle`). No
 * suffix when the window is not waiting.
 */
export function dotLabel(win: WindowInfo, state: StatusDotState): string {
  const core = coreLabel(win, state);
  if (state.waiting) {
    const dur = win.agentIdleDuration ? ` ${win.agentIdleDuration}` : "";
    return `${core} — agent waiting${dur}`;
  }
  return core;
}

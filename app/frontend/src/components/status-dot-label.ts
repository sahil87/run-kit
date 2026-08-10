import type { DotPhase, DotShape, StatusDotState } from "@/components/pr-status-model";
import type { WindowInfo } from "@/types";

/**
 * Shared label resolver for the status dot, extracted into its own module so
 * both `status-dot.tsx` (the dot) and `sidebar/row-flyout-card.tsx` (the
 * row-hover register flyout card, which reuses the label as its header) can
 * import it without forming an import cycle. `status-dot.tsx` re-exports
 * `dotLabel` to keep its public surface stable.
 *
 * Compositional vocabulary (aqo6): the label is a pure function of what the
 * DOT shows — hue word + status word — with NO PR words. The dot tells the
 * local story only; PR facts ("merged", "checks running") belong to the glyph
 * and the register surfaces, which already render them. The exact fab stage
 * likewise lives in the `fab` register, not here.
 */

/** Human word for the fab PHASE/hue axis. */
const FAB_PHASE_LABEL: Record<Extract<DotPhase, "building" | "prReady">, string> = {
  building: "building",
  prReady: "PR-ready",
};

/**
 * Human status word for a fab window, derived from `fabDisplayState` (not the
 * shape — `done` and `pending` both render the resting ring, but a parked-done
 * change reads "parked", never "pending"). Unknown/absent reads "active",
 * matching `fabShape`'s live-solid default.
 */
function fabStatusWord(displayState: string | undefined): string {
  switch (displayState) {
    case "pending":
      return "pending";
    case "failed":
      return "failed";
    case "done":
      return "parked";
    case "ready":
      return "ready";
    default:
      return "active";
  }
}

// Ad-hoc agent status words. The agent tier only ever produces `ring`
// (agentState idle) or `solid` (active/mid-turn) — see statusDotState — so it
// maps those two shapes onto agent-native words. `ring` reads "idle", NOT the
// fab-stage "pending": the module doc + docs/site/status-dot.md pin
// "agent — idle" / "agent — active" for this tier (the ring is the idle ring,
// not a pending ring). `failed` is unreachable here but is given a sensible
// fallback so the record is total.
const AGENT_SHAPE_LABEL: Record<DotShape, string> = {
  ring: "idle",
  solid: "active",
  failed: "failed",
};

/**
 * The core (journey) portion of the label — everything except the additive
 * attention suffix. Compositional vocabulary (status-pyramid.md):
 *   - fab tiers (`building` / `prReady`): hue word + displayState status word
 *     ("building — active", "PR-ready — parked"). Keyed on the PHASE, so a fab
 *     window whose `skipped` display-state fell through the ladder reads its
 *     floor/agent word, matching the dot it actually renders.
 *   - warm agent tier (`phase === "agent"`): the agent-native state word via
 *     AGENT_SHAPE_LABEL ("agent — active"/"agent — idle"). A waiting agent
 *     reads "agent — active" via the solid shape, and the waiting suffix below
 *     carries the attention.
 *   - L0 floor: the bare tmux activity word ("active"/"idle"), no journey.
 */
function coreLabel(win: WindowInfo, state: StatusDotState): string {
  if (state.phase === "building" || state.phase === "prReady") {
    return `${FAB_PHASE_LABEL[state.phase]} — ${fabStatusWord(win.fabDisplayState)}`;
  }
  if (state.phase === "agent") return `agent — ${AGENT_SHAPE_LABEL[state.shape]}`;
  return win.activity; // L0 floor: "active" | "idle"
}

/**
 * Compose the full accessible label = core journey label + additive attention
 * suffix. The `waiting` overlay is ADDITIVE on every tier (status-pyramid.md
 * § Accessibility): a review-failed window that is waiting 3m reads
 * "building — failed — agent waiting 3m"; a plain waiting agent reads
 * "agent — active — agent waiting 2m". The duration is taken from the
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

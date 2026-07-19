import type { DotShape, StatusDotState } from "@/components/pr-status-model";
import type { WindowInfo } from "@/types";

/**
 * Shared label resolver for the status dot, extracted into its own module so
 * both `status-dot.tsx` (the dot) and `status-dot-tip.tsx` (the hover-card)
 * can import it without forming an import cycle between the two components.
 * `status-dot.tsx` re-exports `dotLabel` to keep its public surface stable.
 */

/** Human word for the SHAPE/status axis used in the accessible label. */
const SHAPE_LABEL: Record<DotShape, string> = {
  ring: "pending",
  solid: "active",
  failed: "failed",
  done: "done",
  skipped: "skipped",
};

// PR-phase status words. The shared SHAPE_LABEL vocabulary is fab-stage language
// ("active"/"done"); for a PR those read unnaturally, so the PR branch maps the
// same shapes onto PR-native words — a PR is "open", "merged", "failing", not
// "active"/"done"/"failed".
const PR_SHAPE_LABEL: Record<DotShape, string> = {
  ring: "checks running",
  solid: "open",
  failed: "failing",
  done: "merged",
  skipped: "closed",
};

// Ad-hoc agent status words. The agent tier only ever produces `ring`
// (agentState idle) or `solid` (active/mid-turn) — see statusDotState — so it
// maps those two shapes onto agent-native words. `ring` reads "idle", NOT the
// fab-stage "pending": the module doc + docs/site/status-dot.md pin
// "agent — idle" / "agent — active" for this tier (the ring is the idle ring,
// not a pending ring). The other shapes are unreachable here but are given
// sensible fallbacks so the record is total.
const AGENT_SHAPE_LABEL: Record<DotShape, string> = {
  ring: "idle",
  solid: "active",
  failed: "failed",
  done: "done",
  skipped: "skipped",
};

/**
 * The core (journey) portion of the label — everything except the additive
 * attention suffix. Palette v3 (status-pyramid.md):
 *   - fab PR tier (`phase === "pr"`): PR-native words ("PR — merged").
 *   - fab non-PR tier (has `fabChange`): the real stage word ("apply — active").
 *     Gated on `win.fabChange`, not `phase`, so a fab window with an
 *     unknown/absent stage still reads "{stage-or-fab} — {status}", never a
 *     bare agent/tmux word.
 *   - warm agent tier (`phase === "agentPr"`): PR-native words ("PR — open").
 *   - warm agent tier (`phase === "agent"`): the agent-native state word via
 *     AGENT_SHAPE_LABEL ("agent — active"/"agent — idle"; the idle `ring` reads
 *     "idle", NOT the fab-stage "pending"). A waiting agent reads "agent —
 *     active" via the solid shape, and the waiting suffix below carries the
 *     attention.
 *   - L0 floor: the bare tmux activity word ("active"/"idle"), no journey.
 */
function coreLabel(win: WindowInfo, state: StatusDotState): string {
  if (state.phase === "pr" || state.phase === "agentPr") return `PR — ${PR_SHAPE_LABEL[state.shape]}`;
  if (win.fabChange) return `${win.fabStage ?? "fab"} — ${SHAPE_LABEL[state.shape]}`;
  if (state.phase === "agent") return `agent — ${AGENT_SHAPE_LABEL[state.shape]}`;
  return win.activity; // L0 floor: "active" | "idle"
}

/**
 * Compose the full accessible label = core journey label + additive attention
 * suffix. The `waiting` overlay is ADDITIVE on every tier (status-pyramid.md
 * § Accessibility): a review-failed window that is waiting 3m reads
 * "review — failed — agent waiting 3m"; a plain waiting agent reads
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

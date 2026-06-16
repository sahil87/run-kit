import type { DotShape, StatusDotState } from "@/components/pr-status-line";
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

/**
 * Compose the accessible label. The fab branch uses the real stage word
 * ("apply — active"); the PR branch uses PR-native words ("PR — merged"); the
 * tmux fallback uses the bare activity word ("active"/"idle"), no journey.
 *
 * The tmux fallback is gated on `!win.fabChange`, NOT on `phase === "none"`: a
 * fab-bound window whose `fabStage` is unknown/absent maps to `phase: "none"`
 * via `fabPhase` (and may carry a `failed`/`done` shape), yet it still
 * represents fab state — so it gets a `{stage} — {status}` label (the raw
 * `fabStage`, or the literal "fab" when the stage word is absent), never the
 * bare tmux activity word. Only a window with no `fabChange` is a true tmux
 * fallback.
 */
export function dotLabel(win: WindowInfo, state: StatusDotState): string {
  if (state.phase === "pr") return `PR — ${PR_SHAPE_LABEL[state.shape]}`;
  if (!win.fabChange) return win.activity; // tmux fallback: "active" | "idle"
  return `${win.fabStage ?? "fab"} — ${SHAPE_LABEL[state.shape]}`;
}

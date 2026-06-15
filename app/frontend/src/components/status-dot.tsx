import { statusDotState, PHASE_HUE, type DotShape, type StatusDotState } from "@/components/pr-status-line";
import type { WindowInfo } from "@/types";

/**
 * Unified lifecycle status dot reused on the sidebar window row, the dashboard
 * window cards, and the pane-panel header. It renders a single signal per
 * window via the `statusDotState` three-way precedence (PR > fab > tmux), using
 * TWO orthogonal visual channels:
 *
 *   - HUE = phase (where in the lifecycle journey): blue (intake) → amber
 *     (apply/review/hydrate) → green (ship/review-pr) → purple (the live PR).
 *     A plain window (no fab change, no PR) is gray — color is reserved for the
 *     fab/PR journey.
 *   - SHAPE = status (health), ONE vocabulary across fab stages AND PR:
 *       ring          → pending (PR: checks running)
 *       solid         → active / ready (PR: open / healthy)
 *       failed        → dashed ring in phase hue + a small RED center dot
 *                       (PR: checks fail / changes requested)
 *       done          → filled rounded square in phase hue (PR: merged)
 *       skipped       → gray hollow ring (PR: closed unmerged)
 *
 * Red is used in exactly ONE way across the whole system: the small center dot
 * inside a `failed` dashed ring — never as a whole-dot color (this removes the
 * old `fabDisplayState === "failed"` red tint and the old solid-red PR fail).
 *
 * `failed` and `done` render slightly larger (8px vs the 6px ring/solid) so the
 * dashed border shows enough dashes (with a clearly visible red center) and the
 * rounded square reads unambiguously as a square next to the circles.
 *
 * The dot always carries `role="img"` + `aria-label` + `title` composed from
 * phase + status (e.g. "apply — active", "PR — merged", "review — failed",
 * "intake — pending"), or "active"/"idle" for the tmux fallback — color is
 * never the sole channel (colorblind a11y + keyboard-first constitution).
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
function dotLabel(win: WindowInfo, state: StatusDotState): string {
  if (state.phase === "pr") return `PR — ${PR_SHAPE_LABEL[state.shape]}`;
  if (!win.fabChange) return win.activity; // tmux fallback: "active" | "idle"
  return `${win.fabStage ?? "fab"} — ${SHAPE_LABEL[state.shape]}`;
}

export function StatusDot({ win }: { win: WindowInfo }) {
  const state = statusDotState(win);
  const label = dotLabel(win, state);
  // `skipped` forces the gray token regardless of phase (a closed/skipped item
  // has left its journey hue behind); every other shape uses the phase hue.
  const color = state.shape === "skipped" ? "text-text-secondary" : PHASE_HUE[state.phase];

  const common = { role: "img" as const, "aria-label": label, title: label };

  if (state.shape === "done") {
    // Rounded square — slightly larger so it reads as a square vs the circles.
    return (
      <span
        {...common}
        className={`w-2 h-2 rounded-[3px] shrink-0 ${color}`}
        style={{ backgroundColor: "currentColor" }}
      />
    );
  }

  if (state.shape === "failed") {
    // Dashed ring in the phase hue with a small red center dot. Larger (8px) so
    // the dashed border shows enough dashes and the red center is legible.
    return (
      <span
        {...common}
        className={`relative inline-flex items-center justify-center w-2 h-2 rounded-full shrink-0 ${color}`}
        style={{ border: "1.8px dashed currentColor", backgroundColor: "transparent" }}
      >
        <span aria-hidden="true" className="w-1 h-1 rounded-full bg-red-400" />
      </span>
    );
  }

  if (state.shape === "solid") {
    return (
      <span
        {...common}
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${color}`}
        style={{ border: "none", backgroundColor: "currentColor" }}
      />
    );
  }

  // `ring` (pending) and `skipped` both render as a hollow ring; `skipped`
  // differs only in the forced gray `color` resolved above.
  return (
    <span
      {...common}
      className={`w-1.5 h-1.5 rounded-full shrink-0 ${color}`}
      style={{ border: "1.8px solid currentColor", backgroundColor: "transparent" }}
    />
  );
}

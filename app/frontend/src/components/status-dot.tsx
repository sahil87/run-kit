import { statusDotState, PR_DOT_COLOR, PR_DOT_LABEL } from "@/components/pr-status-line";
import type { WindowInfo } from "@/types";

/**
 * Unified status dot reused on the sidebar window row, the dashboard window
 * cards, and the pane-panel header. It renders a single signal per window via
 * the `statusDotState` precedence (PR-wins-else-activity):
 *
 *   - PR branch (change-bound window WITH a PR): renders exactly as the former
 *     sidebar PR dot — the four "live" states (merged/fail/pending/healthy)
 *     render a solid ● glyph in their `PR_DOT_COLOR` token (purple/red/yellow/
 *     green); `neutral` renders a dim hollow ring (border + transparent fill).
 *   - Activity branch (every other window): MONOCHROME fill-vs-ring (NO green) —
 *     `active` is a gray (`text-text-secondary`) filled dot, `idle` a gray
 *     hollow ring. All color is reserved for PR meaning so green/purple/red/
 *     yellow are never ambiguous (color = PR; activity = shape-only).
 *
 * The `fabDisplayState === "failed"` red tint (from the old activity dot) is
 * preserved on the ACTIVITY branch only — a window whose fab change failed shows
 * its activity dot in `text-red-400`. PR-branch dots already carry their own
 * color token, so the override never applies there.
 *
 * The dot always carries an `aria-label` + `title` (color is never the sole
 * channel — colorblind a11y + keyboard-first constitution): PR states reuse
 * `PR_DOT_LABEL`; activity states use "active" / "idle".
 */
export function StatusDot({ win }: { win: WindowInfo }) {
  const state = statusDotState(win);

  if (state.kind === "pr") {
    const color = PR_DOT_COLOR[state.pr];
    const label = PR_DOT_LABEL[state.pr];
    return state.pr === "neutral" ? (
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${color}`}
        aria-label={label}
        title={label}
        style={{ border: "1.5px solid currentColor", backgroundColor: "transparent" }}
      />
    ) : (
      <span className={`text-xs shrink-0 ${color}`} aria-label={label} title={label}>
        &#x25CF;
      </span>
    );
  }

  // Activity fallback — monochrome fill (active) vs. hollow ring (idle). A failed
  // fab change recolors the dot red (preserved from the old activity dot).
  const label = win.activity;
  const color = win.fabDisplayState === "failed" ? "text-red-400" : "text-text-secondary";
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full shrink-0 ${color}`}
      aria-label={label}
      title={label}
      style={{
        border: state.active ? "none" : "1.5px solid currentColor",
        backgroundColor: state.active ? "currentColor" : "transparent",
      }}
    />
  );
}

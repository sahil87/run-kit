import { statusDotState, PHASE_HUE } from "@/components/pr-status-model";
import { StatusDotTip } from "@/components/status-dot-tip";
import { dotLabel } from "@/components/status-dot-label";
import type { WindowInfo } from "@/types";

// `dotLabel` lives in `status-dot-label.ts` (shared with `status-dot-tip.tsx`
// to avoid an import cycle); re-export it so this module's public surface — and
// existing `@/components/status-dot` import sites — stay unchanged.
export { dotLabel };

/**
 * Unified lifecycle status dot reused on the sidebar window row, the dashboard
 * window cards, and the pane-panel header. It renders a single signal per
 * window via the `statusDotState` two-family ladder (palette v3 —
 * status-pyramid.md), using TWO orthogonal visual channels plus an additive
 * attention overlay:
 *
 *   - CORE HUE = phase (which journey + position in it). Cool = fab pipeline:
 *     blue (intake) → green (apply→review-pr, collapsed) → purple (the live PR).
 *     Warm = ad-hoc agent: yellow (working) → orange (its PR). Gray = floor
 *     (no fab change, no fresh agent) — color is reserved for a journey.
 *   - ATTENTION = the additive constant-yellow pulsing halo when the agent is
 *     `waiting` (state.waiting). NEVER touches the core hue or shape; it is a
 *     box-shadow ring layered over ANY tier (blue core + yellow halo = "fab
 *     intake asking"; green failed core + halo = "review failed, agent asking").
 *     Static yellow ring under prefers-reduced-motion (see globals.css).
 *   - SHAPE = status (health), ONE vocabulary across fab stages AND PR:
 *       ring          → pending (PR: checks running)
 *       solid         → active / ready (PR: open / healthy)
 *       failed        → dotted ring in phase hue + a small RED center dot
 *                       (PR: checks fail / changes requested)
 *       done          → filled sharp-cornered square in phase hue (PR: merged)
 *       skipped       → gray hollow ring (PR: closed unmerged)
 *
 * Red is used in exactly ONE way across the whole system: the small center dot
 * inside a `failed` dotted ring — never as a whole-dot color (this removes the
 * old `fabDisplayState === "failed"` red tint and the old solid-red PR fail).
 *
 * Every shape EXCEPT `failed` renders at one uniform 7px footprint (`DOT_SIZE`)
 * so the filled square and the hollow circles read as the same size in the dense
 * sidebar; the square is distinguished by its sharp (`rounded-none`) corners, not
 * by being bigger. The `failed` dot is the lone exception — a slightly larger 9px
 * footprint so its dotted bead-ring stays legible (see the failed branch below).
 *
 * The dot always carries `role="img"` + `aria-label` composed from phase +
 * status (e.g. "apply — active", "PR — merged", "review — failed",
 * "intake — pending"), or "active"/"idle" for the tmux fallback — color is
 * never the sole channel (colorblind a11y + keyboard-first constitution). The
 * native `title` tooltip is intentionally NOT set: the dot is wrapped by the
 * custom `StatusDotTip` hover-card (floating-ui based), which carries the same
 * label text plus a docs-link icon and (on PR-phase dots) an "Open PR" link.
 * A native `title` would double up with the custom card.
 */

// Every shape EXCEPT `failed` renders at one uniform footprint so the filled
// square and the hollow circles read as the same size in the dense sidebar (a
// filled 8px square next to a hollow 6px ring looks much bigger). The `failed`
// dot is the one exception — it uses a slightly larger 9px footprint so its
// dotted bead-ring has room to read (see the failed branch below).
const DOT_SIZE = "w-[7px] h-[7px]";

export function StatusDot({ win }: { win: WindowInfo }) {
  const state = statusDotState(win);
  const label = dotLabel(win, state);
  // `skipped` forces the gray token regardless of phase (a closed/skipped item
  // has left its journey hue behind); every other shape uses the phase hue.
  const color = state.shape === "skipped" ? "text-text-secondary" : PHASE_HUE[state.phase];

  // Additive waiting halo (palette v3 — status-pyramid.md § The Channel Model).
  // When the rolled-up agent state is `waiting`, wrap the dot in a constant-
  // yellow pulsing halo (a box-shadow ring, static under reduced-motion). It is
  // ADDITIVE — the core hue (`color`) and shape below are untouched, so a blue
  // intake dot keeps its blue core, a green failed dot keeps its failed shape;
  // only the yellow halo is layered on. The class rides the dot element itself
  // (box-shadow renders outside the border-box, so it disturbs neither the
  // dot's size nor its hue), keeping the floating-ui `setRef` on one element.
  const halo = state.waiting ? " rk-waiting-halo" : "";

  // The dot's shape markup. `setRef`/`tipProps` come from StatusDotTip — they
  // make the dot the floating-card reference and wire hover/focus/aria. The
  // native `title` is intentionally dropped (the custom card replaces it); the
  // accessible name lives on `aria-label`.
  const renderDot = (
    setRef: (node: HTMLElement | null) => void,
    tipProps: Record<string, unknown>,
  ) => {
    const common = {
      ref: setRef,
      role: "img" as const,
      "aria-label": label,
      // Make the dot keyboard-focusable so the hover-card also opens on focus
      // (Constitution V — keyboard-first); the floating-ui reference props don't
      // add a tabstop, so set it explicitly.
      //
      // Tradeoff (reviewed, accepted): on the sidebar this dot sits inside the
      // row <button>/treeitem, so it becomes a second tab stop ahead of the row.
      // A <span role="img" tabindex="0"> is FOCUSABLE but not "interactive
      // content" in the HTML button content-model sense (that bars <a>/<button>/
      // <input>, not a focusable span), so this is valid markup, and the
      // sidebar's tree keydown handler anchors on closest('[role="treeitem"]'),
      // so arrow-nav still works from a focused dot. The extra tab stop is the
      // accepted cost of focus-open; see docs/memory § Keyboard Navigation.
      tabIndex: 0,
      ...tipProps,
    };

    if (state.shape === "done") {
      // Sharp-cornered square (no rounding). At 7px even a 1px radius softens
      // the corners enough to blur the square-vs-circle distinction, so render
      // fully square (`rounded-none`) to keep `done` visually distinct from the
      // round shapes. Same DOT_SIZE as every other shape so it doesn't dominate.
      return (
        <span
          {...common}
          className={`${DOT_SIZE} rounded-none shrink-0 ${color}${halo}`}
          style={{ backgroundColor: "currentColor" }}
        />
      );
    }

    if (state.shape === "failed") {
      // Dotted ring in the phase hue with a small red center dot. A CSS `dashed`
      // border can't control its dash count — at the 7px DOT_SIZE a browser fits
      // only ~4 dashes, which read as flower petals rather than the intended fine
      // dashed ring. A `dotted` border at a slightly larger 9px footprint with a
      // thin 1.2px stroke renders as a delicate bead ring instead. The failed dot
      // is the ONE shape that breaks the uniform DOT_SIZE — the extra ~2px buys a
      // legible bead count; every other shape stays at 7px. The 3px red center
      // sits inside the 9px ring's ~6.6px hole (vs the old 4px center, which
      // overflowed the 7px ring).
      return (
        <span
          {...common}
          className={`relative inline-flex items-center justify-center w-[9px] h-[9px] rounded-full shrink-0 ${color}${halo}`}
          style={{ border: "1.2px dotted currentColor", backgroundColor: "transparent" }}
        >
          <span aria-hidden="true" className="w-[3px] h-[3px] rounded-full bg-red-400" />
        </span>
      );
    }

    if (state.shape === "solid") {
      return (
        <span
          {...common}
          className={`${DOT_SIZE} rounded-full shrink-0 ${color}${halo}`}
          style={{ border: "none", backgroundColor: "currentColor" }}
        />
      );
    }

    // `ring` (pending) and `skipped` both render as a hollow ring; `skipped`
    // differs only in the forced gray `color` resolved above.
    return (
      <span
        {...common}
        className={`${DOT_SIZE} rounded-full shrink-0 ${color}${halo}`}
        style={{ border: "1.8px solid currentColor", backgroundColor: "transparent" }}
      />
    );
  };

  return <StatusDotTip win={win} state={state} renderDot={renderDot} />;
}

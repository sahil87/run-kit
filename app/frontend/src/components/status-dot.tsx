import { statusDotState, PHASE_HUE } from "@/components/pr-status-model";
import { dotLabel } from "@/components/status-dot-label";
import type { WindowInfo } from "@/types";

// `dotLabel` lives in `status-dot-label.ts` (shared with the sidebar row
// flyout card, `sidebar/row-flyout-card.tsx`); re-export it so this module's
// public surface — and existing `@/components/status-dot` import sites — stay
// unchanged.
export { dotLabel };

/**
 * Unified lifecycle status dot reused on the sidebar window row, the dashboard
 * window cards, and the pane-panel header. It renders a single signal per
 * window via the `statusDotState` two-family ladder (compositional vocabulary
 * — status-pyramid.md), using TWO orthogonal visual channels plus TWO additive
 * overlay flags. THE DOT TELLS THE LOCAL STORY ONLY — what runs in this pane
 * (which journey, is anyone working, did the pipeline fail here, does it need
 * me); the REMOTE story (the branch's PR on GitHub) lives on the row's
 * rest-state PR glyph (`prOwnsGlyph`/`prGlyphColor`), never on the dot.
 *
 *   - CORE HUE = phase (which journey + position in it). Cool = fab pipeline:
 *     blue (building — intake·apply·review) → green (PR-ready — ship·
 *     review-pr·done: local work complete). Warm = ad-hoc agent: yellow.
 *     Gray = floor (no fab change, no fresh agent) — color is reserved for a
 *     journey. Purple/orange are RETIRED from the dot.
 *   - SHAPE = liveness, the SAME meaning in every hue:
 *       solid → work happening NOW (agent mid-turn; floor: output flowing)
 *       ring  → at rest (no live worker · idle agent · waiting agent ·
 *                parked done · quiet shell)
 *   - FAILURE = the additive red-center overlay when `state.failed` (review /
 *     review-pr failed). Over a RING: a small red dot inside the hollow ring.
 *     Over a SOLID: a BULLSEYE — a dark gap ring cut between the fill and the
 *     red center — so failure changes the SILHOUETTE and is never color alone
 *     (colorblind a11y). Flagged dots render at a slightly larger 9px
 *     footprint so the center stays legible; unflagged dots stay at DOT_SIZE.
 *   - ATTENTION = the additive constant-yellow pulsing halo when the agent is
 *     `waiting` (state.waiting). NEVER touches the core hue or shape; it is a
 *     box-shadow ring layered over ANY tier (blue core + yellow halo = "fab
 *     building asking"). Static yellow ring under prefers-reduced-motion
 *     (globals.css). A waiting agent renders the RING base — blocked is at
 *     rest by definition.
 *
 * DOT-red appears in exactly ONE way: the small center dot of a flagged
 * (failed) dot — never as a whole-dot color. (The row GLYPH separately uses
 * red for a failing PR — that is the glyph channel's vocabulary, not the
 * dot's.)
 *
 * The dot always carries `role="img"` + `aria-label` composed from hue word +
 * liveness word + flags (e.g. "building — worker live", "PR-ready — at rest",
 * "building — failed — rework live"), or "active"/"idle" for the tmux
 * fallback — color is never the sole channel (colorblind a11y +
 * keyboard-first constitution). The native `title` tooltip is intentionally
 * NOT set, and the dot is a PURE decoration at both render sites: in the
 * sidebar window rows the hover/focus detail surface is the row's flyout card
 * (`sidebar/row-flyout-card.tsx`), and on coarse pointers the sidebar row
 * wires a dot-tap to open the flyout. In the PANE panel header
 * (`sidebar/status-panel.tsx`) there is no flyout — the panel's own register
 * view alongside the dot is the detail surface.
 */

// Unflagged dots render at one uniform footprint so the solid and hollow
// circles read as the same size in the dense sidebar. Flagged (red-center)
// dots step up to a 9px footprint so the ~3px red center — and, over a solid,
// the bullseye's dark gap ring — stays legible.
const DOT_SIZE = "w-[7px] h-[7px]";
const FLAGGED_SIZE = "w-[9px] h-[9px]";

// The ~3px red center of a flagged dot — the ONLY dot-red.
const RED_CENTER = "w-[3px] h-[3px] rounded-full bg-signal-red";

export function StatusDot({ win }: { win: WindowInfo }) {
  const state = statusDotState(win);
  const label = dotLabel(win, state);
  const color = PHASE_HUE[state.phase];

  // Additive waiting halo (status-pyramid.md § The Channel Model). When the
  // rolled-up agent state is `waiting`, wrap the dot in a constant-yellow
  // pulsing halo (a box-shadow ring, static under reduced-motion). It is
  // ADDITIVE — the core hue (`color`) and shape below are untouched, so a blue
  // building dot keeps its blue core; only the yellow halo is layered on. The
  // class rides the dot element itself (box-shadow renders outside the
  // border-box, so it disturbs neither the dot's size nor its hue).
  const halo = state.waiting ? " rk-waiting-halo" : "";

  // The accessible name lives on `aria-label`; no native `title` (the flyout
  // card is the detail surface) and no tabIndex (the row is the focus target).
  const common = {
    role: "img" as const,
    "aria-label": label,
  };

  if (state.failed) {
    // Additive red-center overlay at the 9px footprint, composed with the base
    // shape: over a RING the red center sits inside the standard hollow ring;
    // over a SOLID the fill → background-colored inner circle → red center
    // stack cuts a dark gap ring (a bullseye), so failure changes the
    // silhouette and is never color alone. The gap circle uses the shell
    // ground token so it re-themes with the mounting surfaces.
    if (state.shape === "solid") {
      return (
        <span
          {...common}
          className={`relative inline-flex items-center justify-center ${FLAGGED_SIZE} rounded-full shrink-0 ${color}${halo}`}
          style={{ border: "none", backgroundColor: "currentColor" }}
        >
          <span
            aria-hidden="true"
            className="inline-flex items-center justify-center w-[6px] h-[6px] rounded-full bg-bg-primary"
          >
            <span aria-hidden="true" className={RED_CENTER} />
          </span>
        </span>
      );
    }
    return (
      <span
        {...common}
        className={`relative inline-flex items-center justify-center ${FLAGGED_SIZE} rounded-full shrink-0 ${color}${halo}`}
        style={{ border: "1.8px solid currentColor", backgroundColor: "transparent" }}
      >
        <span aria-hidden="true" className={RED_CENTER} />
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

  // `ring` — the at-rest shape (no live worker, idle/waiting agent, parked
  // done, quiet shell): a hollow circle in the phase hue.
  return (
    <span
      {...common}
      className={`${DOT_SIZE} rounded-full shrink-0 ${color}${halo}`}
      style={{ border: "1.8px solid currentColor", backgroundColor: "transparent" }}
    />
  );
}

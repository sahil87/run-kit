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
 * — status-pyramid.md), using TWO orthogonal visual channels plus an additive
 * attention overlay. THE DOT TELLS THE LOCAL STORY ONLY — what runs in this
 * pane (which journey, is it healthy, does it need me); the REMOTE story (the
 * branch's PR on GitHub) lives on the row's rest-state PR glyph
 * (`prOwnsGlyph`/`prGlyphColor`), never on the dot.
 *
 *   - CORE HUE = phase (which journey + position in it). Cool = fab pipeline:
 *     blue (building — intake·apply·review) → green (PR-ready — ship·
 *     review-pr·done: local work complete). Warm = ad-hoc agent: yellow.
 *     Gray = floor (no fab change, no fresh agent) — color is reserved for a
 *     journey. Purple/orange are RETIRED from the dot.
 *   - ATTENTION = the additive constant-yellow pulsing halo when the agent is
 *     `waiting` (state.waiting). NEVER touches the core hue or shape; it is a
 *     box-shadow ring layered over ANY tier (blue core + yellow halo = "fab
 *     building asking"; blue failed core + halo = "review failed, agent
 *     asking"). Static yellow ring under prefers-reduced-motion (globals.css).
 *   - SHAPE = status (health), the SAME meaning in every hue:
 *       solid  → running / live (active · ready · mid-turn agent · output)
 *       ring   → at rest (stage pending · parked done · idle agent · quiet
 *                shell)
 *       failed → dotted ring in phase hue + a small RED center dot (review /
 *                review-pr failed)
 *
 * DOT-red appears in exactly ONE way: the small center dot inside a `failed`
 * dotted ring — never as a whole-dot color. (The row GLYPH separately uses red
 * for a failing PR — that is the glyph channel's vocabulary, not the dot's.)
 *
 * Every shape EXCEPT `failed` renders at one uniform 7px footprint
 * (`DOT_SIZE`); the `failed` dot is the lone exception — a slightly larger 9px
 * footprint so its dotted bead-ring stays legible (see the failed branch
 * below).
 *
 * The dot always carries `role="img"` + `aria-label` composed from hue word +
 * status word (e.g. "building — active", "PR-ready — parked",
 * "building — failed"), or "active"/"idle" for the tmux fallback — color is
 * never the sole channel (colorblind a11y + keyboard-first constitution). The
 * native `title` tooltip is intentionally NOT set, and the dot is a PURE
 * decoration at both render sites: in the sidebar window rows the hover/focus
 * detail surface is the row's flyout card (`sidebar/row-flyout-card.tsx`,
 * 93dy), which replaced the per-dot `StatusDotTip` — the dot no longer carries
 * a `tabIndex` tab stop (the accepted second-tab-stop tradeoff from
 * 260616-37ub is retired with it; the flyout opens on ROW focus instead), and
 * on coarse pointers the sidebar row wires a dot-tap to open the flyout. In
 * the PANE panel header (`sidebar/status-panel.tsx`) there is no flyout — the
 * panel's own register view alongside the dot is the detail surface.
 */

// Every shape EXCEPT `failed` renders at one uniform footprint so the solid
// and hollow circles read as the same size in the dense sidebar. The `failed`
// dot is the one exception — it uses a slightly larger 9px footprint so its
// dotted bead-ring has room to read (see the failed branch below).
const DOT_SIZE = "w-[7px] h-[7px]";

export function StatusDot({ win }: { win: WindowInfo }) {
  const state = statusDotState(win);
  const label = dotLabel(win, state);
  const color = PHASE_HUE[state.phase];

  // Additive waiting halo (status-pyramid.md § The Channel Model). When the
  // rolled-up agent state is `waiting`, wrap the dot in a constant-yellow
  // pulsing halo (a box-shadow ring, static under reduced-motion). It is
  // ADDITIVE — the core hue (`color`) and shape below are untouched, so a blue
  // building dot keeps its blue core, a blue failed dot keeps its failed
  // shape; only the yellow halo is layered on. The class rides the dot element
  // itself (box-shadow renders outside the border-box, so it disturbs neither
  // the dot's size nor its hue).
  const halo = state.waiting ? " rk-waiting-halo" : "";

  // The accessible name lives on `aria-label`; no native `title` (the flyout
  // card is the detail surface) and no tabIndex (the row is the focus target).
  const common = {
    role: "img" as const,
    "aria-label": label,
  };

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

  // `ring` — the at-rest shape (stage pending, parked done, idle agent, quiet
  // shell): a hollow circle in the phase hue.
  return (
    <span
      {...common}
      className={`${DOT_SIZE} rounded-full shrink-0 ${color}${halo}`}
      style={{ border: "1.8px solid currentColor", backgroundColor: "transparent" }}
    />
  );
}

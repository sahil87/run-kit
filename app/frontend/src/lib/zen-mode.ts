/**
 * Pure zen-mode toggle decision (260820-o8cr R4/R6). Extracted from app.tsx
 * (the `buildViewActions`/`buildLayoutActions` precedent) so the state machine
 * — enter/exit, arity gating, and the zen-initiated-zoom tracking — is
 * unit-testable without mounting the shell. AppShell's `toggleZen` resolves
 * this and applies the result through ZenContext + the `layoutZoomToggleRef`
 * seam.
 */

export type ZenToggleInput = {
  /** Zen currently active. */
  zenActive: boolean;
  /** Zen initiated the current tile zoom (exit unzooms only then). */
  zenZoomed: boolean;
  /** A tile zoom is currently in effect (any source — zen or the user). */
  layoutZoomed: boolean;
};

export type ZenToggleDecision = {
  zenActive: boolean;
  zenZoomed: boolean;
  /** Fire the `layoutZoomToggleRef` seam — on ENTER to zoom the focused tile,
   *  on EXIT to undo a zen-initiated zoom that is still in effect. */
  fireZoomToggle: boolean;
};

/**
 * Resolve one zen toggle. ENTER: activates zen; at arity > 1 with no zoom in
 * effect, also zooms the focused tile and records the initiation. EXIT:
 * deactivates zen; undoes the zoom ONLY when zen initiated it AND it is still
 * in effect — a pre-existing user zoom survives exit, and a manual unzoom
 * while in zen is not toggled back into a zoom.
 */
export function resolveZenToggle(state: ZenToggleInput, arity: number): ZenToggleDecision {
  if (state.zenActive) {
    return {
      zenActive: false,
      zenZoomed: false,
      fireZoomToggle: state.zenZoomed && state.layoutZoomed,
    };
  }
  const zoom = arity > 1 && !state.layoutZoomed;
  return { zenActive: true, zenZoomed: zoom, fireZoomToggle: zoom };
}

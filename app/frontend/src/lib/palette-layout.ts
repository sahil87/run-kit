/**
 * Pure builder for the command-palette surface-layout actions (`Layout: …` —
 * 260812-ab5v-surface-layout-core R11; spec docs/specs/surface-layout.md
 * § Verbs: "every verb is also a palette entry", Constitution V). Extracted
 * from app.tsx so the per-state gating (which adds/closes/verbs/shapes are
 * offered) is unit-testable without mounting the shell — mirroring
 * `lib/palette-view.ts` (`buildViewActions`). The action bodies are thin
 * wrappers around the caller's `onApply` (app.tsx's `applyLayout` — the single
 * user-mutation path) running the pure `surface-layout.ts` mutations.
 *
 * Entries, per current layout state:
 *  - `Layout: Add <Surface>`    — per AVAILABLE, not-open surface; omitted at
 *                                 3 tiles (max — the rail's disabled buttons
 *                                 are the mouse mirror).
 *  - `Layout: Close <Surface>`  — per open kind; omitted on a `single` layout
 *                                 (closing the last tile is disallowed, R7).
 *  - `Layout: Zoom` / `Layout: Unzoom` — the transient slot-A zoom toggle
 *                                 (desktop multi-tile only; R6 keeps zoom out
 *                                 of URL/localStorage). Exactly one renders,
 *                                 keyed on the caller's `zoomed` state.
 *  - `Layout: Promote <Surface>` / `Layout: Swap <Surface>` — per open kind
 *                                 (promote of slot A is a no-op, so it's
 *                                 omitted; swap-with-next always wraps).
 *  - `Layout: <Shape>`          — per-shape jumps for the CURRENT arity
 *                                 (`shapesForArity`), destination shapes only
 *                                 (never the current — the `buildViewActions`
 *                                 pattern).
 *  - `Layout: Cycle Shape`      — the `layout-cycle` chord's palette body; its
 *                                 id IS the registry actionId, so
 *                                 `withShortcutHints` decorates it with the
 *                                 effective ⌘; combo (the code-review rule
 *                                 that shortcuts are documented in the palette
 *                                 registration). Omitted when the arity ring
 *                                 is degenerate (a `single` layout cycles to
 *                                 itself).
 *
 * The shipped ⇧⌘. `panel-toggle` chord toggles the FIRST non-tty available
 * surface's tile; that surface's Add/Close entry carries its effective combo
 * (`toggleTarget`/`toggleShortcut`) so the chord stays discoverable (the
 * retired `Panel: Code` hint precedent).
 */

import {
  addSurface,
  closeSurface,
  cycleShape,
  promote,
  setShape,
  shapesForArity,
  swapWithNext,
  SHAPE_ARITY,
  SHAPE_LABEL,
  SURFACE_LABEL,
  type Layout,
  type SurfaceKind,
} from "./surface-layout";

export type LayoutPaletteAction = {
  id: string;
  label: string;
  shortcut?: string;
  onSelect: () => void;
};

export type LayoutPaletteOptions = {
  /** Transient zoom state (app.tsx observes SurfaceLayout's zoom flips). */
  zoomed: boolean;
  /** Desktop + arity > 1 — zoom is desktop-only (mobile renders slot A). */
  zoomEnabled: boolean;
  /** The single mutation path (persist + URL mirror, R3). */
  onApply: (next: Layout) => void;
  /** Toggle the transient slot-A zoom (SurfaceLayout's registered seam). */
  onZoomToggle: () => void;
  /** The `panel-toggle` chord's target surface (first non-tty available) and
   *  its effective combo — stamped on that surface's Add/Close entry. */
  toggleTarget?: SurfaceKind | null;
  toggleShortcut?: string;
};

export function buildLayoutActions(
  layout: Layout,
  available: SurfaceKind[],
  opts: LayoutPaletteOptions,
): LayoutPaletteAction[] {
  const actions: LayoutPaletteAction[] = [];
  const { order } = layout;
  const arity = SHAPE_ARITY[layout.shape];
  const openKinds = [...new Set(order)];

  /** The ⇧⌘. hint for the chord-target surface's Add/Close entry. */
  const toggleHint = (kind: SurfaceKind) =>
    opts.toggleTarget === kind && opts.toggleShortcut
      ? { shortcut: opts.toggleShortcut }
      : {};

  // Adds — available AND not open AND room to grow (max 3 tiles).
  if (order.length < 3) {
    for (const kind of available) {
      if (openKinds.includes(kind)) continue;
      actions.push({
        id: `layout-add-${kind}`,
        label: `Layout: Add ${SURFACE_LABEL[kind]}`,
        ...toggleHint(kind),
        onSelect: () => {
          const next = addSurface(layout, kind);
          if (next) opts.onApply(next);
        },
      });
    }
  }

  // Closes — one per open kind; the last tile never closes (R7).
  if (order.length > 1) {
    for (const kind of openKinds) {
      actions.push({
        id: `layout-close-${kind}`,
        label: `Layout: Close ${SURFACE_LABEL[kind]}`,
        ...toggleHint(kind),
        onSelect: () => {
          const next = closeSurface(layout, kind);
          if (next) opts.onApply(next);
        },
      });
    }
  }

  // Zoom / Unzoom — the transient slot-A toggle (R6): no URL/localStorage
  // change. Exactly one form renders, keyed on the live zoom state.
  if (opts.zoomEnabled) {
    actions.push(
      opts.zoomed
        ? { id: "layout-unzoom", label: "Layout: Unzoom", onSelect: opts.onZoomToggle }
        : { id: "layout-zoom", label: "Layout: Zoom", onSelect: opts.onZoomToggle },
    );
  }

  // Promote / Swap — per open kind on multi-tile layouts (promote of slot A
  // is a no-op, so it's omitted; swap-with-next wraps, so every kind swaps).
  if (order.length > 1) {
    for (const kind of openKinds) {
      if (kind === order[0]) continue;
      actions.push({
        id: `layout-promote-${kind}`,
        label: `Layout: Promote ${SURFACE_LABEL[kind]}`,
        onSelect: () => opts.onApply(promote(layout, kind)),
      });
    }
    for (const kind of openKinds) {
      actions.push({
        id: `layout-swap-${kind}`,
        label: `Layout: Swap ${SURFACE_LABEL[kind]}`,
        onSelect: () => opts.onApply(swapWithNext(layout, kind)),
      });
    }
  }

  // Per-shape jumps for the current arity — destinations only, never the
  // current shape (the `buildViewActions` "show the destination" pattern).
  for (const shape of shapesForArity(arity)) {
    if (shape === layout.shape) continue;
    actions.push({
      id: `layout-shape-${shape}`,
      label: `Layout: ${SHAPE_LABEL[shape]}`,
      onSelect: () => {
        const next = setShape(layout, shape);
        if (next) opts.onApply(next);
      },
    });
  }

  // The cycle chord's palette parity entry — id `layout-cycle` IS the registry
  // actionId, so `withShortcutHints` decorates it with the effective combo.
  // Omitted on the degenerate arity-1 ring (single cycles to itself).
  if (shapesForArity(arity).length > 1) {
    actions.push({
      id: "layout-cycle",
      label: "Layout: Cycle Shape",
      onSelect: () => opts.onApply(cycleShape(layout)),
    });
  }

  return actions;
}

/**
 * Pure builder for the command-palette surface-layout actions (spec
 * docs/specs/surface-layout.md § Verbs: "every verb is also a palette
 * entry", Constitution V). Extracted from app.tsx so the per-state gating
 * (which adds/closes/verbs/templates are offered) is unit-testable without
 * mounting the shell — mirroring `lib/palette/view.ts` (`buildViewActions`).
 *
 * Entries, per current layout state:
 *  - `Tile: Show <Surface>`     — per AVAILABLE, not-open surface; omitted at
 *                                 MAX_TILES tiles (the rail's disabled buttons
 *                                 are the mouse mirror). "Show" is the honest
 *                                 verb: the entry reveals a renderer, it does
 *                                 not rearrange the layout.
 *  - `Tile: Hide <Surface>`     — per open kind; omitted on a single-tile
 *                                 layout (the last tile never hides).
 *  - `Layout: Expand` / `Layout: Restore` — the transient focused-tile zoom
 *                                 toggle (desktop multi-tile only). Exactly one
 *                                 renders, keyed on the caller's `zoomed` state.
 *                                 "Zoom" is the CONTENT-magnification verb —
 *                                 tile-maximize's labels say Expand/Restore;
 *                                 the ids stay layout-zoom / layout-unzoom
 *                                 (they persist in user macros/overrides).
 *  - `Tile: Focus <Surface>`    — per open, not-currently-focused kind;
 *                                 keyboard parity for the pointer's
 *                                 click-to-focus. Desktop multi-tile only (the
 *                                 caller passes `onFocus` only then). Duplicate
 *                                 kinds (two tty tiles) yield one entry — the
 *                                 seam focuses the first leaf of the kind.
 *  - `Layout: Promote <Surface>` — per open kind except slot A (promoting
 *                                 the template's main tile is a no-op, so its
 *                                 entry is omitted).
 *  - `Tile: Swap Left|Right|Up|Down` — for the FOCUSED tile, one row per
 *                                 direction in which a geometric neighbour
 *                                 exists. Desktop multi-tile only: the caller
 *                                 passes `leafRects` and `focusedLeafId` only
 *                                 then.
 *  - `Layout: <Template>`       — one per `templatesFor(n)` at the current
 *                                 tile count (the ▦ chip rows' palette form).
 *  - `Layout: Cycle Template`   — the ⌘; chord's palette body; its id
 *                                 `layout-cycle` IS the registry actionId, so
 *                                 `withShortcutHints` decorates it with the
 *                                 effective combo (shortcuts are documented in
 *                                 the palette registration). Omitted at one
 *                                 tile (the template ring is empty).
 *
 * The `code-toggle` chord (⌘2/⇧Ctrl+2) toggles the code surface's tile; that
 * surface's Show/Hide entry carries its effective combo
 * (`toggleTarget`/`toggleShortcut`, generalised to `toggleHints`) so the
 * chord stays discoverable.
 */

import {
  addSurface,
  closeSurface,
  swapDirectional,
  leaves,
  slotOrder,
  templatesFor,
  MAX_TILES,
  SURFACE_LABEL,
  TEMPLATE_LABEL,
  type Layout,
  type Rect,
  type SurfaceKind,
  type SwapDirection,
  type TemplateName,
} from "../surface-layout";

export type LayoutPaletteAction = {
  id: string;
  label: string;
  shortcut?: string;
  /** Renders the row disabled (no-op on select) — the switch group's
   *  full-layout affordance (`addSurface` → null). */
  disabled?: boolean;
  onSelect: () => void;
};

const SWAP_DIRECTIONS: SwapDirection[] = ["left", "right", "up", "down"];

const SWAP_DIRECTION_LABEL: Record<SwapDirection, string> = {
  left: "Left",
  right: "Right",
  up: "Up",
  down: "Down",
};

export type LayoutPaletteOptions = {
  /** Transient zoom state (app.tsx observes SurfaceLayout's zoom flips). */
  zoomed: boolean;
  /** Desktop + multi-tile — zoom is desktop-only (mobile renders slot A). */
  zoomEnabled: boolean;
  /** The single mutation path (persist + URL mirror) — Show/Hide run their
   *  pure mutation through it. */
  onApply: (next: Layout) => void;
  /** Toggle the transient slot-A zoom (SurfaceLayout's registered seam). */
  onZoomToggle: () => void;
  /** The `code-toggle` chord's target surface and its effective combo —
   *  stamped on that surface's Show/Hide entry. */
  toggleTarget?: SurfaceKind | null;
  toggleShortcut?: string;
  /** Effective toggle-chord combos by surface kind — the multi-chord form of
   *  the toggleTarget/toggleShortcut pair (the gui-toggle ⌘4 hint on the
   *  `Tile: Show/Hide GUI` rows). */
  toggleHints?: Partial<Record<SurfaceKind, string>>;
  /** Focused-tile palette parity: the currently focused kind (omitted from
   *  the Focus entries) and the focus-by-kind callback (app.tsx routes it
   *  through SurfaceLayout's `focusTileRef` seam). `onFocus` absent ⇒ no
   *  Focus entries (mobile; the top-bar switch group is the switcher
   *  there). */
  focusedKind?: SurfaceKind | null;
  onFocus?: (kind: SurfaceKind) => void;
  /** Template jump — rebuilds the tree as the named template from the
   *  current slot order. */
  onApplyTemplate: (name: TemplateName) => void;
  /** The ⌘; chord's body — the next template in the ring. */
  onCycleTemplate: () => void;
  /** Promote a leaf to slot A (swaps it with the template's main tile). */
  onPromoteLeaf: (leafId: string) => void;
  /** Directional swap of the focused leaf with its geometric neighbour. */
  onSwapDirection: (direction: SwapDirection) => void;
  /** The focused tile's leaf id — the directional swaps' origin. Absent ⇒
   *  no directional rows. */
  focusedLeafId: string | undefined;
  /** Live leaf rects from the desktop render seam. Absent ⇒ mobile ⇒ no
   *  directional rows. */
  leafRects: (() => Map<string, Rect>) | undefined;
};

export function buildLayoutActions(
  layout: Layout,
  available: SurfaceKind[],
  opts: LayoutPaletteOptions,
): LayoutPaletteAction[] {
  const actions: LayoutPaletteAction[] = [];
  const kinds = leaves(layout);
  const tileCount = kinds.length;
  const openKinds = [...new Set(kinds)];

  /** The toggle chord's hint for a chord-target surface's Show/Hide entry. */
  const toggleHint = (kind: SurfaceKind) => {
    if (opts.toggleTarget === kind && opts.toggleShortcut) {
      return { shortcut: opts.toggleShortcut };
    }
    const hint = opts.toggleHints?.[kind];
    return hint ? { shortcut: hint } : {};
  };

  // Shows — available AND not open AND room to grow (MAX_TILES cap).
  if (tileCount < MAX_TILES) {
    for (const kind of available) {
      if (openKinds.includes(kind)) continue;
      actions.push({
        id: `tile-show-${kind}`,
        label: `Tile: Show ${SURFACE_LABEL[kind]}`,
        ...toggleHint(kind),
        onSelect: () => {
          const next = addSurface(layout, kind);
          if (next) opts.onApply(next);
        },
      });
    }
  }

  // Hides — one per open kind; the last tile never hides.
  if (tileCount > 1) {
    for (const kind of openKinds) {
      actions.push({
        id: `tile-hide-${kind}`,
        label: `Tile: Hide ${SURFACE_LABEL[kind]}`,
        ...toggleHint(kind),
        onSelect: () => {
          const next = closeSurface(layout, kind);
          if (next) opts.onApply(next);
        },
      });
    }
  }

  // Expand / Restore — the transient focused-tile toggle. Exactly one form
  // renders, keyed on the live zoom state.
  if (opts.zoomEnabled) {
    actions.push(
      opts.zoomed
        ? { id: "layout-unzoom", label: "Layout: Restore", onSelect: opts.onZoomToggle }
        : { id: "layout-zoom", label: "Layout: Expand", onSelect: opts.onZoomToggle },
    );
  }

  // Focus — keyboard parity for click-to-focus: one entry per OPEN,
  // not-currently-focused kind. Desktop multi-tile only: at one tile there is
  // nothing to move focus to, and the caller passes no `onFocus` on mobile.
  if (tileCount > 1 && opts.onFocus && opts.focusedKind) {
    for (const kind of openKinds) {
      if (kind === opts.focusedKind) continue;
      actions.push({
        id: `tile-focus-${kind}`,
        label: `Tile: Focus ${SURFACE_LABEL[kind]}`,
        onSelect: () => opts.onFocus?.(kind),
      });
    }
  }

  // Promote — per open kind except slot A (promoting the main tile is a
  // no-op, so its entry is omitted). The kind IS its first leaf's id.
  if (tileCount > 1) {
    const slotA = slotOrder(layout)[0];
    for (const kind of openKinds) {
      if (kind === slotA) continue;
      actions.push({
        id: `layout-promote-${kind}`,
        label: `Layout: Promote ${SURFACE_LABEL[kind]}`,
        onSelect: () => opts.onPromoteLeaf(kind),
      });
    }
  }

  // Directional swaps — one row per direction in which the FOCUSED tile has
  // a geometric neighbour. Desktop multi-tile only: the caller passes the
  // live rects and the focused leaf id only then. A no-op result (the SAME
  // tree object back) means no neighbour in that direction.
  const focusedLeafId = opts.focusedLeafId;
  if (tileCount > 1 && opts.leafRects && focusedLeafId !== undefined) {
    const rects = opts.leafRects();
    for (const direction of SWAP_DIRECTIONS) {
      if (swapDirectional(layout, focusedLeafId, direction, rects) === layout) continue;
      actions.push({
        id: `tile-swap-${direction}`,
        label: `Tile: Swap ${SWAP_DIRECTION_LABEL[direction]}`,
        onSelect: () => opts.onSwapDirection(direction),
      });
    }
  }

  // Template jumps — one per structurally distinct template at the current
  // tile count.
  const templates = templatesFor(tileCount);
  for (const name of templates) {
    actions.push({
      id: `layout-template-${name}`,
      label: `Layout: ${TEMPLATE_LABEL[name]}`,
      onSelect: () => opts.onApplyTemplate(name),
    });
  }

  // The cycle chord's palette parity entry — id `layout-cycle` IS the
  // registry actionId, so `withShortcutHints` decorates it with the
  // effective combo. Omitted at one tile (the ring is empty).
  if (templates.length > 1) {
    actions.push({
      id: "layout-cycle",
      label: "Layout: Cycle Template",
      onSelect: opts.onCycleTemplate,
    });
  }

  return actions;
}

/**
 * Build the mobile switch-to-tile palette actions (`Tile: Switch to
 * <Surface>`) — the keyboard twin of the top-bar switch group (Constitution
 * V). One entry per AVAILABLE surface that is not the currently visible one —
 * the palette shows the destination, never the current tile (the
 * `buildViewActions` pattern). A single-surface window yields an empty array —
 * there is nothing to switch to. On mobile these supersede the `View:`
 * entries; the bodies invoke the caller's switch-to-tile verb. A destination
 * whose growth the layout cannot host (`addSurface` → null, reported via
 * `isDisabled`) renders DISABLED — the switch group's full-layout affordance.
 */
export function buildTileSwitchActions(
  available: SurfaceKind[],
  visible: SurfaceKind,
  onSwitch: (surface: SurfaceKind) => void,
  isDisabled?: (surface: SurfaceKind) => boolean,
): LayoutPaletteAction[] {
  return available
    .filter((kind) => kind !== visible)
    .map((kind) => ({
      id: `tile-switch-${kind}`,
      label: `Tile: Switch to ${SURFACE_LABEL[kind]}`,
      disabled: isDisabled?.(kind) ?? false,
      onSelect: () => onSwitch(kind),
    }));
}

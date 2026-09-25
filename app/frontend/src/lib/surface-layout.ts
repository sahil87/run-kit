/**
 * Pure helpers for the surface-layout model (spec docs/specs/surface-layout.md).
 *
 * The terminal route's center is a LAYOUT MANAGER: one to three tiles, each
 * rendering a surface (a (substrate, lens) pair), arranged as a canonical
 * split TREE (`lib/layout-tree.ts`) with per-viewer divider SIZES. The tree
 * is shared tab state: it rides the `@rk_win_layout` window option in the
 * window payload (tree form; the legacy preset strings parse permanently),
 * and `effectiveLayout` is its only read (parse + degrade, never a rewrite).
 * Sizes and the zoomed surface are per-viewer localStorage state, never in
 * the URL. This module owns availability degradation, the tree verbs behind
 * the tile verbs, the sizes/zoom storage wrappers, and the one-release
 * inbound-only translation input for the retired `?view=` / `?panel=`
 * params (and their localStorage predecessors).
 *
 * Everything here mirrors the shipped `window-view.ts` / `right-panel.ts`
 * pattern: pure and DOM-free except thin try/catch-noop localStorage
 * wrappers, so the render branch in `app.tsx` AND the unit tests share one
 * drift-free source. Availability reuses `window-view.ts`'s capability
 * helpers (`hasCode`) as the single source — `tty` and `web` are
 * the always-available surfaces (the muxed relay supports N clients per pane,
 * so duplicate tty tiles of one window are legal; web's empty-URL content is
 * the onboarding state, so the lens always exists).
 */

import {
  insertBeside,
  isLeaf,
  leafIds,
  leaves,
  layoutRects,
  normalise,
  parseLayoutTree,
  pathOf,
  removeLeaf,
  serializeLayoutTree,
  slotOrder,
  structureSig,
  swapLeaves,
  templateOf,
  templatesFor,
  MAX_TILES,
  NOMINAL_BOX,
  TEMPLATES,
  type DropSide,
  type LayoutNode,
  type LayoutSizes,
  type Rect,
  type SurfaceKind,
  type TemplateName,
} from "./layout-tree";
import { hasCode, hasGui, type GuiHost, type ViewWindow } from "./window-view";

export type { LayoutNode, LayoutSizes, Rect, SurfaceKind, TemplateName };
export {
  isLeaf,
  leafIds,
  leaves,
  layoutRects,
  parseLayoutTree,
  pathOf,
  serializeLayoutTree,
  slotOrder,
  structureSig,
  templateOf,
  templatesFor,
  TEMPLATE_LABEL,
  TEMPLATES,
  MAX_TILES,
  NOMINAL_BOX,
  SPLIT_GAP_PX,
} from "./layout-tree";

/** A layout IS the canonical split tree (was `{shape, order}` under the
 *  preset model). */
export type Layout = LayoutNode;

/**
 * Human labels for the surface kinds (shared copy for tile headers, the
 * surface toggles' tooltips/aria, palette `Tile:`/`Layout:` entries, and the
 * mobile switch group so none drift).
 */
export const SURFACE_LABEL: Record<SurfaceKind, string> = {
  tty: "Terminal",
  web: "Web",
  code: "Code",
  gui: "GUI",
};

/**
 * Surface icon glyphs: `>_` tty, `://` web, `{}` code, `[]` gui (the 2-char
 * ASCII window frame). Pure data shared by the surface toggles and the
 * mobile switch group.
 */
export const SURFACE_GLYPH: Record<SurfaceKind, string> = {
  tty: ">_",
  web: "://",
  code: "{}",
  gui: "[]",
};

const SURFACE_KINDS: SurfaceKind[] = ["tty", "web", "code", "gui"];

function isSurfaceKind(value: string): value is SurfaceKind {
  return (SURFACE_KINDS as string[]).includes(value);
}

/**
 * The surfaces a window can tile (the shared registry the rail, layout, and
 * switcher all key off). The order is the positional surface digits' order —
 * ⌘1 tty, ⌘2 code, ⌘3 web, ⌘4 gui (`lib/keybindings.ts`) — so the toggle
 * group, switch group, and palette lists always render in shortcut order.
 * Availability reuses the window-view helpers as the single source of truth;
 * reachability is NOT part of availability (it governs a surface's content,
 * not its presence). `web` is unconditional — the lens always exists;
 * `hasWebUrl` selects its content (onboarding vs live iframe), so the
 * degradation ladder never drops a web tile. `gui` is a per-HOST capability:
 * it lands last, iff the threaded host signal's `enabled` is true.
 */
export function availableTiles(
  win: ViewWindow | null | undefined,
  host?: GuiHost,
): SurfaceKind[] {
  const tiles: SurfaceKind[] = ["tty"];
  if (hasCode(win)) tiles.push("code");
  tiles.push("web");
  if (hasGui(host)) tiles.push("gui");
  return tiles;
}

/**
 * Degrade a parsed layout against the window's current capabilities: drop
 * each unavailable leaf via removeLeaf + normalise, keeping the remaining
 * structure. Returns `null` when NOTHING is left (a fully-invalid value — the
 * caller falls through to the ladder's next rung). `tty` and `web` never
 * degrade; `gui` degrades with the threaded host signal's `enabled` — off ⇒
 * the gui tile drops out of the rendered layout while `@rk_win_layout` keeps
 * its value, with no write on either transition.
 */
export function degradeLayout(
  tree: Layout,
  win: ViewWindow | null | undefined,
  host?: GuiHost,
): Layout | null {
  const available = availableTiles(win, host);
  let out: LayoutNode | null = tree;
  for (;;) {
    const kinds = leaves(out);
    const idx = kinds.findIndex((k) => !available.includes(k));
    if (idx < 0) return out;
    out = removeLeaf(out, leafIds(out)[idx]);
    if (out === null) return null;
  }
}

/**
 * The layout a window renders: the shared `@rk_win_layout` value from the
 * payload, parsed and degraded against the window's available tiles. An
 * unset, malformed, or fully-unavailable value falls back to the bare `tty`
 * leaf (`tty` is in every `availableTiles` result). Purely a READ — the
 * option value is never rewritten here.
 */
export function effectiveLayout(
  win: ViewWindow | null | undefined,
  host?: GuiHost,
): Layout {
  const parsed = parseLayoutTree(win?.layout);
  if (parsed) {
    const degraded = degradeLayout(parsed, win, host);
    if (degraded) return degraded;
  }
  return { leaf: "tty" };
}

/**
 * One-release inbound-only translation input for the retired params:
 * `?view=X` → `single:X`; `?view=X&panel=Y` → `split-h:X,Y` (X in slot A —
 * the visual continuation of the legacy main+panel split); a bare `?panel=Y`
 * translates against the tty default main slot. Returns `undefined` when
 * neither legacy param is present. The result is an UNVALIDATED layout
 * string — the caller parses + degrades it. Its only consumer is the
 * route-entry translation effect; nothing resolves a live layout from it.
 */
export function translateLegacyParams(
  view: string | null | undefined,
  panel: string | null | undefined,
): string | undefined {
  if (view && panel) return `split-h:${view},${panel}`;
  if (view) return `single:${view}`;
  if (panel) return `split-h:tty,${panel}`;
  return undefined;
}

/**
 * The one-shot route-entry translation decision. `carried` is the URL's
 * layout (`?layout=` ?? the legacy-param translation), `storedLayout` /
 * `storedLegacy` the localStorage predecessors, `winLayout` the window's
 * current `@rk_win_layout` value. Precedence: carried > storedLayout >
 * storedLegacy. `write` holds the layout to POST exactly once — always in
 * the TREE form, whatever grammar the candidate arrived in — and is present
 * ONLY when the option is empty and the winning candidate parses; a set
 * option always wins and writes nothing. `dropParams` is true when the URL
 * carried a layout-bearing param, telling the caller to navigate to the bare
 * route.
 */
export function legacyTranslationDecision(input: {
  carried?: string;
  storedLayout?: string;
  storedLegacy?: string;
  winLayout?: string;
}): { write?: string; dropParams: boolean } {
  const { carried, storedLayout, storedLegacy, winLayout } = input;
  const dropParams = carried !== undefined;
  if (winLayout) return { dropParams };
  const parsed = parseLayoutTree(carried ?? storedLayout ?? storedLegacy);
  if (!parsed) return { dropParams };
  return { write: serializeLayoutTree(parsed), dropParams };
}

// ── per-viewer zoom (one surface fills the layout area; the shared layout is
//    untouched) ─────────────────────────────────────────────────────────────

/**
 * Value-bearing per-window zoom localStorage key. Stores a surface KIND, not
 * a leaf id: desktop zoom resolves it to the kind's first leaf in the layout,
 * and the mobile switch group addresses surfaces by kind. Absence means
 * "no zoom".
 */
export function zoomStorageKey(server: string, windowId: string): string {
  return `rk-layout-zoom:${server}:${windowId}`;
}

/**
 * Read the persisted zoomed surface kind for a window. Returns `undefined`
 * when absent, when the stored value is not a surface kind (untrusted-
 * localStorage discipline: validate on read), or when localStorage is
 * unavailable (SSR/jsdom/quota) — the try/catch-noop pattern.
 */
export function readStoredZoom(
  server: string,
  windowId: string,
): SurfaceKind | undefined {
  try {
    const raw = localStorage.getItem(zoomStorageKey(server, windowId));
    return raw !== null && isSurfaceKind(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Persist the zoomed surface kind; `null` clears the key (unzoom). Best-effort
 * (try/catch-noop); callers invoke on user-initiated zoom flips only.
 */
export function writeStoredZoom(
  server: string,
  windowId: string,
  kind: SurfaceKind | null,
): void {
  try {
    if (kind === null) {
      localStorage.removeItem(zoomStorageKey(server, windowId));
    } else {
      localStorage.setItem(zoomStorageKey(server, windowId), kind);
    }
  } catch {
    /* noop — best-effort persistence */
  }
}

// ── per-viewer sizes (divider positions, keyed by structure signature) ──────

/** Per-(window, structure) sizes key — a fraction set is meaningless across
 *  structures, so the structure signature is part of the key. */
export function sizesStorageKey(server: string, windowId: string, sig: string): string {
  return `rk-layout-sizes:${server}:${windowId}:${sig}`;
}

/** The split child counts in pre-order — the shape a stored sizes value must
 *  match. */
function splitChildCounts(node: LayoutNode): number[] {
  const out: number[] = [];
  const walk = (n: LayoutNode): void => {
    if (isLeaf(n)) return;
    out.push(n.children.length);
    n.children.forEach(walk);
  };
  walk(node);
  return out;
}

/**
 * Read the persisted divider sizes for a (window, tree). Returns `undefined`
 * unless the value is one fraction array per split (pre-order), each matching
 * that split's child count, all finite positive numbers summing to 1
 * (tolerance 1e-6) — garbage never reaches the layout; the caller falls back
 * to the template's own sizes, then equal splits. try/catch-noop on storage
 * failures.
 */
export function readStoredSizes(
  server: string,
  windowId: string,
  tree: Layout,
): LayoutSizes | undefined {
  try {
    const raw = localStorage.getItem(sizesStorageKey(server, windowId, structureSig(tree)));
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const counts = splitChildCounts(tree);
    if (parsed.length !== counts.length) return undefined;
    const out: number[][] = [];
    for (let i = 0; i < counts.length; i++) {
      const entry: unknown = parsed[i];
      if (!Array.isArray(entry) || entry.length !== counts[i]) return undefined;
      const fractions: number[] = [];
      for (const v of entry) {
        if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return undefined;
        fractions.push(v);
      }
      const sum = fractions.reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 1) > 1e-6) return undefined;
      out.push(fractions);
    }
    return out;
  } catch {
    return undefined;
  }
}

/** Persist the divider sizes for a (window, structure signature). Best-effort
 *  (try/catch-noop); callers invoke on drag RELEASE only (a user mutation). */
export function writeStoredSizes(
  server: string,
  windowId: string,
  sig: string,
  sizes: LayoutSizes,
): void {
  try {
    localStorage.setItem(sizesStorageKey(server, windowId, sig), JSON.stringify(sizes));
  } catch {
    /* noop — best-effort persistence */
  }
}

// ── mutations (verbs) ───────────────────────────────────────────────────────

/**
 * Rail toggle open: split the LAST leaf in reading order along its longer
 * axis (ties → horizontal), the new leaf landing after it (right or bottom).
 * Uses the leaf's real rect when the caller passes rects (desktop) and the
 * nominal box otherwise (mobile, the CLI). Returns `null` when the add is
 * disallowed: the layout is already at MAX_TILES, or a non-tty kind would
 * repeat.
 */
export function addSurface(
  tree: Layout,
  kind: SurfaceKind,
  rects?: Map<string, Rect>,
): Layout | null {
  const kinds = leaves(tree);
  if (kinds.length >= MAX_TILES) return null;
  if (kind !== "tty" && kinds.includes(kind)) return null;
  const ids = leafIds(tree);
  const lastId = ids[ids.length - 1];
  const path = pathOf(tree, lastId);
  if (path === null) return null;
  const rect = rects?.get(lastId) ?? layoutRects(tree, NOMINAL_BOX).get(lastId) ?? NOMINAL_BOX;
  const side: DropSide = rect.w >= rect.h ? "right" : "bottom";
  return insertBeside(tree, path, side, { leaf: kind });
}

/**
 * ✕ Close: the leaf drops out via removeLeaf + normalise; its neighbours
 * absorb its share and the remaining STRUCTURE is kept (closing one tile of a
 * column leaves a column). Returns `null` when the close is disallowed — the
 * last tile never closes (✕ hidden there) — or the leaf is absent.
 */
export function closeSurface(tree: Layout, leafId: string): Layout | null {
  return removeLeaf(tree, leafId);
}

/**
 * ◧ Promote: swap the leaf with slot A — the template's main tile
 * (`slotOrder(tree)[0]`), or the first leaf in reading order for a custom
 * tree. A no-op when the leaf is absent or already slot A.
 */
export function promote(tree: Layout, leafId: string): Layout {
  const ids = leafIds(tree);
  if (!ids.includes(leafId)) return tree;
  const main = slotOrder(tree)[0];
  const mainId = ids[leaves(tree).indexOf(main)];
  if (mainId === leafId) return tree;
  return swapLeaves(tree, leafId, mainId);
}

/**
 * ⇄ Swap: exchange the leaf with the NEXT leaf in reading order (wrapping at
 * the end back to the first — every tile can always swap). A no-op on
 * single-leaf layouts or an absent leaf.
 */
export function swapWithNext(tree: Layout, leafId: string): Layout {
  const ids = leafIds(tree);
  const idx = ids.indexOf(leafId);
  if (idx < 0 || ids.length < 2) return tree;
  return swapLeaves(tree, leafId, ids[(idx + 1) % ids.length]);
}

/** Directional-swap axis. */
export type SwapDirection = "left" | "right" | "up" | "down";

function overlapLen(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/**
 * Directional swap: exchange the leaf with its geometric NEIGHBOUR in the
 * given direction — the nearest leaf across that edge whose rect overlaps on
 * the perpendicular axis (ties: larger overlap, then reading order). Uses the
 * caller's rects (desktop) or the nominal box. A no-op when there is no
 * neighbour.
 */
export function swapDirectional(
  tree: Layout,
  leafId: string,
  direction: SwapDirection,
  rects?: Map<string, Rect>,
): Layout {
  const ids = leafIds(tree);
  if (!ids.includes(leafId)) return tree;
  const resolved = rects ?? layoutRects(tree, NOMINAL_BOX);
  const src = resolved.get(leafId);
  if (!src) return tree;
  const EPS = 0.5;
  let best: { id: string; dist: number; overlap: number } | null = null;
  for (const id of ids) {
    if (id === leafId) continue;
    const c = resolved.get(id);
    if (!c) continue;
    let dist: number;
    let overlap: number;
    if (direction === "left") {
      dist = src.x - (c.x + c.w);
      overlap = overlapLen(src.y, src.y + src.h, c.y, c.y + c.h);
    } else if (direction === "right") {
      dist = c.x - (src.x + src.w);
      overlap = overlapLen(src.y, src.y + src.h, c.y, c.y + c.h);
    } else if (direction === "up") {
      dist = src.y - (c.y + c.h);
      overlap = overlapLen(src.x, src.x + src.w, c.x, c.x + c.w);
    } else {
      dist = c.y - (src.y + src.h);
      overlap = overlapLen(src.x, src.x + src.w, c.x, c.x + c.w);
    }
    if (dist < -EPS || overlap <= 0) continue;
    if (best === null) {
      best = { id, dist, overlap };
      continue;
    }
    const better =
      dist < best.dist - EPS ||
      (Math.abs(dist - best.dist) <= EPS &&
        (overlap > best.overlap + EPS ||
          (Math.abs(overlap - best.overlap) <= EPS &&
            ids.indexOf(id) < ids.indexOf(best.id))));
    if (better) best = { id, dist, overlap };
  }
  return best ? swapLeaves(tree, leafId, best.id) : tree;
}

/**
 * Template jump (the ▦ chip's popover): rebuild `TEMPLATES[name](n)` from the
 * current slot order — lossy for a custom tree. Returns `null` when the name
 * is not a template for the current tile count.
 */
export function applyTemplate(tree: Layout, name: TemplateName): Layout | null {
  const n = leaves(tree).length;
  if (!templatesFor(n).includes(name)) return null;
  return TEMPLATES[name](slotOrder(tree));
}

/**
 * ▦ Cycle template: the next entry of `templatesFor(n)` after the current
 * template (wrapping). A custom tree cycles to the first template; one tile
 * is a no-op.
 */
export function cycleTemplate(tree: Layout): Layout {
  const n = leaves(tree).length;
  const ring = templatesFor(n);
  if (ring.length === 0) return tree;
  const slots = slotOrder(tree);
  const current = templateOf(tree).name;
  const idx = ring.findIndex((t) => t === current);
  const next = ring[(idx + 1) % ring.length];
  return TEMPLATES[next](slots);
}

/**
 * Pure helpers for the surface-layout model (change
 * 260812-ab5v-surface-layout-core; spec docs/specs/surface-layout.md).
 *
 * The terminal route's center is a LAYOUT MANAGER: one to three tiles, each
 * rendering a surface (a (substrate, lens) pair), arranged by a preset SHAPE
 * with a surface ORDER and per-viewer RATIOS. The (shape, order) half is
 * shared tab state: it rides the `@rk_win_layout` window option in the window
 * payload, and `effectiveLayout` is its only read (parse + degrade, never a
 * rewrite). Ratios and the zoomed surface are per-viewer localStorage state,
 * never in the URL. This module owns the shape/parse/serialize rules,
 * availability degradation, the (shape, order) mutations behind the tile
 * verbs, and the one-release inbound-only translation input for the retired
 * `?view=` / `?panel=` params (and their localStorage predecessors).
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

import { hasCode, type ViewName, type ViewWindow } from "./window-view";

/**
 * A tileable surface kind. Identical to the window-view lens registry
 * (`ViewName`) — the layout manager tiles the same surfaces the switcher
 * lists, so the two registries cannot drift. `tty` is a surface like any
 * other: `(current window, tty)`, always available.
 */
export type SurfaceKind = ViewName;

/** The preset layout shapes (exact URL strings, spec § Shape presets). */
export type LayoutShape =
  | "single"
  | "split-h"
  | "split-v"
  | "row"
  | "col"
  | "main-left"
  | "main-right"
  | "main-top";

/**
 * A layout: which preset arrangement + which surfaces occupy its slots.
 * `order[0]` is slot A (the main slot in `main-*` shapes). A layout carries
 * exactly its shape's arity of surfaces; kinds MUST NOT repeat within one
 * layout EXCEPT `tty` (duplicate tty tiles of the same window are allowed).
 * Ratios are deliberately NOT part of this type — they are per-viewer
 * localStorage state keyed per (window, shape), never URL-encoded.
 */
export interface Layout {
  shape: LayoutShape;
  order: SurfaceKind[];
}

/** Fixed slot count per shape (spec: shape arity is fixed). */
export const SHAPE_ARITY: Record<LayoutShape, 1 | 2 | 3> = {
  single: 1,
  "split-h": 2,
  "split-v": 2,
  row: 3,
  col: 3,
  "main-left": 3,
  "main-right": 3,
  "main-top": 3,
};

/** Every shape, in a stable registry order (drives the ▦ chip popover). */
export const ALL_SHAPES: LayoutShape[] = [
  "single",
  "split-h",
  "split-v",
  "row",
  "col",
  "main-left",
  "main-right",
  "main-top",
];

/**
 * The same-arity cycle rings for the ▦ cycle chord (spec § Verbs — "next
 * preset, same order"). Arity 1 is a degenerate ring (`single` cycles to
 * itself); arity 2 alternates the two splits; arity 3 walks the five
 * 3-tile presets.
 */
const SHAPE_RING: Record<1 | 2 | 3, LayoutShape[]> = {
  1: ["single"],
  2: ["split-h", "split-v"],
  3: ["row", "col", "main-left", "main-right", "main-top"],
};

/** The shapes valid for a tile count (the ▦ chip's popover filter, R9). */
export function shapesForArity(arity: 1 | 2 | 3): LayoutShape[] {
  return SHAPE_RING[arity];
}

/**
 * Human labels for the surface kinds (T010–T014 shared copy: tile headers,
 * rail tooltips/aria, palette `Tile:`/`Layout:` entries, the mobile switch
 * group — one source so none drift).
 */
export const SURFACE_LABEL: Record<SurfaceKind, string> = {
  tty: "Terminal",
  web: "Web",
  code: "Code",
};

/** Human labels for the preset shapes — the ▦ chip popover rows, the overflow
 *  menu's `Layout: …` rows, and the palette's per-shape jumps. */
export const SHAPE_LABEL: Record<LayoutShape, string> = {
  single: "Single",
  "split-h": "Split Horizontal",
  "split-v": "Split Vertical",
  row: "Row",
  col: "Column",
  "main-left": "Main Left",
  "main-right": "Main Right",
  "main-top": "Main Top",
};

/**
 * Surface icon glyphs (R10 — icons replace the rail's text labels; the
 * intake's approved set): `>_` tty, `://` web, `{}` code. Pure data
 * shared by the surface toggles and the mobile switch group.
 */
export const SURFACE_GLYPH: Record<SurfaceKind, string> = {
  tty: ">_",
  web: "://",
  code: "{}",
};

/** The shape a layout collapses to when a tile leaves (3→2→1, R4/R7):
 *  order is preserved with slot A kept; 2-tile collapse is `split-h` (the
 *  visual continuation of the legacy main+panel split, plan decision). */
const COLLAPSE_SHAPE: Record<1 | 2, LayoutShape> = { 1: "single", 2: "split-h" };

/** The shape a layout grows to when a tile is appended (R10): 1→2 is
 *  `split-h`, 2→3 is `main-left` (the incumbent slot-A tile stays dominant). */
const GROWTH_SHAPE: Record<2 | 3, LayoutShape> = { 2: "split-h", 3: "main-left" };

const SURFACE_KINDS: SurfaceKind[] = ["tty", "web", "code"];

function isSurfaceKind(value: string): value is SurfaceKind {
  return (SURFACE_KINDS as string[]).includes(value);
}

function isLayoutShape(value: string): value is LayoutShape {
  return Object.prototype.hasOwnProperty.call(SHAPE_ARITY, value);
}

/**
 * Parse `<shape>:<a>,<b>[,<c>]` into a Layout. Returns `null` for anything
 * malformed: unknown shape, unknown surface kind, wrong arity for the shape,
 * or a repeated non-tty kind. Untrusted strings (URL param, localStorage)
 * are validated HERE so callers may pass raw values (type narrowing over
 * assertions — no `as` casts on the parse path).
 */
export function parseLayout(raw: string | null | undefined): Layout | null {
  if (!raw) return null;
  const colon = raw.indexOf(":");
  if (colon < 0) return null;
  const shape = raw.slice(0, colon);
  if (!isLayoutShape(shape)) return null;
  const parts = raw.slice(colon + 1).split(",");
  if (parts.some((p) => !isSurfaceKind(p))) return null;
  const order = parts as SurfaceKind[];
  if (order.length !== SHAPE_ARITY[shape]) return null;
  const seen = new Set<SurfaceKind>();
  for (const kind of order) {
    if (kind === "tty") continue; // duplicate tty tiles are legal (muxed relay)
    if (seen.has(kind)) return null;
    seen.add(kind);
  }
  return { shape, order };
}

/** Serialize a layout back to its exact URL-string form (round-trips
 *  byte-identically with `parseLayout`). */
export function serializeLayout(layout: Layout): string {
  return `${layout.shape}:${layout.order.join(",")}`;
}

/**
 * The surfaces a window can tile (R8 — the shared registry the rail, layout,
 * and switcher all key off). The order is the positional surface digits'
 * order — ⌘1 tty, ⌘2 code, ⌘3 web (`lib/keybindings.ts`) — so the toggle
 * group, switch group, and palette lists always render in shortcut order.
 * Availability reuses the window-view helpers as the single source of truth;
 * reachability is NOT part of availability (it governs a surface's content,
 * not its presence). `web` is unconditional — the lens always exists;
 * `hasWebUrl` selects its content (onboarding vs live iframe), so the
 * degradation ladder never drops a web tile.
 */
export function availableTiles(win: ViewWindow | null | undefined): SurfaceKind[] {
  const tiles: SurfaceKind[] = ["tty"];
  if (hasCode(win)) tiles.push("code");
  tiles.push("web");
  return tiles;
}

/**
 * Degrade a parsed layout against the window's current capabilities (R4):
 * drop unavailable surfaces tile-by-tile and render the rest in the matching
 * smaller-arity shape (order preserved, slot A kept; 3→2 is `split-h`, 2→1
 * is `single`). Returns `null` when NOTHING is left (a fully-invalid value —
 * the caller falls through to the ladder's next rung).
 */
export function degradeLayout(
  layout: Layout,
  win: ViewWindow | null | undefined,
): Layout | null {
  const available = availableTiles(win);
  const kept = layout.order.filter((kind) => available.includes(kind));
  if (kept.length === 0) return null;
  if (kept.length === layout.order.length) return layout;
  return { shape: COLLAPSE_SHAPE[kept.length as 1 | 2], order: kept };
}

/**
 * The layout a window renders: the shared `@rk_win_layout` value from the
 * payload, parsed and degraded against the window's available tiles (order
 * preserved, slot A kept). An unset, malformed, or fully-unavailable value
 * falls back to `single:tty` (`tty` is in every `availableTiles` result).
 * Purely a READ — the option value is never rewritten here.
 */
export function effectiveLayout(win: ViewWindow | null | undefined): Layout {
  const parsed = parseLayout(win?.layout);
  if (parsed) {
    const degraded = degradeLayout(parsed, win);
    if (degraded) return degraded;
  }
  return { shape: "single", order: ["tty"] };
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
 * storedLegacy. `write` holds the serialized layout to POST exactly once and
 * is present ONLY when the option is empty and the winning candidate parses —
 * a set option always wins and writes nothing. `dropParams` is true when the
 * URL carried a layout-bearing param, telling the caller to navigate to the
 * bare route.
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
  const parsed = parseLayout(carried ?? storedLayout ?? storedLegacy);
  if (!parsed) return { dropParams };
  return { write: serializeLayout(parsed), dropParams };
}

// ── per-viewer zoom (one surface fills the layout area; the shared layout is
//    untouched) ─────────────────────────────────────────────────────────────

/**
 * Value-bearing per-window zoom localStorage key (the ratios-key convention).
 * Stores a surface KIND, not a slot index: desktop zoom resolves it to the
 * kind's first slot in the layout, and the mobile switch group addresses
 * surfaces by kind. Absence means "no zoom".
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

// ── ratios (R5 — per-viewer, per (window, shape), never in the URL) ────────

/**
 * Divider positions as percentages of the tile row/column. A layout of arity
 * N carries N-1 ratios (one per divider); each ratio is the size of the
 * slots BEFORE that divider's group boundary as a 0–100 percentage of the
 * container along the split axis.
 */
export type LayoutRatios = number[];

/** Per-(window, shape) ratios key — a ratio is meaningless across shapes. */
export function ratiosStorageKey(
  server: string,
  windowId: string,
  shape: LayoutShape,
): string {
  return `rk-layout-ratios:${server}:${windowId}:${shape}`;
}

/**
 * Read the persisted ratios for a (window, shape). Returns `undefined` when
 * absent, unparseable, or not an array of finite positive numbers — garbage
 * never reaches the layout (untrusted-localStorage discipline: validate on
 * read, fall back to the default). Not clamped here (clamping needs the live
 * container size).
 */
export function readStoredRatios(
  server: string,
  windowId: string,
  shape: LayoutShape,
): LayoutRatios | undefined {
  try {
    const raw = localStorage.getItem(ratiosStorageKey(server, windowId, shape));
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      parsed.length === 0 ||
      parsed.some((n) => typeof n !== "number" || !Number.isFinite(n) || n <= 0)
    ) {
      return undefined;
    }
    return parsed as number[];
  } catch {
    return undefined;
  }
}

/** Persist the ratios for a (window, shape). Best-effort (try/catch-noop);
 *  callers invoke on drag RELEASE only (R5 — a user mutation). */
export function writeStoredRatios(
  server: string,
  windowId: string,
  shape: LayoutShape,
  ratios: LayoutRatios,
): void {
  try {
    localStorage.setItem(ratiosStorageKey(server, windowId, shape), JSON.stringify(ratios));
  } catch {
    /* noop — best-effort persistence */
  }
}

// ── mutations (verbs — R7/R9/R10) ───────────────────────────────────────────

/**
 * ◧ Promote: move `surface` to slot A; the rest of the order permutes
 * unchanged, shape untouched. A no-op when the surface is absent or already
 * in slot A.
 */
export function promote(layout: Layout, surface: SurfaceKind): Layout {
  const idx = layout.order.indexOf(surface);
  if (idx <= 0) return layout;
  return {
    shape: layout.shape,
    order: [surface, ...layout.order.filter((k) => k !== surface)],
  };
}

/**
 * ⇄ Swap: exchange `surface` with the NEXT neighbor in order (wrapping at
 * the end back to slot A — every tile can always swap). A no-op on `single`
 * layouts or an absent surface.
 */
export function swapWithNext(layout: Layout, surface: SurfaceKind): Layout {
  const idx = layout.order.indexOf(surface);
  if (idx < 0 || layout.order.length < 2) return layout;
  const order = [...layout.order];
  const next = (idx + 1) % order.length;
  [order[idx], order[next]] = [order[next], order[idx]];
  return { shape: layout.shape, order };
}

/**
 * ✕ Close: the surface leaves; the layout collapses to the smaller-arity
 * shape preserving the remaining order with slot A kept (3→2 `split-h`,
 * 2→1 `single`). Returns `null` when the close is disallowed — a `single`
 * layout's last tile never closes (✕ hidden there).
 */
export function closeSurface(layout: Layout, surface: SurfaceKind): Layout | null {
  if (layout.order.length < 2) return null;
  const idx = layout.order.indexOf(surface);
  if (idx < 0) return null;
  const kept = layout.order.filter((k, i) => i !== idx);
  return { shape: COLLAPSE_SHAPE[kept.length as 1 | 2], order: kept };
}

/**
 * Rail toggle open: append `surface` to the next slot — 1→2 grows to
 * `split-h`, 2→3 to `main-left` (the incumbent slot-A tile stays dominant).
 * Returns `null` when the add is disallowed: the layout is already at 3
 * tiles (max — the rail button renders disabled instead), the surface is
 * already open, or a non-tty kind would repeat.
 */
export function addSurface(layout: Layout, surface: SurfaceKind): Layout | null {
  if (layout.order.length >= 3) return null;
  if (surface !== "tty" && layout.order.includes(surface)) return null;
  const order = [...layout.order, surface];
  return { shape: GROWTH_SHAPE[order.length as 2 | 3], order };
}

/** ▦ Cycle shape: the next same-arity preset, order kept (tmux
 *  `next-layout` muscle memory). Arity 1 cycles to itself. */
export function cycleShape(layout: Layout): Layout {
  const ring = SHAPE_RING[SHAPE_ARITY[layout.shape]];
  const idx = ring.indexOf(layout.shape);
  return { shape: ring[(idx + 1) % ring.length], order: layout.order };
}

/**
 * Direct shape jump (the ▦ chip's popover): valid only within the current
 * arity — a shape can never change the tile count (adds/closes do that).
 * Returns `null` on an arity mismatch.
 */
export function setShape(layout: Layout, shape: LayoutShape): Layout | null {
  if (SHAPE_ARITY[shape] !== SHAPE_ARITY[layout.shape]) return null;
  return { shape, order: layout.order };
}

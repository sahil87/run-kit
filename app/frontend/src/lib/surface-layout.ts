/**
 * Pure helpers for the surface-layout model (change
 * 260812-ab5v-surface-layout-core; spec docs/specs/surface-layout.md).
 *
 * The terminal route's center is a LAYOUT MANAGER: one to three tiles, each
 * rendering a surface (a (substrate, lens) pair), arranged by a preset SHAPE
 * with a surface ORDER and per-viewer RATIOS. A layout is fully determined by
 * `(shape, order, ratios)`; ratios live per-viewer in localStorage and never
 * in the URL. This module owns the shape/parse/serialize rules, the
 * resolution ladder (URL `?layout=` > localStorage > default-view hint >
 * `single:tty`), the permanent translation shim for the retired `?view=` /
 * `?panel=` params (and their localStorage predecessors), availability
 * degradation, and the (shape, order) mutations behind the tile verbs.
 *
 * Everything here mirrors the shipped `window-view.ts` / `right-panel.ts`
 * pattern: pure and DOM-free except thin try/catch-noop localStorage
 * wrappers, so the render branch in `app.tsx` AND the unit tests share one
 * drift-free source. Availability reuses `window-view.ts`'s capability
 * helpers (`hasWebUrl` / `hasChat` / `hasCode`) as the single source — `tty`
 * is the always-available surface (the muxed relay supports N clients per
 * pane, so duplicate tty tiles of one window are legal).
 */

import {
  defaultView,
  hasChat,
  hasCode,
  hasWebUrl,
  windowViewStorageKey,
  type ViewName,
  type ViewWindow,
} from "./window-view";
import { panelStorageKey } from "./right-panel";

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
  chat: "Chat",
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
 * intake's approved set): `>_` tty, `://` web, `⌸` chat, `{}` code. Pure data
 * shared by the surface toggles and the mobile switch group.
 */
export const SURFACE_GLYPH: Record<SurfaceKind, string> = {
  tty: ">_",
  web: "://",
  chat: "⌸",
  code: "{}",
};

/** The shape a layout collapses to when a tile leaves (3→2→1, R4/R7):
 *  order is preserved with slot A kept; 2-tile collapse is `split-h` (the
 *  visual continuation of the legacy main+panel split, plan decision). */
const COLLAPSE_SHAPE: Record<1 | 2, LayoutShape> = { 1: "single", 2: "split-h" };

/** The shape a layout grows to when a tile is appended (R10): 1→2 is
 *  `split-h`, 2→3 is `main-left` (the incumbent slot-A tile stays dominant). */
const GROWTH_SHAPE: Record<2 | 3, LayoutShape> = { 2: "split-h", 3: "main-left" };

const SURFACE_KINDS: SurfaceKind[] = ["tty", "web", "chat", "code"];

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
 * The surfaces a window can tile, `tty` FIRST (R8 — the shared registry the
 * rail, layout, and switcher all key off), then `web`/`chat`/`code` per
 * capability. Availability reuses the window-view helpers as the single
 * source of truth; reachability is NOT part of availability (it governs a
 * surface's content, not its presence).
 */
export function availableTiles(win: ViewWindow | null | undefined): SurfaceKind[] {
  const tiles: SurfaceKind[] = ["tty"];
  if (hasWebUrl(win)) tiles.push("web");
  if (hasChat(win)) tiles.push("chat");
  if (hasCode(win)) tiles.push("code");
  return tiles;
}

/**
 * Surfaces demoted OUT of the top-bar toggle/switch group
 * (260812-0c6o): the chat lens is a half-built feature, so it is palette-only
 * (`Tile: Show Chat` / `View: Chat`) — the group filters by this flag AT
 * RENDER, never at availability: `availableTiles` deliberately stays unchanged
 * so the palette entries keep working, and an already-open chat tile still
 * renders and closes normally (the flag hides the toggle, never the tile).
 * Un-hide path when chat ships: delete the entry from the set.
 */
export const SURFACE_RAIL_HIDDEN: ReadonlySet<SurfaceKind> = new Set(["chat"]);

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
 * The default-view hint as a layout (ladder rung 3): a legacy
 * `@rk_type=iframe` window yields `single:web` (via `defaultView`);
 * everything else `single:tty`.
 */
export function hintLayout(win: ViewWindow | null | undefined): Layout {
  return { shape: "single", order: [defaultView(win)] };
}

/**
 * The permanent translation shim for the retired params (L1/R2):
 * `?view=X` → `single:X`; `?view=X&panel=Y` → `split-h:X,Y` (X in slot A —
 * the visual continuation of the legacy main+panel split); a bare `?panel=Y`
 * translates against the tty default main slot. Returns `undefined` when
 * neither legacy param is present. The result is an UNVALIDATED layout
 * string — it feeds `resolveLayout`, whose parse + degrade passes reject or
 * shrink anything invalid (e.g. `?view=web&panel=web`).
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
 * Resolve the effective layout (L2/R3) with precedence:
 *   URL `?layout=` (already shim-translated by the caller) → localStorage
 *   `rk-layout:{server}:{windowId}` → the window's default-view hint →
 *   `single:tty`.
 * Every candidate passes parse + availability degradation; an unknown shape
 * or fully-invalid value falls through to the next rung, so a malformed or
 * stale deep link never renders a broken tile. The terminal fallback is
 * always available (`tty` is in every `availableTiles` result).
 *
 * `searchLayout`/`stored` are untrusted strings — validated here, so callers
 * may pass raw values.
 */
export function resolveLayout(
  searchLayout: string | null | undefined,
  stored: string | null | undefined,
  win: ViewWindow | null | undefined,
): Layout {
  const candidates = [searchLayout, stored, serializeLayout(hintLayout(win))];
  for (const candidate of candidates) {
    const parsed = parseLayout(candidate);
    if (!parsed) continue;
    const degraded = degradeLayout(parsed, win);
    if (degraded) return degraded;
  }
  return { shape: "single", order: ["tty"] };
}

// ── per-window layout persistence (L2/L3) ──────────────────────────────────

/**
 * Value-bearing per-window layout localStorage key (L2 — mirrors
 * `windowViewStorageKey`'s convention). Keyed by the immutable `@N` window id
 * (rename-proof). Absence means "use the hint/default rungs".
 */
export function layoutStorageKey(server: string, windowId: string): string {
  return `rk-layout:${server}:${windowId}`;
}

/**
 * Read the persisted layout STRING for a window. Returns `undefined` when
 * absent or when localStorage is unavailable (SSR/jsdom/quota) — the
 * try/catch-noop pattern from `window-view.ts`. The value is NOT validated
 * here; `resolveLayout` parses + degrades it.
 */
export function readStoredLayout(
  server: string,
  windowId: string,
): string | undefined {
  try {
    return localStorage.getItem(layoutStorageKey(server, windowId)) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Persist a window's layout. Best-effort (try/catch-noop). Callers MUST only
 * invoke this on user-initiated mutations (verbs, rail toggles, chip,
 * divider release) — never on merely arriving via a carried `?layout=` (L3).
 */
export function writeStoredLayout(
  server: string,
  windowId: string,
  layout: Layout,
): void {
  try {
    localStorage.setItem(layoutStorageKey(server, windowId), serializeLayout(layout));
  } catch {
    /* noop — best-effort persistence */
  }
}

/**
 * One-time migration seeding (R2): when no `rk-layout:` key exists for a
 * window, translate the legacy predecessor keys (`runkit-window-view`,
 * `runkit-window-panel`) into the equivalent layout value and store it.
 * Legacy keys are LEFT IN PLACE (other tabs may run older code). A no-op
 * when the layout key already exists, when neither legacy key is present,
 * or when the translated value is malformed.
 */
export function seedLayoutFromLegacy(server: string, windowId: string): void {
  try {
    const key = layoutStorageKey(server, windowId);
    if (localStorage.getItem(key) !== null) return;
    const view = localStorage.getItem(windowViewStorageKey(server, windowId));
    const panel = localStorage.getItem(panelStorageKey(server, windowId));
    const seeded = translateLegacyParams(view, panel);
    if (seeded && parseLayout(seeded)) {
      localStorage.setItem(key, seeded);
    }
  } catch {
    /* noop — best-effort migration */
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

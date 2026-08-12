/**
 * Pure helpers for the right-panel surface model (change
 * 260811-2r1w-right-panel-shell-web-surface; spec docs/specs/right-panel.md).
 *
 * The terminal route gains a SECOND render slot beside the main lens slot: a
 * collapsible panel (behind an always-visible ~38px rail) that renders one
 * additional (substrate, lens) pair — a SURFACE. Phase 1 shipped the `web`
 * surface; phase 2 (260811-k3vp) added `code` (the git-root-keyed code-server
 * embed); the registry is open-ended the way `window-view.ts`'s `ViewName`
 * registry is — `agents` adds a member later without a new code path.
 *
 * Everything here mirrors the shipped `window-view.ts` pattern: pure and
 * DOM-free except thin try/catch-noop localStorage wrappers, so the render
 * branch in `app.tsx` AND the unit tests share one drift-free source. Panel
 * availability derives from the same capability signals as the view registry
 * (`hasWebUrl` for `web`, `hasCode` for `code` — gitRoot-derived since
 * 260811-a2bo; Constitution II/X).
 */

import type { ViewWindow } from "./window-view";
import { availableTiles, type SurfaceKind } from "./surface-layout";

/**
 * A named (substrate, lens) pairing rendered in the panel slot (spec § Surface
 * Registry). `web` is the phase-1 surface; `code` joined in phase 2
 * (260811-k3vp). Since 260812-ab5v (surface-layout R8) the registry is the
 * SHARED tileable-surface registry — `SurfaceName` is an alias of
 * `surface-layout.ts`'s `SurfaceKind` (itself `ViewName`), so the rail, the
 * layout manager, and the view switcher can never drift: `tty` (always
 * available, listed first) and `chat` are surfaces like any other.
 */
export type SurfaceName = SurfaceKind;

/**
 * The surfaces a window offers, `tty` FIRST then `web`/`chat`/`code` per
 * capability (260812-ab5v R8). Delegates to `surface-layout.ts`'s
 * `availableTiles` — the ONE registry rail + layout + switcher share — which
 * in turn keys off `window-view.ts`'s capability helpers (`hasWebUrl` for
 * `web`, `hasChat` for `chat`, `hasCode` for `code` — gitRoot-derived since
 * 260811-a2bo) as the single availability source. Reachability is NOT part of
 * availability (it governs a surface's content — live iframe vs the
 * not-running empty state).
 */
export function availableSurfaces(
  win: ViewWindow | null | undefined,
): SurfaceName[] {
  return availableTiles(win);
}

/**
 * Resolve the open panel surface (spec P1) with precedence:
 *   URL `?panel=` (when available) → localStorage (when available) → `null`.
 * Any value that is unknown or not currently available falls through; `null`
 * means the panel is collapsed (closed is the clean-URL/default state — the
 * absence of both the param and the stored key).
 *
 * `searchPanel`/`stored` are untrusted strings (URL param, localStorage) —
 * they are validated against the surface registry AND the window's capability
 * set here, so callers may pass raw values.
 */
export function resolvePanel(
  searchPanel: string | undefined,
  stored: string | undefined,
  win: ViewWindow | null | undefined,
): SurfaceName | null {
  const available = availableSurfaces(win);
  const isAvailable = (s: string | undefined): s is SurfaceName =>
    (s === "web" || s === "code") && available.includes(s);

  if (isAvailable(searchPanel)) return searchPanel;
  if (isAvailable(stored)) return stored;
  return null;
}

/**
 * Value-bearing per-window localStorage key (spec P1 — mirrors
 * `windowViewStorageKey`). Stores the open surface NAME; absence means
 * "panel closed" (closing REMOVES the key, it does not store a sentinel).
 */
export function panelStorageKey(server: string, windowId: string): string {
  return `runkit-window-panel:${server}:${windowId}`;
}

/**
 * Read the persisted open surface for a window. Returns `undefined` when
 * absent or when localStorage is unavailable (SSR/jsdom/quota) — the
 * try/catch-noop pattern from `window-view.ts`/`chrome-context.tsx`. The value
 * is NOT validated against the window's current capabilities here (a stored
 * `web` for a window that lost its URL is filtered by `resolvePanel`).
 */
export function readStoredPanel(
  server: string,
  windowId: string,
): string | undefined {
  try {
    return localStorage.getItem(panelStorageKey(server, windowId)) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Persist a window's open surface. Best-effort — a localStorage failure
 * (private mode / quota / SSR) is swallowed (try/catch-noop).
 */
export function writeStoredPanel(
  server: string,
  windowId: string,
  surface: SurfaceName,
): void {
  try {
    localStorage.setItem(panelStorageKey(server, windowId), surface);
  } catch {
    /* noop — best-effort persistence */
  }
}

/** Clear a window's persisted surface (closing the panel — absent = closed). */
export function removeStoredPanel(server: string, windowId: string): void {
  try {
    localStorage.removeItem(panelStorageKey(server, windowId));
  } catch {
    /* noop — best-effort persistence */
  }
}

// ── panel width (per-viewer, spec P1) ───────────────────────────────────────

/** Per-viewer panel-width localStorage key — a single key, NOT per-window
 *  (spec P1: "panel width is a per-viewer localStorage value"). */
export const PANEL_WIDTH_STORAGE_KEY = "runkit-panel-width";

/** Default panel width as a percentage of the main content area (spec's
 *  ~35–40% band, intake assumption 8). */
export const DEFAULT_PANEL_WIDTH_PCT = 38;

/** Drag/restore clamps (intake assumption 8): never narrower than 280px,
 *  never wider than 65% of the row. */
export const MIN_PANEL_WIDTH_PX = 280;
export const MAX_PANEL_WIDTH_PCT = 65;

/**
 * Clamp a panel width percentage against the row's pixel width. The 280px
 * floor is converted to a percentage of `containerWidthPx`; when the floor
 * exceeds the 65% cap (a narrow row) the FLOOR wins — mirroring CSS
 * `clamp(min, val, max)`, which prefers min when min > max (a <280px panel is
 * unusable; a >65% one is merely large). A non-positive container width
 * (unmeasured, jsdom) skips the floor and applies only the cap.
 */
export function clampPanelWidth(pct: number, containerWidthPx: number): number {
  const floorPct =
    containerWidthPx > 0 ? (MIN_PANEL_WIDTH_PX / containerWidthPx) * 100 : 0;
  return Math.min(Math.max(pct, floorPct), Math.max(MAX_PANEL_WIDTH_PCT, floorPct));
}

/**
 * Clamp a layout-divider boundary percentage (surface-layout R5,
 * 260812-ab5v) — the `clampPanelWidth` approach generalized to a tile grid:
 * the 280px floor is converted to a percentage of the container along the
 * split axis and bounds BOTH sides (a divider may never strand a tile below
 * the floor), so the range is [floor, 100 − floor] instead of the panel's
 * one-sided 65% cap. A non-positive container size (unmeasured, jsdom) skips
 * the floor exactly like `clampPanelWidth`. Neighbor-boundary bounds (a
 * divider may not cross its siblings) are applied by the caller, which owns
 * the ratios array.
 *
 * Below `2 × MIN_PANEL_WIDTH_PX` the container cannot honor the floor on both
 * sides at once and the range inverts (floor > 100 − floor); the boundary
 * collapses to 50/50 so both tiles are equally undersized rather than one
 * being stranded — the same "impossible bounds" guard the caller applies to
 * its neighbor boundaries.
 */
export function clampRatio(pct: number, containerPx: number): number {
  const floorPct = containerPx > 0 ? (MIN_PANEL_WIDTH_PX / containerPx) * 100 : 0;
  if (floorPct > 50) return 50;
  return Math.min(Math.max(pct, floorPct), 100 - floorPct);
}

/**
 * Read the persisted per-viewer panel width (percent). Returns the default
 * when absent, unparseable, non-finite, or non-positive — garbage never
 * reaches the layout. Not clamped here (clamping needs the live container
 * width; `clampPanelWidth` applies it at render/drag time).
 */
export function readStoredPanelWidth(): number {
  try {
    const raw = localStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
    if (raw === null) return DEFAULT_PANEL_WIDTH_PCT;
    const pct = Number(raw);
    return Number.isFinite(pct) && pct > 0 ? pct : DEFAULT_PANEL_WIDTH_PCT;
  } catch {
    return DEFAULT_PANEL_WIDTH_PCT;
  }
}

/** Persist the per-viewer panel width (percent). Best-effort (try/catch-noop). */
export function writeStoredPanelWidth(pct: number): void {
  try {
    localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(pct));
  } catch {
    /* noop — best-effort persistence */
  }
}

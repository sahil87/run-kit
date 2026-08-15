/**
 * Pure helpers for the present auto-expand reaction (change
 * 260815-wkcw-present-auto-expand-web-tile; spec docs/specs/surface-layout.md
 * R7/L3 carve-out).
 *
 * When an agent runs `rk present` (default arm) it sets `@rk_url` on its own
 * window; a viewer mounted on that window's route observes the `rkUrl`
 * TRANSITION on the state stream (empty→set, or value→different value) and
 * transiently auto-opens the `web` tile. The reaction is view state of the
 * zoom/`mobileActiveTile` class: it never calls the layout mutation path, so
 * nothing is persisted (`rk-layout:` localStorage) and nothing is mirrored
 * into the URL (`?layout=`). Cold route entry never triggers — the resolution
 * ladder alone decides what a fresh arrival sees.
 *
 * State is per-window and in-memory only (`app.tsx` holds a ref `Map` keyed
 * `${server}:${windowId}`): `lastUrl` is the last observed (trimmed) value,
 * `active` is the render-time override flag, `dismissedUrl` is the dismissal
 * latch. Everything here is DOM-free so `app.tsx` and the unit tests share
 * one drift-free source (the `window-view.ts` / `surface-layout.ts` module
 * contract).
 */

import { addSurface, type Layout } from "./surface-layout";

/** Per-window auto-expand bookkeeping. `lastUrl` is trimmed; `""` means the
 *  window carries no usable URL (mirrors `hasWebUrl`'s trim discipline). */
export interface AutoExpandState {
  lastUrl: string;
  active: boolean;
  dismissedUrl: string | null;
}

/**
 * Fold one observed `rkUrl` into the window's state. `undefined` state means
 * initialization (cold entry, first snapshot, or remount after the caller
 * silently refreshed `lastUrl`) and NEVER triggers. A same-value tick returns
 * the state unchanged (transition, not presence, semantics). A transition to
 * empty clears `active` without latching (availability degradation owns the
 * cleared case). A transition to a new non-empty value triggers UNLESS it
 * exactly matches the dismissal latch.
 */
export function observeRkUrl(
  state: AutoExpandState | undefined,
  rkUrl: string,
): AutoExpandState {
  const url = rkUrl.trim();
  if (!state) return { lastUrl: url, active: false, dismissedUrl: null };
  if (url === state.lastUrl) return state;
  if (url.length === 0) return { ...state, lastUrl: url, active: false };
  if (state.dismissedUrl !== null && url === state.dismissedUrl) {
    return { ...state, lastUrl: url, active: false };
  }
  return { ...state, lastUrl: url, active: true };
}

/**
 * The viewer closed the auto-opened web tile: latch the current value so a
 * later re-observation of THAT EXACT value does not re-open. Timestamped
 * present URLs change on every re-present, so a genuine re-present passes.
 */
export function dismissAutoExpand(state: AutoExpandState): AutoExpandState {
  return { ...state, active: false, dismissedUrl: state.lastUrl };
}

/**
 * The viewer mutated the layout while the override was active but KEPT the
 * web tile — touching it makes it theirs (L3), so the override deactivates
 * without latching.
 */
export function deactivateAutoExpand(state: AutoExpandState): AutoExpandState {
  return { ...state, active: false };
}

/**
 * Fold a user layout mutation into the state (L3 — touching the layout makes
 * it theirs). `layout` is the resolved (pre-override) layout the mutation
 * acted on; `next` is its result. The dismissal latch is recorded ONLY when
 * the viewer actually saw a web tile — the RENDERED layout (`withAutoWeb`
 * over `layout`) contained `web` — and `next` closes it. When the override
 * was a visual no-op (arity-3 layout without `web`, so nothing auto-opened),
 * or the mutation keeps `web`, the override merely deactivates without
 * latching.
 */
export function foldLayoutMutation(
  state: AutoExpandState,
  layout: Layout,
  next: Layout,
): AutoExpandState {
  if (!state.active) return state;
  const sawWeb = withAutoWeb(layout, true).order.includes("web");
  return sawWeb && !next.order.includes("web")
    ? dismissAutoExpand(state)
    : deactivateAutoExpand(state);
}

/**
 * The render-time transient composition: when the override is active and the
 * resolved layout lacks `web`, render as if `web` were appended through the
 * existing growth conventions (`addSurface` — 1→2 `split-h`, 2→3
 * `main-left`). Identity when inactive, when `web` is already open, or when
 * the add is disallowed (arity 3 without `web` is a visual no-op).
 */
export function withAutoWeb(layout: Layout, active: boolean): Layout {
  if (!active || layout.order.includes("web")) return layout;
  return addSurface(layout, "web") ?? layout;
}

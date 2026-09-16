/**
 * Screen-break store — a dependency-free module store owning the one-shot
 * Easter-egg flight state. The palette calls `fire(egg, { force: true })`; the
 * automatic triggers call `fire(egg, { identity })`. The `<ScreenBreak />`
 * layer subscribes and renders only while `getState().flight` is non-null.
 *
 * Identity is written to localStorage BEFORE the flight starts so a mid-flight
 * reload never replays an occasion that already counted; a `force` (palette)
 * fire bypasses the identity check and writes nothing, so pressing the entry
 * can never consume a future automatic occasion.
 *
 * The `easter_eggs` setting gates the automatic occasions only: while disabled,
 * a non-force `fire` returns false with no side effects — and in particular
 * writes no identity, because the triggers fire only on observed transitions,
 * so nothing needs consuming and re-enabling later cannot replay an old
 * occasion. A flight already in progress when the flag flips off is not
 * cancelled; the gate governs starting, not running.
 */

import { prefersReducedMotion } from "@/lib/motion";
import { pickImpact, radiusFor, type BreakPoint } from "@/lib/screen-break-geometry";

export type ScreenBreakEgg = "smash" | "peek";

export const SMASH_KEY = "runkit-egg-smash";
export const PEEK_KEY = "runkit-egg-peek";

/** The eggs need room for the shards to fall — no-op below this width. */
const MIN_VIEWPORT_WIDTH = 640;

export type ScreenBreakFlight = {
  egg: ScreenBreakEgg;
  startedAt: number;
  P: BreakPoint;
  R: number;
  W: number;
  H: number;
};

export type ScreenBreakState = { flight: ScreenBreakFlight | null };

let state: ScreenBreakState = { flight: null };
const listeners = new Set<() => void>();
let glass: HTMLElement | null = null;
let enabled = true;

/** Flip the automatic occasions. Palette (`force`) fires ignore this. */
export function setEasterEggsEnabled(v: boolean): void {
  enabled = v;
}

export function easterEggsEnabled(): boolean {
  return enabled;
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getState(): ScreenBreakState {
  return state;
}

/** The glass is the `.app-root` div, registered via a ref callback from the
 *  layout — never located by a DOM query. */
export function registerGlass(el: HTMLElement | null): void {
  glass = el;
}

export function getGlass(): HTMLElement | null {
  return glass;
}

function keyFor(egg: ScreenBreakEgg): string {
  return egg === "smash" ? SMASH_KEY : PEEK_KEY;
}

function readIdentity(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage unavailable (private mode) — degrade to "fire"
  }
}

function writeIdentity(key: string, identity: string): void {
  try {
    localStorage.setItem(key, identity);
  } catch {
    // storage unavailable — the fire still happens
  }
}

/**
 * Start a flight. Returns false with no side effects when: reduced motion is
 * preferred; the viewport is narrower than 640 px; a flight is already in
 * progress (dropped, never queued); the store is disabled and the fire is not
 * forced (no identity write — the triggers fire only on observed transitions,
 * so nothing needs consuming and re-enabling cannot replay an old occasion);
 * or a non-force `identity` equals the value stored under the egg's key. A
 * non-force fire with an identity records it before the flight starts (storage
 * failure still fires).
 */
export function fire(egg: ScreenBreakEgg, opts?: { force?: boolean; identity?: string }): boolean {
  if (prefersReducedMotion()) return false;
  if (typeof window === "undefined" || window.innerWidth < MIN_VIEWPORT_WIDTH) return false;
  if (state.flight) return false;
  if (!enabled && !opts?.force) return false;
  const identity = opts?.identity;
  if (!opts?.force && identity) {
    if (readIdentity(keyFor(egg)) === identity) return false;
    writeIdentity(keyFor(egg), identity);
  }
  const W = window.innerWidth;
  const H = window.innerHeight;
  state = {
    flight: { egg, startedAt: performance.now(), P: pickImpact(W, H), R: radiusFor(W), W, H },
  };
  notify();
  return true;
}

export function finish(): void {
  if (!state.flight) return;
  state = { flight: null };
  notify();
}

export function _resetForTests(): void {
  state = { flight: null };
  glass = null;
  enabled = true;
  listeners.clear();
}

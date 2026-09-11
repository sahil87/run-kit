/**
 * The gui stats overlay's pure math (spec docs/specs/gui.md § Smoothness
 * targets): the sampling cadence constants, the counter→rate reduction
 * (`sampleRates` — fps from canvas-source `drawImage` flips, Mbit/s from
 * binary WebSocket bytes, both over a sample window), and the overlay line's
 * format grammar (`formatGuiStats` — `{fps} fps · {mbit} Mbit/s · {rtt} ms ·
 * {W}×{H} · {zoom}`). The collector that feeds these lives in
 * `components/gui-surface.tsx`.
 */

import type { GuiZoom } from "./gui-posture";

/** How often the collector folds the counters into a stats snapshot. */
export const STATS_SAMPLE_MS = 1000;

/** How often the collector times a `POST /api/gui/{id}/ping` round trip. */
export const STATS_PING_MS = 5000;

export type GuiStats = {
  fps: number | null;
  mbit: number | null;
  rttMs: number | null;
  width: number;
  height: number;
  zoom: GuiZoom;
};

export type GuiStatsCounters = { flips: number; bytes: number };

/**
 * Fold two counter readings `dtMs` apart into per-second rates: flips → fps,
 * bytes → Mbit/s (1 Mbit = 1 000 000 bits). A sub-1 s window scales up (the
 * reading is a rate, not a count).
 */
export function sampleRates(
  prev: GuiStatsCounters,
  now: GuiStatsCounters,
  dtMs: number,
): { fps: number; mbit: number } {
  const seconds = dtMs / 1000;
  return {
    fps: (now.flips - prev.flips) / seconds,
    mbit: ((now.bytes - prev.bytes) * 8) / seconds / 1_000_000,
  };
}

/** Mbit/s renders one decimal below 10, an integer at or above. */
function formatMbit(mbit: number): string {
  return mbit < 10 ? mbit.toFixed(1) : String(Math.round(mbit));
}

/**
 * Render the overlay line: integer fps, Mbit/s per `formatMbit`, integer ms,
 * `—` for each unsampled (null) value, `W×H`, and `fit` / `N%` for the zoom.
 */
export function formatGuiStats(s: GuiStats): string {
  const fps = s.fps === null ? "—" : String(Math.round(s.fps));
  const mbit = s.mbit === null ? "—" : formatMbit(s.mbit);
  const rtt = s.rttMs === null ? "—" : String(Math.round(s.rttMs));
  const zoom = s.zoom === "fit" ? "fit" : `${s.zoom}%`;
  return `${fps} fps · ${mbit} Mbit/s · ${rtt} ms · ${s.width}×${s.height} · ${zoom}`;
}

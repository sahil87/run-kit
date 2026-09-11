import { describe, it, expect } from "vitest";
import {
  STATS_PING_MS,
  STATS_SAMPLE_MS,
  formatGuiStats,
  sampleRates,
  type GuiStats,
} from "./gui-stats";

describe("gui-stats constants", () => {
  it("samples every second and pings every five", () => {
    expect(STATS_SAMPLE_MS).toBe(1000);
    expect(STATS_PING_MS).toBe(5000);
  });
});

describe("sampleRates", () => {
  it("the R4 tick: 30 flips and 125 000 bytes over one 1 s window read 30 fps and 1.0 Mbit/s", () => {
    const rates = sampleRates({ flips: 0, bytes: 0 }, { flips: 30, bytes: 125_000 }, 1000);
    expect(rates.fps).toBe(30);
    expect(rates.mbit).toBe(1);
  });

  it("a sub-1 s window scales the reading up to a per-second rate", () => {
    const rates = sampleRates({ flips: 100, bytes: 1_000 }, { flips: 115, bytes: 63_500 }, 500);
    expect(rates.fps).toBe(30);
    expect(rates.mbit).toBe(1);
  });

  it("a flat window reads zero", () => {
    const rates = sampleRates({ flips: 7, bytes: 500 }, { flips: 7, bytes: 500 }, 1000);
    expect(rates.fps).toBe(0);
    expect(rates.mbit).toBe(0);
  });
});

describe("formatGuiStats", () => {
  const base: GuiStats = {
    fps: null,
    mbit: null,
    rttMs: null,
    width: 1920,
    height: 1080,
    zoom: "fit",
  };

  it("the first R5 example: integers everywhere, fit zoom", () => {
    expect(
      formatGuiStats({ ...base, fps: 59.4, mbit: 41.2, rttMs: 262 }),
    ).toBe("59 fps · 41 Mbit/s · 262 ms · 1920×1080 · fit");
  });

  it("the second R5 example: dashes for nulls, one decimal below 10 Mbit/s, percentage zoom", () => {
    expect(formatGuiStats({ ...base, mbit: 3.456, zoom: 150 })).toBe(
      "— fps · 3.5 Mbit/s · — ms · 1920×1080 · 150%",
    );
  });

  it("Mbit/s renders one decimal below 10 and an integer at or above", () => {
    expect(formatGuiStats({ ...base, mbit: 9.96 })).toContain("10.0 Mbit/s");
    expect(formatGuiStats({ ...base, mbit: 9.94 })).toContain("9.9 Mbit/s");
    expect(formatGuiStats({ ...base, mbit: 10.4 })).toContain("10 Mbit/s");
  });

  it("all-null rates and RTT read as dashes around the size and zoom", () => {
    expect(formatGuiStats(base)).toBe("— fps · — Mbit/s · — ms · 1920×1080 · fit");
  });
});

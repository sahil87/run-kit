import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { GuiStatsOverlay } from "./gui-stats-overlay";
import type { GuiStats } from "@/lib/gui-stats";

afterEach(cleanup);

const base: GuiStats = {
  fps: null,
  mbit: null,
  rttMs: null,
  width: 1920,
  height: 1080,
  zoom: "fit",
};

describe("GuiStatsOverlay", () => {
  it("renders the first R5 example byte-for-byte", () => {
    render(<GuiStatsOverlay stats={{ ...base, fps: 59.4, mbit: 41.2, rttMs: 262 }} />);
    expect(screen.getByTestId("gui-stats-overlay")).toHaveTextContent(
      "59 fps · 41 Mbit/s · 262 ms · 1920×1080 · fit",
    );
  });

  it("renders the second R5 example byte-for-byte (dashes, sub-10 Mbit/s decimal, percentage zoom)", () => {
    render(<GuiStatsOverlay stats={{ ...base, mbit: 3.456, zoom: 150 }} />);
    expect(screen.getByTestId("gui-stats-overlay")).toHaveTextContent(
      "— fps · 3.5 Mbit/s · — ms · 1920×1080 · 150%",
    );
  });
});

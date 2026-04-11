import { describe, it, expect } from "vitest";
import { gaugeBar, gaugeColor, formatBytes, formatMemory } from "./gauge";

describe("gaugeBar", () => {
  it("returns all empty for 0 ratio", () => {
    const result = gaugeBar(0);
    expect(result).toBe("\u2591".repeat(10));
  });

  it("returns all filled for 1.0 ratio", () => {
    const result = gaugeBar(1);
    expect(result).toBe("\u2588".repeat(10));
  });

  it("returns half filled for 0.5 ratio", () => {
    const result = gaugeBar(0.5);
    expect(result).toBe("\u2588".repeat(5) + "\u2591".repeat(5));
  });

  it("always returns 10 characters", () => {
    for (const ratio of [0, 0.1, 0.33, 0.5, 0.75, 1.0]) {
      expect(gaugeBar(ratio).length).toBe(10);
    }
  });

  it("clamps negative to 0", () => {
    expect(gaugeBar(-0.5)).toBe("\u2591".repeat(10));
  });

  it("clamps above 1 to full", () => {
    expect(gaugeBar(1.5)).toBe("\u2588".repeat(10));
  });
});

describe("gaugeColor", () => {
  it("returns green for < 70%", () => {
    expect(gaugeColor(50)).toBe("text-green-500");
    expect(gaugeColor(0)).toBe("text-green-500");
    expect(gaugeColor(69)).toBe("text-green-500");
  });

  it("returns yellow for 70-90%", () => {
    expect(gaugeColor(70)).toBe("text-yellow-500");
    expect(gaugeColor(80)).toBe("text-yellow-500");
    expect(gaugeColor(90)).toBe("text-yellow-500");
  });

  it("returns red for > 90%", () => {
    expect(gaugeColor(91)).toBe("text-red-500");
    expect(gaugeColor(100)).toBe("text-red-500");
  });
});

describe("formatBytes", () => {
  it("formats 0 as '0'", () => {
    expect(formatBytes(0)).toBe("0");
  });

  it("formats GB values >= 10 as rounded integers", () => {
    const bytes = 16 * 1024 * 1024 * 1024;
    expect(formatBytes(bytes)).toBe("16G");
  });

  it("formats GB values < 10 with one decimal", () => {
    const bytes = 3.1 * 1024 * 1024 * 1024;
    expect(formatBytes(bytes)).toBe("3.1G");
  });

  it("formats MB values >= 10 as rounded integers", () => {
    const bytes = 512 * 1024 * 1024;
    expect(formatBytes(bytes)).toBe("512M");
  });

  it("formats MB values < 10 with one decimal", () => {
    const bytes = 5.5 * 1024 * 1024;
    expect(formatBytes(bytes)).toBe("5.5M");
  });

  it("formats KB values", () => {
    const bytes = 100 * 1024;
    expect(formatBytes(bytes)).toBe("100K");
  });
});

describe("formatMemory", () => {
  it("formats used/total pair", () => {
    const used = 3.1 * 1024 * 1024 * 1024;
    const total = 8 * 1024 * 1024 * 1024;
    expect(formatMemory(used, total)).toBe("3.1G/8G");
  });

  it("handles zero values", () => {
    expect(formatMemory(0, 0)).toBe("0/0");
  });
});

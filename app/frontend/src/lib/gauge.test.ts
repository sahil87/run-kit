import { describe, it, expect } from "vitest";
import { gaugeBar, gaugeColor, formatBytes, formatMemory } from "./gauge";

describe("gaugeBar", () => {
  it.each([
    [0, "\u2591".repeat(10)],
    [1, "\u2588".repeat(10)],
    [0.5, "\u2588".repeat(5) + "\u2591".repeat(5)],
    [-0.5, "\u2591".repeat(10)],
    [1.5, "\u2588".repeat(10)],
  ] as const)("renders ratio %s", (ratio, expected) => {
    expect(gaugeBar(ratio)).toBe(expected);
  });

  it("always returns 10 characters", () => {
    for (const ratio of [0, 0.1, 0.33, 0.5, 0.75, 1.0]) {
      expect(gaugeBar(ratio).length).toBe(10);
    }
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
  it.each([
    [0, "0"],
    [16 * 1024 ** 3, "16G"],
    [3.1 * 1024 ** 3, "3.1G"],
    [512 * 1024 ** 2, "512M"],
    [5.5 * 1024 ** 2, "5.5M"],
    [100 * 1024, "100K"],
  ] as const)("formats %s bytes as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
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

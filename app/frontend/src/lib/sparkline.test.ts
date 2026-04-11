import { describe, it, expect } from "vitest";
import { sparkline } from "./sparkline";

describe("sparkline", () => {
  it("returns empty string for empty array", () => {
    expect(sparkline([])).toBe("");
  });

  it("maps 0% to lowest braille character", () => {
    const result = sparkline([0]);
    expect(result).toBe("\u28C0");
  });

  it("maps 100% to highest braille character", () => {
    const result = sparkline([100]);
    expect(result).toBe("\u28FF");
  });

  it("maps all zeros to repeated lowest characters", () => {
    const zeros = new Array(60).fill(0);
    const result = sparkline(zeros);
    expect(result.length).toBe(60);
    expect(result).toBe("\u28C0".repeat(60));
  });

  it("maps all 100s to repeated highest characters", () => {
    const full = new Array(10).fill(100);
    const result = sparkline(full);
    expect(result.length).toBe(10);
    expect(result).toBe("\u28FF".repeat(10));
  });

  it("produces 8 distinct levels across the range", () => {
    // Test values at midpoints of each level's range
    const values = [0, 14, 27, 40, 53, 66, 79, 100];
    const result = sparkline(values);
    expect(result.length).toBe(8);

    // Each character should be different from its neighbors (monotonically increasing)
    for (let i = 1; i < result.length; i++) {
      expect(result.charCodeAt(i)).toBeGreaterThanOrEqual(result.charCodeAt(i - 1));
    }
  });

  it("clamps negative values to lowest level", () => {
    const result = sparkline([-10]);
    expect(result).toBe("\u28C0");
  });

  it("clamps values above 100 to highest level", () => {
    const result = sparkline([150]);
    expect(result).toBe("\u28FF");
  });

  it("handles mixed values", () => {
    const result = sparkline([0, 50, 100]);
    expect(result.length).toBe(3);
    // First char should be lowest, last should be highest
    expect(result.charCodeAt(0)).toBeLessThan(result.charCodeAt(2));
  });
});

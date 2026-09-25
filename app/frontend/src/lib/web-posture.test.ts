import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readWebCapture, writeWebCapture } from "./web-posture";

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("web keyboard capture latch (rk-web-capture)", () => {
  it("defaults to released when absent", () => {
    expect(readWebCapture()).toBe(false);
  });

  it("round-trips the flag; releasing removes the key", () => {
    writeWebCapture(true);
    expect(readWebCapture()).toBe(true);
    expect(localStorage.getItem("rk-web-capture")).toBe("1");
    writeWebCapture(false);
    expect(readWebCapture()).toBe(false);
    expect(localStorage.getItem("rk-web-capture")).toBeNull();
  });

  it("reads a stray non-'1' value as released", () => {
    localStorage.setItem("rk-web-capture", "yes");
    expect(readWebCapture()).toBe(false);
  });

  it("swallows a localStorage read failure, returning released", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readWebCapture()).toBe(false);
  });

  it("swallows a localStorage write failure silently", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => writeWebCapture(true)).not.toThrow();
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  codeFolderStorageKey,
  readLatchedCodeFolder,
  writeLatchedCodeFolder,
} from "./code-folder-latch";

describe("code-folder latch (per-window localStorage, try/catch-noop)", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("builds a value-bearing per-window key (the windowViewStorageKey convention)", () => {
    expect(codeFolderStorageKey("srv", "@3")).toBe("runkit-code-folder:srv:@3");
  });

  it("round-trips a latched folder", () => {
    expect(readLatchedCodeFolder("srv", "@3")).toBeUndefined();
    writeLatchedCodeFolder("srv", "@3", "/home/user/repo");
    expect(readLatchedCodeFolder("srv", "@3")).toBe("/home/user/repo");
    // The follow rule re-latches in place (editor navigation, not the terminal).
    writeLatchedCodeFolder("srv", "@3", "/home/user/other");
    expect(readLatchedCodeFolder("srv", "@3")).toBe("/home/user/other");
  });

  it("scopes keys per (server, windowId)", () => {
    writeLatchedCodeFolder("srv", "@3", "/repo");
    expect(readLatchedCodeFolder("srv", "@4")).toBeUndefined();
    expect(readLatchedCodeFolder("other", "@3")).toBeUndefined();
  });

  it("never stores an empty folder (an empty derivation seeds nothing)", () => {
    writeLatchedCodeFolder("srv", "@3", "");
    expect(localStorage.getItem(codeFolderStorageKey("srv", "@3"))).toBeNull();
    expect(readLatchedCodeFolder("srv", "@3")).toBeUndefined();
  });

  it("treats an externally-stored empty value as absent", () => {
    localStorage.setItem(codeFolderStorageKey("srv", "@3"), "");
    expect(readLatchedCodeFolder("srv", "@3")).toBeUndefined();
  });

  it("swallows a localStorage read failure, returning undefined", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readLatchedCodeFolder("srv", "@3")).toBeUndefined();
  });

  it("swallows a localStorage write failure (no throw)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => writeLatchedCodeFolder("srv", "@3", "/repo")).not.toThrow();
  });
});

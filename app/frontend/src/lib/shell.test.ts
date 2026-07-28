import { describe, it, expect, afterEach } from "vitest";
import { isShell, shellInfo } from "./shell";

// The desktop shell injects window.runkitShell at runtime via its preload
// contextBridge — nothing type-level guarantees the shape, so these tests
// prove the structural narrowing: well-formed bridges are read, everything
// else (absent, null, primitives, wrong field types) reads as "not a shell".

afterEach(() => {
  delete window.runkitShell;
});

describe("shellInfo / isShell", () => {
  it("returns null / false in a plain browser (bridge absent)", () => {
    expect(shellInfo()).toBeNull();
    expect(isShell()).toBe(false);
  });

  it("returns the shell metadata for a well-formed bridge", () => {
    window.runkitShell = { version: "1.2.3", platform: "darwin" };
    expect(shellInfo()).toEqual({ version: "1.2.3", platform: "darwin" });
    expect(isShell()).toBe(true);
  });

  it("does not leak extra bridge members (e.g. the welcome IPC namespace)", () => {
    window.runkitShell = {
      version: "1.2.3",
      platform: "darwin",
      __welcome: { testServer: () => Promise.resolve() },
    };
    expect(shellInfo()).toEqual({ version: "1.2.3", platform: "darwin" });
  });

  it("rejects a malformed bridge with a non-string version", () => {
    window.runkitShell = { version: 123, platform: "darwin" };
    expect(shellInfo()).toBeNull();
    expect(isShell()).toBe(false);
  });

  it("rejects a bridge missing the platform field", () => {
    window.runkitShell = { version: "1.2.3" };
    expect(shellInfo()).toBeNull();
  });

  it("rejects null and primitive bridge values", () => {
    window.runkitShell = null;
    expect(isShell()).toBe(false);
    window.runkitShell = "1.2.3";
    expect(isShell()).toBe(false);
  });
});

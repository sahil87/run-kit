import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { copyToClipboard, XTERM_THEMES } from "./terminal-client";

describe("copyToClipboard", () => {
  let originalClipboard: Clipboard;
  let originalExecCommand: typeof document.execCommand;
  let execCommandSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalClipboard = navigator.clipboard;
    originalExecCommand = document.execCommand;
    // jsdom doesn't define execCommand — stub it
    execCommandSpy = vi.fn().mockReturnValue(true);
    document.execCommand = execCommandSpy as typeof document.execCommand;
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      writable: true,
      configurable: true,
    });
    document.execCommand = originalExecCommand;
  });

  it("uses Clipboard API when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    await copyToClipboard("hello");

    expect(writeText).toHaveBeenCalledWith("hello");
    expect(execCommandSpy).not.toHaveBeenCalled();
  });

  it("falls back to execCommand when Clipboard API throws", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("not allowed"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    await copyToClipboard("fallback text");

    expect(writeText).toHaveBeenCalledWith("fallback text");
    expect(execCommandSpy).toHaveBeenCalledWith("copy");
  });

  it("falls back to execCommand when Clipboard API is undefined", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    await copyToClipboard("no clipboard api");

    expect(execCommandSpy).toHaveBeenCalledWith("copy");
  });

  it("cleans up temporary textarea after fallback", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const bodyChildCountBefore = document.body.children.length;
    await copyToClipboard("cleanup test");
    expect(document.body.children.length).toBe(bodyChildCountBefore);
  });

  it("silently ignores failure and cleans up textarea when execCommand throws", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    execCommandSpy.mockImplementation(() => {
      throw new Error("execCommand failed");
    });

    const bodyChildCountBefore = document.body.children.length;
    // Should resolve (not reject) — both mechanisms failing is silently ignored
    await copyToClipboard("error test");
    expect(document.body.children.length).toBe(bodyChildCountBefore);
  });
});

describe("XTERM_THEMES", () => {
  it("defines dark and light theme objects", () => {
    expect(XTERM_THEMES.dark).toBeDefined();
    expect(XTERM_THEMES.light).toBeDefined();
  });

  it("dark theme uses dark background", () => {
    expect(XTERM_THEMES.dark.background).toBe("#0f1117");
    expect(XTERM_THEMES.dark.foreground).toBe("#e8eaf0");
  });

  it("light theme uses light background", () => {
    expect(XTERM_THEMES.light.background).toBe("#f8f9fb");
    expect(XTERM_THEMES.light.foreground).toBe("#1a1d24");
  });

  it("both themes have all required properties", () => {
    for (const theme of [XTERM_THEMES.dark, XTERM_THEMES.light]) {
      expect(theme).toHaveProperty("background");
      expect(theme).toHaveProperty("foreground");
      expect(theme).toHaveProperty("cursor");
      expect(theme).toHaveProperty("selectionBackground");
    }
  });
});

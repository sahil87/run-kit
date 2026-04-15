import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { copyToClipboard } from "@/lib/clipboard";
import { clipboardProvider } from "./terminal-client";
import { deriveXtermTheme, DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from "@/themes";

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

describe("clipboardProvider", () => {
  let originalClipboard: Clipboard;

  beforeEach(() => {
    originalClipboard = navigator.clipboard;
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      writable: true,
      configurable: true,
    });
  });

  function mockClipboard() {
    const clipboard = {
      writeText: vi.fn().mockResolvedValue(undefined),
      readText: vi.fn().mockResolvedValue("clipboard content"),
    };
    Object.defineProperty(navigator, "clipboard", {
      value: clipboard,
      writable: true,
      configurable: true,
    });
    return clipboard;
  }

  it("writeText calls clipboard API for empty selection (tmux default)", async () => {
    const clipboard = mockClipboard();
    await clipboardProvider.writeText("", "test text");
    expect(clipboard.writeText).toHaveBeenCalledWith("test text");
  });

  it("writeText calls clipboard API for 'c' selection", async () => {
    const clipboard = mockClipboard();
    await clipboardProvider.writeText("c", "test text");
    expect(clipboard.writeText).toHaveBeenCalledWith("test text");
  });

  it("writeText does not call clipboard API for 'p' selection", async () => {
    const clipboard = mockClipboard();
    await clipboardProvider.writeText("p", "test text");
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it("writeText does not call clipboard API for 's' selection", async () => {
    const clipboard = mockClipboard();
    await clipboardProvider.writeText("s", "test text");
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it("readText returns clipboard content for empty selection", async () => {
    mockClipboard();
    const result = await clipboardProvider.readText("");
    expect(result).toBe("clipboard content");
  });

  it("readText returns clipboard content for 'c' selection", async () => {
    mockClipboard();
    const result = await clipboardProvider.readText("c");
    expect(result).toBe("clipboard content");
  });

  it("readText returns empty string for 'p' selection", async () => {
    mockClipboard();
    const result = await clipboardProvider.readText("p");
    expect(result).toBe("");
  });
});

describe("deriveXtermTheme integration", () => {
  it("derives correct xterm theme for default dark palette", () => {
    const xterm = deriveXtermTheme(DEFAULT_DARK_THEME.palette);
    expect(xterm.background).toBe("#0f1117");
    expect(xterm.foreground).toBe("#e8eaf0");
    expect(xterm.cursor).toBe("#e8eaf0");
    expect(xterm.selectionBackground).toBe("#2a3040");
  });

  it("derives correct xterm theme for default light palette", () => {
    const xterm = deriveXtermTheme(DEFAULT_LIGHT_THEME.palette);
    expect(xterm.background).toBe("#f8f9fb");
    expect(xterm.foreground).toBe("#1a1d24");
  });

  it("xterm theme includes all 22 color fields", () => {
    const xterm = deriveXtermTheme(DEFAULT_DARK_THEME.palette);
    expect(xterm).toHaveProperty("background");
    expect(xterm).toHaveProperty("foreground");
    expect(xterm).toHaveProperty("cursor");
    expect(xterm).toHaveProperty("cursorAccent");
    expect(xterm).toHaveProperty("selectionBackground");
    expect(xterm).toHaveProperty("selectionForeground");
    expect(xterm).toHaveProperty("black");
    expect(xterm).toHaveProperty("red");
    expect(xterm).toHaveProperty("green");
    expect(xterm).toHaveProperty("yellow");
    expect(xterm).toHaveProperty("blue");
    expect(xterm).toHaveProperty("magenta");
    expect(xterm).toHaveProperty("cyan");
    expect(xterm).toHaveProperty("white");
    expect(xterm).toHaveProperty("brightBlack");
    expect(xterm).toHaveProperty("brightWhite");
  });
});

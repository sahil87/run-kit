import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useChatViewShortcut } from "./use-chat-view-shortcut";

function pressBacktick(
  target: Window | HTMLElement,
  init: KeyboardEventInit = {},
) {
  const event = new KeyboardEvent("keydown", {
    key: "`",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useChatViewShortcut", () => {
  it("Ctrl+` toggles terminal → chat", () => {
    const toggle = vi.fn();
    renderHook(() => useChatViewShortcut(true, "terminal", toggle));
    pressBacktick(window);
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledWith("chat");
  });

  it("Ctrl+` toggles chat → terminal (reads the latest view)", () => {
    const toggle = vi.fn();
    const { rerender } = renderHook(
      ({ view }: { view: "chat" | "terminal" }) =>
        useChatViewShortcut(true, view, toggle),
      { initialProps: { view: "terminal" as "chat" | "terminal" } },
    );
    rerender({ view: "chat" });
    pressBacktick(window);
    expect(toggle).toHaveBeenCalledWith("terminal");
  });

  it("fires while xterm owns focus (target inside .xterm is NOT suppressed)", () => {
    const toggle = vi.fn();
    renderHook(() => useChatViewShortcut(true, "terminal", toggle));
    // xterm.js focuses a hidden textarea inside the .xterm container — the
    // shortcut's whole job is escaping the terminal, so this MUST fire.
    const xterm = document.createElement("div");
    xterm.className = "xterm";
    const helper = document.createElement("textarea");
    xterm.appendChild(helper);
    document.body.appendChild(xterm);
    pressBacktick(helper);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("bails when a real text input has focus (INPUT / TEXTAREA outside xterm)", () => {
    const toggle = vi.fn();
    renderHook(() => useChatViewShortcut(true, "terminal", toggle));
    const input = document.createElement("input");
    document.body.appendChild(input);
    pressBacktick(input);
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    pressBacktick(textarea);
    expect(toggle).not.toHaveBeenCalled();
  });

  it("no-ops when disabled (the no-chat gate)", () => {
    const toggle = vi.fn();
    renderHook(() => useChatViewShortcut(false, "terminal", toggle));
    pressBacktick(window);
    expect(toggle).not.toHaveBeenCalled();
  });

  it("requires plain Ctrl: Meta+` and bare ` never fire (Cmd+` is macOS window cycling)", () => {
    const toggle = vi.fn();
    renderHook(() => useChatViewShortcut(true, "terminal", toggle));
    pressBacktick(window, { ctrlKey: false, metaKey: true });
    pressBacktick(window, { ctrlKey: false });
    pressBacktick(window, { ctrlKey: true, altKey: true });
    expect(toggle).not.toHaveBeenCalled();
  });

  it("prevents the default for a handled chord and unregisters on unmount", () => {
    const toggle = vi.fn();
    const { unmount } = renderHook(() =>
      useChatViewShortcut(true, "terminal", toggle),
    );
    const handled = pressBacktick(window);
    expect(handled.defaultPrevented).toBe(true);
    unmount();
    pressBacktick(window);
    expect(toggle).toHaveBeenCalledTimes(1); // only the pre-unmount press
  });
});

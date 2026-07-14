import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useChatViewShortcut } from "./use-chat-view-shortcut";
import type { ViewName } from "@/lib/window-view";

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
  it("Ctrl+` toggles tty → chat", () => {
    const toggle = vi.fn();
    renderHook(() => useChatViewShortcut(true, "tty", toggle));
    pressBacktick(window);
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledWith("chat");
  });

  it("Ctrl+` toggles chat → tty (reads the latest view)", () => {
    const toggle = vi.fn();
    const { rerender } = renderHook(
      ({ view }: { view: ViewName }) =>
        useChatViewShortcut(true, view, toggle),
      { initialProps: { view: "tty" as ViewName } },
    );
    rerender({ view: "chat" });
    pressBacktick(window);
    expect(toggle).toHaveBeenCalledWith("tty");
  });

  it("fires while xterm owns focus (target inside .xterm is NOT suppressed)", () => {
    const toggle = vi.fn();
    renderHook(() => useChatViewShortcut(true, "tty", toggle));
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
    renderHook(() => useChatViewShortcut(true, "tty", toggle));
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
    renderHook(() => useChatViewShortcut(false, "tty", toggle));
    pressBacktick(window);
    expect(toggle).not.toHaveBeenCalled();
  });

  it("requires plain Ctrl: Meta/Alt/Shift-modified and bare ` never fire (Cmd+` is macOS window cycling)", () => {
    const toggle = vi.fn();
    renderHook(() => useChatViewShortcut(true, "tty", toggle));
    pressBacktick(window, { ctrlKey: false, metaKey: true });
    pressBacktick(window, { ctrlKey: false });
    pressBacktick(window, { ctrlKey: true, altKey: true });
    // Shift is excluded explicitly: Ctrl+Shift+` must not fire even on a layout
    // where Shift+` still resolves to "`".
    pressBacktick(window, { ctrlKey: true, shiftKey: true });
    expect(toggle).not.toHaveBeenCalled();
  });

  it("prevents the default for a handled chord and unregisters on unmount", () => {
    const toggle = vi.fn();
    const { unmount } = renderHook(() =>
      useChatViewShortcut(true, "tty", toggle),
    );
    const handled = pressBacktick(window);
    expect(handled.defaultPrevented).toBe(true);
    unmount();
    pressBacktick(window);
    expect(toggle).toHaveBeenCalledTimes(1); // only the pre-unmount press
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { useKeybindingDispatch } from "./use-keybinding-dispatch";
import { KEYBINDINGS_STORAGE_KEY } from "@/lib/keybindings";

function press(
  init: KeyboardEventInit & { code: string },
  target: Window | HTMLElement = window,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  // No vitest globals in this project, so RTL cannot auto-register its
  // cleanup — unmount explicitly or window listeners leak across tests.
  cleanup();
  localStorage.clear();
  document.body.innerHTML = "";
});

describe("useKeybindingDispatch", () => {
  it("runs the handler and prevents default for a matched enabled binding", () => {
    const next = vi.fn();
    renderHook(() => useKeybindingDispatch({ "window-next": next }));
    const event = press({ code: "KeyL", shiftKey: true, ctrlKey: true });
    expect(next).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("falls through (no preventDefault) when the matched binding has no handler", () => {
    renderHook(() => useKeybindingDispatch({ "window-next": undefined }));
    const event = press({ code: "KeyL", shiftKey: true, ctrlKey: true });
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores events something else already claimed (defaultPrevented)", () => {
    const next = vi.fn();
    renderHook(() => useKeybindingDispatch({ "window-next": next }));
    const claimed = new KeyboardEvent("keydown", {
      code: "KeyL",
      shiftKey: true,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    claimed.preventDefault();
    window.dispatchEvent(claimed);
    expect(next).not.toHaveBeenCalled();
  });

  it("suppresses in a real text input, fires inside .xterm", () => {
    const next = vi.fn();
    renderHook(() => useKeybindingDispatch({ "window-next": next }));
    const input = document.createElement("input");
    document.body.appendChild(input);
    press({ code: "KeyL", shiftKey: true, ctrlKey: true }, input);
    expect(next).not.toHaveBeenCalled();

    const xterm = document.createElement("div");
    xterm.className = "xterm";
    const helper = document.createElement("textarea");
    xterm.appendChild(helper);
    document.body.appendChild(xterm);
    press({ code: "KeyL", shiftKey: true, ctrlKey: true }, helper);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("ignoreInputs bindings fire even inside a text input (overlay toggle)", () => {
    const toggle = vi.fn();
    renderHook(() => useKeybindingDispatch({ "shortcuts-overlay": toggle }));
    const input = document.createElement("input");
    document.body.appendChild(input);
    press({ code: "Slash", shiftKey: true, ctrlKey: true }, input);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("honors overrides (rebound chord dispatches, default chord falls through)", () => {
    localStorage.setItem(
      KEYBINDINGS_STORAGE_KEY,
      JSON.stringify({ "window-next": { code: "KeyU", tier: "shifted" } }),
    );
    const next = vi.fn();
    renderHook(() => useKeybindingDispatch({ "window-next": next }));
    press({ code: "KeyL", shiftKey: true, ctrlKey: true });
    expect(next).not.toHaveBeenCalled();
    press({ code: "KeyU", shiftKey: true, ctrlKey: true });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("browser-reserved bindings never dispatch (jsdom is a browser host)", () => {
    const create = vi.fn();
    renderHook(() => useKeybindingDispatch({ "create-session": create }));
    const event = press({ code: "KeyN", shiftKey: true, ctrlKey: true });
    expect(create).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("unregisters on unmount", () => {
    const next = vi.fn();
    const { unmount } = renderHook(() => useKeybindingDispatch({ "window-next": next }));
    unmount();
    press({ code: "KeyL", shiftKey: true, ctrlKey: true });
    expect(next).not.toHaveBeenCalled();
  });
});

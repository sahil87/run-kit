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

  describe("scoped-beats-global precedence (260730-n789)", () => {
    // jsdom is a non-mac host, so recreate the mac ⌘[ shape via an override:
    // go-back (global) rebound onto the board pane-cycle's cmd+[ combo.
    const shareBracketLeft = () =>
      localStorage.setItem(
        KEYBINDINGS_STORAGE_KEY,
        JSON.stringify({ "go-back": { code: "BracketLeft", tier: "cmd" } }),
      );

    it("fires the scoped handler over the global one on a shared combo", () => {
      shareBracketLeft();
      const cyclePrev = vi.fn();
      const goBack = vi.fn();
      renderHook(() =>
        useKeybindingDispatch({ "board-cycle-prev": cyclePrev, "go-back": goBack }),
      );
      const event = press({ code: "BracketLeft", ctrlKey: true });
      expect(cyclePrev).toHaveBeenCalledTimes(1);
      expect(goBack).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
    });

    it("falls back to the global handler when the scoped match has none (paneless board)", () => {
      shareBracketLeft();
      const goBack = vi.fn();
      renderHook(() =>
        useKeybindingDispatch({ "board-cycle-prev": undefined, "go-back": goBack }),
      );
      press({ code: "BracketLeft", ctrlKey: true });
      expect(goBack).toHaveBeenCalledTimes(1);
    });

    it("falls through untouched when NO match has a handler", () => {
      shareBracketLeft();
      renderHook(() => useKeybindingDispatch({}));
      const event = press({ code: "BracketLeft", ctrlKey: true });
      expect(event.defaultPrevented).toBe(false);
    });

    it("a suppressed scoped match yields to a shared-chord ignoreInputs binding in an input", () => {
      // Rebind the scoped board pane-cycle onto the overlay's shifted+Slash
      // chord: in a text input the scoped match is suppressed (no
      // ignoreInputs) and must yield, letting the overlay toggle fire.
      localStorage.setItem(
        KEYBINDINGS_STORAGE_KEY,
        JSON.stringify({ "board-cycle-prev": { code: "Slash", tier: "shifted" } }),
      );
      const cyclePrev = vi.fn();
      const toggle = vi.fn();
      renderHook(() =>
        useKeybindingDispatch({ "board-cycle-prev": cyclePrev, "shortcuts-overlay": toggle }),
      );
      const input = document.createElement("input");
      document.body.appendChild(input);
      const event = press({ code: "Slash", shiftKey: true, ctrlKey: true }, input);
      expect(cyclePrev).not.toHaveBeenCalled();
      expect(toggle).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, renderHook, fireEvent, act } from "@testing-library/react";
import { useHoldToTalk } from "./use-hold-to-talk";

afterEach(() => {
  cleanup();
});

function setup(enabled = true) {
  const onHoldStart = vi.fn();
  const onHoldEnd = vi.fn();
  renderHook(() => useHoldToTalk({ enabled, onHoldStart, onHoldEnd }));
  return { onHoldStart, onHoldEnd };
}

function altSpaceDown(target: Window | HTMLElement = window, init: KeyboardEventInit = {}) {
  fireEvent.keyDown(target, { code: "Space", altKey: true, ...init });
}

describe("useHoldToTalk", () => {
  it("Alt+Space keydown starts the hold; the Space keyup ends it", () => {
    const { onHoldStart, onHoldEnd } = setup();
    act(() => altSpaceDown());
    expect(onHoldStart).toHaveBeenCalledTimes(1);
    expect(onHoldEnd).not.toHaveBeenCalled();
    act(() => fireEvent.keyUp(window, { code: "Space" }));
    expect(onHoldEnd).toHaveBeenCalledTimes(1);
  });

  it("preventDefaults the keydown (the macOS nbsp composition)", () => {
    setup();
    const event = new KeyboardEvent("keydown", {
      code: "Space",
      altKey: true,
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it("auto-repeated keydowns do not re-fire start", () => {
    const { onHoldStart } = setup();
    act(() => {
      altSpaceDown();
      altSpaceDown(window, { repeat: true });
      altSpaceDown(); // a stray non-repeat keydown while held is also ignored
    });
    expect(onHoldStart).toHaveBeenCalledTimes(1);
    act(() => fireEvent.keyUp(window, { code: "Space" }));
    act(() => {
      altSpaceDown();
    });
    expect(onHoldStart).toHaveBeenCalledTimes(2);
  });

  it("ignores the chord inside editable elements", () => {
    const { onHoldStart } = setup();
    const inputEl = document.createElement("input");
    const textarea = document.createElement("textarea");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    // jsdom implements neither contentEditable nor isContentEditable — define
    // the getter the shared suppression predicate reads.
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.append(inputEl, textarea, editable);
    act(() => {
      altSpaceDown(inputEl);
      altSpaceDown(textarea);
      altSpaceDown(editable);
    });
    expect(onHoldStart).not.toHaveBeenCalled();
  });

  it("fires from xterm's hidden helper textarea (the terminal's normal focus state)", () => {
    const { onHoldStart } = setup();
    const xterm = document.createElement("div");
    xterm.className = "xterm";
    const helper = document.createElement("textarea");
    xterm.append(helper);
    document.body.append(xterm);
    act(() => altSpaceDown(helper));
    expect(onHoldStart).toHaveBeenCalledTimes(1);
  });

  it("fires from the chat lens input (.rk-chat-input)", () => {
    const { onHoldStart } = setup();
    const chatInput = document.createElement("textarea");
    chatInput.className = "rk-chat-input";
    document.body.append(chatInput);
    act(() => altSpaceDown(chatInput));
    expect(onHoldStart).toHaveBeenCalledTimes(1);
  });

  it("requires exactly Alt — Meta/Ctrl/Shift or bare Space do not start", () => {
    const { onHoldStart } = setup();
    act(() => {
      altSpaceDown(window, { metaKey: true });
      altSpaceDown(window, { ctrlKey: true });
      altSpaceDown(window, { shiftKey: true });
      fireEvent.keyDown(window, { code: "Space" });
      fireEvent.keyDown(window, { code: "KeyA", altKey: true });
    });
    expect(onHoldStart).not.toHaveBeenCalled();
  });

  it("a window blur mid-hold ends it", () => {
    const { onHoldStart, onHoldEnd } = setup();
    act(() => altSpaceDown());
    expect(onHoldStart).toHaveBeenCalledTimes(1);
    act(() => fireEvent(window, new Event("blur")));
    expect(onHoldEnd).toHaveBeenCalledTimes(1);
    // The next hold starts cleanly after the blur-ended one.
    act(() => altSpaceDown());
    expect(onHoldStart).toHaveBeenCalledTimes(2);
  });

  it("a Space keyup without a hold is a no-op", () => {
    const { onHoldEnd } = setup();
    act(() => fireEvent.keyUp(window, { code: "Space" }));
    expect(onHoldEnd).not.toHaveBeenCalled();
  });

  it("mounts no listeners when disabled", () => {
    const { onHoldStart } = setup(false);
    act(() => altSpaceDown());
    expect(onHoldStart).not.toHaveBeenCalled();
  });

  it("unmount removes the listeners", () => {
    const onHoldStart = vi.fn();
    const { unmount } = renderHook(() =>
      useHoldToTalk({ enabled: true, onHoldStart, onHoldEnd: vi.fn() }),
    );
    unmount();
    act(() => altSpaceDown());
    expect(onHoldStart).not.toHaveBeenCalled();
  });
});

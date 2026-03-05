import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, fireEvent } from "@testing-library/react";
import { useKeyboardNav } from "@/hooks/use-keyboard-nav";

function pressKey(key: string, target?: HTMLElement) {
  fireEvent.keyDown(target ?? document, { key });
}

describe("useKeyboardNav", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("j increments focusedIndex", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useKeyboardNav({ itemCount: 3, onSelect }),
    );

    act(() => pressKey("j"));
    expect(result.current.focusedIndex).toBe(1);
  });

  it("j clamps at itemCount - 1", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useKeyboardNav({ itemCount: 3, onSelect }),
    );

    act(() => pressKey("j"));
    act(() => pressKey("j"));
    act(() => pressKey("j")); // should clamp at 2
    expect(result.current.focusedIndex).toBe(2);
  });

  it("k decrements focusedIndex", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useKeyboardNav({ itemCount: 3, onSelect }),
    );

    // Move to 1 first, then back to 0
    act(() => pressKey("j"));
    expect(result.current.focusedIndex).toBe(1);
    act(() => pressKey("k"));
    expect(result.current.focusedIndex).toBe(0);
  });

  it("k clamps at 0", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useKeyboardNav({ itemCount: 3, onSelect }),
    );

    act(() => pressKey("k")); // already at 0
    expect(result.current.focusedIndex).toBe(0);
  });

  it("Enter calls onSelect with current focusedIndex", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useKeyboardNav({ itemCount: 3, onSelect }),
    );

    act(() => pressKey("j")); // move to 1
    act(() => pressKey("Enter"));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("ignores keys when target is an input element", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useKeyboardNav({ itemCount: 3, onSelect }),
    );

    const input = document.createElement("input");
    document.body.appendChild(input);
    act(() => pressKey("j", input));
    expect(result.current.focusedIndex).toBe(0);
  });

  it("ignores keys when target is a textarea", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useKeyboardNav({ itemCount: 3, onSelect }),
    );

    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    act(() => pressKey("j", textarea));
    expect(result.current.focusedIndex).toBe(0);
  });

  it("ignores keys when target is contentEditable", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useKeyboardNav({ itemCount: 3, onSelect }),
    );

    const div = document.createElement("div");
    div.contentEditable = "true";
    // jsdom doesn't implement isContentEditable — polyfill for test
    Object.defineProperty(div, "isContentEditable", { value: true });
    document.body.appendChild(div);
    act(() => pressKey("j", div));
    expect(result.current.focusedIndex).toBe(0);
  });

  it("clamps focusedIndex when itemCount decreases", () => {
    const onSelect = vi.fn();
    const { result, rerender } = renderHook(
      ({ itemCount }) => useKeyboardNav({ itemCount, onSelect }),
      { initialProps: { itemCount: 5 } },
    );

    // Navigate to index 4
    act(() => pressKey("j"));
    act(() => pressKey("j"));
    act(() => pressKey("j"));
    act(() => pressKey("j"));
    expect(result.current.focusedIndex).toBe(4);

    // Decrease itemCount to 3 — should clamp to 2
    rerender({ itemCount: 3 });
    expect(result.current.focusedIndex).toBe(2);
  });

  it("invokes custom shortcuts on key press", () => {
    const onSelect = vi.fn();
    const handler = vi.fn();
    renderHook(() =>
      useKeyboardNav({
        itemCount: 3,
        onSelect,
        shortcuts: { x: handler },
      }),
    );

    act(() => pressKey("x"));
    expect(handler).toHaveBeenCalledOnce();
  });
});

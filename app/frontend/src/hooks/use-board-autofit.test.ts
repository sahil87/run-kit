import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useBoardAutofit,
  BOARD_AUTOFIT_LOCALSTORAGE_PREFIX,
} from "./use-board-autofit";

function key(board: string): string {
  return `${BOARD_AUTOFIT_LOCALSTORAGE_PREFIX}${board}`;
}

describe("useBoardAutofit", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to off when no preference is stored and does not write on read", () => {
    const { result } = renderHook(() => useBoardAutofit("boardA"));
    expect(result.current.autofit).toBe(false);
    // No write until the setter runs.
    expect(window.localStorage.getItem(key("boardA"))).toBeNull();
  });

  it("toggles on and persists the sentinel", () => {
    const { result } = renderHook(() => useBoardAutofit("boardA"));

    act(() => result.current.toggleAutofit());

    expect(result.current.autofit).toBe(true);
    expect(window.localStorage.getItem(key("boardA"))).toBe("on");
  });

  it("round-trips: a fresh hook instance reads the persisted on value", () => {
    const first = renderHook(() => useBoardAutofit("boardA"));
    act(() => first.result.current.toggleAutofit());
    first.unmount();

    const second = renderHook(() => useBoardAutofit("boardA"));
    expect(second.result.current.autofit).toBe(true);
  });

  it("toggling off removes the key (non-persistent off)", () => {
    const { result } = renderHook(() => useBoardAutofit("boardA"));
    act(() => result.current.toggleAutofit()); // on
    act(() => result.current.toggleAutofit()); // off
    expect(result.current.autofit).toBe(false);
    expect(window.localStorage.getItem(key("boardA"))).toBeNull();
  });

  it("isolates the preference per board", () => {
    const a = renderHook(() => useBoardAutofit("boardA"));
    act(() => a.result.current.toggleAutofit()); // boardA on

    const b = renderHook(() => useBoardAutofit("boardB"));
    expect(b.result.current.autofit).toBe(false); // boardB unaffected
    expect(a.result.current.autofit).toBe(true);
  });

  it("reloads state when the board argument changes", () => {
    // boardA on, boardB has no stored preference.
    window.localStorage.setItem(key("boardA"), "on");

    const { result, rerender } = renderHook(
      ({ board }: { board: string }) => useBoardAutofit(board),
      { initialProps: { board: "boardA" } },
    );
    expect(result.current.autofit).toBe(true);

    rerender({ board: "boardB" });
    expect(result.current.autofit).toBe(false);

    rerender({ board: "boardA" });
    expect(result.current.autofit).toBe(true);
  });

  it("reads a malformed stored value as off", () => {
    window.localStorage.setItem(key("boardA"), "garbage");
    const { result } = renderHook(() => useBoardAutofit("boardA"));
    expect(result.current.autofit).toBe(false);
  });
});

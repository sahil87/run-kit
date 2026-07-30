import { describe, it, expect, afterEach } from "vitest";
import { cleanup, renderHook, act } from "@testing-library/react";
import { useMacros } from "./use-macros";
import { MACROS_STORAGE_KEY, type MacroAction } from "@/lib/macros";
import { KEYBINDINGS_STORAGE_KEY } from "@/lib/keybindings";

const DISCUSS: MacroAction = {
  actionId: "macro:discuss",
  kind: "macro",
  label: "discuss",
  target: { type: "riff", preset: "discuss" },
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("useMacros", () => {
  it("hydrates from storage", () => {
    localStorage.setItem(MACROS_STORAGE_KEY, JSON.stringify([DISCUSS]));
    const { result } = renderHook(() => useMacros());
    expect(result.current.macros).toEqual([DISCUSS]);
  });

  it("addMacro persists, uniquifies the id, and re-renders", () => {
    const { result } = renderHook(() => useMacros());
    let first = "";
    let second = "";
    act(() => {
      first = result.current.addMacro("discuss", { type: "riff", preset: "discuss" });
    });
    act(() => {
      second = result.current.addMacro("discuss", { type: "riff", preset: "discuss" });
    });
    expect(first).toBe("macro:discuss");
    expect(second).toBe("macro:discuss-2");
    expect(result.current.macros).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem(MACROS_STORAGE_KEY) ?? "[]")).toHaveLength(2);
  });

  it("removeMacro drops the definition AND its keybindings diff entry", () => {
    localStorage.setItem(MACROS_STORAGE_KEY, JSON.stringify([DISCUSS]));
    localStorage.setItem(
      KEYBINDINGS_STORAGE_KEY,
      JSON.stringify({
        "macro:discuss": { code: "KeyD", tier: "shifted" },
        "window-next": { code: "KeyU", tier: "shifted" },
      }),
    );
    const { result } = renderHook(() => useMacros());
    act(() => {
      result.current.removeMacro("macro:discuss");
    });
    expect(result.current.macros).toEqual([]);
    expect(localStorage.getItem(MACROS_STORAGE_KEY)).toBeNull();
    // The unrelated builtin diff survives; the macro's is gone.
    expect(JSON.parse(localStorage.getItem(KEYBINDINGS_STORAGE_KEY) ?? "{}")).toEqual({
      "window-next": { code: "KeyU", tier: "shifted" },
    });
  });

  it("keeps sibling subscribers in sync within the tab", () => {
    const first = renderHook(() => useMacros());
    const second = renderHook(() => useMacros());
    act(() => {
      first.result.current.addMacro("loop", { type: "palette", paletteActionId: "create-window" });
    });
    expect(second.result.current.macros).toHaveLength(1);
  });

  it("re-syncs on the cross-tab storage event", () => {
    const { result } = renderHook(() => useMacros());
    act(() => {
      localStorage.setItem(MACROS_STORAGE_KEY, JSON.stringify([DISCUSS]));
      window.dispatchEvent(new StorageEvent("storage", { key: MACROS_STORAGE_KEY }));
    });
    expect(result.current.macros).toEqual([DISCUSS]);
  });
});

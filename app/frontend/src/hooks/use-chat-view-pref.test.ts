import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useChatViewPref,
  readChatViewPrefKey,
  CHAT_VIEW_LOCALSTORAGE_PREFIX,
} from "./use-chat-view-pref";

function key(server: string, windowId: string): string {
  return `${CHAT_VIEW_LOCALSTORAGE_PREFIX}${server}:${windowId}`;
}

describe("useChatViewPref", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to false (terminal) when no key is stored and does not write on read", () => {
    const { result } = renderHook(() => useChatViewPref("s", "@1"));
    expect(result.current.chatPref).toBe(false);
    expect(window.localStorage.getItem(key("s", "@1"))).toBeNull();
  });

  it("setChatPref(true) persists the sentinel", () => {
    const { result } = renderHook(() => useChatViewPref("s", "@1"));
    act(() => result.current.setChatPref(true));
    expect(result.current.chatPref).toBe(true);
    expect(window.localStorage.getItem(key("s", "@1"))).toBe("on");
  });

  it("setChatPref(false) removes the key (non-persistent off)", () => {
    const { result } = renderHook(() => useChatViewPref("s", "@1"));
    act(() => result.current.setChatPref(true));
    act(() => result.current.setChatPref(false));
    expect(result.current.chatPref).toBe(false);
    expect(window.localStorage.getItem(key("s", "@1"))).toBeNull();
  });

  it("isolates per (server, window)", () => {
    const a = renderHook(() => useChatViewPref("s", "@1"));
    act(() => a.result.current.setChatPref(true));
    const b = renderHook(() => useChatViewPref("s", "@2"));
    expect(b.result.current.chatPref).toBe(false);
    expect(a.result.current.chatPref).toBe(true);
  });

  it("reloads when the identity changes", () => {
    window.localStorage.setItem(key("s", "@1"), "on");
    const { result, rerender } = renderHook(
      ({ w }: { w: string }) => useChatViewPref("s", w),
      { initialProps: { w: "@1" } },
    );
    expect(result.current.chatPref).toBe(true);
    rerender({ w: "@2" });
    expect(result.current.chatPref).toBe(false);
  });

  it("reads a malformed stored value as off", () => {
    window.localStorage.setItem(key("s", "@1"), "garbage");
    const { result } = renderHook(() => useChatViewPref("s", "@1"));
    expect(result.current.chatPref).toBe(false);
  });
});

describe("readChatViewPrefKey", () => {
  beforeEach(() => window.localStorage.clear());

  it("non-reactively reads the stored sentinel", () => {
    expect(readChatViewPrefKey("s", "@1")).toBe(false);
    window.localStorage.setItem(key("s", "@1"), "on");
    expect(readChatViewPrefKey("s", "@1")).toBe(true);
  });
});

import { StrictMode } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { useOccludes } from "./use-occludes";
import { _resetForTests, count } from "@/lib/overlay-presence";

describe("useOccludes", () => {
  beforeEach(() => {
    _resetForTests();
  });
  afterEach(cleanup);

  it("acquires while open and releases when open turns false", () => {
    const { rerender } = renderHook(({ open }: { open: boolean }) => useOccludes("modal", open), {
      initialProps: { open: true },
    });
    expect(count("modal")).toBe(1);
    rerender({ open: false });
    expect(count("modal")).toBe(0);
  });

  it("does not acquire while closed and re-acquires on false → true", () => {
    const { rerender } = renderHook(({ open }: { open: boolean }) => useOccludes("modal", open), {
      initialProps: { open: false },
    });
    expect(count("modal")).toBe(0);
    rerender({ open: true });
    expect(count("modal")).toBe(1);
  });

  it("releases on unmount", () => {
    const { unmount } = renderHook(() => useOccludes("modal", true));
    expect(count("modal")).toBe(1);
    unmount();
    expect(count("modal")).toBe(0);
  });

  it("registers the kind it was given", () => {
    renderHook(() => useOccludes("transient", true));
    expect(count("transient")).toBe(1);
    expect(count("modal")).toBe(0);
  });

  it("settles at one registration under StrictMode's effect double-invocation", () => {
    const { unmount } = renderHook(() => useOccludes("modal", true), { wrapper: StrictMode });
    expect(count("modal")).toBe(1);
    unmount();
    expect(count("modal")).toBe(0);
  });
});

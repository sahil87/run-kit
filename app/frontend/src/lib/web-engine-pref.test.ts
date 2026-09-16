import { describe, it, expect, afterEach, vi } from "vitest";
import {
  WEB_NATIVE_ENGINE_DEFAULT,
  WEB_NATIVE_ENGINE_PREF_KEY,
  readNativeEnginePref,
  selectWebEngineKind,
} from "./web-engine-pref";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("selectWebEngineKind", () => {
  it("yields native only for (bridge present, preference on)", () => {
    expect(selectWebEngineKind(true, true)).toBe("native");
    expect(selectWebEngineKind(true, false)).toBe("iframe");
    expect(selectWebEngineKind(false, true)).toBe("iframe");
    expect(selectWebEngineKind(false, false)).toBe("iframe");
  });
});

describe("readNativeEnginePref", () => {
  it("returns the default when nothing is stored", () => {
    expect(readNativeEnginePref()).toBe(WEB_NATIVE_ENGINE_DEFAULT);
  });

  it("returns true/false for the stored forms", () => {
    localStorage.setItem(WEB_NATIVE_ENGINE_PREF_KEY, "true");
    expect(readNativeEnginePref()).toBe(true);
    localStorage.setItem(WEB_NATIVE_ENGINE_PREF_KEY, "false");
    expect(readNativeEnginePref()).toBe(false);
  });

  it("returns the default when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readNativeEnginePref()).toBe(WEB_NATIVE_ENGINE_DEFAULT);
  });
});

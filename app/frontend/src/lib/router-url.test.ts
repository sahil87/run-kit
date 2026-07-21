import { describe, expect, it } from "vitest";
// Import from the leaf module, NOT "./router" — the route tree transitively
// imports xterm's unicode-graphemes addon, whose import-time init is a
// documented CI flake ("Data error") that killed this suite before any test
// ran. The leaf import keeps this suite xterm-free by construction.
import {
  urlSegmentToWindowId,
  windowIdToUrlSegment,
  validateTerminalSearch,
} from "./router-url";

// The terminal route serializes the tmux window id (@N) as its numeric part
// only in the URL. These cover both directions of that mapping and the
// idempotency contract that keeps old %40N bookmarks resolving to @N (not @@N).
describe("window id ↔ URL segment mapping", () => {
  describe("windowIdToUrlSegment (stringify)", () => {
    it("strips the leading @", () => {
      expect(windowIdToUrlSegment("@0")).toBe("0");
    });

    it("handles multi-digit ids", () => {
      expect(windowIdToUrlSegment("@12")).toBe("12");
    });
  });

  describe("urlSegmentToWindowId (parse)", () => {
    it("prepends @ to a numeric segment", () => {
      expect(urlSegmentToWindowId("0")).toBe("@0");
    });

    it("handles multi-digit segments", () => {
      expect(urlSegmentToWindowId("12")).toBe("@12");
    });

    it("is idempotent — an already-prefixed segment (old %40N bookmark) is unchanged, never @@N", () => {
      expect(urlSegmentToWindowId("@0")).toBe("@0");
      expect(urlSegmentToWindowId("@12")).toBe("@12");
    });
  });

  it("round-trips @N → N → @N", () => {
    for (const id of ["@0", "@12", "@7"]) {
      expect(urlSegmentToWindowId(windowIdToUrlSegment(id))).toBe(id);
    }
  });
});

// The `?view=` param carries the per-viewer window-view lens (spec R2). `web`
// and `chat` are valid; any other/unknown value is DROPPED (treated as absent),
// never errored, so a stale/garbage deep link degrades to the default view.
describe("validateTerminalSearch (?view= drop)", () => {
  it("accepts view=web", () => {
    expect(validateTerminalSearch({ view: "web" })).toEqual({ view: "web" });
  });

  it("accepts view=chat", () => {
    expect(validateTerminalSearch({ view: "chat" })).toEqual({ view: "chat" });
  });

  it("drops an unknown value without throwing (?view=bogus → view undefined)", () => {
    expect(() => validateTerminalSearch({ view: "bogus" })).not.toThrow();
    expect(validateTerminalSearch({ view: "bogus" }).view).toBeUndefined();
  });

  it("drops a non-string view (?view=1 → view undefined)", () => {
    expect(validateTerminalSearch({ view: 1 }).view).toBeUndefined();
  });

  it("drops an absent param (no view) to an empty search", () => {
    expect(validateTerminalSearch({})).toEqual({});
    expect(validateTerminalSearch({ other: "x" }).view).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { urlSegmentToWindowId, windowIdToUrlSegment } from "./router";

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

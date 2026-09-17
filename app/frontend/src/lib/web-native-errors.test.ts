import { describe, it, expect } from "vitest";
import {
  reasonFromChromiumDescription,
  tileErrorForGuestFailure,
  tileErrorForGuestResponse,
  WEB_ERR_CONNECTION_REFUSED,
} from "./web-native-errors";

// The mapping proves the plan's error rules: a dead PROXY port (502 from the
// Go reverse proxy, or a refused/reset Chromium code on a proxy-kind tab) is
// a dead-port; any other main-frame failure is unreachable with Chromium's
// description as the reason; refused is never produced on this engine.

describe("tileErrorForGuestResponse", () => {
  it("maps a proxy-kind 502 to dead-port with the resolved port", () => {
    expect(tileErrorForGuestResponse(502, "http://localhost:3000")).toEqual({
      kind: "dead-port",
      port: 3000,
    });
    expect(tileErrorForGuestResponse(502, "/proxy/8080/docs")).toEqual({
      kind: "dead-port",
      port: 8080,
    });
  });

  it("clears the surface on any other status and on non-proxy kinds", () => {
    expect(tileErrorForGuestResponse(200, "http://localhost:3000")).toBeNull();
    expect(tileErrorForGuestResponse(404, "/proxy/8080")).toBeNull();
    // A real site's own 502 is page content, not tile chrome.
    expect(tileErrorForGuestResponse(502, "https://github.com/x")).toBeNull();
  });
});

describe("tileErrorForGuestFailure", () => {
  it("maps connection-refused on a proxy-kind tab to dead-port", () => {
    expect(
      tileErrorForGuestFailure(
        { code: WEB_ERR_CONNECTION_REFUSED, description: "ERR_CONNECTION_REFUSED", url: "http://localhost:3000/" },
        "http://localhost:3000",
      ),
    ).toEqual({ kind: "dead-port", port: 3000 });
  });

  it("maps a refused/reset code on a NON-proxy tab to unreachable (the kind decides, not the code)", () => {
    const error = tileErrorForGuestFailure(
      { code: WEB_ERR_CONNECTION_REFUSED, description: "ERR_CONNECTION_REFUSED", url: "https://down.example/" },
      "https://down.example",
    );
    expect(error.kind).toBe("unreachable");
  });

  it("maps a name-resolution failure on an external tab to unreachable with the transformed reason", () => {
    expect(
      tileErrorForGuestFailure(
        { code: -105, description: "ERR_NAME_NOT_RESOLVED", url: "https://nope.example/" },
        "https://nope.example",
      ),
    ).toEqual({ kind: "unreachable", host: "nope.example", reason: "name not resolved" });
  });

  it("falls back to the raw url when the failed url does not parse", () => {
    const error = tileErrorForGuestFailure(
      { code: -3, description: "ERR_ABORTED_LIKE", url: "not a url" },
      "https://example.com",
    );
    expect(error).toEqual({ kind: "unreachable", host: "not a url", reason: "aborted like" });
  });

  it("never produces the refused kind (Chromium renders refusing sites)", () => {
    const kinds = [
      tileErrorForGuestFailure({ code: -105, description: "X", url: "https://x" }, "https://x"),
      tileErrorForGuestResponse(502, "/proxy/1"),
    ];
    for (const error of kinds) expect(error?.kind).not.toBe("refused");
  });
});

describe("reasonFromChromiumDescription", () => {
  it("strips ERR_, lowercases, and turns underscores into spaces", () => {
    expect(reasonFromChromiumDescription("ERR_NAME_NOT_RESOLVED")).toBe("name not resolved");
    expect(reasonFromChromiumDescription("ERR_CONNECTION_TIMED_OUT")).toBe("connection timed out");
  });

  it("keeps a description without the ERR_ prefix", () => {
    expect(reasonFromChromiumDescription("socket hangup")).toBe("socket hangup");
  });

  it("yields the generic reason for an empty (or stripped-to-empty) description", () => {
    expect(reasonFromChromiumDescription("")).toBe("load failed");
    expect(reasonFromChromiumDescription("ERR_")).toBe("load failed");
  });
});

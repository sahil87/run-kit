import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  availableViews,
  defaultView,
  resolveView,
  nextView,
  shouldSuppressViewChord,
  windowViewStorageKey,
  readStoredView,
  writeStoredView,
  type ViewWindow,
} from "./window-view";

const iframeWithUrl: ViewWindow = { rkType: "iframe", rkUrl: "http://localhost:8080" };
const iframeNoUrl: ViewWindow = { rkType: "iframe", rkUrl: "" };
const plainWithUrl: ViewWindow = { rkUrl: "http://localhost:3000" };
const plain: ViewWindow = {};

describe("availableViews", () => {
  it("offers tty + web when rkUrl is set (any rkType)", () => {
    expect(availableViews(iframeWithUrl)).toEqual(["web", "tty"]);
    expect(availableViews(plainWithUrl)).toEqual(["web", "tty"]);
  });

  it("offers tty ONLY when rkUrl is empty, even for an iframe-typed window", () => {
    expect(availableViews(iframeNoUrl)).toEqual(["tty"]);
    expect(availableViews(plain)).toEqual(["tty"]);
  });

  it("tolerates null/undefined windows (tty only)", () => {
    expect(availableViews(null)).toEqual(["tty"]);
    expect(availableViews(undefined)).toEqual(["tty"]);
  });
});

describe("defaultView", () => {
  it("defaults an iframe-typed window WITH a url to web (the demoted hint)", () => {
    expect(defaultView(iframeWithUrl)).toBe("web");
  });

  it("defaults a plain window to tty", () => {
    expect(defaultView(plain)).toBe("tty");
    expect(defaultView(null)).toBe("tty");
  });

  it("defaults an iframe-typed window WITHOUT a url to tty (web not available)", () => {
    expect(defaultView(iframeNoUrl)).toBe("tty");
  });

  it("defaults a plain-typed window WITH a url to tty (iframe hint absent)", () => {
    // rkUrl makes web AVAILABLE, but the default hint requires rkType==="iframe".
    expect(defaultView(plainWithUrl)).toBe("tty");
  });
});

describe("resolveView precedence: URL -> localStorage -> default, unavailable -> tty", () => {
  it("uses the URL param when that view is available", () => {
    expect(resolveView("web", undefined, iframeWithUrl)).toBe("web");
    expect(resolveView("tty", "web", iframeWithUrl)).toBe("tty");
  });

  it("falls through an UNAVAILABLE URL param (web on a no-url window) to tty", () => {
    expect(resolveView("web", undefined, iframeNoUrl)).toBe("tty");
    expect(resolveView("web", undefined, plain)).toBe("tty");
  });

  it("uses localStorage when there is no URL param and the stored view is available", () => {
    expect(resolveView(undefined, "web", iframeWithUrl)).toBe("web");
    expect(resolveView(undefined, "tty", iframeWithUrl)).toBe("tty");
  });

  it("ignores an UNAVAILABLE stored value and falls to the default", () => {
    // stored "web" but no url -> web unavailable -> default (tty).
    expect(resolveView(undefined, "web", iframeNoUrl)).toBe("tty");
  });

  it("falls to the window default when neither URL nor localStorage decide", () => {
    expect(resolveView(undefined, undefined, iframeWithUrl)).toBe("web");
    expect(resolveView(undefined, undefined, plain)).toBe("tty");
    expect(resolveView(undefined, undefined, plainWithUrl)).toBe("tty");
  });

  it("treats unknown/garbage strings as absent (never throws, never renders them)", () => {
    expect(resolveView("bogus", "nonsense", iframeWithUrl)).toBe("web"); // both invalid -> default
    expect(resolveView("bogus", "web", iframeWithUrl)).toBe("web"); // URL invalid, stored valid
  });
});

describe("nextView (Cmd/Ctrl+. cycle)", () => {
  // availableViews returns HINT_ORDER (["web","tty"]); the observable cycle is
  // tty→web→tty for the two-view case.
  it("cycles tty→web→tty over the available list", () => {
    expect(nextView(["web", "tty"], "tty")).toBe("web");
    expect(nextView(["web", "tty"], "web")).toBe("tty");
  });

  it("is a no-op (null) for a single-view window", () => {
    expect(nextView(["tty"], "tty")).toBeNull();
  });

  it("is a no-op (null) when the current view is not available (defensive)", () => {
    expect(nextView(["tty"], "web")).toBeNull();
    expect(nextView([], "tty")).toBeNull();
  });
});

describe("shouldSuppressViewChord (non-xterm input gating)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("does NOT suppress on a null / non-element target", () => {
    expect(shouldSuppressViewChord(null)).toBe(false);
    expect(shouldSuppressViewChord(new EventTarget())).toBe(false);
  });

  it("suppresses on a real (non-xterm) INPUT / TEXTAREA / contenteditable", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.append(input, textarea, editable);
    expect(shouldSuppressViewChord(input)).toBe(true);
    expect(shouldSuppressViewChord(textarea)).toBe(true);
    expect(shouldSuppressViewChord(editable)).toBe(true);
  });

  it("does NOT suppress on xterm's own helper textarea (the terminal's normal focus)", () => {
    const xterm = document.createElement("div");
    xterm.className = "xterm";
    const helper = document.createElement("textarea");
    xterm.appendChild(helper);
    document.body.appendChild(xterm);
    // The helper textarea lives inside `.xterm`, so the chord must pass through.
    expect(shouldSuppressViewChord(helper)).toBe(false);
  });

  it("does NOT suppress on a plain non-input element", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    expect(shouldSuppressViewChord(div)).toBe(false);
  });
});

describe("localStorage helpers (value-bearing key, try/catch-noop)", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("builds a value-bearing per-window key", () => {
    expect(windowViewStorageKey("srv", "@3")).toBe("runkit-window-view:srv:@3");
  });

  it("round-trips a stored view", () => {
    expect(readStoredView("srv", "@3")).toBeUndefined();
    writeStoredView("srv", "@3", "web");
    expect(readStoredView("srv", "@3")).toBe("web");
    writeStoredView("srv", "@3", "tty");
    expect(readStoredView("srv", "@3")).toBe("tty");
  });

  it("scopes keys per (server, windowId)", () => {
    writeStoredView("srv", "@3", "web");
    expect(readStoredView("srv", "@4")).toBeUndefined();
    expect(readStoredView("other", "@3")).toBeUndefined();
  });

  it("swallows a localStorage read failure, returning undefined", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readStoredView("srv", "@3")).toBeUndefined();
  });

  it("swallows a localStorage write failure (no throw)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => writeStoredView("srv", "@3", "web")).not.toThrow();
  });
});

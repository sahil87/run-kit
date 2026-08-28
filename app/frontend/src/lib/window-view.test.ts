import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  hasWebUrl,
  hasChat,
  availableViews,
  defaultView,
  windowViewStorageKey,
  readStoredView,
  type ViewWindow,
} from "./window-view";

const iframeWithUrl: ViewWindow = { rkType: "iframe", rkUrl: "http://localhost:8080" };
const iframeNoUrl: ViewWindow = { rkType: "iframe", rkUrl: "" };
const iframeWhitespaceUrl: ViewWindow = { rkType: "iframe", rkUrl: "  \t " };
const plainWithUrl: ViewWindow = { rkUrl: "http://localhost:3000" };
const plainWhitespaceUrl: ViewWindow = { rkUrl: "   " };
const plain: ViewWindow = {};
const chatWin: ViewWindow = { chatProvider: "claude" };
const chatAndWebWin: ViewWindow = { chatProvider: "claude", rkUrl: "http://localhost:8080" };
const chatEmptyProvider: ViewWindow = { chatProvider: "" };

describe("hasWebUrl", () => {
  it("is true only for a non-whitespace rkUrl", () => {
    expect(hasWebUrl(iframeWithUrl)).toBe(true);
    expect(hasWebUrl(plainWithUrl)).toBe(true);
  });

  it("is false for empty, whitespace-only, or missing rkUrl", () => {
    expect(hasWebUrl(iframeNoUrl)).toBe(false);
    expect(hasWebUrl(iframeWhitespaceUrl)).toBe(false);
    expect(hasWebUrl(plainWhitespaceUrl)).toBe(false);
    expect(hasWebUrl(plain)).toBe(false);
    expect(hasWebUrl(null)).toBe(false);
    expect(hasWebUrl(undefined)).toBe(false);
  });
});

describe("hasChat", () => {
  it("is true only for a non-empty chatProvider", () => {
    expect(hasChat(chatWin)).toBe(true);
    expect(hasChat(chatAndWebWin)).toBe(true);
  });

  it("is false for empty/missing chatProvider", () => {
    expect(hasChat(chatEmptyProvider)).toBe(false);
    expect(hasChat(plain)).toBe(false);
    expect(hasChat(null)).toBe(false);
    expect(hasChat(undefined)).toBe(false);
  });
});

describe("availableViews", () => {
  it("offers tty + web when rkUrl is set (any rkType)", () => {
    expect(availableViews(iframeWithUrl)).toEqual(["web", "tty"]);
    expect(availableViews(plainWithUrl)).toEqual(["web", "tty"]);
  });

  it("always offers web, even with no rkUrl — availability is unconditional; hasWebUrl selects content", () => {
    expect(availableViews(iframeNoUrl)).toEqual(["web", "tty"]);
    expect(availableViews(plain)).toEqual(["web", "tty"]);
  });

  it("offers web for a whitespace-only rkUrl — onboarding content, never a blank-src iframe", () => {
    // `@rk_win_url` can be set to whitespace via external `tmux set-option`;
    // hasWebUrl's `.trim()` keeps it reading as onboarding content.
    expect(availableViews(iframeWhitespaceUrl)).toEqual(["web", "tty"]);
    expect(availableViews(plainWhitespaceUrl)).toEqual(["web", "tty"]);
  });

  it("offers chat + web + tty when chatProvider is set", () => {
    expect(availableViews(chatWin)).toEqual(["chat", "web", "tty"]);
  });

  it("ignores an empty chatProvider", () => {
    expect(availableViews(chatEmptyProvider)).toEqual(["web", "tty"]);
  });

  it("stacks chat + web + tty in registry order (chat > web > tty)", () => {
    // Capabilities are orthogonal and stack (spec R5); the order is HINT_ORDER.
    expect(availableViews(chatAndWebWin)).toEqual(["chat", "web", "tty"]);
  });

  it("tolerates null/undefined windows", () => {
    expect(availableViews(null)).toEqual(["web", "tty"]);
    expect(availableViews(undefined)).toEqual(["web", "tty"]);
  });

  // The `code` lens (260811-k3vp, availability simplified by 260811-a2bo):
  // available exactly when the window's gitRoot derived — the one stable
  // capability signal (the port resolves by convention; reachability governs
  // content, not availability).
  it("offers code when gitRoot is set", () => {
    const codeWin: ViewWindow = { gitRoot: "/repo" };
    expect(availableViews(codeWin)).toEqual(["code", "web", "tty"]);
  });

  it("gates code off without a gitRoot", () => {
    expect(availableViews(plain)).toEqual(["web", "tty"]);
    expect(availableViews(null)).toEqual(["web", "tty"]);
  });

  it("stacks chat + code + web + tty in registry order", () => {
    const all: ViewWindow = { chatProvider: "claude", gitRoot: "/repo", rkUrl: "http://localhost:8080" };
    expect(availableViews(all)).toEqual(["chat", "code", "web", "tty"]);
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

  it("defaults an iframe-typed window WITHOUT a url to tty (the hint requires a URL)", () => {
    expect(defaultView(iframeNoUrl)).toBe("tty");
  });

  it("defaults an iframe-typed window with a WHITESPACE url to tty (not web)", () => {
    // Consistent with hasWebUrl: a whitespace `@rk_win_url` is onboarding content,
    // so the legacy iframe-typed default hint must not fire.
    expect(defaultView(iframeWhitespaceUrl)).toBe("tty");
  });

  it("defaults a plain-typed window WITH a url to tty (iframe hint absent)", () => {
    // rkUrl makes web AVAILABLE, but the default hint requires rkType==="iframe".
    expect(defaultView(plainWithUrl)).toBe("tty");
  });

  it("defaults a chat-capable window to tty (chat contributes NO default hint)", () => {
    // A chat-capable window still defaults to the terminal unless the viewer
    // chose chat (preserves #351's terminal-default). Chat is in HINT_ORDER for
    // capability ordering only, not as a default hint.
    expect(defaultView(chatWin)).toBe("tty");
  });

  it("defaults a chat+web window to web (only the iframe hint fires)", () => {
    // No `rkType=iframe`, so even the web hint doesn't fire → tty.
    expect(defaultView(chatAndWebWin)).toBe("tty");
    // With the iframe type, the web hint wins (chat still contributes none).
    expect(defaultView({ ...chatAndWebWin, rkType: "iframe" })).toBe("web");
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

  it("reads a stored view under the window's key (absent = undefined)", () => {
    expect(readStoredView("srv", "@3")).toBeUndefined();
    localStorage.setItem(windowViewStorageKey("srv", "@3"), "web");
    expect(readStoredView("srv", "@3")).toBe("web");
    localStorage.setItem(windowViewStorageKey("srv", "@3"), "tty");
    expect(readStoredView("srv", "@3")).toBe("tty");
  });

  it("scopes keys per (server, windowId)", () => {
    localStorage.setItem(windowViewStorageKey("srv", "@3"), "web");
    expect(readStoredView("srv", "@4")).toBeUndefined();
    expect(readStoredView("other", "@3")).toBeUndefined();
  });

  it("swallows a localStorage read failure, returning undefined", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readStoredView("srv", "@3")).toBeUndefined();
  });
});

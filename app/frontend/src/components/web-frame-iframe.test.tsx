import { describe, it, expect, vi, afterEach, beforeEach, type Mock } from "vitest";
import { act, render, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { WebFrameIframe } from "./web-frame-iframe";
import type {
  FrameChromeState,
  WebFrameEngineHandle,
  WebFrameEngineProps,
} from "@/lib/web-frame-engine";

// Mock the API client: the engine's frame-refusal probe (`checkFrame`,
// external URLs) is stubbed embeddable by default so plain renders run no
// probe-driven error state; individual cases override the resolution.
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ApiError: actual.ApiError,
    checkFrame: vi.fn().mockResolvedValue({ reachable: true, embeddable: true, status: 200, reason: "" }),
  };
});

import { checkFrame } from "@/api/client";

interface Rig {
  url: string;
  states: Map<string, FrameChromeState>;
  handles: Map<string, WebFrameEngineHandle>;
  onState: Mock<(url: string, state: FrameChromeState) => void>;
  onLoad: Mock<(url: string) => void>;
  interactRef: { current: (() => void) | undefined };
  reclaimRef: { current: ((e: KeyboardEvent) => boolean) | undefined };
}

/** Render the engine directly behind a recording harness: the latest
 *  reported state per URL lands in `states`, the registered command handle
 *  in `handles`. The late-bindable seams are the harness's own refs —
 *  mutating `.current` after mount exercises the late-binding contract. */
function renderEngine({
  url = "http://localhost:8080/docs",
  active = true,
  zoom = 1,
  onInteract,
  shouldReclaimChord,
}: {
  url?: string;
  active?: boolean;
  zoom?: number;
  onInteract?: () => void;
  shouldReclaimChord?: (e: KeyboardEvent) => boolean;
} = {}) {
  const rig: Rig = {
    url,
    states: new Map(),
    handles: new Map(),
    onState: vi.fn<(url: string, state: FrameChromeState) => void>(),
    onLoad: vi.fn<(url: string) => void>(),
    interactRef: { current: onInteract },
    reclaimRef: { current: shouldReclaimChord },
  };
  const props = (overrides: Partial<WebFrameEngineProps> = {}): WebFrameEngineProps => ({
    url,
    active,
    zoom,
    wireGestureListeners: () => () => {},
    onState: (u, s) => {
      rig.onState(u, s);
      rig.states.set(u, s);
    },
    onLoad: rig.onLoad,
    registerHandle: (u, h) => rig.handles.set(u, h),
    unregisterHandle: (u) => rig.handles.delete(u),
    interactRef: rig.interactRef,
    reclaimRef: rig.reclaimRef,
    ...overrides,
  });
  const view = render(<WebFrameIframe {...props()} />);
  return { ...view, rig, rerenderEngine: (overrides: Partial<WebFrameEngineProps> = {}) =>
    view.rerender(<WebFrameIframe {...props(overrides)} />) };
}

const getIframe = () => screen.getByTitle("Proxied content") as HTMLIFrameElement;

/** Swap in a fresh same-origin frame document carrying `html` and fire
 *  `load` — the attach seam's re-attach path (jsdom's initial frame
 *  document is bare, so we shadow the whole contentDocument). */
function seedFrameDocument(html: string) {
  const doc = document.implementation.createHTMLDocument();
  doc.body.innerHTML = html;
  Object.defineProperty(getIframe(), "contentDocument", {
    value: doc,
    configurable: true,
  });
  fireEvent.load(getIframe());
}

/** Simulate cross-origin: contentDocument/contentWindow access throws. */
function shadowCrossOrigin(iframe: HTMLIFrameElement) {
  Object.defineProperty(iframe, "contentDocument", {
    get() {
      throw new Error("cross-origin");
    },
    configurable: true,
  });
  Object.defineProperty(iframe, "contentWindow", {
    get() {
      throw new Error("cross-origin");
    },
    configurable: true,
  });
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WebFrameIframe render + reporting", () => {
  it("renders the iframe with the proxied src, the chrome-hidden-active class rule, and the sandbox list", () => {
    renderEngine({ url: "http://localhost:8080/docs" });
    const iframe = getIframe();
    expect(iframe.src).toContain("/proxy/8080/docs");
    expect(iframe.className).toContain("border-0");
    expect(iframe.getAttribute("sandbox")).toBe(
      "allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads",
    );
    expect(iframe.hasAttribute("hidden")).toBe(false);
  });

  it("mints an own-origin (app:) src per viewer and embeds it without a refusal state", () => {
    renderEngine({ url: "app:4295/file2/editor" });
    const iframe = getIframe();
    // localhost viewer host → {port}.localhost subdomain (mintAppSrc), NOT /proxy.
    expect(iframe.src).toContain("4295.localhost");
    expect(iframe.src).toContain("/file2/editor");
    expect(iframe.src).not.toContain("/proxy/");
    // app kind skips the cross-origin frame-check, so the tile embeds (not hidden
    // by a refused error state).
    expect(iframe.className).not.toContain("hidden");
    expect(iframe.hasAttribute("hidden")).toBe(false);
  });

  it("an inactive frame renders hidden with the plain style regardless of zoom", () => {
    renderEngine({ url: "http://localhost:8080/docs", active: false, zoom: 1.25 });
    const iframe = getIframe();
    expect(iframe.hasAttribute("hidden")).toBe(true);
    expect(iframe.style.transform).toBe("");
    expect(iframe.style.width).toBe("100%");
  });

  it("applies the compensated scale style at zoom ≠ 1 and the plain style at zoom 1", () => {
    const { rerenderEngine } = renderEngine({ url: "http://localhost:8080/docs" });
    const iframe = getIframe();
    expect(iframe.style.transform).toBe("");
    expect(iframe.style.width).toBe("100%");
    rerenderEngine({ zoom: 1.25 });
    expect(iframe.style.transform).toBe("scale(1.25)");
    expect(iframe.style.width).toBe(`${100 / 1.25}%`);
    expect(iframe.style.height).toBe(`${100 / 1.25}%`);
  });

  it("reports loading on mount and clears it on the frame's load event", () => {
    const { rig } = renderEngine();
    expect(rig.states.get(rig.url)!.loading).toBe(true);
    fireEvent.load(getIframe());
    expect(rig.states.get(rig.url)!.loading).toBe(false);
  });

  it("same-origin attach reports history/find/meta/zoomGestures true, devtools false, and both history flags mirroring history", () => {
    const { rig } = renderEngine();
    fireEvent.load(getIframe());
    const state = rig.states.get(rig.url)!;
    expect(state.supports).toEqual({
      history: true,
      find: true,
      meta: true,
      zoomGestures: true,
      devtools: false,
    });
    expect(state.canGoBack).toBe(true);
    expect(state.canGoForward).toBe(true);
    expect(state.loading).toBe(false);
  });

  it("a cross-origin attach reports all five capability flags false and nulls the meta fields", () => {
    const { rig } = renderEngine();
    shadowCrossOrigin(getIframe());
    fireEvent.load(getIframe());
    const state = rig.states.get(rig.url)!;
    expect(state.supports).toEqual({
      history: false,
      find: false,
      meta: false,
      zoomGestures: false,
      devtools: false,
    });
    expect(state.canGoBack).toBe(false);
    expect(state.canGoForward).toBe(false);
    expect(state.title).toBeNull();
    expect(state.favicon).toBeNull();
    expect(state.trackedLocation).toBeNull();
  });

  it("reports title, favicon, and tracked location from the same-origin document, then clears them on a cross-origin navigation", () => {
    const { rig } = renderEngine({ url: "/proxy/3001/docs" });
    const iframe = getIframe();
    const doc = iframe.contentDocument!;
    const html = doc.documentElement ?? doc.appendChild(doc.createElement("html"));
    const head = doc.head ?? doc.createElement("head");
    if (!doc.head) html.prepend(head);
    doc.title = "Project docs";
    const icon = doc.createElement("link");
    icon.rel = "icon";
    icon.href = `${window.location.origin}/assets/project-icon.svg`;
    head.append(icon);
    Object.defineProperty(iframe, "contentWindow", {
      value: {
        location: {
          href: `${window.location.origin}/proxy/3001/docs`,
          origin: window.location.origin,
          pathname: "/proxy/3001/docs",
          search: "",
          hash: "",
        },
      },
      configurable: true,
    });
    fireEvent.load(iframe);
    const loaded = rig.states.get(rig.url)!;
    expect(loaded.title).toBe("Project docs");
    expect(loaded.favicon).toBe(`${window.location.origin}/assets/project-icon.svg`);
    expect(loaded.trackedLocation).toBe("/proxy/3001/docs");

    shadowCrossOrigin(iframe);
    fireEvent.load(iframe);
    const cleared = rig.states.get(rig.url)!;
    expect(cleared.title).toBeNull();
    expect(cleared.favicon).toBeNull();
    expect(cleared.trackedLocation).toBeNull();
  });
});

// Interaction seam: parent-document listeners never hear in-frame clicks
// (events stay in the frame's document; focus entering it fires no focusin
// in the parent), so the engine reports them via the interactRef seam —
// contentDocument listeners same-origin, window-blur fallback cross-origin.
describe("onInteract seam", () => {
  it("fires on pointerdown and keydown inside the frame document", () => {
    const onInteract = vi.fn();
    renderEngine({ onInteract });
    const doc = getIframe().contentDocument!;
    doc.dispatchEvent(new Event("pointerdown"));
    expect(onInteract).toHaveBeenCalledTimes(1);
    doc.dispatchEvent(new Event("keydown"));
    expect(onInteract).toHaveBeenCalledTimes(2);
  });

  it("a same-document load does not double-attach; a replaced document is re-attached", () => {
    const onInteract = vi.fn();
    renderEngine({ onInteract });
    const iframe = getIframe();
    const doc = iframe.contentDocument!;

    // Same document across a load: still exactly one listener pair.
    fireEvent.load(iframe);
    doc.dispatchEvent(new Event("pointerdown"));
    expect(onInteract).toHaveBeenCalledTimes(1);

    // A navigation replaces the document — simulate by shadowing the
    // instance getter with a fresh document, then firing load.
    const freshDoc = document.implementation.createHTMLDocument();
    Object.defineProperty(iframe, "contentDocument", {
      value: freshDoc,
      configurable: true,
    });
    fireEvent.load(iframe);
    freshDoc.dispatchEvent(new Event("keydown"));
    expect(onInteract).toHaveBeenCalledTimes(2);
  });

  it("blur fallback fires only when the iframe is the active element, and dies on unmount", () => {
    const onInteract = vi.fn();
    const { unmount } = renderEngine({ onInteract });
    const iframe = getIframe();

    // Focus elsewhere at blur: no report.
    fireEvent.blur(window);
    expect(onInteract).not.toHaveBeenCalled();

    Object.defineProperty(document, "activeElement", {
      value: iframe,
      configurable: true,
    });
    try {
      fireEvent.blur(window);
      expect(onInteract).toHaveBeenCalledTimes(1);

      unmount();
      fireEvent.blur(window);
      expect(onInteract).toHaveBeenCalledTimes(1);
    } finally {
      delete (document as { activeElement?: Element | null }).activeElement;
    }
  });

  it("reports nothing and errors nothing when the seam is unbound", () => {
    renderEngine();
    const iframe = getIframe();
    expect(() => {
      iframe.contentDocument!.dispatchEvent(new Event("pointerdown"));
      fireEvent.load(iframe);
      fireEvent.blur(window);
    }).not.toThrow();
  });

  it("a handler supplied after mount reports (hidden tile with slot -1 becoming visible)", () => {
    const onInteract = vi.fn();
    const { rig } = renderEngine();
    rig.interactRef.current = onInteract;
    getIframe().contentDocument!.dispatchEvent(new Event("pointerdown"));
    expect(onInteract).toHaveBeenCalledTimes(1);
  });

  it("unmount removes the frame-document listeners", () => {
    const onInteract = vi.fn();
    const { unmount } = renderEngine({ onInteract });
    const doc = getIframe().contentDocument!;
    unmount();
    doc.dispatchEvent(new Event("pointerdown"));
    doc.dispatchEvent(new Event("keydown"));
    expect(onInteract).not.toHaveBeenCalled();
  });
});

// Chord reclaim (260819-ie2i R1): the seam reports onInteract first, then
// consumes ONLY predicate-matching chords in the frame and re-dispatches a
// synthetic bubbling keydown on the parent document.
describe("chord reclaim seam", () => {
  it("a matching chord is prevented in the frame and re-dispatched on the parent document", () => {
    const onInteract = vi.fn();
    renderEngine({ onInteract, shouldReclaimChord: (e) => e.code === "KeyK" });
    const parentReceived = vi.fn();
    document.addEventListener("keydown", parentReceived);
    try {
      const doc = getIframe().contentDocument!;
      const event = new KeyboardEvent("keydown", {
        key: "k",
        code: "KeyK",
        metaKey: true,
        cancelable: true,
      });
      doc.dispatchEvent(event);
      // onInteract reported first; the frame's event was consumed…
      expect(onInteract).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
      // …and a synthetic copy (key/code/modifiers, bubbling) landed on the
      // parent document.
      expect(parentReceived).toHaveBeenCalledTimes(1);
      const synthetic = parentReceived.mock.calls[0][0] as KeyboardEvent;
      expect(synthetic.code).toBe("KeyK");
      expect(synthetic.metaKey).toBe(true);
      expect(synthetic.bubbles).toBe(true);
    } finally {
      document.removeEventListener("keydown", parentReceived);
    }
  });

  it("a non-matching keydown passes through untouched (no prevent, no re-dispatch)", () => {
    const onInteract = vi.fn();
    renderEngine({ onInteract, shouldReclaimChord: () => false });
    const parentReceived = vi.fn();
    document.addEventListener("keydown", parentReceived);
    try {
      const doc = getIframe().contentDocument!;
      const event = new KeyboardEvent("keydown", {
        key: "a",
        code: "KeyA",
        cancelable: true,
      });
      doc.dispatchEvent(event);
      expect(onInteract).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(false);
      expect(parentReceived).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", parentReceived);
    }
  });

  it("without the predicate the seam stays report-only (legacy behavior)", () => {
    const onInteract = vi.fn();
    renderEngine({ onInteract });
    const parentReceived = vi.fn();
    document.addEventListener("keydown", parentReceived);
    try {
      const doc = getIframe().contentDocument!;
      const event = new KeyboardEvent("keydown", {
        key: "k",
        code: "KeyK",
        metaKey: true,
        cancelable: true,
      });
      doc.dispatchEvent(event);
      expect(onInteract).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(false);
      expect(parentReceived).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", parentReceived);
    }
  });
});

describe("error-state probes", () => {
  it("a probed-blocked external URL reports the refused tile error and hides the frame", async () => {
    vi.mocked(checkFrame).mockResolvedValue({
      reachable: true,
      embeddable: false,
      status: 200,
      reason: "X-Frame-Options: DENY",
    });
    const { rig } = renderEngine({ url: "https://github.com/sahil87/run-kit" });
    await waitFor(() =>
      expect(rig.states.get(rig.url)?.tileError).toEqual({
        kind: "refused",
        host: "github.com",
        reason: "X-Frame-Options: DENY",
      }),
    );
    expect(rig.states.get(rig.url)!.loading).toBe(false);
    // The iframe is hidden while the error renders over it.
    expect(getIframe().className).toContain("hidden");
  });

  it("an unreachable external URL reports the unreachable tile error", async () => {
    vi.mocked(checkFrame).mockResolvedValue({
      reachable: false,
      embeddable: false,
      status: 0,
      reason: "connect failed: connection refused",
    });
    const { rig } = renderEngine({ url: "https://dead.example/" });
    await waitFor(() =>
      expect(rig.states.get(rig.url)?.tileError).toEqual({
        kind: "unreachable",
        host: "dead.example",
        reason: "connect failed: connection refused",
      }),
    );
    expect(rig.states.get(rig.url)!.loading).toBe(false);
  });

  it("a 502 from the proxied fetch reports the dead-port tile error; the handle's retry re-runs detection", async () => {
    const fetchStub = vi.fn().mockResolvedValue({ status: 502 });
    vi.stubGlobal("fetch", fetchStub);
    try {
      const { rig } = renderEngine({ url: "/proxy/8080/" });
      await waitFor(() =>
        expect(rig.states.get(rig.url)?.tileError).toEqual({ kind: "dead-port", port: 8080 }),
      );
      // Retry re-runs detection (and re-reports the error while 502 persists).
      fetchStub.mockClear();
      act(() => rig.handles.get(rig.url)!.retry());
      await waitFor(() => expect(fetchStub).toHaveBeenCalled());
      await waitFor(() =>
        expect(rig.states.get(rig.url)?.tileError).toEqual({ kind: "dead-port", port: 8080 }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("present and relative addresses run no probe and report no tile error", async () => {
    const fetchStub = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", fetchStub);
    try {
      const present = renderEngine({ url: "/present/@320/file.html?server=runKit" });
      await new Promise((r) => setTimeout(r, 20));
      expect(fetchStub).not.toHaveBeenCalled();
      expect(checkFrame).not.toHaveBeenCalled();
      expect(present.rig.states.get(present.rig.url)!.tileError).toBeNull();
      cleanup();

      const relative = renderEngine({ url: "/tutorial/tutorial.html" });
      await new Promise((r) => setTimeout(r, 20));
      expect(fetchStub).not.toHaveBeenCalled();
      expect(relative.rig.states.get(relative.rig.url)!.tileError).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("engine handle", () => {
  it("registers an iframe-kind handle without the element, and unregisters on unmount", () => {
    const { rig, unmount } = renderEngine();
    const handle = rig.handles.get(rig.url)!;
    expect(handle.kind).toBe("iframe");
    expect(Object.keys(handle).sort()).toEqual([
      "back",
      "find",
      "forward",
      "kind",
      "reload",
      "retry",
      "stopFind",
    ]);
    unmount();
    expect(rig.handles.size).toBe(0);
  });

  it("reload on a same-origin frame reloads the current location and reports loading", () => {
    const { rig } = renderEngine();
    const reload = vi.fn();
    Object.defineProperty(getIframe(), "contentWindow", {
      value: { location: { reload } },
      configurable: true,
    });
    fireEvent.load(getIframe());
    expect(rig.states.get(rig.url)!.loading).toBe(false);
    act(() => rig.handles.get(rig.url)!.reload());
    expect(reload).toHaveBeenCalledTimes(1);
    expect(rig.states.get(rig.url)!.loading).toBe(true);
  });

  it("reload on a cross-origin frame falls back to the about:blank bounce", () => {
    vi.useFakeTimers();
    try {
      const { rig } = renderEngine({ url: "https://example.com/docs" });
      const iframe = getIframe();
      shadowCrossOrigin(iframe);
      fireEvent.load(iframe);
      act(() => rig.handles.get(rig.url)!.reload());
      expect(iframe.getAttribute("src")).toBe("about:blank");
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(iframe.getAttribute("src")).toBe("https://example.com/docs");
    } finally {
      vi.useRealTimers();
    }
  });

  it("back/forward navigate the frame history", () => {
    const { rig } = renderEngine();
    const back = vi.fn();
    const forward = vi.fn();
    Object.defineProperty(getIframe(), "contentWindow", {
      value: { history: { back, forward } },
      configurable: true,
    });
    act(() => rig.handles.get(rig.url)!.back());
    expect(back).toHaveBeenCalledTimes(1);
    expect(forward).not.toHaveBeenCalled();
    act(() => rig.handles.get(rig.url)!.forward());
    expect(forward).toHaveBeenCalledTimes(1);
  });
});

describe("find engine behind the handle", () => {
  it("a fresh search collects matches, reports {active: 0, total}, and steps wrap around", () => {
    const { rig } = renderEngine();
    seedFrameDocument("<p>foo one</p><p>the foo floor</p><p>FOO</p>");
    const handle = () => rig.handles.get(rig.url)!;

    act(() => handle().find("foo", { forward: true, findNext: false }));
    expect(rig.states.get(rig.url)!.find).toEqual({ active: 0, total: 3 });

    act(() => handle().find("foo", { forward: true, findNext: true }));
    expect(rig.states.get(rig.url)!.find).toEqual({ active: 1, total: 3 });
    act(() => handle().find("foo", { forward: true, findNext: true }));
    expect(rig.states.get(rig.url)!.find).toEqual({ active: 2, total: 3 });
    // Wraps forward past the last and backward before the first.
    act(() => handle().find("foo", { forward: true, findNext: true }));
    expect(rig.states.get(rig.url)!.find).toEqual({ active: 0, total: 3 });
    act(() => handle().find("foo", { forward: false, findNext: true }));
    expect(rig.states.get(rig.url)!.find).toEqual({ active: 2, total: 3 });
  });

  it("a query with no matches reports {active: 0, total: 0}; an empty query reports no active search", () => {
    const { rig } = renderEngine();
    seedFrameDocument("<p>nothing here</p>");
    const handle = () => rig.handles.get(rig.url)!;

    act(() => handle().find("absent", { forward: true, findNext: false }));
    expect(rig.states.get(rig.url)!.find).toEqual({ active: 0, total: 0 });
    // Stepping an empty match set is a no-op.
    act(() => handle().find("absent", { forward: true, findNext: true }));
    expect(rig.states.get(rig.url)!.find).toEqual({ active: 0, total: 0 });

    act(() => handle().find("", { forward: true, findNext: false }));
    expect(rig.states.get(rig.url)!.find).toBeNull();
  });

  it("stopFind clears the highlights and reports find: null", () => {
    const { rig } = renderEngine();
    seedFrameDocument("<p>foo</p>");
    const handle = () => rig.handles.get(rig.url)!;
    act(() => handle().find("foo", { forward: true, findNext: false }));
    expect(rig.states.get(rig.url)!.find).toEqual({ active: 0, total: 1 });

    act(() => handle().stopFind());
    expect(rig.states.get(rig.url)!.find).toBeNull();
    expect(getIframe().contentDocument!.getElementById("rk-find-highlight-style")).toBeNull();
  });

  it("a frame load resets the match state and fires onLoad exactly once per load", () => {
    const { rig } = renderEngine();
    const handle = () => rig.handles.get(rig.url)!;
    seedFrameDocument("<p>foo one</p>");
    act(() => handle().find("foo", { forward: true, findNext: false }));
    expect(rig.states.get(rig.url)!.find).toEqual({ active: 0, total: 1 });
    expect(rig.onLoad).toHaveBeenCalledTimes(1);
    expect(rig.onLoad).toHaveBeenLastCalledWith(rig.url);

    // A navigation replaces the document — the seed helper IS that path.
    seedFrameDocument("<p>foo foo</p>");
    expect(rig.states.get(rig.url)!.find).toBeNull();
    expect(rig.onLoad).toHaveBeenCalledTimes(2);
    expect(rig.onLoad).toHaveBeenLastCalledWith(rig.url);
  });

  it("find on an engine without the find capability is a no-op reporting find: null", () => {
    const { rig } = renderEngine({ url: "https://example.com/docs" });
    shadowCrossOrigin(getIframe());
    fireEvent.load(getIframe());
    expect(rig.states.get(rig.url)!.supports.find).toBe(false);
    act(() => rig.handles.get(rig.url)!.find("foo", { forward: true, findNext: false }));
    expect(rig.states.get(rig.url)!.find).toBeNull();
  });
});

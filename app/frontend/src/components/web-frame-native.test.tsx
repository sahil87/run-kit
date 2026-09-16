import { describe, it, expect, vi, afterEach, beforeEach, type Mock } from "vitest";
import { act, render, cleanup, screen } from "@testing-library/react";
import { TileDragContext } from "@/lib/tile-drag-context";
import { _resetForTests, acquire } from "@/lib/overlay-presence";
import { WebFrameNative, WEB_FRAME_NATIVE_DEFAULT_CAPABILITIES } from "./web-frame-native";
import type {
  FrameChromeState,
  WebFrameEngineHandle,
  WebFrameEngineProps,
} from "@/lib/web-frame-engine";

// The shell bridge is installed on window.runkitShell by hand (the preload's
// job in production): vi.fn() invokers resolve { ok: true }, onEvent captures
// the relay handler and returns a disposer spy. ResizeObserver and
// requestAnimationFrame are stubbed controllable — the observer callback is
// fired manually, frames are pumped manually — and the placeholder's rect is
// driven through a stubbed getBoundingClientRect.

type RelayHandler = (payload: unknown) => void;

const bridge = vi.hoisted(() => ({
  create: vi.fn((_tabKey: string, _url: string) => Promise.resolve({ ok: true })),
  destroy: vi.fn((_tabKey: string) => Promise.resolve({ ok: true })),
  bounds: vi.fn((_tabKey: string, _x: number, _y: number, _w: number, _h: number) =>
    Promise.resolve({ ok: true }),
  ),
  visible: vi.fn((_tabKey: string, _visible: boolean) => Promise.resolve({ ok: true })),
  load: vi.fn((_tabKey: string, _url: string) => Promise.resolve({ ok: true })),
  reload: vi.fn((_tabKey: string) => Promise.resolve({ ok: true })),
  onEvent: vi.fn((_handler: RelayHandler) => () => {}),
}));

let relayHandler: RelayHandler | null = null;
let relayDisposer: Mock<() => void>;

let currentRect = { x: 10, y: 20, width: 800, height: 600 };

function setRect(rect: { x: number; y: number; width: number; height: number }) {
  currentRect = rect;
}

let roCallbacks: ResizeObserverCallback[] = [];

function fireResize() {
  act(() => {
    for (const cb of roCallbacks) cb([], {} as ResizeObserver);
  });
}

let rafQueue: FrameRequestCallback[] = [];

function pumpFrames(n: number) {
  for (let i = 0; i < n; i++) {
    const queued = rafQueue;
    rafQueue = [];
    act(() => {
      for (const cb of queued) cb(0);
    });
  }
}

function deliver(payload: unknown) {
  act(() => {
    relayHandler?.(payload);
  });
}

interface Rig {
  url: string;
  tabKey: string;
  states: Map<string, FrameChromeState>;
  handles: Map<string, WebFrameEngineHandle>;
  onState: Mock<(url: string, state: FrameChromeState) => void>;
  onLoad: Mock<(url: string) => void>;
  interactRef: { current: (() => void) | undefined };
  reclaimRef: { current: ((e: KeyboardEvent) => boolean) | undefined };
}

/** Render the engine directly behind a recording harness (the
 *  web-frame-iframe.test.tsx pattern): the latest reported state per URL
 *  lands in `states`, the registered handle in `handles`. The handle
 *  registrars and callbacks are STABLE identities — the engine's mount
 *  effect keys on them, and a fresh closure per render would re-run it. */
function renderEngine({
  url = "/present/x/y/index.html",
  active = true,
  dragging = false,
  onInteract,
}: {
  url?: string;
  active?: boolean;
  dragging?: boolean;
  onInteract?: () => void;
} = {}) {
  const rig: Rig = {
    url,
    tabKey: "",
    states: new Map(),
    handles: new Map(),
    onState: vi.fn<(url: string, state: FrameChromeState) => void>(),
    onLoad: vi.fn<(url: string) => void>(),
    interactRef: { current: onInteract },
    reclaimRef: { current: undefined },
  };
  const onState = (u: string, s: FrameChromeState) => {
    rig.onState(u, s);
    rig.states.set(u, s);
  };
  const registerHandle = (u: string, h: WebFrameEngineHandle) => rig.handles.set(u, h);
  const unregisterHandle = (u: string) => rig.handles.delete(u);
  const element = (nextActive: boolean, drag: boolean) => (
    <TileDragContext.Provider value={drag}>
      <WebFrameNative
        url={url}
        active={nextActive}
        zoom={1}
        wireGestureListeners={() => () => {}}
        onState={onState}
        onLoad={rig.onLoad}
        registerHandle={registerHandle}
        unregisterHandle={unregisterHandle}
        interactRef={rig.interactRef}
        reclaimRef={rig.reclaimRef}
      />
    </TileDragContext.Provider>
  );
  const view = render(element(active, dragging));
  rig.tabKey = screen.getByTestId("web-native-placeholder").dataset.tabKey ?? "";
  return {
    ...view,
    rig,
    rerenderEngine: (overrides: { active?: boolean; dragging?: boolean } = {}) =>
      view.rerender(element(overrides.active ?? active, overrides.dragging ?? dragging)),
  };
}

beforeEach(() => {
  _resetForTests();
  relayHandler = null;
  relayDisposer = vi.fn();
  bridge.onEvent.mockImplementation((handler: RelayHandler) => {
    relayHandler = handler;
    return relayDisposer;
  });
  window.runkitShell = { version: "1.2.3", platform: "linux", web: bridge };
  setRect({ x: 10, y: 20, width: 800, height: 600 });
  roCallbacks = [];
  class MockResizeObserver {
    constructor(cb: ResizeObserverCallback) {
      roCallbacks.push(cb);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  rafQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    rafQueue[id - 1] = () => {};
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => currentRect as DOMRect,
  );
});

afterEach(() => {
  cleanup();
  delete window.runkitShell;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("WebFrameNative lifecycle", () => {
  it("subscribes before creating, and create receives the host-absolute URL for a relative present address", () => {
    const { rig } = renderEngine({ url: "/present/x/y/index.html" });
    expect(bridge.onEvent).toHaveBeenCalledTimes(1);
    expect(bridge.create).toHaveBeenCalledTimes(1);
    expect(bridge.onEvent.mock.invocationCallOrder[0]).toBeLessThan(
      bridge.create.mock.invocationCallOrder[0],
    );
    expect(bridge.create).toHaveBeenCalledWith(
      rig.tabKey,
      `${window.location.origin}/present/x/y/index.html`,
    );
  });

  it("creates with the host-absolute proxy path for a loopback address", () => {
    const { rig } = renderEngine({ url: "http://localhost:8080/docs" });
    expect(bridge.create).toHaveBeenCalledWith(
      rig.tabKey,
      `${window.location.origin}/proxy/8080/docs`,
    );
  });

  it("creates with an external URL unchanged", () => {
    const { rig } = renderEngine({ url: "https://github.com/x" });
    expect(bridge.create).toHaveBeenCalledWith(rig.tabKey, "https://github.com/x");
  });

  it("passes a stored address the URL constructor rejects to create raw, without throwing", () => {
    // An unclosed IPv6 literal fails `new URL(...)` even against a base; the
    // engine must still mount and hand the shell the raw address.
    const { rig } = renderEngine({ url: "http://[::1" });
    expect(bridge.create).toHaveBeenCalledTimes(1);
    expect(bridge.create).toHaveBeenCalledWith(rig.tabKey, "http://[::1");
  });

  it("unmount destroys the guest and disposes the subscription exactly once", () => {
    const { rig, unmount } = renderEngine();
    unmount();
    expect(bridge.destroy).toHaveBeenCalledTimes(1);
    expect(bridge.destroy).toHaveBeenCalledWith(rig.tabKey);
    expect(relayDisposer).toHaveBeenCalledTimes(1);
    expect(rig.handles.has(rig.url)).toBe(false);
  });

  it("exposes the tabKey on the placeholder", () => {
    const { rig } = renderEngine();
    expect(rig.tabKey).toMatch(/^web-\d+$/);
    const placeholder = screen.getByTestId("web-native-placeholder");
    expect(placeholder.dataset.tabKey).toBe(rig.tabKey);
  });
});

describe("WebFrameNative relay events", () => {
  it("drops events for another tabKey before any state update", () => {
    const { rig } = renderEngine();
    const before = rig.states.get(rig.url);
    deliver({ tabKey: "web-other", kind: "title", title: "Foreign" });
    expect(rig.states.get(rig.url)?.title).toBe(before?.title ?? null);
    expect(rig.states.get(rig.url)?.title).toBeNull();
  });

  it("maps title/favicon/loading/url into the reported chrome state and fires onLoad on loading:false", () => {
    const { rig } = renderEngine();
    const key = rig.tabKey;
    deliver({ tabKey: key, kind: "title", title: "GitHub" });
    deliver({ tabKey: key, kind: "favicon", favicons: ["https://a/f.ico", "https://a/g.ico"] });
    deliver({ tabKey: key, kind: "loading", loading: false });
    deliver({
      tabKey: key,
      kind: "url",
      url: `${window.location.origin}/present/x/y/other.html?q=1#frag`,
      canGoBack: true,
      canGoForward: false,
    });
    const state = rig.states.get(rig.url);
    expect(state?.title).toBe("GitHub");
    expect(state?.favicon).toBe("https://a/f.ico");
    expect(state?.loading).toBe(false);
    expect(state?.trackedLocation).toBe("/present/x/y/other.html?q=1#frag");
    expect(state?.canGoBack).toBe(true);
    expect(state?.canGoForward).toBe(false);
    expect(rig.onLoad).toHaveBeenCalledTimes(1);
    expect(rig.onLoad).toHaveBeenCalledWith(rig.url);
  });

  it("stores an external url relay absolute", () => {
    const { rig } = renderEngine();
    deliver({
      tabKey: rig.tabKey,
      kind: "url",
      url: "https://github.com/x/y",
      canGoBack: false,
      canGoForward: false,
    });
    expect(rig.states.get(rig.url)?.trackedLocation).toBe("https://github.com/x/y");
  });

  it("maps an empty title to null and an empty favicon list to null", () => {
    const { rig } = renderEngine();
    deliver({ tabKey: rig.tabKey, kind: "title", title: "T" });
    deliver({ tabKey: rig.tabKey, kind: "favicon", favicons: ["https://a/f.ico"] });
    deliver({ tabKey: rig.tabKey, kind: "title", title: "" });
    deliver({ tabKey: rig.tabKey, kind: "favicon", favicons: [] });
    expect(rig.states.get(rig.url)?.title).toBeNull();
    expect(rig.states.get(rig.url)?.favicon).toBeNull();
  });

  it("failed clears loading and leaves tileError null", () => {
    const { rig } = renderEngine();
    expect(rig.states.get(rig.url)?.loading).toBe(true);
    deliver({ tabKey: rig.tabKey, kind: "failed", code: -105, description: "NAME_NOT_RESOLVED", url: "https://x" });
    const state = rig.states.get(rig.url);
    expect(state?.loading).toBe(false);
    expect(state?.tileError).toBeNull();
  });

  it("focus fires the interact seam; zoom is ignored", () => {
    const onInteract = vi.fn();
    const { rig } = renderEngine({ onInteract });
    deliver({ tabKey: rig.tabKey, kind: "focus" });
    expect(onInteract).toHaveBeenCalledTimes(1);
    const before = rig.onState.mock.calls.length;
    deliver({ tabKey: rig.tabKey, kind: "zoom", direction: "in" });
    expect(rig.onState.mock.calls.length).toBe(before);
  });
});

describe("WebFrameNative capabilities + handle", () => {
  it("reports the honest capability set (no history/find/zoom-gesture/devtools channels exist yet)", () => {
    expect(WEB_FRAME_NATIVE_DEFAULT_CAPABILITIES).toEqual({
      history: false,
      find: false,
      meta: true,
      zoomGestures: false,
      devtools: false,
    });
    const { rig } = renderEngine();
    expect(rig.states.get(rig.url)?.supports).toEqual(WEB_FRAME_NATIVE_DEFAULT_CAPABILITIES);
  });

  it("handle reload/retry call the bridge and report loading; back/forward/find/stopFind are no-ops", () => {
    const { rig } = renderEngine();
    const handle = rig.handles.get(rig.url);
    expect(handle?.kind).toBe("native");
    deliver({ tabKey: rig.tabKey, kind: "loading", loading: false });
    bridge.reload.mockClear();
    act(() => handle?.reload());
    expect(bridge.reload).toHaveBeenCalledTimes(1);
    expect(bridge.reload).toHaveBeenCalledWith(rig.tabKey);
    expect(rig.states.get(rig.url)?.loading).toBe(true);
    act(() => handle?.retry());
    expect(bridge.reload).toHaveBeenCalledTimes(2);

    const counts = () =>
      [bridge.create, bridge.destroy, bridge.bounds, bridge.visible, bridge.load].map(
        (fn) => fn.mock.calls.length,
      );
    const before = counts();
    act(() => {
      handle?.back();
      handle?.forward();
      handle?.find("x", { forward: true, findNext: false });
      handle?.stopFind();
    });
    expect(counts()).toEqual(before);
    expect(bridge.reload).toHaveBeenCalledTimes(2);
  });
});

describe("WebFrameNative placeholder", () => {
  it("is hidden for an inactive tab and paints the tile background when active", () => {
    const { rerenderEngine } = renderEngine({ active: false });
    const placeholder = screen.getByTestId("web-native-placeholder");
    expect(placeholder.hasAttribute("hidden")).toBe(true);
    rerenderEngine({ active: true });
    expect(placeholder.hasAttribute("hidden")).toBe(false);
    expect(placeholder.className).toContain("bg-bg-primary");
    expect(placeholder.style.transform).toBe("");
  });
});

describe("WebFrameNative bounds", () => {
  it("sends the rounded rect on a ResizeObserver callback and dedupes an identical rect", () => {
    const { rig } = renderEngine();
    bridge.bounds.mockClear();
    setRect({ x: 100.4, y: 50.6, width: 640.2, height: 480 });
    fireResize();
    expect(bridge.bounds).toHaveBeenCalledTimes(1);
    expect(bridge.bounds).toHaveBeenCalledWith(rig.tabKey, 100, 51, 640, 480);
    fireResize();
    expect(bridge.bounds).toHaveBeenCalledTimes(1);
  });

  it("sends no bounds for a zero-size rect and drives visible(false) instead", () => {
    const { rig } = renderEngine();
    bridge.bounds.mockClear();
    bridge.visible.mockClear();
    setRect({ x: 0, y: 0, width: 0, height: 0 });
    fireResize();
    expect(bridge.bounds).not.toHaveBeenCalled();
    expect(bridge.visible).toHaveBeenCalledWith(rig.tabKey, false);
  });

  it("keeps sending bounds while the guest is hidden by a modal overlay (main parks them)", () => {
    const { rig } = renderEngine();
    bridge.bounds.mockClear();
    bridge.visible.mockClear();
    let release: () => void = () => {};
    act(() => {
      release = acquire("modal");
    });
    expect(bridge.visible).toHaveBeenCalledWith(rig.tabKey, false);
    setRect({ x: 30, y: 40, width: 500, height: 400 });
    fireResize();
    expect(bridge.bounds).toHaveBeenCalledWith(rig.tabKey, 30, 40, 500, 400);
    bridge.visible.mockClear();
    act(() => release());
    const showCall = bridge.visible.mock.calls.find((call) => call[1] === true);
    expect(showCall?.[0]).toBe(rig.tabKey);
    // The show is preceded by a (parked) bounds measurement.
    const lastBoundsOrder = bridge.bounds.mock.invocationCallOrder.at(-1) ?? -1;
    const showOrder = bridge.visible.mock.invocationCallOrder[0];
    expect(lastBoundsOrder).toBeLessThan(showOrder);
  });

  it("a transient overlay never hides the guest", () => {
    const { rig } = renderEngine();
    bridge.visible.mockClear();
    let release: () => void = () => {};
    act(() => {
      release = acquire("transient");
    });
    expect(bridge.visible).not.toHaveBeenCalled();
    act(() => release());
    expect(bridge.visible).not.toHaveBeenCalled();
  });
});

describe("WebFrameNative visibility", () => {
  it("an inactive tab mounts hidden; activating it re-measures and shows the guest", () => {
    const { rig, rerenderEngine } = renderEngine({ active: false });
    expect(bridge.visible).toHaveBeenCalledWith(rig.tabKey, false);
    bridge.visible.mockClear();
    bridge.bounds.mockClear();
    setRect({ x: 5, y: 6, width: 700, height: 500 });
    rerenderEngine({ active: true });
    expect(bridge.visible).toHaveBeenCalledWith(rig.tabKey, true);
    expect(bridge.bounds).toHaveBeenCalledWith(rig.tabKey, 5, 6, 700, 500);
    const lastBoundsOrder = bridge.bounds.mock.invocationCallOrder.at(-1) ?? -1;
    const showOrder = bridge.visible.mock.invocationCallOrder[0];
    expect(lastBoundsOrder).toBeLessThan(showOrder);
  });
});

describe("WebFrameNative live resize while dragging", () => {
  it("sends deduped bounds on every pumped frame and never hides; the stop edge measures once more", () => {
    const { rig, rerenderEngine } = renderEngine({ dragging: true });
    bridge.bounds.mockClear();
    bridge.visible.mockClear();
    setRect({ x: 0, y: 0, width: 100, height: 100 });
    pumpFrames(1);
    setRect({ x: 0, y: 0, width: 110, height: 100 });
    pumpFrames(1);
    setRect({ x: 0, y: 0, width: 120, height: 100 });
    pumpFrames(1);
    expect(bridge.bounds).toHaveBeenCalledTimes(3);
    expect(bridge.bounds.mock.calls.map((c) => c[3])).toEqual([100, 110, 120]);
    // HIDE_WHILE_DRAGGING ships false: no hide for the drag.
    expect(bridge.visible).not.toHaveBeenCalled();

    setRect({ x: 0, y: 0, width: 130, height: 100 });
    rerenderEngine({ dragging: false });
    // The true → false edge stops the loop and runs one final measure.
    expect(bridge.bounds).toHaveBeenCalledTimes(4);
    expect(bridge.bounds).toHaveBeenLastCalledWith(rig.tabKey, 0, 0, 130, 100);
    expect(rafQueue.every((cb) => cb.length >= 0)).toBe(true);
    pumpFrames(1);
    expect(bridge.bounds).toHaveBeenCalledTimes(4);
  });
});

/**
 * The native web-frame engine — the web tile's content rendered by the
 * desktop shell's Chromium (`WebContentsView`) instead of an `<iframe>`.
 *
 * Constraints the code cannot show:
 *
 * - The guest view is a NATIVE LAYER composited above the SPA's DOM (a
 *   sibling of the host view on the window's `contentView`): nothing the SPA
 *   draws can appear over it, so the engine hides it while a modal-class
 *   overlay is open and keeps the placeholder painted underneath.
 * - The relay subscription MUST be disposed with the engine — a listener
 *   that outlives its mount re-fires every relayed event once per leak. The
 *   bridge's `onEvent` returns the disposer and this engine's mount-effect
 *   cleanup calls it; events are demuxed by `tabKey` before any state
 *   update.
 * - Mid-drag rule is LIVE RESIZE: while a layout drag runs, bounds go out on
 *   every animation frame and the guest is never hidden (`HIDE_WHILE_DRAGGING`
 *   stays `false`; the hide exists only as a named option).
 * - Bounds are sent whether or not the guest is visible — the shell parks
 *   them while hidden and applies them on show, so the engine never
 *   withholds a rect.
 * - Coordinates are identity-mapped: the host view fills the window content
 *   area, so `getBoundingClientRect()` viewport coordinates ARE host-view
 *   coordinates; no offset is added.
 */
import { useState, useRef, useCallback, useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import {
  createShellWebView,
  destroyShellWebView,
  onShellWebEvent,
  reloadShellWebView,
  setShellWebViewBounds,
  setShellWebViewVisible,
  type ShellWebEvent,
  type ShellWebRect,
} from "@/lib/shell";
import { isModalOpen, subscribe } from "@/lib/overlay-presence";
import { useTileDragging } from "@/lib/tile-drag-context";
import { toProxySrc } from "@/lib/web-url";
import type { WebFrameCapabilities, WebFrameEngineProps } from "@/lib/web-frame-engine";

/** The capabilities the native engine reports — what the bridge can do
 *  TODAY, not the plan's parity target: there is no back/forward, find,
 *  zoom, or devtools channel yet, and the chrome renders per capability, so
 *  an honest `false` hides a control instead of shipping a dead one. The
 *  parity change flips these as its channels land. */
export const WEB_FRAME_NATIVE_DEFAULT_CAPABILITIES: WebFrameCapabilities = {
  history: false,
  find: false,
  meta: true,
  zoomGestures: false,
  devtools: false,
};

/** The mid-drag posture knob: `false` ships the spike-verified live-resize
 *  rule (bounds every frame, no hide); `true` would hide the guest for the
 *  drag instead. */
const HIDE_WHILE_DRAGGING = false;

// Unique under the host webContents (one SPA renderer, one counter), within
// the shell's 128-char tabKey bound, and fresh per engine mount so a
// StrictMode replay or a kind flip never reuses a key.
let mountSeq = 0;

/** Root-relative form for same-origin URLs (the iframe engine's display
 *  convention, so `displayForm` sees the same shape); the absolute URL for
 *  anything else — the address bar then shows where the guest navigated. An
 *  unparsable string is stored raw. */
function toTracked(absolute: string): string {
  try {
    const parsed = new URL(absolute);
    if (parsed.origin === window.location.origin) {
      return parsed.pathname + parsed.search + parsed.hash;
    }
    return absolute;
  } catch {
    return absolute;
  }
}

/** One mounted web tab behind the native bridge (P3 — hide, never unmount):
 *  owns no content document; the guest view paints over the placeholder,
 *  whose rect IS the guest's bounds. */
export function WebFrameNative({
  url,
  active,
  onState,
  onLoad,
  registerHandle,
  unregisterHandle,
  interactRef,
}: WebFrameEngineProps) {
  const placeholderRef = useRef<HTMLDivElement>(null);
  const tabKeyRef = useRef<string | null>(null);
  if (tabKeyRef.current === null) {
    tabKeyRef.current = `web-${++mountSeq}`;
  }
  const tabKey = tabKeyRef.current;

  // The create issues a load, so the engine reports loading until the relay
  // says otherwise.
  const [loading, setLoading] = useState(true);
  const [trackedLocation, setTrackedLocation] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [favicon, setFavicon] = useState<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  // Set by measure(): a zero-size rect (hidden tab, collapsed tile) feeds the
  // visibility rule instead of the bridge.
  const [rectNonZero, setRectNonZero] = useState(false);

  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  const lastSentBoundsRef = useRef<ShellWebRect | null>(null);
  const lastSentVisibleRef = useRef<boolean | null>(null);
  const rafRef = useRef<number | null>(null);

  const measure = useCallback(() => {
    const el = placeholderRef.current;
    if (!el) return;
    const domRect = el.getBoundingClientRect();
    const rect: ShellWebRect = {
      x: Math.round(domRect.x),
      y: Math.round(domRect.y),
      width: Math.round(domRect.width),
      height: Math.round(domRect.height),
    };
    if (rect.width <= 0 || rect.height <= 0) {
      setRectNonZero(false);
      return;
    }
    setRectNonZero(true);
    const last = lastSentBoundsRef.current;
    if (
      last !== null &&
      last.x === rect.x &&
      last.y === rect.y &&
      last.width === rect.width &&
      last.height === rect.height
    ) {
      return;
    }
    lastSentBoundsRef.current = rect;
    void setShellWebViewBounds(tabKey, rect);
  }, [tabKey]);

  // Mount effect (mount-scoped — the chrome re-keys by url, so a url change
  // is a remount): subscribe FIRST so no early relay is missed, then create
  // the guest with the host-absolute form of exactly what the iframe engine
  // would load, then register the command handle. The cleanup tears all
  // three down.
  useEffect(() => {
    const dispose = onShellWebEvent((event: ShellWebEvent) => {
      // Demux before ANY state update: an event for another tab is dropped.
      if (event.tabKey !== tabKey) return;
      switch (event.kind) {
        case "title":
          setTitle(event.title === "" ? null : event.title);
          break;
        case "favicon":
          setFavicon(event.favicons[0] ?? null);
          break;
        case "loading":
          setLoading(event.loading);
          // The per-completed-load edge the chrome resets its find query on.
          if (!event.loading) onLoadRef.current(url);
          break;
        case "url":
          setTrackedLocation(toTracked(event.url));
          setCanGoBack(event.canGoBack);
          setCanGoForward(event.canGoForward);
          break;
        case "failed":
          // The TileError mapping is the parity change's; today a failure
          // only ends the load.
          setLoading(false);
          break;
        case "focus":
          interactRef.current?.();
          break;
        case "zoom":
          // The zoom relay becomes a bucket step in the parity change.
          break;
      }
    });
    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(toProxySrc(url), window.location.origin).href;
    } catch {
      absoluteUrl = url;
    }
    void createShellWebView(tabKey, absoluteUrl);
    const reload = () => {
      setLoading(true);
      void reloadShellWebView(tabKey);
    };
    registerHandle(url, {
      kind: "native",
      reload,
      retry: reload,
      // No bridge channel exists for history/find yet — the chrome hides or
      // disables those controls per the reported capabilities.
      back: () => {},
      forward: () => {},
      find: () => {},
      stopFind: () => {},
    });
    return () => {
      unregisterHandle(url);
      void destroyShellWebView(tabKey);
      dispose();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [url, tabKey, registerHandle, unregisterHandle, interactRef]);

  // Bounds triggers — everything funnels through measure() so the dedupe and
  // the zero-rect rule live in exactly one place.
  useEffect(() => {
    const el = placeholderRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  // A position-only shift (a neighbouring tile resized without this one
  // changing size) fires no ResizeObserver entry — re-measure after every
  // render of the engine.
  useLayoutEffect(() => {
    measure();
  });

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  // A tab becoming active needs the current rect before its guest shows.
  useEffect(() => {
    if (active) measure();
  }, [active, measure]);

  // Hide while a MODAL-class overlay is open (the guest is composited above
  // the DOM — a palette or dialog would render underneath it); transient
  // overlays never hide it.
  const modalOpen = useSyncExternalStore(subscribe, isModalOpen, () => false);

  // Live resize while dragging (HIDE_WHILE_DRAGGING = false): a rAF loop
  // sends deduped bounds every frame for the drag's duration; the true →
  // false edge stops the loop and measures once more. The guest is never
  // hidden for a drag at the shipped setting.
  const dragging = useTileDragging();
  useEffect(() => {
    if (!dragging) return;
    const tick = () => {
      measure();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      measure();
    };
  }, [dragging, measure]);

  const wantVisible =
    active && !modalOpen && rectNonZero && !(HIDE_WHILE_DRAGGING && dragging);
  useEffect(() => {
    if (lastSentVisibleRef.current === wantVisible) return;
    // Bounds precede the show (the shell also applies parked bounds on show;
    // this ordering is belt-and-braces).
    if (wantVisible) measure();
    lastSentVisibleRef.current = wantVisible;
    void setShellWebViewVisible(tabKey, wantVisible);
  }, [wantVisible, measure, tabKey]);

  useEffect(() => {
    onState(url, {
      loading,
      supports: WEB_FRAME_NATIVE_DEFAULT_CAPABILITIES,
      trackedLocation,
      title,
      favicon,
      tileError: null,
      canGoBack,
      canGoForward,
      find: null,
    });
  }, [url, loading, trackedLocation, title, favicon, canGoBack, canGoForward, onState]);

  return (
    <div
      ref={placeholderRef}
      data-testid="web-native-placeholder"
      data-tab-key={tabKey}
      hidden={!active}
      className="w-full h-full bg-bg-primary"
    />
  );
}

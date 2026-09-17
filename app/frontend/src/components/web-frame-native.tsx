/**
 * The native web-frame engine — the web tile's content rendered by the
 * desktop shell's Chromium (`WebContentsView`) instead of an `<iframe>`.
 *
 * Constraints the code cannot show:
 *
 * - The guest view is a NATIVE LAYER composited above the SPA's DOM (a
 *   sibling of the host view on the window's `contentView`): nothing the SPA
 *   draws can appear over it, so the engine hides it while a modal-class
 *   overlay is open, while the chrome's error surface is up (`tileError`), and
 *   keeps the placeholder painted underneath.
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
 * - Zoom: the SPA's localStorage buckets are the source of truth (Chromium's
 *   per-host zoom store inside the guest partition persists and leaks across
 *   views), so the engine re-sends the factor on EVERY `url` relay; the
 *   guest's own ctrl-wheel gesture arrives as a direction-only relay that
 *   steps the bucket through `onZoomStep` — main never applies it.
 * - Chords: a guest's keydowns never reach this document, so the reclaim
 *   predicate cannot run at event time — the chrome enumerates it into
 *   `chordTable`, main matches and hops focus, and the engine re-dispatches
 *   the relayed chord here WITHOUT consulting `reclaimRef` (the table already
 *   IS the predicate, and Escape is not a registry chord).
 */
import { useState, useRef, useCallback, useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import {
  createShellWebView,
  destroyShellWebView,
  findShellWebView,
  goBackShellWebView,
  goForwardShellWebView,
  onShellWebEvent,
  openShellWebViewDevTools,
  reloadShellWebView,
  setShellWebViewBounds,
  setShellWebViewChords,
  setShellWebViewVisible,
  setShellWebViewZoom,
  stopFindShellWebView,
  type ShellWebEvent,
  type ShellWebRect,
} from "@/lib/shell";
import { isModalOpen, subscribe } from "@/lib/overlay-presence";
import { useTileDragging } from "@/lib/tile-drag-context";
import { toProxySrc } from "@/lib/web-url";
import {
  tileErrorForGuestFailure,
  tileErrorForGuestResponse,
} from "@/lib/web-native-errors";
import {
  redispatchChord,
  type TileError,
  type WebFrameCapabilities,
  type WebFrameEngineProps,
} from "@/lib/web-frame-engine";

/** The capabilities the native engine reports — the parity set: every chrome
 *  control works on this engine, and find/devtools pass the iframe engine
 *  (cross-origin find, a real DevTools window). */
export const WEB_FRAME_NATIVE_DEFAULT_CAPABILITIES: WebFrameCapabilities = {
  history: true,
  find: true,
  meta: true,
  zoomGestures: true,
  devtools: true,
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
  zoom,
  onState,
  onLoad,
  registerHandle,
  unregisterHandle,
  interactRef,
  onZoomStep,
  chordTable,
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
  const [find, setFind] = useState<{ active: number; total: number } | null>(null);
  const [tileError, setTileError] = useState<TileError | null>(null);
  // Set by measure(): a zero-size rect (hidden tab, collapsed tile) feeds the
  // visibility rule instead of the bridge.
  const [rectNonZero, setRectNonZero] = useState(false);

  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const onZoomStepRef = useRef(onZoomStep);
  onZoomStepRef.current = onZoomStep;

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
          // A load start supersedes any stale error surface.
          if (event.loading) setTileError(null);
          setLoading(event.loading);
          if (!event.loading) {
            // Find state dies with the document it matched in (the iframe
            // engine's per-load reset); the onLoad edge carries the chrome's
            // find-query reset.
            setFind(null);
            onLoadRef.current(url);
          }
          break;
        case "url": {
          setTrackedLocation(toTracked(event.url));
          setCanGoBack(event.canGoBack);
          setCanGoForward(event.canGoForward);
          // Re-apply the bucket on every navigation — Chromium's per-host
          // zoom store in the guest partition would otherwise fight it.
          void setShellWebViewZoom(tabKey, zoomRef.current);
          // did-navigate carries the commit's HTTP status; a proxy 502 is a
          // dead port, anything else clears a stale error.
          if (event.httpStatus !== undefined) {
            setTileError(tileErrorForGuestResponse(event.httpStatus, url));
          }
          break;
        }
        case "failed":
          setLoading(false);
          setTileError(tileErrorForGuestFailure(event, url));
          break;
        case "focus":
          interactRef.current?.();
          break;
        case "zoom":
          // ctrl-wheel inside the guest steps the SPA's bucket; the stepped
          // zoom prop flows back and is re-sent by the zoom effect.
          onZoomStepRef.current?.(event.direction);
          break;
        case "find":
          // Chromium's activeMatchOrdinal is 1-based; the find bar's
          // matchIndex is 0-based. total 0 reports 0/0.
          setFind({ active: Math.max(0, event.active - 1), total: event.total });
          break;
        case "chord":
          // A keydown inside the tile is an interaction (the iframe engine's
          // onKey reports first), then the chord is re-dispatched onto the
          // document — the table already decided reclaim, so reclaimRef is
          // never consulted here.
          interactRef.current?.();
          redispatchChord(event);
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
      setTileError(null);
      setLoading(true);
      void reloadShellWebView(tabKey);
    };
    registerHandle(url, {
      kind: "native",
      reload,
      retry: reload,
      back: () => void goBackShellWebView(tabKey),
      forward: () => void goForwardShellWebView(tabKey),
      find: (query, opts) => void findShellWebView(tabKey, query, opts),
      stopFind: () => {
        void stopFindShellWebView(tabKey);
        setFind(null);
      },
      openDevTools: () => void openShellWebViewDevTools(tabKey),
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

  // Zoom application: sent after mount (the create above precedes this effect
  // in declaration order), on every zoom prop change, and on every url relay
  // (inside the relay handler above).
  useEffect(() => {
    void setShellWebViewZoom(tabKey, zoom);
  }, [tabKey, zoom]);

  // The reclaim table: uploaded after mount and on every identity change (a
  // rebind re-derives it). Absent prop ⇒ empty table — a guest with no table
  // forwards nothing.
  useEffect(() => {
    void setShellWebViewChords(tabKey, chordTable ?? []);
  }, [tabKey, chordTable]);

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

  // The guest must not paint over the chrome's error surface: while tileError
  // is set the wrapper stays mounted beside it, so hiding is the only way the
  // copy is visible (the iframe engine hides its frame the same way).
  const wantVisible =
    active && !modalOpen && rectNonZero && tileError === null && !(HIDE_WHILE_DRAGGING && dragging);
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
      tileError,
      canGoBack,
      canGoForward,
      find,
    });
  }, [url, loading, trackedLocation, title, favicon, tileError, canGoBack, canGoForward, find, onState]);

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

import { useState, useRef, useCallback, useEffect } from "react";
import { checkFrame } from "@/api/client";
import { Tip, TipGroup } from "@/components/tip";
import { FindBar } from "@/components/find-bar";
import {
  FindGlyph,
  OpenExternalGlyph,
  RefreshGlyph,
  WebBackGlyph,
  WebForwardGlyph,
} from "@/components/top-bar-icons";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer";
import {
  WEB_ADDRESS_FOCUS_EVENT,
  WEB_OPEN_EXTERNAL_EVENT,
  classifyAddress,
  displayForm,
  isAllowedUrl,
  normalizeAddressInput,
  proxyPortOf,
  toProxySrc,
  webTabTitle,
  type AddressKind,
} from "@/lib/web-url";
import {
  WEB_ZOOM_DEFAULT,
  WEB_ZOOM_EVENT,
  readWebZoom,
  stepWebZoom,
  webZoomKeyFor,
  writeWebZoom,
  WEB_ZOOM_MAX,
  WEB_ZOOM_MIN,
  type WebZoomDirection,
} from "@/lib/web-zoom";
import { applyWheelZoom, clampZoom } from "@/lib/zoom-gesture";
import {
  WEB_FIND_OPEN_EVENT,
  applyHighlights,
  clearHighlights,
  collectMatches,
  findWithWindow,
  scrollToMatch,
  stepMatch,
} from "@/lib/find-in-page";

interface IframeWindowProps {
  /** Dense web-tab family (the window's `webTabs ?? []`). */
  tabs: string[];
  /** 1-based active slot (the window's `webActive`); 0/undefined with a
   *  non-empty family selects slot 1, out-of-range clamps. */
  active?: number;
  /** Address-bar write seam: Enter submits the normalized address through
   *  this callback, which POSTs it to the active web slot's window option.
   *  The component stays payload-shape agnostic — the caller owns the slot.
   *  Absent ⇒ the submit is a local no-op. */
  onWriteUrl?: (url: string) => Promise<unknown>;
  /** Strip verbs — absent ⇒ the control is not rendered / the gesture is a
   *  no-op. The caller owns the POSTs; the component re-renders from the
   *  next `tabs`/`active` props and never renumbers locally. */
  onSelectTab?: (n: number) => Promise<unknown>;
  onCloseTab?: (n: number) => Promise<unknown>;
  /** `+` — declared add of the address-bar draft. Resolves to the server's
   *  {index, existed}; the component then calls onSelectTab(index) because
   *  the add verb selects only an empty family. */
  onAddTab?: (target: string) => Promise<{ index: number; existed: boolean }>;
  /** Tile-focus seam: fired when a pointerdown/keydown arrives inside the
   *  same-origin contentDocument, or — the cross-origin fallback — when the
   *  parent window blurs with this iframe as the active element. Clicks
   *  inside an iframe stay in the frame's document and moving focus into it
   *  fires NO focusin in the parent, so without this seam in-frame
   *  interaction is invisible to the tile wrapper. Absent ⇒ no reporting. */
  onInteract?: () => void;
  /** Chord-reclaim seam (260819-ie2i R1): the kind-bound predicate over
   *  in-frame keydowns. A MATCHING chord is consumed in the frame
   *  (preventDefault + stopImmediatePropagation) and re-dispatched as a
   *  synthetic bubbling KeyboardEvent on the parent document — byte-identical
   *  in mechanism to `CodeSurface`'s `onKey`. Non-matching keys pass through
   *  untouched (typing into a framed form is unchanged); every keydown still
   *  reports `onInteract` first. Absent ⇒ report-only (legacy behavior). */
  shouldReclaimChord?: (e: KeyboardEvent) => boolean;
  /** Page-meta seam (260819-v6y4 R10): fired on every ACTIVE frame `load`
   *  with the same-origin document's title, `null` when cross-origin or
   *  empty. The header (SurfaceLayout) owns the render, but only the mounted
   *  iframe can read `contentDocument.title` — the
   *  `onInteract`/`onFolderNavigated` callback-seam shape. Absent ⇒ no
   *  reporting. */
  onPageMeta?: (meta: { title: string | null }) => void;
}

/** Trailing debounce for persisting gesture-driven zoom — a pinch emits
 *  dozens of events; one write after quiescence is enough (260824-iafo R4). */
const ZOOM_PERSIST_DEBOUNCE_MS = 250;

/** Backend family cap (`@rk_win_web_1..8`) — bounds the mounted frames. */
const WEB_TAB_FAMILY_CAP = 8;
/** The tab strip renders only when the family has at least this many tabs;
 *  below it the tile's DOM is the single-tab chrome. */
const WEB_TAB_STRIP_MIN = 2;

/** The tile's error surface (260819-v6y4 R8) — rendered IN PLACE of the
 *  iframe's visible area; copy per the approved design study (states 05/06).
 *  A silent blank iframe is no longer a reachable state for a probed-blocked
 *  external URL or a dead proxied port. */
type TileError =
  | { kind: "refused"; host: string; reason: string }
  | { kind: "unreachable"; host: string; reason: string }
  | { kind: "dead-port"; port: number };

/** The chrome-relevant slice of one frame's state, reported up by each
 *  WebFrame; the parent's chrome binds to the ACTIVE frame's entry. */
interface FrameChromeState {
  loading: boolean;
  crossOrigin: boolean;
  trackedLocation: string | null;
  tileError: TileError | null;
}

/** Parent → frame commands, registered per frame URL. */
interface FrameHandle {
  iframeRef: { current: HTMLIFrameElement | null };
  refresh: () => void;
  retry: () => void;
  navigate: (delta: -1 | 1) => void;
}

interface WebFrameProps {
  url: string;
  active: boolean;
  zoom: number;
  wireGestureListeners: (target: Document | HTMLElement) => () => void;
  onChromeState: (url: string, state: FrameChromeState) => void;
  /** Fired on the frame's `load` events with the same-origin document title
   *  (null cross-origin/empty) — the parent consumes it for the ACTIVE frame
   *  only (page-meta seam + find reset). */
  onFrameLoad: (url: string, title: string | null) => void;
  registerFrame: (url: string, handle: FrameHandle) => void;
  unregisterFrame: (url: string) => void;
  interactRef: { current: (() => void) | undefined };
  reclaimRef: { current: ((e: KeyboardEvent) => boolean) | undefined };
}

/** One mounted web tab (P3 — hide, never unmount): owns its iframe element
 *  plus the frame-scoped state (loading, cross-origin, tracked location,
 *  probe/error). Identity is the URL — a selection change neither remounts
 *  the frame nor rewrites its `src`. Inactive frames run no probe; a frame
 *  probes on first mount and on activation. */
function WebFrame({
  url,
  active,
  zoom,
  wireGestureListeners,
  onChromeState,
  onFrameLoad,
  registerFrame,
  unregisterFrame,
  interactRef,
  reclaimRef,
}: WebFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Load feedback (R11): set on mount/reload, cleared on `load`.
  const [loading, setLoading] = useState(true);
  const [crossOrigin, setCrossOrigin] = useState(false);
  // Per-viewer current-path tracking (R7): the same-origin frame's location,
  // read on its `load` events and kept in root-relative form (the viewer
  // origin stripped). Display-only — NEVER POSTed (spec window-views R7).
  const [trackedLocation, setTrackedLocation] = useState<string | null>(null);
  const [tileError, setTileError] = useState<TileError | null>(null);
  // Bumped by the dead-port Retry button to re-run detection + reload.
  const [probeNonce, setProbeNonce] = useState(0);
  const onFrameLoadRef = useRef(onFrameLoad);
  onFrameLoadRef.current = onFrameLoad;

  useEffect(() => {
    onChromeState(url, { loading, crossOrigin, trackedLocation, tileError });
  }, [url, loading, crossOrigin, trackedLocation, tileError, onChromeState]);

  // Interaction + reclaim seam: attach capture-phase pointerdown/keydown
  // listeners to the same-origin contentDocument after every load — each
  // navigation replaces the document, so the listener on the discarded one
  // dies with it and the fresh document gets a new pair. The keydown handler
  // reports `onInteract` first, then consults the reclaim predicate: a match
  // is prevented in the frame and re-dispatched on the PARENT document (the
  // CodeSurface `onKey` mechanism — bubbling reaches both the document-level
  // palette listener and the window-level keybinding dispatcher). Cross-origin
  // frames fail the location probe / contentDocument read; there the
  // window-blur check is the fallback (activeElement lands on the iframe when
  // focus enters it, but no focusin fires in the parent). blur only fires when
  // focus LEAVES the parent — later in-frame clicks report nothing, which is
  // fine: the tile is already focused by then. Listeners attach regardless of
  // whether `onInteract` is currently set: the prop can arrive after mount (a
  // hidden tile handed slot -1 becoming visible), and gating the attach on it
  // would strand the seam — `report` reads the ref, so it simply no-ops until
  // then. Every load also RESETS the find state (R8): matches, highlights, and
  // the query die with the document they were collected from.
  //
  // The same load pass (260819-v6y4) clears the progress line, tracks the
  // frame's current location for the address bar's display form, and reports
  // the page title up through onFrameLoad — all same-origin-gated reads with
  // the attach seam's try/catch posture.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let attachedDoc: Document | null = null;
    let attachedGestures: (() => void) | null = null;
    const report = () => interactRef.current?.();
    const onKey = (e: KeyboardEvent) => {
      report();
      const reclaim = reclaimRef.current;
      if (!reclaim?.(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: e.key,
          code: e.code,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          bubbles: true,
        }),
      );
    };
    const attach = (fromLoad: boolean) => {
      let doc: Document | null = null;
      try {
        // Same-origin probe: a cross-origin frame throws on location access
        // and yields a null contentDocument — either one marks the tile
        // cross-origin (find disabled, back/forward hidden, reload degrades
        // to the bounce; the blur fallback stays the only interaction
        // signal, unchanged).
        void iframe.contentWindow?.location.href;
        doc = iframe.contentDocument;
      } catch {
        doc = null;
      }
      setCrossOrigin(!doc);
      // The load-gated work (R7/R10/R11) runs on the frame's `load` events
      // ONLY — the mount-time attach sees the initial about:blank document,
      // so clearing the progress line or tracking the location there would
      // fire before the real src has loaded.
      if (fromLoad) {
        setLoading(false);
        // Current-path tracking + title reporting: same-origin only. The
        // tracked location is stored root-relative (viewer origin stripped)
        // so the display-form derivation sees the same shape as a stored
        // relative web address. about:blank (the cross-origin reload bounce's
        // midpoint) reports nothing.
        if (doc) {
          try {
            const loc = iframe.contentWindow?.location;
            if (loc && loc.origin === window.location.origin && loc.href !== "about:blank") {
              setTrackedLocation(loc.pathname + loc.search + loc.hash);
            }
          } catch {
            /* noop */
          }
          onFrameLoadRef.current(url, doc.title !== "" ? doc.title : null);
        } else {
          onFrameLoadRef.current(url, null);
        }
      }
      // R8 highlight reset — no stale highlight survives a navigation. The
      // query/match reset lives on the parent's onFrameLoad (one find bar,
      // bound to the active frame).
      try {
        const win = iframe.contentWindow;
        if (doc && win) clearHighlights(win, doc);
      } catch {
        /* noop */
      }
      if (doc && doc !== attachedDoc) {
        doc.addEventListener("pointerdown", report, true);
        doc.addEventListener("keydown", onKey, true);
        attachedDoc = doc;
        // Zoom gestures (R8): same-origin frames only — a cross-origin frame
        // never reaches this branch, so its gestures stay with the browser
        // (the accepted platform limit; the chrome control + palette remain).
        attachedGestures = wireGestureListeners(doc);
      }
    };
    const onWindowBlur = () => {
      if (document.activeElement === iframe) report();
    };
    const onLoad = () => attach(true);
    attach(false);
    iframe.addEventListener("load", onLoad);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      iframe.removeEventListener("load", onLoad);
      window.removeEventListener("blur", onWindowBlur);
      attachedGestures?.();
      try {
        attachedDoc?.removeEventListener("pointerdown", report, true);
        attachedDoc?.removeEventListener("keydown", onKey, true);
      } catch {
        /* noop */
      }
    };
    // Keyed on `url`: the frame mounts with its tab (React key), so this is
    // effectively mount-scoped; the dep documents the frame's identity.
  }, [url, wireGestureListeners, interactRef, reclaimRef]);

  // Error-state probes (R8). External absolute URLs: the backend frame-check
  // probe reads the refusal headers cross-origin iframes can't signal.
  // Proxied ports: a same-origin fetch of the proxied path reads the reverse
  // proxy's 502 (nothing listening). Probe results RENDER OVER the iframe
  // area; the iframe stays mounted (hidden) so its listeners survive and a
  // Retry needs no remount. Present/relative kinds never probe.
  const addressKind = classifyAddress(url);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    if (addressKind === "external") {
      let host = url;
      try {
        host = new URL(url).host;
      } catch {
        /* displayForm posture — degrade to raw */
      }
      checkFrame(url).then((res) => {
        if (cancelled) return;
        if (!res.reachable) {
          setTileError({ kind: "unreachable", host, reason: res.reason });
          setLoading(false);
        } else if (!res.embeddable) {
          setTileError({ kind: "refused", host, reason: res.reason });
          setLoading(false);
        } else {
          setTileError(null);
        }
      });
    } else if (addressKind === "proxy") {
      const port = proxyPortOf(url);
      // A same-origin fetch failure is the app server itself being down —
      // not a dead upstream — so it leaves the iframe alone.
      fetch(toProxySrc(url))
        .then((res) => {
          if (cancelled) return;
          if (res.status === 502 && port !== null) {
            setTileError({ kind: "dead-port", port });
            setLoading(false);
          } else {
            setTileError(null);
          }
        })
        .catch(() => {
          if (!cancelled) setTileError(null);
        });
    } else {
      setTileError(null);
    }
    return () => {
      cancelled = true;
    };
  }, [url, active, addressKind, probeNonce]);

  // Real reload (R6): same-origin frames reload their CURRENT location
  // (in-page state and the navigated-to page survive — no reset to the stored
  // address);
  // the about:blank bounce remains ONLY as the cross-origin fallback.
  const refresh = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    setLoading(true);
    if (!crossOrigin) {
      try {
        iframe.contentWindow?.location.reload();
        return;
      } catch {
        /* fall through to the bounce */
      }
    }
    // Force reload by briefly clearing src then re-setting it
    const src = iframe.src;
    iframe.src = "about:blank";
    // Use setTimeout(0) to ensure the browser processes the blank navigation
    setTimeout(() => {
      if (iframeRef.current) {
        iframeRef.current.src = src;
      }
    }, 0);
  }, [crossOrigin]);

  // Back/forward (R5): contentWindow.history, same-origin only (the buttons
  // are hidden when crossOrigin), per-viewer — never a web-option write. A
  // boundary click is a harmless no-op (no canGoBack signal exists).
  const navigate = useCallback((delta: -1 | 1) => {
    try {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      if (delta < 0) win.history.back();
      else win.history.forward();
      setLoading(true);
    } catch {
      /* noop */
    }
  }, []);

  const retry = useCallback(() => {
    setTileError(null);
    setLoading(true);
    setProbeNonce((n) => n + 1);
    refresh();
  }, [refresh]);

  useEffect(() => {
    registerFrame(url, { iframeRef, refresh, retry, navigate });
    return () => unregisterFrame(url);
  }, [url, registerFrame, unregisterFrame, refresh, retry, navigate]);

  return (
    <iframe
      ref={iframeRef}
      src={toProxySrc(url)}
      hidden={!active}
      className={`border-0 ${active && tileError ? "hidden" : ""}`}
      style={
        !active || zoom === 1
          ? { width: "100%", height: "100%" }
          : {
              width: `${100 / zoom}%`,
              height: `${100 / zoom}%`,
              transform: `scale(${zoom})`,
              transformOrigin: "0 0",
            }
      }
      title="Proxied content"
      sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
    />
  );
}

/** Renders a web-tab family with ONE browser-chrome set and one mounted
 *  iframe per tab (P3): back/forward + reload, a display/edit address bar,
 *  find, open-in-browser, a load progress line, explicit error states, and
 *  the tab strip — every chrome control bound to the ACTIVE frame. The
 *  document CustomEvents (`web-find:open`, `web-address:focus`,
 *  `web-open-external`, `web-zoom`) keep exactly one listener here, so one
 *  IframeWindow per layout stays the single receiver. */
export function IframeWindow({
  tabs,
  active,
  onWriteUrl,
  onSelectTab,
  onCloseTab,
  onAddTab,
  onInteract,
  shouldReclaimChord,
  onPageMeta,
}: IframeWindowProps) {
  // Content selector: the family drives everything. Onboarding (the reduced
  // live URL bar + the three fill-path instructions) renders iff the family
  // is EMPTY; with ≥1 tab every frame mounts regardless of the active slot.
  const onboarding = tabs.length === 0;
  const activeIndex = onboarding ? 0 : Math.min(Math.max(active ?? 1, 1), tabs.length);
  const url = activeIndex >= 1 ? (tabs[activeIndex - 1] ?? "") : "";
  const urlRef = useRef(url);
  urlRef.current = url;
  const [inputUrl, setInputUrl] = useState(url);
  // Edit mode (R7): at rest the address bar shows the kind-specific DISPLAY
  // form; focus reveals the raw editable value (select-all). Enter is the ONE
  // write (through `onWriteUrl`); Escape reverts.
  const [editing, setEditing] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // One-shot new-tab arm (the `+` empty/same-draft path): the next Enter
  // routes through onAddTab instead of onWriteUrl; Escape/blur clears it.
  const [newTabArmed, setNewTabArmed] = useState(false);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const interactRef = useRef(onInteract);
  interactRef.current = onInteract;
  const reclaimRef = useRef(shouldReclaimChord);
  reclaimRef.current = shouldReclaimChord;
  const pageMetaRef = useRef(onPageMeta);
  pageMetaRef.current = onPageMeta;

  // ── per-frame state (P3: one chrome, N frames) ──────────────────────────
  // Each WebFrame reports its chrome slice up; the map is keyed by URL (the
  // frame's identity — a remove-shift re-keys by URL, not slot). The chrome
  // below reads ONLY the active frame's entry.
  const [chromeStates, setChromeStates] = useState<ReadonlyMap<string, FrameChromeState>>(
    new Map(),
  );
  const handleChromeState = useCallback((frameUrl: string, state: FrameChromeState) => {
    setChromeStates((prev) => {
      const cur = prev.get(frameUrl);
      if (
        cur &&
        cur.loading === state.loading &&
        cur.crossOrigin === state.crossOrigin &&
        cur.trackedLocation === state.trackedLocation &&
        cur.tileError === state.tileError
      ) {
        return prev;
      }
      const next = new Map(prev);
      next.set(frameUrl, state);
      return next;
    });
  }, []);
  const frameHandles = useRef(new Map<string, FrameHandle>());
  const registerFrame = useCallback((frameUrl: string, handle: FrameHandle) => {
    frameHandles.current.set(frameUrl, handle);
  }, []);
  const unregisterFrame = useCallback((frameUrl: string) => {
    frameHandles.current.delete(frameUrl);
  }, []);

  const activeChrome = url !== "" ? chromeStates.get(url) : undefined;
  const activeLoading = activeChrome?.loading ?? !onboarding;
  const crossOrigin = activeChrome?.crossOrigin ?? false;
  const trackedLocation = activeChrome?.trackedLocation ?? null;
  const tileError = activeChrome?.tileError ?? null;

  // The tile header and the find bar track the ACTIVE tab only: a load on the
  // active frame reports its title up and resets the find state (R8) — the
  // query, matches, and count die with the document they were collected from.
  const handleFrameLoad = useCallback((frameUrl: string, title: string | null) => {
    if (frameUrl !== urlRef.current) return;
    pageMetaRef.current?.({ title });
    setFindQuery("");
    setFindMatches([]);
    setFindActive(0);
  }, []);

  // ── content zoom (260823-cwvv R2/R3; continuous gestures 260824-iafo) ────
  // Per-viewer, per-bucket zoom level: seeded from localStorage, re-seeded
  // whenever the address's bucket changes (a proxied tile navigating ports
  // switches buckets — as does an active-tab change). Never POSTed. Two
  // trigger families: click/shortcut zoom steps the discrete ladder; GESTURES
  // write a continuous float — the Chrome/macOS pinch behavior (quantized
  // pinch visibly "clicks").
  const zoomBucket = webZoomKeyFor(url);
  const [zoom, setZoomState] = useState(() => readWebZoom(zoomBucket));
  // The mirror ref keeps persistence OUT of the setState updater — StrictMode
  // double-invokes updaters, which would duplicate localStorage writes — while
  // burst gesture events still compound correctly between renders.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const zoomBucketRef = useRef(zoomBucket);
  // Gesture persistence is DEBOUNCED (trailing): a pinch emits dozens of
  // events and localStorage-per-event is waste. The pending write FLUSHES
  // (never drops) on bucket change and unmount, so navigating away mid-pinch
  // keeps the final value. Click-path writes stay immediate.
  const zoomPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelZoomPersist = useCallback(() => {
    if (zoomPersistTimerRef.current === null) return;
    clearTimeout(zoomPersistTimerRef.current);
    zoomPersistTimerRef.current = null;
  }, []);
  const flushZoomPersist = useCallback(() => {
    if (zoomPersistTimerRef.current === null) return;
    cancelZoomPersist();
    writeWebZoom(zoomBucketRef.current, zoomRef.current);
  }, [cancelZoomPersist]);
  useEffect(() => flushZoomPersist, [flushZoomPersist]);
  useEffect(() => {
    if (zoomBucketRef.current === zoomBucket) return;
    // The pending write belongs to the OLD bucket — flush before re-seeding.
    flushZoomPersist();
    zoomBucketRef.current = zoomBucket;
    const seeded = readWebZoom(zoomBucket);
    zoomRef.current = seeded;
    setZoomState(seeded);
  }, [zoomBucket, flushZoomPersist]);
  const applyZoom = useCallback(
    (direction: WebZoomDirection) => {
      const prev = zoomRef.current;
      const next =
        direction === "reset" ? WEB_ZOOM_DEFAULT : stepWebZoom(prev, direction);
      if (next === prev) return;
      // The immediate click-path write supersedes any pending gesture write.
      cancelZoomPersist();
      zoomRef.current = next;
      writeWebZoom(zoomBucket, next);
      setZoomState(next);
    },
    [zoomBucket, cancelZoomPersist],
  );
  const applyZoomRef = useRef(applyZoom);
  applyZoomRef.current = applyZoom;
  // The continuous gesture setter: applied per event so the frame tracks the
  // fingers, persisted on the trailing debounce.
  const applyZoomFactor = useCallback((next: number) => {
    const clamped = clampZoom(next, WEB_ZOOM_MIN, WEB_ZOOM_MAX);
    if (clamped === zoomRef.current) return;
    zoomRef.current = clamped;
    setZoomState(clamped);
    if (zoomPersistTimerRef.current !== null) clearTimeout(zoomPersistTimerRef.current);
    zoomPersistTimerRef.current = setTimeout(() => {
      zoomPersistTimerRef.current = null;
      writeWebZoom(zoomBucketRef.current, zoomRef.current);
    }, ZOOM_PERSIST_DEBOUNCE_MS);
  }, []);
  const applyZoomFactorRef = useRef(applyZoomFactor);
  applyZoomFactorRef.current = applyZoomFactor;

  // Gesture plumbing (R6/R8; continuous 260824-iafo): both listener arms (the
  // tile wrapper and the same-origin frame document) apply the continuous
  // mapping per event — no thresholds, no ladder (the ladder is the click
  // path's). Only ctrl/meta-modified wheel and Safari gesture* events are
  // intercepted — everything else passes through untouched. Returns the
  // teardown.
  const wireGestureListeners = useCallback(
    (target: Document | HTMLElement) => {
      // Safari's gesturechange scale is cumulative from gesturestart — capture
      // the base once per pinch and multiply; no accumulator state.
      let gestureBase = zoomRef.current;
      // Typed as Event: the listener must accept the union target's
      // (Document | HTMLElement) common signature, and a frame-document
      // WheelEvent is cross-realm (instanceof narrowing is unreliable) —
      // deltaY/ctrlKey are read defensively, same posture as gesturechange.
      const onWheel = (e: Event) => {
        const wheel = e as Partial<WheelEvent>;
        if (typeof wheel.deltaY !== "number") return;
        if (!wheel.ctrlKey && !wheel.metaKey) return;
        e.preventDefault();
        applyZoomFactorRef.current(
          applyWheelZoom(zoomRef.current, wheel.deltaY, WEB_ZOOM_MIN, WEB_ZOOM_MAX),
        );
      };
      // Safari's gesture* events are non-standard (no DOM-lib typing) — the
      // scale read narrows defensively so a foreign event can't throw.
      // gesturestart must preventDefault too: without it Safari's native
      // pinch page-zoom can engage before the first gesturechange.
      const onGestureStart = (e: Event) => {
        e.preventDefault();
        gestureBase = zoomRef.current;
      };
      const onGestureChange = (e: Event) => {
        const scale = (e as { scale?: unknown }).scale;
        if (typeof scale !== "number") return;
        e.preventDefault();
        applyZoomFactorRef.current(gestureBase * scale);
      };
      target.addEventListener("wheel", onWheel, { passive: false, capture: true });
      target.addEventListener("gesturestart", onGestureStart);
      target.addEventListener("gesturechange", onGestureChange);
      return () => {
        target.removeEventListener("wheel", onWheel, { capture: true });
        target.removeEventListener("gesturestart", onGestureStart);
        target.removeEventListener("gesturechange", onGestureChange);
      };
    },
    [],
  );

  /** The current address in RAW form: the tracked frame location when known,
   *  else the active web tab's address. The ↗ button and the edit reveal read
   *  this. */
  const rawAddress = trackedLocation ?? url;

  // ── find-in-page state (260819-ie2i R5–R8) — one bar, bound to the ACTIVE
  // frame's document ───────────────────────────────────────────────────────
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findMatches, setFindMatches] = useState<Range[]>([]);
  const [findActive, setFindActive] = useState(0);
  // Which highlight path the last apply took — the `window.find()` fallback
  // needs per-step navigation calls the Highlight API does not.
  const highlightApiRef = useRef(false);

  /** The ACTIVE frame's document + window, or null when
   *  unavailable/cross-origin. Same try/catch posture as the attach seam. */
  const findFrame = useCallback((): { doc: Document; win: Window } | null => {
    const iframe = frameHandles.current.get(url)?.iframeRef.current;
    if (!iframe) return null;
    try {
      const doc = iframe.contentDocument;
      const win = iframe.contentWindow;
      return doc && win ? { doc, win } : null;
    } catch {
      return null;
    }
  }, [url]);

  // The `web-find:open` seam (R4): the ⌘F chord handler, the palette action,
  // and any future opener dispatch one document CustomEvent; the mounted web
  // tile is its single receiver (one IframeWindow per layout, regardless of
  // tab count). Onboarding double-guard (260821-zqlq): the event sources are
  // content-gated upstream, but a stale dispatch must no-op on a contentless
  // tile — no bar, no crash.
  useEffect(() => {
    const open = () => {
      if (urlRef.current !== "") setFindOpen(true);
    };
    document.addEventListener(WEB_FIND_OPEN_EVENT, open);
    return () => document.removeEventListener(WEB_FIND_OPEN_EVENT, open);
  }, []);

  // The `web-address:focus` seam (260819-v6y4 R12): ⌘L and the palette action
  // dispatch one document CustomEvent; the mounted web tile focuses its
  // address input (the focus handler enters edit mode + select-all). A
  // `detail.newTab` dispatch additionally arms the one-shot new-tab mode (the
  // palette's `Web: New tab from address` path).
  useEffect(() => {
    const focusAddress = (e: Event) => {
      const input = addressInputRef.current;
      if (!input) return;
      input.focus();
      input.select();
      if ((e as CustomEvent<{ newTab?: unknown }>).detail?.newTab === true) {
        setNewTabArmed(true);
      }
    };
    document.addEventListener(WEB_ADDRESS_FOCUS_EVENT, focusAddress);
    return () => document.removeEventListener(WEB_ADDRESS_FOCUS_EVENT, focusAddress);
  }, []);

  // The `web-open-external` seam (R9): the palette action dispatches one
  // document CustomEvent; the mounted web tile pops its CURRENT address (the
  // tracked frame location when known — it owns that state, the palette
  // doesn't). Relative addresses resolve against the viewer origin.
  useEffect(() => {
    const openExternal = () => {
      window.open(trackedLocation ?? url, "_blank", "noopener");
    };
    document.addEventListener(WEB_OPEN_EXTERNAL_EVENT, openExternal);
    return () => document.removeEventListener(WEB_OPEN_EXTERNAL_EVENT, openExternal);
  }, [trackedLocation, url]);

  // The `web-zoom` seam (R5): the three `Web: Zoom` palette actions dispatch
  // one document CustomEvent (`detail.direction`); the mounted web tile is
  // its single receiver (the `web-find:open` precedent). Onboarding
  // double-guard: the actions are content-gated upstream, but a stale
  // dispatch must no-op on a contentless tile.
  useEffect(() => {
    const onZoom = (e: Event) => {
      if (urlRef.current === "") return;
      const direction = (e as CustomEvent<{ direction?: unknown }>).detail?.direction;
      if (direction === "in" || direction === "out" || direction === "reset") {
        applyZoomRef.current(direction);
      }
    };
    document.addEventListener(WEB_ZOOM_EVENT, onZoom);
    return () => document.removeEventListener(WEB_ZOOM_EVENT, onZoom);
  }, []);

  // Zoom gestures on the tile's own chrome (R8): the URL bar, find bar, and
  // error surface are parent-document DOM, so the wrapper arm covers them —
  // the frame arm (same-origin attach above) covers the page area. Wheel
  // over an iframe never reaches the parent, so both arms are needed.
  const wrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    return wireGestureListeners(wrapper);
  }, [wireGestureListeners]);

  // Autofocus on open is owned by the shared FindBar (it mounts only while
  // the bar is open and focuses its input on mount).

  // Search: re-collect matches when the query (or origin posture) changes
  // while the bar is open; the active match resets to the first.
  useEffect(() => {
    if (!findOpen) return;
    const frame = findFrame();
    if (!frame || crossOrigin) {
      setFindMatches([]);
      setFindActive(0);
      return;
    }
    setFindMatches(collectMatches(frame.doc, findQuery));
    setFindActive(0);
  }, [findQuery, findOpen, crossOrigin, findFrame]);

  // Highlight: apply (or clear) the frame highlights whenever the match set,
  // the active index, or the bar's open state changes. Closing the bar or an
  // empty/zero-match query clears all highlights (R5 Escape contract).
  useEffect(() => {
    const frame = findFrame();
    if (!frame) return;
    if (!findOpen || findMatches.length === 0) {
      clearHighlights(frame.win, frame.doc);
      highlightApiRef.current = false;
      return;
    }
    const applied = applyHighlights(frame.win, frame.doc, findMatches, findActive);
    highlightApiRef.current = applied;
    const active = findMatches[findActive];
    if (applied && active) scrollToMatch(active);
    else if (!applied) findWithWindow(frame.win, findQuery, false);
  }, [findMatches, findActive, findOpen, findQuery, findFrame]);

  const stepFind = useCallback(
    (delta: 1 | -1) => {
      if (findMatches.length === 0) return;
      setFindActive((a) => stepMatch(a, findMatches.length, delta));
      // The window.find() fallback navigates per step; the Highlight API path
      // re-applies via the effect above.
      if (!highlightApiRef.current) {
        const frame = findFrame();
        if (frame) findWithWindow(frame.win, findQuery, delta === -1);
      }
    },
    [findMatches.length, findQuery, findFrame],
  );

  // Sync the URL bar text when the active address changes externally (an SSE
  // push, a tab select, or a same-slot replace). The iframe side needs no
  // sync: a changed tab URL re-keys (remounts) exactly that frame.
  useEffect(() => {
    setInputUrl(url);
    setSubmitError(null);
  }, [url]);

  const handleRefresh = useCallback(() => {
    frameHandles.current.get(url)?.refresh();
  }, [url]);

  const handleRetry = useCallback(() => {
    frameHandles.current.get(url)?.retry();
  }, [url]);

  const navigateFrameHistory = useCallback(
    (delta: -1 | 1) => {
      frameHandles.current.get(url)?.navigate(delta);
    },
    [url],
  );

  // Open in browser (R9): the CURRENT address in a new tab — relative
  // addresses resolve naturally against the viewer's origin (stored web
  // addresses stay relative per the display contract).
  const handleOpenExternal = useCallback(() => {
    window.open(rawAddress, "_blank", "noopener");
  }, [rawAddress]);

  // Declared add (`+` / armed Enter): the server assigns the slot; the
  // client selects it afterwards because the add verb selects only an empty
  // family ("add is not show").
  const submitNewTab = useCallback(
    (target: string) => {
      if (!onAddTab) return;
      onAddTab(target)
        .then(({ index }) => onSelectTab?.(index))
        .catch((err: unknown) => {
          setSubmitError(err instanceof Error ? err.message : String(err));
        });
    },
    [onAddTab, onSelectTab],
  );

  const handleAddTabClick = useCallback(() => {
    if (!onAddTab) return;
    setSubmitError(null);
    const draft = normalizeAddressInput(inputUrl);
    if (draft === "" || draft === url) {
      // Nothing new to add — focus the bar and arm the one-shot new-tab mode
      // so the next Enter adds instead of replacing.
      setNewTabArmed(true);
      const input = addressInputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
      return;
    }
    submitNewTab(draft);
  }, [inputUrl, url, onAddTab, submitNewTab]);

  const handleSubmit = useCallback(() => {
    const normalized = normalizeAddressInput(inputUrl);
    if (!normalized) return;
    // Frontend mirror of the backend scheme allowlist (R4): invalid schemes
    // surface inline and fire NO POST; the backend remains enforcement.
    if (!isAllowedUrl(normalized)) {
      setSubmitError("must be an http(s) URL or a /path");
      return;
    }
    setSubmitError(null);
    setEditing(false);
    addressInputRef.current?.blur();
    if (newTabArmed) {
      setNewTabArmed(false);
      submitNewTab(normalized);
      return;
    }
    // Same-URL submit is a no-op — re-submitting the stored address never
    // POSTs.
    if (normalized === url) return;
    onWriteUrl?.(normalized)?.catch(() => {
      // Revert input on failure
      setInputUrl(url);
    });
  }, [inputUrl, newTabArmed, onWriteUrl, submitNewTab, url]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === "Escape") {
        // Revert to the rest display form without a POST; the new-tab arm
        // dies with the edit.
        e.preventDefault();
        setNewTabArmed(false);
        setInputUrl(rawAddress);
        setSubmitError(null);
        setEditing(false);
        addressInputRef.current?.blur();
      }
    },
    [handleSubmit, rawAddress],
  );

  // Select-all once edit mode's raw value has rendered (the focus event fires
  // with the DISPLAY value still in the input — the selection must wait a
  // commit).
  useEffect(() => {
    if (editing) addressInputRef.current?.select();
  }, [editing]);

  // ── tab strip (renders only at ≥2 tabs; below, the DOM is the single-tab
  // chrome) — a roving-focus tablist: only the ACTIVE tab is in the tab
  // order, ←/→/Home/End move focus without writing, Enter/Space select,
  // Delete/Backspace close. Focused-but-not-active is a viewer posture. ────
  const coarsePointer = useCoarsePointer();
  const tabRefs = useRef(new Map<number, HTMLElement>());
  const [focusedTab, setFocusedTab] = useState(0); // 0 = none
  useEffect(() => {
    if (focusedTab < 1 || focusedTab > tabs.length) return;
    tabRefs.current.get(focusedTab)?.focus();
  }, [focusedTab, tabs.length]);
  const handleTabKeyDown = (e: React.KeyboardEvent) => {
    const count = tabs.length;
    if (count === 0) return;
    const current = focusedTab >= 1 && focusedTab <= count ? focusedTab : activeIndex;
    let next = 0;
    switch (e.key) {
      case "ArrowLeft":
        next = Math.max(1, current - 1);
        break;
      case "ArrowRight":
        next = Math.min(count, current + 1);
        break;
      case "Home":
        next = 1;
        break;
      case "End":
        next = count;
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        onSelectTab?.(current);
        return;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        onCloseTab?.(current);
        return;
      default:
        return;
    }
    e.preventDefault();
    setFocusedTab(next);
  };

  const stripFull = tabs.length >= WEB_TAB_FAMILY_CAP;

  return (
    <div ref={wrapperRef} className="flex flex-col flex-1 min-h-0">
      {tabs.length >= WEB_TAB_STRIP_MIN && (
        <TipGroup>
          <div
            role="tablist"
            data-testid="web-tab-strip"
            className="shrink-0 flex items-stretch gap-px px-1 border-b border-border bg-bg-card overflow-x-auto font-mono text-[11px] select-none"
          >
            {tabs.map((tabUrl, i) => {
              const n = i + 1;
              const isActive = n === activeIndex;
              const kind = classifyAddress(tabUrl);
              const label = webTabTitle(tabUrl) || `#${n}`;
              return (
                <div
                  key={tabUrl}
                  ref={(el) => {
                    if (el) tabRefs.current.set(n, el);
                    else tabRefs.current.delete(n);
                  }}
                  role="tab"
                  aria-selected={isActive}
                  data-testid="web-tab"
                  data-index={n}
                  tabIndex={isActive ? 0 : -1}
                  title={displayForm(tabUrl)}
                  onClick={() => onSelectTab?.(n)}
                  onFocus={() => setFocusedTab(n)}
                  onKeyDown={handleTabKeyDown}
                  className={`group flex items-center gap-1.5 px-2 py-1 cursor-pointer outline-none ${
                    isActive
                      ? "bg-bg-primary text-text-primary"
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {kind !== "relative" && (
                    <span
                      aria-hidden="true"
                      className={`shrink-0 inline-block w-1.5 h-1.5 rounded-full ${KIND_DOT_CLASS[kind]}`}
                    />
                  )}
                  <span className="whitespace-nowrap">{label}</span>
                  {onCloseTab && (
                    <button
                      type="button"
                      aria-label={`Close web tab ${n}`}
                      data-testid="web-tab-close"
                      tabIndex={-1}
                      onClick={(e) => {
                        e.stopPropagation();
                        onCloseTab(n);
                      }}
                      className={`shrink-0 rounded px-0.5 hover:text-text-primary ${
                        isActive || coarsePointer
                          ? ""
                          : "invisible group-hover:visible group-focus-within:visible"
                      }`}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
            {onAddTab && (
              <Tip label={stripFull ? `web tabs full (${WEB_TAB_FAMILY_CAP})` : undefined}>
                <button
                  type="button"
                  aria-label="Add web tab from address"
                  data-testid="web-tab-add"
                  disabled={stripFull}
                  // Keep the address bar's focus (and its draft) through the
                  // click — a blur would revert the input to the rest value.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={handleAddTabClick}
                  className="self-center shrink-0 w-6 h-6 mx-1 flex items-center justify-center rounded text-text-secondary enabled:hover:bg-bg-inset enabled:hover:text-text-primary disabled:opacity-50"
                >
                  +
                </button>
              </Tip>
            )}
          </div>
        </TipGroup>
      )}

      {/* URL Bar — one warm-tip cluster (260722-73al). Button order per the
          approved design study: ◀ ▶ ↻ [address] ⌕ ↗ (the `>_` switch-to-
          terminal button was removed, 260819-v6y4 R13 — the top-bar surface
          toggles own view switching). */}
      <TipGroup>
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border bg-bg-primary shrink-0">
        {!onboarding && !crossOrigin && (
          <>
            <Tip label="Back">
              <button
                onClick={() => navigateFrameHistory(-1)}
                className="shrink-0 w-7 h-7 flex items-center justify-center rounded hover:bg-bg-card text-text-secondary hover:text-text-primary"
                aria-label="Back"
              >
                <WebBackGlyph />
              </button>
            </Tip>
            <Tip label="Forward">
              <button
                onClick={() => navigateFrameHistory(1)}
                className="shrink-0 w-7 h-7 flex items-center justify-center rounded hover:bg-bg-card text-text-secondary hover:text-text-primary"
                aria-label="Forward"
              >
                <WebForwardGlyph />
              </button>
            </Tip>
          </>
        )}
        <Tip label="Refresh">
          <button
            onClick={handleRefresh}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded hover:bg-bg-card text-text-secondary hover:text-text-primary"
            aria-label="Refresh"
          >
            <RefreshGlyph />
          </button>
        </Tip>
        <input
          ref={addressInputRef}
          type="text"
          value={editing ? inputUrl : displayForm(rawAddress)}
          placeholder={onboarding ? "localhost:3000 · /present/… · https://…" : undefined}
          onChange={(e) => {
            setInputUrl(e.target.value);
            setSubmitError(null);
          }}
          onFocus={() => {
            setInputUrl(rawAddress);
            setEditing(true);
          }}
          onBlur={() => {
            setEditing(false);
            setSubmitError(null);
            setInputUrl(rawAddress);
            setNewTabArmed(false);
          }}
          onKeyDown={handleKeyDown}
          className="flex-1 min-w-0 bg-bg-card text-text-primary text-sm px-2 py-1 rounded border border-border outline-none focus:border-text-secondary"
          aria-label="URL"
          aria-invalid={submitError !== null}
          spellCheck={false}
        />
        {submitError && (
          <span role="alert" className="shrink-0 text-signal-red text-xs select-none">
            {submitError}
          </span>
        )}
        {!onboarding && (
          <>
            <Tip label="Find in page">
              <button
                onClick={() => setFindOpen((o) => !o)}
                className={`shrink-0 w-7 h-7 flex items-center justify-center rounded hover:bg-bg-card hover:text-text-primary ${findOpen ? "text-accent-green" : "text-text-secondary"}`}
                aria-label="Find in page"
                aria-pressed={findOpen}
              >
                <FindGlyph />
              </button>
            </Tip>
            {/* Content zoom (R4) — the universal floor trigger: the only one
                that works over an external frame (gestures never cross the
                boundary). Text glyphs per the URL-bar vocabulary; the readout
                doubles as the reset affordance, enabled only when s ≠ 1. */}
            <div className="shrink-0 flex items-center" data-testid="web-zoom-control">
              <Tip label="Zoom out">
                <button
                  onClick={() => applyZoom("out")}
                  className="w-7 h-7 flex items-center justify-center rounded hover:bg-bg-card text-text-secondary hover:text-text-primary"
                  aria-label="Zoom out"
                >
                  −
                </button>
              </Tip>
              <Tip label={zoom === 1 ? "Zoom 100%" : "Reset zoom"}>
                <button
                  onClick={() => applyZoom("reset")}
                  disabled={zoom === 1}
                  className="h-7 min-w-11 px-1 flex items-center justify-center rounded text-xs tabular-nums text-text-secondary enabled:hover:bg-bg-card enabled:hover:text-text-primary disabled:opacity-60"
                  aria-label="Reset zoom"
                >
                  {Math.round(zoom * 100)}%
                </button>
              </Tip>
              <Tip label="Zoom in">
                <button
                  onClick={() => applyZoom("in")}
                  className="w-7 h-7 flex items-center justify-center rounded hover:bg-bg-card text-text-secondary hover:text-text-primary"
                  aria-label="Zoom in"
                >
                  +
                </button>
              </Tip>
            </div>
            <Tip label="Open in browser">
              <button
                onClick={handleOpenExternal}
                className="shrink-0 w-7 h-7 flex items-center justify-center rounded hover:bg-bg-card text-text-secondary hover:text-text-primary"
                aria-label="Open in browser"
              >
                <OpenExternalGlyph />
              </button>
            </Tip>
          </>
        )}
      </div>
      </TipGroup>

      {/* Find bar (260819-ie2i R5/R7) — a row below the URL bar per the
          approved design study (state 03), rendered by the shared FindBar;
          this consumer owns the contentDocument search mechanism and keeps
          the `web-find-bar` testid. Cross-origin frames render it disabled
          with the hint. */}
      {findOpen && !onboarding && (
        <FindBar
          query={findQuery}
          matchIndex={findActive}
          matchCount={findMatches.length}
          onQueryChange={setFindQuery}
          onNext={() => stepFind(1)}
          onPrev={() => stepFind(-1)}
          onClose={() => setFindOpen(false)}
          disabled={crossOrigin}
          statusText={crossOrigin ? "page is cross-origin — find unavailable" : undefined}
          placeholder="Find in page"
          testId="web-find-bar"
        />
      )}

      {/* Load progress line (R11): the 2px indeterminate sweep on the
          content's top edge while the ACTIVE frame loads; zeroed under
          prefers-reduced-motion (globals.css). */}
      {activeLoading && !onboarding && <div className="rk-web-progress" data-testid="web-load-progress" />}

      {/* Error states (R8) render in place of the ACTIVE iframe's VISIBLE
          area (the iframe stays mounted but hidden so its listeners survive
          a Retry). Copy per the approved design study (states 05/06). */}
      {tileError && (
        <div
          className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2.5 text-center px-6"
          data-testid="web-tile-error"
        >
          <span className="text-2xl text-text-secondary select-none" aria-hidden="true">
            {tileError.kind === "refused" ? "⊘" : "⚡"}
          </span>
          <span className="text-text-primary text-sm">
            {tileError.kind === "refused"
              ? `${tileError.host} refuses embedding`
              : tileError.kind === "unreachable"
                ? `${tileError.host} can't be reached`
                : `nothing listening on :${tileError.port}`}
          </span>
          <span className="text-text-secondary text-xs">
            {tileError.kind === "refused"
              ? `${tileError.reason} — this site can't render inside a tile`
              : tileError.kind === "unreachable"
                ? tileError.reason
                : "connection refused — the dev server may have stopped"}
          </span>
          {tileError.kind === "dead-port" ? (
            <button
              onClick={handleRetry}
              className="mt-1 px-3.5 h-[30px] rounded border border-border text-accent-green text-sm hover:bg-bg-card"
              aria-label="Retry"
            >
              ↻ Retry
            </button>
          ) : (
            <button
              onClick={handleOpenExternal}
              className="mt-1 px-3.5 h-[30px] rounded border border-border text-accent-green text-sm hover:bg-bg-card"
              aria-label="Open in browser"
            >
              Open in browser ↗
            </button>
          )}
        </div>
      )}

      {/* Onboarding (260821-zqlq): an EMPTY web-tab family selects this
          content state in place of the frames + probe machinery — the web
          lens is always tileable, and this panel is its discoverability
          surface. Copy per the user-approved mock. The address bar above
          stays fully live: an Enter submit boots the tile for real. */}
      {onboarding ? (
        <div
          className="flex-1 min-h-0 flex flex-col items-center justify-center gap-1 px-6 py-6 bg-bg-primary overflow-y-auto"
          data-testid="web-tile-onboarding"
        >
          <span
            className="text-[26px] tracking-widest text-text-secondary/55 select-none mb-2"
            aria-hidden="true"
          >
            ://
          </span>
          <span className="text-text-primary text-[13px]">Nothing to show yet</span>
          <span className="text-text-secondary text-[11px] text-center mb-5">
            this tile follows the window&apos;s active web tab (@rk_win_web_N) — three ways to fill it:
          </span>
          <div className="flex flex-col gap-3 w-full max-w-[440px]">
            <div className="flex gap-2.5 items-start">
              <span className="w-[22px] shrink-0 text-center text-accent-green text-xs pt-px select-none" aria-hidden="true">
                ❯
              </span>
              <span className="text-text-secondary text-[11.5px] leading-relaxed">
                <b className="text-text-primary font-semibold">Ask your agent to show something.</b>{" "}
                &quot;Present this as a page&quot; — the agent runs{" "}
                <code className="bg-bg-inset border border-border rounded px-[5px] text-[10.5px] text-text-primary whitespace-nowrap">
                  rk present ./report.html
                </code>{" "}
                and it appears here. Works for HTML files, diagrams, mocks, directories.
              </span>
            </div>
            <div className="flex gap-2.5 items-start">
              <span className="w-[22px] shrink-0 text-center text-accent-green text-xs pt-px select-none" aria-hidden="true">
                ⇄
              </span>
              <span className="text-text-secondary text-[11.5px] leading-relaxed">
                <b className="text-text-primary font-semibold">Preview a dev server.</b> Type{" "}
                <code className="bg-bg-inset border border-border rounded px-[5px] text-[10.5px] text-text-primary whitespace-nowrap">
                  localhost:3000
                </code>{" "}
                in the address bar above (proxied through run-kit, works from any device) — or have the agent run{" "}
                <code className="bg-bg-inset border border-border rounded px-[5px] text-[10.5px] text-text-primary whitespace-nowrap">
                  rk present :3000
                </code>
                .
              </span>
            </div>
            <div className="flex gap-2.5 items-start">
              <span className="w-[22px] shrink-0 text-center text-accent-green text-xs pt-px select-none" aria-hidden="true">
                ↗
              </span>
              <span className="text-text-secondary text-[11.5px] leading-relaxed">
                <b className="text-text-primary font-semibold">Open any URL.</b> Type an address above — external
                sites embed when they allow it; find-in-page (⌘F) and back/forward work on same-origin pages.
              </span>
            </div>
          </div>
          <span className="text-text-secondary/75 text-[10px] text-center mt-5">
            the tile goes live automatically when an address lands{" "}
            <span className="text-accent-green" aria-hidden="true">●</span> no reload needed
          </span>
        </div>
      ) : (
        // Scale wrapper (R2): the ACTIVE iframe renders at 1/s of the tile
        // scaled back up by s, so the guest's CSS viewport shrinks/grows like
        // real browser zoom — responsive layouts adapt, and the mechanism
        // works for every address kind without reaching into the guest
        // document. At s = 1 no transform is applied — identical layout to
        // before. Every tab's frame stays mounted (P3 — hidden, never
        // unmounted); a selection change re-keys nothing and rewrites no src.
        <div
          className="flex-1 min-h-0 overflow-hidden"
          data-testid="web-zoom-frame-wrapper"
          data-zoom={zoom}
        >
          {tabs.map((tabUrl, i) => (
            <WebFrame
              key={tabUrl}
              url={tabUrl}
              active={i + 1 === activeIndex}
              zoom={zoom}
              wireGestureListeners={wireGestureListeners}
              onChromeState={handleChromeState}
              onFrameLoad={handleFrameLoad}
              registerFrame={registerFrame}
              unregisterFrame={unregisterFrame}
              interactRef={interactRef}
              reclaimRef={reclaimRef}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Tab-strip kind dot — the tile-header badge hues (green present / yellow
 *  proxy / blue external); the relative kind renders no dot. */
const KIND_DOT_CLASS: Record<AddressKind, string> = {
  present: "bg-accent-green",
  proxy: "bg-signal-yellow",
  external: "bg-signal-blue",
  relative: "",
};

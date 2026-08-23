import { useState, useRef, useCallback, useEffect } from "react";
import { checkFrame, updateWindowUrl } from "@/api/client";
import { useSessionContext } from "@/contexts/session-context";
import { Tip, TipGroup } from "@/components/tip";
import { FindBar } from "@/components/find-bar";
import {
  FindGlyph,
  OpenExternalGlyph,
  RefreshGlyph,
  WebBackGlyph,
  WebForwardGlyph,
} from "@/components/top-bar-icons";
import {
  WEB_ADDRESS_FOCUS_EVENT,
  WEB_OPEN_EXTERNAL_EVENT,
  classifyAddress,
  displayForm,
  isAllowedUrl,
  normalizeAddressInput,
  proxyPortOf,
  toProxySrc,
} from "@/lib/web-url";
import {
  WEB_ZOOM_EVENT,
  readWebZoom,
  stepWebZoom,
  webZoomKeyFor,
  writeWebZoom,
  type WebZoomDirection,
} from "@/lib/web-zoom";
import { createGestureArm, createWheelAccumulator } from "@/lib/zoom-gesture";
import { hasWebUrl } from "@/lib/window-view";
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
  windowId: string;
  rkUrl: string;
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
  /** Page-meta seam (260819-v6y4 R10): fired on every frame `load` with the
   *  same-origin document's title, `null` when cross-origin or empty. The
   *  header (SurfaceLayout) owns the render, but only the mounted iframe can
   *  read `contentDocument.title` — the `onInteract`/`onFolderNavigated`
   *  callback-seam shape. Absent ⇒ no reporting. */
  onPageMeta?: (meta: { title: string | null }) => void;
}

/** The tile's error surface (260819-v6y4 R8) — rendered IN PLACE of the
 *  iframe's visible area; copy per the approved design study (states 05/06).
 *  A silent blank iframe is no longer a reachable state for a probed-blocked
 *  external URL or a dead proxied port. */
type TileError =
  | { kind: "refused"; host: string; reason: string }
  | { kind: "unreachable"; host: string; reason: string }
  | { kind: "dead-port"; port: number };

/** Renders an iframe with browser chrome: back/forward + reload, a
 *  display/edit address bar, find, open-in-browser, a load progress line, and
 *  explicit error states. */
export function IframeWindow({
  windowId,
  rkUrl,
  onInteract,
  shouldReclaimChord,
  onPageMeta,
}: IframeWindowProps) {
  // IframeWindow renders only from AppShell terminal routes where currentServer
  // is set. Fall back to empty string when null (action no-ops with bad server).
  const { currentServer } = useSessionContext();
  const server = currentServer ?? "";
  // Content selector (260821-zqlq): web availability is unconditional — an
  // empty/whitespace @rk_url renders the ONBOARDING state (reduced live URL
  // bar + the three fill-path instructions) in place of the iframe and its
  // probe machinery; hasWebUrl's trim rule is the single source.
  const onboarding = !hasWebUrl({ rkUrl });
  const [inputUrl, setInputUrl] = useState(rkUrl);
  // Edit mode (R7): at rest the address bar shows the kind-specific DISPLAY
  // form; focus reveals the raw editable value (select-all). Enter is the ONE
  // write to @rk_url; Escape reverts.
  const [editing, setEditing] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Per-viewer current-path tracking (R7): the same-origin frame's location,
  // read on its `load` events and kept in root-relative form (the viewer
  // origin stripped). Display-only — NEVER POSTed (spec window-views R7).
  const [trackedLocation, setTrackedLocation] = useState<string | null>(null);
  // Load feedback (R11): set on src change/reload, cleared on `load`.
  const [loading, setLoading] = useState(true);
  const [tileError, setTileError] = useState<TileError | null>(null);
  // Bumped by the dead-port Retry button to re-run detection + reload.
  const [probeNonce, setProbeNonce] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const currentSrcRef = useRef(rkUrl);
  const interactRef = useRef(onInteract);
  interactRef.current = onInteract;
  const reclaimRef = useRef(shouldReclaimChord);
  reclaimRef.current = shouldReclaimChord;
  const pageMetaRef = useRef(onPageMeta);
  pageMetaRef.current = onPageMeta;

  // ── content zoom (260823-cwvv R2/R3) ────────────────────────────────────
  // Per-viewer, per-bucket zoom level: seeded from localStorage, re-seeded
  // whenever the address's bucket changes (a proxied tile navigating ports
  // switches buckets), persisted on every change. Never POSTed.
  const zoomBucket = webZoomKeyFor(rkUrl);
  const [zoom, setZoomState] = useState(() => readWebZoom(zoomBucket));
  const zoomBucketRef = useRef(zoomBucket);
  useEffect(() => {
    if (zoomBucketRef.current === zoomBucket) return;
    zoomBucketRef.current = zoomBucket;
    setZoomState(readWebZoom(zoomBucket));
  }, [zoomBucket]);
  const applyZoom = useCallback(
    (direction: WebZoomDirection) => {
      setZoomState((prev) => {
        const next =
          direction === "reset" ? 1 : stepWebZoom(prev, direction);
        if (next === prev) return prev;
        writeWebZoom(webZoomKeyFor(rkUrl), next);
        return next;
      });
    },
    [rkUrl],
  );
  const applyZoomRef = useRef(applyZoom);
  applyZoomRef.current = applyZoom;

  // Gesture→step plumbing (R6/R8): both listener arms (the tile wrapper and
  // the same-origin frame document) share the zoom-gesture reduction. Only
  // ctrl/meta-modified wheel and Safari gesture* events are intercepted —
  // everything else passes through untouched. Returns the teardown.
  const applyGestureSteps = useCallback((steps: number) => {
    const direction: WebZoomDirection = steps > 0 ? "in" : "out";
    for (let i = 0; i < Math.abs(steps); i++) applyZoomRef.current(direction);
  }, []);
  const wireGestureListeners = useCallback(
    (target: Document | HTMLElement) => {
      const feed = createWheelAccumulator();
      const arm = createGestureArm();
      // Typed as Event: the listener must accept the union target's
      // (Document | HTMLElement) common signature, and a frame-document
      // WheelEvent is cross-realm (instanceof narrowing is unreliable) —
      // deltaY/ctrlKey are read defensively, same posture as gesturechange.
      const onWheel = (e: Event) => {
        const wheel = e as Partial<WheelEvent>;
        if (typeof wheel.deltaY !== "number") return;
        if (!wheel.ctrlKey && !wheel.metaKey) return;
        e.preventDefault();
        applyGestureSteps(feed(wheel.deltaY));
      };
      // Safari's gesture* events are non-standard (no DOM-lib typing) — the
      // scale read narrows defensively so a foreign event can't throw.
      const onGestureStart = () => arm.reset();
      const onGestureChange = (e: Event) => {
        const scale = (e as { scale?: unknown }).scale;
        if (typeof scale !== "number") return;
        e.preventDefault();
        applyGestureSteps(arm.change(scale));
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
    [applyGestureSteps],
  );

  /** The current address in RAW form: the tracked frame location when known,
   *  else the stored @rk_url. The ↗ button and the edit reveal read this. */
  const rawAddress = trackedLocation ?? rkUrl;

  // ── find-in-page state (260819-ie2i R5–R8) ──────────────────────────────
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findMatches, setFindMatches] = useState<Range[]>([]);
  const [findActive, setFindActive] = useState(0);
  // Cross-origin frames reject contentDocument/location access — no reclaim,
  // no search; the find bar renders disabled with the hint (R7). Back/forward
  // hide and reload degrades to the about:blank bounce on the same signal.
  const [crossOrigin, setCrossOrigin] = useState(false);
  // Which highlight path the last apply took — the `window.find()` fallback
  // needs per-step navigation calls the Highlight API does not.
  const highlightApiRef = useRef(false);

  /** The frame's document + window, or null when unavailable/cross-origin.
   *  Same try/catch posture as the attach seam. */
  const findFrame = useCallback((): { doc: Document; win: Window } | null => {
    const iframe = iframeRef.current;
    if (!iframe) return null;
    try {
      const doc = iframe.contentDocument;
      const win = iframe.contentWindow;
      return doc && win ? { doc, win } : null;
    } catch {
      return null;
    }
  }, []);

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
  // the page title through onPageMeta — all same-origin-gated reads with the
  // attach seam's try/catch posture.
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
        // relative @rk_url. about:blank (the cross-origin reload bounce's
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
          pageMetaRef.current?.({ title: doc.title !== "" ? doc.title : null });
        } else {
          pageMetaRef.current?.({ title: null });
        }
      }
      // R8 reset — no stale highlight or count survives a navigation, and the
      // search term does not persist.
      setFindQuery("");
      setFindMatches([]);
      setFindActive(0);
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
    // Keyed on `onboarding`: the iframe mounts only outside onboarding, so
    // the empty-deps mount would strand every seam (load, reclaim, page meta)
    // on a tile that booted as onboarding and flipped live later.
  }, [onboarding, wireGestureListeners]);

  // The `web-find:open` seam (R4): the ⌘F chord handler, the palette action,
  // and any future opener dispatch one document CustomEvent; the mounted web
  // tile is its single receiver (at most one web tile per layout). Onboarding
  // double-guard (260821-zqlq): the event sources are content-gated upstream,
  // but a stale dispatch must no-op on a contentless tile — no bar, no crash.
  useEffect(() => {
    const open = () => {
      if (hasWebUrl({ rkUrl })) setFindOpen(true);
    };
    document.addEventListener(WEB_FIND_OPEN_EVENT, open);
    return () => document.removeEventListener(WEB_FIND_OPEN_EVENT, open);
  }, [rkUrl]);

  // The `web-address:focus` seam (260819-v6y4 R12): ⌘L and the palette action
  // dispatch one document CustomEvent; the mounted web tile focuses its
  // address input (the focus handler enters edit mode + select-all).
  useEffect(() => {
    const focusAddress = () => {
      const input = addressInputRef.current;
      if (!input) return;
      input.focus();
      input.select();
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
      window.open(trackedLocation ?? rkUrl, "_blank", "noopener");
    };
    document.addEventListener(WEB_OPEN_EXTERNAL_EVENT, openExternal);
    return () => document.removeEventListener(WEB_OPEN_EXTERNAL_EVENT, openExternal);
  }, [trackedLocation, rkUrl]);

  // The `web-zoom` seam (R5): the three `Web: Zoom` palette actions dispatch
  // one document CustomEvent (`detail.direction`); the mounted web tile is
  // its single receiver (the `web-find:open` precedent). Onboarding
  // double-guard: the actions are content-gated upstream, but a stale
  // dispatch must no-op on a contentless tile.
  useEffect(() => {
    const onZoom = (e: Event) => {
      if (!hasWebUrl({ rkUrl })) return;
      const direction = (e as CustomEvent<{ direction?: unknown }>).detail?.direction;
      if (direction === "in" || direction === "out" || direction === "reset") {
        applyZoomRef.current(direction);
      }
    };
    document.addEventListener(WEB_ZOOM_EVENT, onZoom);
    return () => document.removeEventListener(WEB_ZOOM_EVENT, onZoom);
  }, [rkUrl]);

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

  // Sync URL bar text and iframe src when rkUrl changes externally (SSE push).
  // Only update iframe src when the URL has actually changed to avoid unnecessary reloads.
  useEffect(() => {
    setInputUrl(rkUrl);
    setTrackedLocation(null);
    setSubmitError(null);
    if (rkUrl !== currentSrcRef.current) {
      currentSrcRef.current = rkUrl;
      setLoading(true);
      if (iframeRef.current) {
        iframeRef.current.src = toProxySrc(rkUrl);
      }
    }
  }, [rkUrl]);

  // Error-state probes (R8). External absolute URLs: the backend frame-check
  // probe reads the refusal headers cross-origin iframes can't signal.
  // Proxied ports: a same-origin fetch of the proxied path reads the reverse
  // proxy's 502 (nothing listening). Probe results RENDER OVER the iframe
  // area; the iframe stays mounted (hidden) so its listeners survive and a
  // Retry needs no remount. Present/relative kinds never probe.
  const addressKind = classifyAddress(rkUrl);
  useEffect(() => {
    let cancelled = false;
    if (addressKind === "external") {
      let host = rkUrl;
      try {
        host = new URL(rkUrl).host;
      } catch {
        /* displayForm posture — degrade to raw */
      }
      checkFrame(rkUrl).then((res) => {
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
      const port = proxyPortOf(rkUrl);
      // A same-origin fetch failure is the app server itself being down —
      // not a dead upstream — so it leaves the iframe alone.
      fetch(toProxySrc(rkUrl))
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
  }, [rkUrl, addressKind, probeNonce]);

  // Real reload (R6): same-origin frames reload their CURRENT location
  // (in-page state and the navigated-to page survive — no reset to @rk_url);
  // the about:blank bounce remains ONLY as the cross-origin fallback.
  const handleRefresh = useCallback(() => {
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
  // are hidden when crossOrigin), per-viewer — never an @rk_url write. A
  // boundary click is a harmless no-op (no canGoBack signal exists).
  const navigateFrameHistory = useCallback((delta: -1 | 1) => {
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

  // Open in browser (R9): the CURRENT address in a new tab — relative
  // addresses resolve naturally against the viewer's origin (the stored
  // @rk_url stays relative per the display contract).
  const handleOpenExternal = useCallback(() => {
    window.open(rawAddress, "_blank", "noopener");
  }, [rawAddress]);

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
    updateWindowUrl(server, windowId, normalized).catch(() => {
      // Revert input on failure
      setInputUrl(rkUrl);
    });
  }, [inputUrl, server, windowId, rkUrl]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === "Escape") {
        // Revert to the rest display form without a POST.
        e.preventDefault();
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

  return (
    <div ref={wrapperRef} className="flex flex-col flex-1 min-h-0">
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
          content's top edge while the frame loads; zeroed under
          prefers-reduced-motion (globals.css). */}
      {loading && !onboarding && <div className="rk-web-progress" data-testid="web-load-progress" />}

      {/* Error states (R8) render in place of the iframe's VISIBLE area (the
          iframe stays mounted but hidden so its listeners survive a Retry).
          Copy per the approved design study (states 05/06). */}
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
              onClick={() => {
                setTileError(null);
                setLoading(true);
                setProbeNonce((n) => n + 1);
                handleRefresh();
              }}
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

      {/* Onboarding (260821-zqlq): an empty/whitespace @rk_url selects this
          content state in place of the iframe + probe machinery — the web
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
            this tile follows the window&apos;s web address (@rk_url) — three ways to fill it:
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
        // Scale wrapper (R2): the iframe renders at 1/s of the tile scaled
        // back up by s, so the guest's CSS viewport shrinks/grows like real
        // browser zoom — responsive layouts adapt, and the mechanism works
        // for every address kind without reaching into the guest document.
        // At s = 1 no transform is applied — identical layout to before.
        <div
          className="flex-1 min-h-0 overflow-hidden"
          data-testid="web-zoom-frame-wrapper"
          data-zoom={zoom}
        >
          <iframe
            ref={iframeRef}
            src={toProxySrc(rkUrl)}
            className={`border-0 ${tileError ? "hidden" : ""}`}
            style={
              zoom === 1
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
        </div>
      )}
    </div>
  );
}

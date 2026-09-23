import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { checkFrame } from "@/api/client";
import { appSrc, classifyAddress, proxyPortOf, toProxySrc } from "@/lib/web-url";
import {
  applyHighlights,
  clearHighlights,
  collectMatches,
  findWithWindow,
  scrollToMatch,
  stepMatch,
} from "@/lib/find-in-page";
import {
  redispatchChord,
  type FindOptions,
  type TileError,
  type WebFrameCapabilities,
  type WebFrameEngineProps,
} from "@/lib/web-frame-engine";

/** The capabilities the iframe engine reports before its first attach probe
 *  resolves — the chrome seeds its pre-report render from this so the first
 *  paint matches a same-origin frame's. The knowledge lives here, never in
 *  the chrome. */
export const WEB_FRAME_IFRAME_DEFAULT_CAPABILITIES: WebFrameCapabilities = {
  history: true,
  find: true,
  meta: true,
  zoomGestures: true,
  devtools: false,
};

/** One mounted web tab (P3 — hide, never unmount): owns its iframe element
 *  plus the frame-scoped state (loading, cross-origin, tracked location,
 *  probe/error). Identity is the URL — a selection change neither remounts
 *  the frame nor rewrites its `src`. Inactive frames run no probe; a frame
 *  probes on first mount and on activation.
 *
 *  Every probe lives here and only here: the frame-check refusal probe, the
 *  proxied-port 502 fetch, and the same-origin location/document reads each
 *  answer an iframe-specific question, so the chrome consumes only the
 *  reported state and can never misread another renderer through them. The
 *  same-origin posture (`crossOrigin`) is likewise file-local: it derives
 *  the reported capability flags and selects the reload strategy, and never
 *  crosses the engine boundary. */
export function WebFrameIframe({
  url,
  active,
  zoom,
  wireGestureListeners,
  onState,
  onLoad,
  registerHandle,
  unregisterHandle,
  interactRef,
  reclaimRef,
}: WebFrameEngineProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Load feedback (R11): set on mount/reload, cleared on `load`.
  const [loading, setLoading] = useState(true);
  const [crossOrigin, setCrossOrigin] = useState(false);
  // Per-viewer current-path tracking (R7): the same-origin frame's location,
  // read on its `load` events and kept in root-relative form (the viewer
  // origin stripped). Display-only — NEVER POSTed (spec window-views R7).
  const [trackedLocation, setTrackedLocation] = useState<string | null>(null);
  // Per-frame title + favicon (the tab chrome reads EVERY same-origin frame's
  // entry, so the inactive tabs can show their document title/icon before
  // selection; display-only — never POSTed). Cleared on each fresh load attach.
  const [title, setTitle] = useState<string | null>(null);
  const [favicon, setFavicon] = useState<string | null>(null);
  const [tileError, setTileError] = useState<TileError | null>(null);
  // Bumped by the dead-port Retry button to re-run detection + reload.
  const [probeNonce, setProbeNonce] = useState(0);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  // The capability report derives from the same-origin attach probe: an
  // embeddable iframe answers yes to history/find/meta/zoom gestures; it
  // never has devtools. A memo keeps the object identity stable so the
  // report effect below fires only when the probe's answer changes.
  const supports = useMemo<WebFrameCapabilities>(
    () => ({
      history: !crossOrigin,
      find: !crossOrigin,
      meta: !crossOrigin,
      zoomGestures: !crossOrigin,
      devtools: false,
    }),
    [crossOrigin],
  );

  // ── find-in-page (engine-owned: matches, active index, highlights) ──────
  // The match set is collected from THIS frame's document, so only the engine
  // may hold it; the chrome drives searches through the handle and reads the
  // reported {active, total}. `find` is null while no search is active (the
  // chrome's ?? 0 defaults render the 0/0 case from that).
  const [findState, setFindState] = useState<{ active: number; total: number } | null>(null);
  const findMatchesRef = useRef<Range[]>([]);
  const findActiveRef = useRef(0);
  const findQueryRef = useRef("");
  // Which highlight path the last apply took — the `window.find()` fallback
  // needs per-step navigation calls the Highlight API does not.
  const highlightApiRef = useRef(false);

  useEffect(() => {
    onState(url, {
      loading,
      supports,
      trackedLocation,
      title,
      favicon,
      tileError,
      // The iframe engine has no history boundary signal: both flags mirror
      // the capability (a boundary click is a harmless no-op).
      canGoBack: supports.history,
      canGoForward: supports.history,
      find: findState,
    });
  }, [url, loading, supports, trackedLocation, title, favicon, tileError, findState, onState]);

  /** This frame's document + window, or null when unavailable/cross-origin.
   *  Same try/catch posture as the attach seam. */
  const frameDoc = useCallback((): { doc: Document; win: Window } | null => {
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

  const resetFindState = useCallback(() => {
    findMatchesRef.current = [];
    findActiveRef.current = 0;
    findQueryRef.current = "";
    setFindState(null);
  }, []);

  const find = useCallback(
    (query: string, opts: FindOptions) => {
      // An engine without find support (a cross-origin frame) no-ops and
      // reports no active search.
      if (!supports.find) {
        resetFindState();
        return;
      }
      const frame = frameDoc();
      if (!frame) {
        resetFindState();
        return;
      }
      if (query.trim() === "") {
        clearHighlights(frame.win, frame.doc);
        highlightApiRef.current = false;
        resetFindState();
        return;
      }
      if (!opts.findNext || findQueryRef.current !== query) {
        // A (re)started search re-collects and resets to the first match.
        findMatchesRef.current = collectMatches(frame.doc, query);
        findActiveRef.current = 0;
        findQueryRef.current = query;
      } else if (findMatchesRef.current.length > 0) {
        findActiveRef.current = stepMatch(
          findActiveRef.current,
          findMatchesRef.current.length,
          opts.forward ? 1 : -1,
        );
      }
      const matches = findMatchesRef.current;
      const activeIndex = findActiveRef.current;
      if (matches.length === 0) {
        clearHighlights(frame.win, frame.doc);
        highlightApiRef.current = false;
      } else {
        const applied = applyHighlights(frame.win, frame.doc, matches, activeIndex);
        highlightApiRef.current = applied;
        const activeMatch = matches[activeIndex];
        if (applied && activeMatch) scrollToMatch(activeMatch);
        else if (!applied) findWithWindow(frame.win, query, !opts.forward);
      }
      setFindState({ active: activeIndex, total: matches.length });
    },
    [supports.find, frameDoc, resetFindState],
  );

  const stopFind = useCallback(() => {
    const frame = frameDoc();
    if (frame) clearHighlights(frame.win, frame.doc);
    highlightApiRef.current = false;
    resetFindState();
  }, [frameDoc, resetFindState]);

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
  // the engine's query die with the document they were collected from; the
  // chrome's query reset rides the `onLoad` edge fired after.
  //
  // The same load pass (260819-v6y4) clears the progress line, tracks the
  // frame's current location for the address bar's display form, and reports
  // the page title into the frame's chrome state — all same-origin-gated
  // reads with the attach seam's try/catch posture.
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
      redispatchChord({
        key: e.key,
        code: e.code,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
      });
    };
    const attach = (fromLoad: boolean) => {
      let doc: Document | null = null;
      try {
        // Same-origin probe: a cross-origin frame throws on location access
        // and yields a null contentDocument — either one marks the engine
        // cross-origin (find/history/meta/zoom-gesture capabilities off,
        // reload degrades to the bounce; the blur fallback stays the only
        // interaction signal, unchanged).
        void iframe.contentWindow?.location.href;
        doc = iframe.contentDocument;
      } catch {
        doc = null;
      }
      setCrossOrigin(!doc);
      // R8 highlight reset — no stale highlight survives a navigation; the
      // match state dies with the document it was collected from. Both run
      // before the onLoad edge so the chrome's query reset never observes a
      // live engine-side search.
      try {
        const win = iframe.contentWindow;
        if (doc && win) clearHighlights(win, doc);
      } catch {
        /* noop */
      }
      resetFindState();
      // The load-gated work (R7/R10/R11) runs on the frame's `load` events
      // ONLY — the mount-time attach sees the initial about:blank document,
      // so clearing the progress line or tracking the location there would
      // fire before the real src has loaded.
      if (fromLoad) {
        setLoading(false);
        // Current-path tracking + title/favicon reporting: same-origin only.
        // The tracked location is stored root-relative (viewer origin
        // stripped) so the display-form derivation sees the same shape as a
        // stored relative web address. about:blank (the cross-origin reload
        // bounce's midpoint) reports nothing.
        if (doc) {
          try {
            const loc = iframe.contentWindow?.location;
            if (loc && loc.origin === window.location.origin && loc.href !== "about:blank") {
              setTrackedLocation(loc.pathname + loc.search + loc.hash);
              setTitle(doc.title !== "" ? doc.title : null);
              setFavicon(frameFavicon(doc));
            } else {
              setTitle(null);
              setFavicon("/favicon.ico");
            }
          } catch {
            /* noop */
          }
          onLoadRef.current(url);
        } else {
          // An unreadable navigation invalidates every value derived from the
          // previous same-origin document. The stored tab URL then drives the
          // label/icon fallbacks until a readable document loads again.
          setTrackedLocation(null);
          setTitle(null);
          setFavicon(null);
          onLoadRef.current(url);
        }
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
    const onFrameLoad = () => attach(true);
    attach(false);
    iframe.addEventListener("load", onFrameLoad);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      iframe.removeEventListener("load", onFrameLoad);
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
  }, [url, wireGestureListeners, interactRef, reclaimRef, resetFindState]);

  // Error-state probes (R8). External absolute URLs: the backend frame-check
  // probe reads the refusal headers cross-origin iframes can't signal.
  // Proxied ports: a same-origin fetch of the proxied path reads the reverse
  // proxy's 502 (nothing listening). Probe results RENDER OVER the iframe
  // area; the iframe stays mounted (hidden) so its listeners survive and a
  // Retry needs no remount. Present/relative kinds never probe.
  const addressKind = classifyAddress(url);
  // Own-origin (`app`) tiles mint a per-viewer src ({port}.{host} subdomain, the
  // tailscale host-URL form, or a /proxy fallback) — run-kit strips the app's
  // frame headers, so no frame-check refusal applies (the effect below treats
  // `app` as the no-op else branch). Every other kind rides toProxySrc unchanged.
  const frameSrc =
    addressKind === "app"
      ? appSrc(url, window.location.host, window.location.protocol === "https:")
      : toProxySrc(url);
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

  // Back/forward (R5): contentWindow.history, same-origin only (the chrome
  // hides the buttons without the history capability), per-viewer — never a
  // web-option write. A boundary click is a harmless no-op (no canGoBack
  // signal exists).
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
    registerHandle(url, {
      kind: "iframe",
      reload: refresh,
      retry,
      back: () => navigate(-1),
      forward: () => navigate(1),
      find,
      stopFind,
    });
    return () => unregisterHandle(url);
  }, [url, registerHandle, unregisterHandle, refresh, retry, navigate, find, stopFind]);

  return (
    <iframe
      ref={iframeRef}
      src={frameSrc}
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

/** Match the icon-bearing rel tokens browsers commonly use for tab chrome. */
const ICON_REL_PATTERN = /(?:^|\s)(?:icon|apple-touch-icon|apple-touch-icon-precomposed)(?:\s|$)/i;

/** Resolve a same-origin frame's first declared icon, falling back to the
 *  frame origin's conventional `/favicon.ico`. */
function frameFavicon(doc: Document): string {
  const links = doc.querySelectorAll("link");
  for (let i = 0; i < links.length; i++) {
    const rel = links[i].getAttribute("rel");
    if (rel && ICON_REL_PATTERN.test(rel)) {
      const href = links[i].getAttribute("href");
      if (!href) continue;
      try {
        return new URL(href, doc.location.href).href;
      } catch {
        continue;
      }
    }
  }
  return new URL("/favicon.ico", doc.location.origin).href;
}

import { useState, useRef, useCallback, useEffect } from "react";
import { updateWindowUrl } from "@/api/client";
import { useSessionContext } from "@/contexts/session-context";
import { Tip, TipGroup } from "@/components/tip";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer";
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
  /** Switch this window to the tty lens (260714-t97o-web-view-lens). Wired from
   *  `app.tsx`'s `switchView("tty")` — drops the `?view=` param (tty is the
   *  clean-URL default) and records tty in localStorage. The `>_` button calls
   *  THIS; it no longer mutates `@rk_type` (view choice is per-viewer client
   *  state, not window identity — spec R7). OPTIONAL (260811-2r1w): the
   *  right-panel `web` surface omits it, suppressing the `>_` affordance — in
   *  the panel the tty is already beside the iframe, so switching the MAIN
   *  slot is meaningless. The URL bar and refresh render in both contexts. */
  onSwitchToTty?: () => void;
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
}

/** Renders an iframe with a URL bar for proxy windows. */
export function IframeWindow({
  windowId,
  rkUrl,
  onSwitchToTty,
  onInteract,
  shouldReclaimChord,
}: IframeWindowProps) {
  // IframeWindow renders only from AppShell terminal routes where currentServer
  // is set. Fall back to empty string when null (action no-ops with bad server).
  const { currentServer } = useSessionContext();
  const server = currentServer ?? "";
  const [inputUrl, setInputUrl] = useState(rkUrl);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const currentSrcRef = useRef(rkUrl);
  const interactRef = useRef(onInteract);
  interactRef.current = onInteract;
  const reclaimRef = useRef(shouldReclaimChord);
  reclaimRef.current = shouldReclaimChord;
  const coarse = useCoarsePointer();

  // ── find-in-page state (260819-ie2i R5–R8) ──────────────────────────────
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findMatches, setFindMatches] = useState<Range[]>([]);
  const [findActive, setFindActive] = useState(0);
  // Cross-origin frames reject contentDocument/location access — no reclaim,
  // no search; the find bar renders disabled with the hint (R7).
  const [crossOrigin, setCrossOrigin] = useState(false);
  const findInputRef = useRef<HTMLInputElement>(null);
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
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let attachedDoc: Document | null = null;
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
    const attach = () => {
      let doc: Document | null = null;
      try {
        // Same-origin probe: a cross-origin frame throws on location access
        // and yields a null contentDocument — either one marks the tile
        // cross-origin (find disabled, no reclaim; the blur fallback stays
        // the only interaction signal, unchanged).
        void iframe.contentWindow?.location.href;
        doc = iframe.contentDocument;
      } catch {
        doc = null;
      }
      setCrossOrigin(!doc);
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
      }
    };
    const onWindowBlur = () => {
      if (document.activeElement === iframe) report();
    };
    attach();
    iframe.addEventListener("load", attach);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      iframe.removeEventListener("load", attach);
      window.removeEventListener("blur", onWindowBlur);
      try {
        attachedDoc?.removeEventListener("pointerdown", report, true);
        attachedDoc?.removeEventListener("keydown", onKey, true);
      } catch {
        /* noop */
      }
    };
  }, []);

  // The `web-find:open` seam (R4): the ⌘F chord handler, the palette action,
  // and any future opener dispatch one document CustomEvent; the mounted web
  // tile is its single receiver (at most one web tile per layout).
  useEffect(() => {
    const open = () => setFindOpen(true);
    document.addEventListener(WEB_FIND_OPEN_EVENT, open);
    return () => document.removeEventListener(WEB_FIND_OPEN_EVENT, open);
  }, []);

  // Autofocus the input on open (R5).
  useEffect(() => {
    if (findOpen) findInputRef.current?.focus();
  }, [findOpen]);

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

  const handleFindKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        stepFind(e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setFindOpen(false);
      }
    },
    [stepFind],
  );

  // Sync URL bar text and iframe src when rkUrl changes externally (SSE push).
  // Only update iframe src when the URL has actually changed to avoid unnecessary reloads.
  useEffect(() => {
    setInputUrl(rkUrl);
    if (rkUrl !== currentSrcRef.current) {
      currentSrcRef.current = rkUrl;
      if (iframeRef.current) {
        iframeRef.current.src = toProxySrc(rkUrl);
      }
    }
  }, [rkUrl]);

  const handleRefresh = useCallback(() => {
    if (iframeRef.current) {
      // Force reload by briefly clearing src then re-setting it
      const src = iframeRef.current.src;
      iframeRef.current.src = "about:blank";
      // Use setTimeout(0) to ensure the browser processes the blank navigation
      setTimeout(() => {
        if (iframeRef.current) {
          iframeRef.current.src = src;
        }
      }, 0);
    }
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = inputUrl.trim();
    if (!trimmed) return;
    updateWindowUrl(server, windowId, trimmed).catch(() => {
      // Revert input on failure
      setInputUrl(rkUrl);
    });
  }, [inputUrl, server, windowId, rkUrl]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* URL Bar — one warm-tip cluster (260722-73al). */}
      <TipGroup>
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border bg-bg-primary shrink-0">
        <Tip label="Refresh">
          <button
            onClick={handleRefresh}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded hover:bg-bg-card text-text-secondary"
            aria-label="Refresh"
          >
            <span className="text-sm">&#x21bb;</span>
          </button>
        </Tip>
        <input
          type="text"
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 min-w-0 bg-bg-card text-text-primary text-sm px-2 py-1 rounded border border-border outline-none focus:border-text-secondary"
          aria-label="URL"
          spellCheck={false}
        />
        <span className="shrink-0 text-text-secondary text-xs select-none" aria-hidden="true">
          &#x23ce;
        </span>
        <Tip label="Find in page">
          <button
            onClick={() => setFindOpen((o) => !o)}
            className={`shrink-0 w-7 h-7 flex items-center justify-center rounded hover:bg-bg-card ${findOpen ? "text-accent-green" : "text-text-secondary"}`}
            aria-label="Find in page"
            aria-pressed={findOpen}
          >
            <span className="text-sm">&#x2315;</span>
          </button>
        </Tip>
        {onSwitchToTty && (
          <Tip label="Switch to terminal">
            <button
              onClick={onSwitchToTty}
              className="shrink-0 w-7 h-7 flex items-center justify-center rounded hover:bg-bg-card text-text-secondary"
              aria-label="Switch to terminal"
            >
              <span className="text-xs font-mono">&gt;_</span>
            </button>
          </Tip>
        )}
      </div>
      </TipGroup>

      {/* Find bar (260819-ie2i R5/R7) — a row below the URL bar per the
          approved design study (state 03): input, n/N counter with the active
          ordinal in accent green, ∧/∨, ✕, and a key hint suppressed on coarse
          pointers. Cross-origin frames render it disabled with the hint. */}
      {findOpen && (
        <div
          className="flex items-center gap-1.5 px-2 py-1 border-b border-border bg-bg-primary shrink-0"
          data-testid="web-find-bar"
        >
          <input
            ref={findInputRef}
            type="text"
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            onKeyDown={handleFindKeyDown}
            disabled={crossOrigin}
            className="w-60 max-w-[40%] shrink bg-bg-card text-text-primary text-sm px-2 py-1 rounded border border-border outline-none focus:border-text-secondary disabled:opacity-50"
            aria-label="Find query"
            placeholder="Find in page"
            spellCheck={false}
          />
          {crossOrigin ? (
            <span className="text-text-secondary text-xs select-none">
              page is cross-origin — find unavailable
            </span>
          ) : (
            <span className="shrink-0 text-text-secondary text-xs select-none" aria-label="Match count">
              <span className="text-accent-green">
                {findMatches.length === 0 ? 0 : findActive + 1}
              </span>
              /{findMatches.length}
            </span>
          )}
          <button
            onClick={() => stepFind(-1)}
            disabled={crossOrigin}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded hover:bg-bg-card text-text-secondary disabled:opacity-50"
            aria-label="Previous match"
          >
            <span className="text-sm">&#x2227;</span>
          </button>
          <button
            onClick={() => stepFind(1)}
            disabled={crossOrigin}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded hover:bg-bg-card text-text-secondary disabled:opacity-50"
            aria-label="Next match"
          >
            <span className="text-sm">&#x2228;</span>
          </button>
          <button
            onClick={() => setFindOpen(false)}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded hover:bg-bg-card text-text-secondary"
            aria-label="Close find bar"
          >
            <span className="text-sm">&#x2715;</span>
          </button>
          {!coarse && (
            <span className="ml-auto text-text-secondary text-xs select-none whitespace-nowrap opacity-60">
              Enter next · ⇧Enter prev · Esc close
            </span>
          )}
        </div>
      )}

      {/* Iframe */}
      <iframe
        ref={iframeRef}
        src={toProxySrc(rkUrl)}
        className="flex-1 w-full border-0"
        title="Proxied content"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
      />
    </div>
  );
}

/**
 * Convert a localhost URL to a proxy path.
 * e.g. http://localhost:8080/docs -> /proxy/8080/docs
 * Non-localhost URLs pass through unchanged.
 */
function toProxySrc(url: string): string {
  const match = url.match(/^https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)(\/.*)?$/);
  if (match) {
    const port = match[1];
    const path = match[2] ?? "/";
    return `/proxy/${port}${path}`;
  }
  return url;
}

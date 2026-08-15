import { useState, useRef, useCallback, useEffect } from "react";
import { updateWindowUrl } from "@/api/client";
import { useSessionContext } from "@/contexts/session-context";
import { Tip, TipGroup } from "@/components/tip";

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
}

/** Renders an iframe with a URL bar for proxy windows. */
export function IframeWindow({
  windowId,
  rkUrl,
  onSwitchToTty,
  onInteract,
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

  // Interaction seam: attach capture-phase pointerdown/keydown listeners to
  // the same-origin contentDocument after every load — each navigation
  // replaces the document, so the listener on the discarded one dies with it
  // and the fresh document gets a new pair. Cross-origin frames throw on
  // contentDocument access; there the window-blur check is the fallback
  // (activeElement lands on the iframe when focus enters it, but no focusin
  // fires in the parent). blur only fires when focus LEAVES the parent —
  // later in-frame clicks report nothing, which is fine: the tile is already
  // focused by then. Listeners attach regardless of whether `onInteract` is
  // currently set: the prop can arrive after mount (a hidden tile handed
  // slot -1 becoming visible), and gating the attach on it would strand the
  // seam — `report` reads the ref, so it simply no-ops until then.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let attachedDoc: Document | null = null;
    const report = () => interactRef.current?.();
    const attach = () => {
      try {
        const doc = iframe.contentDocument;
        if (doc && doc !== attachedDoc) {
          doc.addEventListener("pointerdown", report, true);
          doc.addEventListener("keydown", report, true);
          attachedDoc = doc;
        }
      } catch {
        /* noop — cross-origin frame; the blur fallback covers it */
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
        attachedDoc?.removeEventListener("keydown", report, true);
      } catch {
        /* noop */
      }
    };
  }, []);

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

import { useState, useRef, useCallback, useEffect } from "react";
import { updateWindowUrl, updateWindowType } from "@/api/client";

interface IframeWindowProps {
  sessionName: string;
  windowIndex: number;
  rkUrl: string;
}

/** Renders an iframe with a URL bar for proxy windows. */
export function IframeWindow({ sessionName, windowIndex, rkUrl }: IframeWindowProps) {
  const [inputUrl, setInputUrl] = useState(rkUrl);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const currentSrcRef = useRef(rkUrl);

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
    updateWindowUrl(sessionName, windowIndex, trimmed).catch(() => {
      // Revert input on failure
      setInputUrl(rkUrl);
    });
  }, [inputUrl, sessionName, windowIndex, rkUrl]);

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
      {/* URL Bar */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border bg-bg-primary shrink-0">
        <button
          onClick={handleRefresh}
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded hover:bg-bg-card text-text-secondary"
          aria-label="Refresh"
          title="Refresh"
        >
          <span className="text-sm">&#x21bb;</span>
        </button>
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
        <button
          onClick={() => updateWindowType(sessionName, windowIndex, "")}
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded hover:bg-bg-card text-text-secondary"
          aria-label="Switch to terminal"
          title="Switch to terminal"
        >
          <span className="text-xs font-mono">&gt;_</span>
        </button>
      </div>

      {/* Iframe */}
      <iframe
        ref={iframeRef}
        src={toProxySrc(rkUrl)}
        className="flex-1 w-full border-0"
        title="Proxied content"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
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

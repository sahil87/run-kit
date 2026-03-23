import { useState, useCallback, useRef, useEffect } from "react";
import { changeDesktopResolution } from "@/api/client";

type DesktopBottomBarProps = {
  rfbRef: React.RefObject<import("@novnc/novnc/lib/rfb").default | null>;
  sessionName: string;
  windowIndex: number;
  hostname?: string;
};

const KBD_CLASS =
  "min-h-[36px] min-w-[36px] coarse:min-h-[36px] coarse:min-w-[36px] flex items-center justify-center px-2 py-0 text-xs border border-border rounded select-none transition-colors hover:border-text-secondary active:bg-bg-card focus-visible:outline-2 focus-visible:outline-accent";

const RESOLUTIONS = [
  { label: "1280x720", value: "1280x720" },
  { label: "1920x1080", value: "1920x1080" },
  { label: "2560x1440", value: "2560x1440" },
] as const;

export function DesktopBottomBar({ rfbRef, sessionName, windowIndex, hostname }: DesktopBottomBarProps) {
  const [resOpen, setResOpen] = useState(false);
  const resRef = useRef<HTMLDivElement>(null);

  // Close resolution picker on outside click
  useEffect(() => {
    if (!resOpen) return;
    function handleClick(e: MouseEvent) {
      if (resRef.current && !resRef.current.contains(e.target as Node)) {
        setResOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [resOpen]);

  // Close on Escape
  useEffect(() => {
    if (!resOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setResOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [resOpen]);

  const handleClipboardPaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && rfbRef.current) {
        rfbRef.current.clipboardPasteFrom = text;
      }
    } catch {
      // Clipboard API unavailable or denied
    }
  }, [rfbRef]);

  const handleResolution = useCallback(
    async (resolution: string) => {
      setResOpen(false);
      try {
        await changeDesktopResolution(sessionName, windowIndex, resolution);
      } catch {
        // best-effort
      }
    },
    [sessionName, windowIndex],
  );

  const handleFullscreen = useCallback(() => {
    const el = document.documentElement;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  }, []);

  return (
    <div className="flex items-center gap-1 py-1.5 flex-wrap" role="toolbar" aria-label="Desktop controls">
      {/* Clipboard paste */}
      <button
        aria-label="Paste clipboard"
        className={`${KBD_CLASS} text-text-secondary`}
        onClick={handleClipboardPaste}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
        </svg>
        <span className="ml-1">Paste</span>
      </button>

      <div className="w-px h-5 bg-border mx-0.5" aria-hidden="true" />

      {/* Resolution picker */}
      <div ref={resRef} className="relative">
        <button
          aria-label="Change resolution"
          aria-haspopup="true"
          aria-expanded={resOpen}
          className={`${KBD_CLASS} text-text-secondary`}
          onClick={() => setResOpen((v) => !v)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          <span className="ml-1">Res</span>
        </button>
        {resOpen && (
          <div
            role="menu"
            aria-label="Resolution options"
            className="absolute bottom-full left-0 mb-1 bg-bg-primary border border-border rounded-lg shadow-2xl py-1 min-w-[140px] z-50"
          >
            {RESOLUTIONS.map((r) => (
              <button
                key={r.value}
                role="menuitem"
                className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-card transition-colors"
                onClick={() => handleResolution(r.value)}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="w-px h-5 bg-border mx-0.5" aria-hidden="true" />

      {/* Fullscreen toggle */}
      <button
        aria-label="Toggle fullscreen"
        className={`${KBD_CLASS} text-text-secondary`}
        onClick={handleFullscreen}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      </button>

      <div className="w-px h-5 bg-border mx-0.5" aria-hidden="true" />

      {/* Command palette shortcut */}
      <button
        aria-label="Open command palette"
        className={`${KBD_CLASS} text-text-secondary`}
        onClick={() => document.dispatchEvent(new CustomEvent("palette:open"))}
      >
        <kbd aria-hidden="true">{"\u2318K"}</kbd>
      </button>

      {hostname && (
        <span className="hidden sm:inline ml-auto min-w-0 text-xs text-text-secondary truncate">{hostname}</span>
      )}
    </div>
  );
}

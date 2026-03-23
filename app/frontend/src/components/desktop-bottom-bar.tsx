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

// Map common keys to X11 keysyms for noVNC sendKey
function keyToKeysym(key: string): number | null {
  if (key.length === 1) return key.charCodeAt(0);
  const map: Record<string, number> = {
    Enter: 0xff0d, Backspace: 0xff08, Tab: 0xff09, Escape: 0xff1b,
    Delete: 0xffff, Home: 0xff50, End: 0xff57, PageUp: 0xff55, PageDown: 0xff56,
    ArrowLeft: 0xff51, ArrowUp: 0xff52, ArrowRight: 0xff53, ArrowDown: 0xff54,
    Shift: 0xffe1, Control: 0xffe3, Alt: 0xffe9, Meta: 0xffe7,
    F1: 0xffbe, F2: 0xffbf, F3: 0xffc0, F4: 0xffc1, F5: 0xffc2, F6: 0xffc3,
    F7: 0xffc4, F8: 0xffc5, F9: 0xffc6, F10: 0xffc7, F11: 0xffc8, F12: 0xffc9,
    " ": 0x20,
  };
  return map[key] ?? null;
}

const RESOLUTIONS = [
  { label: "720x1280", value: "720x1280", group: "Portrait" },
  { label: "1080x1920", value: "1080x1920", group: "Portrait" },
  { label: "1440x2560", value: "1440x2560", group: "Portrait" },
  { label: "1280x720", value: "1280x720", group: "Landscape" },
  { label: "1920x1080", value: "1920x1080", group: "Landscape" },
  { label: "2560x1440", value: "2560x1440", group: "Landscape" },
] as const;

export function DesktopBottomBar({ rfbRef, sessionName, windowIndex, hostname }: DesktopBottomBarProps) {
  const [resOpen, setResOpen] = useState(false);
  const [kbdActive, setKbdActive] = useState(false);
  const resRef = useRef<HTMLDivElement>(null);
  const kbdInputRef = useRef<HTMLTextAreaElement>(null);

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

  const handleKeyboard = useCallback(() => {
    if (kbdActive) {
      kbdInputRef.current?.blur();
      setKbdActive(false);
    } else {
      kbdInputRef.current?.focus();
      setKbdActive(true);
    }
  }, [kbdActive]);

  // Send a keysym (down + up) to noVNC
  const sendKey = useCallback((keysym: number) => {
    const rfb = rfbRef.current;
    if (!rfb) return;
    if ("sendKey" in rfb && typeof (rfb as unknown as { sendKey: unknown }).sendKey === "function") {
      const send = (rfb as unknown as { sendKey: (keysym: number, code: string | null, down?: boolean) => void }).sendKey;
      send.call(rfb, keysym, null, true);  // keydown
      send.call(rfb, keysym, null, false); // keyup
    }
  }, [rfbRef]);

  // Handle special keys (Enter, Backspace, arrows, etc.) via keydown
  const handleKbdKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!rfbRef.current) return;
    // Only handle non-printable keys here — printable chars come via onInput
    const keysym = keyToKeysym(e.key);
    if (keysym && e.key.length > 1) {
      // Special key (Enter, Backspace, etc.)
      e.preventDefault();
      sendKey(keysym);
    }
  }, [rfbRef, sendKey]);

  // Handle typed characters via input event (mobile virtual keyboards)
  const handleKbdTextInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    const text = textarea.value;
    if (!text) return;
    // Send each character as a keysym
    for (const char of text) {
      const keysym = char.charCodeAt(0);
      if (keysym) sendKey(keysym);
    }
    // Clear the textarea for next input
    textarea.value = "";
  }, [sendKey]);

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
      {/* Hidden textarea to trigger mobile virtual keyboard */}
      <textarea
        ref={kbdInputRef}
        aria-hidden="true"
        className="absolute opacity-0 w-0 h-0 pointer-events-none"
        style={{ position: "fixed", top: -9999, left: -9999 }}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onKeyDown={handleKbdKeyDown}
        onInput={handleKbdTextInput}
        onBlur={() => setKbdActive(false)}
      />

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
            {(["Portrait", "Landscape"] as const).map((group) => (
              <div key={group}>
                <div className="px-3 py-1 text-xs text-text-secondary/60 font-medium">{group}</div>
                {RESOLUTIONS.filter((r) => r.group === group).map((r) => (
                  <button
                    key={r.value}
                    role="menuitem"
                    className="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-card transition-colors"
                    onClick={() => handleResolution(r.value)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
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

      {/* Keyboard toggle — pushed right */}
      <button
        aria-label={kbdActive ? "Hide keyboard" : "Show keyboard"}
        className={`ml-auto ${KBD_CLASS} ${kbdActive ? "text-accent border-accent/50 bg-accent/10" : "text-text-secondary"}`}
        onClick={handleKeyboard}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
          <line x1="6" y1="8" x2="6" y2="8" />
          <line x1="10" y1="8" x2="10" y2="8" />
          <line x1="14" y1="8" x2="14" y2="8" />
          <line x1="18" y1="8" x2="18" y2="8" />
          <line x1="6" y1="12" x2="6" y2="12" />
          <line x1="10" y1="12" x2="10" y2="12" />
          <line x1="14" y1="12" x2="14" y2="12" />
          <line x1="18" y1="12" x2="18" y2="12" />
          <line x1="7" y1="16" x2="17" y2="16" />
        </svg>
        <span className="ml-1 hidden sm:inline">Kbd</span>
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

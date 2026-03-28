import { useState, useCallback, useRef, useEffect } from "react";
import { useModifierState } from "@/hooks/use-modifier-state";
import { ArrowPad } from "@/components/arrow-pad";
import { changeDesktopResolution } from "@/api/client";
import type { TouchMode } from "@/components/desktop-client";

type DesktopBottomBarProps = {
  rfbRef: React.RefObject<import("@novnc/novnc/lib/rfb").default | null>;
  sessionName: string;
  windowIndex: number;
  hostname?: string;
  touchMode: TouchMode;
  onTouchModeChange: (mode: TouchMode) => void;
};

const KEYSYM = {
  Escape: 0xff1b, Tab: 0xff09,
  Ctrl: 0xffe3, Alt: 0xffe9,
  Left: 0xff51, Up: 0xff52, Right: 0xff53, Down: 0xff54,
  F1: 0xffbe, F2: 0xffbf, F3: 0xffc0, F4: 0xffc1, F5: 0xffc2, F6: 0xffc3,
  F7: 0xffc4, F8: 0xffc5, F9: 0xffc6, F10: 0xffc7, F11: 0xffc8, F12: 0xffc9,
  PgUp: 0xff55, PgDn: 0xff56, Home: 0xff50, End: 0xff57, Ins: 0xff63, Del: 0xffff,
} as const;

const FN_KEYS = [
  { label: "F1", sym: KEYSYM.F1 }, { label: "F2", sym: KEYSYM.F2 }, { label: "F3", sym: KEYSYM.F3 }, { label: "F4", sym: KEYSYM.F4 },
  { label: "F5", sym: KEYSYM.F5 }, { label: "F6", sym: KEYSYM.F6 }, { label: "F7", sym: KEYSYM.F7 }, { label: "F8", sym: KEYSYM.F8 },
  { label: "F9", sym: KEYSYM.F9 }, { label: "F10", sym: KEYSYM.F10 }, { label: "F11", sym: KEYSYM.F11 }, { label: "F12", sym: KEYSYM.F12 },
];

const EXT_KEYS = [
  { label: "PgUp", sym: KEYSYM.PgUp }, { label: "PgDn", sym: KEYSYM.PgDn },
  { label: "Home", sym: KEYSYM.Home }, { label: "End", sym: KEYSYM.End },
  { label: "Ins", sym: KEYSYM.Ins }, { label: "Del", sym: KEYSYM.Del },
];

const KBD_CLASS =
  "min-h-[36px] min-w-[36px] flex items-center justify-center px-1 py-0 text-xs border border-border rounded select-none transition-colors hover:border-text-secondary active:bg-bg-card outline-none";

const MODIFIER_LABELS: Record<string, string> = { ctrl: "Control", alt: "Option" };

const RESOLUTIONS = [
  { label: "720\u00D71280 (portrait)", value: "720x1280" },
  { label: "1080\u00D71920 (portrait)", value: "1080x1920" },
  { label: "1280\u00D7720", value: "1280x720" },
  { label: "1920\u00D71080", value: "1920x1080" },
  { label: "2560\u00D71440", value: "2560x1440" },
];

const preventFocusSteal = (e: React.MouseEvent) => e.preventDefault();

export function DesktopBottomBar({ rfbRef, sessionName, windowIndex, hostname, touchMode, onTouchModeChange }: DesktopBottomBarProps) {
  const mods = useModifierState();
  const [menuOpen, setMenuOpen] = useState(false);
  const [fnOpen, setFnOpen] = useState(false);
  const [kbdActive, setKbdActive] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const fnRef = useRef<HTMLDivElement>(null);
  const kbdInputRef = useRef<HTMLTextAreaElement>(null);

  // Close popups on outside click / escape
  useEffect(() => {
    if (!menuOpen && !fnOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (fnOpen && fnRef.current && !fnRef.current.contains(e.target as Node)) setFnOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenuOpen(false); setFnOpen(false); } };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("mousedown", handleClick); document.removeEventListener("keydown", handleKey); };
  }, [menuOpen, fnOpen]);

  // Send keysym to noVNC with modifier state
  const sendKey = useCallback((keysym: number) => {
    const rfb = rfbRef.current;
    if (!rfb || !("sendKey" in rfb)) return;
    const send = (rfb as unknown as { sendKey: (k: number, c: string | null, d?: boolean) => void }).sendKey;
    const snapshot = mods.consume();
    if (snapshot.ctrl) send.call(rfb, KEYSYM.Ctrl, null, true);
    if (snapshot.alt) send.call(rfb, KEYSYM.Alt, null, true);
    send.call(rfb, keysym, null, true);
    send.call(rfb, keysym, null, false);
    if (snapshot.alt) send.call(rfb, KEYSYM.Alt, null, false);
    if (snapshot.ctrl) send.call(rfb, KEYSYM.Ctrl, null, false);
  }, [rfbRef, mods]);

  const sendArrow = useCallback((code: string) => {
    const map: Record<string, number> = { A: KEYSYM.Up, B: KEYSYM.Down, C: KEYSYM.Right, D: KEYSYM.Left };
    if (map[code]) sendKey(map[code]);
  }, [sendKey]);

  // Hidden textarea handlers for mobile keyboard
  const handleKbdKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key.length > 1) {
      const map: Record<string, number> = {
        Enter: 0xff0d, Backspace: 0xff08, Tab: 0xff09, Escape: 0xff1b,
        Delete: 0xffff, ArrowLeft: 0xff51, ArrowUp: 0xff52, ArrowRight: 0xff53, ArrowDown: 0xff54,
      };
      if (map[e.key]) { e.preventDefault(); sendKey(map[e.key]); }
    }
  }, [sendKey]);

  const handleKbdTextInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    const text = e.currentTarget.value;
    if (!text) return;
    for (const char of text) sendKey(char.charCodeAt(0));
    e.currentTarget.value = "";
  }, [sendKey]);

  // Desktop menu actions
  const handleClipboardPaste = useCallback(async () => {
    try { const text = await navigator.clipboard.readText(); if (text && rfbRef.current) rfbRef.current.clipboardPasteFrom = text; } catch { /* denied */ }
    setMenuOpen(false);
  }, [rfbRef]);

  const handleResolution = useCallback(async (res: string) => {
    setMenuOpen(false);
    try { await changeDesktopResolution(sessionName, windowIndex, res); } catch { /* best-effort */ }
  }, [sessionName, windowIndex]);

  const handleFullscreen = useCallback(() => {
    setMenuOpen(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }, []);

  const handleToggleTouchMode = useCallback(() => {
    const next = touchMode === "trackpad" ? "direct" : "trackpad";
    onTouchModeChange(next);
    if (rfbRef.current) rfbRef.current.showDotCursor = next === "trackpad";
    try { localStorage.setItem("rk-desktop-touch-mode", next); } catch { /* noop */ }
    setMenuOpen(false);
  }, [touchMode, onTouchModeChange, rfbRef]);

  return (
    <div className="flex items-center gap-1 py-1.5 flex-wrap" role="toolbar" aria-label="Desktop controls">
      {/* Hidden textarea for mobile keyboard input */}
      <textarea
        ref={kbdInputRef}
        aria-hidden="true"
        className="absolute opacity-0 w-0 h-0 pointer-events-none"
        style={{ position: "fixed", top: -9999, left: -9999 }}
        autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
        onKeyDown={handleKbdKeyDown}
        onInput={handleKbdTextInput}
        onBlur={() => setKbdActive(false)}
      />

      {/* Esc */}
      <button aria-label="Escape" className={`${KBD_CLASS} text-text-secondary`} onMouseDown={preventFocusSteal} onClick={() => sendKey(KEYSYM.Escape)}>
        {"\u238B"}
      </button>

      {/* Tab */}
      <button aria-label="Tab" className={`${KBD_CLASS} text-text-secondary`} onMouseDown={preventFocusSteal} onClick={() => sendKey(KEYSYM.Tab)}>
        {"\u21E5"}
      </button>

      {/* Ctrl / Alt */}
      {(["ctrl", "alt"] as const).map((key) => (
        <button
          key={key}
          aria-label={MODIFIER_LABELS[key]}
          aria-pressed={mods[key]}
          className={`${KBD_CLASS} ${mods[key] ? "bg-accent/20 border-accent text-accent" : "text-text-secondary"}`}
          onMouseDown={preventFocusSteal}
          onClick={() => mods.toggle(key)}
        >
          {key === "ctrl" ? "^" : "\u2325"}
        </button>
      ))}

      {/* Fn keys dropdown */}
      <div ref={fnRef} className="relative">
        <button
          aria-label="Function keys"
          aria-haspopup="true"
          aria-expanded={fnOpen}
          className={`${KBD_CLASS} text-text-secondary`}
          onMouseDown={preventFocusSteal}
          onClick={() => setFnOpen((v) => !v)}
        >
          <kbd aria-hidden="true">F&#x25B4;</kbd>
        </button>
        {fnOpen && (
          <div role="menu" aria-label="Function and navigation keys" className="absolute bottom-full left-0 mb-1 bg-bg-primary border border-border rounded-lg shadow-2xl py-1 min-w-[160px] z-50">
            <div className="grid grid-cols-4 gap-0.5">
              {FN_KEYS.map((fk) => (
                <button key={fk.label} role="menuitem" aria-label={fk.label}
                  className="px-2 py-1 min-h-[36px] flex items-center justify-center text-xs text-text-secondary hover:text-text-primary hover:bg-bg-card rounded"
                  onMouseDown={preventFocusSteal} onClick={() => { sendKey(fk.sym); setFnOpen(false); }}
                >{fk.label}</button>
              ))}
            </div>
            <div className="border-t border-border my-1" />
            <div className="grid grid-cols-3 gap-0.5">
              {EXT_KEYS.map((ek) => (
                <button key={ek.label} role="menuitem" aria-label={ek.label}
                  className="px-2 py-1 min-h-[36px] flex items-center justify-center text-xs text-text-secondary hover:text-text-primary hover:bg-bg-card rounded"
                  onMouseDown={preventFocusSteal} onClick={() => { sendKey(ek.sym); setFnOpen(false); }}
                >{ek.label}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Arrow pad */}
      <ArrowPad onArrow={sendArrow} />

      <div className="w-px h-5 bg-border mx-0.5" aria-hidden="true" />

      {/* Desktop menu */}
      <div ref={menuRef} className="relative">
        <button
          aria-label="Desktop actions"
          aria-haspopup="true"
          aria-expanded={menuOpen}
          className={`${KBD_CLASS} text-text-secondary`}
          onMouseDown={preventFocusSteal}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        </button>

        {menuOpen && (
          <div role="menu" aria-label="Desktop actions" className="absolute bottom-full left-0 mb-1 bg-bg-primary border border-border rounded-lg shadow-2xl py-1 min-w-[200px] z-50">
            <button role="menuitem" className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-card transition-colors" onClick={handleToggleTouchMode}>
              {touchMode === "trackpad" ? "Switch to Direct Touch" : "Switch to Trackpad"}
            </button>
            <button role="menuitem" className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-card transition-colors" onClick={handleClipboardPaste}>
              Paste Clipboard
            </button>
            <button role="menuitem" className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-card transition-colors" onClick={handleFullscreen}>
              {document.fullscreenElement ? "Exit Fullscreen" : "Fullscreen"}
            </button>
            <div className="border-t border-border my-1" />
            <div className="px-3 py-1 text-xs text-text-secondary/60 font-medium">Resolution</div>
            {RESOLUTIONS.map((r) => (
              <button key={r.value} role="menuitem" className="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-card transition-colors" onClick={() => handleResolution(r.value)}>
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Command palette */}
      <button aria-label="Open command palette" className={`${KBD_CLASS} text-text-secondary`} onClick={() => document.dispatchEvent(new CustomEvent("palette:open"))}>
        {"\u2318K"}
      </button>

      {hostname && (
        <span className="hidden sm:inline ml-auto min-w-0 text-xs text-text-secondary truncate">{hostname}</span>
      )}

      {/* Keyboard toggle — pushed right */}
      <button
        aria-label={kbdActive ? "Hide keyboard" : "Show keyboard"}
        className={`ml-auto ${KBD_CLASS} ${kbdActive ? "bg-accent/20 border-accent text-accent" : "text-text-secondary"}`}
        onMouseDown={preventFocusSteal}
        onClick={() => {
          if (kbdActive) { kbdInputRef.current?.blur(); setKbdActive(false); }
          else { kbdInputRef.current?.focus(); setKbdActive(true); }
        }}
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
      </button>

      {/* Dismiss keyboard — touch devices only */}
      <button
        type="button"
        aria-label="Dismiss keyboard"
        className={`${KBD_CLASS} hidden coarse:inline-flex text-text-secondary`}
        onClick={() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); }}
      >
        {"\u2304"}
      </button>
    </div>
  );
}

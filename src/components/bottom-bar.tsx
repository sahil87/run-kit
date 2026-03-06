"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useModifierState, type ModifierSnapshot } from "@/hooks/use-modifier-state";
import { ArrowPad } from "@/components/arrow-pad";

type BottomBarProps = {
  wsRef: React.RefObject<WebSocket | null>;
  onOpenCompose: () => void;
};

/** xterm modifier parameter: 1 + (alt?2:0) + (ctrl?4:0) + (meta?8:0) */
function modParam(mods: ModifierSnapshot): number {
  let p = 1;
  if (mods.alt) p += 2;
  if (mods.ctrl) p += 4;
  if (mods.cmd) p += 8;
  return p;
}

function hasModifiers(mods: ModifierSnapshot): boolean {
  return mods.ctrl || mods.alt || mods.cmd;
}

const FN_KEYS = [
  { label: "F1", plain: "\x1bOP", mod: (p: number) => `\x1b[1;${p}P` },
  { label: "F2", plain: "\x1bOQ", mod: (p: number) => `\x1b[1;${p}Q` },
  { label: "F3", plain: "\x1bOR", mod: (p: number) => `\x1b[1;${p}R` },
  { label: "F4", plain: "\x1bOS", mod: (p: number) => `\x1b[1;${p}S` },
  { label: "F5", plain: "\x1b[15~", mod: (p: number) => `\x1b[15;${p}~` },
  { label: "F6", plain: "\x1b[17~", mod: (p: number) => `\x1b[17;${p}~` },
  { label: "F7", plain: "\x1b[18~", mod: (p: number) => `\x1b[18;${p}~` },
  { label: "F8", plain: "\x1b[19~", mod: (p: number) => `\x1b[19;${p}~` },
  { label: "F9", plain: "\x1b[20~", mod: (p: number) => `\x1b[20;${p}~` },
  { label: "F10", plain: "\x1b[21~", mod: (p: number) => `\x1b[21;${p}~` },
  { label: "F11", plain: "\x1b[23~", mod: (p: number) => `\x1b[23;${p}~` },
  { label: "F12", plain: "\x1b[24~", mod: (p: number) => `\x1b[24;${p}~` },
] as const;

const EXT_KEYS = [
  { label: "PgUp", plain: "\x1b[5~", mod: (p: number) => `\x1b[5;${p}~` },
  { label: "PgDn", plain: "\x1b[6~", mod: (p: number) => `\x1b[6;${p}~` },
  { label: "Home", plain: "\x1b[H", mod: (p: number) => `\x1b[1;${p}H` },
  { label: "End", plain: "\x1b[F", mod: (p: number) => `\x1b[1;${p}F` },
  { label: "Ins", plain: "\x1b[2~", mod: (p: number) => `\x1b[2;${p}~` },
  { label: "Del", plain: "\x1b[3~", mod: (p: number) => `\x1b[3;${p}~` },
] as const;

const KBD_CLASS =
  "min-h-[30px] px-2 py-0.5 text-sm border border-border rounded select-none transition-colors hover:border-text-secondary active:bg-bg-card focus-visible:outline-2 focus-visible:outline-accent";

const MODIFIER_LABELS: Record<string, string> = {
  ctrl: "Control",
  alt: "Option",
  cmd: "Command",
};

export function BottomBar({ wsRef, onOpenCompose }: BottomBarProps) {
  const mods = useModifierState();
  const [fnOpen, setFnOpen] = useState(false);
  const [extOpen, setExtOpen] = useState(false);
  const fnRef = useRef<HTMLDivElement>(null);
  const extRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!fnOpen && !extOpen) return;
    function handleClick(e: MouseEvent) {
      if (fnOpen && fnRef.current && !fnRef.current.contains(e.target as Node)) {
        setFnOpen(false);
      }
      if (extOpen && extRef.current && !extRef.current.contains(e.target as Node)) {
        setExtOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [fnOpen, extOpen]);

  // Close dropdowns on Escape
  useEffect(() => {
    if (!fnOpen && !extOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setFnOpen(false); setExtOpen(false); }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [fnOpen, extOpen]);

  // Intercept physical keyboard input when modifiers are armed.
  // Builds the correct terminal escape sequence and sends via WebSocket,
  // preventing xterm from receiving the unmodified key.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!mods.isArmed()) return;

      // Ignore modifier keys themselves
      if (["Control", "Alt", "Meta", "Shift", "CapsLock"].includes(e.key)) return;
      // Don't intercept if real Cmd/Ctrl/Alt is held (browser/OS handles those)
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const snapshot = mods.consume();
      const key = e.key;
      let seq = "";

      if (snapshot.ctrl && key.length === 1 && /[a-zA-Z]/.test(key)) {
        // Ctrl+letter → control character (A=0x01, ..., Z=0x1a)
        const ctrlChar = String.fromCharCode(key.toUpperCase().charCodeAt(0) - 64);
        seq = (snapshot.alt || snapshot.cmd ? "\x1b" : "") + ctrlChar;
      } else if (snapshot.ctrl && key.length === 1) {
        // Ctrl+special chars: [ ] \ ^ _ @ etc.
        const c = key.charCodeAt(0);
        if (c >= 0x40 && c <= 0x7f) {
          seq = (snapshot.alt || snapshot.cmd ? "\x1b" : "") + String.fromCharCode(c & 0x1f);
        } else {
          seq = (snapshot.alt || snapshot.cmd ? "\x1b" : "") + key;
        }
      } else if (snapshot.alt || snapshot.cmd) {
        // Alt/Cmd only → ESC prefix + key
        seq = "\x1b" + key;
      }

      if (seq) {
        e.preventDefault();
        e.stopPropagation();
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(seq);
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [mods, wsRef]);

  const send = useCallback(
    (data: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(data);
      }
    },
    [wsRef],
  );

  const sendWithMods = useCallback(
    (plain: string, modified: (p: number) => string) => {
      const snapshot = mods.consume();
      send(hasModifiers(snapshot) ? modified(modParam(snapshot)) : plain);
    },
    [mods, send],
  );

  const sendArrow = useCallback(
    (code: string) => {
      sendWithMods(`\x1b[${code}`, (p) => `\x1b[1;${p}${code}`);
    },
    [sendWithMods],
  );

  const sendSpecial = useCallback(
    (char: string) => {
      const snapshot = mods.consume();
      // Alt/Cmd: prefix with ESC (standard Meta convention)
      const prefix = snapshot.alt || snapshot.cmd ? "\x1b" : "";
      // Ctrl doesn't modify Esc/Tab in terminal semantics (Esc IS Ctrl+[, Tab IS Ctrl+I).
      // Re-arm Ctrl so it stays armed for the next real key.
      if (snapshot.ctrl) mods.arm("ctrl");
      send(prefix + char);
    },
    [mods, send],
  );

  return (
    <div className="flex items-center gap-1.5 py-0.5 flex-wrap" role="toolbar" aria-label="Terminal keys">
      {/* Special keys */}
      <button
        aria-label="Escape"
        className={`${KBD_CLASS} text-text-secondary`}
        onClick={() => sendSpecial("\x1b")}
      >
        <kbd aria-hidden="true">{"\u238B"}</kbd>
      </button>
      <button
        aria-label="Tab"
        className={`${KBD_CLASS} text-text-secondary`}
        onClick={() => sendSpecial("\t")}
      >
        <kbd aria-hidden="true">{"\u21E5"}</kbd>
      </button>

      <div className="w-px h-5 bg-border mx-0.5" aria-hidden="true" />

      {/* Modifier toggles */}
      {([["ctrl", "^"], ["alt", "\u2325"], ["cmd", "\u2318"]] as const).map(([key, symbol]) => (
        <button
          key={key}
          aria-label={MODIFIER_LABELS[key]}
          aria-pressed={mods[key]}
          className={`${KBD_CLASS} ${mods[key] ? "bg-accent/20 border-accent text-accent" : "text-text-secondary"}`}
          onClick={() => mods.toggle(key)}
        >
          <kbd aria-hidden="true">{symbol}</kbd>
        </button>
      ))}

      <div className="w-px h-5 bg-border mx-0.5" aria-hidden="true" />

      {/* Arrow keys — combined pad: drag to send, tap to open popup */}
      <ArrowPad onArrow={sendArrow} />

      {/* Fn dropdown */}
      <div ref={fnRef} className="relative">
        <button
          aria-label="Function keys"
          aria-haspopup="true"
          aria-expanded={fnOpen}
          className={`${KBD_CLASS} text-text-secondary`}
          onClick={() => setFnOpen((v) => !v)}
        >
          <kbd aria-hidden="true">F&#x25B4;</kbd>
        </button>
        {fnOpen && (
          <div
            role="menu"
            aria-label="Function keys"
            className="absolute bottom-full left-0 mb-1 bg-bg-primary border border-border rounded-lg shadow-2xl py-1 grid grid-cols-4 gap-0.5 min-w-[200px] z-50"
          >
            {FN_KEYS.map((fk) => (
              <button
                key={fk.label}
                role="menuitem"
                aria-label={fk.label}
                className="px-2 py-1 min-h-[30px] flex items-center justify-center text-xs text-text-secondary hover:text-text-primary hover:bg-bg-card rounded focus-visible:outline-2 focus-visible:outline-accent"
                onClick={() => {
                  sendWithMods(fk.plain, fk.mod);
                  setFnOpen(false);
                }}
              >
                {fk.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Extended keys dropdown */}
      <div ref={extRef} className="relative">
        <button
          aria-label="Extended keys"
          aria-haspopup="true"
          aria-expanded={extOpen}
          className={`${KBD_CLASS} text-text-secondary`}
          onClick={() => setExtOpen((v) => !v)}
        >
          <kbd aria-hidden="true">{"\u22EF"}</kbd>
        </button>
        {extOpen && (
          <div
            role="menu"
            aria-label="Extended keys"
            className="absolute bottom-full left-0 mb-1 bg-bg-primary border border-border rounded-lg shadow-2xl py-1 grid grid-cols-3 gap-0.5 min-w-[150px] z-50"
          >
            {EXT_KEYS.map((ek) => (
              <button
                key={ek.label}
                role="menuitem"
                aria-label={ek.label}
                className="px-2 py-1 min-h-[30px] flex items-center justify-center text-xs text-text-secondary hover:text-text-primary hover:bg-bg-card rounded focus-visible:outline-2 focus-visible:outline-accent"
                onClick={() => {
                  sendWithMods(ek.plain, ek.mod);
                  setExtOpen(false);
                }}
              >
                {ek.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Compose toggle — right-aligned */}
      <button
        aria-label="Compose text"
        className={`${KBD_CLASS} text-text-secondary ml-auto`}
        onClick={onOpenCompose}
      >
        <kbd aria-hidden="true">&gt;_</kbd>
      </button>
    </div>
  );
}

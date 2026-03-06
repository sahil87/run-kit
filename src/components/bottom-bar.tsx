"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useModifierState, type ModifierSnapshot } from "@/hooks/use-modifier-state";

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

const ARROWS = [
  { label: "\u2190", name: "Left", code: "D" },
  { label: "\u2192", name: "Right", code: "C" },
  { label: "\u2191", name: "Up", code: "A" },
  { label: "\u2193", name: "Down", code: "B" },
] as const;

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
  { label: "PgUp", plain: "\x1b[5~", mod: (p: number) => `\x1b[5;${p}~` },
  { label: "PgDn", plain: "\x1b[6~", mod: (p: number) => `\x1b[6;${p}~` },
  { label: "Home", plain: "\x1b[H", mod: (p: number) => `\x1b[1;${p}H` },
  { label: "End", plain: "\x1b[F", mod: (p: number) => `\x1b[1;${p}F` },
] as const;

const KBD_CLASS =
  "min-h-[44px] px-2.5 py-1.5 text-sm border border-border rounded select-none transition-colors hover:border-text-secondary active:bg-bg-card focus-visible:outline-2 focus-visible:outline-accent";

const MODIFIER_LABELS: Record<string, string> = {
  ctrl: "Control",
  alt: "Option",
  cmd: "Command",
};

export function BottomBar({ wsRef, onOpenCompose }: BottomBarProps) {
  const mods = useModifierState();
  const [fnOpen, setFnOpen] = useState(false);
  const fnRef = useRef<HTMLDivElement>(null);

  // Close Fn dropdown on outside click
  useEffect(() => {
    if (!fnOpen) return;
    function handleClick(e: MouseEvent) {
      if (fnRef.current && !fnRef.current.contains(e.target as Node)) {
        setFnOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [fnOpen]);

  // Close Fn dropdown on Escape
  useEffect(() => {
    if (!fnOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setFnOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [fnOpen]);

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
    <div className="flex items-center gap-1.5 py-1.5 flex-wrap" role="toolbar" aria-label="Terminal keys">
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

      <div className="w-px h-6 bg-border mx-1" aria-hidden="true" />

      {/* Arrow keys */}
      {ARROWS.map(({ label, name, code }) => (
        <button
          key={code}
          aria-label={`${name} arrow`}
          className={`${KBD_CLASS} text-text-secondary`}
          onClick={() => sendArrow(code)}
        >
          <kbd aria-hidden="true">{label}</kbd>
        </button>
      ))}

      <div className="w-px h-6 bg-border mx-1" aria-hidden="true" />

      {/* Fn dropdown */}
      <div ref={fnRef} className="relative">
        <button
          aria-label="Function keys"
          aria-haspopup="true"
          aria-expanded={fnOpen}
          className={`${KBD_CLASS} text-text-secondary`}
          onClick={() => setFnOpen((v) => !v)}
        >
          <kbd aria-hidden="true">Fn&#x25BE;</kbd>
        </button>
        {fnOpen && (
          <div
            role="menu"
            aria-label="Function and navigation keys"
            className="absolute bottom-full left-0 mb-1 bg-bg-primary border border-border rounded-lg shadow-2xl py-1 grid grid-cols-4 gap-0.5 min-w-[200px] z-50"
          >
            {FN_KEYS.map((fk) => (
              <button
                key={fk.label}
                role="menuitem"
                aria-label={fk.label}
                className="px-2 py-1.5 min-h-[44px] flex items-center justify-center text-xs text-text-secondary hover:text-text-primary hover:bg-bg-card rounded focus-visible:outline-2 focus-visible:outline-accent"
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

      {/* Compose toggle */}
      <button
        aria-label="Compose text"
        className={`${KBD_CLASS} text-text-secondary`}
        onClick={onOpenCompose}
      >
        <kbd aria-hidden="true">&#x270E;</kbd>
      </button>
    </div>
  );
}

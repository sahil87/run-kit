import { useState, useCallback, useRef, useEffect } from "react";
import { useModifierState, type ModifierSnapshot } from "@/hooks/use-modifier-state";
import { ArrowPad } from "@/components/arrow-pad";

type BottomBarProps = {
  wsRef: React.RefObject<WebSocket | null>;
  hostname?: string;
  onOpenCompose?: () => void;
};

/** xterm modifier parameter: 1 + (alt?2:0) + (ctrl?4:0) */
function modParam(mods: ModifierSnapshot): number {
  let p = 1;
  if (mods.alt) p += 2;
  if (mods.ctrl) p += 4;
  return p;
}

function hasModifiers(mods: ModifierSnapshot): boolean {
  return mods.ctrl || mods.alt;
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
  "min-h-[36px] min-w-[36px] flex items-center justify-center px-1 py-0 text-xs border border-border rounded select-none transition-colors hover:border-text-secondary active:bg-bg-card focus-visible:outline-2 focus-visible:outline-accent";

const MODIFIER_LABELS: Record<string, string> = {
  ctrl: "Control",
  alt: "Option",
};

export function BottomBar({ wsRef, hostname, onOpenCompose }: BottomBarProps) {
  const mods = useModifierState();
  const [fnOpen, setFnOpen] = useState(false);
  const fnRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!fnOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setFnOpen(false); }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [fnOpen]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!mods.isArmed()) return;
      if (["Control", "Alt", "Meta", "Shift", "CapsLock"].includes(e.key)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const snapshot = mods.consume();
      const key = e.key;
      let seq = "";

      if (snapshot.ctrl && key.length === 1 && /[a-zA-Z]/.test(key)) {
        const ctrlChar = String.fromCharCode(key.toUpperCase().charCodeAt(0) - 64);
        seq = (snapshot.alt ? "\x1b" : "") + ctrlChar;
      } else if (snapshot.ctrl && key.length === 1) {
        const c = key.charCodeAt(0);
        if (c >= 0x40 && c <= 0x7f) {
          seq = (snapshot.alt ? "\x1b" : "") + String.fromCharCode(c & 0x1f);
        } else {
          seq = (snapshot.alt ? "\x1b" : "") + key;
        }
      } else if (snapshot.alt) {
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
      const prefix = snapshot.alt ? "\x1b" : "";
      if (snapshot.ctrl) mods.arm("ctrl");
      send(prefix + char);
    },
    [mods, send],
  );

  return (
    <div className="flex items-center gap-1 py-1.5 flex-wrap" role="toolbar" aria-label="Terminal keys">
      <button aria-label="Escape" className={`${KBD_CLASS} text-text-secondary`} onClick={() => sendSpecial("\x1b")}>
        <kbd aria-hidden="true">{"\u238B"}</kbd>
      </button>
      <button aria-label="Tab" className={`${KBD_CLASS} text-text-secondary`} onClick={() => sendSpecial("\t")}>
        <kbd aria-hidden="true">{"\u21E5"}</kbd>
      </button>

      {([["ctrl", "^"], ["alt", "\u2325"]] as const).map(([key, symbol]) => (
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
            aria-label="Function and navigation keys"
            className="absolute bottom-full left-0 mb-1 bg-bg-primary border border-border rounded-lg shadow-2xl py-1 min-w-[160px] z-50"
          >
            <div className="grid grid-cols-4 gap-0.5">
              {FN_KEYS.map((fk) => (
                <button
                  key={fk.label}
                  role="menuitem"
                  aria-label={fk.label}
                  className="px-2 py-1 min-h-[36px] flex items-center justify-center text-xs text-text-secondary hover:text-text-primary hover:bg-bg-card rounded focus-visible:outline-2 focus-visible:outline-accent"
                  onClick={() => { sendWithMods(fk.plain, fk.mod); setFnOpen(false); }}
                >
                  {fk.label}
                </button>
              ))}
            </div>
            <div className="border-t border-border my-1" />
            <div className="grid grid-cols-3 gap-0.5">
              {EXT_KEYS.map((ek) => (
                <button
                  key={ek.label}
                  role="menuitem"
                  aria-label={ek.label}
                  className="px-2 py-1 min-h-[36px] flex items-center justify-center text-xs text-text-secondary hover:text-text-primary hover:bg-bg-card rounded focus-visible:outline-2 focus-visible:outline-accent"
                  onClick={() => { sendWithMods(ek.plain, ek.mod); setFnOpen(false); }}
                >
                  {ek.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <ArrowPad onArrow={sendArrow} />

      <div className="w-px h-5 bg-border mx-0.5" aria-hidden="true" />

      {onOpenCompose && (
        <button
          type="button"
          onClick={onOpenCompose}
          aria-label="Compose text"
          className={`${KBD_CLASS} text-text-secondary`}
        >
          &gt;_
        </button>
      )}
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

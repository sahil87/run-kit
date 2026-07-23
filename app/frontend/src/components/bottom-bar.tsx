import { useState, useCallback, useRef, useEffect } from "react";
import { useModifierState, type ModifierSnapshot } from "@/hooks/use-modifier-state";
import { useFocusedTerminal } from "@/contexts/focused-terminal-context";
import { useChromeState } from "@/contexts/chrome-context";
import { ArrowPad } from "@/components/arrow-pad";
import { Tip, TipGroup } from "@/components/tip";
import { focusComposeStrip } from "@/lib/compose-strip-events";

type BottomBarProps = {
  onOpenCompose?: () => void;
  onFocusTerminal?: () => void;
  onScrollLockChange?: (locked: boolean) => void;
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

// Chip size splits by pointer: 33×35 on fine pointers (lighter bar, more air
// between chips) while coarse pointers keep the full 36×36 touch target and
// the tighter 4px gap so the 375px single-row budget is unchanged.
const KBD_CLASS =
  "rk-glint min-h-[33px] min-w-[35px] coarse:min-h-[36px] coarse:min-w-[36px] flex items-center justify-center px-1 py-0 text-xs border border-border rounded select-none transition-colors hover:border-text-secondary active:bg-bg-card focus-visible:outline-2 focus-visible:outline-accent";

/** Long-press duration (ms) to toggle scroll-lock. */
const LONG_PRESS_MS = 500;

/** Touch move distance (px) that cancels a long-press. */
const LONG_PRESS_MOVE_THRESHOLD = 10;

const MODIFIER_LABELS: Record<string, string> = {
  ctrl: "Control",
  alt: "Option",
};

/** Tier-1 tip copy for the modifier latch chips (260723-fm08): describes the
 *  verified one-shot latch — the armed modifier applies to the NEXT key sent
 *  (chip or physical keystroke) and is consumed. */
const MODIFIER_TIP_LABELS: Record<string, string> = {
  ctrl: "Ctrl for next key",
  alt: "Alt for next key",
};

/** Prevent mousedown from stealing focus away from the terminal. */
const preventFocusSteal = (e: React.MouseEvent) => e.preventDefault();

export function BottomBar({ onOpenCompose, onFocusTerminal, onScrollLockChange }: BottomBarProps) {
  const { focused } = useFocusedTerminal();
  const { composeStripEnabled } = useChromeState();
  const wsRef = focused?.wsRef;
  const mods = useModifierState();
  const [fnOpen, setFnOpen] = useState(false);
  const [scrollLocked, setScrollLocked] = useState(false);
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
        if (wsRef?.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(seq);
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [mods, wsRef]);

  const [termFocused, setTermFocused] = useState(false);

  useEffect(() => {
    function onFocusIn(e: FocusEvent) {
      if (e.target instanceof HTMLElement && e.target.closest(".xterm")) {
        setTermFocused(true);
      }
    }
    function onFocusOut(e: FocusEvent) {
      if (e.target instanceof HTMLElement && e.target.closest(".xterm")) {
        setTermFocused(false);
      }
    }
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  // Long-press detection state for keyboard toggle button
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTouchStartRef = useRef<{ x: number; y: number } | null>(null);
  const didLongPressRef = useRef(false);

  const toggleScrollLock = useCallback(
    (locked: boolean) => {
      setScrollLocked(locked);
      onScrollLockChange?.(locked);
    },
    [onScrollLockChange],
  );

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressTouchStartRef.current = null;
  }, []);

  const handleKbdTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const t = e.touches[0];
      longPressTouchStartRef.current = { x: t.clientX, y: t.clientY };
      didLongPressRef.current = false;
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null;
        didLongPressRef.current = true;
        const next = !scrollLocked;
        // Auto-dismiss keyboard before locking, but only if focus is within the terminal
        const activeEl = document.activeElement;
        if (next && activeEl instanceof HTMLElement && activeEl.closest(".xterm")) {
          activeEl.blur();
        }
        toggleScrollLock(next);
        navigator.vibrate?.(50);
      }, LONG_PRESS_MS);
    },
    [scrollLocked, toggleScrollLock],
  );

  const handleKbdTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!longPressTouchStartRef.current) return;
      const t = e.touches[0];
      const dx = t.clientX - longPressTouchStartRef.current.x;
      const dy = t.clientY - longPressTouchStartRef.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > LONG_PRESS_MOVE_THRESHOLD) {
        cancelLongPress();
      }
    },
    [cancelLongPress],
  );

  const handleKbdTouchEnd = useCallback(() => {
    cancelLongPress();
  }, [cancelLongPress]);

  // Summon the keyboard: when the compose strip is on, focus the strip's
  // textarea (its real DOM input is the mobile IME/autocorrect surface xterm
  // lacks) via the strip's module-level focus registry — NOT a test-id DOM
  // query (test ids are test-only in this repo). Falls back to the terminal if
  // the strip is off, unmounted, or declines (its "no target" disabled state).
  const focusInput = useCallback(() => {
    if (composeStripEnabled && focusComposeStrip()) return;
    onFocusTerminal?.();
  }, [composeStripEnabled, onFocusTerminal]);

  const handleKbdClick = useCallback(() => {
    if (didLongPressRef.current) {
      didLongPressRef.current = false;
      return;
    }
    if (scrollLocked) {
      // Tap in locked mode: unlock and summon keyboard
      toggleScrollLock(false);
      focusInput();
      return;
    }
    if (termFocused && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    } else {
      focusInput();
    }
  }, [scrollLocked, termFocused, toggleScrollLock, focusInput]);

  const send = useCallback(
    (data: string) => {
      if (wsRef?.current?.readyState === WebSocket.OPEN) {
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
    // TipGroup: the chip row is one warm-tip cluster (260723-fm08). Living
    // inside BottomBar itself, it covers BOTH render sites (app shell and the
    // board twin) with a single provider. Tips go only on the symbol-glyph
    // chips (tier-1 names controls lacking visible names) — the F▴ menu's
    // menuitem entries and the arrow-popup buttons already show text labels,
    // and the coarse-only ⌨/🔒 chip could never render a tip (Tip
    // self-suppresses under pointer: coarse).
    <TipGroup>
    <div className="flex items-center gap-1.5 coarse:gap-1 py-1.5 flex-wrap" role="toolbar" aria-label="Terminal keys">
      <Tip label="Tab" placement="top">
        <button aria-label="Tab" className={`${KBD_CLASS} text-text-secondary`} onMouseDown={preventFocusSteal} onClick={() => sendSpecial("\t")}>
          <kbd aria-hidden="true">{"\u21E5"}</kbd>
        </button>
      </Tip>

      {([["ctrl", "^"], ["alt", "\u2325"]] as const).map(([key, symbol]) => (
        <Tip key={key} label={MODIFIER_TIP_LABELS[key]} placement="top">
          <button
            aria-label={MODIFIER_LABELS[key]}
            aria-pressed={mods[key]}
            className={`${KBD_CLASS} ${mods[key] ? "bg-accent/20 border-accent text-accent" : "text-text-secondary"}`}
            onMouseDown={preventFocusSteal}
            onClick={() => mods.toggle(key)}
          >
            <kbd aria-hidden="true">{symbol}</kbd>
          </button>
        </Tip>
      ))}

      <div ref={fnRef} className="relative">
        <Tip label="Function keys" placement="top">
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
        </Tip>
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
                  onMouseDown={preventFocusSteal}
                  onClick={() => { sendWithMods(fk.plain, fk.mod); setFnOpen(false); }}
                >
                  {fk.label}
                </button>
              ))}
            </div>
            <div className="border-t border-border my-1" />
            <div className="grid grid-cols-3 gap-0.5">
              <button
                role="menuitem"
                aria-label="Escape"
                className="px-2 py-1 min-h-[36px] flex items-center justify-center text-xs text-text-secondary hover:text-text-primary hover:bg-bg-card rounded focus-visible:outline-2 focus-visible:outline-accent"
                onMouseDown={preventFocusSteal}
                onClick={() => { sendSpecial("\x1b"); setFnOpen(false); }}
              >
                Esc
              </button>
              {EXT_KEYS.map((ek) => (
                <button
                  key={ek.label}
                  role="menuitem"
                  aria-label={ek.label}
                  className="px-2 py-1 min-h-[36px] flex items-center justify-center text-xs text-text-secondary hover:text-text-primary hover:bg-bg-card rounded focus-visible:outline-2 focus-visible:outline-accent"
                  onMouseDown={preventFocusSteal}
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
        <Tip label="Compose text" placement="top">
          <button
            type="button"
            onMouseDown={preventFocusSteal}
            onClick={onOpenCompose}
            aria-label="Compose text"
            aria-pressed={composeStripEnabled}
            className={`${KBD_CLASS} ${composeStripEnabled ? "bg-accent/20 border-accent text-accent" : "text-text-secondary"}`}
          >
            &gt;_
          </button>
        </Tip>
      )}
      {/* kbd slot: the canonical palette shortcut string ("⌘K",
          keyboard-shortcuts.tsx) — a static string per the 73al contract. */}
      <Tip label="Command palette" kbd={"\u2318K"} placement="top">
        <button
          aria-label="Open command palette"
          className={`${KBD_CLASS} text-text-secondary`}
          onClick={() => document.dispatchEvent(new CustomEvent("palette:open"))}
        >
          <kbd aria-hidden="true">{"\u2318K"}</kbd>
        </button>
      </Tip>

      <div className="ml-auto flex items-center gap-1.5 coarse:gap-1">
        {/* Keyboard toggle — visible only on touch devices; long-press for scroll-lock */}
        <button
          type="button"
          aria-label={scrollLocked ? "Scroll lock on \u2014 tap to unlock" : termFocused ? "Hide keyboard" : "Show keyboard"}
          className={`${KBD_CLASS} hidden coarse:inline-flex ${scrollLocked ? "bg-accent/20 border-accent text-accent" : "text-text-secondary"}`}
          onMouseDown={preventFocusSteal}
          onTouchStart={handleKbdTouchStart}
          onTouchMove={handleKbdTouchMove}
          onTouchEnd={handleKbdTouchEnd}
          onClick={handleKbdClick}
        >
          <kbd aria-hidden="true">{scrollLocked ? "\uD83D\uDD12" : "\u2328"}</kbd>
        </button>
      </div>
    </div>
    </TipGroup>
  );
}

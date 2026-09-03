// The ⌥Space hold-to-talk chord. Deliberately OUTSIDE the keybinding
// registry: Alt is excluded from every registry tier by design (macOS
// character composition) and the dispatcher has no keyup/hold concept.
// Window-level keydown/keyup; mounted only when the caller's gates pass
// (voice enabled + mic supported). Editable-element suppression reuses the
// registry's shared predicate, so xterm's hidden helper textarea (the
// terminal's normal focus state) does NOT suppress the chord.

import { useEffect } from "react";

import { shouldSuppressChord } from "@/lib/keybindings";

/**
 * Hold ⌥Space to talk: keydown (exactly Alt — no Meta/Ctrl/Shift, no
 * auto-repeat, not in an editable element) starts the hold and
 * preventDefault()s to suppress the macOS non-breaking-space composition; the
 * next Space keyup (Alt still held or not) ends it. A window blur mid-hold
 * also ends it — the keyup the tab never saw can't strand the capture.
 */
export function useHoldToTalk(args: {
  enabled: boolean;
  onHoldStart: () => void;
  onHoldEnd: () => void;
}): void {
  const { enabled, onHoldStart, onHoldEnd } = args;

  useEffect(() => {
    if (!enabled) return;
    let held = false;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
      if (e.repeat || held) return;
      if (shouldSuppressChord(e.target)) return;
      e.preventDefault();
      held = true;
      onHoldStart();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !held) return;
      held = false;
      onHoldEnd();
    };
    const onBlur = () => {
      if (!held) return;
      held = false;
      onHoldEnd();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [enabled, onHoldStart, onHoldEnd]);
}

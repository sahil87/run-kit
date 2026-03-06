"use client";

import { useCallback, useMemo, useRef, useState } from "react";

type Modifier = "ctrl" | "alt" | "cmd";

export type ModifierSnapshot = { ctrl: boolean; alt: boolean; cmd: boolean };

export function useModifierState() {
  const stateRef = useRef<ModifierSnapshot>({ ctrl: false, alt: false, cmd: false });
  const [, rerender] = useState(0);

  const set = useCallback((mod: Modifier, value: boolean) => {
    stateRef.current = { ...stateRef.current, [mod]: value };
    rerender((n) => n + 1);
  }, []);

  const arm = useCallback((mod: Modifier) => set(mod, true), [set]);
  const disarm = useCallback((mod: Modifier) => set(mod, false), [set]);

  const toggle = useCallback(
    (mod: Modifier) => set(mod, !stateRef.current[mod]),
    [set],
  );

  const consume = useCallback((): ModifierSnapshot => {
    const snapshot = { ...stateRef.current };
    stateRef.current = { ctrl: false, alt: false, cmd: false };
    rerender((n) => n + 1);
    return snapshot;
  }, []);

  /** Read current state without consuming — safe in event handlers. */
  const peek = useCallback((): ModifierSnapshot => ({ ...stateRef.current }), []);

  /** True if any modifier is currently armed. */
  const isArmed = useCallback((): boolean => {
    const s = stateRef.current;
    return s.ctrl || s.alt || s.cmd;
  }, []);

  return useMemo(
    () => ({
      ctrl: stateRef.current.ctrl,
      alt: stateRef.current.alt,
      cmd: stateRef.current.cmd,
      arm,
      disarm,
      toggle,
      consume,
      peek,
      isArmed,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stateRef.current.ctrl, stateRef.current.alt, stateRef.current.cmd, arm, disarm, toggle, consume],
  );
}

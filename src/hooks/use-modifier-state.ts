"use client";

import { useCallback, useRef, useState } from "react";

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

  return {
    ctrl: stateRef.current.ctrl,
    alt: stateRef.current.alt,
    cmd: stateRef.current.cmd,
    arm,
    disarm,
    toggle,
    consume,
  };
}

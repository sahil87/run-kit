import { useCallback, useEffect, useRef, useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";

/** How long the transient `copied ✓` feedback shows before reverting. */
export const COPY_FEEDBACK_MS = 1000;

/**
 * Keyed click-to-copy interaction shared by the register surfaces (the Pane
 * panel's rows and the status bar's segments/menu rows). One hook instance
 * owns ONE feedback slot: copying any key claims it (re-copy resets the
 * timer), so at most one `copied ✓` shows per surface — the Pane panel's
 * original `copiedRow` contract.
 *
 * `copy(key, value)` guards first — an in-progress text selection means the
 * click was a select gesture, never a copy — then fires the shared
 * `copyToClipboard` (fire-and-forget: the clipboard util resolves false
 * rather than throwing) and holds `copiedKey === key` for COPY_FEEDBACK_MS.
 */
export function useCopyFeedback<K extends string = string>() {
  const [copiedKey, setCopiedKey] = useState<K | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up a pending revert timer on unmount so it can't set state on a
  // dead component.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback((key: K, value: string) => {
    if (window.getSelection()?.toString()) return;
    void copyToClipboard(value);
    setCopiedKey(key);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setCopiedKey(null);
      timerRef.current = null;
    }, COPY_FEEDBACK_MS);
  }, []);

  return { copiedKey, copy };
}

import { useEffect, useRef, useCallback } from "react";
import { useChrome, useChromeDispatch } from "@/contexts/chrome-context";
import type { WindowInfo } from "@/types";

type UseAppShortcutsOptions = {
  currentWindow: WindowInfo | null;
  onCreateSession: () => void;
  onRenameWindow: (name: string) => void;
};

export function useAppShortcuts({
  currentWindow,
  onCreateSession,
  onRenameWindow,
}: UseAppShortcutsOptions) {
  const { drawerOpen } = useChrome();
  const { setDrawerOpen } = useChromeDispatch();

  const escTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (escTimerRef.current) {
          clearTimeout(escTimerRef.current);
          escTimerRef.current = null;
          if (drawerOpen) setDrawerOpen(false);
        } else {
          escTimerRef.current = setTimeout(() => {
            escTimerRef.current = null;
          }, 300);
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        // Handled by CommandPalette
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }

      if (e.key === "c") {
        e.preventDefault();
        onCreateSession();
      } else if (e.key === "r" && currentWindow) {
        e.preventDefault();
        onRenameWindow(currentWindow.name);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (escTimerRef.current) clearTimeout(escTimerRef.current);
    };
  }, [drawerOpen, setDrawerOpen, currentWindow, onCreateSession, onRenameWindow]);
}

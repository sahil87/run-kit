import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { BoardPaneInfo } from "@/api/boards";

/**
 * Focused-pane context — the publication channel for the board route's focused
 * tile, so the sidebar's bottom PANE panel can follow it (260720-zx4i).
 *
 * `BoardPage` owns a single source of truth for the focused tile (its
 * `focusedPane` memo / `entries[focusedIndex]`); this context carries that
 * identity — plus the board entry's thin pane data — out of the board page and
 * into shared chrome. `BottomPanels` (sidebar) consumes it as a fallback when
 * the route provides no selected window: it resolves the window by `windowId`
 * across `sessionsByServer.get(server)` (the LINK-based home-session copy of a
 * pinned window flows through the sessions stream fully enriched), and falls
 * back to a thin render from `windowName` + `panes` for a pin-only window
 * (home session died while pinned — absent from the stream).
 *
 * Distinct from `FocusedTerminalContext` (which registers the focused xterm's
 * imperative send/focus surface for the compose strip); this context carries
 * declarative pane *identity/data*, not a terminal handle.
 *
 * Pattern mirrors `top-bar-slot-context`: a root-level provider
 * (`RootWrapper`) that pages register into via an effect (last-writer-wins,
 * clear-on-unmount), with a referentially-stable dispatcher so registrants can
 * dep-list it safely. When no page has registered (any non-board route, or the
 * board's lazy chunk still loading), the value is `null` and consumers keep
 * their existing empty states.
 */
export type FocusedPane = {
  server: string;
  windowId: string;
  /** The board entry's window name — thin-fallback header/name for a pin-only
   *  window absent from the sessions stream. */
  windowName: string;
  /** The board entry's per-pane data (paneId/paneIndex/cwd/command/isActive/
   *  gitBranch) from the getBoard join — the thin-fallback body. */
  panes: BoardPaneInfo[];
} | null;

type FocusedPaneContextValue = {
  focusedPane: FocusedPane;
  setFocusedPane: (pane: FocusedPane) => void;
};

const FocusedPaneContext = createContext<FocusedPaneContextValue | null>(null);

/**
 * Provider for `FocusedPaneContext`. Mount in `RootWrapper` above all routes
 * (alongside `TopBarSlotProvider`) so the registered value survives navigation
 * and is readable from both the AppShell and board sidebars.
 */
export function FocusedPaneProvider({ children }: { children: React.ReactNode }) {
  const [focusedPane, setFocusedPaneState] = useState<FocusedPane>(null);

  // Keep the dispatcher referentially stable so registering pages can pass it
  // straight into a `useEffect` dep list without retriggering every render.
  // Mirrors `TopBarSlotProvider`.
  const setFocusedPaneRef = useRef<((pane: FocusedPane) => void) | null>(null);
  if (!setFocusedPaneRef.current) {
    setFocusedPaneRef.current = (next: FocusedPane) => setFocusedPaneState(next);
  }

  const value = useMemo<FocusedPaneContextValue>(
    () => ({
      focusedPane,
      setFocusedPane: setFocusedPaneRef.current!,
    }),
    [focusedPane],
  );

  return (
    <FocusedPaneContext.Provider value={value}>
      {children}
    </FocusedPaneContext.Provider>
  );
}

/** Read the currently-registered focused pane (`null` when no board page has
 *  registered one). Throws outside a provider. */
export function useFocusedPane(): FocusedPane {
  const ctx = useContext(FocusedPaneContext);
  if (!ctx) {
    throw new Error("useFocusedPane must be used within FocusedPaneProvider");
  }
  return ctx.focusedPane;
}

/**
 * Register a page's focused pane into the context (last-writer-wins) and clear
 * it on unmount. Call once per page from its render body with a MEMOIZED value
 * (`null` is valid — an empty board publishes `null` while mounted); the
 * effect re-publishes whenever the value changes and resets the shared value
 * to `null` when the page unmounts, so a route with no registration never sees
 * stale board data. Throws outside a provider.
 */
export function useRegisterFocusedPane(pane: FocusedPane): void {
  const ctx = useContext(FocusedPaneContext);
  if (!ctx) {
    throw new Error("useRegisterFocusedPane must be used within FocusedPaneProvider");
  }
  const { setFocusedPane } = ctx;
  useEffect(() => {
    setFocusedPane(pane);
    return () => setFocusedPane(null);
  }, [setFocusedPane, pane]);
}

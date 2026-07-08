import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectSession, WindowInfo } from "@/types";

/**
 * TopBar slot context — the prop-delivery channel for the single persistent
 * `TopBar` mounted once at the root layout (`RootTopBar` in `app.tsx`), above
 * the router `<Outlet>` (260707-4vq2).
 *
 * The persistent TopBar's inputs split into two channels:
 *   - Route-derived (synchronous, at root): `mode` + `boardName` — derived from
 *     `useMatches()` in `RootTopBar`, so the heading flips the instant the URL
 *     changes and never waits on the incoming page's mount (important for the
 *     lazily-loaded board).
 *   - Page-registered (this context): the data/handler props a page owns —
 *     `sessions`, current session/window, connection state, and the create/
 *     navigate/toggle handlers whose heavy logic (View-Transitions gate,
 *     optimistic ghosts) stays in `AppShell`/`BoardPage`. Pages publish these
 *     via `useRegisterTopBarSlot(...)` in an effect and clear on unmount.
 *
 * Precedent: `FocusedTerminalProvider` — a root-level provider that pages
 * register into. Same referentially-stable-dispatcher + `useMemo`-value shape.
 *
 * When no page has registered (first frame after navigation, or a lazy chunk
 * still loading), the context value is `null`; `RootTopBar` falls back to the
 * tolerant-empty prop shape every TopBar mode already supports.
 */
export type TopBarSlot = {
  sessions: ProjectSession[];
  currentSession: ProjectSession | null;
  currentWindow: WindowInfo | null;
  sessionName: string;
  windowName: string;
  isConnected: boolean;
  sidebarOpen: boolean;
  server: string;
  onNavigate: (windowId: string) => void;
  onToggleSidebar: () => void;
  onCreateSession: () => void;
  onCreateWindow: (session: string) => void;
  /** Board-mode metadata (registered by `BoardPage`; absent otherwise). */
  paneCount?: number;
  serverCount?: number;
  waitingPaneCount?: number;
  boards?: { name: string }[];
  onCloseFocused?: () => void;
  closeDisabled?: boolean;
  /** Board-mode autofit toggle (738w): current per-board autofit state and its
   *  setter, published by `BoardPage` (like `onCloseFocused`). Absent outside
   *  board mode — the top-bar toggle renders only when both are present. */
  autofit?: boolean;
  onToggleAutofit?: () => void;
} | null;

type TopBarSlotContextValue = {
  slot: TopBarSlot;
  setSlot: (slot: TopBarSlot) => void;
  /**
   * A separate boolean channel (independent of `slot`) set by `NotFoundPage`
   * when it renders. Kept apart from the page-data slot so the not-found page
   * — which owns no TopBar data — signals the fallback with a bare boolean
   * rather than publishing the full slot shape (260707-4vq2 rework).
   */
  notFound: boolean;
  setNotFound: (notFound: boolean) => void;
};

const TopBarSlotContext = createContext<TopBarSlotContextValue | null>(null);

/**
 * Provider for `TopBarSlotContext`. Mount in `RootWrapper` above all routes so
 * the registered slot survives navigation and feeds the single persistent
 * `RootTopBar`.
 */
export function TopBarSlotProvider({ children }: { children: React.ReactNode }) {
  const [slot, setSlotState] = useState<TopBarSlot>(null);
  const [notFound, setNotFoundState] = useState(false);

  // Keep the dispatchers referentially stable so registering pages can pass
  // them straight into a `useEffect` dep list without retriggering every
  // render. Mirrors `FocusedTerminalProvider`/`chrome-context`.
  const setSlotRef = useRef<((slot: TopBarSlot) => void) | null>(null);
  if (!setSlotRef.current) {
    setSlotRef.current = (next: TopBarSlot) => setSlotState(next);
  }
  const setNotFoundRef = useRef<((notFound: boolean) => void) | null>(null);
  if (!setNotFoundRef.current) {
    setNotFoundRef.current = (next: boolean) => setNotFoundState(next);
  }

  const value = useMemo<TopBarSlotContextValue>(
    () => ({
      slot,
      setSlot: setSlotRef.current!,
      notFound,
      setNotFound: setNotFoundRef.current!,
    }),
    [slot, notFound],
  );

  return (
    <TopBarSlotContext.Provider value={value}>
      {children}
    </TopBarSlotContext.Provider>
  );
}

/** Read the currently-registered TopBar slot. Throws outside a provider. */
export function useTopBarSlot(): TopBarSlot {
  const ctx = useContext(TopBarSlotContext);
  if (!ctx) {
    throw new Error("useTopBarSlot must be used within TopBarSlotProvider");
  }
  return ctx.slot;
}

/**
 * Read whether the not-found page is currently rendered. `RootTopBar` uses this
 * to force the minimal `cockpit`-like fallback mode: TanStack Router's fuzzy
 * not-found handling retains the partially-matched route params in
 * `useMatches()` (e.g. `/board/x/y` keeps `name=x`), so route params alone
 * would derive `board` mode ("Board: x") over the not-found body. This explicit
 * signal is the only thing that distinguishes "NotFoundPage is rendering" from
 * a real board route (260707-4vq2 rework). Throws outside a provider.
 */
export function useTopBarNotFound(): boolean {
  const ctx = useContext(TopBarSlotContext);
  if (!ctx) {
    throw new Error("useTopBarNotFound must be used within TopBarSlotProvider");
  }
  return ctx.notFound;
}

/**
 * Signal that the not-found page is rendered — sets the shared `notFound` flag
 * true on mount and clears it on unmount. Call once from `NotFoundPage`'s render
 * body so `RootTopBar` forces the cockpit fallback for the lifetime of that
 * page (see `useTopBarNotFound`). Throws outside a provider.
 */
export function useSignalTopBarNotFound(): void {
  const ctx = useContext(TopBarSlotContext);
  if (!ctx) {
    throw new Error("useSignalTopBarNotFound must be used within TopBarSlotProvider");
  }
  const { setNotFound } = ctx;
  useEffect(() => {
    setNotFound(true);
    return () => setNotFound(false);
  }, [setNotFound]);
}

/**
 * Register a page's TopBar props into the slot (last-writer-wins) and clear
 * them on unmount. Call once per page from its render body — the effect
 * re-publishes whenever `slot` changes and clears the shared value when the
 * page unmounts.
 *
 * Clear-on-unmount is keyed on the shared `setSlot`: on unmount we reset the
 * value to `null` so a subsequent route with no registration (e.g. a lazy
 * chunk still loading) sees the tolerant-empty default rather than the prior
 * page's stale props.
 */
export function useRegisterTopBarSlot(slot: NonNullable<TopBarSlot>): void {
  const ctx = useContext(TopBarSlotContext);
  if (!ctx) {
    throw new Error("useRegisterTopBarSlot must be used within TopBarSlotProvider");
  }
  const { setSlot } = ctx;
  useEffect(() => {
    setSlot(slot);
    return () => setSlot(null);
  }, [setSlot, slot]);
}

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { PaletteAction } from "@/components/command-palette";

/**
 * Palette-actions slot context (260811-239r) — the register-into-a-root-mount
 * channel for the single `CommandPalette` mounted once in `AppLayout`,
 * mirroring `top-bar-slot-context.tsx` (260707-4vq2).
 *
 * Routes publish their route-scoped, already-shortcut-decorated action lists
 * via `useRegisterPaletteActions(actions)` — a referentially-stable
 * dispatcher, last-writer-wins, clear-on-unmount (same shape as
 * `useRegisterTopBarSlot`). The provider receives the layout-level
 * `globalActions` as a prop; the merged decorated list is
 * `[...routeActions, ...globalActions]`.
 *
 * TWO CHANNELS, deliberately split (render-loop guard):
 *   - State channel (`usePaletteActions`) — the reactive merged list, for the
 *     layout-level LEAF mounts only (the palette itself, the shortcuts
 *     overlay's macro-target list). Every registration re-renders these.
 *   - API channel (`usePaletteActionsApi`) — a referentially STABLE
 *     `{ setRouteActions, getAllActions }` pair whose context value never
 *     changes identity, plus the separate globals-only channel
 *     (`usePaletteGlobals`). Routes register and resolve through these
 *     without ever subscribing to the ROUTE-ACTIONS state they publish.
 *     Subscribing would close a render loop: publish → state change → route
 *     re-render → action arrays recomputed with fresh identities
 *     (pre-existing memo churn, e.g. the inline `useDialogState` callbacks)
 *     → re-publish → ∞ ("Maximum update depth exceeded").
 *
 * Why globals get their own channel: a route's id-resolution seams
 * (AppShell's `fromPalette` keybinding dispatch) need the CURRENT list at
 * memo-build time with zero lag — resolving through the slot would lag one
 * commit (the registration effect lands after the memo builds), and the slot
 * content can never trigger the rebuild (the route isn't subscribed), so a
 * chord could stay dead indefinitely. Globals-only subscription is loop-safe
 * because the `globalActions` prop identity never changes in response to a
 * route registration. The merged resolution list is then
 * `[...routeActionsLocal, ...globalActions]` — both sides this-render fresh.
 * Macro invocation resolves via `getAllActions()` at call time, where the
 * one-commit registration lag is irrelevant.
 *
 * When no route has registered (first frame after navigation, or a lazy
 * chunk still loading), the route list is empty and the merged list holds the
 * global groups only — never the previous route's stale actions.
 */
type PaletteActionsStateValue = {
  /** Merged decorated list: the registered route actions followed by the
   *  layout-level global groups, in that order. Reactive — identity changes
   *  on every registration. */
  allActions: PaletteAction[];
};

type PaletteActionsApiValue = {
  /** Internal dispatcher used by `useRegisterPaletteActions`. Referentially
   *  stable so registering routes can pass it straight into a `useEffect`
   *  dep list without retriggering every render. */
  setRouteActions: (actions: PaletteAction[]) => void;
  /** Imperative read of the CURRENT merged list (route actions first, then
   *  globals). Referentially stable; resolves at call time, so it never
   *  subscribes the caller. For id-resolution seams that run on chords or
   *  macro invocation — NOT for rendering (use `usePaletteActions`). */
  getAllActions: () => PaletteAction[];
};

const PaletteActionsStateContext = createContext<PaletteActionsStateValue | null>(null);
const PaletteActionsApiContext = createContext<PaletteActionsApiValue | null>(null);
// Globals-only channel: its value is the `globalActions` prop identity, which
// never changes in response to a route registration — so routes may subscribe
// to it safely (no publish→re-render→re-publish loop).
const PaletteActionsGlobalsContext = createContext<PaletteAction[] | null>(null);

/**
 * Provider for the palette-actions slot. Mount in `AppLayout` above the
 * router outlet so the registered route actions feed the single
 * layout-mounted `CommandPalette`. `globalActions` is the layout-level
 * global group list (nav, font, refresh, help, settings, update/
 * maintenance/version), already shortcut-decorated.
 */
export function PaletteActionsProvider({
  globalActions,
  children,
}: {
  globalActions: PaletteAction[];
  children: React.ReactNode;
}) {
  const [routeActions, setRouteActionsState] = useState<PaletteAction[]>([]);

  // Keep the dispatcher referentially stable (mirrors
  // `TopBarSlotProvider`/`FocusedTerminalProvider`).
  const setRouteActionsRef = useRef<((actions: PaletteAction[]) => void) | null>(null);
  if (!setRouteActionsRef.current) {
    setRouteActionsRef.current = (next: PaletteAction[]) => setRouteActionsState(next);
  }

  const allActions = useMemo(
    () => [...routeActions, ...globalActions],
    [routeActions, globalActions],
  );

  // Render-synced ref backing the imperative API channel.
  const allActionsRef = useRef<PaletteAction[]>(allActions);
  allActionsRef.current = allActions;

  // The API value is created once and never changes identity — routes that
  // register/resolve through it are NOT subscribed to the state channel.
  const apiValue = useMemo<PaletteActionsApiValue>(
    () => ({
      setRouteActions: setRouteActionsRef.current!,
      getAllActions: () => allActionsRef.current,
    }),
    [],
  );

  const stateValue = useMemo<PaletteActionsStateValue>(
    () => ({ allActions }),
    [allActions],
  );

  return (
    <PaletteActionsApiContext.Provider value={apiValue}>
      <PaletteActionsGlobalsContext.Provider value={globalActions}>
        <PaletteActionsStateContext.Provider value={stateValue}>
          {children}
        </PaletteActionsStateContext.Provider>
      </PaletteActionsGlobalsContext.Provider>
    </PaletteActionsApiContext.Provider>
  );
}

/**
 * Read the merged decorated palette action list REACTIVELY (route actions
 * first, then the global groups) — re-renders the consumer on every
 * registration. For the layout-level mounts that RENDER the list (the
 * command palette, the shortcuts overlay's macro targets). Routes resolving
 * actions by id MUST use `usePaletteActionsApi().getAllActions` instead —
 * subscribing here while also registering closes a render loop (see the
 * file header). Throws outside a provider.
 */
export function usePaletteActions(): PaletteAction[] {
  const ctx = useContext(PaletteActionsStateContext);
  if (!ctx) {
    throw new Error("usePaletteActions must be used within PaletteActionsProvider");
  }
  return ctx.allActions;
}

/**
 * The layout-level GLOBAL groups, reactively. Safe for routes to subscribe:
 * this channel's value changes only when the `globalActions` prop changes —
 * never in response to a route registration — so a route can build its
 * zero-lag resolution list `[...localRouteActions, ...globalActions]`
 * without closing a render loop. Throws outside a provider.
 */
export function usePaletteGlobals(): PaletteAction[] {
  const ctx = useContext(PaletteActionsGlobalsContext);
  if (!ctx) {
    throw new Error("usePaletteGlobals must be used within PaletteActionsProvider");
  }
  return ctx;
}

/**
 * The stable API channel: `getAllActions()` resolves the current merged list
 * imperatively (no subscription), `setRouteActions` backs
 * `useRegisterPaletteActions`. Throws outside a provider.
 */
export function usePaletteActionsApi(): PaletteActionsApiValue {
  const ctx = useContext(PaletteActionsApiContext);
  if (!ctx) {
    throw new Error("usePaletteActionsApi must be used within PaletteActionsProvider");
  }
  return ctx;
}

/**
 * Register a route's palette actions into the slot (last-writer-wins) and
 * clear them on unmount. Call once per route from its render body — the
 * effect re-publishes whenever `actions` changes and clears the shared value
 * when the route unmounts, so a subsequent route with no registration (e.g.
 * a lazy chunk still loading) sees the global groups only rather than the
 * prior route's stale actions. Reads the stable API channel only, so
 * registering never subscribes the route to the state it publishes.
 */
export function useRegisterPaletteActions(actions: PaletteAction[]): void {
  const { setRouteActions } = usePaletteActionsApi();
  useEffect(() => {
    setRouteActions(actions);
    return () => setRouteActions([]);
  }, [setRouteActions, actions]);
}

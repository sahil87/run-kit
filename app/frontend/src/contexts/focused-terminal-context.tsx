import { createContext, useContext, useMemo, useRef, useState } from "react";

/**
 * The currently-focused terminal across the app. There is exactly one
 * focused terminal at any time, or `null` when no terminal is mounted
 * (e.g., the dashboard route).
 *
 * Producers:
 *   - `TerminalClient` (single-terminal route): registers on mount, clears
 *     on unmount.
 *   - `BoardPane` (board route): registers on focus events (click,
 *     cycle, initial pane). Does NOT clear on focus loss — the next pane
 *     to gain focus overwrites.
 *
 * Consumer:
 *   - `BottomBar`: reads `focused?.wsRef` to send keystrokes/input to
 *     the active terminal. The existing `readyState !== OPEN` guard
 *     handles the `null` case naturally.
 *
 * Compose-open state lives here too: shell-level affordances (BottomBar,
 * TopBar `>_`) can open the compose buffer for the focused terminal
 * without the calling site knowing which TerminalClient is focused. The
 * focused TerminalClient instance reads `composeOpen` and renders the
 * `ComposeBuffer` itself — anchoring compose to a specific TerminalClient
 * lifetime satisfies the spec's "compose target frozen at open time"
 * scenario (cycling focus while compose is open does not retarget,
 * because the open ComposeBuffer's parent TerminalClient never unmounts).
 */
export type FocusedTerminal = {
  wsRef: React.RefObject<WebSocket | null>;
  server: string;
  session: string;
  windowId: string;
} | null;

type FocusedTerminalContextValue = {
  focused: FocusedTerminal;
  setFocused: (t: FocusedTerminal) => void;
  composeOpen: boolean;
  setComposeOpen: (open: boolean) => void;
};

const FocusedTerminalContext = createContext<FocusedTerminalContextValue | null>(null);

/**
 * Provider for `FocusedTerminalContext`. Mount in `RootWrapper` above all
 * routes (alongside `SessionProvider`) so the focused terminal survives
 * navigation between `/$server/...` and `/board/$name`.
 */
export function FocusedTerminalProvider({ children }: { children: React.ReactNode }) {
  const [focused, setFocusedState] = useState<FocusedTerminal>(null);
  const [composeOpen, setComposeOpenState] = useState(false);

  // Keep dispatchers referentially stable so callers can pass them directly
  // into `useEffect` deps without retriggering on every render. Mirrors the
  // dispatch-stability pattern used by `chrome-context.tsx`.
  const dispatchersRef = useRef<{
    setFocused: (t: FocusedTerminal) => void;
    setComposeOpen: (open: boolean) => void;
  } | null>(null);
  if (!dispatchersRef.current) {
    dispatchersRef.current = {
      setFocused: (t: FocusedTerminal) => setFocusedState(t),
      setComposeOpen: (open: boolean) => setComposeOpenState(open),
    };
  }

  const value = useMemo<FocusedTerminalContextValue>(
    () => ({
      focused,
      setFocused: dispatchersRef.current!.setFocused,
      composeOpen,
      setComposeOpen: dispatchersRef.current!.setComposeOpen,
    }),
    [focused, composeOpen],
  );

  return (
    <FocusedTerminalContext.Provider value={value}>
      {children}
    </FocusedTerminalContext.Provider>
  );
}

/** Read + dispatch focused-terminal state. Throws when used outside a provider. */
export function useFocusedTerminal(): FocusedTerminalContextValue {
  const ctx = useContext(FocusedTerminalContext);
  if (!ctx) {
    throw new Error("useFocusedTerminal must be used within FocusedTerminalProvider");
  }
  return ctx;
}

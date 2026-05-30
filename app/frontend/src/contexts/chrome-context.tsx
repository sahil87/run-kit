import { createContext, useContext, useState, useCallback, useMemo, useRef } from "react";
import type { ProjectSession, WindowInfo } from "@/types";
import { MOBILE_BREAKPOINT_PX } from "@/hooks/use-is-mobile";

export type BreadcrumbDropdownItem = {
  label: string;
  href: string;
  current?: boolean;
};

const FIXED_WIDTH_STORAGE_KEY = "runkit-fixed-width";
const SIDEBAR_OPEN_STORAGE_KEY = "runkit-sidebar-open";
const SIDEBAR_WIDTH_STORAGE_KEY = "runkit-sidebar-width";

const SIDEBAR_DEFAULT_WIDTH = 220;
const SIDEBAR_MIN_WIDTH = 160;
const SIDEBAR_MAX_WIDTH = 400;

export const SIDEBAR_WIDTH_BOUNDS = {
  default: SIDEBAR_DEFAULT_WIDTH,
  min: SIDEBAR_MIN_WIDTH,
  max: SIDEBAR_MAX_WIDTH,
} as const;

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

function readFixedWidth(): boolean {
  try {
    return localStorage.getItem(FIXED_WIDTH_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** Whether the current viewport should be treated as mobile for layout
 * defaults. Mirrors `useIsMobile`'s rule (narrow width OR coarse pointer) but
 * runs once at state init, where hooks can't. Guarded for non-browser envs. */
function isMobileViewport(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return (
    window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`).matches ||
    window.matchMedia("(pointer: coarse)").matches
  );
}

function readSidebarOpen(): boolean {
  try {
    const stored = localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch { /* noop */ }
  // No explicit preference: the drawer covers most of a phone screen, so it
  // starts collapsed on mobile and expanded on desktop. An explicit stored
  // choice (above) always wins, so a user who opened it on mobile keeps it.
  return !isMobileViewport();
}

function readSidebarWidth(): number {
  try {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (stored) {
      const parsed = Number(stored);
      if (!isNaN(parsed)) return clampSidebarWidth(parsed);
    }
  } catch { /* noop */ }
  return SIDEBAR_DEFAULT_WIDTH;
}

type ChromeState = {
  currentSession: ProjectSession | null;
  currentWindow: WindowInfo | null;
  sidebarOpen: boolean;
  sidebarWidth: number;
  isConnected: boolean;
  fixedWidth: boolean;
};

type ChromeDispatch = {
  setCurrentSession: (session: ProjectSession | null) => void;
  setCurrentWindow: (win: WindowInfo | null) => void;
  setSidebarOpen: (open: boolean) => void;
  /** In-memory only — does NOT touch localStorage. Use during drag for live
   * resize updates; call `persistSidebarWidth` once the drag completes to
   * commit the final value. Persisting on every pointermove (40-100/s)
   * regresses the pre-change behavior where the value was only written at
   * drag-end. */
  setSidebarWidth: (width: number) => void;
  /** Persist the current sidebar width to localStorage. Call from the
   * drag-end handler so the value survives reload. */
  persistSidebarWidth: (width: number) => void;
  setIsConnected: (connected: boolean) => void;
  toggleFixedWidth: () => void;
};

const ChromeStateContext = createContext<ChromeState | null>(null);
const ChromeDispatchContext = createContext<ChromeDispatch | null>(null);

export function ChromeProvider({ children }: { children: React.ReactNode }) {
  const [currentSession, setCurrentSession] = useState<ProjectSession | null>(null);
  const [currentWindow, setCurrentWindow] = useState<WindowInfo | null>(null);
  const [sidebarOpen, setSidebarOpenState] = useState(readSidebarOpen);
  const [sidebarWidth, setSidebarWidthState] = useState(readSidebarWidth);

  const setSidebarOpen = useCallback((open: boolean) => {
    try { localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, String(open)); } catch { /* noop */ }
    setSidebarOpenState(open);
  }, []);

  // In-memory only — see ChromeDispatch.setSidebarWidth doc above. Drag handlers
  // call this on every pointermove for live width updates; the drag-end handler
  // calls `persistSidebarWidth` once the gesture completes.
  const setSidebarWidth = useCallback((width: number) => {
    setSidebarWidthState(clampSidebarWidth(width));
  }, []);

  const persistSidebarWidth = useCallback((width: number) => {
    const clamped = clampSidebarWidth(width);
    try { localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clamped)); } catch { /* noop */ }
    setSidebarWidthState(clamped);
  }, []);

  const [isConnected, setIsConnected] = useState(false);
  const [fixedWidth, setFixedWidth] = useState(readFixedWidth);

  const toggleFixedWidth = useCallback(() => {
    setFixedWidth((prev) => {
      const next = !prev;
      try { localStorage.setItem(FIXED_WIDTH_STORAGE_KEY, String(next)); } catch { /* noop */ }
      return next;
    });
  }, []);

  const stateValue = useMemo<ChromeState>(
    () => ({ currentSession, currentWindow, sidebarOpen, sidebarWidth, isConnected, fixedWidth }),
    [currentSession, currentWindow, sidebarOpen, sidebarWidth, isConnected, fixedWidth],
  );

  const dispatchRef = useRef<ChromeDispatch | null>(null);
  if (!dispatchRef.current) {
    dispatchRef.current = {
      setCurrentSession,
      setCurrentWindow,
      setSidebarOpen,
      setSidebarWidth,
      persistSidebarWidth,
      setIsConnected,
      toggleFixedWidth,
    };
  }

  return (
    <ChromeStateContext.Provider value={stateValue}>
      <ChromeDispatchContext.Provider value={dispatchRef.current}>
        {children}
      </ChromeDispatchContext.Provider>
    </ChromeStateContext.Provider>
  );
}

export function useChrome(): ChromeState & ChromeDispatch {
  const state = useContext(ChromeStateContext);
  const dispatch = useContext(ChromeDispatchContext);
  if (!state || !dispatch) throw new Error("useChrome must be used within ChromeProvider");
  return useMemo(() => ({ ...state, ...dispatch }), [state, dispatch]);
}

export function useChromeState(): ChromeState {
  const state = useContext(ChromeStateContext);
  if (!state) throw new Error("useChromeState must be used within ChromeProvider");
  return state;
}

export function useChromeDispatch(): ChromeDispatch {
  const dispatch = useContext(ChromeDispatchContext);
  if (!dispatch) throw new Error("useChromeDispatch must be used within ChromeProvider");
  return dispatch;
}

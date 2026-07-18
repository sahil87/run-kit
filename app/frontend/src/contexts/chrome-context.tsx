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
const TERMINAL_FONT_STORAGE_KEY = "runkit-terminal-font-size";
const COMPOSE_STRIP_STORAGE_KEY = "runkit-compose-strip";

const SIDEBAR_DEFAULT_WIDTH = 220;
const SIDEBAR_MIN_WIDTH = 160;
const SIDEBAR_MAX_WIDTH = 400;

const TERMINAL_FONT_MIN = 8;
const TERMINAL_FONT_MAX = 24;
const TERMINAL_FONT_STEP = 1;
// Device defaults (the values terminal-client.tsx previously hardcoded),
// used when no preference is stored. The terminal font size is JS-driven only
// (xterm `options.fontSize`); there is no CSS rule it must stay aligned with.
const TERMINAL_FONT_DEFAULT_MOBILE = 11;
const TERMINAL_FONT_DEFAULT_DESKTOP = 13;

export const SIDEBAR_WIDTH_BOUNDS = {
  default: SIDEBAR_DEFAULT_WIDTH,
  min: SIDEBAR_MIN_WIDTH,
  max: SIDEBAR_MAX_WIDTH,
} as const;

export const TERMINAL_FONT_BOUNDS = {
  min: TERMINAL_FONT_MIN,
  max: TERMINAL_FONT_MAX,
  step: TERMINAL_FONT_STEP,
} as const;

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

function clampTerminalFont(px: number): number {
  return Math.min(TERMINAL_FONT_MAX, Math.max(TERMINAL_FONT_MIN, px));
}

function readFixedWidth(): boolean {
  try {
    return localStorage.getItem(FIXED_WIDTH_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** Whether the docked compose strip is enabled (a global chrome preference,
 * persisted like `fixedWidth`). Absent key defaults to off. */
function readComposeStrip(): boolean {
  try {
    return localStorage.getItem(COMPOSE_STRIP_STORAGE_KEY) === "true";
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

/** Device default terminal font size when no explicit preference is stored.
 * Reuses the same mobile rule as the rest of the chrome (narrow width OR
 * coarse pointer) via the shared `isMobileViewport()` helper. */
function deviceDefaultFontSize(): number {
  return isMobileViewport() ? TERMINAL_FONT_DEFAULT_MOBILE : TERMINAL_FONT_DEFAULT_DESKTOP;
}

/** Stored terminal-font preference (clamped) if present; otherwise null = "no
 * preference, use the device default". A null/absent key is the unset state
 * that `resetTerminalFont` returns to. */
function readTerminalFontSize(): number | null {
  try {
    const stored = localStorage.getItem(TERMINAL_FONT_STORAGE_KEY);
    if (stored === null) return null;
    const parsed = Number(stored);
    if (!isNaN(parsed)) return clampTerminalFont(parsed);
  } catch { /* noop */ }
  return null;
}

type ChromeState = {
  currentSession: ProjectSession | null;
  currentWindow: WindowInfo | null;
  sidebarOpen: boolean;
  sidebarWidth: number;
  isConnected: boolean;
  fixedWidth: boolean;
  /** Effective terminal font size in px — the stored preference if set, else
   * the device default (11 mobile / 13 desktop). This is what `TerminalClient`
   * reads and what the top-bar combo control displays. */
  terminalFontSize: number;
  /** Whether the docked compose strip is enabled — a global chrome preference
   * persisted to `runkit-compose-strip`. When on, the strip renders above the
   * bottom bar on every route that mounts a `<BottomBar>`. */
  composeStripEnabled: boolean;
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
  /** Step the terminal font up/down by one step from the *effective* size,
   * clamped into TERMINAL_FONT_BOUNDS and persisted to localStorage. The first
   * step from the unset state operates on the device default. */
  increaseTerminalFont: () => void;
  decreaseTerminalFont: () => void;
  /** Forget the preference: removes the stored key so the effective size falls
   * back to the device default. */
  resetTerminalFont: () => void;
  /** Toggle the docked compose strip on/off, persisting to localStorage. */
  toggleComposeStrip: () => void;
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

  // Stored *preference* (number | null). null = unset → fall back to the device
  // default. Storing the preference (not the effective value) is what lets
  // `resetTerminalFont` distinguish "unset" from "happens to equal the default".
  const [terminalFontPref, setTerminalFontPref] = useState(readTerminalFontSize);
  const terminalFontSize = terminalFontPref ?? deviceDefaultFontSize();

  // Step from the *effective* size so the first step out of the unset state
  // lands adjacent to the device default (e.g. desktop 13 → 14).
  const stepTerminalFont = useCallback((delta: number) => {
    setTerminalFontPref((prev) => {
      const effective = prev ?? deviceDefaultFontSize();
      const next = clampTerminalFont(effective + delta);
      try { localStorage.setItem(TERMINAL_FONT_STORAGE_KEY, String(next)); } catch { /* noop */ }
      return next;
    });
  }, []);

  const increaseTerminalFont = useCallback(
    () => stepTerminalFont(TERMINAL_FONT_STEP),
    [stepTerminalFont],
  );
  const decreaseTerminalFont = useCallback(
    () => stepTerminalFont(-TERMINAL_FONT_STEP),
    [stepTerminalFont],
  );
  const resetTerminalFont = useCallback(() => {
    try { localStorage.removeItem(TERMINAL_FONT_STORAGE_KEY); } catch { /* noop */ }
    setTerminalFontPref(null);
  }, []);

  const [composeStripEnabled, setComposeStripEnabled] = useState(readComposeStrip);

  const toggleComposeStrip = useCallback(() => {
    setComposeStripEnabled((prev) => {
      const next = !prev;
      try { localStorage.setItem(COMPOSE_STRIP_STORAGE_KEY, String(next)); } catch { /* noop */ }
      return next;
    });
  }, []);

  const stateValue = useMemo<ChromeState>(
    () => ({ currentSession, currentWindow, sidebarOpen, sidebarWidth, isConnected, fixedWidth, terminalFontSize, composeStripEnabled }),
    [currentSession, currentWindow, sidebarOpen, sidebarWidth, isConnected, fixedWidth, terminalFontSize, composeStripEnabled],
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
      increaseTerminalFont,
      decreaseTerminalFont,
      resetTerminalFont,
      toggleComposeStrip,
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

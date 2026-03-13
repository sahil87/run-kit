import { createContext, useContext, useState, useCallback, useMemo, useRef } from "react";
import type { ProjectSession, WindowInfo } from "@/types";

export type BreadcrumbDropdownItem = {
  label: string;
  href: string;
  current?: boolean;
};

const FIXED_WIDTH_STORAGE_KEY = "runkit-fixed-width";

function readFixedWidth(): boolean {
  try {
    return localStorage.getItem(FIXED_WIDTH_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

type ChromeState = {
  currentSession: ProjectSession | null;
  currentWindow: WindowInfo | null;
  sidebarOpen: boolean;
  drawerOpen: boolean;
  isConnected: boolean;
  fixedWidth: boolean;
};

type ChromeDispatch = {
  setCurrentSession: (session: ProjectSession | null) => void;
  setCurrentWindow: (win: WindowInfo | null) => void;
  setSidebarOpen: (open: boolean) => void;
  setDrawerOpen: (open: boolean) => void;
  setIsConnected: (connected: boolean) => void;
  toggleFixedWidth: () => void;
};

const ChromeStateContext = createContext<ChromeState | null>(null);
const ChromeDispatchContext = createContext<ChromeDispatch | null>(null);

export function ChromeProvider({ children }: { children: React.ReactNode }) {
  const [currentSession, setCurrentSession] = useState<ProjectSession | null>(null);
  const [currentWindow, setCurrentWindow] = useState<WindowInfo | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
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
    () => ({ currentSession, currentWindow, sidebarOpen, drawerOpen, isConnected, fixedWidth }),
    [currentSession, currentWindow, sidebarOpen, drawerOpen, isConnected, fixedWidth],
  );

  const dispatchRef = useRef<ChromeDispatch | null>(null);
  if (!dispatchRef.current) {
    dispatchRef.current = {
      setCurrentSession,
      setCurrentWindow,
      setSidebarOpen,
      setDrawerOpen,
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

export function useChromeDispatch(): ChromeDispatch {
  const dispatch = useContext(ChromeDispatchContext);
  if (!dispatch) throw new Error("useChromeDispatch must be used within ChromeProvider");
  return dispatch;
}

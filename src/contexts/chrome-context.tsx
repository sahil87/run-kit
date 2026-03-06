"use client";

import { createContext, useContext, useState, useMemo, useRef, useEffect } from "react";

export type BreadcrumbDropdownItem = {
  label: string;
  href: string;
  current?: boolean;
};

export type Breadcrumb = {
  icon?: string;
  label: string;
  href?: string;
  dropdownItems?: BreadcrumbDropdownItem[];
};

type ChromeState = {
  breadcrumbs: Breadcrumb[];
  line2Left: React.ReactNode;
  line2Right: React.ReactNode;
  bottomBar: React.ReactNode;
  isConnected: boolean;
  fullbleed: boolean;
};

type ChromeDispatch = {
  setBreadcrumbs: (crumbs: Breadcrumb[]) => void;
  setLine2Left: (node: React.ReactNode) => void;
  setLine2Right: (node: React.ReactNode) => void;
  setBottomBar: (node: React.ReactNode) => void;
  setIsConnected: (connected: boolean) => void;
  setFullbleed: (v: boolean) => void;
};

const ChromeStateContext = createContext<ChromeState | null>(null);
const ChromeDispatchContext = createContext<ChromeDispatch | null>(null);

export function ChromeProvider({ children }: { children: React.ReactNode }) {
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [line2Left, setLine2Left] = useState<React.ReactNode>(null);
  const [line2Right, setLine2Right] = useState<React.ReactNode>(null);
  const [bottomBar, setBottomBar] = useState<React.ReactNode>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [fullbleed, setFullbleed] = useState(false);

  const stateValue = useMemo<ChromeState>(
    () => ({ breadcrumbs, line2Left, line2Right, bottomBar, isConnected, fullbleed }),
    [breadcrumbs, line2Left, line2Right, bottomBar, isConnected, fullbleed],
  );

  // Stable dispatch ref — setters never change identity
  const dispatchRef = useRef<ChromeDispatch | null>(null);
  if (!dispatchRef.current) {
    dispatchRef.current = {
      setBreadcrumbs,
      setLine2Left,
      setLine2Right,
      setBottomBar,
      setIsConnected,
      setFullbleed,
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

/** Read chrome state + dispatch (triggers re-render on any state change). */
export function useChrome(): ChromeState & ChromeDispatch {
  const state = useContext(ChromeStateContext);
  const dispatch = useContext(ChromeDispatchContext);
  if (!state || !dispatch) throw new Error("useChrome must be used within ChromeProvider");
  return useMemo(() => ({ ...state, ...dispatch }), [state, dispatch]);
}

/** Read only dispatch (stable — never triggers re-render from state changes). */
export function useChromeDispatch(): ChromeDispatch {
  const dispatch = useContext(ChromeDispatchContext);
  if (!dispatch) throw new Error("useChromeDispatch must be used within ChromeProvider");
  return dispatch;
}

export function ContentSlot({ children }: { children: React.ReactNode }) {
  const { fullbleed } = useChrome();

  useEffect(() => {
    if (fullbleed) {
      document.documentElement.classList.add("fullbleed");
    } else {
      document.documentElement.classList.remove("fullbleed");
    }
    return () => document.documentElement.classList.remove("fullbleed");
  }, [fullbleed]);

  return (
    <main id="main-content" className={`flex-1 min-h-0 overflow-x-hidden ${fullbleed ? "overflow-hidden" : "overflow-y-auto"}`}>
      <div className={`max-w-4xl mx-auto w-full px-6 min-w-0 min-h-full flex flex-col ${fullbleed ? "overflow-hidden" : ""}`}>
        {children}
      </div>
    </main>
  );
}

export function BottomSlot() {
  const { bottomBar } = useChrome();
  return (
    <div className="shrink-0">
      <div className="max-w-4xl mx-auto w-full px-6 pb-1">{bottomBar}</div>
    </div>
  );
}

"use client";

import { createContext, useContext, useState, useMemo } from "react";

export type Breadcrumb = {
  icon?: string;
  label: string;
  href?: string;
};

type ChromeContextType = {
  breadcrumbs: Breadcrumb[];
  setBreadcrumbs: (crumbs: Breadcrumb[]) => void;
  line2Left: React.ReactNode;
  setLine2Left: (node: React.ReactNode) => void;
  line2Right: React.ReactNode;
  setLine2Right: (node: React.ReactNode) => void;
  bottomBar: React.ReactNode;
  setBottomBar: (node: React.ReactNode) => void;
  isConnected: boolean;
  setIsConnected: (connected: boolean) => void;
};

const ChromeContext = createContext<ChromeContextType | null>(null);

export function ChromeProvider({ children }: { children: React.ReactNode }) {
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [line2Left, setLine2Left] = useState<React.ReactNode>(null);
  const [line2Right, setLine2Right] = useState<React.ReactNode>(null);
  const [bottomBar, setBottomBar] = useState<React.ReactNode>(null);
  const [isConnected, setIsConnected] = useState(false);

  const value = useMemo(() => ({
    breadcrumbs, setBreadcrumbs,
    line2Left, setLine2Left,
    line2Right, setLine2Right,
    bottomBar, setBottomBar,
    isConnected, setIsConnected,
  }), [breadcrumbs, line2Left, line2Right, bottomBar, isConnected]);

  return (
    <ChromeContext.Provider value={value}>
      {children}
    </ChromeContext.Provider>
  );
}

export function useChrome() {
  const ctx = useContext(ChromeContext);
  if (!ctx) throw new Error("useChrome must be used within ChromeProvider");
  return ctx;
}

export function BottomSlot() {
  const { bottomBar } = useChrome();
  return (
    <div className="shrink-0">
      <div className="max-w-4xl mx-auto w-full px-6">{bottomBar}</div>
    </div>
  );
}

"use client";

import { createContext, useContext, useState, useEffect, useRef, useMemo } from "react";
import { useChromeDispatch } from "./chrome-context";
import type { ProjectSession } from "@/lib/types";

type SessionContextType = {
  sessions: ProjectSession[];
  isConnected: boolean;
};

const SessionContext = createContext<SessionContextType | null>(null);

type SessionProviderProps = {
  children: React.ReactNode;
  initialSessions?: ProjectSession[];
};

export function SessionProvider({ children, initialSessions = [] }: SessionProviderProps) {
  const [sessions, setSessions] = useState<ProjectSession[]>(initialSessions);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const { setIsConnected: setChromeConnected } = useChromeDispatch();

  useEffect(() => {
    const es = new EventSource("/api/sessions/stream");
    eventSourceRef.current = es;

    es.addEventListener("sessions", (e) => {
      try {
        const data = JSON.parse(e.data) as ProjectSession[];
        setSessions(data);
        setIsConnected(true);
        setChromeConnected(true);
      } catch {
        // Malformed event — skip
      }
    });

    es.onerror = () => {
      setIsConnected(false);
      setChromeConnected(false);
      // EventSource auto-reconnects
    };

    es.onopen = () => {
      setIsConnected(true);
      setChromeConnected(true);
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [setChromeConnected]);

  const value = useMemo(() => ({ sessions, isConnected }), [sessions, isConnected]);

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSessionContext(): SessionContextType {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSessionContext must be used within SessionProvider");
  return ctx;
}

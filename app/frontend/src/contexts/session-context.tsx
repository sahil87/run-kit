import { createContext, useContext, useState, useEffect, useMemo } from "react";
import { useChromeDispatch } from "./chrome-context";
import type { ProjectSession } from "@/types";

type SessionContextType = {
  sessions: ProjectSession[];
  isConnected: boolean;
};

const SessionContext = createContext<SessionContextType | null>(null);

type SessionProviderProps = {
  children: React.ReactNode;
};

export function SessionProvider({ children }: SessionProviderProps) {
  const [sessions, setSessions] = useState<ProjectSession[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const { setIsConnected: setChromeConnected } = useChromeDispatch();

  useEffect(() => {
    const es = new EventSource("/api/sessions/stream");

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
    };

    es.onopen = () => {
      setIsConnected(true);
      setChromeConnected(true);
    };

    return () => {
      es.close();
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

import { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef, startTransition } from "react";
import { useChromeDispatch } from "./chrome-context";
import { setServerGetter } from "@/api/client";
import type { ProjectSession } from "@/types";

const SERVER_STORAGE_KEY = "runkit-server";

type SessionContextType = {
  sessions: ProjectSession[];
  isConnected: boolean;
  server: string;
  servers: string[];
  refreshServers: () => void;
};

const SessionContext = createContext<SessionContextType | null>(null);

type SessionProviderProps = {
  children: React.ReactNode;
  server: string;
};

export function SessionProvider({ children, server }: SessionProviderProps) {
  const [sessions, setSessions] = useState<ProjectSession[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [servers, setServers] = useState<string[]>([]);
  const { setIsConnected: setChromeConnected } = useChromeDispatch();

  // Keep API client in sync with current server
  const serverRef = useRef(server);
  serverRef.current = server;
  useEffect(() => {
    setServerGetter(() => serverRef.current);
  }, []);

  // Persist last-used server to localStorage for convenience
  useEffect(() => {
    try {
      localStorage.setItem(SERVER_STORAGE_KEY, server);
    } catch {
      // localStorage unavailable
    }
  }, [server]);

  const fetchServers = useCallback(async () => {
    try {
      const res = await fetch("/api/servers");
      if (res.ok) {
        const data = await res.json();
        setServers(Array.isArray(data) ? data : []);
      }
    } catch {
      // ignore
    }
  }, []);

  // Fetch server list on mount and when server changes
  useEffect(() => {
    fetchServers();
  }, [fetchServers, server]);

  // SSE connection — reconnects when server changes
  const prevSseDataRef = useRef("");

  useEffect(() => {
    // Reset diff cache so the first event from a new server always applies
    prevSseDataRef.current = "";

    const es = new EventSource(`/api/sessions/stream?server=${encodeURIComponent(server)}`);

    let disconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const markConnected = () => {
      if (disconnectTimer) {
        clearTimeout(disconnectTimer);
        disconnectTimer = null;
      }
      setIsConnected(true);
      setChromeConnected(true);
    };

    const markDisconnected = () => {
      setIsConnected(false);
      setChromeConnected(false);
    };

    es.addEventListener("sessions", (e) => {
      try {
        if (e.data === prevSseDataRef.current) {
          markConnected();
          return;
        }
        prevSseDataRef.current = e.data;
        const data = JSON.parse(e.data) as ProjectSession[];
        // Batch sessions + connected in the same transition so consumers
        // never see isConnected=true with stale/empty sessions.
        startTransition(() => {
          setSessions(data);
          markConnected();
        });
      } catch {
        // Malformed event — skip
      }
    });

    es.onerror = () => {
      if (!disconnectTimer) {
        disconnectTimer = setTimeout(markDisconnected, 3000);
      }
    };

    es.onopen = () => {
      // Don't markConnected() here — wait for the first "sessions" event
      // so consumers see isConnected=true only when session data is available.
      // This prevents redirect races in AppShell.
    };

    return () => {
      if (disconnectTimer) clearTimeout(disconnectTimer);
      es.close();
    };
  }, [setChromeConnected, server]);

  const value = useMemo(
    () => ({ sessions, isConnected, server, servers, refreshServers: fetchServers }),
    [sessions, isConnected, server, servers, fetchServers],
  );

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

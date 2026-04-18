import { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef, startTransition } from "react";
import { useChromeDispatch } from "./chrome-context";
import { listServers, type ServerInfo } from "@/api/client";
import type { MetricsSnapshot, ProjectSession } from "@/types";

const SERVER_STORAGE_KEY = "runkit-server";

type SessionContextType = {
  sessions: ProjectSession[];
  isConnected: boolean;
  server: string;
  servers: ServerInfo[];
  refreshServers: () => void;
};

const SessionContext = createContext<SessionContextType | null>(null);

// Metrics live in a separate context so that the ~2.5s metrics stream does not
// cascade re-renders through the whole app tree — only HostPanel subscribes.
const MetricsContext = createContext<MetricsSnapshot | null>(null);

type SessionProviderProps = {
  children: React.ReactNode;
  server: string;
};

export function SessionProvider({ children, server }: SessionProviderProps) {
  const [sessions, setSessions] = useState<ProjectSession[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const { setIsConnected: setChromeConnected } = useChromeDispatch();

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
      const data = await listServers();
      setServers(Array.isArray(data) ? data : []);
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
    // Reset state so stale data from the previous server never leaks through
    prevSseDataRef.current = "";
    setSessions([]);
    setIsConnected(false);
    setChromeConnected(false);
    setMetrics(null);

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

    es.addEventListener("metrics", (e) => {
      try {
        const data = JSON.parse(e.data) as MetricsSnapshot;
        setMetrics(data);
      } catch {
        // Malformed metrics event — skip
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
      <MetricsContext.Provider value={metrics}>
        {children}
      </MetricsContext.Provider>
    </SessionContext.Provider>
  );
}

export function useSessionContext(): SessionContextType {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSessionContext must be used within SessionProvider");
  return ctx;
}

export function useMetrics(): MetricsSnapshot | null {
  return useContext(MetricsContext);
}

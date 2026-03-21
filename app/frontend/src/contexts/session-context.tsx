import { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useChromeDispatch } from "./chrome-context";
import { setServerGetter } from "@/api/client";
import type { ProjectSession } from "@/types";

const SERVER_STORAGE_KEY = "runkit-server";
const DEFAULT_SERVER = "runkit";

function readStoredServer(): string {
  // Query param override: ?server=name takes precedence and persists to localStorage
  const param = new URLSearchParams(window.location.search).get("server");
  if (param) {
    try { localStorage.setItem(SERVER_STORAGE_KEY, param); } catch { /* */ }
    return param;
  }
  try {
    const stored = localStorage.getItem(SERVER_STORAGE_KEY);
    if (stored) return stored;
    localStorage.setItem(SERVER_STORAGE_KEY, DEFAULT_SERVER);
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_SERVER;
}

type SessionContextType = {
  sessions: ProjectSession[];
  isConnected: boolean;
  server: string;
  setServer: (name: string) => void;
  servers: string[];
  refreshServers: () => void;
};

const SessionContext = createContext<SessionContextType | null>(null);

type SessionProviderProps = {
  children: React.ReactNode;
};

export function SessionProvider({ children }: SessionProviderProps) {
  const [sessions, setSessions] = useState<ProjectSession[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [server, setServerState] = useState(readStoredServer);
  const [servers, setServers] = useState<string[]>([]);
  const { setIsConnected: setChromeConnected } = useChromeDispatch();

  // Keep API client in sync with current server
  const serverRef = useRef(server);
  serverRef.current = server;
  useEffect(() => {
    setServerGetter(() => serverRef.current);
  }, []);

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

  const setServer = useCallback((name: string) => {
    setServerState(name);
    try {
      localStorage.setItem(SERVER_STORAGE_KEY, name);
    } catch {
      // localStorage unavailable
    }
  }, []);

  // SSE connection — reconnects when server changes
  useEffect(() => {
    const es = new EventSource(`/api/sessions/stream?server=${encodeURIComponent(server)}`);

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
  }, [setChromeConnected, server]);

  const value = useMemo(
    () => ({ sessions, isConnected, server, setServer, servers, refreshServers: fetchServers }),
    [sessions, isConnected, server, setServer, servers, fetchServers],
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

"use client";

import { useState, useEffect, useRef } from "react";
import type { ProjectSession } from "@/lib/types";

type UseSessionsReturn = {
  sessions: ProjectSession[];
  isConnected: boolean;
};

export function useSessions(
  initialSessions: ProjectSession[] = [],
): UseSessionsReturn {
  const [sessions, setSessions] = useState<ProjectSession[]>(initialSessions);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/sessions/stream");
    eventSourceRef.current = es;

    es.addEventListener("sessions", (e) => {
      try {
        const data = JSON.parse(e.data) as ProjectSession[];
        setSessions(data);
        setIsConnected(true);
      } catch {
        // Malformed event — skip
      }
    });

    es.onerror = () => {
      setIsConnected(false);
      // EventSource auto-reconnects
    };

    es.onopen = () => {
      setIsConnected(true);
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, []);

  return { sessions, isConnected };
}

import { useSessionContext } from "@/contexts/session-context";
import type { ProjectSession } from "@/types";

type UseSessionsReturn = {
  sessions: ProjectSession[];
  isConnected: boolean;
};

/** Convenience hook returning the current server's session slice. Outside of
 *  an AppShell route (where `currentServer` is null), returns an empty list
 *  with `isConnected: false`. */
export function useSessions(): UseSessionsReturn {
  const { currentServer, sessionsByServer, isConnectedByServer } = useSessionContext();
  if (!currentServer) {
    return { sessions: [], isConnected: false };
  }
  return {
    sessions: sessionsByServer.get(currentServer) ?? [],
    isConnected: isConnectedByServer.get(currentServer) ?? false,
  };
}

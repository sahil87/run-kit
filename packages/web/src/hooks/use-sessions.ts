import { useSessionContext } from "@/contexts/session-context";
import type { ProjectSession } from "@/types";

type UseSessionsReturn = {
  sessions: ProjectSession[];
  isConnected: boolean;
};

export function useSessions(): UseSessionsReturn {
  return useSessionContext();
}

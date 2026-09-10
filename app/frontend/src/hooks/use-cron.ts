import { useEffect, useState } from "react";
import { getCron, type CronListResponse } from "@/api/client";
import { useSessionContext } from "@/contexts/session-context";

const EMPTY_CRON: CronListResponse = { entries: [], deliveries: [] };

/**
 * Fetch GET /api/cron for `server` and keep it fresh on the existing sessions
 * refresh cadence: the initial fetch fires on mount, then every state-socket
 * `sessions` event for this server (the slice's array identity changes per
 * event) triggers a refetch — the same signal every SSE-driven surface rides.
 * Cron mutations wake the SSE hub server-side, so a mutation's confirmation
 * lands here on the next tick. No timers, no polling loop (Constitution:
 * client never polls; the socket's cadence is the refresh).
 *
 * An empty `server` fires NO request and yields the empty shape (the
 * degrade-to-absent posture). Failures keep the last good data. The cached
 * data is keyed to the server that produced it: a server switch yields the
 * empty shape until the new server's first fetch resolves — never the
 * previous server's entries beside the new server's name.
 */
export function useCronData(server: string): CronListResponse {
  const { sessionsByServer } = useSessionContext();
  const sessions = sessionsByServer.get(server);
  const [state, setState] = useState<{ server: string; data: CronListResponse }>({
    server: "",
    data: EMPTY_CRON,
  });

  useEffect(() => {
    if (!server) return;
    let cancelled = false;
    getCron(server)
      .then((r) => {
        if (!cancelled) setState({ server, data: r });
      })
      .catch(() => {
        // Fail-silent: a transient error keeps the last good data; the next
        // sessions tick retries.
      });
    return () => {
      cancelled = true;
    };
  }, [server, sessions]);

  return server && state.server === server ? state.data : EMPTY_CRON;
}

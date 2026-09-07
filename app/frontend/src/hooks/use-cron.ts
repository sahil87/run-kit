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
 * degrade-to-absent posture). Failures keep the last good data.
 */
export function useCronData(server: string): CronListResponse {
  const { sessionsByServer } = useSessionContext();
  const sessions = sessionsByServer.get(server);
  const [data, setData] = useState<CronListResponse>(EMPTY_CRON);

  useEffect(() => {
    if (!server) return;
    let cancelled = false;
    getCron(server)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch(() => {
        // Fail-silent: a transient error keeps the last good data; the next
        // sessions tick retries.
      });
    return () => {
      cancelled = true;
    };
  }, [server, sessions]);

  return server ? data : EMPTY_CRON;
}

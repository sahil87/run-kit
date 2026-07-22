import { useEffect, useState } from "react";
import { getHealth, getOpenApps, type OpenApp } from "@/api/client";

/**
 * The Open button's bootstrap data: the host's optional SSH alias
 * (RK_SSH_HOST) plus the derived daemon username (both riding GET
 * /api/health) and the wt host-app registry (GET /api/open-apps). All are
 * effectively static per page load, so they are fetched ONCE per page load
 * through a module-level cache and shared by every consumer (the TopBar
 * registry entry AND the palette builder in app.tsx) — no client polling
 * (state changes arrive by reload, matching the registry's change cadence),
 * no TopBar prop churn.
 */
export type OpenContext = {
  sshHost: string;
  /** The daemon's username (server-derived) — composes the fallback deeplink
   *  host `${sshUser}@${location.hostname}` when sshHost is unset. */
  sshUser: string;
  hostApps: OpenApp[];
};

const EMPTY: OpenContext = { sshHost: "", sshUser: "", hostApps: [] };

/** Module-level cache: resolved context after the first successful fetch. */
let cached: OpenContext | null = null;
/** In-flight fetch, shared by concurrent first consumers. */
let pending: Promise<OpenContext> | null = null;

function fetchOpenContext(): Promise<OpenContext> {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = Promise.all([
      // Both halves are individually fail-silent: a failing health read means
      // "no sshHost" (deeplinks hidden), never a thrown error — the Open
      // control degrades to whatever sections still have data.
      getHealth().catch(() => ({ status: "", hostname: "", sshHost: "", sshUser: "" })),
      getOpenApps(), // fail-silent [] internally
    ])
      .then(([health, hostApps]) => {
        cached = { sshHost: health.sshHost ?? "", sshUser: health.sshUser ?? "", hostApps };
        return cached;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

/** Test-only: drop the module cache so each test starts cold. */
export function resetOpenTargetsCacheForTest(): void {
  cached = null;
  pending = null;
}

/**
 * Subscribe to the open-context data. `enabled` gates the fetch (pass false
 * on routes that never show the control) — data still returns when another
 * consumer already populated the cache.
 */
export function useOpenTargets(enabled: boolean): OpenContext {
  const [ctx, setCtx] = useState<OpenContext>(cached ?? EMPTY);

  useEffect(() => {
    if (!enabled || cached) return;
    let alive = true;
    fetchOpenContext().then((data) => {
      if (alive) setCtx(data);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);

  return cached ?? ctx;
}

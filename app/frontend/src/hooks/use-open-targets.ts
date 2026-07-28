import { useEffect, useSyncExternalStore } from "react";
import { getHealth, getOpenApps, type OpenApp } from "@/api/client";

/**
 * The Open button's bootstrap data: the host's optional SSH alias
 * (settings-first, else RK_SSH_HOST) plus the derived daemon username (both
 * riding GET /api/health) and the wt host-app registry (GET /api/open-apps).
 * The bundle is fetched ONCE and held in a small module-level external store
 * shared by every consumer (the TopBar registry entry AND the palette builder
 * in app.tsx) — no client polling, no per-render refetching, no TopBar prop
 * churn. The context is static BETWEEN settings commits: the ONE runtime seam
 * where it changes is the Settings dialog's successful SSH-host commit, which
 * calls `invalidateOpenContext()` to refresh it (mounted consumers re-render
 * with the fresh data — no reload needed).
 */
export type OpenContext = {
  sshHost: string;
  /** The daemon's username (server-derived) — composes the fallback deeplink
   *  host `${sshUser}@${location.hostname}` when sshHost is unset. */
  sshUser: string;
  hostApps: OpenApp[];
};

const EMPTY: OpenContext = { sshHost: "", sshUser: "", hostApps: [] };

/** Resolved context after the last successful fetch (null ⇒ needs a fetch). */
let cached: OpenContext | null = null;
/** In-flight fetch, shared by concurrent consumers. */
let pending: Promise<OpenContext> | null = null;
/** Bumped on invalidation — a fetch started before the bump resolves stale
 *  and must not write the cache (the rapid-double-commit race). */
let epoch = 0;
/** Mounted-consumer notifiers (useSyncExternalStore subscriptions). */
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): OpenContext {
  return cached ?? EMPTY;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function fetchOpenContext(): Promise<OpenContext> {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    const fetchedAt = epoch;
    pending = Promise.all([
      // Both halves are individually fail-silent: a failing health read means
      // "no sshHost" (deeplinks hidden), never a thrown error — the Open
      // control degrades to whatever sections still have data.
      getHealth().catch(() => ({ status: "", hostname: "", sshHost: "", sshUser: "" })),
      getOpenApps(), // fail-silent [] internally
    ])
      .then(([health, hostApps]) => {
        const ctx: OpenContext = {
          sshHost: health.sshHost ?? "",
          sshUser: health.sshUser ?? "",
          hostApps,
        };
        // Discard a result fetched before an invalidation — it predates the
        // settings commit that invalidated it, so caching it would resurrect
        // exactly the stale value the invalidation dropped.
        if (epoch === fetchedAt) {
          cached = ctx;
          notify();
        }
        return cached ?? ctx;
      })
      .finally(() => {
        if (epoch === fetchedAt) pending = null;
      });
  }
  return pending;
}

/**
 * Drop the cached open context and refresh it. Called at the ONE seam where
 * the data changes at runtime — the Settings dialog's successful SSH-host
 * commit. With mounted consumers the bundle is eagerly refetched and pushed
 * to them when it resolves; with none, the stale cache is simply dropped so
 * the next `useOpenTargets(true)` mount fetches fresh.
 */
export function invalidateOpenContext(): void {
  epoch += 1;
  cached = null;
  pending = null;
  if (listeners.size > 0) void fetchOpenContext();
}

/** Test-only: drop the module store so each test starts cold. */
export function resetOpenTargetsCacheForTest(): void {
  epoch += 1;
  cached = null;
  pending = null;
}

/**
 * Subscribe to the open-context data. `enabled` gates the fetch (pass false
 * on routes that never show the control) — data still returns when another
 * consumer already populated the cache.
 */
export function useOpenTargets(enabled: boolean): OpenContext {
  const ctx = useSyncExternalStore(subscribe, getSnapshot);

  useEffect(() => {
    if (!enabled || cached) return;
    void fetchOpenContext();
  }, [enabled]);

  return ctx;
}

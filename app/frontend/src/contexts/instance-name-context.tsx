import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useToast } from "@/components/toast";
import { getHealth, setInstanceName as setInstanceNameApi } from "@/api/client";

/**
 * Instance display name (260723-o7q8) — root-mounted provider owning the
 * health-fetched `{hostname, instanceName}` pair and the optimistic
 * `setInstanceName` write seam. Display surfaces (browser tab title, HOST
 * panel hostname line, host-overview hostname line) consume `displayName`
 * from this single instance, so a settings-dialog edit repaints all of them
 * without a reload. Mirrors `InstanceAccentProvider` (fetch once, optimistic
 * set, toast on write failure).
 *
 * Deliberately NOT consumed by the accent-hash fallback (`instance-accent.ts`)
 * or the SSH deeplink derivation (`open-in-app.ts`) — those key on the REAL
 * hostname: renaming the instance must not change its color, and deeplinks
 * need the reachable name, not a vanity label.
 */
export type InstanceName = {
  /** The real hostname reported by GET /api/health (empty until fetched). */
  hostname: string;
  /** The explicit display-name override, or null when unset. */
  instanceName: string | null;
  /** What display surfaces should render: the override when set, else the
   *  real hostname. */
  displayName: string;
  /** Set (non-empty string) or clear (null) the display-name override.
   *  Optimistic; POSTs to the instance host, toasting on failure. */
  setInstanceName: (name: string | null) => void;
};

const InstanceNameContext = createContext<InstanceName | null>(null);

export function InstanceNameProvider({ children }: { children: React.ReactNode }) {
  const { addToast } = useToast();
  const [hostname, setHostname] = useState("");
  const [instanceName, setInstanceNameState] = useState<string | null>(null);

  // Fetch once on mount (guarded for StrictMode double-invoke, matching the
  // InstanceAccentProvider pattern). deduplicatedFetch coalesces this with any
  // other same-tick /api/health consumer.
  const didFetchRef = useRef(false);
  useEffect(() => {
    if (didFetchRef.current) return;
    didFetchRef.current = true;
    getHealth()
      .then((data) => {
        setHostname(data.hostname ?? "");
        setInstanceNameState(data.instanceName ?? null);
      })
      .catch(() => {});
  }, []);

  const setInstanceName = useCallback(
    (name: string | null) => {
      setInstanceNameState(name);
      setInstanceNameApi(name).catch((err: unknown) => {
        addToast(err instanceof Error && err.message ? err.message : "Failed to save instance name");
      });
    },
    [addToast],
  );

  const value = useMemo<InstanceName>(
    () => ({
      hostname,
      instanceName,
      displayName: instanceName ?? hostname,
      setInstanceName,
    }),
    [hostname, instanceName, setInstanceName],
  );

  return <InstanceNameContext.Provider value={value}>{children}</InstanceNameContext.Provider>;
}

/** Test seam: inject a fixed value without the fetching provider. Mirrors
 *  `InstanceAccentValueProvider`. */
export function InstanceNameValueProvider({
  value,
  children,
}: {
  value: InstanceName;
  children: React.ReactNode;
}) {
  return <InstanceNameContext.Provider value={value}>{children}</InstanceNameContext.Provider>;
}

export function useInstanceName(): InstanceName {
  const ctx = useContext(InstanceNameContext);
  if (!ctx) throw new Error("useInstanceName must be used within InstanceNameProvider");
  return ctx;
}

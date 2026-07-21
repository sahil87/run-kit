import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTheme } from "@/contexts/theme-context";
import { useToast } from "@/components/toast";
import { getInstanceColor, setInstanceColor as setInstanceColorApi, getHealth } from "@/api/client";
import {
  hashHostnameColor,
  readInstanceColorEcho,
  writeInstanceColorEcho,
  deriveAccentHexes,
  setAccentThemeColor,
} from "@/instance-accent";

/**
 * Instance accent ("host color") — root-mounted provider owning the accent
 * resolution chain (explicit `instance_color` setting → localStorage echo as a
 * pre-fetch paint seed → hostname hash), the localStorage echo, and the PWA
 * theme-color meta bridge. Both rendering surfaces (the top-bar stripe/wash in
 * AppLayout and the HOST panel hostname/picker) consume `useInstanceAccent()`
 * from this single instance — one fetch, one state, and a pick in the HOST
 * panel repaints the top bar without a reload.
 */
export type InstanceAccent = {
  /** Resolved accent descriptor ("4" / "1+3"), or null when no accent applies
   *  (hostname unknown and nothing explicit/echoed). */
  color: string | null;
  /** True when an explicit instance color is set (vs the hash default). */
  isExplicit: boolean;
  /** Contrast-guarded accent hex — top-bar stripe, HOST hostname tint, and
   *  the theme-color meta content. Null when no accent is resolved. */
  stripeHex: string | null;
  /** Subtle accent-into-background blend for the top-bar wash. */
  washHex: string | null;
  /** Set (descriptor) or clear (null → hash default) the instance color.
   *  Optimistic; POSTs to the instance host, toasting on failure. */
  setColor: (color: string | null) => void;
};

const InstanceAccentContext = createContext<InstanceAccent | null>(null);

export function InstanceAccentProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const { addToast } = useToast();

  // undefined = fetch pending; null = fetched, no explicit color set.
  const [explicit, setExplicit] = useState<string | null | undefined>(undefined);
  // null = fetch pending; "" = fetched but unknown (health failed / empty).
  const [hostname, setHostname] = useState<string | null>(null);
  // Pre-fetch paint seed from the last load's echo (paint cache only — the
  // authoritative resolution below overwrites it as soon as fetches land).
  const [echoSeed] = useState<string | null>(() => readInstanceColorEcho()?.value ?? null);

  // Fetch the explicit setting + hostname once on mount (guarded for
  // StrictMode double-invoke, matching the AppShell getHealth pattern).
  const didFetchRef = useRef(false);
  useEffect(() => {
    if (didFetchRef.current) return;
    didFetchRef.current = true;
    getInstanceColor()
      .then((color) => setExplicit(color))
      .catch(() => setExplicit(null));
    getHealth()
      .then((data) => setHostname(data.hostname ?? ""))
      .catch(() => setHostname(""));
  }, []);

  // Resolution chain: explicit setting → (while pending) echo seed → hostname
  // hash. `authoritative` marks the point where the chain no longer depends on
  // the paint seed — only then may the echo/meta be cleared on a null accent.
  const resolved =
    typeof explicit === "string"
      ? explicit
      : explicit === null && hostname !== null
        ? hashHostnameColor(hostname)
        : echoSeed;
  const authoritative = typeof explicit === "string" || (explicit === null && hostname !== null);

  const hexes = useMemo(
    () => (resolved != null ? deriveAccentHexes(resolved, theme) : null),
    [resolved, theme],
  );

  // Bridge: keep the theme-color meta and the localStorage echo in sync with
  // the resolved accent under the active theme.
  useEffect(() => {
    if (resolved != null && hexes != null) {
      setAccentThemeColor(hexes.stripeHex);
      writeInstanceColorEcho({ value: resolved, hex: hexes.stripeHex });
    } else if (authoritative) {
      setAccentThemeColor(null);
      writeInstanceColorEcho(null);
    }
  }, [resolved, hexes, authoritative]);

  // Clear the accent meta on unmount so a torn-down provider (tests) doesn't
  // leak module state into the next mount.
  useEffect(() => () => setAccentThemeColor(null), []);

  const setColor = useCallback(
    (color: string | null) => {
      setExplicit(color);
      setInstanceColorApi(color).catch((err: unknown) => {
        addToast(err instanceof Error && err.message ? err.message : "Failed to save instance color");
      });
    },
    [addToast],
  );

  const value = useMemo<InstanceAccent>(
    () => ({
      color: resolved,
      isExplicit: typeof explicit === "string",
      stripeHex: hexes?.stripeHex ?? null,
      washHex: hexes?.washHex ?? null,
      setColor,
    }),
    [resolved, explicit, hexes, setColor],
  );

  return <InstanceAccentContext.Provider value={value}>{children}</InstanceAccentContext.Provider>;
}

/** Test seam: inject a fixed accent value without the fetching provider.
 *  Mirrors the session-context `MetricsProvider` value-injection pattern. */
export function InstanceAccentValueProvider({
  value,
  children,
}: {
  value: InstanceAccent;
  children: React.ReactNode;
}) {
  return <InstanceAccentContext.Provider value={value}>{children}</InstanceAccentContext.Provider>;
}

export function useInstanceAccent(): InstanceAccent {
  const ctx = useContext(InstanceAccentContext);
  if (!ctx) throw new Error("useInstanceAccent must be used within InstanceAccentProvider");
  return ctx;
}

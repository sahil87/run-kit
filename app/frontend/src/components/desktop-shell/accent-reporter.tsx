import { useEffect, useRef } from "react";
import { useInstanceAccent } from "@/contexts/instance-accent-context";
import { setShellAccent } from "@/lib/shell";

/**
 * Desktop-shell raw-accent reporter (260814-d4wu): mirrors the instance's
 * full-strength accent to the shell over the `accent.set` bridge, where it is
 * persisted per host for the host-switcher's edge bars. Renders nothing;
 * callers gate the mount on `isShell()` (no-op in browsers).
 *
 * Reports `stripeHex` — the contrast-guarded hex the top-bar stripe and HOST
 * hostname tint already use — NOT `titlebarHex`: the theme-color meta the
 * shell also observes carries only a 35% background blend, which is exactly
 * the muted-edge-bar defect this reporter fixes. The shell demotes its
 * theme-color capture to an older-SPA fallback once this report arrives.
 *
 * Reports on initial resolve and on CHANGE only (ref-guarded, the badge
 * reporter's shape). A null `stripeHex` (no accent set / unresolved) reports
 * nothing — the shell has no unset path, so the stored value simply persists
 * until the accent next resolves. `setShellAccent` never throws — an older
 * shell without the accent group resolves false.
 */
export function ShellAccentReporter() {
  const { stripeHex } = useInstanceAccent();
  const lastReportedRef = useRef<string | null>(null);

  useEffect(() => {
    if (stripeHex === null) return;
    if (lastReportedRef.current === stripeHex) return;
    lastReportedRef.current = stripeHex;
    void setShellAccent(stripeHex);
  }, [stripeHex]);

  return null;
}

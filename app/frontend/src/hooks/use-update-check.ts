import { useCallback, useRef, useState } from "react";
import { useUpdateNotification } from "@/contexts/session-context";
import { useToast } from "@/components/toast";
import { checkForUpdates } from "@/api/client";
import { composeCheckToast } from "@/lib/palette-update";

/** Sentinel running version for local (non-ldflags) builds — the toast's
 *  "Update Now" action slot is suppressed for it (mirrors the palette entry's
 *  gate in buildMaintenanceActions). Kept local, same pattern as
 *  lib/palette-update.ts. */
const DEV_VERSION = "dev";

/**
 * Shared behavior for the two palette check commands (`run-kit: Check for
 * Updates` / `… (incl. patches)`), consumed by BOTH palette mounts — AppShell
 * (app.tsx) and the board route (board-page.tsx, which mounts its own palette
 * and does not render AppShell). Extracted so the POST→toast flow (result
 * composition, Update Now action gating, error mapping) can NEVER drift between
 * the two — the same anti-drift extraction as use-update-click.ts.
 *
 * Flow: POST /api/updates/check (synchronous ~1-2s — deliberately NO
 * intermediate "checking…" toast), then ONE result toast:
 *   - info toast with the per-tool summary (composeCheckToast; the
 *     includePatches flag selects notable-only vs. all-pending filtering);
 *   - when something updatable was reported AND the daemon can actually update
 *     (brew install, non-dev — the same gate as the palette's `run-kit: Update
 *     Now` entry), the toast's action slot carries "Update Now", triggering the
 *     same force-update flow;
 *   - on a failed check (502 shll-missing, 409 dev, network) an error toast
 *     surfaces the server's message — a deliberate invocation deserves an
 *     honest answer, unlike the fail-silent ambient loop.
 *
 * In-flight state (260720-ml7k): `checking` is true while a check request is
 * pending — the overflow menu's ⟳ affordance renders its spinner/disabled form
 * off it. Repeat `runUpdateCheck` calls while in flight are no-ops
 * (single-flight). The synchronous guard is a ref — NOT the state value — so a
 * same-tick double-click can't slip past the not-yet-flushed state, and
 * `runUpdateCheck` keeps a stable identity across the in-flight transition
 * (board-page.tsx memoizes a large palette-action array on it).
 */
export function useUpdateCheck(): {
  runUpdateCheck: (includePatches: boolean) => void;
  checking: boolean;
} {
  const { brew, daemonVersion, forceUpdateNow } = useUpdateNotification();
  const { addToast } = useToast();
  const [checking, setChecking] = useState(false);
  const checkingRef = useRef(false);

  const runUpdateCheck = useCallback(
    (includePatches: boolean) => {
      if (checkingRef.current) return;
      checkingRef.current = true;
      setChecking(true);
      void checkForUpdates()
        .then((result) => {
          const { message, updatable } = composeCheckToast(result.tools, includePatches);
          const canUpdate = brew && daemonVersion !== DEV_VERSION;
          const action =
            updatable && canUpdate
              ? {
                  label: "Update Now",
                  onSelect: () => {
                    void forceUpdateNow().catch((err: unknown) =>
                      addToast(err instanceof Error ? err.message : "Update failed", "error"),
                    );
                  },
                }
              : undefined;
          addToast(message, "info", action);
        })
        .catch((err: unknown) => {
          addToast(err instanceof Error ? err.message : "Update check failed", "error");
        })
        .finally(() => {
          checkingRef.current = false;
          setChecking(false);
        });
    },
    [brew, daemonVersion, forceUpdateNow, addToast],
  );

  return { runUpdateCheck, checking };
}

/**
 * The desktop shell's registered rk servers, for the palette's shell-gated
 * `Server: Switch to "<name>"` entries (lib/palette-shell.ts). Fetched once
 * per mount via the `runkitShell` bridge; resolves to `[]` in a plain browser
 * (bridge absent) or on an older shell, so consumers need no `isShell()`
 * pre-check. A mount-time snapshot suffices: list mutations flow through the
 * shell's own menu/welcome flows, and switching/adding loads the target
 * server's URL — a full page swap that remounts the SPA.
 */
import { useEffect, useState } from "react";
import { listShellServers, type ShellServer } from "@/lib/shell";

export function useShellServers(): ShellServer[] {
  const [servers, setServers] = useState<ShellServer[]>([]);
  useEffect(() => {
    let cancelled = false;
    void listShellServers().then((list) => {
      if (!cancelled && list) setServers(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return servers;
}

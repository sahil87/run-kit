import { useEffect, useLayoutEffect, useState } from "react";
import { useInstanceAccent } from "@/contexts/instance-accent-context";
import { useTheme } from "@/contexts/theme-context";
import { listShellServers, shellInfo } from "@/lib/shell";
import {
  activeShellHostName,
  SHELL_STRIP_HEIGHT_PX,
  SHELL_STRIP_MARKER_CLASS,
  stripInsets,
  stripLabelColor,
} from "@/lib/shell-strip";

/**
 * Desktop-shell titlebar strip (260731-ofws): a 28px full-width draggable
 * band above the top bar, rendered ONLY inside the Electron viewer shell
 * (callers gate the mount on `isShell()`). The shell hides the native
 * titlebar (`hiddenInset` / `hidden`+overlay), so this strip IS the visible
 * titlebar: macOS traffic lights and the Windows/Linux window controls
 * composite over its ends (hence the platform insets on the label).
 *
 * Background = the instance accent blended at `INSTANCE_TITLEBAR_RATIO`
 * (`titlebarHex` — identical color math to the installed-PWA titlebar tint),
 * falling back to the plain theme background when no accent is set. The whole
 * band is a drag region (`.rk-shell-drag`) and deliberately carries NO
 * interactive elements, so no `no-drag` bookkeeping exists.
 *
 * While mounted, `<html>` carries the `rk-shell-strip` marker class — the
 * shell's version-skew fallback CSS (`html:not(.rk-shell-strip)` selectors,
 * injected for older SPAs) keys off it and no-ops here.
 *
 * The centered label names the window's host: the shell-registered active
 * host's display name via the existing `servers.list()` bridge call, falling
 * back to `location.hostname` (older shell, denial, no active entry).
 */
export function ShellTitlebarStrip() {
  const { titlebarHex } = useInstanceAccent();
  const { theme } = useTheme();
  const [hostName, setHostName] = useState<string | null>(null);

  // Mark <html> so the shell's injected fallback strip disables itself.
  useLayoutEffect(() => {
    document.documentElement.classList.add(SHELL_STRIP_MARKER_CLASS);
    return () => document.documentElement.classList.remove(SHELL_STRIP_MARKER_CLASS);
  }, []);

  // One list call on mount — host identity only changes via a full page swap
  // (switching hosts loads the new host's URL), so no subscription is needed.
  useEffect(() => {
    let cancelled = false;
    void listShellServers().then((servers) => {
      if (!cancelled) setHostName(activeShellHostName(servers));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const bg = titlebarHex ?? theme.palette.background;
  const insets = stripInsets(shellInfo()?.platform ?? "");

  return (
    <div
      data-testid="shell-titlebar-strip"
      className="rk-shell-drag shrink-0 flex items-center justify-center select-none"
      style={{
        height: `${SHELL_STRIP_HEIGHT_PX}px`,
        backgroundColor: bg,
        color: stripLabelColor(bg),
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
    >
      <span className="min-w-0 truncate text-xs">{hostName ?? window.location.hostname}</span>
    </div>
  );
}

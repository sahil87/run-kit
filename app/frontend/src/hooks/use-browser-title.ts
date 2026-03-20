import { useEffect } from "react";

/**
 * Sets document.title based on route params and hostname.
 *
 * Dashboard: "RunKit — {hostname}" or "RunKit" if hostname is empty.
 * Terminal:  "{session}/{window} — {hostname}" or "{session}/{window}" if empty.
 */
export function useBrowserTitle(
  sessionName: string | undefined,
  windowIndex: string | undefined,
  hostname: string,
): void {
  useEffect(() => {
    const suffix = hostname ? ` \u2014 ${hostname}` : "";
    if (sessionName && windowIndex) {
      document.title = `${sessionName}/${windowIndex}${suffix}`;
    } else {
      document.title = `RunKit${suffix}`;
    }
  }, [sessionName, windowIndex, hostname]);
}

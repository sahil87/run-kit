/**
 * Native-notification pure logic: same-origin navigation target validation and
 * the host-aware title shown for background hosts.
 *
 * Deliberately electron-free (the `views.ts` / `badge.ts` pattern) so the
 * sibling `notify.test.ts` runs under plain `node --test`. The impure glue —
 * Electron Notification construction, window focus, host switching, and
 * WebContentsView navigation — lives in `main.ts`.
 */

/**
 * Join a notification deep-link to a host origin only when it is a same-origin
 * relative path: it must start with `/` but not `//` (protocol-relative URL).
 */
export function notifyNavigationTarget(hostUrl: string, path: string): string | null {
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  return hostUrl + path;
}

export type NotifyClickOrigin =
  | { kind: "store"; url: string | null }
  | { kind: "dev"; origin: string | null };

/** Resolve a click target from host state re-read when the click occurs. */
export function notifyClickNavigationTarget(
  current: NotifyClickOrigin,
  path: string,
): string | null {
  const origin = current.kind === "store" ? current.url : current.origin;
  return origin === null ? null : notifyNavigationTarget(origin, path);
}

/** Prefix notifications reported by a background host with its display name. */
export function notificationTitle(
  rawTitle: string,
  hostName: string,
  isActiveHost: boolean,
): string {
  return isActiveHost ? rawTitle : `[${hostName}] ${rawTitle}`;
}

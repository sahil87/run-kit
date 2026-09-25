/**
 * Web-tile guest proxy pure logic — per-host guest partition naming and the
 * `direct`/`proxy`/`legacy` mode derivation with its `session.setProxy`
 * config mapping.
 *
 * Deliberately electron-free (the `web-views.ts` precedent): the impure
 * parts — `session.fromPartition`, the capability probe (health `tunnel`
 * field gate + a WebSocket round-trip through `/ws/tunnel`), the per-host
 * loopback proxy listener (`tunnel-proxy.ts`), and the awaited
 * `session.setProxy` apply — live in `main.ts`; the sibling
 * `web-proxy.test.ts` covers every derivation arm under plain `node --test`.
 *
 * Modes:
 * - `direct` — the host IS this machine's daemon: no proxy, the native
 *   engine loads literal URLs (`http://localhost:6000/…`).
 * - `proxy`  — a remote host whose capability probe passed: the host's guest
 *   session points at the host's loopback proxy listener in this process,
 *   whose connections ride a WebSocket tunnel to the host's rk server, so
 *   every guest URL resolves on the rk host.
 * - `legacy` — a remote host whose probe failed (an older rk server, or a
 *   front end that refuses the tunnel upgrade): the `/proxy/{port}` path.
 */

export type WebProxyMode = "direct" | "proxy" | "legacy";

/** The per-host guest partition: keyed on the hosts.json id (a randomUUID,
 *  stable across setHostUrl/SSH heal), so two hosts serving the same
 *  loopback port never share a cookie/localStorage jar. */
export function guestPartitionName(hostId: string): string {
  return `persist:rk-web:${hostId}`;
}

/** Local mirror of main.ts's `isLoopbackOrigin` (it is not exported, and
 *  this module must stay electron-free — duplicating the three-line check
 *  is the accepted cost). */
function isLoopbackOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "localhost" || hostname.startsWith("127.") || hostname === "[::1]";
  } catch {
    return false;
  }
}

/**
 * The mode derivation. The ordering MUST mirror `interstitialKindFor` in
 * main.ts: a non-empty `remote` field marks the host REMOTE FIRST — an SSH
 * host's origin IS loopback (`http://127.0.0.1:<L>`, the tunnel's local
 * end), so any loopback test ahead of the remote check would misclassify
 * it `direct`. Only then does an exact `localDaemonOrigin()` match — or,
 * when the local origin is unavailable off Windows, a loopback origin —
 * classify local.
 */
export function webProxyModeFor(
  host: { url: string; remote?: string },
  localOrigin: string | null,
  probeOk: boolean,
  platform: string = process.platform,
): WebProxyMode {
  if (host.remote !== undefined && host.remote !== "") {
    return probeOk ? "proxy" : "legacy";
  }
  if (localOrigin !== null && host.url === localOrigin) return "direct";
  if (localOrigin === null && platform !== "win32" && isLoopbackOrigin(host.url)) return "direct";
  return probeOk ? "proxy" : "legacy";
}

/**
 * The `proxyRules` target for a host in `proxy` mode: the host's loopback
 * proxy listener in this main process (`createLocalProxy` in
 * `tunnel-proxy.ts`). Every guest connection terminates there and rides a
 * WebSocket tunnel to the host's rk server, so the host origin needs no
 * say in the rules — an `https:` origin included (`wss://` traverses the
 * TLS front end).
 */
export function proxyRulesFor(localPort: number): string {
  return `http://127.0.0.1:${localPort}`;
}

/** The argument for the guest session's `setProxy`. `fixed_servers` carries
 *  `proxyBypassRules: "<-loopback>"` — Chromium's implicit loopback bypass
 *  removed, so `localhost:*` guest URLs are proxied too (the whole point of
 *  the mode: loopback must resolve on the rk host). Anything but a proxy
 *  mode WITH rules is a plain direct session. */
export function setProxyConfigFor(
  mode: WebProxyMode,
  rules: string | null,
): { mode: "fixed_servers"; proxyRules: string; proxyBypassRules: string } | { mode: "direct" } {
  if (mode === "proxy" && rules !== null) {
    return { mode: "fixed_servers", proxyRules: rules, proxyBypassRules: "<-loopback>" };
  }
  return { mode: "direct" };
}

/**
 * Web-tile guest proxy pure logic — per-host guest partition naming and the
 * `direct`/`proxy`/`legacy` mode derivation with its `session.setProxy`
 * config mapping.
 *
 * Deliberately electron-free (the `web-views.ts` precedent): the impure
 * parts — `session.fromPartition`, the capability probe (`net.fetch` health
 * gate + raw-TCP CONNECT), and the awaited `session.setProxy` apply — live
 * in `main.ts`; the sibling `web-proxy.test.ts` covers every derivation arm
 * under plain `node --test`.
 *
 * Modes:
 * - `direct` — the host IS this machine's daemon: no proxy, the native
 *   engine loads literal URLs (`http://localhost:6000/…`).
 * - `proxy`  — a remote host whose capability probe passed: the host's guest
 *   session rides that host's rk forward proxy, so every guest URL resolves
 *   on the rk host.
 * - `legacy` — a remote host whose probe failed (an older rk server, or a
 *   TLS front end that drops CONNECT): today's `/proxy/{port}` behavior.
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
 * A MagicDNS name (`*.ts.net`) or an address in Tailscale's CGNAT range
 * `100.64.0.0/10` — the hosts whose traffic rides an encrypted tailnet hop.
 */
export function isTailnetHostname(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/\.$/, "");
  if (name.endsWith(".ts.net")) return true;
  const octets = name.split(".");
  if (octets.length !== 4 || !octets.every((o) => /^\d{1,3}$/.test(o))) return false;
  const [a, b] = octets.map(Number);
  return a === 100 && b >= 64 && b <= 127 && octets.every((o) => Number(o) <= 255);
}

/**
 * The `proxyRules` target for a host in `proxy` mode, or null when no proxy
 * target exists (the caller derives `legacy` instead):
 * - `http:` origin (incl. an SSH host's viewer-side tunnel origin, which the
 *   existing `-L` forward carries to the remote rk port) ⇒ the origin's own
 *   host:port.
 * - `https:` origin ON A TAILNET (a TLS front end such as Tailscale Serve
 *   drops CONNECT) ⇒ the rk server's RAW listen port, advertised on
 *   `/api/health`, over plain http. Only a tailnet makes that hop safe — it is
 *   WireGuard-encrypted — so any other `https:` origin has no target: dropping
 *   its TLS to plaintext across an arbitrary network is never acceptable.
 */
export function proxyRulesFor(hostUrl: string, advertisedPort: number | null): string | null {
  let url: URL;
  try {
    url = new URL(hostUrl);
  } catch {
    return null;
  }
  if (url.protocol === "http:") return `http://${url.host}`;
  if (url.protocol === "https:") {
    if (advertisedPort === null || !isTailnetHostname(url.hostname)) return null;
    return `http://${url.hostname}:${advertisedPort}`;
  }
  return null;
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

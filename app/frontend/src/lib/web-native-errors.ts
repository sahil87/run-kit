/**
 * Guest-failure → `TileError` mapping for the native web engine — pure, the
 * `web-url.ts` contract.
 *
 * The mapping lives SPA-side because address KINDS are `lib/web-url.ts`
 * knowledge main does not have: a dead PROXY port surfaces two ways — as an
 * HTTP 502 from the Go reverse proxy (riding `did-navigate`'s
 * `httpResponseCode`, an HTTP response rather than a Chromium load failure)
 * and as a connection-refused/reset Chromium failure code — while every other
 * main-frame failure is an unreachable host with Chromium's description as
 * the reason. The `refused` kind is never produced here: Chromium renders
 * sites that refuse embedding, so the refusal posture is the iframe engine's
 * alone.
 */
import { classifyAddress, proxyPortOf } from "@/lib/web-url";
import type { TileError } from "@/lib/web-frame-engine";

/** Chromium net error: the target refused the connection. */
export const WEB_ERR_CONNECTION_REFUSED = -102;
/** Chromium net error: the connection was reset. */
export const WEB_ERR_CONNECTION_RESET = -101;

/** The rk reverse proxy's answer when nothing listens on the upstream port —
 *  an HTTP response, so it never appears as a `did-fail-load` code. */
const WEB_PROXY_DEAD_UPSTREAM_STATUS = 502;

/** "ERR_NAME_NOT_RESOLVED" → "name not resolved"; an empty description (or
 *  one that strips to nothing) yields the generic reason. */
export function reasonFromChromiumDescription(description: string): string {
  const stripped = description.startsWith("ERR_") ? description.slice("ERR_".length) : description;
  const reason = stripped.toLowerCase().replaceAll("_", " ").trim();
  return reason === "" ? "load failed" : reason;
}

/** The host a failed navigation targeted, or the raw URL when it does not
 *  parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Map a main-frame `did-fail-load` (the `failed` relay) to the tile's error
 * surface: a refused/reset connection on a proxy-kind tab is a dead port;
 * everything else is an unreachable host.
 */
export function tileErrorForGuestFailure(
  input: { code: number; description: string; url: string },
  tabUrl: string,
): TileError {
  const port = classifyAddress(tabUrl) === "proxy" ? proxyPortOf(tabUrl) : null;
  if (
    port !== null &&
    (input.code === WEB_ERR_CONNECTION_REFUSED || input.code === WEB_ERR_CONNECTION_RESET)
  ) {
    return { kind: "dead-port", port };
  }
  return {
    kind: "unreachable",
    host: hostOf(input.url),
    reason: reasonFromChromiumDescription(input.description),
  };
}

/**
 * Map a committed navigation's HTTP status (the `url` relay's `httpStatus`)
 * to the error surface: the proxy's dead-upstream 502 on a proxy-kind tab is
 * a dead port; anything else (including a non-proxy 502 — a real site's own
 * gateway error is page content, not tile chrome) clears the surface.
 */
export function tileErrorForGuestResponse(httpStatus: number, tabUrl: string): TileError | null {
  if (httpStatus !== WEB_PROXY_DEAD_UPSTREAM_STATUS) return null;
  if (classifyAddress(tabUrl) !== "proxy") return null;
  const port = proxyPortOf(tabUrl);
  return port === null ? null : { kind: "dead-port", port };
}

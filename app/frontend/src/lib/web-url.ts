/**
 * Web-tile address model (260819-v6y4 R3/R4).
 *
 * A pure, DOM-free module — the `window-view.ts` contract — owning every
 * derivation over a stored `@rk_win_web_<n>` (or an address-bar keystroke):
 *
 * 1. `classifyAddress` — the four address kinds behind the header badge and
 *    the error-state posture: `present` (an `rk present` file), `proxy` (a
 *    loopback dev server riding `/proxy/{port}`), `external` (any other
 *    absolute http(s) URL), `relative` (any other root-relative path).
 * 2. `displayForm` — the pretty REST form the address bar and header show:
 *    plumbing hidden (`/proxy/` prefix, the `?server=…&v=…` params), never
 *    throwing (unparseable input degrades to the raw string).
 * 3. `normalizeAddressInput` — the submit-time normalization: bare loopback
 *    `host:port` → `/proxy/{port}/…`, bare domain → `https://…`, valid
 *    values pass through.
 * 4. `isAllowedUrl` — the frontend mirror of the backend scheme allowlist
 *    (http/https absolute, root-relative; the backend remains enforcement).
 * 5. `toProxySrc` — the iframe-src mapping: absolute loopback URLs ride the
 *    same-origin proxy, everything else passes through.
 *
 * The STORED `@rk_win_web_<n>` is never rewritten by display work — the
 * display contract (`docs/site/skill/display.md`) keeps relative addresses
 * relative.
 */

export type AddressKind = "present" | "proxy" | "external" | "relative";

/** The document CustomEvent that focuses the web tile's address bar (R12):
 *  dispatched by the ⌘L chord handler and the palette action; `IframeWindow`
 *  listens while mounted (the `web-find:open` precedent — at most one web
 *  tile per layout). */
export const WEB_ADDRESS_FOCUS_EVENT = "web-address:focus";

/** The document CustomEvent behind the `Web: Open in browser` palette action
 *  (R9): the mounted web tile pops its CURRENT address — the tracked frame
 *  location lives in the component, not at the palette's layer. */
export const WEB_OPEN_EXTERNAL_EVENT = "web-open-external";

/** Loopback hostnames whose absolute URLs classify as proxied ports. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Plumbing query params hidden from the present-kind display form — the
 *  `server` identity param and `rk present`'s `v` cache-buster. */
const PRESENT_PLUMBING_PARAMS = new Set(["server", "v"]);

/** Parse an absolute http(s) URL, or null for anything else. Never throws. */
function parseHttpUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/** The port of a root-relative `/proxy/{port}/…` path, or null. */
function proxyPathPort(path: string): number | null {
  const m = path.match(/^\/proxy\/(\d+)(\/|$)/);
  return m ? Number(m[1]) : null;
}

/** Whether an absolute URL is a loopback address WITH an explicit port — the
 *  proxied-port shape (`http://localhost:3000/…`). Portless loopback is not
 *  proxied (there is no port to ride). */
function loopbackPortOf(u: URL): number | null {
  if (!LOOPBACK_HOSTS.has(u.hostname)) return null;
  const port = Number(u.port);
  return Number.isInteger(port) && port > 0 ? port : null;
}

/**
 * Classify a stored/tracked address. Order matters: root-relative `/present/`
 * and `/proxy/` before the generic relative fallback; absolute loopback
 * http(s) URLs WITH a port are proxied ports, every other absolute http(s)
 * URL is external. Anything unrecognized (including non-allowlist schemes,
 * which the backend rejects anyway) degrades to `relative` — never throws.
 */
export function classifyAddress(url: string): AddressKind {
  const abs = parseHttpUrl(url);
  if (abs) {
    return loopbackPortOf(abs) !== null ? "proxy" : "external";
  }
  if (url.startsWith("/present/")) return "present";
  if (proxyPathPort(url) !== null) return "proxy";
  return "relative";
}

/**
 * The port a proxy-kind address targets, or null for any other kind.
 */
export function proxyPortOf(url: string): number | null {
  const abs = parseHttpUrl(url);
  if (abs) return loopbackPortOf(abs);
  return proxyPathPort(url);
}

/**
 * The pretty REST form of an address, per kind:
 * - present  → the file's basename, plumbing params (`server`, `v`) hidden
 * - proxy    → `localhost:{port}{path}` — the `/proxy/` plumbing never shows
 * - external → `host{path}{?query}` with the scheme omitted
 * - relative → the raw path
 *
 * Never throws: unparseable or degenerate input degrades to the raw string.
 */
export function displayForm(url: string): string {
  try {
    const kind = classifyAddress(url);
    if (kind === "present") {
      // Hide only the plumbing params (`server`, `v`) — a presented page's
      // own query params stay visible after the basename.
      const u = new URL(url, "http://x");
      const segments = u.pathname.split("/").filter(Boolean);
      const base = segments.length > 0 ? segments[segments.length - 1] : "";
      if (base === "" || base === "present") return url;
      const params = new URLSearchParams(u.search);
      for (const plumbing of PRESENT_PLUMBING_PARAMS) params.delete(plumbing);
      const rest = params.toString();
      return `${base}${rest !== "" ? `?${rest}` : ""}${u.hash}`;
    }
    if (kind === "proxy") {
      const abs = parseHttpUrl(url);
      if (abs) {
        return `localhost:${abs.port}${abs.pathname}${abs.search}${abs.hash}`;
      }
      const port = proxyPathPort(url);
      if (port !== null) {
        // Strip the `/proxy/{port}` prefix; keep the remaining path + query.
        const rest = url.replace(/^\/proxy\/\d+/, "");
        return `localhost:${port}${rest === "" ? "/" : rest}`;
      }
      return url;
    }
    if (kind === "external") {
      const abs = parseHttpUrl(url);
      if (abs) return `${abs.host}${abs.pathname}${abs.search}${abs.hash}`;
    }
    return url;
  } catch {
    return url;
  }
}

/**
 * The tab-strip label for a stored address, per kind:
 * - present  → the file's basename; plumbing params and the tab's own query
 *   and hash are dropped
 * - proxy    → `localhost:{port}{path}` with no search/hash
 * - external → the host only
 * - relative → the raw path
 *
 * Never throws; empty/whitespace input is `""` (callers fall back to `#n`).
 */
export function webTabTitle(url: string): string {
  const value = url.trim();
  if (value === "") return "";
  try {
    const kind = classifyAddress(value);
    if (kind === "present") {
      const u = new URL(value, "http://x");
      const segments = u.pathname.split("/").filter(Boolean);
      const base = segments.length > 0 ? segments[segments.length - 1] : "";
      return base === "" || base === "present" ? value : base;
    }
    if (kind === "proxy") {
      const abs = parseHttpUrl(value);
      if (abs) return `localhost:${abs.port}${abs.pathname}`;
      const port = proxyPathPort(value);
      if (port !== null) {
        const rest = value.replace(/^\/proxy\/\d+/, "").split(/[?#]/)[0];
        return `localhost:${port}${rest === "" ? "/" : rest}`;
      }
      return value;
    }
    if (kind === "external") {
      const abs = parseHttpUrl(value);
      if (abs) return abs.host;
    }
    return value;
  } catch {
    return value;
  }
}

/**
 * Submit-time input normalization (R4):
 * - bare loopback `localhost:{port}[{path}]` / `127.0.0.1:{port}[{path}]`
 *   (no scheme) → `/proxy/{port}{path or /}` — ride the same-origin proxy,
 *   matching the Host page's port addressing
 * - bare domain `example.com[/path]` (no scheme) → `https://example.com[/path]`
 * - already-valid values (absolute http(s), root-relative) pass through
 *
 * Anything else (an explicit non-allowlist scheme, a bare word) passes
 * through unchanged so `isAllowedUrl` can reject it with inline feedback.
 */
export function normalizeAddressInput(input: string): string {
  const trimmed = input.trim();
  // Bare loopback with a port — no scheme (a scheme would have matched the
  // pass-through below).
  const loopback = trimmed.match(/^(localhost|127\.0\.0\.1|\[::1\]):(\d+)([/?#][^\s]*)?$/);
  if (loopback) {
    const rest = loopback[3] ?? "/";
    return `/proxy/${loopback[2]}${rest.startsWith("/") ? rest : `/${rest}`}`;
  }
  // Bare domain: no scheme, no leading slash, carries a dot.
  if (/^[^\s/:]+\.[^\s/:]+(:\d+)?([/?#][^\s]*)?$/.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

/**
 * The frontend mirror of the backend @rk_win_url scheme allowlist (R1): absolute
 * http:/https: URLs with a host, and root-relative paths (a single leading
 * `/`, not scheme-relative `//`). Everything else is rejected — inline
 * feedback, no POST; the backend remains the enforcement point.
 */
export function isAllowedUrl(input: string): boolean {
  const value = input.trim();
  if (value === "") return false;
  if (value.startsWith("/")) return !value.startsWith("//");
  const abs = parseHttpUrl(value);
  return abs !== null && abs.host !== "";
}

/**
 * The iframe-src mapping: an absolute loopback URL re-expressed as the
 * same-origin `/proxy/{port}` path; every other address passes through
 * unchanged (relative addresses are already same-origin).
 */
export function toProxySrc(url: string): string {
  const abs = parseHttpUrl(url);
  if (abs && LOOPBACK_HOSTS.has(abs.hostname)) {
    const port = Number(abs.port);
    if (Number.isInteger(port) && port > 0) {
      return `/proxy/${abs.port}${abs.pathname}${abs.search}${abs.hash}`;
    }
  }
  return url;
}

/**
 * The `POST …/web` add-target form of an address: the backend resolves the
 * target exactly like `rk present` (`:port`, local URL, external URL,
 * file/dir), which has no root-relative `/proxy/` form — a relative proxy
 * address would be misread as a filesystem path. Re-express it as the
 * absolute loopback URL it rides (the backend rewrites that back to the
 * identical `/proxy/{port}` slot value); every other address passes through
 * unchanged.
 */
export function toWebAddTarget(url: string): string {
  const port = proxyPathPort(url);
  if (port === null) return url;
  const rest = url.replace(/^\/proxy\/\d+/, "");
  return `http://localhost:${port}${rest === "" ? "/" : rest}`;
}

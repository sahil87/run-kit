/**
 * Desktop-shell detection seam. The Electron viewer shell (`app/desktop`)
 * exposes `window.runkitShell` from its sandboxed preload via contextBridge;
 * the SPA uses this module to detect it, read shell metadata, and drive the
 * shell's `servers` bridge group (list/switch the shell-registered rk
 * servers — the command palette's `Server: Switch to "<name>"` entries, the
 * first real shell-gated consumer). Future ⌘-tier keyboard bindings likewise
 * gate on `isShell()` (the browser-reserved ⌘ namespace is reachable only
 * inside the shell). The bridge is runtime-injected, so it is validated
 * structurally (type narrowing, no assertions) rather than trusted from a
 * type declaration; the bridge's privileged welcome namespace is never
 * leaked, and `servers:*` privilege is enforced shell-side (main process
 * sender gating), not here.
 */

export interface RunkitShell {
  version: string;
  platform: string;
}

/** A shell-registered rk server, as reported by the `servers:list` bridge call. */
export interface ShellServer {
  id: string;
  name: string;
  url: string;
  active: boolean;
}

/** The bridge's `servers` group — thin IPC invokers resolving unknown shapes. */
interface ShellServersBridge {
  list: () => Promise<unknown>;
  switch: (id: string) => Promise<unknown>;
}

declare global {
  interface Window {
    /** Injected by the desktop shell's preload; absent in plain browsers. */
    runkitShell?: unknown;
  }
}

function isRunkitShell(value: unknown): value is RunkitShell {
  if (typeof value !== "object" || value === null) return false;
  if (!("version" in value) || !("platform" in value)) return false;
  return typeof value.version === "string" && typeof value.platform === "string";
}

/**
 * Shell metadata when running inside the desktop shell, `null` in a plain
 * browser (or when the bridge is malformed). Returns a plain object — the
 * bridge's extra members (e.g. its welcome-page IPC namespace) are not leaked.
 */
export function shellInfo(): RunkitShell | null {
  const candidate = typeof window === "undefined" ? undefined : window.runkitShell;
  if (!isRunkitShell(candidate)) return null;
  return { version: candidate.version, platform: candidate.platform };
}

/** True when the SPA is running inside the desktop shell. */
export function isShell(): boolean {
  return shellInfo() !== null;
}

function isServersBridge(value: unknown): value is ShellServersBridge {
  if (typeof value !== "object" || value === null) return false;
  if (!("list" in value) || !("switch" in value)) return false;
  return typeof value.list === "function" && typeof value.switch === "function";
}

/** The `servers` group when the bridge carries one — absent on older shells. */
function serversBridge(): ShellServersBridge | null {
  const candidate = typeof window === "undefined" ? undefined : window.runkitShell;
  if (typeof candidate !== "object" || candidate === null) return null;
  if (!("servers" in candidate)) return null;
  return isServersBridge(candidate.servers) ? candidate.servers : null;
}

function isShellServer(value: unknown): value is ShellServer {
  if (typeof value !== "object" || value === null) return false;
  if (!("id" in value) || !("name" in value) || !("url" in value) || !("active" in value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.url === "string" &&
    typeof value.active === "boolean"
  );
}

function isServersListOk(value: unknown): value is { ok: true; servers: ShellServer[] } {
  if (typeof value !== "object" || value === null) return false;
  if (!("ok" in value) || value.ok !== true) return false;
  if (!("servers" in value)) return false;
  return Array.isArray(value.servers) && value.servers.every(isShellServer);
}

/**
 * The shell-registered servers, or `null` in a plain browser, on an older
 * shell without the `servers` group, or on a rejected/malformed/denied
 * response. Never throws.
 */
export async function listShellServers(): Promise<ShellServer[] | null> {
  const bridge = serversBridge();
  if (!bridge) return null;
  let result: unknown;
  try {
    result = await bridge.list();
  } catch {
    return null;
  }
  return isServersListOk(result) ? result.servers : null;
}

/**
 * Switch the shell to a registered server (the shell then loads that server's
 * URL — a full page swap). Resolves `false` outside the shell or when the
 * shell rejects/denies the call. Never throws.
 */
export async function switchShellServer(id: string): Promise<boolean> {
  const bridge = serversBridge();
  if (!bridge) return false;
  let result: unknown;
  try {
    result = await bridge.switch(id);
  } catch {
    return false;
  }
  return (
    typeof result === "object" && result !== null && "ok" in result && result.ok === true
  );
}

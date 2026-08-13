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
  /** The host's persisted instance accent color (newer shells; absent on
   *  older shells and for never-visited hosts). */
  accentColor?: string;
  /** The host's cached waiting-agent count (newer shells; absent when the
   *  host has no live view or a zero count). */
  waiting?: number;
}

/** The bridge's `servers` group — thin IPC invokers resolving unknown shapes. */
interface ShellServersBridge {
  list: () => Promise<unknown>;
  switch: (id: string) => Promise<unknown>;
}

/** A `servers` group that also carries the optional `add` invoker (newer shells). */
interface ShellServersAddBridge extends ShellServersBridge {
  add: () => Promise<unknown>;
}

/** A `servers` group that also carries the optional `reorder` invoker (newer shells). */
interface ShellServersReorderBridge extends ShellServersBridge {
  reorder: (id: string, toIndex: number) => Promise<unknown>;
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
    typeof value.active === "boolean" &&
    // Optional fields are strict-when-present: the response comes from our
    // own shell, which omits fields rather than mistyping them — absence is
    // always valid (older shells), a wrong-typed present field rejects.
    (!("accentColor" in value) || typeof value.accentColor === "string") &&
    (!("waiting" in value) || typeof value.waiting === "number")
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

/**
 * The `add` invoker is additive to the `servers` group (shells older than the
 * dropdown's `+ Add Host…` footer expose only list/switch), so it is narrowed
 * separately from `isServersBridge` — the group stays usable without it.
 */
function isServersAddBridge(bridge: ShellServersBridge): bridge is ShellServersAddBridge {
  return "add" in bridge && typeof Reflect.get(bridge, "add") === "function";
}

/** True when the shell can open its Add Host flow (`servers.add` present). */
export function canAddShellHost(): boolean {
  const bridge = serversBridge();
  return bridge !== null && isServersAddBridge(bridge);
}

/**
 * Ask the shell to open its Add Host flow — the welcome page in add mode, a
 * full page swap away from the SPA (the same path as the native
 * `Hosts → Add Host…` menu item). Resolves `false` in a plain browser, on an
 * older shell whose `servers` group lacks the `add` invoker, or when the
 * shell rejects/denies the call. Never throws.
 */
export async function addShellHost(): Promise<boolean> {
  const bridge = serversBridge();
  if (!bridge || !isServersAddBridge(bridge)) return false;
  let result: unknown;
  try {
    result = await bridge.add();
  } catch {
    return false;
  }
  return (
    typeof result === "object" && result !== null && "ok" in result && result.ok === true
  );
}

/**
 * The `reorder` invoker is additive to the `servers` group (shells older
 * than the host-switcher's drag/⌥↑⌥↓ reorder expose only list/switch/add),
 * so it is narrowed separately from `isServersBridge` — the group stays
 * usable without it.
 */
function isServersReorderBridge(
  bridge: ShellServersBridge,
): bridge is ShellServersReorderBridge {
  return "reorder" in bridge && typeof Reflect.get(bridge, "reorder") === "function";
}

/** True when the shell can reorder its host list (`servers.reorder` present). */
export function canReorderShellHosts(): boolean {
  const bridge = serversBridge();
  return bridge !== null && isServersReorderBridge(bridge);
}

/**
 * Move a host to `toIndex` in the shell's host list — the switcher menu's
 * order IS the ⌥⌘1–9/⇧Ctrl+1–9 accelerator map, so the shell rebuilds its
 * native menu on commit. Resolves `false` in a plain browser, on an older
 * shell whose `servers` group lacks the `reorder` invoker, or when the shell
 * rejects/denies the call. Never throws.
 */
export async function reorderShellHosts(id: string, toIndex: number): Promise<boolean> {
  const bridge = serversBridge();
  if (!bridge || !isServersReorderBridge(bridge)) return false;
  let result: unknown;
  try {
    result = await bridge.reorder(id, toIndex);
  } catch {
    return false;
  }
  return (
    typeof result === "object" && result !== null && "ok" in result && result.ok === true
  );
}
/** The bridge's `badge` group — thin IPC invoker resolving unknown shapes. */
interface ShellBadgeBridge {
  set: (count: number) => Promise<unknown>;
}

function isBadgeBridge(value: unknown): value is ShellBadgeBridge {
  if (typeof value !== "object" || value === null) return false;
  if (!("set" in value)) return false;
  return typeof value.set === "function";
}

/** The `badge` group when the bridge carries one — absent on older shells. */
function badgeBridge(): ShellBadgeBridge | null {
  const candidate = typeof window === "undefined" ? undefined : window.runkitShell;
  if (typeof candidate !== "object" || candidate === null) return null;
  if (!("badge" in candidate)) return null;
  return isBadgeBridge(candidate.badge) ? candidate.badge : null;
}

/**
 * Report the waiting-agent count to the shell's dock/taskbar badge (`0`
 * clears). Resolves `false` in a plain browser, on an older shell without the
 * `badge` group, or when the shell rejects/denies the call. Never throws.
 */
export async function setShellBadge(count: number): Promise<boolean> {
  const bridge = badgeBridge();
  if (!bridge) return false;
  let result: unknown;
  try {
    result = await bridge.set(count);
  } catch {
    return false;
  }
  return (
    typeof result === "object" && result !== null && "ok" in result && result.ok === true
  );
}

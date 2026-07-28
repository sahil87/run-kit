/**
 * Desktop-shell detection seam. The Electron viewer shell (`app/desktop`)
 * exposes `window.runkitShell` from its sandboxed preload via contextBridge;
 * the SPA uses this module to detect it and read shell metadata. Consumed
 * nowhere critical in v1 — future ⌘-tier keyboard bindings gate on
 * `isShell()` (the browser-reserved ⌘ namespace is reachable only inside the
 * shell). The bridge is runtime-injected, so it is validated structurally
 * (type narrowing, no assertions) rather than trusted from a type declaration.
 */

export interface RunkitShell {
  version: string;
  platform: string;
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

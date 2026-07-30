/**
 * Sandboxed preload — the only bridge between renderer pages and the main
 * process. Exposes `window.runkitShell`:
 *
 *   - `version` / `platform`: readable by EVERY page (including pages loaded
 *     from registered rk servers) — this is the SPA's shell-detection seam
 *     (`app/frontend/src/lib/shell.ts`).
 *   - `servers`: list/switch invokers for the SPA command palette. Privileged
 *     for registered server origins AND the welcome page — main.ts gates
 *     every `servers:*` handler on the sender frame (the navigation
 *     allowlist), so any other sender gets a rejection.
 *   - `__welcome`: IPC invokers used by the welcome page only. They are
 *     exposed everywhere but privileged NOWHERE except the welcome page —
 *     every `welcome:*` handler in main.ts verifies `event.senderFrame.url`
 *     against the welcome file:// URL, so server-loaded pages calling these
 *     get a rejection, never a privileged action.
 *
 * The shell version arrives via `additionalArguments` (sandboxed preloads
 * read `process.argv`), keeping `app.getVersion()` out of renderer reach.
 */
import { contextBridge, ipcRenderer } from "electron";

const VERSION_ARG_PREFIX = "--runkit-shell-version=";

function shellVersion(): string {
  const arg = process.argv.find((a) => a.startsWith(VERSION_ARG_PREFIX));
  return arg ? arg.slice(VERSION_ARG_PREFIX.length) : "0.0.0";
}

contextBridge.exposeInMainWorld("runkitShell", {
  version: shellVersion(),
  platform: process.platform,
  servers: {
    list: (): Promise<unknown> => ipcRenderer.invoke("servers:list"),
    switch: (id: string): Promise<unknown> => ipcRenderer.invoke("servers:switch", id),
  },
  __welcome: {
    testServer: (url: string): Promise<unknown> =>
      ipcRenderer.invoke("welcome:test-server", url),
    addServer: (name: string, url: string): Promise<unknown> =>
      ipcRenderer.invoke("welcome:add-server", { name, url }),
    renameServer: (id: string, name: string): Promise<unknown> =>
      ipcRenderer.invoke("welcome:rename-server", { id, name }),
    cancel: (): Promise<unknown> => ipcRenderer.invoke("welcome:cancel"),
  },
});

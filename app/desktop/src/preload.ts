/**
 * Sandboxed preload — the only bridge between renderer pages and the main
 * process. Exposes `window.runkitShell`:
 *
 *   - `version` / `platform`: readable by EVERY page (including pages loaded
 *     from registered rk servers) — this is the SPA's shell-detection seam
 *     (`app/frontend/src/lib/shell.ts`).
 *   - `servers`: list/switch/add/reorder invokers for the SPA command
 *     palette and titlebar-strip host switcher. The group
 *     name and its `servers:*` channels are the web SPA's contract and keep
 *     their server naming (the entries are hosts — rk instances — shell-side).
 *     Privileged for registered host origins AND the welcome page — main.ts
 *     gates every `servers:*` handler on the sender frame (the navigation
 *     allowlist), so any other sender gets a rejection.
 *   - `badge`: the SPA's waiting-agent-count report (`badge:set`) driving the
 *     dock/taskbar badge. Gated exactly like `servers:*` (registered host
 *     origins + welcome) main-side; payloads are validated in main.
 *   - `accent`: the SPA's raw instance-accent report (`accent:set`, a strict
 *     hex string) persisted per host for the switcher's edge bars — the
 *     full-strength color the theme-color meta's 35% titlebar blend cannot
 *     carry. Gated and validated exactly like `badge:*` main-side.
 *   - `__welcome`: IPC invokers used by the welcome page only. They are
 *     exposed everywhere but privileged NOWHERE except the welcome page —
 *     every `welcome:*` handler in main.ts verifies `event.senderFrame.url`
 *     against the welcome file:// URL, so host-loaded pages calling these
 *     get a rejection, never a privileged action.
 *   - `__daemon`: local-daemon invokers (status/start/stop) for the welcome
 *     page's "This Mac" section — gated exactly like `__welcome` (main-side
 *     sender-frame check on every `daemon:*` handler). Every daemon action
 *     is explicit and user-initiated; the shell never auto-starts anything.
 *   - `__remote`: the welcome page's "or over SSH" rung — `connect` invokes
 *     the main-side `rk remote add` + `rk remote connect` flow (gated
 *     exactly like `__welcome`), `onProgress` subscribes to the streamed
 *     `remote:progress` chatter lines main relays while connect runs.
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
    add: (): Promise<unknown> => ipcRenderer.invoke("servers:add"),
    reorder: (id: string, toIndex: number): Promise<unknown> =>
      ipcRenderer.invoke("servers:reorder", { id, toIndex }),
  },
  badge: {
    set: (count: number): Promise<unknown> => ipcRenderer.invoke("badge:set", count),
  },
  accent: {
    set: (hex: string): Promise<unknown> => ipcRenderer.invoke("accent:set", hex),
  },
  __welcome: {
    testHost: (url: string): Promise<unknown> =>
      ipcRenderer.invoke("welcome:test-host", url),
    addHost: (name: string, url: string): Promise<unknown> =>
      ipcRenderer.invoke("welcome:add-host", { name, url }),
    cancel: (): Promise<unknown> => ipcRenderer.invoke("welcome:cancel"),
  },
  __daemon: {
    status: (): Promise<unknown> => ipcRenderer.invoke("daemon:status"),
    start: (): Promise<unknown> => ipcRenderer.invoke("daemon:start"),
    stop: (): Promise<unknown> => ipcRenderer.invoke("daemon:stop"),
  },
  __remote: {
    connect: (target: string): Promise<unknown> =>
      ipcRenderer.invoke("remote:connect", target),
    onProgress: (handler: (line: string) => void): void => {
      ipcRenderer.on("remote:progress", (_event, line: unknown) => {
        if (typeof line === "string") handler(line);
      });
    },
  },
});

/**
 * Sandboxed preload — the only bridge between renderer pages and the main
 * process. Exposes `window.runkitShell`:
 *
 *   - `version` / `platform`: readable by EVERY page (including pages loaded
 *     from registered rk servers) — this is the SPA's shell-detection seam
 *     (`app/frontend/src/lib/shell.ts`).
 *   - `servers`: list/switch/add/addDirect/reorder/remove/rename invokers for
 *     the SPA command palette and titlebar-strip host switcher. The group
 *     name and its `servers:*` channels are the web SPA's contract and keep
 *     their server naming (the entries are hosts — rk instances — shell-side).
 *     Privileged for registered host origins AND the welcome page — main.ts
 *     gates every `servers:*` handler on the sender frame (the navigation
 *     allowlist), so any other sender gets a rejection.
 *   - `badge`: the SPA's waiting-agent-count report (`badge:set`) driving the
 *     dock/taskbar badge. Gated exactly like `servers:*` (registered host
 *     origins + welcome) main-side; payloads are validated in main.
 *   - `windows`: `newWindow()`/`close()` invokers for `shell:new-window`
 *     (duplicates the sender's window) and `shell:close-window` (closes the
 *     sender's window). Gated like `servers:*`.
 *   - `accent`: the SPA's raw instance-accent report (`accent:set`, a strict
 *     hex string) persisted per host for the switcher's edge bars — the
 *     full-strength color the theme-color meta's 35% titlebar blend cannot
 *     carry. Gated and validated exactly like `badge:*` main-side.
 *   - `__welcome`: IPC invokers used by the welcome page only. They are
 *     exposed everywhere but privileged NOWHERE except the welcome page —
 *     every `welcome:*` handler in main.ts verifies `event.senderFrame.url`
 *     against the welcome file:// URL, so host-loaded pages calling these
 *     get a rejection, never a privileged action.
 *   - `__daemon`: local-daemon invokers (status/start/restart/stop) for the
 *     welcome and dead-host pages — exposed everywhere but privileged only
 *     for those shell-owned pages by main-side sender-frame checks. Every
 *     daemon action is explicit; the shell never auto-starts anything.
 *   - `__interstitial`: the dead-host page's argument-less Retry invoker.
 *     Main resolves its host and kind from the sender view, never renderer
 *     query parameters.
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
    // addDirect: the SPA's in-place Add Host dialog — main pings and persists
    // in one invoke and returns the structured error the dialog renders
    // inline. Additive like every sibling: older SPAs never call it.
    addDirect: (name: string, url: string): Promise<unknown> =>
      ipcRenderer.invoke("servers:add-direct", { name, url }),
    reorder: (id: string, toIndex: number): Promise<unknown> =>
      ipcRenderer.invoke("servers:reorder", { id, toIndex }),
    remove: (id: string): Promise<unknown> => ipcRenderer.invoke("servers:remove", id),
    removeConfirmed: (id: string): Promise<unknown> =>
      ipcRenderer.invoke("servers:remove-confirmed", id),
    setUrl: (id: string, url: string): Promise<unknown> =>
      ipcRenderer.invoke("servers:set-url", { id, url }),
    rename: (id: string, name: string): Promise<unknown> =>
      ipcRenderer.invoke("servers:rename", { id, name }),
  },
  badge: {
    set: (count: number): Promise<unknown> => ipcRenderer.invoke("badge:set", count),
  },
  windows: {
    // shell:new-window — duplicates the sender's window (same host, same
    // route, fresh independent view). Consumed by the SPA's ⌘N binding.
    // Gated main-side exactly like `servers:*` (registered host origins +
    // welcome).
    newWindow: (): Promise<unknown> => ipcRenderer.invoke("shell:new-window"),
    // shell:close-window — closes the SENDER's window (the SPA's ⇧⌘W
    // binding; NOT the focused-window seam the menu's Close Window rides).
    // Gated exactly like `shell:new-window`.
    close: (): Promise<unknown> => ipcRenderer.invoke("shell:close-window"),
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
    restart: (): Promise<unknown> => ipcRenderer.invoke("daemon:restart"),
    stop: (): Promise<unknown> => ipcRenderer.invoke("daemon:stop"),
  },
  __interstitial: {
    retry: (): Promise<unknown> => ipcRenderer.invoke("interstitial:retry"),
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

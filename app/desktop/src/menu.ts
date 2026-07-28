/**
 * Application menu — the ⌘-tier seam (the point of this shell).
 *
 * Electron steals a key from the page only via menu accelerators,
 * `globalShortcut` (we register NONE), or the OS. So the seam is simply:
 * DO NOT bind accelerators on keys the page should own. Every key not listed
 * below already reaches the loaded SPA — no `before-input-event` interception
 * exists in v1, and none should be added: if the SPA later needs page-first
 * handling of a key that IS menu-bound here, the fix is to REMOVE that menu
 * item's accelerator, never to intercept input events.
 *
 * Bound accelerators (exhaustive): ⌘Q quit, ⌘H/⌥⌘H hide; Edit roles
 * ⌘Z/⇧⌘Z/⌘X/⌘C/⌘V/⌘A; View ⌘R/⇧⌘R reload, ⌥⌘I devtools, ⌘+/⌘−/⌘0 zoom,
 * ⌃⌘F fullscreen; Servers radios ⌃1–⌃9 (Control deliberately — ⌘1–9 stays
 * free for the page); Window ⌘M minimize.
 *
 * Guaranteed fall-through set (never bind these): ⌘T ⌘W ⌘N ⌘L ⌘K ⌘F ⌘P
 * ⌘1–9 ⌘[ ⌘] and all unlisted ⇧⌘ combos. ⌘W is unbound BY DESIGN — it falls
 * through for future tab-close semantics; mouse users get the accelerator-less
 * "Close Window" item below (which is also why the Window menu is a custom
 * template and NOT `role: 'windowMenu'` — that role auto-binds ⌘W).
 */
import { app, BrowserWindow, Menu, MenuItemConstructorOptions } from "electron";
import { ServerEntry } from "./servers";

export interface MenuCallbacks {
  onSwitchServer: (id: string) => void;
  onAddServer: () => void;
  onRemoveServer: (id: string) => void;
}

const MAX_SWITCHER_ACCELERATORS = 9;

const separator: MenuItemConstructorOptions = { type: "separator" };

/** Build the full application menu; call again (and re-set) on every server-list change. */
export function buildMenu(
  servers: ServerEntry[],
  activeId: string | null,
  callbacks: MenuCallbacks,
): Menu {
  const switcherItems: MenuItemConstructorOptions[] = servers.map((server, index) => ({
    label: server.name,
    type: "radio",
    checked: server.id === activeId,
    // Control (not CmdOrCtrl): ⌃1–⌃9 switches servers while ⌘1–9 falls through to the page.
    accelerator: index < MAX_SWITCHER_ACCELERATORS ? `Ctrl+${index + 1}` : undefined,
    click: () => callbacks.onSwitchServer(server.id),
  }));

  const removeItems: MenuItemConstructorOptions[] = servers.map((server) => ({
    label: `Remove "${server.name}"…`,
    click: () => callbacks.onRemoveServer(server.id),
  }));

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" }, // ⌘H
        { role: "hideOthers" }, // ⌥⌘H
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }, // ⌘Q
      ],
    },
    {
      label: "Edit",
      submenu: [
        // Mandatory roles — clipboard in web content is dead on macOS without them.
        { role: "undo" }, // ⌘Z
        { role: "redo" }, // ⇧⌘Z
        { type: "separator" },
        { role: "cut" }, // ⌘X
        { role: "copy" }, // ⌘C
        { role: "paste" }, // ⌘V
        { role: "selectAll" }, // ⌘A
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" }, // ⌘R
        { role: "forceReload" }, // ⇧⌘R
        { role: "toggleDevTools" }, // ⌥⌘I
        { type: "separator" },
        { role: "resetZoom" }, // ⌘0
        { role: "zoomIn" }, // ⌘+
        { role: "zoomOut" }, // ⌘−
        { type: "separator" },
        { role: "togglefullscreen" }, // ⌃⌘F
      ],
    },
    {
      label: "Servers",
      submenu: [
        ...switcherItems,
        ...(switcherItems.length > 0 ? [separator] : []),
        { label: "Add Server…", click: () => callbacks.onAddServer() },
        ...removeItems,
      ],
    },
    {
      // Custom template, NOT `role: 'windowMenu'` — that role would auto-bind ⌘W.
      label: "Window",
      submenu: [
        { role: "minimize" }, // ⌘M
        { role: "zoom" },
        { type: "separator" },
        {
          // Accelerator-less by design: ⌘W falls through to the page (see header comment).
          label: "Close Window",
          click: () => BrowserWindow.getFocusedWindow()?.close(),
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

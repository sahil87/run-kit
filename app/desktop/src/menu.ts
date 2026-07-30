/**
 * Application menu — the keyboard-tier seam (the point of this shell).
 *
 * Electron steals a key from the page only via menu accelerators,
 * `globalShortcut` (we register NONE), or the OS. So the seam is simply:
 * DO NOT bind accelerators on keys the page should own. Every key not listed
 * below already reaches the loaded SPA — no `before-input-event` interception
 * exists in v1, and none should be added: if the SPA later needs page-first
 * handling of a key that IS menu-bound here, the fix is to REMOVE that menu
 * item's accelerator, never to intercept input events.
 *
 * Two-tier rule (platform-neutral, the governing contract):
 *   - Page tier — unshifted `CmdOrCtrl+<any>`: the shell NEVER binds it, on
 *     any platform. This is the shell's premise: the tier a browser reserves
 *     (macOS: ⌘; Windows/Linux: Ctrl) belongs to the SPA.
 *   - Shell tier — `Shift+CmdOrCtrl+<any>`: shell chrome MAY claim keys here,
 *     sparingly. Today's only claim: the Servers switcher (1–9).
 *
 * The menu is applied PER PLATFORM — symmetry of rule, not symmetry of
 * accelerator table. Carve-outs the rule tolerates (documented, never
 * silently violated): the macOS Edit roles and the conventional View/App
 * shell chrome, itemized per platform below.
 *
 * macOS — bound accelerators (exhaustive): ⌘Q quit, ⌘H/⌥⌘H hide; Edit roles
 * ⌘Z/⇧⌘Z/⌘X/⌘C/⌘V/⌘A (a macOS carve-out, NOT part of the cross-platform
 * rule — clipboard in web content is dead on macOS without them); View
 * ⌘R/⇧⌘R reload, ⌥⌘I devtools, ⌘+/⌘−/⌘0 zoom, ⌃⌘F fullscreen (conventional
 * shell chrome via role defaults, predating the rule); Servers radios
 * ⇧⌘1–⇧⌘9 (the shell tier); Window ⌘M minimize. Guaranteed fall-through set
 * (never bind these): ⌘T ⌘W ⌘N ⌘L ⌘K ⌘F ⌘P ⌘1–9 ⌘[ ⌘] — the unshifted ⌘
 * tier is inviolable; the shifted tier is shell-claimable. ⌘W is unbound BY
 * DESIGN — it falls through for future tab-close semantics; mouse users get
 * the accelerator-less "Close Window" item (which is also why the Window
 * menu is a custom template and NOT `role: 'windowMenu'` — that role
 * auto-binds ⌘W).
 *
 * Windows/Linux — NOTHING in the unshifted Ctrl tier is bound; the page tier
 * is completely clean. Chromium handles Ctrl+C/V/X/A/Z natively there, so
 * there is no Edit menu; File→Quit is a plain item (the `quit` role
 * default-binds Ctrl+Q on Linux); there is no Window menu (native window
 * chrome covers minimize/close; the `minimize` role default-binds Ctrl+M);
 * View roles whose defaults sit in the unshifted Ctrl tier (reload Ctrl+R,
 * zoom Ctrl+0/±) are rebuilt as accelerator-less plain items. Bound there
 * (exhaustive): ⇧Ctrl+1–9 Servers switcher (the shell tier), ⇧Ctrl+R
 * force-reload, ⇧Ctrl+I devtools, F11 fullscreen.
 *
 * Hardware-verify caveat: shifted-digit accelerators are the flakiest
 * accelerator class (Electron resolves accelerators by character, not
 * scancode; AZERTY digits already require Shift). ⇧⌘1–9 switching on a
 * non-US layout is a manual-verify item; no scancode workaround in v1.
 */
import { app, BrowserWindow, Menu, MenuItemConstructorOptions, WebContents } from "electron";
import { ServerEntry } from "./servers";

export interface MenuCallbacks {
  onSwitchServer: (id: string) => void;
  onAddServer: () => void;
  onRenameServer: (id: string) => void;
  onRemoveServer: (id: string) => void;
}

const MAX_SWITCHER_ACCELERATORS = 9;

const isMac = process.platform === "darwin";

const separator: MenuItemConstructorOptions = { type: "separator" };

function focusedWebContents(): WebContents | undefined {
  return BrowserWindow.getFocusedWindow()?.webContents;
}

function zoomBy(delta: number): void {
  const contents = focusedWebContents();
  if (contents) contents.setZoomLevel(contents.getZoomLevel() + delta);
}

/** macOS App menu (⌘Q/⌘H/⌥⌘H) — a mac-only shape. */
function macAppMenu(): MenuItemConstructorOptions {
  return {
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
  };
}

/** Windows/Linux conventional minimal File menu — quit only, accelerator-less. */
function fileMenu(): MenuItemConstructorOptions {
  return {
    label: "File",
    submenu: [
      {
        // Plain item, NOT `role: 'quit'` — that role default-binds Ctrl+Q on
        // Linux, which is the page tier there.
        label: process.platform === "win32" ? "Exit" : "Quit",
        click: () => app.quit(),
      },
    ],
  };
}

/** macOS Edit menu — mandatory roles; clipboard in web content is dead on macOS without them. */
function macEditMenu(): MenuItemConstructorOptions {
  return {
    label: "Edit",
    submenu: [
      { role: "undo" }, // ⌘Z
      { role: "redo" }, // ⇧⌘Z
      { type: "separator" },
      { role: "cut" }, // ⌘X
      { role: "copy" }, // ⌘C
      { role: "paste" }, // ⌘V
      { role: "selectAll" }, // ⌘A
    ],
  };
}

function viewMenu(): MenuItemConstructorOptions {
  if (isMac) {
    return {
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
    };
  }
  // Windows/Linux: item parity with the mac View menu, but roles whose
  // default accelerator sits in the unshifted Ctrl tier (Ctrl+R, Ctrl+0,
  // Ctrl+±) are rebuilt as accelerator-less plain items — a role's default
  // accelerator cannot be removed, and displaying a dead one
  // (registerAccelerator: false) would lie to the user.
  return {
    label: "View",
    submenu: [
      { label: "Reload", click: () => focusedWebContents()?.reload() },
      { role: "forceReload" }, // ⇧Ctrl+R — shifted tier, shell-claimable
      { role: "toggleDevTools" }, // ⇧Ctrl+I — shifted tier
      { type: "separator" },
      { label: "Actual Size", click: () => focusedWebContents()?.setZoomLevel(0) },
      { label: "Zoom In", click: () => zoomBy(0.5) },
      { label: "Zoom Out", click: () => zoomBy(-0.5) },
      { type: "separator" },
      { role: "togglefullscreen" }, // F11
    ],
  };
}

function serversMenu(
  servers: ServerEntry[],
  activeId: string | null,
  callbacks: MenuCallbacks,
): MenuItemConstructorOptions {
  const switcherItems: MenuItemConstructorOptions[] = servers.map((server, index) => ({
    label: server.name,
    type: "radio",
    checked: server.id === activeId,
    // Shell tier (see the two-tier rule above): ⇧⌘1–9 (mac) / ⇧Ctrl+1–9
    // (win/linux) switches servers while the unshifted Cmd/Ctrl digits fall
    // through to the page on every platform.
    accelerator: index < MAX_SWITCHER_ACCELERATORS ? `Shift+CmdOrCtrl+${index + 1}` : undefined,
    click: () => callbacks.onSwitchServer(server.id),
  }));

  // Accelerator-less by design (like Remove) — the keyboard-tier seam is untouched.
  const renameItems: MenuItemConstructorOptions[] = servers.map((server) => ({
    label: `Rename "${server.name}"…`,
    click: () => callbacks.onRenameServer(server.id),
  }));

  const removeItems: MenuItemConstructorOptions[] = servers.map((server) => ({
    label: `Remove "${server.name}"…`,
    click: () => callbacks.onRemoveServer(server.id),
  }));

  return {
    label: "Servers",
    submenu: [
      ...switcherItems,
      ...(switcherItems.length > 0 ? [separator] : []),
      { label: "Add Server…", click: () => callbacks.onAddServer() },
      ...renameItems,
      ...removeItems,
    ],
  };
}

/** macOS Window menu — custom template, NOT `role: 'windowMenu'` (auto-binds ⌘W). */
function macWindowMenu(): MenuItemConstructorOptions {
  return {
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
  };
}

/** Build the full application menu; call again (and re-set) on every server-list change. */
export function buildMenu(
  servers: ServerEntry[],
  activeId: string | null,
  callbacks: MenuCallbacks,
): Menu {
  const template: MenuItemConstructorOptions[] = [
    isMac ? macAppMenu() : fileMenu(),
    ...(isMac ? [macEditMenu()] : []),
    viewMenu(),
    serversMenu(servers, activeId, callbacks),
    ...(isMac ? [macWindowMenu()] : []),
  ];

  return Menu.buildFromTemplate(template);
}

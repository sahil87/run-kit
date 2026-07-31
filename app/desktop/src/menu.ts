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
 *     sparingly. Today's only claim: the Hosts switcher (1–9).
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
 * shell chrome via role defaults, predating the rule); Hosts radios
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
 * (exhaustive): ⇧Ctrl+1–9 Hosts switcher (the shell tier), ⇧Ctrl+R
 * force-reload, ⇧Ctrl+I devtools, F11 fullscreen.
 *
 * Hardware-verify caveat: shifted-digit accelerators are the flakiest
 * accelerator class (Electron resolves accelerators by character, not
 * scancode; AZERTY digits already require Shift). ⇧⌘1–9 switching on a
 * non-US layout is a manual-verify item; no scancode workaround in v1.
 */
import { app, BrowserWindow, Menu, MenuItemConstructorOptions, WebContents } from "electron";
import { HostEntry } from "./hosts";

export interface MenuCallbacks {
  onSwitchHost: (id: string) => void;
  onAddHost: () => void;
  onRemoveHost: (id: string) => void;
  /** Local Daemon submenu — starts the daemon when stopped, then connects. */
  onDaemonConnect: () => void;
  onDaemonRestart: () => void;
  onDaemonStop: () => void;
  /** App-menu "Restart to Update" — spawns `rk desktop update` detached. */
  onRestartToUpdate: () => void;
}

/**
 * Menu-relevant local-daemon state (cached in main, refreshed by detection).
 * `null` hides the submenu entirely — rk not installed, win32, or not yet
 * probed.
 */
export interface DaemonMenuInfo {
  running: boolean;
  /** Bare version from `rk --version` (no leading "v"); null when unparseable. */
  version: string | null;
}

/**
 * Menu-relevant desktop-update state (cached in main, refreshed by the
 * `rk desktop status` check on startup/focus). `null` hides the App-menu
 * item entirely — non-darwin, rk missing, status failure, or up to date.
 */
export interface UpdateMenuInfo {
  /** Latest release version from `rk desktop status` (no leading "v"). */
  latestVersion: string;
  /** An `rk desktop update` spawn is in flight — retitle + disable the item. */
  updating: boolean;
}

/** Post-click label while the detached CLI drives quit → swap → relaunch. */
const UPDATING_LABEL = "Updating…";

function restartToUpdateLabel(latestVersion: string): string {
  return `Restart to Update (v${latestVersion} available)…`;
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

/**
 * macOS App menu (⌘Q/⌘H/⌥⌘H) — a mac-only shape. When an update is cached
 * (`update` non-null), a detection-gated, accelerator-less "Restart to
 * Update (vX.Y.Z available)…" item sits in its own group directly above
 * Quit (the keyboard-tier seam is untouched — no accelerator, no registry
 * mirror change). While the spawn is in flight it reads "Updating…" and is
 * disabled; the detached CLI drives the quit → swap → relaunch from there.
 */
function macAppMenu(
  update: UpdateMenuInfo | null,
  callbacks: MenuCallbacks,
): MenuItemConstructorOptions {
  const updateItems: MenuItemConstructorOptions[] =
    update === null
      ? []
      : [
          update.updating
            ? { label: UPDATING_LABEL, enabled: false }
            : {
                label: restartToUpdateLabel(update.latestVersion),
                click: () => callbacks.onRestartToUpdate(),
              },
          separator,
        ];
  return {
    label: app.name,
    submenu: [
      { role: "about" },
      { type: "separator" },
      { role: "hide" }, // ⌘H
      { role: "hideOthers" }, // ⌥⌘H
      { role: "unhide" },
      { type: "separator" },
      ...updateItems,
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

/**
 * "Local Daemon" submenu — the persistent post-connect control surface for
 * the machine's own daemon (the welcome page's "This Mac" section covers
 * pre-connect). Every item is accelerator-less by design (like Remove) —
 * the keyboard-tier seam is untouched. Connect shares the same
 * main-side start-and-connect flow as the welcome card; Restart/Stop are
 * disabled while the daemon is stopped.
 */
function localDaemonSubmenu(
  daemon: DaemonMenuInfo,
  callbacks: MenuCallbacks,
): MenuItemConstructorOptions {
  const versionSuffix = daemon.version !== null ? ` · v${daemon.version}` : "";
  const statusLabel = daemon.running ? `● running${versionSuffix}` : `○ stopped${versionSuffix}`;
  return {
    label: "Local Daemon",
    submenu: [
      { label: statusLabel, enabled: false },
      separator,
      { label: "Connect", click: () => callbacks.onDaemonConnect() },
      { label: "Restart", enabled: daemon.running, click: () => callbacks.onDaemonRestart() },
      { label: "Stop", enabled: daemon.running, click: () => callbacks.onDaemonStop() },
    ],
  };
}

function hostsMenu(
  hosts: HostEntry[],
  activeId: string | null,
  callbacks: MenuCallbacks,
  daemon: DaemonMenuInfo | null,
): MenuItemConstructorOptions {
  const switcherItems: MenuItemConstructorOptions[] = hosts.map((host, index) => ({
    label: host.name,
    type: "radio",
    checked: host.id === activeId,
    // Shell tier (see the two-tier rule above): ⇧⌘1–9 (mac) / ⇧Ctrl+1–9
    // (win/linux) switches hosts while the unshifted Cmd/Ctrl digits fall
    // through to the page on every platform.
    accelerator: index < MAX_SWITCHER_ACCELERATORS ? `Shift+CmdOrCtrl+${index + 1}` : undefined,
    click: () => callbacks.onSwitchHost(host.id),
  }));

  // Accelerator-less by design — the keyboard-tier seam is untouched.
  const removeItems: MenuItemConstructorOptions[] = hosts.map((host) => ({
    label: `Remove "${host.name}"…`,
    click: () => callbacks.onRemoveHost(host.id),
  }));

  return {
    label: "Hosts",
    submenu: [
      ...switcherItems,
      ...(switcherItems.length > 0 ? [separator] : []),
      { label: "Add Host…", click: () => callbacks.onAddHost() },
      ...removeItems,
      // Hidden when rk is not installed (and on win32) — daemon is null then.
      ...(daemon !== null ? [separator, localDaemonSubmenu(daemon, callbacks)] : []),
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

/**
 * Build the full application menu; call again (and re-set) on every
 * host-list change and whenever the cached daemon or update state changes.
 * `daemon` null hides the Local Daemon submenu (not installed / win32);
 * `update` null hides the App-menu Restart-to-Update item (non-darwin, rk
 * missing, status failure, or up to date — the item is mac-only by structure,
 * since only `macAppMenu` renders it).
 */
export function buildMenu(
  hosts: HostEntry[],
  activeId: string | null,
  callbacks: MenuCallbacks,
  daemon: DaemonMenuInfo | null,
  update: UpdateMenuInfo | null,
): Menu {
  const template: MenuItemConstructorOptions[] = [
    isMac ? macAppMenu(update, callbacks) : fileMenu(),
    ...(isMac ? [macEditMenu()] : []),
    viewMenu(),
    hostsMenu(hosts, activeId, callbacks, daemon),
    ...(isMac ? [macWindowMenu()] : []),
  ];

  return Menu.buildFromTemplate(template);
}

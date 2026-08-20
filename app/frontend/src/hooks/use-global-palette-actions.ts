import { useMemo } from "react";
import { useMatches, useNavigate, useRouter } from "@tanstack/react-router";
import { useChromeDispatch, useChromeState } from "@/contexts/chrome-context";
import { useSettingsDialog } from "@/contexts/settings-dialog-context";
import { useUpdateNotification } from "@/contexts/session-context";
import { useUpdateCheck } from "@/hooks/use-update-check";
import { consumeUpdateWatchTarget } from "@/hooks/use-update-click";
import { useKeybindings } from "@/hooks/use-keybindings";
import { useShellServers } from "@/hooks/use-shell-servers";
import { useSidebarSectionVisible } from "@/hooks/use-sidebar-sections";
import { useToast } from "@/components/toast";
import type { PaletteAction } from "@/components/command-palette";
import { HELP_URL } from "@/components/global-chrome";
import { withShortcutHints } from "@/lib/keybindings";
import { focusSidebarCurrentRow } from "@/lib/sidebar-events";
import { HOST_MENU_OPEN_EVENT } from "@/lib/shell-strip";
import { buildNavActions, type NavMode } from "@/lib/palette-nav";
import { buildUpdateActions, buildMaintenanceActions, buildCheckActions } from "@/lib/palette-update";
import { buildVersionAction, displayVersion } from "@/lib/palette-version";
import { copyToClipboard } from "@/lib/clipboard";

/**
 * Layout-level global palette groups (260811-239r) — built ONCE for the single
 * `CommandPalette` mounted in `AppLayout`, dissolving the seven "duplicated
 * from AppShell (DD-8)" blocks `board-page.tsx` used to carry (nav, terminal
 * font trio, refresh, help, shortcuts-overlay, settings, update/check/
 * maintenance/version). Composes the existing shared `lib/palette-*` builders
 * and decorates the result with `withShortcutHints` so every registered action
 * renders its effective chord (the same decoration AppShell applies to its
 * route list).
 *
 * The nav mode comes from the same deepest-first route-param walk `RootTopBar`
 * does (app.tsx): a `name` param means board, a `window` param terminal,
 * anything else (server route, host, not-found) falls to `"server"`, which
 * emits only the history pair + `Go: Host` — the palette-bearing superset for
 * a route with no board/window context.
 *
 * `Help: Keyboard Shortcuts` (id `shortcuts-overlay`) is the Shortcuts-tab
 * deep-link TOGGLE (260818-bncw): closed → open on Shortcuts; open on
 * Shortcuts → close; open on another tab → switch to Shortcuts. The
 * `shortcuts-overlay` chord resolves this entry's body through the merged
 * list, so chord and palette can never drift.
 */
export function useGlobalPaletteActions(): PaletteAction[] {
  const matches = useMatches();
  const router = useRouter();
  const navigate = useNavigate();
  const { increaseTerminalFont, decreaseTerminalFont, resetTerminalFont, setSidebarOpen } = useChromeDispatch();
  const { sidebarOpen } = useChromeState();
  const {
    isOpen: settingsOpen,
    activeTab: settingsTab,
    openSettings,
    closeSettings,
  } = useSettingsDialog();
  const { addToast } = useToast();
  const { byAction: bindingByAction, host: bindingHost } = useKeybindings();

  // Walk matches deepest-first for route params — the same walk `RootTopBar`
  // does for its `mode` (param names are unique across the route tree, so
  // their presence determines the mode). The host route carries no params and
  // resolves to the `"server"` arm (history pair + `Go: Host` only).
  let serverParam: string | undefined;
  let windowParam: string | undefined;
  let boardParam: string | undefined;
  for (let i = matches.length - 1; i >= 0; i--) {
    const p = (matches[i]?.params ?? {}) as {
      server?: string;
      window?: string;
      name?: string;
    };
    if (serverParam === undefined && typeof p.server === "string") serverParam = p.server;
    if (windowParam === undefined && typeof p.window === "string") windowParam = p.window;
    if (boardParam === undefined && typeof p.name === "string") boardParam = p.name;
  }
  const navMode: NavMode =
    boardParam !== undefined ? "board" : windowParam !== undefined ? "terminal" : "server";
  const navServer = navMode === "terminal" ? (serverParam ?? "") : "";

  // Navigation actions (260714-uco1) — palette parity (Constitution V) for the
  // top-bar history arrows + hierarchy dropdown, from the pure
  // `buildNavActions` (lib/palette-nav.ts). In board mode `server` is "" —
  // board mode never emits `Go: tmux Server` (its gate is
  // `mode === "terminal" && server`), so `onTmuxServer` is an unreachable
  // no-op there.
  const navActions: PaletteAction[] = useMemo(
    () =>
      buildNavActions(navMode, navServer, {
        onBack: () => router.history.back(),
        onForward: () => router.history.forward(),
        onTmuxServer: () => navigate({ to: "/$server", params: { server: navServer } }),
        onHost: () => navigate({ to: "/" }),
      }),
    [navMode, navServer, router, navigate],
  );

  // Terminal font-size actions. No `shortcut` — Cmd +/- is deliberately not
  // intercepted (native browser zoom stays available); the palette + the
  // top-bar combo are the only font levers. Global setting → applies to every
  // live terminal (the board's panes are live terminals too).
  const terminalFontActions: PaletteAction[] = useMemo(
    () => [
      { id: "terminal-font-increase", label: "Increase terminal font", onSelect: increaseTerminalFont },
      { id: "terminal-font-decrease", label: "Decrease terminal font", onSelect: decreaseTerminalFont },
      { id: "terminal-font-reset", label: "Reset terminal font", onSelect: resetTerminalFont },
    ],
    [increaseTerminalFont, decreaseTerminalFont, resetTerminalFont],
  );

  // Ungated full-page reload — meaningful on every route (a keyboard-reachable
  // recovery affordance, constitution V; the board is the core degraded-relay
  // recovery scenario). Ex AppShell's `viewActions` / the board's
  // `refreshEntry` (both DD-8).
  const refreshEntry: PaletteAction = useMemo(
    () => ({
      id: "refresh-page",
      label: "View: Refresh Page",
      onSelect: () => window.location.reload(),
    }),
    [],
  );

  // Help docs — route-agnostic (the top-bar overflow menu's Help row shares
  // this URL, 260812-d1at).
  // Shares the HELP_URL exported from `global-chrome.tsx` so the URL can never
  // drift from the footer. Ex AppShell's `configActions` / the board's
  // `helpEntry` (both DD-8).
  const helpEntry: PaletteAction = useMemo(
    () => ({
      id: "help-documentation",
      label: "Help: Documentation",
      onSelect: () => window.open(HELP_URL, "_blank", "noopener,noreferrer"),
    }),
    [],
  );

  // The shortcuts surface (260730-g40a) — the settings dialog's Shortcuts tab
  // since 260818-bncw. The id doubles as the registry actionId, so the
  // effective-chord hint (⌘/ on macOS, ⇧Ctrl+/ on win/linux) renders on this
  // entry AND the chord resolves through this entry's `onSelect` (the
  // fromPalette convention). Per-binding TOGGLE semantics, refined for tabs:
  // closed → open on Shortcuts; open on Shortcuts → close; open on another
  // tab → switch to Shortcuts (never close — the user asked for shortcuts).
  const shortcutsEntry: PaletteAction = useMemo(
    () => ({
      id: "shortcuts-overlay",
      label: "Help: Keyboard Shortcuts",
      onSelect: () => {
        if (settingsOpen && settingsTab === "shortcuts") closeSettings();
        else openSettings("shortcuts");
      },
    }),
    [settingsOpen, settingsTab, openSettings, closeSettings],
  );

  // Settings dialog (o7q8): the palette is the primary keyboard path. The
  // dialog mounts once in AppLayout; `Settings: Open` is a PURE OPENER —
  // tab-less `openSettings()` lands General when closed and is a
  // tab-preserving no-op when open (260801-mqim: re-fire never closes, never
  // yanks the tab). `Settings: Appearance` (260818-bncw) is the per-tab
  // deep-link; the Shortcuts tab's entry is `Help: Keyboard Shortcuts` above
  // (one action per intent — no duplicate `Settings: Shortcuts`).
  const settingsEntry: PaletteAction = useMemo(
    () => ({ id: "settings-open", label: "Settings: Open", onSelect: () => openSettings() }),
    [openSettings],
  );
  const settingsAppearanceEntry: PaletteAction = useMemo(
    () => ({
      id: "settings-appearance",
      label: "Settings: Appearance",
      onSelect: () => openSettings("appearance"),
    }),
    [openSettings],
  );

  // Sidebar section-visibility toggles (iha5 R6) — the keyboard recovery path
  // for the section rail (Constitution V). Always available on every route:
  // flipping a persisted boolean is harmless where no sidebar is mounted, and
  // the next sidebar mount reflects it.
  const [boardsVisible, setBoardsVisible] = useSidebarSectionVisible("boards");
  const [serverVisible, setServerVisible] = useSidebarSectionVisible("server");
  const [paneVisible, setPaneVisible] = useSidebarSectionVisible("pane");
  const [hostVisible, setHostVisible] = useSidebarSectionVisible("host");
  const panelActions: PaletteAction[] = useMemo(
    () => [
      { id: "panel-toggle-boards", label: "Panel: Toggle Boards", onSelect: () => setBoardsVisible(!boardsVisible) },
      { id: "panel-toggle-server", label: "Panel: Toggle Server", onSelect: () => setServerVisible(!serverVisible) },
      { id: "panel-toggle-pane", label: "Panel: Toggle Pane", onSelect: () => setPaneVisible(!paneVisible) },
      { id: "panel-toggle-host", label: "Panel: Toggle Host", onSelect: () => setHostVisible(!hostVisible) },
    ],
    [boardsVisible, setBoardsVisible, serverVisible, setServerVisible, paneVisible, setPaneVisible, hostVisible, setHostVisible],
  );

  // Sidebar entries — layout-global because the sidebar exists on every
  // route Shell mounts. `Sidebar: Toggle` is the PLAIN visibility toggle;
  // its id IS the `sidebar-toggle` registry actionId, so `withShortcutHints`
  // decorates it with the effective ⌘B / ⇧Ctrl+B. `Sidebar: Focus` is the
  // show+focus arm: open if hidden, then focus the current row through the
  // `sidebar-events` registry seam (no sidebar mounted → the focuser slot is
  // empty and nothing happens). The hide+return arm stays chord-only — a
  // palette selection has already left the sidebar, so there is no sidebar
  // focus to return from.
  const sidebarActions: PaletteAction[] = useMemo(
    () => [
      {
        id: "sidebar-toggle",
        label: "Sidebar: Toggle",
        onSelect: () => setSidebarOpen(!sidebarOpen),
      },
      {
        id: "sidebar-focus",
        label: "Sidebar: Focus",
        onSelect: () => {
          if (!sidebarOpen) {
            setSidebarOpen(true);
            // The row focuser registers on the sidebar's mount — defer past
            // the commit (the chord handler's rAF precedent).
            requestAnimationFrame(() => focusSidebarCurrentRow());
            return;
          }
          focusSidebarCurrentRow();
        },
      },
    ],
    [sidebarOpen, setSidebarOpen],
  );

  // Host switcher (260820-nv0o) — opens the desktop-shell titlebar strip's
  // hosts menu through the HOST_MENU_OPEN_EVENT document seam (the strip
  // mounts in AppLayout, out of this hook's reach). The id IS the
  // `host-menu-open` registry actionId, so the effective ⇧⌘M/⇧Ctrl+M hint
  // renders on the row. Gated on a non-empty bridge list — the same
  // non-empty condition as the strip's own switcher trigger
  // (`stripSwitcherEnabled`); `useShellServers` resolves [] in a plain
  // browser and on older shells, so no separate isShell() pre-check.
  const shellServers = useShellServers();
  const hostMenuActions: PaletteAction[] = useMemo(
    () =>
      shellServers.length > 0
        ? [
            {
              id: "host-menu-open",
              label: "Host: Switcher",
              onSelect: () => document.dispatchEvent(new CustomEvent(HOST_MENU_OPEN_EVENT)),
            },
          ]
        : [],
    [shellServers],
  );

  // Update actions — keyboard-first parity (Constitution V) for the top-bar
  // update chip. Gated on a qualifying pending update (dev version suppressed).
  // Only the Dismiss action remains here (mirroring the chip's `✕` for
  // keyboard users; it deliberately IGNORES chip dismissal — the palette is
  // deliberate discovery). `run-kit: Update Now` (maintenanceActions) is THE
  // single update action, and version detail lives in the check-result toasts
  // + chip summary. Below `sm` the top-bar cluster is hidden, so the palette
  // is a phone user's only update surface — layout-level so boards get it too.
  const {
    qualifies: updateQualifies,
    tools: updateTools,
    dismissUpdate,
    daemonVersion,
    brew,
    forceUpdateNow,
    restartNow,
  } = useUpdateNotification();
  const updateActions: PaletteAction[] = useMemo(
    () => buildUpdateActions(updateQualifies, updateTools, dismissUpdate),
    [updateQualifies, updateTools, dismissUpdate],
  );

  // Check actions — the two on-demand check commands (`run-kit: Check for
  // Updates` / `… (incl. patches)`). One POST /api/updates/check, client-side
  // filtering, single result toast (shared flow: useUpdateCheck). Dev-gated
  // inside buildCheckActions, same pattern as the maintenance entries.
  const { runUpdateCheck } = useUpdateCheck();
  const checkActions: PaletteAction[] = useMemo(
    () =>
      buildCheckActions(
        daemonVersion,
        () => runUpdateCheck(false),
        () => runUpdateCheck(true),
      ),
    [daemonVersion, runUpdateCheck],
  );

  // Maintenance actions — palette-only force-update / restart (Constitution V).
  // Always available (independent of the qualifying-update gate): force update
  // reaches patch releases; restart bounces a wedged daemon without SSH. Both
  // fire immediately (no confirmation) — the SSE drop + boot/version reload IS
  // the feedback; failures land in ~/.rk logs and a toast. Dev-gated + (for
  // force) brew-gated inside buildMaintenanceActions.
  const maintenanceActions: PaletteAction[] = useMemo(
    () =>
      buildMaintenanceActions(
        brew,
        daemonVersion,
        () => {
          void forceUpdateNow()
            .then((result) => consumeUpdateWatchTarget(result, navigate, addToast))
            .catch((err: unknown) =>
              addToast(err instanceof Error ? err.message : "Update failed", "error"),
            );
        },
        () => {
          // Restart shares the identical watch affordance (no special-casing):
          // the post-restart reload discards the toast harmlessly.
          void restartNow()
            .then((result) => consumeUpdateWatchTarget(result, navigate, addToast))
            .catch((err: unknown) =>
              addToast(err instanceof Error ? err.message : "Restart failed", "error"),
            );
        },
      ),
    [brew, daemonVersion, forceUpdateNow, restartNow, addToast, navigate],
  );

  // Version palette entry — surfaces the running version and copies it on
  // select (useful for bug reports). Shown whenever `daemonVersion` is known,
  // INCLUDING the `dev` sentinel (pure display, unlike the dev-gated
  // update/restart actions above). What-you-see-is-what-you-copy: the copied
  // string is the displayed form. Success → info toast, failure → error toast.
  const versionActions: PaletteAction[] = useMemo(
    () =>
      buildVersionAction(daemonVersion, () => {
        if (!daemonVersion) return;
        void copyToClipboard(displayVersion(daemonVersion)).then((ok) => {
          addToast(ok ? "Version copied" : "Copy failed", ok ? "info" : "error");
        });
      }),
    [daemonVersion, addToast],
  );

  return useMemo(
    () =>
      // Every registered action with a palette entry renders its EFFECTIVE
      // combo as the `shortcut` hint (actionId doubles as the palette id),
      // formatted per platform and reflecting overrides; disabled bindings
      // (user-disabled or browser-reserved) render no hint (260730-g40a).
      withShortcutHints(
        [...navActions, ...terminalFontActions, refreshEntry, helpEntry, shortcutsEntry, settingsEntry, settingsAppearanceEntry, ...panelActions, ...sidebarActions, ...hostMenuActions, ...updateActions, ...checkActions, ...maintenanceActions, ...versionActions],
        bindingByAction,
        bindingHost.platform,
      ),
    [navActions, terminalFontActions, refreshEntry, helpEntry, shortcutsEntry, settingsEntry, settingsAppearanceEntry, panelActions, sidebarActions, hostMenuActions, updateActions, checkActions, maintenanceActions, versionActions, bindingByAction, bindingHost],
  );
}

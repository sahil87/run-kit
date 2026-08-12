import { useMemo } from "react";
import { useMatches, useNavigate, useRouter } from "@tanstack/react-router";
import { useChromeDispatch } from "@/contexts/chrome-context";
import { useSettingsDialog } from "@/contexts/settings-dialog-context";
import { useUpdateNotification } from "@/contexts/session-context";
import { useUpdateCheck } from "@/hooks/use-update-check";
import { useKeybindings } from "@/hooks/use-keybindings";
import { useToast } from "@/components/toast";
import type { PaletteAction } from "@/components/command-palette";
import { HELP_URL } from "@/components/global-chrome";
import { withShortcutHints } from "@/lib/keybindings";
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
 * `onToggleShortcutsOverlay` is the layout-lifted shortcuts-overlay toggle
 * (260730-g40a): the `Help: Keyboard Shortcuts` entry's `onSelect`, which the
 * `shortcuts-overlay` chord also resolves through (via the merged list).
 */
export function useGlobalPaletteActions({
  onToggleShortcutsOverlay,
}: {
  onToggleShortcutsOverlay: () => void;
}): PaletteAction[] {
  const matches = useMatches();
  const router = useRouter();
  const navigate = useNavigate();
  const { increaseTerminalFont, decreaseTerminalFont, resetTerminalFont } = useChromeDispatch();
  const { openSettings } = useSettingsDialog();
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

  // The registry cheatsheet overlay (260730-g40a). The id doubles as the
  // registry actionId, so the effective-chord hint (⌘/ on macOS, ⇧Ctrl+/ on
  // win/linux) renders on this entry AND the chord resolves through this
  // entry's `onSelect` (the fromPalette convention) — the overlay state itself
  // is layout-lifted (R12), toggled via the callback prop.
  const shortcutsEntry: PaletteAction = useMemo(
    () => ({
      id: "shortcuts-overlay",
      label: "Help: Keyboard Shortcuts",
      onSelect: onToggleShortcutsOverlay,
    }),
    [onToggleShortcutsOverlay],
  );

  // Settings dialog (o7q8): the palette is the primary keyboard path (no
  // dedicated shortcut — Cmd+, is browser-reserved). The dialog itself mounts
  // once in AppLayout; this is just the one-line trigger (previously
  // duplicated into the board palette, DD-8).
  const settingsEntry: PaletteAction = useMemo(
    () => ({ id: "settings-open", label: "Settings: Open", onSelect: openSettings }),
    [openSettings],
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
          void forceUpdateNow().catch((err: unknown) =>
            addToast(err instanceof Error ? err.message : "Update failed", "error"),
          );
        },
        () => {
          void restartNow().catch((err: unknown) =>
            addToast(err instanceof Error ? err.message : "Restart failed", "error"),
          );
        },
      ),
    [brew, daemonVersion, forceUpdateNow, restartNow, addToast],
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
        [...navActions, ...terminalFontActions, refreshEntry, helpEntry, shortcutsEntry, settingsEntry, ...updateActions, ...checkActions, ...maintenanceActions, ...versionActions],
        bindingByAction,
        bindingHost.platform,
      ),
    [navActions, terminalFontActions, refreshEntry, helpEntry, shortcutsEntry, settingsEntry, updateActions, checkActions, maintenanceActions, versionActions, bindingByAction, bindingHost],
  );
}

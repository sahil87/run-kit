/**
 * Update-check pure logic — `rk desktop status` stdout parsing, availability
 * derivation, the check-cadence throttle predicate, and the Restart-to-Update
 * menu item-group model.
 *
 * Deliberately electron-free (the `hosts.ts` / `window-open.ts` /
 * `local-daemon.ts` precedent) so the sibling `update-check.test.ts` covers it
 * under plain `node --test`. The impure glue — spawning `rk desktop status`,
 * caching the result, rebuilding the menu — lives in `main.ts`; the menus
 * render `updateMenuItems`' model in `menu.ts`.
 *
 * Contract: `rk desktop status` prints DATA on stdout (Toolkit Principle 9 —
 * stable, machine-consumable lines):
 *
 *   Installed: v3.12.7          (or "Installed: not installed")
 *   Latest:    v3.13.0
 *   Update available — run 'rk desktop update'.   (or "Up to date.")
 *
 * Parsing keys on the `Installed:`/`Latest:` v-prefixed version lines and the
 * `Update available` marker prefix. Anything unrecognizable derives to "no
 * update" — absence states are silent by design (no menu item, no error).
 */

/** Parsed shape of `rk desktop status` stdout. */
export interface DesktopStatusReport {
  /** From `Installed: vX`; null for "not installed" or an absent/odd line. */
  installedVersion: string | null;
  /** From `Latest:    vY`; null when absent or unparseable. */
  latestVersion: string | null;
  /** The `Update available` marker line was present. */
  updateAvailable: boolean;
}

/**
 * The `v` prefix is required: the CLI always prints `v%s` for a real version,
 * and requiring it keeps "Installed: not installed" from parsing as one.
 */
const INSTALLED_LINE = /^Installed:\s+v(\S+)\s*$/m;
const LATEST_LINE = /^Latest:\s+v(\S+)\s*$/m;
/** Marker prefix only — the trailing hint text is not load-bearing. */
const UPDATE_AVAILABLE_MARKER = /^Update available\b/m;

/** Parse `rk desktop status` stdout. Never throws; unmatched fields are null/false. */
export function parseDesktopStatus(stdout: string): DesktopStatusReport {
  return {
    installedVersion: INSTALLED_LINE.exec(stdout)?.[1] ?? null,
    latestVersion: LATEST_LINE.exec(stdout)?.[1] ?? null,
    updateAvailable: UPDATE_AVAILABLE_MARKER.test(stdout),
  };
}

/**
 * Derive the available update from status stdout: the latest version string
 * (bare, no leading "v") when the marker is present AND the `Latest:` line
 * parsed — the menu label needs the version, so a marker without one derives
 * to null (silent) rather than a broken label. Everything else (up to date,
 * not installed, garbage) is null.
 */
export function availableUpdateVersion(stdout: string): string | null {
  const report = parseDesktopStatus(stdout);
  return report.updateAvailable ? report.latestVersion : null;
}

/**
 * Check cadence: at most one `rk desktop status` attempt per hour — the
 * command round-trips the GitHub releases API (unauthenticated rate limits),
 * so checks ride natural events (startup, window focus) through this throttle
 * instead of a perpetual timer (the menu-cache pattern).
 */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Whether a check attempt is due. `lastCheckedAt` is the epoch-ms timestamp
 * of the previous ATTEMPT (failures consume the window too — rate limits
 * count requests, not successes); null means never checked.
 */
export function isUpdateCheckDue(lastCheckedAt: number | null, now: number): boolean {
  if (lastCheckedAt === null) return true;
  // A clock that moved backwards (now earlier than the recorded attempt) is
  // due — a negative delta would otherwise suppress checks until the clock
  // re-passes the stale timestamp.
  if (now < lastCheckedAt) return true;
  return now - lastCheckedAt >= UPDATE_CHECK_INTERVAL_MS;
}

/**
 * Menu-relevant desktop-update state (cached in main, refreshed by the
 * `rk desktop status` check on startup/focus). `null` hides the
 * Restart-to-Update item entirely — win32, rk missing, status failure, or up
 * to date.
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

/**
 * One row of the update item group — the electron-free model both platform
 * menus render (the daemonMenuModel pattern: menu.ts imports electron, so the
 * item contract can only run under `node --test` from here).
 */
export type UpdateMenuItemModel =
  | { kind: "item"; label: string; enabled: boolean }
  | { kind: "separator" };

/**
 * The Restart-to-Update group: an accelerator-less item followed by a
 * separator, or nothing when no update is cached. Rendered directly above
 * Quit on macOS (App menu) and Linux (File menu); on win32 the cache is
 * always null (`rk desktop` does not exist there), so no item ever renders.
 */
export function updateMenuItems(update: UpdateMenuInfo | null): UpdateMenuItemModel[] {
  if (update === null) return [];
  const item: UpdateMenuItemModel = update.updating
    ? { kind: "item", label: UPDATING_LABEL, enabled: false }
    : { kind: "item", label: restartToUpdateLabel(update.latestVersion), enabled: true };
  return [item, { kind: "separator" }];
}

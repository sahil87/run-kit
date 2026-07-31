import { contrastRatio } from "@/themes";
import type { ShellServer } from "@/lib/shell";

/**
 * Pure helpers for the desktop shell's titlebar strip (the 28px accent band
 * `ShellTitlebarStrip` draws above the top bar when running inside the
 * Electron viewer shell). Extracted so the label/inset/color rules are
 * unit-testable without mounting the component.
 */

/** Strip height — mirrors the shell's `STRIP_HEIGHT_PX` (the win/linux
 *  window-controls overlay is sized to the same value shell-side). */
export const SHELL_STRIP_HEIGHT_PX = 28;

/** The <html> marker class keying the shell's version-skew fallback CSS off
 *  (`html:not(.rk-shell-strip)` shell-side) while the real strip is mounted. */
export const SHELL_STRIP_MARKER_CLASS = "rk-shell-strip";

const STRIP_TEXT_LIGHT = "#e5e7eb";
const STRIP_TEXT_DARK = "#111827";

/**
 * Contrast-derived label color for a strip background: whichever of the two
 * standard text hexes reads better (the `themes.ts` contrast helpers — the
 * same WCAG ratio the border guard uses).
 */
export function stripLabelColor(bgHex: string): string {
  return contrastRatio(bgHex, STRIP_TEXT_LIGHT) >= contrastRatio(bgHex, STRIP_TEXT_DARK)
    ? STRIP_TEXT_LIGHT
    : STRIP_TEXT_DARK;
}

/**
 * Horizontal insets keeping the centered label clear of the OS window
 * controls compositing over the strip: a fixed symmetric ~80px on darwin
 * (traffic lights left; symmetric so the label stays visually centered),
 * `titlebar-area-*` env expressions elsewhere (the Windows/Linux
 * window-controls overlay reserves the right end; the env vars fall back to
 * 0/full where WCO is absent, degrading to no inset).
 */
export function stripInsets(platform: string): { left: string; right: string } {
  if (platform === "darwin") return { left: "80px", right: "80px" };
  return {
    left: "env(titlebar-area-x, 0px)",
    right: "calc(100% - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100%))",
  };
}

/**
 * The active shell-registered host's display name, or null when the list is
 * unavailable (older shell, denial) or carries no active entry — callers fall
 * back to `location.hostname`.
 */
export function activeShellHostName(servers: ShellServer[] | null): string | null {
  const active = servers?.find((s) => s.active);
  return active ? active.name : null;
}

/** Accelerator-hint cap — mirrors the native Hosts menu's
 *  `MAX_SWITCHER_ACCELERATORS` (hosts beyond the ninth get no binding, so
 *  they get no hint either). */
export const MAX_SHELL_SWITCHER_HINTS = 9;

/**
 * Trailing accelerator hint for the host at `index` (list order — the native
 * Hosts menu binds in the same order): `⌥⌘{n}` on darwin, `⇧Ctrl+{n}`
 * elsewhere (the win/linux shell tier), `null` past the 9-cap.
 */
export function hostAcceleratorHint(platform: string, index: number): string | null {
  if (index < 0 || index >= MAX_SHELL_SWITCHER_HINTS) return null;
  const n = index + 1;
  return platform === "darwin" ? `⌥⌘${n}` : `⇧Ctrl+${n}`;
}

/** One row of the strip's host-switcher dropdown. */
export interface ShellHostMenuRow {
  id: string;
  name: string;
  /** The entry's origin — host display names are not unique (the shell's
   *  store never dedupes), so the dimmed origin disambiguates. */
  origin: string;
  active: boolean;
  /** Accelerator hint mirroring the native Hosts menu, or null past the cap. */
  hint: string | null;
}

/** The entry's origin for display: the store persists origins already, so
 *  this is normally identity; a malformed url falls back to the raw string. */
function hostOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/**
 * Menu rows for the host-switcher dropdown, derived from the bridge's
 * `servers:list` projection (`{id, name, url, active}` — no bridge change
 * needed). List order is preserved (it is the native menu's binding order).
 */
export function shellHostMenuRows(servers: ShellServer[], platform: string): ShellHostMenuRow[] {
  return servers.map((s, i) => ({
    id: s.id,
    name: s.name,
    origin: hostOrigin(s.url),
    active: s.active,
    hint: hostAcceleratorHint(platform, i),
  }));
}

/**
 * Gate predicate for the dropdown affordance: interactive only when the
 * bridge answered a non-empty host list (the command palette's shell-switch
 * precedent — gate on the `servers` group answering, not on `isShell()`).
 * An older shell without the group keeps the static label.
 */
export function stripSwitcherEnabled(servers: ShellServer[] | null): servers is ShellServer[] {
  return servers !== null && servers.length > 0;
}

/**
 * Shared app-global chrome definitions (260724-6j1v). The theme/help chrome
 * moved from the top bar to the sidebar footer, and notifications folded into
 * the settings dialog — the URLs, the theme-cycle step, and the icon SVGs live
 * here as SINGLE definitions so the footer, the settings dialog, and the
 * command palettes (`app.tsx`, `board-page.tsx`) can never drift.
 */

/** Help — external docs/landing page. Opens in a new tab. Shared by the
 *  sidebar-footer Help anchor and the command-palette "Help: Documentation"
 *  actions (app + board palettes). */
export const HELP_URL = "https://shll.ai/run-kit";

/** Notifications help page (rendered by GitHub). Opens in a new tab from the
 *  settings dialog's Notifications row — the canonical "it says sent but
 *  nothing shows" guide. */
export const NOTIFICATIONS_HELP_URL =
  "https://github.com/sahil87/run-kit/blob/main/docs/site/notifications.md";

/**
 * Shared theme-cycle step: system → light → dark → system. One definition so
 * every cycle surface (the sidebar-footer theme button today) steps
 * IDENTICALLY and can't drift. `mode` is the current effective mode.
 */
export function cycleTheme(
  mode: "system" | "light" | "dark",
  themeLight: string,
  themeDark: string,
  setTheme: (preference: string) => void,
) {
  if (mode === "system") setTheme(themeLight);
  else if (mode === "light") setTheme(themeDark);
  else setTheme("system");
}

/** The three theme-mode glyphs (monitor / sun / moon), keyed by the effective
 *  mode — the same SVGs the retired top-bar ThemeToggle carried. */
export function ThemeModeIcon({ mode }: { mode: "system" | "light" | "dark" }) {
  if (mode === "system") {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <rect x="1" y="2" width="14" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <line x1="5" y1="14" x2="11" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="8" y1="11" x2="8" y2="14" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }
  if (mode === "light") {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <circle cx="8" cy="8" r="3" />
        <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <line x1="8" y1="1" x2="8" y2="2.5" />
          <line x1="8" y1="13.5" x2="8" y2="15" />
          <line x1="1" y1="8" x2="2.5" y2="8" />
          <line x1="13.5" y1="8" x2="15" y2="8" />
          <line x1="3.05" y1="3.05" x2="4.11" y2="4.11" />
          <line x1="11.89" y1="11.89" x2="12.95" y2="12.95" />
          <line x1="3.05" y1="12.95" x2="4.11" y2="11.89" />
          <line x1="11.89" y1="4.11" x2="12.95" y2="3.05" />
        </g>
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M6 2a6 6 0 1 0 8 8c-3.3 0-6-2.7-6-6a6 6 0 0 0-2-2z" />
    </svg>
  );
}

/** Question-mark help glyph — the retired top-bar HelpLink's SVG. */
export function HelpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M5.75 6a2.25 2.25 0 1 1 3.2 2.04c-.62.29-.95.79-.95 1.35v.36"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="8" cy="12.25" r="0.9" fill="currentColor" />
    </svg>
  );
}

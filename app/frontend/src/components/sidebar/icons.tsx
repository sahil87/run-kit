/** Shared sidebar icons. */

/** Icon column treatment shared by the sidebar info panels (Pane, Host):
 *  brighter token, bold weight, +2px size. leading-none keeps the taller
 *  glyph inside the row's 16px line box (no row-height change). */
export const ICON_CLASS = "text-accent-bright font-bold text-[14px] leading-none";

/** Small palette icon for color-picker triggers — an artist's palette
 *  silhouette with four paint blobs. Line-art to match the sidebar's other
 *  line icons (e.g. the window-row pin); replaces the former U+25A0 glyph,
 *  which read as a media "stop" button rather than a color control. Blobs are
 *  pure fills (stroke="none") so they read as dots, not stroked rings.
 *
 *  Shared by the window-row, session-row, and server-panel color triggers so
 *  the affordance is identical everywhere. `size` defaults to 13px (sidebar
 *  rows); the compact server tile passes a smaller size.
 *
 *  strokeWidth is 2 (not the lucide-default 1.7) so the *effective* stroke
 *  weight matches the window-row pin: 2 ÷ 24-viewBox × 13px ≈ 1.08px vs the
 *  pin's 1.5 ÷ 16 × 12 ≈ 1.125px. A thinner stroke reads as a lighter color
 *  even with the same `currentColor` token, so weight parity is what makes the
 *  icons look like the same color in a cluster. */
export function PaletteIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="13.5" cy="6.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="10.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="7.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="6.5" cy="12.5" r="1.4" fill="currentColor" stroke="none" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.83-.44-1.12-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.56-2.5 5.56-5.55C21.96 6.01 17.46 2 12 2z" />
    </svg>
  );
}

/** Small gear icon for the sidebar-footer settings trigger — a lucide
 *  `settings` silhouette (cog outline + hub dot). Line-art matching the
 *  sibling icons' idiom (`currentColor` stroke, `strokeWidth={2}`,
 *  `aria-hidden`, 24-unit viewBox, 13px default size). (o7q8) */
export function GearIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Small robot-head icon for the session-row spawn-agent trigger — a lucide
 *  `bot` silhouette (antenna + rounded head with two eye dots and a side port).
 *  Line-art matching the sibling `PaletteIcon` idiom (`currentColor` stroke,
 *  `strokeWidth={2}`, `aria-hidden`, same 24-unit viewBox + 13px default size)
 *  so it reads as the same weight/color inside the row's hover-revealed icon
 *  cluster. Sits immediately left of the `+` create-window button. */
export function BotIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      // viewBox y-shifted +1.5: the antenna is top weight, so the HEAD (the
      // perceived body, spanning y=8..20, center 14) sat optically below the
      // palette circle's center (~12). Shifting the view down moves the drawing
      // up ~0.8px at 13px without changing the rendered box (260724-2bmy).
      viewBox="0 1.5 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* antenna */}
      <path d="M12 8V4" />
      <circle cx="12" cy="3" r="1" fill="currentColor" stroke="none" />
      {/* head */}
      <rect x="4" y="8" width="16" height="12" rx="2" />
      {/* side ports */}
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      {/* eyes */}
      <circle cx="9" cy="13.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Small plus icon for the session-row create-window trigger — a lucide `plus`
 *  cross. Replaces the former `+` text glyph so the row's icon cluster shares
 *  ONE stroke system (equal ink width/weight is what makes the icons read as
 *  equidistant — mixed text glyphs beside stroke SVGs looked uneven even at
 *  even center gaps). Same idiom as the siblings: `currentColor` stroke,
 *  `strokeWidth={2}`, `aria-hidden`, 24-unit viewBox, 13px default size.
 *  (260724-2bmy) */
export function PlusIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

/** Small close/kill icon for the session- and window-row kill triggers — a
 *  lucide `x` cross. Replaces the former U+2715 text glyph for the same
 *  one-stroke-system reason as `PlusIcon`. (260724-2bmy) */
export function CloseIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

import type { ReactNode } from "react";

/**
 * Shared inset title bar for the sidebar row popups (window flyout card +
 * session/server identity tips) — the one chrome carrier of the popup grammar
 * "title bar = identity, body = facts", so the three surfaces cannot drift.
 * Presentational only: no floating-ui logic, no state.
 *
 * The bar is FULL-BLEED: its negative margins cancel the host card's
 * `px-2 py-1.5` padding so the inset fill spans the card's full width, with a
 * bottom border and top corners rounded into the card radius. Literal words
 * render secondary, handles/identity primary — the caller composes that split
 * via `<Secondary>`/plain spans.
 */

/** Vertical extent of the bar inside its card (py-1 ×2 + text-xs line + the
 *  1px bottom border). The popups' notches compare their resolved y-offset
 *  against this to pick the inset fill when they land on the band. */
export const POPUP_TITLE_BAR_HEIGHT_PX = 25;

/** Notch fill by band: the arrow middleware's resolved y (notch center, from
 *  the card's top edge) inside the title-bar band takes the inset fill so
 *  notch + bar read as one shape; below the band (or before the middleware
 *  resolves) it keeps the card-surface fill. A pure seam so the decision is
 *  testable under jsdom (no layout → the middleware's y is unresolvable). */
export function notchFill(arrowY: number | null | undefined): string {
  return arrowY != null && arrowY < POPUP_TITLE_BAR_HEIGHT_PX
    ? "var(--color-bg-inset)"
    : "var(--color-bg-primary)";
}

/** Secondary-text literal segment (the `Window`/`pane`/`· N panes` words). */
export function PopupTitleBarSecondary({ children }: { children: ReactNode }) {
  return <span className="text-text-secondary">{children}</span>;
}

export function PopupTitleBar({
  children,
  right,
}: {
  /** Title content: identity text with the secondary/primary split composed
   *  by the caller (never truncated — the title IS the identity). */
  children: ReactNode;
  /** Optional right-edge cluster (the window card's fork/docs icons). */
  right?: ReactNode;
}) {
  return (
    <div
      data-testid="popup-title-bar"
      className="-mx-2 -mt-1.5 mb-0.5 flex items-center gap-3 rounded-t-[5px] border-b border-border bg-bg-inset px-2 py-1"
    >
      {/* min-w-0 + break-words: identity is never truncated, so a long name
          wraps inside the card instead of painting past its edge; the right
          cluster stays rigid (shrink-0) and aligned. */}
      <span className="min-w-0 break-words text-text-primary">{children}</span>
      {right && <span className="ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap">{right}</span>}
    </div>
  );
}

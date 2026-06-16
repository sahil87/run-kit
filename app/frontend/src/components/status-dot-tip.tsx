import { useState, type ReactNode } from "react";
import {
  useFloating,
  offset,
  flip,
  shift,
  useHover,
  useFocus,
  useDismiss,
  useInteractions,
  FloatingPortal,
  safePolygon,
  autoUpdate,
} from "@floating-ui/react";
import { dotLabel } from "@/components/status-dot-label";
import type { StatusDotState } from "@/components/pr-status-line";
import type { WindowInfo } from "@/types";

/**
 * Status-dot docs page (rendered by GitHub). Opens in a new tab from the
 * hover-card's docs icon — the canonical "what does this dot mean" reference.
 * docs/site is NOT served by the backend, so we link the GitHub blob (no
 * anchor → lands at the top of the doc), matching the convention the only
 * other in-app docs link uses (top-bar.tsx NOTIFICATIONS_HELP_URL).
 */
const STATUS_DOT_DOCS_URL =
  "https://github.com/sahil87/run-kit/blob/main/docs/site/status-dot.md";

/** A single interactive link rendered inside the hover-card. */
export type DotLink = { label: string; href: string; testid: string };

/** Resolved hover-card content for a window+state. */
export type DotTipContent = { label: string; links: DotLink[] };

/**
 * Pure content resolver: maps a window + its derived `StatusDotState` to the
 * hover-card's text + interactive links. The label REUSES `dotLabel()` so the
 * card text is the single source of truth shared with the dot's `aria-label`.
 *
 * Only PR-phase dots that actually carry a `prUrl` get a link ("Open PR #N").
 * Fab-phase and tmux-fallback dots get text only. The docs-link icon is NOT in
 * `links[]` — it is a fixed element the card always renders (constant href), so
 * it does not flow through per-state logic.
 */
export function dotTipContent(win: WindowInfo, state: StatusDotState): DotTipContent {
  const label = dotLabel(win, state);
  const links: DotLink[] = [];
  if (state.phase === "pr" && win.prUrl) {
    links.push({
      label: `Open PR #${win.prNumber}`,
      href: win.prUrl,
      testid: "dot-tip-pr-link",
    });
  }
  return { label, links };
}

/** "Open in new window" glyph (Nerd Font external-link), purely decorative. */
const DOCS_GLYPH = "";

/**
 * Shared link styling for the card's interactive rows. Click is stopped from
 * bubbling so activating a link never selects/navigates the underlying window
 * row (the dot sits inside a clickable sidebar row) — mirrors the proven
 * PrStatusLine link pattern (pr-status-line.tsx).
 */
const LINK_CLASS =
  "text-text-secondary hover:text-text-primary hover:underline whitespace-nowrap coarse:py-1";

type StatusDotTipProps = {
  win: WindowInfo;
  state: StatusDotState;
  /**
   * Renders the dot itself. Receives the floating reference setter and the
   * reference interaction props (which carry hover/focus/aria wiring) to spread
   * onto the dot element — keeping the dot the floating anchor while StatusDot
   * owns the dot's shape/color markup.
   */
  renderDot: (
    setReference: (node: HTMLElement | null) => void,
    referenceProps: Record<string, unknown>,
  ) => ReactNode;
};

/**
 * Custom hover-card wrapping a `StatusDot`. Replaces the native HTML `title`
 * tooltip: a headless `@floating-ui/react` floating element gives full styling
 * control (terminal aesthetic), portals out of the sidebar's `overflow:hidden`
 * clip, flips/shifts at viewport edges, and uses a `safePolygon` bridge so the
 * pointer can travel dot → card to click a link.
 *
 * Opens on hover (snappy delay) AND on keyboard focus (Constitution V —
 * keyboard-first), dismisses on Escape / blur / pointer-leave. Always shows the
 * dot's label text + a docs-link icon; PR-phase dots additionally show an
 * "Open PR #N" link (from `dotTipContent`).
 */
export function StatusDotTip({ win, state, renderDot }: StatusDotTipProps) {
  const [open, setOpen] = useState(false);
  const { label, links } = dotTipContent(win, state);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "top",
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const hover = useHover(context, {
    delay: { open: 150, close: 100 },
    handleClose: safePolygon(),
  });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  // No `useRole({ role: "tooltip" })`: the W3C tooltip pattern requires a
  // tooltip to contain NO interactive content, but this card holds real `<a>`
  // links (PR + docs). Advertising `role="tooltip"` would (a) lie to AT about
  // there being nothing actionable and (b) wire a misleading `aria-describedby`
  // from the dot to a "tooltip" that is actually a hover-card. The dot already
  // carries its own accessible name via `aria-label`, and the links are
  // real Tab-reachable controls — so we add no extra ARIA role here.
  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    dismiss,
  ]);

  return (
    <>
      {renderDot(refs.setReference, getReferenceProps())}
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            // Don't let clicks inside the card bubble to the underlying row.
            onClick={(e) => e.stopPropagation()}
            data-testid="status-dot-tip"
            className="z-50 flex flex-col gap-1 bg-bg-primary border border-border rounded-md shadow-lg px-2 py-1.5 text-xs font-mono w-max max-w-xs"
          >
            <span className="text-text-primary whitespace-nowrap">{label}</span>
            {links.map((link) => (
              <a
                key={link.testid}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className={LINK_CLASS}
                data-testid={link.testid}
              >
                {link.label}
              </a>
            ))}
            <a
              href={STATUS_DOT_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={`${LINK_CLASS} inline-flex items-center gap-1`}
              data-testid="dot-tip-docs-link"
            >
              <span aria-hidden="true">{DOCS_GLYPH}</span> What do dots mean?
            </a>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

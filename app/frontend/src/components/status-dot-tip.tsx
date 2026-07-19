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
import type { StatusDotState } from "@/components/pr-status-model";
import { formatDuration } from "@/lib/format";
import { useNow } from "@/hooks/use-now";
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

/** Resolved hover-card content for a window+state. `agent` is the L1 agent
 *  line (`agent: waiting 3m` / `active` / `idle 12m`), null when no agent.
 *  `fetchedAtEpoch` is the PR-status fetch time as epoch SECONDS (parsed from
 *  `prFetchedAt`), null when absent/unparseable — the card renders a relative
 *  "checked Xs ago" line from it (formatted in the component so it ticks). */
export type DotTipContent = {
  label: string;
  agent: string | null;
  links: DotLink[];
  fetchedAtEpoch: number | null;
};

/**
 * Agent line for the hover card (status-pyramid.md § Attention Propagation —
 * "StatusDotTip gains an agent line on every tier"). Post-Row-Minimalism the
 * tip is the recovery path for the removed row stage word + durations, so it
 * carries the agent state on EVERY tier (fab, PR, warm, or floor). Composes
 * `agent: {state} {duration}` — the rk-computed `agentIdleDuration` is present
 * for `waiting`/`idle` and empty for `active`. Null when no `agentState`.
 */
function agentLine(win: WindowInfo): string | null {
  if (!win.agentState) return null;
  const dur = win.agentIdleDuration ? ` ${win.agentIdleDuration}` : "";
  return `agent: ${win.agentState}${dur}`;
}

/**
 * Pure content resolver: maps a window + its derived `StatusDotState` to the
 * hover-card's text + agent line + interactive links. The label REUSES
 * `dotLabel()` so the card text is the single source of truth shared with the
 * dot's `aria-label`.
 *
 * Any window that carries a `prUrl` gets an "Open PR #N" link — on ANY tier,
 * including the gray floor. The PR-dot OWNERSHIP is family-gated (D1: only fab
 * or fresh-agent windows let a PR own the dot's hue), but the derived PR itself
 * is UNIVERSAL (Principle X / decision-table row 10) — the tip surfaces it
 * wherever it exists, exactly like the PANE panel's L3 register, so a floor pane
 * on a branch with an open PR still offers the link. The agent line is added on
 * every tier when an `agentState` exists. The docs-link icon is NOT in `links[]`
 * — it is a fixed element the card always renders (constant href), so it does
 * not flow through per-state logic.
 */
export function dotTipContent(win: WindowInfo, state: StatusDotState): DotTipContent {
  const label = dotLabel(win, state);
  const agent = agentLine(win);
  const links: DotLink[] = [];
  if (win.prUrl) {
    // `prUrl` and `prNumber` are independently optional on WindowInfo, so a
    // window can carry a URL without a number — omit the `#N` rather than
    // render a user-visible "Open PR #undefined".
    links.push({
      label: win.prNumber ? `Open PR #${win.prNumber}` : "Open PR",
      href: win.prUrl,
      testid: "dot-tip-pr-link",
    });
  }
  // Parse the PR-status fetch time to epoch seconds; null when absent or
  // unparseable (Date.parse → NaN) so the card omits the freshness line rather
  // than rendering "checked NaNs ago".
  const parsed = win.prFetchedAt ? Date.parse(win.prFetchedAt) : NaN;
  const fetchedAtEpoch = Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
  return { label, agent, links, fetchedAtEpoch };
}

/**
 * Circled-"i" info glyph for the docs affordance — an inline SVG (matching the
 * codebase's hand-built SVG icons, e.g. window-row's pin) rather than a Nerd
 * Font glyph, so it renders crisply at any size, themes via `currentColor`, and
 * doesn't depend on the user's terminal font being patched. "info" intent reads
 * as "know more" without competing with the "Open PR" external-link affordance.
 */
function InfoIcon() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      className="shrink-0"
    >
      <circle cx="8" cy="8" r="6.5" />
      <line x1="8" y1="7.25" x2="8" y2="11" strokeLinecap="round" />
      <circle cx="8" cy="4.75" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Shared link styling for the card's interactive rows. Click is stopped from
 * bubbling so activating a link never selects/navigates the underlying window
 * row (the dot sits inside a clickable sidebar row).
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
 * Freshness line ("checked Xs ago"), rendered as its OWN component so its live
 * `useNow()` clock is scoped to the leaf that displays it — per use-now.ts, the
 * per-second tick must stay at the leaf. This component is only mounted inside
 * the open hover-card (see `{open && …}` below), so the 1/s re-render fires only
 * while the card is open — the dot wrapper itself never ticks. Returns null when
 * there is no fetch timestamp (the line is omitted, no "checked NaNs ago").
 */
function FreshnessLine({ fetchedAtEpoch }: { fetchedAtEpoch: number | null }) {
  // Live clock so the relative time ticks while the card is open. `useNow` is a
  // local display clock (not data polling); reuses the same Ns/Nm/Nh convention
  // via formatDuration.
  const nowSeconds = useNow();
  if (fetchedAtEpoch === null) return null;
  return (
    <span className="text-text-secondary whitespace-nowrap" data-testid="dot-tip-checked">
      {`checked ${formatDuration(nowSeconds - fetchedAtEpoch)} ago`}
    </span>
  );
}

/**
 * Custom hover-card wrapping a `StatusDot`. Replaces the native HTML `title`
 * tooltip: a headless `@floating-ui/react` floating element gives full styling
 * control (terminal aesthetic), portals out of the sidebar's `overflow:hidden`
 * clip, flips/shifts at viewport edges, and uses a `safePolygon` bridge so the
 * pointer can travel dot → card to click a link.
 *
 * Opens on hover (snappy delay) AND on keyboard focus (Constitution V —
 * keyboard-first), dismisses on Escape / blur / pointer-leave. Always shows the
 * dot's label text + a docs-link icon; any window with a `prUrl` additionally
 * shows an "Open PR #N" link (from `dotTipContent`, universal derivation).
 */
export function StatusDotTip({ win, state, renderDot }: StatusDotTipProps) {
  const [open, setOpen] = useState(false);
  const { label, agent, links, fetchedAtEpoch } = dotTipContent(win, state);

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
            {/* Label row: status text on the left, a quiet circled-(i) docs
                affordance pinned top-right. No visible copy — the icon's
                "info / know more" convention plus its aria-label/title carry
                the meaning, keeping the card terse and matching its register. */}
            <div className="flex items-start gap-3">
              <span className="text-text-primary whitespace-nowrap">{label}</span>
              <a
                href={STATUS_DOT_DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="ml-auto mt-px text-text-secondary hover:text-text-primary coarse:p-1"
                aria-label="What do status dots mean? (opens docs)"
                title="What do status dots mean?"
                data-testid="dot-tip-docs-link"
              >
                <InfoIcon />
              </a>
            </div>
            {/* Agent line (L1) — present on every tier when an agent exists.
                Post-Row-Minimalism recovery path for the removed row durations. */}
            {agent && (
              <span className="text-text-secondary whitespace-nowrap" data-testid="dot-tip-agent">
                {agent}
              </span>
            )}
            {/* Freshness line — ambient "PR checked Xs ago", present only on
                windows with a joined PR status (prFetchedAt). After a manual
                refresh the timestamp visibly resets (the trust signal without a
                click). Mounted only here inside the open card so its live clock
                (useNow) is leaf-scoped — the dot wrapper never ticks. */}
            <FreshnessLine fetchedAtEpoch={fetchedAtEpoch} />
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
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

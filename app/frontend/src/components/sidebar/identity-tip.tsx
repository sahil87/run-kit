import { useCallback, useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode, type RefObject } from "react";
import {
  useFloating,
  offset,
  flip,
  shift,
  arrow,
  FloatingArrow,
  useHover,
  useFocus,
  useDismiss,
  useInteractions,
  FloatingPortal,
  autoUpdate,
} from "@floating-ui/react";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer";
import { PopupTitleBar, notchFill } from "./popup-title-bar";

/**
 * Slim identity hover-card shared by the session row and server tile — the
 * tier-1-weight half of the popup grammar: a `PopupTitleBar` (identity) plus
 * ONE plain-text body line (facts). No icons, no links, no registers, no
 * interactive content (the tier boundary lives in the body, not the chrome).
 *
 * Deliberate isolation: the card uses a PLAIN open delay and joins neither
 * the sidebar's `TipGroup` nor the window flyout's module-scoped warm window —
 * mixing tier-1/tier-2 warmth strobes (row-flyout-card.tsx header).
 *
 * Touch never opens it: hover is `mouseOnly` and the whole surface is
 * suppressed under `pointer: coarse` (the Tip idiom — the row's own label is
 * the touch surface).
 */

/** Plain hover open delay — no warm window (see header). */
export const IDENTITY_TIP_OPEN_DELAY_MS = 300;

export type IdentityTip = {
  /** Floating reference setter — attach to the row root element. */
  setReference: (node: HTMLElement | null) => void;
  /** Reference interaction props, chaining any handlers the row already owns
   *  (floating-ui merges them) — call it with the row's own props. */
  getReferenceProps: (userProps?: HTMLAttributes<HTMLElement>) => Record<string, unknown>;
  open: boolean;
  /** Imperative close — the row calls this on drag start. */
  close: () => void;
  /** Internal wiring for IdentityTipCard. */
  _floating: {
    setFloating: (node: HTMLElement | null) => void;
    floatingStyles: CSSProperties;
    getFloatingProps: (userProps?: HTMLAttributes<HTMLElement>) => Record<string, unknown>;
    context: Parameters<typeof FloatingArrow>[0]["context"];
    arrowRef: RefObject<SVGSVGElement | null>;
    arrowY: number | null | undefined;
  };
};

export function useIdentityTip({ suppressed = false }: { suppressed?: boolean } = {}): IdentityTip {
  const [open, setOpen] = useState(false);
  const coarse = useCoarsePointer();
  const enabled = !coarse && !suppressed;

  // Suppression (a row popover open) closes an open card and inhibits
  // re-opening while it holds — the window flyout's `suppressed` idiom.
  useEffect(() => {
    if (!enabled) setOpen(false);
  }, [enabled]);

  const arrowRef = useRef<SVGSVGElement | null>(null);
  const { refs, floatingStyles, context, middlewareData } = useFloating({
    open,
    onOpenChange: setOpen,
    // Fixed-x anchor at the sidebar's right edge (the row is full-bleed), and
    // `fixed` strategy so an off-viewport edge clips instead of widening the
    // page — the row flyout card's positioning contract.
    placement: "right",
    strategy: "fixed",
    middleware: [offset(6), flip(), shift({ padding: 8 }), arrow({ element: arrowRef })],
    whileElementsMounted: autoUpdate,
  });

  const hover = useHover(context, {
    enabled,
    mouseOnly: true,
    move: false,
    delay: { open: IDENTITY_TIP_OPEN_DELAY_MS, close: 0 },
  });
  const focus = useFocus(context, { enabled });
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss]);

  const close = useCallback(() => setOpen(false), []);

  return {
    setReference: refs.setReference,
    getReferenceProps,
    open,
    close,
    _floating: {
      setFloating: refs.setFloating,
      floatingStyles,
      getFloatingProps,
      context,
      arrowRef,
      arrowY: middlewareData.arrow?.y,
    },
  };
}

/** The portalled card. Renders null while closed — the surface mounts only
 *  while open, matching the flyout's render-performance discipline. */
export function IdentityTipCard({
  tip,
  testid,
  title,
  children,
}: {
  tip: IdentityTip;
  testid: string;
  /** Title-bar identity content (secondary literal + primary name). */
  title: ReactNode;
  /** The single plain-text body line. */
  children: ReactNode;
}) {
  if (!tip.open) return null;
  const { setFloating, floatingStyles, getFloatingProps, context, arrowRef, arrowY } = tip._floating;
  return (
    <FloatingPortal>
      <div
        ref={setFloating}
        style={floatingStyles}
        {...getFloatingProps()}
        data-testid={testid}
        // pointer-events-none: the card holds nothing interactive, so it must
        // never intercept a click meant for the rows beneath it.
        className="z-50 pointer-events-none flex flex-col gap-1 bg-bg-primary border border-border rounded-md shadow-lg px-2 py-1.5 text-xs font-mono w-max max-w-xs"
      >
        {/* Same notch contract as the window flyout: pinned to the row's
            vertical center, inset fill while it lands on the title band. */}
        <FloatingArrow
          ref={arrowRef}
          context={context}
          width={10}
          height={5}
          tipRadius={1}
          fill={notchFill(arrowY)}
          stroke="var(--color-border)"
          strokeWidth={1}
          aria-hidden="true"
          data-testid={`${testid}-arrow`}
        />
        <PopupTitleBar>{title}</PopupTitleBar>
        {/* break-words (not nowrap): a deep repo path must wrap inside
            max-w-xs rather than paint outside the card. */}
        <span className="text-text-secondary break-words">{children}</span>
      </div>
    </FloatingPortal>
  );
}

import { Children, cloneElement, useState, type ReactElement, type ReactNode, type Ref } from "react";
import {
  FloatingDelayGroup,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDelayGroup,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useMergeRefs,
  useRole,
  type Placement,
} from "@floating-ui/react";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer";

/**
 * Tier-1 tooltip system (260722-73al). `Tip` NAMES A CONTROL — a one-line
 * plain-text label plus an optional keycap chip (`kbd`) and/or dim modifier
 * note (`note`). It is NEVER interactive content: anything needing a second
 * line of state or a clickable element is tier-2 hover-card material
 * (`StatusDotTip`) — there is no middle species.
 *
 * Replaces native `title=` attributes on interactive chrome controls: native
 * titles are OS-styled (they break the terminal aesthetic), slow (~1s fixed
 * delay), unstylable, and invisible to keyboard users (Constitution V —
 * keyboard-first). Wherever `Tip` lands the native `title` is REMOVED (never
 * both, or the OS bubble doubles the styled tip); `aria-label`s stay.
 *
 * Behavior contract (user-approved design session):
 * - 300ms open delay on hover; 0ms while the cluster is "warm" (a sibling tip
 *   in the same `TipGroup` closed <500ms ago) — macOS-menu sweep behavior.
 * - Opens immediately on `:focus-visible` (never on mouse-down focus).
 * - Dismisses on pointer-leave, Escape, and on activating the control (the
 *   tooltip must never sit over the click's result).
 * - Suppressed under `pointer: coarse` — the child renders unchanged; the
 *   control's `aria-label` carries the name (no long-press tooltip layer).
 * - Flips/shifts at viewport edges (the StatusDotTip middleware set).
 * - Reduced motion is trivially satisfied: no fade — instant show/hide.
 *
 * API: wraps a SINGLE child element and clones it with the floating reference
 * props merged (refs via `useMergeRefs`) — no wrapper DOM node, so layouts and
 * the top-bar overflow fit's width-measurement probe are unaffected. A falsy
 * `label` renders the child untouched (mirrors the `title={cond ? x :
 * undefined}` idiom at conditional call sites).
 */

/** Hover open delay outside a warm cluster (approved: 300ms). */
export const TIP_OPEN_DELAY_MS = 300;
/** How long a cluster stays "warm" (instant open) after the last tip closes. */
export const TIP_WARM_WINDOW_MS = 500;
/** Gap between the anchor and the tip (matches StatusDotTip's offset). */
const TIP_OFFSET_PX = 6;
/** Viewport padding for the shift() middleware (matches StatusDotTip). */
const TIP_SHIFT_PADDING_PX = 8;

/**
 * Warm-cluster provider — one per chrome region (top-bar control cluster,
 * breadcrumb, sidebar, compose strip, …). Tips inside share a
 * `FloatingDelayGroup`: once one opens, sweeping to a sibling opens it
 * instantly until `TIP_WARM_WINDOW_MS` after the last close. Regions with a
 * single tip don't need one (the 300ms default applies without a provider).
 */
export function TipGroup({ children }: { children: ReactNode }) {
  return (
    <FloatingDelayGroup
      delay={{ open: TIP_OPEN_DELAY_MS, close: 0 }}
      timeoutMs={TIP_WARM_WINDOW_MS}
    >
      {children}
    </FloatingDelayGroup>
  );
}

type TipProps = {
  /** One-line, sentence-cased control name (≤40ch — rewrite longer legacy
   *  copy at the call site). Falsy → the child renders with no tooltip
   *  machinery attached (conditional-tooltip call sites). */
  label?: string;
  /** Optional dim modifier note, e.g. "⇧click: force". */
  note?: string;
  /** Optional keycap chip, e.g. "Enter". A STATIC string per call site — no
   *  shortcut-registry wiring (deferred follow-up). */
  kbd?: string;
  /** Default `bottom` (the top-bar convention). Bottom-of-screen strips pass
   *  `top`, sidebar rows `right`; flip()/shift() handle viewport edges. */
  placement?: Placement;
  /** The single anchored control. Cloned with the reference props merged. */
  children: ReactElement<Record<string, unknown>>;
};

export function Tip({ label, note, kbd, placement = "bottom", children }: TipProps) {
  const [open, setOpen] = useState(false);
  const coarse = useCoarsePointer();
  // Suppress-by-early-return (below) — but hooks must run unconditionally, so
  // the machinery is parameterized on `enabled` and the return comes last.
  const enabled = !coarse && Boolean(label);

  const { refs, floatingStyles, context } = useFloating({
    open: open && enabled,
    onOpenChange: setOpen,
    placement,
    middleware: [offset(TIP_OFFSET_PX), flip(), shift({ padding: TIP_SHIFT_PADDING_PX })],
    whileElementsMounted: autoUpdate,
  });

  // Warm-cluster wiring: inside a TipGroup the group's delay applies (and goes
  // instant during the warm phase); outside any provider the group context is
  // the default `delay: 0` — fall back to the standalone 300ms open delay.
  const { delay: groupDelay } = useDelayGroup(context);
  const hover = useHover(context, {
    enabled,
    move: false,
    delay: groupDelay === 0 ? { open: TIP_OPEN_DELAY_MS, close: 0 } : groupDelay,
  });
  // `visibleOnly` default: opens on :focus-visible (keyboard), not mouse-down.
  const focus = useFocus(context, { enabled });
  // `referencePress`: activating the control hides the tip — it must never sit
  // over the click's result. Escape + pointer-leave dismiss come for free.
  const dismiss = useDismiss(context, { referencePress: true });
  // Tier-1 carries the real tooltip pattern: `role="tooltip"` on the floating
  // element, `aria-describedby` wired onto the anchored control while open.
  // (Contrast StatusDotTip, which deliberately advertises NO tooltip role — it
  // holds real links.)
  const role = useRole(context, { role: "tooltip" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);

  const child = Children.only(children);
  // React 19: an element's ref rides its props — merge it with the floating
  // reference setter so call sites keep their own refs (e.g. dropdown
  // triggers' buttonRef).
  const childRef = (child.props as { ref?: Ref<HTMLElement> }).ref ?? null;
  const mergedRef = useMergeRefs([refs.setReference, childRef]);

  // Coarse pointer or no label: the control renders untouched — no reference
  // props, no portal, no ARIA wiring (the aria-label carries the name).
  if (!enabled) return children;

  return (
    <>
      {cloneElement(child, { ...getReferenceProps(child.props), ref: mergedRef })}
      {open && (
        <FloatingPortal>
          {/* Quiet-card shell (Variant A): bg-bg-card, 1px border, 5px radius,
              soft shadow, 11px mono. `pointer-events-none` — tier-1 tooltips
              hold no interactive content, so they must never intercept a
              click. `max-w-[40ch]` + truncate backstop the one-line content
              cap. No animation: instant show/hide (reduced-motion safe). */}
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            data-testid="tip"
            className="z-50 pointer-events-none flex items-center gap-1.5 max-w-[40ch] rounded-[5px] border border-border bg-bg-card px-2 py-1 font-mono text-[11px] shadow-lg select-none whitespace-nowrap"
          >
            <span className="min-w-0 truncate text-text-primary">{label}</span>
            {kbd && (
              // Keycap chip (Variant C): inset bg, 1px border with a 2px
              // bottom edge (the "key" read), 3px radius, 10px type.
              <kbd className="shrink-0 rounded-[3px] border border-b-2 border-border bg-bg-inset px-1 font-mono text-[10px] leading-[14px] text-text-primary">
                {kbd}
              </kbd>
            )}
            {note && <span className="shrink-0 text-text-secondary">{note}</span>}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

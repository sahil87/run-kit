import { useEffect, useRef } from "react";

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * True when a NESTED *modal* layer is open inside `container`. The drawer
 * `<aside>` itself carries `role="dialog"`, so a nested layer is a
 * `role="dialog"` element that is a *descendant* of the container — never the
 * container itself. `element.querySelector` only ever returns descendants
 * (never the element it's called on), so any match is already nested; the
 * `!== container` check is belt-and-suspenders. When this is true the drawer
 * trap stands down: the nested modal (e.g. `KillDialog`'s `Dialog`) owns its
 * own Escape-close and Tab-trap, so a single Escape must dismiss only the
 * topmost layer and the drawer-wide Tab wrap must not move focus out of the
 * nested dialog into the rows behind it.
 *
 * The match is narrowed to `aria-modal="true"` so the drawer trap only stands
 * down for genuinely modal nested dialogs (which own their own focus trap).
 * Non-modal popovers like `PinPopover` carry `role="dialog"` *without*
 * `aria-modal` and do NOT trap focus themselves — for those, the drawer's
 * Tab-wrap must stay active so focus cannot escape the drawer (preserving the
 * `aria-modal` contract on the `<aside>`).
 */
function hasNestedDialog(container: HTMLElement): boolean {
  const dialog = container.querySelector('[role="dialog"][aria-modal="true"]');
  return dialog != null && dialog !== container;
}

/**
 * Traps Tab focus within `containerRef` and calls `onEscape` on Escape, while
 * `active` is true. Focuses the first focusable element on activation. The
 * single focus-cycle contract consumed by the Shell mobile drawer
 * (`components/shell/shell.tsx`), `Dialog` (`components/dialog.tsx`), and
 * `CommandPalette` (`components/command-palette.tsx`).
 *
 * Only attaches the document `keydown` listener and steals focus while
 * `active`; cleans up on deactivation/unmount. Reads `onEscape` through a ref
 * so a caller passing a fresh closure each render still fires the latest one
 * without re-running the effect.
 */
export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  active: boolean,
  onEscape: () => void,
) {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    // Focus the first focusable on activation.
    container.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      const node = containerRef.current;
      if (!node) return;
      // Stand down entirely while a nested modal (KillDialog/PinPopover) is open
      // inside the drawer: it owns its own Escape-close and Tab-trap, so the
      // drawer trap must not collapse the drawer on Escape nor run its
      // drawer-wide Tab wrap (which could pull focus out of the nested dialog
      // into the rows behind it).
      if (hasNestedDialog(node)) return;
      if (e.key === "Escape") {
        onEscapeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = node.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [active, containerRef]);
}

import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useUpdateNotification } from "@/contexts/session-context";
import { displayVersion } from "@/lib/palette-version";
import { copyToClipboard } from "@/lib/clipboard";
import { useToast } from "@/components/toast";
import { LogoSpinner } from "@/components/logo-spinner";
import { useUpdateClick } from "@/hooks/use-update-click";

/** Vertical gap between the chevron's bottom edge and the menu's top (matches
 *  BreadcrumbDropdown's MENU_GAP_PX — 4px). */
const MENU_GAP_PX = 4;

/**
 * A single overflowed control, rendered as a menu row. `id` is the registry id
 * (stable key); `node` is the control's `menuRender` output — a self-contained
 * row that owns exactly one focusable element (a `<button role="menuitem">`,
 * `<a role="menuitem">`, or a stepper row whose first control is focusable).
 */
export type OverflowMenuRow = { id: string; node: ReactNode };

type Props = {
  /** Overflowed controls, already in pyramid order, each pre-rendered as a row. */
  rows: OverflowMenuRow[];
  /** True when a qualifying, undismissed update is pending AND the UpdateChip is
   *  currently overflowed into this menu — flips the version row into the update
   *  surface (R11) and lights the chevron attention badge (R7). */
  updateOverflowed: boolean;
};

/**
 * Top-bar overflow chevron + menu (260715-h1ck). The chevron is a fixed,
 * always-visible icon button sitting immediately LEFT of the connection dot
 * (the dot keeps its right-most status-terminator role). It follows the top-bar
 * icon-button convention (`rk-glint`, bordered chip, coarse touch sizing) and
 * the menu mirrors `breadcrumb-dropdown.tsx`'s a11y contract: `role="menu"` /
 * `role="menuitem"`, Escape closes + refocuses the trigger, ArrowUp/ArrowDown
 * move focus, outside `mousedown` closes, and the panel is `position: fixed`
 * anchored to the trigger rect (so no ancestor `overflow-hidden` clips it and no
 * new dependency is needed).
 *
 * The menu always contains the fixed version row (last), so the chevron renders
 * even when nothing is overflowed. When `updateOverflowed` is true the version
 * row doubles as the update surface (R11) and the chevron carries an accent
 * attention badge (R7).
 */
export function TopBarOverflowMenu({ rows, updateOverflowed }: Props) {
  const { daemonVersion, latest, current } = useUpdateNotification();
  const { addToast } = useToast();
  // Shared one-click-update behavior with the in-bar UpdateChip (review M5).
  const { updating, triggerUpdate } = useUpdateClick();

  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Wrapper divs, one per overflowed row; the focusable control is the wrapper's
  // first focusable descendant (resolved at focus time so rows stay presentational).
  const rowWrapRefs = useRef<(HTMLDivElement | null)[]>([]);
  const versionRowRef = useRef<HTMLButtonElement>(null);

  // The version row is always the LAST focusable menu item; overflowed rows
  // occupy indices 0..rows.length-1, the version row is at rows.length.
  const versionIdx = rows.length;
  const totalCount = rows.length + 1;

  const focusIndex = useCallback(
    (index: number) => {
      if (index === versionIdx) {
        versionRowRef.current?.focus();
        return;
      }
      const wrap = rowWrapRefs.current[index];
      const focusable = wrap?.querySelector<HTMLElement>(
        "button:not([disabled]), a[href], [tabindex]",
      );
      focusable?.focus();
    },
    [versionIdx],
  );

  // Outside-click close (mousedown, like BreadcrumbDropdown).
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Keyboard: Escape closes + refocuses trigger; ArrowUp/Down move focus.
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setFocusedIndex((prev) => {
          const next = prev < totalCount - 1 ? prev + 1 : 0;
          focusIndex(next);
          return next;
        });
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setFocusedIndex((prev) => {
          const next = prev > 0 ? prev - 1 : totalCount - 1;
          focusIndex(next);
          return next;
        });
      }
    }
    document.addEventListener("keydown", handleKey, { capture: true });
    return () => document.removeEventListener("keydown", handleKey, { capture: true });
  }, [open, totalCount, focusIndex]);

  // On open, focus the first item.
  useEffect(() => {
    if (!open) return;
    setFocusedIndex(0);
    requestAnimationFrame(() => {
      focusIndex(0);
    });
  }, [open, focusIndex]);

  // Anchor the fixed menu to the chevron's viewport rect: top just below the
  // trigger, right-aligned to the trigger's right edge (the chevron lives at the
  // right end of the bar, so the menu opens leftward from there).
  const computeMenuPos = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuPos({ top: rect.bottom + MENU_GAP_PX, right: window.innerWidth - rect.right });
  }, []);

  useLayoutEffect(() => {
    if (open) computeMenuPos();
    else setMenuPos(null);
  }, [open, computeMenuPos]);

  // Keep the fixed menu glued to a moving trigger (scroll in any ancestor /
  // resize). Ignore scrolls originating inside the menu itself.
  useEffect(() => {
    if (!open) return;
    const onReflow = (e: Event) => {
      if (e.type === "scroll" && menuRef.current?.contains(e.target as Node)) return;
      computeMenuPos();
    };
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [open, computeMenuPos]);

  const toggle = useCallback(() => setOpen((v) => !v), []);
  // Close the menu after a row action fires — exposed to rows via a shared
  // handler so a menu-row click dismisses the panel like BreadcrumbDropdown.
  const close = useCallback(() => setOpen(false), []);

  // Version-row plain form: `Run Kit v{version}` (plain `Run Kit` when the
  // version is unknown — no `event: version` yet — never `vundefined`).
  const versionText = daemonVersion ? `Run Kit ${displayVersion(daemonVersion)}` : "Run Kit";

  // Copy the displayed version form (matches app.tsx buildVersionAction body).
  const handleCopy = useCallback(() => {
    if (!daemonVersion) return; // plain `Run Kit` — nothing meaningful to copy
    void copyToClipboard(displayVersion(daemonVersion)).then((ok) => {
      addToast(ok ? "Version copied" : "Copy failed", ok ? "info" : "error");
    });
    setOpen(false);
  }, [daemonVersion, addToast]);

  // The version row becomes the update surface only when a qualifying update is
  // pending AND the UpdateChip is overflowed into this menu.
  const asUpdateSurface = updateOverflowed && latest !== null;
  const updateLabel = current
    ? `Update run-kit: v${current} → v${latest}`
    : `Update run-kit to v${latest}`;

  return (
    <div
      ref={containerRef}
      className="relative inline-flex items-center"
      // Close the menu when a TERMINAL menu action fires — i.e. a click that
      // lands on a `role="menuitem"`/`menuitemcheckbox` control (mirrors
      // BreadcrumbDropdown's setOpen(false) on select). Deliberately keyed on the
      // ROLE, not the row wrapper (review S1): the TerminalFont stepper row is a
      // `role="group"` whose `−`/`+` are plain buttons, so stepping the font does
      // NOT match and the menu stays open across repeated steps. Checkbox toggles
      // (fixed-width, autofit) DO close, matching a single-shot menu action.
      onClick={(e) => {
        const t = e.target as HTMLElement;
        if (open && menuRef.current?.contains(t) && t.closest('[role="menuitem"], [role="menuitemcheckbox"]')) {
          close();
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="More controls"
        title="More controls"
        className="rk-glint relative min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] rounded border border-border text-text-secondary hover:border-text-secondary transition-colors flex items-center justify-center"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {/* chevron-down */}
          <polyline points="6 9 12 15 18 9" />
        </svg>
        {/* Attention badge (R7): a small accent dot when an overflowed
            attention-bearing item (the pending update chip) is in the menu. */}
        {asUpdateSurface && (
          <span
            data-testid="overflow-attention"
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-accent-green"
          />
        )}
      </button>
      {open && menuPos && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="More controls"
          style={{ top: menuPos.top, right: menuPos.right }}
          className="fixed bg-bg-primary border border-border rounded-lg shadow-2xl py-1 min-w-[200px] max-w-[280px] z-50 max-h-[70vh] overflow-y-auto"
        >
          {rows.map((row, i) => (
            <div
              key={row.id}
              data-menu-row
              ref={(el) => {
                rowWrapRefs.current[i] = el;
              }}
            >
              {row.node}
            </div>
          ))}
          {rows.length > 0 && <div className="border-t border-border my-1" />}
          {asUpdateSurface ? (
            <button
              ref={versionRowRef}
              type="button"
              role="menuitem"
              tabIndex={focusedIndex === versionIdx ? 0 : -1}
              disabled={updating}
              onClick={triggerUpdate}
              aria-label={updating ? "Updating run-kit" : updateLabel}
              className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm text-accent-green hover:bg-bg-card transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {updating ? (
                <>
                  <LogoSpinner size={12} />
                  <span>{"updating…"}</span>
                </>
              ) : (
                <span>{`Run Kit v${current} → v${latest} ⬆`}</span>
              )}
            </button>
          ) : (
            <button
              ref={versionRowRef}
              type="button"
              role="menuitem"
              tabIndex={focusedIndex === versionIdx ? 0 : -1}
              onClick={handleCopy}
              aria-label={daemonVersion ? `${versionText} (copy)` : "Run Kit"}
              title={daemonVersion ? "Copy version" : undefined}
              className="w-full text-left block px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-card transition-colors"
            >
              {versionText}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

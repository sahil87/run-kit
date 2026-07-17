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
 * Shared overflow-menu row styling (260715-h1ck), hosted here — the file both
 * `top-bar.tsx` (the row components) and `view-switcher.tsx` (`ViewSwitcherMenuRows`)
 * already depend on, so there is no import cycle. Decomposed so callers compose
 * exactly the variant they need instead of re-declaring a drifted subset:
 *
 *  - `MENU_ROW_BASE` — layout only (full-width left-aligned flex row, padding,
 *    text size). No color/state tokens.
 *  - `MENU_ROW_REST` — the resting/hover treatment (secondary text → primary on
 *    hover, card hover bg).
 *  - `MENU_ROW_DISABLED` — the disabled-state tokens (dimmed, no hover).
 *  - `MENU_ROW_ACTIVE` — the inverse-video accent-green treatment used to mark a
 *    selected row (e.g. the active view in `ViewSwitcherMenuRows`).
 *  - `MENU_ROW_CLASS` — the default composition (`base + rest + disabled`) used by
 *    every plain menu row.
 */
export const MENU_ROW_BASE =
  "w-full text-left flex items-center gap-2 px-3 py-2 text-sm transition-colors";
export const MENU_ROW_REST =
  "text-text-secondary hover:text-text-primary hover:bg-bg-card";
export const MENU_ROW_DISABLED =
  "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-secondary";
export const MENU_ROW_ACTIVE = "bg-accent-green text-bg-primary";
/** Default row class — the resting variant plus disabled-state tokens. */
export const MENU_ROW_CLASS = `${MENU_ROW_BASE} ${MENU_ROW_REST} ${MENU_ROW_DISABLED}`;

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
  // True once the version row currently holds keyboard focus — drives its roving
  // tabIndex (it is the only always-present focusable, so it owns the initial
  // tab stop until arrow-nav moves focus into an overflowed row).
  const [versionRowFocused, setVersionRowFocused] = useState(true);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Selector matching every keyboard-focusable menu control. Rows stay
  // presentational: a row may render ONE control (most) or SEVERAL (the
  // notification row's two buttons, the font stepper's − / +), so navigation
  // enumerates the flat list of focusable controls in DOM order (= visual
  // order) rather than one-focusable-per-row — otherwise the second+ control in
  // a multi-control row is keyboard-unreachable (Constitution V).
  const FOCUSABLE_SELECTOR = "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

  // All focusable controls currently in the menu panel, in DOM order. Resolved
  // at navigation time so it always reflects the live rows (a row's enabled
  // controls can change, e.g. the font stepper's − / + gating at bounds).
  const focusables = useCallback((): HTMLElement[] => {
    const menu = menuRef.current;
    if (!menu) return [];
    return Array.from(menu.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  }, []);

  // Move focus by `delta` (+1 down, -1 up) through the flat focusable list,
  // wrapping at both ends. Anchors off the currently-focused control's position
  // so navigation is stable even as the list shifts.
  const moveFocus = useCallback(
    (delta: number) => {
      const items = focusables();
      if (items.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const curr = active ? items.indexOf(active) : -1;
      const base = curr === -1 ? (delta > 0 ? -1 : 0) : curr;
      const next = (base + delta + items.length) % items.length;
      items[next]?.focus();
    },
    [focusables],
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
        moveFocus(1);
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        moveFocus(-1);
      }
    }
    document.addEventListener("keydown", handleKey, { capture: true });
    return () => document.removeEventListener("keydown", handleKey, { capture: true });
  }, [open, moveFocus]);

  // On open, restore the version row as the default tab stop and focus the
  // first focusable control.
  useEffect(() => {
    if (!open) return;
    setVersionRowFocused(true);
    requestAnimationFrame(() => {
      const items = focusables();
      items[0]?.focus();
    });
  }, [open, focusables]);

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
          {rows.map((row) => (
            <div key={row.id} data-menu-row>
              {row.node}
            </div>
          ))}
          {rows.length > 0 && <div className="border-t border-border my-1" />}
          {asUpdateSurface ? (
            <button
              type="button"
              role="menuitem"
              tabIndex={versionRowFocused ? 0 : -1}
              onFocus={() => setVersionRowFocused(true)}
              onBlur={() => setVersionRowFocused(false)}
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
              type="button"
              role="menuitem"
              tabIndex={versionRowFocused ? 0 : -1}
              onFocus={() => setVersionRowFocused(true)}
              onBlur={() => setVersionRowFocused(false)}
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

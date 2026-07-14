import { useState, useRef, useEffect, useCallback } from "react";
import type { BreadcrumbDropdownItem } from "@/contexts/chrome-context";

type DropdownAction = { label: string; onAction: () => void };

type Props = {
  items: BreadcrumbDropdownItem[];
  label?: string;
  icon?: string;
  onNavigate?: (href: string) => void;
  action?: DropdownAction;
  /** Optional SECOND leading action, rendered below `action` (e.g. the
   *  window switcher's `+ New Agent` beside `+ New Window`). Only honored when
   *  `action` is also present. Every other call site passes just `action` and
   *  keeps its single-action behavior unchanged. */
  secondaryAction?: DropdownAction;
  triggerClassName?: string;
  /** Native tooltip on the trigger — names the crumb's level (e.g. "Session"). */
  title?: string;
};

export function BreadcrumbDropdown({ items, label, icon, onNavigate, action, secondaryAction, triggerClassName, title }: Props) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const actionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Leading actions occupy indices 0..offset-1; items follow at offset..N-1.
  // A secondaryAction is only meaningful alongside a primary action.
  const leadingActions: DropdownAction[] = action
    ? secondaryAction
      ? [action, secondaryAction]
      : [action]
    : [];
  const offset = leadingActions.length;
  const totalCount = items.length + offset;

  function getFocusableRef(index: number): HTMLButtonElement | null {
    if (index < offset) return actionRefs.current[index] ?? null;
    return itemRefs.current[index - offset] ?? null;
  }

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
          getFocusableRef(next)?.focus();
          return next;
        });
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setFocusedIndex((prev) => {
          const next = prev > 0 ? prev - 1 : totalCount - 1;
          getFocusableRef(next)?.focus();
          return next;
        });
      }
    }
    document.addEventListener("keydown", handleKey, { capture: true });
    return () => document.removeEventListener("keydown", handleKey, { capture: true });
  }, [open, totalCount]);

  useEffect(() => {
    if (!open) return;
    const currentIdx = items.findIndex((item) => item.current);
    const targetIdx = (currentIdx >= 0 ? currentIdx : 0) + offset;
    setFocusedIndex(targetIdx);
    requestAnimationFrame(() => {
      getFocusableRef(targetIdx)?.focus();
    });
  }, [open, items]);

  const toggle = useCallback(() => {
    setOpen((v) => !v);
  }, []);

  return (
    <div ref={containerRef} className="relative inline-flex items-center">
      <button
        ref={buttonRef}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label ? `Switch ${label}` : "Switch"}
        title={title}
        onClick={toggle}
        // rk-glint is safe here: the menu is a SIBLING of the trigger (both
        // children of the relative wrapper), so the trigger's overflow:hidden
        // never clips the open menu — same invariant as the top-bar popovers.
        className={`min-w-[24px] min-h-[24px] flex items-center gap-1 transition-colors ${triggerClassName ?? "text-text-secondary hover:text-text-primary"}`}
      >
        <span className="min-w-0 truncate">{icon ?? "\u25BE"}</span>
        {/* Persistent caret: the always-visible "opens a menu" affordance,
            distinguishing dropdown crumbs from link crumbs (which navigate).
            Only rendered alongside a label \u2014 a label-less trigger already IS
            a bare caret. */}
        {icon != null && (
          <span
            aria-hidden="true"
            className="shrink-0 text-base leading-none"
          >
            {"\u25BE"}
          </span>
        )}
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label ? `Switch ${label}` : "Switch"}
          className="absolute top-full left-0 mt-1 bg-bg-primary border border-border rounded-lg shadow-2xl py-1 min-w-[160px] max-w-[240px] z-50 max-h-60 overflow-y-auto"
        >
          {leadingActions.length > 0 && (
            <>
              {leadingActions.map((la, i) => (
                <button
                  key={la.label}
                  ref={(el) => { actionRefs.current[i] = el; }}
                  type="button"
                  role="menuitem"
                  tabIndex={focusedIndex === i ? 0 : -1}
                  onClick={() => {
                    setOpen(false);
                    la.onAction();
                  }}
                  className="w-full text-left block px-3 py-2 text-sm text-text-primary hover:bg-bg-card transition-colors"
                >
                  {la.label}
                </button>
              ))}
              <div className="border-t border-border" />
            </>
          )}
          {items.map((item, i) => (
            <button
              key={item.href}
              ref={(el) => { itemRefs.current[i] = el; }}
              type="button"
              role="menuitem"
              tabIndex={focusedIndex === i + offset ? 0 : -1}
              onClick={() => {
                setOpen(false);
                if (onNavigate) {
                  onNavigate(item.href);
                }
              }}
              className={`w-full text-left block px-3 py-2 text-sm truncate transition-colors ${
                item.current
                  ? "text-accent"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-card"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

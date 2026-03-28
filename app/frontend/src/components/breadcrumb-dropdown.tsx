import { useState, useRef, useEffect, useCallback } from "react";
import type { BreadcrumbDropdownItem } from "@/contexts/chrome-context";

type Props = {
  items: BreadcrumbDropdownItem[];
  label?: string;
  icon?: string;
  onNavigate?: (href: string) => void;
  action?: { label: string; onAction: () => void };
  actions?: { label: string; onAction: () => void }[];
  triggerClassName?: string;
};

export function BreadcrumbDropdown({ items, label, icon, onNavigate, action, actions, triggerClassName }: Props) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Merge single action and actions array into one list for offset calculation.
  const allActions = actions ?? (action ? [action] : []);
  const offset = allActions.length;
  const totalCount = items.length + offset;

  const actionRefs = useRef<(HTMLButtonElement | null)[]>([]);

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
        onClick={toggle}
        className={`min-w-[24px] min-h-[24px] flex items-center transition-colors ${triggerClassName ?? "text-text-secondary hover:text-text-primary"}`}
      >
        {icon ?? "\u25BE"}
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label ? `Switch ${label}` : "Switch"}
          className="absolute top-full left-0 mt-1 bg-bg-primary border border-border rounded-lg shadow-2xl py-1 min-w-[160px] max-w-[240px] z-50"
        >
          {allActions.length > 0 && (
            <>
              {allActions.map((act, ai) => (
                <button
                  key={act.label}
                  ref={(el) => { actionRefs.current[ai] = el; }}
                  type="button"
                  role="menuitem"
                  tabIndex={focusedIndex === ai ? 0 : -1}
                  onClick={() => {
                    setOpen(false);
                    act.onAction();
                  }}
                  className="w-full text-left block px-3 py-2 text-sm text-text-primary hover:bg-bg-card transition-colors"
                >
                  {act.label}
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

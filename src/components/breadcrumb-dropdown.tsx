"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import type { BreadcrumbDropdownItem } from "@/contexts/chrome-context";

type Props = {
  items: BreadcrumbDropdownItem[];
  label?: string;
};

export function BreadcrumbDropdown({ items, label }: Props) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  // Close on outside click
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

  // Close on Escape, arrow key navigation
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev < items.length - 1 ? prev + 1 : 0;
          itemRefs.current[next]?.focus();
          return next;
        });
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev > 0 ? prev - 1 : items.length - 1;
          itemRefs.current[next]?.focus();
          return next;
        });
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, items.length]);

  const toggle = useCallback(() => {
    setOpen((v) => {
      if (!v) setFocusedIndex(-1);
      return !v;
    });
  }, []);

  return (
    <div ref={containerRef} className="relative inline-flex items-center">
      <button
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label ? `Switch ${label}` : "Switch"}
        onClick={toggle}
        className="text-text-secondary hover:text-text-primary transition-colors min-w-[24px] min-h-[24px] flex items-center justify-center text-[10px]"
      >
        ▾
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label ? `Switch ${label}` : "Switch"}
          className="absolute top-full left-0 mt-1 bg-bg-primary border border-border rounded-lg shadow-2xl py-1 min-w-[160px] max-w-[240px] z-50"
        >
          {items.map((item, i) => (
            <Link
              key={item.href}
              ref={(el) => { itemRefs.current[i] = el; }}
              href={item.href}
              role="menuitem"
              tabIndex={focusedIndex === i ? 0 : -1}
              onClick={() => setOpen(false)}
              className={`block px-3 py-2 text-sm truncate transition-colors ${
                item.current
                  ? "text-accent"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-card"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

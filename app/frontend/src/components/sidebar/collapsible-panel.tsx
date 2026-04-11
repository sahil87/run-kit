import { useState, useCallback, useRef, useEffect } from "react";

type CollapsiblePanelProps = {
  title: string;
  storageKey: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
};

function readPersistedState(key: string, defaultOpen: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch {
    // localStorage unavailable
  }
  return defaultOpen;
}

export function CollapsiblePanel({
  title,
  storageKey,
  defaultOpen = true,
  children,
}: CollapsiblePanelProps) {
  const [isOpen, setIsOpen] = useState(() => readPersistedState(storageKey, defaultOpen));
  const contentRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, String(next));
      } catch {
        // localStorage unavailable
      }
      return next;
    });
  }, [storageKey]);

  // After transition ends, let content be visible (for accessibility)
  // During transition, keep overflow hidden for smooth animation
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    if (!contentRef.current) return;
    setTransitioning(true);
    const el = contentRef.current;
    const handler = () => setTransitioning(false);
    el.addEventListener("transitionend", handler);
    return () => el.removeEventListener("transitionend", handler);
  }, [isOpen]);

  return (
    <div className="border-t border-border">
      {/* Header — always visible */}
      <button
        type="button"
        className="flex items-center gap-1 w-full px-3 sm:px-4 py-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
        onClick={toggle}
        aria-expanded={isOpen}
      >
        {/* Chevron */}
        <span
          className="inline-block transition-transform duration-150"
          style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
          aria-hidden="true"
        >
          &#x25B8;
        </span>
        <span className="font-medium">{title}</span>
      </button>

      {/* Content area with max-height transition */}
      <div
        ref={contentRef}
        className="transition-[max-height] duration-150 ease-in-out"
        style={{
          maxHeight: isOpen ? "200px" : "0px",
          overflow: transitioning || !isOpen ? "hidden" : "visible",
        }}
      >
        <div className="px-3 sm:px-4 pb-1.5">
          {children}
        </div>
      </div>
    </div>
  );
}

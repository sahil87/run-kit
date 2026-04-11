import { useState, useCallback, useRef, useEffect } from "react";

type CollapsiblePanelProps = {
  title: string;
  storageKey: string;
  defaultOpen?: boolean;
  headerRight?: React.ReactNode;
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
  headerRight,
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

  // During transition, keep overflow hidden for smooth animation.
  // Only set transitioning=true on actual user toggles (not initial mount),
  // otherwise transitionend never fires and overflow stays hidden permanently.
  const [transitioning, setTransitioning] = useState(false);
  const hasMounted = useRef(false);

  useEffect(() => {
    if (!contentRef.current) return;
    // Skip initial mount — no transition occurs, so transitionend would never fire
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }
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
        className="flex items-center gap-1.5 w-full px-1.5 sm:px-2 py-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
        onClick={toggle}
        aria-expanded={isOpen}
      >
        {/* Chevron */}
        <span
          className="inline-block transition-transform duration-150"
          style={{ transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)" }}
          aria-hidden="true"
        >
          &#x25BC;
        </span>
        <span className="font-medium">{title}</span>
        {headerRight && (
          <span className="ml-auto flex items-center gap-1 min-w-0 truncate">
            {headerRight}
          </span>
        )}
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
        <div className="pl-5 pr-1.5 sm:pr-2 pb-1.5">
          {children}
        </div>
      </div>
    </div>
  );
}

import { useState, useCallback, useRef, useEffect } from "react";
import type { RowTint } from "@/themes";

type CollapsiblePanelProps = {
  title: string;
  storageKey: string;
  defaultOpen?: boolean;
  headerRight?: React.ReactNode;
  /** Action element rendered at the right side of the header (e.g. "+" button). Click events are stopped from toggling the panel. */
  headerAction?: React.ReactNode;
  /** Override the default content padding classes. */
  contentClassName?: string;
  /** Called after the panel is toggled. */
  onToggle?: (isOpen: boolean) => void;
  /** Optional row tint for background color. */
  tint?: RowTint | null;
  /** When true, renders a drag handle at the bottom and persists user-set height to localStorage. */
  resizable?: boolean;
  /** Initial open height in pixels when no persisted value exists. Default 200 (matches legacy max-height). */
  defaultHeight?: number;
  /** Floor for drag-resize in pixels. Default 80. */
  minHeight?: number;
  /** Ceiling for drag-resize — number (pixels) or `calc(100vh - Npx)` string. Default `'calc(100vh - 120px)'`. */
  maxHeight?: number | string;
  /** Panel body height in pixels used on mobile single-row layouts. When set, the drag handle is hidden on coarse-pointer / narrow viewports and the content area uses this height. Default 56. */
  mobileHeight?: number;
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

function readPersistedHeight(key: string): number | null {
  try {
    const stored = localStorage.getItem(key);
    if (stored == null) return null;
    const n = parseInt(stored, 10);
    if (!Number.isFinite(n)) return null;
    return n;
  } catch {
    return null;
  }
}

function writePersistedHeight(key: string, height: number): void {
  try {
    localStorage.setItem(key, String(Math.round(height)));
  } catch {
    // localStorage unavailable
  }
}

/** Resolve `maxHeight` (number | `calc(100vh - Npx)` | other) to a pixel value. */
function resolveMaxHeight(maxHeight: number | string): number {
  if (typeof maxHeight === "number") return maxHeight;
  const m = /^\s*calc\(\s*100vh\s*-\s*(\d+)px\s*\)\s*$/.exec(maxHeight);
  if (m) return Math.max(0, window.innerHeight - parseInt(m[1], 10));
  return Math.max(0, window.innerHeight - 120);
}

/** Subscribe to a media query; returns a stable boolean. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    if (mq.addEventListener) mq.addEventListener("change", handler);
    else mq.addListener(handler);
    setMatches(mq.matches);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", handler);
      else mq.removeListener(handler);
    };
  }, [query]);
  return matches;
}

export function CollapsiblePanel({
  title,
  storageKey,
  defaultOpen = true,
  headerRight,
  headerAction,
  contentClassName,
  onToggle,
  tint,
  resizable = false,
  defaultHeight = 200,
  minHeight = 80,
  maxHeight = "calc(100vh - 120px)",
  mobileHeight = 56,
  children,
}: CollapsiblePanelProps) {
  const [isOpen, setIsOpen] = useState(() => readPersistedState(storageKey, defaultOpen));
  const contentRef = useRef<HTMLDivElement>(null);

  // Hide the drag handle + use fixed mobile height on coarse pointer or narrow viewport.
  const isMobile = useMediaQuery("(pointer: coarse), (max-width: 639px)");

  const heightStorageKey = `${storageKey}-height`;
  const [height, setHeight] = useState<number>(() => {
    if (!resizable) return defaultHeight;
    const persisted = readPersistedHeight(heightStorageKey);
    if (persisted == null) return defaultHeight;
    return persisted;
  });

  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, String(next));
      } catch {
        // localStorage unavailable
      }
      onToggle?.(next);
      return next;
    });
  }, [storageKey, onToggle]);

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

  // ---- Drag-to-resize (desktop only) ----
  const dragStateRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const clampHeight = useCallback(
    (h: number) => {
      const ceiling = resolveMaxHeight(maxHeight);
      return Math.max(minHeight, Math.min(ceiling, h));
    },
    [minHeight, maxHeight],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const st = dragStateRef.current;
      if (!st || !contentRef.current) return;
      e.preventDefault();
      const next = clampHeight(st.startHeight + (e.clientY - st.startY));
      // Live update via direct style mutation (avoid setState-per-mousemove layout thrash).
      contentRef.current.style.height = `${next}px`;
    },
    [clampHeight],
  );

  const onPointerUp = useCallback(
    (e: PointerEvent) => {
      const st = dragStateRef.current;
      if (!st || !contentRef.current) return;
      const final = clampHeight(st.startHeight + (e.clientY - st.startY));
      dragStateRef.current = null;
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      setHeight(final);
      writePersistedHeight(heightStorageKey, final);
    },
    [clampHeight, heightStorageKey, onPointerMove],
  );

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!resizable || !contentRef.current) return;
      e.preventDefault();
      dragStateRef.current = {
        startY: e.clientY,
        startHeight: contentRef.current.getBoundingClientRect().height,
      };
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
    },
    [resizable, onPointerMove, onPointerUp],
  );

  // Cleanup dangling listeners on unmount.
  useEffect(() => {
    return () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  // ---- Height-style resolution ----
  // Legacy mode (resizable=false): max-height transition — open clamps to `${defaultHeight}px`, closed to 0.
  // Resizable desktop: inline height set to the user's value; closed animates to 0.
  // Resizable mobile: fixed mobileHeight; drag handle hidden.
  const legacyMode = !resizable;
  const effectiveResizableHeight = isMobile ? mobileHeight : height;

  const contentStyle = legacyMode
    ? {
        maxHeight: isOpen ? `${defaultHeight}px` : "0px",
        overflow: (transitioning || !isOpen ? "hidden" : "visible") as React.CSSProperties["overflow"],
      }
    : {
        height: isOpen ? `${effectiveResizableHeight}px` : "0px",
        overflow: (transitioning || !isOpen ? "hidden" : "visible") as React.CSSProperties["overflow"],
      };

  const transitionClass = legacyMode
    ? "transition-[max-height] duration-150 ease-in-out"
    : "transition-[height] duration-150 ease-in-out";

  const showDragHandle = resizable && isOpen && !isMobile;

  return (
    <div className="border-t border-border">
      {/* Header — always visible */}
      <div
        className="flex items-center gap-1.5 w-full px-1.5 sm:px-2 py-1 text-xs text-text-secondary shrink-0 transition-colors"
        style={tint ? { backgroundColor: tint.base } : undefined}
        onMouseEnter={tint ? (e) => { (e.currentTarget as HTMLElement).style.backgroundColor = tint.hover; } : undefined}
        onMouseLeave={tint ? (e) => { (e.currentTarget as HTMLElement).style.backgroundColor = tint.base; } : undefined}
      >
        <button
          type="button"
          className="flex items-center gap-1.5 flex-1 min-w-0 hover:text-text-primary transition-colors"
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
        {headerAction}
      </div>

      {/* Content area */}
      <div
        ref={contentRef}
        className={transitionClass}
        style={contentStyle}
      >
        <div className={contentClassName ?? "pl-5 pr-1.5 sm:pr-2 pb-1.5"}>
          {children}
        </div>
      </div>

      {/* Drag handle — resizable desktop only */}
      {showDragHandle && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={`Resize ${title} panel`}
          onPointerDown={onHandlePointerDown}
          className="h-1.5 border-t border-border hover:bg-bg-inset cursor-ns-resize select-none"
          style={{ touchAction: "none" }}
        />
      )}
    </div>
  );
}

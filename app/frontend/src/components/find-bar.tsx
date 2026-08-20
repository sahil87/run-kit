import { useEffect, useRef, type ReactNode } from "react";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer";

export interface FindBarProps {
  query: string;
  /** 0-based index of the active match within `matchCount`. */
  matchIndex: number;
  matchCount: number;
  onQueryChange: (query: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  /** Consumer-supplied extras rendered between the navigation buttons and ✕
   *  (the tty tile's case/regex toggles). The web consumer passes none. */
  toggles?: ReactNode;
  /** Disables the input and navigation buttons (the cross-origin web tile). */
  disabled?: boolean;
  /** When set, REPLACES the n/N counter (the cross-origin hint). */
  statusText?: string;
  /** Muted note appended to the hint area (the tty buffer-scope hint); the
   *  consumer decides when a search has run by passing or omitting it. */
  scopeNote?: string;
  placeholder?: string;
  testId?: string;
}

/** The one find bar every surface shares (web tile, tty tile) — a
 *  presentational row: input, n/N counter with the active ordinal in accent
 *  green, ∧/∨, ✕, and a right-aligned key hint suppressed on coarse pointers.
 *  The consumer owns the search mechanism and drives everything through
 *  props. Enter advances, ⇧Enter goes back, Escape closes; the input
 *  autofocuses on mount (the bar mounts only while open). */
export function FindBar({
  query,
  matchIndex,
  matchCount,
  onQueryChange,
  onNext,
  onPrev,
  onClose,
  toggles,
  disabled = false,
  statusText,
  scopeNote,
  placeholder,
  testId,
}: FindBarProps) {
  const coarse = useCoarsePointer();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) onPrev();
      else onNext();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 border-b border-border bg-bg-primary shrink-0"
      data-testid={testId}
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className="w-60 max-w-[40%] shrink bg-bg-card text-text-primary text-sm px-2 py-1 rounded border border-border outline-none focus:border-text-secondary disabled:opacity-50"
        aria-label="Find query"
        placeholder={placeholder}
        spellCheck={false}
      />
      {statusText !== undefined ? (
        <span className="text-text-secondary text-xs select-none">{statusText}</span>
      ) : (
        <span className="shrink-0 text-text-secondary text-xs select-none" aria-label="Match count">
          <span className="text-accent-green">{matchCount === 0 ? 0 : matchIndex + 1}</span>
          /{matchCount}
        </span>
      )}
      <button
        onClick={onPrev}
        disabled={disabled}
        className="shrink-0 w-7 h-7 flex items-center justify-center rounded hover:bg-bg-card text-text-secondary disabled:opacity-50"
        aria-label="Previous match"
      >
        <span className="text-sm">&#x2227;</span>
      </button>
      <button
        onClick={onNext}
        disabled={disabled}
        className="shrink-0 w-7 h-7 flex items-center justify-center rounded hover:bg-bg-card text-text-secondary disabled:opacity-50"
        aria-label="Next match"
      >
        <span className="text-sm">&#x2228;</span>
      </button>
      {toggles}
      <button
        onClick={onClose}
        className="shrink-0 w-7 h-7 flex items-center justify-center rounded hover:bg-bg-card text-text-secondary"
        aria-label="Close find bar"
      >
        <span className="text-sm">&#x2715;</span>
      </button>
      {(scopeNote !== undefined || !coarse) && (
        <span className="ml-auto flex items-baseline gap-2 text-text-secondary text-xs select-none whitespace-nowrap opacity-60">
          {scopeNote !== undefined && <span aria-label="Search scope">{scopeNote}</span>}
          {!coarse && <span>Enter next · ⇧Enter prev · Esc close</span>}
        </span>
      )}
    </div>
  );
}

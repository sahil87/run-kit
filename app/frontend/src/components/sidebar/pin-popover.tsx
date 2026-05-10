import { useEffect, useRef, useState } from "react";
import { ValidBoardName } from "@/components/board/board-name";
import type { BoardSummary } from "@/api/boards";
import { usePinActions } from "@/hooks/use-pin-actions";

type PinPopoverProps = {
  /** Server scope for the pin (per server-routing contract). */
  server: string;
  /** Tmux window-id (`@N` form). */
  windowId: string;
  /** All known boards (used to render existing rows). */
  boards: BoardSummary[];
  /** Predicate: is this window already pinned to the given board? */
  isPinnedTo: (board: string) => boolean;
  onClose: () => void;
};

/**
 * Sidebar pin popover. Lists existing boards (with a check when the current
 * window is already pinned to that board — clicking toggles pin/unpin), plus
 * an inline text input "Pin to new board…" that creates a new board on Enter.
 *
 * Validation errors render inline. Closes on Escape or outside-click.
 */
export function PinPopover({ server, windowId, boards, isPinnedTo, onClose }: PinPopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { pin, unpin } = usePinActions();

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [onClose]);

  // Close on outside click — defer attach so the click that opened the popover
  // isn't itself the closer.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  // Autofocus the inline input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleToggleExisting(boardName: string) {
    setError(null);
    if (isPinnedTo(boardName)) {
      await unpin(server, windowId, boardName);
    } else {
      await pin(server, windowId, boardName);
    }
    onClose();
  }

  async function handleSubmitNew() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    if (!ValidBoardName(trimmed)) {
      setError("Board name must be alphanumeric, hyphen, or underscore (1–32 chars).");
      return;
    }
    setError(null);
    await pin(server, windowId, trimmed);
    onClose();
  }

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label="Pin window to board"
      className="absolute right-0 top-full z-50 mt-1 bg-bg-primary border border-border rounded-md shadow-lg py-1 min-w-[200px] max-w-[260px]"
    >
      {boards.length > 0 && (
        <ul className="flex flex-col">
          {boards.map((b) => {
            const pinned = isPinnedTo(b.name);
            return (
              <li key={b.name}>
                <button
                  type="button"
                  onClick={() => handleToggleExisting(b.name)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-left text-text-primary hover:bg-bg-card transition-colors"
                >
                  <span className="truncate">{b.name}</span>
                  {pinned ? (
                    <span className="text-accent text-xs" aria-label="pinned">
                      ✓
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {boards.length > 0 && <div className="border-t border-border my-1" />}
      <div className="px-2 pb-1.5">
        <input
          ref={inputRef}
          type="text"
          value={newName}
          onChange={(e) => {
            setNewName(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSubmitNew();
            }
          }}
          placeholder="Pin to new board..."
          aria-label="Pin to new board"
          className="w-full bg-transparent text-sm text-text-primary border border-border rounded px-2 py-1 outline-none focus:border-text-secondary placeholder:text-text-secondary"
        />
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-500">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

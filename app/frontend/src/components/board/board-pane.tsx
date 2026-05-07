import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { TerminalClient } from "@/components/terminal-client";
import { BoardHeader } from "./board-header";
import type { BoardEntry } from "@/api/boards";

export interface BoardPaneHandle {
  focus: () => void;
}

interface BoardPaneProps {
  entry: BoardEntry;
  width: number; // px on desktop
  paused?: boolean; // mobile carousel: when true, terminal is unmounted (WebSocket closes)
  isFocused: boolean;
  onClick: () => void;
  onUnpin: () => void;
  showResizeHandle: boolean;
  onResizeStart?: (clientX: number) => void;
}

/**
 * A single pane on the board: header + live xterm. Implements the BoardPaneHandle
 * imperative `focus()` so the parent can implement `Cmd+]` cycling without
 * threading focus state through every render.
 *
 * When `paused`, the TerminalClient is unmounted — its WebSocket closes per
 * the existing TerminalClient cleanup pattern (sync.Once on the relay side).
 * Re-mounting on swipe-in re-establishes the connection.
 */
export const BoardPane = forwardRef<BoardPaneHandle, BoardPaneProps>(function BoardPane(
  { entry, width, paused = false, isFocused, onClick, onUnpin, showResizeHandle, onResizeStart },
  ref,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const focusFnRef = useRef<(() => void) | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);

  useImperativeHandle(ref, () => ({
    focus() {
      focusFnRef.current?.();
    },
  }));

  return (
    <div
      role="group"
      aria-label={`board pane ${entry.windowName}`}
      onClick={onClick}
      className={`relative flex flex-col shrink-0 h-full bg-bg-primary border ${
        isFocused ? "border-accent shadow-[0_0_0_1px_var(--color-accent)]" : "border-border opacity-90"
      }`}
      style={{ width }}
    >
      <BoardHeader entry={entry} onUnpin={onUnpin} />
      <div className="flex-1 min-h-0 px-1 py-0.5 flex flex-col">
        {!paused && (
          <TerminalClient
            sessionName={entry.session}
            windowIndex={String(entry.windowIndex)}
            server={entry.server}
            wsRef={wsRef}
            composeOpen={composeOpen}
            setComposeOpen={setComposeOpen}
            focusRef={focusFnRef}
          />
        )}
      </div>
      {showResizeHandle && onResizeStart && (
        <div
          aria-label="resize pane"
          onPointerDown={(e) => {
            e.preventDefault();
            onResizeStart(e.clientX);
          }}
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/30 hidden coarse:hidden md:block"
        />
      )}
    </div>
  );
});

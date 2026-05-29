import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { TerminalClient } from "@/components/terminal-client";
import { useFocusedTerminal } from "@/contexts/focused-terminal-context";
import { BoardHeader } from "./board-header";
import type { BoardEntry } from "@/api/boards";

export interface BoardPaneHandle {
  focus: () => void;
}

interface BoardPaneProps {
  entry: BoardEntry;
  /**
   * Pane width in px. Optional — when omitted, the pane uses CSS sizing
   * (`w-full`) so the parent layout controls the width. Desktop row passes a
   * concrete number (resizable per-pane); mobile carousel omits it and lets
   * the wrapper's `w-full` drive the width, which keeps the pane reactive to
   * viewport changes (orientation/resize) without reading `window.innerWidth`
   * at render time.
   */
  width?: number;
  paused?: boolean; // mobile carousel: when true, terminal is unmounted (WebSocket closes)
  isFocused: boolean;
  onClick: () => void;
  onUnpin: () => void;
  showResizeHandle: boolean;
  onResizeStart?: (clientX: number) => void;
  /** When `true`, this pane's TerminalClient suppresses xterm focus on
   * touchend (long-press scroll-lock). Forwarded from the BoardPage's
   * shell-level scroll-lock state. */
  scrollLocked?: boolean;
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
  { entry, width, paused = false, isFocused, onClick, onUnpin, showResizeHandle, onResizeStart, scrollLocked },
  ref,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const focusFnRef = useRef<(() => void) | null>(null);
  // Compose state lives in `FocusedTerminalContext` so the shell-level
  // `<BottomBar>` can open compose for the focused pane without owning the
  // state. Each pane gates ComposeBuffer rendering on `isFocused &&
  // composeOpen` so only the focused pane shows the buffer; cycling focus
  // while compose is open does NOT retarget because (a) only one
  // TerminalClient renders ComposeBuffer at a time and (b) ComposeBuffer
  // snapshots its `wsRef` on mount (see `compose-buffer.tsx` line 34).
  const { setFocused, composeOpen, setComposeOpen } = useFocusedTerminal();
  const composeOpenForPane = isFocused && composeOpen;

  useImperativeHandle(ref, () => ({
    focus() {
      focusFnRef.current?.();
    },
  }));

  // Register this pane as the BottomBar's focused input target whenever it
  // is the focused pane (parent sets `isFocused={idx === focusedIndex}`).
  // Click, cycle (Cmd+]/Cmd+[), and the initial pane on mount all flow
  // through this effect. We do NOT clear on focus loss — the next pane to
  // gain focus overwrites, which avoids a transient `null` state where the
  // BottomBar would briefly be inert. The inner `TerminalClient` is rendered
  // with `registerFocus={false}` (board panes opt out of the per-terminal
  // self-registration), so this pane-level effect is the single registration
  // path for board mode — no last-write-wins coordination required.
  useEffect(() => {
    if (!isFocused) return;
    setFocused({
      wsRef,
      server: entry.server,
      session: entry.session,
      windowId: entry.windowId,
    });
  }, [isFocused, setFocused, entry.server, entry.session, entry.windowId]);

  return (
    <div
      role="group"
      aria-label={`board pane ${entry.windowName}`}
      onClick={onClick}
      className={`relative flex flex-col shrink-0 h-full bg-bg-primary border ${
        width === undefined ? "w-full" : ""
      } ${
        isFocused ? "border-accent shadow-[0_0_0_1px_var(--color-accent)]" : "border-border opacity-90"
      }`}
      style={width !== undefined ? { width } : undefined}
    >
      <BoardHeader entry={entry} onUnpin={onUnpin} />
      <div className="flex-1 min-h-0 px-1 py-0.5 flex flex-col">
        {!paused && (
          <TerminalClient
            sessionName={entry.session}
            windowId={entry.windowId}
            server={entry.server}
            wsRef={wsRef}
            composeOpen={composeOpenForPane}
            setComposeOpen={setComposeOpen}
            focusRef={focusFnRef}
            registerFocus={false}
            scrollLocked={scrollLocked}
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

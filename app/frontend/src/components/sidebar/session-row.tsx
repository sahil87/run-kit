import { useState, useRef, useMemo, memo } from "react";
import type { ProjectSession } from "@/types";
import type { MergedSession } from "@/contexts/optimistic-context";
import type { RowTint } from "@/themes";
import { SwatchPopover } from "@/components/swatch-popover";

type SessionRowProps = {
  /** Tmux server this session belongs to — bound into the identity-arg
   *  handlers below so a single stable handler reference serves every row.
   *  This is what makes React.memo on SessionRow effective across SSE ticks. */
  server: string;
  session: ProjectSession | MergedSession;
  /** Color value descriptor: "4" for a single ANSI index, "1+3" for a blend. */
  sessionColor?: string;
  rowTints?: Map<string, RowTint>;
  isCollapsed: boolean;
  isSessionDropTarget: boolean;
  editingSession: string | null;
  editingSessionName: string;
  sessionInputRef: React.RefObject<HTMLInputElement | null>;
  draggable?: boolean;
  isDragSource?: boolean;
  /** Group-scoped ordered session names — stable (memoized) in ServerGroup;
   *  passed straight through and bound into the reorder-start/over closures. */
  orderedNames: string[];
  onDragStart?: (e: React.DragEvent, server: string, name: string, orderedNames: string[]) => void;
  onDragEnd?: () => void;
  onToggleCollapse: (server: string, name: string) => void;
  onSelectFirstWindow: (server: string, session: string, windowId: string) => void;
  onCreateWindow: (server: string, session: string) => void;
  onKillClick: (server: string, name: string, windowCount: number, ctrl: boolean) => void;
  onDoubleClickName: (server: string, name: string) => void;
  onSessionNameChange: (value: string) => void;
  onSessionRenameKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onSessionRenameBlur: () => void;
  /** Cross-session window drag-over (its own server/name binding) AND session
   *  reorder-over (needs orderedNames). The row invokes both. */
  onDragOver: (e: React.DragEvent, server: string, name: string) => void;
  onReorderOver: (e: React.DragEvent, server: string, targetName: string, naturalNames: string[]) => void;
  onDragLeave: (e: React.DragEvent, server: string, name: string) => void;
  onDrop: (e: React.DragEvent, server: string, name: string) => void;
  onColorChange?: (server: string, name: string, color: string | null) => void;
  /** Roving-tabindex value: `0` for the single roving-focused tree row, `-1`
   *  otherwise. Defaults to `-1`. Only the two affected rows change this per
   *  arrow keypress, preserving the Wave-2 memo tree. */
  tabIndex?: number;
  /** W3C-APG tree node metadata. Session rows are level-1 nodes. `ariaSetSize`
   *  is the count of sibling sessions in the group; `ariaPosInSet` the row's
   *  1-based position among them. `windowGroupId` is the `id` of the
   *  `role="group"` window-list container, referenced by `aria-controls`
   *  ONLY while expanded (the group is unmounted when collapsed).
   *  Omitted ⇒ not announced (e.g. unit tests rendering a bare row). */
  ariaSetSize?: number;
  ariaPosInSet?: number;
  windowGroupId?: string;
  /** Stable DOM handle for the roving-focus effect to query — analogous to the
   *  window row's `data-window-id`. Value is the `${server}:${name}` key. */
  sessionRowKey?: string;
};

function SessionRowInner({
  server,
  session,
  sessionColor,
  rowTints,
  isCollapsed,
  isSessionDropTarget,
  editingSession,
  editingSessionName,
  sessionInputRef,
  draggable,
  isDragSource,
  orderedNames,
  onDragStart,
  onDragEnd,
  onToggleCollapse,
  onSelectFirstWindow,
  onCreateWindow,
  onKillClick,
  onDoubleClickName,
  onSessionNameChange,
  onSessionRenameKeyDown,
  onSessionRenameBlur,
  onDragOver,
  onReorderOver,
  onDragLeave,
  onDrop,
  onColorChange,
  tabIndex = -1,
  ariaSetSize,
  ariaPosInSet,
  windowGroupId,
  sessionRowKey,
}: SessionRowProps) {
  const name = session.name;
  const [showColorPicker, setShowColorPicker] = useState(false);
  const colorBtnRef = useRef<HTMLButtonElement>(null);

  const tint = useMemo(() => {
    if (sessionColor == null || !rowTints) return null;
    return rowTints.get(sessionColor) ?? null;
  }, [sessionColor, rowTints]);

  const rowStyle = useMemo(() => {
    if (isSessionDropTarget) {
      return { boxShadow: "inset 0 0 0 2px var(--color-accent)", borderRadius: "4px" };
    }
    if (tint) {
      return { backgroundColor: tint.base };
    }
    return undefined;
  }, [isSessionDropTarget, tint]);

  return (
    <div
      // W3C-APG tree node (level 1). `aria-expanded` mirrors the chevron's own
      // (lifted onto the treeitem); `aria-controls` points at the window-list
      // group's id. The roving model in index.tsx threads `tabIndex` + set/pos.
      role="treeitem"
      aria-level={1}
      aria-expanded={!isCollapsed}
      // Reference the window-list group ONLY while expanded — the role="group"
      // list is mounted (index.tsx) only when !isCollapsed, so a collapsed row
      // pointing aria-controls at an unmounted id would be invalid ARIA.
      aria-controls={isCollapsed ? undefined : windowGroupId}
      aria-setsize={ariaSetSize}
      aria-posinset={ariaPosInSet}
      tabIndex={tabIndex}
      data-session-row={sessionRowKey}
      className={`flex items-center justify-between group pl-1.5 sm:pl-2 relative${tint ? "" : " hover:bg-bg-card/50"} transition-colors${isDragSource ? " opacity-50" : ""}`}
      draggable={draggable}
      onDragStart={onDragStart ? (e) => onDragStart(e, server, name, orderedNames) : undefined}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        onDragOver(e, server, name);
        onReorderOver(e, server, name, orderedNames);
      }}
      onDragLeave={(e) => onDragLeave(e, server, name)}
      onDrop={(e) => onDrop(e, server, name)}
      style={rowStyle}
      onMouseEnter={tint ? (e) => { (e.currentTarget as HTMLElement).style.backgroundColor = tint.hover; } : undefined}
      onMouseLeave={tint ? (e) => { (e.currentTarget as HTMLElement).style.backgroundColor = tint.base; } : undefined}
    >
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <button
          onClick={() => onToggleCollapse(server, name)}
          className="text-xs text-text-secondary hover:text-text-primary transition-colors shrink-0 min-h-[36px] flex items-center justify-center"
          aria-expanded={!isCollapsed}
          aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${session.name}`}
        >
          <span
            className="inline-block transition-transform duration-150"
            style={{ transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
            aria-hidden="true"
          >
            &#x25BC;
          </span>
        </button>
        <button
          onClick={() => onSelectFirstWindow(server, name, session.windows[0]?.windowId ?? "")}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (editingSession !== name) onDoubleClickName(server, name);
          }}
          className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors py-1 min-h-[36px] min-w-0 flex-1"
          aria-label={`Navigate to ${session.name}`}
        >
          {editingSession === session.name ? (
            <input
              ref={sessionInputRef}
              type="text"
              value={editingSessionName}
              onChange={(e) => onSessionNameChange(e.target.value)}
              onKeyDown={onSessionRenameKeyDown}
              onBlur={onSessionRenameBlur}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="text-xs font-medium bg-transparent border border-accent rounded px-0.5 outline-none truncate w-full"
              aria-label="Rename session"
            />
          ) : (
            <span className="font-medium truncate">
              {session.name}
            </span>
          )}
        </button>
      </div>
      <div className="flex items-center pr-2">
        {onColorChange && (
          <button
            ref={colorBtnRef}
            onClick={(e) => {
              e.stopPropagation();
              setShowColorPicker((v) => !v);
            }}
            aria-label={`Set color for ${session.name}`}
            className="text-text-secondary hover:text-text-primary transition-opacity opacity-0 group-hover:opacity-100 coarse:opacity-100 text-[12px] px-0.5 min-h-[36px] flex items-center justify-center"
          >
            &#x25A0;
          </button>
        )}
        <button
          onClick={() => onCreateWindow(server, name)}
          aria-label={`New window in ${session.name}`}
          className="text-text-secondary hover:text-text-primary transition-colors text-[16px] px-1 min-h-[36px] flex items-center justify-center"
        >
          +
        </button>
        <button
          onClick={(e) => onKillClick(server, name, session.windows.length, e.ctrlKey || e.metaKey)}
          aria-label={`Kill session ${session.name}`}
          className="text-text-secondary hover:text-red-400 transition-colors text-[16px] px-1 min-h-[36px] flex items-center justify-center"
        >
          {"\u2715"}
        </button>
      </div>
      {showColorPicker && onColorChange && (
        <div className="absolute right-0 top-full z-50">
          <SwatchPopover
            selectedColor={sessionColor}
            onSelect={(c) => {
              onColorChange(server, name, c);
              setShowColorPicker(false);
            }}
            onClose={() => setShowColorPicker(false)}
          />
        </div>
      )}
    </div>
  );
}

/** Memoized session row. With the parent passing identity-arg handlers + a
 *  stable `orderedNames`, an SSE session tick that does not change THIS row's
 *  inputs no longer re-renders it. */
export const SessionRow = memo(SessionRowInner);

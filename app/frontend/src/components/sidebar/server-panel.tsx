import { useState, useCallback, useRef, useEffect } from "react";
import { CollapsiblePanel } from "./collapsible-panel";
import { LogoSpinner } from "@/components/logo-spinner";
import { UNCOLORED_SELECTED_KEY, type RowTint } from "@/themes";
import { isInfraServer, type ServerInfo } from "@/api/client";
import { useServerReorder, type ServerTileDragProps } from "@/hooks/use-server-reorder";
import { useToast } from "@/components/toast";
import { WaitingBadge } from "@/components/waiting-badge";

type ServerPanelProps = {
  server: string;
  servers: ServerInfo[];
  /** server name → color value descriptor ("4" / "1+3"). */
  serverColors: Record<string, string>;
  /** server name → count of waiting windows (from countWaitingInSessions).
   *  Attached-server-only by construction: an unattached server has no windows
   *  streamed, so its count is 0 and the tile's badge is simply absent. */
  waitingCounts?: Map<string, number>;
  rowTints?: Map<string, RowTint>;
  /** Contrast-adjusted full-saturation border color per color value. */
  rowBorders?: Map<string, string>;
  onSwitchServer: (name: string) => void;
  onCreateServer: () => void;
  onRefreshServers: () => void;
  /** Forwarded to CollapsiblePanel's corner affordance. When supplied, a corner
   *  element renders at the bottom-right of the drag handle and initiates a
   *  sidebar-width drag in addition to the panel's vertical resize. */
  onSidebarResizeStart?: (e: React.PointerEvent<HTMLDivElement>) => void;
};

/** Matches coarse-pointer (touch) devices and viewports narrower than 640px. */
function useIsMobileLayout(): boolean {
  const query = "(pointer: coarse), (max-width: 639px)";
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

/** Singular-aware tooltip wording: "5 windows across 2 sessions". */
function windowCountTooltip(windowCount: number, sessionCount: number): string {
  const w = `${windowCount} window${windowCount === 1 ? "" : "s"}`;
  const s = `${sessionCount} session${sessionCount === 1 ? "" : "s"}`;
  return `${w} across ${s}`;
}

export function ServerPanel({
  server,
  servers,
  serverColors,
  waitingCounts,
  rowTints,
  rowBorders,
  onSwitchServer,
  onCreateServer,
  onRefreshServers,
  onSidebarResizeStart,
}: ServerPanelProps) {
  const [refreshing, setRefreshing] = useState(false);
  const isMobile = useIsMobileLayout();
  const activeTileRef = useRef<HTMLButtonElement>(null);
  const { addToast } = useToast();
  // Drag-reorder for regular server tiles (shared with the Host grid).
  // `servers` is already effective-sorted upstream; the hook returns the
  // transient optimistic order to render while a drag is in progress.
  const { orderedServers, getTileProps, isDragging, draggingName } = useServerReorder(servers, addToast);

  const handleToggle = useCallback(
    (isOpen: boolean) => {
      if (isOpen) {
        setRefreshing(true);
        Promise.resolve(onRefreshServers()).finally(() => setRefreshing(false));
      }
    },
    [onRefreshServers],
  );

  // Scroll the active tile into view on mount and on server change — both
  // layouts: `block: "nearest"` handles the vertical desktop tile grid (which
  // scrolls internally inside the resizable CollapsiblePanel), `inline:
  // "nearest"` the horizontal mobile single-row strip. The `typeof` guard
  // covers jsdom, which lacks scrollIntoView.
  useEffect(() => {
    const el = activeTileRef.current;
    if (!el || typeof el.scrollIntoView !== "function") return;
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [server]);

  // The active server's name is NOT repeated here — the highlighted tile and
  // the top-bar page heading already show it. Only the refresh spinner rides
  // the header-right slot.
  const headerRight = <>{refreshing && <LogoSpinner size={10} />}</>;

  const gridStyle: React.CSSProperties = isMobile
    ? {
        gridAutoFlow: "column",
        gridAutoColumns: "72px",
        overflowX: "auto",
        overflowY: "hidden",
        scrollSnapType: "x mandatory",
      }
    : {
        // 72px floor (matching the mobile column width): the tile's count row
        // holds a bare window-count number plus the waiting rollup badge — the
        // old 88px floor existed only to fit the wider "N sess" text beside
        // the badge.
        gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
      };

  return (
    <CollapsiblePanel
      title="Server"
      storageKey="runkit-panel-server"
      defaultOpen={true}
      onToggle={handleToggle}
      headerRight={headerRight}
      contentClassName="px-1.5 sm:px-2 pt-1.5 pb-1.5"
      headerAction={
        <button
          onClick={onCreateServer}
          aria-label="New tmux server"
          className="text-text-secondary hover:text-text-primary transition-colors text-[13px] px-1 flex items-center justify-center"
        >
          +
        </button>
      }
      resizable
      defaultHeight={50}
      minHeight={50}
      mobileHeight={50}
      onCornerPointerDown={onSidebarResizeStart}
    >
      {servers.length === 0 ? (
        <span className="block text-xs text-text-secondary py-1">No servers</span>
      ) : (
        <div
          className="grid gap-1.5"
          style={gridStyle}
          role="listbox"
          aria-label="Tmux servers"
        >
          {orderedServers.map(({ name, sessionCount, windowCount }) => {
            const color = serverColors[name];
            const tint = color != null && rowTints ? rowTints.get(color) ?? null : null;
            const uncoloredSelectedTint = rowTints?.get(UNCOLORED_SELECTED_KEY) ?? null;
            const isActive = name === server;
            // Stripe mirrors window-row's left-border treatment: colored only when active;
            // transparent otherwise (height reserved to avoid text shift between states).
            // Border color is the contrast-adjusted full-saturation hex from rowBorders.
            const stripeBg = !isActive
              ? "transparent"
              : color != null && rowBorders
              ? rowBorders.get(color) ?? "var(--color-border)"
              : rowBorders
              ? rowBorders.get(UNCOLORED_SELECTED_KEY) ?? "var(--color-border)"
              : "var(--color-border)";
            return (
              <ServerTile
                key={name}
                name={name}
                sessionCount={sessionCount}
                windowCount={windowCount ?? 0}
                waitingCount={waitingCounts?.get(name) ?? 0}
                tint={tint}
                uncoloredSelectedTint={uncoloredSelectedTint}
                stripeBg={stripeBg}
                isActive={isActive}
                isMobile={isMobile}
                dragProps={getTileProps(name)}
                isDragSource={isDragging && draggingName === name}
                tileRef={isActive ? activeTileRef : undefined}
                onClick={() => onSwitchServer(name)}
              />
            );
          })}
        </div>
      )}
    </CollapsiblePanel>
  );
}

type ServerTileProps = {
  name: string;
  sessionCount: number;
  /** Total windows across the server's sessions — the tile's count number. */
  windowCount: number;
  /** Count of waiting windows on this server; 0 renders no badge. */
  waitingCount: number;
  tint: RowTint | null;
  uncoloredSelectedTint: RowTint | null;
  stripeBg: string;
  isActive: boolean;
  isMobile: boolean;
  /** HTML5 drag-reorder props (from useServerReorder). Infra tiles receive
   *  `{ draggable: false }` with no handlers. */
  dragProps: ServerTileDragProps;
  /** True while THIS tile is the active drag source — dims it (`opacity-50`)
   *  as drag-source feedback, matching the session-reorder treatment. */
  isDragSource: boolean;
  tileRef?: React.Ref<HTMLButtonElement>;
  onClick: () => void;
};

function ServerTile({
  name,
  sessionCount,
  windowCount,
  waitingCount,
  tint,
  uncoloredSelectedTint,
  stripeBg,
  isActive,
  isMobile,
  dragProps,
  isDragSource,
  tileRef,
  onClick,
}: ServerTileProps) {
  // Body background follows the window-row convention:
  //   - Colored: tint.selected (active) or tint.base (not active)
  //   - Uncolored active: borrow the gray UNCOLORED_SELECTED_ANSI tint
  //   - Uncolored non-active: no background, subtle hover via Tailwind class
  const bodyBg = isActive
    ? tint?.selected ?? uncoloredSelectedTint?.selected
    : tint?.base;
  const uncoloredHoverClass = !tint && !isActive ? "hover:bg-bg-card/50" : "";
  // De-emphasize infrastructure servers (daemon + test sockets): grey the name,
  // not disabled. Hover/click/active-selection stay unchanged so the tile
  // remains fully attachable and never reads as dead/disconnected.
  const nameClass = isInfraServer(name) ? "text-text-secondary" : "text-text-primary";

  return (
    <div
      className={`relative${isDragSource ? " opacity-50" : ""}`}
      style={{ scrollSnapAlign: isMobile ? "start" : undefined }}
      draggable={dragProps.draggable}
      onDragStart={dragProps.onDragStart}
      onDragOver={dragProps.onDragOver}
      onDragEnd={dragProps.onDragEnd}
      onDrop={dragProps.onDrop}
    >
      <button
        ref={tileRef}
        onClick={onClick}
        aria-current={isActive ? "true" : undefined}
        role="option"
        aria-selected={isActive}
        title={`${name} — ${windowCountTooltip(windowCount, sessionCount)}`}
        className={`relative block w-full text-left border border-border overflow-hidden transition-colors hover:border-text-secondary ${uncoloredHoverClass}`}
        style={bodyBg ? { backgroundColor: bodyBg } : undefined}
      >
        {/* Top color stripe — the server signature/active marker (top border =
            server, left border = window rows). */}
        <div className="h-0.5" style={{ backgroundColor: stripeBg }} />
        {/* Body */}
        <div className="px-1.5 pt-0.5 pb-1.5">
          <div className={`text-[11px] leading-tight font-medium ${nameClass} whitespace-nowrap overflow-hidden text-ellipsis`}>
            {name}
          </div>
          {/* Window count + waiting rollup (260708-4li7): a bare window-count
              number (full wording lives in the tile button's title tooltip)
              with the badge right-aligned on the same flex row — the count row
              is the badge's home. WaitingBadge renders null at count <= 0, so
              the common (nothing-waiting) layout is unchanged. */}
          {/* h-3.5 reserves the badge's full height even when no badge renders:
              the pill is taller than the count text, so without the reserve the
              tile (and its whole grid row) would jump in height every time an
              agent starts/stops waiting. */}
          <div className="flex h-3.5 items-center justify-between mt-0.5">
            <div className="text-[10px] leading-tight text-text-secondary">
              {windowCount}
            </div>
            <WaitingBadge count={waitingCount} />
          </div>
        </div>
      </button>
    </div>
  );
}

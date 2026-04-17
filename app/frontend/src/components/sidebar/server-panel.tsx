import { useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { CollapsiblePanel } from "./collapsible-panel";
import { LogoSpinner } from "@/components/logo-spinner";
import { SwatchPopover } from "@/components/swatch-popover";
import { UNCOLORED_SELECTED_ANSI, type RowTint } from "@/themes";
import type { ServerInfo } from "@/api/client";

type ServerPanelProps = {
  server: string;
  servers: ServerInfo[];
  serverColors: Record<string, number>;
  rowTints?: Map<number, RowTint>;
  ansiPalette?: readonly string[];
  onSwitchServer: (name: string) => void;
  onCreateServer: () => void;
  onKillServer: () => void;
  onRefreshServers: () => void;
  onServerColorChange?: (server: string, color: number | null) => void;
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

export function ServerPanel({
  server,
  servers,
  serverColors,
  rowTints,
  ansiPalette,
  onSwitchServer,
  onCreateServer,
  onKillServer,
  onRefreshServers,
  onServerColorChange,
}: ServerPanelProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [colorPickerFor, setColorPickerFor] = useState<string | null>(null);
  const isMobile = useIsMobileLayout();
  const activeTileRef = useRef<HTMLButtonElement>(null);

  const handleToggle = useCallback(
    (isOpen: boolean) => {
      if (isOpen) {
        setRefreshing(true);
        Promise.resolve(onRefreshServers()).finally(() => setRefreshing(false));
      }
    },
    [onRefreshServers],
  );

  // Scroll active tile into view on mount (important for mobile single-row layout).
  useEffect(() => {
    if (!isMobile) return;
    const el = activeTileRef.current;
    if (!el || typeof el.scrollIntoView !== "function") return;
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [isMobile, server]);

  const activeColor = serverColors[server];
  const activeTint = activeColor != null && rowTints ? rowTints.get(activeColor) ?? null : null;
  const headerRight = refreshing ? <LogoSpinner size={10} /> : null;

  const gridStyle: React.CSSProperties = isMobile
    ? {
        gridAutoFlow: "column",
        gridAutoColumns: "88px",
        overflowX: "auto",
        overflowY: "hidden",
        scrollSnapType: "x mandatory",
      }
    : {
        gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
      };

  return (
    <CollapsiblePanel
      title={`Tmux \u00B7 ${server}`}
      storageKey="runkit-panel-server"
      defaultOpen={false}
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
      tint={activeTint}
      resizable
      defaultHeight={60}
      minHeight={60}
      mobileHeight={56}
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
          {servers.map(({ name, sessionCount }) => {
            const color = serverColors[name];
            const tint = color != null && rowTints ? rowTints.get(color) ?? null : null;
            const uncoloredSelectedTint = rowTints?.get(UNCOLORED_SELECTED_ANSI) ?? null;
            const isActive = name === server;
            // Stripe mirrors window-row's left-border treatment: colored only when active;
            // transparent otherwise (height reserved to avoid text shift between states).
            const stripeBg = !isActive
              ? "transparent"
              : color != null && ansiPalette
              ? ansiPalette[color]
              : ansiPalette
              ? ansiPalette[UNCOLORED_SELECTED_ANSI]
              : "var(--color-border)";
            return (
              <ServerTile
                key={name}
                name={name}
                sessionCount={sessionCount}
                tint={tint}
                uncoloredSelectedTint={uncoloredSelectedTint}
                stripeBg={stripeBg}
                isActive={isActive}
                isMobile={isMobile}
                tileRef={isActive ? activeTileRef : undefined}
                onClick={() => onSwitchServer(name)}
                onKill={isActive ? onKillServer : undefined}
                onColorClick={
                  onServerColorChange
                    ? () => setColorPickerFor((prev) => (prev === name ? null : name))
                    : undefined
                }
                colorPickerOpen={colorPickerFor === name}
                colorPickerNode={
                  colorPickerFor === name && onServerColorChange ? (
                    <SwatchPopover
                      selectedColor={serverColors[name]}
                      onSelect={(c) => {
                        onServerColorChange(name, c);
                        setColorPickerFor(null);
                      }}
                      onClose={() => setColorPickerFor(null)}
                    />
                  ) : null
                }
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
  tint: RowTint | null;
  uncoloredSelectedTint: RowTint | null;
  stripeBg: string;
  isActive: boolean;
  isMobile: boolean;
  tileRef?: React.Ref<HTMLButtonElement>;
  onClick: () => void;
  onKill?: () => void;
  onColorClick?: () => void;
  colorPickerOpen: boolean;
  colorPickerNode: React.ReactNode;
};

function ServerTile({
  name,
  sessionCount,
  tint,
  uncoloredSelectedTint,
  stripeBg,
  isActive,
  isMobile,
  tileRef,
  onClick,
  onKill,
  onColorClick,
  colorPickerOpen,
  colorPickerNode,
}: ServerTileProps) {
  // Body background follows the window-row convention:
  //   - Colored: tint.selected (active) or tint.base (not active)
  //   - Uncolored active: borrow the gray UNCOLORED_SELECTED_ANSI tint
  //   - Uncolored non-active: no background, subtle hover via Tailwind class
  const bodyBg = isActive
    ? tint?.selected ?? uncoloredSelectedTint?.selected
    : tint?.base;
  const uncoloredHoverClass = !tint && !isActive ? "hover:bg-bg-card/50" : "";
  const showActions = !isMobile && (onColorClick || (isActive && onKill));

  const tileWrapperRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; right: number } | null>(null);

  // Position the portalled color picker relative to the tile. Flip above when
  // there isn't enough room below (e.g., tile near the bottom of the viewport).
  useLayoutEffect(() => {
    if (!colorPickerOpen || !tileWrapperRef.current) {
      setPopoverPos(null);
      return;
    }
    const rect = tileWrapperRef.current.getBoundingClientRect();
    const approxPopoverHeight = 100; // rough; fine for flip heuristic
    const below = rect.bottom + 4;
    const fitsBelow = below + approxPopoverHeight <= window.innerHeight;
    const top = fitsBelow ? below : Math.max(4, rect.top - approxPopoverHeight - 4);
    setPopoverPos({
      top,
      right: Math.max(4, window.innerWidth - rect.right),
    });
  }, [colorPickerOpen]);

  return (
    <div
      ref={tileWrapperRef}
      className="relative group focus-within:z-10"
      style={{ scrollSnapAlign: isMobile ? "start" : undefined }}
    >
      <button
        ref={tileRef}
        onClick={onClick}
        aria-current={isActive ? "true" : undefined}
        role="option"
        aria-selected={isActive}
        title={name}
        className={`relative block w-full text-left border border-border overflow-hidden transition-colors hover:border-text-secondary ${uncoloredHoverClass}`}
        style={bodyBg ? { backgroundColor: bodyBg } : undefined}
      >
        {/* Top color stripe */}
        <div className="h-1" style={{ backgroundColor: stripeBg }} />
        {/* Body */}
        <div className="px-1.5 pt-1 pb-1.5">
          <div className="text-[11px] leading-tight font-medium text-text-primary whitespace-nowrap overflow-hidden text-ellipsis">
            {name}
          </div>
          <div className="text-[10px] leading-tight text-text-secondary mt-0.5">
            {sessionCount} sess
          </div>
        </div>
      </button>

      {/* Hover-revealed actions — sibling of the tile button to avoid nested buttons.
          Opacity-based reveal (rather than `display: none`) keeps the buttons in the DOM
          and in tab order so keyboard users can focus them. `group-focus-within:opacity-100`
          also reveals on keyboard focus. `z-10` keeps actions on top of the tile. */}
      {showActions && (
        <div className="absolute top-1 right-1 flex gap-0.5 z-10 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          {onColorClick && (
            <button
              type="button"
              aria-label={`Set color for server ${name}`}
              onClick={onColorClick}
              className="text-text-secondary hover:text-text-primary text-[11px] leading-none px-0.5 py-0.5"
            >
              &#x25A0;
            </button>
          )}
          {isActive && onKill && (
            <button
              type="button"
              aria-label={`Kill server ${name}`}
              onClick={onKill}
              className="text-text-secondary hover:text-red-400 text-[11px] leading-none px-0.5 py-0.5"
            >
              &#x2715;
            </button>
          )}
        </div>
      )}

      {/* Color picker portalled to body so it escapes the panel's overflow-y: auto clip. */}
      {colorPickerOpen && colorPickerNode && popoverPos && createPortal(
        <div
          style={{
            position: "fixed",
            top: popoverPos.top,
            right: popoverPos.right,
            zIndex: 100,
          }}
        >
          {colorPickerNode}
        </div>,
        document.body,
      )}
    </div>
  );
}

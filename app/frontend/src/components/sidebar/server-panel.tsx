import { useState, useCallback, useRef, useEffect } from "react";
import { CollapsiblePanel } from "./collapsible-panel";
import { LogoSpinner } from "@/components/logo-spinner";
import { SwatchPopover } from "@/components/swatch-popover";
import type { RowTint } from "@/themes";
import type { ServerInfo } from "@/api/client";

type ServerPanelProps = {
  server: string;
  servers: ServerInfo[];
  serverColors: Record<string, number>;
  rowTints?: Map<number, RowTint>;
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
      defaultHeight={140}
      minHeight={80}
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
            const isActive = name === server;
            return (
              <ServerTile
                key={name}
                name={name}
                sessionCount={sessionCount}
                tint={tint}
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
  isActive,
  isMobile,
  tileRef,
  onClick,
  onKill,
  onColorClick,
  colorPickerOpen,
  colorPickerNode,
}: ServerTileProps) {
  // Body background: active → selected tint (or accent-subtle fallback); otherwise → base tint or bg-card.
  const activeFallbackBg = "color-mix(in srgb, var(--color-accent) 14%, transparent)";
  const bodyBg = isActive
    ? tint?.selected ?? activeFallbackBg
    : tint?.base ?? "var(--color-bg-card)";
  const stripeBg = tint?.base ?? "var(--color-border)";
  const activeClasses = isActive ? "ring-1 ring-accent ring-inset" : "";
  const showActions = !isMobile && (onColorClick || (isActive && onKill));

  return (
    <div
      className="relative group"
      style={{ scrollSnapAlign: isMobile ? "start" : undefined }}
    >
      <button
        ref={tileRef}
        onClick={onClick}
        aria-current={isActive ? "true" : undefined}
        role="option"
        aria-selected={isActive}
        title={name}
        className={`relative block w-full text-left rounded border border-border bg-bg-card overflow-hidden transition-colors hover:border-text-secondary ${activeClasses}`}
        style={{ backgroundColor: bodyBg }}
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

      {/* Hover-revealed actions — rendered as a sibling to avoid button-in-button.
          The outer `group` container makes `group-hover:flex` respond to hovering
          anywhere on the tile, and `z-10` keeps the actions on top of the tile. */}
      {showActions && (
        <div className="absolute top-1 right-1 hidden group-hover:flex gap-0.5 z-10">
          {onColorClick && (
            <button
              type="button"
              aria-label={`Set color for server ${name}`}
              onClick={onColorClick}
              className="text-text-secondary hover:text-text-primary text-[11px] leading-none px-0.5 py-0.5 rounded bg-bg-card/70"
            >
              &#x25A0;
            </button>
          )}
          {isActive && onKill && (
            <button
              type="button"
              aria-label={`Kill server ${name}`}
              onClick={onKill}
              className="text-text-secondary hover:text-red-400 text-[11px] leading-none px-0.5 py-0.5 rounded bg-bg-card/70"
            >
              &#x2715;
            </button>
          )}
        </div>
      )}

      {colorPickerOpen && (
        <div className="absolute right-0 top-full z-50 mt-1">{colorPickerNode}</div>
      )}
    </div>
  );
}

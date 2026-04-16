import { useState, useCallback, useRef } from "react";
import { CollapsiblePanel } from "./collapsible-panel";
import { LogoSpinner } from "@/components/logo-spinner";
import { SwatchPopover } from "@/components/swatch-popover";
import type { RowTint } from "@/themes";

type ServerPanelProps = {
  server: string;
  servers: string[];
  serverColors: Record<string, number>;
  rowTints?: Map<number, RowTint>;
  onSwitchServer: (name: string) => void;
  onCreateServer: () => void;
  onKillServer: () => void;
  onRefreshServers: () => void;
  onServerColorChange?: (server: string, color: number | null) => void;
};

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
  const colorBtnRef = useRef<HTMLButtonElement>(null);

  const handleToggle = useCallback(
    (isOpen: boolean) => {
      if (isOpen) {
        setRefreshing(true);
        Promise.resolve(onRefreshServers()).finally(() => setRefreshing(false));
      }
    },
    [onRefreshServers],
  );

  const activeColor = serverColors[server];
  const activeTint = activeColor != null && rowTints ? rowTints.get(activeColor) ?? null : null;
  const headerRight = refreshing ? <LogoSpinner size={10} /> : null;

  return (
    <CollapsiblePanel
      title={`Tmux \u00B7 ${server}`}
      storageKey="runkit-panel-server"
      defaultOpen={false}
      onToggle={handleToggle}
      headerRight={headerRight}
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
    >
      <div className="flex flex-col text-xs">
        {servers.length === 0 ? (
          <span className="text-text-secondary py-1">No servers</span>
        ) : (
          servers.map((s) => {
            const color = serverColors[s];
            const tint = color != null && rowTints ? rowTints.get(color) ?? null : null;
            return (
              <div
                key={s}
                className="relative flex items-center justify-between group transition-colors rounded px-1.5 py-0.5"
                style={tint ? { backgroundColor: tint.base } : undefined}
                onMouseEnter={tint ? (e) => { (e.currentTarget as HTMLElement).style.backgroundColor = tint.hover; } : undefined}
                onMouseLeave={tint ? (e) => { (e.currentTarget as HTMLElement).style.backgroundColor = tint.base; } : undefined}
              >
                <button
                  onClick={() => onSwitchServer(s)}
                  aria-current={s === server ? "true" : undefined}
                  className={`flex-1 text-left py-0.5 truncate transition-colors ${
                    s === server
                      ? "text-accent font-medium"
                      : "text-text-primary hover:text-accent"
                  }`}
                >
                  {s}
                </button>
                <div className="flex items-center">
                  {onServerColorChange && (
                    <button
                      ref={s === server ? colorBtnRef : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        setColorPickerFor((prev) => prev === s ? null : s);
                      }}
                      aria-label={`Set color for server ${s}`}
                      className="text-text-secondary hover:text-text-primary transition-opacity opacity-0 group-hover:opacity-100 text-[12px] px-0.5 flex items-center justify-center"
                    >
                      &#x25A0;
                    </button>
                  )}
                  <button
                    onClick={s === server ? onKillServer : undefined}
                    aria-label={`Kill server ${s}`}
                    className={`text-[13px] px-1 shrink-0 transition-colors ${
                      s === server
                        ? "text-text-secondary hover:text-red-400"
                        : "invisible"
                    }`}
                    tabIndex={s === server ? 0 : -1}
                  >
                    {"\u2715"}
                  </button>
                </div>
                {colorPickerFor === s && onServerColorChange && (
                  <div className="absolute right-0 top-full z-50">
                    <SwatchPopover
                      selectedColor={serverColors[s]}
                      onSelect={(c) => {
                        onServerColorChange(s, c);
                        setColorPickerFor(null);
                      }}
                      onClose={() => setColorPickerFor(null)}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </CollapsiblePanel>
  );
}

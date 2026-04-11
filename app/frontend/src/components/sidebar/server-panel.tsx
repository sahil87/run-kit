import { useState, useCallback } from "react";
import { CollapsiblePanel } from "./collapsible-panel";
import { LogoSpinner } from "@/components/logo-spinner";

type ServerPanelProps = {
  server: string;
  servers: string[];
  onSwitchServer: (name: string) => void;
  onCreateServer: () => void;
  onKillServer: () => void;
  onRefreshServers: () => void;
};

export function ServerPanel({
  server,
  servers,
  onSwitchServer,
  onCreateServer,
  onKillServer,
  onRefreshServers,
}: ServerPanelProps) {
  const [refreshing, setRefreshing] = useState(false);

  const handleToggle = useCallback(
    (isOpen: boolean) => {
      if (isOpen) {
        setRefreshing(true);
        Promise.resolve(onRefreshServers()).finally(() => setRefreshing(false));
      }
    },
    [onRefreshServers],
  );

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
    >
      <div className="flex flex-col text-xs">
        {servers.length === 0 ? (
          <span className="text-text-secondary py-1">No servers</span>
        ) : (
          servers.map((s) => (
            <div
              key={s}
              className="flex items-center justify-between group"
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
              {s === server && (
                <button
                  onClick={onKillServer}
                  aria-label={`Kill server ${s}`}
                  className="text-text-secondary hover:text-red-400 transition-colors text-[13px] px-1 shrink-0"
                >
                  {"\u2715"}
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </CollapsiblePanel>
  );
}

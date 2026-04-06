import { useState, useRef, useEffect } from "react";
import { LogoSpinner } from "@/components/logo-spinner";

type ServerSelectorProps = {
  server: string;
  servers: string[];
  onSwitchServer: (name: string) => void;
  onCreateServer: () => void;
  onCreateSession: () => void;
  onKillServer: () => void;
  onRefreshServers: () => void;
};

export function ServerSelector({
  server,
  servers,
  onSwitchServer,
  onCreateServer,
  onCreateSession,
  onKillServer,
  onRefreshServers,
}: ServerSelectorProps) {
  const [serverDropdownOpen, setServerDropdownOpen] = useState(false);
  const [refreshingServers, setRefreshingServers] = useState(false);
  const serverDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!serverDropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (serverDropdownRef.current && !serverDropdownRef.current.contains(e.target as Node)) {
        setServerDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [serverDropdownOpen]);

  return (
    <div className="shrink-0 border-b border-border px-3 sm:px-4 flex items-center justify-between h-[48px]" ref={serverDropdownRef}>
      <div className="flex items-center gap-1.5 relative">
        <span className="text-xs text-text-secondary">tmux server:</span>
        <button
          onClick={() => setServerDropdownOpen((v) => {
            if (!v) {
              setRefreshingServers(true);
              Promise.resolve(onRefreshServers()).finally(() => setRefreshingServers(false));
            }
            return !v;
          })}
          className="text-xs text-text-primary font-medium hover:text-accent transition-colors min-h-[36px] flex items-center gap-1"
          aria-haspopup="listbox"
          aria-expanded={serverDropdownOpen}
        >
          {server}
          {refreshingServers ? (
            <LogoSpinner size={10} />
          ) : (
            <span className="text-text-secondary text-[10px]">{serverDropdownOpen ? "\u25B4" : "\u25BE"}</span>
          )}
        </button>
        {serverDropdownOpen && (
          <div role="menu" className="absolute top-full left-0 mt-1 bg-bg-primary border border-border rounded shadow-2xl z-50 min-w-[140px] py-1">
            <button
              role="menuitem"
              onClick={() => {
                setServerDropdownOpen(false);
                onCreateServer();
              }}
              className="w-full text-left text-sm px-3 py-2 text-text-primary hover:bg-bg-card transition-colors"
            >
              + tmux server
            </button>
            <div className="border-t border-border" />
            {servers.length === 0 ? (
              <div className="text-sm text-text-secondary px-3 py-2">No servers</div>
            ) : (
              servers.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    onSwitchServer(s);
                    setServerDropdownOpen(false);
                  }}
                  className={`w-full text-left text-sm px-3 py-2 hover:bg-bg-card transition-colors ${
                    s === server ? "text-accent font-medium" : "text-text-primary"
                  }`}
                  role="menuitem"
                  aria-current={s === server ? "true" : undefined}
                >
                  {s}
                </button>
              ))
            )}
          </div>
        )}
      </div>
      <div className="flex items-center">
        <button
          onClick={onCreateSession}
          aria-label="New session"
          className="text-text-secondary hover:text-text-primary transition-colors text-[16px] px-1 min-h-[36px] flex items-center justify-center"
        >
          +
        </button>
        <button
          onClick={onKillServer}
          aria-label={`Kill server ${server}`}
          className="text-text-secondary hover:text-red-400 transition-colors text-[16px] px-1 min-h-[36px] flex items-center justify-center"
        >
          {"\u2715"}
        </button>
      </div>
    </div>
  );
}

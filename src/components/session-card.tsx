"use client";

import type { WindowInfo } from "@/lib/types";

type SessionCardProps = {
  window: WindowInfo;
  projectName: string;
  focused: boolean;
  onMouseEnter?: () => void;
  onClick: () => void;
  onKill?: (e: React.MouseEvent) => void;
};

export function SessionCard({
  window: win,
  projectName,
  focused,
  onMouseEnter,
  onClick,
  onKill,
}: SessionCardProps) {
  return (
    <button
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      aria-label={`${win.name} — ${projectName}, ${win.activity}`}
      className={`group w-full text-left p-3 rounded border transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
        focused
          ? "border-accent bg-bg-card/80"
          : "border-border bg-bg-card hover:border-text-secondary"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-text-primary text-sm font-medium truncate">
          {win.name}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {win.fabProgress && (
            <span className="text-xs text-accent px-1.5 py-0.5 rounded bg-accent/10">
              {win.fabProgress}
            </span>
          )}
          <span
            className={`w-2 h-2 rounded-full ${
              win.activity === "active" ? "bg-accent-green" : "bg-text-secondary"
            }`}
            aria-label={win.activity}
          />
          {onKill && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onKill(e);
              }}
              aria-label={`Kill window ${win.name}`}
              className="text-text-secondary hover:text-text-primary transition-colors ml-1 text-xs focus-visible:outline-2 focus-visible:outline-accent"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <div className="text-xs text-text-secondary mt-1 truncate">
        {win.worktreePath}
      </div>
    </button>
  );
}

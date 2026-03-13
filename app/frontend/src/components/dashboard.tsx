import { useNavigate } from "@tanstack/react-router";
import type { ProjectSession } from "@/types";

type DashboardProps = {
  sessions: ProjectSession[];
  onCreateSession: () => void;
};

export function Dashboard({ sessions, onCreateSession }: DashboardProps) {
  const navigate = useNavigate();

  const totalWindows = sessions.reduce((sum, s) => sum + s.windows.length, 0);

  const sessionLabel = sessions.length === 1 ? "session" : "sessions";
  const windowLabel = totalWindows === 1 ? "window" : "windows";

  if (sessions.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-4">
        <p className="text-text-secondary text-sm">No sessions</p>
        <button
          onClick={onCreateSession}
          className="text-sm px-3 py-1 border border-border rounded hover:border-text-secondary"
        >
          + Session
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col p-4 overflow-y-auto">
      <p className="text-text-secondary text-xs mb-3">
        {sessions.length} {sessionLabel}, {totalWindows} {windowLabel}
      </p>
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}
      >
        {sessions.map((session) => {
          const activeCount = session.windows.filter((w) => w.activity === "active").length;
          const idleCount = session.windows.length - activeCount;
          const winCount = session.windows.length;
          const winLabel = winCount === 1 ? "window" : "windows";

          return (
            <button
              key={session.name}
              onClick={() =>
                navigate({
                  to: "/$session",
                  params: { session: session.name },
                })
              }
              className="bg-bg-card border border-border rounded p-4 hover:border-text-secondary text-left transition-colors"
            >
              <p className="text-text-primary font-medium text-sm truncate">
                {session.name}
              </p>
              <p className="text-text-secondary text-xs mt-1">
                {winCount} {winLabel}
              </p>
              <p className="text-text-secondary text-xs mt-0.5">
                {activeCount} active, {idleCount} idle
              </p>
            </button>
          );
        })}
      </div>
      <div className="mt-3">
        <button
          onClick={onCreateSession}
          className="text-sm px-3 py-1 border border-border rounded hover:border-text-secondary"
        >
          + Session
        </button>
      </div>
    </div>
  );
}

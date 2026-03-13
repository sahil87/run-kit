import { useNavigate } from "@tanstack/react-router";
import { parseFabChange, getWindowDuration } from "@/lib/format";
import { createWindow } from "@/api/client";
import type { ProjectSession } from "@/types";

type ProjectPageProps = {
  sessionName: string;
  sessions: ProjectSession[];
};

export function ProjectPage({ sessionName, sessions }: ProjectPageProps) {
  const navigate = useNavigate();

  const session = sessions.find((s) => s.name === sessionName) ?? null;

  if (!session) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-4">
        <p className="text-text-secondary text-sm">Session not found</p>
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate({ to: "/" });
          }}
          className="text-accent text-sm hover:underline"
        >
          Back to dashboard
        </a>
      </div>
    );
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  async function handleCreateWindow() {
    try {
      await createWindow(sessionName, "zsh");
    } catch {
      // SSE will reflect
    }
  }

  if (session.windows.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-4">
        <p className="text-text-secondary text-sm">No windows</p>
        <button
          onClick={handleCreateWindow}
          className="text-sm px-3 py-1 border border-border rounded hover:border-text-secondary"
        >
          + Window
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col p-4 overflow-y-auto">
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}
      >
        {session.windows.map((win) => {
          const duration = getWindowDuration(win, nowSeconds);
          const fabInfo = parseFabChange(win.fabChange ?? "");

          return (
            <button
              key={win.index}
              onClick={() =>
                navigate({
                  to: "/$session/$window",
                  params: { session: sessionName, window: String(win.index) },
                })
              }
              className="bg-bg-card border border-border rounded p-4 hover:border-text-secondary text-left transition-colors"
            >
              <p className="text-text-primary font-medium text-sm truncate">
                {win.name}
              </p>
              {win.paneCommand && (
                <p className="text-text-secondary text-xs mt-1 truncate">
                  {win.paneCommand}
                </p>
              )}
              <div className="flex items-center gap-1.5 mt-1">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    win.activity === "active"
                      ? "bg-accent-green"
                      : "bg-text-secondary/40"
                  }`}
                />
                <span className="text-text-secondary text-xs">
                  {win.activity}
                </span>
                {duration && (
                  <span className="text-text-secondary text-xs">
                    {duration}
                  </span>
                )}
              </div>
              {win.fabStage && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="text-accent text-xs px-1.5 py-0.5 rounded bg-accent/10">
                    {win.fabStage}
                  </span>
                  {fabInfo && (
                    <span className="text-text-secondary text-xs truncate">
                      {fabInfo.id} &middot; {fabInfo.slug}
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-3">
        <button
          onClick={handleCreateWindow}
          className="text-sm px-3 py-1 border border-border rounded hover:border-text-secondary"
        >
          + Window
        </button>
      </div>
    </div>
  );
}

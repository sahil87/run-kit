import { useState, useEffect, useRef, useCallback } from "react";
import { spawnRiff, getRiffPresets, type RiffPreset } from "@/api/client";
import { Dialog } from "@/components/dialog";
import { LogoSpinner } from "@/components/logo-spinner";
import { useSessionContext } from "@/contexts/session-context";

type SpawnAgentDialogProps = {
  /** The target session — the session the user invoked the spawn from. The new
   *  worktree/window is created in this session's repo. */
  session: string;
  /** Navigate to the freshly-spawned window (same server). Wired to app.tsx's
   *  `navigateToWindow`, so it inherits the window-switch transition. */
  onSpawned: (windowId: string) => void;
  onClose: () => void;
};

/**
 * Compact dialog surfacing `rk riff` as a one-action web spawn (260713-sbk1).
 * Two fields — a free-text TASK (optional; empty = blank agent session) and a
 * PRESET dropdown (optional; populated from the session's repo). Enter submits
 * from any field. While the synchronous spawn runs it shows an indeterminate
 * worktree → window → agent pipeline label and disables double-submit; a
 * 400/500 renders in-dialog (nothing was created on a 400) and the dialog stays
 * open for correction. On success it closes and navigates to the new window.
 *
 * Follows the create-session-dialog patterns (Dialog shell, `text-xs` field
 * labels, disabled-submit styling); the busy state deliberately shows no
 * per-step progression because the endpoint is synchronous and emits no
 * per-step events (intake assumption #5 / plan A-7).
 */
export function SpawnAgentDialog({ session, onSpawned, onClose }: SpawnAgentDialogProps) {
  const { currentServer } = useSessionContext();
  const server = currentServer ?? "";

  const [task, setTask] = useState("");
  const [preset, setPreset] = useState("");
  const [presets, setPresets] = useState<RiffPreset[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const taskRef = useRef<HTMLInputElement>(null);
  // Guards against a stale async setState after unmount (the dialog closes on
  // success/Escape while a fetch or spawn may still be in flight).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Fetch presets on open — best-effort: a failure (e.g. non-repo cwd) leaves
  // the dropdown empty/hidden and still allows a task-only spawn.
  useEffect(() => {
    if (!server || !session) return;
    let cancelled = false;
    getRiffPresets(server, session)
      .then((p) => {
        if (!cancelled) setPresets(p);
      })
      .catch(() => {
        if (!cancelled) setPresets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [server, session]);

  useEffect(() => {
    taskRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(() => {
    if (busy) return;
    if (!server || !session) {
      setError("No target session — open a terminal window first.");
      return;
    }
    setBusy(true);
    setError("");
    spawnRiff(server, session, task.trim() || undefined, preset || undefined)
      .then((res) => {
        if (!mountedRef.current) return;
        onClose();
        // windowId is best-effort — the backend returns "" when its
        // display-message window-id resolve fails. Navigating with an empty id
        // would land on a junk /$server/@ URL, so close without navigating and
        // let the SSE stream surface the new row instead.
        if (res.windowId) onSpawned(res.windowId);
      })
      .catch((err: Error) => {
        if (!mountedRef.current) return;
        setBusy(false);
        setError(err.message || "Failed to spawn agent");
      });
  }, [busy, server, session, task, preset, onClose, onSpawned]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <Dialog title="Spawn agent" onClose={onClose}>
      {/* Task */}
      <div className="mb-3">
        <p className="text-xs text-text-secondary mb-1.5">Task (optional):</p>
        <input
          ref={taskRef}
          type="text"
          value={task}
          onChange={(e) => {
            setTask(e.target.value);
            setError("");
          }}
          onKeyDown={handleKeyDown}
          disabled={busy}
          aria-label="Task"
          placeholder="What should the agent do? (blank = empty session)"
          className="w-full bg-transparent text-text-primary p-2 border border-border rounded outline-none placeholder:text-text-secondary disabled:opacity-50"
        />
      </div>

      {/* Preset — only shown when the repo defines presets. */}
      {presets.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-text-secondary mb-1.5">Preset (optional):</p>
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={busy}
            aria-label="Preset"
            className="w-full bg-bg-primary text-text-primary p-2 border border-border rounded outline-none disabled:opacity-50"
          >
            <option value="">None</option>
            {presets.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
                {p.layout ? ` — ${p.layout}` : ""}
                {p.paneCount > 0 ? ` (${p.paneCount} pane${p.paneCount === 1 ? "" : "s"})` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Busy pipeline label — indeterminate (the endpoint is synchronous). */}
      {busy && (
        <p className="text-xs text-text-secondary mb-2 flex items-center gap-2" role="status" aria-live="polite">
          <LogoSpinner size={14} />
          <span>Spawning: worktree → window → agent…</span>
        </p>
      )}

      {/* Error — rendered in-dialog; nothing was created on a 400. */}
      {error && !busy && <p className="text-xs text-red-400 mb-2">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={busy}
        className="w-full py-1.5 bg-bg-card border border-border rounded hover:border-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? "Spawning…" : "Spawn"}
      </button>
    </Dialog>
  );
}

import { useState, useMemo, useRef, useEffect } from "react";
import { createSession } from "@/api/client";
import { getDirectories } from "@/api/client";
import { Dialog } from "@/components/dialog";
import type { ProjectSession } from "@/types";

type CreateSessionDialogProps = {
  sessions: ProjectSession[];
  onClose: () => void;
};

export function CreateSessionDialog({ sessions, onClose }: CreateSessionDialogProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const quickPicks = useMemo(() => {
    const paths = new Set<string>();
    for (const s of sessions) {
      const root = s.windows[0]?.worktreePath;
      if (root) paths.add(root);
    }
    return [...paths].sort();
  }, [sessions]);

  function deriveNameFromPath(p: string): string {
    const trimmed = p.replace(/\/+$/, "");
    return trimmed.split("/").pop() ?? "";
  }

  function selectPath(p: string) {
    setPath(p);
    setName(deriveNameFromPath(p));
    setSuggestions([]);
  }

  function handlePathChange(value: string) {
    setPath(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const dirs = await getDirectories(value);
        setSuggestions(dirs);
      } catch {
        // Ignore
      }
    }, 300);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  async function handleCreate() {
    if (!name.trim()) return;
    try {
      await createSession(name.trim(), path.trim() || undefined);
    } catch {
      // SSE will reflect
    }
    onClose();
  }

  return (
    <Dialog
      title="Create session"
      onClose={onClose}
    >
      {quickPicks.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-text-secondary mb-1.5">Recent:</p>
          <div className="flex flex-col gap-0.5">
            {quickPicks.map((p) => (
              <button
                key={p}
                onClick={() => selectPath(p)}
                className="text-left text-sm px-2 py-2.5 min-h-[44px] flex items-center rounded hover:bg-bg-card text-text-secondary hover:text-text-primary transition-colors"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="relative mb-3">
        <p className="text-xs text-text-secondary mb-1.5">
          {quickPicks.length > 0 ? "Or type a path:" : "Path:"}
        </p>
        <input
          autoFocus
          type="text"
          value={path}
          onChange={(e) => handlePathChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setSuggestions([]);
          }}
          aria-label="Project path"
          placeholder="~/code/..."
          className="w-full bg-transparent text-text-primary text-sm p-2 border border-border rounded outline-none placeholder:text-text-secondary"
        />
        {suggestions.length > 0 && (
          <div
            role="listbox"
            aria-label="Directory suggestions"
            className="absolute left-0 right-0 top-full mt-1 bg-bg-primary border border-border rounded shadow-lg max-h-48 overflow-y-auto z-50"
          >
            {suggestions.map((dir) => (
              <button
                key={dir}
                onClick={() => selectPath(dir)}
                className="w-full text-left text-sm px-2 py-2.5 min-h-[44px] flex items-center hover:bg-bg-card text-text-secondary hover:text-text-primary transition-colors"
              >
                {dir}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="mb-3">
        <p className="text-xs text-text-secondary mb-1.5">Session name:</p>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          aria-label="Session name"
          placeholder="Session name..."
          className="w-full bg-transparent text-text-primary text-sm p-2 border border-border rounded outline-none placeholder:text-text-secondary"
        />
      </div>
      <button
        onClick={handleCreate}
        disabled={!name.trim()}
        className="w-full text-sm py-1.5 bg-bg-card border border-border rounded hover:border-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Create
      </button>
    </Dialog>
  );
}

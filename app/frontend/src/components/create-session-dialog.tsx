import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { createSession, getDirectories } from "@/api/client";
import { Dialog } from "@/components/dialog";
import { LogoSpinner } from "@/components/logo-spinner";
import { useOptimisticAction } from "@/hooks/use-optimistic-action";
import { useOptimisticContext } from "@/contexts/optimistic-context";
import type { ProjectSession } from "@/types";

type CreateSessionDialogProps = {
  sessions: ProjectSession[];
  onClose: () => void;
};

/** Convert a directory name into a tmux-safe session name.
 *  Strip colons and periods (tmux forbids them), replace hyphens with
 *  underscores to avoid collisions with session-group naming. */
function toTmuxSafeName(dirName: string): string {
  return dirName
    .replace(/[-]/g, "_")
    .replace(/[:.]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_|_$/g, "");
}

function deriveNameFromPath(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  if (trimmed === "~" || trimmed === "") return "";
  const segment = trimmed.split("/").pop() ?? "";
  return toTmuxSafeName(segment);
}

export function CreateSessionDialog({ sessions, onClose }: CreateSessionDialogProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [error, setError] = useState("");
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { addGhostSession, removeGhost } = useOptimisticContext();
  const ghostIdRef = useRef<string | null>(null);

  const existingNames = useMemo(
    () => new Set(sessions.map((s) => s.name)),
    [sessions],
  );

  const quickPicks = useMemo(() => {
    const paths = new Set<string>();
    for (const s of sessions) {
      const root = s.windows[0]?.worktreePath;
      if (root) paths.add(root);
    }
    return [...paths].sort();
  }, [sessions]);

  // Merge recent paths and directory suggestions into a single dropdown list.
  // When the input is empty, show recent paths; otherwise show API suggestions.
  const dropdownItems = useMemo(() => {
    if (suggestions.length > 0) return suggestions;
    if (!path) return quickPicks;
    return [];
  }, [suggestions, path, quickPicks]);

  const nameCollision = useMemo(
    () => name.trim() !== "" && existingNames.has(name.trim()),
    [name, existingNames],
  );

  function selectPath(p: string) {
    setPath(p);
    setName(deriveNameFromPath(p));
    setSuggestions([]);
    setShowDropdown(false);
    setHighlightIndex(-1);
  }

  const fetchSuggestions = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!value) {
        setSuggestions([]);
        setIsLoadingSuggestions(false);
        return;
      }
      setIsLoadingSuggestions(true);
      debounceRef.current = setTimeout(async () => {
        try {
          const dirs = await getDirectories(value);
          setSuggestions(dirs);
          setHighlightIndex(-1);
        } catch {
          // Ignore
        } finally {
          setIsLoadingSuggestions(false);
        }
      }, 300);
    },
    [],
  );

  function handlePathChange(value: string) {
    setPath(value);
    setError("");
    setShowDropdown(true);
    fetchSuggestions(value);
  }

  function handlePathKeyDown(e: React.KeyboardEvent) {
    if (!showDropdown || dropdownItems.length === 0) {
      if (e.key === "ArrowDown" && dropdownItems.length > 0) {
        setShowDropdown(true);
        setHighlightIndex(0);
        e.preventDefault();
        return;
      }
      if (e.key === "Enter") {
        handleCreate();
        return;
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightIndex((i) => (i + 1) % dropdownItems.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightIndex((i) => (i <= 0 ? dropdownItems.length - 1 : i - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (highlightIndex >= 0 && highlightIndex < dropdownItems.length) {
          selectPath(dropdownItems[highlightIndex]);
        } else {
          handleCreate();
        }
        break;
      case "Escape":
        e.preventDefault();
        setShowDropdown(false);
        setHighlightIndex(-1);
        break;
    }
  }

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIndex < 0 || !dropdownRef.current) return;
    const el = dropdownRef.current.children[highlightIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const { execute: executeCreate } = useOptimisticAction<[string, string | undefined]>({
    action: (sessionName, cwd) => createSession(sessionName, cwd),
    onOptimistic: (sessionName) => {
      ghostIdRef.current = addGhostSession(sessionName);
    },
    onRollback: () => {
      if (ghostIdRef.current) {
        removeGhost(ghostIdRef.current);
        ghostIdRef.current = null;
      }
    },
    onError: (err) => {
      setError(err.message || "Failed to create session");
    },
    onSettled: () => {
      ghostIdRef.current = null;
    },
  });

  function handleCreate() {
    let trimmedName = name.trim();
    if (!trimmedName && path.trim()) {
      trimmedName = deriveNameFromPath(path.trim());
    }
    if (!trimmedName) return;
    if (existingNames.has(trimmedName)) {
      setError(`Session "${trimmedName}" already exists`);
      return;
    }
    setError("");
    executeCreate(trimmedName, path.trim() || undefined);
    onClose();
  }

  return (
    <Dialog title="Create session" onClose={onClose}>
      {/* Path input with combobox dropdown */}
      <div className="relative mb-3">
        <p className="text-xs text-text-secondary mb-1.5">Path:</p>
        <div className="relative">
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={path}
            onChange={(e) => handlePathChange(e.target.value)}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => {
              // Delay to allow click on dropdown item
              setTimeout(() => setShowDropdown(false), 150);
            }}
            onKeyDown={handlePathKeyDown}
            role="combobox"
            aria-expanded={showDropdown && dropdownItems.length > 0}
            aria-controls="path-suggestions"
            aria-activedescendant={
              highlightIndex >= 0 ? `path-option-${highlightIndex}` : undefined
            }
            aria-label="Project path"
            placeholder="~/code/..."
            className="w-full bg-transparent text-text-primary p-2 pr-7 border border-border rounded outline-none placeholder:text-text-secondary"
          />
          {isLoadingSuggestions && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary">
              <LogoSpinner size={14} />
            </span>
          )}
        </div>
        {showDropdown && dropdownItems.length > 0 && (
          <div
            ref={dropdownRef}
            id="path-suggestions"
            role="listbox"
            aria-label="Directory suggestions"
            className="absolute left-0 right-0 top-full mt-1 bg-bg-primary border border-border rounded shadow-lg max-h-48 overflow-y-auto z-50"
          >
            {dropdownItems.map((dir, i) => (
              <button
                key={dir}
                id={`path-option-${i}`}
                role="option"
                aria-selected={i === highlightIndex}
                onMouseDown={(e) => {
                  e.preventDefault(); // prevent blur
                  selectPath(dir);
                  inputRef.current?.focus();
                }}
                className={`w-full text-left px-2 py-1.5 transition-colors ${
                  i === highlightIndex
                    ? "bg-bg-card text-text-primary"
                    : "text-text-secondary hover:bg-bg-card hover:text-text-primary"
                }`}
              >
                {dir}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Session name input */}
      <div className="mb-3">
        <p className="text-xs text-text-secondary mb-1.5">Session name:</p>
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          aria-label="Session name"
          aria-invalid={nameCollision}
          placeholder="Session name..."
          className={`w-full bg-transparent text-text-primary p-2 border rounded outline-none placeholder:text-text-secondary ${
            nameCollision ? "border-red-500" : "border-border"
          }`}
        />
        {nameCollision && (
          <p className="text-xs text-red-400 mt-1">
            Session "{name.trim()}" already exists
          </p>
        )}
      </div>

      {/* Error message */}
      {error && (
        <p className="text-xs text-red-400 mb-2">{error}</p>
      )}

      <button
        onClick={handleCreate}
        disabled={(!name.trim() && !path.trim()) || nameCollision}
        className="w-full py-1.5 bg-bg-card border border-border rounded hover:border-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Create
      </button>
    </Dialog>
  );
}

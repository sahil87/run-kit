import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { createWindow, getDirectories } from "@/api/client";
import { Dialog } from "@/components/dialog";
import { LogoSpinner } from "@/components/logo-spinner";
import { useOptimisticAction } from "@/hooks/use-optimistic-action";
import { useSessionContext } from "@/contexts/session-context";
import type { ProjectSession } from "@/types";

type CreateSessionDialogProps = {
  /** Quick-picks ("Recent:") derive from these sessions' project roots. */
  sessions: ProjectSession[];
  /** The session to create the window in. */
  session: string;
  onClose: () => void;
  /** Pre-fill the path input on mount. */
  defaultPath?: string;
};

/**
 * The window-at-folder dialog behind the palette's `Tab: Create at Folder`:
 * pick a starting directory (quick-picks + debounced autocomplete) and create
 * an unnamed window there — tmux auto-names it to the folder basename.
 */
export function CreateSessionDialog({ sessions, session, onClose, defaultPath }: CreateSessionDialogProps) {
  const [path, setPath] = useState(defaultPath ?? "");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [error, setError] = useState("");
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The dialog only opens from AppShell where `currentServer` is set;
  // fallback to empty string is defensive.
  const { currentServer } = useSessionContext();
  const server = currentServer ?? "";

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

  function selectPath(p: string) {
    setPath(p);
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

  const { execute: executeCreateWindowAction } = useOptimisticAction<[string, string, string | undefined]>({
    // No name — tmux auto-names the window to its chosen folder basename via
    // automatic-rename-format (the -c cwd on create makes this immediate). This
    // flow sets no optimistic ghost, so there is no ghost label to derive.
    action: (srv, targetSession, cwd) => createWindow(srv, targetSession, undefined, cwd),
    onError: (err) => {
      setError(err.message || "Failed to create tab");
    },
  });

  function handleCreate() {
    setError("");
    executeCreateWindowAction(server, session, path.trim() || undefined);
    onClose();
  }

  return (
    <Dialog title="Create tab at folder" onClose={onClose}>
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

      {/* Error message */}
      {error && (
        <p className="text-xs text-signal-red mb-2">{error}</p>
      )}

      <button
        onClick={handleCreate}
        className="w-full py-1.5 bg-bg-card border border-border rounded hover:border-text-secondary"
      >
        Create
      </button>
    </Dialog>
  );
}

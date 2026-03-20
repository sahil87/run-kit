import { useState, useEffect, useRef, useCallback, useId } from "react";

export type PaletteAction = {
  id: string;
  label: string;
  shortcut?: string;
  onSelect: () => void;
};

type CommandPaletteProps = {
  actions: PaletteAction[];
};

export function CommandPalette({ actions }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const filtered = actions.filter((a) =>
    a.label.toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
        setQuery("");
        setSelectedIndex(0);
      }
    }
    function handlePaletteOpen() {
      setOpen(true);
      setQuery("");
      setSelectedIndex(0);
    }
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("palette:open", handlePaletteOpen);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("palette:open", handlePaletteOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  const handleSelect = useCallback(
    (action: PaletteAction) => {
      setOpen(false);
      action.onSelect();
    },
    [],
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered[selectedIndex]) {
      e.preventDefault();
      handleSelect(filtered[selectedIndex]);
    }
  }

  if (!open) return null;

  const activeDescendant = filtered[selectedIndex]
    ? `${listId}-option-${filtered[selectedIndex].id}`
    : undefined;

  return (
    <div
      data-testid="palette-overlay"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={() => setOpen(false)}
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-lg bg-bg-primary border border-border rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Type a command..."
          aria-label="Search commands"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={activeDescendant}
          role="combobox"
          aria-expanded="true"
          className="w-full bg-transparent text-text-primary text-sm p-3 border-b border-border outline-none placeholder:text-text-secondary"
        />
        <div
          id={listId}
          role="listbox"
          aria-label="Commands"
          className="max-h-64 overflow-y-auto py-1"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-text-secondary">
              No results
            </div>
          ) : (
            filtered.map((action, i) => (
              <div
                key={action.id}
                id={`${listId}-option-${action.id}`}
                role="option"
                aria-selected={i === selectedIndex}
                onClick={() => handleSelect(action)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between cursor-pointer ${
                  i === selectedIndex
                    ? "bg-bg-card text-text-primary"
                    : "text-text-secondary hover:text-text-primary hover:bg-bg-card/50"
                }`}
              >
                <span>{action.label}</span>
                {action.shortcut && (
                  <kbd className="text-xs text-text-secondary bg-bg-card px-1.5 py-0.5 rounded border border-border">
                    {action.shortcut}
                  </kbd>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

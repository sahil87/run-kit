import { useState, useEffect, useRef, useCallback, useId } from "react";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useKeybindings } from "@/hooks/use-keybindings";
import { matchesCombo } from "@/lib/keybindings";

export type PaletteAction = {
  id: string;
  label: string;
  shortcut?: string;
  /** When set, first selection enters a one-row confirmation step. */
  confirmLabel?: string;
  onSelect: () => void;
};

type CommandPaletteProps = {
  actions: PaletteAction[];
};

export function CommandPalette({ actions }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [confirming, setConfirming] = useState<PaletteAction | null>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const closePalette = useCallback(() => {
    setOpen(false);
    setConfirming(null);
  }, []);

  // The hook owns Escape (document-level, so it fires regardless of which
  // element inside the palette has focus), Tab containment, and initial focus
  // (the input is the container's first — and only — focusable element).
  useFocusTrap(paletteRef, open, closePalette);

  const filtered = confirming
    ? [
        {
          ...confirming,
          id: `${confirming.id}-confirm`,
          label: confirming.confirmLabel ?? confirming.label,
          confirmLabel: undefined,
        },
      ]
    : actions.filter((a) =>
        a.label.toLowerCase().includes(query.toLowerCase()),
      );

  // The toggle chord comes from the keybinding registry (260730-g40a): default
  // ⌘K / Ctrl+K (`command-palette`, cmd tier, `ignoreInputs` — it keeps firing
  // inside text inputs, byte-identical to the pre-registry listener), and a
  // per-device override rebinds it. Held in a ref so the listener effect
  // registers once — override changes swap the ref, not the listener.
  const { byAction } = useKeybindings();
  const toggleBindingRef = useRef(byAction.get("command-palette"));
  toggleBindingRef.current = byAction.get("command-palette");

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const binding = toggleBindingRef.current;
      if (binding?.enabled && matchesCombo(e, binding)) {
        e.preventDefault();
        setConfirming(null);
        setOpen((prev) => !prev);
        setQuery("");
        setSelectedIndex(0);
      }
    }
    function handlePaletteOpen() {
      setOpen(true);
      setConfirming(null);
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

  // Scroll selected item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const selected = listRef.current.querySelector('[aria-selected="true"]');
    if (selected && typeof selected.scrollIntoView === "function") {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, open]);

  const handleSelect = useCallback(
    (action: PaletteAction) => {
      if (action.confirmLabel) {
        setConfirming(action);
        setQuery("");
        setSelectedIndex(0);
        return;
      }
      closePalette();
      action.onSelect();
    },
    [closePalette],
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
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
      onClick={closePalette}
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />

      {/* Modal */}
      <div
        ref={paletteRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-lg bg-bg-primary border border-border rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="text"
          value={query}
          onChange={(e) => {
            if (confirming) return;
            setQuery(e.target.value);
            setSelectedIndex(0);
          }}
          onKeyDown={handleKeyDown}
          readOnly={confirming !== null}
          placeholder={confirming ? "Confirm action..." : "Type a command..."}
          aria-label="Search commands"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={activeDescendant}
          role="combobox"
          aria-expanded="true"
          className="w-full bg-transparent text-text-primary text-[11px] p-2.5 border-b border-border outline-none placeholder:text-text-secondary"
        />
        <div
          id={listId}
          ref={listRef}
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
                className={`w-full text-left px-2.5 py-1.5 text-[11px] flex items-center justify-between cursor-pointer ${
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

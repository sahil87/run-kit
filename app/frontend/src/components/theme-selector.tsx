import { useState, useEffect, useRef, useCallback, useId } from "react";
import { useTheme, useThemeActions } from "@/contexts/theme-context";
import { THEMES } from "@/themes";
import type { Theme } from "@/themes";

export function ThemeSelector() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const { theme: currentTheme } = useTheme();
  const { setTheme, previewTheme, cancelPreview } = useThemeActions();

  // Snapshot of the theme when the modal opens — used for cancel
  const openThemeRef = useRef<Theme>(currentTheme);
  // Suppress mouse-enter during keyboard nav (scroll moves items under cursor)
  const keyboardNavRef = useRef(false);

  // Filter themes by query
  const filtered = THEMES.filter((t) =>
    t.name.toLowerCase().includes(query.toLowerCase()),
  );

  // Build flat list of selectable theme items (skipping category headers)
  const darkThemes = filtered.filter((t) => t.category === "dark");
  const lightThemes = filtered.filter((t) => t.category === "light");

  // Flat list for keyboard navigation
  const flatThemes: Theme[] = [...darkThemes, ...lightThemes];

  // Listen for open event
  useEffect(() => {
    function handleOpen() {
      openThemeRef.current = currentTheme;
      setOpen(true);
      setQuery("");
      // Select the currently active theme in the unfiltered flat list
      const allDarkThemes = THEMES.filter((t) => t.category === "dark");
      const allLightThemes = THEMES.filter((t) => t.category === "light");
      const allFlatThemes: Theme[] = [...allDarkThemes, ...allLightThemes];
      const currentIndex = allFlatThemes.findIndex(
        (t) => t.id === currentTheme.id,
      );
      setSelectedIndex(currentIndex >= 0 ? currentIndex : 0);
    }
    document.addEventListener("theme-selector:open", handleOpen);
    return () => document.removeEventListener("theme-selector:open", handleOpen);
  }, [currentTheme]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  // Preview the selected theme on navigation
  useEffect(() => {
    if (!open) return;
    const theme = flatThemes[selectedIndex];
    if (theme) {
      previewTheme(theme);
    }
  }, [selectedIndex, open, flatThemes[selectedIndex]?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll selected item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const selected = listRef.current.querySelector('[aria-selected="true"]');
    if (selected && typeof selected.scrollIntoView === "function") {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, open]);

  const handleConfirm = useCallback(
    (theme: Theme) => {
      setTheme(theme.id);
      setOpen(false);
    },
    [setTheme],
  );

  const handleCancel = useCallback(() => {
    cancelPreview();
    setOpen(false);
  }, [cancelPreview]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      keyboardNavRef.current = true;
      if (flatThemes.length > 0) {
        setSelectedIndex((i) => (i + 1) % flatThemes.length);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      keyboardNavRef.current = true;
      if (flatThemes.length > 0) {
        setSelectedIndex((i) => (i - 1 + flatThemes.length) % flatThemes.length);
      }
    } else if (e.key === "Enter" && flatThemes[selectedIndex]) {
      e.preventDefault();
      handleConfirm(flatThemes[selectedIndex]);
    }
  }

  function handleMouseMove() {
    keyboardNavRef.current = false;
  }

  function handleMouseEnter(theme: Theme) {
    if (keyboardNavRef.current) return;
    const idx = flatThemes.indexOf(theme);
    if (idx >= 0) {
      setSelectedIndex(idx);
    }
  }

  if (!open) return null;

  // Build render groups
  const groups: { label: string; themes: Theme[] }[] = [];
  if (darkThemes.length > 0) groups.push({ label: "Dark", themes: darkThemes });
  if (lightThemes.length > 0) groups.push({ label: "Light", themes: lightThemes });

  let flatIndex = 0;

  return (
    <div
      data-testid="theme-selector-overlay"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={handleCancel}
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Theme selector"
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
          placeholder="Search themes..."
          aria-label="Search themes"
          aria-autocomplete="list"
          aria-controls={listId}
          role="combobox"
          aria-expanded="true"
          className="w-full bg-transparent text-text-primary text-[11px] p-2.5 border-b border-border outline-none placeholder:text-text-secondary"
        />
        <div
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label="Themes"
          onMouseMove={handleMouseMove}
          className="max-h-64 overflow-y-auto py-1"
        >
          {flatThemes.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-text-secondary">
              No matching themes
            </div>
          ) : (
            groups.map((group) => {
              const header = (
                <div
                  key={`header-${group.label}`}
                  role="presentation"
                  className="px-2.5 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-text-secondary"
                >
                  {group.label}
                </div>
              );

              const items = group.themes.map((theme) => {
                const currentFlatIndex = flatIndex++;
                const isSelected = currentFlatIndex === selectedIndex;
                const isActive = theme.id === openThemeRef.current.id;

                return (
                  <div
                    key={theme.id}
                    id={`${listId}-option-${theme.id}`}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleConfirm(theme)}
                    onMouseEnter={() => handleMouseEnter(theme)}
                    className={`w-full text-left px-2.5 py-1.5 text-[11px] flex items-center justify-between cursor-pointer ${
                      isSelected
                        ? "bg-bg-card text-text-primary"
                        : "text-text-secondary hover:text-text-primary hover:bg-bg-card/50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {/* Palette swatch: bg + representative ANSI colors */}
                      <span className="inline-flex h-3 rounded-sm border border-border shrink-0 overflow-hidden">
                        {[
                          theme.palette.background,
                          theme.palette.ansi[1],  // red
                          theme.palette.ansi[2],  // green
                          theme.palette.ansi[3],  // yellow
                          theme.palette.ansi[4],  // blue
                          theme.palette.ansi[5],  // magenta
                          theme.palette.ansi[6],  // cyan
                        ].map((color, i) => (
                          <span
                            key={i}
                            className="inline-block w-1.5 h-full"
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </span>
                      <span>{theme.name}</span>
                    </div>
                    {isActive && (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        className="text-accent-green shrink-0"
                        aria-label="Current theme"
                      >
                        <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
                      </svg>
                    )}
                  </div>
                );
              });

              return [header, ...items];
            })
          )}
        </div>
      </div>
    </div>
  );
}

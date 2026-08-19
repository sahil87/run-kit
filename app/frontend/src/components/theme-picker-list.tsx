import { useState, useEffect, useRef, useId } from "react";
import { useThemeActions } from "@/contexts/theme-context";
import { THEMES } from "@/themes";
import type { Theme } from "@/themes";

interface ThemePickerListProps {
  /** Theme ids carrying the trailing check. The modal passes its open-time
   *  active theme; the settings surface passes both preferred slots
   *  (themeDark + themeLight) so each category shows its slot. */
  checkedIds: readonly string[];
  /** Where keyboard selection starts in the unfiltered list. */
  initialSelectedId?: string;
  onConfirm: (theme: Theme) => void;
  /** Fires on Escape after the core has reverted any uncommitted preview
   *  (and, when `collapsible`, closed the list). `consumed` lets an inline
   *  consumer eat the press (stopPropagation) only when it actually did
   *  either, so an idle Escape still bubbles to the enclosing dialog. */
  onEscape?: (e: React.KeyboardEvent, consumed: boolean) => void;
  /** Revert an uncommitted preview when the pointer or focus leaves the
   *  picker (the inline surface's cancel seam; the modal keeps previews
   *  alive until Escape/backdrop). */
  cancelOnLeave?: boolean;
  /** Render only the search input at rest; the list expands while the input
   *  is engaged (focus/click/typing/arrows) and closes on commit, Escape,
   *  or focus leave. The modal leaves this off — its list IS the modal. */
  collapsible?: boolean;
  autoFocus?: boolean;
}

/**
 * The shared theme-picker core: search + DARK/LIGHT grouped listbox with
 * palette swatches, keyboard nav, and live preview. Owns no overlay, backdrop,
 * open/close state, or document-event listener — `ThemeSelector` (modal) and
 * the settings dialog's theme control both render this and differ only via
 * props. Preview lifecycle is core-owned: it starts on user interaction
 * (never on mount, so an idle inline picker holds no preview) and is reverted
 * here on Escape, leave (when `cancelOnLeave`), and unmount.
 */
export function ThemePickerList({
  checkedIds,
  initialSelectedId,
  onConfirm,
  onEscape,
  cancelOnLeave = false,
  collapsible = false,
  autoFocus = false,
}: ThemePickerListProps) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(!collapsible);
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const idx = flattenByCategory(THEMES).findIndex((t) => t.id === initialSelectedId);
    return idx >= 0 ? idx : 0;
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const { previewTheme, cancelPreview } = useThemeActions();

  // Whether an uncommitted preview is live. Core-owned so Escape/leave/unmount
  // can decide without reaching into ThemeContext state.
  const previewingRef = useRef(false);
  // Suppress mouse-enter during keyboard nav (scroll moves items under cursor)
  const keyboardNavRef = useRef(false);
  // Latest cancelPreview for the unmount cleanup (its identity changes with
  // context state, but cleanup effects capture the first render's closure).
  const cancelPreviewRef = useRef(cancelPreview);
  cancelPreviewRef.current = cancelPreview;

  const filtered = THEMES.filter((t) =>
    t.name.toLowerCase().includes(query.toLowerCase()),
  );
  const darkThemes = filtered.filter((t) => t.category === "dark");
  const lightThemes = filtered.filter((t) => t.category === "light");
  const flatThemes: Theme[] = [...darkThemes, ...lightThemes];

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  // Revert a still-live preview when the picker unmounts (modal close paths
  // are already reverted/committed by then, making this a no-op there; the
  // inline surface relies on it for tab switches and dialog close mid-preview).
  useEffect(() => {
    return () => {
      if (previewingRef.current) cancelPreviewRef.current();
    };
  }, []);

  // Scroll selected item into view
  useEffect(() => {
    if (!expanded || !listRef.current) return;
    const selected = listRef.current.querySelector('[aria-selected="true"]');
    if (selected && typeof selected.scrollIntoView === "function") {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, expanded]);

  function preview(theme: Theme | undefined) {
    if (!theme) return;
    previewTheme(theme);
    previewingRef.current = true;
  }

  function endPreview() {
    if (!previewingRef.current) return;
    cancelPreview();
    previewingRef.current = false;
  }

  function handleConfirm(theme: Theme) {
    previewingRef.current = false;
    if (collapsible) setExpanded(false);
    onConfirm(theme);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      const hadPreview = previewingRef.current;
      endPreview();
      const closedList = collapsible && expanded;
      if (closedList) setExpanded(false);
      onEscape?.(e, hadPreview || closedList);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      keyboardNavRef.current = true;
      if (!expanded) setExpanded(true);
      if (flatThemes.length > 0) {
        const next = (selectedIndex + 1) % flatThemes.length;
        setSelectedIndex(next);
        preview(flatThemes[next]);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      keyboardNavRef.current = true;
      if (!expanded) setExpanded(true);
      if (flatThemes.length > 0) {
        const next = (selectedIndex - 1 + flatThemes.length) % flatThemes.length;
        setSelectedIndex(next);
        preview(flatThemes[next]);
      }
    } else if (e.key === "Enter" && flatThemes[selectedIndex]) {
      e.preventDefault();
      handleConfirm(flatThemes[selectedIndex]);
    }
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    setSelectedIndex(0);
    if (!expanded) setExpanded(true);
    const nextFiltered = THEMES.filter((t) =>
      t.name.toLowerCase().includes(value.toLowerCase()),
    );
    preview(flattenByCategory(nextFiltered)[0]);
  }

  function handleMouseMove() {
    keyboardNavRef.current = false;
  }

  function handleMouseEnter(theme: Theme) {
    if (keyboardNavRef.current) return;
    const idx = flatThemes.indexOf(theme);
    if (idx >= 0) {
      setSelectedIndex(idx);
      preview(theme);
    }
  }

  function handleLeave(e: React.FocusEvent | React.PointerEvent) {
    if (!cancelOnLeave) return;
    // A focus move within the picker is not a leave.
    if (
      e.relatedTarget instanceof Node &&
      e.currentTarget.contains(e.relatedTarget)
    ) {
      return;
    }
    // The pointer drifting out while focus is still inside (keyboard nav in
    // the search input) keeps the preview alive; blur is the leave then.
    if (e.type === "pointerleave" && e.currentTarget.contains(document.activeElement)) {
      return;
    }
    endPreview();
    if (collapsible && e.type !== "pointerleave") setExpanded(false);
  }

  const groups: { label: string; themes: Theme[] }[] = [];
  if (darkThemes.length > 0) groups.push({ label: "Dark", themes: darkThemes });
  if (lightThemes.length > 0) groups.push({ label: "Light", themes: lightThemes });

  let flatIndex = 0;

  return (
    <div onPointerLeave={handleLeave} onBlur={handleLeave}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => handleQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (collapsible) setExpanded(true);
        }}
        onClick={() => {
          if (collapsible) setExpanded(true);
        }}
        placeholder="Search themes..."
        aria-label="Search themes"
        aria-autocomplete="list"
        aria-controls={listId}
        role="combobox"
        aria-expanded={expanded}
        className={`w-full bg-transparent text-text-primary text-[11px] p-2.5 outline-none placeholder:text-text-secondary ${
          expanded ? "border-b border-border" : ""
        }`}
      />
      {expanded && (
      <div
        id={listId}
        ref={listRef}
        role="listbox"
        aria-label="Themes"
        onMouseMove={handleMouseMove}
        // Keep focus in the search input while clicking options — a blur
        // would collapse the list before the click lands (collapsible).
        onMouseDown={(e) => e.preventDefault()}
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
              const isChecked = checkedIds.includes(theme.id);

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
                        theme.palette.ansi[1],
                        theme.palette.ansi[2],
                        theme.palette.ansi[3],
                        theme.palette.ansi[4],
                        theme.palette.ansi[5],
                        theme.palette.ansi[6],
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
                  {isChecked && (
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
      )}
    </div>
  );
}

/** DARK-then-LIGHT flat order — the keyboard-navigation index space. */
function flattenByCategory(themes: readonly Theme[]): Theme[] {
  return [
    ...themes.filter((t) => t.category === "dark"),
    ...themes.filter((t) => t.category === "light"),
  ];
}

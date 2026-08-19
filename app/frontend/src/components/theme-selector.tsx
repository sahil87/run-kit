import { useState, useEffect, useRef, useCallback } from "react";
import { useTheme, useThemeActions } from "@/contexts/theme-context";
import { ThemePickerList } from "@/components/theme-picker-list";
import type { Theme } from "@/themes";

/**
 * Modal wrapper over the shared `ThemePickerList` core: owns the
 * `theme-selector:open` document-event listener, the overlay/backdrop, the
 * open-time theme snapshot, and close semantics (Enter/click commits via
 * `setTheme`; Escape/backdrop reverts any preview and closes). The settings
 * dialog renders the same core inline — picker behavior lives there, not here.
 */
export function ThemeSelector() {
  const [open, setOpen] = useState(false);

  const { theme: currentTheme } = useTheme();
  const { setTheme, cancelPreview } = useThemeActions();

  // Snapshot of the theme when the modal opens — used for cancel
  const openThemeRef = useRef<Theme>(currentTheme);

  useEffect(() => {
    function handleOpen() {
      openThemeRef.current = currentTheme;
      setOpen(true);
    }
    document.addEventListener("theme-selector:open", handleOpen);
    return () => document.removeEventListener("theme-selector:open", handleOpen);
  }, [currentTheme]);

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

  if (!open) return null;

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
        <ThemePickerList
          autoFocus
          checkedIds={[openThemeRef.current.id]}
          initialSelectedId={openThemeRef.current.id}
          onConfirm={handleConfirm}
          onEscape={() => setOpen(false)}
        />
      </div>
    </div>
  );
}

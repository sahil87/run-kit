import { createContext, useContext, useState, useCallback, useMemo } from "react";

/**
 * Settings-dialog open/close state (260723-o7q8). Provided at the `AppLayout`
 * level — the true every-page layer (boards included) — so any descendant
 * (command-palette actions, the sidebar footer gear) can call `openSettings()`
 * while the dialog itself renders exactly once in `AppLayout`. Deliberately
 * small: instance data (display name, accent) lives in its own contexts.
 */
export type SettingsDialogState = {
  isOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
};

const SettingsDialogContext = createContext<SettingsDialogState | null>(null);

export function SettingsDialogProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const openSettings = useCallback(() => setIsOpen(true), []);
  const closeSettings = useCallback(() => setIsOpen(false), []);

  const value = useMemo<SettingsDialogState>(
    () => ({ isOpen, openSettings, closeSettings }),
    [isOpen, openSettings, closeSettings],
  );

  return (
    <SettingsDialogContext.Provider value={value}>{children}</SettingsDialogContext.Provider>
  );
}

export function useSettingsDialog(): SettingsDialogState {
  const ctx = useContext(SettingsDialogContext);
  if (!ctx) throw new Error("useSettingsDialog must be used within SettingsDialogProvider");
  return ctx;
}

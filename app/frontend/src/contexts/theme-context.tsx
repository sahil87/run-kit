import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

type ThemeState = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
};

type ThemeActions = {
  setTheme: (preference: ThemePreference) => void;
};

const THEME_STORAGE_KEY = "runkit-theme";

const ThemeStateContext = createContext<ThemeState | null>(null);
const ThemeActionsContext = createContext<ThemeActions | null>(null);

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  // "system" — check OS preference
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // localStorage unavailable
  }
  return "system";
}

function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(readPreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readPreference()));

  // Listen to OS preference changes when in "system" mode
  useEffect(() => {
    if (preference !== "system") return;

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      const next = e.matches ? "dark" : "light";
      setResolved(next);
      applyTheme(next);
    };

    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [preference]);

  const setTheme = useCallback((next: ThemePreference) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // localStorage unavailable
    }
    const nextResolved = resolveTheme(next);
    setPreference(next);
    setResolved(nextResolved);
    applyTheme(nextResolved);
  }, []);

  const stateValue = useMemo<ThemeState>(
    () => ({ preference, resolved }),
    [preference, resolved],
  );

  const actionsRef = useRef<ThemeActions | null>(null);
  if (!actionsRef.current) {
    actionsRef.current = { setTheme };
  }

  return (
    <ThemeStateContext.Provider value={stateValue}>
      <ThemeActionsContext.Provider value={actionsRef.current}>
        {children}
      </ThemeActionsContext.Provider>
    </ThemeStateContext.Provider>
  );
}

export function useTheme(): ThemeState {
  const state = useContext(ThemeStateContext);
  if (!state) throw new Error("useTheme must be used within ThemeProvider");
  return state;
}

export function useThemeActions(): ThemeActions {
  const actions = useContext(ThemeActionsContext);
  if (!actions) throw new Error("useThemeActions must be used within ThemeProvider");
  return actions;
}

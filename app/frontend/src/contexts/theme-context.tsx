import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  getThemeById,
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  COLOR_CSS_MAP,
} from "@/themes";
import type { Theme } from "@/themes";

export type ResolvedTheme = "light" | "dark";

type ThemeState = {
  preference: string;
  resolved: ResolvedTheme;
  theme: Theme;
};

type ThemeActions = {
  setTheme: (preference: string) => void;
  previewTheme: (theme: Theme) => void;
  cancelPreview: () => void;
};

const THEME_STORAGE_KEY = "runkit-theme";

const ThemeStateContext = createContext<ThemeState | null>(null);
const ThemeActionsContext = createContext<ThemeActions | null>(null);

function resolveThemeObject(preference: string): Theme {
  if (preference === "system") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    return prefersDark ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME;
  }
  return getThemeById(preference) ?? DEFAULT_DARK_THEME;
}

function readPreference(): string {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "system") return "system";
    if (stored && getThemeById(stored)) return stored;
  } catch {
    // localStorage unavailable
  }
  return "system";
}

function applyThemeToDOM(theme: Theme): void {
  const root = document.documentElement;

  // Set all 8 CSS custom properties
  const colorKeys = Object.keys(COLOR_CSS_MAP) as (keyof Theme["colors"])[];
  for (const key of colorKeys) {
    root.style.setProperty(COLOR_CSS_MAP[key], theme.colors[key]);
  }

  // Set data-theme to category
  root.dataset.theme = theme.category;

  // Set color-scheme
  root.style.setProperty("color-scheme", theme.category);

  // Update meta theme-color
  const tc = document.querySelector('meta[name="theme-color"]');
  if (tc) tc.setAttribute("content", theme.themeColor);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreference] = useState<string>(readPreference);
  const [activeTheme, setActiveTheme] = useState<Theme>(() => resolveThemeObject(preference));
  const [isPreview, setIsPreview] = useState(false);
  const persistedPreferenceRef = useRef(preference);

  // Apply theme to DOM whenever activeTheme changes
  useEffect(() => {
    applyThemeToDOM(activeTheme);
  }, [activeTheme]);

  // Listen to OS preference changes when in "system" mode
  useEffect(() => {
    if (preference !== "system") return;

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      const nextTheme = e.matches ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME;
      setActiveTheme(nextTheme);
    };

    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [preference]);

  const setTheme = useCallback((next: string) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // localStorage unavailable
    }
    const nextTheme = resolveThemeObject(next);
    setPreference(next);
    setActiveTheme(nextTheme);
    setIsPreview(false);
    persistedPreferenceRef.current = next;
  }, []);

  const previewTheme = useCallback((theme: Theme) => {
    setActiveTheme(theme);
    setIsPreview(true);
  }, []);

  const cancelPreview = useCallback(() => {
    if (!isPreview) return;
    const restoredTheme = resolveThemeObject(persistedPreferenceRef.current);
    setActiveTheme(restoredTheme);
    setIsPreview(false);
  }, [isPreview]);

  const resolved: ResolvedTheme = activeTheme.category;

  const stateValue = useMemo<ThemeState>(
    () => ({ preference, resolved, theme: activeTheme }),
    [preference, resolved, activeTheme],
  );

  // Stabilize actions via ref — but update the ref when callbacks change
  const actionsRef = useRef<ThemeActions>({ setTheme, previewTheme, cancelPreview });
  actionsRef.current = { setTheme, previewTheme, cancelPreview };

  // Stable wrapper that delegates to latest ref
  const stableActions = useMemo<ThemeActions>(() => ({
    setTheme: (p: string) => actionsRef.current.setTheme(p),
    previewTheme: (t: Theme) => actionsRef.current.previewTheme(t),
    cancelPreview: () => actionsRef.current.cancelPreview(),
  }), []);

  return (
    <ThemeStateContext.Provider value={stateValue}>
      <ThemeActionsContext.Provider value={stableActions}>
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

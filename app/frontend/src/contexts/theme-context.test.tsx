import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { ThemeProvider, useTheme, useThemeActions } from "./theme-context";
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME, getThemeById } from "@/themes";

function TestConsumer() {
  const { preference, resolved, theme } = useTheme();
  const { setTheme, previewTheme, cancelPreview } = useThemeActions();
  return (
    <div>
      <span data-testid="preference">{preference}</span>
      <span data-testid="resolved">{resolved}</span>
      <span data-testid="theme-id">{theme.id}</span>
      <span data-testid="theme-name">{theme.name}</span>
      <button onClick={() => setTheme("default-light")}>Set Light</button>
      <button onClick={() => setTheme("default-dark")}>Set Dark</button>
      <button onClick={() => setTheme("system")}>Set System</button>
      <button onClick={() => setTheme("dracula")}>Set Dracula</button>
      <button onClick={() => previewTheme(getThemeById("nord")!)}>Preview Nord</button>
      <button onClick={() => cancelPreview()}>Cancel Preview</button>
    </div>
  );
}

// Helper to mock matchMedia with a specific dark-mode preference
function mockMatchMedia(prefersDark: boolean) {
  const listeners: Array<(e: MediaQueryListEvent) => void> = [];
  const mql = {
    matches: prefersDark,
    media: "(prefers-color-scheme: dark)",
    addEventListener: vi.fn((_event: string, handler: (e: MediaQueryListEvent) => void) => {
      listeners.push(handler);
    }),
    removeEventListener: vi.fn((_event: string, handler: (e: MediaQueryListEvent) => void) => {
      const idx = listeners.indexOf(handler);
      if (idx >= 0) listeners.splice(idx, 1);
    }),
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };

  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));

  return {
    mql,
    simulateChange(newPrefersDark: boolean) {
      mql.matches = newPrefersDark;
      for (const listener of [...listeners]) {
        listener({ matches: newPrefersDark } as MediaQueryListEvent);
      }
    },
  };
}

describe("ThemeProvider", () => {
  let themeColorMeta: HTMLMetaElement;

  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(true); // Default to dark OS
    document.documentElement.dataset.theme = "dark";
    // Add theme-color meta tag to the DOM (as index.html provides it)
    themeColorMeta = document.createElement("meta");
    themeColorMeta.setAttribute("name", "theme-color");
    themeColorMeta.setAttribute("content", "#0f1117");
    document.head.appendChild(themeColorMeta);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete document.documentElement.dataset.theme;
    // Clear inline styles set by applyThemeToDOM
    document.documentElement.removeAttribute("style");
    themeColorMeta.remove();
  });

  it("defaults to system preference when no localStorage value", () => {
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("preference").textContent).toBe("system");
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    expect(screen.getByTestId("theme-id").textContent).toBe("default-dark");
  });

  it("reads stored theme ID from localStorage", () => {
    localStorage.setItem("runkit-theme", "dracula");
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("preference").textContent).toBe("dracula");
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    expect(screen.getByTestId("theme-id").textContent).toBe("dracula");
    expect(screen.getByTestId("theme-name").textContent).toBe("Dracula");
  });

  it("treats invalid localStorage value as system", () => {
    localStorage.setItem("runkit-theme", "invalid");
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("preference").textContent).toBe("system");
  });

  it("treats old 'dark' localStorage value as system", () => {
    localStorage.setItem("runkit-theme", "dark");
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("preference").textContent).toBe("system");
  });

  it("treats old 'light' localStorage value as system", () => {
    localStorage.setItem("runkit-theme", "light");
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("preference").textContent).toBe("system");
  });

  it("setTheme persists to localStorage and updates state", () => {
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByText("Set Light").click();
    });
    expect(localStorage.getItem("runkit-theme")).toBe("default-light");
    expect(screen.getByTestId("preference").textContent).toBe("default-light");
    expect(screen.getByTestId("resolved").textContent).toBe("light");
    expect(screen.getByTestId("theme-id").textContent).toBe("default-light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("setTheme with named theme applies correct colors", () => {
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByText("Set Dracula").click();
    });
    expect(screen.getByTestId("theme-id").textContent).toBe("dracula");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--color-bg-primary")).toBe("#282a36");
  });

  it("setTheme to dark updates data-theme attribute", () => {
    localStorage.setItem("runkit-theme", "default-light");
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByText("Set Dark").click();
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
  });

  it("system preference with light OS resolves to light", () => {
    mockMatchMedia(false); // Light OS
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("preference").textContent).toBe("system");
    expect(screen.getByTestId("resolved").textContent).toBe("light");
    expect(screen.getByTestId("theme-id").textContent).toBe("default-light");
  });

  it("listens to matchMedia changes when preference is system", () => {
    const { simulateChange } = mockMatchMedia(true);

    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("resolved").textContent).toBe("dark");

    // Simulate OS switching to light
    act(() => {
      simulateChange(false);
    });

    expect(screen.getByTestId("resolved").textContent).toBe("light");
    expect(screen.getByTestId("theme-id").textContent).toBe("default-light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("ignores matchMedia changes when preference is explicit theme", () => {
    localStorage.setItem("runkit-theme", "dracula");
    const { simulateChange } = mockMatchMedia(true);

    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("theme-id").textContent).toBe("dracula");

    // Simulate OS switching to light — should be ignored
    act(() => {
      simulateChange(false);
    });

    expect(screen.getByTestId("theme-id").textContent).toBe("dracula");
  });

  describe("preview/cancel", () => {
    it("previewTheme applies colors without persisting", () => {
      render(
        <ThemeProvider>
          <TestConsumer />
        </ThemeProvider>,
      );

      act(() => {
        screen.getByText("Preview Nord").click();
      });

      expect(screen.getByTestId("theme-id").textContent).toBe("nord");
      expect(document.documentElement.style.getPropertyValue("--color-bg-primary")).toBe("#2e3440");
      // localStorage should still be "system" (the default)
      expect(localStorage.getItem("runkit-theme")).toBeNull();
    });

    it("cancelPreview reverts to persisted theme", () => {
      render(
        <ThemeProvider>
          <TestConsumer />
        </ThemeProvider>,
      );

      // Preview Nord
      act(() => {
        screen.getByText("Preview Nord").click();
      });
      expect(screen.getByTestId("theme-id").textContent).toBe("nord");

      // Cancel — should revert to default dark (system preference)
      act(() => {
        screen.getByText("Cancel Preview").click();
      });
      expect(screen.getByTestId("theme-id").textContent).toBe("default-dark");
      expect(document.documentElement.style.getPropertyValue("--color-bg-primary")).toBe("#0f1117");
    });

    it("setTheme after preview clears preview state", () => {
      render(
        <ThemeProvider>
          <TestConsumer />
        </ThemeProvider>,
      );

      // Preview Nord
      act(() => {
        screen.getByText("Preview Nord").click();
      });

      // Confirm with setTheme
      act(() => {
        screen.getByText("Set Dracula").click();
      });

      expect(screen.getByTestId("theme-id").textContent).toBe("dracula");
      expect(localStorage.getItem("runkit-theme")).toBe("dracula");
    });
  });

  describe("theme-color meta tag synchronization", () => {
    it("sets theme-color to dark theme's themeColor when dark theme is applied", () => {
      render(
        <ThemeProvider>
          <TestConsumer />
        </ThemeProvider>,
      );
      act(() => {
        screen.getByText("Set Dark").click();
      });
      expect(themeColorMeta.getAttribute("content")).toBe(DEFAULT_DARK_THEME.themeColor);
    });

    it("sets theme-color to light theme's themeColor when light theme is applied", () => {
      render(
        <ThemeProvider>
          <TestConsumer />
        </ThemeProvider>,
      );
      act(() => {
        screen.getByText("Set Light").click();
      });
      expect(themeColorMeta.getAttribute("content")).toBe(DEFAULT_LIGHT_THEME.themeColor);
    });

    it("sets theme-color to dracula's themeColor", () => {
      render(
        <ThemeProvider>
          <TestConsumer />
        </ThemeProvider>,
      );
      act(() => {
        screen.getByText("Set Dracula").click();
      });
      expect(themeColorMeta.getAttribute("content")).toBe("#282a36");
    });

    it("updates theme-color when OS preference changes in system mode", () => {
      const { simulateChange } = mockMatchMedia(true);

      render(
        <ThemeProvider>
          <TestConsumer />
        </ThemeProvider>,
      );

      // System mode starts with dark OS
      expect(themeColorMeta.getAttribute("content")).toBe(DEFAULT_DARK_THEME.themeColor);

      // OS switches to light
      act(() => {
        simulateChange(false);
      });
      expect(themeColorMeta.getAttribute("content")).toBe(DEFAULT_LIGHT_THEME.themeColor);
    });
  });

  describe("CSS custom properties", () => {
    it("applies all 8 CSS custom properties to document.documentElement.style", () => {
      render(
        <ThemeProvider>
          <TestConsumer />
        </ThemeProvider>,
      );

      const style = document.documentElement.style;
      expect(style.getPropertyValue("--color-bg-primary")).toBe(DEFAULT_DARK_THEME.colors.bgPrimary);
      expect(style.getPropertyValue("--color-bg-card")).toBe(DEFAULT_DARK_THEME.colors.bgCard);
      expect(style.getPropertyValue("--color-bg-inset")).toBe(DEFAULT_DARK_THEME.colors.bgInset);
      expect(style.getPropertyValue("--color-text-primary")).toBe(DEFAULT_DARK_THEME.colors.textPrimary);
      expect(style.getPropertyValue("--color-text-secondary")).toBe(DEFAULT_DARK_THEME.colors.textSecondary);
      expect(style.getPropertyValue("--color-border")).toBe(DEFAULT_DARK_THEME.colors.border);
      expect(style.getPropertyValue("--color-accent")).toBe(DEFAULT_DARK_THEME.colors.accent);
      expect(style.getPropertyValue("--color-accent-green")).toBe(DEFAULT_DARK_THEME.colors.accentGreen);
    });

    it("sets color-scheme CSS property", () => {
      render(
        <ThemeProvider>
          <TestConsumer />
        </ThemeProvider>,
      );
      expect(document.documentElement.style.getPropertyValue("color-scheme")).toBe("dark");

      act(() => {
        screen.getByText("Set Light").click();
      });
      expect(document.documentElement.style.getPropertyValue("color-scheme")).toBe("light");
    });
  });
});

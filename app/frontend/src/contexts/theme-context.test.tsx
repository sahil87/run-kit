import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { ThemeProvider, useTheme, useThemeActions } from "./theme-context";

function TestConsumer() {
  const { preference, resolved } = useTheme();
  const { setTheme } = useThemeActions();
  return (
    <div>
      <span data-testid="preference">{preference}</span>
      <span data-testid="resolved">{resolved}</span>
      <button onClick={() => setTheme("light")}>Set Light</button>
      <button onClick={() => setTheme("dark")}>Set Dark</button>
      <button onClick={() => setTheme("system")}>Set System</button>
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
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(true); // Default to dark OS
    document.documentElement.dataset.theme = "dark";
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete document.documentElement.dataset.theme;
  });

  it("defaults to system preference when no localStorage value", () => {
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("preference").textContent).toBe("system");
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
  });

  it("reads stored preference from localStorage", () => {
    localStorage.setItem("runkit-theme", "light");
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("preference").textContent).toBe("light");
    expect(screen.getByTestId("resolved").textContent).toBe("light");
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

  it("setTheme persists to localStorage and updates state", () => {
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByText("Set Light").click();
    });
    expect(localStorage.getItem("runkit-theme")).toBe("light");
    expect(screen.getByTestId("preference").textContent).toBe("light");
    expect(screen.getByTestId("resolved").textContent).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("setTheme to dark updates data-theme attribute", () => {
    localStorage.setItem("runkit-theme", "light");
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
  });

  it("ignores matchMedia changes when preference is explicit light", () => {
    localStorage.setItem("runkit-theme", "light");
    document.documentElement.dataset.theme = "light"; // Simulates blocking script
    const { simulateChange } = mockMatchMedia(false);

    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("resolved").textContent).toBe("light");

    // Simulate OS switching to dark — should be ignored
    act(() => {
      simulateChange(true);
    });

    expect(screen.getByTestId("resolved").textContent).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("ignores matchMedia changes when preference is explicit dark", () => {
    localStorage.setItem("runkit-theme", "dark");
    const { simulateChange } = mockMatchMedia(true);

    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("resolved").textContent).toBe("dark");

    // Simulate OS switching to light — should be ignored
    act(() => {
      simulateChange(false);
    });

    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
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
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

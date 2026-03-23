import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { ThemeProvider } from "@/contexts/theme-context";
import { ThemeSelector } from "./theme-selector";
import { THEMES, getThemeById } from "@/themes";

// Mock matchMedia
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
  return { mql };
}

function renderWithProvider() {
  return render(
    <ThemeProvider>
      <ThemeSelector />
    </ThemeProvider>,
  );
}

function openSelector() {
  act(() => {
    document.dispatchEvent(new CustomEvent("theme-selector:open"));
  });
}

describe("ThemeSelector", () => {
  let themeColorMeta: HTMLMetaElement;

  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(true);
    document.documentElement.dataset.theme = "dark";
    themeColorMeta = document.createElement("meta");
    themeColorMeta.setAttribute("name", "theme-color");
    themeColorMeta.setAttribute("content", "#0f1117");
    document.head.appendChild(themeColorMeta);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete document.documentElement.dataset.theme;
    document.documentElement.removeAttribute("style");
    themeColorMeta.remove();
  });

  it("is hidden by default", () => {
    const { container } = renderWithProvider();
    expect(container.querySelector('[data-testid="theme-selector-overlay"]')).toBeNull();
  });

  it("opens on theme-selector:open event", () => {
    renderWithProvider();
    openSelector();
    expect(screen.getByPlaceholderText("Search themes...")).toBeInTheDocument();
  });

  it("focuses the search input when opened", () => {
    renderWithProvider();
    openSelector();
    expect(screen.getByPlaceholderText("Search themes...")).toHaveFocus();
  });

  it("shows all 20 themes", () => {
    renderWithProvider();
    openSelector();
    for (const theme of THEMES) {
      expect(screen.getByText(theme.name)).toBeInTheDocument();
    }
  });

  it("shows Dark and Light category headers", () => {
    renderWithProvider();
    openSelector();
    expect(screen.getByText("Dark")).toBeInTheDocument();
    expect(screen.getByText("Light")).toBeInTheDocument();
  });

  it("filters themes by search query", () => {
    renderWithProvider();
    openSelector();
    const input = screen.getByPlaceholderText("Search themes...");
    fireEvent.change(input, { target: { value: "gru" } });
    expect(screen.getByText("Gruvbox Dark")).toBeInTheDocument();
    expect(screen.getByText("Gruvbox Light")).toBeInTheDocument();
    expect(screen.queryByText("Dracula")).not.toBeInTheDocument();
  });

  it("shows 'No matching themes' when filter matches nothing", () => {
    renderWithProvider();
    openSelector();
    const input = screen.getByPlaceholderText("Search themes...");
    fireEvent.change(input, { target: { value: "xyz" } });
    expect(screen.getByText("No matching themes")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    renderWithProvider();
    openSelector();
    const input = screen.getByPlaceholderText("Search themes...");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByPlaceholderText("Search themes...")).not.toBeInTheDocument();
  });

  it("closes on backdrop click", () => {
    renderWithProvider();
    openSelector();
    fireEvent.click(screen.getByTestId("theme-selector-overlay"));
    expect(screen.queryByPlaceholderText("Search themes...")).not.toBeInTheDocument();
  });

  it("navigates with ArrowDown and confirms with Enter", () => {
    renderWithProvider();
    openSelector();
    const input = screen.getByPlaceholderText("Search themes...");

    // First item is Default Dark (index 0). Move down to Dracula (index 1).
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    // Should persist Dracula
    expect(localStorage.getItem("runkit-theme")).toBe("dracula");
    expect(screen.queryByPlaceholderText("Search themes...")).not.toBeInTheDocument();
  });

  it("wraps selection from last to first", () => {
    renderWithProvider();
    openSelector();
    const input = screen.getByPlaceholderText("Search themes...");

    // ArrowUp from first (index 0) should wrap to last
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });

    // Last theme is Rose Pine Dawn
    const lastTheme = THEMES[THEMES.length - 1];
    expect(localStorage.getItem("runkit-theme")).toBe(lastTheme.id);
  });

  it("previews theme on navigation", () => {
    renderWithProvider();
    openSelector();
    const input = screen.getByPlaceholderText("Search themes...");

    // Move down to Dracula
    fireEvent.keyDown(input, { key: "ArrowDown" });

    // The DOM should have Dracula's bgPrimary
    const dracula = getThemeById("dracula")!;
    expect(document.documentElement.style.getPropertyValue("--color-bg-primary")).toBe(
      dracula.colors.bgPrimary,
    );
  });

  it("reverts to original theme on Escape", () => {
    renderWithProvider();
    openSelector();
    const input = screen.getByPlaceholderText("Search themes...");

    // Move down to Dracula (previewing)
    fireEvent.keyDown(input, { key: "ArrowDown" });

    // Press Escape to cancel
    fireEvent.keyDown(input, { key: "Escape" });

    // Should revert to default dark
    expect(document.documentElement.style.getPropertyValue("--color-bg-primary")).toBe("#0f1117");
  });

  it("shows checkmark on current active theme", () => {
    renderWithProvider();
    openSelector();
    // Default Dark should have the checkmark
    const checkmarks = screen.getAllByLabelText("Current theme");
    expect(checkmarks).toHaveLength(1);
  });
});

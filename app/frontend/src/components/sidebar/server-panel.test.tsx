import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { ServerPanel } from "./server-panel";
import { ThemeProvider } from "@/contexts/theme-context";
import type { ServerInfo } from "@/api/client";

// jsdom does not implement matchMedia — ThemeProvider + useIsMobileLayout both need it.
// Default to the fine-pointer / desktop-width branch unless a test overrides.
vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
  matches: query.includes("prefers-color-scheme: dark"),
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  onchange: null,
})));

function renderPanel(overrides: {
  server?: string;
  servers?: ServerInfo[];
  serverColors?: Record<string, number>;
  onSwitchServer?: (name: string) => void;
  onKillServer?: () => void;
  onCreateServer?: () => void;
  onRefreshServers?: () => void;
  onServerColorChange?: (server: string, color: number | null) => void;
} = {}) {
  const props = {
    server: overrides.server ?? "default",
    servers: overrides.servers ?? [
      { name: "default", sessionCount: 4 },
      { name: "work", sessionCount: 2 },
      { name: "e2e", sessionCount: 1 },
    ],
    serverColors: overrides.serverColors ?? {},
    onSwitchServer: overrides.onSwitchServer ?? vi.fn(),
    onKillServer: overrides.onKillServer ?? vi.fn(),
    onCreateServer: overrides.onCreateServer ?? vi.fn(),
    onRefreshServers: overrides.onRefreshServers ?? vi.fn(),
    onServerColorChange: overrides.onServerColorChange,
  };
  return render(
    <ThemeProvider>
      <ServerPanel {...props} />
    </ThemeProvider>,
  );
}

function openPanel() {
  // Header button whose accessible name includes "Tmux". Opening triggers a refresh.
  const toggle = screen.getByRole("button", { name: /Tmux/ });
  fireEvent.click(toggle);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("ServerPanel", () => {
  it("renders a tile per server with name and session count", () => {
    renderPanel();
    openPanel();

    expect(screen.getByRole("option", { name: /default/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /work/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /e2e/ })).toBeInTheDocument();

    // Session count meta lines
    expect(screen.getByText("4 sess")).toBeInTheDocument();
    expect(screen.getByText("2 sess")).toBeInTheDocument();
    expect(screen.getByText("1 sess")).toBeInTheDocument();
  });

  it("marks the active server tile with aria-current", () => {
    renderPanel({ server: "work" });
    openPanel();

    const activeTile = screen.getByRole("option", { name: /work/ });
    expect(activeTile.getAttribute("aria-current")).toBe("true");
    expect(activeTile.getAttribute("aria-selected")).toBe("true");

    const otherTile = screen.getByRole("option", { name: /default/ });
    expect(otherTile.getAttribute("aria-current")).toBeNull();
    expect(otherTile.getAttribute("aria-selected")).toBe("false");
  });

  it("clicking a non-active tile calls onSwitchServer with that name", () => {
    const onSwitchServer = vi.fn();
    renderPanel({ server: "default", onSwitchServer });
    openPanel();

    fireEvent.click(screen.getByRole("option", { name: /work/ }));
    expect(onSwitchServer).toHaveBeenCalledWith("work");
  });

  it("shows 'No servers' when server list is empty", () => {
    renderPanel({ servers: [] });
    openPanel();
    expect(screen.getByText("No servers")).toBeInTheDocument();
  });

  it("header + button invokes onCreateServer without opening the panel", () => {
    const onCreateServer = vi.fn();
    renderPanel({ onCreateServer });

    const plus = screen.getByRole("button", { name: "New tmux server" });
    fireEvent.click(plus);
    expect(onCreateServer).toHaveBeenCalled();
  });

  it("color-picker button click opens SwatchPopover without firing onSwitchServer", () => {
    const onSwitchServer = vi.fn();
    const onServerColorChange = vi.fn();
    renderPanel({ server: "default", onSwitchServer, onServerColorChange });
    openPanel();

    // Action buttons are siblings of the option (sibling-of-button, not child),
    // so look them up globally by accessible name.
    const colorBtn = screen.getByRole("button", { name: /Set color for server work/ });
    fireEvent.click(colorBtn);

    expect(onSwitchServer).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox", { name: /Color picker/i })).toBeInTheDocument();
  });

  it("kill button renders only on the active tile", () => {
    const onKillServer = vi.fn();
    const onServerColorChange = vi.fn();
    renderPanel({ server: "default", onKillServer, onServerColorChange });
    openPanel();

    expect(screen.getByRole("button", { name: /Kill server default/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Kill server work/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Kill server e2e/ })).toBeNull();
  });

  it("kill button fires onKillServer without firing onSwitchServer", () => {
    const onSwitchServer = vi.fn();
    const onKillServer = vi.fn();
    renderPanel({ server: "default", onSwitchServer, onKillServer, onServerColorChange: vi.fn() });
    openPanel();

    const killBtn = screen.getByRole("button", { name: /Kill server default/ });
    fireEvent.click(killBtn);

    expect(onKillServer).toHaveBeenCalled();
    expect(onSwitchServer).not.toHaveBeenCalled();
  });

  it("opening the panel triggers onRefreshServers", () => {
    const onRefreshServers = vi.fn().mockResolvedValue(undefined);
    renderPanel({ onRefreshServers });
    openPanel();
    expect(onRefreshServers).toHaveBeenCalled();
  });

  it("renders tile grid as listbox with server tiles as options (keyboard-focusable)", () => {
    renderPanel();
    openPanel();
    const grid = screen.getByRole("listbox", { name: /Tmux servers/ });
    // Exactly three options inside the tile grid listbox.
    const options = within(grid).getAllByRole("option");
    expect(options).toHaveLength(3);
  });

  it("uses full server name as the tile title attribute for tooltip fallback", () => {
    renderPanel({
      servers: [{ name: "bench-really-long-name", sessionCount: 1 }],
      server: "bench-really-long-name",
    });
    openPanel();
    const tile = screen.getByRole("option");
    expect(tile.getAttribute("title")).toBe("bench-really-long-name");
  });
});

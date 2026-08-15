import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within, act } from "@testing-library/react";
import { ServerPanel } from "./server-panel";
import { IDENTITY_TIP_OPEN_DELAY_MS } from "./identity-tip";
import { ThemeProvider } from "@/contexts/theme-context";
import { ToastProvider } from "@/components/toast";
import type { ServerInfo } from "@/api/client";
import { stubMatchMedia } from "@/test-utils/match-media";

// jsdom does not implement matchMedia — ThemeProvider + useIsMobile both need it.
// Default to the fine-pointer / desktop-width branch unless a test overrides.
function stubFinePointer() {
  stubMatchMedia((query) => query.includes("prefers-color-scheme: dark"));
}
stubFinePointer();

function renderPanel(overrides: {
  server?: string;
  servers?: ServerInfo[];
  serverColors?: Record<string, string>;
  waitingCounts?: Map<string, number>;
  onSwitchServer?: (name: string) => void;
  onCreateServer?: () => void;
  onRefreshServers?: () => void;
} = {}) {
  const props = {
    server: overrides.server ?? "default",
    servers: overrides.servers ?? [
      { name: "default", sessionCount: 4, windowCount: 9 },
      { name: "work", sessionCount: 2, windowCount: 5 },
      { name: "e2e", sessionCount: 1, windowCount: 1 },
    ],
    serverColors: overrides.serverColors ?? {},
    waitingCounts: overrides.waitingCounts,
    onSwitchServer: overrides.onSwitchServer ?? vi.fn(),
    onCreateServer: overrides.onCreateServer ?? vi.fn(),
    onRefreshServers: overrides.onRefreshServers ?? vi.fn(),
  };
  return render(
    <ThemeProvider>
      <ToastProvider>
        <ServerPanel {...props} />
      </ToastProvider>
    </ThemeProvider>,
  );
}

// The panel defaults open (defaultOpen=true) — tests that need a collapsed
// start seed the persisted key before rendering.
function seedCollapsed() {
  localStorage.setItem("runkit-panel-server", "false");
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("ServerPanel", () => {
  it("renders a tile per server with name and bare window count", () => {
    renderPanel();

    expect(screen.getByRole("option", { name: /default/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /work/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /e2e/ })).toBeInTheDocument();

    // The count line is a bare window-count number — no "sess"/"win" suffix.
    const workTile = screen.getByRole("option", { name: /work/ });
    expect(within(workTile).getByText("5")).toBeInTheDocument();
    expect(screen.queryByText(/\d+ sess/)).not.toBeInTheDocument();
  });

  it("renders 0 when windowCount is absent (backend always sends it; fixtures may not)", () => {
    renderPanel({
      servers: [{ name: "default", sessionCount: 1 }],
    });
    const tile = screen.getByRole("option");
    expect(within(tile).getByText("0")).toBeInTheDocument();
  });

  it("marks the active server tile with aria-current", () => {
    renderPanel({ server: "work" });

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

    fireEvent.click(screen.getByRole("option", { name: /work/ }));
    expect(onSwitchServer).toHaveBeenCalledWith("work");
  });

  it("shows 'No servers' when server list is empty", () => {
    renderPanel({ servers: [] });
    expect(screen.getByText("No servers")).toBeInTheDocument();
  });

  it("header + button invokes onCreateServer without opening the panel", () => {
    const onCreateServer = vi.fn();
    renderPanel({ onCreateServer });

    const plus = screen.getByRole("button", { name: "New tmux server" });
    fireEvent.click(plus);
    expect(onCreateServer).toHaveBeenCalled();
  });

  it("renders no hover action cluster on tiles (kill/color live in the SESSIONS-pane group headers)", () => {
    renderPanel({ server: "default" });

    // The palette + kill buttons were removed from the tile surface (bylc):
    // those actions live in the SESSIONS-pane server-group headers and the
    // command palette's per-server `Server: Kill <name>` entries.
    expect(screen.queryByRole("button", { name: /Kill server/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Set color for server/ })).not.toBeInTheDocument();
  });

  it("is open by default: the tile grid renders without any toggle click", () => {
    renderPanel();

    const grid = screen.getByRole("listbox", { name: /Tmux servers/ });
    expect(grid).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /Server/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("opening the panel (from a collapsed start) triggers onRefreshServers", () => {
    seedCollapsed();
    const onRefreshServers = vi.fn().mockResolvedValue(undefined);
    renderPanel({ onRefreshServers });
    expect(onRefreshServers).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Server/ }));
    expect(onRefreshServers).toHaveBeenCalled();
  });

  it("renders tile grid as listbox with server tiles as options (keyboard-focusable)", () => {
    renderPanel();
    const grid = screen.getByRole("listbox", { name: /Tmux servers/ });
    // Exactly three options inside the tile grid listbox.
    const options = within(grid).getAllByRole("option");
    expect(options).toHaveLength(3);
  });

  it("tile carries NO native title — the identity tip card replaces it", () => {
    renderPanel({
      servers: [{ name: "bench-really-long-name", sessionCount: 2, windowCount: 5 }],
      server: "bench-really-long-name",
    });
    const tile = screen.getByRole("option", { name: /bench-really-long-name/ });
    expect(tile).not.toHaveAttribute("title");
  });

  // Tile identity tip: `Server <name>` title bar + `tmux -L <name> · N
  // sessions` body — the socket flag shown uniformly, including `default`.
  describe("identity tip", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
      // Restore the fine-pointer default after a coarse-pointer test.
      stubFinePointer();
    });

    function hoverTile(name: RegExp) {
      // The reference props ride the tile's WRAPPER div; jsdom's mouseenter
      // doesn't bubble, so tests hover the wrapper (in the browser React
      // synthesizes ancestor enter events from mouseover, so hovering the
      // button works the same).
      const tile = screen.getByRole("option", { name }).parentElement!;
      act(() => {
        fireEvent.pointerEnter(tile, { pointerType: "mouse" });
        fireEvent.mouseEnter(tile);
        vi.advanceTimersByTime(IDENTITY_TIP_OPEN_DELAY_MS + 50);
      });
      return tile;
    }

    it("opens on tile hover with the server name in the title bar and the socket flag + session count in the body", () => {
      renderPanel({
        servers: [{ name: "default", sessionCount: 6, windowCount: 9 }],
        server: "default",
      });
      expect(screen.queryByTestId("server-tip")).toBeNull();

      hoverTile(/default/);
      const card = screen.getByTestId("server-tip");
      const bar = screen.getByTestId("popup-title-bar");
      expect(card).toContainElement(bar);
      expect(bar).toHaveTextContent("Server default");
      expect(card).toHaveTextContent("tmux -L default · 6 sessions");
      // Tier-1 weight: no interactive content at all.
      expect(card.querySelector("a, button")).toBeNull();
    });

    it("uses the singular `1 session`", () => {
      renderPanel({
        servers: [{ name: "solo", sessionCount: 1, windowCount: 1 }],
        server: "solo",
      });
      hoverTile(/solo/);
      expect(screen.getByTestId("server-tip")).toHaveTextContent("tmux -L solo · 1 session");
    });

    it("dismisses on Escape and never opens on a coarse pointer", () => {
      renderPanel({
        servers: [{ name: "work", sessionCount: 2, windowCount: 5 }],
        server: "work",
      });
      hoverTile(/work/);
      expect(screen.getByTestId("server-tip")).toBeInTheDocument();
      act(() => {
        fireEvent.keyDown(document, { key: "Escape" });
        vi.advanceTimersByTime(50);
      });
      expect(screen.queryByTestId("server-tip")).toBeNull();

      // Coarse pointer: the whole surface is suppressed (the Tip idiom).
      cleanup();
      stubMatchMedia((query) => query === "(pointer: coarse)");
      renderPanel({
        servers: [{ name: "work", sessionCount: 2, windowCount: 5 }],
        server: "work",
      });
      // Re-query after the re-render — `tile` belongs to the cleaned-up tree,
      // so firing at it would no-op and the assertion would pass vacuously.
      const coarseTile = screen.getByRole("option", { name: /work/ }).parentElement!;
      act(() => {
        fireEvent.pointerEnter(coarseTile, { pointerType: "touch" });
        fireEvent.mouseEnter(coarseTile);
        fireEvent.focus(coarseTile);
        vi.advanceTimersByTime(IDENTITY_TIP_OPEN_DELAY_MS + 100);
      });
      expect(screen.queryByTestId("server-tip")).toBeNull();
    });
  });

  it("does not repeat the active server name in the header (spinner slot only)", () => {
    seedCollapsed();
    renderPanel({ server: "work" });

    expect(screen.getByText("Server")).toBeInTheDocument();

    // The name is shown by the highlighted tile and the top-bar heading — the
    // headerRight slot no longer duplicates it.
    const toggle = screen.getByRole("button", { name: /Server/ });
    expect(within(toggle).queryByText("work")).not.toBeInTheDocument();
  });

  it("de-emphasizes infra server names (grey), leaves regular names primary", () => {
    renderPanel({
      server: "work",
      servers: [
        { name: "work", sessionCount: 2, windowCount: 3 },
        { name: "rk-daemon", sessionCount: 1, windowCount: 1 },
        { name: "rk-test-e2e", sessionCount: 1, windowCount: 1 },
      ],
    });

    // Infra names render text-text-secondary, not text-text-primary.
    const daemonName = screen.getByText("rk-daemon");
    expect(daemonName).toHaveClass("text-text-secondary");
    expect(daemonName).not.toHaveClass("text-text-primary");

    const testName = screen.getByText("rk-test-e2e");
    expect(testName).toHaveClass("text-text-secondary");
    expect(testName).not.toHaveClass("text-text-primary");

    // Regular name stays primary.
    const workName = screen.getByText("work", { selector: "div" });
    expect(workName).toHaveClass("text-text-primary");
    expect(workName).not.toHaveClass("text-text-secondary");
  });

  it("renders a waiting badge with the count on a server that has waiting windows", () => {
    renderPanel({
      server: "default",
      servers: [
        { name: "default", sessionCount: 4, windowCount: 8 },
        { name: "work", sessionCount: 2, windowCount: 4 },
      ],
      waitingCounts: new Map([["work", 3]]),
    });

    // The badge lives inside the `work` tile (a descendant of its `option`
    // button), so scope the query to that tile — a global query would still
    // pass if the badge were rendered on the wrong server tile.
    const workTile = screen.getByRole("option", { name: /work/ });
    const badge = within(workTile).getByTestId("waiting-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("3");
    expect(badge).toHaveAttribute("aria-label", "3 agents waiting for input");

    // The count is forwarded per-server: the `default` tile (no map entry) has
    // no badge, proving the badge is not rendered on the wrong tile.
    const defaultTile = screen.getByRole("option", { name: /default/ });
    expect(within(defaultTile).queryByTestId("waiting-badge")).not.toBeInTheDocument();
  });

  describe("active-tile autoscroll (nris)", () => {
    // jsdom has no scrollIntoView at all — define a spy on the prototype so
    // the effect's `typeof el.scrollIntoView === "function"` guard passes.
    let scrollSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      scrollSpy = vi.fn();
      Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
        value: scrollSpy,
        configurable: true,
        writable: true,
      });
    });

    afterEach(() => {
      delete (window.HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView;
    });

    function panelUI(server: string) {
      return (
        <ThemeProvider>
          <ToastProvider>
            <ServerPanel
              server={server}
              servers={[
                { name: "default", sessionCount: 4, windowCount: 9 },
                { name: "work", sessionCount: 2, windowCount: 5 },
              ]}
              serverColors={{}}
              onSwitchServer={vi.fn()}
              onCreateServer={vi.fn()}
              onRefreshServers={vi.fn()}
            />
          </ToastProvider>
        </ThemeProvider>
      );
    }

    it("scrolls the active tile into view on mount on desktop (mobile-only gate removed)", () => {
      // The file-default matchMedia stub reports desktop (fine pointer, wide).
      render(panelUI("work"));

      expect(scrollSpy).toHaveBeenCalledTimes(1);
      expect(scrollSpy).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
      // The call target is the ACTIVE tile's button (aria-current="true").
      const activeTile = screen.getByRole("option", { name: /work/ });
      expect(scrollSpy.mock.instances[0]).toBe(activeTile);
    });

    it("re-scrolls when the active server changes", () => {
      const { rerender } = render(panelUI("default"));
      expect(scrollSpy).toHaveBeenCalledTimes(1);

      rerender(panelUI("work"));
      expect(scrollSpy).toHaveBeenCalledTimes(2);
      const activeTile = screen.getByRole("option", { name: /work/ });
      expect(scrollSpy.mock.instances[1]).toBe(activeTile);
    });

    it("does not scroll when no tile is active (server not in the list)", () => {
      render(panelUI("gone"));
      expect(scrollSpy).not.toHaveBeenCalled();
    });
  });

  it("renders no waiting badge for a server with count 0 or no map entry", () => {
    renderPanel({
      server: "default",
      servers: [
        { name: "default", sessionCount: 4, windowCount: 8 }, // no map entry → count 0
        { name: "work", sessionCount: 2, windowCount: 4 }, // explicit 0
      ],
      waitingCounts: new Map([["work", 0]]),
    });

    // WaitingBadge returns null at count <= 0, so no badge is present for either.
    expect(screen.queryByTestId("waiting-badge")).not.toBeInTheDocument();
  });
});

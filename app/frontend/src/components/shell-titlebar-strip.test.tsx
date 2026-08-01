import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ShellTitlebarStrip } from "./shell-titlebar-strip";
import {
  InstanceAccentValueProvider,
  type InstanceAccent,
} from "@/contexts/instance-accent-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { ToastProvider } from "@/components/toast";
import { SHELL_STRIP_MARKER_CLASS } from "@/lib/shell-strip";

// ThemeProvider makes no real HTTP calls in tests.
vi.mock("@/api/client", () => ({
  getThemePreference: vi.fn().mockRejectedValue(new Error("no API in test")),
  setThemePreference: vi.fn().mockResolvedValue(undefined),
}));

function mockMatchMedia() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: true,
      media: "(prefers-color-scheme: dark)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    }),
  );
}

function accentValue(overrides: Partial<InstanceAccent> = {}): InstanceAccent {
  return {
    color: null,
    isExplicit: false,
    stripeHex: null,
    washHex: null,
    titlebarHex: null,
    setColor: vi.fn(),
    ...overrides,
  };
}

/** Install a bridge whose `servers.list` resolves the given list (`null` =
 *  rejected call, i.e. an older shell / denial). Returns the list/switch
 *  spies for call-count and payload assertions. */
function shellBridge(servers: unknown[] | null, platform = "darwin") {
  const list = vi.fn(() =>
    servers === null
      ? Promise.reject(new Error("ipc gone"))
      : Promise.resolve({ ok: true, servers }),
  );
  const switchFn = vi.fn(() => Promise.resolve({ ok: true }));
  window.runkitShell = {
    version: "1.2.3",
    platform,
    servers: { list, switch: switchFn },
  };
  return { list, switch: switchFn };
}

function renderStrip(accent: InstanceAccent = accentValue()) {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <InstanceAccentValueProvider value={accent}>
          <ShellTitlebarStrip />
        </InstanceAccentValueProvider>
      </ToastProvider>
    </ThemeProvider>,
  );
}

const hosts = [
  { id: "a", name: "studio-mac", url: "http://a:3000", active: true },
  { id: "b", name: "lab", url: "http://b:3000", active: false },
];

/** Render with a populated bridge and wait for the mount fetch to enable the
 *  switcher trigger. */
async function renderInteractive(list: unknown[] = hosts, platform = "darwin") {
  const bridge = shellBridge(list, platform);
  renderStrip();
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Switch host" })).toBeInTheDocument();
  });
  return bridge;
}

beforeEach(() => {
  localStorage.clear();
  mockMatchMedia();
});

afterEach(() => {
  cleanup();
  delete window.runkitShell;
  vi.unstubAllGlobals();
  document.documentElement.classList.remove(SHELL_STRIP_MARKER_CLASS);
});

describe("ShellTitlebarStrip", () => {
  it("marks <html> with the rk-shell-strip class while mounted (version-skew fallback key)", () => {
    shellBridge([]);
    const { unmount } = renderStrip();
    expect(document.documentElement.classList.contains(SHELL_STRIP_MARKER_CLASS)).toBe(true);
    unmount();
    expect(document.documentElement.classList.contains(SHELL_STRIP_MARKER_CLASS)).toBe(false);
  });

  it("shows the active shell host's name from servers.list", async () => {
    shellBridge(hosts);
    renderStrip();
    await waitFor(() => {
      expect(screen.getByText("studio-mac")).toBeInTheDocument();
    });
  });

  it("falls back to location.hostname when the list call fails (older shell / denial)", async () => {
    shellBridge(null);
    renderStrip();
    await waitFor(() => {
      expect(screen.getByText(window.location.hostname)).toBeInTheDocument();
    });
  });

  it("uses the accent titlebar blend as the background when an accent is set", () => {
    shellBridge([]);
    renderStrip(accentValue({ color: "4", titlebarHex: "#3a2b4c" }));
    const strip = screen.getByTestId("shell-titlebar-strip");
    expect(strip.style.backgroundColor).toBe("rgb(58, 43, 76)");
  });

  it("falls back to the theme background (still draggable) when no accent is set", () => {
    shellBridge([]);
    renderStrip();
    const strip = screen.getByTestId("shell-titlebar-strip");
    // No accent → non-empty theme background, and the band stays a drag region.
    expect(strip.style.backgroundColor).not.toBe("");
    expect(strip.className).toContain("rk-shell-drag");
  });
});

describe("ShellTitlebarStrip host switcher (260731-4bqi)", () => {
  it("keeps the static non-interactive label on an older shell without the servers group", async () => {
    window.runkitShell = { version: "0.9.0", platform: "darwin" };
    renderStrip();
    await waitFor(() => {
      expect(screen.getByText(window.location.hostname)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps the static label when the bridge answers an empty list (nothing to switch to)", async () => {
    const { list } = shellBridge([]);
    renderStrip();
    await waitFor(() => {
      expect(list).toHaveBeenCalled();
    });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders the label as a no-drag dropdown trigger when hosts are registered", async () => {
    await renderInteractive();
    const trigger = screen.getByRole("button", { name: "Switch host" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger.textContent).toContain("studio-mac");
    expect(trigger.textContent).toContain("▾");
    // The trigger island (button's wrapper) is the band's only no-drag carve-out.
    expect(trigger.parentElement?.className).toContain("rk-shell-no-drag");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens the menu on click and refetches the host list (fresh servers.list call)", async () => {
    const bridge = await renderInteractive();
    expect(bridge.list).toHaveBeenCalledTimes(1); // mount fetch (label + gate)
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    expect(bridge.list).toHaveBeenCalledTimes(2); // refetch on open
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(2);
  });

  it("renders row anatomy: accent ✓ on the active host, dimmed origin, darwin accelerator hints", async () => {
    await renderInteractive();
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    const rows = screen.getAllByRole("menuitemradio");
    // Active row: ✓ marker + accent color + name + origin + ⌥⌘1, with the
    // single-select state exposed to AT via aria-checked (menuitemradio).
    expect(rows[0].textContent).toContain("✓");
    expect(rows[0]).toHaveAttribute("aria-checked", "true");
    expect(rows[1]).toHaveAttribute("aria-checked", "false");
    expect(rows[0].className).toContain("text-accent");
    expect(rows[0].textContent).toContain("studio-mac");
    expect(rows[0].textContent).toContain("http://a:3000");
    expect(rows[0].textContent).toContain("⌥⌘1");
    // Inactive row: no ✓, no accent, second hint.
    expect(rows[1].textContent).not.toContain("✓");
    expect(rows[1].className).not.toContain("text-accent");
    expect(rows[1].textContent).toContain("lab");
    expect(rows[1].textContent).toContain("http://b:3000");
    expect(rows[1].textContent).toContain("⌥⌘2");
  });

  it("renders ⇧Ctrl hints on non-darwin platforms (from the bridge's platform field)", async () => {
    await renderInteractive(hosts, "win32");
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    const rows = screen.getAllByRole("menuitemradio");
    expect(rows[0].textContent).toContain("⇧Ctrl+1");
    expect(rows[1].textContent).toContain("⇧Ctrl+2");
  });

  it("selecting a host closes the menu and hands off to servers.switch (no optimistic UI)", async () => {
    const bridge = await renderInteractive();
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    fireEvent.click(screen.getAllByRole("menuitemradio")[1]);
    expect(bridge.switch).toHaveBeenCalledWith("b");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    // The label still names the active host — the page swap is shell-side.
    expect(screen.getByRole("button", { name: "Switch host" }).textContent).toContain(
      "studio-mac",
    );
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    await renderInteractive();
    const trigger = screen.getByRole("button", { name: "Switch host" });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("moves focus with ArrowDown, wrapping over the row set", async () => {
    await renderInteractive();
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    const rows = screen.getAllByRole("menuitemradio");
    // Focus lands on the active row (index 0) on open.
    await waitFor(() => {
      expect(document.activeElement).toBe(rows[0]);
    });
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[0]); // wraparound
  });

  it("closes on an outside mousedown", async () => {
    await renderInteractive();
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("keeps the last known list when the open-time refetch is denied (null keeps rows)", async () => {
    // list resolves the full set once (mount), then rejects (open refetch).
    const list = vi
      .fn<() => Promise<unknown>>()
      .mockImplementationOnce(() => Promise.resolve({ ok: true, servers: hosts }))
      .mockImplementation(() => Promise.reject(new Error("ipc gone")));
    const switchFn = vi.fn(() => Promise.resolve({ ok: true }));
    window.runkitShell = {
      version: "1.2.3",
      platform: "darwin",
      servers: { list, switch: switchFn },
    };
    renderStrip();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Switch host" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    expect(list).toHaveBeenCalledTimes(2);
    // The denied refetch resolves null shell-wrapper-side; the menu keeps the
    // mount-time rows rather than blanking.
    await waitFor(() => {
      expect(screen.getAllByRole("menuitemradio")).toHaveLength(2);
    });
  });

  it("re-clamps the roving tabindex when the open-time refetch shrinks the list", async () => {
    // Active host LAST so the focus seat opens at index 2 — beyond the
    // refetched single-row list. Without the clamp no row carries tabIndex=0
    // and focus falls to <body> (review cycle 1, must-fix a).
    const three = [
      { id: "a", name: "alpha", url: "http://a:3000", active: false },
      { id: "b", name: "beta", url: "http://b:3000", active: false },
      { id: "c", name: "gamma", url: "http://c:3000", active: true },
    ];
    const one = [{ id: "a", name: "alpha", url: "http://a:3000", active: false }];
    const list = vi
      .fn<() => Promise<unknown>>()
      .mockImplementationOnce(() => Promise.resolve({ ok: true, servers: three }))
      .mockImplementation(() => Promise.resolve({ ok: true, servers: one }));
    window.runkitShell = {
      version: "1.2.3",
      platform: "darwin",
      servers: { list, switch: vi.fn(() => Promise.resolve({ ok: true })) },
    };
    renderStrip();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Switch host" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    await waitFor(() => {
      expect(screen.getAllByRole("menuitemradio")).toHaveLength(1);
    });
    // The seat clamps onto the surviving row: it stays the roving-tabindex
    // stop and receives focus.
    const row = screen.getAllByRole("menuitemradio")[0];
    await waitFor(() => {
      expect(row).toHaveAttribute("tabindex", "0");
      expect(document.activeElement).toBe(row);
    });
  });

  it("closes and releases key handling when the open-time refetch empties the list", async () => {
    const list = vi
      .fn<() => Promise<unknown>>()
      .mockImplementationOnce(() => Promise.resolve({ ok: true, servers: hosts }))
      .mockImplementation(() => Promise.resolve({ ok: true, servers: [] }));
    window.runkitShell = {
      version: "1.2.3",
      platform: "darwin",
      servers: { list, switch: vi.fn(() => Promise.resolve({ ok: true })) },
    };
    renderStrip();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Switch host" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    // The emptied list downgrades the strip to the static label AND releases
    // the open state (no phantom open menu, review cycle 1, must-fix b).
    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
    // Arrow keys are NOT swallowed app-wide: the capture-phase handler is
    // torn down / guarded, so the event keeps its default behavior
    // (fireEvent returns false when a handler called preventDefault).
    expect(fireEvent.keyDown(document.body, { key: "ArrowDown" })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: "ArrowUp" })).toBe(true);
  });

  it("drops an out-of-order stale refetch resolution (freshest list wins)", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const list = vi.fn(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    window.runkitShell = {
      version: "1.2.3",
      platform: "darwin",
      servers: { list, switch: vi.fn(() => Promise.resolve({ ok: true })) },
    };
    renderStrip();
    // Mount fetch resolves the two-host list.
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolvers[0]({ ok: true, servers: hosts });
    });
    const trigger = screen.getByRole("button", { name: "Switch host" });
    // Open #1 leaves its refetch in flight; close; open #2 refetches again.
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(list).toHaveBeenCalledTimes(3);
    // Open #2's refetch resolves FIRST, with the fresh three-host list.
    const fresh = [...hosts, { id: "c", name: "extra", url: "http://c:3000", active: false }];
    await act(async () => {
      resolvers[2]({ ok: true, servers: fresh });
    });
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(3);
    // The STALE open-#1 refetch resolves LAST — the sequence guard drops it
    // (review cycle 1, should-fix c: freshest list stays rendered).
    await act(async () => {
      resolvers[1]({ ok: true, servers: hosts });
    });
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(3);
  });

  it("surfaces an error toast when the switch is denied", async () => {
    const switchFn = vi.fn(() => Promise.resolve({ ok: false, error: "Unknown host" }));
    const list = vi.fn(() => Promise.resolve({ ok: true, servers: hosts }));
    window.runkitShell = {
      version: "1.2.3",
      platform: "darwin",
      servers: { list, switch: switchFn },
    };
    renderStrip();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Switch host" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    fireEvent.click(screen.getAllByRole("menuitemradio")[1]);
    await waitFor(() => {
      expect(screen.getByText("Shell server switch failed")).toBeInTheDocument();
    });
  });
});

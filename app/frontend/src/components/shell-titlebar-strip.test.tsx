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
 *  rejected call, i.e. an older shell / denial). `withAdd` includes the
 *  optional `add` invoker (newer shells — drives the `+ Add Host…` footer);
 *  `withReorder` includes the optional `reorder` invoker (drives the drag
 *  grip + ⌥↑/⌥↓ move); `withRemove`/`withRename` include the optional
 *  `remove`/`rename` invokers (the Disconnect icon + inline rename).
 *  Returns the spies for call-count/payload assertions. */
function shellBridge(
  servers: unknown[] | null,
  platform = "darwin",
  withAdd = false,
  withReorder = false,
  withRemove = false,
  withRename = false,
) {
  const list = vi.fn(() =>
    servers === null
      ? Promise.reject(new Error("ipc gone"))
      : Promise.resolve({ ok: true, servers }),
  );
  const switchFn = vi.fn(() => Promise.resolve({ ok: true }));
  const add = vi.fn(() => Promise.resolve({ ok: true }));
  const reorder = vi.fn(() => Promise.resolve({ ok: true }));
  const remove = vi.fn(() => Promise.resolve({ ok: true }));
  const rename = vi.fn(() => Promise.resolve({ ok: true }));
  window.runkitShell = {
    version: "1.2.3",
    platform,
    servers: {
      list,
      switch: switchFn,
      ...(withAdd ? { add } : {}),
      ...(withReorder ? { reorder } : {}),
      ...(withRemove ? { remove } : {}),
      ...(withRename ? { rename } : {}),
    },
  };
  return { list, switch: switchFn, add, reorder, remove, rename };
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
async function renderInteractive(
  list: unknown[] = hosts,
  platform = "darwin",
  withAdd = false,
  withReorder = false,
  withRemove = false,
  withRename = false,
) {
  const bridge = shellBridge(list, platform, withAdd, withReorder, withRemove, withRename);
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

  it("omits the Add Host footer when the bridge lacks the add invoker (older shell)", async () => {
    await renderInteractive();
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Add Host…" })).not.toBeInTheDocument();
  });

  it("renders the Add Host footer when the bridge carries add; click closes and invokes it", async () => {
    const bridge = await renderInteractive(hosts, "darwin", true);
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    const footer = screen.getByRole("menuitem", { name: "Add Host…" });
    fireEvent.click(footer);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(bridge.add).toHaveBeenCalledTimes(1);
    expect(bridge.switch).not.toHaveBeenCalled();
  });

  it("includes the Add Host footer in the arrow-key roving cycle", async () => {
    await renderInteractive(hosts, "darwin", true);
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    const rows = screen.getAllByRole("menuitemradio");
    const footer = screen.getByRole("menuitem", { name: "Add Host…" });
    await waitFor(() => {
      expect(document.activeElement).toBe(rows[0]);
    });
    // ArrowUp from the first row wraps to the footer (the cycle's last stop).
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(document.activeElement).toBe(footer);
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[0]);
  });

  it("surfaces an error toast when the add call is denied", async () => {
    const bridge = await renderInteractive(hosts, "darwin", true);
    bridge.add.mockResolvedValue({ ok: false });
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Add Host…" }));
    await waitFor(() => {
      expect(screen.getByText("Shell add host failed")).toBeInTheDocument();
    });
  });
});

describe("ShellTitlebarStrip host menu — accent bars, waiting counts, reorder (1i7j)", () => {
  const coloredHosts = [
    { id: "a", name: "studio-mac", url: "http://a:3000", active: true, accentColor: "#8b7ff0" },
    { id: "b", name: "lab", url: "http://b:3000", active: false },
    { id: "c", name: "buildbox", url: "http://c:3000", active: false, accentColor: "#4a4468" },
  ];

  it("renders the accent edge bar for hosts with a color, none for colorless rows", async () => {
    await renderInteractive(coloredHosts);
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    const rows = screen.getAllByRole("menuitemradio");
    const barA = rows[0].querySelector("[data-testid='shell-host-accent-bar']");
    expect(barA).not.toBeNull();
    expect((barA as HTMLElement).style.backgroundColor).toBe("rgb(139, 127, 240)");
    expect(rows[1].querySelector("[data-testid='shell-host-accent-bar']")).toBeNull();
    const barC = rows[2].querySelector("[data-testid='shell-host-accent-bar']");
    expect((barC as HTMLElement).style.backgroundColor).toBe("rgb(74, 68, 104)");
    // The bar overlays the left edge — the row content keeps its alignment.
    expect(rows[1].textContent).toContain("lab");
    expect(rows[1].textContent).toContain("http://b:3000");
  });

  it("renders no bar for a non-hex accentColor (never reaches style interpolation)", async () => {
    await renderInteractive([
      { id: "a", name: "evil", url: "http://a:3000", active: true, accentColor: "javascript:alert(1)" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    expect(screen.queryByTestId("shell-host-accent-bar")).not.toBeInTheDocument();
  });

  it("renders the amber waiting chip on background rows only, before the hint", async () => {
    await renderInteractive([
      { id: "a", name: "studio-mac", url: "http://a:3000", active: true, waiting: 2 },
      { id: "b", name: "lab", url: "http://b:3000", active: false, waiting: 3 },
      { id: "c", name: "quiet", url: "http://c:3000", active: false },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    const rows = screen.getAllByRole("menuitemradio");
    // Active row: the count is suppressed (the dock badge is its surface).
    expect(rows[0].textContent).not.toContain("●");
    // Background row: amber ● N between the origin and the accelerator hint.
    expect(rows[1].textContent).toContain("● 3");
    const chip = screen.getByText("● 3");
    expect(chip.className).toContain("text-amber-600");
    expect(rows[1].textContent?.indexOf("● 3")).toBeLessThan(
      rows[1].textContent?.indexOf("⌥⌘2") ?? Infinity,
    );
    // Absent count renders nothing extra.
    expect(rows[2].textContent).not.toContain("●");
  });

  it("⌥↑ moves the focused row with one invoke per press, live hint re-numbering, focus follows", async () => {
    const four = [
      { id: "a", name: "alpha", url: "http://a:3000", active: true },
      { id: "b", name: "beta", url: "http://b:3000", active: false },
      { id: "c", name: "gamma", url: "http://c:3000", active: false },
      { id: "d", name: "delta", url: "http://d:3000", active: false },
    ];
    const bridge = await renderInteractive(four, "darwin", false, true);
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    let rows = screen.getAllByRole("menuitemradio");
    await waitFor(() => {
      expect(document.activeElement).toBe(rows[0]); // active row seeded
    });
    fireEvent.keyDown(document, { key: "ArrowDown" }); // focus beta (index 1)
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(document, { key: "ArrowUp", altKey: true });
    expect(bridge.reorder).toHaveBeenCalledTimes(1);
    expect(bridge.reorder).toHaveBeenCalledWith("b", 0);
    // Optimistic local reorder: beta first, hints re-numbered.
    rows = screen.getAllByRole("menuitemradio");
    expect(rows[0].textContent).toContain("beta");
    expect(rows[0].textContent).toContain("⌥⌘1");
    expect(rows[1].textContent).toContain("alpha");
    expect(rows[1].textContent).toContain("⌥⌘2");
    // Focus stays on the moved row.
    expect(document.activeElement).toBe(rows[0]);
    expect(rows[0]).toHaveAttribute("tabindex", "0");
  });

  it("⌥↑/⌥↓ at the list edges is a no-op (no invoke, no wrap, key swallowed)", async () => {
    const bridge = await renderInteractive(hosts, "darwin", false, true);
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    const rows = screen.getAllByRole("menuitemradio");
    await waitFor(() => {
      expect(document.activeElement).toBe(rows[0]);
    });
    // First row, move up: swallowed, no invoke (fireEvent false = preventDefaulted).
    expect(fireEvent.keyDown(document, { key: "ArrowUp", altKey: true })).toBe(false);
    expect(bridge.reorder).not.toHaveBeenCalled();
    expect(screen.getAllByRole("menuitemradio")[0].textContent).toContain("studio-mac");
    // Last row, move down: same.
    fireEvent.keyDown(document, { key: "ArrowDown" }); // focus lab (index 1)
    expect(fireEvent.keyDown(document, { key: "ArrowDown", altKey: true })).toBe(false);
    expect(bridge.reorder).not.toHaveBeenCalled();
  });

  it("⌥↑/⌥↓ on the Add-Host footer falls through to the roving cycle (footer not movable)", async () => {
    const bridge = await renderInteractive(hosts, "darwin", true, true);
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    const rows = screen.getAllByRole("menuitemradio");
    const footer = screen.getByRole("menuitem", { name: "Add Host…" });
    await waitFor(() => {
      expect(document.activeElement).toBe(rows[0]);
    });
    fireEvent.keyDown(document, { key: "ArrowUp" }); // wrap to footer
    expect(document.activeElement).toBe(footer);
    fireEvent.keyDown(document, { key: "ArrowDown", altKey: true }); // roves, never moves
    expect(bridge.reorder).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(rows[0]);
  });

  it("without the reorder capability, ⌥↑/⌥↓ fall through to today's roving focus (no grips)", async () => {
    await renderInteractive(hosts); // no reorder invoker
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    const rows = screen.getAllByRole("menuitemradio");
    await waitFor(() => {
      expect(document.activeElement).toBe(rows[0]);
    });
    expect(screen.queryByText("⋮⋮")).not.toBeInTheDocument();
    for (const row of rows) expect(row).toHaveAttribute("draggable", "false");
    fireEvent.keyDown(document, { key: "ArrowDown", altKey: true });
    expect(document.activeElement).toBe(rows[1]); // plain roving move
  });

  it("drag-drop commits exactly one reorder invocation with optimistic order", async () => {
    const four = [
      { id: "a", name: "alpha", url: "http://a:3000", active: true },
      { id: "b", name: "beta", url: "http://b:3000", active: false },
      { id: "c", name: "gamma", url: "http://c:3000", active: false },
      { id: "d", name: "delta", url: "http://d:3000", active: false },
    ];
    const bridge = await renderInteractive(four, "darwin", false, true);
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    // Grips render (hover-revealed) and rows are draggable.
    expect(screen.getAllByText("⋮⋮")).toHaveLength(4);
    const rows = screen.getAllByRole("menuitemradio");
    for (const row of rows) expect(row).toHaveAttribute("draggable", "true");
    const dataTransfer = {
      setData: vi.fn(),
      types: ["application/x-shell-host-reorder"],
      effectAllowed: "",
      dropEffect: "",
    };
    // Drag row 4 (delta) onto row 1 (alpha) — insert-before → index 0.
    fireEvent.dragStart(rows[3], { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith("application/x-shell-host-reorder", "d");
    fireEvent.dragOver(rows[0], { dataTransfer });
    fireEvent.drop(rows[0], { dataTransfer });
    fireEvent.dragEnd(rows[3], { dataTransfer });
    expect(bridge.reorder).toHaveBeenCalledTimes(1);
    expect(bridge.reorder).toHaveBeenCalledWith("d", 0);
    // Optimistic order renders with re-numbered hints.
    const reordered = screen.getAllByRole("menuitemradio");
    expect(reordered[0].textContent).toContain("delta");
    expect(reordered[0].textContent).toContain("⌥⌘1");
    expect(reordered[1].textContent).toContain("alpha");
  });

  it("a denied drag-drop reorder surfaces the error toast and refetches the list", async () => {
    const bridge = await renderInteractive(hosts, "darwin", false, true);
    bridge.reorder.mockResolvedValue({ ok: false });
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    expect(bridge.list).toHaveBeenCalledTimes(2); // mount + open refetch
    const rows = screen.getAllByRole("menuitemradio");
    const dataTransfer = {
      setData: vi.fn(),
      types: ["application/x-shell-host-reorder"],
      effectAllowed: "",
      dropEffect: "",
    };
    fireEvent.dragStart(rows[1], { dataTransfer });
    fireEvent.dragOver(rows[0], { dataTransfer });
    fireEvent.drop(rows[0], { dataTransfer });
    await waitFor(() => {
      expect(screen.getByText("Shell host reorder failed")).toBeInTheDocument();
    });
    expect(bridge.list).toHaveBeenCalledTimes(3); // failure refetch reconciles
  });

  it("older-shell degradation: a plain 4-field projection renders today's menu with no affordances", async () => {
    // list/switch only (no add, no reorder), entries without accentColor/waiting.
    await renderInteractive(hosts);
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    const rows = screen.getAllByRole("menuitemradio");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("✓");
    expect(rows[0].textContent).toContain("⌥⌘1");
    expect(rows[1].textContent).toContain("⌥⌘2");
    expect(screen.queryByTestId("shell-host-accent-bar")).not.toBeInTheDocument();
    expect(screen.queryByText("⋮⋮")).not.toBeInTheDocument();
    expect(screen.queryByText(/●/)).not.toBeInTheDocument();
    for (const row of rows) expect(row).toHaveAttribute("draggable", "false");
    expect(screen.queryByRole("menuitem", { name: "Add Host…" })).not.toBeInTheDocument();
  });
});

describe("ShellTitlebarStrip host menu — Disconnect + inline rename", () => {
  /** Bridge carrying all four optional invokers (add/reorder/remove/rename). */
  const renderFull = (list: unknown[] = hosts) =>
    renderInteractive(list, "darwin", true, true, true, true);

  it("renders the Disconnect and Rename icons per row when the bridge carries both invokers", async () => {
    await renderFull();
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    expect(screen.getAllByRole("button", { name: "Disconnect" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Rename" })).toHaveLength(2);
  });

  it("gates each icon on its own capability (remove without rename renders only Disconnect)", async () => {
    await renderInteractive(hosts, "darwin", false, false, true, false);
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    expect(screen.getAllByRole("button", { name: "Disconnect" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Rename" })).not.toBeInTheDocument();
  });

  it("renders plain rows on an older shell — no icons, and the keys fall through unswallowed", async () => {
    await renderInteractive(hosts); // list/switch only
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rename" })).not.toBeInTheDocument();
    const rows = screen.getAllByRole("menuitemradio");
    await waitFor(() => expect(document.activeElement).toBe(rows[0]));
    // fireEvent returns false when a handler called preventDefault — both
    // keys must fall through untouched without the capability.
    expect(fireEvent.keyDown(document, { key: "Backspace" })).toBe(true);
    expect(fireEvent.keyDown(document, { key: "F2" })).toBe(true);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("Disconnect icon click invokes remove with the row id and refetches (menu stays open)", async () => {
    const bridge = await renderFull();
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    expect(bridge.list).toHaveBeenCalledTimes(2); // mount + open refetch
    fireEvent.click(screen.getAllByRole("button", { name: "Disconnect" })[1]);
    expect(bridge.remove).toHaveBeenCalledTimes(1);
    expect(bridge.remove).toHaveBeenCalledWith("b");
    // Success reconciles via refetch; the menu stays open for background rows.
    await waitFor(() => expect(bridge.list).toHaveBeenCalledTimes(3));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(bridge.switch).not.toHaveBeenCalled();
  });

  it("a failed disconnect surfaces the toast and refetches", async () => {
    const bridge = await renderFull();
    bridge.remove.mockResolvedValue({ ok: false });
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Disconnect" })[0]);
    await waitFor(() => {
      expect(screen.getByText("Shell host disconnect failed")).toBeInTheDocument();
    });
    await waitFor(() => expect(bridge.list).toHaveBeenCalledTimes(3));
  });

  it("Delete/Backspace on a focused host row disconnects it; the footer is not bound", async () => {
    const bridge = await renderFull();
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    const rows = screen.getAllByRole("menuitemradio");
    await waitFor(() => expect(document.activeElement).toBe(rows[0]));
    expect(fireEvent.keyDown(document, { key: "Backspace" })).toBe(false); // swallowed
    expect(bridge.remove).toHaveBeenCalledTimes(1);
    expect(bridge.remove).toHaveBeenCalledWith("a");
    expect(fireEvent.keyDown(document, { key: "Delete" })).toBe(false);
    expect(bridge.remove).toHaveBeenCalledTimes(2);
    // Wrap up to the Add-Host footer: Delete there falls through, no invoke.
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Add Host…" }));
    expect(fireEvent.keyDown(document, { key: "Delete" })).toBe(true);
    expect(bridge.remove).toHaveBeenCalledTimes(2);
  });

  it("F2 on a focused row enters inline rename (input prefilled, focused, replaces the row button)", async () => {
    await renderFull();
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    const rows = screen.getAllByRole("menuitemradio");
    await waitFor(() => expect(document.activeElement).toBe(rows[0]));
    fireEvent.keyDown(document, { key: "F2" });
    const input = screen.getByRole("textbox", { name: "Rename studio-mac" });
    expect(input).toHaveValue("studio-mac");
    await waitFor(() => expect(document.activeElement).toBe(input));
    // The editing row's primary button is replaced (no nested interactive).
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(1);
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("the Rename icon enters inline edit for its row", async () => {
    await renderFull();
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Rename" })[1]);
    const input = screen.getByRole("textbox", { name: "Rename lab" });
    expect(input).toHaveValue("lab");
  });

  it("Enter commits the trimmed name: one invoke, optimistic update, refetch, menu stays open", async () => {
    const bridge = await renderFull();
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    const rows = screen.getAllByRole("menuitemradio");
    await waitFor(() => expect(document.activeElement).toBe(rows[0]));
    fireEvent.keyDown(document, { key: "F2" });
    const input = screen.getByRole("textbox", { name: "Rename studio-mac" });
    fireEvent.change(input, { target: { value: " workshop " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(bridge.rename).toHaveBeenCalledTimes(1);
    expect(bridge.rename).toHaveBeenCalledWith("a", "workshop");
    // Optimistic local rename renders immediately; the menu stays open.
    expect(screen.getAllByRole("menuitemradio")[0].textContent).toContain("workshop");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    // The reconcile refetch runs (its list snapshot is the store's truth).
    await waitFor(() => expect(bridge.list).toHaveBeenCalledTimes(3));
  });

  it("blur commits the edit", async () => {
    const bridge = await renderFull();
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    const rows = screen.getAllByRole("menuitemradio");
    await waitFor(() => expect(document.activeElement).toBe(rows[0]));
    fireEvent.keyDown(document, { key: "F2" });
    const input = screen.getByRole("textbox", { name: "Rename studio-mac" });
    fireEvent.change(input, { target: { value: "blurred" } });
    fireEvent.blur(input);
    expect(bridge.rename).toHaveBeenCalledTimes(1);
    expect(bridge.rename).toHaveBeenCalledWith("a", "blurred");
  });

  it("Escape cancels the edit without invoking and without closing the menu", async () => {
    const bridge = await renderFull();
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    const rows = screen.getAllByRole("menuitemradio");
    await waitFor(() => expect(document.activeElement).toBe(rows[0]));
    fireEvent.keyDown(document, { key: "F2" });
    const input = screen.getByRole("textbox", { name: "Rename studio-mac" });
    fireEvent.change(input, { target: { value: "never committed" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(bridge.rename).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    // The row returns to display mode with the prior name.
    const restored = screen.getAllByRole("menuitemradio");
    expect(restored).toHaveLength(2);
    expect(restored[0].textContent).toContain("studio-mac");
  });

  it("an empty or unchanged commit performs no invoke", async () => {
    const bridge = await renderFull();
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    let rows = screen.getAllByRole("menuitemradio");
    await waitFor(() => expect(document.activeElement).toBe(rows[0]));
    // Whitespace-only commit → cancel.
    fireEvent.keyDown(document, { key: "F2" });
    let input = screen.getByRole("textbox", { name: "Rename studio-mac" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(bridge.rename).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    // Unchanged commit → cancel.
    rows = screen.getAllByRole("menuitemradio");
    rows[0].focus();
    fireEvent.keyDown(document, { key: "F2" });
    input = screen.getByRole("textbox", { name: "Rename studio-mac" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(bridge.rename).not.toHaveBeenCalled();
  });

  it("a failed rename surfaces the toast and refetches", async () => {
    const bridge = await renderFull();
    bridge.rename.mockResolvedValue({ ok: false });
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    const rows = screen.getAllByRole("menuitemradio");
    await waitFor(() => expect(document.activeElement).toBe(rows[0]));
    fireEvent.keyDown(document, { key: "F2" });
    const input = screen.getByRole("textbox", { name: "Rename studio-mac" });
    fireEvent.change(input, { target: { value: "denied" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(screen.getByText("Shell host rename failed")).toBeInTheDocument();
    });
    await waitFor(() => expect(bridge.list).toHaveBeenCalledTimes(3));
  });

  it("edit mode suspends menu keys: arrows move no focus, Escape exits only the edit", async () => {
    await renderFull();
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    const rows = screen.getAllByRole("menuitemradio");
    await waitFor(() => expect(document.activeElement).toBe(rows[0]));
    fireEvent.keyDown(document, { key: "F2" });
    const input = screen.getByRole("textbox", { name: "Rename studio-mac" });
    await waitFor(() => expect(document.activeElement).toBe(input));
    // ArrowDown inside the input: no roving, no reorder, menu stays open.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    // Escape inside the input exits the edit only.
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("a remove-shrunk refetch reconciles in place and keeps the focus re-clamp guard", async () => {
    // Mount + open resolve both hosts; the post-remove refetch resolves one.
    const list = vi
      .fn<() => Promise<unknown>>()
      .mockImplementationOnce(() => Promise.resolve({ ok: true, servers: hosts }))
      .mockImplementationOnce(() => Promise.resolve({ ok: true, servers: hosts }))
      .mockImplementation(() => Promise.resolve({ ok: true, servers: [hosts[1]] }));
    const remove = vi.fn(() => Promise.resolve({ ok: true }));
    window.runkitShell = {
      version: "1.2.3",
      platform: "darwin",
      servers: { list, switch: vi.fn(() => Promise.resolve({ ok: true })), remove },
    };
    renderStrip();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Switch host" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    let rows = screen.getAllByRole("menuitemradio");
    await waitFor(() => expect(document.activeElement).toBe(rows[0]));
    fireEvent.keyDown(document, { key: "ArrowDown" }); // seat on row 1 (out of bounds post-shrink)
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.click(screen.getAllByRole("button", { name: "Disconnect" })[0]);
    expect(remove).toHaveBeenCalledWith("a");
    await waitFor(() => expect(screen.getAllByRole("menuitemradio")).toHaveLength(1));
    // The seat clamps onto the surviving row and focus follows.
    rows = screen.getAllByRole("menuitemradio");
    await waitFor(() => {
      expect(rows[0]).toHaveAttribute("tabindex", "0");
      expect(document.activeElement).toBe(rows[0]);
    });
    expect(rows[0].textContent).toContain("lab");
  });

  it("a remove-emptied refetch closes the menu and releases arrow keys app-wide", async () => {
    const list = vi
      .fn<() => Promise<unknown>>()
      .mockImplementationOnce(() => Promise.resolve({ ok: true, servers: hosts }))
      .mockImplementationOnce(() => Promise.resolve({ ok: true, servers: hosts }))
      .mockImplementation(() => Promise.resolve({ ok: true, servers: [] }));
    const remove = vi.fn(() => Promise.resolve({ ok: true }));
    window.runkitShell = {
      version: "1.2.3",
      platform: "darwin",
      servers: { list, switch: vi.fn(() => Promise.resolve({ ok: true })), remove },
    };
    renderStrip();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Switch host" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Switch host" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Disconnect" })[0]);
    // The emptied list downgrades the strip to the static label (close-on-empty).
    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
    expect(fireEvent.keyDown(document.body, { key: "ArrowDown" })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: "ArrowUp" })).toBe(true);
  });
});

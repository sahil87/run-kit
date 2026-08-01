import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import { ShortcutsOverlay } from "./shortcuts-overlay";
import { KEYBINDINGS_STORAGE_KEY } from "@/lib/keybindings";
import type { Keybinding } from "@/api/client";

// The overlay reads the current server from the session context and fetches
// the tmux bindings itself (260801-sm6g) — mock both seams so unit tests stay
// light (no SessionProvider sockets, no network). Default: NO current server
// (the effect resolves `[]` synchronously → the empty state, no async state
// updates outside act).
let mockCurrentServer: string | null = null;
vi.mock("@/contexts/session-context", () => ({
  useSessionContext: () => ({ currentServer: mockCurrentServer }),
}));

const getKeybindingsMock = vi.fn<(server: string) => Promise<Keybinding[]>>();
vi.mock("@/api/client", async (orig) => {
  const actual = await orig<typeof import("@/api/client")>();
  return {
    ...actual,
    getKeybindings: (server: string) => getKeybindingsMock(server),
  };
});

beforeEach(() => {
  mockCurrentServer = null;
  getKeybindingsMock.mockReset();
  getKeybindingsMock.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderOverlay(onClose = vi.fn()) {
  render(<ShortcutsOverlay open={true} onClose={onClose} />);
  return onClose;
}

describe("ShortcutsOverlay", () => {
  it("renders nothing when closed", () => {
    render(<ShortcutsOverlay open={false} onClose={() => {}} />);
    expect(screen.queryByTestId("shortcuts-overlay")).toBeNull();
  });

  it("renders the dialog with grouped rows, scope badges, and locked shell rows", () => {
    renderOverlay();
    const overlay = screen.getByTestId("shortcuts-overlay");
    expect(overlay.querySelector('[role="dialog"]')).not.toBeNull();
    // Group headings (SHELL is no longer a top-level section — 260801-sm6g;
    // TMUX joined as the merged read-only section)
    expect(screen.getByText("GLOBAL")).toBeInTheDocument();
    expect(screen.getByText("TERMINAL")).toBeInTheDocument();
    expect(screen.getByText("BOARD")).toBeInTheDocument();
    expect(screen.getByText("TMUX")).toBeInTheDocument();
    expect(screen.queryByText("SHELL — DESKTOP APP")).toBeNull();
    // Starter rows
    expect(screen.getByText("New session")).toBeInTheDocument();
    expect(screen.getByText("Next window")).toBeInTheDocument();
    // Scope badges (terminal + board rows carry pills)
    expect(screen.getAllByText("terminal").length).toBeGreaterThan(0);
    // Locked shell rows (accelerators owned by the shell menu)
    expect(screen.getByText("Switch to server 1–9")).toBeInTheDocument();
    expect(
      screen.getAllByLabelText("Locked — bound by the desktop shell menu").length,
    ).toBeGreaterThan(0);
  });

  it("marks browser-reserved rows (jsdom is a browser host)", () => {
    renderOverlay();
    // N/T/W are browser-reserved outside the desktop shell.
    expect(screen.getAllByText("browser").length).toBe(3);
  });

  it("filters rows by the query and hides empty groups", () => {
    renderOverlay();
    fireEvent.change(screen.getByLabelText("Filter shortcuts"), {
      target: { value: "waiting" },
    });
    expect(screen.getByText("Next waiting agent")).toBeInTheDocument();
    expect(screen.queryByText("New session")).toBeNull();
    expect(screen.queryByText("BOARD")).toBeNull();
  });

  it("toggles keycap platform rendering (macOS ↔ Win·Linux)", () => {
    renderOverlay();
    // jsdom detects as non-mac → Shift/Ctrl keycaps present.
    expect(screen.getAllByText("Shift").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("macOS"));
    expect(screen.getAllByText("⇧").length).toBeGreaterThan(0);
  });

  it("mac display renders the switcher locked row as ⌥⌘ and drops the server digit claims (260731-nv5r)", () => {
    renderOverlay();
    // Win·Linux display (jsdom default): the switcher row uses Shift+Ctrl
    // caps — no ⌥ anywhere — and the shifted tier map claims the switcher
    // digits as "server" (Digit1/2/9 have their own cells; 3–8 sit in the
    // decorative ellipsis).
    expect(screen.queryByText("⌥")).toBeNull();
    expect(screen.getAllByTitle("server").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("macOS"));
    // The switcher row diverges to ⌥⌘1…9 (the mac shell tier) — the only ⌥
    // keycap in the overlay — while Force reload keeps the shared ⇧⌘ caps.
    expect(screen.getAllByText("⌥").length).toBe(1);
    expect(screen.getAllByText("⇧").length).toBeGreaterThan(0);
    expect(screen.getByText("Switch to server 1–9")).toBeInTheDocument();
    // The mac shifted map carries no shell "server" digit claims: Digit1/2/9
    // render free (the 3/4/5 screenshot claims live inside the ellipsis run).
    expect(screen.queryAllByTitle("server")).toHaveLength(0);
  });

  it("macOS display offers the ⌘ map layer via the modifier picker; Win·Linux display omits it (260801-r8j2)", () => {
    renderOverlay();
    // jsdom host → Win·Linux display by default: no modifier picker (plain
    // Ctrl belongs to the pane there) — a static "Holding Shift Ctrl" label
    // and the shifted layer rendered.
    expect(screen.queryByRole("group", { name: "Keyboard map modifier" })).toBeNull();
    expect(screen.getByText(/Holding/)).toBeInTheDocument();
    expect(screen.getByTitle("incognito")).toBeInTheDocument();
    expect(screen.queryByTitle("address bar")).toBeNull();
    fireEvent.click(screen.getByText("macOS"));
    // The picker appears with ⇧⌘ selected by default.
    const picker = screen.getByRole("group", { name: "Keyboard map modifier" });
    const cmdBtn = within(picker).getByText("⌘");
    expect(within(picker).getByText("⇧ ⌘")).toHaveAttribute("aria-pressed", "true");
    expect(cmdBtn).toHaveAttribute("aria-pressed", "false");
    // Selecting ⌘ swaps the SINGLE grid to the cmd layer (jsdom is a browser
    // host → the mac-browser ⌘ claimed set renders; the shifted-only browser
    // claims disappear).
    fireEvent.click(cmdBtn);
    expect(cmdBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTitle("address bar")).toBeInTheDocument();
    expect(screen.queryByTitle("incognito")).toBeNull();
    // Switching the display back to Win·Linux drops the ⌘ option and falls
    // back to the shifted layer.
    fireEvent.click(screen.getByText("Win · Linux"));
    expect(screen.queryByRole("group", { name: "Keyboard map modifier" })).toBeNull();
    expect(screen.queryByTitle("address bar")).toBeNull();
    expect(screen.getByTitle("incognito")).toBeInTheDocument();
  });

  it("the ⌘ layer selection survives close/reopen (session-scoped view state, 260801-r8j2)", () => {
    const { rerender } = render(<ShortcutsOverlay open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("macOS"));
    fireEvent.click(
      within(screen.getByRole("group", { name: "Keyboard map modifier" })).getByText("⌘"),
    );
    rerender(<ShortcutsOverlay open={false} onClose={vi.fn()} />);
    rerender(<ShortcutsOverlay open={true} onClose={vi.fn()} />);
    const picker = screen.getByRole("group", { name: "Keyboard map modifier" });
    expect(within(picker).getByText("⌘")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTitle("address bar")).toBeInTheDocument();
  });

  it("header hint shows the HOST-effective chord: ⌘/ on a mac host (260730-n789)", () => {
    // jsdom detects as a win/linux browser host → the shifted base chord.
    renderOverlay();
    expect(screen.getByText(/^Shift\+Ctrl\+\/ toggles this sheet$/)).toBeInTheDocument();
    cleanup();
    // Spoof a mac host: the overlay toggle demotes to the ⌘ tier (macTier,
    // no shell gate), so the header must advertise ⌘/ — never ⇧⌘/.
    Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
    try {
      renderOverlay();
      expect(screen.getByText(/^⌘\/ toggles this sheet$/)).toBeInTheDocument();
    } finally {
      // Drop the instance shadow — jsdom's prototype getter resumes.
      delete (navigator as { platform?: string }).platform;
    }
  });

  it("hides the header hint when the overlay toggle is unbound", () => {
    localStorage.setItem(KEYBINDINGS_STORAGE_KEY, JSON.stringify({ "shortcuts-overlay": null }));
    renderOverlay();
    expect(screen.queryByText(/toggles this sheet/)).toBeNull();
  });

  it("click-to-capture rebinds, persists the diff, and shows the modified reset affordance", () => {
    renderOverlay();
    fireEvent.click(screen.getByLabelText("Change binding for Next window"));
    // Modifier-only press keeps capturing; then a valid shifted chord lands.
    fireEvent.keyDown(window, { key: "Shift", code: "ShiftLeft", shiftKey: true });
    fireEvent.keyDown(window, {
      key: "U",
      code: "KeyU",
      shiftKey: true,
      ctrlKey: true,
    });
    expect(JSON.parse(localStorage.getItem(KEYBINDINGS_STORAGE_KEY) ?? "{}")).toEqual({
      "window-next": { code: "KeyU", tier: "shifted" },
    });
    // Reset restores the default and drops the diff.
    fireEvent.click(screen.getByLabelText("Reset binding for Next window"));
    expect(localStorage.getItem(KEYBINDINGS_STORAGE_KEY)).toBeNull();
  });

  it("Escape cancels capture without persisting", () => {
    const onClose = renderOverlay();
    fireEvent.click(screen.getByLabelText("Change binding for Next window"));
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(localStorage.getItem(KEYBINDINGS_STORAGE_KEY)).toBeNull();
    // The capture-phase Escape must not close the overlay (capture-only cancel).
    expect(onClose).not.toHaveBeenCalled();
  });

  it("steal-with-warning: capturing another action's combo unbinds it and flags it", () => {
    renderOverlay();
    fireEvent.click(screen.getByLabelText("Change binding for Next window"));
    // ⇧Ctrl+A is owned by "Next waiting agent".
    fireEvent.keyDown(window, { key: "A", code: "KeyA", shiftKey: true, ctrlKey: true });
    expect(screen.getByText(/now unbound/)).toBeInTheDocument();
    expect(screen.getByTitle("unbound — click to rebind")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(KEYBINDINGS_STORAGE_KEY) ?? "{}")).toEqual({
      "window-next": { code: "KeyA", tier: "shifted" },
      "agent-next-waiting": null,
    });
  });

  it("reset all clears every override", () => {
    localStorage.setItem(
      KEYBINDINGS_STORAGE_KEY,
      JSON.stringify({ "window-next": { code: "KeyU", tier: "shifted" } }),
    );
    renderOverlay();
    fireEvent.click(screen.getByText("reset all"));
    expect(localStorage.getItem(KEYBINDINGS_STORAGE_KEY)).toBeNull();
  });

  it("Escape (outside capture) and the close button both close the overlay", () => {
    const onClose = renderOverlay();
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("ShortcutsOverlay merged view (260801-sm6g)", () => {
  const TMUX_BINDINGS: Keybinding[] = [
    { key: "F3", table: "root", command: "previous-window", label: "Previous window (tmux)" },
    { key: "S-F3", table: "root", command: "select-pane -t :.-", label: "Previous pane" },
    { key: "\\", table: "prefix", command: "split-window -h", label: "Split vertically" },
  ];

  it("renders the sticky jump-nav chips for every section", () => {
    renderOverlay();
    const nav = screen.getByTestId("shortcuts-jump-nav");
    for (const label of ["key map", "global", "terminal", "board", "tmux"]) {
      expect(within(nav).getByText(label)).toBeInTheDocument();
    }
    // No custom section on the bare mount (no macros, no paletteTargets).
    expect(within(nav).queryByText("custom")).toBeNull();
  });

  it("filtering shows live chip counts, dims empty chips, and hides the key map", () => {
    renderOverlay();
    expect(screen.getByText(/Holding/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter shortcuts"), {
      target: { value: "waiting" },
    });
    // The key map auto-hides while a filter is active.
    expect(screen.queryByText(/Holding/)).toBeNull();
    const nav = screen.getByTestId("shortcuts-jump-nav");
    // "waiting" matches exactly one global row (Next waiting agent).
    const globalChip = within(nav).getByText("global").closest("button")!;
    expect(globalChip.textContent).toBe("global1");
    expect(globalChip.className).not.toContain("opacity-40");
    // Zero-hit sections dim their chips.
    const boardChip = within(nav).getByText("board").closest("button")!;
    expect(boardChip.textContent).toBe("board0");
    expect(boardChip.className).toContain("opacity-40");
    // Clearing the filter restores the map and drops the counts.
    fireEvent.change(screen.getByLabelText("Filter shortcuts"), { target: { value: "" } });
    expect(screen.getByText(/Holding/)).toBeInTheDocument();
    expect(within(nav).getByText("global").closest("button")!.textContent).toBe("global");
  });

  it("collapse map folds the key grid; expand restores it (new one-line claimed legend)", () => {
    renderOverlay();
    const legend = "claimed — taken by the OS / browser / app menu (the desktop app frees the browser ones)";
    expect(screen.getByText(legend)).toBeInTheDocument();
    fireEvent.click(screen.getByText("▾ collapse map"));
    expect(screen.queryByText(legend)).toBeNull();
    fireEvent.click(screen.getByText("▸ expand map"));
    expect(screen.getByText(legend)).toBeInTheDocument();
  });

  it("shell-owned rows render as a GLOBAL subgroup", () => {
    renderOverlay();
    expect(
      screen.getByText("Shell-owned — accelerators live in the desktop shell menu"),
    ).toBeInTheDocument();
    const globalSection = screen.getByText("GLOBAL").closest("section")!;
    expect(within(globalSection).getByText("Switch to server 1–9")).toBeInTheDocument();
    expect(within(globalSection).getByText("Force reload")).toBeInTheDocument();
  });

  it("tmux section renders Direct + Prefix locked rows from getKeybindings", async () => {
    mockCurrentServer = "rk";
    getKeybindingsMock.mockResolvedValue(TMUX_BINDINGS);
    renderOverlay();
    const tmux = screen.getByTestId("tmux-section");
    await waitFor(() => expect(within(tmux).getByText("Previous pane")).toBeInTheDocument());
    expect(getKeybindingsMock).toHaveBeenCalledWith("rk");
    // Subheads: root table under Direct, prefix table under the sequence hint.
    expect(within(tmux).getByText("Direct")).toBeInTheDocument();
    expect(within(tmux).getByText(/Prefix —/)).toBeInTheDocument();
    // The section header names the source server.
    expect(within(tmux).getByText("rk")).toBeInTheDocument();
    // Prefix rows render as a sequence: Ctrl S then \.
    expect(within(tmux).getByText("Split vertically")).toBeInTheDocument();
    expect(within(tmux).getByText("then")).toBeInTheDocument();
    // Every tmux row is locked (read-only — pressed inside the pane).
    expect(
      within(tmux).getAllByLabelText("Locked — a tmux binding, pressed inside the pane"),
    ).toHaveLength(3);
  });

  it("shows the tmux empty state when no current server exists (board/host routes)", () => {
    renderOverlay(); // mockCurrentServer = null
    expect(screen.getByText("No tmux server running")).toBeInTheDocument();
    expect(getKeybindingsMock).not.toHaveBeenCalled();
  });

  it("shows the tmux empty state when the fetch fails", async () => {
    mockCurrentServer = "rk";
    getKeybindingsMock.mockRejectedValue(new Error("boom"));
    renderOverlay();
    await waitFor(() =>
      expect(screen.getByText("No tmux server running")).toBeInTheDocument(),
    );
  });

  it("one filter spans app + tmux rows and the tmux chip counts them", async () => {
    mockCurrentServer = "rk";
    getKeybindingsMock.mockResolvedValue(TMUX_BINDINGS);
    renderOverlay();
    const tmux = screen.getByTestId("tmux-section");
    await waitFor(() => expect(within(tmux).getByText("Split vertically")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Filter shortcuts"), {
      target: { value: "split" },
    });
    // The tmux hit stays visible; app sections with no hits disappear.
    expect(within(tmux).getByText("Split vertically")).toBeInTheDocument();
    expect(screen.queryByText("GLOBAL")).toBeNull();
    const nav = screen.getByTestId("shortcuts-jump-nav");
    expect(within(nav).getByText("tmux").closest("button")!.textContent).toBe("tmux1");
    expect(within(nav).getByText("global").closest("button")!.textContent).toBe("global0");
  });
});

describe("ShortcutsOverlay host-divergence row facts (260801-r8j2)", () => {
  // The desktop badge + other-host hint gate on the PHYSICAL host, so these
  // spoof `navigator.platform` (the header-hint test's pattern) and, for the
  // shell case, inject the `window.runkitShell` bridge marker.
  function spoofMacHost() {
    Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
  }
  function unspoofMacHost() {
    delete (navigator as { platform?: string }).platform;
  }

  it("mac BROWSER host: exactly the macShellOnly quartet rows carry the desktop badge + desktop-chord hint", () => {
    spoofMacHost();
    try {
      renderOverlay();
      // Exactly four badges — N/T/W/, (260801-mqim adds settings-open);
      // host-invariant rows carry none.
      expect(screen.getAllByText("desktop")).toHaveLength(4);
      // The hint names the OTHER host's (desktop shell) chord.
      expect(screen.getByText("in desktop app: ⌘N")).toBeInTheDocument();
      expect(screen.getByText("in desktop app: ⌘T")).toBeInTheDocument();
      expect(screen.getByText("in desktop app: ⌘W")).toBeInTheDocument();
      expect(screen.getByText("in desktop app: ⌘,")).toBeInTheDocument();
      // The amber reserved pill coexists on the browser-reserved rows — N/T/W
      // only: settings-open's mac-browser default is the unclaimed ⇧⌘, (the
      // browser Comma claim sits on the unshifted cmd tier).
      expect(screen.getAllByText("browser")).toHaveLength(3);
    } finally {
      unspoofMacHost();
    }
  });

  it("mac SHELL host: the quartet hints read the browser chord (no reserved pills inside the shell)", () => {
    spoofMacHost();
    window.runkitShell = { version: "1", platform: "darwin" };
    try {
      renderOverlay();
      expect(screen.getAllByText("desktop")).toHaveLength(4);
      expect(screen.getByText("in browser: ⇧⌘N")).toBeInTheDocument();
      expect(screen.getByText("in browser: ⇧⌘T")).toBeInTheDocument();
      expect(screen.getByText("in browser: ⇧⌘W")).toBeInTheDocument();
      expect(screen.getByText("in browser: ⇧⌘,")).toBeInTheDocument();
      expect(screen.queryByText("browser")).toBeNull();
    } finally {
      delete window.runkitShell;
      unspoofMacHost();
    }
  });

  it("no badge on a win/linux host, and an override collapses the divergence", () => {
    // Default jsdom host (platform "other") → never a badge, whatever the
    // display toggle shows.
    renderOverlay();
    expect(screen.queryByText("desktop")).toBeNull();
    fireEvent.click(screen.getByText("macOS"));
    expect(screen.queryByText("desktop")).toBeNull();
    cleanup();
    // Spoofed mac host with an override on create-window: the overridden
    // combo applies verbatim on both hosts, so its row loses the badge while
    // the other three keep theirs.
    spoofMacHost();
    localStorage.setItem(
      KEYBINDINGS_STORAGE_KEY,
      JSON.stringify({ "create-window": { code: "KeyU", tier: "shifted" } }),
    );
    try {
      renderOverlay();
      expect(screen.getAllByText("desktop")).toHaveLength(3);
      expect(screen.queryByText("in desktop app: ⌘T")).toBeNull();
      expect(screen.getByText("in desktop app: ⌘N")).toBeInTheDocument();
    } finally {
      unspoofMacHost();
    }
  });
});

describe("ShortcutsOverlay CUSTOM section (260730-hbyh)", () => {
  const DISCUSS = {
    actionId: "macro:discuss",
    kind: "macro",
    label: "riff: discuss",
    target: { type: "riff", preset: "discuss" },
  };

  function renderWithTargets(opts?: {
    presets?: string[] | null;
    targets?: { id: string; label: string }[];
  }) {
    render(
      <ShortcutsOverlay
        open={true}
        onClose={vi.fn()}
        paletteTargets={opts?.targets ?? [{ id: "create-window", label: "Window: Create" }]}
        riffPresetNames={opts?.presets ?? ["discuss"]}
      />,
    );
  }

  it("renders no CUSTOM section when no macros exist and no targets are provided", () => {
    renderOverlay();
    expect(screen.queryByTestId("macro-section")).toBeNull();
  });

  it("renders macro rows with the command preview and an unbound state", () => {
    localStorage.setItem("runkit-macros", JSON.stringify([DISCUSS]));
    renderWithTargets();
    expect(screen.getByText("CUSTOM")).toBeInTheDocument();
    expect(screen.getByText("riff: discuss")).toBeInTheDocument();
    expect(screen.getByText("rk riff --preset discuss")).toBeInTheDocument();
    // No combo diff stored → unbound affordance.
    expect(screen.getByTitle("unbound — click to bind")).toBeInTheDocument();
    expect(screen.queryByText("missing preset")).toBeNull();
  });

  it("shows the missing-preset badge when the preset is absent from the known list", () => {
    localStorage.setItem(
      "runkit-macros",
      JSON.stringify([{ ...DISCUSS, target: { type: "riff", preset: "gone" } }]),
    );
    renderWithTargets({ presets: ["discuss"] });
    expect(screen.getByText("missing preset")).toBeInTheDocument();
  });

  it("shows no missing-preset badge when the preset list is unknown (null)", () => {
    localStorage.setItem("runkit-macros", JSON.stringify([DISCUSS]));
    renderWithTargets({ presets: null });
    expect(screen.queryByText("missing preset")).toBeNull();
  });

  it("add flow: pick a target, name it, add — macro persists and capture arms", () => {
    renderWithTargets();
    fireEvent.click(screen.getByText("+ bind a key to a palette action or riff preset…"));
    // Target list offers riff presets + palette actions (macros excluded).
    fireEvent.change(screen.getByLabelText("Search macro targets"), {
      target: { value: "discuss" },
    });
    fireEvent.click(screen.getByText("riff: discuss"));
    // Name pre-fills from the picked target; keep it and add.
    expect(screen.getByLabelText("Macro name")).toHaveValue("riff: discuss");
    fireEvent.click(screen.getByText("add + capture key"));

    const stored = JSON.parse(localStorage.getItem("runkit-macros") ?? "[]");
    expect(stored).toEqual([
      {
        actionId: "macro:riff-discuss",
        kind: "macro",
        label: "riff: discuss",
        target: { type: "riff", preset: "discuss" },
      },
    ]);
    // Capture armed on the fresh row.
    expect(screen.getByText("press keys…")).toBeInTheDocument();
    // Land a chord — the combo persists as an ordinary keybindings diff.
    fireEvent.keyDown(window, { code: "KeyD", key: "D", shiftKey: true, ctrlKey: true });
    expect(JSON.parse(localStorage.getItem(KEYBINDINGS_STORAGE_KEY) ?? "{}")).toEqual({
      "macro:riff-discuss": { code: "KeyD", tier: "shifted" },
    });
  });

  it("delete removes the macro definition and its keybindings diff", () => {
    localStorage.setItem("runkit-macros", JSON.stringify([DISCUSS]));
    localStorage.setItem(
      KEYBINDINGS_STORAGE_KEY,
      JSON.stringify({ "macro:discuss": { code: "KeyD", tier: "shifted" } }),
    );
    renderWithTargets();
    fireEvent.click(screen.getByLabelText("Delete macro riff: discuss"));
    expect(screen.queryByText("rk riff --preset discuss")).toBeNull();
    expect(localStorage.getItem("runkit-macros")).toBeNull();
    expect(localStorage.getItem(KEYBINDINGS_STORAGE_KEY)).toBeNull();
  });

  it("capturing a builtin's combo for a macro steals it and flags the victim", () => {
    localStorage.setItem("runkit-macros", JSON.stringify([DISCUSS]));
    renderWithTargets();
    fireEvent.click(screen.getByTitle("unbound — click to bind"));
    fireEvent.keyDown(window, { code: "KeyL", key: "L", shiftKey: true, ctrlKey: true });
    // Steal warning names the victim; the builtin is now unbound.
    expect(screen.getByText(/took Shift\+Ctrl\+L from “Next window”/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(KEYBINDINGS_STORAGE_KEY) ?? "{}")).toEqual({
      "macro:discuss": { code: "KeyL", tier: "shifted" },
      "window-next": null,
    });
  });

  it("hides the add row when no paletteTargets prop is provided (board mount)", () => {
    localStorage.setItem("runkit-macros", JSON.stringify([DISCUSS]));
    renderOverlay();
    // Rows still render (view/rebind/delete), but no add flow.
    expect(screen.getByText("rk riff --preset discuss")).toBeInTheDocument();
    expect(
      screen.queryByText("+ bind a key to a palette action or riff preset…"),
    ).toBeNull();
  });
});

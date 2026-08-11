import { StrictMode } from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, act, waitFor } from "@testing-library/react";
import { Sidebar, SESSION_COLLAPSED_STORAGE_KEY } from "./index";
import { OptimisticProvider } from "@/contexts/optimistic-context";
import { HostMetricsProvider, MetricsProvider, StandaloneSessionContextProvider } from "@/contexts/session-context";
import { FocusedPaneProvider, useRegisterFocusedPane, type FocusedPane } from "@/contexts/focused-pane-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { InstanceAccentValueProvider, type InstanceAccent } from "@/contexts/instance-accent-context";
import { InstanceNameValueProvider, type InstanceName } from "@/contexts/instance-name-context";
import { ChromeProvider } from "@/contexts/chrome-context";
import { SettingsDialogProvider } from "@/contexts/settings-dialog-context";
import { ToastProvider } from "@/components/toast";
import { useWindowStore } from "@/store/window-store";
import { useSelectionStore } from "@/store/selection-store";
import { getAllServerColors, setServerColor } from "@/api/client";
import { stubMatchMedia } from "@/test-utils/match-media";
import {
  computeRowTints,
  computeRowBorders,
  UNCOLORED_SELECTED_KEY,
  DEFAULT_DARK_THEME,
} from "@/themes";
import type { MetricsSnapshot, ProjectSession } from "@/types";

// HostPanel (inside Sidebar) consumes the instance-accent context; inject a
// static null accent so sidebar tests need no fetching provider (1etw).
const NULL_ACCENT: InstanceAccent = {
  color: null,
  isExplicit: false,
  stripeHex: null,
  washHex: null,
  titlebarHex: null,
  setColor: () => {},
};

// HostPanel also consumes the instance-name context (o7q8); inject a static
// empty value so these tests need no fetching provider.
const NULL_NAME: InstanceName = {
  hostname: "",
  instanceName: null,
  displayName: "",
  setInstanceName: () => {},
};


const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: "/" } }),
}));

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    getAllServerColors: vi.fn().mockResolvedValue({}),
    setServerColor: vi.fn().mockResolvedValue({ ok: true }),
  };
});

// Footer version click-to-copy (260724-6j1v) — deterministic clipboard seam
// (jsdom has no navigator.clipboard).
vi.mock("@/lib/clipboard", () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
}));
import { copyToClipboard } from "@/lib/clipboard";

// jsdom does not implement matchMedia — ThemeProvider + media-query hooks need it.
stubMatchMedia((query) => query.includes("prefers-color-scheme: dark"));

const SERVERS = [
  { name: "primary", sessionCount: 1 },
  { name: "alpha", sessionCount: 0 },
  { name: "beta", sessionCount: 0 },
];

const PRIMARY_SESSIONS: ProjectSession[] = [
  {
    name: "main",
    windows: [
      {
        index: 0,
        windowId: "@0",
        name: "shell",
        worktreePath: "~/code/run-kit",
        activity: "active",
        isActiveWindow: true,
        paneCommand: "zsh",
        activityTimestamp: Math.floor(Date.now() / 1000),
      },
    ],
  },
];

type RenderOpts = {
  currentServer?: string | null;
  servers?: { name: string; sessionCount: number }[];
  /** Wrap the tree in <StrictMode> to surface impure state updaters (the
   *  double-invocation the real app gets via main.tsx). Off by default so the
   *  coupling tests keep their single-pass render. */
  strict?: boolean;
  /** Publish a focused board pane into the FocusedPaneProvider (260720-zx4i) —
   *  simulates BoardPage's registration. `undefined` = no registrant mounted. */
  focusedPane?: FocusedPane;
  /** Override the derived per-server sessions map (board-route tests need
   *  session data on a NON-current server). */
  sessionsByServer?: Map<string, ProjectSession[]>;
  /** Per-page connection state fed to the footer dot (defaults false). */
  isConnected?: boolean;
  /** Daemon version fed to the footer version readout (defaults null = hidden). */
  daemonVersion?: string | null;
  /** Host-global metrics snapshot fed to HostMetricsProvider (defaults null). */
  hostMetrics?: MetricsSnapshot | null;
  /** Override the Sidebar's onKillServer prop (x4sf) — the header ✕ routes
   *  through it; tests assert the invocation, never a direct kill call. */
  onKillServer?: (name: string) => void;
};

/** Mounts BoardPage's registration seam inside the provider (260720-zx4i). */
function FocusedPaneRegistrant({ pane }: { pane: FocusedPane }) {
  useRegisterFocusedPane(pane);
  return null;
}

function sidebarTree(opts: RenderOpts = {}) {
  const currentServer = opts.currentServer === undefined ? "primary" : opts.currentServer;
  const servers = opts.servers ?? SERVERS;
  const sessionsByServer = opts.sessionsByServer ?? new Map(
    servers.map((s) => [s.name, s.name === currentServer ? PRIMARY_SESSIONS : []]),
  );
  const tree = (
    <ThemeProvider>
      <InstanceAccentValueProvider value={NULL_ACCENT}>
      <InstanceNameValueProvider value={NULL_NAME}>
      <ToastProvider>
        <OptimisticProvider>
          <StandaloneSessionContextProvider
            value={{
              sessionsByServer,
              sessionOrderByServer: new Map(servers.map((s) => [s.name, []])),
              isConnectedByServer: new Map(servers.map((s) => [s.name, false])),
              daemonVersion: opts.daemonVersion ?? null,
              metricsByServer: new Map(),
              currentServer,
              servers,
              refreshServers: vi.fn(),
            }}
          >
            <MetricsProvider value={null}>
              <HostMetricsProvider value={opts.hostMetrics ?? null}>
                <FocusedPaneProvider>
                  {opts.focusedPane !== undefined && (
                    <FocusedPaneRegistrant pane={opts.focusedPane} />
                  )}
                  <ChromeProvider>
                    <SettingsDialogProvider>
                      <Sidebar
                        currentServer={currentServer}
                        currentSession={currentServer ? "main" : null}
                        currentWindowId={currentServer ? "@0" : null}
                        isConnected={opts.isConnected ?? false}
                        onSelectWindow={vi.fn()}
                        onCreateWindow={vi.fn()}
                        onCreateSession={vi.fn()}
                        onCreateServer={vi.fn()}
                        onKillServer={opts.onKillServer ?? vi.fn()}
                      />
                    </SettingsDialogProvider>
                  </ChromeProvider>
                </FocusedPaneProvider>
              </HostMetricsProvider>
            </MetricsProvider>
          </StandaloneSessionContextProvider>
        </OptimisticProvider>
      </ToastProvider>
      </InstanceNameValueProvider>
    </InstanceAccentValueProvider>
    </ThemeProvider>
  );
  return opts.strict ? <StrictMode>{tree}</StrictMode> : tree;
}

function renderSidebar(opts: RenderOpts = {}) {
  return render(sidebarTree(opts));
}

/** Re-render the same tree with new props — used to simulate an SSE snapshot
 *  change (a window disappearing) without remounting the sidebar. */
function rerenderSidebar(
  rerender: ReturnType<typeof render>["rerender"],
  opts: RenderOpts = {},
) {
  rerender(sidebarTree(opts));
}

function getServerGroupHeader(name: string): HTMLElement | null {
  return screen.queryByRole("button", { name: new RegExp(`Collapse ${name} sessions|Expand ${name} sessions`) });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function getScopeChip(): HTMLElement {
  return screen.getByRole("button", { name: "Toggle sessions scope" });
}

describe("Sidebar — sessions-pane scope (runkit-panel-sessions-scope)", () => {
  it("renders all ServerGroups by default (scope `all`, no stored value)", () => {
    renderSidebar();

    expect(getServerGroupHeader("primary")).toBeInTheDocument();
    expect(getServerGroupHeader("alpha")).toBeInTheDocument();
    expect(getServerGroupHeader("beta")).toBeInTheDocument();
    expect(getScopeChip()).toHaveTextContent("ALL");
  });

  it("renders only the current server's ServerGroup in `current` scope, force-opened", () => {
    localStorage.setItem("runkit-panel-sessions-scope", "current");
    renderSidebar({ currentServer: "primary" });

    expect(getServerGroupHeader("primary")).toBeInTheDocument();
    expect(getServerGroupHeader("alpha")).not.toBeInTheDocument();
    expect(getServerGroupHeader("beta")).not.toBeInTheDocument();
    expect(getScopeChip()).toHaveTextContent("CUR");

    // Force-open: primary's group header reads "Collapse" (chevron points down).
    const primaryHeader = screen.getByRole("button", { name: /Collapse primary sessions/ });
    expect(primaryHeader).toHaveAttribute("aria-expanded", "true");
  });

  it("falls back to all servers in `current` scope when currentServer is null (board route) — no hint", () => {
    localStorage.setItem("runkit-panel-sessions-scope", "current");
    renderSidebar({ currentServer: null });

    expect(getServerGroupHeader("primary")).toBeInTheDocument();
    expect(getServerGroupHeader("alpha")).toBeInTheDocument();
    expect(getServerGroupHeader("beta")).toBeInTheDocument();
    expect(
      screen.queryByText("Select a server above to see its sessions."),
    ).not.toBeInTheDocument();
  });

  it("falls back to all servers in `current` scope when currentServer is missing from the list", () => {
    localStorage.setItem("runkit-panel-sessions-scope", "current");
    // Stale/deleted route param: currentServer names a server not in `servers`.
    renderSidebar({ currentServer: "gone" });

    expect(getServerGroupHeader("primary")).toBeInTheDocument();
    expect(getServerGroupHeader("alpha")).toBeInTheDocument();
    expect(getServerGroupHeader("beta")).toBeInTheDocument();
  });

  it("treats an unrecognized stored scope value as `all`", () => {
    localStorage.setItem("runkit-panel-sessions-scope", "bogus");
    renderSidebar({ currentServer: "primary" });

    expect(getServerGroupHeader("primary")).toBeInTheDocument();
    expect(getServerGroupHeader("alpha")).toBeInTheDocument();
    expect(getScopeChip()).toHaveTextContent("ALL");
  });

  it("does not overwrite persisted per-server collapse keys when force-opening the current group", () => {
    // User has the primary group collapsed in the multi-server tree.
    localStorage.setItem("runkit-panel-sessions-primary", "false");
    localStorage.setItem("runkit-panel-sessions-scope", "current");
    renderSidebar({ currentServer: "primary" });

    // The persisted value is unchanged after rendering with force-open in effect.
    expect(localStorage.getItem("runkit-panel-sessions-primary")).toBe("false");

    // And the rendered state is open (force-open dominates).
    const primaryHeader = screen.getByRole("button", { name: /Collapse primary sessions/ });
    expect(primaryHeader).toHaveAttribute("aria-expanded", "true");
  });

  it("chip click narrows the tree, persists `current`, and a second click restores `all`", () => {
    renderSidebar({ currentServer: "primary" });

    // Initially scope `all` → all groups visible.
    expect(getServerGroupHeader("alpha")).toBeInTheDocument();
    expect(getServerGroupHeader("beta")).toBeInTheDocument();

    fireEvent.click(getScopeChip());

    // Narrowed to the current server; value persisted; chip reflects state.
    expect(localStorage.getItem("runkit-panel-sessions-scope")).toBe("current");
    expect(getScopeChip()).toHaveTextContent("CUR");
    expect(getServerGroupHeader("primary")).toBeInTheDocument();
    expect(getServerGroupHeader("alpha")).not.toBeInTheDocument();
    expect(getServerGroupHeader("beta")).not.toBeInTheDocument();

    fireEvent.click(getScopeChip());

    // Restored: all groups return, value persisted back to `all`.
    expect(localStorage.getItem("runkit-panel-sessions-scope")).toBe("all");
    expect(getScopeChip()).toHaveTextContent("ALL");
    expect(getServerGroupHeader("alpha")).toBeInTheDocument();
    expect(getServerGroupHeader("beta")).toBeInTheDocument();
  });

  it("SERVER panel expansion no longer affects the sessions tree (delink regression)", () => {
    // The old coupling filtered the tree when the SERVER panel was open. The
    // scope state is now the only filter input — the panel key must be inert.
    localStorage.setItem("runkit-panel-server", "true");
    renderSidebar({ currentServer: "primary" });

    expect(getServerGroupHeader("primary")).toBeInTheDocument();
    expect(getServerGroupHeader("alpha")).toBeInTheDocument();
    expect(getServerGroupHeader("beta")).toBeInTheDocument();

    // Toggling the SERVER panel live changes nothing in the tree either.
    const serverPaneToggle = screen.getByRole("button", { name: /^Server/ });
    fireEvent.click(serverPaneToggle);
    expect(getServerGroupHeader("alpha")).toBeInTheDocument();
    fireEvent.click(serverPaneToggle);
    expect(getServerGroupHeader("alpha")).toBeInTheDocument();
  });

  it("falls back to 'No servers' when the server list is empty regardless of scope", () => {
    localStorage.setItem("runkit-panel-sessions-scope", "current");
    renderSidebar({ servers: [], currentServer: null });

    // Two "No servers" empty-states render: ServerPanel's tile grid and the
    // Sessions Pane's group list. The Sessions Pane variant has the centered
    // `py-4 text-center` classes; the ServerPanel variant uses `py-1`.
    const sessionsEmpty = screen.getAllByText("No servers").find(
      (el) => el.className.includes("py-4") && el.className.includes("text-center"),
    );
    expect(sessionsEmpty).toBeDefined();
  });
});

describe("Sidebar — selection pruning on ServerGroup unmount (260807-nf9f)", () => {
  // Regression guard for review cycle-1 must-fix 2: selection pruning is gated
  // on `rowsVersion`, which `registerGroupRows` bumps only when a SURVIVING
  // group's row-set signature changes. A whole ServerGroup leaving the tree
  // changed no surviving signature, so `rowsVersion` never bumped, the prune
  // effect never re-ran, and the departed group's keys stayed selected
  // (violating R4/A-004/A-022). The fix adds an `unregisterGroupRows` unmount
  // counterpart that drops the group's slice + signature and bumps.
  const ALPHA_SESSIONS: ProjectSession[] = [
    {
      name: "work",
      windows: [
        {
          index: 0,
          windowId: "@7",
          name: "feature",
          worktreePath: "~/code/alpha",
          activity: "idle",
          isActiveWindow: false,
          paneCommand: "zsh",
          activityTimestamp: Math.floor(Date.now() / 1000),
        },
      ],
    },
  ];

  const MULTI_SESSIONS = new Map<string, ProjectSession[]>([
    ["primary", PRIMARY_SESSIONS],
    ["alpha", ALPHA_SESSIONS],
    ["beta", []],
  ]);

  beforeEach(() => {
    useSelectionStore.setState({ selected: new Set(), anchor: null });
  });

  afterEach(() => {
    useSelectionStore.setState({ selected: new Set(), anchor: null });
  });

  it("prunes a departed group's keys when the sessions-scope narrows ALL→CURRENT", async () => {
    renderSidebar({ currentServer: "primary", sessionsByServer: MULTI_SESSIONS });

    // Open alpha's group so its window row paints (non-current groups start
    // collapsed), then Cmd-click that row into the selection.
    fireEvent.click(screen.getByRole("button", { name: /Expand alpha sessions/ }));
    const alphaRow = await screen.findByText("feature");
    fireEvent.click(alphaRow, { metaKey: true });

    expect([...useSelectionStore.getState().selected]).toEqual(["alpha:@7"]);

    // Narrow the scope: alpha's whole ServerGroup unmounts. No surviving group's
    // signature changes, so ONLY the unmount unregister can drive the prune.
    fireEvent.click(getScopeChip());
    expect(getServerGroupHeader("alpha")).not.toBeInTheDocument();

    await waitFor(() => {
      expect([...useSelectionStore.getState().selected]).toEqual([]);
    });
    expect(useSelectionStore.getState().anchor).toBeNull();
  });

  it("keeps a surviving group's keys selected across the same unmount", async () => {
    renderSidebar({ currentServer: "primary", sessionsByServer: MULTI_SESSIONS });

    // Select one row on alpha (departs) and one on primary (survives).
    fireEvent.click(screen.getByRole("button", { name: /Expand alpha sessions/ }));
    fireEvent.click(await screen.findByText("feature"), { metaKey: true });
    // Scope to the tree — the window name also appears outside it (board/pin
    // surfaces), so a bare getByText is ambiguous. The click seam is the row's
    // inner activation button, not the treeitem root.
    const primaryRow = document.querySelector<HTMLElement>(
      '[role="tree"] [data-row-key="primary:@0"] button',
    );
    expect(primaryRow).not.toBeNull();
    fireEvent.click(primaryRow!, { metaKey: true });
    expect([...useSelectionStore.getState().selected].sort()).toEqual([
      "alpha:@7",
      "primary:@0",
    ]);

    fireEvent.click(getScopeChip());

    // The prune is scoped to rows that actually left — it is not a blanket clear.
    await waitFor(() => {
      expect([...useSelectionStore.getState().selected]).toEqual(["primary:@0"]);
    });
  });

  it("drops the anchor with the departed group so a later shift-click cannot use it", async () => {
    renderSidebar({ currentServer: "primary", sessionsByServer: MULTI_SESSIONS });

    fireEvent.click(screen.getByRole("button", { name: /Expand alpha sessions/ }));
    fireEvent.click(await screen.findByText("feature"), { metaKey: true });
    // The Cmd-click parked the range anchor on the alpha row.
    expect(useSelectionStore.getState().anchor).toBe("alpha:@7");

    fireEvent.click(getScopeChip());

    // A stale anchor pointing at a vanished row would silently yield an empty
    // range on the next shift-click; the prune clears it alongside the key.
    await waitFor(() => {
      expect(useSelectionStore.getState().anchor).toBeNull();
    });
  });
});

describe("Sidebar — selection survives collapse/expand (260807-nf9f R4)", () => {
  // Regression guard for review cycle-2 must-fix: the prune derived liveness
  // from a DOM/visible-row walk, which equates "not rendered" with "gone".
  // Collapsing a session removed its window rows from the DOM and bumped the
  // visible-row signature, so the prune silently dropped those still-live
  // windows (and the anchor) from the selection — and `Select all merged`,
  // which deliberately selects windows inside COLLAPSED sessions, lost them on
  // the next unrelated signature change. Liveness now derives from the session
  // DATA (every window the SSE snapshot knows for the rendered groups), so only
  // a genuine departure prunes.
  const TWO_SESSION_SERVER: ProjectSession[] = [
    {
      name: "main",
      windows: [
        {
          index: 0,
          windowId: "@0",
          name: "shell",
          worktreePath: "~/code/run-kit",
          activity: "active",
          isActiveWindow: true,
          paneCommand: "zsh",
          activityTimestamp: Math.floor(Date.now() / 1000),
        },
      ],
    },
    {
      name: "side",
      windows: [
        {
          index: 0,
          windowId: "@5",
          name: "docs",
          worktreePath: "~/code/run-kit",
          activity: "idle",
          isActiveWindow: false,
          paneCommand: "zsh",
          activityTimestamp: Math.floor(Date.now() / 1000),
        },
      ],
    },
  ];

  const SESSIONS = new Map<string, ProjectSession[]>([["primary", TWO_SESSION_SERVER]]);

  function collapseChipFor(session: string): HTMLElement {
    return screen.getByRole("button", { name: new RegExp(`(Collapse|Expand) ${session}$`) });
  }

  function selectWindowRow(key: string) {
    const row = document.querySelector<HTMLElement>(`[role="tree"] [data-row-key="${key}"] button`);
    expect(row).not.toBeNull();
    fireEvent.click(row!, { metaKey: true });
  }

  beforeEach(() => {
    useSelectionStore.setState({ selected: new Set(), anchor: null });
  });

  afterEach(() => {
    useSelectionStore.setState({ selected: new Set(), anchor: null });
  });

  it("keeps the selection and anchor when the selected window's OWN session collapses", async () => {
    renderSidebar({ currentServer: "primary", sessionsByServer: SESSIONS });

    selectWindowRow("primary:@0");
    expect([...useSelectionStore.getState().selected]).toEqual(["primary:@0"]);
    expect(useSelectionStore.getState().anchor).toBe("primary:@0");

    // Fold the row out of view. The window is still very much alive in tmux.
    fireEvent.click(collapseChipFor("main"));
    await waitFor(() => {
      expect(document.querySelector('[role="tree"] [data-row-key="primary:@0"]')).toBeNull();
    });

    expect([...useSelectionStore.getState().selected]).toEqual(["primary:@0"]);
    expect(useSelectionStore.getState().anchor).toBe("primary:@0");

    // Re-expanding shows the row still selected.
    fireEvent.click(collapseChipFor("main"));
    await waitFor(() => {
      expect(
        document.querySelector('[role="tree"] [data-row-key="primary:@0"]'),
      ).not.toBeNull();
    });
    expect([...useSelectionStore.getState().selected]).toEqual(["primary:@0"]);
    expect(
      document
        .querySelector('[role="tree"] [data-row-key="primary:@0"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("keeps a key that sits INSIDE a collapsed session when an UNRELATED session collapses", async () => {
    // The `Select all merged` shape: the builder derives keys from session DATA,
    // so it legitimately selects windows inside collapsed sessions. Under
    // visibility-keyed liveness the very next unrelated signature change wiped
    // them, losing part of the selection before the user reached the palette.
    renderSidebar({ currentServer: "primary", sessionsByServer: SESSIONS });

    selectWindowRow("primary:@5");
    fireEvent.click(collapseChipFor("side")); // @5's own session folds away
    await waitFor(() => {
      expect(document.querySelector('[role="tree"] [data-row-key="primary:@5"]')).toBeNull();
    });

    // Now an UNRELATED session collapses — a signature change @5 had no part in.
    fireEvent.click(collapseChipFor("main"));
    await waitFor(() => {
      expect(document.querySelector('[role="tree"] [data-row-key="primary:@0"]')).toBeNull();
    });

    expect([...useSelectionStore.getState().selected]).toEqual(["primary:@5"]);
    expect(useSelectionStore.getState().anchor).toBe("primary:@5");
  });

  it("still prunes a window that genuinely leaves the SSE data", async () => {
    const { rerender } = renderSidebar({
      currentServer: "primary",
      sessionsByServer: SESSIONS,
    });

    selectWindowRow("primary:@0");
    selectWindowRow("primary:@5");
    expect([...useSelectionStore.getState().selected].sort()).toEqual([
      "primary:@0",
      "primary:@5",
    ]);

    // @5 is killed: it disappears from the snapshot entirely (not merely folded).
    const killed = new Map<string, ProjectSession[]>([
      ["primary", [TWO_SESSION_SERVER[0], { name: "side", windows: [] }]],
    ]);
    rerenderSidebar(rerender, { currentServer: "primary", sessionsByServer: killed });

    await waitFor(() => {
      expect([...useSelectionStore.getState().selected]).toEqual(["primary:@0"]);
    });
    // The anchor sat on the killed row — a stale anchor would silently yield an
    // empty range on the next shift-click, so it is dropped with the key.
    expect(useSelectionStore.getState().anchor).toBeNull();
  });
});

describe("Sidebar — per-server group toggle under StrictMode (mss7)", () => {
  // Regression guard for mss7: clicking Expand on a non-current server's group
  // did nothing because `toggleServerSection` performed a `localStorage.setItem`
  // INSIDE the `setServerSectionsOpen` updater. React 19 StrictMode (active in
  // the real app via main.tsx, and in e2e) double-invokes state updaters; the
  // second pass observed the first pass's localStorage write and inverted the
  // computed `next`, so a single click was a net no-op and the group never
  // opened. This test renders under <StrictMode> — the exact condition the
  // existing coupling tests omit — and would fail against the pre-fix impure
  // updater. The fix moves the side-effects out of the updater (pure commit).
  it("opens a collapsed non-current group on first click and collapses it on the second", () => {
    // Server Pane key unset → defaults collapsed → all groups render, and
    // non-current groups (alpha) start collapsed (aria-expanded="false").
    renderSidebar({ currentServer: "primary", strict: true });

    const alphaToggle = screen.getByRole("button", { name: /Expand alpha sessions/ });
    expect(alphaToggle).toHaveAttribute("aria-expanded", "false");

    // First click: the group must open (the no-op bug manifested here).
    fireEvent.click(alphaToggle);
    expect(
      screen.getByRole("button", { name: /Collapse alpha sessions/ }),
    ).toHaveAttribute("aria-expanded", "true");
    // Side-effect ran exactly once and agrees with the rendered state.
    expect(localStorage.getItem("runkit-panel-sessions-alpha")).toBe("true");

    // Second click: the group must collapse again (full toggle cycle).
    fireEvent.click(screen.getByRole("button", { name: /Collapse alpha sessions/ }));
    expect(
      screen.getByRole("button", { name: /Expand alpha sessions/ }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(localStorage.getItem("runkit-panel-sessions-alpha")).toBe("false");
  });
});

describe("Sidebar — per-session collapse persistence (kddk)", () => {
  // Per-session collapse used to be plain React state, so every refresh reset
  // every session to expanded. It now rides one localStorage key holding a JSON
  // map of collapsed EXCEPTIONS — expanded sessions carry no entry, so the
  // default (expanded) still applies to sessions the user never collapsed.

  /** The chevron on the SESSION row (`Collapse main` / `Expand main`) — the
   *  `$` anchor keeps it distinct from the server group header's
   *  `Collapse primary sessions`. */
  function collapseChipFor(session: string): HTMLElement {
    return screen.getByRole("button", { name: new RegExp(`(Collapse|Expand) ${session}$`) });
  }

  function storedMap(): unknown {
    const raw = localStorage.getItem(SESSION_COLLAPSED_STORAGE_KEY);
    return raw === null ? null : JSON.parse(raw);
  }

  function windowRow(key: string): Element | null {
    return document.querySelector(`[role="tree"] [data-row-key="${key}"]`);
  }

  it("persists a collapse and restores it on a remount (refresh)", () => {
    renderSidebar({ currentServer: "primary" });
    expect(collapseChipFor("main")).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(collapseChipFor("main"));

    expect(collapseChipFor("main")).toHaveAttribute("aria-expanded", "false");
    expect(windowRow("primary:@0")).toBeNull();
    expect(storedMap()).toEqual({ "primary:main": true });

    // Remount with the same storage — the refresh the feature exists for.
    cleanup();
    renderSidebar({ currentServer: "primary" });

    expect(collapseChipFor("main")).toHaveAttribute("aria-expanded", "false");
    expect(windowRow("primary:@0")).toBeNull();
  });

  it("removes the entry when the session is expanded again (exceptions-only)", () => {
    localStorage.setItem(
      SESSION_COLLAPSED_STORAGE_KEY,
      JSON.stringify({ "primary:main": true }),
    );
    renderSidebar({ currentServer: "primary" });
    expect(collapseChipFor("main")).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(collapseChipFor("main"));

    expect(collapseChipFor("main")).toHaveAttribute("aria-expanded", "true");
    expect(windowRow("primary:@0")).not.toBeNull();
    // Not `{"primary:main": false}` — and an emptied map drops the key outright.
    expect(localStorage.getItem(SESSION_COLLAPSED_STORAGE_KEY)).toBeNull();
  });

  it("leaves unrelated entries alone, including sessions not currently rendered", () => {
    // Stale entries for killed/other-server sessions are deliberately not pruned
    // (the client cannot enumerate sessions on non-attached servers).
    localStorage.setItem(
      SESSION_COLLAPSED_STORAGE_KEY,
      JSON.stringify({ "other:archived": true }),
    );
    renderSidebar({ currentServer: "primary" });

    fireEvent.click(collapseChipFor("main"));

    expect(storedMap()).toEqual({ "other:archived": true, "primary:main": true });
  });

  it("renders every session expanded when the stored value is malformed JSON", () => {
    localStorage.setItem(SESSION_COLLAPSED_STORAGE_KEY, "{not json");

    expect(() => renderSidebar({ currentServer: "primary" })).not.toThrow();

    expect(collapseChipFor("main")).toHaveAttribute("aria-expanded", "true");
    expect(windowRow("primary:@0")).not.toBeNull();
  });

  it("ignores a non-object root and non-`true` entry values", () => {
    localStorage.setItem(
      SESSION_COLLAPSED_STORAGE_KEY,
      JSON.stringify(["primary:main"]),
    );
    renderSidebar({ currentServer: "primary" });
    expect(collapseChipFor("main")).toHaveAttribute("aria-expanded", "true");

    cleanup();
    // A truthy-but-not-`true` value must not resurrect as an exception.
    localStorage.setItem(
      SESSION_COLLAPSED_STORAGE_KEY,
      JSON.stringify({ "primary:main": "yes" }),
    );
    renderSidebar({ currentServer: "primary" });
    expect(collapseChipFor("main")).toHaveAttribute("aria-expanded", "true");
  });

  it("renders a session with no stored entry expanded (default preserved)", () => {
    localStorage.setItem(
      SESSION_COLLAPSED_STORAGE_KEY,
      JSON.stringify({ "primary:other": true }),
    );
    renderSidebar({ currentServer: "primary" });

    expect(collapseChipFor("main")).toHaveAttribute("aria-expanded", "true");
    expect(windowRow("primary:@0")).not.toBeNull();
  });

  it("toggles exactly once per click under StrictMode", () => {
    // The mss7 failure mode, one level down: a localStorage write INSIDE the
    // state updater runs twice under React 19 StrictMode and the second pass
    // observes the first pass's write, making a single click a net no-op.
    renderSidebar({ currentServer: "primary", strict: true });

    fireEvent.click(collapseChipFor("main"));
    expect(collapseChipFor("main")).toHaveAttribute("aria-expanded", "false");
    expect(storedMap()).toEqual({ "primary:main": true });

    fireEvent.click(collapseChipFor("main"));
    expect(collapseChipFor("main")).toHaveAttribute("aria-expanded", "true");
    expect(localStorage.getItem(SESSION_COLLAPSED_STORAGE_KEY)).toBeNull();
  });

  it("renders and toggles when localStorage throws (privacy mode)", () => {
    // Scoped to this key so the throw exercises the collapse seam only — the
    // rest of the tree's preferences keep their real storage.
    const realGet = Storage.prototype.getItem;
    const realSet = Storage.prototype.setItem;
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(function (this: Storage, key: string) {
        if (key === SESSION_COLLAPSED_STORAGE_KEY) throw new Error("access denied");
        return realGet.call(this, key);
      });
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (key === SESSION_COLLAPSED_STORAGE_KEY) throw new Error("access denied");
        realSet.call(this, key, value);
      });

    try {
      expect(() => renderSidebar({ currentServer: "primary" })).not.toThrow();
      expect(collapseChipFor("main")).toHaveAttribute("aria-expanded", "true");

      // The toggle still works in-session; only the persistence is lost.
      expect(() => fireEvent.click(collapseChipFor("main"))).not.toThrow();
      expect(collapseChipFor("main")).toHaveAttribute("aria-expanded", "false");
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});

describe("Sidebar — mobile drawer current-row focus bonus (R9 / T007)", () => {
  // The global matchMedia stub (top of file) reports non-mobile, so the bonus
  // effect never runs in the other suites. Here we force mobile + an open
  // drawer and drive the deferred (requestAnimationFrame) focus synchronously
  // to prove the scoped selector focuses the selected WINDOW row — and, by the
  // selector's construction, would NOT match the active BoardsSection row
  // (which carries aria-current="page" but has no [data-window-id] ancestor).

  function makeMatchMedia(mobile: boolean) {
    return vi.fn().mockImplementation((query: string) => ({
      // ThemeProvider always needs prefers-color-scheme; in mobile mode the
      // width/coarse queries also match so useIsMobile() reports mobile.
      matches:
        query.includes("prefers-color-scheme: dark") ||
        (mobile && (query.includes("max-width") || query.includes("pointer: coarse"))),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
    }));
  }

  function stubMobileMatchMedia() {
    vi.stubGlobal("matchMedia", makeMatchMedia(true));
  }

  // Restore the file-default non-mobile matchMedia stub so this block's mobile
  // override never leaks into a later-running test (the file's shared afterEach
  // does not unstub globals).
  afterEach(() => {
    vi.stubGlobal("matchMedia", makeMatchMedia(false));
  });

  it("scroll+focuses the [aria-current=\"page\"] window row when the drawer is open on mobile", () => {
    stubMobileMatchMedia();
    // ChromeProvider seeds sidebarOpen from this key — open the drawer.
    localStorage.setItem("runkit-sidebar-open", "true");
    // Run the deferred focus synchronously instead of waiting a real frame.
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      });

    try {
      // currentWindowId "@0" → that window row's button gets aria-current="page".
      renderSidebar({ currentServer: "primary" });

      const row = document.querySelector<HTMLElement>(
        '[data-window-id] [aria-current="page"]',
      );
      expect(row).not.toBeNull();
      // The match is the row button, nested under a [data-window-id] wrapper —
      // i.e. a window row, not the BoardsSection active row (which has no such
      // ancestor and is therefore excluded by the scoped selector).
      expect(row!.closest("[data-window-id]")).not.toBeNull();
      // The bonus moved focus to the selected window row.
      expect(document.activeElement).toBe(row);
      expect(rafSpy).toHaveBeenCalled();
    } finally {
      rafSpy.mockRestore();
    }
  });
});

describe("Sidebar — tree ARIA + roving keyboard navigation (wt1v)", () => {
  // A single server with one session "main" carrying two windows, plus a second
  // session "other" with one window — enough to exercise cross-session traversal,
  // expand/collapse, and end-of-list stops.
  const KB_SESSIONS: ProjectSession[] = [
    {
      name: "main",
      windows: [
        { index: 0, windowId: "@0", name: "edit", worktreePath: "~/a", activity: "idle", isActiveWindow: false, activityTimestamp: 0 },
        { index: 1, windowId: "@1", name: "test", worktreePath: "~/a", activity: "idle", isActiveWindow: false, activityTimestamp: 0 },
      ],
    },
    {
      name: "other",
      windows: [
        { index: 0, windowId: "@2", name: "run", worktreePath: "~/b", activity: "idle", isActiveWindow: false, activityTimestamp: 0 },
      ],
    },
  ];

  const onSelectWindow = vi.fn();

  // Build the provider tree for a given sessions snapshot so a test can
  // `rerender` with a CHANGED sessions Map (simulating a passive SSE tick).
  function treeUI(sessions: ProjectSession[]) {
    const servers = [{ name: "primary", sessionCount: 2 }];
    const sessionsByServer = new Map([["primary", sessions]]);
    return (
      <ThemeProvider>
        <InstanceAccentValueProvider value={NULL_ACCENT}>
        <InstanceNameValueProvider value={NULL_NAME}>
        <ToastProvider>
          <OptimisticProvider>
            <StandaloneSessionContextProvider
              value={{
                sessionsByServer,
                sessionOrderByServer: new Map([["primary", []]]),
                isConnectedByServer: new Map([["primary", true]]),
                metricsByServer: new Map(),
                currentServer: "primary",
                servers,
                refreshServers: vi.fn(),
              }}
            >
              <MetricsProvider value={null}>
                <HostMetricsProvider value={null}>
                  <FocusedPaneProvider>
                    <ChromeProvider>
                      <SettingsDialogProvider>
                      <Sidebar
                        currentServer="primary"
                        currentSession="main"
                        currentWindowId={null}
                        isConnected={false}
                        onSelectWindow={onSelectWindow}
                        onCreateWindow={vi.fn()}
                        onCreateSession={vi.fn()}
                        onCreateServer={vi.fn()}
                        onKillServer={vi.fn()}
                      />
                      </SettingsDialogProvider>
                    </ChromeProvider>
                  </FocusedPaneProvider>
                </HostMetricsProvider>
              </MetricsProvider>
            </StandaloneSessionContextProvider>
          </OptimisticProvider>
        </ToastProvider>
        </InstanceNameValueProvider>
        </InstanceAccentValueProvider>
      </ThemeProvider>
    );
  }

  function renderTree() {
    return render(treeUI(KB_SESSIONS));
  }

  function tree(): HTMLElement {
    return screen.getByRole("tree");
  }

  function visibleRows(): HTMLElement[] {
    return Array.from(tree().querySelectorAll<HTMLElement>('[role="treeitem"]'));
  }

  function rowKey(el: HTMLElement): string | null {
    // Mirrors production rowKeyOf: the globally-unique roving handle is
    // `data-row-key` (window rows, `${server}:${windowId}`) or `data-session-row`
    // (session rows, `${server}:${name}`) — NOT the bare `data-window-id`.
    return el.getAttribute("data-row-key") ?? el.getAttribute("data-session-row");
  }

  function rovingKeyNow(): string | null {
    const tabbable = visibleRows().find((r) => r.getAttribute("tabindex") === "0");
    return tabbable ? rowKey(tabbable) : null;
  }

  beforeEach(() => {
    localStorage.clear();
    onSelectWindow.mockClear();
    useWindowStore.setState({ entries: new Map(), ghosts: [] });
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    useWindowStore.setState({ entries: new Map(), ghosts: [] });
  });

  it("renders a role=tree inside the Sessions nav landmark", () => {
    renderTree();
    const nav = screen.getByRole("navigation", { name: "Sessions" });
    const treeEl = within(nav).getByRole("tree");
    expect(treeEl).toBeInTheDocument();
    expect(treeEl).toHaveAttribute("aria-label", "Session tree");
  });

  it("marks each per-server section wrapper role=presentation with no aria-labelledby", () => {
    renderTree();
    // Presentational wrappers keep the tree semantically transparent: a
    // <section> with an accessible name would map to a `region` landmark —
    // an invalid interposed node between the tree and its treeitems. The
    // aria-labelledby removal is spec-required (WAI-ARIA presentational
    // conflict resolution: a global ARIA property voids the presentation role).
    const wrappers = Array.from(
      tree().querySelectorAll<HTMLElement>(":scope > section"),
    );
    expect(wrappers.length).toBeGreaterThan(0);
    for (const w of wrappers) {
      expect(w).toHaveAttribute("role", "presentation");
      expect(w).not.toHaveAttribute("aria-labelledby");
    }
  });

  it("wires each session row's aria-controls to a role=group window list with the matching id", () => {
    renderTree();
    const sessionRows = visibleRows().filter((r) => r.getAttribute("aria-level") === "1");
    expect(sessionRows.length).toBe(2);
    for (const sr of sessionRows) {
      const controls = sr.getAttribute("aria-controls");
      expect(controls).toBeTruthy();
      const group = document.getElementById(controls!);
      expect(group).not.toBeNull();
      expect(group).toHaveAttribute("role", "group");
    }
  });

  it("establishes exactly one tab stop (tabIndex=0) — the first visible row", () => {
    renderTree();
    const tabbable = visibleRows().filter((r) => r.getAttribute("tabindex") === "0");
    expect(tabbable.length).toBe(1);
    // First visible row is the "main" session header.
    expect(rowKey(tabbable[0])).toBe("primary:main");
  });

  it("ArrowDown/ArrowUp move the roving tab stop and stop at the ends (no wrap)", () => {
    renderTree();
    const t = tree();
    // Order: main (session) → @0 → @1 → other (session) → @2
    expect(rovingKeyNow()).toBe("primary:main");

    act(() => { fireEvent.keyDown(t, { key: "ArrowDown" }); });
    expect(rovingKeyNow()).toBe("primary:@0");
    act(() => { fireEvent.keyDown(t, { key: "ArrowDown" }); });
    expect(rovingKeyNow()).toBe("primary:@1");

    // ArrowUp moves back.
    act(() => { fireEvent.keyDown(t, { key: "ArrowUp" }); });
    expect(rovingKeyNow()).toBe("primary:@0");

    // Up at... walk to the very top and assert it stops (no wrap to the bottom).
    act(() => { fireEvent.keyDown(t, { key: "ArrowUp" }); }); // → main
    expect(rovingKeyNow()).toBe("primary:main");
    act(() => { fireEvent.keyDown(t, { key: "ArrowUp" }); }); // stop
    expect(rovingKeyNow()).toBe("primary:main");
  });

  it("Home/End jump to the first/last visible row", () => {
    renderTree();
    const t = tree();
    act(() => { fireEvent.keyDown(t, { key: "End" }); });
    expect(rovingKeyNow()).toBe("primary:@2"); // last visible row (other's only window)
    act(() => { fireEvent.keyDown(t, { key: "Home" }); });
    expect(rovingKeyNow()).toBe("primary:main");
  });

  it("ArrowRight expands a collapsed session, then descends to its first window", () => {
    renderTree();
    const t = tree();
    // Collapse "main" first via its chevron so we can re-expand by keyboard.
    const mainChevron = screen.getByRole("button", { name: /Collapse main/ });
    act(() => { fireEvent.click(mainChevron); });
    // "main" is collapsed → its windows are gone; roving stays on "main".
    expect(rovingKeyNow()).toBe("primary:main");
    let mainRow = visibleRows().find((r) => rowKey(r) === "primary:main")!;
    expect(mainRow).toHaveAttribute("aria-expanded", "false");

    // ArrowRight expands it (focus stays on the session row).
    act(() => { fireEvent.keyDown(t, { key: "ArrowRight" }); });
    mainRow = visibleRows().find((r) => rowKey(r) === "primary:main")!;
    expect(mainRow).toHaveAttribute("aria-expanded", "true");
    expect(rovingKeyNow()).toBe("primary:main");

    // ArrowRight again descends to the first window child.
    act(() => { fireEvent.keyDown(t, { key: "ArrowRight" }); });
    expect(rovingKeyNow()).toBe("primary:@0");
  });

  it("ArrowLeft collapses an expanded session and moves a window to its parent", () => {
    renderTree();
    const t = tree();
    // Move roving to @0 then ArrowLeft → parent session "main".
    act(() => { fireEvent.keyDown(t, { key: "ArrowDown" }); }); // @0
    expect(rovingKeyNow()).toBe("primary:@0");
    act(() => { fireEvent.keyDown(t, { key: "ArrowLeft" }); }); // → parent main
    expect(rovingKeyNow()).toBe("primary:main");

    // ArrowLeft on the expanded session collapses it.
    act(() => { fireEvent.keyDown(t, { key: "ArrowLeft" }); });
    const mainRow = visibleRows().find((r) => rowKey(r) === "primary:main")!;
    expect(mainRow).toHaveAttribute("aria-expanded", "false");
  });

  it("Enter on a window row activates onSelectWindow with (server, session, windowId)", () => {
    renderTree();
    const t = tree();
    act(() => { fireEvent.keyDown(t, { key: "ArrowDown" }); }); // → @0
    act(() => { fireEvent.keyDown(t, { key: "Enter" }); });
    expect(onSelectWindow).toHaveBeenCalledWith("primary", "main", "@0");
  });

  it("Space on a window row also activates it", () => {
    renderTree();
    const t = tree();
    act(() => { fireEvent.keyDown(t, { key: "ArrowDown" }); }); // → @0
    act(() => { fireEvent.keyDown(t, { key: " " }); });
    expect(onSelectWindow).toHaveBeenCalledWith("primary", "main", "@0");
  });

  it("does not hijack arrows originating from a rename input", () => {
    renderTree();
    const t = tree();
    const before = rovingKeyNow();
    // Enter rename mode on the "main" session via double-click on its name.
    const nameBtn = screen.getByRole("button", { name: "Navigate to main" });
    act(() => { fireEvent.doubleClick(nameBtn); });
    const input = screen.getByLabelText("Rename session") as HTMLInputElement;
    // An ArrowDown whose target is the input must NOT move the roving cursor.
    act(() => { fireEvent.keyDown(input, { key: "ArrowDown" }); });
    expect(rovingKeyNow()).toBe(before);
  });

  // T014(b): the focus-movement half of R6 — an arrow keypress must move
  // document.activeElement onto the new roving row's DOM node.
  it("moves document.activeElement onto the roving row after an arrow keypress", () => {
    renderTree();
    const t = tree();
    act(() => { fireEvent.keyDown(t, { key: "ArrowDown" }); }); // → @0
    expect(rovingKeyNow()).toBe("primary:@0");
    const focused = document.activeElement as HTMLElement | null;
    expect(focused).not.toBeNull();
    // The focused element is the @0 window-row treeitem. (data-window-id stays
    // the bare tmux id; the globally-unique roving handle is data-row-key.)
    expect(focused!.getAttribute("data-window-id")).toBe("@0");
    expect(focused!.getAttribute("data-row-key")).toBe("primary:@0");
  });

  // T014(a): the SSE-tick invariant (would have caught MF-1). A passive SSE tick
  // re-renders the tree with a CHANGED sessions Map but the SAME visible-row SET.
  // It must NOT change the roving row and must NOT pull focus into the tree.
  it("a passive SSE tick (changed sessions Map, no keypress) does not change roving or steal focus", () => {
    const { rerender } = renderTree();
    // Initial roving row is the first visible row ("main"); no keypress yet, so
    // focus is NOT in the tree.
    expect(rovingKeyNow()).toBe("primary:main");
    expect(tree().contains(document.activeElement)).toBe(false);

    // Simulate a passive SSE tick: a NEW sessions Map + new window objects (the
    // SSE snapshot is always fresh refs) with the SAME windowId set — only an
    // activity field churns, the visible-row SET is unchanged.
    const ticked: ProjectSession[] = KB_SESSIONS.map((s) => ({
      ...s,
      windows: s.windows.map((w) => ({ ...w, activityTimestamp: w.activityTimestamp + 1 })),
    }));
    act(() => { rerender(treeUI(ticked)); });

    // Roving row + the single tabIndex=0 row are unchanged.
    expect(rovingKeyNow()).toBe("primary:main");
    expect(visibleRows().filter((r) => r.getAttribute("tabindex") === "0").length).toBe(1);
    // Focus was NOT pulled into the tree by the passive tick.
    expect(tree().contains(document.activeElement)).toBe(false);
  });

  // T015 (SF-2): Enter on a REAL window row calls onSelectWindow with the
  // (server, session, windowId) derived from the roving identity — a direct
  // handler call, not a synthesized DOM click.
  it("Enter on a real window row calls onSelectWindow with the roving identity", () => {
    renderTree();
    const t = tree();
    act(() => { fireEvent.keyDown(t, { key: "End" }); }); // → @2 (other's window)
    expect(rovingKeyNow()).toBe("primary:@2");
    act(() => { fireEvent.keyDown(t, { key: "Enter" }); });
    expect(onSelectWindow).toHaveBeenCalledWith("primary", "other", "@2");
  });

  // T015 (SF-3): Enter/Space on a ghost/optimistic window row (key `ghost-…`,
  // empty windowId) is a no-op — no onSelectWindow call.
  it("Enter/Space on a ghost window row does not call onSelectWindow", () => {
    // Seed the window store's real "main" windows FIRST, then add the ghost.
    // The ghost captures @0/@1 in its snapshot, so the mount-time
    // setWindowsForSession sees NO new windowIds and preserves the ghost
    // (ghosts are otherwise consumed when an unknown real window arrives).
    const store = useWindowStore.getState();
    store.setWindowsForSession("primary", "main", KB_SESSIONS[0].windows);
    const ghostId = store.addGhostWindow("primary", "main", "deploying");
    // Roving key is the globally-unique handle: `${server}:ghost-${optimisticId}`.
    const ghostKey = `primary:ghost-${ghostId}`;

    renderTree();
    const t = tree();
    // The ghost row is the last child of "main"'s window group (after @0, @1).
    const ghostRow = visibleRows().find((r) => rowKey(r) === ghostKey);
    expect(ghostRow, "ghost window row should be rendered").toBeTruthy();

    // Walk roving onto the ghost row: main → @0 → @1 → ghost.
    act(() => { fireEvent.keyDown(t, { key: "ArrowDown" }); }); // @0
    act(() => { fireEvent.keyDown(t, { key: "ArrowDown" }); }); // @1
    act(() => { fireEvent.keyDown(t, { key: "ArrowDown" }); }); // ghost
    expect(rovingKeyNow()).toBe(ghostKey);

    act(() => { fireEvent.keyDown(t, { key: "Enter" }); });
    act(() => { fireEvent.keyDown(t, { key: " " }); });
    expect(onSelectWindow).not.toHaveBeenCalled();
  });
});

describe("Sidebar — session-reorder self-target drop acceptance (i41e snap-back fix)", () => {
  // Mirror of use-server-reorder.test.ts's self-target case for the sidebar
  // session-reorder handler (`handleSessionReorderOver`). The bug: a dragover on
  // the dragged row itself bailed BEFORE preventDefault, so HTML5 DnD played the
  // native cancelled-drag snap-back. The fix hoists preventDefault/dropEffect
  // above the self-name check. fireEvent.dragOver returns `false` when the
  // handler called preventDefault() (the event was cancelled), so drop
  // acceptance is observable without stubbing the native method.

  /** A minimal mutable dataTransfer bag, mirroring the hook test's makeDragEvent. */
  function makeDataTransfer(types: string[] = []) {
    const store = new Map<string, string>();
    const t = [...types];
    return {
      setData: (type: string, data: string) => {
        store.set(type, data);
        if (!t.includes(type)) t.push(type);
      },
      getData: (type: string) => store.get(type) ?? "",
      get types() {
        return t;
      },
      dropEffect: "none",
      effectAllowed: "none",
    };
  }

  it("accepts a session-reorder dragover on the dragged row itself (preventDefault called, dropEffect move)", () => {
    // PRIMARY_SESSIONS has one session "main" in the (force-open current)
    // "primary" group, rendered as a draggable row with data-session-row.
    renderSidebar({ currentServer: "primary" });

    const row = document.querySelector('[data-session-row="primary:main"]');
    expect(row).toBeTruthy();

    // dragStart seeds sessionDragSource = { server: "primary", name: "main" }.
    // Shared dataTransfer bag so the dragover sees the session-reorder MIME the
    // start handler wrote.
    const dataTransfer = makeDataTransfer();
    act(() => {
      fireEvent.dragStart(row!, { dataTransfer });
    });
    expect(dataTransfer.types).toContain("application/x-session-reorder");

    // dragover on the SAME row (self-target). The handler must still accept the
    // drop: fireEvent returns false when preventDefault() was called.
    let notPrevented: boolean;
    act(() => {
      notPrevented = fireEvent.dragOver(row!, { dataTransfer });
    });
    expect(notPrevented!).toBe(false); // preventDefault() was called → drop accepted
    expect(dataTransfer.dropEffect).toBe("move");
  });

  it("does not accept a session-reorder dragover before any drag started (source guard)", () => {
    renderSidebar({ currentServer: "primary" });
    const row = document.querySelector('[data-session-row="primary:main"]');
    expect(row).toBeTruthy();

    // No dragStart → sessionDragSource is null → the source guard rejects before
    // acceptance (no preventDefault).
    const dataTransfer = makeDataTransfer(["application/x-session-reorder"]);
    let notPrevented: boolean;
    act(() => {
      notPrevented = fireEvent.dragOver(row!, { dataTransfer });
    });
    expect(notPrevented!).toBe(true); // default NOT prevented → not accepted
  });
});

describe("Sidebar — window drag-to-pin marker MIME (g0t1)", () => {
  /** A minimal mutable dataTransfer bag, mirroring the session-reorder block. */
  function makeDataTransfer(types: string[] = []) {
    const store = new Map<string, string>();
    const t = [...types];
    return {
      setData: (type: string, data: string) => {
        store.set(type, data);
        if (!t.includes(type)) t.push(type);
      },
      getData: (type: string) => store.get(type) ?? "",
      get types() {
        return t;
      },
      dropEffect: "none",
      effectAllowed: "none",
    };
  }

  function windowRow(): HTMLElement {
    const row = document.querySelector('[data-window-id="@0"]');
    expect(row).toBeTruthy();
    return row as HTMLElement;
  }

  it("window drag start sets the x-window-drag marker MIME and widens effectAllowed to copyMove", () => {
    renderSidebar({ currentServer: "primary" });

    const dataTransfer = makeDataTransfer();
    act(() => {
      fireEvent.dragStart(windowRow(), { dataTransfer });
    });

    // Marker for foreign drop targets (board rows) rides alongside the existing
    // JSON payload, which keeps its {server, session, index, windowId, name}
    // shape so the reorder/move handlers stay untouched.
    expect(dataTransfer.types).toContain("application/x-window-drag");
    expect(dataTransfer.types).toContain("application/json");
    expect(dataTransfer.getData("application/x-window-drag")).toBe("@0");
    expect(JSON.parse(dataTransfer.getData("application/json"))).toEqual({
      server: "primary",
      session: "main",
      index: 0,
      windowId: "@0",
      name: "shell",
    });
    // Widened from "move" so board rows can offer the copy (link) cursor.
    expect(dataTransfer.effectAllowed).toBe("copyMove");
  });

  it("within-session reorder dragover still accepts with dropEffect move", () => {
    renderSidebar({ currentServer: "primary" });
    const row = windowRow();

    const dataTransfer = makeDataTransfer();
    act(() => {
      fireEvent.dragStart(row, { dataTransfer });
    });

    // Self-target dragover (single-window session): the reorder handler accepts
    // with a move cursor — unchanged under the widened "copyMove" allowance.
    let notPrevented: boolean;
    act(() => {
      notPrevented = fireEvent.dragOver(row, { dataTransfer });
    });
    expect(notPrevented!).toBe(false); // preventDefault() was called → accepted
    expect(dataTransfer.dropEffect).toBe("move");
  });
});

describe("BottomPanels — board-route focused-pane fallback + HOST dot (zx4i)", () => {
  // Sessions live on server "boardsrv" (NOT the current server — the board
  // route has currentServer=null). The enriched window @9 carries fab data the
  // thin fallback could never synthesize, so its presence proves the lookup hit.
  const BOARD_SESSIONS: ProjectSession[] = [
    {
      name: "home",
      windows: [
        {
          index: 0,
          windowId: "@9",
          name: "pinned-live",
          worktreePath: "/home/u/code/live",
          activity: "idle",
          isActiveWindow: false,
          activityTimestamp: 0,
          fabChange: "260720-zx4i-board-route-pane-host-panels",
          fabStage: "apply",
          panes: [
            {
              paneId: "%77",
              paneIndex: 0,
              cwd: "/home/u/code/live",
              command: "zsh",
              isActive: true,
              gitBranch: "zx4i-branch",
            },
          ],
        },
      ],
    },
  ];

  const boardServers = [{ name: "boardsrv", sessionCount: 1 }];
  const boardSessionsMap = new Map([["boardsrv", BOARD_SESSIONS]]);

  function paneHeader(): HTMLElement {
    return screen.getByRole("button", { name: /^Pane/ });
  }

  it("renders the ENRICHED home-session copy when the focused pane resolves by windowId", () => {
    renderSidebar({
      currentServer: null,
      servers: boardServers,
      sessionsByServer: boardSessionsMap,
      focusedPane: {
        server: "boardsrv",
        windowId: "@9",
        windowName: "pinned-live",
        panes: [
          { paneId: "%77", paneIndex: 0, cwd: "/tmp/thin", command: "zsh", isActive: true },
        ],
      },
    });
    expect(screen.queryByText("No window selected")).not.toBeInTheDocument();
    // The fab register renders — only the enriched SSE copy carries fabChange,
    // so this proves the windowId lookup (not the thin fallback) supplied it.
    expect(screen.getByText(/zx4i board-route-pane-host-panels · apply/)).toBeInTheDocument();
    // Identity from the enriched copy, not the thin panes (cwd differs:
    // /home/u/code/live shortens to ~/code/live; the thin pane cwd is /tmp/thin).
    expect(screen.getByText("~/code/live")).toBeInTheDocument();
    expect(screen.queryByText("/tmp/thin")).not.toBeInTheDocument();
  });

  it("thin-renders from the board entry's panes when the lookup misses (pin-only window)", () => {
    renderSidebar({
      currentServer: null,
      servers: boardServers,
      sessionsByServer: boardSessionsMap,
      focusedPane: {
        server: "boardsrv",
        windowId: "@404", // absent from BOARD_SESSIONS
        windowName: "pin-only",
        panes: [
          {
            paneId: "%88",
            paneIndex: 0,
            cwd: "/srv/pin-only",
            command: "vim",
            isActive: true,
            gitBranch: "orphan-branch",
          },
        ],
      },
    });
    expect(screen.queryByText("No window selected")).not.toBeInTheDocument();
    // Identity rows from the entry's own pane data.
    expect(paneHeader().textContent).toContain("pin-only");
    expect(screen.getByText(/%88/)).toBeInTheDocument();
    expect(screen.getByText("orphan-branch")).toBeInTheDocument();
    // Enrichment-only registers honestly absent.
    expect(screen.queryByTestId("register-agent")).not.toBeInTheDocument();
    expect(screen.queryByText(/· apply/)).not.toBeInTheDocument();
  });

  it("never falls back to the focused pane on a server route (unresolved route window)", () => {
    // Server route (currentServer set) whose route window can't resolve yet —
    // the sessions snapshot hasn't arrived (empty list). A stale focused pane
    // is still published (clear-on-unmount lands a commit later). The PANE
    // panel must show the empty state, NOT the board-focused window: the
    // fallback is gated on the board route itself, not on `!routeWindow`.
    renderSidebar({
      currentServer: "primary",
      servers: [{ name: "primary", sessionCount: 0 }, ...boardServers],
      sessionsByServer: new Map([["primary", []], ["boardsrv", BOARD_SESSIONS]]),
      focusedPane: {
        server: "boardsrv",
        windowId: "@9",
        windowName: "pinned-live",
        panes: [
          { paneId: "%77", paneIndex: 0, cwd: "/tmp/thin", command: "zsh", isActive: true },
        ],
      },
    });
    expect(screen.getByText("No window selected")).toBeInTheDocument();
    expect(paneHeader().textContent).not.toContain("pinned-live");
  });

  it("keeps 'No window selected' when no focused pane is published (empty board)", () => {
    renderSidebar({
      currentServer: null,
      servers: boardServers,
      sessionsByServer: boardSessionsMap,
      focusedPane: null,
    });
    expect(screen.getByText("No window selected")).toBeInTheDocument();
  });

  const HOST_METRICS: MetricsSnapshot = {
    hostname: "board-host",
    cpu: { samples: [10], current: 10, cores: 4 },
    memory: { used: 1024 ** 3, total: 8 * 1024 ** 3 },
    load: { avg1: 0.1, avg5: 0.1, avg15: 0.1, cpus: 4 },
    disk: { used: 10 * 1024 ** 3, total: 100 * 1024 ** 3 },
    uptime: 60,
  };

  it("HOST panel fills from the host-global broadcast on the board route, with no connection dot", () => {
    renderSidebar({
      currentServer: null,
      servers: boardServers,
      sessionsByServer: boardSessionsMap,
      focusedPane: null,
      hostMetrics: HOST_METRICS,
    });
    // The host-global fallback fills the panel (no server-scoped metrics on a
    // board route). The HOST header carries no connection dot — the sidebar
    // FOOTER dot owns the per-page signal (260724-6j1v).
    expect(screen.getByText("board-host")).toBeInTheDocument();
    expect(screen.queryByText("No metrics")).not.toBeInTheDocument();
    expect(screen.queryByTitle(/SSE (dis)?connected/)).not.toBeInTheDocument();
  });
});

describe("Sidebar — tinted server-group header fill (t1ca)", () => {
  // Variant D: each SESSIONS-pane server-group header is a filled bar carrying
  // the server's color, resolved through the SAME precomputed maps the SERVER
  // panel tiles use (computeRowTints/computeRowBorders — dual-keyed under
  // family names and legacy descriptors). Expected values are computed from
  // the default dark theme (the theme the jsdom matchMedia stub resolves), so
  // no hex is hardcoded here either.
  const palette = DEFAULT_DARK_THEME.palette;
  const tints = computeRowTints(palette);
  const borders = computeRowBorders(palette, DEFAULT_DARK_THEME.category);

  /** jsdom normalizes inline style colors to `rgb(r, g, b)`. */
  function rgb(hex: string): string {
    const h = hex.replace("#", "");
    return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
  }

  function headerContainer(server: string): HTMLElement {
    const el = document.querySelector<HTMLElement>(`[data-server='${server}']`);
    expect(el, `header container for ${server}`).toBeTruthy();
    return el!;
  }

  function toggleButton(server: string): HTMLElement {
    return within(headerContainer(server)).getByRole("button", {
      name: new RegExp(`(Collapse|Expand) ${server} sessions`),
    });
  }

  /** Render and flush the getAllServerColors effect promise. */
  async function renderWithColors(colors: Record<string, string>, currentServer = "primary") {
    vi.mocked(getAllServerColors).mockResolvedValue(colors);
    renderSidebar({ currentServer });
    await act(async () => {});
  }

  afterEach(() => {
    // Restore the file-default empty color map so this block's colors never
    // leak into other suites.
    vi.mocked(getAllServerColors).mockResolvedValue({});
  });

  it("colored non-current header carries the base tint fill, accent text, and accent top border", async () => {
    await renderWithColors({ alpha: "4" });

    const container = headerContainer("alpha");
    expect(container.style.backgroundColor).toBe(rgb(tints.get("4")!.base));
    expect(container.style.borderTopWidth).toBe("1px");
    expect(container.style.borderTopColor).toBe(rgb(borders.get("4")!));

    // Header text is the contrast-guarded accent, not text-secondary classes.
    const button = toggleButton("alpha");
    expect(button.style.color).toBe(rgb(borders.get("4")!));
    expect(button.className).not.toContain("text-text-primary");
  });

  it("current server reads deeper: selected tint fill + text-text-primary (no inline accent)", async () => {
    await renderWithColors({ primary: "4", alpha: "1" });

    // Current server: deeper selected shade + brightest text.
    const current = headerContainer("primary");
    expect(current.style.backgroundColor).toBe(rgb(tints.get("4")!.selected));
    const currentButton = toggleButton("primary");
    expect(currentButton.className).toContain("text-text-primary");
    expect(currentButton.style.color).toBe("");

    // Non-current sits at base with accent text — the strength distinction.
    expect(headerContainer("alpha").style.backgroundColor).toBe(rgb(tints.get("1")!.base));
    expect(toggleButton("alpha").style.color).toBe(rgb(borders.get("1")!));
  });

  it("uncolored server falls back to the gray sentinel with the same heavier treatment", async () => {
    await renderWithColors({}); // no colors assigned at all

    const container = headerContainer("beta");
    const grayTint = tints.get(UNCOLORED_SELECTED_KEY)!;
    const grayBorder = borders.get(UNCOLORED_SELECTED_KEY)!;
    expect(container.style.backgroundColor).toBe(rgb(grayTint.base));
    expect(container.style.borderTopColor).toBe(rgb(grayBorder));

    // Identical heavier element class: taller header, weight 600, coarse floor.
    const button = toggleButton("beta");
    expect(button.className).toContain("min-h-[26px]");
    expect(button.className).toContain("coarse:min-h-[28px]");
    expect(button.className).toContain("font-semibold");
  });

  it("unrecognized color descriptors degrade to the gray sentinel, never an unstyled header", async () => {
    await renderWithColors({ alpha: "bogus-color" });

    const container = headerContainer("alpha");
    expect(container.style.backgroundColor).toBe(rgb(tints.get(UNCOLORED_SELECTED_KEY)!.base));
    expect(container.style.borderTopColor).toBe(rgb(borders.get(UNCOLORED_SELECTED_KEY)!));
  });

  it("non-current header deepens to the hover shade on mouseenter and restores on leave; current stays flat", async () => {
    await renderWithColors({ primary: "4", alpha: "1" });

    const alpha = headerContainer("alpha");
    fireEvent.mouseEnter(alpha);
    expect(alpha.style.backgroundColor).toBe(rgb(tints.get("1")!.hover));
    fireEvent.mouseLeave(alpha);
    expect(alpha.style.backgroundColor).toBe(rgb(tints.get("1")!.base));

    // Current server: no hover swap — selected is already the deepest shade.
    const primary = headerContainer("primary");
    fireEvent.mouseEnter(primary);
    expect(primary.style.backgroundColor).toBe(rgb(tints.get("4")!.selected));
  });

  it("keeps header semantics: aria labels, expand/collapse, and the + button on the tinted bar", async () => {
    await renderWithColors({ alpha: "4" });

    // Toggle still works on the tinted header.
    const toggle = screen.getByRole("button", { name: /Expand alpha sessions/ });
    fireEvent.click(toggle);
    expect(
      screen.getByRole("button", { name: /Collapse alpha sessions/ }),
    ).toHaveAttribute("aria-expanded", "true");

    // The + new-session button still renders inside the tinted container.
    expect(
      within(headerContainer("alpha")).getByRole("button", { name: "New session on alpha" }),
    ).toBeInTheDocument();
  });
});

describe("Sidebar — server-group header action cluster (x4sf)", () => {
  // The header hosts a three-button server action cluster — palette, plus,
  // close, in that fixed order — reusing the SERVER-tile machinery wholesale:
  // SwatchPopover + the shared onServerColorChange seam for color, the lifted
  // onKillServer confirmation flow for kill. Queries are scoped WITHIN the
  // header container ([data-server]) because the SERVER-panel tiles carry the
  // same aria wording for the same actions.
  const palette = DEFAULT_DARK_THEME.palette;
  const tints = computeRowTints(palette);
  const borders = computeRowBorders(palette, DEFAULT_DARK_THEME.category);

  /** jsdom normalizes inline style colors to `rgb(r, g, b)`. */
  function rgb(hex: string): string {
    const h = hex.replace("#", "");
    return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
  }

  function headerContainer(server: string): HTMLElement {
    const el = document.querySelector<HTMLElement>(`[data-server='${server}']`);
    expect(el, `header container for ${server}`).toBeTruthy();
    return el!;
  }

  /** Render and flush the getAllServerColors effect promise. */
  async function renderWithColors(
    colors: Record<string, string>,
    opts: { currentServer?: string; onKillServer?: (name: string) => void } = {},
  ) {
    vi.mocked(getAllServerColors).mockResolvedValue(colors);
    renderSidebar({ currentServer: opts.currentServer ?? "primary", onKillServer: opts.onKillServer });
    await act(async () => {});
  }

  afterEach(() => {
    // Restore the file-default mocks so this block's state never leaks.
    vi.mocked(getAllServerColors).mockResolvedValue({});
    vi.mocked(setServerColor).mockClear();
  });

  it("renders the cluster in palette → plus → close DOM order after the toggle", async () => {
    await renderWithColors({ alpha: "4" });

    const buttons = within(headerContainer("alpha")).getAllByRole("button");
    expect(buttons).toHaveLength(4);
    expect(buttons[0]).toHaveAccessibleName(/(Expand|Collapse) alpha sessions/);
    expect(buttons[1]).toHaveAccessibleName("Set color for server alpha");
    expect(buttons[2]).toHaveAccessibleName("New session on alpha");
    expect(buttons[3]).toHaveAccessibleName("Kill server alpha");
  });

  it("hover-reveals the palette with the coarse touch fallback; + and ✕ stay always visible", async () => {
    await renderWithColors({ alpha: "4" });

    const container = headerContainer("alpha");
    // The reveal is driven by group-hover on the header container itself.
    expect(container.className).toContain("group");

    const paletteBtn = within(container).getByRole("button", { name: "Set color for server alpha" });
    for (const cls of ["opacity-0", "group-hover:opacity-100", "coarse:opacity-100", "focus-visible:opacity-100"]) {
      expect(paletteBtn.className).toContain(cls);
    }
    const plus = within(container).getByRole("button", { name: "New session on alpha" });
    const close = within(container).getByRole("button", { name: "Kill server alpha" });
    for (const btn of [plus, close]) {
      expect(btn.className).not.toContain("opacity-0");
      expect(btn.className).not.toContain("group-hover:opacity-100");
    }
  });

  it("cluster rest color follows the header text treatment (accent wrapper, inherited by buttons)", async () => {
    await renderWithColors({ primary: "4", alpha: "1" });

    // Non-current: the cluster wrapper carries the contrast-guarded accent as
    // an inline color; the buttons themselves carry NO inline color so their
    // hover: classes (text-text-primary / text-signal-red) can win on hover.
    const alphaPalette = within(headerContainer("alpha")).getByRole("button", {
      name: "Set color for server alpha",
    });
    const alphaWrapper = alphaPalette.parentElement as HTMLElement;
    expect(alphaWrapper.style.color).toBe(rgb(borders.get("1")!));
    const alphaClose = within(headerContainer("alpha")).getByRole("button", {
      name: "Kill server alpha",
    });
    expect(alphaClose.style.color).toBe("");
    expect(alphaClose.className).toContain("hover:text-signal-red");

    // Current: brightest text via class, no inline accent.
    const primaryPalette = within(headerContainer("primary")).getByRole("button", {
      name: "Set color for server primary",
    });
    const primaryWrapper = primaryPalette.parentElement as HTMLElement;
    expect(primaryWrapper.className).toContain("text-text-primary");
    expect(primaryWrapper.style.color).toBe("");
  });

  it("palette toggle opens a color-only SwatchPopover portalled to document.body", async () => {
    await renderWithColors({ alpha: "4" });

    const container = headerContainer("alpha");
    fireEvent.click(within(container).getByRole("button", { name: "Set color for server alpha" }));

    // Color-only picker (no marker column) — distinguished from the SERVER
    // panel's role=listbox tile grid by its accessible name.
    const popover = screen.getByRole("listbox", { name: "Color picker" });
    // Portalled: escapes the header (and the sessions list's overflow clip).
    expect(container.contains(popover)).toBe(false);
    expect(document.body.contains(popover)).toBe(true);
  });

  it("a swatch pick funnels through the shared seam: optimistic tint repaint + POST, popover stays open (live toggling)", async () => {
    await renderWithColors({}); // alpha starts uncolored (gray sentinel)

    const container = headerContainer("alpha");
    expect(container.style.backgroundColor).toBe(rgb(tints.get(UNCOLORED_SELECTED_KEY)!.base));

    fireEvent.click(within(container).getByRole("button", { name: "Set color for server alpha" }));
    const popover = screen.getByRole("listbox", { name: "Color picker" });
    fireEvent.click(within(popover).getByRole("option", { name: "Color blue" }));

    // The single write seam maps the family to its legacy descriptor ("4")
    // and the shared handler POSTs + repaints the header tint optimistically
    // (non-current ⇒ base shade) without waiting for any poll.
    expect(vi.mocked(setServerColor)).toHaveBeenCalledExactlyOnceWith("alpha", "4");
    expect(container.style.backgroundColor).toBe(rgb(tints.get("4")!.base));
    // Selection does NOT dismiss (the picker's dismissal contract) — the ✕
    // cell is the explicit close, so tint combos can be compared live.
    expect(screen.getByRole("listbox", { name: "Color picker" })).toBeInTheDocument();
    fireEvent.click(within(popover).getByLabelText("Close picker"));
    expect(screen.queryByRole("listbox", { name: "Color picker" })).not.toBeInTheDocument();
  });

  it("Clear clears the optimistic entry back to the gray sentinel and POSTs null", async () => {
    await renderWithColors({ alpha: "4" });

    const container = headerContainer("alpha");
    expect(container.style.backgroundColor).toBe(rgb(tints.get("4")!.base));

    fireEvent.click(within(container).getByRole("button", { name: "Set color for server alpha" }));
    fireEvent.click(
      within(screen.getByRole("listbox", { name: "Color picker" })).getByRole("option", {
        name: "Clear",
      }),
    );

    expect(vi.mocked(setServerColor)).toHaveBeenCalledExactlyOnceWith("alpha", null);
    expect(container.style.backgroundColor).toBe(rgb(tints.get(UNCOLORED_SELECTED_KEY)!.base));
  });

  it("✕ invokes the lifted onKillServer prop with the server name (confirmation is the parent's)", async () => {
    const onKillServer = vi.fn();
    await renderWithColors({ alpha: "4" }, { onKillServer });

    fireEvent.click(
      within(headerContainer("alpha")).getByRole("button", { name: "Kill server alpha" }),
    );

    expect(onKillServer).toHaveBeenCalledExactlyOnceWith("alpha");
    // No sidebar-owned dialog: the kill confirmation lives in the layout-
    // mounted ServerDialogs (server-dialogs-context `killServerTarget`,
    // 260811-239r), so nothing renders here.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("cluster buttons carry tier-1 tips with short generic labels (260723-fm08)", async () => {
    await renderWithColors({ alpha: "4" });

    // Focus opens immediately (tip.test.tsx focus idiom). The tip label is
    // the short generic name; the aria-label keeps per-server specificity.
    const kill = within(headerContainer("alpha")).getByRole("button", { name: "Kill server alpha" });
    fireEvent.focus(kill);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Kill server");
    expect(kill.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
    fireEvent.blur(kill);

    const plus = within(headerContainer("alpha")).getByRole("button", { name: "New session on alpha" });
    fireEvent.focus(plus);
    expect(screen.getByRole("tooltip")).toHaveTextContent("New session");
  });

  it("keeps the toggle dominant and the existing header semantics intact", async () => {
    await renderWithColors({ alpha: "4" });

    const container = headerContainer("alpha");
    const toggle = within(container).getByRole("button", { name: /Expand alpha sessions/ });
    expect(toggle.className).toContain("flex-1");
    fireEvent.click(toggle);
    expect(
      within(container).getByRole("button", { name: /Collapse alpha sessions/ }),
    ).toHaveAttribute("aria-expanded", "true");
  });
});

describe("sidebar footer chrome (260723-o7q8 gear; 260724-6j1v cluster)", () => {
  it("renders the gear with an aria-label and NO native title (Tip-named)", () => {
    renderSidebar();
    const gear = screen.getByRole("button", { name: "Open settings" });
    expect(gear).toBeInTheDocument();
    expect(gear.getAttribute("title")).toBeNull();
  });

  it("renders the connection dot as a left readout with the top-bar dot's exact semantics", () => {
    renderSidebar({ isConnected: true });
    const dot = screen.getByLabelText("Connected");
    expect(dot).toBeInTheDocument();
    expect(dot.className).toContain("bg-accent-green");
    // Status readout, not a control: role="status" live region, no tab stop.
    const region = dot.closest('[role="status"]')!;
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(dot.tagName).toBe("SPAN");
  });

  it("flips the dot to disconnected grey when the page's stream is down", () => {
    renderSidebar({ isConnected: false });
    const dot = screen.getByLabelText("Disconnected");
    expect(dot.className).toContain("bg-text-secondary");
    expect(screen.queryByLabelText("Connected")).not.toBeInTheDocument();
  });

  it("renders the version readout beside the dot and copies the displayed form on click", async () => {
    renderSidebar({ daemonVersion: "0.9.3" });
    const version = screen.getByRole("button", { name: "RunKit v0.9.3 (copy)" });
    expect(version).toHaveTextContent("v0.9.3");
    fireEvent.click(version);
    await waitFor(() => expect(vi.mocked(copyToClipboard)).toHaveBeenCalledWith("v0.9.3"));
  });

  it("renders NO version element until the daemon reports a version (never vundefined)", () => {
    renderSidebar({ daemonVersion: null });
    expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/vundefined/)).not.toBeInTheDocument();
  });

  it("renders the Help anchor with the shared HELP_URL and safe new-tab attrs", () => {
    renderSidebar();
    const help = screen.getByLabelText("Help — run-kit docs");
    expect(help.tagName).toBe("A");
    expect(help).toHaveAttribute("href", "https://shll.ai/run-kit");
    expect(help).toHaveAttribute("target", "_blank");
    const rel = help.getAttribute("rel") ?? "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
    expect(help).not.toHaveAttribute("title");
  });

  it("cycles the theme on click (system → light) and carries the chip idiom", () => {
    renderSidebar();
    const theme = screen.getByRole("button", { name: "System theme" });
    // Chip footer idiom (260811-cj4b) — the top bar's bordered rk-glint chip.
    expect(theme.className).toContain("rk-glint");
    expect(theme.className).toContain("border-border");
    fireEvent.click(theme);
    expect(screen.getByRole("button", { name: "Light theme" })).toBeInTheDocument();
  });

  it("styles all four footer actions as bordered rk-glint chips (260811-cj4b)", () => {
    renderSidebar();
    const actions = [
      screen.getByLabelText("Help — run-kit docs"),
      screen.getByRole("button", { name: "Keyboard shortcuts" }),
      screen.getByRole("button", { name: "System theme" }),
      screen.getByRole("button", { name: "Open settings" }),
    ];
    for (const action of actions) {
      expect(action.className).toContain("rk-glint");
      // Exact token match — `toContain("border")` would pass vacuously via "border-border".
      expect(action.classList.contains("border")).toBe(true);
      expect(action.className).toContain("border-border");
      // Fixed-size chip (24px fine / 30px coarse) — no min-* floors.
      expect(action.className).toContain("w-[24px]");
      expect(action.className).toContain("h-[24px]");
      expect(action.className).toContain("coarse:w-[30px]");
      expect(action.className).toContain("coarse:h-[30px]");
      // Hover is the rk-glint green line, not a color flip.
      expect(action.className).not.toContain("hover:text-text-primary");
    }
  });

  it("Ctrl/Cmd-click on the theme button opens the theme selector instead of cycling", () => {
    renderSidebar();
    const openListener = vi.fn();
    document.addEventListener("theme-selector:open", openListener);
    try {
      fireEvent.click(screen.getByRole("button", { name: "System theme" }), { ctrlKey: true });
      expect(openListener).toHaveBeenCalledTimes(1);
      // No cycle happened — the label is still the system mode.
      expect(screen.getByRole("button", { name: "System theme" })).toBeInTheDocument();
    } finally {
      document.removeEventListener("theme-selector:open", openListener);
    }
  });

  it("lays the footer out readouts-left / actions-right in Help · Keyboard · Theme · Gear order", () => {
    renderSidebar({ isConnected: true, daemonVersion: "0.9.3" });
    const dot = screen.getByLabelText("Connected");
    const version = screen.getByRole("button", { name: "RunKit v0.9.3 (copy)" });
    const help = screen.getByLabelText("Help — run-kit docs");
    const keyboard = screen.getByRole("button", { name: "Keyboard shortcuts" });
    const theme = screen.getByRole("button", { name: "System theme" });
    const gear = screen.getByRole("button", { name: "Open settings" });
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(dot, version)).toBe(true);
    expect(follows(version, help)).toBe(true);
    expect(follows(help, keyboard)).toBe(true);
    expect(follows(keyboard, theme)).toBe(true);
    expect(follows(theme, gear)).toBe(true);
    // One justify-between row: readout segment left, action cluster right.
    const row = gear.closest(".justify-between")!;
    expect(row).toContainElement(dot as HTMLElement);
  });

  it("the Settings gear tip carries the registry-resolved chord keycap (260801-mqim)", async () => {
    renderSidebar();
    const gear = screen.getByRole("button", { name: "Open settings" });
    fireEvent.mouseEnter(gear);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Settings");
    // jsdom detects platform "other" → the Shift+Ctrl spelling of the new
    // `settings-open` default (Comma).
    expect(tooltip.querySelector("kbd")).toHaveTextContent("Shift+Ctrl+,");
  });

  it("the Keyboard button dispatches shortcuts-overlay:open in the chip idiom (260801-sm6g)", () => {
    renderSidebar();
    const keyboard = screen.getByRole("button", { name: "Keyboard shortcuts" });
    // Chip footer idiom (260811-cj4b) — bordered rk-glint chip, no native
    // title (the Tip carries the label + effective-chord kbd slot).
    expect(keyboard.className).toContain("border-border");
    expect(keyboard.className).toContain("rk-glint");
    expect(keyboard).not.toHaveAttribute("title");
    const openListener = vi.fn();
    document.addEventListener("shortcuts-overlay:open", openListener);
    try {
      fireEvent.click(keyboard);
      expect(openListener).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("shortcuts-overlay:open", openListener);
    }
  });
});

describe("Sidebar — desktop selected-row autoscroll (nris)", () => {
  // The file-default matchMedia stub reports DESKTOP (fine pointer, wide), so
  // the mobile drawer scroll+focus effect never runs here — every scroll call
  // observed in this block comes from the selection-keyed desktop effect.
  //
  // jsdom has no scrollIntoView — define a prototype-level spy so the effect's
  // `typeof row.scrollIntoView === "function"` guard passes.
  let scrollSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollSpy = vi.fn();
    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
      value: scrollSpy,
      configurable: true,
      writable: true,
    });
    useWindowStore.setState({ entries: new Map(), ghosts: [] });
  });

  afterEach(() => {
    delete (window.HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView;
    useWindowStore.setState({ entries: new Map(), ghosts: [] });
  });

  const SCROLL_SESSIONS: ProjectSession[] = [
    {
      name: "main",
      windows: [
        { index: 0, windowId: "@0", name: "edit", worktreePath: "~/a", activity: "idle", isActiveWindow: false, activityTimestamp: 0 },
        { index: 1, windowId: "@1", name: "test", worktreePath: "~/a", activity: "idle", isActiveWindow: false, activityTimestamp: 0 },
      ],
    },
  ];

  /** Provider tree parameterized on sessions + selected window id so tests can
   *  rerender across selection changes, passive SSE ticks, and data arrival. */
  function scrollTreeUI(sessions: ProjectSession[], currentWindowId: string | null) {
    const servers = [{ name: "primary", sessionCount: 1 }];
    return (
      <ThemeProvider>
        <InstanceAccentValueProvider value={NULL_ACCENT}>
        <InstanceNameValueProvider value={NULL_NAME}>
        <ToastProvider>
          <OptimisticProvider>
            <StandaloneSessionContextProvider
              value={{
                sessionsByServer: new Map([["primary", sessions]]),
                sessionOrderByServer: new Map([["primary", []]]),
                isConnectedByServer: new Map([["primary", true]]),
                metricsByServer: new Map(),
                currentServer: "primary",
                servers,
                refreshServers: vi.fn(),
              }}
            >
              <MetricsProvider value={null}>
                <HostMetricsProvider value={null}>
                  <FocusedPaneProvider>
                    <ChromeProvider>
                      <SettingsDialogProvider>
                        <Sidebar
                          currentServer="primary"
                          currentSession="main"
                          currentWindowId={currentWindowId}
                          isConnected={false}
                          onSelectWindow={vi.fn()}
                          onCreateWindow={vi.fn()}
                          onCreateSession={vi.fn()}
                          onCreateServer={vi.fn()}
                          onKillServer={vi.fn()}
                        />
                      </SettingsDialogProvider>
                    </ChromeProvider>
                  </FocusedPaneProvider>
                </HostMetricsProvider>
              </MetricsProvider>
            </StandaloneSessionContextProvider>
          </OptimisticProvider>
        </ToastProvider>
        </InstanceNameValueProvider>
        </InstanceAccentValueProvider>
      </ThemeProvider>
    );
  }

  /** The selected window row's button (the desktop effect's query target). */
  function selectedRowButton(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[data-window-id] [aria-current="page"]');
  }

  /** Calls whose `this` was a WINDOW-ROW button (scoped like the effect's own
   *  selector) — the ServerPanel active-tile effect also scrolls via the same
   *  prototype spy, so tile calls are filtered out. */
  function rowScrollCalls(): unknown[] {
    return scrollSpy.mock.instances.filter(
      (el) => el instanceof HTMLElement && el.closest("[data-window-id]") !== null,
    );
  }

  it("scrolls the selected row into view on mount without moving focus or the roving tab stop", () => {
    render(scrollTreeUI(SCROLL_SESSIONS, "@0"));

    const row = selectedRowButton();
    expect(row).not.toBeNull();
    expect(rowScrollCalls()).toHaveLength(1);
    expect(rowScrollCalls()[0]).toBe(row);
    expect(scrollSpy).toHaveBeenCalledWith({ block: "nearest" });
    // Scroll-only: focus stays outside the tree (no focus() call)...
    expect(screen.getByRole("tree").contains(document.activeElement)).toBe(false);
    // ...and the roving tab stop is untouched (still the first visible row —
    // the "main" session header — NOT the selected window row).
    const tabbable = Array.from(
      screen.getByRole("tree").querySelectorAll('[role="treeitem"][tabindex="0"]'),
    );
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0].getAttribute("data-session-row")).toBe("primary:main");
  });

  it("scrolls once per selection change and never again on passive SSE ticks", () => {
    const { rerender } = render(scrollTreeUI(SCROLL_SESSIONS, "@0"));
    expect(rowScrollCalls()).toHaveLength(1);

    // Selection change → exactly one more scroll, targeting the new row.
    act(() => { rerender(scrollTreeUI(SCROLL_SESSIONS, "@1")); });
    expect(rowScrollCalls()).toHaveLength(2);
    expect((rowScrollCalls()[1] as HTMLElement).closest("[data-window-id]"))
      .toHaveAttribute("data-window-id", "@1");

    // Passive SSE tick: fresh Map + fresh window objects, SAME visible-row set,
    // SAME selection — must not scroll (Wave-2 #262: no scroll state churn).
    const ticked: ProjectSession[] = SCROLL_SESSIONS.map((s) => ({
      ...s,
      windows: s.windows.map((w) => ({ ...w, activityTimestamp: w.activityTimestamp + 1 })),
    }));
    act(() => { rerender(scrollTreeUI(ticked, "@1")); });
    expect(rowScrollCalls()).toHaveLength(2);
  });

  it("deep-link retry: no row at mount, scrolls exactly once when the SSE data lands", () => {
    // Route resolved before SSE: selection is set but no rows exist yet.
    const { rerender } = render(scrollTreeUI([], "@1"));
    expect(selectedRowButton()).toBeNull();
    expect(rowScrollCalls()).toHaveLength(0);

    // SSE snapshot lands → rows render, rowsVersion bumps → one deferred scroll.
    act(() => { rerender(scrollTreeUI(SCROLL_SESSIONS, "@1")); });
    expect(rowScrollCalls()).toHaveLength(1);
    expect((rowScrollCalls()[0] as HTMLElement).closest("[data-window-id]"))
      .toHaveAttribute("data-window-id", "@1");

    // The pending ref is cleared: a later passive tick does not re-scroll.
    const ticked: ProjectSession[] = SCROLL_SESSIONS.map((s) => ({
      ...s,
      windows: s.windows.map((w) => ({ ...w, activityTimestamp: w.activityTimestamp + 1 })),
    }));
    act(() => { rerender(scrollTreeUI(ticked, "@1")); });
    expect(rowScrollCalls()).toHaveLength(1);
  });

  it("collapsed group: no scroll, no auto-expand; the deferred scroll fires on expand", () => {
    const { rerender } = render(scrollTreeUI(SCROLL_SESSIONS, "@0"));
    expect(rowScrollCalls()).toHaveLength(1);

    // Collapse the "main" session — the window rows leave the DOM.
    act(() => { fireEvent.click(screen.getByRole("button", { name: /Collapse main/ })); });
    expect(selectedRowButton()).toBeNull();

    // Select a different window while collapsed: row not queryable → no scroll,
    // and the group is NOT auto-expanded.
    act(() => { rerender(scrollTreeUI(SCROLL_SESSIONS, "@1")); });
    expect(rowScrollCalls()).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Expand main/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    // User expands the group → the armed pending scroll completes once.
    act(() => { fireEvent.click(screen.getByRole("button", { name: /Expand main/ })); });
    expect(rowScrollCalls()).toHaveLength(2);
    expect((rowScrollCalls()[1] as HTMLElement).closest("[data-window-id]"))
      .toHaveAttribute("data-window-id", "@1");
  });

  it("stays disarmed with no URL window selection (currentWindowId null)", () => {
    // isActiveWindow fallback may still paint aria-current on a row, but the
    // effect keys on the URL selection identity — null disarms it.
    const withActive: ProjectSession[] = [
      {
        name: "main",
        windows: [
          { index: 0, windowId: "@0", name: "edit", worktreePath: "~/a", activity: "idle", isActiveWindow: true, activityTimestamp: 0 },
        ],
      },
    ];
    render(scrollTreeUI(withActive, null));
    expect(selectedRowButton()).not.toBeNull(); // fallback highlight exists
    expect(rowScrollCalls()).toHaveLength(0); // but no scroll fires
  });
});

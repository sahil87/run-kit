import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within, act } from "@testing-library/react";
import { StatusBar } from "./status-bar";
import { ChromeProvider } from "@/contexts/chrome-context";
import {
  InstanceNameValueProvider,
  type InstanceName,
} from "@/contexts/instance-name-context";
import { makeWindow, makeWindowWithPanes } from "@/test-utils/fixtures";
import type { MetricsSnapshot } from "@/types";

// Controllable session-context seams: StatusBar leaf-subscribes to the two
// metrics contexts and the tolerant update-notification hook (the HostPanel /
// SidebarFooter precedent) — mocked here so tests need no SessionProvider.
let mockMetrics: MetricsSnapshot | null = null;
let mockHostMetrics: MetricsSnapshot | null = null;
let mockDaemonVersion: string | null = null;
vi.mock("@/contexts/session-context", () => ({
  useMetrics: () => mockMetrics,
  useHostMetrics: () => mockHostMetrics,
  useUpdateNotification: () => ({ daemonVersion: mockDaemonVersion }),
}));

// Copy seam: the segments copy through the shared clipboard lib (via
// useCopyFeedback) — mocked so tests assert the RAW value handed over.
const { mockCopyToClipboard } = vi.hoisted(() => ({ mockCopyToClipboard: vi.fn() }));
vi.mock("@/lib/clipboard", () => ({ copyToClipboard: mockCopyToClipboard }));

function makeMetrics(overrides: Partial<MetricsSnapshot> = {}): MetricsSnapshot {
  return {
    hostname: "mba",
    cpu: { samples: [10, 17], current: 17, cores: 8 },
    memory: { used: 24 * 1024 ** 3, total: 59 * 1024 ** 3 },
    load: { avg1: 1.12, avg5: 0.9, avg15: 0.7, cpus: 8 },
    disk: { used: 100 * 1024 ** 3, total: 500 * 1024 ** 3 },
    uptime: 3600,
    ...overrides,
  };
}

function renderBar(overrides: Partial<React.ComponentProps<typeof StatusBar>> = {}) {
  const name: InstanceName = {
    hostname: "",
    instanceName: null,
    displayName: "",
    setInstanceName: vi.fn(),
  };
  return render(
    <ChromeProvider>
      <InstanceNameValueProvider value={name}>
        <StatusBar window={null} isConnected={true} {...overrides} />
      </InstanceNameValueProvider>
    </ChromeProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mockMetrics = null;
  mockHostMetrics = null;
  mockDaemonVersion = null;
  mockCopyToClipboard.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StatusBar (260814-ldbs)", () => {
  it("renders the attached frame strip with status semantics", () => {
    renderBar();
    const bar = screen.getByTestId("status-bar");
    expect(bar).toHaveAttribute("role", "region");
    expect(bar.className).toContain("border-t");
    expect(bar.className).toContain("bg-bg-primary");
  });

  describe("left window cluster (terminal route)", () => {
    it("renders nothing when there is no window", () => {
      renderBar({ window: null });
      expect(screen.queryByTestId("status-bar-window")).not.toBeInTheDocument();
    });

    it("renders the git/tmx/cwd identity registers in descending-relevance order", () => {
      renderBar({ window: makeWindowWithPanes() });
      expect(screen.getByText("pane 1/1 %5")).toBeInTheDocument();
      // cwd renders as the BASENAME with the full path in the tooltip.
      expect(screen.getByText("run-kit")).toBeInTheDocument();
      expect(screen.getByText("main")).toBeInTheDocument();
      // There is no out register in the strip (deleted outright).
      expect(screen.queryByText("zsh")).not.toBeInTheDocument();
      // Strip order is descending relevance: git → tmx → cwd.
      const text = screen.getByTestId("status-bar-window").textContent ?? "";
      expect(text.indexOf("main")).toBeLessThan(text.indexOf("pane 1/1 %5"));
      expect(text.indexOf("pane 1/1 %5")).toBeLessThan(text.indexOf("run-kit"));
    });

    it("renders agt/fab/PR registers when those layers are present", () => {
      const win = makeWindowWithPanes({
        agentState: "waiting",
        agentIdleDuration: "3m",
        fabChange: "260814-ldbs-shell-stage-status-bar",
        fabStage: "apply",
        prNumber: 603,
        prState: "open",
        prChecks: "pass",
        prUrl: "https://github.com/sahil87/run-kit/pull/603",
      });
      renderBar({ window: win });
      expect(screen.getByText("waiting 3m")).toBeInTheDocument();
      expect(screen.getByText("ldbs shell-stage-status-bar · apply")).toBeInTheDocument();
      // PR renders as an open-first anchor (native open semantics).
      const pr = screen.getByRole("link", { name: "Open PR #603 in a new tab" });
      expect(pr).toHaveAttribute("href", "https://github.com/sahil87/run-kit/pull/603");
      expect(pr).toHaveAttribute("target", "_blank");
      // Full descending-relevance order: git → pr → fab → agt (→ tmx → cwd).
      const text = screen.getByTestId("status-bar-window").textContent ?? "";
      expect(text.indexOf("main")).toBeLessThan(text.indexOf("#603"));
      expect(text.indexOf("#603")).toBeLessThan(text.indexOf("ldbs shell-stage-status-bar"));
      expect(text.indexOf("ldbs shell-stage-status-bar")).toBeLessThan(text.indexOf("waiting 3m"));
    });

    it("renders the PR register as plain text when no URL exists", () => {
      const win = makeWindowWithPanes({ prNumber: 604, prState: "merged" });
      renderBar({ window: win });
      expect(screen.queryByRole("link", { name: /Open PR/ })).not.toBeInTheDocument();
      expect(screen.getByText("#604")).toBeInTheDocument();
      expect(screen.getByText("merged")).toBeInTheDocument();
    });

    it("marks a deleted cwd in red with the (deleted) tag", () => {
      const win = makeWindow({
        worktreePath: "/home/user/wt/gone",
        panes: [
          { paneId: "%5", paneIndex: 0, cwd: "/home/user/wt/gone", command: "zsh", isActive: true, cwdMissing: true },
        ],
      });
      renderBar({ window: win });
      const cwd = screen.getByText(/gone \(deleted\)/);
      expect(cwd.className).toContain("text-signal-red");
    });
  });

  describe("right host cluster (every desktop route)", () => {
    it("renders compact host metrics, host+version, and the connection dot", () => {
      mockHostMetrics = makeMetrics();
      mockDaemonVersion = "0.9.3";
      renderBar({ server: "alpha" });
      const host = screen.getByTestId("status-bar-host");
      expect(screen.getByText("cpu")).toBeInTheDocument();
      expect(screen.getByText("17%")).toBeInTheDocument();
      expect(screen.getByText("24G/59G")).toBeInTheDocument();
      // ld is the normalized 1-minute percentage (112/8 → 14%).
      expect(screen.getByText("14%")).toBeInTheDocument();
      expect(host).toHaveTextContent("alpha");
      expect(host).toHaveTextContent("mba");
      expect(host).toHaveTextContent("v0.9.3");
      expect(screen.getByLabelText("Connected")).toBeInTheDocument();
    });

    it("server-scoped metrics win over the host broadcast (the HostPanel rule)", () => {
      mockMetrics = makeMetrics({ hostname: "scoped", cpu: { samples: [40], current: 40, cores: 4 } });
      mockHostMetrics = makeMetrics({ hostname: "global" });
      renderBar();
      expect(screen.getByTestId("status-bar-host")).toHaveTextContent("40%");
      expect(screen.getByTestId("status-bar-host")).not.toHaveTextContent("global");
    });

    it("omits the metrics and version fragments before the first events (no placeholders)", () => {
      renderBar({ server: "alpha" });
      const host = screen.getByTestId("status-bar-host");
      expect(host).not.toHaveTextContent("cpu");
      expect(host).not.toHaveTextContent(/vundefined/);
      expect(host).toHaveTextContent("alpha");
    });

    it("shows the disconnected dot state", () => {
      renderBar({ isConnected: false });
      expect(screen.getByLabelText("Disconnected")).toBeInTheDocument();
    });

    it("opens the host-metrics flyout (the shared HostMetrics graphs) on trigger focus", () => {
      mockHostMetrics = makeMetrics();
      renderBar();
      fireEvent.focus(screen.getByLabelText("Host metrics — details on hover"));
      // The flyout renders the shared HostMetrics rows (the uptime proves it —
      // the strip itself renders no uptime).
      expect(screen.getByText("1h 0m")).toBeInTheDocument();
    });
  });

  describe("hints (the deleted bottom bar's desktop remnants)", () => {
    it("dispatches palette:open from the ⌘K hint", () => {
      const listener = vi.fn();
      document.addEventListener("palette:open", listener);
      renderBar();
      fireEvent.click(screen.getByRole("button", { name: "Open command palette" }));
      expect(listener).toHaveBeenCalled();
      document.removeEventListener("palette:open", listener);
    });

    it("fires onOpenCompose from the a▏ hint and mirrors the strip's pressed state", () => {
      const onOpenCompose = vi.fn();
      renderBar({ onOpenCompose });
      const chip = screen.getByTestId("status-bar-compose");
      expect(chip).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(chip);
      expect(onOpenCompose).toHaveBeenCalled();
    });
  });

  it("survives the metrics stream arriving mid-render — both metric hooks are called unconditionally (rework: Rules-of-Hooks fix)", () => {
    // Regression guard for the `useMetrics() ?? useHostMetrics()` conditional
    // call: with the short-circuit, the first tick (server metrics arriving)
    // changed the hook ORDER and React threw. Now both hooks always run and
    // the coalesce happens after.
    const tree = (window: React.ComponentProps<typeof StatusBar>["window"]) => (
      <ChromeProvider>
        <InstanceNameValueProvider
          value={{ hostname: "", instanceName: null, displayName: "", setInstanceName: vi.fn() }}
        >
          <StatusBar window={window} isConnected={true} />
        </InstanceNameValueProvider>
      </ChromeProvider>
    );
    const { rerender } = render(tree(null));
    expect(screen.queryByText(/cpu/)).not.toBeInTheDocument();
    // Host-global metrics arrive first (every route)…
    mockHostMetrics = makeMetrics({ cpu: { samples: [11], current: 11, cores: 8 } });
    rerender(tree(null));
    expect(screen.getByText("11%")).toBeInTheDocument();
    // …then the server-scoped slice lands and WINS (the HostPanel rule).
    mockMetrics = makeMetrics({ cpu: { samples: [42], current: 42, cores: 4 } });
    rerender(tree(null));
    expect(screen.getByText("42%")).toBeInTheDocument();
    // …and a window record arriving later (SSE snapshot) adds the cluster.
    rerender(tree(makeWindowWithPanes()));
    expect(screen.getByTestId("status-bar-window")).toBeInTheDocument();
  });

  describe("overflow ladder (R5)", () => {
    it("the … menu lists EVERY dropped segment — window rows, metrics rows, version, and the hint rows keep their actions", () => {
      mockHostMetrics = makeMetrics();
      mockDaemonVersion = "0.9.3";
      const listener = vi.fn();
      document.addEventListener("palette:open", listener);
      renderBar({ window: makeWindowWithPanes(), server: "alpha", onOpenCompose: vi.fn() });
      fireEvent.click(screen.getByTestId("status-bar-overflow"));
      const menu = screen.getByRole("menu", { name: "Overflow status segments" });
      const texts = Array.from(menu.querySelectorAll("[role='menuitem']")).map((el) => el.textContent);
      // Window + metrics rows (each inverse-gated to its strip segment)…
      expect(texts.some((t) => t?.startsWith("cwd "))).toBe(true);
      expect(texts.some((t) => t?.startsWith("tmx "))).toBe(true);
      // No out row — the out register is deleted from the bar.
      expect(texts.some((t) => t?.startsWith("out "))).toBe(false);
      expect(texts.some((t) => t === "⑂ main")).toBe(true);
      expect(texts.some((t) => t?.startsWith("ld "))).toBe(true);
      expect(texts.some((t) => t?.startsWith("cpu "))).toBe(true);
      // …plus the version fragment (dropped below 700px)…
      expect(texts).toContain("v0.9.3");
      // …and the two hint chips (dropped below xl) as ACTIONABLE rows.
      const paletteRow = screen.getByRole("menuitem", { name: "⌘K Command palette" });
      expect(paletteRow.className).toContain("xl:hidden");
      expect(screen.getByRole("menuitem", { name: "a▏ Compose text" })).toBeInTheDocument();
      // The palette row fires the real action and closes the menu.
      fireEvent.click(paletteRow);
      expect(listener).toHaveBeenCalled();
      expect(screen.queryByRole("menu", { name: "Overflow status segments" })).not.toBeInTheDocument();
      document.removeEventListener("palette:open", listener);
    });

    it("drops low-priority segments by deterministic breakpoint classes and lists them under the … chevron", () => {      mockHostMetrics = makeMetrics();
      renderBar({ window: makeWindowWithPanes(), server: "alpha" });
      const bar = screen.getByTestId("status-bar-window");
      // Truncation survives; whole-segment drops are breakpoint-class driven
      // (no JS measurement), rightmost dies first: cwd at ≥xl-only
      // visibility, tmx at ≥lg, git at ≥md.
      expect(bar.querySelector(".xl\\:flex")).not.toBeNull();
      // The chevron mirrors the ladder: visible only below xl.
      const chevron = screen.getByTestId("status-bar-overflow");
      expect(chevron.parentElement!.className).toContain("xl:hidden");
      fireEvent.click(chevron);
      const menu = screen.getByRole("menu", { name: "Overflow status segments" });
      // The cwd row carries the INVERSE visibility (xl:hidden) of its segment.
      const cwdRow = Array.from(menu.querySelectorAll("[role='menuitem']")).find((el) =>
        el.textContent?.startsWith("cwd "),
      );
      expect(cwdRow?.className).toContain("xl:hidden");
      // Escape closes and refocuses the trigger.
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("menu", { name: "Overflow status segments" })).not.toBeInTheDocument();
      expect(document.activeElement).toBe(chevron);
    });

    it("roves focus through the menu rows with ArrowDown/ArrowUp — informational rows included", async () => {
      // Most rows are informational spans (`role="menuitem" tabIndex={-1}`), so
      // arrow-nav is what makes them reachable at all: without it a keyboard
      // user could open the menu and never read a segment (Constitution V).
      // Mirrors `top-bar-overflow-menu.tsx`'s contract.
      mockHostMetrics = makeMetrics();
      mockDaemonVersion = "0.9.3";
      renderBar({ window: makeWindowWithPanes(), server: "alpha", onOpenCompose: vi.fn() });
      fireEvent.click(screen.getByTestId("status-bar-overflow"));
      const menu = screen.getByRole("menu", { name: "Overflow status segments" });
      const rows = Array.from(menu.querySelectorAll<HTMLElement>("[role='menuitem']"));
      expect(rows.length).toBeGreaterThan(1);

      // Opening moves focus into the panel (rAF-deferred, like the top bar).
      await waitFor(() => expect(document.activeElement).toBe(rows[0]));

      fireEvent.keyDown(document, { key: "ArrowDown" });
      expect(document.activeElement).toBe(rows[1]);

      fireEvent.keyDown(document, { key: "ArrowUp" });
      expect(document.activeElement).toBe(rows[0]);

      // Wraps backwards from the first row to the last.
      fireEvent.keyDown(document, { key: "ArrowUp" });
      expect(document.activeElement).toBe(rows[rows.length - 1]);
    });
  });

  describe("copy affordances (the Pane panel's CopyableRow contract)", () => {
    it("left-cluster segments copy RAW values (branch, change id, pane id, full path) with the copied ✓ label swap and 1s revert", () => {
      vi.useFakeTimers();
      const win = makeWindowWithPanes({ fabChange: "260814-ldbs-shell-stage-status-bar", fabStage: "apply" });
      renderBar({ window: win });

      // git — copies the branch name, label (⑂) swaps to copied ✓, then reverts.
      fireEvent.click(screen.getByRole("button", { name: "Copy git branch" }));
      expect(mockCopyToClipboard).toHaveBeenCalledWith("main");
      const cluster = screen.getByTestId("status-bar-window");
      expect(within(cluster).getByText("copied ✓")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1000));
      expect(within(cluster).queryByText("copied ✓")).not.toBeInTheDocument();

      // fab — copies the 4-char change id, never the display line.
      fireEvent.click(screen.getByRole("button", { name: "Copy fab change id" }));
      expect(mockCopyToClipboard).toHaveBeenCalledWith("ldbs");
      // tmx — copies the pane id, not the pane N/M text.
      fireEvent.click(screen.getByRole("button", { name: "Copy tmux pane id" }));
      expect(mockCopyToClipboard).toHaveBeenCalledWith("%5");
      // cwd — copies the FULL path (the strip shows the basename).
      fireEvent.click(screen.getByRole("button", { name: "Copy working directory path" }));
      expect(mockCopyToClipboard).toHaveBeenCalledWith("/home/user/code/run-kit");
      vi.useRealTimers();
    });

    it("an in-progress text selection short-circuits the copy (the select gesture wins)", () => {
      renderBar({ window: makeWindowWithPanes() });
      vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "picked text" } as Selection);
      fireEvent.click(screen.getByRole("button", { name: "Copy git branch" }));
      expect(mockCopyToClipboard).not.toHaveBeenCalled();
      expect(screen.queryByText("copied ✓")).not.toBeInTheDocument();
    });

    it("right-cluster identity fragments copy their displayed strings; the fragment text swaps to copied ✓", () => {
      mockHostMetrics = makeMetrics();
      mockDaemonVersion = "0.9.3";
      renderBar({ server: "alpha" });
      fireEvent.click(screen.getByRole("button", { name: "Copy server name" }));
      expect(mockCopyToClipboard).toHaveBeenCalledWith("alpha");
      fireEvent.click(screen.getByRole("button", { name: "Copy host name" }));
      expect(mockCopyToClipboard).toHaveBeenCalledWith("mba");
      fireEvent.click(screen.getByRole("button", { name: "Copy version" }));
      expect(mockCopyToClipboard).toHaveBeenCalledWith("v0.9.3");
      // Unlabeled fragment: its own text is the feedback slot.
      expect(screen.getByRole("button", { name: "Copy version" })).toHaveTextContent("copied ✓");
    });

    it("segments without a stable raw value stay passive — agt, metrics, the connection dot, and a paneId-less tmx", () => {
      mockHostMetrics = makeMetrics();
      const win = makeWindowWithPanes({ agentState: "waiting", agentIdleDuration: "3m" });
      renderBar({ window: win });
      expect(screen.getByText("waiting 3m").closest("button")).toBeNull();
      expect(screen.getByText("cpu").closest("button")).toBeNull();
      expect(screen.getByLabelText("Connected").closest("button")).toBeNull();
      cleanup();
      // No panes ⇒ no pane id ⇒ the tmx segment renders but is not a button.
      renderBar({ window: makeWindow() });
      expect(screen.getByText("pane 1/0").closest("button")).toBeNull();
    });

    it("overflow rows mirroring copyable segments are copy-action buttons — full raw value, menu stays open, keyboard-reachable", async () => {
      mockHostMetrics = makeMetrics();
      mockDaemonVersion = "0.9.3";
      renderBar({ window: makeWindowWithPanes(), server: "alpha" });
      fireEvent.click(screen.getByTestId("status-bar-overflow"));
      const menu = screen.getByRole("menu", { name: "Overflow status segments" });

      // Roving focus lands on the first row — the git COPY row, a real button
      // (natively Enter/Space activatable — Constitution V).
      const gitRow = within(menu).getByRole("menuitem", { name: "Copy git branch" });
      await waitFor(() => expect(document.activeElement).toBe(gitRow));
      expect(gitRow.tagName).toBe("BUTTON");

      // The cwd row displays the basename but copies the FULL path; the row's
      // register key swaps to copied ✓ and the menu does NOT close.
      const cwdRow = within(menu).getByRole("menuitem", { name: "Copy working directory path" });
      fireEvent.click(cwdRow);
      expect(mockCopyToClipboard).toHaveBeenCalledWith("/home/user/code/run-kit");
      expect(cwdRow).toHaveTextContent("copied ✓ run-kit");
      expect(screen.getByRole("menu", { name: "Overflow status segments" })).toBeInTheDocument();

      // Version row copies the displayed v… string.
      fireEvent.click(within(menu).getByRole("menuitem", { name: "Copy version" }));
      expect(mockCopyToClipboard).toHaveBeenCalledWith("v0.9.3");

      // Metrics rows mirror the strip's passive segments: informational spans.
      const ldRow = Array.from(menu.querySelectorAll<HTMLElement>("[role='menuitem']")).find((el) =>
        el.textContent?.startsWith("ld "),
      );
      expect(ldRow?.tagName).toBe("SPAN");
    });
  });
});

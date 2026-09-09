import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { ClockPanel, ClockStaleWarning } from "./clock-panel";
import { FLYOUT_OPEN_DELAY_MS, resetFlyoutWarmState } from "./row-flyout-card";
import { ToastProvider } from "@/components/toast";
import { getCron, muteCron, deleteCron, type CronEntry } from "@/api/client";
import { stubMatchMedia } from "@/test-utils/match-media";
import { makeSession } from "@/test-utils/fixtures";

vi.mock("@/api/client", () => ({
  getCron: vi.fn(),
  muteCron: vi.fn().mockResolvedValue({ ok: true }),
  deleteCron: vi.fn().mockResolvedValue({ ok: true }),
}));

// ClockPanel reads the server's sessions slice for its SSE-tick re-fetch
// signal; the standalone map below is that slice's whole surface here.
let sessionsByServer: Map<string, ReturnType<typeof makeSession>[]> = new Map();
vi.mock("@/contexts/session-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/contexts/session-context")>();
  return {
    ...actual,
    useSessionContext: () => ({ sessionsByServer }),
  };
});

const mockGetCron = vi.mocked(getCron);
const mockMuteCron = vi.mocked(muteCron);
const mockDeleteCron = vi.mocked(deleteCron);

/** Wrap a bare entries array into the `getCron` response shape (`deliveries`
 *  is irrelevant to ClockPanel — always empty here). */
function asCronResponse(entries: CronEntry[]) {
  return { entries, deliveries: [] };
}

function makeEntry(overrides: Partial<CronEntry> = {}): CronEntry {
  return {
    id: "a1b2",
    name: "watch-main",
    schedule: { kind: "every", interval: "5m" },
    target: { kind: "role", role: "operator" },
    payload: "tick",
    lastFired: 0,
    ...overrides,
  };
}

function renderPanel(server: string | null = "primary") {
  return render(
    <ToastProvider>
      <ClockPanel server={server} />
    </ToastProvider>,
  );
}

/** Flush the pending fetch promise (microtasks run even under fake timers). */
async function flushFetch() {
  await act(async () => {});
}

beforeEach(() => {
  vi.useFakeTimers();
  resetFlyoutWarmState();
  localStorage.clear();
  sessionsByServer = new Map();
  mockGetCron.mockReset().mockResolvedValue({ entries: [], deliveries: [] });
  mockMuteCron.mockClear();
  mockDeleteCron.mockClear();
  // Fine pointer — the flyout's hover/focus triggers are active.
  stubMatchMedia();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetFlyoutWarmState();
  localStorage.clear();
});

describe("ClockPanel", () => {
  it("renders the empty state when the server has no entries", async () => {
    renderPanel();
    await flushFetch();
    expect(screen.getByText("No cron entries")).toBeInTheDocument();
  });

  it("renders the empty state WITHOUT fetching on the board route (server null)", async () => {
    renderPanel(null);
    await flushFetch();
    expect(screen.getByText("No cron entries")).toBeInTheDocument();
    expect(mockGetCron).not.toHaveBeenCalled();
  });

  it("renders one condensed row per entry: name, target chip, rung (backoff only), next fire", async () => {
    vi.setSystemTime(new Date("2026-09-07T12:00:00Z"));
    mockGetCron.mockResolvedValue(
      asCronResponse([
        makeEntry({
          id: "a1b2",
          name: "watch-main",
          schedule: { kind: "backoff", min: "1m", max: "30m" },
          rung: 2,
          nextFire: Math.floor(Date.now() / 1000) + 300, // 5m ahead
        }),
        makeEntry({
          id: "c3d4",
          name: "nightly",
          schedule: { kind: "cron", expr: "0 0 * * *" },
          target: { kind: "session", session: "main" },
          rung: undefined,
          nextFire: undefined,
        }),
      ]),
    );
    renderPanel();
    await flushFetch();

    const rows = screen.getAllByTestId("clock-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("watch-main");
    expect(rows[0]).toHaveTextContent("role: operator");
    expect(rows[0]).toHaveTextContent("rung 2");
    expect(rows[0]).toHaveTextContent("in 5m");
    // Non-backoff entry: no rung; absent nextFire renders the dash.
    expect(rows[1]).toHaveTextContent("session: main");
    expect(rows[1]).not.toHaveTextContent("rung");
    expect(rows[1]).toHaveTextContent("—");
    expect(mockGetCron).toHaveBeenCalledWith("primary");
  });

  it("dims and badges orphaned/muted rows", async () => {
    mockGetCron.mockResolvedValue(
      asCronResponse([
        makeEntry({ id: "a1b2", name: "gone-target", orphaned: true }),
        makeEntry({ id: "c3d4", name: "quiet", muted: true }),
        makeEntry({ id: "e5f6", name: "live" }),
      ]),
    );
    renderPanel();
    await flushFetch();

    const [orphaned, muted, live] = screen.getAllByTestId("clock-row");
    expect(orphaned.className).toContain("opacity-50");
    expect(orphaned).toHaveTextContent("orphaned");
    expect(muted.className).toContain("opacity-50");
    expect(muted).toHaveTextContent("muted");
    expect(live.className).not.toContain("opacity-50");
  });

  it("renders the lease remaining in the muted badge (as-of-fetch, like `in Ns`)", async () => {
    vi.setSystemTime(new Date("2026-09-07T12:00:00Z"));
    mockGetCron.mockResolvedValue(
      asCronResponse([
        makeEntry({
          id: "a1b2",
          name: "leased",
          muted: true,
          mutedUntil: Math.floor(Date.now() / 1000) + 240,
        }),
      ]),
    );
    renderPanel();
    await flushFetch();

    const row = screen.getByTestId("clock-row");
    expect(row).toHaveTextContent("muted 4m");
    expect(row.className).toContain("opacity-50");
  });

  it("renders the plain muted badge for an indefinite mute (no live mutedUntil)", async () => {
    mockGetCron.mockResolvedValue(asCronResponse([makeEntry({ id: "a1b2", muted: true })]));
    renderPanel();
    await flushFetch();

    const row = screen.getByTestId("clock-row");
    expect(row).toHaveTextContent("muted");
    expect(row).not.toHaveTextContent(/muted \d/);
    expect(row.className).toContain("opacity-50");
  });

  it("renders no badge for an expired lease — the server already reports muted:false", async () => {
    vi.setSystemTime(new Date("2026-09-07T12:00:00Z"));
    mockGetCron.mockResolvedValue(
      asCronResponse([
        makeEntry({
          id: "a1b2",
          name: "lapsed",
          muted: false,
          mutedUntil: Math.floor(Date.now() / 1000) - 60,
        }),
      ]),
    );
    renderPanel();
    await flushFetch();

    const row = screen.getByTestId("clock-row");
    expect(row).not.toHaveTextContent("muted");
    expect(row.className).not.toContain("opacity-50");
  });

  it("re-fetches when the server's sessions slice changes identity (the SSE tick signal)", async () => {
    const sessions = [makeSession({ name: "main" })];
    sessionsByServer = new Map([["primary", sessions]]);
    const { rerender } = renderPanel();
    await flushFetch();
    expect(mockGetCron).toHaveBeenCalledTimes(1);

    // An SSE rebroadcast (e.g. after a cron mutation's hub wake) publishes a
    // NEW slice identity — the panel re-fetches without any polling.
    sessionsByServer = new Map([["primary", [...sessions]]]);
    rerender(
      <ToastProvider>
        <ClockPanel server="primary" />
      </ToastProvider>,
    );
    await flushFetch();
    expect(mockGetCron).toHaveBeenCalledTimes(2);
  });

  describe("row flyout actions", () => {
    async function renderAndOpen(entry: CronEntry) {
      mockGetCron.mockResolvedValue(asCronResponse([entry]));
      renderPanel();
      await flushFetch();
      const row = screen.getByTestId("clock-row");
      act(() => {
        fireEvent.pointerEnter(row, { pointerType: "mouse" });
        fireEvent.mouseEnter(row);
        vi.advanceTimersByTime(FLYOUT_OPEN_DELAY_MS + 50);
      });
      expect(screen.getByTestId("row-flyout-card")).toBeInTheDocument();
    }

    it("Mute posts the mute mutation for an unmuted entry", async () => {
      await renderAndOpen(makeEntry({ id: "a1b2", muted: false }));
      fireEvent.click(screen.getByTestId("row-flyout-mute-action"));
      expect(mockMuteCron).toHaveBeenCalledWith("primary", "a1b2", true);
    });

    it("Unmute posts muted:false for an already-muted entry", async () => {
      await renderAndOpen(makeEntry({ id: "a1b2", muted: true }));
      fireEvent.click(screen.getByTestId("row-flyout-mute-action"));
      expect(mockMuteCron).toHaveBeenCalledWith("primary", "a1b2", false);
    });

    it("Unmute posts muted:false for a leased entry (clears flag and lease)", async () => {
      vi.setSystemTime(new Date("2026-09-07T12:00:00Z"));
      await renderAndOpen(
        makeEntry({ id: "a1b2", muted: true, mutedUntil: Math.floor(Date.now() / 1000) + 240 }),
      );
      expect(screen.getByTestId("row-flyout-mute-action")).toHaveTextContent("Unmute");
      fireEvent.click(screen.getByTestId("row-flyout-mute-action"));
      expect(mockMuteCron).toHaveBeenCalledWith("primary", "a1b2", false);
    });

    it("Delete posts the delete mutation", async () => {
      await renderAndOpen(makeEntry({ id: "a1b2" }));
      fireEvent.click(screen.getByTestId("row-flyout-delete-action"));
      expect(mockDeleteCron).toHaveBeenCalledWith("primary", "a1b2");
    });
  });
});

describe("ClockStaleWarning", () => {
  it("renders the warning strip when a session carries the server-derived operatorStale flag", () => {
    vi.setSystemTime(new Date("2026-09-07T12:00:00Z"));
    const sessions = [
      makeSession({
        name: "main",
        operatorStale: true,
        operatorLastTickAt: Math.floor(Date.now() / 1000) - 20 * 60,
      }),
    ];
    render(<ClockStaleWarning sessions={sessions} />);
    expect(screen.getByTestId("clock-header-stale-warning")).toHaveTextContent("⚠ operator stale");
  });

  it("renders nothing when no session is stale", () => {
    render(<ClockStaleWarning sessions={[makeSession({ name: "main" })]} />);
    expect(screen.queryByTestId("clock-header-stale-warning")).toBeNull();
  });
});

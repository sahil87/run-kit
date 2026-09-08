import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { CronActivityFeed } from "./cron-activity-feed";
import { StandaloneSessionContextProvider } from "@/contexts/session-context";
import type { ProjectSession } from "@/types";
import type { CronEntry, CronListResponse } from "@/api/client";

const SERVER = "srv";

// Timestamps are derived from the REAL clock at setup (no fake timers — they
// stall Testing Library's async queries), rounded off unit boundaries so
// formatDuration output is stable.
const NOW_SEC = Math.floor(Date.now() / 1000);

const ENTRIES: CronEntry[] = [
  {
    id: "soon",
    name: "soon job",
    schedule: { kind: "every", interval: "10m" },
    target: { kind: "role", role: "operator" },
    payload: "p",
    lastFired: 0,
    nextFire: NOW_SEC + 300,
  },
  {
    id: "late",
    name: "late job",
    schedule: { kind: "every", interval: "1h" },
    target: { kind: "role", role: "operator" },
    payload: "p",
    lastFired: 0,
    nextFire: NOW_SEC + 7200,
  },
  {
    id: "mute",
    name: "muted job",
    schedule: { kind: "every", interval: "5m" },
    target: { kind: "role", role: "operator" },
    payload: "p",
    muted: true,
    lastFired: 0,
    nextFire: NOW_SEC + 60,
  },
  {
    id: "orph",
    name: "orphan job",
    schedule: { kind: "backoff", min: "60s", max: "30m" },
    target: { kind: "role", role: "operator" },
    payload: "p",
    orphaned: true,
    lastFired: 0,
  },
  {
    id: "crn",
    name: "cron job",
    schedule: { kind: "cron", expr: "0 * * * *" },
    target: { kind: "role", role: "operator" },
    payload: "p",
    lastFired: 0,
    nextFire: NOW_SEC + 1800,
  },
];

const CRON_RESPONSE: CronListResponse = {
  entries: ENTRIES,
  deliveries: [
    { ts: NOW_SEC - 540, entry: "soon", name: "soon job", target: "%1", reason: "schedule", outcome: "delivered" },
    { ts: NOW_SEC - 9000, entry: "gone", target: "%2", reason: "schedule", outcome: "failed" },
  ],
};

function sessionsPayload(stale: boolean): ProjectSession[] {
  return [
    {
      name: "dev",
      operatorStale: stale,
      operatorLastTickAt: stale ? NOW_SEC - 540 : 0,
      windows: [],
    },
  ];
}

function installFetch(payload: CronListResponse = CRON_RESPONSE) {
  const calls: string[] = [];
  const stub = vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", stub);
  return { stub, calls };
}

function renderFeed(server: string, stale = false) {
  return render(
    <StandaloneSessionContextProvider
      value={{
        currentServer: server || null,
        sessionsByServer: new Map([[server, sessionsPayload(stale)]]),
        isConnectedByServer: new Map([[server, true]]),
      }}
    >
      <CronActivityFeed server={server} />
    </StandaloneSessionContextProvider>,
  );
}

/** Timeline order = DOM order of upcoming rows, the now-divider, and delivery
 *  rows (the sheet/its testids never mount in these tests). */
function timelineOrder(): (string | null)[] {
  const feed = screen.getByTestId("cron-activity-feed");
  return [...feed.querySelectorAll("[data-testid]")]
    .map((el) => el.getAttribute("data-testid"))
    .filter(
      (t) =>
        t !== null &&
        (t.startsWith("cron-upcoming-row-") ||
          t.startsWith("cron-delivery-row-") ||
          t === "cron-activity-now"),
    );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CronActivityFeed", () => {
  it("merges upcoming fires and deliveries around the now-divider (soonest/newest adjacent to it)", async () => {
    installFetch();
    renderFeed(SERVER);
    await screen.findByTestId("cron-upcoming-row-soon");
    // Upcoming: the undated entry (orphan, unresolved backoff anchor) at the
    // far end, then farthest → soonest; then the divider; then deliveries
    // newest-first.
    expect(timelineOrder()).toEqual([
      "cron-upcoming-row-orph",
      "cron-upcoming-row-late",
      "cron-upcoming-row-crn",
      "cron-upcoming-row-soon",
      "cron-upcoming-row-mute",
      "cron-activity-now",
      "cron-delivery-row-soon",
      "cron-delivery-row-gone",
    ]);
  });

  it("dims muted and orphaned rows instead of omitting them", async () => {
    installFetch();
    renderFeed(SERVER);
    const muted = await screen.findByTestId("cron-upcoming-row-mute");
    const orphaned = await screen.findByTestId("cron-upcoming-row-orph");
    expect(muted.className).toContain("opacity-50");
    expect(orphaned.className).toContain("opacity-50");
    expect(screen.getByTestId("cron-upcoming-row-soon").className).not.toContain("opacity-50");
  });

  it("renders the bare expression and a relative next-fire time on a cron-kind row", async () => {
    installFetch();
    renderFeed(SERVER);
    const row = await screen.findByTestId("cron-upcoming-row-crn");
    expect(row).toHaveTextContent("0 * * * *");
    expect(row).not.toHaveTextContent("not yet evaluated");
    expect(row).toHaveTextContent(/in (29|30)m/);
  });

  it("renders the staleness banner only when a session reports operatorStale", async () => {
    installFetch();
    const stale = renderFeed(SERVER, true);
    const banner = await screen.findByTestId("cron-activity-banner");
    expect(banner).toHaveTextContent("operator tick — last seen 9m ago");
    stale.unmount();

    renderFeed(SERVER, false);
    await screen.findByTestId("cron-upcoming-row-soon");
    expect(screen.queryByTestId("cron-activity-banner")).toBeNull();
  });

  it("degrades to the hint state on an unresolvable server and fires no request", async () => {
    const { calls } = installFetch();
    render(
      <StandaloneSessionContextProvider value={{ currentServer: null }}>
        <CronActivityFeed server="" />
      </StandaloneSessionContextProvider>,
    );
    expect(screen.getByTestId("cron-activity-empty")).toHaveTextContent("no server resolved");
    expect(screen.queryByTestId("cron-activity-feed")).toBeNull();
    await waitFor(() => expect(calls).toHaveLength(0));
  });

  it("opens the entry detail sheet when a row is tapped", async () => {
    installFetch();
    renderFeed(SERVER);
    fireEvent.click(await screen.findByTestId("cron-upcoming-row-soon"));
    expect(
      await screen.findByRole("dialog", { name: "Cron entry soon job" }),
    ).toBeInTheDocument();
  });

  it("shows the outcome on delivered rows", async () => {
    installFetch();
    renderFeed(SERVER);
    const delivered = await screen.findByTestId("cron-delivery-row-soon");
    expect(delivered).toHaveTextContent("delivered");
    expect(delivered).toHaveTextContent("9m ago");
    expect(screen.getByTestId("cron-delivery-row-gone")).toHaveTextContent("failed");
  });
});

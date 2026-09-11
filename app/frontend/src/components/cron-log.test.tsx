import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CronLog } from "./cron-log";
import { StandaloneSessionContextProvider } from "@/contexts/session-context";
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
];

const CRON_RESPONSE: CronListResponse = {
  entries: ENTRIES,
  deliveries: [
    { ts: NOW_SEC - 540, entry: "soon", name: "soon job", target: "%1", reason: "schedule", outcome: "delivered" },
    { ts: NOW_SEC - 9000, entry: "gone", target: "%2", reason: "schedule", outcome: "failed" },
  ],
};

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

function renderLog(server: string, inline = false) {
  return render(
    <StandaloneSessionContextProvider
      value={{
        currentServer: server || null,
        sessionsByServer: new Map([[server, []]]),
        isConnectedByServer: new Map([[server, true]]),
      }}
    >
      <CronLog server={server} inline={inline} />
    </StandaloneSessionContextProvider>,
  );
}

function rowOrder(): (string | null)[] {
  const log = screen.getByTestId("cron-log");
  return [...log.querySelectorAll("[data-testid]")]
    .map((el) => el.getAttribute("data-testid"))
    .filter((t) => t !== null && t.startsWith("cron-delivery-row-"));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CronLog", () => {
  it("renders one row per delivery, newest first, with no upcoming rows or divider", async () => {
    installFetch();
    renderLog(SERVER);
    await screen.findByTestId("cron-delivery-row-soon");
    expect(rowOrder()).toEqual(["cron-delivery-row-soon", "cron-delivery-row-gone"]);
    expect(screen.queryByTestId("cron-activity-now")).toBeNull();
    expect(screen.queryByTestId("cron-upcoming-row-soon")).toBeNull();
  });

  it("labels rows by name and outcome, with a relative age", async () => {
    installFetch();
    renderLog(SERVER);
    const delivered = await screen.findByTestId("cron-delivery-row-soon");
    expect(delivered).toHaveTextContent("soon job");
    expect(delivered).toHaveTextContent("delivered");
    expect(delivered).toHaveTextContent("9m ago");
    expect(screen.getByTestId("cron-delivery-row-gone")).toHaveTextContent("failed");
  });

  it("a row whose entry still exists opens the detail sheet; a deleted entry's row is not tappable", async () => {
    installFetch();
    renderLog(SERVER);
    fireEvent.click(await screen.findByTestId("cron-delivery-row-soon"));
    expect(
      await screen.findByRole("dialog", { name: "Cron entry soon job" }),
    ).toBeInTheDocument();
    cleanup();

    installFetch();
    renderLog(SERVER);
    const gone = await screen.findByTestId("cron-delivery-row-gone");
    expect(gone.tagName).not.toBe("BUTTON");
    fireEvent.click(gone);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the single empty line when there are no deliveries", async () => {
    installFetch({ entries: ENTRIES, deliveries: [] });
    renderLog(SERVER);
    expect(await screen.findByTestId("cron-log-empty")).toHaveTextContent(
      "No deliveries yet on srv.",
    );
  });

  it("degrades to the hint state on an unresolvable server and fires no request", async () => {
    const { calls } = installFetch();
    render(
      <StandaloneSessionContextProvider value={{ currentServer: null }}>
        <CronLog server="" />
      </StandaloneSessionContextProvider>,
    );
    expect(screen.getByTestId("cron-log-unresolved")).toHaveTextContent("no server resolved");
    expect(calls).toHaveLength(0);
  });

  it("the inline variant makes the root relative so the sheet anchors in-container", async () => {
    installFetch();
    renderLog(SERVER, true);
    const log = await screen.findByTestId("cron-log");
    expect(log.className).toContain("relative");
  });
});

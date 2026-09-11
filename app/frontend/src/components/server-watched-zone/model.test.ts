import { describe, it, expect } from "vitest";
import { makeSession, makeWindow } from "@/test-utils/fixtures";
import { collectWatchedRows, watchlistStatus } from "./model";

const NOW = 1_800_000_000;

describe("collectWatchedRows", () => {
  it("collects one row per monitored window, ordered by session order then window index", () => {
    const sessions = [
      makeSession({
        name: "dev",
        windows: [
          makeWindow({ windowId: "@2", index: 2, monitored: true }),
          makeWindow({ windowId: "@1", index: 1, monitored: true }),
          makeWindow({ windowId: "@3", index: 3 }),
        ],
      }),
      makeSession({
        name: "ops",
        windows: [makeWindow({ windowId: "@4", index: 0, monitored: true })],
      }),
    ];
    expect(collectWatchedRows(sessions).map((r) => [r.session, r.win.windowId])).toEqual([
      ["dev", "@1"],
      ["dev", "@2"],
      ["ops", "@4"],
    ]);
  });

  it("excludes ghost windows and non-monitored windows", () => {
    const ghost = Object.assign(makeWindow({ windowId: "", monitored: true }), {
      optimistic: true,
      optimisticId: "g1",
    });
    const rows = collectWatchedRows([
      makeSession({ windows: [ghost, makeWindow({ windowId: "@1" })] }),
    ]);
    expect(rows).toEqual([]);
  });

  it("requires monitored === true exactly", () => {
    const rows = collectWatchedRows([
      makeSession({
        windows: [
          makeWindow({ windowId: "@1", monitored: false }),
          makeWindow({ windowId: "@2", monitored: true }),
        ],
      }),
    ]);
    expect(rows.map((r) => r.win.windowId)).toEqual(["@2"]);
  });
});

describe("watchlistStatus", () => {
  it("stale is any session's operatorStale; tickAgeSeconds is now minus the max tick", () => {
    const status = watchlistStatus(
      [
        makeSession({ operatorLastTickAt: NOW - 120 }),
        makeSession({ operatorLastTickAt: NOW - 30, operatorStale: true }),
      ],
      NOW,
    );
    expect(status).toEqual({ stale: true, tickAgeSeconds: 30, hasOperator: true });
  });

  it("tickAgeSeconds is null when no session carries a tick", () => {
    const status = watchlistStatus([makeSession({ windows: [] })], NOW);
    expect(status.stale).toBe(false);
    expect(status.tickAgeSeconds).toBeNull();
    expect(status.hasOperator).toBe(false);
  });

  it("hasOperator reads an operator-role window even without a tick", () => {
    const status = watchlistStatus(
      [makeSession({ windows: [makeWindow({ role: "operator" })] })],
      NOW,
    );
    expect(status).toEqual({ stale: false, tickAgeSeconds: null, hasOperator: true });
  });

  it("clamps a future tick to age 0", () => {
    const status = watchlistStatus([makeSession({ operatorLastTickAt: NOW + 60 })], NOW);
    expect(status.tickAgeSeconds).toBe(0);
    expect(status.hasOperator).toBe(true);
  });
});

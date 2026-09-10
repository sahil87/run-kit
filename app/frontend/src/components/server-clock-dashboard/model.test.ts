import { describe, it, expect } from "vitest";
import type { CronDelivery, CronEntry } from "@/api/client";
import { makeSession, makeWindow, makeWindowWithPanes } from "@/test-utils/fixtures";
import {
  cronStateLabel,
  describeOutcome,
  formatClockTime,
  groupDeliveriesByDay,
  resolveTargetWindow,
  sortCronEntries,
  targetChip,
} from "./model";

const NOW = 1_800_000_000;

function makeEntry(overrides: Partial<CronEntry> = {}): CronEntry {
  return {
    id: "aaaa",
    schedule: { kind: "every", interval: "1h" },
    target: { kind: "role", role: "operator" },
    payload: "tick",
    lastFired: 0,
    ...overrides,
  };
}

function makeDelivery(overrides: Partial<CronDelivery> = {}): CronDelivery {
  return {
    ts: NOW,
    entry: "aaaa",
    target: "%1",
    reason: "schedule",
    outcome: "delivered",
    ...overrides,
  };
}

describe("targetChip", () => {
  it("renders the first target facet, else the bare kind", () => {
    expect(targetChip(makeEntry({ target: { kind: "role", role: "operator" } }))).toBe(
      "role: operator",
    );
    expect(targetChip(makeEntry({ target: { kind: "session", session: "foo" } }))).toBe(
      "session: foo",
    );
    expect(targetChip(makeEntry({ target: { kind: "pane", pane: "%3" } }))).toBe("pane: %3");
    expect(targetChip(makeEntry({ target: { kind: "role" } }))).toBe("role");
  });
});

describe("sortCronEntries", () => {
  it("orders due → scheduled (nextFire asc) → undated → orphaned → muted", () => {
    const a = makeEntry({ id: "a", name: "A", nextFire: NOW + 300 });
    const b = makeEntry({ id: "b", name: "B", nextFire: NOW - 60 });
    const c = makeEntry({ id: "c", name: "C", muted: true, nextFire: NOW + 120 });
    const d = makeEntry({ id: "d", name: "D", orphaned: true });
    const e = makeEntry({ id: "e", name: "E" });
    expect(sortCronEntries([a, b, c, d, e], NOW).map((x) => x.id)).toEqual([
      "b",
      "a",
      "e",
      "d",
      "c",
    ]);
  });

  it("sorts scheduled entries by ascending nextFire and undated by name", () => {
    const later = makeEntry({ id: "l", name: "later", nextFire: NOW + 900 });
    const sooner = makeEntry({ id: "s", name: "sooner", nextFire: NOW + 60 });
    const zebra = makeEntry({ id: "z", name: "zebra" });
    const apple = makeEntry({ id: "ap", name: "apple" });
    expect(sortCronEntries([later, sooner, zebra, apple], NOW).map((x) => x.id)).toEqual([
      "s",
      "l",
      "ap",
      "z",
    ]);
  });

  it("lands a muted+orphaned entry in the orphaned bucket", () => {
    const both = makeEntry({ id: "both", name: "aaa", muted: true, orphaned: true });
    const orphaned = makeEntry({ id: "orphan", name: "zzz", orphaned: true });
    const muted = makeEntry({ id: "muted", name: "aaa", muted: true });
    expect(sortCronEntries([both, orphaned, muted], NOW).map((x) => x.id)).toEqual([
      "both",
      "orphan",
      "muted",
    ]);
  });
});

describe("cronStateLabel", () => {
  const operatorIdle = makeSession({
    windows: [makeWindow({ role: "operator", agentState: "idle" })],
  });
  const operatorBusy = makeSession({
    windows: [makeWindow({ role: "operator", agentState: "active" })],
  });

  it("prioritizes orphaned over every other state", () => {
    const entry = makeEntry({ orphaned: true, muted: true, nextFire: NOW - 60 });
    expect(cronStateLabel(entry, [], NOW)).toBe("orphaned");
  });

  it("renders an orphan's TTL as `orphaned · expires <remaining>`, bare `orphaned` once past", () => {
    expect(cronStateLabel(makeEntry({ orphaned: true, expiresAt: NOW + 7200 }), [], NOW)).toBe(
      "orphaned · expires 2h",
    );
    expect(cronStateLabel(makeEntry({ orphaned: true, expiresAt: NOW - 5 }), [], NOW)).toBe("orphaned");
  });

  it("renders a live mute lease as `muted <remaining>`, an indefinite one as `muted`", () => {
    expect(
      cronStateLabel(makeEntry({ muted: true, mutedUntil: NOW + 300 }), [], NOW),
    ).toBe("muted 5m");
    expect(cronStateLabel(makeEntry({ muted: true }), [], NOW)).toBe("muted");
  });

  it("never renders a negative lease for an expired mutedUntil", () => {
    expect(
      cronStateLabel(makeEntry({ muted: true, mutedUntil: NOW - 5 }), [], NOW),
    ).toBe("muted");
  });

  it("reads `held (busy)` for a past-due when-idle entry whose target is active", () => {
    const entry = makeEntry({ deliver: "when-idle", nextFire: NOW - 30 });
    expect(cronStateLabel(entry, [operatorBusy], NOW)).toBe("held (busy)");
  });

  it("reads `due` for the same entry when the target is idle or unresolvable", () => {
    const entry = makeEntry({ deliver: "when-idle", nextFire: NOW - 30 });
    expect(cronStateLabel(entry, [operatorIdle], NOW)).toBe("due");
    expect(cronStateLabel(entry, [], NOW)).toBe("due");
  });

  it("reads `due` for any past-due entry and `rung N` for a scheduled backoff", () => {
    expect(cronStateLabel(makeEntry({ nextFire: NOW - 1 }), [], NOW)).toBe("due");
    expect(
      cronStateLabel(
        makeEntry({
          schedule: { kind: "backoff", min: "60s", max: "30m" },
          nextFire: NOW + 300,
          rung: 3,
        }),
        [],
        NOW,
      ),
    ).toBe("rung 3");
  });

  it("reads `—` for a scheduled non-backoff entry with no state", () => {
    expect(cronStateLabel(makeEntry({ nextFire: NOW + 300 }), [], NOW)).toBe("—");
  });
});

describe("resolveTargetWindow", () => {
  it("resolves a role target to the window carrying that role", () => {
    const operator = makeWindow({ windowId: "@9", role: "operator" });
    const sessions = [
      makeSession({ windows: [makeWindow({ windowId: "@1" })] }),
      makeSession({ name: "ops", windows: [operator] }),
    ];
    expect(resolveTargetWindow(makeEntry(), sessions)?.windowId).toBe("@9");
  });

  it("resolves a session target via the window's agent session ref", () => {
    const win = makeWindow({ windowId: "@2", agentSessionRef: "4fe2" });
    const sessions = [makeSession({ windows: [win] })];
    const entry = makeEntry({ target: { kind: "session", session: "4fe2" } });
    expect(resolveTargetWindow(entry, sessions)?.windowId).toBe("@2");
  });

  it("falls back to the named session's active window (else its first)", () => {
    const first = makeWindow({ windowId: "@3" });
    const active = makeWindow({ windowId: "@4", isActiveWindow: true });
    const sessions = [makeSession({ name: "dev", windows: [first, active] })];
    const entry = makeEntry({ target: { kind: "session", session: "dev" } });
    expect(resolveTargetWindow(entry, sessions)?.windowId).toBe("@4");
  });

  it("resolves a pane target to the window holding that pane", () => {
    const win = makeWindowWithPanes({ windowId: "@5" });
    const sessions = [makeSession({ windows: [win] })];
    const entry = makeEntry({ target: { kind: "pane", pane: "%5" } });
    expect(resolveTargetWindow(entry, sessions)?.windowId).toBe("@5");
  });

  it("returns undefined when nothing resolves", () => {
    expect(resolveTargetWindow(makeEntry(), [])).toBeUndefined();
    expect(
      resolveTargetWindow(makeEntry({ target: { kind: "pane", pane: "%99" } }), [
        makeSession(),
      ]),
    ).toBeUndefined();
    expect(
      resolveTargetWindow(makeEntry({ target: { kind: "unknown-kind" } }), [makeSession()]),
    ).toBeUndefined();
  });
});

describe("describeOutcome", () => {
  it("maps the known outcomes to their display labels", () => {
    expect(describeOutcome("delivered")).toEqual({ label: "delivered ✓", error: false });
    expect(describeOutcome("skipped-absent")).toEqual({
      label: "skipped (absent)",
      error: false,
    });
    expect(describeOutcome("notified-absent")).toEqual({
      label: "notified (absent)",
      error: false,
    });
  });

  it("passes neutral outcomes through verbatim without the error color", () => {
    for (const outcome of ["held-expired", "rate-capped", "missed", "respawned", "expired-orphan"]) {
      expect(describeOutcome(outcome)).toEqual({ label: outcome, error: false });
    }
  });

  it("marks failure outcomes verbatim with the error color", () => {
    expect(describeOutcome("respawn-failed: exit 1")).toEqual({
      label: "respawn-failed: exit 1",
      error: true,
    });
    expect(describeOutcome("failed: timeout")).toEqual({ label: "failed: timeout", error: true });
  });

  it("passes an unknown outcome through verbatim, uncolored", () => {
    expect(describeOutcome("something-new")).toEqual({ label: "something-new", error: false });
  });
});

describe("formatClockTime", () => {
  it("renders local HH:MM, zero-padded, 24h", () => {
    const ts = new Date(2026, 8, 10, 9, 5, 30).getTime() / 1000;
    expect(formatClockTime(ts)).toBe("09:05");
    const evening = new Date(2026, 8, 10, 23, 50, 0).getTime() / 1000;
    expect(formatClockTime(evening)).toBe("23:50");
  });
});

describe("groupDeliveriesByDay", () => {
  // All dates built via local Date constructors, so the assertions are
  // timezone-independent.
  const now = new Date(2026, 8, 10, 12, 0, 0).getTime();
  const todayTs = new Date(2026, 8, 10, 14, 2, 0).getTime() / 1000 - 7200; // 12:02 local
  const todayEarlier = new Date(2026, 8, 10, 9, 30, 0).getTime() / 1000;
  const yesterdayTs = new Date(2026, 8, 9, 23, 50, 0).getTime() / 1000;
  const olderTs = new Date(2026, 8, 1, 8, 0, 0).getTime() / 1000;

  it("groups consecutive same-day rows under today/yesterday/YYYY-MM-DD labels", () => {
    const groups = groupDeliveriesByDay(
      [
        makeDelivery({ ts: todayTs }),
        makeDelivery({ ts: todayEarlier }),
        makeDelivery({ ts: yesterdayTs }),
        makeDelivery({ ts: olderTs }),
      ],
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(["today", "yesterday", "2026-09-01"]);
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[0].rows.map((r) => r.ts)).toEqual([todayTs, todayEarlier]);
  });

  it("keeps a single-day log in one group", () => {
    const groups = groupDeliveriesByDay(
      [makeDelivery({ ts: todayTs }), makeDelivery({ ts: todayEarlier })],
      now,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("today");
  });

  it("returns no groups for an empty log", () => {
    expect(groupDeliveriesByDay([], now)).toEqual([]);
  });
});

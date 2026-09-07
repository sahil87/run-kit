import { describe, expect, it } from "vitest";
import { describeSchedule, humanizeDuration } from "./cron-schedule";

describe("humanizeDuration", () => {
  it.each([
    ["60s", "1 minute"],
    ["1s", "1 second"],
    ["45s", "45 seconds"],
    ["30m", "30 minutes"],
    ["1m", "1 minute"],
    ["1h", "1 hour"],
    ["2h", "2 hours"],
    ["90m", "1 hour 30 minutes"],
    ["1h30m", "1 hour 30 minutes"],
    ["90s", "1 minute 30 seconds"],
    ["24h", "24 hours"],
    ["500ms", "less than 1 second"],
    ["250us", "less than 1 second"],
  ])("humanizes %s as %s", (raw, expected) => {
    expect(humanizeDuration(raw)).toBe(expected);
  });

  it("passes unparseable input through verbatim", () => {
    expect(humanizeDuration("hourly")).toBe("hourly");
    expect(humanizeDuration("")).toBe("");
  });
});

describe("describeSchedule", () => {
  it('describes {kind:"every"} as "every {duration}"', () => {
    expect(describeSchedule({ schedule: { kind: "every", interval: "1h" } })).toBe("every hour");
    expect(describeSchedule({ schedule: { kind: "every", interval: "30m" } })).toBe(
      "every 30 minutes",
    );
    expect(describeSchedule({ schedule: { kind: "every", interval: "60s" } })).toBe(
      "every minute",
    );
  });

  it("describes a backoff schedule as a range since last activity", () => {
    expect(
      describeSchedule({ schedule: { kind: "backoff", min: "60s", max: "30m" } }),
    ).toBe("backs off from 1 minute up to 30 minutes since last activity");
  });

  it("describes a cron-kind entry as the raw expression plus a not-yet-evaluated note", () => {
    expect(describeSchedule({ schedule: { kind: "cron", expr: "0 * * * *" } })).toBe(
      "0 * * * * — cron expression, not yet evaluated",
    );
    expect(describeSchedule({ schedule: { kind: "cron" } })).toBe(
      "cron expression, not yet evaluated",
    );
  });

  it("includes wakeOn when present", () => {
    expect(
      describeSchedule({
        schedule: { kind: "every", interval: "1h" },
        wakeOn: { event: "session-change" },
      }),
    ).toBe("every hour; wakes on session-change");
  });

  it("renders an unknown kind without fabricating a phrasing", () => {
    expect(describeSchedule({ schedule: { kind: "weird" } })).toBe("unknown schedule (weird)");
  });
});

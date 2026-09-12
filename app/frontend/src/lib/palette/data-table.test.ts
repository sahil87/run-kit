import { describe, it, expect, vi } from "vitest";
import { buildDataTableActions } from "./data-table";

const TABLES = [
  { id: "watched", label: "Watched" },
  { id: "cron-list", label: "Cron List" },
  { id: "cron-log", label: "Cron Log" },
];

describe("buildDataTableActions", () => {
  it("omits the action entirely with no mounted table", () => {
    expect(buildDataTableActions([])).toEqual([]);
  });

  it("resets the one mounted table directly on select", () => {
    const reset = vi.fn();
    const actions = buildDataTableActions([TABLES[1]!], reset);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ id: "table-reset-columns", label: "Table: Reset columns" });
    expect(actions[0]!.optionPicker).toBeUndefined();
    actions[0]!.onSelect();
    expect(reset).toHaveBeenCalledWith("cron-list");
  });

  it("offers an optionPicker over every mounted table when two or more are mounted", () => {
    const reset = vi.fn();
    const actions = buildDataTableActions(TABLES, reset);
    expect(actions).toHaveLength(1);
    const action = actions[0]!;
    expect(action.label).toBe("Table: Reset columns…");
    expect(action.optionPicker?.options).toEqual([
      { key: "watched", label: "Watched" },
      { key: "cron-list", label: "Cron List" },
      { key: "cron-log", label: "Cron Log" },
    ]);
    action.optionPicker?.onApply(["watched", "cron-log"]);
    expect(reset).toHaveBeenCalledWith("watched");
    expect(reset).toHaveBeenCalledWith("cron-log");
    expect(reset).toHaveBeenCalledTimes(2);
  });

  it("defaults the reset to the real store function", () => {
    const actions = buildDataTableActions([TABLES[0]!]);
    expect(() => actions[0]!.onSelect()).not.toThrow();
  });
});

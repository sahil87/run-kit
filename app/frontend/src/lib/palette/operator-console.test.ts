import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOperatorConsoleAction,
  buildOperatorConsoleListAction,
  buildOperatorConsoleLogAction,
  buildOperatorConsoleTasksAction,
} from "./operator-console";
import { OPERATOR_CONSOLE_EVENT, isOperatorConsoleRequest } from "@/lib/operator-console";

describe("buildOperatorConsoleAction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the registry actionId so the effective-chord hint attaches", () => {
    const action = buildOperatorConsoleAction();
    expect(action.id).toBe("operator-console");
    expect(action.label).toBe("Operator: Open console");
  });

  it("dispatches the console open (open+focused) through the document-event seam", () => {
    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent<unknown>).detail);
    document.addEventListener(OPERATOR_CONSOLE_EVENT, listener);
    try {
      buildOperatorConsoleAction().onSelect();
    } finally {
      document.removeEventListener(OPERATOR_CONSOLE_EVENT, listener);
    }
    expect(seen).toHaveLength(1);
    expect(isOperatorConsoleRequest(seen[0])).toBe(true);
    expect(seen[0]).toEqual({ action: "open" });
  });
});

describe.each([
  {
    build: buildOperatorConsoleListAction,
    id: "operator-console-list",
    label: "Operator: Show cron list",
    segment: "list",
  },
  {
    build: buildOperatorConsoleLogAction,
    id: "operator-console-log",
    label: "Operator: Show cron log",
    segment: "log",
  },
])("the cron-segment entry $label", ({ build, id, label, segment }) => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is the chord-less palette entry", () => {
    const action = build();
    expect(action).toMatchObject({ id, label });
    expect(action.shortcut).toBeUndefined();
  });

  it(`onSelect dispatches the seam event with segment: ${segment}`, () => {
    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent<unknown>).detail);
    document.addEventListener(OPERATOR_CONSOLE_EVENT, listener);
    try {
      build().onSelect();
    } finally {
      document.removeEventListener(OPERATOR_CONSOLE_EVENT, listener);
    }
    expect(seen).toHaveLength(1);
    expect(isOperatorConsoleRequest(seen[0])).toBe(true);
    expect(seen[0]).toEqual({ action: "open", segment });
  });
});

describe("buildOperatorConsoleTasksAction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is the chord-less Operator: Show tasks entry", () => {
    const action = buildOperatorConsoleTasksAction();
    expect(action).toMatchObject({
      id: "operator-console-tasks",
      label: "Operator: Show tasks",
    });
    expect(action.shortcut).toBeUndefined();
  });

  it("onSelect dispatches the seam event with segment: tasks", () => {
    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent<unknown>).detail);
    document.addEventListener(OPERATOR_CONSOLE_EVENT, listener);
    try {
      buildOperatorConsoleTasksAction().onSelect();
    } finally {
      document.removeEventListener(OPERATOR_CONSOLE_EVENT, listener);
    }
    expect(seen).toHaveLength(1);
    expect(isOperatorConsoleRequest(seen[0])).toBe(true);
    expect(seen[0]).toEqual({ action: "open", segment: "tasks" });
  });
});

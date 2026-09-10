import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOperatorConsoleAction, buildOperatorConsoleActivityAction } from "./operator-console";
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

describe("buildOperatorConsoleActivityAction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is the chord-less Operator: Show clock activity entry", () => {
    const action = buildOperatorConsoleActivityAction();
    expect(action).toMatchObject({
      id: "operator-console-activity",
      label: "Operator: Show clock activity",
    });
    expect(action.shortcut).toBeUndefined();
  });

  it("onSelect dispatches the seam event with segment: activity", () => {
    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent<unknown>).detail);
    document.addEventListener(OPERATOR_CONSOLE_EVENT, listener);
    try {
      buildOperatorConsoleActivityAction().onSelect();
    } finally {
      document.removeEventListener(OPERATOR_CONSOLE_EVENT, listener);
    }
    expect(seen).toHaveLength(1);
    expect(isOperatorConsoleRequest(seen[0])).toBe(true);
    expect(seen[0]).toEqual({ action: "open", segment: "activity" });
  });
});

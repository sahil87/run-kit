import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOperatorConsoleAction } from "./operator-console";
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

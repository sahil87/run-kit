import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildQuakeTerminalAction,
  buildQuakeTerminalListAction,
  buildQuakeTerminalLogAction,
  buildQuakeTerminalTasksAction,
} from "./quake-terminal";
import { QUAKE_TERMINAL_EVENT, isQuakeTerminalRequest } from "@/lib/quake-terminal";

describe("buildQuakeTerminalAction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the registry actionId so the effective-chord hint attaches", () => {
    const action = buildQuakeTerminalAction();
    expect(action.id).toBe("quake-terminal");
    expect(action.label).toBe("Operator: Open quake terminal");
  });

  it("dispatches the quake terminal open (open+focused) through the document-event seam", () => {
    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent<unknown>).detail);
    document.addEventListener(QUAKE_TERMINAL_EVENT, listener);
    try {
      buildQuakeTerminalAction().onSelect();
    } finally {
      document.removeEventListener(QUAKE_TERMINAL_EVENT, listener);
    }
    expect(seen).toHaveLength(1);
    expect(isQuakeTerminalRequest(seen[0])).toBe(true);
    expect(seen[0]).toEqual({ action: "open" });
  });
});

describe.each([
  {
    build: buildQuakeTerminalListAction,
    id: "quake-terminal-list",
    label: "Operator: Show cron list",
    segment: "list",
  },
  {
    build: buildQuakeTerminalLogAction,
    id: "quake-terminal-log",
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
    document.addEventListener(QUAKE_TERMINAL_EVENT, listener);
    try {
      build().onSelect();
    } finally {
      document.removeEventListener(QUAKE_TERMINAL_EVENT, listener);
    }
    expect(seen).toHaveLength(1);
    expect(isQuakeTerminalRequest(seen[0])).toBe(true);
    expect(seen[0]).toEqual({ action: "open", segment });
  });
});

describe("buildQuakeTerminalTasksAction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is the chord-less Operator: Show tasks entry", () => {
    const action = buildQuakeTerminalTasksAction();
    expect(action).toMatchObject({
      id: "quake-terminal-tasks",
      label: "Operator: Show tasks",
    });
    expect(action.shortcut).toBeUndefined();
  });

  it("onSelect dispatches the seam event with segment: tasks", () => {
    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent<unknown>).detail);
    document.addEventListener(QUAKE_TERMINAL_EVENT, listener);
    try {
      buildQuakeTerminalTasksAction().onSelect();
    } finally {
      document.removeEventListener(QUAKE_TERMINAL_EVENT, listener);
    }
    expect(seen).toHaveLength(1);
    expect(isQuakeTerminalRequest(seen[0])).toBe(true);
    expect(seen[0]).toEqual({ action: "open", segment: "tasks" });
  });
});

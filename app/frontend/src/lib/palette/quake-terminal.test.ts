import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildQuakeTerminalAction,
  buildQuakeTerminalListAction,
  buildQuakeTerminalLogAction,
  buildQuakeTerminalPinAction,
  buildQuakeTerminalResetSizeAction,
  buildQuakeTerminalTasksAction,
} from "./quake-terminal";
import {
  QUAKE_GEOMETRY_DEFAULT,
  QUAKE_GEOMETRY_KEY,
  QUAKE_TERMINAL_EVENT,
  getQuakeMachineActivity,
  getQuakeMachineState,
  getQuakePinned,
  isQuakeTerminalRequest,
  readQuakeGeometry,
  setQuakeMachineState,
  setQuakePinned,
} from "@/lib/quake-terminal";

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

describe("buildQuakeTerminalResetSizeAction", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("is the chord-less palette entry", () => {
    const action = buildQuakeTerminalResetSizeAction();
    expect(action).toMatchObject({
      id: "quake-terminal-reset-size",
      label: "Operator: Reset quake terminal size",
    });
    expect(action.shortcut).toBeUndefined();
  });

  it("onSelect writes the default geometry to the per-viewer store without opening the drawer", () => {
    localStorage.setItem(
      QUAKE_GEOMETRY_KEY,
      JSON.stringify({ heightVh: 70, widthPx: 900, centerOffsetPx: 40 }),
    );
    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent<unknown>).detail);
    document.addEventListener(QUAKE_TERMINAL_EVENT, listener);
    try {
      buildQuakeTerminalResetSizeAction().onSelect();
    } finally {
      document.removeEventListener(QUAKE_TERMINAL_EVENT, listener);
    }
    expect(readQuakeGeometry()).toEqual(QUAKE_GEOMETRY_DEFAULT);
    expect(seen).toHaveLength(0);
  });
});

describe("buildQuakeTerminalPinAction", () => {
  beforeEach(() => {
    // Entering rest resets the pin slot — a clean slate per test.
    setQuakeMachineState("open");
    setQuakeMachineState("rest");
  });

  it("toggles its id-stable label on the pinned flag", () => {
    expect(buildQuakeTerminalPinAction(false)).toMatchObject({
      id: "quake-terminal-pin",
      label: "Operator: Pin quake terminal",
    });
    expect(buildQuakeTerminalPinAction(true)).toMatchObject({
      id: "quake-terminal-pin",
      label: "Operator: Unpin quake terminal",
    });
    expect(buildQuakeTerminalPinAction(false).shortcut).toBeUndefined();
  });

  it("onSelect flips the pin slot and re-asserts the open machine state (the mouse-pick race)", () => {
    setQuakeMachineState("open");
    const activityBefore = getQuakeMachineActivity();
    buildQuakeTerminalPinAction(false).onSelect();
    expect(getQuakePinned()).toBe(true);
    // The outside-click settle backs off only on a machine-activity bump —
    // the same-value re-assert must register even though the state is
    // already open.
    expect(getQuakeMachineState()).toBe("open");
    expect(getQuakeMachineActivity()).toBeGreaterThan(activityBefore);
    buildQuakeTerminalPinAction(true).onSelect();
    expect(getQuakePinned()).toBe(false);
    expect(getQuakeMachineState()).toBe("open");
  });
});

import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  ASK_OPERATOR_MIN_QUERY,
  LEGACY_QUAKE_GEOMETRY_KEY,
  LEGACY_QUAKE_OPACITY_KEY,
  QUAKE_GEOMETRY_DEFAULT,
  QUAKE_GEOMETRY_KEY,
  QUAKE_OPACITY_DEFAULT,
  QUAKE_OPACITY_KEY,
  attachOperatorFiles,
  clampQuakeGeometry,
  clampQuakeOpacity,
  cycleQuakeMachine,
  findOperatorWindow,
  getQuakeMachineState,
  isQuakeTerminalRequest,
  isQuakeTerminalTarget,
  QUAKE_TERMINAL_ROOT_ATTR,
  readQuakeGeometry,
  readQuakeOpacity,
  resolveQuakeServer,
  sendOperatorMessage,
  setQuakeMachineState,
  setOperatorComposeText,
  shouldShowAskOperatorRow,
  useOperatorCompose,
  writeQuakeGeometry,
  writeQuakeOpacity,
} from "./quake-terminal";
import { act, renderHook } from "@testing-library/react";
import type { ProjectSession, WindowInfo } from "@/types";

const mockSend = vi.hoisted(() => vi.fn());
const mockUpload = vi.hoisted(() => vi.fn());
vi.mock("@/api/client", async (importActual) => ({
  ...(await importActual<typeof import("@/api/client")>()),
  sendToWindow: mockSend,
  uploadFile: mockUpload,
}));

function win(overrides: Partial<WindowInfo>): WindowInfo {
  return {
    windowId: "@1",
    index: 0,
    name: "win",
    worktreePath: "/tmp",
    activity: "idle",
    isActiveWindow: false,
    activityTimestamp: 0,
    ...overrides,
  };
}

function session(name: string, windows: WindowInfo[]): ProjectSession {
  return { name, windows };
}

describe("resolveQuakeServer", () => {
  it("prefers the route server over every other source", () => {
    expect(resolveQuakeServer("fabKit1", ["a", "fabKit1"], "a")).toBe("fabKit1");
    expect(resolveQuakeServer("fabKit1", [], null)).toBe("fabKit1");
  });

  it("preselects the sole server when exactly one exists", () => {
    expect(resolveQuakeServer(null, ["only"], null)).toBe("only");
    expect(resolveQuakeServer(null, ["only"], "stale")).toBe("only");
  });

  it("defaults to the most recently viewed server when it is still listed", () => {
    expect(resolveQuakeServer(null, ["a", "b"], "b")).toBe("b");
  });

  it("falls back to the first server when lastViewed is stale or absent", () => {
    expect(resolveQuakeServer(null, ["a", "b"], "gone")).toBe("a");
    expect(resolveQuakeServer(null, ["a", "b"], null)).toBe("a");
  });

  it("returns null for an empty server list", () => {
    expect(resolveQuakeServer(null, [], "a")).toBeNull();
    expect(resolveQuakeServer(null, [], null)).toBeNull();
  });
});

describe("findOperatorWindow", () => {
  it("finds the role=operator window across sessions, with its session name", () => {
    const sessions = [
      session("main", [win({ windowId: "@1" }), win({ windowId: "@2" })]),
      session("_rk-operator", [win({ windowId: "@9", role: "operator", name: "operator" })]),
    ];
    expect(findOperatorWindow(sessions)).toEqual({
      window: sessions[1].windows[0],
      sessionName: "_rk-operator",
    });
  });

  it("returns undefined when no window carries the operator role", () => {
    expect(findOperatorWindow([session("main", [win({})])])).toBeUndefined();
    expect(findOperatorWindow([])).toBeUndefined();
  });

  it("ignores an empty windowId (ghost rows never carry a role, belt-and-suspenders)", () => {
    const sessions = [session("main", [win({ windowId: "", role: "operator" })])];
    expect(findOperatorWindow(sessions)).toBeUndefined();
  });
});

describe("shouldShowAskOperatorRow", () => {
  it("shows only at zero matches with an operator and a floor-length query", () => {
    expect(shouldShowAskOperatorRow("hello", 0, true)).toBe(true);
    expect(shouldShowAskOperatorRow("hello", 2, true)).toBe(false);
    expect(shouldShowAskOperatorRow("hello", 0, false)).toBe(false);
  });

  it("enforces the trimmed length floor", () => {
    const short = "x".repeat(ASK_OPERATOR_MIN_QUERY - 1);
    const exact = "x".repeat(ASK_OPERATOR_MIN_QUERY);
    expect(shouldShowAskOperatorRow(short, 0, true)).toBe(false);
    expect(shouldShowAskOperatorRow(exact, 0, true)).toBe(true);
    expect(shouldShowAskOperatorRow(`  ${short}  `, 0, true)).toBe(false);
    expect(shouldShowAskOperatorRow("   ", 0, true)).toBe(false);
  });
});

describe("isQuakeTerminalRequest", () => {
  it("accepts both actions and rejects foreign details", () => {
    expect(isQuakeTerminalRequest({ action: "toggle" })).toBe(true);
    expect(isQuakeTerminalRequest({ action: "open", server: "a", send: "hi" })).toBe(true);
    expect(isQuakeTerminalRequest({ action: "close" })).toBe(false);
    expect(isQuakeTerminalRequest(null)).toBe(false);
    expect(isQuakeTerminalRequest("open")).toBe(false);
    expect(isQuakeTerminalRequest(undefined)).toBe(false);
  });
});

describe("quake machine state", () => {
  beforeEach(() => {
    setQuakeMachineState("rest");
  });

  it("starts at rest and notifies subscribers on change", () => {
    expect(getQuakeMachineState()).toBe("rest");
    setQuakeMachineState("open");
    expect(getQuakeMachineState()).toBe("open");
  });

  it("toggles rest ⇄ open", () => {
    expect(cycleQuakeMachine("rest")).toBe("open");
    expect(cycleQuakeMachine("open")).toBe("rest");
  });
});

describe("shared compose seam", () => {
  const target = {
    window: win({ windowId: "@9", name: "operator", role: "operator" }),
    sessionName: "_rk-operator",
  };

  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({ ok: true });
    mockUpload.mockReset();
    mockUpload.mockResolvedValue({ ok: true, path: "/tmp/op/.uploads/shot.png" });
    setOperatorComposeText("");
  });

  it("sendOperatorMessage delivers via the agent lane and clears the draft", async () => {
    const { result } = renderHook(() => useOperatorCompose());
    act(() => setOperatorComposeText("restart the worker"));
    expect(result.current.text).toBe("restart the worker");

    let ok!: boolean;
    await act(async () => {
      ok = await sendOperatorMessage("srv1", target, "restart the worker");
    });
    expect(ok).toBe(true);
    expect(mockSend).toHaveBeenCalledWith("srv1", "@9", "restart the worker", "submit", "agent");
    expect(result.current.text).toBe("");
    expect(result.current.error).toBeNull();
  });

  it("guards whitespace-only and target-less sends as no-ops", async () => {
    await act(async () => {
      await sendOperatorMessage("srv1", target, "   ");
      await sendOperatorMessage(null, target, "hi");
      await sendOperatorMessage("srv1", undefined, "hi");
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("a failed send surfaces the error and preserves the draft; an edit clears it", async () => {
    mockSend.mockRejectedValue(new Error("probe failed"));
    const { result } = renderHook(() => useOperatorCompose());
    act(() => setOperatorComposeText("retry me"));

    let ok!: boolean;
    await act(async () => {
      ok = await sendOperatorMessage("srv1", target, "retry me");
    });
    expect(ok).toBe(false);
    expect(result.current.error).toBe("probe failed");
    expect(result.current.text).toBe("retry me");

    act(() => setOperatorComposeText("retry me, edited"));
    expect(result.current.error).toBeNull();
  });

  it("the in-flight guard blocks a concurrent send", async () => {
    let release!: () => void;
    mockSend.mockImplementation(
      () => new Promise<{ ok: boolean }>((resolve) => { release = () => resolve({ ok: true }); }),
    );
    let first!: Promise<boolean>;
    let second!: boolean;
    await act(async () => {
      first = sendOperatorMessage("srv1", target, "one");
      second = await sendOperatorMessage("srv1", target, "two");
    });
    expect(second).toBe(false);
    expect(mockSend).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
      await first;
    });
  });

  it("attachOperatorFiles uploads to the operator session and insert-delivers each path", async () => {
    const files = [new File(["a"], "a.png", { type: "image/png" })];
    await act(async () => {
      await attachOperatorFiles("srv1", target, files);
    });
    expect(mockUpload).toHaveBeenCalledWith("srv1", "_rk-operator", files[0], "@9");
    expect(mockSend).toHaveBeenCalledWith("srv1", "@9", "/tmp/op/.uploads/shot.png ", "raw", "agent");
  });

  it("attachOperatorFiles is a no-op without a target and surfaces upload failures inline", async () => {
    const files = [new File(["a"], "a.png", { type: "image/png" })];
    await act(async () => {
      await attachOperatorFiles("srv1", undefined, files);
    });
    expect(mockUpload).not.toHaveBeenCalled();

    mockUpload.mockRejectedValue(new Error("upload exploded"));
    const { result } = renderHook(() => useOperatorCompose());
    await act(async () => {
      await attachOperatorFiles("srv1", target, files);
    });
    expect(result.current.error).toBe("upload exploded");
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("quake geometry store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns the defaults when nothing is stored", () => {
    expect(readQuakeGeometry()).toEqual(QUAKE_GEOMETRY_DEFAULT);
  });

  it("round-trips a written geometry", () => {
    writeQuakeGeometry({ heightVh: 70, widthPx: 900 });
    expect(readQuakeGeometry()).toEqual({ heightVh: 70, widthPx: 900 });
  });

  it("degrades to defaults on corrupt JSON", () => {
    localStorage.setItem(QUAKE_GEOMETRY_KEY, "{not json");
    expect(readQuakeGeometry()).toEqual(QUAKE_GEOMETRY_DEFAULT);
  });

  it("degrades to defaults on a wrong shape", () => {
    localStorage.setItem(QUAKE_GEOMETRY_KEY, JSON.stringify({ heightVh: "70", widthPx: 900 }));
    expect(readQuakeGeometry()).toEqual(QUAKE_GEOMETRY_DEFAULT);
  });

  it("clamps out-of-range stored values instead of rejecting them", () => {
    localStorage.setItem(QUAKE_GEOMETRY_KEY, JSON.stringify({ heightVh: 99, widthPx: 100 }));
    expect(readQuakeGeometry()).toEqual({ heightVh: 85, widthPx: 420 });
  });

  it("clamps width against the 96vw ceiling", () => {
    const clamped = clampQuakeGeometry({ heightVh: 55, widthPx: 2000 }, 1000);
    expect(clamped.widthPx).toBe(960);
  });

  it("clamps height into 25–85vh", () => {
    expect(clampQuakeGeometry({ heightVh: 10, widthPx: 760 }).heightVh).toBe(25);
    expect(clampQuakeGeometry({ heightVh: 90, widthPx: 760 }).heightVh).toBe(85);
  });

  it("falls back to the legacy key, clamped through the same path, when the new key is absent", () => {
    localStorage.setItem(LEGACY_QUAKE_GEOMETRY_KEY, JSON.stringify({ heightVh: 99, widthPx: 100 }));
    expect(readQuakeGeometry()).toEqual({ heightVh: 85, widthPx: 420 });
  });

  it("prefers the new key when both keys are set", () => {
    localStorage.setItem(LEGACY_QUAKE_GEOMETRY_KEY, JSON.stringify({ heightVh: 40, widthPx: 600 }));
    localStorage.setItem(QUAKE_GEOMETRY_KEY, JSON.stringify({ heightVh: 70, widthPx: 900 }));
    expect(readQuakeGeometry()).toEqual({ heightVh: 70, widthPx: 900 });
  });

  it("a write stores the new key and removes the legacy key", () => {
    localStorage.setItem(LEGACY_QUAKE_GEOMETRY_KEY, JSON.stringify({ heightVh: 40, widthPx: 600 }));
    writeQuakeGeometry({ heightVh: 70, widthPx: 900 });
    expect(localStorage.getItem(QUAKE_GEOMETRY_KEY)).toBe(JSON.stringify({ heightVh: 70, widthPx: 900 }));
    expect(localStorage.getItem(LEGACY_QUAKE_GEOMETRY_KEY)).toBeNull();
  });

  it("degrades to defaults on a corrupt legacy value", () => {
    localStorage.setItem(LEGACY_QUAKE_GEOMETRY_KEY, "{not json");
    expect(readQuakeGeometry()).toEqual(QUAKE_GEOMETRY_DEFAULT);
  });
});

describe("quake opacity store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns the default 0.90 when nothing is stored", () => {
    expect(readQuakeOpacity()).toBe(QUAKE_OPACITY_DEFAULT);
  });

  it("round-trips a written opacity", () => {
    writeQuakeOpacity(0.8);
    expect(readQuakeOpacity()).toBe(0.8);
  });

  it("degrades to the default on a non-numeric value", () => {
    localStorage.setItem(QUAKE_OPACITY_KEY, "opaque-ish");
    expect(readQuakeOpacity()).toBe(QUAKE_OPACITY_DEFAULT);
  });

  it("clamps into 0.5–1.0", () => {
    expect(clampQuakeOpacity(0.2)).toBe(0.5);
    expect(clampQuakeOpacity(1.4)).toBe(1.0);
    localStorage.setItem(QUAKE_OPACITY_KEY, "0.3");
    expect(readQuakeOpacity()).toBe(0.5);
  });

  it("falls back to the legacy key when the new key is absent", () => {
    localStorage.setItem(LEGACY_QUAKE_OPACITY_KEY, "0.7");
    expect(readQuakeOpacity()).toBe(0.7);
  });

  it("prefers the new key when both keys are set", () => {
    localStorage.setItem(LEGACY_QUAKE_OPACITY_KEY, "0.7");
    localStorage.setItem(QUAKE_OPACITY_KEY, "0.9");
    expect(readQuakeOpacity()).toBe(0.9);
  });

  it("a write stores the new key and removes the legacy key", () => {
    localStorage.setItem(LEGACY_QUAKE_OPACITY_KEY, "0.7");
    writeQuakeOpacity(0.8);
    expect(localStorage.getItem(QUAKE_OPACITY_KEY)).toBe("0.8");
    expect(localStorage.getItem(LEGACY_QUAKE_OPACITY_KEY)).toBeNull();
  });

  it("degrades to the default on a corrupt legacy value", () => {
    localStorage.setItem(LEGACY_QUAKE_OPACITY_KEY, "opaque-ish");
    expect(readQuakeOpacity()).toBe(QUAKE_OPACITY_DEFAULT);
  });
});

describe("isQuakeTerminalTarget", () => {
  it("recognizes targets inside the quake terminal root and rejects everything else", () => {
    const root = document.createElement("div");
    root.setAttribute(QUAKE_TERMINAL_ROOT_ATTR, "");
    const inner = document.createElement("textarea");
    root.appendChild(inner);
    document.body.appendChild(root);

    expect(isQuakeTerminalTarget(inner)).toBe(true);
    expect(isQuakeTerminalTarget(root)).toBe(true);
    expect(isQuakeTerminalTarget(document.body)).toBe(false);
    expect(isQuakeTerminalTarget(null)).toBe(false);
    root.remove();
  });
});

import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  ASK_OPERATOR_MIN_QUERY,
  CONSOLE_GEOMETRY_DEFAULT,
  CONSOLE_GEOMETRY_KEY,
  CONSOLE_OPACITY_DEFAULT,
  CONSOLE_OPACITY_KEY,
  attachOperatorFiles,
  clampConsoleGeometry,
  clampConsoleOpacity,
  cycleConsoleMachine,
  findOperatorWindow,
  getConsoleMachineState,
  isOperatorConsoleRequest,
  isOperatorConsoleTarget,
  OPERATOR_CONSOLE_ROOT_ATTR,
  readConsoleGeometry,
  readConsoleOpacity,
  resolveConsoleServer,
  sendOperatorMessage,
  setConsoleMachineState,
  setOperatorComposeText,
  shouldShowAskOperatorRow,
  useOperatorCompose,
  writeConsoleGeometry,
  writeConsoleOpacity,
} from "./operator-console";
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

describe("resolveConsoleServer", () => {
  it("prefers the route server over every other source", () => {
    expect(resolveConsoleServer("fabKit1", ["a", "fabKit1"], "a")).toBe("fabKit1");
    expect(resolveConsoleServer("fabKit1", [], null)).toBe("fabKit1");
  });

  it("preselects the sole server when exactly one exists", () => {
    expect(resolveConsoleServer(null, ["only"], null)).toBe("only");
    expect(resolveConsoleServer(null, ["only"], "stale")).toBe("only");
  });

  it("defaults to the most recently viewed server when it is still listed", () => {
    expect(resolveConsoleServer(null, ["a", "b"], "b")).toBe("b");
  });

  it("falls back to the first server when lastViewed is stale or absent", () => {
    expect(resolveConsoleServer(null, ["a", "b"], "gone")).toBe("a");
    expect(resolveConsoleServer(null, ["a", "b"], null)).toBe("a");
  });

  it("returns null for an empty server list", () => {
    expect(resolveConsoleServer(null, [], "a")).toBeNull();
    expect(resolveConsoleServer(null, [], null)).toBeNull();
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

describe("isOperatorConsoleRequest", () => {
  it("accepts all three actions and rejects foreign details", () => {
    expect(isOperatorConsoleRequest({ action: "toggle" })).toBe(true);
    expect(isOperatorConsoleRequest({ action: "open", server: "a", send: "hi" })).toBe(true);
    expect(isOperatorConsoleRequest({ action: "button" })).toBe(true);
    expect(isOperatorConsoleRequest({ action: "close" })).toBe(false);
    expect(isOperatorConsoleRequest(null)).toBe(false);
    expect(isOperatorConsoleRequest("open")).toBe(false);
    expect(isOperatorConsoleRequest(undefined)).toBe(false);
  });
});

describe("console machine state", () => {
  beforeEach(() => {
    setConsoleMachineState("rest");
  });

  it("starts at rest and notifies subscribers on change", () => {
    expect(getConsoleMachineState()).toBe("rest");
    setConsoleMachineState("focused");
    expect(getConsoleMachineState()).toBe("focused");
  });

  it("cycles rest → focused → open → rest", () => {
    expect(cycleConsoleMachine("rest")).toBe("focused");
    expect(cycleConsoleMachine("focused")).toBe("open");
    expect(cycleConsoleMachine("open")).toBe("rest");
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

describe("console geometry store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns the defaults when nothing is stored", () => {
    expect(readConsoleGeometry()).toEqual(CONSOLE_GEOMETRY_DEFAULT);
  });

  it("round-trips a written geometry", () => {
    writeConsoleGeometry({ heightVh: 70, widthPx: 900 });
    expect(readConsoleGeometry()).toEqual({ heightVh: 70, widthPx: 900 });
  });

  it("degrades to defaults on corrupt JSON", () => {
    localStorage.setItem(CONSOLE_GEOMETRY_KEY, "{not json");
    expect(readConsoleGeometry()).toEqual(CONSOLE_GEOMETRY_DEFAULT);
  });

  it("degrades to defaults on a wrong shape", () => {
    localStorage.setItem(CONSOLE_GEOMETRY_KEY, JSON.stringify({ heightVh: "70", widthPx: 900 }));
    expect(readConsoleGeometry()).toEqual(CONSOLE_GEOMETRY_DEFAULT);
  });

  it("clamps out-of-range stored values instead of rejecting them", () => {
    localStorage.setItem(CONSOLE_GEOMETRY_KEY, JSON.stringify({ heightVh: 99, widthPx: 100 }));
    expect(readConsoleGeometry()).toEqual({ heightVh: 85, widthPx: 420 });
  });

  it("clamps width against the 96vw ceiling", () => {
    const clamped = clampConsoleGeometry({ heightVh: 55, widthPx: 2000 }, 1000);
    expect(clamped.widthPx).toBe(960);
  });

  it("clamps height into 25–85vh", () => {
    expect(clampConsoleGeometry({ heightVh: 10, widthPx: 760 }).heightVh).toBe(25);
    expect(clampConsoleGeometry({ heightVh: 90, widthPx: 760 }).heightVh).toBe(85);
  });
});

describe("console opacity store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns the default 0.90 when nothing is stored", () => {
    expect(readConsoleOpacity()).toBe(CONSOLE_OPACITY_DEFAULT);
  });

  it("round-trips a written opacity", () => {
    writeConsoleOpacity(0.8);
    expect(readConsoleOpacity()).toBe(0.8);
  });

  it("degrades to the default on a non-numeric value", () => {
    localStorage.setItem(CONSOLE_OPACITY_KEY, "opaque-ish");
    expect(readConsoleOpacity()).toBe(CONSOLE_OPACITY_DEFAULT);
  });

  it("clamps into 0.75–1.0", () => {
    expect(clampConsoleOpacity(0.2)).toBe(0.75);
    expect(clampConsoleOpacity(1.4)).toBe(1.0);
    localStorage.setItem(CONSOLE_OPACITY_KEY, "0.5");
    expect(readConsoleOpacity()).toBe(0.75);
  });
});

describe("isOperatorConsoleTarget", () => {
  it("recognizes targets inside the console root and rejects everything else", () => {
    const root = document.createElement("div");
    root.setAttribute(OPERATOR_CONSOLE_ROOT_ATTR, "");
    const inner = document.createElement("textarea");
    root.appendChild(inner);
    document.body.appendChild(root);

    expect(isOperatorConsoleTarget(inner)).toBe(true);
    expect(isOperatorConsoleTarget(root)).toBe(true);
    expect(isOperatorConsoleTarget(document.body)).toBe(false);
    expect(isOperatorConsoleTarget(null)).toBe(false);
    root.remove();
  });
});

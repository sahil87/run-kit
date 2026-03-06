import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ACTIVITY_THRESHOLD_SECONDS } from "@/lib/types";

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));

// Mock child_process.execFile so that promisify(execFile) returns our mock.
// Node's promisify checks for [Symbol.for('nodejs.util.promisify.custom')]
// and returns that value directly — no need to mock node:util.
// CJS interop: named imports resolve from default, so set it in both places.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const fakeExecFile = Object.assign(
    (() => {}) as unknown as typeof import("node:child_process").execFile,
    { [Symbol.for("nodejs.util.promisify.custom")]: mockExecFile },
  );
  return {
    ...actual,
    default: { ...actual, execFile: fakeExecFile },
    execFile: fakeExecFile,
  };
});

import { listSessions, listWindows, renameWindow } from "@/lib/tmux";

describe("listSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses standard sessions with session_grouped=0", async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: "alpha\t0\talpha\nbeta\t0\tbeta\n",
      stderr: "",
    });

    const result = await listSessions();
    expect(result).toEqual(["alpha", "beta"]);
  });

  it("filters out session-group copies (grouped=1, name !== group)", async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: "devshell\t0\tdevshell\ndevshell-82\t1\tdevshell\n",
      stderr: "",
    });

    const result = await listSessions();
    expect(result).toEqual(["devshell"]);
  });

  it("keeps group-named session (grouped=1, name === group)", async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: "mygroup\t1\tmygroup\n",
      stderr: "",
    });

    const result = await listSessions();
    expect(result).toEqual(["mygroup"]);
  });

  it("returns [] when tmux is not running", async () => {
    mockExecFile.mockRejectedValueOnce(new Error("no server running"));

    const result = await listSessions();
    expect(result).toEqual([]);
  });
});

describe("listWindows", () => {
  const FAKE_NOW = 1700000000_000; // pinned time to avoid flaky second-boundary races
  const FAKE_NOW_SECS = FAKE_NOW / 1000;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(FAKE_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks window as active when within threshold", async () => {
    const recentTs = FAKE_NOW_SECS - 1;
    mockExecFile.mockResolvedValueOnce({
      stdout: `0\tdev\t/home/user/project\t${recentTs}\t1\n`,
      stderr: "",
    });

    const result = await listWindows("my-session");
    expect(result).toHaveLength(1);
    expect(result[0].activity).toBe("active");
  });

  it("marks window as idle when beyond threshold", async () => {
    const oldTs = FAKE_NOW_SECS - ACTIVITY_THRESHOLD_SECONDS - 100;
    mockExecFile.mockResolvedValueOnce({
      stdout: `0\tdev\t/home/user/project\t${oldTs}\t0\n`,
      stderr: "",
    });

    const result = await listWindows("my-session");
    expect(result).toHaveLength(1);
    expect(result[0].activity).toBe("idle");
  });

  it("parses all fields correctly including isActiveWindow", async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: `0\tdev\t/home/user/project\t${FAKE_NOW_SECS}\t1\n2\tbuild\t/tmp/build\t${FAKE_NOW_SECS}\t0\n`,
      stderr: "",
    });

    const result = await listWindows("my-session");
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      index: 0,
      name: "dev",
      worktreePath: "/home/user/project",
      isActiveWindow: true,
    });
    expect(result[1]).toMatchObject({
      index: 2,
      name: "build",
      worktreePath: "/tmp/build",
      isActiveWindow: false,
    });
  });

  it("returns [] when session does not exist", async () => {
    mockExecFile.mockRejectedValueOnce(new Error("session not found"));

    const result = await listWindows("nonexistent");
    expect(result).toEqual([]);
  });
});

describe("renameWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls tmux rename-window with correct args", async () => {
    mockExecFile.mockResolvedValueOnce({ stdout: "", stderr: "" });

    await renameWindow("my-session", 2, "new-name");

    expect(mockExecFile).toHaveBeenCalledWith(
      "tmux",
      ["rename-window", "-t", "my-session:2", "new-name"],
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it("propagates tmux errors", async () => {
    mockExecFile.mockRejectedValueOnce(new Error("session not found"));

    await expect(renameWindow("bad", 0, "name")).rejects.toThrow(
      "session not found",
    );
  });
});

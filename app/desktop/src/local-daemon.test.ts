/**
 * node:test suite for the local-daemon pure logic (run via `pnpm run test`
 * after compile — the `hosts.test.ts` convention). Compiled output is
 * excluded from packaging via the electron-builder `files` pattern.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  augmentPath,
  daemonMenuModel,
  isDaemonAlreadyRunning,
  isExecTimeout,
  parseDaemonStatusRunning,
  parseRkVersion,
  parseSessionCount,
  resolveRkBinary,
  rkCandidatePaths,
  rkInvocationErrorMessage,
  rkTimeoutMessage,
} from "./local-daemon";

// ─── rkCandidatePaths ───────────────────────────────────────────────────────

test("darwin candidates are homebrew-first then /usr/local", () => {
  assert.deepEqual(rkCandidatePaths("darwin"), ["/opt/homebrew/bin/rk", "/usr/local/bin/rk"]);
});

test("linux candidates are linuxbrew-first then /usr/local", () => {
  assert.deepEqual(rkCandidatePaths("linux"), [
    "/home/linuxbrew/.linuxbrew/bin/rk",
    "/usr/local/bin/rk",
  ]);
});

test("win32 has no candidates — the local section is suppressed there", () => {
  assert.deepEqual(rkCandidatePaths("win32"), []);
});

// ─── resolveRkBinary ────────────────────────────────────────────────────────

test("resolveRkBinary picks the first existing candidate", () => {
  const resolved = resolveRkBinary(
    ["/opt/homebrew/bin/rk", "/usr/local/bin/rk"],
    (path) => path === "/usr/local/bin/rk",
  );
  assert.equal(resolved, "/usr/local/bin/rk");
});

test("resolveRkBinary prefers the earlier candidate when both exist", () => {
  const resolved = resolveRkBinary(["/opt/homebrew/bin/rk", "/usr/local/bin/rk"], () => true);
  assert.equal(resolved, "/opt/homebrew/bin/rk");
});

test("resolveRkBinary falls back to a bare PATH lookup when no candidate exists", () => {
  const resolved = resolveRkBinary(["/opt/homebrew/bin/rk", "/usr/local/bin/rk"], () => false);
  assert.equal(resolved, "rk");
});

test("resolveRkBinary with no candidates (win32) is the bare PATH lookup", () => {
  assert.equal(resolveRkBinary([], () => true), "rk");
});

// ─── augmentPath ────────────────────────────────────────────────────────────

test("augmentPath appends both brew dirs to the darwin GUI PATH", () => {
  assert.equal(
    augmentPath("darwin", "/usr/bin:/bin:/usr/sbin:/sbin"),
    "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin",
  );
});

test("augmentPath appends only the missing dir (no duplicates)", () => {
  assert.equal(
    augmentPath("darwin", "/opt/homebrew/bin:/usr/bin:/bin"),
    "/opt/homebrew/bin:/usr/bin:/bin:/usr/local/bin",
  );
});

test("augmentPath leaves a PATH that already has every brew dir unchanged", () => {
  const path = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
  assert.equal(augmentPath("darwin", path), path);
});

test("augmentPath with an undefined or empty PATH yields just the brew dirs", () => {
  assert.equal(augmentPath("darwin", undefined), "/opt/homebrew/bin:/usr/local/bin");
  assert.equal(augmentPath("darwin", ""), "/opt/homebrew/bin:/usr/local/bin");
});

test("augmentPath does not double the separator when PATH ends with a colon", () => {
  assert.equal(
    augmentPath("darwin", "/usr/bin:"),
    "/usr/bin:/opt/homebrew/bin:/usr/local/bin",
  );
});

test("augmentPath appends the linuxbrew prefix on linux", () => {
  assert.equal(
    augmentPath("linux", "/usr/bin:/bin"),
    "/usr/bin:/bin:/home/linuxbrew/.linuxbrew/bin:/usr/local/bin",
  );
});

test("augmentPath passes win32 and unknown platforms through unchanged", () => {
  assert.equal(augmentPath("win32", "C:\\Windows\\system32"), "C:\\Windows\\system32");
  assert.equal(augmentPath("sunos", "/usr/bin"), "/usr/bin");
  assert.equal(augmentPath("win32", undefined), "");
});

// ─── parseRkVersion ─────────────────────────────────────────────────────────

test("parseRkVersion parses the real CLI output shape", () => {
  assert.equal(parseRkVersion("run-kit version v3.12.7\n"), "3.12.7");
});

test("parseRkVersion tolerates a bare version without the v prefix", () => {
  assert.equal(parseRkVersion("3.12.7"), "3.12.7");
});

test("parseRkVersion keeps pre-release suffixes", () => {
  assert.equal(parseRkVersion("run-kit version v0.0.0-dev"), "0.0.0-dev");
});

test("parseRkVersion returns null on unrecognizable output", () => {
  assert.equal(parseRkVersion("command not found"), null);
  assert.equal(parseRkVersion(""), null);
});

// ─── parseSessionCount ──────────────────────────────────────────────────────

test("parseSessionCount counts a sessions array", () => {
  assert.equal(parseSessionCount([{ name: "a" }, { name: "b" }]), 2);
  assert.equal(parseSessionCount([]), 0);
});

test("parseSessionCount returns null for non-array bodies", () => {
  assert.equal(parseSessionCount({ sessions: [] }), null);
  assert.equal(parseSessionCount("nope"), null);
  assert.equal(parseSessionCount(null), null);
});

// ─── daemon status + menu decisions ────────────────────────────────────────

test("parseDaemonStatusRunning reads full rk daemon status reports", () => {
  const running = `{
  "daemon": {
    "running": true,
    "socket": "rk-daemon",
    "session": "rk-daemon",
    "window": "serve",
    "target": "=rk-daemon:=serve",
    "pid": 4242
  },
  "port": {
    "host": "127.0.0.1",
    "port": 3000,
    "state": "held-by-daemon",
    "holder_pid": 4242,
    "holder_command": "rk"
  }
}
`;
  const stopped = `{
  "daemon": {
    "running": false
  },
  "port": {
    "host": "127.0.0.1",
    "port": 3000,
    "state": "free"
  }
}
`;
  assert.equal(parseDaemonStatusRunning(running), true);
  assert.equal(parseDaemonStatusRunning(stopped), false);
});

test("parseDaemonStatusRunning tolerates missing or malformed output", () => {
  assert.equal(parseDaemonStatusRunning('{"daemon":{}}'), null);
  assert.equal(parseDaemonStatusRunning('{"other":{"running":true}}'), null);
  assert.equal(parseDaemonStatusRunning("not json"), null);
  assert.equal(parseDaemonStatusRunning(""), null);
});

test("daemonMenuModel covers stopped, running, and wedged enablement", () => {
  assert.deepEqual(
    daemonMenuModel({ state: "stopped", version: "3.18.17", action: null }),
    {
      statusLabel: "○ stopped · v3.18.17",
      start: { label: "Start", enabled: true },
      restart: { label: "Restart", enabled: true },
      stop: { label: "Stop", enabled: false },
    },
  );
  assert.deepEqual(
    daemonMenuModel({ state: "running", version: null, action: null }),
    {
      statusLabel: "● running",
      start: { label: "Start", enabled: false },
      restart: { label: "Restart", enabled: true },
      stop: { label: "Stop", enabled: true },
    },
  );
  assert.deepEqual(
    daemonMenuModel({ state: "wedged", version: "3.18.17", action: null }),
    {
      statusLabel: "◐ not responding · v3.18.17",
      start: { label: "Start", enabled: false },
      restart: { label: "Restart", enabled: true },
      stop: { label: "Stop", enabled: true },
    },
  );
});

test("daemonMenuModel overlays each in-flight action and disables every item", () => {
  for (const [action, activeLabel] of [
    ["start", "Starting…"],
    ["restart", "Restarting…"],
    ["stop", "Stopping…"],
  ] as const) {
    const model = daemonMenuModel({ state: "running", version: null, action });
    assert.equal(model[action].label, activeLabel);
    assert.equal(model.start.enabled, false);
    assert.equal(model.restart.enabled, false);
    assert.equal(model.stop.enabled, false);
  }
});

// ─── isDaemonAlreadyRunning ─────────────────────────────────────────────────

test("the daemon already running error is already-started success", () => {
  assert.equal(isDaemonAlreadyRunning("Error: daemon already running"), true);
  assert.equal(isDaemonAlreadyRunning("daemon already running"), true);
});

test("other start failures are NOT classified as already running", () => {
  assert.equal(isDaemonAlreadyRunning("port 3000 already serving on :3000"), false);
  assert.equal(isDaemonAlreadyRunning("tmux: command not found"), false);
  assert.equal(isDaemonAlreadyRunning(""), false);
});

// ─── isExecTimeout / rkTimeoutMessage ───────────────────────────────────────

test("the timeout kill shape (SIGTERM + null code) is classified as a timeout", () => {
  // The verified execFile error shape when the `timeout` option fires:
  // message="Command failed: …", signal="SIGTERM", code=null, stderr=undefined.
  assert.equal(
    isExecTimeout({ message: "Command failed: /opt/homebrew/bin/rk remote connect buildbox", killed: true, signal: "SIGTERM", code: null }),
    true,
  );
});

test("non-timeout failures are NOT classified as timeouts", () => {
  // Normal non-zero exit: code set, no signal.
  assert.equal(isExecTimeout({ signal: null, code: 1 }), false);
  // Missing binary: string code, no signal.
  assert.equal(isExecTimeout({ signal: null, code: "ENOENT" }), false);
  // A different signal is not our timeout kill.
  assert.equal(isExecTimeout({ signal: "SIGKILL", code: null }), false);
  assert.equal(isExecTimeout(null), false);
  assert.equal(isExecTimeout("Command failed"), false);
});

test("rkTimeoutMessage names the rk args and the timeout, never the binary path", () => {
  const message = rkTimeoutMessage(["remote", "connect", "buildbox"], 300_000);
  assert.equal(message, "`rk remote connect buildbox` timed out after 300s");
  assert.ok(!message.includes("/"));
});

test("rk timeout and fallback errors hide restart implementation details", () => {
  const args = ["daemon", "restart", "--full"];
  const timeout = rkInvocationErrorMessage(
    {
      message: "Command failed: /opt/homebrew/bin/rk daemon restart --full",
      signal: "SIGTERM",
      code: null,
    },
    args,
    60_000,
    "/opt/homebrew/bin/rk",
  );
  const fallback = rkInvocationErrorMessage(
    {
      message: "Command failed: /opt/homebrew/bin/rk daemon restart --full",
      signal: null,
      code: 1,
    },
    args,
    60_000,
    "/opt/homebrew/bin/rk",
  );
  assert.equal(timeout, "`rk daemon restart` timed out after 60s");
  assert.equal(fallback, "`rk daemon restart` failed");
  for (const message of [timeout, fallback]) {
    assert.equal(message.includes("--full"), false);
    assert.equal(message.includes("/opt/homebrew"), false);
  }
});

test("rk stderr stays useful while private flags and the binary path are redacted", () => {
  const message = rkInvocationErrorMessage(
    {
      signal: null,
      code: 1,
      stderr: "Error: /opt/homebrew/bin/rk daemon restart --full failed",
    },
    ["daemon", "restart", "--full"],
    60_000,
    "/opt/homebrew/bin/rk",
  );
  assert.equal(message, "Error: rk daemon restart failed");
});

test("an unsupported private restart flag becomes actionable version-skew guidance", () => {
  const message = rkInvocationErrorMessage(
    { signal: null, code: 1, stderr: "Error: unknown flag: --full" },
    ["daemon", "restart", "--full"],
    60_000,
    "/opt/homebrew/bin/rk",
  );
  assert.equal(
    message,
    "`rk daemon restart` requires a newer rk version; update rk and try again",
  );
  assert.equal(message.includes("--full"), false);
});

test("private flag text embedded in another token falls back without leaking it", () => {
  const message = rkInvocationErrorMessage(
    { signal: null, code: 1, stderr: "restart mode --full-preview failed" },
    ["daemon", "restart", "--full"],
    60_000,
    "rk",
  );
  assert.equal(message, "`rk daemon restart` failed");
  assert.equal(message.includes("--full"), false);
});

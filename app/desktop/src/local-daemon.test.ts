/**
 * node:test suite for the local-daemon pure logic (run via `pnpm run test`
 * after compile — the `servers.test.ts` convention). Compiled output is
 * excluded from packaging via the electron-builder `files` pattern.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  isDaemonAlreadyRunning,
  parseRkVersion,
  parseSessionCount,
  resolveRkBinary,
  rkCandidatePaths,
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

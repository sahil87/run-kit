/**
 * node:test suite for the local-daemon pure logic (run via `pnpm run test`
 * after compile — the `hosts.test.ts` convention). Compiled output is
 * excluded from packaging via the electron-builder `files` pattern.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  augmentPath,
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

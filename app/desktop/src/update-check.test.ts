/**
 * node:test suite for the update-check pure logic (run via `pnpm run test`
 * after compile — the `hosts.test.ts` convention). Compiled output is
 * excluded from packaging via the electron-builder `files` pattern.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  availableUpdateVersion,
  isUpdateCheckDue,
  parseDesktopStatus,
  UPDATE_CHECK_INTERVAL_MS,
} from "./update-check";

// Real CLI output shapes (cmd/rk/desktop.go runDesktopStatus — data channel).
const UPDATE_AVAILABLE =
  "Installed: v3.12.7\nLatest:    v3.13.0\nUpdate available — run 'rk desktop update'.\n";
const UP_TO_DATE = "Installed: v3.13.0\nLatest:    v3.13.0\nUp to date.\n";
const NOT_INSTALLED =
  "Installed: not installed\nLatest:    v3.13.0\nRun 'rk desktop install' to install.\n";

// ─── parseDesktopStatus ─────────────────────────────────────────────────────

test("parses the update-available output shape", () => {
  assert.deepEqual(parseDesktopStatus(UPDATE_AVAILABLE), {
    installedVersion: "3.12.7",
    latestVersion: "3.13.0",
    updateAvailable: true,
  });
});

test("parses the up-to-date output shape (no marker)", () => {
  assert.deepEqual(parseDesktopStatus(UP_TO_DATE), {
    installedVersion: "3.13.0",
    latestVersion: "3.13.0",
    updateAvailable: false,
  });
});

test("'Installed: not installed' does not parse as a version", () => {
  assert.deepEqual(parseDesktopStatus(NOT_INSTALLED), {
    installedVersion: null,
    latestVersion: "3.13.0",
    updateAvailable: false,
  });
});

test("keeps pre-release suffixes on parsed versions", () => {
  const report = parseDesktopStatus("Installed: v3.13.0-rc.1\nLatest:    v3.13.0-rc.2\n");
  assert.equal(report.installedVersion, "3.13.0-rc.1");
  assert.equal(report.latestVersion, "3.13.0-rc.2");
});

test("unrecognizable output parses to all-null/false, never throws", () => {
  assert.deepEqual(parseDesktopStatus("rk desktop is macOS-only\n"), {
    installedVersion: null,
    latestVersion: null,
    updateAvailable: false,
  });
  assert.deepEqual(parseDesktopStatus(""), {
    installedVersion: null,
    latestVersion: null,
    updateAvailable: false,
  });
});

// ─── availableUpdateVersion ─────────────────────────────────────────────────

test("derives the latest version when the marker and Latest line are present", () => {
  assert.equal(availableUpdateVersion(UPDATE_AVAILABLE), "3.13.0");
});

test("derives null for up-to-date, not-installed, and garbage output", () => {
  assert.equal(availableUpdateVersion(UP_TO_DATE), null);
  assert.equal(availableUpdateVersion(NOT_INSTALLED), null);
  assert.equal(availableUpdateVersion("no such command"), null);
  assert.equal(availableUpdateVersion(""), null);
});

test("marker without a parseable Latest version derives null (silent, no broken label)", () => {
  assert.equal(availableUpdateVersion("Update available — run 'rk desktop update'.\n"), null);
  assert.equal(
    availableUpdateVersion("Latest:    unknown\nUpdate available — run 'rk desktop update'.\n"),
    null,
  );
});

// ─── isUpdateCheckDue ───────────────────────────────────────────────────────

test("a never-checked (null) timestamp is due", () => {
  assert.equal(isUpdateCheckDue(null, 1_000_000), true);
});

test("a timestamp fresher than the interval is not due", () => {
  const now = 10 * UPDATE_CHECK_INTERVAL_MS;
  assert.equal(isUpdateCheckDue(now - UPDATE_CHECK_INTERVAL_MS + 1, now), false);
  assert.equal(isUpdateCheckDue(now, now), false);
});

test("a timestamp at or past the interval is due", () => {
  const now = 10 * UPDATE_CHECK_INTERVAL_MS;
  assert.equal(isUpdateCheckDue(now - UPDATE_CHECK_INTERVAL_MS, now), true);
  assert.equal(isUpdateCheckDue(now - 2 * UPDATE_CHECK_INTERVAL_MS, now), true);
});

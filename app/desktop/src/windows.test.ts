/**
 * node:test suite for the window-set store (run via `pnpm run test` after
 * compile — the `hosts.test.ts` convention).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyWindowSet,
  loadWindows,
  saveWindows,
  WindowSet,
} from "./windows";

function tmpDataDir(): string {
  return mkdtempSync(join(tmpdir(), "rk-desktop-windows-"));
}

function sampleSet(): WindowSet {
  return {
    version: 1,
    windows: [
      { hostId: "host-a", route: "/utils2/rk-dev?x=1", bounds: { width: 1280, height: 800 } },
      { hostId: null, route: "", bounds: { width: 900, height: 700, x: 40, y: 60 } },
    ],
  };
}

// ── load tolerance (missing / corrupt / wrong-shape → empty set) ─────────────

test("loadWindows returns an empty set for a missing file", () => {
  const dir = tmpDataDir();
  assert.deepEqual(loadWindows(dir), { version: 1, windows: [] });
});

test("loadWindows returns an empty set for corrupt JSON", () => {
  const dir = tmpDataDir();
  writeFileSync(join(dir, "windows.json"), "{ not json !!", "utf8");
  assert.deepEqual(loadWindows(dir), { version: 1, windows: [] });
});

test("loadWindows returns an empty set for wrong-shape JSON", () => {
  const dir = tmpDataDir();
  writeFileSync(
    join(dir, "windows.json"),
    JSON.stringify({ version: 2, windows: "nope" }),
    "utf8",
  );
  assert.deepEqual(loadWindows(dir), { version: 1, windows: [] });
});

test("loadWindows rejects the file on a wrong-typed required field", () => {
  const dir = tmpDataDir();
  writeFileSync(
    join(dir, "windows.json"),
    JSON.stringify({
      version: 1,
      windows: [{ hostId: 42, route: "/a", bounds: { width: 100, height: 100 } }],
    }),
    "utf8",
  );
  assert.deepEqual(loadWindows(dir), { version: 1, windows: [] });
});

test("loadWindows rejects the file on missing bounds", () => {
  const dir = tmpDataDir();
  writeFileSync(
    join(dir, "windows.json"),
    JSON.stringify({ version: 1, windows: [{ hostId: null, route: "" }] }),
    "utf8",
  );
  assert.deepEqual(loadWindows(dir), { version: 1, windows: [] });
});

test("loadWindows rejects the file on non-numeric bounds dimensions", () => {
  const dir = tmpDataDir();
  writeFileSync(
    join(dir, "windows.json"),
    JSON.stringify({
      version: 1,
      windows: [{ hostId: "a", route: "", bounds: { width: "800", height: 600 } }],
    }),
    "utf8",
  );
  assert.deepEqual(loadWindows(dir), { version: 1, windows: [] });
});

test("a wrong-typed optional bounds coordinate drops the field, never the file", () => {
  const dir = tmpDataDir();
  writeFileSync(
    join(dir, "windows.json"),
    JSON.stringify({
      version: 1,
      windows: [
        { hostId: "host-a", route: "/s1", bounds: { width: 800, height: 600, x: "bad", y: 12 } },
      ],
    }),
    "utf8",
  );
  assert.deepEqual(loadWindows(dir), {
    version: 1,
    windows: [{ hostId: "host-a", route: "/s1", bounds: { width: 800, height: 600, y: 12 } }],
  });
});

// ── save / load roundtrip ────────────────────────────────────────────────────

test("saveWindows + loadWindows round-trips the set", () => {
  const dir = tmpDataDir();
  saveWindows(dir, sampleSet());
  assert.deepEqual(loadWindows(dir), sampleSet());
});

test("saveWindows creates the directory when missing", () => {
  const dir = join(tmpDataDir(), "nested", "userData");
  saveWindows(dir, emptyWindowSet());
  assert.deepEqual(loadWindows(dir), emptyWindowSet());
});

test("saveWindows writes atomically via a tmp file that does not survive", () => {
  const dir = tmpDataDir();
  saveWindows(dir, sampleSet());
  assert.deepEqual(readdirSync(dir).sort(), ["windows.json"]);
  const onDisk = JSON.parse(readFileSync(join(dir, "windows.json"), "utf8"));
  assert.equal(onDisk.version, 1);
  assert.equal(onDisk.windows.length, 2);
});

test("record order is preserved (restore focus rides array order)", () => {
  const dir = tmpDataDir();
  saveWindows(dir, sampleSet());
  const loaded = loadWindows(dir);
  assert.deepEqual(
    loaded.windows.map((w) => w.hostId),
    ["host-a", null],
  );
});

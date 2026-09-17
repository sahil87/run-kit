/**
 * node:test suite for the web-tile guest registry pure logic (run via
 * `pnpm run test` after compile — the `views.test.ts` convention).
 *
 * The handle is a plain string here — the module is generic over it, which is
 * exactly what keeps it electron-free.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  addWebView,
  emptyWebViews,
  findWebViewBySender,
  getWebView,
  hostAttachPlan,
  hostDetachPlan,
  isGuestContents,
  removeHostWebViews,
  removeHostWebViewsEverywhere,
  removeWebView,
  removeWindowWebViews,
  setWebViewBounds,
  setWebViewChords,
  setWebViewVisible,
  WebViewsState,
} from "./web-views";

const WIN1 = 1;
const WIN2 = 2;

/** (win 1, host-a, host contents 11, guest contents 101) + a host-b sibling. */
function seeded(): WebViewsState<string> {
  let state = emptyWebViews<string>();
  state = addWebView(state, {
    windowId: WIN1,
    hostId: "host-a",
    hostContentsId: 11,
    tabKey: "t1",
    webContentsId: 101,
    handle: "guest-a1",
  });
  state = addWebView(state, {
    windowId: WIN1,
    hostId: "host-b",
    hostContentsId: 12,
    tabKey: "t1",
    webContentsId: 102,
    handle: "guest-b1",
  });
  return state;
}

// ── add / get (create-once per (hostContentsId, tabKey)) ─────────────────────

test("empty registry has no entries", () => {
  const state = emptyWebViews<string>();
  assert.equal(state.entries.length, 0);
  assert.equal(getWebView(state, 11, "t1"), null);
});

test("addWebView registers a fresh entry visible with zero bounds", () => {
  const state = addWebView(emptyWebViews<string>(), {
    windowId: WIN1,
    hostId: "host-a",
    hostContentsId: 11,
    tabKey: "t1",
    webContentsId: 101,
    handle: "guest-a1",
  });
  const entry = getWebView(state, 11, "t1");
  assert.ok(entry);
  assert.equal(entry.visible, true);
  assert.deepEqual(entry.bounds, { x: 0, y: 0, width: 0, height: 0 });
  assert.equal(entry.handle, "guest-a1");
});

test("addWebView for an existing (hostContentsId, tabKey) is a no-op (create-once)", () => {
  let state = addWebView(emptyWebViews<string>(), {
    windowId: WIN1,
    hostId: "host-a",
    hostContentsId: 11,
    tabKey: "t1",
    webContentsId: 101,
    handle: "guest-a1",
  });
  state = setWebViewVisible(state, 11, "t1", false);
  const next = addWebView(state, {
    windowId: WIN1,
    hostId: "host-a",
    hostContentsId: 11,
    tabKey: "t1",
    webContentsId: 999,
    handle: "guest-a1-replacement",
  });
  assert.equal(next, state); // unchanged — the caller destroys + recreates on collision
  assert.equal(getWebView(next, 11, "t1")?.handle, "guest-a1");
  assert.equal(getWebView(next, 11, "t1")?.visible, false);
});

// ── sender resolution / membership ───────────────────────────────────────────

test("findWebViewBySender isolates two host webContents sharing a tabKey", () => {
  let state = emptyWebViews<string>();
  state = addWebView(state, {
    windowId: WIN1,
    hostId: "host-a",
    hostContentsId: 11,
    tabKey: "t1",
    webContentsId: 101,
    handle: "guest-a1",
  });
  // The same host shown in a SECOND window is a second host webContents.
  state = addWebView(state, {
    windowId: WIN2,
    hostId: "host-a",
    hostContentsId: 22,
    tabKey: "t1",
    webContentsId: 102,
    handle: "guest-a2",
  });
  assert.equal(findWebViewBySender(state, 11, "t1")?.webContentsId, 101);
  assert.equal(findWebViewBySender(state, 22, "t1")?.webContentsId, 102);
  assert.equal(findWebViewBySender(state, 33, "t1"), null);
});

test("isGuestContents is true only for registered guest webContents ids", () => {
  const state = seeded();
  assert.equal(isGuestContents(state, 101), true);
  assert.equal(isGuestContents(state, 102), true);
  assert.equal(isGuestContents(state, 11), false); // the owning host's webContents
  assert.equal(isGuestContents(state, 999), false);
});

// ── visible / bounds records ─────────────────────────────────────────────────

test("setWebViewVisible and setWebViewBounds record the SPA-requested values", () => {
  let state = seeded();
  state = setWebViewVisible(state, 11, "t1", false);
  state = setWebViewBounds(state, 11, "t1", { x: 300, y: 100, width: 600, height: 400 });
  const entry = getWebView(state, 11, "t1");
  assert.ok(entry);
  assert.equal(entry.visible, false);
  assert.deepEqual(entry.bounds, { x: 300, y: 100, width: 600, height: 400 });
  // Siblings are untouched.
  assert.equal(getWebView(state, 12, "t1")?.visible, true);
});

test("mutators no-op on an unknown key", () => {
  const state = seeded();
  assert.equal(setWebViewVisible(state, 99, "t1", false), state);
  assert.equal(setWebViewBounds(state, 11, "nope", { x: 1, y: 2, width: 3, height: 4 }), state);
  const { state: afterRemove, removed } = removeWebView(state, 99, "t1");
  assert.equal(afterRemove, state);
  assert.equal(removed, null);
});

// ── scoped removals ──────────────────────────────────────────────────────────

test("removeWebView removes exactly one guest and returns it", () => {
  const state = seeded();
  const { state: next, removed } = removeWebView(state, 11, "t1");
  assert.equal(removed?.handle, "guest-a1");
  assert.equal(next.entries.length, 1);
  assert.ok(getWebView(next, 12, "t1")); // the host-b sibling survives
});

test("removeHostWebViews removes every guest of one host webContents", () => {
  let state = seeded();
  state = addWebView(state, {
    windowId: WIN1,
    hostId: "host-a",
    hostContentsId: 11,
    tabKey: "t2",
    webContentsId: 103,
    handle: "guest-a2",
  });
  const { state: next, removed } = removeHostWebViews(state, 11);
  assert.deepEqual(
    removed.map((e) => e.handle),
    ["guest-a1", "guest-a2"],
  );
  assert.equal(next.entries.length, 1);
  assert.ok(getWebView(next, 12, "t1"));
});

test("removeWindowWebViews removes every guest of one window", () => {
  let state = emptyWebViews<string>();
  state = addWebView(state, {
    windowId: WIN1,
    hostId: "host-a",
    hostContentsId: 11,
    tabKey: "t1",
    webContentsId: 101,
    handle: "guest-a1",
  });
  state = addWebView(state, {
    windowId: WIN1,
    hostId: "host-b",
    hostContentsId: 12,
    tabKey: "t1",
    webContentsId: 102,
    handle: "guest-b1",
  });
  state = addWebView(state, {
    windowId: WIN2,
    hostId: "host-a",
    hostContentsId: 21,
    tabKey: "t1",
    webContentsId: 201,
    handle: "guest-a-win2",
  });
  const { state: next, removed } = removeWindowWebViews(state, WIN1);
  assert.deepEqual(
    removed.map((e) => e.handle),
    ["guest-a1", "guest-b1"],
  );
  assert.equal(next.entries.length, 1);
  assert.ok(getWebView(next, 21, "t1"));
});

test("removeHostWebViewsEverywhere removes a host's guests across windows", () => {
  let state = emptyWebViews<string>();
  state = addWebView(state, {
    windowId: WIN1,
    hostId: "host-a",
    hostContentsId: 11,
    tabKey: "t1",
    webContentsId: 101,
    handle: "guest-a-win1",
  });
  state = addWebView(state, {
    windowId: WIN1,
    hostId: "host-b",
    hostContentsId: 12,
    tabKey: "t1",
    webContentsId: 102,
    handle: "guest-b1",
  });
  state = addWebView(state, {
    windowId: WIN2,
    hostId: "host-a",
    hostContentsId: 21,
    tabKey: "t1",
    webContentsId: 201,
    handle: "guest-a-win2",
  });
  const { state: next, removed } = removeHostWebViewsEverywhere(state, "host-a");
  assert.deepEqual(
    removed.map((e) => e.handle),
    ["guest-a-win1", "guest-a-win2"],
  );
  assert.equal(next.entries.length, 1);
  assert.ok(getWebView(next, 12, "t1"));
});

// ── attach / detach plans (the z-order authority) ────────────────────────────

test("hostDetachPlan lists every guest of the (window, host) regardless of visible", () => {
  let state = seeded(); // guest-a1 under (WIN1, host-a), guest-b1 under (WIN1, host-b)
  state = setWebViewVisible(state, 11, "t1", false);
  const plan = hostDetachPlan(state, WIN1, "host-a");
  assert.deepEqual(plan, ["guest-a1"]);
  // Pure query — the entry and its visible flag are untouched.
  assert.equal(getWebView(state, 11, "t1")?.visible, false);
  assert.equal(hostDetachPlan(state, WIN1, "host-c").length, 0);
  assert.equal(hostDetachPlan(state, WIN2, "host-a").length, 0);
});

test("hostAttachPlan preserves entries order and carries each entry's visible/bounds", () => {
  let state = emptyWebViews<string>();
  state = addWebView(state, {
    windowId: WIN1,
    hostId: "host-a",
    hostContentsId: 11,
    tabKey: "t1",
    webContentsId: 101,
    handle: "guest-a1",
  });
  state = addWebView(state, {
    windowId: WIN1,
    hostId: "host-a",
    hostContentsId: 11,
    tabKey: "t2",
    webContentsId: 102,
    handle: "guest-a2",
  });
  state = setWebViewBounds(state, 11, "t1", { x: 300, y: 100, width: 600, height: 400 });
  state = setWebViewVisible(state, 11, "t2", false);
  const plan = hostAttachPlan(state, WIN1, "host-a");
  assert.equal(plan.length, 2);
  assert.equal(plan[0]?.handle, "guest-a1");
  assert.equal(plan[0]?.visible, true);
  assert.deepEqual(plan[0]?.bounds, { x: 300, y: 100, width: 600, height: 400 });
  assert.equal(plan[1]?.handle, "guest-a2");
  assert.equal(plan[1]?.visible, false);
  // Pure query — the state is unchanged.
  assert.equal(getWebView(state, 11, "t1")?.visible, true);
});

test("z-order sequence: create under host-1 → switch away hides it → switch back re-raises with parked state", () => {
  // Create A (visible, parked bounds) and B (SPA-hidden) under host-1.
  let state = emptyWebViews<string>();
  state = addWebView(state, {
    windowId: WIN1,
    hostId: "host-1",
    hostContentsId: 11,
    tabKey: "a",
    webContentsId: 101,
    handle: "guest-A",
  });
  state = setWebViewBounds(state, 11, "a", { x: 300, y: 100, width: 600, height: 400 });
  state = addWebView(state, {
    windowId: WIN1,
    hostId: "host-1",
    hostContentsId: 11,
    tabKey: "b",
    webContentsId: 102,
    handle: "guest-B",
  });
  state = setWebViewVisible(state, 11, "b", false);

  // Switch to host-2: the detach plan hides BOTH guests (visible flag kept).
  const hidden = hostDetachPlan(state, WIN1, "host-1");
  assert.deepEqual(hidden, ["guest-A", "guest-B"]);
  assert.equal(getWebView(state, 11, "a")?.visible, true); // record untouched

  // Switch back: the attach plan re-raises A with its parked bounds and
  // visible flag, and B stays hidden.
  const plan = hostAttachPlan(state, WIN1, "host-1");
  assert.deepEqual(
    plan.map((p) => [p.handle, p.visible] as const),
    [
      ["guest-A", true],
      ["guest-B", false],
    ],
  );
  assert.deepEqual(plan[0]?.bounds, { x: 300, y: 100, width: 600, height: 400 });
});

// ── chords (the SPA-uploaded per-guest reclaim table) ───────────────────────

test("addWebView seeds an empty chord table", () => {
  const state = seeded();
  assert.deepEqual(getWebView(state, 11, "t1")?.chords, []);
});

test("setWebViewChords records the table; an unknown key is a no-op", () => {
  let state = seeded();
  const chords = [
    { code: "KeyK", ctrl: true, meta: false, shift: false, alt: false },
    { code: "Escape", ctrl: false, meta: false, shift: false, alt: false },
  ];
  state = setWebViewChords(state, 11, "t1", chords);
  assert.deepEqual(getWebView(state, 11, "t1")?.chords, chords);
  // The host-b sibling under the same tabKey is untouched.
  assert.deepEqual(getWebView(state, 12, "t1")?.chords, []);

  const before = state;
  assert.equal(setWebViewChords(state, 99, "t1", chords), before);
  assert.equal(setWebViewChords(state, 11, "nope", chords), before);
});

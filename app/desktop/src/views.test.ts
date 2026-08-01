/**
 * node:test suite for the per-host view registry pure logic (run via
 * `pnpm run test` after compile — the `hosts.test.ts` convention).
 *
 * The handle is a plain string here — the module is generic over it, which is
 * exactly what keeps it electron-free.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  activateView,
  activeView,
  addView,
  deactivateViews,
  emptyViews,
  findViewByWebContentsId,
  getView,
  removeView,
  setViewBadge,
  setViewThemeColor,
  switchPaint,
  ViewsState,
} from "./views";

function seeded(): ViewsState<string> {
  let state = emptyViews<string>();
  state = addView(state, "host-a", "view-a", 11);
  state = addView(state, "host-b", "view-b", 22);
  return state;
}

// ── add / get (lazy creation, one view per host) ─────────────────────────────

test("empty registry has no entries and no active view", () => {
  const state = emptyViews<string>();
  assert.equal(state.entries.length, 0);
  assert.equal(state.activeHostId, null);
  assert.equal(getView(state, "host-a"), null);
  assert.equal(activeView(state), null);
});

test("addView registers a fresh view with clean caches", () => {
  const state = addView(emptyViews<string>(), "host-a", "view-a", 11);
  const entry = getView(state, "host-a");
  assert.ok(entry);
  assert.equal(entry.handle, "view-a");
  assert.equal(entry.webContentsId, 11);
  assert.equal(entry.badgeCount, 0);
  assert.equal(entry.themeColor, null);
});

test("addView for an existing host is a no-op (create-once)", () => {
  let state = addView(emptyViews<string>(), "host-a", "view-a", 11);
  state = setViewBadge(state, "host-a", 3);
  const next = addView(state, "host-a", "view-a2", 99);
  assert.equal(next, state); // unchanged — caller must reuse the existing view
  assert.equal(getView(next, "host-a")?.handle, "view-a");
  assert.equal(getView(next, "host-a")?.badgeCount, 3);
});

test("entries preserve first-visit order", () => {
  const state = seeded();
  assert.deepEqual(
    state.entries.map((e) => e.hostId),
    ["host-a", "host-b"],
  );
});

// ── activate / deactivate ────────────────────────────────────────────────────

test("activateView sets the attached host; deactivateViews clears it", () => {
  let state = activateView(seeded(), "host-a");
  assert.equal(state.activeHostId, "host-a");
  assert.equal(activeView(state)?.handle, "view-a");
  state = activateView(state, "host-b");
  assert.equal(activeView(state)?.handle, "view-b");
  state = deactivateViews(state);
  assert.equal(state.activeHostId, null);
  assert.equal(activeView(state), null);
});

test("activateView with an unknown host is a no-op", () => {
  const state = activateView(seeded(), "nope");
  assert.equal(state.activeHostId, null);
});

test("deactivateViews keeps the per-view caches (welcome does not wipe them)", () => {
  let state = activateView(seeded(), "host-a");
  state = setViewBadge(state, "host-a", 4);
  state = deactivateViews(state);
  assert.equal(getView(state, "host-a")?.badgeCount, 4);
});

// ── remove ───────────────────────────────────────────────────────────────────

test("removeView returns the removed entry and clears an active pointer at it", () => {
  const before = activateView(seeded(), "host-b");
  const { state, removed } = removeView(before, "host-b");
  assert.equal(removed?.handle, "view-b");
  assert.equal(state.activeHostId, null);
  assert.equal(getView(state, "host-b"), null);
  assert.ok(getView(state, "host-a")); // the other view survives
});

test("removeView of a non-active host keeps the active pointer", () => {
  const before = activateView(seeded(), "host-a");
  const { state } = removeView(before, "host-b");
  assert.equal(state.activeHostId, "host-a");
});

test("removeView of an unknown host is a no-op with removed null", () => {
  const before = seeded();
  const { state, removed } = removeView(before, "nope");
  assert.equal(removed, null);
  assert.equal(state, before);
});

// ── badge cache (per view, webContents-id keyed sender resolution) ──────────

test("badge counts are cached per view — shared origins stay distinct", () => {
  // Two host ENTRIES can share one origin (addHost never dedupes); the caches
  // key on host id / webContents id, never on origin.
  let state = seeded();
  state = setViewBadge(state, "host-a", 2);
  state = setViewBadge(state, "host-b", 5);
  assert.equal(getView(state, "host-a")?.badgeCount, 2);
  assert.equal(getView(state, "host-b")?.badgeCount, 5);
});

test("setViewBadge for an unknown host is a no-op", () => {
  const before = seeded();
  const state = setViewBadge(before, "nope", 7);
  assert.equal(state, before);
});

test("findViewByWebContentsId resolves an IPC sender to its view", () => {
  const state = seeded();
  assert.equal(findViewByWebContentsId(state, 22)?.hostId, "host-b");
  assert.equal(findViewByWebContentsId(state, 99), null);
});

// ── theme-color cache ────────────────────────────────────────────────────────

test("theme colors are cached per view", () => {
  let state = seeded();
  state = setViewThemeColor(state, "host-a", "#112233");
  state = setViewThemeColor(state, "host-b", "#445566");
  assert.equal(getView(state, "host-a")?.themeColor, "#112233");
  assert.equal(getView(state, "host-b")?.themeColor, "#445566");
});

test("setViewThemeColor accepts null (page without a theme-color meta)", () => {
  let state = setViewThemeColor(seeded(), "host-a", "#112233");
  state = setViewThemeColor(state, "host-a", null);
  assert.equal(getView(state, "host-a")?.themeColor, null);
});

test("setViewThemeColor for an unknown host is a no-op", () => {
  const before = seeded();
  assert.equal(setViewThemeColor(before, "nope", "#112233"), before);
});

// ── switchPaint (the incoming-view repaint decision) ─────────────────────────

test("switchPaint on a fresh view clears the badge and defaults the color", () => {
  assert.deepEqual(switchPaint(seeded(), "host-a"), { badgeCount: 0, themeColor: null });
});

test("switchPaint on an unknown host clears the badge and defaults the color", () => {
  assert.deepEqual(switchPaint(seeded(), "nope"), { badgeCount: 0, themeColor: null });
});

test("switchPaint returns the INCOMING view's caches, never the outgoing one's", () => {
  let state = activateView(seeded(), "host-a");
  state = setViewBadge(state, "host-a", 2);
  state = setViewThemeColor(state, "host-a", "#112233");
  state = setViewBadge(state, "host-b", 5); // background report — cached silently
  state = setViewThemeColor(state, "host-b", "#445566");
  assert.deepEqual(switchPaint(state, "host-b"), {
    badgeCount: 5,
    themeColor: "#445566",
  });
  // and switching back repaints A's own caches
  assert.deepEqual(switchPaint(state, "host-a"), {
    badgeCount: 2,
    themeColor: "#112233",
  });
});

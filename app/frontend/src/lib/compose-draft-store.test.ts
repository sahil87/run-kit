import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  COMPOSE_DRAFTS_STORAGE_KEY,
  MAX_DRAFT_AGE_MS,
  MAX_PERSISTED_DRAFTS,
  clearComposeDraft,
  getComposeDraft,
  hydrateComposeDrafts,
  setComposeAttachments,
  setComposeText,
  subscribeComposeDraft,
} from "./compose-draft-store";

/** Parse the persisted map straight from localStorage (test-side view). */
function stored(): Record<string, { text: string; updatedAt: number }> {
  const raw = localStorage.getItem(COMPOSE_DRAFTS_STORAGE_KEY);
  return raw ? JSON.parse(raw) : {};
}

function attachment(name = "x.png", path = `/wt/.uploads/${name}`) {
  return { path, file: new File(["x"], name, { type: "image/png" }) };
}

describe("compose-draft-store", () => {
  beforeEach(() => {
    // Full reset: wipe persistence, then re-run the real module-load hydration
    // so the in-memory map starts empty.
    localStorage.clear();
    hydrateComposeDrafts();
  });
  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  // ── keyed isolation ─────────────────────────────────────────────────────────

  it("keeps drafts isolated per key", () => {
    setComposeText("srv:@1", "for A");
    expect(getComposeDraft("srv:@1").text).toBe("for A");
    expect(getComposeDraft("srv:@2").text).toBe("");

    setComposeText("srv:@2", "for B");
    expect(getComposeDraft("srv:@1").text).toBe("for A");
    expect(getComposeDraft("srv:@2").text).toBe("for B");
  });

  it("returns a stable empty draft for null and absent keys", () => {
    expect(getComposeDraft(null)).toBe(getComposeDraft(null));
    expect(getComposeDraft("nope:@0")).toBe(getComposeDraft(null));
    expect(getComposeDraft(null).text).toBe("");
    expect(getComposeDraft(null).attachments).toEqual([]);
  });

  it("keeps snapshot identity stable per key while unchanged, rebuilds on change", () => {
    setComposeText("srv:@1", "hello");
    const first = getComposeDraft("srv:@1");
    expect(getComposeDraft("srv:@1")).toBe(first);

    // A write to ANOTHER key must not remint this key's snapshot.
    setComposeText("srv:@2", "other");
    expect(getComposeDraft("srv:@1")).toBe(first);

    setComposeText("srv:@1", "hello again");
    expect(getComposeDraft("srv:@1")).not.toBe(first);
    expect(getComposeDraft("srv:@1").text).toBe("hello again");
  });

  it("supports updater forms scoped to the key", () => {
    setComposeText("srv:@1", "line1");
    setComposeText("srv:@1", (prev) => `${prev}\nline2`);
    expect(getComposeDraft("srv:@1").text).toBe("line1\nline2");

    const att = attachment();
    setComposeAttachments("srv:@1", (prev) => [...prev, att]);
    expect(getComposeDraft("srv:@1").attachments).toEqual([att]);
    // The other key's updater sees ITS empty state, not srv:@1's.
    setComposeText("srv:@2", (prev) => `${prev}B`);
    expect(getComposeDraft("srv:@2").text).toBe("B");
  });

  it("clears only the given key's draft; a redundant clear does not notify", () => {
    setComposeText("srv:@1", "keep?");
    setComposeText("srv:@2", "survivor");
    clearComposeDraft("srv:@1");
    expect(getComposeDraft("srv:@1").text).toBe("");
    expect(getComposeDraft("srv:@2").text).toBe("survivor");

    const listener = vi.fn();
    const unsub = subscribeComposeDraft(listener);
    clearComposeDraft("srv:@1"); // already empty → no-op
    expect(listener).not.toHaveBeenCalled();
    unsub();
  });

  it("notifies only on an actual change", () => {
    setComposeText("srv:@1", "same");
    const listener = vi.fn();
    const unsub = subscribeComposeDraft(listener);
    setComposeText("srv:@1", "same"); // unchanged → no notify
    expect(listener).not.toHaveBeenCalled();
    setComposeText("srv:@1", "different");
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });

  // ── persistence ─────────────────────────────────────────────────────────────

  it("round-trips draft text through localStorage across a re-hydration", () => {
    setComposeText("srv:@1", "persist me");
    setComposeText("srv:@2", "me too");

    // Simulate a page reload: module re-initialization re-runs hydration.
    hydrateComposeDrafts();
    expect(getComposeDraft("srv:@1").text).toBe("persist me");
    expect(getComposeDraft("srv:@2").text).toBe("me too");
  });

  it("never persists attachments; hydration restores text with empty attachments", () => {
    setComposeText("srv:@1", "/wt/.uploads/x.png");
    setComposeAttachments("srv:@1", [attachment()]);

    const entry = stored()["srv:@1"];
    expect(entry.text).toBe("/wt/.uploads/x.png");
    expect("attachments" in entry).toBe(false);

    hydrateComposeDrafts();
    expect(getComposeDraft("srv:@1").text).toBe("/wt/.uploads/x.png");
    expect(getComposeDraft("srv:@1").attachments).toEqual([]);
  });

  it("an attachments-only draft (empty text) is kept in memory but not persisted", () => {
    setComposeAttachments("srv:@1", [attachment()]);
    expect(getComposeDraft("srv:@1").attachments).toHaveLength(1);
    expect(stored()["srv:@1"]).toBeUndefined();
  });

  // ── tolerant parse ──────────────────────────────────────────────────────────

  it.each([
    ["malformed JSON", "not json {"],
    ["array root", "[1,2,3]"],
    ["scalar root", '"just a string"'],
  ])("degrades to an empty store on %s without throwing", (_label, raw) => {
    localStorage.setItem(COMPOSE_DRAFTS_STORAGE_KEY, raw);
    expect(() => hydrateComposeDrafts()).not.toThrow();
    expect(getComposeDraft("srv:@1").text).toBe("");
  });

  it("skips wrong-typed entries but keeps valid siblings", () => {
    localStorage.setItem(
      COMPOSE_DRAFTS_STORAGE_KEY,
      JSON.stringify({
        "srv:@1": { text: "valid", updatedAt: Date.now() },
        "srv:@2": { text: 42, updatedAt: Date.now() }, // wrong text type
        "srv:@3": { text: "no timestamp" }, // missing updatedAt
        "srv:@4": null, // not an object
        "srv:@5": { text: "", updatedAt: Date.now() }, // empty text
      }),
    );
    hydrateComposeDrafts();
    expect(getComposeDraft("srv:@1").text).toBe("valid");
    for (const key of ["srv:@2", "srv:@3", "srv:@4", "srv:@5"]) {
      expect(getComposeDraft(key).text).toBe("");
    }
  });

  // ── pruning ─────────────────────────────────────────────────────────────────

  it("drops a draft from storage when its text is cleared to empty", () => {
    setComposeText("srv:@1", "temp");
    expect(stored()["srv:@1"]).toBeDefined();
    setComposeText("srv:@1", "");
    expect(stored()["srv:@1"]).toBeUndefined();
    // Fully empty → the key is gone from the store as well.
    expect(getComposeDraft("srv:@1").text).toBe("");
  });

  it("caps persistence at the newest MAX_PERSISTED_DRAFTS by updatedAt", () => {
    vi.useFakeTimers();
    const base = Date.now();
    for (let i = 0; i <= MAX_PERSISTED_DRAFTS; i++) {
      vi.setSystemTime(base + i * 1000);
      setComposeText(`srv:@${i}`, `draft ${i}`);
    }
    const keys = Object.keys(stored());
    expect(keys).toHaveLength(MAX_PERSISTED_DRAFTS);
    expect(keys).not.toContain("srv:@0"); // oldest evicted
    expect(keys).toContain(`srv:@${MAX_PERSISTED_DRAFTS}`); // newest kept
  });

  it("drops entries older than MAX_DRAFT_AGE_MS at hydration", () => {
    const now = Date.now();
    localStorage.setItem(
      COMPOSE_DRAFTS_STORAGE_KEY,
      JSON.stringify({
        "srv:@old": { text: "stale", updatedAt: now - MAX_DRAFT_AGE_MS - 1000 },
        "srv:@new": { text: "fresh", updatedAt: now },
      }),
    );
    hydrateComposeDrafts();
    expect(getComposeDraft("srv:@old").text).toBe("");
    expect(getComposeDraft("srv:@new").text).toBe("fresh");
  });

  it("drops future-dated entries beyond the age window (two-sided clock-skew guard)", () => {
    const now = Date.now();
    localStorage.setItem(
      COMPOSE_DRAFTS_STORAGE_KEY,
      JSON.stringify({
        // Far future (e.g. corrupted storage / wildly-skewed clock): without a
        // two-sided check this would pass the age filter forever AND sort first,
        // squatting one of the MAX_PERSISTED_DRAFTS cap slots.
        "srv:@future": { text: "from the future", updatedAt: now + MAX_DRAFT_AGE_MS + 1000 },
        // Small forward skew (another tab's clock slightly ahead) stays valid.
        "srv:@skew": { text: "small skew ok", updatedAt: now + 1000 },
      }),
    );
    hydrateComposeDrafts();
    expect(getComposeDraft("srv:@future").text).toBe("");
    expect(getComposeDraft("srv:@skew").text).toBe("small skew ok");
  });

  it("drops stale entries on write too (persist-side age prune)", () => {
    vi.useFakeTimers();
    const base = Date.now();
    vi.setSystemTime(base);
    setComposeText("srv:@old", "will go stale");
    // Advance past the age limit, then write a different key: the stale entry
    // must fall out of the persisted map.
    vi.setSystemTime(base + MAX_DRAFT_AGE_MS + 1000);
    setComposeText("srv:@new", "fresh");
    expect(stored()["srv:@old"]).toBeUndefined();
    expect(stored()["srv:@new"]).toBeDefined();
  });

  it("removes the storage key entirely when no persistable drafts remain", () => {
    setComposeText("srv:@1", "only");
    expect(localStorage.getItem(COMPOSE_DRAFTS_STORAGE_KEY)).not.toBeNull();
    clearComposeDraft("srv:@1");
    expect(localStorage.getItem(COMPOSE_DRAFTS_STORAGE_KEY)).toBeNull();
  });
});

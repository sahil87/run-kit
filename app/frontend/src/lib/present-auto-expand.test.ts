import { describe, it, expect } from "vitest";
import {
  observeRkUrl,
  dismissAutoExpand,
  deactivateAutoExpand,
  foldLayoutMutation,
  withAutoWeb,
  type AutoExpandState,
} from "./present-auto-expand";
import type { Layout } from "./surface-layout";

const URL_A = "/present/mock.html?ts=1";
const URL_B = "/present/mock.html?ts=2";

/** Fold a sequence of observed rkUrl values, returning the final state. */
function observeAll(...urls: string[]): AutoExpandState {
  let state: AutoExpandState | undefined;
  for (const url of urls) state = observeRkUrl(state, url);
  // The sequence is never empty in these tests.
  if (!state) throw new Error("observeAll called with no urls");
  return state;
}

describe("observeRkUrl", () => {
  it("initialization never triggers (cold entry with rkUrl already set)", () => {
    const state = observeRkUrl(undefined, URL_A);
    expect(state).toEqual({ lastUrl: URL_A, active: false, dismissedUrl: null });
  });

  it("initialization trims whitespace and treats whitespace-only as empty", () => {
    const state = observeRkUrl(undefined, `  ${URL_A}  `);
    expect(state.lastUrl).toBe(URL_A);
    expect(observeRkUrl(undefined, "   ").lastUrl).toBe("");
  });

  it("triggers on an empty→set transition observed while mounted", () => {
    const state = observeAll("", URL_A);
    expect(state.active).toBe(true);
    expect(state.lastUrl).toBe(URL_A);
  });

  it("triggers on a value→different-value transition", () => {
    const state = observeAll(URL_A, URL_B);
    expect(state.active).toBe(true);
    expect(state.lastUrl).toBe(URL_B);
  });

  it("a set→empty transition does not trigger and deactivates", () => {
    const state = observeAll("", URL_A, "");
    expect(state).toEqual({ lastUrl: "", active: false, dismissedUrl: null });
  });

  it("a same-value SSE tick is a no-op (returns the state object unchanged)", () => {
    const before = observeAll("", URL_A);
    expect(observeRkUrl(before, URL_A)).toBe(before);
    expect(observeRkUrl(before, ` ${URL_A} `)).toBe(before);
  });

  it("suppresses a transition to the latched dismissal value", () => {
    const dismissed = dismissAutoExpand(observeAll("", URL_A));
    expect(dismissed).toEqual({ lastUrl: URL_A, active: false, dismissedUrl: URL_A });
    // Unset, then re-set the SAME value — the empty→X transition matches the latch.
    const state = observeAllFrom(dismissed, "", URL_A);
    expect(state.active).toBe(false);
    expect(state.lastUrl).toBe(URL_A);
  });

  it("a different value passes the latch and re-triggers (re-present)", () => {
    const dismissed = dismissAutoExpand(observeAll("", URL_A));
    const state = observeRkUrl(dismissed, URL_B);
    expect(state.active).toBe(true);
    expect(state.lastUrl).toBe(URL_B);
  });

  it("surviving the latch across window switches still suppresses the value", () => {
    // The remount catch-up keeps dismissedUrl and silently refreshes lastUrl
    // (app.tsx passes a state with lastUrl pre-set to the current value).
    const dismissed = dismissAutoExpand(observeAll("", URL_A));
    const remounted = observeRkUrl({ ...dismissed, lastUrl: URL_A, active: false }, URL_A);
    expect(remounted.active).toBe(false);
  });
});

/** Continue folding from an existing state. */
function observeAllFrom(state: AutoExpandState, ...urls: string[]): AutoExpandState {
  return urls.reduce((s, url) => observeRkUrl(s, url), state);
}

describe("deactivateAutoExpand", () => {
  it("clears active without latching (user took ownership keeping web)", () => {
    const active = observeAll("", URL_A);
    expect(deactivateAutoExpand(active)).toEqual({
      lastUrl: URL_A,
      active: false,
      dismissedUrl: null,
    });
  });
});

describe("foldLayoutMutation", () => {
  const single: Layout = { shape: "single", order: ["tty"] };
  const threeNoWeb: Layout = { shape: "main-left", order: ["tty", "code", "chat"] };
  const webOpen: Layout = { shape: "split-h", order: ["tty", "web"] };

  it("latches when the auto-opened web tile was rendered and the mutation closes it", () => {
    const active = observeAll("", URL_A);
    // Rendered layout is withAutoWeb(single) = tty+web; mutation collapses to tty.
    const folded = foldLayoutMutation(active, single, single);
    expect(folded).toEqual({ lastUrl: URL_A, active: false, dismissedUrl: URL_A });
  });

  it("deactivates without latching when the mutation keeps web", () => {
    const active = observeAll("", URL_A);
    const folded = foldLayoutMutation(active, single, webOpen);
    expect(folded).toEqual({ lastUrl: URL_A, active: false, dismissedUrl: null });
  });

  it("deactivates without latching when the override was a visual no-op (arity 3, no web)", () => {
    const active = observeAll("", URL_A);
    // The viewer never saw an auto-opened web tile — no latch, even though
    // the mutation's result lacks web.
    const shrunk: Layout = { shape: "split-h", order: ["tty", "code"] };
    const folded = foldLayoutMutation(active, threeNoWeb, shrunk);
    expect(folded).toEqual({ lastUrl: URL_A, active: false, dismissedUrl: null });
  });

  it("latches when web was already open (viewer saw it) and the mutation closes it", () => {
    const active = observeAll("", URL_A);
    const folded = foldLayoutMutation(active, webOpen, single);
    expect(folded).toEqual({ lastUrl: URL_A, active: false, dismissedUrl: URL_A });
  });

  it("is identity when the override is inactive", () => {
    const inactive = observeRkUrl(undefined, URL_A);
    expect(foldLayoutMutation(inactive, single, single)).toBe(inactive);
  });
});

describe("withAutoWeb", () => {
  const single: Layout = { shape: "single", order: ["tty"] };
  const split: Layout = { shape: "split-h", order: ["tty", "code"] };
  const threeNoWeb: Layout = { shape: "main-left", order: ["tty", "code", "chat"] };
  const webOpen: Layout = { shape: "split-h", order: ["tty", "web"] };

  it("is identity when the override is inactive", () => {
    expect(withAutoWeb(single, false)).toBe(single);
  });

  it("appends web through the growth shapes at arity 1 and 2", () => {
    expect(withAutoWeb(single, true)).toEqual({ shape: "split-h", order: ["tty", "web"] });
    expect(withAutoWeb(split, true)).toEqual({
      shape: "main-left",
      order: ["tty", "code", "web"],
    });
  });

  it("is identity at arity 3 without web (no fourth tile — no-op)", () => {
    expect(withAutoWeb(threeNoWeb, true)).toBe(threeNoWeb);
  });

  it("is identity when web is already open", () => {
    expect(withAutoWeb(webOpen, true)).toBe(webOpen);
  });
});

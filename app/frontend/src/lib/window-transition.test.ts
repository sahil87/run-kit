import { describe, it, expect, vi, afterEach } from "vitest";
import {
  windowSwitchDirection,
  shouldAnimateWindowSwitch,
  viewTransitionSupported,
  beginWindowSwitchGate,
  notifyFirstWrite,
  nextDirectionToken,
  isLatestDirectionToken,
} from "./window-transition";

describe("windowSwitchDirection", () => {
  const order = ["@0", "@1", "@2", "@3"];

  it("returns 'up' when the target sits below the current (higher index)", () => {
    expect(windowSwitchDirection(order, "@1", "@3")).toBe("up");
  });

  it("returns 'down' when the target sits above the current (lower index)", () => {
    expect(windowSwitchDirection(order, "@3", "@1")).toBe("down");
  });

  it("returns null when the current window is missing from the order", () => {
    expect(windowSwitchDirection(order, "@9", "@1")).toBeNull();
  });

  it("returns null when the target window is missing from the order", () => {
    expect(windowSwitchDirection(order, "@1", "@9")).toBeNull();
  });

  it("returns null when current and target are equal", () => {
    expect(windowSwitchDirection(order, "@2", "@2")).toBeNull();
  });

  it("returns null on an empty order", () => {
    expect(windowSwitchDirection([], "@0", "@1")).toBeNull();
  });
});

describe("shouldAnimateWindowSwitch", () => {
  const pass = {
    hasVTSupport: true,
    reducedMotion: false,
    hasOutgoingWindow: true,
    direction: "up" as const,
  };

  it("returns true when all gate conditions hold", () => {
    expect(shouldAnimateWindowSwitch(pass)).toBe(true);
  });

  it("returns false without View Transitions support", () => {
    expect(shouldAnimateWindowSwitch({ ...pass, hasVTSupport: false })).toBe(false);
  });

  it("returns false when reduced motion is set", () => {
    expect(shouldAnimateWindowSwitch({ ...pass, reducedMotion: true })).toBe(false);
  });

  it("returns false when there is no outgoing window", () => {
    expect(shouldAnimateWindowSwitch({ ...pass, hasOutgoingWindow: false })).toBe(false);
  });

  it("returns false when no direction resolved", () => {
    expect(shouldAnimateWindowSwitch({ ...pass, direction: null })).toBe(false);
  });
});

describe("viewTransitionSupported", () => {
  afterEach(() => {
    // Clean up any stub we set on document.
    delete (document as { startViewTransition?: unknown }).startViewTransition;
  });

  it("is false when document.startViewTransition is absent", () => {
    expect(viewTransitionSupported()).toBe(false);
  });

  it("is true when document.startViewTransition is a function", () => {
    (document as { startViewTransition?: unknown }).startViewTransition = () => {};
    expect(viewTransitionSupported()).toBe(true);
  });
});

describe("first-write gate (beginWindowSwitchGate / notifyFirstWrite)", () => {
  // The gate is released at message-RECEIPT time — TerminalClient calls
  // notifyFirstWrite() inside ws.onmessage, before the write/coalesce decision.
  // These tests drive notifyFirstWrite() directly, so they are agnostic to the
  // (former write-time vs. current receipt-time) caller; "write" below is
  // shorthand for "an incoming-byte notify".
  afterEach(() => {
    vi.useRealTimers();
    // Fire any lingering gate so a leaked resolver can't dangle across tests.
    notifyFirstWrite();
  });

  it("resolves when a notify arrives after openForNotify, before the timeout", async () => {
    const gate = beginWindowSwitchGate();
    gate.openForNotify();
    const wait = gate.waitForFirstWrite(1000);
    notifyFirstWrite();
    await expect(wait).resolves.toBeUndefined();
  });

  it("resolves on timeout when no notify arrives", async () => {
    vi.useFakeTimers();
    const gate = beginWindowSwitchGate();
    gate.openForNotify();
    const wait = gate.waitForFirstWrite(300);
    vi.advanceTimersByTime(300);
    await expect(wait).resolves.toBeUndefined();
  });

  it("ignores notifies that arrive before openForNotify (post-selectWindow gating)", async () => {
    vi.useFakeTimers();
    const gate = beginWindowSwitchGate();
    const wait = gate.waitForFirstWrite(300);
    // A busy OUTGOING window's stray receipt before the POST resolves must NOT
    // release the gate — the gate is not yet accepting notifies.
    notifyFirstWrite();
    let resolved = false;
    void wait.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    // Only after openForNotify does a write count.
    gate.openForNotify();
    notifyFirstWrite();
    await expect(wait).resolves.toBeUndefined();
  });

  it("notifyFirstWrite is a no-op when no gate is open", () => {
    expect(() => notifyFirstWrite()).not.toThrow();
  });

  it("supersession fires the pending gate immediately (no serialization)", async () => {
    vi.useFakeTimers();
    // First switch: gate opened and awaiting the first write.
    const first = beginWindowSwitchGate();
    first.openForNotify();
    const firstWait = first.waitForFirstWrite(300);
    let firstResolved = false;
    void firstWait.then(() => {
      firstResolved = true;
    });
    // A second switch begins <300ms later. It must FIRE the first gate at once
    // (not wait out the first's 300ms timeout) so a queued VT callback runs.
    beginWindowSwitchGate();
    await Promise.resolve();
    expect(firstResolved).toBe(true);
    // Crucially, no timers needed to advance — the resolution was synchronous.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a superseded gate's stale timer cannot clobber a newer gate's wait", async () => {
    vi.useFakeTimers();
    // First gate armed with a short timeout.
    const first = beginWindowSwitchGate();
    first.openForNotify();
    void first.waitForFirstWrite(100);
    // Second gate supersedes (fires + clears the first's timer) with a longer
    // timeout still pending.
    const second = beginWindowSwitchGate();
    second.openForNotify();
    const secondWait = second.waitForFirstWrite(300);
    let secondResolved = false;
    void secondWait.then(() => {
      secondResolved = true;
    });
    // Advancing past the FIRST gate's timeout must not resolve the second.
    vi.advanceTimersByTime(100);
    await Promise.resolve();
    expect(secondResolved).toBe(false);
    // The second gate resolves on its own timeout.
    vi.advanceTimersByTime(200);
    await expect(secondWait).resolves.toBeUndefined();
  });

  it("waitForFirstWrite on an already-superseded gate resolves immediately", async () => {
    vi.useFakeTimers();
    const first = beginWindowSwitchGate();
    first.openForNotify();
    // Supersede before the first ever awaited.
    beginWindowSwitchGate();
    // The stale gate's wait must not hang — it resolves at once.
    const staleWait = first.waitForFirstWrite(300);
    await expect(staleWait).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a stray notify after settle does not resolve a fresh gate early", async () => {
    vi.useFakeTimers();
    const first = beginWindowSwitchGate();
    first.openForNotify();
    const firstWait = first.waitForFirstWrite(100);
    vi.advanceTimersByTime(100); // first settles via timeout, clears the slot
    await firstWait;
    // A stray write now (no gate open) is a harmless no-op.
    notifyFirstWrite();
    // A fresh gate is unaffected: it waits for ITS own write/timeout.
    const second = beginWindowSwitchGate();
    second.openForNotify();
    const secondWait = second.waitForFirstWrite(100);
    notifyFirstWrite(); // this SHOULD resolve `second` — the fresh open gate
    await expect(secondWait).resolves.toBeUndefined();
  });

  it("resolves within its budget when the chained POST never settles (stalled selectWindow)", async () => {
    // Regression for the bounded-callback must-fix: the wrapper CHAINS
    // openForNotify off the selectWindow POST and awaits only the gate wait, so
    // the budget clock starts at the wait — NOT after the POST. A POST that
    // never settles (stalled `selectWindow`, no client fetch timeout) must not
    // extend the wait past its budget.
    vi.useFakeTimers();
    const gate = beginWindowSwitchGate();
    // A promise that never resolves models the stalled POST; openForNotify is
    // chained off it and therefore never runs.
    const stalledPost = new Promise<void>(() => {});
    void stalledPost.then(() => gate.openForNotify());
    const wait = gate.waitForFirstWrite(300);
    // The whole budget elapses with the POST still pending.
    vi.advanceTimersByTime(300);
    await expect(wait).resolves.toBeUndefined();
  });

  it("openForNotify chained via .then still ignores notifies before the POST resolves", async () => {
    // Models the wrapper's real shape: openForNotify runs only inside the POST's
    // .then, so a receipt before the POST resolves must be ignored, and only a
    // receipt after the .then has run releases the gate.
    vi.useFakeTimers();
    const gate = beginWindowSwitchGate();
    const wait = gate.waitForFirstWrite(300);
    let posted!: () => void;
    const post = new Promise<void>((r) => {
      posted = r;
    });
    void post.then(() => gate.openForNotify());
    // Outgoing window's stray receipt before the POST resolves: ignored.
    notifyFirstWrite();
    let resolved = false;
    void wait.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    // POST resolves → the chained openForNotify runs on the microtask.
    posted();
    await Promise.resolve();
    // Now an incoming byte's receipt counts and releases the gate.
    notifyFirstWrite();
    await expect(wait).resolves.toBeUndefined();
  });
});

describe("direction-attribute latest-wins guard (nextDirectionToken / isLatestDirectionToken)", () => {
  it("the freshly minted token is the latest", () => {
    const token = nextDirectionToken();
    expect(isLatestDirectionToken(token)).toBe(true);
  });

  it("a superseded (earlier) token is no longer the latest", () => {
    const first = nextDirectionToken();
    const second = nextDirectionToken();
    // A rapid second switch minted `second`, so the first switch's cleanup must
    // NOT clear the attribute the successor set.
    expect(isLatestDirectionToken(first)).toBe(false);
    expect(isLatestDirectionToken(second)).toBe(true);
  });

  it("tokens are monotonically increasing", () => {
    const a = nextDirectionToken();
    const b = nextDirectionToken();
    expect(b).toBeGreaterThan(a);
  });
});

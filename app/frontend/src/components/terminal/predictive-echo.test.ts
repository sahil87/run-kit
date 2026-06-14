import { describe, it, expect, beforeEach } from "vitest";
import {
  PredictiveEcho,
  RttEstimator,
  buildApplySequence,
  buildConfirmSequence,
  buildRollbackSequence,
  cupFor,
  tentativeSgr,
  isPrintableAscii,
  DEFAULT_SGR,
  ACTIVATION_SAMPLES,
  MIN_CONFIRM_WINDOW_MS,
  SRTT_ALPHA,
  type CellSnapshot,
  type CursorPosition,
  type SgrAttributes,
  type PredictionIO,
  type InputContext,
} from "./predictive-echo";

// ---------------------------------------------------------------------------
// Test fakes.
// ---------------------------------------------------------------------------

const NO_CTX: InputContext = { composing: false, pasting: false };

/** A snapshot at an ABSOLUTE buffer row + 0-based column. */
function snapshotAt(
  absRow: number,
  col: number,
  char = "",
  sgr: SgrAttributes = DEFAULT_SGR,
): CellSnapshot {
  return { absRow, col, char, sgr };
}

/**
 * A fake PredictionIO that records every write and uses a controllable clock.
 *
 * Crucially, the fake does NOT fabricate the cursor advance: `cursorPosition()`
 * returns a FIXED real-cursor position and `readCell()` returns a snapshot for
 * whatever absolute coordinates the ENGINE asks for. So if the engine's shadow
 * cursor were not advancing engine-side (SF2), every prediction in a burst would
 * snapshot the same `(absRow, col)` and the per-cell write assertions below
 * would fail — the fake can no longer paper over a missing engine-owned advance.
 *
 * `baseY` is controllable so the emit-time viewport conversion (MF2) can be
 * exercised: a snapshot taken at one baseY must still target the right viewport
 * row when confirm/rollback runs after the viewport has scrolled.
 */
class FakeIO implements PredictionIO {
  writes: string[] = [];
  alternate = false;
  clock = 0;
  baseYValue = 0;
  /** xterm's "real" cursor — fixed; the engine advances its OWN shadow from here. */
  realCursor: CursorPosition = { absRow: 0, col: 0 };

  write(data: string): void {
    this.writes.push(data);
  }
  cursorPosition(): CursorPosition | null {
    // A fresh object each call (the engine must not alias and mutate it).
    return { absRow: this.realCursor.absRow, col: this.realCursor.col };
  }
  readCell(absRow: number, col: number): CellSnapshot | null {
    // Echo back exactly the coordinates the engine asked for, so a missing
    // engine-side advance surfaces as a duplicate-coordinate write.
    return snapshotAt(absRow, col);
  }
  baseY(): number {
    return this.baseYValue;
  }
  isAlternateScreen(): boolean {
    return this.alternate;
  }
  now(): number {
    return this.clock;
  }
  reset(): void {
    this.writes = [];
  }
}

/**
 * Promote an engine to ACTIVE via the real PASSIVE bootstrap path: while
 * PASSIVE the engine enqueues observe-only predictions (no paint) for typed
 * printables; reconciling their in-window echoes drives the activation streak.
 * Uses chars outside the test's own probe set so it doesn't collide with the
 * subject keystrokes. The FakeIO clock stays at 0 so each round-trip is 0ms
 * (well inside the confirm-window).
 */
function activate(engine: PredictiveEcho, io: FakeIO): void {
  const bootChars = "0123456789";
  for (let i = 0; i < ACTIVATION_SAMPLES; i++) {
    const ch = bootChars[i];
    engine.onInput(ch, NO_CTX); // observe-only enqueue (PASSIVE, no write)
    engine.reconcile(ch); // in-window confirm -> activation streak++
  }
  io.reset(); // discard bootstrap bookkeeping so subject assertions are clean
}

// ---------------------------------------------------------------------------
// VT string builders.
// ---------------------------------------------------------------------------

describe("VT string builders", () => {
  // Every sequence is wrapped in DECSC (\x1b7) … DECRC (\x1b8) so the write is
  // cursor-neutral (MF1) — the server's bytes written right after reconciliation
  // must start from the cursor xterm left, not the one our CUP moved to.
  it("buildApplySequence is DECSC-wrapped: save, position, tentative SGR, glyph, reset, restore", () => {
    const snap = snapshotAt(2, 6); // absRow 2, col 6 (0-based)
    // baseY 0 → viewport row = 2 - 0 + 1 = 3; CUP col = 6 + 1 = 7.
    expect(buildApplySequence(snap, "x", 0)).toBe("\x1b7\x1b[3;7H\x1b[0;2;4mx\x1b[0m\x1b8");
  });

  it("tentative SGR layers underline+dim over the base attributes", () => {
    const base: SgrAttributes = { ...DEFAULT_SGR, bold: true, fg: [38, 5, 1] };
    // 0 (reset), 1 (bold), 2 (dim, added), 4 (underline, added), then fg.
    expect(tentativeSgr(base)).toBe("\x1b[0;1;2;4;38;5;1m");
  });

  it("buildConfirmSequence is DECSC-wrapped and re-writes glyph with server-normal SGR (no tentative)", () => {
    const snap = snapshotAt(2, 6, "", { ...DEFAULT_SGR, bold: true });
    // Normal styling: 0;1 (reset + bold). No dim/underline. DECSC/DECRC-wrapped.
    expect(buildConfirmSequence(snap, "x", 0)).toBe("\x1b7\x1b[3;7H\x1b[0;1mx\x1b[0m\x1b8");
  });

  it("buildRollbackSequence is DECSC-wrapped and restores the original char + SGR", () => {
    const snap = snapshotAt(4, 1, "a", { ...DEFAULT_SGR, italic: true });
    // baseY 0 → viewport row = 4 + 1 = 5; CUP col = 1 + 1 = 2.
    expect(buildRollbackSequence(snap, 0)).toBe("\x1b7\x1b[5;2H\x1b[0;3ma\x1b[0m\x1b8");
  });

  it("buildRollbackSequence writes a space for a previously-blank cell", () => {
    const snap = snapshotAt(4, 1, "");
    expect(buildRollbackSequence(snap, 0)).toBe("\x1b7\x1b[5;2H\x1b[0m \x1b[0m\x1b8");
  });

  // MF2: the snapshot stores an ABSOLUTE buffer row; the CUP is computed at EMIT
  // time from the LIVE baseY, so a viewport scroll between apply and emit lands
  // the write on the right physical line.
  it("cupFor converts an absolute row to a viewport CUP using the live baseY", () => {
    const snap = snapshotAt(10, 4); // absolute row 10, col 4 (0-based)
    // At apply time baseY=0 → viewport row 11.
    expect(cupFor(snap, 0)).toBe("\x1b[11;5H");
    // After the viewport scrolled by 7 rows (baseY=7) the SAME absolute cell is
    // now at viewport row 10 - 7 + 1 = 4 — NOT row 11. A stale viewport-row
    // snapshot would have kept targeting row 11 and corrupted an unrelated line.
    expect(cupFor(snap, 7)).toBe("\x1b[4;5H");
  });

  // SF-clamp: a prediction whose absolute row has scrolled off the TOP of the
  // viewport yields `absRow - baseY + 1 <= 0`. Unclamped, that emits row 0 (xterm
  // maps it to the top row) or a NEGATIVE row (unparseable CSI) → a stray glyph
  // on unrelated content. cupFor must clamp the viewport row to >= 1.
  it("clamps the viewport row to >= 1 when the absolute row scrolled off the top", () => {
    const snap = snapshotAt(3, 4); // absolute row 3, col 4 (0-based)
    // baseY 5 → raw viewport row = 3 - 5 + 1 = -1 (off the top). Clamp to 1.
    expect(cupFor(snap, 5)).toBe("\x1b[1;5H");
    // baseY 4 → raw viewport row = 3 - 4 + 1 = 0 (xterm's top row). Clamp to 1.
    expect(cupFor(snap, 4)).toBe("\x1b[1;5H");
    // Exactly at the top edge (baseY 3 → row 1) is already valid, no clamp.
    expect(cupFor(snap, 3)).toBe("\x1b[1;5H");
  });

  it("builders emit a clamped (>= 1) viewport row for an off-top prediction", () => {
    const snap = snapshotAt(2, 0, "q");
    // baseY 9 → raw row = 2 - 9 + 1 = -6 (scrolled well off the top). The
    // confirm/rollback CUP must clamp to row 1, never a negative/zero CSI.
    expect(buildConfirmSequence(snap, "q", 9)).toBe("\x1b7\x1b[1;1H\x1b[0mq\x1b[0m\x1b8");
    expect(buildRollbackSequence(snap, 9)).toBe("\x1b7\x1b[1;1H\x1b[0mq\x1b[0m\x1b8");
  });

  it("builders re-resolve the CUP under a scrolled baseY (MF2 end-to-end on a builder)", () => {
    const snap = snapshotAt(10, 0, "z");
    // Confirm emitted after a 7-row scroll: viewport row 10 - 7 + 1 = 4, col 1.
    expect(buildConfirmSequence(snap, "z", 7)).toBe("\x1b7\x1b[4;1H\x1b[0mz\x1b[0m\x1b8");
  });
});

describe("isPrintableAscii", () => {
  it("accepts single printable ASCII chars", () => {
    expect(isPrintableAscii("a")).toBe(true);
    expect(isPrintableAscii(" ")).toBe(true);
    expect(isPrintableAscii("~")).toBe(true);
  });
  it("rejects control chars, multi-char, and non-ASCII", () => {
    expect(isPrintableAscii("\r")).toBe(false);
    expect(isPrintableAscii("\x7f")).toBe(false);
    expect(isPrintableAscii("ab")).toBe(false);
    expect(isPrintableAscii("é")).toBe(false);
    expect(isPrintableAscii("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RTT estimator.
// ---------------------------------------------------------------------------

describe("RttEstimator", () => {
  it("smooths RTT toward each sample per the SRTT recurrence", () => {
    const est = new RttEstimator(100);
    const before = est.smoothedRttMs();
    est.update(20);
    // srtt moves ALPHA of the way from 100 toward 20.
    const expected = (1 - SRTT_ALPHA) * before + SRTT_ALPHA * 20;
    expect(est.smoothedRttMs()).toBeCloseTo(expected, 6);
  });

  it("floors the confirm-window at MIN_CONFIRM_WINDOW_MS", () => {
    const est = new RttEstimator(1);
    // Feed tiny samples so srtt + K*rttvar would fall below the floor.
    for (let i = 0; i < 50; i++) est.update(0.5);
    expect(est.confirmWindowMs()).toBe(MIN_CONFIRM_WINDOW_MS);
  });

  it("widens the window when samples are jittery", () => {
    const est = new RttEstimator(100);
    for (let i = 0; i < 20; i++) est.update(i % 2 === 0 ? 50 : 300);
    expect(est.confirmWindowMs()).toBeGreaterThan(MIN_CONFIRM_WINDOW_MS);
  });
});

// ---------------------------------------------------------------------------
// Confidence state machine.
// ---------------------------------------------------------------------------

describe("confidence state machine", () => {
  let io: FakeIO;
  let engine: PredictiveEcho;
  beforeEach(() => {
    io = new FakeIO();
    engine = new PredictiveEcho(io);
  });

  it("starts PASSIVE and paints nothing", () => {
    expect(engine.getState()).toBe("passive");
    engine.onInput("a", NO_CTX);
    // No glyph is written while PASSIVE (the enqueue is observe-only).
    expect(io.writes).toEqual([]);
    expect(engine.debugState().painted).toBe(0);
  });

  it("goes ACTIVE after ACTIVATION_SAMPLES in-window confirmations", () => {
    // PASSIVE: each typed printable enqueues observe-only; its in-window echo
    // (clock at 0 => 0ms round-trip) confirms and bumps the activation streak.
    const chars = "abc";
    for (let i = 0; i < ACTIVATION_SAMPLES - 1; i++) {
      engine.onInput(chars[i], NO_CTX);
      engine.reconcile(chars[i]);
    }
    expect(engine.getState()).toBe("passive");
    engine.onInput(chars[ACTIVATION_SAMPLES - 1], NO_CTX);
    engine.reconcile(chars[ACTIVATION_SAMPLES - 1]);
    expect(engine.getState()).toBe("active");
  });

  it("does not paint while still PASSIVE (observe-only enqueue)", () => {
    engine.onInput("a", NO_CTX);
    expect(io.writes).toEqual([]); // observe-only — no glyph painted
    expect(engine.unconfirmedCount()).toBe(1); // but it IS enqueued for learning
    expect(engine.debugState().painted).toBe(0);
  });

  it("resets the activation streak when an echo misses the window", () => {
    // One in-window confirm (0ms), then one OUT-of-window confirm (clock pushed
    // far past the confirm-window) which resets the streak, then a full run.
    engine.onInput("a", NO_CTX);
    engine.reconcile("a"); // in-window (streak = 1)
    io.clock = 100_000; // next round-trip is hugely out of window
    engine.onInput("b", NO_CTX);
    engine.reconcile("b"); // out of window -> streak resets to 0
    expect(engine.getState()).toBe("passive");
    io.clock = 100_000; // keep round-trips ~0 from here (enqueue & confirm same clock)
    for (let i = 0; i < ACTIVATION_SAMPLES; i++) {
      const ch = "cde"[i];
      engine.onInput(ch, NO_CTX);
      engine.reconcile(ch);
    }
    expect(engine.getState()).toBe("active");
  });

  it("auto-disables to PASSIVE on first reconciliation divergence", () => {
    activate(engine, io);
    engine.onInput("a", NO_CTX);
    expect(engine.getState()).toBe("active");
    expect(engine.unconfirmedCount()).toBe(1);
    // Inbound echo does NOT match "a" -> divergence.
    engine.reconcile("Z");
    expect(engine.getState()).toBe("passive");
    expect(engine.unconfirmedCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Painting + predictability gate.
// ---------------------------------------------------------------------------

describe("predictability gate", () => {
  let io: FakeIO;
  let engine: PredictiveEcho;
  beforeEach(() => {
    io = new FakeIO();
    engine = new PredictiveEcho(io);
    activate(engine, io);
  });

  it("paints + enqueues a printable while ACTIVE", () => {
    engine.onInput("a", NO_CTX);
    expect(engine.unconfirmedCount()).toBe(1);
    // Real cursor seeds the shadow at (absRow 0, col 0); baseY 0.
    expect(io.writes).toEqual([buildApplySequence(snapshotAt(0, 0), "a", 0)]);
  });

  it("advances its OWN shadow cursor across a burst (engine-owned, not IO-fabricated)", () => {
    // The FakeIO's real cursor is FIXED at (0,0) and readCell echoes whatever
    // coords it is handed — so if the engine did not advance its shadow itself,
    // both glyphs would snapshot (0,0). Distinct columns prove the engine owns
    // the advance (SF2 / R8).
    engine.onInput("a", NO_CTX);
    engine.onInput("b", NO_CTX);
    expect(io.writes).toEqual([
      buildApplySequence(snapshotAt(0, 0), "a", 0),
      buildApplySequence(snapshotAt(0, 1), "b", 0),
    ]);
  });

  it("does NOT paint in the alternate screen buffer", () => {
    io.alternate = true;
    engine.onInput("a", NO_CTX);
    expect(io.writes).toEqual([]);
    expect(engine.unconfirmedCount()).toBe(0);
  });

  it("does NOT paint during IME composition or bracketed paste", () => {
    engine.onInput("a", { composing: true, pasting: false });
    engine.onInput("b", { composing: false, pasting: true });
    expect(io.writes).toEqual([]);
    expect(engine.unconfirmedCount()).toBe(0);
  });

  it("does NOT paint control chars or escape sequences", () => {
    engine.onInput("\x1b", NO_CTX);
    engine.onInput("\x03", NO_CTX); // Ctrl-C
    expect(io.writes).toEqual([]);
    expect(engine.unconfirmedCount()).toBe(0);
  });

  it("does NOT paint Enter as a glyph (confirm-only)", () => {
    engine.onInput("\r", NO_CTX);
    expect(io.writes).toEqual([]);
    expect(engine.unconfirmedCount()).toBe(0);
  });
});

describe("backspace handling", () => {
  let io: FakeIO;
  let engine: PredictiveEcho;
  beforeEach(() => {
    io = new FakeIO();
    engine = new PredictiveEcho(io);
    activate(engine, io);
  });

  it("retracts the most-recent queued prediction (restore + dequeue)", () => {
    engine.onInput("a", NO_CTX);
    expect(engine.unconfirmedCount()).toBe(1);
    io.writes = [];
    engine.onInput("\x7f", NO_CTX); // DEL = backspace
    expect(engine.unconfirmedCount()).toBe(0);
    // Rollback restores the cell painted for "a" (absRow 0, col 0, blank), baseY 0.
    expect(io.writes).toEqual([buildRollbackSequence(snapshotAt(0, 0), 0)]);
  });

  it("retreats the shadow cursor on backspace so the next paint re-uses the cell", () => {
    engine.onInput("a", NO_CTX); // paints (0,0), shadow -> col 1
    io.writes = [];
    engine.onInput("\x7f", NO_CTX); // backspace: restore (0,0), shadow -> col 0
    engine.onInput("b", NO_CTX); // next paint must land back at (0,0)
    expect(io.writes).toEqual([
      buildRollbackSequence(snapshotAt(0, 0), 0),
      buildApplySequence(snapshotAt(0, 0), "b", 0),
    ]);
  });

  it("does nothing (no write) when the queue is empty — never edits a real cell", () => {
    engine.onInput("\x7f", NO_CTX);
    expect(io.writes).toEqual([]);
    expect(engine.unconfirmedCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Reconciliation queue.
// ---------------------------------------------------------------------------

describe("reconciliation queue", () => {
  let io: FakeIO;
  let engine: PredictiveEcho;
  beforeEach(() => {
    io = new FakeIO();
    engine = new PredictiveEcho(io);
    activate(engine, io);
  });

  it("is a no-op (no allocation work) when the queue is empty", () => {
    engine.reconcile("anything");
    expect(io.writes).toEqual([]);
    expect(engine.getState()).toBe("active");
  });

  it("confirms matched head bytes prefix-wise and leaves later predictions pending", () => {
    engine.onInput("a", NO_CTX);
    engine.onInput("b", NO_CTX);
    engine.onInput("c", NO_CTX);
    expect(engine.unconfirmedCount()).toBe(3);
    io.writes = [];
    engine.reconcile("ab"); // confirm a, b; c stays
    expect(engine.unconfirmedCount()).toBe(1);
    // Two confirm writes, for a (absRow0 col0) and b (absRow0 col1); baseY 0.
    expect(io.writes).toEqual([
      buildConfirmSequence(snapshotAt(0, 0), "a", 0),
      buildConfirmSequence(snapshotAt(0, 1), "b", 0),
    ]);
  });

  it("rolls back ALL outstanding predictions + clears the queue on divergence", () => {
    engine.onInput("a", NO_CTX);
    engine.onInput("b", NO_CTX);
    io.writes = [];
    engine.reconcile("X"); // X != a -> diverge
    expect(engine.unconfirmedCount()).toBe(0);
    expect(engine.getState()).toBe("passive");
    // Rollback newest-first: b (col1) then a (col0); baseY 0.
    expect(io.writes).toEqual([
      buildRollbackSequence(snapshotAt(0, 1), 0),
      buildRollbackSequence(snapshotAt(0, 0), 0),
    ]);
  });

  it("diverges mid-stream after confirming a matching prefix", () => {
    engine.onInput("a", NO_CTX);
    engine.onInput("b", NO_CTX);
    io.writes = [];
    engine.reconcile("aX"); // confirm a, then X != b -> diverge on remaining (b)
    expect(engine.unconfirmedCount()).toBe(0);
    expect(engine.getState()).toBe("passive");
    expect(io.writes).toEqual([
      buildConfirmSequence(snapshotAt(0, 0), "a", 0),
      buildRollbackSequence(snapshotAt(0, 1), 0),
    ]);
  });

  it("feeds confirmation round-trips into the RTT estimator", () => {
    io.clock = 0;
    engine.onInput("a", NO_CTX);
    const windowBefore = engine.confirmWindowMs();
    io.clock = 200; // 200ms round-trip — a large sample
    engine.reconcile("a");
    // A 200ms sample should push the smoothed window up from its seeded value.
    expect(engine.confirmWindowMs()).not.toBe(windowBefore);
  });

  it("leaves a residue-free queue once a full echo settles", () => {
    engine.onInput("h", NO_CTX);
    engine.onInput("i", NO_CTX);
    engine.reconcile("hi");
    expect(engine.unconfirmedCount()).toBe(0);
    expect(engine.debugState().mispredictions).toBe(0);
  });

  it("confirms against the LIVE baseY after a scroll — emit-time viewport conversion (MF2)", () => {
    // Seed the real cursor on an absolute row deep in the buffer, then scroll
    // the viewport AFTER painting but BEFORE the echo confirms. The confirm CUP
    // must be recomputed from the new baseY, not the apply-time one.
    io.realCursor = { absRow: 20, col: 0 };
    io.baseYValue = 10; // apply-time: viewport row = 20 - 10 + 1 = 11
    engine.onInput("a", NO_CTX);
    expect(io.writes).toEqual([buildApplySequence(snapshotAt(20, 0), "a", 10)]);
    io.writes = [];
    // Server output scrolls the viewport down by 5 rows before the echo lands.
    io.baseYValue = 15; // emit-time: viewport row = 20 - 15 + 1 = 6
    engine.reconcile("a");
    expect(io.writes).toEqual([buildConfirmSequence(snapshotAt(20, 0), "a", 15)]);
    // Concretely: row 6, NOT the stale apply-time row 11.
    expect(io.writes[0]).toContain("\x1b[6;1H");
  });

  it("rolls back against the LIVE baseY after a scroll (MF2 divergence path)", () => {
    io.realCursor = { absRow: 30, col: 2 };
    io.baseYValue = 25; // apply-time viewport row = 30 - 25 + 1 = 6
    engine.onInput("a", NO_CTX);
    io.writes = [];
    io.baseYValue = 28; // scrolled: viewport row = 30 - 28 + 1 = 3
    engine.reconcile("Z"); // divergence -> rollback
    expect(io.writes).toEqual([buildRollbackSequence(snapshotAt(30, 2), 28)]);
    expect(io.writes[0]).toContain("\x1b[3;3H");
  });
});

// ---------------------------------------------------------------------------
// Debug state / counters.
// ---------------------------------------------------------------------------

describe("debug state", () => {
  it("tracks painted, unconfirmed, and misprediction counters", () => {
    const io = new FakeIO();
    const engine = new PredictiveEcho(io);
    activate(engine, io);
    engine.onInput("a", NO_CTX);
    engine.onInput("b", NO_CTX);
    let dbg = engine.debugState();
    expect(dbg.painted).toBe(2);
    expect(dbg.unconfirmed).toBe(2);
    expect(dbg.mispredictions).toBe(0);
    engine.reconcile("Z"); // divergence
    dbg = engine.debugState();
    expect(dbg.mispredictions).toBe(1);
    expect(dbg.unconfirmed).toBe(0);
    expect(dbg.state).toBe("passive");
  });
});

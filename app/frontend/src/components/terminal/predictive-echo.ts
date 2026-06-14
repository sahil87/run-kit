/**
 * Predictive local echo (mosh-style) — pure engine.
 *
 * Ports the VS Code / sshx "typeahead" approach: predicted glyphs are written
 * into the xterm buffer as REAL cells via `terminal.write()`, and a
 * misprediction is undone by writing hand-authored VT escape sequences that
 * restore the overwritten cell. xterm v6 has no buffer-rollback API
 * (`IBufferCell` is read-only, `write()` is append-only — verified against
 * `@xterm/xterm@6.0.0` typings), so this engine constructs its own VT undo from
 * a snapshot of each cell before it is overwritten. Delegating layout (cell
 * geometry, auto-wrap, scroll/resize re-sync) to xterm is the whole reason this
 * approach is favoured over a DOM/canvas overlay — those become xterm's problem,
 * not ours.
 *
 * This module is intentionally PURE and DOM-free (mirroring
 * `board/select-live-panes.ts`): it depends on a live `Terminal` only through an
 * injected {@link PredictionIO} interface (write + cell-snapshot read), so the
 * queue, the confidence state machine, the reconciliation byte-matching, and the
 * VT apply/rollback string construction are all unit-testable without a DOM.
 * The thin binding in `terminal-client.tsx` supplies the real `terminal.write`
 * and `buffer.getCell` implementations.
 *
 * The feature is ALWAYS ON — there is no flag. Safety is the adaptive-confidence
 * reflex: the engine starts PASSIVE (observe, never paint), goes ACTIVE only
 * after observed round-trips confirm the pane echoes typed printables within an
 * adaptive (SRTT-style) confirm-window, and auto-disables back to PASSIVE on the
 * first reconciliation mismatch. That reflex is what covers password prompts (no
 * echo), vim/TUIs (alternate-screen + cursor-motion echoes), and any pane that
 * does not echo printables 1:1.
 */

// ---------------------------------------------------------------------------
// Named constants (no magic numbers — mirror IMMEDIATE_WRITE_MAX_BYTES style).
// ---------------------------------------------------------------------------

/**
 * SRTT smoothing factor (Jacobson/Karels, as used by TCP and mosh). The
 * smoothed round-trip estimate moves 1/8 of the way toward each new sample.
 */
export const SRTT_ALPHA = 1 / 8;

/**
 * RTT-variance smoothing factor (1/4, the classic TCP value). `rttvar` tracks
 * the mean deviation of samples from the smoothed estimate.
 */
export const SRTT_BETA = 1 / 4;

/**
 * Variance multiplier for the confirm-window: `window = srtt + K * rttvar`. 4 is
 * the canonical TCP/mosh value — wide enough to absorb normal jitter without
 * waiting so long that a genuinely-late echo is mistaken for a confirmation.
 */
export const CONFIRM_WINDOW_K = 4;

/**
 * Floor for the adaptive confirm-window. On loopback the true RTT is sub-ms, so
 * without a floor the window would collapse and normal scheduling jitter would
 * read as divergence. 50ms is comfortably above a frame while still feeling
 * instant.
 */
export const MIN_CONFIRM_WINDOW_MS = 50;

/**
 * Initial smoothed-RTT seed before any sample is observed. Keeps the first
 * confirm-window sane on a cold connection.
 */
export const INITIAL_SRTT_MS = 60;

/**
 * Consecutive in-window confirmations required to transition PASSIVE -> ACTIVE.
 * Mosh-style: prove the pane echoes printables 1:1 a few times before betting.
 */
export const ACTIVATION_SAMPLES = 3;

/** Printable-ASCII bounds (inclusive): space (0x20) .. tilde (0x7e). */
export const PRINTABLE_ASCII_MIN = 0x20;
export const PRINTABLE_ASCII_MAX = 0x7e;

/** Backspace as received from xterm onData (DEL, 0x7f) and the ASCII BS (0x08). */
const DEL = "\x7f";
const BS = "\x08";
/** Carriage return — Enter. Flushes/confirms; never painted as a glyph. */
const CR = "\r";

/**
 * DECSC (save cursor) / DECRC (restore cursor). Every apply/confirm/rollback
 * sequence is wrapped in this pair so the write is CURSOR-NEUTRAL: it saves
 * xterm's real cursor, moves away to paint the predicted cell, then restores the
 * cursor to exactly where the server left it. Without this, the bare CUP inside
 * each sequence would displace xterm's real cursor; the server's own bytes —
 * written immediately after reconciliation in `reconcileInbound` — would then
 * paint from the moved position, silently corrupting the buffer under
 * interleaved output. (MF1.)
 */
const DECSC = "\x1b7";
const DECRC = "\x1b8";

// ---------------------------------------------------------------------------
// Cell snapshot + VT string builders (pure).
// ---------------------------------------------------------------------------

/**
 * Snapshot of a single xterm cell, captured BEFORE a prediction overwrites it,
 * so the rollback sequence can restore it byte-for-byte. Mirrors the read-only
 * `IBufferCell` accessors we depend on (all public in 6.0.0).
 *
 * `absRow` is an ABSOLUTE buffer row (`baseY + cursorY`), NOT a viewport row.
 * This is load-bearing (MF2): confirm/rollback re-emit a CUP for this cell
 * LATER, after server output may have scrolled the viewport. Storing a viewport
 * row captured at apply time would target the wrong physical line by emit time;
 * storing the absolute buffer row and converting to a viewport CUP at EMIT time
 * (via the current `baseY` — see {@link cupFor}) keeps the write on the cell it
 * was snapshotted from. `col` is a 0-based column index (converted to 1-based at
 * emit time).
 */
export interface CellSnapshot {
  /** Absolute buffer row (`baseY + cursorY`) — converted to a viewport CUP row at emit time. */
  absRow: number;
  /** 0-based column index (converted to a 1-based CUP column at emit time). */
  col: number;
  /** The character previously in the cell (may be empty for a blank cell). */
  char: string;
  /** Reconstructed SGR parameters describing the cell's prior styling. */
  sgr: SgrAttributes;
}

/**
 * The subset of SGR state we reconstruct from an `IBufferCell` to rebuild a
 * cell. Colors are kept as resolved SGR parameter lists so the builders stay
 * pure string construction.
 */
export interface SgrAttributes {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  blink: boolean;
  inverse: boolean;
  invisible: boolean;
  strikethrough: boolean;
  /** Foreground SGR params (e.g. [38,5,n] or [38,2,r,g,b] or [39]); empty = default. */
  fg: number[];
  /** Background SGR params; empty = default. */
  bg: number[];
}

export const DEFAULT_SGR: SgrAttributes = {
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  blink: false,
  inverse: false,
  invisible: false,
  strikethrough: false,
  fg: [],
  bg: [],
};

/** CSI cursor-position (CUP): `ESC [ row ; col H` (1-based). */
function cup(row: number, col: number): string {
  return `\x1b[${row};${col}H`;
}

/**
 * Build the CUP for a snapshotted cell at EMIT time. Converts the snapshot's
 * ABSOLUTE buffer row to a 1-based VIEWPORT row using the CURRENT `baseY`
 * (`absRow - baseY + 1`) and the 0-based column to a 1-based CUP column. This is
 * the MF2 fix: the snapshot is captured at apply time but the CUP is emitted
 * later (on confirm/rollback), after server output may have scrolled the
 * viewport — recomputing against the live `baseY` keeps the write on the
 * snapshotted physical line.
 *
 * The viewport row is CLAMPED to >= 1 (SF-clamp): a prediction whose absolute
 * row has scrolled off the TOP of the viewport yields `absRow - baseY + 1 <= 0`.
 * An unclamped row 0 makes xterm target its top row, and a NEGATIVE value emits
 * an unparseable CSI — either way a stray confirm/rollback glyph flashes on
 * unrelated real content (it is overwritten by the in-flight server repaint
 * within a frame, but it is visible). Clamping to the top viewport row keeps the
 * stray paint on a defined cell, and the DECSC/DECRC wrapper restores the cursor
 * regardless, so the server's bytes still paint from the un-displaced cursor.
 */
export function cupFor(snapshot: CellSnapshot, baseY: number): string {
  const viewportRow = Math.max(1, snapshot.absRow - baseY + 1);
  return cup(viewportRow, snapshot.col + 1);
}

/** Reset all SGR attributes. */
const SGR_RESET = "\x1b[0m";

/** Build the SGR parameter string for a set of attributes (no leading ESC[). */
function sgrParams(attrs: SgrAttributes): number[] {
  const params: number[] = [0]; // start from a clean slate
  if (attrs.bold) params.push(1);
  if (attrs.dim) params.push(2);
  if (attrs.italic) params.push(3);
  if (attrs.underline) params.push(4);
  if (attrs.blink) params.push(5);
  if (attrs.inverse) params.push(7);
  if (attrs.invisible) params.push(8);
  if (attrs.strikethrough) params.push(9);
  if (attrs.fg.length) params.push(...attrs.fg);
  if (attrs.bg.length) params.push(...attrs.bg);
  return params;
}

function sgrSequence(attrs: SgrAttributes): string {
  return `\x1b[${sgrParams(attrs).join(";")}m`;
}

/**
 * The tentative ("predicted, not yet confirmed") styling: mosh-style
 * underline-until-confirmed, plus dim to read as provisional. Layered ON TOP of
 * the cell's prior attributes so a predicted glyph keeps the surrounding colors.
 */
export function tentativeSgr(base: SgrAttributes): string {
  return sgrSequence({ ...base, underline: true, dim: true });
}

/**
 * Wrap a paint body (CUP + SGR + glyph + reset) in DECSC/DECRC so the write is
 * cursor-neutral: save xterm's real cursor, paint the predicted cell, restore.
 * Every apply/confirm/rollback sequence goes through this — see {@link DECSC}.
 */
function cursorNeutral(body: string): string {
  return DECSC + body + DECRC;
}

/**
 * Apply sequence: save the cursor, move to the target cell, set tentative SGR,
 * write the glyph, reset SGR, restore the cursor. Pure — depends on the snapshot
 * (for base SGR + absolute position) and the live `baseY` (for the emit-time
 * viewport CUP, MF2). The DECSC/DECRC wrapper keeps it cursor-neutral (MF1).
 */
export function buildApplySequence(snapshot: CellSnapshot, glyph: string, baseY: number): string {
  return cursorNeutral(cupFor(snapshot, baseY) + tentativeSgr(snapshot.sgr) + glyph + SGR_RESET);
}

/**
 * Confirm sequence: re-write the (now server-authoritative) glyph at its
 * position WITHOUT the tentative SGR, so the cell settles to normal styling.
 * The confirmed glyph equals what was predicted (a confirmation means the echo
 * matched), restyled to the cell's server-normal attributes. Cursor-neutral
 * (MF1); the CUP is resolved against the live `baseY` at emit time (MF2).
 */
export function buildConfirmSequence(snapshot: CellSnapshot, glyph: string, baseY: number): string {
  return cursorNeutral(cupFor(snapshot, baseY) + sgrSequence(snapshot.sgr) + glyph + SGR_RESET);
}

/**
 * Rollback sequence: restore the snapshotted cell — move to it, re-apply its
 * original SGR, rewrite its original char (or a space if it was blank), reset.
 * The server repaint that follows divergence is authoritative; this just clears
 * our tentative residue so the buffer is correct in the meantime. Cursor-neutral
 * (MF1); the CUP is resolved against the live `baseY` at emit time (MF2).
 */
export function buildRollbackSequence(snapshot: CellSnapshot, baseY: number): string {
  const restoredChar = snapshot.char.length > 0 ? snapshot.char : " ";
  return cursorNeutral(cupFor(snapshot, baseY) + sgrSequence(snapshot.sgr) + restoredChar + SGR_RESET);
}

// ---------------------------------------------------------------------------
// SRTT-style adaptive estimator (pure state object).
// ---------------------------------------------------------------------------

/**
 * Mosh/TCP-style adaptive round-trip estimator. Tracks a smoothed RTT and its
 * variance; the confirm-window is `srtt + K*rttvar`, floored. Self-tunes across
 * loopback and (future) real-network latency, so a fixed loopback threshold
 * never mis-gates over a network — the reason this is adaptive from the start.
 */
export class RttEstimator {
  private srtt: number;
  private rttvar: number;

  constructor(initialSrttMs: number = INITIAL_SRTT_MS) {
    this.srtt = initialSrttMs;
    this.rttvar = initialSrttMs / 2;
  }

  /** Feed one confirmed round-trip sample (ms) into the estimate. */
  update(sampleMs: number): void {
    const delta = Math.abs(this.srtt - sampleMs);
    this.rttvar = (1 - SRTT_BETA) * this.rttvar + SRTT_BETA * delta;
    this.srtt = (1 - SRTT_ALPHA) * this.srtt + SRTT_ALPHA * sampleMs;
  }

  /** Current confirm-window in ms (floored at MIN_CONFIRM_WINDOW_MS). */
  confirmWindowMs(): number {
    return Math.max(MIN_CONFIRM_WINDOW_MS, this.srtt + CONFIRM_WINDOW_K * this.rttvar);
  }

  /** Current smoothed RTT (exposed for tests / introspection). */
  smoothedRttMs(): number {
    return this.srtt;
  }
}

// ---------------------------------------------------------------------------
// Engine types.
// ---------------------------------------------------------------------------

export type ConfidenceState = "passive" | "active";

/** A prediction awaiting reconciliation against the inbound echo stream. */
export interface PendingPrediction {
  /** The bytes we expect the server to echo for this keystroke (UTF-8 string). */
  expectedEcho: string;
  /** The cell as it was BEFORE we painted, for rollback. */
  snapshot: CellSnapshot;
  /** The glyph (== expectedEcho for a printable). */
  glyph: string;
  /** Page-clock time the prediction was enqueued, for the RTT sample. */
  enqueuedAt: number;
  /**
   * Whether a tentative glyph was actually written to the buffer. While PASSIVE
   * the engine enqueues OBSERVE-ONLY predictions (no write) purely to learn
   * round-trips — those have `painted = false`, so confirm/rollback emit no
   * writes for them. Once ACTIVE, predictions are painted (`painted = true`).
   */
  painted: boolean;
}

/** A cursor position in ABSOLUTE buffer coordinates (`row = baseY + cursorY`). */
export interface CursorPosition {
  /** Absolute buffer row. */
  absRow: number;
  /** 0-based column. */
  col: number;
}

/**
 * Injected IO seam — the ONLY coupling to a live terminal. The binding in
 * `terminal-client.tsx` supplies real implementations; tests supply fakes.
 *
 * The engine owns the SHADOW CURSOR (a prediction-local position distinct from
 * xterm's real cursor — R8/SF2): it reads xterm's real cursor only to SEED the
 * shadow cursor when no prediction is outstanding, then advances/retreats the
 * shadow itself as it paints/rolls back, so the IO never has to fabricate the
 * advance. The IO therefore exposes a position reader + a cell reader keyed by
 * absolute coordinates, NOT a "snapshot the cell under the cursor" call.
 */
export interface PredictionIO {
  /** Write a VT string to the terminal (maps to `terminal.write`). */
  write(data: string): void;
  /**
   * xterm's REAL cursor in absolute buffer coordinates. Read only to seed the
   * shadow cursor when the prediction queue is empty (no prediction in flight,
   * so xterm's cursor is authoritative). Returns `null` if it can't be read.
   * Maps to `{ absRow: baseY + cursorY, col: cursorX }`.
   */
  cursorPosition(): CursorPosition | null;
  /**
   * Snapshot the cell at an ABSOLUTE buffer position (the cell the next
   * prediction will overwrite, at the engine's shadow cursor). Returns `null` if
   * the cell can't be read (engine then skips the prediction). Maps to
   * `buffer.active.getLine(absRow)?.getCell(col)` reconstruction.
   */
  readCell(absRow: number, col: number): CellSnapshot | null;
  /**
   * The current viewport base row (`buffer.active.baseY`). Read at EMIT time so
   * the absolute-row snapshot converts to the correct viewport CUP even after
   * server output has scrolled the viewport (MF2).
   */
  baseY(): number;
  /** True while the active buffer is the alternate screen (vim/less/htop). */
  isAlternateScreen(): boolean;
  /** Monotonic page clock (ms). Injected so tests are deterministic. */
  now(): number;
}

/** Per-keystroke context the binding passes alongside the raw onData payload. */
export interface InputContext {
  /** True while an IME composition is in progress (suppress prediction). */
  composing: boolean;
  /** True while a bracketed-paste is being delivered (suppress prediction). */
  pasting: boolean;
}

/** Snapshot of engine state for the DEV-gated `__rkPredictions` test handle. */
export interface PredictionDebugState {
  state: ConfidenceState;
  /**
   * Queued (unconfirmed) predictions — the current `queue.length`. While ACTIVE
   * every queued prediction is painted, so this equals the painted-but-unconfirmed
   * count; while PASSIVE the queue also holds observe-only (unpainted) bootstrap
   * entries, so this is queued-not-yet-reconciled, not strictly painted.
   */
  unconfirmed: number;
  /** Cumulative mispredictions (divergence events) since construction. */
  mispredictions: number;
  /** Cumulative predictions painted (for the perceived-echo metric). */
  painted: number;
  confirmWindowMs: number;
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** True iff `data` is a single printable-ASCII character. */
export function isPrintableAscii(data: string): boolean {
  if (data.length !== 1) return false;
  const code = data.charCodeAt(0);
  return code >= PRINTABLE_ASCII_MIN && code <= PRINTABLE_ASCII_MAX;
}

// ---------------------------------------------------------------------------
// The engine.
// ---------------------------------------------------------------------------

/**
 * The predictive-echo engine. One instance per terminal connection. Drives all
 * paint/confirm/rollback writes through the injected {@link PredictionIO}; holds
 * the pending-prediction queue, the confidence state machine, the RTT estimator,
 * and a prediction-local shadow cursor.
 */
export class PredictiveEcho {
  private readonly io: PredictionIO;
  private readonly rtt = new RttEstimator();

  private state: ConfidenceState = "passive";
  /** Ordered queue: head is the oldest unconfirmed prediction. */
  private queue: PendingPrediction[] = [];
  /** Consecutive in-window confirmations observed while PASSIVE. */
  private passiveConfirmations = 0;

  /**
   * Prediction-local SHADOW CURSOR (R8/SF2): the column the NEXT prediction will
   * paint into, distinct from xterm's real cursor. `null` means "resync from
   * xterm's real cursor on the next paint" — the engine seeds it from
   * `io.cursorPosition()` whenever the queue is empty (no prediction in flight,
   * so xterm's cursor is authoritative), then advances it itself per paint and
   * retreats it on rollback/backspace. This is what lets the engine own the
   * advance instead of re-reading xterm's live cursor each keystroke.
   */
  private shadow: CursorPosition | null = null;

  // Counters for the DEV test handle / metrics.
  private mispredictions = 0;
  private painted = 0;

  constructor(io: PredictionIO) {
    this.io = io;
  }

  /** Current confidence state (for tests / introspection). */
  getState(): ConfidenceState {
    return this.state;
  }

  /** Number of predictions painted but not yet confirmed. */
  unconfirmedCount(): number {
    return this.queue.length;
  }

  /**
   * Cheap predicate: is there any prediction queued to reconcile against? When
   * false, `reconcile()` is a guaranteed no-op (it early-returns on an empty
   * queue), so the inbound binding can skip even DECODING the chunk — the
   * allocation-light gate for the inbound hot path (R10/A-025). True covers both
   * the ACTIVE-with-painted-predictions case AND the PASSIVE bootstrap
   * (observe-only predictions are still queued, and their echoes are what drive
   * activation), so gating on this never starves the PASSIVE→ACTIVE learning.
   */
  hasPending(): boolean {
    return this.queue.length > 0;
  }

  debugState(): PredictionDebugState {
    return {
      state: this.state,
      unconfirmed: this.queue.length,
      mispredictions: this.mispredictions,
      painted: this.painted,
      confirmWindowMs: this.rtt.confirmWindowMs(),
    };
  }

  /**
   * Drive the engine from an outbound keystroke. MUST be called AFTER the
   * unconditional `ws.send(data)` in the onData handler — prediction is
   * additive and never gates or alters the send.
   *
   * Returns nothing; any painting happens via the injected writer.
   */
  onInput(data: string, ctx: InputContext): void {
    // Hard exclusions that apply regardless of state.
    if (this.io.isAlternateScreen()) return; // full-screen TUIs
    if (ctx.composing || ctx.pasting) return; // IME / bracketed paste

    // Backspace: retract our own most-recent queued prediction ONLY. Never edit
    // a pre-existing real cell — with an empty queue, do nothing (the keystroke
    // was already sent to the WS unpredicted).
    if (data === DEL || data === BS) {
      this.retractLast();
      return;
    }

    // Enter: flush/confirm only — its EFFECTS (new prompt, output) are
    // unpredictable, so it is never painted as a glyph.
    if (data === CR) {
      // Enter neither paints nor pre-confirms; reconciliation against the
      // inbound stream handles confirmation. Nothing to do here beyond NOT
      // treating it as a printable.
      return;
    }

    // Only printable ASCII is a prediction candidate.
    if (!isPrintableAscii(data)) return;

    // ACTIVE: paint a tentative glyph and enqueue. PASSIVE: enqueue an
    // observe-only prediction (no write) so the engine can learn round-trips and
    // decide it is safe to go ACTIVE — the mosh-style bootstrap. Either way the
    // prediction is matched against the inbound echo in reconcile().
    this.enqueue(data, this.state === "active");
  }

  /**
   * Enqueue a prediction for a printable char. When `paint` is true a tentative
   * glyph is written to the buffer (ACTIVE); when false the prediction is
   * observe-only (PASSIVE bootstrap — no write, just round-trip learning).
   *
   * The cell snapshotted is the one at the SHADOW cursor (R8/SF2). When the
   * queue is empty the shadow is resynced from xterm's real cursor first (no
   * prediction in flight, so xterm is authoritative); thereafter the engine
   * advances the shadow itself, so successive predictions in one burst land in
   * successive cells without re-reading xterm's mid-burst (lagging) real cursor.
   */
  private enqueue(glyph: string, paint: boolean): void {
    const pos = this.shadowCursor();
    if (!pos) return; // can't establish a position -> skip safely
    const snapshot = this.io.readCell(pos.absRow, pos.col);
    if (!snapshot) return; // can't read the cell -> skip safely

    if (paint) {
      this.io.write(buildApplySequence(snapshot, glyph, this.io.baseY()));
      this.painted++;
    }
    this.queue.push({
      expectedEcho: glyph,
      snapshot,
      glyph,
      enqueuedAt: this.io.now(),
      painted: paint,
    });
    // Advance the shadow cursor past the painted cell. Wrap is delegated to
    // xterm (it reflows the real buffer); the shadow simply tracks the next
    // column so the following prediction in this burst lands one cell over.
    this.shadow = { absRow: pos.absRow, col: pos.col + 1 };
  }

  /**
   * Resolve the shadow cursor for the next paint. When the queue is empty there
   * is no prediction in flight, so xterm's real cursor is authoritative — reseed
   * the shadow from it. Otherwise the engine's own advanced shadow is current.
   */
  private shadowCursor(): CursorPosition | null {
    if (this.queue.length === 0) this.shadow = this.io.cursorPosition();
    return this.shadow;
  }

  /** Backspace: undo the most-recent queued prediction (restore + retreat). */
  private retractLast(): void {
    const last = this.queue.pop();
    if (!last) return; // nothing of ours to retract
    // Only emit a restore write if a glyph was actually painted; an observe-only
    // (PASSIVE) prediction left no residue to undo.
    if (last.painted) this.io.write(buildRollbackSequence(last.snapshot, this.io.baseY()));
    // Retreat the shadow cursor to the retracted cell so the next prediction
    // re-paints there (engine-owned advance/retreat — R8/SF2). When the queue is
    // now empty the next enqueue reseeds from xterm anyway, but keeping the
    // shadow coherent mid-burst is what makes the advance engine-owned.
    this.shadow = { absRow: last.snapshot.absRow, col: last.snapshot.col };
  }

  /**
   * Reconcile an inbound chunk against the pending-prediction queue. Called on
   * EVERY inbound chunk (both the immediate-write and coalesced flush paths).
   *
   * Hot-path discipline: when PASSIVE with an empty queue there is nothing to
   * match, so this returns immediately without allocating — the common idle
   * case stays as cheap as the existing `textByteLength` fast path.
   *
   * Matching is prefix-wise against the head of the queue: each leading byte of
   * `chunk` that equals the head's expected echo confirms (and pops) that
   * prediction. The FIRST byte that diverges from the next expected echo rolls
   * back ALL outstanding predictions, clears the queue, and drops to PASSIVE —
   * the in-flight server repaint then reconciles the buffer to truth.
   */
  reconcile(chunk: string): void {
    // Nothing enqueued => nothing to match against. This is the idle/PASSIVE
    // common case (PASSIVE only enqueues when the user is actively typing), so
    // a normal flood pays essentially nothing here — the hot-path early return.
    if (this.queue.length === 0) return;

    let i = 0;
    const now = this.io.now();
    while (i < chunk.length && this.queue.length > 0) {
      const head = this.queue[0];
      // expectedEcho is a single printable for v1; compare code units rather
      // than `chunk[i] === head.expectedEcho`, which would allocate a 1-char
      // string per inbound byte on the hot path (SF1 — R10/A-025
      // allocation-light contract).
      if (chunk.charCodeAt(i) === head.expectedEcho.charCodeAt(0)) {
        this.confirmHead(now);
        i++;
        continue;
      }
      // Divergence: a byte that does not match the next expected echo. Roll back
      // everything and re-enter observation.
      this.diverge();
      return;
    }
  }

  /**
   * Confirm the head prediction: settle a painted cell to normal styling, feed
   * the round-trip into the RTT estimator, and — while PASSIVE — count the
   * confirmation toward activation. The confirm-window is read BEFORE the RTT
   * update so the within-window test reflects the estimate at enqueue time.
   *
   * The PASSIVE→ACTIVE bootstrap lives here, NOT in a separate observed-echo
   * path: while PASSIVE the engine enqueues observe-only predictions (no paint),
   * so confirmations flow through this same method during the learning phase.
   * ACTIVATION_SAMPLES consecutive in-window confirmations promote to ACTIVE; an
   * out-of-window confirmation resets the streak (the pane echoes, but too
   * slowly to bet on yet).
   */
  private confirmHead(now: number): void {
    const head = this.queue.shift();
    if (!head) return;
    const roundTrip = now - head.enqueuedAt;
    const withinWindow = roundTrip <= this.rtt.confirmWindowMs();
    this.rtt.update(roundTrip);

    if (head.painted) {
      // ACTIVE prediction: settle the predicted cell to server-normal styling.
      // Resolve the CUP against the LIVE baseY at emit time (MF2) so a viewport
      // scroll since apply time does not land the restyle on the wrong row.
      this.io.write(buildConfirmSequence(head.snapshot, head.glyph, this.io.baseY()));
    }

    if (this.state === "passive") {
      if (withinWindow) {
        this.passiveConfirmations++;
        if (this.passiveConfirmations >= ACTIVATION_SAMPLES) {
          this.state = "active";
          this.passiveConfirmations = 0;
        }
      } else {
        this.passiveConfirmations = 0;
      }
    }
  }

  /** Current adaptive confirm-window (ms). */
  confirmWindowMs(): number {
    return this.rtt.confirmWindowMs();
  }

  /**
   * Roll back ALL outstanding predictions (newest first, so cursor restores
   * compose correctly), clear the queue, count a misprediction, and drop to
   * PASSIVE to re-learn. The server repaint already in flight is authoritative.
   */
  private diverge(): void {
    const baseY = this.io.baseY();
    for (let j = this.queue.length - 1; j >= 0; j--) {
      // Only painted predictions left visible residue to restore; observe-only
      // (PASSIVE-bootstrap) predictions wrote nothing. Resolve each CUP against
      // the LIVE baseY at emit time (MF2).
      if (this.queue[j].painted) {
        this.io.write(buildRollbackSequence(this.queue[j].snapshot, baseY));
      }
    }
    this.queue = [];
    // No prediction is in flight after a full rollback — drop the shadow cursor
    // so the next paint reseeds from xterm's (server-authoritative) real cursor.
    this.shadow = null;
    this.mispredictions++;
    this.state = "passive";
    this.passiveConfirmations = 0;
  }

  /**
   * Tear-down hook: clear queued predictions without emitting writes (the
   * terminal is being reset/disposed). Called from the connection cleanup.
   */
  reset(): void {
    this.queue = [];
    this.shadow = null;
    this.state = "passive";
    this.passiveConfirmations = 0;
  }
}

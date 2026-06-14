/**
 * Thin binding between the pure {@link PredictiveEcho} engine and a live
 * `@xterm/xterm` `Terminal`. This is the ONLY file that touches a real terminal
 * on the prediction path — it supplies the engine's injected
 * {@link PredictionIO} (write + cell-snapshot read + alt-screen flag + clock).
 *
 * The pure engine (`predictive-echo.ts`) holds all the logic and is unit-tested
 * without a DOM; this file is the glue that maps the engine's abstract calls
 * onto public `@xterm/xterm@6.0.0` API. It uses ONLY the public surface —
 * `terminal.write`, `terminal.buffer.active.{type,cursorX,cursorY,baseY}`,
 * `getLine(y)?.getCell(x)`, and the read-only `IBufferCell` accessors. There is
 * no `terminal._core` access: Approach A (buffer-write + self-authored VT
 * rollback) delegates layout to xterm, so the private render-dimensions seam the
 * DOM-overlay fallback would have needed is not used.
 *
 * SGR correctness comes entirely from the per-cell snapshot: each prediction
 * reads the OVERWRITTEN cell's prior styling directly via the read-only
 * `IBufferCell` accessors ({@link readSgr}), so the rollback/confirm sequences
 * reconstruct exactly what was there. There is NO `onWriteParsed` inbound-SGR
 * subscription — it is unnecessary under Approach A because (a) the snapshot
 * already captures the authoritative prior SGR, and (b) every paint is wrapped
 * in DECSC/DECRC so it never disturbs xterm's own SGR/cursor state for the
 * server's subsequent bytes. (An earlier draft claimed an `onWriteParsed`
 * tracker that was never wired; the claim was removed rather than implementing a
 * tracker the design does not need.)
 */
import type { Terminal, IBufferCell } from "@xterm/xterm";
import {
  PredictiveEcho,
  DEFAULT_SGR,
  type CellSnapshot,
  type CursorPosition,
  type PredictionIO,
  type SgrAttributes,
} from "./predictive-echo";

/**
 * Reconstruct the SGR parameters describing a cell's styling from a read-only
 * `IBufferCell`. The `is*` accessors return a number (0/non-0) in xterm's typings;
 * coerce to boolean. Colors are emitted as SGR parameter lists so the engine's
 * pure string builders can reproduce them:
 *   - default       -> [] (the builder omits it; the leading `0` reset covers it)
 *   - 256-palette   -> [38|48, 5, n]
 *   - true-color    -> [38|48, 2, r, g, b]
 */
function readSgr(cell: IBufferCell): SgrAttributes {
  return {
    bold: cell.isBold() !== 0,
    dim: cell.isDim() !== 0,
    italic: cell.isItalic() !== 0,
    underline: cell.isUnderline() !== 0,
    blink: cell.isBlink() !== 0,
    inverse: cell.isInverse() !== 0,
    invisible: cell.isInvisible() !== 0,
    strikethrough: cell.isStrikethrough() !== 0,
    fg: readColor(cell, "fg"),
    bg: readColor(cell, "bg"),
  };
}

function readColor(cell: IBufferCell, which: "fg" | "bg"): number[] {
  const isDefault = which === "fg" ? cell.isFgDefault() : cell.isBgDefault();
  if (isDefault) return [];
  const base = which === "fg" ? 38 : 48;
  const color = which === "fg" ? cell.getFgColor() : cell.getBgColor();
  const isRGB = which === "fg" ? cell.isFgRGB() : cell.isBgRGB();
  const isPalette = which === "fg" ? cell.isFgPalette() : cell.isBgPalette();
  if (isRGB) {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    return [base, 2, r, g, b];
  }
  if (isPalette) return [base, 5, color];
  return [];
}

/**
 * Build a {@link PredictionIO} backed by a real terminal. The engine owns the
 * shadow cursor (R8/SF2): it reads xterm's real cursor via {@link cursorPosition}
 * only to reseed when no prediction is in flight, then drives {@link readCell}
 * with the absolute coordinates of its own shadow cursor. Both `cursorPosition`
 * and `readCell` work in ABSOLUTE buffer coordinates (`absRow = baseY + cursorY`)
 * — the engine converts to a viewport CUP at emit time via {@link baseY} so a
 * post-apply viewport scroll cannot land confirm/rollback on the wrong row (MF2).
 *
 * A reusable `IBufferCell` is passed to `getCell` to avoid per-keystroke
 * allocation (xterm fills it in place) — the keystroke path is human-rate, but
 * the discipline mirrors the inbound hot-path's allocation-light style.
 */
export function createTerminalPredictionIO(
  terminal: Terminal,
  now: () => number = () => performance.now(),
): PredictionIO {
  // Scratch cell reused across snapshots (xterm fills it in place).
  let scratch: IBufferCell | undefined;

  return {
    write(data: string): void {
      terminal.write(data);
    },
    cursorPosition(): CursorPosition | null {
      const buf = terminal.buffer.active;
      return { absRow: buf.baseY + buf.cursorY, col: buf.cursorX };
    },
    readCell(absRow: number, col: number): CellSnapshot | null {
      const buf = terminal.buffer.active;
      const line = buf.getLine(absRow);
      if (!line) return null;
      scratch = line.getCell(col, scratch) ?? undefined;
      if (!scratch) return null;
      return {
        absRow, // absolute buffer row — converted to a viewport CUP at emit time
        col, // 0-based column — converted to a 1-based CUP column at emit time
        char: scratch.getChars(),
        sgr: readSgr(scratch),
      };
    },
    baseY(): number {
      return terminal.buffer.active.baseY;
    },
    isAlternateScreen(): boolean {
      return terminal.buffer.active.type === "alternate";
    },
    now,
  };
}

/**
 * Convenience constructor: wire a {@link PredictiveEcho} engine to a terminal in
 * one call. Returns the engine; the caller wires `onData`/reconcile/teardown.
 */
export function createPredictiveEcho(
  terminal: Terminal,
  now: () => number = () => performance.now(),
): PredictiveEcho {
  return new PredictiveEcho(createTerminalPredictionIO(terminal, now));
}

export { DEFAULT_SGR };

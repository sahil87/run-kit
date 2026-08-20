/**
 * Tty tile progress model (260819-1vxq).
 *
 * A pure, DOM-free module — the `window-view.ts` contract — mapping the
 * OSC 9;4 progress events surfaced by `@xterm/addon-progress` (through
 * `TerminalClient`'s `onProgressChange` seam) into the render state behind
 * the tty tile's 2px progress line and header percent chip.
 *
 * The signal is per-viewer ephemeral stream state: it lives only in the
 * component that observed it (no backend, no SSE, no persistence) and only
 * passthrough-wrapped emitters can feed it — tmux swallows raw OSC 9;4.
 */

/** OSC 9;4 state codes as the addon reports them. */
export const PROGRESS_REMOVE = 0;
export const PROGRESS_SET = 1;
export const PROGRESS_ERROR = 2;
export const PROGRESS_INDETERMINATE = 3;
export const PROGRESS_PAUSE = 4;

export type TtyProgress =
  | { kind: "idle" }
  | { kind: "determinate"; value: number }
  | { kind: "error"; value: number }
  | { kind: "indeterminate" }
  | { kind: "paused"; value: number };

export const IDLE_PROGRESS: TtyProgress = { kind: "idle" };

const clamp = (value: number): number => Math.min(Math.max(value, 0), 100);

/** The last committed percentage, for the error/pause last-known-width
 *  renders. The addon already substitutes its own retained value on an
 *  empty payload, so this only backstops a literal `0`. */
function lastValue(prev: TtyProgress): number {
  return prev.kind === "idle" || prev.kind === "indeterminate" ? 0 : prev.value;
}

/**
 * Fold one addon `{state, value}` event into render state. Unknown state
 * codes keep the previous state (the addon never emits them; a defensive
 * guard, not a reachable branch).
 */
export function reduceProgress(
  prev: TtyProgress,
  state: number,
  value: number,
): TtyProgress {
  switch (state) {
    case PROGRESS_REMOVE:
      return IDLE_PROGRESS;
    case PROGRESS_SET:
      return { kind: "determinate", value: clamp(value) };
    case PROGRESS_ERROR:
      return { kind: "error", value: clamp(value) || lastValue(prev) };
    case PROGRESS_INDETERMINATE:
      return { kind: "indeterminate" };
    case PROGRESS_PAUSE:
      return { kind: "paused", value: clamp(value) || lastValue(prev) };
    default:
      return prev;
  }
}

/** The value-carrying states — the ones the header percent chip renders for
 *  (the indeterminate sweep has no percentage to show; idle removes it). */
export function isValuedProgress(
  progress: TtyProgress,
): progress is Extract<TtyProgress, { value: number }> {
  return (
    progress.kind === "determinate" ||
    progress.kind === "error" ||
    progress.kind === "paused"
  );
}

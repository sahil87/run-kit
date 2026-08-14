/**
 * Readline editing chords for run-kit's two text-input surfaces — the docked
 * compose strip and the chat send form (260801-hsxm). Both textarea keydown
 * handlers route through this ONE helper (the consistency mirror of the shared
 * `classifyComposeEnter` Enter policy), intercepting ONLY the classic readline
 * chords that browsers/macOS leave unbound:
 *
 *   - Ctrl+U   kill from cursor to line start (readline unix-line-discard)
 *   - Ctrl+W   delete word backward
 *   - Alt+B    move cursor word backward
 *   - Alt+F    move cursor word forward
 *   - Alt+D    delete word forward
 *
 * Deliberately NOT intercepted: the natively-bound macOS Cocoa chords
 * (Ctrl+A/E/B/F/P/N/D/H/K/T/O/Y, Opt+arrows, Opt+Delete) — the native
 * implementations are correct and interplay with the system kill buffer
 * (reimplementing Ctrl+K would break its pairing with Ctrl+Y). None of them
 * match the five-chord set above under the exact-modifier rules here.
 *
 * Matching is on `KeyboardEvent.code` (KeyU/KeyW/KeyB/KeyF/KeyD), never on
 * `key`: on macOS, Alt+B/F/D compose `∫`/`ƒ`/`∂` into `key`, so key-based
 * matching would miss exactly the chords this layer exists for.
 *
 * Word boundaries are whitespace-delimited (the readline default), not
 * camelCase-aware. Deletions preserve the native undo stack via
 * `document.execCommand("delete")` (deprecated but the only undo-preserving
 * programmatic edit path); where execCommand is unavailable or reports
 * failure (jsdom, future removals) a controlled-component-safe fallback
 * applies the edit through the native value setter and a bubbled `input`
 * event so React state stays in sync — at the cost of undo for that edit.
 *
 * Platform caveat (documented, not solved): on Windows/Linux BROWSERS Ctrl+W
 * is browser-reserved (closes the tab before the page sees it) — the binding
 * works on macOS and in the desktop shell; win/linux web users keep native
 * Ctrl+Backspace. Ctrl+U (view-source) IS interceptable and works everywhere.
 *
 * Pure classification + cursor math are exported for unit tests without a
 * mount (the `palette-move.ts` extraction pattern); `handleReadlineKey` is the
 * thin DOM applier both surfaces call.
 */

/** The readline operations this layer implements. */
export type ReadlineAction =
  | "kill-to-line-start" // Ctrl+U
  | "delete-word-back" // Ctrl+W
  | "delete-word-forward" // Alt+D
  | "word-back" // Alt+B
  | "word-forward"; // Alt+F

/** The subset of a keyboard event the classifier reads — structural so both
 * native events and plain objects (tests) satisfy it. */
export interface ReadlineKeyInput {
  /** `KeyboardEvent.code` — layout-stable, unaffected by macOS Alt-composed
   * characters. */
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** From the native event — an IME-composing keydown is never intercepted. */
  isComposing: boolean;
}

/**
 * Classify a keydown against the five-chord readline set. Exact-modifier
 * matching: Meta or Shift anywhere → unhandled (native selection-extending and
 * system chords stay untouched); Ctrl chords reject Alt and vice versa.
 * Returns `null` for anything this layer does not own.
 */
export function classifyReadlineKey(key: ReadlineKeyInput): ReadlineAction | null {
  if (key.isComposing || key.metaKey || key.shiftKey) return null;
  if (key.ctrlKey && !key.altKey) {
    if (key.code === "KeyU") return "kill-to-line-start";
    if (key.code === "KeyW") return "delete-word-back";
    return null;
  }
  if (key.altKey && !key.ctrlKey) {
    if (key.code === "KeyB") return "word-back";
    if (key.code === "KeyF") return "word-forward";
    if (key.code === "KeyD") return "delete-word-forward";
    return null;
  }
  return null;
}

function isWhitespace(ch: string): boolean {
  return /\s/.test(ch);
}

function clamp(pos: number, len: number): number {
  return Math.max(0, Math.min(pos, len));
}

/** Index of the word start at/before `pos`: skip whitespace backward, then the
 * word's characters (whitespace-delimited, crossing newlines like readline). */
export function wordLeft(text: string, pos: number): number {
  let i = clamp(pos, text.length);
  while (i > 0 && isWhitespace(text[i - 1] as string)) i--;
  while (i > 0 && !isWhitespace(text[i - 1] as string)) i--;
  return i;
}

/** Index just past the word end at/after `pos`: skip whitespace forward, then
 * the word's characters. */
export function wordRight(text: string, pos: number): number {
  let i = clamp(pos, text.length);
  while (i < text.length && isWhitespace(text[i] as string)) i++;
  while (i < text.length && !isWhitespace(text[i] as string)) i++;
  return i;
}

/** Index of the current line's start (just past the previous `\n`, or 0). */
export function lineStart(text: string, pos: number): number {
  const p = clamp(pos, text.length);
  if (p === 0) return 0;
  const nl = text.lastIndexOf("\n", p - 1);
  return nl === -1 ? 0 : nl + 1;
}

/** The caret target for a motion action. Backward motions key on
 * `selectionStart`, forward motions on `selectionEnd` (readline has no
 * selection concept — a deterministic rule for non-collapsed selections). */
export function readlineMotionTarget(
  action: "word-back" | "word-forward",
  text: string,
  selStart: number,
  selEnd: number,
): number {
  return action === "word-back" ? wordLeft(text, selStart) : wordRight(text, selEnd);
}

/** The half-open delete range `[from, to)` for an edit action. May be empty
 * (e.g. Ctrl+U with the cursor already at line start). */
export function readlineDeleteRange(
  action: "kill-to-line-start" | "delete-word-back" | "delete-word-forward",
  text: string,
  selStart: number,
  selEnd: number,
): { from: number; to: number } {
  switch (action) {
    case "kill-to-line-start":
      return { from: lineStart(text, selStart), to: selStart };
    case "delete-word-back":
      return { from: wordLeft(text, selStart), to: selStart };
    case "delete-word-forward":
      return { from: selEnd, to: wordRight(text, selEnd) };
  }
}

/** The event surface `handleReadlineKey` needs — satisfied by a native
 * `KeyboardEvent` (call sites pass `e.nativeEvent`; its preventDefault /
 * stopPropagation act on the same underlying event React wraps). */
export interface ReadlineKeyEvent extends ReadlineKeyInput {
  preventDefault(): void;
  stopPropagation(): void;
}

/**
 * Try an undo-preserving `execCommand` edit: the browser records it on the
 * textarea's native undo stack and fires the `input` event React's
 * controlled-value onChange listens for. Returns false when execCommand is
 * missing or reports failure (jsdom, future removals) — the caller then falls
 * back to `commitValueFallback`.
 */
function tryExecCommand(command: "delete" | "insertText", value?: string): boolean {
  try {
    return (
      typeof document !== "undefined" &&
      typeof document.execCommand === "function" &&
      document.execCommand(command, false, value)
    );
  } catch {
    return false;
  }
}

/**
 * Controlled-component-safe fallback shared by the undo-preserving edits:
 * apply `next` through the PROTOTYPE value setter — bypassing React's
 * instance value tracker so the bubbled `input` event registers as a genuine
 * change — place the caret, and re-dispatch `input` manually. React state
 * stays in sync at the cost of undo for that edit.
 */
function commitValueFallback(el: HTMLTextAreaElement, next: string, caret: number): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  if (setter) setter.call(el, next);
  else el.value = next;
  el.setSelectionRange(caret, caret);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Undo-preserving range deletion: select the range, then `execCommand`
 * ("delete"). The fallback splices the value through the shared
 * prototype-setter path.
 */
function deleteRange(el: HTMLTextAreaElement, from: number, to: number): void {
  el.setSelectionRange(from, to);
  if (tryExecCommand("delete")) return;
  commitValueFallback(el, el.value.slice(0, from) + el.value.slice(to), from);
}

/**
 * Undo-preserving insertion at the caret (the compose strip's coarse-only ⏎
 * chip, 260814-ink6 — the local-newline path mobile keyboards cannot reach):
 * `execCommand("insertText")` replaces the current selection with `text`,
 * keeps the edit on the native undo stack, and lands the caret after the
 * inserted text. The fallback splices at the selection through the shared
 * prototype-setter path and leaves the caret after the inserted text. Either
 * way the store-controlled textarea sees the mutation through its onChange,
 * so the draft persists and auto-grows exactly as if typed.
 */
export function insertTextAtCaret(el: HTMLTextAreaElement, text: string): void {
  // execCommand operates on the DOCUMENT's focused element, not on `el` — a
  // caller whose click moved focus (or a programmatic path) would otherwise
  // edit the wrong element or fail. Capture the range first, then make `el`
  // the active edit target and re-assert that range so both the execCommand
  // path and the fallback act on the same selection.
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? start;
  if (document.activeElement !== el) el.focus();
  el.setSelectionRange(start, end);
  if (tryExecCommand("insertText", text)) return;
  commitValueFallback(
    el,
    el.value.slice(0, start) + text + el.value.slice(end),
    start + text.length,
  );
}

/**
 * Handle a textarea keydown against the readline chord set. Returns `true`
 * when the chord was consumed (preventDefault + stopPropagation applied —
 * mirroring the surfaces' Enter/Escape handling, so a handled chord never
 * reaches global chord listeners), `false` when the event is not this layer's
 * (native behavior proceeds). An empty edit range still consumes the chord but
 * performs no edit — a collapsed-selection `execCommand("delete")` would eat a
 * character backward.
 */
export function handleReadlineKey(e: ReadlineKeyEvent, el: HTMLTextAreaElement): boolean {
  const action = classifyReadlineKey(e);
  if (action === null) return false;
  e.preventDefault();
  e.stopPropagation();
  const text = el.value;
  const selStart = el.selectionStart ?? 0;
  const selEnd = el.selectionEnd ?? selStart;
  if (action === "word-back" || action === "word-forward") {
    const caret = readlineMotionTarget(action, text, selStart, selEnd);
    el.setSelectionRange(caret, caret);
    return true;
  }
  const { from, to } = readlineDeleteRange(action, text, selStart, selEnd);
  if (from < to) deleteRange(el, from, to);
  return true;
}

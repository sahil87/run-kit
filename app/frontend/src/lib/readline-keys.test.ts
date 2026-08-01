import { describe, it, expect, vi } from "vitest";
import {
  classifyReadlineKey,
  handleReadlineKey,
  lineStart,
  readlineDeleteRange,
  readlineMotionTarget,
  wordLeft,
  wordRight,
  type ReadlineKeyEvent,
  type ReadlineKeyInput,
} from "./readline-keys";

function key(overrides: Partial<ReadlineKeyInput> = {}): ReadlineKeyInput {
  return {
    code: "KeyU",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    ...overrides,
  };
}

describe("classifyReadlineKey", () => {
  it("maps the five readline chords by code", () => {
    expect(classifyReadlineKey(key({ ctrlKey: true, code: "KeyU" }))).toBe("kill-to-line-start");
    expect(classifyReadlineKey(key({ ctrlKey: true, code: "KeyW" }))).toBe("delete-word-back");
    expect(classifyReadlineKey(key({ altKey: true, code: "KeyB" }))).toBe("word-back");
    expect(classifyReadlineKey(key({ altKey: true, code: "KeyF" }))).toBe("word-forward");
    expect(classifyReadlineKey(key({ altKey: true, code: "KeyD" }))).toBe("delete-word-forward");
  });

  it("leaves natively-bound chords alone (only Ctrl+U/W and Alt+B/F/D are claimed)", () => {
    // Natively-bound macOS Ctrl chords must pass through untouched.
    for (const code of ["KeyA", "KeyE", "KeyK", "KeyB", "KeyF", "KeyD", "KeyY", "KeyP", "KeyN"]) {
      expect(classifyReadlineKey(key({ ctrlKey: true, code }))).toBeNull();
    }
    // Alt chords outside B/F/D are untouched.
    expect(classifyReadlineKey(key({ altKey: true, code: "KeyU" }))).toBeNull();
    expect(classifyReadlineKey(key({ altKey: true, code: "KeyW" }))).toBeNull();
  });

  it("requires exact modifiers — meta, shift, or a ctrl+alt mix is unhandled", () => {
    expect(classifyReadlineKey(key({ ctrlKey: true, metaKey: true, code: "KeyU" }))).toBeNull();
    expect(classifyReadlineKey(key({ ctrlKey: true, shiftKey: true, code: "KeyW" }))).toBeNull();
    expect(classifyReadlineKey(key({ altKey: true, shiftKey: true, code: "KeyB" }))).toBeNull();
    expect(classifyReadlineKey(key({ altKey: true, metaKey: true, code: "KeyF" }))).toBeNull();
    expect(classifyReadlineKey(key({ ctrlKey: true, altKey: true, code: "KeyD" }))).toBeNull();
  });

  it("never intercepts an IME-composing keydown", () => {
    expect(classifyReadlineKey(key({ ctrlKey: true, code: "KeyU", isComposing: true }))).toBeNull();
    expect(classifyReadlineKey(key({ altKey: true, code: "KeyB", isComposing: true }))).toBeNull();
  });

  it("plain (unmodified) keys are unhandled", () => {
    expect(classifyReadlineKey(key({ code: "KeyU" }))).toBeNull();
    expect(classifyReadlineKey(key({ code: "KeyB" }))).toBeNull();
  });
});

describe("word/line math (whitespace-delimited, readline defaults)", () => {
  const text = "one two  three";
  //            0123456789...  "one" [0,3) "two" [4,7) "three" [9,14)

  it("wordLeft skips trailing whitespace then the word", () => {
    expect(wordLeft(text, 14)).toBe(9); // from end → start of "three"
    expect(wordLeft(text, 9)).toBe(4); // start of "three" → start of "two"
    expect(wordLeft(text, 5)).toBe(4); // mid-"two" → its start
    expect(wordLeft(text, 0)).toBe(0); // at 0 stays
  });

  it("wordRight skips leading whitespace then the word", () => {
    expect(wordRight(text, 0)).toBe(3); // → end of "one"
    expect(wordRight(text, 3)).toBe(7); // end of "one" → end of "two"
    expect(wordRight(text, 7)).toBe(14); // "  three" → its end
    expect(wordRight(text, 14)).toBe(14); // at end stays
  });

  it("word motions cross newlines (\\n is whitespace)", () => {
    const multi = "alpha\nbeta";
    expect(wordLeft(multi, 6)).toBe(0); // start of "beta" → start of "alpha"
    expect(wordRight(multi, 5)).toBe(10); // end of "alpha" → end of "beta"
  });

  it("lineStart finds the current line's start", () => {
    const multi = "first line\nsecond";
    expect(lineStart(multi, 5)).toBe(0);
    expect(lineStart(multi, 11)).toBe(11); // just after the \n
    expect(lineStart(multi, 15)).toBe(11);
    expect(lineStart(multi, 0)).toBe(0);
    expect(lineStart("\nx", 0)).toBe(0); // pos 0 is before the leading \n
  });

  it("motion targets: backward keys on selectionStart, forward on selectionEnd", () => {
    expect(readlineMotionTarget("word-back", text, 9, 14)).toBe(4);
    expect(readlineMotionTarget("word-forward", text, 0, 3)).toBe(7);
  });

  it("delete ranges: kill-to-line-start, word-back, word-forward", () => {
    const multi = "first line\nsecond word";
    expect(readlineDeleteRange("kill-to-line-start", multi, 18, 18)).toEqual({ from: 11, to: 18 });
    expect(readlineDeleteRange("delete-word-back", text, 14, 14)).toEqual({ from: 9, to: 14 });
    expect(readlineDeleteRange("delete-word-forward", text, 3, 3)).toEqual({ from: 3, to: 7 });
    // Empty ranges at boundaries.
    expect(readlineDeleteRange("kill-to-line-start", multi, 11, 11)).toEqual({ from: 11, to: 11 });
    expect(readlineDeleteRange("delete-word-back", text, 0, 0)).toEqual({ from: 0, to: 0 });
    expect(readlineDeleteRange("delete-word-forward", text, 14, 14)).toEqual({ from: 14, to: 14 });
  });
});

/** A real jsdom textarea with value + selection, plus a fake chord event. */
function textarea(value: string, selStart: number, selEnd = selStart): HTMLTextAreaElement {
  const el = document.createElement("textarea");
  document.body.appendChild(el);
  el.value = value;
  el.setSelectionRange(selStart, selEnd);
  return el;
}

function chord(overrides: Partial<ReadlineKeyInput>): ReadlineKeyEvent & {
  preventDefault: ReturnType<typeof vi.fn<() => void>>;
  stopPropagation: ReturnType<typeof vi.fn<() => void>>;
} {
  return {
    ...key(overrides),
    preventDefault: vi.fn<() => void>(),
    stopPropagation: vi.fn<() => void>(),
  };
}

// jsdom has no document.execCommand, so these exercise the fallback path
// (native value setter + bubbled `input` event) — the same path a browser
// takes if execCommand ever reports failure.
describe("handleReadlineKey (textarea application)", () => {
  it("Ctrl+U kills from cursor to line start and fires a bubbled input event", () => {
    const el = textarea("first\nsecond half", 13); // cursor before the "h" of "half"
    const seen: string[] = [];
    el.addEventListener("input", () => seen.push(el.value));
    const e = chord({ ctrlKey: true, code: "KeyU" });
    expect(handleReadlineKey(e, el)).toBe(true);
    expect(el.value).toBe("first\nhalf"); // "second " removed — line 2 only
    expect(el.selectionStart).toBe(6);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
    expect(seen).toEqual(["first\nhalf"]); // React's controlled sync signal
  });

  it("Ctrl+W deletes the word before the cursor", () => {
    const el = textarea("one two three", 13);
    expect(handleReadlineKey(chord({ ctrlKey: true, code: "KeyW" }), el)).toBe(true);
    expect(el.value).toBe("one two ");
    expect(el.selectionStart).toBe(8);
  });

  it("Alt+D deletes the word after the cursor", () => {
    const el = textarea("one two three", 3);
    expect(handleReadlineKey(chord({ altKey: true, code: "KeyD" }), el)).toBe(true);
    expect(el.value).toBe("one three");
    expect(el.selectionStart).toBe(3);
  });

  it("Alt+B / Alt+F move the caret without editing", () => {
    const el = textarea("one two three", 13);
    expect(handleReadlineKey(chord({ altKey: true, code: "KeyB" }), el)).toBe(true);
    expect(el.value).toBe("one two three");
    expect(el.selectionStart).toBe(8);
    expect(handleReadlineKey(chord({ altKey: true, code: "KeyF" }), el)).toBe(true);
    expect(el.selectionStart).toBe(13);
  });

  it("an empty edit range consumes the chord but edits nothing", () => {
    const el = textarea("line", 0); // Ctrl+U at line start
    const seen = vi.fn();
    el.addEventListener("input", seen);
    const e = chord({ ctrlKey: true, code: "KeyU" });
    expect(handleReadlineKey(e, el)).toBe(true);
    expect(el.value).toBe("line");
    expect(e.preventDefault).toHaveBeenCalled();
    expect(seen).not.toHaveBeenCalled();
  });

  it("unhandled chords return false and touch nothing", () => {
    const el = textarea("text", 4);
    const e = chord({ ctrlKey: true, code: "KeyA" }); // natively-bound
    expect(handleReadlineKey(e, el)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(e.stopPropagation).not.toHaveBeenCalled();
    expect(el.value).toBe("text");
    expect(el.selectionStart).toBe(4);
  });

  it("with a non-collapsed selection, backward ops key on selectionStart", () => {
    const el = textarea("one two three", 8, 13); // "three" selected
    expect(handleReadlineKey(chord({ ctrlKey: true, code: "KeyW" }), el)).toBe(true);
    // delete-word-back from selectionStart (8) → removes "two " [4,8)
    expect(el.value).toBe("one three");
    expect(el.selectionStart).toBe(4);
  });
});

import { useLayoutEffect, type RefObject } from "react";

/** Max input rows before a textarea scrolls internally (bounded auto-grow). */
export const MAX_TEXTAREA_ROWS = 6;

/** Grow a `rows={1}` textarea to its content, bounded at `maxRows` (then
 *  internal scroll). The `height = "auto"` measurement resolves to the rows
 *  attribute, so the one-row box is the floor by construction. */
export function fitTextarea(el: HTMLTextAreaElement, maxRows: number = MAX_TEXTAREA_ROWS): void {
  el.style.height = "auto";
  const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
  const max = line * maxRows;
  el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
}

/** Re-fit the textarea on every text change (the store-controlled idiom: the
 *  draft arrives via props/store, so the effect keys on the text, not on
 *  input events). */
export function useTextareaAutogrow(
  ref: RefObject<HTMLTextAreaElement | null>,
  text: string,
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) fitTextarea(el);
  }, [ref, text]);
}

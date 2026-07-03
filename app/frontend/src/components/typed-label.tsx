import { useCallback, useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/lib/motion";

/**
 * Typed-label sweep — the section-label hover treatment in the hover-animation
 * vocabulary (change 260703-5ilm): on hover the label fades and an
 * inverse-video cursor (an accent-green cell OVER the character, like a
 * terminal block cursor sitting on text) sweeps from the FIRST cell, "typing"
 * each character back to full brightness — an invisible hand typing the label
 * out. After the pass the label stays bright (`rk-typed-done`) until the
 * pointer leaves.
 *
 * Fixed TOTAL duration: every label finishes in ~`TYPED_TOTAL_MS` regardless
 * of length (per-cell = total/len, clamped to `TYPED_STEP_MIN/MAX_MS`), so
 * short and long labels read as the same gesture when sweeping the sidebar.
 *
 * Width never changes mid-sweep — the cursor occupies the cell it is on (the
 * character renders inside the cursor cell in inverse video, never inserted
 * beside it). Purely decorative: labels keep their rest look and never gain
 * an interactive affordance. Reduced motion: the sweep is skipped entirely in
 * JS (`prefersReducedMotion()`) — the rest state IS the reduced-motion state.
 */
const TYPED_TOTAL_MS = 350;
const TYPED_STEP_MIN_MS = 20;
const TYPED_STEP_MAX_MS = 60;

function stepMs(len: number): number {
  return Math.min(
    TYPED_STEP_MAX_MS,
    Math.max(TYPED_STEP_MIN_MS, Math.round(TYPED_TOTAL_MS / Math.max(1, len))),
  );
}

export function TypedLabel({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  // null = at rest; 0..len-1 = the cursor's cell; >= len = done (bright).
  const [cursor, setCursor] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    stop();
    setCursor(null);
  }, [stop]);

  const start = useCallback(() => {
    stop();
    // Rest state IS the reduced-motion state — nothing to gate in CSS.
    if (prefersReducedMotion() || text.length === 0) return;
    setCursor(0);
    let i = 0;
    timerRef.current = setInterval(() => {
      i += 1;
      setCursor(i);
      if (i >= text.length) stop();
    }, stepMs(text.length));
  }, [stop, text]);

  useEffect(() => () => stop(), [stop]);
  // A text change mid-sweep would strand the cursor out of range — reset.
  useEffect(() => reset(), [text, reset]);

  const chars = Array.from(text);
  const done = cursor !== null && cursor >= chars.length;

  return (
    <span
      className={`rk-typed-label whitespace-pre ${done ? "rk-typed-done" : ""} ${className ?? ""}`}
      onPointerEnter={start}
      onPointerLeave={reset}
    >
      {cursor === null || done
        ? text
        : chars.map((ch, k) => (
            <span
              key={k}
              className={
                k < cursor
                  ? "rk-typed-on"
                  : k === cursor
                    ? "rk-typed-cursor"
                    : "rk-typed-off"
              }
            >
              {ch}
            </span>
          ))}
    </span>
  );
}

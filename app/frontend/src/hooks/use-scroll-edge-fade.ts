import { useEffect, useState, type RefObject } from "react";

/**
 * Scroll-edge fade detection (260813-kvk7): reports whether the observed
 * element has more content BELOW its current scroll position — i.e. it is
 * scrollable AND not scrolled to its end. Consumers toggle the
 * `rk-scroll-fade-bottom` mask utility on this value, so partially-clipped
 * content at the bottom cut edge fades out (reads as "more below") and the
 * fade disappears once the list is short or fully scrolled.
 *
 * Listens to scroll events, element/content resizes (ResizeObserver), and
 * child add/remove (MutationObserver) — no polling. Sub-pixel scroll reports
 * are absorbed by a small epsilon so the fade never flickers at the end.
 */
export function useScrollEdgeFade(ref: RefObject<HTMLElement | null>): boolean {
  const [hasOverflowBelow, setHasOverflowBelow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      setHasOverflowBelow(el.scrollHeight - el.clientHeight - el.scrollTop > 1);
    };
    update();

    el.addEventListener("scroll", update, { passive: true });
    // Panel resize / content resize without a scroll event.
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Rows/tiles added or removed change scrollHeight without firing scroll
    // or a resize of the container itself.
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true });

    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
      mo.disconnect();
    };
  }, [ref]);

  return hasOverflowBelow;
}

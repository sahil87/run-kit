import { useEffect } from "react";

export function useVisualViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    let rafId: number | null = null;
    let lastHeight = 0;
    let lastOffsetTop = 0;

    function apply() {
      rafId = null;
      if (!vv) return;
      const h = vv.height;
      const ot = vv.offsetTop;
      const changed = h !== lastHeight || ot !== lastOffsetTop;
      if (!changed) return;
      lastHeight = h;
      lastOffsetTop = ot;
      document.documentElement.style.setProperty("--app-height", `${h}px`);
      document.documentElement.style.setProperty("--app-offset-top", `${ot}px`);
    }

    function onViewportChange() {
      if (rafId) return;
      rafId = requestAnimationFrame(apply);
    }

    // Initial sync
    lastHeight = vv.height;
    lastOffsetTop = vv.offsetTop;
    document.documentElement.style.setProperty("--app-height", `${vv.height}px`);
    document.documentElement.style.setProperty("--app-offset-top", `${vv.offsetTop}px`);

    vv.addEventListener("resize", onViewportChange);
    vv.addEventListener("scroll", onViewportChange);

    return () => {
      vv.removeEventListener("resize", onViewportChange);
      vv.removeEventListener("scroll", onViewportChange);
      if (rafId) cancelAnimationFrame(rafId);
      document.documentElement.style.removeProperty("--app-height");
      document.documentElement.style.removeProperty("--app-offset-top");
    };
  }, []);
}

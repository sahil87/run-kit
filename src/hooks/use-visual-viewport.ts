"use client";

import { useEffect } from "react";

export function useVisualViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    let rafId: number | null = null;
    let lastHeight = 0;

    function apply() {
      rafId = null;
      if (!vv) return;
      const h = vv.height;
      if (h === lastHeight) return;
      lastHeight = h;
      document.documentElement.style.setProperty("--app-height", `${h}px`);
    }

    function onViewportChange() {
      if (rafId) return;
      rafId = requestAnimationFrame(apply);
    }

    // Initial sync (no rAF — run immediately)
    lastHeight = vv.height;
    document.documentElement.style.setProperty("--app-height", `${vv.height}px`);

    vv.addEventListener("resize", onViewportChange);
    vv.addEventListener("scroll", onViewportChange);

    return () => {
      vv.removeEventListener("resize", onViewportChange);
      vv.removeEventListener("scroll", onViewportChange);
      if (rafId) cancelAnimationFrame(rafId);
      document.documentElement.style.removeProperty("--app-height");
    };
  }, []);
}

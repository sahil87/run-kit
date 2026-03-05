"use client";

import { useEffect } from "react";

export function useVisualViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    function update() {
      if (!vv) return;
      document.documentElement.style.setProperty(
        "--app-height",
        `${vv.height}px`,
      );
    }

    update();
    vv.addEventListener("resize", update);

    return () => {
      vv.removeEventListener("resize", update);
      document.documentElement.style.removeProperty("--app-height");
    };
  }, []);
}

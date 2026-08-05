import { useEffect } from "react";

/** Height drop (px) below the un-keyboarded baseline that counts as the
 * on-screen keyboard opening. Must sit above iOS URL-bar chrome deltas
 * (~50–114px) and below any real keyboard (~260px+). */
export const KEYBOARD_DELTA_PX = 150;

export function useVisualViewport() {
  useEffect(() => {
    // Activate fullbleed — enables position:fixed, overflow:hidden on html/body/.app-shell
    // Applied unconditionally so it works even when visualViewport is unavailable.
    document.documentElement.classList.add("fullbleed");

    const vv = window.visualViewport;
    if (!vv) {
      return () => {
        document.documentElement.classList.remove("fullbleed");
      };
    }

    let rafId: number | null = null;
    let lastHeight = 0;
    let lastOffsetTop = 0;
    let lastWidth = 0;

    // Keyboard-open detection: an on-screen keyboard shrinks vv.height but
    // never vv.width, while rotations and window resizes change width — so
    // the un-keyboarded baseline is the max height observed since the last
    // width change. `kb-open` on <html> gates the bottom bar's raised
    // coarse-pointer safe floor (globals.css). (260805-fi9m)
    let baselineWidth = vv.width;
    let baselineHeight = vv.height;

    function syncKeyboardSignal(width: number, height: number) {
      if (width !== baselineWidth) {
        baselineWidth = width;
        baselineHeight = height;
      } else if (height > baselineHeight) {
        baselineHeight = height;
      }
      const open = height < baselineHeight - KEYBOARD_DELTA_PX;
      document.documentElement.classList.toggle("kb-open", open);
    }

    function apply() {
      rafId = null;
      if (!vv) return;
      const h = vv.height;
      const ot = vv.offsetTop;
      const w = vv.width;
      const changed = h !== lastHeight || ot !== lastOffsetTop || w !== lastWidth;
      if (!changed) return;
      lastHeight = h;
      lastOffsetTop = ot;
      lastWidth = w;
      document.documentElement.style.setProperty("--app-height", `${h}px`);
      document.documentElement.style.setProperty("--app-offset-top", `${ot}px`);
      syncKeyboardSignal(w, h);
    }

    function onViewportChange() {
      if (rafId) return;
      rafId = requestAnimationFrame(apply);
    }

    // Initial sync
    lastHeight = vv.height;
    lastOffsetTop = vv.offsetTop;
    lastWidth = vv.width;
    document.documentElement.style.setProperty("--app-height", `${vv.height}px`);
    document.documentElement.style.setProperty("--app-offset-top", `${vv.offsetTop}px`);
    syncKeyboardSignal(vv.width, vv.height);

    vv.addEventListener("resize", onViewportChange);
    vv.addEventListener("scroll", onViewportChange);

    return () => {
      vv.removeEventListener("resize", onViewportChange);
      vv.removeEventListener("scroll", onViewportChange);
      if (rafId) cancelAnimationFrame(rafId);
      document.documentElement.classList.remove("fullbleed");
      document.documentElement.classList.remove("kb-open");
      document.documentElement.style.removeProperty("--app-height");
      document.documentElement.style.removeProperty("--app-offset-top");
    };
  }, []);
}

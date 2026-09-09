/**
 * The gui tile's per-viewer render postures (spec surface-layout.md § State —
 * render postures are per-viewer localStorage, never the shared layout): the
 * view mode (`rk-gui-view`: "fit" | "1:1", absent = "fit") and the
 * viewer-local resize lock (`rk-gui-lock`: "1" = locked, absent = unlocked —
 * locked viewers never drive SetDesktopSize). Reads are validated on the way
 * in (untrusted-localStorage discipline); all writes are try/catch-noop.
 */

export type GuiViewMode = "fit" | "1:1";

const GUI_VIEW_KEY = "rk-gui-view";
const GUI_LOCK_KEY = "rk-gui-lock";

export function readGuiViewMode(): GuiViewMode {
  try {
    return localStorage.getItem(GUI_VIEW_KEY) === "1:1" ? "1:1" : "fit";
  } catch {
    return "fit";
  }
}

export function writeGuiViewMode(mode: GuiViewMode): void {
  try {
    localStorage.setItem(GUI_VIEW_KEY, mode);
  } catch {
    /* noop — best-effort persistence */
  }
}

export function readGuiResizeLocked(): boolean {
  try {
    return localStorage.getItem(GUI_LOCK_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeGuiResizeLocked(locked: boolean): void {
  try {
    if (locked) {
      localStorage.setItem(GUI_LOCK_KEY, "1");
    } else {
      localStorage.removeItem(GUI_LOCK_KEY);
    }
  } catch {
    /* noop — best-effort persistence */
  }
}

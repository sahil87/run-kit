/**
 * The gui tile's per-viewer render postures (spec surface-layout.md § State —
 * render postures are per-viewer localStorage, never the shared layout): the
 * zoom (`rk-gui-zoom`: "fit" | decimal percentage string from
 * GUI_ZOOM_STEPS, absent = "fit"; a legacy `rk-gui-view` of "1:1" reads as
 * 100 and is removed on write), the pointer mode (`rk-gui-pointer`: "touch"
 * | "trackpad", absent = the pointer-class default — "trackpad" on coarse,
 * "touch" on fine), the viewer-local resize lock (`rk-gui-lock`: "1" =
 * locked, absent = unlocked — locked viewers never drive SetDesktopSize),
 * and the bare-WM strip dismissal (`runkit-gui-wm-strip-dismissed`: "1" =
 * dismissed, absent = shown — cleared by the tile when `wm` becomes
 * non-empty so a LATER bare state shows the strip again). Reads are
 * validated on the way in (untrusted-localStorage discipline); all writes
 * are try/catch-noop.
 */

export type GuiZoom = "fit" | 50 | 75 | 100 | 125 | 150 | 200;

/** Ascending percentage rungs of the zoom ladder; "fit" is off-table. */
export const GUI_ZOOM_STEPS = [50, 75, 100, 125, 150, 200] as const;

export type GuiPointerMode = "touch" | "trackpad";

const GUI_ZOOM_KEY = "rk-gui-zoom";
const GUI_POINTER_KEY = "rk-gui-pointer";
const GUI_LOCK_KEY = "rk-gui-lock";
const GUI_WM_STRIP_DISMISSED_KEY = "runkit-gui-wm-strip-dismissed";

/** Retired `rk-gui-view` key; read once to seed the zoom posture, removed on write. */
const GUI_LEGACY_VIEW_KEY = "rk-gui-view";

function parseGuiZoom(raw: string): GuiZoom | null {
  if (raw === "fit") return "fit";
  const z = Number(raw);
  switch (z) {
    case 50:
    case 75:
    case 100:
    case 125:
    case 150:
    case 200:
      return z;
    default:
      return null;
  }
}

export function readGuiZoom(): GuiZoom {
  try {
    const raw = localStorage.getItem(GUI_ZOOM_KEY);
    if (raw !== null) {
      return parseGuiZoom(raw) ?? "fit";
    }
    return localStorage.getItem(GUI_LEGACY_VIEW_KEY) === "1:1" ? 100 : "fit";
  } catch {
    return "fit";
  }
}

export function writeGuiZoom(z: GuiZoom): void {
  try {
    localStorage.setItem(GUI_ZOOM_KEY, String(z));
    localStorage.removeItem(GUI_LEGACY_VIEW_KEY);
  } catch {
    /* noop — best-effort persistence */
  }
}

/**
 * Zoom ladder: up runs fit→100→125→150→200, down runs
 * 200→150→125→100→75→50→fit; both ends saturate. Zooming in from "fit"
 * lands on 100 (never 50/75) by design.
 */
export function stepGuiZoom(current: GuiZoom, direction: 1 | -1): GuiZoom {
  if (current === "fit") {
    return direction === 1 ? 100 : "fit";
  }
  const next = GUI_ZOOM_STEPS[GUI_ZOOM_STEPS.indexOf(current) + direction];
  if (next === undefined) {
    return direction === 1 ? current : "fit";
  }
  return next;
}

export function readGuiPointerMode(coarsePointer: boolean): GuiPointerMode {
  try {
    const raw = localStorage.getItem(GUI_POINTER_KEY);
    if (raw === "touch" || raw === "trackpad") {
      return raw;
    }
  } catch {
    /* fall through to the pointer-class default */
  }
  return coarsePointer ? "trackpad" : "touch";
}

export function writeGuiPointerMode(m: GuiPointerMode): void {
  try {
    localStorage.setItem(GUI_POINTER_KEY, m);
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

export function readGuiWmStripDismissed(): boolean {
  try {
    return localStorage.getItem(GUI_WM_STRIP_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeGuiWmStripDismissed(dismissed: boolean): void {
  try {
    if (dismissed) {
      localStorage.setItem(GUI_WM_STRIP_DISMISSED_KEY, "1");
    } else {
      localStorage.removeItem(GUI_WM_STRIP_DISMISSED_KEY);
    }
  } catch {
    /* noop — best-effort persistence */
  }
}

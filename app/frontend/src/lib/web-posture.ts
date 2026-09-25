/**
 * The web tile's per-viewer render postures (the gui-posture.ts module's web
 * sibling): the keyboard-capture latch (`rk-web-capture`: "1" = captured,
 * absent/other = released — while latched the web chord reclaim hands every
 * chord but the release binding to the embedded page, on both engines).
 * Per-viewer localStorage state (Constitution IV), sticky and viewer-global;
 * reads are validated on the way in (untrusted-localStorage discipline) and
 * all writes are try/catch-noop.
 */

const WEB_CAPTURE_KEY = "rk-web-capture";

export function readWebCapture(): boolean {
  try {
    return localStorage.getItem(WEB_CAPTURE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeWebCapture(on: boolean): void {
  try {
    if (on) {
      localStorage.setItem(WEB_CAPTURE_KEY, "1");
    } else {
      localStorage.removeItem(WEB_CAPTURE_KEY);
    }
  } catch {
    /* noop — best-effort persistence */
  }
}

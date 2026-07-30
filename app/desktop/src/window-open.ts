/**
 * Window-open policy: what happens when a page in the shell requests a new
 * window (window.open / target="_blank").
 *
 * The policy is ALL-EXTERNAL — any http(s) URL goes to the system browser,
 * everything else is dropped. There is deliberately no registered-origin
 * in-window branch: a new-window intent never navigates the shell window.
 *
 * Deliberately electron-free (the `servers.ts` pattern) so the decision is
 * unit-testable under plain `node --test` — `main.ts` imports electron at
 * module top and cannot be loaded by the test runner.
 */

/**
 * True for http/https URLs only. Everything else (file:, smb:, about:blank,
 * garbage) must never reach `shell.openExternal` — passing arbitrary schemes
 * to openExternal is a known injection vector.
 */
export function isHttpUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

/** Decide a new-window intent: http(s) opens externally, anything else is dropped. */
export function windowOpenAction(url: string): "open-external" | "deny" {
  return isHttpUrl(url) ? "open-external" : "deny";
}

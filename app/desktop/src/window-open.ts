/**
 * Window-open policy: what happens when a page in the shell requests a new
 * window (window.open / target="_blank").
 *
 * The policy is ALL-EXTERNAL — any http(s) URL goes to the system browser,
 * everything else is dropped. There is deliberately no registered-origin
 * in-window branch: a new-window intent never navigates the shell window.
 *
 * Editor deeplinks (260801-sm6g): a FIXED allowlist of editor URL schemes
 * (`vscode:`, `cursor:`, `windsurf:`) also routes to `shell.openExternal` —
 * the SPA's "Open in app" deeplink targets navigate via
 * `window.location.href = "vscode://…"`, which the navigation guard blocks
 * in-window; without the forward the click was silently swallowed. The list
 * is an allowlist, NEVER a scheme pass-through (see `isEditorDeeplink`).
 *
 * Deliberately electron-free (the `hosts.ts` pattern) so the decision is
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

/**
 * Editor deeplink schemes the shell forwards to `shell.openExternal`
 * (260801-sm6g). HAND-MAINTAINED MIRROR of `DEEPLINK_APPS` in
 * `app/frontend/src/lib/open-in-app.ts` — the SPA composes exactly these
 * `<scheme>://vscode-remote/ssh-remote+…` URLs (lowercase scheme constants);
 * adding an editor there requires adding its scheme here (and a shell
 * release). MUST stay a fixed allowlist — handing arbitrary schemes to
 * `openExternal` is a known injection vector (Constitution I), so this is
 * never widened to a scheme pass-through.
 */
const EDITOR_DEEPLINK_SCHEMES = ["vscode://", "cursor://", "windsurf://"] as const;

/** True only for allowlisted editor-deeplink URLs (`vscode://…` etc.). */
export function isEditorDeeplink(url: string): boolean {
  return EDITOR_DEEPLINK_SCHEMES.some((scheme) => url.startsWith(scheme));
}

/** Decide a new-window intent: http(s) and allowlisted editor deeplinks open
 *  externally, anything else is dropped. */
export function windowOpenAction(url: string): "open-external" | "deny" {
  return isHttpUrl(url) || isEditorDeeplink(url) ? "open-external" : "deny";
}

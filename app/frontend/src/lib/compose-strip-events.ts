/**
 * Cross-component signaling for the docked compose strip (260718-dhdj).
 *
 * The strip is a single global component that owns its own draft + attachment
 * state and scopes uploads to the live focused target's worktree. The terminal
 * container (in `terminal-client.tsx`) binds the drag-drop / clipboard-paste
 * upload gestures; it forwards the raw `File`s to the strip via a document-level
 * CustomEvent (the same `document.dispatchEvent` bridge the palette button uses
 * for `palette:open`). The strip listens, enables itself if off, and uploads the
 * files to its own focused target — keeping worktree scoping correct and
 * preserving "one input surface" without prop-drilling upload results.
 */

/** Event name dispatched on `document` when the terminal receives dropped or
 * pasted files that should populate the compose strip. */
export const COMPOSE_STRIP_ATTACH_EVENT = "compose-strip:attach";

/**
 * Module-level hand-off queue for files dispatched while the strip may not yet
 * be mounted. When the terminal enables the strip and dispatches an attach in
 * the same tick, the strip's listener is not yet attached (React mount is
 * async). The queue bridges that gap: the dispatcher enqueues, and the strip
 * drains the queue both on the attach event AND on its own mount. Draining is
 * idempotent (the array is spliced empty), so a double-drain is a no-op.
 */
const pendingFiles: File[] = [];

/** Dispatch files for the compose strip to upload — enqueues them for the strip
 * to drain, then fires the attach event so an already-mounted strip reacts
 * immediately. Callers SHOULD enable the strip preference before calling this so
 * the strip mounts and drains the queue. */
export function dispatchComposeStripAttach(files: File[]): void {
  if (files.length === 0) return;
  pendingFiles.push(...files);
  document.dispatchEvent(new CustomEvent(COMPOSE_STRIP_ATTACH_EVENT));
}

/** Drain and return all queued attach files (empties the queue). */
export function drainComposeStripAttachments(): File[] {
  return pendingFiles.splice(0, pendingFiles.length);
}

/**
 * Module-level focus registry for the compose strip's textarea.
 *
 * The touch ⌨ keyboard button (in `bottom-bar.tsx`) must focus the strip's real
 * `<textarea>` (the mobile IME/autocorrect surface xterm lacks) when the compose
 * preference is on. It previously located it via
 * `document.querySelector('[data-testid="compose-strip-input"]')`, but test ids
 * are test-only in this repo — production code must not read them. The strip
 * registers a focuser here on mount (and clears it on unmount, iff it is still
 * the registered one); `bottom-bar.tsx` calls `focusComposeStrip()` instead of
 * reaching into the DOM by test id. Same module-registry shape as the attach
 * queue above.
 */
let stripFocuser: (() => boolean) | null = null;

/**
 * Register the strip's textarea focuser. `focus` returns `true` when it actually
 * focused the input (mounted + enabled), `false` otherwise (e.g. disabled "no
 * target" state) so the caller can fall back to the terminal. Returns an
 * unregister function that clears the slot ONLY if it still points at this
 * focuser — so a remount that registered a newer focuser is not clobbered by an
 * older instance's cleanup.
 */
export function registerComposeStripFocuser(focus: () => boolean): () => void {
  stripFocuser = focus;
  return () => {
    if (stripFocuser === focus) stripFocuser = null;
  };
}

/**
 * Focus the compose strip's textarea via the registered focuser. Returns `true`
 * when the strip took focus, `false` when no strip is registered or it declined
 * (disabled) — the caller then falls back to the terminal.
 */
export function focusComposeStrip(): boolean {
  return stripFocuser?.() ?? false;
}

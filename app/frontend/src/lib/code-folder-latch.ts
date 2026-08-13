/**
 * Per-window code-folder LATCH (change 260813-if5d-latch-code-surface-folder;
 * spec docs/specs/right-panel.md § The code lens).
 *
 * The code surface's folder is NOT the live backend derivation. `gitRoot` is
 * re-derived per SSE tick from the ACTIVE pane's cwd, so a pane switch or a
 * `cd` would retarget (or unmount) the embedded editor and take its in-flight
 * state with it — open tabs, dirty buffers, undo stacks. Derivation therefore
 * only SEEDS: the first time the code surface actually renders for a window it
 * latches the derived root, and from then on the only writer is the editor's
 * own navigation (File > Open Folder, reported by `CodeSurface`'s load-event
 * seam). The terminal never moves the editor.
 *
 * Storage is per-browser localStorage keyed by (server, window id) — the
 * `windowViewStorageKey` convention. Consequences accepted by design: another
 * browser/profile derives its own latch (code-server's own tabs/layout state is
 * already per-browser), and a tmux window id remapped by a snapshot restore
 * orphans its key (a missing latch simply re-seeds on the next open).
 *
 * Pure and DOM-free apart from the thin try/catch-noop storage wrappers — the
 * `window-view.ts` / `right-panel.ts` module contract.
 */

/**
 * Value-bearing per-window latch key (mirrors `windowViewStorageKey`). Stores
 * the absolute folder PATH; absence means "not latched yet" — the next render
 * of the code surface seeds it from derivation.
 */
export function codeFolderStorageKey(server: string, windowId: string): string {
  return `runkit-code-folder:${server}:${windowId}`;
}

/**
 * Read a window's latched code folder. Returns `undefined` when absent, when
 * the stored value is empty, or when localStorage is unavailable
 * (SSR/jsdom/quota) — the try/catch-noop pattern from `window-view.ts`. An
 * empty value is treated as absent so a latch can never render a
 * `?folder=`-less workspace.
 */
export function readLatchedCodeFolder(
  server: string,
  windowId: string,
): string | undefined {
  try {
    const raw = localStorage.getItem(codeFolderStorageKey(server, windowId));
    return raw !== null && raw.length > 0 ? raw : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Latch a window's code folder. Best-effort — a localStorage failure (private
 * mode / quota / SSR) is swallowed (try/catch-noop). An empty folder is IGNORED
 * rather than stored: an empty derivation seeds nothing, so a window that was
 * never inside a repo behaves exactly as it did before the latch existed.
 */
export function writeLatchedCodeFolder(
  server: string,
  windowId: string,
  folder: string,
): void {
  if (folder.length === 0) return;
  try {
    localStorage.setItem(codeFolderStorageKey(server, windowId), folder);
  } catch {
    /* noop — best-effort persistence */
  }
}

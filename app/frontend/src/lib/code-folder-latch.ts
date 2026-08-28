/**
 * Code-surface folder helpers (spec docs/specs/right-panel.md § The code lens).
 *
 * The code surface's folder is SHARED tab state: it lives in the
 * `@rk_win_code_root` window option and arrives in the window payload as
 * `codeRoot`. `gitRoot` is re-derived per SSE tick from the ACTIVE pane's cwd,
 * so a pane switch or a `cd` would retarget (or unmount) the embedded editor
 * and take its in-flight state with it — open tabs, dirty buffers, undo
 * stacks. Derivation therefore only SEEDS (`codeRootSeed`): the first render
 * of the code tile with an empty option writes the derived root once, and from
 * then on the only writer is the editor's own navigation (File > Open Folder,
 * reported by `CodeSurface`'s load-event seam). The terminal never moves the
 * editor.
 *
 * Pure and DOM-free — the `window-view.ts` / `right-panel.ts` module contract.
 */

import type { ViewWindow } from "./window-view";
import type { Layout } from "./surface-layout";

/**
 * The folder the code surface opens: the shared code root, falling back to
 * the derived `gitRoot` while the option is still unset (pre-seed renders and
 * availability gating). "" when neither exists — the code surface is
 * unavailable then (`hasCode` keys off the same pair).
 */
export function codeRootFor(win: ViewWindow | null | undefined): string {
  return win?.codeRoot || win?.gitRoot || "";
}

/**
 * The one-time seed for `@rk_win_code_root`: the derived `gitRoot`, but only
 * when the code tile is actually open AND the option is still empty — seeding
 * a closed tile would pin a root the user never asked for, and seeding over a
 * set root would clobber the editor's own navigation. `null` means "no write".
 */
export function codeRootSeed(
  win: ViewWindow | null | undefined,
  layout: Layout,
): string | null {
  return layout.order.includes("code") && !win?.codeRoot && win?.gitRoot
    ? win.gitRoot
    : null;
}

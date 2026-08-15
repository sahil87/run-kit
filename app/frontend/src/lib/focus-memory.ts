/**
 * Per-window focus MEMORY + programmatic-steal GUARD (spec
 * docs/specs/right-panel.md § The code lens).
 *
 * Two sibling pieces of per-window state, both keyed `${server}:${windowId}`
 * (the `focusMemoryKey` convention — same shape as the `rk-layout:` /
 * `runkit-code-folder:` storage keys):
 *
 * - **Memory**: which of the three focus candidates (`tty` terminal, `compose`
 *   strip, `code` editor) the USER last focused in a window, recalled by the
 *   restore router in app.tsx on every window switch so the typing target
 *   survives the tile-grid remount. Absent ⇒ the caller applies the `tty`
 *   default (keyboard-first: a first visit must land on the terminal, not on
 *   whatever grabs focus first).
 * - **Guard**: an armed flag per key, armed by the restore router on a window
 *   switch and disarmed on the first genuine user interaction. While armed,
 *   the code-server workbench's one-shot load-time focus grab (a script
 *   `focus()` no setting can suppress) is recognized as NOT a user choice:
 *   CodeSurface reports it via `onProgrammaticFocus`, and a remembered kind
 *   other than `code` is restored instead.
 *
 * The load-bearing asymmetry: `code` is recorded ONLY from CodeSurface's
 * `onInteract` seam (an in-frame keydown/pointerdown), never from
 * iframe-element focusin — so a programmatic grab can never write itself into
 * memory, and the guard only ever reverts TOWARD a recorded user choice.
 *
 * In-memory only, dying on page reload — ephemeral UI state, deliberately NOT
 * persisted (the sibling `code-folder-latch.ts` is the storage-shaped one;
 * this module is its pure in-memory counterpart). DOM-free and
 * jsdom-unit-testable; the module-slot shape mirrors `compose-strip-events.ts`.
 */

/** The three surfaces the restore router can return focus to. */
export type FocusKind = "tty" | "compose" | "code";

/** Compose the per-window memory/guard key — the ONLY place the
 *  `${server}:${windowId}` shape is spelled out. */
export function focusMemoryKey(server: string, windowId: string): string {
  return `${server}:${windowId}`;
}

const memory = new Map<string, FocusKind>();
const armedGuards = new Set<string>();

/** Record the user's focus choice for a window. Only the three genuine-focus
 *  seams call this (tty via the tty tile's pointerdown/palette-focus seams —
 *  deliberately NOT `focusSlot` itself, see surface-layout's `recordTtySlot`;
 *  compose via the textarea's `onFocus`, code via `onInteract`) — navigation
 *  clicks and programmatic grabs never write memory. */
export function recordFocus(key: string, kind: FocusKind): void {
  memory.set(key, kind);
}

/** Recall the user's recorded focus choice; `undefined` when the window was
 *  never focused (callers apply the `tty` default). */
export function recallFocus(key: string): FocusKind | undefined {
  return memory.get(key);
}

/** Arm the steal guard for a window (the restore router does this on every
 *  window switch). Arming is idempotent. */
export function armGuard(key: string): void {
  armedGuards.add(key);
}

/** Disarm the steal guard — called on the first genuine user interaction
 *  (in-frame `onInteract`, or a capture-phase parent-document
 *  pointerdown/keydown). Disarming an unarmed key is a no-op. */
export function disarmGuard(key: string): void {
  armedGuards.delete(key);
}

/** Whether the window is inside its protected post-switch window. */
export function isGuardArmed(key: string): boolean {
  return armedGuards.has(key);
}

/** Test-reset seam (the `hydrateComposeDrafts()` pattern): clears both maps.
 *  Production code never calls this — nothing in the app needs a global wipe. */
export function resetFocusMemory(): void {
  memory.clear();
  armedGuards.clear();
}

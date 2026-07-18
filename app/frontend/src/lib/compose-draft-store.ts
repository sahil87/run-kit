/**
 * Module-level draft store for the docked compose strip (260718-dhdj).
 *
 * The strip is a single global surface, but it is *mounted conditionally* in two
 * separate footers (`app.tsx`'s AppShell and `board-page.tsx`), gated on the
 * `composeStripEnabled` chrome preference. Component-local `useState` in a
 * conditionally-mounted component would destroy the unsent draft on every
 * toggle-off (unmount) AND on every terminal↔board route change (the two footers
 * are distinct React subtrees — one unmounts, the other mounts). Intake §7 / R2
 * require the draft + pending attachments to SURVIVE focus changes, route
 * navigation, AND toggle-off/on.
 *
 * So the draft lives here, at module scope, exposed through a
 * `useSyncExternalStore` seam — the same module-store pattern the window-switch
 * pending mask uses (`window-transition.ts`: a module slot + a listener set +
 * `getSnapshot`/`subscribe`, notify-only-on-change). Any strip instance that
 * mounts reads the same live draft; unmounting the strip does not touch it. Blob
 * URLs for previews are derived per-mount from the retained `File` objects (kept
 * in the store), so they need no cross-mount persistence.
 */

/** A pending attachment: its uploaded path (a line in the textarea) plus the
 * retained `File` object (kept client-side for previews and for re-homing to a
 * new worktree on focus change). */
export type ComposeAttachment = {
  path: string;
  file: File;
};

/** The persisted compose draft: the textarea text and pending attachments. */
export type ComposeDraft = {
  text: string;
  attachments: ComposeAttachment[];
};

const EMPTY_ATTACHMENTS: ComposeAttachment[] = [];

// Module-level slot. A single global draft mirrors the single global strip: at
// any moment there is exactly one compose surface, so one slot suffices.
let text = "";
let attachments: ComposeAttachment[] = EMPTY_ATTACHMENTS;

// Cached snapshot object so `getSnapshot` returns a STABLE reference while the
// draft is unchanged — `useSyncExternalStore` compares snapshots by identity and
// would loop forever if a fresh object were minted every call. Rebuilt only when
// `text`/`attachments` actually change (via `setState`).
let snapshot: ComposeDraft = { text, attachments };

const listeners = new Set<() => void>();

/** Snapshot for `useSyncExternalStore`. Stable identity while unchanged. */
export function getComposeDraft(): ComposeDraft {
  return snapshot;
}

/**
 * Subscribe to draft changes (the `useSyncExternalStore` contract). Returns an
 * unsubscribe function. Listeners fire only on an actual change.
 */
export function subscribeComposeDraft(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Rebuild the cached snapshot and notify subscribers. */
function commit(): void {
  snapshot = { text, attachments };
  for (const listener of listeners) listener();
}

/** Set the draft text. Accepts a value or an updater (mirrors React's setter). */
export function setComposeText(next: string | ((prev: string) => string)): void {
  const value = typeof next === "function" ? next(text) : next;
  if (value === text) return;
  text = value;
  commit();
}

/** Set the pending attachments. Accepts a value or an updater. */
export function setComposeAttachments(
  next: ComposeAttachment[] | ((prev: ComposeAttachment[]) => ComposeAttachment[]),
): void {
  const value = typeof next === "function" ? next(attachments) : next;
  if (value === attachments) return;
  attachments = value;
  commit();
}

/** Clear the whole draft (text + attachments) after a delivered send. No-op
 * (no notify) when already empty, so a redundant clear does not churn. */
export function clearComposeDraft(): void {
  if (text === "" && attachments.length === 0) return;
  text = "";
  attachments = EMPTY_ATTACHMENTS;
  commit();
}

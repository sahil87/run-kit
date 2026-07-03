/**
 * Pure helpers for the window-switch slide transition (260703-l4nf).
 *
 * A same-server window switch animates as a vertical slide via the browser's
 * View Transitions API, keyed off the two windows' positions in the flattened
 * sidebar order. Everything DOM-facing (feature detection, the actual
 * `document.startViewTransition` call, the root data attribute) is driven from
 * `app.tsx`; the decision logic lives here as pure functions so it is unit-
 * testable without a DOM — the same pure-function pattern as `resolveServerView`
 * and `computeKillRedirect`.
 */

// The View Transitions API (`document.startViewTransition`, `ViewTransition`)
// is provided by the TS `dom` lib (TS 5.7+), so no ambient augmentation is
// needed. Feature detection (`viewTransitionSupported`) guards every call at
// runtime for browsers that lack it — type narrowing, not an `as` cast
// (code-quality principle).

/** Slide direction, or `null` when no transition should run. */
type WindowSwitchDirection = "up" | "down";

/**
 * Compute the slide direction from the two windows' positions in the flattened
 * (SSE-derived) window order.
 *
 * - target below current (higher index) → `"up"` (new content enters from below)
 * - target above current (lower index)  → `"down"`
 * - either id missing from the order, or the two ids equal → `null` (skip)
 *
 * Pure: no DOM, no side effects. `order` is the flattened list of window ids in
 * sidebar order (e.g. `flatWindows.map((fw) => fw.window.windowId)`).
 */
export function windowSwitchDirection(
  order: string[],
  currentId: string,
  targetId: string,
): WindowSwitchDirection | null {
  if (currentId === targetId) return null;
  const currentIndex = order.indexOf(currentId);
  const targetIndex = order.indexOf(targetId);
  if (currentIndex === -1 || targetIndex === -1) return null;
  return targetIndex > currentIndex ? "up" : "down";
}

/**
 * Runtime feature detection for the View Transitions API. Returns a plain
 * boolean (not a type predicate) via a `typeof` check on
 * `document.startViewTransition` — no `as` cast, honoring the type-narrowing-
 * over-assertions code-quality principle.
 */
export function viewTransitionSupported(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof document.startViewTransition === "function"
  );
}

/**
 * Decide whether a window switch should animate. All conditions must hold:
 * View Transitions support, motion not reduced, an outgoing window is in view,
 * and a slide direction resolved. Any failure falls through to the instant
 * switch (progressive enhancement). Pure — the caller supplies the ambient
 * facts (support, media query, param presence, computed direction).
 */
export function shouldAnimateWindowSwitch(opts: {
  hasVTSupport: boolean;
  reducedMotion: boolean;
  hasOutgoingWindow: boolean;
  direction: WindowSwitchDirection | null;
}): boolean {
  return (
    opts.hasVTSupport &&
    !opts.reducedMotion &&
    opts.hasOutgoingWindow &&
    opts.direction !== null
  );
}

/** How long the wrapper waits for the incoming window's first paint (ms). */
const FIRST_WRITE_TIMEOUT_MS = 300;

/**
 * First-inbound-bytes gate for the polished capture (260703-l4nf).
 *
 * The transition wrapper in `app.tsx` opens a gate (`beginWindowSwitchGate`)
 * before navigating, then `await`s `waitForFirstWrite()` inside
 * `startViewTransition`'s async callback so the new-state snapshot is captured
 * only once the incoming window has received its first bytes. `TerminalClient`
 * calls `notifyFirstWrite()` at message-receipt time (inside `ws.onmessage`,
 * before the write/coalesce decision), which releases the gate. Receipt time,
 * not write time: `startViewTransition` suppresses rendering while its callback
 * runs and rAF callbacks do not fire during suppression, so a release keyed off
 * the (rAF-scheduled) coalesced flush would never fire during the transition.
 *
 * The gate handles three concurrency subtleties:
 *
 * 1. **Rapid switching does not serialize.** Per the View Transitions spec, a
 *    second `startViewTransition` started while one is in flight queues its
 *    update callback BEHIND the first callback's returned promise. The first
 *    callback holds that promise open for up to the timeout (it `await`s the
 *    gate), so a second switch's navigation would stall behind the first's full
 *    timeout. `beginWindowSwitchGate` therefore FIRES (resolves) any still-
 *    pending prior gate immediately on supersession, so the first callback
 *    returns at once and the browser runs the queued second callback without
 *    delay.
 *
 * 2. **Only the INCOMING window's bytes release the gate.** A same-session
 *    switch rides the existing WebSocket with no reconnect, so a busy OUTGOING
 *    window can still be streaming bytes when the switch fires; those would
 *    release the gate before tmux has even run `select-window`. The gate stays
 *    closed to `notify` until `openForNotify()` is called, which the wrapper
 *    does only after the `selectWindow` POST resolves — so a byte only counts
 *    once tmux has been told to switch. The wrapper does NOT `await` the POST
 *    before starting the wait: it CHAINS `openForNotify` off the POST
 *    (`posted.then(() => gate.openForNotify())`) and awaits only
 *    `waitForFirstWrite()`, whose timeout clock starts at the wait (callback
 *    entry), not after the POST. So the callback's total duration is hard-capped
 *    at the timeout regardless of the POST's fate — a stalled `selectWindow`
 *    (no client-side fetch timeout) cannot freeze the document past the ~300ms
 *    budget, and a rapid second switch never queues behind a stalled POST.
 *    Bytes that arrive before the POST resolves are ignored, so if the POST is
 *    slow the gate simply times out ungated (today's behavior plus motion)
 *    rather than releasing on a stale outgoing byte.
 *
 * 3. **A stale timer does not clobber a newer gate.** Each gate is a distinct
 *    token; `settleGate` clears the module slot only when it still points at its
 *    own token, so a late timeout from a superseded gate can neither resolve
 *    nor disarm the current one.
 *
 * A single module-level slot is sufficient: at any moment there is exactly one
 * focused terminal and at most one gate the wrapper is awaiting (a superseding
 * `beginWindowSwitchGate` fires the previous one). `notify` is a cheap no-op
 * when no gate is open for it, so terminal receipts outside a transition are
 * free.
 */
interface SwitchGate {
  /** Resolves the awaiting `waitForFirstWrite`, once. Null once settled. */
  resolve: (() => void) | null;
  /** Timer that resolves the gate on timeout. */
  timer: ReturnType<typeof setTimeout> | null;
  /**
   * Whether a terminal write should release the gate yet. False until the
   * wrapper calls `openForNotify()` (after the selectWindow POST resolves), so
   * a busy outgoing window's in-flight bytes can't release it early.
   */
  acceptingNotify: boolean;
}

let currentGate: SwitchGate | null = null;

/** A live view-transition first-write gate. Returned by `beginWindowSwitchGate`. */
interface WindowSwitchGate {
  /**
   * Start accepting `notifyFirstWrite` releases. The wrapper calls this after
   * the `selectWindow` POST has resolved, so only writes that arrive once tmux
   * has been told to switch count as the incoming window's first paint.
   */
  openForNotify(): void;
  /**
   * Resolve when the incoming window's first write arrives (`notifyFirstWrite`,
   * once `openForNotify` was called) or after the timeout, whichever is first.
   */
  waitForFirstWrite(timeoutMs?: number): Promise<void>;
}

/**
 * Open a new first-write gate for a window-switch transition. FIRES any prior
 * still-pending gate immediately (supersession — so a queued
 * `startViewTransition` callback runs at once rather than stalling behind the
 * prior gate's timeout). Call before navigating; then `openForNotify()` after
 * the selectWindow POST resolves and `await waitForFirstWrite()` in the
 * transition callback.
 */
export function beginWindowSwitchGate(): WindowSwitchGate {
  // Supersede: resolve (do not silently discard) any prior pending gate so the
  // View-Transition callback awaiting it returns immediately.
  if (currentGate) {
    const prior = currentGate;
    settleGate(prior);
  }

  const gate: SwitchGate = { resolve: null, timer: null, acceptingNotify: false };
  currentGate = gate;

  return {
    openForNotify() {
      gate.acceptingNotify = true;
    },
    waitForFirstWrite(timeoutMs: number = FIRST_WRITE_TIMEOUT_MS): Promise<void> {
      return new Promise<void>((resolve) => {
        // If this gate was already superseded before the wrapper got here,
        // resolve immediately — never leave the callback hanging.
        if (currentGate !== gate) {
          resolve();
          return;
        }
        gate.resolve = resolve;
        gate.timer = setTimeout(() => settleGate(gate), timeoutMs);
      });
    },
  };
}

/**
 * Release the current gate iff it is open for notify. Called from
 * `TerminalClient`'s `ws.onmessage` at message-receipt time; a cheap no-op when
 * no gate is awaiting a write (unarmed, already settled, or not yet
 * `openForNotify`'d).
 */
export function notifyFirstWrite(): void {
  if (currentGate && currentGate.acceptingNotify) {
    settleGate(currentGate);
  }
}

/**
 * Settle a gate: resolve its pending promise (if any), clear its timer, and
 * clear the module slot ONLY when it still points at this gate. The
 * still-points-at-itself guard means a late timeout from a superseded gate can
 * neither resolve a newer gate nor null out the current slot.
 */
function settleGate(gate: SwitchGate): void {
  if (gate.timer !== null) {
    clearTimeout(gate.timer);
    gate.timer = null;
  }
  const resolve = gate.resolve;
  gate.resolve = null;
  // Stale-timer guard: only relinquish the module slot if it is still ours.
  if (currentGate === gate) currentGate = null;
  if (resolve) resolve();
}

/**
 * Latest-wins guard for the `data-window-switch-direction` root attribute.
 *
 * The attribute is set by the wrapper immediately before `startViewTransition`
 * and cleared in the transition's `finished.finally()`. But `finished` FULFILLS
 * when a transition is SKIPPED (superseded by a rapid second switch) — NOT
 * rejects — so a superseded transition's `finally()` would otherwise delete the
 * attribute that its successor already set, dropping the successor slide's
 * direction CSS. Mirror the gate's still-points-at-itself pattern: each switch
 * captures a monotonic token at set time via `nextDirectionToken()`, and its
 * cleanup deletes the attribute only when `isLatestDirectionToken(token)` — i.e.
 * only the LATEST switch's `finally()` may clear it. Pure module state, no DOM.
 */
let latestDirectionToken = 0;

/** Mint the next direction token and record it as the latest. */
export function nextDirectionToken(): number {
  latestDirectionToken += 1;
  return latestDirectionToken;
}

/** True only if `token` is still the latest minted direction token. */
export function isLatestDirectionToken(token: number): boolean {
  return token === latestDirectionToken;
}

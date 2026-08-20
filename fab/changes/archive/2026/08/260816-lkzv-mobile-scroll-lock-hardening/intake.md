# Intake: Mobile Scroll-Lock Hardening

**Change**: 260816-lkzv-mobile-scroll-lock-hardening
**Created**: 2026-08-16

## Origin

Conversational — diagnosed during a `/fab-discuss` session (2026-08-16/17). User report:

> scrolling xterm text is still not easy on mobile. Especially on a Claude session even if I lock the Keyboard many times while scrolling the keyboard comes up. This happens whenever the input box area of a claude session gets activated. […] This happens in a very specific scenario when I am scrolling down with my finger. I'm not sure what the gesture is that causes this. It doesn't always happen only sometimes.

A screenshot confirmed the leak occurs **while the lock is genuinely active** (🔒 chip lit) — and since the bottom bar self-hides whenever the compose strip owns focus (`bottom-bar.tsx:362`) and the bar was visible with the keyboard up, the focus target is provably **xterm's hidden helper textarea**, not the compose strip.

Key decisions from the discussion:
- Bundle the three fixes below into **one change** (user confirmed).
- **Explicitly out of scope**: inverting the coarse-pointer default so terminal taps never summon the keyboard — deferred to a later change.

## Why

1. **Pain point**: On mobile, the on-screen keyboard pops up while scrolling terminal output even with scroll-lock engaged, covering half the screen and interrupting reading. Root causes, verified against the installed xterm bundle:
   - **The leak**: xterm **6.0.0** (note: `fab/project/context.md` still says xterm.js 5) has exactly two touch-reachable focus paths. Path 1 — element `mousedown` → `this.focus()` — is correctly suppressed by the lock's capture-phase `touchend` `preventDefault()` (`terminal-client.tsx:489-500`). Path 2 — element `contextmenu` → `rightClickHandler` → `moveTextAreaUnderMouseCursor`, which moves the offscreen helper textarea to a 20×20px box under the pointer and calls `.focus()` on it — is **not covered**: WebKit's long-press recognizer dispatches `contextmenu` independently of the synthetic-click chain (triggered by slow scroll drags where the finger dwells ~500ms with little movement — hence "only sometimes"). run-kit's existing `onContextMenu={e => e.preventDefault()}` on the terminal div (`terminal-client.tsx:1067`) is a React root-delegated **bubble** listener: it runs *after* xterm's element-level listener has already moved and focused the textarea, so the context menu is suppressed but the keyboard pops silently — no menu is ever seen.
   - **Lock amnesia**: `scrollLocked` is transient `useState(false)` held in **three independent copies** — `bottom-bar.tsx:101` (source of truth, pushed up via `onScrollLockChange`), `app.tsx:1159`, and `board-page.tsx:920`. Nothing persists it, so every BottomBar remount, terminal↔board route change, and mobile-browser tab reload silently resets the lock to off. This is why the user "locks many times".
   - **Hostile chip semantics**: while locked, a plain tap on the 🔒 chip **unlocks and summons the keyboard** (`bottom-bar.tsx:298-302`) — the exact opposite of the likely intent (reinforcing the lock).
2. **Consequence of not fixing**: the scroll-lock feature is effectively broken on the primary mobile reading flow (watching a Claude session), and the keyboard keeps obstructing the terminal.
3. **Why this approach**: the capture-phase suppressors kill both known focus paths deterministically without touching xterm internals; hoisting + persisting the lock fixes the amnesia at its root (state ownership) rather than papering over resets; the chip fix is a one-line semantics change in the same component. The bigger "taps never summon keyboard on coarse pointers" inversion was considered and deliberately deferred.

## What Changes

### 1. Close the contextmenu focus leak (terminal-client.tsx)

Extend the existing scroll-lock effect (`terminal-client.tsx:489-500`, deps `[scrollLocked]`) to register **two additional capture-phase listeners** on the same terminal container while locked:

```ts
function onContextMenu(e: Event) {
  e.preventDefault();
  e.stopPropagation();
}
function onMouseDown(e: Event) {
  e.preventDefault();
  e.stopPropagation();
}
container.addEventListener("contextmenu", onContextMenu, { capture: true });
container.addEventListener("mousedown", onMouseDown, { capture: true });
```

- `contextmenu` capture on the container (an ancestor of xterm's `.xterm` element) runs **before** xterm's target-phase `contextmenu` listener, so `rightClickHandler`/`moveTextAreaUnderMouseCursor` never executes. This is the actual leak fix.
- `mousedown` capture is belt-and-braces: it closes any residual synthetic-mouse path regardless of `touchend` cancelability quirks (xterm 6's mousedown handler is `e.preventDefault(); this.focus()`).
- **Last-resort backstop**: a `focusin` capture listener on the container while locked that immediately blurs the target if it is xterm's textarea (`e.target.closest(".xterm")`). The original code comment avoided reactive blur ("disrupts active touch sequences and can corrupt xterm.js internal state") as a *primary* mechanism; behind the two suppressors it fires ~never and converts any unknown third focus path into a flicker instead of a stuck keyboard. Keep it scoped to locked state only.
- All listeners live in the same effect and are removed on unlock/unmount, exactly like the existing `touchend` listener. Desktop is unaffected: the lock can only be engaged from the coarse-pointer-only chip, and the suppressors are active only while locked.

### 2. Persist scroll-lock (ChromeContext + localStorage)

Hoist the triplicated `scrollLocked` state into **ChromeContext** (the existing owner of persisted chrome preferences, e.g. `terminalFontSize` → `runkit-terminal-font-size`):

- New context value + setter, e.g. `scrollLocked` / `setScrollLocked`, persisted to localStorage key `runkit-scroll-lock` following the existing ChromeContext persistence pattern (read once at init, write-through on change).
- Delete the local `useState` copies at `bottom-bar.tsx:101`, `app.tsx:1159`, and `board-page.tsx:920`; all three consumers read from ChromeContext. The `onScrollLockChange` prop plumbing from BottomBar up to app/board-page becomes unnecessary and is removed (SurfaceLayout/TerminalClient/BoardPane keep receiving `scrollLocked` as a prop or read the context — whichever matches existing patterns in those components; prefer the smallest diff that removes the triplication).
- Result: the lock survives remounts, terminal↔board navigation, and mobile tab reloads, and the terminal-route and board-route locks can no longer disagree.

### 3. Fix the 🔒 chip tap semantics (bottom-bar.tsx)

Current behavior at `bottom-bar.tsx:293-309`: tap while locked → `toggleScrollLock(false)` **plus** `focusInput()` (summons keyboard). New behavior:

- **Tap while locked → unlock only.** No keyboard summon; the keyboard stays down. (A subsequent tap of the now-⌨ chip shows the keyboard, as today.)
- Long-press semantics (toggle lock, with the auto-blur when locking) are unchanged.
- Update the `aria-label` for the locked state if its wording implies the old behavior ("tap to unlock" remains accurate).

### Tests

- Unit (Vitest, terminal-client / bottom-bar): while locked, a dispatched `contextmenu` (and `mousedown`) on the terminal container is defaultPrevented/stopped before reaching a child listener; unlocked passes through. Chip: tap-while-locked calls unlock but not `focusInput`.
- ChromeContext persistence: lock state round-trips through localStorage and is shared across consumers.
- E2E where feasible (chromium touch emulation): with lock on, dispatching a long-press-shaped `contextmenu` on the terminal does not focus `.xterm-helper-textarea`.

### Docs

- Fix the stale "xterm.js 5" reference in `fab/project/context.md` → xterm 6 (incidental one-line correction discovered during diagnosis).

## Affected Memory

- `run-kit/ui/terminal`: (modify) touch-scroll/scroll-lock section — document the two xterm 6 focus paths and the capture-phase contextmenu/mousedown suppression + focusin backstop that closes the long-press leak
- `run-kit/ui/compose-and-bottom-bar`: (modify) iOS keyboard support / keyboard-chip section — scroll-lock now persisted in ChromeContext (`runkit-scroll-lock`), single source of truth; new tap-while-locked semantics (unlock without summon)

## Impact

- `app/frontend/src/components/terminal-client.tsx` — scroll-lock effect gains contextmenu/mousedown suppressors + focusin backstop
- `app/frontend/src/components/bottom-bar.tsx` — chip tap semantics; local lock state removed in favor of ChromeContext
- `app/frontend/src/contexts/` ChromeContext — new persisted `scrollLocked` value
- `app/frontend/src/app.tsx`, `src/components/board/board-page.tsx` — local lock state + `onScrollLockChange` plumbing removed
- `fab/project/context.md` — xterm version correction
- Frontend-only; no backend, API, or route changes. No new dependencies.

## Open Questions

- (none — the one soft spot, exact tap-while-locked behavior, is recorded as a Confident assumption below)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Single change bundling leak fix + persistence + chip semantics; coarse-pointer default inversion excluded | Discussed — user explicitly chose one change and deferred the inversion | S:95 R:90 A:95 D:95 |
| 2 | Certain | Capture-phase contextmenu + mousedown suppressors inside the existing scroll-lock effect are the leak fix | Discussed and code-verified — the only lock-bypassing focus path in the xterm 6 bundle; ancestor capture provably beats xterm's target-phase listener | S:90 R:90 A:90 D:85 |
| 3 | Certain | Persist lock in ChromeContext backed by localStorage (`runkit-scroll-lock`), following the `runkit-terminal-font-size` pattern | Discussed — user approved; existing pattern determines the mechanism | S:85 R:85 A:90 D:85 |
| 4 | Confident | Tap on 🔒 while locked unlocks WITHOUT summoning the keyboard; long-press semantics unchanged | Discussed as "don't unlock-and-summon"; unlock-only is the minimal interpretation preserving the existing gesture vocabulary | S:65 R:85 A:75 D:60 |
| 5 | Confident | Include the focusin→blur backstop, scoped to locked state | Raised as optional in discussion; cheap, fires ~never behind the suppressors, easily removed if it misbehaves | S:60 R:85 A:80 D:70 |
| 6 | Certain | Suppressors cannot regress desktop | Lock is only engageable from the coarse-pointer-only chip; listeners exist only while locked | S:70 R:90 A:90 D:85 |
| 7 | Confident | iPhone-WebKit contextmenu-on-long-press is the trigger (version-dependent, unproven on device); the fix set still closes both known paths regardless | The contextmenu path is the only lock-bypassing focus path in the bundle; mousedown suppressor + focusin backstop cover the residual uncertainty | S:60 R:80 A:70 D:65 |

7 assumptions (4 certain, 3 confident, 0 tentative, 0 unresolved).

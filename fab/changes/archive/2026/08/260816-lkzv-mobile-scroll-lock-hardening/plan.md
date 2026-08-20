# Plan: Mobile Scroll-Lock Hardening

**Change**: 260816-lkzv-mobile-scroll-lock-hardening
**Intake**: `intake.md`

## Requirements

### Terminal: Scroll-Lock Focus Suppression

#### R1: Lock suppresses the contextmenu and mousedown focus paths
While `scrollLocked` is true, the terminal container in `app/frontend/src/components/terminal-client.tsx` MUST register capture-phase `contextmenu` and `mousedown` listeners (alongside the existing capture-phase `touchend` listener) that call `preventDefault()` and `stopPropagation()`, so xterm 6's element-level handlers (`contextmenu` → `rightClickHandler` → `moveTextAreaUnderMouseCursor` → textarea `.focus()`, and `mousedown` → `this.focus()`) never execute. Listeners SHALL be added and removed by the same effect that owns the `touchend` suppressor (deps `[scrollLocked]`).

- **GIVEN** scroll-lock is active on a touch device
- **WHEN** a `contextmenu` event (e.g. WebKit long-press) or a synthetic `mousedown` is dispatched on any element inside the terminal container
- **THEN** the event is default-prevented and stopped in the capture phase before reaching xterm's element listeners
- **AND** xterm's hidden helper textarea never gains focus (no soft keyboard)

#### R2: Focusin backstop while locked
While `scrollLocked` is true, a capture-phase `focusin` listener on the terminal container MUST immediately blur the target when it is inside `.xterm`, converting any residual unknown focus path into a flicker instead of a stuck keyboard. The listener SHALL be scoped to the locked state only (same effect as R1) and MUST NOT exist while unlocked.

- **GIVEN** scroll-lock is active
- **WHEN** focus lands on an element inside `.xterm` by any path the suppressors did not cover
- **THEN** the element is blurred immediately
- **GIVEN** scroll-lock is inactive
- **WHEN** the terminal is tapped
- **THEN** focus proceeds normally (no backstop interference)

### Chrome: Persisted Scroll-Lock State

#### R3: scrollLocked is a persisted global ChromeContext preference
`scrollLocked: boolean` MUST move into `ChromeContext` (`app/frontend/src/contexts/chrome-context.tsx`) with a `setScrollLocked` dispatch, persisted to localStorage key `runkit-scroll-lock`, following the existing `composeStripEnabled` pattern (read once at init with try/catch, write-through on change, default `false`). The three local copies — `bottom-bar.tsx:101`, `app.tsx:1159`, `board-page.tsx:920` — SHALL be deleted; consumers read the context. The `onScrollLockChange` prop plumbing from BottomBar to app.tsx/board-page.tsx SHALL be removed (the `scrollLocked` prop threading below the page level — SurfaceLayout → TerminalClient, BoardPane → TerminalClient — may remain, now fed from context at the page level, whichever yields the smallest diff).

- **GIVEN** the user enables scroll-lock and reloads the page (or navigates terminal ↔ board)
- **WHEN** the UI re-mounts
- **THEN** scroll-lock is still active (chip shows 🔒, suppression live) on every route
- **GIVEN** lock is toggled on the terminal route
- **WHEN** the user opens a board route
- **THEN** board panes observe the same lock state (single source of truth)

### Bottom Bar: Lock Chip Semantics

#### R4: Tap while locked unlocks without summoning the keyboard
In `app/frontend/src/components/bottom-bar.tsx`, a plain tap on the keyboard chip while `scrollLocked` is true MUST only unlock (`setScrollLocked(false)`) — it MUST NOT call `focusInput()`. Long-press semantics (toggle lock, auto-blur when locking) are unchanged. The locked-state `aria-label` ("Scroll lock on — tap to unlock") remains accurate and unchanged.

- **GIVEN** scroll-lock is active
- **WHEN** the user taps the 🔒 chip
- **THEN** the lock turns off and the soft keyboard does NOT appear
- **AND** a subsequent tap of the now-⌨ chip summons the keyboard as before

### Docs: xterm version correction

#### R5: context.md reflects xterm 6
`fab/project/context.md` SHOULD say xterm.js 6 (currently "xterm.js 5") — one-line correction discovered during diagnosis.

- **GIVEN** the frontend section of `fab/project/context.md`
- **WHEN** read after this change
- **THEN** the terminal line names xterm.js 6

### Non-Goals

- Inverting the coarse-pointer default (terminal taps never summon the keyboard) — explicitly deferred to a later change.
- Forwarding taps as synthesized SGR click sequences while locked — part of the deferred inversion design.
- Any change to the swipe-to-SGR-scroll path or the `touchend` suppressor — they stay as-is.

### Design Decisions

#### Suppress at the container capture phase, not inside xterm
**Decision**: Kill the leak with capture-phase `contextmenu`/`mousedown` listeners on run-kit's own terminal container, active only while locked.
**Why**: Ancestor capture-phase listeners provably run before xterm's element-level target/bubble listeners, so the focus never happens; the fix needs no xterm fork, no option, and no version coupling, and it is scoped to exactly the locked state.
**Rejected**: Patching/configuring xterm (no public option disables the contextmenu handler; forking is maintenance debt); relying on the existing React `onContextMenu` preventDefault (root-delegated bubble — runs after xterm has already focused, demonstrated in production); reactive focusin-blur as the primary mechanism (disrupts active touch sequences per the original code comment — kept only as a rarely-firing backstop).
*Introduced by*: 260816-lkzv-mobile-scroll-lock-hardening

#### Lock state persistence follows the composeStripEnabled shape
**Decision**: `scrollLocked` becomes a ChromeContext boolean persisted to `runkit-scroll-lock`, mirroring `composeStripEnabled`/`runkit-compose-strip`.
**Why**: ChromeContext already owns exactly this class of persisted chrome preference with an established read-once/write-through/try-catch idiom; a mobile tab reload is the common case that resets the lock today.
**Rejected**: Keeping per-mount `useState` and syncing via props (the current triplication — the bug); a module-level store outside ChromeContext (a second state-ownership pattern for no benefit).
*Introduced by*: 260816-lkzv-mobile-scroll-lock-hardening

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add `scrollLocked` + `setScrollLocked` to `app/frontend/src/contexts/chrome-context.tsx` (ChromeState + ChromeDispatch, localStorage key `runkit-scroll-lock`, `composeStripEnabled` pattern); unit tests in `chrome-context.test.tsx` (default false, persisted round-trip, setter notifies consumers) <!-- R3 -->
- [x] T002 Extend the scroll-lock effect in `app/frontend/src/components/terminal-client.tsx` (currently `touchend`-only, deps `[scrollLocked]`) with capture-phase `contextmenu` + `mousedown` suppressors (preventDefault + stopPropagation) and the capture-phase `focusin` → blur backstop for `.xterm` targets; unit tests in `terminal-client.test.tsx` (locked: contextmenu/mousedown default-prevented + stopped before child listeners, focusin target blurred; unlocked: no interference) <!-- R1, R2 -->
- [x] T003 Migrate consumers to the context: `bottom-bar.tsx` (drop local state at :101 + `onScrollLockChange` prop, read/write ChromeContext; tap-while-locked → unlock only, NO `focusInput()`), `app.tsx` (:1159) and `board-page.tsx` (:920) (drop local state + `onScrollLockChange` wiring, feed `scrollLocked` from context); update `bottom-bar.test.tsx` (tap-while-locked asserts no keyboard summon) and any test touching the removed props <!-- R3, R4 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Verification gates: `cd app/frontend && npx tsc --noEmit`, targeted Vitest suites (chrome-context, terminal-client, bottom-bar), then the standard verification order from `fab/project/code-quality.md` as applicable <!-- R1, R3 -->

### Phase 4: Polish

- [x] T005 Correct `fab/project/context.md` terminal line: xterm.js 5 → 6 <!-- R5 -->

## Execution Order

- T001 blocks T003 (consumers need the context field); T002 is independent of T001/T003.

## Acceptance

### Functional Completeness

- [x] A-001 R1: While locked, capture-phase `contextmenu` and `mousedown` listeners on the terminal container preventDefault + stopPropagation; removed when unlocked/unmounted (same effect as the `touchend` suppressor)
- [x] A-002 R2: While locked, a `focusin` landing inside `.xterm` is immediately blurred; the listener does not exist while unlocked
- [x] A-003 R3: `scrollLocked` lives in ChromeContext, persisted to `runkit-scroll-lock`; the three local useState copies and `onScrollLockChange` plumbing are gone
- [x] A-004 R4: Tap on the chip while locked unlocks without calling `focusInput()`; long-press behavior unchanged
- [x] A-005 R5: `fab/project/context.md` says xterm.js 6

### Behavioral Correctness

- [x] A-006 R3: Lock state survives a remount/route change (terminal ↔ board) and is shared — asserted by test or verified by the context round-trip test plus single-source wiring
- [x] A-007 R1: Unlocked behavior is unchanged — taps still focus the terminal (no suppressor active)

### Scenario Coverage

- [x] A-008 R1: Unit test dispatches `contextmenu` on a child of the locked container and asserts a child-level listener never fires (stopPropagation) and defaultPrevented is true
- [x] A-009 R4: Unit test taps the locked chip and asserts unlock + no focus summon

### Edge Cases & Error Handling

- [x] A-010 R3: localStorage read/write is try/catch-guarded (private-mode Safari); corrupt/absent value degrades to `false` (unlocked)
- [x] A-011 R2: The backstop blurs only `.xterm`-contained targets — compose strip / bottom bar / dialog focus is untouched while locked

### Code Quality

- [x] A-012 Pattern consistency: ChromeContext addition mirrors the `composeStripEnabled` idiom (storage key constant, read helper, memoized state, dispatch ref); suppressors mirror the existing `touchend` listener add/remove shape
- [x] A-013 No unnecessary duplication: no new state stores or parallel lock mechanisms; the existing effect is extended, not duplicated
- [x] A-014 Comment discipline: new comments state constraints the code can't show (why capture-phase, why the backstop is scoped to locked) — no narration, no change-ID citations in code
- [x] A-015 Tests included: new/changed behavior covered by Vitest unit tests (frontend type check passes)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change removes its own obsoleted code in the same diff (the three local `scrollLocked` useState copies, the `onScrollLockChange` prop, and BottomBar's `toggleScrollLock` wrapper are all deleted inline) and leaves no newly-redundant existing code behind.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Keep `scrollLocked` prop threading below page level (SurfaceLayout/BoardPane → TerminalClient) fed from context, rather than reading context inside TerminalClient | Smallest diff; TerminalClient already takes the prop and board panes pass it per-pane; intake allows either | S:70 R:90 A:85 D:70 |
| 2 | Confident | E2E omitted in favor of unit tests for the suppressors | Playwright cannot synthesize a real WebKit long-press contextmenu faithfully; unit-level event dispatch on the container proves the capture-phase contract; UI-change e2e is SHOULD not MUST in code-quality.md | S:60 R:85 A:75 D:65 |
| 3 | Certain | No change to the `touchend` suppressor or SGR swipe-scroll path | Intake marks them working and in-scope only for extension | S:85 R:90 A:95 D:90 |

3 assumptions (1 certain, 2 confident, 0 tentative).

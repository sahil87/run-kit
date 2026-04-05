# Tasks: Mobile Bar Keyboard Toggle

**Change**: 260327-bkm8-mobile-bar-keyboard-toggle
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Add Escape to `EXT_KEYS` array in `app/frontend/src/components/bottom-bar.tsx` — insert `{ label: "Esc", ... }` as the first element before PgUp. Use `sendSpecial("\x1b")` path (not `sendWithMods`) to preserve Ctrl re-arm behavior.

## Phase 2: Core Implementation

- [x] T002 Remove standalone Escape button from the bottom bar main row in `app/frontend/src/components/bottom-bar.tsx` — delete the `<button aria-label="Escape">` element (lines ~156-158).
- [x] T003 Wire Escape in Fn menu to use `sendSpecial` instead of `sendWithMods` — the extended-keys grid currently uses `sendWithMods` for all items, but Escape needs `sendSpecial` to preserve Ctrl-stays-armed semantics. Handle Escape as a special case in the `onClick` handler for the extended-keys grid.
- [x] T004 Add `onFocusTerminal` optional callback prop to `BottomBarProps` in `app/frontend/src/components/bottom-bar.tsx`.
- [x] T005 Replace keyboard-dismiss button with keyboard toggle in `app/frontend/src/components/bottom-bar.tsx` — change icon from `⌄` (U+2304) to `⌨` (U+2328), change `onClick` to toggle logic: if `document.activeElement` is inside terminal → blur, else → call `onFocusTerminal?.()`.
- [x] T006 Expose terminal focus from `TerminalClient` in `app/frontend/src/components/terminal-client.tsx` — add a `focusRef` callback prop (`React.RefObject<(() => void) | null>`) that the parent can call to invoke `xtermRef.current?.focus()`.
- [x] T007 Wire `onFocusTerminal` in `app/frontend/src/app.tsx` — create a ref for the focus callback, pass it to `TerminalClient` as `focusRef` and to `BottomBar` as `onFocusTerminal`.

## Phase 3: Integration & Edge Cases

- [x] T008 Add dynamic `aria-label` to keyboard toggle button — "Hide keyboard" when terminal is focused, "Show keyboard" otherwise. Use state derived from a `focuschange`-like listener or compute on click.
- [x] T009 Verify `preventFocusSteal` on keyboard toggle button — ensure `onMouseDown={preventFocusSteal}` is present so dismiss mode doesn't steal focus before blur fires.
- [x] T010 Run `cd app/frontend && npx tsc --noEmit` to verify TypeScript compiles cleanly.
- [x] T011 Run `just test-frontend` to verify existing tests pass.

---

## Execution Order

- T001 is independent (data change only)
- T002 depends on T001 (remove old button after Escape is in Fn menu)
- T003 depends on T001 (Escape must be in EXT_KEYS first)
- T004, T005, T006 can proceed in parallel after T002
- T007 depends on T004 + T005 + T006 (wires everything together)
- T008, T009 depend on T005 (toggle button must exist)
- T010, T011 are final gates

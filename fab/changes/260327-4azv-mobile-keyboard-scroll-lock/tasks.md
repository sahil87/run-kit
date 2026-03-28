# Tasks: Mobile Keyboard Scroll Lock

**Change**: 260327-4azv-mobile-keyboard-scroll-lock
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Add `scrollLocked` state and `onScrollLockChange` callback prop to `BottomBar` in `app/frontend/src/components/bottom-bar.tsx` — new prop in `BottomBarProps`, `useState(false)` for local tracking, call `onScrollLockChange` when toggled
- [x] T002 Add `scrollLocked` prop to `TerminalClient` in `app/frontend/src/components/terminal-client.tsx` — add to `TerminalClientProps`, no behavior yet
- [x] T003 Wire `scrollLocked` state through `app.tsx` — add `const [scrollLocked, setScrollLocked] = useState(false)` in `AppContent`, pass `onScrollLockChange={setScrollLocked}` to `BottomBar`, pass `scrollLocked={scrollLocked}` to `TerminalClient`

## Phase 2: Core Implementation

- [x] T004 Implement long-press detection on keyboard toggle button in `app/frontend/src/components/bottom-bar.tsx` — add `touchstart`/`touchend`/`touchmove` handlers with 500ms timer, 10px move cancellation, suppress click on long-press, toggle `scrollLocked` on long-press
- [x] T005 Implement tap behavior change in scroll-lock mode in `app/frontend/src/components/bottom-bar.tsx` — when `scrollLocked && tap`: set `scrollLocked` to `false` and call `onFocusTerminal` (unlock + summon keyboard in one action)
- [x] T006 Implement focus prevention in `app/frontend/src/components/terminal-client.tsx` — add `useEffect` that, when `scrollLocked` is `true`, attaches a capture-phase `focusin` listener on the terminal container that calls `blur()` on any `.xterm` element gaining focus
- [x] T007 Add visual indicator for locked state on keyboard toggle button in `app/frontend/src/components/bottom-bar.tsx` — conditional `bg-accent/20 border-accent text-accent` classes, swap icon from `⌨` (U+2328) to `🔒` (U+1F512), update `aria-label` to "Scroll lock on — tap to unlock"

## Phase 3: Integration & Edge Cases

- [x] T008 Auto-dismiss keyboard on lock activation in `app/frontend/src/components/bottom-bar.tsx` — when long-press triggers lock and terminal is focused (`termFocused`), call `document.activeElement?.blur()` before setting `scrollLocked`
- [x] T009 Add optional haptic feedback in `app/frontend/src/components/bottom-bar.tsx` — call `navigator.vibrate?.(50)` on scroll-lock toggle (long-press path only), graceful no-op if API unavailable
- [x] T010 Add unit tests for long-press detection and scroll-lock state in `app/frontend/src/components/bottom-bar.test.tsx` — test long-press toggles lock, tap preserves existing behavior, tap-in-locked-mode unlocks, touch-move cancels long-press, visual indicator classes

## Phase 4: Polish

- [x] T011 Add unit test for focus prevention in `app/frontend/src/components/terminal-client.test.tsx` — test that focusin events on `.xterm` elements are blocked when `scrollLocked` is `true`, allowed when `false`

---

## Execution Order

- T001 + T002 can run in parallel (independent prop additions)
- T003 depends on T001 + T002 (wiring requires both props to exist)
- T004 depends on T001 (long-press modifies `scrollLocked` state)
- T005 depends on T004 (tap behavior change builds on long-press detection)
- T006 depends on T002 (focus prevention reads `scrollLocked` prop)
- T007 depends on T001 (visual indicator reads `scrollLocked` state)
- T008 depends on T004 (auto-dismiss triggers during lock activation)
- T009 depends on T004 (haptic triggers during long-press)
- T010 depends on T004 + T005 + T007 (tests cover all bottom-bar behaviors)
- T011 depends on T006 (tests cover focus prevention)

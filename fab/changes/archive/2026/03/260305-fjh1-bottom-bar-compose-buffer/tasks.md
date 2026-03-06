# Tasks: Bottom Bar + Compose Buffer

**Change**: 260305-fjh1-bottom-bar-compose-buffer
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Hooks

- [x] T001 [P] Create `src/hooks/use-modifier-state.ts` — custom hook managing sticky modifier state (ctrl/alt/cmd booleans, arm/disarm/toggle/consume functions). `consume()` returns current state and clears all modifiers atomically.
- [x] T002 [P] Create `src/hooks/use-visual-viewport.ts` — custom hook using `window.visualViewport` API to constrain app height when iOS keyboard appears. Sets document element height to `visualViewport.height` on resize events. No-op on desktop.

## Phase 2: Components

- [x] T003 Create `src/components/bottom-bar.tsx` — Client Component rendering a single row of `<kbd>` buttons: modifier toggles (Ctrl/Alt/Cmd with armed visual state), arrow keys (←→↑↓ sending ANSI sequences), Fn dropdown (F1-F12, PgUp, PgDn, Home, End — closes after selection), Esc, Tab, and ✎ compose toggle. All buttons 44px min-height. Uses `useModifierState()` hook. Receives `wsRef: React.RefObject<WebSocket | null>` and `onToggleCompose: () => void`. Builds ANSI sequences with xterm modifier parameters when modifiers are armed.
- [x] T004 Create `src/components/compose-buffer.tsx` — Client Component rendering a native `<textarea>` overlay. Receives `wsRef: React.RefObject<WebSocket | null>` and `onClose: () => void`. Textarea gets `autoFocus`. Send button (or Cmd/Ctrl+Enter) transmits entire text as one WebSocket message then calls `onClose()`. Escape dismisses without sending.

## Phase 3: Integration

- [x] T005 Integrate bottom bar and compose buffer into `src/app/p/[project]/[window]/terminal-client.tsx` — add `composeOpen` state, call `setBottomBar(<BottomBar wsRef={wsRef} onToggleCompose={...} />)` via useEffect with cleanup. Render `<ComposeBuffer>` conditionally inside content area. Apply `opacity-50` to terminal div when compose is open. Add `i` key handler to open compose (intercept at document level, prevent reaching xterm, respect compose-already-open and active input elements). Hook up `useVisualViewport()`.
- [x] T006 Run verification: `npx tsc --noEmit` and `pnpm build` must both pass.

---

## Execution Order

- T001 and T002 are independent (parallel)
- T003 depends on T001 (uses useModifierState)
- T004 is independent of T003 (no shared deps beyond wsRef prop)
- T005 depends on T002, T003, T004 (wires everything together)
- T006 depends on T005

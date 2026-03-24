# Tasks: Command Palette Arrow Key Scroll

**Change**: 260324-yxjs-command-palette-arrow-scroll
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Core Implementation

- [x] T001 Add `listRef` to Command Palette listbox container in `app/frontend/src/components/command-palette.tsx` — declare `const listRef = useRef<HTMLDivElement>(null)` and attach `ref={listRef}` to the `<div id={listId} role="listbox">` element
- [x] T002 Add scroll-into-view `useEffect` in `app/frontend/src/components/command-palette.tsx` — fires on `[selectedIndex, open]`, queries `listRef.current` for `[aria-selected="true"]`, calls `scrollIntoView({ block: "nearest" })`

## Phase 2: Testing

- [x] T003 Add test for scroll-into-view behavior in `app/frontend/src/components/command-palette.test.tsx` — verify `scrollIntoView` is called on the selected element after ArrowDown key press

---

## Execution Order

- T001 blocks T002 (ref must exist before useEffect can reference it)
- T003 depends on T001 + T002

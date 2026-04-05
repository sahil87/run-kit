# Tasks: Fix Compose Buffer Dialog

**Change**: 260321-ye3t-fix-compose-buffer-dialog
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Upload Flow Refactor

- [x] T001 Change `useFileUpload` hook to return `{ path: string; file: File }[]` instead of `string[]` — `app/frontend/src/hooks/use-file-upload.ts`
- [x] T002 Update `terminal-client.tsx` to thread `{ path, file }` tuples: change `openComposeWithPaths` to accept tuples, store uploaded files in state alongside text, pass files to `ComposeBuffer` — `app/frontend/src/components/terminal-client.tsx`

## Phase 2: Core Implementation

- [x] T003 Fix path duplication in `compose-buffer.tsx`: remove `defaultValue`, remove the append `useEffect`, set textarea value imperatively via ref on mount and on `initialText` change (append only new text) — `app/frontend/src/components/compose-buffer.tsx`
- [x] T004 Add image preview strip to `compose-buffer.tsx`: render thumbnail strip above textarea, create blob URLs from `File` objects, show `<img>` for images and filename text for non-images, ~60px height — `app/frontend/src/components/compose-buffer.tsx`
- [x] T005 Add dismiss (X) button per preview item: clicking removes the file from preview and its path from textarea — `app/frontend/src/components/compose-buffer.tsx`
- [x] T006 Add click-to-enlarge: clicking a thumbnail toggles a larger constrained preview within the dialog, click or Escape dismisses — `app/frontend/src/components/compose-buffer.tsx`

## Phase 3: Dialog Pattern Alignment

- [x] T007 Refactor compose buffer layout to match `dialog.tsx` pattern: `fixed inset-0 z-40`, separate backdrop layer (`aria-hidden`), two-layer click-outside close (outer `onClick={onClose}`, inner `stopPropagation`) — `app/frontend/src/components/compose-buffer.tsx`
- [x] T008 Add ARIA attributes: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` referencing title ID via `useId()` — `app/frontend/src/components/compose-buffer.tsx`
- [x] T009 Add focus trap: document-level keydown handler for Tab/Shift+Tab cycling within dialog focusable elements, matching `dialog.tsx` implementation — `app/frontend/src/components/compose-buffer.tsx`

## Phase 4: Cleanup

- [x] T010 Revoke all blob URLs on dialog close (close, send, escape) via cleanup in the component — `app/frontend/src/components/compose-buffer.tsx`
- [x] T011 Run `cd app/frontend && npx tsc --noEmit` to verify no type errors

---

## Execution Order

- T001 blocks T002 (hook return type must change before consumer)
- T002 blocks T003-T006 (compose buffer needs file props)
- T003 is independent of T004-T006
- T004 blocks T005 and T006 (preview strip needed before dismiss/enlarge)
- T007-T009 are independent of T003-T006 (dialog structure vs content)
- T010 depends on T004 (needs blob URLs to exist)
- T011 runs last

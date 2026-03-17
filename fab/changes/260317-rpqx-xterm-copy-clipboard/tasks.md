# Tasks: Fix xterm Terminal Copy to Clipboard

**Change**: 260317-rpqx-xterm-copy-clipboard
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Core Implementation

- [x] T001 Add clipboard copy helper function with fallback in `app/frontend/src/components/terminal-client.tsx` — extract a `copyToClipboard(text: string)` async function that tries `navigator.clipboard.writeText()` first, then falls back to `document.execCommand('copy')` with a temporary off-screen `<textarea>`
- [x] T002 Update the `attachCustomKeyEventHandler` callback in `app/frontend/src/components/terminal-client.tsx` to use the new `copyToClipboard` helper and call `term.clearSelection()` after copy

## Phase 2: Testing

- [x] T003 Add unit test for clipboard copy fallback in `app/frontend/src/components/terminal-client.test.tsx` — test that the fallback textarea is created, used, and removed when `navigator.clipboard.writeText` is unavailable

---

## Execution Order

- T001 blocks T002
- T003 depends on T001+T002

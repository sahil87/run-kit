# Tasks: Fix OSC 52 Clipboard Provider

**Change**: 260321-zbdq-fix-osc52-clipboard-provider
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Core Implementation

- [x] T001 Replace default `ClipboardAddon()` instantiation with custom provider in `app/frontend/src/components/terminal-client.tsx` (line 160) — pass `undefined` as base64 handler, custom `{ readText, writeText }` as provider that accepts both `""` and `"c"` selection targets

## Phase 2: Tests

- [x] T002 Add unit test for the custom clipboard provider logic in `app/frontend/src/components/terminal-client.test.ts` — verify `writeText` is called for `""` and `"c"` selections, verify it is NOT called for `"p"` and other selections

---

## Execution Order

- T001 blocks T002

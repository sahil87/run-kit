# Plan: Palette Window Switch

**Change**: 260613-o20f-palette-window-switch
**Intake**: `intake.md`

## Requirements

### Command Palette: Per-window switch entries

#### R1: Relabel and regroup the existing per-window palette entries
The existing per-window command-palette entries in `app/frontend/src/app.tsx` (the `terminalActions` useMemo) SHALL be relabeled and regrouped under the `Window:` action family so the keyboard switch path (Constitution V — Keyboard-First) is discoverable. The block SHALL be renamed `terminalActions` → `windowSwitchActions`. Each entry's label SHALL read `Window: Switch to ${session} › ${window.name}`, where `›` is U+203A (single right-pointing angle quote) with a single space on each side. The label SHALL append `" (current)"` when `fw.window.windowId === windowParam` (the URL's active window id), mirroring `Server: Switch to <name> (current)`. Each entry's `id` SHALL be `window-switch-${session}-${windowId}`. The `onSelect` SHALL remain `() => navigateToWindow(fw.window.windowId)` — no new `selectWindow` call is added (navigateToWindow already wraps it). The useMemo dep array SHALL add `windowParam`. Both references in the `paletteActions` composition useMemo (the `...terminalActions` spread and the dep array) SHALL be updated to `windowSwitchActions`.

- **GIVEN** the command palette is open and multiple windows exist across sessions
- **WHEN** the entries render
- **THEN** there is one `Window: Switch to <session> › <name>` entry per window across every session
- **AND** the entry for the window whose id equals `windowParam` carries the `" (current)"` suffix
- **AND** selecting an entry invokes `navigateToWindow(windowId)` (URL nav + selectWindow + mobile-close + writeback suppression), unchanged from before

#### R2: Unit coverage for the relabeled entries
A focused unit test SHALL be added to `app/frontend/src/app.test.tsx` asserting the relabeled entries: one `Window: Switch to <session> › <name>` entry per window, the `›` (U+203A) separator with surrounding spaces, and the `" (current)"` suffix applied only to the entry whose window id matches the active (URL) window. The test SHALL follow the existing mirrored-builder idiom in that file (a local `build*Actions` helper reproducing the `app.tsx` construction logic, rendered via `<CommandPalette actions={...} />`, asserted on label text) — the same idiom already used for `command-palette.boards.test.tsx`'s `(current)` coverage.

- **GIVEN** a builder reproducing the `windowSwitchActions` construction with a set of windows and a designated active window id
- **WHEN** the palette renders and is opened
- **THEN** each window produces a `Window: Switch to <session> › <name>` entry with the `›` separator
- **AND** only the entry matching the active window id carries `" (current)"`

### Non-Goals

- No new `selectWindow` call site — `navigateToWindow` already wraps it.
- No edits to `windowActions` (current-window-only Create/Rename/Move/Kill/Split), `navigateToWindow`, `flatWindows`, or `selectWindow`.
- No arrow-key tree navigation (Wave 3 / `wt1v`).
- No cross-server switch entries — `flatWindows` is the current server's sessions only.
- No change to the composition ordering — `windowSwitchActions` keeps its existing last position in `paletteActions`.

### Design Decisions

1. **Relabel in place, do not add a second block**: the palette already switches windows via `terminalActions` → `navigateToWindow` → `selectWindow` (present since PR #34). *Why*: a net-new block would duplicate rows per window and bypass `pendingClickRef` writeback-suppression + mobile-close that `navigateToWindow` already provides. *Rejected*: building a fresh `windowActions`-style block calling `selectWindow` directly (the backlog's framing) — strictly worse (duplicate rows, reintroduced SSE bounce-back).
2. **Compare `windowParam`, not `currentWindow?.windowId`, for `(current)`**: *Why*: `windowParam` is the canonical "what am I viewing" URL id used for alignment keys throughout `app.tsx`; equivalent to `currentWindow?.windowId` but needs no extra derivation. *Rejected*: `currentWindow?.windowId` — equivalent result, extra indirection.

## Tasks

### Phase 2: Core Implementation

- [x] T001 Relabel/rename the `terminalActions` useMemo in `app/frontend/src/app.tsx` (~:1063-1070) to `windowSwitchActions`: new id `window-switch-${fw.session}-${fw.window.windowId}`, label `Window: Switch to ${fw.session} › ${fw.window.name}` + `" (current)"` when `fw.window.windowId === windowParam`, add `windowParam` to the dep array, and update the leading comment to reflect the switch purpose. Then update both references in the `paletteActions` composition useMemo (~:1072-1075): the `...terminalActions` spread and the dep array → `windowSwitchActions`. <!-- R1 -->

### Phase 3: Integration & Edge Cases

- [x] T002 Add a focused unit test to `app/frontend/src/app.test.tsx` following the file's mirrored-builder idiom: a `buildWindowSwitchActions` helper reproducing the `windowSwitchActions` construction (windows list + active window id), rendered via `<CommandPalette actions={...} />`, asserting one `Window: Switch to <session> › <name>` entry per window, the `›` (U+203A) separator, and `" (current)"` only on the active window's entry. <!-- R2 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `app.tsx` renders one `Window: Switch to <session> › <name>` palette entry per window across every session, with id `window-switch-${session}-${windowId}`, `›` = U+203A with surrounding spaces, and `onSelect` calling `navigateToWindow(windowId)`. (Verified app.tsx:1069-1078 — flatWindows.map, label/id/onSelect all match.)
- [x] A-002 R2: `app.test.tsx` contains a passing test asserting the relabeled entries (per-window presence, `›` separator, `(current)` on the active window). (app.test.tsx:421-501 `CmdK Window Switch Actions`; all 602 frontend tests pass.)

### Behavioral Correctness

- [x] A-003 R1: The `" (current)"` suffix appears only on the entry whose `windowId === windowParam`; the `terminalActions` binding is gone (renamed to `windowSwitchActions`) and both `paletteActions` references are updated, with `windowParam` added to the deps array. `onSelect` behavior is unchanged (no new `selectWindow` call). (Verified: app.tsx:1073 ternary; both `paletteActions` refs at :1081-1082; deps at :1077; grep confirms no `terminalActions` binding remains; onSelect = `navigateToWindow(fw.window.windowId)` at :1075.)

### Scenario Coverage

- [x] A-004 R2: The unit test exercises both branches — a window matching the active id (gets `(current)`) and at least one not matching (no suffix). (app.test.tsx:434-453: `@2` matches windowParam → `(current)`; `@1`/`@3` do not → no suffix; plus a `windowParam: undefined` case at :455-470 asserting zero `(current)` entries.)

### Code Quality

- [x] A-005 Pattern consistency: The relabeled block follows the surrounding palette-action construction style (matches the `Server: Switch to … (current)` pattern at `app.tsx:1054-1058`); the test follows the existing mirrored-builder idiom in `app.test.tsx` / `command-palette.boards.test.tsx`. (`(current)` ternary mirrors serverActions:1056; test uses the same `build*Actions` helper + `<CommandPalette actions={...} />` + "kept in sync" doc-comment as boards.test.tsx:31.)
- [x] A-006 No unnecessary duplication: No second per-window block is introduced; `navigateToWindow` is reused rather than re-plumbing `selectWindow`; the test reuses the existing `CommandPalette` render harness. (Diff is an in-place rename of the single existing block; onSelect still calls the pre-existing `navigateToWindow`.)
- [x] A-007 Type check: `tsc --noEmit` passes (the build gate) and the relabeled code type-checks against `PaletteAction`. (`cd app/frontend && npx tsc --noEmit` exit 0.)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Deletion Candidates

None — this change relabels/regroups existing palette entries (rename `terminalActions` → `windowSwitchActions`, reuse `navigateToWindow`); no net-new switching capability and nothing rendered redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is relabel/rename the existing `terminalActions` block (not a net-new block); reuse `navigateToWindow`. | Carried from intake (user chose "Relabel/dedupe existing"; code-verified the entries live in `terminalActions` since PR #34, and `navigateToWindow` already wraps `selectWindow`). | S:98 R:82 A:95 D:95 |
| 2 | Confident | Label `Window: Switch to <session> › <name>` with `›` = U+203A + surrounding spaces, `(current)` on the URL-active window via `fw.window.windowId === windowParam`. | Backlog/intake specify the label + separator verbatim; `(current)` mirrors `Server: Switch …(current)`; `windowParam` is the canonical URL-active id. | S:80 R:90 A:78 D:85 |
| 3 | Confident | Unit test follows the file's mirrored-builder idiom and asserts presence + `›` separator + `(current)`; `windowParam` is cleanly reachable as a builder option (no disproportionate setup), so the full assertion set is covered — the intake's fallback-scoping caveat does not apply. | `app.test.tsx` and `command-palette.boards.test.tsx` already mirror `app.tsx` action construction and test `(current)` via a builder option; replicating that for `windowSwitchActions` is the established, low-risk shape. | S:70 R:92 A:85 D:88 |

3 assumptions (1 certain, 2 confident, 0 tentative).

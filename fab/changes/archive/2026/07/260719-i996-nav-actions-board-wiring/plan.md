# Plan: Wire Board Nav Actions, Narrow NavMode

**Change**: 260719-i996-nav-actions-board-wiring
**Intake**: `intake.md`

## Requirements

### Frontend: Board palette navigation parity

#### R1: Board route palette carries the nav trio
`boardRouteActions` (the `useMemo` in `app/frontend/src/components/board/board-page.tsx`) MUST include the navigation entries produced by `buildNavActions("board", "", handlers)` — `Go: Back`, `Go: Forward`, `Go: Host` — closing the Constitution V parity gap (the top-bar history arrows render on all four page modes, but the board palette currently offers no nav entries). Handlers MUST mirror AppShell's wiring at `app.tsx` `navActions`: `onBack: () => router.history.back()`, `onForward: () => router.history.forward()`, `onHost: () => navigate({ to: "/" })`; `onTmuxServer` is a no-op (unreachable — the entry is gated on `mode === "terminal" && server`, and the `server` arg is `""`). The nav entries' position MUST mirror AppShell's relative ordering (nav after the route-specific groups, before the terminal-font trio): composed after `conditional` and before `fontEntries`.

- **GIVEN** the `/board/$name` route with its palette open
- **WHEN** the action list renders
- **THEN** `Go: Back`, `Go: Forward`, and `Go: Host` are present
- **AND** `Go: tmux Server` is NOT present

- **GIVEN** the board palette
- **WHEN** `Go: Host` is selected
- **THEN** the app navigates to `/` (and `Go: Back`/`Go: Forward` drive `router.history`)

### Frontend: NavMode narrowing

#### R2: `NavMode` drops the dead `host` mode
`NavMode` in `app/frontend/src/lib/palette-nav.ts` MUST be narrowed to `"terminal" | "board" | "server"`. The doc comments MUST be updated: the mode list loses the `host: none` row and notes that `NavMode` is the palette-bearing subset of `TopBarMode` (the root Host route mounts no palette, hence no `host` mode); the module header's "a solo Host route (no ancestors) yields only the two history actions" sentence is replaced (every supported mode emits at least `Go: Host`). The now-unconditional ancestor gate (`mode === "terminal" || mode === "board" || mode === "server"`) SHALL be simplified to a plain push with a comment.

- **GIVEN** the narrowed `NavMode`
- **WHEN** `buildNavActions` is called with any supported mode
- **THEN** the result always ends with the `go-host` entry
- **AND** `buildNavActions("host", ...)` is a compile-time type error

### Tests

#### R3: `palette-nav.test.ts` covers the narrowed contract
The `"host"`-mode cases in `app/frontend/src/lib/palette-nav.test.ts` MUST be retargeted or removed: the "Back and Forward first" case retargets to a surviving mode, and the "host offers ONLY the two history actions" case is replaced by coverage that every supported mode emits `Go: Host`. Existing terminal/board/server cases stay green.

- **GIVEN** the updated test file
- **WHEN** `just test-frontend` runs
- **THEN** no test references the `"host"` mode and all pass

#### R4: `command-palette.boards.test.tsx` asserts the nav trio
The boards palette test mirror (`buildBoardActions` in `app/frontend/src/components/command-palette.boards.test.tsx`) MUST fold in the nav entries via the production `buildNavActions` helper (the same treatment `buildUpdateActions` already gets), positioned per production (after `conditional`), and tests MUST assert the three nav entries render on the board palette and that selection invokes the wired handler.

- **GIVEN** a board-route palette built by the test mirror
- **WHEN** the palette opens
- **THEN** `Go: Back`, `Go: Forward`, `Go: Host` are present and `Go: tmux Server` is absent
- **AND** selecting `Go: Host` invokes the host handler

### Non-Goals

- No Host-page palette (the root `/` route mounts no `CommandPalette`; adding one is feature creep — Constitution IV). `TopBarMode` keeps its `"host"` member — only `NavMode` narrows.
- No changes to AppShell's `navActions` wiring (terminal/server modes unchanged).
- No e2e specs — unit-test-only change (`.spec.md` companions not required for `*.test.tsx`).

### Design Decisions

#### Nav entries positioned after the board group, before the font trio
**Decision**: Compose the nav entries in `boardRouteActions`' return as `[...switchEntries, ...conditional, ...navEntries, ...fontEntries, refreshEntry, helpEntry, ...]`.
**Why**: AppShell's verified composition (`app.tsx:2322`) places `navActions` after the route-specific groups (`boardActions`, `viewActions`) and before `terminalFontActions` — mirroring that relative order keeps the two palettes predictable.
**Rejected**: Leading the array with nav entries (the intake parenthetical's guess "nav actions lead the route group") — it contradicts AppShell's actual ordering, and the intake explicitly delegates placement to verification of `app.tsx`.
*Introduced by*: 260719-i996-nav-actions-board-wiring

## Tasks

### Phase 1: Core Implementation

- [x] T001 Narrow `NavMode` to `"terminal" | "board" | "server"` in `app/frontend/src/lib/palette-nav.ts`; update the module-header + type doc comments (palette-bearing subset of `TopBarMode`; drop the solo-Host sentence); simplify the ancestor gate to an unconditional `Go: Host` push with a comment <!-- R2 -->
- [x] T002 Wire `buildNavActions("board", "", {...})` into `boardRouteActions` in `app/frontend/src/components/board/board-page.tsx`: import `buildNavActions` (`@/lib/palette-nav`) + `useRouter` (`@tanstack/react-router`), build the nav entries with handlers mirroring AppShell (`router.history.back()`/`.forward()`, `navigate({ to: "/" })`, no-op `onTmuxServer` with an unreachable comment), compose after `conditional` / before `fontEntries`, add `router` to the memo deps <!-- R1 -->

### Phase 2: Tests

- [x] T003 [P] Update `app/frontend/src/lib/palette-nav.test.ts`: retarget the two `"host"` cases (Back/Forward-first → a surviving mode; host-only case → every-mode-emits-`Go: Host` coverage) <!-- R3 -->
- [x] T004 [P] Update `app/frontend/src/components/command-palette.boards.test.tsx`: fold `buildNavActions("board", ...)` into the `buildBoardActions` mirror (production helper, positioned after `conditional`), extend the mirror doc comment, add tests for nav-trio presence (+ `Go: tmux Server` absence) and `Go: Host` selection wiring <!-- R4 -->

### Phase 3: Verification

- [x] T005 Run `just check` (typecheck) and `just test-frontend` (Vitest); fix any failures <!-- R1 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `boardRouteActions` includes `Go: Back` / `Go: Forward` / `Go: Host` built via `buildNavActions("board", "", ...)` with AppShell-mirroring handlers, and no `Go: tmux Server`
- [x] A-002 R2: `NavMode` is exactly `"terminal" | "board" | "server"`; doc comments describe the palette-bearing-subset relationship to `TopBarMode`; the `Go: Host` push is unconditional

### Behavioral Correctness

- [x] A-003 R1: Nav entries sit after the board-specific entries and before the terminal-font trio, mirroring AppShell's group ordering; `Go: Host` navigates to `/`

### Removal Verification

- [x] A-004 R2: No production or test code references a `"host"` `NavMode` (only `TopBarMode` retains `"host"`)

### Scenario Coverage

- [x] A-005 R3: `palette-nav.test.ts` passes with the host cases retargeted and every supported mode asserted to emit `Go: Host`
- [x] A-006 R4: `command-palette.boards.test.tsx` asserts nav-trio presence on the board palette and `Go: Host` selection wiring

### Code Quality

- [x] A-007 Pattern consistency: board wiring mirrors AppShell's `navActions` handler shapes; test mirror uses the production builder (the `buildUpdateActions` precedent)
- [x] A-008 No unnecessary duplication: nav gating/labels stay solely in `buildNavActions` — no hand-rolled nav entries in `board-page.tsx` or the test mirror
- [x] A-009 Type narrowing over assertions: the `NavMode` narrowing is enforced by the type system (no `as` casts introduced)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change narrows the `NavMode` type and wires one existing builder into the board palette; the removed `host` branch/type member is deleted in this diff itself (not a residual candidate), and no other file becomes redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Nav entries composed after `conditional`, before `fontEntries` — not leading the array | Intake delegates placement to verification of `app.tsx`; verified composition (line 2322) puts nav after route groups, before the font trio — the intake's "lead the route group" parenthetical mismatches and mirroring wins | S:65 R:90 A:85 D:75 |
| 2 | Confident | Test mirror folds nav in via the production `buildNavActions` (not hand-rolled entries) | Matches the file's own `buildUpdateActions` precedent ("built via the SAME production helper"); keeps the shape unit-tested at the source | S:70 R:90 A:85 D:80 |
| 3 | Certain | The removed host-only test is replaced by every-mode-emits-`Go: Host` coverage | Intake directs the module comment to state exactly this invariant; direct test of the simplified unconditional push | S:80 R:95 A:90 D:85 |

3 assumptions (1 certain, 2 confident, 0 tentative).

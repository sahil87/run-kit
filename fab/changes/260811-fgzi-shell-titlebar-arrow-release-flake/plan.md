# Plan: Shell-Titlebar Arrow-Key Release Flake Root Fix

**Change**: 260811-fgzi-shell-titlebar-arrow-release-flake
**Intake**: `intake.md`

## Requirements

### Frontend: Shell-Titlebar Strip Keydown Guard

#### R1: Live committed row-count ref

`ShellTitlebarStrip` (`app/frontend/src/components/shell-titlebar-strip.tsx`) MUST maintain a ref (`hostCountRef`) holding the committed host-row count, updated no later than commit time (render-time latest-ref write or `useLayoutEffect` — a passive `useEffect` write is forbidden, as it would flush in the same phase as the subscription swap it is meant to beat).

- **GIVEN** the host-switcher menu is open and a keydown subscription exists
- **WHEN** an open-time refetch commits a render with a new row count
- **THEN** `hostCountRef.current` reflects the NEW committed count before any keydown dispatched after that commit can reach a still-attached stale handler

#### R2: Subscription-staleness-proof emptied-list guard

Inside `handleKey`, the emptied-list guard (`if (hostCount === 0) return`) MUST read the live value from `hostCountRef.current` instead of the closure capture, so a stale subscription (still attached from commit until passive-effect flush) releases ArrowDown/ArrowUp instead of calling `preventDefault` app-wide.

- **GIVEN** the menu is open with a non-empty host list and a capture-phase keydown handler subscribed
- **WHEN** an open-time refetch resolves with an empty list, committing a render that unmounts the trigger and menu
- **THEN** any ArrowDown/ArrowUp dispatched in the commit→flush window keeps its default behavior (no `preventDefault`), because the stale handler reads the live zero count

#### R3: Live wraparound modulus

The wraparound modulus (`count`) inside the ArrowDown/ArrowUp branch MUST be derived from the same live `hostCountRef.current` read plus `canAdd`, so a shrunk-but-non-empty list cycles over the live count rather than the subscription-time capture.

- **GIVEN** the menu is open with N host rows
- **WHEN** an open-time refetch shrinks the list to M rows (0 < M < N) and the user arrows before re-subscription
- **THEN** focus cycles modulo `M + (canAdd ? 1 : 0)`

#### R4: Comment accuracy

The comment block explaining the emptied-list guard in the keydown effect MUST describe the live ref-read mechanism (subscription-staleness-proof), not the former closure-capture behavior.

- **GIVEN** the fixed implementation
- **WHEN** a reader inspects the keydown effect's comment block
- **THEN** the comment accurately describes why and how the guard observes the committed count

#### R5: Behavior preservation

Escape handling (close + focus return to trigger), `stopPropagation` on handled arrows, the effect's subscription and dependency list (`[open, rows.length, canAdd]`), and the close-on-empty / clamp / focus-seed effects MUST remain functionally unchanged.

- **GIVEN** the menu is open with a stable host list
- **WHEN** the user presses Escape, ArrowDown, or ArrowUp
- **THEN** behavior is identical to before the fix (same guard threshold, same wraparound arithmetic, values read one commit fresher)

### Non-Goals

- No changes to `shell-titlebar-strip.test.tsx` — the existing test at `:322–348` is already the regression test and MUST pass deterministically as-is (Test Integrity: tests conform to spec).
- No e2e coverage — the strip is `isShell()`-gated Electron chrome, invisible to Playwright.
- No narrowing of the keydown effect's dependency list — harmless churn, not required for correctness.

### Design Decisions

#### Live ref read over test-timing or effect-teardown workarounds

**Decision**: Read the live committed row count from `hostCountRef.current` inside `handleKey`; guard and modulus both key on it.
**Why**: It removes the stale-closure window itself — the guard reflects the committed count regardless of which render subscribed the handler. Alternatives fix the symptom, not the window.
**Rejected**: Forcing synchronous effect teardown (fights React's effect model); wrapping test timing in `act` (fixes the test while leaving the production arrow-swallow window in place).
*Introduced by*: 260811-fgzi-shell-titlebar-arrow-release-flake

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add `hostCountRef` synced at commit time in `app/frontend/src/components/shell-titlebar-strip.tsx`, rewrite the `handleKey` emptied-list guard and wraparound modulus to read `hostCountRef.current`, and update the guard's comment block to describe the ref-read mechanism <!-- R1, R2, R3, R4, R5 -->

### Phase 3: Integration & Edge Cases

- [x] T002 Run `just test-frontend` and confirm the colocated suite `app/frontend/src/components/shell-titlebar-strip.test.tsx` passes — in particular "closes and releases key handling when the open-time refetch empties the list" (`:322–348`), unchanged <!-- R2, R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `hostCountRef` exists in `shell-titlebar-strip.tsx` and is written with `rows.length` no later than commit (not via passive `useEffect`)
- [x] A-002 R2: the ArrowDown/ArrowUp emptied-list guard reads `hostCountRef.current`, not a closure-captured count
- [x] A-003 R3: the wraparound modulus derives from the live `hostCountRef.current` read plus `canAdd`
- [x] A-004 R4: the guard's comment block describes the live ref-read mechanism

### Behavioral Correctness

- [x] A-005 R5: Escape handling, focus return to trigger, `stopPropagation`, the subscription dependency list, and the close-on-empty / clamp / focus-seed effects are unchanged in behavior

### Scenario Coverage

- [x] A-006 R2: "closes and releases key handling when the open-time refetch empties the list" (`shell-titlebar-strip.test.tsx:322–348`) passes deterministically with no test modifications — both `fireEvent.keyDown` assertions return `true`

### Edge Cases & Error Handling

- [x] A-007 R3: with a shrunk-but-non-empty refetched list, arrow-key wraparound cycles over the live row count (covered by the existing re-clamp / arrow tests in the same suite)

### Code Quality

- [x] A-008 Pattern consistency: the ref addition follows the component's existing ref/effect idioms (`listSeqRef`, `itemRefs`, colocated comments)
- [x] A-009 No unnecessary duplication: no new utilities introduced; the change is a ref plus read-site edits inside one effect
- [x] A-010 Test coverage: the changed behavior is covered by the existing colocated vitest regression test (per code-quality.md, bug fixes must carry tests — here the test predates the fix and becomes deterministic)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — the fix is a ref addition plus read-site edits; the only code made redundant (the closure-captured `hostCount`/`count` at the top of the keydown effect) was removed in the same diff.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Ref sync mechanism is a `useLayoutEffect` keyed on `rows.length` (rather than a render-time write) — both satisfy the no-later-than-commit contract; the layout effect avoids mutating a ref during render (safe under discarded/concurrent renders) and the file already imports `useLayoutEffect` | Intake explicitly leaves the mechanism to apply within the stated constraint; layout-effect choice is the conservative React-idiomatic option, easily reversed | S:60 R:90 A:85 D:70 |
| 2 | Certain | `canAdd` stays closure-captured (does not ride the ref) — it changes only when the shell bridge shape changes, never mid-window | Intake permits either; closure capture keeps the diff minimal with no correctness cost | S:75 R:90 A:85 D:85 |
| 3 | Certain | The keydown effect's dependency list stays `[open, rows.length, canAdd]` — the ref read alone closes the window; re-subscription churn is harmless | Intake Assumption 4 (Certain) prescribes this; narrowing deps is an optional simplification, not required | S:70 R:95 A:85 D:75 |
| 4 | Certain | No changes to `shell-titlebar-strip.test.tsx` — the existing `:322–348` test is the regression test and must pass deterministically as-is; any residual raciness is new information to surface, not patch around | Intake Assumption 5 (Certain) and constitution Test Integrity: tests conform to spec | S:80 R:90 A:95 D:90 |

4 assumptions (3 certain, 1 confident, 0 tentative).

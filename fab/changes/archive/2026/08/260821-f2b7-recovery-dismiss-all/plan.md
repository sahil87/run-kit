# Plan: Recovery Dismiss All

**Change**: 260821-f2b7-recovery-dismiss-all
**Intake**: `intake.md`

## Requirements

### Recovery Zone: Bulk Dismiss

#### R1: `dismissAll` in the recovery hook
`useRecoveryOffers()` (`app/frontend/src/components/recovery-section.tsx`) SHALL expose `dismissAll: () => Promise<void>` on the `RecoveryState` type, implemented as a sequential client-side loop over `offersRef.current` calling the existing `dismiss(server)` per offer — mirroring `restoreAll` exactly. No new backend endpoint SHALL be added: each iteration rides the existing `POST /api/recovery/dismiss` (idempotent, atomic tombstone rename). A per-server failure toasts (inside `dismiss`) and MUST NOT block the remaining servers. `dismissAll` MUST be included in the returned `useMemo` object.

- **GIVEN** three restorable offers
- **WHEN** `dismissAll()` runs
- **THEN** `dismissRecoveryServer` is POSTed once per server, sequentially, in offer order
- **AND** a rejection on the second server still dismisses the third (the loop continues; `dismiss` catches and toasts internally)

#### R2: "Dismiss all" heading control
`RecoverySection` SHALL render a `Dismiss all` button in the `SectionHeading` `side` slot, after `Restore all ({N})`, under the same `offers.length > 1` gate and sharing the existing button classes. No confirmation dialog SHALL be shown — consistent with the per-row `×` and `Restore all` (neither confirms); a dismissal is not data loss (rolling history files survive; only the offer path closes via audited tombstone).

- **GIVEN** two or more offers
- **WHEN** the RECOVERY zone renders
- **THEN** the heading side slot carries `Restore all (2)` followed by `Dismiss all`
- **AND** clicking `Dismiss all` removes every row with no confirmation prompt

- **GIVEN** exactly one offer
- **WHEN** the RECOVERY zone renders
- **THEN** neither bulk button renders (per-row controls suffice)

#### R3: Palette parity (Constitution V)
`buildRecoveryActions` (`app/frontend/src/lib/palette-recovery.ts`) SHALL register a `recovery-dismiss-all` action labelled `Dismiss all previous servers`, gated on `offers.length > 1` (the same gate as `recovery-restore-all`), invoking a new `onDismissAll` handler added to the `RecoveryHandlers` type. `HostOverviewPage` (`app/frontend/src/components/host-overview-page.tsx`) SHALL wire `onDismissAll: () => void recovery.dismissAll()` in the existing registration block, so the palette verb drives the same hook flow as the heading button.

- **GIVEN** two or more offers
- **WHEN** `buildRecoveryActions` builds the palette entries
- **THEN** the list contains `recovery-dismiss-all` → `Dismiss all previous servers`, whose `onSelect` calls `onDismissAll`

- **GIVEN** one offer or zero offers
- **WHEN** `buildRecoveryActions` runs
- **THEN** no `recovery-dismiss-all` entry is produced

#### R4: Tests and companion doc
The change SHALL extend the existing colocated unit tests (`recovery-section.test.tsx`, `palette-recovery.test.ts`) covering the sequential loop (including continue-past-failure), the button render gate, and the palette registration gate; and SHALL extend `app/frontend/tests/e2e/recovery-section.spec.ts` with a dismiss-all scenario (multiple offers → click Dismiss all → section disappears), updating the sibling `recovery-section.spec.md` in the same commit (Constitution: Test Companion Docs). Tests run via `just test-frontend` / `just test-e2e "<spec>"` — never direct playwright.

- **GIVEN** the extended e2e spec
- **WHEN** two offers are mocked and `Dismiss all` is clicked
- **THEN** two dismiss POSTs land (one per server) and the Recovery region leaves the DOM

### Non-Goals

- No bulk backend endpoint — the shipped `restoreAll` precedent is client-side sequential POSTs.
- No confirmation dialog — consistent with every existing control in the section.
- No changes to the ephemeral sibling stack (`zelc`/`hbmh`/`l1qe`) — this change bases on `main` independently.

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add `dismissAll` to the `RecoveryState` type and implement it in `useRecoveryOffers()` mirroring `restoreAll` (sequential loop over `offersRef.current` calling `dismiss`); include it in the returned `useMemo` object — `app/frontend/src/components/recovery-section.tsx` <!-- R1 -->
- [x] T002 Render the `Dismiss all` button in the `SectionHeading` `side` slot after `Restore all ({N})`, same `offers.length > 1` gate, shared button classes — `app/frontend/src/components/recovery-section.tsx` <!-- R2 -->
- [x] T003 [P] Add `onDismissAll` to `RecoveryHandlers` and the `recovery-dismiss-all` / `Dismiss all previous servers` entry (gated `offers.length > 1`) in `buildRecoveryActions` — `app/frontend/src/lib/palette-recovery.ts` <!-- R3 -->
- [x] T004 Wire `onDismissAll: () => void recovery.dismissAll()` into the existing `buildRecoveryActions` registration block — `app/frontend/src/components/host-overview-page.tsx` <!-- R3 -->

### Phase 3: Integration & Edge Cases (tests)

- [x] T005 Extend `app/frontend/src/components/recovery-section.test.tsx`: Dismiss all renders only at >1 offers; clicking it dismisses every offer sequentially; a mid-loop dismiss failure toasts and does not block the remaining servers <!-- R1 -->
- [x] T006 [P] Extend `app/frontend/src/lib/palette-recovery.test.ts`: `recovery-dismiss-all` present at 2 offers with correct id/label/handler dispatch, absent at 0/1 offers <!-- R3 -->
- [x] T007 Extend `app/frontend/tests/e2e/recovery-section.spec.ts` with a dismiss-all scenario (two offers → click `Dismiss all` → two dismiss POSTs → section gone) and update `recovery-section.spec.md` in the same commit; run via `just test-frontend` and `just test-e2e "recovery-section"` <!-- R4 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `RecoveryState.dismissAll` exists, loops `offersRef.current` sequentially via `dismiss`, and is returned from the hook's `useMemo`
- [x] A-002 R2: The `Dismiss all` button renders in the heading side slot after `Restore all ({N})` when `offers.length > 1`, with shared button classes and no confirmation dialog
- [x] A-003 R3: `buildRecoveryActions` emits `recovery-dismiss-all` (`Dismiss all previous servers`) gated on `offers.length > 1`, and `HostOverviewPage` wires `onDismissAll` to `recovery.dismissAll`

### Behavioral Correctness

- [x] A-004 R1: A per-server dismiss failure mid-loop toasts and the loop continues to the remaining servers (no new toast plumbing — `dismiss` handles its own errors)
- [x] A-005 R2: With exactly one offer, neither `Restore all` nor `Dismiss all` renders; with zero offers the section has zero footprint

### Scenario Coverage

- [x] A-006 R4: Unit tests cover the sequential loop, continue-past-failure, the button gate, and the palette gate; the e2e dismiss-all scenario passes via `just test-e2e "recovery-section"`
- [x] A-007 R4: `recovery-section.spec.md` documents the new e2e test (what it proves + steps) in the same commit

### Edge Cases & Error Handling

- [x] A-008 R1: `dismissAll` iterates `offersRef.current` (not the captured `offers` state), so the loop sees the current list without a stale closure

### Code Quality

- [x] A-009 Pattern consistency: New code mirrors the existing `restoreAll` / `recovery-restore-all` shapes verbatim (naming, gating, comment style)
- [x] A-010 No unnecessary duplication: The bulk dismiss reuses the existing `dismiss` flow and `POST /api/recovery/dismiss`; no new endpoint, client function, or toast path
- [x] A-011 No client polling: no `setInterval`+fetch introduced; data flow stays GET-on-mount + post-mutation refetch
- [x] A-012 Tests included for added behavior (unit + e2e), run through `just` recipes only

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `dismissAll` calls `dismiss` (which already removes the row and refetches per server) rather than batching state updates | Mirrors `restoreAll`→`restore` composition verbatim; intake reproduces the loop body | S:90 R:90 A:95 D:90 |
| 2 | Confident | e2e dismiss-all asserts per-server POST bodies via the existing `dismissBodies` logger and section disappearance via the region locator | The existing spec's established idioms; the intake names the scenario but not the assertion mechanics | S:70 R:90 A:85 D:80 |
| 3 | Confident | `Dismiss all` button carries no count suffix (plain `Dismiss all`, not `Dismiss all (N)`) | Intake writes `Restore all ({N})` first, then `Dismiss all` bare — reading the literal as intended; count already shown beside it | S:65 R:95 A:75 D:70 |

3 assumptions (1 certain, 2 confident, 0 tentative).

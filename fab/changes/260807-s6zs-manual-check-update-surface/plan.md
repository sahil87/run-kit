# Plan: Persist Manual Update-Check Results onto the Top-Bar Update Surface

**Change**: 260807-s6zs-manual-check-update-surface
**Intake**: `intake.md`

## Requirements

### Frontend Context: Tab-local manual-check feed

#### R1: Manual-check result state in `SessionContext`
`SessionContext` (`app/frontend/src/contexts/session-context.tsx`) MUST hold the latest manual update-check result as plain, non-persisted React state: the updatable tool set plus the echoed report `source`. It MUST expose a setter (`applyManualCheckResult(tools, source)`) on the context type, and MUST NOT write the manual result to `localStorage` or any other persistence.

- **GIVEN** a mounted `SessionProvider` with no manual check run
- **WHEN** a consumer reads the manual-check state
- **THEN** it is `null` (no manual feed held)
- **AND** `applyManualCheckResult([{tool:"run-kit",current:"3.8.7",latest:"3.9.1"}], "github")` stores that tool set and source
- **AND** no `localStorage.setItem` call is made for the manual result

#### R2: An empty updatable set clears the held manual result
`applyManualCheckResult` MUST treat an empty tool array as a clear — a fresh verdict supersedes a stale one, so a re-check that finds nothing updatable MUST NOT leave a previously-held positive manual result advertised.

- **GIVEN** a manual result holding one updatable tool
- **WHEN** `applyManualCheckResult([], "github")` is called
- **THEN** the held manual result becomes `null`
- **AND** the merged hook's manual feed no longer surfaces

#### R3: Manual state clears when the ambient composite key changes
The provider MUST clear the held manual result when the ambient SSE composite `key` (from `applyUpdateAvailable`) **changes** after the manual result was stored — the update-consumed signal, mirroring `use-update-click.ts`'s R13 completion signal. The initial ambient key observed at (or before) storage time MUST NOT itself trigger a clear.

- **GIVEN** an ambient key `"run-kit@3.9.0"` and a manual result stored while it is current
- **WHEN** the ambient feed later broadcasts a different key (including the cleared empty key ⇒ `null`)
- **THEN** the held manual result is cleared
- **AND GIVEN** a manual result stored while the ambient key is `null`
- **WHEN** no ambient event arrives
- **THEN** the manual result is retained

#### R4: Manual composite key composition mirrors the backend
A pure exported helper MUST compute the manual composite dismissal key from a tool set as **sorted `tool@latest` pairs, comma-joined** — mirroring backend `computeKey` (`app/backend/internal/updatecheck/updatecheck.go`) — so the existing `runkit-update-dismissed` localStorage dismissal machinery works unchanged against a manual-fed chip. It MUST live in `app/frontend/src/lib/palette-update.ts` (the established context-free pure-helper module for this surface) and MUST return `""` for an empty set.

- **GIVEN** tools `[{tool:"tu",latest:"0.9.2"},{tool:"run-kit",latest:"3.9.1"}]` in that order
- **WHEN** the helper composes the key
- **THEN** the result is `"run-kit@3.9.1,tu@0.9.2"` (sorted, comma-joined)
- **AND GIVEN** an empty tool set
- **THEN** the result is `""`

### Frontend Hooks: Check flow and merged derivation

#### R5: `useUpdateCheck` persists the updatable subset in addition to the toast
`runUpdateCheck` (`app/frontend/src/hooks/use-update-check.ts`) MUST, in its `.then`, push the **same updatable subset `composeCheckToast` reports** (`includePatches` ⇒ rows with `updateAvailable`; default ⇒ rows with `updateAvailable && notable`) plus the echoed `result.source` into the context seam from R1. The existing `composeCheckToast` + "Update Now" action-slot toast flow MUST remain unchanged (this is in addition to, never a replacement).

- **GIVEN** an incl.-patches check returning one `updateAvailable: true, notable: false` row
- **WHEN** `runUpdateCheck(true)` resolves
- **THEN** `applyManualCheckResult` is called with that one row and `source: "github"`
- **AND** the info toast is still shown with the composed message
- **AND GIVEN** a default check whose only row is `updateAvailable: true, notable: false`
- **WHEN** `runUpdateCheck(false)` resolves
- **THEN** `applyManualCheckResult` is called with an **empty** array (the default filter reports nothing updatable), clearing per R2

#### R6: `useUpdateNotification` becomes an ambient-first merged two-feed derivation
`useUpdateNotification` (`session-context.tsx`) MUST merge the ambient and manual feeds in exactly one place, with **ambient-first precedence**: when the ambient feed's `showChip` is true, every returned field MUST be byte-identical to today's ambient-only derivation. When the ambient feed does not show but a manual result holds tools, the hook MUST surface the manual feed — `tools` = the manual updatable set, `key` = the R4 client-computed manual key, `singleRunKit`/`latest`/`current` derived by the same rules, `qualifies` gated by the same `!isDev` guard, and `showChip` gated by the same composite-key dismissal (`manualKey !== updateDismissedKey`).

- **GIVEN** an ambient `update-available` with one notable run-kit row and no dismissal
- **WHEN** a manual result also holds a different tool set
- **THEN** the hook returns the ambient tools/key/feed (ambient wins wholesale)
- **AND GIVEN** no ambient update and a manual result holding two tools
- **THEN** `showChip` is true, `tools` is the manual pair, and `key` is the manual composite key
- **AND GIVEN** the daemon version is the `dev` sentinel
- **THEN** a manual result never lights the chip (`qualifies` false)
- **AND GIVEN** `updateDismissedKey` equals the manual composite key
- **THEN** `showChip` is false while `qualifies` stays true (palette parity unchanged)

#### R7: The hook exposes which feed is lit
The hook MUST return a feed indicator (`manualOnly: boolean`) that is true exactly when the surfaced fields come from the manual feed, so click routing (R8) and tests can branch without re-deriving the merge.

- **GIVEN** the ambient feed shows
- **THEN** `manualOnly` is false (even when a manual result is also held)
- **AND GIVEN** only the manual feed surfaces
- **THEN** `manualOnly` is true
- **AND GIVEN** neither feed surfaces
- **THEN** `manualOnly` is false

#### R8: Manual-fed clicks route to `forceUpdateNow()`
`useUpdateClick` (`app/frontend/src/hooks/use-update-click.ts`) MUST call `forceUpdateNow()` (full-roster `POST /api/update {"force":true}`) when the lit surface is manual-only, and MUST keep calling the scoped `updateNow()` when the ambient feed is the one lit. The existing R13 `updating`-clearing effect and the failure catch/toast MUST be unchanged in shape; the effect keys on the hook's effective `key`, which for a manual-fed click is the manual composite key.

- **GIVEN** the chip is lit from the manual feed only
- **WHEN** the user clicks it
- **THEN** `forceUpdateNow()` is called and `updateNow()` is not
- **AND GIVEN** the chip is lit from the ambient feed
- **WHEN** the user clicks it
- **THEN** `updateNow()` is called and `forceUpdateNow()` is not
- **AND GIVEN** either path rejects
- **THEN** `updating` clears and an `"error"` toast surfaces (unchanged)

### Frontend Dismissal

#### R9: Dismissal writes the effective displayed key
`dismissUpdate()` MUST write the **effective displayed key** — the manual composite key when the manual feed is the lit one, the ambient key otherwise — to the existing `runkit-update-dismissed` localStorage key, so the chip `✕` and the palette `run-kit: Dismiss Update Notice` entry work unchanged against a manual-fed chip. It MUST remain a no-op on an empty/absent effective key. A later manual check finding a different tool set produces a different key and re-shows the chip.

- **GIVEN** the chip is lit from the manual feed with key `"run-kit@3.9.1"`
- **WHEN** the user clicks `✕`
- **THEN** `"run-kit@3.9.1"` is written to `runkit-update-dismissed` and the chip hides
- **AND GIVEN** a later manual check yields `"run-kit@3.9.2"`
- **THEN** the chip re-shows
- **AND GIVEN** the ambient feed is lit
- **THEN** dismissal writes the ambient key exactly as today

### Non-Goals

- **No backend/Go changes** — the `handleUpdatesCheck` side-channel contract (never caching the github verdict) stays intact; no API/SSE surface growth.
- **No cross-tab or reload persistence** of the manual result — the accepted tab-local tradeoff (a reload before updating forgets it; the user re-clicks ⟳).
- **No new localStorage keys, routes, or chrome** — `runkit-update-dismissed` is reused and both persistent surfaces light purely via the hook's merged output.
- **No completion machinery for a manual-fed siblings-only sub-threshold update** — accepted residual (intake assumption #12).

### Design Decisions

#### Manual composite key helper lives in `lib/palette-update.ts`
**Decision**: The pure `computeUpdateKey(tools)` helper (sorted `tool@latest`, comma-joined) is exported from `app/frontend/src/lib/palette-update.ts` alongside `updateChipToolSummary`, and imported by `session-context.tsx`.
**Why**: `lib/palette-update.ts` is already the context-free, unit-tested pure-helper module for this exact surface, with a colocated `palette-update.test.ts`. Placing the key composition there keeps `session-context.tsx` free of a new inline algorithm and makes the sort/join semantics testable without mounting the provider.
**Rejected**: Inlining the composition inside `useUpdateNotification` — it would be untestable in isolation and would duplicate the shape if any other surface later needs it.
*Introduced by*: 260807-s6zs-manual-check-update-surface

#### The two-feed merge lives inside `useUpdateNotification` only
**Decision**: Both surfaces (in-bar `UpdateChip`, overflow-menu version row) and both palette mounts consume the merged hook output unchanged; no per-surface or per-mount branching is added.
**Why**: The constraint that AppShell and the board palette must never drift is structurally guaranteed only if the merge happens at the single shared derivation. `asUpdateSurface = tools.length > 0 && (updateOverflowed || (qualifies && !showChip))` already picks up the manual feed with zero component edits.
**Rejected**: Merging at each consumer (chip, menu row, two palette mounts) — four copies of the precedence rule, the exact drift the shared-hook architecture exists to prevent.
*Introduced by*: 260807-s6zs-manual-check-update-surface

#### Ambient-key-change clearing uses a ref-tracked baseline, not a raw key watcher
**Decision**: The provider records the ambient key observed when the manual result is stored (a ref), and clears the manual state only when a **later** ambient key differs from that baseline.
**Why**: A naive `useEffect` on `updateAvailable.key` would clear the manual result on the very first ambient event after storage even when the key never changed (or on the initial `null`→`null` render), destroying the feed immediately. Baselining at storage time mirrors `use-update-click.ts`'s `clickKeyRef` completion signal exactly.
**Rejected**: Clearing on any `updateAvailable` state write — churns the manual result away on idempotent SSE replays.
*Introduced by*: 260807-s6zs-manual-check-update-surface

## Tasks

### Phase 1: Pure helper + key composition

- [x] T001 Add the exported pure `computeUpdateKey(tools: { tool: string; latest: string }[]): string` helper to `app/frontend/src/lib/palette-update.ts` — sorted `tool@latest` pairs comma-joined, `""` for an empty set, with a docblock naming the backend `computeKey` mirror <!-- R4 -->
- [x] T002 [P] Extend `app/frontend/src/lib/palette-update.test.ts` with `computeUpdateKey` cases: single tool, multi-tool sort order (input order irrelevant), empty set ⇒ `""` <!-- R4 -->

### Phase 2: Context state (manual feed)

- [x] T003 Add the manual-check state to `app/frontend/src/contexts/session-context.tsx`: a `ManualCheckResult` type (`{ tools: UpdateTool[]; source: string }`), `manualCheck: ManualCheckResult | null` + `applyManualCheckResult(tools, source)` on `SessionContextType` (with docblocks), the `useState` + `useCallback` implementation (empty tools ⇒ clear), and wiring into the provider `value` memo, its dependency list, and `StandaloneSessionContextProvider`'s defaults <!-- R1 -->
- [x] T004 Implement the empty-set clear semantics inside `applyManualCheckResult` in `session-context.tsx` (an empty `tools` array stores `null`, superseding a stale positive) <!-- R2 -->
- [x] T005 Implement ambient-key-change clearing in `session-context.tsx`: a baseline ref stamped with the ambient key at manual-store time plus an effect that clears `manualCheck` when the current ambient key differs from that baseline <!-- R3 -->

### Phase 3: Merged derivation + click routing + dismissal

- [x] T006 Rewrite `useUpdateNotification` in `app/frontend/src/contexts/session-context.tsx` as the ambient-first merged derivation: keep today's ambient computation intact, derive the manual tool set + `computeUpdateKey` manual key, and select the manual feed only when the ambient feed does not show; return the merged `tools`/`key`/`singleRunKit`/`latest`/`current`/`qualifies`/`showChip` <!-- R6 -->
- [x] T007 Add the `manualOnly: boolean` field to `useUpdateNotification`'s return type and value (true exactly when the surfaced fields come from the manual feed) <!-- R7 -->
- [x] T008 Update `runUpdateCheck` in `app/frontend/src/hooks/use-update-check.ts` to push the `composeCheckToast`-equivalent updatable subset + echoed `result.source` into `applyManualCheckResult`, leaving the toast flow untouched <!-- R5 -->
- [x] T009 Route manual-fed clicks in `app/frontend/src/hooks/use-update-click.ts` to `forceUpdateNow()` (via the hook's `manualOnly`), keeping the ambient scoped `updateNow()` path, the R13 clearing effect, and the failure catch/toast unchanged <!-- R8 -->
- [x] T010 Make `dismissUpdate` write the effective displayed key in `session-context.tsx` — the manual composite key when the manual feed is the lit one, the ambient key otherwise, still a no-op on an empty key <!-- R9 -->

### Phase 4: Tests

- [x] T011 [P] Extend `app/frontend/src/contexts/session-context.test.tsx` (or add colocated coverage) for the manual feed: set/supersede, empty-set clear, clear on ambient key change, retention when the ambient key is unchanged, and no persistence write <!-- R1 --> <!-- R2 --> <!-- R3 -->
- [x] T012 [P] Extend `app/frontend/src/hooks/use-update-check.test.tsx`: incl.-patches persists the `updateAvailable` rows + `"github"` source; the default check persists only `notable` rows; an all-up-to-date result persists an empty array; the toast flow is unchanged <!-- R5 -->
- [x] T013 [P] Extend `app/frontend/src/components/update-chip.test.tsx`: manual-lit chip when ambient is dark, ambient wins when both feeds are present, the `!isDev` gate on the manual feed, dismissal of the manual composite key hides the chip, and a later differing manual key re-shows it <!-- R6 --> <!-- R9 -->
- [x] T014 [P] Add click-routing coverage for `use-update-click.ts` (manual-fed ⇒ `forceUpdateNow()`, ambient-fed ⇒ `updateNow()`, failure toast unchanged) <!-- R8 -->
- [x] T015 Run `just test-frontend` and fix any failures across the touched suites <!-- R1 --> <!-- R5 --> <!-- R6 --> <!-- R8 --> <!-- R9 -->

## Execution Order

- T001 blocks T006 (the hook imports `computeUpdateKey`) and T002
- T003 blocks T004, T005, T006, T008, T010
- T006 blocks T007, T009 (click routing reads `manualOnly`)
- T011–T014 follow their respective implementation tasks; T015 runs last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `SessionContext` exposes `manualCheck` state and an `applyManualCheckResult(tools, source)` setter, wired through the provider value memo and `StandaloneSessionContextProvider`, with no persistence write
- [x] A-002 R2: `applyManualCheckResult` with an empty tool array clears any previously-held manual result
- [x] A-003 R3: The manual result clears when the ambient composite key changes after storage, and is retained when it does not
- [x] A-004 R4: `computeUpdateKey` is exported from `lib/palette-update.ts` and composes sorted `tool@latest` pairs comma-joined (`""` for an empty set)
- [x] A-005 R5: `runUpdateCheck` persists the same updatable subset `composeCheckToast` reports plus the echoed `source`, with the toast flow untouched
- [x] A-006 R6: `useUpdateNotification` merges both feeds ambient-first in exactly one place; no per-surface or per-mount merge logic was added
- [x] A-007 R7: The hook returns `manualOnly`, true exactly when the surfaced fields come from the manual feed
- [x] A-008 R8: `use-update-click.ts` calls `forceUpdateNow()` on a manual-fed click and `updateNow()` on an ambient-fed click
- [x] A-009 R9: `dismissUpdate()` writes the effective displayed key to `runkit-update-dismissed` — *review caveat*: the single dismissal slot now serves two feeds, so dismissing a manual-fed chip while an ambient key is already dismissed overwrites it and re-lights the ambient chip (see review finding SF-1)

### Behavioral Correctness

- [x] A-010 R6: With no manual check run, every surface behaves byte-identically to before the change (ambient-only path untouched)
- [x] A-011 R6: When both feeds hold tools, the ambient feed wins wholesale (tools, key, click routing)
- [x] A-012 R9: A later manual check with a different tool set produces a different key and re-shows a previously-dismissed chip
- [x] A-013 R8: The R13 `updating`-clearing effect and failure catch/toast in `use-update-click.ts` are unchanged in shape

### Scenario Coverage

- [x] A-014 R1: Unit tests cover manual-state set / supersede / clear-on-empty and the absence of persistence writes
- [x] A-015 R3: A unit test covers clearing on ambient key change and retention on an unchanged key
- [x] A-016 R4: Unit tests cover key composition including multi-tool sort order and the empty set
- [x] A-017 R6: Unit tests cover chip render precedence (ambient-lit, manual-lit, ambient-wins, `!isDev`, dismissal gate)
- [x] A-018 R8: A unit test covers click routing for both feeds

### Edge Cases & Error Handling

- [x] A-019 R5: A default (non-patches) check whose rows are all sub-threshold persists an empty set, clearing rather than lighting a chip the toast contradicts
- [x] A-020 R6: The `dev` daemon sentinel suppresses a manual-fed chip exactly as it suppresses the ambient one
- [x] A-021 R6: `useUpdateNotification` still never throws outside `SessionProvider` — the manual fields degrade to the no-manual-feed defaults

### Code Quality

- [x] A-022 Pattern consistency: New code follows the surrounding naming, docblock, and `useCallback`/`useMemo` stability conventions of `session-context.tsx` and the update hooks
- [x] A-023 No unnecessary duplication: The existing `composeCheckToast` filter semantics, `updateChipToolSummary`, `use-update-check.ts`, and `use-update-click.ts` anti-drift extractions are reused rather than mirrored — *review caveat*: `updatableSubset` (`hooks/use-update-check.ts:60-62`) re-implements `composeCheckToast`'s `relevant` predicate byte-for-byte rather than sharing it (see review finding SF-2)
- [x] A-024 Type narrowing over assertions: New frontend code prefers `if` guards and discriminated unions over `as` casts
- [x] A-025 No client polling: The manual feed is event/action-driven — no `setInterval` + fetch was introduced
- [x] A-026 Test coverage: New behavior ships with colocated Vitest unit tests per `code-quality.md`
- [x] A-027 Constitution IV: No new routes, pages, chrome, or localStorage keys were added

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `ManualCheckResult.source` (`app/frontend/src/contexts/session-context.tsx:126-129`) — the echoed report source is stored and asserted in tests but has **zero production read sites**; nothing branches on `"released"` vs `"github"`. Plan R1 mandates it, so it is not a defect — but if no consumer materializes it can collapse to `tools: UpdateTool[]`.
- `updatableSubset` (`app/frontend/src/hooks/use-update-check.ts:60-62`) — redundant once `composeCheckToast`'s identical `relevant` predicate is exported from `lib/palette-update.ts` and shared (see should-fix SF-2); the local copy would then delete outright.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The manual key helper is named `computeUpdateKey` and exported from `lib/palette-update.ts` (intake left the location open — "possibly `lib/palette-update.ts`") | That module is the established context-free, unit-tested pure-helper home for this exact surface; `session-context.tsx` imports it | S:85 R:90 A:90 D:85 |
| 2 | Certain | The feed indicator is `manualOnly: boolean` (intake offered `manualOnly` or `feed: "ambient" \| "manual"`) | Intake named it first; a boolean is the minimal shape the single consumer (`use-update-click`) needs, and it defaults false outside the provider without a sentinel string | S:85 R:95 A:90 D:90 |
| 3 | Certain | The context setter is `applyManualCheckResult(tools, source)` (intake: "exact name is the implementer's choice") | Matches the provider's existing `applyVersion` / `applyUpdateAvailable` / `applyHostMetrics` naming convention for state-applying callbacks | S:90 R:95 A:95 D:90 |
| 4 | Confident | Ambient-key-change clearing baselines the ambient key at manual-store time in a ref, clearing only on a later differing key | A raw effect on `updateAvailable.key` would clear the manual result on the first ambient render after storage even with no key change; the ref baseline mirrors `use-update-click.ts`'s `clickKeyRef` R13 signal exactly | S:70 R:80 A:85 D:75 |
| 5 | Confident | The manual result is stored as `{ tools, source }` with `tools` typed as the existing `UpdateTool[]` (not a new shape) | Intake notes `UpdateCheckTool` is structurally compatible with `UpdateTool`; reusing the context's own row type avoids a second contract for the same data and keeps `updateChipToolSummary`/`computeUpdateKey` consumers unchanged | S:75 R:85 A:85 D:80 |
| 6 | Confident | The merged hook computes the manual key with `useMemo` over the manual tool set, and the manual tools fall back to the same frozen `EMPTY_TOOLS` constant | Preserves the module's stated referential-stability invariant (a fresh `[]` per render would defeat downstream memoization and churn the top bar's fit effect) | S:70 R:80 A:85 D:75 |
| 7 | Confident | Manual-feed tests extend the existing `session-context.test.tsx`, `use-update-check.test.tsx`, `update-chip.test.tsx`, and `palette-update.test.ts` suites rather than adding parallel files, with click routing covered in a new colocated `use-update-click.test.tsx` (no such file exists today) | Intake §6 names extending existing suites; `use-update-click.ts` has no colocated test, so its routing coverage needs a new file | S:75 R:85 A:85 D:80 |

7 assumptions (3 certain, 4 confident, 0 tentative).

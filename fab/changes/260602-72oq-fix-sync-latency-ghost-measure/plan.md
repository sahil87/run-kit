# Plan: Fix sync-latency test 3 false-signal fixed-sleep measurement

**Change**: 260602-72oq-fix-sync-latency-ghost-measure
**Status**: In Progress
**Intake**: `intake.md`

## Requirements

> Test-quality fix. No production source changes. The optimistic create path
> (`app.tsx` ~477-498 `useOptimisticAction`/`addGhostWindowStore`,
> `store/window-store.ts`) is already implemented and MUST NOT be touched.

### Sync-latency audit: Test 3 measures real ghost-appearance latency

#### R1: Test 3 records time-to-first-ghost-appearance, not a fixed sleep
The measured region of `sync-latency.spec.ts` test `"3. Create window via sidebar + button"`
SHALL replace the hardcoded `await page.waitForTimeout(3_000)` with a bounded poll that waits
for a NEW window row to appear in the sidebar under `SESSION_B`, and SHALL record `Date.now() - t0`
where `t0` is captured immediately before the create click. The recorded value MUST reflect the
true latency (FAST `<500ms` when the optimistic ghost lands; SLOW only if create regresses to
SSE-dependent).

- **GIVEN** the sidebar is connected and SESSION_B is expanded with its `+ New window` button visible
- **WHEN** the test counts the window rows under SESSION_B, starts `t0`, clicks the create button
  (confirming the dialog only if one appears), and polls (bounded ~8_000ms) for the window-row count
  under SESSION_B to exceed the pre-click count
- **THEN** it records `record("Create window (UI, + button)", Date.now() - t0)` reflecting the real
  appearance latency — which lands FAST (`<500ms`) because the optimistic ghost row appears immediately
- **AND** the bounded timeout only bounds the failure case; it never inflates the measured value the
  way the old fixed sleep did

#### R2: New window detected by row-count increase under SESSION_B, not by name
The assertion SHALL detect "a new window row appeared under SESSION_B" by counting window rows scoped
to SESSION_B (not the whole sidebar) and asserting the count increases, mirroring test 1's
row-count-increase pattern. It MUST NOT match a specific window name (the auto-derived name is
unpredictable).

- **GIVEN** the window name created by the sidebar `+` button is auto-derived and not predictable
- **WHEN** the test scopes window rows to SESSION_B's group (the session wrapper that `has` the
  `Navigate to ${SESSION_B}` button) and counts `[data-window-id]` descendants
- **THEN** the new-window detection is `expect.poll(() => count).toBeGreaterThan(beforeCount)`,
  name-agnostic and scoped to SESSION_B

#### R3: Existing guard and SKIP branch preserved
The existing tolerant `if (await newWinBtn.isVisible()...)` guard and its `else` SKIP-log branch
SHALL be preserved unchanged; only the measured region (the sleep) changes.

- **GIVEN** SESSION_B's `+ New window` button may not be visible (session not expanded)
- **WHEN** the button is not visible
- **THEN** the test logs `[SKIP]` and records nothing (unchanged behavior)

### Audit: confirm test 3 is the only fixed-sleep-as-measurement offender

#### R4: No other test records a hardcoded `waitForTimeout` duration as its measured latency
The audit SHALL confirm that no other test in the file records a fixed `waitForTimeout` as its measured
latency. Tests 1, 2, 4, 5, 8, 9 already poll/expect on real UI conditions. Tests 6 and 7's
`waitForTimeout(100)` are sleeps INSIDE 100ms poll loops that record the real outcome elapsed (NOT the
anti-pattern). Any genuine additional offender found SHALL be fixed; otherwise the audit result SHALL
note explicitly that test 3 was the only offender.

- **GIVEN** the full `sync-latency.spec.ts` after the test 3 fix
- **WHEN** every `waitForTimeout` is examined for whether its duration becomes the recorded latency
- **THEN** only test 3's original line-186 sleep qualified; tests 6/7's `waitForTimeout(100)` sit inside
  poll loops that record `Date.now() - t0` measuring the real outcome — confirmed NOT offenders

### Companion doc kept in sync (constitution: Test Companion Docs)

#### R5: `sync-latency.spec.md` section 3 rewritten in the same commit
Per the constitution's **Test Companion Docs** rule, `sync-latency.spec.md`'s
`### 3. Create window via sidebar + button` section SHALL be updated in the same commit: step 3c
rewritten to describe counting window rows under SESSION_B before the click and polling until the count
increases (recording that latency), and "What it proves" tightened to state the optimistic ghost window
appears in ≤500ms so the test fails if create regresses to SSE-dependent. Any other test's section is
updated only if step 2 modified that test.

- **GIVEN** `sync-latency.spec.ts` test 3's body changed
- **WHEN** the sibling `.spec.md` is updated in the same commit
- **THEN** section 3's "What it proves" and step 3c reflect the row-count-increase ghost-appearance
  measurement; no other section changes (only test 3 was modified)

### Non-Goals

- No production source changes — the optimistic create path in `app.tsx` and `store/window-store.ts`
  is already done and out of scope.
- No re-scope into backlog `sl03` optimistic-create production work.
- No changes to tests 1, 2, 4, 5, 6, 7, 8, 9 (audit confirms they are sound).
- No new dependencies, API, or backend changes.

### Design Decisions

1. **SESSION_B-scoped window-row selector**: Locate the SESSION_B session wrapper via
   `sidebar.locator("div.mb-2").filter({ has: button[aria-label='Navigate to ${SESSION_B}'] })`, then
   count `[data-window-id]` descendants within it. — *Why*: `[data-window-id]` is the canonical, stable
   window-row handle already used in `sidebar-window-sync.spec.ts:164` (real windows use the tmux `@N`
   id; ghost rows use `ghost-${optimisticId}`, both exposed on the row div). The session wrapper
   (`<div key={session.name} className="mb-2…">`, `index.tsx:1117`) has no `data-session` attribute, so
   scoping is done relationally via the `Navigate to ${SESSION_B}` button it contains — the same
   `Navigate to ` aria convention the file's `setup()` gate and test 1/2 already rely on. The selector
   MUST anchor on `div.mb-2` (the per-session wrapper class, unique to `index.tsx:1117`) and MUST NOT use
   `.first()`: a bare `.locator("div").filter({ has })` keeps every ancestor div that contains the
   button, and `.first()` returns the *outermost* one — the whole-server Sessions container
   (`index.tsx:731`) — over-counting all sessions' rows (review M1). `div.mb-2` + `.filter({ has })`
   resolves to exactly SESSION_B's wrapper. — *Rejected*: counting all sidebar `[data-window-id]` rows
   (over-counts SESSION_A's windows when expanded → cross-session flakiness — this is precisely the bug
   the unanchored `.first()` selector reintroduced); matching by window name (auto-derived, unpredictable
   — explicitly ruled out by R2).

## Tasks

### Phase 2: Core Implementation

- [x] T001 Replace the fixed `waitForTimeout(3_000)` (line ~186) in `app/frontend/tests/e2e/sync-latency.spec.ts` test 3 with a SESSION_B-scoped window-row count captured before the click and a bounded `expect.poll(...).toBeGreaterThan(beforeCount)` (~8_000ms) after click/dialog-confirm; record `Date.now() - t0`. Preserve the `if (newWinBtn.isVisible())` guard and the SKIP branch. <!-- R1 R2 R3 --> <!-- rework resolved: selector anchored on the per-session wrapper class `div.mb-2` (unique to index.tsx:1117) with `.filter({ has })` and NO `.first()`, so window-row count is scoped to exactly SESSION_B's wrapper (review M1 fixed). -->

### Phase 3: Integration & Edge Cases

- [x] T002 Audit all `waitForTimeout` calls in `app/frontend/tests/e2e/sync-latency.spec.ts`; confirm test 3 was the only fixed-sleep-as-measurement offender (tests 6/7's `waitForTimeout(100)` are poll-loop sleeps recording the real outcome). Fix any additional genuine offender found. <!-- R4 -->

### Phase 4: Polish

- [x] T003 Update `app/frontend/tests/e2e/sync-latency.spec.md` section `### 3. Create window via sidebar + button`: rewrite step 3c (count window rows under SESSION_B before click, poll until count increases, record), and tighten "What it proves" to assert the optimistic ghost appears in ≤500ms. <!-- R5 -->

## Verification

- [x] T004 Frontend type check: `cd app/frontend && npx tsc --noEmit`. <!-- R1 R2 R3 -->
- [x] T005 Run the e2e spec in isolation via `just test-e2e "sync-latency"` (port 3020, isolated `rk-test-e2e` tmux server); confirm test 3 passes and records a real latency (expect FAST `<500ms`). <!-- R1 -->

## Execution Order

- T001 blocks T003 (doc mirrors the implemented steps) and T004/T005 (verify the implementation).
- T002 is independent of T001 (read-only audit of the same file) but is recorded after T001 to reflect the final file state.

## Acceptance

### Functional Completeness

- [ ] A-001 R1: Test 3's measured region records `Date.now() - t0` after a bounded poll for a new window row under SESSION_B; the `waitForTimeout(3_000)` is gone.
- [ ] A-002 R2: New-window detection is a name-agnostic `expect.poll(count).toBeGreaterThan(beforeCount)` scoped to SESSION_B's window rows (via `[data-window-id]` under the SESSION_B wrapper).
- [ ] A-003 R3: The `if (newWinBtn.isVisible())` guard and the `else` SKIP-log branch are unchanged.
- [ ] A-004 R4: Audit confirms test 3 was the only fixed-sleep-as-measurement offender (tests 6/7's `waitForTimeout(100)` are poll-loop sleeps, not measurements); no other test changed.
- [ ] A-005 R5: `sync-latency.spec.md` section 3 updated in the same commit — step 3c describes the row-count-increase poll and "What it proves" asserts ≤500ms optimistic ghost appearance.

### Behavioral Correctness

- [ ] A-006 R1: Running the spec in isolation, test 3 passes and the summary prints `[FAST] Create window (UI, + button): <ms>` with ms `<500` (real latency, not ~3012ms).

### Scenario Coverage

- [ ] A-007 R1 R2: `just test-e2e "sync-latency"` exercises the new measurement against the live optimistic path; the recorded value is a true latency, not the old fixed sleep.

### Code Quality

- [x] A-008 Pattern consistency: New code follows the file's existing style — `expect.poll`, `Date.now()`, `record(...)`, 8_000 timeouts, `nav[aria-label='Sessions']` + `aria-label`-scoped locators.
- [x] A-009 No unnecessary duplication: Reuses the `[data-window-id]` row handle (already used in `sidebar-window-sync.spec.ts`) and test 1's row-count-increase poll pattern rather than inventing a new selector.

### Documentation

- [ ] A-010 R5: Constitution Test Companion Docs rule satisfied — `.spec.md` updated in the same commit as the `.spec.ts` change.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- No production source changes (constitution Test Integrity rule): the optimistic create path stays untouched; the test is brought into conformance with the spec, not the other way around.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Change type is `fix` (test-quality fix to a false-signal e2e test) | Carried from intake assumption #1; backlog and description lead with "fix:". | S:95 R:90 A:95 D:90 |
| 2 | Certain | No production source changes; bring the test into conformance with the already-implemented optimistic path | Constitution Test Integrity rule; intake assumption #3 verified `app.tsx:477-498` fires `onOptimistic -> addGhostWindowStore`. | S:95 R:80 A:95 D:90 |
| 3 | Confident | Detect a new window row by counting `[data-window-id]` rows under SESSION_B and polling for the count to increase (mirror test 1) rather than matching the auto-derived name | Window name is unpredictable; test 1 uses a row-count-increase poll; resolves intake assumption #5. | S:85 R:85 A:85 D:75 |
| 4 | Confident | Use a bounded ~8_000ms appearance timeout consistent with the file's other measured waits; `t0` started immediately before the click keeps the recorded number a true latency | File uses `8_000` for appearance polls; timeout bounds only the failure case (intake assumption #6). | S:85 R:88 A:85 D:80 |
| 5 | Confident | Resolved selector: scope to SESSION_B via the per-session wrapper `div.mb-2` that `has` the `Navigate to ${SESSION_B}` button (NO `.first()`), count `[data-window-id]` descendants | Resolves intake's Tentative assumption #8 against real source: `sidebar/index.tsx` renders window rows as `[data-window-id]` divs inside the SESSION_B wrapper; no `data-session` attribute exists, so relational scoping via the `Navigate to ` button (an existing convention in this file) is the cleanest stable scope. Anchoring on `div.mb-2` (unique to `index.tsx:1117`) and dropping `.first()` is required — an unanchored `.locator("div").filter({has}).first()` resolves to the outermost ancestor (whole-server Sessions container) and over-counts (review M1). `[data-window-id]` is already the canonical row handle in `sidebar-window-sync.spec.ts:164`. | S:85 R:80 A:88 D:78 |
| 6 | Confident | Keep the existing `if (newWinBtn.isVisible())` guard and SKIP branch; change only the measured region | Minimizes blast radius; intake assumption #7. | S:85 R:90 A:85 D:80 |

6 assumptions (2 certain, 4 confident, 0 tentative).

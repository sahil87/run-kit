# Plan: Sidebar Current-Session Manual-Collapse Latch

**Change**: 260823-atrb-sidebar-current-session-collapse-latch
**Intake**: `intake.md`

## Requirements

### Sidebar: Manual-collapse latch over the derived expand

#### R1: Folding the current session takes effect immediately via a latch
`toggleSession` (`app/frontend/src/components/sidebar/index.tsx:893`) SHALL set a manual-collapse latch when the toggle is a **collapse** (`next[key] = true`) and `key` equals the current session key (`${currentServer}:${currentSession}`); while the latch is active for the current session, `Sidebar` SHALL pass `currentSessionName={null}` to that server's `ServerGroup` (the pass-down at `index.tsx:1741`), suppressing the derived expand so the group folds immediately. Both chevron click and keyboard ArrowLeft ride this seam (they both call `toggleSession`). The two `ServerGroupInner` read sites and the `rowSlice` memo deps SHALL remain byte-identical.

- **GIVEN** the user is viewing a window of session S (S is current, rendered expanded)
- **WHEN** they click S's chevron (or press ArrowLeft on S's row)
- **THEN** S's window rows leave the tree immediately (`aria-expanded="false"`) AND the exception is written to `runkit-session-collapsed`

#### R2: The latch clears when the current session changes — never on window changes within it
The latch SHALL clear via a render-time ref reconcile in `Sidebar` (compare the current session key against a last-current-key ref — the `orderOverrideRef` render-time idiom at `index.tsx:1712-1725`; no watcher effect, no new state). Navigating away and back into the folded session re-reveals it (expand-on-entry applies afresh). Cycling windows WITHIN the deliberately-folded current session keeps it folded (the latch keys on the session, not the window).

- **GIVEN** the user folded their current session S via R1
- **WHEN** they navigate to a window of another session and then back into S
- **THEN** S renders expanded again (latch cleared on the session-key change; the exception stays in the map)
- **AND** switching windows within S while folded keeps S folded

#### R3: Expanding the current session clears both exception and latch
When `toggleSession` runs an **expand** (`delete next[key]`) of the latched key, it SHALL also clear the latch, keeping state coherent (two clicks return to a fully unlatched, exception-free state). The raw-map + StrictMode-safe write semantics (write outside the updater, `collapsedRef` mirror) SHALL be preserved; the latch set/clear rides alongside, also outside the updater — implemented via a `currentSessionKeyRef` mirror updated in the render reconcile so `toggleSession`'s `[]` deps stay valid.

- **GIVEN** the current session is folded via R1 (exception written, latch set)
- **WHEN** the user clicks the chevron again
- **THEN** the session expands, the map entry is deleted (storage key removed when the map empties), and the latch is cleared

#### R4: Expand-on-entry is unchanged
Navigation INTO a collapsed session (⌘↑/⌘↓ tab cycling, session jump, click, deep link) SHALL still reveal it with the deferred scroll completing — the existing tests "the exception re-applies on navigate-away" and "navigating into a collapsed session reveals it…" (`index.test.tsx:2622`, `:2643`) MUST pass unmodified.

- **GIVEN** a session with a collapsed exception that is not current
- **WHEN** navigation makes one of its windows current
- **THEN** its rows paint and the armed deferred scroll completes (o0cz behavior, kept)

#### R5: Tests cover the latch semantics
The o0cz test "current session ignores its collapsed exception: the chevron writes the map but rows stay painted" (`index.test.tsx:2600`) asserts the removed always-expanded behavior and MUST be rewritten to R1. Coverage MUST be added for: away-and-back re-reveal (R2), within-session stays folded (R2), expand clears both (R3), and ArrowLeft-on-current-session folds (R1 keyboard arm). The o0cz fixture re-anchorings (`currentSession: null` blocks, operator test) MUST be verified unaffected.

- **GIVEN** the test suite
- **WHEN** `just test-frontend` and `tsc --noEmit` run
- **THEN** all tests pass and no test asserts the removed always-expanded-while-current behavior

### Non-Goals

- No persistence of the latch (a reload counts as re-entry and re-reveals — intake assumption 7)
- No changes to `ServerGroupInner`, `SessionRow`, `WindowRow`, or any memo contract (R6a render-performance invariants untouched by construction)
- No new Playwright e2e (pure render/state logic; jsdom seam per the o0cz precedent)

### Design Decisions

#### Current-session expand is entry-driven; a manual fold while current wins until the session changes
**Decision**: Navigation into a session reveals it (derived expand), but folding the CURRENT session sets a non-persisted latch — refs in `Sidebar` reconciled at render time — that suppresses the derived expand by passing `currentSessionName={null}` down for that server; the latch clears when the current session key changes or the user re-expands.
**Why**: The pure always-expanded predicate made the collapse control inert on the current session — the user could not minimize the session they were working in, and the silently-written exception surprised them later. Transition semantics (the `present-auto-expand` precedent) preserve both halves: keyboard navigation landing in a collapsed session stays oriented, and a deliberate fold is honored immediately. Refs + render-time reconcile follow the derive-over-store convention (`orderOverrideRef`), keeping the o0cz read sites and memo tree untouched.
**Rejected**: Keeping the pure derived predicate (collapse control is a visual no-op on the current session — the reported problem); reverting to pre-o0cz no-auto-expand (reintroduces the navigation disorientation bug); clearing the latch on any window change (pops the session back open while the user cycles within it right after folding it).
*Introduced by*: 260823-atrb-sidebar-current-session-collapse-latch

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add `manualCollapseLatchRef` + `lastCurrentSessionKeyRef` + `currentSessionKeyRef` near the `collapsed` state in `Sidebar` (`app/frontend/src/components/sidebar/index.tsx` ~`:369-374`); render-time reconcile (clear latch on current-session-key change, mirror the key) placed in the component body before the `ServerGroup` map; gate the pass-down at ~`:1741`: `currentSessionName={srvInfo.name === currentServer && !latched ? currentSession : null}` <!-- R1, R2 -->
- [x] T002 Latch set/clear inside `toggleSession` (~`:893`): collapse of the current session key sets the latch (via `currentSessionKeyRef`); expand of the latched key clears it — both outside the state updater, `[]` deps unchanged <!-- R1, R3 -->

### Phase 3: Integration & Edge Cases

- [x] T003 Rewrite `index.test.tsx:2600` to latch semantics (chevron on current session folds immediately + exception written) and add coverage: away-and-back re-reveal, within-session stays folded, expand clears exception+latch, ArrowLeft on the current session folds <!-- R1, R2, R3, R5 -->
- [x] T004 Verify the o0cz-kept tests and the `currentSession: null` fixture re-anchorings; run `just test-frontend` and `cd app/frontend && npx tsc --noEmit`. Outcome: the navigate-into test (`:2643`) and all fixture re-anchorings passed unmodified; the navigate-away test (`:2622`) needed its one mid-state assertion flipped (`painted while current` → folds immediately) — that line encoded the removed always-expanded rule, not the test's subject (exception re-applies after navigate-away, which passes unchanged) <!-- R4, R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: Folding the current session (chevron or ArrowLeft) removes its window rows immediately and writes the exception; suppression flows through the `currentSessionName={null}` pass-down with `ServerGroupInner` byte-identical
- [x] A-002 R2: Latch clears only on current-session-key change (render-time ref reconcile, no effect); within-session window switches keep the fold

### Behavioral Correctness

- [x] A-003 R3: Expand-click deletes the map entry, removes the storage key when emptied, and clears the latch; StrictMode-safe write semantics preserved (write outside updater, ref mirror)
- [x] A-004 R4: Expand-on-entry unchanged — the two kept o0cz tests pass unmodified

### Scenario Coverage

- [x] A-005 R5: Rewritten + added unit tests exist and pass (`just test-frontend`); no test asserts always-expanded-while-current

### Edge Cases & Error Handling

- [x] A-006 R2: Board route / null current session (`currentSessionKey` null) — reconcile treats it as a session change (latch cleared), no override anywhere, exceptions apply normally
- [x] A-007 R1: Latch never forces a fold on its own — with no exception in the map, the session renders expanded regardless of the latch (suppression gates the override term only)

### Code Quality

- [x] A-008 Pattern consistency: refs + render-time reconcile follow the `orderOverrideRef` derive-over-store idiom; comments state constraints, no change-id citations
- [x] A-009 No unnecessary duplication: no new props through the memo tree, no new state, no watcher effects
- [x] A-010 Tests included: the changed behavior is covered by unit tests (code-quality MUST)

## Deletion Candidates

- None — this change adds new functionality (the manual-collapse latch) without making existing code redundant; it deliberately reuses the existing `currentSessionName` pass-down and the untouched `ServerGroupInner` read sites.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Latch suppression is a `!latched` term in the existing pass-down expression — `ServerGroup` receives `null` exactly as it does for non-current servers today | Agreed implementation shape; zero new prop surface | S:90 R:85 A:92 D:90 |
| 2 | Confident | `toggleSession` reads the current session key via a `currentSessionKeyRef` mirror (updated in the render reconcile) so its `[]` useCallback deps stay valid | Mechanical necessity implied by the agreed shape — props aren't visible in a `[]`-deps callback; a dep change would churn `SessionRow` memo identity | S:70 R:85 A:88 D:80 |
| 3 | Confident | ArrowLeft coverage lives in the scroll-block describe (fires keydown on the tree per the keyboard-block pattern) rather than a new describe | Test-file organization only; the scroll block owns the latch fixtures | S:60 R:90 A:85 D:75 |
| 4 | Confident | Accepted edge: while latched, the operator pinned row (rendered outside its folded home group) loses its selection highlight if it is the selected window — the latched-null `currentSessionName` also feeds its `isSelected` compare | Cosmetic, user-initiated, self-healing on unfold/navigation; avoiding it would require a second prop through the memo tree, which the agreed shape deliberately avoids | S:60 R:85 A:80 D:70 |

4 assumptions (1 certain, 3 confident, 0 tentative).

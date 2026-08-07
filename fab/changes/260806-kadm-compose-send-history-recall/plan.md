# Plan: Compose Strip Sent-History with ArrowUp Recall

**Change**: 260806-kadm-compose-send-history-recall
**Intake**: `intake.md`

## Requirements

### Compose Draft Store: Sent-History API

#### R1: Per-target sent-history push
`pushComposeSentHistory(key, text)` in `app/frontend/src/lib/compose-draft-store.ts` SHALL append a sent text to the target's newest-first history. It MUST no-op when `text.trim() === ""`, and MUST no-op when `text` is identical to the current newest entry (adjacent-duplicate collapse). The stored value MUST be the exact untrimmed `text`. History MUST be capped at `MAX_SENT_HISTORY_PER_TARGET` (10) entries per target, evicting the oldest.

- **GIVEN** an empty history for `srv:@1`
- **WHEN** `pushComposeSentHistory("srv:@1", "first")` then `pushComposeSentHistory("srv:@1", "second")` run
- **THEN** `getComposeSentHistory("srv:@1")` returns `["second", "first"]` (newest first)
- **AND** pushing `"second"` again leaves the array unchanged (adjacent-duplicate collapse)
- **AND** pushing `"   "` leaves the array unchanged (whitespace-only guard)
- **AND** after 11 distinct pushes the array holds exactly 10 entries, the oldest evicted

#### R2: Per-target sent-history read
`getComposeSentHistory(key)` SHALL return the target's newest-first sent texts as a `readonly string[]`, and MUST return a stable empty-array identity for `null` keys and keys with no history. Histories MUST be isolated per key.

- **GIVEN** history exists for `srv:@1` and none for `srv:@2`
- **WHEN** `getComposeSentHistory("srv:@2")` and `getComposeSentHistory(null)` are called
- **THEN** both return the SAME empty array identity
- **AND** `srv:@1`'s history is unaffected by pushes to `srv:@2`

#### R3: Sibling-key persistence with tolerant hydration
Sent-history SHALL persist to a localStorage key `runkit-compose-sent-history` (exported as `COMPOSE_SENT_HISTORY_STORAGE_KEY`) under schema `{[entryKey]: {entries: string[], updatedAt: number}}` — a SIBLING of `runkit-compose-drafts`, never folded into it. Writes MUST be write-through and best-effort (try/catch), removing the storage key when nothing remains. `hydrateComposeSentHistory()` SHALL re-seed from storage with a tolerant parse: malformed JSON, non-object/array roots, and wrong-typed entries degrade to empty/skipped without throwing (`entries` validated as an array of strings, `updatedAt` as a finite number).

- **GIVEN** pushes recorded for `srv:@1` and `srv:@2`
- **WHEN** `hydrateComposeSentHistory()` re-runs (simulating a page reload)
- **THEN** both targets' newest-first histories are restored verbatim
- **AND** `runkit-compose-drafts` is byte-untouched by any history write
- **GIVEN** `runkit-compose-sent-history` holds `"not json {"`, an array root, or entries with a non-string element / missing `updatedAt`
- **WHEN** `hydrateComposeSentHistory()` runs
- **THEN** it does not throw and the malformed targets read back as empty, valid siblings surviving

#### R4: Pruning discipline mirrored from drafts
History persistence SHALL reuse the draft store's pruning discipline on both write and hydrate: drop targets whose `entries` are empty, drop targets outside `MAX_DRAFT_AGE_MS` (7 days) using a two-sided `Math.abs` age check so future-dated timestamps age out, and cap to the newest `MAX_PERSISTED_SENT_HISTORIES` (30) targets by `updatedAt`.

- **GIVEN** a stored history whose `updatedAt` is older than `MAX_DRAFT_AGE_MS`, and a sibling within the window
- **WHEN** `hydrateComposeSentHistory()` runs
- **THEN** the stale target reads back empty and the fresh one is restored
- **AND** a future-dated target beyond the window also reads back empty
- **GIVEN** more than `MAX_PERSISTED_SENT_HISTORIES` targets have history
- **WHEN** a write-through persists
- **THEN** only the newest 30 targets by `updatedAt` appear in storage

### Compose Strip: Push Wiring

#### R5: All three send modes push before clearing
In `app/frontend/src/components/compose-strip.tsx` `send()`, after the `ws.readyState === WebSocket.OPEN` guard passes and immediately BEFORE `clearComposeDraft(draftKey)`, `pushComposeSentHistory(draftKey, text)` SHALL run for every mode (`submit`, `insert`, `insert-line`). The pushed value is the pre-trailing-byte `text`. A guard-blocked send (stream not OPEN) MUST push nothing. An empty/whitespace-only submit (the bare `\r`) MUST push nothing. Send payload bytes, clearing behavior, focus contract, and `classifyComposeEnter` MUST remain unchanged.

- **GIVEN** a focused target with an OPEN stream and draft text `"hello"`
- **WHEN** the user presses Enter (insert-line), Alt+Enter (insert), or Cmd/Ctrl+Enter (submit)
- **THEN** the transmitted bytes are unchanged (`"hello\n"` / `"hello"` / `"hello\r"`)
- **AND** `getComposeSentHistory(key)[0] === "hello"` after the send
- **GIVEN** an empty textarea
- **WHEN** Cmd/Ctrl+Enter sends the bare `"\r"`
- **THEN** the target's history stays empty
- **GIVEN** a CLOSED stream and draft text
- **WHEN** any send mode fires
- **THEN** nothing is transmitted, the draft is preserved, and history stays empty

### Compose Strip: ArrowUp/ArrowDown Recall

#### R6: ArrowUp recall gated on an empty textarea or an in-progress session
In the textarea's `onKeyDown`, AFTER the Escape branch and the `handleReadlineKey` call and BEFORE `classifyComposeEnter`, ArrowUp SHALL be intercepted ONLY when the textarea is empty OR a recall session is already in progress. On intercept it recalls the next-older sent text into the textarea via `setComposeText(draftKey, …)`; repeated ArrowUp walks older, pinning at the oldest entry (no wrap). A non-empty textarea outside a session MUST NOT be intercepted (native cursor movement is preserved). An intercepted ArrowUp MUST be consumed (`preventDefault` + `stopPropagation`); a non-intercepted one MUST NOT be.

- **GIVEN** a focused target with history `["c", "b", "a"]` (newest first) and an empty textarea
- **WHEN** ArrowUp is pressed
- **THEN** the textarea shows `"c"` and the keydown is consumed
- **AND** two more ArrowUps show `"b"` then `"a"`
- **AND** a fourth ArrowUp keeps `"a"` (oldest pins, no wrap)
- **GIVEN** a textarea holding `"typed"` and no session in progress
- **WHEN** ArrowUp is pressed
- **THEN** the keydown is NOT consumed and the text is unchanged
- **GIVEN** an empty textarea with NO history for the target
- **WHEN** ArrowUp is pressed
- **THEN** nothing changes (no session starts, nothing recalled)

#### R7: ArrowDown walks forward and restores the stash past newest
During a recall session, ArrowDown SHALL walk toward newer entries; stepping past the newest entry restores the stashed pre-recall text (captured at session start) and ends the session. Outside a session ArrowDown MUST NOT be intercepted.

- **GIVEN** a session walked back to `"a"` from an empty textarea
- **WHEN** ArrowDown is pressed twice
- **THEN** the textarea shows `"b"` then `"c"`
- **AND** a third ArrowDown restores the stash (`""`) and ends the session
- **AND** a fourth ArrowDown is not intercepted
- **GIVEN** no session in progress
- **WHEN** ArrowDown is pressed
- **THEN** the keydown is NOT consumed

#### R8: Session lifecycle — start, and the four exits
The recall session SHALL live in component-local refs (a recall index plus a stash of the pre-recall text). A session starts on the first intercepted ArrowUp, stashing the current text. It ends on: walking past newest via ArrowDown, any user edit (`onChange`), any send, or a target switch (`draftKey` change). Escape retains its blur-only semantics. Recall restores TEXT ONLY — attachments are never resurrected.

- **GIVEN** a session showing a recalled entry
- **WHEN** the user types (an `onChange` fires)
- **THEN** the session ends, so a subsequent ArrowUp on the now-non-empty textarea is not intercepted
- **GIVEN** a session showing a recalled entry
- **WHEN** the user sends it
- **THEN** the session ends and the next ArrowUp starts a fresh walk from the newest entry
- **GIVEN** a session in progress on target A
- **WHEN** focus switches to target B
- **THEN** the session ends and ArrowUp on B walks B's own history from its newest

### Non-Goals

- Echo-confirmation before clearing the draft — explicitly deferred by the user; delivery remains fire-and-forget.
- Backend changes — the relay and PTY write path are untouched.
- The chat send form (`ChatSendForm`) — out of scope; it has its own echo-probe verification.
- Attachment recall — `File` objects are unpersistable and revoked at send.
- Multi-tab `storage`-event sync — last-write-wins, matching drafts.

### Design Decisions

#### Sibling localStorage key over a folded draft schema
**Decision**: Sent-history persists under its own `runkit-compose-sent-history` key with its own tolerant parser and prune pipeline, rather than extending the `runkit-compose-drafts` entry shape.
**Why**: The shipped draft schema, its `isStoredDraft` guard, and `pruneDraftEntries` stay byte-compatible, so an older tab reading `runkit-compose-drafts` is unaffected and corruption in one surface cannot take the other down.
**Rejected**: Folding `entries` into the existing draft entry — it would widen `isStoredDraft`, force the draft's `text !== ""` prune to reason about history-only entries, and couple two independent lifetimes.
*Introduced by*: 260806-kadm-compose-send-history-recall

#### Recall session in refs, not React state
**Decision**: The recall index and pre-recall stash live in `useRef`s; the recalled text itself is written through `setComposeText` so the store-controlled textarea renders it.
**Why**: The textarea is already store-controlled and auto-grows off `text`; duplicating recall text in component state would fork the source of truth. The index/stash are pure control state that no render reads, so refs avoid a re-render per keystroke.
**Rejected**: `useState` for the index — it renders on every arrow press for no visual benefit and races the store write.
*Introduced by*: 260806-kadm-compose-send-history-recall

#### Empty-textarea intercept gate
**Decision**: ArrowUp is intercepted only when the textarea is empty or a session is already walking.
**Why**: A multi-line draft's ArrowUp must stay cursor movement — hijacking it would destroy in-progress composition, the strip's whole purpose.
**Rejected**: First-line gating (intercept when the caret is on line 1) — a cursor-movement trap in multi-line drafts, where line-1 ArrowUp legitimately means "stay put".
*Introduced by*: 260806-kadm-compose-send-history-recall

## Tasks

### Phase 1: Core Implementation

- [x] T001 Add the sent-history surface to `app/frontend/src/lib/compose-draft-store.ts`: `MAX_SENT_HISTORY_PER_TARGET` (10), `COMPOSE_SENT_HISTORY_STORAGE_KEY`, `MAX_PERSISTED_SENT_HISTORIES` (30), a module-level history map, `pushComposeSentHistory`, `getComposeSentHistory` (stable empty identity), and the write-through `persistSentHistory` with the shared age/cap prune, plus the module-load `hydrateComposeSentHistory()` call <!-- R1 R2 R3 R4 -->
- [x] T002 Extend `app/frontend/src/lib/compose-draft-store.test.ts` with sent-history cases: newest-first order, 10-cap eviction, whitespace no-op, adjacent-dedupe, per-target isolation, stable empty identity, persistence round-trip, tolerant parse of malformed storage, age-out (both directions) and target-cap pruning, and non-interference with `runkit-compose-drafts` <!-- R1 R2 R3 R4 -->

### Phase 2: Integration

- [x] T003 Wire `pushComposeSentHistory(draftKey, text)` into `send()` in `app/frontend/src/components/compose-strip.tsx` — after the readyState guard, immediately before `clearComposeDraft(draftKey)`, for all three modes; end any in-progress recall session on send <!-- R5 R8 -->
- [x] T004 Implement the ArrowUp/ArrowDown recall session in `app/frontend/src/components/compose-strip.tsx` `onKeyDown` (after `handleReadlineKey`, before `classifyComposeEnter`) with `recallIndexRef`/`recallStashRef`, the empty-or-in-session intercept gate, oldest-pins walk, past-newest stash restore, and session end on edit (`onChange`) and target switch (`draftKey` change) <!-- R6 R7 R8 --> <!-- rework: review cycle 1 — (must-fix) handleUpload/removeFile mutate text via setText without ending the recall session (upload mid-walk orphans the attachment: path line lost on next arrow while File/preview stay mounted) — call endRecall() in both; (must-fix) target-switch end is keydown-lazy (recallKeyRef) so an A→B→A round-trip resumes A's stale walk and B's edits wipe A's stash — end the session eagerly on draftKey change per R8; (should-fix) guard the arrow intercept on e.nativeEvent.isComposing (IME candidate navigation) and on no modifiers (Shift/Alt/Meta/Ctrl arrows must stay native), matching the neighboring keydown layers' discipline -->

### Phase 3: Verification

- [x] T005 Extend `app/frontend/src/components/compose-strip.test.tsx` with recall + push cases: ArrowUp on empty recalls newest, repeated ArrowUp pins at oldest, ArrowDown walks newer and past-newest restores the stash, ArrowUp on a non-empty textarea outside a session is not intercepted, editing/sending/target-switch end the session, all three send modes push before clearing, empty submit pushes nothing, and a guard-blocked send pushes nothing <!-- R5 R6 R7 R8 --> <!-- rework: review cycle 1 — add coverage for the four rework fixes: upload mid-walk ends the session (attachment path line survives subsequent arrows), removeFile ends the session, A→B→A target round-trip starts fresh at newest (no stale index, B edits don't wipe A's stash), isComposing arrows not intercepted, modifier'd arrows (Shift/Alt/Meta/Ctrl) not intercepted; replace/extend the existing target-switch test at compose-strip.test.tsx:1087 which misses the round-trip because it presses ArrowUp on B -->
- [x] T006 Run the scoped Vitest suites via `just test-frontend` and the `cd app/frontend && npx tsc --noEmit` type gate; fix any failures <!-- R1 R2 R3 R4 R5 R6 R7 R8 --> <!-- rework: review cycle 1 — re-run gates after the T004/T005 rework fixes -->

## Execution Order

- T001 blocks T002, T003, T004
- T003 and T004 both edit `compose-strip.tsx` — run sequentially, not `[P]`
- T005 depends on T003 + T004; T006 runs last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `pushComposeSentHistory` exists, stores untrimmed text newest-first, no-ops on whitespace-only and adjacent-duplicate pushes, and caps at `MAX_SENT_HISTORY_PER_TARGET` (10)
- [x] A-002 R2: `getComposeSentHistory` returns newest-first `readonly string[]`, a stable empty identity for null/absent keys, and isolates targets
- [x] A-003 R3: History persists under `runkit-compose-sent-history` with `{entries, updatedAt}` entries and `hydrateComposeSentHistory()` restores it; `runkit-compose-drafts` schema is unchanged
- [x] A-004 R4: Age-out (`MAX_DRAFT_AGE_MS`, two-sided) and newest-30-target cap apply on both write and hydrate
- [x] A-005 R5: All three send modes push the pre-trailing-byte text before `clearComposeDraft`
- [x] A-006 R6: ArrowUp recall is implemented with the empty-or-in-session gate and an oldest-pins walk
- [x] A-007 R7: ArrowDown walks newer and restores the stash past the newest entry
- [x] A-008 R8: The recall session lives in component refs and ends on past-newest, edit, send, and target switch

### Behavioral Correctness

- [x] A-009 R5: Transmitted bytes for submit/insert/insert-line are byte-identical to before the change; `classifyComposeEnter` and the focus contract are untouched
- [x] A-010 R6: A non-empty textarea outside a recall session keeps native ArrowUp cursor movement (the keydown is not `preventDefault`ed)
- [x] A-011 R8: Recall restores text only — no attachment is resurrected

### Scenario Coverage

- [x] A-012 R1: Store unit tests cover newest-first order, cap eviction, whitespace no-op, adjacent-dedupe, and per-target isolation
- [x] A-013 R3: Store unit tests cover the persistence round-trip and tolerant parse of malformed/wrong-typed storage
- [x] A-014 R4: Store unit tests cover stale, future-dated, and over-cap pruning
- [x] A-015 R6: Strip unit tests cover ArrowUp recall from empty, the older walk with oldest pinning, and the non-intercepted non-empty case
- [x] A-016 R7: Strip unit tests cover the ArrowDown forward walk and the past-newest stash restore
- [x] A-017 R8: Strip unit tests cover session end on edit, on send, and on target switch

### Edge Cases & Error Handling

- [x] A-018 R5: An empty/whitespace-only submit (bare `\r`) pushes nothing, and a guard-blocked send (stream not OPEN) pushes nothing while preserving the draft
- [x] A-019 R6: ArrowUp on an empty textarea with no history changes nothing and starts no session
- [x] A-020 R3: A `localStorage` throw during persist or hydrate is swallowed (best-effort) and never breaks the strip

### Code Quality

- [x] A-021 Pattern consistency: New store code mirrors the existing draft store's shape (module map, prune helper, tolerant guard, write-through persist) and the strip's keydown ordering conventions
- [x] A-022 No unnecessary duplication: `MAX_DRAFT_AGE_MS` is reused rather than redefined; no reimplementation of existing store helpers
- [x] A-023 Type narrowing over assertions: the stored-history guard uses `if` narrowing (no `as` casts on parsed storage)
- [x] A-024 No magic numbers: the history depth, storage key, and target cap are named exported constants
- [x] A-025 Tests cover added behavior: both changed files' colocated `.test.ts(x)` siblings are extended, and `just test-frontend` plus `npx tsc --noEmit` pass

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The one refactor (`pruneDraftEntries` → a thin wrapper over the new generic `pruneByAgeAndCap`, `compose-draft-store.ts:139-144`) keeps the wrapper deliberately: it is still the sole prune entry point for both the draft write-through (`persist`, :150) and `hydrateComposeDrafts` (:246), and it pins the draft-specific `isEmpty` predicate and `MAX_PERSISTED_DRAFTS` cap so neither call site restates them.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The per-target cap constant is named `MAX_PERSISTED_SENT_HISTORIES` (value 30), a sibling of `MAX_PERSISTED_DRAFTS` rather than a reuse of it | Intake specified "a `MAX_PERSISTED_DRAFTS`-style newest-N targets cap (new constant, 30)"; a distinct name lets the two surfaces diverge later without a rename, matching the sibling-key isolation posture | S:80 R:90 A:85 D:80 |
| 2 | Confident | The recall index is a "steps back from live" counter where `-1` means "no session"; `0` selects the newest entry | No public surface exposes the index, so any encoding satisfies the intake; a `-1` sentinel keeps the empty-history and past-newest cases as plain comparisons rather than nullable state | S:70 R:95 A:90 D:75 |
| 3 | Certain | Session end on a target switch is EAGER — a `useEffect` on `draftKey` calls `endRecall()` the moment the target changes. (Supersedes the original keydown-lazy `recallKeyRef` comparison, which review cycle 1 disproved.) | The lazy check only ran when an arrow was pressed, so an A→B→A round-trip with no arrow on B left A's walk armed and resumed its stale index — a walk the user had abandoned. R8 specifies the target switch itself as the exit, so the exit must fire on that event, not on the next keydown. The feared "effect fires on every focus change" cost is nil: `endRecall()` on a dead walk is two ref writes and no render | S:95 R:90 A:90 D:95 |
| 4 | Confident | `getComposeSentHistory` returns the live internal array (frozen-empty for absent keys) typed `readonly string[]` rather than a defensive copy | The intake calls it a "plain read"; every mutation path replaces the array rather than mutating in place, so callers cannot observe tearing, and copying on every keydown would allocate needlessly | S:60 R:85 A:85 D:70 |
| 5 | Confident | No Playwright spec is added — coverage is the two colocated unit-test siblings | Intake assumption 11 delegates this to apply; the store + keydown seams fully exercise the behavior, matching how the Enter matrix is tested, and skipping the spec avoids the `.spec.md` companion obligation for behavior already covered | S:70 R:90 A:80 D:75 |
| 6 | Certain | Only a BARE, non-composing ↑/↓ can be intercepted: an `isComposing` arrow or one carrying Shift/Alt/Meta/Ctrl falls through to native handling. (Added in review cycle 1 — the original intercept keyed on `e.key` alone.) | Both neighbouring keydown layers already declare this discipline (`classifyComposeEnter` and `classifyReadlineKey` guard `isComposing`; the latter treats "Meta or Shift anywhere" as unhandled). IMEs use ↑/↓ for candidate navigation — swallowing them would break the very surface the strip exists to provide, since xterm.js has no IME — and modified arrows are native editing motions (Shift=selection extension, Alt/Cmd=macOS paragraph/document jumps) | S:95 R:90 A:90 D:95 |
| 7 | Certain | `handleUpload` and `removeFile` call `endRecall()` — any programmatic text mutation that is not a recall step ends the walk, not just user keystrokes via `onChange`. (Added in review cycle 1.) | R8 names "any user edit" as an exit and both paths mutate the textarea through `setText`, so they are edits in every sense the session model cares about. Leaving the walk armed orphaned the attachment: the next arrow overwrote the text (dropping the path line) while the `File` and its preview chip stayed mounted, leaving a chip pointing at a path the agent could never resolve | S:95 R:85 A:90 D:95 |

7 assumptions (3 certain, 4 confident, 0 tentative).

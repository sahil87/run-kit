# Plan: Sort Tabs by Status/Date

**Change**: 260822-ga8z-sort-tabs-status-date
**Intake**: `intake.md`

## Requirements

### Backend: sort-windows endpoint

#### R1: Session-scoped sort endpoint
The backend SHALL expose `POST /api/sessions/{session}/sort-windows?server={server}` (Constitution IX — mutation ⇒ POST) accepting body `{"by": "status" | "created"}`. Any other `by` value, a missing/invalid JSON body, or an invalid session name MUST return 400 with zero tmux mutations (key-allowlist posture, Constitution I). The session path param validates via `validate.ValidateName` (existing-name lookup tier — pre-existing spacey names stay operable). A session not present in the server's session list MUST return 404.

- **GIVEN** a running server with session `work`
- **WHEN** `POST /api/sessions/work/sort-windows` with `{"by": "status"}`
- **THEN** the handler computes and applies the target order and returns 200 with the applied window-ID order
- **AND** `{"by": "alphabetical"}` returns 400 before any tmux call; `POST /api/sessions/nope/sort-windows` returns 404

#### R2: Deterministic order computation (pure, stable)
Order computation SHALL be a pure function over the session's enriched `tmux.WindowInfo` slice (the rollups `FetchSessions` already derives — no new derivation), using a **stable sort** so equal keys preserve current relative order and re-running the verb is idempotent (second run computes zero moves).

- **`created`**: ascending numeric sort on the `@N` window ID's numeric part (tmux assigns `@N` monotonically at creation — verified: tmux exposes no window-creation timestamp, and `#{window_id}` is documented monotonic; `@9` sorts before `@10`, i.e. numeric, not lexicographic).
- **`status`**: attention-first rank derived from the status pyramid's decision table (`docs/specs/status-pyramid.md` — cross-reference it in a code comment beside the rank table; the intake's open question resolves as this two-way cross-reference, completed by hydrate on the memory side). A window's rank is the MINIMUM (most attention-demanding) rank among its matched predicates; no match ⇒ rank 4:

| Rank | Tier | Predicates (on enriched `WindowInfo`) |
|------|------|----------------------------------------|
| 0 | attention | `AgentState == "waiting"` · `PrState == "open" && (PrChecks == "fail" \|\| PrReview == "changes_requested")` · `FabDisplayState == "failed"` |
| 1 | active work | `AgentState == "active"` · `FabChange != "" && FabDisplayState ∈ {active, ready, pending}` · `PrState == "open" && PrChecks == "pending"` |
| 2 | settled | `PrState == "merged"` · `FabChange != "" && FabDisplayState == "done"` · `PrState == "open"` (healthy: checks pass/none, review not changes_requested) |
| 3 | idle agent | `AgentState == "idle"` |
| 4 | plain | everything else (incl. `FabDisplayState == "skipped"` with no other signal — skipped falls through, per the pyramid ladder) |

Tie-break within a rank: current index order (stability).

- **GIVEN** windows `[plain@1, waiting@2, merged@3, active-agent@4]` in index order
- **WHEN** sorted by `status`
- **THEN** the target order is `[waiting@2, active-agent@4, merged@3, plain@1]`
- **AND** sorting the result again yields zero moves (idempotence)

#### R3: MoveWindow batch — only-when-changed, SSE-derived UI update
The handler SHALL apply the target order as a batch of existing `MoveWindow(windowID, dstIndex, server)` calls (reused as-is — it preserves the active window and the `@N` id per call, all targeting via `@N`/`=name:` forms). Move planning is pure and unit-testable: the set of index values is invariant under `swap-window`, so the plan walks target positions over the session's **sorted current index slots**, simulating each insert-before move, and emits a move ONLY for a window whose position actually changes — an already-sorted session yields an empty batch (no tmux mutation). On ≥1 applied move the handler SHALL wake the SSE hub (`s.initSSEHub(); s.sseHub.wake(server)` — the option-write wake pattern; `swap-window` is invisible to no one, but the wake makes the repaint immediate rather than next-tick). The response returns the applied order; the UI updates via the normal SSE derive tick (no optimistic reorder — the sidebar's derive-over-store reconcile handles a new SSE order like any manual `tmux move-window`).

- **GIVEN** a session whose windows are already in target order
- **WHEN** the sort verb runs
- **THEN** zero `MoveWindow` calls are made and the response still returns 200 with the (unchanged) order
- **GIVEN** a session with exactly one misplaced window
- **WHEN** the sort verb runs
- **THEN** exactly one `MoveWindow` call is made, targeting that window's ID and the correct destination index slot

### Frontend: client + palette

#### R4: API client helper
`app/frontend/src/api/client.ts` SHALL gain `sortSessionWindows(server, session, by)` — `fetch(withServer(...), POST, JSON body)` + `throwOnError`, following `renameSession`'s shape.

- **GIVEN** the frontend on server `runkit`
- **WHEN** `sortSessionWindows("runkit", "work", "status")` is called
- **THEN** it POSTs `/api/sessions/work/sort-windows?server=runkit` with body `{"by":"status"}` and throws on a non-OK response

#### R5: Palette actions (palette-only, current-session scope)
Two palette entries SHALL be registered in AppShell's session group (Constitution V — the palette is the discovery mechanism; palette-only like the tty export entries, no chords): `Session: Sort windows by status` (id `session-sort-windows-status`) and `Session: Sort windows by created` (id `session-sort-windows-created`), listed only when a current session exists (the terminal route's `sessionName` gate — the same gate the other `Session:` verbs use; on `/$server` no session context exists, so terminal-route-only for v1 per the intake). Composition is a pure builder `buildSessionSortActions(sessionName, onSort)` in `lib/palette-sort.ts` (the `palette-shell.ts`/`palette-zen.ts` convention) so gating is unit-testable. On select, call `sortSessionWindows`; failure surfaces an error toast; success shows no toast (the reorder is immediately visible via SSE).

- **GIVEN** the terminal route with current session `work`
- **WHEN** the palette opens
- **THEN** both sort entries are listed; selecting one POSTs the sort and the sidebar order updates via SSE
- **GIVEN** no current session (builder called with `null`)
- **THEN** the builder returns `[]` (entries omitted, not disabled)

### Tests

#### R6: Test coverage
Go: pure-function unit tests (rank table incl. every tier, stability/idempotence, `@9` vs `@10` numeric order, move-plan only-when-changed and empty-batch cases) and handler tests against `mockTmuxOps`/mock session fetcher (400 invalid `by`, 400 invalid session name, 404 unknown session, recorded `MoveWindow` calls match the plan, no-op batch). Frontend: `palette-sort.test.ts` gating unit test. Playwright e2e `sort-windows.spec.ts` + companion `sort-windows.spec.md` (constitution Test Companion Docs), real-tmux path via the `_tmux.ts` fixture (which already composes `=${session}:` targets): create windows, scramble their order, invoke the palette verb, assert the sidebar row order changes; run via `just test-e2e` only.

- **GIVEN** the e2e harness's isolated tmux server
- **WHEN** windows are created, reordered out of `@N` order, and `Session: Sort windows by created` is invoked from the palette
- **THEN** the sidebar rows return to ascending `@N` order
- **AND** marking one window's pane `@rk_agent_state = waiting:<epoch>:<live-pane-pid>` (3-segment with a live pid — a 2-segment value on a shell pane is reconciled away) and invoking `Sort windows by status` puts that window first

### Non-Goals

- Cross-session moves — windows sort within their session only.
- Standing auto-sort / watcher — one-shot verb; the plan is explicit.
- Session-header or flyout entry points — palette-only for v1 (additive follow-ups).
- Offering the verb for hidden/infra sessions (`_rk-operator`, `_rk-pin-*`) — pin-sessions are filtered by `parseSessions` (⇒ 404); `_rk-operator` is technically reachable by direct POST but never offered in the UI, and sorting its single window is a harmless no-op.

### Design Decisions

#### Attention-first total order derived from the pyramid's decision table
**Decision**: The backend rank table linearizes the status pyramid's tier-precedence model into 5 attention-first ranks (waiting/action-needed → active/in-flight → settled → idle → plain), taking the minimum matched rank per window.
**Why**: A tier-precedence dot model defines which signal *owns the dot*, not a total order; attention-first matches the feature's purpose (surface tabs needing the user). Cross-referencing `docs/specs/status-pyramid.md` from the code (and the memory file, at hydrate) keeps the two rankings of the same signals discoverable from each other.
**Rejected**: Reusing the frontend's dot decision table verbatim server-side — it answers a different question (rendering) and would couple sort semantics to presentation details like halo overlays.
*Introduced by*: 260822-ga8z-sort-tabs-status-date

#### Selection-style move plan over invariant index slots
**Decision**: Plan moves by walking target positions over the session's sorted current index values (invariant under `swap-window`), simulating each insert-before move, emitting a `MoveWindow` only for misplaced windows.
**Why**: `MoveWindow` re-resolves indexes per call, insert-before backward moves land exactly at the target slot, and the invariant slot set makes the plan pure and unit-testable; misplaced-count bounds the subprocess count.
**Rejected**: One `MoveWindow` per window unconditionally (wasteful, violates only-when-changed idempotence); a new chained multi-window tmux primitive (duplicates `MoveWindow`'s active-window-preservation logic — Constitution III posture, reuse the proven helper).
*Introduced by*: 260822-ga8z-sort-tabs-status-date

#### Sort logic lives in `api/sort_windows.go`, not `internal/tmux`
**Decision**: Rank + plan functions sit beside the handler in the `api` package.
**Why**: They consume the *enriched* `WindowInfo` (fab/PR/agent rollups) that only exists post-`FetchSessions` — `internal/tmux` never sees those fields populated; the handler is their only consumer.
**Rejected**: `internal/sessions` placement — plausible, but the functions are HTTP-verb-shaped (allowlist, 404 semantics) and the api package already hosts sibling pure helpers with handler tests.
*Introduced by*: 260822-ga8z-sort-tabs-status-date

## Tasks

### Phase 2: Core Implementation

- [x] T001 Pure order computation in `app/backend/api/sort_windows.go`: `statusRank(w tmux.WindowInfo) int` (the R2 rank table, with a comment cross-referencing `docs/specs/status-pyramid.md` § Decision Table), `windowIDNum(id string) int`, `sortWindowsTarget(windows []tmux.WindowInfo, by string) []tmux.WindowInfo` (stable sort; `created` = numeric `@N` ascending; tie-break current order), and `planSortMoves(windows []tmux.WindowInfo, target []tmux.WindowInfo) []sortMove` (sorted-index-slot simulation, only-when-changed) <!-- R2, R3 -->
- [x] T002 Unit tests in `app/backend/api/sort_windows_test.go` for T001: every rank tier, min-rank composition, stability + idempotence (re-sort ⇒ empty plan), `@9` vs `@10` numeric order, single-misplaced-window ⇒ single move, already-sorted ⇒ empty plan <!-- R2, R3, R6 -->
- [x] T003 Handler `handleSessionSortWindows` in `app/backend/api/sort_windows.go`: session param via `validate.ValidateName`, `serverFromRequest`, body allowlist (`status`/`created` else 400), `s.sessions.FetchSessions` → find session (else 404), compute target + plan, execute via `s.tmux.MoveWindow`, wake SSE hub on ≥1 move (`s.initSSEHub(); s.sseHub.wake(server)`), respond 200 with applied window-ID order + moved count; register `r.Post("/api/sessions/{session}/sort-windows", ...)` in `app/backend/api/router.go` beside the other `/api/sessions/{session}/*` routes <!-- R1, R3 -->
- [x] T004 Handler tests in `app/backend/api/sort_windows_test.go`: 400 invalid `by` / invalid JSON / invalid session name (zero tmux calls), 404 unknown session, recorded `MoveWindow` calls match plan on a scrambled fixture, zero calls on an already-sorted fixture <!-- R1, R3, R6 -->
- [x] T005 [P] `sortSessionWindows(server, session, by)` in `app/frontend/src/api/client.ts` (`withServer` + `throwOnError`, `renameSession` shape) <!-- R4 -->
- [x] T006 [P] Pure builder `buildSessionSortActions(sessionName: string | null, onSort: (by: "status" | "created") => void)` in `app/frontend/src/lib/palette-sort.ts` + gating unit test `palette-sort.test.ts` (null/empty ⇒ `[]`; ids and labels pinned) <!-- R5, R6 -->
- [x] T007 Register the two entries in `app/frontend/src/app.tsx` `sessionActions` (fold the builder output into the session group; `onSort` calls `sortSessionWindows(server, sessionName, by).catch(err => addToast(...))`, no success toast); document the new palette actions in the palette registration (code-review rule) <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T008 Playwright e2e `app/frontend/tests/e2e/sort-windows.spec.ts` + companion `sort-windows.spec.md`: via the `_tmux.ts` fixture create a session with 3 windows, scramble order with `tmux move-window`, invoke `Session: Sort windows by created` from the palette, poll sidebar row order back to `@N` ascending; then set one pane's `@rk_agent_state` to `waiting:<epoch>:<live-pane-pid>` (3-segment, pane's own `#{pane_pid}`), invoke `Sort windows by status`, assert that window's row is first. Run via `just test-e2e "sort-windows"` <!-- R6 -->
- [x] T009 Verification gates: `just test-backend` (or scoped `go test ./api/` first), `cd app/frontend && npx tsc --noEmit`, scoped Vitest for `palette-sort.test.ts`, then the T008 e2e via `just test-e2e` <!-- R6 -->

## Execution Order

- T001 → T002; T001+T003 → T004; T005/T006 parallel to backend; T007 needs T005+T006; T008 needs T003+T007; T009 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `POST /api/sessions/{session}/sort-windows` exists, POST-only, accepts `{"by":"status"|"created"}`, rejects other values 400 before any tmux call, 404s an unknown session, validates session + server names
- [x] A-002 R2: order computation is a stable sort over the R2 rank table (`status`) / numeric `@N` (`created`), pure and exported for tests, with the status-pyramid cross-reference comment in place
- [x] A-003 R3: moves execute through the existing `tmux.MoveWindow` via `TmuxOps`, only for windows whose position changes; the SSE hub is woken on ≥1 move; the response carries the applied order
- [x] A-004 R4: `sortSessionWindows` client helper exists with `withServer` + `throwOnError`
- [x] A-005 R5: both palette entries render only with a current session, ids `session-sort-windows-status`/`-created`, error toast on failure, no success toast

### Behavioral Correctness

- [x] A-006 R2: re-running either sort verb on an already-sorted session performs zero `MoveWindow` calls (idempotence proven by unit test)
- [x] A-007 R2: `created` sorts `@9` before `@10` (numeric, not lexicographic — unit-tested)
- [x] A-008 R2: a `waiting` window outranks `active`, which outranks `merged`/settled, which outranks `idle`, which outranks plain (unit-tested per tier)

### Scenario Coverage

- [x] A-009 R6: Go unit + handler tests from T002/T004 pass; the handler tests cover 400/404/only-when-changed via mocks
- [x] A-010 R6: e2e spec proves the palette → API → tmux → SSE → sidebar loop for `created`, and the waiting-first case for `status`, with the companion `.spec.md` committed in the same change

### Edge Cases & Error Handling

- [x] A-011 R1: invalid `by`, malformed JSON, and invalid session names return 400 with zero tmux mutations; a dead/unknown server surfaces the fetch error (500) rather than a silent no-op
- [x] A-012 R2: a fab-`skipped` window with no other signal ranks as plain (rank 4); a window with multiple signals takes its minimum rank

### Code Quality

- [x] A-013 Pattern consistency: handler follows the `handleWindowMove`/`handleSessionStringOption` idioms (writeError/writeJSON, serverFromRequest, hub-wake comment style); frontend follows the pure-builder palette convention
- [x] A-014 No unnecessary duplication: `MoveWindow`, `FetchSessions`, `withServer`, `throwOnError` reused — no new tmux primitives, no second rollup derivation
- [x] A-015 No inline tmux construction: all tmux interaction stays behind `internal/tmux` via `TmuxOps` (anti-pattern list)
- [x] A-016 Tests included for added behavior (principles: new features MUST include tests; UI change carries a Playwright e2e)
- [x] A-017 No polling from the client: the UI update rides the existing SSE stream; no `setInterval`/refetch added

### Security

- [x] A-018 R1: session/server names validated before subprocess use; `by` is a closed two-value allowlist; no client string ever reaches a tmux argv beyond the validated session name (Constitution I)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Exact rank predicates fixed as the R2 table — open-healthy PR ranks settled (2), fab-skipped falls through to plain, min-rank composition across signals | Intake fixed the tier shape and deferred exact values to plan stage; predicates read directly off the enriched WindowInfo vocabulary (`waiting/active/idle`, `pass/fail/pending/none`, `changes_requested`, displayState set) | S:70 R:80 A:80 D:65 |
| 2 | Confident | Move batch = selection-style plan over sorted index slots, one `MoveWindow` per misplaced window, executed sequentially | `MoveWindow`'s insert-before + per-call re-resolution make the plan correct on fresh state; index-value set is invariant under swap-window | S:65 R:85 A:85 D:75 |
| 3 | Confident | Rank/plan helpers live in `api/sort_windows.go` (not `internal/tmux`/`internal/sessions`) | They consume post-enrichment WindowInfo only the api layer sees populated; recorded as a Design Decision | S:60 R:90 A:80 D:70 |
| 4 | Confident | SSE hub wake fires on ≥1 applied move (the `/options` wake pattern) | Row-color latency precedent: mutations invisible to control-mode wait for the 12s safety tick without a wake; swap-window emits window events but the wake guarantees promptness cheaply | S:60 R:90 A:75 D:75 |
| 5 | Confident | Status e2e uses the 3-segment `waiting:<epoch>:<live-pane-pid>` pane option to create a deterministic rank-0 window | Project memory documents 2-segment values on shell panes being reconciled away; the pane's own pid is live by construction | S:55 R:85 A:80 D:70 |
| 6 | Certain | Palette-only surfacing, no chords; entries documented at the palette registration | Intake + Constitution V + code-review rule are explicit | S:90 R:90 A:95 D:90 |

6 assumptions (1 certain, 5 confident, 0 tentative).

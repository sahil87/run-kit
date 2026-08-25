# Plan: Per-Tab Status Note (@rk_note)

**Change**: 260824-bb5n-tab-status-note
**Intake**: `intake.md`

## Requirements

### Backend: `@rk_note` option — read derive

#### R1: Window note derives from the `@rk_note` window option
The sessions snapshot SHALL carry a per-window note derived from the window-scoped `@rk_note` tmux user option. `#{@rk_note}` MUST be appended as the **last** field (field 14) of the `list-windows` format in `app/backend/internal/tmux/tmux.go` (currently 13 fields, ~line 1071), and `parseWindows` MUST rejoin the tail (`strings.Join(parts[13:], "\t")`) because the note is free text in a tab-delimited format. The value schema is `<unix-epoch>:<text>` parsed via `SplitN(v, ":", 2)`; a non-numeric prefix degrades tolerantly to the whole value as text with epoch 0. `WindowInfo` gains `Note string \`json:"note,omitempty"\`` and `NoteEpoch int64 \`json:"noteEpoch,omitempty"\`` (WindowInfo is serialized directly, so the payload follows). A new const `tmux.NoteOption = "@rk_note"` names the option.

- **GIVEN** a window with `@rk_note` set to `1756036800:blocked on flaky e2e`
- **WHEN** the sessions snapshot derives
- **THEN** the window payload carries `note: "blocked on flaky e2e"` and `noteEpoch: 1756036800`

- **GIVEN** a window with `@rk_note` set to `just some text` (no epoch prefix)
- **WHEN** the snapshot derives
- **THEN** the payload carries `note: "just some text"` and no/zero `noteEpoch` (never dropped)

- **GIVEN** a window with no `@rk_note` option
- **WHEN** the snapshot derives
- **THEN** the payload omits both fields (degrade-to-absent)

### Backend: write path via the options endpoint

#### R2: `@rk_note` joins the window-options allowlist with server-stamped epoch
`POST /api/windows/{windowId}/options` (`app/backend/api/windows.go` `handleWindowOptions`) SHALL accept a 7th allowlisted key `@rk_note` (const `optKeyNote`). Clients send **bare text**; the handler MUST stamp the `<unix-epoch>:` prefix server-side before the tmux write (server owns the clock). Validation in `validateWindowOption`: trim; reject values whose trimmed text exceeds **120 chars**; reject values containing control characters (incl. tab/newline — protects the tab-delimited read format). Empty string and JSON null both unset (the `@rk_marker` mapping). The existing validate-all-then-execute, `SetWindowOptions` batch, and trailing `sseHub.wake(server)` apply unchanged — the hub wake is what makes UI writes repaint immediately while agent-side `set-option` writes ride the ~12s safety poll.

- **GIVEN** a request `{"options": {"@rk_note": "blocked on flaky e2e"}}`
- **WHEN** the handler runs at Unix time T
- **THEN** tmux receives `set-option` for `@rk_note` = `T:blocked on flaky e2e`, the response is `{"ok": true}`, and the SSE hub wakes

- **GIVEN** a request with a 200-char note or a note containing `\t`
- **WHEN** the handler validates
- **THEN** it returns 400 with zero tmux calls

- **GIVEN** `{"options": {"@rk_note": ""}}` or `{"@rk_note": null}`
- **WHEN** the handler runs
- **THEN** the option is unset

### Backend: snapshot capture

#### R3: `@rk_note` rides layout snapshots
The layout-snapshot window capture set (`app/backend/internal/tmux/layout.go` ~line 85) SHALL capture `#{@rk_note}` as a new trailing optional field (the field-12 `@rk_flair` idiom: absent on older captures) and the restore path SHALL re-set it. Free-text caveat: the capture format is also delimited, so the note field MUST be last with a tail rejoin, mirroring R1.

- **GIVEN** a server whose window carries `@rk_note`
- **WHEN** a snapshot is captured and later restored
- **THEN** the restored window carries the same `@rk_note` value (epoch preserved, so age stays honest)

### Frontend: rendering

#### R4: Note renders in the window flyout card with staleness dimming
The `Window` type (`app/frontend/src/types.ts`) SHALL gain `note?: string; noteEpoch?: number`. The window card in `row-flyout-card.tsx` SHALL render a note row when `note` is present: the note text plus a relative age derived from `noteEpoch` (reuse `lib/format.ts` `formatDuration`; omit the age when `noteEpoch` is absent/0). When the note is older than **24h** the row renders dimmed (reduced-opacity secondary text) — faded, never hidden; notes never auto-expire client-side. No note → no row, no reserved space (degrade-to-absent). The sidebar window ROW itself does NOT grow a second line (fixed row height — render-performance constraint); the flyout card covers both pointer classes (fine-pointer hover, coarse rail tap).

- **GIVEN** a window payload with `note: "blocked on flaky e2e"`, `noteEpoch` 2 hours ago
- **WHEN** the window flyout card opens
- **THEN** it shows `blocked on flaky e2e · 2h ago` undimmed

- **GIVEN** `noteEpoch` 3 days old
- **WHEN** the card opens
- **THEN** the note row renders dimmed, still legible

- **GIVEN** no `note` field
- **WHEN** the card opens
- **THEN** no note row renders

#### R5: Palette action `Window: Set note…`
A palette action `Window: Set note…` SHALL be registered (in `app/frontend/src/app.tsx` beside the existing window actions, Constitution V) for the current window on the terminal route: it opens a text prompt (reuse the existing prompt-dialog pattern) pre-filled with the current note text, and on submit calls the options endpoint via the existing `client.ts` window-options call with `{"@rk_note": text}`; an empty submit clears the note (empty string → unset per R2).

- **GIVEN** the terminal route with a current window
- **WHEN** the user runs `Window: Set note…`, types `waiting on review`, and confirms
- **THEN** the POST fires with `{"options": {"@rk_note": "waiting on review"}}` and the sidebar card reflects it on the next SSE frame

### Operator: annotate-tab template

#### R6: Window-scoped `annotate-tab` operator template
The closed `operatorTemplates` registry (`app/backend/api/operator.go`) SHALL gain a window-scoped entry `annotate-tab` with `requiresChatRef: true` and a `renderAnnotateTab` prompt (the `renderFixTabName` shape): read the subject tab's transcript tail, then write a one-line note via the exact actuation command `tmux set-option -wt <windowID> @rk_note "$(date +%s):<one-line note>"`, bounded (≤ ~100 chars, no reply, no other action; skip the write when there is nothing meaningful to say). Frontend entry points mirror Fix tab name: the window flyout card row and a palette action `Operator: Annotate tab`, both calling the existing window-scoped `operator-request` client function with template `annotate-tab`. Busy-gate 409 semantics unchanged.

- **GIVEN** a window with a chat transcript and an idle operator
- **WHEN** `POST /api/windows/{id}/operator-request` body `{"template": "annotate-tab"}` arrives
- **THEN** the operator receives the rendered prompt naming the `@rk_note` set-option command with the epoch prefix

- **GIVEN** the template sent to the server-scoped route
- **WHEN** the handler validates
- **THEN** it 400s (`operator template "annotate-tab" is window-scoped…`)

### Non-Goals

- No `brief-me` fold (adding "also write a @rk_note per tab") — cheap follow-up once the option exists
- No auto-fire (no busy→idle tracker analog to the auto-name tracker)
- No new HTTP route (the options endpoint carries the write), no settings key, no CLI verb
- No visible always-on row subtitle in the sidebar (fixed row height)
- No session-row identity-tip change (window rows carry no identity tip; the flyout card is the window detail surface)

### Design Decisions

#### Note write rides the existing options endpoint
**Decision**: `@rk_note` becomes the 7th allowlisted key on `POST /api/windows/{windowId}/options` rather than a new `/note` route.
**Why**: the endpoint already owns per-key validation, the validate-all-then-execute batch, and the SSE hub wake; Constitution IV resists new surface.
**Rejected**: a dedicated `POST /api/windows/{id}/note` — duplicate plumbing for one key.
*Introduced by*: 260824-bb5n-tab-status-note

#### Server stamps the epoch prefix
**Decision**: clients send bare text; the handler prepends `<unix-epoch>:` at write time.
**Why**: server owns the clock — no client skew; agents writing raw `set-option` stamp their own epoch with `$(date +%s)`.
**Rejected**: client-side stamping (skew, duplicated logic in palette + operator + agents).
*Introduced by*: 260824-bb5n-tab-status-note

## Tasks

### Phase 1: Backend read + write

- [x] T001 Add `NoteOption = "@rk_note"` const, append `#{@rk_note}` as field 14 of the list-windows format (~`tmux.go:1071`), parse in `parseWindows` with tail rejoin `strings.Join(parts[13:], "\t")` + tolerant `SplitN` epoch split into new `WindowInfo.Note`/`NoteEpoch` fields (`app/backend/internal/tmux/tmux.go`) <!-- R1 -->
- [x] T002 Unit tests for the parse: epoch-prefixed value, bare text (epoch 0), tab-in-value tail rejoin, colon-in-text, absent field, empty value (`app/backend/internal/tmux/tmux_test.go`) <!-- R1 -->
- [x] T003 Add `optKeyNote` to the allowlist + `validateWindowOption` case (trim, 120-char cap, control-char reject) + server-side epoch stamping before the op build in `handleWindowOptions` (`app/backend/api/windows.go`) <!-- R2 -->
- [x] T004 Handler tests: set stamps epoch, over-length 400, control-char 400, empty/null unset, unknown-key regression intact (`app/backend/api/windows_test.go`) <!-- R2 -->
- [x] T005 [P] Capture `#{@rk_note}` as trailing optional field in the snapshot window format + tail rejoin + restore set-option; extend layout tests (`app/backend/internal/tmux/layout.go`, `layout_test.go`) <!-- R3 -->

### Phase 2: Operator template

- [x] T006 Add `annotate-tab` registry entry (`requiresChatRef: true`) + `renderAnnotateTab` prompt naming the exact `tmux set-option -wt <id> @rk_note "$(date +%s):<note>"` actuation, bounded like `renderFixTabName`; scope/validation tests beside the existing template tests (`app/backend/api/operator.go`, `operator_test.go`) <!-- R6 -->

### Phase 3: Frontend

- [x] T007 Add `note?: string; noteEpoch?: number` to `Window` in `app/frontend/src/types.ts` (doc comments per the `marker`/`flair` idiom) <!-- R4 -->
- [x] T008 Note row in the window flyout card: text + relative age (`formatDuration` from `lib/format.ts`), dimmed past 24h, absent when no note (`app/frontend/src/components/sidebar/row-flyout-card.tsx`) + vitest cases (`row-flyout-card.test.tsx`) <!-- R4 -->
- [x] T009 Palette action `Window: Set note…` with prompt dialog pre-filled from the current window's `note`, submitting `{"@rk_note": text}` through the existing window-options client call; empty submit clears (`app/frontend/src/app.tsx`, `app/frontend/src/api/client.ts` if a typed helper is warranted) <!-- R5 -->
- [x] T010 Operator entry points: window flyout card row + palette action `Operator: Annotate tab` calling the window-scoped operator-request client with `annotate-tab` (mirror the Fix tab name wiring in `app.tsx`/`row-flyout-card.tsx`) <!-- R6 -->
- [x] T011 Vitest for the palette/prompt wiring (action registered, POST body shape, clear path) in the co-located app/palette test files <!-- R5 -->

### Phase 4: Verification

- [x] T012 Run the verification gates: `go test ./...` (app/backend), `npx tsc --noEmit` (app/frontend), and the scoped frontend unit suites touched above <!-- R1 -->

## Execution Order

- T001 blocks T002, T003 (shared WindowInfo fields), and T007+
- T005 and T006 are independent of each other; both need T001's const
- Frontend Phase 3 needs T007 first; T008–T011 then parallelize

## Acceptance

### Functional Completeness

- [x] A-001 R1: A window's `@rk_note` value surfaces as `note`/`noteEpoch` on the window payload; absent option → absent fields
- [x] A-002 R2: `@rk_note` is settable/clearable through the options endpoint with server-stamped epoch and hub wake
- [x] A-003 R3: Snapshots capture and restore `@rk_note`
- [x] A-004 R4: The window flyout card shows the note with relative age, dimmed past 24h
- [x] A-005 R5: `Window: Set note…` palette action exists and round-trips set/clear
- [x] A-006 R6: `annotate-tab` is a window-scoped registry template with a bounded prompt naming the epoch-prefixed set-option command

### Behavioral Correctness

- [x] A-007 R1: A note containing tabs or colons parses without truncating sibling fields (tail rejoin + SplitN-2 verified by tests)
- [x] A-008 R2: Over-length and control-char notes 400 with zero tmux calls (validate-all-then-execute preserved)

### Scenario Coverage

- [x] A-009 R1: Parse unit tests cover epoch, bare-text, tab, colon, absent, empty cases
- [x] A-010 R6: Scope test proves annotate-tab 400s on the server-scoped route

### Edge Cases & Error Handling

- [x] A-011 R4: Epoch-0 (tolerant-parse) note renders text-only, undimmed, no age
- [x] A-012 R2: Empty-string and JSON-null both unset (no `""` value ever written)

### Code Quality

- [x] A-013 Pattern consistency: new code follows the sibling idioms (optional trailing format field, `optKey*` allowlist case, `render*` template shape, `marker`/`flair` type-comment style)
- [x] A-014 No unnecessary duplication: reuses `SetWindowOptions`, the options client call, `formatDuration`, existing prompt-dialog + flyout-row patterns
- [x] A-015 All subprocess calls remain `exec.CommandContext` with timeouts; no new tmux invocation outside `internal/tmux/`
- [x] A-016 New behavior is test-covered (Go parse/handler/layout/operator tests; vitest for card + palette)

### Security

- [x] A-017 R2: Note text is validated server-side (length cap, control-char reject) before any tmux call; windowId validation unchanged

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. (One adjacent observation, not a deletion: `AnnotateTabActionRow` is the third copy of the busy/mountedRef action-row block in `row-flyout-card.tsx` alongside `ForkActionRow`/`FixTabNameActionRow` — a shared extraction is a future cleanup, not something this change made unused.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Write rides the existing `/options` endpoint (7th allowlisted key), not a new route | Endpoint already owns validation batch + hub wake; Constitution IV resists new surface — refines intake assumption 1/7 | S:70 R:80 A:90 D:75 |
| 2 | Confident | Note renders in the window flyout card only (no window identity tip exists; session-row tip untouched) | Verified in code: `identity-tip` mounts on session rows, window detail surface is `row-flyout-card.tsx`, which serves both pointer classes | S:60 R:80 A:85 D:70 |
| 3 | Confident | No dedicated e2e spec in this change; coverage is Go + vitest unit tests | The card row is a pure render branch over payload fields (unit-testable); an e2e hover spec adds flake surface for little proof — code-quality says SHOULD where possible, not MUST | S:50 R:75 A:65 D:55 |
| 4 | Confident | annotate-tab bounds the note to ≤ ~100 chars in the prompt (under the 120 API cap) | Operator writes raw set-option (no API validation path), so the prompt itself carries the bound | S:55 R:85 A:75 D:70 |

4 assumptions (0 certain, 4 confident, 0 tentative).

# Plan: Update-Annotations Operator Template & Tile Notes

**Change**: 260827-8n6k-update-annotations-tile-note
**Intake**: `intake.md`

## Requirements

### Frontend: server-page session tiles

#### R1: A noted window's tile renders the note instead of the capture preview
In `app/frontend/src/components/session-tiles/session-tiles.tsx`, when `win.note` is non-empty the tile SHALL render a compact note body (note text + relative age via `formatDuration(now - noteEpoch)`, dimmed at `opacity-50`/secondary when older than `NOTE_STALE_SECONDS`, text-only when `noteEpoch` is 0/absent) in place of the `h-40` `AnsiText` preview block (testid `window-tile-preview-{windowId}` → the note body carries testid `window-tile-note-{windowId}`). When `win.note` is empty the preview renders exactly as today. Ghost windows are unchanged. `NOTE_STALE_SECONDS` MUST be imported from `row-flyout-card.tsx` (single source), not redefined.

- **GIVEN** a window with `note: "blocked on flaky e2e"` and `noteEpoch` 2h ago
- **WHEN** its session tile renders
- **THEN** the tile body shows `blocked on flaky e2e · 2h ago` and NO preview block

- **GIVEN** a window with no `note`
- **WHEN** its tile renders
- **THEN** the preview block renders unchanged (same testid, same classes)

- **GIVEN** a note with `noteEpoch` 3 days old
- **WHEN** the tile renders
- **THEN** the note body is dimmed, still legible

### Backend: `update-annotations` template + optional session scope

#### R2: New server-scoped `update-annotations` registry entry
`app/backend/api/operator.go`'s closed `operatorTemplates` registry SHALL gain `"update-annotations": {serverScoped: true, acceptsSession: true, renderServer: renderUpdateAnnotations}`. `renderUpdateAnnotations(f serverOperatorFacts)` follows the `renderColorTabs`/`renderBriefMe` per-row idiom: one row per non-operator window (session/@N/name, worktree, agent state + duration, fab change/stage when set, transcript path or the `rk mux capture @N` fallback note), then instructs: read each tab's transcript tail (~30 JSONL lines; never capture-pane an agent tab), write/refresh via the exact actuation ``tmux set-option -wt @N @rk_note "$(date +%s):<one-line note>"`` (≤ ~100 characters), skip the write when nothing meaningful can be said (write-form only, no unset form), do not reply, take no other action, note the ~12s repaint. An empty row set still renders a trivially-answerable prompt.

- **GIVEN** a server with two agent windows and an idle operator
- **WHEN** `POST /api/operator-request?server=` `{"template":"update-annotations"}` arrives
- **THEN** the operator receives a prompt listing both rows and the `@rk_note` set-option actuation with the epoch prefix

- **GIVEN** the template sent to the window-scoped route
- **WHEN** the handler validates
- **THEN** it 400s naming the server-scoped id (existing scope guard)

- **GIVEN** client `text` on `update-annotations`
- **WHEN** the handler validates
- **THEN** it 400s (closed lane — no `acceptsText`)

#### R3: Optional `session` field on the server-scoped route body
`operatorRequestBody` SHALL gain `Session string \`json:"session"\``. A new declarative registry flag `acceptsSession bool` sits beside `acceptsText`. In `handleServerOperatorRequest`: a non-empty `session` on a template without `acceptsSession` is a 400 naming the template (before any fetch); on a declaring template the name is validated against the live session names from the same one-`FetchSessions` block — unknown → 404 `no session <name> on this server`; known → the facts are filtered to that session's windows/corpus AFTER `buildServerOperatorFacts` (consumer-side filter, the shared builder is untouched). Absent → whole-server facts as today.

- **GIVEN** `{"template":"update-annotations","session":"run-kit"}` and a live session `run-kit`
- **WHEN** the handler runs
- **THEN** the rendered prompt lists only `run-kit`'s windows

- **GIVEN** `{"template":"update-annotations","session":"nope"}`
- **WHEN** the handler runs
- **THEN** 404 naming the session, no delivery

- **GIVEN** `{"template":"brief-me","session":"run-kit"}`
- **WHEN** the handler validates
- **THEN** 400 naming `brief-me`, before any fetch

### Frontend: fire surfaces for update-annotations

#### R4: Session card row (session-scoped) and palette entry (server-wide)
`sidebar/session-row.tsx`'s coarse-only session card SHALL gain a `CardActionRow` labelled `Update annotations` (hint `asks the operator`, testid `row-flyout-annotate-session-action`) rendered only when the server has an operator window (thread a `hasOperator`/`onUpdateAnnotations` prop the way `onSpawnAgent` is threaded), firing `sendServerOperatorRequest(server, "update-annotations", "", name)` and toasting the outcome. `app.tsx`'s `operatorComposeActions` group SHALL gain `Operator: Update annotations` (server-wide, no session), gated by `hasOperatorWindow` omit-not-disable like `Operator: Brief me`. `client.ts` `sendServerOperatorRequest` gains an optional trailing `session?: string`, included in the body only when non-empty.

- **GIVEN** a server with an operator window
- **WHEN** the session card's `Update annotations` row is tapped
- **THEN** one POST fires with `{"template":"update-annotations","text":"","session":"<that session>"}` and a success toast shows

- **GIVEN** no operator window
- **WHEN** the session card / palette render
- **THEN** neither entry is present (omitted, not disabled)

### Frontend: window flyout card pruning

#### R5: Remove the `Annotate tab` action row (palette entry stays)
`row-flyout-card.tsx` SHALL drop `AnnotateTabActionRow`, `NoteIcon` (if otherwise unused), the `onAnnotateTab` prop and `annotateHandler` gate; `window-row.tsx`, `sidebar/index.tsx`, and the `onAnnotateTab={handleAnnotateTab}` Sidebar prop in `app.tsx` lose the plumbing. `Operator: Annotate tab` (palette) + `handleAnnotateTab` + the backend `annotate-tab` template + `NoteLine` display are unchanged.

- **GIVEN** a window with an operator present
- **WHEN** its flyout card opens
- **THEN** no `row-flyout-annotate-action` row renders, the note display line still does, and `⌘K` still lists `Operator: Annotate tab`

### Removal: `retire-tab`

#### R6: Retire the `retire-tab` template end-to-end
Delete: the `"retire-tab"` registry entry and `renderRetireTab` (+ their tests) in `operator.go`/`operator_test.go`; `app/frontend/src/components/retire-confirm-dialog.tsx` + `.test.tsx`; `RetireActionRow`/`RetireIcon`, the `onRetireTab` prop and `retireHandler` in `row-flyout-card.tsx`; the `onRetireTab`/`handleRetireTab` plumbing in `window-row.tsx` and `sidebar/index.tsx`; in `app.tsx` the lazy `RetireConfirmDialog` import, `retireTarget` state, `handleRetireTab`, the `Tab: Retire (ask operator)` palette action, the `onRetireTab` Sidebar prop, and the dialog mount; any retire tests in `row-flyout-card.test.tsx`/`app.test.tsx`. KEEP `Kill window…`, `canRequestWindowOperatorAction`, and every other template.

- **GIVEN** `POST /api/windows/@1/operator-request` `{"template":"retire-tab"}`
- **WHEN** the handler validates
- **THEN** 400 `unknown operator template "retire-tab"`

- **GIVEN** the frontend build
- **WHEN** `tsc --noEmit` runs
- **THEN** no reference to `retire-tab`, `RetireConfirmDialog`, `onRetireTab`, or `retireTarget` remains in `app/frontend/src`

### Non-Goals

- No `brief-me` rename or changes; no busy→idle auto-fire; no find-by-note; no board subtitles; backlog `[8fjh]` untouched
- No replacement close-out mechanism for retired tabs
- No change to the `@rk_note` schema, payload, or `NoteLine`

### Design Decisions

#### Dedicated `update-annotations` template instead of a brief-me fold
**Decision**: a new server-scoped template writes/refreshes notes; `brief-me` stays a read-only digest.
**Why**: folding would change brief-me's contract and be un-scopeable; a dedicated template gets its own palette entry and a session scope.
**Rejected**: appending "also write a @rk_note per tab" to `renderBriefMe`.
*Introduced by*: 260827-8n6k-update-annotations-tile-note

#### Session scope as a declarative registry flag with consumer-side filtering
**Decision**: `acceptsSession` beside `acceptsText`; the handler filters `buildServerOperatorFacts` output to the named session rather than parameterising the builder.
**Why**: mirrors the closed-lane posture of `acceptsText` (undeclared → 400) and the "ordering lives in the consumer" precedent; the shared builder keeps one shape for all templates.
**Rejected**: a `session` parameter on `buildServerOperatorFacts` (touches every caller for one consumer).
*Introduced by*: 260827-8n6k-update-annotations-tile-note

#### Retire `retire-tab` rather than re-home its close-out
**Decision**: remove the template and all its surfaces; add no replacement sink.
**Why**: its only advantage over plain kill was a close-out note written to `fab/backlog.md`, which nothing reads; unread destructive surface is net-negative (Constitution IV).
**Rejected**: writing the close-out to the fab change folder or a PR comment — speculative until something consumes it.
*Introduced by*: 260827-8n6k-update-annotations-tile-note

## Tasks

### Phase 1: Backend

- [x] T001 Add `acceptsSession bool` to `operatorTemplate`, `Session string` to `operatorRequestBody`, and the `"update-annotations"` registry entry + `renderUpdateAnnotations` (color-tabs/brief-me row idiom, epoch-prefixed `@rk_note` actuation, ~100-char bound, skip clause, no-reply bound) in `app/backend/api/operator.go` <!-- R2 -->
- [x] T002 In `handleServerOperatorRequest` (`operator.go` ~816): 400 on non-empty `session` for templates without `acceptsSession` (pre-fetch); after the one FetchSessions, validate the name against live sessions (404 `no session <name> on this server`) and filter `facts.Windows`/`facts.Corpus` to it before render <!-- R3 -->
- [x] T003 Delete the `"retire-tab"` registry entry and `renderRetireTab` from `operator.go`; delete `TestRenderRetireTab` and every retire-tab scope/guard test from `operator_test.go` <!-- R6 -->
- [x] T004 Tests in `operator_test.go`: `TestRenderUpdateAnnotations` (rows, actuation string, bounds, skip clause, operator row excluded), scope guards (window-route 400, text 400), session lane (filtered rows, unknown 404, undeclared-template 400 pre-fetch, absent = all), and `retire-tab` now → unknown-template 400 <!-- R2 -->

### Phase 2: Frontend — tiles and client

- [x] T005 [P] Session tile note body in `session-tiles/session-tiles.tsx` (~207–231): render note + age (import `NOTE_STALE_SECONDS` from `row-flyout-card.tsx`, `formatDuration` from `lib/format.ts`) instead of the preview when `win.note`; testid `window-tile-note-{windowId}`; vitest cases in `session-tiles.test.tsx` (note replaces preview, no-note preview unchanged, stale dimmed, epoch-0 no age) <!-- R1 -->
- [x] T006 [P] `sendServerOperatorRequest(server, template, text, session?)` in `app/frontend/src/api/client.ts` — body includes `session` only when non-empty; existing callers untouched <!-- R4 -->

### Phase 3: Frontend — sidebar cards, palette, removals

- [x] T007 Session card `Update annotations` row in `sidebar/session-row.tsx` (~197, between `Spawn agent…` and `New tab`), gated on a new optional `onUpdateAnnotations?: (server, session) => void` prop threaded like `onSpawnAgent` through `sidebar/index.tsx` → `ServerGroup` → `SessionRow`; wired in `app.tsx` to `sendServerOperatorRequest(..., "update-annotations", "", session)` + toast; passed only when `hasOperatorWindow` <!-- R4 -->
- [x] T008 Palette action `Operator: Update annotations` in `app.tsx` `operatorComposeActions` (~3773, beside `Operator: Brief me`), `hasOperatorWindow` omit-not-disable, server-wide call + toast <!-- R4 -->
- [x] T009 Remove `AnnotateTabActionRow`/`NoteIcon`/`onAnnotateTab`/`annotateHandler` from `row-flyout-card.tsx` and the `onAnnotateTab` plumbing in `window-row.tsx`, `sidebar/index.tsx`, and `app.tsx` (Sidebar prop only — keep `handleAnnotateTab` + the palette entry) <!-- R5 -->
- [x] T010 Remove retire-tab frontend: delete `retire-confirm-dialog.tsx` + `.test.tsx`; drop `RetireActionRow`/`RetireIcon`/`onRetireTab`/`retireHandler` (`row-flyout-card.tsx`), `onRetireTab`/`handleRetireTab` (`window-row.tsx`, `sidebar/index.tsx`), and in `app.tsx` the lazy import (~183), `retireTarget` state (~1220), `handleRetireTab` (~2338), palette action `window-retire-operator` (~2761–2770 + deps ~2812), Sidebar prop (~4316), dialog mount (~4627–4635); fix the doc comment at `row-flyout-card.tsx:421` and the row-order comment ~935 <!-- R6 -->
- [x] T011 Update tests: `row-flyout-card.test.tsx` (remove retire/annotate-row cases, assert `NoteLine` still renders), `app.test.tsx` (remove retire palette tests, keep the Annotate-tab palette gate tests, add an `Operator: Update annotations` gate test), `session-row.test.tsx` (Update annotations row present/absent by operator) <!-- R5 -->

### Phase 4: Verification

- [x] T012 Gates: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit`; touched vitest suites; `grep -rn "retire-tab\|RetireConfirm\|onRetireTab\|retireTarget\|onAnnotateTab" app/frontend/src app/backend/api` returns only the intended keepers (none for retire; none for `onAnnotateTab`) <!-- R6 -->

## Execution Order

- T001 blocks T002 and T004; T003 is independent of T001/T002 but shares `operator.go` — run sequentially
- T006 blocks T007/T008; T005 is independent
- T009 and T010 touch the same four files — run T009 then T010, then T011

## Acceptance

### Functional Completeness

- [x] A-001 R1: Noted windows show the note body (text + age) on the server page; un-noted windows show the preview exactly as before
- [x] A-002 R2: `update-annotations` is a server-scoped registry template rendering per-row facts and the epoch-prefixed `@rk_note` actuation
- [x] A-003 R3: `session` scopes the facts on declaring templates, 404s on unknown names, 400s on non-declaring templates before any fetch
- [x] A-004 R4: Session card row (session-scoped, operator-gated) and palette entry (server-wide) both fire and toast
- [x] A-005 R5: The window flyout has no Annotate-tab row; `Operator: Annotate tab` remains in the palette; `NoteLine` still renders
- [x] A-006 R6: No `retire-tab` code, dialog, row, palette action, or test remains; `Kill window…` unchanged

### Behavioral Correctness

- [x] A-007 R1: Stale (>24h) tile notes render dimmed via the shared `NOTE_STALE_SECONDS` (no second constant)
- [x] A-008 R3: Session filtering happens after `buildServerOperatorFacts`; the builder's signature is unchanged
- [x] A-009 R6: `POST .../operator-request {"template":"retire-tab"}` → 400 unknown template

### Scenario Coverage

- [x] A-010 R2: Render test asserts rows, actuation string, ~100-char bound, skip clause, no-reply bound, operator row excluded
- [x] A-011 R3: Tests cover filtered / unknown / undeclared / absent session cases
- [x] A-012 R1: Vitest covers note-replaces-preview, no-note-unchanged, stale, epoch-0

### Edge Cases & Error Handling

- [x] A-013 R3: An empty filtered row set still delivers a trivially-answerable prompt (no 409/400)
- [x] A-014 R4: Without an operator window neither fire surface renders (omitted, not disabled)

### Code Quality

- [x] A-015 Pattern consistency: registry flag mirrors `acceptsText`; render mirrors `renderColorTabs`; card row uses `CardActionRow`; palette gating mirrors `Operator: Brief me`
- [x] A-016 No unnecessary duplication: `NOTE_STALE_SECONDS`/`formatDuration`/`sendServerOperatorRequest`/`CardActionRow` reused; no new tmux invocation outside `internal/tmux/`
- [x] A-017 Removal leaves no dead code: `RetireIcon`, `NoteIcon` (if unused), `canRequestWindowOperatorAction` still has a live consumer (fix-tab-name)
- [x] A-018 New/changed behavior is test-covered (Go + vitest); companion `.spec.md` updated if any `.spec.ts` changes

### Security

- [x] A-019 R3: `session` is validated against live session names before use; undeclared-template rejection happens before any fetch or tmux call

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — the change's planned removals (retire-tab end-to-end; the flyout Annotate-tab row and its prop chain) were executed in full: `RetireIcon`/`NoteIcon`/`AnnotateTabActionRow`/`RetireActionRow`/`retire-confirm-dialog.tsx` all went with their consumers, and no remaining symbol, file, or branch was made redundant without being removed.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Tile note body is compact (no fixed `h-40` box); tile height may shrink vs preview | Intake row 14 leaned this way; a curated line doesn't need a 10-line box; one-file styling, trivially reversible | S:55 R:90 A:60 D:55 |
| 2 | Confident | Session-scope flag is named `acceptsSession` and rejects undeclared use with the same wording shape as the `acceptsText` closed-lane 400 | Direct mirror of the existing declarative flag | S:65 R:85 A:85 D:80 |
| 3 | Confident | The session card `Update annotations` row sits between `Spawn agent…` and `New tab` (operator verbs before create/destroy) | Mirrors the window card's fix-tab-name placement before pin/kill | S:50 R:90 A:75 D:70 |
| 4 | Confident | No e2e spec changes: tile note is a payload-driven render branch covered by vitest; existing `session-tiles.spec.ts` asserts preview behavior only for un-noted windows so stays green | Keeps the change's test surface unit-level; companion `.spec.md` rule therefore not triggered | S:55 R:80 A:70 D:65 |
| 5 | Confident | A new `NotePencilIcon` in `sidebar/icons.tsx` (ComposeIcon silhouette family) icons the session card's Update annotations row; the flyout card's `NoteIcon` was removed as unused (the card has no other note glyph consumer) | No suitable existing shared icon; matching the sibling stroke-SVG idiom keeps the card rows visually coherent | S:50 R:85 A:75 D:60 |
| 6 | Confident | The pre-existing literal NUL byte in `session-tiles.tsx` (`expandedNames.join("<NUL>")`) was normalized to the escaped form `join("\0")` — same runtime string, UTF-8-clean source so standard tooling can read the file | The change edits this file anyway; leaving a binary NUL would have kept it unreadable to text tools | S:60 R:90 A:80 D:70 |

6 assumptions (0 certain, 6 confident, 0 tentative).

# Plan: Chat Lens Residual Code Trim (Sweep Change A1)

**Change**: 260904-0mrk-chat-lens-residual-code-trim
**Intake**: `intake.md`

> Executes Change A1 of `fab/plans/sahil/26-09-04-chat-lens-residual-sweep.md`. Delete/comment-only — **no renames** (renames are Change A2). Plan line numbers were taken at `a8c24104`; re-verify each location against HEAD before editing. The intake's Deliberately-KEPT and False-positives lists are hard exclusions.

## Requirements

### Layoutspec: drop the removed `chat` surface kind

#### R1: `internal/layoutspec` rejects `chat` as a surface kind
`surfaceKinds` in `app/backend/internal/layoutspec/layoutspec.go` (L42 at `a8c24104`: `"chat": true`) MUST no longer contain `chat`, aligning the Go validator with the frontend `ViewName` union `"tty" | "web" | "code"` (`window-view.ts:24`). `rk tab layout set/--add/--promote` MUST reject `chat` as an unknown surface instead of accepting a layout the frontend parse-rejects and heals to `single:tty`. The surface-list comment at `app/backend/internal/tabaddr/tabaddr.go:24` MUST drop `"chat"` from its enumeration.

- **GIVEN** a stored layout string containing surface `chat`
- **WHEN** `layoutspec` parses it
- **THEN** parsing fails as unknown-surface, and every Go caller heals the failure to `Default()` (`tab_web.go:213`, `tab_layout.go:120`)
- **AND** `rk tab layout --add chat` / `--promote chat` fail with the unknown-surface error

#### R2: layoutspec/tab tests track the shrunken surface set
Test fixtures that used `chat` as a *valid* surface MUST move to surviving surfaces or become invalid-input cases, preserving each test's intent: `layoutspec_test.go` valid fixtures (L15, L18, L96, L125, L175, L268 at `a8c24104`); `cmd/rk/tab_test.go:262/291` (assertions change from full/absent-reason failures to unknown-surface failures); `cmd/rk/tab_test.go:384` (valid stored layout `main-left:tty,code,chat` → `main-left:tty,code,web`).

- **GIVEN** the trimmed `surfaceKinds`
- **WHEN** `go test ./...` runs in `app/backend`
- **THEN** all layoutspec and tab tests pass, with no test asserting `chat` is a valid surface

### internal/chat: delete the dead parser/backfill/tail machinery

#### R3: `internal/chat` shrinks to its live surface
The package MUST retain exactly its consumed surface — `TranscriptPath(provider, ref)`, error sentinels `ErrInvalidRef` / `ErrTranscriptNotFound` / `ErrNoAdapter`, the provider registry (`Register`/`Lookup` or their post-trim equivalent) with the `TranscriptLocator` capability, and the Claude adapter's UUID guard (`uuidRe`) + transcript glob — and MUST delete the zero-consumer machinery: all of `schema.go` (`Event`, `Pending`, `Role`, constants), `Adapter.Backfill`/`Adapter.TailFrom`, `Conversation`, `Update`, and the whole JSONL parser (`parser`, `consume`, `parseLine`, `decodeContent`, `appendBlockEvent`, `pending`, `closeToolUse`, `tailFromLoop`, `primeTo`, `readFromOffset`, `deriveQuestion`, `flattenToolResult`, and helpers only they use). Consumer-freedom MUST be verified per deleted exported symbol via repo-wide grep before deletion. `testdata/claude_session.jsonl` MUST be kept (consumed by `api/chat_fixture_test.go`). No symbol, file, or package is renamed.

- **GIVEN** the trimmed package
- **WHEN** `go build ./...` and `go test ./...` run
- **THEN** the four consumers (operator actuation, fork, closed-resume, auto-name) compile and pass, `api/chat_fixture_test.go` still passes, and no production reference to a deleted symbol exists

#### R4: dead test halves are deleted with their subjects
`schema_test.go` MUST be deleted with `schema.go`; `claude_test.go` MUST lose the tests covering deleted code (parser, backfill, tail, turn counter, pending) while keeping tests for the surviving surface (UUID guard, transcript location, `TranscriptPath`).

- **GIVEN** the trimmed tests
- **WHEN** `go test ./internal/chat/...` runs
- **THEN** surviving tests pass and no test references a deleted symbol

### Frontend: dead dependencies and stale comments

#### R5: `react-markdown` and `remark-gfm` are removed
Both packages MUST be removed from `app/frontend/package.json` (and the lockfile) via `pnpm remove react-markdown remark-gfm`, after a grep confirms zero imports under `src/` (confirmed at HEAD: zero).

- **GIVEN** the dependency removal
- **WHEN** `npx tsc --noEmit` and `just build` run
- **THEN** both succeed with neither package in `package.json` or `pnpm-lock.yaml`

#### R6: stale comments no longer point at deleted code
Each comment site below MUST be updated to reference only surviving code, editing the stale reference in place without adding narration (per `fab/project/code-quality.md` Anti-Patterns). Line numbers as of `a8c24104` — re-verify:

| Location | Stale reference | Direction |
|---|---|---|
| `internal/inject/inject.go:2, ~24, ~176` | "chat-send HTTP handler (api/chat.go)" | now `api/send.go` |
| `api/fork.go:28` | "the chat endpoints (api/chat.go), whose contract this mirrors" | the surviving send/operator contract |
| `internal/chat/adapter.go:11–45` | doc header describes removed backfill endpoint + `kind:"chat"` subscription | rewrite surviving header around transcript location (mostly deleted by R3) |
| `internal/chat/claude.go:105` | "state-socket chat subscription can compose GET(offset)→TailFrom" | deleted with R3 or rewritten |
| `compose-strip.tsx:166, 664` | "mirrors ChatSendForm" / "the SAME helper ChatSendForm uses" | ChatSendForm is gone |
| `readline-keys.ts:3` | "shared with … the chat send form" | compose strip is sole consumer |
| `use-coarse-pointer.ts:5` | names "the chat send" as consumer | drop dead consumer |
| `right-panel.ts:27` | "`tty` … and `chat` are surfaces like any other" | drop `chat` |
| `app.tsx:1408, 2015, 2020` | "(web iframe or chat)" | say web/code |
| `tip.tsx:94` | "the compose/chat Enter" | drop the chat half |
| `types.ts:181` | "the SOLE gate for every chat affordance" | affordances are fork/operator actions |

- **GIVEN** the comment edits
- **WHEN** a reader greps the repo for `api/chat.go` or `ChatSendForm`
- **THEN** no source comment references them (excluding the KEPT items, `fab/`, and `docs/`)

### Non-Goals

- Renames of any kind (`internal/chat` → `internal/transcript`, chat-send → agent-send, `ComposeSurface: "chat"` → `"broadcast"`) — Change A2, after A1 merges.
- The docs lens-taxonomy sweep (`docs/specs/window-views.md` etc.) — Change B, parallel worktree.
- The Deliberately-KEPT items: `@rk_pane_chat` cluster (`ChatProvider`/`ChatSessionRef`, `ResolveChatPane`/`rollupChat`, agent-hook chat stamp — cross-repo contract), `testdata/claude_session.jsonl`, and the regression pins (`router-url.test.ts:48`, `surface-layout.test.ts` heal tests, `use-shell-notifications.test.tsx:66`, `window-heading.spec.ts`).
- False positives: `chatter`/`outputSink.chatter`, `chat.disableAIFeatures` (code-server key), `"chatty"` fixture.

### Design Decisions

#### Trim before rename
**Decision**: Ship the delete-only trim (A1) as its own change before the renames (A2).
**Why**: Each PR stays reviewable against one question — here "is everything deleted consumer-free, and does every stored-layout path still heal?"; A2's renames then operate on the already-shrunken surface.
**Rejected**: One combined trim+rename change — same files, two review questions, larger diff.
*Introduced by*: 260904-0mrk-chat-lens-residual-code-trim

#### `tab_test.go:384` fixture swaps `chat` for `web`
**Decision**: Replace `main-left:tty,code,chat` with `main-left:tty,code,web` rather than converting the case to a heal expectation.
**Why**: The test's intent is a *valid* 3-surface stored layout; `web` is a surviving kind, preserving intent with minimal churn.
**Rejected**: Heal expectation — changes what the test proves; invalid-layout healing is already covered elsewhere.
*Introduced by*: 260904-0mrk-chat-lens-residual-code-trim

### Deprecated Requirements

#### `layoutspec` accepts the `chat` surface kind
**Reason**: The chat lens was removed in `260904-39bp-remove-chat-lens` (PR #817); the Go validator accepting `chat` produced stored layouts the frontend parse-rejects and heals to `single:tty`.
**Migration**: N/A — `chat` becomes an unknown surface; existing stored layouts containing it heal to `Default()` exactly as any invalid layout does.

#### `internal/chat` event schema, backfill, and offset tail
**Reason**: Sole consumers (`GET /api/windows/{id}/chat` backfill + state-socket `kind:"chat"` subscription) were removed in PR #817; zero production references remain.
**Migration**: N/A — `TranscriptPath` + error sentinels + registry survive for operator actuation, fork, closed-resume, and auto-name.

## Tasks

### Phase 1: Setup

- [x] T001 Re-verify every plan location against HEAD (grep the anchors: `surfaceKinds` in `layoutspec.go`, chat fixtures in `layoutspec_test.go` and `cmd/rk/tab_test.go`, the deleted-symbol list in `internal/chat/*.go`, each R6 comment site) and grep-verify consumer-freedom of every `internal/chat` symbol slated for deletion (repo-wide, excluding `internal/chat` itself, `fab/`, `docs/`) <!-- R3 -->

### Phase 2: Core Implementation

- [x] T002 [P] Remove `"chat": true` from `surfaceKinds` in `app/backend/internal/layoutspec/layoutspec.go`; drop `"chat"` from the surface-list comment in `app/backend/internal/tabaddr/tabaddr.go:24` <!-- R1 -->
- [x] T003 Update `app/backend/internal/layoutspec/layoutspec_test.go` chat-bearing valid fixtures (≈L15, L18, L96, L125, L175, L268) to surviving surfaces or invalid-input cases per fixture intent <!-- R2 -->
- [x] T004 Update `app/backend/cmd/rk/tab_test.go`: ≈L262/L291 assert the unknown-surface error for `--add chat`/`--promote chat`; ≈L384 fixture `main-left:tty,code,chat` → `main-left:tty,code,web` <!-- R2 -->
- [x] T005 [P] Delete `app/backend/internal/chat/schema.go` and `schema_test.go`; shrink `adapter.go` to the provider registry + `TranscriptLocator` + `TranscriptPath` + sentinels (rewriting its L11–45 doc header around transcript location); shrink `claude.go` to the UUID guard + transcript glob + `TranscriptPath` (dropping the L105 stale comment); trim `claude_test.go` to the surviving surface; keep `testdata/claude_session.jsonl` <!-- R3 -->
- [x] T006 [P] Run `pnpm remove react-markdown remark-gfm` in `app/frontend/` <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T007 [P] Fix stale Go comments outside `internal/chat`: `app/backend/internal/inject/inject.go` (≈L2, L24, L176 — `api/chat.go` → `api/send.go`), `app/backend/api/fork.go:28` <!-- R6 -->
- [x] T008 [P] Fix stale frontend comments: `compose-strip.tsx` (≈L166, L664), `readline-keys.ts:3`, `use-coarse-pointer.ts:5`, `right-panel.ts:27`, `app.tsx` (≈L1408, L2015, L2020), `tip.tsx:94`, `types.ts:181` <!-- R6 -->

### Phase 4: Polish

- [x] T009 Run the verification gates in order: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit`; `just test`; `just build` — the e2e suite must pass unmodified <!-- R2 -->

## Execution Order

- T001 (verification) precedes all edits; T002 → T003/T004 (validator change drives test updates); T005–T008 are independent of the layoutspec cluster; T009 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `surfaceKinds` no longer contains `chat`; `tabaddr.go` comment enumerates only surviving surfaces
- [x] A-002 R3: `internal/chat` exposes only the live surface (TranscriptPath, sentinels, registry + TranscriptLocator, UUID guard + glob); `schema.go` is gone
- [x] A-003 R5: `react-markdown` and `remark-gfm` absent from `package.json` and `pnpm-lock.yaml`
- [x] A-004 R6: every comment site in the R6 table references only surviving code

### Behavioral Correctness

- [x] A-005 R1: `rk tab layout --add chat` / `--promote chat` fail as unknown-surface; stored layouts containing `chat` heal to `Default()` via the existing parse-failure heal paths (`tab_web.go`, `tab_layout.go`)

### Removal Verification

- [x] A-006 R3: repo-wide grep finds zero production references to any deleted `internal/chat` symbol (`Backfill`, `TailFrom`, `Conversation`, `Update`, `Event`, `Pending`, parser internals)
- [x] A-007 R4: no surviving test references a deleted symbol; dead test halves removed with their subjects

### Scenario Coverage

- [x] A-008 R2: layoutspec and tab tests cover the unknown-surface rejection and a valid 3-surface layout using only surviving kinds
- [x] A-009 R3: `api/chat_fixture_test.go` still passes against the kept `testdata/claude_session.jsonl`

### Edge Cases & Error Handling

- [x] A-010 R3: the KEPT items are untouched — `@rk_pane_chat` cluster, `testdata/claude_session.jsonl`, the regression pins (`router-url.test.ts:48`, `surface-layout.test.ts`, `use-shell-notifications.test.tsx:66`, `window-heading.spec.ts`) pass unmodified

### Code Quality

- [x] A-011 Pattern consistency: edits match surrounding naming/idiom; comment edits state constraints only, no narration or provenance (code-quality Anti-Patterns)
- [x] A-012 No renames: every symbol, file, and package keeps its name (renames are Change A2)
- [x] A-013 Verification gates green in order: `go test ./...`, `npx tsc --noEmit`, `just test`, `just build` — scoped re-run at review: layoutspec/chat/api green, tsc green; the single `cmd/rk` failure (`TestCodeExecPrintsResultJSON`, stale code-bridge extension on this machine) reproduces on the pristine base tree, so it is pre-existing and unrelated; full `just test` (343 e2e) was green at apply

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/frontend/src/app.tsx:1141` — comment clause "(the chat-view autofocus precedent)" still cites the deleted chat-view; same stale-reference class as the R6 fixes but missed by the plan's table (see should-fix finding)
- None otherwise — this change is itself the deletion sweep; greps confirm zero residual references to every deleted symbol, dependency, and file

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | T003 fixture disposition decided per fixture at apply (swap to surviving surface where the fixture tests valid layouts generally; convert to invalid-input case where the fixture's point was the chat kind itself) | Plan flags the six lines without prescribing; fixture intent is readable in place | S:70 R:90 A:80 D:70 |
| 2 | Confident | `adapter.go` post-trim shape keeps `Register`/`Lookup` + `TranscriptLocator` capability + package-level `TranscriptPath` exactly as consumed today; interface methods `Backfill`/`TailFrom` drop off the `Adapter` interface (or the interface reduces to `Provider()`) as long as no consumer breaks | Memory (chat.md) documents the consumed surface precisely; compile + grep verify | S:80 R:80 A:85 D:75 |
| 3 | Certain | Verification is the four ordered gates from `fab/project/code-quality.md`; e2e must pass unmodified | Stated in intake and project config | S:95 R:95 A:95 D:95 |

3 assumptions (1 certain, 2 confident, 0 tentative).

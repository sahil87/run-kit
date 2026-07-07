# Plan: Unnamed Windows Auto-Name to Folder

**Change**: 260707-j66b-unnamed-windows-autoname-folder
**Intake**: `intake.md`

## Requirements

### Tmux Config: Automatic-Rename Format

#### R1: Embedded configs set the basename automatic-rename format
Each of the four embedded tmux configs SHALL set `automatic-rename-format` to the basename of the active pane's current path, so that any window not pinned with an explicit name displays its folder basename and live-updates as the pane `cd`s.

- **GIVEN** the embedded config `configs/tmux/default.conf` (and `simple.conf`, `poweruser.conf`, `byobu.conf`)
- **WHEN** the config is loaded onto a tmux server
- **THEN** `automatic-rename-format` is set globally to `#{b:pane_current_path}`
- **AND** `automatic-rename` remains at its default of `on` (only the format changes; `byobu.conf` keeps its explicit `set -g automatic-rename on`)

### Backend Tmux Layer: Name-Optional Window Creation

#### R2: `CreateWindow` omits `-n` when the name is empty
The `tmux.CreateWindow` function SHALL construct its `new-window` argument slice WITHOUT `-n <name>` when the supplied name is empty, and WITH `-n <name>` when a non-empty name is given. All other arguments (`-a`, `-t <session>`, `-c <cwd>`) are unchanged.

- **GIVEN** `CreateWindow(session, "", cwd, server)` (empty name)
- **WHEN** the new-window arg slice is built
- **THEN** it is `["new-window", "-a", "-t", session, "-c", cwd]` with no `-n` token
- **AND GIVEN** `CreateWindow(session, "feature", cwd, server)` (non-empty name)
- **THEN** it is `["new-window", "-a", "-t", session, "-n", "feature", "-c", cwd]`

#### R3: The tmux-native name is single-sourced (no rename round-trip)
Because `-c cwd` is already passed on the unnamed create, the window SHALL name itself to the folder basename immediately via `automatic-rename-format` — `CreateWindow` MUST NOT issue a follow-up `rename-window` for the unnamed case.

- **GIVEN** an unnamed `CreateWindow` call with a non-empty cwd
- **WHEN** the window is created
- **THEN** no additional tmux rename command is issued by run-kit (tmux derives the name)

### Backend API: Window CREATE Name Optionality

#### R4: `POST /api/sessions/{session}/windows` accepts an omitted/empty name
The `handleWindowCreate` handler SHALL validate `body.Name` ONLY when it is non-empty; an omitted or empty `name` is a valid request meaning "let tmux auto-name". A non-empty name that fails `validate.ValidateName` still returns 400.

- **GIVEN** a create request body `{}` or `{"name":""}`
- **WHEN** the handler runs (no `rkType` present)
- **THEN** it calls `s.tmux.CreateWindow(session, "", resolvedCwd, server)` and returns 201
- **AND GIVEN** a create request body `{"name":"bad;name"}` (forbidden chars)
- **THEN** it returns 400 (non-empty names are still validated)

#### R5: The rename path is untouched
`handleWindowRename` (`POST /api/windows/{id}/rename`) SHALL continue to require a non-empty, validated name — an empty rename name still returns 400. The `rkType`-present create branch (iframe/service windows via `CreateWindowWithOptions`) SHALL keep passing its explicit name.

- **GIVEN** a rename request body `{"name":""}`
- **WHEN** `handleWindowRename` runs
- **THEN** it returns 400 (unchanged behavior)

### Frontend: Stop Pinning `+ New Window` Name

#### R6: The API client `createWindow` omits `name` from the body when absent
The `createWindow` client (`app/frontend/src/api/client.ts`) SHALL make the `name` parameter optional and omit it from the JSON body when not supplied (matching the existing optional-field handling for `cwd`/`rkType`/`rkUrl`).

- **GIVEN** `createWindow(server, session, undefined, cwd)`
- **WHEN** the request body is built
- **THEN** the body has no `name` key (only `cwd` when present)
- **AND GIVEN** `createWindow(server, session, "docs", undefined, "iframe", url)` (iframe path)
- **THEN** the body carries `name: "docs"` (explicit names still sent)

#### R7: The sidebar `+ New Window` call site drops the hardcoded `"zsh"`
The `+ New Window` create action (`app/frontend/src/app.tsx` ~line 681) SHALL call `createWindow` WITHOUT a name, and its optimistic ghost placeholder label SHALL become the raw basename of the creation cwd (the active window's `worktreePath`), matching what tmux will auto-name the window. When no cwd is available, the ghost label falls back to a neutral placeholder.

- **GIVEN** the active window's `worktreePath` is `/home/user/run-kit.worktrees/quick-bison`
- **WHEN** the user clicks `+ New Window`
- **THEN** `createWindow` is invoked with no name argument
- **AND** the optimistic ghost is labeled `quick-bison` (raw basename, not `"zsh"`)

#### R8: Explicit-name creation paths are unchanged
The iframe/service window creation call site (`app/frontend/src/app.tsx` ~line 761, `createWindow(server, sessionName, name, undefined, "iframe", url)`) SHALL keep passing its explicit name. `rk riff` panes (`buildNewWindowArgs` in `riff.go`) SHALL keep `-n`.

- **GIVEN** the iframe-window create flow
- **WHEN** it runs
- **THEN** its explicit `name` is still sent (no regression)

#### R9: The palette "Window: Create at Folder" flow creates unnamed windows *(rework cycle 1 — call site missed by the original inventory)*
The `CreateSessionDialog` window-mode create path (`app/frontend/src/components/create-session-dialog.tsx` ~line 196, reached via the palette action registered in `app/frontend/src/app.tsx` ~line 1018) SHALL call `createWindow` WITHOUT a name (dropping its hardcoded `"zsh"`), letting tmux auto-name the window from the chosen folder. Any optimistic ghost label in this flow SHALL match the raw basename of the chosen cwd (same rule as R7).

- **GIVEN** the palette flow "Window: Create at Folder" with a chosen folder `/home/user/code/myproj`
- **WHEN** the dialog submits
- **THEN** `createWindow` is invoked with no name argument (cwd still sent)
- **AND** the window auto-names to `myproj` via `automatic-rename-format`

#### R10: The `rkType`-present create branch requires a non-empty name *(rework cycle 1 — should-fix hardening)*
`handleWindowCreate` SHALL return 400 when `rkType` is present and `name` is empty/omitted, so `CreateWindowWithOptions` can never run `new-window -n ""` (a window pinned to an empty name with automatic-rename disabled). The shipped UI always supplies a name on this path; this pins the API contract.

- **GIVEN** a create request body `{"rkType":"iframe","rkUrl":"http://...","name":""}` (or omitted name)
- **WHEN** `handleWindowCreate` runs
- **THEN** it returns 400 and `CreateWindowWithOptions` is not called

#### R11: The board route's `+ New Window` creates unnamed windows *(rework cycle 2 — final missed call site; frontend sweep now grep-verified complete)*
The board page's session-row `+ New Window` action (`app/frontend/src/components/board/board-page.tsx` ~line 117, `createWindowApi(srv, sess, "zsh")`) SHALL call `createWindowApi` WITHOUT a name. This action registers no optimistic ghost and never passed a cwd (the backend resolves a default), so dropping the name is the complete change. After this, a repo grep for `"zsh"` at frontend `createWindow` call sites MUST return zero hits — the only remaining explicit-name creation paths are the deliberate ones (iframe `app.tsx` ~782, `server-list-page.tsx` `port-N`, `rk riff`), per R8.

- **GIVEN** the sidebar `+ New Window` button on `/board/$name`
- **WHEN** the create action runs
- **THEN** `createWindowApi` is invoked with no name argument (identical behavior to the same button on `/$server`)

### Non-Goals

- Migration of existing `-n zsh`-pinned windows — they have `automatic-rename` off and stay pinned (out of scope per intake).
- Rename API relaxation — only window CREATE becomes name-optional.
- Frontend display-side name fallbacks — the name comes from tmux, never derived in the UI.

### Design Decisions

1. **Extract a pure `buildCreateWindowArgs(session, name, cwd)` arg-builder in `tmux.go`**: `CreateWindow` calls `tmuxExecServer` directly (which executes tmux), so the conditional-`-n` logic is only unit-testable if the arg construction is a pure function. — *Why*: mirrors the existing `buildNewWindowArgs`/`buildSpawnArgvs` pure-arg-builder pattern already in `riff.go`, keeping the `-n`-conditional branch testable without a live tmux server. — *Rejected*: table test against a real tmux server (slower, and the existing `riff.go` precedent is pure-function unit tests).
2. **Ghost label uses the RAW basename, not `deriveNameFromPath`**: `deriveNameFromPath` runs `toTmuxSafeName` (sanitizes `.`→`_` etc.), but tmux's `#{b:pane_current_path}` uses the unsanitized basename. — *Why*: the ghost must match what tmux will actually display, so an unsanitized basename is correct. — *Rejected*: reuse `deriveNameFromPath` (would diverge from the real tmux name for paths with dots/special chars).
3. **E2E asserts the request omits `name`, not the visual auto-rename**: the e2e server (`rk-test-e2e`) is created by `test-e2e.sh` with a bare `new-session` (no `-f`), and `CreateWindow` does not pass `-f`/`source-file`, so `automatic-rename-format` is not reliably applied on that server. — *Why*: a deterministic seam (the create request body has no `name`) proves the frontend→API contract; the tmux-native rename is verified by the config + Go arg tests. — *Rejected*: asserting the sidebar row shows the folder basename (flaky — depends on config reaching the e2e server).

## Tasks

### Phase 1: Tmux config + backend tmux layer

- [x] T000 Add `set -g automatic-rename-format '#{b:pane_current_path}'` to all four embedded configs (`configs/tmux/default.conf`, `simple.conf`, `poweruser.conf`, `byobu.conf`); re-stage the canonical `default.conf` to `app/backend/build/tmux.conf` for the Go embed. Verify `TestDefaultConfigContainsSourceDirective`-style config assertions still pass; add a config-content assertion if the suite has a natural home for it <!-- R1 -->
- [x] T001 Extract pure `buildCreateWindowArgs(session, name, cwd string) []string` in `app/backend/internal/tmux/tmux.go` (omit `-n <name>` when `name == ""`, else include it; always `new-window -a -t <session>` + `-c <cwd>`), and refactor `CreateWindow` to build its args via this helper before calling `tmuxExecServer` <!-- R2 R3 -->
- [x] T002 Add table-driven `TestBuildCreateWindowArgs` in `app/backend/internal/tmux/tmux_test.go` covering empty-name (no `-n`) and non-empty-name (with `-n`) cases <!-- R2 R3 -->

### Phase 2: Backend — API handler

- [x] T003 In `app/backend/api/windows.go` `handleWindowCreate`, change the `body.Name` validation to run ONLY when `body.Name != ""` (an omitted/empty name is valid); leave the `rkType` branch and all other validation unchanged <!-- R4 R5 -->
- [x] T004 Update `app/backend/api/windows_test.go`: change `TestWindowCreateInvalidWindowName` to assert an empty-name CREATE now returns 201 and calls `CreateWindow` with an empty name (rename it to reflect the new spec, e.g. `TestWindowCreateEmptyNameAccepted`); add a case that a non-empty forbidden-char name still returns 400; confirm `TestWindowRenameEmptyName` (empty rename → 400) remains and passes <!-- R4 R5 -->

### Phase 3: Frontend — client + call site

- [x] T005 In `app/frontend/src/api/client.ts`, make `createWindow`'s `name` parameter optional (`name?: string`) and only add `name` to the body when it is a non-empty string (keep `cwd`/`rkType`/`rkUrl` handling) <!-- R6 -->
- [x] T006 In `app/frontend/src/app.tsx`, at the `+ New Window` create action (~line 681): call `createWindow(srv, session, undefined, activeWin?.worktreePath)` (no name), and set the optimistic ghost label to the raw basename of `activeWin?.worktreePath` (fallback to a neutral placeholder when no cwd); leave the iframe-window call site (~line 761) unchanged <!-- R7 R8 -->
- [x] T007 [P] Add/extend a unit test for the client change (`app/frontend/src/api/client.test.ts`): assert `createWindow` with no name omits `name` from the body, and with a name includes it <!-- R6 -->

### Phase 4: E2E

- [x] T008 Add a focused Playwright e2e (`app/frontend/tests/e2e/new-window-unnamed.spec.ts` + sibling `.spec.md`) that clicks `+ New Window` and, via route interception on `POST /api/sessions/*/windows`, asserts the request body carries no `name` key (the deterministic frontend→API contract); companion `.spec.md` documents what-it-proves + steps per constitution <!-- R7 -->

### Phase 5: Rework cycle 1 (review findings)

- [x] T009 In `app/frontend/src/components/create-session-dialog.tsx` (~line 196, `mode="window"` branch): call `createWindow` WITHOUT a name instead of the hardcoded `"zsh"` (the chosen cwd already flows); if this flow sets an optimistic ghost label, use the raw basename of the chosen cwd (reuse/mirror the R7 helper). Cover with a unit test if the dialog has an existing test seam (extend it), else rely on the client-level tests <!-- R9 -->
- [x] T010 In `app/backend/api/windows.go` `handleWindowCreate`: when `body.RkType != ""`, require a non-empty validated `name` (400 on empty/omitted) so `CreateWindowWithOptions` never receives an empty name; add `windows_test.go` coverage for iframe-create-with-empty-name → 400 (and non-empty iframe name still 201) <!-- R10 -->

### Phase 6: Rework cycle 2 (review findings)

- [x] T011 In `app/frontend/src/components/board/board-page.tsx` (~line 117): change `createWindowApi(srv, sess, "zsh")` to `createWindowApi(srv, sess)` (no ghost, no cwd — complete change); verify with a grep that no `"zsh"` literal remains at any frontend `createWindow` call site <!-- R11 -->
- [x] T012 Update `docs/specs/api.md` (~line 166): the `POST /api/sessions/:session/windows` contract row for `name` is no longer "Required: yes" — document name as optional (omitted/empty ⇒ tmux auto-names via `automatic-rename-format`) and the 400 case when `rkType` is present with an empty/omitted name <!-- R4 R10 -->
- [x] T013 In `app/frontend/src/app.tsx` (~lines 57-75): re-seat `rawBasename` and its JSDoc so `deriveInstantSessionName`'s doc comment sits directly above its function (move `rawBasename` + doc above the stranded comment or below the function) — no behavior change, tsc + vitest confirm <!-- R7 -->

## Execution Order

- T001 blocks T002 (test targets the extracted helper)
- T003 blocks T004 (test targets the relaxed validation)
- T005 blocks T006 and T007 (call site and client test depend on the optional-name signature)

## Acceptance

### Functional Completeness

- [x] A-001 R1: All four `configs/tmux/*.conf` files contain `set -g automatic-rename-format '#{b:pane_current_path}'`; `byobu.conf` keeps `set -g automatic-rename on`
- [x] A-002 R2: `CreateWindow`/`buildCreateWindowArgs` omits `-n` for an empty name and includes `-n <name>` for a non-empty name
- [x] A-003 R3: The unnamed create issues no follow-up rename (single tmux invocation)
- [x] A-004 R4: `POST /api/sessions/{session}/windows` with `{}`/`{"name":""}` returns 201 and calls `CreateWindow` with an empty name
- [x] A-005 R6: The client `createWindow` omits `name` from the JSON body when absent and includes it when supplied
- [x] A-007 R7: The sidebar `+ New Window` action calls `createWindow` with no name and labels the ghost with the raw cwd basename

### Behavioral Correctness

- [x] A-008 R4: A non-empty create name with forbidden characters still returns 400 (validation preserved for non-empty names)
- [x] A-009 R5: The rename path still rejects an empty name (400) and the iframe/service create path still passes its explicit name

### Scenario Coverage

- [x] A-010 R2: `TestBuildCreateWindowArgs` (Go) covers both empty and non-empty name cases
- [x] A-011 R4: `windows_test.go` covers empty-name CREATE accepted + non-empty invalid name rejected
- [x] A-012 R6: A frontend unit test covers the client body-omission behavior
- [x] A-013 R7: A Playwright e2e asserts the `+ New Window` request omits `name`, with a sibling `.spec.md`

### Edge Cases & Error Handling

- [x] A-014 R8: No regression to `rk riff` (`buildNewWindowArgs` keeps `-n`) or iframe windows (`CreateWindowWithOptions` keeps `-n`)
- [x] A-019 R9: The palette "Window: Create at Folder" flow calls `createWindow` with no name (hardcoded `"zsh"` removed from `create-session-dialog.tsx`); any ghost label uses the raw cwd basename (this flow sets no ghost — see Assumption #5 — so there is no label to derive)
- [x] A-020 R10: `POST .../windows` with `rkType` present and empty/omitted `name` returns 400 (`CreateWindowWithOptions` never gets an empty name), with `windows_test.go` coverage; non-empty iframe name still succeeds
- [x] A-021 R11: The board-route `+ New Window` calls `createWindowApi` with no name; a grep confirms zero `"zsh"` literals remain at frontend `createWindow` call sites
- [x] A-022 R4: `docs/specs/api.md` documents the window-create `name` field as optional with the rkType-present 400 case (spec matches implementation)
- [x] A-023 R7: `deriveInstantSessionName`'s JSDoc sits directly above its function; `rawBasename` carries its own doc (no stranded comment blocks in `app.tsx`)

### Code Quality

- [x] A-015 Pattern consistency: The extracted `buildCreateWindowArgs` follows the pure-arg-builder pattern of `buildNewWindowArgs`; frontend optional-field handling matches existing `cwd`/`rkType` pattern
- [x] A-016 No unnecessary duplication: Reuses `tmuxExecServer`, existing validation helpers, and the existing ghost-window store rather than reimplementing
- [x] A-017 Security (Constitution I): The new-window args remain an explicit `exec.CommandContext` argument slice (no shell strings); `-c cwd` and any name pass through validated inputs
- [x] A-018 Test companion doc: The new/modified `.spec.ts` ships an updated sibling `.spec.md` in the same commit (constitution)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change relaxes validation and removes a hardcoded literal without leaving any existing code redundant or unused (the replaced `TestWindowCreateInvalidWindowName` was already superseded in the same diff; `deriveNameFromPath` retains its other call sites).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Extract a pure `buildCreateWindowArgs` helper in `tmux.go` so the conditional-`-n` branch is unit-testable | Mirrors the existing `buildNewWindowArgs`/`buildSpawnArgvs` pure-arg-builder pattern in `riff.go`; the only way to unit-test arg construction without a live tmux server | S:80 R:85 A:90 D:85 |
| 2 | Confident | Ghost placeholder label uses the RAW basename of `worktreePath` (not `deriveNameFromPath`) | tmux `#{b:pane_current_path}` is unsanitized; the ghost must match the eventual tmux name; intake assumption #8 flagged this as a small easily-changed detail | S:70 R:85 A:80 D:75 |
| 3 | Confident | E2E asserts the CREATE request omits `name` (route interception) rather than the visual auto-rename in the sidebar | The e2e server is created with a bare `new-session` (no `-f`) and `CreateWindow` never sources the config, so `automatic-rename-format` is not reliably applied there; the request-omits-name seam is deterministic and proves the frontend→API contract; intake said e2e "where possible" | S:65 R:80 A:75 D:70 |
| 4 | Certain | No migration of existing `-n`-pinned windows during apply (out of scope; not "trivially cheap") | Intake assumption #7 marked it optional/out-of-scope; unpinning requires a per-window `set -w automatic-rename on` sweep that is not trivially cheap | S:80 R:90 A:80 D:80 |
| 5 | Certain | T009 (`CreateSessionDialog` window flow) sets NO optimistic ghost, so no ghost label was added and `rawBasename` was not imported/duplicated | Verified in source: the window-mode `useOptimisticAction` (line ~195) has no `onOptimistic` callback (unlike the session-create action above it and the sidebar `+ New Window` action which does set a ghost). T009's ghost-label clause is conditional ("if this flow sets one"); it does not — dropping `"zsh"`→`undefined` is the complete change. Client-level tests (`client.test.ts` omit-name branch) cover the seam per T009's fallback | S:90 R:85 A:90 D:90 |

5 assumptions (3 certain, 2 confident, 0 tentative).

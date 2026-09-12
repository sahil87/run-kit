# Plan: rk board verb — CLI door onto the five board routes, plus the `board` MCP policy row

**Change**: 260911-u49l-rk-board-verb
**Intake**: `intake.md`

## Requirements

### CLI: the `rk board` family

#### R1: `rk board` is a visible root family with four members
`app/backend/cmd/rk/board.go` SHALL define a parent `boardCmd` (`Use: "board"`) with children `show`, `pin`, `unpin`, `reorder`, registered in `root.go` immediately after `tabCmd`. The parent MUST carry four **persistent** flags: `-L, --server <name>` (string), `--json` (bool), `--before <@N>` (string), `--after <@N>` (string). Every child's `Args` validator MUST be wrapped with `usageArgs` at the family's add site (the `tab.go` init idiom) so arg-count violations exit 2. `show` takes `MaximumNArgs(1)`; `pin`/`unpin`/`reorder` take `ExactArgs(2)`. The family's `Long` texts follow the `tab` family's voice (substrate-free: this family needs `rk serve` up).

- **GIVEN** a built `rk`
- **WHEN** `rk -h` and `rk board -h` run
- **THEN** `board` is listed at root after `tab`, the four members are listed, and `rk board pin --help` shows `pin <name> <@N|=session:window>` with the four inherited flags

#### R2: Addresses and names are validated CLI-side; the mutations require a window
`<name>` MUST pass `tmux.ValidBoardName` before any request; failure is `usageError` (exit 2). The window positional on `pin`/`unpin`/`reorder` MUST resolve through the existing `resolveTabAddr(ctx, arg, boardServerFlag)` so `@N` and `=session:window` both work and the server follows the `rk tab` rule (`-L` wins → caller's own server from the captured `$TMUX` → `default`); a malformed address is usage (exit 2), an unresolvable `=session:window` is operational (exit 1). `--before`/`--after` MUST be `@N`-form (`tmux.ValidWindowID`) and MUST be rejected as usage on `show`/`pin`/`unpin` with the message `--before/--after apply to reorder only`. `show` MUST accept and ignore `-L` (documented in its help).

- **GIVEN** no `$TMUX`, no `-L`
- **WHEN** `rk board pin work @7` runs
- **THEN** the request body is `{"server":"default","windowId":"@7"}`
- **GIVEN** `rk board pin "bad/name" @7` or `rk board pin work @x` or `rk board pin work @7 --before @3`
- **WHEN** it runs
- **THEN** the process exits 2 with no HTTP request made

#### R3: One bounded HTTP call per invocation through the daemon door; never fail-silent
Each verb MUST make exactly one request to `resolveOrigin(ctx) + <route>` under `context.WithTimeout(ctx, boardHTTPTimeout)` where `boardHTTPTimeout = 10 * time.Second` is a named constant, through a package-level `boardHTTPClient` seam (default `http.DefaultClient`). Routes and bodies: `GET /api/boards`, `GET /api/boards/{name}`, `POST /api/boards/{name}/pin` and `/unpin` with `{"server","windowId"}`, `POST /api/boards/{name}/reorder` with `{"server","windowId","before","after"}` where absent neighbours are JSON `null`. A transport error or timeout MUST exit 1 with `board: run-kit daemon unreachable at <origin> — is rk serve running?`. A non-2xx MUST exit 1 with the body's `error` string verbatim, falling back to `board: <METHOD> <path> returned <status>` when the body carries no `error`. Nothing is written to stdout on failure.

- **GIVEN** the origin points at a closed port
- **WHEN** `rk board show` runs
- **THEN** exit 1 and stderr names the origin and `rk serve`
- **GIVEN** the daemon answers `404 {"error":"window not found on server"}`
- **WHEN** `rk board pin work @7` runs
- **THEN** exit 1 and stderr is exactly that message

#### R4: Human output is data on stdout, one line per fact
All success output MUST go through `newSink(cmd).Dataf` (never gated by `--quiet`). `show` without a name prints `name<TAB>pinCount` rows via `text/tabwriter` in the daemon's order; `show <name>` prints one row per entry in the response order: `windowId  server  session  windowIndex  windowName  <paneCount>`; an empty list prints nothing and exits 0. `pin` prints `pinned @7 to work`, `unpin` prints `unpinned @7 from work`, `reorder` prints `reordered @7 on work → <orderKey>` (the resolved `@N`, never the raw `=session:window` argument).

- **GIVEN** the daemon returns `[{"name":"work","pinCount":3}]`
- **WHEN** `rk board show` runs
- **THEN** stdout is `work\t3\n` (tabwriter-aligned)
- **GIVEN** `rk board pin work @7` succeeds
- **WHEN** it prints
- **THEN** stdout is `pinned @7 to work\n`

#### R5: `--json` emits the interim bare document or receipt
With `--json`, `show` MUST write the response body to stdout **byte-for-byte** (no re-marshal) followed by a newline. `pin`/`unpin` MUST print `{"board":"<name>","window":"@N"}`; `reorder` MUST print `{"board":"<name>","window":"@N","orderKey":"<newOrderKey>"}` with `orderKey` copied from the route's `newOrderKey`. No envelope is emitted (W2a owns the envelope helper); failures print nothing on stdout and follow R3.

- **GIVEN** the daemon returns `200 {"ok":true,"newOrderKey":"a0V"}`
- **WHEN** `rk board reorder work @7 --after @3 --json` runs
- **THEN** stdout is `{"board":"work","window":"@7","orderKey":"a0V"}\n`

### MCP: the `board` policy row

#### R6: One `board` row with an action enum; tests pin it
`internal/mcp/policy.go` `Table` SHALL gain a row `Tool:"board", Path:"board"` with args in this order: `serverArg`; `action` (positional 1, required, enum `show|pin|unpin|reorder`); `name` (positional 2, optional, pattern `^[A-Za-z0-9_-]{1,32}$`); `window` (positional 3, optional, pattern `^@\d+$`); `before` (`--before`, pattern `^@\d+$`); `after` (`--after`, pattern `^@\d+$`); `jsonLiteral`. `Result: ResultJSON`, `Annotations: Annotations{}` (all false), `Description: boardDescription` (a per-row override naming the four actions, which inputs each requires, that `show` without `name` lists boards, that `server` applies to the mutations and defaults to `default`, that `before`/`after` are reorder-only `@N` neighbours where neither means append, and that the result is the route body for `show` or the `{board, window, orderKey?}` receipt). `mcp.Resolve(rootCmd, Table)` MUST succeed (this is what forces R1's persistent flags). `TestTableShape`'s want-list grows to eleven with `board` appended after `send`; `TestTableSendRow` locates `send` by name. A new test asserts `InputSchema` for the resolved `board` row has `required == ["action"]`, the four-value enum on `action`, the three patterns, and no `readOnly` annotation. `mcp_e2e_test.go`'s sorted want-list gains `board`; the E2E does not call the tool. `rk doctor` reports `11 tools; all policy rows resolve` with no code change.

- **GIVEN** the row and a call `{action:"reorder", name:"work", window:"@7", after:"@3", server:"s"}`
- **WHEN** `BuildArgv` runs
- **THEN** argv is `["board","-L","s","--after","@3","reorder","work","@7","--json"]` and Cobra parses it on the `reorder` child

### Docs and conformance

#### R7: The verb is documented where verbs live
`docs/specs/mcp.md` Allowlist v1 `board` row's "Structured today" cell MUST read `yes`. `docs/site/skill.md` MUST gain one capability bullet next to the `rk tab` bullets describing the four `rk board` verbs and that they need `rk serve` up; `scripts/sync-skill.sh` MUST be run so `app/backend/cmd/rk/skill/skill.md` is byte-identical (the MCP E2E and `TestSkillEmbedMatchesCanonical` assert it). `README.md`'s root-verb table MUST gain an `rk board` row after `rk tab`. `docs/site/boards.md` § Pinning a window MUST gain a fourth entry point naming `rk board pin <name> @N`.

- **GIVEN** the docs edits
- **WHEN** `go test ./cmd/rk/...` runs
- **THEN** the skill embed drift guard passes

#### R8: Toolkit-standards conformance on the new surface
Before the change is considered complete, `shll standards help-dump` and `shll standards principles` MUST be read and the new surface checked against them: `rk help-dump` includes the `board` node with its four leaves; every member prints one data line (P9 bounded output) and honours `--quiet` (data survives); exit codes follow 0/1/2. Findings, if any, are fixed in this change.

- **GIVEN** a HEAD build (`just build` → `bin/rk`)
- **WHEN** `bin/rk help-dump` runs
- **THEN** a `board` node with `show`, `pin`, `unpin`, `reorder` leaves is present

### Non-Goals

- No `--json` envelope helper (W2a). No `operator request` verb (W3a). No new daemon route, body, status code, or SSE change.
- No tmux-direct implementation of pin/unpin/reorder in the CLI.
- No `readOnlyHint` on `board`; no split into `board_show` + `board`.
- No `board create`/`board rm`.
- No E2E call of the `board` tool (the MCP E2E harness runs no daemon).

### Design Decisions

#### Action-enum policy rows require their flags on the parent command
**Decision**: `-L`, `--json`, `--before`, `--after` are persistent flags on `boardCmd`; children that do not use `--before`/`--after` reject them at run time as usage.
**Why**: `mcp.Resolve` looks flags up on the row's `Path` (the parent), and `BuildArgv` emits flags before positionals (`rk board -L s --after @3 reorder work @7 --json`), so every flag the row uses must parse on every child.
**Rejected**: a single leaf `board <action> …` command (loses per-verb help and contradicts the spec's "family like `tab`"); defining `--before`/`--after` on `reorder` only (fails the drift guard at startup).
*Introduced by*: 260911-u49l-rk-board-verb

#### Bare `--json` documents until W2a's envelope wraps them
**Decision**: `rk board … --json` prints the route body or the receipt as a bare JSON document; no `{ok, result}` envelope.
**Why**: the plan assigns the envelope helper to W2a and says W3b needs only W1; the MCP `ResultJSON` parser accepts bare documents with `ok` from the exit code; avoids a conflict in `output.go`.
**Rejected**: adding the envelope helper here (collides with W2a; a second author of one shared helper).
*Introduced by*: 260911-u49l-rk-board-verb

#### `board` is not fail-silent, unlike `notify`
**Decision**: transport and daemon errors exit 1 with a message; nothing is swallowed.
**Why**: a pin that did not happen must say so — `notify`'s fail-silent contract exists because a notification must never stall an operator loop, which does not apply to a mutation a caller is waiting on.
**Rejected**: mirroring `sendNotify`'s swallow-everything posture.
*Introduced by*: 260911-u49l-rk-board-verb

#### `show` accepts and ignores `-L`
**Decision**: `-L` on `show` is accepted and ignored, documented in help.
**Why**: the single MCP tool exposes `server` for every action; a model passing it with `show` should not get a usage error; the GET routes aggregate across servers and have no server filter to honour.
**Rejected**: rejecting `-L` on `show` as usage.
*Introduced by*: 260911-u49l-rk-board-verb

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/backend/cmd/rk/board.go`: parent `boardCmd` with persistent `-L/--server`, `--json`, `--before`, `--after`; children `boardShowCmd` (`MaximumNArgs(1)`), `boardPinCmd`/`boardUnpinCmd`/`boardReorderCmd` (`ExactArgs(2)`) with `Short`/`Long` in the `tab` family's voice; `usageArgs` wrap loop in `init`; register `boardCmd` in `root.go` after `tabCmd`. <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 In `board.go`, add the transport: `boardHTTPTimeout` const, `boardHTTPClient` seam, a `boardRequest(ctx, method, path, body any) ([]byte, error)` helper that resolves the origin, sends one bounded request, and maps transport errors to `board: run-kit daemon unreachable at <origin> — is rk serve running?` and non-2xx to the body's `error` string (fallback `board: <METHOD> <path> returned <status>`). <!-- R3 -->
- [x] T003 Implement `runBoardShow`: `GET /api/boards` or `/api/boards/{name}` (name validated with `tmux.ValidBoardName`); `--json` writes the body byte-for-byte plus newline; human path decodes into `[]tmux.BoardSummary` / `[]struct` matching `api.BoardEntryResponse` fields and prints tabwriter rows; reject `--before`/`--after` as usage; ignore `-L`. <!-- R4 R5 -->
- [x] T004 Implement `runBoardPin` and `runBoardUnpin` via one shared `runBoardPinLike(cmd, args, action)`: validate name, reject `--before`/`--after`, resolve window + server with `resolveTabAddr`, POST the `{server, windowId}` body, print `pinned @N to <name>` / `unpinned @N from <name>` or the `{"board","window"}` receipt. <!-- R2 R3 R4 R5 -->
- [x] T005 Implement `runBoardReorder`: validate name, `--before`/`--after` with `tmux.ValidWindowID` (usage on failure), resolve window + server, POST `{server, windowId, before, after}` with `*string` nulls, decode `newOrderKey`, print `reordered @N on <name> → <key>` or the `{"board","window","orderKey"}` receipt. <!-- R2 R3 R4 R5 -->
- [x] T006 Write `app/backend/cmd/rk/board_test.go` (httptest + `pointConfigAt`, direct `RunE`/`rootCmd.SetArgs` idioms from `notify_test.go`/`tab_test.go`): registration after `tab` and `usageArgs` wrap; `show` list/entries human + `--json` pass-through + empty list; `pin`/`unpin` body, report line, receipt, `-L` fills `server`; `reorder` before/after/null bodies and `orderKey` receipt; unreachable daemon exit 1 message; 404 pass-through; usage class for bad name, bad window, missing window, `--before` off reorder, non-`@N` neighbour (assert via `exitCode(err) == 2` and no request recorded). <!-- R2 R3 R4 R5 -->

### Phase 3: Integration & Edge Cases

- [x] T007 Add the `board` row and `boardDescription` const to `app/backend/internal/mcp/policy.go` (appended after `send`); update `policy_test.go` (`TestTableShape` eleven names; `TestTableSendRow` finds `send` by name; new `TestTableBoardRow` asserting args/enum/patterns/annotations/description) and `schema_test.go` (a `board` `InputSchema` assertion, resolved against a stub tree or the real `rootCmd` from `cmd/rk/mcp_test.go` — place it where the real tree is available); add a `BuildArgv` case for the reorder call; update the sorted want-list in `cmd/rk/mcp_e2e_test.go`; run `go test ./internal/mcp/... ./cmd/rk/...`. <!-- R6 -->

### Phase 4: Polish

- [x] T008 Docs: flip the `board` "Structured today" cell to `yes` in `docs/specs/mcp.md`; add the `rk board` capability bullet to `docs/site/skill.md` after the `rk tab show` bullet and run `scripts/sync-skill.sh`; add the `rk board` row after `rk tab` in `README.md`'s verb table; add the fourth entry point to `docs/site/boards.md` § Pinning a window. <!-- R7 -->
- [x] T009 Conformance and gates: read `shll standards help-dump` and `shll standards principles`, run `just build` and check `bin/rk help-dump` for the `board` node, `bin/rk board --quiet show` behaviour, exit codes; then `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, `just test`, `just build`. Fix any finding in this change. <!-- R8 -->

## Execution Order

- T001 blocks T002–T005 (the commands must exist to hang run functions on)
- T002 blocks T003–T005
- T006 after T003–T005
- T007 after T001 (the row must resolve against the real tree)
- T008 and T009 last; T009 after T008 (the skill drift guard runs in `go test`)

## Acceptance

### Functional Completeness

- [x] A-001 R1: `rk board` is registered at root after `tab` with `show`, `pin`, `unpin`, `reorder` and the four persistent flags; each child's `Args` is `usageArgs`-wrapped
- [x] A-002 R2: board names, window addresses, and neighbour ids are validated CLI-side with the existing `tmux.ValidBoardName` / `resolveTabAddr` / `tmux.ValidWindowID` helpers
- [x] A-003 R3: every verb makes exactly one bounded request via `resolveOrigin` and the `boardHTTPClient` seam
- [x] A-004 R4: human output matches the specified rows and report lines exactly
- [x] A-005 R5: `--json` output matches the specified bare document / receipt shapes exactly
- [x] A-006 R6: the `board` policy row exists with the specified args, result kind, annotations, and description override; `mcp.Resolve(rootCmd, mcp.Table)` succeeds
- [x] A-007 R7: spec cell, skill bundle (+ synced copy), README row, and boards site page are updated
- [x] A-008 R8: `bin/rk help-dump` carries the `board` node; the toolkit standards check produced no unfixed finding

### Behavioral Correctness

- [x] A-009 R3: an unreachable daemon exits 1 with the `unreachable at <origin>` message and prints nothing on stdout
- [x] A-010 R3: a daemon non-2xx exits 1 with the body's `error` string verbatim
- [x] A-011 R2: `--before`/`--after` on `show`/`pin`/`unpin` exit 2 with `--before/--after apply to reorder only` before any request
- [x] A-012 R5: `reorder` sends JSON `null` for an absent neighbour and copies `newOrderKey` into `orderKey`

### Scenario Coverage

- [x] A-013 R2: `rk board pin work @7` with no `$TMUX` and no `-L` sends `server:"default"`; with `-L rk-test` sends `server:"rk-test"`
- [x] A-014 R6: `BuildArgv` for `{action:"reorder", name:"work", window:"@7", after:"@3", server:"s"}` yields `["board","-L","s","--after","@3","reorder","work","@7","--json"]`
- [x] A-015 R6: the generated `board` input schema requires only `action`, carries the four-value enum and the three patterns, and has no read-only hint
- [x] A-016 R4: `show` on an empty list prints nothing and exits 0

### Edge Cases & Error Handling

- [x] A-017 R2: a bad board name, a malformed window id, a missing window positional, and a non-`@N` neighbour each exit 2 with no HTTP request
- [x] A-018 R3: a non-2xx body without an `error` field falls back to `board: <METHOD> <path> returned <status>`
- [x] A-019 R2: `show -L anything` is accepted and behaves exactly like `show`

### Code Quality

- [x] A-020 Pattern consistency: `board.go` follows the `tab`/`notify` idioms (package-level seams, `newSink`, `usageError`, `resolveOrigin`, comment style stating constraints not narration)
- [x] A-021 No unnecessary duplication: reuses `resolveTabAddr`, `tmux.ValidBoardName`, `tmux.ValidWindowID`, `resolveOrigin`, `newSink`, `usageArgs`; no second origin resolver or address parser
- [x] A-022 Named constants: the HTTP timeout and report words are not magic literals scattered across functions
- [x] A-023 Tests: new behaviour is covered by `board_test.go` and the policy/schema tests; `go test ./...` is green
- [x] A-024 No shell strings or unbounded subprocess/HTTP calls; every request runs under a timeout context
- [x] A-025 No comment narration: comments state cross-file contracts (why flags are persistent, why not fail-silent), never the next line or change ids

### Security

- [x] A-026 R2: every user-provided token (board name, window id, neighbour ids, server name) is validated before it reaches a URL path or request body; no value is interpolated into a shell

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- The plan doc `fab/plans/sahil/26-09-10-rk-mcp.md` already carries the in-progress W3b rows (edited at intake). The PR number is added to the W3b Evidence cell once the PR exists (review-pr stage); the Done flip belongs to whoever merges.

## Deletion Candidates

- None — this change adds a new verb family and policy row without making existing code redundant. The five daemon routes in `api/boards.go` remain the single write path (the CLI is a new door onto them, not a replacement), and every helper the family touches (`resolveOrigin`, `resolveTabAddr`, `newSink`, `usageArgs`, `usageError`, the `tmux` validators) stays in use by its prior callers.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Persistent `-L`/`--json`/`--before`/`--after` on the parent `board` command | `mcp.Resolve` checks flags on the resolved parent path; `BuildArgv` emits flags before positionals | S:85 R:80 A:90 D:85 |
| 2 | Certain | Bare `--json` documents; no envelope helper in this change | W2a owns the helper; `ResultJSON` accepts bare documents | S:80 R:90 A:85 D:80 |
| 3 | Confident | `show` decodes the body only for the human path and passes the raw bytes through under `--json` | Byte-for-byte pass-through means a daemon-side field addition needs no CLI release; the human path needs typed fields for tabwriter columns | S:70 R:90 A:85 D:75 |
| 4 | Confident | The `board` row is appended after `send` and `TestTableSendRow` locates `send` by name | Keeps "See rows, then Talk, then See/Steer" ordering readable; a positional `Table[len-1]` assertion is brittle | S:65 R:95 A:85 D:75 |
| 5 | Confident | The `board` schema assertion lives in `cmd/rk/mcp_test.go` next to `TestMCPTableResolves`, where the real Cobra tree is available | `internal/mcp` tests use stub trees; the enum/pattern assertions are on the row and need no tree, but the resolved-schema assertion does | S:60 R:95 A:85 D:75 |

5 assumptions (2 certain, 3 confident).

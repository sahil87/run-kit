# Plan: tmux Option Namespace + Legacy Sweep

**Change**: 260828-b71j-tmux-option-namespace-legacy-sweep
**Intake**: `intake.md`

## Requirements

### tmux: Scope-Named Color Options

#### R1: Color options live in the `@rk_<scope>_<name>` namespace
`internal/tmux` SHALL export `ColorOption = "@rk_win_color"` and `SessionColorOption = "@rk_ses_color"`, and no production Go or TypeScript code SHALL carry the bare literals `"@color"` / `"@session_color"` (comments included). Read formats (`ListWindows`, `ListSessions`, `layoutWindowFormat`, `layoutSessionFormat`) keep their field positions; only the format literal changes.

- **GIVEN** a window with `@rk_win_color 5` set via `set-option -w`
- **WHEN** `ListWindows` runs
- **THEN** the window's `Color` field is `"5"`
- **AND** `grep -rn '"@color"\|"@session_color"\|#{@color}\|#{@session_color}' app/backend app/frontend/src --include=*.go --include=*.ts --include=*.tsx` (excluding `legacy_options*.go` and its tests) returns nothing

#### R2: `POST /api/windows/{id}/options` accepts only the new key
The allowlist constant `optKeyColor` SHALL equal `tmux.ColorOption`. The endpoint SHALL reject `@color` with 400 like any non-allowlisted key (hard cut, no dual-accept).

- **GIVEN** `{"options":{"@rk_win_color":"5"}}` → **THEN** 200 and one `SetWindowOptions` op with key `@rk_win_color`
- **GIVEN** `{"options":{"@color":"5"}}` → **THEN** 400 and zero tmux calls

#### R3: Frontend writes the new key
`setWindowColor` in `app/frontend/src/api/client.ts` SHALL POST `{"@rk_win_color": value|null}`. `setSessionColor` is unchanged (server-side key). Comments naming the old keys are updated (`client.ts`, `types.ts`).

- **GIVEN** `setWindowColor(server, "@2", "1+3")` → **THEN** the request body is `{"options":{"@rk_win_color":"1+3"}}`

#### R4: Operator color-tabs prompt names the new key
The `color-tabs` prompt in `api/operator.go` SHALL instruct `tmux set-option -t @N '@rk_win_color' '<value>'` / `-u '@rk_win_color'` and its Bounds sentence SHALL name `@rk_win_color`; `operator_test.go` assertions follow.

- **GIVEN** the rendered color-tabs prompt → **THEN** it contains `'@rk_win_color'` and does not contain `'@color'`

#### R5: Snapshot restore writes the new key
`snapshot/restore.go` `windowOptionOps` SHALL emit `tmux.ColorOption`; the session-color restore path SHALL write `tmux.SessionColorOption` (via `SetSessionColor`, which already owns the literal). Stored snapshot structs are unchanged — no on-disk migration.

- **GIVEN** a snapshot with `win.Color = "2"` → **WHEN** restored → **THEN** the op list contains `@rk_win_color=2` (restore_test script literal updated)

### tmux: Legacy Option Migration

#### R6: Table-driven `MigrateLegacyOptions`
`internal/tmux` SHALL provide `MigrateLegacyOptions(ctx, server) error` driven by a package table `legacyOptions []legacyOption{Old, New, Scope}` initially holding `{"@color", ColorOption, scopeWindow}` and `{"@session_color", SessionColorOption, scopeSession}`. Per row: (a) **right-scope move** — for each carrier at `row.Scope` whose old option is *held at that scope* (`show-options -<flag>qv -t <target> @old` non-empty), copy to `@new` if `@new` is unset there, then unset `@old`; (b) **wrong-scope purge** — for every other scope (server `-s`, each session `-t =name:`, each window `-w -t @N`, each pane `-p -t %N`, and global `-g`), unset `@old` where held; values are never copied from a wrong scope. Every set/unset logs `slog.Info` (`server`, `option`, `scope`, `target`); per-carrier failures log `slog.Warn` and continue; the first error is returned. All tmux calls go through `tmuxExecServer`/`tmuxExecRawServer` (Constitution I). Session targets use `=name:` (window-target collision hazard).

- **GIVEN** window `@1` holds `@color 5` → **WHEN** migrated → **THEN** `@1` holds `@rk_win_color 5` and no `@color`
- **GIVEN** session `s` holds `@session_color 4` → **THEN** `s` holds `@rk_ses_color 4`, no `@session_color`
- **GIVEN** session `s` holds `@color slate` (the fabKit case) → **THEN** `@color` is unset on `s` and no window gained `@rk_win_color slate`
- **GIVEN** global `@color 3` (`set -g`) → **THEN** unset
- **GIVEN** window `@1` holds both `@color 5` and `@rk_win_color 7` → **THEN** `@rk_win_color` stays `7`, `@color` unset
- **GIVEN** a migrated server → **WHEN** migrated again → **THEN** zero `set-option` calls are issued (idempotent)

#### R7: Once-per-server-per-daemon guard
`MigrateLegacyOptionsOnce(ctx, server)` SHALL run the sweep at most once per server per process, marking on **attempt** (a failing server is not retried on every attach) using an in-memory `sync.Map`/mutex-guarded set — no disk state (Constitution II). It SHALL return `(changed bool, err error)` so callers can wake the SSE hub only when something moved. A `ResetLegacyMigrationForTest()` helper (or exported seam) SHALL exist for tests.

- **GIVEN** two concurrent `Once` calls for the same server → **THEN** the sweep body runs exactly once

#### R8: Sweep hooks at the `ReloadConfig` seams, managed servers only
The sweep SHALL run after a successful managed-conf reload at: `tmux.RefreshSweep` (per managed server, via a `sweepMigrateLegacy` seam var), `api/terminals_ws.go` `reloadConfigForAttach` (via `attachMigrateLegacy` seam), `api/servers.go` adopt handler and `api/tmux_config.go` `handleTmuxReloadConfig` (via seam vars on the same pattern), and `cmd/rk/mux_adopt.go` `runMuxAdopt` (via `muxAdoptMigrateLegacyFn`). Daemon/API paths call `Once`; `rk mux adopt` calls the unconditional `MigrateLegacyOptions` and prints `migrated legacy options on <name>` / nothing extra when clean (data sink). Every call site is already behind the `IsManagedServer` gate and SHALL stay behind it. API paths that report `changed == true` SHALL wake the SSE hub for that server (`s.initSSEHub(); s.sseHub.wake(server)`), except the reload-config handler where the existing hub is used the same way; `RefreshSweep` (daemon start, no clients) does not wake.

- **GIVEN** a managed server with legacy options → **WHEN** a browser attaches a terminal → **THEN** the sweep runs once and the sidebar repaints without waiting for the 12s safety poll
- **GIVEN** an external (unmanaged) server → **WHEN** attached → **THEN** no sweep runs
- **GIVEN** `rk mux adopt s` on an unmanaged server with a session-scoped `@color` → **THEN** after adoption `@color` is gone from the session

#### R9: `rk doctor` legacy-options row
`cmd/rk/doctor.go` SHALL add `legacyOptionsCheck()` — always OK-shaped — that enumerates live servers via `internal/tmux`'s `CountLegacyOptions(ctx, server) (int, error)` (shares the table and scope walk with the migrator; only live servers via `ListServers`). Note shapes: `none`; `N server(s) still carry legacy option names (@color/@session_color) — attach from the dashboard or run \`rk mux adopt <server>\` to sweep`; with external servers present append `, of which M external — rk will not rewrite those`; enumeration failure → `skipped — enumeration failed: …`. Seam var `legacyOptionsScan` for tests; `--json` carries the note verbatim.

- **GIVEN** no server carries legacy names → **THEN** note is `none`, `OK: true`
- **GIVEN** 2 servers carry legacy names, 1 unmanaged → **THEN** note names `2 server(s)` and `1 external`, `OK: true`

### Docs: Registry and Memory

#### R10: Option registry reflects the new names and the migration
`docs/memory/run-kit/tmux-sessions.md` § Server-Scoped User Options SHALL list `@rk_win_color` / `@rk_ses_color` (Legacy-names column added: `@color`, `@session_color`), state the naming rule, and carry a § Legacy Option Migration describing the table, right-scope-move/wrong-scope-purge algorithm, once-guard, hook seams, and doctor row. `layout-snapshots.md`, `operator-actuation.md`, `architecture.md` (§ Dual storage), `ui/routes-and-shell.md`, `ui/visual-design.md`, `daemon-lifecycle.md`, `api-and-sockets.md` SHALL name the new keys (present-truth, no rename narration). Hydrate owns these edits; apply owns the e2e `.spec.md` companion only.

- **GIVEN** `grep -rn '@color\b\|@session_color' docs/memory` after hydrate → **THEN** the only hits are in the registry's Legacy-names column / migration section and `log*.md`

### Non-Goals
- Renaming the other 20 `@rk_*` options (plan Changes 2–3) and the fab-kit reader (Change 4).
- Dual-accepting `@color` on `POST /options`.
- Copying a wrong-scope legacy value forward.
- Purging the *new* names at wrong scopes.
- Persisting migration state on disk.

### Design Decisions

#### Sweep hooks at ReloadConfig seams, not a periodic loop
**Decision**: run `MigrateLegacyOptionsOnce` wherever rk already reloads its managed conf onto a server (daemon start sweep, pre-attach, adopt, reload endpoint).
**Why**: `RefreshSweep` only runs after a force-written stale conf; the pre-attach reload is the seam that touches every server a user opens, so it is the de-facto cadence. Reusing the managed gate keeps rk from rewriting options on servers it did not birth.
**Rejected**: a ticker in the SSE hub — adds a background tmux write path with no managed gate of its own.
*Introduced by*: 260828-b71j-tmux-option-namespace-legacy-sweep

#### Once-guard marks on attempt
**Decision**: the per-daemon guard records a server before the sweep runs.
**Why**: a server whose sweep fails would otherwise be re-swept on every attach; `rk mux adopt` and a daemon restart are the explicit retry paths.
**Rejected**: mark on success — retry storms on a broken server.
*Introduced by*: 260828-b71j-tmux-option-namespace-legacy-sweep

## Tasks

### Phase 1: Setup

- [x] T001 Add `ColorOption`/`SessionColorOption` constants in `app/backend/internal/tmux/tmux.go`; replace every `"@color"`/`"@session_color"`/`#{@color}`/`#{@session_color}` literal and comment in `tmux.go`, `layout.go`, `board.go` (if any), `internal/snapshot/restore.go`, `internal/snapshot/snapshot.go`, `internal/sessions/sessions.go`, `api/windows.go` (`optKeyColor = tmux.ColorOption`), `api/sessions.go`, `api/sse.go`, `api/operator.go` (prompt text + comment). Update Go tests that assert the literals: `tmux_test.go`, `windows_test.go`, `operator_test.go`, `snapshot/restore_test.go`, `snapshot/integration_test.go`. Run `cd app/backend && go test ./internal/tmux/... ./internal/snapshot/... ./api/...`. <!-- R1 R2 R4 R5 -->
- [x] T002 [P] Frontend: `app/frontend/src/api/client.ts` `setWindowColor` posts `@rk_win_color`; update comments in `client.ts` and `types.ts`; re-point `client.test.ts` assertions (3 sites); update `tests/e2e/window-marker-gutter.spec.ts` (`@color` → `@rk_win_color`, ~4 sites) and its `.spec.md` companion. Run `cd app/frontend && npx tsc --noEmit && npx vitest run src/api/client.test.ts`. <!-- R3 -->

### Phase 2: Core Implementation

- [x] T003 Create `app/backend/internal/tmux/legacy_options.go`: `optionScope` enum with set-option flag + carrier enumeration, `legacyOption` row type, `legacyOptions` table (2 rows), `MigrateLegacyOptions(ctx, server) error` implementing right-scope move + wrong-scope purge (incl. global `-g`) with per-step `slog.Info`, per-carrier `slog.Warn` + continue, first-error return, `=name:` session targets, all calls via `tmuxExecServer`/`tmuxExecRawServer`. Also `CountLegacyOptions(ctx, server) (int, error)` sharing the walk. <!-- R6 R9 --> <!-- rework: sweep entry points and CountLegacyOptions apply no TmuxTimeout (review must-fix) -->
- [x] T004 Add `MigrateLegacyOptionsOnce(ctx, server) (changed bool, err error)` with an in-memory attempt-marking guard and a test reset helper, in `legacy_options.go`. <!-- R7 -->
- [x] T005 Write `app/backend/internal/tmux/legacy_options_test.go` on a real isolated test socket (follow `withSessionOrderTmux`/`windowOption` helpers): right-scope window + session moves; session-level `@color` purged with no copy; global `@color` purged; new-already-set keeps new; second run issues zero set-option calls (assert via `show-options` diff or a counting seam); one-carrier failure isolates; `Once` runs body exactly once under concurrent calls; `CountLegacyOptions` counts. Run `go test ./internal/tmux/ -run 'Legacy'`. <!-- R6 R7 -->

### Phase 3: Integration & Edge Cases

- [x] T006 Hook the sweep: `internal/tmux/managedconf.go` `RefreshSweep` (seam `sweepMigrateLegacy`), `api/terminals_ws.go` `reloadConfigForAttach` (seam `attachMigrateLegacy`; wake hub when changed), `api/servers.go` adopt handler + `api/tmux_config.go` reload handler (seam vars; wake hub when changed), `cmd/rk/mux_adopt.go` (`muxAdoptMigrateLegacyFn`, unconditional, prints `migrated legacy options on <name>` when changed). All behind the existing managed gates. Add/extend tests: `managedconf_test.go`, `terminals_ws_test.go` (or the existing pre-attach reload test), `servers_test.go`, `tmux_config_test.go`, `mux_adopt_test.go` — assert the seam is called for managed and NOT for external servers. <!-- R8 --> <!-- rework: run the once-guarded sweep off the request/attach goroutine (review should-fix, 5s route budget) --> <!-- rework 2: async hooks double-take the once-guard (Mark + Once) so pre-attach and reload-config never sweep (review must-fix) -->
- [x] T007 `cmd/rk/doctor.go`: add `legacyOptionsCheck()` with seam `legacyOptionsScan` (returns per-server counts + managed flag), wired into `runDoctorChecks` after `ephemeralServersCheck`; `doctor_test.go`: note shapes (none / N servers / external suffix / enumeration failure) and never-flips-verdict. <!-- R9 --> <!-- rework: tolerate a single failing server in legacyOptionsScan (review nice-to-have, cheap) -->
- [x] T008 e2e regression for the bug: in `app/frontend/tests/e2e/window-marker-gutter.spec.ts` (or a new `legacy-color-sweep.spec.ts` + `.spec.md`), seed a session-scoped `@color` via `tmux -L $SERVER set-option -t =<session>: @color 1+3` before attach, attach, assert no window row in that session carries a color tint and that the picker's clear leaves the row uncolored; run `just test-e2e "window-marker-gutter"` (never raw playwright). Mark the server managed in the fixture if the e2e server is not already (check `_tmux.ts`). <!-- R6 R8 -->

### Phase 4: Polish

- [x] T009 Full gates: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit && npx vitest run`; final literal sweep `grep -rn '"@color"\|"@session_color"\|#{@color}\|#{@session_color}' app/backend app/frontend/src app/frontend/tests` shows only `legacy_options*.go`, its tests, and the e2e seed. <!-- R1 -->

## Execution Order

- T001 blocks T003 (constants) and T006 (allowlist/handlers compile)
- T003 blocks T004, T005, T006, T007
- T008 after T006 (the sweep must be wired for attach to heal the seeded option)

## Acceptance

### Functional Completeness

- [x] A-001 R1: `tmux.ColorOption == "@rk_win_color"`, `tmux.SessionColorOption == "@rk_ses_color"`; no bare `@color`/`@session_color` literal remains in production Go/TS outside `legacy_options*.go`
- [x] A-002 R2: `optKeyColor` is `tmux.ColorOption`; `@color` in a POST body yields 400 and zero tmux calls
- [x] A-003 R3: `setWindowColor` posts `@rk_win_color`; `client.test.ts` asserts it
- [x] A-004 R4: color-tabs prompt names `@rk_win_color` in set, unset, and Bounds lines
- [x] A-005 R5: `windowOptionOps` emits `@rk_win_color`; restore script test literal updated
- [x] A-006 R6: `MigrateLegacyOptions` exists, table-driven, two rows, right-scope move + wrong-scope purge incl. global
- [x] A-007 R7: `MigrateLegacyOptionsOnce` marks on attempt, in-memory only, returns `changed`
- [x] A-008 R8: sweep wired at RefreshSweep, pre-attach, adopt (API + CLI), reload-config — all behind managed gates; hub woken when changed on API paths. Rework cycle 2 fixed the cycle-1 double-mark: the async seams now default to the non-re-marking `tmux.MigrateLegacyOptionsReport` and call holders take `tmux.MarkLegacyMigrationAttempt` synchronously before spawning (`terminals_ws.go:411`, `tmux_config.go:52`); RefreshSweep/API-adopt use the self-marking `Once`; the CLI uses unconditional `Report`. Verified end to end with no seam substitution: the e2e `legacy-color-sweep` spec drives `POST /api/tmux/reload-config` and the daemon log shows `legacy option sweep: purged wrong-scope` at session scope on first call
- [x] A-009 R9: `rk doctor` shows a `legacy tmux options` row with the specified note shapes; always OK

### Behavioral Correctness

- [x] A-010 R6: a session-scoped `@color` is removed and nothing is copied to windows
- [x] A-011 R6: a window with both old and new set keeps the new value
- [x] A-012 R6: second run is a no-op (zero set-option calls)
- [x] A-013 R8: external servers are never swept

### Scenario Coverage

- [x] A-014 R6: unit tests on a real test socket cover every GIVEN in R6
- [x] A-015 R8: seam tests prove each hook calls the sweep for managed and skips external
- [x] A-016 R8: e2e seeds a session-scoped legacy `@color`, attaches, and asserts the rows are untinted and the purge copies nothing forward — `just test-e2e "legacy-color-sweep"` passes (1/1, 7.4s) against a scratch managed server; the cycle-1 blocker was the A-008 double-mark, now resolved (see A-008)

### Edge Cases & Error Handling

- [x] A-017 R6: a failing carrier logs Warn and the remaining carriers are still processed; first error returned
- [x] A-018 R7: concurrent `Once` calls run the body exactly once
- [x] A-019 R9: enumeration failure yields `skipped — …`, still OK

### Code Quality

- [x] A-020 Pattern consistency: seam vars follow the `sweepReloadConfig`/`attachReloadConfig`/`muxAdopt*Fn` pattern; doctor row follows `ephemeralServersCheck`
- [x] A-021 No unnecessary duplication: `CountLegacyOptions` shares the table and scope walk with the migrator; no second enumeration implementation
- [x] A-022 All subprocess calls via `exec.CommandContext` argv helpers with `TmuxTimeout`; no shell strings
- [x] A-023 No magic strings: option names via constants; `@color`/`@session_color` appear only in the migration table
- [x] A-024 Comments state constraints/invariants, no narration or change-ID citations
- [x] A-025 Tests cover added behavior (unit + seam + e2e); `.spec.md` companion updated where steps changed

### Security

- [x] A-026 R2: the `/options` allowlist remains a closed set; no client-supplied key reaches tmux unvalidated

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — re-review (rework cycle 2) agrees with prior cycles: the rename was done in place (no orphaned code) and the sweep machinery is purely additive. One deferred item for hydrate, not a blocking candidate: `docs/memory/run-kit/tmux-sessions.md:319`'s registry row reads `@color` — plan R10 assigns registry/memory edits to the hydrate stage, so it is out of apply scope here.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Global scope (`set -g`) is included in the wrong-scope purge | tmux resolves pane→window→session→global; a global `@color` would tint everything just like the session case | S:70 R:90 A:85 D:80 |
| 2 | Confident | `Once` returns `(changed, err)` so API paths can wake the hub selectively | Avoids a hub wake on every attach; adopt handler already has the wake pattern | S:65 R:90 A:85 D:75 |
| 3 | Confident | `rk mux adopt` runs the unconditional sweep (not `Once`) and prints only when something changed | CLI is the operator's explicit retry; a silent clean run matches the toolkit's quiet-success posture | S:60 R:90 A:80 D:70 |
| 4 | Tentative | e2e regression added to `window-marker-gutter.spec.ts` rather than a new spec | Same fixture and surface; a new spec is fine if the fixture needs a managed-server seam | S:50 R:95 A:65 D:60 |
| 5 | Tentative | `CountLegacyOptions` returns a plain int per server; doctor seam returns `[]struct{Server string; Count int; Managed bool}` | Smallest shape that supports the external-suffix note | S:50 R:95 A:70 D:65 |

5 assumptions (0 certain, 3 confident, 2 tentative).

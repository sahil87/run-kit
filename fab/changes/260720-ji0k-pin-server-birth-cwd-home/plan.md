# Plan: Pin rk-birthed tmux Server CWD to $HOME

**Change**: 260720-ji0k-pin-server-birth-cwd-home
**Intake**: `intake.md`

## Requirements

### tmux: Shared Server-Birth Directory Helper

#### R1: ServerBirthDir helper
`internal/tmux` MUST expose an exported helper `ServerBirthDir() string` that returns `os.UserHomeDir()`, falling back to `/` when `UserHomeDir` errors. `/` always exists and can never dangle, mirroring tmux ≤ 3.6a's own child-side fallback chain (target → `$HOME` → `/`). All four pin seams (R2–R5) resolve their directory through this single helper.

- **GIVEN** a process with a resolvable home directory
- **WHEN** `ServerBirthDir()` is called
- **THEN** it returns the home directory path
- **AND** when `os.UserHomeDir()` errors (e.g. `$HOME` unset/empty), it returns `/`

#### R2: Daemon server birth pinned to home
`internal/daemon.startSession` MUST set the working directory of the `tmux new-session` exec that creates the rk-daemon server to `ServerBirthDir()`. The pin MUST land on the actual `exec.CommandContext` (a dir-carrying variant of the shared `runTmux` helper), preserving the file's existing pattern: `exec.CommandContext`, `cmdTimeout`, stderr-capture-into-error.

- **GIVEN** `rk daemon start` is run from a git worktree that will later be deleted
- **WHEN** `startSession` creates the rk-daemon tmux server
- **THEN** the birthing tmux client (and therefore the server process it daemonizes) runs with CWD = the operator's home, so the server never sits on the worktree's inode
- **AND** the daemon session's default start directory (and thus the inner `rk serve`'s CWD) is home — safe because `rk serve` is CWD-independent (`config.Load` reads env vars only; the exe path is absolute)

#### R3: CreateSession birth path pinned to home
`internal/tmux.CreateSession`'s `new-session` exec (routed through `runTmuxWithEnv`) MUST run with working directory `ServerBirthDir()`. `runTmuxWithEnv` — which already carries the optional env override — is the seam that carries the dir. `CreateSession`'s doc comment (currently env-only "born with the operator's from-home environment") MUST be updated to cover the CWD pin as the symmetric other half of that contract.

- **GIVEN** rk serving from a directory that later gets deleted
- **WHEN** `CreateSession` first-touches a socket and births a user-facing tmux server
- **THEN** the server process's CWD is the operator's home, independent of rk's own CWD
- **AND** an explicit `cwd` argument still lands as `-c <cwd>` on the session itself (the `cmd.Dir` pin only anchors the server process / default start dir)

#### R4: createAnchor birth hygiene (dir + env)
`internal/tmuxctl.createAnchor`'s `new-session` exec MUST (a) set `cmd.Dir` to the home dir and (b) route its environment through the same sanitization `CreateSession` uses — requiring `cleanEnvForServer` to be exported from `internal/tmux` as `CleanEnvForServer()` (tmuxctl already imports `internal/tmux`; no import cycle — `tmux` imports only `validate`/stdlib/`rk/build`). The existing stderr-capture-into-error behavior MUST be preserved (load-bearing for `isDuplicateSessionError`, change 260602-a1wo).

- **GIVEN** the reconnect FSM dials a socket where `createAnchor`'s `new-session` births/resurrects a server
- **WHEN** the anchor session is created
- **THEN** the born server's CWD is home and its environment is the sanitized from-home environment (no `RK_*`/`DIRENV_*` leakage)
- **AND** a concurrent-rk "duplicate session" error still surfaces its stderr text so `isDuplicateSessionError` treats it as benign

#### R5: Pin-session `session_path` hygiene via `-c`
`internal/tmux/board.go` `Pin`'s `new-session` that creates the `_rk-pin-<id>` session MUST pass `-c <ServerBirthDir()>`. Distinct mechanism from R2–R4: the server already exists at Pin time, so this is `session_path` hygiene via the tmux `-c` flag, not a server-birth `cmd.Dir` pin.

- **GIVEN** a live tmux server whose own CWD may be arbitrary
- **WHEN** a window is pinned and `_rk-pin-<id>` is created
- **THEN** the pin-session's `session_path` is the operator's home and can never dangle

#### R6: Tests per package
Each affected package MUST gain Go tests covering the new behavior, following that package's existing patterns: pure unit tests where the command construction is observable (helper return values, built `*exec.Cmd`), and real-tmux integration tests on isolated `rk-test-*` sockets (skipping when tmux is absent) asserting the observable effect (`#{session_path}`).

- **GIVEN** the test suite runs on a host with tmux
- **WHEN** the birth seams execute against isolated test sockets
- **THEN** the created sessions'/servers' directories are observably home (or the injected test dir for the seam-level test)

### Non-Goals

- wt-side pinning (separate repo), upstream tmux 3.7 bug report, UI surfacing of dangling `session_path`s, remediation of already-affected live servers — all explicitly out of scope per the intake.
- Env sanitization for the daemon server birth — the rk-daemon server intentionally carries rk's environment (the inner `rk serve` reads `RK_PORT`/`RK_HOST`/`RK_DAEMON_LOG` from it); only `createAnchor` gains sanitization (the asymmetry the intake names).

### Design Decisions

#### Share the home-dir rule as `tmux.ServerBirthDir()`
**Decision**: Export a single `ServerBirthDir()` from `internal/tmux` and consume it from `daemon`, `tmuxctl`, `board.go`, and `CreateSession`.
**Why**: The intake defines one shared resolution rule ($HOME, fallback `/`); code-quality.md bans duplicating utilities. `tmuxctl` already imports `tmux`; `daemon` → `tmux` adds no cycle (`tmux` imports only `validate`/stdlib/`rk/build`) and is runtime-neutral (cmd/rk already links `tmux`, so its `init()` TMUX-strip already applies to the binary).
**Rejected**: Per-package private copies — three duplicated 4-line helpers with drift risk.
*Introduced by*: 260720-ji0k-pin-server-birth-cwd-home

#### Daemon seam: dir-carrying `runTmux` variant
**Decision**: Add `runTmuxInDir(ctx, dir, args...)` in `daemon.go`; `runTmux` delegates with `dir=""`; `startSession` calls the variant with `ServerBirthDir()`.
**Why**: Keeps the pin on the actual `exec.CommandContext` while preserving the file's `runTmux`/`runTmuxOutput` pattern (context timeout, stderr capture) exactly as the intake mandates.
**Rejected**: Building the command directly in `startSession` — duplicates the stderr-capture plumbing.
*Introduced by*: 260720-ji0k-pin-server-birth-cwd-home

#### tmuxctl seam: extracted `anchorCommand` builder
**Decision**: Extract `createAnchor`'s command construction into `anchorCommand(ctx, socket) (*exec.Cmd, *bytes.Buffer)` that sets `Dir`, `Env`, and wires the stderr buffer; `createAnchor` runs it.
**Why**: Makes the dir/env/stderr wiring unit-assertable without a live tmux server (tmuxctl's FSM tests are fake-dial; its integration tests need live servers), matching the intake's "assert cmd.Dir on the built command" test shape.
**Rejected**: Inline mutation with integration-only coverage — leaves the env sanitization unasserted (session env of an already-live server is not observably changed by a joining client).
*Introduced by*: 260720-ji0k-pin-server-birth-cwd-home

## Tasks

### Phase 1: Setup

- [x] T001 Add exported `ServerBirthDir()` helper (home, fallback `/`) and export `cleanEnvForServer` as `CleanEnvForServer()` (updating its internal caller) in `app/backend/internal/tmux/tmux.go` <!-- R1, R4 -->

### Phase 2: Core Implementation

- [x] T002 Extend `runTmuxWithEnv` with a `dir` parameter, pass `ServerBirthDir()` from `CreateSession`, and update `CreateSession`'s doc comment to cover the CWD half of the from-home birth contract in `app/backend/internal/tmux/tmux.go` <!-- R3 -->
- [x] T003 [P] Add `runTmuxInDir(ctx, dir, args...)` (with `runTmux` delegating) and pin `startSession`'s new-session to `tmux.ServerBirthDir()` in `app/backend/internal/daemon/daemon.go` <!-- R2 -->
- [x] T004 [P] Extract `anchorCommand(ctx, socket)` setting `cmd.Dir = tmux.ServerBirthDir()` and `cmd.Env = tmux.CleanEnvForServer()` with the stderr buffer preserved; use it from `createAnchor` in `app/backend/internal/tmuxctl/client.go` <!-- R4 -->
- [x] T005 [P] Append `-c <ServerBirthDir()>` to `Pin`'s pin-session `new-session` argv in `app/backend/internal/tmux/board.go` <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T006 Tests in `app/backend/internal/tmux/tmux_test.go`: unit `TestServerBirthDir` (home + `/` fallback via `t.Setenv`), integration `TestCreateSession_ServerBirthCwdIsHome` (fresh isolated socket, empty cwd, `#{session_path}` == home) <!-- R1, R3, R6 -->
- [x] T007 [P] Test in `app/backend/internal/tmux/board_test.go`: `TestPin_PinSessionPathIsHome` asserting the `_rk-pin-*` session's `#{session_path}` == `ServerBirthDir()` <!-- R5, R6 -->
- [x] T008 [P] Tests in `app/backend/internal/daemon/daemon_test.go`: `runTmuxInDir` integration (new-session with injected temp dir → `#{session_path}` matches) and `startSession` end-to-end with a temp sleep-script exe asserting the daemon session's `#{session_path}` == home on the test socket <!-- R2, R6 -->
- [x] T009 [P] Test in `app/backend/internal/tmuxctl/client_test.go`: `TestAnchorCommand` asserting `Dir` == `tmux.ServerBirthDir()`, env free of `RK_*`/`DIRENV_*` (with sentinels set via `t.Setenv`), argv shape unchanged, and the stderr buffer wired to the cmd <!-- R4, R6 -->

### Phase 4: Polish

- [x] T010 Run `just test-backend` and fix any fallout (existing tmuxctl integration tests exercise `createAnchor` against live servers; daemon tests exercise `runTmux` callers) <!-- R6 -->

## Execution Order

- T001 blocks T002–T005 (all consume `ServerBirthDir`/`CleanEnvForServer`)
- T006–T009 are independent of each other once T002–T005 land
- T010 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `tmux.ServerBirthDir()` exists, returns the home dir, and falls back to `/` when `os.UserHomeDir()` errors; all four seams resolve through it
- [x] A-002 R2: `daemon.startSession`'s new-session exec runs with `cmd.Dir` = home via a dir-carrying `runTmux` variant that preserves the existing timeout + stderr-capture pattern
- [x] A-003 R3: `tmux.CreateSession`'s new-session exec runs with `cmd.Dir` = home via the extended `runTmuxWithEnv`, and its doc comment covers the CWD pin
- [x] A-004 R4: `tmuxctl.createAnchor`'s new-session exec has `cmd.Dir` = home and `cmd.Env` = `tmux.CleanEnvForServer()`, with stderr capture intact
- [x] A-005 R5: `board.go` `Pin` passes `-c <home>` on the pin-session `new-session`

### Behavioral Correctness

- [x] A-006 R3: A server birthed by `CreateSession` from an arbitrary rk CWD has CWD/home `session_path` = home (integration-verified on an isolated socket)
- [x] A-007 R4: The concurrent-rk duplicate-anchor race remains benign (`isDuplicateSessionError` still sees the stderr text; existing integration tests pass unchanged)

### Scenario Coverage

- [x] A-008 R6: Each affected package (`tmux`, `daemon`, `tmuxctl`) has tests covering its seam, following that package's existing test patterns (pure builders unit-tested; real-tmux effects integration-tested on `rk-test-*` sockets with tmux-absent skips)

### Edge Cases & Error Handling

- [x] A-009 R1: With `$HOME` unresolvable, `ServerBirthDir()` returns `/` (never an empty string, which would make `cmd.Dir`/`-c` a no-op or error)

### Code Quality

- [x] A-010 Pattern consistency: New code follows surrounding conventions (argv slices, `exec.CommandContext` + timeouts per Constitution I / Process Execution, stderr-in-error folding)
- [x] A-011 No unnecessary duplication: the home-dir rule and env sanitization each live in exactly one place (`ServerBirthDir` / `CleanEnvForServer`), shared across packages
- [x] A-012 No shell strings: all touched call sites remain explicit argument slices; no new state introduced (Constitution I, II)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change is purely additive server-birth hygiene (a shared `ServerBirthDir()` helper, an exported `CleanEnvForServer()`, a dir-carrying `runTmuxInDir`, an extracted `anchorCommand` builder, and one `-c` arg). It makes no existing file, function, branch, or config redundant; the `cleanEnvForServer`→`CleanEnvForServer` rename is an in-place export (same single body), not a duplication.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Share the helper by exporting `tmux.ServerBirthDir()` + `tmux.CleanEnvForServer()`; `daemon` gains an `rk/internal/tmux` import | Intake deferred the sharing mechanism to the plan; verified no import cycle (`tmux` imports only `validate`/stdlib/`rk/build`) and runtime-neutral init (cmd/rk already links `tmux`) | S:80 R:85 A:90 D:85 |
| 2 | Certain | Daemon pin lands via a `runTmuxInDir` variant of the shared helper, not a direct build at the call site | Intake offered both shapes; the variant preserves the mandated `runTmux` pattern (timeout, stderr capture) with zero duplication | S:80 R:90 A:90 D:85 |
| 3 | Certain | Daemon env is NOT sanitized — only `createAnchor` gains `CleanEnvForServer` | Intake scopes env changes to seam 3 only; the inner `rk serve` requires `RK_*` vars from the daemon session env, so sanitizing there would break config | S:85 R:80 A:95 D:90 |
| 4 | Confident | Pinning the daemon session's start dir to home (a side effect of `cmd.Dir` on the birthing client) is safe for the inner `rk serve` | Verified `config.Load` is env-only (no `.env` read from cwd in Go) and the exe path is absolute; intake states no rk feature depends on birth-time CWD | S:75 R:75 A:85 D:80 |
| 5 | Confident | Test shape: pure builder/unit tests where construction is observable (`anchorCommand`, `ServerBirthDir`) + real-tmux `#{session_path}` integration asserts on isolated `rk-test-*` sockets | Matches each package's existing patterns (tmux/board/daemon use real-tmux sockets; tmuxctl unit-tests non-FSM helpers); `session_path` is the direct observable of the client-cwd/`-c` effect | S:70 R:85 A:85 D:75 |

5 assumptions (3 certain, 2 confident, 0 tentative).

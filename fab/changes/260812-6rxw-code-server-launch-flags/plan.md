# Plan: Curated Launch Flags for the Daemon-Managed code-server Spawn

**Change**: 260812-6rxw-code-server-launch-flags
**Intake**: `intake.md`

## Requirements

### Daemon: code-server launch flags

#### R1: Curated flag set appended to the managed spawn argv
The args slice built in `ensureCodeServer` (`app/backend/internal/daemon/codeserver.go`) MUST append exactly five flags after `--auth none`, in this order: `--disable-telemetry`, `--disable-update-check`, `--disable-workspace-trust`, `--disable-getting-started-override`, `--app-name run-kit`. The value-taking flag MUST ride the explicit argument slice as two elements (`"--app-name", "run-kit"`). The argv MUST remain an explicit argument slice through `runTmux` / `exec.CommandContext` — no shell strings (Constitution I).

- **GIVEN** a daemon start where no `rk-code-server` session exists, the resolved port is free, and the `code-server` binary is on PATH
- **WHEN** `ensureCodeServer` spawns the sibling session
- **THEN** the spawn argv ends with `code-server --bind-addr 127.0.0.1:{port} --auth none --disable-telemetry --disable-update-check --disable-workspace-trust --disable-getting-started-override --app-name run-kit`

#### R2: Idempotency ladder and skip branches unchanged
Everything upstream of the args slice MUST be untouched: the session-exists silent skip, the port resolution, the `portInUse` externally-managed skip, the missing-binary warn-and-continue, and the `env -u VSCODE_IPC_HOOK_CLI` strip. rk curates flags only for instances it spawns.

- **GIVEN** any skip branch of the idempotency ladder (session exists / port listening / binary absent / degenerate port)
- **WHEN** `ensureCodeServer` runs
- **THEN** behavior is identical to before this change (zero spawns, same log lines), and the existing skip-branch tests pass unmodified

#### R3: Exact-argv test coverage of the new flag set
`TestEnsureCodeServerSpawnsSiblingSession` (`app/backend/internal/daemon/codeserver_test.go:48`) MUST assert the full new argv via its existing exact-joined-string comparison against the `codeServerSpawn` seam, ending in the five flags.

- **GIVEN** the updated `want` string in `TestEnsureCodeServerSpawnsSiblingSession`
- **WHEN** `go test ./internal/daemon/` runs
- **THEN** the exact-argv assertion covers the five appended flags and all tests in the package pass

### Non-Goals

- `--idle-timeout-seconds` — must NOT be added: server-side terminals and hot-exit state live in the code-server process; persistence is the point of the sibling-session design (codeserver.go:12-23, 260811-a2bo).
- `-e`/`--ignore-last-opened` — unnecessary; the `/code` route drives the folder via URL.
- "Build with Agent" chat-panel suppression — no CLI flag in this build (settings-only `chat.disableAIFeatures`); captured as backlog idea 71bv (rk-owned `--user-data-dir` seeded settings.json).
- Restart/re-flag mechanism for an already-running `rk-code-server` session — new flags take effect on the next fresh spawn; inherent to the existing idempotent design.

### Design Decisions

#### Flags-only curation at the spawn site
**Decision**: Curate the managed editor exclusively through CLI flags appended to the `ensureCodeServer` argv — the five-flag set verified against installed code-server 4.112.0 (Code 1.112.0) on 2026-08-12.
**Why**: Flags are the smallest, most legible lever: an argv-only change at the single spawn site rk already owns, with an existing test seam capturing the exact argv. `--disable-workspace-trust` is the only trust mechanism code-server offers (no auto-accept flag exists); disabling the feature makes every workspace implicitly trusted, which is correct because the `/code` lens only opens rk-managed worktrees.
**Rejected**: An rk-owned `--user-data-dir` with a seeded settings.json (needed only for settings-gated behavior like the chat panel — deferred to backlog 71bv); mutating the user's default-profile settings.json from rk (intrusive, clobbers the user's personal code-server profile).
*Introduced by*: 260812-6rxw-code-server-launch-flags

## Tasks

### Phase 2: Core Implementation

- [x] T001 Append `--disable-telemetry`, `--disable-update-check`, `--disable-workspace-trust`, `--disable-getting-started-override`, `"--app-name", "run-kit"` after `"--auth", "none"` in the args slice in `ensureCodeServer` (`app/backend/internal/daemon/codeserver.go`); extend the function doc comment's launch description to name the curated-flags posture <!-- R1 -->
- [x] T002 Update the `want` argv string in `TestEnsureCodeServerSpawnsSiblingSession` (`app/backend/internal/daemon/codeserver_test.go:48`) to the full new argv ending in the five flags; leave `TestEnsureCodeServerConventionPort` and the skip-branch tests untouched <!-- R3 -->
- [x] T003 Run `go test ./internal/daemon/` from `app/backend/` and confirm the whole package passes (exact-argv test green, skip-branch tests unmodified and green) <!-- R2 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The spawn argv built by `ensureCodeServer` ends with `--auth none --disable-telemetry --disable-update-check --disable-workspace-trust --disable-getting-started-override --app-name run-kit`, with `--app-name` and `run-kit` as two separate slice elements
- [x] A-002 R3: `TestEnsureCodeServerSpawnsSiblingSession`'s `want` string asserts the exact full argv including all five flags

### Behavioral Correctness

- [x] A-003 R2: All skip branches (session-exists, port-listening, binary-missing, degenerate-port) are byte-identical to before — no logic outside the args slice and doc comment changed

### Scenario Coverage

- [x] A-004 R3: `go test ./internal/daemon/` passes; the skip-branch tests (`SkipsWhenSessionExists`, `SkipsWhenPortListening`, `WarnsAndContinuesWhenBinaryMissing`, `SpawnFailureNeverPropagates`, `ConventionPort`) pass without modification

### Code Quality

- [x] A-005 Pattern consistency: The appended flags follow the existing slice's style (boolean flags as single elements, value flags as two elements, one flag group per line matching gofmt)
- [x] A-006 No shell strings: The spawn still flows through `runTmux` → `exec.CommandContext` with an explicit argument slice (Constitution I; code-quality.md anti-pattern "shell string construction")

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Extend the `ensureCodeServer` doc comment (codeserver.go:56-61) to mention the curated flags alongside the existing loopback/auth-none line, rather than leaving it silent about them | The comment already documents the launch posture ("Loopback-only + --auth none: the rk origin is the trust boundary"); adding flags without updating it would leave the comment stale — trivially reversible, one obvious default | S:70 R:95 A:90 D:85 |

1 assumptions (1 certain, 0 confident, 0 tentative).

# Plan: Doctor tmux Drift Note

**Change**: 260819-a8bf-doctor-tmux-drift-note
**Intake**: `intake.md`

## Requirements

### internal/tmux: Version Parse & Comparison

#### R1: Bare-token version parse
`ParseVersion` SHALL be refactored so the version-token grammar (`(\d+)\.(\d+)[a-z]*`) lives in one place consumed by two entry shapes: the existing `tmux -V` client output (`tmux 3.2a`) and the bare `#{version}` format-variable output (`3.2a`). The bare-token parse is an unexported helper (`parseVersionToken`); `ParseVersion` delegates to it after matching the `tmux ` prefix. Non-release strings (e.g. `next-3.7`, empty output) remain unknown — `(Version{}, false)`, never an error.

- **GIVEN** the string `3.2a` (a bare `#{version}` token)
- **WHEN** the token parser runs
- **THEN** it returns `Version{Major: 3, Minor: 2, Raw: "3.2a"}, true`

- **GIVEN** the string `tmux 3.4` (client `-V` output)
- **WHEN** `ParseVersion` runs
- **THEN** it returns `Version{Major: 3, Minor: 4, Raw: "3.4"}, true` exactly as before the refactor

- **GIVEN** the string `next-3.7` or an empty string
- **WHEN** either parser runs
- **THEN** it returns `(Version{}, false)`

#### R2: Server-version probe
`ServerVersion(ctx, server) (Version, bool)` SHALL probe a **running** tmux server's version via `display-message -p '#{version}'` targeted with the existing `serverArgs(server)` prefix (`-L <name>`, bare for `"default"`), executed through the `RunOutput` runner core (argv slice, caller-owned ctx per the runner-core contract — Constitution §I). Any failure (dead socket, timeout, no sessions, unparseable output) is unknown — `(Version{}, false)`, never an error, mirroring `CurrentVersion`.

- **GIVEN** a live server whose `display-message -p '#{version}'` prints `3.2a`
- **WHEN** `ServerVersion(ctx, name)` runs
- **THEN** it returns `Version{Major: 3, Minor: 2, Raw: "3.2a"}, true`

- **GIVEN** a server that dies between enumeration and probe, or reports a non-release string
- **WHEN** `ServerVersion` runs
- **THEN** it returns `(Version{}, false)` and the caller silently skips that server

#### R3: OlderThan comparison
`Version.OlderThan(other Version) bool` SHALL report strict major.minor ordering (receiver strictly older than `other`). Letter suffixes are ignored — a suffix-only difference (3.2 vs 3.2a) is NOT older. This is the drift predicate: drift fires only when the binary is **strictly newer** than the server.

- **GIVEN** server `3.2a` and binary `3.5`
- **WHEN** `server.OlderThan(binary)` runs
- **THEN** it returns true

- **GIVEN** server `3.2` and binary `3.2a` (suffix-only difference)
- **WHEN** `server.OlderThan(binary)` runs
- **THEN** it returns false

- **GIVEN** server `3.5` and binary `3.4` (server ahead — e.g. downgraded binary)
- **WHEN** `server.OlderThan(binary)` runs
- **THEN** it returns false (drift is one-directional; a newer server never warns)

### cmd/rk: Doctor Drift Note

#### R4: Drift note on the doctor tmux row
`tmuxVersionCheck()` SHALL, when the binary version probe succeeds, enumerate live servers via `tmux.ListServers` (the existing live-server derivation — never spawning a server; a socket that fails the probe is silently skipped) and probe each with `ServerVersion`. For every server whose version is strictly older than the binary (R3), the tmux row's `Note` gains a drift sentence naming the socket:
`tmux {binary.Raw} installed but running server "{name}" is {server.Raw} — restart your tmux server when convenient to pick it up (kills its sessions; pick a quiet moment)`.
Shape rules (all MUST hold):
- **Warn-shaped only**: the row stays `OK: true` regardless of drift (the code-server precedent); drift never fails doctor.
- **Doctor-only surface**: no change to daemon start or `rk serve` startup warnings.
- **No auto-restart, ever** (Constitution §VI) — the note is purely informational.
- Drift sentences are **appended** to the existing note (plain version or below-floor `UpgradeHint`), joined with `"; "`; the base note stays first and unchanged.
- When the **binary** version is unknown, the server sweep is skipped entirely (no comparand; unknown never warns) — the row is byte-identical to today.
- A server whose version is unknown (probe failed / unparseable) is silently skipped.
- `ListServers` enumeration failure is silently ignored (note unchanged).
- Both enumeration and per-server probes run under `tmux.TmuxTimeout`-bounded contexts.
- New seams `tmuxServerList` / `tmuxServerVersionProbe` (package vars mirroring `tmuxVersionProbe`) let tests drive every branch without live tmux.

- **GIVEN** binary `3.6a` and one live server `default` reporting `3.2a`
- **WHEN** `rk doctor` runs
- **THEN** the tmux row is `[ OK ] tmux — 3.6a; tmux 3.6a installed but running server "default" is 3.2a — restart your tmux server when convenient to pick it up (kills its sessions; pick a quiet moment)`

- **GIVEN** binary `3.6a` and servers `default` (3.6a) and `rk-daemon` (3.2a)
- **WHEN** `rk doctor` runs
- **THEN** only `rk-daemon` contributes a drift sentence; `default` (equal, no drift) contributes nothing

- **GIVEN** binary version unknown (probe failed)
- **WHEN** `rk doctor` runs
- **THEN** no server enumeration or probing occurs and the row carries no note (today's behavior)

- **GIVEN** binary `3.3` (below floor) and a live server at `3.1`
- **WHEN** `rk doctor` runs
- **THEN** the note is the shared `UpgradeHint` followed by `"; "` and the drift sentence — both facts surface, row stays OK

### Non-Goals

- No daemon-start or `rk serve` drift warning — that channel is reserved for the floor warning (warn fatigue).
- No auto-restart or restart affordance beyond the message text.
- No `--json` schema change — drift rides the existing `note` field verbatim.
- No frontend, API, or SSE surface.

### Design Decisions

#### Drift note always names the server socket
**Decision**: Every drift sentence names its socket (`running server "default" is …`), including the default socket.
**Why**: rk routinely runs multiple servers (default, rk-daemon, rk-test-*); per-server reporting is the intake's chosen scope, and a uniform shape avoids a special case for `default`.
**Rejected**: The intake's sample sentence without a name ("the running server is 3.2a") — ambiguous the moment two servers exist.
*Introduced by*: 260819-a8bf-doctor-tmux-drift-note

#### Probe only ListServers-confirmed-live servers
**Decision**: The sweep reuses `tmux.ListServers` (socket scan + liveness probe) and only then sends `display-message` to survivors; any per-server failure is silently skipped.
**Why**: A tmux client command on a dead socket can resurrect a server (known trap); ListServers is the existing live-derivation and covers the rk-daemon socket where drift matters most. The residual enumerate→probe race window is accepted (fail-soft: a died server just reads unknown).
**Rejected**: Default-socket-only probing — simpler but misses the rk-daemon socket.
*Introduced by*: 260819-a8bf-doctor-tmux-drift-note

## Tasks

### Phase 2: Core Implementation

- [x] T001 In `app/backend/internal/tmux/version.go`: extract the version-token grammar into an unexported `parseVersionToken(token string) (Version, bool)` + token regexp; `ParseVersion` delegates to it after stripping the `tmux ` prefix (behavior byte-identical). Add `Version.OlderThan(other Version) bool` (strict major.minor). Extend `app/backend/internal/tmux/version_test.go`: token-parse table (bare `3.2a`, `3.4`, non-release, empty) + `ParseVersion` regression rows stay green + `OlderThan` table (older / equal / suffix-only / server-ahead). <!-- R1, R3 -->
- [x] T002 In `app/backend/internal/tmux/version.go`: add `ServerVersion(ctx context.Context, server string) (Version, bool)` — `RunOutput(ctx, append(serverArgs(server), "display-message", "-p", "#{version}"), RunOpts{})`, trim output, `parseVersionToken`; every error path returns `(Version{}, false)`. <!-- R2 -->

### Phase 3: Integration & Edge Cases

- [x] T003 In `app/backend/cmd/rk/doctor.go`: add seams `var tmuxServerList = tmux.ListServers` and `var tmuxServerVersionProbe = tmux.ServerVersion`; extend `tmuxVersionCheck()` — when the binary probe succeeds, enumerate servers (TmuxTimeout ctx; enumeration error → skip silently), probe each server's version (TmuxTimeout ctx each; unknown → skip), and append one drift sentence per strictly-older server to `check.Note` joined with `"; "`, exact message shape per R4. Row stays OK in every branch. <!-- R4 -->
- [x] T004 In `app/backend/cmd/rk/doctor_test.go`: extend `TestTmuxVersionCheckNoteShapes` (or add a sibling drift test) stubbing all three seams: drift appended after plain version; drift appended after below-floor UpgradeHint; equal/newer server → no drift; suffix-only difference → no drift; unknown server version skipped; enumeration error → base note unchanged; binary unknown → no enumeration call (assert via a seam that fails the test if invoked); multi-server mixed drift; row OK in all cases. <!-- R4 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `parseVersionToken` parses bare `#{version}` tokens; `ParseVersion` behavior is unchanged (existing test rows pass without edits)
- [x] A-002 R2: `ServerVersion` probes via `display-message -p '#{version}'` with `serverArgs` targeting through `RunOutput`, returning `(Version{}, false)` on every failure path
- [x] A-003 R3: `OlderThan` implements strict major.minor ordering with suffixes ignored
- [x] A-004 R4: doctor's tmux row appends the exact drift sentence per strictly-older live server, socket named, joined with `"; "` after the base note

### Behavioral Correctness

- [x] A-005 R4: the tmux row is `OK: true` in every drift branch — drift never fails doctor, never touches daemon start/serve, never restarts anything
- [x] A-006 R4: unknown binary version skips the server sweep entirely; unknown server versions and enumeration errors are silently skipped

### Scenario Coverage

- [x] A-007 R4: tests cover drift-after-plain-version, drift-after-UpgradeHint, no-drift (equal, suffix-only, server-ahead), unknown-server skip, enumeration-error skip, binary-unknown no-sweep, and multi-server mixed drift
- [x] A-008 R1: token-parse and OlderThan tables exist in `version_test.go`

### Edge Cases & Error Handling

- [x] A-009 R2: a server dying between enumeration and probe degrades to a silent skip (no error, no note, no doctor failure)

### Code Quality

- [x] A-010 Pattern consistency: seams mirror the existing `tmuxVersionProbe` var pattern; probe follows the runner-core caller-owned-ctx contract; comments state constraints, not narration
- [x] A-011 No unnecessary duplication: version-token grammar exists once; no second socket-enumeration path (reuses `ListServers`); message reuses `Raw` fields, no re-formatting helpers duplicated

### Security

- [x] A-012 R2: all new subprocess calls go through `RunOutput` with explicit argv slices and timeout-bounded contexts (Constitution §I); no shell strings

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant (the old `versionPattern` var was replaced in place by `versionTokenPattern`; no leftover symbols, branches, or config).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Drift sentence always names the socket, including `default` | Multi-server is routine in rk; intake asked for per-server reporting; uniform shape beats a default-socket special case | S:70 R:90 A:75 D:70 |
| 2 | Confident | Drift appends to the existing note joined with `"; "` (co-exists with the below-floor UpgradeHint) | Single-line row rendering; both facts are independently true and the base-note tests must keep passing unchanged | S:65 R:90 A:80 D:70 |
| 3 | Certain | Comparison is strict major.minor; suffix-only differences never drift | Intake states "suffixes ignored" and reuses vtd1's parse semantics | S:90 R:85 A:95 D:90 |
| 4 | Confident | Unknown binary version skips the server sweep entirely | No comparand exists; "unknown never warns" is the vtd1 invariant this change inherits | S:70 R:90 A:85 D:80 |
| 5 | Certain | `ServerVersion` is fail-soft — `(Version{}, false)` on any error, mirroring `CurrentVersion` | Intake: "absent/unreachable servers are silently skipped"; existing probe precedent | S:85 R:90 A:95 D:90 |

5 assumptions (2 certain, 3 confident, 0 tentative).

# Plan: Own the code-server Install

**Change**: 260813-oid2-own-code-server-install
**Intake**: `intake.md`

## Requirements

### Install Engine: `internal/codeserver` package

#### R1: Managed install layout with atomic activation
The rk-managed code-server SHALL live under `~/.rk/code-server-bin/<version>/` (one extracted release per version dir, top-level tarball directory stripped, so the binary is at `<version>/bin/code-server`), with a `current` symlink beside the version dirs pointing at the active version. Activation MUST be an atomic symlink flip (create a temp symlink, `os.Rename` over `current`) so no observer ever sees a missing or partial `current`. A new `internal/codeserver` package owns the layout (path helpers, installed-version read from the `current` symlink target) so the daemon and the CLI share one implementation.

- **GIVEN** version 4.132.0 installed and active
- **WHEN** a newer version is installed
- **THEN** `~/.rk/code-server-bin/4.133.0/bin/code-server` exists and `current` points at `4.133.0`
- **AND** at no instant during the flip does `current` resolve to a nonexistent path

#### R2: Latest-release resolution and asset selection via the GitHub API
`Install` SHALL resolve the latest release from `https://api.github.com/repos/coder/code-server/releases/latest` (unauthenticated) and select the standalone tarball asset for the host platform: GOOS `darwin` → `macos`, `linux` → `linux`; GOARCH `amd64`/`arm64` pass through (asset name shape `code-server-<ver>-<os>-<arch>.tar.gz`). The asset's `digest` field (`sha256:<hex>`) is captured for verification. The API base URL MUST be injectable so tests use `httptest`.

- **GIVEN** a darwin/arm64 host and a release listing all eight assets
- **WHEN** the release is resolved
- **THEN** the `code-server-<ver>-macos-arm64.tar.gz` asset and its sha256 digest are selected
- **AND** an unsupported platform or missing matching asset is a clear error, not a guess

#### R3: Digest verification fails closed
The downloaded tarball's SHA-256 MUST be verified against the release asset's digest **before** any extraction is activated. A missing digest field or a mismatch MUST fail the install: no symlink flip, `current` untouched, staged files cleaned up, and a clear error (which the job window / CLI surfaces). An unverified binary is never activated (Constitution I posture).

- **GIVEN** a downloaded tarball whose sha256 does not match the asset digest
- **WHEN** `Install` runs
- **THEN** it returns an error naming the mismatch, no `<version>/` dir is left behind, and `current` still points at the prior version (or remains absent)

#### R4: Install is idempotent
When the installed version (from the `current` symlink) already equals the latest release, `Install` SHALL skip with an "already current" outcome instead of re-downloading.

- **GIVEN** `current` → `4.132.0` and latest release `v4.132.0`
- **WHEN** `rk code-server install` runs
- **THEN** it prints the already-current data line and exits 0 without downloading

#### R5: Download and extraction are in-process Go
Download (net/http) and extraction (compress/gzip + archive/tar) MUST be in-process — no `curl`/`tar` subprocesses. Extraction SHALL go to a staging temp dir under `code-server-bin/` and be promoted with `os.Rename` to `<version>/` only after full success, preserving tar mode bits (the `bin/code-server` entry script and bundled `node` must stay executable) and handling the tarball's symlink entries. The download context SHOULD carry a generous bound (~15 minutes — a ~100MB transfer on a slow link), and cancellation is clean by construction (staged files, no keg-swap analog).

- **GIVEN** an interrupted download or extraction
- **WHEN** `Install` errors out
- **THEN** only a staging dir (removed best-effort) was touched — never a half-written `<version>/` or `current`

### Daemon: resolution ladder, profile migration, install job

#### R6: Two-rung binary resolution ladder
`ensureCodeServer` SHALL resolve the code-server binary via: (1) the managed `~/.rk/code-server-bin/current/bin/code-server` when present and executable, (2) `exec.LookPath("code-server")` (a user-managed PATH install stays respected). The spawn argv uses the resolved absolute path for rung 1 (the tmux window's PATH is not rk's). The existing skips (session exists, port in use → externally managed, unresolvable port) are unchanged and checked first.

- **GIVEN** both a managed install and a PATH code-server
- **WHEN** the daemon starts
- **THEN** the managed binary is spawned (rung 1 wins)
- **AND GIVEN** only a PATH install, that binary is spawned exactly as today

#### R7: One-shot profile-dir migration to `~/.rk/code-server-profile`
The rk-owned `--user-data-dir` SHALL move from `~/.rk/code-server` to `~/.rk/code-server-profile`. At daemon code-server setup, when the old dir exists and the new one does not, it is renamed with `os.Rename` (one-shot, preserving settings and hot-exit state). Both-exist leaves both untouched (new wins); the write-once seed logic (`seedCodeServerSettings`) operates on the new path unchanged.

- **GIVEN** a host with the shipped `~/.rk/code-server` profile and no `~/.rk/code-server-profile`
- **WHEN** the daemon starts
- **THEN** the dir is renamed to `~/.rk/code-server-profile` and the spawn's `--user-data-dir` points there — user settings survive
- **AND GIVEN** a fresh host, the seed creates `~/.rk/code-server-profile/User/settings.json` directly

#### R8: Missing binary spawns the install job in `rk-jobs`
When neither ladder rung resolves, `ensureCodeServer` SHALL spawn a job window (via `daemon.RunJob`, window name `code-server-install`) running the shell chain `<rk-exe> code-server install && <rk-exe> code-server start`, where `<rk-exe>` is this daemon's own resolved binary path, shell-quoted with the package's `shellQuote` (tmux joins argv into `sh -c`, and the chain's `&&` is the B→C sequencing). The daemon then returns — never blocking on the download; `RunJob`'s dedup (live window → no second spawn) is the duplicate-job guard, and a dead window from a failed prior run respawns naturally on the next daemon start. The missing-binary warn message SHALL name the job and `rk code-server install`, not brew.

- **GIVEN** a daemon start with no code-server anywhere
- **WHEN** `ensureCodeServer` runs
- **THEN** a `rk-jobs:code-server-install` window is spawned running install-then-start, the daemon continues immediately, and the dashboard shows the job window
- **AND GIVEN** the job already live (a second daemon start mid-download), no second window is spawned

### CLI: the `rk code-server` family

#### R9: `rk code-server` command group conformance
A new `rk code-server` parent with `install`, `start`, and `update` children SHALL be registered unconditionally on `rootCmd` (help-dump platform-stability), every node carrying a `Long:` block. Toolkit conformance: outcome lines are `Dataf` on stdout (surviving `--quiet`), progress is `Notef` chatter, arg-count validators are wrapped with `usageArgs` (usage errors exit 2), operational failures exit 1. The `rk skill` bundle is untouched (capability briefing, not a command enumeration).

- **GIVEN** `rk code-server install --quiet` on an up-to-date install
- **WHEN** it runs
- **THEN** stdout carries exactly the already-current outcome line, stderr is empty, exit 0

#### R10: `rk code-server start` exposes the ensure path behind a daemon gate
`rk code-server start` SHALL run today's `ensureCodeServer` semantics (session-exists skip, port-in-use externally-managed skip, ladder resolution, profile flags) as a subcommand — exported from `internal/daemon` — gated on the daemon running (mirror of `RunJob`'s gate: any tmux command on a dead socket births a server; a down daemon is an operational error naming `rk serve -d`). Unlike the daemon's warn-and-continue posture, a missing binary here is an operational error naming `rk code-server install`.

- **GIVEN** the daemon down
- **WHEN** `rk code-server start` runs
- **THEN** it exits 1 with the `rk serve -d` guidance and no tmux server is birthed
- **AND GIVEN** the daemon up and the session already present, it prints the already-running data line and exits 0

#### R11: `rk code-server update` refreshes only the managed install and takes effect
`rk code-server update` SHALL: (1) skip with a data line and exit 0 when `~/.rk/code-server-bin` does not exist (a PATH-managed install is never touched — ownership posture); (2) otherwise install the latest version (R2–R5; already-current short-circuits the restart too); (3) on a version change, kill the `rk-code-server` session (exact-match `=rk-code-server` target) and re-run the start path so the new binary takes effect (hot exit preserves unsaved buffers; brief lens reconnect).

- **GIVEN** a managed 4.132.0 and latest 4.133.0
- **WHEN** `rk code-server update` runs
- **THEN** 4.133.0 is installed, `current` flips, the session is respawned, and the new version serves the `/code` lens
- **AND GIVEN** no `~/.rk/code-server-bin`, the command prints the not-managed skip line and exits 0 without touching the PATH install

### `rk update` integration

#### R12: `rk update` runs a best-effort code-server leg
`rk update` (`upgrade.go`) SHALL run a third leg after the CLI and desktop legs: when `~/.rk/code-server-bin` exists, run the `rk code-server update` logic (R11's semantics in-process). The leg is best-effort per the agreed constraint: any failure is a warning on the sink's chatter/data surfaces and NEVER contributes to the command's exit code (deliberately not taking the update standard's failed-post-upgrade-step allowance — the daemon job retries acquisition later, and a false red row in `shll update`'s summary is worse than a warning). No managed dir ⇒ silent skip. The download bound is generous (R5); in-process HTTP needs no SIGTERM discipline — the atomic flip makes the swap corruption-proof.

- **GIVEN** a brew-installed rk with a managed code-server and a stale version
- **WHEN** `rk update` runs
- **THEN** the CLI leg upgrades rk, and the code-server leg updates + respawns the session
- **AND GIVEN** the code-server download fails, `rk update` still exits 0 (CLI + desktop legs succeeded) with a warning naming the retry path

### Cleanup: brew, doctor, docs

#### R13: Brew dependency dropped and all install guidance points at rk
`.github/formula-template.rb` SHALL drop `depends_on "code-server"` (its explanatory comment updated to say rk manages the install itself). `codeServerCheck` in `doctor.go` SHALL report the managed version (from the `current` symlink) when the managed install is active, keep reporting a PATH install, and replace the brew hint with `rk code-server install` (row stays WARN-shaped, never a FAIL). The `--disable-update-check` comment "updates arrive via brew" and the missing-binary warning in `codeserver.go` SHALL say updates/installs arrive via rk. `README.md`'s managed code-server paragraph gains the acquisition sentence (installed automatically on first daemon start; `rk code-server install`).

- **GIVEN** the updated formula template
- **WHEN** a release is cut
- **THEN** `brew install sahil87/tap/run-kit` no longer pulls (or fails on) the deprecated code-server formula
- **AND** `rk doctor` on a managed install reports `managed v<version>` with no brew wording anywhere

### Non-Goals

- No automatic GC of old `~/.rk/code-server-bin/<version>/` dirs (manual cleanup; pruning is a later change — intake assumption 10).
- No version-pin argument on `rk code-server install` — latest only (intake assumption 11).
- No per-daemon-start latest check or auto-upgrade — acquisition fires only on a missing binary; upgrades are explicit (intake decision).
- `scripts/dev.sh` keeps using PATH code-server (dev-time convenience; the managed rung is a daemon concern). A dev machine benefits automatically once `~/.rk/code-server-bin` is on nobody's PATH — dev.sh is deliberately untouched.
- No GitHub API token plumbing (intake assumption 9).

### Design Decisions

#### New `internal/codeserver` package owns install + layout
**Decision**: put release resolution, download/verify/extract, layout paths, and installed-version reads in a new `internal/codeserver` package; `internal/daemon` and `cmd/rk` both consume it.
**Why**: the engine has two consumers (daemon job + CLI) and zero tmux coupling; `internal/daemon` is tmux-lifecycle code and `cmd/rk` must stay thin. Mirrors the desktop-installer precedent (install engine as a library, CLI as the caller).
**Rejected**: growing `internal/daemon/codeserver.go` (couples pure install logic to the daemon package's tmux seams); implementing in `cmd/rk` (unreachable from the daemon's job spawn decision and untestable per the internal-package convention).
*Introduced by*: 260813-oid2-own-code-server-install

#### The install job runs the literal shell chain, exe path quoted
**Decision**: the job argv is the shell chain `<quoted-rk-exe> code-server install && <quoted-rk-exe> code-server start`, with the exe path quoted via the daemon package's existing `shellQuote`.
**Why**: the chain is the agreed B→C sequencing, visible verbatim in the job window (a user watching the dashboard sees exactly what runs); `&&` gives success-gated start for free; quoting closes the space-in-path edge `RunJob`'s unquoted argv join documents.
**Rejected**: an `--and-start` flag on install (hides the sequencing inside one process; diverges from the agreed command shape); relying on unquoted paths (breaks on any exe path with a space).
*Introduced by*: 260813-oid2-own-code-server-install

#### Staged extract + rename promotion, temp-symlink flip
**Decision**: download and extract into a staging dir under `code-server-bin/`, promote with `os.Rename` to `<version>/`, then flip `current` via temp symlink + `os.Rename`.
**Why**: both promotions are single-syscall renames on the same filesystem — a crash at any point leaves either the old world intact or a garbage staging dir, never a torn active install.
**Rejected**: extracting directly into `<version>/` (a crash leaves a plausible-looking broken install that the ladder would happily spawn); `Symlink`+`Remove` flips (an observable missing-`current` window).
*Introduced by*: 260813-oid2-own-code-server-install

#### `rk code-server update` skips when nothing is managed
**Decision**: no `~/.rk/code-server-bin` ⇒ update prints a not-managed data line and exits 0.
**Why**: "only touch what rk owns" — a user-managed PATH install must never be shadowed as a side effect of an update verb; exit 0 keeps `rk update`'s composed leg and `shll update`'s summary truthful.
**Rejected**: installing on update when unmanaged (silently converts a user-managed setup to rk-managed); erroring (a skip is not a failure — the update standard's exit-code rule).
*Introduced by*: 260813-oid2-own-code-server-install

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/backend/internal/codeserver/` package: layout constants + path helpers (`BinDir(home)`, `VersionDir`, `CurrentPath`, `BinaryPath`, `InstalledVersion(home)` reading the `current` symlink target basename), with unit tests over a temp dir <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 `internal/codeserver/release.go`: latest-release fetch (injectable API base URL, 10s resolve bound), asset selection by GOOS/GOARCH (darwin→macos map), digest capture; unit tests via `httptest` covering selection, missing-asset error, missing-digest error <!-- R2 -->
- [x] T003 `internal/codeserver/install.go`: `Install(ctx, home)` — idempotent latest check, staged download (net/http, ~15m ctx bound) with streaming sha256, fail-closed digest verify, in-process tar.gz extract (strip top-level dir, preserve modes, handle symlink entries), `os.Rename` promotion to `<version>/`, temp-symlink+rename `current` flip, staging cleanup on error; unit tests incl. digest mismatch (no flip, no version dir), already-current skip, and mode preservation <!-- R1, R3, R4, R5 -->
- [x] T004 `internal/daemon/codeserver.go`: `resolveCodeServerBinary` two-rung ladder (managed absolute path → `codeServerLookPath`), spawn argv uses the resolved path; unit tests for both rungs and rung-1 precedence <!-- R6 -->
- [x] T005 `internal/daemon/codeserver.go`: rename `codeServerProfileDir` to `~/.rk/code-server-profile` + `migrateCodeServerProfile` one-shot `os.Rename` (old-exists ∧ new-absent), called before seeding; unit tests for rename / both-exist untouched / fresh no-op <!-- R7 -->
- [x] T006 `internal/daemon/codeserver.go`: missing-binary branch spawns `daemon.RunJob` window `code-server-install` with the quoted shell chain (selfpath-resolved exe, `shellQuote`); warn copy drops brew; unit tests capture the RunJob argv and assert the ensure path returns without blocking <!-- R8 -->
- [x] T007 New `app/backend/cmd/rk/code_server.go`: `rk code-server` parent + `install` subcommand (sink wiring: outcome `Dataf`, progress `Notef`; `usageArgs`; `Long:` blocks; unconditional registration); CLI tests for outcome lines, `--quiet`, exit codes <!-- R9 -->
- [x] T008 `rk code-server start` in `code_server.go`: daemon-running gate (operational error naming `rk serve -d`), exported ensure entry from `internal/daemon` (missing binary = operational error naming `rk code-server install`); tests for gate, already-running skip, missing-binary error <!-- R10 -->
- [x] T009 `rk code-server update` in `code_server.go`: not-managed skip (data line, exit 0), install, version-changed ⇒ kill `=rk-code-server` + start-path respawn; tests for skip, already-current no-restart, changed-version respawn <!-- R11 -->

### Phase 3: Integration & Edge Cases

- [x] T010 `app/backend/cmd/rk/upgrade.go`: `runUpdateCodeServerLeg` (managed-dir gate, R11 semantics, warnings never joined into the returned error), wired after the desktop leg in `updateCmd.RunE`; tests for gate-skip, success, and failure-still-exit-0 <!-- R12 -->
- [x] T011 `app/backend/cmd/rk/doctor.go`: `codeServerCheck` reports managed version (`managed v<ver>` via `codeserver.InstalledVersion`) vs PATH install, hint becomes `rk code-server install`; keep WARN-shape; update tests <!-- R13 -->
- [x] T012 [P] `.github/formula-template.rb`: drop `depends_on "code-server"`, rewrite the lines 7-10 comment (rk manages the install); `codeserver.go` "updates arrive via brew" comment + `ensureCodeServer` missing-binary log wording → rk-managed <!-- R13 -->

### Phase 4: Polish

- [x] T013 `README.md` managed-code-server paragraph (line ~152): add the acquisition sentence (auto-installed on first daemon start via the `rk-jobs` window; `rk code-server install`); verify help-dump goldens still pass with the new command tree and the `rk skill` bundle is untouched <!-- R9, R13 -->

## Execution Order

- T001 → T002 → T003 (engine layers); T004–T006 need T001 (paths) and can then proceed in file order (same file, sequential)
- T007 → T008 → T009 (same new file); T008/T009 need T004/T003
- T010 needs T009's semantics (shared in-process path); T011 needs T001; T012 is independent [P]
- T013 last (docs + conformance sweep over the finished tree)

## Acceptance

### Functional Completeness

- [x] A-001 R1: Versioned layout + atomic `current` flip implemented in `internal/codeserver` with tests proving no torn-activation window
- [x] A-002 R2: Latest-release resolution selects the correct asset + digest for all four platform pairs (table-driven test)
- [x] A-003 R6: Daemon resolves managed binary first, PATH second, and spawns the managed absolute path
- [x] A-004 R8: Missing binary spawns the `code-server-install` job with the quoted chain and returns non-blocking
- [x] A-005 R9: `rk code-server install|start|update` registered unconditionally with `Long:` blocks; outcome lines survive `--quiet`
- [x] A-006 R12: `rk update` runs the code-server leg when managed, skips silently when not

### Behavioral Correctness

- [x] A-007 R7: Existing `~/.rk/code-server` profile is renamed one-shot to `~/.rk/code-server-profile`; both-exist and fresh-host branches covered by tests
- [x] A-008 R11: Update with no managed dir exits 0 with the skip line and never touches a PATH install; version-change respawns the session
- [x] A-009 R10: `rk code-server start` on a down daemon exits 1 naming `rk serve -d` and births no tmux server

### Removal Verification

- [x] A-010 R13: `depends_on "code-server"` absent from `.github/formula-template.rb`; no brew-install-code-server wording remains in `doctor.go`, `codeserver.go`, or README

### Scenario Coverage

- [x] A-011 R3: Digest-mismatch and missing-digest tests prove fail-closed: no `<version>/` residue, `current` untouched
- [x] A-012 R4: Already-current install skips without downloading (test asserts no HTTP fetch of the tarball)

### Edge Cases & Error Handling

- [x] A-013 R5: Interrupted extract leaves only a staging dir (cleaned best-effort); mode bits and symlink entries in the tarball survive extraction
- [x] A-014 R12: Code-server leg failure produces a warning but `rk update` exits 0 (test asserts joined error excludes the leg)

### Code Quality

- [x] A-015 Pattern consistency: new code follows the package-seam test style (`codeServerLookPath` idiom), sink data/chatter split, and `usageArgs` exit-code convention
- [x] A-016 No unnecessary duplication: CLI `update`, the `rk update` leg, and the job chain all route through the one `internal/codeserver.Install` + one exported start path
- [x] A-017 No shell-string subprocess construction: all exec via `exec.CommandContext` argv slices; the one shell-interpreted string (job chain) quotes the exe path

### Security

- [x] A-018 R3: No unverified binary is ever activated — digest verification precedes promotion and flip; the download URL and API host are the fixed GitHub endpoints, never user input

## Deletion Candidates

- `app/backend/internal/daemon/codeserver.go` — `codeServerLegacyProfileDir` + `migrateCodeServerProfile`: one-shot migration scaffolding; deletable in a later change once the `~/.rk/code-server` → `~/.rk/code-server-profile` rename has shipped long enough that no supported host still carries the legacy dir.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | New `internal/codeserver` package (not `internal/daemon` growth) | Two consumers (daemon + CLI), zero tmux coupling; desktop-installer precedent | S:60 R:80 A:85 D:75 |
| 2 | Confident | Binary at `<version>/bin/code-server` with the tarball's top-level dir stripped | Verified release tarball layout (`code-server-<ver>-<os>-<arch>/bin/code-server`) | S:70 R:85 A:90 D:85 |
| 3 | Confident | Staged-extract + rename promotion + temp-symlink flip for atomicity | Single-syscall renames; crash-safe by construction | S:60 R:85 A:90 D:80 |
| 4 | Confident | Job argv quotes the exe path with `shellQuote`; window name `code-server-install` | RunJob documents the unquoted-join hazard; same package owns the quoting helper | S:55 R:90 A:85 D:80 |
| 5 | Confident | Managed rung checks executable file at the fixed path (stat), not `LookPath` | The managed location is exact; LookPath is for the PATH rung only | S:55 R:90 A:85 D:80 |
| 6 | Confident | `rk code-server start` errors (operational) on missing binary, unlike the daemon's warn-and-continue | An explicit start of nothing is a user error; the daemon's posture is availability-driven | S:50 R:85 A:80 D:70 |
| 7 | Confident | Download bound ~15m via context; no SIGTERM discipline needed in-process | The brew clause targets subprocess keg swaps; staged rename makes cancellation clean | S:55 R:85 A:85 D:80 |
| 8 | Confident | `dev.sh` and the dev workflow stay on PATH resolution (Non-Goal) | Dev-time convenience outside the daemon's ownership; trivially revisited | S:50 R:90 A:80 D:70 |
| 9 | Confident | Shared ensure path is `ensureCodeServerCore(cli bool)` behind an `EnsureOutcome` enum; the CLI gate reuses `jobDaemonRunning` | One implementation for daemon + CLI; the outcome enum keeps CLI data lines honest without the daemon learning about sinks | S:55 R:85 A:85 D:75 |
| 10 | Certain | The managed rung spawns the `current`-symlink path (`~/.rk/code-server-bin/current/bin/code-server`), not the version-dir path | R6 names that exact path; a flip + respawn then needs no argv change | S:70 R:90 A:85 D:85 |
| 11 | Confident | The `rk update` leg calls the CLI's `runCodeServerUpdateFlow` in-process (no subprocess self-call) | One implementation for both callers; in-process HTTP needs no SIGTERM discipline (assumption 7) | S:55 R:90 A:85 D:80 |
| 12 | Confident | Existing `updateCmd.RunE` tests each gained a `withNoCodeServerLeg` stub (empty temp home) | Keeps the suite hermetic once dev machines carry a real managed install; mirrors `withNoDesktopLeg` | S:50 R:90 A:80 D:75 |
| 13 | Confident | `codeServerCheck` gained a `home` parameter; a managed install reports `managed v<ver>` and wins over PATH (ladder precedence) | The managed rung is only checkable with a home; mirroring the daemon ladder keeps doctor truthful | S:55 R:85 A:80 D:75 |

13 assumptions (1 certain, 12 confident, 0 tentative).

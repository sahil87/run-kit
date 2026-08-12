# Plan: Code-Server Seeded Profile

**Change**: 260812-71bv-code-server-seeded-profile
**Intake**: `intake.md`

## Requirements

### Daemon: Code-Server Profile Flags

#### R1: rk-owned user-data-dir flag
The `ensureCodeServer` spawn argv MUST include `--user-data-dir {home}/.rk/code-server`, where `{home}` is resolved via `os.UserHomeDir()` and the path is absolute (tmux execs the argv via `env`, not a shell — no tilde expansion).

- **GIVEN** a daemon start where all idempotency-ladder rungs pass (no existing session, resolvable free port, binary present)
- **WHEN** `ensureCodeServer` spawns the `rk-code-server` session
- **THEN** the argv contains `--user-data-dir /home/{user}/.rk/code-server` after the existing five curation flags

#### R2: extensions-dir pinned to code-server's default
The spawn argv MUST include `--extensions-dir` pointing at code-server's **default** extensions location: `$XDG_DATA_HOME/code-server/extensions` when `XDG_DATA_HOME` is set and non-empty, else `{home}/.local/share/code-server/extensions`. This pin is required because code-server derives its default extensions dir from the user-data-dir (`<user-data-dir>/extensions`), so R1 alone would hide the user's installed extensions.

- **GIVEN** `XDG_DATA_HOME` unset
- **WHEN** the spawn argv is built
- **THEN** it contains `--extensions-dir {home}/.local/share/code-server/extensions`
- **GIVEN** `XDG_DATA_HOME=/custom/data`
- **WHEN** the spawn argv is built
- **THEN** it contains `--extensions-dir /custom/data/code-server/extensions`

#### R3: write-once settings seed
Immediately before the spawn (on the spawn branch only), `ensureCodeServer` MUST seed `{home}/.rk/code-server/User/settings.json` — creating directories as needed — **only when the file does not exist**, with exactly:

```json
{
    "chat.disableAIFeatures": true,
    "workbench.startupEditor": "none"
}
```

An existing file (any content) MUST be left byte-for-byte untouched.

- **GIVEN** `{home}/.rk/code-server/User/settings.json` does not exist
- **WHEN** `ensureCodeServer` reaches the spawn branch
- **THEN** the file is created with the exact JSON above, and the spawn proceeds
- **GIVEN** the file exists with user-modified content
- **WHEN** `ensureCodeServer` reaches the spawn branch
- **THEN** the file content is unchanged

#### R4: best-effort degradation
Profile handling MUST never block the editor or the daemon. A seed failure (mkdir or write error) SHALL log `slog.Warn` and continue to the spawn **with the profile flags still applied** (code-server creates its own user-data-dir; the only degradation is an unseeded profile). An `os.UserHomeDir()` failure SHALL log `slog.Warn` and spawn with the **pre-change argv** (no `--user-data-dir`, no `--extensions-dir`, no seed).

- **GIVEN** the seed write fails (e.g. permission denied)
- **WHEN** `ensureCodeServer` runs
- **THEN** a warning is logged and the spawn still occurs with both profile flags
- **GIVEN** `os.UserHomeDir()` returns an error
- **WHEN** `ensureCodeServer` runs
- **THEN** a warning is logged and the spawn occurs with the pre-change argv (five curation flags, no profile flags)

#### R5: scope unchanged
The idempotency ladder MUST be untouched: existing `rk-code-server` session ⇒ silent skip; port already serving ⇒ the externally managed instance is respected and receives **no flags and no seed**; binary absent ⇒ warn-and-continue. The seed runs only after every ladder rung passes. The user's personal profile (`~/.local/share/code-server`) is never written.

- **GIVEN** the resolved port already accepts connections
- **WHEN** `ensureCodeServer` runs
- **THEN** no spawn occurs AND no settings file is written

### Design Decisions

#### The rk-owned profile lives in ~/.rk/code-server
**Decision**: `--user-data-dir` points at `{home}/.rk/code-server`, resolved via `os.UserHomeDir()`.
**Why**: user decision at intake — `~/.rk/` is rk's user-config namespace (the `~/.rk/tmux.conf` precedent) and the seeded `User/settings.json` is the user-editable artifact; discoverability beats content-class purity.
**Rejected**: `$XDG_DATA_HOME/rk/code-server` (mirrors code-server's own default placement but hides the editable settings.json in a data dir); `$XDG_STATE_HOME/rk/code-server` (those carve-outs are rk-written state — this dir is code-server-owned and user-edited).
*Introduced by*: 260812-71bv-code-server-seeded-profile

#### Seed failure keeps the flags; home failure drops them
**Decision**: two distinct degrade rungs — seed write failure warns and spawns WITH the profile flags; `os.UserHomeDir()` failure warns and spawns with the pre-change argv.
**Why**: without a home dir there is no valid absolute path to put in the flags, and a relative/empty flag value is worse than the status quo; a failed seed merely leaves a default-behaving profile that code-server itself creates.
**Rejected**: aborting the spawn on either failure (an editor must never block the dashboard — the file's standing posture).
*Introduced by*: 260812-71bv-code-server-seeded-profile

### Non-Goals

- No doctor changes — the code-server doctor row keeps reporting binary/port/reachability only.
- No migration of existing profiles or settings; the effect lands on the next fresh spawn (PR #564 rollout semantics).
- No enforcement of the seeded values — the seed is a baseline; user edits win forever after.

## Tasks

### Phase 1: Core Implementation

- [x] T001 Add path resolution to `app/backend/internal/daemon/codeserver.go`: a `codeServerUserHomeDir` package-var seam (defaulting to `os.UserHomeDir`, matching the file's seam style) plus helpers deriving the profile dir `{home}/.rk/code-server` and the default extensions dir (`$XDG_DATA_HOME` else `{home}/.local/share`, + `code-server/extensions`) <!-- R1, R2 -->
- [x] T002 Add the write-once seed helper in `app/backend/internal/daemon/codeserver.go`: stat `<profile>/User/settings.json`; when absent, `MkdirAll` + write the exact seed JSON constant; any failure returns for the caller to `slog.Warn` — never fatal <!-- R3, R4 -->
- [x] T003 Wire into `ensureCodeServer`: after the ladder rungs and before the spawn, resolve home (failure ⇒ warn + pre-change argv), run the seed (failure ⇒ warn + continue), and append `--user-data-dir`/`--extensions-dir` to the argv <!-- R1, R2, R3, R4, R5 -->

### Phase 2: Tests & Gates

- [x] T004 Extend `app/backend/internal/daemon/codeserver_test.go`: exact-argv assertion updated for both flags (HOME pointed at `t.TempDir()` via the seam, `XDG_DATA_HOME` set and unset variants); seed written-when-absent with exact content; existing file preserved byte-for-byte; seed-failure still spawns with flags; home-failure spawns pre-change argv; port-listening skip writes no file <!-- R1, R2, R3, R4, R5 -->
- [x] T005 Run verification gates: `cd app/backend && go test ./...`, then the daemon package with `-run 'CodeServer'` first for fast iteration <!-- R1 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The spawn argv carries `--user-data-dir` with the absolute `~/.rk/code-server` path, after the five existing curation flags
- [x] A-002 R2: The spawn argv carries `--extensions-dir` at code-server's default location, honoring `XDG_DATA_HOME` with the `~/.local/share` fallback
- [x] A-003 R3: A missing `User/settings.json` is created with exactly the two seeded settings; directories are created as needed

### Behavioral Correctness

- [x] A-004 R3: An existing `User/settings.json` is never modified — byte-for-byte identical after `ensureCodeServer` runs
- [x] A-005 R5: The externally-managed-instance skip (port listening) writes no file and passes no flags; the session-exists and binary-absent rungs are unchanged

### Edge Cases & Error Handling

- [x] A-006 R4: A seed mkdir/write failure logs a warning and the spawn still occurs with both profile flags
- [x] A-007 R4: A home-resolution failure logs a warning and the spawn occurs with the pre-change argv (no profile flags, no seed)

### Code Quality

- [x] A-008 Pattern consistency: New seams follow the file's package-var seam style (`codeServerLookPath` precedent); paths built with `filepath.Join`; no shell strings (Constitution I)
- [x] A-009 No unnecessary duplication: XDG resolution mirrors the existing `internal/snapshot.DefaultDir` shape without importing it for an unrelated concern
- [x] A-010 Tests cover added behavior: every new branch (seed absent/present/failure, home failure, XDG variants) has a test (code-quality.md test mandate)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. (The `freeLoopbackPort` helper consolidated the pre-existing repeated listen-for-free-port blocks in the test file, removing no production code.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Home resolution goes behind a `codeServerUserHomeDir` package-var seam rather than env manipulation | `t.Setenv("HOME", ...)` works on Linux but `os.UserHomeDir` reads platform-specific vars; the file's existing seam style is the established pattern and keeps tests hermetic | S:60 R:90 A:85 D:80 |
| 2 | Confident | Seed JSON is a raw string constant (4-space indent) written verbatim, not marshaled | Exact-bytes testability and human-readability of the seeded file; marshaling adds no value for a fixed 2-key literal | S:55 R:95 A:85 D:80 |
| 3 | Certain | Profile flags append after the existing five curation flags (argv order stable) | Keeps the exact-argv test diff minimal and mirrors the #564 flag-append precedent | S:70 R:95 A:95 D:90 |

3 assumptions (1 certain, 2 confident, 0 tentative).

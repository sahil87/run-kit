# Plan: Direnv Diff Reversal for User Server Environments

**Change**: 260706-6mpm-direnv-diff-reversal-server-env
**Intake**: `intake.md`

## Requirements

<!-- Derived from intake.md's "What Changes" (§1 reversal, §2 fail-soft, §3 out-of-scope, §4 tests)
     and the 12 graded intake assumptions. RFC-2119 statements with GIVEN/WHEN/THEN scenarios. -->

### Environment Sanitization: Direnv Diff Reversal

#### R1: Reverse-apply DIRENV_DIFF at the CreateSession seam
The environment passed to a user-facing tmux server born by rk (`tmux.CreateSession` → `cleanEnvForServer`) MUST be the invoking environment with direnv's diff undone. When `DIRENV_DIFF` is present and parseable, the sanitizer SHALL decode it (base64url → zlib inflate → JSON `{"p":{...},"n":{...}}`) and reverse-apply it: for each key present in `n`, remove it if it is absent from `p`, else restore it to its `p` value; for each key present in `p` but absent from `n`, restore the `p` value. The reversed environment carries the user's true pre-direnv PATH.

- **GIVEN** an environment containing a valid `DIRENV_DIFF` that added `WORKTREE_INIT_SCRIPT` and `IDEAS_FILE` and changed `PATH`
- **WHEN** `cleanEnvForServer`/`sanitizeEnv` runs
- **THEN** `WORKTREE_INIT_SCRIPT` and `IDEAS_FILE` are removed, `PATH` is restored to its pre-direnv (`p`) value
- **AND** a var that direnv only changed (present in both `p` and `n`) is restored to its `p` value
- **AND** a var that direnv removed (present in `p`, absent from `n`) is restored to its `p` value

#### R2: Strip all RK_*-prefixed vars at the seam
The sanitizer MUST remove every environment entry whose name begins with `RK_` (e.g. `RK_DAEMON_LOG`, `RK_PORT`, `RK_HOST`), because rk adds these post-direnv and diff reversal does not catch them. This strip runs unconditionally, whether or not `DIRENV_DIFF` is present.

- **GIVEN** an environment containing `RK_DAEMON_LOG`, `RK_PORT`, `RK_HOST`
- **WHEN** the sanitizer runs
- **THEN** no entry with an `RK_` name prefix survives in the output

#### R3: Strip all DIRENV_*-prefixed vars at the seam
The sanitizer MUST remove every environment entry whose name begins with `DIRENV_`, because direnv excludes its own state vars from the diff and a from-home shell has none. This strip runs unconditionally, whether or not `DIRENV_DIFF` is present, and applies after reversal.

- **GIVEN** an environment containing `DIRENV_DIFF`, `DIRENV_DIR`, `DIRENV_FILE`, `DIRENV_WATCHES`
- **WHEN** the sanitizer runs
- **THEN** no entry with a `DIRENV_` name prefix survives in the output (including `DIRENV_DIFF` itself)

#### R4: Fail-soft when DIRENV_DIFF is absent
When `DIRENV_DIFF` is not present in the environment, the sanitizer MUST pass the environment through unchanged except for the R2 (`RK_*`) and R3 (`DIRENV_*`, vacuously) strips. No PATH reset, no hard dependency on direnv being installed.

- **GIVEN** an environment with no `DIRENV_DIFF` but with `PATH=/home/user/.local/bin:/usr/bin` and `RK_PORT=3000`
- **WHEN** the sanitizer runs
- **THEN** `PATH` is passed through unchanged (NOT reset to the POSIX default)
- **AND** `RK_PORT` is stripped

#### R5: Fail-soft when DIRENV_DIFF is malformed
When `DIRENV_DIFF` is present but cannot be decoded/inflated/parsed (bad base64, bad zlib, bad JSON), the sanitizer MUST treat it as absent — pass through with R2/R3 strips only — and emit a single `slog` warning for diagnosability. It MUST NOT fail `CreateSession` over a sanitization error.

- **GIVEN** an environment with `DIRENV_DIFF=not-valid-base64!!!`
- **WHEN** the sanitizer runs
- **THEN** the environment is passed through with `RK_*`/`DIRENV_*` stripped
- **AND** a `slog` warning is emitted
- **AND** no error propagates to `CreateSession`

#### R6: PATH-missing last-resort guard
The reversed/passed-through environment SHOULD retain a last-resort guard: if the resulting environment carries no `PATH` at all, the sanitizer MUST inject `PATH=<cleanPATH>` so the tmux server never starts with an empty PATH. This is the only surviving use of the POSIX `cleanPATH` constant; it is NOT applied when a PATH is already present.

- **GIVEN** a passed-through or reversed environment that ends up with no `PATH=` entry
- **WHEN** the sanitizer finishes
- **THEN** exactly one `PATH=<cleanPATH>` entry is present
- **AND** GIVEN an environment that already carries a PATH, THEN `cleanPATH` is not substituted

### Scope & Constraints

#### R7: Backend-only, no subprocess, daemon launch untouched
The change SHALL be confined to `app/backend/internal/tmux/` (the `tmux.go` seam plus an optional colocated helper file and the test file). It MUST use only Go stdlib (`encoding/base64`, `compress/zlib`, `encoding/json`) with no subprocess and no runtime direnv dependency. `internal/daemon/daemon.go` (daemon launch) MUST NOT change; no UI/API changes.

- **GIVEN** the full diff of this change
- **WHEN** files touched are enumerated
- **THEN** only files under `app/backend/internal/tmux/` are modified
- **AND** no new non-stdlib import and no `exec.Command*` call is introduced by the reversal helper

### Non-Goals

- Cleaning up already-running polluted tmux servers — operational (`tmux set-environment -gru` or restart), not code scope (intake row 12).
- Daemon-side env hygiene / `-e` re-injection of `RK_PORT`/`RK_HOST` at `daemon.startSession` — explicitly out of scope (intake row 4).
- Any UI or API surface change.

### Design Decisions

1. **Parse DIRENV_DIFF in Go (stdlib) rather than shelling out to `direnv export json`** — *Why*: fail-soft with zero runtime direnv dependency, no subprocess (Security-First posture), deterministic fixture tests; format-coupling risk bounded by fail-soft degradation to pass-through. *Rejected*: `direnv export json` with cwd outside `.envrc` scope — adds a runtime subprocess and only works when direnv is installed. (Intake row 7.)
2. **Strip all `RK_*`, not just `RK_DAEMON_LOG`** — *Why*: simpler and future-proof; the known edge (an `RK_*` var from the user's own profile also stripped) is a minor, user-accepted deviation confined to rk's namespace. *Rejected*: naming individual vars — brittle as rk's namespace grows. (Intake row 8.)
3. **Retire the unconditional POSIX PATH reset; keep `cleanPATH` only as a PATH-missing guard** — *Why*: the reversed env carries the user's true PATH, and the pass-through path (no diff) must preserve the real PATH too; a PATH-missing guard is cheap insurance against a degenerate env with no PATH at all. *Rejected*: dropping `cleanPATH` entirely — leaves a theoretical empty-PATH tmux server with no floor. (Intake row 3 + plan-level call from the intake's §1.4.)
4. **Reversal helper colocated in `internal/tmux/direnv.go`** — *Why*: smallest footprint, matches the package's single-file-plus-tests shape, trivially movable later. *Rejected*: a new package — over-structured for one helper. (Intake row 11.)

## Tasks

### Phase 1: Core Implementation

- [x] T001 Add `internal/tmux/direnv.go` with a `reverseDirenvDiff(environ []string) ([]string, error)` helper (and any small parse helpers): read `DIRENV_DIFF` from the passed environ; if absent return the environ unchanged with a sentinel indicating "no diff" (nil error, unchanged slice); otherwise base64url-decode (tolerant of padded/unpadded), zlib-inflate, `json.Unmarshal` into `struct{ P, N map[string]string }` with `json:"p"`/`json:"n"` tags; on any decode/inflate/parse error return the original environ plus a non-nil error (caller warns + falls through). Apply reversal semantics (R1) to produce the reversed environ. Stdlib only. <!-- R1 R5 R7 -->
- [x] T002 Rewrite `sanitizeEnv` in `internal/tmux/tmux.go` to the new semantics: (1) call `reverseDirenvDiff` on the input; on error emit a single `slog.Warn` and continue with the original environ (R5); (2) filter the (reversed-or-original) environ dropping every `RK_*` (R2) and `DIRENV_*` (R3) entry; (3) as a last-resort guard, if no `PATH=` entry remains, append `PATH=<cleanPATH>` (R6). Keep the `cleanPATH` const solely for this guard. Update the `sanitizeEnv`/`cleanEnvForServer`/`CreateSession` doc comments to describe diff-reversal semantics. <!-- R1 R2 R3 R4 R6 -->

### Phase 2: Tests

- [x] T003 In `internal/tmux/tmux_test.go` add a fixture builder that produces a real `DIRENV_DIFF` value (JSON `{"p","n"}` → zlib.deflate → base64url) so reversal tests use genuine blobs, then rewrite `TestSanitizeEnv` to cover: added-var removal, changed-var restoration (incl. PATH), removed-var restoration, `RK_*` stripped, `DIRENV_*` stripped (incl. `DIRENV_DIFF` itself), pass-through (PATH NOT POSIX-reset) when no diff, malformed-diff fail-soft (pass-through + strips, no panic), and the PATH-missing guard. Add focused `reverseDirenvDiff` unit tests for absent/valid/malformed cases. <!-- R1 R2 R3 R4 R5 R6 -->

## Execution Order

- T001 blocks T002 (sanitizeEnv calls reverseDirenvDiff).
- T002 blocks T003 (tests assert the new sanitizeEnv behavior).

## Acceptance

### Functional Completeness

- [x] A-001 R1: A valid `DIRENV_DIFF` is reverse-applied — added vars removed, changed vars (incl. PATH) restored to `p`, removed vars restored — verified by fixture-based unit test.
- [x] A-002 R2: All `RK_*` vars are stripped at the seam regardless of diff presence, verified by test.
- [x] A-003 R3: All `DIRENV_*` vars (including `DIRENV_DIFF`) are stripped at the seam, verified by test.
- [x] A-004 R4: With no `DIRENV_DIFF`, env passes through unchanged except `RK_*`/`DIRENV_*` strips; PATH is NOT reset to POSIX, verified by test.
- [x] A-005 R6: A last-resort `PATH=<cleanPATH>` is injected only when no PATH remains; an existing PATH is preserved, verified by test.

### Behavioral Correctness

- [x] A-006 R4: The old unconditional POSIX PATH reset is gone from the no-diff and reversal paths (behavior changed from prior `sanitizeEnv`), verified by the pass-through test asserting a real PATH survives.

### Edge Cases & Error Handling

- [x] A-007 R5: A malformed `DIRENV_DIFF` degrades to pass-through + strips with a `slog` warning and never fails `CreateSession`, verified by test (no panic, strips still applied; the `slog.Warn` at `tmux.go:844` verified by inspection — `sanitizeEnv` returns `[]string` only, so no error can propagate to `CreateSession`).

### Scenario Coverage

- [x] A-008 R1: Fixture builder produces real base64url+zlib+JSON blobs (not hand-mocked), and reversal tests consume them, verified by the test reading its own generated fixture.

### Security

- [x] A-009 R7: The reversal helper introduces no subprocess and no non-stdlib import; `exec.CommandContext` usage elsewhere is unchanged, verified by inspection (no `exec.` in `direnv.go`; imports are `bytes`/`compress/zlib`/`encoding/base64`/`encoding/json`/`io`/`strings`).

### Code Quality

- [x] A-010 Pattern consistency: New code follows the package's naming/error-handling style (pure parse helpers, `slog` for warnings, colocated file), matching surrounding `internal/tmux` code.
- [x] A-011 No unnecessary duplication: Reuses the existing `cleanPATH` const and `slog` import; no reimplemented base64/zlib/json.
- [x] A-012 No shell strings / exec without context: The change adds no subprocess; all existing `exec.CommandContext`+timeout calls are untouched (Constitution §I, code-review rule).
- [x] A-013 Tests included: New/changed behavior ships with Go unit tests (code-quality mandate; intake row 6). `go test ./internal/tmux/` and `just test-backend` green.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- The `daemon.startSession` launch path is deliberately untouched (intake row 4) — do not sanitize the daemon's own env.

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. The old `sanitizeEnv` blacklist/POSIX-reset logic and its dedup test case were removed within this diff itself; `cleanPATH` is deliberately retained as the R6 PATH-missing guard; no other code, config, or docs in the repo addressed the old sanitization behavior (`grep` for `sanitizeEnv`/`cleanEnvForServer`/`POSIX` outside `internal/tmux/` finds no consumers).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Reversal helper is `reverseDirenvDiff(environ []string) ([]string, error)` colocated in `internal/tmux/direnv.go`; `sanitizeEnv` calls it then applies strips + PATH guard | Intake rows 1, 3, 7, 11 fix the seam, mechanism, and file location; the signature is the minimal shape that lets `sanitizeEnv` warn-and-fall-through on error | S:90 R:85 A:90 D:90 |
| 2 | Confident | `cleanPATH` survives ONLY as a last-resort PATH-missing guard (injected when the resulting env carries no PATH), not as an unconditional reset | Intake §1.4 explicitly leaves this a plan-level call; keeping a floor against an empty-PATH tmux server is cheap insurance and matches the codebase's best-effort posture, while honoring "reversed env carries true PATH" (row 3) | S:70 R:80 A:75 D:70 |
| 3 | Confident | Base64 decoding is tolerant of both padded and unpadded base64url (try `URLEncoding`, fall back to `RawURLEncoding`) | direnv's `gzenv` uses padded `base64.URLEncoding`, but tolerating the unpadded form costs nothing and removes a brittle coupling; both feed the same zlib+JSON path, and any decode failure still fail-softs per R5 | S:60 R:85 A:70 D:70 |
| 4 | Confident | Reversal iterates `n` (remove-or-restore-to-`p`) then `p`-not-in-`n` (restore); a key in both is restored to its `p` value | Directly transcribes the intake §1.1 reversal semantics; the "changed var" case (present in both maps) is covered by the `n`-loop's restore-to-`p` branch, so the `p`-loop only handles direnv-removed keys | S:85 R:80 A:85 D:85 |
| 5 | Confident | The `slog` warning on malformed diff uses the existing `log/slog` import at WARN level with the decode error attached, mirroring `killAudit`/`resolveDaemonLogPath` warn-and-proceed convention | Intake rows 5, 9 mandate a `slog` warning and fail-soft; the package already imports and uses `slog` at WARN for diagnostic-but-non-fatal events | S:70 R:85 A:80 D:80 |

5 assumptions (1 certain, 4 confident, 0 tentative).

# Intake: Tmux-Missing Remediation Hints

**Change**: 260817-ho1o-tmux-missing-remediation-hints
**Created**: 2026-08-17

## Origin

Backlog item `[ho1o]` (2026-08-17), one-shot `/fab-new ho1o` invocation, no prior conversation:

> daemon start with tmux missing dies with raw error (creating tmux session: exec tmux not found) — add doctor-style remediation hint (brew/apt install tmux, or point at rk doctor); doctor's non-brew tmux hint is also generic (install tmux and ensure it is on PATH) — make it package-manager-aware on Linux. Exit codes already fixed at HEAD; found in fresh-VM install testing 2026-08-17

## Why

1. **The pain point**: On a host without tmux (the exact fresh-VM first-run scenario from install testing on 2026-08-17), `rk daemon start` fails with the raw Go error wrap from `app/backend/internal/daemon/daemon.go:318` — `creating tmux session: exec: "tmux": executable file not found in $PATH`. This is the very first command a new user runs after installing run-kit, and the error names the internal operation that failed rather than telling the user what to do about it. Separately, `rk doctor` — the tool that exists to diagnose exactly this — gives a generic hint on non-macOS platforms: `install tmux and ensure it is on PATH` (`app/backend/cmd/rk/doctor.go:55`), while macOS gets the actionable `install with: brew install tmux`.

2. **The consequence if unfixed**: First-run experience on Linux (the common fresh-VM / cloud-box case) is a dead end requiring the user to parse a Go exec error. Every fresh install on a tmux-less box hits this.

3. **Why this approach**: run-kit fundamentally requires tmux (Constitution II/VI — all state derives from tmux). A missing tmux is a permanent environmental fact, not a transient failure, so the right responses are (a) fail fast at daemon start with a doctor-style remediation hint before attempting any tmux subprocess, and (b) make the hint itself actionable per-platform by detecting the host's package manager, sharing one hint helper between the daemon-start error and the doctor check so the two surfaces can never drift.

## What Changes

### 1. Shared platform-aware install-hint helper (`internal/tmux`)

A new pure helper in `app/backend/internal/tmux/` (e.g. `install_hint.go`) returning the platform-appropriate tmux install instruction. Signature shaped for testability, following the codebase's injected-`lookPath` idiom (`codeServerCheck(home, lookPath, dial)` in `cmd/rk/doctor.go`):

```go
// InstallHint returns a platform-appropriate tmux install instruction.
// goos is runtime.GOOS; lookPath is exec.LookPath (injected for tests).
func InstallHint(goos string, lookPath func(string) (string, error)) string
```

Resolution:

- `darwin` → `install with: brew install tmux` (current doctor behavior, unchanged)
- `linux` → probe for a package manager via `lookPath`, first found wins, in order:
  | Binary | Hint |
  |--------|------|
  | `apt-get` | `install with: sudo apt-get install tmux` |
  | `dnf` | `install with: sudo dnf install tmux` |
  | `yum` | `install with: sudo yum install tmux` |
  | `pacman` | `install with: sudo pacman -S tmux` |
  | `zypper` | `install with: sudo zypper install tmux` |
  | `apk` | `install with: sudo apk add tmux` |
- anything else (no manager found, other GOOS) → the existing generic fallback: `install tmux and ensure it is on PATH`

`internal/tmux` is the natural home: all tmux interaction goes through it (code-quality anti-pattern list), and both consumers can import it (`internal/daemon` already imports it for `tmux.ServerBirthDir()`; `cmd/rk` imports it freely).

### 2. Daemon-start tmux precheck (fail fast with remediation)

`rk daemon start` on a tmux-less host MUST fail before any tmux subprocess is attempted, with an error carrying the remediation hint and an `rk doctor` pointer. Both entry points — `daemon.Start()` and `daemon.StartWithBinary()` (`app/backend/internal/daemon/daemon.go:237` / `:267`, which share the `startSession` funnel) — get the precheck at the top, before `IsRunning()` / `guardPortAvailable()` / `reapStaleDaemonSocket()` (all of which shell out to tmux and currently fail confusingly or silently without it). Error shape (exact wording refinable at apply):

```
tmux not found on PATH — the run-kit daemon runs inside a tmux session
  install with: sudo apt-get install tmux
  then re-run `rk daemon start` (or run `rk doctor` for a full dependency check)
```

The backlog's "brew/apt install tmux, or point at rk doctor" is satisfied with both: the install command (via the shared helper) and the doctor pointer. Exit code semantics are untouched — the backlog notes exit codes are already fixed at HEAD; this changes only the error content and when it is produced (precheck vs mid-operation).

### 3. Doctor's tmux hint becomes package-manager-aware

`runDoctorChecks()` in `app/backend/cmd/rk/doctor.go:54-59` replaces its inline darwin/generic branch with the shared helper:

```go
if _, err := exec.LookPath("tmux"); err != nil {
    report.Checks = append(report.Checks, doctorCheck{Name: "tmux", OK: false, Hint: tmux.InstallHint(runtime.GOOS, exec.LookPath)})
    report.OK = false
}
```

Behavior preserved: macOS keeps the brew hint byte-identically; the generic fallback text stays for undetectable platforms; only Linux-with-a-known-package-manager changes (generic → specific command). The `--json` document shape (`{ok, checks:[{name, ok, hint}]}`) is unchanged — only the `hint` string value varies by platform, as it already does today.

### 4. Tests

- `internal/tmux` unit tests for `InstallHint`: darwin → brew; each Linux package manager (injected `lookPath` stub); probe order (e.g. both `apt-get` and `pacman` present → apt-get wins); no manager → generic fallback; non-linux/non-darwin GOOS → generic fallback.
- Daemon precheck test: tmux absent ⇒ `Start()` returns the hint-carrying error without touching tmux (needs a LookPath seam in `internal/daemon`, matching the package's existing test-seam style).
- `cmd/rk/doctor_test.go`: existing tmux-check tests updated to expect the helper-produced hint.

### Non-goals

- No change to exit codes (already fixed at HEAD per the backlog entry).
- No precheck in foreground `rk serve` or the sessions API — the backlog scopes this to daemon start; those paths surface tmux absence differently and `rk doctor` covers diagnosis.
- No change to the shim-related hints (`doctor.go:217`, `tmux_guard.go`) — those describe PATH mis-wiring with a real tmux involved, a different failure with different remediation.
- No auto-install of tmux — hint only.

## Affected Memory

- `run-kit/architecture`: (modify) the `doctor` CLI-subcommand row (tmux check hint now platform/package-manager-aware via shared `internal/tmux` helper) and the Daemon Lifecycle section (`Start`/`StartWithBinary` gain a fail-fast tmux precheck with remediation hint)

## Impact

- `app/backend/internal/tmux/` — new `InstallHint` helper + unit tests
- `app/backend/internal/daemon/daemon.go` — precheck in `Start()` and `StartWithBinary()` + test seam and tests
- `app/backend/cmd/rk/doctor.go` + `doctor_test.go` — hint branch replaced by helper call
- CLI-visible text: one new error message (daemon start) and refined doctor hint values — no help-text, flag, or command-surface changes, so no toolkit-standards (help-dump) impact; `--json` schema unchanged
- No frontend, API, or tmux-runtime behavior changes

## Open Questions

- None — the backlog entry is specific about both surfaces and the remediation content.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope the precheck to `rk daemon start` (`Start`/`StartWithBinary`) only — not `rk serve` or the API | Backlog names daemon start explicitly; other paths are out of the reported failure | S:85 R:80 A:85 D:80 |
| 2 | Confident | Shared helper lives in `internal/tmux`, imported by both `internal/daemon` and `cmd/rk` | Code-quality rule routes tmux concerns to `internal/tmux`; both consumers already can import it; trivially movable | S:70 R:85 A:75 D:70 |
| 3 | Confident | Linux package-manager probe set and order: apt-get → dnf → yum → pacman → zypper → apk, first found wins, generic fallback | Covers the mainstream distro families; order matters only on multi-manager hosts (rare); easily extended | S:60 R:90 A:80 D:65 |
| 4 | Confident | Daemon-start error carries BOTH the install command and an `rk doctor` pointer (backlog's "or" read as inclusive) | Both halves are cheap, non-conflicting, and match the doctor-style-hint intent; wording is trivially reversible | S:55 R:90 A:70 D:60 |
| 5 | Confident | Linux hints carry a `sudo` prefix (brew's stays bare, per Homebrew convention) | Fresh-VM target audience typically needs root for system package managers; a copy-paste hint should work as-is | S:45 R:95 A:70 D:55 |
| 6 | Confident | Precheck placed at the top of `Start`/`StartWithBinary`, before `IsRunning`/port-guard/socket-reap | Those steps also shell out to tmux and misbehave without it; fail-fast is the point of the change | S:75 R:85 A:80 D:75 |

6 assumptions (1 certain, 5 confident, 0 tentative, 0 unresolved).

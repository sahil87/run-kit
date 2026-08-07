# Plan: tmux Guard Shim Update Resilience

**Change**: 260807-8qvc-tmux-guard-shim-update-resilience
**Intake**: `intake.md`

## Requirements

### rk tmux guard shim: transient rk unavailability

#### R1: Shim probes a briefly-unavailable rk path before giving up
The shim rendered by `tmuxShimScript` (`app/backend/cmd/rk/tmux_guard.go`) SHALL,
when the embedded absolute rk path is not an executable file, poll that path for
approximately **3 seconds** (15 probes, 0.2s apart) before treating it as
unavailable. As soon as the path is executable the shim SHALL process-replace
itself with `"<abs-rk>" tmux-guard "$@"`, passing the original argv verbatim —
identical to today's behavior. The probe loop MUST NOT sleep at all when the rk
path is executable on the first test (the steady-state path).

- **GIVEN** an installed shim whose embedded rk path is executable
- **WHEN** any `tmux …` command resolves through the shim
- **THEN** it execs `rk tmux-guard` with the original argv and no measurable delay

- **GIVEN** an installed shim whose embedded rk path is momentarily missing
  (a package-manager relink window) and reappears within the probe budget
- **WHEN** a `tmux …` command resolves through the shim
- **THEN** the shim stalls until the path reappears and then execs
  `rk tmux-guard` with the original argv — never exiting 127

#### R2: Fail open to the real tmux after the probe budget
When the probe budget is exhausted and the embedded rk path is still not
executable, the shim SHALL resolve the **real tmux** itself with a POSIX-sh
`PATH` walk and process-replace itself with it, passing the original argv
verbatim. The walk SHALL mirror `findRealTmux`'s exclusions:

- skip empty `PATH` entries;
- skip the rk shims directory (`$HOME/.local/share/rk/shims`);
- skip any candidate that sniffs as an rk shim (the `tmuxShimMarker` ownership
  marker or a `tmux-guard` invocation, the same two patterns
  `sniffsAsTmuxShim` uses) so a relocated shim copy can never exec-loop;
- skip any candidate whose sniff could not be *completed* — exec'ing a copy of
  the shim fork-loops without bound, so an unverifiable candidate MUST be
  treated as suspect rather than as the real tmux;
- the first surviving executable regular file named `tmux` wins.

When no real tmux is found, the shim SHALL print an actionable message to stderr
and exit non-zero — the same terminal state `findRealTmux`'s error produces today.

- **GIVEN** a permanently dangling embedded rk path and a real `tmux` on `PATH`
- **WHEN** a `tmux …` command resolves through the shim
- **THEN** after ~3s the shim execs the real tmux with the original argv

- **GIVEN** a `PATH` whose only `tmux` is the rk shim itself (or a relocated copy
  of it)
- **WHEN** the fail-open walk runs
- **THEN** that candidate is skipped and — with no other candidate — the shim
  exits non-zero with a "no real tmux found on PATH" message, never exec-looping

#### R3: Minimal bare `kill-server` backstop on the fail-open path
Before failing open, the shim SHALL refuse **only** the literal bare
`kill-server` shape: some argv token exactly equal to `kill-server` while no
token beginning `-L` or `-S` is present. On refusal it SHALL print a refusal
naming the canonical remedy (`tmux -L <scratch-name> kill-server`) to stderr and
exit 1. The check MUST remain a flat token scan — tmux's argv grammar (global-flag
window, `;`-chains, prefix matching) MUST NOT be reimplemented in shell.
`RK_TMUX_GUARD=off` SHALL bypass the backstop, mirroring the Go guard's
documented per-invocation escape hatch.

- **GIVEN** a dangling rk path and argv `["kill-server"]`
- **WHEN** the shim reaches the fail-open path
- **THEN** it refuses, exits 1, and never execs the real tmux

- **GIVEN** a dangling rk path and argv `["-L", "scratch", "kill-server"]`,
  or `RK_TMUX_GUARD=off` with argv `["kill-server"]`
- **WHEN** the shim reaches the fail-open path
- **THEN** the invocation passes to the real tmux

#### R4: Fail-open is observable, the probe stall is silent
On the fail-open path (and only there) the shim SHALL emit exactly **one**
one-line stderr notice naming the unreachable rk path and stating that the guard
is bypassed for this invocation. The probe stall itself SHALL be silent, and the
steady-state pass path SHALL emit nothing. A backstop refusal SHALL NOT also
claim the invocation fell open (the backstop is evaluated before the notice).

- **GIVEN** a dangling rk path and a passing argv
- **WHEN** the shim fails open
- **THEN** stderr carries exactly one notice line naming the rk path, and stdout
  carries only the real tmux's own output

### rk tmux guard shim: contract invariants

#### R5: Shim identity, doctor parseability, and Constitution constraints are preserved
The rewritten script SHALL remain:

- `#!/bin/sh` POSIX shell with no bashisms (the one documented deviation is
  fractional `sleep`, universal on the Linux/macOS install base);
- **marker-owned** — the `# {tmuxShimMarker}` comment stays on line 2, verbatim,
  so `agent-setup` ownership detection, `sniffsAsTmuxShim`, and doctor's marker
  check keep working;
- **parseable by `tmuxShimExecTarget`** — the **first** line whose trimmed form
  begins `exec ` MUST be the rk exec line and MUST carry the **literal** absolute
  rk path inside its first double-quote pair, so `tmuxShimExecTarget` and every
  `rk doctor` state that depends on it are unchanged. The fail-open exec of the
  resolved real tmux MUST come after it in file order;
- **Constitution §I** — the only Go-interpolated value derived from the
  environment stays the `validateHookPath`-gated rk path; every other
  interpolated value is a compile-time constant, and the shims directory is
  composed at run time from the `$HOME` shell variable;
- **Constitution §II** — no new persistent state; the shim remains a single
  derived-content file, and `agent_setup.go`'s install/uninstall contract
  (diff + consent, marker ownership, PATH block, `--dry-run`/`--yes`) is
  untouched, so rollout stays "re-run `rk agent-setup`".

- **GIVEN** the script rendered by `tmuxShimScript("/opt/homebrew/bin/run-kit")`
- **WHEN** `tmuxShimExecTarget` parses it
- **THEN** it returns `/opt/homebrew/bin/run-kit`, and the script contains the
  marker and the substring `exec "/opt/homebrew/bin/run-kit" tmux-guard "$@"`

- **GIVEN** the same script installed as a stray `tmux` on `PATH`
- **WHEN** `findRealTmux` scans
- **THEN** the stray copy is skipped by the content sniff

#### R6: Test coverage never touches a live tmux server
New and updated tests SHALL cover the script shape (marker, exec-target parse
round trip, first-`exec`-line ordering) and the runtime behavior (probe, retry
recovery, fail-open, backstop, hatch, no-real-tmux) by **executing the rendered
shim** against stub `rk`/`tmux` executables in `t.TempDir()` `PATH`s. No test
SHALL start, attach to, or kill a tmux server, and no test SHALL run against the
real `$HOME`.

- **GIVEN** the backend test suite
- **WHEN** `go test ./...` runs in `app/backend`
- **THEN** every shim behavior above is exercised against temp-dir stubs only,
  and the suite passes

### Non-Goals

- The `rk tmux-guard` Go decision logic (block rule, argv grammar, exec env,
  escape hatch) is unchanged — this change is entirely about what the shell shim
  does when rk itself is unreachable.
- `agent_setup.go`'s install/uninstall machinery is unchanged; rollout is the
  existing idempotent content-diff replace.
- `tmuxShimExecTarget` and the `rk doctor` states are unchanged (R5 keeps the
  script parseable rather than changing the parser).
- No rk-owned binary copy under `~/.local/share/rk/bin/` with atomic rename, and
  no attempt to make Homebrew's relink atomic — both were rejected in the
  driving conversation.

### Design Decisions

#### Fail open, not closed, when rk is unreachable
**Decision**: after a ~3s probe budget the shim runs the real tmux unguarded
(minus a crude bare-`kill-server` backstop) rather than refusing to run.
**Why**: the shim fronts **every** PATH-resolved `tmux` on the machine, so a hard
127 during an upgrade is a machine-wide outage — observed live, when a fab
operator's `tmux list-panes` calls started failing mid-update. The guard exists to
catch *accidental* agent `kill-server`; the chance of one firing inside a
few-second window is negligible next to the certainty of breaking every tmux
caller on every update. Availability wins.
**Rejected**: failing closed (turns a routine upgrade into a machine-wide tmux
outage); an rk-owned binary copy at `~/.local/share/rk/bin/` with atomic rename
(~20MB duplicate binary, version skew, and a refresh seam that must fire after
every upgrade); making Homebrew's relink atomic (outside rk's control).
*Introduced by*: `260807-8qvc-tmux-guard-shim-update-resilience`

#### The literal rk path is repeated in the first `exec` line
**Decision**: the script assigns `rk="<abs-rk>"` for its probes and messages, but
the exec line spells the **literal** path again — `exec "<abs-rk>" tmux-guard "$@"`
— rather than `exec "$rk" …`.
**Why**: `tmuxShimExecTarget` reads the first double-quoted value on the first
`exec `-prefixed line, and `rk doctor` builds four states on that value (missing
target, non-executable target, unparseable, healthy). Keeping the literal there
leaves the parser and every doctor state untouched, which is the smaller and
safer diff. Both occurrences come from the same Go argument, so they cannot drift.
**Rejected**: teaching `tmuxShimExecTarget` to resolve a `rk="…"` assignment
(more parser surface and new doctor pins for a cosmetic gain); dropping the
variable and spelling the literal at all four use sites (noisier, and the stderr
messages still want it).
*Introduced by*: `260807-8qvc-tmux-guard-shim-update-resilience`

#### An unverifiable candidate is skipped, not exec'd
**Decision**: the shell walk sniffs each candidate with a single
`grep -qF -e <marker> -e tmux-guard` and discriminates its exit status three
ways — 0 (it is a shim) and ≥2/127 (the sniff itself failed) both skip the
candidate; only exit 1, a clean miss, earns an exec.
**Why**: the shell walk's failure mode is not symmetric with `findRealTmux`'s.
When Go's sniff returns false on a read error it merely execs a file that then
fails; when the shell's sniff misfires it execs a *relocated copy of this very
script*, which probes, fails open, and execs the copy again — an unbounded
fork loop fronting every tmux call on the machine. A false skip degrades to a
clear "no real tmux found" error, so the two directions are nowhere near
equally bad. Using one tool rather than a `head | grep` pipeline is what makes
the status unambiguous (a pipeline reports only the last command's status, so a
missing `head` reads as a clean miss).
**Rejected**: mirroring `sniffsAsTmuxShim`'s 512-byte head bound via
`head -c 512 | grep -q` (the pipeline hides `head`'s failure and reintroduces
the fork loop — this exact shape looped during smoke testing, and it adds a
second non-POSIX flag); reading the head with the shell's own `read`/`$(…)`
(unbounded on a binary with no early newline, and bash's sh mode warns on NUL
bytes for every candidate).
*Introduced by*: `260807-8qvc-tmux-guard-shim-update-resilience`

#### The fail-open backstop is deliberately crude
**Decision**: the fallback guard is a flat scan for a token equal to
`kill-server` with no `-L*`/`-S*` token, honoring `RK_TMUX_GUARD=off`; it does not
model tmux's global-flag window, `;`-chains, or prefix abbreviation.
**Why**: it runs only in a few-second window when rk is unreachable, and both
failure directions are acceptable there — over-blocking costs one retry with an
explicit socket, under-blocking is no worse than the fully-unguarded fallback it
replaces. Reimplementing the argv grammar in shell would duplicate
`tmuxGuardBlocks` in a second language with no test parity.
**Rejected**: no backstop at all (leaves the exact accident the guard exists for
completely unguarded during updates); a faithful shell port of `tmuxGuardBlocks`
(a second, untestable copy of a subtle grammar).
*Introduced by*: `260807-8qvc-tmux-guard-shim-update-resilience`

## Tasks

### Phase 1: Setup

- [x] T001 Add the shim's named constants to `app/backend/cmd/rk/tmux_guard.go` — `tmuxShimProbeAttempts` (15), `tmuxShimProbeInterval` ("0.2"), and `rkShimsRelDir` (`.local/share/rk/shims`) — and re-express `rkShimsDir` in terms of `rkShimsRelDir` so the Go helper and the shim's `$HOME`-relative walk share one source <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 Rewrite `tmuxShimScript` in `app/backend/cmd/rk/tmux_guard.go` as an indexed-verb raw-string template: marker on line 2, `rk="<abs-rk>"`, a bounded probe loop (`tmuxShimProbeAttempts` × `tmuxShimProbeInterval`, no sleep when rk is already executable), then the literal-path `exec "<abs-rk>" tmux-guard "$@"` as the script's first `exec ` line <!-- R1 --> <!-- rework: prefix every shim shell variable `_rk_*` — POSIX sh keeps the export attribute when assigning to a caller-exported name, so generic names (rk, n, real, c…) leak shim values into the exec'd process env, including the steady-state hot path (review should-fix 2) -->
- [x] T003 Extend the same template with the fail-open stage in this order: the `RK_TMUX_GUARD`-aware bare-`kill-server` backstop (refuse → exit 1), the `set -f` + `IFS=:` `PATH` walk mirroring `findRealTmux`'s exclusions (empty entries, shims dir via normalized-path comparison, whole-file `grep` shim sniff with three-way exit discrimination: 0 = shim → skip, ≥2/127 = sniff failed → skip, 1 = real candidate), the single-line stderr fail-open notice immediately before `exec "$real" "$@"`, and the non-zero "no real tmux found" exit <!-- R2 --> <!-- R3 --> <!-- R4 --> <!-- rework: (a) MUST-FIX — fail-open exec forwards RK_TMUX_GUARD verbatim; `unset RK_TMUX_GUARD` before exec "$real" so the per-invocation hatch cannot be baked into a new server's global env (review must-fix 1, mirrors tmuxGuardExecEnv strip); (b) move the notice to just before the exec so the no-real-tmux path doesn't print a contradictory "running unguarded" line (nice-to-have 5); (c) normalize the shims-dir comparison against trailing-slash/doubled-separator PATH entries (nice-to-have 7); (d) description corrected — implementation uses the fork-loop-safe whole-file grep sniff, not head -c 512 (should-fix 4) -->
- [x] T004 Update the `tmuxShimScript` / `tmuxShimExecTarget` doc comments in `app/backend/cmd/rk/tmux_guard.go` to state the retry → fail-open → backstop contract and the first-`exec`-line parser coupling that pins the literal path <!-- R5 --> <!-- rework: also reword the stale doctor.go hints (doctor.go:126, :131, doc comments :80/:113) — a dangling/non-executable embedded rk path no longer means "every tmux command fails with rk: not found"; it now means ~3s stall then an unguarded run. Wording-only change, no doctor state changes, no doctor_test pins on those substrings (review should-fix 3) -->

### Phase 3: Integration & Edge Cases

- [x] T005 Add script-shape pins to `app/backend/cmd/rk/tmux_guard_test.go`: marker present, `tmuxShimExecTarget` round trip, the literal `exec "<rk>" tmux-guard "$@"` substring, `#!/bin/sh` first line, and that the rk exec line precedes the fail-open `exec "$real"` line in file order <!-- R5 -->
- [x] T006 Add a `t.TempDir()` execution harness to `app/backend/cmd/rk/tmux_guard_test.go` (minimal utility `PATH` dir with `sh`/`sleep`/`head`/`grep`, stub `rk` and stub real `tmux` that identify themselves on stdout) and cover: steady-state exec of rk, recovery when rk appears mid-probe, fail-open exec of the real tmux, and the single stderr notice <!-- R1 --> <!-- R2 --> <!-- R4 -->
- [x] T007 [P] Cover the fail-open edge cases in `app/backend/cmd/rk/tmux_guard_test.go`: bare `kill-server` refused with exit 1, `-L scratch kill-server` passing, `RK_TMUX_GUARD=off` bypassing the backstop, a shim-sniffing stray `tmux` skipped, and the non-zero "no real tmux found" exit <!-- R2 --> <!-- R3 --> <!-- rework: (a) the RK_TMUX_GUARD=off subtest must additionally assert the exec'd environment carries NO RK_TMUX_GUARD entry (must-fix 1 — the stub tmux can dump its env); (b) also assert no `_rk_*` shim variables leak into the exec'd env even when caller-exported (should-fix 2); (c) remove the dead `shimRun.workdir` field — no caller sets it (nice-to-have 6) -->
- [x] T008 [P] Re-run and, where the new content requires it, adjust the existing pins in `app/backend/cmd/rk/doctor_test.go` and `app/backend/cmd/rk/agent_setup_test.go` that embed `tmuxShimScript` output, confirming every `rk doctor` shim state and the install/uninstall round trip still hold <!-- R5 -->

### Phase 4: Polish

- [x] T009 Run the verification gates for the touched package — `just test-backend` (or `cd app/backend && go test ./...`), `go vet ./...`, and `gofmt -l` — and fix anything they surface <!-- R6 --> <!-- rework: re-run after the cycle-1 fixes -->

## Execution Order

- T001 blocks T002 (the template consumes the constants); T002 blocks T003 and T004 (same function).
- T005–T008 all depend on T003 (the final script content); T007 and T008 are independent of each other once T006's harness exists.
- T009 runs last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `tmuxShimScript` renders a probe loop bounded by `tmuxShimProbeAttempts` × `tmuxShimProbeInterval` (~3s) that execs `rk tmux-guard` with the original argv as soon as the embedded path is executable, and sleeps zero times when it already is
- [x] A-002 R2: the rendered shim resolves and execs the real tmux itself after the probe budget, skipping empty `PATH` entries, the rk shims dir, and shim-sniffing candidates
- [x] A-003 R3: the fail-open path refuses a literal bare `kill-server` with no `-L`/`-S` and exits 1, and passes every other shape
- [x] A-004 R4: the fail-open path emits exactly one one-line stderr notice naming the unreachable rk path; the probe stall and the steady-state path emit nothing
- [x] A-005 R5: `tmuxShimExecTarget` still returns the embedded rk path from the rendered script, `agent_setup.go` is unmodified, and every `rk doctor` shim state is unchanged (`doctor.go` carries a wording-only hint correction — a dangling embedded path now means a ~3s stall then an unguarded run, not `rk: not found`)

### Behavioral Correctness

- [x] A-006 R1: a `tmux` invocation landing inside a simulated relink window (rk path absent, then restored) completes through `rk tmux-guard` instead of exiting 127
- [x] A-007 R2: a permanently dangling rk path yields the real tmux's own behavior and exit code, not a shim failure
- [x] A-008 R3: `RK_TMUX_GUARD=off` bypasses the fail-open backstop, preserving the documented per-invocation escape hatch
- [x] A-015 R3: the environment handed to the fail-open `exec "$real"` carries no `RK_TMUX_GUARD` entry and no shim-internal variables, so the hatch cannot be baked into a new server's global environment (mirrors the Go guard's `tmuxGuardExecEnv` strip)

### Scenario Coverage

- [x] A-009 R2: a relocated copy of the shim on `PATH` is skipped by the whole-file `grep` sniff (three-way exit discrimination — only a clean exit-1 miss earns an exec), so the fail-open walk cannot exec-loop
- [x] A-010 R2: a `PATH` with no real tmux behind the shim exits non-zero with an actionable message rather than hanging or exec-looping
- [x] A-011 R5: the rendered script keeps `#!/bin/sh` on line 1, the ownership marker on line 2, and the literal-path rk `exec` line ahead of the fail-open exec of the resolved real tmux

### Edge Cases & Error Handling

- [x] A-012 R2: `PATH` entries are neither glob-expanded nor split on whitespace during the walk (`set -f` plus `IFS=:`), and a candidate whose sniff cannot be completed is skipped rather than exec'd
- [x] A-013 R4: a backstop refusal does not also print the fail-open notice

### Code Quality

- [x] A-014 Pattern consistency: the new constants, doc comments, and tests follow the surrounding `cmd/rk` conventions (constant-per-magic-value, narrative doc comments explaining *why*, table/subtest-driven tests)
- [x] A-015 No unnecessary duplication: the shims-directory path has one source (`rkShimsRelDir`, shared by `rkShimsDir` and the script), and the ownership marker reaches the script's sniff from `tmuxShimMarker` rather than a second literal
- [x] A-016 No magic values: probe count, probe interval, and the shims-dir suffix are named constants, not inline literals in the template
- [x] A-017 R6: no test starts, attaches to, or kills a tmux server, and none runs against the real `$HOME` — every stub lives in `t.TempDir()`
- [x] A-018 R6: `go test ./...`, `go vet ./...`, and `gofmt -l` are clean for `app/backend`

### Security

- [x] A-019 R5: the only environment-derived value interpolated into the script remains the `validateHookPath`-gated rk path (Constitution §I); every other interpolated value is a compile-time constant, and no shell string is constructed from user input
- [x] A-020 R5: the change introduces no persistent state and no new file (Constitution §II); the shim remains a single derived-content artifact rolled out by re-running `rk agent-setup`

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. (`tmuxShimSniffLimit`/`sniffsAsTmuxShim` remain load-bearing for the Go-side `findRealTmux` walk; `tmuxShimExecTarget` and every `rk doctor` shim state are deliberately preserved by R5; the only removal was the inline `.local/share/rk/shims` path literal in `rkShimsDir`, already folded into `rkShimsRelDir` by T001.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Probe loop is `while [ ! -x "$rk" ] && [ "$n" -lt 15 ]; do sleep 0.2; n=$((n + 1)); done`, so the steady-state path tests once and never sleeps | The intake fixes the budget (~3s in 0.2s sleeps); testing the condition before sleeping is the only shape that keeps the happy path free, and it is trivially reversible | S:85 R:95 A:90 D:85 |
| 2 | Confident | The literal rk path appears twice — in `rk="…"` and again in the first `exec "…" tmux-guard "$@"` line — to satisfy `tmuxShimExecTarget` without touching the parser | Intake assumption 4 names keep-parseable as the front-runner; both occurrences come from one Go argument so they cannot drift, and the alternative adds parser surface plus new doctor pins | S:70 R:90 A:85 D:65 |
| 3 | Confident | The shell sniff is a bare `grep -qF -e "{marker}" -e tmux-guard "$c"` whose exit status is discriminated three ways — 0 (shim) and >=2/127 (sniff failed) both skip the candidate, only 1 (clean miss) earns an exec | Found while smoke-testing: the first draft piped `head -c 512` into `grep` and treated any non-match as "real tmux", so a broken sniff exec'd a relocated copy of the script and **fork-looped without bound**. Dropping `head` leaves one tool whose failure is unambiguous, removes a second POSIX deviation, and makes the unsafe direction unreachable; the cost is scanning a whole candidate once on a cold path | S:70 R:85 A:85 D:70 |
| 4 | Certain | The `PATH` walk runs under `set -f` with `IFS=:` (both restored after the loop) | Without `set -f` a `PATH` entry containing a glob character would be pathname-expanded during word splitting — a silent correctness bug; the guard is one line and standard POSIX practice | S:80 R:95 A:95 D:85 |
| 5 | Confident | The backstop is evaluated **before** the fail-open stderr notice, so a refused invocation never claims it fell open | Not specified in the intake; ordering is free and the alternative prints a contradictory pair of messages | S:55 R:95 A:80 D:60 |
| 6 | Certain | Probe count, probe interval, and the shims-dir suffix become named Go constants (`tmuxShimProbeAttempts`, `tmuxShimProbeInterval`, `rkShimsRelDir`), with the template built from an indexed-verb raw string | `code-quality.md` bans magic numbers, and `rkShimsDir` already needed the suffix — sharing it removes the duplicate; indexed verbs keep a six-argument `Sprintf` readable | S:85 R:95 A:95 D:90 |
| 7 | Certain | Behavioral tests execute the rendered shim with `exec.CommandContext` (60s bound) against stub `rk`/`tmux` executables and a minimal utility `PATH` dir built in `t.TempDir()`; the seven fail-open subtests run `t.Parallel()` with **every fixture written by the parent first** | The memory file's documented rule for this file plus the existing `writeStub` pattern; `code-review.md` requires a timeout on every spawn. Parallelism keeps the seven ~3s probe budgets to ~3s wall — but writing an executable in one goroutine while another forks makes the fork inherit the write fd and the exec fail `ETXTBSY` (observed), so all writes must precede the first parallel exec | S:85 R:90 A:95 D:85 |
| 8 | Certain | The fail-open backstop honors `RK_TMUX_GUARD=off` | Memory records the hatch as a SHALL ("bypass the guard for that one invocation"); a backstop that ignored it would silently break the documented contract precisely during an upgrade | S:70 R:95 A:90 D:75 |

8 assumptions (5 certain, 3 confident, 0 tentative).

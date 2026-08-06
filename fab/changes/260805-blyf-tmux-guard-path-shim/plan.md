# Plan: tmux Guard PATH Shim

**Change**: 260805-blyf-tmux-guard-path-shim
**Intake**: `intake.md`

## Requirements

### Guard: Decision Logic

#### R1: Argv parse and block rule
`rk tmux-guard` SHALL parse the tmux argv far enough to decide block vs pass, without executing tmux. Parsing MUST mirror tmux's own command-line grammar closely enough that data arguments never read as command words:

- Global flags precede the first command word. Value-taking global flags are `-c -f -L -S -T` (value attached to the token or in the next token; flags may be clustered, e.g. `-2uLfoo`); all other single-letter flags are bare. A `--` token ends global-flag parsing. Presence of `-L` or `-S` in the global-flag region sets "explicit socket".
- Command chains follow tmux `cmd_parse_from_arguments` semantics: a token that is exactly `;`, or ends with an unescaped `;`, terminates the current command (a token ending `\;` carries a literal `;` and does NOT terminate). The first token of each (non-empty) command segment is that segment's command word; all other tokens are data and MUST NOT match.
- A command word matches `kill-server` when it equals `kill-server` or is an unambiguous tmux prefix of it (a prefix of `kill-server` of length ≥ 8, i.e. `kill-ser` and longer — shorter prefixes are ambiguous with `kill-session`).
- **Block rule (v1)**: blocked ⇔ (some command word matches kill-server) AND (no explicit `-L`/`-S`). The rule is `$TMUX`-independent. `kill-session`/`kill-window`/`kill-pane` always pass.

- **GIVEN** argv `["kill-server"]` or `["-u", "kill-ser"]` **WHEN** decided **THEN** blocked
- **GIVEN** argv `["-L", "scratch", "kill-server"]` or `["-Lscratch", "kill-server"]` or `["-S", "/tmp/s", "kill-server"]` **WHEN** decided **THEN** pass
- **GIVEN** argv `["send-keys", "-t", "x", "tmux kill-server", "Enter"]` **WHEN** decided **THEN** pass (data, not a command word)
- **GIVEN** argv `["new-window", ";", "kill-server"]` or `["display;", "kill-server"]` **WHEN** decided **THEN** blocked (chained command word)
- **GIVEN** argv `["send-keys", "kill-server\\;", "Enter"]` (escaped semicolon) **WHEN** decided **THEN** pass
- **GIVEN** argv `["kill-session", "-t", "x"]` / `["kill-window"]` / `["kill-pane"]` **WHEN** decided **THEN** pass

#### R2: Guard subcommand — exec passthrough, block exit, escape hatch
A new `rk tmux-guard [tmux args...]` cobra subcommand SHALL front the real tmux binary:

- `DisableFlagParsing: true` + `Args: cobra.ArbitraryArgs` so tmux flags reach the guard verbatim (never parsed by cobra).
- **Escape hatch**: when `RK_TMUX_GUARD=off` is in the environment, the guard SHALL exec the real tmux immediately with no decision and no message. The hatch is strictly per-invocation: `RK_TMUX_GUARD` is stripped from the exec env (see the exec-env Design Decision) so a server started under the hatch does not inherit it globally.
- **Pass**: exec the real tmux via a process-replacing exec (`syscall.Exec`) with the original argv slice appended verbatim and the current environment adjusted only for safety — `$TMUX` restored, `RK_TMUX_GUARD` stripped (see Design Decisions) — preserving argv, stdio, and exit code. No shell string is ever constructed (Constitution §I — see Design Decisions for the exec.CommandContext deviation).
- **Block**: print exactly the intake's multi-line BLOCKED message to stderr and exit non-zero (exit 1, operational class per the toolkit exit-code convention) without executing tmux.
- The exec call MUST sit behind an injectable seam so unit tests never execute a real binary.

- **GIVEN** `RK_TMUX_GUARD=off` and argv `["kill-server"]` **WHEN** run **THEN** the exec seam is invoked with the real tmux path and argv, and no message is printed
- **GIVEN** `RK_TMUX_GUARD` set to any value (off-hatch or not) and a passing argv **WHEN** run **THEN** the env handed to the exec seam carries no `RK_TMUX_GUARD` entry
- **GIVEN** a blocked argv **WHEN** run **THEN** stderr carries the `rk tmux-guard: BLOCKED:` message naming `-L/-S > $TMUX > TMUX_TMPDIR` precedence and the `RK_TMUX_GUARD=off` bypass, the exec seam is NOT invoked, and the exit code is 1
- **GIVEN** a passing argv **WHEN** run **THEN** the exec seam receives `realTmux` as path and `[realTmux, args...]` as argv

#### R3: Real tmux resolution
The guard SHALL resolve the real tmux binary by scanning `PATH` while skipping the shim itself:

- PATH entries equal to the rk shims directory (`~/.local/share/rk/shims`) are skipped.
- Defense against recursion regardless of shim location: a candidate whose content sniffs as the rk shim (contains the `rk tmux-guard` invocation / managed-by marker in its head) is skipped.
- The first remaining executable regular file named `tmux` wins. If none is found, the guard SHALL fail with a clear error (never exec itself).

- **GIVEN** a PATH of `[shimsDir, realDir]` with a shim in shimsDir and a stub executable `tmux` in realDir **WHEN** resolved **THEN** the realDir stub is returned
- **GIVEN** a PATH containing only the shim **WHEN** resolved **THEN** an error naming the missing real tmux is returned

### Install: `rk agent-setup` shim artifact

#### R4: Shim file + PATH block install/uninstall
`rk agent-setup` SHALL gain a second managed artifact — the tmux guard shim — with the same UX contract as the hooks merge (diff, consent via the existing `consent`/`authorizeWrite` machinery, idempotent replace-in-place, exact removal on `--uninstall`):

- **Shim file** at `~/.local/share/rk/shims/tmux`, mode 0755, containing a `#!/bin/sh` script with the `# managed-by: rk agent-setup (tmux guard shim)` ownership marker that `exec`s `"<abs-rk-path>" tmux-guard "$@"` (absolute path resolved by the existing `resolveRkPath` and validated by `validateHookPath` — see Design Decisions). A pre-existing marker-less `tmux` file at that path is left untouched with a skip note (rk only overwrites files it owns).
- **PATH block**: a marker-owned block appended to shell startup files that non-interactive shells read:

  ```sh
  # >>> rk tmux guard >>>
  export PATH="$HOME/.local/share/rk/shims:$PATH"
  # <<< rk tmux guard <<<
  ```

  Target files: `.zshenv` in `$ZDOTDIR` when set, else `~` (always; created if missing — when `ZDOTDIR` is set zsh reads `$ZDOTDIR/.zshenv` and never `~/.zshenv`, so the home copy would be inert), `~/.bashrc` (always; created if missing), `~/.bash_profile` (only when it already exists — creating it would shadow `~/.profile` for login bash). Upsert semantics: an existing marker block is replaced in place; otherwise the block is appended; re-runs are byte-idempotent and never duplicate.
- **`--uninstall`** removes the shim file (marker-owned only; marker-less skipped with a note) and strips the marker block from every target file that carries it. Absent artifacts are silent no-ops.
- **Per-file resilience**: a file that cannot be READ (unreadable, or a directory occupying its path) is skipped with a note and the run continues — exactly like the malformed-marker-block skip. This holds for each startup file (an unreadable `.zshenv` must not stop `.bashrc` from being processed) and for the shim path on `--uninstall` (a read-failing shim must not leave the PATH blocks in place).
- All paths are parameterized by home-dir and zdotdir arguments (`$ZDOTDIR` is read once at the `runAgentSetup` call boundary, like the home dir) so tests run against temp dirs; the installer is never executed against the real home during apply.

- **GIVEN** a fresh temp home **WHEN** installed with consent **THEN** the shim exists (executable, marker-owned, exec'ing `tmux-guard`), `.zshenv` and `.bashrc` carry the block, and no `.bash_profile` is created
- **GIVEN** an installed home **WHEN** installed again **THEN** every file is byte-identical and "nothing to do" is reported (no prompt)
- **GIVEN** a home with a user-edited marker block **WHEN** re-installed **THEN** the block is replaced in place, exactly once
- **GIVEN** an installed home **WHEN** `--uninstall` runs with consent **THEN** the shim file is gone and every startup file has the block removed with all other content intact

### Doctor

#### R5: `rk doctor` shim check
`rk doctor` SHALL gain a `tmux-guard shim` check reporting install state and PATH resolution:

- Shim absent → OK with an informational note (the shim is optional; not-installed must not fail doctor).
- Shim present but its EMBEDDED rk path (the quoted exec target on the shim's `exec` line) no longer exists — or the exec line is unparseable — → FAIL with a re-install hint (`rk agent-setup`). A dangling rk (the recorded brew rk→run-kit rename incident) breaks every tmux command on the machine with `rk: not found`; doctor must not vouch for that install.
- Shim present (embedded rk alive) AND `LookPath("tmux")` resolves (after symlink evaluation) to the shim → OK.
- Shim present but PATH resolves tmux elsewhere (or not at all) → FAIL with a remediation hint (PATH-ordering regression — open a new shell / check the `rk tmux guard` block).
- The check is pure over an injected `(home, lookPath)` pair so tests never depend on the host PATH. `doctorCheck` gains an optional `note` field (JSON `omitempty`; human renderer appends it) to carry the informational state.

- **GIVEN** a temp home with no shim **WHEN** checked **THEN** OK with a "not installed" note
- **GIVEN** a temp home with the shim and a lookPath returning the shim path **WHEN** checked **THEN** OK
- **GIVEN** a temp home with the shim and a lookPath returning another path **WHEN** checked **THEN** FAIL with a PATH-ordering hint
- **GIVEN** a temp home with a shim whose embedded exec target does not exist **WHEN** checked **THEN** FAIL with a hint naming the dangling path and `rk agent-setup`

### Non-Goals

- No guarding of `kill-session`/`kill-window`/`kill-pane` (scoped kills — intake v1 scope).
- No Claude Code PreToolUse hook (separate mechanism, separate change).
- No guarding of absolute-path tmux invocations (`/usr/bin/tmux kill-server`) — the shim targets the accidental PATH case.
- No guarding of tmux `command-alias` expansions — a user-configured alias (e.g. `set -s command-alias[100] ks='kill-server'`) expands server-side AFTER the guard has already passed `tmux ks` as an unrecognized command word, so an aliased kill-server bypasses the guard. Aliases are deliberate per-user configuration, not the accidental death vector the shim targets; closing this would require querying the live server's option state per invocation.
- No guarding of nested-command forms — `tmux if-shell true kill-server`, `tmux confirm-before kill-server`, and `tmux run-shell 'tmux kill-server'` all pass the guard: only the outer command word of each `;`-separated segment is examined, and in these forms `kill-server` sits in a data/argument position that the wrapping command re-interprets server-side (or, for `run-shell`, in a shell string whose inner `tmux` may not even route through the shim). Same class as the command-alias bullet: these are deliberate constructions, not the accidental bare-`kill-server` vector the four incidents share; guarding them would require re-implementing each wrapper command's argument grammar.
- No defense against later PATH prepends in login-shell profiles — zsh reads `~/.zprofile` (and bash its profile files) AFTER `.zshenv`, so a later `eval "$(brew shellenv)"` there re-prepends `/opt/homebrew/bin` ahead of the shims dir and the real tmux wins again in login shells. Placement inside `.zshenv` cannot prevent this ordering; `rk doctor`'s PATH-resolution check is the detection surface (it FAILs when `tmux` no longer resolves to the shim).
- No live-tmux integration tests — decision logic is table-driven over argv slices; the exec path is tested against the injectable seam / stub executables only (tmux safety contract).

### Design Decisions

#### Process-replacing exec instead of exec.CommandContext for passthrough
**Decision**: The pass path uses `syscall.Exec` (process replacement) with an explicit argv slice and inherited environment, behind an injectable test seam.
**Why**: The guard is a transparent wrapper: tmux invocations are frequently long-lived interactive clients (attach), so any timeout is wrong by construction, and exec-replacement is the only mechanism that preserves stdio/TTY, signal delivery, and exit code with zero relay code. Argv-slice discipline is kept — no shell string is ever built — which honors the substance of Constitution §I; the intake explicitly allows this form.
**Rejected**: `exec.CommandContext` + stdio plumbing + exit-code copying — adds a supervising process in every tmux invocation, breaks signal/TTY semantics for interactive clients, and its mandatory timeout would sever attached sessions.
*Introduced by*: 260805-blyf-tmux-guard-path-shim

#### Shim embeds the absolute rk path (deviation from the intake's literal `exec rk` snippet)
**Decision**: The installed shim execs `"<abs-rk>" tmux-guard "$@"` using `resolveRkPath()` + `validateHookPath()` (the stable Homebrew symlink, never the Cellar path), not the bare name `rk`.
**Why**: A bare `rk` makes every tmux invocation depend on rk being on PATH at fire time; in a shell where it is not, tmux itself breaks with `rk: not found`. agent-setup's hook artifact already solved exactly this with the resolveRkPath/validateHookPath pattern (PR #320↔#321 skew rationale) — the shim mirrors the established managed-artifact contract, which the intake itself invokes ("the same contract agent-setup already implements"). The same shell-unsafe-char validation applies since the path sits inside double quotes in the script.
**Rejected**: the intake snippet's bare `exec rk tmux-guard "$@"` — simpler but PATH-fragile in precisely the non-interactive-shell environments this change targets.
*Introduced by*: 260805-blyf-tmux-guard-path-shim

#### Exec env restores $TMUX and strips RK_TMUX_GUARD
**Decision**: The pass path execs the real tmux with `os.Environ()` plus `TMUX=` restored from `tmux.OriginalTMUX` and minus every `RK_TMUX_GUARD` entry (via `tmuxGuardExecEnv`), never with the raw `os.Environ()`.
**Why (TMUX restore)**: `internal/tmux`'s `init()` runs `os.Unsetenv("TMUX")` process-wide (so the daemon's bare tmux subprocess calls target the default socket), and package `main` imports `internal/tmux` — the strip fires before any RunE. A raw `os.Environ()` therefore hands the real tmux an env with no `$TMUX`, silently retargeting every shimmed bare tmux command from the pane's own server to the DEFAULT server — the exact inversion of the guard's safety goal. `tmux.OriginalTMUX` (captured before `init()` by package-var ordering) is the established restoration seam; riff's `childEnv` and agent-hook's `tmuxSocketArgs` already use it.
**Why (RK_TMUX_GUARD strip)**: tmux copies the starting environment of a new server into that server's GLOBAL environment. Exec'ing `RK_TMUX_GUARD=off tmux new-session -d` through verbatim would bake `off` into every future pane of that server, so a later bare `kill-server` from any of them would pass the guard — the per-invocation hatch made transitively permanent (cycle-3 must-fix). Stripping the variable keeps the hatch scoped to exactly the command it was typed on.
**Rejected**: removing the `init()` strip (it exists for the daemon's targeting correctness and is out of this change's scope); passing `TMUX_TMPDIR` instead (does not carry the socket identity — `$TMUX` does); forwarding `RK_TMUX_GUARD` only on non-off values (the variable is the guard's own control knob — no tmux consumer exists, so forwarding any value has no upside).
*Introduced by*: 260805-blyf-tmux-guard-path-shim

#### Conservative global-flag window (BSD-getopt view)
**Decision**: `-L`/`-S` count as explicit socket only when they appear before the first command word (or attached/clustered there). Post-command flags (glibc getopt permutation would honor `tmux kill-server -L x` on Linux) are NOT credited.
**Why**: The documented tmux grammar places global flags first; crediting permuted flags requires reimplementing glibc getopt quirks. Mis-parsing in this direction can only produce a false-positive block whose message states the exact canonical remedy (`tmux -L <name> kill-server`) — safe and self-correcting.
**Rejected**: emulating glibc permutation — more code, platform-divergent behavior, and it weakens the guard on macOS where permutation does not happen.
*Introduced by*: 260805-blyf-tmux-guard-path-shim

## Tasks

### Phase 2: Core Implementation

- [x] T001 Create `app/backend/cmd/rk/tmux_guard.go`: argv parser (global-flag window incl. clustered/attached value flags and `--`; `;`-chain segmentation per tmux `cmd_parse_from_arguments` incl. `\;` escapes) and block decision (kill-server exact + unambiguous-prefix match, explicit-socket pass). Table-driven tests in `tmux_guard_test.go` over argv slices: flags before/after command word, attached `-Lname`, clustered flags, `;` chains, standalone `;`, trailing-`;` tokens, `\;` escapes, `send-keys` data strings containing "kill-server", scoped kills, ambiguous prefix `kill-se`, empty argv. <!-- R1 -->
- [x] T002 In `tmux_guard.go`: `findRealTmux(pathEnv, shimDir)` — split PATH, skip shims dir and shim-content candidates, return first executable `tmux`; error when none. Tests with stub executables in `t.TempDir()` PATHs (never real tmux): shim-first PATH resolves the stub, shim-only PATH errors, non-executable files skipped, recursion sniff skips a relocated shim copy. <!-- R3 -->
- [x] T003 In `tmux_guard.go`: `tmuxGuardCmd` (DisableFlagParsing, ArbitraryArgs, SilenceUsage) + `runTmuxGuard` with `RK_TMUX_GUARD=off` escape hatch, exact BLOCKED message via `exitCodeError{code:1}` (shell-init print-and-exit pattern), and injectable `tmuxGuardExec` seam; register in `root.go`. Tests: blocked path prints message + never execs, pass path execs with verbatim argv, off path skips decision, real-tmux-missing error. <!-- R2 --> <!-- rework cycle 3: must-fix — RK_TMUX_GUARD is exec'd through verbatim (tmuxGuardExecEnv, tmux_guard.go:299-305), so `RK_TMUX_GUARD=off tmux new-session` bakes off into the NEW SERVER's global environment (tmux copies the starting env; every future pane inherits it) and the per-invocation hatch becomes transitively permanent — a later bare kill-server from any pane of that server passes the guard, re-opening the exact death vector. Strip RK_TMUX_GUARD from the exec env (mirror the TMUX handling) + test pinning the exec env carries no RK_TMUX_GUARD -->
- [x] T004 In `app/backend/cmd/rk/agent_setup.go`: tmux-shim managed artifact — `tmuxShimScript(rkPath)`, `applyTmuxShim(sink, reader, home, rkPath, uninstall, cons)` wired into `runAgentSetup` after the agent loop; marker-block upsert/remove helpers for `~/.zshenv`/`~/.bashrc`/`~/.bash_profile`(existing-only); consent/diff via existing `authorizeWrite`/`renderArtifactDiff`; `--uninstall` removes shim + blocks. Tests in `agent_setup_test.go` over temp homes: fresh install, idempotent re-run, replace-in-place, marker-less skip, uninstall exactness, dry-run writes nothing, non-TTY refusal. <!-- R4 --> <!-- rework cycle 3: should-fix — (a) tmuxGuardStartupFiles (agent_setup.go:813-831) ignores ZDOTDIR: when set, zsh reads $ZDOTDIR/.zshenv and NEVER ~/.zshenv, so the zsh half of the install is inert while reporting success — honor ZDOTDIR when locating .zshenv (+ test); the ~/.zprofile ordering caveat (brew shellenv prepending over the shim in login shells) goes to plan § Non-Goals, not code. (b) per-file READ errors abort the whole run (applyTmuxGuardPathBlocks returns on readSkill error; removeTmuxShimFile hard-fails --uninstall on an unreadable shim), breaking the per-file skip-and-continue resilience the malformed-block path implements — treat read errors per-file like malformed blocks (skip note + continue, + tests) -->
- [x] T005 In `app/backend/cmd/rk/doctor.go`: add `Note` field to `doctorCheck` (omitempty; human renderer prints it) and `tmuxGuardShimCheck(home, lookPath)` wired into `runDoctorChecks`; absent→OK+note, resolves-to-shim→OK, mismatch→FAIL+hint. Tests in `doctor_test.go` for all three outcomes with temp homes and injected lookPath. <!-- R5 --> <!-- rework cycle 3: must-fix — tmuxGuardShimCheck (doctor.go:84-125) never verifies the shim's EMBEDDED rk path still exists, so doctor reports OK in the single most damaging mis-wiring: a dangling rk (the recorded brew rk→run-kit rename incident) breaks EVERY tmux command on the machine (`rk: not found`) while doctor prints OK and misdirects. The exec target sits between the first double-quote pair on the shim's exec line, in content the check already reads for the marker — extract it, stat it, FAIL with a `run rk agent-setup` re-install hint when missing (+ test) -->

### Phase 3: Integration & Edge Cases

- [x] T006 Full verification: `go test ./cmd/rk/...` (from `app/backend/`) green; `go build ./...` clean; `go vet ./cmd/rk/` clean. Confirm the new subcommand appears in help output (help-dump auto-captures it) and the BLOCKED message routes to ungated stderr (Principle 9). <!-- R1 R2 R3 R4 R5 --> <!-- rework cycle 3: re-verify after must-fix rework. should-fix — (a) add the ~/.zprofile ordering caveat (a later `eval "$(brew shellenv)"` in .zprofile prepends over the shims dir in login shells) to plan § Non-Goals; (b) add `run-kit/agent-state`: (modify) to intake.md § Affected Memory — its "hooks-only installer" description is now stale and hydrate needs the entry. Nice-to-haves (optional): inline the zero-consumer `osExit` seam (tmux_guard.go:364, matches shell_init.go's plain os.Exit pattern — already in § Deletion Candidates); findRealTmux effective-uid executability/fallthrough; atomic-write cleanup is repo-wide, defer -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The decision function blocks bare/`TMUX_TMPDIR`-style `kill-server` invocations and passes every explicit `-L`/`-S` form, with table-driven tests covering the grammar matrix
- [x] A-002 R2: `rk tmux-guard` is registered, execs the real tmux verbatim on pass, prints the exact BLOCKED message and exits 1 on block, and honors `RK_TMUX_GUARD=off` — verified end-to-end against a stub tmux (block exits 1 with the exact message; `RK_TMUX_GUARD=off` passes through). The exec **environment** is now correct too — see A-015
- [x] A-003 R3: Real-tmux resolution skips the shim (by directory and by content sniff) and errors when no real tmux exists — re-verified, including a non-canonical shims-dir spelling on PATH (`…/shims/./`), where the dir-equality skip misses but the content sniff still prevents self-resolution
- [x] A-004 R4: `rk agent-setup` installs/uninstalls the shim file and marker-owned PATH blocks idempotently with the existing diff+consent UX — now met. Install/uninstall/idempotence hold, the PATH block is gated on the shim being in place (`applyTmuxShim` returns early with a skip note on a declined write or a foreign marker-less file — `TestTmuxShimDeclinedWriteSkipsPathBlock`, `TestTmuxShimMarkerlessFileUntouched`), and a malformed marker region is refused per-file with a skip note while the other startup files still proceed — both the unterminated shape (`TestTmuxShimUnterminatedBlockRefused`) and, new this cycle, a duplicated begin marker (`TestTmuxShimDuplicateBeginRefused` end-to-end plus a `TestMarkerBlockUnterminatedIsError` table case), where the user line between the two begins survives install AND uninstall byte-identical. Also verified beyond the plan: symlinked startup files are written through (symlink preserved), existing file modes are preserved (0600 stays 0600), a changed rk path replaces the shim body, and a lost exec bit on an already-current rk-owned shim is repaired without consent (`TestTmuxShimReinstallRepairsLostExecBit`, dry-run previews rather than chmods). The cycle-3 per-file READ resilience now holds in both halves: an unreadable/dir-occupied startup file is skipped with a `cannot read` note while the other files still proceed (`TestTmuxShimUnreadableStartupFileContinues`), and an unreadable shim path no longer aborts `--uninstall` — the PATH blocks are still stripped (`TestTmuxShimUninstallUnreadableShimContinues`). `$ZDOTDIR` is honored for `.zshenv` and threaded as a parameter from the `runAgentSetup` boundary (`TestTmuxShimZDOTDIRHonored`; bash files stay home-anchored). One residual asymmetry remains (should-fix, not blocking): a per-file WRITE failure still aborts the run — notably a `$ZDOTDIR` naming a **nonexistent directory** (the common `ZDOTDIR="$HOME/.config/zsh"` convention with the dir uncreated), where `readSkill` tolerates the ENOENT as absent→`""` but `os.WriteFile` then fails with ENOENT and `applyTmuxGuardPathBlocks` returns, leaving `~/.bashrc` unprocessed after the shim was already written. The sibling writer `writeSettings` (`agent_setup.go:659`) does `os.MkdirAll(filepath.Dir(path))` for exactly this reason. Also residual and deferred: two **complete** duplicated marker blocks are only partly handled (`markerBlockBounds` returns at the first complete block, so install replaces the first and leaves the second, and uninstall strips only the first — a leftover PATH entry pointing at a removed shims dir, i.e. inert)
- [x] A-005 R5: `rk doctor` reports shim install state and fails only on real mis-wiring — now met. Ownership is verified via `tmuxShimMarker` (a marker-less file reads as not-installed, OK+note) and the check FAILs when the shim resolves with no real tmux behind it (`doctor.go:138-142`, `TestTmuxGuardShimCheckNoRealTmuxBehindShim`). An existing-but-UNREADABLE file at the shim path is not folded into the optional "not installed" OK note — it FAILs with a permissions hint naming the path (`doctor.go:90-99`, `TestTmuxGuardShimCheckUnreadableFile`, root-skipped), since `exec.LookPath` resolves such a file without read permission. New this cycle (the cycle-3 must-fix): the shim's EMBEDDED rk exec target is extracted (`tmuxShimExecTarget`, `tmux_guard.go:116-134`) and stat'ed, so a dangling rk — the recorded brew rk→run-kit rename shape — FAILs with a hint naming the dangling path and `rk agent-setup`, and an unparseable exec line FAILs the same way (`doctor.go:116-126`, `TestTmuxGuardShimCheckDanglingRkPath` both sub-cases); a valid embedded path keeps the prior OK behavior (`TestTmuxGuardShimCheckResolvesToShim`, whose fixture now embeds a real stub rk). Residual completeness gap in that check (should-fix, not blocking — the must-fix's own ENOENT scenario is closed): the target is validated with a bare `os.Stat`, so a **directory** or a **non-executable** file at the embedded path still reads OK (probe-confirmed) even though both break every tmux invocation exactly like the dangling case; `findRealTmux` already applies the right predicate (`IsRegular() && Perm()&0o111 != 0`) to its own candidates. Same block: only the quoted target is checked, not the full `tmux-guard "$@"` invocation, so a hand-mangled marker-bearing shim exec'ing some other existing binary reads OK. Principle 9 respected: the noted `[ OK ]` row routes through the quiet-gated `sink.Notef`, only `[FAIL]` rows use ungated stderr. Known as-planned behavior (R5, not a defect): immediately after `agent-setup` and before a new shell is opened, the check FAILs because the current shell's PATH predates the block — the hint says "open a new shell"

### Behavioral Correctness

- [x] A-006 R1: `send-keys` (and any data-position) strings containing "kill-server" never trigger the block; `;`-chained kill-server does — verified, plus extra probes (`kill-server;` as segment start, `a;;`, `\;` escapes, `-c`/`-S` value swallowing) all behave per tmux grammar. Re-probed this cycle across the full optstring (`2c:CDdf:lL:NqS:T:uUvV`): bare/clustered flags, attached and separate values, `-fL` (value swallowed, correctly NOT credited as a socket) and `-Lf` (credited) all decide correctly. Two argv shapes stop parsing early and would not be caught (`["-", "kill-server"]`, `["--", "--", "kill-server"]`), but tmux itself rejects both — a lone `-`/`--` becomes the command word and errors — so neither reaches a real kill-server. Nested-command forms (`if-shell true kill-server`, `confirm-before kill-server`, `run-shell 'tmux kill-server'`) DO pass the guard — re-probed this cycle and confirmed — and are now an explicit § Non-Goals bullet alongside command-alias, so stated coverage matches reality. Also re-probed: an argv whose first token is a global flag tmux does not accept (e.g. `["-t", "x", "kill-server"]`) shifts the command-word window and passes, but tmux rejects the unknown global flag before any command runs (the documented optstring is `2c:CDdf:lL:NqS:T:uUvV`, manpage `[-2CDhlNuVv]` + `-c -f -L -S -T`), so no such shape reaches a real kill-server
- [x] A-007 R2: Block applies regardless of `$TMUX` being set; explicit `-L` naming the host server still passes (explicitness, not policy) — the decision function is `$TMUX`-independent by construction (pure over argv)

### Scenario Coverage

- [x] A-008 R1: The fabKit1 death vector (`TMUX_TMPDIR=/tmp/ap2 tmux kill-server`) and utils2 vector (bare `tmux kill-server`, `$TMUX` unset) both map to blocked argvs in tests — `tmux_guard_test.go:26-27` pin both shapes
- [x] A-009 R4: Re-running install over a hand-edited marker block restores it exactly once (no duplicates) — `TestTmuxShimReplacesEditedBlockInPlace` verified, and the block is now replaced **in position** rather than re-appended at EOF (`TestUpsertMarkerBlockReplacesInPosition`), with a byte-exact install→uninstall round trip across trailing-newline-present and -absent files (`TestMarkerBlockRoundTripByteExact`)

### Edge Cases & Error Handling

- [x] A-010 R3: Missing real tmux yields a clear error, never self-exec recursion — verified including the hardest case (home resolution fails ⇒ `shimDir == ""`; the content sniff still prevents resolving the shim)
- [x] A-011 R4: Marker-less pre-existing `~/.local/share/rk/shims/tmux` is never overwritten or removed; non-TTY without `--yes` refuses with `errNonInteractiveConsent` — now fully met. The new `readFileIfExists` helper keys ownership on `os.ReadFile` existence rather than content, so a **zero-byte** marker-less file survives both install and uninstall (`TestTmuxShimZeroByteMarkerlessProtected`); non-TTY refusal verified (`TestTmuxShimNonTTYRefusal`, error names `--yes` and nothing is written)

### Code Quality

- [x] A-012 Pattern consistency: new code follows the cmd/rk conventions (outputSink channels, consent machinery, exitCodeError, cobra registration, doc-comment style) — consistent; doc comments are unusually thorough. The collateral `[FAIL]`-row rewording is reverted: `doctorFailLabel` keeps the historical `"<name> not found"` default for absence-style checks and only the shim check supplies its own `failLabel` (`TestDoctorFailRowWording`)
- [x] A-013 No unnecessary duplication: reuses `resolveRkPath`/`validateHookPath`/`authorizeWrite`/`renderArtifactDiff` instead of reimplementing. The one deliberate non-reuse is `readFileIfExists` alongside `readSkill` — justified, not duplication: `readSkill`'s tolerant absent→`""` collapse is what leaked the zero-byte ambiguity, so ownership decisions need existence-awareness (`readSkill` is still reused for the startup files, where absent and empty are equivalent)
- [x] A-014 No shell-string subprocess construction anywhere; tests never start, attach to, or kill any tmux server — verified: `syscall.Exec` with an argv slice only; every test uses `t.TempDir()` homes, stub executables, and the injectable exec seam

### Security

- [x] A-015 R2: The exec passthrough uses an explicit argv slice with no shell interpolation; the shim script embeds only a `validateHookPath`-validated absolute path — all three halves now hold. `tmuxGuardExecEnv` (`tmux_guard.go:343-356`) restores `TMUX` from `tmux.OriginalTMUX`, mirroring riff's `childEnv` (`internal/riff/riff.go:541-546`) — verified identical in shape, and the pre-`init()` capture ordering is guaranteed by package-var initialization (`internal/tmux/tmux.go:36` var vs `:44` `init()`). The fix is pinned both ways — restored when the caller had `$TMUX`, and left absent when it did not, so the guard restores rather than fabricates (`TestRunTmuxGuardRestoresTMUXEnv`, `TestRunTmuxGuardNoTMUXWhenCallerHadNone`). New this cycle (the cycle-3 must-fix): the same function **strips every `RK_TMUX_GUARD` entry** from the exec env, so a server started under the hatch (`RK_TMUX_GUARD=off tmux new-session -d`) cannot bake `off` into that server's GLOBAL environment and make the per-invocation hatch transitively permanent — pinned on both the off-hatch and the normal (non-`off` value) pass paths (`TestRunTmuxGuardExecEnvStripsGuardVar`, both sub-tests)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality (a new subcommand, a second agent-setup artifact, a new doctor check) without making existing code redundant. Re-confirmed on the cycle-3 diff by counting production call sites for all 23 new symbols (`parseTmuxGlobalFlags`, `tmuxCommandWords`, `isKillServerWord`, `tmuxGuardBlocks`, `findRealTmux`, `sniffsAsTmuxShim`, `tmuxGuardExecEnv`, `tmuxShimScript`, `tmuxShimExecTarget`, `rkShimsDir`, `tmuxShimPath`, `tmuxGuardStartupFiles`, `markerBlockBounds`, `removeMarkerBlock`, `upsertMarkerBlock`, `readFileIfExists`, `applyTmuxShim`, `installTmuxShimFile`, `removeTmuxShimFile`, `applyTmuxGuardPathBlocks`, `tmuxGuardShimCheck`, `doctorFailLabel`, `doctorSamePath`) — every one is referenced from non-test code, so there are no zero-call-site or duplicated-logic candidates. The list is `osExit`-free and `tmuxShimExecTarget`-inclusive this cycle: the zero-consumer `osExit` seam flagged in cycle 2 was **deleted** (the RunE wrapper now calls `os.Exit` directly, matching `shell_init.go`'s print-then-exit-before-cobra pattern), and the cycle-3 doctor must-fix added `tmuxShimExecTarget`, which `tmuxGuardShimCheck` consumes.

Three adjacent observations that are NOT deletion candidates: the `rk-display` legacy-skill cleanup in `agent_setup.go` is already scheduled for removal on its own release clock (unrelated to this change); `doctor.go`'s `Hint`/`Note`/`failLabel` fields are all live (no superseded field); and `readSkill` is still used by both the legacy-skill cleanup and the startup-file reads, so the new `readFileIfExists` supplements rather than replaces it.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Passthrough uses `syscall.Exec` behind an injectable seam (constitution §I deviation documented in Design Decisions) | Intake explicitly allows it; argv-slice discipline kept; timeouts are wrong for interactive tmux clients | S:80 R:85 A:85 D:80 |
| 2 | Confident | Shim embeds the validated absolute rk path instead of the intake's literal bare `rk` | Mirrors agent-setup's existing resolveRkPath contract the intake invokes; bare name breaks tmux entirely when rk is off PATH | S:60 R:90 A:85 D:70 |
| 3 | Confident | PATH-block file matrix: `~/.zshenv` + `~/.bashrc` always (created), `~/.bash_profile` only when it already exists | Resolves intake Tentative #5: zshenv covers non-interactive zsh; creating a new .bash_profile would shadow ~/.profile for login bash | S:55 R:85 A:75 D:65 |
| 4 | Confident | Command-word match includes unambiguous tmux prefixes of kill-server (`kill-ser`+, len ≥ 8) | tmux resolves unique command prefixes, so `tmux kill-ser` really kills the server; shorter prefixes are ambiguous and tmux rejects them | S:55 R:90 A:80 D:75 |
| 5 | Confident | `;`-chain segmentation mirrors tmux `cmd_parse_from_arguments` (token-final unescaped `;` terminates a command; `\;` is literal) | Resolves intake Tentative #6: matching tmux's real rule is what keeps data strings from false-triggering while catching real chained kills | S:60 R:85 A:75 D:70 |
| 6 | Confident | Doctor treats "shim not installed" as OK-with-note; only installed-but-not-resolving fails | Intake frames the check as detecting PATH-ordering regressions; failing every non-installed machine would make doctor useless as a dependency gate | S:60 R:90 A:80 D:75 |
| 7 | Confident | Blocked invocations exit 1 (operational class) | Toolkit Principle 4 exit-code convention: not a usage error (2); the refusal is an operational veto | S:55 R:95 A:85 D:80 |

7 assumptions (0 certain, 7 confident, 0 tentative).

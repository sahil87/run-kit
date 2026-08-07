---
type: memory
description: "The tmux guard PATH shim — `rk tmux-guard` fronts the real tmux and refuses `kill-server` without an explicit `-L`/`-S` (a bare kill in a pane destroys the HOST server — precedence `-L`/`-S` > `$TMUX` > `TMUX_TMPDIR`). Covers the argv decision, shim-skipping resolution, the exec passthrough (`$TMUX` restored, `RK_TMUX_GUARD` stripped), the self-healing shim script (~3s rk probe → guard exec → fail-open PATH walk behind a crude backstop), the `rk agent-setup` install contract, and doctor states."
---
# tmux Guard PATH Shim (`rk tmux-guard`)

**Domain**: run-kit

A PATH shim installed in front of the real `tmux` binary that refuses whole-server
destruction lacking an explicit socket. It is the deterministic, harness-agnostic
veto for the recurring failure where an agent running inside a run-kit-managed
tmux pane kills the host tmux server it lives in — a class prose guidance
(CLAUDE.md, agent memory, skill preambles) has repeatedly failed to prevent.

## Overview

Two artifacts and one subcommand:

- **`rk tmux-guard [tmux args…]`** (`app/backend/cmd/rk/tmux_guard.go`) — decides
  block vs pass over the tmux argv, then process-replaces itself with the real
  tmux on pass.
- **The shim** at `~/.local/share/rk/shims/tmux` — a self-healing `#!/bin/sh`
  script that probes the embedded rk path, execs `rk tmux-guard`, or fails open
  to the real tmux — plus a marker-owned `PATH` block in the user's shell startup
  files, both installed and removed by `rk agent-setup` (see
  [agent-state](/run-kit/agent-state.md) § `rk agent-setup`, which owns the
  installer's consent/diff machinery).
- **A `rk doctor` check** (`tmux-guard shim`) reporting install state and PATH
  resolution.

The guard covers **every** harness that resolves `tmux` through `PATH` — Claude
Code subagents, codex workers, raw shells, `just` recipes — which is precisely
what a harness-specific pre-tool hook cannot do.

## The Socket-Resolution Trap

tmux resolves its target server in a fixed precedence: **`-L`/`-S` > `$TMUX` >
`TMUX_TMPDIR`**. Inside a pane `$TMUX` is always set, so `TMUX_TMPDIR=/tmp/x tmux
kill-server` silently targets the **host** server rather than the intended
scratch one — `TMUX_TMPDIR` never gets consulted. A bare `tmux kill-server` with
`$TMUX` unset is equally destructive: it targets the **default** host server.
Both shapes are pinned as blocked in `tmux_guard_test.go`.

## Requirements

### Requirement: Block rule
The guard SHALL refuse to exec when the invocation's command chain includes a
`kill-server` command word AND no explicit `-L`/`-S` socket flag is present. The
rule is `$TMUX`-independent (the decision function is pure over argv). An
explicit `-L`/`-S` always passes — **including `-L` naming the host server**: the
guard enforces *explicitness*, not policy. Scoped destruction
(`kill-session`/`kill-window`/`kill-pane`) always passes; those are routine
operations tmux users legitimately run bare, and blocking them would be
false-positive noise.

#### Scenario: Bare kill-server is refused
- **GIVEN** argv `["kill-server"]`, or `["-u", "kill-ser"]`, or a
  `TMUX_TMPDIR=…`-prefixed bare invocation
- **WHEN** the decision function runs
- **THEN** the invocation is blocked and the real tmux is never exec'd

#### Scenario: Explicit socket passes
- **GIVEN** argv `["-L", "scratch", "kill-server"]`, `["-Lscratch", "kill-server"]`,
  or `["-S", "/tmp/s", "kill-server"]`
- **WHEN** the decision function runs
- **THEN** the invocation passes through to the real tmux

### Requirement: Argv grammar — command words vs data
Parsing SHALL mirror tmux's own command-line grammar closely enough that data
arguments never read as command words:

- **Global-flag window**: flags precede the first command word. Value-taking
  global flags are `-c -f -L -S -T` (value attached to the token, e.g. `-Lfoo`, or
  in the next token); every other flag is bare and may be clustered (`-2uv`). A
  `--` token ends flag parsing. `-L`/`-S` seen in this window sets "explicit
  socket".
- **Command chains** follow tmux `cmd_parse_from_arguments`: a token that is
  exactly `;`, or ends in an unescaped `;`, terminates the current command; a
  token ending `\;` carries a literal semicolon and does not terminate. Only the
  **first** token of each non-empty segment is a command word — every other token
  is data.
- **Prefix resolution**: a command word matches when it equals `kill-server` or is
  an unambiguous prefix of it (length ≥ `len("kill-ser")`; shorter prefixes are
  ambiguous with `kill-session` and tmux itself rejects them).

#### Scenario: send-keys data never triggers the guard
- **GIVEN** argv `["send-keys", "-t", "x", "tmux kill-server", "Enter"]`
- **WHEN** the decision function runs
- **THEN** the invocation passes — the string sits in a data position

#### Scenario: chained kill-server is caught
- **GIVEN** argv `["new-window", ";", "kill-server"]` or `["display;", "kill-server"]`
- **WHEN** the decision function runs
- **THEN** the invocation is blocked; `["send-keys", "kill-server\\;", "Enter"]` passes

### Requirement: Real-tmux resolution never resolves the shim
`findRealTmux(pathEnv, shimDir)` SHALL scan `PATH` and return the first
executable regular file named `tmux` that is not the shim, erroring when none
exists — it MUST never exec the shim (an infinite shim → `rk tmux-guard` → shim
loop). Two independent exclusions apply: PATH entries equal to the rk shims dir
are skipped, and any candidate whose head (first 512 bytes) sniffs as the rk shim
— by ownership marker or by its `tmux-guard` invocation — is skipped regardless of
location. Empty PATH entries (POSIX cwd) are skipped. The shim script's own
fail-open walk (below) mirrors these exclusions in shell, more conservatively.

#### Scenario: shim-first PATH resolves the real binary
- **GIVEN** a PATH of `[shimsDir, realDir]` with the shim in `shimsDir` and an
  executable `tmux` in `realDir`
- **WHEN** resolution runs
- **THEN** the `realDir` binary is returned; a shim-only PATH errors instead

### Requirement: Pass path preserves the invocation, block path exits 1
On pass the guard SHALL process-replace itself via `syscall.Exec` with
`[realTmux, args…]` verbatim — preserving argv, stdio/TTY, signal delivery, and
exit code with no relay code. On block it SHALL print the refusal message to
stderr and exit **1** (operational class per the toolkit exit-code convention),
naming the precedence trap, the canonical remedy (`tmux -L <name> kill-server`),
and the bypass. The exec call sits behind the injectable `tmuxGuardExec` seam so
tests never execute a real binary, and the subcommand carries
`DisableFlagParsing` + `ArbitraryArgs` so tmux flags reach the guard rather than
cobra.

### Requirement: Exec environment is adjusted for safety
The environment handed to the real tmux SHALL be `os.Environ()` with `TMUX`
restored from `tmux.OriginalTMUX` and every `RK_TMUX_GUARD` entry removed. See
§ Design Decisions → *Exec env restores `$TMUX` and strips `RK_TMUX_GUARD`* for
why each half is load-bearing.

#### Scenario: the hatch cannot be baked into a new server
- **GIVEN** `RK_TMUX_GUARD` set to any value and a passing argv
- **WHEN** the guard execs
- **THEN** the env handed to the exec seam carries no `RK_TMUX_GUARD` entry, so a
  server started under the hatch does not inherit it in its global environment

### Requirement: Escape hatch
`RK_TMUX_GUARD=off` in the environment SHALL bypass the guard for that one
invocation — exec passthrough, no decision, no message — so deliberate host-server
teardown stays possible without uninstalling the shim. The hatch is strictly
per-invocation (see the strip requirement above), and that guarantee SHALL hold on
the shim's fail-open shell path too: the fallback backstop honors `off`, and the
script unsets `RK_TMUX_GUARD` before exec'ing the real tmux — the shell mirror of
`tmuxGuardExecEnv`'s strip.

### Requirement: The shim survives a briefly-unreachable rk
The installed shim (`tmuxShimScript`) SHALL run three stages, in file order:

- **Probe** — when the embedded rk path is not an executable file, poll it
  `tmuxShimProbeAttempts` × `tmuxShimProbeInterval` (15 probes, 0.2s apart, ~3s)
  and proceed the moment it becomes executable. The steady state tests the
  condition once and never sleeps; the stall itself is silent.
- **Guard exec** — `exec "<abs-rk>" tmux-guard "$@"`, passing the original argv
  verbatim. This MUST stay the script's **first** `exec ` line with the rk path
  spelled **literally**, because `tmuxShimExecTarget` reads the first
  double-quoted value on the first such line and every `rk doctor` shim state is
  built on it; the fail-open exec of the resolved tmux comes later in file order.
- **Fail open** — after the budget, the shim SHALL evaluate the bare-`kill-server`
  backstop, then resolve the real tmux itself with a `set -f` + `IFS=:` `PATH`
  walk mirroring `findRealTmux`'s exclusions (empty entries; the rk shims dir,
  compared with both sides separator-normalized so a trailing or doubled slash
  cannot smuggle it past; candidates that sniff as an rk shim) and exec it with
  the original argv. Exactly **one** one-line stderr notice, naming the
  unreachable rk path, SHALL be emitted immediately before that exec — so a
  backstop refusal or a failed walk never also claims the invocation ran
  unguarded. When no candidate survives, the shim prints an actionable message and
  exits non-zero.

The backstop refuses **only** the literal bare shape — some argv token exactly
equal to `kill-server` while no `-L*`/`-S*` token is present — and names the
canonical remedy (`tmux -L <scratch-name> kill-server`) on exit 1.

Every shell variable the script owns lives in the `_rk_` namespace and is dropped
by `_rk_scrub` before **both** exec sites; the fail-open exec additionally unsets
`RK_TMUX_GUARD`. The shims directory reaches the script from the same
`rkShimsRelDir` constant `rkShimsDir` uses, and the sniff pattern from
`tmuxShimMarker`, so the Go-side and shell-side exclusions cannot disagree. The
only environment-derived value interpolated into the script stays the
`validateHookPath`-gated rk path (Constitution §I); everything else is a
compile-time constant or composed at run time from `$HOME`.

#### Scenario: an invocation inside an upgrade's relink window survives
- **GIVEN** the embedded rk path is momentarily absent (a package manager's
  non-atomic relink) and returns within the probe budget
- **WHEN** any `tmux …` resolves through the shim
- **THEN** the shim stalls silently and then execs `rk tmux-guard` with the
  original argv — never exiting 127

#### Scenario: a permanently dangling rk path falls open
- **GIVEN** an embedded rk path that never becomes executable and a real `tmux`
  on `PATH`
- **WHEN** a `tmux …` resolves through the shim
- **THEN** after ~3s stderr carries exactly one notice line and the real tmux runs
  with the original argv, its own output, and its own exit code

#### Scenario: a relocated copy of the shim never exec-loops
- **GIVEN** a `PATH` whose only `tmux` behind the shim is a copy of the shim
- **WHEN** the fail-open walk runs
- **THEN** the copy is skipped by the content sniff and the shim exits non-zero
  with "no real tmux found on PATH"

#### Scenario: the fallback backstop refuses a bare kill-server
- **GIVEN** a dangling rk path and argv `["kill-server"]`
- **WHEN** the shim reaches the fail-open stage
- **THEN** it refuses, exits 1, and never execs the real tmux — while
  `["-L", "scratch", "kill-server"]` and `RK_TMUX_GUARD=off` both pass through,
  and the exec'd environment carries neither `RK_TMUX_GUARD` nor any `_rk_*` value

### Requirement: `rk agent-setup` install/uninstall contract
The shim is a **user-global** managed artifact (one shim, one PATH block), applied
once after the per-agent hook loop rather than per agent. Both pieces follow the
same contract as the hooks merge: diff + consent before writing (`--dry-run`
previews, `--yes` writes unprompted, a non-TTY without either refuses), idempotent
replace-in-place, and exact removal on `--uninstall`.

- **Shim file** at `~/.local/share/rk/shims/tmux`, mode 0755, carrying the
  `managed-by: rk agent-setup (tmux guard shim)` ownership marker on line 2 and,
  past its probe stage, exec'ing `"<abs-rk>" tmux-guard "$@"` — an absolute path
  resolved by `resolveRkPath` and validated by `validateHookPath`, not the bare
  name `rk`. Rollout of a new script shape is the same idempotent
  replace-in-place: re-running `rk agent-setup` registers it as a content diff
  under the existing consent flow, with no migration and no new file. A pre-existing
  **marker-less** file at that path — including a zero-byte one — is left untouched
  with a skip note; ownership keys on *existence* (`readFileIfExists`), not on
  content. An already-current shim is a reported no-op, except that a lost exec
  bit on rk's own artifact is repaired (`chmod 0755`) — content parity alone would
  leave a non-executable shim fronting every PATH resolution.
- **PATH block**, marker-owned by `# >>> rk tmux guard >>>` /
  `# <<< rk tmux guard <<<`, prepending the shims dir to `PATH`. Target files:
  `.zshenv` in `$ZDOTDIR` when set, else `~` (always, created if missing);
  `~/.bashrc` (always, created if missing); `~/.bash_profile` **only when it
  already exists**. `$ZDOTDIR` is read once at the `runAgentSetup` boundary and
  threaded as a parameter, so every path below is injectable for tests.
- **Upsert semantics**: an existing block is replaced **in position** (never moved
  to EOF — hopping it past later user lines would change PATH precedence);
  otherwise it is appended, mirroring the file's trailing-newline state so an
  install → uninstall round trip is byte-exact. Existing file modes are preserved;
  new files are created 0644; symlinked startup files are written through.
- **Install gating**: the PATH block is written only when the shim is in place
  (freshly written, already rk-owned, or a dry-run preview of that write). Wiring
  PATH after a declined write, or in front of a foreign marker-less file, would
  put a non-rk executable — or nothing — in front of every tmux invocation. On
  **uninstall** the two pieces are independent: the block is stripped even when the
  shim's removal was declined, skipped, or unreadable.
- **Per-file resilience**: a file whose marker region is malformed (a begin marker
  with no end, or a second begin before the end) or that cannot be **read** at all
  (unreadable, or a directory occupying the path) is refused with a skip note while
  the remaining startup files still proceed — rk never claims a region whose extent
  it cannot know.

#### Scenario: fresh install then uninstall
- **GIVEN** a fresh temp home
- **WHEN** `rk agent-setup` runs with consent, then `--uninstall` runs with consent
- **THEN** install leaves an executable marker-owned shim plus the block in
  `.zshenv` and `.bashrc` with no `.bash_profile` created; uninstall removes the
  shim and strips the block from every file with all other content intact

#### Scenario: hand-edited block is replaced exactly once
- **GIVEN** a home whose marker block was user-edited
- **WHEN** install re-runs
- **THEN** the block is replaced in position, exactly once, with no duplicate

### Requirement: `rk doctor` check states
The `tmux-guard shim` check SHALL be pure over an injected
`(home, pathEnv, lookPath)` triple and report:

| State | Verdict |
|-------|---------|
| No file at the shim path | OK + note "not installed (optional …)" |
| Marker-less file at the shim path | OK + note (a user file, not an installed shim) |
| File exists but cannot be read | FAIL + permissions hint (PATH resolution needs no read permission, so tmux may already be dying against it) |
| Shim's embedded rk path missing or not executable, or its exec line unparseable | FAIL + `rk agent-setup` re-install hint naming the dangling path and the ~3s-stall-then-unguarded consequence |
| `LookPath("tmux")` resolves elsewhere, or nowhere | FAIL + PATH-ordering hint (open a new shell / check the block) |
| Resolves to the shim but `findRealTmux` finds nothing behind it | FAIL + install-tmux hint |
| Resolves to the shim, embedded rk alive, real tmux behind it | OK + note "installed; PATH resolves tmux to the shim" |

An absent shim never fails doctor — the artifact is optional, and failing every
machine that has not installed it would make doctor useless as a dependency gate.
Path comparison uses symlink evaluation with a lexical-clean fallback
(`doctorSamePath`). Per toolkit Principle 9, `[ OK ]` rows route through the
quiet-gated `sink.Notef` and only `[FAIL]` rows use ungated stderr.

**As-planned transient**: immediately after `agent-setup` and before a new shell
is opened, the check FAILs because the current shell's `PATH` predates the block —
the hint says to open a new shell.

## Documented Bypass Classes

The guard targets the **accidental** bare-`kill-server` vector all four recorded
incidents share. These shapes pass by design, not by defect:

- **Absolute-path invocations** (`/usr/bin/tmux kill-server`) bypass `PATH`
  entirely.
- **`command-alias` expansions** (`set -s command-alias[100] ks='kill-server'`)
  expand *server-side*, after the guard has already passed `tmux ks` as an
  unrecognized command word. Closing this would require querying the live server's
  option state per invocation.
- **Nested-command forms** — `if-shell true kill-server`, `confirm-before
  kill-server`, `run-shell 'tmux kill-server'` — place `kill-server` in a data
  position the wrapping command re-interprets server-side (or, for `run-shell`, in
  a shell string whose inner `tmux` may not route through the shim). Only the outer
  command word of each `;`-separated segment is examined; guarding these would mean
  re-implementing each wrapper's argument grammar.
- **Later PATH prepends in login-shell profiles** — zsh reads `~/.zprofile` *after*
  `.zshenv`, so a subsequent `eval "$(brew shellenv)"` re-prepends
  `/opt/homebrew/bin` ahead of the shims dir and the real tmux wins again in login
  shells. Placement inside `.zshenv` cannot prevent this ordering; the doctor
  PATH-resolution check is the detection surface.
- **Scoped kills** (`kill-session`/`kill-window`/`kill-pane`) — deliberate v1
  scope, not an oversight.
- **The fail-open window** — while the embedded rk path is unreachable, only the
  crude shell backstop stands between an invocation and the real tmux, so every
  shape the Go decision catches beyond a literal bare `kill-server` passes. The
  trade is deliberate (see § Design Decisions → *Availability wins when rk is
  unreachable*), and the window is a few seconds per upgrade unless the path is
  permanently dangling — which `rk doctor` FAILs on.

A harness-specific pre-tool hook (e.g. Claude Code `PreToolUse`) is a separate,
complementary mechanism with a different owner surface — not part of this shim.

## Design Decisions

### Process-replacing exec instead of `exec.CommandContext` for passthrough
**Decision**: the pass path uses `syscall.Exec` (process replacement) with an
explicit argv slice, behind an injectable test seam.
**Why**: the guard is a transparent wrapper, and tmux invocations are frequently
long-lived interactive clients (`attach`), so any timeout is wrong by
construction; exec-replacement is the only mechanism that preserves stdio/TTY,
signal delivery, and exit code with zero relay code. Argv-slice discipline is kept
— no shell string is ever built, nothing user-provided is interpolated — which
honors the substance of Constitution §I.
**Rejected**: `exec.CommandContext` + stdio plumbing + exit-code copying — adds a
supervising process to every tmux invocation, breaks signal/TTY semantics for
interactive clients, and its mandatory timeout would sever attached sessions.
*Introduced by*: `260805-blyf-tmux-guard-path-shim`

### Shim embeds the validated absolute rk path, not the bare name `rk`
**Decision**: the installed shim execs `"<abs-rk>" tmux-guard "$@"` using
`resolveRkPath()` (the stable Homebrew symlink, never the version-pinned Cellar
path) + `validateHookPath()`.
**Why**: a bare `rk` makes every tmux invocation depend on rk being on `PATH` at
fire time — and the script's probe tests the embedded value with `[ -x … ]`, which
a bare name can never satisfy, so every tmux invocation on the machine would pay
the full probe budget and then drop the guard entirely. The agent-state hook
artifact already solved the stable-path problem with the
`resolveRkPath`/`validateHookPath` pattern, so the shim mirrors the established
managed-artifact contract. The same shell-unsafe-char rejection applies, since the
path sits inside double quotes in the script.
**Rejected**: a bare `exec rk tmux-guard "$@"` — simpler but PATH-fragile in
precisely the non-interactive-shell environments this change targets.
*Introduced by*: `260805-blyf-tmux-guard-path-shim`

### Exec env restores `$TMUX` and strips `RK_TMUX_GUARD`
**Decision**: `tmuxGuardExecEnv()` builds the exec environment as `os.Environ()`
plus `TMUX=` restored from `tmux.OriginalTMUX` and minus every `RK_TMUX_GUARD`
entry — never the raw `os.Environ()`.
**Why (TMUX restore)**: `internal/tmux`'s `init()` runs `os.Unsetenv("TMUX")`
process-wide (so the daemon's bare tmux subprocess calls target the default
socket), and package `main` imports `internal/tmux`, so the strip fires before any
`RunE`. A raw `os.Environ()` would hand the real tmux an env with **no** `$TMUX`,
silently retargeting every shimmed bare tmux command from the pane's own server to
the DEFAULT server — the exact inversion of the guard's safety goal.
`tmux.OriginalTMUX` (captured by package-var ordering before `init()`) is the
established restoration seam, shared with riff's `childEnv` and agent-hook's
`tmuxSocketArgs`. When the caller had no `$TMUX`, nothing is restored — the guard
restores rather than fabricates.
**Why (RK_TMUX_GUARD strip)**: tmux copies the starting environment of a new
server into that server's **global** environment. Forwarding the variable verbatim
would let `RK_TMUX_GUARD=off tmux new-session -d` bake `off` into every future
pane of that server, so a later bare `kill-server` from any of them would sail
through — the per-invocation hatch made transitively permanent, re-opening the
exact death vector.
**Rejected**: removing the `init()` strip (it exists for the daemon's targeting
correctness); passing `TMUX_TMPDIR` instead (it does not carry socket identity —
`$TMUX` does); forwarding `RK_TMUX_GUARD` on non-`off` values (the variable is the
guard's own control knob; no tmux consumer exists, so forwarding has no upside).
*Introduced by*: `260805-blyf-tmux-guard-path-shim`

### Conservative global-flag window (BSD-getopt view)
**Decision**: `-L`/`-S` count as an explicit socket only when they appear before
the first command word (attached or clustered there). Post-command flags are not
credited.
**Why**: the documented tmux grammar places global flags first, and crediting
glibc's argument permutation (which would honor `tmux kill-server -L x` on Linux)
means reimplementing a platform quirk. Mis-parsing in this direction can only
produce a false-positive **block** whose message states the exact canonical remedy
— safe and self-correcting.
**Rejected**: emulating glibc permutation — more code, platform-divergent
behavior, and it weakens the guard on macOS where permutation does not happen.
*Introduced by*: `260805-blyf-tmux-guard-path-shim`

### PATH-block file matrix: `.zshenv` + `.bashrc` always, `.bash_profile` existing-only
**Decision**: manage the block in `$ZDOTDIR/.zshenv` (else `~/.zshenv`) and
`~/.bashrc` — both created when missing — plus `~/.bash_profile` only when it
already exists.
**Why**: `.zshenv` is the one zsh startup file **non-interactive** shells read,
which is exactly the environment agent Bash tools spawn; `$ZDOTDIR` must be
honored because zsh reads `$ZDOTDIR/.zshenv` and **never** `~/.zshenv` when it is
set, so writing the home copy would report success while the zsh half of the
install stays inert. Creating a **new** `~/.bash_profile` would make login bash
skip `~/.profile` (bash reads only the first of
`.bash_profile`/`.bash_login`/`.profile`), silently breaking an existing setup;
appending to one the user already has is side-effect-free.
**Rejected**: `.zshrc`/`.bashrc` only (interactive-only, misses the agent case);
always creating `.bash_profile` (shadows `~/.profile`).
*Introduced by*: `260805-blyf-tmux-guard-path-shim`

### Ownership keys on existence, not content (`readFileIfExists`)
**Decision**: the shim path's ownership decision uses an existence-aware read
returning `(content, exists, err)` rather than the installer's tolerant
`readSkill` (absent → `""`).
**Why**: `readSkill`'s absent→empty collapse conflates "no file" with "a zero-byte
user file", and a zero-byte file at a managed path is still the user's — rk must
not overwrite or remove it. `readSkill` stays in use for the startup files, where
absent and empty genuinely are equivalent.
**Rejected**: reusing `readSkill` everywhere (leaks the zero-byte ambiguity into a
destructive decision); a separate ownership manifest (Constitution §II — no
persistent state store).
*Introduced by*: `260805-blyf-tmux-guard-path-shim`

### Malformed marker regions and unreadable files are refused per file, not fatally
**Decision**: a begin marker with no end, a second begin before the end, or a
file that cannot be read at all produces a skip note and the run continues with
the remaining startup files. Uninstall likewise strips the PATH blocks even when
the shim file itself could not be read.
**Why**: the marker region's extent is unknowable in those shapes, and claiming
`begin`→EOF (or first-begin→end) would destroy user lines. Aborting the whole run
instead would let one unreadable `~/.zshenv` leave `~/.bashrc` unprocessed, and a
read-failing shim would leave the PATH blocks wired at a file rk cannot vouch for.
**Rejected**: best-effort region guessing (destroys user content); hard-failing the
run (breaks the other files' processing).
*Introduced by*: `260805-blyf-tmux-guard-path-shim`

### Doctor treats "not installed" as OK-with-note; only mis-wiring fails
**Decision**: an absent shim — or a marker-less file at the shim path — is a
passing check with an informational note; the check FAILs only on mis-wiring
(unreadable file, dangling embedded rk path, PATH resolving elsewhere, no real
tmux behind the shim).
**Why**: the shim is optional, so failing every machine that has not installed it
would make `rk doctor` useless as a dependency gate. The dangling-rk case is
promoted to a FAIL specifically because it is the most damaging mis-wiring the
shim cannot self-heal: the probe budget absorbs a *transient* dangle (an upgrade's
relink window) but cannot outwait a *permanent* one — the recorded brew
`rk`→`run-kit` rename shape — so **every** tmux command on the machine pays ~3s
and then runs UNGUARDED while the shim file itself looks healthy. That
transient/permanent split is exactly what makes it a doctor concern rather than a
runtime one: only the permanent shape needs a human.
**Rejected**: failing on absence (useless gate); reporting OK whenever the shim
file merely exists (vouches for a dangling install).
*Introduced by*: `260805-blyf-tmux-guard-path-shim`

### Block only `kill-server`; scoped kills pass
**Decision**: v1 blocks whole-server destruction only. `kill-session`,
`kill-window`, and `kill-pane` always pass.
**Why**: all four recorded incidents were whole-server kills, and scoped kills are
routine operations whose blocking would generate constant false positives.
Explicitness — not policy — is what the guard enforces, so even `-L` naming the
host server passes.
**Rejected**: guarding scoped kills (false-positive noise for no recorded
incident); making the block conditional on `$TMUX` being set (a bare kill with
`$TMUX` unset destroys the default host server just as thoroughly — the recorded
utils2 shape).
*Introduced by*: `260805-blyf-tmux-guard-path-shim`

### Availability wins when rk is unreachable: the shim fails open
**Decision**: after a ~3s probe budget the shim runs the real tmux unguarded —
behind a crude bare-`kill-server` backstop — rather than refusing to run.
**Why**: the shim fronts **every** PATH-resolved `tmux` on the machine and execs
one hard-coded path, and that path is a package manager's symlink which dangles
for a few seconds on every upgrade (Homebrew unlinks the old keg, then links the
new one). Failing hard there is a machine-wide tmux outage, not an edge case — it
was observed live when a fab operator's `tmux list-panes` calls started exiting
127 mid-update and its tick loop stopped. The guard exists to catch *accidental*
agent `kill-server`; the chance of one firing inside a few-second window is
negligible next to the certainty of breaking every tmux caller on the host at
every upgrade, and the steady-state guard is untouched.
**Rejected**: failing closed (turns a routine upgrade into a machine-wide
outage); an rk-owned binary copy at `~/.local/share/rk/bin/` with atomic rename
(~20MB duplicate binary, version skew, and a refresh seam that must fire after
every upgrade); making the package manager's relink atomic (outside rk's control).
*Introduced by*: `260807-8qvc-tmux-guard-shim-update-resilience`

### The shell sniff scans the whole candidate and skips what it cannot verify
**Decision**: the fail-open walk sniffs each candidate with a single
`grep -qF -e "<marker>" -e tmux-guard "$c"` and discriminates its exit status
three ways — 0 (it is a shim) and ≥2/127 (the sniff itself failed) both skip the
candidate; only exit 1, a clean miss, earns an exec.
**Why**: the shell walk's failure modes are not symmetric with `findRealTmux`'s.
When Go's sniff returns false on a read error it merely execs a file that then
fails; when the shell's sniff misfires it execs a *relocated copy of this very
script*, which probes, fails open, and execs the copy again — an unbounded fork
loop fronting every tmux call on the machine. A false skip degrades to a clear
"no real tmux found" error, so the two directions are nowhere near equally bad.
Using one tool rather than a pipeline is what makes the status unambiguous, and
scanning a whole candidate once on a cold path costs nothing worth protecting.
**Rejected**: mirroring `sniffsAsTmuxShim`'s 512-byte head bound via
`head -c 512 | grep -q` — a pipeline reports only the last command's status, so a
missing or failing `head` reads as a clean miss and reintroduces the fork loop
(this exact shape looped during smoke testing), and it adds a second non-POSIX
flag; reading the head with the shell's own `read`/`$(…)` (unbounded on a binary
with no early newline, and bash's sh mode warns on NUL bytes for every candidate).
*Introduced by*: `260807-8qvc-tmux-guard-shim-update-resilience`

### Every shim variable is `_rk_`-namespaced and scrubbed before exec
**Decision**: the script prefixes every variable it owns with `_rk_` and drops
them through a single `_rk_scrub` function called immediately before **both**
exec sites; the fail-open site additionally unsets `RK_TMUX_GUARD`.
**Why**: POSIX sh keeps the **export attribute** when assigning to a name the
caller already exported, so a generic name (`n`, `real`, `c`) silently hands the
shim's own value to the exec'd tmux — and the steady-state exec is the hot path,
so this leaked on every tmux invocation on the machine, not only on the fallback.
tmux then copies its starting environment into a new server's *global*
environment, where the leak outlives the invocation for every future pane. `unset`
inside a function is global in POSIX sh, so one shared list keeps both exec sites
honest rather than two inline lists that drift apart. The `RK_TMUX_GUARD` drop is
the shell mirror of `tmuxGuardExecEnv`'s strip, for the same reason: forwarding
the per-invocation hatch through `tmux new-session -d` would make it permanent.
**Rejected**: generic short variable names (the leak is silent and rides the hot
path); scrubbing only at the fail-open exec (the steady-state path leaks first and
most); spelling the unset list inline at each exec site (two lists, one drift).
*Introduced by*: `260807-8qvc-tmux-guard-shim-update-resilience`

### The fail-open backstop is deliberately crude
**Decision**: the fallback guard is a flat token scan for a token equal to
`kill-server` with no `-L*`/`-S*` token, honoring `RK_TMUX_GUARD=off`; it models
neither tmux's global-flag window, nor `;`-chains, nor prefix abbreviation.
**Why**: it runs only in the window when rk is unreachable, and both failure
directions are acceptable there — over-blocking costs one retry with an explicit
socket, under-blocking is no worse than the fully-unguarded fallback it sits in
front of. Reimplementing the argv grammar in shell would put a second copy of
`tmuxGuardBlocks`'s subtle parsing in a language with no test parity, to defend a
few seconds per upgrade.
**Rejected**: no backstop at all (leaves the exact accident the guard exists for
completely unguarded during every upgrade); a faithful shell port of
`tmuxGuardBlocks` (a second, untestable copy of a subtle grammar).
*Introduced by*: `260807-8qvc-tmux-guard-shim-update-resilience`

### Tests never touch a live tmux server
**Decision**: the decision logic is table-driven over argv slices; the Go exec path
is exercised only through the injectable `tmuxGuardExec` seam; resolution tests use
stub executables in `t.TempDir()` PATHs; installer and doctor tests run against
temp homes with an injected `lookPath`. The shim script's own runtime behavior
(probe, mid-probe recovery, fail-open, backstop, hatch, no-real-tmux) is covered by
**executing the rendered script** under a bounded `exec.CommandContext` against stub
`rk`/`tmux` executables and a minimal utility `PATH` dir, all in `t.TempDir()`.
**Why**: a change whose entire purpose is preventing accidental tmux-server death
must not risk one in its own test suite. No test starts, attaches to, or kills any
tmux server, and neither the installer nor the shim is ever run against the real
`$HOME`. The shim is shell, so a content pin alone proves nothing about behavior —
running it against stubs is the only way to observe the three stages, and stubs
that identify themselves on stdout make "which binary got exec'd" directly
assertable. One fixture rule is load-bearing for the parallel subtests: **every
executable must be written before the first parallel exec**, since forking while
another goroutine still holds the write fd makes the exec fail `ETXTBSY`.
**Rejected**: live-tmux integration tests for the exec path (the exact risk being
guarded against); script-content pins alone for the shim stages (they pin text, not
behavior — the fork-loop bug lived in a shape a content pin would have accepted).
*Introduced by*: `260805-blyf-tmux-guard-path-shim`

# Intake: Pin rk-birthed tmux Server CWD to $HOME

**Change**: 260720-ji0k-pin-server-birth-cwd-home
**Created**: 2026-07-20

## Origin

Synthesized from a live root-cause investigation conversation (promptless dispatch via the Create-Intake Procedure, `{questioning-mode} = promptless-defer`). The investigation traced a real user failure — every new tmux window created via `wt create` on tmux 3.7b filling with `shell-init: error retrieving current directory: getcwd: cannot access parent directories` — to the rk-birthed tmux server process sitting on a deleted directory inode. All design decisions below were settled in that conversation; none were marked open.

> Pin rk-birthed tmux server CWD to $HOME. A tmux server inherits the CWD of the process that first touches its socket, and never chdirs afterward. rk never sets `cmd.Dir` on any tmux invocation that can birth a server, so servers inherit `rk serve`'s CWD, which itself inherits from wherever the user ran `rk daemon start` — often a git worktree that is later deleted, leaving the server process on a dead inode.

## Why

**The pain point.** A tmux server process takes its working directory from whichever process first touches its socket, and it never changes it for the rest of its life. rk currently sets `cmd.Dir` on **no** tmux invocation that can birth a server, so every rk-birthed server inherits `rk serve`'s CWD — which in turn inherits from wherever the user happened to run `rk daemon start`. In practice that is frequently a git worktree that is later deleted, leaving the long-lived server process parked on a dead inode.

**What breaks — tmux 3.7 (active harm).** tmux 3.7 restructured pane spawn: the **server process itself** chdirs to the pane's target directory before forking, guarded by `if (getcwd(path, sizeof path) != NULL)` — it must save its own cwd so it can chdir back. When the server's own CWD is a deleted directory, that `getcwd` fails and the **entire chdir block is silently skipped**: every new pane is born on the server's dead inode **even when a perfectly valid `-c` path was given**, and tmux never sets `PWD` for the child (`actual_cwd` stays NULL). Symptom: every new window fills with `shell-init: error retrieving current directory: getcwd: cannot access parent directories` errors, zsh falls back to `PWD="."`, `ls` shows nothing. Verified against tmux 3.7b and master source (`spawn.c`). tmux ≤ 3.6a is immune — there the chdir happens in the forked child with a target → `$HOME` → `/` fallback chain (empirically verified on 3.6a). A real user hit this via `wt create` on tmux 3.7b.

**What breaks — pre-3.7 tmux (quiet damage).** Even on older tmux, a dead server CWD causes subtler failures: sessions created without `-c` silently land in `/`, and subprocesses the server forks without an explicit dir run on the dead inode (git: "Unable to read current working directory").

**If we don't fix it.** Every operator who starts the rk daemon from a worktree (a completely normal thing to do) gets a time bomb: the moment that worktree is deleted, every subsequently-birthed server is poisoned, and on tmux 3.7 every new window in it is visibly broken. There is no post-hoc remediation — a live server's CWD cannot be changed (only a server restart clears it).

**Why this approach.** Pinning `cmd.Dir` to `$HOME` at every rk seam that can birth a server makes the server's CWD independent of where rk itself was launched. `$HOME` is exactly what a login-shell-started tmux would give, so it is the least-surprising stable anchor. This is also the symmetric completion of an existing design: `CreateSession` already sanitizes the environment via `cleanEnvForServer` so the server is "born with the operator's from-home environment" (its own doc comment) — the CWD pin is the missing other half of "as if started from $HOME".

## What Changes

All changes are in `app/backend`. Four seams, each an exec call that can birth (or, for board.go, seed the `session_path` of) a tmux server:

### 1. `internal/daemon/daemon.go` — `startSession` (~line 293)

Set `cmd.Dir` to `os.UserHomeDir()` (fallback `/` when `UserHomeDir` errors) on the `tmux new-session` invocation that creates the rk-daemon server. This is the **highest-leverage** pin: `rk serve` runs inside this session, and `rk serve`'s own CWD is what every later server birth inherits.

Implementation note (for the plan): `startSession` currently routes through the shared `runTmux` helper (daemon.go:91), which builds the `exec.CommandContext` internally. The pin must land on the actual `exec.CommandContext` for the new-session call — either by extending the helper with a dir-carrying variant or by building the command directly at this call site; the exact shape is a plan-level decision. The existing pattern in the file (`runTmux` / `runTmuxOutput`, context timeout `cmdTimeout`, stderr capture) MUST be preserved.

### 2. `internal/tmux/tmux.go` — `CreateSession` birth path via `runTmuxWithEnv` (~line 1100)

Same `cmd.Dir` = home pin on the `new-session` exec. `CreateSession` may start the user-facing server process and already sanitizes env via `cleanEnvForServer` — the CWD pin is the symmetric missing half of that "born with the operator's from-home environment" contract. Update `CreateSession`'s doc comment (the block explaining sanitizeEnv semantics, currently env-only) to cover CWD as well. `runTmuxWithEnv` (tmux.go:1105) is the natural seam to carry an optional dir, since it already carries the optional env override.

### 3. `internal/tmuxctl/client.go` — `createAnchor` (~line 558)

`createAnchor`'s `new-session` can resurrect/birth a server (the file's own comments at client.go:392 and :409 acknowledge this). Two fixes here:

1. Set `cmd.Dir` to home (same fallback rule) on its `exec.CommandContext`.
2. Route its environment through the same sanitization `CreateSession` uses (`cleanEnvForServer`) — `createAnchor` currently passes raw inherited env, which is a second asymmetry with the `CreateSession` birth path. `cleanEnvForServer` lives unexported in `internal/tmux`; sharing it across packages may need exporting it (or an equivalent shared accessor) — mechanism is a plan-level detail. `tmuxctl` already imports `internal/tmux` (it uses `tmux.ControlAnchorSessionName`, `tmux.IsServerGone`), so no import-cycle risk is expected, but the plan should verify.

Preserve `createAnchor`'s existing stderr-capture-into-error behavior (load-bearing for `isDuplicateSessionError` — see the comment referencing change 260602-a1wo).

### 4. `internal/tmux/board.go` — pin-session creation (~line 330)

Add `-c <home>` to the `new-session` that creates the `_rk-pin-<id>` session, so the pin-session's `session_path` never dangles. Distinct mechanism from seams 1–3: the server **already exists** at this point (pinning happens on a live server), so this is `session_path` hygiene via the tmux `-c` flag, not a server-birth `cmd.Dir` pin.

### Home-dir resolution rule (shared)

At every seam: `os.UserHomeDir()`, and on error fall back to `/`. `/` always exists and can never dangle; this mirrors tmux ≤ 3.6a's own child-side fallback chain (target → `$HOME` → `/`).

### Tests

Per `fab/project/code-quality.md`, Go tests covering the new behavior in each affected package, following the existing `*_test.go` patterns in those packages (e.g., asserting `cmd.Dir` on the built command / the presence of the `-c <home>` argument). The plan must first check how existing tests in `internal/daemon`, `internal/tmux`, and `internal/tmuxctl` fake or observe exec, and follow that pattern rather than inventing a new seam.

### Constraints

- **Constitution I (Security First)**: all touched call sites already use `exec.CommandContext` with explicit argument slices — keep it that way; setting `cmd.Dir` / appending `-c <path>` introduces no shell-string construction.
- **Constitution II (No Database)**: no new state — the pin is a pure exec-time property.
- **Constitution VI (tmux layer independent of Go server)**: unaffected; the pin changes where servers are *born*, not how they relate to the Go server's lifecycle.
- **Process Execution constraint**: existing context timeouts on all four call sites are preserved.

### Out of Scope (explicitly decided in the investigation)

- **wt-side pinning** — separate repo; a sibling change will land there.
- **Reporting/fixing the upstream tmux 3.7 bug** (the silently-skipped chdir block in `spawn.c`).
- **UI surfacing of dangling `session_path`s.**
- **Remediation of already-affected live servers** — impossible without a server restart; you cannot chdir a live server.

### Alternatives Rejected (from the investigation)

- **A dedicated controlled dir instead of `$HOME`** — no benefit; `$HOME` is what a login-shell tmux would give.
- **tmux-config solutions** — `default-path` was removed in tmux 1.9; no server-cwd option exists.
- **Post-hoc repair of live servers** — impossible without gdb.

## Affected Memory

- `run-kit/tmux-sessions`: (modify) session/server creation semantics — document the server-birth CWD pin ($HOME, fallback `/`) at CreateSession/createAnchor, the pin-session `-c <home>` hygiene, and the tmux 3.7 dead-server-CWD failure mode it defends against
- `run-kit/architecture`: (modify) daemon lifecycle — `startSession` now births the daemon server with `cmd.Dir` pinned to home, making every downstream server birth independent of where `rk daemon start` ran

## Impact

- **Code**: `app/backend/internal/daemon/daemon.go` (startSession + possibly the runTmux helper seam), `app/backend/internal/tmux/tmux.go` (CreateSession / runTmuxWithEnv / cleanEnvForServer export surface + doc comment), `app/backend/internal/tmuxctl/client.go` (createAnchor), `app/backend/internal/tmux/board.go` (Pin's new-session args). Plus `*_test.go` siblings in each package.
- **APIs**: none — no HTTP/SSE/WS surface changes.
- **Behavior**: rk-birthed tmux servers (daemon server, user-facing servers, resurrected anchor servers) are born with CWD = `$HOME` regardless of rk's own CWD; `_rk-pin-*` sessions get a non-dangling `session_path`. New panes on tmux 3.7 honor `-c` even after the operator's launch worktree is deleted.
- **Risk**: low — the pin only changes birth-time CWD, which no rk feature depends on today (everything session-level passes explicit `-c` paths already); blast radius is contained to the four call sites.
- **Dependencies**: none new; `tmuxctl` → `tmux` package dependency already exists (verify no import cycle when sharing the env-sanitization helper).

## Open Questions

- None — the originating investigation settled every decision (nothing was marked open).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Pin target is `$HOME` via `os.UserHomeDir()`, fallback `/` on error | Discussed — investigation chose $HOME over a dedicated controlled dir ("$HOME is what a login-shell tmux would give"); fallback `/` specified verbatim | S:95 R:85 A:90 D:95 |
| 2 | Certain | Exactly four seams: daemon `startSession`, tmux `CreateSession`, tmuxctl `createAnchor`, board pin-session `-c` | Discussed — enumerated with file/line specifics in the investigation; all four verified present in source at the stated locations | S:95 R:80 A:95 D:90 |
| 3 | Certain | board.go uses the tmux `-c <home>` flag, not `cmd.Dir` | Discussed — server already exists at Pin time; this is session_path hygiene, not server birth | S:90 R:85 A:90 D:90 |
| 4 | Certain | createAnchor additionally routes env through `cleanEnvForServer`-equivalent sanitization | Discussed — named the "second asymmetry to close" in the investigation | S:90 R:75 A:90 D:85 |
| 5 | Confident | Mechanism for sharing the env-sanitization helper across packages (export vs shared accessor) is deferred to the plan | Investigation flagged "may need exporting/sharing" without fixing the shape; reversible implementation detail the plan agent can settle from the code (tmuxctl already imports tmux) | S:70 R:80 A:80 D:65 |
| 6 | Confident | The daemon-side pin lands on the actual `exec.CommandContext` for the new-session call — helper-variant vs direct-build shape deferred to the plan | Investigation noted `runTmux` builds the command internally and marked the exact seam an "implementation detail for the plan"; either shape is trivially reversible | S:70 R:80 A:85 D:65 |
| 7 | Confident | Tests assert `cmd.Dir` / the `-c` argument following each package's existing exec-faking pattern, discovered at plan time | code-quality.md mandates tests for changed behavior and "follow existing project patterns"; the specific faking pattern per package is readable from the code | S:75 R:85 A:80 D:70 |
| 8 | Certain | Only the birth-capable `new-session` calls are pinned — not every tmux invocation rk makes | Discussed — the problem is server birth CWD inheritance; other invocations on a live server cannot move its CWD | S:85 R:80 A:90 D:85 |
| 9 | Certain | Out of scope: wt-side pinning, upstream tmux bug report, UI surfacing of dangling session_paths, live-server remediation | Explicitly decided in the investigation with reasons for each | S:95 R:90 A:95 D:95 |

9 assumptions (6 certain, 3 confident, 0 tentative, 0 unresolved).

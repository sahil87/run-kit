# Intake: Respawn-aware `rk code-server install`

**Change**: 260813-2s4u-respawn-aware-code-server-install
**Created**: 2026-08-13

## Origin

Promptless dispatch (`/fab-proceed` create-new) from a synthesized design discussion, captured faithfully. The user hit the gap in production right after PR #582 merged and approved the decision below.

> Respawn-aware `rk code-server install` — close the brew-era migration gap. A machine whose code-server predates the rk-managed install (brew's deprecated 4.112.0 on PATH) never migrates to the managed install and keeps serving the old editor indefinitely. Make an explicit `rk code-server install` respawn the running `rk-code-server` session onto the managed binary when it is running a foreign binary — behind the daemon gate — and fold in the open #582 review should-fix: the update flow's kill must be daemon-gated too, via one shared respawn helper.

Manual unblock the user had to perform: `rk code-server install` + `tmux -L rk-daemon kill-session -t '=rk-code-server'` + `rk code-server start`.

## Why

**Problem (observed in production right after PR #582 merged).** A brew-era machine — code-server 4.112.0 on PATH, the normal pre-#582 world — never migrates to the rk-managed install:

1. The `rk update` code-server leg gates on `~/.rk/code-server-bin` existing (`runCodeServerUpdateFlow` in `app/backend/cmd/rk/code_server.go` — the "only touch what rk owns" ownership gate, which is correct and staying) → prints the not-managed skip and does nothing.
2. The daemon's `rk-jobs` install job fires only when NO binary resolves on either ladder rung (`resolveCodeServerBinary`) — brew's PATH binary satisfies rung 2, so acquisition never fires.
3. The running `rk-code-server` session deliberately survives `rk daemon restart` (sibling-session design, 260811-a2bo / #578 — editor hot-exit state + server-side terminals live in that process; this survival is by design and MUST NOT change).
4. Even after a manual `rk code-server install`, the running session keeps the old brew binary: `rk code-server update` sees the fresh install as already-current, which short-circuits the respawn ("already current — no restart either", code_server.go:227-229).

The user hit exactly this: merged #582, ran the update, `rk daemon restart` — still on 4.112.0.

**Consequence if unfixed.** Every brew-era machine serves the deprecated editor indefinitely; the only path onto the managed install is a manual tmux kill-session — the exact class of footgun rk exists to prevent.

**Why this approach.** An explicit `install` is unambiguous user intent to move the running editor onto the managed binary — so install (not update) gains the migration respawn, without weakening the `update` verb's ownership gate. A second, related defect from the #582 review (`.fab-dispatch/oid2/review-result.yaml` should-fix) is folded in because the fix is the same seam: the update flow kills the session BEFORE the daemon-gated start runs — with the daemon down (a designed state, siblings outlive it) the editor is torn down and the restart then fails naming `rk serve -d`; with the socket fully dead, the kill's has-session probe can BIRTH a stray tmux server (the exact side effect the RunJob/StartCodeServer daemon gates exist to prevent). One shared, daemon-gated respawn helper closes both.

## What Changes

### 1. Shared daemon-gated respawn helper

Extract the update flow's kill+start sequence (`app/backend/cmd/rk/code_server.go:231-245` — `codeServerKillFn` + `codeServerStartFn` + the `EnsureExternallyManaged` note) into one respawn helper **with the daemon gate inside**:

- Check `jobDaemonRunning` (or the equivalent exported seam — `jobDaemonRunning` is unexported in `internal/daemon/jobs.go:34`, so an exported entry following the package-seam idiom may be needed) **BEFORE any kill**. Daemon down ⇒ do not kill anything, do not touch tmux at all — any tmux command on a dead socket silently births a server (tmux-sessions memory + jobs.go decision 1; `KillCodeServerSession`'s has-session probe is itself a tmux command).
- Both `runCodeServerUpdateFlow` and install's new migration respawn call this helper. Update's early kill (currently before the gated start) is removed in favor of the helper.
- The `EnsureExternallyManaged` outcome (port already serving — externally managed instance) must keep its respectful skip + note in **both** callers.

### 2. `rk code-server install` gains migration-respawn behavior

After a successful install flow — **both** the version-changed AND the already-current outcomes — detect whether the running `rk-code-server` session is on a foreign binary, and if so kill-and-respawn it via the shared helper:

- **Detection**: read the running session's spawn command via tmux's `#{pane_start_command}` format on the `=rk-code-server:=code-server` exact-match target (the argv `ensureCodeServer`/`StartCodeServer` passed at spawn). If that command string does NOT contain the managed current binary path (`~/.rk/code-server-bin/current/bin/code-server`, home-resolved), the session is running a foreign (brew/PATH or stale) binary → respawn.
- A session spawned by the managed rung already embeds that absolute path in its argv (shipped behavior — assumption 10 of #582: the spawn uses the current-symlink path precisely so a flip needs no argv change). Note the subtlety: a symlink flip alone does NOT make the running process current (it keeps its old binary open) — but its `pane_start_command` still matches the current PATH STRING, so string-match correctly treats managed-spawned sessions as "ours", and the version-changed respawn (existing update-flow behavior) remains the mechanism that picks up flips. The new install-side respawn targets FOREIGN-binary sessions (the migration case), not flip refresh.
- **No session** → the detection finds nothing and install does nothing extra (covers the daemon job chain, below).
- **Daemon down** → the gate skips the whole kill+respawn; print/log the skip (install still succeeded — the managed binary is staged). Careful with the skip message: `ensureCodeServer`'s session-exists skip means an already-running foreign session PERSISTS across daemon restarts — the next daemon start will NOT pick up the managed binary while the old session lives — so the skip message should name the manual path rather than implying it self-heals.

### 3. `rk code-server update` keeps its semantics; its kill becomes daemon-gated

- The ownership gate (not-managed skip when `~/.rk/code-server-bin` is absent) is **untouched**.
- The already-current short-circuit (no restart when nothing changed) is untouched — that remains update's contract; install is now the verb that migrates a foreign session.
- The version-changed respawn now goes through the shared helper, gaining the daemon gate (fixes the #582 should-fix: no kill with the daemon down, no tmux touch on a dead socket).

### 4. CLI surface unchanged

- No new commands or flags. `rk code-server install` gains the behavior; `update` keeps its semantics.
- help-dump shape-stable except `Long:` prose on install (document the migration respawn).
- Principle 9 (toolkit-standards): the respawn outcome is a **data** line (`Respawned code-server on the managed vX.Y.Z` / the daemon-down skip note); progress stays chatter.

### 5. The daemon job chain is unaffected

The `rk-jobs` install chain (`rk code-server install && rk code-server start`) is unaffected: in that context no session exists (the job only fires when no binary resolved on either rung, so nothing was spawned) — install's migration respawn finds no session and does nothing; `start` proceeds as today.

## Affected Memory

- `run-kit/architecture`: (modify) Daemon Lifecycle / CLI subcommand rows — install's migration respawn, the shared daemon-gated respawn helper, update-flow kill now gated
- `run-kit/toolkit-standards`: (modify) the `rk code-server` surface entry — install's new outcome lines (data vs chatter posture unchanged)

## Impact

- `app/backend/cmd/rk/code_server.go` — shared gated respawn helper; install flow gains detection + respawn; update flow calls the helper (its early kill removed).
- `app/backend/internal/daemon/codeserver.go` — possibly an exported seam for `pane_start_command` inspection / daemon-liveness (reuse existing seams `jobDaemonRunning`-style; follow the package-seam test idiom — `codeServerSessionExists`, `codeServerSpawn` precedents).
- Tests: `cmd/rk` CLI tests for install-respawn (foreign session → respawn; managed session → no respawn; no session → no-op; daemon down → gated skip with message; externally-managed port → respectful note), plus an update-flow gating regression (daemon down ⇒ no kill).
- change_type: **fix**.
- Constitution: I (argv-only tmux via `exec.CommandContext`, exact-match `=` targets), II (derive session state from tmux at call time — the detection reads `pane_start_command` live, no cached state), VI (sibling survival design unchanged — the respawn is an explicit user verb, not a daemon lifecycle change).

## Open Questions

- None — the design discussion pinned the mechanics; remaining micro-decisions are graded below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Install-side respawn fires on BOTH install outcomes (version-changed and already-current) whenever the running session is on a foreign binary | User-approved decision, verbatim in the design discussion | S:95 R:85 A:95 D:95 |
| 2 | Certain | Detection = string-contains of the home-resolved managed current path (`~/.rk/code-server-bin/current/bin/code-server`) in `#{pane_start_command}` on the `=rk-code-server:=code-server` exact-match target | Discussed with specific values; managed-rung spawns embed the current-symlink path in argv (#582 assumption 10), so string-match classifies correctly | S:95 R:80 A:90 D:90 |
| 3 | Certain | One shared respawn helper (daemon gate INSIDE) extracted from code_server.go:231-245; both update and install-migration call it; EnsureExternallyManaged keeps its respectful note in both callers | User-approved; folds the #582 should-fix (.fab-dispatch/oid2/review-result.yaml) at its root seam | S:95 R:80 A:95 D:95 |
| 4 | Certain | Daemon down ⇒ zero tmux commands (no kill, no has-session probe — server-birth hazard); the skip is printed and install/update still exit 0 reporting the install outcome | Discussed explicitly; mirrors the RunJob/StartCodeServer gates and jobs.go decision 1 | S:90 R:85 A:90 D:90 |
| 5 | Certain | Update's ownership gate and already-current short-circuit unchanged; no new CLI commands/flags; help-dump shape-stable except install's `Long:` prose | Discussed explicitly — "update's not-managed skip is untouched"; toolkit-standards Principle 9 posture stated | S:95 R:85 A:95 D:95 |
| 6 | Certain | change_type = fix | Stated in the design description; closes a production migration gap | S:90 R:95 A:95 D:95 |
| 7 | Confident | Exact wording of the daemon-down skip line: names the manual recovery path (foreign session persists across daemon restarts via ensureCodeServer's session-exists skip — it does not self-heal); respawn outcome is a data line, progress chatter | Direction discussed (message "should name the manual path"); precise copy left to apply under Principle 9 | S:70 R:90 A:75 D:70 |
| 8 | Confident | Edge handling: an empty/non-matching `pane_start_command` on an existing session classifies as foreign (→ respawn — the migration case); a tmux QUERY error skips the respawn with a note rather than killing on uncertain evidence | Not explicitly discussed; conservative "never kill on uncertain evidence" aligns with the only-touch-what-rk-owns posture; easily revisited | S:65 R:75 A:75 D:65 |
| 9 | Confident | The pane-inspection / daemon-liveness seam lives in `internal/daemon` as exported entr(ies) following the package-seam test idiom (`codeServerSessionExists`/`jobDaemonRunning` precedents); exact naming and placement decided at apply | Impact section says "possibly an exported seam ... reuse existing seams"; the idiom is established in the package | S:70 R:85 A:80 D:75 |
| 10 | Certain | Daemon job chain (`rk code-server install && rk code-server start`) unaffected: no session exists in that context, so the migration respawn no-ops and `start` proceeds | Discussed explicitly with the reasoning (job fires only when no binary resolved) | S:90 R:85 A:90 D:90 |

10 assumptions (7 certain, 3 confident, 0 tentative, 0 unresolved).

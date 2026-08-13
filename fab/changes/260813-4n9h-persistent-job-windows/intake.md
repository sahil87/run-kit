# Intake: Persistent Job Windows

**Change**: 260813-4n9h-persistent-job-windows
**Created**: 2026-08-13

## Origin

Live conversation (2026-08-13), dispatched promptless via `/fab-proceed`. The user's verbatim use case:

> once the update is over, I don't want the window to go away. Until the next update.

The user approved the flip after being shown the mechanism (`remain-on-exit failed` → `remain-on-exit on` in `daemon.RunJob`) and the consequence (the dashboard's rk-daemon server permanently shows the `rk-jobs:update` — and any other job — window as a dead pane between runs). The persistent row is the feature, not an accepted cost.

## Why

1. **The pain point**: today `daemon.RunJob` sets `remain-on-exit failed` on the job window (`app/backend/internal/daemon/jobs.go:214`), so the pane persists only on non-zero exit. A **successful** `update` or `restart` job closes its window on completion — the final scrollback (what the update actually did, versions installed, restart sequence) vanishes from the dashboard the moment the job succeeds. The evidence survives only in `~/.rk/<window>.log`, which is not visible on the terminal route.
2. **If we don't change it**: the watchable-job story stays asymmetric — failures leave visible evidence, successes disappear. The user explicitly wants the completed job's output on screen until the next run replaces it.
3. **Why this approach**: the machinery already anticipates persistent dead panes. `jobWindowState` probes `#{pane_dead}` (jobs.go:54–67), and a dead job window is relaunched **in place** by the next run via `respawn-window -k` (the reap-on-rerun path, jobs.go:192–198) — the window ID stays stable and no extra windows accumulate. Output remains tee'd to `~/.rk/<window>.log` via `pipe-pane` regardless. Flipping the option value from `failed` to `on` is the entire behavioral change; everything downstream already handles it.

## What Changes

### 1. The `set-option` argv flip (jobs.go:214)

```go
// before
jobRunTmux(cmdCtx, "set-option", "-w", "-t", winTarget, "remain-on-exit", "failed")
// after
jobRunTmux(cmdCtx, "set-option", "-w", "-t", winTarget, "remain-on-exit", "on")
```

With `on`, the rk-jobs job window (e.g. `update`, `restart`) survives its command's exit as a dead pane showing the final scrollback — success AND failure — instead of closing on success. Still best-effort/warn-only, never failing the spawn.

### 2. Present-truth comment updates (jobs.go)

- **RunJob doc block step 5** (jobs.go:125–128): "remain-on-exit failed (pane persists only on non-zero exit, tmux ≥ 3.2)" → the pane persists after ANY exit. The tmux ≥ 3.2 version caveat can be dropped or adjusted: only the `failed` **value** required tmux ≥ 3.2; `remain-on-exit on` works on older tmux too.
- **Step 3 dedup wording** (jobs.go:113–116): "a dead pane (remained after a failed run — remain-on-exit failed)" → present truth: a dead pane is a **completed prior run** (any exit status).
- **Body comment at the respawn branch** (jobs.go:186–191): "Stale failed window (remained on non-zero exit)" → a completed prior run's window.

### 3. Warn-only failure log rewording (jobs.go:215)

Current message: `"job window remain-on-exit failed to set; the window will close on failure too"`. Reword to the new stake: with the option unset the window closes on exit, losing the persistent evidence (exact phrasing is apply's; the semantic above is fixed).

### 4. Tests (app/backend/internal/daemon/jobs_test.go)

- The argv assertion at jobs_test.go:137 (`"set-option -w -t =rk-jobs:=update remain-on-exit failed"`) updates to `remain-on-exit on`. Sweep for any other literal `remain-on-exit` expectations.
- `TestRunJobIntegration_FailedJobRemainsDeadThenRespawns` (jobs_test.go:434–484) still passes under `on` (a failed pane still remains); its comments referencing "remain-on-exit failed" update to present truth.
- Per code-quality ("changed behavior MUST include tests"): extend integration coverage to assert a **successful** (exit 0) job also remains as a dead pane and is respawned in place by the next run — the new behavior this change introduces.

### 5. Stale CLI help text (app/backend/cmd/rk/daemon_run.go:25–28)

Discovered adjacent surface, one step beyond the conversation's enumerated scope: the `rk daemon run` Long help says "On a non-zero exit the pane remains (remain-on-exit failed) so the failure output stays visible; the next run of the same --window reaps it." After the flip this is stale — update to: the pane remains after the command exits (success or failure); the next run of the same `--window` respawns in place. Constitution § Toolkit Standards applies to help-output changes (check `shll standards` for the governing entries; Principle 9's bounded-output rule is untouched — this is Long-help prose only).

### Non-goals

- No dashboard/UI changes — the persistent dead-pane row rides the existing `ListServers` enumeration for free.
- No change to the respawn/dedup logic, `pipe-pane` logging, window naming, or the daemon gate.
- No per-job configurability of the persistence — a flat flip for all job windows.
- The rk-remotes tunnel known-gap (remote-hosts memory: a user-config `remain-on-exit on` leaves dead ssh windows that duplicate on reconnect) is unaffected — this change sets the option per-window (`set-option -w -t =rk-jobs:=<window>`) on rk-jobs job windows only; rk-remotes windows are untouched.

## Affected Memory

- `run-kit/architecture`: (modify) Present-truth update across every `remain-on-exit failed` mention — pane persists after EVERY run until the next in-place respawn, success evidence included:
  - § Backend libraries `internal/daemon` table row (~line 114): "best-effort post-spawn `remain-on-exit failed`"
  - § API `/api/restart` route row (~line 210): "the window's remained pane (`remain-on-exit failed`) … make it diagnosable"
  - § Daemon Lifecycle rk-jobs sibling-session paragraph (~line 476): "`set-option -w remain-on-exit failed` (the pane persists only on non-zero exit, tmux ≥ 3.2 — failure evidence stays visible; success cleans up)"
  - § Design Decisions entry for `260812-z1ya` (~line 1016): "`remain-on-exit failed` keeps failure evidence in the pane"
  - § Design Decisions toolkit-update entry (~line 1094): "the `remain-on-exit failed` job window + teed log carry the evidence"

## Impact

- `app/backend/internal/daemon/jobs.go` — one argv token change + comment/log-message updates (the sole behavior change).
- `app/backend/internal/daemon/jobs_test.go` — argv assertion flip, comment updates, new success-persistence integration coverage.
- `app/backend/cmd/rk/daemon_run.go` — Long help text present-truth update (no flag/output-shape change).
- `docs/memory/run-kit/architecture.md` — hydrate-stage present-truth updates (listed above).
- **User-visible behavior**: the rk-daemon server on the dashboard permanently shows `rk-jobs:<window>` rows as dead panes between runs (previously only after failures). No API shape change, no frontend change, no new routes.

## Open Questions

None — the design was fully decided and approved in the originating conversation; promptless-defer recorded no deferred questions.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Flip the RunJob step-5 option argv to `remain-on-exit on` (jobs.go:214); job windows persist after ANY exit as dead panes | Discussed — user approved after being shown the mechanism and the consequence | S:95 R:90 A:95 D:95 |
| 2 | Certain | The permanent dead-pane `rk-jobs:<window>` dashboard row between runs is the intended feature, not a regression to guard against | Consequence explicitly surfaced to the user, who said go ahead | S:95 R:85 A:90 D:95 |
| 3 | Certain | Respawn/dedup logic, pipe-pane logging, window naming, daemon gate, and UI stay untouched; flat flip, no per-job configurability | Non-goals enumerated in the approved conversation | S:90 R:85 A:95 D:95 |
| 4 | Certain | Comments drop/adjust the tmux ≥ 3.2 caveat and state present truth (dead pane = completed prior run) | Only the `failed` VALUE required tmux ≥ 3.2; `on` predates it — tmux-documented, and the conversation directed the wording update | S:85 R:95 A:90 D:90 |
| 5 | Certain | Warn log rewords to: option unset ⇒ window closes on exit, losing the persistent evidence (exact phrasing apply's) | Semantic fixed by the conversation; phrasing is presentation | S:85 R:95 A:85 D:80 |
| 6 | Confident | Integration coverage extends to assert a successful (exit 0) job also remains dead and respawns in place; unit argv assertion flips to `on` | Code-quality requires tests covering changed behavior; success-persistence IS the new behavior — inferred, not user-enumerated | S:65 R:90 A:80 D:75 |
| 7 | Confident | The stale `rk daemon run` Long help text (daemon_run.go:25–28) updates in the same change | Adjacent surface outside the conversation's enumerated jobs.go+tests+memory scope, but it describes the flipped behavior — leaving it ships stale help; toolkit help standards apply | S:65 R:90 A:75 D:75 |
| 8 | Certain | change_type pinned to `feat` via `fab status set-change-type` (explicit source survives refresh re-inference) | Dispatcher-directed; a deliberate product behavior change, not a defect fix — and the intake text mentions "fix"-adjacent words that could flip an inferred type | S:85 R:95 A:90 D:85 |
| 9 | Certain | The rk-remotes dead-window duplicate gap is out of scope and unaffected | `set-option -w -t =rk-jobs:=<window>` scopes to the job window only; rk-remotes windows never receive it | S:80 R:90 A:90 D:90 |

9 assumptions (7 certain, 2 confident, 0 tentative, 0 unresolved).

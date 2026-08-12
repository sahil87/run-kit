# Intake: Fix Job-Window Probe Fallback

**Change**: 260812-anac-fix-job-window-probe-fallback
**Created**: 2026-08-13

## Origin

Conversational — live production failure diagnosed with the user immediately after releasing 260812-z1ya (PR #568, released as run-kit 3.15.10). User's report:

> This was released. But click on update took me to this tmux session - but there wasn't any command there. Is this what was supposed to happen?

Screenshot showed the dashboard navigated to an idle `sahil` zsh window inside `rk-jobs` on the rk-daemon server, chip stuck on "updating…".

## Why

**Diagnosed root cause (verified live on the affected host, tmux 3.6a).** `RunJob`'s window-dedup probe (`jobWindowState`, app/backend/internal/daemon/jobs.go:49) uses `display-message -p -t '=rk-jobs:=<window>'`. On tmux 3.6a, `display-message` with a target whose WINDOW part does not resolve **silently falls back to the session's active window and exits 0** instead of erroring:

```
$ tmux -L rk-daemon display-message -p -t '=rk-jobs:=doesnotexist' '#{window_id} #{window_name}'
@3 sahil        # exit 0 — the session's active window, NOT an error
$ tmux -L rk-daemon list-panes -t '=rk-jobs:=update'
can't find window: update    # exit 1 — hard failure, as needed
```

Failure sequence on the user's first update click:

1. Session-ensure `new-session -d -s rk-jobs` created the session — including tmux's default idle shell window `@3` (auto-named `sahil` by folder naming).
2. The dedup probe for the (never-created) `update` window fell back to `@3 sahil`, returning `exists=true, dead=false`.
3. RunJob took the in-flight branch: **the update command was never spawned**; `started=false` with `WindowID=@3` was returned.
4. The handler returned `200 {"status":"already-running","watch":{…window_id:"@3"}}` and the frontend's already-running branch navigated the user to the idle window.
5. The chip stayed "updating…" forever — no daemon restart, no key change, no completion signal can arrive.

Corroborating evidence, all verified: the server's highest window id is `@3` (a spawn would have minted `@4`); `~/.rk/update.log` mtime predates the click (pipe-pane never ran); `remain-on-exit` is `off` (post-spawn options never ran); no daemon restart.

**Why tests missed it**: unit tests stub `jobWindowState` wholesale, so the real `display-message` behavior was never exercised — exactly the seam-discipline inconsistency the change's own review flagged as a should-fix (the default implementation also bypasses the declared `jobRunTmuxOutput` seam). The false positive lives in the one code path no test runs.

**Consequence if unfixed**: the headline feature of 3.15.10 is fully broken on first use — every update/restart click on a fresh `rk-jobs` session no-ops and strands the user in an idle shell with a permanently stuck "updating…" chip.

## What Changes

### 1. Probe with a command that hard-fails on a missing window

Replace `display-message` in `jobWindowState` (app/backend/internal/daemon/jobs.go:48-58) with `list-panes`, which errors (`can't find window`, exit 1) when the window does not exist:

```go
var jobWindowState = func(ctx context.Context, target string) (id string, dead bool, exists bool) {
    out, err := jobRunTmuxOutput(ctx, "list-panes", "-t", target, "-F", "#{window_id} #{pane_dead}")
    if err != nil {
        return "", false, false // window absent ("can't find window") or probe failure
    }
    // single-pane job window → first line carries both fields
    ...
}
```

This also resolves the review's outstanding should-fix: the implementation goes through the declared `jobRunTmuxOutput` seam instead of calling `runTmuxOutput` directly. (A job window has exactly one pane; parse the first line, tolerate trailing lines defensively.)

### 2. Create the session WITH the first job window

Replace the bare session-ensure + new-window pair with the `internal/remote/tunnel.go` pattern — when `rk-jobs` is absent, the first job window IS the session's first window:

- session absent → `new-session -d -s rk-jobs -n <window> -P -F '#{window_id}' <argv…>` (no idle default window is ever created; the dedup probe is skipped — the session didn't exist, so no job window can be in flight; the create-race `duplicate session` fallback retries through the session-exists path)
- session exists → today's probe → dedup → `new-window` path, with the fixed probe

This removes the permanent idle `sahil` window (nice-to-have #2 from the original review, now user-visible sidebar noise) at the source. Post-spawn options (remain-on-exit failed, pipe-pane) apply identically to both spawn shapes.

### 3. Close the integration test gap

Add an integration test that runs the REAL `jobWindowState` + spawn sequence against an isolated scratch tmux socket (repo precedent: existing `internal/tmux` socket-scoped tests), asserting at minimum:

- probe on a session whose only window is the default idle one returns `exists=false` for a job-window name (the exact regression),
- probe returns `exists=true, dead=false` for a live spawned window and `dead=true` after its command exits non-zero under `remain-on-exit failed`,
- session-absent spawn creates the session with the job window as its ONLY window (no idle default).

Guard with the same skip-if-no-tmux convention the existing socket tests use. Keep the existing seam-stubbed unit tests (they cover RunJob's branching; the integration test covers the seam's default implementation).

### Explicitly unchanged

- API handlers, response shapes, frontend navigation — all behaved correctly given the lie they were told; no changes.
- `rk daemon run` CLI surface unchanged (it consumes the same fixed `RunJob`).
- The fast-exit race (a command exiting before `set-option remain-on-exit` lands leaves no failure evidence) is acknowledged but NOT addressed here — millisecond window, worst case equals the pre-3.15.10 fire-and-forget; noting it in the plan's Non-Goals keeps this fix surgical.

## Affected Memory

- `run-kit/architecture`: (modify) RunJob dedup-probe mechanism (list-panes, not display-message — with the fallback gotcha documented) and the session-created-with-first-job-window shape

## Impact

- **Backend only**: `app/backend/internal/daemon/jobs.go` (probe + spawn shape), `jobs_test.go` (updated argv assertions + new integration test file or section). No API, CLI-surface, or frontend changes.
- **Behavior**: first click on a fresh host actually spawns the job; no idle window in `rk-jobs`; `already-running` now truthful.
- **Ops note (not code)**: affected hosts carry a junk `rk-jobs` session — self-heals on next spawn or via `tmux -L rk-daemon kill-session -t '=rk-jobs'`; stuck "updating…" chips clear on tab reload.

## Open Questions

- None — root cause is verified empirically on the affected host; fix decisions were made in the diagnosis conversation.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Root cause is display-message's active-window fallback on unresolvable window targets | Reproduced live on the affected host (tmux 3.6a): fallback prints `@3 sahil` exit 0; `list-panes` errors exit 1; all four corroborating artifacts consistent | S:95 R:90 A:95 D:95 |
| 2 | Certain | Probe switches to `list-panes -F '#{window_id} #{pane_dead}'` | Verified to hard-fail on missing windows; carries both needed fields in one call | S:90 R:90 A:95 D:90 |
| 3 | Certain | Session created with the first job window (tunnel.go pattern); no idle default window | Discussed and user-approved in the fix proposal; established in-repo pattern (internal/remote) | S:90 R:85 A:95 D:90 |
| 4 | Certain | Integration test against an isolated scratch socket exercises the real probe | Discussed — the regression lived exactly in the untested seam default; repo has socket-test precedent | S:85 R:90 A:90 D:90 |
| 5 | Confident | Fast-exit options race is out of scope (documented as a plan Non-Goal) | Millisecond window; worst case equals pre-3.15.10 behavior; keeping the fix surgical aids review | S:70 R:85 A:85 D:80 |
| 6 | Confident | Probe parses the first `list-panes` line (job windows are single-pane by construction) | RunJob spawns single-pane windows; tolerant parse guards manual pane splits | S:65 R:85 A:85 D:80 |

6 assumptions (4 certain, 2 confident, 0 tentative, 0 unresolved).

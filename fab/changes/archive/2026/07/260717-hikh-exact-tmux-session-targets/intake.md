# Intake: Exact tmux session targets, window-id pane join, ghost TTL

**Change**: 260717-hikh-exact-tmux-session-targets
**Created**: 2026-07-18

## Origin

Adopted from PR [#380](https://github.com/sahil87/run-kit/pull/380) (branch `astral-lynx`) via `/fab-adopt` — the code was authored off-pipeline during a live debugging session, then brought into the pipeline. The work originated from a live bug report:

> Big issue: In the current "default values" of tmux config, the way the window name is decided, is from the folder name. Now this has happened to me once: I opened two windows in the same folder, and tmux hanged. This problem is live now in the tmux server "ext". […] The last "lifetracker" windows is greyed out and I am not able to go it. Can you diagnose the issue?

The session diagnosed the root cause live on server `ext` (with a scratch-server reproduction), implemented the fix, verified it, and shipped PR #380 — all before intake reconstruction. Interaction mode: conversational diagnosis → user-approved fix ("rebase to latest. The apply the fixes.") → PR → adopt.

## Why

**Problem.** tmux resolves a bare `-t <session>` differently per command. For `list-windows` the `-t` is a *session* target (exact session name wins), but for `new-window` and `list-panes` (even under `-s`) it is a *window* target: tmux matches the string against the **window names of the current/attached session before** trying it as a session name. run-kit auto-names both windows AND sessions from folder basenames (`automatic-rename-format '#{b:pane_current_path}'`), so a window named like a session is a routine occurrence, not an edge case.

**Observed live** (server `ext`, 2026-07-17): session `0` (attached) had a window named `planner`, and a session named `planner` also existed. Consequences:

1. `new-window -a -t planner` (a UI "+ New Window" on session `planner`) created the window **in session `0`**, inserted after the window named `planner`.
2. The sidebar's optimistic ghost row for the create was never claimed — ghosts are claimed only by a **new windowId arriving in the target session** via SSE — so a permanently greyed, pulsing, unclickable `lifetracker` row was stranded under session `planner` (the user's "greyed out … not able to go to it").
3. `list-panes -s -t planner` returned **session 0's panes**, and `ListWindows`' window-**index** pane join glued them onto session `planner`'s windows — the API served another session's pane cwd/branch/agent-state on every SSE tick (smoking gun: the same pane id `%0` appeared twice in one `/api/sessions` response, impossible in real tmux).

**If unfixed**: any name collision silently misroutes window creation, corrupts the pane data the whole UI derives state from, and strands ghost rows — with no error anywhere.

**Approach over alternatives**: tmux's exact-match target form `=name:` (leading `=` disables prefix/fnmatch matching; trailing `:` forces session parsing) was chosen over resolving `$N` session IDs per call (extra subprocess round-trip) — it is pure string composition, empirically verified against every touched command shape including numeric session names (`=0:`). The pane join moved from window-index to window-id keys so any residual target divergence degrades to visibly-empty panes instead of silently-wrong data. A frontend TTL backstops the unclaimable-ghost failure mode generically.

## What Changes

### internal/tmux — exact-match session targets

New helpers in `app/backend/internal/tmux/tmux.go`:

- `ExactSessionTarget(session) → "=" + session + ":"` (exported — riff consumes it too)
- `exactWindowInSession(session, windowSpec) → "=" + session + ":" + windowSpec` (windowSpec = `@N` id or numeric index)

Applied at every call site that previously passed a bare session name:

- `ListWindows`: both `list-windows -t` and `list-panes -s -t`
- `buildCreateWindowArgs` / `CreateWindowWithOptions`: `new-window -a -t` (the misroute vector)
- `KillSession`, `RenameSession`
- `MoveWindow`: its `list-windows` read, the `swap-window` src/dst chain (`=session:index`), and the active-window-restore `select-window` (`=session:@id`)
- `MoveWindowToSession`: dst `=session:` (was `session:`)
- `SelectWindowInSession`: `=session:@id`
- `board.go`: `showSessionOption`/`setSessionOption`, all five `has-session` probes, the pin-session `list-windows`, and the recovery-path `set-option -u` calls

Session names are validated to contain no `:`/`.` (`validate.ValidateName`), so the composition is injection-safe. `daemon`/`tmuxctl` already carried their own `=` discipline; `internal/tmux` and `internal/riff` were the only bare-name offenders.

### internal/tmux — pane join keyed by window id

- `paneFormat` field 0: `#{window_index}` → `#{window_id}`
- `parsePanes` returns `map[string][]PaneInfo` keyed by window id (was `map[int]` keyed by index), with a `ValidWindowID` guard dropping malformed first fields
- `ListWindows` attaches `byWindow[w.WindowID]` (was `byWindow[w.Index]`)

A cross-session divergence now yields empty pane lists (visible degradation) instead of another session's data (silent corruption).

### internal/riff — spawn targets

`app/backend/internal/riff/shell.go` + `riff.go`:

- `sessionTarget(spec)` returns `tmux.ExactSessionTarget(spec.Session)` on the daemon path ("" on the CLI path — unscoped, byte-identical to before)
- `windowTarget(spec, name)` returns `=session:name` on the daemon path (bare `name` on the CLI path). The window-name part stays non-exact: riff uniquifies window names within the session before spawn.
- `listWindowNames` collision probe: `list-windows -t =session:`
- riff now imports `rk/internal/tmux` (no cycle; tmux imports only validate/stdlib)

### frontend — ghost window TTL

`app/frontend/src/store/window-store.ts`:

- `GHOST_WINDOW_TTL_MS = 15_000` (exported) + a `setTimeout` in `addGhostWindow` that `removeGhost`s the ghost after the TTL. `removeGhost` is idempotent, so a timer firing after claim/rollback is a no-op. Ordinary creates confirm within one SSE tick (~1–2s); the TTL only catches the "create succeeded somewhere else / confirming tick never comes" strand.

### Tests

- `TestSessionWindowNameCollision` (real-tmux integration, reuses `withSessionOrderTmux`): reproduces the session/window name collision, asserts the create lands in the named session and that pane joins never carry the other session's pane ids
- `TestExactSessionTarget` unit-pins the `=name:` form (incl. numeric `=0:` and pin-session names)
- `parsePanes` fixtures migrated to window-id keys + new skip-test for non-`@N` first fields
- riff argv expectations updated to the exact forms
- Frontend: two fake-timer tests for ghost TTL expiry and claimed-ghost no-op

## Affected Memory

- `run-kit/tmux-sessions`: (modify) — the exact-match session-target convention (`ExactSessionTarget` `=name:`, window-target vs session-target `-t` semantics, the name-collision hazard), the window-id-keyed pane join, and the `MoveWindow`/`SelectWindowInSession` target forms it already documents
- `run-kit/ui-patterns`: (modify) — the sidebar optimistic ghost-window row gains the 15s TTL backstop (extends the existing "unnamed + New Window folder auto-naming / sidebar ghost" entry)

## Impact

- 8 files, +363/−139 against `main` merge-base `c9702b3b` — all within `source_paths`
- Backend: `internal/tmux/{tmux,board}.go` (+tests), `internal/riff/{riff,shell}.go` (+tests)
- Frontend: `src/store/window-store.ts` (+test)
- No API surface change, no route change, no schema change; behavior-preserving except where the old behavior was the bug
- Verified: full backend suite (includes real-tmux integration tests), 1375 frontend unit tests, `tsc` clean, `new-window-unnamed` e2e on the isolated :3020 server
- Live remediation already performed on `ext`: stray window `@5` moved back to session `planner`

## Open Questions

None — the fix is implemented, verified, and shipped as PR #380.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Root cause = bare-name `-t` window-target resolution (window name shadows session name) | Reproduced live on `ext` AND on a scratch server; pinned by a real-tmux regression test | S:95 R:90 A:95 D:95 |
| 2 | Certain | `=name:` exact form is safe on every touched command shape | Empirically verified per command (list-windows/list-panes/new-window/has-session/kill/rename/move/swap/select/set-option), incl. numeric session names | S:90 R:85 A:95 D:90 |
| 3 | Confident | `GHOST_WINDOW_TTL_MS = 15s` | No user-specified value; SSE confirms in ~1–2s so any ≥10s works; single exported constant, trivially tunable | S:60 R:95 A:80 D:70 |
| 4 | Confident | Extend `=` hygiene to session-target commands too (kill/rename/has-session/options), not only the two proven window-target offenders | Defensive; behavior-identical when the named session exists (exact match already won); prevents prefix/fnmatch misroutes when it doesn't | S:65 R:90 A:80 D:70 |
| 5 | Confident | riff `windowTarget` keeps the window-name part non-exact (`=session:name`, not `=session:=name`) | riff uniquifies window names within the session pre-spawn; the cross-session hazard is the session part | S:60 R:85 A:75 D:65 |

5 assumptions (2 certain, 3 confident, 0 tentative, 0 unresolved).

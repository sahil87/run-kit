# Intake: Web-UI Spawn Agent

**Change**: 260713-sbk1-web-spawn-agent
**Created**: 2026-07-13

## Origin

One-shot invocation: `/fab-new sbk1` — backlog item `[sbk1]` (dated 2026-07-13, same day; verified current against the codebase at intake time). No prior conversation context. The backlog entry is the sole input and functions as an authoritative mini-spec — it pre-resolves the major design decisions (extraction boundary, endpoint shapes, task-injection mechanism, out-of-scope list). Raw input, verbatim:

> Web-UI Spawn Agent — surface `rk riff` in the dashboard as a one-action spawn flow (palette action + dialog + POST endpoint). The spawn ENGINE ALREADY EXISTS as the `rk riff` CLI (app/backend/cmd/rk/riff.go; full semantics in docs/memory/run-kit/rk-riff.md): worktree via `wt create` -> tmux window rooted in it -> agent launcher resolved via `fab agent --print` (default-tier session_command, silent fallback to defaultLauncher), with presets (riff.presets in fab/project/config.yaml via internal/fabconfig ReadPresetsOrdered), 12 layouts, riff-<worktree-basename> window naming with resolveWindowName collision suffixes, fan-out + rollback. This item is ONLY the web surfacing — do not reinvent the recipe. UX: (1) Cmd+K action "Agent: Spawn" (Constitution V — palette parity mandatory; document the shortcut in the palette registration per code-review.md); (2) "+ New Agent" item in the top-bar window-switcher dropdown next to "+ New Window" (src/components/top-bar.tsx); both open one compact dialog (follow the existing create-session/rename dialog patterns): field 1 TASK (free text, optional — empty spawns a blank agent session), field 2 PRESET (dropdown, optional, populated from a new GET; severable to v1.1 if repo-derivation preflight proves awkward). Enter submits from any field. On success the browser navigates to the new window at /$server/$window (endpoint returns server + windowId/window name; the SSE stream surfaces the sidebar row). In-flight: dialog shows a busy/step state (worktree -> window -> agent) — `wt create` can take seconds. BACKEND: do NOT shell out to `rk riff` from the daemon — its preconditions are CLI-shaped ($TMUX set, cwd = repo). Instead EXTRACT the engine (runWtCreate, spawnRiff, resolveLauncher/parseFabAgentOutput, resolveWindowName, pane/layout/shell-string helpers) from cmd/rk/riff.go into a new internal package (e.g. internal/riff) parameterized by explicit targets (tmux server, session, repo root) instead of $TMUX/cwd; the CLI keeps byte-identical behavior by passing its derived values (exit codes, rollback, fan-out, --list-presets all unchanged — riff_test.go pure-helper coverage must stay green). New endpoint POST /api/riff?server=<name> (Constitution IX POST-only) with body {task?, preset?, session} calling the same engine; target session = the session the user invoked from. REPO ROOT for `wt create`: derive from the target session active-pane cwd -> FindGitRoot (internal/config/runkit_yaml.go); return a clear 400 when the cwd is not a git repo (dialog shows the error, nothing created). PRESET LIST: GET /api/riff/presets?server=&session= reading ReadPresetsOrdered from the same derived repo root. TASK INJECTION (v1 decision, deliberate): pass the task text as the launcher positional arg reusing the EXISTING skill-pane seam (buildSkillShellString + escapeSingleQuotes) — proven mechanism, no timing dependency; it auto-submits on boot, same trust model as --skill. The paste-unsubmitted-for-human-review variant is explicitly DEFERRED: it needs send-keys after agent boot, no boot-complete hook event exists in the @rk_agent_state registry (docs/specs/agent-state.md maps UserPromptSubmit/PreToolUse/Notification/Stop only), and operator memory warns printed prompt text != live input buffer. TIMEOUTS: `wt create` is a build-class op (30s per constitution Process Execution); individual tmux calls keep 10s; the handler is synchronous and MAY exceed the 5s tmux-blocking review rule in aggregate — keep each tmux call <=10s and document the exception at the handler. SECURITY (Constitution I): all new exec paths are argv-slice exec.CommandContext with timeouts; task text is escaped via escapeSingleQuotes into the documented launcher exception (fab/project/config.yaml remains the trust boundary per rk-riff.md); validate session/server names via internal/validate before subprocess use. FILES: app/backend/cmd/rk/riff.go (thin to flag parsing + preconditions + param derivation), app/backend/internal/riff/ (new, extracted engine), app/backend/api/riff.go (new handler) + router.go registration, app/frontend/src/api/client.ts (spawnRiff + getRiffPresets), new spawn-agent dialog component, command-palette registration, top-bar.tsx dropdown item. TESTS: Go — extraction keeps existing riff_test.go green; httptest handler tests (validation, non-repo-cwd 400, success shape, task escaping); frontend — unit tests for dialog + palette action; Playwright e2e WITH companion .spec.md (constitution Test Companion Docs): mock POST /api/riff* and GET /api/riff/presets* WITH TRAILING * (playwright-glob memory: withServer appends ?server= — a no-star mock silently falls through and mutates live tmux), assert dialog opens from both entry points, submit navigates to the returned window, error path renders in-dialog; run via just test-e2e / just pw only, never raw playwright. ACCEPTANCE: from Cmd+K or the window-switcher dropdown, entering a task and hitting Enter yields a new riff-* window in the sidebar via SSE and navigates to it with the agent booting on the task; empty task = blank agent session; preset selected = preset panes/layout honored; non-repo session cwd = clear in-dialog error, no artifacts created; `rk riff` CLI behavior unchanged after extraction. OUT OF SCOPE (explicit): tier picker (riff resolves the default tier via `fab agent --print`; per-tier spawn needs a fab CLI seam first — see agent-state ownership split), fan-out count > 1 in the UI (engine supports it; expose later), unsubmitted-paste task injection (needs a boot-ready signal), spawn-into-existing-checkout (that is "+ New Window" today; riff identity is worktree isolation). RELATED: [6bdn] wt-workflow buttons (this implements its agent-spawn half), [63td] delete-worktree buttons (symmetric teardown follow-up), [rkx4] quick commands. CONSTITUTION: I, III (wt + fab wrapped not reinvented), IV (dialog not page), V, IX.

## Why

1. **The pain point**: run-kit's dashboard is monitor-and-drive today — you can watch agents, type into panes, pin boards — but you cannot *start* a new isolated agent workspace from it. The proven spawn recipe (`wt create` worktree → tmux window rooted in it → agent launcher, with presets, layouts, and collision-safe naming) exists only as the `rk riff` CLI, whose preconditions are terminal-shaped: `$TMUX` must be set and the process cwd must be the repo. An operator on the web UI (especially remote/mobile over Tailscale) has to fall back to SSH just to kick off the single most common workflow action.

2. **The consequence of not fixing it**: the dashboard stays read-mostly for new work. The "web-based agent orchestration framework" positioning has a hole at the start of the loop — you can orchestrate everything about an agent except its birth. Backlog items [6bdn] (wt-workflow buttons) and [rkx4] (quick commands) stay blocked on their most valuable half.

3. **Why this approach**: surface the existing engine rather than reinvent it (Constitution III — wrap, don't reinvent), and **extract** rather than shell out to `rk riff` from the daemon — the CLI's preconditions ($TMUX set, cwd = repo) don't hold in a daemon process, and faking them (env injection, cwd swapping) would be fragile. A parameterized `internal/riff` package gives one recipe with two thin frontends: the CLI (byte-identical behavior, derives its params from $TMUX/cwd as today) and a new HTTP handler (derives params from the request + target session). The UI is a dialog, not a page (Constitution IV), with palette parity (Constitution V).

## What Changes

### Backend: extract the riff engine into `internal/riff`

Move the engine out of `app/backend/cmd/rk/riff.go` into a new package `app/backend/internal/riff/`, parameterized by **explicit targets** instead of ambient state:

- **Moves**: `runWtCreate`, `spawnRiff`, `resolveLauncher`/`parseFabAgentOutput`, `listWindowNames`/`resolveWindowName`, the pane/layout/shell-string helpers (`buildSpawnArgvs`, `buildNewWindowCaptureArgs`, `parsePaneID`, `buildSkillShellString`, `buildCmdShellString`, `paneShellString`, `shellWrap`, `escapeSingleQuotes`, `resolveLayout`, `autoLayout`), and the timeout constants (`wtTimeout`, `tmuxTimeout`, `fabTimeout`).
- **Parameters replace ambient state**: tmux server (socket) + target session replace the CLI's `$TMUX`-derived targeting (`tmux.OriginalTMUX` / `tmuxChildEnv`); repo root replaces process-cwd. Launcher resolution passes the repo root explicitly to `fab agent --print` (the CLI today relies on fab's cwd-based repo discovery — the daemon's cwd is not the target repo, so the extracted engine sets the subprocess working directory to the repo root). The silent best-effort fallback to `defaultLauncher` (`claude --dangerously-skip-permissions`) is unchanged.
- **CLI keeps byte-identical behavior**: `cmd/rk/riff.go` thins to flag parsing + preconditions + param derivation ($TMUX check, cwd, `wt` on PATH) and calls the extracted engine with its derived values. Exit codes (0/1/2/3 discipline), fan-out + rollback (`runCount`, `planFanOutRollback`, `rollbackFanOut`, `wt delete --non-interactive`), signal handling, and `--list-presets` are all unchanged. The pure-helper test coverage currently in `riff_test.go` must stay green — tests move alongside the code they cover where the helpers move packages; coverage is not reduced.

### Backend: `POST /api/riff` spawn endpoint

New handler `app/backend/api/riff.go` + `router.go` registration (Constitution IX — POST-only mutation):

- **Request**: `POST /api/riff?server=<name>`, JSON body `{task?: string, preset?: string, session: string}`. Target session = the session the user invoked from. `server` and `session` names validated via `internal/validate` before any subprocess use.
- **Repo root derivation**: target session's active-pane cwd → `FindGitRoot` (`app/backend/internal/config/runkit_yaml.go`). If the cwd is not inside a git repo → clear `400` with a human-readable message (dialog renders it; nothing is created).
- **Engine call**: the same extracted engine — `wt create` (30s timeout, build-class op per constitution Process Execution) → tmux window in the target session rooted at the new worktree (each tmux call ≤ 10s) → agent launcher pane. Window naming stays `riff-<worktree-basename>` with `resolveWindowName` collision suffixes. Fan-out count is fixed at 1 from this endpoint (out of scope in the UI).
- **Task injection (v1 decision, deliberate)**: task text is passed as the launcher positional arg via the existing skill-pane seam (`buildSkillShellString` + `escapeSingleQuotes`) — proven mechanism, no timing dependency; it auto-submits on boot, same trust model as `--skill`. Empty task → blank agent session (bare launcher). The paste-unsubmitted-for-human-review variant is **deferred**: it needs send-keys after agent boot, no boot-complete hook event exists in the `@rk_agent_state` registry (docs/specs/agent-state.md maps UserPromptSubmit/PreToolUse/Notification/Stop only), and operator memory warns printed prompt text ≠ live input buffer.
- **Preset**: `preset` names a `riff.presets` entry from the derived repo's `fab/project/config.yaml`; preset panes/layout/wt_args honored. When **both** task and preset are provided, the task pane replaces the preset's panes and the preset still contributes layout + `wt_args` — mirroring the CLI's `resolveEffectiveSpec` rule 1 (CLI panes replace preset panes entirely). Unknown preset → 400.
- **Response**: `200` JSON `{server, session, window, windowId}` — enough for the client to navigate to `/$server/$window`. The sidebar row arrives via the existing SSE stream (no new SSE work).
- **Synchronous handler**: the aggregate may exceed the 5s tmux-blocking review rule (`wt create` alone can take seconds); each individual tmux call keeps its ≤ 10s timeout and the exception is documented in a comment at the handler.

### Backend: `GET /api/riff/presets` preset list

`GET /api/riff/presets?server=<name>&session=<name>`: derives the repo root exactly as the POST does (active-pane cwd → `FindGitRoot`), reads `ReadPresetsOrdered` from `internal/fabconfig`, and returns the presets in YAML source order — `{presets: [{name, layout, paneCount}]}` (names are what the dialog needs; layout/paneCount give the dropdown a one-line summary). Non-repo cwd → 400 (the dialog degrades to no preset dropdown or shows the error on submit); no presets defined → empty list (dropdown hidden or disabled). Severable to v1.1 if repo-derivation preflight proves awkward in practice.

### Frontend: spawn-agent dialog

New compact dialog component following the existing create-session/rename dialog patterns:

- **Field 1 — TASK**: free text, optional. Empty spawns a blank agent session.
- **Field 2 — PRESET**: dropdown, optional, populated from `GET /api/riff/presets` on open.
- **Enter submits from any field.**
- **In-flight**: a busy state naming the pipeline steps (worktree → window → agent) — indeterminate progress, since the synchronous endpoint emits no per-step events; `wt create` can take seconds, so the dialog must clearly show it is working and disable double-submit.
- **Error path**: a 400/500 renders its message in-dialog (nothing was created server-side on 400); the dialog stays open for correction.
- **Success**: close and navigate to the returned window at `/$server/$window`; the SSE stream surfaces the sidebar row.
- API client additions in `src/api/client.ts`: `spawnRiff` + `getRiffPresets`.

### Frontend: entry points

Both open the same dialog, on session-scoped routes (the terminal route, where the current window's session is the spawn target):

1. **Cmd+K action `Agent: Spawn`** — Constitution V palette parity is mandatory; document the shortcut in the palette registration per `fab/project/code-review.md` ("New keyboard shortcuts must be documented in the command palette registration").
2. **`+ New Agent` item** in the top-bar window-switcher dropdown, next to `+ New Window` (`src/components/top-bar.tsx`).

### Tests

- **Go**: extraction keeps the existing `riff_test.go` pure-helper coverage green (moved with the code where helpers change packages); httptest handler tests for `api/riff.go` — request validation, non-repo-cwd 400, success response shape, task escaping through the shell-string seam.
- **Frontend unit**: dialog component + palette action (Vitest, colocated `.test.tsx`).
- **Playwright e2e** with companion `.spec.md` (constitution Test Companion Docs): mock `POST /api/riff*` and `GET /api/riff/presets*` **with trailing `*`** (playwright-glob memory: `withServer` appends `?server=` — a no-star mock silently falls through and mutates live tmux); assert the dialog opens from both entry points, submit navigates to the returned window, and the error path renders in-dialog. Run via `just test-e2e` / `just pw` only, never raw playwright.

### Out of Scope (explicit)

- **Tier picker** — riff resolves the default tier via `fab agent --print`; per-tier spawn needs a fab CLI seam first (see agent-state ownership split).
- **Fan-out count > 1 in the UI** — the engine supports it; expose later.
- **Unsubmitted-paste task injection** — needs a boot-ready signal that doesn't exist yet.
- **Spawn-into-existing-checkout** — that is `+ New Window` today; riff's identity is worktree isolation.

## Affected Memory

- `run-kit/rk-riff`: (modify) engine extracted into `internal/riff` parameterized by explicit targets; CLI thins to flag parsing + preconditions + param derivation; launcher resolution now takes an explicit repo root
- `run-kit/architecture`: (modify) two new API endpoints — `POST /api/riff` (spawn) and `GET /api/riff/presets` — plus their repo-root derivation seam (active-pane cwd → `FindGitRoot`)
- `run-kit/ui-patterns`: (modify) spawn-agent dialog, `Agent: Spawn` palette action, `+ New Agent` window-switcher dropdown item

## Impact

- **Backend**: `app/backend/cmd/rk/riff.go` (thinned), `app/backend/internal/riff/` (new package, extracted engine), `app/backend/api/riff.go` (new handler) + `router.go` registration. Touches the tmux exec surface — Constitution I review weight (argv-slice `exec.CommandContext`, timeouts, `internal/validate` on all request-derived names).
- **Frontend**: `src/api/client.ts` (two new functions), new spawn-agent dialog component, command-palette registration, `src/components/top-bar.tsx` (dropdown item).
- **Tests**: Go unit (moved riff helpers + new httptest handler tests), frontend unit (dialog + palette), one new Playwright spec + `.spec.md` companion.
- **No new runtime dependencies; no new routes** (dialog, not page); `rk riff` CLI behavior unchanged (verified by existing test coverage).
- **Related backlog**: implements the agent-spawn half of [6bdn]; [63td] (delete-worktree buttons) is the symmetric teardown follow-up; [rkx4] quick commands is adjacent.

## Open Questions

None — the backlog entry pre-resolves the major design decisions (extraction over shell-out, endpoint shapes, v1 task injection, timeouts, out-of-scope list). The remaining gaps were filled as graded assumptions below; none scored Unresolved.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | New package is named `internal/riff`, parameterized by explicit `{server, session, repo root}` targets | Backlog names it ("e.g. internal/riff") and prescribes the parameterization; one obvious default | S:85 R:90 A:90 D:90 |
| 2 | Confident | POST response shape is `{server, session, window, windowId}` | Backlog pins the content ("server + windowId/window name") but not field names; trivially adjustable during apply | S:65 R:85 A:80 D:70 |
| 3 | Confident | Presets GET returns `{presets: [{name, layout, paneCount}]}` in YAML source order | Dialog needs names; layout/paneCount is a cheap dropdown summary; `ReadPresetsOrdered` already preserves order | S:55 R:90 A:75 D:65 |
| 4 | Confident | Task + preset together: task pane replaces preset panes; preset keeps layout + `wt_args` | Mirrors the CLI's `resolveEffectiveSpec` rule 1 (CLI panes replace preset panes entirely) — the codebase's own precedent | S:50 R:80 A:75 D:55 |
| 5 | Confident | Dialog busy state is indeterminate — steps (worktree → window → agent) shown as a static pipeline label, not live progression | The synchronous endpoint emits no per-step events; streaming progress would need a new SSE/long-poll seam, out of proportion for v1; pure UI, trivially changeable | S:60 R:90 A:70 D:60 |
| 6 | Confident | Entry points register on the terminal route only (window-switcher dropdown + palette action); Cockpit/board routes get no spawn action in v1 | "Target session = the session the user invoked from" requires a session context; the window-switcher host (top-bar terminal mode) defines where both entry points live | S:55 R:85 A:70 D:60 |
| 7 | Confident | Extracted launcher resolution runs `fab agent --print` with the subprocess working directory set to the derived repo root | The CLI relies on fab's cwd-based repo discovery; the daemon's cwd is not the target repo, so explicit rooting is the only correct generalization; silent `defaultLauncher` fallback unchanged | S:60 R:85 A:85 D:80 |

7 assumptions (1 certain, 6 confident, 0 tentative, 0 unresolved).

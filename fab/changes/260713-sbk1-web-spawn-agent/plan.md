# Plan: Web-UI Spawn Agent

**Change**: 260713-sbk1-web-spawn-agent
**Intake**: `intake.md`

## Requirements

### Backend: Riff Engine Extraction (`internal/riff`)

#### R1: Parameterized engine package
The riff spawn engine SHALL be extracted from `app/backend/cmd/rk/riff.go` into a new package `app/backend/internal/riff/`, parameterized by explicit targets — tmux server (socket label), target session, and repo root — instead of ambient `$TMUX`/process-cwd state. The moved surface is the spawn mechanics: `runWtCreate`, `spawnRiff`/`spawnRiffReturningName`, `resolveLauncher`/`parseFabAgentOutput`, `listWindowNames`/`resolveWindowName`, the pane/layout/shell-string helpers (`buildSpawnArgvs`, `buildNewWindowCaptureArgs`, `parsePaneID`, `buildSkillShellString`, `buildCmdShellString`, `paneShellString`, `shellWrap`, `escapeSingleQuotes`, `resolveLayout`, `autoLayout`, `resolveEffectiveSpec`, `resolveActivePreset`, `presetPaneToSpec`), the `PaneSpec`/`effectiveSpec` types, the fan-out helpers (`runCount`, `planFanOutRollback`, `rollbackFanOut`, `runWtDelete`, `buildWtDeleteArgs`), and the timeout constants (`wtTimeout`, `tmuxTimeout`, `fabTimeout`) + `defaultLauncher`/`defaultRiffSkill`.

- **GIVEN** the engine package with explicit `{server, session, repoRoot}` inputs
- **WHEN** the engine spawns a riff window
- **THEN** tmux subprocess calls target the passed server (via a `-L <server>` prefix when non-empty and a restored `$TMUX` env for the empty/CLI case), the window is created in the passed session, and `wt create` + `fab agent --print` run with their working directory set to the passed repo root
- **AND** window naming stays `riff-<worktree-basename>` with `resolveWindowName` collision suffixes

#### R2: Explicit repo-root rooting for launcher + presets
The extracted launcher resolution SHALL run `fab agent --print` with the subprocess working directory set to the passed repo root (not the daemon's cwd), and preset reads SHALL use the passed repo root via `fabconfig.ReadPresets`/`ReadPresetsOrdered`. The silent best-effort fallback to `defaultLauncher` on any `fab agent --print` failure SHALL be unchanged.

- **GIVEN** a repo root passed to the engine
- **WHEN** `resolveLauncher` runs `fab agent --print`
- **THEN** the subprocess `Dir` is the repo root so fab's cwd-based repo discovery resolves the target project
- **AND** an absent/failing/multi-line `fab` result still falls back to `defaultLauncher` with no error and no stderr noise

#### R3: CLI keeps byte-identical behavior
`app/backend/cmd/rk/riff.go` SHALL thin to flag parsing + preconditions + param derivation ($TMUX check via `tmux.OriginalTMUX`, `wt` on PATH, process cwd → `FindGitRoot`) and call the extracted engine with its derived values. Exit-code discipline (0/1/2/3), fan-out + rollback, signal handling, `--list-presets`, and the pane-flag argv grammar (`pane_spec.go`) SHALL be unchanged. For the CLI path the engine targets the user's current tmux server through the restored-`$TMUX` env mechanism (no `-L` prefix), preserving today's targeting.

- **GIVEN** the thinned CLI after extraction
- **WHEN** `rk riff` is invoked in any of its existing forms (default, `--skill`, `--cmd`, interleaved panes, `--layout`, `--count`, positional/`--preset`, `--list-presets`, `-- <wt-flags>`)
- **THEN** observable behavior (windows created, panes, layout, exit codes, rollback, list output) is identical to pre-extraction
- **AND** the pure-helper unit coverage currently in `riff_test.go` stays green (tests move alongside the helpers where the helpers move packages)

### Backend: Spawn Endpoint (`POST /api/riff`)

#### R4: POST /api/riff spawn handler
A new handler `app/backend/api/riff.go` SHALL register `POST /api/riff?server=<name>` in `router.go` (Constitution IX — POST-only mutation) accepting JSON body `{task?: string, preset?: string, session: string}`. The `server` (via `serverFromRequest`) and `session` (via `validate.ValidateName`) SHALL be validated before any subprocess use. The engine SHALL be injected onto the `Server` struct as a dedicated `RiffEngine` interface (a separate dependency alongside `metrics`/`prStatus`, NOT added to `TmuxOps`), so the shared `mockTmuxOps` is untouched and the handler gets its own mock.

- **GIVEN** a valid POST with a session on an existing server
- **WHEN** the handler runs
- **THEN** it derives the repo root, calls the engine with `{server, session, repoRoot, task, preset}`, and on success returns `200 {"server", "session", "window", "windowId"}`
- **AND** an invalid/empty session name or an invalid server returns `400` before any engine call

#### R5: Repo-root derivation from the target session's active pane
The handler SHALL derive the repo root from the target session's active-pane cwd: `ListWindows(session, server)` → the active window (`IsActiveWindow`, else first window) → that window's active pane (`PaneInfo.IsActive`, else first pane) → `Cwd` → `config.FindGitRoot`. When the derived cwd is empty or not inside a git repo, the handler SHALL return `400` with a clear human-readable message and create nothing.

- **GIVEN** a target session whose active pane cwd is inside a git repo
- **WHEN** the handler derives the repo root
- **THEN** `FindGitRoot` returns the repo root and the engine is called with it
- **GIVEN** a target session whose active pane cwd is NOT inside a git repo
- **WHEN** the handler derives the repo root
- **THEN** it returns `400` (message names the non-repo cwd) and issues no `wt`/`tmux`/`fab` calls

#### R6: Task injection via the skill-pane seam
When `task` is non-empty, the engine SHALL spawn a single skill pane passing the task text as the launcher positional argument through the existing skill-pane seam (`buildSkillShellString` + `escapeSingleQuotes`) — it auto-submits on boot, same trust model as `--skill`. An empty `task` SHALL spawn a blank agent session (bare launcher, the existing `defaultRiffSkill` default is bypassed by the endpoint: the endpoint's default with no task/preset is a single bare skill pane, not `/fab-discuss`).

- **GIVEN** a non-empty task `"fix the bug"`
- **WHEN** the handler spawns
- **THEN** the pane's shell string is `<launcher> 'fix the bug'` wrapped by the interactive `sh -i -c` + `shellWrap` layers, with any single quotes in the task escaped via `escapeSingleQuotes`
- **GIVEN** an empty task and no preset
- **WHEN** the handler spawns
- **THEN** a single bare-launcher skill pane is created (blank agent session)

#### R7: Preset resolution and task+preset composition
A non-empty `preset` SHALL name a `riff.presets` entry from the derived repo's `fab/project/config.yaml`; its panes/layout/`wt_args` are honored. An unknown preset SHALL return `400`. When BOTH `task` and `preset` are provided, the task pane SHALL replace the preset's panes entirely while the preset still contributes layout + `wt_args` — mirroring the CLI's `resolveEffectiveSpec` rule 1 (CLI panes replace preset panes). Fan-out count SHALL be fixed at 1 from this endpoint.

- **GIVEN** `preset: "ship"` defined with panes+layout+wt_args and no task
- **WHEN** the handler spawns
- **THEN** the preset's panes, layout, and wt_args are used, count = 1
- **GIVEN** both `task: "..."` and `preset: "ship"`
- **WHEN** the handler spawns
- **THEN** a single task pane replaces the preset panes, but the preset's layout + wt_args still apply
- **GIVEN** `preset: "nope"` not defined in the repo config
- **WHEN** the handler runs
- **THEN** it returns `400` and creates nothing

#### R8: Synchronous handler with documented timeout exception
The handler SHALL be synchronous. `wt create` keeps its 30s build-class timeout and each individual tmux call keeps its ≤10s timeout; the aggregate MAY exceed the 5s tmux-blocking review rule, and this exception SHALL be documented in a comment at the handler. All new exec paths SHALL be argv-slice `exec.CommandContext` with timeouts (Constitution I); task text reaches tmux only through the escaped `buildSkillShellString` seam (`fab/project/config.yaml` remains the trust boundary per rk-riff.md).

- **GIVEN** the handler
- **WHEN** it runs the full worktree → window → agent pipeline
- **THEN** each subprocess uses `exec.CommandContext` with an explicit timeout and no shell-string construction
- **AND** a comment at the handler documents the aggregate-latency exception to the 5s review rule

### Backend: Preset List Endpoint (`GET /api/riff/presets`)

#### R9: GET /api/riff/presets
A new handler SHALL register `GET /api/riff/presets?server=<name>&session=<name>` returning `{presets: [{name, layout, paneCount}]}` in YAML source order (via `ReadPresetsOrdered`), deriving the repo root exactly as the POST does. A non-repo cwd SHALL return `400`; no presets defined SHALL return `200 {"presets": []}`. The session name SHALL be validated via `validate.ValidateName` before use.

- **GIVEN** a session whose repo defines two presets
- **WHEN** the client GETs `/api/riff/presets`
- **THEN** it returns `200` with the two presets in source order, each `{name, layout, paneCount}` (layout empty-string when unset; paneCount = number of preset panes)
- **GIVEN** a session whose repo defines no presets
- **WHEN** the client GETs
- **THEN** it returns `200 {"presets": []}`
- **GIVEN** a session whose active-pane cwd is not a git repo
- **WHEN** the client GETs
- **THEN** it returns `400`

### Frontend: API Client

#### R10: spawnRiff + getRiffPresets client functions
`app/frontend/src/api/client.ts` SHALL export `spawnRiff(server, session, task?, preset?)` (POST `/api/riff` via `withServer`, returns `{server, session, window, windowId}`) and `getRiffPresets(server, session)` (GET `/api/riff/presets` via `withServer`, returns `RiffPreset[]` where `RiffPreset = {name, layout, paneCount}`). Both SHALL throw via `throwOnError` on a non-ok response.

- **GIVEN** the client functions
- **WHEN** `spawnRiff` is called
- **THEN** it POSTs `{task?, preset?, session}` to `/api/riff?server=<active>` and resolves the parsed `{server, session, window, windowId}`
- **AND** `getRiffPresets` GETs `/api/riff/presets?server=<active>&session=<session>` and resolves the presets array

### Frontend: Spawn-Agent Dialog

#### R11: Spawn-agent dialog component
A new component `app/frontend/src/components/spawn-agent-dialog.tsx` SHALL follow the existing dialog patterns (`Dialog` shell, create-session-dialog styling). It SHALL have: field 1 TASK (free text, optional, autofocused), field 2 PRESET (dropdown, optional, populated from `getRiffPresets` on open). Enter from any field SHALL submit. On submit it SHALL show an indeterminate busy state naming the pipeline steps (worktree → window → agent) and disable double-submit. On success it SHALL close and navigate to `/$server/$window` using the returned `windowId`. A 400/500 SHALL render its message in-dialog and keep the dialog open for correction.

- **GIVEN** the dialog opens
- **WHEN** it mounts
- **THEN** it fetches presets (best-effort — a fetch failure hides/empties the dropdown without blocking task-only spawn) and focuses the task field
- **GIVEN** a task typed and Enter pressed
- **WHEN** the spawn is in flight
- **THEN** the dialog shows a busy pipeline label and the submit control is disabled
- **GIVEN** a successful spawn returning `{server, window, windowId}`
- **WHEN** it resolves
- **THEN** the dialog closes and navigates to that window
- **GIVEN** a 400 error (e.g. non-repo cwd)
- **WHEN** it resolves
- **THEN** the error message renders in-dialog and nothing is navigated

### Frontend: Entry Points (Terminal Route)

#### R12: Cmd+K `Agent: Spawn` palette action
A command-palette action `Agent: Spawn` SHALL be registered in `app.tsx` on the terminal route (where a session context exists), opening the spawn-agent dialog for the current window's session. The action SHALL be present only when a session is resolvable (mirroring the `Window: Create` gating on `sessionName`).

- **GIVEN** the terminal route with a resolved session
- **WHEN** the user opens Cmd+K and selects `Agent: Spawn`
- **THEN** the spawn-agent dialog opens targeting that session

#### R13: `+ New Agent` window-switcher dropdown item
The top-bar window-switcher dropdown (`top-bar.tsx`, terminal mode) SHALL gain a `+ New Agent` item next to `+ New Window`. `BreadcrumbDropdown` SHALL be extended to accept a second/secondary action so both `+ New Window` and `+ New Agent` render (the existing single-`action` prop is preserved for all other call sites). Selecting `+ New Agent` SHALL open the same spawn-agent dialog for the current session.

- **GIVEN** the terminal route window-switcher dropdown
- **WHEN** the user opens it
- **THEN** both `+ New Window` and `+ New Agent` items render above the window list
- **AND** selecting `+ New Agent` opens the spawn-agent dialog for the current session
- **GIVEN** any other `BreadcrumbDropdown` call site (session switcher, board switcher)
- **WHEN** it renders
- **THEN** its single-action behavior is unchanged

### Non-Goals

- Tier picker — riff resolves the default tier via `fab agent --print`; per-tier spawn needs a fab CLI seam first.
- Fan-out count > 1 in the UI — the engine supports it; the endpoint fixes count at 1.
- Unsubmitted-paste (human-review) task injection — needs a boot-ready signal that does not exist in the `@rk_agent_state` registry.
- Spawn-into-existing-checkout — that is `+ New Window` today; riff's identity is worktree isolation.
- No new SSE work — the new sidebar row + navigation ride the existing SSE stream.
- Cockpit/board entry points — the entry points are terminal-route only (a session context is required).

### Design Decisions

1. **Engine injected as a dedicated `RiffEngine` interface, not folded into `TmuxOps`**: *Why*: `TmuxOps`/`mockTmuxOps` are shared by every API handler test; adding a spawn method there would force a mock method into dozens of unrelated tests. A separate `Server.riff RiffEngine` field (nil-safe, mirroring `metrics`/`services`/`prStatus`) keeps the blast radius to the riff handler + its own mock. *Rejected*: extending `TmuxOps` (large diff, unrelated-test churn).
2. **Repo root derived from the target session's active-pane cwd**: *Why*: the intake pins this ("active-pane cwd → FindGitRoot"); it uses the existing `ListWindows` surface (active window → active pane) and needs no new tmux primitive. *Rejected*: window-ID-based `ProjectRoot` (the endpoint is session-scoped, not window-scoped).
3. **CLI targets the current server via restored `$TMUX` env; the endpoint targets via `-L <server>`**: *Why*: the engine takes a server label; empty label = "use restored `$TMUX`" (the CLI's existing mechanism, preserving byte-identical behavior), non-empty label = `-L <server>` prefix (the daemon path). *Rejected*: forcing the CLI to pass an explicit socket (would change its behavior and need the CLI to resolve its own socket name).
4. **`BreadcrumbDropdown` gains an optional secondary action rather than a generic actions array**: *Why*: only one call site needs two actions; a minimal `secondaryAction?` prop preserves the existing `action?` contract and keyboard-index math with the smallest change. *Rejected*: reworking to an `actions: []` array (churns every call site + the focus-index logic).

## Tasks

### Phase 1: Engine Extraction (Backend)

- [x] T001 Create `app/backend/internal/riff/riff.go` — new package `riff`; move the spawn engine from `cmd/rk/riff.go`: `PaneSpec`/`effectiveSpec` types, `resolveEffectiveSpec`, `resolveActivePreset`, `presetPaneToSpec`, `resolveLayout`/`autoLayout` (or a `layout.go` sibling), `resolveLauncher(ctx, repoRoot)`/`parseFabAgentOutput`, `runWtCreate`, `parseWorktreePath`, `spawnRiff`/`spawnRiffReturningName`, `listWindowNames`, `resolveWindowName`, `buildSpawnArgvs`, `buildNewWindowCaptureArgs`, `parsePaneID`, `buildSkillShellString`, `buildCmdShellString`, `paneShellString`, `shellWrap`, `escapeSingleQuotes`, `runTmuxArgv`/`runTmuxNewWindowCapturePaneID`, fan-out (`runCount`, `fanOutResult`, `rollbackPlan`, `planFanOutRollback`, `rollbackFanOut`, `runWtDelete`, `buildWtDeleteArgs`), and the `wtTimeout`/`tmuxTimeout`/`fabTimeout`/`defaultLauncher`/`defaultRiffSkill` constants. Parameterize tmux/wt/fab targeting by explicit `{server, session, repoRoot}` inputs (a `Target`/`Options` struct + a top-level `Spawn`/`Run` entry) instead of `tmux.OriginalTMUX`/process-cwd. Keep exit-code error types usable by the CLI (either move `exitCodeError` to the package as an exported sentinel or keep a package-local error the CLI maps). <!-- R1 -->
- [x] T002 In `internal/riff`, implement the server-targeting env/prefix seam: an empty server label restores `$TMUX` (CLI path, via a passed original-`$TMUX` value or `tmux.OriginalTMUX`) with no `-L`; a non-empty label prefixes tmux argv with `-L <server>` (daemon path). Launcher resolution + `wt create` set the subprocess `Dir` to the passed repo root; preset reads use `fabconfig.Read*Ordered(repoRoot)`. <!-- R2 --> <!-- rework: review must-fix — the daemon path never targets the requested session: thread Session into the spawn path and emit `-t <session>` on new-window (and session-scoped targets on split-window/select-layout/list-windows) when Session is non-empty; empty Session = CLI path stays byte-identical (no -t). Also correct the childEnv comment claiming the -L prefix does the targeting (-L selects only the socket), and update TestBuildNewWindowCaptureArgs/TestBuildSpawnArgvs which currently lock in the missing -t -->
- [x] T003 Move the pure-helper unit tests from `cmd/rk/riff_test.go` into `app/backend/internal/riff/riff_test.go` for every helper that moved packages (`TestParseWorktreePath`, `TestEscapeSingleQuotes`, `TestShellWrap`, `TestResolveWindowName`, `TestParseFabAgentOutput`, `TestResolveLauncher_StubFab` + `stubFab`/`chdir`, `TestResolveLayout`, `TestAutoLayout`, `TestResolveActivePreset`, `TestResolveEffectiveSpec`, `TestBuildSpawnArgvs`, `TestBuildNewWindowArgs` or its `buildSkillShellString` equivalent, `TestParsePaneID`, `TestBuildNewWindowCaptureArgs`, `TestPlanFanOutRollback`, `TestBuildWtDeleteArgs`, `TestPrintPresets` if `printPresets` moves). Keep pane-flag/argv-grammar tests (`TestRewritePaneSpaceForm`, `TestPaneFlagParsing`, `TestRiffCountShortForm`, `TestRiffFanOutFlagRejected`, `TestPrintPresets` if `printPresets` stays CLI-side) in `cmd/rk` alongside the code that stays there. Coverage MUST NOT be reduced. <!-- R1 R3 -->

### Phase 2: CLI Thinning (Backend)

- [x] T004 Thin `app/backend/cmd/rk/riff.go` to flag parsing + preconditions (`$TMUX` via `tmux.OriginalTMUX`, `wt` on PATH) + param derivation (process cwd → `config.FindGitRoot`) + a call into `internal/riff` with an empty server label (current-server via restored `$TMUX`) and count/panes/layout/passthrough from the parsed flags. Keep `pane_spec.go` (pane-flag grammar), the cobra command definition, `--list-presets` printing, exit-code mapping, and signal wrapping CLI-side. Update imports in `root.go`/`context.go` if symbol locations changed. <!-- R3 -->

### Phase 3: API Endpoints (Backend)

- [x] T005 Add a `RiffEngine` interface + a `riff RiffEngine` field to `app/backend/api/router.go`'s `Server` struct (nil-safe like `metrics`/`prStatus`), a `prodRiffEngine` wrapper delegating to `internal/riff`, wire it in `NewRouterAndServer`, and register `POST /api/riff` (`s.handleRiffSpawn`) + `GET /api/riff/presets` (`s.handleRiffPresets`) in `buildRouter`. `NewTestRouter` gains a way to inject a mock engine (extend the constructor or add a setter used by the riff test). <!-- R4 R9 -->
- [x] T006 Implement `app/backend/api/riff.go` `handleRiffSpawn`: validate `server` (`serverFromRequest`) + decode `{task, preset, session}`, `validate.ValidateName(session)` → 400; derive repo root via a helper `deriveRepoRoot(ctx, ops, server, session)` (ListWindows → active window → active pane cwd → `config.FindGitRoot`), 400 with a clear message on empty/non-repo cwd (no engine call); call the injected engine with `{server, session, repoRoot, task, preset}` (count fixed at 1); map an unknown-preset engine error to 400; on success return `200 {server, session, window, windowId}`. Add the documented 5s-rule-exception comment at the handler. Use a dedicated timeout context (not `r.Context()`) for the ListWindows derivation, matching `handleWindowSelect`. <!-- R4 R5 R6 R7 R8 --> <!-- rework: review should-fix — both handlers' non-repo 400 messages must name the offending cwd (R5 scenario: "message names the non-repo cwd"); also map the nonexistent-session ListWindows error to a 400 with a clear message instead of a raw 500 -->
- [x] T007 Implement `handleRiffPresets` in `app/backend/api/riff.go`: validate `server` + `session` (`validate.ValidateName`), derive the repo root with the same `deriveRepoRoot` helper (400 on non-repo cwd), read `fabconfig.ReadPresetsOrdered(repoRoot)`, and return `200 {presets: [{name, layout, paneCount}]}` in source order (empty list when none). <!-- R9 -->
- [x] T008 The engine `Spawn` entry MUST honor R6/R7 composition: task-only → single skill pane with the task as the launcher positional arg (empty task → bare skill pane); preset-only → preset panes/layout/wt_args; task+preset → task pane replaces preset panes, preset layout+wt_args retained; unknown preset → a typed error the handler maps to 400. Ensure this is reachable through the extracted `resolveEffectiveSpec`/`resolveActivePreset` with a preset map read from the repo root. <!-- R6 R7 --> <!-- rework: review should-fix — extract the endpoint pane-composition switch (riff.go:169-179) into a pure helper (e.g. composePanes(task, preset)) with a table test so the blank-agent-vs-/fab-discuss-default distinction has direct coverage -->

### Phase 4: Go Tests (Backend)

- [x] T009 Add `app/backend/api/riff_test.go` httptest coverage with a dedicated mock `RiffEngine` (recording its `{server, session, repoRoot, task, preset}` inputs) and a mock/stub `ListWindows` returning an active pane cwd: success shape (`200 {server, session, window, windowId}`); invalid/empty session → 400; non-repo active-pane cwd → 400 with no engine call; task escaping reaches the engine input verbatim (the escape itself is unit-tested in `internal/riff`); unknown-preset engine error → 400; presets endpoint success (source order + `{name, layout, paneCount}`), empty-list, and non-repo 400. Do NOT modify the shared `mockTmuxOps`. <!-- R4 R5 R6 R7 R9 -->

### Phase 5: Frontend Client + Dialog + Entry Points

- [x] T010 [P] Add `spawnRiff(server, session, task?, preset?)` and `getRiffPresets(server, session)` (+ the exported `RiffPreset` type) to `app/frontend/src/api/client.ts`, following the `withServer` + `throwOnError` conventions. <!-- R10 -->
- [x] T011 [P] Extend `app/frontend/src/components/breadcrumb-dropdown.tsx` with an optional `secondaryAction?: { label; onAction }` rendered as a second menu button below `action`, updating the focus-index offset math (`offset` becomes the count of present actions) without changing behavior for call sites that pass only `action`. <!-- R13 -->
- [x] T012 Create `app/frontend/src/components/spawn-agent-dialog.tsx` per R11 — TASK + PRESET fields, presets fetched on open (best-effort), Enter-submits-from-any-field, indeterminate worktree→window→agent busy state, double-submit guard, in-dialog error render, and success navigation to `/$server/$window` via the returned `windowId` (use the navigate/`onNavigate` seam consistent with `app.tsx`). Lazy-import it in `app.tsx` like `CreateSessionDialog`. <!-- R11 --> <!-- rework: review nice-to-have (accepted) — guard falsy windowId before navigating: the backend windowId is best-effort ("" on display-message failure) and an empty id would navigate to a junk /$server/@ URL; close without navigating and let SSE surface the row -->
- [x] T013 Wire the entry points in `app/frontend/src/app.tsx` + `src/components/top-bar.tsx`: add spawn-dialog open state + a `handleOpenSpawnAgent(session)` callback; register the `Agent: Spawn` palette action (gated on `sessionName`, in a new `agentSpawnActions` group folded into `paletteActions` — document the shortcut/registration per code-review.md); thread an `onSpawnAgent` callback through the top-bar slot context and pass a `secondaryAction={{ label: "+ New Agent", onAction: () => onSpawnAgent(sessionName) }}` on the window-switcher `BreadcrumbDropdown`; render `<SpawnAgentDialog>` (Suspense-wrapped) when open. <!-- R12 R13 -->

### Phase 6: Frontend Tests

- [x] T014 [P] Add colocated Vitest unit tests: `app/frontend/src/components/spawn-agent-dialog.test.tsx` (renders TASK+PRESET, fetches presets on open, Enter submits, busy state disables submit, error renders in-dialog, success navigates) and extend/keep `breadcrumb-dropdown` behavior covered (secondary action renders + fires; single-action call sites unchanged). <!-- R11 R13 -->
- [x] T015 Add a Playwright e2e spec `app/frontend/tests/e2e/spawn-agent.spec.ts` + sibling `spawn-agent.spec.md` companion (Constitution Test Companion Docs): mock `POST /api/riff*` and `GET /api/riff/presets*` WITH TRAILING `*` (withServer appends `?server=`); assert the dialog opens from BOTH entry points (Cmd+K `Agent: Spawn` and the window-switcher `+ New Agent`), submitting a task navigates to the returned window, and a 400 renders the error in-dialog. Run via `just test-e2e "spawn-agent"` only. <!-- R11 R12 R13 -->

## Execution Order

- T001 → T002 (env/prefix seam builds on the moved code) → T003 (tests follow the moved code).
- T004 (CLI thinning) depends on T001–T002 (the engine must exist to call).
- T005 (engine interface + wiring + routes) depends on T001–T002; T006/T007/T008 depend on T005.
- T009 (Go handler tests) depends on T005–T008.
- T010/T011 are independent [P] and can precede T012.
- T012 depends on T010 (client fns) + T011 (secondary action) is only needed by T013.
- T013 depends on T012 (dialog) + T011 (dropdown secondary action) + T010 (client).
- T014 depends on T012; T015 depends on T013 (both entry points wired).

## Acceptance

### Functional Completeness

- [x] A-001 R1: `app/backend/internal/riff/` exists and owns the spawn engine, parameterized by explicit `{server, session, repoRoot}`; the enumerated helpers/types/constants live there. *(Re-verified after rework: `Session` now threads through `EffectiveSpec` — `buildNewWindowCaptureArgs`/`buildSpawnArgvs` emit `-t <session>` on `new-window` and `<session>:<name>` targets on `split-window`/`select-layout`, and `listWindowNames` scopes its collision probe with `-t <session>`; empty Session (CLI path) emits no `-t`, byte-identical to pre-extraction argvs. Locked by TestBuildNewWindowCaptureArgs/TestBuildSpawnArgvs daemon+CLI subtests.)*
- [x] A-002 R2: The extracted `resolveLauncher` runs `fab agent --print` with `Dir` = repo root and preset reads use the repo root; the `defaultLauncher` fallback is intact.
- [x] A-003 R3: `cmd/rk/riff.go` is thinned to flags/preconditions/derivation + an engine call; `rk riff` behavior (all forms) is unchanged.
- [x] A-004 R4: `POST /api/riff` is registered POST-only and returns `{server, session, window, windowId}` on success; the engine is injected via a `RiffEngine` interface distinct from `TmuxOps`.
- [x] A-005 R5: The handler derives the repo root from the target session's active-pane cwd via `FindGitRoot`.
- [x] A-006 R9: `GET /api/riff/presets` returns `{presets:[{name, layout, paneCount}]}` in YAML source order.
- [x] A-007 R10: `spawnRiff` + `getRiffPresets` (+ `RiffPreset` type) exist in `client.ts` and hit the two endpoints with `withServer`.
- [x] A-008 R11: The spawn-agent dialog renders TASK + PRESET, fetches presets on open, submits on Enter, shows a busy state, and navigates on success.
- [x] A-009 R12: The `Agent: Spawn` Cmd+K action opens the dialog on the terminal route for the current session.
- [x] A-010 R13: The window-switcher dropdown shows `+ New Agent` beside `+ New Window`; other `BreadcrumbDropdown` call sites are unchanged.

### Behavioral Correctness

- [x] A-011 R6: A non-empty task becomes the launcher positional arg through the escaped `buildSkillShellString` seam; an empty task spawns a bare-launcher pane.
- [x] A-012 R7: task+preset → task pane replaces preset panes while preset layout+wt_args still apply; preset-only honors preset panes/layout/wt_args; count is fixed at 1.
- [x] A-013 R3: The pure-helper unit coverage that moved to `internal/riff` is green and coverage is not reduced.

### Scenario Coverage

- [x] A-014 R4 R5: A Go httptest confirms the success response shape and that repo-root derivation feeds the engine.
- [x] A-015 R11 R12 R13: A Playwright spec (with `.spec.md`) opens the dialog from BOTH entry points, navigates on task-submit, and renders the error path in-dialog, with `**/api/riff*` + `**/api/riff/presets*` trailing-`*` mocks.

### Edge Cases & Error Handling

- [x] A-016 R5: A non-repo active-pane cwd returns `400` with a clear message and creates nothing (no engine/`wt`/`tmux` call).
- [x] A-017 R7: An unknown preset returns `400` and creates nothing.
- [x] A-018 R11: A 400/500 from the endpoint renders in-dialog and the dialog stays open; double-submit is prevented while in flight.
- [x] A-019 R8: The handler is synchronous with the documented 5s-review-rule exception comment; `wt create` keeps 30s and each tmux call ≤10s.

### Code Quality

- [x] A-020 Pattern consistency: New Go code follows the `internal/*` package + `prod*` wrapper + handler conventions; new frontend code follows the `Dialog`/`useOptimisticAction`/`withServer` conventions.
- [x] A-021 No unnecessary duplication: The engine is reused by both the CLI and the handler (no reimplemented spawn recipe); existing helpers (`FindGitRoot`, `validate.*`, `escapeSingleQuotes`) are reused.
- [x] A-022 Constitution I (Security): All new exec paths are argv-slice `exec.CommandContext` with timeouts; `server`/`session` are validated via `internal/validate` before any subprocess; task text reaches tmux only through the escaped shell-string seam.
- [x] A-023 Constitution III/IV/V/IX: The engine is wrapped not reinvented (III); the UI is a dialog, not a new route (IV); the Cmd+K palette parity is present with its registration documented (V); the mutation is POST-only and the CORS allowlist stays `[GET, POST, OPTIONS]` (IX).
- [x] A-024 Test companion: The new `spawn-agent.spec.ts` ships a sibling `spawn-agent.spec.md` documenting each test.

### Security

- [x] A-025 R8: Task text is single-quote-escaped before reaching tmux's shell (no injection beyond the documented `fab/project/config.yaml` launcher trust boundary); no shell-string subprocess construction is introduced.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. The extracted engine's `cmd/rk` originals (the spawn/fan-out/shell helpers, `layout.go`, and the `buildNewWindowArgs` back-compat test seam) were already deleted in this same change; `cmd/rk/exit_code.go`'s `exitCodeError` remains live via `rk shell-init`, and `cmd/rk/layout_help.go` is self-contained (hardcoded mock strings, no dependency on the moved alias table).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | New package `internal/riff` parameterized by explicit `{server, session, repoRoot}` | Intake assumption #1 (Certain); backlog names it and prescribes the parameterization | S:85 R:90 A:90 D:90 |
| 2 | Confident | Engine injected as a dedicated `RiffEngine` interface on `Server`, NOT added to `TmuxOps` | `TmuxOps`/`mockTmuxOps` are shared by all handler tests; a separate nil-safe field mirrors `metrics`/`prStatus` and minimizes blast radius; codebase precedent | S:70 R:80 A:85 D:70 |
| 3 | Confident | POST response shape `{server, session, window, windowId}` | Intake assumption #2 (Confident); backlog pins content not field names; trivially adjustable | S:65 R:85 A:80 D:70 |
| 4 | Confident | Presets GET returns `{presets:[{name, layout, paneCount}]}` in YAML source order | Intake assumption #3 (Confident); `ReadPresetsOrdered` preserves order; layout/paneCount is a cheap dropdown summary | S:55 R:90 A:75 D:65 |
| 5 | Confident | Repo root derived from the target session's active window → active pane cwd → `FindGitRoot` | Intake pins "active-pane cwd → FindGitRoot"; uses existing `ListWindows` (`IsActiveWindow`/`PaneInfo.IsActive`) with no new tmux primitive | S:70 R:85 A:80 D:70 |
| 6 | Confident | Task+preset: task pane replaces preset panes; preset keeps layout + wt_args | Intake assumption #4 (Confident); mirrors CLI `resolveEffectiveSpec` rule 1 | S:50 R:80 A:75 D:55 |
| 7 | Confident | Dialog busy state is indeterminate (static worktree→window→agent label) | Intake assumption #5 (Confident); synchronous endpoint emits no per-step events; pure UI, trivially changeable | S:60 R:90 A:70 D:60 |
| 8 | Confident | Entry points on the terminal route only (window-switcher dropdown + palette) | Intake assumption #6 (Confident); "target = the session invoked from" requires a session context; the window-switcher host defines the locus | S:55 R:85 A:70 D:60 |
| 9 | Confident | Extracted launcher runs `fab agent --print` with subprocess `Dir` = repo root | Intake assumption #7 (Confident); daemon cwd ≠ target repo, so explicit rooting is the only correct generalization | S:60 R:85 A:85 D:80 |
| 10 | Confident | CLI targets current server via restored `$TMUX` (empty server label); daemon via `-L <server>` | Preserves byte-identical CLI behavior while the same engine serves the daemon; empty-label sentinel is the least-invasive seam | S:55 R:80 A:80 D:65 |
| 11 | Confident | `BreadcrumbDropdown` gains an optional `secondaryAction` (not an actions array) | Only one call site needs two actions; a second optional prop preserves the existing `action` contract + focus-index math with the smallest change | S:60 R:85 A:80 D:70 |
| 12 | Confident | Endpoint default with no task/no preset = a single bare-launcher skill pane (not the CLI's `/fab-discuss` default) | The web flow's "empty task = blank agent session" (intake ACCEPTANCE) means a bare launcher, not the CLI change-2 `/fab-discuss` fallback; the endpoint sets its own pane default | S:55 R:80 A:75 D:60 |

12 assumptions (1 certain, 11 confident, 0 tentative).

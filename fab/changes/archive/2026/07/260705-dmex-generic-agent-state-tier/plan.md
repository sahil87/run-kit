# Plan: Generic Agent-State Tier

**Change**: 260705-dmex-generic-agent-state-tier
**Intake**: `intake.md`

## Requirements

### Convention Spec: `docs/specs/agent-state.md`

#### R1: Cross-repo `@rk_agent_state` convention document
The repo SHALL carry a new spec `docs/specs/agent-state.md` documenting the `@rk_agent_state` pane-user-option convention as the cross-repo contract (fab-kit readers reference it): option name/scope, value schema `"<state>:<epoch_seconds>"` with `state ∈ active|waiting|idle`, state semantics, writer rules, reader rules (incl. the shell-command reconciler), lifecycle, and the per-agent hook event-mapping registry. The specs index (`docs/specs/index.md`) SHALL gain a row linking it.

- **GIVEN** a fab-kit maintainer implementing the reader side (backlog `[ioku]`)
- **WHEN** they open `docs/specs/agent-state.md`
- **THEN** they find the option name, value schema, all three states, writer/reader rules, reconciler rule, and the Claude event→state mapping table
- **AND** `docs/specs/index.md` lists the spec under Project Specs

### tmux Native Read: `internal/tmux`

#### R2: `@rk_agent_state` in paneFormat and PaneInfo
`internal/tmux` SHALL read `#{@rk_agent_state}` as an additional `list-panes` field (zero extra subprocess) and parse it into two new `PaneInfo` fields: `AgentState string` (`json:"agentState,omitempty"`, one of `active|waiting|idle`, empty = unknown) and `AgentStateEpoch int64` (`json:"agentStateEpoch,omitempty"`, 0 = unknown). The option value is `"<state>:<epoch>"`; a malformed/empty value yields both zero.

- **GIVEN** a pane with `@rk_agent_state` set to `waiting:1751790000`
- **WHEN** `parsePanes` runs on the `list-panes` output
- **THEN** the pane's `AgentState` is `"waiting"` and `AgentStateEpoch` is `1751790000`
- **AND** a pane with the option unset yields `AgentState == ""` and `AgentStateEpoch == 0`
- **AND** a pane whose value has no colon or a non-integer epoch yields both zero (state also dropped)

#### R3: Shell-command reconciler
`internal/tmux` SHALL treat a pane whose `#{pane_current_command}` is a plain shell (`bash|zsh|fish|sh|dash`) as having no agent regardless of a leftover `@rk_agent_state` value — both `AgentState` and `AgentStateEpoch` are zeroed at parse time. This prevents a stranded `active` after an Esc-interrupt/kill.

- **GIVEN** a pane reporting command `zsh` but a leftover `@rk_agent_state` of `active:1751790000`
- **WHEN** `parsePanes` parses that line
- **THEN** the pane's `AgentState` is `""` and `AgentStateEpoch` is `0`
- **AND** a pane reporting command `claude` with `active:1751790000` keeps `AgentState == "active"`

### sessions rollup + join slimming: `internal/sessions`

#### R4: Window-level agent-state rollup with `waiting > active > idle`
`internal/sessions` SHALL derive `WindowInfo.AgentState` as a rollup over the window's panes (post-reconciler) with precedence `waiting > active > idle` (a split window with one waiting pane is a waiting window; a pane with no agent contributes nothing). `WindowInfo.AgentIdleDuration` SHALL be computed rk-side from the rolled-up pane's `AgentStateEpoch` for `idle` AND `waiting` states, formatted in the same `Ns`/`Nm`/`Nh` style fab produced (floor division). `active` and unknown produce an empty duration.

- **GIVEN** a window with two panes, one `active:…`, one `waiting:…`
- **WHEN** the rollup runs
- **THEN** `WindowInfo.AgentState == "waiting"`
- **AND** its `AgentIdleDuration` is the floor-formatted elapsed since that pane's epoch
- **GIVEN** a window whose only agent pane is `idle` with an epoch 130s ago
- **THEN** `AgentState == "idle"` and `AgentIdleDuration == "2m"`
- **GIVEN** a window whose only agent pane is `active`
- **THEN** `AgentState == "active"` and `AgentIdleDuration == ""`

#### R5: Pane-map join slimming
`paneMapEntry` SHALL drop the `agent_state`, `agent_idle_duration`, `pr_url`, and `pr_number` fields; the pane-map join SHALL consume only `change`, `stage`, `display_state` (the fab tier proper). `dedupEntries` priority SHALL simplify to `Change > first-seen` (the AgentState arm removed). `WindowInfo.AgentState`/`AgentIdleDuration`/`PrURL`/`PrNumber` SHALL no longer be assigned from the pane-map join. No dual-source fallback.

- **GIVEN** two panes in one window, neither change-bound
- **WHEN** `dedupEntries` collapses them
- **THEN** the first-seen entry is kept (no AgentState tiebreak)
- **GIVEN** `fab pane map` output that still contains `agent_state`/`pr_url` keys
- **WHEN** `paneMapEntry` unmarshals it
- **THEN** those keys are ignored and the join sets only change/stage/display_state fields

### PR-from-branch derivation: `internal/prstatus` + join

#### R6: Branch→PR derivation per pane repo context
`internal/prstatus` SHALL provide a branch→PR resolver: given a repo directory and a branch, run `gh pr list --head <branch> --state open --json number,url,state,isDraft,updatedAt` in that repo (`exec.CommandContext`, explicit argv, timeout, `cmd.Dir` = repo dir), returning the open PR (most-recently-updated on multi-PR branches; none → no PR). Results SHALL be cached per `(repoDir, branch)` with a TTL and the same `gh`-absent/unauthenticated graceful degradation as the existing collector. `internal/sessions` SHALL call it for every pane with a resolved `GitBranch` and populate `WindowInfo.PrURL`/`PrNumber` from the derivation (replacing the pane-map source).

- **GIVEN** a pane on branch `feature-x` in a repo with one open PR #42
- **WHEN** the sessions enrichment resolves the branch and calls the resolver
- **THEN** the window's `PrURL`/`PrNumber` are #42's url/number
- **GIVEN** a branch with two open PRs
- **THEN** the most-recently-updated PR is chosen
- **GIVEN** `gh` is absent OR the branch has no open PR
- **THEN** the window's `PrURL`/`PrNumber` are nil (fields absent), no error surfaced
- **AND** a repeated resolution within the TTL issues no new `gh` subprocess

#### R7: Live PR-status join keys off the derived PR, ungated by change
`attachPRStatus` (the URL-keyed live state/checks/review join) SHALL populate any window that has a non-empty derived `PrURL`, dropping the `FabChange != ""` gate — so PR status appears for any pane on a branch with an open PR, not only fab-change-bound windows. The join key remains the canonical PR URL.

- **GIVEN** a non-change-bound window whose derived `PrURL` matches a PR in the collector snapshot
- **WHEN** `attachPRStatus` runs
- **THEN** that window's `PrState`/`PrChecks`/`PrReview`/`PrIsDraft` are populated
- **GIVEN** a window with no derived `PrURL`
- **THEN** the four display fields stay reset (empty)

### CLI installer: `rk agent-setup`

#### R8: `rk agent-setup` installs Claude hooks (JSON-merge, idempotent, diff+confirm)
A new `rk agent-setup` subcommand SHALL install `@rk_agent_state` hook commands into the user-global Claude config (`~/.claude/settings.json`) via a JSON merge that preserves existing hooks and non-rk config. It SHALL be idempotent (re-run updates rk-owned entries in place, never duplicates, never touches non-rk hooks), display the settings diff and ask for confirmation before writing, and support `--uninstall` to remove exactly the rk-owned entries. It SHALL be structured as a per-agent registry (agent name → config path + format + event mapping) with Claude Code as the only v1 entry. The hook command is a fixed self-contained one-liner per state (no user input interpolated; no rk/server dependency at hook-fire time). All file writes go through Go, no shell string construction (§I).

- **GIVEN** a `~/.claude/settings.json` with pre-existing unrelated hooks
- **WHEN** `rk agent-setup` runs and the user confirms
- **THEN** the file gains the five rk-owned hook entries (UserPromptSubmit, PreToolUse, Notification×2 matchers, Stop) and the pre-existing hooks are preserved
- **GIVEN** `rk agent-setup` is run a second time
- **THEN** no duplicate rk entries are created and non-rk hooks remain untouched
- **GIVEN** `rk agent-setup --uninstall`
- **THEN** exactly the rk-owned hook entries are removed and other config is preserved
- **GIVEN** the user declines at the confirmation prompt
- **THEN** the file is not modified

### Frontend type doc

#### R9: `agentState` documents the `waiting` value
`src/types.ts` SHALL document that `agentState` may be `waiting` (in addition to `active`/`idle`). No component changes are required — existing consumers keep working with the richer value.

- **GIVEN** a reader of `src/types.ts`
- **WHEN** they read the `agentState` field
- **THEN** the comment notes `active | waiting | idle`

### Non-Goals

- No new UI surfaces, StatusDot integration, push rules, or attention rollups (deferred per intake Assumption 11).
- No `@rk_agent_kind` option, no pending-question-text option (v1 scope, intake Assumption 4).
- No codex/copilot/gemini/opencode installer entries (registry structure only; additive follow-ups).
- No dual-source fallback to pane-map `agent_state` during migration (clean swap).

### Design Decisions

1. **Branch→PR derivation is a new resolver alongside the existing viewer-wide collector, not a replacement**: `internal/prstatus`'s existing `gh api graphql viewer.pullRequests` collector (URL-keyed, powers state/checks/review) stays; a new per-(repoDir,branch) resolver populates `PrURL`/`PrNumber`. — *Why*: the intake specifies `gh pr list --head <branch>` per pane repo context, which the viewer-wide query cannot express (it is not scoped to a branch/repo and does not carry cwd context); the two layers compose exactly as today (derive URL → join live status by URL). — *Rejected*: extending the single graphql query — it has no branch/repo scoping seam and would still miss non-viewer-authored PRs on a branch.
2. **Reconciler applied at `parsePanes` time in `internal/tmux`**: zero the agent fields when `pane_current_command` is a shell. — *Why*: `parsePanes` already has both the command and the option value in one line; a pure-parse reconciler keeps the rule unit-testable and colocated with the source, mirroring the existing `parseWindows`/`parsePanes` pure-function convention. — *Rejected*: reconciling in `internal/sessions` — would duplicate the shell-name set and split the rule from its data.
3. **Rollup + duration formatting in `internal/sessions`**: window-level `AgentState`/`AgentIdleDuration` are derived from `WindowInfo.Panes` (already populated by `ListWindows`). — *Why*: `AgentState`/`AgentIdleDuration` are already window-level JSON fields consumed by the frontend; the sessions package already owns the enrichment loop over panes. — *Rejected*: computing in tmux — window-level rollup is enrichment, not raw tmux parsing.
4. **Duration parity**: rk-side formatter reproduces fab's `Ns`/`Nm`/`Nh` floor-division style so the frontend string surface is byte-compatible. — *Why*: existing frontend `getWindowDuration`/status-panel render the string verbatim.

## Tasks

### Phase 1: tmux native read (foundation)

- [x] T001 Add `AgentState string` (`json:"agentState,omitempty"`) and `AgentStateEpoch int64` (`json:"agentStateEpoch,omitempty"`) fields to `PaneInfo` in `app/backend/internal/tmux/tmux.go`; append `#{@rk_agent_state}` to the `paneFormat` var (now 7 fields). <!-- R2 -->
- [x] T002 Update `parsePanes` in `app/backend/internal/tmux/tmux.go` to require ≥7 fields, parse field 6 (`@rk_agent_state`) via a pure helper `parseAgentState(raw string) (state string, epoch int64)` that splits on the last `:`, validates `state ∈ {active,waiting,idle}` and integer epoch (else both zero), and apply the shell-command reconciler (`isShellCommand(cmd string) bool` over `bash|zsh|fish|sh|dash`) zeroing both fields when the pane command is a shell. Add named constants for the state set and the shell set. <!-- R2 --> <!-- R3 -->
- [x] T003 [P] Add tmux tests in `app/backend/internal/tmux/tmux_test.go`: extend `paneLine` helper to a 7-field variant (`paneLineAgent`) carrying `@rk_agent_state`; cover parse of `active`/`waiting`/`idle`, unset (both zero), malformed value (no colon / non-integer epoch → both zero), invalid state token, and reconciler (shell command zeros a leftover `active`; `claude` keeps it). Keep existing 6-field `paneLine` tests green (update `paneFormat`/parser field-count expectations). <!-- R2 --> <!-- R3 -->

### Phase 2: sessions rollup + join slimming

- [x] T004 Add a pure rollup helper in `app/backend/internal/sessions/sessions.go`: `rollupAgentState(panes []tmux.PaneInfo, nowUnix int64) (state, duration string)` applying `waiting > active > idle` precedence and computing the `Ns`/`Nm`/`Nh` floor-formatted duration from the winning pane's `AgentStateEpoch` for `idle` and `waiting` (empty for `active`/unknown). Add a `formatAgentDuration(elapsedSeconds int64) string` helper mirroring fab's style. Call the rollup in `FetchSessions` per window, assigning `WindowInfo.AgentState`/`AgentIdleDuration`. <!-- R4 -->
- [x] T005 Slim the pane-map join in `app/backend/internal/sessions/sessions.go`: remove `AgentState`, `AgentIdleDuration`, `PrURL`, `PrNumber` from `paneMapEntry`; drop their assignments in the `enrichByWindowID` join (keep `Change`/`Stage`/`DisplayState`); simplify `dedupEntries` priority to `Change > first-seen` (remove the AgentState arm). <!-- R5 -->
- [x] T006 [P] Add/adjust sessions tests in `app/backend/internal/sessions/sessions_test.go`: unit-test `rollupAgentState` (waiting-wins over active, idle duration `2m`, active empty duration, no-agent panes → empty) and `formatAgentDuration` (`45s`/`2m`/`1h` boundaries); update/extend `dedupEntries` tests for the `Change > first-seen` priority (remove AgentState-tiebreak expectations); assert `paneMapEntry` no longer carries the dropped fields (JSON with `agent_state`/`pr_url` present is ignored). <!-- R4 --> <!-- R5 -->

### Phase 3: PR-from-branch derivation + join

- [x] T007 Add a branch→PR resolver to `app/backend/internal/prstatus/prstatus.go` (or a new `prstatus_branch.go` in the same package): `type BranchPR struct { Number int; URL string }` (trim `State`/`IsDraft` — no consumer); resolution runs `gh pr list --head <branch> --state open --json number,url,updatedAt` via `exec.CommandContext` (explicit argv, `ghTimeout`, `cmd.Dir = repoDir`), parses the JSON array, and returns the most-recently-updated (`updatedAt` desc) open PR; inject the exec + availability via package-var/func seams for tests (mirror `ghExec`/`available`). **Architecture (rework)**: NO network call may run on the FetchSessions/SSE path. Restructure as a background refresher owned by the prstatus package (mirroring `Collector.Start`'s 90s-tick discipline): sessions REPORTS the observed `(repoDir, branch)` set (a cheap, lock-guarded registration) and JOINS from an in-memory snapshot (`SnapshotBranchPRs()` or equivalent) — never resolving inline. The refresher gates on ONE TTL-cached availability check per pass (cache `ghAvailable`'s result INCLUDING the negative — an unauthenticated gh must not re-probe per branch per tick), resolves only registered pairs, and on a transient exec/network error KEEPS the last-good entry (true stale-while-revalidate — never fail-to-negative; a confirmed no-PR result is a valid negative entry). Entries for pairs no longer observed age out. <!-- R6 --> <!-- rework: review must-fix — gh subprocesses (incl. uncached `gh auth status` per miss) ran inline on the SSE hot path via enrichWindowPR, breaking api/sse.go's documented zero-network-call invariant and code-review.md's 5s cap; should-fix — transient errors were cached as 30s negative entries, dropping last-good PrURL; nice-to-have — BranchPR.State/IsDraft requested but never read -->
- [x] T008 Wire the resolver into `app/backend/internal/sessions/sessions.go`: after `resolveGitBranches`, for each pane with a resolved `GitBranch`, REGISTER the `(pane.Cwd, branch)` pair with the prstatus branch refresher and JOIN `WindowInfo.PrURL`/`PrNumber` from its in-memory snapshot (choose the window's active pane's branch, or first pane with a branch; document the choice) — zero subprocess/network work in this loop. Wire the refresher's lifecycle where the existing prstatus collector is started (`api/router.go`). Degrade to nil on no-PR/gh-absent; reconcile the api/sse.go hot-path comments ('the hot path makes NO network call' / attachPRStatus's zero-network-call guarantee) so they are true again. <!-- R6 --> <!-- rework: review must-fix — enrichWindowPR resolved inline on the hot path; replace with register + snapshot-join, background refresh -->
- [x] T009 Drop the `FabChange != ""` gate in `attachPRStatus` in `app/backend/api/sse.go` so any window with a non-empty derived `PrURL` gets the URL-keyed live-status join; keep the reset-first behavior and the URL join key. Update the function doc comment. <!-- R7 -->
- [x] T010 [P] Add prstatus tests in `app/backend/internal/prstatus/prstatus_test.go` (or `prstatus_branch_test.go`): stub the branch-list exec seam to cover single-PR resolution, multi-PR most-recently-updated selection, no-PR negative entry, gh-unavailable (no exec, negative availability CACHED — second pass issues no re-probe), malformed JSON, transient exec error KEEPS last-good entry (stale-while-revalidate), unregistered pairs age out, and snapshot join returns without any exec (hot-path purity). <!-- R6 --> <!-- rework: tests follow the T007/T008 background-refresher restructure; add negative-availability-cache + keep-last-good + snapshot-purity coverage -->

### Phase 4: `rk agent-setup` CLI

- [x] T011 Create `app/backend/cmd/rk/agent_setup.go`: the `agentSetupCmd` cobra command (`Use: "agent-setup"`, `--uninstall` flag) plus a per-agent registry (`type agentConfig struct { name, settingsPath string; hooks []agentHook }` where `agentHook` carries event name, optional matcher, and the fixed state token) with Claude Code as the sole v1 entry (path `~/.claude/settings.json`; the five entries from the intake mapping table). Register in `root.go` `init()`. The hook command literal per state: `sh -c '[ -n "$TMUX_PANE" ] || exit 0; tmux set-option -pt "$TMUX_PANE" @rk_agent_state "<state>:$(date +%s)" 2>/dev/null || true'`. The option name and the three state tokens MUST come from the `internal/tmux` package constants (exporting them there if needed) — no local re-declaration of the convention strings (A-021: defined once per binary). <!-- R8 --> <!-- rework: review should-fix — agent_setup.go re-declared rkHookMarker "@rk_agent_state" + state literals locally instead of importing tmux.AgentStateOption / tmux.AgentState*, leaving two sources of truth for the cross-repo contract -->
- [x] T012 Implement the JSON-merge install/uninstall in `agent_setup.go` (pure, testable): read `settings.json` (tolerant: missing/empty → empty object) into a generic `map[string]any`, merge rk-owned hook entries under `hooks.<Event>` arrays keyed/deduped by an rk marker so re-run replaces in place and non-rk entries are preserved; uninstall removes exactly the rk-owned entries. Compute a before/after diff, print it, and prompt for confirmation (`stdin` y/N) before `os.WriteFile` (0600, matching the config's sensitivity; create `~/.claude/` if absent via `MkdirAll`). Split merge/unmerge into pure functions (`mergeHooks`/`unmergeHooks` over `map[string]any`) so tests avoid the filesystem/prompt. All writes via Go, no shell string construction (§I). <!-- R8 -->
- [x] T013 [P] Add `app/backend/cmd/rk/agent_setup_test.go`: unit-test `mergeHooks` (adds rk entries, preserves a pre-existing unrelated hook), idempotency (second merge produces identical output, no duplicates), `unmergeHooks` (removes exactly rk entries, preserves others), tolerant read of missing/empty/corrupt settings, and the confirmation gate (decline → no write) using an injected reader/writer seam. <!-- R8 -->

### Phase 5: spec + frontend type + docs

- [x] T014 [P] Create `docs/specs/agent-state.md` documenting the convention (option name/scope, value schema, three states + semantics, writer rules, reader rules incl. reconciler, lifecycle, per-agent event-mapping registry with the Claude table) and add a row to `docs/specs/index.md` under Project Specs. <!-- R1 -->
- [x] T015 [P] Update the `agentState` field comment in `app/frontend/src/types.ts` to document the `active | waiting | idle` values (add a `waiting` note); no other frontend change. <!-- R9 -->

## Execution Order

- Phase 1 (T001→T002, then T003) precedes Phase 2 (rollup consumes `PaneInfo.AgentState`/`AgentStateEpoch`).
- T004→T005 sequential (same file); T006 after both.
- Phase 3: T007 precedes T008 (T008 calls the resolver); T009 independent of T007/T008 but same feature; T010 after T007.
- Phase 4: T011→T012 sequential (same file); T013 after T012.
- Phase 5 tasks are independent (`[P]`) and can run any time after their subject exists (spec/type docs).

## Acceptance

### Functional Completeness

- [x] A-001 R1: `docs/specs/agent-state.md` exists documenting option/schema/states/writer+reader rules/reconciler/registry, and `docs/specs/index.md` lists it.
- [x] A-002 R2: `paneFormat` includes `#{@rk_agent_state}` and `PaneInfo` carries `AgentState`/`AgentStateEpoch`, parsed by `parsePanes` (value `state:epoch`; unset/malformed → both zero).
- [x] A-003 R3: A shell `pane_current_command` zeros a leftover `@rk_agent_state`; a real agent command keeps it.
- [x] A-004 R4: `WindowInfo.AgentState` is the `waiting > active > idle` rollup and `AgentIdleDuration` is rk-formatted from the epoch for `idle` and `waiting` (empty for `active`).
- [x] A-005 R5: `paneMapEntry` no longer has `agent_state`/`agent_idle_duration`/`pr_url`/`pr_number`; the join sets only change/stage/display_state; `dedupEntries` is `Change > first-seen`.
- [x] A-006 R6: A pane on a branch with an open PR yields `WindowInfo.PrURL`/`PrNumber` via `gh pr list --head`, cached per (repoDir, branch), most-recently-updated on multi-PR, nil on no-PR/gh-absent.
- [x] A-007 R7: `attachPRStatus` populates live status for any window with a derived `PrURL` (no `FabChange` gate), keyed by URL.
- [x] A-008 R8: `rk agent-setup` JSON-merges the five Claude hook entries into `~/.claude/settings.json` (idempotent, preserves non-rk config, diff+confirm before write, `--uninstall` removes exactly rk entries, decline → no write).
- [x] A-009 R9: `src/types.ts` documents `agentState` as `active | waiting | idle`.

### Behavioral Correctness

- [x] A-010 R5: Agent columns read unknown (`—`) until `rk agent-setup` has run — no dual-source fallback to pane-map `agent_state` (clean swap verified: no reads of the removed fields remain).
- [x] A-011 R7: A change-bound window with a derived PR still shows live status (no regression from dropping the `FabChange` gate).

### Scenario Coverage

- [x] A-012 R2: Go test covers parse of each state, unset, and malformed values.
- [x] A-013 R3: Go test covers the reconciler (shell zeros; agent keeps).
- [x] A-014 R4: Go test covers rollup precedence and `idle`/`waiting` duration formatting.
- [x] A-015 R6: Go test covers branch→PR single/multi/none/gh-absent/cache-hit with a mocked `gh`.
- [x] A-016 R8: Go test covers merge/idempotency/uninstall/tolerant-read/decline for `rk agent-setup`.

### Edge Cases & Error Handling

- [x] A-017 R6: `gh` absent or unauthenticated is a silent no-op (no error surfaced; PR fields nil) — matches the existing collector's fail-silent posture.
- [x] A-018 R8: A missing or empty `~/.claude/settings.json` is treated tolerantly (empty object); a genuinely corrupt (non-empty, invalid-JSON) file surfaces a clear error WITHOUT writing (anti-clobber — silently treating it as empty would overwrite user config); a declined confirmation leaves the file untouched. <!-- clarified: acceptance wording amended at rework cycle 1 to match the safer implemented+tested behavior (T013 asserts the corrupt-file error) per review nice-to-have -->
- [x] A-019 R2: A `@rk_agent_state` with an unexpected state token or non-integer epoch degrades to unknown (both zero), never a panic.

### Code Quality

- [x] A-020 Pattern consistency: new code follows the pure-parse-helper convention (`parseAgentState`/`rollupAgentState`/`mergeHooks`), the exec-seam test pattern (`ghExec`-style injectable), and cobra subcommand shape of neighboring files.
- [x] A-021 No unnecessary duplication: the shell-name set and state set are named constants defined once; the branch→PR resolver reuses `ghAvailable`/`ghTimeout` and the TTL-cache idiom rather than reinventing them. *(Rework cycle 1 review: the previously flagged exception is RESOLVED — `cmd/rk/agent_setup.go` now aliases `rkHookMarker = tmux.AgentStateOption` and the three state tokens from `tmux.AgentState*`; one source of truth per binary verified.)*
- [x] A-022 Security (§I): every new subprocess call uses `exec.CommandContext` with an explicit argv slice and a timeout; no shell string construction with user input (the hook command literal is a fixed per-state constant, nothing user-provided interpolated); settings writes go through Go file I/O.
- [x] A-023 No database (§II): no persistent store added — agent state is derived from tmux pane options at request time; PR derivation is in-memory TTL cache only.
- [x] A-024 Hooks carry only the underivable (§X): the hook writes only ephemeral lifecycle state (`@rk_agent_state`); PR links are derived server-side via `gh`, never pushed.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- Test gates: `just test-backend` (Go) + `cd app/frontend && npx tsc --noEmit`. No e2e (no UI component change).

## Deletion Candidates

- `app/backend/internal/sessions/sessions.go` `paneMapEntry.Tab` / `paneMapEntry.Worktree` — decoded from `fab pane map` JSON but read nowhere in production code (re-verified at rework cycle 1: zero non-test readers); the join slimming makes these leftover decorative fields conspicuous.
- ~~`app/backend/internal/prstatus/prstatus_branch.go` `BranchPR.State` / `BranchPR.IsDraft`~~ — RESOLVED at rework cycle 1: the fields and their `--json` columns (`state`, `isDraft`) were trimmed; `BranchPR` now carries only `Number`/`URL`/`UpdatedAt` (all read).
- `app/backend/internal/prstatus/prstatus_branch.go` package vars `branchPRExec` / `branchPRAvailable` — declared as package-var test seams "mirroring ghExec", but every test stubs the per-instance `exec`/`available` fields instead; the vars are only read once as constructor defaults and could be plain funcs (their var-ness is unused).
- Cross-repo: fab-kit's `_agents` production pipeline (`fab hook stop|user-prompt|session-start` → `.fab-runtime.yaml` `_agents`, and the `agent_state`/`agent_idle_duration`/`pr_url`/`pr_number` keys on `fab pane map` output) is made redundant by this convention — not deletable from this repo; tracked as fab-kit backlog `[ioku]`.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | New `PaneInfo` fields `AgentState string` + `AgentStateEpoch int64` with `agentState`/`agentStateEpoch` JSON tags | Intake §3 names both fields and their zero-value semantics verbatim; JSON tags follow the existing `PaneInfo` `omitempty` convention | S:90 R:85 A:90 D:90 |
| 2 | Certain | Branch→PR is a NEW per-(repoDir,branch) resolver in `internal/prstatus`, alongside (not replacing) the viewer-wide URL-keyed collector | Intake §4 specifies `gh pr list --head <branch>` per pane repo context; the existing graphql `viewer.pullRequests` query has no branch/repo/cwd seam, so it cannot express this — the two layers compose (derive URL → join live status by URL) exactly as the intake's "keys off the derived PR exactly as it keys off fab's today" describes | S:80 R:70 A:85 D:80 |
| 3 | Certain | Reconciler + agent-state parse live in `parsePanes` (pure) in `internal/tmux`; rollup + duration formatting live in `internal/sessions` (pure helpers) | Intake §3 says reconciler "at parse/enrichment time" and rollup is "window-level"; `parsePanes` already has command+value in one line, sessions already owns the per-window pane enrichment loop — matches the existing pure-function split | S:85 R:80 A:85 D:85 |
| 4 | Confident | `attachPRStatus` drops the `FabChange` gate but keeps the `PrURL`-present gate and URL join key | Intake §4: "PR status appears for any pane on a branch with an open PR, not only fab-change-bound windows" — the change is exactly removing the change gate; URL-keying is preserved to avoid the cross-repo number-collision the existing code documents | S:75 R:75 A:80 D:80 |
| 5 | Confident | Window PR derivation uses the active pane's branch (falling back to the first pane with a branch) as the window's branch | Intake ties PR to "the pane's repo context"; a window is the UI unit carrying `PrURL`, and the active pane is the canonical representative — deterministic and matches how the window's single PR line is shown today | S:55 R:75 A:70 D:65 |
| 6 | Confident | `rk agent-setup` writes `~/.claude/settings.json` at mode 0600 and merges via a generic `map[string]any` with an rk-marker-keyed dedup for idempotency | Intake §2 specifies JSON-merge/idempotent/diff+confirm/uninstall but not the marker mechanism or file mode; 0600 matches the sensitivity of user config (mirrors `internal/push`'s 0600 for secrets); a marker-keyed replace is the standard idempotent-merge idiom and the only way "update rk entries in place, never touch non-rk hooks" is satisfiable | S:60 R:70 A:70 D:65 |
| 7 | Confident | Confirmation prompt reads a y/N answer from stdin (default No) and is bypassable via an injected reader seam in tests | Intake §2 requires "asks for confirmation before writing"; y/N-default-No is the conventional destructive-write prompt; the seam keeps the merge logic testable without a TTY (mirrors the exec-seam test pattern used across the codebase) | S:55 R:80 A:75 D:70 |
| 8 | Confident | `agent-setup` hook command is the exact fixed literal from intake §2 per state; nothing user-provided interpolated | Intake §2 quotes the one-liner verbatim and states "the hook command string is a fixed literal per state — nothing user-provided is interpolated" — satisfies §I with no validation surface | S:85 R:85 A:90 D:85 |
| 9 | Confident | Frontend change is `types.ts` comment ONLY; the sidebar row not rendering a `waiting` duration is a deferred UI-surfacing concern, not fixed here | Intake §3 + Impact + Assumption 11 explicitly scope UI surfacing OUT and list only `types.ts`; `status-panel.tsx`'s `getAgentLine` already renders `<state> <dur>` state-agnostically, so the pane caption shows `waiting <dur>` with no change, while `window-row`/`format.ts` gate on `idle` — that gap is left for the deferred UI discussion, not widened here | S:65 R:80 A:75 D:70 |
| 10 | Confident | Branch→PR resolver uses `gh pr list --head <branch> --state open --json number,url,state,isDraft,updatedAt` and picks max `updatedAt` on multi-PR | Intake §4 names `gh pr list --head <branch> --json number,url,state,isDraft,...` and "multiple open PRs → most recently updated"; `--state open` scopes to open PRs (the derivation's purpose), `updatedAt` gives the deterministic multi-PR tiebreak | S:70 R:75 A:80 D:70 |
| 11 | Confident | Shell reconciler set is `{bash, zsh, fish, sh, dash}`, matched case-sensitively against `pane_current_command` | Intake §1 reader rules enumerate `bash|zsh|fish|sh|dash` verbatim; tmux reports the bare command name so an exact-set match is correct | S:80 R:80 A:80 D:80 |
| 12 | Confident | Branch→PR resolution moves to a background `BranchRefresher` reached via a process-wide `DefaultBranchRefresher` + package-level `Register`/`SnapshotBranchPR` façade — NOT plumbed as a per-instance dependency through `FetchSessions`/`SessionFetcher`/the SSE hub | Rework must-fix requires resolution OFF the hot path; a shared singleton (mirroring how the viewer-wide collector is a single instance started in `router.go`) keeps `FetchSessions`' signature and the whole `SessionFetcher`/`prodSessionFetcher`/hub/test surface unchanged while still moving all gh subprocesses onto the refresher goroutine — the register/snapshot split is the load-bearing part, not the plumbing shape. A single shared refresher is correct because the process talks to one gh identity and branch→PR is repo-scoped by `cmd.Dir` | S:70 R:70 A:80 D:75 |
| 13 | Confident | Refresher cadences: 30s refresh tick, 60s availability-verdict TTL (positive AND negative cached), 5m observed-pair age-out | Rework note mandates ONE availability check per pass with the negative cached and unobserved pairs aging out, but not the exact durations; 30s mirrors the "cheaper than the 90s graphql" per-branch cost while keeping gh traffic bounded and PR-link freshness prompt; 60s availability-TTL bounds `gh auth status` re-probes to ≤1/min; 5m age-out is a small multiple of the refresh interval so a single missed SSE tick never evicts a live pair mid-flight | S:60 R:75 A:75 D:70 |

13 assumptions (3 certain, 10 confident, 0 tentative).

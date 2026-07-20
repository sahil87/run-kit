# Plan: Spawn-Agent Dialog v2 — Match the Original UI Mockup

**Change**: 260714-q9cg-spawn-agent-dialog-mockup
**Intake**: `intake.md`

## Requirements

> Extends the shipped two-field spawn dialog (Task + Preset, from PR #341 —
> now on this branch) to the full mockup: three new spawn-shaping fields
> (Where / Worktree / Agent), a session-named title, and the additive endpoint
> + engine changes those fields require. All shipped behavior is preserved and
> the `rk riff` CLI stays byte-identical.

### Backend: Riff Engine (`internal/riff`)

#### R1: Conditional worktree creation (checkout mode)
The engine SHALL make worktree creation conditional on a new `Where` input on
`riff.Options` (values `"worktree"` and `"checkout"`). In `"worktree"` mode
(default) the engine SHALL behave exactly as today: `wt create` → tmux window
rooted at the new worktree. In `"checkout"` mode the engine SHALL skip
`wt create` entirely and open the tmux window rooted at `opts.RepoRoot` (the
session's derived repo root), with the collision base `riff-<repoRoot-basename>`.
The CLI path SHALL always run worktree mode (its `EffectiveSpec` carries no
`Where`, defaulting to worktree), so `rk riff` behavior is byte-identical.

- **GIVEN** `Where="worktree"` (or empty, the default)
- **WHEN** `Spawn` runs
- **THEN** `wt create` runs and the window is rooted at the created worktree path (`riff-<worktree-basename>`)
- **GIVEN** `Where="checkout"`
- **WHEN** `Spawn` runs
- **THEN** no `wt create`/`wt delete` call is issued and the window is rooted at `opts.RepoRoot` with base `riff-<repoRoot-basename>`, resolved via the same `resolveWindowName` collision suffixing

#### R2: Worktree-name passthrough (`--worktree-name`)
When `Where="worktree"` and a non-empty `WorktreeName` is supplied on
`riff.Options`, the engine SHALL forward it to `wt create` via the verified
`--worktree-name <name>` flag (which skips wt's name prompt), prepended to the
existing `wt create --non-interactive --worktree-open skip` argv. A blank
`WorktreeName` SHALL preserve today's behavior (`wt create` generates the name).
A `WorktreeName` with `Where="checkout"` is a caller error rejected at the API
layer (R7), so the engine treats a checkout-mode `WorktreeName` as unset.

- **GIVEN** `Where="worktree"` and `WorktreeName="my-agent"`
- **WHEN** `Spawn` builds the wt argv
- **THEN** it runs `wt create --worktree-name my-agent --non-interactive --worktree-open skip …`
- **GIVEN** `Where="worktree"` and an empty `WorktreeName`
- **WHEN** `Spawn` builds the wt argv
- **THEN** the argv is byte-identical to today's (no `--worktree-name`)

#### R3: Tier-parameterized launcher resolution
The engine's `ResolveLauncher` SHALL accept a tier name and, when non-empty,
resolve the launcher via `fab agent <tier> --print` (the verified positional-tier
form) instead of `fab agent --print`. An empty tier SHALL emit no positional
(byte-identical to today's default-tier resolution). The existing
`parseFabAgentOutput` single-line contract and silent `DefaultLauncher` fallback
SHALL be unchanged for both forms. The CLI SHALL pass an empty tier (today's
implicit default-tier behavior preserved).

- **GIVEN** a non-empty tier `"doing"`
- **WHEN** `ResolveLauncher(ctx, repoRoot, "doing")` runs
- **THEN** it invokes `fab agent doing --print` (Dir=repoRoot) and returns the trimmed single-line launcher, falling back to `DefaultLauncher` on any failure
- **GIVEN** an empty tier
- **WHEN** `ResolveLauncher(ctx, repoRoot, "")` runs
- **THEN** it invokes `fab agent --print` (no positional) — byte-identical to today
- **AND** the CLI (`cmd/rk/riff.go`) calls it with `""`, preserving `rk riff` behavior

#### R4: Tier enumeration for the dropdown
A best-effort tier enumerator SHALL return the union of the tier names defined
under `agent.tiers` in the target repo's `fab/project/config.yaml` and fab-kit's
built-in tier names (`default`, `doing`, `fast`, `operator`, `review`), with
`default` first and no duplicates, following the `internal/fabconfig`
silent-fallback posture (empty/malformed config → just the built-ins, never an
error). The enumeration SHALL live in `internal/fabconfig` alongside the preset
readers (it reads the same file).

- **GIVEN** a repo whose config defines `agent.tiers: {default, doing, fast, custom}`
- **WHEN** the enumerator reads it
- **THEN** it returns `[default, doing, fast, operator, review, custom]` (built-ins first in fixed order, `default` first, config-only names appended, deduped)
- **GIVEN** a repo with no `agent.tiers` block (or a malformed/absent config)
- **WHEN** the enumerator reads it
- **THEN** it returns exactly the built-ins `[default, doing, fast, operator, review]` with no error

### Backend: Spawn Endpoint (`POST /api/riff`)

#### R5: Additive request body fields
`POST /api/riff` SHALL accept three additive optional body fields alongside the
shipped `{task?, preset?, session}`:

```json
{ "task": "...", "preset": "...", "session": "...",
  "where": "worktree" | "checkout",
  "worktreeName": "my-name",
  "tier": "doing" }
```

`where` SHALL default to `"worktree"` when absent or empty. The handler SHALL
pass `where`/`worktreeName`/`tier` through to `riff.Options`. The endpoint stays
POST-only (Constitution IX) and the additive shape is backward compatible with
the shipped client.

- **GIVEN** a body omitting all three new fields
- **WHEN** the handler runs
- **THEN** it behaves identically to the shipped endpoint (worktree mode, auto-named, default tier)
- **GIVEN** a body with `where="checkout"` and `tier="doing"`
- **WHEN** the handler runs
- **THEN** it calls `Spawn` with `Where="checkout"`, `Tier="doing"`

#### R6: New-field validation (400 before subprocess)
The handler SHALL validate the new fields before any subprocess use:
an unknown `where` value (not `""`/`worktree`/`checkout`) → 400; a non-empty
`worktreeName` with `where="checkout"` → 400 (it has no meaning); a non-empty
`worktreeName` or `tier` that fails a charset/length check → 400. `worktreeName`
SHALL be validated with `validate.ValidateName` (the same tmux-safe rule already
applied to session names — it rejects shell-metacharacters, colons/periods, and
over-length input before the value reaches any argv, per Constitution I). `tier`
SHALL be validated with a strict identifier rule (charset `[A-Za-z0-9_-]`, length
bounded) since it becomes a subprocess positional.

- **GIVEN** `where="sideways"`
- **WHEN** the handler runs
- **THEN** it returns 400 and issues no `wt`/`tmux`/`fab` call
- **GIVEN** `where="checkout"` and `worktreeName="x"`
- **WHEN** the handler runs
- **THEN** it returns 400 (worktreeName invalid with checkout) and creates nothing
- **GIVEN** `worktreeName="bad;name"` (or `tier="a b"`)
- **WHEN** the handler runs
- **THEN** it returns 400 (forbidden characters) before any subprocess

#### R7: Repo-root derivation unchanged; checkout mode reuses it
The handler's repo-root derivation (active-pane cwd → `FindGitRoot`, with a 400
naming the non-repo cwd) SHALL be unchanged and SHALL apply in BOTH modes — in
checkout mode the derived repo root is also the window's working directory (no
worktree is created). The non-repo 400 discipline (nothing created) SHALL hold
for checkout mode too.

- **GIVEN** a session whose active-pane cwd is not a git repo, with `where="checkout"`
- **WHEN** the handler runs
- **THEN** it returns 400 (message names the cwd) and creates nothing

### Backend: Preset List Endpoint (`GET /api/riff/presets`)

#### R8: Additive `tiers` in the presets response
`GET /api/riff/presets` SHALL extend its response to `{presets: [...], tiers: [...]}`
where `tiers` is the string array from R4 (`default` first). The shipped
`presets` array shape SHALL be unchanged. The single shipped client caller SHALL
be updated to read both from this one preflight fetch (no new endpoint —
Constitution IV minimal surface).

- **GIVEN** a session whose repo derives cleanly
- **WHEN** the client GETs `/api/riff/presets`
- **THEN** it returns `200 {presets:[...], tiers:["default", …]}`
- **GIVEN** a repo with no presets defined
- **WHEN** the client GETs
- **THEN** it returns `200 {presets:[], tiers:["default","doing","fast","operator","review"]}`

### Frontend: API Client

#### R9: `spawnRiff` params + presets/tiers response type
`app/frontend/src/api/client.ts` SHALL extend `spawnRiff` to carry the new
optional fields (`where`, `worktreeName`, `tier`) in the POST body (omitting
each when unset/default, mirroring the existing `task`/`preset` omission), and
SHALL extend `getRiffPresets` to return both presets and tiers (a
`{presets: RiffPreset[]; tiers: string[]}` shape or an added `getRiffTiers`-style
field), reading them from the single `/api/riff/presets` fetch. Both SHALL keep
the `withServer` + `throwOnError` conventions.

- **GIVEN** `spawnRiff(server, session, {task, where:"checkout", tier:"doing"})`
- **WHEN** it POSTs
- **THEN** the body carries `where:"checkout"` and `tier:"doing"` (and omits `worktreeName`)
- **GIVEN** `getRiffPresets(server, session)`
- **THEN** it resolves both the presets array and the tiers array from one GET

### Frontend: Spawn-Agent Dialog v2

#### R10: Three new fields, conditional visibility, session-named title
`app/frontend/src/components/spawn-agent-dialog.tsx` SHALL render the mockup's
field set in order Task → Preset → Where → Worktree → Agent, and the dialog
title SHALL be `Spawn agent in {session}`:

- **Where** — a radio group with two options, `new worktree` (default) and
  `this checkout`.
- **Worktree** — a text input, blank by default, placeholder
  `auto-named (e.g. swift-fox)`; SHALL be hidden (or disabled) when `this checkout`
  is selected.
- **Agent** — a dropdown of tier names (from the presets fetch's `tiers`),
  default selection `default`; SHALL display tier names only.

All shipped behavior SHALL be preserved: task optional, Preset shown only when
presets exist, Enter-submits-from-any-field, indeterminate busy state with
double-submit guard, in-dialog error render, close-and-navigate on success with
the falsy-`windowId` nav guard.

- **GIVEN** the dialog opens on session `dev`
- **WHEN** it mounts
- **THEN** its title reads `Spawn agent in dev`, the Where radio defaults to `new worktree`, the Worktree input is visible and blank, and the Agent dropdown defaults to `default`
- **GIVEN** `this checkout` is selected
- **WHEN** the user views the dialog
- **THEN** the Worktree field is hidden
- **GIVEN** a task typed, `this checkout` selected, tier `doing` chosen, Enter pressed
- **WHEN** the spawn is submitted
- **THEN** `spawnRiff` is called with `where:"checkout"`, `tier:"doing"`, no `worktreeName`, and (on success) navigation occurs exactly as the shipped flow

#### R11: Default selections produce a byte-identical shipped launcher
Selecting the defaults (`new worktree`, blank Worktree, Agent `default`) SHALL
produce a request byte-identical to the shipped two-field path: `where` defaults
to worktree, no `worktreeName`, and tier `default` resolves the same launcher as
today's implicit default tier. The client SHALL omit `tier` from the body when
it equals `default` (or send it — either is acceptable as long as the backend
treats `"default"` and `""` identically), keeping the shipped path unchanged.

- **GIVEN** the dialog left at all defaults with a task
- **WHEN** submitted
- **THEN** the resolved launcher is the default-tier launcher (identical to the shipped path) and no worktree name is forced

### Non-Goals

- Fan-out `count > 1` in the UI — the engine supports it; still deferred.
- Unsubmitted-paste task injection — still no boot-ready hook event.
- Per-pane composition UI (multiple skills/cmds per spawn) and preset editing.
- Provider selection beyond tiers — a tier already binds provider + model + effort.
- Reimplementing wt's name generator or fab's tier resolver in rk (Constitution III):
  the Worktree field ships blank-with-placeholder (no wt name-suggest seam exists),
  and tier resolution stays a `fab agent <tier> --print` delegation.
- No new routes (dialog, not page — Constitution IV); no new SSE work.

### Design Decisions

1. **`Where` as a two-value string on `riff.Options` (not a bool `Isolated`)**: mirrors the intake's `where: "worktree" | "checkout"` body field and the mockup radio; a string keeps the API/body/engine vocabulary aligned and leaves room for a future third mode. *Rejected*: a bool (loses the vocabulary parity, awkward JSON).
2. **Checkout mode roots the window at `opts.RepoRoot` and reuses `spawnRiffReturningName`**: the only difference between the two modes is *which directory the window is rooted at* and *whether `wt create` ran* — the tmux spawn sequence (new-window/split/select-layout/select-pane, collision naming, window-id capture) is identical. So `Spawn` branches on `Where` only around `runWtCreate`, then calls the shared `spawnRiffReturningName` with the chosen path. *Rejected*: a parallel checkout spawn function (duplicates the tmux sequence).
3. **Tier enumeration in `internal/fabconfig` (union of `agent.tiers` keys + built-ins)**: there is no `fab` CLI seam to *list* tiers (`fab resolve-agent <tier>` resolves one; `fab agent [tier]` launches one), so the names must come from the config file rk already reads via `fabconfig` — the silent-fallback posture is the established pattern. Built-ins are a fixed constant slice (`default, doing, fast, operator, review`) matching the config-fence documentation. *Rejected*: shelling `fab` per candidate tier (N subprocesses, no list command), or hardcoding only built-ins (misses project-defined tiers).
4. **`worktreeName` validated with `validate.ValidateName`**: it becomes a `wt create --worktree-name` argv element AND (via wt) a worktree directory basename and the `riff-<basename>` tmux window name — the same tmux-safe constraints session/window names already enforce (no shell metacharacters, no colons/periods). Reusing the existing validator is the minimal, consistent choice (Constitution I). `tier` gets a stricter identifier rule since it is a bare subprocess positional.
5. **Title `Spawn agent in {session}`; substring-compatible with the shipped e2e**: Playwright's `getByRole("dialog", { name: "Spawn agent" })` does case-insensitive substring matching, so the existing e2e selector still resolves the renamed dialog; the e2e is still updated to assert the new fields.

## Tasks

### Phase 1: Engine + Config (Backend)

- [x] T001 In `app/backend/internal/fabconfig/fabconfig.go`, add `ReadTiers(repoRoot string) []string` — best-effort union of `agent.tiers` map keys from `fab/project/config.yaml` and the fixed built-in slice `{"default","doing","fast","operator","review"}`, built-ins first in that order, config-only names appended in YAML source order, deduped, always non-empty (built-ins only on empty/malformed/absent config). Reuse the existing `*yaml.Node` walk helpers (`findMappingValue`) to reach `agent.tiers`; keep the silent-fallback posture (no error, no log). <!-- R4 -->
- [x] T002 In `app/backend/internal/riff/riff.go`, extend `ResolveLauncher` to take a `tier string` parameter (`ResolveLauncher(ctx, repoRoot, tier)`): when `tier != ""` build argv `fab agent <tier> --print`, else `fab agent --print` (byte-identical to today). Keep `Dir=repoRoot`, `Output()`, and the `parseFabAgentOutput`/`DefaultLauncher` fallback unchanged. Add `Where`, `WorktreeName`, and `Tier` fields to `Options`, and `Where` + `WorktreeName` to `EffectiveSpec` (Tier is consumed at launcher-resolution time, not carried on the spec). <!-- R1 R2 R3 -->
- [x] T003 <!-- rework: must-fix — unexported const `whereWorktree` (riff.go:165) has zero call sites (parsimony/zero-call-sites). Either delete it, or (preferred, also resolves the Spawn-seam nice-to-have) use it to normalize at the Spawn seam: default empty `Where` via the const and blank a checkout-mode `WorktreeName` there, removing the "defensively ignored" comment. Behavior must stay byte-identical; only this normalization/deletion — do not redo the rest of the task --> In `internal/riff` (`riff.go`), make worktree creation conditional in `Spawn`: resolve the launcher with `opts.Tier`; when `Where=="checkout"` skip `runWtCreate` and use `opts.RepoRoot` as the window root (base `riff-<filepath.Base(repoRoot)>` — the existing `spawnRiffReturningName` already derives the base from the passed path); otherwise run `runWtCreate` forwarding `WorktreeName` (T004). Set `spec.Where`/`spec.WorktreeName` before the branch. Default an empty `Where` to worktree. Keep the `Run` (CLI, count≥1 + fan-out) path worktree-only and byte-identical. <!-- R1 R3 -->
- [x] T004 In `internal/riff` (`riff.go`), thread `WorktreeName` into `runWtCreate`: when `spec.Where != "checkout"` and `spec.WorktreeName != ""`, prepend `--worktree-name <name>` to the `create --non-interactive --worktree-open skip …` argv (before the passthrough). Extract the argv assembly into a pure helper (e.g. `buildWtCreateArgs(spec, passthrough)`) so it is table-testable. Empty name → byte-identical argv. <!-- R2 -->
- [x] T005 Update the CLI call sites in `app/backend/cmd/rk/riff.go` to the new `ResolveLauncher(ctx, repoRoot, "")` signature (empty tier = today's default-tier path); do NOT set `Where`/`WorktreeName`/`Tier` on the CLI's `EffectiveSpec` (they default to worktree/blank), so `rk riff` stays byte-identical. <!-- R1 R2 R3 -->

### Phase 2: API Endpoints (Backend)

- [x] T006 In `app/backend/api/riff.go` `handleRiffSpawn`, decode the three new body fields (`where`, `worktreeName`, `tier`); normalize/validate: unknown `where` (not ``/`worktree`/`checkout`) → 400; `worktreeName` non-empty with `where=="checkout"` → 400; `worktreeName` non-empty → `validate.ValidateName` (400 on fail); `tier` non-empty → a strict identifier check (new `validate.ValidateTier` or inline `[A-Za-z0-9_-]`+length) → 400. Perform all new-field validation BEFORE `deriveRepoRoot`/any subprocess. Pass `Where`/`WorktreeName`/`Tier` into `riff.Options`. <!-- R5 R6 R7 -->
- [x] T007 In `app/backend/api/riff.go` `handleRiffPresets`, add the tiers array to the response: read `fabconfig.ReadTiers(repoRoot)` and return `{presets: [...], tiers: [...]}` (presets shape unchanged). <!-- R8 -->
- [x] T008 [P] <!-- rework: should-fix — the promised `validate_test.go` unit test for ValidateTier was never written (charset + 64-char length bound untested). Add it. Also harden per review: reject a leading `-` in tier names (they become a bare `fab agent <tier>` positional) and reject leading `-`/`/`/spaces in `worktreeName` at the riff API seam (do NOT loosen/tighten the shared validate.ValidateName globally — scope the extra rule to riff), with tests --> If a new `tier` validator is warranted, add `ValidateTier(name string) string` (or reuse `ValidateServerName`'s `[A-Za-z0-9_-]`+length rule) to `app/backend/internal/validate/validate.go` with a matching unit test in `validate_test.go`. <!-- R6 -->

### Phase 3: Go Tests (Backend)

- [x] T009 Add `internal/fabconfig/fabconfig_test.go` coverage for `ReadTiers`: built-ins-only on empty/absent/malformed config; union+dedup+order when `agent.tiers` defines extra names (config-only names appended, built-ins first, `default` first). <!-- R4 -->
- [x] T010 <!-- rework: must-fix — the third clause (checkout-mode base derivation from repoRoot) was never implemented: Spawn's checkout branch (skip runWtCreate, root window at opts.RepoRoot, base riff-<basename>) has zero engine-level coverage. Add it: stub `wt` on PATH that fails the test if invoked + stub tmux seam, or extract the windowRoot decision into a pure seam and table-test it (reviewer-suggested shapes) --> Add `internal/riff/riff_test.go` coverage: `buildWtCreateArgs` (with/without `--worktree-name`), `ResolveLauncher` tier-positional argv via the existing stub-`fab` seam (`TestResolveLauncher_StubFab` extension — tier vs no-tier both resolve; failure → `DefaultLauncher`), and checkout-mode base derivation from `repoRoot` (a pure/argv-level assertion — no real wt/tmux). <!-- R1 R2 R3 -->
- [x] T011 Extend `app/backend/api/riff_test.go`: success with `where=checkout`/`tier` reaching the mock engine verbatim; 400 for unknown `where`; 400 for `worktreeName`+`checkout`; 400 for forbidden `worktreeName`/`tier` chars (no engine call); presets endpoint returns the `tiers` array (built-ins present, `default` first). Do NOT modify the shared `mockTmuxOps`; extend the mock `RiffEngine` to record `Where`/`WorktreeName`/`Tier`. <!-- R5 R6 R7 R8 -->

### Phase 4: Frontend Client + Dialog

- [x] T012 [P] Extend `app/frontend/src/api/client.ts`: `spawnRiff` gains the new optional fields (an options object or additional params) that populate `where`/`worktreeName`/`tier` in the POST body (omit when unset/default); `getRiffPresets` returns both presets and tiers from the one `/api/riff/presets` GET (shape `{presets: RiffPreset[]; tiers: string[]}`), keeping `withServer`+`throwOnError`. Update the exported types. <!-- R8 R9 -->
- [x] T013 Rewrite `app/frontend/src/components/spawn-agent-dialog.tsx` to the v2 field set: title `Spawn agent in {session}`; add Where radio (new worktree default / this checkout), Worktree text input (blank, placeholder `auto-named (e.g. swift-fox)`, hidden when checkout), Agent tier dropdown (from the fetched tiers, default `default`); field order Task → Preset → Where → Worktree → Agent. Wire the new values into `spawnRiff`. Preserve all shipped behavior (Enter-submits, busy state, double-submit guard, in-dialog error, falsy-windowId nav guard, best-effort presets fetch). <!-- R10 R11 -->

### Phase 5: Frontend Tests

- [x] T014 [P] Update `app/frontend/src/components/spawn-agent-dialog.test.tsx`: mock `getRiffPresets` to return `{presets, tiers}`; assert the session-named title, the Where radio (default new worktree), Worktree visible-then-hidden-on-checkout, the Agent dropdown (default `default`), and that a checkout+tier submit calls `spawnRiff` with `where:"checkout"`/`tier`/no `worktreeName`. Keep the existing task/preset/busy/error/nav-guard assertions green. <!-- R9 R10 R11 -->
- [x] T015 Update `app/frontend/tests/e2e/spawn-agent.spec.ts` + `spawn-agent.spec.md`: mock `GET /api/riff/presets*` to include `tiers`; assert the v2 dialog renders the new fields from both entry points, a checkout+tier task-submit carries `where`/`tier` in the POST body and navigates, and the 400 path still renders in-dialog. Keep trailing-`*` globs; run via `just test-e2e "spawn-agent"` only. Update the `.spec.md` companion in the same change (Constitution Test Companion Docs). <!-- R5 R10 -->

## Execution Order

- T001 (ReadTiers) and T002 (engine signatures) are the roots. T003/T004 depend on T002.
- T005 (CLI call-site) depends on T002.
- T006 depends on T002 (Options fields) + T008 (tier validator, if added); T007 depends on T001.
- T009 depends on T001; T010 depends on T002–T004; T011 depends on T006–T007.
- T012 depends on T007 (response shape); T013 depends on T012; T014 depends on T013; T015 depends on T013 (both entry points already wired in the base — no app.tsx/top-bar change needed).

## Acceptance

### Functional Completeness

- [x] A-001 R1: `internal/riff` `Spawn` skips `wt create` in checkout mode and roots the window at `opts.RepoRoot` (base `riff-<repoRoot-basename>`); worktree mode is unchanged.
- [x] A-002 R2: A non-empty `WorktreeName` in worktree mode forwards `--worktree-name <name>` to `wt create`; an empty name is byte-identical to today.
- [x] A-003 R3: `ResolveLauncher` invokes `fab agent <tier> --print` for a non-empty tier and `fab agent --print` for an empty tier; the `DefaultLauncher` fallback is intact and the CLI passes `""`.
- [x] A-004 R4: `fabconfig.ReadTiers` returns the built-ins-∪-config union (`default` first, deduped, built-ins first) and just the built-ins on empty/malformed config.
- [x] A-005 R5: `POST /api/riff` accepts and forwards `where`/`worktreeName`/`tier`; omitting them is behaviorally identical to the shipped endpoint.
- [x] A-006 R8: `GET /api/riff/presets` returns `{presets, tiers}` with the presets shape unchanged and `default` first in tiers.
- [x] A-007 R9: `client.ts` `spawnRiff` carries the new fields (omitting defaults) and `getRiffPresets` returns presets + tiers from the one fetch.
- [x] A-008 R10: The dialog renders Task → Preset → Where → Worktree → Agent, titled `Spawn agent in {session}`, with the Worktree field hidden under `this checkout` and the Agent dropdown defaulting to `default`.

### Behavioral Correctness

- [x] A-009 R11: Defaults (new worktree, blank name, tier `default`) produce a request/launcher byte-identical to the shipped two-field path.
- [x] A-010 R7: Repo-root derivation (and its non-repo 400) is unchanged and applies in both modes; checkout mode uses the derived root as the window's working dir.

### Scenario Coverage

- [x] A-011 R10 R5: A Playwright spec opens the v2 dialog from both entry points, a checkout+tier task-submit carries `where`/`tier` in the POST body and navigates, and the 400 renders in-dialog (trailing-`*` mocks).
- [x] A-012 R3 R2 R4: Go tests cover the tier-positional launcher argv, the `--worktree-name` argv, and the tier-union enumeration.

### Edge Cases & Error Handling

- [x] A-013 R6: Unknown `where`, `worktreeName`+`checkout`, and forbidden `worktreeName`/`tier` characters each return 400 before any subprocess (nothing created).
- [x] A-014 R1: Checkout mode issues no `wt create`/`wt delete` call. *(Engine-level coverage added in rework: `TestSpawn_WhereModes` stubs `wt` on a restricted PATH that fails the test if invoked in checkout mode, and asserts worktree mode does invoke it; the HTTP path has no rollback/delete.)*

### Code Quality

- [x] A-015 Pattern consistency: New Go code follows the `internal/fabconfig` silent-fallback + `internal/riff` pure-helper (test-seam) + handler-validation conventions; new frontend code follows the `Dialog`/`withServer`/best-effort-fetch conventions of the shipped dialog.
- [x] A-016 No unnecessary duplication: The checkout branch reuses `spawnRiffReturningName`; tier enumeration reuses the `fabconfig` yaml-node walk; `worktreeName` reuses `validate.ValidateName`; the tiers ride the existing presets fetch (no new endpoint).
- [x] A-017 Type narrowing over assertions (frontend): the new dialog state uses discriminated/typed values (e.g. a `"worktree" | "checkout"` union), not `as` casts.

### Security

- [x] A-018 R6: `worktreeName` and `tier` are charset/length-validated via `internal/validate` before reaching any argv (Constitution I); all new/changed exec paths remain argv-slice `exec.CommandContext` with timeouts and no shell-string construction; task text still reaches tmux only through the escaped `buildSkillShellString` seam.
- [x] A-019 R5: The mutation stays POST-only with an additive body; the CORS allowlist stays `[GET, POST, OPTIONS]` (Constitution IX — verified `router.go` AllowedMethods unchanged).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. (Every touched seam was extended in place: `spawnRiff`/`getRiffPresets` signatures were replaced, not shadowed; `ResolveLauncher` gained a parameter at its only two call sites; no old dialog/endpoint/validator variant remains. The rework resolved the previously-flagged dead `whereWorktree` constant by giving it a real call site — the Where/WorktreeName normalization at the `Spawn` seam in `internal/riff/riff.go` — so no dead symbols remain in the diff.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Tier resolution via `fab agent <tier> --print` (positional tier); empty tier = `fab agent --print` (today's default path) | Verified live during apply: `fab agent doing --print` and `fab agent default --print` both work and differ as expected; existing parse/fallback contract reused | S:90 R:85 A:95 D:90 |
| 2 | Certain | Worktree-name override via `wt create --worktree-name <name>` passthrough | Verified live during apply: `wt create --help` shows `--worktree-name` "Set worktree name (skips name prompt)" | S:90 R:85 A:95 D:90 |
| 3 | Certain | `where=checkout` skips `wt create` and roots the window at the derived repo root, reusing `spawnRiffReturningName` (only the root path + wt-skip differ) | Intake names the option and the derivation; the shared spawn sequence is the codebase's own precedent | S:85 R:80 A:90 D:85 |
| 4 | Confident | Tier enumeration = `fabconfig.ReadTiers` (union of `agent.tiers` keys + fixed built-ins `{default,doing,fast,operator,review}`, default-first, deduped), silent-fallback | No `fab` list-tiers seam exists (verified: `fab resolve-agent`/`fab agent` resolve/launch one tier, neither lists); the config-fence documents the built-ins; fabconfig posture is the established pattern | S:70 R:80 A:80 D:70 |
| 5 | Confident | Worktree field ships blank-with-placeholder `auto-named (e.g. swift-fox)`; no pre-filled suggestion (no wt name-suggest seam) | Verified: `wt` exposes no suggest command; Constitution III forbids reimplementing wt's generator; placeholder is the honest fallback per intake #5 | S:75 R:85 A:85 D:75 |
| 6 | Confident | `worktreeName` validated with `validate.ValidateName` (tmux-safe rule); `tier` with a strict `[A-Za-z0-9_-]`+length rule | `worktreeName` becomes a worktree basename + `riff-<basename>` window name (same tmux-safe constraints); `tier` is a bare subprocess positional needing a stricter identifier rule; both reuse/extend `internal/validate` per Constitution I | S:70 R:80 A:85 D:70 |
| 7 | Confident | Field order Task → Preset → Where → Worktree → Agent; title `Spawn agent in {session}`; Worktree hidden when checkout | Mockup is authoritative for the new fields and order; Preset (postdates the mockup) keeps its shipped slot; the existing e2e's substring dialog-name selector still matches the renamed title | S:75 R:90 A:85 D:80 |
| 8 | Confident | `tiers` rides the existing `GET /api/riff/presets` response (`{presets, tiers}`) rather than a new endpoint; the one shipped client caller is updated | Intake #7; one preflight fetch already exists; additive JSON is backward compatible; Constitution IV minimal surface | S:65 R:85 A:85 D:75 |
| 9 | Confident | Entry points unchanged — the shipped terminal-route Cmd+K `Agent: Spawn` + window-switcher `+ New Agent` already open this dialog; no app.tsx/top-bar wiring change | The base already wires both entry points to `SpawnAgentDialog`; v2 only changes the dialog's internals + the request it sends | S:80 R:85 A:90 D:85 |

9 assumptions (3 certain, 6 confident, 0 tentative).

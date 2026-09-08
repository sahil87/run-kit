# Plan: Provider-Aware Skill Invocation Prefix

**Change**: 260908-t7fm-provider-aware-skill-prefix
**Intake**: `intake.md`

## Requirements

### Riff: Agent Resolution Carries the Skill Prefix

#### R1: ResolveAgent resolves launcher + skill prefix from `fab agent -o yaml`
`internal/riff` SHALL expose `ResolveAgent(ctx, repoRoot, tier) ResolvedAgent` where `ResolvedAgent` is `struct { Launcher, SkillPrefix string }`. It runs `fab agent [tier] -o yaml` (subprocess Dir = repoRoot, existing `FabTimeout` bound) and parses two keys from stdout: `command` (the launcher) and `skill_prefix`. Parsing MUST be a pure, table-testable seam (`parseFabAgentYAML(stdout string, err error) (ResolvedAgent, bool)`) in the spirit of the existing `parseFabAgentOutput`. A tolerant line-based extraction of the two top-level keys is sufficient and preferred over importing a YAML dependency (the output is fab-controlled, keys are top-level scalars; note `command:` value contains `"` and `$(...)` — take everything after the first `: ` unquoted-verbatim, matching only top-level `command:` / `skill_prefix:` lines, i.e. lines with no leading whitespace).

- **GIVEN** fab ≥ 2.24 on PATH in a configured repo
- **WHEN** `ResolveAgent(ctx, repoRoot, "operator")` runs
- **THEN** it returns the YAML `command` value as Launcher (byte-identical to `fab agent operator --print` output) and the `skill_prefix` value (e.g. `/` or `$`) as SkillPrefix

#### R2: Tolerant fallback ladder preserves the never-errors contract
`ResolveAgent` MUST never error. The fallback ladder:

| Failure | Result |
|---------|--------|
| `-o yaml` succeeds, both keys parse | `{command, skill_prefix}` |
| `-o yaml` succeeds, `skill_prefix` line absent (older fab) | `{command, "/"}` |
| `-o yaml` fails (non-zero exit, e.g. older fab without `-o`) or `command` unparseable | retry legacy `fab agent [tier] --print` via the existing `parseFabAgentOutput`; on success `{printed, "/"}` |
| both invocations fail (fab absent, timeout, malformed) | `{DefaultLauncher, "/"}` |

`ResolveLauncher(ctx, repoRoot, tier) string` SHALL remain as a thin wrapper returning `ResolveAgent(...).Launcher` (its exported signature and contract unchanged — `rk tutorial` keeps using it).

- **GIVEN** a stub `fab` that exits non-zero on `-o yaml` but prints a launcher for `--print`
- **WHEN** `ResolveAgent` runs
- **THEN** it returns the `--print` launcher with SkillPrefix `/`
- **GIVEN** no `fab` on PATH
- **WHEN** `ResolveAgent` runs
- **THEN** it returns `{DefaultLauncher, "/"}` and no error escapes

#### R3: RenderSkillRef swaps the prefix on skill-shaped values only
`internal/riff` SHALL expose the pure function `RenderSkillRef(prefix, value string) string`: when `value` matches `^/[a-z0-9][a-z0-9_-]*( .*)?$` (a slash-led skill invocation, optionally with argument text), the leading `/` is replaced by `prefix` (arguments preserved verbatim); any other value — free prose, empty, already `$`-prefixed, a path like `/tmp/x` fails the charset after segment end via the space rule below — is returned unchanged. An empty `prefix` MUST behave as `/` (identity for slash values). Note `/tmp/x` DOES match the shape (`tmp` is skill-name-charset); this is accepted: skill panes carry skill invocations or prose tasks, and a claude/`/`-prefix render is the identity so the ambiguity is only reachable on non-claude providers where a path-as-task is not a meaningful input.

- **GIVEN** prefix `$` and value `/fab-discuss`
- **WHEN** `RenderSkillRef` runs
- **THEN** it returns `$fab-discuss`
- **GIVEN** prefix `$` and value `/fab-clarify resolve the auth question`
- **THEN** it returns `$fab-clarify resolve the auth question`
- **GIVEN** prefix `$` and value `fix the flaky test in internal/tmux`
- **THEN** it returns the value unchanged
- **GIVEN** prefix `/` and any value
- **THEN** the return is byte-identical to the input

#### R4: EffectiveSpec carries SkillPrefix; skill panes render through it
`EffectiveSpec` SHALL gain a `SkillPrefix string` field. A normalization step SHALL map every `PaneKindSkill` pane's non-empty `Value` through `RenderSkillRef(spec.SkillPrefix, value)` exactly once, before any composition or delivery reads the values — implemented as a small exported helper (e.g. `(EffectiveSpec) renderSkillPanes()` or `ApplySkillPrefix(spec) EffectiveSpec`) invoked at the two spec-finalization seams: `Spawn` (daemon path, after `ResolveEffectiveSpec`) and the CLI path in `cmd/rk/riff.go` (after the spec is assembled and `SkillPrefix` set from `ResolveAgent`). An empty `SkillPrefix` behaves as `/` (existing tests and any spec constructed without the field stay byte-identical). Downstream composition (`taskPaneShellString`, `paneShellString`) and typed delivery (`specTask` → `deliverCliTask`/`deliverDaemonTask`, including the CLI degrade warning text) read the already-rendered values unchanged.

- **GIVEN** a codex launcher (SkillPrefix `$`) and the CLI's default `/fab-discuss` pane
- **WHEN** the spawn composes and the typed delivery runs
- **THEN** the delivered task text is `$fab-discuss` (typed post-boot — codex is already the typed-delivery path)
- **GIVEN** a claude launcher (SkillPrefix `/`)
- **WHEN** any spawn runs
- **THEN** every composed shell string and delivered task is byte-identical to before this change

### Operator: Kickoff Prefix Rendering

#### R5: `rk operator` and the cron respawner render the kickoff
`operatorKickoffPrompt` SHALL remain the canonical `/fab-operator` constant. `runOperator` (`cmd/rk/operator.go`) and `rkCronRespawnRole` (`cmd/rk/cron_respawn.go`) SHALL resolve `ResolveAgent(ctx, root, operatorTier)` (replacing their `ResolveLauncher` seams — the seam vars retype to return `ResolvedAgent`) and deliver `RenderSkillRef(agent.SkillPrefix, operatorKickoffPrompt)`. The paste-it-yourself degrade messages SHALL carry the rendered text. `rk tutorial` is untouched (provider-neutral prose kickoff).

- **GIVEN** fab resolves the operator tier to codex (`skill_prefix: $`)
- **WHEN** `rk operator` opens the operator window (or the cron respawner brings it back)
- **THEN** the typed kickoff is `$fab-operator`, and a delivery failure's stderr note shows `$fab-operator`
- **GIVEN** fab resolves claude (`skill_prefix: /`)
- **THEN** the kickoff is `/fab-operator`, byte-identical to before

### Non-Goals

- No translation of free-text lanes: `rk mux send`, `api/send.go` window sends, cron entry payloads, prose riff tasks.
- No change to the positional-vs-typed delivery split (`taskDeliveryMode` stays keyed on `launcherCommandName == "claude"`).
- No new `rk` command surface, config key, or rk-local provider→prefix table.
- No shll `skill` standard amendment (possible follow-up, out of scope).
- No frontend changes.

### Design Decisions

#### Consume `skill_prefix` from fab's resolver, not an rk-local table
**Decision**: rk reads the provider→prefix rule from `fab agent [tier] -o yaml`'s `skill_prefix` key (fab-kit `agent.SkillPrefix`, PR #650).
**Why**: single owner toolkit-wide (Constitution III — Wrap, Don't Reinvent); rk already shells out to this resolver at every affected site; verified live against fab 2.24.1.
**Rejected**: an rk-local `launcherCommandName → prefix` map — a second copy of the rule that drifts when fab adds providers.
*Introduced by*: 260908-t7fm-provider-aware-skill-prefix

#### Slash-shape detection at the seam, constants stay canonical `/`
**Decision**: skill-pane values and kickoff constants stay written in canonical slash form; `RenderSkillRef` swaps the prefix at composition time for values matching the skill-invocation shape.
**Why**: transparently fixes user `riff.presets` values and `--skill` flags with zero config migration; free prose can't match the shape; `/` render is the identity so the claude path is provably byte-identical.
**Rejected**: storing bare skill names + always prefixing — requires migrating preset config values and distinguishing bare names from one-word prose tasks.
*Introduced by*: 260908-t7fm-provider-aware-skill-prefix

#### Legacy `--print` retry inside the fallback ladder
**Decision**: when `-o yaml` fails, `ResolveAgent` retries `fab agent [tier] --print` before falling back to `DefaultLauncher`.
**Why**: an older installed fab (predating `-o yaml`) previously resolved launchers successfully via `--print`; degrading those users to `DefaultLauncher` would be a regression unrelated to the prefix feature.
**Rejected**: `-o yaml`-only with direct `DefaultLauncher` fallback — simpler but silently discards a working older fab's configured launcher.
*Introduced by*: 260908-t7fm-provider-aware-skill-prefix

## Tasks

### Phase 1: Core Implementation

- [x] T001 Add `ResolvedAgent` struct, `ResolveAgent`, pure `parseFabAgentYAML`, and the `-o yaml` → `--print` → `DefaultLauncher` fallback ladder in `app/backend/internal/riff/riff.go`; retype `fabAgentArgs` usage (new `fabAgentYAMLArgs`); keep `ResolveLauncher` as thin wrapper. Table tests for the parse seam + extend `TestResolveLauncher_StubFab` with a YAML-printing stub, a `-o`-rejecting legacy stub (exercises the `--print` retry), and the fab-absent case, in `app/backend/internal/riff/riff_test.go` <!-- R1, R2 -->
- [x] T002 [P] Add pure `RenderSkillRef(prefix, value string) string` in `app/backend/internal/riff/shell.go` with `TestRenderSkillRef` table (swap, args-preserved, prose-verbatim, empty-prefix identity, `/`-identity, empty-value) in `app/backend/internal/riff/riff_test.go` or `shell_test.go` <!-- R3 -->

### Phase 2: Wiring

- [x] T003 Add `SkillPrefix` field to `EffectiveSpec` (`app/backend/internal/riff/riff.go`) and the render-skill-panes normalization; invoke it in `Spawn` (set `spec.SkillPrefix` from `ResolveAgent`, render after `ResolveEffectiveSpec`) so daemon spawns and typed deliveries carry rendered values. Tests: codex-prefix spawn composes/delivers `$fab-…`; claude spawn byte-identical (existing `TestBuildSpawnArgvs`/`TestComposePanes` untouched) <!-- R4 -->
- [x] T004 CLI path: `app/backend/cmd/rk/riff.go` resolves via `ResolveAgent`, sets `spec.SkillPrefix`, renders before `riff.Run` (same normalization helper); covers the CLI's `/fab-discuss` default-pane fallback and `--skill` values <!-- R4 -->
- [x] T005 `app/backend/cmd/rk/operator.go`: retype `operatorResolveLauncherFn` seam to `ResolveAgent`, render `operatorKickoffPrompt` for delivery + the degrade stderr note; update operator tests for the rendered kickoff (codex-prefix case + claude byte-identity) <!-- R5 -->
- [x] T006 `app/backend/cmd/rk/cron_respawn.go`: retype `cronRespawnResolveLauncherFn` seam to `ResolveAgent`, render the kickoff before `cronRespawnDeliverFn`; update respawn tests <!-- R5 -->

### Phase 3: Verification

- [x] T007 Run the verification gates: `cd app/backend && go test ./...`, then `just build` (no frontend changes — skip Playwright; `just test` e2e not required for a backend-only prefix change but backend suite must be green) <!-- R1, R2, R3, R4, R5 -->

## Execution Order

- T001 and T002 are independent ([P] on T002)
- T003 depends on T001 + T002; T004 depends on T003
- T005, T006 depend on T001 + T002 (independent of T003/T004)
- T007 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `ResolveAgent` returns `{command, skill_prefix}` parsed from `fab agent [tier] -o yaml`, with a pure table-tested parse seam
- [x] A-002 R3: `RenderSkillRef` implements the slash-shape swap rule with argument preservation, covered by a pure table test
- [x] A-003 R4: `EffectiveSpec.SkillPrefix` exists and every `PaneKindSkill` value is rendered exactly once before composition/delivery on both the CLI and daemon paths
- [x] A-004 R5: `rk operator` and the cron respawner deliver the prefix-rendered kickoff and show it in degrade messages

### Behavioral Correctness

- [x] A-005 R2: fallback ladder verified by stub-fab tests — YAML success, missing `skill_prefix` → `/`, `-o yaml` failure → `--print` retry, total failure → `{DefaultLauncher, "/"}`; no error ever escapes
- [x] A-006 R4: with SkillPrefix `/` (or empty), every composed shell string, spawn argv, and delivered task is byte-identical to pre-change behavior (existing composition tests pass unmodified)

### Scenario Coverage

- [x] A-007 R4: a codex-launcher spawn test asserts the typed-delivered task text is `$fab-discuss` (rendered) while composition stays bare (typed delivery path)
- [x] A-008 R5: an operator test asserts the codex-prefix kickoff `$fab-operator` reaches the delivery seam

### Edge Cases & Error Handling

- [x] A-009 R3: prose tasks, empty values, `$`-prefixed values, and values with argument text behave per the R3 scenarios (verbatim / args preserved)
- [x] A-010 R2: fab-absent and malformed-YAML cases degrade silently within `FabTimeout` bounds (no error, no stderr from the resolver itself)

### Code Quality

- [x] A-011 Pattern consistency: new code follows the existing pure-seam + package-level test-seam patterns (`parseFabAgentOutput`, `operatorResolveLauncherFn` precedents); comments state constraints, not narration
- [x] A-012 No unnecessary duplication: one renderer, one parse seam, one normalization helper — no per-call-site copies
- [x] A-013 Security: no shell-string construction changes — the launcher remains riff's one documented shell-expansion exception; rendered values ride the existing escaped/typed paths; all subprocesses stay argv-slice `exec.CommandContext` with timeouts (constitution §I)
- [x] A-014 Tests: new behavior covered per code-quality.md (new features MUST include tests)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant (`ResolveLauncher` stays live as `rk tutorial`'s resolution seam and the documented thin wrapper).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Line-based extraction of top-level `command:` / `skill_prefix:` keys instead of a YAML library | Output is fab-controlled with top-level scalar keys; avoids a new dependency; mirrors the existing single-line parse-seam pattern | S:70 R:85 A:80 D:70 |
| 2 | Confident | Legacy `--print` retry when `-o yaml` fails | Preserves older-fab launcher resolution (pre-`-o yaml` fabs previously worked); costs one extra subprocess only on the failure path | S:65 R:85 A:80 D:75 |
| 3 | Confident | Normalization renders skill panes once at spec finalization (not inside `taskPaneShellString`/`deliver`) | Single render point keeps composition/delivery pure readers and the degrade-warning text automatically correct | S:60 R:85 A:80 D:70 |
| 4 | Tentative | The R3 shape regex accepts path-like values (`/tmp/x` → rendered on non-claude) | Only reachable on non-claude providers where a bare path is not a meaningful skill-pane task; the `/`-prefix render is identity everywhere else | S:50 R:80 A:65 D:50 |
| 5 | Confident | `/tmp/x` does NOT match the R3 shape — the literal regex `^/[a-z0-9][a-z0-9_-]*( .*)?$` (anchored, arg tail must start with a space) rejects the second `/`; this follows R3's primary rule statement ("a path like `/tmp/x` fails the charset after segment end") over R3's contradictory closing Note and assumption 4 | The R3 text is self-contradictory; the literal regex plus the descriptive clause agree, and "unchanged" is the safe read for a path-as-task | S:60 R:85 A:80 D:65 |
| 6 | Confident | The retyped cmd/rk seam vars are renamed (`operatorResolveLauncherFn` → `operatorResolveAgentFn`, `cronRespawnResolveLauncherFn` → `cronRespawnResolveAgentFn`) | The seams now return `ResolvedAgent`, not a launcher string — keeping the old names would misdescribe the type; renames are package-internal with tests updated in the same commit | S:70 R:85 A:80 D:70 |

4 assumptions (0 certain, 3 confident, 1 tentative). 2 more recorded at apply (#5 confident, #6 confident) — 6 total.

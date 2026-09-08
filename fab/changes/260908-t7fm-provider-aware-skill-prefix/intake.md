# Intake: Provider-Aware Skill Invocation Prefix

**Change**: 260908-t7fm-provider-aware-skill-prefix
**Created**: 2026-09-08

## Origin

> provider-aware skill invocation prefix for injected commands (riff default task, operator kickoff, presets) — consume skill_prefix from fab agent -o yaml per fab-kit #650

Conversational — a `/fab-discuss` session swept the repo for every place run-kit injects commands into an agent TTY, established that the hardcoded slash-command payloads are Claude-syntax-only, reviewed how fab-kit solved the same problem (PRs #649/#650: `agent.SkillPrefix` as the single owner, exposed as the `skill_prefix` key on `fab agent … -o yaml`), and settled on run-kit consuming that key rather than replicating the mapping. Key facts verified live during the discussion:

- The installed fab (2.24.1) emits `skill_prefix: /` on both `fab agent -o yaml` and `fab agent operator -o yaml` in this repo.
- `fab agent [tier] --print` output is **byte-identical** to the YAML's `command` field (verified for the default and operator tiers), so switching the resolver's output format is behavior-preserving for the launcher half.
- fab-kit's rule (`agent.SkillPrefix`): `"$"` for the exact provider name `codex`, `"/"` for every other name — built-in, custom, unknown, or empty.

## Why

1. **The pain point**: run-kit composes and injects skill invocations into agent TTYs as Claude slash-command syntax. Codex invokes skills with a `$` prefix (`$fab-discuss`), not `/`. The transport is already provider-aware — `taskDeliveryMode` in `internal/riff/deliver.go` gives Claude the positional argv and every other launcher a typed post-boot delivery — but the *payload* is not: a Codex launcher gets the literal string `/fab-discuss` faithfully typed into its composer, where it does nothing.
2. **The consequence if unfixed**: mixed-provider setups break silently. fab config explicitly supports `agent.profiles.operator: {provider: codex}` — exactly the case where `rk operator` (and the cron respawner, which reuses the same kickoff constant) types a dead `/fab-operator` into a Codex operator. Riff spawns with a non-Claude tier get a dead default task. The window and agent exist, so the failure is invisible until a human notices the agent sitting idle.
3. **Why this approach**: fab-kit already owns the provider→prefix rule in exactly one place (`agent.SkillPrefix`, fab-kit PR #650) and exposes it on the resolver run-kit **already shells out to** at every affected site (`riff.ResolveLauncher` → `fab agent [tier] --print`). Consuming `skill_prefix` from `fab agent -o yaml` keeps a single owner toolkit-wide (Constitution III: Wrap, Don't Reinvent). The rejected alternative — an rk-local `launcherCommandName → prefix` table — would be a second copy of the rule that drifts. fab-kit #650 itself is a cautionary tale here: #649 first added a dedicated `fab skill-prompt` subcommand and #650 retired it because the prefix should ride the resolver consumers already call; rk should not repeat that detour by adding new surface area.

## What Changes

### 1. `riff.ResolveLauncher` → resolve launcher + skill prefix from `fab agent -o yaml`

`internal/riff/riff.go` `ResolveLauncher(ctx, repoRoot, tier)` currently runs `fab agent [tier] --print` and returns a single launcher string, falling back silently to `DefaultLauncher` (`claude --dangerously-skip-permissions`) on any failure. Change the resolution to run `fab agent [tier] -o yaml` and parse two keys from the YAML:

- `command` — the launcher (verified byte-identical to `--print` output, so launcher behavior is preserved)
- `skill_prefix` — the invocation prefix (`/` or `$`)

Introduce a resolved-agent shape (e.g. `type ResolvedAgent struct { Launcher, SkillPrefix string }`) returned by a new `ResolveAgent` function; `ResolveLauncher` may remain as a thin compatibility wrapper or the three call sites (riff CLI + daemon spawn, `rk operator`, `rk tutorial`, cron respawner) migrate directly — implementer's choice, keep it minimal.

**Tolerant-read fallback contract** (extends the existing best-effort posture — the resolver never errors):

| Failure | Result |
|---------|--------|
| fab absent / non-zero exit / timeout / unparseable YAML | `{DefaultLauncher, "/"}` |
| YAML parses but `skill_prefix` key absent (older fab) | resolved `command` + prefix `"/"` |
| YAML parses but `command` empty/missing | `{DefaultLauncher, "/"}` |

The `/` default is always consistent: `DefaultLauncher` is claude, and an older fab predating `skill_prefix` cannot be configured for codex dispatch through this seam anyway. Parsing should be a tolerant line/YAML read in the spirit of the existing `parseFabAgentOutput` pure seam — keep a pure, table-testable parse function.

### 2. Skill-invocation rendering at the composition/delivery seam

Add a small pure renderer in `internal/riff` (near `launcherCommandName`), mirroring fab-kit's `SkillPrompt` semantics:

```go
// RenderSkillRef re-renders a skill invocation for the receiving provider:
// a value matching ^/[a-z0-9][a-z0-9-]*( .*)?$ is a skill invocation — its
// leading "/" is replaced by prefix (arguments preserved verbatim). Any other
// value (free prose, already-$-prefixed, empty) passes through unchanged.
func RenderSkillRef(prefix, value string) string
```

The rule: **slash-led skill-shaped values are invocations and get their prefix swapped; everything else is free text and passes verbatim.** This one rule transparently fixes every lane without a config migration:

- `DefaultRiffSkill` (`/fab-discuss`) — the CLI's no-panes fallback
- `operatorKickoffPrompt` (`/fab-operator`) — `rk operator` + the cron respawner
- User preset `skill:` values (`riff.presets` in fab config, e.g. `/fab-continue`)
- CLI `--skill /fab-x` values and the API task field when slash-shaped

Constants stay written as `/fab-discuss` / `/fab-operator` (canonical slash form; the renderer owns translation). Free-prose tasks (`rk riff "fix the bug in X"`), `rk mux send`, `api/send.go`, and cron entry payloads are untouched — they never pass through the renderer.

### 3. Wire the renderer at each injection site

- **Riff spawn (CLI + daemon)**: render pane-0 skill values (and non-task skill panes' values) with the resolved prefix before composition/delivery — i.e. in or just before `taskPaneShellString` / `paneShellString` (`internal/riff/shell.go`) and the typed-delivery path (`deliverCliTask` / `deliverDaemonTask` in `internal/riff/deliver.go`). `EffectiveSpec` grows a `SkillPrefix` field populated from resolution (defaulting to `/` when empty, so existing tests and the daemon path stay valid).
- **`rk operator`** (`cmd/rk/operator.go`): render `operatorKickoffPrompt` with the prefix resolved alongside the operator-tier launcher, then hand to `deliverAgentKickoff` unchanged.
- **Cron respawner** (`cmd/rk/cron_respawn.go`): same — it already calls `cronRespawnResolveLauncherFn` with the operator tier; consume the prefix from the same resolution.
- **`rk tutorial`**: **no change** — its kickoff is provider-neutral prose (`Run rk skill tutorial and follow it exactly`), already the conformant pattern.

### 4. Explicitly out of scope

- No new `rk` command surface, no config key, no rk-local provider table — the prefix knowledge stays in fab.
- No translation of free-text lanes (mux send, window send API, cron payloads).
- No change to the delivery-mode split (positional vs typed) — `taskDeliveryMode` stays keyed on `launcherCommandName == "claude"`.
- No amendment to the shll `skill` standard in this change (noted in the discussion as a possible follow-up: documenting `fab agent -o yaml` `skill_prefix` as the queryable owner of per-harness invocation syntax).

## Affected Memory

- `run-kit/rk-riff`: (modify) — launcher resolution (`ResolveLauncher`/`ResolveAgent`, `--print` → `-o yaml`, fallback table), the skill-ref renderer, `EffectiveSpec.SkillPrefix`, task-delivery rendering, test inventory updates
- `run-kit/architecture`: (modify) — the `operator` CLI-subcommand row (kickoff composition now prefix-rendered; resolution via `fab agent operator -o yaml`) and the `internal/riff` library row
- `run-kit/cron`: (modify) — § Role-Target Respawn and the "Respawn delivers the kickoff" design decision reference the literal `/fab-operator`; now the prefix-rendered kickoff

## Impact

- `app/backend/internal/riff/riff.go` — resolution (`ResolveAgent`, YAML parse seam, fallback), `DefaultRiffSkill` handling
- `app/backend/internal/riff/shell.go` / `deliver.go` / `spec.go` — renderer + wiring into composition and typed delivery; `EffectiveSpec.SkillPrefix`
- `app/backend/cmd/rk/operator.go`, `cmd/rk/cron_respawn.go` — prefix-rendered kickoff
- `app/backend/cmd/rk/riff.go`, `api/riff.go` — plumb the resolved prefix into the spec (signature touch points only)
- Tests: extend `TestResolveLauncher_StubFab` (stub now prints YAML), new pure tables for the YAML parse and `RenderSkillRef`, kickoff-rendering coverage in operator/cron-respawn suites; existing composition tests (`TestBuildSkillShellString`, `TestBuildSpawnArgvs`, `TestComposePanes`) stay byte-identical for the claude/`/` case
- No frontend changes (the daemon endpoint supplies its own panes; rendering happens server-side)
- Dependency note: `skill_prefix` requires fab ≥ the #650 release (installed: 2.24.1 ✓); older fabs degrade via the tolerant-read fallback to `/`

## Open Questions

- None — design settled in the preceding discussion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Consume `skill_prefix` from `fab agent -o yaml`; no rk-local provider→prefix table | Discussed — user directed linking to fab-kit #650's solution; Constitution III (Wrap, Don't Reinvent); verified live against fab 2.24.1 | S:90 R:80 A:95 D:90 |
| 2 | Certain | Launcher continuity: YAML `command` ≡ `--print` output | Verified byte-identical for default and operator tiers during discussion | S:85 R:90 A:100 D:95 |
| 3 | Confident | Slash-shaped-value rewrite rule (`RenderSkillRef`): values matching `^/[a-z0-9][a-z0-9-]*( .*)?$` get the prefix swapped; all else verbatim | Discussion converged on rendering at the seam; the shape-detection variant (over bare-name constants) transparently fixes user presets and `--skill` values with zero config migration, and free prose can never match the shape | S:65 R:80 A:75 D:60 |
| 4 | Confident | Fallback prefix is always `/` (fab absent, YAML unparseable, key missing) | `DefaultLauncher` is claude; fab-kit's own rule defaults every non-codex provider to `/`; matches the resolver's existing silent-fallback contract | S:70 R:85 A:85 D:80 |
| 5 | Confident | `rk tutorial` unchanged | Its kickoff is provider-neutral prose by prior design (260903-7ajq) — already the conformant pattern | S:75 R:90 A:90 D:85 |
| 6 | Confident | Free-text lanes (mux send, window send API, cron payloads, prose riff tasks) stay verbatim | Discussed — translating user text is out of scope; only run-kit-composed/skill-shaped invocations are rendered | S:70 R:85 A:80 D:75 |
| 7 | Tentative | `ResolveAgent` returns a struct; `ResolveLauncher` kept as thin wrapper vs migrating all call sites directly | Implementation-shape choice, easily revisited at plan time; either satisfies the design <!-- assumed: ResolveAgent struct shape with optional ResolveLauncher compatibility wrapper — call-site migration granularity left to apply --> | S:55 R:90 A:70 D:45 |

7 assumptions (2 certain, 4 confident, 1 tentative, 0 unresolved).

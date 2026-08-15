# Intake: Mux Guard Move (CLI Layering Part 4)

**Change**: 260815-mi5s-mux-guard-move
**Created**: 2026-08-15

## Origin

One-shot `/fab-new` invocation with a detailed directive-style prompt:

> Part 4 of docs/specs/cli-layering.md Execution Plan (run-kit repo): the guard move. Scope: `rk mux guard` — move/rename of `rk tmux-guard`. This is DIFFERENT from Part 3's low-risk moves: tmux-guard is a machine-invoked entry point (installed PATH shims exec the literal name `rk tmux-guard`), so per delegation rule 3 this MUST get a PERMANENT hidden root alias (never warns, never removed) — same treatment as Part 2's agent-hook, NOT Part 3's ordinary deprecation aliases. agent-setup (now `rk agent setup`, per Part 2 — already merged, reuse it) regenerates the PATH shim to write the new `rk mux guard` form going forward; existing installed shims calling the literal tmux-guard string must keep working forever, unchanged. This is a safety-critical component (it exists specifically to prevent accidental tmux kill-server calls that have killed live servers before). Parts 1–3 are merged; starting fresh off origin/main. Every run-kit CLI-surface part implicitly includes: the shll standards audit, the help-dump test, and rk skill topic-page updates. When shipped, this is the last run-kit-only part before the operator must PAUSE and ask the user to cut a release of Part 1 before Part 5 (a fab-kit change) can start.

Design authority: `docs/specs/cli-layering.md` — the `rk mux` family table (mux guard row: "move + **permanent hidden root alias** (installed PATH shims exec the literal name; `rk agent setup` writes the new form going forward)"), Execution Plan row 4 ("`mux guard` (← `tmux-guard`) with permanent hidden root alias; `rk agent setup` regenerates shims to the new form; doctor states updated"), delegation rule 3 ("Machine-invoked entry points are contracts"), and § Hidden plumbing ("The permanent aliases above (`agent-hook`, `tmux-guard`) are hidden").

## Why

1. **Problem**: `rk tmux-guard` is a visible root command (`tmux_guard.go`, registered at `root.go:67`) that belongs in the `rk mux` substrate family per the CLI-layering spec — it is server hygiene, exactly the class `mux` was created for. Leaving it at root works against the spec's root-noise-reduction goal (~23 → ~15 visible root commands) and leaves the family incomplete (Part 3 moved reap/snapshot/init-conf; guard is the last planned move).
2. **Consequence of not doing it**: the grouping plan ships permanently half-done — `rk -h` keeps a visible root verb whose siblings all moved, and Part 5+ (fab-kit guidance re-points) would reference an inconsistent surface.
3. **Why this approach**: the guard is a **machine-invoked contract** — every installed shim at `~/.local/share/rk/shims/tmux` carries the frozen literal `exec "<abs-rk>" tmux-guard "$@"`, fronting **every** PATH-resolved tmux invocation on the machine. A deprecation alias (warns, later removed) is categorically wrong here: a warning would leak onto stderr of every guarded tmux call on old installs, and removal would break the guard machine-wide — re-opening the exact kill-server death vector (4 recorded incidents) the shim exists to close. The agent-hook treatment from Part 2 (permanent, hidden, byte-silent alias + installer writes the new form going forward, old artifacts roll over only on re-run) is the proven pattern and is reused verbatim.

## What Changes

### 1. `tmux_guard.go` — factory-built command instances

Refactor the single `tmuxGuardCmd` var into a factory (the `newReapCmd` / `newAgentHookCmd` precedent — a cobra command object cannot have two parents):

- `newTmuxGuardCmd(use string) *cobra.Command` carrying everything the current command has: `Args: cobra.ArbitraryArgs`, `DisableFlagParsing: true`, `SilenceUsage`/`SilenceErrors`, and the RunE → `runTmuxGuard(args)` → `*exitCodeError` print-verbatim + `os.Exit(code)` handling. `runTmuxGuard`, the decision functions, shim constants, and resolution helpers are untouched.
- `muxGuardFamilyCmd = newTmuxGuardCmd("guard [tmux args...]")` — the visible family member.
- `tmuxGuardAliasCmd` — `newTmuxGuardCmd("tmux-guard [tmux args...]")` with `Hidden: true`, **no cobra `Deprecated`**, comment-marked PERMANENT (mirroring `agentHookAliasCmd` at `agent_hook.go:132-142`): installed shims carry the literal frozen at install time, so this form must resolve silently forever (cli-layering delegation rule 3). No warning of any kind — old shims front every tmux invocation on the machine, and stderr noise there is a contract violation. No future cleanup sweep may remove it.

### 2. `mux.go` + `root.go` — registration

- `mux.go` `init()`: `muxCmd.AddCommand(muxGuardFamilyCmd)`. Update the family header comment and the parent `Long` (currently "Five members") to include guard as the sixth member (e.g. "`guard` fronts the real tmux binary, refusing bare `kill-server` — the verb the installed PATH shim execs").
- `root.go`: replace `rootCmd.AddCommand(tmuxGuardCmd)` with `rootCmd.AddCommand(tmuxGuardAliasCmd)` registered beside the other hidden aliases, with a comment mirroring the agent-hook one: permanent machine-invoked contract, not deprecation-grade.

### 3. `-L` flag semantics on the guard member (pin with tests)

The guard keeps `DisableFlagParsing`, so the mux parent's persistent `-L/--server` is **never parsed** on this member — every token after `guard` flows verbatim into the tmux argv (which is exactly right: `-L` in a guard invocation IS tmux's socket flag). The guard therefore does **not** call `muxRejectInheritedServerFlag` (that helper exists for members whose parsed `-L` would be silently ignored; here nothing is parsed and nothing is ignored). Pin with tests:

- `rk mux guard -L x kill-server` → argv `["-L","x","kill-server"]` reaches the decision function → explicit socket → passes to the real tmux verbatim.
- `rk mux -L x guard kill-server` (flag before the subcommand): cobra's Find strips the traversal path but, because the found command disables flag parsing, the remaining args INCLUDING `-L x` are handed to RunE — expected argv `["-L","x","kill-server"]`, same pass. The test documents actual cobra behavior; the invariant that must hold either way is **no silent retarget**: the invocation either carries its explicit socket into tmux or is blocked with the canonical remedy.
- `rk tmux-guard <args>` (alias) behaves byte-identically to `rk mux guard <args>` for the same `<args>` — same decision, same messages, same exit codes.

### 4. Shim regeneration — `rk agent setup` writes the new form (second-generation shim script)

In `tmuxShimTemplate` (`tmux_guard.go`), change the steady-state exec line from `exec "%[2]s" tmux-guard "$@"` to:

```sh
exec "%[2]s" mux guard "$@"
```

plus the template's prose comments that name `rk tmux-guard`. Constraints that MUST hold:

- The line stays the **first** `exec ` line with the rk path spelled literally — `tmuxShimExecTarget` parses the first double-quoted value on the first such line, and every doctor shim state builds on it. That parse is generation-agnostic (the path is the first quoted token in both the old and new form) — no change to `tmuxShimExecTarget`.
- Rollout is the existing idempotent replace-in-place: re-running `rk agent setup` registers the new script as a content change under the existing consent flow — no migration, no new file, no proactive rewrite of installed shims. **Existing installed shims (exec'ing the literal `tmux-guard`) keep working forever, unchanged, through the permanent alias**; they roll over only on the next `rk agent setup` re-run. This mirrors the three-generation hook-command model from Part 2.
- Sniff terms stay as they are: `sniffsAsTmuxShim` (Go) and the shell walk's `grep -qF -e "<marker>" -e tmux-guard` both match the ownership marker `managed-by: rk agent-setup (tmux guard shim)`, which every generation carries on line 2 — new-form shims are still recognized (by marker), and the retained `tmux-guard` term still catches old-generation copies. The marker TEXT is frozen (it matches artifacts already on user machines) and MUST NOT change.
- `agent_setup.go` consent-summary text naming `` `rk tmux-guard` `` (line ~351) updates to `` `rk mux guard` ``.
- `agent_setup_test.go` pin at ~1160 (`exec "/opt/homebrew/bin/rk" tmux-guard "$@"`) updates to the new form.

### 5. User-facing message prefixes

The guard's Go-side messages (`tmuxGuardBlockedMessage` "rk tmux-guard: BLOCKED: …", `findRealTmux`'s "rk tmux-guard: no real tmux found…", the exec-error prefix) and the NEW shim script's fallback-stage messages update their prefix to `rk mux guard:` — messages should name the canonical command. The blocked message's remedy lines (`tmux -L <scratch-name> kill-server`, `RK_TMUX_GUARD=off …`) are unchanged. Old installed shims keep their frozen old-prefix fallback text — acceptable by design (same as old hook literals). Update the message pins in `tmux_guard_test.go` (including the rendered-script behavioral tests, which execute the shim against stubs).

### 6. Doctor — verify both generations, minimal text churn

`tmuxGuardShimCheck` already works over any generation (it keys on `tmuxShimMarker` + `tmuxShimExecTarget`, both generation-agnostic). Changes:

- Check `Name`/`failLabel` stay `"tmux-guard shim"` — they name the artifact (the shim fronting tmux), not the command spelling, and are pinned by `doctor_test.go:462`.
- Doctor hints naming `rk agent setup` and "the `rk tmux guard` block" (the frozen PATH-block marker `# >>> rk tmux guard >>>` / `# <<< rk tmux guard <<<`) are all still correct — the markers are frozen installed-artifact text and MUST NOT change.
- Add doctor test coverage for a NEW-form shim content (exec target parse + healthy state) alongside the existing old-form fixtures, proving both generations report identically.

### 7. Surface tests (help-dump + root wiring)

- `root_test.go`: add `"tmux-guard"` to the hidden-root-alias loop (registered, Hidden, resolvable); add `{"mux","guard"}` to the mux family-member paths. Distinguish permanence in comments (tmux-guard joins agent-hook as a permanent contract, vs the deprecation-grade three).
- `help_dump_test.go`: mux member count 5 → 6 (`guard` present); `tmux-guard` joins the excluded-hidden-root-forms assertion list.
- `tmux_guard_test.go`: wiring tests for both instances (family member found at `mux guard`; alias found at root, Hidden, NOT Deprecated — assert `cmd.Deprecated == ""` so a future sweep converting it to a warning alias fails a test).

### 8. Toolkit-standards audit + skill topic pages (implicit obligations, not skipped)

- Run `shll standards` and re-check the changed surface against the governing standards (help-dump, ten principles, skill) — per the constitution's Toolkit Standards clause and the toolkit-standards memory's audit-against-HEAD-build rule. The help-dump contract test must pass against the new tree.
- `rk skill` topic pages: add one Gotcha bullet to `app/backend/cmd/rk/skill/mux.md` noting the guard (bare `tmux kill-server` with no `-L`/`-S` is refused machine-wide by the rk tmux guard shim; use `tmux -L <name> kill-server` for scratch servers) and mirror it byte-identically to `docs/site/skill/mux.md` (`skill_test.go:214` pins byte-equality). No other page changes: README's shim mention (line ~301) names no command literal, and docs/site carries no `tmux-guard` reference.

### 9. Out of scope / operator note

- No changes to the guard decision logic, the block rule, the escape hatch, the probe/fail-open stages, or the PATH-block file matrix — this is a naming/registration move only.
- fab-kit guidance changes are Part 5+, not this change.
- **Operator sequencing**: when this ships, PAUSE — ask the user to cut a release containing Part 1 before Part 5 (a fab-kit change consuming released `rk mux send/await`) can start.

## Affected Memory

- `run-kit/tmux-guard-shim`: (modify) canonical name becomes `rk mux guard` with the permanent hidden root alias `tmux-guard`; new-generation shim exec line + message prefixes; alias/rollover contract
- `run-kit/agent-state`: (modify) `rk agent setup` shim-contract references (`exec "<abs-rk>" mux guard "$@"` going forward; generation rollover note)
- `run-kit/agent-messaging`: (modify) mux family grows to six members; guard's `-L` posture (DisableFlagParsing — flags flow into tmux argv, unlike the reject-on-moved-members rule)
- `run-kit/toolkit-standards`: (modify) help-dump / Principle-9 surface check covers the six-member mux family
- `run-kit/architecture`: (modify) CLI subcommand list if it names tmux-guard at root

## Impact

- `app/backend/cmd/rk/tmux_guard.go` (factory + template + messages), `mux.go`, `root.go`, `agent_setup.go` (summary text) — plus their tests: `tmux_guard_test.go`, `agent_setup_test.go`, `root_test.go`, `help_dump_test.go`, `doctor_test.go`
- `app/backend/cmd/rk/skill/mux.md` + `docs/site/skill/mux.md` (byte-identical pair)
- No API/frontend/daemon impact; no installed-artifact migration (old shims work forever by design)
- Verification: `cd app/backend && go test ./...`; standards audit via `shll standards`; help-dump test

## Open Questions

*(none — the prompt was directive-complete; all remaining decisions are graded below)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `tmux-guard` becomes a PERMANENT hidden root alias — never warns, never removed, byte-silent (agent-hook treatment, NOT Part 3 deprecation) | Explicit user directive + cli-layering rule 3 + § Hidden plumbing; installed shims front every tmux call, so stderr noise or removal is a contract violation | S:95 R:50 A:95 D:95 |
| 2 | Certain | Factory-built two instances (`newTmuxGuardCmd`) sharing the untouched `runTmuxGuard` core | Established in-repo pattern (`newReapCmd`, `newAgentHookCmd`); cobra commands cannot have two parents | S:85 R:85 A:95 D:90 |
| 3 | Certain | Shim template rolls to `exec "<abs-rk>" mux guard "$@"`; installed shims untouched, roll over only on `rk agent setup` re-run | Explicit user directive + spec Part 4 row; mirrors Part 2's hook-generation model; `tmuxShimExecTarget` parse is generation-agnostic | S:90 R:70 A:90 D:90 |
| 4 | Confident | Sniff terms unchanged (marker + retained `tmux-guard` term); frozen marker text recognizes every generation | Marker is on line 2 of all generations within the 512-byte sniff window; removing the `tmux-guard` term would only lose coverage of old copies | S:70 R:80 A:85 D:80 |
| 5 | Confident | Guard message prefixes update to `rk mux guard:` (Go messages + NEW shim fallback text); old installed shims keep frozen text | Messages should name the canonical command; cosmetic, easily reversed; old-artifact text freezing is the established model | S:55 R:85 A:75 D:65 |
| 6 | Confident | Doctor check `Name`/`failLabel` stay `"tmux-guard shim"`; doctor changes limited to both-generation test coverage | The name identifies the artifact, not the command spelling; PATH-block markers are frozen installed text; spec's "doctor states updated" is satisfied by generation-agnostic verification + naming sweep | S:60 R:85 A:80 D:70 |
| 7 | Confident | Guard does NOT use `muxRejectInheritedServerFlag`; `DisableFlagParsing` lets `-L` flow into the tmux argv, pinned by tests incl. the flag-before-subcommand shape | `-L` on a guard invocation is genuinely tmux's flag; the reject helper targets members that would silently ignore a parsed flag — nothing is parsed here; invariant pinned: no silent retarget | S:65 R:80 A:85 D:75 |
| 8 | Confident | One Gotcha bullet added to skill `mux.md` (+ byte-identical site copy); no other page/README changes | Topic-page obligation is explicit in the prompt; the guard block is agent-relevant knowledge (recorded kill-server incidents); alternative (no change, Part 3 precedent) rejected as under-serving the explicit obligation | S:50 R:90 A:65 D:50 |
| 9 | Certain | shll standards audit + help-dump test + `go test ./...` are in-scope verification for this change | Explicit user directive + constitution Toolkit Standards clause | S:95 R:90 A:95 D:95 |

9 assumptions (4 certain, 5 confident, 0 tentative, 0 unresolved).

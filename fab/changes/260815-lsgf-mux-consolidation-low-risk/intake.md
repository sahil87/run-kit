# Intake: Low-Risk Mux Consolidation (CLI Layering Part 3)

**Change**: 260815-lsgf-mux-consolidation-low-risk
**Created**: 2026-08-15

## Origin

<!-- One-shot /fab-new invocation with a detailed scope statement referencing the spec. -->

> Part 3 of docs/specs/cli-layering.md Execution Plan (run-kit repo): low-risk mux consolidation. Scope (all low-risk moves with deprecation aliases — consolidating existing commands under rk mux, no new behavior): (1) `rk mux reap` — move/rename of `rk reaper`. (2) `rk mux snapshot list/show/restore` — move/rename of `rk snapshot list/show/restore` (three-level depth has `fab pane window-name` as precedent per the spec). (3) `rk mux init-conf` — move/rename of `rk init-conf` (it scaffolds tmux.conf/tmux.d, a mux concern). All three get standard deprecation aliases at their old root locations (not permanent — these are human-typed CLI verbs, not machine-invoked contracts, unlike Part 1/2's permanent aliases). Also: hide `shell-init` from help (it is sourced from shell rc, machine-invoked, never typed by a human — help-dump already treats it as hidden per spec note, verify/conform). Runs after Part 1 (`rk mux send/await`, PR #617, merged) and Part 2 (`rk agent` family, PR #620, merged) — starting fresh off origin/main which includes both, so the `rk mux` parent command and its shared `-L/--server` persistent flag already exist from Part 1 — reuse it, do not recreate it. Every run-kit CLI-surface part implicitly includes: the shll standards audit (run `shll standards` and conform), the help-dump test, and `rk skill` topic-page updates. When shipped, this unblocks Part 4 (guard move).

Key decisions carried from the cli-layering discussion (2026-08-15) and this invocation:

- **Deprecation aliases, not permanent aliases**: `reaper`/`snapshot`/`init-conf` are human-typed verbs, so their root aliases are deprecation-grade (hidden + cobra `Deprecated` pointer, removable in a future release). This deliberately differs from Part 2's `agent-hook` and Part 4's `tmux-guard`, which are machine-invoked contracts frozen into installed artifacts and stay permanently (cli-layering.md delegation rule 3).
- **Reuse the Part 1 `mux` parent**: `muxCmd` in `app/backend/cmd/rk/mux.go` already exists with the persistent `-L/--server` flag and `muxServer()` resolution. Do not create a second parent or a second flag.
- **Three-level depth is sanctioned**: `rk mux snapshot list` is fine — `fab pane window-name` is the named precedent in the spec's mux-family table.
- **Standing CLI-surface obligations**: shll standards audit, help-dump test coverage, `rk skill` topic-page review are in scope even though not itemized per-row in the spec's execution plan.

## Why

1. **Problem**: `rk -h` lists ~23 visible root commands; the tmux-substrate janitor/recovery/scaffold verbs (`reaper`, `snapshot`, `init-conf`) sit flat at the root alongside flagship verbs, diluting discoverability. docs/specs/cli-layering.md (decided 2026-08-15) groups the tmux substrate under the `rk mux` family; Part 1 shipped the family parent with `send`/`await`, and this part is the planned low-risk consolidation wave.
2. **Consequence of not doing it**: the spec's target root surface (~15 visible commands) is never reached; Part 4 (guard move, which lands `mux guard` beside these members) and the future substrate twins (Part 6: `mux capture/kill/process`) would land into an inconsistent family where new verbs are grouped but the older substrate verbs are not; `shell-init` keeps masquerading as a human-facing verb in help.
3. **Why this approach**: pure move/rename with deprecation aliases is the lowest-risk slice of the grouping plan — no engine changes, no contract changes, no installer changes (unlike Part 4, where installed PATH shims exec the literal `tmux-guard` name). The two-instance constructor pattern for aliases is already proven in this codebase by Part 2 (`newAgentSetupCmd(use, deprecated)` in `agent_setup.go`).

## What Changes

All changes are in `app/backend/cmd/rk/` plus docs/tests. **No new behavior** — the engines (`internal/tmux.ReapTestServers`, `internal/snapshot`, `tmux.DefaultConfigBytes`) are untouched.

### 1. `rk mux reap` (from `rk reaper`)

`reaper.go` currently declares a single package-level `reaperCmd` with package-level flag vars (`reaperPrefix`, `reaperYes`, `reaperForce`, `reaperDryRun`, `reaperAll`), registered at root (`root.go:71`). Rework to the Part 2 two-instance constructor pattern:

- `newReapCmd(use string, deprecated bool) *cobra.Command` with per-instance flag vars (closure-bound, like `newAgentSetupCmd`), sharing the existing RunE body and render helpers unchanged.
- Family member: `newReapCmd("reap", false)` added to `muxCmd`.
- Root alias: `newReapCmd("reaper", true)` stays at root with `Hidden: true` + `Deprecated: "use `rk mux reap` instead"` (cobra prints the pointer to stderr and still runs with identical flags and exit codes — the Part 2 mechanism).
- Help text (`Long`) rewrites its self-references: `run-kit reaper` → `run-kit mux reap` (the alias shows the same text; it is hidden and carries the deprecation pointer, so canonical-name help is correct for both).

### 2. `rk mux snapshot list|show|restore` (from `rk snapshot …`)

`snapshot.go` declares `snapshotCmd` + three subcommands with package-level flag vars (`snapshotListAll`, `snapshotShowAt`, `snapshotRestoreAt`). Rework to constructors:

- `newSnapshotCmd(deprecated bool)` builds the parent **and its three subcommands** as fresh instances with per-instance flag vars (a cobra command has exactly one parent, so the family member and the root alias cannot share child instances).
- Family member added to `muxCmd`; root alias `snapshot` stays with `Hidden: true` + `Deprecated: "use `rk mux snapshot` instead"` on the parent. Sub-command names, args validators, `--all`/`--at` flags, output, and exit codes are unchanged. (Deprecation on the hidden parent covers the subtree: `rk snapshot list` prints the parent's pointer via cobra's deprecation handling on the executed path — verify in tests; if cobra only fires `Deprecated` on the exact command executed, set the same `Deprecated` string on the three alias children too.)
- The existing seams (`snapshotNow`, `newSnapshotStore`, `snapshotRestoreFn`) stay package-level — they are test seams, not per-instance state.

### 3. `rk mux init-conf` (from `rk init-conf`)

`initconf.go` declares `initConfCmd` with one flag (`--force`). Same treatment: `newInitConfCmd(use string, deprecated bool)`, family member `init-conf` under `muxCmd`, hidden deprecated root alias `init-conf`. Note: `initConfCmd`'s RunE prints via bare `fmt.Printf` — switch to `cmd.OutOrStdout()` while touching it (makes the move testable; matches every other command in the package).

### 4. Inherited `-L/--server` on the three new members

The `mux` parent's persistent `-L/--server` flag is inherited by all members but is only consumed by `send`/`await` (`muxServer()`). The three moved members do not read it. To avoid a success-looking no-op (`rk mux -L foo reap` silently reaping the default socket dir scope), each moved member's RunE **starts with a guard**: if the inherited flag was explicitly set (`cmd.Flags().Changed("server")` resolves inherited persistent flags via cobra's flag lookup — use `cmd.InheritedFlags().Changed("server")` or equivalently check the shared `muxServerFlag != ""`), return `usageError` stating the flag does not apply to this subcommand (exit 2). Root aliases have no `-L` flag at all (unchanged from today).
<!-- assumed: reject-explicit--L over silently-ignoring it — toolkit Principle 1 (refuse over silent no-op); small guard, easily removed if a future member grows -L semantics -->

### 5. Hide `shell-init`

`shell_init.go` `newShellInitCmd()`: add `Hidden: true`. It remains fully functional (rc files eval `run-kit shell-init zsh` forever); it just stops rendering in `rk -h`/help-dump (`includeInDump` drops hidden commands — the same mechanism that already hides `help-dump` itself). README's completion section (README.md:278-282) keeps documenting it — installation is the one moment a human types it.

### 6. `mux` family help text

`mux.go`'s `Short` ("Tmux substrate operations (agent-to-agent messaging)") and `Long` describe a two-member family. Update to cover the grown membership: send/await (messaging), reap (janitor), snapshot (layout recovery), init-conf (config scaffold). Also update the stale file-header comment ("Moving the existing root-level tmux commands … is future work") and the `-L` flag's help string if the reject-guard (§4) lands.

### 7. Registration and help-dump

`root.go` init: remove `reaperCmd`/`snapshotCmd`/`initConfCmd` direct registrations; add the three hidden deprecated root aliases; `muxCmd` gains the three family members (registered in `mux.go`'s or the members' own `init()`s per existing pattern). Note root.go's `usageArgs` wrap loop covers DIRECT children only — family members must pre-wrap their own `Args` validators (the Part 2 note on `newAgentSetupCmd`), which matters for `snapshot list/show/restore` (`MaximumNArgs`/`ExactArgs`) under `mux`.

Net visible-root delta: −4 (`reaper`, `snapshot`, `init-conf` grouped; `shell-init` hidden).

### 8. Tests

- `help_dump_test.go`: mux family now captured with exactly 5 members (send, await, reap, snapshot, init-conf) and snapshot's 3 children at depth; `reaper`/`snapshot`/`init-conf`/`shell-init` absent from the root dump (hidden/moved).
- `reaper_test.go`/`snapshot_test.go`/`initconf` coverage/`shell_init_test.go`/`root_test.go`: retarget invocations to the new paths; add alias tests proving each deprecated root form still runs (identical output/exit codes) and prints the cobra deprecation pointer; prove `-L` rejection on the moved members; prove `shell-init` is hidden but executable.
- Go-side comment/string sweep: `internal/tmux/reaper.go:109`, `internal/tmux/tmux.go:2110`, `api/servers.go:31,34` mention `rk reaper` in comments — update to `rk mux reap`.

### 9. Docs + standing obligations

- **README.md**: the command table row `run-kit init-conf` (README.md:302) → `run-kit mux init-conf`; sweep for other old-form mentions (reaper/snapshot are not currently in the README command table).
- **shll standards audit**: run `shll standards`, read the standards governing help output/README/skill (help-dump, ten-principles, readme-extraction, skill), and conform — the toolkit-standards constitution clause binds every CLI-surface change. docs/memory/run-kit/toolkit-standards.md records the audit posture and its new-surface checklist already names `mux`.
- **`rk skill` topic pages**: audit `docs/site/skill.md` + `docs/site/skill/mux.md` (canonical; `cmd/rk/skill/*` are synced copies via `scripts/sync-skill.sh` with byte-honesty tests). Expected outcome: agent-facing guidance is unchanged (send/await behavior identical; reap/snapshot/init-conf are operator janitor/recovery verbs, not agent capabilities — a reaper reference in an agent skill would be an attractive nuisance). Update only if a page states family membership or old command forms.
<!-- assumed: no new agent-facing topic content for reap/snapshot/init-conf — they are operator verbs; topic pages document agent capabilities -->

## Affected Memory

- `run-kit/agent-messaging`: (modify) the `rk mux` family description grows from two members to five; -L reject rule on non-messaging members
- `run-kit/tmux-sessions`: (modify) `rk reaper` references → `rk mux reap` (+ deprecation alias note)
- `run-kit/layout-snapshots`: (modify) `rk snapshot list|show|restore` CLI → `rk mux snapshot …` (+ alias note)
- `run-kit/architecture`: (modify) CLI subcommand inventory: mux family membership, hidden shell-init, deprecated root aliases
- `run-kit/toolkit-standards`: (modify) help-dump/Principle-9 new-surface check extended over the moved members; shell-init hidden

## Impact

- `app/backend/cmd/rk/`: `mux.go`, `reaper.go`, `snapshot.go`, `initconf.go`, `shell_init.go`, `root.go` + their tests, `help_dump_test.go`, `root_test.go`
- Comment-only touches: `app/backend/internal/tmux/reaper.go`, `internal/tmux/tmux.go`, `api/servers.go`
- Docs: `README.md`, `docs/site/skill/mux.md` (+ synced `cmd/rk/skill/mux.md`) if membership wording changes
- No engine, API, frontend, daemon, or installer changes. No cross-repo (fab-kit) changes.
- Downstream: unblocks Part 4 (guard move) which lands `mux guard` beside these members.

## Open Questions

- None — the invocation pinned scope, alias semantics, sequencing, and the standing obligations; remaining decisions were resolvable from the codebase (Part 2 precedent) and graded below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Two-instance constructor pattern for each moved command (family member + hidden root alias sharing one RunE core, per-instance flag vars) | Direct codebase precedent: `newAgentSetupCmd(use, deprecated)` from Part 2; a cobra command cannot have two parents | S:90 R:85 A:95 D:90 |
| 2 | Certain | Deprecation mechanism = `Hidden: true` + cobra `Deprecated: "use \`rk mux …\` instead"` (warns on stderr, still runs, identical exit codes) | The invocation says "standard deprecation aliases"; Part 2's `agent-setup` alias is the standard in this repo | S:95 R:90 A:95 D:95 |
| 3 | Confident | Moved members reject an explicitly-set inherited `-L/--server` with a usage error (exit 2) rather than silently ignoring it | Toolkit Principle 1 (refuse over success-looking no-op); `rk mux -L foo reap` would otherwise read as server-scoped while reaping globally; trivially reversible guard | S:70 R:85 A:75 D:60 |
| 4 | Confident | `snapshot` alias deprecation pointer must fire on subcommand invocations too — set `Deprecated` on alias children if cobra doesn't surface the parent's notice on the executed child path | Behavior verified in tests during apply; either shape satisfies "alias warns and runs" | S:60 R:90 A:80 D:70 |
| 5 | Certain | `shell-init` hiding = `Hidden: true` only; command stays functional and README's completion install section stays | Spec: "shell-init (sourced from shell rc) becomes hidden"; `includeInDump` already excludes hidden commands, so help-dump conforms automatically | S:90 R:90 A:90 D:85 |
| 6 | Confident | Help/comment self-references rewrite to the canonical new form (`run-kit mux reap` in Long text; internal comments `rk reaper` → `rk mux reap`); alias help is not forked | Aliases are hidden + deprecated, so canonical-form help text is correct for both instances; forked help text is drift surface | S:75 R:90 A:85 D:80 |
| 7 | Confident | `rk skill` topic pages: audit but expect no new agent-facing content for reap/snapshot/init-conf (operator verbs, not agent capabilities); update `mux.go` family Short/Long instead | Skill bundle documents what an agent should do from inside a pane; janitor/recovery verbs are operator actions — advertising the reaper to agents is an attractive nuisance | S:65 R:90 A:80 D:70 |
| 8 | Certain | Change type = refactor (move/rename, no new behavior) | Pure command-surface reorganization with aliases; spec labels it consolidation | S:85 R:90 A:90 D:90 |
| 9 | Confident | `initconf.go` RunE switches `fmt.Printf` → `cmd.OutOrStdout()` while moving | Every other command in the package routes through the cmd writer; required for the move's own tests; zero behavior change in production | S:60 R:95 A:90 D:85 |

9 assumptions (4 certain, 5 confident, 0 tentative, 0 unresolved).

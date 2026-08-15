# Plan: Low-Risk Mux Consolidation (CLI Layering Part 3)

**Change**: 260815-lsgf-mux-consolidation-low-risk
**Intake**: `intake.md`

## Requirements

### CLI Surface: `rk mux` family growth

#### R1: `rk mux reap` is the canonical reaper
`rk mux reap` SHALL be a member of the existing `muxCmd` family and behave byte-identically to today's `rk reaper` (same flags `--prefix/--yes/--force/--dry-run/--all`, same dry-run-default, same guards, same output and exit codes). The engine (`internal/tmux.ReapTestServers`) MUST NOT change. Help text self-references SHALL use the canonical `run-kit mux reap` form.

- **GIVEN** a socket dir with rk-test* leftovers
- **WHEN** `rk mux reap` runs bare
- **THEN** the same dry-run candidate list prints as today's `rk reaper`, nothing is touched
- **AND** `rk mux reap --yes` reaps with the identical summary rendering

#### R2: `rk mux snapshot list|show|restore` is the canonical snapshot CLI
`rk mux snapshot` SHALL carry the three subcommands with unchanged names, args validators, flags (`--all`, `--at`), rendering, and exit codes. The `internal/snapshot` engine and seams (`snapshotNow`, `newSnapshotStore`, `snapshotRestoreFn`) MUST NOT change semantics; seams stay package-level (shared by both instances).

- **GIVEN** a stored snapshot for server `work`
- **WHEN** `rk mux snapshot show work` runs
- **THEN** output is byte-identical to today's `rk snapshot show work`
- **AND** `rk mux snapshot restore work` drives the same restore engine

#### R3: `rk mux init-conf` is the canonical scaffold
`rk mux init-conf` SHALL scaffold `~/.rk/tmux.conf` + `tmux.d/` exactly as today (`--force` semantics unchanged). Its RunE SHALL print via `cmd.OutOrStdout()` instead of bare `fmt.Printf` (package convention; no production behavior change).

- **GIVEN** no existing `~/.rk/tmux.conf`
- **WHEN** `rk mux init-conf` runs
- **THEN** the config and drop-in dir are written and reported as today

#### R4: Deprecation aliases at the old root locations
`rk reaper`, `rk snapshot` (with its three subcommands), and `rk init-conf` SHALL remain functional at the root as **hidden deprecation aliases**: each alias instance carries `Hidden: true` and cobra `Deprecated: "use \`rk mux …\` instead"`, prints the deprecation pointer (stderr in production) and still runs with identical flags, output, and exit codes. Aliases are built by the Part 2 two-instance constructor pattern (one constructor per command, per-instance flag vars — a cobra command has exactly one parent). The deprecation notice MUST fire on executed subcommand paths too (`rk snapshot list` — set `Deprecated` on alias children if cobra does not surface the parent's notice on the child).

- **GIVEN** a script invoking `rk reaper --yes`
- **WHEN** it runs on the new binary
- **THEN** it reaps exactly as before, with a deprecation pointer on stderr
- **AND** `rk snapshot list` still lists, with a deprecation pointer

#### R5: Moved members reject an explicitly-set inherited `-L/--server`
The three moved members (reap, snapshot subcommands, init-conf) do not consume the mux parent's persistent `-L` flag; each SHALL return a usage error (exit 2) when the flag was explicitly set (e.g. `rk mux -L foo reap`), naming that `--server` does not apply to this subcommand. `send`/`await` behavior is unchanged. Root aliases have no `-L` flag (unchanged).

- **GIVEN** `rk mux -L foo reap`
- **WHEN** the command runs
- **THEN** it exits 2 with a usage error naming `--server`, and nothing is reaped

#### R6: `shell-init` hidden from help
`newShellInitCmd()` SHALL set `Hidden: true`. The command stays fully functional (rc files eval it); it disappears from `rk -h` and from help-dump (via the existing `includeInDump` hidden-node rule). README's completion install section stays.

- **GIVEN** `rk shell-init zsh`
- **WHEN** it runs on the new binary
- **THEN** the completion script emits exactly as today
- **AND** `rk help-dump` output contains no `shell-init` node and `rk -h` does not list it

#### R7: Family help text reflects the grown membership
`mux.go`'s `Short`/`Long` SHALL describe the five-member family (send/await messaging, reap janitor, snapshot recovery, init-conf scaffold), the file-header comment SHALL drop the "moving … is future work" claim, and the `-L` flag help SHALL note it applies to the messaging verbs. Registration in `root.go` SHALL drop the three direct root registrations in favor of the aliases, with the family members registered on `muxCmd`.

- **GIVEN** `rk mux -h`
- **WHEN** help renders
- **THEN** all five members list with accurate one-liners

#### R8: Conformance surfaces hold (help-dump, Principle 9, P4, skill)
Per constitution § Toolkit Standards and the toolkit-standards memory recipe:
help-dump SHALL show the `mux` subtree with exactly {send, await, reap, snapshot(list/show/restore), init-conf} and no `reaper`/`snapshot`/`init-conf`/`shell-init` at root (hidden nodes drop at every level); family members under `mux` SHALL pre-wrap their own `Args` validators with `usageArgs` (root's wrap loop covers direct children only); Principle 9 postures carry over unchanged (reaper/snapshot output is all data; caps + `--all` unchanged); exit codes stay 0/1/2. The audit MUST re-run `shll standards` for the authoritative list (never from memory) and the change MUST be checked against the standards governing help/README/skill surfaces. `rk skill` topic pages: audit `docs/site/skill.md` + `docs/site/skill/mux.md`; agent-facing content is expected unchanged (reap/snapshot/init-conf are operator verbs, not agent capabilities — do not advertise them to agents); any edit syncs via `scripts/sync-skill.sh` under the byte-equality drift guards.

- **GIVEN** `rk help-dump`
- **WHEN** the JSON emits
- **THEN** the mux subtree carries the five members (snapshot with three children), and no moved/hidden name appears at root

### Non-Goals

- No engine changes (`internal/tmux` reaper, `internal/snapshot`, config embed) beyond comment-string updates.
- No `tmux-guard` move (Part 4), no new mux verbs (Part 6), no fab-kit changes.
- No removal of the deprecation aliases in this change (they are removable later; removal is not scheduled here).

### Design Decisions

#### Two-instance constructor per moved command
**Decision**: Each moved command becomes a `newXxxCmd(use string, deprecated bool)`-style constructor producing the family member and the hidden root alias, flag vars closure-bound per instance.
**Why**: cobra commands have exactly one parent; Part 2 (`newAgentSetupCmd`) proved the pattern in this package; package-level flag vars would silently share state across instances.
**Rejected**: cobra `Aliases` field (same-parent only); a delegating stub RunE (duplicates flag definitions anyway, loses help parity).
*Introduced by*: 260815-lsgf-mux-consolidation-low-risk

#### Reject explicitly-set `-L` on non-messaging members
**Decision**: reap/snapshot/init-conf under `mux` error (usage, exit 2) when the inherited `--server` flag was explicitly set.
**Why**: toolkit Principle 1/9 posture — `rk mux -L foo reap` silently ignoring `-L` is a success-looking misinterpretation (user believes the reap is server-scoped).
**Rejected**: silently ignoring the flag (footgun); plumbing `-L` semantics into the moved commands (new behavior, out of scope).
*Introduced by*: 260815-lsgf-mux-consolidation-low-risk

## Tasks

### Phase 1: Core Implementation

- [x] T001 Rework `app/backend/cmd/rk/reaper.go`: `newReapCmd(use string, deprecated bool)` constructor with per-instance flag vars; canonical help text `run-kit mux reap`; family instance `reap`, root alias `reaper` (Hidden+Deprecated); render helpers unchanged <!-- R1, R4 -->
- [x] T002 Rework `app/backend/cmd/rk/snapshot.go`: constructors building parent + list/show/restore per instance (per-instance `--all`/`--at` vars); family instance under mux, root alias `snapshot` (Hidden+Deprecated, children carrying the notice as needed per R4); seams stay package-level <!-- R2, R4 -->
- [x] T003 Rework `app/backend/cmd/rk/initconf.go`: `newInitConfCmd(use, deprecated)`; switch RunE prints to `cmd.OutOrStdout()`; family instance `init-conf`, root alias (Hidden+Deprecated) <!-- R3, R4 -->
- [x] T004 Add the shared explicit-`-L` reject guard in `app/backend/cmd/rk/mux.go` (helper checking the changed state of the inherited `--server` flag → `usageError`) and wire it into the reap/snapshot-subcommand/init-conf RunEs; pre-wrap family-member `Args` with `usageArgs` <!-- R5, R8 -->
- [x] T005 [P] Hide `shell-init`: `Hidden: true` in `app/backend/cmd/rk/shell_init.go` `newShellInitCmd()` <!-- R6 -->
- [x] T006 Update `app/backend/cmd/rk/mux.go` Short/Long + header comment for five-member family and `-L` scope note; update `app/backend/cmd/rk/root.go` registrations (drop three direct roots, add three aliases; family members register on `muxCmd`) with the alias comment mirroring the agent-family one <!-- R7 -->

### Phase 2: Tests & Sweeps

- [x] T007 Update `app/backend/cmd/rk/reaper_test.go`: retarget to `rk mux reap`; add alias tests (`rk reaper` runs + deprecation pointer, exit codes identical) and the `-L` reject test <!-- R1, R4, R5 -->
- [x] T008 Update `app/backend/cmd/rk/snapshot_test.go`: retarget to `rk mux snapshot …`; alias tests for `rk snapshot list/show/restore` (run + notice); `-L` reject test <!-- R2, R4, R5 -->
- [x] T009 [P] Add/extend init-conf coverage: `rk mux init-conf` writes via cmd writer; alias runs with notice <!-- R3, R4 -->
- [x] T010 Update `app/backend/cmd/rk/help_dump_test.go` (mux = exactly 5 members incl. snapshot's 3 children; `reaper`/`snapshot`/`init-conf`/`shell-init` absent from root) and `shell_init_test.go`/`root_test.go` (hidden but executable) <!-- R6, R8 -->
- [x] T011 [P] Comment/string sweep: `app/backend/internal/tmux/reaper.go:109`, `app/backend/internal/tmux/tmux.go:2110`, `app/backend/api/servers.go:31,34` (`rk reaper` → `rk mux reap`); README.md command-table row `run-kit init-conf` → `run-kit mux init-conf` <!-- R1, R3 -->

### Phase 3: Conformance & Verification

- [x] T012 Run `shll standards`; read the standards governing the touched surfaces (principles, help-dump, readme-extraction, skill) and conform; audit `docs/site/skill.md` + `docs/site/skill/mux.md` topic pages (expect no agent-facing change; sync via `scripts/sync-skill.sh` if edited); run `cd app/backend && go test ./...` and `just build` <!-- R8 -->

## Execution Order

- T001–T003 are independent of each other but T004 and T006 touch `mux.go`/`root.go` shared with them — do T001–T004+T006 as one coherent pass before tests.
- T005, T011 are independent ([P]).
- T012 last (audits the finished surface).

## Acceptance

### Functional Completeness

- [x] A-001 R1: `rk mux reap` (bare, `--yes`, `--force`, `--all`, `--dry-run`, `--prefix`) behaves identically to the old `rk reaper`, proven by the migrated test suite
- [x] A-002 R2: `rk mux snapshot list|show|restore` behave identically to the old root forms (flags, validation, rendering, exit codes)
- [x] A-003 R3: `rk mux init-conf` scaffolds tmux.conf + tmux.d with unchanged semantics, printing via the cmd writer
- [x] A-004 R4: all three old root forms still run (hidden, deprecated) with identical output/exit codes plus the deprecation pointer, including `rk snapshot <sub>` paths
- [x] A-005 R6: `shell-init` is hidden from `rk -h` and help-dump but `rk shell-init zsh|bash` emits completion exactly as before

### Behavioral Correctness

- [x] A-006 R5: `rk mux -L foo reap` (and snapshot/init-conf equivalents) exits 2 with a usage error naming `--server`; `rk mux send/await -L` behavior unchanged
- [x] A-007 R7: `rk mux -h` lists the five members with accurate short descriptions; stale "future work" header comment gone

### Scenario Coverage

- [x] A-008 R8: help-dump JSON asserts the mux subtree (5 members, snapshot's 3 children) and the absence of `reaper`/`snapshot`/`init-conf`/`shell-init` at root, via updated `help_dump_test.go`
- [x] A-009 R4: deprecation-notice tests prove the pointer prints on stderr-equivalent (cobra OutOrStderr) for each alias form while stdout data is unchanged

### Edge Cases & Error Handling

- [x] A-010 R8: family members under `mux` carry `usageArgs`-wrapped validators — an arg-count violation on `rk mux snapshot show` (no arg) exits 2, not 1

### Code Quality

- [x] A-011 Pattern consistency: constructors mirror `newAgentSetupCmd` (naming, per-instance flags, deprecated block); no bare `fmt.Printf` in touched RunEs; no shell strings (Constitution §I untouched paths)
- [x] A-012 No unnecessary duplication: render helpers/seams shared, not duplicated per instance; no engine code copied
- [x] A-013 Comment hygiene: updated comments state constraints (single-parent, per-instance flags), no change-ID narration in code comments

### Conformance

- [x] A-014 R8: `shll standards` re-enumerated and the touched-surface standards checked; skill topic pages audited (and byte-equality drift guards green if synced); `go test ./...` and `just build` pass

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — the move removed its own superseded declarations in-diff (the package-level `reaperCmd`/`snapshotCmd`/`initConfCmd` command vars and their package-level flag vars); the hidden root aliases it leaves behind are deliberate deprecation keepers per R4, not discovered redundancy.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Constructor pattern + Hidden/Deprecated alias mechanism per Part 2 precedent | `newAgentSetupCmd` is the in-package worked example; intake assumption 1–2 | S:90 R:85 A:95 D:90 |
| 2 | Confident | `-L` reject guard implemented as one shared helper on `mux.go` checking the flag's Changed state | Single source; `muxServerFlag != ""` alone can't distinguish explicit-empty, `Changed` can | S:70 R:90 A:85 D:75 |
| 3 | Confident | Deprecation notice on `rk snapshot <sub>`: verify cobra's behavior in tests; add `Deprecated` to alias children only if the parent notice doesn't surface | Cobra fires `Deprecated` on the executed command; the test proves whichever shape ships | S:60 R:90 A:80 D:70 |
| 4 | Confident | Skill topic pages expected unchanged; only `mux.go` help text describes the grown family | Topic pages are agent capability briefings; reap/snapshot/init-conf are operator verbs (toolkit-standards memory: bundle edits trip drift guards for no standard-mandated gain) | S:65 R:90 A:80 D:70 |

4 assumptions (1 certain, 3 confident, 0 tentative).

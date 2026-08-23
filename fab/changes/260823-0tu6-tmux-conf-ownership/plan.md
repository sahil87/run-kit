# Plan: tmux.conf Ownership (Config Phase 4)

**Change**: 260823-0tu6-tmux-conf-ownership
**Intake**: `intake.md`

## Requirements

### tmux Config: Managed Ownership

#### R1: Hash-stamped managed header
Every rk write of the managed tmux.conf SHALL produce a file whose first line is
`# rk-managed sha256:<hex> — DO NOT EDIT; overrides go in ~/.config/run-kit/tmux.d/`
where `<hex>` is the SHA-256 lowercase-hex digest of the body (everything after the header line). The header format MUST be a named constant in `internal/tmux`.

- **GIVEN** rk writes the managed file (ensure, force-write, or init-conf)
- **WHEN** the file lands on disk
- **THEN** line 1 is the managed header and the stamp equals SHA-256(body)

#### R2: Three-state classification
A pure function SHALL classify the on-disk managed file against the current embed into exactly: `missing` (stat NotExist), `managed` with sub-result current/stale (header present AND body hashes to its own stamp; stale when body ≠ embed body), or `hand-edited` (no header, or hash mismatch). The classifier MUST NOT read anything but the file content and the embed.

- **GIVEN** a file whose body was edited after rk wrote it (stamp no longer matches)
- **WHEN** classified
- **THEN** the result is `hand-edited`
- **AND** a pristine rk-written file whose body differs from a newer embed classifies `managed & stale`

#### R3: Refresh at daemon start only
`tmux.EnsureConfig()` (called from `cmd/rk/serve.go` before the supervisor starts) SHALL implement the three-state refresh: missing → write header+embed; managed & stale → force-write header+new embed; managed & current or hand-edited → leave the file untouched. There MUST be no timer, watcher, or any other refresh trigger. When the resolved config path is not `DefaultConfigPath` (the `tmux_conf` key or `RK_TMUX_CONF` is set), EnsureConfig SHALL perform no ensure/refresh at all ("you own everything" mode).

- **GIVEN** a managed & stale file at the default path
- **WHEN** the daemon starts
- **THEN** the file is force-written with the current embed and the reload sweep runs
- **AND** given `tmux_conf` set to a custom path, WHEN the daemon starts, THEN no file is written anywhere

#### R4: Live-only reload sweep
After (and only after) a stale→force-write transition, the reload sweep SHALL enumerate servers via `tmux.ListServers` (live-socket-probed — a tmux command on a dead socket resurrects a server) and call `tmux.ReloadConfig(server)` for each. Per-server failures SHALL log and continue; the sweep MUST never fail daemon start. The enumeration and reload MUST ride injectable seams so tests prove dead sockets are never touched.

- **GIVEN** live servers A,B and a dead socket C in the socket dir
- **WHEN** the sweep runs after a force-write
- **THEN** ReloadConfig is invoked for A and B only
- **AND** an error reloading A does not prevent B's reload nor fail startup

### tmux Config: Path Migration (Migration 2)

#### R5: New default path + embed drop-in path
`DefaultConfigPath` SHALL become `$HOME/.config/run-kit/tmux.conf` (same fixed-root rule as `settings.Dir()` — `$HOME` only, no XDG env), with the drop-in dir at `$HOME/.config/run-kit/tmux.d/`. The embed (`configs/tmux/default.conf`) SHALL source `~/.config/run-kit/tmux.d/*.conf` and its comments SHALL name the new paths; no tmux option/behavior content changes.

- **GIVEN** `XDG_CONFIG_HOME=/elsewhere` and `HOME=/test/home`
- **WHEN** the default config path is resolved
- **THEN** it is `/test/home/.config/run-kit/tmux.conf`

#### R6: Old-path migration, never clobbering
On ensure at the default path, old `~/.rk/tmux.d/*.conf` drop-ins SHALL be moved into the new `tmux.d/` (existing same-name files at the new path win — never overwritten) and the old dir breadcrumbed (renamed `tmux.d.migrated`), best-effort and never fatal. An old `~/.rk/tmux.conf` SHALL be breadcrumb-renamed (`tmux.conf.migrated`) only when byte-equal to the current embed; any other content (old-embed pristine or hand-edited — pre-header files are indistinguishable) SHALL be left untouched, surfaced only by the doctor recipe. Hand-edited confs are NEVER auto-migrated.

- **GIVEN** an old `~/.rk/tmux.conf` differing from the current embed
- **WHEN** the daemon starts post-upgrade
- **THEN** the new managed file is written at the new path, the old file is untouched, and doctor names the old path with the recipe

### tmux Config: Override Scaffold

#### R7: user.conf scaffold in every scaffold path
Every scaffold path — `EnsureConfig`, `ForceWriteConfig`, `rk mux init-conf` (both cobra instances), `POST /api/tmux/init-conf` — SHALL ensure `tmux.d/` exists and scaffold `tmux.d/user.conf` as a commented starter (purpose, commented example, pointer to `10-*.conf` numeric ordering) when absent. An existing `user.conf` MUST never be overwritten, including under `--force`.

- **GIVEN** a user with customizations in `tmux.d/user.conf`
- **WHEN** `rk mux init-conf --force` runs
- **THEN** the managed tmux.conf is rewritten and `user.conf` is byte-identical to before

### Doctor

#### R8: Informational drift row
`rk doctor` SHALL gain a `tmux config` row that never flips the overall verdict (OK-with-note posture, mirroring the ephemeral/drift rows): managed & current → note; managed & stale → note naming the daemon-start refresh; hand-edited → note carrying the migration recipe (move customizations to `~/.config/run-kit/tmux.d/user.conf`, then `rk mux init-conf --force`); un-migrated old `~/.rk/tmux.conf` present → same recipe naming the old path; `tmux_conf`/`RK_TMUX_CONF` set → "user-owned (tmux_conf set)" with no drift analysis.

- **GIVEN** a hand-edited managed file
- **WHEN** `rk doctor` runs
- **THEN** the row is `[ OK ]` with the recipe note and the exit code is unaffected

### CLI Copy & Docs

#### R9: init-conf copy
`init-conf`'s `Short`/success output SHALL name the new path and `user.conf` as the override home; the already-exists error SHALL state the recipe (not just "use --force"); `--force` help SHALL be scoped to the managed file ("overrides in tmux.d/ are untouched"). Both cobra instances and the API handler ride the same shared write path.

- **GIVEN** an existing managed tmux.conf
- **WHEN** `rk mux init-conf` runs without `--force`
- **THEN** the error names `tmux.d/user.conf` for overrides and `--force` for refreshing the managed file

#### R10: Layered docs with the history-limit caveat
README's init-conf row SHALL be updated (new path, user.conf); docs/site SHALL gain a "Customizing tmux" section covering the managed header, `user.conf`, `10-*.conf` ordering, the `tmux_conf` opt-out, and refresh-on-daemon-start. Every place the refresh is mentioned (doctor note, docs section, README if applicable) SHALL carry the caveat: `history-limit`-class options apply only to panes created after reload. Doc surfaces MUST be checked against `shll standards` before ship (Constitution: Toolkit Standards).

- **GIVEN** the docs/site section
- **WHEN** a reader follows the refresh description
- **THEN** the pane-creation caveat is stated alongside it

### Non-Goals

- No timer/watcher refresh; no web-app tmux surface (plan non-goals).
- No new override mechanism — `tmux.d/` promoted, not replaced.
- No tmux option/behavior changes in the embed (path lines only).
- No removal of `~/.rk/` itself (other tenants remain: push store, code-server dirs, job logs).
- No changes to `ReloadConfig`'s own mechanics or the `tmux_conf`/`RK_TMUX_CONF` resolution chain (Phase 1 landed those).

### Design Decisions

#### Hash-stamped header as the ownership declaration
**Decision**: ownership and staleness are derived from a SHA-256 stamp in the file's own first line; the three-state check is a pure local computation against the embed.
**Why**: no version registry, no timestamps, no extra state file (Constitution II — derive from the filesystem); "did the user edit this?" becomes deterministic and testable.
**Rejected**: a version marker (stale detection breaks when the embed changes without a version bump); mtime heuristics (false positives on copy/touch); a sidecar state file (a second source of truth to drift).
*Introduced by*: 260823-0tu6-tmux-conf-ownership

#### Byte-equal embed test for pre-header migration
**Decision**: an old `~/.rk/tmux.conf` is auto-breadcrumbed only when byte-equal to the current embed; everything else is hands-off with a doctor recipe.
**Why**: pre-header files carry no stamp, so managed-ness is unprovable; byte-equality with the current embed is the only zero-false-positive detector, and false positives here destroy user edits.
**Rejected**: comparing against historical embeds (rk does not archive them); auto-migrating any old file (violates the never-clobber rule).
*Introduced by*: 260823-0tu6-tmux-conf-ownership

#### Sweep only on an actual force-write
**Decision**: the reload sweep fires only on the managed-stale → force-write transition, not on every daemon start.
**Why**: reloading unchanged config is wasted tmux traffic across every live server, and the sweep's only purpose is propagating a refresh that just happened.
**Rejected**: unconditional sweep at start (noise, and touches servers for nothing); sweeping on missing→write (a fresh file means no server was started with older content by rk's `-f` — new servers pick it up at creation).
*Introduced by*: 260823-0tu6-tmux-conf-ownership

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/backend/internal/tmux/managedconf.go`: header-format constant + builder, `sha256` body hashing, the pure three-state classifier (`missing` / `managed{current,stale}` / `hand-edited`), and a managed-write helper (header + embed body). <!-- R1, R2 -->
- [x] T002 [P] Update `configs/tmux/default.conf`: drop-in comment + `source-file` line (lines 94-96) to `~/.config/run-kit/tmux.d/`, fix the stale `~/.run-kit/` comment (line 3). Sync `app/backend/build/tmux.conf` the way `just setup`/`scripts/dev.sh` stages it. No option/behavior changes. <!-- R5 -->

### Phase 2: Core Implementation

- [x] T003 Flip `DefaultConfigPath` to `$HOME/.config/run-kit/tmux.conf` in `internal/tmux/tmux.go` `init()` (mirror `settings.Dir()`'s fixed-root construction); drop-in dir follows via `ensureDropInDir`. <!-- R5 -->
- [x] T004 Rewrite `tmux.EnsureConfig()` as the three-state refresh: gate to `configPath == DefaultConfigPath` (else no-op), classify via T001, write on missing, force-write on stale; return a `refreshed bool` so the caller knows to sweep. Managed writes carry the header (T001 helper). <!-- R3, R1 -->
- [x] T005 Migration 2 inside the ensure path (`internal/tmux/managedconf.go`): move `~/.rk/tmux.d/*.conf` to the new `tmux.d/` (skip names already present), rename old dir `tmux.d.migrated`; breadcrumb-rename old `~/.rk/tmux.conf` → `tmux.conf.migrated` only when byte-equal to the current embed. All best-effort, never fatal. <!-- R6 -->
- [x] T006 Reload sweep in `internal/tmux`: `RefreshSweep`-style func over injectable seams (`ListServers`, per-server `ReloadConfig`), log-and-continue; wire `cmd/rk/serve.go` (the `EnsureConfig` call at :120) to run it only when EnsureConfig reports a stale force-write. <!-- R4 -->
- [x] T007 Route every scaffold path through the shared managed write + `user.conf` starter scaffold (create-if-absent only): `ForceWriteConfig`, `cmd/rk/initconf.go` (both instances — replace its private WriteFile with the shared path), `POST /api/tmux/init-conf` (rides ForceWriteConfig). <!-- R7, R1 -->

### Phase 3: Integration & Edge Cases

- [x] T008 Doctor `tmux config` row in `cmd/rk/doctor.go`: never-FAIL note over the five states (current / stale / hand-edited+recipe / old-path-present+recipe / tmux_conf-set), reusing the T001 classifier; seams for tests per the `tmuxServerList` pattern. <!-- R8 -->
- [x] T009 [P] Unit tests (table-driven) for the three-state classifier in `internal/tmux/managedconf_test.go`: missing / managed-current / managed-stale / no-header / hash-mismatch → classification + write/no-write behavior; header format + stamp correctness. <!-- R2, R1 -->
- [x] T010 [P] Unit tests for the sweep: stubbed enumeration returns live subset → only those reloaded; one server erroring does not abort the rest; no sweep when EnsureConfig reported no refresh. <!-- R4 -->
- [x] T011 Extend `cmd/rk/initconf_test.go` + `cmd/rk/doctor_test.go`: new-path copy, `user.conf` scaffolded and never overwritten (incl. `--force`), already-exists error carries the recipe, drift-row states. <!-- R7, R8, R9 -->

### Phase 4: Polish

- [x] T012 CLI copy pass on `cmd/rk/initconf.go`: `Short` names the new path; success output names `user.conf`; `--force` help scoped to the managed file. <!-- R9 -->
- [x] T013 Docs: update `README.md:304` init-conf row; add docs/site "Customizing tmux" section (managed header, user.conf, `10-*.conf` ordering, `tmux_conf` opt-out, daemon-start refresh + history-limit caveat); verify against `shll standards` for the touched surfaces. <!-- R10 -->

## Execution Order

- T001 blocks T004, T005, T007, T008, T009
- T003 blocks T004 (path must exist before the gate compares against it)
- T004 blocks T005, T006
- T002 is independent (config text only)
- T009/T010 parallel after their subjects land

## Acceptance

### Functional Completeness

- [x] A-001 R1: Every rk write path produces the header-stamped file; the stamp verifies against the body — `writeManagedConfig` (managedconf.go:99) is the only write path (EnsureConfig/ForceWriteConfig/init-conf all ride it); TestManagedConfigBytesStampVerifies round-trips the stamp
- [x] A-002 R2: The classifier returns the correct state for all five fixture shapes (missing, current, stale, no-header, hash-mismatch) — TestClassifyManagedConf (7 cases) + TestClassifyConfigFile (missing); all pass
- [x] A-003 R3: Daemon start refreshes a stale managed file, leaves current and hand-edited files untouched, and does nothing when `tmux_conf`/`RK_TMUX_CONF` is set — TestEnsureConfigThreeState (4 subtests); the user-owned gate (`!managedConfigPath`, tmux.go:154) is covered only indirectly (doctor seam test) — see should_fix finding
- [x] A-004 R4: The sweep reloads exactly the live-enumerated servers, tolerates per-server errors, and runs only after a force-write — TestRefreshSweep (3 subtests); serve.go:126-131 gates the sweep on `refreshed`
- [x] A-005 R5: `DefaultConfigPath` is the new fixed-root path; the embed sources the new tmux.d/ path — tmux.go:98 `$HOME/.config/run-kit/tmux.conf`; default.conf:98 + TestDefaultConfigContainsSourceDirective; `build/tmux.conf` embed copy verified byte-identical
- [x] A-006 R6: Old drop-ins are moved with breadcrumbs; an old non-byte-equal tmux.conf is never touched — TestMigrateLegacyConfPaths (3 subtests) all pass
- [x] A-007 R7: All four scaffold paths create `user.conf` when absent; none overwrites it — EnsureConfig/ForceWriteConfig scaffold via scaffoldUserConf; init-conf rides ForceWriteConfig; the API handler rides ForceWriteConfig (api/tmux_config.go:22); TestEnsureConfigScaffoldsUserConf proves never-overwrite under --force
- [x] A-008 R8: Doctor shows the correct note per state and never fails the verdict — TestTmuxConfigCheckStates (7 subtests incl. all five states) + TestTmuxConfigCheckNeverFlipsVerdict
- [x] A-009 R9: init-conf copy (Short/success/error/`--force` help) matches R9 — initconf.go:24,37,45-46,50; initconf_test asserts the Overrides line and recipe error
- [x] A-010 R10: README + docs/site section exist with the history-limit caveat — README.md:304; docs/site/customizing-tmux.md (managed header, user.conf, 10-*.conf ordering, tmux_conf opt-out, daemon-start refresh + pane-creation caveat at :30); checked against `shll standards readme-extraction` (closed-set links, no reserved name)

### Behavioral Correctness

- [x] A-011 R3: `EnsureConfig` no longer writes when a hand-edited file exists (previously: only-if-missing semantics — verify no regression to clobbering) — "hand-edited is left untouched" subtest proves byte-identical survival
- [x] A-012 R6: A same-name drop-in already at the new path wins over the old-path copy (no overwrite during move) — conflict subtest: new user.conf content wins over legacy

### Scenario Coverage

- [x] A-013 R2: Three-state unit tests exist and pass (`internal/tmux/managedconf_test.go`) — `go test -count=1 ./internal/tmux/` ok
- [x] A-014 R4: Live-socket sweep unit tests exist and pass — TestRefreshSweep: stubbed enumeration returns only live servers; dead sockets never touched
- [x] A-015 R7: init-conf `--force` test proves `user.conf` survives byte-identical — TestEnsureConfigScaffoldsUserConf drives ForceWriteConfig (the --force path) and compares bytes

### Edge Cases & Error Handling

- [x] A-016 R4: A sweep enumeration failure logs and startup continues — "enumeration error reloads nothing" subtest; RefreshSweep returns without error
- [x] A-017 R6: Migration failures (rename/move errors) degrade best-effort — daemon start never fails on them — migrateLegacyConfPaths returns nothing; every failure path slog.Warns and continues
- [x] A-018 R3: Empty/whitespace-only existing file classifies hand-edited (no header) and is left alone — "empty file" and "whitespace only" classifier cases

### Code Quality

- [x] A-019 Pattern consistency: managedconf follows internal/tmux idioms (package vars as seams, `exec.CommandContext` untouched paths, named constants for header format) — sweepListServers/sweepReloadConfig seams mirror doctor's tmuxServerList; header prefix/suffix are named constants
- [x] A-020 No unnecessary duplication: initconf.go/api reuse the shared write path instead of parallel WriteFile logic; classifier shared by ensure + doctor — initconf.go's private WriteFile/MkdirAll block deleted in favor of ForceWriteConfig; ClassifyConfigFile shared by EnsureConfig and tmuxConfigCheck
- [x] A-021 Tests included: new behavior covered by unit tests (code-quality principle: features MUST include tests) — managedconf_test.go (365 lines) + doctor_test/initconf_test extensions
- [x] A-022 Comment discipline: comments state constraints (why live-only enumeration, why byte-equal only), no narration or change-ID citations — comments state invariants (hash contract, never-clobber, live-socket load-bearing); no change-ID citations in new code

### Security

- [x] A-023 R4: No shell strings — sweep/reload go through existing `tmuxExecServer` with context timeouts; file writes use 0o644 like siblings — sweep rides existing ListServers/ReloadConfig; serve.go wraps the sweep in a 30s context; writeManagedConfig/scaffoldUserConf use 0o644

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `cmd/rk/initconf.go` — the private `os.MkdirAll`/`os.WriteFile` scaffold block was replaced by the shared `tmux.ForceWriteConfig()` path (already deleted in this diff; listed for completeness — nothing further to remove)
- None beyond the above — this change adds new ownership/migration machinery without leaving other existing code redundant (`~/.rk/` itself stays: other tenants remain per the non-goals)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `EnsureConfig` gains a `refreshed bool` return (signature change) so serve.go decides the sweep; alternative out-param/callback shapes rejected as un-idiomatic | Smallest seam giving the caller the transition fact; one caller exists (serve.go) plus tests | S:70 R:85 A:85 D:75 |
| 2 | Confident | user.conf starter content: comment block naming purpose + `10-*.conf` ordering + one commented `set -g` example — exact prose is implementer's choice | Intake fixes the shape (commented starter), not the prose | S:65 R:90 A:85 D:80 |
| 3 | Certain | The em-dash and path text in the header constant match the plan string exactly; the stamp is over bytes after the first newline | Plan verbatim; byte-precision needed for a hash contract | S:85 R:80 A:90 D:85 |
| 4 | Confident | `build/tmux.conf` (the embed copy) is updated in the same commit so dev builds and release builds agree; the staging scripts keep copying from `configs/tmux/default.conf` | context.md documents the copy flow (`just setup` stages it); divergence would fail the stamp test | S:70 R:85 A:80 D:80 |
| 5 | Confident | Doctor's old-path state reads `~/.rk/tmux.conf` existence directly (no migration attempted from doctor — read-only diagnosis) | Doctor rows are read-only by posture | S:70 R:90 A:85 D:85 |

5 assumptions (1 certain, 4 confident, 0 tentative).

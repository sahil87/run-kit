# Plan: GUI display block — relocatable body, per-machine pointer

**Change**: 260910-r7v8-gui-display-block-relocatable
**Intake**: `intake.md`

## Requirements

### run-kit: gui display block body

#### R1: The block body is host-independent
The `rk gui display` marker-owned block written by `rk agent setup` into the shell startup files
(`tmuxGuardStartupFiles`) MUST be a constant with no interpolated host path. Its body SHALL be
exactly:

```sh
# >>> rk gui display >>>
[ -n "$TMUX_PANE" ] && [ -z "${DISPLAY-}" ] && [ -x "$HOME/.local/share/rk/bin/run-kit" ] && eval "$("$HOME/.local/share/rk/bin/run-kit" gui env 2>/dev/null)"
# <<< rk gui display <<<
```

The marker lines MUST NOT change. The pointer path in the block MUST be composed from the same
constant the Go side uses (`rkBinRelDir = ".local/share/rk/bin"`), so the two can never disagree.

- **GIVEN** two homes, one installed with `rkPath=/opt/homebrew/bin/run-kit` and one with
  `rkPath=/home/linuxbrew/.linuxbrew/bin/run-kit`
- **WHEN** `rk agent setup` installs the gui display block into each
- **THEN** the resulting `.zshenv` contents are byte-identical
- **AND** a second install on either home reports `gui display: block already present` and writes nothing

- **GIVEN** a startup file carrying the old block body (an absolute rk path between the same markers)
- **WHEN** the new install runs
- **THEN** the block is replaced in position with the constant body (one write), and the next run is a no-op

### run-kit: per-machine pointer

#### R2: A pointer symlink carries the per-machine rk path
`rk agent setup` (install) MUST maintain a symlink at `$HOME/.local/share/rk/bin/run-kit` whose
target is the `resolveRkPath`/`validateHookPath`-validated absolute rk path. The `bin` directory
MUST NOT be added to `PATH` by anything rk installs.

- **GIVEN** no file at the pointer path
- **WHEN** install runs with consent
- **THEN** `bin/` is created (0755) **after** consent and the symlink is created atomically (temp
  symlink in the same directory + rename) with `Readlink == rkPath`
- **AND** the chatter reports `gui display: linked <linkPath> -> <rkPath>.`

- **GIVEN** a symlink at the pointer path whose target already equals `rkPath`
- **WHEN** install runs
- **THEN** it is a reported no-op (`gui display: pointer already links … — nothing to do.`) with no write

- **GIVEN** a symlink at the pointer path with a different (or dangling) target
- **WHEN** install runs with consent
- **THEN** the proposal wording contains `relink` and names the current target, and the link is
  replaced atomically

- **GIVEN** a regular file or directory at the pointer path
- **WHEN** install runs
- **THEN** it is left untouched with the note `… exists and is not a symlink — leaving it untouched (rk only replaces pointers it owns).`
- **AND** the pointer is reported not in place

#### R3: The block gates on its own pointer
The block upsert SHALL run only when the pointer is **in place** (freshly linked, already current, or
a dry-run previewing the link). On a declined pointer write or a foreign non-symlink file the block
step SHALL be skipped with the chatter note `gui display: skipping the startup-file block (the pointer is not in place).`
A foreign non-symlink SHALL additionally strip any existing gui block from the startup files (the
uninstall flow), since a retained block would exec the foreign file; a declined write leaves an
existing block alone (the pointer there is still an rk-owned symlink). The write SHALL re-probe the
pointer path immediately before replacing it and refuse a non-symlink that appeared meanwhile.
The block remains independent of the tmux shim's outcome.

- **GIVEN** a foreign regular file at the pointer path
- **WHEN** install runs
- **THEN** no startup file receives the gui display block

- **GIVEN** the pointer consent is declined (`n`)
- **WHEN** install runs
- **THEN** no startup file receives the block and the skip note is printed

- **GIVEN** a foreign marker-less tmux shim (so the PATH block is skipped)
- **WHEN** install runs with consent
- **THEN** the gui display block **is** written and the pointer **is** created

#### R4: Consent, dry-run, and non-TTY behavior
The pointer link/relink and removal MUST go through `cons.authorizeWrite` like every other
`rk agent setup` artifact: interactive prompt by default, silent under `--yes`, nothing written
under `--dry-run` (dry-run notes: `gui display: dry run — <linkPath> not written.` on install,
`gui display: dry run — pointer left in place (nothing removed).` on uninstall).

- **GIVEN** `--dry-run`
- **WHEN** install runs on a fresh home
- **THEN** neither `bin/` nor the symlink exists afterwards, no startup file is created, and both the
  pointer dry-run note and the per-file block diff are printed

#### R5: Uninstall removes the pointer it owns
`rk agent setup --uninstall` MUST strip the blocks first (unchanged flow) and then, if a symlink
exists at the pointer path, propose `Remove <linkPath>? [y/N]`, remove it on consent, and
best-effort prune the empty `bin` directory (`os.Remove` on the dir — refuses non-empty, and only when
the dir is a real directory, never a user's symlink). A
non-symlink at the path is left untouched with a note. An absent pointer is silent. A declined
pointer removal never skips the block strip and vice versa.

- **GIVEN** an installed pointer and block
- **WHEN** uninstall runs with consent
- **THEN** the symlink and `bin/` are gone, user content in the startup files is byte-identical to before install
- **AND** a second uninstall prints nothing about gui display

### run-kit: documentation

#### R6: Memory reflects the new artifact shape
`docs/memory/run-kit/gui.md` and `docs/memory/run-kit/agent-state.md` MUST describe the constant
block body, the pointer symlink (path, ownership, atomic replace, off-PATH rule), the pointer gating,
and the install/uninstall ordering; `gui.md` MUST carry a Design Decision recording the synced-file
relocatability rule with the two rejected alternatives. (Hydrate performs this; the apply task keeps
code comments consistent so hydrate can lift them.)

- **GIVEN** the hydrated memory
- **WHEN** a reader looks up the gui display block body
- **THEN** it matches the constant in `agent_setup.go` exactly and no `<abs-rk>` placeholder remains in that block

### Non-Goals
- No `rk doctor` row for the pointer — recorded as a backlog candidate in the intake.
- No change to `resolveRkPath`, `validateHookPath`, the tmux guard shim/PATH block, or the per-agent
  hook installers (which still embed the absolute path by design).
- No change to `docs/site/skill/gui.md` / `cmd/rk/skill/gui.md` (already path-free; drift-guarded).

### Design Decisions

#### Synced startup files carry only relocatable content
**Decision**: the gui display block is a `$HOME`-relative constant; the per-machine absolute rk path
lives in a symlink under `~/.local/share/rk/bin/`, an unsynced per-machine location.
**Why**: `~/.zshenv`/`~/.bashrc` are commonly dotfile-synced across hosts with different Homebrew
prefixes; a block embedding the host path can never converge, so every `shll update` re-prompts on
every host. The tmux guard already splits this way (relocatable PATH block, per-machine shim under
`~/.local/share/rk/shims/`).
**Rejected**: per-OS marker blocks with a `uname` gate (keeps a per-machine fact in a synced file;
two same-OS hosts with different prefixes still fight; doubles the marker surface); resolving via
`command -v run-kit` at read time (reintroduces the PATH dependency `resolveRkPath` exists to remove —
`.zshenv` runs before Homebrew's `shellenv` on macOS).
*Introduced by*: 260910-r7v8-gui-display-block-relocatable

#### The pointer directory stays off PATH
**Decision**: the pointer lives in `~/.local/share/rk/bin/`, a sibling of `shims/`, and nothing rk
installs prepends it to `PATH`.
**Why**: `resolveRkPath` prefers `exec.LookPath("run-kit")`; a pointer on PATH would resolve to itself
on the next re-run and the symlink would loop.
**Rejected**: dropping the pointer into the existing `shims/` dir (already on PATH — exactly the
self-resolution hazard).
*Introduced by*: 260910-r7v8-gui-display-block-relocatable

#### The block gates on its own pointer, mirroring PATH-block ↔ shim
**Decision**: the block is written only when the pointer is in place (fresh, current, or dry-run preview).
**Why**: a block that execs `$HOME/.local/share/rk/bin/run-kit` in front of a foreign file would run a
non-rk executable from every pane shell's startup; in front of nothing it is silently inert.
**Rejected**: writing the block unconditionally (today's posture, safe only while the block embedded
the validated path itself).
*Introduced by*: 260910-r7v8-gui-display-block-relocatable

## Tasks

### Phase 1: Core Implementation

- [x] T001 Add `rkBinRelDir = ".local/share/rk/bin"` beside `rkShimsRelDir` in `app/backend/cmd/rk/tmux_guard.go` and `rkBinDir(home)`/`guiRkPointerPath(home)` helpers; replace `guiDisplayBlock(rkPath)` in `app/backend/cmd/rk/agent_setup.go` with the constant block body (R1) composed from `rkBinRelDir`, rewriting its doc comment (guards, relocatability rule, off-PATH rule) <!-- R1 -->
- [x] T002 Add `installGuiDisplayPointer`/`removeGuiDisplayPointer` in `app/backend/cmd/rk/agent_setup.go` (Lstat/Readlink ownership, consent via `authorizeWrite`, post-consent `MkdirAll`, atomic temp-symlink + rename, relink wording, foreign-file skip, dir prune on uninstall) and wire them into `applyGuiDisplayBlocks`: install → pointer then gated block upsert; uninstall → block strip then pointer removal; update the `runAgentSetup` call-site comment <!-- R2 R3 R4 R5 -->

### Phase 2: Tests

- [x] T003 Update the existing gui display tests in `app/backend/cmd/rk/agent_setup_test.go` (helper `installGuiDisplayBlock` creates the pointer; constant-body assertions; `TestGuiDisplayBlockIndependentOfShim` also asserts the pointer) and add: two-host byte-identical regression + idempotent re-run (R1), fresh-install symlink (R2), relink (R2), foreign file skips block (R3), declined pointer skips block (R3), dry-run writes nothing (R4), uninstall removes link + prunes dir + second uninstall silent (R5); run `just test-backend` <!-- R1 R2 R3 R4 R5 -->

### Phase 3: Polish

- [x] T004 Reconcile code comments and the `rk agent setup --help`/`rk gui env --help` text (if either names the block's mechanics) with the new shape so hydrate can lift them into `docs/memory/run-kit/gui.md` and `agent-state.md` (R6); `gofmt`/`go vet` clean <!-- R6 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `guiDisplayBlock` is a constant whose body matches the intake exactly, with unchanged marker lines, and the shell path is composed from `rkBinRelDir` (via `guiPointerShellPath`; `TestGuiDisplayBlockText` pins the body byte-for-byte)
- [x] A-002 R2: Install creates `~/.local/share/rk/bin/run-kit` as a symlink to the validated rk path, atomically (`replaceSymlink`: temp symlink + rename), with `bin/` `MkdirAll`'d only after consent (`agent_setup.go:1710`)
- [x] A-003 R3: The block upsert runs only when the pointer is in place; the skip note is printed otherwise (`applyGuiDisplayBlocks` gate, `agent_setup.go:1646-1649`)
- [x] A-004 R4: Pointer link/relink/remove go through `authorizeWrite`; `--dry-run` writes nothing and prints the documented notes (install `… not created.`, uninstall `… pointer left in place (nothing removed).`)
- [x] A-005 R5: Uninstall strips blocks, removes the rk-owned symlink, prunes the empty dir, leaves non-symlinks alone, and is silent when absent (`removeGuiDisplayPointer`; covered by `TestGuiDisplayBlockUninstallRemovesExactly` + `TestGuiDisplayForeignPointerSkipsBlock`)
- [x] A-006 R6: Code comments describe the pointer/gating/relocatability so hydrate has a faithful source (doc comments on `guiDisplayBlock`, `guiPointerPath`, `applyGuiDisplayBlocks`, `installGuiDisplayPointer`)

### Behavioral Correctness

- [x] A-007 R1: Two homes installed with different rk paths produce byte-identical `.zshenv`; a re-run on either reports "block already present" with no write (`TestGuiDisplayBlockTwoHostsByteIdentical`)
- [x] A-008 R1: A startup file carrying the old absolute-path body is replaced in position on the first run and is a no-op on the second (`TestGuiDisplayBlockOldBodyReplacedInPosition`)
- [x] A-009 R2: An existing symlink with a stale target is relinked (wording includes `relink` and the old target); a current one is a no-op (`TestGuiDisplayPointerRelink`; no-op asserted in `TestGuiDisplayBlockIdempotentReinstall` via "pointer already links")

### Scenario Coverage

- [x] A-010 R3: A foreign marker-less tmux shim does not prevent the gui block or pointer install (`TestGuiDisplayBlockIndependentOfShim` — block written, `assertGuiPointer` passes)
- [x] A-011 R3: A foreign regular file at the pointer path leaves every startup file without the gui block (`TestGuiDisplayForeignPointerSkipsBlock`)

### Edge Cases & Error Handling

- [x] A-012 R2: A dangling symlink at the pointer path is treated as rk-owned and relinked (`TestGuiDisplayPointerRelink` uses a nonexistent target)
- [x] A-013 R5: A regular file at the pointer path on uninstall is left untouched with a note; block strip still runs (strip precedes pointer handling in `applyGuiDisplayBlocks`; note asserted in `TestGuiDisplayForeignPointerSkipsBlock`)
- [x] A-014 R4: Declining the pointer prompt leaves `bin/` uncreated and skips the block with the note (`TestGuiDisplayDeclinedPointerSkipsBlock`)

### Code Quality

- [x] A-015 Pattern consistency: new code follows the `applyTmuxShim`/`installTmuxShimFile`/`removeTmuxShimFile` shape (chatter vs data channels via `diffWriter`/`Notef`, `authorizeWrite` consent seam, dry-run preview reports "in place" like the shim)
- [x] A-016 No unnecessary duplication: reuses `readFileIfExists` (via the unchanged marker-block flow), `authorizeWrite`, `upsertMarkerBlock`/`removeMarkerBlock`, `markerBlockBounds`; no second marker-block implementation
- [x] A-017 Tests included: every new behavior has a `t.TempDir()`-scoped test with an injected rk path; `go vet ./cmd/rk && go test ./cmd/rk -count=1` passes
- [x] A-018 Comments state constraints the code cannot show (off-PATH rule, relocatability rule, gating rationale) and do not narrate or cite the change ID
- [x] A-019 No god functions: pointer install/remove are separate helpers under ~50 lines each

### Security

- [x] A-020 R3: A startup file never execs a non-rk file — the block is skipped whenever the pointer path holds anything but an rk-written symlink to the validated path (gate in `applyGuiDisplayBlocks`; `TestGuiDisplayForeignPointerSkipsBlock`, `TestGuiDisplayDeclinedPointerSkipsBlock`)
- [x] A-021 R2: The symlink target is the `validateHookPath`-validated path (validated at `agent_setup.go:629` before `runAgentSetup` proceeds); the block body contains no interpolated value (constant, byte-pinned by `TestGuiDisplayBlockText`)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — the change rewires the gui display block in place (the old `guiDisplayBlock(rkPath)` function became the `guiDisplayBlock` constant with no leftover); no other existing symbol, file, or branch becomes redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Pointer step lives inside `applyGuiDisplayBlocks` (call site in `runAgentSetup` unchanged) | Keeps the three-family structure the memory documents; only the comment at the call site changes | S:80 R:90 A:90 D:85 |
| 2 | Confident | Atomic replace = `os.Symlink(target, tmp)` + `os.Rename(tmp, link)` in the same dir, tmp named `.run-kit.tmp-<pid>` | Rename over a symlink is atomic on POSIX; the tmp name is unlikely to collide and is removed on any error | S:65 R:90 A:85 D:80 |
| 3 | Confident | Install ordering: pointer before block; uninstall ordering: blocks before pointer | Install must know the pointer is in place before writing the block (R3); uninstall strips the reference before the target so a shell starting mid-uninstall never execs a vanished path — the `-x` guard covers the window anyway | S:70 R:85 A:85 D:80 |
| 4 | Confident | Existing tests that passed `"/opt/homebrew/bin/rk"` as rkPath keep doing so; the value now only reaches the symlink target | Test paths are injected strings, never stat'd by the pointer step (the target is not verified at install — `validateHookPath` already did) | S:70 R:90 A:85 D:80 |

4 assumptions (1 certain, 3 confident, 0 tentative).

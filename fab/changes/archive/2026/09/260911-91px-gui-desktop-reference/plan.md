# Plan: GUI desktop reference — known-desktop table, missing picker rows, `rk gui wm --list`, site guide

**Change**: 260911-91px-gui-desktop-reference
**Intake**: `intake.md`

> The intake is the design authority — every requirement below traces to intake § What Changes (numbered 1–8) and the plan `fab/plans/sahil/26-09-11-gui-desktop-reference-and-toolbar.md` rows R-D1–R-D8. **Never run `rk gui wm … --restart`, `rk gui restart`, `rk gui on/off`, or install a desktop on the live host** — R1 has no manual acceptance on the live `rk-gui` session.

## Requirements

### GUI backend: the known-desktop table

#### R1: Three more known session starters, labels, and aliases
`internal/gui/candidates.go` `sessionStarterOrder` MUST be exactly `startlxqt, lxqt-session, startxfce4, xfce4-session, startplasma-x11, startlxde, mate-session, cinnamon-session, x-session-manager`. `WMCandidateLabel` MUST return `Plasma` for `startplasma-x11`, `LXDE` for `startlxde`, `MATE` for `mate-session`, `Cinnamon` for `cinnamon-session` (existing labels unchanged; `x-session-manager` keeps its raw name). `cmd/rk/gui_wm.go` `guiWMAliases` MUST gain `lxde → startlxde`, `mate → mate-session`, `cinnamon → cinnamon-session`, `plasma → startplasma-x11`. The WM ladder (`wmLadder`) MUST NOT change.

- **GIVEN** a pin of `mate-session`
- **WHEN** the supervisor resolves the WM argv
- **THEN** `IsSessionStarter("mate-session")` is true and `WMArgv` wraps it in `dbus-run-session --` (derived from the slice — no supervisor edit)

- **GIVEN** `rk gui wm lxde` on a host without `startlxde`
- **WHEN** the verb runs without `--force`
- **THEN** it refuses with `startlxde not on PATH — <LXDE install line> (pass --force to pin anyway)`

#### R2: Install hints for the four desktops, verified wording
`internal/gui/hint.go` MUST add `dePackages` rows for `startplasma-x11`, `startlxde`, `mate-session`, `cinnamon-session` in `sessionStarterDEs`, with exactly these strings (intake § What Changes 1 table — verified against distro indexes, never executed):

| starter | apt | dnf | pacman | generic |
|---|---|---|---|---|
| `startlxde` | `sudo apt install --no-install-recommends lxde-core` | `sudo dnf install lxde-common lxsession lxpanel pcmanfm openbox lxterminal` | `sudo pacman -S lxde` | `install lxde with your package manager` |
| `mate-session` | `sudo apt install --no-install-recommends mate-desktop-environment-core` | `sudo dnf install mate-session-manager mate-panel marco caja` | `sudo pacman -S mate` | `install mate with your package manager` |
| `cinnamon-session` | `sudo apt install --no-install-recommends cinnamon-core` | `sudo dnf install cinnamon cinnamon-session nemo` | `sudo pacman -S cinnamon` | `install cinnamon with your package manager` |
| `startplasma-x11` | `sudo apt install --no-install-recommends plasma-desktop` | `Fedora 40+ ships no Plasma X11 session (startplasma-x11 is not packaged) — pick another desktop` | `sudo pacman -S plasma-desktop plasma-x11-session` | `install plasma with your package manager` |

- **GIVEN** a lookPath that resolves `dnf` but not `apt-get`
- **WHEN** `DEInstallHint("startplasma-x11", lookPath)` is called on Linux
- **THEN** it returns the Fedora sentence above (a sentence, not a command)

- **GIVEN** any lookPath off Linux
- **WHEN** `DEInstallHint("startlxde", lookPath)` is called
- **THEN** it returns `""` (existing OS gate)

#### R3: `wm_candidates` carries known-but-missing desktops with per-row hints; the footer field is retired
`WMCandidate` MUST gain `Hint string \`json:"hint,omitempty"\``. On Linux, `WMCandidates(lookPath)` MUST emit installed rows first (today's ladder→starter order, alias-collapsed, `hint` empty), then missing rows in this order: `icewm-session` (when unresolved; `kind:"wm"`, `hint` = `WMInstallHint`), then each DE in `sessionStarterDEs` whose primary AND alias starters are both unresolved, by primary name in table order (`startlxqt`, `startxfce4`, `startplasma-x11`, `startlxde`, `mate-session`, `cinnamon-session`; `kind:"session"`, `installed:false`, `hint` = `DEInstallHint(primary)`). Bare WMs other than IceWM and `x-session-manager` MUST appear only when installed. Off Linux and with a nil lookPath the output MUST equal today's (a non-nil, possibly empty slice). `WMCandidatesHint`, `Status.WMCandidatesHint` (`wm_candidates_hint`), and the `Assemble` assignment MUST be removed.

- **GIVEN** Linux, apt detected, lookPath resolving only `icewm-session` and `lxqt-session`
- **WHEN** `WMCandidates` runs
- **THEN** rows are `[icewm-session installed, lxqt-session(label LXQt) installed, startxfce4 missing+hint, startplasma-x11 missing+hint, startlxde missing+hint, mate-session missing+hint, cinnamon-session missing+hint]` and no `startlxqt` row exists

- **GIVEN** Linux, a lookPath resolving nothing
- **WHEN** `GET /api/gui/host` is served with the GUI disabled
- **THEN** `wm_candidates` has seven `installed:false` rows (IceWM first), each with a non-empty `hint`, and the body contains no `wm_candidates_hint`

### CLI: `rk gui wm`

#### R4: `--list` and `--json`
`rk gui wm --list` MUST print the `gui.WMCandidates(guiLookPathFn)` table as aligned columns `NAME LABEL KIND INSTALLED HINT` (header row, installed rows first, `INSTALLED` as `yes`/`no`, `HINT` empty for installed rows), exit 0, via the command's `outputSink`. `--list --json` MUST emit the `wm_candidates` array as JSON (same shape as the status document). `--list` with a positional argument, or with `--restart` or `--force`, MUST be a usage error (`usageError`, exit 2). The bare report and the pin path MUST be unchanged.

- **GIVEN** the seam lookPath resolving `icewm-session` and `startlxqt`, apt detected
- **WHEN** `rk gui wm --list`
- **THEN** stdout matches the intake's § What Changes 4 sample table (two `yes` rows without hint, five `no` rows with apt lines)

- **GIVEN** `rk gui wm --list lxqt`
- **WHEN** run
- **THEN** exit 2 with a usage error naming that `--list` takes no argument

#### R5: Help text and setting description name the desktops
`guiWmCmd.Long` MUST carry, in addition to the existing report/pin paragraphs: (a) a known-desktop table — alias · starter · apt install line — for IceWM (default, seeded), LXQt (seeded), XFCE, Plasma, LXDE, MATE, Cinnamon, with a note that `--list` and the refusal line word the hint for the detected package manager (apt, dnf, pacman); (b) the recipe `sudo apt install <pkg>` → `rk gui wm <starter> --restart`; (c) the D-Bus caveat: a binary not in the known list runs bare — panels and trays of an unlisted full desktop may fail on the headless display; ask for it to be added, or run `--list` to see the known set; (d) a `--list`/`--json` paragraph. The `Use` line MUST read `wm [auto|icewm|lxqt|xfce|plasma|lxde|mate|cinnamon|<binary>]`. `internal/settings/settings.go` `gui.wm` `desc` MUST end with `Takes effect on rk gui restart. Run rk gui wm --list for installed and installable desktops.` `rk help-dump` MUST still exit 0 with valid JSON and empty stderr.

- **GIVEN** a HEAD build
- **WHEN** `bin/rk gui wm --help`
- **THEN** the output names all seven desktops and their apt lines and mentions `--list`

### Frontend: the two picker doors

#### R6: Client model and pure helpers
`api/client.ts` `GuiWMCandidate` MUST gain `hint?: string`; `GuiStatus.wm_candidates_hint` MUST be removed. In `lib/gui-desktop.ts`: `WMOption` gains `disabled?: boolean`; `buildWMOptions` MUST emit `Auto (ladder)`, installed rows, then one `disabled: true` option per `installed === false` row labelled `` `${label} — not installed` ``, then `Other…`; new `missingWMs(status)` MUST return the `installed === false` rows in document order; `buildDesktopPaletteRows` MUST emit, after the installed rows, one row per missing candidate with `id: desktop-${name}`, `label: \`${label} (not installed)\``, `description: hint` (omitted when empty), `disabled: true`, and MUST no longer emit a `desktop-install-hint` row.

- **GIVEN** a status with `[ICEWM installed, XFCE missing hint "sudo apt install --no-install-recommends xfce4"]`
- **WHEN** `buildDesktopPaletteRows(status, "", pick)`
- **THEN** rows are `Auto (ladder)` (current), `IceWM`, `XFCE (not installed)` (disabled, description = the hint) — exactly three

#### R7: Settings picker rendering
`components/gui-wm-picker.tsx` MUST render disabled options as `<option disabled>`; MUST render, when `missingWMs(status)` is non-empty, a collapsed disclosure labelled `Install more ▾` (`data-testid="gui-wm-install-more"`) that expands to one `font-mono`, user-selectable line per missing desktop formatted `` `${label}: ${hint}` `` (`data-testid="gui-wm-install-line"`); MUST remove the `gui-wm-install-hint` footer; and MUST set the `Other…` field's placeholder to `binary name, e.g. startlxde`. The disclosure uses the repo's existing collapsible idiom (a native `<details>/<summary>` or a `Control` toggling local state — whichever the settings dialog already uses; no new dependency).

- **GIVEN** the status above
- **WHEN** the picker mounts and resolves
- **THEN** the select shows `Auto (ladder)`, `IceWM`, a disabled `XFCE — not installed`, `Other…`; the disclosure is collapsed; clicking it reveals `XFCE: sudo apt install --no-install-recommends xfce4`

### Docs, spec, and tests

#### R8: Human docs bound by the toolkit standards
`docs/site/gui.md` MUST be created with `# GUI — the host's desktop in a tile`, the back-link line `> [← Back to the README](https://github.com/sahil87/run-kit/blob/main/README.md)`, and the ten sections in intake § What Changes 6 order (What it is · Turning it on · Desktops · Choosing one · Running something rk does not know · Resolution · Watching and driving · Agents · macOS is view-only · Troubleshooting); links to other `docs/site` pages relative, links to anything else absolute `https://…`; no images. `README.md` MUST gain `## GUI — the host's desktop in a tile` between `## Boards — watch many panes at once` and `## Drive it from your phone (HTTPS over Tailscale)` (three sentences + `See the [GUI guide](docs/site/gui.md) …`) and a `` `rk gui` `` row in § Command reference after `rk cron`. `docs/site/install.md` § Prerequisites MUST gain one bullet naming the optional GUI packages (`sudo apt install --no-install-recommends tigervnc-standalone-server icewm`) with a relative link to `gui.md`. Every command named in the new prose MUST exist in `rk help-dump`.

- **GIVEN** the README after the change
- **WHEN** `grep -n '](docs/site/gui.md)' README.md`
- **THEN** exactly one hit inside the new GUI section

#### R9: Skill gotcha within budget, byte-identical pair
`docs/site/skill/gui.md`'s "The desktop may be a full DE" gotcha line MUST be reworded to: `- **The desktop may be a full DE** — IceWM is the default; the user may pin any known desktop (\`rk gui wm --list\` names them, \`rk gui wm lxqt\` pins one); every verb on this page works identically regardless. On a full desktop \`rk gui windows\` also lists the DE's panel as a window — filter by \`app\` when looking for user apps.` No lines added (139 total). `app/backend/cmd/rk/skill/gui.md` MUST be byte-identical (`cmp`).

- **GIVEN** the edited pair
- **WHEN** `just test-backend` runs `skill_test.go`
- **THEN** the budget and drift-guard tests pass

#### R10: Spec amendment and e2e coverage
`docs/specs/gui.md` § Switching desktops MUST be amended: aliases `plasma|lxde|mate|cinnamon`; the `wm_candidates` row shape `{name, label, kind: wm|session, installed, hint?}` with installed-then-missing ordering; `wm_candidates_hint` struck; the picker paragraph describing disabled rows + `Install more ▾`; a `rk gui wm --list` sentence. `tests/e2e/gui-desktop-picker.spec.ts` MUST stub a missing XFCE row (`installed:false`, hint `sudo apt install --no-install-recommends xfce4`) and replace the "no install hint" test with two intent-commented tests: (a) Settings select lists Auto, both installed, disabled `XFCE — not installed`, `Other…`, and the disclosure expands to the exact hint line; (b) the palette sub-list shows `XFCE (not installed)` disabled with the hint as description and Enter on it changes nothing (no settings POST). File-header comment updated. Run only as `just test-e2e "e2e/gui-desktop-picker"`.

- **GIVEN** the stubbed document
- **WHEN** the two new tests run
- **THEN** both pass with Proves/Steps blocks present

### Non-Goals
- A generic session-bus wrap flag or `gui.wm_session` setting — follow-up only (R-D8)
- GNOME; installing anything from rk; WM ladder order changes; wallpaper/theme picker
- Anything in T1 (the toolbar pill) — separate change
- Manual acceptance on the live desktop — none; never restart it

### Design Decisions

#### Known-but-missing desktops ride `wm_candidates`, with per-row hints
**Decision**: the status document lists every known DE (and the IceWM ladder head) whether installed or not, `installed:false` rows carrying their own install line; the single `wm_candidates_hint` footer is retired.
**Why**: the picker's job is to show the choices, not the inventory; a select listing only what is installed can never teach a user that XFCE exists, and one footer could only ever nag about LXQt.
**Rejected**: keeping the footer and adding a second "known desktops" array (two lists for one table); emitting missing rows on darwin (nothing installable there).
*Introduced by*: 260911-91px-gui-desktop-reference

#### dnf lines are explicit verified packages; Fedora Plasma gets a sentence
**Decision**: the four new dnf hints name explicit packages verified on packages.fedoraproject.org (never a `@group`), and the Plasma dnf hint is the sentence `Fedora 40+ ships no Plasma X11 session (startplasma-x11 is not packaged) — pick another desktop`.
**Why**: the existing rows already avoid groups; Fedora dropped the Plasma X11 session with Plasma 6 (Fedora 40), so any install command would be a lie.
**Rejected**: `dnf install @lxde-desktop-environment` (group ids unverifiable, convention avoids groups); a fake `plasma-workspace-x11` line (EPEL-only).
*Introduced by*: 260911-91px-gui-desktop-reference

## Tasks

### Phase 1: Backend table and hints

- [x] T001 `app/backend/internal/gui/candidates.go` + `hint.go`: extend `sessionStarterOrder`, `WMCandidateLabel`; add the four `dePackages` values and `sessionStarterDEs` rows with the exact strings in R2; add `hint_test.go`/`candidates_test.go` cases per starter × manager (apt/dnf/pacman/generic, off-Linux empty), `IsSessionStarter` for the three new names, `PinInstallHint("startlxde")`. `cmd/rk/gui_wm.go`: add the four aliases + `Use` line; test alias resolution and the LXDE refusal line in `gui_wm_test.go`. <!-- R1, R2 -->
- [x] T002 `app/backend/internal/gui/candidates.go`: `WMCandidate.Hint`, missing-row emission (Linux-only, IceWM head then DEs in table order, alias-aware installed check), delete `WMCandidatesHint`; `status.go` drop `WMCandidatesHint`; `assemble.go` drop the assignment; rewrite `api/gui_test.go` candidate tests (seven-missing-rows case, installed-LXQt-alias case, no `wm_candidates_hint` in body, `[]` off Linux / nil seam); `candidates_test.go` ordering test. Run `just test-backend`. <!-- R3 -->

### Phase 2: CLI

- [x] T003 `app/backend/cmd/rk/gui_wm.go`: `--list` (aligned table via `text/tabwriter` or the repo's existing column helper) and `--json`; usage errors for positional/`--restart`/`--force` with `--list`; rewrite `Long` per R5 (table, recipe, D-Bus caveat, `--list` paragraph); `internal/settings/settings.go` `gui.wm` desc clause. Tests in `gui_wm_test.go` for the table, JSON equality, usage exits. `just build` then `bin/rk help-dump | jq -e .tool` exits 0 with empty stderr; `bin/rk gui wm --help` names the seven desktops. <!-- R4, R5 -->

### Phase 3: Frontend

- [x] T004 `app/frontend/src/api/client.ts` (`hint?`, drop `wm_candidates_hint`), `lib/gui-desktop.ts` (`disabled` options, `missingWMs`, missing palette rows, no hint row) + `lib/gui-desktop.test.ts` rewritten. <!-- R6 -->
- [x] T005 `app/frontend/src/components/gui-wm-picker.tsx`: disabled `<option>`s, `Install more ▾` disclosure with test ids, remove footer, placeholder; `gui-wm-picker.test.tsx` rewritten (disabled option, disclosure collapsed→expanded line text, placeholder, no footer). `just test-frontend` green (includes `tsc --noEmit`). <!-- R7 -->

### Phase 4: Docs, spec, e2e

- [x] T006 [P] `docs/site/gui.md` (new, ten sections + back-link), `README.md` (GUI section between Boards and the phone section; `rk gui` command-reference row), `docs/site/install.md` (Prerequisites bullet). Before writing, re-read `shll standards readme-extraction` and `shll standards install-composition`; verify every named command against `bin/rk help-dump`; grep the three files for relative links that leave `docs/site` and make them absolute. <!-- R8 -->
- [x] T007 [P] `docs/site/skill/gui.md` gotcha line reworded (no lines added), copy byte-for-byte to `app/backend/cmd/rk/skill/gui.md`; `cmp` both; `just test-backend` (skill budget + drift guard). <!-- R9 -->
- [x] T008 [P] `docs/specs/gui.md` § Switching desktops amendment per R10. <!-- R10 -->
- [x] T009 `app/frontend/tests/e2e/gui-desktop-picker.spec.ts`: add the missing XFCE stub row, replace the "no install hint" test with the two intent-commented tests in R10, update the header comment; run `just test-e2e "e2e/gui-desktop-picker"` (one spec per run). <!-- R10 -->

## Execution Order

- T001 blocks T002 (missing rows need the new table); T002 blocks T003 (`--list` prints the new rows) and T004 (frontend type follows the Go shape)
- T004 blocks T005; T005 blocks T009
- T006, T007, T008 are independent of each other and of Phase 3; T006 needs T003's `--help`/help-dump for command verification

## Acceptance

### Functional Completeness

- [x] A-001 R1: `sessionStarterOrder` is the nine-name list; the four new labels and four aliases resolve; `wmLadder` is unchanged
- [x] A-002 R2: `DEInstallHint` returns the exact R2 strings for each of the four starters under apt/dnf/pacman/none on Linux and `""` off Linux
- [x] A-003 R3: `WMCandidates` emits installed rows then missing rows (IceWM head, then DEs in table order) with `hint`; `WMCandidatesHint` and `wm_candidates_hint` no longer exist anywhere in `app/backend`
- [x] A-004 R4: `rk gui wm --list` prints the header + rows in document order; `--list --json` equals the `wm_candidates` array; the bare report is unchanged
- [x] A-005 R5: `guiWmCmd.Long` carries the table, recipe, D-Bus caveat, and `--list` paragraph; the `gui.wm` setting description ends with the `--list` clause
- [x] A-006 R6: `buildWMOptions`, `missingWMs`, `buildDesktopPaletteRows` behave per R6; `GuiStatus` has no `wm_candidates_hint`
- [x] A-007 R7: the picker renders disabled options, the `Install more ▾` disclosure with the `Label: hint` lines, no footer, and the new placeholder
- [x] A-008 R8: `docs/site/gui.md` exists with the ten sections and back-link; README has the GUI section in the stated position and the `rk gui` row; install.md has the bullet
- [x] A-009 R9: the skill gotcha line reads as specified; both skill copies are byte-identical; line count is 139
- [x] A-010 R10: the spec § Switching desktops reflects aliases, row shape, ordering, disclosure, `--list`; `wm_candidates_hint` is gone from the spec

### Behavioral Correctness

- [x] A-011 R3: a host with only `lxqt-session` installed yields one installed `LXQt` row and no missing LXQt row
- [x] A-012 R4: `rk gui wm --list <arg>` and `rk gui wm --list --restart` exit 2 with a usage message
- [x] A-013 R2: the Plasma dnf hint is the Fedora sentence, not a command

### Removal Verification

- [x] A-014 R3: `grep -rn wm_candidates_hint app/ docs/specs docs/site` returns nothing
- [x] A-015 R6: no `desktop-install-hint` palette row and no `gui-wm-install-hint` test id remain in `app/frontend/src`

### Scenario Coverage

- [x] A-016 R3: `api/gui_test.go` covers the seven-missing-rows disabled-document case and the alias-installed case
- [x] A-017 R10: `gui-desktop-picker.spec.ts` carries the two new intent-commented tests and passes via `just test-e2e "e2e/gui-desktop-picker"`
- [x] A-018 R5: `bin/rk help-dump` exits 0, valid JSON, empty stderr on a HEAD build

### Edge Cases & Error Handling

- [x] A-019 R3: a nil `lookPath` and a non-Linux `goos` yield today's output (non-nil slice, no missing rows)
- [x] A-020 R7: a status fetch that rejects still renders the free-text fallback (unchanged behavior) and no disclosure

### Code Quality

- [x] A-021 Pattern consistency: new Go code uses the existing seam idioms (`guiLookPathFn`, `usageError`, `outputSink`), no shell strings, no new subprocesses; new TSX uses type narrowing, no `as` casts
- [x] A-022 No unnecessary duplication: hint strings live only in `hint.go`; frontend rows derive from `wm_candidates` (no client-side desktop table)
- [x] A-023 Tests included for every changed behavior (Go table tests, Vitest, Playwright with intent comments)
- [x] A-024 No comment narration or change-id citations in code comments
- [x] A-025 Toolkit standards: README/docs/site edits satisfy `readme-extraction` (link forms, no reserved names) and `install-composition` (no `brew install` lines); `help-dump` remains conformant

### Security

- [x] A-026 R4: `--list` performs `LookPath` only — no process execution, no settings write

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Known environmental e2e failures in long-named worktrees (boards-multi-server, create-server-waiting, legacy-*-sweep, multi-server-sidebar, protected-kill-confirm, plus status-bar / surface-layout load flakes) are pre-existing and not this change's; run the picker spec alone.

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. The planned removals (`WMCandidatesHint`, `Status.WMCandidatesHint` / `wm_candidates_hint`, the palette `desktop-install-hint` row, the picker `gui-wm-install-hint` footer) were all executed during apply; a repo-wide sweep found no leftover references and no newly-unused symbols.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Missing rows only on Linux; darwin/nil seam unchanged | Intake assumption 8; hint OS gate already exists | S:80 R:90 A:90 D:85 |
| 2 | Confident | `--list` table is rendered with `text/tabwriter` unless the repo already has a column helper in `cmd/rk` — reuse it if present | Standard-library idiom; trivially reversible | S:70 R:95 A:85 D:80 |
| 3 | Confident | The disclosure uses whichever collapsible idiom the settings dialog already has (native `<details>` acceptable) | Intake assumption 10; test ids fixed regardless | S:65 R:95 A:80 D:75 |
| 4 | Certain | The README `rk gui` row text is the intake's; placement after `rk cron` | Intake § What Changes 6 | S:90 R:95 A:90 D:90 |

4 assumptions (2 certain, 2 confident, 0 tentative).

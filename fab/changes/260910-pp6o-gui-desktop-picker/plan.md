# Plan: The desktop picker — Settings row + `GUI: Desktop…` (S3 / L3)

**Change**: 260910-pp6o-gui-desktop-picker
**Intake**: `intake.md`

## Requirements

### Backend: `wm_candidates` on the status document

#### R1: Candidates are derived from PATH on every status read
`gui.Status` SHALL gain `WMCandidates []WMCandidate` (`json:"wm_candidates"`, always serialized — `[]` never `null`, the `apps` precedent) where `WMCandidate{Name, Label, Kind string; Installed bool}` (`json:"name"/"label"/"kind"/"installed"`). The list SHALL be computed by a pure `internal/gui` function (`WMCandidates(lookPath)`) iterating the ladder (`WMLadder()` order) then the session-starter set (a fixed, exported order: `startlxqt`, `lxqt-session`, `startxfce4`, `xfce4-session`, `startplasma-x11`, `x-session-manager`), deduplicated by name, through the `LookPath` seam. A name that does not resolve MUST be omitted entirely (never listed with `installed:false`); every listed entry carries `installed:true`. A nil `lookPath` yields an empty list (StatusDeps' nil-seam promise). The list is never stored (Constitution II) and never joins the `event: gui` stream payload.

- **GIVEN** a `LookPath` stub resolving only `icewm-session` and `startlxqt`
- **WHEN** `GET /api/gui/host` is served
- **THEN** `wm_candidates` is exactly `[{icewm-session, IceWM, wm, true}, {startlxqt, LXQt, session, true}]` in that order
- **AND** a `LookPath` resolving nothing yields `"wm_candidates":[]`

#### R2: Label and kind mapping, with DE alias collapse
`Label` SHALL be `IceWM` for `icewm-session`, `LXQt` for `startlxqt` and `lxqt-session`, `XFCE` for `startxfce4` and `xfce4-session`, and the raw binary name for every other candidate. `Kind` SHALL be `"session"` when `IsSessionStarter(name)` is true, else `"wm"`. The alias starter of a DE (`lxqt-session`, `xfce4-session`) SHALL be omitted when its primary starter (`startlxqt`, `startxfce4`) is also installed, so one desktop environment is one row (both names share a package set in `sessionStarterDEs`).

- **GIVEN** a host with `startlxqt` and `lxqt-session` both on PATH
- **WHEN** candidates are derived
- **THEN** exactly one LXQt row appears, named `startlxqt`
- **GIVEN** a host with only `lxqt-session` on PATH
- **THEN** the row is `{lxqt-session, LXQt, session, true}`
- **GIVEN** `openbox` on PATH
- **THEN** its row is `{openbox, openbox, wm, true}`

#### R3: The picker footer hint
`gui.Status` SHALL gain `WMCandidatesHint string` (`json:"wm_candidates_hint,omitempty"`): `gui.DEInstallHint("startlxqt", lookPath)` whenever no LXQt candidate (`startlxqt` or `lxqt-session`) is in the list, empty otherwise. It is distinct from the existing bare-WM `wm_hint` (which stays enabled ∧ reachable ∧ bare). Off Linux `DEInstallHint` is empty, so the field is omitted there.

- **GIVEN** a Linux host, `apt-get` on PATH, no LXQt starter installed
- **WHEN** the document is built
- **THEN** `wm_candidates_hint` is `sudo apt install --no-install-recommends lxqt-core`
- **GIVEN** `startlxqt` installed
- **THEN** `wm_candidates_hint` is absent

#### R4: Candidates ride every document, including a disabled GUI
`Assemble` SHALL compute `WMCandidates` and `WMCandidatesHint` before the `!Enabled` short-circuit (the derivation touches only PATH — no tmux, no daemon gate), so the Settings picker works while the GUI is off (the `rk gui wm` bare-set-while-off rule). `TestGuiStatusDisabledDocument` and the assembler tests keep passing; the disabled document gains only these additive fields.

- **GIVEN** `gui.enabled` false
- **WHEN** `GET /api/gui/host` is served
- **THEN** `enabled:false`, `apps:[]`, and `wm_candidates` lists the installed candidates

### Frontend: the Settings-dialog select control

#### R5: `gui.wm` renders as a select once the status document resolves
The All-settings table's `EntryControl` SHALL route `entry.key === "gui.wm"` to a new `GuiWMPicker` control (own file `components/gui-wm-picker.tsx`, the `theme_dark` named-key-override precedent — no registry schema change, no new `kind`). On mount the control fetches `GET /api/gui/host` once (`fetchGuiStatus`, never polled — the off-dialog precedent). Once resolved it renders a `<select id="setting-gui.wm" aria-label="gui.wm">` with options in order: `Auto (ladder)` (value `""`), one option per `wm_candidates` entry (visible text = `label`, value = `name`), then `Other…`. The write path is unchanged: `registry.commitSetting("gui.wm", name)` (`""` → `null` for Auto, the unset convention), which POSTs `/api/settings`. Selecting a value alone MUST NOT call the restart endpoint.

- **GIVEN** a status document with candidates IceWM and LXQt
- **WHEN** the All-settings tab renders the `gui.wm` row
- **THEN** the select shows `Auto (ladder)`, `IceWM`, `LXQt`, `Other…`
- **AND** choosing `LXQt` POSTs `{"gui.wm":"startlxqt"}` and calls no restart route

#### R6: `Other…` reveals the free-text field
Choosing `Other…` SHALL reveal the existing text-input contract (`useTextSettingDraft` + `textSettingInputClass`, Enter/blur commits, Escape cancels, inline `TextSettingError`) beneath the select without writing anything by itself; a committed non-empty name writes through `commitSetting` and then enters the restart flow (R9). When the stored value is non-empty and matches no candidate (a typed binary such as `xfwm4`), the select SHALL show `Other…` selected with the text field revealed and pre-filled with that value.

- **GIVEN** stored `gui.wm` = `xfwm4` and candidates IceWM/LXQt
- **WHEN** the row renders
- **THEN** `Other…` is selected and the text field shows `xfwm4`
- **GIVEN** the user picks `Other…` from Auto
- **THEN** the text field appears and no settings POST fires until a name is committed

#### R7: Free-text fallback before/without the status document
Until the status fetch resolves, and permanently if it rejects, the row SHALL render today's `TextEntryControl` (the free-text field) — the dialog never blocks on a slow or failed status call. A resolved document with an absent or empty `wm_candidates` still renders the select with `Auto (ladder)` and `Other…` only (functionally equivalent to the free-text field).

- **GIVEN** `fetchGuiStatus` rejects
- **WHEN** the row renders
- **THEN** a text input with `id="setting-gui.wm"` is present and commits as before
- **GIVEN** a document with `wm_candidates: []`
- **THEN** the select offers exactly `Auto (ladder)` and `Other…`

#### R8: Footer hint under the select
When the document carries `wm_candidates_hint`, the control SHALL render `Install more: <hint>` beneath the select (`data-testid="gui-wm-install-hint"`); absent hint ⇒ no footer.

- **GIVEN** `wm_candidates_hint` = `sudo apt install --no-install-recommends lxqt-core`
- **THEN** the footer reads `Install more: sudo apt install --no-install-recommends lxqt-core`

### Frontend: the restart confirm (off-confirm shell reuse)

#### R9: The shared desktop-pick flow ends in a restart confirm
A shared hook/helper (`lib/gui-desktop.ts` pure parts + a `useDesktopPick` hook) SHALL implement the one flow both doors use: `write(name)` (the caller's settings write) → if the GUI is enabled, open the restart confirm → `Restart` calls `restartGui()` (`POST /api/gui/host/restart`, unchanged) → `Later` calls nothing further. The confirm is a new `GuiRestartDialog` (`components/gui-restart-dialog.tsx`) built on the shell extracted from `gui-off-dialog.tsx` (one-shot status fetch, `Dialog` + `controlClass` buttons, the `apps` list grammar); `GuiOffDialog`'s exports and tests keep their behavior. Title: `Restart the desktop now?`. Body: `Running apps will close: <name ×count, …>` when apps are running; `No apps are running on display <display>.` when none; when the display is not running: `The desktop is not running — the new desktop starts on the next restart.` Buttons: `Later` (confirm variant) and `Restart` (danger). A failed `GET` still renders the confirm with the generic line. The dialog mounts ONCE at `AppLayoutContent` beside `GuiOffDialog`, requested through a `GuiRestartRequest` context (`contexts/gui-restart-context.tsx`, `request(): Promise<boolean>`, the `GuiOffRequest` shape).

- **GIVEN** a status document with apps `chromium ×3, xterm ×1`
- **WHEN** a candidate is chosen
- **THEN** the confirm shows `Running apps will close: chromium ×3, xterm ×1`
- **AND** `Restart` POSTs `/api/gui/host/restart` exactly once

#### R10: `Later` leaves the pin set and restarts nothing
`Later` (and Escape/backdrop) SHALL resolve the request `false`; the settings write from R5/R6 stands, no restart call is made, and no error is shown.

- **GIVEN** the confirm is open after choosing `LXQt`
- **WHEN** `Later` is pressed
- **THEN** `gui.wm` remains `startlxqt` and the restart route was never called

#### R11: A disabled GUI skips the confirm
When the fetched document (or the live `gui` signal) reports `enabled: false`, the flow SHALL skip the confirm and toast `Desktop set — takes effect when the GUI turns on` (a restart would 409 `gui disabled`); the write still happens.

- **GIVEN** `gui.enabled` false
- **WHEN** a candidate is chosen in the Settings row
- **THEN** the settings POST fires, no dialog opens, the info toast appears

### Frontend: the palette door

#### R12: A generic single-select sub-list on `PaletteAction`
`PaletteAction` SHALL gain `subList?: { placeholder?: string; rows: PaletteAction[] | (() => Promise<PaletteAction[]>) }` — the reusable "server-supplied choices" control for the palette. Selecting a row that carries `subList` enters a sub-step (the `optionPicker`/`confirmLabel` grammar: input read-only, placeholder shown, Esc/backdrop/⌘K cancel, `useEffect` refocus) listing the rows as plain display rows (a row's own `confirmLabel`/`optionPicker`/`subList` are ignored — no recursion). A lazy loader renders a single non-selectable `Loading…` row until it resolves; a rejected loader renders `Couldn't load choices` and stays cancelable. Enter/click on a row closes the palette and calls that row's `onSelect`; `disabled` rows stay inert. The current choice is conveyed by the row's `description` (renders `label — current`).

- **GIVEN** an action with a lazy `subList`
- **WHEN** it is selected
- **THEN** the palette shows `Loading…`, then the resolved rows with the placeholder in the input
- **AND** Enter on the second row closes the palette and fires exactly that row's `onSelect`

#### R13: `GUI: Desktop…` opens the same picker as a sub-list
`buildGuiActions` SHALL emit `{ id: "gui-desktop", label: "GUI: Desktop…" }` whenever `enabled` is true (not gated on `reachable`, after `GUI: Turn off` and before the launch rows), carrying `subList: { placeholder: "Pick a desktop — Enter select · Esc cancel", rows: input.loadDesktopRows }` where `loadDesktopRows: () => Promise<PaletteAction[]>` is a new caller-supplied seam. `app.tsx` implements the loader by fetching the status document and the settings entries once, then mapping through the shared `lib/gui-desktop.ts` builder: `Auto (ladder)` first (value `""`), one row per `wm_candidates` entry (label from the server), the row whose value equals the stored `gui.wm` marked `description: "current"`, and — when `wm_candidates_hint` is present — a trailing disabled row `Install more: <hint>`. There is no `Other…` row in the palette (a typed binary needs the dialog's text field). Selecting a row runs the identical write → confirm → restart/later flow (R9–R11) via `useDesktopPick`, writing through `postSettings({"gui.wm": …})`.

- **GIVEN** the switch is on and candidates IceWM/LXQt with `gui.wm` = `startlxqt`
- **WHEN** `GUI: Desktop…` is selected
- **THEN** the rows read `Auto (ladder)`, `IceWM`, `LXQt — current`
- **AND** choosing `IceWM` POSTs `{"gui.wm":"icewm-session"}` and opens the restart confirm
- **GIVEN** the switch is off
- **THEN** no `gui-desktop` row exists

### Docs

#### R14: Spec § Switching desktops names the two doors
`docs/specs/gui.md` § Switching desktops SHALL gain one paragraph on the picker: the Settings row (All settings → `gui.wm`: `Auto (ladder)`, installed candidates, `Other…`), the palette row (`⌘K` → `GUI: Desktop…`), the `wm_candidates`/`wm_candidates_hint` document fields (derived from PATH on every read, never stored), the restart confirm with `Restart`/`Later`, and the existing XFCE line from the lxqt plan's § UX → Docs (`rk gui wm xfce`, unseeded; turn off xfwm4 compositing in Settings → Window Manager Tweaks or the relay pays for it). Memory updates ride hydrate.

- **GIVEN** the spec after this change
- **THEN** § Switching desktops mentions `GUI: Desktop…`, the `gui.wm` select, `wm_candidates`, and the XFCE caveat

### Tests

#### R15: Playwright covers the two-door flow against a stubbed document
A new fully-mocked spec `app/frontend/tests/e2e/gui-desktop-picker.spec.ts` (the `gui-surface.spec.ts` ungated half's rig: `mockStateSocket` with an enabled+reachable `gui` slot, `page.route` stubs for `GET /api/gui/host` — two candidates `IceWM`/`LXQt` plus apps `chromium ×2` — `GET`/`POST /api/settings`, and `POST /api/gui/host/restart` with request capture) SHALL prove: ⌘K → `GUI: Desktop…` → `LXQt` → the confirm names `chromium ×2` → `Later` ⇒ exactly one settings POST `{"gui.wm":"startlxqt"}` and zero restart calls; a second pass → `LXQt` → `Restart` ⇒ one restart POST. A third test opens Settings → All settings and asserts the `gui.wm` select lists `Auto (ladder)`, `IceWM`, `LXQt`, `Other…` and the footer hint is absent (LXQt present). Every `test()` carries the Proves/Steps JSDoc block and the file opens with the shared-setup header (Constitution § Test Intent Comments).

- **GIVEN** the stubbed rig
- **WHEN** the three tests run under `just test-e2e "gui-desktop-picker"`
- **THEN** they pass on desktop (1280px)

### Non-Goals

- A generic registry `kind` for server-discovered options — the select is a component-level named-key override scoped to `gui.wm` (Coordination point 1).
- Seeding or testing XFCE/KDE; installing packages; a picker inside the gui tile (L-D1/L-D8).
- A `wm_candidates` stream field — the list changes only when packages change; the one-shot document is the source.
- Replacing `rk gui wm` or changing any existing route, stream field, or exported signature.

### Design Decisions

#### Candidate derivation lives in the pure half (`internal/gui`), wired through `Assemble`
**Decision**: `WMCandidates(lookPath)`, the label map, alias collapse, and the hint live in `internal/gui` (`candidates.go`); `Assemble` populates the two new fields before the `!Enabled` return; `api/gui.go` changes only in its handler test.
**Why**: the existing split — tmux half in `internal/daemon`, pure half in `internal/gui` — keeps `rk gui status --json` and `GET /api/gui/{id}` emitting one document from one assembler; PATH lookups need no daemon gate, so the picker also works while the GUI is off.
**Rejected**: deriving in the HTTP handler (the CLI document would drift); gating on `enabled` (a Settings row for an off GUI would lose its choices).
*Introduced by*: 260910-pp6o-gui-desktop-picker

#### One desktop environment is one row
**Decision**: `lxqt-session`/`xfce4-session` are omitted when `startlxqt`/`startxfce4` is installed; when only the alias is present it carries the DE label.
**Why**: `lxqt-core` installs both binaries; two rows labeled `LXQt` and `lxqt-session` for one desktop is noise, and `hint.go` already treats the pair as one package set.
**Rejected**: listing every resolved name verbatim (duplicate desktop rows); dropping the alias names from the set entirely (a host with only `lxqt-session` would lose its desktop).
*Introduced by*: 260910-pp6o-gui-desktop-picker

#### The palette door is a generic lazy `subList`, not a dialog
**Decision**: `PaletteAction.subList` with eager or lazy rows; `GUI: Desktop…` supplies a loader that fetches the document + settings on entry.
**Why**: the intake wants a palette sub-list, and the status document is fetched one-shot on dialog/sub-step open (never polled, never in the stream) — a lazy loader mirrors that exactly, and the control is reusable by later stages.
**Rejected**: pre-fetching candidates into app state (a poll or a stream field); opening a modal dialog from the row (two visual grammars for one picker).
*Introduced by*: 260910-pp6o-gui-desktop-picker

#### The restart confirm shares the off-confirm's shell
**Decision**: extract the one-shot status fetch + apps-list rendering from `gui-off-dialog.tsx` into a shared shell consumed by both `GuiOffDialog` and the new `GuiRestartDialog`; the restart dialog mounts once at AppLayout behind a `GuiRestartRequest` context.
**Why**: the same destructive-action grammar (list what dies, confirm) for a second consumer; a context-mounted single dialog is how the off-confirm already reaches both the palette and the settings seam.
**Rejected**: parameterizing `GuiOffDialog` with mode props (two unrelated POST paths in one component); a second copy of the fetch/apps rendering.
*Introduced by*: 260910-pp6o-gui-desktop-picker

## Tasks

### Phase 1: Backend

- [x] T001 Add `app/backend/internal/gui/candidates.go`: `WMCandidate` type, exported `SessionStarters()` fixed-order slice (derive the `sessionStarters` map from it in `backend.go`), `WMCandidateLabel(name)`, `WMCandidates(lookPath)` (ladder → starters, dedupe, alias collapse, omit misses, nil-safe), `WMCandidatesHint(candidates, lookPath)`; tests in `candidates_test.go` (label/kind map, alias collapse both ways, order, nil lookPath, hint present/absent). <!-- R1, R2, R3 -->
- [x] T002 Wire `Status.WMCandidates`/`Status.WMCandidatesHint` in `app/backend/internal/gui/status.go` (non-nil slice init like `Apps`) and populate them in `assemble.go` before the `!Enabled` return; extend `assemble_test.go` (disabled document carries candidates; hint present when no LXQt). <!-- R1, R3, R4 -->
- [x] T003 Handler test in `app/backend/api/gui_test.go`: a `guiLookPathFn` resolving only `icewm-session`+`startlxqt` yields exactly two candidates in order with labels/kinds and no hint; a resolve-nothing stub yields `"wm_candidates":[]` plus the hint (with `apt-get` resolving); confirm `TestGuiStatusDisabledDocument` still passes. <!-- R1, R3, R4 -->

### Phase 2: Frontend

- [x] T004 [P] `app/frontend/src/api/client.ts`: add `GuiWMCandidate` type and `wm_candidates?: GuiWMCandidate[]`, `wm_candidates_hint?: string` to `GuiStatus` (doc comment); fix typed fixtures (`gui-off-dialog.test.tsx` etc.) as needed. <!-- R5 -->
- [x] T005 [P] `app/frontend/src/lib/gui-desktop.ts` + `gui-desktop.test.ts`: pure helpers — `AUTO_WM = ""`, `buildWMOptions(status)` (Auto → candidates → Other… for the dialog), `buildDesktopPaletteRows(status, currentWM, onPick)` (Auto → candidates with `current` description → disabled hint row; no Other…), `isOtherWM(value, candidates)`, `guiRestartBody(status)` copy variants, `DESKTOP_SET_OFF_TOAST` constant. <!-- R5, R6, R9, R13 -->
- [x] T006 Extract the shared confirm shell from `app/frontend/src/components/gui-off-dialog.tsx` (one-shot `fetchGuiStatus` hook + body/buttons layout) and add `components/gui-restart-dialog.tsx` (`GuiRestartDialog({ onClose })`, title `Restart the desktop now?`, `Later`/`Restart`, `Restart` calls `restartGui` and toasts `{ok:false,disabled}`/errors) with `gui-restart-dialog.test.tsx` (apps copy, empty apps, not-running line, failed GET, Later → `onClose(false)` no restart, Restart → one `restartGui` call then `onClose(true)`); `gui-off-dialog.test.tsx` stays green. <!-- R9, R10 -->
- [x] T007 `app/frontend/src/contexts/gui-restart-context.tsx` (`GuiRestartRequest { request(): Promise<boolean> }`, provider + hook) and mount `GuiRestartDialog` once in `AppLayoutContent` (`app.tsx`) beside `GuiOffDialog`; add `hooks/use-desktop-pick.ts` (`useDesktopPick(): (name, write) => Promise<void>` — write, then enabled-check via a fresh `fetchGuiStatus`, confirm request or off-toast, restart on confirm) with a unit test. <!-- R9, R10, R11 -->
- [x] T008 `app/frontend/src/components/gui-wm-picker.tsx` (`GuiWMPicker({ value, commit })`: status fetch once, select/Other…/text reveal/footer hint, fallback `TextEntryControl` while pending or on failure; uses `useDesktopPick`) and route `entry.key === "gui.wm"` to it in `settings-all-panel.tsx`'s `EntryControl`; `gui-wm-picker.test.tsx` covers R5–R8 and R11 (options order, `Other…` reveal with no POST, stored non-candidate ⇒ Other… + prefilled, empty candidates ⇒ Auto+Other…, rejected fetch ⇒ text input, hint footer, select does not call restart, disabled GUI toast). <!-- R5, R6, R7, R8, R11 -->
- [x] T009 `app/frontend/src/components/command-palette.tsx`: add `subList` to `PaletteAction` and the sub-step (lazy load, `Loading…`/error rows, read-only input + placeholder, Enter/click selects and closes, disabled rows inert, cancel paths reset state); `command-palette.test.tsx` cases for eager rows, lazy rows, loader rejection, Esc cancel, disabled row no-op. <!-- R12 -->
- [x] T010 `app/frontend/src/lib/palette/gui.ts` + `gui.test.ts`: `loadDesktopRows` input seam and the `gui-desktop` row (`enabled` only, position after `gui-turn-off`); update the existing ordered-id expectations. <!-- R13 -->
- [x] T011 `app/frontend/src/app.tsx`: supply `loadDesktopRows` (fetch status + `getSettingsEntries` → `buildDesktopPaletteRows` with `onPick` = `useDesktopPick` writing via `postSettings({"gui.wm": …})`); pass `useDesktopPick` deps through the existing `guiActions` memo. <!-- R13 -->

### Phase 3: Integration & Docs

- [x] T012 `app/frontend/tests/e2e/gui-desktop-picker.spec.ts` — the three fully-mocked tests of R15 with the shared-setup header and per-test Proves/Steps blocks; run via `just test-e2e "gui-desktop-picker"`. <!-- R15 -->
- [x] T013 [P] `docs/specs/gui.md` § Switching desktops — the picker paragraph and the XFCE caveat line. <!-- R14 -->

### Phase 4: Gates

- [x] T014 Run the gates in order: `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, `just test`, `just build`; fix anything red. <!-- R1, R5, R9, R12, R15 -->

## Execution Order

- T001 → T002 → T003 (backend chain); T004/T005 may run alongside.
- T005 and T006 block T007; T007 blocks T008 and T011; T009 blocks T010 → T011.
- T012 needs T008 + T011; T013 is independent; T014 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `GET /api/gui/host` carries `wm_candidates` derived through the `LookPath` seam, listing only installed names, always serialized as an array.
- [x] A-002 R2: Labels are `IceWM`/`LXQt`/`XFCE`/raw name; `kind` is `session` exactly for session starters; DE alias pairs collapse to one row.
- [x] A-003 R3: `wm_candidates_hint` is the LXQt `DEInstallHint` when no LXQt candidate is listed and is omitted otherwise.
- [x] A-004 R4: A disabled GUI's document still carries `wm_candidates` (and the hint when applicable).
- [x] A-005 R5: The All-settings `gui.wm` row renders a select (`Auto (ladder)`, candidates by label, `Other…`) after the status fetch, writing through `commitSetting`.
- [x] A-006 R6: `Other…` reveals the text field; a stored non-candidate value pre-selects `Other…` with the value filled in.
- [x] A-007 R7: The free-text field renders while the fetch pends or after it fails; empty candidates ⇒ `Auto (ladder)` + `Other…`.
- [x] A-008 R8: `Install more: <hint>` renders under the select iff `wm_candidates_hint` is present.
- [x] A-009 R9: Choosing a value writes `gui.wm`, then opens `Restart the desktop now?` with the running-apps list; `Restart` POSTs `/api/gui/host/restart` once.
- [x] A-010 R10: `Later` (and dismiss) leaves the written pin and makes no restart call.
- [x] A-011 R11: With the GUI off the flow writes, skips the confirm, and toasts the takes-effect-later message.
- [x] A-012 R12: `PaletteAction.subList` (eager or lazy) renders a single-select sub-step with loading/error rows, read-only input, cancel paths, and Enter/click selection.
- [x] A-013 R13: `GUI: Desktop…` exists iff `enabled`; its rows are `Auto (ladder)` → candidates (current marked) → optional disabled hint row; picking runs the same write → confirm → restart/later flow.
- [x] A-014 R14: `docs/specs/gui.md` § Switching desktops documents both doors, the document fields, and the XFCE caveat.
- [x] A-015 R15: `gui-desktop-picker.spec.ts` passes its three tests with intent comments.

### Behavioral Correctness

- [x] A-016 R5: Selecting a candidate in the Settings row never calls the restart endpoint by itself.
- [x] A-017 R1: No new stream field — `StreamEntry` and the `event: gui` payload are byte-identical to before.
- [x] A-018 R9: `GuiOffDialog` behavior and its existing tests are unchanged after the shell extraction.

### Scenario Coverage

- [x] A-019 R1: Go test — `LookPath` hits for `icewm-session`+`startlxqt` only ⇒ exactly those two candidates, in order, with correct labels/kinds.
- [x] A-020 R3: Go test — no hits ⇒ `wm_candidates: []` plus the LXQt install hint.
- [x] A-021 R13: Vitest — `buildGuiActions` gating and row position for `gui-desktop`; palette rows match `wm_candidates` with the current one marked.
- [x] A-022 R15: Playwright — `LXQt` → confirm names apps → `Later` ⇒ one settings POST, zero restart calls; `Restart` ⇒ one restart POST.

### Edge Cases & Error Handling

- [x] A-023 R7: A rejected `fetchGuiStatus` in the Settings row degrades to the text field without an error state.
- [x] A-024 R12: A rejected lazy loader shows `Couldn't load choices` and Esc still closes the palette.
- [x] A-025 R9: A restart `{ok:false, disabled:true}` or thrown error toasts and closes cleanly; the written pin stands.
- [x] A-026 R1: A nil `LookPath` yields an empty candidate list and no panic.

### Code Quality

- [x] A-027 Pattern consistency: new Go code follows the `internal/gui` pure-seam style (injected `lookPath`, no exec); new React code follows the named-key-override, one-registry-seam, and mount-once-at-AppLayout patterns.
- [x] A-028 No unnecessary duplication: the dialog and palette share `lib/gui-desktop.ts` + `useDesktopPick`; the restart dialog shares the off-dialog shell; `sessionStarters` is derived from the exported order slice.
- [x] A-029 Type narrowing over assertions: no `as` casts in the new frontend code; `kind` handled as a string union with guards.
- [x] A-030 Tests accompany every behavior change (Go, vitest, Playwright) and Playwright tests carry Proves/Steps blocks.
- [x] A-031 No comment narration: comments state cross-file contracts (the alias collapse, the pre-enabled derivation, the no-recursion sub-list rule), never history or change IDs.
- [x] A-032 No polling: the status document is fetched once per control mount / sub-step entry / confirm open.

### Security

- [x] A-033 R1: Candidate derivation performs `LookPath` only — never executes a binary or a package manager; the chosen name reaches the supervisor through the existing validated `gui.wm` write path.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- On this VM `icewm-session`, `openbox`, `kwin_x11`, `x-session-manager`, `startlxqt`(+`lxqt-session`), and `startplasma-x11` all resolve, so the live picker lists more rows than the plan's `IceWM`/`LXQt` example — that example describes a host with only those two installed.

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The pre-existing free-text `gui.wm` control (`TextEntryControl`) survives by design as the picker's pre-resolution/fetch-failure fallback and the `Other…` reveal; the off-confirm's inline fetch/body/buttons code moved into `gui-confirm-shell.tsx` in place (no leftover copy); `restartGui`, the restart endpoint, and the `rk gui wm` CLI verb all keep their existing callers.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The select lives in `settings-all-panel.tsx`'s `EntryControl` as a `gui.wm` named-key override (new `gui-wm-picker.tsx`), not in `settings-dialog.tsx` — there is no GUI tab; `gui.wm` is a registry `string` rendered only by the All-settings table | The intake's `settings-dialog*.tsx` glob predates the All-panel split; the `theme_dark` override is the established seam and Constitution IV forbids a second settings surface | S:70 R:85 A:90 D:80 |
| 2 | Confident | The picker hint field is `wm_candidates_hint` (Go `WMCandidatesHint`), since `WMHint`/`wm_hint` already exists for the bare-WM line | The intake names `WMHint` for the new field while requiring it be distinct from the existing `wm_hint`; a second name resolves the collision | S:65 R:90 A:90 D:75 |
| 3 | Confident | DE alias starters collapse into their primary (`lxqt-session` hidden when `startlxqt` is installed; alias alone carries the DE label) | `lxqt-core` installs both; the acceptance list shows one `LXQt` row; `hint.go` already pairs the names | S:60 R:85 A:85 D:70 |
| 4 | Certain | Candidates and the hint are computed before the `!Enabled` short-circuit in `Assemble` | PATH-only derivation needs no daemon gate; the Settings row must work while the GUI is off (the `rk gui wm` bare-set rule) | S:80 R:90 A:90 D:85 |
| 5 | Confident | The palette sub-list is a generic lazy `PaletteAction.subList`; rows load on entry from a one-shot status + settings fetch | No sub-list mechanism exists; the document is fetched one-shot on dialog opens by precedent and never joins the stream | S:70 R:80 A:85 D:70 |
| 6 | Confident | The palette sub-list omits `Other…` and renders the install hint as a trailing disabled row; the Settings dialog renders the hint as a footer line | A typed binary needs a text field the palette lacks; intake assumption 7 leaves palette hint placement to the implementer | S:60 R:90 A:80 D:70 |
| 7 | Confident | When the GUI is disabled the flow writes the pin, skips the confirm, and toasts that it takes effect when the GUI turns on | `POST /api/gui/{id}/restart` returns 409 while disabled; mirrors the CLI's bare-set-while-off and `--restart` refusal | S:65 R:85 A:85 D:75 |
| 8 | Confident | Restart-confirm copy: title `Restart the desktop now?`, body `Running apps will close: <apps>` / `No apps are running on display <d>.` / not-running line; buttons `Later` and `Restart` | Plan L-D9 fixes the sentence and the two verbs; the empty/not-running variants follow the off-dialog's grammar | S:75 R:90 A:85 D:80 |
| 9 | Certain | Candidate order is ladder order then the fixed session-starter order, deduplicated by name | Intake assumption 9 allows any documented stable order; this one is derivable from existing tables | S:70 R:90 A:90 D:80 |
| 10 | Confident | Auto is written as `null` (unset) through the registry seam and `""` through the palette's `postSettings`, both reading back as the empty pin | The registry's unset convention for scalars; `gui.wm` serializes omitted-when-empty either way | S:60 R:90 A:85 D:75 |

10 assumptions (2 certain, 8 confident, 0 tentative).

# Plan: Settings Pane + Live Apply

**Change**: 260823-5r41-settings-pane-live-apply
**Intake**: `intake.md`

## Requirements

### Backend: auto_name goes live

#### R1: Registry flip
The `auto_name` registry entry (`app/backend/internal/settings/settings.go:301-320`) SHALL carry `live: true`. The stale restart-bound doc comments MUST be rewritten: the `Settings.AutoName` field comment (`settings.go:66-71`) and the `Server.autoNameEnabled` field comment (`app/backend/api/router.go:179-185`). The pinned metadata row in `internal/settings/registry_test.go:33-44` updates to `live: true`.

- **GIVEN** `GET /api/settings`
- **WHEN** the `auto_name` row is read
- **THEN** it carries `"live": true`

#### R2: POST rewires the auto-name tracker, race-free
`handlePostSettings` (`app/backend/api/settings.go:81`) SHALL, after a successful save whose body contains `auto_name`, apply the new value to the running SSE hub: disable → the hub's tracker becomes nil; enable → a freshly-constructed tracker with the `deliver` closure wired (the same wiring `initSSEHub` performs at `router.go:268-274`, extracted into one shared seam so the two call sites cannot drift). The swap MUST be race-free against the tick-loop readers (`api/sse.go:1437-1441` advance, `:1594-1596` retain) — guarded field access, verified under `-race`. The existing `board_order` broadcast side effect (`api/settings.go:120-126`) SHALL be preserved, and no other key gains a side effect. Toggling on after off MAY drop prior in-memory cooldowns (Constitution II: process-memory only).

- **GIVEN** a running daemon with `auto_name` off and an idle→busy→idle window cycle
- **WHEN** `{"auto_name": true}` is POSTed and the window next transitions busy→idle
- **THEN** the tracker emits a candidate on the next tick with no daemon restart
- **AND** POSTing `{"auto_name": false}` (or `null`) stops future emissions
- **GIVEN** a POST body without `auto_name`
- **WHEN** it succeeds
- **THEN** the tracker wiring is untouched (no rewire call)

#### R3: Enum kinds carry options
`registryEntry` SHALL gain an `options []string` field, set on `theme` (`system`, `dark`, `light`) and `log_level` (`info`, `debug`), surfaced through `KeyInfo` (`settings.go:500`), `Registry()` (`settings.go:512`), and the `GET /api/settings` wire struct (`api/settings.go:15` `settingEntry`) as `"options"`, omitted when empty. Apply validators keep owning enforcement — the field is display metadata.

- **GIVEN** `GET /api/settings`
- **WHEN** the `log_level` row is read
- **THEN** it carries `"options": ["info", "debug"]`
- **AND** the `ssh_host` row carries no `options` key

### Frontend: client surface

#### R4: Generic client exports
`src/api/client.ts` SHALL export `SettingsEntry` (gaining `options?: string[]`), `getSettingsEntries()` (`client.ts:1034`, keeping `deduplicatedFetch`), and `postSettings(patch)` (`client.ts:1062`). The 13 per-key wrappers (`client.ts:1071-1163`) stay untouched.

- **GIVEN** the settings dialog needs the registry
- **WHEN** it imports from `@/api/client`
- **THEN** the generic typed GET/POST surface is available without new fetch code

### Frontend: the All-settings tab

#### R5: Fourth tab
The settings dialog SHALL gain an **All settings** tab — tab order General, Appearance, All settings, Shortcuts. `SettingsTab` (`src/contexts/settings-dialog-context.tsx:4`) widens to add `"all"`. Tab-less `openSettings()` semantics are unchanged (lands General when closed; tab-preserving no-op when open); `shortcuts-overlay` and the `KeyboardMenuRow` deep-link keep targeting `"shortcuts"` unchanged.

- **GIVEN** the dialog is open
- **WHEN** the tab list renders
- **THEN** four tabs render in the order above, with roving-tabindex arrow nav intact

#### R6: Registry-driven searchable table
The All-settings tab SHALL render a search field above a dense flat list generated from `GET /api/settings`: rows in registry order, grouped under category headers rendered from the `category` field (title-cased; `ScopeHeading` underlined-rule styling), rows rendered only for `ui: true` entries. Search is a substring filter over key, description, and category (the palette haystack precedent, `command-palette.tsx:82-88`); a category header hides when all its rows are filtered out.

- **GIVEN** the All-settings tab with the 12-key registry
- **WHEN** it renders unfiltered
- **THEN** every `ui: true` key appears exactly once under its category header, in registry order
- **WHEN** "log" is typed in the search field
- **THEN** only matching rows (and their headers) remain

#### R7: Typed controls per kind, key overrides
Each table row's control SHALL resolve by kind — `bool` → toggle, `enum` → select over the entry's `options`, `string`/`path` → the `TextSetting` contract (Enter/blur commit, Escape cancel, inline `role="alert"` rejection), `color` → the `SwatchPopover` descriptor control — with key overrides: `theme_dark`/`theme_light` render as selects over the client theme registry (`themes.ts` list), never free text; `instance_color` binds the accent context so the top-bar stripe repaints optimistically. `ThemePairControl` stays the Appearance tab's rich theme surface, untouched.

- **GIVEN** the `auto_name` row
- **WHEN** its toggle is flipped
- **THEN** `postSettings({auto_name: <bool>})` fires and the row updates optimistically
- **GIVEN** the `theme_dark` row
- **WHEN** its control opens
- **THEN** it offers only valid theme ids from the client theme list

#### R8: Map/list rows are read-only
`map`/`list` kinds (`server_colors`, `server_flairs`, `board_order`) SHALL render read-only: description, a current-value summary (entry count / ordered names), the modified indicator, and a hint naming their dedicated editing surface (sidebar pickers, board sidebar) and the config.yaml escape hatch. No generated editor.

- **GIVEN** the `server_colors` row with two stored entries
- **WHEN** it renders
- **THEN** it shows a two-entry summary and no editable control

#### R9: Modified-from-default indicator
Every table row SHALL compare the row's **effective value — read through the seam's single read path (`settingValue(key)`), never the raw fetched entry** — against the registry `default` per kind (`null`-equals-empty for unset scalars; `{}`/`[]` for nested) and render a modified dot when they differ (the shortcuts-panel own-default dot is the visual precedent). The dot and the row's control MUST derive from the same read path, so a write through ANY route (context setter or generic POST) is reflected in both without per-key mirroring lists — per-key mirror switches are the defect class this rule forbids (rework cycles 1 and 3). No per-row reset action in this change.

- **GIVEN** `theme` stored as `dark` (default `system`)
- **WHEN** the row renders
- **THEN** the modified dot shows; after a POST of `null` resets it, the dot clears

#### R10: Requires-restart badge
Every `live: false` row (`tmux_conf`, `log_level` after R1) SHALL render a "requires restart" badge driven by the GET payload's `live` flag — no frontend key list.

- **GIVEN** the `log_level` row
- **WHEN** it renders
- **THEN** the badge shows; the `auto_name` row shows none

#### R11: Escape hatch
The All-settings tab SHALL carry a footer row rendering the constant path `~/.config/run-kit/config.yaml` with a copy-to-clipboard button (`lib/clipboard.ts` `copyToClipboard`) and a one-line hint that map/list keys and comments are edited there. No open-in-editor backend.

- **GIVEN** the footer
- **WHEN** copy is clicked
- **THEN** the path lands on the clipboard and the button confirms

#### R12: One state seam, drift-guarded duplication
The `SettingsEntry[]` fetch + state SHALL hoist to the dialog-body level — one fetch per open, replacing the ad-hoc per-open `getSSHHost()` fetch (`settings-dialog.tsx:487-497`). Curated rows and table rows read/write through that one seam; keys with existing optimistic contexts (theme via `setTheme`, `instance_color` via `useInstanceAccent().setColor`, `instance_name` via `useInstanceName().setInstanceName`) still route writes through those setters so in-tab consumers repaint as today; keys without contexts POST via `postSettings` and update the shared dialog state. A backend 400 surfaces inline on the row.

- **GIVEN** the dialog open with `auto_name` toggled on from the General curated row
- **WHEN** the user switches to the All-settings tab
- **THEN** the `auto_name` table row shows the new value without a refetch

#### R13: Curated auto_name General row
The General tab SHALL gain a curated `auto_name` toggle row under the This-host scope group ("Auto-name tabs" wording; sublabel from the registry description), writing through the same seam as its table row. `log_level`/`tmux_conf` stay table-only.

- **GIVEN** the General tab
- **WHEN** the toggle is flipped and the dialog reopened
- **THEN** the persisted value round-trips through `GET /api/settings`

#### R14: Settings: All palette entry
A `Settings: All` palette entry (id `settings-all`, `openSettings("all")`) SHALL be added beside `Settings: Appearance` in `use-global-palette-actions.ts` (`:166-175`). Existing entries are untouched.

- **GIVEN** the command palette
- **WHEN** "Settings: All" is run
- **THEN** the dialog opens on the All-settings tab

### Non-Goals

- No `/settings` route (backlog `[3n73]`); no yaml view, read-only or editable (settled with the user at intake).
- No generic `settings-changed` SSE broadcast; no cross-tab push for frontend-consumed keys.
- No per-setting palette actions beyond the `Settings: All` deep-link.
- No per-row reset-to-default action (follow-up candidate).
- No change to `api/auto_name.go` tracker logic, the per-key client wrappers, or curated General/Appearance controls other than the added auto_name row.

### Design Decisions

#### Two-level model: curated tabs + everything-table
**Decision**: keep General/Appearance/Shortcuts curated and add an All-settings registry table tab; six keys deliberately appear in both presentations over one dialog-level state seam.
**Why**: the VSCode settings-UI/settings.json model the user chose — palatable curated controls plus an exposes-everything surface that future registry keys join for free; one state seam makes duplication drift-proof.
**Rejected**: replacing General/Appearance with the flat list (loses the curated UX); a yaml view (browser never sees file bytes — a client-side rendering is a second serializer that drifts and drops comments; serving/writing raw bytes is forbidden backend surface; the omit-when-default file is near-empty so the table strictly dominates).
*Introduced by*: 260823-5r41-settings-pane-live-apply

#### auto_name liveness via POST-driven tracker rewire, no broadcast
**Decision**: the settings POST rewires the hub's auto-name tracker in place; no generic settings-changed SSE event is added.
**Why**: `live` means "applies on next read without restart" — every other live key already honors it per its read cadence; auto_name's read-once-at-construction seam was the only violation. Cross-tab push is new backend surface the invocation forbids.
**Rejected**: per-tick `settings.Load()` in the hub (file I/O every ~2s per server for one bool); a settings-changed broadcast (unneeded surface).
*Introduced by*: 260823-5r41-settings-pane-live-apply

#### Enum options ride the registry
**Decision**: `registryEntry.options []string` for enum kinds, served through KeyInfo and GET.
**Why**: a generated enum control needs options as data and the registry is the single source of truth; today `log_level`'s legal values exist only inside parse/apply closures.
**Rejected**: hardcoding options in the frontend (drifts from the registry, defeats generation).
*Introduced by*: 260823-5r41-settings-pane-live-apply

## Tasks

### Phase 1: Backend

- [x] T001 Add `options []string` to `registryEntry`, set on `theme` + `log_level`; plumb through `KeyInfo`/`Registry()` (`app/backend/internal/settings/settings.go:188,223-353,500-530`); extend `internal/settings/registry_test.go` for options + order <!-- R3 -->
- [x] T002 Flip `auto_name` to `live: true` (`settings.go:301-320`); rewrite the restart-bound doc comments (`settings.go:66-71`, `api/router.go:179-185`); update the pinned row in `registry_test.go:33-44` <!-- R1 -->
- [x] T003 Extract the tracker wiring from `initSSEHub` (`api/router.go:268-274`) into one shared, race-guarded hub apply seam (e.g. `sseHub.setAutoName(enabled, deliver)`); make the tick-loop reads (`api/sse.go:1437,1594`) safe against the swap <!-- R2 -->
- [x] T004 Wire `handlePostSettings` (`api/settings.go:81`) to call the seam when `auto_name` is in the body; carry `options` in `settingEntry` (`api/settings.go:15`); update/extend `api/settings_test.go` (rewire on/off, `:415` no-other-side-effect pin updated, GET options shape) and run `go test -race ./...` in `app/backend` <!-- R2 -->

### Phase 2: Frontend core

- [x] T005 [P] Export `SettingsEntry` (+`options?: string[]`), `getSettingsEntries`, `postSettings` from `src/api/client.ts:1022-1069`; extend `src/api/client.test.ts:1151+` for the exported surface <!-- R4 -->
- [x] T006 [P] Widen `SettingsTab` to include `"all"` (`src/contexts/settings-dialog-context.tsx:4`); update `settings-dialog-context.test.tsx` <!-- R5 -->
- [x] T007 <!-- rework: review cycle 1 must-fix — instance_name excluded from the seam (settings-registry-seam.ts:62-126): settingValue falls through to stale entries and commitSetting never calls updateEntryValue; mirror the ssh_host case (R12/A-012) --> Hoist `SettingsEntry[]` fetch + optimistic state to the dialog body (`src/components/settings-dialog.tsx:479+`), replacing the ad-hoc ssh fetch (`:487-497`); expose read/write to all tab panels; route writes through existing context setters where they exist, `postSettings` otherwise; inline 400 surfacing <!-- R12 -->
- [x] T008 <!-- rework: review cycle 1 should-fix — category <section> keyed on category name risks duplicate React keys (settings-all-panel.tsx:428-435); key on group identity instead --> Build the All-settings panel: search field, category headers from `category` (ScopeHeading styling), registry-order `ui: true` rows, substring filter with header hiding — new component(s) beside `settings-dialog.tsx`; add the tab to `SettingsTabList` (`settings-dialog.tsx:410`) in position 3 <!-- R5, R6 -->
- [x] T009 <!-- rework: review cycle 3 should-fix — the theme enum select binds settingValue('theme') with no out-of-list fallback; a named-theme preference renders the select blank (settings-all-panel.tsx:270-278); apply the same no-commit fallback-to-default guard the theme_dark/theme_light override already uses --> <!-- rework: review cycle 2 (orchestrator-escalated from should-fix) — the table theme enum select commits setTheme("dark"/"light"), which theme-context's unknown-id branch turns into persisted theme:"system" (settings-registry-seam.ts:86); route mode picks via the Appearance pattern (setTheme(themeDark)/setTheme(themeLight) slot ids) and cover the commit path with a non-mocked test --> <!-- rework: review cycle 1 must-fix — TextEntryControl (settings-all-panel.tsx:149-220) clones TextSetting's draft/commit/Escape core instead of reusing it (A-022); extract one shared text-setting core consumed by both --> Implement the kind→control map (bool toggle, enum select over `options`, string/path TextSetting, color SwatchPopover) with the key overrides (theme_dark/theme_light → `themes.ts` selects; instance_color → accent context) <!-- R7 -->
- [x] T010 [P] Render map/list rows read-only with value summary + dedicated-surface hint <!-- R8 -->
- [x] T011 <!-- rework: review cycle 3 (plan revised) — isModified reads the raw fetched entry, stale for theme/instance_color/non-null theme_dark/theme_light (settings-all-panel.tsx:50-61); R9 now REQUIRES deriving the dot from settingValue(key), the seam's single read path — implement that derivation (no per-key mirror lists) and test a context-backed key's dot across toggle+reset (A-009) --> Modified-from-default dot (per-kind compare vs `default`) and `requires restart` badge on `live: false` rows <!-- R9, R10 -->
- [x] T012 [P] Escape-hatch footer: constant path + `copyToClipboard` + hint <!-- R11 -->
- [x] T013 Add the curated `auto_name` toggle row to the General panel (`settings-dialog.tsx:536+`) under This host, wired through the T007 seam <!-- R13 -->
- [x] T014 [P] Add the `Settings: All` palette entry (`src/hooks/use-global-palette-actions.ts:166-175`); update `use-global-palette-actions.test.tsx` <!-- R14 -->

### Phase 3: Integration & tests

- [x] T015 Extend `src/components/settings-dialog.test.tsx` for the four-tab shape: table rows from a mocked registry payload, search filtering, control commits (bool/enum/string), modified dot, restart badge, read-only map/list rows, escape-hatch copy, General auto_name row committing the same patch as its table row <!-- R6, R7, R8, R9, R10, R11, R12, R13 -->
- [x] T016 Extend `app/frontend/tests/e2e/settings-dialog.spec.ts` (+ companion `.spec.md`, same commit): real-`$HOME` config.yaml snapshot/restore, palette open → All settings → search → toggle `auto_name` → persistence asserted via `GET /api/settings`, restart badge visible on `log_level` <!-- R6, R10, R13 -->
- [x] T017 Run the verification gates in order: `just test-backend`, `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, targeted `just test-e2e "settings-dialog.spec.ts"`, then `just build` <!-- R1 -->

## Execution Order

- T001–T004 sequential (T003 blocks T004); Phase 2 may start after T001 lands the `options` shape (T005 mirrors it).
- T007 blocks T008/T009/T013; T005/T006 block T007.
- T015 after T008–T014; T016 after T015; T017 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `GET /api/settings` reports `auto_name` with `live: true`; stale restart-bound comments are gone
- [x] A-002 R2: POSTing `auto_name` toggles the running tracker without restart, both directions; a body without `auto_name` never touches the wiring
- [x] A-003 R3: enum rows carry `options` (theme, log_level); non-enum rows omit the key; validators unchanged
- [x] A-004 R4: `SettingsEntry`/`getSettingsEntries`/`postSettings` exported and typed; per-key wrappers untouched
- [x] A-005 R5: four tabs in order General/Appearance/All settings/Shortcuts; `SettingsTab` includes `"all"`; existing chord/deep-link semantics unchanged
- [x] A-006 R6: All-settings renders every `ui: true` key once, registry-ordered under title-cased category headers; search filters rows and hides empty headers
- [x] A-007 R7: controls resolve by kind with the theme-list and accent-context overrides; ThemePairControl untouched on Appearance
- [x] A-008 R8: map/list rows read-only with summary + hint
- [x] A-009 R9: modified dot tracks value≠default per kind, including null/empty and `{}`/`[]` cases — VERIFIED (review cycle 4): `entries` exposes the mirrored list, so `isModified` reads the same derived read path as the row controls (theme/instance_name covered by settings-dialog.test.tsx:807+ "the modified dot tracks a context-backed key through the seam across toggle and reset"). Remaining gap (instance_color Clear path) recorded as review finding #1.
- [x] A-010 R10: restart badge on exactly the `live: false` rows, driven by payload data
- [x] A-011 R11: footer shows the constant path, copies it, and names the raw-edit channel
- [x] A-012 R12: one dialog-level state seam — curated and table presentations of the same key cannot disagree within an open dialog; context-backed keys still repaint their in-tab consumers optimistically
- [x] A-013 R13: General carries the curated auto_name toggle under This host, sharing the seam
- [x] A-014 R14: `Settings: All` palette entry opens the All-settings tab

### Behavioral Correctness

- [x] A-015 R2: the tracker swap is race-free under `go test -race`; board_order broadcast preserved; no new broadcast for any other key
- [x] A-016 R12: a backend 400 on a table write surfaces inline on the row and does not clobber the stored value

### Scenario Coverage

- [x] A-017 R2: handler tests cover rewire-on, rewire-off, and absent-key no-op (the `:415` pin updated, not deleted)
- [x] A-018 R6/R13: e2e drives palette → All settings → toggle auto_name → GET-verified persistence, with `$HOME` snapshot/restore and an updated companion `.spec.md`

### Edge Cases & Error Handling

- [x] A-019 R9: unset scalar (`null` value, empty default) renders unmodified; a stored-then-cleared key returns to unmodified
- [x] A-020 R7: theme_dark/theme_light controls cannot submit a value outside the client theme list

### Code Quality

- [x] A-021 Pattern consistency: new components follow the settings-dialog conventions (PreferenceRow/ScopeHeading/TextSetting reuse, `min-[480px]:` single breakpoint, Tip-not-title on icon controls)
- [x] A-022 No unnecessary duplication: reuses `copyToClipboard`, `SwatchPopover`, `TextSetting`, `deduplicatedFetch`, existing context setters; no second serializer or fetch layer
- [x] A-023 Type narrowing over assertions: no `as` casts in the new control resolution (discriminated on `kind` with guards)
- [x] A-024 Tests included for added behavior at all three levels (Go handler/registry, Vitest, Playwright) per code-quality.md
- [x] A-025 No comment narration; comments state constraints only (e.g. the race guard invariant, the one-seam rule)

### Security

- [x] A-026 R2: no new subprocess or shell surface; hub swap introduces no unsynchronized shared state (`-race` clean)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/frontend/src/api/client.ts:1147-1156` (`getSSHHost`/`setSSHHost`) — zero production call sites after the dialog moved to `getSettingsEntries`/`postSettings` (only their own client.test.ts suite still references them)
- `app/frontend/src/api/client.ts` (`setInstanceName` per-key wrapper) — now a single-consumer wrapper: production call sites are down to one (instance-name-context) after the dialog moved to the seam; fold into the context or keep as that context's API layer — review cycle 4, follow-up only

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Tab id is `"all"`, wire field name is `options` (JSON `omitempty`), badge copy is "requires restart" | Smallest names consistent with existing conventions; all trivially renameable | S:55 R:90 A:85 D:70 |
| 2 | Confident | The table gets a compact row component of its own (denser than PreferenceRow) reusing ScopeHeading/TextSetting primitives | The curated grid is label-column-wide by design; a dense table row is the VSCode feel the user asked for; primitives stay shared | S:55 R:85 A:80 D:65 |
| 3 | Confident | Hub seam shape: setter on `sseHub` taking the wired tracker (or nil), field guarded by a dedicated small mutex; `initSSEHub` and the POST handler both go through it | Keeps tick sites one-line guarded reads; exact naming left to apply | S:60 R:80 A:85 D:70 |
| 4 | Certain | General curated row placement: This-host scope group, after SSH host | Only This-host group fits a config.yaml key; order is cosmetic | S:70 R:95 A:90 D:85 |
| 5 | Confident | Seam shape applied as: `sseHub.setAutoName(enabled bool, deliver func(...))` + guarded `sseHub.getAutoName()` accessor behind a dedicated `autoNameMu` mutex; the deliver closure is built once by a `Server.autoNameDeliver()` helper so `initSSEHub` and the POST handler share identical wiring; POST applies the post-merge value (null-unset → false) | Setter-on-hub with a dedicated mutex is Assumption #3's shape; passing the closure as a parameter keeps the hub Server-free (mirroring the captureFn/chatResolver injection idiom) while one builder prevents the two call sites drifting | S:60 R:80 A:85 D:70 |
| 6 | Confident | The dialog-level seam lives in a hook module beside the dialog (`settings-registry-seam.ts`, `useSettingsRegistry()`): one mount-gated fetch per open; context-backed keys (theme/theme_dark/theme_light/instance_color/instance_name) read from their live contexts and write through those contexts' setters; context-less keys read from the fetched list and POST via `postSettings` with optimistic list updates | Keeps curated rows and table rows of the same key on one state; a context repaint never waits on the registry fetch; the ThemeProvider never reverts an API-confirmed preference, so context reads are authoritative for their keys | S:60 R:80 A:85 D:70 |
| 7 | Confident | Enum/theme selects commit immediately on change with no clear affordance (every option is a legal value; null-unset stays available via the config escape hatch); an out-of-list stored theme id renders as the entry's registry default WITHOUT committing | Closed selects can't express "unset" cleanly; a render-time fallback that silently POSTed would rewrite a stored value the user never touched | S:55 R:75 A:80 D:65 |
| 8 | Confident | Category headers call `ScopeHeading` with an empty hint, which now renders no right-aligned span (empty hints previously rendered as whitespace) | The underlined-rule styling is the shared bit; an empty hint span contributed only layout noise | S:50 R:80 A:80 D:60 |
| 9 | Confident | The All-settings e2e extends `settings-dialog.spec.ts` in place (one new test) rather than a sibling spec — one test that reuses the existing `$HOME` snapshot/restore fixture and `openPaletteSettings` pattern; the companion `.spec.md` gains the matching entry in the same change | Intake §8 allows either shape; a sibling spec would duplicate the beforeAll/afterAll fixture for a single test | S:50 R:85 A:80 D:65 |
| 10 | Confident | The shared text-setting core is a hook module (`components/text-setting-core.tsx`): `useTextSettingDraft(value, commit)` owns the draft/commit/Escape state machine; `textSettingInputClass` and `TextSettingError` carry the shared input styling and inline alert; both `TextSetting` (PreferenceRow-wrapped) and the table's `TextEntryControl` consume it | The duplicated logic was state machine + styling + error markup; a hook keeps each call site's wrapper markup (PreferenceRow vs bare div) intact while making the commit contract single-sourced | S:55 R:85 A:85 D:65 |
| 11 | Confident | The General curated instance-name row commits through the seam (`commitSetting("instance_name", …)`) instead of calling `setInstanceName` directly; the seam mirrors the context value in `settingValue` and calls `updateEntryValue` on commit | Review cycle 1 must-fix: the context setter is fire-and-forget (failure toasts), so resolving immediately preserves the field contract while the list mirror keeps the table row and its modified dot in sync without a refetch | S:60 R:80 A:85 D:65 |
| 12 | Certain | The table's `theme` enum select maps mode values to the per-mode slot id before calling `setTheme` (`dark` → `setTheme(themeDark)`, `light` → `setTheme(themeLight)`, `system`/empty → `setTheme("system")`) — the exact mapping the Appearance tab's mode buttons use | Review cycle 2: mode words are not theme ids, so a bare `setTheme("dark")` hits the context's unknown-id branch and persists `theme: "system"`; the mapping must live at the seam because the table's enum control can only emit the entry's `options` values | S:90 R:80 A:90 D:85 |
| 13 | Certain | The seam's read path is ONE derived list: `entriesWithMirrors` overlays live context values (theme/theme_dark/theme_light/instance_name/instance_color) onto the fetched entries; `settingValue` and the exposed `entries` both read from it, so the row's control and its modified dot cannot diverge and no per-key mirror switch exists in consumers | Review cycle 3 (R9 revised): per-key mirror switches caused the cycle-1 (instance_name) and cycle-3 (theme/instance_color/slots) defects — the overlay makes mirroring a derivation, not a per-key write path; the accent context mirrors ONLY when `isExplicit` (its `color` falls back to a localStorage echo seed while its fetch pends) | S:85 R:85 A:90 D:85 |
| 14 | Confident | The theme enum select applies the same no-commit fallback-to-default guard as the theme_dark/theme_light override: an out-of-list effective value (a stored named-theme preference) renders the entry's registry default WITHOUT committing, never a blank select | Review cycle 3 should-fix: a named-theme preference is legal for the key but not an enum option; silently committing the default would rewrite a stored value the user never touched | S:70 R:80 A:85 D:70 |
| 15 | Confident | `ScopeHeading` lives in `text-setting-core.tsx` (shared with the All-settings panel) and `settings-dialog.tsx` re-exports it for its historical import sites — breaks the dialog↔panel circular import without moving every call site | The panel↔dialog cycle survived only via function-declaration hoisting; the shared module is the natural home beside the other dialog primitives | S:55 R:85 A:80 D:65 |

15 assumptions (4 certain, 11 confident).

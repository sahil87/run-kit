# Plan: Spawn Dialog Follow-up — Fab-Gated Tier Field + Sidebar Spawn Entry

**Change**: 260714-gsmu-spawn-dialog-tier-gate-sidebar-entry
**Intake**: `intake.md`

## Requirements

### Backend: fab-project gate for `tiers`

#### R1: `fabconfig.IsFabProject` detects a fab project by config presence
`fabconfig.IsFabProject(repoRoot string) bool` SHALL return true iff `{repoRoot}/fab/project/config.yaml` exists, using a single `os.Stat` (no YAML parse, no subprocess). An empty `repoRoot` SHALL return false.

- **GIVEN** a `repoRoot` whose `fab/project/config.yaml` exists
- **WHEN** `IsFabProject(repoRoot)` is called
- **THEN** it returns `true`
- **AND** **GIVEN** a `repoRoot` with no such file (or an empty `repoRoot`), it returns `false`

#### R2: `handleRiffPresets` gates `tiers` on fab-project detection
The `GET /api/riff/presets` handler SHALL read `tiers = ReadTiers(repoRoot)` only when `IsFabProject(repoRoot)` is true; otherwise `tiers` SHALL be an empty array. The `tiers` key SHALL remain present in the JSON response in both cases (response shape unchanged/additive, Constitution IX). The `presets` field behavior is UNCHANGED.

- **GIVEN** a session whose repo root is a fab project (config.yaml present)
- **WHEN** `GET /api/riff/presets` is served
- **THEN** the response `tiers` is non-empty (built-ins ∪ `agent.tiers`, `default` first)
- **AND** **GIVEN** a session whose repo root is a git repo but NOT a fab project (no config.yaml), the response `tiers` is `[]` (present, empty)

#### R3: `POST /api/riff` stays permissive for `tier` in non-fab repos
The spawn endpoint SHALL NOT introduce a new 400 for a non-empty `tier` against a non-fab repo. A supplied `tier` continues to be validated by `validate.ValidateTier` and resolves via the engine's existing silent `DefaultLauncher` fallback. `ReadTiers`'s own contract (built-ins fallback on malformed-but-present config) is UNCHANGED.

- **GIVEN** a non-fab repo session and a request body carrying a well-formed `tier`
- **WHEN** `POST /api/riff` is served
- **THEN** the request is accepted (no new 400) and resolves through the documented `DefaultLauncher` fallback

### Frontend: conditional Agent Tier field

#### R4: The Agent Tier field renders only when `tiers` is non-empty
`SpawnAgentDialog` SHALL render the Agent Tier field (label `Agent Tier:`, `aria-label="Agent tier"`) only when the fetched `tiers` array is non-empty. When `tiers.length === 0` the field SHALL be absent entirely — no label, no hint text, no disabled control — and `tier` SHALL NOT be included in the spawn POST body.

- **GIVEN** the preflight fetch returns `tiers: []`
- **WHEN** the dialog renders
- **THEN** no Agent Tier control is present
- **AND** submitting the dialog omits `tier` from the POST body
- **GIVEN** the preflight returns a non-empty `tiers`, the Agent Tier field renders and defaults to `default`

#### R5: The preflight-failure fallback keeps the field visible
When `getRiffPresets` rejects, the dialog SHALL keep `tiers = [DEFAULT_TIER]` (`["default"]`), so the Agent Tier field remains shown (conservative status quo — on fetch failure the repo's fab-ness is unknown).

- **GIVEN** the preflight fetch rejects
- **WHEN** the dialog renders
- **THEN** the Agent Tier field is shown with value `default`

### Frontend: sidebar session-row spawn entry

#### R6: A bot spawn button sits left of `+` in the session-row cluster
`SessionRow`'s trailing icon cluster SHALL become `[🎨 palette] [🤖 bot] [+] [✕]` — the bot button placed immediately LEFT of `+`, so `+`/`✕` keep their edge positions. The button SHALL use the same affordance classes as the palette sibling (hover-revealed `opacity-0 group-hover:opacity-100 coarse:opacity-100`, `min-h-[24px] coarse:min-h-[36px]`), carry `aria-label={`Spawn agent in ${session.name}`}`, call `e.stopPropagation()`, and render ONLY when an `onSpawnAgent` handler prop is present.

- **GIVEN** a `SessionRow` rendered with an `onSpawnAgent` handler
- **WHEN** the row renders
- **THEN** a button labelled `Spawn agent in {name}` is present, positioned before the `New window in {name}` button
- **AND** clicking it invokes `onSpawnAgent(server, session.name)` and stops propagation
- **GIVEN** no `onSpawnAgent` handler, the button is absent

#### R7: A lucide-style `BotIcon` matches the sidebar icon idiom
`sidebar/icons.tsx` SHALL export a `BotIcon` — a lucide-style `bot` (robot head) stroke SVG matching the `PaletteIcon` idiom (`stroke="currentColor"`, `aria-hidden`, same box/size defaults).

- **GIVEN** the sidebar renders the bot spawn button
- **WHEN** `BotIcon` is drawn
- **THEN** it is an `aria-hidden` `currentColor` stroke SVG consistent with `PaletteIcon`

#### R8: `onSpawnAgent` is threaded Sidebar → ServerGroup → SessionRow as an optional prop
`Sidebar` SHALL accept an optional `onSpawnAgent?: (server: string, session: string) => void`, thread it through `ServerGroup` to each `SessionRow` (mirroring `onColorChange`'s optional pattern). The board-route sidebar SHALL pass NO handler (button hidden there — Non-Goals).

- **GIVEN** `Sidebar` is rendered with an `onSpawnAgent` prop
- **WHEN** a session row renders
- **THEN** the row receives the handler and shows the bot button
- **AND** **GIVEN** no `onSpawnAgent` prop, no row shows the button

### Frontend: explicit spawn target in app.tsx

#### R9: The spawn target is explicit `{server, session}` state
`app.tsx` SHALL replace the boolean `showSpawnAgentDialog` with `spawnAgentTarget: {server, session} | null`. All three entry points SHALL set it: the palette `Agent: Spawn` action and the window-switcher `+ New Agent` pass the CURRENT `{server, sessionName}` (behavior unchanged); the sidebar bot button passes the ROW's `{server, session}`. The dialog renders iff `spawnAgentTarget` is non-null.

- **GIVEN** the palette or window-switcher entry point fires on a terminal route
- **WHEN** the handler runs
- **THEN** `spawnAgentTarget` is set to the current `{server, sessionName}` and the dialog opens titled `Spawn agent in {sessionName}`
- **AND** **GIVEN** the sidebar bot button fires for a row, `spawnAgentTarget` is set to that row's `{server, session}`

#### R10: `SpawnAgentDialog` spawns against the passed target server (cross-server)
`SpawnAgentDialog` SHALL gain a `server` prop and issue `getRiffPresets`/`spawnRiff` against that TARGET server (not `useSessionContext().currentServer`), so cross-server spawn works. The title stays `Spawn agent in {session}`. On success, navigation to `/$server/$window` SHALL use the target server, preserving the existing falsy-`windowId` nav guard.

- **GIVEN** the dialog is opened with `server="B"` while the current route server is `A`
- **WHEN** the preflight/spawn run
- **THEN** both requests target server `B`
- **AND** a successful spawn with a non-empty `windowId` navigates to server `B`'s window; an empty `windowId` closes without navigating

### Non-Goals

- No system-agent enumeration (claude/codex/gemini) and no model/effort pickers in rk — tiers remain fab's abstraction.
- No hint text in place of the hidden tier field.
- No board-route (`/board/$name`) spawn button in v1 — the optional-handler threading makes it a cheap later addition.
- No change to `+` (stays instant window creation); no dropdown on it.

### Design Decisions

1. **Fab gate = `os.Stat` on `config.yaml`, not a YAML parse**: — *Why*: the question is "is this a fab project", answerable by file presence; avoids coupling to schema and keeps the absent-vs-malformed split (absent = not a fab project = `[]`; malformed-but-present = a fab project with a broken file = built-ins via unchanged `ReadTiers`). — *Rejected*: parsing the config to decide fab-ness (redundant, conflates malformed with absent).
2. **Sidebar entry = dedicated bot button left of `+`, `+` stays instant**: — *Why*: `+` is the common fast path; a dropdown taxes it. The row-cluster affordance pattern adds no new chrome (Constitution IV). — *Rejected*: making `+` a dropdown (explicitly rejected in intake).
3. **Explicit `{server, session}` target + dialog `server` prop over `useSessionContext` current-server**: — *Why*: the sidebar can target any listed session on any server; the client fns are already per-call server-scoped via `withServer`, so cross-server spawn falls out for free. — *Rejected*: keeping the boolean + current-server read (blocks cross-server spawn from the sidebar).

## Tasks

### Phase 1: Backend gate

- [x] T001 Add `IsFabProject(repoRoot string) bool` to `app/backend/internal/fabconfig/fabconfig.go` (an `os.Stat` on `filepath.Join(repoRoot, fabConfigRelPath)`, `false` on empty `repoRoot`), placed beside `ReadTiers`. <!-- R1 -->
- [x] T002 Gate the tiers read in `handleRiffPresets` (`app/backend/api/riff.go`): compute `tiers` = `fabconfig.ReadTiers(repoRoot)` only when `fabconfig.IsFabProject(repoRoot)`, else an empty (non-nil) `[]string{}`; keep the `tiers` key in the response and update the doc comment. <!-- R2 R3 -->

### Phase 2: Frontend dialog

- [x] T003 In `app/frontend/src/components/spawn-agent-dialog.tsx`: add a required `server: string` prop, remove the `useSessionContext()` current-server read, use the prop as the spawn/preflight server; guard the empty-server case as before. <!-- R10 -->
- [x] T004 In `spawn-agent-dialog.tsx`: render the Agent Tier field only when `tiers.length > 0`; when hidden, omit `tier` from the `spawnRiff` body (only send `tier` when the field is shown). Keep the preflight-failure fallback at `[DEFAULT_TIER]` (field shown). <!-- R4 R5 -->

### Phase 3: Sidebar entry + prop threading

- [x] T005 [P] Add `BotIcon` to `app/frontend/src/components/sidebar/icons.tsx` — a lucide-style `bot` stroke SVG matching the `PaletteIcon` idiom (`stroke="currentColor"`, `aria-hidden`, `size` default). <!-- R7 -->
- [x] T006 In `app/frontend/src/components/sidebar/session-row.tsx`: add an optional `onSpawnAgent?: (server: string, session: string) => void` prop; render a bot button (using `BotIcon`) immediately LEFT of `+`, only when the handler is present, with the palette-sibling affordance classes, `aria-label={`Spawn agent in ${session.name}`}`, and an `e.stopPropagation()` + `onSpawnAgent(server, name)` click. <!-- R6 -->
- [x] T007 In `app/frontend/src/components/sidebar/index.tsx`: add `onSpawnAgent?` to `SidebarProps`, thread it through `ServerGroupProps`/`ServerGroupInner` to `SessionRow` (mirroring `onColorChange`'s optional pattern), destructuring + passing it in the `<SessionRow .../>` render. <!-- R8 -->

### Phase 4: app.tsx wiring (all three entry points)

- [x] T008 In `app/frontend/src/app.tsx`: replace `showSpawnAgentDialog: boolean` with `spawnAgentTarget: {server, session} | null`; update the dialog-open check in the `anyDialogOpen`/overlay expression. <!-- R9 -->
- [x] T009 In `app.tsx`: change `handleOpenSpawnAgent` to `(server, session) => setSpawnAgentTarget({server, session})`; bind the palette action + window-switcher slot handler to the CURRENT `{server, sessionName}` (the TopBar `onSpawnAgent(session)` slot handler closes over `server`); pass `onSpawnAgent={(srv, sess) => setSpawnAgentTarget({server: srv, session: sess})}` into `<Sidebar />`. <!-- R9 R8 -->
- [x] T010 In `app.tsx`: render `<SpawnAgentDialog server={spawnAgentTarget.server} session={spawnAgentTarget.session} .../>` when `spawnAgentTarget != null`; wire `onSpawned` to navigate to the TARGET server's window (cross-server) and `onClose` to `setSpawnAgentTarget(null)`. <!-- R9 R10 -->

### Phase 5: Tests

- [x] T011 [P] Go: `app/backend/internal/fabconfig/fabconfig_test.go` — `TestIsFabProject` (config present → true; absent → false; empty root → false). <!-- R1 -->
- [x] T012 [P] Go: `app/backend/api/riff_test.go` — presets `tiers` is `[]` for a non-fab repo root (`gitRepoDir`, no config); populated (built-ins first) for a fab repo (existing `TestRiffPresetsTiers`); a non-fab `POST /api/riff` with a `tier` is still accepted (no new 400). <!-- R2 R3 -->
- [x] T013 [P] Frontend unit: `app/frontend/src/components/spawn-agent-dialog.test.tsx` — pass the new `server` prop; add cases that the Agent Tier field is hidden on `tiers: []` and `tier` is omitted from the submit body; verify the dialog uses the passed target server for preflight/spawn. <!-- R4 R10 -->
- [x] T014 [P] Frontend unit: `app/frontend/src/components/sidebar/session-row.test.tsx` — the bot button renders only with a handler, is positioned before `+`, and calls `onSpawnAgent(server, name)` on click. <!-- R6 R8 -->
- [x] T015 e2e: `app/frontend/tests/e2e/spawn-agent.spec.ts` (+ `.spec.md` companion, same commit) — a `tiers: []` presets mock renders the dialog WITHOUT the Agent Tier field; the sidebar bot button opens the dialog titled with the row's session. Hover the row before clicking the bot icon (pointer-events memory); keep trailing-`*` route globs. <!-- R2 R4 R6 R9 -->

## Execution Order

- Phase 1 (T001→T002) sequential (T002 uses T001).
- Phase 2 (T003→T004) sequential (same file).
- Phase 3: T005 independent; T006 depends on T005 (uses `BotIcon`); T007 depends on T006 (threads the prop the row now accepts).
- Phase 4 (T008→T009→T010) sequential (same file, dependent state rename).
- Phase 5 tests can run after their production phases; T011–T014 are `[P]`; T015 (e2e) after all production phases + its `.spec.md` companion.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `fabconfig.IsFabProject` returns true iff `fab/project/config.yaml` exists at `repoRoot` (empty root → false), via `os.Stat`, no parse/subprocess.
- [x] A-002 R2: `GET /api/riff/presets` returns non-empty `tiers` for a fab-project repo and `tiers: []` (present) for a non-fab git repo; `presets` behavior unchanged.
- [x] A-003 R3: `POST /api/riff` accepts a well-formed `tier` against a non-fab repo with no new 400 and resolves via `DefaultLauncher` fallback; `ReadTiers` contract unchanged.
- [x] A-004 R4: The dialog renders the Agent Tier field only when `tiers` is non-empty; on `tiers: []` no control/hint is present and `tier` is omitted from the POST body.
- [x] A-005 R5: On preflight-fetch failure the dialog keeps `["default"]` and the Agent Tier field is shown with value `default`.
- [x] A-006 R6: The session-row bot button renders only with an `onSpawnAgent` handler, sits left of `+`, is labelled `Spawn agent in {name}`, and calls `onSpawnAgent(server, name)` with propagation stopped.
- [x] A-007 R7: `BotIcon` is an `aria-hidden` `currentColor` stroke SVG consistent with `PaletteIcon`.
- [x] A-008 R8: `onSpawnAgent` is threaded Sidebar → ServerGroup → SessionRow as an optional prop; the button is absent when the prop is absent (board route hides it).
- [x] A-009 R9: `app.tsx` uses `spawnAgentTarget: {server, session} | null`; all three entry points set it (palette/window-switcher → current, sidebar → row).
- [x] A-010 R10: `SpawnAgentDialog` runs preflight/spawn against the passed `server` prop (cross-server) and navigates to the target server's window on success (falsy-`windowId` guard preserved).

### Behavioral Correctness

- [x] A-011 R2: The behavior CHANGE — a non-fab repo now returns `tiers: []` (previously always built-ins) — is verified by a dedicated backend test.
- [x] A-012 R9: The terminal-route palette + window-switcher entry points open a dialog titled with the current session unchanged from before (behavior-preserving through the state refactor).

### Scenario Coverage

- [x] A-013 R4: A frontend unit test drives `tiers: []` → field hidden + `tier` omitted from body.
- [x] A-014 R6: A frontend unit test drives the bot button click → `onSpawnAgent(server, name)`.
- [x] A-015 R2/R4/R6/R9: An e2e test proves `tiers: []` hides the tier field and the sidebar bot button opens the row-titled dialog (via `just test-e2e`/`just pw`, hover-before-click, trailing-`*` globs).

### Edge Cases & Error Handling

- [x] A-016 R10: An empty `windowId` from a successful spawn closes the dialog without navigating (no junk `/$server/@` URL); a 400 renders in-dialog and keeps it open.
- [x] A-017 R2: A fab project with a malformed-but-present `config.yaml` still returns built-in tiers (absent-vs-malformed split holds — `IsFabProject` true, `ReadTiers` built-ins fallback).

### Code Quality

- [x] A-018 Pattern consistency: New code follows surrounding patterns — `BotIcon` mirrors `PaletteIcon`; the bot button mirrors the palette button; `onSpawnAgent` threading mirrors `onColorChange`; type narrowing over `as` casts (frontend); `os.Stat` best-effort posture (backend).
- [x] A-019 No unnecessary duplication: Reuse existing helpers (`fabConfigRelPath`, `withServer`-scoped client fns, existing dialog/session-row affordance classes) rather than reimplementing.
- [x] A-020 Test companion: `spawn-agent.spec.ts` changes ship with an updated `spawn-agent.spec.md` in the same commit (Constitution Test Companion Docs); e2e run only via `just test-e2e`/`just pw`.

### Security

- [x] A-021 R1/R3: The fab gate is a pure `os.Stat` (no new subprocess input, Constitution I); `POST /api/riff` keeps its `validate.ValidateTier` argv guard — no new injection surface.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. (Checked: `showSpawnAgentDialog` has zero remaining references; `StandaloneSessionContextProvider` — dropped by the dialog test — retains 8 other test consumers; the dialog's `!server || !session` submit guard stays reachable via AppShell's transient `server = ""` fallback window, so it is defensive, not dead.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Tier field gated on `IsFabProject` (config.yaml `os.Stat` at session repo root); endpoint returns `tiers: []` for non-fab repos; dialog hides the field on empty tiers | Intake decision 1, user-confirmed; carried verbatim into R1/R2/R4 | S:90 R:85 A:90 D:90 |
| 2 | Certain | Sidebar entry = bot button LEFT of `+` in the session-row cluster; `+` stays instant (no dropdown) | Intake decision 2, user-confirmed placement; dropdown-on-+ explicitly rejected | S:90 R:85 A:90 D:85 |
| 3 | Confident | Icon = lucide-style `bot` stroke SVG (`BotIcon`, `PaletteIcon` idiom); aria `Spawn agent in {session}` | Intake assumption 4 (Confident); trivially swappable asset | S:70 R:85 A:80 D:70 |
| 4 | Confident | Spawn target becomes explicit `{server, session}`; dialog gains a `server` prop; cross-server spawn supported | Intake assumption 5; client fns already server-scoped per call via `withServer` | S:65 R:75 A:80 D:75 |
| 5 | Confident | `POST /api/riff` stays permissive for `tier` in non-fab repos (silent `DefaultLauncher` fallback, no new 400) | Intake assumption 6; hidden field never sends tier; rejecting diverges from documented fallback posture | S:60 R:85 A:80 D:75 |
| 6 | Confident | No hint text when the tier field is hidden; preflight-FAILURE fallback keeps `[DEFAULT_TIER]` (field shown) | Intake assumption 7; on fetch failure fab-ness is unknown — status quo is conservative | S:60 R:90 A:80 D:70 |
| 7 | Confident | Board-route sidebar gets no `onSpawnAgent` handler in v1 (button hidden there) via the optional-prop pattern | Intake assumption 8; later wiring is cheap; board spawn demand unproven | S:55 R:90 A:75 D:70 |
| 8 | Confident | The dialog `server` prop is REQUIRED (not optional): every call site (all three entry points) supplies a concrete target, so a default would only mask a wiring bug | Falls out of R9/R10 — all openers set `spawnAgentTarget` with a server; matches the existing required `session` prop | S:70 R:80 A:80 D:75 |

8 assumptions (2 certain, 6 confident, 0 tentative).

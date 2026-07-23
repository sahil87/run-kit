# Plan: Settings Dialog

**Change**: 260723-o7q8-settings-dialog
**Intake**: `intake.md`

## Requirements

### Backend: settings.yaml keys

#### R1: `ssh_host` and `instance_name` settings keys
`internal/settings` MUST persist two new scalar string keys in `~/.rk/settings.yaml`, following the `instance_color` scalar-key pattern: `ssh_host` (verbatim SSH destination — alias or `user@host`; empty = unset) and `instance_name` (display name override; empty = derive from `os.Hostname()`). Each key SHALL serialize only when non-empty (quoted), so a file that never set them serializes byte-identically to the pre-change output. Reads SHALL be tolerant (quote-stripped, trimmed). Getter/setter pairs (`GetSSHHost`/`SetSSHHost`, `GetInstanceName`/`SetInstanceName`) MUST mirror `GetInstanceColor`/`SetInstanceColor` (load-then-save; nil clears).

- **GIVEN** a settings.yaml containing only theme keys
- **WHEN** it is loaded and re-saved without setting the new keys
- **THEN** the serialized bytes are identical to the pre-change output
- **AND** `ssh_host: "devbox"` / `instance_name: "my-box"` round-trip through parse → serialize

#### R2: per-key GET/POST endpoints
`api/settings.go` MUST add per-key endpoints mirroring the `instance-color` pattern, POST-only mutation (Constitution IX): `GET /api/settings/ssh-host` → `{"sshHost": "..."|null}`, `POST /api/settings/ssh-host` ← `{"sshHost": "..."|null}` (null clears); `GET /api/settings/instance-name` → `{"name": "..."|null}`, `POST /api/settings/instance-name` ← `{"name": "..."|null}` (null clears). Validation MUST trim both values; reject (`400`) an `ssh_host` containing whitespace or control characters (it is spliced into `vscode://vscode-remote/ssh-remote+{host}` URLs); reject an `instance_name` containing control characters; length-cap both at 253 characters. A trimmed-to-empty value SHALL be treated as a clear (same as null).

- **GIVEN** the router is running
- **WHEN** `POST /api/settings/ssh-host {"sshHost":"devbox"}` then `GET /api/settings/ssh-host`
- **THEN** the GET returns `{"sshHost":"devbox"}` and settings.yaml carries `ssh_host: "devbox"`
- **GIVEN** a POST body `{"sshHost":"dev box"}` (embedded whitespace)
- **WHEN** the handler validates it
- **THEN** the response is `400` and nothing is persisted

#### R3: health resolution — settings-first sshHost + optional instanceName
`GET /api/health` MUST resolve `sshHost` settings-first per request: (1) `settings.yaml` `ssh_host` non-empty → use it; (2) else `RK_SSH_HOST` env (the startup-seeded `Server.sshHost`) → use it; (3) else omit the field. The response MUST gain an optional `instanceName` field (from `settings.yaml` `instance_name`), present only when set. The frontend deeplink consumption path (`open-in-app.ts` `resolveDeeplinkHost` — verbatim, never `user@`-prefixed) is unchanged; a UI edit takes effect on the next health fetch without restart.

- **GIVEN** `RK_SSH_HOST=envbox` was set at startup AND settings.yaml has `ssh_host: "uibox"`
- **WHEN** `GET /api/health`
- **THEN** the response carries `sshHost: "uibox"` (settings win)
- **GIVEN** settings.yaml has no `ssh_host` but the env seeded `envbox`
- **WHEN** `GET /api/health`
- **THEN** the response carries `sshHost: "envbox"` (env fallback)
- **GIVEN** settings.yaml has `instance_name: "my-box"`
- **WHEN** `GET /api/health`
- **THEN** the response carries `instanceName: "my-box"`; with it unset the field is absent

### Frontend: dialog shell + triggers

#### R4: SettingsDialog mounted once at AppLayout via SettingsDialogContext
A new `SettingsDialog` component MUST render **once** in `AppLayout` (`app.tsx`), following the existing `Dialog` pattern (focus trap, Escape closes, `role="dialog"`). Open/close state MUST live in a new `SettingsDialogContext` (`contexts/settings-dialog-context.tsx`) provided at the `AppLayout` level so any descendant (palette actions, sidebar gear) can call `openSettings()`. The dialog MUST show two labeled sections making the persistence scope visible: **This host** (instance display name, SSH host, instance accent color, theme pair) and **This device** (terminal font size). The dialog is available on every page, including `/board/$name` (which does not render AppShell).

- **GIVEN** any route (server, terminal, board, host)
- **WHEN** a descendant calls `openSettings()`
- **THEN** the dialog opens with "This host" and "This device" sections, Escape closes it, and focus is trapped while open

#### R5: triggers — palette action in both palettes + sidebar footer gear
A "Settings: Open" command-palette action MUST be registered in **both** palettes — AppShell's `paletteActions` (`app.tsx`) and `board-page.tsx`'s `boardRouteActions` — each a one-liner calling the context's `openSettings()` (the dialog itself is never duplicated). A gear affordance MUST be added to the shared Sidebar's footer (the Sidebar renders on server routes AND boards). The gear MUST be named via a `Tip` label (never a native `title=`) with an `aria-label` retained; the same rule applies to any icon-only control inside the dialog. No dedicated keyboard shortcut in v1 (`Cmd+,` is browser-reserved; the palette is the primary keyboard path).

- **GIVEN** the command palette on a server route or on `/board/$name`
- **WHEN** the user runs "Settings: Open"
- **THEN** the same single dialog opens
- **GIVEN** the sidebar
- **WHEN** the user clicks the footer gear
- **THEN** the dialog opens; the gear has an `aria-label` and a `Tip`, no native `title=`

### Frontend: controls (reuse, not rebuild)

#### R6: host-scoped controls
The "This host" section MUST provide: (a) **Instance display name** — a text input reading the current `instance_name`, committing on Enter/blur via `POST /api/settings/instance-name` (clearing when emptied); (b) **SSH host** — a single free-form text input used verbatim (alias or `user@host`, never split into username/hostname fields), reading the current *setting* via `GET /api/settings/ssh-host` (not the effective health value) and committing on Enter/blur, surfacing a `400` as an inline error; (c) **Instance accent color** — reusing the existing `SwatchPopover` (color-only) + `useInstanceAccent().setColor` descriptor model ("4" / "1+3"; NOT a free RGB picker); (d) **Theme pair** — a second surface reusing the existing `useTheme()`/`useThemeActions()` wiring (`/api/settings/theme` partial-merge POST): mode control (System/Light/Dark) plus preferred dark-theme and light-theme selectors. The top-bar theme selector stays.

- **GIVEN** the dialog is open with `ssh_host` unset in settings but `RK_SSH_HOST` set
- **WHEN** the SSH host field renders
- **THEN** it shows the empty *setting* (not the env value)
- **GIVEN** the user types `devbox` and blurs
- **THEN** `POST /api/settings/ssh-host` persists it and the next health fetch carries it
- **GIVEN** the user picks a swatch in the dialog's accent picker
- **THEN** `useInstanceAccent().setColor` POSTs and the top-bar stripe repaints without reload

#### R7: device-scoped control
The "This device" section MUST present the terminal font size via the existing `ChromeContext.terminalFontSize` control model (localStorage `runkit-terminal-font-size`): a `[−] {size} [+]` stepper plus Reset, wired to `increaseTerminalFont`/`decreaseTerminalFont`/`resetTerminalFont`. No new persistence.

- **GIVEN** the dialog is open
- **WHEN** the user clicks `+`
- **THEN** `terminalFontSize` steps up (clamped 8–24) and persists to localStorage only

#### R8: API client additions
`src/api/client.ts` MUST add `getSSHHost()`/`setSSHHost(host: string | null)` and `getInstanceName()`/`setInstanceName(name: string | null)` following the `getInstanceColor`/`setInstanceColor` shape (deduplicated GET, plain POST, `throwOnError`), and `HealthResponse` MUST gain the optional `instanceName?: string` field.

- **GIVEN** the new client functions
- **WHEN** the backend responds non-2xx
- **THEN** the setter rejects with the server's structured error message

### Frontend: instance display name consumers

#### R9: display surfaces prefer instanceName; hash + deeplinks keep real hostname
When `instance_name` is set, display surfaces MUST prefer it over the health-reported hostname: browser tab title (`use-browser-title.ts` wiring in `app.tsx`), HOST panel hostname line (`sidebar/host-panel.tsx`), and host-overview HOST HEALTH hostname line (`host-overview-page.tsx`). Delivery: a new root-mounted `InstanceNameProvider` (`contexts/instance-name-context.tsx`, mirroring `InstanceAccentProvider`) fetches `getHealth()` once, exposes `{ hostname, instanceName, displayName, setInstanceName }`, and updates optimistically when the dialog edits the name — so all surfaces repaint without reload. Two surfaces MUST keep using the **real hostname**: the instance-accent hash fallback (`instance-accent.ts` — renaming must not change the color) and SSH deeplink derivation (`open-in-app.ts` — deeplinks need the reachable hostname). Neither file's resolution logic changes.

- **GIVEN** `instance_name: "my-box"` is set and the real hostname is `mac-mini`
- **WHEN** the app renders
- **THEN** the tab title, HOST panel line, and host-overview hostname line show `my-box`
- **AND** `open-in-app.ts` deeplinks and the accent derivation still key on `mac-mini`
- **GIVEN** the user edits the name in the dialog
- **THEN** all three surfaces update live (optimistic context state), and clearing the field reverts them to the hostname

### Tests

#### R10: test coverage
Vitest unit tests MUST cover `SettingsDialog`, `SettingsDialogContext`, `InstanceNameProvider`, and the new `client.ts` functions. Go tests MUST cover the new settings keys (parse/serialize round-trip incl. empty-value omission), the two new endpoints (persist, clear, validation rejects), and the health `sshHost` precedence (settings > env > absent) + optional `instanceName`. A Playwright e2e spec MUST prove: open via palette on a server route AND on `/board/$name`, open via sidebar gear, edit + persist a host-scoped value (with the settings.yaml snapshot/restore pattern from `board-list-reorder.spec.ts` — `$HOME` is not isolated), and the This-host/This-device section split renders. A sibling `.spec.md` companion doc is REQUIRED (constitution § Test Companion Docs).

- **GIVEN** `just test`
- **WHEN** the suite runs
- **THEN** backend, frontend, and e2e tests pass with the new coverage included

### Non-Goals

- No routed settings page (Constitution IV) — dialog only.
- No migration of AppShell chrome (Sidebar, create/kill dialogs, palette) to AppLayout — separate backlog `[239r]`; the two-line palette registration duplication is the accepted concession until then.
- No per-server colors or preferred-editor controls in the dialog (explicitly excluded by the user).
- No dedicated keyboard shortcut (`Cmd+,` is browser-reserved).
- No new env vars; `RK_SSH_HOST` keeps working as the fallback.
- No change to the frontend deeplink resolution chain (`resolveDeeplinkHost`).

### Design Decisions

#### Instance-name delivery via a root context provider
**Decision**: A new `InstanceNameProvider` mounted in `RootWrapper` (beside `InstanceAccentProvider`) owns the health-fetched `{hostname, instanceName}` pair and the optimistic `setInstanceName` write seam; AppShell's local hostname fetch for the browser title is replaced by the provider.
**Why**: Three display surfaces plus the dialog editor need one live-updating state — the exact shape `InstanceAccentProvider` already established (fetch once, optimistic set, every consumer repaints). `deduplicatedFetch` keeps it to one `/api/health` request per load.
**Rejected**: A module-level cache (à la `use-open-targets`) — no reactivity path for the dialog's live edit; putting the name in `SettingsDialogContext` — mixes chrome state with instance data and forces the provider above `RootTopBar` consumers anyway.
*Introduced by*: 260723-o7q8-settings-dialog

#### Self-contained theme controls instead of the ThemeSelector modal
**Decision**: The dialog's theme-pair surface is self-contained — a System/Light/Dark mode control plus two `<select>`s (preferred dark / preferred light theme) driving the existing `setTheme()` — rather than dispatching `"theme-selector:open"`.
**Why**: `ThemeSelector` is mounted only inside AppShell (`app.tsx`), so the event has no listener on `/board/$name` — the dialog's core mount point promise. `setTheme(id)` already owns slot updates + partial-merge POST + localStorage sync, so the dialog reuses the wiring (the intake's requirement) without the modal.
**Rejected**: Moving the `ThemeSelector` mount to AppLayout — a behavior change to an unrelated surface, out of scope; live-preview machinery inside the dialog — the selector modal already owns preview UX.
*Introduced by*: 260723-o7q8-settings-dialog

## Tasks

### Phase 1: Backend

- [x] T001 `app/backend/internal/settings/settings.go`: add `SSHHost`/`InstanceName` fields, parse cases, non-empty-only quoted serialization (after `instance_color`, before `server_colors`), and `GetSSHHost`/`SetSSHHost`/`GetInstanceName`/`SetInstanceName`; round-trip + byte-identical-omission tests in `settings_test.go` <!-- R1 -->
- [x] T002 `app/backend/api/settings.go`: `handleGetSSHHost`/`handleSetSSHHost`/`handleGetInstanceName`/`handleSetInstanceName` with trim + whitespace/control-char + 253-cap validation; register 4 routes in `app/backend/api/router.go`; endpoint tests (persist, clear via null and via empty string, `400` rejects) in `settings_test.go` <!-- R2 -->
- [x] T003 `app/backend/api/health.go`: settings-first `sshHost` resolution (settings.yaml `ssh_host` → `s.sshHost` env seed → omit) + optional `instanceName`; update/extend `health_test.go` with HOME isolation (`isolateSettings`) covering settings-over-env, env-fallback, absent, and instanceName present/absent <!-- R3 -->

### Phase 2: Frontend foundation

- [x] T004 [P] `app/frontend/src/api/client.ts`: `getSSHHost`/`setSSHHost`/`getInstanceName`/`setInstanceName` + `HealthResponse.instanceName?`; tests in `client.test.ts` <!-- R8 -->
- [x] T005 [P] `app/frontend/src/contexts/settings-dialog-context.tsx`: `SettingsDialogProvider` + `useSettingsDialog()` (`{ isOpen, openSettings, closeSettings }`); test `settings-dialog-context.test.tsx` <!-- R4 -->
- [x] T006 [P] `app/frontend/src/contexts/instance-name-context.tsx`: `InstanceNameProvider` + `useInstanceName()` (health fetch once, optimistic `setInstanceName` POST with failure toast, `displayName = instanceName ?? hostname`) + value-injection test seam; test `instance-name-context.test.tsx` <!-- R9 -->
- [x] T007 `app/frontend/src/components/settings-dialog.tsx`: the dialog on the shared `Dialog` shell — This host (name input, SSH host input with inline error, accent `SwatchPopover` reuse, theme mode + pair selects) and This device (font `[−] {size} [+]` + Reset); test `settings-dialog.test.tsx` <!-- R4, R6, R7 -->

### Phase 3: Integration

- [x] T008 `app/frontend/src/app.tsx`: mount `InstanceNameProvider` in `RootWrapper`; wrap `AppLayout` content in `SettingsDialogProvider` + render lazy `SettingsDialog`; replace AppShell's local hostname fetch with `useInstanceName().displayName` for `useBrowserTitle`; add "Settings: Open" to `paletteActions` <!-- R4, R5, R9 -->
- [x] T009 [P] `app/frontend/src/components/board/board-page.tsx`: add "Settings: Open" one-liner to `boardRouteActions` <!-- R5 -->
- [x] T010 [P] `app/frontend/src/components/sidebar/index.tsx` (+ `sidebar/icons.tsx` `GearIcon`): footer gear button consuming `useSettingsDialog()`, `Tip` label + `aria-label`, no native `title=`; test update in sidebar tests <!-- R5 -->
- [x] T011 [P] display-name consumers: `sidebar/host-panel.tsx` and `host-overview-page.tsx` prefer `useInstanceName().instanceName` over the metrics hostname; component test updates <!-- R9 -->

### Phase 4: E2E + verification

- [x] T012 `app/frontend/tests/e2e/settings-dialog.spec.ts` + sibling `settings-dialog.spec.md`: palette-open on server route and on `/board/$name`, gear-open, edit + persist a host-scoped value (instance name; settings.yaml snapshot/restore), This-host/This-device split renders <!-- R10 -->
- [x] T013 Run verification gates: `just test-backend`, frontend type check, `just test-frontend`, `just test-e2e`, `just build` <!-- R10 -->

## Execution Order

- T001 blocks T002, T003 (settings accessors used by handlers/health)
- T004–T007 depend on Phase 1 only for end-to-end behavior, not compilation; T007 depends on T004, T005, T006
- T008 depends on T005–T007; T009/T010 depend on T005; T011 depends on T006
- T012–T013 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `ssh_host`/`instance_name` round-trip through settings.yaml; a file never setting them serializes byte-identically
- [x] A-002 R2: all four endpoints registered and behave per contract (GET shape, POST persist/clear, POST-only mutation)
- [x] A-003 R3: `/api/health` resolves sshHost settings-first with env fallback and carries `instanceName` only when set
- [x] A-004 R4: `SettingsDialog` renders once at AppLayout with This-host/This-device sections; `SettingsDialogContext` drives open/close
- [x] A-005 R5: "Settings: Open" exists in both palettes; the sidebar footer gear opens the dialog
- [x] A-006 R6: name/SSH-host inputs read + commit their settings; accent picker and theme pair reuse existing models (descriptor colors, `setTheme` wiring)
- [x] A-007 R7: dialog font control steps/resets the shared `ChromeContext` preference
- [x] A-008 R8: client functions added with error propagation; `HealthResponse.instanceName` typed
- [x] A-009 R9: tab title, HOST panel, and host-overview lines prefer the display name; accent hash + deeplink code paths unchanged

### Behavioral Correctness

- [x] A-010 R3: with both settings value and env set, settings win; clearing the setting falls back to env without restart
- [x] A-011 R9: editing the name in the dialog updates all display surfaces live; clearing reverts to hostname
- [x] A-012 R6: SSH host field shows the stored setting (may be empty) even while the env fallback is active

### Scenario Coverage

- [x] A-013 R10: Go tests cover round-trip, omission, endpoint validation rejects, and health precedence
- [x] A-014 R10: Vitest covers dialog, both new contexts, and client functions
- [x] A-015 R10: e2e proves palette-open (server + board routes), gear-open, persist-a-host-value, section split; sibling `.spec.md` ships

### Edge Cases & Error Handling

- [x] A-016 R2: whitespace/control-char SSH host and >253-char values return `400` and persist nothing; trimmed-to-empty clears
- [x] A-017 R6: a rejected SSH-host POST surfaces an inline error in the dialog without clobbering the stored value

### Security

- [x] A-018 R2: `ssh_host` is validated before persistence (it is spliced into editor deeplink URLs client-side); no shell/subprocess path consumes it

### Code Quality

- [x] A-019 Pattern consistency: new code mirrors the `instance-color` backend pattern, `InstanceAccentProvider` context pattern, and existing dialog/Tip conventions
- [x] A-020 No unnecessary duplication: SwatchPopover, theme actions, ChromeContext font control, and `Dialog` shell are reused, not rebuilt
- [x] A-021 Type narrowing over assertions in new frontend code; no polling loops added (one-shot fetches only)
- [x] A-022 No database/ORM; state derives from settings.yaml + localStorage per Constitution II

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `None` — this change is additive: new settings keys, endpoints, contexts, dialog, and triggers. The only removal the apply already performed (AppShell's local `hostname` state + its dedicated `getHealth()` fetch, now sourced from `useInstanceName().displayName`) is complete in the diff, not a leftover candidate. No existing file, function, branch, or config was made redundant by this change.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Instance-name delivery via new root `InstanceNameProvider` (mirrors `InstanceAccentProvider`); AppShell's local hostname fetch replaced by it | Intake names the consumers but not the mechanism; the accent provider is the established shape for fetch-once + optimistic-set + multi-surface repaint | S:55 R:75 A:85 D:70 |
| 2 | Confident | Dialog theme control is self-contained (mode buttons + dark/light selects via `setTheme`), not the `"theme-selector:open"` event | ThemeSelector mounts only in AppShell, so the event is dead on `/board/$name`; `setTheme` already owns the partial-merge POST wiring the intake asks to reuse | S:60 R:85 A:80 D:65 |
| 3 | Confident | Sidebar gear lives in a new slim footer row at the very bottom of the sidebar nav (below the HOST panel), right-aligned icon button | Intake says "shared Sidebar footer"; no footer exists today, so one is introduced at the natural bottom slot; trivially movable | S:55 R:90 A:70 D:60 |
| 4 | Certain | New settings keys serialize after `instance_color`, before `server_colors`; both always quoted | Any fixed position satisfies the byte-identical-when-unset rule; adjacent to the sibling scalar key is the least surprising | S:70 R:90 A:95 D:85 |
| 5 | Confident | `instance_name` validation: trim, reject control chars, cap 253 — inner spaces allowed (display names like "dev mini" are legitimate); `ssh_host` additionally rejects all whitespace | Intake specifies the ssh_host whitespace rule and the shared cap explicitly; it only says "trimmed" for instance_name, and a display label has no URL-splicing risk | S:65 R:85 A:80 D:70 |
| 6 | Confident | Name/SSH-host inputs commit on Enter/blur (no Save button); trimmed-empty commit clears the setting | Matches the codebase's inline-edit vocabulary (window rename: Enter/blur commit, Escape cancel); null-clears mirrors the endpoints' contract | S:50 R:85 A:75 D:65 |
| 7 | Confident | E2E persists the *instance name* as the host-scoped edit and uses the `board-list-reorder.spec.ts` settings.yaml snapshot/restore pattern | `$HOME` is not isolated by `scripts/test-e2e.sh`; the snapshot/restore precedent exists verbatim; instance name is the safest visible round-trip value | S:60 R:85 A:85 D:75 |
| 8 | Certain | Health handler reads `settings.Load()` per request for both new facts | Constitution II (derive at request time); the intake requires UI edits visible on the next health poll without restart | S:75 R:85 A:90 D:85 |

8 assumptions (2 certain, 6 confident, 0 tentative).

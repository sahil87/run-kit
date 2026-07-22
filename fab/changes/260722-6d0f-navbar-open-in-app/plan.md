# Plan: Navbar Open-in-App Button

**Change**: 260722-6d0f-navbar-open-in-app
**Intake**: `intake.md`

## Requirements

### Backend: wt wrapper package

#### R1: wt CLI wrapper in `internal/wt`
All wt interactions SHALL go through a new wrapper package `app/backend/internal/wt/` (constitution III — sibling to `internal/tmux/`, `internal/riff/`). The package MUST expose `ListApps(ctx)` (wrapping `wt open --list --json`) and `Open(ctx, path, app)` (wrapping `wt open <path> -a <app>`), each executing via `exec.CommandContext` with an explicit argument slice and its own timeout derived from the caller's context (constitution I / Process Execution). The registry parser MUST be tolerant: an entry requires `id` and `label` fields (entries missing either are skipped); unknown fields are ignored (forward-compat — wt has not shipped `--list --json` yet, so the flag's existence MUST NOT be assumed at runtime).

- **GIVEN** wt emits `[{"id":"vscode","label":"VS Code","kind":"editor","future":"x"}]`
- **WHEN** `ListApps` parses the output
- **THEN** one `App{ID:"vscode", Label:"VS Code", Kind:"editor"}` is returned and the unknown `future` field is ignored

- **GIVEN** wt emits an array containing an entry without an `id`
- **WHEN** the output is parsed
- **THEN** that entry is skipped and remaining valid entries are returned

- **GIVEN** `wt` is absent from PATH, or exits non-zero, or emits non-JSON
- **WHEN** `ListApps` runs
- **THEN** it returns an error (the API layer maps this to fail-silent `[]`)

### Backend: registry endpoint

#### R2: `GET /api/open-apps` fail-silent registry
A new read endpoint `GET /api/open-apps` SHALL return the host-detected app registry as a JSON array. It MUST degrade fail-silent: when wt is absent, older than the `--list` flag, or erroring, respond `200` with `[]` — never an error status. The handler reaches wt only through a `WtOps` seam on `Server` (mirroring `RiffEngine` injection) so tests stub the wrapper.

- **GIVEN** the wt wrapper returns two apps
- **WHEN** `GET /api/open-apps` is called
- **THEN** the response is `200` with the two-app JSON array

- **GIVEN** the wt wrapper errors (wt absent/old/failing)
- **WHEN** `GET /api/open-apps` is called
- **THEN** the response is `200` with body `[]`

### Backend: launch endpoint

#### R3: `POST /api/open` validated host launch
A new mutating endpoint `POST /api/open` (POST per constitution IX) SHALL launch an app on the host via the wt wrapper. Body: `{"path": "<abs path>", "app": "<app id>"}`. Before exec, the handler MUST validate (constitution I): `path` must be absolute and match a currently-derived pane cwd or known worktree path for the request's `?server=` scope (derived server-side via the `SessionFetcher` — never trusting the client's path); `app` must be an id present in the live `ListApps` output. Any validation failure is a 4xx and nothing user-supplied reaches exec. On success the handler runs `wt open <path> -a <app>` and returns `{"ok": true}`.

- **GIVEN** a pane on server `default` has cwd `/Users/x/code/proj` and the registry contains `vscode`
- **WHEN** `POST /api/open` receives `{"path":"/Users/x/code/proj","app":"vscode"}`
- **THEN** the wrapper's `Open` is invoked with that path and app, and the response is `200 {"ok":true}`

- **GIVEN** the body path is relative, empty, or matches no derived pane cwd / worktree path
- **WHEN** `POST /api/open` is called
- **THEN** the response is `400` and the wrapper's `Open` is never invoked

- **GIVEN** the body app id is not in the live registry (including when `ListApps` errors — wt absent means no app is launchable)
- **WHEN** `POST /api/open` is called
- **THEN** the response is `400` and `Open` is never invoked

- **GIVEN** validation passes but `wt open` itself fails
- **WHEN** the handler runs the launch
- **THEN** the response is `502` with a JSON error

### Config: RK_SSH_HOST

#### R4: optional `RK_SSH_HOST` env var exposed to the frontend
`internal/config` SHALL gain an optional `SSHHost` field loaded from `RK_SSH_HOST` (empty when unset). It SHALL reach the frontend on the smallest existing bootstrap surface — the `GET /api/health` response — as an `sshHost` field (omitted when empty). `.env` documents the variable as a commented example; `rk serve --help` lists it.

- **GIVEN** `RK_SSH_HOST=devbox` in the environment
- **WHEN** `GET /api/health` is called
- **THEN** the response includes `"sshHost":"devbox"`

- **GIVEN** `RK_SSH_HOST` is unset
- **WHEN** `GET /api/health` is called
- **THEN** the response omits/empties `sshHost` and the frontend hides the deeplink section entirely

### Frontend: deeplink table + open-target model

#### R5: static deeplink const, local/remote branch, section visibility, last-used persistence
The deeplink templates SHALL live in run-kit's frontend only, as a static TS const (no API, no detection) in a pure lib module:

```ts
const DEEPLINK_APPS = [
  { id: "vscode",   label: "VS Code",  url: (host, path) => `vscode://vscode-remote/ssh-remote+${host}${path}` },
  { id: "cursor",   label: "Cursor",   url: (host, path) => `cursor://vscode-remote/ssh-remote+${host}${path}` },
  { id: "windsurf", label: "Windsurf", url: (host, path) => `windsurf://vscode-remote/ssh-remote+${host}${path}` },
]
```

The local/remote branch SHALL key on `location.hostname` ∈ {`localhost`, `127.0.0.1`, `[::1]`}: local → server-exec section only; remote → deeplink section (all three templates unconditionally — client installs are unknowable) plus the server-exec section as an explicitly labeled "on host" escape hatch. Section visibility: deeplink section hidden when `sshHost` is unset; host section hidden when the registry is empty; when zero targets remain the Open control renders nothing. The last-used target id SHALL persist to localStorage (`runkit-open-last-used`, the `runkit-*` preference pattern); target ids are kind-qualified (`deeplink:vscode` / `host:vscode`) so deeplink and host entries for the same editor never collide.

- **GIVEN** hostname `localhost`, sshHost set, registry `[vscode]`
- **WHEN** targets are built
- **THEN** only the host target `host:vscode` is returned (no deeplink section when local)

- **GIVEN** hostname `myhost.tail`, sshHost `devbox`, registry `[iterm]`
- **WHEN** targets are built
- **THEN** three deeplink targets plus one host target are returned, host target labeled for the "on host" section

- **GIVEN** hostname `myhost.tail`, sshHost unset, registry `[]`
- **WHEN** targets are built
- **THEN** zero targets are returned and the button is hidden

#### R6: Open split-button in the top-bar right cluster, Terminal route only
A Conductor-style split-button SHALL join the top bar's right-cluster overflow registry, Terminal mode only (v1). The folder is the active pane's cwd (fallback: first pane cwd, then `worktreePath`) from the already-derived `currentWindow`. Primary click re-runs the last-used target; with no stored (or no longer available) preference it opens the menu. The chevron always opens the full menu. Deeplink activation is a plain `window.location.href = url` navigation (browser shows its own confirm). Host activation calls `POST /api/open` with error toast on failure. When overflowed into the chevron menu, the control renders one `Open: <label>` row per target (the ViewSwitcherMenuRows pattern). Registry data (sshHost + host apps) is fetched once per page load (no client polling).

- **GIVEN** a Terminal route with a stored last-used target that is still available
- **WHEN** the primary segment is clicked
- **THEN** that target runs immediately (deeplink navigation or host POST) without opening the menu

- **GIVEN** no stored preference
- **WHEN** the primary segment is clicked
- **THEN** the menu opens instead

- **GIVEN** a menu item is clicked
- **WHEN** the target runs
- **THEN** its id is persisted as last-used and the menu closes

- **GIVEN** the right cluster is squeezed until the Open control overflows
- **WHEN** the chevron menu opens
- **THEN** each available target appears as an `Open: <label>` menu row

### Frontend: API client

#### R7: client functions for the two endpoints
`src/api/client.ts` SHALL gain `getOpenApps()` (GET `/api/open-apps`, deduplicated, returning `[]` on any error — fail-silent mirrors the server) and `openInApp(server, path, app)` (POST `/api/open`, throwing on error). `HealthResponse` gains optional `sshHost`.

- **GIVEN** the endpoint responds `200 [{"id":"vscode","label":"VS Code"}]`
- **WHEN** `getOpenApps()` resolves
- **THEN** the typed array is returned

- **GIVEN** the endpoint is unreachable or non-200
- **WHEN** `getOpenApps()` resolves
- **THEN** `[]` is returned (no throw)

### Frontend: command palette

#### R8: palette registration for every open target
Every available open target SHALL be keyboard-reachable (constitution V) via command-palette entries `Open: <app label>` (host targets suffixed `(on host)` when the client is remote, disambiguating deeplink/host label collisions). Actions are built by a pure `buildOpenActions` lib (the `lib/palette-*.ts` pattern) and composed into `paletteActions` in `app.tsx`. No new keyboard chord is introduced; palette reachability satisfies constitution V, and the registration comment documents this per the code-review rule.

- **GIVEN** targets `[deeplink:vscode, host:iterm]` on a remote client
- **WHEN** the palette opens
- **THEN** entries `Open: VS Code` and `Open: iTerm (on host)` are listed and selecting one runs the target

### Tests: e2e

#### R9: Playwright coverage with companion doc; existing chrome assertions intact
A new Playwright spec `open-in-app.spec.ts` with a mandatory sibling `open-in-app.spec.md` (constitution § Test Companion Docs) SHALL cover the button's presence and menu on the Terminal route, stubbing `GET /api/open-apps` via `page.route` (wt `--list --json` does not exist yet, and the e2e host must not need it). Because the default e2e environment yields zero targets (localhost + empty registry + no `RK_SSH_HOST`), the button is absent by default — existing top-bar chrome e2e specs (`top-bar-overflow`, `top-bar-overlap`, `window-heading`, `mobile-layout`, …) MUST keep passing unmodified; the spec also asserts the zero-target absence.

- **GIVEN** `GET /api/open-apps` stubbed to return two apps
- **WHEN** a Terminal route loads
- **THEN** the Open split-button renders, its menu lists both apps, and the palette lists the matching `Open:` entries

- **GIVEN** the un-stubbed default environment (empty registry, no sshHost, localhost)
- **WHEN** a Terminal route loads
- **THEN** no Open control renders in the right cluster

### Non-Goals

- Open button on server/board/host routes (v1 Terminal-only; intake Open Question)
- JetBrains Gateway deeplink (divergent URL grammar; easy later add)
- tmux-`$EDITOR` fallback ("open in a new tmux window")
- Client-side detection of installed editors (unknowable from a web page)
- Curated mobile treatment (v1 shows targets as-is; revisit with usage)

### Design Decisions

#### RK_SSH_HOST rides GET /api/health
**Decision**: Expose `sshHost` as an optional field on the existing `GET /api/health` response.
**Why**: The intake directs the field to "the smallest existing bootstrap surface rather than a new route"; health already carries `hostname`, is fetched once at AppShell mount, and is the only config-shaped GET.
**Rejected**: A new `/api/config` route (constitution IV — new surface for one field); embedding in the SSE stream (config is static, the stream is live state).
*Introduced by*: 260722-6d0f-navbar-open-in-app

#### Path validation scoped to the request's `?server=` via SessionFetcher
**Decision**: `POST /api/open` validates `path` against the pane cwds + window worktree paths of the `?server=`-scoped `FetchSessions` snapshot (paths compared after `filepath.Clean`).
**Why**: `FetchSessions` is the canonical server-side derivation (constitution X) already used by every session read; the Open button always acts on the current server's current window, and the `?server=` scoping matches every other handler.
**Rejected**: Cross-server sweep of all tmux servers (N× subprocess cost against the 5s route budget for no real caller).
*Introduced by*: 260722-6d0f-navbar-open-in-app

#### Open control owns its data via a fetch-once hook; TopBar props untouched
**Decision**: A `useOpenTargets` hook (module-level cache, one fetch of health + open-apps per page load) feeds both the TopBar registry entry and the palette builder; no new TopBar props or slot-context fields.
**Why**: Keeps the TopBar prop/slot surface stable (e2e asserts chrome details), avoids client polling (code-quality anti-pattern), and the registry is effectively static per page load.
**Rejected**: Threading `openTargets` through the slot context (prop churn across app.tsx/TopBar/tests); per-menu-open refetch (needless requests, popup latency).
*Introduced by*: 260722-6d0f-navbar-open-in-app

## Tasks

### Phase 1: Setup

- [x] T001 Add `SSHHost` to `Config` + `Load()` (env `RK_SSH_HOST`) in `app/backend/internal/config/config.go` with tests in `config_test.go`; document the variable as a commented example in `.env` and in `rk serve --help` env-var text (`app/backend/cmd/rk/serve.go`) <!-- R4 -->

### Phase 2: Core Backend

- [x] T002 [P] Create `app/backend/internal/wt/wt.go` — `App{ID,Label,Kind}`, `ListApps(ctx)`, `Open(ctx, path, app)`, tolerant `parseApps` — plus `wt_test.go` (parse tolerance: unknown fields ignored, id/label required, non-JSON error; arg construction; PATH-stubbed exec success/absent paths mirroring `internal/riff` stub style) <!-- R1 -->
- [x] T003 Expose `sshHost` on `GET /api/health`: `Server.sshHost` field + wiring from `config.Load()` in `NewRouterAndServer` and a `SetSSHHost` test seam, response field in `app/backend/api/health.go`, tests in `health_test.go` <!-- R4 -->
- [x] T004 Add the `WtOps` interface + `prodWtOps` + `Server.wt` field + `NewTestRouterWithWt` in `app/backend/api/router.go`; register `GET /api/open-apps` and `POST /api/open` routes <!-- R2 -->
- [x] T005 Implement `app/backend/api/open.go` (`handleOpenApps` fail-silent; `handleOpen` with abs-path check, derived-path allowlist via `SessionFetcher`, live-registry app check, wrapper launch) + `open_test.go` covering: registry pass-through, wrapper-error → `200 []`, launch success, bad JSON, relative/empty path, unknown path, unknown app, `ListApps` error → 400, launch failure → 502 <!-- R3 -->

### Phase 3: Frontend

- [x] T006 [P] `app/frontend/src/api/client.ts`: `OpenApp` type, `getOpenApps()` (fail-silent `[]`), `openInApp(server, path, app)`, `HealthResponse.sshHost?`; tests in `client.test.ts`; add a `GET /api/open-apps` handler (`[]`) to `app/frontend/tests/msw/handlers.ts` <!-- R7 -->
- [x] T007 [P] `app/frontend/src/lib/open-in-app.ts`: `DEEPLINK_APPS` const (intake-verbatim grammar), `isLocalHostname`, `OpenTarget` model + `buildOpenTargets({local, sshHost, hostApps, path})`, `readLastUsedOpenTarget`/`writeLastUsedOpenTarget` (`runkit-open-last-used`), `activePaneCwd(window)`; tests in `open-in-app.test.ts` (section-visibility matrix, url grammar, last-used, cwd fallback chain) <!-- R5 -->
- [x] T008 `app/frontend/src/hooks/use-open-targets.ts`: fetch-once (module cache) of `getHealth().sshHost` + `getOpenApps()`, error-tolerant, `enabled` gate; test with mocked client <!-- R6 -->
- [x] T009 `app/frontend/src/components/open-button.tsx`: `OpenButton` split-button (primary = last-used else menu; chevron = menu; deeplink `window.location.href`, host `openInApp` with toast on error; labeled "on host" section when remote) + `OpenMenuRows` overflow rows; unit tests in `open-button.test.tsx` <!-- R6 -->
- [x] T010 Register the `open` entry in the right-cluster overflow registry in `app/frontend/src/components/top-bar.tsx` (terminal mode, hidden when no `currentWindow` or zero targets; positioned as first L1 candidate after `view-switcher`), calling `useOpenTargets` in TopBar; extend `top-bar.test.tsx` (renders with targets, hidden with zero targets) <!-- R6 -->
- [x] T011 `app/frontend/src/lib/palette-open.ts`: pure `buildOpenActions(targets, run)` with `(on host)` suffix rule + `palette-open.test.ts`; wire into `paletteActions` in `app/frontend/src/app.tsx` (documenting constitution-V registration) <!-- R8 -->

### Phase 4: Integration & e2e

- [x] T012 `app/frontend/tests/e2e/open-in-app.spec.ts` + sibling `open-in-app.spec.md`: stubbed-registry button presence + menu contents + palette entries; default-environment absence assertion <!-- R9 -->
- [x] T013 Audit existing top-bar e2e specs (`top-bar-overflow`, `top-bar-overlap`, `top-bar-persistence`, `window-heading`, `mobile-layout`) against the new control and run verification gates: `just test-backend`, `just test-frontend`, `just test-e2e`, `just build` <!-- R9 -->

## Execution Order

- T001 → T003 (health wiring reads `config.SSHHost`)
- T002 → T004 → T005 (wrapper types feed the seam; seam feeds handlers)
- T006/T007 [P] → T008 → T009 → T010/T011 → T012 → T013

## Acceptance

### Functional Completeness

- [x] A-001 R1: `internal/wt` wraps `wt open --list --json` and `wt open <path> -a <app>` via `exec.CommandContext` with timeouts; parser requires id+label and ignores unknown fields
- [x] A-002 R2: `GET /api/open-apps` returns the registry and degrades to `200 []` on any wrapper error
- [x] A-003 R3: `POST /api/open` validates path (server-derived allowlist) and app (live registry) before exec and launches via the wrapper
- [x] A-004 R4: `RK_SSH_HOST` loads in `internal/config` and surfaces as `sshHost` on `GET /api/health` (absent when unset)
- [x] A-005 R5: `DEEPLINK_APPS` is a static frontend const with the `{scheme}://vscode-remote/ssh-remote+${host}${path}` grammar for vscode/cursor/windsurf
- [x] A-006 R6: The Open split-button renders in the Terminal-route right cluster with primary/last-used + chevron/menu behavior and overflow menu rows
- [x] A-007 R7: `getOpenApps` (fail-silent) and `openInApp` exist in the API client with tests
- [x] A-008 R8: Every open target has a palette `Open: <label>` entry

### Behavioral Correctness

- [x] A-009 R5: Local clients see only the host section; remote clients see deeplinks (when sshHost set) plus a labeled "on host" section; zero targets hides the control
- [x] A-010 R6: Deeplink activation navigates via `window.location.href`; host activation POSTs; last-used persists to `runkit-open-last-used`

### Scenario Coverage

- [x] A-011 R3: Handler tests cover bad JSON, relative path, unknown path, unknown app, registry-error, launch-failure, and success paths
- [x] A-012 R9: e2e spec (with `.spec.md`) proves stubbed-registry presence/menu/palette and default-environment absence

### Edge Cases & Error Handling

- [x] A-013 R2: wt absent/old/erroring never yields a non-200 from `GET /api/open-apps`
- [x] A-014 R3: When `ListApps` errors, `POST /api/open` rejects every app id with 400 (nothing launches blind)
- [x] A-015 R6: A stored last-used target that is no longer available falls back to opening the menu

### Code Quality

- [x] A-016 Pattern consistency: New code follows naming/structural patterns of surrounding code (wrapper mirrors `internal/riff` exec style; button mirrors cluster-control style; palette lib mirrors `lib/palette-*.ts`)
- [x] A-017 No unnecessary duplication: Existing utilities reused (`writeJSON`/`writeError`, `deduplicatedFetch`, `MENU_ROW_CLASS`, `useToast`, localStorage try/catch pattern)
- [x] A-018 No client polling: registry + sshHost fetched once per page load, no `setInterval`
- [x] A-019 Type narrowing over assertions in new frontend code; no `as` casts where a guard suffices

### Security

- [x] A-020 R1: No shell-string construction anywhere; all subprocess calls are `exec.CommandContext` with argument slices and timeouts
- [x] A-021 R3: No user-supplied value reaches exec unvalidated — path allowlisted against server-derived state, app allowlisted against the live registry

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- **Apply-run verification record (T013)**: `just test-backend` all green (incl. new `internal/wt` + `api/open` tests); `just test-frontend` 1683/1683; `just test-e2e` 165 passed / 3 new open-in-app tests green — the 2 failures (`sidebar-window-sync` kill-then-create, `sync-latency` Kill window via Ctrl+click) reproduce identically on the CLEAN BASE with this change stashed (pre-existing, unrelated); `just build` fails pre-existing at `scripts/build.sh:19` (`cat VERSION` — the repo-root VERSION file was removed by the tag-driven release flow #193; CI supplies it from the tag). Frontend `vite build` + `tsc --noEmit` succeed; the Go binary compiles (`go build ./cmd/rk`).

## Deletion Candidates

None — this change adds new functionality (two API endpoints, a wt wrapper package, and the frontend Open control) without making existing code redundant. The wt wrapper is new surface (no prior `open -a` path existed in run-kit), the Open control is a new right-cluster registry entry, and all reused helpers (`writeJSON`/`writeError`, `deduplicatedFetch`, `MENU_ROW_CLASS`, `useToast`, `withServer`, `SessionFetcher`) remain in active use by their original callers.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `sshHost` rides `GET /api/health` (no new route) | Intake mandates "smallest existing bootstrap surface"; health already carries hostname and is fetched once at mount | S:75 R:85 A:85 D:80 |
| 2 | Confident | Path allowlist scoped to the `?server=` param via `FetchSessions` | Canonical derivation; matches every handler's server scoping; cross-server sweep costs subprocesses for no caller | S:65 R:80 A:80 D:70 |
| 3 | Confident | Wrapper package named `internal/wt` | Intake says "new wt wrapper in internal/"; shortest name matching `internal/tmux` convention | S:70 R:90 A:85 D:85 |
| 4 | Confident | Zero available targets hides the Open control entirely | Composition of the intake's two section-visibility rules; a button with an empty menu is a dead control | S:60 R:90 A:80 D:75 |
| 5 | Confident | Registry + sshHost fetched once per page load via a module-cached hook; TopBar props/slot untouched | No-polling rule; registry is static per load; keeps e2e-asserted chrome surface stable | S:55 R:85 A:75 D:65 |
| 6 | Confident | Open entry positioned as the first L1 candidate (drops into overflow before splits), keeping the existing pyramid e2e invariants | Overflow registry order encodes drop priority; earliest-drop placement is the only position that cannot break the L1/L2/L3 sweep assertions | S:50 R:85 A:75 D:60 |
| 7 | Confident | Last-used stored as kind-qualified id (`deeplink:vscode` / `host:vscode`) | Deeplink and host ids can collide for the same editor; composite key removes ambiguity at trivial cost | S:55 R:90 A:85 D:80 |
| 8 | Confident | Palette labels: `Open: <label>`, host targets suffixed `(on host)` only when remote | Mirrors the intake's labeled "on host" escape hatch; local view has no collision to disambiguate | S:50 R:90 A:75 D:65 |
| 9 | Confident | No new keyboard chord — palette entries alone satisfy constitution V | Palette is the constitution's "primary discovery mechanism"; chord space is crowded and the intake names palette registration, not a chord | S:60 R:90 A:80 D:75 |
| 10 | Confident | e2e stubs `GET /api/open-apps` via `page.route`; deeplink (remote) branch covered by Vitest only | wt `--list` does not exist yet; `location.hostname` cannot be non-local against the e2e server; page.route is established in 10+ existing specs | S:65 R:85 A:85 D:80 |
| 11 | Confident | `POST /api/open` launch failure maps to 502; `wt open` launch timeout 10s | Launch is a fast non-interactive spawn; 502 distinguishes downstream-tool failure from validation 4xx | S:45 R:85 A:70 D:60 |

11 assumptions (0 certain, 11 confident, 0 tentative).

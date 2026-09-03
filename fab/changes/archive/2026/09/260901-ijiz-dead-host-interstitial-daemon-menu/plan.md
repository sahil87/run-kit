# Plan: Dead-Host Interstitial & Daemon Menu Rework

**Change**: 260901-ijiz-dead-host-interstitial-daemon-menu
**Intake**: `intake.md`

## Requirements

### Desktop Shell: Dead-Host Interstitial

#### R1: A shell-owned interstitial replaces Chromium's error page in a failed view
The shell MUST load a shell-owned page (`src/interstitial/interstitial.html`) into a host view's webContents whenever that view's main-frame load fails, in place of Chromium's error page. The page MUST be a static HTML + no-import/export compiled TS pair mirroring `src/welcome/`: the same CSP (`default-src 'none'; script-src 'self'; style-src 'unsafe-inline'`), the same copied design tokens with `prefers-color-scheme` support, the same `[hidden] { display: none !important; }` rule, and the same structural bridge narrowing (`Reflect.get(window, "runkitShell")`, no `as` casts). The load MUST be main-initiated (`webContents.loadURL`) so it bypasses the `will-navigate` guard, and the URL MUST carry `?host={id}&kind={local|remote|url}`.

- **GIVEN** a window whose attached view points at a host that is not answering
- **WHEN** the view's main-frame load fails with a real error (not `ERR_ABORTED`)
- **THEN** main loads the interstitial into that view's webContents with the host's id and its derived kind in the query string
- **AND** the window shows the shell's own recovery page, never Chromium's error page

#### R2: Kind derivation is main-side and per host entry
Main MUST derive `kind` from the host entry: `local` when the entry's origin equals the probed local origin (`rk url`), `remote` when the entry carries a `remote` name, otherwise `url`. Every privileged action the page invokes MUST re-derive the host and kind from the **sender view** (`findViewByWebContentsId`), never from the query string.

- **GIVEN** an interstitial page rendered for host `H`
- **WHEN** the page invokes a privileged channel
- **THEN** main resolves the acting host from the sender's webContents id and ignores the page-supplied `host` parameter
- **AND** a sender whose webContents resolves to no view is rejected

#### R3: The `local` interstitial carries the This-Mac card's states and actions
For `kind=local` the page MUST poll `daemon:status` on the existing 3s cadence and render four states: *stopped* ("run-kit isn't running on this Mac" + an accent **Start run-kit** button invoking `daemon:start`), *starting…* (amber `starting… waiting for {host}:{port} to answer`, buttons disabled), *not responding* ("run-kit is running but isn't answering on {origin}" + an accent **Restart run-kit** button invoking `daemon:restart`), and *not installed* (the brew install line). An `inFlight` guard MUST prevent request pileup and a `busy` flag MUST suspend repainting while an action is in flight.

- **GIVEN** the local interstitial is showing and the daemon is stopped
- **WHEN** the user clicks **Start run-kit**
- **THEN** the page renders the amber *starting…* state with both buttons disabled
- **AND** on success main lands the SPA in that window; on failure the page renders the error inline and re-enables its buttons

#### R4: The `remote` and `url` interstitials each offer one Retry
For `kind=remote` the page MUST render "reconnecting to {name}…" while the existing `ensureRemoteConnected` heal is in flight and a **Retry** button that re-invokes the heal on failure. For `kind=url` the page MUST render "can't reach {origin}", a **Retry** button that reloads the view to `url + (lastPath ?? "")`, and one line pointing at the titlebar host-switcher's Edit Host for a wrong address. Both MUST route through a single main-side retry channel whose behavior branches on the sender view's derived kind.

- **GIVEN** a `url`-kind interstitial for an unreachable host
- **WHEN** the user clicks **Retry** and the host is still unreachable
- **THEN** the view's load fails again and the interstitial is shown again, with no error dialog and no stuck state

#### R5: A visible interstitial auto-heals the window on a read-only health poll
While an interstitial is visible in a view for a `local` or `url` host, main MUST poll that host's origin `/api/health` every 3s with an in-flight guard. On a healthy answer main MUST reload the view to `url + (lastPath ?? "")`. The poll MUST be read-only detection — it MUST NOT start, restart, or stop anything — and MUST stop when the view navigates away from the interstitial or is destroyed.

- **GIVEN** the local interstitial is showing and the user runs `rk daemon start` in a terminal
- **WHEN** the next health poll answers
- **THEN** the window reloads to the host's SPA route with no click
- **AND** the poll for that view is torn down

#### R6: Showing the interstitial stays equivalent to "load failed" for every consumer
Navigating a view to the interstitial MUST NOT clear that view's `viewLoadFailed` flag. The flag's pure transition (`nextLoadFailed` in `src/views.ts`) MUST distinguish an interstitial commit from a real host commit, so a view showing the interstitial is reloaded to the host by the next successful connect or heal exactly as an error-page view is today. Neither `lastPath` capture (`captureLastPathForView`) nor the window title / `windows.json` route (`routeForView`) may ever persist or render the interstitial URL.

- **GIVEN** a view showing the interstitial for a local host
- **WHEN** the user starts the daemon from the Local Daemon menu and the connect succeeds
- **THEN** `reloadFailedView` fires and the view loads `url + lastPath`
- **AND** the window record saved at quit carries the host's SPA route, never the `file://` interstitial path

### Desktop Shell: Local Daemon Lifecycle

#### R7: The daemon status model has three states
`DaemonStatus` MUST express the installed daemon as a three-state discriminated union — `running`, `stopped`, and `wedged` — instead of a `running` boolean. `probeDaemonStatus()` MUST classify **wedged** when the health ping fails but `rk daemon status --json` reports `daemon.running: true`. The JSON parse MUST live in `src/local-daemon.ts` as electron-free pure logic covered by `node --test`, and malformed or unparseable output MUST degrade to the ping-derived `stopped` state rather than erroring.

- **GIVEN** the rk-daemon tmux session is alive but the HTTP server does not answer
- **WHEN** `probeDaemonStatus()` runs
- **THEN** it reports the installed daemon as `wedged`
- **AND** a garbage `rk daemon status --json` stdout yields `stopped`, never an error state

#### R8: The Local Daemon submenu is Start / Restart / Stop with state-dependent enablement
The submenu MUST drop **Connect** and render **Start**, **Restart**, and **Stop** below its disabled status line, per this matrix (all items accelerator-less, as today):

| State | Status line | Start | Restart | Stop |
|-------|-------------|-------|---------|------|
| stopped | `○ stopped · v{X}` | enabled | enabled | disabled |
| running | `● running · v{X}` | disabled | enabled | enabled |
| wedged | `◐ not responding · v{X}` | disabled | enabled | enabled |

`DaemonMenuInfo` MUST carry the three-state value, and the change-gated menu-rebuild comparison MUST compare it. The enablement matrix and the status-line composition MUST be an **extracted pure decision** in an electron-free module so it is covered by `node --test`; `src/menu.ts` MUST consume that decision rather than re-deriving it. The version fragment stays omitted when unparseable.

- **GIVEN** the daemon is stopped
- **WHEN** the user opens Hosts → Local Daemon
- **THEN** the status line reads `○ stopped · v{X}`, Start and Restart are enabled, and Stop is disabled
- **AND** no item labelled "Connect" is present

#### R9: Start keeps the connect tail; Restart gets one
**Start** MUST invoke the existing `startAndConnectLocal` flow (start-if-needed → wait for health → activate-or-add → reload gate) so a start always lands the user in the SPA. **Restart** MUST run the same connect tail after the restart completes, so the menu item, the wedged dialogs, and the interstitial's Restart button all recover the window rather than only the daemon.

- **GIVEN** the daemon is wedged and the window shows the interstitial
- **WHEN** the user clicks **Restart run-kit**
- **THEN** the shell restarts the daemon, waits for health, activates the local entry, and reloads the failed view to the host route

#### R10: Every shell-invoked restart runs `rk daemon restart --full` under its own timeout
The menu's Restart item, the wedged-state dialogs, and the interstitial's Restart button MUST all run `["daemon", "restart", "--full"]`. The restart MUST use its own timeout constant (60s), not `RK_DAEMON_TIMEOUT_MS`, because `--full`'s documented sequence (12s stop grace + kill-server + port-free waits + fresh start + tunnel reconnect) can exceed 30s. User-facing labels MUST say "Restart", never `--full`; copy that mentions consequences MUST be honest that SSH tunnels blip and reconnect. The shell MUST NOT add any tunnel handling of its own — the CLI captures and reconnects the up-tunnel set.

- **GIVEN** any shell surface offering Restart
- **WHEN** the user confirms it
- **THEN** the shell runs `rk daemon restart --full` via `execFile` with an argument slice and a 60s timeout
- **AND** no user-visible string contains the `--full` flag

#### R11: An already-running start that never answers is reclassified as wedged and offered the fix
In `startAndConnectLocal`, an `isDaemonAlreadyRunning`-classified start followed by a `waitForHealth` timeout MUST be reclassified from a generic timeout error to the wedged state, and MUST surface a dialog with the message "run-kit reports running but isn't answering on {origin}" and buttons **Restart Daemon** / **Cancel** (Cancel default, the Stop-confirm precedent). A `daemon:start` invoked while the probe already reports `wedged` MUST take the same path immediately rather than burning the 30s health wait.

- **GIVEN** the daemon is wedged
- **WHEN** the user invokes Start from any surface
- **THEN** the wedged dialog appears without a 30s silent wait
- **AND** choosing **Restart Daemon** runs the R10 restart with the R9 connect tail

#### R12: Every daemon action gives in-flight feedback and surfaces failures immediately
Menu items MUST relabel and disable while their action runs — `Starting…` / `Restarting…` / `Stopping…` — using the Restart-to-Update item's pattern (synchronous state set, menu rebuild, restore on completion or error). The welcome card and the interstitial MUST render the amber progress state during start and restart. Failures MUST surface immediately (`dialog.showErrorBox` at minimum from menu-driven actions, inline on the pages), never after a silent wait with no state change.

- **GIVEN** the user clicks Restart in the Local Daemon submenu
- **WHEN** the restart is in flight
- **THEN** the item reads `Restarting…` and is disabled, and the other daemon items are disabled too
- **AND** on failure an error dialog appears and the items return to their state-derived enablement

#### R13: The welcome "This Mac" card gains the wedged row
The card MUST render a fifth state for `wedged`: a distinct (amber) status dot, the status line `not responding`, prose naming the origin, and a single accent **Restart run-kit** action. The four existing rows are unchanged.

- **GIVEN** the welcome page is showing and the daemon is wedged
- **WHEN** the 3s poll lands
- **THEN** the card shows the amber not-responding row with a single Restart action, and no Start-and-connect button

#### R14: A declined daemon action is distinguishable from a completed one
The `daemon:start` / `daemon:restart` / `daemon:stop` ack MUST distinguish three outcomes, not two: **acted** (main is
navigating the acting window away — the calling page deliberately stays busy), **declined** (the user cancelled a native
confirm — the page MUST clear `busy`, render no error, and resume its 3s status refresh), and **failed** (the page clears
`busy` and renders the error inline). Both renderer pages MUST honour all three. This covers the wedged dialog's **Cancel**
and `confirmAndStopDaemon`'s **Cancel**.

- **GIVEN** the wedged dialog is open after a start that never answered
- **WHEN** the user chooses **Cancel**
- **THEN** the acting page clears its progress state, shows no error, and resumes polling
- **AND** no surface is left with disabled controls or a suppressed refresh

### Non-Goals

- Streaming tunnel progress into the `remote` interstitial — the heal plus its existing error dialog is the whole remote surface this change adds (the welcome page keeps the only progress feed).
- Any SPA (`app/frontend`) or Go backend change — this is entirely `app/desktop`.
- Auto-starting the daemon. Every start/restart/stop stays behind an explicit click (Constitution VI); polling is read-only detection only.
- A jsdom or e2e harness for `app/desktop` — the compile + `node --test` gate remains the bar for page scripts.

### Design Decisions

#### Three-state daemon status, not a wedged boolean
**Decision**: `DaemonStatus` becomes a discriminated union on `state: "running" | "stopped" | "wedged"` (plus the `installed: false` arm), replacing the `running: boolean` field; `DaemonMenuInfo` carries the same three-state value.
**Why**: The menu matrix, the card, and the interstitial all branch three ways; a boolean plus a companion `wedged` flag makes two fields that can disagree, and every reader would have to know which wins.
**Rejected**: Keeping `running: false` and adding `wedged: true` — cheaper to land, but it encodes an illegal state (`running: true, wedged: true`) that the type system would then have to be trusted not to produce.
*Introduced by*: 260901-ijiz-dead-host-interstitial-daemon-menu

#### The interstitial is "still failed" via the pure flag transition, not a companion map
**Decision**: `LoadFlagEvent`'s `did-navigate` arm carries an `isInterstitial: boolean` the caller computes from the committed URL; `nextLoadFailed` preserves the flag on an interstitial commit and clears it only on a real host commit.
**Why**: The flag is already the single gate both connect heals read. Keeping one source of truth means every existing consumer (the remote heal, the local connect gate, `reloadFailedView`) is correct with no per-consumer edit, and the new rule stays pure and `node --test` covered.
**Rejected**: A companion "interstitial shown" map in `main.ts` — it duplicates the flag's lifetime, and every reader would have to remember to OR the two.
*Introduced by*: 260901-ijiz-dead-host-interstitial-daemon-menu

#### `routeForView` gains the origin-equality guard the capture seam already has
**Decision**: `routeForView` returns `""` when the view's current URL origin does not equal the host entry's `url`.
**Why**: With the interstitial, a view's `getURL()` can be a `file://` path. Unguarded, that path becomes the window-title route leaf **and** the `windows.json` record's `route`, so a cold-start restore would load `host.url + "/…/interstitial.html?…"`. Chromium's error page never exposed this because `getURL()` there returns the failed host URL.
**Rejected**: Special-casing the interstitial URL at each call site — the origin guard is the rule `captureLastPathForView` already uses, and it covers any future non-host page in a view.
*Introduced by*: 260901-ijiz-dead-host-interstitial-daemon-menu

#### The interstitial script is one IIFE
**Decision**: `src/interstitial/interstitial.ts` wraps its whole body in an immediately-invoked arrow function.
**Why**: `tsconfig.json` sets `moduleDetection: "auto"` over `include: ["src"]` precisely so `welcome.ts` compiles as a browser-runnable global script. A second import-free file in the same program shares that global scope, so any name it repeats (`LOCAL_STATUS_POLL_MS`, `DaemonBridge`, …) is a duplicate-identifier compile error.
**Rejected**: Prefixing every interstitial identifier — it works, but it puts a naming tax on every future edit to either page.
*Introduced by*: 260901-ijiz-dead-host-interstitial-daemon-menu

#### One retry channel, with main deriving the kind from the sender view
**Decision**: A single `interstitial:retry` channel branches main-side on the sender view's derived kind (remote → re-run `ensureRemoteConnected`; url → reload to `url + lastPath`); the page-supplied `?host`/`?kind` are presentation only.
**Why**: The page is a renderer; letting it name the host it acts on would make the query string a privilege parameter. The sender's webContents id already resolves to exactly one `(window, host)` view.
**Rejected**: Separate `remote:retry` / `url:retry` channels — two gates, two validators, one behavior.
*Introduced by*: 260901-ijiz-dead-host-interstitial-daemon-menu

#### The menu enablement matrix is an extracted pure decision
**Decision**: The status line and the Start/Restart/Stop enabled flags are computed by a pure function in the electron-free `src/local-daemon.ts`; `menu.ts` renders what it returns.
**Why**: `menu.ts` imports electron, so nothing in it can run under `node --test`. The three-state matrix (nine cells plus the in-flight overlay) is exactly the kind of decision that must be tested, and this is the module the codebase already reserves for local-daemon pure logic.
**Rejected**: Testing the matrix through `buildMenu` with an electron stub — a whole fake-module apparatus for one table.
*Introduced by*: 260901-ijiz-dead-host-interstitial-daemon-menu

## Tasks

### Phase 1: Pure logic and contracts

- [x] T001 [P] In `app/desktop/src/local-daemon.ts`, rework `DaemonStatus` into the three-state discriminated union (`installed: false` | `{ installed: true; state: "stopped" | "wedged"; version; origin }` | `{ installed: true; state: "running"; version; origin; hostname; sessions }`) and add `parseDaemonStatusRunning(output: string): boolean | null` — a tolerant `rk daemon status --json` parse returning `daemon.running`, or `null` on any malformed/unparseable input. <!-- R7 -->
- [x] T002 [P] In `app/desktop/src/local-daemon.ts`, add the extracted menu decision `daemonMenuModel(info)` returning the status line (`● running` / `○ stopped` / `◐ not responding`, plus the ` · v{X}` fragment when the version parses) and the `{ label, enabled }` triple for Start / Restart / Stop per the R8 matrix, with the in-flight overlay (`Starting…` / `Restarting…` / `Stopping…`, all three disabled) applied on top. Add the restart timeout constant (60s) here or in `main.ts` beside its siblings, whichever keeps the existing timeout-tier comment coherent. <!-- R8 -->
- [x] T003 [P] In `app/desktop/src/views.ts`, extend `LoadFlagEvent`'s `did-navigate` arm with `isInterstitial: boolean` and make `nextLoadFailed` preserve the flag on an interstitial commit while still clearing it on a real host commit; update the doc comment to state the new invariant. <!-- R6 -->
- [x] T004 Extend `app/desktop/src/local-daemon.test.ts` with `node --test` coverage for `parseDaemonStatusRunning` (running true/false, missing `daemon` key, non-JSON stdout, empty stdout) and for `daemonMenuModel` across all three states × the in-flight overlay, including the unparseable-version case. <!-- R7, R8 --> <!-- rework: A-016 requires real `rk daemon status --json` output, not a reduced object -->
- [x] T005 Extend `app/desktop/src/views.test.ts` with cases proving an interstitial `did-navigate` preserves a set flag and a host `did-navigate` still clears it. <!-- R6 -->

### Phase 2: Main-side daemon lifecycle

- [x] T006 In `app/desktop/src/main.ts`, extend `probeDaemonStatusUncached()` so a failed health ping runs `rk daemon status --json` through `runRk` (read-only tier timeout) and classifies `wedged` when `parseDaemonStatusRunning` returns `true`, degrading to `stopped` on `null` or a failed invocation. Update `toDaemonMenuInfo` / `sameDaemonMenuInfo` to carry and compare the three-state value. <!-- R7 -->
- [x] T007 In `app/desktop/src/main.ts`, add `RK_DAEMON_RESTART_TIMEOUT_MS` (60s, its own documented tier) and rewrite `restartLocalDaemon` as `restartAndConnectLocal(win)`: run `["daemon", "restart", "--full"]` → `waitForHealth(origin)` → `connectLocalHost` (the existing reload-gated tail) → `refreshDaemonMenu`, surfacing failures via the existing error paths. <!-- R9, R10 --> <!-- rework: an execFile failure with empty stderr surfaces Node's `Command failed: /path/rk daemon restart --full` — the flag and the binary path reach the user -->
- [x] T008 In `app/desktop/src/main.ts`, add the wedged reclassification to `startAndConnectLocal`: a `wedged` probe short-circuits to the wedged dialog, and an already-running start whose `waitForHealth` times out routes there too. The dialog is a native `showMessageBox` with message "run-kit reports running but isn't answering on {origin}", buttons **Restart Daemon** / **Cancel**, Cancel as `defaultId`/`cancelId`; confirming invokes T007's restart flow. <!-- R11 --> <!-- rework: stale comment still describes a Local Daemon `Connect` item --> <!-- rework: cancelling the wedged dialog returns an error, so an intentional Cancel opens an error box --> <!-- rework: Cancel now returns an ack the pages read as "navigating away", hanging them busy -->
- [x] T009 In `app/desktop/src/main.ts`, add the in-flight action state (`"start" | "restart" | "stop" | null`) set synchronously before each daemon action and cleared in a `finally`, each write followed by `rebuildMenu()`; thread it into `DaemonMenuInfo` so `daemonMenuModel` renders the `…ing` overlay. <!-- R12 -->
- [x] T010 In `app/desktop/src/menu.ts`, replace `onDaemonConnect` with `onDaemonStart` in `MenuCallbacks`, widen `DaemonMenuInfo` to the three-state + in-flight shape, and render `localDaemonSubmenu` from `daemonMenuModel` (status line + the three items). Update `main.ts`'s `rebuildMenu` callbacks accordingly. Every item stays accelerator-less. <!-- R8, R12 -->

### Phase 3: The interstitial page

- [x] T011 Add `app/desktop/src/interstitial/interstitial.html` — the welcome page's CSP, copied tokens with the `prefers-color-scheme` override, the `[hidden]` rule, the static titlebar strip, and the state containers for the local / remote / url kinds (status dot, headline, detail line, action button, error line). Add the `dist/interstitial` copy step to the `compile` script in `app/desktop/package.json`. <!-- R1 -->
- [x] T012 Add `app/desktop/src/interstitial/interstitial.ts` — the whole body inside an IIFE (global-script collision, see Design Decisions). It reads `?host`/`?kind`, narrows `runkitShell.__daemon` / `__interstitial` structurally, and for `kind=local` polls `daemon:status` at 3s with `inFlight` + `busy` guards, rendering the stopped / starting… / not-responding / not-installed states and wiring Start → `daemon:start`, Restart → `daemon:restart`. <!-- R3 -->
- [x] T013 In `app/desktop/src/interstitial/interstitial.ts`, render the `remote` kind (reconnecting line + **Retry**) and the `url` kind ("can't reach {origin}" + **Retry** + the Edit-Host pointer), both invoking `interstitial:retry`. <!-- R4 -->
- [x] T021 In `app/desktop/src/main.ts`, give the daemon-action ack a third outcome so a user-declined confirm is neither a success-that-navigates nor a failure: return the declined signal from the wedged dialog's Cancel and from `confirmAndStopDaemon`'s Cancel, leaving the acted and failed shapes as they are. <!-- R14 -->
- [x] T022 In `app/desktop/src/welcome/welcome.ts` and `app/desktop/src/interstitial/interstitial.ts`, branch on the three-outcome ack: stay busy only on *acted*; on *declined* clear `busy`, render no error, re-render the last status and resume the 3s refresh; on *failed* keep today's inline-error behaviour. <!-- R14 -->
- [x] T014 In `app/desktop/src/preload.ts`, add `__daemon.restart()` and a `__interstitial` group with `retry()`, documented in the header comment exactly like the existing `__daemon` / `__welcome` groups (exposed everywhere, privileged nowhere but the shell pages). <!-- R3, R4 -->

### Phase 4: Wiring the interstitial into the view lifecycle

- [x] T015 In `app/desktop/src/main.ts`, add `INTERSTITIAL_PATH`/`INTERSTITIAL_URL`, the kind derivation (`local` when the host origin equals the probed `rk url` origin, `remote` when the entry carries a `remote` name, else `url`), and the load-on-failure seam in `createHostView`'s `did-fail-load` handler: after the flag transition, main-initiated `loadURL` of the interstitial with `?host={id}&kind={kind}`. Pass `isInterstitial` into the `did-navigate` flag transition. <!-- R1, R2, R6 --> <!-- rework: kind derivation classifies an uninstalled local host as `url`, so the local not-installed state is unreachable -->
- [x] T016 In `app/desktop/src/main.ts`, add the origin-equality guard to `routeForView` so a non-host URL contributes `""` to the window title and to the `windows.json` record. <!-- R6 -->
- [x] T017 In `app/desktop/src/main.ts`, add the per-view interstitial health poll: a 3s `pingServer` loop with an in-flight guard, started when the interstitial is loaded for a `local` or `url` host, reloading the view to `url + (lastPath ?? "")` on a healthy answer, and torn down on navigation away from the interstitial and in `destroyHostViews` / `destroyWindowViews`. <!-- R5 -->
- [x] T018 In `app/desktop/src/main.ts`, widen the `daemon:*` privilege gate to the shell's own pages (`isWelcomeSender(event) || isInterstitialSender(event)`), add the `daemon:restart` handler (T007's flow on the sender's window), and add the `interstitial:retry` handler that resolves the sender's view, re-derives the kind, and runs the remote heal or the view reload. Reject a sender resolving to no view. <!-- R2, R3, R4 --> <!-- rework: daemon gate does not re-derive `local` kind from the sender view; remote Retry no-ops inside the suppression window -->

### Phase 5: Welcome card + verification

- [x] T019 In `app/desktop/src/welcome/welcome.{html,ts}`, update `LocalDaemonStatus` and `narrowDaemonStatus` to the three-state shape and add the wedged row to the card's `render` (amber dot, `not responding`, origin prose, single accent **Restart run-kit** invoking `daemon:restart`), keeping the four existing rows unchanged and the amber progress state shared by start and restart. <!-- R13, R12 -->
- [x] T020 Run the package gates from `app/desktop`: `pnpm run compile` (type check + page copies) and `pnpm test` (`node --test dist/**/*.test.js`), then `cd app/frontend && npx tsc --noEmit` and `cd app/backend && go test ./...` to confirm nothing outside `app/desktop` moved. Fix any fallout. <!-- R1, R7, R8 -->

## Execution Order

- Phase 1 (T001–T003) blocks everything: T001's union and T002's decision are consumed by T006/T010, T003's transition by T015.
- T004/T005 may run alongside Phase 2 but must be green before T020.
- T007 blocks T008 (the dialog invokes the restart flow) and T018 (the `daemon:restart` handler).
- T011 blocks T012 and T013 (same page). T014 blocks T012/T013's bridge reads at runtime but not their compilation.
- T015 blocks T017 (the poll starts where the interstitial is loaded).
- T019 depends on T001's union.
- T020 runs last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `src/interstitial/interstitial.{html,ts}` exist, carry the welcome page's CSP and token block, compile into `dist/interstitial/`, and are loaded into a failed view's webContents by a main-initiated `loadURL` carrying `?host=` and `?kind=`.
- [x] A-002 R2: Kind derivation is main-side, and every privileged handler the interstitial invokes resolves its host from `findViewByWebContentsId(event.sender.id)`, not from the query string.
- [x] A-003 R3: The local interstitial renders all four states from a 3s `daemon:status` poll with `inFlight` and `busy` guards, and its Start / Restart buttons invoke `daemon:start` / `daemon:restart`.
- [x] A-004 R4: The remote and url interstitials each render their copy and a Retry button, both routed through the single `interstitial:retry` channel.
- [x] A-005 R5: A main-side 3s `/api/health` poll is scoped to a visible interstitial for `local`/`url` hosts, reloads the view to `url + (lastPath ?? "")` on success, and is torn down on navigate-away and on view/window destruction.
- [x] A-006 R7: `DaemonStatus` is the three-state union, `probeDaemonStatusUncached` classifies wedged from `rk daemon status --json`, and `parseDaemonStatusRunning` is pure and exported from `local-daemon.ts`.
- [x] A-007 R8: The Local Daemon submenu renders Start / Restart / Stop with the matrix's enablement in all three states, contains no "Connect" item, and takes its labels and flags from the extracted `daemonMenuModel`.
- [x] A-008 R10: Every shell restart path invokes `execFile` with `["daemon", "restart", "--full"]` and the 60s constant.
- [x] A-009 R13: The welcome This-Mac card renders the fifth (wedged) row with a single Restart action.

- [x] A-031 R14: The daemon-action ack distinguishes acted / declined / failed, and both Cancel paths (wedged dialog, stop confirm) return declined.

### Behavioral Correctness

- [x] A-010 R6: Navigating a view to the interstitial leaves `viewLoadFailed` true — `nextLoadFailed` preserves the flag on an interstitial `did-navigate` and clears it on a host `did-navigate`.
- [x] A-011 R6: `routeForView` returns `""` for a view whose URL origin differs from its host entry's `url`, so neither the window title nor the `windows.json` record can carry the interstitial path.
- [x] A-012 R9: Both Start and Restart end in the connect tail (`connectLocalHost` + `reloadFailedView`), so a successful action lands the SPA in the acting window rather than leaving it on the interstitial.
- [x] A-013 R11: A wedged probe and an already-running-start-that-never-answers both reach the wedged dialog (Restart Daemon / Cancel, Cancel default) instead of a generic timeout error, and the wedged probe does not burn the 30s health wait. **Rework resolved:** Cancel returns the distinct declined outcome, so both shell pages clear their busy state and resume polling.
- [x] A-032 R14: Cancelling a daemon confirm leaves no page busy — controls re-enable, no error renders, and the 3s status refresh resumes on both the welcome card and the interstitial.
- [x] A-014 R12: Menu items relabel to `Starting…` / `Restarting…` / `Stopping…` and disable while their action runs, restoring state-derived enablement on completion or error.

### Scenario Coverage

- [x] A-015 R1: `node --test` covers the flag transition and menu-matrix decisions this change adds; the interstitial page script and main-side glue follow the welcome precedent (compile gate only — no jsdom/e2e harness exists in `app/desktop`).
- [x] A-016 R7: `local-daemon.test.ts` exercises `parseDaemonStatusRunning` on real `rk daemon status --json` output, on `daemon.running: false`, and on malformed/empty stdout.
- [x] A-017 R8: `local-daemon.test.ts` exercises `daemonMenuModel` across the three states and the in-flight overlay, including the unparseable-version case.

### Edge Cases & Error Handling

- [x] A-018 R7: Malformed or failing `rk daemon status --json` degrades to the ping-derived `stopped` state — never an error surface, never a thrown parse.
- [x] A-019 R4: A Retry that fails again re-shows the interstitial with no dialog and no stuck busy state.
- [x] A-020 R3: A failed `daemon:start` / `daemon:restart` from the interstitial renders inline on the page and re-enables its buttons; the page never stays busy after a rejected invoke.
- [x] A-021 R2: An `interstitial:retry` or `daemon:*` call from any sender that is not the welcome or interstitial page (or that resolves to no view) is rejected.
- [x] A-022 R10: No user-facing string in the menu, dialogs, or pages contains `--full`; copy mentioning consequences says tunnels blip and reconnect. **Rework resolved:** timeout and empty-stderr failures now use a sanitized public command label rather than Node's generated command-error message.

### Code Quality

- [x] A-023 Pattern consistency: New code follows the surrounding patterns — pure logic in the electron-free modules with `node --test` coverage, impure glue in `main.ts`, structural bridge narrowing with no `as` casts, and the page script import-free.
- [x] A-024 No unnecessary duplication: The existing `pingServer`, `runRk`, `waitForHealth`, `connectLocalHost`, `reloadFailedView`, and `switchToHost` seams are reused rather than re-implemented for the new surfaces.
- [x] A-025 Named constants: The restart timeout and the interstitial poll cadence are named constants beside their documented siblings, not magic numbers.
- [x] A-026 Comment discipline: Comments state constraints the code cannot show (the global-script IIFE reason, the interstitial flag invariant, the `routeForView` guard's reason); none narrate the next line or cite change IDs / PR numbers.
- [x] A-027 Type narrowing over assertions: The widened `DaemonStatus` union is consumed by discriminated narrowing in `main.ts`, `menu.ts`, `welcome.ts`, and `interstitial.ts` — no `as` casts.

### Security

- [x] A-028 R2: Every new `execFile` invocation uses an argument slice and an explicit timeout — no shell strings, no `exec`/`execSync` (Constitution I).
- [x] A-029 R2: The widened `daemon:*` gate admits only the shell's own `file://` pages; a registered host origin cannot reach `daemon:start` / `daemon:restart` / `daemon:stop`, and the navigation guard still prevents a remote page from navigating itself to the interstitial URL.
- [x] A-030 R5: The interstitial health poll is read-only detection — it starts, restarts, and stops nothing (Constitution VI).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- This change builds on `260901-ggjb-reload-failed-local-view`, already present in this worktree (`connectLocalHost`'s `reloadFailedView` call).

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Every shell-invoked restart runs `rk daemon restart --full` | Explicit user direction carried from the intake, overriding the escalation-ladder alternative | S:95 R:85 A:95 D:95 |
| 2 | Certain | The interstitial script is one IIFE (`moduleDetection: "auto"` puts import-free files in a shared global scope) | A mechanical constraint of the existing tsconfig — a second global script otherwise fails to compile | S:60 R:90 A:95 D:85 |
| 3 | Certain | `routeForView` gains the origin-equality guard `captureLastPathForView` already has | Without it the interstitial's `file://` path becomes the window title leaf and the persisted `windows.json` route; the guard is the established rule | S:70 R:90 A:90 D:85 |
| 4 | Certain | The menu enablement matrix is extracted into the electron-free `local-daemon.ts` and consumed by `menu.ts` | The intake names the extraction; `menu.ts` imports electron and cannot run under `node --test` | S:80 R:85 A:85 D:75 |
| 5 | Confident | `DaemonStatus` becomes a `state: "running" \| "stopped" \| "wedged"` union rather than gaining a `wedged` boolean | Three consumers branch three ways; a boolean pair encodes an illegal state | S:70 R:75 A:85 D:70 |
| 6 | Confident | The failed-state invariant rides an `isInterstitial` field on the pure `did-navigate` transition, not a companion map in main | Keeps one source of truth, so every existing flag consumer is correct with no edit, and the rule stays `node --test` covered | S:75 R:80 A:85 D:65 |
| 7 | Confident | Restart shares the connect tail (`restartAndConnectLocal`), like Start | The interstitial's Restart must land the SPA; one tail keeps menu and page paths from diverging (the existing one-flow discipline) | S:60 R:85 A:75 D:60 |
| 8 | Confident | One `interstitial:retry` channel, with main re-deriving host and kind from the sender view | The query string is presentation; letting it name the acting host would make it a privilege parameter | S:55 R:85 A:80 D:60 |
| 9 | Confident | `RK_DAEMON_RESTART_TIMEOUT_MS` = 60s, its own tier beside the existing 5s/10s/30s constants | `--full`'s documented sequence can exceed 30s; a killed restart mid-sequence is the worst outcome | S:55 R:90 A:80 D:70 |
| 10 | Confident | Main's auto-heal poll covers `local` and `url` kinds; a `local` page additionally polls `daemon:status` for its own rendering | The two polls have distinct jobs (heal vs. render) and both are cheap local GETs; collapsing them would couple page rendering to the heal seam | S:60 R:90 A:75 D:60 |
| 11 | Confident | Wedged glyph and copy: `◐ not responding · v{X}` in the menu, "running but isn't answering on {origin}" on the pages | Follows the existing ●/○ status-line convention; the three-state model, not the glyph, is the contract | S:50 R:95 A:70 D:45 |
| 12 | Confident | The `remote` interstitial adds only a Retry over the existing heal — no tunnel progress streaming | Keeps scope on the local-daemon incident; streaming is welcome-page-only today | S:45 R:80 A:65 D:55 |

12 assumptions (4 certain, 8 confident, 0 tentative).

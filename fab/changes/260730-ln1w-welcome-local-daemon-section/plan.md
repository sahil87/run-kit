# Plan: Desktop Welcome "This Mac" Local-Daemon Section

**Change**: 260730-ln1w-welcome-local-daemon-section
**Intake**: `intake.md`

## Requirements

### Desktop Shell: Welcome "This Mac" Section

#### R1: Local-server section with four normative states
The welcome page (`src/welcome/welcome.html` + `welcome.ts`) SHALL render a "This Mac" local-server section ABOVE the existing remote-connect form, separated by an "or a remote server" divider. The section MUST implement exactly the four approved-mock states:

| State | Dot | Status line | Detail line | Buttons |
|-------|-----|-------------|-------------|---------|
| running | green (`#34d399`) | `running · v{X}` | `{host}:{port} · N sessions` | **Connect** (accent) + **Stop** (ghost) |
| stopped | grey | `stopped` | `` rk v{X} installed · runs `rk daemon start` `` | single accent **Start & connect** |
| starting… | amber | `starting…` | `waiting for {host}:{port} to answer` | buttons disabled |
| not installed | — | section collapses to a hint | `brew install sahil87/tap/run-kit` | none |

"Start & connect" is ONE button. The page visual language matches the existing card (dark, monospace, `#34d399` accent). The page SHALL poll `daemon:status` every 3s while visible (interval torn down with the page; no polling in `?mode=rename`). The script stays a vanilla-TS no-import/export browser script under the existing CSP, with structural bridge narrowing and no `as` casts.

- **GIVEN** the welcome page opens on darwin with a running local daemon
- **WHEN** the first `daemon:status` poll resolves
- **THEN** the section shows a green dot, `running · v{X}`, `{host}:{port} · N sessions`, and Connect + Stop buttons

- **GIVEN** rk is not installed
- **WHEN** the status poll resolves `installed: false`
- **THEN** the section collapses to the brew-install hint with no buttons

#### R2: Detection derives, never assumes
The Electron main process SHALL resolve the local server URL via `rk url` (config-derived; never hardcoded) and health-check it with the SAME probe the remote form uses (`pingServer`: `net.fetch(origin + "/api/health")`, 5s timeout, `status === "ok"` + `hostname`). The rk binary SHALL be resolved via fixed candidate paths first (`/opt/homebrew/bin/rk`, `/usr/local/bin/rk`; linuxbrew path on linux) with a plain PATH lookup as fallback (macOS GUI PATH trap). A binary that cannot be invoked (ENOENT) yields the not-installed state. `v{X}` sources from `rk --version`; `N sessions` sources from `GET {origin}/api/sessions` fetched main-side (failure degrades to no session count, never an error state).

- **GIVEN** rk is installed at `/opt/homebrew/bin/rk` and the GUI PATH lacks Homebrew
- **WHEN** the main process probes daemon status
- **THEN** the candidate path resolves the binary and detection proceeds (no hardcoded URL anywhere)

- **GIVEN** `rk url` prints `http://127.0.0.1:3000` and nothing answers `/api/health`
- **WHEN** the probe completes
- **THEN** the status is `stopped` carrying the version and origin

#### R3: Sender-gated `daemon:*` IPC with execFile timeouts
Three new channels — `daemon:status` / `daemon:start` / `daemon:stop` — SHALL follow the existing `welcome:*` pattern: main-side `senderFrame.url` gating (welcome page only), structural payload narrowing, discriminated `{ ok } | { ok: false, error }` envelopes. The preload exposes a `__daemon` invoker group. ALL subprocess invocations MUST use execFile-style argument slices with timeouts — never shell strings (short timeout for `rk url`/`--version`; longer for daemon start/stop/restart). The shell's child_process posture is amended: child_process ONLY for explicit user-initiated `rk daemon` actions and read-only detection — the app never auto-starts the daemon (no lifecycle action outside a button/menu click).

- **GIVEN** a page loaded from a registered server origin
- **WHEN** it invokes `daemon:start`
- **THEN** it receives `{ ok: false, error: "Not allowed" }` and no subprocess runs

- **GIVEN** any rk invocation
- **WHEN** the code is inspected
- **THEN** every call is `execFile` with an argument slice and an explicit `timeout`

#### R4: Start & connect / Connect — one main-side flow, dedupe by origin
`daemon:start` SHALL run the whole get-in flow main-side: probe status → if stopped, run `rk daemon start` (treating a `daemon already running` error as already-started success) → poll the health endpoint (1s cadence, 30s cap) until it answers → then connect: if a servers.json entry already matches the origin (`findServerByOrigin`), activate it via the existing `switchToServer` seam — NEVER create a duplicate; otherwise walk the existing add-server path (`addServer` persists, sets active; name auto-derived from the ping's `hostname`) and load the URL. Start failure surfaces stderr through the card's existing inline-error idiom. The running-state Connect button uses the same channel (the flow skips the start step).

- **GIVEN** the daemon is stopped and no local entry exists
- **WHEN** the user clicks "Start & connect"
- **THEN** `rk daemon start` runs, health is polled until it answers, a local entry is persisted + set active, and the window navigates to it

- **GIVEN** a local entry for the origin already exists
- **WHEN** the user clicks Connect
- **THEN** the existing entry is activated (lastPath restored) and no duplicate is added

- **GIVEN** `rk daemon start` exits non-zero with `daemon already running` in stderr
- **WHEN** the flow evaluates the error
- **THEN** it proceeds to the health poll as already-started success

#### R5: Stop with tmux-survives confirm
`daemon:stop` SHALL show a native `dialog.showMessageBox` confirm (Cancel default — the Remove-server precedent) whose copy states that tmux sessions survive, then run `rk daemon stop`. The confirm + stop path is ONE main-side function shared by the card button and the menu item.

- **GIVEN** the user clicks Stop (card or menu)
- **WHEN** the confirm dialog appears
- **THEN** the detail copy states tmux sessions and agents survive, Cancel is the default, and only explicit confirmation runs `rk daemon stop`

#### R6: "Local Daemon" app-menu submenu
`src/menu.ts` SHALL add a "Local Daemon" submenu to the Servers menu (below the server list, separated) showing a disabled status line (`● running · v{X}` / `○ stopped · v{X}`) and accelerator-less items **Connect / Restart / Stop** (Restart/Stop disabled when stopped). Restart maps to `rk daemon restart`. The submenu is hidden when rk is not installed (and on win32). Main keeps a cached daemon status for the menu, refreshed by the welcome poll, after daemon actions, on startup, and on window focus — rebuilt only when the menu-relevant info changes.

- **GIVEN** rk is installed and the daemon runs
- **WHEN** the Servers menu opens
- **THEN** Local Daemon shows `● running · v{X}` with Connect/Restart/Stop enabled, none carrying accelerators

- **GIVEN** rk is not installed
- **WHEN** the menu is built
- **THEN** no Local Daemon submenu exists

#### R7: Display-name field removed from the connect form
The plain connect/add flow SHALL NOT show the Display-name input; the name auto-derives from the ping's returned `hostname` (empty hostname falls back to the origin via `addServer`'s existing rule). The `?mode=rename` variant KEEPS the name input (page-reuse rename affordance, unaffected).

- **GIVEN** the plain welcome connect form
- **WHEN** the user connects to a healthy remote server
- **THEN** no name input is visible and the persisted entry is named by the ping hostname (origin when hostname is empty)

- **GIVEN** `?mode=rename&id=…`
- **WHEN** the page renders
- **THEN** the name input is visible, pre-filled, and rename works as before

#### R8: Platform conditioning
The local section SHALL be suppressed entirely on `win32`; on `darwin`/`linux` it renders detection-driven with the heading "This Mac" (darwin) / "This Machine" (linux). The brew hint is valid on both (Homebrew tap works on darwin and linux).

- **GIVEN** the shell runs on win32
- **WHEN** the welcome page renders
- **THEN** no local section, no divider, no daemon polling, and no Local Daemon submenu exist

#### R9: Pure logic module with node:test coverage
Pure logic — rk binary candidate resolution, `rk --version` parsing, session-count parsing, already-running error classification — SHALL land in an electron-free module (`src/local-daemon.ts`) covered by a sibling `node --test` suite, preserving the three-dep pin (`node:child_process` is stdlib). (The platform→heading mapping lives inline in `welcome.ts`, which is deliberately import-free — an export there would be dead code.)

- **GIVEN** the compiled package
- **WHEN** `node --test "dist/**/*.test.js"` runs
- **THEN** the local-daemon suite passes without any electron import

### Non-Goals

- Auto-starting the daemon on app launch (viewer posture preserved; launchd autostart is a separate future change)
- Umbrella `rk update`, installer servers.json seeding, proxy.go Content-Length correction
- Backend/Go or SPA (`app/frontend`) changes — `rk url`, `rk daemon start/stop/restart`, `rk --version`, `/api/health`, `/api/sessions` consumed as-is

### Design Decisions

#### Start & connect runs entirely main-side behind `daemon:start`
**Decision**: `daemon:start` performs the full flow (start if stopped → health poll → dedupe-or-add → navigate); the renderer only renders progress and errors. The running-state Connect uses the same channel.
**Why**: The intake pins exactly three channels, and the dedupe rule (`findServerByOrigin`) plus the add-server path live main-side — one seam for card and menu makes divergence structurally impossible (the `switchToServer` precedent).
**Rejected**: Renderer-orchestrated connect via `servers:list` + `welcome:add-server` — duplicates the dedupe rule renderer-side and splits the flow across two privilege gates for no gain.
*Introduced by*: 260730-ln1w-welcome-local-daemon-section

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/desktop/src/local-daemon.ts` — electron-free pure module: `rkCandidatePaths(platform)`, `resolveRkBinary(candidates, exists)`, `parseRkVersion(output)`, `parseSessionCount(body)`, `isDaemonAlreadyRunning(message)`, and the `DaemonStatus` type <!-- R2, R8, R9 -->
- [x] T002 [P] Create `app/desktop/src/local-daemon.test.ts` — node:test suite covering candidate order + PATH fallback (incl. empty win32 candidates), real `rk --version` output parsing, session-count parsing, already-running classification <!-- R9 -->

### Phase 2: Core Implementation

- [x] T003 `app/desktop/src/main.ts` — daemon plumbing: promisified `execFile` runner with named timeout constants, `probeDaemonStatus()` (version → `rk url` → shared `pingServer` → session count), `startAndConnectLocal()` (already-running tolerance, 1s/30s health poll, `findServerByOrigin` dedupe → `switchToServer` or `addServer`), `confirmAndStopDaemon()` (tmux-survives confirm), `restartLocalDaemon()`; amend the header's no-child_process note to the new posture <!-- R2, R4, R5 -->
- [x] T004 `app/desktop/src/preload.ts` + `src/main.ts` — `__daemon` invoker group (`status`/`start`/`stop`) and the three `isWelcomeSender`-gated `daemon:*` handlers <!-- R3 -->
- [x] T005 `app/desktop/src/menu.ts` + `src/main.ts` — "Local Daemon" submenu (status line + Connect/Restart/Stop, accelerator-less, disabled-when-stopped), `buildMenu` gains a `daemon: DaemonMenuInfo | null` param; main wires callbacks, caches menu info, refreshes on startup/focus/action/poll-change <!-- R6 -->
- [x] T006 `app/desktop/src/welcome/welcome.html` — "This Mac" section markup (heading, dot, status/detail lines, Connect/Stop + hint) with divider and styles (ghost button, dot colors, divider rule); hide the Display-name label+input by default <!-- R1, R7, R8 -->
- [x] T007 `app/desktop/src/welcome/welcome.ts` — local-section state machine (running/stopped/starting…/not-installed render), 3s status polling with in-flight guard and rename-mode/win32 suppression, Start & connect + Connect + Stop wiring via `__daemon` structural narrowing, platform heading; connect flow drops the name input (hostname auto-derive), rename mode unhides it <!-- R1, R4, R7, R8 -->

### Phase 3: Integration & Edge Cases

- [x] T008 Run the desktop gates — `cd app/desktop && pnpm install --frozen-lockfile && pnpm run compile && pnpm run test` — and fix any compile/test failures <!-- R9 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The welcome page renders the "This Mac" section above the remote form with the four mock states (exact copy, dot colors, button sets) and the "or a remote server" divider
- [x] A-002 R2: The local URL comes from `rk url` output (no hardcoded URL), health-checked via the shared `pingServer` probe; the binary resolves candidates-first with PATH fallback
- [x] A-003 R3: `daemon:status`/`daemon:start`/`daemon:stop` exist, are gated on the welcome sender, and answer discriminated envelopes; preload exposes the `__daemon` group
- [x] A-004 R4: `daemon:start` starts (when stopped), polls health, then activates an existing same-origin entry or persists a new one named by the ping hostname — never a duplicate
- [x] A-005 R5: Stop shows a native confirm (Cancel default) whose copy states tmux sessions survive, shared by card and menu
- [x] A-006 R6: The Servers menu carries a Local Daemon submenu with a status line and accelerator-less Connect/Restart/Stop; hidden when rk is not installed
- [x] A-007 R7: The plain connect form has no visible Display-name input and names entries from the ping hostname; `?mode=rename` still shows and uses the name input
- [x] A-008 R8: On win32 the local section and Local Daemon submenu are absent; darwin says "This Mac", linux says "This Machine"

### Behavioral Correctness

- [x] A-009 R4: A `daemon already running` start error proceeds to the health poll as success; a genuine start failure surfaces stderr in the card's inline-error element
- [x] A-010 R1: Status polling runs at 3s only while the local section is live (no polling in rename mode; interval dies with the page); the starting… state disables buttons

### Scenario Coverage

- [x] A-011 R9: `local-daemon.test.ts` covers candidate resolution, version parsing (`run-kit version v3.12.7` shape), session-count parsing, and already-running classification, passing under `node --test`

### Edge Cases & Error Handling

- [x] A-012 R2: rk-not-found (ENOENT) yields the not-installed hint state; a health-poll timeout after start surfaces an inline error rather than hanging
- [x] A-013 R2: A `/api/sessions` fetch failure degrades the running detail to `{host}:{port}` without breaking the running state

### Code Quality

- [x] A-014 Pattern consistency: New code follows the package's existing idioms — structural narrowing (no `as` casts), discriminated result envelopes, sender-frame gating in main, electron-free pure modules
- [x] A-015 No unnecessary duplication: Existing utilities reused (`pingServer`, `normalizeOrigin`, `findServerByOrigin`, `switchToServer`, `addServer`); no second origin-normalization or switch path
- [x] A-016 Security: Every subprocess call is `execFile` with an argument slice and an explicit timeout; no shell strings; `daemon:*` handlers reject non-welcome senders; no auto-start path exists

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/desktop/src/welcome/welcome.ts` — the old hostname→`nameInput` pre-fill branch and the `addServer(els.nameInput.value, …)` read were correctly removed with R7; nothing residual remains.
- `app/desktop/src/welcome/welcome.html` `#name` / `#name-label` — **NOT** deletion candidates: rename mode reuses both elements (plan Assumption 7). Recorded here so a future reader does not mistake the `hidden` default for dead markup.
- None otherwise — this change adds new functionality (the local-daemon surface) without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `daemon:start` carries the whole start-and-connect flow main-side; the running-state Connect reuses it (flow skips the start step) | Intake pins exactly three channels and the dedupe + add-server seams are main-side; single seam shared with the menu mirrors `switchToServer` | S:70 R:80 A:85 D:70 |
| 2 | Confident | Linux candidate paths are `/home/linuxbrew/.linuxbrew/bin/rk` + `/usr/local/bin/rk` (darwin keeps the two intake-named paths) | Intake names darwin candidates only; linuxbrew's fixed prefix is the linux analogue of the GUI PATH trap, PATH fallback still covers the rest | S:55 R:90 A:80 D:70 |
| 3 | Confident | Health poll during start: 1s cadence, 30s cap; on timeout the card shows an inline error and re-probes | "Poll until it answers" needs a bound; 30s matches the daemon-command timeout tier | S:55 R:90 A:85 D:75 |
| 4 | Confident | Menu daemon status is cached main-side and refreshed on startup, window focus, after daemon actions, and by welcome polls (menu rebuilt only on change) | Application menus have no reliable open event; a perpetual main-side timer would poll forever for a rarely-open menu | S:50 R:85 A:75 D:60 |
| 5 | Confident | Version rendered from `rk --version` (`run-kit version vX.Y.Z`) with the leading `v` re-added by the UI (`v{X}`); unparseable output omits the version fragment gracefully | Matches the observed CLI output; graceful omission beats an error state for a cosmetic field | S:70 R:90 A:85 D:80 |
| 6 | Confident | Menu Restart/Stop are disabled in the stopped state; the Connect item always starts-if-needed | Restarting/stopping a stopped daemon is a no-op with confusing errors; Connect matching the card's one-intent rule | S:55 R:90 A:80 D:70 |
| 7 | Certain | The Display-name label+input stay in the HTML but `hidden` by default; rename mode unhides them | Rename explicitly keeps the input and reuses the same element — removal would break the rename affordance | S:85 R:85 A:90 D:90 |
| 8 | Confident | A `/api/sessions` failure while running degrades the detail line (origin only), never flips the state | Session count is decoration; the health ping is the authoritative liveness signal | S:60 R:90 A:85 D:80 |

8 assumptions (1 certain, 7 confident, 0 tentative).

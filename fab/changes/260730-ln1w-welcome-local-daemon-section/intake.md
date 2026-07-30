# Intake: Desktop Welcome "This Mac" Local-Daemon Section

**Change**: 260730-ln1w-welcome-local-daemon-section
**Created**: 2026-07-30

## Origin

Promptless dispatch (`/fab-proceed` create-intake subagent, `{questioning-mode} = promptless-defer`) from a synthesized design-conversation description. The conversation produced explicit decisions (numbered 1–9 below in What Changes), an approved HTML mock whose states are normative, and an explicit rejected-alternatives / out-of-scope list. No questions were asked; all decision points are graded in `## Assumptions`.

> Change: Desktop app welcome page — "This Mac" local-server section, local daemon control, and removal of the Display-name field. The desktop shell (app/desktop, Electron) welcome page (src/welcome/welcome.html + welcome.ts) currently offers only a remote-connect form (Server URL + Display name). Make the app self-sufficient on the local machine without turning it into a supervisor.

## Why

1. **Pain point**: the desktop shell's first-run experience assumes a remote `rk serve` URL. On the machine that actually runs run-kit (the common single-machine case), the user must know their local URL, ensure the daemon is running via a terminal, and type the URL by hand — the slowest possible path to the fastest possible target.
2. **Consequence if unfixed**: the local-first user gets a worse first-run than a remote user; the app cannot recover from a stopped local daemon without the user leaving the app entirely.
3. **Why this approach**: a detection-driven "This Mac" section with explicit button-driven daemon actions makes the app self-sufficient locally while preserving the viewer posture — the shell still never spawns the daemon on its own initiative (Constitution VI: tmux layer independent; the only lifecycle actions are explicit user-initiated buttons/menu items). Auto-start on app launch was rejected as lifecycle coupling; launchd autostart is a separate future change.

Additionally, the Display-name field on the connect form is dead weight — the ping already returns the hostname (today it only pre-fills the field), so the form can auto-derive the name and drop the input (explicit user decision: "we really don't need the DISPLAY NAME option on that form").

## What Changes

### 1. Welcome page: "This Mac" section (`src/welcome/welcome.html` + `welcome.ts`)

A new local-server section ABOVE the existing remote form, separated by an "or a remote server" divider (local connect is the fastest first-run path; the page shape stays stable in all states). Visual language matches the existing card: dark, monospace, `#34d399` accent, same input/button idiom. A reviewed HTML mock exists and was approved by the user; **its states are normative**:

| State | Dot | Status line | Detail line | Buttons |
|-------|-----|-------------|-------------|---------|
| **running** | green | `running · v{X}` | `{host}:{port} · N sessions` | **Connect** (accent) + **Stop** (ghost) |
| **stopped** (rk installed) | grey | `stopped` | `rk v{X} installed · runs \`rk daemon start\`` | single accent **Start & connect** |
| **starting…** (transient) | amber | `starting…` | `waiting for {host}:{port} to answer` | button disabled |
| **rk not installed** | — | section collapses to a hint | shows `brew install sahil87/tap/run-kit` | none |

"Start & connect" is deliberately ONE button, not separate start/connect — user intent behind starting is always to get in.

The welcome page polls daemon status every few seconds while visible (via the new `daemon:status` IPC; polling stops when the page navigates away). The page stays a vanilla-TS compiled plain browser script (no import/export) under the existing strict CSP (`default-src 'none'; script-src 'self'; style-src 'unsafe-inline'`); bridge access stays structural narrowing, no `as` casts (existing `getWelcomeBridge` pattern).

### 2. Detection derives, never assumes (Electron main process)

- The local server URL is resolved via `rk url` (config-derived — `cmd/rk/url.go` prints `http://{RK_HOST}:{RK_PORT}` with `127.0.0.1:3000` defaults); **never hardcode** the URL.
- The URL is then health-pinged with the SAME probe the remote form uses (the `pingServer` / `welcome:test-server` path: `net.fetch(origin + "/api/health")`, 5s timeout, `status === "ok"` + `hostname`).
- `rk` binary not found → not-installed state.
- **macOS GUI PATH trap**: GUI-launched Electron does not inherit the login-shell PATH (gets `/usr/bin:/bin:...`), so `rk` at `/opt/homebrew/bin` will not resolve via PATH — resolve the binary via fixed candidate paths (`/opt/homebrew/bin/rk`, `/usr/local/bin/rk`) with a plain PATH lookup as fallback.

### 3. Daemon flows

- **Start & connect** (stopped state): run `rk daemon start` (treat the `daemon already running` error as already-started success — `internal/daemon.Start()` errors on a live daemon) → poll the health endpoint until it answers (starting… state) → walk the EXISTING add-server path (persist entry to servers.json, set active, navigate) — this auto-registers the local server as a side effect. Start failure surfaces stderr in the card's existing inline-error idiom.
- **Connect** (running state): skip daemon start, same add-server path; if a local entry already exists in servers.json (matched by origin), activate it — **never create a duplicate** (note: `addServer` never dedupes today, so the connect flow must check `findServerByOrigin`-style before adding).
- **Stop**: runs `rk daemon stop`; the confirm/tooltip copy MUST say tmux sessions survive (Constitution VI — tmux layer independent of the server; stop is genuinely low-stakes).

### 4. New sender-gated IPC bridge (`src/main.ts` + `src/preload.ts`)

Three new channels — `daemon:status` / `daemon:start` / `daemon:stop` — following the existing `welcome:*` bridge and sender-gating pattern (main-side `senderFrame.url` gating, structural payload narrowing, discriminated `{ ok } | { ok: false, error }` envelopes). The menu is a second consumer of the same surface (main-side direct calls). All subprocess invocations use **execFile-style argument slices with timeouts, never shell strings** (Constitution Principle I applies to the Node side too; project review rule: every execFile call carries a timeout).

This deliberately amends the shell's recorded "no `child_process` anywhere in this package" invariant to: child_process **only** for explicit user-initiated `rk daemon` actions and read-only detection (`rk url`, `rk --version`, existence checks) — the app remains a passive viewer that never auto-starts the daemon.

### 5. Persistent home post-connect: "Local Daemon" app-menu submenu (`src/menu.ts` + `src/main.ts`)

The welcome page only shows pre-connect / on Add Server…; the persistent control surface is a **"Local Daemon" submenu** next to the server list in the Servers menu, showing status (`● running · v{X}`) with items **Connect / Restart / Stop**. Same IPC/daemon-control surface, two consumers. Menu items are accelerator-less (the keyboard-tier seam is untouched). Hidden/absent when rk is not installed. Restart maps to `rk daemon restart` (existing command).

### 6. Remove the "Display name" field from the connect form

The `name` input (+ label) is removed from the plain connect/add flow; the name auto-derives from the server ping's returned `hostname` (today the ping only pre-fills the field; `addServer` already falls back to the origin for an empty name). The `?mode=rename` variant of the same page **KEEPS its name input** — that page-reuse is the rename affordance (Electron has no native text-input dialog) and is unaffected.

### 7. Platform behavior (win/linux)

The desktop shell also ships on Windows/Linux; `rk daemon`/tmux is not a Windows concept. The section is detection-driven (no rk → hint state), and the brew hint copy is mac-appropriate. Platform-conditional behavior recorded as a design decision (Assumptions #14): the local section is suppressed entirely on `win32`; on `darwin`/`linux` the detection-driven section renders (Homebrew tap works on both), with the section heading platform-adjusted ("This Mac" on darwin, "This Machine" on linux).

### Rejected alternatives (from the design conversation)

- **Auto-starting the daemon on app launch** — rejected: violates the "shell never spawns the daemon" viewer posture; lifecycle coupling. Button-driven start (explicit user action) is the agreed middle ground. launchd login autostart is the "always up" answer and a SEPARATE future change.
- **Installer-side seeding of servers.json** (`rk desktop install` writing a local entry) — deferred as a separate change; the connect flow persisting the entry covers the main need.
- **Umbrella `rk update`** (CLI + desktop app legs) — explicitly a separate change, out of scope.

### Out of scope

Umbrella `rk update`, launchd autostart, proxy.go Content-Length correction (backlogged as idea [op63]), installer servers.json seeding.

## Affected Memory

- `run-kit/desktop-shell`: (modify) welcome flow gains the "This Mac" section + state table; Display-name field removal (rename variant unaffected); the new `daemon:*` sender-gated IPC channels and their two consumers; the "Local Daemon" menu submenu; the amended child_process posture (explicit user-initiated daemon actions only); rk binary resolution + the macOS GUI PATH trap.

## Impact

- `app/desktop/src/welcome/welcome.html` — "This Mac" section markup + divider; Display-name field removal.
- `app/desktop/src/welcome/welcome.ts` — local-section state machine, status polling, Start & connect / Connect / Stop wiring; connect flow no longer reads a name input (auto-derive from ping hostname).
- `app/desktop/src/main.ts` — `daemon:*` IPC handlers (sender-gated), rk invocation plumbing (execFile + timeouts), local-entry dedupe on connect, menu wiring.
- `app/desktop/src/preload.ts` — `__welcome`-style invokers for `daemon:*` (or an extension of the existing group).
- `app/desktop/src/menu.ts` — "Local Daemon" submenu (status line + Connect/Restart/Stop).
- New electron-free module (e.g. `app/desktop/src/local-daemon.ts`) for pure logic — rk binary candidate resolution, status-shape parsing/derivation — covered by a sibling `node --test` suite (three-dep pin preserved; `node:child_process` is stdlib).
- No backend/Go changes; no SPA (`app/frontend`) changes. `rk url`, `rk daemon start/stop/restart`, `rk --version`, and `/api/health` are consumed as-is.
- Playwright e2e does not cover the Electron shell; testing = node:test on the pure modules + existing compile/tsc gates (matches the package's established verification split).

## Open Questions

- None — the design conversation resolved the material decisions; remaining choices are graded below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | "This Mac" section above the remote form with "or a remote server" divider; four states (running/stopped/starting…/not-installed) with the exact copy, dot colors, and button set from the approved mock | Discussed — user approved the HTML mock; its states are normative | S:95 R:80 A:90 D:95 |
| 2 | Certain | Local URL derived via `rk url` (never hardcoded), health-checked with the same `pingServer` probe as the remote form; rk not found → not-installed state | Discussed — decision 2 verbatim; `cmd/rk/url.go` and `pingServer` exist as described | S:90 R:85 A:95 D:90 |
| 3 | Certain | Start & connect = `rk daemon start` → poll health until it answers → existing add-server path (persist, set active, navigate); start failure surfaces stderr in the card | Discussed — decision 3 verbatim | S:90 R:80 A:90 D:90 |
| 4 | Certain | Connect (running) skips start, same add-server path; an existing local entry (matched by origin) is activated, never duplicated | Discussed — decision 4 verbatim; `addServer` never dedupes so the flow must check first | S:90 R:80 A:90 D:90 |
| 5 | Certain | Stop runs `rk daemon stop`; confirm/tooltip copy states tmux sessions survive | Discussed — decision 5 verbatim (Constitution VI) | S:90 R:90 A:95 D:95 |
| 6 | Certain | Persistent post-connect home is a "Local Daemon" submenu next to the server list (status `● running · v{X}`, items Connect/Restart/Stop), not the welcome page; same IPC surface, two consumers | Discussed — decision 6 verbatim | S:90 R:75 A:85 D:90 |
| 7 | Certain | New sender-gated `daemon:status`/`daemon:start`/`daemon:stop` IPC following the `welcome:*` bridge + gating pattern; all subprocess calls are execFile-style argument slices, never shell strings | Discussed — decision 7 verbatim; Constitution I | S:95 R:85 A:95 D:95 |
| 8 | Confident | rk binary resolved via fixed candidates first (`/opt/homebrew/bin/rk`, `/usr/local/bin/rk`), bare PATH lookup as fallback | Decision 8 named both mechanisms without picking; candidates-first is simpler and deterministic, login-shell spawn adds cost for no coverage gain here | S:75 R:80 A:80 D:65 |
| 9 | Certain | Display-name field removed from the connect form; name auto-derives from the ping's hostname; `?mode=rename` keeps its name input unchanged | Discussed — decision 9 verbatim (user: "we really don't need the DISPLAY NAME option") | S:95 R:85 A:90 D:95 |
| 10 | Confident | `v{X}` in both running and stopped states sources from `rk --version` (local CLI) | No server-version field exists on `/api/health` and adding an endpoint is out of scope; local daemon binary and local CLI are the same install | S:60 R:85 A:80 D:70 |
| 11 | Confident | `N sessions` detail sources from `GET {localUrl}/api/sessions` (existing endpoint), fetched main-side alongside the health ping | Only existing surface carrying session count; main-process fetch mirrors the health-ping pattern (renderer stays sandboxed) | S:55 R:85 A:80 D:70 |
| 12 | Confident | Status poll cadence 3s, running only while the welcome page is visible (interval torn down on navigation) | "Every few seconds" per description; the SPA no-polling anti-pattern doesn't apply — no SSE exists for a down server | S:65 R:90 A:85 D:65 |
| 13 | Confident | `rk daemon start`'s `daemon already running` error is treated as already-started success (flow proceeds to health-poll) | `internal/daemon.Start()` errors when running, but the user intent (get in) is satisfied — the description calls start idempotent, this realizes that contract at the shell seam | S:60 R:85 A:85 D:80 |
| 14 | Confident | Platform conditioning: local section suppressed on `win32`; rendered detection-driven on `darwin`/`linux` (brew hint valid on both via Homebrew); heading "This Mac" (darwin) / "This Machine" (linux) | Description flags platform-conditional hint copy as a design decision to record; rk daemon/tmux is not a Windows concept so a brew hint there would mislead | S:50 R:90 A:60 D:45 |
| 15 | Confident | Stop confirmation is a native `dialog.showMessageBox` confirm (the Remove-server precedent), shared by the card button and the menu item, with the tmux-survives copy | Description says "confirm/tooltip"; a native confirm matches the existing Remove pattern and carries the required copy reliably | S:65 R:90 A:80 D:65 |
| 16 | Confident | Menu Restart item maps to `rk daemon restart` (existing command) | Direct command exists (`cmd/rk/daemon_restart.go`); composing stop+start in the shell would duplicate CLI logic | S:60 R:85 A:85 D:80 |
| 17 | Certain | Welcome page stays a vanilla-TS no-import/export browser script under the existing CSP; bridge read via structural narrowing, no `as` casts | Stated constraint; existing welcome.ts pattern + code-quality rule | S:95 R:85 A:95 D:95 |
| 18 | Certain | Pure logic (binary candidate resolution, status derivation) lands in an electron-free module with a sibling node:test suite; three-dep pin preserved (`node:child_process` is stdlib) | Package precedent (`servers.ts`, `window-open.ts`); code-quality requires tests for new behavior | S:75 R:85 A:90 D:85 |
| 19 | Certain | Every rk subprocess invocation carries a timeout (short for `rk url`/`--version`/status probes; longer for daemon start/stop) | Project review rule: all execFile calls must include a timeout; mirrors backend Process Execution constraint | S:80 R:85 A:95 D:90 |
| 20 | Certain | No auto-start anywhere: the only daemon lifecycle actions are explicit user-initiated buttons/menu items; the amended child_process posture is recorded in memory at hydrate | Discussed — rejected-alternative + constraint verbatim (viewer posture preserved) | S:95 R:80 A:90 D:95 |

20 assumptions (12 certain, 8 confident, 0 tentative, 0 unresolved).

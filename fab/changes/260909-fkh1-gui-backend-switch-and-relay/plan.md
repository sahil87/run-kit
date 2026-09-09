# Plan: GUI Backend — the Switch, the Supervisor, the Relay (plan C2)

**Change**: 260909-fkh1-gui-backend-switch-and-relay
**Intake**: `intake.md`

> Read `intake.md` in full first — it is the state-transfer document and carries the exact
> values (argv, payload shapes, close codes, copy) this plan's requirements name. Mirror
> templates: `app/backend/internal/daemon/codeserver.go` (sibling-session ensure ladder + kill
> primitive), `app/backend/api/terminals_ws.go` + `state_ws.go` (relay discipline),
> `app/backend/api/sse.go` `codeServerTick`/`event: code-server` (TTL probe + cached replay),
> `app/backend/internal/settings/settings.go` `auto_name` entry (bool registry row),
> `app/backend/api/settings.go` `handlePostSettings` (live re-apply seam),
> `app/backend/cmd/rk/code_server.go` + `doctor.go` `codeServerCheck`,
> `app/backend/internal/codebridge/state.go` `StateDir`. All paths below are under
> `app/backend/` unless they start with `fab/` or `docs/`.

## Requirements

### Settings: the `gui.enabled` switch

#### R1: Registry key `gui.enabled`
`internal/settings` MUST expose one new registry entry `gui.enabled` — `kind: "bool"`,
`def: "false"`, `category: "behavior"`, `ui: true`, `live: true`, description
"Turns the GUI surface on: runs the host desktop (rk-gui session) and shows the 4th tile toggle.
Off by default; nothing flips it but you." — backed by a `GUIEnabled bool` field on `Settings`,
placed after `cron_ticker` in the scalar block. The serialized form MUST be the flat dotted line
`gui.enabled: true`, omitted when false, with the tolerant `strconv.ParseBool` read and the
`boolValue` apply hook. There MUST be no env form.

- **GIVEN** an empty config dir
- **WHEN** `settings.Load()` runs
- **THEN** `GUIEnabled` is false and `GET /api/settings` lists a 14th row `gui.enabled` with `value: false`
- **AND** `POST /api/settings {"gui.enabled": true}` followed by `Load()` yields true and the file contains exactly one `gui.enabled: true` line; posting `false` removes the line and the file round-trips byte-identically to its pre-toggle content

#### R2: Never on by default
No code path other than an explicit user write (`rk gui on`, `POST /api/settings`) SHALL set
`GUIEnabled` true. `Default()` MUST leave it false; the daemon boot hook, `rk doctor`, backend
probes, and installs MUST never write it.

- **GIVEN** a host with `Xtigervnc` on PATH and a fresh config dir
- **WHEN** the daemon starts (`startSession`) and `rk doctor` runs
- **THEN** `GUIEnabled` remains false, no `rk-gui` tmux command is issued (zero captured spawn argv), and the doctor row reads `gui: off`

### Daemon: the `rk-gui` sibling session

#### R3: Ensure ladder and gated boot hook
`internal/daemon/gui.go` MUST provide `ensureGUICore(cli bool) (GUIEnsureOutcome, error)` with the
fixed skip order: (1) `!settings.Load().GUIEnabled` ⇒ `GUIEnsureDisabled`; (2) session `rk-gui`
exists ⇒ `GUIEnsureAlreadyRunning`; (3) Linux with neither `Xtigervnc` nor `Xvnc` on PATH ⇒
`GUIEnsureNoBackend` (daemon: warn + continue; CLI: nil error, the outcome carries the install
hint); (4) state dir not creatable or socket path > 100 bytes ⇒ `GUIEnsureStateDirFailed`;
(5) spawn `tmux new-session -d -s rk-gui -n host <rk-exe> gui supervise host --display :N` on
the `rk-daemon` socket via `runTmux`, where `:N` is the lowest free display ≥ `:10` ⇒
`GUIEnsureStarted`. `ensureGUI()` (daemon posture) MUST run from `startSession` right after
`ensureCodeServer()`. `EnsureGUI()` (CLI/API posture) MUST refuse with an operational error
naming `rk serve -d` when `jobDaemonRunning` is false. Every tmux call goes through the file's
own package seams (`guiSessionExists`, `guiSpawn`, `guiKillRun`, `guiSelfPath`,
`guiLookPath`) so tests never touch a live server.

- **GIVEN** `GUIEnabled=true`, no `rk-gui` session, `Xtigervnc` resolvable, display `:10` free
- **WHEN** `startSession` runs
- **THEN** exactly one spawn argv is captured: `new-session -d -s rk-gui -n host <exe> gui supervise host --display :10`
- **AND** with the session already present the spawn seam is not called; with `GUIEnabled=false` neither the exists probe nor the spawn seam is called

#### R4: Kill primitive with socket-release wait
`KillGUISession() (killed bool, err error)` MUST kill `=rk-gui` exact-match (audit-logged like
`KillCodeServerSession`), treat an absent session as success (`false, nil`), and after a real
kill wait — bounded by `guiSocketFreeTimeout = 5s`, polled at 200 ms, both package vars — until
`host.sock` no longer exists. `RestartGUI() error` MUST be `KillGUISession` then
`ensureGUICore(true)`, refusing when disabled.

- **GIVEN** a live `rk-gui` session whose supervisor removes the socket on SIGHUP
- **WHEN** `KillGUISession()` runs
- **THEN** the captured argv is `kill-session -t =rk-gui`, the function returns only after the socket path is gone (or the 5 s budget expires), and `RestartGUI()` composed immediately after sees no stale socket

#### R5: `rk gui supervise host --display :N` (Linux)
The pane command MUST, in order: validate `id == host` and the `--display` form (`:` + digits);
`MkdirAll(StateDir, 0700)` and remove a stale `host.sock`; exec the backend with
`exec.CommandContext` argv `[<bin>, :N, -rfbunixpath, <StateDir>/host.sock, -rfbport, -1,
-SecurityTypes, None, -AlwaysShared, -AcceptSetDesktopSize, -geometry, 1920x1080, -FrameRate=60,
-desktop, run-kit]` where `<bin>` resolves `Xtigervnc` first and `Xvnc` only when `Xtigervnc`
is absent, stdout/stderr inherited; wait ≤ 5 s for the socket, `chmod 0600` it, log
`gui: <bin> up on :N (socket <path>)`; stamp `@rk_gui_display :N` and `@rk_gui_backend <bin>`
on the `rk-gui` session (`tmux -L rk-daemon set-option -t =rk-gui …`); launch the first WM
found in `openbox → xfwm4 → i3 → kwin_x11 → x-session-manager` with `DISPLAY=:N` in its env,
wrapping `x-session-manager` as `dbus-run-session -- x-session-manager`, and log
`gui: no window manager found (tried …); running bare — apt install openbox` when none
resolves; trap SIGTERM/SIGINT/SIGHUP to kill WM then backend, remove the socket, exit 0.

- **GIVEN** a stubbed lookPath where only `Xvnc` (not `Xtigervnc`) and `kwin_x11` exist
- **WHEN** the argv builders run for display `:11`
- **THEN** the backend argv starts `Xvnc :11 -rfbunixpath …/host.sock -rfbport -1 …` and the WM argv is `kwin_x11` with `DISPLAY=:11`
- **AND** with `x-session-manager` as the only WM the argv is `dbus-run-session -- x-session-manager`

#### R6: Backend-exit semantics — stay idle, manual restart
When the backend process exits on its own, the supervisor MUST log
`gui: <bin> exited (status N) — display :N is down; run 'rk gui restart' or turn the GUI off`,
kill the WM, remove the socket, and then block until a signal arrives (no auto-respawn, no
process exit) so the pane remains readable and the session still exists.

- **GIVEN** a running supervisor
- **WHEN** the backend is killed externally
- **THEN** the pane shows the exit line, `host.sock` is gone, the `rk-gui` session still exists, the stream reports `reachable:false`, and `rk gui status` reads `on — not running (<bin> exited …)` until `rk gui restart`

#### R7: macOS supervisor is a probe-logging sleeper
On `GOOS=darwin`, `supervise` MUST spawn nothing, stamp `@rk_gui_backend screen-sharing`, log the
Screen Sharing dial result (`127.0.0.1:5900`) once a minute (`Screen Sharing: reachable on
127.0.0.1:5900` / `not reachable — enable System Settings › General › Sharing › Screen Sharing`),
and exit 0 on signal. Backend detection MUST report `screen-sharing` and never `NoBackend`.

- **GIVEN** `GOOS=darwin`
- **WHEN** the ensure ladder runs with `GUIEnabled=true` and no session
- **THEN** it spawns the supervise session without probing PATH for `Xtigervnc`, and `gui.Backend()` returns `screen-sharing`

### Package: `internal/gui`

#### R8: Pure backend helpers
A new `internal/gui` package (no tmux, no `internal/daemon` import) MUST provide: `StateDir()`
(`$XDG_STATE_HOME/run-kit/gui`, else `~/.local/state/run-kit/gui` — the `codebridge.StateDir`
rule), `SocketPath(id)`, `ValidateSocketPath(path) error` (> 100 bytes ⇒ error),
`FreeDisplay(start int) (int, error)` (probes `/tmp/.X{N}-lock` and `/tmp/.X11-unix/X{N}`,
`:10`–`:99`), `ResolveBackend(lookPath) (name, path string)`, `BackendArgv(bin, display,
socket)`, `ResolveWM(lookPath) (argv []string, ok bool)`, `Probe(ctx, network, addr) (Info,
error)`, `RunningApps(display string) ([]App, error)` (Linux: `/proc/[0-9]*/environ` scan for
`DISPLAY=:N`, excluding a caller-supplied pid set, grouped by `comm` into `{Name, Count}`; other
OSes: empty), `Status` (the shared JSON document — `id, enabled, backend, reachable, display,
width, height, viewers, socket, session, reason, apps[], uptime_seconds`), and `InstallHint()`
per OS.

- **GIVEN** a temp dir standing in for `/tmp` with `.X10-lock` present and `.X11-unix/X11` present
- **WHEN** `FreeDisplay(10)` runs against it
- **THEN** it returns 12
- **AND** a fixture `/proc` tree with three processes carrying `DISPLAY=:10` (`chromium`×2, `xterm`×1) and one carrying `DISPLAY=:11` yields `[{chromium 2} {xterm 1}]` for `:10`

#### R9: RFB probe
`gui.Probe` MUST dial (500 ms timeout), read the 12-byte `RFB 003.008\n` banner, and, for
`network == "unix"` (Linux), reply `RFB 003.008\n`, select security type 1 (None) from the
server's list, read the 4-byte SecurityResult, send `ClientInit shared=1`, read `ServerInit`
(u16 width, u16 height, 16-byte pixel format, u32 name length, name), then close — returning
`Info{Reachable:true, Width, Height}`. For `network == "tcp"` (macOS) it MUST stop after the
banner (auth needs the Keychain password) and return `Reachable:true` with zero geometry. Dial
failure or a malformed banner MUST return `Reachable:false` with a classified `Reason`
(`not running` / `dial failed: …` / `bad banner`).

- **GIVEN** an in-process fake RFB server on a unix socket that serves `RFB 003.008\n`, security list `[1]`, result 0, and a ServerInit of 1920×1080 named `run-kit`
- **WHEN** `Probe` runs
- **THEN** it returns `Reachable:true Width:1920 Height:1080` and the fake server observes exactly one accepted connection closed after ServerInit
- **AND** with nothing listening it returns `Reachable:false` and a `Reason` within the 500 ms budget

### CLI: `rk gui`

#### R10: `rk gui on`
`rk gui on` MUST load settings, set `GUIEnabled=true`, `Save`, then: daemon running ⇒
`daemon.EnsureGUI()` and print `started (<bin> :N)` / `already running` /
`enabled — no VNC backend installed: <hint>`; daemon down ⇒ print
`enabled — the daemon starts the GUI on 'rk serve -d'`. Exit 0 in every enabled case; 1 only
on a save or spawn error. Idempotent.

- **GIVEN** the daemon is down and `GUIEnabled=false`
- **WHEN** `rk gui on` runs
- **THEN** the setting is persisted true, no tmux command is issued, the daemon-down line prints, exit 0

#### R11: `rk gui off [--yes]` with the apps confirm
`rk gui off` MUST compute the running-apps list for the stamped display and, when apps exist
and `--yes` is absent, print exactly
```
Turning the GUI off kills the rk-gui session and every app on display :N:
  <name> ×<count>, …  (up <duration>)
Continue? [y/N]
```
and read one line from the terminal; a non-tty stdin MUST refuse with exit 1 and
`re-run with --yes`. On confirmation (or `--yes`, or no apps, or macOS) it MUST
`KillGUISession()`, set `GUIEnabled=false`, `Save`, print `gui off — rk-gui session killed`
(or `gui off` when nothing was running). Aborting prints `aborted` and exits 1 with the
setting untouched.

- **GIVEN** apps `chromium ×3` on `:10` and stdin is not a tty
- **WHEN** `rk gui off` runs without `--yes`
- **THEN** exit 1, `GUIEnabled` stays true, no kill argv is captured
- **AND** with `--yes` the kill argv is captured and `GUIEnabled` becomes false

#### R12: `rk gui status [--json]`
`rk gui status` MUST print `gui: off` / `gui: on (<bin>, :N, WxH, k viewers)` /
`gui: on — not running (<reason>)`, plus an indented apps line when running; `--json` MUST
emit the `gui.Status` document. Exit 0 always. Reasons are the doctor row's (R23).

- **GIVEN** enabled, session present, socket absent, `@rk_gui_backend Xtigervnc`
- **WHEN** `rk gui status` runs
- **THEN** it prints `gui: on — not running (Xtigervnc exited — see the rk-gui pane; 'rk gui restart')`

#### R13: `rk gui env`
`rk gui env` MUST print `export DISPLAY=:N` and `export RK_GUI_SOCKET=<path>` when enabled and
reachable; otherwise exit 1 with `gui is off — turn it on with 'rk gui on'` or
`gui is on but not running — see 'rk gui status'`.

- **GIVEN** `@rk_gui_display :10` stamped and the socket answering
- **WHEN** `eval "$(rk gui env)"` runs in a shell
- **THEN** `$DISPLAY` is `:10` and `$RK_GUI_SOCKET` is the socket path

#### R14: `rk gui restart`
`rk gui restart` MUST call `daemon.RestartGUI()`; disabled ⇒ exit 1 `gui is off — turn it on
with 'rk gui on'`; daemon down ⇒ exit 1 naming `rk serve -d`; success prints
`restarted (<bin> :N)`.

- **GIVEN** enabled and a dead-backend session
- **WHEN** `rk gui restart` runs
- **THEN** kill then spawn argv are captured in that order and the command exits 0

#### R15: Help text and toolkit standards
The `gui` cobra family MUST carry Use/Short/Long in the `code-server` family's shape with a
Subcommands list; `supervise` MUST be `Hidden: true`. The help-dump tests and the
`shll standards` help-dump / P9 checks MUST pass over the new family (run `shll standards`
if available; a missing `shll` is a note, not a failure).

- **GIVEN** the built `rk`
- **WHEN** `rk gui --help` and `rk help-dump` run
- **THEN** `on`, `off`, `status`, `env`, `restart` are listed, `supervise` is not, and `go test ./cmd/rk/` help-dump tests pass

### Relay: `GET /ws/gui/{id}`

#### R16: Upgrade, gate, dial, pipe
`api/gui_ws.go` MUST upgrade with the shared `upgrader`, then: invalid id ⇒ close **4400**
`invalid gui id`; `!settings.Load().GUIEnabled` ⇒ close **4403** `gui disabled`; dial failure
(Linux `unix` `<StateDir>/host.sock`, macOS `tcp` `127.0.0.1:5900`, 2 s timeout) ⇒ close
**4404** `gui not running: <reason>`. On success it MUST pipe binary frames both ways (WS
binary message → backend write; backend read up to 64 KiB → `BinaryMessage` with a 10 s write
deadline), ignore text frames, and set a 1 MiB `SetReadLimit`. The relay MUST increment the
hub's viewer count for the id on a successful dial and decrement on teardown.

- **GIVEN** a fake backend on a temp unix socket that echoes bytes
- **WHEN** a WS client connects to `/ws/gui/host` with `GUIEnabled=true` and sends `RFB 003.008\n` as a binary frame
- **THEN** it receives the same bytes back as a binary frame and the hub's `viewers` for `host` reads 1 while connected
- **AND** with `GUIEnabled=false` the client observes close code 4403; with no listener, 4404; with id `nope`, 4400

#### R17: Teardown closes both sides
The relay MUST root its lifecycle context in `context.Background()` (not `r.Context()`), and a
read error on either side MUST cancel the context and close both connections.

- **GIVEN** a relayed session
- **WHEN** the WS client closes
- **THEN** the fake backend's accepted conn reads EOF within 1 s (no orphaned socket), the viewer count returns to 0
- **AND** when the backend closes first the WS client receives a close frame within 1 s

#### R18: macOS server-side view-only filter
When the backend network is `tcp` (screen-sharing), the relay MUST track the RFB handshake on
the client→server direction — ProtocolVersion (12 bytes), the client's 1-byte security choice,
the ARD/DH or None exchange until the server's 4-byte SecurityResult has passed
server→client, the 1-byte ClientInit, then the server's ServerInit — and afterwards drop
client→server messages of type 4 (KeyEvent, 8 bytes) and 5 (PointerEvent, 6 bytes), forwarding
every other message type intact (0: 20 bytes; 2: 4 + 4·n; 3: 10; 6: 8 + length; unknown types:
forwarded raw). On the `unix` backend the filter MUST be inert.

- **GIVEN** a synthetic post-handshake client stream containing a FramebufferUpdateRequest, a KeyEvent, a PointerEvent, and a ClientCutText
- **WHEN** it passes through the filter in `screen-sharing` mode
- **THEN** the backend receives only the FramebufferUpdateRequest and ClientCutText bytes, in order
- **AND** in `unix` mode the backend receives all four unchanged

### State stream: `event: gui`

#### R19: Host-global `event: gui` with TTL-cached probe
`api/sse.go` MUST add hub state (`guiEnabled`, `guiProbeAt`, `guiInfo`, `guiViewers
map[string]int`, `cachedGuiJSON`) and a `guiTick()` invoked every poll tick beside
`codeServerTick`: re-read `settings.Load().GUIEnabled`; when enabled and the probe is older
than `guiProbeTTL = 5 s`, read `@rk_gui_display`/`@rk_gui_backend` from the `rk-gui` session
via an injectable seam (absent session ⇒ `reachable:false`, reason `session absent`) and run
`gui.Probe` — **skipping the dial when `guiViewers[id] > 0`** (reachable follows from the live
relay; last geometry retained). It MUST broadcast
`[{"id":"host","enabled":…,"backend":…,"reachable":…,"display":…,"width":…,"height":…,"viewers":…}]`
as `hubEvent{kind: kindGlobal, typ: "gui"}` every tick and replay `cachedGuiJSON` to late
joiners in the same block as `code-server`. Disabled payload:
`[{"id":"host","enabled":false,"backend":"","reachable":false,"display":"","width":0,"height":0,"viewers":0}]`.

- **GIVEN** a stubbed prober and stubbed session-option reader
- **WHEN** the hub ticks 20 times in 2 s
- **THEN** the prober is invoked once; after the stub flips to unreachable, the payload flips within one tick after 5 s; a client attaching later receives the cached `gui` event before any tick
- **AND** with `guiViewers["host"]=1` the prober is not invoked while ticks continue and `reachable` stays true

#### R20: Synchronous `enabled` flip
The hub MUST expose `setGUIEnabled(bool)` which sets `guiEnabled`, zeroes `guiProbeAt`,
re-renders, and broadcasts immediately; `handlePostSettings` MUST call it when the patch
carries `gui.enabled`.

- **GIVEN** a connected state-socket client
- **WHEN** `POST /api/settings {"gui.enabled": true}` returns
- **THEN** the client has already received a `gui` event with `enabled:true` (no wait for the next tick)

### HTTP: `/api/gui/*` and the settings side effect

#### R21: Settings POST side effect
`handlePostSettings` MUST, after `Save`, when the patch carries `gui.enabled`: true ⇒ call an
injectable `ensureGUI` seam (production `daemon.EnsureGUI`) best-effort (log a warning on
error, response still 200); false ⇒ call the `killGUI` seam (production
`daemon.KillGUISession`); then `s.sseHub.setGUIEnabled(v)`.

- **GIVEN** stubbed ensure/kill seams
- **WHEN** `gui.enabled` is posted true then false
- **THEN** ensure is called once, then kill once, both responses are 200, and posting unrelated keys calls neither

#### R22: `GET /api/gui/{id}` and `POST /api/gui/{id}/restart`
`GET /api/gui/{id}` MUST return the `gui.Status` document (200), 400 on an invalid id.
`POST /api/gui/{id}/restart` MUST return 409 `{"error":"gui disabled"}` when off, 400 on an
invalid id, 200 `{"status":"ok"}` after `RestartGUI()`, 500 with the error text on failure. No
other `/api/gui` routes exist; both are registered in `router.go` beside `/api/settings`.

- **GIVEN** `GUIEnabled=false`
- **WHEN** `POST /api/gui/host/restart`
- **THEN** 409 with `{"error":"gui disabled"}` and the restart seam is not called
- **AND** `GET /api/gui/host` returns `enabled:false`, `apps:[]`; `GET /api/gui/nope` returns 400

### Doctor and validation

#### R23: Doctor row `gui`
`cmd/rk/doctor.go` MUST append `guiCheck(...)` after the code-bridge row, always `OK: true`,
pure over injected (enabled, session-exists, stamped backend/display, probe, lookPath) inputs,
with Notes: `off`; `on (<bin>, :N, WxH, k viewers)`; `on — not running (rk-gui session absent;
the daemon starts it on 'rk daemon start')`; `on — not running (no VNC backend: sudo apt
install tigervnc-standalone-server openbox)`; `on — not running (<bin> exited — see the rk-gui
pane; 'rk gui restart')`; `on — not running (Screen Sharing is off: System Settings › General ›
Sharing › Screen Sharing)`.

- **GIVEN** each of the six input combinations
- **WHEN** `guiCheck` runs
- **THEN** the Note matches the corresponding string exactly and `OK` is true in all six

#### R24: `validate.ValidateGUIID`
`internal/validate` MUST add `ValidateGUIID(id string) string` returning `""` for exactly
`"host"` and `gui id must be "host"` otherwise; the relay, both `/api/gui` routes, and
`rk gui supervise` MUST use it.

- **GIVEN** ids `host`, `Host`, `host2`, ``
- **WHEN** validated
- **THEN** only `host` passes

### Docs

#### R25: Plan tracking row
`fab/plans/sahil/26-09-09-gui-surface.md` row C2 MUST carry the change folder (already
filled) and, once the PR exists, the PR URL; status `Done` is set on merge. The PR URL is
filled by the orchestrator after ship (a follow-up commit on the PR branch), not by apply.

- **GIVEN** the merged PR
- **WHEN** the plan is read
- **THEN** row C2 names `260909-fkh1-gui-backend-switch-and-relay` and the PR URL

### Non-Goals

- The frontend tile, registry row, palette entries, settings-dialog confirm, ⌘4 (C3).
- `rk gui exec` / `rk gui shot`, `DISPLAY` export in `rk agent setup`, `rk skill gui` (C4).
- Perf measurement (C5), KasmVNC backend (C6), audio, multi-monitor, per-session displays,
  Wayland, macOS "take control", the macOS virtual-display backend (D10).
- SetDesktopSize / resize policy — client-side noVNC behavior (C3, D7).
- Editing `docs/specs/gui.md` (human-curated; its C2 row already describes this scope).

### Design Decisions

#### Tmux half in `internal/daemon`, pure half in `internal/gui`
**Decision**: session ensure/kill/restart live in `internal/daemon/gui.go` beside
`codeserver.go`; everything that does not touch tmux (paths, argv, probe, apps scan, status
document) lives in the new `internal/gui`.
**Why**: the daemon boot hook must call ensure, so `daemon → gui` is the only cycle-free import
direction; the daemon package already owns `runTmux`, `sessionExistsCtx`, `jobDaemonRunning`.
**Rejected**: a self-contained `internal/gui` with its own tmux runner — duplicates the seams
and re-creates the dead-socket-births-a-server hazard the daemon gates prevent.
*Introduced by*: 260909-fkh1-gui-backend-switch-and-relay

#### Supervisor stays idle after a backend exit
**Decision**: on backend exit the supervisor cleans up and blocks until signalled; recovery is
`rk gui restart` / `POST /api/gui/host/restart`.
**Why**: the pane is the supervisor log (D8/R3) and must show the exit; a live session with a
dead backend maps cleanly onto "enabled but unreachable"; no supervisor loop (Constitution VI
spirit). Confirmed with the user at intake.
**Rejected**: auto-respawn with backoff (masks a broken install with restart spam); exit the
pane (loses the log; session-absent conflates "never started" with "crashed").
*Introduced by*: 260909-fkh1-gui-backend-switch-and-relay

#### Hub re-reads the settings file per tick; POST flips synchronously
**Decision**: `guiTick` calls `settings.Load()` every tick and `setGUIEnabled` is the POST-side
synchronous seam.
**Why**: `rk gui on` writes the file directly (the code-server CLI precedent), so the hub cannot
learn about it any other way; the POST path still needs the one-state-event flip C3 relies on.
**Rejected**: routing the CLI through the HTTP API (fails when the daemon is down, which is
exactly when a user first runs `rk gui on`).
*Introduced by*: 260909-fkh1-gui-backend-switch-and-relay

#### Probe skips the dial while a relay viewer is live
**Decision**: `guiTick` treats `guiViewers[id] > 0` as `reachable:true` and does not dial.
**Why**: every dial writes accept/close lines into Xvnc's log — the supervisor pane — every 5 s;
a live relay is stronger evidence than a probe anyway.
**Rejected**: lowering Xvnc's log level (hides real connection events too).
*Introduced by*: 260909-fkh1-gui-backend-switch-and-relay

#### `Xtigervnc` by name, `Xvnc` fallback, `-rfbport -1` always
**Decision**: backend resolution prefers the `Xtigervnc` binary name; `Xvnc` is used only when
absent; `-rfbport -1` is part of the fixed argv.
**Why**: C0 findings 1–2 — the KasmVNC deb hijacks `Xvnc` via `update-alternatives`, and
TigerVNC binds TCP 5900+N unless told not to, which would falsify "VNC never on TCP".
**Rejected**: `Xvnc` alone (the D5 wording) — proven ambiguous on a host with Kasm installed.
*Introduced by*: 260909-fkh1-gui-backend-switch-and-relay

## Tasks

### Phase 1: Setup

- [x] T001 [P] Add `ValidateGUIID` to `internal/validate/validate.go` (+ table test in `validate_test.go`): exactly `host` passes <!-- R24 -->
- [x] T002 [P] Add the `gui.enabled` registry entry and `GUIEnabled` field to `internal/settings/settings.go` after `cron_ticker`; tests in `settings_test.go` for default false, parse/serialize round-trip, byte-stable removal, and the registry inventory count 13 → 14 (fix any existing count assertion in `registry_test.go`) <!-- R1 -->
- [x] T003 [P] Create `internal/gui/state.go`: `StateDir()`, `SocketPath(id)`, `ValidateSocketPath` (> 100 bytes ⇒ error), `InstallHint()` per OS; tests in `state_test.go` (XDG override, home fallback, length guard) <!-- R8 -->
- [x] T004 [P] Create `internal/gui/status.go`: the `Status`, `App`, and `Info` structs with JSON tags (`id, enabled, backend, reachable, display, width, height, viewers, socket, session, reason, apps, uptime_seconds`) and the stream payload struct `StreamEntry` (`id, enabled, backend, reachable, display, width, height, viewers`) <!-- R8 -->

### Phase 2: Core Implementation

- [x] T005 Create `internal/gui/display.go`: `FreeDisplay(start int) (int, error)` over an injectable lock-dir root (probes `.X{N}-lock` and `.X11-unix/X{N}`, `:10`–`:99`), `ParseDisplay(":N")`; tests with a temp root <!-- R8 -->
- [x] T006 Create `internal/gui/backend.go`: `ResolveBackend(lookPath)` (`Xtigervnc` → `Xvnc` → none; darwin ⇒ `screen-sharing`), `BackendArgv(bin, display, socket)` producing the exact R5 argv, `ResolveWM(lookPath)` over the fixed ladder with the `dbus-run-session --` wrap for `x-session-manager`; tests assert `-rfbport -1`, `Xtigervnc`-first, `Xvnc` fallback, ladder order, wrap <!-- R5 -->
- [x] T007 Create `internal/gui/probe.go`: `Probe(ctx, network, addr) (Info, error)` — banner read, and for `unix` the None handshake through ServerInit (width/height), for `tcp` banner-only; 500 ms dial timeout; classified `Reason`; tests in `probe_test.go` with an in-process fake RFB server on a temp unix socket (1920×1080 ServerInit, single accept-then-close) and the not-listening case <!-- R9 -->
- [x] T008 Create `internal/gui/apps_linux.go` (+ `apps_other.go` build-tagged stub): `RunningApps(procRoot, display string, exclude map[int]bool) ([]App, error)` scanning `/proc/[0-9]*/environ` for `DISPLAY=:N`, grouped by `comm`, sorted by count desc then name; fixture-tree test <!-- R8 -->
- [x] T009 Create `internal/daemon/gui.go`: constants `GUISessionName="rk-gui"`, `GUIWindowName="host"`; seams `guiSessionExists`, `guiSpawn`, `guiKillRun`, `guiSelfPath`, `guiLookPath`, `guiFreeDisplay`, `guiSocketExists`; `GUIEnsureOutcome` enum; `ensureGUICore(cli bool)` with the fixed skip order; `ensureGUI()`; `EnsureGUI()` gated on `jobDaemonRunning`; `guiSocketFreeTimeout`/`guiSocketFreePoll` vars; `KillGUISession()` with the socket-release wait; `RestartGUI()`; `GUISessionOptions()` reading `@rk_gui_display`/`@rk_gui_backend` via a seam; `GUISessionCreated()` for uptime <!-- R3 -->
- [x] T010 Tests in `internal/daemon/gui_test.go`: disabled ⇒ zero seam calls; enabled + no session ⇒ exact spawn argv (`new-session -d -s rk-gui -n host <exe> gui supervise host --display :10`); session exists ⇒ skip; no backend ⇒ `GUIEnsureNoBackend` with no spawn; kill argv `kill-session -t =rk-gui` + socket-release wait honoured with shrunken timers; absent session kill ⇒ `(false, nil)`; `EnsureGUI` refuses when daemon down; `RestartGUI` order kill→spawn and refusal when disabled <!-- R4 -->
- [x] T011 Wire the boot hook: call `ensureGUI()` right after `ensureCodeServer()` in `internal/daemon/daemon.go` `startSession`; extend the existing startSession test to assert no gui spawn when disabled <!-- R3 -->
- [x] T012 Create `cmd/rk/gui_supervise.go`: the hidden `supervise <id> --display :N` command — Linux path per R5 (mkdir 0700, stale-socket removal, backend exec with inherited stdio, ≤ 5 s socket wait + chmod 0600, option stamps via `tmux -L rk-daemon set-option -t =rk-gui`, WM launch with `DISPLAY`, signal trap, the R6 idle-after-exit wait with the exact log line); darwin path per R7 (probe-logging sleeper); unit tests for the log-line formatting and the darwin/linux dispatch via seams <!-- R5 -->
- [x] T013 Create `api/gui_ws.go`: `handleGuiWS` — validate (4400), enabled gate (4403), dial via injectable `guiDial` seam (4404), bidirectional binary pipe with the 64 KiB read chunk, 10 s write deadline, 1 MiB read limit, Background-rooted context, both-sides teardown, hub viewer inc/dec; `guiBackendAddr()` returning (`unix`, socket) on Linux and (`tcp`, `127.0.0.1:5900`) on darwin <!-- R16 -->
- [x] T014 Create `api/gui_filter.go`: the RFB client→server handshake tracker + view-only filter (drop types 4/5 after ServerInit; inert for `unix`); table test in `gui_filter_test.go` with a synthetic None handshake and an ARD-shaped (type 30) handshake followed by the four-message stream <!-- R18 -->
- [x] T015 Tests in `api/gui_ws_test.go` over `httptest` + a fake echoing unix-socket backend: echo round-trip, close codes 4400/4403/4404, client-close ⇒ backend EOF within 1 s, backend-close ⇒ client close frame within 1 s, viewer count 1 → 0 <!-- R17 -->
- [x] T016 Extend `api/sse.go`: hub fields, `guiProbeTTL = 5s`, `guiTick()` (settings re-read, session-option seam, viewer-skip, `gui.Probe` seam), per-tick `event: gui` broadcast beside `code-server`, `cachedGuiJSON` late-joiner replay, `setGUIEnabled(bool)`, `guiViewerAdd/Remove(id)`; tests in `sse_test.go` for TTL (prober called once per 5 s window), flip propagation, late-joiner replay, viewer-skip, disabled payload shape, synchronous `setGUIEnabled` broadcast <!-- R19 -->

### Phase 3: Integration & Edge Cases

- [x] T017 Create `cmd/rk/gui.go`: the `gui` cobra family (`on`, `off --yes`, `status --json`, `env`, `restart`) per R10–R14 with the exact output strings and exit codes, the R11 confirm copy, tty detection, seams over `daemon.*` and `settings.*`; register in `root.go` beside `codeServerCmd`; tests in `gui_test.go` covering every verb's branches (daemon down, no backend, refuse without `--yes` on non-tty, status reasons, env exit 1 when off) <!-- R10 -->
- [x] T018 Create `api/gui.go`: `handleGuiStatus` (`GET /api/gui/{id}`) building `gui.Status` (settings + session options + probe + apps + uptime, via seams) and `handleGuiRestart` (`POST /api/gui/{id}/restart`, 409 when off, 400 invalid id, 500 on error); register both routes and `GET /ws/gui/{id}` in `api/router.go`; tests in `gui_test.go` for the 400/409/200 matrix and the status document shape <!-- R22 -->
- [x] T019 Extend `api/settings.go` `handlePostSettings`: detect `gui.enabled` in the patch, call the `ensureGUI`/`killGUI` server seams (production `daemon.EnsureGUI`/`daemon.KillGUISession`) best-effort, then `s.sseHub.setGUIEnabled`; tests in `settings_test.go` asserting the call sequence and that unrelated keys call neither <!-- R21 -->
- [x] T020 Add `guiCheck` to `cmd/rk/doctor.go` after the code-bridge row with the six exact Notes; table test in `doctor_test.go` <!-- R23 -->
- [x] T021 Capability-gated integration test `internal/gui/xvnc_integration_test.go`: skip unless `Xtigervnc` is on PATH; launch it on a temp socket with `BackendArgv`, run `Probe`, assert `RFB 003.008` banner + 1920×1080, kill it, assert the socket is gone <!-- R9 -->
- [x] T022 Extend the relay integration: in `api/gui_ws_test.go` add a capability-gated case that relays a real `Xtigervnc` (skip when absent) and reads the banner through `/ws/gui/host` — the plan's curl-level acceptance on this VM <!-- R16 -->

### Phase 4: Polish

- [x] T023 Run the help-dump tests (`go test ./cmd/rk/ -run Help`) and `shll standards` help-dump/P9 checks if `shll` is on PATH; fix Long/Short text to conform <!-- R15 -->
- [x] T024 Run `cd app/backend && go vet ./... && go test ./...` (via `just test-backend`), then `cd app/frontend && npx tsc --noEmit`; fix any Vitest fixture that pins the settings registry key count (grep `settings-dialog.test.tsx` / `settings-registry-seam.test.tsx` for a 13) <!-- R2 -->

## Execution Order

- T001–T004 are independent scaffolding; T005–T008 depend only on T003/T004.
- T009 depends on T003, T005, T006; T010 on T009; T011 on T009; T012 on T006, T009.
- T013 depends on T001, T003, T016's viewer hooks (implement `guiViewerAdd/Remove` first if T016 lags); T014 is independent; T015 on T013, T014.
- T017 depends on T009, T008; T018 on T009, T007, T008; T019 on T009, T016; T020 on T006, T007.
- T021/T022 last in their phase (they need real binaries); T023/T024 close.

## Acceptance

### Functional Completeness

- [ ] A-001 R1: `gui.enabled` is a 14th registry row (`bool`, def `false`, behavior, ui, live) with a `GUIEnabled` field, flat dotted YAML line, byte-stable round-trip, no env form
- [ ] A-002 R3: `ensureGUICore` implements the five-step skip order; `startSession` calls `ensureGUI()` after `ensureCodeServer()`; `EnsureGUI()` refuses when the daemon is down
- [ ] A-003 R4: `KillGUISession` kills `=rk-gui` exact-match, treats absence as success, and waits ≤ 5 s for the socket to vanish; `RestartGUI` composes kill → ensure and refuses when disabled
- [ ] A-004 R5: `supervise` builds the exact backend argv (`Xtigervnc` first, `Xvnc` fallback, `-rfbport -1`, `-desktop run-kit`), waits for and chmods the socket, stamps `@rk_gui_display`/`@rk_gui_backend`, launches the first WM in the fixed ladder with `dbus-run-session` for `x-session-manager`, and traps signals
- [ ] A-005 R7: on darwin `supervise` spawns nothing, stamps `screen-sharing`, logs the Screen Sharing probe once a minute
- [ ] A-006 R8: `internal/gui` exposes `StateDir`, `SocketPath`, `ValidateSocketPath`, `FreeDisplay`, `ResolveBackend`, `BackendArgv`, `ResolveWM`, `Probe`, `RunningApps`, `Status`, `InstallHint` with no tmux and no `internal/daemon` import
- [ ] A-007 R10: `rk gui on` persists true and prints the right line for started / already running / no backend / daemon down, exit 0
- [ ] A-008 R11: `rk gui off` prints the exact confirm copy, refuses on non-tty without `--yes`, and with `--yes` kills the session and persists false
- [ ] A-009 R12: `rk gui status` renders `off` / `on (...)` / `on — not running (<reason>)` and `--json` emits the `gui.Status` document
- [ ] A-010 R13: `rk gui env` prints `export DISPLAY=:N` and `export RK_GUI_SOCKET=<path>`, exit 1 with the hint when off or not running
- [ ] A-011 R14: `rk gui restart` composes kill → ensure and refuses when disabled or daemon down
- [ ] A-012 R16: `/ws/gui/{id}` upgrades, gates (4400/4403/4404), dials the OS-appropriate backend, pipes binary frames both ways with deadlines and read limit, and tracks viewers
- [ ] A-013 R19: `event: gui` is broadcast every tick with the list payload, probed with a 5 s TTL, replayed to late joiners, and skips the dial while a viewer is live
- [ ] A-014 R20: `setGUIEnabled` broadcasts synchronously and is called from the settings POST
- [ ] A-015 R21: the settings POST calls ensure on true and kill on false, best-effort, and never for unrelated keys
- [ ] A-016 R22: `GET /api/gui/{id}` returns the status document; `POST /api/gui/{id}/restart` returns 409 when off, 400 on a bad id, 200 on success
- [ ] A-017 R23: the doctor `gui` row renders the six exact Notes and is always OK-shaped
- [ ] A-018 R24: `ValidateGUIID` accepts exactly `host` and is used by the relay, both API routes, and `supervise`
- [ ] A-019 R25: the plan's C2 row carries the change folder now and the PR URL after ship

### Behavioral Correctness

- [ ] A-020 R2: with `Xtigervnc` installed and a fresh config, daemon start issues zero gui tmux commands and `rk doctor` prints `gui: off` — never-on-by-default is a passing unit test
- [ ] A-021 R6: after an external backend kill, the pane shows the exit line, the socket is gone, the session persists, and status/stream read not running until `rk gui restart`
- [ ] A-022 R9: `Probe` on `unix` returns width/height from ServerInit and closes after one connection; on `tcp` it stops at the banner

### Scenario Coverage

- [ ] A-023 R16: capability-gated test relays a real `Xtigervnc` through `/ws/gui/host` and reads `RFB 003.008` (skips cleanly when the binary is absent)
- [ ] A-024 R9: capability-gated test launches `Xtigervnc` with `BackendArgv` on a temp socket and probes 1920×1080
- [ ] A-025 R11: `off` without `--yes` on a non-tty leaves the setting true and issues no kill

### Edge Cases & Error Handling

- [ ] A-026 R17: client disconnect closes the backend conn within 1 s; backend disconnect closes the client within 1 s; viewer count returns to 0
- [ ] A-027 R18: in `screen-sharing` mode KeyEvent and PointerEvent client messages are dropped after the handshake and every other type is forwarded intact; in `unix` mode the filter is inert
- [ ] A-028 R8: `ValidateSocketPath` rejects paths over 100 bytes; `FreeDisplay` skips displays with either a lock file or a socket and errors past `:99`
- [ ] A-029 R3: no backend on PATH ⇒ `GUIEnsureNoBackend`, the daemon warns and continues, `rk gui on` still persists true and prints the install hint
- [ ] A-030 R19: a missing `rk-gui` session yields `reachable:false` with reason `session absent`; an unparsable stamped display is treated as absent

### Code Quality

- [ ] A-031 Pattern consistency: new code mirrors `codeserver.go` seams/outcome enum, the `terminals_ws.go` relay discipline, the `codeServerTick` probe shape, and the `code-server` cobra family shape
- [ ] A-032 No unnecessary duplication: reuses `runTmux`, `sessionExistsCtx`, `jobDaemonRunning`, `selfpath.Resolve`, the shared `upgrader`, `writeJSON`/`writeError`, and the XDG state-dir rule
- [ ] A-033 Security-first: every subprocess uses `exec.CommandContext` with an argv slice and a timeout (supervise's long-lived backend/WM use `exec.CommandContext` with a cancellable ctx and no shell); no shell strings anywhere
- [ ] A-034 No magic values: session/window names, display start, TTLs, deadlines, close codes, and the WM ladder are named constants/vars
- [ ] A-035 Tests alongside: every new file has a colocated `_test.go`; Go tests pass via `just test-backend`; `tsc --noEmit` passes
- [ ] A-036 Comments state constraints, not narration; no change IDs or PR numbers in code comments
- [ ] A-037 Derived state: nothing new is persisted beyond the preference — reachability is a probe, running is a session probe, display/backend are tmux options stamped by the supervisor

### Security

- [ ] A-038 R5: the state dir is created 0700 and the socket chmod'ed 0600; `-rfbport -1` is present in every backend argv so nothing listens on TCP
- [ ] A-039 R24: `id` is validated before any dial, tmux command, or route handler proceeds
- [ ] A-040 R18: the macOS backend never receives client input messages (view-only enforced server-side)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- macOS-only paths (R7, R18 runtime, the 5900 dial) cannot be exercised on this Linux VM; they are covered by unit tests over seams and synthetic streams, and by the plan's manual macOS acceptance after merge.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Probe dial timeout 500 ms, relay dial timeout 2 s, WS write deadline 10 s, read limit 1 MiB, backend read chunk 64 KiB | `codeServerDialTimeout`/`terminalsWriteWait` precedents; RFB client messages are small, clipboard is the largest | S:60 R:90 A:85 D:75 |
| 2 | Confident | Display range `:10`–`:99`, free ⇔ neither `/tmp/.X{N}-lock` nor `/tmp/.X11-unix/X{N}` exists | X11 lock-file convention; starting at :10 avoids desktop-session displays | S:60 R:90 A:80 D:75 |
| 3 | Confident | `-desktop run-kit` added to the D5 flag set as the window title | Harmless, identifies the display in VNC clients; not in D5 but not contradicting it | S:50 R:95 A:85 D:80 |
| 4 | Confident | Status JSON field names `id, enabled, backend, reachable, display, width, height, viewers, socket, session, reason, apps[{name,count}], uptime_seconds`; stream payload is the first eight | Plan names the first eight; C3 needs apps + reason for the confirm and empty state | S:65 R:85 A:80 D:70 |
| 5 | Confident | macOS probe stops at the banner (no ARD auth in the probe); geometry zero there | Auth needs the Keychain password; reachability is the dial + banner | S:60 R:90 A:75 D:75 |
| 6 | Confident | Apps scan excludes the supervisor's own pids (backend, WM, supervise) by reading the stamped pids from the process tree of the `rk-gui` pane; grouping by `comm`, sorted count desc | Intake § 4; `/proc` is the only env-filterable source on Linux | S:65 R:85 A:75 D:70 |
| 7 | Confident | View-only filter parses the ARD (type 30) exchange by lengths from the wire (generator u16, key length u16, prime, public key; client reply 128 + key-length bytes) and the None exchange as zero bytes, then waits for SecurityResult and ServerInit | RFB 3.8 + Apple ARD framing; unit-tested on synthetic streams since no Mac is available | S:55 R:70 A:60 D:60 |
| 8 | Confident | Uptime derives from the `rk-gui` session's `session_created` tmux format | Constitution II: derive from tmux; matches how sidebar derives ages | S:55 R:90 A:85 D:80 |
| 9 | Confident | The PR URL in the plan's C2 row is filled by the orchestrator after ship as a follow-up commit on the PR branch | Apply cannot know a URL that does not exist yet | S:70 R:95 A:90 D:85 |

9 assumptions (0 certain, 9 confident, 0 tentative).

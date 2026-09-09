# Intake: GUI Backend — the Switch, the Supervisor, the Relay (plan C2)

**Change**: 260909-fkh1-gui-backend-switch-and-relay
**Created**: 2026-09-09

## Origin

One-shot `/fab-new` invocation (no prior discussion in this session). The plan file, the C1
spec, the design study, and the C0 verdict are the design inputs; this intake carries them
across the pipeline boundary so apply can plan without re-reading them.

> gui-backend-switch-and-relay Plan: fab/plans/sahil/26-09-09-gui-surface.md -- implement C2
> (backend: the switch, the supervisor, the relay) per the plan's change breakdown and pickup
> protocol. Its dependencies (C0 verdict and C1) are both done: C1
> (260909-5nvd-gui-spec-and-registry-rename, PR #888) merged the gui spec/registry-rename
> groundwork, and the C0 spike verdict (appended to the plan, dated 2026-09-09) settled D5 --
> Xvnc stands as the Linux default backend (Xtigervnc + stock noVNC canvas), KasmVNC deferred
> to the conditional C6. Before starting, read the plan file in full including the C0 verdict
> section, the design study docs/wiki/gui-surface-design-study.html, docs/specs/window-views.md
> and docs/specs/surface-layout.md and docs/specs/gui.md (created by C1),
> fab/project/constitution.md, and the lenses-and-layout, configuration, daemon-lifecycle
> memory files. Treat the plan's Decision log (D1-D10) as Certain in SRAD scoring. C2 is sized
> L -- this is the big Go change (settings, supervisor, relay, state). After merge, fill in the
> C2 row (change folder / PR) in the plan's tracking table in the same PR.

**Design authority (read in full at intake, binding downstream):**

- `fab/plans/sahil/26-09-09-gui-surface.md` — decision log D1–D10 (Certain), § C2 scope +
  acceptance, § Constitution mapping, § Risks, § C0 verdict (Xvnc stands; five findings that
  bind C2 regardless — see § What Changes › Backend argv).
- `docs/specs/gui.md` (C1) — the substrate diagram, the switch table, availability vs
  reachability, protocol/relay, OS split, constitution mapping, phasing.
- `docs/specs/window-views.md` R3 (host-singleton tty = the `rk-gui` supervisor pane) and R6
  (dot = VNC WS); `docs/specs/surface-layout.md` (the tile side, C3 — read for shape only).
- `docs/wiki/gui-surface-design-study.html` §3, §4, §6, §7, §10, §14, §15, §16.
- Mirror templates in code: `app/backend/internal/daemon/codeserver.go` (sibling-session
  ensure ladder, seams, kill primitive), `app/backend/api/terminals_ws.go` (relay discipline),
  `app/backend/api/sse.go` `codeServerTick`/`event: code-server` (TTL probe + cached replay),
  `app/backend/internal/settings/settings.go` `auto_name`/`cron_ticker` entries (bool
  registry rows), `app/backend/api/settings.go` `handlePostSettings` (live re-apply seam),
  `app/backend/cmd/rk/code_server.go` + `doctor.go` `codeServerCheck` (CLI family + doctor
  row shape), `app/backend/internal/codebridge/state.go` `StateDir` (XDG state-dir rule).
- Salvage, reference only (never a base): PR #71 branch `260323-a805-web-based-remote-desktop`
  (closed) — its `relay.go` VNC proxy loop, WM detection + `dbus-run-session` traps,
  `docs/desktop-streaming.md` troubleshooting table.

## Why

The `gui` surface (the host's desktop as a fourth tile beside `tty`/`code`/`web`) has a
merged spec (C1) and a settled backend verdict (C0) but no code. Everything user-facing (C3
tile, C4 agent verbs, C5 measurement) sits on three backend facts this change creates:

1. **The switch exists.** `gui.enabled` is the one fact the whole design keys off (D3): the
   4th toggle button exists iff it is on; the supervisor runs iff it is on; nothing else ever
   flips it. Until the settings registry carries it, C3 has nothing to gate on and risk 1 ("a
   Start button on a disabled host") cannot be tested.
2. **A live RFB stream is reachable over rk's own origin.** noVNC in the tile needs
   `wss://<rk-origin>/ws/gui/host` to hand it raw RFB bytes. Xvnc must never listen on TCP
   (D4; C0 finding 2 shows the default *does* — `-rfbport -1` is mandatory), so the relay is the
   only door.
3. **The state stream says whether the GUI is enabled and reachable.** C3's registry row
   (`availableTiles` pushes `gui` iff `gui[0]?.enabled`), the empty state (enabled but
   unreachable), and the off-confirm (which apps will die) all read one payload.

Not doing this leaves the spec as [target] prose and blocks C3/C4/C5. Building it inside the
existing shapes (sibling tmux session on the `rk-daemon` socket like `rk-code-server`; a
WebSocket relay like `/ws/terminals`; a TTL-probed host-global state slot like
`event: code-server`; a registry bool like `auto_name`) keeps Constitution II/IV/VI intact:
nothing stored beyond the one preference, no new env keys, tmux owns the X server, and the
relay reattaches after rk restarts.

## What Changes

Everything is Go (`app/backend/`) plus the plan's tracking row. No frontend work beyond what
the registry-driven settings dialog renders on its own. After this change, on this VM:

```
$ rk gui status            → gui: off
$ rk gui on                → enabled; rk-gui session started (Xtigervnc :10, 1920x1080)
$ ls "$XDG_STATE_HOME/run-kit/gui"   → host.sock   (srw------- , dir drwx------)
$ <Go test / websocat> wss://…/ws/gui/host → first 12 bytes "RFB 003.008\n"
$ curl /ws/state (event: gui) → [{"id":"host","enabled":true,"backend":"Xtigervnc","reachable":true,
                                  "display":":10","width":1920,"height":1080,"viewers":0}]
$ rk gui off --yes         → session killed, socket gone, enabled:false within one state event
```

### 1. Settings — `gui.enabled`

`internal/settings/settings.go`:

- `Settings` gains `GUIEnabled bool` (default `false`, so `Default()` is untouched).
- One new `registryEntry`, placed after `cron_ticker` (scalar block, before `tmux_conf`):

  ```go
  {
      key: "gui.enabled", kind: "bool", def: "false",
      desc:     "Turns the GUI surface on: runs the host desktop (rk-gui session) and shows the 4th tile toggle. Off by default; nothing flips it but you.",
      category: "behavior", ui: true, live: true,
      parse:     …strconv.ParseBool tolerant read, default off (the auto_name shape)…,
      serialize: func(s *Settings) string { if s.GUIEnabled { return "gui.enabled: true\n" }; return "" },
      read:      func(s *Settings) any { return s.GUIEnabled },
      apply:     boolValue(func(s *Settings) *bool { return &s.GUIEnabled }, false),
  }
  ```

  The YAML line is the flat dotted key `gui.enabled: true` (D3 names the key; the hand-rolled
  line scanner matches key text, so no nested `gui:` section). Omitted when default, so an
  untouched file round-trips byte-identically. **No env form** (Constitution IV — env stays
  `RK_PORT`/`RK_HOST`/`RK_CODE_SERVER_PORT`).
- Appears in `GET /api/settings` (a 14th row) and the settings dialog's bool row renderer
  (`settings-all-panel.tsx` `case "bool"`) automatically. The dialog's off-direction confirm is
  C3's; C2 accepts the interim bare toggle because no 4th button exists yet.
- Tests: default false; parse/serialize round-trip; `never on by default` — `Default()`,
  `Load()` on an empty dir, and `Load()` after `rk gui on` + `off` all report false; registry
  inventory test bumps 13 → 14 keys.

### 2. Package layout

| Path | Role |
|------|------|
| `internal/gui/` (new) | Pure backend logic, **no tmux**: `StateDir()` (`$XDG_STATE_HOME/run-kit/gui`, else `~/.local/state/run-kit/gui` — the `codebridge.StateDir` rule), `SocketPath(id)`, `ValidateSocketPath` (≤ 100 bytes; C0 finding 3), display selection, backend detection (`Xtigervnc` → `Xvnc` fallback → none; macOS = `screen-sharing`), Xvnc argv builder, WM ladder, the RFB probe (`Probe(ctx, addr) (Info, error)`), running-apps scan, `Status` struct + JSON shape shared by CLI/API/SSE, install-hint text. `_linux.go`/`_darwin.go` files where behavior forks. |
| `internal/daemon/gui.go` (new) | The tmux half, a line-for-line sibling of `codeserver.go`: `GUISessionName = "rk-gui"`, `GUIWindowName = "host"`, package seams (`guiSessionExists`, `guiSpawn`, `guiKillRun`, `guiSelfPath`), `ensureGUICore(cli bool)`, `ensureGUI()` (daemon boot hook, gated), `EnsureGUI()` (CLI/API entry, daemon-liveness gated), `KillGUISession()`, `RestartGUI()`. Lives in `daemon` so the boot hook needs no import cycle and reuses `runTmux`/`sessionExistsCtx`/`jobDaemonRunning`. |
| `cmd/rk/gui.go` (new) | The `rk gui` cobra family: `on`, `off [--yes]`, `status [--json]`, `env`, `restart`, `supervise <id> --display :N` (hidden plumbing — the pane command). |
| `api/gui_ws.go` (new) | `GET /ws/gui/{id}` relay. |
| `api/gui.go` (new) | `GET /api/gui/{id}`, `POST /api/gui/{id}/restart`. |
| `api/sse.go` | `event: gui` slot: tick, TTL probe, cached replay, `setGUIEnabled` apply seam. |
| `api/router.go`, `api/settings.go` | Routes; the `gui.enabled` POST side effect. |
| `cmd/rk/doctor.go` | `gui` row. |
| `internal/validate/validate.go` | `ValidateGUIID`. |

### 3. Supervisor — the `rk-gui` sibling session

**Ensure ladder** (`ensureGUICore`, mirrors `ensureCodeServerCore`; skip order fixed):

1. `!settings.Load().GUIEnabled` ⇒ `EnsureDisabled` (the daemon boot hook returns here
   silently — **never-on-by-default is a unit test**: a fresh config dir + `startSession` must
   issue zero tmux commands for gui).
2. `rk-gui` session exists ⇒ `EnsureAlreadyRunning` (silent skip; a dead-backend session is
   still "exists" — see exit semantics below; `restart` is the recovery verb).
3. Linux: no backend binary (`Xtigervnc` absent and `Xvnc` absent) ⇒ `EnsureNoBackend` — the
   daemon logs the install hint and continues; the CLI prints it and still enables:
   `install a VNC X server and a window manager: sudo apt install tigervnc-standalone-server openbox`.
   macOS: never `NoBackend` (nothing to spawn — the probe reports Screen Sharing state).
4. Socket path too long (> 100 bytes) or state dir not creatable ⇒ `EnsureStateDirFailed`
   (warn / operational error naming the path).
5. Spawn: pick the lowest free display `:N` starting at `:10` (free ⇔ neither
   `/tmp/.X{N}-lock` nor `/tmp/.X11-unix/X{N}` exists), then
   `tmux new-session -d -s rk-gui -n host <rk-exe> gui supervise host --display :N` on the
   `rk-daemon` socket (`runTmux`; `selfpath.Resolve` for the exe, the code-server RK_BIN
   precedent). ⇒ `EnsureStarted`.

**Boot hook**: `startSession` calls `ensureGUI()` right after `ensureCodeServer()`; the gate is
step 1. `rk daemon restart` therefore re-ensures a killed session; an existing session (the
normal case — siblings survive daemon restarts, Constitution VI) is skipped.

**Kill**: `KillGUISession()` — exact-match `kill-session -t =rk-gui`, audit-logged like
`KillCodeServerSession`, absent session = success, then waits ≤ 5 s for `host.sock` to
disappear (the socket-release mirror of the port-release wait, so `off`→`on` compositions
never see the dying socket). `RestartGUI()` = kill + `ensureGUICore(true)`.

**`rk gui supervise host --display :N`** (Linux) — the pane command; its stdout/stderr IS the
supervisor log (D8/R3):

1. `mkdir -p` the state dir `0700`; remove a stale `host.sock`.
2. Exec the backend with `exec.CommandContext` argv (Constitution I), stdout/stderr inherited:

   ```
   Xtigervnc :N -rfbunixpath <StateDir>/host.sock -rfbport -1 -SecurityTypes None -AlwaysShared \
             -AcceptSetDesktopSize -geometry 1920x1080 -FrameRate=60 -desktop run-kit
   ```

   Binary resolution is **by name `Xtigervnc`**, `Xvnc` only when `Xtigervnc` is absent (C0
   finding 1: the KasmVNC deb hijacks `Xvnc` via `update-alternatives`). `-rfbport -1` is
   mandatory (C0 finding 2: without it TigerVNC still binds TCP 5900+N on all interfaces).
   `-FrameRate=60` (both spellings accepted — finding 4).
3. Wait ≤ 5 s for the socket to appear, `chmod 0600` it, log
   `gui: Xtigervnc up on :N (socket <path>)`. Stamp `@rk_gui_display :N` and
   `@rk_gui_backend Xtigervnc` on the `rk-gui` session (session options on the rk-daemon
   socket — the `@rk_*` per-entity state home; readers: `rk gui env`/`status`, the state
   probe, C4's `rk agent setup`).
4. Launch the WM with `DISPLAY=:N` in its env, first hit of the probe order
   `openbox → xfwm4 → i3 → kwin_x11 → x-session-manager`; `x-session-manager` (and any full
   DE) is wrapped as `dbus-run-session -- <wm>` (PR #71's ladder). No WM found ⇒ log
   `gui: no window manager found (tried …); running bare — apt install openbox` and continue
   (a bare X display is still usable by `rk gui exec`).
5. Trap SIGTERM/SIGINT/SIGHUP: kill WM then Xvnc, remove the socket, exit 0.
6. **Exit semantics**: when Xvnc exits on its own, log
   `gui: Xtigervnc exited (status N) — display :N is down; run 'rk gui restart' or turn the GUI off`,
   kill the WM, remove the socket, and **stay alive idle** so the pane remains readable (the
   tty must show the exit — acceptance bullet 3). The session still "exists", so ensure skips
   it; `reachable:false` on the stream and `rk gui status` say `not running (Xtigervnc exited)`
   until `rk gui restart` / `POST /api/gui/host/restart` / `rk gui off`.

**macOS** (`GOOS=darwin`): `supervise` is a sleeper that logs the Screen Sharing probe result
once a minute (`Screen Sharing: reachable on 127.0.0.1:5900` / `not reachable — enable
System Settings › General › Sharing › Screen Sharing`), stamps `@rk_gui_backend
screen-sharing`, and exits on signal. Nothing is spawned (D6).

### 4. CLI — `rk gui`

| Verb | Behavior | Exit |
|------|----------|------|
| `rk gui on` | `settings.Load()` → `GUIEnabled=true` → `settings.Save()`; then if the daemon is running (`daemon.IsRunning()`), `daemon.EnsureGUI()` and print the outcome line (`started (Xtigervnc :10)` / `already running` / `enabled — no VNC backend installed: <hint>`); if the daemon is down print `enabled — the daemon starts the GUI on 'rk serve -d'` (no tmux command on a dead socket — the RunJob gate). Idempotent. | 0; 1 on save/spawn error |
| `rk gui off [--yes]` | Compute the running-apps list (below). Without `--yes` and with apps present, print the confirm and read `y/N` from the tty (non-tty ⇒ refuse with `re-run with --yes`). Then `KillGUISession()`, `GUIEnabled=false`, `Save()`. With no apps (or macOS) no prompt. | 0; 1 refused/aborted |
| `rk gui status [--json]` | Human: `gui: off` / `gui: on (Xtigervnc, :10, 1920x1080, 2 viewers)` / `gui: on — not running (<reason>)` plus the apps line when running. `--json`: the shared `gui.Status` document — `{"id":"host","enabled":…,"backend":…,"reachable":…,"display":…,"width":…,"height":…,"viewers":…,"socket":…,"session":true\|false,"reason":"…","apps":[{"name":"chromium","count":3}],"uptime_seconds":…}`. | 0 always (state, not verdict) |
| `rk gui env` | Prints `export DISPLAY=:10` and `export RK_GUI_SOCKET=<path>` for `eval "$(rk gui env)"` (shell outputs, not config inputs). Off or not running ⇒ exit 1 with the `rk gui on` hint (C4's gating shape). | 0 / 1 |
| `rk gui restart` | `RestartGUI()`; refuses (exit 1) when disabled (`turn it on with 'rk gui on'`) or the daemon is down. | 0 / 1 |
| `rk gui supervise <id> --display :N` | Hidden. The pane command (§ 3). Rejects `id != host`. | backend's fate |

Help text follows the `rk code-server` family shape (Use/Short/Long with a Subcommands list).
The help-dump test suite (`help_dump_test.go`) and `shll standards` help-dump / P9 checks run
against the new family (Constitution › Toolkit Standards).

**Running-apps list** (Linux): scan `/proc/[0-9]*/environ` for `DISPLAY=:N` (the stamped
display), drop the supervisor's own pids (Xvnc, the WM, `rk gui supervise`), group by `comm`,
render `chromium ×3, xterm ×1`. Errors on individual pids are skipped (permission, vanished).
macOS: empty (nothing runs under rk's control — D6). Uptime = the `rk-gui` session's
`session_created` via tmux.

**Off-confirm copy** (CLI; C3 reuses the same fields for the dialog):

```
Turning the GUI off kills the rk-gui session and every app on display :10:
  chromium ×3, xterm ×1  (up 4h 12m)
Continue? [y/N]
```

### 5. Relay — `GET /ws/gui/{id}`

`api/gui_ws.go`, registered beside `/ws/terminals`:

1. `validate.ValidateGUIID(id)` ⇒ on failure upgrade then close with **4400** `invalid gui id`
   (the `/ws/terminals` posture: errors ride WS close frames so noVNC gets a reason).
2. `!settings.Load().GUIEnabled` ⇒ close **4403** `gui disabled`.
3. Dial the backend: Linux `unix:<StateDir>/host.sock`; macOS `tcp:127.0.0.1:5900`
   (`net.DialTimeout`, 2 s). Failure ⇒ close **4404** `gui not running: <reason>`.
4. Pipe **binary frames only**: WS→backend writes each binary message to the conn;
   backend→WS reads up to 64 KiB chunks and writes `BinaryMessage` with a 10 s write deadline
   (`terminalsWriteWait`). Text frames are ignored (forward-compat); `SetReadLimit` bounds
   inbound frames (1 MiB — an RFB client message is small; clipboard is the largest).
5. Lifecycle context rooted at `Background` (not `r.Context()`, the hijack rule from
   `state_ws.go`); either side's read error cancels it and closes **both** conns — the Go test
   `TestGuiRelayClientDisconnectClosesBackend` dials a fake unix-socket backend, connects a WS
   client, closes the client, and asserts the backend accept-side conn sees EOF within 1 s
   (no orphaned sockets).
6. Viewer accounting: the hub's `guiViewers[id]` counter increments on a successful dial and
   decrements on teardown — the payload's `viewers`.
7. **macOS view-only filter** (risk 5, server side): when the backend is `screen-sharing`, the
   relay tracks the RFB handshake (ProtocolVersion 12+12 bytes, security negotiation incl. ARD
   type 30's DH exchange, SecurityResult, ClientInit 1 byte, ServerInit 24+name bytes) and
   afterwards drops client→server messages of type 4 (KeyEvent) and 5 (PointerEvent), passing
   everything else. Unit-tested against a synthetic byte stream; not exercisable on this Linux
   VM (manual acceptance on a Mac).

### 6. State stream — `event: gui`

`api/sse.go`, mirroring `event: code-server`:

- Hub fields: `guiEnabled bool`, `guiProbeAt time.Time`, `guiInfo gui.Info` (backend,
  reachable, display, width, height), `guiViewers map[string]int`, `cachedGuiJSON string`.
- `guiTick()` runs every poll tick: re-reads `settings.Load().GUIEnabled` (so a CLI-side
  `rk gui on` shows up without a POST) and, when enabled, refreshes the probe if older than
  `guiProbeTTL = 5 s`: read `@rk_gui_display`/`@rk_gui_backend` from the `rk-gui` session
  (absent session ⇒ `reachable:false`, `reason:"session absent"`), then `gui.Probe` — dial the
  socket, complete the minimal RFB handshake (`RFB 003.008` both ways, security type None
  (Linux) or just read the security list then close (macOS — auth needs the Keychain password;
  reachability is the dial + banner), `ClientInit shared=1`, read `ServerInit` for `width`/
  `height`), close. Dial timeout 500 ms. **When ≥ 1 relay viewer is live, skip the dial**
  (`reachable:true` follows from the live relay) — keeps Xvnc's per-connection log lines out of
  the supervisor pane while someone is watching.
- Payload (always a list, D2):

  ```json
  [{"id":"host","enabled":true,"backend":"Xtigervnc","reachable":true,"display":":10",
    "width":1920,"height":1080,"viewers":1}]
  ```

  Disabled: `[{"id":"host","enabled":false,"backend":"","reachable":false,"display":"",
  "width":0,"height":0,"viewers":0}]`. Broadcast as `hubEvent{kind: kindGlobal, typ: "gui"}`
  every tick (client raw-payload dedup absorbs repetition, the services pattern); replayed to
  late joiners from `cachedGuiJSON` in the same block as `code-server`.
- `setGUIEnabled(bool)` apply seam: flips `guiEnabled`, zeroes the probe age, re-renders and
  broadcasts immediately — so **the settings POST flips `enabled` within one state event**.
- Probe TTL is a Go test: a stubbed prober is called once per 5 s window regardless of tick
  count; a flipped stub result surfaces on the next post-TTL tick (`kill Xvnc → reachable:false
  within the TTL`).

### 7. HTTP — `/api/gui/*` and the settings POST side effect

- `POST /api/settings` with `gui.enabled`: after `Save`, `true` ⇒ `daemon.EnsureGUI()`
  best-effort (warn-log on failure; the response is still 200 — the stream's `reachable:false`
  + `reason` is the user-visible outcome), `false` ⇒ `daemon.KillGUISession()`; both then
  `sseHub.setGUIEnabled(v)`. The C3 confirm happens client-side before the POST.
- `GET /api/gui/{id}` → the `gui.Status` JSON (same document as `rk gui status --json`,
  including `apps` — what C3's off-confirm renders). 400 on an invalid id.
- `POST /api/gui/{id}/restart` → `RestartGUI()`; 409 `{"error":"gui disabled"}` when off;
  200 `{"status":"ok"}` (the empty state's "Restart supervisor" action). Mutations are POST
  only (Constitution IX). No other routes — the family is exactly `/ws/gui/*` + `/api/gui/*`.

### 8. Doctor row

`cmd/rk/doctor.go` adds `guiCheck(...)` after `code-server`/`code-bridge`, always OK-shaped
(state, not verdict), pure over injected seams:

| State | Note |
|-------|------|
| off | `off` |
| on, reachable | `on (Xtigervnc, :10, 1920x1080, 2 viewers)` — the **resolved binary name** (C0 finding 1) |
| on, session absent | `on — not running (rk-gui session absent; the daemon starts it on 'rk daemon start')` |
| on, no backend | `on — not running (no VNC backend: sudo apt install tigervnc-standalone-server openbox)` |
| on, backend exited | `on — not running (Xtigervnc exited — see the rk-gui pane; 'rk gui restart')` |
| on, macOS off | `on — not running (Screen Sharing is off: System Settings › General › Sharing › Screen Sharing)` |

### 9. Validation

`validate.ValidateGUIID(id string) string` — exactly `"host"` in v1 (D2 keeps the path
list-shaped; the validator is where a second id lands later). Used by the relay, the two
`/api/gui` routes, and `rk gui supervise`.

### 10. Tests (Go; no Playwright in C2)

- settings: default false, round-trip, 14-key inventory, never-on-by-default.
- daemon: boot hook skipped when disabled (zero tmux argv captured), spawn argv when enabled
  (session name, window name, `supervise host --display :10`), already-running skip, kill
  exact-match + socket-release wait, `EnsureGUI` daemon-down gate.
- gui: display selection against a temp lock dir, socket-path length guard, Xvnc argv builder
  (asserts `-rfbport -1` and `Xtigervnc`-first resolution against a stubbed lookPath), WM ladder
  + `dbus-run-session` wrap, `/proc` apps scan against a fixture tree, RFB probe against an
  in-process fake server (banner → ServerInit 1920×1080), probe error classification.
- api: relay teardown (client disconnect closes backend), close codes 4400/4403/4404,
  view-only filter drops types 4/5 after a synthetic handshake, `event: gui` TTL, late-joiner
  replay, `setGUIEnabled` synchronous broadcast, `/api/gui/host` shape, restart 409 when off.
- doctor: the six row states.
- `off` refuses without `--yes` when apps are running (non-tty).
- Optional capability-gated integration test: skips unless `Xtigervnc` is on PATH; launches it
  on a temp socket, relays through a real `/ws/gui/host` over httptest, asserts the
  `RFB 003.008` banner — mirrors the plan's curl-level acceptance on this VM (which has
  `Xtigervnc`, `openbox`, `kwin_x11`, `x-session-manager`, `dbus-run-session`).

### 11. Docs in the same PR

- `fab/plans/sahil/26-09-09-gui-surface.md`: C2 tracking row — change folder
  `260909-fkh1-gui-backend-switch-and-relay` (filled at intake), PR URL at ship, status
  `Done` on merge; the "Status (2026-09-09)" line updated to name C3/C4 as the next pickups.
- `docs/memory/` hydrate per § Affected Memory. Specs stay human-curated; `docs/specs/gui.md`
  is not edited here (C2 ships exactly what its phasing row says).
- No `rk skill gui` page in C2 (C4). `shll standards` help-dump/P9 audit for the new family.

## Affected Memory

- `run-kit/gui`: (new) the backend half — `gui.enabled`, the `rk gui` family, the `rk-gui`
  session + supervise contract (display selection, Xvnc argv, WM ladder, stamps, exit
  semantics), the relay, the `event: gui` payload + probe, `/api/gui/*`, doctor row, macOS
  posture. C4 extends it with the agent verbs.
- `run-kit/configuration`: (modify) 14th registry key `gui.enabled` (bool, behavior, ui, live,
  flat dotted YAML line, no env form); the POST side-effect seam joins `auto_name` as the
  second key with a side effect; the `gui/` state tenant under `$XDG_STATE_HOME/run-kit/`.
- `run-kit/daemon-lifecycle`: (modify) `rk-gui` joins `rk-code-server`/`rk-remotes`/`rk-jobs`
  as a sibling session; the gated `ensureGUI` boot hook; `KillGUISession` socket-release wait
  as the third kill primitive owning its release invariant.
- `run-kit/api-and-sockets`: (modify) `/ws/gui/{id}` relay (close codes, binary-only, view-only
  filter), `event: gui` host-global slot beside `event: code-server`, `/api/gui/*`.
- `run-kit/architecture`: (modify) `internal/gui` package + `rk gui` in the CLI subcommand list.
- `run-kit/toolkit-standards`: (modify) the `rk gui` family added to the help-dump + P9
  new-surface check list.

## Impact

- **Backend (Go)**: new `internal/gui` (~6 files + tests), `internal/daemon/gui.go` (+test),
  `cmd/rk/gui.go` (+test), `api/gui_ws.go` (+test), `api/gui.go` (+test); edits to
  `internal/settings/settings.go` (+tests), `api/sse.go` (+tests), `api/settings.go`,
  `api/router.go`, `cmd/rk/doctor.go` (+tests), `internal/validate/validate.go` (+test),
  `internal/daemon/daemon.go` (one boot-hook line). Roughly 2–3k lines including tests.
- **Dependencies**: none new — `gorilla/websocket` is already the relay lib; the RFB probe
  and view-only filter are hand-rolled over `net`.
- **Host requirements** (runtime, optional): `tigervnc-standalone-server` + a WM on Linux;
  Screen Sharing on macOS. Absence degrades to `not running` + install hint, never an error.
- **Frontend**: no source changes. The settings dialog renders the new bool row from the
  registry; Vitest fixtures that pin the registry key count (if any) need the +1.
- **Docs**: plan tracking row; six memory files (one new); help-dump goldens if any pin the
  command tree.
- **Security posture**: argv slices + timeouts everywhere; socket `0600` in a `0700` dir;
  `-rfbport -1` so nothing listens on TCP; auth None because rk on the same user is the only
  client (the code-server `--auth none` boundary); id validated; macOS never receives input.
- **Downstream**: unblocks C3 (tile) and C4 (agent verbs), which run in parallel after merge.

## Open Questions

None open. The three "pick with the user" items were asked at intake and confirmed
(Assumptions rows 13, 16, 17): WM probe order as proposed; the explicit off-confirm sentence;
supervisor stays idle after an Xvnc exit with `rk gui restart` as the recovery verb.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Plan decision log D1–D10 and the C0 verdict are binding: kind `gui`/CLI `rk gui`; one session per host (`id=host`), list-shaped path + payload; `gui.enabled` off by default, no env form; RFB over rk's WS relay, unix socket, auth None; Linux default `Xtigervnc` + WM, X11; macOS view-only Screen Sharing mirror; D8 supervisor tty in `rk-gui`; D10 exclusions | User instruction: treat the decision log as Certain; C0 verdict closes D5 | S:95 R:90 A:95 D:95 |
| 2 | Certain | Xvnc argv `Xtigervnc :N -rfbunixpath <sock> -rfbport -1 -SecurityTypes None -AlwaysShared -AcceptSetDesktopSize -geometry 1920x1080 -FrameRate=60 -desktop run-kit`; exec `Xtigervnc` by name, `Xvnc` only as fallback; socket path ≤ 100 bytes validated | D5 flags + C0 findings 1–4 (alternatives hijack, TCP still open without `-rfbport -1`, 107-byte path cap) | S:95 R:85 A:90 D:95 |
| 3 | Certain | Settings registry entry `gui.enabled` (`bool`, def `false`, category `behavior`, `ui: true`, `live: true`), struct field `GUIEnabled`, flat dotted YAML line, omitted when default; the registry-driven settings dialog therefore renders the row with no off-confirm until C3 (no 4th button exists yet, so the interim exposure is small) | The `auto_name`/`cron_ticker` row shape is the only bool shape; D3 fixes the key text | S:85 R:80 A:85 D:70 |
| 4 | Certain | Doctor row `gui: off` / `on (<binary>, :N, WxH, k viewers)` / `on — not running (<reason>)`, always OK-shaped, resolved binary printed | Plan § C2 Settings text + C0 finding 1; code-server row posture | S:85 R:90 A:85 D:80 |
| 5 | Certain | `id` validated by `validate.ValidateGUIID` — exactly `host` in v1 | Plan § C2 Validation; D2 | S:90 R:90 A:95 D:95 |
| 6 | Certain | Plan tracking row for C2 filled in this PR (folder at intake, PR URL at ship, Done on merge); `docs/specs/gui.md` not edited (human-curated; its C2 row already describes this scope) | User instruction + pickup protocol step 5 | S:90 R:95 A:90 D:85 |
| 7 | Confident | Package split: tmux-touching ensure/kill in `internal/daemon/gui.go` (codeserver.go mirror, same seams), pure backend logic in new `internal/gui`, CLI in `cmd/rk/gui.go` | Plan says `internal/gui` + `cmd/rk/gui.go` and "mirror codeserver.go"; the boot hook makes a `daemon`→`gui` import the only cycle-free direction | S:70 R:70 A:90 D:80 |
| 8 | Confident | State stream = a host-global `event: gui` slot mirroring `event: code-server` (5 s TTL probe, cached late-joiner replay), payload always a list | Plan: "api/sse.go gains gui: [...] with a TTL-cached dial probe exactly like codeServerReachable"; the hub has no other host-global mechanism | S:75 R:75 A:80 D:75 |
| 9 | Confident | `enabled` on the stream: hub re-reads `settings.Load().GUIEnabled` on each gui tick (CLI writes show ≤ 5 s); the settings POST calls `setGUIEnabled` for a synchronous broadcast | Plan requires the synchronous POST flip; CLI `rk gui on` writes the file directly (code-server CLI precedent), so the hub must also poll the file | S:70 R:80 A:80 D:70 |
| 10 | Confident | Side effects of `gui.enabled` flips live in `handlePostSettings` (true ⇒ `EnsureGUI` best-effort, false ⇒ `KillGUISession`), the `auto_name` live re-apply shape; C3's confirm precedes the POST | Only seam where a POST has side effects today; keeps CLI and dialog paths convergent | S:70 R:75 A:80 D:70 |
| 11 | Confident | `/api/gui/*` in C2 = `GET /api/gui/{id}` (status incl. `apps`) + `POST /api/gui/{id}/restart` (409 when off); on/off ride `POST /api/settings` | Spec diagram names `/api/gui/*` POSTs; C3 needs the apps list for its confirm and a restart action for the empty state; nothing else is needed | S:65 R:80 A:75 D:60 |
| 12 | Confident | `width`/`height` from a bounded RFB handshake in the probe (banner → None → ClientInit → ServerInit), `viewers` = live relay connections for the id; the probe skips the dial while ≥ 1 relay viewer is live (reachability then follows from the live relay), keeping Xvnc connection logs out of the supervisor pane | Plan payload lists these fields; Xvnc exposes geometry only via ServerInit; rk is the only client path so its counter is exact | S:60 R:80 A:75 D:70 |
| 13 | Certain | Supervisor exit semantics: on backend exit log status, kill WM, remove socket, stay alive idle (pane readable; session-exists ⇒ ensure skips); `rk gui restart`/`POST restart` = kill + ensure; no auto-respawn loop | Asked — user chose "stay idle; manual restart" over auto-respawn-with-backoff and exit-the-pane (acceptance bullet 3 needs the readable pane) | S:95 R:90 A:95 D:95 |
| 14 | Confident | Display selection: lowest free `:N` from `:10` via `/tmp/.X{N}-lock` + `/tmp/.X11-unix/X{N}`, passed as `--display :N` in the supervise argv; supervisor stamps `@rk_gui_display`/`@rk_gui_backend` on the `rk-gui` session | Constitution IV: per-entity state lives in `@rk_*` tmux options; plan C4 reads "the supervisor's stamped display" | S:60 R:80 A:80 D:55 |
| 15 | Confident | Running-apps list (Linux): `/proc/*/environ` scan for `DISPLAY=:N`, supervisor pids excluded, grouped by `comm`; macOS: empty, `off` needs no confirm | Plan: "`ps` filtered by the display's env"; `ps` cannot filter by env, `/proc` can; D6 spawns nothing on macOS | S:65 R:85 A:75 D:70 |
| 16 | Certain | WM probe order `openbox → xfwm4 → i3 → kwin_x11 → x-session-manager`, full DEs wrapped in `dbus-run-session`; no WM ⇒ log and run bare | Asked — user confirmed the plan's proposed order (alternatives offered: drop i3; KWin first) | S:95 R:90 A:95 D:95 |
| 17 | Certain | Off-confirm copy: `Turning the GUI off kills the rk-gui session and every app on display :N:` / `  <apps>  (up <t>)` / `Continue? [y/N]`; `--yes` skips; non-tty refuses | Asked — user chose the explicit sentence over a terse one-liner and a WARNING-prefixed variant; fields shared with C3's dialog | S:95 R:90 A:95 D:95 |
| 18 | Confident | Relay: close codes 4400 invalid id / 4403 disabled / 4404 not running; binary frames only; 10 s write deadline; 1 MiB read limit; Background-rooted context; client disconnect closes the backend conn (tested) | Plan § Relay discipline; `/ws/terminals` + `state_ws.go` conventions | S:65 R:85 A:80 D:70 |
| 19 | Confident | macOS server-side view-only: relay tracks the RFB handshake and drops client→server types 4/5 after ServerInit when backend is `screen-sharing`; unit-tested on a synthetic stream, not runnable on this VM | Plan risk 5 mitigation names client **and** server side; only the server side is C2's | S:60 R:65 A:50 D:55 |
| 20 | Confident | `rk gui on` with the daemon down: write the setting, print that the daemon will start the GUI on `rk serve -d`, exit 0 | No tmux command may run on a dead rk-daemon socket (the RunJob/StartCodeServer gate); enabling is still the user's intent | S:60 R:85 A:85 D:75 |
| 21 | Confident | `rk gui env` prints `export DISPLAY=:N` and `export RK_GUI_SOCKET=<path>`; exit 1 + `rk gui on` hint when off/not running | Plan: "prints DISPLAY=:N and the socket path for eval"; outputs are not config env inputs (Constitution IV inventory is about inputs) | S:70 R:90 A:70 D:60 |
| 22 | Confident | New memory file `run-kit/gui.md` created at C2 hydrate (backend half); C4 extends it | Plan lists the file under C4, but C2 ships most of the behavior a memory file exists to record | S:50 R:90 A:80 D:65 |

22 assumptions (9 certain, 13 confident, 0 tentative, 0 unresolved).

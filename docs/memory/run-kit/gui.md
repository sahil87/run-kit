---
type: memory
description: "The GUI surface — the gui.enabled switch, the rk gui CLI family (on/off/status/env/restart/exec/shot + hidden supervise), the rk-gui supervisor session (display selection, Xvnc argv, WM ladder, @rk_gui_* stamps), the /ws/gui/{id} RFB relay (close-code gates, view-only filter), the event: gui slot, /api/gui/* routes, the doctor row, internal/gui (probe, apps scan, Assemble), the agent verbs (exec passthrough/--detach, shot ladder), the rk agent setup gui display block, and the rk skill gui topic."
---
# GUI Surface

**Domain**: run-kit

## Overview

The GUI surface exposes the host's desktop as a fourth tile beside `tty`/`code`/`web`. This file covers the backend half plus the agent half: the `gui.enabled` switch, the `rk gui` CLI family (including the agent verbs `rk gui exec`/`shot`), the `rk-gui` supervisor session, the RFB-over-WebSocket relay, the `event: gui` state slot, the `/api/gui/*` routes, the doctor row, the `internal/gui` package, the `rk agent setup` gui display block, and the `rk skill gui` topic page. The frontend tile is a separate surface (design authority: `docs/specs/gui.md` and the plan `fab/plans/sahil/26-09-09-gui-surface.md`). (fkh1) (bbv1)

## The `gui.enabled` switch

`internal/settings` carries the registry key `gui.enabled` — `bool`, default `false`, category `behavior`, `ui: true`, `live: true`, backed by `Settings.GUIEnabled` and placed after `cron_ticker` in the scalar block. The serialized form is the flat dotted YAML line `gui.enabled: true`, omitted when false so an untouched file round-trips byte-identically; the read is a tolerant `strconv.ParseBool` (unparseable keeps the default). There is **no env form** (Constitution IV — env stays `RK_PORT`/`RK_HOST`/`RK_CODE_SERVER_PORT`). Nothing but an explicit user write (`rk gui on`, `POST /api/settings`) sets it true: `Default()` leaves it false, and the daemon boot hook, `rk doctor`, and the probes never write it. Description text: "Turns the GUI surface on: runs the host desktop (rk-gui session) and shows the 4th tile toggle. Off by default; nothing flips it but you." See [configuration](/run-kit/configuration.md) § Settings Registry. (fkh1)

## The `rk gui` CLI family

`cmd/rk/gui.go` — a cobra parent in the `code-server` family's shape (Use/Short/Long with a Subcommands list), all members registered unconditionally on `rootCmd`:

| Verb | Behavior | Exit |
|------|----------|------|
| `rk gui on` | Persist `GUIEnabled=true`; daemon running ⇒ `daemon.EnsureGUI()` and print `started (<bin> :N)` / `already running` / `enabled — no VNC backend installed: <hint>`; daemon down ⇒ `enabled — the daemon starts the GUI on 'rk serve -d'` (no tmux call on a dead socket). Idempotent | 0 in every enabled case; 1 on save/spawn error |
| `rk gui off [--yes]` | Compute the running-apps list for the stamped display; with apps and no `--yes`, print the confirm below and read one line from the tty (non-tty ⇒ refuse `re-run with --yes`, exit 1); on confirm (or `--yes`, or no apps, or macOS) `KillGUISession()`, persist false, print `gui off — rk-gui session killed` (or `gui off`); declining prints `aborted`, exit 1, setting untouched | 0; 1 refused/aborted |
| `rk gui status [--json]` | `gui: off` / `gui: on (<bin>, :N, WxH, k viewers)` / `gui: on — not running (<reason>)`, plus an indented `apps:` line when running; `--json` emits the shared `gui.Status` document | 0 always (state, not verdict) |
| `rk gui env` | Prints `export DISPLAY=:N` and `export RK_GUI_SOCKET='<path>'` (single-quoted — the value is eval'd) for `eval "$(rk gui env)"` when enabled and reachable; otherwise `gui is off — turn it on with 'rk gui on'` or `gui is on but not running — see 'rk gui status'` | 0 / 1 |
| `rk gui restart` | `daemon.RestartGUI()` (kill → ensure); success prints `restarted (<bin> :N)`; refuses when disabled (`gui is off — turn it on with 'rk gui on'`) or the daemon is down | 0 / 1 |
| `rk gui exec <cmd> [args…]` | Run a command on the display (§ Agent verbs): foreground = process-replacing `syscall.Exec` passthrough with `DISPLAY`/`RK_GUI_SOCKET` set; `--detach`/`-d` = `Setsid` session, stdio `/dev/null`, prints `started <pid> on :N`; unknown program ⇒ `error: <cmd>: not found on PATH` | 0; 1 gated/not-found; 2 no command |
| `rk gui shot [--out\|-o <png>]` | Screenshot the display via the tool ladder (§ Agent verbs); stdout carries only the absolute PNG path | 0; 1 gated/no-tool/tool-failure; 2 stray args |
| `rk gui supervise <id> --display :N` | **Hidden** plumbing — the pane command the ensure ladder spawns (§ The `rk-gui` supervisor session). Rejects `id != host` | the backend's fate |

Arg-count violations exit 2 via the family's `usageArgs` re-wrap; plain operational failures exit 1. The off-confirm copy (exact):

```
Turning the GUI off kills the rk-gui session and every app on display :N:
  chromium ×3, xterm ×1  (up 4h 12m)
Continue? [y/N]
```

(fkh1)

## Agent verbs

The agent half of the surface — what lets an agent in a pane put an app on the display, see what is on it, and learn the loop at use-time: two gated `rk gui` verbs, the `rk agent setup` gui display block, and the `rk skill gui` topic page. (bbv1)

**The shared gate** (`gui.go`): `exec` and `shot` refuse before doing anything, in a fixed order (`env` shares only step 2 — it has no macOS refusal and prints its exports on every OS) — (1) macOS ⇒ `guiDarwinRefusal(<verb>)` renders `gui <verb> is not supported on macOS in v1 — the GUI mirrors your live session view-only` (exit 1, before any status read; no X display exists on the mirror backend); (2) `guiRequireReachable(ctx)` over `gatherGUIStatus` ⇒ the named constants `guiErrOff` (`gui is off — turn it on with 'rk gui on'`) and `guiErrNotRunning` (`gui is on but not running — see 'rk gui status'`), exit 1. `guiGOOS` is the OS test seam. No verb ever writes `gui.enabled` — the switch stays the user's.

**`rk gui exec <cmd> [args…]`** (`gui_exec.go`): the env is the caller's `os.Environ()` with `DISPLAY=<st.Display>` and `RK_GUI_SOCKET=<st.Socket>` set by the pure `guiExecEnv` (an existing `DISPLAY`/`RK_GUI_SOCKET` entry is replaced, never duplicated — the rk display is the point of the verb; cwd inherited; no `XAUTHORITY`). Foreground (default) resolves the program with `exec.LookPath` and replaces the process via `syscall.Exec` behind the `guiExecFn` seam — the `rk mux guard` passthrough idiom: no timeout, no relay code, the command owns the tty, signals, and exit status. A `LookPath` failure prints `error: <cmd>: not found on PATH`, exit 1. `--detach`/`-d` instead starts the command as its own session (`SysProcAttr{Setsid: true}`, stdin/stdout/stderr on `/dev/null`, never waited on — the `guiExecStartFn` seam) and prints `started <pid> on :N` (Dataf, exit 0); a start failure is `error: <cmd>: <reason>`, exit 1. A missing command word is a usage error (exit 2, the family's `usageArgs` re-wrap); a literal `--` ends flag parsing so dash-prefixed program args pass through.

**`rk gui shot [--out|-o <png>]`** (`gui_shot.go`): same gate (the darwin message names `shot`). The screenshot runs through the first tool on PATH in a fixed ladder resolved by the pure `guiShotArgv(lookPath, display, out)`: (1) `import -display :N -window root <out>`; (2) `scrot <out>` with `DISPLAY=:N` in its env (scrot has no display flag); (3) `xwd -display :N -root -silent` piped in Go into `convert xwd:- <out>` (both must be present — an xwd-only host falls through). Every stage runs under `exec.CommandContext` bounded by `guiShotTimeout` (15 s). No tool ⇒ `no screenshot tool found (tried import, scrot, xwd+convert) — sudo apt install imagemagick`; a tool failure ⇒ `error: <tool> failed: <stderr tail>`; both exit 1. Default output is `<os.TempDir()>/rk-gui-shot-<YYYYMMDD-HHMMSS>.png` (clock seam `guiShotNowFn`); `--out` is made absolute, its parent created with `MkdirAll` 0755, an existing file overwritten. Success prints only the absolute PNG path (Dataf — survives `--quiet`); diagnostics ride stderr; exit 0.

**The `rk gui display` shell block** (installed by `rk agent setup` — see [agent-state](/run-kit/agent-state.md) § `rk agent setup`): a marker-owned block (`guiDisplayBlockBegin`/`guiDisplayBlockEnd` = `# >>> rk gui display >>>` / `# <<< rk gui display <<<`) upserted via the shared `upsertMarkerBlock`/`removeMarkerBlock` machinery into the same startup-file set as the tmux guard PATH block (`tmuxGuardStartupFiles(home, zdotdir)` — see [tmux-guard-shim](/run-kit/tmux-guard-shim.md)), with the same per-file tolerant read, malformed-block refusal, in-position replacement, consent/diff/dry-run flow, and absent-is-silent uninstall. Exact body (`<abs-rk>` is the `resolveRkPath`/`validateHookPath`-validated absolute binary path, embedded double-quoted):

```sh
# >>> rk gui display >>>
[ -n "$TMUX_PANE" ] && [ -z "${DISPLAY-}" ] && eval "$("<abs-rk>" gui env 2>/dev/null)"
# <<< rk gui display <<<
```

The three guards are load-bearing: `$TMUX_PANE` scopes the eval to tmux panes (the same gate the installed agent hooks use); `[ -z "${DISPLAY-}" ]` never overrides a pre-set `DISPLAY` (a desktop X session, SSH X-forwarding) and skips the exec in nested shells; `2>/dev/null` keeps an off or unreachable GUI silent — `rk gui env` then prints nothing to stdout and exits 1, so the eval is a no-op: the block is **inert while off** and starts working the moment someone runs `rk gui on`, with no re-setup. The block is installed regardless of `gui.enabled`, and unlike the PATH block it does not gate on the shim being in place (it embeds the rk path directly and fronts nothing). `DISPLAY` lands in **new** shells — a shell started before `rk gui on` needs `eval "$(rk gui env)"` or `rk gui exec` per command. Cost per shell start with the GUI off: one settings-file read (the assembler's disabled short-circuit, no tmux call), which matters because `.zshenv` runs for every non-interactive `zsh -c` an agent's Bash tool spawns.

**`rk skill gui`** — the topic page (canonical `docs/site/skill/gui.md`, ≤150 lines, synced to the embedded copy `cmd/rk/skill/gui.md` by `scripts/sync-skill.sh`, drift-guarded and line-budgeted by the shared `skill_test.go` tables, registered as `skillTopics["gui"]` so the `Topics:` help line and `rk skill topics` enumerate it): gate first (`rk gui status`; never run `rk gui on` yourself — the switch is the user's), `rk gui env` vs the installed block, `exec` (foreground vs `--detach`, `--` for dash-args), `shot` (default path, `--out`, read the PNG to look), the screenshot loop with `xdotool`, output/exit-code contracts, and gotchas (macOS view-only refusals; `DISPLAY` lands in new shells; the display is shared with the human; apps die on `rk gui off`; no tools are installed for you). The `rk gui --help` `Subcommands:` list carries the `exec`/`shot` rows, and `rk gui env --help` points at the installed block.

## The `rk-gui` supervisor session

The host desktop runs as the `rk-gui` sibling session (single window `host`) on the `rk-daemon` socket — the `rk-code-server` precedent: it shares the socket, not the daemon session's lifecycle, so it survives `rk serve` exits and `daemon stop`. The tmux half lives in `internal/daemon/gui.go` (constants `GUISessionName`/`GUIWindowName`; seams `guiSessionExists`/`guiSpawn`/`guiKillRun`/`guiSelfPath`/`guiLookPath`/`guiFreeDisplay`/`guiSocketExists`/`guiGOOS`/`guiSessionOption`/`guiSessionCreated`/`guiPanePID`); see [daemon-lifecycle](/run-kit/daemon-lifecycle.md). (fkh1)

**Ensure ladder** (`ensureGUICore(cli bool)`, outcome enum `GUIEnsureDisabled`/`GUIEnsureAlreadyRunning`/`GUIEnsureNoBackend`/`GUIEnsureStateDirFailed`/`GUIEnsureStarted`), fixed skip order:

1. `!settings.Load().GUIEnabled` ⇒ disabled (the daemon boot hook `ensureGUI()` — called from `startSession` right after `ensureCodeServer()` — returns here silently).
2. The `rk-gui` session exists ⇒ already-running skip (a dead-backend session still "exists" — the stay-idle exit semantics below; `restart` is the recovery verb).
3. Linux with neither `Xtigervnc` nor `Xvnc` on PATH ⇒ `GUIEnsureNoBackend` — the daemon logs the install hint and continues; the CLI prints it and still enables (`install a VNC X server and a window manager: sudo apt install tigervnc-standalone-server openbox`). macOS is never no-backend (nothing to spawn).
4. State dir not creatable or socket path over `maxSocketPathBytes = 100` bytes (the unix `sun_path` cap) ⇒ `GUIEnsureStateDirFailed`.
5. Spawn: `gui.FreeDisplay` picks the lowest free display `:N` in `:10`–`:99` (free ⇔ neither `/tmp/.X{N}-lock` nor `/tmp/.X11-unix/X{N}` exists), then `tmux new-session -d -s rk-gui -n host <rk-exe> gui supervise host --display :N` via `runTmux` on the daemon socket, `<rk-exe>` from `selfpath.Resolve` (the code-server `RK_BIN` precedent).

`EnsureGUI()` (the CLI/API posture) refuses with an operational error naming `rk serve -d` when `jobDaemonRunning` is false. `KillGUISession()` is the release-synchronous kill primitive: exact-match `kill-session -t =rk-gui` (audit-logged), an absent session is `(false, nil)` success, and after a real kill it waits — bounded by `guiSocketFreeTimeout = 5s` polled at `guiSocketFreePoll = 200ms`, expiry non-fatal — until `host.sock` disappears, so an `off`→`on` composition never sees the dying socket. `RestartGUI()` is kill then `ensureGUICore(true)`, refusing when disabled.

**`rk gui supervise host --display :N`** (Linux) — the pane command; its stdout/stderr IS the supervisor log:

1. `MkdirAll(StateDir, 0700)`; remove a stale `host.sock`.
2. Exec the backend with `exec.CommandContext` argv, stdout/stderr inherited:
   `Xtigervnc :N -rfbunixpath <StateDir>/host.sock -rfbport -1 -SecurityTypes None -AlwaysShared -AcceptSetDesktopSize -geometry 1920x1080 -FrameRate=60 -desktop run-kit`
   Binary resolution is **by name `Xtigervnc` first, `Xvnc` only when `Xtigervnc` is absent** (the KasmVNC deb hijacks `Xvnc` via `update-alternatives`); `-rfbport -1` is mandatory (without it TigerVNC still binds TCP 5900+N on all interfaces).
3. Wait ≤ 5 s for the socket (`guiSocketWaitTimeout`/`guiSocketWaitPoll` 5 s/200 ms), `chmod 0600` it, log `gui: <bin> up on :N (socket <path>)`. Stamp `@rk_gui_display :N` and `@rk_gui_backend <bin>` on the `rk-gui` session via `tmux -L rk-daemon set-option -t =rk-gui …` (best-effort, 5 s bound) — the `@rk_*` per-entity state home ([tmux-sessions](/run-kit/tmux-sessions.md) § Server-Scoped User Options); readers are `rk gui status`/`env`, the state probe, and `gui.Assemble`.
4. Launch the first WM found in the ladder `openbox → xfwm4 → i3 → kwin_x11 → x-session-manager` with `DISPLAY=:N` in its env, `x-session-manager` wrapped as `dbus-run-session -- x-session-manager`; none found ⇒ log `gui: no window manager found (tried openbox, xfwm4, i3, kwin_x11, x-session-manager); running bare — apt install openbox` and continue (a bare X display is still usable).
5. Trap SIGTERM/SIGINT/SIGHUP (`signal.NotifyContext`): kill the WM, remove the socket, reap the backend, exit 0.
6. **Stay-idle exit semantics**: when the backend exits on its own, log `gui: <bin> exited (status N) — display :N is down; run 'rk gui restart' or turn the GUI off`, kill the WM, remove the socket, and block until a signal arrives (no auto-respawn, no process exit) — the pane remains readable and the session still exists, so ensure skips it while status and the stream report not-running until `rk gui restart` / `POST /api/gui/host/restart` / `rk gui off`.

**macOS** (`GOOS=darwin`): supervise spawns nothing — it stamps `@rk_gui_backend screen-sharing` and logs the Screen Sharing dial result (`127.0.0.1:5900`) once a minute (`Screen Sharing: reachable on 127.0.0.1:5900` / `Screen Sharing: not reachable — enable System Settings › General › Sharing › Screen Sharing`), exiting 0 on signal. Backend detection reports `screen-sharing` and never `GUIEnsureNoBackend`.

**Running-apps list** (Linux): `gui.RunningApps` scans `/proc/[0-9]*/environ` for `DISPLAY=:N`, excludes the supervisor's own process tree (`daemon.GUIPanePids` → `gui.ProcessTreePids` — the backend, the WM, and supervise itself carry the display in their env), groups by `comm` into `{Name, Count}` sorted count-desc then name; per-pid errors are skipped. macOS: always empty (nothing runs under rk's control). Uptime derives from the `rk-gui` session's `session_created` via `daemon.GUISessionCreated`.

## The `/ws/gui/{id}` relay

`api/gui_ws.go`, registered beside `/ws/terminals`; errors ride WS close frames so noVNC gets a reason (the `/ws/terminals` posture):

1. `validate.ValidateGUIID(id)` fails ⇒ upgrade then close **4400** `invalid gui id`.
2. `!settings.Load().GUIEnabled` ⇒ close **4403** `gui disabled`.
3. Dial the backend (`gui.BackendAddr("host")`: Linux `unix` `<StateDir>/host.sock`, macOS `tcp` `127.0.0.1:5900`; `guiDialTimeout = 2s`); failure ⇒ close **4404** `gui not running: <reason>`.
4. Pipe **binary frames only**: WS→backend writes each binary message to the conn; backend→WS reads up to `guiBackendReadChunk = 64 KiB` and writes `BinaryMessage` with a 10 s write deadline (`terminalsWriteWait`). Text frames are ignored (forward-compat); `guiReadLimit = 1 MiB` bounds inbound frames.
5. The lifecycle context roots at `context.Background()` (not `r.Context()` — the hijack rule from `state_ws.go`); either side's read error cancels it and closes **both** conns — a client disconnect yields EOF on the backend conn within a second (no orphaned sockets). Viewer accounting: `hub.guiViewerAdd(id)` on a successful dial, deferred `guiViewerRemove(id)` on teardown — the payload's `viewers`.
6. **macOS view-only filter** (`api/gui_filter.go`): when the backend network is `tcp` (screen-sharing) the relay tracks the RFB 3.8 handshake (ProtocolVersion, security negotiation incl. the ARD type-30 DH exchange, SecurityResult, ClientInit, ServerInit) and afterwards drops client→server messages of type 4 (KeyEvent, 8 bytes) and 5 (PointerEvent, 6 bytes), forwarding everything else (ClientCutText capped at `guiFilterMaxCutText = 16 MiB`; unknown types forwarded raw). On the `unix` backend the filter is inert pass-through.

## The `event: gui` state slot

`api/sse.go`, mirroring `event: code-server` ([api-and-sockets](/run-kit/api-and-sockets.md) § `event: code-server`): hub fields `guiEnabled`, `guiProbeAt`, `guiInfo`, `guiBackend`, `guiDisplay`, `guiViewers map[string]int`, `cachedGuiJSON`. `guiTick()` runs every poll tick: it re-reads `settings.Load().GUIEnabled` (so a CLI-side `rk gui on` shows up without a POST; a flip zeroes the probe age) and, when enabled and the probe is older than `guiProbeTTL = 5s`, reads `@rk_gui_display`/`@rk_gui_backend` from the `rk-gui` session via the `guiSessionOptionsFn` seam (absent session or unparsable display ⇒ `reachable:false`, reason `session absent`) and runs `gui.Probe` — **skipping the dial while `guiViewers[id] > 0`** (reachable follows from the live relay; last geometry retained — keeps Xvnc's per-connection log lines out of the supervisor pane while someone is watching). The payload is always a list (`[]gui.StreamEntry` — `id, enabled, backend, reachable, display, width, height, viewers`), e.g. `[{"id":"host","enabled":true,"backend":"Xtigervnc","reachable":true,"display":":10","width":1920,"height":1080,"viewers":1}]`; disabled renders the all-zero entry. Broadcast as `hubEvent{kind: kindGlobal, typ: "gui"}` every tick (client raw-payload dedup absorbs the repetition) and replayed to late joiners from `cachedGuiJSON` in `replayGlobalSlots` beside the code-server slot. `setGUIEnabled(bool)` is the POST-side apply seam: it flips `guiEnabled`, zeroes the probe age, re-renders, and broadcasts immediately — the settings POST flips `enabled` within one state event.

**The RFB probe** (`gui.Probe(ctx, network, addr)`): 500 ms dial timeout, 2 s per-read deadline; reads the 12-byte `RFB 003.008\n` banner and, for `network == "unix"` (Linux), completes the minimal 3.8 handshake — reply banner, select security type 1 (None), read SecurityResult, send `ClientInit shared=1`, read `ServerInit` for width/height — then closes, returning `Info{Reachable:true, Width, Height}`. For `tcp` (macOS) it stops after the banner (auth needs the Keychain password; reachability is the dial + banner) with zero geometry. Failures classify into `Reason`: `not running` (ECONNREFUSED/ENOENT), `dial failed: …`, `bad banner`.

## HTTP routes and the settings-POST side effect

Registered in `api/router.go` beside `/api/settings` (mutations POST-only, Constitution IX — the family is exactly `/ws/gui/*` + `/api/gui/*`):

- `GET /api/gui/{id}` → the shared `gui.Status` document (`id, enabled, backend, reachable, display, width, height, viewers, socket, session, reason, apps[], uptime_seconds`), built by `gui.Assemble` under a 10 s bound with the viewer count from the hub; 400 on an invalid id. This is the same document `rk gui status --json` emits — the off-confirm dialog renders from its `apps` field.
- `POST /api/gui/{id}/restart` → `daemon.RestartGUI()`; 400 on an invalid id, 409 `{"error":"gui disabled"}` when off, 200 `{"status":"ok"}` on success, 500 with the error text on failure — the empty state's "Restart supervisor" action.
- `POST /api/settings` carrying `gui.enabled` (set or `null`-unset): after `Save`, true ⇒ the `guiEnsure` seam (production `daemon.EnsureGUI`) best-effort (a failure logs a warning, the response stays 200 — the stream's `reachable:false` + `reason` is the user-visible outcome), false ⇒ the `guiKill` seam (production `daemon.KillGUISession`); both then `sseHub.setGUIEnabled(v)`. The confirm happens client-side before the POST. See [configuration](/run-kit/configuration.md) § Settings HTTP API.

**The shared status assembler** — `gui.Assemble(ctx, StatusDeps) Status` owns the status derivation once for both `rk gui status` and `GET /api/gui/{id}` over injected seams (`ID, Enabled, DaemonRunning, SessionExists, SessionOptions, SessionCreated, PanePids, Probe, RunningApps, LookPath, Viewers, Now`), in the order disabled short-circuit → daemon gate → session existence → stamped display/backend + uptime → probe → reason → apps (apps only when reachable).

## Doctor row

`cmd/rk/doctor.go` `guiCheck(...)` runs after the code-bridge row, always `OK: true` (state, not verdict), pure over injected seams with all tmux reads gated on the daemon running. The six Notes: `off`; `on (<bin>, :N, WxH, k viewers)` (the **resolved binary name**); and `on — not running (<reason>)` with reasons from `gui.NotRunningReason` — `rk-gui session absent; the daemon starts it on 'rk daemon start'`, `no VNC backend: sudo apt install tigervnc-standalone-server openbox`, `<bin> exited — see the rk-gui pane; 'rk gui restart'`, and `Screen Sharing is off: System Settings › General › Sharing › Screen Sharing`.

## Validation

`validate.ValidateGUIID(id string) string` returns `""` for exactly `"host"` and ``gui id must be "host"`` otherwise — the path and payload stay list-shaped so a second id lands at the validator later. Used by the relay, both `/api/gui` routes, and `rk gui supervise`.

## Requirements

### Requirement: Never on by default
No code path other than an explicit user write (`rk gui on`, `POST /api/settings`) SHALL set `GUIEnabled` true. `Default()` MUST leave it false; the daemon boot hook, `rk doctor`, backend probes, and installs MUST never write it.

#### Scenario: Fresh config starts nothing
- **GIVEN** a host with `Xtigervnc` on PATH and a fresh config dir
- **WHEN** the daemon starts and `rk doctor` runs
- **THEN** `GUIEnabled` remains false, no `rk-gui` tmux command is issued, and the doctor row reads `gui: off`

### Requirement: The relay is the only door to the RFB stream
The backend MUST listen on the unix socket only — `-rfbport -1` is part of every spawned argv so nothing binds TCP — and clients MUST reach the stream through `/ws/gui/{id}` over rk's own origin.

#### Scenario: Disabled gate rides a close frame
- **GIVEN** `GUIEnabled=false` and a WS client connecting to `/ws/gui/host`
- **WHEN** the upgrade completes
- **THEN** the client observes close code 4403 `gui disabled`; with no listener the code is 4404; with id `nope`, 4400

### Requirement: Backend exit leaves a readable pane
When the backend process exits on its own, the supervisor MUST log the exit line, kill the WM, remove the socket, and stay alive idle — no auto-respawn, no process exit — so the session still exists and recovery is `rk gui restart` / `POST /api/gui/host/restart`.

#### Scenario: External backend kill
- **GIVEN** a running supervisor
- **WHEN** the backend is killed externally
- **THEN** the pane shows the exit line, `host.sock` is gone, the stream reports `reachable:false`, and `rk gui status` reads `on — not running (<bin> exited …)` until `rk gui restart`

### Requirement: The macOS backend is view-only
On `GOOS=darwin` the supervisor SHALL spawn nothing (the Screen Sharing mirror is probed, never driven), and the relay MUST drop client→server KeyEvent (type 4) and PointerEvent (type 5) messages after the RFB handshake when the backend is `screen-sharing`.

### Requirement: Agent verbs never flip the switch
No agent-facing verb (`exec`, `shot`, `env`) SHALL write `gui.enabled`; a gated refusal exits 1 with the shared hint and starts no process and writes no file. The switch remains the user's alone — the "Never on by default" rule extended to the agent surface. (bbv1)

#### Scenario: Off means a refusal, never a flip
- **GIVEN** `gui.enabled=false`
- **WHEN** `rk gui exec xterm` or `rk gui shot` runs
- **THEN** stderr carries `gui is off — turn it on with 'rk gui on'`, the exit code is 1, no process is started, no file is written, and the setting is untouched

### Requirement: One gate, one hint vocabulary
Every verb that acts on the live display (`exec`, `shot`) SHALL apply the same gate — the macOS refusal first, then enabled, then reachable — and `env` SHALL apply the enabled/reachable half, all through the shared `guiDarwinRefusal`/`guiRequireReachable` helpers and the named `guiErrOff`/`guiErrNotRunning` constants, so `env`, `exec`, and `shot` print byte-identical refusals for the same state. (bbv1)

#### Scenario: Identical refusals across verbs
- **GIVEN** the GUI enabled but the backend dead
- **WHEN** `rk gui env`, `rk gui exec xterm`, and `rk gui shot` each run
- **THEN** all three print `gui is on but not running — see 'rk gui status'` and exit 1

## Design Decisions

### Tmux half in `internal/daemon`, pure half in `internal/gui`
**Decision**: session ensure/kill/restart live in `internal/daemon/gui.go` beside `codeserver.go`; everything that does not touch tmux (paths, argv, probe, apps scan, status document, the shared `Assemble`) lives in the new `internal/gui`.
**Why**: the daemon boot hook must call ensure, so `daemon → gui` is the only cycle-free import direction; the daemon package already owns `runTmux`, `sessionExistsCtx`, `jobDaemonRunning`.
**Rejected**: a self-contained `internal/gui` with its own tmux runner — duplicates the seams and re-creates the dead-socket-births-a-server hazard the daemon gates prevent.
*Introduced by*: 260909-fkh1-gui-backend-switch-and-relay

### Supervisor stays idle after a backend exit
**Decision**: on backend exit the supervisor cleans up and blocks until signalled; recovery is `rk gui restart` / `POST /api/gui/host/restart`.
**Why**: the pane is the supervisor log and must show the exit; a live session with a dead backend maps cleanly onto "enabled but unreachable"; no supervisor loop (Constitution VI spirit). Confirmed with the user at intake.
**Rejected**: auto-respawn with backoff (masks a broken install with restart spam); exit the pane (loses the log; session-absent conflates "never started" with "crashed").
*Introduced by*: 260909-fkh1-gui-backend-switch-and-relay

### Hub re-reads the settings file per tick; POST flips synchronously
**Decision**: `guiTick` calls `settings.Load()` every tick and `setGUIEnabled` is the POST-side synchronous seam.
**Why**: `rk gui on` writes the file directly (the code-server CLI precedent), so the hub cannot learn about it any other way; the POST path still needs the one-state-event flip the tile relies on.
**Rejected**: routing the CLI through the HTTP API (fails when the daemon is down, which is exactly when a user first runs `rk gui on`).
*Introduced by*: 260909-fkh1-gui-backend-switch-and-relay

### Probe skips the dial while a relay viewer is live
**Decision**: `guiTick` treats `guiViewers[id] > 0` as `reachable:true` and does not dial.
**Why**: every dial writes accept/close lines into Xvnc's log — the supervisor pane — every 5 s; a live relay is stronger evidence than a probe anyway.
**Rejected**: lowering Xvnc's log level (hides real connection events too).
*Introduced by*: 260909-fkh1-gui-backend-switch-and-relay

### `Xtigervnc` by name, `Xvnc` fallback, `-rfbport -1` always
**Decision**: backend resolution prefers the `Xtigervnc` binary name; `Xvnc` is used only when absent; `-rfbport -1` is part of the fixed argv.
**Why**: the KasmVNC deb hijacks `Xvnc` via `update-alternatives`, and TigerVNC binds TCP 5900+N unless told not to, which would falsify "VNC never on TCP".
**Rejected**: `Xvnc` alone — proven ambiguous on a host with Kasm installed.
*Introduced by*: 260909-fkh1-gui-backend-switch-and-relay

### DISPLAY reaches panes through a shell-startup block that evals `rk gui env`
**Decision**: `rk agent setup` installs a marker-owned block into the guard PATH block's startup files whose body is `[ -n "$TMUX_PANE" ] && [ -z "${DISPLAY-}" ] && eval "$("<abs-rk>" gui env 2>/dev/null)"`; the block is installed regardless of `gui.enabled`.
**Why**: Constitution X — the display is derivable from the supervisor's `@rk_gui_display` stamp, so panes read it at shell start rather than receive a pushed copy; `rk gui env` already is that read and its disabled path costs one settings-file read, so the block is inert and cheap while off and needs no re-setup when the GUI is turned on later.
**Rejected**: `tmux set-environment -g DISPLAY` on `rk gui on` (a second source of truth swept across every server and unset on `off`); exporting from agent hooks (subprocesses cannot set a shell's env, and hooks carry only the underivable).
*Introduced by*: 260909-bbv1-gui-agent-verbs

### Foreground `exec` is a process-replacing passthrough
**Decision**: `rk gui exec <cmd…>` resolves the command and `syscall.Exec`s it with the display env; no wait, no timeout, the child's exit status is the caller's.
**Why**: a GUI application runs until the user closes it, so a wait-timeout would be wrong; replacing the process hands the tty and signals to the command with no relay code — the `rk mux guard` passthrough precedent. Constitution I's timeout rule governs subprocesses rk waits on.
**Rejected**: `cmd.Run()` with a relay of the exit code (adds a signal-forwarding layer for no benefit); a bounded run (kills the app the agent just launched).
*Introduced by*: 260909-bbv1-gui-agent-verbs

### `--detach` for agent launchers
**Decision**: `rk gui exec --detach` starts the command as its own session with stdio on `/dev/null`, prints `started <pid> on :N`, and returns.
**Why**: agents' Bash tools time out on a foreground chromium; the launch-then-screenshot loop needs a launcher that returns. `Setsid` keeps the app alive when the agent's shell exits.
**Rejected**: leaving it to `nohup … &` (works, but every agent re-derives the incantation, and the output line gives the pid for a later kill).
*Introduced by*: 260909-bbv1-gui-agent-verbs

### Screenshots default to the OS temp dir, stdout carries only the path
**Decision**: `rk gui shot` writes `<TempDir>/rk-gui-shot-<ts>.png` unless `--out` is given and prints only the absolute path.
**Why**: never litters the agent's cwd (usually a repo); the state dir under `$XDG_STATE_HOME` is reserved for rk-owned droppable files and screenshots accumulate without GC; the `rk present` prints-only-the-datum idiom lets an agent pipe the path straight into a file read.
**Rejected**: cwd default (repo litter); state-dir default (unbounded growth in a tenant with no GC); PNG on stdout (agents read images by path).
*Introduced by*: 260909-bbv1-gui-agent-verbs

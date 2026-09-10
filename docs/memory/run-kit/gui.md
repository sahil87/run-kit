---
type: memory
description: "The GUI surface — the gui.enabled switch and gui.wm pin, the rk gui family (on/off/status/env/restart/exec/shot/launch/supervise), the rk-gui supervisor (display pick, Xvnc argv, icewm-first WM ladder, seeded IceWM profile, root background, @rk_gui_* stamps), the allowlisted launcher (rk gui launch + POST /api/gui/{id}/launch), the /ws/gui RFB relay, the event: gui slot, /api/gui/* routes, doctor row, internal/gui, the agent-setup display block, rk skill gui, and the C5/C6 smoothness verdicts."
---
# GUI Surface

**Domain**: run-kit

## Overview

The GUI surface exposes the host's desktop as a fourth tile beside `tty`/`code`/`web`. This file covers the backend half plus the agent half: the `gui.enabled` switch and `gui.wm` pin, the `rk gui` CLI family (including the agent verbs `rk gui exec`/`shot` and the allowlisted launcher `rk gui launch`), the `rk-gui` supervisor session, the RFB-over-WebSocket relay, the `event: gui` state slot, the `/api/gui/*` routes, the doctor row, the `internal/gui` package, the `rk agent setup` gui display block, and the `rk skill gui` topic page. The frontend tile is a separate surface (design authority: `docs/specs/gui.md` and the plan `fab/plans/sahil/26-09-09-gui-surface.md`). (fkh1) (bbv1) (2jl3)

## The `gui.enabled` switch

`internal/settings` carries the registry key `gui.enabled` — `bool`, default `false`, category `behavior`, `ui: true`, `live: true`, backed by `Settings.GUIEnabled` and placed after `cron_ticker` in the scalar block. The serialized form is the flat dotted YAML line `gui.enabled: true`, omitted when false so an untouched file round-trips byte-identically; the read is a tolerant `strconv.ParseBool` (unparseable keeps the default). There is **no env form** (Constitution IV — env stays `RK_PORT`/`RK_HOST`/`RK_CODE_SERVER_PORT`). Nothing but an explicit user write (`rk gui on`, `POST /api/settings`) sets it true: `Default()` leaves it false, and the daemon boot hook, `rk doctor`, and the probes never write it. Description text: "Turns the GUI surface on: runs the host desktop (rk-gui session) and shows the 4th tile toggle. Off by default; nothing flips it but you." See [configuration](/run-kit/configuration.md) § Settings Registry. (fkh1)

## The `rk gui` CLI family

`cmd/rk/gui.go` — a cobra parent in the `code-server` family's shape (Use/Short/Long with a Subcommands list), all members registered unconditionally on `rootCmd`:

| Verb | Behavior | Exit |
|------|----------|------|
| `rk gui on` | Persist `GUIEnabled=true`; daemon running ⇒ `daemon.EnsureGUI()` and print `started (<bin> :N)` / `already running` / `enabled — no VNC backend installed: <hint>` (the package-manager-aware `gui.InstallHint` — apt names `tigervnc-standalone-server icewm`); after a started/restarted datum the WM chatter follows on stderr (two-space `Notef`): `  window manager: <wm>`, or when bare `  no window manager — running bare. Install one: <WMInstallHint>` + `  then: rk gui restart`. Daemon down ⇒ `enabled — the daemon starts the GUI on 'rk serve -d'` (no tmux call on a dead socket). Idempotent | 0 in every enabled case; 1 on save/spawn error |
| `rk gui off [--yes]` | Compute the running-apps list for the stamped display; with apps and no `--yes`, print the confirm below and read one line from the tty (non-tty ⇒ refuse `re-run with --yes`, exit 1); on confirm (or `--yes`, or no apps, or macOS) `KillGUISession()`, persist false, print `gui off — rk-gui session killed` (or `gui off`); declining prints `aborted`, exit 1, setting untouched | 0; 1 refused/aborted |
| `rk gui status [--json]` | `gui: off` / `gui: on (<bin>, :N, WxH, k viewer(s), <wm>)` (viewers pluralize at 1; a bare display renders `no window manager` with no hint) / `gui: on — not running (<reason>)`, plus an indented `apps:` line when running; `--json` emits the shared `gui.Status` document (which carries `wm` always and `wm_hint,omitempty` when enabled + reachable + bare) | 0 always (state, not verdict) |
| `rk gui env` | Prints `export DISPLAY=:N` and `export RK_GUI_SOCKET='<path>'` (single-quoted — the value is eval'd) for `eval "$(rk gui env)"` when enabled and reachable; otherwise `gui is off — turn it on with 'rk gui on'` or `gui is on but not running — see 'rk gui status'` | 0 / 1 |
| `rk gui restart` | `daemon.RestartGUI()` (kill → ensure); success prints `restarted (<bin> :N)` plus the same WM chatter lines as `on`; refuses when disabled (`gui is off — turn it on with 'rk gui on'`) or the daemon is down | 0 / 1 |
| `rk gui exec <cmd> [args…]` | Run a command on the display (§ Agent verbs): foreground = process-replacing `syscall.Exec` passthrough with `DISPLAY`/`RK_GUI_SOCKET` set; `--detach`/`-d` = `Setsid` session, stdio `/dev/null`, prints `started <pid> on :N`; unknown program ⇒ `error: <cmd>: not found on PATH` | 0; 1 gated/not-found; 2 no command |
| `rk gui shot [--out\|-o <png>]` | Screenshot the display via the tool ladder (§ Agent verbs); stdout carries only the absolute PNG path | 0; 1 gated/no-tool/tool-failure; 2 stray args |
| `rk gui launch <terminal\|browser>` | The allowlisted launcher (§ The launcher below): resolves the role through `gui.ResolveApp`'s fixed ladder (`guiStatFn`/`guiLookPathFn` seams), starts the resolved binary detached (`guiLaunchStartFn` over `gui.StartDetached`) with `gui.LaunchEnv(os.Environ(), st.Display, st.Socket)`, prints `started <name> (pid <pid>) on :N`; a ladder miss prints `gui.LaunchHint` and exits 1; a bad role is usage | 0; 1 gated/ladder-miss/start-failure; 2 bad role |
| `rk gui supervise <id> --display :N` | **Hidden** plumbing — the pane command the ensure ladder spawns (§ The `rk-gui` supervisor session). Rejects `id != host` | the backend's fate |

Arg-count violations exit 2 via the family's `usageArgs` re-wrap; plain operational failures exit 1. The off-confirm copy (exact):

```
Turning the GUI off kills the rk-gui session and every app on display :N:
  chromium ×3, xterm ×1  (up 4h 12m)
Continue? [y/N]
```

(fkh1) (2jl3)

## The launcher (`rk gui launch` + `POST /api/gui/{id}/launch`)

One allowlisted launcher (`internal/gui/launch.go`) serves the CLI verb, the HTTP endpoint, and the seeded IceWM toolbar/menu rows: the caller names a **role** — `AppTerminal` (`terminal`) or `AppBrowser` (`browser`), `ParseAppRole` accepts exactly those two (anything else is `app must be terminal or browser`) — and the server resolves the binary through a fixed per-role ladder, first `lookPath` hit whose **resolved path also stats** wins (a dangling Debian alternative — `/usr/bin/x-www-browser → <missing>` — is skipped): terminal `x-terminal-emulator, xterm, uxterm, lxterm, foot, alacritty, kitty, gnome-terminal, xfce4-terminal`; browser `chromium, chromium-browser, google-chrome, google-chrome-stable, firefox, x-www-browser`. A whole-ladder miss yields the package-manager-aware `LaunchHint(role, lookPath)` (`no browser on the GUI host — sudo apt install chromium-browser`; dnf/pacman name `chromium`/`xterm`; no manager ⇒ `install a <role> with your package manager`) — wording only, rk never runs a package manager. The start is `StartDetached` (Setsid, stdio on `/dev/null`, never waited) with `LaunchEnv` (the caller's environ with `DISPLAY`/`RK_GUI_SOCKET` set — replaced, never duplicated); `gui_exec.go`'s env/detach helpers delegate to these two, so the primitive exists once. The HTTP twin (`api/gui.go` `handleGuiLaunch`, seams `guiStatFn`/`guiLaunchFn` beside `guiLookPath`) returns: 400 on an invalid id or bad body/app, 409 `gui disabled` / 409 `gui is on but not running — see 'rk gui status'`, **200 `{"ok":false,"app":…,"hint":…}` on a ladder miss** (the frontend toasts the hint through the success path — the client throws on non-2xx), 500 `<name>: <reason>` on a start failure, 200 `{"ok":true,"app":…,"argv0":…,"pid":…}` on success. The body carries a role, never argv — no arbitrary command over HTTP (`exec` stays CLI-only). The palette's `GUI: Open terminal` / `GUI: Open browser` rows are the HTTP twin's frontend consumer — they POST through the client's `launchGuiApp` and toast a ladder-miss `hint` verbatim, with no toast on success ([keyboard-and-palette](/run-kit/ui/keyboard-and-palette.md) § The `GUI:` palette family). (2jl3) (vu4p)

## Agent verbs

The agent half of the surface — what lets an agent in a pane put an app on the display, see what is on it, and learn the loop at use-time: three gated `rk gui` verbs, the `rk agent setup` gui display block, and the `rk skill gui` topic page. (bbv1)

**The shared gate** (`gui.go`): `exec`, `shot`, and `launch` refuse before doing anything, in a fixed order (`env` shares only step 2 — it has no macOS refusal and prints its exports on every OS) — (1) macOS ⇒ `guiDarwinRefusal(<verb>)` renders `gui <verb> is not supported on macOS in v1 — the GUI mirrors your live session view-only` (exit 1, before any status read; no X display exists on the mirror backend); (2) `guiRequireReachable(ctx)` over `gatherGUIStatus` ⇒ the named constants `guiErrOff` (`gui is off — turn it on with 'rk gui on'`) and `guiErrNotRunning` (`gui is on but not running — see 'rk gui status'`), exit 1. `guiGOOS` is the OS test seam. No verb ever writes `gui.enabled` — the switch stays the user's.

**`rk gui exec <cmd> [args…]`** (`gui_exec.go`): the env is the caller's `os.Environ()` with `DISPLAY=<st.Display>` and `RK_GUI_SOCKET=<st.Socket>` set by `guiExecEnv` (a thin delegation to `gui.LaunchEnv` — an existing `DISPLAY`/`RK_GUI_SOCKET` entry is replaced, never duplicated — the rk display is the point of the verb; cwd inherited; no `XAUTHORITY`). Foreground (default) resolves the program with `exec.LookPath` and replaces the process via `syscall.Exec` behind the `guiExecFn` seam — the `rk mux guard` passthrough idiom: no timeout, no relay code, the command owns the tty, signals, and exit status. A `LookPath` failure prints `error: <cmd>: not found on PATH`, exit 1. `--detach`/`-d` instead starts the command as its own session (`SysProcAttr{Setsid: true}`, stdin/stdout/stderr on `/dev/null`, never waited on — the `guiExecStartFn` seam) and prints `started <pid> on :N` (Dataf, exit 0); a start failure is `error: <cmd>: <reason>`, exit 1. A missing command word is a usage error (exit 2, the family's `usageArgs` re-wrap); a literal `--` ends flag parsing so dash-prefixed program args pass through.

**`rk gui shot [--out|-o <png>]`** (`gui_shot.go`): same gate (the darwin message names `shot`). The screenshot runs through the first tool on PATH in a fixed ladder resolved by the pure `guiShotArgv(lookPath, display, out)`: (1) `import -display :N -window root <out>`; (2) `scrot <out>` with `DISPLAY=:N` in its env (scrot has no display flag); (3) `xwd -display :N -root -silent` piped in Go into `convert xwd:- <out>` (both must be present — an xwd-only host falls through). Every stage runs under `exec.CommandContext` bounded by `guiShotTimeout` (15 s). No tool ⇒ `no screenshot tool found (tried import, scrot, xwd+convert) — sudo apt install imagemagick`; a tool failure ⇒ `error: <tool> failed: <stderr tail>`; both exit 1. Default output is `<os.TempDir()>/rk-gui-shot-<YYYYMMDD-HHMMSS>.png` (clock seam `guiShotNowFn`); `--out` is made absolute, its parent created with `MkdirAll` 0755, an existing file overwritten. Success prints only the absolute PNG path (Dataf — survives `--quiet`); diagnostics ride stderr; exit 0.

**The `rk gui display` shell block** (installed by `rk agent setup` — see [agent-state](/run-kit/agent-state.md) § `rk agent setup`): a marker-owned block (`guiDisplayBlockBegin`/`guiDisplayBlockEnd` = `# >>> rk gui display >>>` / `# <<< rk gui display <<<`) upserted via the shared `upsertMarkerBlock`/`removeMarkerBlock` machinery into the same startup-file set as the tmux guard PATH block (`tmuxGuardStartupFiles(home, zdotdir)` — see [tmux-guard-shim](/run-kit/tmux-guard-shim.md)), with the same per-file tolerant read, malformed-block refusal, in-position replacement, consent/diff/dry-run flow, and absent-is-silent uninstall. The body is a **constant** (`guiDisplayBlock`) — nothing in it is interpolated, so it is byte-identical on every host:

```sh
# >>> rk gui display >>>
[ -n "$TMUX_PANE" ] && [ -z "${DISPLAY-}" ] && [ -x "$HOME/.local/share/rk/bin/run-kit" ] && eval "$("$HOME/.local/share/rk/bin/run-kit" gui env 2>/dev/null)"
# <<< rk gui display <<<
```

The four guards are load-bearing: `$TMUX_PANE` scopes the eval to tmux panes (the same gate the installed agent hooks use); `[ -z "${DISPLAY-}" ]` never overrides a pre-set `DISPLAY` (a desktop X session, SSH X-forwarding) and skips the exec in nested shells; `[ -x <pointer> ]` keeps a missing or dangling pointer silent by construction (one stat per shell start); `2>/dev/null` keeps an off or unreachable GUI silent — `rk gui env` then prints nothing to stdout and exits 1, so the eval is a no-op: the block is **inert while off** and starts working the moment someone runs `rk gui on`, with no re-setup. `$HOME` is expanded by the shell at source time, so the block is home-relocatable like the PATH block. `DISPLAY` lands in **new** shells — a shell started before `rk gui on` needs `eval "$(rk gui env)"` or `rk gui exec` per command. Cost per shell start with the GUI off: one stat plus one settings-file read (the assembler's disabled short-circuit, no tmux call), which matters because `.zshenv` runs for every non-interactive `zsh -c` an agent's Bash tool spawns.

**The per-machine pointer** (`guiPointerPath(home)` = `~/.local/share/rk/bin/run-kit`, dir constant `rkBinRelDir` beside `rkShimsRelDir`): a **symlink** whose target is the `resolveRkPath`/`validateHookPath`-validated absolute rk path — the same split the tmux guard uses (relocatable PATH block in the synced startup files, per-machine shim under `~/.local/share/rk/`). The `bin/` dir MUST stay off `PATH`: `resolveRkPath` prefers `exec.LookPath("run-kit")`, so a pointer on PATH would resolve to itself on the next re-run. Ownership is "is a symlink" — rk only ever writes a symlink there; a regular file or directory at the path is the user's and is never touched. `installGuiDisplayPointer` (install): absent → `gui display: will link <link> -> <rk>.` + consent (`Write the pointer? [y/N]`; dry-run note `gui display: dry run — <link> not written.`), then `MkdirAll` **after** consent, a re-`Lstat` immediately before the write (a non-symlink that appeared while the prompt was pending is refused, never clobbered), stale `.run-kit.tmp-*` symlinks from a crashed earlier run swept, and an atomic replace (`replaceSymlink`: temp symlink in the same dir + `os.Rename`, so no shell ever sees the path missing); an already-current symlink is the chatter no-op `pointer already links … — nothing to do.`; a symlink with any other target (a moved install, a dangling brew-rename leftover) is `will relink <link> -> <rk> (currently -> <old>).` + consent; a non-symlink is `… exists and is not a symlink — leaving it untouched (rk only replaces pointers it owns).` and reports the pointer **foreign**. `removeGuiDisplayPointer` (uninstall): absent → silent; a symlink → `Remove <link>? [y/N]` (dry-run note `pointer left in place (nothing removed).`), `os.Remove` on consent, then a best-effort `os.Remove` of the `bin/` dir only when it is a real (non-symlink) directory — refuses non-empty, so it can never delete anything else; a non-symlink → `… is not a symlink — leaving it untouched (rk only removes pointers it owns).`

**Gating and ordering** (`applyGuiDisplayBlocks`): install runs the pointer step first and the block upsert (`applyGuiDisplayStartupBlocks`) only when the pointer is **in place** — freshly linked, already current, or a dry-run previewing the link. A **foreign** pointer (a non-symlink at the path) is untrusted: the install prints `gui display: skipping the startup-file block (the pointer is not in place).` and additionally **strips any existing gui block** from the startup files (the uninstall flow, one consent per file), because a retained block would exec whatever occupies the pointer path from every pane shell's startup — the gate "a startup file never runs a non-rk file" must hold on re-install too. A **declined** pointer write skips the block but leaves an existing block alone (the pointer there is still an rk-owned symlink — stale or dangling, and the `-x` guard keeps a dangling one silent). The block is independent of the tmux **shim's** outcome. Uninstall strips the blocks first, then removes the pointer, and keeps the two independent (a declined pointer removal never skips the block strip and vice versa). A block whose body differs between the frozen marker lines is rewritten in position (`markerBlockBounds` matches on the markers alone), so a host converges in one write and every later run is the `block already present` no-op. Consent shape: one prompt for the pointer plus one per startup file for the block; `--yes` (what `shll update --yes` passes) applies silently.

**`rk skill gui`** — the topic page (canonical `docs/site/skill/gui.md`, ≤150 lines, synced to the embedded copy `cmd/rk/skill/gui.md` by `scripts/sync-skill.sh`, drift-guarded and line-budgeted by the shared `skill_test.go` tables, registered as `skillTopics["gui"]` so the `Topics:` help line and `rk skill topics` enumerate it): gate first (`rk gui status`; never run `rk gui on` yourself — the switch is the user's), `rk gui env` vs the installed block, `exec` (foreground vs `--detach`, `--` for dash-args), `shot` (default path, `--out`, read the PNG to look), the screenshot loop with `xdotool`, output/exit-code contracts, and gotchas (macOS view-only refusals; `DISPLAY` lands in new shells; the display is shared with the human; apps die on `rk gui off`; no tools are installed for you). The `rk gui --help` `Subcommands:` list carries the `exec`/`shot`/`launch` rows, and `rk gui env --help` points at the installed block.

## The `rk-gui` supervisor session

The host desktop runs as the `rk-gui` sibling session (single window `host`) on the `rk-daemon` socket — the `rk-code-server` precedent: it shares the socket, not the daemon session's lifecycle, so it survives `rk serve` exits and `daemon stop`. The tmux half lives in `internal/daemon/gui.go` (constants `GUISessionName`/`GUIWindowName`; seams `guiSessionExists`/`guiSpawn`/`guiKillRun`/`guiSelfPath`/`guiLookPath`/`guiFreeDisplay`/`guiSocketExists`/`guiGOOS`/`guiSessionOption`/`guiSessionCreated`/`guiPanePID`); see [daemon-lifecycle](/run-kit/daemon-lifecycle.md). (fkh1)

**Ensure ladder** (`ensureGUICore(cli bool)`, outcome enum `GUIEnsureDisabled`/`GUIEnsureAlreadyRunning`/`GUIEnsureNoBackend`/`GUIEnsureStateDirFailed`/`GUIEnsureStarted`), fixed skip order:

1. `!settings.Load().GUIEnabled` ⇒ disabled (the daemon boot hook `ensureGUI()` — called from `startSession` right after `ensureCodeServer()` — returns here silently).
2. The `rk-gui` session exists ⇒ already-running skip (a dead-backend session still "exists" — the stay-idle exit semantics below; `restart` is the recovery verb).
3. Linux with neither `Xtigervnc` nor `Xvnc` on PATH ⇒ `GUIEnsureNoBackend` — the daemon logs the install hint and continues; the CLI prints it and still enables. The hint is `gui.InstallHint(lookPath)` — package-manager-aware (`sudo apt install --no-install-recommends tigervnc-standalone-server icewm`, `sudo dnf install tigervnc-server icewm`, `sudo pacman -S tigervnc icewm`, or the generic `install a VNC X server (TigerVNC) and icewm with your package manager`). macOS is never no-backend (nothing to spawn).
4. State dir not creatable or socket path over `maxSocketPathBytes = 100` bytes (the unix `sun_path` cap) ⇒ `GUIEnsureStateDirFailed`.
5. Spawn: `gui.FreeDisplay` picks the lowest free display `:N` in `:10`–`:99` (free ⇔ neither `/tmp/.X{N}-lock` nor `/tmp/.X11-unix/X{N}` exists), then `tmux new-session -d -e XDG_STATE_HOME=<the daemon process's value> -s rk-gui -n host <rk-exe> gui supervise host --display :N` via `runTmux` on the daemon socket, `<rk-exe>` from `selfpath.Resolve` (the code-server `RK_BIN` precedent). The `-e XDG_STATE_HOME` pin (empty when the daemon's is unset — `gui.StateDir` treats empty as unset) keeps supervise, the probe, and the relay on ONE state root (§ Design Decisions → The rk-gui spawn pins the daemon's state home).

`EnsureGUI()` (the CLI/API posture) refuses with an operational error naming `rk serve -d` when `jobDaemonRunning` is false. `KillGUISession()` is the release-synchronous kill primitive: exact-match `kill-session -t =rk-gui` (audit-logged), an absent session is `(false, nil)` success, and after a real kill it waits — bounded by `guiSocketFreeTimeout = 5s` polled at `guiSocketFreePoll = 200ms`, expiry non-fatal — until `host.sock` disappears, so an `off`→`on` composition never sees the dying socket. `RestartGUI()` is kill then `ensureGUICore(true)`, refusing when disabled.

**`rk gui supervise host --display :N`** (Linux) — the pane command; its stdout/stderr IS the supervisor log:

1. `MkdirAll(StateDir, 0700)`; remove a stale `host.sock`.
2. Exec the backend with `exec.CommandContext` argv, stdout/stderr inherited:
   `Xtigervnc :N -rfbunixpath <StateDir>/host.sock -rfbport -1 -SecurityTypes None -AlwaysShared -AcceptSetDesktopSize -geometry 1920x1080 -FrameRate=60 -desktop run-kit`
   Binary resolution is **by name `Xtigervnc` first, `Xvnc` only when `Xtigervnc` is absent** (the KasmVNC deb hijacks `Xvnc` via `update-alternatives`); `-rfbport -1` is mandatory (without it TigerVNC still binds TCP 5900+N on all interfaces).
3. Wait ≤ 5 s for the socket (`guiSocketWaitTimeout`/`guiSocketWaitPoll` 5 s/200 ms), `chmod 0600` it, log `gui: <bin> up on :N (socket <path>)`.
4. **Resolve the WM** — `pin := guiSuperviseSettingsLoad().GUIWM` (the `gui.wm` setting, § below), then `gui.ResolveWM(guiSuperviseLookPath, pin)`: a non-empty pin that `lookPath` resolves wins; a non-empty pin that misses logs `gui: gui.wm=<pin> not on PATH; falling back to the ladder` and falls through; otherwise the first rung of the ladder `icewm-session → openbox → xfwm4 → i3 → kwin_x11 → x-session-manager` (`gui.WMLadder()` — the one place the text lives) on PATH wins; nothing resolved ⇒ the display runs bare. `gui.WMArgv(name)` owns the per-binary argv — `icewm-session` runs `--nobg --notray` (icewmbg would paint a theme wallpaper over rk's `xsetroot` ground; the tray is dead weight on a single-user display), `x-session-manager` runs under `dbus-run-session --`, anything else runs bare — and the flags belong to the binary, so a pinned name gets the same argv as its ladder rung. Then **resolve the launcher apps** (`gui.ResolveApp` over `guiSuperviseLookPath`/`guiSuperviseStat` — § The launcher).
5. **Seed the IceWM profile** when the chosen rung is `icewm-session`: `gui.SeedProfile(gui.ProfileDir(), term, browser)` (seam `guiSuperviseSeed`; § The seeded IceWM profile below). Best-effort — a failure logs `gui: seeding the IceWM profile at <dir> failed: <err>; starting icewm with its defaults` and continues (the desktop must still come up).
6. **Stamp all three options together** — `@rk_gui_display :N`, `@rk_gui_backend <bin>`, then `@rk_gui_wm <argv[0]>` (`""` when bare — deliberate: readers distinguish nothing between "bare" and "unset", both render `wm:""`) on the `rk-gui` session via `tmux -L rk-daemon set-option -t =rk-gui: …` (best-effort, 5 s bound; constants `daemon.GUIOptionDisplay`/`GUIOptionBackend`/`GUIOptionWM`) — the session-scoped exact-match target `tmux.ExactSessionTarget(...)` (`=rk-gui:` — the trailing colon is load-bearing: tmux 3.7c rejects the bare `=name` form for the option commands; § Design Decisions → Session-option commands target `=rk-gui:`); readers are `rk gui status`/`env`, the state probe (`guiSessionOption`, same target), `daemon.GUISessionOptions`, and `gui.Assemble`. Stamping in one burst before the WM starts is what lets `rk gui on`'s single bounded `guiAwaitStamps` read carry the WM name with no race. The `@rk_*` per-entity state home ([tmux-sessions](/run-kit/tmux-sessions.md) § Server-Scoped User Options).
7. **Log lines**: the icewm rung logs `gui: window manager icewm-session (config <dir>, seeded preferences)` (the `, seeded preferences` suffix only on the first seed) plus `gui: toolbar: terminal=<name|none> browser=<name|none>`; any other rung logs `gui: window manager <name>`; nothing found ⇒ `gui: no window manager found (tried icewm-session, openbox, xfwm4, i3, kwin_x11, x-session-manager); running bare — <WMInstallHint>, then rk gui restart` (`guiNoWMLine(hint)` derives the ladder text from `gui.WMLadder()`).
8. **Start the WM** via `guiSuperviseStartWM(ctx, argv, display, extraEnv)` — the icewm rung's env additionally carries `ICEWM_PRIVCFG=<profile dir>`; every other rung runs with `DISPLAY=:N` alone. A start failure logs `gui: window manager <name> failed to start: <err>; running bare` and continues (a bare X display is still usable).
9. Paint the root window: `gui.RootBackgroundArgv` resolves `xsetroot -solid #3b4252` (`gui.RootBackground`) and the supervisor runs it once with `DISPLAY=:N` under a 5 s bound (`guiRootBackgroundTimeout`, seam `guiSuperviseRunOnDisplay`), best-effort — a failure logs `gui: xsetroot failed: <err>; the empty desktop stays black`; no `xsetroot` on PATH logs `gui: no xsetroot on PATH; the empty desktop stays black — apt install x11-xserver-utils`. Either way the supervisor continues. Xvnc's root is otherwise black and the lighter WMs paint no desktop, so a freshly enabled GUI with no app running would render as a black tile indistinguishable from a dead canvas (§ Design Decisions → Empty desktop gets a solid root background). (xy7q)
10. Trap SIGTERM/SIGINT/SIGHUP (`signal.NotifyContext`): kill the WM, remove the socket, reap the backend, exit 0.
11. **Stay-idle exit semantics**: when the backend exits on its own, log `gui: <bin> exited (status N) — display :N is down; run 'rk gui restart' or turn the GUI off`, kill the WM, remove the socket, and block until a signal arrives (no auto-respawn, no process exit) — the pane remains readable and the session still exists, so ensure skips it while status and the stream report not-running until `rk gui restart` / `POST /api/gui/host/restart` / `rk gui off`.

**macOS** (`GOOS=darwin`): supervise spawns nothing — it stamps `@rk_gui_backend screen-sharing` and logs the Screen Sharing dial result (`127.0.0.1:5900`) once a minute (`Screen Sharing: reachable on 127.0.0.1:5900` / `Screen Sharing: not reachable — enable System Settings › General › Sharing › Screen Sharing`), exiting 0 on signal. Backend detection reports `screen-sharing` and never `GUIEnsureNoBackend`.

**The seeded IceWM profile** — `gui.ProfileDir()` = `<StateDir>/icewm/` (`$XDG_STATE_HOME/run-kit/gui/icewm/`, beside `host.sock`), passed to the icewm rung as `ICEWM_PRIVCFG` so IceWM's entire private config lives under rk's state dir (`~/.icewm` is never touched). `gui.SeedProfile(dir, terminal, browser)` (in `internal/gui/seed.go`; dir `0700`, files `0600`) manages two file classes: **`preferences` is write-once** — seeded when absent from the `go:embed`ded `seed/preferences` (NanoBlue theme; CPU/mailbox/net/APM meters, workspaces, show-desktop button, window-list menu, and clock LEDs off; `WorkspaceNames=" run-kit "`; no menu-curation keys — `ShowSettingsMenu`/`ShowThemesMenu` had no effect on IceWM 2.9.6, and IceWM logs and ignores unknown keys), never rewritten while present (user edits persist; deleting the file re-seeds — the code-server `settings.json` rule), and the `seeded` return drives the supervisor's log suffix; **`toolbar` and `menu` are regenerated on every supervise start** from the resolved launcher apps (rows only for roles that resolved, naming the plain ladder binary — never an rk path; `menu` additionally carries `separator` + `includeprog icewm-menu-fdo --no-sep-others --seps`), with header comments pointing editors at `preferences` instead. (2jl3)

**The `gui.wm` pin** — a registry key (`internal/settings`, string, default `""`, category `behavior`, `ui: true`, `live: false`, no env form) backed by `Settings.GUIWM`, serialized as the flat dotted line `gui.wm: "xfwm4"` and omitted when empty (round-trips byte-identically). Read once at supervise start, so a change applies on the next `rk gui restart`; an unresolvable value logs the pin-miss line and falls back to the ladder. See [configuration](/run-kit/configuration.md) § Settings Registry. (2jl3)

**Running-apps list** (Linux): `gui.RunningApps` scans `/proc/[0-9]*/environ` for `DISPLAY=:N`, excludes the supervisor's own process tree (`daemon.GUIPanePids` → `gui.ProcessTreePids` — the backend, the WM, and supervise itself carry the display in their env), then drops the fixed WM-helper comm-name set (`wmHelperComms`: `icewm-session, icewm, icewmbg, icewmtray, icesound, icewmhint, openbox, xfwm4, i3, kwin_x11, xsetroot`) — by name, never ancestry, so apps launched from the IceWM toolbar (children of `icewm`) stay listed — groups by `comm` into `{Name, Count}` sorted count-desc then name; per-pid errors are skipped. macOS: always empty (nothing runs under rk's control). Uptime derives from the `rk-gui` session's `session_created` via `daemon.GUISessionCreated`. (2jl3)

## The `/ws/gui/{id}` relay

`api/gui_ws.go`, registered beside `/ws/terminals`; errors ride WS close frames so noVNC gets a reason (the `/ws/terminals` posture):

1. `validate.ValidateGUIID(id)` fails ⇒ upgrade then close **4400** `invalid gui id`.
2. `!settings.Load().GUIEnabled` ⇒ close **4403** `gui disabled`.
3. Dial the backend (`gui.BackendAddr("host")`: Linux `unix` `<StateDir>/host.sock`, macOS `tcp` `127.0.0.1:5900`; `guiDialTimeout = 2s`); failure ⇒ close **4404** `gui not running: <reason>`.
4. Pipe **binary frames only**: WS→backend writes each binary message to the conn; backend→WS reads up to `guiBackendReadChunk = 64 KiB` and writes `BinaryMessage` with a 10 s write deadline (`terminalsWriteWait`). Text frames are ignored (forward-compat); `guiReadLimit = 1 MiB` bounds inbound frames.
5. The lifecycle context roots at `context.Background()` (not `r.Context()` — the hijack rule from `state_ws.go`); either side's read error cancels it and closes **both** conns — a client disconnect yields EOF on the backend conn within a second (no orphaned sockets). Viewer accounting: `hub.guiViewerAdd(id)` on a successful dial, deferred `guiViewerRemove(id)` on teardown — the payload's `viewers`.
6. **macOS view-only filter** (`api/gui_filter.go`): when the backend network is `tcp` (screen-sharing) the relay tracks the RFB 3.8 handshake (ProtocolVersion, security negotiation incl. the ARD type-30 DH exchange, SecurityResult, ClientInit, ServerInit) and afterwards drops client→server messages of type 4 (KeyEvent, 8 bytes) and 5 (PointerEvent, 6 bytes), forwarding everything else (ClientCutText capped at `guiFilterMaxCutText = 16 MiB`; unknown types forwarded raw). On the `unix` backend the filter is inert pass-through.

## The `event: gui` state slot

`api/sse.go`, mirroring `event: code-server` ([api-and-sockets](/run-kit/api-and-sockets.md) § `event: code-server`): hub fields `guiEnabled`, `guiProbeAt`, `guiInfo`, `guiBackend`, `guiDisplay`, `guiWM`, `guiViewers map[string]int`, `cachedGuiJSON`. `guiTick()` runs every poll tick: it re-reads `settings.Load().GUIEnabled` (so a CLI-side `rk gui on` shows up without a POST; a flip zeroes the probe age) and, when enabled and the probe is older than `guiProbeTTL = 5s`, reads `@rk_gui_display`/`@rk_gui_backend`/`@rk_gui_wm` from the `rk-gui` session via the `guiSessionOptionsFn` seam (the read targets the session-scoped exact-match form `=rk-gui:` — `tmux.ExactSessionTarget`, the same target the stamp write uses; `kill-session`/`display-message`/`list-panes` keep the bare `=rk-gui`, which tmux accepts there) (absent session or unparsable display ⇒ `reachable:false`, reason `session absent`) and runs `gui.Probe` — **skipping the dial while `guiViewers[id] > 0`** (reachable follows from the live relay; last geometry and `guiWM` retained — the stamps do not change while the session lives — keeping Xvnc's per-connection log lines out of the supervisor pane while someone is watching). The payload is always a list (`[]gui.StreamEntry` — `id, enabled, backend, reachable, display, width, height, viewers, wm`), e.g. `[{"id":"host","enabled":true,"backend":"Xtigervnc","reachable":true,"display":":10","width":1920,"height":1080,"viewers":1,"wm":"icewm-session"}]`; disabled renders the all-zero entry. Broadcast as `hubEvent{kind: kindGlobal, typ: "gui"}` every tick (client raw-payload dedup absorbs the repetition) and replayed to late joiners from `cachedGuiJSON` in `replayGlobalSlots` beside the code-server slot. `setGUIEnabled(bool)` is the POST-side apply seam: it flips `guiEnabled`, zeroes the probe age, re-renders, and broadcasts immediately — the settings POST flips `enabled` within one state event.

**The RFB probe** (`gui.Probe(ctx, network, addr)`): 500 ms dial timeout, 2 s per-read deadline; reads the 12-byte `RFB 003.008\n` banner and, for `network == "unix"` (Linux), completes the minimal 3.8 handshake — reply banner, select security type 1 (None), read SecurityResult, send `ClientInit shared=1`, read `ServerInit` for width/height — then closes, returning `Info{Reachable:true, Width, Height}`. For `tcp` (macOS) it stops after the banner (auth needs the Keychain password; reachability is the dial + banner) with zero geometry. Failures classify into `Reason`: `not running` (ECONNREFUSED/ENOENT), `dial failed: …`, `bad banner`.

## HTTP routes and the settings-POST side effect

Registered in `api/router.go` beside `/api/settings` (mutations POST-only, Constitution IX — the family is exactly `/ws/gui/*` + `/api/gui/*`):

- `GET /api/gui/{id}` → the shared `gui.Status` document (`id, enabled, backend, reachable, display, width, height, viewers, wm, wm_hint,omitempty, socket, session, reason, apps[], uptime_seconds`), built by `gui.Assemble` under a 10 s bound with the viewer count from the hub; 400 on an invalid id. `wm` is the stamped window-manager name (`""` when bare or disabled); `wm_hint` is present only when enabled ∧ reachable ∧ bare (`gui.WMInstallHint(d.LookPath)` — the unreachable reason already carries the backend hint). This is the same document `rk gui status --json` emits — the off-confirm dialog renders from its `apps` field. The tile's bare-WM strip is the other frontend consumer: it keys on the stream entry's `wm` and fetches this document once per bare transition for the `wm_hint` install line (vu4p). (2jl3)
- `POST /api/gui/{id}/restart` → `daemon.RestartGUI()`; 400 on an invalid id, 409 `{"error":"gui disabled"}` when off, 200 `{"status":"ok"}` on success, 500 with the error text on failure — the empty state's "Restart supervisor" action.
- `POST /api/gui/{id}/launch` → the launcher's HTTP twin (§ The launcher): 400 on an invalid id, unparsable body, or bad `app` (`app must be terminal or browser`), 409 `gui disabled` / 409 `gui is on but not running — see 'rk gui status'`, 200 `{"ok":false,"app":…,"hint":…}` on a ladder miss, 500 `<name>: <reason>` on a start failure, 200 `{"ok":true,"app":…,"argv0":…,"pid":…}` on success. The body carries a role, never argv. (2jl3)
- `POST /api/settings` carrying `gui.enabled` (set or `null`-unset): after `Save`, true ⇒ the `guiEnsure` seam (production `daemon.EnsureGUI`) best-effort (a failure logs a warning, the response stays 200 — the stream's `reachable:false` + `reason` is the user-visible outcome), false ⇒ the `guiKill` seam (production `daemon.KillGUISession`); both then `sseHub.setGUIEnabled(v)`. The confirm happens client-side before the POST. See [configuration](/run-kit/configuration.md) § Settings HTTP API.

**The shared status assembler** — `gui.Assemble(ctx, StatusDeps) Status` owns the status derivation once for both `rk gui status` and `GET /api/gui/{id}` over injected seams (`ID, Enabled, DaemonRunning, SessionExists, SessionOptions, SessionCreated, PanePids, Probe, RunningApps, LookPath, Viewers, Now`), in the order disabled short-circuit → daemon gate → session existence → stamped display/backend/wm + uptime → probe → reason → wm-hint (enabled ∧ reachable ∧ `wm == ""` ⇒ `WMInstallHint(LookPath)`) → apps (apps only when reachable). `SessionOptions` is `daemon.GUISessionOptions`, widened to `(display, backend, wm string, ok bool)` — `ok` still requires display and backend non-empty; `wm` reads best-effort (`""` when unset or stamped empty).

## Doctor row

`cmd/rk/doctor.go` `guiCheck(...)` runs after the code-bridge row, always `OK: true` (state, not verdict), pure over injected seams with all tmux reads gated on the daemon running. The Notes: `off`; `on (<bin>, :N, WxH, k viewer(s), <wm>)` via the shared `guiOnSummary` (the **resolved binary name**; a bare display appends the hint — `no window manager — <WMInstallHint>` — the doctor is the diagnostic surface; `rk gui status` keeps the bare `no window manager`); and `on — not running (<reason>)` with reasons from `gui.NotRunningReason` — `rk-gui session absent; the daemon starts it on 'rk daemon start'`, `no VNC backend: <InstallHint(lookPath)>` (package-manager-aware), `<bin> exited — see the rk-gui pane; 'rk gui restart'`, and `Screen Sharing is off: System Settings › General › Sharing › Screen Sharing`. (2jl3)

## Validation

`validate.ValidateGUIID(id string) string` returns `""` for exactly `"host"` and ``gui id must be "host"`` otherwise — the path and payload stay list-shaped so a second id lands at the validator later. Used by the relay, the `/api/gui` routes, and `rk gui supervise`.

## Smoothness (C5)

The plan's D9 targets — **click-to-pixel < 100 ms**, **≥ 30 fps scrolling a browser page at 1080p over Tailscale**, **< 1 core of Xvnc CPU** — are measured by the `@perf` audit spec `app/frontend/tests/e2e/gui-perf.spec.ts` (see [lenses-and-layout](/run-kit/ui/lenses-and-layout.md) § GUI Surface for its e2e shape), never asserted: it records and prints, and the verdict is a reading of the table below. (xy7q)

**Method.** The spec turns the rig's GUI on through the settings POST, launches Playwright's own Chromium in kiosk on the payload's `DISPLAY` with a generated ~300 KB long page (text + colored tile rows, plus a fixed 240×240 square that toggles red⇄teal on pointerdown), and drives a wheel scroll with `xdotool click --repeat N --delay 33 5` (30 notches/s) for a 2 s ramp + 10 s window. In the viewer it installs three probes before the app loads: a `CanvasRenderingContext2D.prototype.drawImage` wrap counting draws whose source is a canvas onto the gui tile's canvas (noVNC 1.7 `Display.flip()` — one per completed FramebufferUpdate — so **fps is the client's framebuffer-update rate**), a `WebSocket` wrap summing binary message bytes on `/ws/gui/` (**relay Mbit/s** as the browser sees it), and a capture-phase `pointerdown` stamp. Xvnc and guest-Chromium **cores** are utime+stime deltas from `/proc/<pid>/stat` over the window. **Click-to-pixel** arms a rAF poll of `getImageData` at the square, clicks through the tile (`page.mouse.click`; `touchscreen.tap` on the coarse viewer), and stops at the color flip — the full pointer → relay → Xvnc → guest repaint → encode → decode → paint path, 20 trials, p50/p95. Three runs per link: an idle baseline, a fine-pointer viewer with the tile zen-zoomed and the viewport fitted so the desktop is exactly 1920×1080 (SetDesktopSize via `resizeSession`), and a coarse 390×844 touch viewer attached alongside it with the desktop locked at 1080p (`GUI: Lock resolution` on the fine viewer; the phone scales client-side — D7 holds, asserted). Links are emulated with `scripts/gui-perf-link.sh on <backend-port> <rtt_ms> <mbit>` — a port-scoped `tc prio` + `netem` on `lo` (delay rtt/2 each way, optional rate cap) matching only the rig's Go backend port, so the live daemon on `:3000` is untouched; `RK_GUI_PERF_LABEL` names the row. The 260 ms RTT is what `tailscale ping` measured from this VM (`dev-ws-sahil01`, 16 vCPU, no GPU) to the user's laptop and phone in India (DERP-relayed, 258–274 ms); the 40 Mbit/s cap is an assumed DERP-relay budget — the real device throughput has not been measured (see the recipe).

**Results (2026-09-10, Xtigervnc 1.12 + openbox, noVNC 1.7.0 Tight/JPEG at the tile's presets — fine 6/2, coarse 4/6; desktop 1920×1080 in every row; idle rows are 0 fps / 0 Mbit/s / 0.00 cores everywhere):**

| Link (viewer → relay) | Viewer | fps | Relay Mbit/s | Xvnc cores | Guest cores | Click→pixel p50 / p95 |
|---|---|---|---|---|---|---|
| loopback | fine 1080p | **59.2** | 109.3 | **0.29** | 0.18 | **29 / 46 ms** |
| loopback | coarse 390×844 (+ fine attached) | 63.1 | 66.8 | 0.52 | 0.21 | 33 / 59 ms |
| 260 ms RTT, uncapped (latency only) | fine 1080p | **33.7** | 75.8 | 0.23 | 0.17 | 279 / 315 ms |
| 260 ms RTT, uncapped | coarse | 50.4 | 58.1 | 0.42 | 0.19 | 283 / 315 ms |
| 0 ms, 40 Mbit/s (bandwidth only) | fine 1080p | 16.6 | 37.6 | 0.14 | 0.16 | 29 / 44 ms |
| 0 ms, 40 Mbit/s | coarse | 13.1 | 17.1 | 0.16 | 0.17 | 33 / 66 ms |
| 0 ms, 20 Mbit/s | fine 1080p | 8.5 | 19.4 | 0.11 | 0.16 | 29 / 153 ms |
| 0 ms, 20 Mbit/s | coarse | 5.9 | 7.6 | 0.12 | 0.16 | 29 / 199 ms |
| 50 ms, 40 Mbit/s | fine 1080p | 14.7 | 33.4 | 0.14 | 0.16 | 63 / 108 ms |
| 120 ms, 40 Mbit/s | fine 1080p | 8.0 | 18.1 | 0.11 | 0.15 | 146 / 204 ms |
| **260 ms, 40 Mbit/s (the Tailscale proxy)** | fine 1080p | **11.1** | 25.0 | 0.12 | 0.16 | **280 / 303 ms** |
| 260 ms, 40 Mbit/s | coarse | 10.7 | 13.7 | 0.15 | 0.16 | 283 / 333 ms |

Coarse rows share the capped port with the still-connected fine viewer, so their Mbit/s is a share, not a ceiling. Xvnc's 60 fps `-FrameRate` and the browser's rAF bound the loopback rows.

**Reading.** Three facts fall out. (1) The pipeline's own cost is small: click-to-pixel is 29 ms p50 on loopback and RTT + ~20 ms everywhere else; Xvnc never exceeds 0.52 cores even with two viewers. (2) Latency alone does not break the frame rate: at 260 ms with no cap the fine viewer still updates at 34 fps (noVNC pipelines its FramebufferUpdateRequests, so RFB's request/response loop is not the limiter). (3) **Bytes per frame are.** A full-screen 1080p scroll at the fine preset costs ~1.85 Mbit per update (109 Mbit/s ÷ 59 fps), so a 40 Mbit/s link caps the update rate near 17 fps and a 20 Mbit/s link near 8, independent of RTT — the fps rows track the cap, not the delay.

**Verdict against D9 (2026-09-10).** *Xvnc CPU < 1 core*: **met** on every row. *Click-to-pixel < 100 ms*: **met net of the link** — the pipeline adds ~20–30 ms, and no backend can beat the ~260 ms RTT floor from the user's devices (the C0 verdict's point). *≥ 30 fps at 1080p over Tailscale*: **met when the link carries ≥ ~60 Mbit/s, missed at 40 Mbit/s or less (11 fps at the 260 ms/40 Mbit proxy)** — and the miss is encoder-attributable: the encoded byte budget per frame, not latency or CPU. Per the plan's rule (an encoder-attributable fps miss ⇒ C6), **C6 is picked up**, scoped as a *bandwidth-efficiency* change: its intake should first measure the user's real Tailscale throughput with the recipe below, then weigh the cheap in-tree lever (a lower or adaptive Tight `qualityLevel`/`compressionLevel` for fine viewers — the coarse preset already ships ~40 % fewer bytes at the same content) against the KasmVNC backend's ~3× byte reduction the C0 spike measured (42 vs 121 Mbit/s), before committing to a second renderer.

**Re-run recipe.** On this host: `just dev` (the rig), then `just pw test gui-perf` for the loopback row; `scripts/gui-perf-link.sh on <E2E_PORT+1> 260 40 && RK_GUI_PERF_LABEL=netem-260ms-40mbit just pw test gui-perf; scripts/gui-perf-link.sh off` for an emulated link (`mbit=0` ⇒ uncapped). Results print in `afterAll` and land in `app/frontend/test-results/gui-perf-<label>.json` (merged by run+viewer across Playwright worker restarts). Caveat on a host with the live daemon running: the rig's backend shares the `rk-daemon` tmux socket, so the spec's `gui.enabled` off/on cycle kills and respawns the host's own `rk-gui` session and leaves it off-then-`on — not running` at the end — `rk gui restart` brings it back. From a real laptop over Tailscale: install the frontend deps there, point Playwright at the rk origin (`E2E_PORT` is the rig contract; against a live daemon use `RK_E2E_PORT=<port>` with the daemon's host in `baseURL`), turn the GUI on with `rk gui on`, launch the guest with `rk gui exec --detach -- <chromium> --kiosk --window-size=1920,1080 file:///<page>` and scroll with `rk gui exec -- xdotool mousemove 960 640 click --repeat 360 --delay 33 5`; read the fps/bytes probes from the same spec or its `INSTALL_PROBES` snippet in DevTools. A phone cannot run Playwright — the coarse rows above are the emulated proxy; a hands-on phone run reads noVNC's update cadence by eye only.

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
Every verb that acts on the live display (`exec`, `shot`, `launch`) SHALL apply the same gate — the macOS refusal first, then enabled, then reachable — and `env` SHALL apply the enabled/reachable half, all through the shared `guiDarwinRefusal`/`guiRequireReachable` helpers and the named `guiErrOff`/`guiErrNotRunning` constants, so `env`, `exec`, `shot`, and `launch` print byte-identical refusals for the same state. (bbv1) (2jl3)

#### Scenario: Identical refusals across verbs
- **GIVEN** the GUI enabled but the backend dead
- **WHEN** `rk gui env`, `rk gui exec xterm`, and `rk gui shot` each run
- **THEN** all three print `gui is on but not running — see 'rk gui status'` and exit 1

## Design Decisions

### Empty desktop gets a solid root background
**Decision**: the Linux supervisor runs `xsetroot -solid #3b4252` (`gui.RootBackground`) once after the WM launch, best-effort under a 5 s bound, logging an `x11-xserver-utils` install hint when `xsetroot` is absent; macOS is untouched.
**Why**: Xvnc's default root is black and openbox paints no desktop, so a freshly enabled GUI with nothing running rendered as a black tile indistinguishable from a dead canvas (reported as "blank/black screen" the day the tile shipped). A solid fill costs the encoder one rect per update. Running after the WM lets a desktop environment on the ladder that paints its own desktop window win visually.
**Rejected**: Xvnc `-retro` (the classic weave stipple is high-frequency JPEG noise on every full update and scales badly on phones); a frontend "empty desktop" overlay (the tile has no live `apps` signal — only the one-shot status GET on the unreachable transition — and text over a live desktop is intrusive).
*Introduced by*: 260910-xy7q-gui-perf-measure

### Smoothness is audited by a `@perf` spec, never gated
**Decision**: `gui-perf.spec.ts` records fps, relay bytes, CPU, and click-to-pixel and prints/writes them; its only assertions are rig health (canvas painted, frames and bytes flowed, a coarse viewer left the geometry alone). It is `@perf`-tagged (excluded from `just test-e2e`, run via `just pw test gui-perf`) and skips without `Xtigervnc`/`xdotool`.
**Why**: loopback timing is too noisy for a stable gate (the echo-latency precedent), and the D9 verdict depends on the viewer's link, which only a labelled table can carry. The frame counter rides a `drawImage(<canvas>)` hook because the RFB instance is a closure inside the tile — no product seam is exposed for a test.
**Rejected**: threshold assertions (flaky on shared runners, wrong on a high-RTT link); a product-side perf overlay (scope; the probes are three lines of init script).
*Introduced by*: 260910-xy7q-gui-perf-measure

### Remote links are emulated with port-scoped netem, not CDP throttling
**Decision**: `scripts/gui-perf-link.sh` installs `tc prio` + `netem` (delay rtt/2, optional rate cap) on `lo` with `u32` filters on the rig's Go backend port only.
**Why**: the agent cannot drive the user's devices; the C0 verdict found CDP's per-message throttle starves the RFB request loop and collapses every stack to the same number; matching one port keeps the live daemon and every other loopback consumer unaffected, and delaying the backend rather than Vite keeps the dev module graph loading at full speed while the RFB stream and API pay the round trip.
**Rejected**: CDP `emulateNetworkConditions`; a global netem on `lo`; delaying the Vite port.
*Introduced by*: 260910-xy7q-gui-perf-measure

### Session-option commands target `=rk-gui:`, not `=rk-gui`
**Decision**: the `@rk_gui_display`/`@rk_gui_backend` stamp write (`cmd/rk/gui_supervise.go`) and the hub's option read (`internal/daemon/gui.go`'s `guiSessionOption`) target the session-scoped exact-match form `tmux.ExactSessionTarget(GUISessionName)` (`=rk-gui:` — the `internal/tmux/board.go` precedent); `kill-session`, `display-message`, and `list-panes` keep the bare `=rk-gui` target.
**Why**: tmux 3.7c's target parser rejects the bare `=name` exact-match form for the option commands (`no such session: =rk-gui`) while accepting it for `display-message`/`kill-session` — under the bare form the stamp never lands and the read never sees it, so the `event: gui` stream stays `reachable:false` on a healthy backend.
**Rejected**: the bare `=rk-gui` everywhere (silently broken on tmux ≥ 3.7 for the option commands); threading the colon form into the non-option commands too (accepted there, but churn without cause — the constraint is per-command-family).
*Introduced by*: 260909-o2sp-gui-surface-tile

### The rk-gui spawn pins the daemon's `XDG_STATE_HOME`
**Decision**: the `new-session` argv for the `rk-gui` supervisor carries `-e XDG_STATE_HOME=<the daemon process's value>` (empty when unset, which `gui.StateDir` reads as unset) — the daemon session's own `-e RK_DAEMON_LOG=…` pin (`startSession`) is the precedent.
**Why**: tmux builds pane environments from the SERVER's birth environment plus the `update-environment` allowlist (which `XDG_STATE_HOME` is not on), so without the pin a daemon launched under a different state home than the tmux server forks `gui.StateDir()`: supervise binds `host.sock` under one root while `gui.Probe` and the relay dial the other, and the stream stays `reachable:false` on env-isolated rigs.
**Rejected**: relying on the server env (correct only when daemon and tmux server share a birth env); adding `XDG_STATE_HOME` to `update-environment` (server-global mutation for one session).
*Introduced by*: 260909-o2sp-gui-surface-tile

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
**Decision**: `rk agent setup` installs a marker-owned block into the guard PATH block's startup files whose body is `[ -n "$TMUX_PANE" ] && [ -z "${DISPLAY-}" ] && [ -x "$HOME/.local/share/rk/bin/run-kit" ] && eval "$("$HOME/.local/share/rk/bin/run-kit" gui env 2>/dev/null)"`; the block is installed regardless of `gui.enabled`.
**Why**: Constitution X — the display is derivable from the supervisor's `@rk_gui_display` stamp, so panes read it at shell start rather than receive a pushed copy; `rk gui env` already is that read and its disabled path costs one settings-file read, so the block is inert and cheap while off and needs no re-setup when the GUI is turned on later.
**Rejected**: `tmux set-environment -g DISPLAY` on `rk gui on` (a second source of truth swept across every server and unset on `off`); exporting from agent hooks (subprocesses cannot set a shell's env, and hooks carry only the underivable).
*Introduced by*: 260909-bbv1-gui-agent-verbs

### Synced startup files carry only relocatable content
**Decision**: the gui display block is a `$HOME`-relative constant with no interpolated host path; the per-machine absolute rk path lives in the symlink `~/.local/share/rk/bin/run-kit`, an unsynced per-machine location, and the block execs the pointer.
**Why**: `~/.zshenv`/`~/.bashrc` are commonly dotfile-synced across hosts whose Homebrew prefixes differ (`/opt/homebrew` vs `/home/linuxbrew/.linuxbrew`); a block embedding the host path can never converge, so every `rk agent setup` — which every `shll update` runs — re-proposed a "replaced in position" rewrite of the other host's block on both machines forever. A synced file may carry only relocatable content; the tmux guard already splits this way (relocatable PATH block, per-machine shim under `~/.local/share/rk/shims/`), and the marker lines stayed frozen so existing installs migrate in place.
**Rejected**: per-OS marker blocks with a `uname` gate (keeps a per-machine fact in a synced file, two same-OS hosts with different prefixes still fight, doubles the marker surface); resolving via `command -v run-kit` at read time (reintroduces the PATH dependency `resolveRkPath` exists to remove — `.zshenv` runs before Homebrew's `shellenv` on macOS, so it would silently no-op there).
*Introduced by*: 260910-r7v8-gui-display-block-relocatable

### The pointer directory stays off PATH and is owned by symlink-ness
**Decision**: the pointer lives in `~/.local/share/rk/bin/`, a sibling of `shims/` that nothing rk installs prepends to `PATH`; rk treats any symlink at the pointer path as its own (relinking a stale or dangling one on consent) and any regular file or directory there as the user's — re-checked immediately before every write, and the parent is pruned on uninstall only when it is a real directory.
**Why**: `resolveRkPath` prefers `exec.LookPath("run-kit")` — a pointer on PATH would resolve to itself on the next re-run and loop. rk only ever writes a symlink there, so the file type is a sufficient ownership marker; a wrapper script would add a marker line for nothing, since there is nothing to embed beyond the path.
**Rejected**: dropping the pointer into the existing `shims/` dir (already on PATH — exactly the self-resolution hazard); a marker-bearing wrapper script (more surface, same information).
*Introduced by*: 260910-r7v8-gui-display-block-relocatable

### The block gates on its own pointer, mirroring PATH block ↔ shim
**Decision**: the startup-file block is written only when the pointer is in place (fresh, current, or a dry-run preview); a foreign non-symlink at the pointer path skips the block AND strips any existing one, a declined pointer write skips the block and leaves an existing one alone. The block stays independent of the tmux shim's outcome.
**Why**: a block that execs `$HOME/.local/share/rk/bin/run-kit` in front of a foreign file would run a non-rk executable from every pane shell's startup — on first install and equally on a re-install that finds a block already there; in front of nothing it is silently inert — the same reasoning that gates the PATH block on the shim being rk-owned.
**Rejected**: writing the block unconditionally (safe only while the block embedded the validated path itself); skipping the upsert but retaining an existing block behind a foreign pointer (the retained block's `-x` check passes on the foreign file).
*Introduced by*: 260910-r7v8-gui-display-block-relocatable

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

### IceWM is the recommended window manager
**Decision**: `icewm-session --nobg --notray` heads the WM ladder; the `xsetroot -solid #3b4252` paint stays the ground.
**Why**: the spike measured 29 MB idle for the `icewm-session` + `icewm` pair with no D-Bus or session manager, a taskbar/start menu/clock built in, and a first-class private config dir; `--nobg` is the only way to keep rk's ground (a theme wallpaper otherwise wins over every preference).
**Rejected**: openbox first (a bare root with a dead right-click menu on phones); XFCE/LXQt (session plumbing, D-Bus, tens of MB more); an rk-drawn panel (Constitution III — IceWM already draws one).
*Introduced by*: 260910-2jl3-gui-desktop-icewm-and-launcher

### rk owns the look through a seeded profile, not a config edit
**Decision**: `$XDG_STATE_HOME/run-kit/gui/icewm/` is passed as `ICEWM_PRIVCFG`; `preferences` is write-once (seeded when absent), `toolbar`/`menu` are regenerated every start from the launcher ladders.
**Why**: the code-server `settings.json` precedent — user edits persist, deleting resets; the toolbar must only name binaries that exist, and regenerating avoids baking an rk binary path into a user-editable file. `~/.icewm` is never touched.
**Rejected**: writing `~/.icewm` (collides with a user's own IceWM desktop); a fully static embedded toolbar (dead buttons on hosts without a browser).
*Introduced by*: 260910-2jl3-gui-desktop-icewm-and-launcher

### One two-role launcher, never argv over HTTP
**Decision**: `rk gui launch <terminal|browser>` and `POST /api/gui/{id}/launch {"app":…}` share `gui.ResolveApp` over fixed ladders resolved with `LookPath` plus a stat of the resolved path; a miss returns `{ok:false, hint}`; `rk gui exec` stays CLI-only.
**Why**: Constitution I — the HTTP body carries a role, the server picks the argv; the phone and the tile's palette need a tap-reachable launch; the IceWM toolbar rows, the CLI, and HTTP must agree on which binary "the terminal" is.
**Rejected**: exposing `exec` over HTTP (arbitrary command execution from the dashboard); resolving in the frontend (the browser cannot see the host's PATH).
*Introduced by*: 260910-2jl3-gui-desktop-icewm-and-launcher

### WM helpers are excluded from the apps list by name, not ancestry
**Decision**: `RunningApps` drops a fixed comm-name set (`icewm-session, icewm, icewmbg, icewmtray, icesound, icewmhint, openbox, xfwm4, i3, kwin_x11, xsetroot`) after the pid-tree excludes.
**Why**: apps launched from the IceWM toolbar are children of `icewm` — an ancestry rule would hide exactly the apps the toolbar exists to launch; `icewm ×1` in the off-confirm dialog is noise.
**Rejected**: excluding the WM's whole process subtree; excluding by `DISPLAY` env owner (every X client has it).
*Introduced by*: 260910-2jl3-gui-desktop-icewm-and-launcher

### The three stamps land in one burst before the WM starts
**Decision**: the supervisor resolves the WM (pin or ladder), resolves the launcher apps, seeds the profile, and only then stamps `@rk_gui_display`, `@rk_gui_backend`, `@rk_gui_wm` together, then starts the WM.
**Why**: `rk gui on` reads the stamps once with a single bounded await; stamping `wm` after the WM start would race that read and print a bare `started (…)` for a healthy desktop. Seeding needs no X server, so nothing is delayed.
**Rejected**: a second await for `wm` (a second timeout budget for one line of output); stamping `wm` from the daemon's probe tick (the daemon does not know which rung won).
*Introduced by*: 260910-2jl3-gui-desktop-icewm-and-launcher

### Install hints are package-manager-aware wording only
**Decision**: `PackageManager(lookPath)` probes `apt-get → dnf → pacman` by presence; every hint string (`InstallHint`, `WMInstallHint`, `LaunchHint`, `NoBackendReason`) is built from it; nothing is ever executed.
**Why**: the toolkit `install-composition` standard — probe, degrade, hint; a Fedora or Arch user should not be told an apt line. Non-apt package names are best-effort wording.
**Rejected**: running a package manager from rk (install stays host-owned — rk probes, degrades, hints); a single generic sentence (unactionable on the common apt host).
*Introduced by*: 260910-2jl3-gui-desktop-icewm-and-launcher

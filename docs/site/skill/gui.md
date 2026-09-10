# run-kit skill: gui

Depth for one job: **driving and screenshotting the host GUI display** — the host's desktop, run by the `rk-gui` session and rendered for the human as the GUI tile: they see the same pixels you act on. This is a static topic page (`rk skill gui`); the [core bundle](../skill.md) covers when to reach for run-kit at all. Everything here is byte-identical on every invocation.

Reach for it when the job needs a real display: chromium, `xdg-open`, Playwright headed mode, or a computer-use loop with `xdotool`. One screen per host (`id = host`), shared with the human.

Gate first — run-kit is optional, and the GUI surface exists **only when the user turned it on**:

```sh
command -v rk >/dev/null 2>&1 || exit 0
rk gui status    # "gui: off" / "gui: on (…)" / "gui: on — not running (…)"
```

- `gui: off` → **stop. Tell the user `rk gui on` is theirs to run — never run it yourself.** The switch is the user's (it starts a desktop on their host).
- `gui: on — not running (…)` → the reason names the fix; `rk gui restart` is reasonable to suggest, still the user's call.
- `gui: on (<backend>, :N, …)` → the display is live; `:N` is its DISPLAY.

Every `rk gui` verb below refuses with exit 1 and the same hints when the gate fails, so a missed check fails loudly, not silently.

## `rk gui env` — get DISPLAY into your shell

```sh
eval "$(rk gui env)"    # exports DISPLAY=:N and RK_GUI_SOCKET=<path>
```

Prints the two export lines when the display is live; exits 1 with the hint otherwise. This is the read at use-time — nothing needs to be stored. `rk agent setup` installs exactly this eval into the user's shell startup files (a marker-owned `rk gui display` block, gated on `$TMUX_PANE` and an unset `DISPLAY`), so **new shells inside panes land on the display automatically once the user runs `rk gui on`**. A shell started before that does not get DISPLAY — run the eval yourself, or use `rk gui exec` per command.

## `rk gui exec` — run a command on the display

```sh
rk gui exec xterm                          # foreground: rk is replaced by the app
rk gui exec --detach chromium https://example.com   # launch and return
rk gui exec -d xdotool key ctrl+l          # drive the display
rk gui exec -- xdotool key --clearmodifiers minus   # `--` ends flag parsing
```

Runs the command with `DISPLAY` pointed at the rk display (an existing `DISPLAY` is **overridden** — the rk display is the point) and `RK_GUI_SOCKET` set. Foreground is a process-replacing passthrough: the app's tty, signals, and exit status are its own — good for one-shot tools like `xdotool`. `--detach` (`-d`) starts the app as its own session with stdio on `/dev/null`, prints `started <pid> on :N`, and returns — the shape a Bash tool needs for a long-lived app (it would otherwise time out on a foreground chromium). Unknown program → `error: <cmd>: not found on PATH`, exit 1.

## `rk gui launch` — the allowlisted terminal/browser launcher

```sh
rk gui launch terminal    # started x-terminal-emulator (pid 12345) on :10
rk gui launch browser
```

The argument is a **role, never an arbitrary command** (that is `rk gui exec`). Each role resolves server-side through a fixed ladder of known binaries — terminal `x-terminal-emulator, xterm, uxterm, lxterm, foot, alacritty, kitty, gnome-terminal, xfce4-terminal`; browser `chromium, chromium-browser, google-chrome, google-chrome-stable, firefox, x-www-browser` — first on PATH wins, dangling Debian alternatives skipped. **Prefer it over `exec --detach` for these two roles**: one ladder is shared by this verb, the dashboard's `POST /api/gui/{id}/launch`, and the IceWM toolbar, so "the terminal" is the same binary everywhere. Nothing on the ladder → exit 1 with the package-manager-aware install line (`no browser on the GUI host — sudo apt install chromium-browser`); the HTTP twin returns `200 {"ok":false,"app","hint"}` instead, so the dashboard toasts the hint through the success path. A bad role is a usage error (exit 2).

## `rk gui shot` — screenshot the display

```sh
rk gui shot                    # prints an absolute temp PNG path
rk gui shot --out /tmp/x/y.png # creates the parent dir, overwrites
```

stdout is **only the absolute PNG path** — read that file to *look* at the display. Uses the first tool on PATH: `import` (ImageMagick), then `scrot`, then `xwd`+`convert`. None installed → exit 1 with `sudo apt install imagemagick`. Screenshot tools are never installed for you; the same goes for `xdotool` (`sudo apt install xdotool`).

## The IceWM profile directory

With IceWM (the window-manager ladder head) the desktop runs off a seeded profile at `$XDG_STATE_HOME/run-kit/gui/icewm/` (dir 0700, files 0600), passed to icewm as `ICEWM_PRIVCFG`. Two file classes: `preferences` is **write-once** — seeded when absent, the user's edits persist, delete it to re-seed; `toolbar` and `menu` are **regenerated on every `rk gui supervise` start** from the launcher ladders, rows only for binaries that resolve (the header comment says so) — edit `preferences` instead. Deleting the whole directory restores every default on the next start.

## Recipe: the screenshot loop

The computer-use loop: act with `xdotool`, look with `shot`, repeat — the human watches the same pixels in the GUI tile.

```sh
rk gui env >/dev/null 2>&1 || { echo "ask the user to run: rk gui on"; exit 0; }   # env exits 1 when off/not running (status always exits 0, so it cannot gate)
rk gui exec --detach chromium https://example.com   # started <pid> on :N
sleep 2                                             # let it paint
rk gui shot                                          # /tmp/rk-gui-shot-<ts>.png
# → read the PNG, decide the next action
rk gui exec xdotool key ctrl+l                       # focus the address bar
rk gui exec xdotool type "https://docs.example.com"
rk gui exec xdotool key Return
rk gui shot --out /tmp/after-nav.png                 # verify
rk notify "docs page is up on the GUI tile" --title gui   # optional heads-up
```

Pairing: `rk notify` for out-of-band pings, `rk present` when the content is HTML/URL-shaped and a web tile suits it better than the desktop (see `rk skill display`).

## Exit codes

- `0` success — stdout carries only the datum (`rk gui shot`: the PNG path; `exec --detach`: the `started <pid> on :N` line; `launch`: `started <name> (pid <n>) on :N`; `rk gui env`: the export lines). Diagnostics go to stderr.
- `1` operational — the gate refusals (`gui is off — turn it on with 'rk gui on'` / `gui is on but not running — see 'rk gui status'`), `not found on PATH`, nothing on a launch role's ladder (the install line), a failed screenshot tool (`error: <tool> failed: <stderr tail>`), no screenshot tool installed (the apt hint).
- `2` usage — missing command word, stray arg, unknown flag, a launch role other than `terminal`/`browser`. A literal `--` ends flag parsing for `exec`.

## Gotchas

- **macOS is view-only** — the surface mirrors the user's live session; `exec` and `shot` refuse with a not-supported message. Nothing runs under rk's control there.
- **DISPLAY lands in new shells** — the installed block runs at shell start; a shell opened before `rk gui on` keeps its old env. `eval "$(rk gui env)"` or `rk gui exec` covers it.
- **The display is shared with the human** — they may be watching or driving the same pointer. Don't fight their pointer; announce big moves with `rk notify`.
- **Apps you start die with `rk gui off`** — the switch kills the `rk-gui` session and everything on the display (the user confirms first). Detached apps survive your shell, not the switch.
- **A pre-set DISPLAY wins in your shell** — the installed block never overrides one (a desktop Linux session, SSH X-forwarding); `rk gui exec` always targets the rk display explicitly.

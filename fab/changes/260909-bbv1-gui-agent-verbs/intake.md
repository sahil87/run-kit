# Intake: GUI Agent Verbs — `rk gui exec`, `rk gui shot`, DISPLAY export, `rk skill gui` (plan C4)

**Change**: 260909-bbv1-gui-agent-verbs
**Created**: 2026-09-09

## Origin

One-shot `/fab-new` invocation by a pickup agent following the plan's pickup protocol
(`fab/plans/sahil/26-09-09-gui-surface.md` § Pickup protocol). Raw input:

> gui-agent-verbs Plan: fab/plans/sahil/26-09-09-gui-surface.md -- implement C4 (agent verbs:
> rk gui exec, rk gui shot, rk agent setup DISPLAY export, rk skill gui, docs/memory gui.md
> hydrate) per the plan's change breakdown and pickup protocol. C2
> (260909-fkh1-gui-backend-switch-and-relay, PR #892) merged -- the backend switch, supervisor,
> relay, and gui: state payload now exist on main; a sibling worker is starting C3 (the frontend
> tile) in parallel, so avoid touching frontend files. Before starting, read the plan file in full
> (including the C0 verdict), docs/specs/gui.md (created by C1), fab/project/constitution.md
> (especially Constitution X on read-time derivation, no hook pushes), and the lenses-and-layout,
> configuration, daemon-lifecycle memory files, plus internal/gui and cmd/rk/gui.go on main to see
> C2's actual shipped shapes and existing rk gui subcommands rather than assuming the plan's draft
> names are exact. Treat the plan's Decision log (D1-D10) as Certain in SRAD scoring. After merge,
> fill in the C4 row (change folder / PR) in the plan's tracking table in the same PR.

Design authority (read in full before this intake): the plan (decision log D1–D10, § C4, § C0
verdict), the design study `docs/wiki/gui-surface-design-study.html` § 10 "The agent side",
`docs/specs/gui.md` § Agent verbs, Constitution I/II/IV/X, and the shipped C2 shapes in
`app/backend/cmd/rk/gui.go`, `app/backend/cmd/rk/gui_supervise.go`, `app/backend/internal/gui/`,
`app/backend/internal/daemon/gui.go`, plus the memory files `run-kit/gui.md` (C2's hydrate — the
backend half already documented), `run-kit/configuration.md`, `run-kit/daemon-lifecycle.md`,
`run-kit/agent-state.md` (§ `rk agent setup`), `run-kit/tmux-guard-shim.md`, and
`run-kit/ui/lenses-and-layout.md`.

Key facts established from the shipped C2 code (these bind the design below):

- `rk gui` already ships `on | off [--yes] | status [--json] | env | restart` plus the hidden
  `supervise <id> --display :N`. The parent's `Long` carries a `Subcommands:` list; children are
  wrapped by the `usageArgs` loop (arg-count violations exit 2).
- `rk gui env` prints `export DISPLAY=:N` and `export RK_GUI_SOCKET=<path>` and is gated
  enabled+reachable with these exact errors (exit 1): `gui is off — turn it on with 'rk gui on'`
  and `gui is on but not running — see 'rk gui status'`.
- Status derivation is owned once: `gatherGUIStatus(ctx)` → `gui.Assemble(ctx, gui.StatusDeps{…})`
  returns `gui.Status{ID, Enabled, Backend, Reachable, Display, Width, Height, Viewers, Socket,
  Session, Reason, Apps, UptimeSeconds}`. The disabled short-circuit runs first (one settings
  file read, no tmux command), then the daemon gate, stamps, probe.
- The supervisor stamps `@rk_gui_display :N` / `@rk_gui_backend <bin>` on the `rk-gui` session
  (`daemon.GUIOptionDisplay`/`GUIOptionBackend`; reader `daemon.GUISessionOptions(ctx)
  (display, backend string, ok bool)`). The WM is launched with only `DISPLAY=:N` added to its
  env — Xtigervnc runs with no `-auth`, so no `XAUTHORITY` exists or is needed.
- macOS: backend `screen-sharing`, view-only (D6); nothing runs under rk's control; no X display.
- `rk agent setup` (`cmd/rk/agent_setup.go`) manages two artifact families: per-agent hooks and
  the user-global tmux guard shim + a marker-owned `PATH` block (`# >>> rk tmux guard >>>` /
  `# <<< rk tmux guard <<<`) upserted via `upsertMarkerBlock`/`removeMarkerBlock` into
  `tmuxGuardStartupFiles(home, zdotdir)` = `$ZDOTDIR/.zshenv` (else `~/.zshenv`), `~/.bashrc`,
  and `~/.bash_profile` only when it already exists. Consent/diff/dry-run/uninstall machinery:
  `consent.authorizeWrite`, `renderArtifactDiff`, `resolveRkPath` + `validateHookPath`.
- `rk skill` topics live in `docs/site/skill/<topic>.md` (canonical) and are synced by
  `scripts/sync-skill.sh` into `app/backend/cmd/rk/skill/<topic>.md`, embedded in `skill.go`
  (`skillTopics` map), drift-guarded and line-budgeted (≤150, `countLines`) by three table-driven
  tests in `skill_test.go`. The core bundle `docs/site/skill.md` is at 105 lines.
- `docs/memory/run-kit/gui.md` already exists (C2's hydrate, backend half) and states that the
  agent verbs are "separate, later surfaces" — this change extends it rather than creating it.
- On this VM: `import`, `convert`, `xwd`, `scrot`, `xdotool`, `xwininfo`, `Xtigervnc`, `openbox`
  are all installed — the acceptance can be exercised for real.

Interaction mode: no clarifying questions were needed — the decision log is binding (Certain per
the invocation), and every remaining decision grades Confident or better (§ Assumptions).

## Why

**The problem.** After C2 the host desktop exists (`rk gui on` → a live Xvnc display on a unix
socket, relayed over `/ws/gui/host`), but only a human can use it, and only once C3 ships the tile.
An agent running in a pane has no way to (a) put an app on that display, (b) see what is on it, or
(c) find the display at all without knowing about `rk gui env`. The study's § 10 names this as
"the reason to build the feature: an agent gets a computer" — chromium, `xdg-open`, Playwright
headed mode, and a computer-use loop with `xdotool` only work if `DISPLAY` reaches the agent's
processes and the agent can take a screenshot to look at the result.

**If we don't.** The GUI surface stays a human-only viewer. Agents keep describing UIs in prose or
falling back to headless screenshots that never match what the human sees in the tile; the
"agent drives, human watches from the phone" loop the plan is built around never closes.

**Why these verbs and this shape.** The plan (§ C4) fixes the surface: `rk gui exec <cmd…>` (the
`rk code exec` shape — a shell-side verb that acts on a surface), `rk gui shot [--out <png>]`, the
`DISPLAY` export in `rk agent setup`, and an `rk skill gui` topic page so the agent learns the
loop at use-time. Two constraints shape the mechanics:

- **Constitution X / II — read-time derivation, never a hook push.** The display is already a
  derived fact (`@rk_gui_display` on the `rk-gui` session); the "export into managed panes" must
  be a read at shell start, not a value pushed into panes by a hook. The existing `rk gui env`
  verb IS that read. So `rk agent setup` installs a marker-owned shell-startup block that
  `eval`s `rk gui env` when inside a tmux pane — the same installer, consent and marker
  machinery as the tmux guard PATH block. Nothing is stored; turning the GUI on later needs no
  re-setup because the block gates at read time.
- **D3 — off by default, user's choice.** Every verb is gated enabled+reachable with exit 1 and
  the `rk gui on` hint; no verb ever flips the switch. The skill page tells agents the same.

Alternatives rejected: pushing `DISPLAY` into tmux server environments (`tmux set-environment -g`)
on `rk gui on` — a second source of truth that must be swept across every server and unset on
`off`, and a push rather than a derivation; teaching each agent hook to export it — hooks are
subprocesses and cannot set a shell's env, and Constitution X forbids pushing derivable facts.

## What Changes

All Go work is in `app/backend/cmd/rk/` (new files beside `gui.go`: `gui_exec.go`, `gui_shot.go`,
tests) plus `agent_setup.go`, `skill.go`, `scripts/sync-skill.sh`, and docs. **No frontend files
are touched** (C3 runs in parallel).

### 1. `rk gui exec <cmd> [args…]` — run a command on the GUI display

Registered on `guiCmd` (inside the `usageArgs` wrap loop, so a missing command is a usage error,
exit 2). `Use: "exec <cmd> [args…]"`, `Args: cobra.MinimumNArgs(1)`; a literal `--` ends flag
parsing so dash-prefixed program args pass through.

Gate (in this order; each failure prints the error and exits 1):

1. `runtime.GOOS == "darwin"` ⇒ `rk gui exec is not supported on macOS in v1 — the GUI mirrors
   your live session view-only` (D6: no X display exists to run on).
2. `st := gatherGUIStatus(ctx)`; `!st.Enabled` ⇒ `gui is off — turn it on with 'rk gui on'`;
   `!st.Reachable` ⇒ `gui is on but not running — see 'rk gui status'` (byte-identical to
   `rk gui env`'s errors — one hint vocabulary; extract them as shared constants/helpers).

Run: the environment is the caller's `os.Environ()` with `DISPLAY=<st.Display>` and
`RK_GUI_SOCKET=<st.Socket>` set (an existing `DISPLAY` is **overridden** — the verb's whole point
is "on the rk display"); cwd is inherited; the program is resolved with `exec.LookPath`.

- **Foreground (default)**: the process is **replaced** via `syscall.Exec(path, argv, env)` — the
  `rk mux guard` passthrough idiom — so signals, the tty, and the child's exit status belong to
  the command with no relay code and no timeout (a GUI app runs indefinitely; Constitution I's
  timeout rule governs subprocesses rk *waits on*, and the exec passthrough waits on nothing).
  `LookPath` failure ⇒ `error: <cmd>: not found on PATH`, exit 1.
- **`--detach` / `-d`**: start the command as its own session (`SysProcAttr{Setsid: true}`),
  stdin/stdout/stderr on `/dev/null`, do not wait, print `started <pid> on <display>` to stdout
  (Dataf), exit 0. This is the shape agents need: their Bash tools time out on a foreground
  chromium, and `nohup … &` from a pane is the manual equivalent. Start failure ⇒ exit 1.

Help text example block:

```
rk gui exec xterm                          # runs in the foreground on the GUI display
rk gui exec --detach chromium https://example.com
rk gui exec xdotool key ctrl+l             # drive the display; pair with rk gui shot
```

Package seams (the `gui.go` idiom): `guiExecLookPathFn = exec.LookPath`, `guiExecFn =
syscall.Exec`, `guiExecStartFn` (the detached start), `guiExecGOOS = runtime.GOOS`, so tests drive
every branch without an X server. The env composition is a pure helper
`guiExecEnv(base []string, display, socket string) []string` (dedupes an existing `DISPLAY`/
`RK_GUI_SOCKET`), unit-tested directly.

### 2. `rk gui shot [--out <png>]` — screenshot the display

`Use: "shot"`, `Args: cobra.NoArgs`, flag `--out <path>` (`-o`). Same gate as `exec` (macOS ⇒
`rk gui shot is not supported on macOS in v1 — the GUI mirrors your live session view-only`;
off/not-running ⇒ the shared hints; all exit 1).

Tool ladder — probe with `LookPath`, first hit wins (a pure `guiShotArgv(lookPath, display, out)
(argv [][]string, tool string, ok bool)` returns the command pipeline to run):

| # | Tool | Invocation (argv slices, never a shell string) |
|---|------|-----------------------------------------------|
| 1 | `import` (ImageMagick) | `import -display :N -window root <out>` |
| 2 | `scrot` | `scrot <out>` with `DISPLAY=:N` in the env (scrot has no display flag) |
| 3 | `xwd` + `convert` | `xwd -display :N -root -silent` piped into `convert xwd:- <out>` (both must be present; stdout of the first is the stdin of the second, wired in Go) |

None present ⇒ `no screenshot tool found (tried import, scrot, xwd+convert) — sudo apt install
imagemagick`, exit 1. Each subprocess runs under `exec.CommandContext` with a 15 s timeout
(`guiShotTimeout` var). A non-zero tool exit ⇒ `error: <tool> failed: <stderr tail>`, exit 1.

Default `--out`: `<os.TempDir()>/rk-gui-shot-<YYYYMMDD-HHMMSS>.png` (never litters the agent's
cwd; the OS owns temp cleanup; not the run-kit state dir — Constitution II keeps that tenant for
droppable rk-owned files, and screenshots accumulate). An explicit `--out` is used verbatim (made
absolute), its parent created with `MkdirAll` 0755, an existing file overwritten (the `rk present`
re-run-to-refresh idiom). Success prints **only the absolute PNG path** to stdout (Dataf — data,
survives `--quiet`); diagnostics go to stderr. Exit 0.

Seams: `guiShotLookPathFn`, `guiShotRunFn` (runs one argv pipeline under the timeout),
`guiShotNowFn`, `guiShotGOOS`.

### 3. `rk agent setup` exports `DISPLAY` into managed panes — the gui display block

A **third managed artifact family** beside the per-agent hooks and the tmux guard shim, applied
once after `applyTmuxShim` in `runAgentSetup` (user-global, not per agent):
`applyGuiDisplayBlocks(sink, reader, home, zdotdir, rkPath, uninstall, cons)`. It upserts (or on
`--uninstall` removes) a marker-owned block into **the same startup files as the guard PATH
block** (`tmuxGuardStartupFiles(home, zdotdir)`), using the existing `upsertMarkerBlock` /
`removeMarkerBlock` / `markerBlockBounds` machinery, with the same malformed-block refusal, the
same in-position replacement, the same consent flow (`authorizeWrite`; diff on `--dry-run`, a
one-line summary otherwise), and the same "absent ⇒ silent on uninstall" rule.

Block content (exact; `<abs-rk>` is the `resolveRkPath`/`validateHookPath`-validated absolute
binary path the shim already embeds — PATH-independent at read time, double-quoted, shell-unsafe
chars rejected upstream):

```sh
# >>> rk gui display >>>
[ -n "$TMUX_PANE" ] && [ -z "${DISPLAY-}" ] && eval "$("<abs-rk>" gui env 2>/dev/null)"
# <<< rk gui display <<<
```

Semantics — **read-time derivation, never a push** (Constitution X): every new shell inside a tmux
pane asks `rk gui env` for the supervisor's stamped display; the block is installed regardless of
whether the GUI is currently enabled (it is inert while off — `rk gui env` prints nothing to stdout
and exits 1, so `eval ""` is a no-op — and starts working the moment someone runs `rk gui on`,
with no re-setup). `[ -z "${DISPLAY-}" ]` keeps a real X session's `DISPLAY` (a desktop Linux
user, SSH X-forwarding) untouched and skips the exec in nested shells; `rk gui exec` remains the
explicit way to target the rk display from such a shell. `[ -n "$TMUX_PANE" ]` scopes it to
tmux panes — the same gate the installed agent hooks use. Cost: one `rk` exec per shell start;
with the GUI off that is `settings.Load()` and exit (no tmux command — `Assemble`'s disabled
short-circuit), which matters because `.zshenv` runs for every non-interactive `zsh -c` an
agent's Bash tool spawns. A shell started before `rk gui on` does not get `DISPLAY` until the
next shell — documented in the skill page; `eval "$(rk gui env)"` or `rk gui exec` covers it.

Install gating differs from the PATH block in one way: the gui block does NOT depend on the shim
being in place (it embeds the rk path directly, fronting nothing). Uninstall strips it from every
startup file, other content byte-intact. `rk agent setup --dry-run` previews the block per file.
Constants: `guiDisplayBlockBegin`/`guiDisplayBlockEnd`, `guiDisplayBlock(rkPath) string`.

### 4. `rk skill gui` — the topic page + core-bundle lines

- New canonical `docs/site/skill/gui.md` (≤150 lines, static-only, no live values), synced by a
  new row in `scripts/sync-skill.sh` to `app/backend/cmd/rk/skill/gui.md`, embedded as
  `skillGuiTopic` and registered as `skillTopics["gui"]` in `skill.go`; rows added to the three
  tables in `skill_test.go` (byte-identical print, canonical drift guard, line budget). The
  `Topics:` help line enumerates it automatically (`skillTopicNames()`).
- Content: what the GUI surface is (one screen per host, the human sees the same pixels in the
  tile); **gate first** — `command -v rk`, then `rk gui status`/exit codes (off ⇒ tell the user
  `rk gui on` is theirs to run, never run it yourself — D3); `eval "$(rk gui env)"` vs the
  installed block; `rk gui exec` (foreground vs `--detach`, dash-args after `--`); `rk gui shot`
  (default path, `--out`, read the PNG to *look*); the **screenshot loop** with `xdotool`
  (`rk gui exec xdotool …` → `rk gui shot` → inspect → repeat); pairing with `rk notify` /
  `rk present`; output & exit-code contracts (0/1/2, stdout = path/started line only); gotchas
  (macOS is view-only — exec/shot refuse; `DISPLAY` lands in *new* shells; the display is shared
  with the human — don't fight their pointer; apps you start die with `rk gui off`; no install
  is performed for you — `imagemagick`/`xdotool` hints).
- `docs/site/skill.md` (core, 105 lines): one topic-index line (`**drive and screenshot the host
  GUI display** … → \`rk skill gui\``) and one capability line (`rk gui exec <cmd…>` /
  `rk gui shot [--out f.png]` — gated on the switch; depth: `rk skill gui`). Stays ≤150.

### 5. `rk gui` help text, doctor, help-dump

- `guiCmd.Long`'s `Subcommands:` list gains `exec` and `shot` rows; `rk gui env`'s help gains a
  pointer to the installed block ("`rk agent setup` installs this eval into your shell startup
  files").
- No doctor change (the `gui` row already reports the switch/backend); the `shll standards`
  help-dump/P9 audit is run for the two new verbs and recorded in `toolkit-standards.md`.

### 6. Docs and plan bookkeeping (same PR)

- `docs/specs/gui.md` § Agent verbs: the human-curated spec already lists the verbs; hydrate may
  propose the two refinements this change fixes (`--detach`; macOS refuses `exec` as well as
  `shot`).
- `fab/plans/sahil/26-09-09-gui-surface.md`: fill the C4 row (change folder
  `260909-bbv1-gui-agent-verbs`, PR URL, status), and update the "Status (2026-09-09)" line.
- Memory hydrate per § Affected Memory.

### Acceptance (from the plan, made concrete)

- Fresh pane with the switch **on** and the display reachable: `rk gui exec --detach chromium
  https://example.com` prints `started <pid> on :N`, exits 0, and the page appears on the
  display (visible in the tile once C3 lands; `rk gui status` shows `chromium ×k` in `apps:`);
  `rk gui shot` prints an absolute `.png` path under the temp dir and the file is a valid PNG of
  the display; `rk gui shot --out /tmp/x/y.png` creates the dir and writes there.
- Switch **off**: `rk gui exec xterm` and `rk gui shot` both exit 1 printing
  `gui is off — turn it on with 'rk gui on'`; nothing is written and no process is started.
- On but not running (backend killed): both exit 1 with `gui is on but not running — see 'rk gui
  status'`.
- `rk gui exec` with no command ⇒ exit 2 (usage). Unknown program ⇒ exit 1 `not found on PATH`.
- `rk agent setup --yes` writes the `rk gui display` block into `.zshenv`/`.bashrc` (and an
  existing `.bash_profile`); a new `zsh -c 'echo $DISPLAY'` inside a tmux pane prints `:N` when
  the GUI is on and reachable, and an empty string when off; `--uninstall` strips the block with
  every other line byte-identical; `--dry-run` shows the diff and writes nothing; a pre-set
  `DISPLAY` is left untouched.
- `rk skill gui` prints the page byte-identical to `docs/site/skill/gui.md` with empty stderr,
  exit 0; `rk skill topics` lists `gui`; `rk skill --help` names it; core and topic pages ≤150.
- Go tests: `cd app/backend && go test ./...` green — exec gating (off / not running / darwin),
  env composition, `--detach` start path, `not found` path; shot ladder selection per available
  tools + argv per tool, default path shape, `--out` handling, no-tool error, darwin refusal;
  agent setup block upsert/remove/dry-run/malformed-block refusal; skill drift/budget rows.
- `cd app/frontend && npx tsc --noEmit` untouched (no frontend files change); `just build` green.

## Affected Memory

- `run-kit/gui`: (modify) new § Agent verbs — `rk gui exec` (gate, env, exec passthrough,
  `--detach`), `rk gui shot` (tool ladder, default path, output contract), the `rk agent setup`
  gui display block (read-time derivation), macOS refusals; drop the "agent verbs are a later
  surface" caveat from the overview; Design Decisions for the shell-block mechanism, the exec
  passthrough, the temp-dir default, and the `--detach` flag.
- `run-kit/agent-state`: (modify) § `rk agent setup` — the third managed artifact family (gui
  display block) beside hooks and the guard shim; § Installer Structure step 3.
- `run-kit/tmux-guard-shim`: (modify) note that the startup-file set (`tmuxGuardStartupFiles`) is
  now shared with the gui display block and that the two blocks are independent on install.
- `run-kit/toolkit-standards`: (modify) the `skill` standard covers the `gui` topic page + the
  core-bundle rows; the help-dump/P9 new-surface audit for `rk gui exec|shot`.
- `run-kit/architecture`: (modify) CLI subcommands line — `rk gui` family gains `exec`/`shot`;
  `rk agent setup`'s artifact families.
- `run-kit/configuration`: (no change expected) — the block lives in shell startup files, not
  config.yaml; verify the Boundaries table needs no row.

## Impact

- **Code**: `app/backend/cmd/rk/gui.go` (help text, shared gate helpers), new `gui_exec.go` +
  `gui_exec_test.go`, new `gui_shot.go` + `gui_shot_test.go`, `agent_setup.go` (+ tests) for the
  gui display block, `skill.go` + `skill_test.go`, `app/backend/cmd/rk/skill/gui.md` (synced
  copy), `scripts/sync-skill.sh`.
- **Docs**: new `docs/site/skill/gui.md`; `docs/site/skill.md` (+2 lines); `docs/specs/gui.md`
  (small refinement, human-curated — proposed at hydrate); the plan's tracking table.
- **Runtime surface**: two new `rk gui` verbs; one new marker-owned block in the user's shell
  startup files written only by the explicit, consented `rk agent setup`; one new `rk skill`
  topic. No new routes, settings keys, env keys (`DISPLAY`/`RK_GUI_SOCKET` are shell outputs of
  the existing `rk gui env`, not config inputs), tmux options, or frontend changes.
- **Dependencies**: none added. Screenshot tools are probed at run time, never installed.
- **Security** (Constitution I): every subprocess is an argv slice; the screenshot pipeline runs
  under a 15 s context timeout; the exec passthrough carries the caller's own argv (their shell
  authority, the `rk daemon run` posture); the shell block embeds only the validated absolute rk
  path (`validateHookPath` rejects shell-active characters).
- **Parallel work**: C3 (frontend tile) touches `app/frontend/**` only; this change touches none
  of it. The plan file's tracking table is edited by both — a trivial merge on distinct rows.

## Open Questions

- None blocking. Hydrate should confirm with the user whether `docs/specs/gui.md` § Agent verbs
  should record the `--detach` flag and the macOS `exec` refusal (spec is human-curated).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The plan's decision log D1–D10 is binding — in particular D3 (off by default; no verb flips the switch), D6 (macOS view-only ⇒ no X display for agents), D10 (out-of-scope list) | Invocation instructs treating D1–D10 as Certain; spec + plan restate them | S:95 R:90 A:95 D:95 |
| 2 | Certain | Verb names and surface exactly `rk gui exec <cmd…>` and `rk gui shot [--out <png>]`, both gated enabled+reachable with exit 1 and the `rk gui on` hint | Plan § C4 and `docs/specs/gui.md` § Agent verbs name them; the hint strings already exist in `rk gui env` | S:90 R:85 A:95 D:95 |
| 3 | Certain | Gate strings are byte-identical to `rk gui env`'s (`gui is off — turn it on with 'rk gui on'` / `gui is on but not running — see 'rk gui status'`), derived via the shared `gatherGUIStatus` → `gui.Assemble` | One hint vocabulary; the assembler is the single status owner (C2 design decision) | S:80 R:90 A:95 D:90 |
| 4 | Certain | No frontend files are touched | Invocation: C3 runs in parallel on the tile | S:95 R:95 A:95 D:95 |
| 5 | Certain | `docs/memory/run-kit/gui.md` is extended, not created — it already exists from C2's hydrate | Verified on main; C2 intake assumption 22 anticipated exactly this | S:90 R:95 A:100 D:100 |
| 6 | Confident | `DISPLAY` export mechanism = a marker-owned shell-startup block written by `rk agent setup` into the guard PATH block's startup files, body `[ -n "$TMUX_PANE" ] && [ -z "${DISPLAY-}" ] && eval "$("<abs-rk>" gui env 2>/dev/null)"` | Read-time derivation (Constitution X) reusing the shipped `rk gui env`; the installer already owns marker blocks in these files; rejected `tmux set-environment` pushes as a second source of truth | S:70 R:75 A:75 D:65 |
| 7 | Confident | The block is installed regardless of `gui.enabled` and is inert while off; a pre-set `DISPLAY` wins; `$TMUX_PANE` scopes it to panes | Off ⇒ `rk gui env` prints nothing → no-op; enabling later needs no re-setup; not clobbering a real X session is the safe default | S:65 R:85 A:80 D:70 |
| 8 | Confident | Foreground `rk gui exec` replaces the process via `syscall.Exec` (no timeout, child's exit status passes through); `LookPath` failure exits 1 | The `rk mux guard` passthrough precedent; a GUI app runs indefinitely so a wait-timeout is wrong; Constitution I governs subprocesses rk waits on | S:60 R:80 A:80 D:65 |
| 9 | Confident | `rk gui exec --detach`/`-d` starts the command in its own session with stdio on /dev/null and prints `started <pid> on :N` | Agents' Bash tools time out on foreground GUI apps; the study's chromium/Playwright use case needs a detached start; small, additive flag | S:55 R:85 A:75 D:60 |
| 10 | Certain | `exec` sets `DISPLAY` and `RK_GUI_SOCKET` (overriding an existing `DISPLAY`), inherits cwd, sets no `XAUTHORITY` | Same two vars `rk gui env` prints; Xtigervnc runs with no `-auth` (C2's WM launch sets only `DISPLAY`); the verb's purpose is "on the rk display" | S:70 R:90 A:85 D:80 |
| 11 | Confident | `exec` refuses on macOS in v1 with the view-only message, like `shot` | D6: no X display exists on the mirror backend; the plan specifies the refusal only for `shot`, but `exec` has nothing to run on | S:60 R:90 A:85 D:75 |
| 12 | Confident | Screenshot tool ladder `import` → `scrot` → `xwd`+`convert`, probed at run time; none ⇒ exit 1 with the `imagemagick` hint | Plan names `import -window root` or `xwd`+`convert` and "probe what's installed"; `scrot` is a cheap common extra; order is trivially reversible | S:65 R:90 A:80 D:65 |
| 13 | Confident | Default `--out` is `<os.TempDir()>/rk-gui-shot-<YYYYMMDD-HHMMSS>.png`; stdout carries only the absolute path; `--out` overwrites and creates its parent | Never litters the agent's cwd; Constitution II keeps the state tenant for rk-owned droppables; `rk present` prints-only-the-datum idiom | S:55 R:90 A:75 D:60 |
| 14 | Certain | Screenshot subprocesses run under a 15 s `exec.CommandContext` timeout | Constitution I / Process Execution rule; a root-window grab is sub-second | S:60 R:95 A:90 D:85 |
| 15 | Certain | `rk skill gui` is a topic page at `docs/site/skill/gui.md` (≤150 lines) wired through the existing sync script, embed, `skillTopics` map, and the three table-driven tests; the core bundle gains one topic-index line and one capability line | The shll `skill` standard's topic-page contract; `code.md` is the template; core is at 105 lines | S:80 R:90 A:95 D:90 |
| 16 | Confident | The skill page instructs agents never to run `rk gui on` themselves — the switch is the user's | D3's "exists only when the user has explicitly turned it on"; the hint text is for the human | S:70 R:90 A:85 D:80 |
| 17 | Certain | Plan tracking row C4 + the Status line are filled in this PR; spec refinements (`--detach`, macOS `exec`) are proposed at hydrate, not silently edited | Invocation + pickup protocol step 5; specs are human-curated per `docs/specs/index.md` | S:85 R:95 A:90 D:90 |

17 assumptions (10 certain, 7 confident, 0 tentative, 0 unresolved).

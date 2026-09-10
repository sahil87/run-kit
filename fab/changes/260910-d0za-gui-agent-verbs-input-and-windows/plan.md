# Plan: GUI Agent Verbs — windows, input, wait, capture upgrades, clipboard, open, lock (G3)

**Change**: 260910-d0za-gui-agent-verbs-input-and-windows
**Intake**: `intake.md`

## Requirements

> Design authority: `intake.md` § What Changes (which carries the plan's § Agent verbs block verbatim) and `fab/plans/sahil/26-09-10-gui-desktop.md` G-D10–G-D14. Every string quoted below is exact user-facing copy.

### GUI CLI: the shared contract

#### R1: One gate, one exit-code contract, datum-only stdout
Every new `rk gui` verb (`windows`, `focus`, `click`, `move`, `scroll`, `type`, `key`, `wait`, `clip`, `open`, `lock`, `unlock`) and every new flag on `shot`/`launch` MUST apply the existing gate in the existing order — `guiGOOS == "darwin"` ⇒ `guiDarwinRefusal(<verb>)`, then `guiRequireReachable(ctx)` ⇒ `guiErrOff` / `guiErrNotRunning` — exit 1; usage errors MUST exit 2 through the family's `usageArgs` re-wrap or `usageError`; every subprocess MUST be an argv slice under `exec.CommandContext` bounded by 10 s (captures keep `guiShotTimeout`); stdout MUST carry only the verb's datum (`Dataf`), diagnostics ride stderr (`Notef`). Every X tool MUST be probed with `LookPath` before use and a miss MUST refuse with the tool's apt hint (`xdotool not found — sudo apt install xdotool`); rk MUST NOT install anything. Existing verbs' stdout, default paths, gate strings, and exit codes MUST stay byte-identical.

- **GIVEN** `gui.enabled=false`
- **WHEN** any new verb runs
- **THEN** stderr is `gui is off — turn it on with 'rk gui on'`, exit 1, no subprocess started

- **GIVEN** a reachable display and `PATH` without `xdotool`
- **WHEN** `rk gui click 10 10` runs
- **THEN** stderr is `xdotool not found — sudo apt install xdotool`, exit 1; `rk gui shot` and `rk gui launch terminal` still work

### Window inventory

#### R2: `windows` and `focus`
`rk gui windows` SHALL list every visible top-level window on the display as rows `ID PID GEOMETRY TITLE` (geometry `WxH+X+Y`, sorted by X id, the active window's row suffixed ` *`); `--json` SHALL emit `[{id, pid, x, y, width, height, title, active, app}]` (`app` = `/proc/<pid>/comm`; `pid` 0 and `app` `""` when the client sets no `_NET_WM_PID`; no active mark when `getactivewindow` fails — neither is an error; an empty display emits `[]`). `rk gui focus <id>` / `focus --title <substr>` SHALL run `windowactivate --sync` on exactly one window; `--title` is a case-sensitive substring (regex-quoted before `xdotool search --name`); zero matches ⇒ `no window matches "<substr>"`, several ⇒ `ambiguous "<substr>": <n> windows match — <id> <title>, …`, a non-window id ⇒ `<id>: not a window` — all exit 1. Argv builders and the row parser SHALL be pure functions in `internal/gui/xdo.go`, table-tested without an X server.

- **GIVEN** an xterm on the display
- **WHEN** `rk gui windows --json` runs
- **THEN** one row carries its X id, a non-zero pid, `"app":"xterm"`, and its geometry

- **GIVEN** two windows whose titles contain `Terminal`
- **WHEN** `rk gui focus --title Terminal` runs
- **THEN** exit 1 with the `ambiguous` line naming both ids

### Input verbs

#### R3: `click`, `move`, `scroll`, `type`, `key`
Coordinates are display pixels, non-negative integers. `click <x> <y>` SHALL `mousemove` then `click 1`; `--right`/`--middle` pick buttons 3/2; `--double` is `click --repeat 2 --delay 100 1`; the three are mutually exclusive (usage); `--window <id>` SHALL add the window's `X`/`Y` from `getwindowgeometry --shell` (`--window <id>: not a window` on failure). `move <x> <y>` SHALL `mousemove`. `scroll <up|down|left|right> [--n 3] [--at x y]` SHALL move first when `--at` is given, then `click --repeat N --delay 30 <4|5|6|7>`; a bad direction is usage. `type <text>` / `type --stdin` SHALL split the text on `\n`, feed each segment to `xdotool type --delay 12 --file -` on stdin, and send `key Return` between segments (a trailing newline yields a trailing Return; empty text is a no-op); both an argument and `--stdin` is usage. `key <chord>…` SHALL run `key --clearmodifiers <chord>…` verbatim.

- **GIVEN** a focused terminal
- **WHEN** `rk gui type 'echo hello'` then `rk gui key Return` run
- **THEN** the terminal shows `hello`

- **GIVEN** `rk gui type --stdin` fed `a\nb\n`
- **THEN** xdotool receives `type` of `a`, `key Return`, `type` of `b`, `key Return`

#### R4: The human's pointer wins
Before acting, `click`, `move`, `scroll`, `type`, `key`, and `focus` — and only those — SHALL fetch the status document from the daemon (`GET <resolveOrigin>/api/gui/host`, 2 s timeout, package seam); when `human_input_ago_ms` is present and below `guiHumanInputGrace = 3 * time.Second` they SHALL refuse with `human input <N>s ago — retry or pass --force` (N = whole seconds, minimum 1), exit 1, unless `--force` is set. The guard SHALL fail open when the fetch fails. `windows`, `shot`, `wait`, `clip`, `open`, `launch`, `lock`, `unlock` SHALL never consult it.

- **GIVEN** the daemon reports `human_input_ago_ms: 1200`
- **WHEN** `rk gui click 10 10` runs
- **THEN** stderr is `human input 1s ago — retry or pass --force`, exit 1, no xdotool call; `--force` clicks

- **GIVEN** the daemon's HTTP origin refuses the connection
- **WHEN** `rk gui key Return` runs
- **THEN** the key is sent (fail-open)

### Capture

#### R5: `shot --scale | --max-width | --window`
`--scale <f>` (`0 < f ≤ 1`) and `--max-width <px>` SHALL be mutually exclusive (usage); `--max-width` derives `S = min(1, maxWidth/W)`. The source geometry `W×H` SHALL be the probe's `Width×Height` for the root and `getwindowgeometry` for `--window <id>` (`--window <id>: not a window` on failure). Resize SHALL ride ImageMagick: `import … -resize <S·100>%` inline; `convert <out> -resize <pct>% <out>` after `scrot`; `convert xwd:- -resize <pct>% <out>` after `xwd`. `--window` maps to `import -window <id>` / `xwd -id <id>`; on the scrot rung `--window` refuses with `--window needs imagemagick (import or convert) — sudo apt install imagemagick`; a scale with neither `import` nor `convert` refuses with `--scale needs imagemagick — sudo apt install imagemagick`. stderr SHALL always carry `geometry WxH scale S` (`Notef`); stdout stays the absolute PNG path; the PNG is `round(W·S) × round(H·S)`.

- **GIVEN** a 1920×1080 display
- **WHEN** `rk gui shot --scale 0.5` runs
- **THEN** stdout is the PNG path, stderr contains `geometry 1920x1080 scale 0.5`, the PNG is 960×540

- **WHEN** `rk gui shot` runs with no flags
- **THEN** stdout is unchanged from today and stderr carries `geometry 1920x1080 scale 1`

### Waiting

#### R6: `wait --window` and `wait --stable`
`wait --window <substr> [--timeout 10s]` SHALL poll `xdotool search --onlyvisible --name <quoted>` every 250 ms, print the first matching window id on stdout and exit 0, or `timed out after <timeout>` exit 1. `wait --stable [--interval 500ms] [--timeout 10s]` SHALL capture the root at scale 0.25 into the OS temp dir every interval, decode each PNG with `image/png` and SHA-256 the pixel bytes (never the file bytes), exit 0 when two consecutive hashes are equal, remove its temp captures, and time out the same way. Exactly one of `--window`/`--stable` is required (usage otherwise).

- **GIVEN** a static desktop
- **WHEN** `rk gui wait --stable` runs
- **THEN** it exits 0 within about one interval and leaves no temp PNG behind

- **GIVEN** two PNGs whose pixels are identical but whose `tEXt` date chunks differ
- **THEN** the stability hash judges them equal

### Relay

#### R7: The last-human-input timestamp
`newGuiViewFilter` SHALL parse client messages on every backend; on `unix` the returned bytes SHALL be the input chunk verbatim regardless of parser state (side-effect-only parse); on `tcp` today's drop of types 4/5 continues and gains QEMU client message 255 sub-type 0 (12 bytes). When a post-handshake KeyEvent (4), PointerEvent (5), or 255/0 completes, the filter SHALL invoke an injected `onHumanInput()`; `handleGuiWS` SHALL wire it to `hub.guiHumanInputSeen(id)` storing `time.Now()` in `sseHub.guiHumanInputAt map[string]time.Time` under `h.mu`. `gui.Status` and `gui.StreamEntry` SHALL carry `human_input_ago_ms,omitempty` = `max(1, elapsed ms)` when a timestamp exists and omit it otherwise; `gui.StatusDeps` gains `HumanInputAt func() (time.Time, bool)` (nil in the CLI). `rk gui status` SHALL render `  human input <N>s ago` under the summary while the fetched document is inside the grace window, and `--json` SHALL print the fetched document when available.

- **GIVEN** a unix relay and a client chunk that splits a PointerEvent across two frames
- **THEN** both chunks are forwarded byte-for-byte and the callback fires once, after the second

- **GIVEN** no viewer has driven the display since the daemon started
- **THEN** `GET /api/gui/host` has no `human_input_ago_ms` key

### Lock

#### R8: The host resolution pin
`rk gui lock` / `rk gui unlock` (gated, not guarded) SHALL set / unset the session-scoped tmux option `@rk_gui_lock` (`daemon.GUIOptionLock`, value `1`) on `rk-gui` via `daemon.SetGUILock(ctx, bool)` (`set-option -t =rk-gui: …` / `set-option -u …` through `runTmux`), printing `locked` / `unlocked`, idempotent. `daemon.GUILocked(ctx) bool` SHALL read it (unset ⇒ false). `gui.Status.Locked` and `gui.StreamEntry.Locked` (`json:"locked"`, always present) SHALL be filled from `StatusDeps.Locked func(ctx) bool` and by the hub's `guiTick`; `guiOnSummary` SHALL append `, locked` as the last paren segment when set (status line and doctor row alike). The tile SHALL honor it: `GuiEntry.locked: boolean` and `GuiStatus.locked` in `client.ts`; `gui-surface.tsx` derives `rfb.resizeSession = !coarsePointer && focused && !resizeLocked && !hostLocked` with `hostLocked = gui?.locked ?? false` through `propsRef`. The palette's viewer-local lock rows are unchanged.

- **GIVEN** `rk gui lock` ran
- **WHEN** a focused fine-pointer viewer resizes its tile
- **THEN** no SetDesktopSize is sent and `rk gui status` shows `…, icewm-session, locked)`

- **GIVEN** `rk gui restart`
- **THEN** the lock is gone (the option died with the session)

### Clipboard and opener

#### R9: `clip get | set`
`clip get` SHALL print the CLIPBOARD selection verbatim on stdout via `xclip -selection clipboard -o` then `xsel --clipboard --output`; `clip set <text>` / `set --stdin` SHALL write it via `xclip -selection clipboard -i` / `xsel --clipboard --input` with the text on stdin and print nothing. Neither tool ⇒ `no clipboard tool found (tried xclip, xsel) — sudo apt install xclip`, exit 1. The `set` runner SHALL attach no stdout/stderr pipes and SHALL NOT kill the forked selection owner (the context timeout bounds only the parent's exit). `clip` is not guarded.

- **GIVEN** `rk gui clip set 'a long paragraph'` then `rk gui key ctrl+v` in a focused terminal
- **THEN** the paragraph is pasted

#### R10: `open <url|file>`
An argument matching `^[a-zA-Z][a-zA-Z0-9+.-]*:` is a URL; anything else is a file made absolute (`open: <path>: no such file`, exit 1, when missing). With `xdg-open` present the verb SHALL start `xdg-open <target>` detached and print `started <pid> on :N`. Without it, a URL SHALL fall back to the G-D5 browser ladder (`<browser> <url>` detached; a miss prints `gui.LaunchHint(browser)`, exit 1) and a file SHALL refuse with `xdg-open not found — sudo apt install xdg-utils`, exit 1. Not guarded.

- **GIVEN** no `xdg-open` and no browser on the ladder
- **WHEN** `rk gui open https://example.com` runs
- **THEN** stderr is the browser install hint, exit 1

#### R11: `launch browser --cdp [--port 9222]`
`--cdp` SHALL be accepted only with the `browser` role (terminal ⇒ usage) and only for a Chromium-family resolution (`chromium`, `chromium-browser`, `google-chrome`, `google-chrome-stable`, or `x-www-browser` whose `filepath.EvalSymlinks` basename is one of those); otherwise `--cdp needs a Chromium-family browser (resolved <name>)`, exit 1. Argv SHALL be `<path> --remote-debugging-port=<N> --user-data-dir=<gui.StateDir()>/cdp-<N>`. After the existing `started …` line the verb SHALL wait ≤ 5 s (200 ms polls) for `127.0.0.1:<N>` to accept TCP and print `cdp http://127.0.0.1:<N>`; on expiry `cdp port <N> did not open within 5s (browser pid <p> is running)`, exit 1.

- **GIVEN** chromium resolves
- **WHEN** `rk gui launch browser --cdp` runs
- **THEN** stdout has two lines: `started chromium (pid N) on :10` and `cdp http://127.0.0.1:9222`

### Help and docs

#### R12: Help grouping and help-dump conformance
The `rk gui` parent's `Long` **Subcommands:** list SHALL be regrouped into `display: on off status env restart exec launch open`, `look: shot windows wait`, `drive: focus click move scroll type key clip`, `guard: lock unlock` (hand-written, no cobra groups). `rk help-dump` SHALL still exit 0 with valid JSON on stdout and an empty stderr.

- **WHEN** `rk gui --help` runs
- **THEN** the four labelled blocks appear and every new verb is listed once

#### R13: Documentation
`docs/site/skill/gui.md` SHALL document every new verb, the rewritten recipe (`launch browser --cdp` + Playwright/CDP for browser work; `windows` → `focus` → `click`/`type`/`key` → `wait --stable` → `shot --scale 0.5` otherwise; `lock` for the loop; `clip set` + `key ctrl+v` for paragraphs), the display-pixel/scale rule, and the guard gotcha, staying ≤ 150 lines with every existing contract byte-compatible; `scripts/sync-skill.sh` SHALL be run so the embed matches. `docs/specs/gui.md` § Agent verbs and § Resize policy SHALL carry the new verbs, the guard, the host pin, and the two new fields. The child plan's G3 row and the parent plan's pointer row (already edited) ride this PR.

- **WHEN** `go test ./cmd/rk/` runs
- **THEN** `TestSkillGuiEmbedMatchesCanonical` and the line-budget test pass

### Verification

#### R14: Tests
Unit tests SHALL cover every argv builder, the windows parser, the guard (scripted documents incl. fail-open), `shot` flag arithmetic and per-rung argv, `type` translation, the pixel hash, the filter's observe mode and 255/0, the `human_input_ago_ms` clamp/omit, `@rk_gui_lock` set/unset and `locked` rendering, `--cdp` argv/family check, `open` classification and fallback, and `clip` ladder. A `//go:build linux` integration test, skipped unless `Xtigervnc`, `xdotool`, and `icewm-session` resolve, SHALL run on a throwaway display (`FreeDisplay(90)`, temp socket) — never the live `rk-gui` session: Xvnc + `icewm-session --nobg --notray` + `xterm`; `windows` lists it with pid and geometry; `focus --title xterm`; `type "echo hi"` + `key Return`; `wait --stable` returns 0; `shot --scale 0.5 --window <id>` yields a PNG half the window's size. Frontend vitest SHALL cover the `resizeSession` row with `locked: true`. `go test ./...`, `pnpm exec tsc --noEmit` (via the just recipes), and `just test-backend` / `just test-frontend` SHALL be green.

- **GIVEN** this VM
- **WHEN** `just test-backend` runs
- **THEN** the integration test runs (not skipped) and passes

### Non-Goals

- Session recording, AT-SPI, in-rk browser automation, OCR, per-agent displays (G-D14)
- A palette row or tile indicator for the host lock; changing the viewer-local `GUI: Lock resolution` semantics
- New HTTP routes or settings keys
- A Playwright e2e spec (no new UI)
- Installing xdotool / ImageMagick / xclip / xdg-utils

### Design Decisions

#### Host lock is a session option that dies with the session
**Decision**: `rk gui lock` sets `@rk_gui_lock` on the `rk-gui` tmux session; the tile ANDs the streamed `locked` into `resizeSession`; the palette pin stays viewer-local.
**Why**: the tile's only pin is localStorage, unreachable from a CLI; Constitution IV puts per-entity state in `@rk_*` options; a loop-scoped pin must not outlive the display.
**Rejected**: a `gui.lock` settings key (persists wrongly across restarts); a `POST /api/gui/{id}/lock` route (Constitution IV route minimalism, and the CLI would still need the tmux read).
*Introduced by*: 260910-d0za-gui-agent-verbs-input-and-windows

#### The guard fails open without the daemon
**Decision**: an unreachable daemon HTTP origin lets an input verb proceed.
**Why**: the relay lives in the daemon; with it down no viewer can be driving the display, so refusing would block the agent for nothing.
**Rejected**: fail-closed (a dead daemon would freeze every loop); stamping a tmux option per pointer event (a tmux command per mouse move).
*Introduced by*: 260910-d0za-gui-agent-verbs-input-and-windows

#### Stability is judged on pixels, never PNG bytes
**Decision**: `wait --stable` decodes each capture and hashes pixel bytes.
**Why**: ImageMagick stamps `date:create`/`date:modify` text chunks, so identical screens never produce identical files.
**Rejected**: `convert -strip` (adds a stage and still trusts encoder determinism); comparing file sizes (false positives).
*Introduced by*: 260910-d0za-gui-agent-verbs-input-and-windows

#### `clip set` leaves the forked owner alive
**Decision**: the set runner attaches no pipes and never kills xclip/xsel's child.
**Why**: the child *is* the clipboard on a desktop with no clipboard manager; a Go `Wait` on an inherited pipe would block until the timeout and a kill would empty the clipboard.
**Rejected**: running under `--loops 1` (the paste would work once, then vanish).
*Introduced by*: 260910-d0za-gui-agent-verbs-input-and-windows

#### `--cdp` is Chromium-family only
**Decision**: Firefox and unknown browsers refuse the flag.
**Why**: Playwright's `connectOverCDP` is Chromium-only and `--user-data-dir` is a Chromium flag; a Firefox endpoint would serve no documented consumer.
**Rejected**: passing the flag blindly (silent no-op on Firefox, then a confusing port timeout).
*Introduced by*: 260910-d0za-gui-agent-verbs-input-and-windows

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/backend/internal/gui/xdo.go` (+ `xdo_test.go`): pure argv builders (`XdoSearchVisible`, `XdoWindowName`, `XdoWindowGeometry`, `XdoWindowPID`, `XdoActiveWindow`, `XdoActivate`, `XdoMouseMove`, `XdoClick`, `XdoScrollButton`, `XdoType`, `XdoKey`), the `Window` row type, `ParseWindowGeometry` (`--shell` output), `ParseWindows`, and `TypeSegments(text) []string` (the `\n` split). Verify the all-visible-windows `search` pattern against the installed xdotool and pin it in a test comment. <!-- R2 R3 --> <!-- assumed: the all-windows pattern is `--onlyvisible --name ''` — xdotool's --name is a regex and the empty regex matches every named window -->


- [x] T002 [P] `app/backend/internal/daemon/gui.go` (+ test): `GUIOptionLock = "@rk_gui_lock"`, `SetGUILock(ctx, locked bool) error` (set-option `1` / `set-option -u` via `runTmux`, exact-session target), `GUILocked(ctx) bool` (seam over `guiSessionOption`; unset ⇒ false; gated on session existence). <!-- R8 -->
- [x] T003 [P] `app/backend/internal/gui/status.go` + `assemble.go` (+ tests): `Status.Locked bool json:"locked"`, `Status.HumanInputAgoMS int64 json:"human_input_ago_ms,omitempty"`, the same two on `StreamEntry`; `StatusDeps.Locked func(ctx) bool` and `HumanInputAt func() (time.Time, bool)`; `Assemble` fills `Locked` when the session exists and `HumanInputAgoMS = max(1, ms)` when `HumanInputAt` returns ok; add `HumanInputAgoMS(at time.Time, now time.Time) int64` helper. <!-- R7 R8 -->

### Phase 2: Core Implementation

- [x] T004 Relay observe mode — `app/backend/api/gui_filter.go` (+ test): `newGuiViewFilter(network string, onHumanInput func())`; parse client messages on every backend; on unix `feedClient` returns the chunk verbatim (parse side-effect only); frame type 255 sub-type 0 (12 bytes) and count 4/5/255-0 completions post-handshake via the callback; add 255/0 to the tcp drop set. `api/gui_ws.go`: wire the callback to `hub.guiHumanInputSeen(id)`. `api/sse.go`: `guiHumanInputAt map[string]time.Time`, `guiHumanInputSeen(id)`, `guiHumanInputAt(id) (time.Time, bool)`, `guiLocked bool` read in `guiTick` beside the stamps (via a new `guiLockedFn` seam defaulting to `daemon.GUILocked`), `Locked`/`HumanInputAgoMS` on `guiPayloadLocked`'s entry. `api/gui.go`: `buildGuiStatus` wires `Locked` and `HumanInputAt` from the hub (+ handler test asserting the fields). <!-- R7 R8 -->
- [x] T005 `app/backend/cmd/rk/gui.go` (+ `gui_test.go`): `guiHumanInputGrace = 3 * time.Second`; `guiFetchDaemonStatusFn` seam (GET `resolveOrigin(ctx)+"/api/gui/host"`, 2 s timeout, decode `gui.Status`, ok=false on any error); `guiRequireNoHumanInput(ctx, force bool) error` returning `human input <N>s ago — retry or pass --force`; `guiOnSummary` gains a `locked bool` parameter appending `, locked`; `runGuiStatus` fetches the daemon document when the daemon is running (uses it for `--json` and for the `  human input <N>s ago` line); `lock`/`unlock` commands (gated, `daemon.SetGUILock`, print `locked`/`unlocked`); `guiRequireXTool(name, hint)` helper for the `xdotool not found — sudo apt install xdotool` family; register every new command in `init()`; regroup the `Long` Subcommands list into the four labelled blocks. Update `doctor.go`'s `guiOnSummary` call and `gui_supervise`/doctor tests for the new signature. <!-- R1 R4 R8 R12 -->
- [x] T006 [P] `app/backend/cmd/rk/gui_windows.go` (+ test): `rk gui windows [--json]` and `rk gui focus <id|--title <substr>>` per R2, running xdotool through a `guiXdoRunFn(ctx, argv, stdin) (stdout, error)` seam with `gui.LaunchEnv`; `focus` is guarded (R4). <!-- R2 R4 -->
- [x] T007 [P] `app/backend/cmd/rk/gui_input.go` (+ test): `click`, `move`, `scroll`, `type`, `key` per R3, each guarded (R4) with `--force`; `type` via stdin segments + `key Return`; `--window` translation via `getwindowgeometry`. <!-- R3 R4 -->
- [x] T008 [P] `app/backend/cmd/rk/gui_shot.go` (+ test): `--scale`, `--max-width`, `--window` per R5 — extend `guiShotArgv(lookPath, display, out, opts)` to carry scale/window per rung (import inline `-resize`, scrot + convert post-stage, xwd + convert `-resize`), the two imagemagick refusals, the mutual-exclusion usage error, the source-geometry resolution (probe vs `getwindowgeometry`), and the unconditional stderr `geometry WxH scale S` line; expose `guiShotCapture(ctx, st, opts) (path, geometry, scale, error)` for reuse by `wait --stable`. <!-- R5 -->
- [x] T009 `app/backend/cmd/rk/gui_wait.go` (+ test): `wait --window <substr> [--timeout]` (250 ms poll, prints the first id) and `wait --stable [--interval] [--timeout]` (scale-0.25 captures via T008's helper, `image/png` decode, SHA-256 over pixel bytes, temp cleanup), `timed out after <d>` exit 1, exactly-one-of usage. Test the pixel hash with two PNGs differing only in a `tEXt` chunk. <!-- R6 -->
- [x] T010 [P] `app/backend/cmd/rk/gui_clip.go` (+ test): `clip get|set <text>|set --stdin` per R9 — xclip then xsel ladder, the apt hint, `get` verbatim stdout, `set` with stdin only and no stdout/stderr pipes (document the forked-owner constraint in a comment stating the invariant). <!-- R9 -->
- [x] T011 [P] `app/backend/cmd/rk/gui_open.go` (+ test): `open <url|file>` per R10 — URL/file classification, `filepath.Abs` + stat for files, `xdg-open` detached via `gui.StartDetached`, URL fallback to `gui.ResolveApp(AppBrowser)` with `LaunchHint` on miss, file refusal `xdg-open not found — sudo apt install xdg-utils`. <!-- R10 -->
- [x] T012 [P] `app/backend/cmd/rk/gui_launch.go` (+ test): `--cdp` and `--port` per R11 — role check (usage on terminal), Chromium-family check with `EvalSymlinks` (seam), argv with `--remote-debugging-port` and `--user-data-dir` under `gui.StateDir()/cdp-<N>`, a `guiDialFn` seam for the ≤ 5 s port wait (200 ms polls), the second `cdp http://127.0.0.1:<N>` datum line and the timeout error. <!-- R11 -->

### Phase 3: Integration & Edge Cases

- [x] T013 Frontend — `app/frontend/src/api/client.ts` (`GuiEntry.locked: boolean`, `GuiStatus.locked: boolean`), `src/components/gui-surface.tsx` (`hostLocked` from `gui?.locked` in `propsRef`, ANDed into `resizeSession`), `gui-surface.test.tsx` (truth-table row for `locked: true`), and every `GuiEntry` fixture in `src/**/*.test.ts*` and `tests/e2e/_state-socket-mock.ts` gains `locked: false`; `cd app/frontend && pnpm exec tsc --noEmit` and `just test-frontend` green. <!-- R8 -->
- [x] T014 Integration test in `app/backend/cmd/rk/gui_supervise_integration_test.go` (or a new `gui_verbs_integration_test.go`, `//go:build linux`): skip unless `Xtigervnc` + `xdotool` + `icewm-session` resolve; throwaway display via `gui.FreeDisplay(90)` and a temp socket; start Xvnc and `icewm-session --nobg --notray` (temp `ICEWM_PRIVCFG`), launch `xterm`; drive the verb functions with the package seams pointed at the throwaway display (never the live `rk-gui`): `windows` lists xterm with pid + geometry, `focus --title xterm`, `type "echo hi"` + `key Return`, `wait --stable` returns 0, `shot --scale 0.5 --window <id>` PNG dimensions are half the window's; SIGTERM/SIGKILL cleanup for every process. <!-- R14 -->
- [x] T015 Verification sweep: `cd app/backend && go test ./...`; `go build -o ../../bin/rk ./cmd/rk && ../../bin/rk help-dump > /dev/null` exits 0 with empty stderr and valid JSON (pipe through `python3 -m json.tool`); `rk gui --help` shows the four groups; `just test-backend` and `just test-frontend` green. <!-- R12 R14 -->

### Phase 4: Polish

- [x] T016 Rewrite `docs/site/skill/gui.md` per R13 (≤ 150 lines — compact the existing sections; keep every existing contract line byte-compatible), then run `scripts/sync-skill.sh` and confirm `go test ./cmd/rk/ -run 'Skill'` passes. <!-- R13 -->
- [x] T017 [P] `docs/specs/gui.md`: § Agent verbs gains the full verb list, the guard (3 s, `--force`, the six verbs), the coordinate/scale rule, the host pin, `locked` and `human_input_ago_ms` on the status document and stream entry; § Resize policy notes `rk gui lock`; § Protocol and relay notes the observe mode. Confirm the two plan files' edited rows are still accurate. <!-- R13 -->

## Execution Order

- T001–T003 first (T002/T003 in parallel with T001)
- T004 needs T003; T005 needs T002–T004
- T006–T012 need T001 and T005 (T009 also needs T008); they are parallel among themselves
- T013 needs T003's field names; T014 needs T006–T009; T015 after everything in Phases 1–3
- T016/T017 last, after the verbs' exact copy is final

## Acceptance

### Functional Completeness

- [x] A-001 R1: Every new verb refuses `gui is off — turn it on with 'rk gui on'` (exit 1) when disabled and `gui is on but not running — see 'rk gui status'` when unreachable; darwin refuses via `guiDarwinRefusal`
- [x] A-002 R1: Every X-tool-dependent verb refuses with its apt hint when the tool is absent; `shot` and `launch` are unaffected by a missing `xdotool`
- [x] A-003 R2: `windows` prints `ID PID GEOMETRY TITLE` rows with ` *` on the active row; `--json` emits the nine-field objects; empty display ⇒ `[]`
- [x] A-004 R2: `focus` handles id, `--title` unique, `--title` ambiguous (exact `ambiguous` line), no match, and non-window id per the spec strings
- [x] A-005 R3: `click` variants, `move`, `scroll` (with `--at`, `--n`), `type` (arg and `--stdin`, newline ⇒ Return), `key` build the specified xdotool argv
- [x] A-006 R4: The guard refuses inside 3 s with `human input <N>s ago — retry or pass --force`, `--force` bypasses, and only the six input verbs consult it
- [x] A-007 R5: `shot` supports `--scale`, `--max-width`, `--window`; stderr `geometry WxH scale S` always; stdout path only; output dimensions scale
- [x] A-008 R6: `wait --window` prints the first matching id; `wait --stable` detects two equal pixel hashes; both time out with `timed out after <d>` exit 1
- [x] A-009 R7: `GET /api/gui/host` and the `event: gui` entry carry `human_input_ago_ms` (≥ 1) after a relayed input message and omit it before any
- [x] A-010 R8: `rk gui lock`/`unlock` set/unset `@rk_gui_lock`; `locked` appears on the status document, the stream entry, the status summary, and the doctor row
- [x] A-011 R8: The tile's `resizeSession` is false whenever the stream entry has `locked: true`
- [x] A-012 R9: `clip get`/`set`/`set --stdin` work through xclip then xsel with the specified apt hint on a miss
- [x] A-013 R10: `open` classifies URL vs file, uses `xdg-open`, falls back to the browser ladder for URLs, and refuses files with the xdg-utils hint
- [x] A-014 R11: `launch browser --cdp` builds the Chromium argv with the dedicated profile dir, waits for the port, prints the `cdp` line, and refuses terminal/non-Chromium
- [x] A-015 R12: `rk gui --help` lists the four labelled groups; `rk help-dump` exits 0 with valid JSON and empty stderr
- [x] A-016 R13: `docs/site/skill/gui.md` documents every verb and the rewritten recipe within 150 lines; the embed is synced; `docs/specs/gui.md` carries the additions

### Behavioral Correctness

- [x] A-017 R1: `rk gui env`, `exec`, `launch`, and default `shot` stdout are byte-identical to before this change (existing tests unchanged and passing)
- [x] A-018 R7: On the unix backend every client chunk is forwarded verbatim even when the parser is mid-message or confused (side-effect-only parse)
- [x] A-019 R7: On the tcp backend KeyEvent, PointerEvent, and QEMU 255/0 are dropped after the handshake
- [x] A-020 R8: After `rk gui restart` the lock is absent (`locked: false`)

### Scenario Coverage

- [x] A-021 R14: The integration test runs on this VM against a throwaway display (never `rk-gui`) and passes the launch → windows → focus → type/key → wait --stable → shot --scale --window chain
- [x] A-022 R4: A scripted document with `human_input_ago_ms` absent, 1, 2999, and 3000 yields refuse/refuse/refuse/proceed as specified; a failing fetch proceeds

### Edge Cases & Error Handling

- [x] A-023 R5: `--scale 0`, `--scale 1.5`, `--scale` with `--max-width`, and `--window` on the scrot rung produce the specified usage/refusal outcomes
- [x] A-024 R6: `wait` with neither or both flags exits 2; the pixel hash treats PNGs differing only in text chunks as equal
- [x] A-025 R9: `clip set` runs without stdout/stderr pipes and does not kill the forked owner (verified by inspecting the runner's `exec.Cmd` setup in tests)
- [x] A-026 R2: A window without `_NET_WM_PID` yields `pid` 0 / `app` `""`; a failing `getactivewindow` yields no active mark; neither errors

### Code Quality

- [x] A-027 Pattern consistency: new verbs follow the `gui.go` family idiom (package seams, `Dataf`/`Notef`, `usageArgs`, `guiCmdCtx`, exact-session tmux targets)
- [x] A-028 No unnecessary duplication: `gui.LaunchEnv`, `gui.StartDetached`, `gui.ResolveApp`, `gui.LaunchHint`, `resolveOrigin`, and the shot ladder are reused, not reimplemented
- [x] A-029 Constitution I / Process Execution: every subprocess is an argv slice under `exec.CommandContext` with a timeout; user text reaches xdotool via stdin, never argv interpolation
- [x] A-030 No magic values: grace, poll intervals, timeouts, default port, hint strings are named constants
- [x] A-031 Comments state constraints the code cannot show (the forked clipboard owner, the verbatim-forward invariant, the ≥ 1 ms clamp) and never narrate or cite change IDs
- [x] A-032 Tests accompany every new behavior (`*_test.go`, `*.test.tsx`)

### Security

- [x] A-033 R1: No shell strings; window ids and coordinates are validated integers before reaching xdotool; the daemon fetch targets only the resolved local origin

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. (The relay filter's `inert` field was replaced by `drop` in the same diff, and the skill page's old xdotool-loop recipe was rewritten in place — both already applied, not pending deletions.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `guiOnSummary` gains a `locked bool` parameter (signature change, callers in status and doctor updated) rather than a second helper | One shared renderer keeps the status line and doctor row identical | S:70 R:90 A:90 D:85 |
| 2 | Confident | The hub reads `@rk_gui_lock` on its existing gui tick (`guiLockedFn` seam) rather than on every stream render | The tick already reads the stamps; a lock flip surfaces within one tick like `wm` | S:65 R:85 A:85 D:80 |
| 3 | Confident | `wait --stable` reuses `shot`'s capture helper at scale 0.25 rather than its own pipeline | One capture ladder; the scale path must exist anyway | S:70 R:90 A:90 D:85 |
| 4 | Confident | The integration test drives the verb functions through the package seams pointed at the throwaway display, not by exec'ing the `rk` binary | The existing integration tests use seams; pointing `gatherGUIStatus` at a temp display avoids touching `rk-gui` | S:60 R:85 A:80 D:75 |
| 5 | Tentative | The all-visible-windows `xdotool search` pattern is `--onlyvisible --name ''` (empty regex matches every named window); verified at T001 | xdotool's regex semantics; a `.` pattern would skip unnamed windows | S:50 R:95 A:60 D:60 |

5 assumptions (0 certain, 4 confident, 1 tentative).

# Intake: GUI Perf Measure (C5 — the gate for C6)

**Change**: 260910-xy7q-gui-perf-measure
**Created**: 2026-09-10

## Origin

One-shot `/fab-new` invocation carrying a full brief (the user was not present for follow-up questions; SRAD ran without asking). Raw input:

> gui-perf-measure Plan: fab/plans/sahil/26-09-09-gui-surface.md -- implement C5 (measure -- the GATE for C6) per the plan's change breakdown and pickup protocol. C2/C3/C4 are merged (backend+relay, frontend tile, agent verbs all on main). IMPORTANT, do this FIRST before the perf spec: the user reports that opening the GUI surface just now shows only a blank/black screen -- reproduce this (rk gui on, open the tile in a browser) and diagnose it. This is release-blocking for C5 itself since the perf spec needs a rendering desktop to scroll and measure; if it turns out to be a real bug, fix it as a preliminary step (small, separate commit) before running the Playwright perf spec proper. Only after the surface actually renders should you proceed to C5's scope: a Playwright perf spec (skipped on CI without Xvnc) loading a long page in the guest browser, scrolling via rk gui exec xdotool, sampling noVNC's frame counter + relay bytes/s, recording Xvnc CPU from ps, run from a laptop and a phone over Tailscale, writing the numbers into docs/memory/run-kit/gui.md against the D9 targets (click-to-pixel <100ms, >=30fps scrolling a browser page at 1080p over Tailscale, <1 core Xvnc CPU), then the verdict (met -> C6 not picked up; missed -> C6). Before starting, read the plan file in full (including the C0 verdict and D9), docs/specs/gui.md, fab/project/constitution.md, and the lenses-and-layout, configuration, daemon-lifecycle, gui memory files. Treat the plan's Decision log as Certain in SRAD scoring. After merge, fill in the C5 row (change folder / PR) and the verdict in the plan's tracking table in the same PR.

Design authority: `fab/plans/sahil/26-09-09-gui-surface.md` (decision log D1–D10 is Certain; § C5, § C0 verdict, § Pickup protocol), `docs/specs/gui.md` § Smoothness targets, `docs/memory/run-kit/gui.md`, `docs/memory/run-kit/ui/lenses-and-layout.md` § GUI Surface.

### The black-screen report — reproduced and diagnosed at intake (2026-09-10, this VM `dev-ws-sahil01`, run-kit v3.19.38 brew build of main at `eb8e8888`)

The report is real but it is **not a rendering or relay bug**: the tile faithfully shows an **empty openbox desktop, whose X root window is black on Xvnc**. Evidence gathered:

1. `rk gui status --json` → `{"enabled":true,"backend":"Xtigervnc","reachable":true,"display":":44","width":593,"height":799,"viewers":0,"apps":[]}`. The desktop geometry `593x799` (not the `-geometry 1920x1080` default) proves a fine-pointer viewer had already connected through the relay and driven `SetDesktopSize` (D7) — the relay and the RFB session work.
2. `rk gui shot` of `:44` with nothing running → a uniformly black 593×799 PNG. `xwininfo -root -tree` → only openbox's own 1×1 helper windows; `xprop -root` → `_OB_VERSION 3.6.1`, `_NET_SUPPORTING_WM_CHECK` set. The supervisor pane log shows only the 5 s probe connections (`Framebuffer updates: 0` each — the probe never requests one; expected) and no error.
3. `rk gui exec --detach xeyes` then `rk gui shot` → xeyes rendered with openbox's Clearlooks titlebar on the black root. The X server draws fine.
4. Headless Chromium (Playwright) against the live daemon at `:3000`, route `/rK/@14`, clicked the `GUI tile` toggle: `/ws/gui/host` opened, `gui-surface-canvas` mounted a `622×799` canvas, `2.22 %` of its pixels non-black (exactly the xeyes window), the top-bar dot went green, `viewers` rose to 2, and the desktop resized to the tile (`622x799`). Screenshot confirmed the desktop inside the tile.

Root cause of the *perception*: TigerVNC's Xvnc starts with a black root (`-br` is the X server default since X11R7), openbox paints no desktop background, and `rk gui on` launches no application — so a freshly enabled GUI is a black rectangle indistinguishable from a dead canvas, with no cursor on a phone. The C0 spike never saw this because it judged with a kiosk Chromium already on the display. Nothing else on this host (`chromium`/`google-chrome` are not installed; Playwright's Chromium is at `~/.cache/ms-playwright/chromium-1217`).

Two incidental findings recorded for the plan-side memory (not bugs, but the agent-facing gotchas bit during the repro): `rk gui exec --detach xterm -geometry 60x20` fails with `unknown shorthand flag: 'g' in -geometry` — dash-prefixed program args need the documented `--` separator (`rk gui exec -- xterm -geometry …`); and the supervisor pane must be read with the session-scoped target `tmux -L rk-daemon capture-pane -p -t '=rk-gui:'` (the bare `=rk-gui` errors `rk-gui not found` under tmux 3.7c, the same per-command quirk the option commands hit — gui.md § Design Decisions).

## Why

**Problem 1 — the empty desktop reads as broken.** The first thing a user sees after `rk gui on` (or `GUI: Turn on`) is black. Every signal the tile has (dot, `reachable`, `viewers`) says "connected", yet the picture says "nothing". That is a release-blocking first-run experience on a surface that shipped one day ago, and it blocks C5 procedurally: a perf spec must know the desktop it scrolls is rendering. Fix: the supervisor paints the root window a solid, deliberately non-black desktop color after the WM starts (`xsetroot -solid`), so an empty desktop looks like an empty desktop. Solid rects cost the encoder nothing (Tight/ZRLE encode a solid fill as a few bytes), so this has zero perf cost, unlike the classic X weave stipple (`-retro`), which is high-frequency noise that JPEG/Tight would pay for on every full update and that scales badly on phones. A frontend "empty desktop" overlay was rejected: the tile has no live `apps` signal (only the one-shot `GET /api/gui/host` on the unreachable transition), and text painted over a live desktop is intrusive.

**Problem 2 — D9 is still an assumption.** The plan's decision log says smoothness targets are measured after C3, not assumed (D9), and C6 (a second backend, M-sized) is spent only if the numbers miss. Without C5 the only data is the C0 spike's loopback numbers (which C0 itself says not to cite for the link case) and a hands-on impression. C5 turns D9 into a reproducible spec plus a recorded table, and produces the C6 verdict.

**If not fixed**: every new user of the GUI surface opens a black tile and reaches for "Restart supervisor" / "Open supervisor logs" for a desktop that is working; and C6's M-sized cost is decided on gut feel.

## What Changes

### 1. Preliminary fix (its own commit, before the spec): a visible root background for the empty desktop

`app/backend/internal/gui/backend.go` (pure half, beside `ResolveWM`):

```go
// RootBackground is the solid color painted onto the X root window after the
// WM starts. Xvnc's default root is black and openbox paints no desktop, so an
// empty desktop is otherwise indistinguishable from a dead canvas. A solid
// fill costs the encoder nothing (one rect per update); the classic X weave
// stipple would be JPEG noise on every full update.
const RootBackground = "#3b4252"

// RootBackgroundArgv returns the argv that paints the root window, or
// ok=false when xsetroot is not on PATH (the desktop stays black; the
// supervisor logs the install hint).
func RootBackgroundArgv(lookPath func(string) (string, error)) (argv []string, ok bool) {
	if _, err := lookPath("xsetroot"); err != nil {
		return nil, false
	}
	return []string{"xsetroot", "-solid", RootBackground}, true
}
```

`app/backend/cmd/rk/gui_supervise.go` (`runGuiSuperviseLinux`), immediately after the WM launch block and before `backendWait` is armed:

- resolve `gui.RootBackgroundArgv(guiSuperviseLookPath)`; when `ok`, run it through a new seam `guiSuperviseRunOnDisplay(ctx, argv, display) error` — `exec.CommandContext` bounded by a 5 s `context.WithTimeout` (Constitution I / Process Execution), `DISPLAY=<display>` appended to the env exactly like `guiSuperviseStartWM`, stdout/stderr inherited (pane log). Best-effort: a non-zero exit logs `gui: xsetroot failed: <err>; the empty desktop stays black` and continues.
- when `!ok`, log the new line `guiNoRootBackgroundLine()` = `gui: no xsetroot on PATH; the empty desktop stays black — apt install x11-xserver-utils` and continue (a bare-black desktop is still usable — the same posture as the no-WM line).
- Runs after the WM so a desktop environment on the ladder (`x-session-manager`) that paints its own desktop window still wins visually; openbox paints nothing, so the solid root shows through.
- macOS (`runGuiSuperviseDarwin`) is untouched — nothing is spawned there.

Tests (`internal/gui/backend_test.go`, `cmd/rk/gui_supervise_test.go`): `RootBackgroundArgv` resolves → `["xsetroot","-solid","#3b4252"]`, absent → `ok=false`; a supervisor test in the shape of `TestGuiSuperviseLinuxLaunchesWMWithDisplay` stubs `xsetroot` on PATH with a script that records `"$DISPLAY $*"` to a file and asserts `:12 -solid #3b4252` landed; the no-xsetroot ladder asserts the hint line is logged and the supervisor still reaches `gui: Xtigervnc up`. Memory (`docs/memory/run-kit/gui.md` § The `rk-gui` supervisor session step list, plus a Design Decision "Empty desktop gets a solid root background") updates in hydrate.

Verification on this VM: `rk gui restart` with the rebuilt binary, `rk gui shot` shows the solid color, the tile shows it too.

### 2. The perf spec — `app/frontend/tests/e2e/gui-perf.spec.ts` (`@perf`, Xvnc-gated)

**Placement and gating.** A `test.describe("@perf GUI smoothness benchmark", …)` — the `@perf` tag is what `playwright.config.ts` `grepInvert`s out of default runs (`just test-e2e`); `just pw` sets `RK_E2E_PERF=1`, so the on-demand invocation is `just pw test gui-perf` against a `just dev` rig (or `RK_E2E_PERF=1 just test-e2e gui-perf` for a throwaway rig). Inside, `test.skip(!hasXtigervnc || !hasXdotool, "Xtigervnc/xdotool not on PATH")` — CI lacks both, so it skips cleanly even if the tag filter is ever lifted. Like `echo-latency.spec.ts`, it is an **audit**: it records numbers and prints a summary in `afterAll`; it asserts only that the rig worked (canvas painted, ≥1 frame, ≥1 byte), never a perf budget — loopback timing is too noisy to gate, and the D9 verdict is a human reading of the recorded table.

**Shared helpers extracted to `tests/e2e/_gui.ts`** (moved out of `gui-surface.spec.ts`, which imports them back — no behavior change): `hasXtigervnc`, `RIG_ORIGIN`, `postSettingsRaw`, `fetchGuiStatusRaw` (typed `GuiStatusDoc` incl. `display`, `width`, `height`, `viewers`, `reachable`, `session`), `pollGuiStatus`, `stableGuiGeometry`, and the settings snapshot/restore pair (`snapshotSettings()` / `restoreSettings(snapshot)`) built on `_settings.ts`'s `SETTINGS_PATH`. The perf spec adds `hasXdotool`.

**Setup (`beforeAll`)**: snapshot settings; `createSession` a seed session; `postSettingsRaw({"gui.enabled": null})` → wait `!session`; `POST {"gui.enabled": true}`; `pollGuiStatus(reachable)`; read `display` from the payload. Write the guest page to a temp file: a ~300 KB long page (a header, then 400 paragraphs of lorem text interleaved with 3-column colored tile rows, so a wheel notch changes most of the framebuffer) with a fixed-position 240×240 `#tap` square at the top-left whose background toggles `#e63946` ⇄ `#2a9d8f` on `pointerdown` (the click-to-pixel target). Launch the guest browser directly with `DISPLAY=<display>` in its env (`node:child_process.spawn`, `detached: true`, stdio ignored): Playwright's own Chromium (`chromium.executablePath()` from `@playwright/test`) with `--kiosk --window-position=0,0 --window-size=<desktop w>,<desktop h> --no-first-run --no-default-browser-check --disable-gpu --user-data-dir=<tmp> file:///<page>`; `afterAll` kills it (`process.kill(-pid)`), kills the seed session, `POST {"gui.enabled": null}`, restores settings, prints the table and writes `test-results/gui-perf-<label>.json`.

Why the spec spawns with `DISPLAY` from the payload instead of shelling out to `rk gui exec`: the e2e rig runs its own daemon (derived port triple, `rk-test-e2e-<token>-*` socket family, per-run `XDG_STATE_HOME`/`RK_CONFIG_DIR` under `just test-e2e`); the `rk` on PATH resolves the developer's real daemon and settings, so `rk gui exec` from a spec would target the wrong display (or refuse, `gui is off`). `rk gui exec` is exactly "set `DISPLAY`/`RK_GUI_SOCKET`, exec" (gui.md § Agent verbs), so `spawn(exe, args, { env: { ...process.env, DISPLAY } })` is the same operation. The manual re-run recipe against a live daemon (below) does use `rk gui exec -- …` verbatim.

**Viewer instrumentation** (`page.addInitScript`, before the app loads — the `echo-latency.spec.ts` `INSTALL_*_STAMP` idiom):

- **Frame counter**: wrap `CanvasRenderingContext2D.prototype.drawImage`; when the first argument is an `HTMLCanvasElement` (noVNC 1.7 `Display.flip()` → `this._targetCtx.drawImage(this._backbuffer, …)`, one call per completed FramebufferUpdate — `core/display.js:289`), increment `window.__rkGuiFlips`. This is "noVNC's frame counter" without touching product code; the RFB instance is not reachable from the page.
- **Relay bytes**: wrap `WebSocket` so instances whose URL contains `/ws/gui/` add `message` listeners accumulating `e.data.byteLength ?? e.data.size` into `window.__rkGuiBytes` (binary frames; `binaryType` is `arraybuffer` in noVNC).
- **Click stamp**: a capture-phase `pointerdown` listener on `document` records `performance.now()` into `window.__rkGuiTapAt`.

**Sampling loop** (in the spec, Node side): during a 10 s scroll window, once per second read `{flips, bytes}` via `page.evaluate` and the Xvnc process CPU from `/proc/<pid>/stat` (utime+stime, `CLK_TCK` from `getconf CLK_TCK`, pid via `pgrep -f "^Xtigervnc <display> "` — the guest Chromium's CPU is sampled the same way as a secondary column); report per-second fps, Mbit/s, cores, plus the window mean.

**Scroll driver**: `xdotool mousemove <cx> <cy> click --repeat 300 --delay 33 5` (button 5 = wheel down; 30 notches/s for 10 s — the C0 rate), spawned with `DISPLAY` like the guest, after `xdotool search --sync --class chromium` confirms the guest window.

**Click-to-pixel** (20 trials, p50/p95): with the desktop sized to the tile (fine viewer, `resizeSession` on) canvas CSS px == guest px, so the `#tap` square at guest (0..240, 0..240) is at the same canvas offset (`canvas.getBoundingClientRect()` + 120,120). Each trial: `page.evaluate` arms a promise that samples `getImageData` at that point every rAF until the sampled color's dominant channel flips (red ⇄ teal), then `page.mouse.click(x, y)` (or `page.touchscreen.tap` on the coarse run); the promise resolves with `performance.now() − window.__rkGuiTapAt`. 300 ms settle between trials.

**Runs (three `test()`s, each with its own intent comment per the Test Intent Comments constitution clause)**:

1. **Fine-pointer 1080p viewer** — `test.use({ viewport: { width: 1920, height: 1180 } })`, open the seed window, toggle the GUI tile, click the canvas (focus → `resizeSession`), zen-zoom it (`Control+Shift+Enter`) so the tile is as close to 1920×1080 as the chrome allows; `stableGuiGeometry()` then reports the actual desktop size (recorded in the table — the target says 1080p, the table says what was measured). Scroll window + click-to-pixel.
2. **Coarse phone-shaped viewer** — a second context `{ viewport: 390×844, hasTouch, isMobile }` connecting alongside the desktop viewer (the geometry stays the fine viewer's — D7; asserted, since the existing spec already proves it): the client scales (`scaleViewport`), quality preset 4/6. Same scroll window measured on this viewer (flips, bytes) — the phone-side decode/scale cost; `page.touchscreen.tap` for click-to-pixel.
3. **Idle baseline** (short, 5 s): flips/s, bytes/s, Xvnc cores with nothing moving — the noise floor.

**Link label**: the spec reads `RK_GUI_PERF_LABEL` (default `loopback`) and stamps it into the report and the JSON filename, so a run under link emulation is recorded as e.g. `netem-260ms`.

### 3. Link emulation helper — `scripts/gui-perf-link.sh`

The user's devices sit ~260 ms RTT from this VM over Tailscale (`tailscale ping ahujanas2` / `cinna1` → 258–260 ms via DERP blr; the C0 verdict measured 266–274 ms). The agent cannot run Playwright on the user's laptop or phone, so the "over Tailscale" numbers are produced by adding that latency to the rig's viewer link with `tc netem`, scoped to ONE port so the developer's live daemon on `:3000` is untouched:

```sh
scripts/gui-perf-link.sh on <port> [rtt_ms=260] [mbit=40]   # sudo tc: prio qdisc on lo, netem delay rtt/2 (+ optional rate) on band 3, u32 filters for sport==port and dport==port
scripts/gui-perf-link.sh off                                 # sudo tc qdisc del dev lo root
scripts/gui-perf-link.sh status                              # tc -s qdisc show dev lo
```

Both directions traverse `lo`, so delaying packets to and from the port yields the full RTT. The Go backend port (`E2E_PORT+1`) is the one to delay — the browser talks to Vite, which proxies `/ws/gui/host` and `/api` to the Go backend on loopback, so the RFB stream and the API pay the round trip while Vite's dev module graph loads at full speed (delaying the Vite port stalls page load instead). One-liner-thin per Constitution VIII (the logic is the script; the justfile gains no recipe — `just pw` is the entry). The CDP throttle C0 used is deliberately not reused (C0: it starves the RFB request loop and collapsed both stacks to the same number). The script refuses without `sudo -n true`.

Measurement plan the apply stage executes on this VM and records: `loopback` (fine 1080p + coarse phone + idle), `netem-260ms` (same three, 260 ms RTT, 40 Mbit/s cap — a conservative Tailscale-DERP figure), plus the manual re-run recipe for the user's real laptop and phone.

### 4. Memory, spec, and plan updates

- `docs/memory/run-kit/gui.md`: (a) supervisor step list gains the root-background step and its two log lines; (b) new `## Smoothness (C5)` section: the D9 targets, the measurement method (what fps/bytes/CPU/click-to-pixel mean here and how they are captured), the results table — one row per `(run label, viewer)` with `desktop geometry | fps (flips/s) | relay Mbit/s | Xvnc cores | guest cores | click-to-pixel p50/p95 | D9 verdict per column` — the C6 verdict with its reasoning, and the re-run recipe (`just dev`, `just pw test gui-perf`, the netem script, and the live-daemon manual variant using `rk gui exec -- <chromium> …` / `rk gui exec -- xdotool …` from a laptop over Tailscale with `RK_E2E_PORT`/base-URL pointing at the rk origin); (c) Design Decisions: "Empty desktop gets a solid root background" and "Perf is audited by a `@perf` spec, never gated".
- `docs/memory/run-kit/ui/lenses-and-layout.md` § GUI Surface e2e paragraph: name `gui-perf.spec.ts` and the shared `_gui.ts` helpers.
- `docs/specs/gui.md`: Status paragraph (C5 measured, C6 verdict); § Smoothness targets points at the memory table.
- `fab/plans/sahil/26-09-09-gui-surface.md`: C5 row (change folder, PR URL, Done), the Status paragraph, and a dated `## C5 verdict` section (numbers summary + met/missed per target + the C6 decision), in the same PR.

**Verdict rule** (applied when writing the memory + plan sections): the three D9 targets are judged per component. `≥ 30 fps` and `< 1 core` are encoder/relay-attributable — a miss on loopback or under the 260 ms emulation triggers C6. `Click-to-pixel < 100 ms` is judged **net of the link RTT floor**: the C0 verdict already established that from the user's ~260 ms link no backend can reach 100 ms, so the pipeline's own added latency (loopback click-to-pixel, and emulated click-to-pixel minus the injected RTT) is what C6 could improve; a miss there triggers C6, a miss explained entirely by RTT does not. Whatever the outcome, the recorded table carries the raw numbers so the reasoning is checkable.

## Affected Memory

- `run-kit/gui`: (modify) supervisor root-background step + log lines; new § Smoothness (C5) with method, results table, verdict, re-run recipe; two Design Decisions
- `run-kit/ui/lenses-and-layout`: (modify) § GUI Surface e2e paragraph names `gui-perf.spec.ts` and the shared `_gui.ts` helpers

## Impact

- **Backend**: `app/backend/internal/gui/backend.go` (+`RootBackground`, `RootBackgroundArgv`), `app/backend/cmd/rk/gui_supervise.go` (+`guiSuperviseRunOnDisplay` seam, root-background step, `guiNoRootBackgroundLine`), tests in `internal/gui/backend_test.go` and `cmd/rk/gui_supervise_test.go`. Behavior change: the empty Linux desktop is `#3b4252` instead of black when `xsetroot` is installed; a new pane log line when it is not.
- **Frontend tests**: new `app/frontend/tests/e2e/gui-perf.spec.ts` (`@perf`, Xvnc+xdotool gated, excluded from `just test-e2e`), new `tests/e2e/_gui.ts` helper module, `gui-surface.spec.ts` refactored to import from it (no behavior change). No product frontend code changes.
- **Scripts**: new `scripts/gui-perf-link.sh` (sudo `tc netem`, port-scoped).
- **Docs**: `docs/memory/run-kit/gui.md`, `docs/memory/run-kit/ui/lenses-and-layout.md`, `docs/specs/gui.md`, `fab/plans/sahil/26-09-09-gui-surface.md`; `fab docs-index` regenerates `docs/memory/run-kit/log.md`/indexes.
- **Runtime dependencies**: none added to the product; the spec needs `Xtigervnc`, `openbox`, `xdotool`, Playwright's Chromium (all present on this VM; CI skips).
- **Verification gates**: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit`; `just test-e2e gui-surface` (the refactored spec still passes, perf spec still excluded by tag); `just pw test gui-perf` on a `just dev` rig for the numbers; `just build`.

## Open Questions

- Real-device numbers (the user's MacBook and iPhone over Tailscale) cannot be produced by the agent; the memory table records the netem-emulated rows as the Tailscale proxy and carries the exact re-run recipe so the user can add real-device rows later. Not blocking — the verdict rule above is designed so an RTT-only miss does not flip C6.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The plan's decision log D1–D10 and § C5 scope are binding; C5 measures, it does not redesign the tile or the backend | Pickup protocol step 4: treat the decision log as Certain; the user's brief restates C5's Do verbatim | S:95 R:90 A:95 D:95 |
| 2 | Certain | The reported black screen is an empty openbox desktop on Xvnc (black root, no apps), not a relay/noVNC bug | Reproduced at intake: `rk gui shot` black with `apps: []`, xeyes renders, headless-Chromium tile shows the live desktop with non-black pixels exactly where xeyes is, dot green, geometry followed the viewer | S:90 R:90 A:95 D:95 |
| 3 | Certain | The perf spec's frame counter is a `drawImage(<canvas>)` hook on the target canvas (= noVNC `Display.flip()`), relay bytes a `WebSocket` message-size wrap, both via `addInitScript`; no product code exposes RFB internals | noVNC 1.7 `core/display.js:289` flips by drawing the backbuffer canvas once per FramebufferUpdate; the RFB instance is a closure inside `gui-surface.tsx`; the `echo-latency.spec.ts` stamp idiom is the precedent | S:75 R:90 A:90 D:80 |
| 4 | Certain | Spec lives at `tests/e2e/gui-perf.spec.ts` under the `@perf` tag (excluded from `just test-e2e`, run via `just pw test gui-perf`), Xvnc+xdotool gated; shared Xvnc-rig helpers move to `tests/e2e/_gui.ts` | `playwright.config.ts` `grepInvert /@perf/` + `pw.sh RK_E2E_PERF=1` already exist for `echo-latency.spec.ts`; the gated half of `gui-surface.spec.ts` already carries the helpers — extracting them is the code-quality no-duplication rule | S:80 R:90 A:90 D:85 |
| 5 | Confident | The preliminary fix is `xsetroot -solid <RootBackground>` run by the supervisor after the WM, best-effort, with an install-hint log line when `xsetroot` is absent; macOS untouched; no frontend overlay | Smallest change that makes an empty desktop look like one; solid rects are free for the encoder (the `-retro` stipple is not); the tile has no live `apps` signal to drive an overlay; `x11-xserver-utils` is near-universal beside any X install | S:70 R:90 A:80 D:70 |
| 6 | Confident | Root background color `#3b4252` (a neutral slate — Nord "polar night" mid) | Aesthetic pick; must read as "a desktop" not "black" in both dashboard themes and on a phone; one constant, trivially changed | S:50 R:95 A:60 D:50 |
| 7 | Confident | The spec spawns the guest Chromium and xdotool itself with `DISPLAY` from the rig's `/api/gui/host` payload rather than shelling out to `rk gui exec` | The e2e rig's daemon is isolated (derived ports, `rk-test-e2e-*` sockets, per-run state/config roots); the `rk` on PATH resolves the developer's real daemon, so `rk gui exec` would hit the wrong display; `rk gui exec` IS "set DISPLAY + exec" (gui.md § Agent verbs), so the operation is identical; the manual live-daemon recipe uses `rk gui exec -- …` verbatim | S:70 R:85 A:85 D:75 |
| 8 | Confident | "From a laptop and a phone over Tailscale" is produced on this VM as (a) a fine-pointer 1080p viewer and (b) a coarse 390×844 touch viewer, each under `tc netem` at the measured 260 ms RTT (+40 Mbit/s cap) port-scoped to the rig, recorded as `netem-260ms`; real-device runs are a documented re-run recipe left to the user | The agent cannot drive the user's devices; `tailscale ping` measured 258–260 ms to both devices (C0: 266–274 ms); sudo + `tc` are available here; the CDP throttle is rejected per the C0 verdict; port scoping keeps the live `:3000` daemon unaffected | S:65 R:80 A:70 D:60 |
| 9 | Confident | Verdict rule: fps and Xvnc-CPU misses (loopback or emulated) trigger C6; click-to-pixel is judged net of the RTT floor (loopback click-to-pixel and emulated-minus-injected-RTT), so a miss explained entirely by link latency does not trigger C6 | The C0 verdict recorded that from the user's link `< 100 ms` is unreachable for any backend and that latency, not the encoder, is the ceiling; C6 changes the encoder only | S:70 R:75 A:75 D:65 |
| 10 | Confident | The `tc netem` helper is committed as `scripts/gui-perf-link.sh` (`on <port> [rtt] [mbit]` / `off` / `status`, refuses without passwordless sudo); no justfile recipe | Needed for every re-run of the emulated rows; thin script per Constitution VIII; `just pw` remains the entry point | S:60 R:90 A:80 D:65 |
| 11 | Confident | Change type `feat` (a new spec + measurement artefacts + a small behavior change), not `fix` | The user's word "fix" applies to the preliminary step only; the deliverable is C5's spec and verdict | S:60 R:95 A:85 D:70 |

11 assumptions (4 certain, 7 confident, 0 tentative, 0 unresolved).

# Plan: Fixed geometry — `gui.geometry`, `rk gui resize`, the resize endpoint, the palette rows (S2 / V1)

**Change**: 260910-zuci-gui-fixed-geometry-and-resize
**Intake**: `intake.md`

> Design authority: `fab/plans/sahil/26-09-10-gui-viewer-ergonomics.md` § Decision log
> (V-D1 … V-D5, binding), § UX "Resolution (V1)" (exact copy), § V1 Do/Acceptance; and
> `fab/plans/sahil/26-09-10-gui-combined-execution.md` § Coordination points 1 and 2.
> The branch already sits on S1 (PR #916, `gui.wm` + `rk gui wm`) — `main` fast-forwarded.

## Requirements

### Spike result (settles intake Assumption 4 — read before touching `geometry.go`)

Verified 2026-09-10 on a throwaway `Xtigervnc :95 -AcceptSetDesktopSize -geometry 1920x1080`
with the system `xrandr`:

| Probe | Result |
|---|---|
| `xrandr --query` | `Screen 0: … current 1920 x 1080 …` then `VNC-0 connected 1920x1080+0+0 0mm x 0mm` followed by an indented mode table: `1920x1080 60.00*+`, `1920x1200`, `1600x1200`, `1680x1050`, `1400x1050`, `1360x768`, `1280x1024`, `1280x960`, `1280x800`, `1280x720`, `1024x768`, `800x600`, `640x480` (one mode per line, name then refresh). **`1600x900`, `2560x1440`, `1080x1920` are NOT in the default table.** |
| `xrandr --output VNC-0 --mode 1600x900` (unlisted) | `xrandr: cannot find mode 1600x900` — fails |
| `xrandr -s 1080x1920` | `Size 1080x1920 not found in available modes` — fails |
| `xrandr --fb 2560x1440` | screen becomes 2560×1440 but the output stays 1920×1080 — **desync, never use** |
| `xrandr --newmode 1080x1920 0 1080 0 0 0 1920 0 0 0` then `--addmode VNC-0 1080x1920` then `--output VNC-0 --mode 1080x1920` | **works**: screen AND output read `1080x1920`; the mode joins the table as `1080x1920 0.00` |
| same three steps for `2560x1440` | **works** |
| `xrandr --output VNC-0 --mode 1920x1080` (listed) | works with the single step |

So the incantation is: a **zero-timing modeline** `--newmode WxH 0 W 0 0 0 H 0 0 0` (no CVT/GTF
computation — Xvnc ignores timings), `--addmode <output> WxH`, then `--output <output> --mode WxH`;
skip the first two steps when the output already lists `WxH`. Once added, a custom mode stays
listed for the display's lifetime, so a second resize to the same size is the single step.

### Settings: the `gui.geometry` key

#### R1: `gui.geometry` registry key
`internal/settings/settings.go` SHALL carry a registry row `gui.geometry` immediately after
`gui.wm`: `kind: "string"`, `def: "1920x1080"`, `category: "behavior"`, `ui: true`, `live: true`,
description exactly `The GUI desktop's pixel size. Fixed sizes keep windows where they are; Auto follows the focused desktop viewer's tile. Applies live.`,
backed by `Settings.GUIGeometry string` (declared beside `GUIWM`; `Default()` sets it to
`"1920x1080"`). Hooks: `parse` quote-trims and keeps the value only when `gui.ValidateGeometry`
accepts it (anything else keeps the default — the tolerant-read posture `gui.enabled` uses);
`serialize` emits `gui.geometry: "<v>"` and **omits the line when the value equals the default**
(a file without the key round-trips byte-identically); `read` returns the plain string (like
`gui.wm`); `apply` is `validatedScalar(target, gui.ValidateGeometry, "1920x1080")` — JSON `null`
or a trimmed-empty string restores the default, an invalid value returns the validator message
(the HTTP layer renders it as `400 gui.geometry: <msg>`). No `options:` hint, no select/picker
metadata (Coordination point 1 — the Settings dialog shows this key through the existing
generic `TextEntryControl` string renderer, whose inline `role="alert"` surfaces the 400).
`internal/settings` MAY import `internal/gui` for the validator: `internal/gui` imports no
`rk/internal/*` package, so no cycle exists.

- **GIVEN** a fresh `Default()` **WHEN** serialized **THEN** the output contains no `gui.geometry` line **AND** `Load()` reads `GUIGeometry == "1920x1080"`
- **GIVEN** `GUIGeometry = "auto"` (or `"1600x900"`) **WHEN** serialized then parsed **THEN** the value round-trips as `gui.geometry: "auto"`
- **GIVEN** `POST /api/settings {"gui.geometry":"100x100"}` **THEN** 400 with body error `gui.geometry: geometry 100x100 out of range (320–7680 per side)`
- **GIVEN** `POST /api/settings {"gui.geometry":null}` **THEN** the value is `1920x1080` again
- **GIVEN** the registry inventory **THEN** `Registry()` lists 16 keys with `gui.geometry` at index 10 (after `gui.wm`, before `tmux_conf`)

### gui package: geometry parsing and the RandR argv

#### R2: `ParseGeometry` / `ValidateGeometry` / `FormatGeometry`
`internal/gui/geometry.go` (new) SHALL export constants `GeometryAuto = "auto"`,
`GeometryDefault = "1920x1080"`, `GeometryMin = 320`, `GeometryMax = 7680`, and:
`ParseGeometry(s string) (w, h int, auto bool, err error)` — accepts the literal `auto`
(`auto=true`, `w=h=0`) or `WxH` (lowercase `x`, decimal digits, no sign, no spaces — the exact
regexp `^([0-9]+)x([0-9]+)$` after `TrimSpace`); both sides MUST be in 320–7680 inclusive. Errors
name the accepted shapes: a malformed string ⇒ `geometry must be WxH (320–7680 per side) or auto, got "<s>"`;
in-shape but out of range ⇒ `geometry <s> out of range (320–7680 per side)` (the § UX copy).
`ValidateGeometry(s string) string` is the settings-validator shape (`""` when valid, else the
error text). `FormatGeometry(w, h int) string` returns `WxH`.

- **GIVEN** `"auto"` **THEN** `auto=true`, no error
- **GIVEN** each of `320x320`, `7680x7680`, `1920x1080`, `1080x1920` **THEN** parses to those ints
- **GIVEN** `319x1080`, `1920x7681`, `100x100` **THEN** the out-of-range error
- **GIVEN** `1920×1080`, `1920 1080`, `AUTO`, `1920x`, `x1080`, `-5x600`, `` **THEN** the shape error

#### R3: xrandr query parsing and resize argv
`internal/gui/geometry.go` SHALL export:
- `XrandrQueryArgv() []string` = `{"xrandr", "--query"}`.
- `ParseXrandrQuery(out string) (output string, modes []string, err error)` — the first line of
  the form `<name> connected …` yields `output`; the indented lines that follow it (until the
  next non-indented line) yield `modes` = their first whitespace-separated token (`1920x1080`
  from `   1920x1080     60.00*+`). No connected output ⇒ error `xrandr reports no connected output`.
- `XrandrResizeArgv(output string, modes []string, w, h int) [][]string` — when `FormatGeometry(w,h)`
  is in `modes`: one step `{"xrandr","--output",output,"--mode","WxH"}`; otherwise three steps:
  `{"xrandr","--newmode","WxH","0","W","0","0","0","H","0","0","0"}`,
  `{"xrandr","--addmode",output,"WxH"}`, then the `--output … --mode` step. `output` is never
  hardcoded — it always comes from the query (spike: `VNC-0` on TigerVNC).
- `type DisplayRunner func(ctx context.Context, display string, argv []string) (stdout string, err error)`
  and the production `RunOnDisplay` implementing it: `exec.CommandContext(ctx, argv[0], argv[1:]...)`
  with `Env = LaunchEnv(os.Environ(), display, "")`, stdout captured; on a non-zero exit the error
  is the trimmed stderr tail when non-empty, else the exec error (the `guiXdoRunFn` idiom).
  Callers bound `ctx` with `XrandrTimeout = 10 * time.Second`.
- `Resize(ctx context.Context, run DisplayRunner, display string, w, h int) error` — runs the query
  through `run`, parses it, builds the argv steps, and runs each in order, stopping at the first
  error (returned verbatim, prefixed `xrandr: `). Pure orchestration over the runner so it is
  table-testable without an X server.
- `XrandrMissingHint = "xrandr not found — sudo apt install x11-xserver-utils"` — the refusal the
  CLI and the endpoint share when `LookPath("xrandr")` misses (rk installs nothing).

- **GIVEN** the spike's `xrandr --query` text as a fixture **WHEN** parsed **THEN** `output == "VNC-0"` and `modes` contains `1920x1080` and `1280x720` and not `1600x900`
- **GIVEN** a fixture with no `connected` line **THEN** the no-output error
- **GIVEN** `XrandrResizeArgv("VNC-0", modes, 1280, 720)` **THEN** exactly one step
- **GIVEN** `XrandrResizeArgv("VNC-0", modes, 1600, 900)` **THEN** three steps with the zero-timing modeline `--newmode 1600x900 0 1600 0 0 0 900 0 0 0`
- **GIVEN** a fake runner scripting the query then recording steps **WHEN** `Resize(…, 2560, 1440)` **THEN** the runner saw `--query` followed by the three steps in order; **GIVEN** the fake fails on `--addmode` with stderr `X Error` **THEN** `Resize` returns `xrandr: X Error` and never runs the `--output` step

### Supervisor: start-time geometry

#### R4: `-geometry` reads the key at supervise start
`gui.BackendArgv` SHALL gain a fourth parameter `geometry string` and emit it verbatim as the
`-geometry` value; `cmd/rk/gui_supervise.go` SHALL resolve it before starting the backend:
`ParseGeometry(guiSuperviseSettingsLoad().GUIGeometry)` — `auto` (or an unparsable stored value)
resolves to `GeometryDefault`; any valid fixed value passes verbatim. Right after the backend-up
line the supervisor logs exactly `gui: desktop 1600x900 (gui.geometry)` for a fixed value or
`gui: desktop 1920x1080 (auto — follows the focused viewer)` for `auto` (helper `guiDesktopLine`).
This is a start-time read only; the live path (R6) never touches the supervisor. Update
`internal/gui/backend_test.go`'s `TestBackendArgv` for the new parameter.

- **GIVEN** `GUIGeometry = "1600x900"` **WHEN** the Linux supervisor starts **THEN** the backend argv carries `-geometry 1600x900` and the log has the `(gui.geometry)` line
- **GIVEN** `GUIGeometry = "auto"` **THEN** `-geometry 1920x1080` and the `(auto — follows the focused viewer)` line

### Stream and status document

#### R5: `geometry` on the stream entry and the status document
`gui.StreamEntry` and `gui.Status` SHALL gain `Geometry string \`json:"geometry"\`` placed
directly after `Locked` (always present, like `wm`). Value: the `gui.geometry` setting (`"WxH"` or
`"auto"`) whenever `enabled`; `""` when disabled (the all-zero entry). **No new tmux stamp** —
the setting is the source of truth (Constitution II); the live pixel size still rides
`width`/`height` from the probe, and the two MAY disagree transiently mid-resize. `api/sse.go`:
the hub already calls `settings.Load()` every `guiTick` — keep one load, store `h.guiGeometry`
from `GUIGeometry` beside `h.guiEnabled` (set each tick, cleared by `setGUIEnabled(false)`), and
render it in `guiPayloadLocked`. `gui.StatusDeps` gains `Geometry string` (the caller resolves it
from settings like `Enabled`); `Assemble` copies it into the document when enabled. Both callers
(`api/gui.go` `buildGuiStatus`, `cmd/rk/gui.go` `gatherGUIStatus`) pass `settings.Load().GUIGeometry`.

- **GIVEN** the setting is `1600x900` and the GUI is enabled **WHEN** the hub ticks **THEN** the `event: gui` payload's entry carries `"geometry":"1600x900"` **AND** `GET /api/gui/host` carries the same
- **GIVEN** the GUI is disabled **THEN** `geometry` is `""` on both

### The resize endpoint and the settings-POST side effect

#### R6: `POST /api/gui/{id}/resize`
`api/gui.go` SHALL add `handleGuiResize`, registered in `api/router.go` beside `/launch`
(POST only — Constitution IX). Body `{"geometry":"WxH"|"auto"}` decoded with
`DisallowUnknownFields`. Seams on `Server` (nil ⇒ production): `guiXrandrRunFn gui.DisplayRunner`
(production `gui.RunOnDisplay`), reusing the existing `guiLookPathFn`. Rows, in this order:

| Condition | Response |
|---|---|
| invalid id | 400 (`validate.ValidateGUIID` message) |
| unparsable body / `ParseGeometry` error | 400 with the parse error text (`geometry 100x100 out of range (320–7680 per side)`) |
| `guiLaunchGOOS == "darwin"` | 409 `gui resize is not supported on macOS in v1 — the GUI mirrors your live session view-only` |
| `!settings.Load().GUIEnabled` | 409 `gui disabled` |
| status not reachable (via `buildGuiStatus`) | 409 `gui is on but not running — see 'rk gui status'` |
| `auto` | persist `GUIGeometry = "auto"` only (no xrandr) → 200 |
| `WxH`, `xrandr` not on PATH | 500 `xrandr not found — sudo apt install x11-xserver-utils`, setting unwritten |
| `WxH`, `gui.Resize` under a 10 s `context.WithTimeout` fails | 500 with the error text (the stderr tail), setting **unwritten** |
| success | persist, then `200 {"ok":true,"geometry":"1600x900","was":"<previous setting value>"}` |

`was` is the previous **setting** value (may be `auto`). Persist = `settings.Load()` → set → `Save`
(a save error is 500). The hub needs no explicit poke: the next tick re-reads the file (R5).

- **GIVEN** a reachable stubbed rig and body `{"geometry":"1600x900"}` **WHEN** the runner records argv **THEN** it saw the query then the resize steps for display `:10`, the saved setting reads `1600x900`, and the body is `{"ok":true,"geometry":"1600x900","was":"1920x1080"}`
- **GIVEN** the runner fails on the `--output` step with `X Error of failed request` **THEN** 500 with that text and the saved setting is unchanged
- **GIVEN** `{"geometry":"auto"}` **THEN** 200, no runner call, setting `auto`
- **GIVEN** `{"geometry":"100x100"}` **THEN** 400 with the range message and no runner call
- **GIVEN** the GUI disabled **THEN** 409 `gui disabled`, no runner call

#### R7: `POST /api/settings` carrying `gui.geometry` applies live
`api/settings.go` SHALL treat a patch carrying `gui.geometry` like `gui.enabled`'s side effect:
after `Save`, when the new value is a fixed `WxH`, the GUI is enabled, and `buildGuiStatus` reports
reachable, run `gui.Resize` through the same seams under the 10 s bound **best-effort** — a
failure logs a warning (`gui.geometry: live resize failed (the setting is saved; rk gui restart applies it)`)
and the response stays 200 (the setting is already validated and written by the generic path).
`auto` needs no action (the stream's `geometry` flips the tiles' `resizeSession`). This is what
makes the row's `live: true` truthful for the Settings dialog's text field.

- **GIVEN** `POST /api/settings {"gui.geometry":"1280x720"}` on a reachable rig **THEN** 200 and the runner saw the resize steps
- **GIVEN** the same with the GUI disabled **THEN** 200 and no runner call

### CLI

#### R8: `rk gui resize <WxH|auto>`
`cmd/rk/gui.go` (or a new `gui_resize.go` in the family's one-file-per-verb shape) SHALL add
`resize` with `Args: cobra.ExactArgs(1)`, registered before the family's `usageArgs` re-wrap loop.
Order: `guiDarwinRefusal("resize")` → `ParseGeometry(args[0])` (a parse/range error is
`usageError(err)`, exit 2 — the `click` bad-coordinates precedent; the message is the § UX copy)
→ `guiRequireReachable` (exit 1 with the shared hints) → for `WxH`: `guiRequireXTool("xrandr", gui.XrandrMissingHint)`
then `gui.Resize(ctx, guiXrandrRunFn, st.Display, w, h)` under a 10 s bound (`guiXrandrRunFn`
is a package seam defaulting to `gui.RunOnDisplay`) — a failure is `error: xrandr failed: <tail>`
exit 1 with the setting untouched → persist via `guiSettingsLoad`/`guiSettingsSave` → print the
datum (`Dataf`): `resized :10 to 1600x900 (was 1920x1080)` (was = previous setting value) or, for
`auto`, `desktop follows the focused viewer (gui.geometry=auto)`. Not an input verb (never
consults the human-input guard). `Long` help mirrors `lock`'s register.

- **GIVEN** `rk gui resize 1600x900` on a reachable stubbed status **THEN** the runner saw the steps for the status display, the setting reads `1600x900`, stdout is the resized line, exit 0
- **GIVEN** `rk gui resize auto` **THEN** no runner call, setting `auto`, the follows line
- **GIVEN** `rk gui resize 100x100` **THEN** `Error: geometry 100x100 out of range (320–7680 per side)`, exit 2, no runner call
- **GIVEN** the GUI off **THEN** `gui is off — turn it on with 'rk gui on'`, exit 1

#### R9: status summary and doctor row carry `fixed`/`auto`
`guiOnSummary` SHALL gain a `geometry string` parameter and render the geometry segment as
`WxH fixed` when `geometry != "auto"` and `WxH auto` when it is `auto` (the `WxH` stays the
probe's live width/height; an empty geometry renders bare `WxH` for safety). `guiStatusSummary`
passes `st.Geometry`; `cmd/rk/doctor.go` `guiCheck` gains the same parameter and `guiDoctorCheck`
passes the setting. Update the existing expectations in `gui_test.go` (line ~891) and
`doctor_test.go` (line ~1751) to `1920x1080 fixed` (they run against the default).

- **GIVEN** a reachable status with `Geometry = "1600x900"` **THEN** `gui: on (Xtigervnc, :10, 1600x900 fixed, 1 viewer, icewm-session)`
- **GIVEN** `Geometry = "auto"` **THEN** `… 1920x1080 auto, …`

### Frontend

#### R10: API client types and `resizeGui`
`src/api/client.ts`: `GuiStatus.geometry: string`; `resizeGui(geometry: string, id = "host")`
POSTs `/api/gui/{id}/resize` with body `{ geometry }` and resolves the parsed
`{ ok: true; geometry: string; was: string }`; non-2xx throws via `throwOnError` (the 400/500
messages become the toast). `src/contexts/session-context.tsx`: `GuiSignal.geometry: string`,
narrowed like `wm` (a missing or non-string field reads `""`). Extend the existing `client.test.ts`
gui cases and the `session-context` gui narrowing test.

- **GIVEN** a stream entry with `"geometry":"1600x900"` **THEN** `useGui().geometry === "1600x900"`; **GIVEN** an entry without the key **THEN** `""`

#### R11: `resizeSession` gains the `auto` gate
`src/components/gui-surface.tsx`: `rfb.resizeSession = !coarsePointer && focused && !resizeLocked && !hostLocked && geometry === "auto"`
where `geometry = gui?.geometry ?? ""` rides `propsRef` like `hostLocked`. The single added clause;
fit mode already letterboxes (`scaleViewport`), nothing else in the mapping changes. Rewrite the
header doc's **Resize policy** bullet: D7's follow is now the `auto` value of `gui.geometry`; a
fixed geometry disables `resizeSession` for every viewer (V-D4); the two pins keep their meaning
under `auto`.

- **GIVEN** fine + focused + unlocked + `geometry: "auto"` **THEN** `resizeSession === true` (today's four-clause table holds under `auto`)
- **GIVEN** the same with `geometry: "1920x1080"` (or `""`) **THEN** `false`, regardless of the other clauses

#### R12: the `GUI: Resolution →` palette rows and the disabled Lock rows
`src/lib/gui-geometry.ts` (new, pure, unit-tested): `GUI_GEOMETRY_PRESETS` =
`["1280x720","1600x900","1920x1080","2560x1440","1080x1920"]`; `presetLabel(p)` renders
`1280×720` … and `1080×1920 (portrait)`; `parseGeometryInput(s)` accepts `1440x900`, `1440×900`,
`1440 900` (any of `x`, `×`, whitespace as the separator, surrounding whitespace ignored) and
returns `{ w, h, geometry: "1440x900" }` or an error string (`Width×Height, 320–7680 per side`)
enforcing 320–7680 client-side; `closestAspectPreset(w, h)` returns the preset whose aspect ratio
is nearest the given size's (ties → the larger preset). `src/lib/palette/gui.ts`
`GuiPaletteInput` gains `geometry: string`, `onResize: (geometry: string) => void`,
`onResizeCustom: () => void`, `onMatchTile: () => void`; `buildGuiActions` adds, when
`enabled && reachable && backend !== "screen-sharing"` (the launch rows' gate — a tile need not be
open), right after the launch rows: one row per preset — id `gui-res-<WxH>`, label
`GUI: Resolution → <presetLabel>`, description `current` on the row whose preset equals `geometry`,
`onSelect: () => onResize(preset)`; `gui-res-match` `GUI: Resolution → Match this tile` (**only
when `tileOpen`** — it measures the tile); `gui-res-custom` `GUI: Resolution → Custom…`;
`gui-res-auto` `GUI: Resolution → Auto (follow this tile)` with description
`today's behavior — the desktop follows the focused fine-pointer viewer` (hidden when `geometry === "auto"`,
the destination-only rule). The existing `GUI: Lock resolution` / `Unlock resolution` rows stay
exactly as today under `auto`; under a fixed geometry the row renders **disabled** with description
`resolution is fixed (1920×1080) — pick Auto to follow the tile` (the `×` glyph and the current
value; never removed — V-D4). `app.tsx` wires: `geometry: gui?.geometry ?? ""`; `onResize` →
`resizeGui(g)` with an error toast on throw and no toast on success; `onMatchTile` measures
`[data-testid="gui-surface-canvas"] > div[key host]`'s bounding box (the noVNC host div —
fall back to the canvas wrapper) and posts `closestAspectPreset(width, height)`; `onResizeCustom`
opens a new `GuiGeometryPrompt` (`src/components/gui-geometry-prompt.tsx`, modeled on
`SessionNamePrompt`: `Dialog` title `Desktop size`, one input `aria-label="Width×Height"`
placeholder `1440x900`, live `parseGeometryInput` validation with the inline red error, Enter or a
`Resize` button submits `geometry`, Escape closes; lazy-loaded like `SessionNamePrompt`). No toast
on a successful resize; the desktop visibly reflows.

- **GIVEN** the R8 worked-example input plus `geometry: "1920x1080"` **THEN** the ids run `gui-turn-off, gui-open-terminal, gui-open-browser, gui-res-1280x720, gui-res-1600x900, gui-res-1920x1080, gui-res-2560x1440, gui-res-1080x1920, gui-res-match, gui-res-custom, gui-res-auto, gui-fullscreen, gui-paste, gui-view-1to1, gui-lock, gui-logs` and `gui-res-1920x1080` carries description `current` while `gui-lock` is `disabled` with the fixed copy
- **GIVEN** `geometry: "auto"` **THEN** `gui-res-auto` is absent and `gui-lock` is enabled with no description
- **GIVEN** `tileOpen: false` **THEN** `gui-res-match` is absent but the presets, Custom…, and Auto remain
- **GIVEN** `backend: "screen-sharing"` or `reachable: false` **THEN** no `gui-res-*` rows
- **GIVEN** `parseGeometryInput("1440×900")`, `("1440 900")`, `(" 1440x900 ")` **THEN** `1440x900`; **GIVEN** `"100x100"` or `"abc"` **THEN** the error string
- **GIVEN** `closestAspectPreset(375, 812)` **THEN** `1080x1920`; `(1440, 900)` **THEN** `1600x900`

### Tests

#### R13: Playwright coverage
`tests/e2e/gui-surface.spec.ts`: the mocked fixtures gain `geometry` (`GUI_ON_BARE`/`GUI_ON_ICEWM`
carry `"1920x1080"`; add `GUI_ON_FIXED = { …GUI_ON_ICEWM[0], geometry: "1600x900" }` and
`GUI_ON_AUTO` with `"auto"`). Ungated desktop tests (each with a Proves/Steps intent block per
Constitution § Test Intent Comments): (1) with `GUI_ON_FIXED` and the gui tile open, the palette
option `GUI: Lock resolution` is disabled and its description reads exactly
`resolution is fixed (1600×900) — pick Auto to follow the tile`; flipping to `GUI_ON_AUTO` via
`emitGui` re-enables it and shows `GUI: Resolution → Auto (follow this tile)` no longer; (2)
selecting `GUI: Resolution → 1280×720` against a stubbed `POST /api/gui/host/resize` sends body
`{"geometry":"1280x720"}`. Real-rig (Xtigervnc-gated) case appended to the existing rig describe:
POST `/api/gui/host/resize {"geometry":"1280x720"}` (through `page.request`) ⇒ `pollGuiStatus`
sees `width === 1280 && height === 720` within 5 s, and the open gui tile's `canvas` bounding box
is narrower or shorter than the host div's (letterboxed, aspect 16:9 within 2 px); then resize
back to `1920x1080`. The rig `afterAll` restore already unsets `gui.enabled`; also POST
`{"gui.geometry": null}` there so the developer's file loses the key.

- **GIVEN** `just test-e2e "gui-surface"` **THEN** green (the rig half skips cleanly without Xtigervnc)

### Docs

#### R14: spec, skill page, plan pointers
- `docs/specs/gui.md` § Resize policy — rewritten: the desktop size is the host preference
  `gui.geometry` (default `1920x1080`, fixed); D7's follow-the-tile is its `auto` value; under a
  fixed value `resizeSession` is false for every viewer and the pins (viewer-local `GUI: Lock
  resolution`, host `rk gui lock`) are inert, rendered as a disabled description row (V-D4);
  aspect is preserved by fit-mode letterboxing (V-D5); live apply via RandR (V-D3, the spike
  table above in one line). § Agent verbs gains `rk gui resize <WxH|auto>` (and notes the endpoint
  `POST /api/gui/{id}/resize` with its status-code rows). § The switch's settings table gains the
  `gui.geometry` row (a plain text field in the dialog; the select control is a later stage). The
  index description in `docs/specs/index.md` for GUI Surface replaces "the fine-pointer-only
  resize policy" with "the fixed-by-default `gui.geometry` resize policy (`auto` = follow the tile)".
- `docs/site/skill/gui.md` — **add without trimming** (S1 trimmed): in the `lock`/`unlock`
  section add `rk gui resize 1600x900` (and `auto`) with the note that a fixed desktop is what keeps
  `shot`/`click` coordinates stable; one line in Exit codes' datum list (`resize`: the `resized …`
  line). Net ≤ 3 lines; stay under the 150-line cap `skill_test.go` enforces. Then run
  `scripts/sync-skill.sh` so `cmd/rk/skill/gui.md` matches (the drift-guard test fails otherwise).
- `fab/plans/sahil/26-09-09-gui-surface.md` D7 row: append ` — **amended by V1** (`gui.geometry`; the follow is now the `auto` value): see [`26-09-10-gui-viewer-ergonomics.md`](26-09-10-gui-viewer-ergonomics.md)`.
- `fab/plans/sahil/26-09-10-gui-viewer-ergonomics.md` § Change breakdown V1 row: fill
  `Change folder` with `260910-zuci-gui-fixed-geometry-and-resize`, status `in progress`; also
  fill the S2 row of `26-09-10-gui-combined-execution.md`'s handover table with the same folder.
- Memory (`docs/memory/run-kit/gui.md`, `configuration.md`, `api-and-sockets.md`,
  `ui/lenses-and-layout.md`, `ui/keyboard-and-palette.md`) is hydrate's, not apply's.

### Non-Goals
- The Settings-dialog select/picker control for `gui.geometry` — S3 (Coordination point 1).
- Server-side framebuffer scaling, per-viewer desktop sizes, zoom/pointer/quality (V2–V4).
- Reopening D1–D6 / D8–D10; any change to `internal/status` or the pipeline.

### Design Decisions

#### The desktop size is a host preference, fixed by default
**Decision**: `gui.geometry` (default `1920x1080`) fixes the desktop; following the focused tile is the opt-in `auto` value.
**Why**: one shared desktop cannot belong to one viewer's tile; a guest that never reflows is what keeps `rk gui shot`/`click` coordinates stable.
**Rejected**: keeping follow-the-tile with the lock pins as the only escape (a pin freezes whatever size happened to be current — a stopgap, not a chosen size).
*Introduced by*: 260910-zuci-gui-fixed-geometry-and-resize

#### Live resize is a zero-timing RandR modeline, never a restart
**Decision**: `--newmode WxH 0 W 0 0 0 H 0 0 0` + `--addmode <probed output>` + `--output --mode`, skipping the first two when the mode is already listed; the output name comes from `xrandr --query`.
**Why**: Xvnc with `-AcceptSetDesktopSize` accepts arbitrary sizes and ignores mode timings, so no CVT arithmetic is needed; a restart would kill every app on the display. `--fb` alone desyncs screen and output.
**Rejected**: hardcoding `VNC-0`; `xrandr -s`/`--fb`; computed CVT modelines.
*Introduced by*: 260910-zuci-gui-fixed-geometry-and-resize

#### The setting is written only after the display actually resized
**Decision**: the endpoint, the CLI, and the settings-POST side effect all run `xrandr` first; the endpoint and CLI leave `gui.geometry` unwritten on failure (the settings POST has already saved by the generic path, so its resize is best-effort with a warning).
**Why**: the setting must stay truthful to what happened on the display; a restart then lands on the same size.
**Rejected**: persist-then-resize (a failed resize would leave the stream claiming a size the display never took).
*Introduced by*: 260910-zuci-gui-fixed-geometry-and-resize

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/backend/internal/gui/geometry.go` with the constants, `ParseGeometry`, `ValidateGeometry`, `FormatGeometry`, `XrandrQueryArgv`, `ParseXrandrQuery`, `XrandrResizeArgv`, `DisplayRunner`, `RunOnDisplay`, `Resize`, `XrandrTimeout`, `XrandrMissingHint`; add `geometry_test.go` (table tests per R2/R3 incl. the spike's `xrandr --query` fixture and a fake-runner `Resize` test). <!-- R2, R3 -->
- [x] T002 [P] Add `Settings.GUIGeometry` + the `gui.geometry` registry row in `app/backend/internal/settings/settings.go` (parse/serialize/read/apply per R1); update `registry_test.go` (inventory 16, metadata check row, ReadValue default) and `settings_test.go` (round-trip fixture + a `TestGUIGeometry` mirroring `TestGUIWM`: omitted at default, `auto`/custom round-trip, null restores default, invalid rejected with the range message). <!-- R1 -->

### Phase 2: Core Implementation

- [x] T003 Widen `gui.BackendArgv(bin, display, socket, geometry)`; in `cmd/rk/gui_supervise.go` resolve the start-time geometry from `guiSuperviseSettingsLoad().GUIGeometry` and log `guiDesktopLine`; update `internal/gui/backend_test.go` and add supervise tests for both branches (fixed value ⇒ `-geometry 1600x900` + `(gui.geometry)` line; `auto` ⇒ `1920x1080` + the auto line). <!-- R4 -->
- [x] T004 Add `Geometry` to `gui.Status`/`gui.StreamEntry`/`gui.StatusDeps` and fill it in `Assemble`; in `api/sse.go` store `h.guiGeometry` from the per-tick `settings.Load()`, clear on `setGUIEnabled(false)`, render in `guiPayloadLocked`; pass `settings.Load().GUIGeometry` from `api/gui.go` `buildGuiStatus` and `cmd/rk/gui.go` `gatherGUIStatus`; tests: `assemble_test.go` (enabled carries it, disabled `""`), the sse gui payload test (`api/sse_test.go` or the existing gui-slot test file) asserts `"geometry"`. <!-- R5 -->
- [x] T005 Add `handleGuiResize` in `api/gui.go` + `guiXrandrRunFn` seam on `Server` (`api/router.go` field + `r.Post("/api/gui/{id}/resize", …)`), per the R6 table; tests in `api/gui_test.go` covering every row (success body with `was`, xrandr failure leaves the setting unwritten, `auto` persists only, 400 range, 400 bad body, 409 disabled, 409 unreachable, 500 xrandr missing). <!-- R6 -->
- [x] T006 In `api/settings.go` add the `gui.geometry` post-save side effect (best-effort live resize when fixed + enabled + reachable, warning on failure); test in `api/settings_test.go` (reachable rig ⇒ runner saw the steps; disabled ⇒ no call; `auto` ⇒ no call). <!-- R7 -->
- [x] T007 Add `rk gui resize` (`cmd/rk/gui_resize.go`, registered in `gui.go`'s `init` before the `usageArgs` loop) with the `guiXrandrRunFn` seam; tests in `gui_resize_test.go` for the three § UX invocations (recorded argv, saved setting, exact stdout, exit class) plus the off/not-running/darwin refusals. <!-- R8 -->
- [x] T008 [P] `guiOnSummary` + `guiCheck` gain `geometry`; render `WxH fixed` / `WxH auto`; update `gui_test.go` and `doctor_test.go` expectations and add the `1600x900 fixed` / `auto` cases. <!-- R9 -->
- [x] T009 [P] Frontend client + signal: `GuiStatus.geometry`, `resizeGui`, `GuiSignal.geometry` narrowing in `src/contexts/session-context.tsx`; extend `src/api/client.test.ts` and the session-context gui test. <!-- R10 -->
- [x] T010 `src/components/gui-surface.tsx`: add the `geometry === "auto"` clause via `propsRef`, rewrite the header's Resize-policy bullet; extend `gui-surface.test.tsx`'s RFB prop-mapping table (auto preserves the four-clause behavior; any fixed value or `""` forces false). <!-- R11 -->
- [x] T011 Create `src/lib/gui-geometry.ts` (+ `gui-geometry.test.ts`): presets, `presetLabel`, `parseGeometryInput`, `closestAspectPreset` per R12. <!-- R12 -->
- [x] T012 Extend `src/lib/palette/gui.ts` (`geometry`, `onResize`, `onResizeCustom`, `onMatchTile`; the `gui-res-*` rows; the disabled Lock rows) and `gui.test.ts` (the R12 worked example, `auto` vs fixed, `tileOpen` gating of Match, mirror/unreachable hide, `current` description, onSelect routing). <!-- R12 -->
- [x] T013 Create `src/components/gui-geometry-prompt.tsx` (+ `gui-geometry-prompt.test.tsx`: Enter submits the normalized geometry, invalid shows the inline error and disables the button, Escape closes) and wire `app.tsx`: the three callbacks, the lazy prompt mount beside `SessionNamePrompt`, `onMatchTile`'s measurement, error toasts. <!-- R12 -->

### Phase 3: Integration & Edge Cases

- [x] T014 `tests/e2e/gui-surface.spec.ts`: fixtures gain `geometry`; add the two ungated desktop tests (disabled Lock row copy + re-enable on `auto`; `Resolution → 1280×720` posts the exact body) and the real-rig resize case (width/height follow within 5 s, canvas letterboxes, restore `1920x1080`; `afterAll` also unsets `gui.geometry`) — every new `test()` carries a Proves/Steps block. <!-- R13 -->
- [x] T015 Run the gates in order: `just test-backend`, `just test-frontend`, `just test-e2e "gui-surface"`, `just build`; fix anything red. (`just setup` has been run in this worktree.) <!-- R13 -->

### Phase 4: Polish

- [x] T016 Docs per R14: `docs/specs/gui.md` (§ Resize policy rewrite, § Agent verbs `resize` + endpoint rows, § The switch row), `docs/specs/index.md` description, `docs/site/skill/gui.md` (add ≤ 3 lines, then `scripts/sync-skill.sh`; keep under 150 lines), the parent plan's D7 pointer, the V1 row in the ergonomics plan and the S2 row in the combined-execution plan. <!-- R14 -->

## Execution Order

- T001 and T002 first (T002 imports `gui.ValidateGeometry` from T001); T003–T008 depend on T001; T005 depends on T004 (status `Geometry`); T006 depends on T005's seam
- T009 → T010/T012 → T013 (the palette input and the prompt both consume the client types); T011 before T012/T013
- T014 after T010–T013; T015 last of Phase 3; T016 independent of the code tasks

## Acceptance

### Functional Completeness

- [x] A-001 R1: `gui.geometry` is the 11th registry key (16 total) with the exact description, `ui: true`, `live: true`, default `1920x1080`, omitted from the file at default, round-tripping `auto` and `WxH`
- [x] A-002 R2: `ParseGeometry`/`ValidateGeometry` accept `auto` and `WxH` in 320–7680 and reject everything else with the two documented messages
- [x] A-003 R3: `ParseXrandrQuery` yields `VNC-0` and the mode names from the spike fixture; `XrandrResizeArgv` emits one step for a listed mode and the zero-timing `--newmode`/`--addmode`/`--output` triple otherwise; `Resize` orchestrates query → steps over the runner and stops at the first failure
- [x] A-004 R4: the supervisor's `-geometry` follows the setting (`auto` ⇒ `1920x1080`) and logs the matching desktop line
- [x] A-005 R5: `geometry` is present on the stream entry and the status document, sourced from the setting each tick with no new tmux stamp
- [x] A-006 R6: `POST /api/gui/{id}/resize` implements every row of the R6 table; the setting is written only after a successful xrandr run
- [x] A-007 R7: a settings POST carrying a fixed `gui.geometry` resizes the reachable display best-effort and never fails the request
- [x] A-008 R8: `rk gui resize` prints the three § UX outputs verbatim with the documented exit classes, gated like `launch`
- [x] A-009 R9: `rk gui status` and the doctor row render `WxH fixed` / `WxH auto`
- [x] A-010 R10: `GuiStatus.geometry`, `GuiSignal.geometry`, and `resizeGui` exist and are typed as specified
- [x] A-011 R11: `resizeSession` is false for every viewer under any non-`auto` geometry and unchanged under `auto`
- [x] A-012 R12: the five preset rows, Match this tile (tile-open only), Custom…, and Auto rows exist with the exact labels/descriptions; the Lock rows render disabled with the fixed copy under a fixed geometry and unchanged under `auto`
- [x] A-013 R14: spec § Resize policy / § Agent verbs / § The switch, the specs index line, the skill page (synced, ≤ 150 lines), the parent D7 pointer, and the two plan-table rows are updated

### Behavioral Correctness

- [x] A-014 R11: **N/A**: live-desktop manual check (the operator's, per Coordination point 3); the mechanism is unit-proven (`resizeSession === false` under any non-`auto` geometry in `gui-surface.test.tsx`) but sidebar-toggle stability on the live desktop is not e2e-covered
- [x] A-015 R6: **N/A**: live-desktop manual check; the real-rig e2e case proves the endpoint-driven half (POST resize ⇒ status `width`/`height` follow within 5 s), but the `rk gui resize` CLI form and the no-app-killed assertion on the live desktop remain the operator's
- [x] A-016 R4: **N/A**: live-desktop manual check (`rk gui restart` on the live desktop); the supervisor's start-time read is covered by `TestGuiSuperviseLinuxGeometryFromSettings`

### Scenario Coverage

- [x] A-017 R3: the fake-runner `Resize` test proves the `--addmode` failure path stops before `--output` and surfaces the stderr tail
- [x] A-018 R6: the handler test proves a failed xrandr leaves `gui.geometry` unwritten and returns 500 with the tail
- [x] A-019 R13: the two ungated Playwright tests and the rig case exist with Proves/Steps blocks and `just test-e2e "gui-surface"` passes (rig half skipping cleanly without Xtigervnc)

### Edge Cases & Error Handling

- [x] A-020 R2: boundary values `320` and `7680` are accepted; `319` and `7681` rejected; `1920×1080` (unicode ×) is a shape error at the backend while the frontend prompt normalizes it
- [x] A-021 R6: `xrandr` missing on PATH ⇒ 500 with the x11-xserver-utils hint (CLI: exit 1 with the same hint); macOS ⇒ 409 (CLI: the darwin refusal naming `resize`)
- [x] A-022 R5: a disabled GUI renders `geometry: ""` on both surfaces; a transient `geometry` vs `width/height` disagreement mid-resize is tolerated (no assertion couples them)
- [x] A-023 R12: `closestAspectPreset` picks the portrait preset for a phone-shaped tile and `Match this tile` never appears without an open gui tile

### Code Quality

- [x] A-024 Pattern consistency: new Go seams follow the package-var / `Server`-field idiom (`guiXrandrRunFn`), every subprocess is an argv slice under `exec.CommandContext` with a timeout (Constitution I / § Process Execution), no shell strings
- [x] A-025 No unnecessary duplication: one geometry parser (`internal/gui`) shared by settings, CLI, API, and supervisor; one `Resize` orchestration shared by the endpoint, the CLI, and the settings side effect; the frontend parses input in one pure module
- [x] A-026 Tests cover the added behavior (Go unit tests per file touched; vitest for the truth table, palette rows, prompt, geometry helpers; Playwright per R13) and every new Playwright `test()` carries the Proves/Steps intent block
- [x] A-027 No comment narration or change-ID citations in code comments; constants named (no magic `320`/`7680`/`10s` literals outside their declarations)
- [x] A-028 Type narrowing over assertions in the frontend (the `GuiSignal.geometry` guard, the prompt's parse result)

### Security

- [x] A-029 R6: the resize body is parsed with `DisallowUnknownFields`, `geometry` is range-validated before any subprocess runs, and the xrandr argv contains only validated integers and the query-derived output name — no user string reaches argv unparsed

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- The live `rk-gui` session was absent during planning; the spike ran on a throwaway `:95`. Manual acceptance (A-014–A-016 on the live desktop) is the operator's, serialized per Coordination point 3.

## Deletion Candidates

None — this change adds new functionality without making existing code redundant (the hardcoded `-geometry 1920x1080` literal in `internal/gui/backend.go` was removed in the same diff that parameterized it; the D7 four-clause `resizeSession` path and both lock pins stay live under `auto`).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The xrandr incantation is the zero-timing `--newmode WxH 0 W 0 0 0 H 0 0 0` + `--addmode` + `--output --mode`, skipping the first two when listed; output probed from `--query` | Spike-verified on Xtigervnc for 1600x900, 1080x1920, 2560x1440; `--fb` and `-s` proven wrong | S:95 R:80 A:95 D:95 |
| 2 | Confident | `gui.BackendArgv` gains a `geometry` parameter (an internal-package signature widening with one caller + one test) rather than a parallel builder | The only way to feed the setting into the argv without duplicating the fixed flag list; the intake's "additive-only" claim concerns the HTTP/stream contracts | S:70 R:90 A:90 D:85 |
| 3 | Confident | `POST /api/settings` carrying a fixed `gui.geometry` runs the live resize best-effort (warning on failure, 200 kept) | The intake pins `live: true` and the copy "Applies live"; without the side effect the Settings text field would need the restart badge | S:60 R:85 A:80 D:70 |
| 4 | Confident | `geometry` is `""` on the stream entry and status document when the GUI is disabled, the setting value when enabled | Matches the all-zero disabled entry; the palette never needs it while disabled | S:65 R:90 A:85 D:80 |
| 5 | Confident | `rk gui resize` treats a parse/range error as usage (exit 2), the § UX `Error:` line unchanged | The family's `click` bad-coordinates precedent; the intake fixes the copy, not the exit class | S:60 R:90 A:80 D:70 |
| 6 | Confident | The `Resolution →` preset/Custom/Auto rows share the launch rows' gate (`enabled && reachable && !mirror`, no tile needed); `Match this tile` alone requires an open gui tile | The plan says "terminal route, enabled && reachable"; Match has nothing to measure without a tile | S:70 R:90 A:85 D:80 |
| 7 | Confident | `Custom…` is a new `GuiGeometryPrompt` component modeled on `SessionNamePrompt` (Dialog + one input + validation + button) rather than reusing that session-specific component | `SessionNamePrompt` carries session-name conversion and collision logic; "the session-name prompt shape" is a shape, not a reuse target | S:65 R:90 A:85 D:75 |
| 8 | Confident | `was` in the resize response and CLI datum is the previous **setting** value (possibly `auto`), not the probe size | The intake example `"was":"1920x1080"` reads as the setting; the probe size can lag mid-resize | S:60 R:90 A:80 D:70 |
| 9 | Confident | The Auto row hides while `geometry === "auto"` (destination-only), and the `current` description marks the matching preset row | The palette's destination-only convention for Fit/1:1 and Lock/Unlock | S:60 R:95 A:85 D:75 |

9 assumptions (1 certain, 8 confident, 0 tentative).

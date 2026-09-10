# Plan: GUI Perf Measure (C5 — the gate for C6)

**Change**: 260910-xy7q-gui-perf-measure
**Intake**: `intake.md`

## Requirements

### GUI supervisor: the empty desktop is visibly a desktop

#### R1: Solid root background after the WM starts
On Linux, after the window-manager launch step, the supervisor SHALL paint the X root window a solid color (`gui.RootBackground` = `#3b4252`) by running `xsetroot -solid <color>` with `DISPLAY=<display>` in its environment, bounded by a 5 s context, best-effort: a failed run logs `gui: xsetroot failed: <err>; the empty desktop stays black` and the supervisor continues. When `xsetroot` is not on PATH the supervisor SHALL log `gui: no xsetroot on PATH; the empty desktop stays black — apt install x11-xserver-utils` and continue. The macOS supervisor is unchanged.

- **GIVEN** `Xtigervnc` and `xsetroot` on PATH and `rk gui on`
- **WHEN** the supervisor reaches the WM step
- **THEN** `xsetroot -solid #3b4252` runs against `DISPLAY=:N`, `rk gui shot` shows the solid color instead of black, and the tile shows the same

- **GIVEN** `xsetroot` absent
- **WHEN** the supervisor reaches the WM step
- **THEN** the hint line is logged, the backend-up line still appears, and the supervisor keeps running

### e2e: a `@perf` GUI smoothness benchmark

#### R2: Shared Xvnc-rig helpers live in `_gui.ts`
The Xvnc-rig helpers currently private to `gui-surface.spec.ts` (`hasXtigervnc`, `RIG_ORIGIN`, `postSettingsRaw`, `fetchGuiStatusRaw` + its document type, `pollGuiStatus`, `stableGuiGeometry`) SHALL move to `app/frontend/tests/e2e/_gui.ts`, joined by `hasXdotool` and a settings snapshot/restore pair over `SETTINGS_PATH`; `gui-surface.spec.ts` SHALL import them with no behavior change.

- **GIVEN** the refactored spec
- **WHEN** `just test-e2e gui-surface` runs on this host
- **THEN** both halves pass exactly as before

#### R3: `gui-perf.spec.ts` measures D9 as an audit
A new `app/frontend/tests/e2e/gui-perf.spec.ts` SHALL run under a `@perf`-tagged describe (excluded from default e2e by `playwright.config.ts`, run via `just pw test gui-perf`), SHALL `test.skip` when `Xtigervnc` or `xdotool` is absent, and SHALL: turn the rig's GUI on via the settings POST (snapshot/restore the settings file, `null`-unset in `afterAll`); launch Playwright's Chromium in kiosk on the payload's `DISPLAY` with a generated ~300 KB long page carrying a fixed 240×240 `#tap` color-toggle square; instrument the viewer through `addInitScript` (a `drawImage(<canvas>)` hook counting noVNC `Display.flip`s, a `WebSocket` wrap summing `/ws/gui/` message bytes, a capture-phase `pointerdown` stamp); scroll the guest with `xdotool click --repeat 300 --delay 33 5` for 10 s while sampling flips/s, Mbit/s, Xvnc cores (`/proc/<pid>/stat`, `CLK_TCK`) and guest-Chromium cores once per second; run 20 click-to-pixel trials (rAF-polled `getImageData` at the square until the color flips, measured from the in-page pointerdown stamp); and record three runs — fine-pointer 1920×1180 viewer with the tile zen-zoomed (desktop follows the tile), coarse 390×844 touch viewer attached alongside (geometry unchanged — D7), and a 5 s idle baseline. It SHALL assert only rig health (canvas painted, ≥1 flip, ≥1 byte, geometry unchanged by the coarse viewer), print a summary table in `afterAll`, and write `test-results/gui-perf-<RK_GUI_PERF_LABEL|loopback>.json`. Every `test()` carries the Proves/Steps intent comment and the file a shared-setup header.

- **GIVEN** a `just dev` rig on this host
- **WHEN** `just pw test gui-perf` runs
- **THEN** three tests pass, the console shows the table, and the JSON file holds per-run `{fps, mbit, xvncCores, guestCores, clickToPixelMs: {p50, p95}, desktop: {width, height}}`

- **GIVEN** CI (no Xtigervnc)
- **WHEN** the suite runs
- **THEN** the spec is not selected (`@perf`), and would skip cleanly if selected

#### R4: Port-scoped link emulation helper
`scripts/gui-perf-link.sh` SHALL provide `on <port> [rtt_ms=260] [mbit=40]`, `off`, and `status`: `on` installs a `prio` root qdisc on `lo` with `netem delay <rtt/2>ms [rate <mbit>mbit]` on band 3 and two `u32` filters (tcp sport == port, tcp dport == port); `off` deletes the root qdisc; `status` prints `tc -s qdisc show dev lo`. It SHALL refuse without passwordless sudo and SHALL never touch any port but the one given.

- **GIVEN** `scripts/gui-perf-link.sh on <E2E_PORT> 260`
- **WHEN** `curl` hits the rig port and the live `:3000` daemon
- **THEN** the rig round-trip is ≥260 ms while `:3000` is unaffected; `off` restores both

### Measurement and record

#### R5: Numbers recorded against D9 with a verdict
The measurements SHALL be run on this VM for `loopback` and `netem-260ms` (260 ms RTT, 40 Mbit/s) and written into `docs/memory/run-kit/gui.md` § Smoothness (C5): method, results table (`run · viewer · desktop · fps · Mbit/s · Xvnc cores · guest cores · click-to-pixel p50/p95 · D9 verdict`), the C6 verdict per the intake's rule (fps/CPU misses trigger C6; click-to-pixel judged net of the RTT floor), and the re-run recipe (rig + `just pw test gui-perf` + the netem script + the live-daemon manual variant using `rk gui exec -- …`). `docs/specs/gui.md` Status/§ Smoothness targets and the plan's C5 row, Status paragraph, and a dated `## C5 verdict` section SHALL be updated in the same change; `docs/memory/run-kit/ui/lenses-and-layout.md` SHALL name `gui-perf.spec.ts` and `_gui.ts`.

- **GIVEN** the recorded table
- **WHEN** a reader checks the verdict
- **THEN** every target has a measured number beside it and the C6 decision cites the rule and the numbers

### Non-Goals
- No frontend product change (no overlay, no perf HUD) — the tile has no live `apps` signal and an overlay over a live desktop is intrusive.
- No real-device runs from the user's laptop/phone by the agent — documented as a re-run recipe.
- No perf budget assertion in the spec — audit, not gate.

### Design Decisions

#### Empty desktop gets a solid root background
**Decision**: the Linux supervisor runs `xsetroot -solid #3b4252` after the WM, best-effort, with an install hint when absent.
**Why**: Xvnc's root is black and openbox paints no desktop, so an empty desktop is indistinguishable from a dead canvas; a solid fill costs the encoder one rect per update.
**Rejected**: Xvnc `-retro` (the weave stipple is JPEG noise on every full update and scales badly on phones); a frontend "empty desktop" overlay (no live `apps` signal; intrusive over a live desktop).
*Introduced by*: 260910-xy7q-gui-perf-measure

#### Perf is audited by a `@perf` spec, never gated
**Decision**: `gui-perf.spec.ts` records fps/bytes/CPU/click-to-pixel and prints/writes them; it asserts only rig health.
**Why**: loopback timing is too noisy for a stable gate (the echo-latency precedent); the D9 verdict is a human reading of the table.
**Rejected**: threshold assertions (flaky on shared runners, wrong on the user's high-RTT link).
*Introduced by*: 260910-xy7q-gui-perf-measure

#### Tailscale is emulated with port-scoped netem, not CDP throttling
**Decision**: `scripts/gui-perf-link.sh` adds the measured 260 ms RTT (+ a 40 Mbit/s cap) on `lo` for the rig's port only.
**Why**: the agent cannot run the user's devices; the C0 verdict found CDP throttling starves the RFB request loop; port scoping keeps the live daemon unaffected.
**Rejected**: CDP `emulateNetworkConditions`; a global `netem` on `lo`.
*Introduced by*: 260910-xy7q-gui-perf-measure

## Tasks

### Phase 1: Preliminary fix (own commit)

- [x] T001 Root background: add `RootBackground` + `RootBackgroundArgv` to `app/backend/internal/gui/backend.go` with tests in `backend_test.go`; add the `guiSuperviseRunOnDisplay` seam, `guiNoRootBackgroundLine`, and the post-WM step to `app/backend/cmd/rk/gui_supervise.go` with tests in `gui_supervise_test.go`; `go test ./...`; rebuild, `rk gui restart`, verify `rk gui shot` shows the color; commit separately <!-- R1 -->

### Phase 2: Spec and helper

- [x] T002 Extract the Xvnc-rig helpers into `app/frontend/tests/e2e/_gui.ts` (+ `hasXdotool`, settings snapshot/restore) and refactor `gui-surface.spec.ts` to import them; `npx tsc --noEmit`; `just test-e2e gui-surface` <!-- R2 -->
- [x] T003 Write `app/frontend/tests/e2e/gui-perf.spec.ts` (`@perf`, gated; guest page + kiosk Chromium + xdotool scroll; drawImage/WebSocket/pointerdown init hooks; per-second sampling incl. `/proc` CPU; click-to-pixel trials; fine/coarse/idle runs; console table + JSON) with intent comments; run it via `just pw test gui-perf` on a `just dev` rig until it passes <!-- R3 -->
- [x] T004 [P] Add `scripts/gui-perf-link.sh` (`on <port> [rtt] [mbit]` / `off` / `status`, sudo-gated, port-scoped `tc` prio+netem+u32) and verify with `curl` timing against the rig port and `:3000` <!-- R4 -->

### Phase 3: Measure and record

- [x] T005 Run the spec for `loopback` and `netem-260ms`; write § Smoothness (C5) into `docs/memory/run-kit/gui.md` (method, table, verdict, recipe) and the supervisor root-background step; update `docs/memory/run-kit/ui/lenses-and-layout.md`, `docs/specs/gui.md`, and the plan's C5 row/Status/`## C5 verdict`; `fab docs-index docs/memory` <!-- R5 -->

## Acceptance

### Functional Completeness

- [ ] A-001 R1: `RootBackgroundArgv` returns `["xsetroot","-solid","#3b4252"]` when resolvable and `ok=false` otherwise; the supervisor runs it after the WM with `DISPLAY` set and logs the hint when absent
- [ ] A-002 R2: `_gui.ts` exports the helpers and `gui-surface.spec.ts` imports them with unchanged behavior
- [ ] A-003 R3: `gui-perf.spec.ts` exists under `@perf`, gated on Xtigervnc+xdotool, and produces the console table and JSON for fine/coarse/idle runs
- [ ] A-004 R4: `scripts/gui-perf-link.sh` supports on/off/status, refuses without passwordless sudo, and filters on the given port only
- [ ] A-005 R5: `docs/memory/run-kit/gui.md` carries § Smoothness (C5) with the table, verdict, and recipe; the spec, the plan table/Status/verdict section, and lenses-and-layout are updated

### Behavioral Correctness

- [ ] A-006 R1: on this host `rk gui shot` of a freshly restarted, empty desktop is `#3b4252`, not black; the tile shows the same

### Scenario Coverage

- [ ] A-007 R1: Go tests cover xsetroot-present (argv + DISPLAY recorded) and xsetroot-absent (hint logged, backend still up)
- [ ] A-008 R3: the spec skips with a reason when Xtigervnc/xdotool are absent (`test.skip` predicate present) and is excluded from `just test-e2e` by the `@perf` tag
- [ ] A-009 R4: `on` then `off` leaves `tc qdisc show dev lo` at the default `noqueue`

### Edge Cases & Error Handling

- [ ] A-010 R1: an `xsetroot` failure (non-zero exit) logs and does not abort the supervisor or the WM
- [ ] A-011 R3: `afterAll` restores the settings file and kills the guest Chromium and xdotool even when a test fails

### Code Quality

- [ ] A-012 Pattern consistency: seams follow the `guiSupervise*` package-var style; the spec follows `echo-latency.spec.ts`'s addInitScript/afterAll-summary shape; script follows `scripts/` conventions (`set -euo pipefail`, header comment)
- [ ] A-013 No unnecessary duplication: rig helpers live once in `_gui.ts`; no second copy in either spec
- [ ] A-014 Process execution: the xsetroot run uses `exec.CommandContext` with a timeout and an argv slice
- [ ] A-015 Test intent comments: every new/modified `test()` carries Proves/Steps; the file header covers shared setup; no change IDs in comments
- [ ] A-016 Comments state constraints, not narration; no magic numbers without named constants (`RootBackground`, trial counts, budgets)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The root-background step runs after the WM launch, before `backendWait` is armed | Lets a DE that paints its own desktop win; openbox paints nothing so the solid shows | S:70 R:90 A:85 D:75 |
| 2 | Confident | The fine-pointer run zen-zooms the tile at a 1920×1180 viewport and records the resulting desktop geometry rather than forcing exactly 1920×1080 | The tile is bounded by the app chrome; the table reports what was measured | S:65 R:90 A:80 D:70 |
| 3 | Confident | Xvnc CPU is sampled from `/proc/<pid>/stat` deltas (utime+stime over CLK_TCK) rather than `ps %cpu` | `ps %cpu` is a lifetime average; deltas give the scroll-window figure the target asks for | S:70 R:90 A:90 D:80 |

3 assumptions (0 certain, 3 confident, 0 tentative).

# Plan: Quality presets and the stats overlay (S6 / V3)

**Change**: 260910-5psw-gui-quality-presets-and-stats
**Intake**: `intake.md`

## Requirements

### GUI Surface: Quality posture

#### R1: `rk-gui-quality` is a per-viewer posture with three names
`src/lib/gui-posture.ts` SHALL export `type GuiQuality = "sharp" | "balanced" | "smooth"`, a constant `GUI_QUALITY_PRESETS: Record<GuiQuality, { qualityLevel: number; compressionLevel: number }>` = `sharp → (8,1)`, `balanced → (6,2)`, `smooth → (3,7)`, and the pair `readGuiQuality(coarsePointer: boolean): GuiQuality` / `writeGuiQuality(q: GuiQuality): void` on the localStorage key `rk-gui-quality`, in the exact shape of `readGuiPointerMode`/`writeGuiPointerMode` (validated read, pointer-class default, try/catch-noop write). The default MUST be `balanced` on a fine pointer and `smooth` on a coarse one.

- **GIVEN** no `rk-gui-quality` key (or an invalid value such as `"ultra"`)
- **WHEN** `readGuiQuality(false)` / `readGuiQuality(true)` run
- **THEN** they return `"balanced"` / `"smooth"` respectively
- **AND** `writeGuiQuality("sharp")` followed by `readGuiQuality(false)` returns `"sharp"` and the stored string is `sharp`

#### R2: `applyRfbProps` maps the quality posture, not the pointer class
`GuiSurface` SHALL take a `quality: GuiQuality` prop and `applyRfbProps` SHALL set `rfb.qualityLevel`/`rfb.compressionLevel` from `GUI_QUALITY_PRESETS[quality]`, replacing the hardcoded `coarsePointer ? 4 : 6` / `? 6 : 2` branch. Because app.tsx seeds the prop from `readGuiQuality(coarsePointer)`, a viewer who never touches the row lands on `balanced` (6,2) on fine — byte-identical to today — and on `smooth` (3,7) on coarse.

- **GIVEN** a mounted `GuiSurface` with a live RFB
- **WHEN** the `quality` prop is `sharp`, then `balanced`, then `smooth`
- **THEN** the RFB reads `(8,1)`, then `(6,2)`, then `(3,7)`, applied live through the every-render prop effect (no re-dial)

#### R3: The palette carries `GUI: Quality → Sharp | Balanced | Smooth`
`buildGuiActions` SHALL emit three rows with ids `gui-quality-sharp` / `gui-quality-balanced` / `gui-quality-smooth`, labels `GUI: Quality → Sharp` / `→ Balanced` / `→ Smooth`, descriptions `more detail, more bytes` / `default` / `fewer bytes, smoother motion on slow links`, the current preset's description suffixed ` · current`, each `onSelect` calling a new `onQuality(q)` input callback. They share the launch rows' gate (`enabled && reachable && backend !== "screen-sharing"`) and sit immediately after the `GUI: Resolution →` rows. The builder input gains `quality: GuiQuality` and `onQuality`.

- **GIVEN** the switch on, reachable, Xtigervnc backend, `quality: "balanced"`
- **WHEN** `buildGuiActions` runs
- **THEN** all three quality rows are present in Sharp/Balanced/Smooth order, the Balanced row's description reads `default · current`, and selecting Smooth calls `onQuality("smooth")`
- **GIVEN** `backend: "screen-sharing"` or `reachable: false`
- **THEN** no `gui-quality-*` row is emitted

### GUI Surface: Stats seam

#### R4: `GuiSurface` collects fps, Mbit/s, RTT, size, and zoom into a stats snapshot
`GuiSurface` SHALL take a `statsVisible: boolean` prop and, while `statsVisible && connected`, sample a `GuiStats` snapshot once per `STATS_SAMPLE_MS` (1000) from three counters plus two props:
- **fps** — the count of `drawImage` calls whose first argument is an `HTMLCanvasElement` on the tile canvas's own 2D context (noVNC `Display.flip()` — the exact criterion `tests/e2e/gui-perf.spec.ts` uses), installed by wrapping `drawImage` on that context INSTANCE (obtained via `hostEl.querySelector("canvas").getContext("2d")` after connect), never on the prototype and never through noVNC's private `_display`.
- **Mbit/s** — binary message bytes (`ArrayBuffer.byteLength`, `Blob.size`) on the RFB's WebSocket. `GuiSurface` SHALL construct the `WebSocket` itself and hand it to `new RFB(hostEl, socket, { shared: true })` (noVNC 1.7's raw-channel constructor form — `Websock.attach` sets `binaryType`/`onmessage`; an `addEventListener("message")` byte counter coexists with it), so the count needs no global `WebSocket` wrap and no private field.
- **RTT** — every `STATS_PING_MS` (5000) a `POST /api/gui/host/ping` round trip via a new `pingGui(id)` client helper, timed with `performance.now()`; `null` until the first resolves and after a failed ping.
- **desktop size** — `gui.width × gui.height`; **zoom** — the `zoom` prop.
Counting and sampling MUST be idle while `statsVisible` is false or the RFB is disconnected (no interval, no ping, no `drawImage` wrap installed; the byte listener MAY stay attached — it is a cheap increment). Pure rate/format math lives in `src/lib/gui-stats.ts` (`sampleRates`, `formatGuiStats`, the constants) with colocated tests. The ping is a latency probe, not state polling; the interval site carries `// review-ignore: RTT probe — the timed round trip IS the measurement; runs only while the overlay is visible and the RFB is connected` against `code-quality.md`'s no-client-polling anti-pattern.

- **GIVEN** `statsVisible` true and a connected RFB, fake timers
- **WHEN** 30 canvas-source `drawImage` calls and 125 000 bytes of binary messages land within one 1 s tick
- **THEN** the snapshot reads fps 30 and 1.0 Mbit/s
- **GIVEN** `statsVisible` flips false, or the RFB disconnects, or the component unmounts
- **THEN** the sample interval and ping interval are cleared and no further `pingGui` call fires

#### R5: `GuiStatsOverlay` renders the snapshot as a monospace top-right line
`src/components/gui-stats-overlay.tsx` SHALL export `GuiStatsOverlay({ stats })` rendering `data-testid="gui-stats-overlay"` absolutely at top-right of the canvas wrapper (the zoom badge's classes: `absolute top-2 right-2 z-10 … font-mono text-xs select-none pointer-events-none`), text `{fps} fps · {mbit} Mbit/s · {rtt} ms · {W}×{H} · {zoom}` — fps as an integer, Mbit/s to one decimal below 10 and an integer at or above, RTT an integer ms, zoom `fit` or `150%`, each unsampled value `—` (e.g. `— fps · — Mbit/s · — ms · 1920×1080 · fit` before the first tick). `GuiSurface` mounts it in the canvas branch whenever `statsVisible` is true and suppresses the zoom badge while the overlay is visible (the overlay's zoom segment is live).

- **GIVEN** a snapshot `{ fps: 59.4, mbit: 41.2, rttMs: 262, width: 1920, height: 1080, zoom: "fit" }`
- **WHEN** the overlay renders
- **THEN** its text is exactly `59 fps · 41 Mbit/s · 262 ms · 1920×1080 · fit`
- **GIVEN** `{ fps: null, mbit: 3.456, rttMs: null, …, zoom: 150 }`
- **THEN** the text is `— fps · 3.5 Mbit/s · — ms · 1920×1080 · 150%`

#### R6: `rk-gui-stats-visible` is an off-by-default posture with a palette pair
`gui-posture.ts` SHALL export `readGuiStatsVisible(): boolean` / `writeGuiStatsVisible(v: boolean): void` on the key `rk-gui-stats-visible` (`"1"` = visible, absent = hidden — the `rk-gui-lock` shape). `buildGuiActions` SHALL emit a destination-only pair gated on `tileOpen`: `gui-stats-show` `GUI: Show stats` (while hidden) / `gui-stats-hide` `GUI: Hide stats` (while visible), calling `onStatsVisible(true|false)`; the builder input gains `statsVisible` and `onStatsVisible`. app.tsx SHALL own `guiQuality` and `guiStatsVisible` state beside `guiZoom`/`guiPointerMode` (seeded from the posture reads, handlers writing the posture) and thread them to `buildGuiActions` and through `SurfaceLayout` (`guiQuality`, `guiStatsVisible` props) to `GuiSurface`.

- **GIVEN** a fresh viewer
- **WHEN** the gui tile opens
- **THEN** no overlay renders and the palette offers `GUI: Show stats`
- **WHEN** `GUI: Show stats` is selected
- **THEN** the overlay appears, `rk-gui-stats-visible` reads `1`, the palette now offers `GUI: Hide stats`, and a reload keeps the overlay visible

### GUI Backend: The ping route

#### R7: `POST /api/gui/{id}/ping` is a no-op timing endpoint
`api/gui.go` SHALL add `handleGuiPing`: 400 with `validate.ValidateGUIID`'s message on a bad id, otherwise 200 `{"ok":true}` — no settings read, no body decode, no seam call (the cheapest honest round trip). `api/router.go` registers it beside `/resize`. `src/api/client.ts` gains `pingGui(id = "host"): Promise<void>` posting an empty body.

- **GIVEN** the router
- **WHEN** `POST /api/gui/host/ping`
- **THEN** 200 `{"ok":true}`
- **WHEN** `POST /api/gui/other/ping`
- **THEN** 400 `gui id must be "host"`
- **WHEN** `GET /api/gui/host/ping`
- **THEN** 404/405 (Constitution IX — mutations and probes are POST)

### GUI Surface: Tests and docs

#### R8: The real rig proves the overlay counts frames
`tests/e2e/gui-surface.spec.ts`'s Xtigervnc-gated describe SHALL gain a test that opens the tile on the live rig, selects `GUI: Show stats` in the palette, asserts the overlay's size segment equals the payload's `width×height` and its RTT segment reads `\d+ ms` within a few seconds, then launches the terminal role through `page.request.post("/api/gui/host/launch", { data: { app: "terminal" } })` and asserts a sample with fps ≥ 1 AND Mbit/s > 0 appears within 10 s. The mocked desktop half SHALL gain a test that `GUI: Show stats` renders the overlay with the dash placeholders and `1920×1080 · fit`, persists across reload, and `GUI: Hide stats` removes it, plus a test that `GUI: Quality → Smooth` writes `rk-gui-quality=smooth`. Every new `test()` carries the Constitution's Proves/Steps intent block. `gui-perf.spec.ts` is NOT modified.

- **GIVEN** Xtigervnc on PATH and the rig's gui switched on
- **WHEN** the test runs
- **THEN** the overlay reports a non-zero fps and Mbit/s sample after the terminal launch

#### R9: `docs/specs/gui.md` names the presets as the lever C6 sits behind
§ Smoothness targets SHALL gain a paragraph: the three named presets (`Sharp`/`Balanced`/`Smooth` → the tuple table; defaults per pointer class; posture `rk-gui-quality`) are the user-facing lever C6 later swaps a Kasm- or Tight-tuned encoder behind — the names survive the backend; and the stats overlay (`GUI: Show/Hide stats`, `rk-gui-stats-visible`, the five counters and the 5 s `POST /api/gui/{id}/ping` probe). § The tile's zoom/pointer/key-bar subsection SHALL mention the quality row and the overlay in one sentence each, and § Protocol and relay SHALL list `/ping` among the `/api/gui/*` POSTs. Memory (`docs/memory/run-kit/gui.md`, `ui/lenses-and-layout.md`, `ui/keyboard-and-palette.md`) is hydrate's, not apply's.

- **GIVEN** the spec after this change
- **WHEN** a reader searches for `Smooth`
- **THEN** they find the tuple table, the C6 framing, and the overlay description

### Non-Goals

- No encoder swap or relay-level WS ping frame (C6 / a later relay change)
- No host-wide quality setting — quality stays per-viewer like zoom and pointer mode (V-D9)
- No change to `gui-perf.spec.ts`'s own probes; the product seam is a second, independent consumer
- No toolbar pill (V-D10 is S7/V4)

### Design Decisions

#### Quality presets are names; the tuple table is internal
**Decision**: The durable contract is `sharp`/`balanced`/`smooth`; the `(qualityLevel, compressionLevel)` tuples live in one `GUI_QUALITY_PRESETS` constant.
**Why**: C6 can retune or replace what `Smooth` maps to without touching the posture, the palette rows, or the stored per-viewer values.
**Rejected**: Exposing the numeric knobs — brittle across encoders and meaningless to a person on a slow link.
*Introduced by*: 260910-5psw-gui-quality-presets-and-stats

#### The stats seam consumes noVNC's public raw-channel constructor
**Decision**: `GuiSurface` constructs the `/ws/gui/host` WebSocket and passes the object (not the URL) to `new RFB(...)`, counting bytes through its own `message` listener; fps wraps `drawImage` on the tile canvas's 2D context instance.
**Why**: Both hooks are public surfaces rk already owns (its socket, its DOM node) — no global `WebSocket` monkey-patch in product code and no reach into `_sock`/`_display` privates that a noVNC upgrade can rename.
**Rejected**: Reusing the perf spec's prototype-level wraps in the product — they instrument every canvas and socket on the page.
*Introduced by*: 260910-5psw-gui-quality-presets-and-stats

#### Stats collection is opt-in and idle when hidden
**Decision**: The sample interval, the `drawImage` wrap, and the RTT ping exist only while `statsVisible && connected`; the posture defaults off.
**Why**: V-D11 — a viewer who never opens the overlay pays nothing, and the tile's default behavior is unchanged.
**Rejected**: Always-on counters feeding a hidden overlay — a 5 s ping from every idle viewer for a number nobody is reading.
*Introduced by*: 260910-5psw-gui-quality-presets-and-stats

#### RTT rides a timed HTTP POST, not the state stream
**Decision**: `POST /api/gui/{id}/ping` is a validate-and-200 handler; the client times the round trip.
**Why**: Latency is a measurement of the viewer's own link — the SSE stream cannot carry it, and a relay WS ping frame does not exist yet (the plan's explicit "or").
**Rejected**: Adding a WS ping frame to the RFB relay — a relay-protocol change out of this change's scope.
*Introduced by*: 260910-5psw-gui-quality-presets-and-stats

## Tasks

### Phase 1: Setup

- [x] T001 [P] Add the quality posture to `app/frontend/src/lib/gui-posture.ts`: `GuiQuality`, `GUI_QUALITY_PRESETS` (sharp 8/1, balanced 6/2, smooth 3/7), `readGuiQuality(coarsePointer)` (default balanced fine / smooth coarse, invalid → default) and `writeGuiQuality`; add `readGuiStatsVisible`/`writeGuiStatsVisible` on `rk-gui-stats-visible` (the lock's `"1"`/absent shape); extend the module header doc; cover both in `gui-posture.test.ts` (defaults per pointer class, round-trip, invalid value, the three-entry table). <!-- R1, R6 -->
- [x] T002 [P] Add `handleGuiPing` to `app/backend/api/gui.go` (validate id → 400; else 200 `{"ok":true}`), register `r.Post("/api/gui/{id}/ping", …)` in `app/backend/api/router.go` beside `/resize`, and add `TestGuiPingOK` / `TestGuiPingInvalidID` in `gui_test.go` plus a `GET /api/gui/host/ping` row in `TestGuiNoOtherRoutes`; add `pingGui(id = "host")` to `app/frontend/src/api/client.ts` beside `resizeGui` (POST, empty body, throws on non-2xx). <!-- R7 -->
- [x] T003 [P] Create `app/frontend/src/lib/gui-stats.ts`: `STATS_SAMPLE_MS = 1000`, `STATS_PING_MS = 5000`, `type GuiStats = { fps: number | null; mbit: number | null; rttMs: number | null; width: number; height: number; zoom: GuiZoom }`, `sampleRates(prev: {flips, bytes}, now: {flips, bytes}, dtMs)` → `{ fps, mbit }`, `formatGuiStats(s: GuiStats): string` (integer fps, Mbit/s one decimal < 10 else integer, integer ms, `—` for null, `W×H`, `fit`/`N%`); colocated `gui-stats.test.ts` covering the two R5 examples, a sub-1 s dt, and the < 10 / ≥ 10 Mbit/s formatting boundary. <!-- R4, R5 -->

### Phase 2: Core Implementation

- [x] T004 In `app/frontend/src/components/gui-surface.tsx` add the `quality: GuiQuality` prop (into `propsRef`) and make `applyRfbProps` set `qualityLevel`/`compressionLevel` from `GUI_QUALITY_PRESETS[p.quality]`, deleting the coarse branch; update the `coarsePointer` prop doc; in `gui-surface.test.tsx` replace "quality follows the pointer class" with a three-preset mapping test and add `quality: "balanced"` to `guiProps`. <!-- R2 -->
- [x] T005 In `gui-surface.tsx` build the stats seam: construct the WebSocket (`new WebSocket(url)`) in the connect effect and pass it to `new RFB(hostEl, socket, { shared: true })`; attach a `message` byte counter to it; add the `statsVisible: boolean` prop; add a collector effect keyed on `statsVisible && connected` that installs the canvas-source `drawImage` wrap on the tile canvas's 2D context instance (restoring the original on cleanup), runs a `STATS_SAMPLE_MS` interval computing `sampleRates` into a `stats` state, and a `STATS_PING_MS` interval timing `pingGui()` into `rttMs` (null on failure), carrying the `review-ignore` line from R4; clear everything on hide/disconnect/unmount. In `gui-surface.test.tsx`: `vi.stubGlobal("WebSocket", FakeWS)` recording `url` and exposing `dispatchEvent`, make FakeRFB append a `<canvas>` to its target, stub `HTMLCanvasElement.prototype.getContext` to return a per-canvas fake ctx with `drawImage`, mock `pingGui`, and cover: the ws URL is still absolute, the R4 30-flips/125 000-bytes tick, the ping cadence and cleanup on hide/disconnect/unmount, and no interval or ping while hidden. <!-- R4 -->
- [x] T006 Create `app/frontend/src/components/gui-stats-overlay.tsx` (`GuiStatsOverlay({ stats })`, `data-testid="gui-stats-overlay"`, the badge's top-right classes) with `gui-stats-overlay.test.tsx` (the two R5 strings); mount it in `gui-surface.tsx`'s canvas branch when `statsVisible`, feeding `{ …rates, rttMs, width: gui.width, height: gui.height, zoom }`, and gate the zoom badge on `!statsVisible`; add a `gui-surface.test.tsx` case for the dash placeholder before the first tick and the badge suppression. <!-- R5 -->
- [x] T007 In `app/frontend/src/lib/palette/gui.ts` add `quality`, `statsVisible`, `onQuality`, `onStatsVisible` to `GuiPaletteInput`; emit the three `gui-quality-*` rows (fixed descriptions, ` · current` suffix) right after the Resolution rows under the launch-row gate, and the `gui-stats-show`/`gui-stats-hide` destination-only pair under `tileOpen` after the pointer/lock rows; update the header doc; in `gui.test.ts` extend `input()` and the exact-id-list expectations, and add gating/description/callback tests for both families. <!-- R3, R6 -->
- [x] T008 Thread the postures: in `app/frontend/src/app.tsx` add `guiQuality` (seeded `readGuiQuality(coarsePointer)`) and `guiStatsVisible` (`readGuiStatsVisible()`) state with write-through handlers, pass `quality`/`statsVisible`/`onQuality`/`onStatsVisible` to `buildGuiActions` (and to its `useMemo` deps), and pass `guiQuality`/`guiStatsVisible` to `<SurfaceLayout>`; in `app/frontend/src/components/surface-layout.tsx` add the two optional props (default `"balanced"` / `false`) and forward them to `<GuiSurface quality statsVisible>`; update the SurfaceLayout prop docs. <!-- R2, R3, R6 -->

### Phase 3: Integration & Edge Cases

- [x] T009 In `app/frontend/tests/e2e/gui-surface.spec.ts`'s mocked desktop describe add two tests with Proves/Steps blocks: (a) `GUI: Show stats` renders `gui-stats-overlay` reading `— fps · — Mbit/s · — ms · 1920×1080 · fit`, survives a reload, and `GUI: Hide stats` removes it; (b) `GUI: Quality → Smooth` is offered with its description and writes `rk-gui-quality` = `smooth` (read via `page.evaluate`). Extend the file-header comment's summary of what the mocked half covers. <!-- R3, R5, R6 -->
- [x] T010 In the same file's `real Xvnc rig` describe add the R8 test (Proves/Steps block): open the tile, show stats, assert the size segment matches the payload and RTT reads `\d+ ms`, `page.request.post` the terminal launch, and `expect.poll` the overlay text for fps ≥ 1 and Mbit/s > 0 within 10 s; run it with `just test-e2e "e2e/gui-surface"`. <!-- R4, R5, R8 -->

### Phase 4: Polish

- [x] T011 Update `docs/specs/gui.md`: the § Smoothness targets paragraph on the three named presets as the C6 lever plus the stats overlay; one sentence each on the quality row and the overlay in § The tile → Zoom, pointer modes, and the key bar; `/ping` in § Protocol and relay's route list. <!-- R9 -->
- [x] T012 Run the gates in order — `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, `just test-e2e "e2e/gui-surface"`, `just build` — and fix anything red that this change caused. <!-- R2, R4, R7, R8 -->

## Execution Order

- T001, T002, T003 are independent
- T004 → T005 → T006 (all edit `gui-surface.tsx`; T005 needs T002's `pingGui` and T003's math)
- T007 needs T001; T008 needs T004–T007
- T009/T010 need T008; T011 is independent; T012 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `gui-posture.ts` exports `GuiQuality`, `GUI_QUALITY_PRESETS` with exactly sharp (8,1) / balanced (6,2) / smooth (3,7), `readGuiQuality`/`writeGuiQuality` on `rk-gui-quality`, and `readGuiStatsVisible`/`writeGuiStatsVisible` on `rk-gui-stats-visible`
- [x] A-002 R2: `applyRfbProps` reads the tuple from `GUI_QUALITY_PRESETS[quality]`; no `coarsePointer ? 4 : 6` branch remains
- [x] A-003 R3: the three `gui-quality-*` rows exist with the § UX descriptions and the ` · current` marker, under the launch-row gate, after the Resolution rows
- [x] A-004 R4: `GuiSurface` constructs the WebSocket and passes the object to `RFB`; fps counts canvas-source `drawImage` on the tile canvas's context instance; RTT pings every 5 s via `pingGui`
- [x] A-005 R5: `GuiStatsOverlay` renders `data-testid="gui-stats-overlay"` top-right with the exact `{fps} fps · {mbit} Mbit/s · {rtt} ms · {W}×{H} · {zoom}` grammar
- [x] A-006 R6: the `gui-stats-show`/`gui-stats-hide` pair is destination-only and `tileOpen`-gated; app.tsx owns `guiQuality`/`guiStatsVisible` and threads them through `SurfaceLayout`
- [x] A-007 R7: `POST /api/gui/{id}/ping` returns 200 `{"ok":true}` / 400 on a bad id; `pingGui` exists in `client.ts`
- [x] A-008 R8: the gated real-rig test and the two mocked tests exist with Proves/Steps blocks; `gui-perf.spec.ts` is unchanged
- [x] A-009 R9: `docs/specs/gui.md` carries the presets-as-C6-lever paragraph, the tile sentences, and `/ping`

### Behavioral Correctness

- [x] A-010 R2: a fine-pointer viewer with no stored posture still sends `(6,2)` — today's fine preset, byte-identical
- [x] A-011 R2: a coarse-pointer viewer with no stored posture sends `(3,7)` — the V-D9 `Smooth` tuple (today's `(4,6)` is retired by the named table)
- [x] A-012 R6: with no stored posture no overlay renders, no sample interval runs, and `pingGui` is never called

### Scenario Coverage

- [x] A-013 R4: vitest proves 30 canvas-source draws + 125 000 binary bytes in one 1 s tick read `30 fps` and `1.0 Mbit/s`
- [x] A-014 R5: vitest proves the two R5 format examples byte-for-byte
- [x] A-015 R8: on the real rig the overlay reports fps ≥ 1 and Mbit/s > 0 after the terminal launch, and RTT reads a number
- [x] A-016 R4: the overlay and `gui-perf.spec.ts` count the same events (canvas-source `drawImage` on the tile canvas; binary bytes on the `/ws/gui/` socket) — verified by reading both, the construction that yields the plan's ≤ 10 % agreement

### Edge Cases & Error Handling

- [x] A-017 R4: a failed or rejected ping leaves RTT `—` and never throws or toasts
- [x] A-018 R4: hiding stats, an RFB disconnect, and unmount each clear the sample and ping intervals and restore the wrapped `drawImage`
- [x] A-019 R3: the quality rows are absent on the `screen-sharing` backend and while unreachable
- [x] A-020 R5: while the overlay is visible the zoom badge does not render; hiding stats restores the badge behavior
- [x] A-021 R7: `GET /api/gui/host/ping` is 404/405

### Code Quality

- [x] A-022 Pattern consistency: new posture helpers mirror the existing read/write shape; the overlay mirrors the zoom badge's classes; palette rows follow the destination-only / omit-not-disable conventions
- [x] A-023 No unnecessary duplication: the tuple table, the sample constants, and the format grammar each live in exactly one module
- [x] A-024 Type narrowing over assertions: no `as` casts in the new frontend code (guards on `ArrayBuffer`/`Blob`/`HTMLCanvasElement`)
- [x] A-025 Magic numbers named: `STATS_SAMPLE_MS`, `STATS_PING_MS`, and the preset tuples are named constants
- [x] A-026 Comments state constraints, not narration; no change IDs or PR numbers in code comments or intent blocks
- [x] A-027 Tests cover added behavior: posture, palette, stats math, overlay render, GuiSurface collector, Go handler, e2e mocked + gated
- [x] A-028 The `review-ignore` on the ping interval names the reason (a measurement probe, gated on visibility + connection)

### Security

- [x] A-029 R7: the ping handler validates `{id}` with `validate.ValidateGUIID` and reads no body

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- **Manual post-merge validation** (the intake's netem acceptance lines, not CI): `just dev`, `scripts/gui-perf-link.sh on <E2E_PORT+1> 260 40`, open the tile with `GUI: Show stats`, scroll a guest page under `Balanced` then `Smooth` and read the overlay's fps; compare the overlay's Mbit/s against `just pw test gui-perf`'s table row for the same link. `scripts/gui-perf-link.sh off` afterwards.

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant: the retired hardcoded fine/coarse quality branch in `applyRfbProps` was replaced in place (not left alongside), and `GuiSurface`'s `coarsePointer` prop remains consumed by resize gating, `dragViewport`, the trackpad layer, and the key bar.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The V-D9 tuple table is binding, so a coarse viewer's default moves numerically from today's `(4,6)` to `Smooth`'s `(3,7)`; the intake's "matches today" claim holds at the name level (fine stays `(6,2)` exactly) | The two intake statements conflict for coarse; the plan's decision log is marked binding and a constant is trivially retunable | S:70 R:90 A:75 D:65 |
| 2 | Certain | Bytes are counted on a WebSocket `GuiSurface` constructs and hands to noVNC's raw-channel constructor form, not via a global `WebSocket` wrap or `rfb._sock` | noVNC 1.7 `rfb.js` accepts a channel object (`_sock.attach`); the socket is rk's own object | S:75 R:80 A:90 D:85 |
| 3 | Certain | fps wraps `drawImage` on the tile canvas's 2D context INSTANCE, counting canvas-source draws — the perf spec's criterion — rather than patching `Display.flip` through `_display` | `Display.flip()` is the only canvas-source `drawImage` on the target context; the DOM node is rk's | S:80 R:85 A:85 D:80 |
| 4 | Confident | All three quality rows render (fixed descriptions, ` · current` suffix on the active one) under the launch-row gate, not `tileOpen` | The intake names the launch-row gate and says "the three rows render"; the Resolution rows are the precedent for marking `current` | S:70 R:90 A:70 D:60 |
| 5 | Confident | `GUI: Show/Hide stats` is a `tileOpen`-gated destination-only pair; the overlay shows `—` placeholders before the first sample; the zoom badge is suppressed while the overlay is visible | An overlay needs a tile; the zoom badge would overlap the overlay's corner and duplicate its zoom segment | S:60 R:90 A:75 D:65 |
| 6 | Certain | `/ping` validates the id and returns 200 `{"ok":true}` with no settings gate, no body, no seam call | The cheapest handler is the most honest RTT; the client only pings while connected, so an enabled gate adds nothing | S:70 R:90 A:85 D:80 |
| 7 | Confident | The collector (1 s sample, 5 s ping, the `drawImage` wrap) runs only while `statsVisible && connected`, and the ping interval carries a `review-ignore` naming it a measurement probe | V-D11 off-by-default; `code-quality.md` forbids client polling for STATE, and the False Positive Policy is the sanctioned carve-out | S:75 R:85 A:70 D:70 |
| 8 | Confident | The real-rig e2e drives frames with `POST /api/gui/host/launch` (terminal role) rather than the perf spec's kiosk Chromium + xdotool | A window opening paints frames; the perf spec's rig is far heavier than a smoke assertion needs | S:55 R:85 A:70 D:65 |
| 9 | Confident | The netem fps-gain and ≤ 10 % Mbit/s agreement lines are validated by construction (shared event criteria, A-016) plus the manual recipe in § Notes — not asserted in CI | Intake assumption 8; loopback CI cannot emulate the link, and the perf spec itself is an audit, never a gate | S:55 R:80 A:65 D:60 |
| 10 | Confident | Formatting: integer fps, Mbit/s one decimal below 10 and integer at or above, integer ms | Matches the § UX example line (`59 fps · 41 Mbit/s · 262 ms`) while keeping sub-10 Mbit links readable | S:50 R:95 A:80 D:70 |

10 assumptions (3 certain, 7 confident, 0 tentative).

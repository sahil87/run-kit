# echo-latency.spec.ts

Benchmark file that measures **keystroke→echo latency** — the time from a
keystroke leaving the browser to the echoed glyph becoming visible in the
xterm.js buffer. It is an audit (like `sync-latency.spec.ts`): it records a
p50/p95/p99 distribution and prints a summary in `afterAll`; it does **not**
assert a latency budget, because localhost timing is too noisy for a stable
perf gate. Run on demand:

```
just pw test echo-latency
```

## Why measure to the buffer, not the WS frame

`terminal-client.tsx` writes inbound data to xterm via an **adaptive flush**:
small chunks arriving while idle are written synchronously (so an echo paints
this tick), while larger chunks or bursts coalesce into one write per
`requestAnimationFrame`. Whatever path a given chunk takes, the render cost up
to the painted glyph is part of what the user feels. The benchmark therefore
stops the clock at **glyph-in-`term.buffer.active`** rather than at "WS message
received", which would understate latency by the render tail. (Measuring this
way is what let the adaptive flush show up as a real win — full-path p50 fell
from ~40ms to ~10ms when the unconditional rAF wait was removed for echoes.)

The WebGL renderer paints to a canvas that is **not DOM-readable**, so reading
the parsed buffer is the only honest "glyph visible" signal available to a
Playwright driver. To reach the live `Terminal` instance the harness relies on
a test-only registry: `terminal-client.tsx` registers each terminal on
`window.__rkTerminals` (keyed by windowId) on mount and unregisters it on
dispose. The registry is inert unless a test reads it.

## Perceived echo vs. server echo (predictive local echo)

Two latencies are now measured, and they are different things:

- **Server echo** (`measureEcho` / `measureEchoUnderLoad`) — keystroke → the
  glyph the SERVER sent appears in `term.buffer.active`. This is the round-trip
  the user used to wait for on every keystroke.
- **Perceived echo** (`measurePerceivedEcho`) — keystroke → the **predicted**
  glyph is painted locally. Under the predictive-local-echo engine (Approach A:
  the predicted glyph is written into the xterm buffer as a real cell with
  tentative styling, undone via self-authored VT on misprediction), the painted
  glyph appears within the same `onData` tick, independent of pane load or
  network RTT. This is what the user actually feels once prediction is ACTIVE.

To distinguish a *predicted* cell from a *server-echoed* one — and to read the
misprediction counter — the harness uses a second DEV-gated registry,
`window.__rkPredictions` (keyed by windowId, mirroring `__rkTerminals`). It
exposes a `debug()` reader returning `{ state, unconfirmed, mispredictions,
painted, confirmWindowMs }`. `measurePerceivedEcho` snapshots `painted` before
the keystroke and stops the clock when it increments. The engine starts PASSIVE
and only goes ACTIVE after it observes a few in-window echo round-trips (the
mosh-style safety reflex), so the perceived test first polls `debug().state`
until it is `"active"` before timing.

**Renderer confirmation.** The WebGL addon loads in a try/catch with a silent
canvas fallback, and a live WebGL context can also be lost at runtime (tab
backgrounding, GPU reset). Either way the renderer would be slower — making the
latency numbers non-comparable — without any visible signal. So
`terminal-client.tsx` records the active renderer on `window.__rkRenderer`
(`"webgl"` until a context-loss demotes it to `"canvas"`), and the full-path
test asserts it is `"webgl"`. A canvas fallback now fails the run loudly instead
of quietly skewing the measurement. (The same context-loss handler also disposes
the dead addon so the terminal drops to canvas and keeps rendering rather than
freezing — a correctness fix independent of the benchmark.)

Detection is **count-based on the cursor row**, not a fixed cell: the harness
snapshots how many times `ch` appears on the cursor's row before the keystroke,
then polls until that count increases. This is robust to a multi-line shell
prompt re-flowing the line or to cursor-column drift — the arrival of one more
`ch` on the active row is unambiguous. Trials alternate between two chars
(`x`/`o`) and reset to a fresh line (Enter) each trial.

## How the start timestamp is taken

A real keystroke flows `keyboard.press` → xterm keydown → `onData` → `ws.send`
(TerminalClient's `terminal.onData` handler). An init script (`INSTALL_SEND_STAMP`) wraps
`WebSocket.prototype.send` to stamp `window.__rkSendAt = performance.now()` on
every single-character send. The measured latency is `firstVisible −
__rkSendAt`, both `performance.now()` on the page clock — so start and finish
share one clock and only the sub-ms, unbatched keydown handler is excluded.
This mirrors the `WebSocket.prototype.send` wrap pattern in
`mobile-touch-scroll.spec.ts`.

## Attribution: splitting the tail into network vs. render

A single full-path number can't tell you *where* to optimize. A second init
script (`INSTALL_RECV_STAMP`) wraps the `WebSocket` constructor to attach a
`message` listener that fires before the app's own `onmessage` handler and
stamps `window.__rkRecvAt` on the FIRST inbound frame after a keystroke send
(for single-char interactive echo nothing else is in flight, so that frame is
the echo). Both stamps reset per trial. Each measurement then yields three
attributable segments, all on the page clock:

| Segment | Span | What it is |
|---------|------|------------|
| `network` | send → recv | network out + relay + tmux echo + relay + network back |
| `render`  | recv → glyph | `requestAnimationFrame` flush + xterm parse + buffer commit |
| `full`    | send → glyph | the full perceived path (= network + render) |

The summary prints all three distributions plus a one-line attribution verdict
naming whichever p50 dominates. On localhost, **render dominates ~3:1** (network
~8ms, render ~25ms) — the render figure is the rAF-coalescing + parse tail and
is the objective sub-metric the next change (adaptive flush) must drive down.

> A further server-side split (relay-internal PTY-read→WS-write timestamps in
> `relay.go`) would subdivide `network` into browser↔relay vs. relay↔tmux. It is
> deliberately **not** added here: on localhost both halves are tiny and the
> split is not actionable for the render work. It becomes worthwhile only when
> `rk serve` runs over a real network, where the network segment dominates and
> the question shifts to predictive/local echo.

## Baseline and the run-kit tax

A second test measures the **pure tmux echo** with no browser and no
WebSocket: `tmux send-keys '<char>'` directly into the same `cat`, then poll
`tmux capture-pane -p` until the char appears. The delta between the two
distributions — `full-path p50 − baseline p50` — is the **run-kit tax**: the
latency the web path adds over a local tmux echo. This makes the headline
number meaningful across machines (it factors out tmux/hardware noise).

**Baseline resolution caveat:** each `capture-pane` poll spawns a tmux
subprocess (~10-20ms), which is itself the polling granularity. A true tmux
echo faster than that floor is not separable from the measurement tool's own
cost, so the baseline reads ~13ms even though the real tty echo is sub-ms. The
baseline is therefore a conservative floor, and the reported run-kit tax is if
anything an *under*-estimate of the web path's true added latency.

## Jitter: spread and histogram

Percentiles alone can hide a **bimodal** distribution — fast-mode echoes paint
within a few ms while slow-mode echoes wait ~a frame or a pacing window.
Perceptually that is jitter, even when the p50 looks great. The summary
therefore reports, per label:

- `spread(p95−p50)` — the single-number jitter signal, and
- an ASCII **histogram** (4ms buckets, overflow row, trailing-empty trimmed)
  for the idle full-path and under-load distributions, where two clusters are
  directly visible.

## Shared setup

- Per-file timeout raised to 120s (150s on CI) via `test.setTimeout` — the file
  runs `FULL_PATH_TRIALS` + `BASELINE_TRIALS` + `UNDER_LOAD_TRIALS`
  (40 + 40 + 30) echo round-trips plus the perceived-echo (activation + 20
  trials) and alternate-screen suppression tests back to back.
- `beforeAll` creates session `e2e-echo-<ts>` (80×24) and starts `cat` in it
  (`send-keys 'cat' Enter`). `cat` echoes every line of stdin verbatim — the
  cleanest echo source, with no prompt / completion / PS1 noise.
- The throughput guard uses its own `BURST_SESSION` (`e2e-burst-<ts>`) so its
  flood doesn't disturb the echo session; the under-load and perceived-echo
  tests use their own `LOAD_SESSION` (`e2e-echo-load-<ts>`) so the tick stream
  doesn't pollute the idle measurements; the alternate-screen test uses its own
  `ALT_SESSION` (`e2e-echo-alt-<ts>`) running `vim`.
- `afterAll` sends `C-c` to break out of `cat`, kills all four sessions
  (`TEST_SESSION`, `BURST_SESSION`, `LOAD_SESSION`, `ALT_SESSION`), then prints
  the summary table: full-path / network / render / under-load / baseline /
  perceived p50/p95/p99, the computed run-kit tax, the attribution verdict, the
  distribution histograms (including the perceived-echo histograms), and the
  throughput time.
- `resolveFirstWindowId(page, session?)` polls `/api/sessions` for the named
  session's first window's stable `@N` id (the terminal route is keyed by window
  id, not index), mirroring `mobile-touch-scroll.spec.ts`. Defaults to the echo
  session; the throughput test passes `BURST_SESSION`.
- Trials alternate the two chars `x`/`o` and reset the line (Enter) each trial,
  so global char-uniqueness is never needed — the count-based row detector
  (see above) handles disambiguation.
- A shared `samples` array collects `{ label, ms }` rows that `afterAll`
  summarizes. `percentile()` does linear-interpolation percentiles; `summarize()`
  formats the p50/p95/p99/min/max line.

## Tests

### `full-path keystroke→echo distribution`

**What it proves:** A keystroke typed in the browser echoes back into the
visible xterm buffer with a measurable latency; the test characterizes that
latency as a p50/p95/p99 distribution over 40 trials, exercising the full
input path including the rAF render flush.

**Steps:**
1. `page.addInitScript(INSTALL_SEND_STAMP)` and `page.addInitScript(
   INSTALL_RECV_STAMP)` — wrap `WebSocket.prototype.send` and the `WebSocket`
   constructor before the app loads so the relay socket is wrapped at
   construction (send stamp + first-inbound-frame recv stamp).
2. `resolveFirstWindowId(page)` to get the deep-link `@N`.
3. `page.goto(/${server}/${windowId})`; wait for `.xterm-screen` visible.
4. Poll until `window.__rkTerminals[windowId]` exists (terminal mounted +
   opened).
5. **Assert `window.__rkRenderer[windowId] === "webgl"`** — fail loudly if the
   renderer silently fell back to canvas (slower; non-comparable numbers).
6. Click `[role='application']` and focus `.xterm-helper-textarea` so
   `keyboard.press` routes into xterm.
7. **Warmup**: press Enter, then repeatedly press `w` (250ms cadence, up to 15s)
   until a `w` shows on the cursor row. This confirms the full input path is
   live and absorbs the cold-backend connect delay (relay attach + tmux select +
   cat start) instead of guessing with a fixed sleep.
8. For each of 40 trials (char alternates `x`/`o`):
   a. Press Enter (fresh line) and settle ~30ms so the newline echo lands.
   b. `measureEcho(page, windowId, ch, ECHO_DEADLINE_MS)`:
      - Snapshot the count of `ch` on the cursor row; clear `__rkSendAt` and
        `__rkRecvAt`.
      - `keyboard.press(ch)` — a real keystroke through the genuine input path.
      - rAF-poll the cursor row until the `ch` count increases, then return the
        three segments `{ full, network, render }` (see Attribution). Reject on
        a 5s deadline or if the keystroke produced no WebSocket send.
   c. Push three rows: `{ label: "full-path" }`, `{ label: "network" }`,
      `{ label: "render" }`.
9. Assert 40 full-path samples were collected.

### `baseline tmux-only echo distribution`

**What it proves:** Establishes the latency floor — pure tmux echo with no
browser or WebSocket — so the run-kit tax can be isolated. Characterizes it as
a p50/p95/p99 distribution over 40 trials.

**Steps:**
1. Re-assert a fresh `cat`: `send-keys C-c` then `send-keys 'cat' Enter` and
   settle ~500ms. The full-path test attached a browser relay to this session,
   so its disconnect may have left `cat` in an unknown state; restarting it
   makes the baseline independent of test ordering.
2. For each of 40 trials (char alternates `x`/`o`):
   a. `send-keys Enter` (fresh line); settle ~20ms so the newline echo lands.
   b. Mark `performance.now()`, `tmux send-keys '<char>'`, then busy-poll
      `capture-pane -p` (trailing blanks stripped) until the last non-empty line
      ends with the char, or the 5s deadline passes.
   c. Assert it landed; push `{ label: "baseline", ms }`.
3. Assert 40 baseline samples were collected.

### `under-load keystroke→echo distribution`

**What it proves:** Characterizes echo latency while the pane is **also
receiving a background stream** — "typing while an agent is producing output",
the everyday condition the idle benchmark deliberately excludes. Concurrent
output splits echoes into a fast mode and a slow mode (measured ~4ms vs ~22ms
clusters, roughly 1:2). A controlled experiment that replaced the adaptive
flush with a uniform `setTimeout(0)` strategy reproduced the **same** bimodal
histogram (while regressing idle p50 from ~10ms to ~15ms), so the slow mode
originates **upstream** of the client flush — tmux paces updates to attached
clients while a pane is streaming, and an echo arriving inside a pacing window
waits for the next batch. The recorded distribution — and its histogram —
characterizes the split wherever it comes from and guards against a client
change making it worse.

**Steps:**
1. `page.addInitScript(INSTALL_SEND_STAMP)` — send stamp only. The recv stamp
   is *not* installed: under load the first inbound frame after a send may be
   a tick rather than the echo, so the network/render split is meaningless and
   only `full` is recorded.
2. Create `LOAD_SESSION`, then start the load + echo pair in it:
   `seq 1 2000 | while read i; do echo tick; sleep 0.05; done & cat` — a
   background tick line every ~50ms plus the same interactive `cat` the idle
   benchmark uses. The generator is **bounded** (2000 ticks ≈ 100s) so it
   self-terminates even if cleanup fails — it can never outlive the run as an
   orphaned load loop.
3. Navigate to the window, wait for `.xterm-screen` + the registered terminal,
   assert the WebGL renderer (same rationale as the idle test), focus.
4. Two-stage warmup: poll until `tick` is visible in the bottom rows (inbound
   stream is live through the relay), then press `w` until it appears
   (keystroke path is live). `w` is never used as a probe char.
5. For each of 30 trials (probe char rotates through a 19-char alphabet that
   shares no letter with `tick`):
   a. `measureEchoUnderLoad` — waits until the probe char is **absent** from
      the bottom 8 rows (so its next appearance is unambiguously this trial's
      echo; the cursor-row count detector of `measureEcho` would lose the echo
      when a tick moves the cursor), clears the send stamp, presses the key,
      then rAF-polls the bottom rows until the char appears. Returns
      glyph-time − send-stamp.
   b. Push `{ label: "under-load", ms }`; settle 40ms so trials approximate a
      human typing cadence and collide with ticks independently.
6. Assert 30 under-load samples were collected.

### `perceived-echo — predicted glyph paints near-instantly (idle + under-load)`

**What it proves:** Once the predictive-echo engine is ACTIVE, a keystroke's
**predicted** glyph is painted locally within the same `onData` tick — sub-frame
and independent of pane load — even while the pane is streaming a background tick
stream (the case where the server echo is slow/bimodal). This is the perceived
latency the user actually feels with prediction on. It also records the
misprediction count over the run.

**Steps:**
1. `page.addInitScript(INSTALL_SEND_STAMP)` so perceived latency is measured from
   the real send time.
2. Create `LOAD_SESSION` with `status off` and start the bounded tick generator +
   `cat` (same load shape as the under-load test).
3. Navigate to the window; wait for `.xterm-screen`, the registered terminal, and
   a non-null `window.__rkPredictions[windowId]` handle; focus the terminal.
4. **Activation poll**: press printable chars (40ms cadence, up to 20s) until
   `__rkPredictions[windowId].debug().state === "active"` — the engine's
   PASSIVE→ACTIVE bootstrap is the mosh-style safety reflex and cannot be skipped.
5. For 20 trials (probe char rotates through an alphabet sharing no letter with
   `tick`): `measurePerceivedEcho` snapshots the `painted` counter, presses the
   key, and stops the clock when `painted` increments (the predicted cell was
   written). `null` (no prediction painted) trials are skipped.
6. Read `debug().mispredictions` for the run total.
7. Assert at least some predictions were painted and that **every** recorded
   perceived sample is under 50ms (a generous near-instant bound — audit-style,
   not a tight budget). Log the painted/misprediction tallies.

### `alternate-screen pane — NO predictions painted (vim)`

**What it proves:** The hard exclusion — in the alternate-screen buffer
(vim/less/htop) the engine MUST never paint, because full-screen apps echo cursor
motions rather than the typed glyph and a prediction would flash garbage. The
test types printables inside `vim` and asserts the `painted` counter stays at zero
and the engine stays PASSIVE.

**Steps:**
1. `page.addInitScript(INSTALL_SEND_STAMP)`.
2. Create `ALT_SESSION` with `status off` and launch `vim` on a scratch file
   (vim switches the terminal to the alternate screen).
3. Navigate, wait for `.xterm-screen`, the registered terminal, and the
   `__rkPredictions` handle; focus the terminal.
4. Poll `term.buffer.active.type` until it is `"alternate"` (vim has taken over).
5. Press `i` (vim insert mode), then type `hello world` one printable at a time.
6. Assert `debug().painted === 0` (no predictions painted in the alternate
   screen) and `debug().state === "passive"` (the engine never activated).
7. Exit vim cleanly (`Esc` `:q!` `Enter`) so the session can be killed without a
   swap-file prompt.

### `throughput guard — burst output renders fully and fast`

**What it proves:** Optimizing echo latency (the adaptive flush in
`terminal-client.tsx`, which writes small idle chunks immediately instead of
always waiting for a `requestAnimationFrame`) did **not** regress burst
rendering. A large, countable flood must still render completely and quickly via
the under-load coalescing path — no dropped/garbled output, no renderer melt.

**Steps:**
1. Create a dedicated `BURST_SESSION` (so the flood doesn't disturb the echo
   session's interactive `cat`).
2. `resolveFirstWindowId(page, BURST_SESSION)`, navigate, wait for
   `.xterm-screen` and the registered terminal handle; focus the terminal.
3. Mark `performance.now()`, then `keyboard.type("seq 1 N\n")` (N =
   `THROUGHPUT_LINES`, 20000). `seq` emits predictable output whose final line
   `N` is a unique end-marker; the relay delivers it as many multi-KB frames,
   exercising the coalescing branch.
4. In-page `requestAnimationFrame` loop tracks `term.buffer.active.length`;
   quiescence = the end-marker line is present in the last rows of scrollback
   AND the line count has been stable for ~150ms. Returns the in-page elapsed
   time, or rejects past the 30s deadline.
5. Assert wall-clock under the deadline; push `{ label: "throughput", ms }` (the
   in-page quiescence time) for the summary.

**Why this lives in the same file:** the echo tests and this guard are two sides
of the same trade-off. Keeping them together means a future change that shaves
echo latency at the cost of flood performance fails *here*, in the same run that
shows the latency win — they can't drift apart.

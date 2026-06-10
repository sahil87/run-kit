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

`terminal-client.tsx` batches incoming WebSocket data and flushes it to xterm
once per `requestAnimationFrame`. That coalescing delay (up to ~1 frame) is
part of what the user actually feels. The benchmark therefore stops the clock
at **glyph-in-`term.buffer.active`** — after the rAF flush — rather than at
"WS message received", which would understate latency by up to a frame.

The WebGL renderer paints to a canvas that is **not DOM-readable**, so reading
the parsed buffer is the only honest "glyph visible" signal available to a
Playwright driver. To reach the live `Terminal` instance the harness relies on
a test-only registry: `terminal-client.tsx` registers each terminal on
`window.__rkTerminals` (keyed by windowId) on mount and unregisters it on
dispose. The registry is inert unless a test reads it.

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

## Shared setup

- Per-file timeout raised to 90s (120s on CI) via `test.setTimeout` — the file
  runs `FULL_PATH_TRIALS` + `BASELINE_TRIALS` (40 + 40) echo round-trips back
  to back.
- `beforeAll` creates session `e2e-echo-<ts>` (80×24) and starts `cat` in it
  (`send-keys 'cat' Enter`). `cat` echoes every line of stdin verbatim — the
  cleanest echo source, with no prompt / completion / PS1 noise.
- `afterAll` sends `C-c` to break out of `cat`, kills the session, then prints
  the summary table: full-path p50/p95/p99, baseline p50/p95/p99, and the
  computed run-kit tax.
- `resolveFirstWindowId(page)` polls `/api/sessions` for the session's first
  window's stable `@N` id (the terminal route is keyed by window id, not
  index), mirroring `mobile-touch-scroll.spec.ts`.
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
1. `page.addInitScript(INSTALL_SEND_STAMP)` — wrap `WebSocket.prototype.send`
   before the app loads so the relay socket is wrapped at construction.
2. `resolveFirstWindowId(page)` to get the deep-link `@N`.
3. `page.goto(/${server}/${windowId})`; wait for `.xterm-screen` visible.
4. Poll until `window.__rkTerminals[windowId]` exists (terminal mounted +
   opened).
5. Click `[role='application']` and focus `.xterm-helper-textarea` so
   `keyboard.press` routes into xterm.
6. **Warmup**: press Enter, then repeatedly press `w` (250ms cadence, up to 15s)
   until a `w` shows on the cursor row. This confirms the full input path is
   live and absorbs the cold-backend connect delay (relay attach + tmux select +
   cat start) instead of guessing with a fixed sleep.
7. For each of 40 trials (char alternates `x`/`o`):
   a. Press Enter (fresh line) and settle ~30ms so the newline echo lands.
   b. `measureEcho(page, windowId, ch, ECHO_DEADLINE_MS)`:
      - Snapshot the count of `ch` on the cursor row; clear `window.__rkSendAt`.
      - `keyboard.press(ch)` — a real keystroke through the genuine input path.
      - rAF-poll the cursor row until the `ch` count increases, then return
        `performance.now() − __rkSendAt`. Reject on a 5s deadline or if the
        keystroke produced no WebSocket send.
   c. Push `{ label: "full-path", ms }`.
8. Assert 40 full-path samples were collected.

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

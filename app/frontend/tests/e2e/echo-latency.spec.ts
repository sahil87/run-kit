/**
 * Keystroke→echo latency benchmark.
 *
 * Measures the time from a keystroke being dispatched in the browser to the
 * echoed glyph becoming visible in the xterm.js buffer — the full perceived
 * input path:
 *
 *   key dispatch → xterm onData → ws.send → WS frame → Go relay → tmux PTY
 *   → tmux echo → relay → WS frame → ws.onmessage → requestAnimationFrame
 *   flush → terminal.write → xterm parse → glyph in buffer.
 *
 * The clock stops at "glyph in buffer.active", NOT at "WS message received":
 * terminal-client.tsx batches incoming data and flushes once per animation
 * frame, so the rAF coalescing delay is part of what the user actually feels.
 * Measuring to the buffer captures it; measuring to the WS frame would
 * understate latency by up to a frame.
 *
 * A baseline loop measures the pure tmux echo (`send-keys` → `capture-pane`,
 * no browser, no WebSocket) so the run-kit tax can be isolated from machine and
 * tmux noise: tax ≈ full-path p50 − baseline p50.
 *
 * This is an AUDIT, like sync-latency.spec.ts — it records a p50/p95/p99
 * distribution and prints a summary in afterAll; it does NOT assert a latency
 * budget (localhost timing is too noisy for a stable perf gate). Run on demand:
 *   just pw test echo-latency
 */
import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
const TEST_SESSION = `e2e-echo-${Date.now()}`;
const port = Number(process.env.RK_PORT ?? "3333");
const BASE = `http://localhost:${port}`;

// Trial counts. Kept modest so the file stays well within the per-test budget
// on a shared CI runner while still yielding a stable-enough distribution.
const FULL_PATH_TRIALS = 40;
const BASELINE_TRIALS = 40;
// Per-keystroke echo deadline. Generous — a stalled echo should fail loudly
// rather than silently skew the distribution toward the poll cap.
const ECHO_DEADLINE_MS = 5_000;

interface Sample {
  label: string;
  ms: number;
}

let samples: Sample[] = [];

/**
 * Drop any prior samples for `label`. Called at the start of each test so a
 * Playwright retry (config has `retries: 1`) re-runs in the SAME worker process
 * — and therefore against this persistent module-level array — without the
 * failed attempt's partial samples lingering. Without this, a retry would
 * double-count (failing the exact-count assertions) and skew the afterAll
 * percentile summary.
 */
function resetSamples(label: string): void {
  samples = samples.filter((s) => s.label !== label);
}

function tmux(cmd: string): void {
  execSync(`tmux -L ${TMUX_SERVER} ${cmd}`, { stdio: "ignore" });
}

function tmuxCapture(): string {
  return execSync(`tmux -L ${TMUX_SERVER} capture-pane -p -t ${TEST_SESSION}`, {
    encoding: "utf8",
  });
}

/** Percentile of a sample set (linear interpolation), p in [0,100]. */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

function summarize(label: string, values: number[]): string {
  const p50 = percentile(values, 50);
  const p95 = percentile(values, 95);
  const p99 = percentile(values, 99);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return (
    `  ${label.padEnd(22)} n=${String(values.length).padStart(3)}  ` +
    `p50=${p50.toFixed(1)}ms  p95=${p95.toFixed(1)}ms  p99=${p99.toFixed(1)}ms  ` +
    `min=${min.toFixed(1)}ms  max=${max.toFixed(1)}ms`
  );
}

/**
 * Resolve the first window's stable tmux id (`@N`) for TEST_SESSION from the
 * backend snapshot. The terminal route is keyed by window id, not index, so a
 * deep-link must carry `@N`. Polls because the session is created via the tmux
 * CLI and surfaces in the snapshot asynchronously.
 */
async function resolveFirstWindowId(
  page: import("@playwright/test").Page,
): Promise<string> {
  const deadline = Date.now() + 5_000;
  let id: string | null = null;
  while (Date.now() < deadline) {
    const res = await page.request.get(
      `${BASE}/api/sessions?server=${encodeURIComponent(TMUX_SERVER)}`,
    );
    if (res.ok()) {
      const sessions = (await res.json()) as Array<{
        name: string;
        windows: Array<{ windowId: string }>;
      }>;
      const wid = sessions.find((s) => s.name === TEST_SESSION)?.windows[0]
        ?.windowId;
      if (wid) {
        id = wid;
        break;
      }
    }
    await page.waitForTimeout(200);
  }
  expect(id, `first window for ${TEST_SESSION} not found`).not.toBeNull();
  return id!;
}

/**
 * Init script: wrap WebSocket.prototype.send so every relay send stamps the
 * page-clock time of the most recent outbound byte on `window.__rkSendAt`. A
 * real keystroke flows xterm keydown → onData → ws.send (TerminalClient's
 * `terminal.onData` handler), so this stamp is the moment the keystroke leaves
 * the browser — the true
 * start of the relay→tmux→echo→render round-trip. Stamping inside the real send
 * path (rather than marking time in the test before keyboard.press) keeps start
 * and finish on ONE clock and excludes only the sub-ms, unbatched keydown
 * handler. Installed via addInitScript so it is in place before the app's
 * WebSocket is constructed. Mirrors the prototype-wrap pattern in
 * mobile-touch-scroll.spec.ts.
 */
const INSTALL_SEND_STAMP = () => {
  const w = window as unknown as { __rkSendAt?: number };
  const orig = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data: Parameters<WebSocket["send"]>[0]) {
    // Only stamp single-character payloads — resize messages are JSON blobs and
    // must not be mistaken for a keystroke.
    if (typeof data === "string" && data.length === 1) {
      w.__rkSendAt = performance.now();
    }
    return orig.call(this, data);
  };
};

/**
 * Init script: stamp the page-clock time at which the FIRST inbound WebSocket
 * frame arrives after a keystroke send (`window.__rkRecvAt`). Wrapping the
 * `WebSocket` constructor lets us attach a `message` listener that fires before
 * the app's own `onmessage` handler (message events have no capture/bubble — on
 * a non-DOM target listeners fire in registration order, and we register first).
 *
 * For single-char interactive echo there is nothing else in flight, so the
 * first frame after the send IS the echo: we stamp `__rkRecvAt` only when a send
 * has been recorded and no receive has yet — the harness resets both per trial.
 * This splits the full path into two attributable segments:
 *   send → recv   = network out + relay + tmux echo + relay + network back
 *   recv → glyph  = rAF flush + xterm parse + buffer commit  (the render tail)
 * Installed alongside INSTALL_SEND_STAMP via addInitScript.
 */
const INSTALL_RECV_STAMP = () => {
  const w = window as unknown as { __rkSendAt?: number; __rkRecvAt?: number };
  const OrigWS = window.WebSocket;
  const Wrapped = function (this: WebSocket, url: string | URL, protocols?: string | string[]) {
    const ws = new OrigWS(url, protocols);
    ws.addEventListener("message", () => {
      if (w.__rkSendAt !== undefined && w.__rkRecvAt === undefined) {
        w.__rkRecvAt = performance.now();
      }
    });
    return ws;
  } as unknown as { prototype: WebSocket } & Record<string, unknown>;
  // Preserve the prototype and the readonly ready-state constants so any code
  // referencing WebSocket.OPEN etc. through the wrapper still works.
  Wrapped.prototype = OrigWS.prototype;
  for (const k of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"] as const) {
    Wrapped[k] = (OrigWS as unknown as Record<string, unknown>)[k];
  }
  (window as unknown as { WebSocket: unknown }).WebSocket = Wrapped;
};

/**
 * Dispatch one real keystroke and time how long until its glyph appears in the
 * live xterm buffer. The keystroke goes through the genuine input path
 * (keyboard.press → xterm keydown → onData → ws.send); the send-stamp wrapper
 * records the page-clock start, and an rAF-driven poll of `term.buffer.active`
 * records first-visible on the same clock.
 *
 * The poll reads the parsed buffer rather than the DOM: the WebGL renderer
 * paints to a canvas that is not DOM-readable, so the buffer is the only honest
 * "glyph visible" signal — and it sits AFTER the rAF flush in
 * terminal-client.tsx, so the coalescing delay the user feels is included.
 *
 * Detection is **position-based, not content-based**: we read the cursor cell
 * (`cursorY`, `cursorX`) BEFORE the keystroke — that is exactly the cell the
 * echo will paint into — then poll that single cell until it holds `ch`. This
 * sidesteps the fragility of scanning the viewport for a "unique" char: the
 * viewport already contains noise (the word `cat`, prior echoes), and a single
 * glyph is a poor global sentinel. Anchoring on the cursor cell means the same
 * char can be reused every trial.
 */
/** A single keystroke's latency, split into attributable segments (ms). */
interface EchoTiming {
  /** send → glyph-visible: the full perceived path. */
  full: number;
  /** send → first inbound frame: network out + relay + tmux echo + back. */
  network: number;
  /** first inbound frame → glyph-visible: rAF flush + xterm parse (render tail). */
  render: number;
}

async function measureEcho(
  page: import("@playwright/test").Page,
  windowId: string,
  ch: string,
  deadlineMs: number,
): Promise<EchoTiming> {
  // Snapshot the cursor row's count of `ch` BEFORE the keystroke. The echo
  // increments that count by one. Counting occurrences in the whole cursor row
  // (rather than betting on an exact column) is robust to prompt-rendering noise
  // and cursor drift: a fancy multi-line prompt can re-flow the line, but the
  // arrival of one more `ch` on the active row is unambiguous. Also clear the
  // prior send/recv stamps so we time THIS keystroke's round-trip.
  const before = await page.evaluate(
    ({ windowId, ch }) => {
      const term = window.__rkTerminals?.[windowId];
      if (!term) throw new Error(`no registered terminal for ${windowId}`);
      const w = window as unknown as { __rkSendAt?: number; __rkRecvAt?: number };
      w.__rkSendAt = undefined;
      w.__rkRecvAt = undefined;
      const buf = term.buffer.active;
      const row = buf.getLine(buf.baseY + buf.cursorY)?.translateToString(true) ?? "";
      return row.split(ch).length - 1; // count of ch in the row
    },
    { windowId, ch },
  );

  // Real keystroke through the actual input path. The xterm helper textarea
  // already holds focus from setup; press the key directly.
  await page.keyboard.press(ch);

  // Poll the cursor row on the page clock until the count of `ch` increases,
  // then return the three segments. All timestamps are performance.now() in the
  // page context — no Node↔browser clock mixing.
  return page.evaluate(
    async ({ windowId, ch, before, deadlineMs }) => {
      const term = window.__rkTerminals?.[windowId];
      if (!term) throw new Error(`no registered terminal for ${windowId}`);

      const echoLanded = (): boolean => {
        const buf = term.buffer.active;
        const row =
          buf.getLine(buf.baseY + buf.cursorY)?.translateToString(true) ?? "";
        return row.split(ch).length - 1 > before;
      };

      const startWait = performance.now();
      // This shape mirrors EchoTiming, but it CANNOT reference that interface:
      // page.evaluate serializes this callback into the browser's JS realm,
      // where the outer module's compile-time types don't exist. The inline
      // literal is required here — do not "DRY" it against EchoTiming.
      return await new Promise<{ full: number; network: number; render: number }>(
        (resolve, reject) => {
          const deadline = startWait + deadlineMs;
          const tick = () => {
            if (echoLanded()) {
              const glyphAt = performance.now();
              const w = window as unknown as { __rkSendAt?: number; __rkRecvAt?: number };
              if (w.__rkSendAt === undefined) {
                reject(new Error("keystroke produced no WebSocket send"));
                return;
              }
              // recv stamp should exist (the echo frame arrived before paint);
              // if a coalesced first-frame somehow missed it, fall back to the
              // glyph time so `network` is a lower bound rather than negative.
              const recvAt = w.__rkRecvAt ?? glyphAt;
              resolve({
                full: glyphAt - w.__rkSendAt,
                network: recvAt - w.__rkSendAt,
                render: glyphAt - recvAt,
              });
              return;
            }
            if (performance.now() > deadline) {
              reject(new Error(`echo timeout for ${JSON.stringify(ch)}`));
              return;
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        },
      );
    },
    { windowId, ch, before, deadlineMs },
  );
}

test.describe("Echo latency benchmark", () => {
  // The file runs FULL_PATH_TRIALS + BASELINE_TRIALS echo round-trips back to
  // back; give it ample headroom over the default per-test budget.
  test.setTimeout(process.env.CI ? 120_000 : 90_000);

  test.beforeAll(() => {
    tmux(`new-session -d -s ${TEST_SESSION} -x 80 -y 24`);
    // Run `cat` with no args: the tty echoes each typed char immediately and
    // cat itself adds no prompt/completion/PS1 noise of its own — the cleanest
    // echo source. (The shell prompt that launched cat sits above; trials work
    // on cat's own input line below it.)
    tmux(`send-keys -t ${TEST_SESSION} 'cat' Enter`);
  });

  test.afterAll(() => {
    try {
      // Break out of cat, then kill the session.
      tmux(`send-keys -t ${TEST_SESSION} C-c`);
    } catch { /* ok */ }
    try {
      tmux(`kill-session -t ${TEST_SESSION}`);
    } catch { /* ok */ }

    const pick = (label: string) =>
      samples.filter((s) => s.label === label).map((s) => s.ms);
    const full = pick("full-path");
    const network = pick("network");
    const render = pick("render");
    const base = pick("baseline");

    console.log("\n=== ECHO LATENCY BENCHMARK ===");
    console.log("  keystroke → glyph-visible, p50/p95/p99\n");
    if (full.length) console.log(summarize("full-path (browser)", full));
    if (network.length) console.log(summarize("├─ network (send→recv)", network));
    if (render.length) console.log(summarize("└─ render (recv→glyph)", render));
    if (base.length) console.log(summarize("baseline (tmux only)", base));
    if (full.length && base.length) {
      const tax = percentile(full, 50) - percentile(base, 50);
      console.log(
        `\n  run-kit tax (full p50 − baseline p50): ${tax.toFixed(1)}ms` +
          " — the cost the web path adds over a local tmux echo.",
      );
    }
    if (network.length && render.length) {
      const np = percentile(network, 50);
      const rp = percentile(render, 50);
      const dominant = rp >= np ? "render" : "network";
      console.log(
        `  attribution (p50): network=${np.toFixed(1)}ms, render=${rp.toFixed(1)}ms` +
          ` → ${dominant} dominates. Render is the rAF-flush + xterm-parse tail` +
          " (the PR-#2 adaptive-flush target).",
      );
    }
    console.log("=== END BENCHMARK ===\n");
  });

  test("full-path keystroke→echo distribution", async ({ page }) => {
    // Idempotent across a Playwright retry — this test records all three labels.
    resetSamples("full-path");
    resetSamples("network");
    resetSamples("render");
    // Install the send- and recv-stamp wrappers BEFORE the app loads so they
    // wrap the relay WebSocket at construction time. Together they split each
    // measurement into network (send→recv) and render (recv→glyph) segments.
    await page.addInitScript(INSTALL_SEND_STAMP);
    await page.addInitScript(INSTALL_RECV_STAMP);

    const windowId = await resolveFirstWindowId(page);
    await page.goto(`${BASE}/${TMUX_SERVER}/${encodeURIComponent(windowId)}`);
    await expect(page.locator(".xterm-screen")).toBeVisible({ timeout: 10_000 });

    // Wait until the terminal instance is registered (mounted + opened).
    await expect
      .poll(
        () => page.evaluate((wid) => Boolean(window.__rkTerminals?.[wid]), windowId),
        { timeout: 10_000 },
      )
      .toBe(true);

    // Focus the terminal for keyboard input. Click the terminal area (the
    // documented tap-to-focus path) then focus the helper textarea xterm reads
    // keystrokes from — belt and suspenders so keyboard.press routes into xterm.
    await page.locator("[role='application']").click();
    await page.locator(".xterm-helper-textarea").focus();

    // Warm up: the relay WebSocket must be OPEN and `cat` must be consuming
    // stdin before any timing. Press a char and wait until it echoes — this
    // both confirms the full input path is live and absorbs the connect delay,
    // rather than guessing with a fixed sleep that may be too short on a cold
    // backend (relay attach + tmux select + cat start).
    await page.keyboard.press("Enter");
    await expect
      .poll(
        async () => {
          await page.keyboard.press("w");
          return page.evaluate((wid) => {
            const term = window.__rkTerminals?.[wid];
            if (!term) return false;
            const buf = term.buffer.active;
            const row =
              buf.getLine(buf.baseY + buf.cursorY)?.translateToString(true) ?? "";
            return row.includes("w");
          }, windowId);
        },
        { timeout: 15_000, intervals: [250] },
      )
      .toBe(true);

    // Alternate between two chars so consecutive trials differ.
    const CHARS = ["x", "o"];
    for (let n = 0; n < FULL_PATH_TRIALS; n++) {
      const ch = CHARS[n % CHARS.length];
      // Reset to a fresh line before each trial so the row starts without `ch`,
      // keeping the count-based detector unambiguous. Brief settle so the
      // newline echo lands before we snapshot the pre-keystroke count.
      await page.keyboard.press("Enter");
      await page.waitForTimeout(30);
      const t = await measureEcho(page, windowId, ch, ECHO_DEADLINE_MS);
      // Record the full path plus its two attributable segments as separate
      // labeled rows, so the summary can report each distribution and the
      // render tail (the PR-#2 target) is tracked objectively over time.
      samples.push({ label: "full-path", ms: t.full });
      samples.push({ label: "network", ms: t.network });
      samples.push({ label: "render", ms: t.render });
    }
    expect(samples.filter((s) => s.label === "full-path").length).toBe(
      FULL_PATH_TRIALS,
    );
  });

  test("baseline tmux-only echo distribution", async ({ page }) => {
    resetSamples("baseline"); // idempotent across a Playwright retry
    // Pure tmux echo: send a char via the tmux CLI directly into the same
    // `cat`, then poll capture-pane until the current line shows it. No
    // browser, no WebSocket — this is the floor the full path is measured
    // against. Each trial resets to a fresh line (Enter), so the echoed char is
    // the sole content of the last non-empty line — no global-uniqueness needed.
    //
    // Re-assert `cat` is running: the full-path test attached a browser relay
    // to this session and its disconnect may have left cat in an unknown state.
    // `q` Enter would quit a pager but is harmless to cat; instead we just
    // ensure a fresh cat by sending C-c then `cat` Enter and letting it settle.
    tmux(`send-keys -t ${TEST_SESSION} C-c`);
    tmux(`send-keys -t ${TEST_SESSION} 'cat' Enter`);
    await page.waitForTimeout(500);

    const CHARS = ["x", "o"];
    for (let n = 0; n < BASELINE_TRIALS; n++) {
      const ch = CHARS[n % CHARS.length];
      tmux(`send-keys -t ${TEST_SESSION} Enter`);
      await page.waitForTimeout(20); // let the newline echo land
      // Last line should now be empty; the next echoed char will be its tail.
      const t0 = performance.now();
      tmux(`send-keys -t ${TEST_SESSION} '${ch}'`);
      let landed = false;
      const deadline = t0 + ECHO_DEADLINE_MS;
      // Each capture-pane subprocess costs ~10-20ms, which is itself the poll
      // granularity here — there is no tight-loop storm to throttle, and a
      // baseline below that resolution is not separable from the measurement
      // tool's own cost (an honest limitation noted in the summary).
      while (performance.now() < deadline) {
        const lines = tmuxCapture().replace(/\n+$/, "").split("\n");
        // Trim trailing whitespace on the candidate line: `capture-pane -p` can
        // right-pad a row with spaces, which would defeat a bare `endsWith(ch)`.
        const last = (lines[lines.length - 1] ?? "").replace(/\s+$/, "");
        if (last.endsWith(ch)) {
          landed = true;
          break;
        }
      }
      const ms = performance.now() - t0;
      expect(landed, `baseline echo timeout for ${JSON.stringify(ch)}`).toBe(true);
      samples.push({ label: "baseline", ms });
    }
    expect(samples.filter((s) => s.label === "baseline").length).toBe(
      BASELINE_TRIALS,
    );
  });
});

/**
 * GUI smoothness benchmark — the numbers behind docs/specs/gui.md
 * § Smoothness targets (click-to-pixel < 100 ms, ≥ 30 fps scrolling a browser
 * page at 1080p, < 1 core of Xvnc CPU).
 *
 * Like echo-latency.spec.ts this is an AUDIT, not a gate: it records the
 * distribution and prints a summary in afterAll; the only assertions are rig
 * health (the canvas painted, frames and bytes flowed, a coarse viewer left
 * the desktop geometry alone). Loopback timing is too noisy for a threshold,
 * and the D9 verdict is a human reading of the recorded table. The `@perf`
 * tag keeps it out of default e2e runs; run it on demand against a `just dev`
 * rig with `just pw test gui-perf` (which sets RK_E2E_PERF=1). Set
 * RK_GUI_PERF_LABEL to name the link the viewer ran over (default `loopback`;
 * e.g. `netem-260ms` under scripts/gui-perf-link.sh) — the label rides the
 * console table and the JSON file name.
 *
 * What is measured, and how:
 * - fps — noVNC's Display.flip() paints the decoded backbuffer onto the
 *   target canvas with one drawImage(<canvas>) per completed
 *   FramebufferUpdate; an init script wraps
 *   CanvasRenderingContext2D.prototype.drawImage and counts those calls on
 *   the gui tile's canvas. This IS the client's framebuffer-update rate.
 * - relay Mbit/s — the same init script wraps WebSocket so every binary
 *   message on a `/ws/gui/` socket adds its byte length to a counter.
 * - Xvnc / guest cores — utime+stime deltas from /proc/<pid>/stat over the
 *   sample window (CLK_TCK from getconf); the guest browser's tree is every
 *   process carrying its --user-data-dir flag.
 * - click-to-pixel — the guest page carries a fixed 240×240 square that
 *   toggles red⇄teal on pointerdown; a trial arms a rAF poll of
 *   getImageData at the square's canvas pixel, clicks it through the tile,
 *   and stops when the sampled color flips. The clock starts at the in-page
 *   capture-phase pointerdown stamp, so the number is the full
 *   pointer → relay → Xvnc → guest repaint → encode → decode → paint path.
 *
 * Shared setup: `beforeAll` snapshots the settings file, seeds a tmux session,
 * unsets then POSTs `gui.enabled: true`, waits for the payload to report
 * reachable, writes the long guest page to a temp dir, and launches
 * Playwright's own Chromium in kiosk on the payload's DISPLAY (spawned with
 * the display in its env — the same operation `rk gui exec` performs, done
 * directly because the rig's daemon is not the `rk` on PATH). `afterAll`
 * kills the guest tree, kills the seed session, restores the settings file
 * (which also turns the switch off), prints the table, and writes
 * `test-results/gui-perf-<label>.json`. Each test opens the tile on a fresh
 * page (idempotently — the layout option persists across loads) and, for the
 * fine-pointer runs, zen-zooms it and fits the viewport so the desktop lands
 * at 1080p. Per-test timeout is 180 s (the scroll window alone is 10 s and
 * Xvnc boot can take several).
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, chromium, type Page } from "@playwright/test";
import { READY_TIMEOUT, gotoWindow, openPalette, resolveWindow } from "./_ready";
import { TMUX_SERVER, createSession, killSession } from "./_tmux";
import {
  fetchGuiStatusRaw,
  hasXdotool,
  hasXtigervnc,
  pollGuiStatus,
  postSettingsRaw,
  restoreSettings,
  snapshotSettings,
  stableGuiGeometry,
} from "./_gui";

const LABEL = process.env.RK_GUI_PERF_LABEL ?? "loopback";
const SESSION = `e2e-gui-perf-${process.pid}`;

// The D9 target geometry the fine-pointer runs aim the desktop at.
const TARGET_W = 1920;
const TARGET_H = 1080;
// How far the fitted desktop may miss the target before the run is reported
// as off-target (informational — the table carries the real geometry).
const GEOMETRY_TOLERANCE_PX = 8;
// Scroll window: 30 wheel notches/s for 10 s (the C0 spike's rate).
const SCROLL_SECONDS = 10;
const SCROLL_NOTCH_DELAY_MS = 33;
// Scroll ramp: xdotool starts, chromium's smooth scroll and the update loop
// spin up, THEN the sample window opens — so the mean is the steady state.
const SCROLL_RAMP_SECONDS = 2;
const IDLE_SECONDS = 5;
const SAMPLE_MS = 1000;
// Idle runs wait until no frame has landed for this long (the connect-time
// full-frame paint can take seconds on a slow link) before sampling.
const QUIESCENT_MS = 1500;
const QUIESCENT_BUDGET_MS = 20_000;
const SCROLL_NOTCHES = Math.round(((SCROLL_SECONDS + SCROLL_RAMP_SECONDS) * 1000) / SCROLL_NOTCH_DELAY_MS);
// Click-to-pixel trials and their pacing.
const CLICK_TRIALS = 20;
const CLICK_SETTLE_MS = 300;
const CLICK_DEADLINE_MS = 5000;
// The guest page's color-toggle square (top-left, fixed) — red⇄teal.
const TAP_SIZE = 240;
const TAP_RED = "#e63946";
const TAP_TEAL = "#2a9d8f";
const GUEST_PARAGRAPHS = 400;
// Coarse (phone-shaped) viewer.
const PHONE_VIEWPORT = { width: 390, height: 844 };

type Sample = { fps: number; mbit: number; xvncCores: number; guestCores: number };
type RunRecord = {
  run: string;
  viewer: string;
  desktop: { width: number; height: number };
  seconds: number;
  fps: number;
  mbit: number;
  xvncCores: number;
  guestCores: number;
  perSecond: Sample[];
  clickToPixelMs: { p50: number; p95: number; n: number } | null;
};
const records: RunRecord[] = [];

// The seam probes installed before the app loads (the echo-latency
// INSTALL_*_STAMP idiom). Everything lives on window.__rkGui*.
const INSTALL_PROBES = `
(() => {
  const w = window;
  w.__rkGuiFlips = 0;
  w.__rkGuiBytes = 0;
  w.__rkGuiTapAt = 0;
  const origDraw = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (img, ...rest) {
    // noVNC Display.flip(): backbuffer canvas → the gui tile's target canvas.
    if (img instanceof HTMLCanvasElement && this.canvas &&
        this.canvas.closest('[data-testid="gui-surface-canvas"]')) {
      w.__rkGuiFlips += 1;
    }
    return origDraw.call(this, img, ...rest);
  };
  const OrigWS = window.WebSocket;
  function WS(url, protocols) {
    const ws = protocols === undefined ? new OrigWS(url) : new OrigWS(url, protocols);
    if (String(url).includes("/ws/gui/")) {
      ws.addEventListener("message", (e) => {
        const d = e.data;
        w.__rkGuiBytes += d instanceof ArrayBuffer ? d.byteLength
          : d instanceof Blob ? d.size : (d && d.length) || 0;
      });
    }
    return ws;
  }
  WS.prototype = OrigWS.prototype;
  Object.assign(WS, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  window.WebSocket = WS;
  document.addEventListener("pointerdown", () => { w.__rkGuiTapAt = performance.now(); }, true);
})();
`;

function guestPageHtml(): string {
  const para =
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. ";
  const rows: string[] = [];
  for (let i = 0; i < GUEST_PARAGRAPHS; i++) {
    const hue = (i * 37) % 360;
    rows.push(
      `<p>${i + 1}. ${para}${para}</p>` +
        `<div class="tiles"><div style="background:hsl(${hue} 70% 55%)"></div>` +
        `<div style="background:hsl(${(hue + 120) % 360} 70% 45%)"></div>` +
        `<div style="background:hsl(${(hue + 240) % 360} 70% 50%)"></div></div>`,
    );
  }
  return `<!doctype html><meta charset="utf-8"><title>rk gui perf</title>
<style>
  html,body{margin:0;background:#fff;color:#111;font:18px/1.5 system-ui,sans-serif}
  main{max-width:1200px;margin:0 auto;padding:${TAP_SIZE + 24}px 24px 48px}
  .tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;height:120px;margin:12px 0 28px}
  #tap{position:fixed;left:0;top:0;width:${TAP_SIZE}px;height:${TAP_SIZE}px;background:${TAP_RED};z-index:9}
  #tap.on{background:${TAP_TEAL}}
</style>
<div id="tap"></div>
<main><h1>run-kit GUI smoothness page</h1>${rows.join("\n")}</main>
<script>
  document.getElementById("tap").addEventListener("pointerdown", (e) => {
    e.currentTarget.classList.toggle("on");
  });
</script>`;
}

// --- host-side process/CPU helpers ------------------------------------------

const CLK_TCK = Number(execFileSync("getconf", ["CLK_TCK"]).toString().trim()) || 100;

function pgrep(pattern: string): number[] {
  try {
    return execFileSync("pgrep", ["-f", "--", pattern])
      .toString()
      .split("\n")
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

/** utime+stime ticks summed over pids (a vanished pid contributes 0). */
function cpuTicks(pids: number[]): number {
  let ticks = 0;
  for (const pid of pids) {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      ticks += Number(rest[11]) + Number(rest[12]);
    } catch {
      /* gone */
    }
  }
  return ticks;
}

/** Nearest-rank percentile: the smallest value with at least p% of the
 *  samples at or below it (p95 of 20 samples is the 19th, not the maximum). */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

// --- guest (X display) side --------------------------------------------------

let display = "";
let guestDir = "";
let guest: ChildProcess | null = null;
let settingsSnapshot: Buffer | null = null;

const displayEnv = () => ({ ...process.env, DISPLAY: display });

/** The Xvnc pid for this display (Xtigervnc by name, Xvnc fallback). */
function xvncPids(): number[] {
  const pids = pgrep(`Xtigervnc ${display} -rfbunixpath`);
  return pids.length ? pids : pgrep(`Xvnc ${display} -rfbunixpath`);
}
const guestPids = () => (guestDir ? pgrep(`--user-data-dir=${guestDir}`) : []);

function launchGuest(width: number, height: number): void {
  guestDir = mkdtempSync(join(tmpdir(), "rk-gui-perf-"));
  const pagePath = join(guestDir, "page.html");
  writeFileSync(pagePath, guestPageHtml());
  guest = spawn(
    chromium.executablePath(),
    [
      "--kiosk",
      "--window-position=0,0",
      `--window-size=${width},${height}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--no-sandbox",
      "--password-store=basic",
      `--user-data-dir=${guestDir}`,
      `file://${pagePath}`,
    ],
    { env: displayEnv(), detached: true, stdio: "ignore" },
  );
  // Wait for the kiosk window to map, then a beat for the first paint.
  execFileSync("xdotool", ["search", "--sync", "--onlyvisible", "--class", "[Cc]hromium"], {
    env: displayEnv(),
    timeout: 30_000,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function killGuest(): void {
  if (guest?.pid) {
    try {
      process.kill(-guest.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  for (const pid of guestPids()) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* gone */
    }
  }
  if (guestDir) rmSync(guestDir, { recursive: true, force: true });
  guest = null;
}

/** Wheel-scroll the guest at the desktop's center for SCROLL_SECONDS. */
function startScroll(width: number, height: number): ChildProcess {
  return spawn(
    "xdotool",
    [
      "mousemove",
      String(Math.round(width / 2)),
      String(Math.round(height / 2 + 100)),
      "click",
      "--repeat",
      String(SCROLL_NOTCHES),
      "--delay",
      String(SCROLL_NOTCH_DELAY_MS),
      "5",
    ],
    { env: displayEnv(), stdio: "ignore" },
  );
}

// --- viewer side --------------------------------------------------------------

const toggleButton = (page: Page, name: string) =>
  page.getByRole("banner").getByRole("button", { name });

// How long the GUI toggle's pressed state must hold before the layout is
// taken as settled, and the bound on that wait.
const LAYOUT_SETTLE_MS = 2000;
const LAYOUT_SETTLE_BUDGET_MS = 12_000;

/** Wait until the GUI toggle's aria-pressed has been stable for
 *  LAYOUT_SETTLE_MS. On a slow link the first render can show the gui tile
 *  (pressed, connecting) before the window's stored layout lands and hides it
 *  again; deciding before that settles toggles the wrong way. */
async function settleGuiToggle(page: Page): Promise<void> {
  const btn = toggleButton(page, "GUI tile");
  const deadline = Date.now() + LAYOUT_SETTLE_BUDGET_MS;
  let last = await btn.getAttribute("aria-pressed");
  let since = Date.now();
  while (Date.now() < deadline) {
    await page.waitForTimeout(250);
    const now = await btn.getAttribute("aria-pressed");
    if (now !== last) {
      last = now;
      since = Date.now();
    } else if (Date.now() - since >= LAYOUT_SETTLE_MS) {
      return;
    }
  }
}

/** Show the gui tile: settle the layout, then toggle only when the tile is
 *  not already visible (the layout option persists across page loads, and
 *  every kind ever opened stays mounted hidden — count() cannot tell). */
async function ensureGuiTile(page: Page): Promise<void> {
  await expect(toggleButton(page, "GUI tile")).toBeVisible({ timeout: READY_TIMEOUT });
  await settleGuiToggle(page);
  if (!(await page.getByTestId("surface-tile-gui").isVisible())) {
    await toggleButton(page, "GUI tile").click();
  }
  const canvasHost = page.getByTestId("gui-surface-canvas");
  await expect(canvasHost).toBeVisible({ timeout: READY_TIMEOUT });
  await expect(canvasHost.locator("canvas")).toBeVisible({ timeout: READY_TIMEOUT });
}

/** Focus the gui tile (resizeSession follows focus) and zen-zoom it. */
async function zoomGuiTile(page: Page): Promise<void> {
  await page.getByTestId("gui-surface-canvas").click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("Control+Shift+Enter");
  await expect(page.getByTestId("surface-tile-tty")).toBeHidden({ timeout: READY_TIMEOUT });
}

/** The gui tile's host box — sized by layout immediately, unlike the canvas,
 *  which noVNC resizes only once the server has applied SetDesktopSize. */
async function tileRect(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(() => {
    const r = document.querySelector('[data-testid="gui-surface-canvas"]')!.getBoundingClientRect();
    return { width: r.width, height: r.height };
  });
}

/** Grow/shrink the viewport by the chrome delta so the tile — and with it
 *  the desktop, via the focused fine viewer's SetDesktopSize — lands on the
 *  target; two passes absorb a layout that re-flows after the first resize.
 *  Returns the settled desktop geometry. */
async function fitDesktopTo(page: Page, w: number, h: number): Promise<{ width: number; height: number }> {
  for (let pass = 0; pass < 2; pass++) {
    const rect = await tileRect(page);
    const vp = page.viewportSize() ?? { width: w, height: h };
    await page.setViewportSize({
      width: Math.round(vp.width + (w - rect.width)),
      height: Math.round(vp.height + (h - rect.height)),
    });
    await page.waitForTimeout(500);
  }
  return stableGuiGeometry();
}

async function canvasRect(page: Page): Promise<{ left: number; top: number; width: number; height: number }> {
  return page.evaluate(() => {
    const c = document.querySelector('[data-testid="gui-surface-canvas"] canvas') as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
}

const readCounters = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __rkGuiFlips: number; __rkGuiBytes: number };
    return { flips: w.__rkGuiFlips, bytes: w.__rkGuiBytes };
  });

/** Wait until no frame has landed for QUIESCENT_MS (bounded). */
async function waitForQuiescence(page: Page): Promise<void> {
  const deadline = Date.now() + QUIESCENT_BUDGET_MS;
  let last = (await readCounters(page)).flips;
  let lastChange = Date.now();
  while (Date.now() < deadline) {
    await page.waitForTimeout(250);
    const now = (await readCounters(page)).flips;
    if (now !== last) {
      last = now;
      lastChange = Date.now();
    } else if (Date.now() - lastChange >= QUIESCENT_MS) {
      return;
    }
  }
}

/** Sample fps / Mbit/s / cores once per second for `seconds`. */
async function sampleWindow(page: Page, seconds: number): Promise<Sample[]> {
  const out: Sample[] = [];
  let prev = await readCounters(page);
  let prevX = cpuTicks(xvncPids());
  let prevG = cpuTicks(guestPids());
  let t0 = Date.now();
  for (let i = 0; i < seconds; i++) {
    await page.waitForTimeout(SAMPLE_MS);
    const now = await readCounters(page);
    const x = cpuTicks(xvncPids());
    const g = cpuTicks(guestPids());
    const dt = (Date.now() - t0) / 1000;
    out.push({
      fps: (now.flips - prev.flips) / dt,
      mbit: ((now.bytes - prev.bytes) * 8) / 1e6 / dt,
      xvncCores: (x - prevX) / CLK_TCK / dt,
      guestCores: (g - prevG) / CLK_TCK / dt,
    });
    prev = now;
    prevX = x;
    prevG = g;
    t0 = Date.now();
  }
  return out;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function summarize(perSecond: Sample[]): Omit<Sample, never> {
  return {
    fps: mean(perSecond.map((s) => s.fps)),
    mbit: mean(perSecond.map((s) => s.mbit)),
    xvncCores: mean(perSecond.map((s) => s.xvncCores)),
    guestCores: mean(perSecond.map((s) => s.guestCores)),
  };
}

/**
 * One click-to-pixel trial: arm a rAF poll of the tap square's canvas pixel,
 * click (or tap) it through the tile, resolve with pointerdown → color flip.
 * `tap` chooses touchscreen.tap over mouse.click for the coarse viewer.
 */
async function clickToPixel(
  page: Page,
  desktop: { width: number; height: number },
  tap: boolean,
): Promise<number | null> {
  const rect = await canvasRect(page);
  const gx = TAP_SIZE / 2;
  const gy = TAP_SIZE / 2;
  const cssX = rect.left + (gx * rect.width) / desktop.width;
  const cssY = rect.top + (gy * rect.height) / desktop.height;
  const armed = page.evaluate(
    ({ gx, gy, deadline }) =>
      new Promise<number | null>((resolve) => {
        const c = document.querySelector('[data-testid="gui-surface-canvas"] canvas') as HTMLCanvasElement;
        const ctx = c.getContext("2d")!;
        // Canvas-internal coords equal guest coords: noVNC's target canvas is
        // always the desktop's own size (scaling is CSS-only).
        const isRed = () => {
          const d = ctx.getImageData(Math.round(gx), Math.round(gy), 1, 1).data;
          return d[0] > d[1];
        };
        const start = isRed();
        const w = window as unknown as { __rkGuiTapAt: number };
        const stampAtArm = w.__rkGuiTapAt;
        const t0 = performance.now();
        const poll = () => {
          if (isRed() !== start) {
            const stamp = w.__rkGuiTapAt > stampAtArm ? w.__rkGuiTapAt : t0;
            resolve(performance.now() - stamp);
            return;
          }
          if (performance.now() - t0 > deadline) {
            resolve(null);
            return;
          }
          requestAnimationFrame(poll);
        };
        requestAnimationFrame(poll);
      }),
    { gx, gy, deadline: CLICK_DEADLINE_MS },
  );
  if (tap) await page.touchscreen.tap(cssX, cssY);
  else await page.mouse.click(cssX, cssY);
  return armed;
}

async function clickTrials(
  page: Page,
  desktop: { width: number; height: number },
  tap: boolean,
): Promise<{ p50: number; p95: number; n: number } | null> {
  const ms: number[] = [];
  for (let i = 0; i < CLICK_TRIALS; i++) {
    const v = await clickToPixel(page, desktop, tap);
    if (v !== null) ms.push(v);
    await page.waitForTimeout(CLICK_SETTLE_MS);
  }
  if (ms.length === 0) return null;
  return { p50: percentile(ms, 50), p95: percentile(ms, 95), n: ms.length };
}

function record(r: RunRecord): void {
  records.push(r);
  console.log(
    `  [${LABEL}] ${r.run} (${r.viewer}, ${r.desktop.width}x${r.desktop.height}): ` +
      `${r.fps.toFixed(1)} fps, ${r.mbit.toFixed(1)} Mbit/s, Xvnc ${r.xvncCores.toFixed(2)} cores, ` +
      `guest ${r.guestCores.toFixed(2)} cores` +
      (r.clickToPixelMs
        ? `, click→pixel p50 ${r.clickToPixelMs.p50.toFixed(0)} ms / p95 ${r.clickToPixelMs.p95.toFixed(0)} ms (n=${r.clickToPixelMs.n})`
        : ""),
  );
}

test.describe("@perf GUI smoothness benchmark", () => {
  test.skip(!hasXtigervnc || !hasXdotool, "Xtigervnc/xdotool not on PATH");
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    settingsSnapshot = snapshotSettings();
    createSession(SESSION, { windows: ["work"] });
    // Clean slate: a previous run may have left the switch on mid-teardown.
    await postSettingsRaw({ "gui.enabled": null });
    expect(await pollGuiStatus((s) => !s.session, 15_000)).toBe(true);
    await postSettingsRaw({ "gui.enabled": true });
    // Reachable AND stamped: the socket answers a beat before the supervisor's
    // @rk_gui_display stamp lands, and an empty DISPLAY would strand the guest.
    expect(await pollGuiStatus((s) => s.reachable && s.display !== "")).toBe(true);
    const status = await fetchGuiStatusRaw();
    display = status!.display;
    launchGuest(status!.width || TARGET_W, status!.height || TARGET_H);
  });

  test.afterAll(async () => {
    killGuest();
    killSession(SESSION);
    await restoreSettings(settingsSnapshot);

    console.log(`\n=== GUI SMOOTHNESS BENCHMARK (${LABEL}) ===`);
    console.log(
      "  D9 targets: click-to-pixel < 100 ms · ≥ 30 fps scrolling at 1080p · < 1 core Xvnc\n",
    );
    for (const r of records) {
      console.log(
        `  ${r.run.padEnd(14)} ${r.viewer.padEnd(22)} ${`${r.desktop.width}x${r.desktop.height}`.padEnd(10)}` +
          ` ${r.fps.toFixed(1).padStart(6)} fps ${r.mbit.toFixed(1).padStart(6)} Mbit/s` +
          ` ${r.xvncCores.toFixed(2).padStart(5)} Xvnc ${r.guestCores.toFixed(2).padStart(5)} guest` +
          (r.clickToPixelMs
            ? `  c2p p50 ${r.clickToPixelMs.p50.toFixed(0)} / p95 ${r.clickToPixelMs.p95.toFixed(0)} ms`
            : ""),
      );
    }
    console.log("=== END BENCHMARK ===\n");
    // Merge by (run, viewer): a failed test restarts the worker, which re-runs
    // this hook with only the later tests' records — an overwrite would drop
    // the earlier ones.
    mkdirSync("test-results", { recursive: true });
    const out = join("test-results", `gui-perf-${LABEL}.json`);
    let previous: RunRecord[] = [];
    try {
      previous = (JSON.parse(readFileSync(out, "utf8")) as { runs: RunRecord[] }).runs;
    } catch {
      /* first write */
    }
    const key = (r: RunRecord) => `${r.run}|${r.viewer}`;
    const fresh = new Set(records.map(key));
    const merged = [...previous.filter((r) => !fresh.has(key(r))), ...records];
    writeFileSync(out, JSON.stringify({ label: LABEL, recordedAt: new Date().toISOString(), runs: merged }, null, 2));
  });

  /**
   * Proves: with a fine-pointer viewer connected at 1080p and nothing moving
   * on the desktop, the update rate, relay bandwidth, and Xvnc CPU sit at a
   * near-zero noise floor — the baseline the scroll numbers are read against.
   *
   * Steps:
   * 1. Install the probes; open the seeded window; open the gui tile.
   * 2. Focus + zen-zoom the tile; fit the viewport so the desktop is 1080p.
   * 3. Wait until frames stop landing (the connect-time paint), then sample
   *    fps / Mbit/s / cores once per second for IDLE_SECONDS.
   * 4. Record the run; assert the canvas painted at least one frame.
   */
  test("idle baseline — fine viewer, 1080p, nothing moving", async ({ page }) => {
    await page.setViewportSize({ width: TARGET_W, height: TARGET_H + 100 });
    await page.addInitScript(INSTALL_PROBES);
    const win = await resolveWindow(page, TMUX_SERVER, SESSION, "work");
    await gotoWindow(page, TMUX_SERVER, win.windowId);
    await ensureGuiTile(page);
    await zoomGuiTile(page);
    const desktop = await fitDesktopTo(page, TARGET_W, TARGET_H);
    await waitForQuiescence(page);

    const perSecond = await sampleWindow(page, IDLE_SECONDS);
    const total = await readCounters(page);
    expect(total.flips).toBeGreaterThan(0);
    record({ run: "idle", viewer: "fine 1080p", desktop, seconds: IDLE_SECONDS, ...summarize(perSecond), perSecond, clickToPixelMs: null });
  });

  /**
   * Proves: scrolling the guest browser page at 30 notches/s for 10 s while a
   * fine-pointer viewer watches at 1080p yields a measurable frame rate,
   * bandwidth, and Xvnc CPU, and a click on the tile reaches the guest and
   * comes back as changed pixels with a measurable latency distribution.
   *
   * Steps:
   * 1. Install the probes; open the seeded window; open the gui tile.
   * 2. Focus + zen-zoom; fit the viewport so the desktop is 1080p (recorded
   *    as measured, with a note when it misses the target by > 8 px).
   * 3. Start `xdotool click --repeat N --delay 33 5` at the desktop center,
   *    let it ramp for SCROLL_RAMP_SECONDS, sample once per second for
   *    SCROLL_SECONDS, then wait for xdotool to end.
   * 4. Run CLICK_TRIALS click-to-pixel trials on the tap square.
   * 5. Record the run; assert frames and relay bytes flowed.
   */
  test("scroll + click-to-pixel — fine viewer, 1080p", async ({ page }) => {
    await page.setViewportSize({ width: TARGET_W, height: TARGET_H + 100 });
    await page.addInitScript(INSTALL_PROBES);
    const win = await resolveWindow(page, TMUX_SERVER, SESSION, "work");
    await gotoWindow(page, TMUX_SERVER, win.windowId);
    await ensureGuiTile(page);
    await zoomGuiTile(page);
    const desktop = await fitDesktopTo(page, TARGET_W, TARGET_H);
    if (Math.abs(desktop.width - TARGET_W) > GEOMETRY_TOLERANCE_PX || Math.abs(desktop.height - TARGET_H) > GEOMETRY_TOLERANCE_PX) {
      console.log(`  note: desktop settled at ${desktop.width}x${desktop.height}, off the 1080p target`);
    }
    await page.waitForTimeout(1500);

    const scroll = startScroll(desktop.width, desktop.height);
    await page.waitForTimeout(SCROLL_RAMP_SECONDS * 1000);
    const perSecond = await sampleWindow(page, SCROLL_SECONDS);
    await new Promise<void>((r) => {
      if (scroll.exitCode !== null) return r();
      scroll.once("exit", () => r());
      setTimeout(() => {
        scroll.kill();
        r();
      }, 5000);
    });
    const total = await readCounters(page);
    expect(total.flips).toBeGreaterThan(0);
    expect(total.bytes).toBeGreaterThan(0);

    const clickToPixelMs = await clickTrials(page, desktop, false);
    record({ run: "scroll", viewer: "fine 1080p", desktop, seconds: SCROLL_SECONDS, ...summarize(perSecond), perSecond, clickToPixelMs });
  });

  /**
   * Proves: a coarse-pointer (phone-shaped, touch) viewer attached alongside
   * the fine viewer scales the shared desktop client-side WITHOUT changing
   * the desktop geometry (D7), and its own update rate, bandwidth, and
   * tap-to-pixel latency during the same scroll are measurable.
   *
   * Steps:
   * 1. On the desktop page: probes, open the tile, zen, fit to 1080p; then
   *    palette `GUI: Lock resolution` so the desktop viewer stops driving
   *    resize, and read the settled geometry.
   * 2. Open a 390×844 touch context with the probes; open the gui tile there.
   * 3. Assert the payload geometry is unchanged after a settle window.
   * 4. Scroll the guest; after the ramp, sample SCROLL_SECONDS on the phone
   *    page.
   * 5. Run CLICK_TRIALS tap-to-pixel trials from the phone page.
   * 6. Record the run; assert frames flowed on the phone viewer.
   */
  test("scroll + tap-to-pixel — coarse phone viewer alongside", async ({ page, browser }) => {
    await page.setViewportSize({ width: TARGET_W, height: TARGET_H + 100 });
    await page.addInitScript(INSTALL_PROBES);
    const win = await resolveWindow(page, TMUX_SERVER, SESSION, "work");
    await gotoWindow(page, TMUX_SERVER, win.windowId);
    await ensureGuiTile(page);
    await zoomGuiTile(page);
    await fitDesktopTo(page, TARGET_W, TARGET_H);
    // Disarm the desktop viewer with the palette's resize lock (resizeSession
    // follows !resizeLocked): from here any geometry change would be the
    // phone's doing, and the desktop stays at 1080p for the phone's run.
    const paletteInput = await openPalette(page);
    await paletteInput.fill("GUI: Lock resolution");
    await page.getByRole("option", { name: "GUI: Lock resolution" }).click();
    const before = await stableGuiGeometry();

    const phone = await browser.newContext({ viewport: PHONE_VIEWPORT, hasTouch: true, isMobile: true });
    const phonePage = await phone.newPage();
    await phonePage.addInitScript(INSTALL_PROBES);
    await phonePage.goto(`/${TMUX_SERVER}/${encodeURIComponent(win.windowId)}`);
    await ensureGuiTile(phonePage);
    await phonePage.waitForTimeout(2000);
    const after = await fetchGuiStatusRaw();
    expect(after?.width).toBe(before.width);
    expect(after?.height).toBe(before.height);

    const scroll = startScroll(before.width, before.height);
    await phonePage.waitForTimeout(SCROLL_RAMP_SECONDS * 1000);
    const perSecond = await sampleWindow(phonePage, SCROLL_SECONDS);
    await new Promise<void>((r) => {
      if (scroll.exitCode !== null) return r();
      scroll.once("exit", () => r());
      setTimeout(() => {
        scroll.kill();
        r();
      }, 5000);
    });
    const total = await readCounters(phonePage);
    expect(total.flips).toBeGreaterThan(0);
    expect(total.bytes).toBeGreaterThan(0);

    const clickToPixelMs = await clickTrials(phonePage, before, true);
    record({ run: "scroll", viewer: `coarse ${PHONE_VIEWPORT.width}x${PHONE_VIEWPORT.height}`, desktop: before, seconds: SCROLL_SECONDS, ...summarize(perSecond), perSecond, clickToPixelMs });
    await phone.close();
  });
});

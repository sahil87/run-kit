#!/usr/bin/env node
// Idle-CPU probe: load one rk route against a LIVE daemon, idle for N seconds,
// and print where the renderer's CPU goes. Invoked via `just perf-idle-cpu`
// (scripts/perf-idle-cpu.sh supplies the default --url). It is a tool, not a
// test: it asserts nothing, its numbers are host-dependent, and two instances
// running at once skew each other's CPU columns.
//
// Playwright is resolved from app/frontend through createRequire so the script
// runs from any cwd; ESM `import` ignores NODE_PATH, which is why the wrapper
// does not set one. The browser is launched with channel "chromium" (the full
// build): the default headless shell lacks SystemInfo.getProcessInfo, which the
// per-process CPU column depends on.

import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const FRONTEND_DIR = path.join(REPO_ROOT, "app", "frontend");

const DEFAULT_URL = "http://127.0.0.1:3000";
const DEFAULT_SECONDS = 30;
const DEFAULT_VIEWPORT = "1600x1000";
const SETTLE_AFTER_LOAD_MS = 6000;
const SETTLE_AFTER_THEN_MS = 6000;
const SETTLE_AFTER_INJECT_MS = 1500;
const NETWORK_IDLE_TIMEOUT_MS = 15000;
const IN_APP_CLICK_TIMEOUT_MS = 5000;
const PROFILER_SAMPLING_INTERVAL_US = 1000;
const TOP_N = 12;
const ANIMATION_TARGET_KEY_MAX_CHARS = 60;
const IFRAME_SRC_MAX_CHARS = 80;
const FRAME_TYPE_KEY_MAX_KEYS = 3;
// JSON keys tried, in order, to name a WebSocket frame's event type. `op` is the
// relay mux's control-frame key; the rest are the state socket's.
const FRAME_TYPE_KEYS = ["type", "event", "kind", "op"];
// Profiler pseudo-nodes that are not CPU work and would otherwise top every list.
const PROFILE_EXCLUDED_FRAMES = new Set(["(idle)", "(root)"]);

const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

const USAGE = `Usage: just perf-idle-cpu <path> [seconds] [flags]

Load one rk route against a LIVE daemon, idle, and print where the CPU goes.

  <path>                 rk route to load, e.g. / , /runKit , /runKit/@99 , /board/ops
  [seconds]              idle window to sample (positional alias of --seconds; default ${DEFAULT_SECONDS})

  --seconds <n>          idle window in seconds (flag wins over the positional)
  --url <base>           daemon base URL (default: \`rk url\` via the wrapper; ${DEFAULT_URL} when run directly)
  --reduced-motion       emulate prefers-reduced-motion: reduce (every CSS animation off — the all-animations-off baseline)
  --inject <js>          JavaScript evaluated in the page after load/--then and before sampling
                         (e.g. a <style> tag that pauses one flair, for a one-mechanism A/B)
  --then <path>          navigate in-app to <path> after the first load (click a[href=<path>], else pushState + popstate)
  --json <file>          also write the full profile as JSON to <file>
  --viewport <WxH>       viewport (default ${DEFAULT_VIEWPORT})
  --label <text>         label for the summary line (default: <path>[ -> <then>])
  -h, --help             this text

Output: line 1 is a grep-able summary (renderer/gpu/browser %, main-thread %, recalcs,
layouts, running animations, xterm + iframe counts, per-socket msg/s + kB/s), followed by
## processes, ## renderer main thread, ## animations, ## sockets, ## js by script,
## js self time, ## page.

Exit codes: 0 sampled · 1 page failed to load / Chromium missing / CDP unavailable · 2 usage.
Not a test — it asserts nothing. Run one instance at a time.`;

// Every failure is thrown, never `process.exit`ed inline, so main()'s finally
// block always gets to close the browser before the exit code is chosen.
class ProbeError extends Error {
  constructor(message, exitCode, { showUsage = false } = {}) {
    super(message);
    this.exitCode = exitCode;
    this.showUsage = showUsage;
  }
}

function usageError(message) {
  throw new ProbeError(message, EXIT_USAGE, { showUsage: true });
}

function fail(message) {
  throw new ProbeError(message, EXIT_FAILURE);
}

function firstLine(text) {
  return String(text ?? "").split("\n")[0];
}

function parseCli(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        seconds: { type: "string" },
        url: { type: "string" },
        "reduced-motion": { type: "boolean", default: false },
        inject: { type: "string" },
        then: { type: "string" },
        json: { type: "string" },
        viewport: { type: "string" },
        label: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (err) {
    usageError(err.message);
  }
  const { values, positionals } = parsed;
  if (values.help) return { help: true };
  if (positionals.length > 2) usageError(`unexpected argument: ${positionals[2]}`);
  const routePath = positionals[0];
  if (!routePath) usageError("missing <path> (e.g. / or /runKit)");
  if (!routePath.startsWith("/")) usageError(`<path> must start with "/": ${routePath}`);

  const secondsRaw = values.seconds ?? positionals[1] ?? String(DEFAULT_SECONDS);
  const seconds = Number(secondsRaw);
  if (!Number.isFinite(seconds) || seconds <= 0) usageError(`seconds must be a positive number: ${secondsRaw}`);

  const viewportRaw = values.viewport ?? DEFAULT_VIEWPORT;
  const viewportMatch = /^(\d+)x(\d+)$/.exec(viewportRaw);
  if (!viewportMatch) usageError(`--viewport must be WxH (e.g. ${DEFAULT_VIEWPORT}): ${viewportRaw}`);
  const viewport = { width: Number(viewportMatch[1]), height: Number(viewportMatch[2]) };

  const base = (values.url ?? DEFAULT_URL).replace(/\/+$/, "");
  const then = values.then ?? null;
  if (then !== null && !then.startsWith("/")) usageError(`--then path must start with "/": ${then}`);

  return {
    routePath,
    seconds,
    base,
    reducedMotion: values["reduced-motion"],
    inject: values.inject ?? null,
    then,
    jsonPath: values.json ?? null,
    viewport,
    viewportRaw,
    label: values.label ?? (then ? `${routePath} -> ${then}` : routePath),
  };
}

function loadPlaywright() {
  const require = createRequire(path.join(FRONTEND_DIR, "package.json"));
  try {
    return require("@playwright/test");
  } catch (err) {
    fail(`@playwright/test not found under ${FRONTEND_DIR} — run \`just setup\` (${firstLine(err.message)})`);
  }
}

async function launchChromium(chromium) {
  try {
    return await chromium.launch({ headless: true, channel: "chromium" });
  } catch (err) {
    fail(
      `could not launch Chromium (channel "chromium"): ${firstLine(err.message)}\n` +
        "  run `pnpm exec playwright install chromium` in app/frontend",
    );
  }
}

async function getProcessInfo(browserCdp) {
  try {
    return (await browserCdp.send("SystemInfo.getProcessInfo")).processInfo;
  } catch (err) {
    fail(
      `SystemInfo.getProcessInfo unavailable — the probe needs the full Chromium build ` +
        `(channel: "chromium"), not the headless shell (${firstLine(err.message)})`,
    );
  }
}

async function getMetrics(cdp) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

// Counts server->client frames per socket URL (query string stripped) while
// `counting` is on. Received frames only: the parse cost being measured is the
// inbound stream. Text payloads arrive as UTF-8 strings, binary ones base64-encoded,
// so byte counts decode accordingly rather than trusting string length.
function attachSocketCounter(cdp) {
  const urls = new Map();
  const sockets = new Map();
  const state = { counting: false };
  const recordFor = (url) => {
    let rec = sockets.get(url);
    if (!rec) {
      rec = { frames: 0, bytes: 0, types: {} };
      sockets.set(url, rec);
    }
    return rec;
  };
  // A socket is listed from creation, so one that stays silent through the
  // sampling window still shows as 0 msg/s instead of vanishing from the report
  // (a before/after table must not lose a row to a quiet window).
  cdp.on("Network.webSocketCreated", (e) => {
    urls.set(e.requestId, e.url);
    recordFor(e.url.replace(/\?.*$/, ""));
  });
  cdp.on("Network.webSocketFrameReceived", (e) => {
    if (!state.counting) return;
    const rec = recordFor((urls.get(e.requestId) ?? "?").replace(/\?.*$/, ""));
    const frame = e.response;
    const isText = frame.opcode === 1;
    rec.frames += 1;
    rec.bytes += isText ? Buffer.byteLength(frame.payloadData, "utf8") : Buffer.from(frame.payloadData, "base64").length;
    const key = frameTypeKey(frame, isText);
    rec.types[key] = (rec.types[key] ?? 0) + 1;
  });
  return { state, sockets };
}

function frameTypeKey(frame, isText) {
  if (!isText) return "binary";
  try {
    const parsed = JSON.parse(frame.payloadData);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const key of FRAME_TYPE_KEYS) {
        if (typeof parsed[key] === "string") return parsed[key];
      }
      return Object.keys(parsed).slice(0, FRAME_TYPE_KEY_MAX_KEYS).join(",") || "{}";
    }
    return Array.isArray(parsed) ? "array" : typeof parsed;
  } catch {
    return "text";
  }
}

async function loadRoute(page, url) {
  let response;
  try {
    response = await page.goto(url, { waitUntil: "load" });
  } catch (err) {
    return `failed to load ${url}: ${firstLine(err.message)}`;
  }
  if (!response) return `failed to load ${url}: no response`;
  if (!response.ok()) return `failed to load ${url}: HTTP ${response.status()}`;
  // Best-effort settle; a page holding live sockets may never go fully idle.
  await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});
  return null;
}

// TanStack Router reacts to popstate, not to a bare pushState, so the fallback
// pushes the URL and then fires the event the router listens for.
async function navigateInApp(page, target) {
  const link = page.locator(`a[href="${target}"]`).first();
  try {
    if ((await link.count()) > 0) {
      await link.click({ timeout: IN_APP_CLICK_TIMEOUT_MS });
      return "click";
    }
  } catch {
    // fall through to the history fallback
  }
  await page.evaluate((p) => {
    history.pushState({}, "", p);
    dispatchEvent(new PopStateEvent("popstate"));
  }, target);
  return "pushState";
}

function summarizeProcesses(before, after, elapsedSec) {
  const prev = new Map(before.map((p) => [p.id, p.cpuTime]));
  return after
    .map((p) => ({
      type: p.type,
      id: p.id,
      cpuPct: round1((100 * (p.cpuTime - (prev.get(p.id) ?? 0))) / elapsedSec),
    }))
    .sort((a, b) => b.cpuPct - a.cpuPct);
}

function sumByType(processes, type) {
  return round1(processes.filter((p) => p.type === type).reduce((acc, p) => acc + p.cpuPct, 0));
}

function summarizeRenderer(m0, m1, elapsedSec) {
  const delta = (key) => round3((m1[key] ?? 0) - (m0[key] ?? 0));
  const taskS = delta("TaskDuration");
  return {
    mainThreadPct: round1((100 * taskS) / elapsedSec),
    taskS,
    scriptS: delta("ScriptDuration"),
    styleS: delta("RecalcStyleDuration"),
    layoutS: delta("LayoutDuration"),
    recalcStyleCount: Math.round(delta("RecalcStyleCount")),
    layoutCount: Math.round(delta("LayoutCount")),
    nodes: m1.Nodes ?? 0,
    documents: m1.Documents ?? 0,
    jsHeapUsedMB: round1((m1.JSHeapUsedSize ?? 0) / 1e6),
  };
}

// Self time per leaf call frame. timeDeltas[i] is the gap BEFORE sample i, so a
// sample's own duration is the gap that follows it.
function summarizeProfile(profile) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const byScript = new Map();
  const bySelf = new Map();
  let totalUs = 0;
  let idleUs = 0;
  profile.samples.forEach((id, i) => {
    const dt = profile.timeDeltas[i + 1] ?? 0;
    const cf = nodes.get(id)?.callFrame;
    if (!cf) return;
    const fn = cf.functionName || "(anon)";
    if (PROFILE_EXCLUDED_FRAMES.has(fn)) {
      if (fn === "(idle)") idleUs += dt;
      return;
    }
    totalUs += dt;
    const script = (cf.url || fn || "(native)").split("/").pop();
    byScript.set(script, (byScript.get(script) ?? 0) + dt);
    const selfKey = `${fn} @ ${script}:${cf.lineNumber}`;
    bySelf.set(selfKey, (bySelf.get(selfKey) ?? 0) + dt);
  });
  const top = (map) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([key, us]) => [key, round1(us / 1e3)]);
  return { totalMs: round1(totalUs / 1e3), idleMs: round1(idleUs / 1e3), byScriptMs: top(byScript), selfTopMs: top(bySelf) };
}

async function collectInventory(page) {
  return page.evaluate(({ ANIMATION_TARGET_KEY_MAX_CHARS, IFRAME_SRC_MAX_CHARS }) => {
    const running = document.getAnimations().filter((a) => a.playState === "running");
    const names = {};
    for (const a of running) {
      const target = a.effect?.target;
      const targetKey = String(target?.className || target?.tagName || "?").slice(0, ANIMATION_TARGET_KEY_MAX_CHARS);
      const key = `${a.animationName || a.id || "(anon)"}:${targetKey}`;
      names[key] = (names[key] ?? 0) + 1;
    }
    return {
      href: location.href,
      xtermScreens: document.querySelectorAll(".xterm").length,
      iframes: [...document.querySelectorAll("iframe")].map((f) => f.src.slice(0, IFRAME_SRC_MAX_CHARS)),
      runningAnimations: running.length,
      animationNames: names,
    };
  }, { ANIMATION_TARGET_KEY_MAX_CHARS, IFRAME_SRC_MAX_CHARS });
}

function summarizeSockets(sockets, elapsedSec) {
  const out = {};
  for (const [url, rec] of [...sockets.entries()].sort((a, b) => b[1].frames - a[1].frames)) {
    out[url] = {
      msgPerSec: round1(rec.frames / elapsedSec),
      kBPerSec: round1(rec.bytes / elapsedSec / 1024),
      frames: rec.frames,
      bytes: rec.bytes,
      types: rec.types,
    };
  }
  return out;
}

function round1(n) {
  return Number(n.toFixed(1));
}

function round3(n) {
  return Number(n.toFixed(3));
}

function socketPath(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function summaryLine(result) {
  const { renderer, processes, inventory, websockets } = result;
  const fields = [
    `perf-idle-cpu ${result.label} ${result.secs.toFixed(1)}s`,
    `renderer=${sumByType(processes, "renderer")}%`,
    `gpu=${sumByType(processes, "GPU")}%`,
    `browser=${sumByType(processes, "browser")}%`,
    `main=${renderer.mainThreadPct}%`,
    `recalcs=${renderer.recalcStyleCount}`,
    `layouts=${renderer.layoutCount}`,
    `anims=${inventory.runningAnimations}`,
    `xterm=${inventory.xtermScreens}`,
    `iframes=${inventory.iframes.length}`,
  ];
  for (const [url, s] of Object.entries(websockets)) {
    fields.push(`ws[${socketPath(url)}]=${s.msgPerSec}msg/s,${s.kBPerSec}kB/s`);
  }
  if (result.reducedMotion) fields.push("reduced-motion");
  return fields.join(" ");
}

function table(rows, { align = [] } = {}) {
  if (rows.length === 0) return "  (none)";
  const widths = rows[0].map((_, col) => Math.max(...rows.map((r) => String(r[col]).length)));
  return rows
    .map((r) =>
      r
        .map((cell, col) => (align[col] === "right" ? String(cell).padStart(widths[col]) : String(cell).padEnd(widths[col])))
        .join("  ")
        .trimEnd(),
    )
    .map((line) => `  ${line}`)
    .join("\n");
}

function histogramRows(histogram) {
  return Object.entries(histogram)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => [count, key]);
}

function report(result) {
  const { renderer, processes, inventory, websockets, profile } = result;
  const lines = [summaryLine(result), ""];

  lines.push("## processes", table(processes.map((p) => [p.type, `${p.cpuPct}%`]), { align: ["left", "right"] }), "");

  lines.push(
    "## renderer main thread",
    table(
      [
        ["task", `${renderer.taskS}s`, `${renderer.mainThreadPct}% of wall`],
        ["script", `${renderer.scriptS}s`, ""],
        ["style recalc", `${renderer.styleS}s`, `${renderer.recalcStyleCount} recalcs`],
        ["layout", `${renderer.layoutS}s`, `${renderer.layoutCount} layouts`],
        ["nodes", String(renderer.nodes), `${renderer.documents} documents`],
        ["js heap", `${renderer.jsHeapUsedMB}MB`, ""],
      ],
      { align: ["left", "right", "left"] },
    ),
    "",
  );

  lines.push(`## animations (${inventory.runningAnimations} running)`, table(histogramRows(inventory.animationNames), { align: ["right", "left"] }), "");

  lines.push("## sockets");
  const socketEntries = Object.entries(websockets);
  if (socketEntries.length === 0) lines.push("  (none)");
  for (const [url, s] of socketEntries) {
    lines.push(`  ${url}  ${s.msgPerSec} msg/s  ${s.kBPerSec} kB/s  (${s.frames} frames, ${s.bytes} bytes)`);
    lines.push(table(histogramRows(s.types), { align: ["right", "left"] }).replace(/^/gm, "  "));
  }
  lines.push("");

  lines.push(`## js by script (${profile.totalMs}ms sampled, ${profile.idleMs}ms idle)`, table(profile.byScriptMs.map(([k, ms]) => [`${ms}ms`, k]), { align: ["right", "left"] }), "");
  lines.push("## js self time", table(profile.selfTopMs.map(([k, ms]) => [`${ms}ms`, k]), { align: ["right", "left"] }), "");

  lines.push(
    "## page",
    table([
      ["href", inventory.href],
      ["xterm", String(inventory.xtermScreens)],
      ["iframes", inventory.iframes.length === 0 ? "(none)" : inventory.iframes.join(" ")],
      ["viewport", result.viewport],
      ["reduced-motion", String(result.reducedMotion)],
    ]),
  );
  return `${lines.join("\n")}\n`;
}

async function main() {
  const opts = parseCli(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const url = opts.base + opts.routePath;

  try {
    const browserCdp = await browser.newBrowserCDPSession();
    await getProcessInfo(browserCdp); // fail fast on the wrong Chromium build

    const ctx = await browser.newContext({
      viewport: opts.viewport,
      reducedMotion: opts.reducedMotion ? "reduce" : "no-preference",
    });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Performance.enable");
    const counter = attachSocketCounter(cdp);

    const loadError = await loadRoute(page, url);
    if (loadError) fail(loadError);
    await page.waitForTimeout(SETTLE_AFTER_LOAD_MS);

    let thenVia = null;
    if (opts.then) {
      thenVia = await navigateInApp(page, opts.then);
      await page.waitForTimeout(SETTLE_AFTER_THEN_MS);
    }
    if (opts.inject) {
      await page.evaluate(opts.inject);
      await page.waitForTimeout(SETTLE_AFTER_INJECT_MS);
    }

    const m0 = await getMetrics(cdp);
    const p0 = await getProcessInfo(browserCdp);
    const t0 = Date.now();
    counter.state.counting = true;
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: PROFILER_SAMPLING_INTERVAL_US });
    await cdp.send("Profiler.start");
    await page.waitForTimeout(opts.seconds * 1000);
    const { profile } = await cdp.send("Profiler.stop");
    counter.state.counting = false;
    const elapsedSec = (Date.now() - t0) / 1000;
    const m1 = await getMetrics(cdp);
    const p1 = await getProcessInfo(browserCdp);
    const inventory = await collectInventory(page);

    const result = {
      label: opts.label,
      path: opts.routePath,
      then: opts.then,
      thenVia,
      url,
      secs: round1(elapsedSec),
      reducedMotion: opts.reducedMotion,
      viewport: opts.viewportRaw,
      processes: summarizeProcesses(p0, p1, elapsedSec),
      renderer: summarizeRenderer(m0, m1, elapsedSec),
      websockets: summarizeSockets(counter.sockets, elapsedSec),
      profile: summarizeProfile(profile),
      inventory,
    };

    process.stdout.write(report(result));
    if (opts.jsonPath) {
      const { profile: prof, ...rest } = result;
      const json = { ...rest, profileByScriptMs: prof.byScriptMs, profileSelfTopMs: prof.selfTopMs, profileTotalMs: prof.totalMs, profileIdleMs: prof.idleMs };
      fs.writeFileSync(opts.jsonPath, `${JSON.stringify(json, null, 2)}\n`);
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

main().then(
  () => process.exit(EXIT_OK),
  (err) => {
    if (err instanceof ProbeError) {
      process.stderr.write(`perf-idle-cpu: ${err.message}\n`);
      if (err.showUsage) process.stderr.write(`\n${USAGE}\n`);
      process.exit(err.exitCode);
    }
    process.stderr.write(`perf-idle-cpu: ${firstLine(err?.stack ?? err)}\n`);
    process.exit(EXIT_FAILURE);
  },
);

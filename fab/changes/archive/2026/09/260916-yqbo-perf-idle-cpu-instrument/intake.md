# Intake: Idle-CPU Instrument (`just perf-idle-cpu`)

**Change**: 260916-yqbo-perf-idle-cpu-instrument
**Created**: 2026-09-16

## Origin

One-shot `/fab-new` invocation from a worktree pre-named `perf-idle-cpu-instrument`, with the instruction to run the full pipeline (`/fab-fff`) after intake. Change 0 of 5 in `fab/plans/sahil/26-09-16-idle-cpu.md` (drafted 2026-09-16 from the `/fab-discuss` session on Electron-app CPU usage). The plan's "## Decisions of record", "## Standing context", and "## Appendix" (the seed script as run on 2026-09-16) are the discussion record this intake mines.

> Add `just perf-idle-cpu` — an ad-hoc Playwright/CDP probe that loads one rk route against a live daemon, idles for N seconds, and prints per-process CPU %, renderer main-thread breakdown (task/script/style/layout, recalc and layout counts), running-animation inventory, per-socket message and byte rates by event type, and the top JS self-time entries — so every CPU claim in the repo is a re-runnable number.
>
> Full context for this change lives in fab/plans/sahil/26-09-16-idle-cpu.md — read the whole file before starting: "## Change 0 — the idle-CPU instrument (slug: perf-idle-cpu-instrument)" is the task detail, "## Standing context" and "## Decisions of record" apply to every change in this plan, and the "## Appendix" holds the seed script to clean up into scripts/perf-idle-cpu.mjs. This is change 0 of 5 in the plan — light lane, no CPU claim of its own, just the instrument.

## Why

The desktop app sits at 20–30% CPU while agents run and nobody touches it. Two independent code surveys blamed the React re-render path; a CDP measurement against the live daemon put that path at 1–3% of a core and attributed the rest to continuous painting (flair overlays and the waiting halo ticking the main thread 60×/s, plus xterm's WebGL layer). The plan's decision of record is that every future CPU decision is taken from a measurement, ranked by measured delta against a ~3-point noise floor, never from code review.

That method needs a re-runnable instrument. Today the measurement exists only as a throwaway script pasted into the plan's appendix, run by hand from `app/frontend` with positional arguments and env vars. Changes 1–4 of the plan (flair compositing, halo/seam compositing, state-socket dedup, WebGL fallback telemetry) each gate their acceptance on "re-run the instrument, before and after, record the table in plan.md". Without a committed recipe those gates are unverifiable and the numbers in the plan are unreproducible claims.

Why a `just` recipe and not an e2e test: the instrument measures a **live daemon with real agents**, which no CI rig has, and its numbers are host-dependent (software GPU on headless Linux, hardware GPU on a Mac). It asserts nothing — it prints. It belongs beside `just pw` as an ad-hoc developer tool, with the logic in `scripts/` per Constitution VIII and the recipe documented in memory `architecture/testing.md`.

Why now, and why first: changes 1 and 2 run in parallel from their own worktrees once this merges, and both need the instrument on `main` to measure against.

## What Changes

### Justfile recipe

Add one recipe in the `# ─── Test ───` section, directly after `pw`, matching the one-liner shape of its neighbours (Constitution VIII):

```just
# Idle-CPU probe against a LIVE daemon (just perf-idle-cpu /runKit 30, just perf-idle-cpu /runKit/@99 --reduced-motion)
# Prints per-process CPU %, renderer main-thread breakdown, running animations,
# per-socket msg/s + kB/s by event type, and the top JS self-time entries.
# Base URL from `rk url` (--url overrides). Not a test — it asserts nothing.
perf-idle-cpu *args:
    scripts/perf-idle-cpu.sh {{args}}
```

### `scripts/perf-idle-cpu.sh` — the shell wrapper

A thin bash wrapper (`set -euo pipefail`, header comment in the style of `scripts/pw.sh`). Responsibilities, and nothing more:

1. Resolve the repo root from its own location (`SCRIPT_DIR/..`), never the caller's cwd.
2. **Prerequisite check**: `app/frontend/node_modules/@playwright/test` must exist. If absent, print one stderr line — `perf-idle-cpu: Playwright not installed — run \`just setup\` (or \`pnpm install --frozen-lockfile\` in app/frontend)` — and exit 1. A fresh worktree has no `node_modules`; this is the documented first failure.
3. **Base URL default**: if none of the passed args is `--url` / `--url=…`, resolve one and prepend `--url <base>` to the argv handed to node:
   - `command -v rk` present ⇒ `rk url --quiet`, with a `0.0.0.0` host rewritten to `127.0.0.1` (`rk url` reports the bind address, and `0.0.0.0` is not connectable as a client target).
   - `rk` absent or `rk url` fails ⇒ `http://127.0.0.1:3000` (the daemon's config default), silently (the universal fail-silent rk rule).
   - `rk url` is a heuristic — it reports what the daemon *would* bind, not that one is running. The node script's load check is what turns "no daemon" into a non-zero exit.
4. `exec node "$SCRIPT_DIR/perf-idle-cpu.mjs" "${resolved_args[@]}"`. No `NODE_PATH`: ESM `import` ignores it (see the resolution note under the `.mjs` section), so the wrapper does not set it.

The wrapper does **no** flag parsing beyond spotting `--url`; every flag is owned by the node script so `--help` is authoritative in one place.

### `scripts/perf-idle-cpu.mjs` — the probe

The appendix seed script, cleaned into a Node ESM module. Node ≥ 20 (`node:util` `parseArgs`); the box runs Node 26.

**Playwright resolution.** `import { createRequire } from "node:module"` and `const require = createRequire(path.join(repoRoot, "app/frontend/package.json"))`, then `const { chromium } = require("@playwright/test")`. This resolves Playwright from `app/frontend/node_modules` regardless of cwd and needs no `NODE_PATH` (which ESM does not honour). Bare `playwright` is NOT installed — only `@playwright/test` — so the require target is `@playwright/test`.

**Command line** (`parseArgs` with `allowPositionals: true`, `strict: true`; unknown flags ⇒ usage error, exit 2):

```
Usage: just perf-idle-cpu <path> [seconds] [flags]

  <path>                 rk route to load, e.g. / , /runKit , /runKit/@99 , /board/ops
  [seconds]              idle window to sample (positional alias of --seconds; default 30)

  --seconds <n>          idle window in seconds (flag wins over the positional)
  --url <base>           daemon base URL (default: `rk url`, via the wrapper; http://127.0.0.1:3000 when run directly)
  --reduced-motion       emulate prefers-reduced-motion: reduce (every CSS animation off — the "all animations off" baseline)
  --inject <js>          JavaScript evaluated in the page after load/--then and before sampling (e.g. a <style> tag that pauses one flair)
  --then <path>          navigate in-app to <path> after the first load (click a[href=<path>] if present, else pushState + popstate)
  --json <file>          also write the full profile as JSON to <file>
  --viewport <WxH>       viewport (default 1600x1000)
  --label <text>         label for the summary line (default: <path>[ → <then>])
  -h, --help             this text; exit 0
```

`seconds` must parse as a positive number, `--viewport` as `\d+x\d+`; violations are usage errors (exit 2) with the offending value named.

**Procedure** (the seed's sequence, with named constants):

1. `chromium.launch({ headless: true, channel: "chromium" })`. `channel: "chromium"` is load-bearing: the default headless shell lacks `SystemInfo.getProcessInfo`. If launch throws, print the Playwright error plus `run \`pnpm exec playwright install chromium\` in app/frontend` and exit 1.
2. `browser.newContext({ viewport, reducedMotion: reduced ? "reduce" : "no-preference" })`, one page, a page CDP session (`Network.enable`, `Performance.enable`) and a browser CDP session (for `SystemInfo.getProcessInfo`).
3. Register the WebSocket frame counter (`Network.webSocketCreated` → url map; `Network.webSocketFrameReceived` → per-URL `{frames, bytes, types}` only while `counting` is true). URL key is the socket URL without its query string. Type key: for JSON payloads `type ?? event ?? kind ?? op`, else the first three top-level keys joined by `,`; non-JSON ⇒ `binary` (opcode 2) or `text`. Received frames only — server→client traffic is the cost being measured.
4. `page.goto(base + path, { waitUntil: "networkidle" })`. **Load check**: a navigation error, a main-document response that is not 2xx, or no response at all ⇒ print `perf-idle-cpu: failed to load <url>: <reason>` to stderr and exit 1. Then wait `SETTLE_AFTER_LOAD_MS = 6000`.
5. If `--then`: try `page.click(\`a[href="${then}"]\`)`; on failure `page.evaluate(p => history.pushState({}, "", p), then)` followed by `dispatchEvent(new PopStateEvent("popstate"))` (TanStack Router listens for popstate, not for pushState). Wait `SETTLE_AFTER_THEN_MS = 6000`.
6. If `--inject`: `page.evaluate(js)`; wait `SETTLE_AFTER_INJECT_MS = 1500`.
7. Snapshot `Performance.getMetrics` (m0) and `SystemInfo.getProcessInfo` (p0). If `getProcessInfo` throws (wrong browser build), exit 1 with a message naming `channel: "chromium"`.
8. `counting = true`; `Profiler.enable`, `Profiler.setSamplingInterval { interval: 1000 }` (µs), `Profiler.start`; wait `seconds × 1000` ms; `Profiler.stop`; `counting = false`; record `elapsed` from wall clock.
9. Snapshot m1 and p1. Close the browser.

**Derived numbers:**

- **Processes**: for each process in p1, `cpuPct = 100 × (cpuTime₁ − cpuTime₀) / elapsed`, joined by process id (a process absent from p0 counts from 0). Sorted descending. Summary `renderer` = **sum of all `renderer`-type processes** (the page's own renderer plus any cross-origin iframe renderer — the code tile on another port is its own process under site isolation, and the page's cost includes it); `gpu` = the `GPU` process; `browser` = the browser process. The table lists every process individually so the split is visible.
- **Renderer main thread** (`Performance.getMetrics` deltas): `TaskDuration`, `ScriptDuration`, `RecalcStyleDuration`, `LayoutDuration` (seconds, 3 dp), `RecalcStyleCount`, `LayoutCount`; absolute `Nodes`, `Documents`, `JSHeapUsedSize` (MB, 1 dp) from m1. Also `TaskDuration / elapsed` as a percentage — the main-thread busy fraction.
- **Animation inventory** (one `page.evaluate` after sampling): `document.getAnimations().filter(a => a.playState === "running")` — total count and a histogram keyed `animationName:targetClassOrTag` (class string truncated to 60 chars); plus `document.querySelectorAll(".xterm").length` (xterm instances), the `src` (first 80 chars) of every `iframe`, and `location.href` (proves where the sample was taken after `--then`).
- **Per-socket rates**: per URL `msgPerSec = frames / elapsed` (1 dp), `kBPerSec = bytes / elapsed / 1024` (1 dp), and the type histogram.
- **JS self time**: from the CPU profile, self time per sample attributed to the leaf node's `callFrame`; aggregated (a) by script (URL basename, or function name, or `(native)`) and (b) by `functionName @ basename:line`. Top 12 of each in ms (1 dp), plus the total sampled ms.

**Output.** Stdout, human-readable:

Line 1 is the **summary line** — one line, stable field order, grep-able — the row a plan's before/after table is built from:

```
perf-idle-cpu /runKit 30.0s renderer=14.8% gpu=5.8% browser=1.2% main=13.9% recalcs=1803 layouts=42 anims=5 xterm=0 iframes=0 ws[/ws/state]=3.3msg/s,2.1kB/s
```

(one `ws[<url>]=…` field per socket; `reduced-motion` appended as a bare token when emulated; `label` replaces the path when `--label` is given.)

Then the detail sections, each headed by a `## ` line: `## processes` (type, cpu%), `## renderer main thread` (the metrics above), `## animations` (count + histogram), `## sockets` (per URL: rates + type histogram), `## js by script`, `## js self time`, `## page` (href, xterm count, iframes). Fixed-width columns, no colour, no cursor control (append-only, so a `tee` or capture-pane peek stays legible — the same rule `scripts/test-all.sh` follows).

`--json <file>` writes the full object `{ label, path, then, url, secs, reducedMotion, viewport, processes, renderer, websockets, profileByScriptMs, profileSelfTopMs, inventory }` (2-space indent) in addition to the stdout report. Nothing else is written to disk.

**Exit codes**: `0` sampled and printed; `1` page failed to load, Playwright/Chromium missing, or `SystemInfo.getProcessInfo` unavailable; `2` usage error. `--help` exits 0.

**Not enforced, only documented**: one instance at a time — concurrent runs skew each other's CPU columns. The recipe takes no lock (the e2e harness's per-worktree flock protects a rig this probe does not own; the live daemon is shared by design).

### Memory: `docs/memory/run-kit/architecture/testing.md`

New `### Performance probes` subsection under `## Testing` (after `### Playwright E2E Tests`) covering: what `just perf-idle-cpu` measures and the summary-line field order; the noise floor (~3 points of one core run-to-run — a claimed gain smaller than that is not a gain); the `RecalcStyleCount` oracle for "does it composite" (~130 / 30 s baseline on a server route, ~700 on a tty route, +~1800 per main-thread animation at 60/s; `document.getAnimations()` counts what is running); the `--reduced-motion` trick as the all-animations-off baseline and `--inject` for one-mechanism A/B; the `channel: "chromium"` requirement; and the two caveats — software GPU on headless Linux (the GPU column is low-fidelity there; the renderer column transfers to a Mac) and one instance at a time. It states plainly that this is a tool, not a test: it runs against a live daemon, asserts nothing, and is excluded from `just test` and CI.

New `## Design Decisions` entry, four-field shape: **The idle-CPU instrument is a `just` recipe, not an e2e test** — Decision (ad-hoc recipe beside `just pw`, logic in `scripts/`), Why (live daemon + real agents that no CI rig has; host-dependent numbers; it prints, it does not assert), Rejected (a `@perf` e2e spec — would need a rig that does not reproduce the workload, and a threshold that is wrong on every other host; asserting thresholds in CI), *Introduced by* this change.

`docs/memory/run-kit/architecture/repo-layout.md`: the `scripts/` comment line gains `perf-idle-cpu.sh/.mjs (idle-CPU probe)` beside `test-*.sh / pw.sh (test harness)`.

### Not changed

- No `README.md` / `docs/site` change: `just perf-idle-cpu` is a developer recipe like `just pw`, which the README also does not list; `shll standards help-dump` governs the `rk` binary's help, which this does not touch.
- No CI wiring, no thresholds, no assertion of any CPU number (non-goals of record).
- No Electron-shell measurement — Activity Monitor owns that; the SPA numbers are what the shell renders.
- No Go, frontend `src/`, or settings-registry change.

## Affected Memory

- `run-kit/architecture/testing`: (modify) new `### Performance probes` subsection (recipe, summary-line fields, noise floor, recalc oracle, reduced-motion/inject A/B method, `channel: "chromium"`, the two caveats) and a Design Decision "The idle-CPU instrument is a `just` recipe, not an e2e test"
- `run-kit/architecture/repo-layout`: (modify) `scripts/` comment line names `perf-idle-cpu.sh/.mjs`

## Impact

- **Files added**: `scripts/perf-idle-cpu.sh`, `scripts/perf-idle-cpu.mjs`
- **Files modified**: `justfile` (one recipe), `docs/memory/run-kit/architecture/testing.md`, `docs/memory/run-kit/architecture/repo-layout.md`
- **Runtime dependencies**: none new — `@playwright/test` is already in `app/frontend/package.json`; the full `chromium` channel is what `just setup` installs (`playwright install --with-deps chromium`)
- **Test surface**: none committed. Verification is (a) `just perf-idle-cpu --help` exits 0 with the usage text, (b) a usage error exits 2, (c) a run against a dead URL exits 1 with the load message, (d) one real run against the live daemon on `:3000` (`/` and `/runKit`, 15–30 s) whose summary lines are recorded in this change's `plan.md` as the instrument's first baseline
- **Constitution touchpoints**: VIII (one-liner recipe → `scripts/`); IV/V untouched (no UI, no action, no settings key); the fail-silent `rk` rule in the wrapper
- **Downstream**: changes 1–4 of the plan gate on this recipe existing on `main`

## Open Questions

- None blocking. The only judgment call left to apply is cosmetic: the exact column layout of the detail sections.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Instrument is a `just` recipe delegating to `scripts/`, not an e2e test or a CI job | Plan § Decisions of record states it verbatim; Constitution VIII fixes the one-liner → `scripts/` shape | S:95 R:90 A:95 D:95 |
| 2 | Certain | Two files: `scripts/perf-idle-cpu.sh` (wrapper) + `scripts/perf-idle-cpu.mjs` (probe); recipe sits in the Test section right after `pw` | Plan Change 0 item 1 names both files; "belongs beside `just pw`" fixes the placement | S:90 R:90 A:95 D:90 |
| 3 | Certain | `chromium.launch({ headless: true, channel: "chromium" })` | Plan § Standing context: the headless shell lacks `SystemInfo.getProcessInfo`, which the per-process column depends on | S:95 R:85 A:95 D:95 |
| 4 | Confident | Playwright is resolved via `createRequire(app/frontend/package.json)` → `require("@playwright/test")`; the wrapper sets no `NODE_PATH` | ESM `import` ignores `NODE_PATH`, so the plan's NODE_PATH note applies only to the CJS seed; `createRequire` is the ESM equivalent with the same effect. Bare `playwright` is not installed, only `@playwright/test` | S:70 R:90 A:85 D:75 |
| 5 | Confident | Default base URL: `rk url --quiet` with `0.0.0.0` → `127.0.0.1`; `http://127.0.0.1:3000` when `rk` is absent or fails; `--url` overrides | Plan item 1: "base URL from `rk url` unless `--url` given". `rk url` prints the bind address (`http://0.0.0.0:3524` in this worktree's pane), which is not a client target; the config default is the documented fallback | S:75 R:90 A:80 D:70 |
| 6 | Confident | Summary `renderer` = sum of all renderer-type processes; the process table lists each | Plan treats "Renderer" as the page's renderer, but a cross-origin code tile is its own process under site isolation and is part of the page's cost; the itemised table keeps the split visible either way | S:60 R:85 A:70 D:60 |
| 7 | Confident | Output = one grep-able summary line + `## `-headed text sections on stdout; `--json <file>` writes the full profile; nothing else touches disk | Plan item 2: "a one-line summary per run … plus optional JSON with the full profile". Append-only text mirrors `scripts/test-all.sh`'s no-cursor-control rule | S:80 R:90 A:85 D:80 |
| 8 | Confident | Exit codes: 0 sampled, 1 load failure / missing Chromium / `getProcessInfo` unavailable, 2 usage; `--help` exits 0 | Plan item 2: "exit non-zero if the page failed to load"; 1 vs 2 follows the common CLI convention | S:70 R:95 A:85 D:80 |
| 9 | Confident | Both `[seconds]` positional and `--seconds` accepted; the flag wins | Plan § Standing context shows `<path> [seconds]`, Change 0 item 1 lists `--seconds`; supporting both reconciles the two without a decision | S:70 R:95 A:85 D:75 |
| 10 | Confident | Settle constants 6000 ms after load, 6000 ms after `--then`, 1500 ms after `--inject`; viewport default 1600×1000; profiler sampling interval 1000 µs | Lifted from the appendix seed as run on 2026-09-16, so the recipe reproduces the plan's measurement table | S:85 R:95 A:90 D:85 |
| 11 | Confident | `--then` clicks `a[href=<path>]`, falling back to `pushState` + a synthetic `popstate` | Seed behaviour; TanStack Router reacts to popstate, not to a bare pushState | S:75 R:95 A:80 D:80 |
| 12 | Confident | WebSocket type key: JSON `type ?? event ?? kind ?? op`, else first three keys; non-JSON ⇒ `binary`/`text`; received frames only | Seed behaviour plus `op` for the relay mux's JSON control frames (`relay-mux.ts`); server→client is the parsed cost | S:65 R:95 A:80 D:75 |
| 13 | Certain | Memory lands in `architecture/testing.md` as `### Performance probes` + one Design Decision; `repo-layout.md` scripts line updated | Plan item 3 names the file and the section's contents; repo-layout already enumerates `pw.sh` on its `scripts/` line | S:90 R:90 A:95 D:90 |
| 14 | Confident | No README / help-dump / docs-site change | Plan item 3: check only if the recipe shows in user-facing help; `just pw` (the sibling) is not in the README, and help-dump governs the `rk` binary | S:75 R:95 A:85 D:85 |
| 15 | Confident | No committed test; verification = `--help` smoke (exit 0), usage error (exit 2), dead-URL load failure (exit 1), and one live run against `:3000` recorded in `plan.md` | Plan item 4: "none beyond a `--help` smoke; the script is a tool, not a product surface". A live run is the only proof the probe works end to end, and it doubles as the baseline row for changes 1–4 | S:80 R:90 A:85 D:80 |
| 16 | Confident | Concurrency ("one instance at a time") is a documented caveat, not an enforced lock | Plan item 3 lists it among the two doc caveats; the daemon is shared by design so there is no rig to lock | S:75 R:95 A:85 D:85 |
| 17 | Certain | `change_type` pinned to `feat` explicitly | Description opens with "Add"; the intake body mentions "test" and "probe" in prose, which the keyword re-inference could misread at a later refresh | S:90 R:95 A:95 D:95 |

17 assumptions (5 certain, 12 confident, 0 tentative, 0 unresolved).

# Plan: Idle-CPU Instrument (`just perf-idle-cpu`)

**Change**: 260916-yqbo-perf-idle-cpu-instrument
**Intake**: `intake.md`

## Requirements

### Tooling: the `just perf-idle-cpu` recipe

#### R1: One-liner recipe delegating to `scripts/`
The justfile SHALL gain a `perf-idle-cpu *args:` recipe in the `# ─── Test ───` section immediately after `pw`, whose body is the single line `scripts/perf-idle-cpu.sh {{args}}` (Constitution VIII). The recipe comment SHALL state that it targets a LIVE daemon and asserts nothing.

- **GIVEN** a checkout with `just` installed
- **WHEN** the user runs `just perf-idle-cpu /runKit 30`
- **THEN** `scripts/perf-idle-cpu.sh /runKit 30` is executed with the arguments passed through verbatim

#### R2: Wrapper resolves prerequisites and the base URL, nothing else
`scripts/perf-idle-cpu.sh` MUST (a) exit 1 with a one-line stderr hint naming `just setup` / `pnpm install --frozen-lockfile` when `app/frontend/node_modules/@playwright/test` is absent; (b) when no `--url` / `--url=` argument is present, prepend `--url <base>` where `<base>` is `rk url --quiet` with a `0.0.0.0` host rewritten to `127.0.0.1`, or `http://127.0.0.1:3000` when `rk` is absent or fails (silently — the fail-silent rk rule); (c) `exec node scripts/perf-idle-cpu.mjs` with the resolved argv. It SHALL parse no other flag and SHALL NOT set `NODE_PATH`.

- **GIVEN** a fresh worktree without `app/frontend/node_modules`
- **WHEN** `just perf-idle-cpu /` runs
- **THEN** it exits 1 with a stderr line pointing at `just setup`, and node is never started

- **GIVEN** `rk url --quiet` prints `http://0.0.0.0:3524`
- **WHEN** `just perf-idle-cpu /` runs without `--url`
- **THEN** the probe receives `--url http://127.0.0.1:3524`

- **GIVEN** the user passes `--url http://127.0.0.1:3000`
- **WHEN** the wrapper runs
- **THEN** `rk url` is not consulted and the user's URL is passed through unchanged

### Tooling: the probe (`scripts/perf-idle-cpu.mjs`)

#### R3: Command line and usage errors
The probe MUST accept `<path> [seconds]` positionals and the flags `--seconds <n>`, `--url <base>`, `--reduced-motion`, `--inject <js>`, `--then <path>`, `--json <file>`, `--viewport <WxH>`, `--label <text>`, `-h/--help` via `node:util` `parseArgs` (strict). `--seconds` wins over the positional; the default is 30. `--help` prints usage and exits 0. A missing `<path>`, an unknown flag, a non-positive `seconds`, or a `--viewport` not matching `\d+x\d+` MUST exit 2 with the offending value named on stderr.

- **GIVEN** `just perf-idle-cpu --help`
- **WHEN** it runs
- **THEN** the usage text is printed to stdout and the exit code is 0 (no browser is launched)

- **GIVEN** `just perf-idle-cpu /runKit --bogus`
- **WHEN** it runs
- **THEN** stderr names `--bogus` and the exit code is 2

- **GIVEN** `just perf-idle-cpu /runKit 15 --seconds 5`
- **WHEN** it runs
- **THEN** the idle window is 5 seconds

#### R4: Playwright resolution and browser launch
The probe MUST resolve `@playwright/test` through `createRequire` anchored at `app/frontend/package.json` (repo root derived from the script's own location) and launch `chromium.launch({ headless: true, channel: "chromium" })`. A launch failure MUST exit 1 with the Playwright error and the hint `pnpm exec playwright install chromium` (in `app/frontend`). If `SystemInfo.getProcessInfo` is unavailable on the browser CDP session, the probe MUST exit 1 naming `channel: "chromium"`.

- **GIVEN** the probe is invoked from any cwd
- **WHEN** it starts
- **THEN** Playwright is loaded from `app/frontend/node_modules` without `NODE_PATH`

#### R5: Load, settle, navigate, inject, sample
The probe MUST `goto(base + path, { waitUntil: "load" })` and treat a navigation error, a missing response, or a non-2xx main-document status as a load failure, then wait for `networkidle` as a bounded best-effort settle (`NETWORK_IDLE_TIMEOUT_MS` = 15000, timeout swallowed — a page holding live sockets may never go idle, and that is not a load failure): stderr `perf-idle-cpu: failed to load <url>: <reason>`, exit 1. After load it waits `SETTLE_AFTER_LOAD_MS` (6000). With `--then` it clicks `a[href="<then>"]` or falls back to `history.pushState` + a synthetic `popstate`, then waits `SETTLE_AFTER_THEN_MS` (6000). With `--inject` it evaluates the JS and waits `SETTLE_AFTER_INJECT_MS` (1500). It then snapshots `Performance.getMetrics` and `SystemInfo.getProcessInfo`, starts the CPU profiler at a 1000 µs sampling interval, counts WebSocket frames for `seconds`, stops the profiler, and snapshots again. `--reduced-motion` MUST set the context's `reducedMotion: "reduce"`.

- **GIVEN** no daemon on the base URL
- **WHEN** `just perf-idle-cpu / --url http://127.0.0.1:1`
- **THEN** stderr carries `failed to load http://127.0.0.1:1/` and the exit code is 1

- **GIVEN** the live daemon on `:3000`
- **WHEN** `just perf-idle-cpu /runKit 15 --url http://127.0.0.1:3000`
- **THEN** the run completes with exit 0 and a summary line whose `renderer=` field is a percentage

#### R6: Derived numbers
From the two snapshots the probe MUST compute: per-process `cpuPct = 100 × ΔcpuTime / elapsed` joined by process id (absent-before ⇒ 0), sorted descending, with summary `renderer` = the SUM of all `renderer`-type processes, `gpu` = the GPU process, `browser` = the browser process; renderer main-thread deltas `TaskDuration`, `ScriptDuration`, `RecalcStyleDuration`, `LayoutDuration` (s), `RecalcStyleCount`, `LayoutCount`, plus absolute `Nodes`, `Documents`, `JSHeapUsedSize` (MB) and `main% = TaskDuration/elapsed`; a running-animation inventory (`document.getAnimations()` filtered to `running`, histogram keyed `animationName:target`), `.xterm` count, iframe `src` list (80 chars), and `location.href`; per-socket (URL sans query) `msgPerSec`, `kBPerSec`, and a type histogram (JSON `type ?? event ?? kind ?? op`, else first three keys; non-JSON ⇒ `binary`/`text`; received frames only); JS self time by script basename and by `function @ basename:line`, top 12 each, plus total sampled ms.

- **GIVEN** a page with one cross-origin iframe in its own renderer process
- **WHEN** the run completes
- **THEN** the summary `renderer=` is the sum of both renderer processes and the `## processes` table lists each

#### R7: Output shape and exit codes
Stdout line 1 MUST be the summary line in this fixed field order: `perf-idle-cpu <label> <secs>s renderer=<n>% gpu=<n>% browser=<n>% main=<n>% recalcs=<n> layouts=<n> anims=<n> xterm=<n> iframes=<n> ws[<url>]=<n>msg/s,<n>kB/s …` with `reduced-motion` appended as a bare token when emulated. The detail sections follow, each headed `## processes`, `## renderer main thread`, `## animations`, `## sockets`, `## js by script`, `## js self time`, `## page` — fixed-width text, no colour, no cursor control. `--json <file>` MUST additionally write the full profile object with 2-space indent; nothing else is written to disk. Exit codes: 0 sampled, 1 load/launch/CDP failure, 2 usage.

- **GIVEN** a successful run with `--json /tmp/out.json`
- **WHEN** it completes
- **THEN** stdout starts with `perf-idle-cpu ` and `/tmp/out.json` parses as JSON containing `processes`, `renderer`, `websockets`, `profileSelfTopMs`, `inventory`

### Non-Goals

- CI wiring, thresholds, or any assertion on a CPU number — the instrument prints, it does not judge.
- Measuring the Electron shell process itself (Activity Monitor owns that).
- Enforcing the one-instance-at-a-time caveat with a lock — the daemon is shared by design; the caveat is documented in memory.
- Any README, `docs/site`, or `rk` help-dump change — `just perf-idle-cpu` is a developer recipe like `just pw`.

### Design Decisions

#### The idle-CPU instrument is a `just` recipe, not an e2e test
**Decision**: `just perf-idle-cpu` is an ad-hoc recipe beside `just pw`, with the logic in `scripts/perf-idle-cpu.sh` + `scripts/perf-idle-cpu.mjs`; it runs against a live daemon, prints a summary line plus detail sections, and asserts nothing.
**Why**: it measures a live daemon with real agents, which no CI rig has; its numbers are host-dependent (software GPU on headless Linux, hardware GPU on a Mac); the method of record is "measure, rank by delta against a ~3-point noise floor, stop below the floor", which needs a re-runnable number, not a pass/fail.
**Rejected**: a `@perf` Playwright spec (needs a rig that does not reproduce the workload and a threshold wrong on every other host); pasting the seed script into each change's plan (not re-runnable, drifts).
*Introduced by*: 260916-yqbo-perf-idle-cpu-instrument

#### Playwright is resolved via `createRequire` at `app/frontend/package.json`, not `NODE_PATH`
**Decision**: the ESM probe builds a `require` anchored at `app/frontend/package.json` and loads `@playwright/test` through it; the wrapper sets no `NODE_PATH`.
**Why**: ESM `import` ignores `NODE_PATH`; `createRequire` gives the same "load from `app/frontend/node_modules` regardless of cwd" effect and works from `scripts/`.
**Rejected**: placing the script under `app/frontend/` (the logic belongs in `scripts/` per Constitution VIII and the recipe convention); a root `package.json` (a second dependency root for one script).
*Introduced by*: 260916-yqbo-perf-idle-cpu-instrument

#### Summary `renderer` sums every renderer-type process
**Decision**: the one-line summary's `renderer=` is the sum of all `renderer` processes; the `## processes` table itemises each.
**Why**: a cross-origin code tile runs in its own renderer under site isolation, and the page's cost includes it; a "top renderer only" number would silently drop it. The table keeps the split visible either way.
**Rejected**: reporting only the largest renderer (hides the iframe cost); trying to map processes to targets (CDP exposes no pid↔target join).
*Introduced by*: 260916-yqbo-perf-idle-cpu-instrument

## Tasks

### Phase 1: Setup

- [x] T001 Add the `perf-idle-cpu *args:` one-liner recipe to `justfile` in the `# ─── Test ───` section directly after `pw`, with a comment stating LIVE daemon + asserts nothing + `rk url` default / `--url` override <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 Write `scripts/perf-idle-cpu.mjs`: `parseArgs` CLI (R3), `createRequire`-anchored Playwright load + `channel: "chromium"` launch with the install hint (R4), load check / settle / `--then` / `--inject` / snapshots / profiler / WebSocket counter (R5), derived numbers (R6), summary line + `## ` sections + `--json` + exit codes (R7). Named constants for the settle times, sampling interval, top-N, viewport default <!-- R3 R4 R5 R6 R7 -->
- [x] T003 Write `scripts/perf-idle-cpu.sh` (`set -euo pipefail`, header comment in the `scripts/pw.sh` style): node_modules prerequisite check → exit 1 hint; `--url` presence scan; `rk url --quiet` with `0.0.0.0`→`127.0.0.1` rewrite and the `http://127.0.0.1:3000` silent fallback; `exec node`. `chmod +x` <!-- R2 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Verify end to end from the repo root and record the results in `## Notes`: `just perf-idle-cpu --help` → exit 0; `just perf-idle-cpu /runKit --bogus` → exit 2; `just perf-idle-cpu / --url http://127.0.0.1:1` → exit 1 with the load message; `bash -n scripts/perf-idle-cpu.sh`; the wrapper's missing-node_modules path (simulate by pointing at a temp repo root or by inspection); then one real run each of `/` and `/runKit` for 15 s against `--url http://127.0.0.1:3000` with `--json` into the scratchpad, and paste the two summary lines into `## Notes` as the instrument's first baseline <!-- R2 R3 R5 R7 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `justfile` has `perf-idle-cpu *args:` after `pw` in the Test section whose body is exactly `scripts/perf-idle-cpu.sh {{args}}` (justfile:115-121)
- [x] A-002 R2: `scripts/perf-idle-cpu.sh` checks `app/frontend/node_modules/@playwright/test`, resolves `--url` from `rk url --quiet` (with the `0.0.0.0` rewrite and silent `127.0.0.1:3000` fallback) only when no `--url` is passed, and `exec`s node; it sets no `NODE_PATH` and parses no other flag (perf-idle-cpu.sh:23-45)
- [x] A-003 R3: `scripts/perf-idle-cpu.mjs` accepts every flag listed in R3 via `parseArgs`; `--help` exits 0 without launching a browser (re-verified: usage on stdout, exit 0); `--seconds` overrides the positional (perf-idle-cpu.mjs:124)
- [x] A-004 R4: Playwright is loaded through `createRequire(.../app/frontend/package.json)` and launched with `channel: "chromium"`; launch failure prints the `playwright install chromium` hint and exits 1 (perf-idle-cpu.mjs:151-168)
- [x] A-005 R5: load failure (navigation error / no response / non-2xx) prints `perf-idle-cpu: failed to load <url>: <reason>` and exits 1; settle constants are 6000/6000/1500 ms; `--then` uses click-then-pushState+popstate; `--reduced-motion` sets `reducedMotion: "reduce"` (perf-idle-cpu.mjs:230-261, 480-483)
- [x] A-006 R6: processes joined by id with summary `renderer` = sum of renderer-type processes (live run showed two renderer rows itemised and summed); renderer metric deltas, animation inventory, per-socket rates with type histogram, JS self time top 12 by script and by function are all computed as specified (perf-idle-cpu.mjs:263-358)
- [x] A-007 R7: stdout line 1 matches the fixed summary field order (verified live); the seven `## ` sections follow; `--json` writes the full object (keys per T004 record); exit codes are 0/1/2 as specified

### Behavioral Correctness

- [x] A-008 R3: an unknown flag or a non-positive `seconds` or a malformed `--viewport` exits 2 naming the offending value (`--bogus` re-verified: `Unknown option '--bogus'`, exit 2)
- [x] A-009 R2: when `rk` is absent the wrapper falls back to `http://127.0.0.1:3000` without printing an rk error (re-verified with rk off PATH: silent fallback, zero stderr bytes)

### Scenario Coverage

- [x] A-010 R5: a run against a dead URL was executed and exited 1 with the load message (re-ran with `--url http://127.0.0.1:65530`: `failed to load http://127.0.0.1:65530/`, exit 1)
- [x] A-011 R5 R7: two live runs (`/` and `/runKit`, 15 s, against `:3000`) completed with exit 0 and their summary lines are recorded in `## Notes` (three baselines recorded; review re-ran `/rK 5` successfully)

### Edge Cases & Error Handling

- [x] A-012 R4: `SystemInfo.getProcessInfo` failure is caught and exits 1 naming `channel: "chromium"` (perf-idle-cpu.mjs:171-180 — `fail()` throws ProbeError, browser closed in `finally`, no unhandled rejection)
- [x] A-013 R6: a WebSocket frame that is not JSON is bucketed `binary`/`text` without throwing (perf-idle-cpu.mjs:214-228 — opcode≠1 ⇒ `binary`, JSON.parse failure ⇒ `text`)

### Code Quality

- [x] A-014 Pattern consistency: the wrapper mirrors `scripts/pw.sh` (header comment explaining the why, `set -euo pipefail`, `SCRIPT_DIR` derivation, `exec`); the justfile recipe matches its neighbours' comment + one-liner shape
- [x] A-015 No unnecessary duplication: the wrapper does not re-implement flag parsing that the node script owns (only a `--url` presence scan); no second copy of the e2e port derivation
- [x] A-016 Magic numbers are named constants (perf-idle-cpu.mjs:24-41 — settle times, sampling interval, TOP_N, viewport default, truncation lengths, frame-type keys)
- [x] A-017 Comments state constraints the code cannot show (why `channel: "chromium"`, why `createRequire`, why popstate, why received-only frames, why fail-fast getProcessInfo) and narrate no history or change IDs
- [x] A-018 No shell-string command construction anywhere; the wrapper builds argv arrays (`set -- --url "$base" "$@"`, `exec node ... "$@"`); the node script spawns no subprocess
- [x] A-019 Constitution VIII: the recipe body is one line delegating to `scripts/`

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

### Verification record (T004, 2026-09-16, this worktree, Node 26.8.1, @playwright/test 1.59.1, chromium-1217)

| Check | Result |
|---|---|
| `bash -n scripts/perf-idle-cpu.sh` / `node --check scripts/perf-idle-cpu.mjs` | both clean |
| `just perf-idle-cpu --help` | usage on stdout, exit 0, no browser launched |
| `just perf-idle-cpu /runKit --bogus` | `Unknown option '--bogus'` + usage on stderr, exit 2 |
| `just perf-idle-cpu /runKit 0` | `seconds must be a positive number: 0`, exit 2 |
| `just perf-idle-cpu /runKit --viewport 12` | `--viewport must be WxH (e.g. 1600x1000): 12`, exit 2 |
| `just perf-idle-cpu` (no path) | `missing <path> (e.g. / or /runKit)`, exit 2 |
| `just perf-idle-cpu / --url http://127.0.0.1:65530` | `failed to load http://127.0.0.1:65530/: page.goto: net::ERR_CONNECTION_REFUSED …`, exit 1, browser closed |
| wrapper URL default (`bash -x`) | `rk url --quiet` → `http://0.0.0.0:3524` rewritten to `--url http://127.0.0.1:3524` |
| wrapper with `rk` off PATH | falls back to `--url http://127.0.0.1:3000`, no error printed |
| wrapper in a fake repo root without `app/frontend/node_modules` | `Playwright not installed — run \`just setup\` …`, exit 1, node never started |
| `--json` | file parses; keys `label,path,then,thenVia,url,secs,reducedMotion,viewport,processes,renderer,websockets,inventory,profileByScriptMs,profileSelfTopMs,profileTotalMs,profileIdleMs` |

### First baseline (live daemon `:3000`, headless Chromium, software GPU, 15 s idle; the plan's `runKit` server is now named `rK`)

```
perf-idle-cpu / 15.1s renderer=1.9% gpu=0% browser=0.1% main=0.7% recalcs=0 layouts=1 anims=0 xterm=0 iframes=0 ws[/ws/state]=2.1msg/s,2.9kB/s
perf-idle-cpu /rK 15.1s renderer=7.5% gpu=1.2% browser=0% main=3.3% recalcs=902 layouts=2 anims=5 xterm=0 iframes=0 ws[/ws/state]=2msg/s,2.6kB/s
perf-idle-cpu /rK/@107 15.1s renderer=8.5% gpu=6.2% browser=0.1% main=4.5% recalcs=940 layouts=2 anims=5 xterm=1 iframes=0 ws[/ws/state]=2msg/s,2.6kB/s ws[/ws/terminals]=0.4msg/s,1.2kB/s
```

`/rK` and the tty route run 5 animations: the `naruto` server flair (3 keyframe animations on one overlay) plus two compose-caret blinks; 902–940 recalcs / 15 s ≈ 60/s confirms the flair ticks the main thread (the plan's oracle). `/ws/state` is 2 msg/s quiet: `metrics`/`services`/`code-server`/`gui` at ~0.5/s each plus `sessions`.

### Finding outside this change's scope (filed in `fab/backlog.md`)

`/runKit`, `/loom` and any other route naming a tmux server that does not exist on the daemon render the **"Server not found"** fallback — and that fallback spins the renderer at ~115% of a core with 99.5% main-thread time in script (`tip-*.js`, `router-BFkgd_wu.js`, `main-*.js`; 0 recalcs, 0 layouts, ~130 DOM nodes) for as long as the tab is open. Reproduced on direct load, via `--then`, and under `--reduced-motion`. The instrument's first catch; not the instrument's fault and not fixed here.

## Deletion Candidates

None — this change adds a new instrument (justfile recipe + two scripts) without modifying or replacing any existing code. The seed script it cleans up lives in `fab/plans/sahil/26-09-16-idle-cpu.md`'s appendix (documentation, not code) and stays as the discussion record.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The wrapper's `--url` scan matches both `--url <v>` and `--url=<v>` forms | `parseArgs` accepts both; scanning only one form would resolve `rk url` needlessly and then pass two `--url`s | S:70 R:95 A:90 D:85 |
| 2 | Confident | `--inject` is evaluated as a script body via `page.evaluate(js)` (string form), not as a function | The seed passed the raw string; a `<style>` tag injection is the canonical use and is a statement, not an expression | S:70 R:95 A:85 D:80 |
| 3 | Confident | Verification baseline runs use 15 s, not 30 s, and are recorded in `## Notes` | The change has no CPU claim — the runs prove the probe works; 15 s keeps the pipeline short while still exceeding the 6 s settle | S:75 R:95 A:90 D:85 |
| 4 | Confident | The `main%` field (`TaskDuration/elapsed`) is added to the summary line alongside the seed's fields | It is the renderer main-thread busy fraction the plan's breakdown asks for and is free from the same metrics snapshot | S:65 R:95 A:85 D:80 |
| 5 | Confident | Load pass/fail is judged on `waitUntil: "load"` + the main response status; `networkidle` is a swallowed 15 s best-effort settle, not the gate | The seed's bare `networkidle` goto was wrapped in `.catch(() => {})`, i.e. it already tolerated never going idle; making the HTTP-level check the gate keeps "no daemon" ⇒ exit 1 while a busy live page still samples | S:70 R:95 A:85 D:80 |
| 6 | Confident | Profiler pseudo-frames `(idle)` and `(root)` are excluded from the top lists and reported as a separate idle total; `(program)` and `(garbage collector)` stay in | `(idle)` would top every self-time list and says nothing about JS cost; GC and program time are real CPU | S:65 R:95 A:85 D:80 |

6 assumptions (0 certain, 6 confident, 0 tentative).

# Intake: Under-Load Jitter Benchmark for the Echo-Latency Harness

**Change**: 260610-f3b6-under-load-jitter-benchmark
**Created**: 2026-06-10
**Status**: Draft

## Origin

> extend echo-latency harness with under-load jitter benchmark

Conversational origin. The user reported that after the adaptive-flush change (PR #244), perceived terminal input latency changed from "uniform slowness" to "jittery fastness and slowness", and asked whether PR #244 could be the cause. In-session investigation followed two tracks the user selected explicitly ("1 and 4"):

1. **Verify**: extend the existing `echo-latency.spec.ts` benchmark to expose the latency *distribution* (jitter), and add a scenario that measures echo latency while the pane is concurrently receiving a background stream.
2. **Prototype**: replace the adaptive flush in `terminal-client.tsx` with a uniform `setTimeout(0)` flush and compare.

Both were completed and measured during the session. The prototype was **rejected on the numbers** (idle p50 went from 9.6ms to 15.5ms while the under-load bimodal shape did not change) and reverted. The controlled comparison established that the under-load fast/slow divide originates **upstream of the client flush** — tmux paces updates to attached clients while a pane is streaming — so no client flush strategy can remove it. This change ships the harness extension only. **The implementation already exists, verified, in the working tree** — apply should treat this as formalize-and-verify, not re-implement.

## Why

1. **The pain point**: the prior benchmark only measured echo latency on an idle pane. The everyday condition in run-kit — typing while an agent streams output into the same window — was a measurement blind spot. That is precisely the condition under which the user perceives jitter: echoes alternate between ~4ms and ~22ms (measured 1:2 ratio), which feels worse than a uniform delay even when the median is lower.
2. **The consequence of not having it**: percentiles alone hide a bimodal distribution (the p50 can look great while a third or two-thirds of echoes ride a slow mode). Without an under-load test and shape-revealing output, a future client change could worsen the interactive feel invisibly — the existing idle benchmark and throughput guard would both still pass.
3. **Why this approach**: extending the existing audit-style harness (same file, same `samples`/`afterAll` summary machinery, same window-registry plumbing) keeps the two sides of the latency trade-off in one place, mirroring the established rationale for co-locating the throughput guard with the echo tests. The measured upstream finding is recorded in the companion `.spec.md` so the next investigator does not re-run the dead-end client-flush experiment.

## What Changes

All changes are confined to `app/frontend/tests/e2e/echo-latency.spec.ts` and its companion `app/frontend/tests/e2e/echo-latency.spec.md`. **No production code changes** — `app/frontend/src/components/terminal-client.tsx` remains at HEAD (the adaptive flush from PR #244 stays).

### New test: `under-load keystroke→echo distribution`

A fourth test in `echo-latency.spec.ts`, between the baseline and throughput tests:

- **Dedicated session** `LOAD_SESSION` = `` `e2e-echo-load-${Date.now()}` `` (80×24), so the tick stream never pollutes the idle echo session's measurements.
- **Load generator + echo source**, started via one send-keys (exact command):
  ```
  seq 1 2000 | while read i; do echo tick; sleep 0.05; done & cat
  ```
  A short `tick` line every ~50ms in the background plus the same interactive `cat` the idle benchmark uses. The generator is **bounded** (2000 ticks ≈ 100s) so it self-terminates even if cleanup never runs — it cannot outlive the run as an orphaned load loop. `afterAll` kills the session as the normal path.
- **`status off`** is set on `LOAD_SESSION` immediately after creation. The relay-attached client renders the tmux status line on the terminal's bottom row, permanently showing the session name (`e2e-echo-load-…`) and auto-renamed window name (`cat`) — letters that overlap the probe alphabet. With the status line on, the absence-wait below is unsatisfiable for those characters (this was root-caused from an actual failing run).
- **Detection** (`measureEchoUnderLoad`): presence-based with rotating probe characters, not cursor-row counting — the tick stream moves the cursor between snapshot and detection, so `measureEcho`'s cursor-row count detector loses the echo. Mechanics:
  1. Probe chars rotate through the 19-character alphabet `"abdefghjmnopqrsuvxy"` — sharing no letter with `tick` and excluding the warmup char `w`. A char is reused only ~19 trials later, long after the tick stream scrolled its previous occurrence away.
  2. `page.waitForFunction` until the probe char is **absent** from the bottom `LOAD_SCAN_ROWS = 8` rows of `term.buffer.active` (also clears the `__rkSendAt` stamp), so the char's next appearance is unambiguously this trial's echo.
  3. `page.keyboard.press(ch)` — the genuine input path, same as `measureEcho`.
  4. rAF-poll the bottom 8 rows until the char appears; return `glyphAt − __rkSendAt`.
- **Only `full` is recorded** (label `under-load`). The `INSTALL_RECV_STAMP` wrapper is *not* installed: under load the first inbound frame after a send may be a tick rather than the echo, so the network/render attribution is meaningless here.
- **Trials**: `UNDER_LOAD_TRIALS = 30`, with a 40ms settle between trials (human-ish cadence; each echo's frame collision with a tick is roughly independent). 30 is deliberate — the question is the distribution's *shape*, not a tight p50.
- **Warmup** is two-stage: poll until `tick` is visible in the bottom rows (inbound stream live through the relay), then press `w` until it appears (keystroke path live). Same WebGL-renderer assertion as the idle test (a silent canvas fallback would make numbers non-comparable).

### Summary additions (same file, `afterAll`)

- `summarize()` now also prints `spread(p95−p50)=…ms` per label — the single-number jitter signal.
- New `histogram()` helper: ASCII histogram over 4ms buckets, capped at 15 buckets plus an overflow row (one outlier cannot stretch the chart), trailing empty buckets trimmed, bars normalized to a 30-char peak. Printed for the idle full-path and under-load distributions under the header `-- distribution shape (two clusters = a fast/slow divide on the echo path) --`.
- `under-load (ticks)` row added to the percentile summary; `LOAD_SESSION` added to `afterAll` cleanup.

### Companion `.spec.md`

`echo-latency.spec.md` gains: a "Jitter: spread and histogram" section, the full test entry for `under-load keystroke→echo distribution` (what it proves + numbered steps), and shared-setup updates (trial counts, `LOAD_SESSION`). The narrative records the measured finding so it is not re-derived: under load echoes divide into ~4ms and ~22ms clusters at roughly 1:2; a controlled experiment replacing the adaptive flush with uniform `setTimeout(0)` reproduced the **same** bimodal histogram while idle p50 went from ~10ms to ~15ms, so the slow mode originates upstream of the client flush (tmux paces client updates while a pane streams; an echo arriving inside a pacing window waits for the next batch). The test characterizes the divide wherever it comes from and guards against a client change making it worse.

### Measured reference numbers (current adaptive flush, localhost)

- idle full-path: p50=9.6ms, p95=26.7ms, spread=17.1ms; clusters at 8–12ms (30/40) and 24–28ms (8/40)
- under-load: p50=21.5ms; clusters at 0–8ms (11/30) and 20–28ms (19/30)
- throughput guard: 20k lines to quiescence in 151–174ms (unchanged by any of this)

## Affected Memory

- `run-kit/ui-patterns`: (modify) the "adaptive terminal write flush" entry gains the under-load finding — the fast/slow divide under concurrent output is upstream of the client flush (tmux client-update pacing), the uniform `setTimeout(0)` alternative was measured (idle p50 9.6→15.5ms, under-load histogram unchanged) and rejected, and the echo-latency harness now includes the under-load benchmark + histogram as the standing diagnostic.

## Impact

- `app/frontend/tests/e2e/echo-latency.spec.ts` — +~260 lines (new test, helper, constants, summary additions)
- `app/frontend/tests/e2e/echo-latency.spec.md` — +~60 lines (companion narrative, constitution-mandated)
- No backend, no API, no UI, no production frontend code. No new dependencies.
- Runtime cost: ~4s added to the `echo-latency` e2e file (still well within its 90s budget); the file remains on-demand (`just pw test echo-latency`) and runs in the standard `just test-e2e` sweep.
- Verification already performed in-session: `pnpm exec tsc --noEmit` clean; `just test-e2e echo-latency` → 4/4 pass (twice); terminal-client unit tests 34/34 pass against the untouched component.

## Open Questions

None — the implementation is complete and measured; all design decisions were made and validated in-session.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is harness-only; `terminal-client.tsx` stays at HEAD — the uniform `setTimeout(0)` flush prototype is rejected | Discussed — user saw the measured comparison (idle p50 9.6→15.5ms worse, under-load shape unchanged); prototype was reverted in-session | S:95 R:90 A:95 D:95 |
| 2 | Certain | Detection is presence-based with rotating probe chars + absence-wait over the bottom 8 rows, not cursor-row counting | Cursor-row counting demonstrably loses the echo when ticks move the cursor; design validated by a passing run | S:90 R:85 A:95 D:90 |
| 3 | Certain | `status off` on the load session | Root-caused from a real failing run: status line permanently shows session/window names, making absence-waits unsatisfiable | S:90 R:90 A:95 D:90 |
| 4 | Certain | Load generator is bounded (2000 ticks ≈ 100s) and runs inside the pane | Self-terminates even if cleanup fails; aligns with the known orphaned-load-generator hazard | S:85 R:90 A:90 D:90 |
| 5 | Confident | 30 trials, 40ms inter-trial settle, 4ms histogram buckets | The question is distribution shape, not a tight p50; two well-separated clusters are unambiguous at n=30 — parameters are easily tuned later | S:75 R:90 A:80 D:75 |
| 6 | Confident | Under load only `full` is recorded (no network/render attribution) | First inbound frame after a send may be a tick, so the recv stamp does not identify the echo; lower-bound fallback would mislead | S:80 R:85 A:85 D:80 |
| 7 | Certain | The benchmark remains an audit — no latency budget asserted | Matches the existing harness philosophy (localhost timing too noisy for a stable perf gate); the only hard assertions are completeness ones | S:90 R:85 A:95 D:95 |

7 assumptions (5 certain, 2 confident, 0 tentative, 0 unresolved).

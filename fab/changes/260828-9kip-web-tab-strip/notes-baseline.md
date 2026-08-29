# T001 Baseline — six web specs on clean tree (c4fa2047, pre-apply)

**Date**: 2026-08-29
**Tree**: `c4fa2047` (= origin/main merge base; apply edits stashed during the run)
**Command**: `just test-e2e web-tile-chrome web-tile-find web-tile-zoom web-view-lens surface-layout present-auto-expand`
**Environment note**: a first attempt failed before Playwright started — "servers not ready after 90s", `air` cold-compile of the Go backend exceeded the wait window. Second attempt (backend warm) ran the suite: **34 passed, 1 failed, 6 flaky** (9.0m).

## Per-spec results

| Spec | Result |
|------|--------|
| `web-tile-chrome.spec.ts` | pass (2 flaky-retried: :212 back/forward history, :260 address-bar display form) |
| `web-tile-find.spec.ts` | pass (1 flaky-retried: :188 ⌘F find bar) |
| `web-tile-zoom.spec.ts` | **1 failed**: :145 "(b) the zoom level persists across reload, per bucket"; 3 flaky-retried (:113 step ladder, :194 onboarding, :229 ctrl-wheel) |
| `web-view-lens.spec.ts` | pass — the known pre-existing failures at :194/:412/:444/:521 did not fire this run |
| `surface-layout.spec.ts` | pass |
| `present-auto-expand.spec.ts` | pass |

## Expected-failure ledger (from plan/memory)

- `web-view-lens.spec.ts` :194/:412/:444/:521 — pre-existing on main; did not reproduce in this run, still not attributable to this change if they reappear.
- `web-tile-zoom.spec.ts` :145 "(b) the zoom level persists across reload, per bucket" — **failed at baseline on the clean tree**; pre-existing, NOT caused by this change. Post-apply comparison target: same single failure, no new ones.
- Flaky-retried tests (pass on retry) are a load artifact of the shared rig; treat retry-pass as baseline-equivalent.

## T013 post-apply comparison

**Date**: 2026-08-29
**Tree**: apply-stage working tree (all R1–R16 implementation present) plus the T013 fix noted below.
**Commands**: `just test-e2e web-tabs.spec.ts` → **5 passed** (55s); then `just test-e2e web-tile-chrome web-tile-find web-tile-zoom web-view-lens surface-layout present-auto-expand` → **34 passed, 1 failed, 6 flaky** (8.9m) — identical shape to baseline.

| Spec | Post-apply result | Baseline | Verdict |
|------|-------------------|----------|---------|
| `web-tile-chrome.spec.ts` | pass (no flakes this run) | pass (2 flaky-retried) | match |
| `web-tile-find.spec.ts` | pass (3 flaky-retried: :146 ⌘K reclaim, :188 ⌘F find bar, :284 cross-origin find bar) | pass (1 flaky-retried: :188) | match (retry-pass = baseline-equivalent; :146/:284 first-attempt timeouts were the same iframe-visibility load artifact class) |
| `web-tile-zoom.spec.ts` | **1 failed**: :145 "(b) the zoom level persists across reload, per bucket"; 3 flaky-retried (:113, :194, :229) | **1 failed**: :145; 3 flaky-retried (:113, :194, :229) | match — :145 is the ledgered clean-tree failure |
| `web-view-lens.spec.ts` | pass — :194/:412/:444/:521 did not fire | pass — same | match |
| `surface-layout.spec.ts` | pass | pass | match |
| `present-auto-expand.spec.ts` | pass | pass | match |
| `web-tabs.spec.ts` (new, T013) | **5 passed** | — | new, green |

**Verdict: PASS** — the only failure is the ledgered `web-tile-zoom.spec.ts:145`; no new failures beyond the baseline ledger; `web-view-lens` pre-existing failures did not reproduce.

### Real implementation bug found and fixed during T013

The first web-tabs run failed test 5 with `POST /api/windows/{id}/web` → **400**: the component's normalized add draft for a bare loopback input (`localhost:3003/docs`) is the root-relative `/proxy/3003/docs`, which the backend's `present.ParseTarget` misreads as a filesystem path ("target does not exist"). The add route resolves targets like `rk present` (`:port`, local URL, external URL, file/dir) and has no root-relative `/proxy/` form; unit tests had mocked `addWebTab`, so the mismatch never surfaced. Fix (minimal, frontend-only — the backend contract is unchanged): new `toWebAddTarget()` in `app/frontend/src/lib/web-url.ts` re-expresses a relative `/proxy/{port}…` address as the absolute loopback URL `http://localhost:{port}…` (which `ParseTarget` rewrites back to the identical `/proxy/` slot value), applied at the `onAddTab` seam in `app/frontend/src/components/surface-layout.tsx`. Colocated tests updated/added (`surface-layout.test.tsx` onAddTab expectation, `web-url.test.ts` `toWebAddTarget` table); `npx tsc --noEmit` clean and the four touched unit suites pass (179 tests). The backend's benign "port probe failed (attaching anyway)" warning fires on the stubbed ports, matching `rk present` behavior.

**Environment note**: the rig's dev console shows a continuous `Maximum update depth exceeded` React warning throughout these runs — it fires even on the initial route load before any web tile mounts, and the R16 no-update-depth-loop unit guard passes, so it does not track this change's strip code path; however the T001 baseline did not capture console output, so attribution is unverified. It coincides with the rig-wide slowness behind the retry-passing flakes and is worth its own investigation, but no test failure maps to it.

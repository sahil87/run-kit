# Intake: E2E Tmux Fixture + Readiness Consolidation

**Change**: 260731-yc7n-e2e-tmux-fixture-readiness
**Created**: 2026-07-31

## Origin

One-shot `/fab-new yc7n` from the backlog (dedupe sweep 2026-07-31, clusters 1+2+3). Raw backlog item:

> Consolidate Playwright e2e tmux-fixture + readiness helpers (dedupe sweep 2026-07-31, clusters 1+2+3; run BEFORE the _boards.ts item — same spec files). (1) FIXTURE LIFECYCLE: 34 spec files in app/frontend/tests/e2e copy the same beforeAll/afterAll (try/catch `tmux -L $SERVER new-session -d -s $SESSION -x 80 -y 24` + kill-session teardown, stdio ignore) and 41 files re-declare `const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e"`. Create tests/e2e/_tmux.ts (underscore-helper convention like _ready.ts) exporting TMUX_SERVER + a layered fixture: base = create-session + teardown (all 34); opt-in layers = named-window loop (~12 files), idle command "sh -c 'sleep 300'" (board specs ~6, keeps panes stable), second server A/B with kill-server teardown (~4: multi-server-sidebar, sessions-scope-toggle, boards-multi-server, connection-budget), post-teardown API cleanup hook (~3 board specs). Inside the helper use `=name:` session targets or @/$ ids to fix the bare `-t $SESSION` window-target collision hazard (tmux -t <session> is a WINDOW target; a window named like the session hijacks new-window/list-panes). (2) READINESS BYPASS: 48 inline `page.goto` + `expect(page.locator("[aria-label='Connected']")).toBeVisible({timeout:10_000})` waits across ~20 files while tests/e2e/_ready.ts already exports gotoServerReady/gotoWindow/READY_TIMEOUT (CI-widened to 20s) — only 8 files import it; inline copies hardcode 10s and miss the CI widening (real flake source). Migrate them. Mind the _ready.ts precondition: the Connected dot lives in the sidebar footer (desktop viewport, sidebar open) — mobile-viewport specs must keep gating on always-mounted elements instead. (3) RESOLVEWINDOW COPIES: ~10 files re-implement _ready.resolveWindow's /api/sessions poll differing only in projection (window-marker-gutter.spec.ts:13 returns +marker+color, sidebar-window-sync.spec.ts:23 +index, web-view-lens.spec.ts id-only, echo-latency.spec.ts first-window with absolute BASE url) — extend _ready.resolveWindow to return the full window object (or add a projection-free variant) and migrate; 3 board specs also parse `tmux list-windows -F "#{window_id}:#{window_name}"` synchronously (board-reorder.spec.ts:13 winIds, board-close-and-unpin.spec.ts:9 windowId, board-autofit.spec.ts:26 windowIds) → one sync tmux-side query in _tmux.ts. Update sibling .spec.md companion docs only where test steps change (constitution: Test Companion Docs). Verify with just test-e2e; never raw playwright (port isolation).

Coordination constraints recorded alongside the item in `fab/backlog.md`:

- **Sequencing**: `2kio` (board e2e helpers, `_boards.ts`) is queued and starts only AFTER this change merges — both rewrite the same board spec files, and `_boards.ts` builds on the `_tmux.ts`/`_ready.ts` shapes this change establishes.
- **Box-wide e2e mutex**: `scripts/test-e2e.sh` hardcodes port 3020 + the `rk-test-e2e` tmux server across ALL worktrees — never let two `just test-e2e` runs overlap.

Intake-time verification against the working tree (2026-07-31) found small drift from the sweep's counts — see § Count drift below. The design is unchanged; the plan should re-derive exact file lists by grep at apply time.

## Why

1. **Real flake source**: `tests/e2e/_ready.ts` widens its readiness timeout to 20s under CI (`READY_TIMEOUT`), but only 8 of ~20 files that gate on the `[aria-label='Connected']` dot import it. The rest carry inline copies hardcoding `timeout: 10_000` — on a 2-vCPU CI runner (air + Vite + Chromium + tmux contending) these are exactly the waits that flake. Consolidating onto `_ready.ts` applies the CI widening everywhere. (`gotoWindow` inside `_ready.ts` itself hardcodes `10_000` at `_ready.ts:93` instead of using `READY_TIMEOUT` — same bug, same fix.)
2. **Maintenance burden**: 35 spec files copy the same tmux session beforeAll/afterAll lifecycle and 42 files re-declare the `TMUX_SERVER` constant. Any change to the lifecycle (e.g., a teardown fix) currently means a 35-file sweep. The queued `_boards.ts` change (`2kio`) will make this worse if the fixture isn't extracted first.
3. **Latent correctness hazard**: the copied lifecycle uses bare `-t $SESSION` targets. In tmux, `-t <session>` on `new-window`/`list-panes` is a WINDOW target — a window named like the session hijacks the target (create lands in the wrong session, index-joins show wrong panes). Folder-basename naming makes session==window collisions routine. Centralizing in `_tmux.ts` with `=name:` exact-match targets (or `@`/`$` ids) fixes the hazard in one place.

If we don't do this: CI flakes persist (10s waits), the `2kio` board-helper work duplicates against unconsolidated specs, and the window-target hazard stays latent in 35 copies.

## What Changes

All changes are confined to `app/frontend/tests/e2e/` — test infrastructure only, no production code.

### 1. New `tests/e2e/_tmux.ts` — layered tmux fixture

Following the underscore-helper convention established by `_ready.ts`. Exports:

- **`TMUX_SERVER`** — the single declaration of `process.env.E2E_TMUX_SERVER ?? "rk-test-e2e"`, replacing 42 per-file copies.
- **Base fixture** (all ~35 lifecycle files): setup = try/catch pre-kill + `tmux -L ${TMUX_SERVER} new-session -d -s ${session} -x 80 -y 24` (stdio ignore, matching the copied pattern); teardown = `kill-session`. Registered from the spec's `beforeAll`/`afterAll` (or exposed as a helper pair those hooks call — exact shape decided at apply).
- **Opt-in layers**, composable on the base:
  - **Named-window loop** — create N named windows in the session (used by ~12–20 files; exact list derived by grep at apply).
  - **Idle/pane command** — per-window shell command keeping panes stable. Must be **parameterized per window**, not the fixed `"sh -c 'sleep 300'"` the backlog text suggests: verified in-tree variance includes `sh -c 'sleep 300'` (board-autofit), `sh -c 'printf "PANE_${i}_OK\n"; sleep 120'` (boards-desktop-suspend), and `sh -c 'printf "${MARKER}\n"; sleep 60'` (boards-same-session-multi-pane). A `(index, name) => string` command template (or per-window command array) covers all three.
  - **Second server A/B** — a second tmux server socket with `kill-server` teardown. Verified users: `multi-server-sidebar`, `sessions-scope-toggle`, `boards-multi-server`, `create-server-waiting` (all declare `TMUX_SERVER_A`); `connection-budget` was listed in the sweep but declares only the single `TMUX_SERVER` — confirm at apply.
  - **Post-teardown API cleanup hook** — ~3 board specs unpin/clean via the HTTP API after tmux teardown.
- **Sync window-id query** — one helper wrapping `tmux -L ${TMUX_SERVER} list-windows -t ${session} -F "#{window_id}:#{window_name}"` returning `{ windowId, name }[]`, replacing the synchronous parse copies in board specs (verified call sites in board-reorder, board-close-and-unpin, board-autofit, boards-pin-flow, board-list-reorder, boards-desktop-suspend, boards-mobile, connection-budget, and others — ~10 sites; enumerate by grep at apply).
- **Target-collision fix**: every target inside the helper uses `=name:` exact-match session targets or `@`/`$` ids — never bare `-t ${session}` for window-scoped commands (`new-window`, `list-panes`, `list-windows`).

### 2. Readiness migration onto `tests/e2e/_ready.ts`

- Migrate the ~20 files (48 inline waits) doing `page.goto` + inline `expect(page.locator("[aria-label='Connected']")).toBeVisible({timeout:10_000})` to `gotoServerReady` / `gotoWindow`, picking up the CI-widened `READY_TIMEOUT`.
- Fix `gotoWindow`'s own hardcoded `10_000` (`_ready.ts:93`) to use `READY_TIMEOUT`.
- **Precondition guard** (documented in `_ready.ts` header, 260724-6j1v): the Connected dot lives in the sidebar FOOTER and the sidebar unmounts when collapsed or at mobile viewport. Mobile-viewport specs (e.g., `mobile-layout`, `boards-mobile`, `mobile-touch-scroll`) MUST keep gating on always-mounted elements (heading, chevron, iframe) — do not migrate their gates to the Connected dot. The migration list is "files already gating on the Connected dot", not "all files".

### 3. `resolveWindow` consolidation

- Extend `_ready.resolveWindow` (currently returns `windowId: string`) so callers can get the **full window object** from the `/api/sessions` poll, then migrate the ~10 per-file re-implementations that differ only in projection: `window-marker-gutter.spec.ts:13` (+marker+color), `sidebar-window-sync.spec.ts:23` (+index), `web-view-lens.spec.ts` (id-only), `echo-latency.spec.ts` (first-window, with absolute BASE url — needs the helper to accept/derive a base URL or the spec to keep its own thin wrapper).
- Preferred shape: change `resolveWindow` to return the full window object and update the 8 existing importers' call sites in the same pass (they're being touched anyway); a projection-free sibling variant is the fallback if signature churn proves noisy at apply.

### 4. Companion docs

Update sibling `.spec.md` files **only where test steps change** (constitution § Test Companion Docs). Pure mechanical helper-swaps that don't alter test steps don't require companion edits; fixture changes that alter Shared setup sections do.

### Count drift (intake-time verification, 2026-07-31)

The sweep's counts have drifted slightly: 55 spec files total; **35** files with the new-session lifecycle (sweep said 34); **42** `TMUX_SERVER` declarations (sweep said 41); **20** files calling `new-window` (sweep said ~12 for the named-window layer — some of those 20 create windows mid-test, not in fixtures); `list-windows -F` parsing spans **~10 board-spec call sites** (sweep said 3); `connection-budget` has no second server. Treat all counts as indicative — the plan MUST derive exact file lists by grep at apply time, not hardcode these numbers. <!-- assumed: sweep counts are indicative, not contractual — apply re-derives file lists by grep -->

## Affected Memory

None — this change is e2e test infrastructure only. No spec-level system behavior changes, no API/UI/backend changes, so no `docs/memory/` files are created or modified.

## Impact

- **Code**: `app/frontend/tests/e2e/` only — new `_tmux.ts`, extended `_ready.ts`, ~40 spec files edited (imports + fixture calls + readiness gates), `.spec.md` companions where steps change. Zero production code.
- **Verification**: `just test-e2e` (never raw playwright — port 3020 + isolated `rk-test-e2e` tmux server). Scoped runs via `just test-e2e "<spec>:<line>"`. The e2e suite is a box-wide mutex (port 3020 + `rk-test-e2e` shared across worktrees) — serialize runs.
- **Known pre-existing flake/failures on main, not caused by this change**: "Maximum update depth exceeded" console errors (window-heading/window-switch-transition/sync-latency); window-heading history-arrows forward-nav timeout; multi-server-sidebar:70 expand race (deterministic under isolation, unfixed). Don't bisect this change for them.
- **Downstream**: unblocks queued `2kio` (`_boards.ts`), which builds on the `_tmux.ts`/`_ready.ts` shapes.

## Open Questions

- None — the backlog item (produced by the dedupe sweep) fully specifies scope and design; residual choices are graded as assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | New helper is `tests/e2e/_tmux.ts`, underscore convention, exporting `TMUX_SERVER` + layered fixture | Backlog specifies file name, convention, and layer list explicitly | S:95 R:90 A:95 D:95 |
| 2 | Certain | Verify with `just test-e2e` only; never raw playwright; serialize e2e runs box-wide | Constitution/context + backlog mutex note; port-isolation is project law | S:95 R:95 A:95 D:95 |
| 3 | Certain | Helper internals use `=name:` / `@`-id targets, never bare `-t <session>` for window-scoped commands | Backlog mandates it; documented tmux window-target collision hazard | S:90 R:85 A:90 D:90 |
| 4 | Certain | Mobile-viewport specs keep gating on always-mounted elements — not migrated to the Connected-dot gate | `_ready.ts` documents the sidebar-footer precondition; backlog restates it | S:90 R:85 A:95 D:90 |
| 5 | Certain | `gotoWindow`'s hardcoded `10_000` becomes `READY_TIMEOUT` | Same CI-widening rationale as the whole migration; one-line, in-scope | S:70 R:90 A:90 D:90 |
| 6 | Confident | Idle-command layer is parameterized per window (`(index, name) => string` or command array), not fixed `"sh -c 'sleep 300'"` | Verified in-tree variance (sleep 300 / printf+sleep 120 / marker+sleep 60); fixed string can't cover it | S:70 R:85 A:90 D:75 |
| 7 | Confident | `resolveWindow` changes to return the full window object; existing 8 importers updated in the same pass | Backlog offers this or a sibling variant; fewer near-dupe helpers wins, callers touched anyway; variant is the recorded fallback | S:60 R:80 A:75 D:55 |
| 8 | Confident | Sweep counts treated as indicative; apply re-derives file lists by grep | Verified drift (35 vs 34 lifecycle, 42 vs 41 decls, ~10 vs 3 list-windows sites, connection-budget has no 2nd server) | S:75 R:90 A:85 D:80 |
| 9 | Confident | Second-server layer covers the 4 verified `TMUX_SERVER_A` files incl. `create-server-waiting`; `connection-budget` confirmed at apply | Grep shows `TMUX_SERVER_A` in 4 files; backlog's list included connection-budget which has none | S:65 R:85 A:80 D:70 |
| 10 | Confident | `.spec.md` companions updated only where test steps / shared setup change; pure import swaps exempt | Constitution wording: companion mirrors test steps; mechanical swaps leave steps identical | S:70 R:85 A:80 D:75 |

10 assumptions (5 certain, 5 confident, 0 tentative, 0 unresolved).

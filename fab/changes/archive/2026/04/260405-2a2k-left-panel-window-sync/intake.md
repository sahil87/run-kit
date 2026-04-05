# Intake: Left Panel Window Sync

**Change**: 260405-2a2k-left-panel-window-sync
**Created**: 2026-04-05
**Status**: Draft

## Origin

<!-- How was this change initiated? -->

> The left panel window names are no longer in sync with tmux. Lets say you use "wt create" to create a new worktree and open it in the current tmux session, unless I refresh the page I don't see it on the left panel

One-shot request, followed by the user specifying the investigation approach: use Playwright E2E (existing suite on port 3333 via `RK_PORT`, tmux server `rk-e2e` via `E2E_TMUX_SERVER`) to both reproduce the bug and add regression test cases.

## Why

The left sidebar derives its window list from SSE events, which poll tmux state every 2500ms. When a window is created externally (e.g., via `wt create --worktree-open tmux_window` which runs `tmux new-window -n <name> -c <path>`), the new window should appear in the sidebar within 2.5 seconds without any user action. Instead, it does not appear until the page is refreshed.

Refreshing the page forces the SSE connection to re-establish, which immediately sends the latest cached snapshot via `addClient`. This points to the issue being either: (a) the SSE is not broadcasting updates when new windows are detected, or (b) the frontend is not re-rendering when SSE updates are received.

The phrase "no longer in sync" implies a regression — this likely worked before and broke recently. The most recent sidebar-adjacent change was PR #120 ("fix: Sidebar Kill Hides Extra Window"), which added `onSettled` handlers to call `unmarkKilled` after kill operations complete.

**Consequence if not fixed**: Users who use `wt create` as part of their workflow see a stale sidebar until they manually refresh, breaking the real-time feel of the tool.

## What Changes

### Investigation-first

This change requires root cause diagnosis before a fix can be specified. The two most likely failure modes are:

**Hypothesis A — SSE is not broadcasting the change**

The SSE hub compares JSON snapshots using `previousJSON[server]`. If `FetchSessions` returns the same JSON despite a new window existing in tmux, no broadcast occurs. Potential causes:
- The `sseCacheTTL = 500ms` result cache in the SSE hub returns stale data (unlikely — 500ms is well below the 2500ms poll interval)
- The `paneMapCacheTTL = 5s` pane-map cache causes `FetchSessions` to return data that the JSON dedup treats as identical (unlikely — pane-map enrichment is additive; a new window still appears in `ListWindows` output with empty enrichment fields)
- `tmux list-windows` for the session returns stale or empty output momentarily after `tmux new-window` executes (possible race window)

**Hypothesis B — SSE is broadcasting but frontend doesn't re-render**

The `useMergedSessions` hook processes SSE sessions alongside the optimistic context. If a `killed` entry in the optimistic context filters out a window index that the new window happens to land on, the new window is hidden. This could happen if:
- A prior kill operation left a stale entry in `killed` (not properly cleared via `unmarkKilled`)
- PR #120's `onSettled` fix helps but there's still a case where `killed` entries leak

**Proposed fix (after root cause confirmed)**

- If Hypothesis A: reduce `ssePollInterval` from 2500ms to ≤1000ms, or invalidate the result cache on certain tmux events
- If Hypothesis B: add a safety mechanism in `useMergedSessions` to auto-expire `killed` entries after a timeout (e.g., 5 seconds) if SSE reconciliation doesn't clear them, preventing leaked entries from suppressing real windows

### Verification and test approach (confirmed by user)

Use the existing Playwright E2E infrastructure:
- Port: `3333` (from `RK_PORT` env, confirmed in `playwright.config.ts`)
- Tmux server: `rk-e2e` (from `E2E_TMUX_SERVER` env, used by all existing E2E specs)
- New test file: `app/frontend/tests/e2e/sidebar-window-sync.spec.ts`

Test scenario:
1. Create a tmux session on `rk-e2e`
2. Navigate the browser to `/{TMUX_SERVER}` — wait for SSE connected
3. Use `execSync` to run `tmux -L rk-e2e new-window -t <session> -n <name>` (external, no run-kit involvement)
4. Assert the new window appears in the sidebar **without a page reload**, within 5000ms (covers ≥2 poll cycles)
5. Also test window name changes: rename a window externally via `tmux -L rk-e2e rename-window` and assert the new name reflects in the sidebar

If the E2E test fails at step 4, the bug is confirmed. The test can also instrument the SSE stream (via `page.on("response", ...)` or request interception) to determine whether the SSE is broadcasting but the frontend ignores it (Hypothesis B) or the SSE is silent (Hypothesis A).

## Affected Memory

- None expected for a bug fix

## Impact

- `app/backend/api/sse.go`: may adjust `ssePollInterval` or cache TTL
- `app/frontend/src/contexts/optimistic-context.tsx`: may add stale-kill expiry or fix reconciliation
- `app/frontend/src/components/sidebar.tsx`: potentially minor (unmarkKilled call site)
- `app/frontend/tests/e2e/sidebar-window-sync.spec.ts`: new E2E test file (primary deliverable)

## Open Questions

- Root cause still unconfirmed (Hypothesis A vs B): the E2E test will determine this empirically
- Is the `killed` set in the optimistic context ever non-empty when the issue occurs? (secondary investigation path if Hypothesis B is confirmed)

## Assumptions

<!-- STATE TRANSFER: This table is the sole continuity mechanism between the intake-stage
     agent and the spec-stage agent. -->

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The SSE polling mechanism (2500ms) is the intended real-time update path for the sidebar | Directly observable in `session-context.tsx` — EventSource on `/api/sessions/stream` | S:5 R:5 A:5 D:5 |
| 2 | Certain | A page refresh forces SSE reconnect, which sends the latest snapshot immediately via `addClient` in `sse.go` | Directly observable in code — `addClient` sends `previousJSON` to newly connected clients | S:5 R:5 A:5 D:5 |
| 3 | Certain | E2E tests run on port 3333 (`RK_PORT`) against tmux server `rk-e2e` (`E2E_TMUX_SERVER`) | Confirmed in `playwright.config.ts` and all existing E2E specs (`sse-connection.spec.ts`, `api-integration.spec.ts`) | S:5 R:5 A:5 D:5 |
| 4 | Certain | New window E2E test uses `execSync("tmux -L rk-e2e new-window -t <session> -n <name>")` and asserts sidebar updates without page reload, within 5000ms | Consistent with how existing E2E specs interact with tmux; 5000ms covers ≥2 poll cycles at 2500ms interval | S:5 R:5 A:5 D:5 |
| 5 | Confident | This is a regression — the SSE-based sidebar update used to work for externally created windows | User said "no longer in sync", implying it worked before | S:4 R:4 A:4 D:4 |
| 6 | Confident | The root cause is either (A) SSE not broadcasting or (B) frontend suppressing new windows via stale `killed` set | Based on code analysis of SSE hub + optimistic context; E2E test will confirm which | S:4 R:4 A:4 D:4 |
| 7 | Tentative | Hypothesis B (stale `killed` entry filtering a real window by index) is more likely given PR #120 was the most recent relevant change | PR #120 added `onSettled` handlers indicating prior kill-state leaks were known; may not have closed all paths | S:3 R:3 A:3 D:3 |

7 assumptions (4 certain, 2 confident, 1 tentative, 0 unresolved).

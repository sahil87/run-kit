# Intake: Manual Status Refresh

**Change**: 260715-jykd-manual-status-refresh
**Created**: 2026-07-15

## Origin

Promptless dispatch (`/fab-proceed` → `_intake`, `{questioning-mode} = promptless-defer`) from a live conversation in which the design was fully worked out. Synthesized problem statement from that conversation:

> The PR register in the sidebar's PANE panel (and the StatusDot it feeds) can lag reality by up to 90 seconds by design: the viewer-wide PR collector ticks every 90s and the branch→PR refresher ticks every 30s. The user just merged a PR and doesn't want to wait up to 90s for the merged done-square. A manual refresh is the right affordance: the user knows the world changed before any poller does.

All major decisions below were made in that conversation (endpoint shape and naming, orphan retirement, non-blocking 202 semantics, coalescing + throttle, button placement, palette action, scope labeling). No questions were asked (promptless contract); every decision point is recorded as a graded assumption in `## Assumptions`.

## Why

**The pain point.** PR state in the UI is fed by two background pollers, both verified in code:

- The viewer-wide PR collector — `app/backend/internal/prstatus/prstatus.go` (`prstatus.Collector`) — ticks every 90s (`prStatusPollInterval = 90 * time.Second`, `app/backend/api/sse.go:113`). One batched `gh api graphql` viewer.pullRequests query supplies state/checks/review, keyed by PR URL.
- The branch→PR refresher — `app/backend/internal/prstatus/prstatus_branch.go` (`BranchRefresher` / `DefaultBranchRefresher`) — ticks every 30s (`branchPRRefreshInterval = 30 * time.Second`). Per-(repo,branch) `gh pr list --state all` supplies PR URL/number + fallback state.

When the user merges a PR, the merged state comes from the viewer collector's URL-keyed join (the URL is already cached by the branch refresher and does not change on merge), so the sidebar's done-square can lag by up to 90 seconds. The user knows the world changed before any poller does — the just-merged moment is exactly when they are looking at the dot.

**Consequence of not fixing.** Every merge ends with the user staring at a stale StatusDot for up to a minute and a half, or reloading the page (which doesn't help — the data is server-side).

**Why this approach.** Lowering the 90s poll interval was rejected: polling faster never satisfies the "show me now" moment and multiplies background `gh` load for everyone all the time. A manual refresh affordance is the correct shape — an explicit, throttled, user-initiated kick of both pollers, with the fresh data arriving through the existing SSE stream.

**The orphan.** An earlier endpoint `POST /api/pr-status/refresh` (`app/backend/api/router.go:487` → `handlePRStatusRefresh`, `app/backend/api/pr_status.go`) already exists but only kicks the viewer collector, blocks synchronously on the gh call, and its sole frontend consumer — the `PrStatusLine` component — has **zero live mount sites** (verified: all remaining `PrStatusLine` references in `status-dot-tip.tsx`, `status-panel.tsx`, `window-row.test.tsx` are prose comments; it is a known deletion candidate per `docs/memory/run-kit/ui-patterns.md`). The conversation explicitly decided to retire this orphan surface in the same change rather than extend or nest it (Constitution IV spirit: minimal surface area — one endpoint, no orphan surface).

## What Changes

### 1. Backend — `BranchRefresher` gains an on-demand refresh method

`app/backend/internal/prstatus/prstatus_branch.go`: `BranchRefresher.refresh` is currently unexported and tick-driven only (called from `Start`'s goroutine, lines 234–248). Add an exported on-demand method mirroring `Collector.RefreshNow` (`prstatus.go:119`):

```go
// RefreshNow triggers an on-demand re-resolve of every registered
// (repo, branch) pair (used by the POST /api/status/refresh endpoint).
// Best-effort: errors are swallowed per pair (stale-while-revalidate).
func (r *BranchRefresher) RefreshNow(ctx context.Context) {
	r.refresh(ctx)
}
```

The process-wide instance is `prstatus.DefaultBranchRefresher` (started in `app/backend/api/router.go:397`); the handler kicks it through whatever seam the implementation chooses (see §2 testability seam).

### 2. Backend — new composing endpoint `POST /api/status/refresh`

New handler `handleStatusRefresh` in `app/backend/api/` (natural home: replace `api/pr_status.go` with e.g. `api/status_refresh.go` + `api/status_refresh_test.go`), route registered as `r.Post("/api/status/refresh", s.handleStatusRefresh)`.

**Naming rationale (decided):** `handlePaneRefresh` was explicitly rejected — "pane" means a tmux pane in this codebase and would read as "redraw a tmux pane". "Status" matches the established vocabulary (status pyramid, StatusDot).

**Behavior (all decided):**

- Kicks BOTH pollers: `s.prStatus.RefreshNow(ctx)` (viewer collector — supplies the merged state via the URL-keyed join) AND the branch refresher's new `RefreshNow` (covers the sibling case: a just-opened PR appearing on a window, a 30s wait today). Nil-guard the collector as `handlePRStatusRefresh` does today (test router wires no collector).
- **Non-blocking, returns 202 immediately.** The branch refresher's pass is one `gh pr list` per registered pair and can exceed 5s with many windows; `fab/project/code-review.md` caps handler blocking at 5s. The handler starts the two refreshes in a **detached goroutine** and returns `202 Accepted` without waiting. Detached means `context.Background()` + its own timeout, NOT `r.Context()` (which dies when the handler returns) — `app/backend/api/waiting_push.go` (~line 220) has this exact detached-goroutine pattern to copy.
- **Coalescing:** if a forced refresh is already in flight, return 202 without starting another.
- **Server-side min-interval throttle:** enforce a minimum interval between forced refreshes so ANY trigger (button-mashing, multiple tabs, future auto-triggers) is safe to over-fire. Throttled calls also return 202 (fire-and-forget semantics — the client never distinguishes started/coalesced/throttled). This handler is the **single choke point** for frequency control.
- The response body is never what the UI waits on: fresh data reaches clients via the existing SSE stream (~2.5s cadence).
- POST per Constitution §IX (mutating endpoints use POST).

### 3. Backend — retire the orphaned old endpoint

Delete in the same change (decided over nesting/extending):

- Route `r.Post("/api/pr-status/refresh", s.handlePRStatusRefresh)` — `app/backend/api/router.go:487`
- Handler `handlePRStatusRefresh` — `app/backend/api/pr_status.go` (whole file; superseded by the new handler file)

### 4. Frontend — retire `PrStatusLine` and repoint the client wiring

- Delete `app/frontend/src/components/pr-status-line.tsx` and `app/frontend/src/components/pr-status-line.test.tsx` (zero live mount sites; the component is the old endpoint's only consumer via `refreshPrStatus()` at line 313).
- `app/frontend/src/api/client.ts:371` — rename/repoint `refreshPrStatus()` to the new endpoint (e.g. `refreshStatus()` hitting `/api/status/refresh`); update its doc comment (now: kicks both pollers, 202, data via SSE).
- Stale prose references to `PrStatusLine` in comments (`status-dot-tip.tsx:113`, `status-panel.tsx:104`, `window-row.test.tsx:140`) may be tidied while touching those areas — comment-only, no behavior.

### 5. Frontend — refresh button on the PANE section header

The PANE panel is `WindowPanel` (`app/frontend/src/components/sidebar/status-panel.tsx:128`), rendered via `<CollapsiblePanel title="Pane" ... headerRight={headerRight}>` (line 137). `CollapsiblePanel` already exposes a `headerAction` prop ("Action element rendered at the right side of the header… Click events are stopped from toggling the panel" — `collapsible-panel.tsx`) — the natural seam for the button.

- A refresh button at the top-right of the PANE section header in the left sidebar.
- **Busy/spinner state** while the POST is in flight; the refreshed state lands via SSE within ~2.5s after.
- Follow the existing top-bar/board refresh affordance vocabulary (CRT-glint button treatment per `fab/project/context.md` hover-animation vocabulary).

### 6. Frontend — command palette action

Constitution §V (keyboard-first) makes palette reachability mandatory for any new user-facing action. Add a palette action (label e.g. `PR: Refresh Status`) triggering the same POST. Follow the established pure-builder pattern (`app/frontend/src/lib/palette-*.ts` — e.g. `palette-update.ts` with its colocated `.test.ts`).

### 7. Scope honesty (decided)

This is effectively a **PR-status** refresh — the other PANE-panel registers (fab, agent, out) are already fresh within ~7.5s worst case (5s fab pane-map cache + 2.5s SSE). The affordance is labeled around PR/status freshness; it does not promise "refresh all pane stats".

### 8. Tests

- **Backend** (`code-quality.md`: new behavior MUST include tests): handler tests covering (a) 202 returned immediately, (b) both pollers kicked (via injected seams — e.g. function fields on `api.Server` so tests assert kicks without spawning `gh`), (c) coalescing (no second in-flight refresh), (d) min-interval throttle.
- **Frontend**: unit tests for the button (busy state, POST fired) and the palette action builder.
- If any Playwright `.spec.ts` is touched, its sibling `.spec.md` MUST be updated in the same commit (Constitution — Test Companion Docs). No e2e change is required by this design; existing `pr-status-sidebar.spec.ts` does not exercise the refresh endpoint.

### Explicitly out of scope (decided)

- **Refresh on tab `visibilitychange` (refetch-on-focus)** — explicitly deferred out of v1; the user is concerned about refresh frequency. The server-side min-interval makes it a trivial safe follow-up, but it is OUT OF SCOPE here.
- Lowering the 90s/30s poll intervals.

## Affected Memory

- `run-kit/architecture`: (modify) API endpoint list — add `POST /api/status/refresh` (composing both prstatus refreshes, 202 detached semantics, coalescing + min-interval choke point); remove `POST /api/pr-status/refresh`; note `BranchRefresher.RefreshNow` on-demand seam next to the existing branch→PR derivation entry.
- `run-kit/ui-patterns`: (modify) PANE panel gains a header refresh button + palette action (`PR: Refresh Status`); resolve the "PrStatusLine now a deletion candidate (zero live sites)" note — component deleted.

## Impact

**Backend** (`app/backend/`):
- `internal/prstatus/prstatus_branch.go` — new exported `RefreshNow` (+ test in `prstatus_branch_test.go` if present, else alongside)
- `api/pr_status.go` — deleted; replaced by new handler file (e.g. `api/status_refresh.go` + `_test.go`)
- `api/router.go` — route swap at line 487 (delete old registration, add new)
- Possibly a small seam on `api.Server` for the branch-refresher kick (testability)

**Frontend** (`app/frontend/src/`):
- `api/client.ts` — `refreshPrStatus` → `refreshStatus` repoint (line 371)
- `components/pr-status-line.tsx` + `.test.tsx` — deleted
- `components/sidebar/status-panel.tsx` — PANE header button (via `CollapsiblePanel` `headerAction`)
- `lib/palette-*.ts` (new or existing) + palette registration site — palette action
- Unit tests colocated per project convention

**Systems**: no new dependencies, no schema/state store (Constitution II untouched — both pollers remain in-memory derive-from-gh). SSE stream unchanged (delivery path already exists).

## Open Questions

None — all decision points were resolved in the originating conversation or recorded as graded assumptions below (promptless-defer contract: would-be-asked Unresolved decisions would appear as `Deferred — promptless dispatch` rows; none scored Unresolved).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | New composing endpoint `POST /api/status/refresh` + `handleStatusRefresh` kicks BOTH pollers; "status" naming (not "pane") | Discussed — user chose composing endpoint over extending `handlePRStatusRefresh`; `handlePaneRefresh` rejected for tmux-pane semantic collision | S:90 R:75 A:90 D:95 |
| 2 | Certain | Retire the orphan in the same change: delete `POST /api/pr-status/refresh` route + `handlePRStatusRefresh` + `PrStatusLine` (+ its test) and repoint `refreshPrStatus()` | Discussed — explicitly decided over nesting; PrStatusLine verified at zero live mount sites (comment-only references) | S:95 R:80 A:90 D:90 |
| 3 | Certain | Non-blocking handler: detached goroutine (`context.Background()` + own timeout, never `r.Context()`), returns 202 immediately; data arrives via existing SSE | Discussed — branch pass can exceed the 5s handler cap (`code-review.md`); `waiting_push.go` has the exact detached pattern | S:90 R:80 A:95 D:90 |
| 4 | Certain | Coalescing (skip if in flight) + server-side min-interval throttle in the handler; single choke point; throttled/coalesced calls also 202 | Discussed — makes any trigger safe to over-fire; client semantics stay fire-and-forget | S:85 R:80 A:85 D:85 |
| 5 | Confident | Min-interval default: 10 seconds | Value not fixed in conversation; 10s is mash-safe, well under both tick cadences, trivially tunable constant | S:45 R:90 A:75 D:60 |
| 6 | Certain | `BranchRefresher` gains exported `RefreshNow(ctx)` delegating to unexported `refresh`, mirroring `Collector.RefreshNow` | Codebase gives the exact pattern one file over (`prstatus.go:119`); named method was the agreed mechanism | S:70 R:90 A:95 D:90 |
| 7 | Certain | Refresh button on PANE section header top-right, with busy/spinner state while POST in flight | Discussed — placement and busy state explicitly agreed; `CollapsiblePanel.headerAction` is the purpose-built seam | S:85 R:90 A:90 D:85 |
| 8 | Certain | Command palette action for the refresh | Constitution §V mandates palette reachability; explicitly agreed | S:85 R:90 A:95 D:85 |
| 9 | Confident | Exact palette label: `PR: Refresh Status` | Conversation gave examples ("Status: Refresh" / "PR: Refresh Status"), not a final string; PR-prefixed label matches scope-honesty decision; trivially renameable | S:55 R:95 A:85 D:65 |
| 10 | Certain | `visibilitychange` auto-refresh is OUT of scope for v1 | Explicitly deferred in conversation — user concerned about refresh frequency; min-interval makes it a safe follow-up later | S:90 R:85 A:90 D:90 |
| 11 | Confident | Testability seam: refresh kicks injected as function field(s)/interface on `api.Server` so handler tests assert both kicks without spawning `gh` | Matches existing collector-injection pattern (`router.go:86` "prStatus collector injection pattern"); exact shape left to apply | S:55 R:85 A:85 D:70 |
| 12 | Confident | Detached refresh context carries a bounded timeout (~60s) | Conversation required "own timeout" without a value; collector gh call is 10s-bounded, branch pass is per-pair — 60s bounds the whole pass without truncating it | S:45 R:90 A:80 D:65 |
| 13 | Confident | Button renders whenever the PANE panel header renders (including with no window selected) — the refresh is server-global | Not discussed; the collector is viewer-wide so gating on window selection adds nothing; trivially changed | S:40 R:95 A:70 D:55 |
| 14 | Certain | Client wiring: rename `refreshPrStatus()` → `refreshStatus()` targeting `/api/status/refresh` (client.ts:371) | Discussed — "repoint/rename to the new endpoint"; concrete name follows the endpoint's status vocabulary | S:75 R:90 A:90 D:80 |
| 15 | Certain | Affordance labeled around PR/status freshness — no "refresh all pane stats" promise | Discussed — other registers already fresh within ~7.5s worst case (5s fab pane-map cache + 2.5s SSE) | S:80 R:90 A:85 D:85 |

15 assumptions (10 certain, 5 confident, 0 tentative, 0 unresolved).

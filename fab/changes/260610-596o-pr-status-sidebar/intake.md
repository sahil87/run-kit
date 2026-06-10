# Intake: Live PR Status in Sidebar

**Change**: 260610-596o-pr-status-sidebar
**Created**: 2026-06-10
**Status**: Draft

## Origin

> Surface live PR status in the run-kit sidebar (and dashboard) for windows bound to a fab change, so I stop asking the agent "what's the PR status."

**Interaction mode**: Conversational. This change emerged from a `/fab-discuss` session that worked through the full architecture before any code was written. The user's recurring pain — repeatedly asking the agent for the status of a change's PR (usually the fab-kit PR, whose URL lives in the change's `.status.yaml`) — drove a multi-round design exploration. A precursor change in fab-kit (`260609-r7ju-pane-map-pr-fields`, now released in `fab 2.1.2`) was created and shipped during this session to add `pr_url`/`pr_number` to `fab pane map --json`; this change is the run-kit consumer side.

**Key decisions reached during discussion** (see Assumptions for SRAD grades):
- Surface **live PR status** (open/merged/checks/review), not just the bare link — the status is what makes the user ask the agent.
- PR URL comes from `fab pane map` (already released); PR **state** requires a live `gh` call (fab-kit deliberately does not poll GitHub).
- Batch via `gh search prs --author @me` — **one** call for all PRs, O(1) regardless of parallel-task count (rejected per-PR polling as non-scaling: 10 tasks must not mean 10 calls).
- Persist the cache **in-memory** (mirror `internal/metrics.Collector`), not in a tmux option — the wholesale-rebuild-per-refresh gives cleanup for free (the deciding factor when the user asked "how does cleanup happen when a window is removed?").
- Display gated to **change-bound windows only**.

## Why

1. **Problem**: The user runs many parallel fab changes, each with a PR (often the fab-kit PR). To learn a PR's status (open/merged, CI checks, review decision) they must ask the driving agent, which is slow, interrupts the agent's work, and doesn't scale across many simultaneous changes.
2. **Consequence if unfixed**: PR status remains invisible at a glance. The user keeps context-switching into agents purely to ask "what's the PR doing," defeating the orchestration-dashboard premise of run-kit (see every window's state on the left panel).
3. **Why this approach**: The PR URL is already free in `fab pane map` (filesystem, no network). Live status is the only expensive part, and the design isolates it behind a slow, batched, in-memory collector so the 2.5s SSE hot path never makes a network call. Batching (`gh search prs --author @me`) makes cost O(1) in PR count. In-memory persistence with wholesale rebuild makes cleanup automatic (merged/closed PRs and killed windows simply drop out of the next snapshot — no eviction logic). This respects Constitution §II (no database — the cache is re-derivable from GitHub in one call), §I (exec.CommandContext with arg slice + timeout), and §IX (POST-only refresh endpoint). Alternatives rejected: per-PR `gh pr view` polling (doesn't scale); `git ls-remote` (can't surface checks/review state); webhook receiver writing back to `.status.yaml` (overkill, contradicts fab-kit's poll-free design); tmux `@rk_pr_status` option persistence (needs manual pruning + two-writer race, restart-survival has little value for a 90s cache).

## What Changes

Three layers on separate cadences so the SSE hot path never makes a network call.

### Layer 1 — Consume `pr_url`/`pr_number` (cheap, filesystem)

Flow the already-emitted pane-map fields onto each window via the existing enrichment join.

- `tmux.WindowInfo` (`internal/tmux/tmux.go`) gains `PrURL *string` (`json:"prUrl,omitempty"`) and `PrNumber *int` (`json:"prNumber,omitempty"`), alongside `FabChange`/`FabStage`.
- `paneMapEntry` (`internal/sessions/sessions.go`) gains `PrURL *string` (`json:"pr_url"`) and `PrNumber *int` (`json:"pr_number"`).
- In the `enrichByWindowID[...]` join loop (~line 449), assign `sd.windows[j].PrURL = entry.PrURL` and `.PrNumber = entry.PrNumber` alongside the existing `FabChange`/`FabStage`/`AgentState` assignments.
- Frontend `Window` type (`src/types.ts`): add `prUrl?: string; prNumber?: number;`.

### Layer 2 — `internal/prstatus` collector (expensive, network — isolated)

New package modeled exactly on `internal/metrics.Collector`:

```go
type PRStatus struct {
    Number         int
    URL            string
    State          string    // open | merged | closed
    IsDraft        bool
    Checks         string    // pass | fail | pending | none
    ReviewDecision string    // approved | changes_requested | review_required | none
    FetchedAt      time.Time
}
type Collector struct {
    mu       sync.RWMutex
    byNumber map[int]PRStatus
    interval time.Duration
}
```

- `NewCollector(interval time.Duration) *Collector`, `Start(ctx context.Context)` (background goroutine ticking at `interval`, exits on `ctx.Done()`), `Snapshot() map[int]PRStatus` (deep copy under `RLock`), `RefreshNow(ctx)` (on-demand).
- `refresh()`:
  - Guard `command -v gh`; if absent OR `gh auth status` fails, leave the last-good map untouched and return nil (fail silently, same posture as the `command -v rk` checks).
  - ONE batched call: `gh search prs --author @me --state open --json number,url,state,isDraft,statusCheckRollup,reviewDecision`. Uses `exec.CommandContext` with a 10s timeout and an explicit argument slice (no shell string).
  - Map `state` + `isDraft` to the display State; collapse `statusCheckRollup` to a single `pass|fail|pending|none`; map `reviewDecision` to the enum.
  - Build a fresh `map[int]PRStatus` and REPLACE `byNumber` wholesale under `Lock`. A PR that merged/closed (absent from `--state open`) is simply gone next cycle — this is the cleanup mechanism (no eviction logic, no window-lifecycle hooks).
  - On `gh` call error (network blip), KEEP the last-good map (stale-while-revalidate, like `fetchPaneMapCached` / `metrics.Collector` degradation).
- Wire into the SSE hub in `api/router.go` next to the metrics collector (~line 293): `pc := prstatus.NewCollector(prStatusPollInterval); pc.Start(ctx)`; hand the hub a reference so `poll()` can read `pc.Snapshot()`.
- Named cadence constant `prStatusPollInterval = 90 * time.Second` (~40 calls/hr vs. the 5000/hr authenticated limit).

### Layer 3 — Join + display (pure in-memory read on the hot path)

- BACKEND join: when assembling the SSE `sessions` payload, for each window with a non-nil `PrNumber`, look it up in `pc.Snapshot()` and attach status. `tmux.WindowInfo` gains `PrState string` (`json:"prState,omitempty"`), `PrChecks string` (`json:"prChecks,omitempty"`), `PrReview string` (`json:"prReview,omitempty"`), `PrIsDraft bool` (`json:"prIsDraft,omitempty"`). The join is a pure read of `Snapshot()` — NO `gh` call on the poll. Gate: attach only when the window ALSO has a non-empty `FabChange` (change-bound gate).
- FRONTEND `Window` type (`src/types.ts`): add `prState?: "open"|"merged"|"closed"; prChecks?: "pass"|"fail"|"pending"|"none"; prReview?: "approved"|"changes_requested"|"review_required"|"none"; prIsDraft?: boolean;`.
- FRONTEND sidebar `WindowRow` (`src/components/sidebar/window-row.tsx`): below the existing name/`fabStage` row (the `{win.fabStage && ...}` block ~line 224), add a second line shown ONLY when `win.fabChange && win.prNumber`: `PR #<prNumber> <state-glyph> <state> · <checks/review summary>` (e.g. `PR #386 ✓ open · checks pass`, `PR #381 ✗ review: changes requested`). `PR #<n>` is a link to `prUrl` (new tab; `stopPropagation` so it does not also select the window). Use the existing toolbar color convention (`text-text-secondary` default, accent/red for fail-ish states — globals color tokens, no new hardcoded hex). Respect the `coarse:` touch-target convention.
- FRONTEND dashboard window cards (`src/components/dashboard.tsx`): same one-line PR summary under the fab-stage badge, same gate.
- ON-DEMAND refresh: `POST /api/pr-status/refresh` calls `pc.RefreshNow(ctx)`, returns `200 {"ok":true}`. Clicking the PR row (not the `#link`) triggers the refresh — best-effort, never blocks. Frontend `refreshPrStatus()` POST wrapper in `src/api/client.ts`.

## Affected Memory

- `run-kit/architecture.md`: (modify) new `internal/prstatus` package in the backend-libraries table; `WindowInfo` PR fields; new `POST /api/pr-status/refresh` endpoint; SSE poll reading the prstatus snapshot; pane-map enrichment gaining `pr_url`/`pr_number`.
- `run-kit/ui-patterns.md`: (modify) sidebar `WindowRow` PR-status line and dashboard window-card PR summary; the change-bound display gate; the on-demand refresh affordance.

## Impact

- **Backend**: `internal/tmux/tmux.go` (`WindowInfo` fields), `internal/sessions/sessions.go` (`paneMapEntry` + join), new `internal/prstatus/` package, `api/router.go` (collector wiring), `api/sse.go` (snapshot join), new `POST /api/pr-status/refresh` handler.
- **Frontend**: `src/types.ts`, `src/api/client.ts`, `src/components/sidebar/window-row.tsx`, `src/components/dashboard.tsx`, plus unit + e2e tests.
- **External dependency**: `gh` CLI (GitHub) — new runtime dependency, but optional (fails silently if absent/unauth). Authenticated rate limit 5000/hr; usage ~40/hr.
- **No new persistent state**: in-memory only; no DB, no disk, no tmux option (Constitution §II).
- **Constitution**: §I (exec.CommandContext + timeout + arg slice), §II (no database — re-derivable cache), §IX (POST-only refresh; CORS allowlist already `[GET,POST,OPTIONS]`).

## Open Questions

None blocking — the architecture was fully resolved during the design discussion.

- `gh search prs --author @me` only finds the user's own PRs; a change's PR opened by someone else (or a bot) won't appear and the row stays hidden. Accepted for v1 (matches the user's workflow — their own fab-kit PRs). A future fallback could per-URL `gh pr view` any `pr_number` missing from the batch result.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Surface live PR status (open/merged/checks/review), not just the bare link | Discussed — user explicitly chose "Live PR status" over link-only | S:98 R:70 A:90 D:95 |
| 2 | Certain | Batch via single `gh search prs --author @me --state open` call | Discussed — user selected this for O(1) scaling; rejected per-PR polling explicitly | S:98 R:75 A:92 D:95 |
| 3 | Certain | Persist cache in-memory (mirror `internal/metrics.Collector`), not tmux option | Discussed — user's cleanup question made wholesale-rebuild the deciding factor | S:96 R:65 A:90 D:92 |
| 4 | Certain | Cleanup via wholesale map rebuild each refresh (no eviction logic) | Discussed — directly answers "how does cleanup happen when a window is removed" | S:95 R:70 A:92 D:95 |
| 5 | Certain | Display gated to change-bound windows only (`fabChange && prNumber`) | Discussed — user selected "Only when change is bound" over branch-heuristic matching | S:96 R:80 A:90 D:95 |
| 6 | Certain | `fab pane map` (released 2.1.2) supplies `pr_url`/`pr_number`; run-kit owns status fetch | Discussed + verified — pane-map output inspected this session, fields confirmed present | S:98 R:75 A:95 D:95 |
| 7 | Confident | Cadence `prStatusPollInterval = 90s` background + on-demand refresh | Discussed — user wanted "even lower cadence + caching + on-demand"; 90s within that intent | S:80 R:90 A:85 D:75 |
| 8 | Confident | Collapse `statusCheckRollup`→`pass\|fail\|pending\|none` and `reviewDecision`→4-enum | Standard GitHub status fields; one obvious collapse; reversible display detail | S:75 R:88 A:85 D:78 |
| 9 | Confident | On-demand refresh is global (one `gh search`), triggered by clicking the PR row | Batching is already O(1), so global refresh is simpler than per-PR; one code path | S:78 R:88 A:82 D:80 |
| 10 | Confident | `gh` absent/unauth → silent no-op everywhere (no PR row shown) | Matches `command -v rk` fail-silent posture; one obvious degradation path | S:82 R:85 A:90 D:82 |
| 11 | Confident | Inject the `gh` exec via a function field for test stubbing | Matches the codebase's existing exec-seam test pattern (e.g. orderFetcher stub) | S:78 R:85 A:85 D:80 |

11 assumptions (6 certain, 5 confident, 0 tentative, 0 unresolved).

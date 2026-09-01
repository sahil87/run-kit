# Intake: SSE Derive Debounce + Branch-PR Negative Caching

**Change**: 260901-rtwx-sse-debounce-branchpr-negative-cache
**Created**: 2026-09-01

## Origin

Promptless dispatch (`/fab-proceed` create-new, `{questioning-mode} = promptless-defer`) from a diagnostic session on 2026-09-01. The user reported the fabKit tmux server session feeling slow in the dashboard while much larger servers (45 windows) were fine. The session ruled out any O(worktrees) cost in the derive path and isolated two independent performance defects in the state-derivation layer; all file:line anchors below were re-verified against this worktree's HEAD during intake.

> Two performance fixes to the state-derivation layer: (1) debounce notification-driven derive storms in the SSE hub — coalesce control-mode generation bumps for a short window (~300ms) so a burst of `%window-renamed` events becomes one derive; (2) cache the negative result ("no PR for this (repoDir, branch)") in the branch-PR refresher with a ~10-minute TTL so the `gh pr list` fallback stops re-running every 30s pass forever for branches that have no PR.

Key decisions from the session: debounce window "say, 300ms" (a constant in the 250–500ms band, no config knob); negative-cache TTL ~10 minutes; both are internal constants, no new env vars or settings keys; changing the tmux `automatic-rename-format` or demoting `%window-renamed` from trigger status was explicitly deferred as separate optional hardening; treating a viewer-index miss as an authoritative "no PR" was rejected (the index covers only viewer-authored PRs).

## Why

**Fix 1 — the SSE hub has no debounce on event-driven invalidation.** The poll loop (`app/backend/api/sse.go:1409-1412`) unconditionally deletes the 500ms per-server sessions cache whenever the prior `waitForNext` observed a control-mode generation bump, so the effective derive rate is bounded only by event arrival rate. Generation bumps come from `app/backend/internal/tmuxctl/client.go:340-368` (`%window-renamed`, `%layout-change`, `%session-window-changed`, `%sessions-changed`, `%unlinked-window-*`; `%output` is already correctly ignored). The managed tmux config (`configs/tmux/default.conf:25`) ships `automatic-rename-format '#{b:pane_current_path}'`, so every `cd` in any agent pane fires `%window-renamed` — an actively-working agent drives near-continuous full derives. Amplifiers: the poll loop is ONE goroutine serial over all servers (`api/sse.go:1397`), so one churning server delays every server's stream, and `capturePreviews` (`api/sse.go:1194-1204`, serial `tmux capture-pane` per window of expanded sessions) rides each tick. Without the fix, one busy agent degrades dashboard latency for the whole host.

**Fix 2 — the branch-PR refresher re-runs `gh pr list` forever for PR-less branches.** `DefaultBranchRefresher`'s pass runs serially over all registered (repoDir, branch) pairs every 30s (`app/backend/internal/prstatus/prstatus_branch.go:977-1062`). Resolution is three-stage: default-branch exclusion (local git) → viewer head-index join (free) → `gh pr list --head <branch> --state all` fallback (`prstatus_branch.go:177-193`, 10s timeout each). A branch with NO PR misses the viewer index on EVERY pass forever, because an index miss is deliberately never authoritative (`prstatus_branch.go:1007-1012` — the batch covers only viewer-authored PRs in a recency window), so the pair re-runs the gh fallback every 30s indefinitely. On this host there are 150–370+ worktrees across repos (each worktree is its own repoDir), making this the only O(worktree-count) cost in run-kit: a near-continuous serial gh subprocess loop of host-global CPU/network load. It never blocks the SSE tick (separate mutex) but is pure waste — and it competes for the same gh rate budget as the collectors.

**Why these approaches.** The debounce blunts the storm at its consumption point without touching tmux config or the trigger set (both deferred as separate optional hardening) and without altering the 12s/2.5s safety-timer or 500ms cache-TTL semantics. The in-repo precedent is `internal/snapshot`'s Snapshotter, which already coalesces the same generation counter (2s stability tick + 15s maxHold) — the hub is the one generation consumer still deriving per-event. The negative cache is a bounded in-memory TTL entry in an existing collector that already maintains exactly this kind of TTL caching (`branchDefaultBranchTTL`/`branchOriginTTL` at 5min, `branchPRAvailabilityTTL` at 60s), so it fits the existing pattern rather than introducing a new state store (Constitution II: bounded in-memory derived state, never authoritative).

## What Changes

### Fix 1: Coalesce notification-driven invalidation in the SSE hub

**File**: `app/backend/api/sse.go` (hub loop: `poll` around :1397-1433, `waitForNext` :1826-1872, constants block :71-104).

**Current behavior**: `waitForNext` blocks on per-server subscriber generation channels + wake channels + the safety timer. Any subscriber generation bump marks `eventDrivenServers[server] = true`; the next `poll` iteration deletes `h.cache[server]` (`sse.go:1409-1412`) and re-derives immediately. A rename burst (e.g. `cd` churn in agent panes) produces one full derive per event.

**New behavior**: when `waitForNext` returns because of a **control-mode subscriber generation bump**, the hub waits a short coalescing window before deriving, absorbing any further bumps that land during the window into the same single derive (trailing-edge coalescing — the user explicitly chose "do not derive immediately; wait a short coalescing window"). A burst of N renames becomes one derive ~300ms after the first event instead of N derives.

- New unexported constant in the existing `const` block, e.g. `sseEventDebounce = 300 * time.Millisecond`, with a comment stating the constraint (bounds event-driven derive rate; a burst coalesces into one derive; safety timers and cache TTL are independent of it). No config knob, no env var.
- **Explicit `wake()` signals bypass the debounce**: wake wins (`waitCase.isWake`, consumed via `consumeWake`) exist precisely for sub-second post-mutation repaint (user-option POSTs emit no control-mode event — see `docs/memory/run-kit/api-and-sockets.md` § per-server wake seam); delaying them would regress a shipped latency fix. Only subscriber generation-bump wins are coalesced. If a wake and a bump race, the wake's immediacy wins (deriving early for a bump is always safe — the debounce is an optimization, not a correctness gate).
- The **12s `safetyPollInterval`, 2.5s `legacyPollInterval`, and 500ms `sseCacheTTL` semantics stay unchanged**. The debounce sits only between "generation bump observed" and "cache invalidated + derive run".
- Exact mechanism is apply's decision (decide-and-record): e.g. after an event-driven `selectFirst` win, sleep/re-arm for the window and drain further fired cases before returning to `poll`; or carry a per-server pending-invalidation timestamp. Whatever shape, it must not delay wake wins, must not extend the safety timer, and must keep `perServerGen` bookkeeping correct (no lost bumps — an event landing during the window must still be reflected in the derive that follows it).
- **Out of scope** (explicitly deferred as separate optional hardening): changing `configs/tmux/default.conf`'s `automatic-rename-format`, demoting `%window-renamed` from trigger status, parallelizing the per-server poll loop, and touching `capturePreviews` or `internal/snapshot` (the Snapshotter already carries its own debounce — 2s check tick + 15s maxHold in `internal/snapshot/snapshotter.go:12-36` — and needs no change).

### Fix 2: Negative-result TTL cache in the branch-PR refresher

**File**: `app/backend/internal/prstatus/prstatus_branch.go` (pass: `refreshPass` region :977-1062, entry struct `branchEntry` :368, constants block :73-120, `Register` wake :650-661).

**Current behavior**: for each due pair, the pass runs default-branch exclusion → viewer head-index join → gh fallback. A successfully parsed empty `gh pr list` result writes `e.pr = nil` (a true negative) — but nothing records *when* the negative was confirmed, so the next 30s pass sends the pair straight back through the gh fallback. PR-less branches (the common case across 150+ worktrees) cost one 10s-timeout-bounded `gh` subprocess per pair per pass, forever.

**New behavior**: a gh-confirmed negative is cached with a TTL so the gh fallback is skipped while the negative is fresh.

- New unexported constant alongside the existing TTL constants, e.g. `branchPRNegativeTTL = 10 * time.Minute`, with a comment explaining the staleness bound (worst-case delay for a PR created by other means to appear; viewer-authored PRs are picked up faster via the index join). No config knob.
- Record the confirmation time on the existing entry (e.g. a `negativeAt time.Time` field on `branchEntry`, set when a parsed gh result yields `pr == nil`, cleared whenever the entry gains a PR). At the gh-fallback step, skip the `r.exec` call when the entry holds a fresh negative (`now.Sub(negativeAt) < branchPRNegativeTTL`).
- **Freshness overrides still work unchanged**: the default-branch exclusion and the viewer head-index join run *before* the fallback on every pass, so an index hit (the viewer-wide 90s GraphQL collector seeing a new PR) overrides a fresh negative immediately — the negative TTL bounds staleness only for PRs created by other means (other authors, other machines). A seeded (disk-cache) negative MUST NOT be treated as gh-confirmed — only a negative derived by this process's gh path starts the TTL clock.
- Existing semantics preserved: transient exec/parse errors still keep last-good and write no negative; default-branch authoritative negatives keep their existing shape (they never reach the fallback anyway); the `branchPRObservedTTL`/`branchPRRetainTTL` entry lifecycle is untouched (an aged-out entry deletes the negative mark with it, which is correct).
- **Secondary, in-scope only if cheap** (explicitly optional per the session): `Register`'s wake-on-first-sight (`prstatus_branch.go:658-660`) triggers a full O(pairs) pass for every newly-seen pair; a short settle/coalesce on that wake may be added if it drops in naturally — skipping it does not block this change.
- **Rejected** (record for posterity): treating a viewer-index miss as authoritative "no PR" — the index only covers the viewer's own open PRs inside a recency window, so it cannot distinguish "no PR" from "not covered"; a plain TTL'd negative cache is the correct shape.

### Tests

Go tests for both behaviors (`app/backend`, colocated `*_test.go`; both surfaces have existing test files to extend):

- `app/backend/api/sse_test.go`: a burst of generation bumps within the debounce window produces one derive (one `FetchSessions` call), not N; a bump after the window derives again; a `wake()` during a pending debounce window is not delayed; safety-timer behavior unchanged with no events.
- `app/backend/internal/prstatus/prstatus_branch_test.go`: a gh-confirmed negative suppresses the gh exec on subsequent passes within the TTL; the exec re-runs after the TTL expires; a viewer-index hit overrides a fresh negative immediately; a transient error writes no negative; a seeded negative does not start the TTL clock.

## Affected Memory

- `run-kit/api-and-sockets`: (modify) the SSE hub cadence section (three constants → four; event-driven invalidation now coalesced; wake seam bypass documented)
- `run-kit/architecture`: (modify) the prstatus/BranchRefresher rows — negative-result TTL added to the refresher's resolution ladder

## Impact

- **Backend-only, no frontend changes, no API surface change, no new routes, no config/settings keys.**
- `app/backend/api/sse.go` — debounce constant + coalescing in the hub loop (`waitForNext`/`poll` seam).
- `app/backend/internal/prstatus/prstatus_branch.go` — negative TTL constant + entry field + fallback skip (and optionally a `Register` wake settle).
- `app/backend/api/sse_test.go`, `app/backend/internal/prstatus/prstatus_branch_test.go` — extended.
- Behavior visible to users: event-driven dashboard updates arrive up to ~300ms later (bounded, deliberate); host-global gh subprocess load drops from O(worktree-count) per 30s to near-zero steady-state; non-viewer-authored PRs on previously PR-less branches may take up to ~10min to appear (viewer-authored ones still land via the 90s collector/index join).
- Constitution fit: II (bounded in-memory derived state, never authoritative; degrades to cold-start behavior when absent), and the existing prstatus TTL-cache pattern.

## Open Questions

- None — the diagnostic session resolved every decision point (window value, TTL value, no-knob constraint, wake bypass, scope exclusions, rejected alternatives); no would-be questions remained to defer.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Debounce window is a single unexported constant of 300ms in `api/sse.go`; no config knob or env var | User specified "say, 300ms" within the agreed 250–500ms band; project convention: internal constants, prefs only in `internal/settings` when user-facing | S:90 R:90 A:95 D:90 |
| 2 | Certain | Negative branch-PR cache TTL is a single unexported constant of 10 minutes in `prstatus_branch.go`, alongside the existing TTL constants | User agreed ~10 minutes; mirrors `branchDefaultBranchTTL`/`branchOriginTTL` pattern exactly | S:85 R:90 A:95 D:85 |
| 3 | Certain | Backend-only Go change; tests extend the existing colocated `api/sse_test.go` and `internal/prstatus/prstatus_branch_test.go` | Both surfaces verified to have test files; code-quality.md mandates tests for changed behavior | S:90 R:85 A:95 D:90 |
| 4 | Certain | 12s/2.5s safety-timer and 500ms `sseCacheTTL` semantics unchanged; the debounce sits only between bump observation and cache invalidation | Explicit in the session ("safety-timer behavior and the 500ms cache TTL semantics stay") | S:90 R:85 A:90 D:90 |
| 5 | Certain | `internal/snapshot` Snapshotter and `capturePreviews` are not modified; Snapshotter needs no debounce extension | Verified at intake: Snapshotter already coalesces the same generation counter (2s stability tick + 15s maxHold, `snapshotter.go:12-36`); capturePreviews benefits indirectly from fewer ticks | S:70 R:85 A:90 D:80 |
| 6 | Confident | Trailing-edge coalescing: on a subscriber generation bump, wait the window (absorbing further bumps) before deriving; exact mechanism/placement is apply's decide-and-record | User explicitly chose "do not derive immediately; wait a short coalescing window"; multiple valid implementations with clear seams (`waitForNext`/`poll`) | S:80 R:75 A:80 D:75 |
| 7 | Confident | Explicit `wake()` signals bypass the debounce; only control-mode generation bumps are coalesced | Wake seam exists precisely for sub-second post-mutation repaint (memory: api-and-sockets § wake seam; row-color latency lesson); delaying it would regress a shipped fix | S:65 R:75 A:90 D:80 |
| 8 | Confident | Negative cache lives on the existing `branchEntry` (confirmation timestamp), consulted only at the gh-fallback step; exclusion + index join keep running first every pass and override immediately; seeded negatives never start the TTL clock | Session agreed the shape ("index join can override a negative entry immediately; TTL bounds worst-case staleness"); seed handling follows the existing `seeded` discipline in the pass | S:75 R:80 A:85 D:75 |
| 9 | Confident | `Register` wake-on-first-sight settle/coalesce is optional — include only if cheap; skipping does not block the change | Session marked it "secondary, in-scope if cheap"; apply holds the latitude | S:70 R:85 A:70 D:60 |
| 10 | Confident | Change type is `fix` (repairing performance defects; no new capability, no refactor of structure) | Both defects produce concrete user-visible degradation; taxonomy has no perf type — fix is the closest match and the session predicted "fix or perf-shaped" | S:70 R:90 A:80 D:70 |

10 assumptions (5 certain, 5 confident, 0 tentative, 0 unresolved).

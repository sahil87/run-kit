# Intake: Pane-Map Join by Pane ID

**Change**: 260713-d07t-pane-map-join-by-pane-id
**Created**: 2026-07-13

## Origin

> Fix StatusDot lagging window swaps: re-key the fab pane-map enrichment join by stable pane ID instead of session:window_index in sessions.go

Conversational mode. This intake follows a full root-cause investigation in the same session:

- The user observed that after swapping sidebar windows, the row's StatusDot sometimes stays at the old *position* and only corrects after a delay ("clearly it is keyed against position, not windowId").
- Investigation confirmed the frontend is fully windowId-keyed end to end (window-store entries `${server}:${windowId}`, `useMergedSessions` joins by `windowId`, WindowRow React key = `windowId`). The positional coupling is backend-only: `FetchSessions` joins a **5-second-cached** `fab pane map` (whose entries identify a window only by `(session, window_index)`) against a **fresh** tmux snapshot by `session:index` (sessions.go:637). After a `swap-window` (window IDs travel, indices swap), every SSE tick inside the stale-TTL window attributes window A's `FabChange/FabStage/FabDisplayState` to whichever window now sits at A's old index. `statusDotState` gates on `fabChange` first, so the whole dot appearance flips.
- Two fix options were discussed: (a) add `window_id` to fab's `pane map --json` output (easy, additive, but requires a fab-kit release plus an rk fallback for older fabs), or (b) fix entirely rk-side by joining on the **stable tmux pane ID**, which fab already emits (`"pane": "%N"`), rk already decodes (`paneMapEntry.Pane`, sessions.go:81), and rk's fresh snapshot already carries (`PaneInfo.PaneID`, populated via `#{pane_id}` in the list-panes format, tmux.go:675).
- **User decision**: ignore the fab-side fix; fix it within rk itself (option b).

## Why

1. **Problem**: For up to ~5 seconds after a window reorder (sidebar drag, tmux-side `swap-window`, or cross-session move), the sidebar StatusDot — and every other consumer of the fab-tier fields — shows the *wrong window's* fab pipeline status. The dot appears glued to the list position rather than the window. The optimistic frontend reorder is correct for one paint, then the mis-joined SSE ticks revert it until the pane-map cache expires.
2. **Consequence if unfixed**: the status pyramid's fab tier (hue/shape of the dot, purple-PR ownership) lies after every reorder. Users watching multiple agent windows act on the wrong signal (e.g. "review failed" shown on a healthy window). Trust in the dot erodes exactly in the multi-window workflows it exists for.
3. **Why this approach**: the stale pane map is only positionally keyed; both sides already possess a stable shared key — the tmux pane ID, which travels with its window across swap/move exactly like the window ID. Re-keying the join by pane ID makes cache staleness harmless for *identity* (an entry can only ever attach to the window that actually contains its pane) with zero fab-kit changes, zero version skew, and no new subprocess or cache semantics. The alternative (fab emits `window_id`) was explicitly rejected by the user as unnecessary; it would also still require an index-join fallback in rk for older fab versions, leaving two join paths to maintain.

## What Changes

All changes are in `app/backend/internal/sessions/sessions.go` and its test file. No API-surface, frontend, or fab-kit changes.

### 1. Re-key the fetched pane map by stable pane ID (`dedupEntries` → pane-ID map)

`dedupEntries` (sessions.go:158) currently collapses entries to one per window using the positional key `fmt.Sprintf("%s:%d", e.Session, e.WindowIndex)` and prefers the change-bound pane. Replace it: the fetch-time map is keyed by **pane ID** (`e.Pane`, e.g. `"%12"`), one entry per pane, **no window-level dedup at fetch time** — window membership is only knowable against a fresh snapshot, so the change-bound preference moves to the join (change area 2).

Fallback for robustness: an entry with an empty `Pane` field (hypothetical older fab JSON) keeps the legacy `session:windowIndex` key in the same map (the two key shapes cannot collide: pane IDs start with `%`).

```go
// keyed by pane ID ("%12"); entries with no pane ID fall back to the
// legacy positional "session:windowIndex" key (shapes cannot collide).
func keyPaneEntries(entries []paneMapEntry) map[string]paneMapEntry
```

(Exact name/shape at implementer's discretion; the contract is: stable-key map, no fetch-time window dedup, legacy-key fallback for empty `Pane`.)

### 2. Join by fresh pane membership (`FetchSessions` enrichment loop)

Replace the positional `indexKey` join (sessions.go:634-642) with membership-based attribution: for each window in the **fresh** snapshot, iterate `sd.windows[j].Panes`, look up each pane's `PaneID` in the map, and collect candidates. Selection among multiple candidate panes of one window preserves today's dedup semantics exactly: **change-bound entry wins; otherwise first-seen** (pane order within the window). If no pane-ID candidate matched, try the legacy `session:index` key once (covers the empty-`Pane` fallback entries). The result still lands in `enrichByWindowID[windowID]` feeding the existing fab-field assignment (sessions.go:650-654) unchanged.

Rewrite the now-incorrect comment block (sessions.go:627-633): the current text claims the WindowID re-key "means a reorder can never misattribute", which is false across the cache boundary. The new comment must state the actual invariant: the pane ID is the stable join key, so a stale cached map can never misattribute enrichment across a reorder/move — at worst a pane absent from the fresh snapshot contributes nothing.

### 3. Tests (`sessions_test.go`)

- **New regression test (the bug)**: build a pane map captured pre-swap (two windows, distinct changes, keyed by pane ID), a fresh snapshot where the two windows' *indices* are swapped but panes/windowIds travel — assert each window's `FabChange/FabStage/FabDisplayState` follows its windowId, not its index. This test MUST fail against the old positional join.
- **New fallback test**: an entry with empty `Pane` still enriches via the legacy positional key.
- **Update inline join replicas**: `TestPaneMapJoinPopulatesPerWindowFabFields` (sessions_test.go:160) and `TestPaneMapJoinPopulatesDisplayState` (:319) replicate the old `indexKey` join inline — update to exercise the new join helper (prefer extracting the join into a testable function over inline replication).
- **Update dedup tests**: `TestPaneMapDedupFirstSeenWhenNeitherChangeBound` (:483) and `TestPaneMapDedupChangeWins` (:499) assert fetch-time dedup; rework them to assert the same *selection semantics* at the join (change-bound > first-seen among one window's panes).

### Out of scope

- fab-kit `window_id` output field (explicitly rejected — rk-side fix only).
- The frontend `setWindowsForSession` optimistic-index stomp (an SSE tick between the optimistic reorder and tmux completing can briefly revert row *order*; distinct, much smaller seam — not touched here).
- Pane-map cache semantics: the 5s TTL and stale-on-error preservation stay unchanged.

## Affected Memory

- `run-kit/architecture`: (modify) update the "tmux/sessions enrichment" description — pane-map join is keyed by stable pane ID with join-time change-bound selection (positional join removed; identity immune to reorder under cache staleness)

## Impact

- `app/backend/internal/sessions/sessions.go` — `dedupEntries` (re-shaped), the `FetchSessions` enrichment join block, comment corrections. ~40 lines.
- `app/backend/internal/sessions/sessions_test.go` — 2 new tests, 4 reworked tests.
- No frontend, API, SSE-contract, or fab-kit changes; `paneMapEntry` JSON decoding unchanged (the `Pane` field is already parsed).
- Verification: `cd app/backend && go test ./internal/sessions/` then `just test-backend`.
- Behavior visible to users: after any window swap/reorder/move, the sidebar StatusDot (and PANE panel fab register) stays attached to the correct window on every SSE tick; residual ≤5s staleness of the *data itself* (e.g. a stage advancing) is unchanged and acceptable.

## Open Questions

- None — the approach, key choice, and scope were resolved in the originating conversation.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix lives entirely rk-side; no fab-kit change | Discussed — user explicitly chose "ignore the fab side fix. It can be fixed within rk itself" | S:95 R:90 A:95 D:95 |
| 2 | Certain | Join key = stable tmux pane ID: fab's `pane` JSON field (already decoded as `paneMapEntry.Pane`) matched against fresh `PaneInfo.PaneID` | Discussed and verified in-session: fab emits `#{pane_id}` (panemap.go:171), rk snapshot populates PaneID (tmux.go:675); pane IDs travel with windows across swap/move | S:90 R:85 A:95 D:90 |
| 3 | Confident | Change-bound-pane preference moves from fetch-time index-grouping to join-time fresh-membership grouping (change-bound > first-seen) | Preserves existing dedup semantics (TestPaneMapDedupChangeWins) while making window membership authoritative at join time; no alternative preserves both | S:70 R:75 A:85 D:75 |
| 4 | Confident | Entries with empty `Pane` fall back to the legacy `session:windowIndex` key | Cheap one-branch compat with hypothetical older fab JSON; key shapes cannot collide (`%` prefix). Skipping such entries was the alternative — fallback is strictly safer | S:55 R:85 A:75 D:65 |
| 5 | Confident | 5s pane-map cache TTL and stale-on-error preservation unchanged | Bug is identity misattribution, not data staleness; TTL exists to avoid a subprocess per SSE tick and is orthogonal to the join key | S:60 R:90 A:80 D:70 |
| 6 | Certain | Regression test simulating the swap (stale map + swapped fresh snapshot) plus fallback test are required | code-quality.md: bug fixes MUST include tests covering the changed behavior; the swap test is the bug's reproduction | S:80 R:90 A:95 D:90 |

6 assumptions (3 certain, 3 confident, 0 tentative, 0 unresolved).

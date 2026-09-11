# Intake: Operator Tasks tab lists every tracked item, not only pane-bearing workers

**Change**: 260911-xy8b-operator-tasks-lists-all-tracked-items
**Created**: 2026-09-11

## Origin

Conversational — a `/fab-discuss` session with the user on 2026-09-11 established the problem, the root cause and the decisions below; this intake was then created by a promptless dispatch (`{questioning-mode} = promptless-defer`). No questions were asked; every decision the user made is a Certain row in § Assumptions with rationale `Discussed — user decided`, every default the assistant recommended and the user accepted is Confident.

> **Title**: Operator Tasks tab lists every tracked item, not only pane-bearing workers.
>
> **Problem**: The fab operator on the `rK` tmux server reports it is tracking 5 items, but the Quake console's `Operator Tasks` segment shows `No watched workers`. The operator state file `$XDG_STATE_HOME/fab/operator/tmp-tmux--1001-rK.yaml` (fab-kit 2.25 `tracked:` list) holds five items, all `kind: note` with no `scope.pane` (their scope has only `refs:` — change IDs / branch names — plus `text`, `paused`, `done_at`, `added_at`, `updated_at`). The reader `app/backend/internal/cron/watchlist.go` (`parseTrackedItems`) drops every item without a `scope.pane` and every item with `done_at` set; surviving entries are joined by pane ID onto tmux windows in `app/backend/internal/sessions/sessions.go`, setting `monitored: true` on the sessions payload; `collectWatchedRows` in `app/frontend/src/components/server-watched-zone/model.ts` then renders one row per `monitored` window through the shared `WatchedTable`, and `WatchedTasks` is that table in the console. So the tab can only ever show workers the operator is sitting on a pane for; notes, queued fab-changes, github-pr probes and shell probes are invisible by construction. A tab named Operator Tasks must show everything the operator tracks.
>
> **Decisions (user)**: (1) the Operator Tasks segment — desktop quake drawer and mobile `?tab=tasks` — lists EVERY item in the operator's `tracked:` list, pane-bearing and pane-less, any kind, and its count matches what the operator reports as tracked; (2) widening rk's tolerant read of fab's private state file to surface note text and other item fields is accepted, DISPLAY-ONLY, rk never writes the file; (3) done-but-unacked items are shown dimmed, not hidden; paused items stay shown, marked paused.
>
> **Boundaries**: the pane-keyed `monitored` join stays exactly as it is (sidebar underbar, `opr` register, Server page WATCHED zone); backend adds a server-scoped tracked-items list to the sessions payload; frontend renders two row species in the Tasks segment; empty-state hint `No watched workers` → `No tracked items`; memory + `docs/specs/cron.md` updated; Go/Vitest/Playwright tests; no fab-kit change, no new state-file fields, no row actions. Rejected: renaming the tab to "Watched Workers" and leaving it workers-only.

Ground truth verified in this worktree while drafting (quoted in § What Changes):

- `app/backend/internal/cron/watchlist.go` — `ParseWatchlist(data) ([]WatchlistEntry, lastTickAt int64, ok bool)`; `parseTrackedItems` skips `id == ""`, `done_at != nil`, non-map `scope`, `pane == ""`; `WatchlistEntry{ChangeID, Pane, Repo, Session, Stage, Agent, Branch, Kind}`; `parseTickAt` already accepts unix seconds (number/string), RFC3339 strings and `time.Time`; `ReadWatchlist(path)` wraps it. Tests: `watchlist_test.go` `TestParseWatchlist` (17 table cases), `TestReadWatchlistTrackedRoundTrip`, `TestReadWatchlistAbsentAndCorrupt`, `TestReadWatchlistRoundTrip`.
- `app/backend/internal/sessions/sessions.go:672-693` — one `cron.ReadWatchlist` per `FetchSessions`, `watchlistByPane` map, `operatorLastTickAt`; `:702-704` `joinWatchlist(sd.windows, watchlistByPane)`; `:172-192` `joinWatchlist` sets `Monitored`/`MonitoredChange`/`MonitoredStage`/`MonitoredRepo`/`MonitoredBranch`/`MonitoredAgent`. `ProjectSession` (`:95-102`) carries `OperatorLastTickAt int64 json:"operatorLastTickAt,omitempty"` and `OperatorStale bool json:"operatorStale,omitempty"`, "populated identically on every session of one FetchSessions call". Tests: `sessions_test.go` `TestJoinWatchlist` (:781), `TestOperatorStaleness` (:812), `TestProjectSessionOperatorStalenessJSON` (:832), `TestFetchSessionsWatchlistSlug` (:906).
- `app/backend/internal/tmux/tmux.go:851-861` — the `Monitored*` fields on `WindowInfo`, camelCase `omitempty`.
- `app/frontend/src/types.ts:95-111` `ProjectSession.operatorLastTickAt?/operatorStale?`; `:234-245` `WindowInfo.monitored?/monitoredChange?/…`.
- `app/frontend/src/components/server-watched-zone/model.ts` — `collectWatchedRows(sessions): {session, win}[]` (monitored, non-ghost, session order then window index) and `watchlistStatus(sessions, nowSeconds): {stale, tickAgeSeconds, hasOperator}`; `watched-zone.tsx` (Server page WATCHED zone) and `watched-tasks.tsx` (console segment) both consume them; `watched-table.tsx` `WatchedTable({rows, stale, nowSeconds, onNavigate, dense})` renders six columns status · session · change · awaiting · note · repo with `data-testid="watched-table"` / `watched-row` / `watched-row-navigate`.
- `app/frontend/src/components/watched-tasks.tsx` — hint ladder `no server resolved — watchlist unavailable` / `No operator on this server` / `No watched workers`; `data-testid="watched-tasks"`, `watched-tasks-banner`, `watched-tasks-hint`. Mounted by `operator-console.tsx:806` (`dense`, `onNavigate` navigates to `/$server/$window` with `search: {}` then `setConsoleMachineState("rest")`) and `app.tsx:5467` (mobile `tab=tasks` slot, `onNavigate={navigateToWindow}`).
- Frontend unit tests: `watched-tasks.test.tsx` (7 cases incl. `an operator with zero monitored windows renders 'No watched workers'`), `server-watched-zone/watched-zone.test.tsx` (8 cases incl. the `No watched workers` / `No operator on this server` empty states), `watched-table.test.tsx`; fixtures `makeSession`/`makeWindow` in `src/test-utils/fixtures.ts`.
- Playwright `app/frontend/tests/e2e/operator-console.spec.ts` — `sessionsPayload(withOperator, operatorState, watched)` (`:63-110`) seeds a `monitored: true` window `@2` `watched-worker` (`wuiu` · `review` · `/home/user/code/run-kit`, pane `%2`) plus `operatorLastTickAt: NOW - 60`; the two Tasks cases at `:690` (`toHaveCount(1)` rows, row click navigates to `/default/2` and the drawer is gone) and `:734` (`?tab=tasks` deep link).
- The live state file `tmp-tmux--1001-rK.yaml` (2026-09-11 16:32Z, `tick_count: 885`): `tracked:` holds five `kind: note` items `n1`, `n3`, `n4`, `n5`, `n6`, each `probe: {mode: none}`, `check_every: null`, `done_when: null`, `then: null`, `depends_on: []`, `scope: {refs: [<change ids / worktree names>]}`, `last: {}`, `text: '<up to 500 chars>'`, `checked_at: null`, `unchanged: 0`, `failures: 0`, `paused: false`, `done_at: null`, `added_at: "2026-09-03T06:19:19Z"`, `updated_at: "2026-09-03T09:57:08Z"`; top-level `branch_map`, `last_full_at`, `last_tick_at`, `tick_count`. Zero items carry a `scope.pane`.
- fab-operator skill § Tracked Items (deployed `.agents/skills/fab-operator/SKILL.md`): kinds `fab-change | github-pr | linear | slack | shell | task | note`; `note` = "Free prose (500-char cap)"; `scope` is "kind-specific metadata, opaque to the probe runner" (`fab-change`: `pane, repo, session, branch, stage, stop_stage, spawned_by, merge_mode`; `github-pr`: `{repo, pr}`; `linear`: `{repo, stop_stage}` + top-level `seen`); lifecycle `held | pending | live | watching | stale | paused | done`.
- Prior decisions being superseded in part: `260911-2281-console-tasks-segment-watchlist` intake § Non-goals — "no read of the operator's notes/pending escalations (still the Extension Map item in routes-and-shell § Clock Dashboard Zones)"; `docs/memory/run-kit/cron.md:729` Design Decision "Watched means pane-bearing and not done; `tracked` wins by key presence" (`260911-owgh-watchlist-reader-tracked-list`); `docs/memory/run-kit/ui/routes-and-shell.md:127` Extension Map — "Pending escalations — … needs a new read of the fab operator state file's notes".

## Why

**The problem.** The console's `Operator Tasks` segment is the operator's task list on both form factors, yet it renders exactly the set of windows the pane-keyed watchlist join marks `monitored`. That set is, by the owgh Design Decision, "pane-bearing and not done" — correct for the question the sidebar underbar and the Server page WATCHED zone ask ("is the operator sitting on this pane?"), wrong for a tab named Operator Tasks. On the `rK` server the operator tracks five notes — running ledgers of multi-phase plans ("Phase 2 running: 3 stress worktrees…", "A=71yx PR #834 still open … archive once merged", "C6 conditional on C5 verdict") — none with a pane, so the tab says `No watched workers` while `fab operator track list` says five. A queued `fab-change` (pane still null), a `github-pr` merge probe, a `shell` deploy probe or a held `task` would be equally invisible. The user's position, recorded in discussion: a tab called Operator Tasks must show everything the operator tracks, and the number it shows must match what the operator itself reports.

**If we don't fix it.** The operator's durable work set is one `tracked:` list; rk shows a filtered projection of it under a label that promises the whole. Every time the operator's work is mostly notes, queued changes or PR probes — the normal state between spawn bursts — the tab reads as "nothing is happening", which is worse than an empty state because it is wrong. The Extension Map item in routes-and-shell ("Pending escalations … needs a new read of the fab operator state file's notes") has been the recorded next step since 1rx0; the tab shipped in 2281 explicitly deferred it as a non-goal. This change is that read.

**Why this approach.** The reader is the single seam and already parses every item; it merely discards the ones it cannot join. Returning the full item list (with a `Done` fact instead of a filter) and deriving the pane join from it keeps the `monitored` contract byte-identical while giving the frontend the whole list. Riding the sessions payload — the way `operatorLastTickAt`/`operatorStale` already ride it, stamped identically on every session of a server — means the Tasks segment stays a pure projection over data the frontend already holds on the SSE cadence: no new route, no polling (`fab/project/code-quality.md` § Anti-Patterns), no second clock. The read stays in the class the cron spec fixes for this file (upt2, Constitution X, CLI-layering spec): fab-owned schema read tolerantly for DISPLAY only, unknown keys ignored, absent/corrupt ⇒ empty, never an error, never a fire/control input, never written by rk. Rejected in discussion: renaming the tab to "Watched Workers" and leaving it workers-only (the user wants the task list); a separate `GET /api/operator/tracked` endpoint (acceptable if the payload bloated — it does not: fab caps note text at 500 chars and the tracked set is a handful of items; the sessions payload already carries every pane of every window, and the state-socket hub dedups unchanged snapshots).

## What Changes

### 1. `internal/cron/watchlist.go` — the reader returns every tracked item; the watchlist join derives from it

**Today** the file exposes `WatchlistEntry`, `ParseWatchlist(data) ([]WatchlistEntry, lastTickAt int64, ok bool)` and `ReadWatchlist(path) ([]WatchlistEntry, lastTickAt int64, present bool)`; `parseTrackedItems` filters (`id != ""`, `done_at == nil`, map `scope`, `pane != ""`) and `parseMonitoredMap` is the legacy arm.

**Target.** One parse, two projections:

```go
// TrackedItem is one item of the fab operator state file's tracked: list,
// read tolerantly for display — every kind, pane-bearing or not, done or
// not. The watchlist join consumes only the pane-bearing, not-done subset
// (WatchlistEntries); the sessions payload's operatorTracked list carries
// all of them.
type TrackedItem struct {
	ID        string   // tracked item id (fab-change: the change ID; other kinds: a slug) / the legacy monitored map's key
	Kind      string   // fab-change | github-pr | linear | slack | shell | task | note | (future); "" for a legacy monitored: entry
	Text      string   // note prose (fab caps it at 500 chars); "" for other kinds unless the item carries text
	Refs      []string // scope.refs — change ids / branch or worktree names the item is about; nil when absent
	Pane      string   // scope.pane ("%N") — the join key; "" for pane-less items
	Repo      string   // scope.repo
	Session   string   // scope.session
	Stage     string   // scope.stage
	Agent     string   // scope.agent
	Branch    string   // scope.branch
	Paused    bool     // paused
	DoneAt    int64    // done_at as unix seconds; 0 = not done (the item is still live in the operator's set)
	AddedAt   int64    // added_at as unix seconds; 0 when absent
	UpdatedAt int64    // updated_at as unix seconds; 0 when absent
}

// OperatorState is the tolerant read of one operator state file.
type OperatorState struct {
	Items      []TrackedItem // tracked: list order (fab's insertion order); legacy monitored: map entries sorted by key
	LastTickAt int64
}

// WatchlistEntries is the pane join's input: every item with a non-empty
// Pane and DoneAt == 0 (paused and kind do not filter), sorted by ID —
// exactly today's ParseWatchlist entry set.
func (s OperatorState) WatchlistEntries() []WatchlistEntry

func ParseOperatorState(data []byte) (state OperatorState, ok bool)
func ReadOperatorState(path string) (state OperatorState, present bool)
```

Rules for `ParseOperatorState`'s `tracked:` arm (`parseTrackedItems` now returns `[]TrackedItem` and stops filtering on pane/done):

- Same tolerant skeleton: a non-list `tracked:` yields no items; a non-map element or an empty/non-string `id` is skipped (malformed — never fatal). A missing or non-map `scope` is NO LONGER a skip: a note's scope is `{refs: [...]}` and a `task` item may have no scope at all — the item is kept with empty scope fields.
- `Text = strField(item, "text")`; `Refs` from `scope["refs"].([]any)`, string elements only, non-string elements skipped, absent/empty ⇒ `nil`.
- `Paused = item["paused"] == true` (a non-bool reads as false).
- `DoneAt = parseTickAt(item["done_at"])`, likewise `AddedAt`/`UpdatedAt` — `parseTickAt` already accepts unix seconds (number/string), RFC3339 strings and yaml.v3's decoded `time.Time`; `null`/absent ⇒ 0. A `done_at` that is non-nil but unparseable (a bare word) decodes to 0 — the item then reads as live; this is the tolerant-read posture (the binary writes RFC3339 and nothing else), record it in a test.
- `Kind = strField(item, "kind")`; `Pane`/`Repo`/`Session`/`Stage`/`Agent`/`Branch` from `scope` as today (`strField` returns `""` for `null`).
- Item order is the list's order (no sort) — fab's `tracked:` is the operator's ledger, top-down; `WatchlistEntries()` sorts its subset by ID, preserving today's determinism for the join.
- Extra keys (`probe`, `check_every`, `done_when`, `then`, `depends_on`, `last`, `checked_at`, `unchanged`, `failures`, `seen`, scope's `stop_stage`/`spawned_by`/`merge_mode`/`pr`) stay ignored; top-level `branch_map`, `last_full_at`, `tick_count` likewise.

Legacy arm (`parseMonitoredMap`, read only when the `tracked` key is absent — unchanged rule): each map entry becomes a `TrackedItem{ID: key, Kind: "", Pane, Repo, Session, Stage, Agent, Branch}` (all legacy entries are pane-bearing and never done, so they are worker rows in the task list too); entries sorted by key. The both-present rule (`tracked` wins by key presence, even as `[]`) is unchanged. Backlog `[w3tk]` still retires this arm one release later — that item's text needs no edit.

`ParseWatchlist`/`ReadWatchlist` are REMOVED in favour of `ParseOperatorState`/`ReadOperatorState` + `WatchlistEntries()` — `sessions.go` is the only caller (verify with `grep -rn 'ReadWatchlist\|ParseWatchlist' app/backend`). The existing `TestParseWatchlist` table is re-pointed at `ParseOperatorState(...).WatchlistEntries()` so all 17 cases keep proving the join set unchanged; new cases prove the full list (§ 6). The file-header EXTERNAL CONTRACT comment is rewritten: the reader surfaces every tracked item for display, the join takes the pane-bearing not-done subset; keep the `done_at` rationale for the JOIN ("a done-but-unacked item would pin a watched row onto a finished or dead pane") and add the task-list rationale ("a done item stays in the operator's ledger until `track rm`, so the task list shows it dimmed"). Comments state constraints, cite no change IDs or PR numbers.

### 2. `internal/sessions/sessions.go` — `ProjectSession.OperatorTracked`, stamped on every session; the join unchanged

```go
// OperatorTrackedItem is the sessions-payload projection of one tracked item
// (cron.TrackedItem), server-scoped like OperatorLastTickAt/OperatorStale and
// stamped identically on every session of one FetchSessions call. Display
// only: the frontend's Operator Tasks segment lists these; nothing in rk acts
// on them. windowId is the pane's live window when the pane resolves in this
// fetch — the Tasks row's navigation target — and absent for pane-less items
// and for a pane that no window carries (a dead pane).
type OperatorTrackedItem struct {
	ID        string   `json:"id"`
	Kind      string   `json:"kind,omitempty"`
	Text      string   `json:"text,omitempty"`
	Refs      []string `json:"refs,omitempty"`
	Pane      string   `json:"pane,omitempty"`
	WindowID  string   `json:"windowId,omitempty"`
	Repo      string   `json:"repo,omitempty"`
	Session   string   `json:"session,omitempty"`
	Stage     string   `json:"stage,omitempty"`
	Agent     string   `json:"agent,omitempty"`
	Branch    string   `json:"branch,omitempty"`
	Paused    bool     `json:"paused,omitempty"`
	DoneAt    int64    `json:"doneAt,omitempty"`
	AddedAt   int64    `json:"addedAt,omitempty"`
	UpdatedAt int64    `json:"updatedAt,omitempty"`
}

// on ProjectSession, beside OperatorLastTickAt / OperatorStale:
OperatorTracked []OperatorTrackedItem `json:"operatorTracked,omitempty"`
```

In `FetchSessions` (`:672-693`): replace `cron.ReadWatchlist(opPath)` with `state, present := cron.ReadOperatorState(opPath)`; when present, `operatorLastTickAt = state.LastTickAt`, `watchlistByPane` is built from `state.WatchlistEntries()` exactly as today (so `joinWatchlist` and every `Monitored*` field are byte-identical), and `operatorTracked := projectTrackedItems(state.Items, paneToWindow)` where `paneToWindow map[string]string` is built once over all sessions' windows' `Panes[].PaneID → WindowID` (a pure helper beside `joinWatchlist`, unit-tested). Then in the per-session loop, beside `OperatorLastTickAt`/`OperatorStale`: `result[i].OperatorTracked = operatorTracked` (the same slice on every session — the payload marshals it per session; that duplication is the established server-scoped-fact pattern and is bounded: fab caps note text at 500 chars and the tracked set is a handful of items). Absent file ⇒ `nil` ⇒ the key is omitted (`omitempty`), which the frontend reads as "older backend or no operator state" — see § 3's fallback. `joinWatchlist` is untouched; its comment at `:702` stays accurate.

`api-and-sockets` memory's `/api/sessions` row and the state-socket `sessions` snapshot need no code change — `ProjectSession` marshals additively.

### 3. Frontend types + row model — `operatorTracked` on `ProjectSession`; `collectTrackedRows`

`app/frontend/src/types.ts`, beside `operatorLastTickAt?`/`operatorStale?`:

```ts
/** One item of the operator's tracked list (the fab operator state file's
 *  `tracked:` — every kind, pane-bearing or not, done or not), stamped onto
 *  every session of the server like the tick facts. `windowId` is set when
 *  the item's pane resolves to a live window. Display only. Absent on
 *  payloads from an older backend. */
export type OperatorTrackedItem = {
  id: string;
  kind?: string;
  text?: string;
  refs?: string[];
  pane?: string;
  windowId?: string;
  repo?: string;
  session?: string;
  stage?: string;
  agent?: string;
  branch?: string;
  paused?: boolean;
  doneAt?: number;
  addedAt?: number;
  updatedAt?: number;
};
// on ProjectSession:
operatorTracked?: OperatorTrackedItem[];
```

`app/frontend/src/components/server-watched-zone/model.ts` gains (beside `collectWatchedRows`, which is UNCHANGED and keeps serving the Server page WATCHED zone):

```ts
export type TrackedRow =
  | { kind: "worker"; item: OperatorTrackedItem; session: string; win: WindowInfo; done: boolean }
  | { kind: "item";   item: OperatorTrackedItem; done: boolean };

/** The Operator Tasks rows: one per tracked item. A `worker` row is an item
 *  whose `windowId` resolves to a live non-ghost window in `sessions` (its
 *  window facets render through WatchedRow and it navigates); every other
 *  item — pane-less (note / queued fab-change / github-pr / shell / task) or a
 *  pane no window carries — is an `item` row. Order: worker rows first in
 *  session order then window index (the WATCHED zone's order), then item rows
 *  in tracked-list order; within each species live items before done ones.
 *  Returns null when no session carries `operatorTracked` (older backend) so
 *  the caller can fall back to collectWatchedRows. */
export function collectTrackedRows(sessions: ProjectSession[]): TrackedRow[] | null
```

The list is read from the first session carrying `operatorTracked` (identical on all). `done = (item.doneAt ?? 0) > 0`. A worker row's `win` is the window with `windowId === item.windowId`; if the backend set no `windowId` (pane-less or dead pane) or the window is a ghost (`isGhostWindow`), the item is an `item` row. Because `monitored` derives from the same list by pane, a live not-done pane-bearing item is always a `monitored` window and vice-versa — `WatchedRow` keeps reading `win.monitoredChange`/`monitoredStage`/`monitoredRepo` for worker rows; for a DONE pane-bearing item whose window is still live, `monitored` is false on the window (the join excludes done), so the worker row renders change/stage from the ITEM (`item.id`, `item.stage`, `item.repo`) rather than the window facets — `WatchedRow` takes an optional `facets` override for this.

### 4. `WatchedTasks` + `WatchedTable` — two row species, count line, new empty state

`app/frontend/src/components/watched-tasks.tsx`:

- `rows = collectTrackedRows(sessions) ?? collectWatchedRows(sessions).map(worker row)` — the fallback keeps today's rendering against an older backend.
- Hint ladder: `no server resolved — watchlist unavailable` (unchanged) / `No operator on this server` (unchanged) / **`No tracked items`** (replaces `No watched workers` HERE only; the Server page WATCHED zone keeps `No watched workers` — it is the workers view).
- A one-line summary above the table, `data-testid="watched-tasks-summary"`: `{N} tracked · {W} watched` where `N = rows.length` (every item, done included — the number that must match `fab operator track list`) and `W = worker rows that are not done` (the `monitored` count); when `stale`, the existing pinned banner stays above it unchanged. Same `text-xs text-text-secondary font-mono` register as the WATCHED zone side slot.
- The staleness banner, `data-testid`s, `dense` and the `onNavigate` contract are unchanged; mobile (`app.tsx:5467`) and the console (`operator-console.tsx:806`) need no edits beyond the props they already pass.

`app/frontend/src/components/watched-table.tsx` — `WatchedTable` accepts `rows: TrackedRow[]` (the WATCHED zone adapts its `{session, win}[]` into `worker` rows via a tiny mapper in `watched-zone.tsx`; the six-column header is unchanged) and renders per species:

- **`worker`** — today's `WatchedRow` (status/StatusDot + name button navigating on click, session, change · stage badge, awaiting, note, repo). When `done`, the `<tr>` carries `opacity-50` and `data-done="true"`, the change cell appends a `done` marker, and the name button still navigates (the window is live). When `item.paused`, a `paused` marker follows the stage badge.
- **`item`** (new `TrackedItemRow`, `data-testid="tracked-item-row"`) — status cell: a kind chip (`px-1.5 py-0.5 rounded bg-accent/10 text-accent`, the stage-badge treatment, text = `item.kind` or `item` when empty) + the id in `text-text-primary`; session cell: `item.session` or `—`; change cell: `item.refs` joined with `, ` (truncated `max-w-[24ch]` + `Tip` with the full list), or `—`; awaiting cell: `paused` (yellow) / `done` / `—` — for a pane-bearing item whose pane no window carries, `pane gone` in `text-text-secondary`; note cell: `item.text` truncated (`block truncate max-w-[40ch]` in the console's `dense` variant, `24ch` otherwise) wrapped in `Tip label={item.text}` — plus an expand-in-place toggle: the truncated text is a `<button aria-expanded data-testid="tracked-item-expand">`; clicking it (or Enter/Space — a native button) swaps the cell to the full text in `whitespace-pre-wrap` and back; repo cell: `updated {age} ago` from `item.updatedAt` (fallback `added {age} ago`, else `—`) via `formatDuration(nowSeconds - updatedAt)`, with the repo basename + `Tip` prepended when `item.repo` is set. No row navigation — a pane-less item has no terminal; the row is not a button. When `done`, the row is `opacity-50` with `data-done="true"`.
- `stale` still dims the whole table.

The expand toggle is a per-row disclosure of text already on screen (the desktop `Tip` shows the same); it is keyboard-reachable as a native button and is not a palette-registered action — the same footing as the existing row-name navigate button. No other interaction: the watchlist stays read-only, edits are `fab operator track` verbs.

### 5. Docs — spec and memory

- `docs/specs/cron.md` — § UI tier 2 (`~L353-375`, "Operator Tasks renders the operator watchlist through the SAME shared watched-table component … a row click navigates to the worker's terminal") → Operator Tasks renders the operator's whole tracked list (workers as watched-table rows that navigate; pane-less items — notes, queued changes, probes, tasks — as item rows with kind, refs, text, paused/done state; done items dimmed until the operator removes them), the count matching `fab operator track list`; § Watchlist (`~L303-333`) gains a sentence that the same read surfaces every tracked item for the Tasks tab (display only, never a fire input — the upt2 posture); § Requirement: tolerant watchlist read (`~L449-456`) → the reader returns every item (with done/paused/timestamps) and the JOIN takes the pane-bearing not-done subset, scenario extended with a note item that appears on `operatorTracked` and not on any window's `monitored`.
- `docs/memory/run-kit/cron.md` — § Watchlist reader (`:74`) rewritten for `ParseOperatorState`/`ReadOperatorState`/`WatchlistEntries()`; § External Contracts (`:237`) adds the item fields now read (`text`, `scope.refs`, `paused`, `done_at`, `added_at`, `updated_at`); Design Decision "Watched means pane-bearing and not done; `tracked` wins by key presence" (`:729`) amended: the JOIN keeps that meaning, the task LIST shows every item (new four-field DD entry: **Decision** the Operator Tasks list is the whole tracked set incl. done-dimmed; **Why** a tab named Operator Tasks must match what the operator reports, and a done note's text ("archive once merged") stays useful until acked; **Rejected** workers-only + rename to "Watched Workers", a separate tracked endpoint; *Introduced by* this change).
- `docs/memory/run-kit/tmux-sessions.md` § Fab-Tier Derivation (`:572`) — the watchlist tier paragraph gains `ProjectSession.OperatorTracked` (server-scoped, stamped on every session, `windowId` resolved by pane) and the one-read-two-projections shape.
- `docs/memory/run-kit/ui/operator-console.md` — § Requirement: Desktop segments (`:82-90`) and the mobile `tab=tasks` sentence (`:174`): Operator Tasks mounts `WatchedTasks` rendering the tracked list (two row species, `No tracked items`, the count line); Design Decision "Operator Tasks renders the derived watchlist" (`:209`) amended to "the derived tracked list".
- `docs/memory/run-kit/ui/routes-and-shell.md` — § Server Page WATCHED Zone: state explicitly that the zone keeps the workers-only meaning (`collectWatchedRows`, `No watched workers`) while the console lists every item; Extension Map (`:127`) "Pending escalations … needs a new read of the … notes" → the notes read now exists (`operatorTracked`), leaving "pending escalations" as a possible consumer of item text.
- `docs/memory/run-kit/api-and-sockets.md` — the `/api/sessions` row (`:28`) lists the new `operatorTracked` session field.
- `docs/memory/run-kit/ui/cron-console-tabs.md` — no change expected (segment tokens unchanged); verify at hydrate.

### 6. Tests (run only through `just` recipes: `just test-backend`, `just test-frontend`, `just test-e2e "operator-console"`)

**Go — `internal/cron/watchlist_test.go`**: re-point `TestParseWatchlist` at `ParseOperatorState(...).WatchlistEntries()` (every existing case unchanged in expectation). New `TestParseOperatorStateItems` table: (a) a live-file-shaped note item (`kind: note`, `scope: {refs: [y60c, np2w]}`, `text`, `paused: false`, `done_at: null`, RFC3339 `added_at`/`updated_at`) ⇒ one `TrackedItem` with `Text`, `Refs`, `DoneAt == 0`, parsed timestamps, `Pane == ""`, and `WatchlistEntries()` empty; (b) a done pane-bearing item (`done_at: "2026-09-11T10:00:00Z"`) ⇒ in `Items` with `DoneAt > 0`, NOT in `WatchlistEntries()`; (c) a paused pane-bearing item ⇒ `Paused` true and present in both; (d) an item with no `scope` key (a `task`) ⇒ kept with empty scope fields; (e) `refs` with a non-string element ⇒ the string ones only; (f) list order preserved in `Items`, `WatchlistEntries()` sorted by ID; (g) legacy `monitored:` map ⇒ items with `Kind == ""` and panes, sorted by key; (h) malformed elements skipped, sibling kept. `TestReadWatchlist*` round-trips renamed to the new functions.

**Go — `internal/sessions/sessions_test.go`**: `TestJoinWatchlist` unchanged (proves the join contract holds); new `TestProjectTrackedItems` (pane → windowId resolution: pane-bearing item on a live pane gets `WindowID`, dead pane gets none, pane-less gets none; field mapping); extend `TestProjectSessionOperatorStalenessJSON` (or add `TestProjectSessionOperatorTrackedJSON`) proving `operatorTracked` marshals camelCase with `omitempty` and is omitted when nil; `TestFetchSessionsWatchlistSlug`'s fixture file gains a note item and the test asserts it lands on every session's `OperatorTracked` while `Monitored` stays unchanged.

**Vitest — `server-watched-zone/model.test.ts`** (new file if absent; `watched-zone.test.tsx` covers the zone today): `collectTrackedRows` — null when no session carries `operatorTracked`; worker vs item species; ghost window ⇒ item row; done ordering; list order for items. **`watched-tasks.test.tsx`**: `an operator with zero monitored windows renders 'No watched workers'` → `… renders 'No tracked items'` (empty `operatorTracked: []`); new: a note item renders a `tracked-item-row` with kind chip, id, truncated text, refs, `updated … ago`, no navigate button; a done item carries `data-done="true"`; the summary reads `2 tracked · 1 watched`; the expand toggle reveals full text; fallback: payload without `operatorTracked` still renders worker rows from `monitored`. **`watched-zone.test.tsx`**: unchanged expectations (the WATCHED zone keeps `No watched workers`) — prove it still passes with `operatorTracked` present on the session.

**Playwright — `tests/e2e/operator-console.spec.ts`**: `sessionsPayload(..., watched = true)` stamps `operatorTracked: [ {id: "wuiu", kind: "fab-change", pane: "%2", windowId: "@2", repo: "/home/user/code/run-kit", stage: "review", updatedAt: NOW - 120}, {id: "n3", kind: "note", refs: ["bf1l"], text: "Daemon reliability plan — A=71yx PR #834 still open, awaiting user merge — archive once merged.", updatedAt: NOW - 3600} ]` on both sessions (alongside `operatorLastTickAt`). The `:690` case is extended: `watched-row` count 1 AND `tracked-item-row` count 1, the note's kind chip and id visible, its truncated text visible, the summary reads `2 tracked · 1 watched`; clicking the note row's expand toggle reveals the full text and does NOT navigate (URL unchanged, drawer still open); the worker row click still navigates to `/default/2` and collapses the drawer. Its Proves/Steps JSDoc and the file-header comment (which describes the fixture shape) are updated in the same commit (Constitution § Test Intent Comments). The `:734` deep-link case is unchanged. `server-watched-zone.spec.ts` (if the fixture is shared) keeps asserting the zone lists only the worker.

### Non-goals

- No fab-kit change; no new fields in the operator state file; rk never writes it (Constitution X; the cron spec's upt2 decision).
- No row actions (`track rm`/`update`/pause/ack) — edits stay `fab operator track` verbs.
- The `monitored` semantics, `joinWatchlist`, the sidebar watched underbar, the `opr` register line and the Server page WATCHED zone are unchanged — the zone keeps the fleet-of-workers meaning and its `No watched workers` empty state.
- No new route, no polling: `operatorTracked` rides the sessions payload / state-socket `sessions` snapshot.
- Kind-specific rendering beyond the chip (e.g. a `github-pr` item's `scope.pr` as a PR link) — the item row shows id, refs, text; kind-aware enrichment is a follow-up if wanted.

## Affected Memory

- `run-kit/cron`: (modify) § Watchlist reader → `ParseOperatorState`/`ReadOperatorState` + `WatchlistEntries()`; § External Contracts lists the item fields now read; the "Watched means pane-bearing and not done" DD amended to the join only, plus a new DD for the whole-list Tasks tab
- `run-kit/tmux-sessions`: (modify) § Fab-Tier Derivation — the watchlist tier's one-read-two-projections shape and `ProjectSession.OperatorTracked`
- `run-kit/ui/operator-console`: (modify) Desktop segments requirement + mobile `tab=tasks` sentence + the "renders the derived watchlist" DD → the tracked list, two row species, `No tracked items`, the count line
- `run-kit/ui/routes-and-shell`: (modify) § Server Page WATCHED Zone keeps the workers-only meaning; Extension Map item "Pending escalations" updated now that the notes read exists
- `run-kit/api-and-sockets`: (modify) `/api/sessions` row — `operatorTracked` session field

## Impact

- **Backend (Go)**: `app/backend/internal/cron/watchlist.go` (+ `watchlist_test.go`), `app/backend/internal/sessions/sessions.go` (+ `sessions_test.go`); `ProjectSession` gains one additive `omitempty` field; `WatchlistEntry`/`joinWatchlist`/`Monitored*` unchanged. No new route, no subprocess, no new file read (same one read per fetch).
- **Frontend (TS)**: `src/types.ts`, `components/server-watched-zone/model.ts` (+ new model test), `components/watched-table.tsx` (+ test), `components/watched-tasks.tsx` (+ test), `components/server-watched-zone/watched-zone.tsx` (row adapter only), `tests/e2e/operator-console.spec.ts`. `operator-console.tsx` and `app.tsx` mount sites unchanged.
- **Docs**: `docs/specs/cron.md`; the five memory files above.
- **Payload size**: `operatorTracked` duplicated per session; bounded by fab's 500-char note cap × a handful of items; the state-socket hub dedups unchanged snapshots.
- **Compatibility**: older backend ⇒ no `operatorTracked` ⇒ the frontend falls back to today's `monitored`-derived rows; older frontend ignores the new field.

## Open Questions

- None blocking. Whether the Server page WATCHED zone should also list pane-less items is deferred by the user with the default "no, it keeps the worker meaning" (graded Confident below); revisit if the console list proves useful there.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The Operator Tasks segment (desktop drawer + mobile `?tab=tasks`) lists EVERY item in the operator's `tracked:` list — pane-bearing workers and pane-less items of any kind, current and future — and its count matches what `fab operator track list` reports | Discussed — user decided | S:95 R:70 A:90 D:95 |
| 2 | Certain | Widening rk's tolerant read of fab's private state file to surface note text and item fields is accepted; it stays DISPLAY-ONLY (never a fire/control input — cron spec upt2, Constitution X, CLI-layering), rk never writes the file | Discussed — user decided; memory's Extension Map already anticipated the notes read | S:95 R:75 A:95 D:95 |
| 3 | Certain | Done-but-unacked items (`done_at` set) are shown dimmed, not hidden; paused items stay shown with a `paused` marker | Discussed — user decided ("archive once merged" notes stay useful until acked) | S:95 R:85 A:90 D:90 |
| 4 | Certain | The pane-keyed join is unchanged: a window is `monitored` iff a NOT-done pane-bearing tracked item targets it; sidebar underbar, `opr` register and the Server page WATCHED zone keep the fleet-of-workers meaning | Discussed — user decided; `joinWatchlist` and `WatchlistEntries()` reproduce today's entry set exactly | S:90 R:80 A:95 D:95 |
| 5 | Certain | No fab-kit change, no new state-file fields, no row actions (edits remain `fab operator track` verbs); the watchlist stays read-only | Discussed — user decided; matches the 2281/owgh posture | S:90 R:90 A:95 D:95 |
| 6 | Certain | Tests run only through `just` recipes; every touched Playwright `test()` carries the Proves/Steps JSDoc and the spec's file-header fixture description is updated in the same commit | Constitution § Test Intent Comments; `fab/project/context.md` § Testing | S:85 R:95 A:100 D:100 |
| 7 | Certain | The reader is reshaped as one parse, two projections: `ParseOperatorState`/`ReadOperatorState` return every item as `TrackedItem{…, Paused, DoneAt, AddedAt, UpdatedAt}` in list order; `OperatorState.WatchlistEntries()` yields the pane-bearing not-done subset sorted by ID; `ParseWatchlist`/`ReadWatchlist` are removed (single caller) | Discussed — assistant recommended "reader returns done items too (with a Done flag)"; the existing 17-case table re-pointed at `WatchlistEntries()` proves the join set unchanged | S:80 R:80 A:85 D:75 |
| 8 | Confident | The tracked list rides the sessions payload as `ProjectSession.OperatorTracked []OperatorTrackedItem` (`json:"operatorTracked,omitempty"`), stamped identically on every session like `operatorLastTickAt`/`operatorStale`, with `windowId` resolved server-side by pane; no separate endpoint | Discussed — "prefer riding the sessions payload unless it bloats it"; bounded by fab's 500-char note cap × a handful of items; the hub dedups unchanged snapshots; a dedicated `GET /api/operator/tracked` is the recorded fallback if a measured snapshot proves too large | S:75 R:80 A:75 D:65 |
| 9 | Confident | Two row species in ONE six-column table: `worker` rows (today's `WatchedRow`, navigate on click, done ⇒ dimmed + `done` marker) and `item` rows (kind chip + id, refs, paused/done/`pane gone`, truncated text with `Tip` + expand-in-place toggle, `updated … ago`); item rows do not navigate | Discussed — assistant's default "no navigation; expand-in-place acceptable" accepted; one table keeps the header and the shared component; `Tip` alone fails on touch, so the toggle serves mobile | S:75 R:85 A:80 D:65 |
| 10 | Confident | Ordering: worker rows first (session order, window index — the WATCHED zone's order), then item rows in `tracked:` list order; within each species live before done | Discussed — "workers first then notes, or by updated_at — deferred, pick a sensible default and record it"; the list order is the operator's own ledger order | S:60 R:95 A:75 D:60 |
| 11 | Certain | `WatchedTasks` empty state becomes `No tracked items` (only when the list is genuinely empty); `No operator on this server` and the `no server resolved` hint unchanged; the WATCHED zone keeps `No watched workers` | Discussed — user-implied wording ("something like `No tracked items`") | S:85 R:95 A:90 D:85 |
| 12 | Confident | A one-line summary `{N} tracked · {W} watched` above the table carries the count that must match the operator's report | Derived from decision 1 ("the count the tab shows must match"); mirrors the WATCHED zone's `{N} watched · tick …` side slot | S:65 R:95 A:80 D:70 |
| 13 | Certain | Older-backend fallback: when no session carries `operatorTracked`, `WatchedTasks` renders today's `monitored`-derived worker rows; `collectWatchedRows` stays for the WATCHED zone | Additive-payload convention (`types.ts` "absent on payloads from an older backend"); cheap and keeps the two zones from sharing a derivation they should not | S:70 R:95 A:90 D:85 |
| 14 | Confident | The Server page WATCHED zone does NOT gain pane-less rows in this change — default "no, it keeps its worker meaning" | Discussed — user deferred the question; the assistant's default was accepted as the working assumption; trivially revisitable (the zone would adopt `collectTrackedRows`) | S:45 R:90 A:70 D:60 |
| 15 | Certain | Memory and spec updates land in `run-kit/cron`, `run-kit/tmux-sessions`, `run-kit/ui/operator-console`, `run-kit/ui/routes-and-shell`, `run-kit/api-and-sockets` and `docs/specs/cron.md` (Operator Tasks wording + reader requirement); the owgh DD is amended to the join only, with a new DD for the whole-list tab | Discussed — the user listed the files; the DD amendment follows the FKF four-field shape | S:85 R:95 A:90 D:85 |
| 16 | Certain | `change_type` is `feat` — this widens the tab's contract (a recorded non-goal of 2281 becomes the behavior), not a defect in the shipped reader | `fab status refresh` keyword inference; the owgh fix already made the reader correct for its documented meaning | S:70 R:95 A:85 D:75 |

16 assumptions (11 certain, 5 confident, 0 tentative, 0 unresolved).

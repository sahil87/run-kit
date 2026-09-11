# Intake: Read the fab operator watchlist from the 2.25 `tracked:` list — the Operator Tasks tab, WATCHED zone and watched-row underbar are empty on every server

**Change**: 260911-owgh-watchlist-reader-tracked-list
**Created**: 2026-09-11

## Origin

One-shot — a promptless dispatch (`/fab-proceed` create-new, `{questioning-mode} = promptless-defer`) carrying a fully-specified fix description verified live on 2026-09-11. No questions were asked; every recommendation in the description is graded in § Assumptions.

> Read the fab operator watchlist from the 2.25 `tracked:` list — the Operator Tasks tab, WATCHED zone and watched-row underbar are empty on every server.
>
> rk derives each window's `monitored` flag (and `monitoredChange/Stage/Repo/Branch/Agent`) by reading the fab-owned operator state file `$XDG_STATE_HOME/fab/operator/<fab-slug>.yaml` through `app/backend/internal/cron/watchlist.go` `ParseWatchlist`, which parses ONLY the top-level `monitored:` map. fab-kit 2.25.0 (installed: 2.25.1; rk adopted the kit in PR #936) migrated that file to a single `tracked:` LIST of generic items and removes the legacy keys `monitored`/`watches`/`autopilot`/`notes`/`notes_seq` on first touch. Consequence: `ParseWatchlist` returns zero entries for every current file, so `sessions.go`'s `joinWatchlist` marks no window monitored — the console `Operator Tasks` segment, the Server page WATCHED zone, the sidebar watched underbar and the `opr` register line are all empty while the operator is in fact tracking work. Fix: `ParseWatchlist` reads the `tracked:` list (items with a non-empty `scope.pane`), keeps the legacy `monitored:` map as a one-release dual read, adds a `Kind` field to `WatchlistEntry` if trivially plumbed, extends the tests, and updates the cron/tmux-sessions memory, the cron spec § Watchlist, and the backlog. No frontend change.

Ground truth verified in this worktree while drafting (all quoted in § What Changes):

- `app/backend/internal/cron/watchlist.go` — `ParseWatchlist` reads `raw["monitored"].(map[string]any)` only; `WatchlistEntry{ChangeID, Pane, Repo, Session, Stage, Agent, Branch}`; entries sorted by `ChangeID`; `last_tick_at` via `parseTickAt`.
- `app/backend/internal/sessions/sessions.go:177` `joinWatchlist` is a pure join over `map[string]cron.WatchlistEntry` keyed by pane; the only consumer of `WatchlistEntry` outside the cron package. `sessions_test.go:782-804` builds that map directly.
- Kit migration `$(fab kit-path)/migrations/2.24.9-to-2.25.0.md` — the binary converts a legacy file on first read-modify-write, deleting `monitored`/`watches`/`autopilot`/`notes`/`notes_seq` in the same atomic write; `branch_map`, `tick_count`, `last_tick_at` are untouched.
- The deployed `.agents/skills/_cli-fab-operator/SKILL.md` § fab operator track (verb contract, kind table) and `.agents/skills/fab-operator/SKILL.md` § Tracked Items (reference schema block, kinds `fab-change | github-pr | linear | slack | shell | task | note`, probe modes `pane | shell | agent | none`).
- The live file `$XDG_STATE_HOME/fab/operator/tmp-tmux--1001-loom.yaml` (2026-09-11 13:38Z): `tracked:` holds one `fab-change` item `pa9n` with `scope.pane: '%180'`, `scope.session: loom`, `scope.repo: /home/sahil/code/wvrdz/loom`, `scope.branch: 260911-pa9n-gk-cleanup-10-cursio-owns-cursor`, `scope.stage: apply`, `scope.agent: idle`, `paused: false`, `done_at: null`; top-level `branch_map`, `last_full_at`, `last_tick_at`, `tick_count`. No `monitored:` key.

## Why

**The problem.** Every operator-watchlist surface in the web UI is derived from one Go reader: `cron.ParseWatchlist` produces the `[]WatchlistEntry` that `sessions.joinWatchlist` rolls onto `WindowInfo.Monitored*`, which the sessions payload carries to the console `Operator Tasks` segment (`components/watched-tasks.tsx`, shipped in 260911-2281), the Server page WATCHED zone (`components/server-watched-zone/`), the sidebar StatusDot underbar and the `opr` register line. fab-kit 2.25.0 replaced the file's `monitored:` map with a `tracked:` list and deletes the legacy key the first time any `fab operator` verb touches the file — which the operator tick does every minute. Since rk adopted kit 2.25.0 in PR #936 and the operator binary is 2.25.1, every state file on this box already has the new shape, and `ParseWatchlist` finds no `monitored:` map, so it returns zero entries. The staleness half still works because `last_tick_at` kept its name — so the UI shows a LIVE operator with NOTHING watched, which is worse than an empty state: it reads as "the operator is idle" while it is actively tracking work.

**If we don't fix it.** Four surfaces built over the last two changes (the watched underbar and `opr` register from the C6 clock rung, the WATCHED zone, and the brand-new `Operator Tasks` tab) are dead on arrival on every machine running fab-kit ≥ 2.25.0, and stay dead until the reader learns the new schema. There is no workaround: rk never writes the file (Constitution X — the watchlist is derived), and fab will not write the legacy key again.

**Why this approach.** The reader is the single seam: the join, the payload fields, and every frontend consumer are shape-agnostic (they already render whatever the payload marks `monitored`). Teaching `ParseWatchlist` the `tracked:` list — items with a `scope.pane` become entries — restores every surface with one Go file and its test. Keeping the `monitored:` arm as a one-release dual read matches the repo's standing rule for keys written by tools outside the `rk` binary (`fab/project/context.md` § Conventions: "keys written by anything outside the rk binary … are dual-read for a release before the old name is dropped") and costs nothing: a file has one shape or the other. Rejected: (a) reading `fab operator track list --json` via a subprocess per fetch — adds a `fab` dependency and a process spawn to a per-request hot path for data that is already on disk in a documented schema; (b) asking fab-kit to keep emitting `monitored:` — fab-kit deliberately removed it and the kit is out of scope.

## What Changes

### 1. `internal/cron/watchlist.go` — `ParseWatchlist` reads the `tracked:` list; `monitored:` stays as a one-release dual read

**Today** (verbatim shape):

```go
monitored, _ := raw["monitored"].(map[string]any)
for key, v := range monitored {
    m, _ := v.(map[string]any)
    if m == nil { continue }
    pane := strField(m, "pane")
    if pane == "" { continue } // nothing to join against
    entries = append(entries, WatchlistEntry{ChangeID: key, Pane: pane, Repo: strField(m, "repo"), Session: strField(m, "session"), Stage: strField(m, "stage"), Agent: strField(m, "agent"), Branch: strField(m, "branch")})
}
sort.Slice(entries, func(i, j int) bool { return entries[i].ChangeID < entries[j].ChangeID })
return entries, parseTickAt(raw["last_tick_at"]), true
```

**Target.** Two arms, `tracked` first, then the legacy map ONLY when `tracked` is absent from the document:

```go
// ParseWatchlist distills the file bytes. ok is false only when the YAML
// itself fails to parse (corrupt). Entries come back sorted by ChangeID so
// the read is deterministic. The 2.25 tracked: list is the primary shape; the
// pre-2.25 monitored: map is read only when tracked: is absent (one-release
// dual read — a file has one shape or the other; if both are present the
// legacy map is ignored).
func ParseWatchlist(data []byte) (entries []WatchlistEntry, lastTickAt int64, ok bool) {
    var raw map[string]any
    if err := yaml.Unmarshal(data, &raw); err != nil {
        return nil, 0, false
    }
    if raw == nil {
        raw = map[string]any{}
    }
    if tracked, present := raw["tracked"]; present {
        entries = parseTrackedItems(tracked)
    } else {
        entries = parseMonitoredMap(raw["monitored"])
    }
    sort.Slice(entries, func(i, j int) bool { return entries[i].ChangeID < entries[j].ChangeID })
    return entries, parseTickAt(raw["last_tick_at"]), true
}
```

`parseTrackedItems(v any) []WatchlistEntry` — the new arm:

- `v.([]any)` — a non-list `tracked:` (scalar, map, null) yields no entries.
- For each element: `item, _ := el.(map[string]any)`; a non-map element is skipped.
- `id := strField(item, "id")`; an empty or non-string `id` is skipped (malformed — the binary always writes it; an entry without an id has no `MonitoredChange` and no stable sort key).
- `scope, _ := item["scope"].(map[string]any)`; `pane := strField(scope, "pane")`; an empty pane is skipped (nothing to join against — queued/pane-less `fab-change` items, `github-pr`, `linear`/`slack`, `shell`, `task`, `note` items all land here).
- `done_at` non-null ⇒ skipped. The binary sets `done_at` when the built-in completion predicate fires and keeps the item until the operator acks it with `track rm`; a done-but-unacked item is no longer "being watched" and would otherwise pin a `monitored` row onto a pane the operator is finished with (and, on pane death, onto nothing). Test for "non-null": `item["done_at"] != nil` — yaml.v3 decodes `done_at: null` to a nil interface and a timestamp to `time.Time`/string.
- `paused: true` ⇒ INCLUDED. A paused item is still in the operator's tracked set (paused is a probe-error backoff / user pause, not a removal); the UI's question is "is the operator watching this pane", which it is.
- `kind` is NOT filtered — any item with a pane is watched by pane, whatever its kind. In practice only `fab-change` has a `pane` probe (the kind table forces `check_every: null` on pane items and every other kind's default probe is `shell`/`agent`/`none`), so today this is equivalent to "fab-change items with a pane", but the reader does not encode that assumption.
- Fields: `ChangeID = id`, `Pane = scope.pane`, `Repo = scope.repo`, `Session = scope.session`, `Stage = scope.stage`, `Agent = scope.agent`, `Branch = scope.branch`, `Kind = item.kind` (see § 2). A YAML `null` in any scope field decodes to a nil interface and `strField` returns `""` — same as today's missing-key behaviour (the loom item has `stop_stage: null`, `merge_mode: null`, `spawned_by: null`, and a fresh item has `stage: null`/`agent: null`).
- Extra keys (`probe`, `check_every`, `done_when`, `then`, `depends_on`, `last`, `checked_at`, `unchanged`, `failures`, `added_at`, `updated_at`, `seen`, `text`) are ignored by the tolerant read; extra top-level keys (`branch_map`, `last_full_at`, `tick_count`, `clock_override`) likewise.

`parseMonitoredMap(v any) []WatchlistEntry` — today's loop, extracted verbatim (behaviour unchanged, `Kind` left `""` — the legacy map had no kind; it is semantically `fab-change` but the reader does not invent a value the file did not carry).

**Both-present rule.** `tracked` wins by key PRESENCE, not by non-emptiness: a file with `tracked: []` and a stale `monitored:` map yields no entries. Rationale: the binary deletes `monitored` in the same write that introduces `tracked`, so both-present is not a state the binary produces; if it is ever observed, the newer schema is the truth and the legacy key is residue. Falling back to `monitored` on an empty `tracked` list would resurrect stale entries after the operator removes the last tracked item.

**Sorting** stays by `ChangeID` (deterministic; `tracked` is an ordered list but the join is keyed by pane and every consumer sorts on its own — `watched-tasks.tsx` orders by session order then window index).

**Duplicate panes.** Two items sharing a `scope.pane` are not deduplicated in the reader; `sessions.go` builds `watchlistByPane` by iterating the sorted slice, so the later `ChangeID` wins — today's behaviour, unchanged.

**EXTERNAL CONTRACT comment** (file header) is rewritten to name the `tracked:` list as the primary schema, cite the kit migration (`2.24.9-to-2.25.0`), state the `done_at`/`paused` rule and the both-present rule, and mark the `monitored:` arm as a one-release dual read with a pointer to the backlog item that retires it. The `WatchlistEntry` doc comment stops describing "fab-kit's monitoredEntry (operator_state.go …)" and describes the tracked item's `scope` block instead. Comments state constraints the code cannot show (which keys are load-bearing, why done items are skipped) and cite no PR numbers (`fab/project/code-quality.md` § Anti-Patterns).

### 2. `WatchlistEntry` gains `Kind string`

The struct is consumed only by `sessions.joinWatchlist` and the `watchlistByPane` map; tests use keyed literals. Adding a trailing field breaks nothing, so:

```go
type WatchlistEntry struct {
    ChangeID string // tracked item id (fab-change: the change ID) / legacy monitored map key
    Pane     string // "%N" — the join key onto PaneInfo.PaneID
    Repo     string
    Session  string
    Stage    string
    Agent    string
    Branch   string
    Kind     string // tracked item kind (fab-change | github-pr | …); "" for a legacy monitored: entry
}
```

`Kind` is populated by the `tracked` arm and left empty by the legacy arm. It is NOT plumbed onto `tmux.WindowInfo` and NOT emitted in the payload — surfacing it is out of scope (§ Out of scope). The join in `sessions.go` is untouched apart from a one-word comment fix (`sessions.go:702` says "the monitored:-map join" → "the watchlist join"); `tmux.go:857`'s `// the monitored map's key` comment becomes `// the tracked item id`.

### 3. Tests — `internal/cron/watchlist_test.go`

Extend `TestParseWatchlist`'s table (keep every existing legacy case passing unchanged) with:

1. **`tracked:` list mirroring the loom file** — one `fab-change` item with a pane and every scope key (`agent: idle`, `branch`, `merge_mode: null`, `pane: '%180'`, `repo`, `session: loom`, `spawned_by: null`, `stage: apply`, `stop_stage: null`), `last: {}`, `checked_at: null`, `unchanged: 0`, `failures: 0`, `paused: false`, `done_at: null`, `added_at`/`updated_at` RFC3339, plus top-level `branch_map`, `last_full_at`, `tick_count`, and `last_tick_at: "2026-09-11T13:38:24Z"`. Expect exactly one entry `{ChangeID: "pa9n", Pane: "%180", Repo: "/home/sahil/code/wvrdz/loom", Session: "loom", Stage: "apply", Agent: "idle", Branch: "260911-pa9n-…", Kind: "fab-change"}` and the RFC3339 tick.
2. **Pane-less item skipped** — a queued `fab-change` with `scope.pane: null` and a `github-pr` item with `scope: {repo, pr}` and no pane; neither appears.
3. **Done item skipped** — `done_at: "2026-09-11T12:00:00Z"` with a live pane; absent.
4. **Paused item included** — `paused: true`, `failures: 3`, with a pane; present.
5. **Non-`fab-change` kind with a pane included** — e.g. `kind: shell` with `scope.pane: "%9"` (synthetic — the binary would not write it, but the reader must not care); present with `Kind: "shell"`.
6. **Malformed items skipped** — a scalar list element, a map with no `id`, a map whose `scope` is a string; the well-formed sibling still parses.
7. **Non-list `tracked:` tolerated** — `tracked: {pa9n: {...}}` (map) and `tracked: 3` yield no entries, `ok == true`.
8. **Both present, `tracked` wins** — `monitored: {legacy: {pane: "%1"}}` alongside `tracked: [{id: new, kind: fab-change, scope: {pane: "%2"}}]` yields only `new`; and `tracked: []` alongside the same `monitored:` yields NO entries.
9. **Sort by ChangeID across list order** — items `zz` then `aa` in the list come back `aa`, `zz`.

`TestReadWatchlistRoundTrip` gains a `tracked:`-shaped body (or a second round-trip case) so the file-level read is exercised on the new shape too. `TestReadWatchlistAbsentAndCorrupt` is unchanged. `internal/sessions/sessions_test.go`'s `joinWatchlist` tests are pure and unaffected — run them to confirm.

Run: `just _ensure-tmux-conf` once in this worktree (the Go embed of `tmux.conf` is missing in a fresh worktree), then `just test-backend`. Never `go test` directly (`fab/project/context.md` § Testing).

### 4. Docs (hydrate scope)

- `docs/memory/run-kit/cron.md` § Overview "Watchlist reader" paragraph (line 74) — `monitored:` map → `tracked:` list of items with a `scope.pane`; name the skip rules (`done_at` set, no pane) and the include rule (`paused`), the `Kind` field, and the legacy `monitored:` dual read for one release. § External Contracts (line 237) — the file's owned shape is the `tracked:` list per fab-kit 2.25 (kit migration `2.24.9-to-2.25.0`), legacy `monitored:` read only when `tracked:` is absent. § Requirement "tolerant watchlist read" (line 449) and the socket-path scenario's `monitored:` fixture (line 376) — rewritten to the `tracked:` shape. Add a Design Decision entry (four-field shape) for "done items skipped, paused items included, kind not filtered, tracked wins on key presence".
- `docs/memory/run-kit/tmux-sessions.md` § Fab-Tier Derivation watchlist-tier paragraph (line 572: "the `monitored:`-map join") and the `@rk_win_owner` Design Decision (line 730: "which the `monitored:` map already provides") — say `tracked:` list.
- `docs/specs/cron.md` § Watchlist — Derived from the Operator State File (line 303) — the file carries `tick_count`, `last_tick_at` and the `tracked:` list; rk joins pane-bearing tracked items to windows by pane ID; the `fab operator` verbs are now `track add|update|observe|rm|list|clock` (not `enroll`/`update`). `docs/specs/agent-state.md` has no watchlist mention (verified by grep) — no change there.
- `fab/backlog.md` — append one open item (existing row shape `- [ ] [xxxx] 2026-09-11: …`, id from the `idea` CLI when available, else a fresh 4-char id): drop the legacy `monitored:` map arm (`parseMonitoredMap` and its test cases) from `internal/cron/watchlist.go` one release after this change ships; precondition — every fleet machine's operator state files carry `tracked:` (any `fab operator` verb on kit ≥ 2.25.0 converts them). Mirror the `[q2hk]` row's "one release after … the tag is the version" phrasing.

### 5. Constraints

- Constitution II / X — the watchlist stays derived at request time from the fab-owned file; rk never writes it; absent, corrupt, or unexpectedly-shaped input degrades to the empty watchlist, never an error state.
- Constitution IV — no new route, no payload field, no frontend change.
- Test Integrity — the fixtures mirror the deployed kit schema; tests are updated to match the spec, not the other way round.
- `fab/project/code-quality.md` — `strField` and the existing tolerant helpers are reused; no god function (split the two arms into named helpers); comments carry constraints, not narration or PR numbers.

### 6. Out of scope

- Rendering a tracked item's `kind`, `probe`, `check_every`, `done_when`, `paused`, or `depends_on` in any UI surface; plumbing `Kind` onto `WindowInfo`/the payload.
- Changing fab-kit or its state-file schema.
- The cron entry file, the evaluator, `last_tick_at` staleness semantics (unchanged — the key kept its name).
- Frontend changes of any kind — the consumers already render whatever the payload marks `monitored`.

## Affected Memory

- `run-kit/cron`: (modify) § Overview "Watchlist reader" paragraph, § External Contracts operator-state-file paragraph, § Requirement "tolerant watchlist read" + the socket-path scenario fixture; new Design Decision for the tracked-list read rules and the one-release `monitored:` dual read
- `run-kit/tmux-sessions`: (modify) § Fab-Tier Derivation watchlist-tier paragraph and the `@rk_win_owner` Design Decision — `monitored:` map → `tracked:` list

## Impact

- **Code**: `app/backend/internal/cron/watchlist.go` (reader — two parse arms, `Kind` field, contract comment), `app/backend/internal/cron/watchlist_test.go` (table extension + round-trip). Comment-only touches: `app/backend/internal/sessions/sessions.go:702`, `app/backend/internal/tmux/tmux.go:857`.
- **Runtime**: every sessions payload on a host running fab-kit ≥ 2.25.0 regains `monitored*` on tracked panes; the console `Operator Tasks` tab, Server page WATCHED zone, sidebar underbar and `opr` register repopulate with no frontend change.
- **Docs**: `docs/memory/run-kit/cron.md`, `docs/memory/run-kit/tmux-sessions.md`, `docs/specs/cron.md` § Watchlist, `fab/backlog.md` (one new item).
- **Dependencies**: none added; `gopkg.in/yaml.v3` already used.
- **Tests**: `just test-backend` (after `just _ensure-tmux-conf`); `internal/sessions` join tests re-run as a regression check.

## Open Questions

None — every decision point is graded below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Primary schema is the 2.25 `tracked:` list; an entry is any list item with a non-empty `scope.pane`, mapping `id`→ChangeID and `scope.{pane,repo,session,stage,agent,branch}`→the existing fields | Verified against the kit migration, the deployed skill schema block, and the live loom file; the field mapping is one-to-one with today's struct | S:95 R:90 A:95 D:95 |
| 2 | Confident | Non-`fab-change` kinds with a `scope.pane` are included; `kind` is not a filter | Dispatch recommended YES with rationale (watched-by-pane is watched); only fab-change carries a pane probe today so the choice is inert in practice and trivially reversible | S:75 R:85 A:80 D:70 |
| 3 | Confident | Items with `done_at` set are skipped | Dispatch recommendation; the schema documents `done_at` as "set by the binary when completion fires, durable across pane death" — a done-unacked item would otherwise pin a watched row onto a finished or dead pane | S:70 R:85 A:75 D:65 |
| 4 | Confident | Items with `paused: true` are included | Dispatch recommendation; paused is a probe-error backoff or user pause inside the tracked set, not a removal — the pane is still watched | S:70 R:85 A:75 D:65 |
| 5 | Certain | Legacy `monitored:` map kept as a one-release dual read; read only when the `tracked` KEY is absent; both present ⇒ `tracked` wins even when the list is empty | Dispatch stated the dual read and the tracked-wins rule; repo convention (`context.md` § Conventions) dual-reads externally-written keys for a release; key-presence (not non-emptiness) avoids resurrecting stale entries after the last item is removed | S:90 R:85 A:85 D:85 |
| 6 | Certain | `WatchlistEntry` gains a trailing `Kind string`, populated by the `tracked` arm, `""` on the legacy arm; NOT plumbed to `WindowInfo` or the payload | The struct's only external consumer is `sessions.joinWatchlist` (verified); tests use keyed literals, so the addition is a pure extension; surfacing it is declared out of scope | S:75 R:90 A:90 D:80 |
| 7 | Confident | A list item with a missing or non-string `id` is skipped as malformed, even if it has a pane | The binary always writes `id` (it is the verb's positional argument); an id-less entry has no `MonitoredChange` and no stable sort key | S:60 R:90 A:80 D:70 |
| 8 | Certain | YAML `null` scope values (`stage: null`, `agent: null`, …) decode to `""` via the existing `strField` helper — same as a missing key | Verified: yaml.v3 decodes `null` to a nil interface; `strField`'s type assertion yields `""` | S:85 R:95 A:95 D:95 |
| 9 | Certain | Sorting stays by `ChangeID`, not list order; duplicate panes are not deduplicated in the reader (the join's later-ChangeID-wins stands) | Dispatch stated deterministic sort by ChangeID; the join and every UI consumer order on their own; dedupe is today's behaviour, unchanged | S:85 R:95 A:90 D:90 |
| 10 | Certain | Tolerance rules: non-list `tracked:` ⇒ no entries with `ok == true`; non-map list element ⇒ skipped; non-map `scope` ⇒ treated as no pane ⇒ skipped; corrupt YAML ⇒ `ok == false` as today | Dispatch stated the first two; the rest follow the file's existing tolerant-read posture and Constitution II/X | S:85 R:95 A:95 D:90 |
| 11 | Certain | Test plan: extend `TestParseWatchlist`'s table with the nine cases in § 3 (loom mirror, pane-less, done, paused, non-fab-change kind, malformed, non-list, both-present incl. empty `tracked: []`, sort), keep every legacy case, add a `tracked:` round-trip; run via `just _ensure-tmux-conf` then `just test-backend` | Dispatch named the fixture set and the recipe; `context.md` § Testing forbids direct `go test`; the worktree-embed gotcha is recorded in memory | S:90 R:95 A:95 D:95 |
| 12 | Certain | Docs scope at hydrate: `docs/memory/run-kit/cron.md` (Overview watchlist paragraph, External Contracts, tolerant-read requirement + scenario fixture, one new Design Decision), `docs/memory/run-kit/tmux-sessions.md` (watchlist-tier paragraph + `@rk_win_owner` DD), `docs/specs/cron.md` § Watchlist, one `fab/backlog.md` item to retire the `monitored:` arm; `docs/specs/agent-state.md` untouched (no watchlist mention) | Each location grepped and line-cited in § 4 | S:90 R:95 A:95 D:95 |
| 13 | Certain | The backlog retirement item gets its 4-char id from the `idea` CLI when available, otherwise a hand-generated id in the existing `- [ ] [xxxx] YYYY-MM-DD: …` row shape, phrased like `[q2hk]` ("one release after … the tag is the version") | Existing rows show both `idea`-generated and hand-relocated entries with the same shape; the phrasing precedent is one row above | S:65 R:95 A:80 D:75 |
| 14 | Certain | Comment-only touches in `sessions.go:702` and `tmux.go:857` replace "monitored map" wording; `joinWatchlist` logic and its tests are untouched | The join is pure and shape-agnostic (verified); leaving stale "monitored:-map" comments would contradict the new contract comment | S:80 R:95 A:95 D:90 |
| 15 | Certain | Change type is `fix`; no frontend, route, or payload change; Constitution II/X/IV hold | Stated by the dispatch and confirmed by the shape-agnostic consumer chain | S:95 R:95 A:95 D:95 |

15 assumptions (11 certain, 4 confident, 0 tentative, 0 unresolved).

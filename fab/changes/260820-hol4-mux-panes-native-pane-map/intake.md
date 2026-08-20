# Intake: rk mux panes — native pane-map enumeration

**Change**: 260820-hol4-mux-panes-native-pane-map
**Created**: 2026-08-20

## Origin

One-shot `/fab-new` invocation:

> Part 8 of docs/specs/cli-layering.md (run-kit half): pane-map native enumeration -- add `rk mux panes` (native pane/window enumeration + agent state, no fab dependency); drop the cached fab pane map join in sessions.go that causes the ~5s StatusDot lag class. Dep: Part 6 merged (already true, run-kit v3.17.15). This is the run-kit half of a two-repo split -- fab-kit half (enrichment with change/stage) is held until this half merges + releases.

This is the final part (8/8) of the phased execution plan in `docs/specs/cli-layering.md` § Execution plan. Its dependency (Part 6 — substrate twins `mux capture`/`kill`/`process`) is merged and released. The fab-kit half (rebuilding `fab pane map` as enrichment over `rk mux panes`) is a **separate fab-kit change, held** until this change merges and ships in a release — nothing in this change may break the currently-shipping `fab pane map` (fab-kit consumers keep using it until their half lands).

## Why

1. **The StatusDot ~5s-lag class.** `internal/sessions/sessions.go` enriches every window with fab pipeline state (`FabChange`/`FabStage`/`FabDisplayState`) by shelling out to `fab pane map --json --all-sessions` behind a 5-second TTL cache (`fetchPaneMapCached`, `paneMapCacheTTL = 5s`). The pane-ID join (a prior fix) removed cross-window *misattribution*, but the *values themselves* still lag up to 5s behind reality plus the subprocess runtime — a stage transition (e.g. review → done) takes up to ~5s to repaint the StatusDot. Deriving the same facts natively from disk at request time kills the entire lag class: no subprocess, no cache, fresh every fetch.

2. **CLI layering (Part 8, the last part).** Per `docs/specs/cli-layering.md`, rk owns the substrate layer — pane/window enumeration and agent state are substrate facts, and `fab pane map`'s row in the fab-split table reads: "long-term: rk owns enumeration (`rk mux panes`), fab enriches with change/stage; today rk's server consumes `fab pane map` for the join". This change delivers the run-kit half: the canonical enumeration verb, and the server's independence from the fab binary on its hottest path (every SSE sessions tick).

3. **Constitutional alignment.** Constitution II names the sources directly: "Fab state comes from `.status.yaml` and `fab/current`." `docs/specs/status-pyramid.md` (signal registers table) already documents the L2 fab-tier source as "cwd → `.fab-status.yaml` → `.status.yaml`, via the pane-map join" — the join is the current *mechanism*; this change reads the documented source natively. Constitution X: change identity is derivable from the filesystem, so it MUST be derived server-side, never fetched through a choreography subprocess on the hot path.

If we don't do this: the StatusDot lag stays (a recurring bug class already in project memory), the server keeps a hard runtime dependency on the fab router + globally-installed fab for its core SSE payload, and the fab-kit half of Part 8 stays blocked.

## What Changes

### 1. New CLI verb: `rk mux panes` (native enumeration + agent state)

Tenth member of the `mux` family (`app/backend/cmd/rk/mux_panes.go`). Enumerates every pane on the resolved tmux server — one row per pane — with substrate facts only. **No fab dependency, no change/stage/display_state fields**: choreography enrichment is the fab-kit half's job (`fab pane map` becomes `rk mux panes` + change/stage), keeping the layering clean.

- **Scope**: whole server, all sessions, by default. No pane/window target argument (unlike the pane-scoped tier) — this is an enumeration query, not a targeted verb. No session filter flag in v1; consumers filter.
- **Server resolution**: consumes the family's inherited `-L/--server` flag with the standard order (-L wins → caller's own server from `$TMUX` socket basename → default server). It is a query against a server, so it does NOT call `muxRejectInheritedServerFlag`.
- **Implementation**: reuses the existing native enumeration (`tmux.ListSessions` + `tmux.ListWindows`, which already carry reconciled `@rk_agent_state` per pane) — talks to tmux directly from the caller's context, no daemon dependency, matching the family contract.
- **Output, default (human)**: an aligned table, one pane per row — session, window (index:name), pane ID, active markers, reconciled agent state (+ duration for idle/waiting), cwd. Exact formatting settled at apply under the toolkit standards audit.
- **Output, `--json`**: an array, one object per pane. Key naming follows the family's existing JSON conventions (`mux capture --json`: `agent_state`, `agent_state_duration`) and keeps `fab pane map`'s enumeration keys where they overlap so the fab-kit enrichment half is near-key-compatible:

```json
[
  {
    "session": "runKit",
    "session_id": "$3",
    "window_index": 2,
    "window_id": "@225",
    "window_name": "companion-window-agents",
    "window_active": false,
    "pane": "%296",
    "pane_index": 0,
    "pane_active": true,
    "command": "node",
    "cwd": "/home/sahil/code/sahil87/run-kit.worktrees/swift-mink",
    "agent_state": "idle",
    "agent_state_duration": "5m"
  }
]
```

  `agent_state`/`agent_state_duration` are `null` when the pane is uninstrumented or the reconciler rejects a stale/dead-pid value (same semantics as `mux capture --json`); duration is emitted only for `idle`/`waiting`, never `active`.
- **Exit codes** (toolkit standard): 0 success (a server with no sessions prints an empty array / no rows, still 0), 1 tmux/operational failure with tmux's diagnostic on stderr, 2 usage.

### 2. `internal/sessions`: native fab-state derivation replaces the `fab pane map` join

Delete the subprocess + cache + join machinery in `internal/sessions/sessions.go`:

- `paneMapEntry`, `fetchPaneMap`, `keyPaneEntries`, `paneMapCacheEntry`, `paneMapCache`/`paneMapCacheMu`/`paneMapCacheTTL`, `fetchPaneMapCached`, `joinPaneMapByWindow`, and the `fetchPaneMapCached(server)` call site in `FetchSessions` — the server no longer executes `fab` at all on this path.

Replace with a native per-pane derivation, run fresh inside every `FetchSessions` (the exact source `docs/specs/status-pyramid.md` documents for the L2 register):

1. **Locate**: from the pane's cwd, walk up to the nearest ancestor directory containing `.fab-status.yaml` (bounded walk to filesystem root; skip panes whose cwd is missing — `CwdMissing` already computed).
2. **Change name**: `readlink` the symlink — its target is `fab/changes/{name}/.status.yaml`; the change name is the target's parent directory basename. A dangling symlink (archived change) → empty fields.
3. **Stage + display state**: parse the target `.status.yaml`'s `progress:` map (ordered) and derive `(stage, display_state)` with fab's 5-tier display-stage rule, mirrored exactly from fab-kit `internal/status/status.go` `DisplayStage`:
   - Tier 1: first `active` stage → that stage, `active`
   - Tier 2: first `failed` → that stage, `failed` (a parked failure outranks ready/done)
   - Tier 3: first `ready` → that stage, `ready`
   - Tier 4: last `done`/`skipped` → that stage, its state
   - Tier 5: fall back to the first stage, `pending`
4. **Window rollup**: unchanged selection semantics — among a window's panes, a change-bound pane's derivation wins; otherwise the first pane (pane order) with any derivation. Populates the same `WindowInfo.FabChange`/`FabStage`/`FabDisplayState` fields; the JSON contract to the frontend is byte-identical, so **no frontend changes**.
5. **Freshness/cost**: no TTL cache (that IS the lag class). A per-call memo keyed by resolved `.fab-status.yaml` root dedupes reads within one `FetchSessions` (many panes share a worktree); nothing persists across requests — plain Constitution II derivation, not a state store.
6. **Degradation**: missing symlink, dangling symlink, unreadable/unparsable YAML, or an empty progress map → empty fab fields for that pane, never an error (today's fail-open `paneMap, _ :=` behavior, per-pane instead of all-or-nothing).

Also fix the now-stale comment on `WindowInfo` (`internal/tmux/tmux.go` PR-fields doc says "PrURL/PrNumber come from `fab pane map`" — they've been branch-derived via `prstatus` since 260705-dmex) and the `paneMapEntry`-era doc comments that describe the deleted machinery.

### 3. CLI-surface obligations (intrinsic to every Part, per the spec)

- **help-dump test**: add the `mux panes` surface to `cmd/rk/help_dump_test.go` expectations.
- **`rk skill mux` topic page**: add a `## rk mux panes` section to `cmd/rk/skill/mux.md` and its `docs/site/skill/mux.md` twin (whichever is source per the readme-extraction/skill standard — follow the existing sync direction); update the family framing ("nine members" → ten) in `cmd/rk/mux.go`'s doc comment and the `mux` command Short/Long text.
- **Standards audit**: check the new surface against `shll standards` (help-dump, ten principles — notably Principle 9 output discipline — skill topic pages) against a HEAD build.

### 4. Tests

- `cmd/rk/mux_panes_test.go`: wiring, `--json` schema (field presence, null agent fields for uninstrumented panes), table output smoke, empty-server exit 0, usage errors exit 2.
- `internal/sessions/sessions_test.go`: replace the `joinPaneMapByWindow`/pane-map fixture tests with native-derivation tests using temp-dir fixtures (real `.fab-status.yaml` symlink + `.status.yaml`): the 5 display-stage tiers, change-name extraction from the symlink target, walk-up from a subdirectory cwd, change-bound-pane-wins window rollup, and each degradation case (no symlink / dangling symlink / corrupt YAML → empty fields).

### Explicitly out of scope

- The fab-kit half: `fab pane map` reworked as enrichment over `rk mux panes` (held; separate repo, gated on this change's **release**, not merge).
- Any change to `fab pane map` behavior — it keeps working unchanged; this change only stops rk's server from calling it.
- PR-field derivation (`prstatus`), agent-state rollup, chat rollup — already native, untouched.

## Affected Memory

- `run-kit/agent-messaging`: (modify) mux family grows to ten members — add the `panes` enumeration verb contract (scope, `-L` consumption, JSON schema, exit codes)
- `run-kit/tmux-sessions`: (modify) session-enrichment path — native cwd→`.fab-status.yaml`→`.status.yaml` derivation replaces the cached `fab pane map` join; freshness semantics
- `run-kit/architecture`: (modify) server's fab-binary dependency removed from the sessions/SSE hot path; display-stage mirror noted as a cross-repo schema coupling
- `run-kit/toolkit-standards`: (modify) help-dump + Principle 9 new-surface check extends over the ten-member mux family

## Impact

- `app/backend/cmd/rk/`: new `mux_panes.go` + `mux_panes_test.go`; `mux.go` (family doc/Short/Long); `help_dump_test.go`; `skill/mux.md`
- `app/backend/internal/sessions/sessions.go` + `sessions_test.go`: ~150 lines of subprocess/cache/join machinery deleted, replaced by the native derivation (new YAML read — `gopkg.in/yaml.v3` already in go.mod via other internal packages)
- `app/backend/internal/tmux/tmux.go`: stale doc comment fix only
- `docs/site/skill/mux.md`: topic-page twin
- Frontend: none (WindowInfo JSON contract unchanged)
- Cross-repo: unblocks the held fab-kit enrichment change once released

## Open Questions

*(none — the spec, constitution, status-pyramid register table, and fab-kit source answer every design point; see Assumptions)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The server keeps surfacing `FabChange`/`FabStage`/`FabDisplayState` (natively derived), rather than dropping the fab tier | status-pyramid.md's register table names the exact source "cwd → `.fab-status.yaml` → `.status.yaml`"; Constitution II names `.status.yaml`/`fab/current` as the fab-state source; dropping would regress the L2 StatusDot tier | S:85 R:70 A:95 D:90 |
| 2 | Certain | `rk mux panes` emits substrate facts only — no change/stage/display_state keys | cli-layering.md Part 8 row states it verbatim: rk owns enumeration, "fab enriches enumeration with change/stage"; the held fab-kit half is that enrichment | S:90 R:75 A:95 D:90 |
| 3 | Confident | Display-state derivation mirrors fab's 5-tier `DisplayStage` rule exactly (active → failed → ready → last done/skipped → pending), verified against fab-kit `internal/status/status.go` | Keeps UI semantics byte-identical to today's join; schema drift fab-side degrades fail-open to empty fields, and the coupling is recorded in memory | S:70 R:75 A:90 D:85 |
| 4 | Confident | `rk mux panes` enumerates the whole server by default (no target arg, no session filter in v1), consumes inherited `-L`, offers `--json` with keys blending `fab pane map` enumeration names and `mux capture` agent-state names | The fab-kit consumer needs all sessions (today's `--all-sessions` behavior); the held half adapts to whatever this contract ships, so rk defines the clean one; family grammar precedent for `-L` and `--json` | S:55 R:80 A:80 D:65 |
| 5 | Confident | Join-replacement semantics preserved: change-bound pane wins else first-seen; per-request memo only (no TTL cache); per-pane fail-open degradation | Selection rule lifted unchanged from `joinPaneMapByWindow`; the TTL cache is the very lag class being removed; Constitution II mandates request-time derivation | S:60 R:85 A:90 D:80 |
| 6 | Confident | Human (non-`--json`) output is an aligned one-pane-per-row table; exact columns/format settled at apply under the standards audit | Cosmetic, fully reversible, Principle 9 governs; `--json` is the machine contract | S:50 R:90 A:75 D:60 |

6 assumptions (2 certain, 4 confident, 0 tentative, 0 unresolved).

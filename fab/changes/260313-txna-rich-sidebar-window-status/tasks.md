# Tasks: Rich Sidebar Window Status

**Change**: 260313-txna-rich-sidebar-window-status
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Backend — tmux & Runtime State

- [x] T001 [P] Add `#{pane_current_command}` to tmux format string in `app/backend/internal/tmux/tmux.go` — extend `ListWindows()` format to 6 fields, add `PaneCommand string` field to `WindowInfo`, update `parseWindows()` to parse 6th field, expose `ActivityTimestamp int64` (already parsed as `activityTs`, just assign it)
- [x] T002 [P] Update `app/backend/internal/tmux/tmux_test.go` — update existing `parseWindows` table tests for 6-field format (update `windowLine` helper to accept `paneCmd string` param), add test cases for `PaneCommand` population and `ActivityTimestamp` exposure <!-- clarified: file already exists; "Add" changed to "Update". windowLine helper currently builds 5-field lines and must gain a 6th param -->
- [x] T003 [P] Create `app/backend/internal/fab/runtime.go` — implement `RuntimeState` struct and `ReadRuntime(projectRoot, changeName string) *RuntimeState` function. Read `.fab-runtime.yaml` (untyped `map[string]interface{}` like fab-kit's `runtime.LoadFile`), navigate to `{changeName}.agent.idle_since`, compute elapsed duration as Ns/Nm/Nh (floor division). Rules: idle_since present → "idle" + formatted duration; idle_since absent OR agent block missing → "active"; runtime file missing → "unknown"; no `.fab-status.yaml` → return nil. Include `FormatIdleDuration(seconds int64) string` helper (exported for testing) <!-- clarified: spelled out all 4 return-value rules from spec; noted untyped map parsing to match fab-kit convention -->
- [x] T004 [P] Create `app/backend/internal/fab/runtime_test.go` — table-driven tests: agent active (no idle_since), agent idle (various durations: <60s, minutes, hours), runtime file missing (unknown), empty runtime file, missing change entry, missing agent block. Test `FormatIdleDuration` separately

## Phase 2: Backend — Session Enrichment

- [x] T005 Update `app/backend/internal/sessions/sessions.go` — modify `enrichSession()` to call `fab.ReadRuntime()` alongside existing `fab.ReadState()`. Apply `AgentState` and `AgentIdleDuration` to all windows. Implement per-project-root caching of `.fab-runtime.yaml` content within `FetchSessions()` using a `sync.Map` or plain map passed into enrichment goroutines
- [x] T006 Update `app/backend/internal/sessions/sessions_test.go` — add test cases for runtime enrichment (active agent, idle agent with duration, unknown agent state, non-fab session skips enrichment)

## Phase 3: Frontend — Types & Sidebar

- [x] T007 Update `app/frontend/src/types.ts` — add `paneCommand?: string`, `agentState?: string`, `agentIdleDuration?: string`, `activityTimestamp: number` to `WindowInfo`
- [x] T008 Update `app/frontend/src/components/sidebar.tsx` — (a) activity dot: add `ring-1 ring-accent-green` (active) or `ring-1 ring-text-secondary/40` (idle) when `isActiveWindow` is true; (b) duration label: right-aligned after fabStage, show `agentIdleDuration` for fab idle windows, compute from `activityTimestamp` for non-fab idle windows, omit when active; add `formatDuration(seconds: number): string` helper (Ns/Nm/Nh) — extract to a shared util so T010 can reuse it; (c) "i" info button: `opacity-0 group-hover:opacity-100` on desktop, always visible `ⓘ` on mobile (`coarse:min-h-[44px]` tap target), tap-to-toggle popover with compact key-value layout (Change, Process, Path, State); dismiss on outside click, Escape, or re-tap <!-- clarified: added explicit 44px mobile tap target, Escape/outside-click dismiss per spec; noted formatDuration should be shared with T010 -->
- [x] T009 Update `app/frontend/src/components/sidebar.test.tsx` — test: ring class on `isActiveWindow` dot, duration display for idle windows, duration omitted for active, "i" button visibility on hover, popover open/close, popover content for fab vs non-fab windows <!-- clarified: file already exists with baseline tests; "Add" changed to "Update". Existing test fixtures will need new fields (activityTimestamp, etc.) added -->

## Phase 4: Frontend — Top Bar

- [x] T010 Update `app/frontend/src/components/top-bar.tsx` — enrich Line 2 right side: add activity dot, paneCommand, duration (reuse shared `formatDuration` from T008), fab change ID + slug (parse from `fabChange`: 0-indexed `substring(7,11)` for 4-char ID, everything after second `-` for slug), `│` separator for fab fields only when `fabStage` present, omit each field when empty/undefined; mobile: enriched status hidden via existing `hidden sm:flex` <!-- clarified: corrected index to 0-based substring(7,11) matching "260313-txna-..." → "txna"; added activity dot and mobile collapse per spec -->
- [x] T011 Add/update `app/frontend/src/components/top-bar.test.tsx` — test: full status for fab window, non-fab window status, mobile collapse, omission of empty fields, ID + slug parsing from fabChange

---

## Execution Order

- T001, T002, T003, T004 are all independent (Phase 1 [P] tasks)
- T005 depends on T001 + T003 (needs PaneCommand field and ReadRuntime function)
- T006 depends on T005
- T007 depends on T001 (types must match backend struct)
- T008 depends on T007
- T009 depends on T008
- T010 depends on T007
- T011 depends on T010
- T009 and T010 are independent of each other (can parallelize sidebar and top bar)

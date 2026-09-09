# Plan: Pane-split tmux wedge — multi-viewer sizing guard (`window-size smallest`)

**Change**: 260909-3cp9-pane-split-wedge-sizing-guard
**Intake**: `intake.md`

## Requirements

### Managed tmux conf: multi-viewer sizing guard

#### R1: No sized client is ever narrower than the window it views
The managed tmux conf (`configs/tmux/default.conf`, embedded as `build.TmuxConfig`) MUST set
`window-size smallest` (server/global option) and `aggressive-resize on` (global window option),
so a window is sized to the narrowest size-participating client whose current window it is. This
makes the tmux ≤3.7c `screen_redraw_draw_pane_status` width underflow unreachable: that draw
only misbehaves when a client's viewport is narrower than the window and a pane status line
straddles the viewport edge.

- **GIVEN** a window viewed by a 200-column client and a 105-column client, the 200-column client
  most recently active
  **WHEN** the window is split horizontally
  **THEN** the window is 105 columns wide, every pane status line is fully visible on both clients,
  and a concurrent `tmux display -p ok` returns in well under 2 s (no server spin).
- **GIVEN** a 105-column client whose current window is window 2 in a grouped session
  **WHEN** a 200-column client views window 1 in the base session
  **THEN** window 1 stays 200 columns wide (the constraint is scoped to viewers of the window).

#### R2: The guard is asserted in the embedded conf and end-to-end against real tmux
Regression coverage MUST fail closed if either option is removed from the managed conf.

- **GIVEN** the embedded managed conf
  **WHEN** the conf-assertion unit test runs
  **THEN** it finds `set -g window-size smallest` and `setw -g aggressive-resize on`.
- **GIVEN** a scratch tmux server started with the embedded conf, a 200×50 pty client attached
  first, a 105×40 pty client attached second, and a focus-in event written to the 200-column client
  **WHEN** `split-window -h` runs and `display -p ok` is probed
  **THEN** both commands complete in under 2 s and the live server reports `window-size` =
  `smallest` and `aggressive-resize` = `on`. (On the pre-change conf this geometry spins the server
  for >40 s, so the probe's 5 s context expires and the test fails.)

#### R3: Comments and documents that cite `window-size latest` describe the new policy
Source comments referencing tmux's `window-size latest` arbitration MUST be updated to the
`smallest`/`aggressive-resize` policy without changing behavior; memory updates are hydrate's.

- **GIVEN** `app/frontend/src/lib/relay-mux.ts` and `relay-mux.test.ts`
  **WHEN** their hidden-page suspension comments are read
  **THEN** they explain that hidden pages release their sized attach clients so a hidden narrow
  viewer cannot pin a window small under `window-size smallest`, with no reference to `latest`.

#### R4: An upstream tmux report is drafted, not filed
A ready-to-file report MUST exist at
`fab/changes/260909-3cp9-pane-split-wedge-sizing-guard/upstream-tmux-report.md` describing the
defect (3.7c `screen-redraw.c` `screen_redraw_draw_pane_status` lines 707–717, `width = size - l`
/ `width = size - x` unsigned underflow), a two-client reproduction, the observed effect, and the
master-branch clamp in `redraw_draw_status_span` that already fixes it. Nothing in this change
contacts the upstream tracker.

- **GIVEN** the change folder after apply
  **WHEN** the report is read
  **THEN** it contains the reproduction steps, the source-level diagnosis, and a backport request.

### Non-Goals

- Disabling `pane-border-status` or altering the border format (the s9fw fork-free format and
  daemon stamping stay as shipped).
- A tmux version gate or `rk doctor` row for the defect (policy applied unconditionally).
- Any daemon, relay, API, or frontend behavior change.
- Editing the archived `260908-s9fw` intake/plan (memory carries the corrected root cause).

### Design Decisions

#### Guard the geometry with `window-size smallest` + `aggressive-resize on`
**Decision**: the managed conf sizes every window to the narrowest client currently viewing it,
scoped per current window.
**Why**: every released tmux through 3.7c underflows the pane-status draw width when a viewer is
narrower than the window and a pane status straddles its edge, spinning the server ~21 s per
redraw; run-kit cannot patch the user's tmux, and `smallest` makes the geometry unreachable by
construction. `aggressive-resize on` is mandatory: without it a narrow client viewing one window
of a grouped `_rk-pin-*` session shrinks every window in the group (verified).
**Rejected**: `pane-border-status off` (loses per-pane identity, orphans the stamping
infrastructure); hook- or daemon-driven per-window border toggling (the first redraw after a
geometry change already wedges; tmux formats cannot enumerate clients; `run-shell` is async);
format padding (the underflow depends on pane x-offset, not text length); `largest`/`manual`
(guarantee clipping / freeze everyone); waiting for upstream (no released tmux carries the fix).
*Introduced by*: 260909-3cp9-pane-split-wedge-sizing-guard

#### Regression test is a real-tmux geometry test, not a TUI simulation
**Decision**: the integration test reproduces the defect purely geometrically (plain `sleep` panes,
two pty clients, fixed widths) and asserts sub-2 s probes plus the live option values.
**Why**: the wedge depends only on viewport/window/pane-status geometry, so no agent TUI is
needed; the package already spawns real tmux servers and `creack/pty` is a dependency.
**Rejected**: a Playwright multi-viewer e2e (slow, indirect, and the relay is not the defect's
locus); a unit test alone (cannot observe the tmux spin).
*Introduced by*: 260909-3cp9-pane-split-wedge-sizing-guard

## Tasks

### Phase 1: Setup

- [x] T001 Add a `# --- Multi-viewer sizing ---` section to `configs/tmux/default.conf` (after the pane-border section) with `set -g window-size smallest` and `setw -g aggressive-resize on` plus a comment naming the tmux defect and why aggressive-resize is paired; refresh `app/backend/build/tmux.conf` via `just _ensure-tmux-conf` (build artifact, not committed). <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 [P] Add `TestDefaultConfigMultiViewerSizingGuard` to `app/backend/internal/tmux/managedconf_test.go` asserting the embedded conf contains both option lines. <!-- R2 -->
- [x] T003 [P] Add `app/backend/internal/tmux/pane_status_wedge_test.go`: scratch server via `testSocketName("wedge")` started with `DefaultConfigBytes()` written to a temp conf (`new-session -d -s s -x 200 -y 50 sleep 1000`), two `tmux attach -t s` clients through `pty.StartWithSize` (200×50 then 105×40, drained by goroutines), focus-in `\x1b[I` written to the wide client, then `split-window -h -t s:1 sleep 1000` and `display -p ok` each under a 5 s context asserting <2 s, plus `show -gv window-size` == `smallest` and `show -gwv aggressive-resize` == `on`; skip when tmux or pty is unavailable; `t.Cleanup` kills clients and server. <!-- R2 -->

### Phase 3: Integration & Edge Cases

- [x] T004 [P] Update the hidden-page suspension comments in `app/frontend/src/lib/relay-mux.ts` (~line 99) and `app/frontend/src/lib/relay-mux.test.ts` (~line 473) to describe the `smallest` policy (no code change). <!-- R3 -->

### Phase 4: Polish

- [x] T005 [P] Write `fab/changes/260909-3cp9-pane-split-wedge-sizing-guard/upstream-tmux-report.md` (defect, reproduction, diagnosis, master clamp, backport request). <!-- R4 -->

## Acceptance

### Functional Completeness
- [x] A-001 R1: `configs/tmux/default.conf` sets `window-size smallest` and `aggressive-resize on` in a commented multi-viewer sizing section. (verified: `configs/tmux/default.conf:77-88`, `# --- Multi-viewer sizing ---` section with defect-rationale comment)
- [x] A-002 R2: A unit test asserts both option lines in the embedded conf. (verified: `TestDefaultConfigMultiViewerSizingGuard`, `managedconf_test.go:468`; PASS)
- [x] A-003 R2: A real-tmux integration test reproduces the two-client geometry and passes with the new conf. (verified: `TestManagedConfSplitUnderNarrowerClientDoesNotWedge`, `pane_status_wedge_test.go:35`; ran for real, PASS in 0.35s)
- [x] A-004 R3: `relay-mux.ts` / `relay-mux.test.ts` comments no longer describe `window-size latest` as the arbitration policy. (verified: `relay-mux.ts:98-106`, `relay-mux.test.ts:472-477`; no `latest` arbitration claim remains in `app/frontend/src/lib/`)
- [x] A-005 R4: `upstream-tmux-report.md` exists in the change folder with reproduction, diagnosis, and backport request. (verified: reproduction script, `screen-redraw.c` source diagnosis, master clamp, explicit backport request)

### Behavioral Correctness
- [x] A-006 R1: Under the new conf, the 200/105 two-client split completes with a <2 s probe (the pre-change conf wedges >40 s on the same geometry). (verified: integration test ran in 0.35s total; each probe asserted <2 s under a 5 s context)
- [x] A-007 R1: A narrow client viewing another window in a grouped session does not shrink the viewed window (scoping via `aggressive-resize on`). (verified live during intake — intake.md § Why this approach: 105-col grouped `_rk-pin-*` viewer of window 2 leaves window 1 at 200 cols; rests on standard tmux `aggressive-resize` semantics)

### Scenario Coverage
- [x] A-008 R2: The integration test skips cleanly when tmux or a pty is unavailable and cleans up its clients and server. (verified by inspection: `exec.LookPath` skip, `new-session` failure → `t.Skipf`, pty failure → `t.Skipf`; `t.Cleanup` kills each client, `kill-server` under a 10 s context, plus a captured-pid `SIGKILL` backstop that does not go through the wedged socket)

### Code Quality
- [x] A-009 Pattern consistency: the new test uses `testSocketName`, `exec.CommandContext` with timeouts, and the package's `t.Cleanup` kill-server hygiene; the conf comment states the constraint the lines cannot show. (verified; the long-lived pty attach client intentionally uses `exec.Command` — same shape as the production relay's `pty.StartWithSize` clients — and is killed in cleanup)
- [x] A-010 No unnecessary duplication: no new tmux helpers; existing `DefaultConfigBytes` and `creack/pty` reused. (verified; `waitForClients` is a test-local poll helper with no pre-existing package equivalent)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new conf options, tests, and comment corrections without making existing code redundant (the s9fw `@rk_pane_git_*` stamping and fork-free border format stay in active use; the conf previously carried no explicit `window-size` line, so nothing was superseded in-repo).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Place the new options in their own commented conf section rather than under `# --- General ---` | Keeps the defect rationale next to the lines; the conf is section-organized already | S:70 R:95 A:90 D:80 |
| 2 | Confident | The integration test lives in `internal/tmux` beside the conf tests and uses the PATH `tmux` like sibling tests | Same package owns the embed and the socket hygiene; the guard shim on PATH is what every other real-tmux test uses | S:75 R:90 A:85 D:80 |
| 3 | Confident | Memory edits are deferred to hydrate; apply touches only conf, tests, comments, and the report | Standard stage split; the intake enumerates the three memory files | S:80 R:90 A:90 D:85 |

3 assumptions (0 certain, 3 confident, 0 tentative).

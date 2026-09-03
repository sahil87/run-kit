# Plan: Reopen closed tab — ⇧⌘T rebinding + recently-closed window stack

**Change**: 260829-11t0-reopen-closed-tab-recently-closed-stack
**Intake**: `intake.md`

## Requirements

### Keyboard: ⇧⌘T rebinding

#### R1: `reopen-window` owns ⇧⌘T on the mac shell
`DEFAULT_BINDINGS` in `app/frontend/src/lib/keybindings.ts` MUST gain a `reopen-window` row: `code: ""` (keyless base), `tier: "shifted"`, `macCode: "KeyT"`, `scope: "global"`, `kind: "builtin"`, `label: "Reopen closed tab"`, description naming the fresh-shell semantics, `mapLabel: "reopen tab"`. It MUST be palette-only on Win/Linux (unbound) and MUST resolve `disabledReason: "reserved"` in a mac browser (the existing shifted-`KeyT` "reopen tab" browser claim).

- **GIVEN** the mac desktop shell
- **WHEN** the effective map is computed
- **THEN** `reopen-window` resolves to ⇧⌘T and `create-window` still resolves to ⌘T (tier-disjoint on `KeyT`, `findConflicts` empty)

- **GIVEN** Win/Linux
- **WHEN** the default map is computed
- **THEN** `reopen-window` is `""` (unbound), ⇧Ctrl+T is still `create-window`, ⇧Ctrl+N is still `create-session`

#### R2: `create-session` is fully palette-only on mac
`create-session` MUST replace `macCode: "KeyT"` with a mac-keyless refinement (`macCode: ""`), and `defaultComboFor` MUST treat an empty-string `macCode` as "unbound on mac" (test `macCode !== undefined`, not truthiness), so neither ⇧⌘T nor ⇧⌘N fires `create-session` in the mac shell. Win/Linux ⇧Ctrl+N is unchanged. The `DEFAULT_BINDINGS` header comment MUST describe the new map (⌘T new tab · ⇧⌘T reopen tab · ⌘W close tab) and no longer list `create-session` among the `macCode` exceptions.

- **GIVEN** the mac shell
- **WHEN** ⇧⌘N is pressed
- **THEN** no `create-session` handler fires (the palette entry remains available)

### Backend: recording at the kill seam

#### R3: `handleWindowKill` records a `ClosedWindow` before killing
`app/backend/api/windows.go` `handleWindowKill` MUST, before `s.tmux.KillWindow`, capture the window as a `snapshot.ClosedWindow` (`ID`, `ClosedAt`, `Server`, `Session`, `Window snapshot.Window` incl. panes + the full `@rk_win_*` set, `ChatProvider`/`ChatRef` from `sessions.ResolveChatPane`) using the existing snapshot capture reads (a single-window variant of the layout read MAY be added in `internal/tmux/layout.go`), push it onto the per-server ring, and widen the response to `{"ok": true, "closed": {ClosedWindow}}`. Capture failure MUST be `slog.Debug` and MUST NOT block or fail the kill (response then omits `closed`).

- **GIVEN** a window with `@rk_win_*` options and a Claude pane
- **WHEN** `POST /api/windows/{id}/kill` succeeds
- **THEN** the response carries `closed` with the option set and `chatProvider: "claude"`, and `GET /api/windows/closed` lists it newest-first

- **GIVEN** the capture read errors
- **WHEN** the kill is requested
- **THEN** the window is still killed and the response is `{"ok": true}`

#### R4: Per-server recently-closed ring under `internal/snapshot`
`internal/snapshot` MUST persist closed records at `{server}.closed/{unix-nanos}.json` under the existing store root via `fsatomic.WriteFile`, capped by a named constant `ClosedRingCap = 10` (oldest pruned on write), with `Store` methods to push, list (newest-first), load-by-id, and delete. Server names never contain `.`, so `.closed/` cannot collide with a server directory.

- **GIVEN** 10 records exist
- **WHEN** an 11th is pushed
- **THEN** the oldest file is removed and the listing has exactly 10 entries newest-first

### Backend: reopen

#### R5: Closed-window routes
`app/backend/api/router.go` MUST register `GET /api/windows/closed`, `POST /api/windows/closed/{id}/reopen`, `POST /api/windows/closed/{id}/dismiss`, all `?server=`-addressed (handlers in a new `app/backend/api/closed_windows.go`). Unknown `{id}` → 404. `dismiss` deletes the record and returns `{"ok": true}`.

- **GIVEN** a record `{id}`
- **WHEN** `POST …/{id}/dismiss` is called
- **THEN** the record is gone from `GET /api/windows/closed`

#### R6: `snapshot.ReopenWindow` recreates the shell from a record
A new `ReopenWindow(ctx, server, rec ClosedWindow, ops restoreOps) (windowID string, err error)` beside `Restore` MUST: (1) refuse with a typed session-gone error when `rec.Session` no longer exists (`409` at the route, record dropped); (2) create the window with `createWindowAt(session, rec.Window.Index, rec.Window.Name, cwd)` and fall back to `tmux.CreateWindowWithOptionsID` (append) when the index is occupied; (3) degrade a missing cwd to `$HOME` via `restoreCwd`; (4) re-stamp options with the exported `WindowOptionOps(rec.Window)` (rename of `windowOptionOps`, no second option list); (5) recreate additional panes at their cwds and `selectLayout` via the restore engine's pane path; (6) `selectWindow` the new window. The route then deletes the record and responds riff-shaped `{server, session, window, windowId}`.

- **GIVEN** a record whose session exists and whose index is free
- **WHEN** reopen runs
- **THEN** a window with the same name/index/cwd exists and `show-options -w` matches `WindowOptionOps(rec.Window)`

- **GIVEN** the session is gone
- **WHEN** reopen runs
- **THEN** the route returns `409` naming the session and the record is deleted

#### R7: Resume agent replaces the fresh shell via the fork seam
`POST /api/windows/closed/{id}/resume?server=` with body `{"replaceWindowId": "@N"}` MUST, when `rec.ChatProvider == "claude"` and `rec.ChatRef` matches `forkSessionUUIDRe`: spawn via `s.riff.Spawn` with byte-for-byte the `handleWindowFork` options (`Where: "checkout"`, `RepoRoot: firstPaneCwd(rec.Window)`, `ResumeSessionRef: rec.ChatRef`, `WindowNameBase: rec.Window.Name`), re-stamp `WindowOptionOps(rec.Window)` onto the spawned window, then kill `replaceWindowId` directly through `s.tmux.KillWindow` (NOT via the recording kill seam — no phantom record), delete the record, and respond riff-shaped. Gates mirror fork: non-repo cwd → `400` (`forkNonRepoMsg`), non-claude provider / bad ref → `404`, riff `ValidationErr` → `riffStatusForError`. No `riff.Options` change.

- **GIVEN** a record with a Claude ref and a repo-rooted cwd, and the reopened shell window `@N`
- **WHEN** resume is called with `replaceWindowId: "@N"`
- **THEN** a window running `<launcher> --resume <uuid> --fork-session` exists with the record's `@rk_win_*` options, `@N` is gone, and `@N` is NOT on the closed ring

### Frontend: palette, dispatcher, mirror, toast

#### R8: Stack-gated palette entry and chord dispatch
`app/frontend/src/app.tsx` MUST register a `Tab: Reopen closed` palette entry (id `reopen-window`, description `"<name> — fresh shell in <session>"`) only when the current server's mirror stack is non-empty, and the dispatcher handler map MUST route `"reopen-window"` through `fromPalette("reopen-window")` so ⇧⌘T on an empty stack falls through untouched.

- **GIVEN** an empty stack
- **WHEN** ⇧⌘T is pressed in the mac shell
- **THEN** no request is made and the event is not `preventDefault`ed

#### R9: Client API + per-server mirror
`app/frontend/src/api/client.ts` MUST gain `listClosedWindows(server)`, `reopenClosedWindow(server, id)`, `dismissClosedWindow(server, id)`, `resumeClosedWindow(server, id, replaceWindowId)`, and `killWindow` MUST return `{ ok: boolean; closed?: ClosedWindow }`. A `useRecentlyClosed(server)` hook (or store slice beside `store/window-store.ts`) MUST seed from `GET /api/windows/closed` on server mount, push from the kill response in `use-dialog-state.ts` `executeKillWindow` and `app.tsx` `executeBulkClose`, and pop on reopen/dismiss. The server record is authoritative; the mirror only gates the entry.

- **GIVEN** a window is killed via the confirm dialog
- **WHEN** the response carries `closed`
- **THEN** the palette shows `Tab: Reopen closed` with the ⇧⌘T hint without a refetch

#### R10: Reopen flow with post-reopen "Resume agent" toast
Selecting the entry / pressing ⇧⌘T MUST call reopen, navigate to `/$server/$windowId` (the fork flow's navigation), pop the mirror, and toast `Reopened "<name>" (fresh shell)`. When the popped record carried `chatProvider`/`chatRef`, the toast MUST carry a `Resume agent` action (`addToast(message, variant, action)`) that calls `resumeClosedWindow(server, id, newWindowId)` and navigates to the spawned window; the record stays on the server until resume/dismiss. Toast dismissal (timeout or explicit) MUST call `dismissClosedWindow`. A `409` session-gone reopen MUST toast the error and pop the mirror.

- **GIVEN** a record with a Claude ref
- **WHEN** reopen succeeds
- **THEN** the toast shows a `Resume agent` button; pressing it replaces the shell window with the resumed agent window

### Tests

#### R11: Coverage
Go tests MUST cover the ring (cap/prune/pop/list order), `ReopenWindow` over the fake `restoreOps` (index hit, occupied fallback, dead cwd → `$HOME`, session-gone, option set equality), the kill handler (record in response; capture failure still kills), the three routes + resume gates. Vitest MUST cover `keybindings.test.ts` (mac shell ⇧⌘T → `reopen-window`, `create-session` unbound on mac, empty-`macCode` `defaultComboFor`, mac browser both `reserved`, Win/Linux map gains `"reopen-window": ""`, palette-id table) and palette gating. Playwright `app/frontend/tests/e2e/shortcut-registry.spec.ts` MUST add a mac-shell-spoofed test (⇧⌘T POSTs `/api/windows/closed/*/reopen` when the mocked stack is non-empty; falls through when empty) and a Win/Linux no-regression test (⇧Ctrl+T creates a window, ⇧Ctrl+N creates a session); the `:687` intent comment is rewritten; `session-name-prompt.spec.ts` and `row-flyout.spec.ts` prose mentioning ⇧⌘T is swept. Every new `test()` carries the Proves/Steps JSDoc block. Mutating-route mocks MUST end in `*` (the `?server=` suffix).

- **GIVEN** the suites above
- **WHEN** `go test ./...`, `npx vitest run`, and the named e2e spec run
- **THEN** all pass

### Non-Goals

- Recording kills that bypass `POST /api/windows/{id}/kill` (shell `kill-window`, `rk mux kill`, process exit, session/server kills)
- Process resurrection beyond the opt-in agent resume; scrollback/env are never captured
- Any `@rk_win_*` inventory change, new settings key, or `RK_*` env var
- A Win/Linux chord for `reopen-window`; recreating a vanished session

### Design Decisions

#### ⇧⌘T moves from create-session to reopen-window
**Decision**: `reopen-window` takes ⇧⌘T on the mac shell; `create-session` becomes fully palette-only on mac.
**Why**: ⇧⌘T is the universal reopen-closed-tab reflex (browsers, VS Code, iTerm2); mac shell was the only host where it meant something else. New-session is rare enough for the palette.
**Rejected**: keeping ⇧⌘N live for create-session on mac — the user chose full palette-only to avoid a chord that exists on no other mac host.
*Introduced by*: 260829-11t0-reopen-closed-tab-recently-closed-stack

#### Recently-closed ring lives server-side under internal/snapshot
**Decision**: `{server}.closed/{unix-nanos}.json`, cap 10, `fsatomic`, read by the api package as a second recovery-reader consumer.
**Why**: the client cannot see `@rk_win_web_<n>_root` (omitted from `ListWindows`); the disk ring survives reload and daemon restart; it fits the Constitution II recovery-backup carve-out the server snapshots already occupy.
**Rejected**: a client-only Zustand stack — loses state and dies on reload.
*Introduced by*: 260829-11t0-reopen-closed-tab-recently-closed-stack

#### Resume agent replaces the fresh shell window
**Decision**: the toast's Resume agent spawns a new window through `riff.Spawn` (fork seam verbatim) and kills the placeholder shell directly via tmux.
**Why**: the user chose zero riff seam change; `riff.Spawn` can only create windows, so resuming *into* the reopened shell would need a new launcher-injection path. The placeholder is seconds old and idle.
**Rejected**: send-keys the launcher into the reopened pane (new seam, launcher string leaves riff's validation); a plain `--resume` knob (seam change).
*Introduced by*: 260829-11t0-reopen-closed-tab-recently-closed-stack

## Tasks

### Phase 1: Setup

- [x] T001 Add `ClosedWindow` type, `ClosedRingCap = 10`, and `Store` ring methods (`PushClosed`, `ListClosed`, `LoadClosed`, `DeleteClosed`, `closedDir`) in `app/backend/internal/snapshot/closed.go` with tests in `closed_test.go` (cap/prune order, newest-first list, delete, atomic write) <!-- R4 -->
- [x] T002 [P] Export `WindowOptionOps` (rename `windowOptionOps`) in `app/backend/internal/snapshot/restore.go`; add `CaptureWindow(ctx, server, windowID) (Window, session string, err)` in `snapshot.go` reusing the layout reads (add a single-window read in `app/backend/internal/tmux/layout.go` if the existing walk is server-wide) <!-- R3 -->

### Phase 2: Core Implementation

- [x] T003 Implement `ReopenWindow(ctx, server, rec, ops)` in `app/backend/internal/snapshot/reopen.go` (session check → createWindowAt / append fallback → restoreCwd → WindowOptionOps → pane path + selectLayout → selectWindow) with `reopen_test.go` over the fake `restoreOps` <!-- R6 -->
- [x] T004 Widen `handleWindowKill` in `app/backend/api/windows.go`: capture via `CaptureWindow` + `sessions.ResolveChatPane`, `PushClosed`, `slog.Debug` on failure, respond `{ok, closed?}`; tests in `windows_test.go` <!-- R3 -->
- [x] T005 Add `app/backend/api/closed_windows.go` with `handleClosedList`, `handleClosedReopen`, `handleClosedDismiss`, `handleClosedResume` (fork-wiring verbatim, re-stamp, direct `KillWindow` of `replaceWindowId`, gates) and register routes in `router.go`; tests in `closed_windows_test.go` <!-- R5 R7 -->
- [x] T006 [P] Edit `app/frontend/src/lib/keybindings.ts`: add the `reopen-window` row, set `create-session` `macCode: ""`, fix `defaultComboFor` for empty `macCode`, rewrite the header comment; update `keybindings.test.ts` (`:62` map, `:723` table, `:1629`, `:1674`, new `defaultComboFor` case) <!-- R1 R2 -->
- [x] T007 [P] Add client calls + `ClosedWindow` type in `app/frontend/src/api/client.ts`, widen `killWindow`; add `app/frontend/src/hooks/use-recently-closed.ts` (seed / push / pop per server) with a colocated test <!-- R9 -->

### Phase 3: Integration & Edge Cases

- [x] T008 Wire `app/frontend/src/app.tsx`: stack-gated `Tab: Reopen closed` entry, `"reopen-window": fromPalette(...)` handler, reopen action (navigate + toast with `Resume agent` action + dismiss-on-close), 409 handling; push from `use-dialog-state.ts` `executeKillWindow` and `executeBulkClose` <!-- R8 R10 -->
- [x] T009 Playwright: extend `app/frontend/tests/e2e/shortcut-registry.spec.ts` (mac-shell ⇧⌘T reopen POST / empty-stack fall-through; Win/Linux ⇧Ctrl+T / ⇧Ctrl+N no-regression; rewrite the `:687` comment), sweep `session-name-prompt.spec.ts` + `row-flyout.spec.ts` for ⇧⌘T prose, Proves/Steps blocks, mocks end in `*` <!-- R11 -->

### Phase 4: Polish

- [x] T010 Run gates: `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit && npx vitest run`, `just test-e2e "tests/e2e/shortcut-registry.spec.ts"`; fix fallout <!-- R11 -->

## Execution Order

- T001, T002 block T003–T005
- T003 blocks T005
- T006, T007 are independent of the backend; T008 needs T005 + T007
- T009 needs T006 + T008

## Acceptance

### Functional Completeness

- [x] A-001 R1: `reopen-window` row present; mac shell resolves ⇧⌘T → `reopen-window`, ⌘T → `create-window`; Win/Linux `reopen-window` unbound
- [x] A-002 R2: `create-session` has `macCode: ""`; `defaultComboFor` yields unbound for empty `macCode`; ⇧⌘N does not fire on the mac shell; header comment updated
- [x] A-003 R3: kill response carries `closed` with full `@rk_win_*` set and chat identity
- [x] A-004 R4: `.closed/` ring capped at `ClosedRingCap` via `fsatomic`, newest-first listing
- [x] A-005 R5: three routes registered, `?server=` addressed, 404 on unknown id
- [x] A-006 R6: `ReopenWindow` recreates name/index/cwd/options/panes/layout and selects the window; `WindowOptionOps` exported, no duplicate option list
- [x] A-007 R7: resume spawns via fork-identical `riff.Options`, re-stamps options, kills `replaceWindowId` directly, deletes record
- [x] A-008 R8: palette entry present only with non-empty stack; handler via `fromPalette`
- [x] A-009 R9: client calls + hook exist; kill flows push from response
- [x] A-010 R10: reopen navigates + toasts; `Resume agent` action shown only with agent identity; dismiss on toast close

### Behavioral Correctness

- [x] A-011 R2: Win/Linux ⇧Ctrl+N and ⇧Ctrl+T behavior unchanged
- [x] A-012 R3: capture failure still kills the window (`{ok: true}`)

### Scenario Coverage

- [x] A-013 R6: occupied index falls back to append; dead cwd degrades to `$HOME`
- [x] A-014 R11: Go, vitest, and the named e2e spec pass; new tests carry Proves/Steps blocks

### Edge Cases & Error Handling

- [x] A-015 R6: session gone → 409 naming the session, record dropped, client toasts and pops
- [x] A-016 R7: non-repo cwd → 400; non-claude/bad ref → 404; the replaced shell window never lands on the ring
- [x] A-017 R8: ⇧⌘T on empty stack makes no request and does not `preventDefault`

### Code Quality

- [x] A-018 Pattern consistency: handlers follow `fork.go`/`windows.go` shapes; tmux calls only through `internal/tmux`
- [x] A-019 No unnecessary duplication: `WindowOptionOps`, `firstPaneCwd`, `restoreCwd`, `ResolveChatPane`, `riffStatusForError` reused
- [x] A-020 Magic numbers: cap is a named constant; no new env var or settings key
- [x] A-021 Comments state constraints, not narration; no change IDs in code comments
- [x] A-022 Frontend type narrowing over `as` casts in the new hook/client code

### Security

- [x] A-023 R7: resume launcher composition stays inside riff (`ValidationErr` on non-claude launcher); `replaceWindowId` validated as `@N` before kill

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Resume replaces the fresh-shell window (direct tmux kill, no record) rather than injecting the launcher into it | Forced by "riff seam verbatim" + `riff.Spawn` creating windows; placeholder is idle and seconds old | S:70 R:75 A:80 D:70 |
| 2 | Confident | Resume is its own route (`…/{id}/resume` with `replaceWindowId`) instead of `reopen` with `{"resume": true}` | The toast fires after reopen already created a window; a separate verb keeps reopen idempotent and simple | S:75 R:85 A:85 D:75 |
| 3 | Confident | Record is retained after plain reopen until resume/dismiss; toast close calls dismiss | Needed so the toast action can resolve the id; ring pruning bounds leakage if dismiss is lost | S:70 R:80 A:80 D:70 |
| 4 | Certain | Session-gone → 409 + drop; no session recreation | Intake row #8, user did not ask for it | S:85 R:85 A:90 D:90 |
| 5 | Confident | Mirror is a hook (`useRecentlyClosed`) not a new Zustand slice unless one already fits | Smallest surface; server record authoritative | S:60 R:90 A:85 D:75 |
| 6 | Certain | The closed-window API file is `api/closed.go`, not `closed_windows.go` | Go's build constraint treats any `*_windows.go` suffix as a GOOS=windows-only file, so the plan's literal filename silently dropped the handlers from the build | S:95 R:90 A:90 D:95 |
| 7 | Confident | The mac-shell shortcuts-panel test asserts `create-session`'s keycap ABSENT and `reopen-window`'s present, instead of the prior "canonical chords rebind" pair | The mac-keyless refinement leaves `create-session` disabled-unbound on mac by design (R2); `reopen-window` takes the slot | S:80 R:70 A:60 D:45 |
| 8 | Confident | The Win/Linux no-regression e2e spoofs a non-mac SHELL host (`runkitShell` bridge marker, Linux platform) rather than a plain browser | The shifted N/T/W defaults resolve `reserved` in a browser host (the existing browser-reserved-keys block asserts inertness) — a plain-browser test can never dispatch them; a non-mac shell host drops the browser claims, which is the only host shape where the Win/Linux defaults are live | S:85 R:65 A:50 D:40 |

5 assumptions (1 certain, 4 confident, 0 tentative) plus 3 applied during task execution (rows 6–8: 1 certain, 2 confident).

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The only rename (`windowOptionOps` → exported `WindowOptionOps`) leaves no orphaned symbol; the ⇧⌘T chord swap from `create-session` to `reopen-window` is a behavior rebinding, not dead code.

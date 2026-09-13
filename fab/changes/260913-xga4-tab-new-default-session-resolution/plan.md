# Plan: rk tab new — Role-Aware Default Session Resolution

**Change**: 260913-xga4-tab-new-default-session-resolution
**Intake**: `intake.md`

## Requirements

### CLI: `rk tab new` default-session resolution

#### R1: Role gate on the inside-tmux default
When `--session` is omitted and `$TMUX_PANE` is set, `resolveTabNewSession` MUST classify the caller's own session name (read via `display-message -pt $TMUX_PANE '#{session_name}'` on the caller's socket, as today) with `tmux.SessionRole`. A `user` role MUST keep today's behavior byte-for-byte (the caller's own session, rung `caller`). Any non-user role (`operator`, `control`, `pin`, `reserved`) MUST enter the role-aware rung ladder (R2). The outside-tmux branch (`$TMUX_PANE` unset) MUST remain the target server's current session (rung `server`). An explicit `--session =S` MUST still win unconditionally (rung `explicit`).

- **GIVEN** a caller pane inside a session named `boot` (role `user`) **WHEN** `rk tab new` runs without `--session` **THEN** the window is created in `boot` **AND** `--json` reports `"session_rung":"caller"`.
- **GIVEN** a caller pane inside `_rk-operator` **WHEN** `rk tab new` runs without `--session` **THEN** the rung ladder decides the session and the ambient `_rk-operator` is never chosen.
- **GIVEN** `--session =work` **WHEN** the caller sits in `_rk-operator` **THEN** the window lands in `work` with `"session_rung":"explicit"`.

#### R2: Deterministic rung ladder over user-role candidates
Candidates SHALL be `tmux.ListSessionFacts(ctx, server)` on the target server, filtered to `Role == tmux.SessionRoleUser`, in enumeration order (the `rk mux sessions` row order). A pure function `pickLandingSession(candidates []tmux.SessionFacts, mainRoot string, rootOf func(string) string) (session, rung string, err error)` in `cmd/rk/tab_new.go` SHALL apply, in order: (1) exactly one candidate → it, rung `sole-user`; (2) else the first candidate for which `rootOf(candidate.Path)` is non-empty and equals `mainRoot` → it, rung `cwd-root`; (3) else the candidate with the highest `Attached`, ties resolved to the earliest row → it, rung `most-attached`; (4) zero candidates → `errNowhereToSpawn`. An enumeration error MUST surface as `resolve target session: list sessions: <err>`.

- **GIVEN** candidates `[work]` **WHEN** picked **THEN** `work`, `sole-user`.
- **GIVEN** candidates `[alpha(path /a), run-kit(path /home/u/code/run-kit)]`, `mainRoot=/home/u/code/run-kit`, `rootOf` returning the main root for `run-kit` and `/a` for `alpha` **WHEN** picked **THEN** `run-kit`, `cwd-root`.
- **GIVEN** candidates with attached `[0, 2, 2]` and no root match **WHEN** picked **THEN** the second row, `most-attached`; **GIVEN** attached `[0, 0]` **THEN** the first row.
- **GIVEN** zero candidates **THEN** `errNowhereToSpawn`.

#### R3: `nowhere to spawn` is an operational error raised before creation
When the ladder yields zero candidates, `rk tab new` MUST exit 1 with an error message containing `nowhere to spawn`, the caller's session name, the target server name, and the remedy `--session =S`, and MUST NOT create a window. Under `--json` the failure rides the central `ok:false` writer (no verb-local envelope code).

- **GIVEN** the only sessions on the server are `_rk-operator` (the caller's) and `_rk-ctl` **WHEN** `rk tab new` runs **THEN** exit 1, stderr contains `nowhere to spawn`, and `list-windows -a` shows no new window.

#### R4: `session_rung` in the `--json` document, rung note on stderr
`tabNewBirthJSON` MUST carry `SessionRung string \`json:"session_rung"\`` (always present, no `omitempty`) immediately after `Session`, with values drawn from named constants `explicit` / `caller` / `server` / `sole-user` / `cwd-root` / `most-attached`. On the human (non-`--json`) path, when a role-aware rung (`sole-user`/`cwd-root`/`most-attached`) decided, one line `session: <name> (<rung>)` MUST ride the sink's chatter channel (`Notef`, stderr, suppressed by `--quiet`); stdout stays exactly `@N`.

- **GIVEN** `rk tab new --json` from a `user`-role caller **THEN** the result has exactly the keys `session`, `session_rung`, `window_id`, `pane_id` and `session_rung == "caller"`.
- **GIVEN** an `_rk-operator` caller and a single user session **WHEN** `rk tab new` (no `--json`) runs **THEN** stdout is `@N\n` and stderr contains `session: <name> (sole-user)`.

### Git: main-worktree root resolution

#### R5: `gitinfo.MainWorktreeRoot`
`internal/gitinfo` SHALL export `MainWorktreeRoot(ctx context.Context, dir string) string`, which runs `git -C <dir> rev-parse --path-format=absolute --git-common-dir` through `exec.CommandContext` with a 5 s timeout and an argument slice, and returns `filepath.Clean` of the common dir's parent when the common dir's base is `.git`, else the common dir itself; it returns `""` when `dir` is empty, not inside a repository, `git` is absent, or the command fails/times out. Both sides of the R2 comparison go through it; `""` never matches.

- **GIVEN** a temp repo `R` and a linked worktree created with `git worktree add <R>.worktrees/wt` **WHEN** `MainWorktreeRoot(wt)` **THEN** it equals `MainWorktreeRoot(R)` which equals `R` (cleaned).
- **GIVEN** a non-repo temp dir **THEN** `""`.

### CLI: `rk present --window`

#### R6: `rk present --window` inherits the resolver
`presentViaNewWindow` MUST call the widened resolver with its own working directory (the process cwd) so it receives the same gate and ladder; its stdout contract is unchanged and it prints no rung.

- **GIVEN** an `_rk-operator` caller and a sole user session **WHEN** `rk present --window <target>` runs **THEN** the window lands in the user session.

### Docs: help, specs, memory

#### R7: Help text documents the rule
`rk tab new --help` MUST describe the role-gated default (four rungs and the infra-session gate), the `nowhere to spawn` error, and the `session_rung` key; the `--session` flag help MUST mention the infra-session default. The `Use` line is unchanged.

- **GIVEN** `rk tab new --help` **THEN** the output contains `session_rung` and `nowhere to spawn`.

#### R8: Specs updated
`docs/specs/ui-state.md` § `rk tab` MUST describe the default-session rule and list `session_rung` in the `--json` comment; `docs/specs/mcp.md`'s Spawn row MUST add `"session_rung"` to the documented `tab new` document.

- **GIVEN** the two spec files **THEN** each mentions `session_rung`.

### Non-Goals

- No change for `user`-role callers or for callers outside tmux (incl. the MCP executor door).
- No new flag, config key, or stamped tmux option.
- `rk riff --session` untouched.
- The fab-kit follow-through (dropping fab-operator §6 step 2) is a separate change.
- Memory hydration is the hydrate stage's job, not an apply task (Affected Memory in `intake.md`).

### Design Decisions

#### Role-aware landing-session default lives in rk, not in the orchestrator
**Decision**: `rk tab new` picks the landing session itself when its caller sits in an `_rk-*` infrastructure session, over `tmux.SessionRole` + `tmux.ListSessionFacts`, and reports the deciding rung.
**Why**: rk owns the substrate facts (roles, attached counts, start paths); every orchestrator re-deriving them through `rk mux sessions --json` drifts (fab-operator's policy was reworked four times). A deterministic in-process pick with a reported rung lets callers drop their own policy.
**Rejected**: keeping the choice in fab-kit (drift, duplicated policy per orchestrator); a stamped `@rk_ses_*` preference option (Constitution II — derivable facts are derived).
*Introduced by*: 260913-xga4-tab-new-default-session-resolution

#### Rung 2 compares main-worktree roots on both sides
**Decision**: a candidate matches when `MainWorktreeRoot(candidate.Path) == MainWorktreeRoot(cwd)`, not when `candidate.Path` literally equals the cwd's main root.
**Why**: strict superset of literal equality that also matches a user session started in a repo subdirectory or in another worktree of the same repo; linked worktrees live in the sibling `<repo>.worktrees/` directory, so only git's common dir ties them to the main checkout.
**Rejected**: prefix matching on paths (fails for the sibling directory); literal equality (misses subdirectory-rooted sessions).
*Introduced by*: 260913-xga4-tab-new-default-session-resolution

## Tasks

### Phase 1: Setup

- [x] T001 Add `MainWorktreeRoot(ctx, dir)` to `app/backend/internal/gitinfo/gitinfo.go` (5 s `exec.CommandContext`, argv slice, `.git`-base → parent, bare → itself, `""` on any failure) plus tests in `app/backend/internal/gitinfo/gitinfo_test.go`: main checkout → itself, `git worktree add` sibling → main root, non-repo → `""`; skip when `git` is absent. <!-- R5 -->

### Phase 2: Core Implementation

- [x] T002 In `app/backend/cmd/rk/tab_new.go` add the rung constants (`sessionRungExplicit`…`sessionRungMostAttached`), `errNowhereToSpawn`, and the pure `pickLandingSession(candidates, mainRoot, rootOf)` implementing rungs 1–4 with earliest-row tie-breaks. <!-- R2 -->
- [x] T003 Widen `resolveTabNewSession` in `app/backend/cmd/rk/tab_new.go` to `(ctx, serverFlag, cwd string) (session, server, rung string, err error)`: keep explicit/server/caller paths, add the `tmux.SessionRole` gate on the caller's session, enumerate `tmux.ListSessionFacts` on the target server behind a stubbable seam (`tabNewSessionFactsFn`), resolve roots via a `tabNewMainRootFn` seam wrapping `gitinfo.MainWorktreeRoot`, and format the `nowhere to spawn` error with caller session, server, and the `--session =S` remedy. <!-- R1 -->
- [x] T004 Wire `runTabNew` in `app/backend/cmd/rk/tab_new.go`: pass the resolved cwd to the resolver, add `SessionRung` (always present, after `Session`) to `tabNewBirthJSON`, and emit `session: <name> (<rung>)` via `sink.Notef` on the human path only for role-aware rungs. <!-- R4 -->
- [x] T005 Update `presentViaNewWindow` in `app/backend/cmd/rk/present.go` to call the widened resolver with `os.Getwd()` (error → `resolve working directory: %w`) and ignore the rung. <!-- R6 -->

### Phase 3: Integration & Edge Cases

- [x] T006 [P] Unit tests for `pickLandingSession` in `app/backend/cmd/rk/tab_test.go` (or a new `tab_new_test.go`): sole-user, cwd-root via stubbed `rootOf` incl. the prefix-but-different-repo negative, most-attached with `[0,2,2]` and all-zero, zero candidates → `errNowhereToSpawn`. <!-- R2 -->
- [x] T007 Integration tests via `withTabTestServer` in `app/backend/cmd/rk/tab_test.go`: (a) `_rk-operator` caller + sole `boot` user session → `session_rung == "sole-user"` and the window lands in `boot`; (b) `_rk-operator` caller + two user sessions where the second is rooted at a temp repo and `--cwd` is its `git worktree add` sibling → `cwd-root`; (c) `_rk-operator` caller with every user session killed → exit 1, `nowhere to spawn`, no new window; (d) extend `TestTabNewJSONEnvelope` to assert `session_rung == "caller"` and exactly four keys; (e) human path stderr note `session: boot (sole-user)` with stdout `@N` only. <!-- R1 -->
- [x] T008 Run `just test-backend` (fresh worktree: `just _ensure-tmux-conf` first if `go test` reports `pattern tmux.conf: no matching files`) and fix any failures, including the `nowhere to spawn` error-path and any `present_test.go` fallout from the widened resolver signature. <!-- R3 -->

### Phase 4: Polish

- [x] T009 [P] Update `rk tab new` help in `app/backend/cmd/rk/tab_new.go` (`Long` paragraph on the rung ladder + `nowhere to spawn` + `session_rung`; `--session` flag help; `--json` key list) and the header comment of `tab_new.go`. <!-- R7 -->
- [x] T010 [P] Update `docs/specs/ui-state.md` § `rk tab` (`rk tab new` block: default rule + `session_rung` in the `--json` comment) and `docs/specs/mcp.md` Spawn row document shape (`"session_rung"`). <!-- R8 -->

## Execution Order

- T001 blocks T003 (the resolver wraps `gitinfo.MainWorktreeRoot`)
- T002 blocks T003, T003 blocks T004 and T005
- T006 depends on T002; T007 depends on T004 and T005; T008 runs after T007
- T009 and T010 are independent of each other and of Phase 3

## Acceptance

### Functional Completeness

- [x] A-001 R1: A `user`-role caller's default is unchanged (window lands in the caller's session, rung `caller`); an infra-role caller enters the ladder; `--session =S` always wins with rung `explicit`; outside tmux the server's current session is used with rung `server`.
- [x] A-002 R2: `pickLandingSession` implements sole-user → cwd-root → most-attached (earliest-row ties) → `errNowhereToSpawn` over user-role `SessionFacts` in enumeration order.
- [x] A-003 R3: Zero candidates exit 1 with `nowhere to spawn`, the caller session, the server, and `--session =S` in the message; no window is created.
- [x] A-004 R4: `--json` always includes `session_rung` after `session` with a value from the six named constants; the human path prints only `@N` on stdout and a `session: <name> (<rung>)` note on stderr for role-aware rungs.
- [x] A-005 R5: `gitinfo.MainWorktreeRoot` resolves a linked worktree to its main checkout, a main checkout to itself, and a non-repo to `""`, using `exec.CommandContext` with a timeout and an argv slice.
- [x] A-006 R6: `rk present --window` uses the widened resolver with its own cwd.
- [x] A-007 R7: `rk tab new --help` mentions the rung ladder, `nowhere to spawn`, and `session_rung`.
- [x] A-008 R8: `docs/specs/ui-state.md` and `docs/specs/mcp.md` mention `session_rung` and the default rule.

### Behavioral Correctness

- [x] A-009 R1: An `_rk-operator` caller never lands a window in `_rk-operator` by default (integration test asserts the landing session).
- [x] A-010 R4: The existing JSON key set grows by exactly one key and `ready` remains the only omitempty key.

### Scenario Coverage

- [x] A-011 R2: The worktree-sibling scenario (`--cwd <repo>.worktrees/<wt>` matching a session rooted at `<repo>`) is covered by a real-git integration test that skips without `git`.
- [x] A-012 R3: The zero-candidate scenario is covered by an integration test that kills every user session and asserts exit 1 plus no new window.

### Edge Cases & Error Handling

- [x] A-013 R2: A `ListSessionFacts` error surfaces as `resolve target session: list sessions: …` (exit 1).
- [x] A-014 R5: A `git` failure, timeout, or non-repo path yields `""` from `MainWorktreeRoot` and rung 2 is skipped without error.
- [x] A-015 R2: Attached-count ties (including all zero) pick the earliest enumeration row deterministically.

### Code Quality

- [x] A-016 Pattern consistency: New code follows the `*Fn` seam convention, `usageError`/operational error split, and `sink.Dataf`/`Notef` channel split of `cmd/rk`.
- [x] A-017 No unnecessary duplication: `tmux.SessionRole` and `tmux.ListSessionFacts` are reused; no second role table or session enumeration is introduced.
- [x] A-018 exec.CommandContext with timeout and argument slice for the git subprocess; no shell strings (Constitution I).
- [x] A-019 Magic strings: rung tokens and the `nowhere to spawn` phrase are named constants, not inline literals repeated across files.
- [x] A-020 Tests cover added behavior (per-rung unit tests, integration tests, gitinfo tests); run through `just test-backend`.
- [x] A-021 Comment narration: new comments state constraints (why the sibling-dir layout defeats prefix matching, why the note is stderr-only), never narrate the next line or cite change IDs.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality (the role-aware rung ladder, `gitinfo.MainWorktreeRoot`, `session_rung`) without making existing code redundant. The old inline session-resolution branches in `resolveTabNewSession` were restructured in place, not duplicated; `tmux.SessionRole`/`tmux.ListSessionFacts` are reused rather than re-derived.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The resolver signature widens to take `cwd` and return `rung` rather than adding package-level state | Two call sites (`tab new`, `present --window`); an explicit parameter keeps the pure picker testable and avoids hidden globals | S:70 R:90 A:85 D:80 |
| 2 | Confident | `ListSessionFacts` and `MainWorktreeRoot` are reached through `tabNewSessionFactsFn` / `tabNewMainRootFn` seams | The `*Fn` seam is the established `cmd/rk` test pattern (`muxSessionsFactsFn`, `ownTabRunOutputFn`) | S:75 R:95 A:90 D:85 |
| 3 | Certain | Integration tests create `_rk-operator` with raw `tmux new-session -d -s _rk-operator` on the test socket and point `$TMUX_PANE` at its pane | `withTabTestServer` already owns the socket and the `$TMUX_PANE` seam; `SessionRole` classifies by name only | S:85 R:95 A:95 D:95 |

3 assumptions (1 certain, 2 confident, 0 tentative).

# Plan: rk cron CLI

**Change**: 260906-bi3v-rk-cron-cli
**Intake**: `intake.md`

## Requirements

### CLI: `rk cron` family

#### R1: Family parent, registration, server resolution
A new cobra family `rk cron` SHALL be added in `app/backend/cmd/rk/cron.go`, registered on the
root command, with a persistent `-L/--server` flag inherited by the entry-file-scoped verbs
(`add`, `list`, `rm`, `mute`, `pin`). Server resolution MUST follow the `rk mux` order: explicit
`-L` wins; else the caller's own server from the original `$TMUX` socket basename
(`tmux.OriginalTMUX`, comma-truncated, `filepath.Base` — the `muxServer()` shape); else
`default`. The resolved name is the cron file slug and MUST pass `cron.ValidSlug` before any
path is built. `tick` MUST reject an explicitly-set `-L` with a usage error (the
`muxRejectInheritedServerFlag` pattern) because `cron.Tick` sweeps all live servers by design.

- **GIVEN** a shell inside a tmux pane on socket `/tmp/tmux-1001/work,12,0`
- **WHEN** `rk cron list` runs with no `-L`
- **THEN** the entry file for slug `work` is read
- **AND** `rk cron tick -L work` exits non-zero with a usage error naming the flag

#### R2: `add` schedule flags
`rk cron add <payload>` SHALL require the payload as a positional argument and exactly one
schedule flag — `--every <dur>`, `--backoff`, or `--cron "<expr>"` — erroring on zero or more
than one. `--every` parses as a Go duration and MUST be positive. `--backoff` SHALL build
`{kind: backoff, anchor: operator-idle, min: 60s, max: 30m}` with `--min <dur>` / `--max <dur>`
overrides (`max ≥ min` enforced by `Entry.validate` via `cron.Add`); `--min`/`--max` without
`--backoff` MUST be a usage error. `--cron "<expr>"` SHALL store the expression as schema-valid
intent and print a one-line stderr note that cron-expression evaluation lands in a later wave
(the C1 evaluator skips kind `cron`).

- **GIVEN** `rk cron add "check PRs" --every 1h`
- **WHEN** the command succeeds
- **THEN** the entry file gains `{schedule: {kind: every, interval: 1h}, payload: "check PRs"}` and the assigned 4-char id prints on stdout
- **AND GIVEN** `--every 1h --backoff` together, **THEN** the command exits non-zero with a mutual-exclusion usage error

#### R3: Creator auto-capture and default target
Inside a tmux pane (`$TMUX_PANE` set), `add` SHALL capture
`created_by: {pane: $TMUX_PANE, at: now}` — `created_by.session` stays EMPTY (session capture is
C9). The default target SHALL be `{kind: role, role: operator}` when the caller's own window
carries `@rk_win_role=operator` (window resolved from the pane, option read via
`tmux.GetWindowOption` with `tmux.RoleOption`), else `{kind: pane, pane: $TMUX_PANE}`. Explicit
`--role operator` / `--pane %N` flags (mutually exclusive) override auto-capture; `--pane` values
MUST pass `tmux.ValidPaneID` and `--role` accepts only `operator` (`cron.RoleOperator`). Outside
tmux (`$TMUX_PANE` unset) an explicit target flag is REQUIRED — hard error otherwise (the
`rk role` no-guessing posture). A failed role read (tmux error) SHALL degrade to the pane target,
not abort the add.

- **GIVEN** an agent pane `%12` in a window with no role, on socket `work`
- **WHEN** `rk cron add "tick me" --every 5m` runs
- **THEN** the stored entry has `target: {kind: pane, pane: "%12"}` and `created_by: {pane: "%12", at: <now>}` with no `session`
- **AND GIVEN** the same command in the window carrying `@rk_win_role=operator`, **THEN** the target is `{kind: role, role: operator}`
- **AND GIVEN** `$TMUX_PANE` unset and no target flag, **THEN** the command exits non-zero telling the caller to pass `--role` or `--pane`

#### R4: `add` optional flags and write path
`add` SHALL accept `--name <N>` (default: the payload truncated to 40 runes), `--deliver
immediate|when-idle` (default `immediate`), `--if-absent skip|notify|respawn` (default `skip`),
and `--pinned`. `--deliver`/`--if-absent` values MUST be validated against the schema constants
at parse time (the schema carries but does not enforce them — C3 owns enforcement). The write
MUST go through `cron.Add` (atomic read-modify-write, id generation, per-entry validation; a
corrupt file refuses to mutate and the error surfaces via RunE). On success stdout carries the
assigned id and a one-line entry summary (Toolkit Principle 9: data on stdout).

- **GIVEN** `rk cron add "x" --every 1h --deliver sometimes`
- **WHEN** parsed
- **THEN** the command exits non-zero naming the valid `--deliver` values, and the entry file is untouched

#### R5: `list` is disk-derived only
`rk cron list` SHALL read only the entry file (`cron.LoadEntries`) and the delivery log
(`cron.ReadLog` + `cron.LastDelivery`) — ZERO tmux commands (no next-fire/rung/orphan
derivation; those need live facts and belong to C5's API). Human output: one row per entry —
id, name, schedule summary (`every 1h` / `backoff 60s→30m` / `cron <expr>`), target
(`role:operator` / `pane:%12`), deliver, flags (`muted`/`pinned`), last-fired (or `-`).
`--json` SHALL emit the same records as a JSON array on stdout. An absent/empty file yields an
empty listing (or `[]`) with exit 0; load diagnostics print to stderr without failing the
listing (tolerant-load posture).

- **GIVEN** an entry file with one valid and one corrupt entry, and no tmux server running
- **WHEN** `rk cron list --json` runs
- **THEN** stdout is a one-element JSON array, a diagnostic line reaches stderr, exit is 0, and no tmux subprocess was spawned

#### R6: `rm`, `mute`, `pin`
`rk cron rm <id>` SHALL call `cron.Remove`; `rk cron mute <id> [--off]` and
`rk cron pin <id> [--off]` SHALL call `cron.SetMuted` / `cron.SetPinned` (bare verb sets true,
`--off` sets false). An unknown id MUST exit non-zero with `no entry <id>` on stderr. Each verb
prints a one-line confirmation on stdout.

- **GIVEN** an entry `a3f9`
- **WHEN** `rk cron mute a3f9` then `rk cron mute a3f9 --off` run
- **THEN** the file's `muted` flag flips true then back false, each run confirming on stdout
- **AND WHEN** `rk cron rm zzzz` runs, **THEN** exit is non-zero with `no entry zzzz`

#### R7: `tick` invoker verb
`rk cron tick` SHALL be a thin wrapper over `cron.Tick(ctx, cron.Deps{})` (production defaults:
flock, live-server filter, TMUX scrub, tolerant load — all inherited from C1, none
reimplemented). A held lock (handled inside `Tick`) MUST exit 0 quietly. No `Deliverer` is wired
in this change (C3's scope) — fires record outcome `no-deliverer`. On completion stdout carries a
one-line summary (servers swept, fires, diagnostics count); a real error (dir resolution, lock
creation) exits non-zero via RunE. The command context MUST be bounded (Constitution §I).

- **GIVEN** another process holds `cron/.lock`
- **WHEN** `rk cron tick` runs
- **THEN** it exits 0 with no fires and no error output

#### R8: Standards and test hygiene
The new family SHALL pass the toolkit help-dump standard (the `help_dump_test.go` audited
surface gains the family + verbs) and Principle 9 (data/confirmations on stdout, errors via RunE
to stderr, non-zero exits). All new `cmd/rk` tests MUST be immune to ambient tmux env — package
seams for `$TMUX_PANE`/`OriginalTMUX`/now (the `role.go`/`mux.go` idiom), and behavior verified
without a live tmux server wherever possible.

- **GIVEN** the repo's help-dump test
- **WHEN** it runs after this change
- **THEN** it passes with the `cron` family present in the dump

### Non-Goals

- Injection-engine delivery, `deliver: when-idle` gating, `if_absent` enforcement, circuit breakers — C3 (the `Deliverer` seam stays nil here)
- Daemon ticker goroutine, settings key, doctor row — C3
- HTTP API (`GET /api/cron`, POST mutations) and any UI — C5+
- `session` target auto-capture, orphan marking/GC — C8/C9
- 5-field cron-expression evaluation, `catch_up` — C9 (`--cron` stores intent only)
- Operator-tick entry seeding, `--wake-on`/`--suppress-while` flags — C4 seeds via the library
- Changes to `internal/cron` evaluation semantics

### Design Decisions

#### Bare `--backoff` with operator-idle defaults
**Decision**: `--backoff` is a boolean flag selecting anchor `operator-idle` with `min 60s` / `max 30m` defaults; `--min`/`--max` refine it.
**Why**: the spec's CLI table shows bare `--backoff`; the schema requires anchor+min+max; `operator-idle` is the only anchor C1 defines; the defaults are the spec's operator-tick values.
**Rejected**: a required `--backoff <anchor>` value (only one legal value exists — ceremony without choice); separate `--anchor` flag (same reason).
*Introduced by*: 260906-bi3v-rk-cron-cli

#### `list` never touches tmux
**Decision**: `list` derives from the entry file + delivery log only; no next-fire/rung/orphan columns.
**Why**: any tmux command against a dead socket resurrects it (the zombie-server rule); next-fire/rung need live facts and are C5's derivation scope behind the API.
**Rejected**: probing live servers for next-fire in the CLI (zombie hazard + duplicates C5's work).
*Introduced by*: 260906-bi3v-rk-cron-cli

#### Mute/pin unset via `--off`
**Decision**: `mute <id> [--off]` and `pin <id> [--off]`; no `unmute`/`unpin` verbs.
**Why**: smallest surface satisfying the spec's mute toggle; maps 1:1 onto `SetMuted`/`SetPinned(bool)`.
**Rejected**: separate un-verbs (doubles the surface); toggle-on-repeat (non-idempotent scripts).
*Introduced by*: 260906-bi3v-rk-cron-cli

#### Outside-tmux adds require an explicit target
**Decision**: `$TMUX_PANE` unset + no `--role`/`--pane` ⇒ hard error.
**Why**: the `rk role` posture — a typed command must not guess a target; auto-capture without a pane has nothing to capture.
**Rejected**: defaulting to `role:operator` (writes intent against a server the caller may not mean).
*Introduced by*: 260906-bi3v-rk-cron-cli

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/backend/cmd/rk/cron.go`: family parent (`Use: "cron"`, short/long help), persistent `-L/--server`, `cronServer()` resolution (mirror `muxServer()`: flag > `tmux.OriginalTMUX` socket basename > `default`), `cron.ValidSlug` guard helper, `-L` rejection helper for `tick`; register the family in the root command; colocated `cron_test.go` covering resolution order with the `$TMUX` seam. <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 Create `app/backend/cmd/rk/cron_add.go`: positional payload; schedule flags `--every`/`--backoff`/`--cron` (exactly-one enforcement), `--min`/`--max` (backoff-only guard, defaults 60s/30m, anchor `operator-idle`); optional `--name` (default payload truncated to 40 runes), `--deliver`, `--if-absent` (enum-validated against schema constants), `--pinned`; build `cron.Entry`, write via `cron.Add`, print assigned id + summary on stdout; stderr note when `--cron` stored; tests in `cron_add_test.go` (flag matrix, file contents round-trip via `cron.LoadEntries` on a temp dir). <!-- R2, R4 -->
- [x] T003 Creator auto-capture in `cron_add.go` (+ any small `internal/tmux` helper needed, e.g. window-for-pane via `display-message -p -t <pane> '#{window_id}'`, with its own test): `created_by {pane, at}` from `$TMUX_PANE` seam, `session` left empty; default target role-if-operator-window (via `tmux.GetWindowOption` + `tmux.RoleOption`, degrade to pane target on read error) else pane; explicit `--role operator` / `--pane %N` overrides (mutually exclusive, `tmux.ValidPaneID` / `cron.RoleOperator` validation); outside-tmux hard error without a target flag; tests with fn seams (no live server). <!-- R3 -->
- [x] T004 [P] Create `app/backend/cmd/rk/cron_list.go`: `cron.LoadEntries` + `cron.ReadLog`/`cron.LastDelivery`, human table + `--json` array on stdout, diagnostics to stderr, exit 0 on empty/absent; tests in `cron_list_test.go` (empty, mixed-valid file, --json shape, last-fired join; assert no tmux exec via seam). <!-- R5 -->
- [x] T005 [P] Create `app/backend/cmd/rk/cron_mut.go` (rm/mute/pin verbs): `cron.Remove`/`cron.SetMuted`/`cron.SetPinned`, `--off` on mute/pin, unknown-id non-zero `no entry <id>`, one-line stdout confirmations; tests in `cron_mut_test.go`. <!-- R6 -->
- [x] T006 [P] Create `app/backend/cmd/rk/cron_tick.go`: bounded context, `cron.Tick(ctx, cron.Deps{})`, one-line summary on stdout (servers/fires/diagnostics), quiet exit 0 on held lock (verify via a pre-held flock in `cron_tick_test.go` against a temp `Dir` — inject `Deps` through a package seam so tests never touch live servers). <!-- R7 -->

### Phase 3: Integration & Edge Cases

- [x] T007 Refresh the help-dump golden/audit for the new family (`cmd/rk/help_dump_test.go` surface), review help copy against Toolkit Principle 9 (data on stdout, errors stderr). <!-- R8 -->
- [x] T008 Verification sweep: `go build ./...`, `env -u TMUX -u TMUX_PANE go test ./cmd/rk/... ./internal/cron/...` from `app/backend`; fix fallout. <!-- R8 -->

## Execution Order

- T001 blocks everything (family + resolution helpers).
- T003 extends T002's file — run after T002.
- T004/T005/T006 are independent of each other ([P]) once T001 lands.
- T007–T008 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `rk cron` family registered; entry-scoped verbs resolve the server `-L` > caller socket > `default`; slug validated; `tick -L` is a usage error
- [x] A-002 R2: `add` enforces exactly-one schedule flag; `--every` positive-duration; bare `--backoff` builds `operator-idle`/60s/30m with `--min`/`--max` overrides; `--min` without `--backoff` errors
- [x] A-003 R3: inside a pane, `created_by` carries pane+at with EMPTY session; default target is role:operator only when the caller's window holds the role, else pane; `--role`/`--pane` override; outside tmux without a target flag errors
- [x] A-004 R4: `--deliver`/`--if-absent` enum-validated at parse; writes go through `cron.Add` only; id printed on stdout
- [x] A-005 R5: `list` and `list --json` produce the specified shapes from disk only
- [x] A-006 R6: `rm`/`mute`/`pin` (+`--off`) mutate via the C1 helpers; unknown id exits non-zero
- [x] A-007 R7: `tick` wraps `cron.Tick` with zero-value `Deps`; held lock exits 0 quietly; summary on stdout

### Behavioral Correctness

- [x] A-008 R2: `--cron` entries are stored schema-valid and a not-yet-evaluated note reaches stderr
- [x] A-009 R3: a failed window-role read degrades to the pane target (no abort)

### Scenario Coverage

- [x] A-010 R1: server-resolution order covered by tests using the `$TMUX` seam
- [x] A-011 R5: mixed valid/corrupt entry file lists the valid entry, diagnostics on stderr, exit 0
- [x] A-012 R7: held-lock quiet-exit covered by a test pre-holding the flock

### Edge Cases & Error Handling

- [x] A-013 R4: a corrupt entry file makes `add`/`rm`/`mute`/`pin` exit non-zero (refusing to mutate) without truncating the file
- [x] A-014 R6: `no entry <id>` on stderr with non-zero exit for unknown ids across rm/mute/pin

### Code Quality

- [x] A-015 Pattern consistency: family/verb files mirror the `rk mux` layout (parent + per-verb files, fn seams, grouped help)
- [x] A-016 No duplication: entry parsing, log parsing, id generation, and path building all come from `internal/cron`; no reimplementation in `cmd/rk`
- [x] A-017 All subprocesses via `internal/tmux` (`exec.CommandContext`, bounded) — no raw exec, no shell strings; no inline tmux command construction
- [x] A-018 New behavior covered by tests; `cmd/rk` tests pass under `env -u TMUX -u TMUX_PANE`
- [x] A-019 No comment narration; comments state constraints only (no change-id citations in code)

### Security

- [x] A-020 R1: the server slug is `cron.ValidSlug`-validated before any path build; `--pane` values pass `tmux.ValidPaneID`; user input never reaches a subprocess unvalidated

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Verb files named `cron_add.go`, `cron_list.go`, `cron_mut.go` (rm+mute+pin), `cron_tick.go` | mux family idiom (per-verb files); rm/mute/pin are three thin wrappers over one store seam | S:60 R:90 A:85 D:75 |
| 2 | Confident | `--name` defaults to the payload truncated to 40 runes | Spec leaves name optional; a derived default keeps `list` readable with zero extra flags | S:50 R:90 A:75 D:65 |
| 3 | Confident | `tick` output is a single summary line (servers, fires, diagnostics), not per-diagnostic dumps | C1 already slog-debugs diagnostics; a tick may run on a timer — quiet by default | S:55 R:85 A:75 D:65 |
| 4 | Confident | A small `internal/tmux` window-for-pane helper may be added if none exists (tested there), rather than raw display-message in cmd | code-quality anti-pattern: all tmux interaction through `internal/tmux` | S:60 R:85 A:85 D:75 |
| 5 | Confident | Role-read failure during auto-capture degrades to pane target | add must work on substrate hiccups; pane target is the honest fallback (the caller IS the pane) | S:55 R:80 A:75 D:65 |
| 6 | Confident | `cron.TickResult` gains additive `Held`/`Servers` fields so `tick` can stay quiet on a held lock and report servers swept | the quiet held-lock exit is indistinguishable from an empty sweep on `TickResult{}` alone; additive reporting, not an evaluation-semantics change | S:55 R:80 A:80 D:70 |
| 7 | Confident | `list`/`add` render durations compactly (`1h`, `1m→30m`) via a zero-component-dropping formatter | `time.Duration.String()` prints `1h0m0s`; the spec's table notation is the compact form | S:50 R:85 A:70 D:60 |
| 8 | Confident | `tick` injects deps through `cronTickDepsFn`/`cronTickRunFn` seams; the sweep context is bounded at 60s (`cronTickTimeout`) | the mux/role fn-seam idiom; per-call tmux timeouts apply underneath the sweep bound | S:55 R:80 A:75 D:65 |
| 9 | Certain | `--json` record shape is flat: `{id, name, schedule, target, deliver, pinned, muted, last_fired}` (booleans replace the FLAGS column, unix ts for last-fired) | the same records as the human rows, one field per column | S:80 R:85 A:80 D:80 |
| 10 | Certain | `$TMUX_PANE` is read live through the `cronTmuxPaneFn` seam (only `$TMUX` is stripped at package init) | internal/tmux's init strips `TMUX` only; `role.go` reads `TMUX_PANE` live the same way | S:85 R:85 A:85 D:85 |

10 assumptions (2 certain, 8 confident, 0 tentative).

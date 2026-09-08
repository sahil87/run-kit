# Plan: Cron Session Targets + Orphan GC

**Change**: 260908-f89x-cron-session-targets-gc
**Intake**: `intake.md`

## Requirements

### CLI: `rk cron add` session targeting

#### R1: Explicit `--session` flag
`rk cron add` MUST accept `--session <ref>` producing `Target{Kind: session, Session: <ref>}`. The three target flags (`--role`, `--pane`, `--session`) MUST be mutually exclusive, and the ref MUST be validated at parse time with the same shape rule `internal/tmux` applies to the `@rk_pane_agent_session` ref half (export the currently-private `isAgentSessionRef` as a public validator rather than duplicating it).

- **GIVEN** a shell (inside or outside tmux)
- **WHEN** `rk cron add "check PRs" --every 1h --session 4fe2…` runs with a shape-valid ref
- **THEN** the entry is written with `target: {kind: session, session: 4fe2…}`
- **AND** `--session x --role operator` (any pairing of two target flags) or a malformed ref is a usage error before any write

#### R2: Auto-capture ladder role → session → pane
With no explicit target flag, inside a tmux pane, the target default MUST follow the spec's ladder: the caller's window carries `@rk_win_role=operator` ⇒ role target; else the caller pane carries a parsed `@rk_pane_agent_session` ref ⇒ session target (a new pane-option read seam alongside `cronWindowRoleFn`); else the caller's own pane. Option-read failures MUST keep today's degrade posture (a note on the sink, fall to the next rung — never a guess, never an error).

- **GIVEN** a non-operator agent pane whose `@rk_pane_agent_session` carries `claude:4fe2…`
- **WHEN** `rk cron add "sweep" --every 1h` runs in it
- **THEN** the entry targets `{kind: session, session: 4fe2…}` (previously: the raw pane)
- **GIVEN** the same pane with no agent-session option stamped
- **WHEN** the same command runs
- **THEN** the entry targets the caller's pane, exactly as today

#### R3: `created_by.session` provenance
Every add made inside a pane whose `@rk_pane_agent_session` parses MUST fill `created_by.session` with the ref — regardless of which target kind the ladder or flags selected. Adds outside tmux or in ref-less panes leave it empty, as today.

- **GIVEN** an operator pane (role target selected) carrying a session ref
- **WHEN** an entry is added
- **THEN** `created_by: {session: <ref>, pane: %N, at: <now>}` is written

### Cron: orphan TTL expiry (GC)

#### R4: Derived orphaned-since, never stored
Orphaned-since MUST be derived, never persisted in the entry file (Constitution II; the spec's runtime-facts rule). Derivation: walk the entry's delivery-log lines newest→oldest; the trailing run is every line until the newest *resolved-class* line (outcome prefix `delivered` or `respawned` — evidence the target resolved). Orphaned-since = the timestamp of the oldest line in that trailing run; an entry with no log lines at all falls back to `created_by.at`. Absent-class and neutral lines (`skipped-absent`, `notified-absent`, `respawn-failed`, `rate-capped`, `failed…`) never terminate the run. Log-cap trimming may only make the derived age younger (expiry later), never older.

- **GIVEN** an entry whose log ends `delivered` (t0), `skipped-absent` (t1), `rate-capped` (t2), `skipped-absent` (t3)
- **WHEN** orphaned-since derives
- **THEN** it is t1 (the oldest line after the newest resolved-class line)
- **GIVEN** an entry with zero log lines
- **THEN** orphaned-since = `created_by.at`

#### R5: Expiry rule — 7d, `pinned` exempt, role never subject
Inside `tickServer`, after the dispositions (same flock, live servers only), an entry MUST be expired — removed from the intent file via the existing `Remove` mutation, with one delivery-log line `outcome: expired-orphan` — when ALL hold: target kind is `session` or `pane` (role entries never orphan); the target is unresolved in this tick's gathered facts; derived orphaned-since is ≥ 7 days ago (package constant, e.g. `OrphanTTL = 7 * 24 * time.Hour`); and the entry is not `pinned`. `muted` does NOT exempt (facts are gathered for muted entries even though they never fire). An entry whose absent disposition this tick came back resolved-class (a successful respawn) MUST NOT be expired this tick — the gathered facts and the GC's pre-disposition log view both predate the respawn, so without this guard GC would delete the entry right after reviving its agent. Expiry emits no push notification — the log line is the audit trail.

- **GIVEN** an unmuted, unpinned `session` entry unresolved for 8 days (per R4's derivation)
- **WHEN** the tick runs
- **THEN** the entry is gone from `<slug>.yaml` and the log's newest line for it is `expired-orphan`
- **GIVEN** the same entry but `pinned: true`
- **THEN** it survives every tick
- **GIVEN** a `muted`, unpinned entry unresolved ≥ 7d
- **THEN** it expires

#### R6: Read-side surfacing (additive)
`DeriveEntry` SHOULD gain `OrphanedSince` and `ExpiresAt` (zero-valued unless the entry is currently orphaned; `ExpiresAt` additionally zero for `pinned` and role entries), carried through `GET /api/cron` and `rk cron list --json` as additive optional fields. No frontend change in this change.

- **GIVEN** an orphaned unpinned session entry
- **WHEN** `GET /api/cron?server=<slug>` serves it
- **THEN** the payload carries `orphanedSince` and `expiresAt` alongside the existing `orphaned` field

### Cron: session respawn (`if_absent: respawn`)

#### R7: Disposition routing via a session-respawn seam
`cron.Deps` MUST gain a session respawner seam (e.g. `SessionRespawner func(ctx, Fire) Outcome`), and the Absent-loop disposition switch MUST route a due-but-absent `if_absent: respawn` fire with `Target.Kind == session` to it. A nil seam (and pane targets, always) keeps the existing notify degrade with the `respawn-unimplemented` diagnostic, byte-identical. The role path is untouched.

- **GIVEN** a session entry with `if_absent: respawn`, unresolved at fire time, seam wired
- **WHEN** the tick disposes the absent fire
- **THEN** the seam's returned outcome (`respawned` / `respawn-failed`) is the logged disposition and the rate cap applies as before
- **GIVEN** the same fire with a nil seam
- **THEN** today's `respawn-unimplemented` notify degrade runs

#### R8: Closed-ring record is the respawn source
The production session respawner (cmd/rk, wired in serve.go with snapshot-store access) MUST locate the target by scanning the server's recently-closed ring (`snapshotStore.ListClosed(server)`, newest-first) for the first record with `AgentRef == target.Session`. Gates mirror `handleClosedResume`: `AgentProvider` must be `claude` (`--resume` is Claude-only), the ref must pass the strict UUID gate before reaching launcher composition (Constitution I), and the record's first-pane cwd must be inside a git repo. No matching record, a non-claude record, or any failed gate ⇒ escalate: fail-silent `rk notify`-class notification naming the entry and server, outcome `respawn-failed`. The clock never guesses a cwd and never auto-answers walls.

- **GIVEN** a dead claude session whose window was killed (a ring record with matching `AgentRef` exists)
- **WHEN** the respawner runs
- **THEN** it resumes from the record's first-pane cwd
- **GIVEN** no ring record matches the session ref
- **THEN** the outcome is `respawn-failed` with a notify, and no tmux window is created

#### R9: Riff plain-resume mode
`internal/riff` MUST support composing `--resume <uuid>` WITHOUT `--fork-session`: `riff.Options` gains a knob (e.g. `ResumePlain bool`, meaningful only with `ResumeSessionRef`), threaded to `resumeForkLauncher` (shell.go). All existing fork callers (window fork, closed-resume HTTP paths) MUST compose byte-identically to today. The claude-only launcher gate and UUID re-validation apply to both modes.

- **GIVEN** `ResumeSessionRef: <uuid>, ResumePlain: true` and a claude launcher
- **WHEN** the launcher composes
- **THEN** it ends `--resume <uuid>` with no `--fork-session`
- **GIVEN** `ResumePlain: false` (or unset)
- **THEN** composition is byte-identical to today's fork form

#### R10: Spawn postlude — restamp and record drop
On a successful respawn spawn, the respawner MUST re-stamp the record's `@rk_win_*` option set on the spawned window (`snapshot.WindowOptionOps`, best-effort: a stamp failure logs and does not fail the respawn) and MUST drop the consumed ring record (`DeleteClosed`; a delete failure logs and does not fail the respawn) — the `handleClosedResume` postlude. The spawn itself goes through the riff seam: checkout mode at the record cwd, `WindowNameBase` from the record's window name, the record's owning session as the target tmux session.

- **GIVEN** a successful session respawn
- **WHEN** it completes
- **THEN** the spawned window carries the record's `@rk_win_*` options and the ring record is gone

#### R11: Readiness composite, then the payload
After the spawn, the respawner MUST deliver through `inject.DeliverWhenReady` under the `operatorDeliverDeadline`-class bound (the `cronRespawnDeliverFn` shape, its own named paste buffer). Any non-ready classification (parked/narrow/gone/readiness timeout) or send error escalates (notify + `respawn-failed`) — walls are never auto-answered. The delivered text is the **entry's payload itself** (a resumed conversation has its context restored; the role-respawn kickoff rule's rationale does not apply and no kickoff exists for arbitrary sessions), so the fire is consumed by this delivery — outcome `respawned`.

- **GIVEN** the resumed pane classifies `ready`
- **WHEN** delivery runs
- **THEN** the entry payload is injected and the logged outcome is `respawned`
- **GIVEN** the resumed pane parks at a trust wall
- **THEN** a notification fires, the outcome is `respawn-failed`, and no keys are sent to the pane

#### R12: Process-execution discipline
Every tmux-touching call in the new respawner MUST be an argv-slice `exec.CommandContext` with a timeout, addressed at the fire's stamped server (`-L <slug>` via the `cronRespawnPrefix` helper), under the daemon's TMUX/TMUX_PANE-scrubbed environment — inherited by routing through the existing helpers, never new shell strings.

- **GIVEN** any respawn on a non-default server
- **WHEN** tmux is touched
- **THEN** the command carries `-L <slug>` and an argv slice under a bounded context

### Non-Goals

- Cron-expression *evaluation*, `catch_up: once`, the `when-idle` hold-window bound — C9.
- The fab-kit `fab-operator.md` rewrite (replacement posture) — C10.
- Frontend/UI changes — the shipped orphan UI keeps working; expiry fields are additive backend surface only.
- Respawn for non-claude session targets and for `pane` targets — notify degrade stands.

### Design Decisions

#### Plain resume, not fork, for session respawn
**Decision**: Session respawn composes `--resume <uuid>` without `--fork-session` (new riff mode).
**Why**: The entry targets this session id; the SessionStart hook re-stamps the resumed pane with the same id, so the entry resolves again on the next fire. A fork mints a fresh id and the entry stays orphaned forever.
**Rejected**: Fork + rewriting the entry's target to the new id — mutates intent with a runtime fact, and a rewrite failure orphans permanently.
*Introduced by*: 260908-f89x-cron-session-targets-gc

#### Orphaned-since derives from the delivery log
**Decision**: Trailing-run derivation over the entry's log lines (fallback `created_by.at`); no schema field.
**Why**: Constitution II and the spec's rule that runtime facts are never entry-file fields; trimming degrades expiry conservatively later, never premature.
**Rejected**: An `orphaned_since` entry-file field — contradicts the spec's mutation set (add/rm/pin/mute) and turns intent into a state store.
*Introduced by*: 260908-f89x-cron-session-targets-gc

#### First delivery after resume is the bare payload
**Decision**: The respawner delivers the entry payload directly once ready; no kickoff.
**Why**: Resume restores the conversation's context, so the role-respawn "never the bare tick" rationale (fresh session, no tick convention in context) does not apply; no kickoff is defined for arbitrary sessions.
**Rejected**: A synthetic preamble/kickoff — adds a convention no payload author expects; payloads are idempotent and self-contained by contract.
*Introduced by*: 260908-f89x-cron-session-targets-gc

## Tasks

### Phase 1: Setup

- [x] T001 Export the agent-session-ref shape validator in `app/backend/internal/tmux/tmux.go` (public wrapper over `isAgentSessionRef`, e.g. `ValidAgentSessionRef`) + unit test <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 `app/backend/cmd/rk/cron_add.go`: add `--session` flag — three-way mutual exclusion, parse-time ref validation, help/examples and the outside-tmux error naming all three flags; extend `cron_add_test.go` <!-- R1 -->
- [x] T003 `app/backend/cmd/rk/cron_add.go`: auto-capture ladder role → session → pane via a new `cronPaneSessionFn` seam (pane-option read of `@rk_pane_agent_session`, parsed ref half); fill `created_by.session` on every in-pane add with a ref; degrade-on-error to the next rung; tests for each rung and each degrade <!-- R2, R3 -->
- [x] T004 [P] New `app/backend/internal/cron/orphan.go`: `OrphanedSince(log []LogLine, e Entry) int64` trailing-run derivation (resolved-class = `delivered*`/`respawned*` prefixes; fallback `created_by.at`) + `OrphanTTL` constant + `ExpiresAt` helper; table-driven tests incl. rate-capped-inside-streak, trim fallback, no-lines fallback <!-- R4 -->
- [x] T005 `app/backend/internal/cron/tick.go`: GC pass in `tickServer` after the dispositions — expire (Remove + `expired-orphan` log line) unpinned session/pane entries unresolved this tick with orphan age ≥ TTL; truth-table tests (pinned exempt, muted expires, role never subject, resolved-now never expires) <!-- R5 -->
- [x] T006 [P] `app/backend/internal/cron/derive.go`: additive `OrphanedSince`/`ExpiresAt` on `DerivedEntry`; thread through the `GET /api/cron` payload and `rk cron list --json` (locate the JSON mappers and extend); tests <!-- R6 -->
- [x] T007 [P] `app/backend/internal/riff/` (`riff.go`, `shell.go`): `Options.ResumePlain` knob threaded to `resumeForkLauncher` — plain form `--resume <uuid>`; fork-callers-byte-identical regression test <!-- R9 -->
- [x] T008 `app/backend/internal/cron/tick.go`: `Deps.SessionRespawner` seam + disposition-switch routing for session-kind respawn (nil seam and pane targets keep the notify degrade verbatim); tests for both branches <!-- R7 -->
- [x] T009 New `app/backend/cmd/rk/cron_respawn_session.go`: the production session respawner — ring scan by `AgentRef` (claude + UUID + git-root gates), riff spawn (checkout at record cwd, `ResumePlain`, `WindowNameBase`), `@rk_win_*` restamp, record drop, `DeliverWhenReady` composite with escalate-on-wall; seams mirroring `cron_respawn.go`; unit tests with fakes for every gate and outcome <!-- R8, R10, R11, R12 -->
- [x] T010 `app/backend/cmd/rk/serve.go` (+ wherever `cron.Deps` is built): wire `SessionRespawner` with snapshot-store access; ensure the store handle reaches the respawner without import cycles <!-- R7, R8 -->

### Phase 3: Integration & Edge Cases

- [x] T011 Escalation paths: no-record / non-claude / malformed-ref / non-repo-cwd / spawn failure / wall / send error each produce `respawn-failed` + one fail-silent notification, no window leak (kill nothing, create nothing after the gate that failed); covered in T009's test table but verified as a distinct pass over the code <!-- R8, R11 -->
- [x] T012 Run the scoped backend gates: `just test-backend` (or `cd app/backend && go test ./internal/cron/... ./internal/riff/... ./internal/snapshot/... ./cmd/rk/...` first, then the full `go test ./...`) — all green <!-- R5 -->

### Phase 4: Polish

- [x] T013 CLI-surface conformance: `rk cron add` help text final pass; check the new flag against the toolkit help-dump standard (`shll standards` — run the check if shll is on PATH, else note the audit source per Constitution § Toolkit Standards) <!-- R1 -->

## Execution Order

- T001 → T002 → T003 (validator before flag; flag before ladder)
- T004 → T005; T005 and T006 both depend on T004
- T007 and T008 are independent of each other; both block T009
- T009 → T010 → T011
- T012 after all implementation; T013 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `--session <ref>` creates a session-target entry; two target flags together or a malformed ref is a pre-write usage error
- [x] A-002 R2: In a non-operator agent pane, a flagless add targets the pane's session ref; the operator-role and bare-pane rungs behave as today
- [x] A-003 R3: `created_by.session` is filled on in-pane adds carrying a ref, for every target kind
- [x] A-004 R5: An unpinned session/pane entry unresolved ≥ 7d is removed by the tick with an `expired-orphan` log line
- [x] A-005 R7: A wired session-respawn fire logs the respawner's outcome; nil-seam and pane-target fires keep the notify degrade byte-identical
- [x] A-006 R8: The respawner resumes only from a matching claude ring record (cwd from the record); every gate failure is `respawn-failed` + notify
- [x] A-007 R9: `ResumePlain` composes `--resume <uuid>` with no `--fork-session`; all existing fork call sites compose byte-identically
- [x] A-008 R11: A ready resumed pane receives the entry payload (outcome `respawned`); a parked wall escalates without keystrokes

### Behavioral Correctness

- [x] A-009 R2: The former pane-default for non-operator agent panes is superseded by the session rung — verified by a test asserting the new default
- [x] A-010 R4: Orphaned-since derivation matches the trailing-run rule (resolved-class terminators; rate-capped neutral; `created_by.at` fallback) in table-driven tests
- [x] A-011 R5: `pinned` exempts; `muted` does not; role entries are never GC candidates; an entry that resolves this tick is never expired regardless of history

### Scenario Coverage

- [x] A-012 R5: Trim-degradation scenario tested — a truncated log yields a younger orphan age and no premature expiry
- [x] A-013 R10: Successful respawn re-stamps `@rk_win_*` and drops the ring record (both best-effort, neither failing the respawn)

### Edge Cases & Error Handling

- [x] A-014 R8: No-record, non-claude, malformed-ref, and non-repo-cwd paths each notify once, create no window, and log `respawn-failed`
- [x] A-015 R6: Derived `OrphanedSince`/`ExpiresAt` are zero-valued for resolved, pinned (ExpiresAt), and role entries; JSON fields are additive (existing consumers unaffected)

### Code Quality

- [x] A-016 Pattern consistency: new code mirrors sibling patterns (seam vars for testability, `cronRespawnPrefix`-style addressing, tolerant-load diagnostics)
- [x] A-017 No unnecessary duplication: reuses `Remove`, `WindowOptionOps`, `DeliverWhenReady`, `ListClosed`, `resumeForkLauncher` — no parallel implementations
- [x] A-018 Tests cover added behavior: every new public function and disposition branch has direct unit coverage (code-quality.md test mandate)
- [x] A-019 No comment narration: comments state constraints/invariants only, no change-ID citations in code comments

### Security

- [x] A-020 R12: All new subprocess calls are argv-slice `exec.CommandContext` with timeouts; the session ref passes the strict UUID gate before entering launcher composition; no shell-string construction

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant (the session-respawn notify-degrade in `tick.go` stays live as the nil-seam/pane-target fallback; the pre-disposition `gcLog` view is additive)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Resolved-class log outcomes for the trailing-run rule are the `delivered` and `respawned` prefixes; everything else (absent, rate-capped, failed) is run-neutral | Held outcomes never log; delivered/respawned are the only outcomes proving the target resolved | S:60 R:75 A:80 D:70 |
| 2 | Confident | `ExpiresAt` is zero for pinned entries (never expires) rather than reporting a hypothetical | A non-time is truthier than a time that will never fire | S:55 R:85 A:80 D:75 |
| 3 | Confident | The respawner takes the FIRST (newest) matching ring record when multiple carry the same `AgentRef` | Newest-first is `ListClosed`'s order and the newest capture has the freshest cwd/options | S:50 R:80 A:75 D:70 |
| 4 | Confident | The riff knob is a bool (`ResumePlain`) on `Options` only, no `EffectiveSpec` copy | Mirrors `ResumeSessionRef`'s own launcher-seam-consumed placement (the Tier precedent) | S:60 R:85 A:85 D:75 |
| 5 | Confident | `OrphanedSince` returns 0 when the entry's newest own log line is resolved-class; 0 is "never-expiring", and every consumer (GC, `OrphanExpiresAt`, derive) treats it as such | Forced by the never-premature invariant: returning a resolved line's timestamp would let log trimming derive an *older* age | S:60 R:80 A:80 D:70 |
| 6 | Confident | GC derives the orphan streak from a pre-disposition log snapshot taken right after `ReadLog` | A just-appended absent line would otherwise become a never-fired entry's only line, resetting its streak to now and defeating the `created_by.at` fallback; for existing runs both views are identical (streak = run's oldest timestamp) | S:55 R:75 A:80 D:65 |
| 7 | Confident | `rk cron list --json` surfaces the raw log-derived streak for session/pane targets without a live-resolution gate (API remains the live-gated surface); API fields are `omitempty`, CLI fields keep the fixed key set | The list verb's zero-tmux invariant bans resolution probes; both payloads stay purely additive | S:50 R:80 A:75 D:65 |
| 8 | Confident | The strict-UUID gate is re-declared locally in cmd/rk (mirroring the riff/api duplication precedent) rather than exported from one owner | The property must hold at the unescaped-launcher boundary; riff silently drops a malformed ref instead of escalating, which is the wrong posture for the clock | S:55 R:70 A:70 D:65 |
| 9 | Confident | `internal/tmux` also exports `ParseAgentSessionRef` and gains `GetPaneOption` (mirror of `GetWindowOption`) to serve the `cronPaneSessionFn` seam | The seam needs the full `provider:ref` parse; no pane-option read helper existed, and duplicating either rule in cmd/rk is what the plan forbids | S:65 R:80 A:85 D:75 |

9 assumptions (0 certain, 9 confident, 0 tentative).

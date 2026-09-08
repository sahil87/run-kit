# Intake: Cron Session Targets + Orphan GC

**Change**: 260908-f89x-cron-session-targets-gc
**Created**: 2026-09-09

## Origin

> Wave 4 change C8 "Session targets + GC" from `fab/plans/sahil/26-09-06-cron-clock-plan.md` (read that file's Wave 4 section and the 2026-09-09 off-plan-narrowing note below it for exact scope). Scope: session target kind (`@rk_pane_agent_session` capture + fire-time resolve already shipped in the evaluator per the narrowing note — remaining scope is the `--session` flag + creator session auto-capture), orphan marking + TTL expiry (7d, pinned exempt), `if_absent: respawn` via closed-session resume + readiness composite.

One-shot invocation from the execution plan. Design authority: `docs/specs/cron.md` (§ Targets & Fire-Time Resolution, § if_absent ladder, § Orphan GC, § Phasing P3). The plan's 2026-09-09 narrowing note fixes the scope boundary: session-target *fire-time resolution* already shipped (C5 wave — `internal/cron/facts.go` resolves `TargetSession` by matching panes' `@rk_pane_agent_session` ref), and `--cron` expressions are stored-as-intent; expression *evaluation*, `catch_up: once`, and the `when-idle` hold bound are C9, the fab-kit skill rewrite is C10 — all three are out of scope here.

## Why

1. **Agent adoption is gated on this change.** The plan's standing rule: "agent-created entries without GC are the immortal-cron hazard" — `rk cron` cannot be announced to agents beyond the operator until a session-scoped entry whose agent is gone stops being immortal. Today a `session` target that never resolves shows `orphaned` in the UI/`rk cron list` forever; nothing expires it.
2. **Session targets are second-class at creation.** The spec says creator auto-capture "defaults `target` to the session (role if one is held)", but `rk cron add` (cmd/rk/cron_add.go) only captures role-or-pane: a non-operator agent's entry targets its raw pane, which dies with the pane instead of following the agent session across pane relaunches. There is also no explicit `--session` flag, so a session target cannot even be named by hand, and `created_by.session` is never filled.
3. **`if_absent: respawn` is role-only.** The tick's disposition switch (internal/cron/tick.go, Absent loop) degrades session-target respawn to notify with a `respawn-unimplemented` diagnostic. The spec's P3 promise — "a cron that brings its dead agent back" via closed-session resume — is unimplemented, so a session entry whose agent exited can only nag, not recover.

If not done: the cron substrate stays operator-only (Wave 4's generalization goal unmet), and every early adopter who tries a session entry accumulates permanent orphans.

## What Changes

### 1. `rk cron add`: `--session` flag + creator session auto-capture

`cmd/rk/cron_add.go`:

- **New flag** `--session <ref>` → `Target{Kind: session, Session: <ref>}`. Mutually exclusive with `--role` and `--pane` (extend the existing pairwise check to all three). The ref is validated at parse time with the same shape rule `internal/tmux` applies to the `@rk_pane_agent_session` ref half (`isAgentSessionRef` — export a validator rather than duplicating the rule).
- **Auto-capture ladder becomes role → session → pane** (spec § Targets: "defaults `target` to the session (role if one is held)"). Inside a pane with no explicit target flag: window carries `@rk_win_role=operator` ⇒ role target (unchanged); else the caller pane carries a parsed `@rk_pane_agent_session` ref ⇒ **session target** (new middle rung, via a new seam alongside `cronWindowRoleFn` reading the pane option); else pane target (unchanged fallback). Option-read failures keep today's degrade-to-pane posture ("the caller IS the pane, so that fallback never guesses").
- **`created_by.session` is captured** whenever the caller pane carries a session ref — the schema field exists (`CreatedBy.Session`) and is currently never filled. Applies to every add made inside a pane, regardless of the chosen target kind.
- Help text / examples updated; the outside-tmux error message names `--session` alongside `--role`/`--pane`.

### 2. Orphan TTL expiry (GC) — 7d, `pinned` exempt

`internal/cron`:

- **Expiry rule**: a `session` or `pane` entry (role targets never orphan — spec) whose target is unresolved at this tick AND that has been continuously orphaned ≥ **7 days** AND is not `pinned` is **removed from the intent file** (the existing `Remove` mutation path, under the tick's flock) with one delivery-log line (`outcome: expired-orphan`) so the expiry is auditable, never silent. `muted` does not exempt — the spec exempts only `pinned`.
- **Orphaned-since is derived, never stored** (Constitution II; the spec's schema rule that runtime facts are never entry-file fields): it is the timestamp of the first line of the entry's *trailing run* of absent-outcome log lines (`skipped-absent`, `notified-absent`, `respawn-failed` — any successful delivery resets the run), falling back to `created_by.at` for an entry with no log lines at all. Log-cap trimming can only make the derived orphan age *younger* — expiry degrades to "later", never "premature".
- GC runs inside `tickServer` after the dispositions (same flock, same live-server-filtered scope — dead servers are never touched).
- **Read-side surfacing (additive)**: `DeriveEntry` gains `OrphanedSince`/`ExpiresAt` (zero-valued when not orphaned or pinned), carried through `GET /api/cron` and `rk cron list --json` so the shipped orphan UI can show "expires in Nd" without further backend work. No frontend changes required in this change.

### 3. `if_absent: respawn` for session targets — closed-session resume + readiness composite

The tick's Absent-loop disposition switch routes session-target respawn to a real respawner instead of the notify degrade (`cron.Deps` gains the session seam or the existing `Respawner` contract widens — the role path stays byte-identical). Production respawner in `cmd/rk` (sibling of `cron_respawn.go`, wired in serve.go):

1. **Locate the closed session**: scan the server's recently-closed ring (`snapshotStore.ListClosed`) for a record with `AgentRef == target.Session`. The record supplies everything the resume needs: provider, cwd (first pane), session name, window name. **No record ⇒ escalate** (rk notify + `respawn-failed` outcome) — without it there is no cwd to resume in, and the clock never guesses.
2. **Gates mirror `handleClosedResume`** (api/closed.go): provider must be `claude` (`--resume` is Claude-only — non-claude escalates), strict UUID gate on the ref before it reaches launcher composition (Constitution I), record cwd must be inside a git repo.
3. **Spawn through the riff seam, plain resume** — checkout mode at the record cwd, `WindowNameBase` from the record, `ResumeSessionRef` = the ref, composed as `--resume <uuid>` **without `--fork-session`**: the entry targets this session id, and a fork would mint a fresh id, leaving the entry orphaned forever. This extends `internal/riff`'s `resumeForkLauncher` seam with a fork/plain mode (new `Options` knob; existing fork callers stay byte-identical). Re-stamp the record's `@rk_win_*` options on the spawned window and drop the consumed ring record on success (both the `handleClosedResume` postlude).
4. **Readiness composite then payload**: `inject.DeliverWhenReady` under the `operatorDeliverDeadline`-class bound (the `cronRespawnDeliverFn` shape) — any non-ready classification (parked/narrow/gone/timeout) or send error escalates fail-silently and returns `respawn-failed`; walls are never auto-answered. The delivered text is the **entry's payload itself**, not a kickoff: a resumed conversation has its context restored by resume, so the role-respawn never-bare-tick rule (whose rationale is "a fresh session has no tick convention in context") does not apply, and no kickoff is defined for arbitrary sessions.

Existing guards inherited unchanged: the absent-fire rate cap already covers respawn attempts; every tmux call is argv-slice `exec.CommandContext` addressed at the fire's stamped server with the daemon's TMUX-scrubbed env.

## Affected Memory

- `run-kit/cron`: (modify) session-target creation (flag + auto-capture ladder + created_by.session), orphan TTL GC (derived orphaned-since, expired-orphan log line, pinned exemption), session respawn via closed-ring resume, DeriveEntry additive fields
- `run-kit/rk-riff`: (modify) the `ResumeSessionRef` launcher seam gains a plain-resume (no `--fork-session`) mode alongside fork
- `run-kit/layout-snapshots`: (modify) the recently-closed ring gains a second consumer — the cron session respawner reads records by `AgentRef` and drops the consumed record on successful resume

## Impact

- `app/backend/cmd/rk/cron_add.go` + test — flag, capture ladder, `created_by.session`
- `app/backend/internal/cron/` — tick.go (disposition switch, GC hook, `Deps` seam), new GC + orphaned-since derivation (+ tests: expiry truth table incl. pinned/muted, trailing-run math, trim fallback), derive.go additive fields, schema.go outcome constant
- `app/backend/cmd/rk/cron_respawn*.go` + serve.go — session respawner + snapshot-store wiring
- `app/backend/internal/riff/` — plain-resume launcher composition (+ test: fork path byte-identical)
- `app/backend/internal/snapshot/` — at most a small exported lookup-by-AgentRef helper (read-only otherwise)
- `app/backend/internal/tmux/` — export the agent-session-ref shape validator
- API/`rk cron list --json` payloads gain optional fields (additive; no frontend change required)
- CLI surface grows one flag → check against the toolkit help-dump standard (`shll standards`) per Constitution § Toolkit Standards
- Verification: `just test-backend` scoped first (`internal/cron`, `internal/riff`, `cmd/rk`), then the code-quality gate sequence

## Open Questions

- None — all decision points graded Confident or better (see Assumptions; #4 and #6 are the ones worth a `/fab-clarify` glance).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope excludes cron-expression evaluation, `catch_up: once`, `when-idle` hold bound (C9) and the fab-kit operator-skill rewrite (C10); session fire-time resolution is already shipped and untouched | The plan's 2026-09-09 narrowing note states this boundary explicitly | S:95 R:85 A:95 D:95 |
| 2 | Certain | Auto-capture ladder becomes role → session → pane; `created_by.session` filled when the caller pane carries a ref | Spec § Targets states the session default verbatim; the schema field already exists | S:85 R:85 A:90 D:90 |
| 3 | Confident | Orphaned-since derives from the delivery log's trailing absent-run (fallback `created_by.at`), never persisted in the entry file | Spec: runtime facts are never entry-file fields; Constitution II. Trim degrades expiry conservatively later, never premature. Rejected: an `orphaned_since` schema field (a runtime fact in an intent file, contradicting the spec's mutation set) | S:60 R:70 A:80 D:65 |
| 4 | Confident | Session respawn resumes **plain** (`--resume <uuid>`, no `--fork-session`) via a new riff seam mode, so the session id survives and the entry keeps resolving | Spec § if_absent names `claude --resume <session-id>`; a fork mints a fresh id and the entry stays orphaned. Rejected: fork + rewriting the entry's target (mutates intent with a runtime fact; a failed rewrite orphans forever) | S:55 R:60 A:75 D:60 |
| 5 | Confident | The respawn source is the recently-closed ring record matched by `AgentRef` (claude-only, cwd from the record's first pane); no record or non-claude ⇒ notify + `respawn-failed` | The scope phrase "via closed-session resume" names this machinery; `handleClosedResume` sets the gate posture. Rejected: decoding cwd from the transcript store (a second resolution path to maintain) | S:70 R:70 A:70 D:70 |
| 6 | Confident | First delivery into a resumed session is the entry's payload itself (no kickoff) | Resume restores conversation context, so the role-respawn never-bare-tick rationale ("a fresh session has no tick convention in context") does not apply; no kickoff is defined for arbitrary sessions | S:40 R:75 A:50 D:50 |
| 7 | Certain | `muted` entries still expire; only `pinned` exempts | Spec § Orphan GC: "expires after a TTL (default 7d) unless `pinned`" | S:85 R:90 A:90 D:85 |
| 8 | Confident | Expiry deletes the entry via the existing `Remove` mutation and appends an `expired-orphan` log line; no push notification | "Expires" = removal (the immortal-cron hazard is accumulation); the log line keeps it auditable — a target dead 7d is not push-worthy news | S:65 R:75 A:75 D:70 |
| 9 | Confident | `DeriveEntry`/API/`list --json` gain additive `orphaned_since`/`expires_at`; no frontend change in this change | Small additive read-side surfacing so the shipped orphan UI can show expiry later; omitting it would make GC invisible until deletion | S:50 R:85 A:70 D:60 |
| 10 | Confident | On successful session respawn the consumed ring record is dropped and the record's `@rk_win_*` options are re-stamped | Parity with `handleClosedResume`'s postlude — the record's purpose (resuming that session) is consumed | S:55 R:80 A:75 D:65 |

10 assumptions (3 certain, 7 confident, 0 tentative, 0 unresolved).

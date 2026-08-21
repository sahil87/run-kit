# Plan: Ephemeral Creation Verb + Adoption

**Change**: 260821-hbmh-ephemeral-creation-adoption
**Intake**: `intake.md`

## Requirements

### CLI: `rk mux new` create verb

#### R1: Detached server create via the sanctioned birth path
`rk mux new <name>` SHALL create a detached tmux server on socket `<name>` with a single session named `<name>`, by reusing `tmux.CreateSession(name, "", name)` (`app/backend/internal/tmux/tmux.go`) — the same server-birth path the create-server API flow uses (env sanitization via `CleanEnvForServer`, CWD anchored to `ServerBirthDir`). `<name>` SHALL be validated via `validate.ValidateServerName` before any subprocess (Constitution I); an invalid name is a usage error (exit 2). No new creation code is duplicated in `internal/tmux`.

- **GIVEN** `rk mux new scratch1` with no live server on socket `scratch1`
- **WHEN** the command runs
- **THEN** a detached tmux server exists on socket `scratch1` with one session named `scratch1`, and stdout carries exactly one report line: `created scratch1`
- **AND GIVEN** `rk mux new 'bad name!'`, **THEN** it is a usage error (exit 2) naming the allowed character set, and no subprocess runs

#### R2: Collision with a live socket refuses
`rk mux new <name>` SHALL probe the socket first (`tmux.ServerAlive`) and refuse when a live server already answers on it — an operational error (exit 1) stating the server is already running, performing no tmux mutation. A dead/stale socket (probe fails) proceeds: `new-session` starts a fresh server over it.

- **GIVEN** a live server on socket `busy`
- **WHEN** `rk mux new busy` runs
- **THEN** it exits 1 with an error naming `busy` as already running, and the existing server is untouched
- **AND GIVEN** a stale socket file whose server is dead, **WHEN** `rk mux new` targets it, **THEN** creation proceeds normally

#### R3: `--ephemeral` marks before return, with no unmarked survivor
`rk mux new <name> --ephemeral` SHALL set `@rk_ephemeral 1` (the `tmux.EphemeralOption` constant) server-scoped on the new server immediately after creation, before the command returns. The setter is a new `internal/tmux` helper `MarkServerEphemeral(ctx, server)` mirroring `SetServerOrigin` (`set-option -s`). If the mark fails after a successful create, the command SHALL best-effort `tmux.KillServer` the just-created server and exit 1 — a `--ephemeral` invocation never leaves an unmarked server behind.

- **GIVEN** `rk mux new scratch2 --ephemeral`
- **WHEN** the command succeeds
- **THEN** `tmux.IsEphemeralServer(ctx, "scratch2")` reads `true` (the option reads back `1`)
- **AND GIVEN** the mark write fails, **THEN** the new server is killed best-effort and the exit is 1

#### R4: Operator-member grammar and family conventions
`new` SHALL be an operator-tier member of the `mux` family: the socket name is its positional argument, so it rejects an explicitly-set inherited `-L/--server` via `muxRejectInheritedServerFlag` (usage error, exit 2 — the reap/snapshot/init-conf pattern). It takes exactly one positional (stray/missing args are usage errors), follows toolkit exit codes (0 success / 1 operational / 2 usage), prints diagnostics to stderr and exactly the one report line to stdout, and carries cobra `Short`/`Long`/`Example` text in the family's style (help-dump publishes `UsageString`; registration is unconditional and platform-stable). The `muxCmd` parent docs and `Short`/`Long` member enumeration SHALL be updated from ten to eleven members.

- **GIVEN** `rk mux -L foo new bar`
- **WHEN** the command runs
- **THEN** it exits 2 with a usage error naming `--server`, and nothing is created
- **AND GIVEN** `rk mux new` (no argument), **THEN** usage error (exit 2)

### Test scaffolding: in-repo setter sites

#### R5: `scripts/test-e2e.sh` marks the primary e2e server
After the primary server creation (`tmux -L "$E2E_TMUX_SERVER" new-session -d -s e2e-init -x 80 -y 24`), the script SHALL set `@rk_ephemeral 1` server-scoped on the same socket: `tmux -L "$E2E_TMUX_SERVER" set-option -s @rk_ephemeral 1`.

- **GIVEN** a `just test-e2e` run
- **WHEN** the primary `rk-test-e2e` server is created
- **THEN** it carries `@rk_ephemeral 1` for the lifetime of the run

#### R6: Playwright shared helper marks every spec-created server
`app/frontend/tests/e2e/_tmux.ts` `createSession` SHALL set `@rk_ephemeral 1` server-scoped (`set-option -s`) on the target server after its `new-session` succeeds, inside the existing best-effort try block — one seam covering the primary and every `rk-test-e2e-<role>-<pid>-<epoch>` secondary the multi-server specs spin up. The helper's doc comment records the convention. Setting the option repeatedly (primary already marked by R5) is an idempotent no-op.

- **GIVEN** a spec calling `createSession(SESSION_B, { server: TMUX_SERVER_B })` for a fresh secondary socket
- **WHEN** the helper runs
- **THEN** the secondary server carries `@rk_ephemeral 1`

### Documentation and standards

#### R7: Skill bundle documents the creation + cleanup convention
The agent-facing skill bundle SHALL document the convention: scratch tmux servers are created with `rk mux new <name> --ephemeral` and bulk-cleaned with `rk mux reap --ephemeral`; never bare `tmux kill-server`. Concretely: `docs/site/skill/mux.md` gains an `rk mux new` section (usage, `--ephemeral`, collision behavior) and the Gotchas convention line cross-referencing the guard shim; `docs/site/skill.md`'s capability quickref gains a one-liner for `rk mux new`. After editing, `scripts/sync-skill.sh` SHALL be run so the embedded copies under `app/backend/cmd/rk/skill/` stay byte-identical (the `TestSkillEmbedMatchesCanonical`-family drift guards enforce this).

- **GIVEN** the updated bundle
- **WHEN** `just test-backend` runs
- **THEN** the skill drift-guard tests pass (embedded copies match `docs/site/`)

#### R8: New-surface standards check
The new CLI surface SHALL be checked against the toolkit standards per the constitution's Toolkit Standards clause and the established new-surface procedure (memory `run-kit/toolkit-standards` § "A new command surface is checked against help-dump and Principle 9"): help-dump (platform-stable registration, `Long:` block present), Principle 9 (the `created <name>` line is the only stdout data; no narration), readme-extraction (decide whether the README command table needs a row — `rk mux new` is agent-facing; add a row only if the standard's criteria require it), and the skill standard (R7's bundle edits conform). Findings are recorded for hydrate to fold into the toolkit-standards memory.

- **GIVEN** the finished verb
- **WHEN** the standards audit runs (`shll standards <name>` for help-dump, principles, readme-extraction, skill)
- **THEN** each governed surface conforms, and the audit outcome is recorded in the plan notes for hydrate

### Non-Goals

- **Go test-scaffolding creation sites are NOT marked in this change.** The intake presumed a centralized Go creation helper; in reality only the *naming* is centralized (per-package `testSocketName` in `main_test.go`/`integration_test.go` files) while creation is ~50 heterogeneous raw `new-session` sites across `internal/tmux`, `internal/daemon`, `internal/tmuxctl`, `internal/snapshot`. Sweeping them contradicts the intake's "mechanical and small" bound, and the `EphemeralOption` contract already documents the fallback semantic (`IsTestServerName(name)` ⇒ treated as ephemeral, `tmux.go:50-51`); the PID-scoped `TestMain` post-sweep self-heals Go-test residue independently. Recorded as assumption 1.
- No `-x`/`-y` shape flags, no command argument on `rk mux new` — bare detached shell only (intake assumption 5; riff/API flows own richer spawn shaping).
- No `rk agent setup` change: the setup flow no longer installs or points at usage docs (that responsibility moved to the `rk skill` bundle — `agent_setup.go:39-45`), so the bundle IS the adoption channel. Recorded as assumption 5.

### Design Decisions

#### Collision probe is `ServerAlive`, refusal is operational
**Decision**: `rk mux new` probes `tmux.ServerAlive` before creating; a live server refuses with exit 1 (operational), a dead/stale socket proceeds.
**Why**: "creating over an existing live socket should fail clearly, not attach" (intake); `ServerAlive` is the diagnostic-carrying liveness probe built for exactly this CLI distinction, and a stale socket must not block creation (tmux restarts over it).
**Rejected**: treating collision as usage (exit 2) — the name is well-formed; the failure is environmental. Attaching/adopting the live server — explicitly ruled out by the intake.
*Introduced by*: 260821-hbmh-ephemeral-creation-adoption

#### Mark failure kills the fresh server
**Decision**: when `--ephemeral`'s option write fails after a successful create, best-effort `KillServer` the new socket and exit 1.
**Why**: the verb exists to prevent unmarked scratch servers; returning success-shaped debris on a failed mark would recreate the exact leak it fixes. The server is milliseconds old and owned by this invocation — killing it is safe.
**Rejected**: leaving the server and warning (unmarked survivor — the failure mode this change eliminates); retry loops (a failing `set-option` on a server that just booted signals something structurally wrong).
*Introduced by*: 260821-hbmh-ephemeral-creation-adoption

#### One Playwright seam, not per-spec marking
**Decision**: the option-set lives inside `_tmux.ts` `createSession` (server-scoped, idempotent, best-effort), not in each spec's `beforeAll`.
**Why**: every secondary-server spec already routes through `createSession`; one seam future-proofs new specs with zero per-spec ceremony — the same rationale that centralized the lifecycle helpers.
**Rejected**: a separate `createServer` helper (nothing else distinguishes server-create from session-create in the specs — `createSession` with `opts.server` IS the server-create path).
*Introduced by*: 260821-hbmh-ephemeral-creation-adoption

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add `MarkServerEphemeral(ctx, server)` to `app/backend/internal/tmux/tmux.go` (mirrors `SetServerOrigin`: `set-option -s @rk_ephemeral 1` via `tmuxExecRawServer`, `TmuxTimeout` bound), plus a real-tmux test in `app/backend/internal/tmux/tmux_test.go` (server named via `testSocketName`) asserting `IsEphemeralServer` reads back `true` after the mark <!-- R3 -->
- [x] T002 Create `app/backend/cmd/rk/mux_new.go`: `muxNewCmd` (`Use: "new <name> [--ephemeral]"`, `Short`/`Long`/`Example` in family style, `Args: usageArgs(cobra.ExactArgs(1))`), `runMuxNew` with `muxRejectInheritedServerFlag`, `validate.ValidateServerName` (usage error), `ServerAlive` collision refusal (operational), `CreateSession(name, "", name)`, `--ephemeral` mark with kill-on-mark-failure, one-line `created <name>` stdout report; package-level `muxNew*Fn` seams (the `mux_kill.go` pattern); register in `mux.go` `init()` and update the family parent's docs/`Short`/`Long` from ten to eleven members <!-- R1 -->
- [x] T003 Create `app/backend/cmd/rk/mux_new_test.go` (seam-based, the `mux_kill_test.go` pattern): name-validation rejection (exit-2 usage), missing/stray args, inherited `-L` rejection, live-server collision refusal (exit 1, no create call), successful create ordering (probe → create → report), `--ephemeral` ordering (probe → create → mark → report) and mark-failure path (kill called, exit 1) <!-- R2 -->

### Phase 3: Integration & Edge Cases

- [x] T004 [P] `scripts/test-e2e.sh`: add `tmux -L "$E2E_TMUX_SERVER" set-option -s @rk_ephemeral 1` immediately after the primary `new-session` line, with a one-line comment naming the convention <!-- R5 -->
- [x] T005 [P] `app/frontend/tests/e2e/_tmux.ts`: in `createSession`, after the `new-session` tmux call inside the existing try block, add `tmux(["set-option", "-s", "@rk_ephemeral", "1"], opts)`; extend the module doc comment with the ephemeral-marking convention <!-- R6 -->

### Phase 4: Polish

- [x] T006 Update `docs/site/skill/mux.md` (new `rk mux new` section + member-count intro touch-up + Gotchas convention line: create with `rk mux new <name> --ephemeral`, bulk-clean with `rk mux reap --ephemeral`, never bare `tmux kill-server`) and `docs/site/skill.md` (capability quickref one-liner for `rk mux new`); run `scripts/sync-skill.sh` to refresh the embedded copies under `app/backend/cmd/rk/skill/` <!-- R7 -->
- [x] T007 Run the new-surface standards audit (`shll standards help-dump`, `principles`, `readme-extraction`, `skill`) against the built verb; fix any nonconformance (e.g. README command-table row if readme-extraction requires it) and record the audit outcome in `## Notes` below for hydrate <!-- R8 -->
- [x] T008 Run `just test-backend` (Go: cmd/rk + internal/tmux suites incl. skill drift guards); spot-run `just test-e2e "create-server-waiting"` or an equivalently small spec only if the `_tmux.ts`/`test-e2e.sh` edits need live verification beyond review <!-- R1 -->

## Execution Order

- T001 blocks T002 (the verb calls `MarkServerEphemeral`)
- T002 blocks T003, T006, T007
- T004/T005 are independent `[P]` of the Go chain
- T008 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `rk mux new <name>` creates a detached server on socket `<name>` with session `<name>` through `tmux.CreateSession` (no duplicated creation code), validates the name via `validate.ValidateServerName`, and prints exactly `created <name>` on stdout
- [x] A-002 R3: `--ephemeral` sets `@rk_ephemeral 1` server-scoped via the new `MarkServerEphemeral` helper before the command returns; `IsEphemeralServer` reads back `true` in a real-tmux test
- [x] A-003 R5: `scripts/test-e2e.sh` sets `@rk_ephemeral 1` on the primary e2e server right after its creation
- [x] A-004 R6: `_tmux.ts` `createSession` marks the target server `@rk_ephemeral 1` inside its best-effort block, covering spec-created secondaries
- [x] A-005 R7: `docs/site/skill/mux.md` documents `rk mux new` + the create/reap convention, `docs/site/skill.md` quickref lists the verb, and the embedded copies are re-synced (drift guards green)

### Behavioral Correctness

- [x] A-006 R2: a live server on the target socket refuses with exit 1 and an already-running message, touching nothing; a stale dead socket proceeds
- [x] A-007 R3: a failed `--ephemeral` mark best-effort-kills the fresh server and exits 1 — no unmarked survivor
- [x] A-008 R4: `rk mux -L foo new bar` exits 2 naming `--server`; zero or extra positionals exit 2; toolkit exit-code convention holds (0/1/2)

### Scenario Coverage

- [x] A-009 R1: cmd/rk seam tests cover validation rejection, collision refusal, create ordering, `--ephemeral` ordering, and the mark-failure path
- [x] A-010 R8: the new-surface standards audit ran (help-dump, Principle 9, readme-extraction, skill) and its outcome is recorded in `## Notes`

### Edge Cases & Error Handling

- [x] A-011 R2: collision refusal performs no tmux mutation (create is never called when the probe answers alive)
- [x] A-012 R4: diagnostics go to stderr; stdout carries only the report line (Principle 9 data-vs-chatter split)

### Code Quality

- [x] A-013 Pattern consistency: `mux_new.go` follows the family's file layout (doc comment, cmd var, seam vars, runMuxNew), and all subprocess calls are `exec.CommandContext` argv slices under bounded contexts (Constitution I)
- [x] A-014 No unnecessary duplication: creation reuses `CreateSession`; the option write mirrors the existing server-option setter pattern; no inline tmux command construction outside `internal/tmux`
- [x] A-015 Tests included for the added behavior (new-verb seams + real-tmux mark round-trip), per code-quality baseline

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

### T007 new-surface standards audit (`rk mux new`, 2026-08-21, against HEAD build `bin/rk`)

- **help-dump — PASS.** `rk mux new` is registered unconditionally (platform-stable), carries `Short`/`Long`/`Example`, and appears in `rk help-dump` as the family's eleventh member with `UsageString` published (`['await','capture','guard','init-conf','kill','new','panes','process','reap','send','snapshot']`); `TestCaptureNodeRealTreeSelfExcludesAndDepth` pins the new count.
- **Principles — PASS with one defect found and fixed.** P1 non-interactive (no prompts), P2 stream split (the `created <name>` report line is stdout's only data; diagnostics ride stderr and errors), P4 exit codes (0/1/2 toolkit convention, usage re-tagging via `usageError`/`usageArgs`), P6 stateless retry-safe (live-socket collision refuses cleanly; a stale socket proceeds). **P9 defect caught by the audit**: the `--ephemeral` flag help text contained backticks around `rk mux reap --ephemeral`, which pflag consumed as a metavar name, rendering `--ephemeral rk mux reap --ephemeral` in `-h`. Fixed by dropping the backticks from the flag help string (the backtick-in-flag-help rule for hydrate to fold into toolkit-standards memory).
- **readme-extraction — PASS, no README change needed.** The README carries no per-command table for agent-facing mux verbs (only `rk mux send`/`await` get capability one-liners in the skill bundle, which is the agent channel); the standard's rule 7 command/flag accuracy cross-check runs against help-dump, which now includes `mux new`. The skill-topic edit lives under `docs/site/skill/`, inside the closed `docs/site/` tree (links stay bundle-internal).
- **skill — PASS.** `docs/site/skill/mux.md` gained the `rk mux new` section + create/reap Gotchas convention line; `docs/site/skill.md` gained the quickref one-liner. Both under the 150-line budget (89 / 132 lines). `scripts/sync-skill.sh` re-synced the embedded copies; `TestSkillEmbedMatchesCanonical` drift guards pass.

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant (the `mux.md` Gotchas bullet about bare `tmux kill-server` was moved, not removed: it merged into the new create/reap convention line).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Go test-scaffolding creation sites are out of scope (Non-Goals) — the intake's "centralized creation path" premise holds only for naming (`testSocketName`), not creation (~50 raw sites); `IsTestServerName` ⇒ ephemeral is already the documented fallback semantic | Sweeping ~50 heterogeneous sites contradicts the intake's own "mechanical and small" bound; consumer-level semantics already cover them | S:60 R:85 A:80 D:60 |
| 2 | Confident | Collision = `ServerAlive` answers ⇒ refuse exit 1 (operational); stale dead socket proceeds | The probe exists for exactly this CLI distinction; a stale socket must not block creation | S:65 R:85 A:80 D:70 |
| 3 | Confident | Report line is `created <name>` | Matches the family's `<verb-word> <target>` one-line report contract (`delivered`/`killed`/`staged`) | S:55 R:90 A:80 D:70 |
| 4 | Confident | Failed `--ephemeral` mark ⇒ best-effort kill + exit 1 | The verb's purpose is no-unmarked-scratch; success-shaped debris would recreate the leak | S:50 R:85 A:75 D:65 |
| 5 | Certain | No `rk agent setup` change — the skill bundle is the sole adoption docs channel | `agent_setup.go:39-45`: usage-docs responsibility explicitly moved to the `rk skill` bundle; setup only cleans legacy skills | S:80 R:90 A:95 D:85 |

5 assumptions (1 certain, 4 confident, 0 tentative).

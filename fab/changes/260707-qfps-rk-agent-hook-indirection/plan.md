# Plan: rk agent-hook Indirection

**Change**: 260707-qfps-rk-agent-hook-indirection
**Intake**: `intake.md`

## Requirements

<!-- Derived from intake.md § What Changes. RFC-2119 statements with stable R# IDs
     and GIVEN/WHEN/THEN scenarios. The @rk_agent_state VALUE SCHEMA is unchanged;
     all readers (internal/tmux, internal/sessions, frontend) are out of scope. -->

### rk agent-hook: New Subcommand

#### R1: `rk agent-hook` subcommand exists and is registered
The binary SHALL expose a `rk agent-hook --agent <name> <state>` subcommand, registered on the root command, where `<state>` is one of the canonical agent-state tokens (`active` | `waiting` | `idle`) and `--agent` selects the harness whose comm literal drives pid resolution (v1: `claude`).

- **GIVEN** a built `rk` binary
- **WHEN** `rk agent-hook --agent claude active` is invoked
- **THEN** the subcommand runs (it is a registered cobra command, not "unknown command")
- **AND** an invalid state token (e.g. `busy`) or unknown `--agent` is handled per R6 (still exit 0, no write)

#### R2: State validation against the canonical tokens
`rk agent-hook` SHALL validate `<state>` against the `tmux.AgentState*` constants (one source of truth per binary, aliased — not re-declared, per A-021), and SHALL validate `--agent` against the per-agent registry. Neither an unknown state nor an unknown agent SHALL cause a tmux write.

- **GIVEN** `rk agent-hook --agent claude waiting`
- **WHEN** the state is a known token and the agent is registered
- **THEN** the write in R4 proceeds
- **GIVEN** `rk agent-hook --agent claude bogus` (unknown state) OR `rk agent-hook --agent nope active` (unknown agent)
- **WHEN** validation runs
- **THEN** no `tmux set-option` is issued and the process still exits 0 (R6)

#### R3: `$TMUX_PANE` guard (defense in depth)
`rk agent-hook` SHALL read `$TMUX_PANE` from the environment and, when unset or empty, exit 0 immediately without any subprocess call — the in-binary re-check of the guard the shell wrapper also performs, so the binary is safe when run standalone.

- **GIVEN** `$TMUX_PANE` is unset
- **WHEN** `rk agent-hook --agent claude active` runs
- **THEN** it exits 0 with no `ps` walk and no `tmux set-option`
- **GIVEN** `$TMUX_PANE` is set to a pane id
- **WHEN** the command runs
- **THEN** it proceeds to pid resolution (R5) and the write (R4)

#### R4: Write the pane option with the UNCHANGED value schema
When the guard passes and validation succeeds, `rk agent-hook` SHALL write the pane option via `tmux set-option -pt "$TMUX_PANE" @rk_agent_state "<state>:<epoch>[:<pid>]"` using `exec.CommandContext` with a timeout (Constitution I). The value schema `<state>:<epoch_seconds>[:<pid>]` is UNCHANGED — the option name and epoch are produced by the binary exactly as the former shell hook produced them.

- **GIVEN** a valid state, a set `$TMUX_PANE`, and a resolved pid
- **WHEN** the write runs
- **THEN** the option value is `"<state>:<current-epoch>:<pid>"` (three segments)
- **GIVEN** pid resolution failed (R5)
- **WHEN** the write runs
- **THEN** the option value is `"<state>:<current-epoch>"` (two segments — legacy reconciler fallback), never a wrong pid
- **AND** the tmux invocation uses `exec.CommandContext` with an explicit timeout, never a shell string

#### R5: Comm-validated ancestor walk in Go (bound 5 hops)
`rk agent-hook` SHALL resolve the agent pid by walking up the process ancestry from `os.Getppid()`, comparing each ancestor's comm against the registry literal for `--agent`, bounded to **5 hops**. The comm and ppid of a pid SHALL be obtained portably (Linux: `/proc/<pid>/comm` and the `PPid:` line of `/proc/<pid>/status` — line-keyed, so the `/proc/<pid>/stat` comm-with-parens field-indexing hazard does not apply; other: `ps -o comm= -p` / `ps -o ppid= -p` via `exec.CommandContext` with timeout). If no ancestor within the bound matches the agent comm, the pid segment SHALL be omitted (R4 two-segment fallback), never a wrong pid.

- **GIVEN** the process chain `claude → hook shell → sh -c → rk` (up to a wrapper layer that may or may not exec)
- **WHEN** the walk runs from `getppid()`
- **THEN** it climbs at most 5 ancestors and returns the pid whose comm equals `claude`
- **GIVEN** no ancestor within 5 hops has comm `claude`
- **WHEN** the walk completes
- **THEN** it returns "no pid" and the write omits the pid segment
- **AND** every subprocess call in the walk uses `exec.CommandContext` with a timeout (Constitution I)

#### R6: Always exit 0 — every failure path is silent
`rk agent-hook` SHALL exit 0 on every path (unset guard, unknown agent, unknown state, walk failure, tmux write failure, subprocess timeout). It SHALL NOT produce a non-zero exit or a blocking exit code, and SHALL NOT print to stderr on the hot path (Claude Code treats exit code 2 as blocking and other non-zero exits as warnings).

- **GIVEN** any error condition (missing pane, dead ancestor, tmux missing, timeout)
- **WHEN** `rk agent-hook` runs
- **THEN** the process exit code is 0
- **AND** cobra is configured so a usage/arg error also does not surface as a non-zero exit on the hook-fire path

### rk agent-setup: Stable Interface Emission

#### R7: Installer emits the stable `rk agent-hook` one-liner
`agentStateHookCommand` SHALL produce a hook body of the form
`sh -c '[ -n "$TMUX_PANE" ] || exit 0; "<abs-rk-path>" agent-hook --agent <comm> <state> 2>/dev/null || true'`
where `<comm>` is the agent's registry comm and `<state>` is the fixed state literal. The `$TMUX_PANE` guard stays in the wrapper (cheap short-circuit — no binary spawn outside tmux); `|| true` preserves the never-fail contract even if the binary is missing or moved.

- **GIVEN** the Claude registry entry and state `waiting`
- **WHEN** `agentStateHookCommand` builds the command
- **THEN** the string contains the `$TMUX_PANE` guard, the quoted absolute rk path, ` agent-hook --agent claude waiting`, `2>/dev/null`, and `|| true`
- **AND** the command no longer contains the in-lined `ps -o comm=` walk or `tmux set-option` (that logic moved to the binary)

#### R8: Install-time absolute path resolution (stable, never Cellar-pinned, shell-safe)
The absolute rk path embedded in the hook SHALL be resolved at install time by preferring `exec.LookPath("rk")` (the stable Homebrew symlink), falling back to `os.Executable()` **without** resolving symlinks. It SHALL NOT resolve symlinks (which would pin the version-locked Cellar path and re-freeze the hook). The resolved path SHALL be embedded quoted, and SHALL be validated before any merge: a path containing any of `' " $ ` + backslash (shell-active inside the wrapper's double-in-single quoting) SHALL fail the install with a clear error — never embedded verbatim, never escaped (three nested quoting layers make escaping fragile), never silently replaced by a PATH-dependent fallback.

- **GIVEN** `rk` is on PATH via a Homebrew symlink
- **WHEN** the installer resolves the path
- **THEN** it uses the `LookPath` result (the stable symlink), embedded quoted
- **GIVEN** `rk` is not on PATH
- **WHEN** the installer resolves the path
- **THEN** it falls back to `os.Executable()` without `EvalSymlinks`
- **AND** the path is never run through `filepath.EvalSymlinks`
- **GIVEN** a resolved path containing a shell-unsafe character (e.g. `/tmp/o'brien/rk`)
- **WHEN** `rk agent-setup` runs
- **THEN** the install fails with a clear error before any settings merge; nothing is written

#### R9: Two-generation `isRkEntry` marker predicate
`isRkEntry` SHALL recognize an entry as rk-owned when a nested command string contains **either** the legacy marker (`@rk_agent_state`) **or** the new-form substring (the ` agent-hook ` invocation). This makes `rk agent-setup` on the new binary strip old-generation one-liners and replace them in place, and makes `--uninstall` remove both generations. The existing strip-then-append merge structure is otherwise unchanged.

- **GIVEN** a settings file whose only rk hooks are old-generation (contain `@rk_agent_state`, no `agent-hook`)
- **WHEN** `rk agent-setup` runs on the new binary
- **THEN** the old entries are stripped and replaced with new-form entries in place (no duplication)
- **GIVEN** new-form rk entries (contain ` agent-hook `, no `@rk_agent_state`)
- **WHEN** `isRkEntry` inspects them
- **THEN** it reports them rk-owned
- **GIVEN** a mix of old and new rk entries and `--uninstall`
- **WHEN** unmerge runs
- **THEN** both generations are removed and non-rk hooks are preserved

### Spec & Docs

#### R10: Spec amendment — `docs/specs/agent-state.md`
The spec SHALL be amended: Writer rule 4 rewritten (hooks MUST never fail/block the agent and MUST NOT require the run-kit *server* at hook-fire time; the hook body SHOULD be the stable `rk agent-hook` interface with logic in the binary — the tmux-only ban is lifted for the rk binary, with rationale recorded); Writer rule 5 updated (walk in the binary, bound 5; canonical command block shows the new stable one-liner); the Migration note updated (one final old-style migration needed now; subsequent logic changes need none; matcher/event-mapping changes still need re-setup + restart).

- **GIVEN** the amended spec
- **WHEN** a reader consults Writer rules 4 and 5 and the canonical command block
- **THEN** rule 4 permits the rk binary and bans only the server; rule 5 states the walk is in the binary with bound 5; the canonical command block is the stable `rk agent-hook` one-liner

#### R11: README setup-steps update
`README.md` SHALL be updated so the `rk agent-setup` section reflects the new hook form (a stable `rk agent-hook` interface whose logic lives in the binary and tracks `brew upgrade rk`) and calls out the one-time re-migration for existing installs (re-run `rk agent-setup`, restart sessions).

- **GIVEN** the updated README
- **WHEN** a user reads the "Agent state — `rk agent-setup`" section
- **THEN** it describes the stable-interface hook (logic in the binary, updates with the binary) and the one-time re-setup + session-restart for existing installs

### Non-Goals

- Reading the harness's hook JSON on stdin to derive state in-binary — deferred as an additive follow-up (would not change the installed command shape). Event→state mapping stays in the settings matchers for v1.
- Any change to the `@rk_agent_state` value schema, `internal/tmux` parsing/reconciler, `internal/sessions` rollup, the frontend, or the server API — readers are deliberately untouched.
- A pure-tmux fallback path when the binary is missing — a fallback string IS the frozen logic being removed; silence is acceptable (PID-liveness reconciler covers stranded values).
- Adding codex/copilot/gemini/opencode registry rows — additive follow-ups.

### Design Decisions

1. **Walk in Go, not in the shell string**: move the comm-validated ancestor walk into `agent_hook.go` so hook logic tracks the binary — *Why*: the whole point of the change (a hook fix reaches running agents on `brew upgrade rk`, no settings churn / session restarts) — *Rejected*: keep raw one-liners + drift detection (mitigates discovery, not the migration); dual-path hook (the fallback string IS the frozen logic being removed).
2. **Bound raised 3→5 hops**: the delegation adds a wrapper layer (`claude → hook shell → sh -c → rk`, `sh` may or may not exec) — *Why*: extra hops are cheap and bounded — *Rejected*: keeping 3 (risks missing the agent behind the added wrapper).
3. **Linux `/proc` fast path, `ps` elsewhere**: reuse `resolveCommand` in `daemon_portowner.go` for comm (`/proc/<pid>/comm` on Linux, `ps -o comm=` elsewhere — called, not copied); ppid from the `PPid:` line of `/proc/<pid>/status` on Linux (line-keyed, so `/proc/<pid>/stat`'s comm-with-spaces/parens field-indexing hazard does not apply), `ps -o ppid=` via `exec.CommandContext` otherwise — *Why*: `/proc` avoids ~4 subprocess spawns per hook fire on the common host; `ps` keeps darwin portable — *Rejected*: always shelling to `ps` (a subprocess per hop even on Linux); parsing `/proc/<pid>/stat` (parens hazard).
4. **Install-time path via `LookPath` then `os.Executable()` no-symlink-resolve**: *Why*: hook env PATH is untrustworthy so the abs path must be embedded; symlink resolution would pin the Cellar version and re-freeze the hook — *Rejected*: bare `rk` in the hook (PATH untrustworthy at fire time); `EvalSymlinks` (Cellar-pins).

## Tasks

### Phase 1: Core Implementation

- [x] T001 Add `agent_hook.go` in `app/backend/cmd/rk/`: define the `agentHookCmd` cobra command (`Use: "agent-hook"`, `--agent` string flag, `Args: cobra.ExactArgs(1)` for `<state>`, `SilenceErrors`/`SilenceUsage`, RunE always returns nil), a `runAgentHook` core split out for testability, the `$TMUX_PANE` guard, agent+state validation against the registry and `tmux.AgentState*`, and the exit-0 contract. <!-- R1 R2 R3 R6 --> <!-- rework: must-fix — known flag missing its value (`--agent` with no arg) exits 1 before RunE; add agentHookCmd.SetFlagErrorFunc no-op (exit 0, no write) and correct the false comment at agent_hook.go:34-37 claiming main neutralizes it -->
- [x] T002 In `agent_hook.go`, implement the comm-validated ancestor walk `resolveAgentPID(ctx, startPPID int, comm string) int` (bound 5) plus portable `processComm`/`processPPID` helpers (Linux `/proc`, else `ps` via `exec.CommandContext` with timeout); return 0 when no ancestor matches. Make the walk's process-inspection seam injectable (package-level func vars) so tests avoid real processes. <!-- R5 --> <!-- rework: should-fix x2 — (a) processPPIDImpl shells to ps on Linux; add /proc/<pid>/status 'PPid:' fast path per R5/DD3 (or amend R5/DD3 if rejected); (b) processCommImpl duplicates resolveCommand (daemon_portowner.go:167-185, same package) — reuse the existing helper -->
- [x] T003 In `agent_hook.go`, implement the tmux write `writeAgentState(ctx, pane, state string, pid int)` via `exec.CommandContext` with timeout, formatting the UNCHANGED value schema `<state>:<epoch>[:<pid>]` (pid segment omitted when pid<=0); wire `runAgentHook` = guard → resolve agent config from registry → resolve pid → write. Reuse `tmux.AgentStateOption`. <!-- R4 --> <!-- rework: should-fix — extract pure formatAgentStateValue(state, pid) so the cross-repo value contract is a testable unit -->
- [x] T004 Register `agentHookCmd` in `app/backend/cmd/rk/root.go` `init()`. <!-- R1 -->

### Phase 2: Installer Rewrite

- [x] T005 In `app/backend/cmd/rk/agent_setup.go`, rewrite `agentStateHookCommand` to emit the stable delegating one-liner `sh -c '[ -n "$TMUX_PANE" ] || exit 0; "<abs-rk-path>" agent-hook --agent <comm> <state> 2>/dev/null || true'`. Thread the resolved absolute rk path through the builder + `rkHookEntry`/`mergeHooks` call sites. <!-- R7 -->
- [x] T006 In `agent_setup.go`, add install-time path resolution `resolveRkPath()` preferring `exec.LookPath("rk")`, falling back to `os.Executable()` WITHOUT `EvalSymlinks`; wire it into the install flow (resolved once in `runAgentSetup`/`applyAgentConfig`, passed to `mergeHooks`). <!-- R8 --> <!-- rework: should-fix — rkPath is interpolated unescaped into the double-in-single-quoted wrapper; a path with ' " $ ` or backslash breaks/reinterprets it. Validate at install (reject with clear error or safe fallback — decide and record) and fix the now-inaccurate 'no injection surface' comment -->
- [x] T007 In `agent_setup.go`, extend `isRkEntry` to match EITHER the legacy `@rk_agent_state` marker OR the new ` agent-hook ` substring (introduce a named const for the new marker). Keep the strip-then-append merge structure unchanged; `--uninstall` (via `removeRkEntries`) then removes both generations. <!-- R9 -->

### Phase 3: Tests

- [x] T008 [P] Add `agent_hook_test.go`: cover the `$TMUX_PANE` guard (unset → no write, exit 0), state validation (unknown state → no write), unknown agent → no write, the value-schema formatting (three-segment with pid, two-segment without), the ancestor walk (matches within bound, exhausts bound → 0) using injected process-inspection stubs, and the always-exit-0 contract. <!-- R1 R2 R3 R4 R5 R6 --> <!-- rework: should-fix — TestWriteAgentStateImplValueSchema is tautological (fake constructs the expected string); test formatAgentStateValue byte-for-byte instead -->
- [x] T009 [P] Update `agent_setup_test.go`: adjust `TestAgentStateHookCommandShape` to assert the new stable one-liner shape (guard, quoted abs path, ` agent-hook --agent claude `, state, `2>/dev/null`, `|| true`; assert the removed in-lined walk/`set-option`); add a two-generation `isRkEntry` test (legacy-marker entry AND new-form entry both recognized; re-install over a legacy fixture replaces in place; `--uninstall` removes both). Thread the new path arg through existing merge-test call sites. Add a `resolveRkPath` test where possible. <!-- R7 R8 R9 -->

### Phase 4: Spec & Docs

- [x] T010 [P] Amend `docs/specs/agent-state.md`: rewrite Writer rule 4, update Writer rule 5 (walk in binary, bound 5), replace the canonical command block with the stable `rk agent-hook` one-liner, and update the Migration note. <!-- R10 --> <!-- rework: should-fix — spec § The Option (docs/specs/agent-state.md:42-44) still says the pid is '$PPID inside the hook's sh -c'; contradicts amended Writer rule 5 — align the parenthetical -->
- [x] T011 [P] Update `README.md` "Agent state — `rk agent-setup`" section: new hook form (logic in the binary, tracks `brew upgrade rk`) + the one-time re-migration for existing installs. <!-- R11 -->

## Execution Order

- T001 → T002 → T003 (same file, dependency order) → T004 (registration after the command exists)
- Phase 2 (T005 → T006 → T007) can proceed once Phase 1 lands; T005 and T006 both touch the command builder path so T006 threads the value T005 consumes.
- Phase 3 tests follow their implementation phases; T008 depends on Phase 1, T009 on Phase 2.
- Phase 4 (T010, T011) is independent of the Go code and parallelizable.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `rk agent-hook --agent claude <state>` is a registered subcommand (present in `rootCmd.Commands()`; not "unknown command").
- [x] A-002 R2: State is validated against `tmux.AgentState*` (aliased, not re-declared) and `--agent` against the registry; an unknown state or agent performs no tmux write.
- [x] A-003 R3: With `$TMUX_PANE` unset the command exits 0 with no `ps` walk and no `set-option`; with it set it proceeds to resolution + write.
- [x] A-004 R4: The written option uses the UNCHANGED value schema (`<state>:<epoch>:<pid>` when a pid resolves, `<state>:<epoch>` when not) via `exec.CommandContext` with a timeout.
- [x] A-005 R5: The ancestor walk (bound 5) returns the pid whose comm equals the agent literal and returns "no pid" (→ two-segment value) when the bound is exhausted; every subprocess in the walk uses `exec.CommandContext` with a timeout.
- [x] A-006 R6: Every failure path (unset guard, unknown agent/state, walk failure, tmux/subprocess failure or timeout) exits 0; no blocking exit code, no stderr on the hook-fire path.
- [x] A-007 R7: `agentStateHookCommand` emits the stable delegating one-liner (guard + quoted abs path + ` agent-hook --agent <comm> <state>` + `2>/dev/null` + `|| true`) and no longer inlines the walk or `set-option`.
- [x] A-008 R8: The embedded path is resolved via `LookPath` then `os.Executable()` without `EvalSymlinks` (never the Cellar path), embedded quoted.
- [x] A-009 R9: `isRkEntry` recognizes both the legacy `@rk_agent_state` and the new ` agent-hook ` forms; re-install replaces a legacy fixture in place (no duplication) and `--uninstall` removes both generations while preserving non-rk hooks.
- [x] A-010 R10: `docs/specs/agent-state.md` Writer rules 4/5, the canonical command block, and the Migration note are amended as specified.
- [x] A-011 R11: `README.md` reflects the new hook form and the one-time re-migration for existing installs.

### Behavioral Correctness

- [x] A-012 R9: A second `rk agent-setup` on the new binary over an old-generation settings fixture yields exactly the new-form entries with no duplicates (idempotent replace-in-place across generations).
- [x] A-013 R4: The value schema is byte-compatible with the former shell hook's output (same option name, `<state>:<epoch>[:<pid>]` shape) — readers (`parseAgentState`, reconciler, rollup) are untouched and continue to parse the value.

### Edge Cases & Error Handling

- [x] A-014 R6: `rk agent-hook` invoked outside tmux, with `tmux` absent, or with a dead/unresolvable ancestor still exits 0 and issues no wrong-pid write.
- [x] A-015 R5: A wrapped launch where the immediate parent is a shell still resolves the agent pid by climbing to the `claude` ancestor within the 5-hop bound.

### Code Quality

- [x] A-016 Pattern consistency: New code follows the surrounding `cmd/rk/` patterns (cobra command + testable `runX` split, `exec.CommandContext` with a named timeout const, package-level func vars for test seams as in `agentProcessAlive`/`findPortOwner`).
- [x] A-017 No unnecessary duplication: Convention strings are aliased from `internal/tmux` (A-021), not re-declared; the `/proc`-then-`ps` comm/ppid resolution reuses the approach in `daemon_portowner.go` rather than a divergent copy.
- [x] A-018 Security (Constitution §I): All subprocess calls (`ps`, `tmux set-option`) use `exec.CommandContext` with explicit timeouts and argument slices — no shell strings, no user-provided interpolation into a shell (state/comm are fixed registry literals; `$TMUX_PANE` is passed as a discrete argv element).
- [x] A-019 Never-fail contract: `rk agent-hook` never returns a non-zero or blocking exit code on any path (Constitution — hooks must never block/fail the agent). <!-- rework cycle 1: FIXED via agentHookCmd.SetFlagErrorFunc (swallows KNOWN-flag parse errors, the class FParseErrWhitelist/ArbitraryArgs miss). Empirically re-verified on a fresh build: `rk agent-hook --agent` (missing value), `--bogus x`, missing state, extra args, valid — all exit 0, no output; --help intact. Locked in by TestAgentHookCmdNeverErrorsOnMalformedInvocation's new `--agent`-missing-value case. -->

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Deletion Candidates

- `app/backend/cmd/rk/agent_setup.go:43` (`rkHookMarker` legacy arm in `isRkEntry`) — transitional by design: once the fleet's one-time re-setup migration is complete, no settings file carries the old inlined one-liner and the legacy-marker match (plus `legacyRkEntry` test fixtures) becomes removable. Not deletable now.
- `app/backend/cmd/rk/agent_hook.go:145` (`isAgentState`) — duplicates `internal/tmux`'s unexported one-line validator (tmux.go:243); exporting a single validator would let one copy go. (Cycle-1 nice-to-have, deliberately deferred.)
- `app/backend/cmd/rk/agent_hook.go:195,199` (`processComm`/`processPPID` wrappers) — one-line indirections over the `processCommFn`/`processPPIDFn` seam vars; the established seam pattern calls the var directly (`findPortOwner = findPortOwnerImpl`, daemon_portowner.go:39, invoked as `findPortOwner(...)`), so the two wrapper funcs are removable by renaming the vars to the call-site names.

*(Cycle-1 candidate `processCommImpl` duplicate-of-`resolveCommand` was resolved by the rework — it now delegates to the shared helper.)*

## Assumptions

<!-- Graded decisions made while co-generating Requirements from the intake. The
     intake already resolved the major design choices as graded assumptions; the
     rows below are the apply-time implementation decisions that go beyond it. -->

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Subcommand `rk agent-hook --agent <name> <state>` with state as a positional arg and `--agent` as a flag | Directly specified in intake § What Changes 1 and Assumption 2; matches the emitted one-liner in § What Changes 2 | S:95 R:90 A:95 D:95 |
| 2 | Confident | Ancestor walk uses a Linux `/proc` fast path (comm via the shared `resolveCommand` → `/proc/<pid>/comm`, ppid from the `PPid:` line of `/proc/<pid>/status`) and `ps -o comm=/-o ppid=` elsewhere, both via injectable func vars | Reuses `resolveCommand` in `daemon_portowner.go` (called, not copied); `/proc` avoids ~4 subprocess spawns per hook fire on the common host; `/proc/<pid>/status` is line-keyed so the stat-file parens hazard does not apply; intake says "portable across linux/darwin" without mandating the mechanism | S:70 R:85 A:80 D:70 |
| 3 | Confident | Process-inspection seam exposed as package-level func vars (like `agentProcessAlive`/`findPortOwner`) so walk tests avoid spawning real ancestor chains | Established test-seam pattern in this codebase; keeps tests deterministic; reversible refactor local to one file | S:65 R:90 A:85 D:75 |
| 4 | Confident | New-form marker is the ` agent-hook ` substring (with surrounding spaces) as a named const, matched alongside the legacy `@rk_agent_state` in `isRkEntry` | Intake § What Changes 3 names "the ` agent-hook ` invocation substring"; spaces avoid matching an unrelated token; const keeps it single-sourced | S:80 R:85 A:85 D:75 |
| 5 | Confident | Absolute path resolved once per `runAgentSetup` invocation (not per hook) and threaded through `mergeHooks`/`rkHookEntry` | The path is install-host-stable within one invocation; resolving once is simpler and keeps all installed entries consistent | S:70 R:85 A:80 D:75 |
| 6 | Confident | `agent_hook.go` uses `SilenceErrors`+`SilenceUsage`, a RunE that always returns nil, `ArbitraryArgs` (arg-count → RunE no-op), `FParseErrWhitelist.UnknownFlags`, AND `SetFlagErrorFunc` (known-flag parse errors, e.g. `--agent` missing its value) — so every malformed invocation exits 0 on the hook-fire path | Intake Assumption 6 + R6 mandate always-exit-0; cobra surfaces four distinct parse-error classes before RunE and each needs its own neutralizer (rework cycle 1 closed the known-flag class) | S:75 R:85 A:85 D:80 |
| 7 | Confident | A resolved rk path containing any of `' " $ ` + backslash FAILS the install with a clear error (validateHookPath) — chosen over escaping and over a silent fallback | Rework-cycle-1 decision: escaping must survive three nested quoting layers (shell-in-shell-in-JSON — fragile to write and review); a bare-`rk` fallback reintroduces the PATH dependency the absolute path exists to remove; such paths never occur under Homebrew/conventional layouts; agent-setup is interactive so the user sees the error and can act | S:60 R:85 A:80 D:70 |

7 assumptions (1 certain, 6 confident, 0 tentative).

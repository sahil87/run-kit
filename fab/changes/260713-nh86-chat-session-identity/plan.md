# Plan: Chat Session Identity (`@rk_chat` pane-option convention)

**Change**: 260713-nh86-chat-session-identity
**Intake**: `intake.md`

## Requirements

<!-- Derived from intake.md § What Changes. This change mirrors the proven
     @rk_agent_state machinery end-to-end: same pane-option scope, same never-fail
     hook contract, same rk agent-hook binary indirection, same read-time
     reconciliation, same zero-extra-subprocess read. Backend + hooks + spec only —
     no frontend (Change 3 owns the UI). -->

### Convention: The `@rk_chat` Pane Option

#### R1: `@rk_chat` value schema and provider/session-ref split
run-kit SHALL define a tmux **pane** user option `@rk_chat` whose value is
`<provider>:<session-ref>`, where `<provider>` is a lowercase token
(`[a-z][a-z0-9_-]*`) equal to the `rk agent-setup` registry agent name (v1:
`claude`) and `<session-ref>` is a provider-defined opaque reference (for `claude`,
the session UUID). The value SHALL be split on the **first** colon. A single
`tmux.ChatOption = "@rk_chat"` constant SHALL be the one source of truth per binary
(the A-021 pattern), aliased — not re-declared — by `cmd/rk/agent_hook.go`.

- **GIVEN** a pane whose `@rk_chat` = `claude:6f0d9e2a-1c3b-4f7e-9a2d-8b5c4e1f0a37`
- **WHEN** the backend parses it
- **THEN** provider = `claude` and session-ref = `6f0d9e2a-1c3b-4f7e-9a2d-8b5c4e1f0a37`
- **AND** a ref that itself contains colons is preserved intact (split on first colon only)

#### R2: `parseChatRef` tolerance — malformed values are wholly unknown
A pure `parseChatRef(raw) (provider, ref string)` SHALL trim the value, split on the
first colon, validate the provider shape (`[a-z][a-z0-9_-]*`, non-empty) and the ref
(non-empty, no whitespace or control chars), and return `("", "")` on any violation.
Unknown-but-well-formed providers SHALL NOT be rejected (presence-gating is
provider-agnostic; adapters are additive). This mirrors `parseAgentState`'s
never-partially-trust tolerance.

- **GIVEN** a value that is empty, lacks a colon, has an empty/invalid provider, or an empty/whitespace ref
- **WHEN** `parseChatRef` runs
- **THEN** it returns `("", "")` (wholly unknown, never partially trusted)
- **AND** a well-formed value with an unregistered provider (e.g. `codex:abc`) parses successfully

### Reader: Parse + Reconcile in `internal/tmux`

#### R3: `paneFormat` gains `#{@rk_chat}` as the 8th field (zero extra subprocess)
`paneFormat` SHALL add `#{@rk_chat}` as an 8th field; `parsePanes` SHALL move its
skip-guard from `< 7` to `< 8`. `PaneInfo` SHALL gain `ChatProvider string`
(`json:"chatProvider,omitempty"`) and `ChatSessionRef string`
(`json:"chatSessionRef,omitempty"`), parsed once via `parseChatRef` so no consumer
re-splits the raw value. The field rides the existing per-session `list-panes` call
— no new subprocess.

- **GIVEN** a `list-panes` line carrying an 8th field `claude:<uuid>`
- **WHEN** `parsePanes` runs
- **THEN** the resulting `PaneInfo` has `ChatProvider=claude` and `ChatSessionRef=<uuid>`
- **AND** a 7-field line (no `@rk_chat`) is skipped by the `< 8` guard — the 8th field is now required (`@rk_chat` always resolves, tmux emitting an empty field when unset, so a real 7-field line only occurs pre-upgrade)

#### R4: Chat reconciliation colocated with the agent-state reconciler
In `parsePanes`, immediately after the existing agent-state reconciler, run a chat
reconciler so a dead agent never leaves a live-looking chat ref (plan risk #4).
`@rk_chat` carries no pid, so liveness is judged from the **same pane's**
`@rk_agent_state`:

1. If the agent-state value carried a pid (3-segment): chat is trusted iff that pid
   is alive (the existing `agentProcessAlive` check) — a dead pid zeroes **both** the
   agent-state fields **and** the chat fields.
2. Otherwise (no agent-state yet, or a legacy 2-segment value): `isShellCommand(command)`
   ⇒ zero the chat fields. A shell/htop pane never surfaces chat.

The reconciler SHALL NOT stat `~/.claude/projects/**/<ref>.jsonl` (no disk validation —
per-pane-per-poll I/O for a pathological case; Change 2 surfaces a missing transcript
naturally).

- **GIVEN** a pane with `@rk_chat=claude:<uuid>` and `@rk_agent_state=active:<epoch>:<dead-pid>`
- **WHEN** `parsePanes` reconciles (the pid is not alive)
- **THEN** both the agent-state fields and the chat fields are zeroed
- **AND** a shell pane (`bash`) carrying a leftover `@rk_chat` with no live pid-bearing agent-state has its chat fields zeroed
- **AND** a live pid-bearing agent under a `bash` wrapper keeps its chat fields (liveness wins over the shell heuristic, mirroring agent-state)

### Writer: `rk agent-hook` stdin JSON + chat stamp

#### R5: bounded, TTY-guarded, single-object stdin JSON parse
`runAgentHook` SHALL add a stdin parse step that: is **skipped when stdin is a TTY**
(`os.ModeCharDevice` guard, so a manual terminal invocation never blocks); reads
through an `io.LimitReader` (~1 MiB bound); decodes a **single** JSON object via
`json.Decoder.Decode` (returns after one complete object — no dependence on stdin
EOF); and extracts `session_id`. Every failure mode (absent/malformed/oversized/no
stdin) SHALL be silent — no chat stamp — and the agent-state write SHALL still
proceed. The never-fail/always-exit-0 contract
(`TestAgentHookCmdNeverErrorsOnMalformedInvocation`) SHALL remain intact.

- **GIVEN** valid hook stdin JSON `{"session_id":"<uuid>", ...}`
- **WHEN** `runAgentHook` parses it (stdin is not a TTY)
- **THEN** it extracts `<uuid>` for the chat stamp
- **AND** absent, malformed, or oversized stdin yields no chat stamp and never errors
- **AND** a TTY stdin is not read at all (no block)

#### R6: stamp `@rk_chat` on every fire that yields a `session_id`
On every hook fire that yields a non-empty `session_id`, the writer SHALL stamp
`@rk_chat = <agent>:<session_id>` on `$TMUX_PANE` via `tmux set-option -pt`, using the
same `tmux.OriginalTMUX`-derived `-S <socket>` targeting (`tmuxSocketArgs`) and the
same `exec.CommandContext` + 5s timeout as the agent-state write (Constitution I).
Every-fire (not SessionStart-only) is required because session ids rotate on `/clear`
and `/compact`, and it reaches already-running agents on `brew upgrade rk` with zero
settings churn. The `session_id` SHALL be validated the same way `parseChatRef`
validates a ref (non-empty, no whitespace/control) before it is stamped, so a
malformed value is never written.

- **GIVEN** a valid `active|waiting|idle` state fire inside tmux with stdin `session_id=<uuid>`
- **WHEN** the hook runs
- **THEN** both `@rk_agent_state` and `@rk_chat=claude:<uuid>` are written for the pane
- **AND** a fire with no `session_id` writes `@rk_agent_state` only (no chat stamp)

#### R7: stamp-only invocation mode (token `stamp`)
`rk agent-hook` SHALL accept a distinguished positional token `stamp` (alongside
`active|waiting|idle`) that writes `@rk_chat` but **not** `@rk_agent_state`. Unknown
tokens SHALL remain silent no-ops. This is the token the SessionStart registry row
uses (§R8): SessionStart's `source=compact` fires mid-turn, where an `idle`
agent-state write would clobber a live `active` state.

- **GIVEN** `rk agent-hook --agent claude stamp` inside tmux with stdin `session_id=<uuid>`
- **WHEN** the hook runs
- **THEN** only `@rk_chat=claude:<uuid>` is written; `@rk_agent_state` is NOT touched
- **AND** `stamp` with no `session_id` writes nothing at all
- **AND** an unknown token (e.g. `busy`) writes nothing

### Installer: SessionStart registry row

#### R8: SessionStart stamp-only row in the Claude registry
The Claude row of `agentRegistry` SHALL gain a `SessionStart` entry (no matcher) that
writes `@rk_chat` only, using the `stamp` token. The installed command SHALL keep the
established wrapper shape
`sh -c '[ -n "$TMUX_PANE" ] || exit 0; "<abs-rk>" agent-hook --agent claude stamp 2>/dev/null || true'`.
The `isRkEntry` marker (`" agent-hook "`) already matches it, so idempotent re-run
replacement and `--uninstall` need no marker changes. No `SessionEnd` registration is
added (reader-side reconciliation handles crash/kill paths anyway).

- **GIVEN** a fresh `~/.claude/settings.json`
- **WHEN** `rk agent-setup` installs
- **THEN** a `SessionStart` event array contains exactly one rk-owned entry invoking `agent-hook --agent claude stamp`
- **AND** a second `rk agent-setup` run is idempotent (no duplicate SessionStart entry)
- **AND** `--uninstall` removes the SessionStart entry along with the other rk entries

### Surfacing: window rollup + API/SSE

#### R9: `WindowInfo` chat fields + `rollupChat` helper
`WindowInfo` SHALL gain `ChatProvider` (`json:"chatProvider,omitempty"`) and
`ChatSessionRef` (`json:"chatSessionRef,omitempty"`), filled in `FetchSessions` beside
the `rollupAgentState` call by a pure `rollupChat(panes) (provider, ref string)`
helper: the **active pane's** reconciled chat if set, else the first pane carrying one
(deterministic). Both `GET /api/sessions` and the SSE `event: sessions` payload SHALL
carry the new fields automatically via the existing `ProjectSession` marshal — per
window **and** per pane (`WindowInfo.Panes` is already serialized). No new endpoint,
no new SSE event type.

- **GIVEN** a window whose active pane carries `chatProvider=claude`
- **WHEN** `FetchSessions` rolls up
- **THEN** the `WindowInfo` carries that provider/ref, and it is emitted over both `GET /api/sessions` and SSE `event: sessions`
- **AND** a window with a chat only on a non-active pane rolls up to that pane's chat
- **AND** a window with no chat on any pane has empty chat fields

### Spec + Plan tracking

#### R10: Spec amendment in `docs/specs/agent-state.md`
`docs/specs/agent-state.md` SHALL gain a new section defining the `@rk_chat`
convention (value schema table, provider/session-ref rules, writer rules identical to
`@rk_agent_state`'s never-fail contract, reader/reconciliation rules, lifecycle, and a
migration note covering both the binary-only every-fire stamping and the SessionStart
event-mapping re-setup). The `fab/plans/sahil/agent-chat-view.md` tracking table row 1
SHALL be filled with this change's folder name.

- **GIVEN** the spec and plan before this change
- **WHEN** the change lands
- **THEN** `docs/specs/agent-state.md` documents `@rk_chat` end-to-end
- **AND** the plan's tracking table row 1 `Change folder` column holds `260713-nh86-chat-session-identity`

### Non-Goals

- No frontend work (Change 3 owns the `[tty|chat]` toggle and `?view=chat`).
- No chat read/stream endpoint (Change 2).
- No disk validation of the referenced transcript (R4).
- No `SessionEnd` writer-side clearing (reconciliation covers crash/kill).
- No codex/gemini adapters (additive per plan changes 5–6); the reader tolerates
  unknown well-formed providers but ships no adapter.

### Design Decisions

1. **Mirror `@rk_agent_state` end-to-end**: same pane-option scope, never-fail hook
   contract, binary indirection, read-time reconciliation, zero-extra-subprocess read.
   — *Why*: the agent-state machinery is the proven template and the intake mandates
   it; the `@rk_agent_state` history (guppi lesson, #320↔#321 skew) is exactly the
   stale-lifecycle failure mode this pattern already solved. — *Rejected*: a bespoke
   read path or a state file (Constitution II).
2. **Liveness borrowed from the same pane's `@rk_agent_state`**: `@rk_chat` carries no
   pid (2-segment schema is plan-fixed), so the chat reconciler reuses the agent-state
   pid/shell reconciler outcome rather than adding a second liveness source. — *Why*:
   one liveness signal per pane, written by the same binary on the same fires. —
   *Rejected*: adding a pid segment to `@rk_chat` (schema bloat, duplicate liveness).
3. **Every-fire stamp + stamp-only SessionStart**: session ids rotate on `/clear` and
   `/compact`, so a one-time stamp goes stale; every-fire ships binary-only to running
   agents; SessionStart gives "within seconds of session start" before any prompt, and
   is stamp-only because `source=compact` fires mid-turn. — *Rejected*: SessionStart
   alone (goes stale on rotation); a SessionStart agent-state write (clobbers live
   `active` on compact).

## Tasks

### Phase 1: Reader parse layer (no dependency)

- [x] T001 Add `tmux.ChatOption = "@rk_chat"` const (beside `AgentStateOption`) and the pure `parseChatRef(raw) (provider, ref string)` helper with first-colon split + provider/ref validation in `app/backend/internal/tmux/tmux.go` <!-- R1 R2 -->
- [x] T002 Add `ChatProvider`/`ChatSessionRef` fields to `PaneInfo` (`json:"chatProvider,omitempty"` / `json:"chatSessionRef,omitempty"`) in `app/backend/internal/tmux/tmux.go` <!-- R3 -->

### Phase 2: Reader wiring + reconciler

- [x] T003 Add `#{@rk_chat}` as the 8th `paneFormat` field and move the `parsePanes` skip-guard `< 7` → `< 8`; parse the field via `parseChatRef` into the new `PaneInfo` fields in `app/backend/internal/tmux/tmux.go` <!-- R3 -->
- [x] T004 Add the chat reconciler in `parsePanes` right after the agent-state reconciler: dead pid (3-segment agent-state) OR shell-command fallback (no pid) zeros the chat fields; a dead pid already zeroing agent-state also zeros chat in `app/backend/internal/tmux/tmux.go` <!-- R4 -->
- [x] T005 [P] Tests for `parseChatRef` (valid, colon-in-ref, malformed, unknown-provider-tolerated) and for `parsePanes` chat parse + reconciliation (dead pid zeros both; shell zeros chat; live wrapped pid keeps chat; a 7-field line is skipped by the `< 8` guard) in `app/backend/internal/tmux/tmux_test.go` <!-- R1 R2 R3 R4 -->

### Phase 3: Writer (stdin JSON + chat stamp + stamp token)

- [x] T006 Add `ChatOption` alias + a `writeChatFn` seam and a `writeChat(ctx, pane, provider, ref)` impl (`tmux [-S socket] set-option -pt <pane> @rk_chat <provider>:<ref>` via `exec.CommandContext` + 5s timeout, `tmux.OriginalTMUX` socket) in `app/backend/cmd/rk/agent_hook.go` <!-- R6 -->
- [x] T007 Add the bounded, TTY-guarded, single-object stdin JSON parse (`readHookSessionID(stdin) string`: `os.ModeCharDevice` skip, `io.LimitReader` ~1 MiB, `json.Decoder.Decode` one object, extract + validate `session_id`) in `app/backend/cmd/rk/agent_hook.go` <!-- R5 -->
- [x] T008 Wire `runAgentHook` to (a) accept the `stamp` token as stamp-only, (b) read the session id, (c) stamp `@rk_chat` on every fire yielding a valid session id — while still writing `@rk_agent_state` for the `active|waiting|idle` tokens (not for `stamp`); update the `RunE` arg/`isChatToken`/`isAgentState` dispatch and the `os.Stdin` seam in `app/backend/cmd/rk/agent_hook.go` <!-- R6 R7 -->
- [x] T009 [P] Tests: `readHookSessionID` (valid/absent/malformed/oversized/TTY-skip), stamp-on-every-fire (agent-state + chat both written), `stamp` token (chat only, no agent-state), stamp skipped when no session id, malformed session id not stamped, and the never-fail contract extended with a `stamp`/stdin case in `app/backend/cmd/rk/agent_hook_test.go` <!-- R5 R6 R7 -->

### Phase 4: Installer (SessionStart row)

- [x] T010 Add the `SessionStart` stamp-only entry to the Claude `agentRegistry` row and teach `rkHookEntry`/`agentStateHookCommand` to emit the `stamp` token for a stamp-only hook (state field carries `stamp`) in `app/backend/cmd/rk/agent_setup.go` <!-- R8 -->
- [x] T011 [P] Tests: registry install adds exactly one rk-owned `SessionStart` entry invoking `agent-hook --agent claude stamp`, idempotent re-run, `--uninstall` removes it; update `claudeHooks()` fixture + the entry-count expectations in `app/backend/cmd/rk/agent_setup_test.go` <!-- R8 -->

### Phase 5: Surfacing (rollup)

- [x] T012 Add `ChatProvider`/`ChatSessionRef` to `WindowInfo` (`json:"chatProvider,omitempty"` / `json:"chatSessionRef,omitempty"`) in `app/backend/internal/tmux/tmux.go` <!-- R9 -->
- [x] T013 Add the pure `rollupChat(panes) (provider, ref string)` helper (active pane first, else first pane carrying a chat) and call it beside `rollupAgentState` in `FetchSessions` in `app/backend/internal/sessions/sessions.go` <!-- R9 -->
- [x] T014 [P] Tests for `rollupChat` (active-pane-wins, first-set fallback, none) in `app/backend/internal/sessions/sessions_test.go` <!-- R9 -->

### Phase 6: Spec + plan tracking

- [x] T015 [P] Amend `docs/specs/agent-state.md` with the `@rk_chat` convention section (value schema, writer/reader/reconciliation rules, lifecycle, migration note for both binary-only every-fire stamping and the SessionStart re-setup) <!-- R10 -->
- [x] T016 [P] Fill row 1 `Change folder` of the tracking table in `fab/plans/sahil/agent-chat-view.md` with `260713-nh86-chat-session-identity` <!-- R10 -->

## Execution Order

- Phase 1 (T001, T002) has no dependencies.
- T003 depends on T001+T002; T004 depends on T003; T005 covers Phase 1–2.
- Phase 3 (T006–T009) depends on T001 (for `ChatOption`); otherwise independent of Phases 1–2.
- Phase 4 (T010–T011) depends on the `stamp` token existing (T008).
- Phase 5 (T012–T014) depends on the `PaneInfo` chat fields (T002/T003).
- Phase 6 (T015, T016) is doc-only and independent — run any time.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `@rk_chat` is defined as a pane option `<provider>:<session-ref>` split on the first colon, with a single `tmux.ChatOption` const aliased (not re-declared) by `agent_hook.go`.
- [x] A-002 R2: `parseChatRef` returns `("", "")` on any malformed value and accepts well-formed unknown providers.
- [x] A-003 R3: `paneFormat` carries `#{@rk_chat}` as field 8, the skip-guard is `< 8`, and `PaneInfo` exposes pre-parsed `ChatProvider`/`ChatSessionRef` with the specified JSON tags.
- [x] A-004 R4: The chat reconciler zeros the chat fields for a dead pid (also zeroing agent-state) and for a shell pane without a live pid-bearing agent-state; it does not stat the transcript on disk.
- [x] A-005 R5: The stdin parse is TTY-guarded, `LimitReader`-bounded, single-object, and silent on every failure.
- [x] A-006 R6: Every fire yielding a valid `session_id` stamps `@rk_chat=<agent>:<session_id>` alongside the agent-state write, via `exec.CommandContext` + 5s timeout and the `OriginalTMUX` socket.
- [x] A-007 R7: The `stamp` token writes `@rk_chat` only (no agent-state); unknown tokens no-op.
- [x] A-008 R8: `rk agent-setup` installs an idempotent, uninstallable SessionStart stamp-only registry row with the established wrapper shape.
- [x] A-009 R9: `WindowInfo` carries `ChatProvider`/`ChatSessionRef` filled by `rollupChat` (active-pane-first), and the fields flow over `GET /api/sessions` and SSE `event: sessions` per-window and per-pane.
- [x] A-010 R10: `docs/specs/agent-state.md` documents the `@rk_chat` convention and the plan's tracking-table row 1 holds the change folder name.

### Behavioral Correctness

- [x] A-011 R4: A live pid-bearing agent under a `bash` wrapper keeps its chat fields (liveness wins over the shell heuristic), mirroring agent-state.
- [x] A-012 R6: A fire with no `session_id` writes `@rk_agent_state` only, leaving `@rk_chat` untouched.

### Scenario Coverage

- [x] A-013 R1 R2 R3 R4: `tmux_test.go` exercises `parseChatRef` and `parsePanes` chat parse + all reconciliation branches (dead pid, shell fallback, live wrapped pid, a 7-field line skipped by the `< 8` guard).
- [x] A-014 R5 R6 R7: `agent_hook_test.go` exercises `readHookSessionID`, every-fire dual write, the `stamp`-only path, no-session-id skip, and the extended never-fail contract.
- [x] A-015 R8: `agent_setup_test.go` exercises SessionStart install, idempotency, and uninstall.
- [x] A-016 R9: `sessions_test.go` exercises `rollupChat` (active-pane-wins, first-set fallback, none).

### Edge Cases & Error Handling

- [x] A-017 R2 R6: A `session_id` containing whitespace/control chars or an empty value is never stamped and never partially trusted.
- [x] A-018 R5: Oversized (>1 MiB) or non-JSON stdin yields no chat stamp and never errors; the agent-state write still proceeds.

### Code Quality

- [x] A-019 Pattern consistency: New code follows the naming and structure of the surrounding `@rk_agent_state` machinery (pure parse helpers, func-var seams, one-source-of-truth constants).
- [x] A-020 No unnecessary duplication: Chat reuses `agentProcessAlive`/`isShellCommand`/`tmuxSocketArgs`/`OriginalTMUX` rather than re-implementing liveness, shell detection, or socket derivation.
- [x] A-021 Security (Constitution I): Every new subprocess uses `exec.CommandContext` with a timeout and discrete argv elements; nothing user-derived is interpolated into a shell string (`session_id` is a validated argv element, not shell text).
- [x] A-022 No database/cache (Constitution II): Chat identity is derived from tmux pane options at request time; no state file, no cache, no disk validation.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant (the reconciler restructure in `parsePanes` replaced the prior branch in place, and the `claudeHooks()` test fixture literal was already removed in this diff in favor of reading the real registry).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `@rk_chat` pane option, value `<provider>:<session-ref>`, first-colon split; single `tmux.ChatOption` const aliased by the hook binary | Intake Assumption 1 (Certain — plan Decision log) + the A-021 one-source-of-truth pattern already in the agent-state code | S:90 R:70 A:95 D:90 |
| 2 | Certain | Backend + hooks + spec only; chat is a view over the pane (no DB/SessionStore, no disk validation) | Intake Assumption 2 (Certain) + Constitution II/VI | S:95 R:80 A:95 D:95 |
| 3 | Confident | Session-ref = the session UUID only (not the transcript path) | Intake Assumption 3; the UUID is the official identity and the path is derivable from it (Constitution X) | S:70 R:55 A:80 D:65 |
| 4 | Confident | Stamp on every fire (binary reads stdin JSON) plus a stamp-only SessionStart row | Intake Assumption 4; ids rotate on /clear+/compact, every-fire reaches running agents on upgrade, SessionStart gives "within seconds" | S:65 R:60 A:75 D:60 |
| 5 | Confident | SessionStart is stamp-only (never writes agent-state) | Intake Assumption 5; source=compact fires mid-turn, an idle write would clobber a live active | S:60 R:75 A:85 D:80 |
| 6 | Confident | Clearing = reader-side reconciliation only; no SessionEnd row | Intake Assumption 6; reconciliation is mandatory for crash/kill anyway; mirrors agent-state's no-GC lifecycle | S:65 R:70 A:75 D:55 |
| 7 | Confident | No disk validation of the referenced session | Intake Assumption 7; live agent ⇒ transcript exists; Change 2's read path surfaces a missing transcript | S:70 R:85 A:80 D:70 |
| 8 | Confident | API shape: per-pane split fields + window rollup (active pane first, else first set) | Intake Assumption 8; additive JSON, consumers not built yet, per-pane truth preserved alongside the rollup (mirrors agent-state) | S:55 R:85 A:70 D:55 |
| 9 | Confident | Provider prefix = the registry `--agent` name; reader tolerates unknown well-formed providers | Intake Assumption 9; presence-gating is provider-agnostic, adapters additive | S:60 R:80 A:85 D:75 |
| 10 | Confident | Stamp on ALL registered events (no event restriction); the stdin `session_id` on subagent/PreToolUse fires is the pane's ROOT session, not a sidechain id | Intake Assumption 10 was Tentative pending apply-time verification. VERIFIED empirically at apply: across 1489 subagent (Task-tool) transcript files on this host, every sidechain line carries `sessionId` = the PARENT session UUID (subagent transcripts nest under `<root-uuid>/subagents/agent-*.jsonl`); zero carried a distinct id. Root-session identity is what stamping needs, so no event restriction is required — upgraded Tentative→Confident | S:75 R:65 A:80 D:70 |
| 11 | Confident | Stdin read is bounded (LimitReader ~1 MiB), single-object `json.Decoder.Decode`, TTY-guarded (`os.ModeCharDevice`), all-silent failure | Intake Assumption 11; one-object Decode needs no EOF guarantee, TTY guard covers manual invocation, preserves the tested never-fail contract | S:55 R:80 A:80 D:70 |
| 12 | Confident | The stamped `session_id` is validated (non-empty, no whitespace/control) with the SAME rule `parseChatRef` applies to a ref, before it is written | Symmetry with the reader keeps a value the reader would reject from ever being written; avoids a stamp the reconciler/parse would silently drop | S:60 R:80 A:75 D:70 |

12 assumptions (2 certain, 10 confident, 0 tentative).

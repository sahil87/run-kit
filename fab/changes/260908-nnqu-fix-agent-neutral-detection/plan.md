# Plan: Fix agent-neutral detection and transcript-backed actions

**Change**: 260908-nnqu-fix-agent-neutral-detection
**Intake**: `intake.md`

## Requirements

### Backend: Agent-neutral shared hook writer

#### R1: Provider runtime registry decoupled from installation

The `rk agent hook` writer MUST resolve a provider's runtime descriptor (process comm literal, hook-payload field mapping, mid-turn-compaction source value) from a shared runtime registry that is NOT the installer's config-shape table. A provider MUST NOT be rejected by the writer merely because it lacks a Claude-shaped installer entry. An unknown/unregistered provider MUST remain a silent no-op (never-fail contract). The registry lives in `cmd/rk` (new file `agent_registry.go`), shared by the hook writer, the installer, and the doctor check — the same package today, so no new internal package is extracted (concrete coupling stays zero).

- **GIVEN** a hook fires with `--agent codex` inside a tmux pane
- **WHEN** `runAgentHook` resolves the provider
- **THEN** it finds the codex runtime descriptor (comm `codex`, payload field `session_id`) and proceeds even though the descriptor carries no Claude-style settings path
- **AND** a fire with `--agent nosuch` still exits 0 writing nothing

#### R2: Per-provider hook payload normalization

The writer MUST normalize each supported provider's stdin payload to the common representation (opaque session ref, lifecycle source) via the provider's descriptor: `session_id` (claude/codex/gemini/kimi) or `sessionId` (copilot camelCase). The stamp token's boot `idle` write MUST stay gated on the mid-turn compaction source per provider (`compact` for claude/codex; providers whose SessionStart has no compact source never trigger the gate). Session-id rotation MUST re-stamp identity on every fire (existing every-fire rule). Child/subagent harness events (Codex `SubagentStart`/`SubagentStop`, Kimi `SubagentStart/Stop`, Copilot `subagentStart/Stop`) MUST NOT be registered by any installer and therefore can never replace the root pane's identity or complete its turn. Session refs MUST be validated (existing no-whitespace/control rule) before any write.

- **GIVEN** a codex SessionStart payload with `source: "compact"` and a session id
- **WHEN** the stamp token fires
- **THEN** `@rk_pane_agent_session` is re-stamped with the new id AND no `idle` write clobbers a live `active` state
- **AND** a payload carrying `sessionId` (copilot camelCase) stamps `copilot:<id>` identically

#### R3: Per-provider process identification

The comm-validated ancestor walk MUST use the provider's comm literal: `claude`, `codex`, `node` (gemini — the CLI is a node bundle), `copilot`, `kimi-code` (the kimi binary reports comm `kimi-code`), `opencode`. A walk that finds no matching ancestor within the bound MUST omit the pid segment (never a wrong pid). Reader reconciliation (pid-liveness + legacy shell-command fallback in `internal/tmux`) is unchanged.

- **GIVEN** a hook fire from a kimi session (ancestor comm `kimi-code`)
- **WHEN** the ancestor walk runs
- **THEN** it matches on `kimi-code` and writes the pid segment; for gemini it matches the `node` ancestor that spawned the hook

### Backend: Installer (`rk agent setup`)

#### R4: Claude install parity (regression)

The Claude Code registry entry, event mapping, JSON merge shape, three-generation rk-entry markers, consent flow, and doctor classification MUST behave exactly as before this change. Existing tests keep passing unmodified in intent.

- **GIVEN** an existing `~/.claude/settings.json` with non-rk hooks
- **WHEN** `rk agent setup` runs
- **THEN** the merged result, consent output, and idempotency are byte-equivalent to the pre-change behavior

#### R5: Codex installer

The installer MUST merge rk-owned hook entries into `$CODEX_HOME/hooks.json` (default `~/.codex/hooks.json`) using the SAME nested JSON merge machinery as Claude (Codex's hooks.json schema is the Claude shape: `hooks → <Event> → [{matcher?, hooks: [{type:"command", command}]}]`, verified against https://developers.openai.com/codex/hooks on 2026-09-09). Mapping: `UserPromptSubmit`/`PreToolUse`→active, `PermissionRequest`→waiting, `Stop`/`SessionEnd`→idle, `SessionStart`→stamp. The install output MUST state Codex's native trust requirement plainly: non-managed hooks are hash-reviewed and skipped until trusted via the interactive `/hooks` browser, so a written hook is NOT yet active — the installer never represents written-but-untrusted hooks as operational.

- **GIVEN** a fresh `$CODEX_HOME` with no hooks.json
- **WHEN** `rk agent setup --yes` runs
- **THEN** hooks.json contains the six rk entries (preserving any pre-existing non-rk entries on re-merge), the output names the `/hooks` trust step, and a re-run is a no-op

#### R6: Gemini CLI installer

The installer MUST merge rk-owned entries into `~/.gemini/settings.json` under the `hooks` object (nested Claude-like shape, verified against https://geminicli.com/docs/hooks/ on 2026-09-09). Mapping: `SessionStart`→stamp (matcher sources are `startup|resume|clear` — no compact source exists), `BeforeAgent`/`BeforeTool`→active, `Notification` matcher `ToolPermission`→waiting (advisory only — Gemini permission prompts cannot be answered by hooks, but the event fires before the prompt), `AfterAgent`/`SessionEnd`→idle.

- **GIVEN** a gemini settings.json with an unrelated `security` key
- **WHEN** the install runs
- **THEN** the hooks object is merged without touching `security`, and the entries carry the gemini event names

#### R7: Copilot CLI installer

The installer MUST write a marker-owned whole file `$COPILOT_HOME/hooks/run-kit.json` (default `~/.copilot/hooks/`) of the verified shape `{"version": 1, "hooks": {"<camelCaseEvent>": [{"type":"command","command":...,"matcher"?}]}}` (flat entries, matcher on the entry — NOT the Claude nesting; verified against https://docs.github.com/en/copilot/reference/hooks-reference on 2026-09-09). Mapping (camelCase events ⇒ camelCase payload with `sessionId`): `sessionStart`→stamp, `userPromptSubmitted`/`preToolUse`→active, `permissionRequest`→waiting, `notification` matcher `permission_prompt|elicitation_dialog`→waiting, `notification` matcher `agent_idle`→idle, `agentStop`→idle. The file is whole-file marker-owned (shim-style): rk creates/replaces/removes exactly it, never merges into a foreign file. Output MUST note that Copilot loads hook configuration at CLI start (restart to pick up). The never-fail wrapper keeps every fire at exit 0, which also satisfies Copilot's fail-closed preToolUse command-hook rule.

- **GIVEN** no `~/.copilot/hooks/` directory
- **WHEN** the install runs
- **THEN** `run-kit.json` is created 0600 with the seven entries; `--uninstall` removes exactly that file; a marker-less foreign `run-kit.json` is never overwritten

#### R8: Kimi CLI installer

The installer MUST upsert a marker-owned `[[hooks]]` block into `$KIMI_CODE_HOME/config.toml` (default `~/.kimi-code/config.toml`) using the existing `upsertMarkerBlock`/`removeMarkerBlock` machinery (no TOML parser, no new dependency — appended `[[hooks]]` tables are valid TOML; only the four documented fields `event`/`matcher`/`command`/`timeout` are used because unknown fields fail the whole config load). Mapping (verified against https://moonshotai.github.io/kimi-code/en/customization/hooks.md on 2026-09-09): `SessionStart`→stamp, `TurnStarted`/`PreToolUse`→active, `PermissionRequest`→waiting, `Stop`→idle. Output notes hooks load at session start.

- **GIVEN** an existing config.toml carrying user keys and tables
- **WHEN** the install runs
- **THEN** the rk block is appended once (byte-exact preservation of all surrounding content), a re-run replaces it in position, and `--uninstall` restores the original bytes

#### R9: OpenCode installer

The installer MUST write a marker-owned plugin file `~/.config/opencode/plugins/run-kit.js` (whole-file ownership, 0644) implementing the OpenCode plugin contract (`event` hook over the event stream, verified against https://opencode.ai/docs/plugins/ and the installed `@opencode-ai/plugin@1.18.25` types): `session.created`→stamp (id from `properties.info.id`), `session.status` busy→active, `permission.updated`→waiting (1.18.25 name; the docs' newer `permission.asked` naming noted), `session.idle`→idle. The plugin MUST ignore child sessions (parentID present), and validate event session IDs against the pane's root session, including resumed roots with no new session.created event. Child created/status/idle/permission events MUST NOT replace root identity or complete its turn. Use only actual event-stream events; tool.execute.before is a separate plugin hook, not an event type. The plugin MUST no-op outside tmux (`TMUX_PANE` unset) and swallow every error (never-fail parity).

- **GIVEN** an opencode install with no plugins dir
- **WHEN** the install runs
- **THEN** the plugin file is created, and firing a synthetic `session.idle` through it writes `idle:<epoch>[:<pid>]` on the current pane and stamps `opencode:<sessionID>`

#### R10: Installer invariants across all harnesses

Every adapter MUST preserve the existing contract: idempotent replace-in-place, unrelated user config preserved, diff + consent before writing, `--yes`/`--dry-run`/non-TTY refusal semantics, `--uninstall` removing exactly the rk-owned artifacts, stable absolute rk path validated by `validateHookPath`, and the never-fail wrapper shape. `rk doctor`'s `agent hooks` row MUST aggregate across every registry agent (per-agent classification) instead of returning after the first entry.

- **GIVEN** a machine with claude + codex installed hooks, one carrying a stale gen-2 entry
- **WHEN** `rk doctor` runs
- **THEN** the agent-hooks row reports the stale entry (FAIL with re-run hint) regardless of registry order

#### R11: Antigravity CLI native integration

Antigravity CLI (`agy` 1.1.11 installed locally) exposes native lifecycle hooks. Implement a runtime descriptor, safe named-hook merge into its documented customization root (`~/.gemini/config/hooks.json`, workspace `.agents/hooks.json` is native prior art), `conversationId` normalization, PreInvocation active+identity, and Stop idle only when `fullyIdle` permits. Use the installed primary reference `~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/hooks.md` and https://antigravity.google/docs/hooks. Preserve permissions: telemetry MUST NOT emit an allow/deny tool decision or force continuation. Resolve validated conversation UUIDs through the documented CLI brain/<id>/.system_generated/logs/transcript.jsonl layout. Verify installation and event handling in isolation; document missing waiting/startup events and any actual version/runtime limitations honestly. No claim that Antigravity lacks hooks or a CLI is permitted.

- **GIVEN** an isolated Antigravity customization root and matching conversation transcript
- **WHEN** the installed PreInvocation and fully-idle Stop handlers run
- **THEN** the pane receives agy identity and active/idle state and the conversation resolves, without affecting native permission decisions or user configuration

### Transcript resolution (`internal/transcript`)

#### R12: Codex transcript adapter

A codex adapter MUST resolve a session ref to `$CODEX_HOME/sessions/<YYYY>/<MM>/<DD>/rollout-<ts>-<ref>.jsonl` via the fixed-depth glob `sessions/*/*/*/rollout-*-<ref>.jsonl` (layout verified on the installed 0.153.4; the ref MUST match a UUID shape — case-insensitive hex+dashes — before any filesystem access). `$CODEX_HOME` overrides the root (default `~/.codex`) so tests are hermetic. Errors stay distinct: ErrInvalidRef / ErrTranscriptNotFound / ErrNoAdapter.

- **GIVEN** a fixture transcript at `$CODEX_HOME/sessions/2026/09/09/rollout-2026-09-09T10-00-00-<uuid>.jsonl`
- **WHEN** `transcript.Path("codex", "<uuid>")` runs
- **THEN** it returns the absolute path; a non-UUID ref returns ErrInvalidRef before touching the filesystem

#### R13: Gemini transcript adapter

A gemini adapter MUST resolve a UUID ref via glob `~/.gemini/tmp/*/chats/session-*-<ref[:8]>.jsonl` (only the first 8 hex chars appear in the filename — verified locally) and MUST verify the full session id by reading the candidate file's first record (`sessionId`) before returning it; a prefix collision without a full-id match is ErrTranscriptNotFound.

- **GIVEN** two candidate files sharing the ref's first 8 chars, only one with a matching `sessionId`
- **WHEN** `transcript.Path("gemini", "<uuid>")` runs
- **THEN** it returns the verified file, never the prefix-only collision

#### R14: Kimi transcript adapter

A kimi adapter MUST resolve a ref (shape `session_<uuid>` or a bare safe token) by scanning `$KIMI_CODE_HOME/session_index.jsonl` (one JSON record per line mapping session id → session dir — verified locally) for `agents/main/wire.jsonl` under the recorded dir, falling back to the bounded glob `sessions/*/<ref>/agents/main/wire.jsonl`. Refs are validated (safe-token: alphanumerics, `-`, `_`) before any filesystem access.

- **GIVEN** a session_index record for `session_<uuid>` and a wire.jsonl at the recorded dir
- **WHEN** `transcript.Path("kimi", "session_<uuid>")` runs
- **THEN** it returns the wire.jsonl path; an unknown id falls back to the glob then ErrTranscriptNotFound

#### R15: Evidence-based Copilot and OpenCode conversation capability

Copilot keeps identity+lifecycle when no conversation file can be derived from its session id on the verified install. Record only observed limitations; do not claim an unverified SQLite store. OpenCode 1.18.25 exposes native `opencode export [sessionID] --pure --sanitize` with JSON output and no new database dependency. Assess this mechanism against the current path-based TranscriptLocator and request-time bounded-work/no-authoritative-store constraints. Prefer a viable bounded integration; if deferred, document the concrete measured/contract tradeoff and precise unavailable capability, not nonexistent access or lack of user approval. Do not run full transcript export on every dashboard fetch or introduce an authoritative export cache. Existing unsupported capability must stay unadvertised; any new supported capability must use fresh request/queue revalidation and isolated tests.

- **GIVEN** a provider with no implemented bounded conversation locator
- **WHEN** the sidebar derives actions
- **THEN** transcript actions remain absent and the matrix states its actual evidence-backed limitation, without denying the provider's native export API

### Capability-based actions

#### R16: Server-derived conversation capability on WindowInfo

`tmux.WindowInfo` MUST gain a derived `conversationAvailable` field (JSON `conversationAvailable,omitempty`): true iff the window's rolled-up reconciled agent identity is present AND the provider has a registered adapter with the TranscriptLocator capability AND a bounded transcript resolution succeeds. Derivation happens ONCE per identified window per fetch in `internal/sessions` (window rollup seam, never per-pane), using the adapters' bounded glob/index lookups or their cheap ConversationChecker probe (opencode — resolution is a request-priced export) — no unbounded scans, no subprocess on the derive tick. Failures degrade to false, never errors.

- **GIVEN** a window stamped `codex:<uuid>` whose rollout file exists
- **WHEN** FetchSessions derives the window
- **THEN** `conversationAvailable` is true; when the transcript is deleted the next derive reports false

#### R17: Flyout + palette gate on the server-derived capability

`canRequestWindowOperatorAction` (row-flyout-card.tsx) and the palette gate (app.tsx) MUST both use the server-derived `conversationAvailable` instead of raw `agentSessionRef` presence — omit-not-disable preserved. POST `/api/windows/{id}/operator-request` revalidation (transcript resolution at request time) and queue-drain revalidation (fresh FetchSessions in `operatorQueueDeliver`) MUST be preserved unchanged. Identity-only providers (copilot, opencode) MUST NOT advertise Fix tab name / Annotate tab.

- **GIVEN** a server with an operator and a copilot subject with a stamped identity
- **WHEN** the flyout and palette render
- **THEN** neither shows Fix tab name; the same window with a resolvable claude/codex/gemini/kimi transcript shows it in both surfaces

#### R18: Consumer compatibility across providers

Agent-targeted send (`POST /api/windows/{id}/send` target agent), operator facts (server templates' transcript corpus), and auto-name on idle MUST work unchanged for any provider whose transcript resolves, and degrade as today when it does not. Fork/resume MUST stay Claude-gated (unchanged). No terminal-scrollback fallback is added.

- **GIVEN** a codex subject with a resolvable transcript
- **WHEN** an operator fix-tab-name request is delivered
- **THEN** the rendered prompt carries the codex rollout path; auto-name eligibility treats the codex window exactly like a claude one

### Audit and documentation

#### R19: Versioned capability matrix + surface updates

A capability matrix with versioned evidence MUST be published at `docs/site/agent-hooks.md` (linked from `docs/site/install.md`; readme-extraction conformant: no reserved name, absolute outbound links), covering all seven audited harnesses: verified version + doc source, mechanism, install location, identity field, lifecycle mapping, process comm, transcript resolution, trust/reload requirements, and unavailable capabilities with reasons. `rk agent setup` / `rk agent hook` help text, `docs/site/install.md`, and the README agent-state section MUST be updated to the multi-harness reality (dropping "v1 targets Claude Code"), checked against the current `shll standards` (skill, help-dump, readme-extraction).

- **GIVEN** the merged change
- **WHEN** a reader opens docs/site/agent-hooks.md
- **THEN** every supported harness row carries a verified version and source URL, and every gap row carries its evidence and reason

### Verification

#### R20: Codex end-to-end in isolation

An integration test MUST prove the codex path end-to-end without touching any live user agent/operator: an isolated tmux socket plus isolated `$CODEX_HOME`; `rk agent setup` installs into the isolated root; the INSTALLED hook command is executed exactly as codex would invoke it (sh -c wrapper, `$TMUX_PANE` set, codex-shaped payload on stdin) against a real pane; the pane gains `codex:<uuid>` identity and lifecycle state; a fixture rollout transcript at the matching path makes `transcript.Path` and the operator-request render resolve the real conversation; the frontend gate is proven by unit tests over the derived payload. Native Codex hook discovery and trust are separate activation behavior: the regression executes installed commands directly and MUST be described as that level of integration coverage, not a real authenticated Codex session run. Do not bypass native trust or copy credentials; document the real activation step.

- **GIVEN** the isolated rig
- **WHEN** the installed SessionStart hook command fires with a codex payload
- **THEN** `@rk_pane_agent_session = codex:<uuid>` and `@rk_pane_agent_state` land on the pane, and `transcript.Path("codex", <uuid>)` resolves the fixture rollout

#### R21: Edge and regression coverage

Tests MUST cover: startup/resume stamping, session-id rotation, the compaction gate (claude + codex payloads), child events cannot overwrite root identity or lifecycle (execute real plugin handlers with root/child event fixtures, including resume), alongside registry assertions, wrapped launches (pid walk per provider comm), crash/exit reconcile, plain-shell panes, malformed payloads/refs, unavailable transcripts, unknown providers (silent no-op), setup repeatability + config preservation for every adapter, and capability consistency across API/flyout/palette/queue-drain. Claude's existing suite MUST pass unmodified in intent.

- **GIVEN** the full test run (`just test`)
- **WHEN** it completes
- **THEN** backend + frontend + e2e are green and `just build` succeeds

### Non-Goals

- Cross-provider fork/resume — stays Claude-gated by design (intake).
- Terminal-scrollback fallback for Fix tab name — suggested in discussion, never selected.
- A mandatory dot-agents (`da`) dependency or toolkit-wide hook schema — prior art only.
- A settings page, new route family, database, or persistent session registry.
- Installing hooks into, messaging, or restarting any live user agent/operator — verification is isolated-only.

### Design Decisions

#### Runtime registry split from installer shape

**Decision**: One runtime descriptor per provider (comm, payload fields, compact source) in `cmd/rk/agent_registry.go`, referenced by the hook writer; installer entries add config placement/format on top. A provider can exist in the runtime registry without an installer.
**Why**: The intake's core failure was the writer rejecting any provider lacking a Claude-shaped installer entry; the split makes runtime handling and installation orthogonal.
**Rejected**: A new `internal/harness` package — hook, setup, and doctor all live in `cmd/rk` today, so extraction removes no concrete coupling (intake: extract only where it does).
*Introduced by*: 260908-nnqu-fix-agent-neutral-detection

#### Three installer kinds over one Claude-shaped merge

**Decision**: `jsonHooksMerge` (claude settings.json, codex hooks.json, gemini settings.json — same nested schema), `markerFile` (copilot hooks/run-kit.json, opencode plugin — whole-file ownership like the tmux shim), `markerBlock` (kimi config.toml — reuses `upsertMarkerBlock`). All share the existing consent/diff/dry-run/uninstall machinery.
**Why**: The verified native formats fall into exactly these three shapes; reusing the existing ownership machinery keeps the safety contract uniform.
**Rejected**: A TOML parser dependency for kimi (unknown-field fragility is avoided by emitting only documented fields; marker blocks preserve user content byte-exactly) and JSON-merging into a foreign copilot file (its hooks dir is one-file-per-source — whole-file ownership is the native shape).
*Introduced by*: 260908-nnqu-fix-agent-neutral-detection

#### Capability derived at window rollup, bounded resolution

**Decision**: `conversationAvailable` derives once per identified window per fetch via the adapters' bounded glob/index lookups; the frontend gates on it; POST and queue-drain revalidation stay as-is.
**Why**: Keeps flyout/palette honest for identity-only providers without per-pane unbounded scans on every derive tick (intake constraint).
**Rejected**: Advertising on identity presence alone (predictably fails for copilot/opencode) and caching resolutions (Constitution II — derive at request time).
*Introduced by*: 260908-nnqu-fix-agent-neutral-detection

#### Transcript paths derived, never hook-carried

**Decision**: Adapters resolve transcripts from the session ref via bounded filesystem lookups (codex/gemini/kimi); codex/gemini payloads carry `transcript_path` but the writer ignores it.
**Why**: Constitution X — hooks carry only the underivable; the path is derivable from the session id, and trusting a client-supplied path is the forbidden direction.
**Rejected**: Stamping `transcript_path` into a pane option (contract change; also unavailable on the copilot events we hook).
*Introduced by*: 260908-nnqu-fix-agent-neutral-detection

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/backend/cmd/rk/agent_registry.go`: runtime provider descriptors (provider token, display name, comm literal, session-id payload field, source field, compact-source value) for claude/codex/gemini/copilot/kimi/opencode/agy; `hookSessionID` payload-field lookup lives here; unit tests in `agent_hook_test.go` <!-- R1 R3 --> <!-- rework: requirements revised after review; MF-1..4 and SF-1..4 -->

### Phase 2: Core Implementation

- [x] T002 Generalize `app/backend/cmd/rk/agent_hook.go`: payload normalization via the registry (session_id/sessionId, per-provider compact gate), comm from registry, unknown provider silent no-op, `--agent` flag help text updated; extend `agent_hook_test.go` (per-provider payloads, rotation, compaction gate for codex, unknown provider) <!-- R1 R2 R3 --> <!-- rework: requirements revised after review; MF-1..4 and SF-1..4 -->
- [x] T003 Add `app/backend/internal/transcript/codex.go` (CODEX_HOME root override, UUID guard, fixed-depth rollout glob) + `codex_test.go` <!-- R12 --> <!-- rework: requirements revised after review; MF-1..4 and SF-1..4 -->
- [x] T004 [P] Add `app/backend/internal/transcript/gemini.go` (tmp/*/chats prefix glob + first-record sessionId verification) + `gemini_test.go` <!-- R13 -->
- [x] T005 [P] Add `app/backend/internal/transcript/kimi.go` (KIMI_CODE_HOME, session_index.jsonl scan + bounded glob fallback, safe-token guard) + `kimi_test.go` <!-- R14 -->
- [x] T006 Refactor `app/backend/cmd/rk/agent_setup.go` into installer kinds (`jsonHooksMerge`, `markerFile`, `markerBlock`) sharing consent/diff machinery; keep Claude byte-identical; add codex (hooks.json merge + trust note) and gemini (settings.json merge) entries; extend `agent_setup_test.go` <!-- R4 R5 R6 R10 --> <!-- rework: requirements revised after review; MF-1..4 and SF-1..4 -->
- [x] T007 Add the copilot marker-file adapter ($COPILOT_HOME/hooks/run-kit.json, flat camelCase entries, restart note) + tests <!-- R7 --> <!-- rework: requirements revised after review; MF-1..4 and SF-1..4 --> <!-- rework: cycle 2 security and required-acceptance fixes -->
- [x] T008 Add the kimi marker-block adapter ($KIMI_CODE_HOME/config.toml [[hooks]] block via upsertMarkerBlock) + tests <!-- R8 -->
- [x] T009 Add the opencode marker-file adapter (~/.config/opencode/plugins/run-kit.js plugin source, event mapping, never-fail) + tests <!-- R9 --> <!-- rework: requirements revised after review; MF-1..4 and SF-1..4 -->
- [x] T010 Generalize the doctor `agent hooks` row in `app/backend/cmd/rk/doctor.go` to aggregate per-registry-agent (incl. marker-file/marker-block presence and staleness) + `doctor_test.go` <!-- R10 --> <!-- rework: requirements revised after review; MF-1..4 and SF-1..4 -->
- [x] T011 Backend capability: `ConversationAvailable` on `tmux.WindowInfo` + window-rollup derivation in `app/backend/internal/sessions/sessions.go` via `internal/transcript` (bounded, degrade-false) + tests <!-- R16 --> <!-- rework: cycle 2 security and required-acceptance fixes -->
- [x] T012 Frontend gating: `app/frontend/src/types.ts` field, `canRequestWindowOperatorAction` in `components/sidebar/row-flyout-card.tsx`, palette gate in `app.tsx`; update `row-flyout-card.test.tsx` / `app.test.tsx` <!-- R17 -->

### Phase 3: Integration & Edge Cases

- [x] T013 Codex isolated end-to-end test (`app/backend/cmd/rk/agent_setup_integration_test.go` or fitting home): isolated tmux socket + CODEX_HOME, setup installs, installed hook command executed verbatim with codex payload against a real pane, identity+state land, fixture rollout resolves via transcript.Path; native trust/discovery distinguished from installed-command integration coverage; no live agents touched <!-- R20 -->
- [x] T014 Edge-case tests: malformed payloads/refs, unknown providers, wrapped-launch pid walks per comm, dead-pid reconcile per provider, plain shells, compaction gate, subagent events absent from every installed mapping (registry assertion over all adapters), setup repeatability/config preservation for all seven adapters <!-- R2 R10 R21 --> <!-- rework: requirements revised after review; MF-1..4 and SF-1..4 -->
- [x] T015 Consumer compatibility tests: operator-request render with a codex transcript (`app/backend/api/operator_test.go`), server facts corpus with codex ref, auto-name eligibility for codex (`auto_name_test.go`), agent-targeted send provider neutrality, copilot identity-only 404 path (opencode resolves via native export since cycle 1) <!-- R15 R18 --> <!-- rework: requirements revised after review; MF-1..4 and SF-1..4 -->

### Phase 4: Polish

- [x] T016 Publish `docs/site/agent-hooks.md` capability matrix (7 harnesses, versioned evidence, honest gaps incl. antigravity/copilot-transcript/opencode-transcript), link from `docs/site/install.md`, update README agent-state section; readme-extraction conformance (no reserved name, absolute outbound links) <!-- R11 R15 R19 --> <!-- rework: requirements revised after review; MF-1..4 and SF-1..4 --> <!-- rework: cycle 2 security and required-acceptance fixes -->
- [x] T017 Update CLI help surfaces (`rk agent setup` Long, `rk agent hook --agent` flag) to multi-harness reality; confirm help-dump/skill standards conformance and drift-guard tests green <!-- R19 --> <!-- rework: requirements revised after review; MF-1..4 and SF-1..4 --> <!-- rework: cycle 2 security and required-acceptance fixes -->
- [x] T018 Run the full gates: `just test-backend`, frontend `tsc --noEmit`, `just test`, `just build` — fix any fallout <!-- R20 R21 --> <!-- rework: requirements revised after review; MF-1..4 and SF-1..4 --> <!-- rework: cycle 2 security and required-acceptance fixes --> <!-- rework: cycle 3 native mixed-case IDs and artifact consumer lifetime -->
- [x] T019 Implement Antigravity runtime/installer/transcript support per corrected R11 with isolated fixtures, capability/doctor coverage and accurate documentation. <!-- R11 R19 -->
- [x] T020 Resolve MF-2/MF-4 and SF-1..4: root-session-aware OpenCode events (including resume), remove dead helper/mapping, narrow Codex lookup, preserve mixed Copilot files, update package docs. <!-- R1 R9 R10 R12 R21 --> <!-- rework: cycle 2 security and required-acceptance fixes -->
- [x] T021 Assess native OpenCode export; implement a viable bounded path or record the precise contract/performance limitation with evidence. Update all affected requirements/tests/docs consistently and correct unsupported Copilot storage claims. <!-- R15 R16 R19 --> <!-- rework: cycle 2 security and required-acceptance fixes --> <!-- rework: cycle 3 native mixed-case IDs and artifact consumer lifetime -->

### Phase 6: Export safety and required coverage

- [x] T022 Harden OpenCode export: validate native session IDs and prevent flag injection, enforce subprocess/output bounds, use private race-safe artifact creation/replacement, and bound artifact retention without an authoritative store. Cover malicious/preexisting temp paths, over-limit output, failures, concurrency and cleanup with isolated tests. <!-- R15 R16 R21 --> <!-- rework: cycle 3 native mixed-case IDs and artifact consumer lifetime -->
- [x] T023 Execute mixed user+rk Copilot setup/uninstall fixtures proving byte-exact preservation; restore AltScreen comment, add agy to the registry-wide assertion, eliminate whole-history Codex miss fallback, and render only the managed Kimi hook block in previews so unrelated secrets never appear. <!-- R1 R10 R12 R19 R21 -->

### Phase 7: Native identifiers and artifact lifetime

- [x] T024 Accept the native mixed-case OpenCode ses_ identifiers while preserving ref/argv safety; add source-grounded accept fixtures for capability and resolution and correct related comments. Make retention preserve freshly referenced exports across a corpus of more than eight sessions and concurrent requests, with bounded resources and explicit retention semantics. Add actual consumer-shaped regression coverage. <!-- R15 R16 R18 R21 -->

## Execution Order

- T001 blocks T002, T006–T010 (all registry consumers)
- T003–T005 are independent of each other; T011 is meaningful for the new providers only after T003–T005
- T006 blocks T007–T009 (shared installer-kind machinery)
- T012 follows T011 (frontend consumes the new field)
- T013–T015 follow all Phase 2 tasks; T016–T018 last
- Rework cycle 1: T019–T021 run after the revised requirements land; T019 is independent, T020's OpenCode plugin fix feeds T021's capability story

## Acceptance

- [x] A-037 R15/R16: Native mixed-case ses_ IDs pass both capability and transcript resolution; flag/path-shaped refs remain rejected before export, with the end-of-options separator retained — cycle-3 review: opencodeRefRe is now `^ses_[0-9a-f]{12}[A-Za-z0-9]{14}$` (opencode.go:27), matching the tagged v1.18.25 generator fetched this review (id.ts: `prefix + "_" + 12 lowercase-hex + randomBase62(14)` over a mixed-case 0-9A-Za-z alphabet); the mixed-case native fixture passes the guard (TestOpencodeRefGuard), the capability probe (TestOpencodeConversationAvailable), resolution (TestOpencodeTranscriptPath), and the argv builder pins `--` (TestOpencodeExportArgsSeparator); flag/path/whitespace shapes stay ErrInvalidRef; the false "verified lowercase" comment is corrected and safeTokenRefRe no longer names opencode (adapter.go:77-80). PASS
- [x] A-038 R18/R21: Resolving a corpus larger than eight OpenCode sessions preserves every successfully returned path through prompt construction; concurrent writes/pruning do not evict freshly referenced artifacts, and resource/retention bounds are documented and tested — cycle-3 review: retention is consumer-aware (opencode.go:38-60,256-268): 1h grace exceeds the operator queue's 30-min TTL; in-grace artifacts are never evicted — at the cap (16) a new materialization is REFUSED with errExportCapacity and the facts builder degrades the refusal by omission (operator.go:714), so no rendered prompt can dangle; the prune-check-write critical section runs under a package mutex. Tests prove the >cap corpus (24 windows: 16 handed out and all still readable, 8 cleanly refused — TestOpencodeExportGraceProtectsCorpus), past-grace pruning, capacity refusal preserving handed-out paths, and concurrent write/prune safety; bounds documented in docs/site/agent-hooks.md:24. PASS


- [x] A-035 R15/R21: OpenCode exports cannot interpret a session ref as flags or follow preplaced temp symlinks, stdout and runtime are bounded, successful artifacts have an explicit bounded retention policy, and failures/concurrent requests remain safe; regression tests exercise these boundaries — cycle-2 review: verified in opencode.go (argv carries `--` end-of-options + ses_-prefixed ref guard, boundedBuffer 32 MiB cap + 15s timeout, user-private $XDG_STATE_HOME dir with symlink/foreign-owner refusal and 0700 tightening, CreateTemp+rename atomic replace, newest-8 retention) with dedicated tests (ref guard, argv separator, overflow, symlink dir/target, perm tightening, concurrency, retention) all PASS. NOTE: the ref guard itself is over-narrow vs. native mixed-case ids — see A-018/review-cycle-2 MF-1 (correctness, not safety)
- [x] A-036 R10/R19: Kimi setup previews show the managed hook change without printing unrelated configuration values, including credentials — cycle-2 review: applyAgentMarkerBlock dry-run renders only the marker-block region via markerBlockBounds (agent_setup_markers.go:180-194); TestKimiDryRunNeverPrintsUserSecrets proves a sentinel api_key never appears in dry-run output while the managed block does; PASS


- [x] A-032 R11: Antigravity native integration follows the installed/official schema, preserves user config and permissions, resolves its validated transcript path, and clearly documents unavailable event states — re-review: named-hook merge owns only the "run-kit" key in ~/.gemini/config/hooks.json (the documented global customization root, verified in the installed agy-customizations SKILL.md/hooks.md); flat PreInvocation/Stop handlers with the {} no-decision wrapper (never an allow/deny/force_continue); fullyIdle-gated idle; transcript layout brain/<id>/.system_generated/logs/transcript.jsonl verified on disk; TestAgyHookEndToEnd + TestAgyNamedHookLifecycle PASS; no-waiting/no-SessionStart gaps documented in the matrix
- [x] A-033 R9/R21: Executing the real OpenCode plugin with root, child, resumed-root and unrelated-session fixtures preserves root identity/state and ignores child completion — re-review: TestOpencodePluginExecutedRootChildFixtures runs the INSTALLED plugin byte-for-byte under node (capture shim); child (parentID) and unresolvable sessions never reach rk, resumed roots work without session.created; client.session.get({path:{id}})/parentID verified against installed @opencode-ai/sdk 1.18.25 types; PASS
- [x] A-034 R10: Mixed user-owned Copilot hook JSON is not overwritten or deleted merely because one command mentions rk; ownership tests prove foreign entries survive setup/uninstall — cycle-2 review: markerFileOwned requires EVERY JSON hook entry's command to be rk-marked, and TestCopilotMixedFileSurvivesInstallAndUninstall proves the named MIXED scenario (user entries + one rk-marked command) survives BOTH install and uninstall byte-exact with a narrated skip; PASS


### Functional Completeness

- [x] A-001 R1: `rk agent hook --agent <p>` resolves every registered provider's runtime descriptor without an installer entry; unknown providers exit 0 writing nothing — verified in agent_registry.go/agent_hook.go + hook tests
- [x] A-002 R2: Hook payloads normalize per provider (snake/camel session id); compaction sources never write idle mid-turn; identity re-stamps on rotation — hookInput dual casing + per-provider compactSource; codex e2e step 3
- [x] A-003 R3: The pid walk uses each provider's comm (claude/codex/node/copilot/kimi-code/opencode) and omits the pid when unvalidated — resolveAgentPID returns 0 → two-segment value; comm literals verified against installed binaries (only gemini is a node script)
- [x] A-004 R4: Claude install, hook behavior, and doctor classification are unchanged (existing suite green) — claude registry row byte-identical to base (git show 3b444a1a)
- [x] A-005 R5: `rk agent setup` installs codex hooks into an isolated `$CODEX_HOME/hooks.json`, preserves foreign entries, is idempotent, and its output names the `/hooks` trust step — postInstallNote + TestCodexHookEndToEnd (PASS)
- [x] A-006 R6: Gemini entries merge into `~/.gemini/settings.json` with the documented event names, foreign config preserved
- [x] A-007 R7: Copilot's marker-owned `hooks/run-kit.json` installs/uninstalls exactly, camelCase events, restart note printed; foreign file at that path is never overwritten — see also SF-3 (substring ownership edge)
- [x] A-008 R8: Kimi's `[[hooks]]` block upserts/removes byte-exactly in a config.toml carrying user content
- [x] A-009 R9: The opencode plugin file installs/uninstalls exactly and maps the documented events to `rk agent hook` invocations — re-review: the dead `tool.execute.before` mapping is removed (1.18.25's event union has no such type); mapping is session.created/session.status busy/permission.updated/session.idle only, verified against installed @opencode-ai/sdk types
- [x] A-010 R10: All adapters honor diff+consent, --yes, --dry-run, non-TTY refusal, and --uninstall; doctor aggregates every registry agent — doctor_test.go green (incl. per-kind aggregation tests: copilot marker-file, kimi marker-block, opencode plugin, agy named doc)
- [x] A-011 R12/R13/R14: codex/gemini/kimi refs resolve to their transcripts under isolated config roots; invalid refs error before filesystem access; missing transcripts and unsupported providers stay distinct error classes — transcript package tests green
- [x] A-012 R16/R17: `conversationAvailable` is server-derived, both flyout and palette gate on it, identity-only providers never advertise Fix tab name, POST and queue-drain revalidation intact — frontend suites green (3920 tests, 189 files)
- [x] A-013 R19: docs/site/agent-hooks.md carries the seven-harness matrix with verified versions, sources, and evidenced gaps — re-review: every row carries a verified version + doc source; agy row matches the installed 1.1.11 hooks.md (named hooks, PreInvocation/Stop flat handlers, conversationId, fullyIdle); the opencode row documents the native `opencode export <id> --sanitize` integration honestly; the copilot gap cites only observed evidence (no SQLite claim); no `tool.execute.before` advertised

### Behavioral Correctness

- [x] A-014 R20: The isolated codex end-to-end proves install → hook fire → pane identity/state → transcript resolution → operator-request render, with zero contact to live user agents — TestCodexHookEndToEnd PASS (isolated socket + CODEX_HOME, installed command executed verbatim, no trust bypass)
- [x] A-015 R5/R2: A codex `SessionStart` with `source=compact` re-stamps identity without writing idle; `startup`/`resume` stamp identity AND idle — e2e steps 1 and 3
- [x] A-016 R18: Operator facts corpus, auto-name, and agent-targeted send treat a resolvable codex window exactly like claude; fork remains claude-only (404 for codex) — api/operator_provider_test.go green

### Scenario Coverage

- [x] A-017 R21: Startup/resume, rotation, compaction, wrapped launch, crash/exit, plain shell, malformed payload/ref, unavailable transcript, and unknown-provider scenarios each have a test
- [x] A-018 R15: copilot advertises identity+lifecycle but no transcript action; direct POST returns the 404-class no-adapter error; the matrix records the evidence — cycle-3 review: the cycle-2 blocker (MF-1's over-narrow ref guard) is fixed — opencodeRefRe now matches the native mixed-case v1.18.25 id shape with source-grounded accept fixtures across guard/probe/resolution/argv (see A-037), so the opencode integration is self-consistent end to end (plugin stamps the native id → writer accepts → probe/resolution accept). Copilot half stands from cycle 2 (TestOperatorRequestCopilotSubjectNoAdapter; matrix cites observed evidence only). PASS
- [x] A-019 R2: Subagent/child event names appear in NO installed mapping for any adapter (registry assertion test) — TestNoSubagentEventsRegistered PASS; re-review: the OpenCode ordinary-event contamination path is now closed too — the plugin resolves every event's session via client.session.get and ignores parentID/unresolvable sessions (TestOpencodePluginExecutedRootChildFixtures, executed plugin)

### Edge Cases & Error Handling

- [x] A-020 R10: A malformed kimi marker block (begin without end) refuses modification; a marker-less copilot/opencode target file is left untouched
- [x] A-021 R12/R13/R14: Refs with path-traversal shapes (`../`, slashes, glob metacharacters, whitespace) are rejected before any filesystem access for every adapter

### Code Quality

- [x] A-022: Readability/maintainability — installer kinds reuse the existing consent/diff/ownership machinery; no cleverness
- [x] A-023: Existing project patterns followed (registry tables, package-level test seams, aliased constants)
- [x] A-024: Go subprocess calls use exec.CommandContext with timeouts; no shell strings; no inline tmux construction outside internal/tmux
- [x] A-025: Frontend uses type narrowing over assertions for the new field — `win.conversationAvailable === true`
- [x] A-026: State derived from tmux + filesystem — no caches/registries beyond the existing in-process patterns
- [x] A-027: New behavior covered by tests alongside the code (test-alongside)
- [x] A-028: No duplicated utilities (mergeHooks, upsertMarkerBlock, validateHookPath, agentStateHookCommand reused); no magic strings without named constants — re-review: agentCommForName removed (zero grep hits), dead tool.execute.before mapping removed; every new symbol has production call sites (parsimony sweep clean)
- [x] A-029: Comments state constraints/why, never narration or change-ids — adapter.go package doc updated; one NEW broken comment introduced (AltScreen doc lost its first line, tmux.go:755) — review-1 SF-1

### Security

- [x] A-030 R1/R2: Every hook fire path exits 0 (never-fail) including flag-parse and unknown-provider paths — Copilot's fail-closed preToolUse rule can never deny a tool call through our hook
- [x] A-031 R12/R13/R14: No client-supplied path is ever treated as authoritative; all filesystem lookups are bounded and rooted at the harness's verified config root (env-overridable for tests only)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — cycle-3 review: every cycle-3 symbol (opencodeExportGrace, opencodeExportCap, opencodeExportMu, errExportCapacity, prunePastGraceLocked) has production call sites in opencode.go alongside the cycle-2 set (boundedBuffer, ensureOpencodeExportDir, writeOpencodeExport); the change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Copilot integration uses camelCase event names and camelCase payloads (`sessionId`). | Docs explicitly define both formats keyed on event-name casing; camelCase is the native CLI form. | S:90 R:90 A:95 D:95 |
| 2 | Confident | Gemini's ancestor-walk comm literal is `node` (the CLI is a bundled node script). | Verified locally (symlink → gemini.js, env-node shebang). The walk climbs our own parentage, so a `node` ancestor within 5 hops is structurally the harness; a wrong-pid false match is not realistic. | S:80 R:75 A:80 D:70 |
| 3 | Certain | Codex native trust remains a user activation step; automated coverage executes installed commands in isolation. | The first apply verified the install-to-writer chain without launching Codex or bypassing trust; no native discovery/firing coverage is claimed. | S:90 R:90 A:90 D:90 |
| 4 | Confident | `conversationAvailable` derives once per identified window per fetch via bounded glob/index lookups (no cache). | Bounded patterns (fixed-depth globs, one index scan); identified windows are few per server; Constitution II forbids caches. | S:75 R:80 A:80 D:75 |
| 5 | Confident | The capability matrix lives at docs/site/agent-hooks.md linked from install.md. | readme-extraction allows any non-reserved page; install.md is the existing agent-setup doc home; memory files are hydrate's layer, not apply's. | S:70 R:85 A:80 D:75 |
| 6 | Confident | Reuse existing installers and native APIs; no new database dependency or authoritative store. | OpenCode export exists; its fit with bounded path-based lookup must be assessed on technical evidence. | S:80 R:85 A:85 D:80 |
| 7 | Confident | Antigravity CLI supports native hooks and should be integrated for verified lifecycle/identity/transcript capabilities. | Installed 1.1.11 reference and official docs define the mechanism; exact runtime event limits need isolated verification. | S:85 R:85 A:85 D:85 |
| 8 | Confident | Kimi transcript resolves via session_index.jsonl with a bounded glob fallback; ref validated as a safe token. | Index format verified locally; the glob fallback covers a stale/missing index line. | S:75 R:80 A:75 D:70 |

8 assumptions (2 certain, 6 confident).

# Plan: Agent-Session Identity Rename

**Change**: 260904-bf1l-agent-session-identity-rename
**Intake**: `intake.md`

## Requirements

> The option **value schema is untouched** (`<provider>:<session-ref>`); only the key
> name and the surrounding code vocabulary change. **No behavior change anywhere** —
> a pure rename plus the `@rk_chat` legacy-generation close-out for the chat key.
> `@rk_pane_agent_state` / `@rk_agent_state` are out of scope (fab-kit-coupled).

### tmux layer: option constants, format, parsers

#### R1: New option generation `@rk_pane_agent_session`
In `app/backend/internal/tmux/tmux.go`, the chat-identity option constant SHALL be renamed: `ChatOption = "@rk_pane_chat"` → `AgentSessionOption = "@rk_pane_agent_session"`, with the previous name becoming the legacy fallback constant `LegacyAgentSessionOption = "@rk_pane_chat"` (replacing `LegacyChatOption = "@rk_chat"` in the read-fallback role — `LegacyChatOption` is removed). The parse helpers SHALL be renamed verbatim-logic: `parseChatRef` → `parseAgentSessionRef`, `isChatProvider` → `isAgentProvider`, `isChatRef` → `isAgentSessionRef`.

- **GIVEN** a pane carrying `@rk_pane_agent_session claude:<uuid>`
- **WHEN** `parsePanes` (or `PaneFactsCtx`) reads it
- **THEN** the provider/ref pair parses exactly as `@rk_pane_chat` parsed before — same validation, same tolerance (malformed ⇒ `("", "")`)

#### R2: Dual-read rotates one generation; `@rk_chat` read is dropped
The `paneFormat` `list-panes` format SHALL carry `#{@rk_pane_agent_session}` (new, wins) and `#{@rk_pane_chat}` (fallback), and SHALL drop the `#{@rk_chat}` field. `parsePanes` SHALL resolve the agent-session raw as new-field-wins over `@rk_pane_chat`; the agent-state dual-read (`@rk_pane_agent_state` over legacy `@rk_agent_state`) is untouched. The single-pane fact read (`pane_target.go` `PaneFactsCtx`/`parsePaneFacts`) is agent-state-only and needs no chat-field change; the liveness reconciliation (chat borrows the same pane's agent-state pid liveness; a stale pane zeros both) SHALL be preserved unchanged.

- **GIVEN** a pane carrying only the old `@rk_pane_chat` value (not yet migrated)
- **WHEN** `parsePanes` reads it
- **THEN** the identity surfaces from the fallback field exactly as before
- **AND** a pane carrying both names surfaces the `@rk_pane_agent_session` value (new wins)

#### R3: Migration sweep — new CopyOnly row, chained forward
`legacy_options.go` `legacyOptions` SHALL gain the row `{Old: ChatOption(@rk_pane_chat), New: AgentSessionOption, Scope: scopePane, CopyOnly: true}`, ordered **after** the existing `@rk_chat` → `@rk_pane_chat` CopyOnly row (which is kept for one more release), so a pane still carrying only `@rk_chat` chains forward transitively (`@rk_chat` → `@rk_pane_chat` → `@rk_pane_agent_session`) in a single sweep pass. The table-order chaining behavior MUST be pinned by a test.

- **GIVEN** a pane holding only `@rk_chat claude:<uuid>` (neither successor set)
- **WHEN** `MigrateLegacyOptions` runs once
- **THEN** the pane ends holding all three names with the same value (both rows CopyOnly — nothing unset)
- **AND** a second sweep run issues zero set-option calls (idempotent)

### Writer: agent hook

#### R4: Hook dual-write rotates one generation (`@rk_chat` close-out)
In `app/backend/cmd/rk/agent_hook.go`, `writeChat` / `writeChatImpl` / `writeChatFn` / `chatOption` SHALL be renamed to `writeAgentSession` / `writeAgentSessionImpl` / `writeAgentSessionFn` / agent-session equivalents, and the dual-write pair SHALL rotate one generation: the single `;`-chained tmux exec writes (`@rk_pane_agent_session`, `@rk_pane_chat`); `@rk_chat` is no longer written. The agent-state dual-write (`@rk_pane_agent_state`, `@rk_agent_state`) is untouched. No hook-text/settings change (gen-3 hook text names no option); the never-fail contract holds.

- **GIVEN** a hook fire that yields a session id
- **WHEN** the stamp lands
- **THEN** one tmux exec sets `@rk_pane_agent_session` and `@rk_pane_chat` to `<provider>:<sessionID>` and nothing sets `@rk_chat`

### Go identifier + wire-field ripple

#### R5: Struct fields and JSON tags rename atomically
`tmux.PaneInfo` / `tmux.WindowInfo` SHALL rename `ChatProvider`/`ChatSessionRef` → `AgentProvider`/`AgentSessionRef` with JSON tags `chatProvider`/`chatSessionRef` → `agentProvider`/`agentSessionRef` in lockstep — no dual-key emission (SPA and desktop shell are served by the same daemon binary). `internal/sessions` SHALL rename `ResolveChatPane` → `ResolveAgentPane` and `rollupChat` → `rollupAgentSession` (active-pane-first rule unchanged). `api/` SHALL rename `requiresChatRef` → `requiresAgentSessionRef` (operator template registry) and every consumer-side field access in `fork.go`, `closed.go`, `operator.go`, `auto_name.go`, `send.go`, `waiting_push.go`, `internal/transcript/claude.go`, and their tests (mock TmuxOps fields, fixture helpers such as `paneLineChat`, `captureChat`, `testChatRef`).

- **GIVEN** the daemon serving `/api/sessions` and the state socket after the rename
- **WHEN** a window carries an agent-session identity
- **THEN** the payload carries `agentProvider`/`agentSessionRef` per window and per pane, and no payload carries `chatProvider`/`chatSessionRef`

#### R6: Frontend follows the new wire names
`app/frontend/src/types.ts` + `src/api/client.ts` SHALL rename the window fields `chatProvider`/`chatSessionRef` and the closed-window record fields (`chatProvider`/`chatRef`) to the new wire names, re-anchoring doc comments on "agent session identity". `FORKABLE_CHAT_PROVIDER` (`components/sidebar/row-flyout-card.tsx`) → `FORKABLE_AGENT_PROVIDER`, gate logic unchanged. All consumers (`app.tsx`, sidebar components) and test seams (unit-test window factories, `row-flyout.spec.ts`, `operator-digest.spec.ts` state-socket mocks) follow.

- **GIVEN** a window whose payload carries `agentProvider: "claude"` and an `agentSessionRef`
- **WHEN** the row flyout renders
- **THEN** the fork affordance gates exactly as it gated on `chatProvider === "claude"` before

### Closed-window ring

#### R7: On-disk read-compat for closed records
`internal/snapshot/closed.go` records SHALL write only the new JSON keys, and SHALL read **both** key generations — coalescing old `chatProvider`/`chatRef` → the new fields on load (second struct field pair with post-unmarshal coalesce, or a custom `UnmarshalJSON` — implementer's choice) — so existing records under `$XDG_STATE_HOME/run-kit/snapshots/{server}.closed/` keep their resume affordance across the upgrade.

- **GIVEN** a pre-upgrade closed-ring record carrying `chatProvider`/`chatRef`
- **WHEN** the ring is loaded after the upgrade
- **THEN** the record's resume affordance is intact (fields coalesced into the new names)
- **AND** a record written post-upgrade carries only the new keys

### User-facing vocabulary

#### R8: Error strings and setup label move to "agent session" phrasing
The API error strings `"no chat session for this window"`, `"no chat session for this window — nothing to fork"`, `"malformed chat session ref for this window"`, and `"operator window has no chat session"` SHALL move to "agent session" phrasing, with the Go tests asserting them updated in the same change. The `rk agent setup` diff label `"chat stamp + idle (boot-ready)"` SHALL become `"session stamp + idle (boot-ready)"` (`agent_setup.go` + pinned in `agent_setup_test.go`).

- **GIVEN** a fork request against a window with no agent-session identity
- **WHEN** the handler rejects it
- **THEN** the 404 body uses the "agent session" phrasing and the asserting test passes

#### R9: Comment stragglers and the residual-grep contract
`api/fork.go` comments still using the retired `@rk_chat` spelling and referencing the removed chat endpoints SHALL be rewritten against `@rk_pane_agent_session` and the transcript-error vocabulary. After the mechanical rename, `grep -rn 'rk_chat\|rk_pane_chat' app/` MUST return only the legacy constants (`LegacyAgentSessionOption`, the kept `@rk_chat` sweep-row literal), the migration rows, and their tests/comments about the legacy window.

- **GIVEN** the completed rename
- **WHEN** the residual grep runs over `app/`
- **THEN** every hit is legacy-constant / migration-row / deprecation-window material — no live-vocabulary stragglers

### Docs: specs ride the change

#### R10: Spec files rename in the same change
`docs/specs/agent-state.md` § Chat Session Identity SHALL become § Agent Session Identity (key name, writer/reader rules, the reader-fallback window, the `@rk_chat` close-out for this key); `docs/specs/api.md` (the `target:"agent"` row's `@rk_pane_chat` rollup citation) and `docs/specs/ui-state.md` (§ substrate facts `@rk_pane_chat` listing) SHALL be updated to the new key and vocabulary. (Memory files listed under Affected Memory are hydrate's responsibility, not apply tasks.)

- **GIVEN** the shipped change
- **WHEN** a reader follows `docs/specs/agent-state.md`
- **THEN** the documented key/writer/reader contract matches the implemented `@rk_pane_agent_session` generation

### Non-Goals

- `@rk_pane_agent_state` / `@rk_agent_state` — fab-kit-coupled; the 26-08-28 ladder's Change 4 owns that key's close-out
- The `transcript` package name, agent-send naming, any behavior change
- Hook-text/settings generation bump, doctor migration row (gen-3 hook text names no option)
- Dual-key wire emission (same-binary SPA renames atomically)

### Design Decisions

#### Identifier spellings: AgentProvider/AgentSessionRef, wire agentProvider/agentSessionRef
**Decision**: Go fields `AgentProvider`/`AgentSessionRef`, JSON `agentProvider`/`agentSessionRef`, resolver `ResolveAgentPane`, template flag `requiresAgentSessionRef`, frontend gate `FORKABLE_AGENT_PROVIDER`.
**Why**: shortest spellings that keep the provider/ref pair visually parallel to the option name `@rk_pane_agent_session`; matches the intake's Assumption #4 default.
**Rejected**: `AgentSessionProvider`/`sessionProvider` — longer without disambiguating anything (there is exactly one provider/ref pair per pane).
*Introduced by*: 260904-bf1l-agent-session-identity-rename

#### Closed-ring read-compat via field-pair coalesce, not dropped
**Decision**: dual-read old `chatProvider`/`chatRef` keys with a load-time coalesce; write only the new keys.
**Why**: cheap, preserves resume affordances across the upgrade (intake Assumption #5's preferred posture).
**Rejected**: dropping read-compat — constitution-permissible (the ring is a non-authoritative recovery artifact) but loses working resume affordances for no savings.
*Introduced by*: 260904-bf1l-agent-session-identity-rename

## Tasks

### Phase 2: Core Implementation

- [x] T001 `app/backend/internal/tmux/tmux.go`: rename `ChatOption`→`AgentSessionOption` (`@rk_pane_agent_session`), add `LegacyAgentSessionOption = "@rk_pane_chat"`, remove `LegacyChatOption`; rename `parseChatRef`/`isChatProvider`/`isChatRef` → `parseAgentSessionRef`/`isAgentProvider`/`isAgentSessionRef`; rework `paneFormat` to carry `#{@rk_pane_agent_session}` + `#{@rk_pane_chat}` and drop `#{@rk_chat}`; update `parsePanes` dual-read (new wins) + field-count guard; rename `PaneInfo`/`WindowInfo` fields `ChatProvider`/`ChatSessionRef` → `AgentProvider`/`AgentSessionRef` with JSON tags `agentProvider`/`agentSessionRef`; update comments; update `tmux_test.go` incl. fixture builders `paneLineChat`/`paneLineFull` <!-- R1, R2, R5 -->
- [x] T002 `app/backend/internal/tmux/legacy_options.go`: add `{Old: "@rk_pane_chat", New: AgentSessionOption, Scope: scopePane, CopyOnly: true}` ordered after the kept `@rk_chat`→`@rk_pane_chat` row; confirm the sweep applies rows in table order <!-- R3 -->
- [x] T003 `app/backend/internal/tmux/legacy_options_test.go`: chained-copy test — a pane holding only `@rk_chat` ends holding all three names after one sweep pass; idempotence on second run <!-- R3 -->
- [x] T004 `app/backend/cmd/rk/agent_hook.go` + `agent_hook_test.go`: rename `writeChat`/`writeChatImpl`/`writeChatFn`/`chatOption` → `writeAgentSession`* family; rotate the dual-write pair to (`@rk_pane_agent_session`, `@rk_pane_chat`); `@rk_chat` no longer written; agent-state write untouched <!-- R4 -->
- [x] T005 `app/backend/internal/sessions/sessions.go` + `sessions_test.go`: `ResolveChatPane` → `ResolveAgentPane`, `rollupChat` → `rollupAgentSession`, field-access ripple (active-pane-first rule unchanged) <!-- R5 -->
- [x] T006 `app/backend/api/`: `requiresChatRef` → `requiresAgentSessionRef`; field/identifier ripple + error-string updates in `fork.go`, `closed.go`, `operator.go`, `auto_name.go`, `send.go`, plus `internal/transcript/claude.go`; update all asserting tests (`fork_test.go`, `closed_test.go`, `operator_test.go`, `operator_queue_test.go`, `auto_name_test.go`, `send_test.go`, `waiting_push_test.go`, `windows_test.go` — mock TmuxOps fields, `captureChat`, `testChatRef` fixture helpers) <!-- R5, R8 -->
- [x] T007 `app/backend/internal/snapshot/closed.go` + `closed_test.go` (+ `snapshot.go` ripple): rename record fields to the new JSON keys, add old-key (`chatProvider`/`chatRef`) read-coalesce on load, write new keys only; test a pre-upgrade record loads with its resume identity intact <!-- R7 -->
- [x] T008 `app/backend/cmd/rk/agent_setup.go` + `agent_setup_test.go`: diff label `"chat stamp + idle (boot-ready)"` → `"session stamp + idle (boot-ready)"` <!-- R8 -->
- [x] T009 [P] `app/frontend/src/types.ts`, `src/api/client.ts`, `src/app.tsx`, `src/components/sidebar/` (`index.tsx`, `window-row.tsx`, `row-flyout-card.tsx` incl. `FORKABLE_CHAT_PROVIDER` → `FORKABLE_AGENT_PROVIDER`): rename wire fields + closed-record fields to new names; re-anchor doc comments on "agent session identity" <!-- R6 -->
- [x] T010 [P] frontend tests: `app.test.tsx`, `row-flyout-card.test.tsx` window factories, `tests/e2e/row-flyout.spec.ts`, `tests/e2e/operator-digest.spec.ts` state-socket mocks seed the new field names <!-- R6 -->

### Phase 3: Integration & Edge Cases

- [x] T011 `app/backend/api/fork.go`: rewrite the stale `@rk_chat` / removed-chat-endpoints comments against `@rk_pane_agent_session` and the transcript-error vocabulary; then run `grep -rn 'rk_chat\|rk_pane_chat' app/` and clear every hit that is not legacy-constant / migration-row / deprecation-window material <!-- R9 -->
- [x] T012 Docs: `docs/specs/agent-state.md` § Chat Session Identity → § Agent Session Identity (key, writer/reader rules, fallback window, `@rk_chat` close-out); `docs/specs/api.md` `target:"agent"` rollup citation; `docs/specs/ui-state.md` § substrate facts listing <!-- R10 -->

### Phase 4: Polish

- [x] T013 Verification gates: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit`; `just test-frontend`; touched e2e specs via `just pw test row-flyout operator-digest` (or `just test-e2e` if the rig allows) <!-- R1, R5, R6 -->

## Execution Order

- T001 blocks T002–T007 (constants/fields they reference)
- T009–T010 depend on T001/T005/T006 settling the wire names; [P] within the frontend pair
- T011–T012 run after the mechanical rename (T001–T010)
- T013 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `AgentSessionOption = "@rk_pane_agent_session"` and `LegacyAgentSessionOption = "@rk_pane_chat"` exist in `internal/tmux/tmux.go`; `LegacyChatOption` and all `parseChatRef`/`isChatProvider`/`isChatRef` identifiers are gone; parse validation logic is verbatim
- [x] A-002 R3: the migration table carries the new CopyOnly pane row ordered after the kept `@rk_chat` row
- [x] A-003 R4: `agent_hook.go` writes (`@rk_pane_agent_session`, `@rk_pane_chat`) in one chained exec and nothing writes `@rk_chat`
- [x] A-004 R5: backend payloads carry `agentProvider`/`agentSessionRef` (window + pane); `ResolveAgentPane`/`rollupAgentSession`/`requiresAgentSessionRef` are the live identifiers
- [x] A-005 R6: frontend types/client/gate (`FORKABLE_AGENT_PROVIDER`) consume the new wire names; no `chatProvider`/`chatSessionRef` remain in `app/frontend/src/`
- [x] A-006 R7: closed-ring records write only new keys and coalesce old-key records on load
- [x] A-007 R10: the three spec files carry the new key and section vocabulary

### Behavioral Correctness

- [x] A-008 R2: a pane carrying only `@rk_pane_chat` still surfaces its identity (fallback read); one carrying both surfaces the new name's value; liveness reconciliation (shared agent-state pid) unchanged
- [x] A-009 R8: the four API error strings use "agent session" phrasing and their asserting tests pass; the setup diff label reads `"session stamp + idle (boot-ready)"`

### Scenario Coverage

- [x] A-010 R3: the chained-copy test proves `@rk_chat`-only → all three names in a single sweep pass, and sweep idempotence
- [x] A-011 R7: a test loads a pre-upgrade closed record (old keys) and asserts the coalesced identity fields

### Edge Cases & Error Handling

- [x] A-012 R1: malformed/empty option values still degrade to `("", "")` — parse tolerance unchanged after rename

### Removal Verification

- [x] A-013 R9: `grep -rn 'rk_chat\|rk_pane_chat' app/` returns only legacy constants, migration rows, and their tests/deprecation comments — no live vocabulary

### Code Quality

- [x] A-014 Pattern consistency: renamed identifiers follow surrounding naming; comments state constraints, not narration (no change-ID citations added to code comments)
- [x] A-015 No unnecessary duplication: the rename reuses existing migration/dual-read machinery — no new parallel mechanisms
- [x] A-016 No shell-string subprocess construction introduced; all tmux writes stay discrete-argv `exec.CommandContext` chains
- [x] A-017 Tests cover the added behavior (chained-copy row, closed-ring coalesce) per code-quality "changes include tests"

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change is a pure rename: the one genuinely retired symbol (`LegacyChatOption`) was removed by the change itself, and what survives under the old names (the `@rk_chat` sweep row, the `@rk_pane_chat` fallback read/dual-write, the closed-ring `chatProvider`/`chatRef` coalesce fields) is deliberate one-release deprecation-window machinery, not redundancy.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Spellings fixed as `AgentProvider`/`AgentSessionRef`, wire `agentProvider`/`agentSessionRef`, `ResolveAgentPane`, `requiresAgentSessionRef`, `FORKABLE_AGENT_PROVIDER` | Intake Assumption #4's default, adopted; parallel to the option name; trivially reversible pre-merge | S:60 R:75 A:70 D:55 |
| 2 | Confident | Closed-ring read-compat implemented (field-pair coalesce preferred over custom `UnmarshalJSON` unless friction) | Intake Assumption #5's preferred posture; cheap, preserves resume affordances | S:60 R:70 A:75 D:55 |
| 3 | Confident | `paneFormat` becomes a 10-field string (drop `#{@rk_chat}`, add `#{@rk_pane_agent_session}`); exact field ordering and skip-guard count are the implementer's, with `parsePanes`/`tmux_test.go` updated in lockstep | Intake § 1 fixes the field set, not the ordering; indexes are internal to one function + its tests | S:70 R:80 A:85 D:70 |
| 4 | Confident | Closed-record new key spelling follows the window wire names (`agentProvider` + a ref key named consistently with the record's existing short form) | Same-vocabulary rule; record keys are internal to the ring + its reader | S:55 R:75 A:70 D:55 |
| 5 | Certain | Memory-file updates (the 10 Affected Memory entries) are hydrate's job, not apply tasks; only `docs/specs/*` ride apply | Pipeline contract — hydrate owns memory; intake § 9 lists both but the stage split is fixed by the process | S:85 R:90 A:95 D:90 |
| 6 | Confident | `paneFormat` stays an 11-field string, not 10: dropping `#{@rk_chat}` and adding `#{@rk_pane_agent_session}` nets zero because `#{@rk_pane_chat}` stays as the fallback field; ordering keeps fields 0–6 fixed, alternate_on at 7, scope-named agent-state at 8, `@rk_pane_chat` at 9, `@rk_pane_agent_session` at 10; skip-guard stays `< 11` | Assumption 3's field set is right but its arithmetic missed that `@rk_pane_chat` remains in the format as the fallback generation; minimal-diff ordering keeps the agent-state fields at their prior indexes | S:70 R:80 A:85 D:70 |
| 7 | Confident | T012's spec updates extend to `docs/specs/window-views.md` and `docs/specs/surface-layout.md` beyond the three R10-named files | Both carry current-truth `@rk_pane_chat` identity references (the "survives as agent-session identity" notes, the Stay row) that R10's acceptance ("documented contract matches the implemented generation") would otherwise leave stale; the historical `?view=chat` table row in window-views.md is left as-is per that file's historical-mentions note | S:65 R:75 A:75 D:60 |

7 assumptions (1 certain, 6 confident, 0 tentative).

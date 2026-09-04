# Plan: Chat Lens Docs Lens-Taxonomy Sweep (Change B)

**Change**: 260904-u8gg-chat-lens-docs-taxonomy-sweep
**Intake**: `intake.md`

## Requirements

### Docs Specs: Window Views taxonomy (B.1)

#### R1: window-views.md no longer presents the chat lens as present or planned
`docs/specs/window-views.md` MUST carry a removal note near the top (chat lens removed by PR #817 / `260904-39bp-remove-chat-lens`) and MUST NOT present the chat lens as a founding feature, a committed `[target]`, or an in-progress migration. Specifically: purpose statement (L7–8), problem-table `chat (planned)` row (L34), view-registry `chat` row (L65), R4 examples/rows (L119, L127, L139), R6 connection-dot mapping (L150), Two Species lead example (L164), boards-pin aside (L185), migration-map row (L196). Line L133 ("formerly read `Terminal:`/`Web:`/`Chat:`/`Desktop:`") SHALL be kept verbatim — it is explicitly historical.

- **GIVEN** the chat lens was removed at `a8c24104`
- **WHEN** a reader (or agent) consults `window-views.md` for the lens taxonomy
- **THEN** every lens presented as live or planned exists in the codebase (`tty`/`web`/`code` today, desktop genuinely planned)
- **AND** chat appears only in explicitly-historical framing (the removal note, L133-style past tense)

#### R2: specs/index.md Window Views one-liner reflects the live lens set
The `docs/specs/index.md:38` description for Window Views MUST NOT advertise chat (currently: "parallel-view model (tty/web/chat/desktop)" and "migration map for iframe / desktop (PR #71) / chat").

- **GIVEN** the index row for window-views.md
- **WHEN** the row is read
- **THEN** the lens enumeration and migration-map summary name only live/planned lenses

### Docs Specs + Memory: Agent State justification (B.2)

#### R3: `@rk_pane_chat` is justified by its live consumers, and the "later chat-read endpoint" clause is gone
`docs/specs/agent-state.md` § Chat Session Identity (L295–303) MUST justify the option by its live consumers — operator actuation, fork/resume, closed-resume, auto-name, agent-targeted send — not by the removed HTML-agent-chat-view stack. The clause "the (later) chat-read endpoint surfaces a missing transcript naturally as a read error" MUST be rewritten in all three occurrences: `docs/specs/agent-state.md:390–391`, `docs/memory/run-kit/agent-state.md:618`, `docs/memory/run-kit/agent-state.md:1028` (DD body) — the surviving transcript readers surface that error now; no future endpoint exists. The option itself (`@rk_pane_chat`, cross-repo contract) is untouched.

- **GIVEN** the § Chat Session Identity section and the three clause occurrences
- **WHEN** each is read after the sweep
- **THEN** no text claims a chat-read backend, chat-view stack, frontend chat toggle, or "later" endpoint
- **AND** the stated consumers match the live set (operator actuation, fork, closed-resume, auto-name, agent-targeted send)

### Docs Specs: surface-kind one-liners (B.3)

#### R4: ui-state.md and surface-layout.md drop the chat surface
`docs/specs/ui-state.md:69` MUST drop `chat` from the surface-kind enumeration (`tty · web · code · chat · desktop · agents`). `docs/specs/surface-layout.md:164` MUST drop the "chat gets no button" parenthetical (the rail-hidden-set sentence survives without it).

- **GIVEN** the two spec lines
- **WHEN** read after the sweep
- **THEN** neither names `chat` as a surface kind

### Docs Memory: one-liners (B.3)

#### R5: seven memory files stop citing dead chat surfaces
Each fix MUST be a present-truth rewrite (FKF style — state what is, no transition narration in memory bodies):

1. `docs/memory/run-kit/operator-actuation.md:48, 63` — "registered in `api/router.go` beside the chat routes" → re-anchor to the live registration context (verify actual `api/router.go` neighborhood at apply time).
2. `docs/memory/run-kit/operator-actuation.md:204` — "mirroring the chat endpoints" (plural) → the surviving mirrored contract (the send endpoint / transcript-read error shape as verified at apply time).
3. `docs/memory/run-kit/ui/boards.md:247` — drop `View: Chat` from the palette row and the `chatProvider` gate claim; `availableViews` gates on `hasCode` only (verified `window-view.ts:100`).
4. `docs/memory/run-kit/ui/compose-and-bottom-bar.md:60` — "`lib/readline-keys.ts` — shared with the chat send form" → compose strip is the sole consumer. (The L215 DD heading is A2 scope — untouched.)
5. `docs/memory/run-kit/ui/visual-design.md:466` — drop "and the chat form's autofocus skip"; keep the tooltip-suppression half.
6. `docs/memory/run-kit/ui/visual-design.md:527` — "(waiting badge, chat warning body)" → the waiting badge survives; drop the dead example.
7. `docs/memory/run-kit/api-and-sockets.md:27` — retired `@rk_chat` → `@rk_pane_chat`.
8. `docs/memory/run-kit/ui/lenses-and-layout.md:91` — make explicit that `?view=chat` is a dropped legacy value, never translated.

- **GIVEN** each listed line
- **WHEN** read after the sweep
- **THEN** no claim cites the chat routes, chat send form, chat lens palette row, `chatProvider` gate, chat warning body, or retired `@rk_chat` name
- **AND** surviving mechanisms (waiting badge, readline chords, `@rk_pane_chat`) remain accurately described

### Non-Goals

- Any code edit — zero files under `app/`, `scripts/`; `just test`/`just build` behavior unchanged.
- `docs/memory/run-kit/chat.md`, `docs/memory/run-kit/architecture.md` — A1 hydrate scope.
- `docs/memory/run-kit/agent-messaging.md`, `docs/specs/api.md`, `ui/compose-and-bottom-bar.md:215` / `ui/sidebar.md:670` DD headings — A2 scope.
- Renaming anything about `@rk_pane_chat`/`ChatProvider`/`rollupChat` docs — deliberately KEPT (live agent-session identity, cross-repo contract).
- `chatter`, `chat.disableAIFeatures`, `"chatty"` — false positives, untouched.

### Design Decisions

#### Spec removal note vs memory present-truth
**Decision**: `window-views.md` (a spec) gets an explicit removal note and removed-annotations on its taxonomy rows; memory files get silent present-truth rewrites with no "was removed" narration.
**Why**: specs are human-curated design intent where historical framing is legitimate (the plan prescribes the note); memory follows FKF present-truth style — transition narration is what `/docs-distill-memory` exists to strip.
**Rejected**: removal notes in memory bodies — would add narration hydrate/distill would later remove.
*Introduced by*: 260904-u8gg-chat-lens-docs-taxonomy-sweep

## Tasks

### Phase 2: Core Implementation

- [x] T001 Fix `docs/specs/window-views.md`: add removal note up top; fix L7–8, L34, L65, L119, L127, L139, L150, L164, L185, L196; keep L133 verbatim <!-- R1 -->
- [x] T002 [P] Fix `docs/specs/index.md:38` Window Views one-liner (drop both chat mentions) <!-- R2 -->
- [x] T003 [P] Fix agent-state chat justification: `docs/specs/agent-state.md:295–303` thesis swap to live consumers; rewrite the "later chat-read endpoint" clause at `docs/specs/agent-state.md:390–391`, `docs/memory/run-kit/agent-state.md:618`, `docs/memory/run-kit/agent-state.md:1028` <!-- R3 -->
- [x] T004 [P] Fix spec one-liners: `docs/specs/ui-state.md:69` (drop `chat` from enum), `docs/specs/surface-layout.md:164` (drop the chat parenthetical) <!-- R4 -->
- [x] T005 [P] Fix the seven memory one-liners: `operator-actuation.md:48/63/204` (re-anchored to the window verbs `/send`+`/fork` and the send-endpoint mirror, verified against `api/router.go:824–838`), `ui/boards.md:247`, `ui/compose-and-bottom-bar.md:60`, `ui/visual-design.md:466/527`, `api-and-sockets.md:27`, `ui/lenses-and-layout.md:91` <!-- R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `window-views.md` carries the removal note; all ten enumerated locations no longer present chat as live/planned; L133 unchanged
- [x] A-002 R2: `specs/index.md:38` names no chat lens in either the model enumeration or the migration-map summary
- [x] A-003 R3: § Chat Session Identity is justified by the five live consumers; zero occurrences of the "later chat-read endpoint" clause remain (spec + both memory sites)
- [x] A-004 R4: `ui-state.md:69` surface enum and `surface-layout.md:164` carry no `chat`
- [x] A-005 R5: all eight memory one-liner fixes applied as specified

### Removal Verification

- [x] A-006 R1–R5: a grep sweep of `docs/specs/` + `docs/memory/` for chat-lens framing (`?view=chat`, `chat lens`, `chat view`, `chat route`, `chat endpoint`, `chat send form`, `chat stream`, `View: Chat`, `chatProvider` gate claims, `@rk_chat`) finds nothing presenting chat as present/planned — excluding A1/A2-scoped files (`chat.md`, `architecture.md`, `agent-messaging.md`, `api.md`, the two A2 DD headings), explicitly-historical text, and KEPT agent-session-identity docs

### Edge Cases & Error Handling

- [x] A-007 R1–R5: `git diff --name-only` shows ONLY the intake's listed docs files (plus `fab/changes/…`) — no code, no A1/A2-scoped file touched

### Code Quality

- [x] A-008 Pattern consistency: memory edits are present-truth (no transition narration added to memory bodies); spec removal note follows the plan's prescribed shape
- [x] A-009 No unnecessary duplication: fixes reword in place; no new sections duplicating what `_shared/removed-domains.md` or the A1 hydrate will own

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Memory fixes are present-truth rewrites; only the spec gets a removal note | FKF memory style vs human-curated spec posture; plan prescribes the spec note explicitly | S:75 R:85 A:80 D:75 |
| 2 | Confident | window-views.md taxonomy rows (L34/L65/L196) become explicitly-removed annotations rather than silent deletions | The spec's table structure survives; a removed row with a note preserves the migration-map's historical value, matching the plan's "add a removal note up top; then:" shape | S:65 R:85 A:75 D:65 |
| 3 | Confident | operator-actuation re-anchoring text is decided at apply time from the live `api/router.go` neighborhood | The plan names the defect ("no chat routes remain") but not the replacement wording; the router is the ground truth | S:70 R:90 A:85 D:75 |

3 assumptions (0 certain, 3 confident, 0 tentative).

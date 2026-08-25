# Plan: Operator Digest, Stuck Triage & Retire

**Change**: 260822-rfz2-operator-digest-stuck-retire
**Intake**: `intake.md`

> **Rebased 2026-08-22 onto sibling `260822-wyn3-operator-compose-spawn-search`** (PR #712,
> branch `origin/260822-wyn3-...`, commit 54985d30), which landed the shared infrastructure this
> plan originally carried as R1–R3/T001–T004: the server-scoped `POST /api/operator-request` route
> (`handleServerOperatorRequest`), the registry scope discriminator (`serverScoped bool`, cross-scope
> 400s both directions), the shared delivery seam (`deliverOperatorPrompt`: busy gate → pane resolve →
> inject → probe-409/500/200), `findOperatorWindow`, `buildServerOperatorFacts` (`serverOperatorFacts
> {Text, Windows []operatorWindowFact, Corpus []operatorCorpusRow}`), the `acceptsText` text lane, and
> the frontend `sendServerOperatorRequest(server, template, text)` + the `operatorComposeActions`
> palette group. This plan now builds ONLY rfz2's unique work on top of that landed shape.

## Requirements

### Backend: registry + fact-table extensions

#### R1: `requiresWaiting` declaration + zero-waiting rejection
`operatorTemplate` (`app/backend/api/operator.go`) SHALL gain `requiresWaiting bool` (the `requiresChatRef`/`acceptsText` declarative idiom). In `handleServerOperatorRequest`, after `buildServerOperatorFacts` and before render/delivery, a template declaring `requiresWaiting` with ZERO fact rows at `AgentState == tmux.AgentStateWaiting` SHALL return a structured 409 `"nothing is waiting on this server"` with no delivery.

- **GIVEN** a server whose non-operator windows are all `idle`/`active` and body `{"template":"whats-stuck","text":""}`
- **WHEN** `POST /api/operator-request` runs
- **THEN** the response is 409 `"nothing is waiting on this server"` and no injection subprocess runs.

#### R2: Digest-grade fields on the shared fact row
`operatorWindowFact` SHALL gain the fields the digest templates need, populated in `buildServerOperatorFacts` from the same single `FetchSessions` pass (Constitution X): `AgentIdleDuration` (the rolled-up duration beside `AgentState`), PR rollup (`PrState`/`PrChecks`/`PrReview`, populated only when the window's `PrURL` is non-nil), and `TranscriptPath` (the per-row chat-JSONL absolute path via the SAME `chat.TranscriptPath` resolution the Corpus rows use — resolve once per window, fill both; empty string when the window has no chat ref OR the ref fails to resolve, so a broken ref degrades to a path-less row, never an error). Existing wyn3 renderers (`renderSpawnTask`, `renderFindDiscussion`) ignore the new fields and their rendered output is byte-unchanged — wyn3's existing tests stay green unmodified.

- **GIVEN** a server with a chat-carrying window whose ref resolves, a window whose ref fails to resolve, and a PR-carrying window
- **WHEN** facts derive
- **THEN** the first row carries its transcript path, the second is present with `TranscriptPath == ""`, the third carries its PR rollup — and the operator's own window appears in no row (existing exclusion).

### Backend: the three templates

#### R3: `brief-me` template (server-scoped)
The registry SHALL gain `brief-me` (`serverScoped: true`, no `acceptsText` — client text on it is the existing closed-lane 400): renders a standup-digest prompt listing every fact row — windowId (`@N`), name, session, `AgentState` + duration, fab change/stage when present, PR rollup when present, transcript path (or a "transcript unavailable" note when empty) — **sorted waiting-first, then active, then idle/unknown** (a sorted COPY inside the render func — the shared builder's natural order feeds wyn3's templates and must not change; stable within a group by session then windowId). The prompt instructs the operator: read each transcript tail (the JSONL path — never capture-pane; agent TUIs run alt-screen with zero scrollback), produce a one-line-per-tab digest (current state, what it is waiting on if waiting, one suggested next action), ordered waiting-on-me first; write the digest as its own reply in its own window (no response channel). Bounds: read-only; take no actions on other windows; do not rename, kill, or send keys anywhere. Zero non-operator windows still delivers a trivially-answerable prompt (brief-me never 409s on emptiness — only `whats-stuck` declares `requiresWaiting`).

- **GIVEN** derived facts with waiting, active, and broken-ref windows
- **WHEN** `brief-me` renders
- **THEN** the prompt lists every row with the waiting rows first, notes the broken-ref row's missing transcript, and carries the transcript-tail instruction, the waiting-on-me-first digest ordering, the own-window instruction, and the read-only bounds.

#### R4: `whats-stuck` template (server-scoped) + triage bounds
The registry SHALL gain `whats-stuck` (`serverScoped: true`, `requiresWaiting: true`, no `acceptsText`): renders a triage prompt over ONLY the waiting rows (filtered in the render func). For each waiting tab: read the transcript tail to find the pending question. **Routine** prompts (trust/permission dialogs, yes/no confirmations with an obvious safe answer) may be answered directly — the prompt names the exact verb `rk mux send <pane-or-window-target> "<answer>"`. Everything else is **escalated, never answered** via `rk notify --title "<window>: stuck" "<the pending question>"`. Both verbs' exact flag surfaces MUST be verified against `rk mux send --help` / `rk notify --help` at implementation time. The prompt carries the hard never-answer list: credential/login prompts, destructive confirmations, and anything ambiguous — escalate those. Bounds: touch only the waiting windows listed; no renames or kills.

- **GIVEN** two waiting windows and one active window
- **WHEN** `whats-stuck` renders
- **THEN** the prompt lists exactly the two waiting rows, names `rk mux send` and `rk notify --title` verbatim, and carries the never-answer list.

#### R5: `retire-tab` template (window-scoped, `requiresChatRef: true`)
The registry SHALL gain `retire-tab` (window-scoped — no `serverScoped`, no `acceptsText`; `requiresChatRef: true`) riding the EXISTING window route unchanged. The rendered prompt (from `operatorFacts`) instructs the operator to: read the subject's transcript (path fact); write a close-out note capturing what was done/decided/left open — via `idea "<note>"` (backlog) or, when the `FabChange` fact is non-empty, noting against that fab change (both verbs offered, operator's judgment which fits; with empty `FabChange` only the `idea` verb appears); then kill exactly the named window — `tmux kill-window -t {windowId}` — and nothing else. The per-action confirmation guardrail for this first destructive template lives in the frontend (R8).

- **GIVEN** facts for window `@5` with a resolvable transcript and non-empty `FabChange`
- **WHEN** `retire-tab` renders
- **THEN** the prompt names `@5`, the transcript path, both close-out verbs with the fab change named, the exact `tmux kill-window -t @5` command, and the kill-only-this-window bound; with empty `FabChange` no fab clause appears.

### Frontend: palette, flyout, confirm

#### R6: Server-scoped palette entries
`Operator: Brief me` (id `operator-brief-me`) and `Operator: What's stuck` (id `operator-whats-stuck`) SHALL join the palette beside wyn3's `operatorComposeActions` in `app.tsx` — same `hasOperatorWindow` omit-not-disable gate, no chords. Both are non-destructive and fire directly: `sendServerOperatorRequest(server, "<template>", "")` (the landed signature — empty text is valid on closed templates), success toast `"Sent to operator — digest will appear in the operator tab"` (brief-me) / `"Sent to operator — triage will appear in the operator tab"` (whats-stuck), failure toast the thrown Error's message (the `handleFixTabName` fire-and-forget shape).

- **GIVEN** a server with no operator window
- **WHEN** the palette opens
- **THEN** neither entry is listed.
- **AND GIVEN** an operator, **THEN** selecting an entry fires exactly one POST and a toast; a zero-waiting `whats-stuck` surfaces the 409 message in the failure toast.

#### R7: Retire affordances — palette entry + flyout row
`Tab: Retire (ask operator)` (id `window-retire-operator`) SHALL join the `windowActions` palette group, gated by the SAME derived availability triple as fix-tab-name (operator exists + subject `chatSessionRef` non-empty + subject not the operator), acting on the current window. The window flyout card SHALL gain a `Retire…` action row (`RetireActionRow`, `data-testid="row-flyout-retire-action"`) between `FixTabNameActionRow` and the pin row (order: change-color → fork → fix-tab-name → retire → pin → kill), double-gated (availability rule + optional `onRetireTab` handler threaded `app.tsx → Sidebar → ServerGroup → WindowRow → WindowFlyoutContent`, the `onFixTabName` threading), with destructive treatment (`danger` red-rail — the action ends in a window kill) and sub-hint `"asks the operator"`. The availability predicate in `row-flyout-card.tsx` SHALL be generalized (`canRequestWindowOperatorAction(win, hasOperator)`) and consumed by fix-tab-name and retire alike — one rule, all call sites + tests updated, no duplicate predicate.

- **GIVEN** a window row on a server with an operator and a chat-carrying non-operator subject
- **WHEN** the flyout opens
- **THEN** the Retire… row renders below Fix tab name; on the operator's own row, a chatless row, or an operator-less server both the row and the palette entry are absent (not disabled).

#### R8: Retire per-action confirmation
Selecting either retire entry point SHALL NOT fire the request directly: it opens a small confirm dialog (existing `Dialog` patterns, target state in `app.tsx`) — body: "Ask the operator to summarize and close this tab? The window will be killed." Confirm fires `sendOperatorRequest(server, windowId, "retire-tab")` exactly once (in-flight guard on the confirm button), success toast `"Sent to operator — tab will be summarized and closed"`, failure toast the server's message, then closes; Cancel/Escape closes with no request. The flyout row closes the card BEFORE opening the dialog (the close-then-open idiom). One shared dialog serves both entry points.

- **GIVEN** the confirm dialog open for window `@5`
- **WHEN** the user cancels
- **THEN** no POST fires.
- **AND WHEN** the user confirms, **THEN** exactly one `sendOperatorRequest(server, "@5", "retire-tab")` fires (re-clicks during flight are no-ops) and a toast reports the hand-off.

### Non-Goals

- No changes to the shared route, scope validation, delivery seam, or text lane — wyn3 owns them; rfz2 only adds registry entries, the `requiresWaiting` flag, and fact-row fields.
- No client-text templates (spawn-task/find-discussion are wyn3's).
- No operator-side enforcement of the whats-stuck answer bounds — the bounds live in the rendered prompt.
- No auto-name (`q675`) or tab sorting (`ga8z`) — sibling changes.

### Design Decisions

#### Extend the shared fact row, not a parallel digest table
**Decision**: add `AgentIdleDuration`, PR rollup, and per-row `TranscriptPath` to wyn3's `operatorWindowFact`, populated in the existing `buildServerOperatorFacts`; wyn3's renderers ignore the new fields.
**Why**: one derivation site per Constitution X; a second server-facts struct over the same FetchSessions pass would be the duplicated-logic anti-pattern; a single TranscriptPath resolution fills both the row and the Corpus.
**Rejected**: a separate `digestFacts` builder (duplicates the exclusion/iteration/resolution logic wyn3 just landed).
*Introduced by*: 260822-rfz2-operator-digest-stuck-retire

#### Waiting-first ordering lives in the rfz2 render funcs
**Decision**: `renderBriefMe` (and `whats-stuck`'s filter) sort/filter a COPY of `facts.Windows`; the shared builder keeps natural tmux order.
**Why**: the builder's order now feeds wyn3's shipped templates and tests — reordering shared state to serve one consumer risks silent output changes there; sorting in the consumer is still server-side and deterministic.
**Rejected**: sorting in `buildServerOperatorFacts` (cross-template blast radius for zero benefit).
*Introduced by*: 260822-rfz2-operator-digest-stuck-retire

#### Zero-waiting `whats-stuck` is a 409 via a declarative registry flag
**Decision**: `requiresWaiting bool` on the entry, checked in `handleServerOperatorRequest` after fact derivation; zero waiting rows ⇒ 409 `"nothing is waiting on this server"`.
**Why**: 409 is the seam's established valid-request-wrong-state class (busy gate, probe failure) and the client already toasts structured 409s; the declarative flag matches `requiresChatRef`/`acceptsText`.
**Rejected**: 404 (nothing is missing); 200 with a no-op delivery (wastes the operator); an error-returning render signature (widens every entry's contract for one template's precondition).
*Introduced by*: 260822-rfz2-operator-digest-stuck-retire

#### One shared Dialog-based confirm, not the palette `confirmLabel` mechanism
**Decision**: retire confirms through one small `Dialog`-pattern confirm in `app.tsx`, shared by the palette entry and the flyout row.
**Why**: two entry points, one confirmation UX; the flyout row cannot reach the palette's in-palette confirm sub-step, so `confirmLabel` would cover only one entry point and fork the flow.
**Rejected**: palette `confirmLabel` for the palette arm + a dialog for the flyout arm (two divergent confirm UIs for one destructive action).
*Introduced by*: 260822-rfz2-operator-digest-stuck-retire

## Tasks

### Phase 1: Backend — registry flag, fact fields, templates

- [x] T001 Add `requiresWaiting bool` to `operatorTemplate` and the zero-waiting 409 check (`"nothing is waiting on this server"`) in `handleServerOperatorRequest` after `buildServerOperatorFacts`, before render/delivery, in `app/backend/api/operator.go` <!-- R1 -->
- [x] T002 Extend `operatorWindowFact` with `AgentIdleDuration`, `PrState`/`PrChecks`/`PrReview` (filled only when `PrURL` non-nil), and `TranscriptPath` (single `chat.TranscriptPath` resolution per window shared with the Corpus fill; empty on no-ref/resolve-failure), populated in `buildServerOperatorFacts` — wyn3's `renderSpawnTask`/`renderFindDiscussion` output byte-unchanged (their existing tests stay green unmodified) <!-- R2 -->
- [x] T003 [P] Implement `renderBriefMe` + registry entry `brief-me` (`serverScoped: true`): waiting-first sorted row copy, per-row facts incl. transcript path or "transcript unavailable" note, transcript-tail instruction (never capture-pane), one-line-per-tab digest spec ordered waiting-on-me first, write-in-own-window instruction, read-only bounds; empty row table renders a trivially-deliverable "nothing to report" prompt <!-- R3 -->
- [x] T004 [P] Implement `renderWhatsStuck` + registry entry `whats-stuck` (`serverScoped: true`, `requiresWaiting: true`): waiting-rows-only triage, routine-answer verb `rk mux send` and escalation verb `rk notify --title "<window>: stuck" "<question>"` (verify both flag surfaces against `rk mux send --help` / `rk notify --help`), hard never-answer list (credentials/logins, destructive confirms, ambiguity ⇒ escalate), touch-only-listed-windows bound <!-- R4 -->
- [x] T005 [P] Implement `renderRetireTab` + registry entry `retire-tab` (`requiresChatRef: true`, window-scoped): transcript read, close-out note via `idea "<note>"` or note-against-the-fab-change when `FabChange` non-empty (fab clause conditional), then `tmux kill-window -t {windowId}` bounded to exactly that window, no other action <!-- R5 -->
- [x] T006 Go tests in `app/backend/api/operator_test.go` (the existing fixture/assertion style): zero-waiting `whats-stuck` ⇒ 409 with no injection + waiting-present success path; fact-field extensions (duration/PR fill rules, per-row transcript path, broken-ref ⇒ empty path, operator still excluded); rendered-prompt content per template (brief-me rows + waiting-first order + bounds + unavailable-note; whats-stuck waiting-rows-only + both rk verbs + never-answer list; retire-tab kill command + both note verbs + fab-clause conditionality); `brief-me` with client text ⇒ the existing closed-lane 400; `retire-tab` success on the WINDOW route + `brief-me` cross-scope 400 on the window route (extending wyn3's scope tests to the new ids) <!-- R1, R2, R3, R4, R5 -->

### Phase 2: Frontend — palette, flyout row, confirm

- [x] T007 Palette entries in `app/frontend/src/app.tsx`: `Operator: Brief me` (id `operator-brief-me`) + `Operator: What's stuck` (id `operator-whats-stuck`) beside the wyn3 `operatorComposeActions` entries under the same `hasOperatorWindow` gate, firing `sendServerOperatorRequest(server, "<template>", "")` directly with the per-template success toasts and error-message failure toasts <!-- R6 -->
- [x] T008 In `app/frontend/src/components/sidebar/row-flyout-card.tsx`: generalize `canRequestFixTabName` → `canRequestWindowOperatorAction(win, hasOperator)` (update all call sites + tests; no duplicate predicate), add `RetireActionRow` (danger red-rail ternary, inline-SVG glyph per the `WandIcon` convention, sub-hint "asks the operator", `data-testid="row-flyout-retire-action"`, `stopPropagation`) between fix-tab-name and pin behind the double gate (predicate + optional `onRetireTab` prop) <!-- R7 -->
- [x] T009 Wire retire in `app/frontend/src/app.tsx`: `retireTarget` state + shared confirm dialog (existing `Dialog` pattern — body "Ask the operator to summarize and close this tab? The window will be killed.", in-flight-guarded confirm firing `sendOperatorRequest(srv, windowId, "retire-tab")` once, success toast "Sent to operator — tab will be summarized and closed", failure toast the server's message, Escape/Cancel = no request); `Tab: Retire (ask operator)` (id `window-retire-operator`) in `windowActions` under the shared triple opening the dialog for `currentWindow`; thread `onRetireTab` through `Sidebar → ServerGroup → WindowRow → WindowFlyoutContent` (the `onFixTabName` threading), flyout row closing the card before opening the dialog <!-- R7, R8 -->
- [x] T010 Frontend unit tests: palette gating for the three new entries (present with operator, absent without; retire additionally absent on chatless/operator subjects) + the retire confirm flow (cancel fires nothing; confirm fires one POST + toast; in-flight re-click no-op) in `app.test.tsx` (wyn3's operator-compose tests are the pattern donor), plus `row-flyout-card.test.tsx` additions (retire row gate in all states, order between fix-tab-name and pin, danger rail class, close-then-open handoff, predicate rename covered) <!-- R6, R7, R8 -->

### Phase 3: e2e

- [x] T011 Playwright e2e (+ sibling `.spec.md` per constitution) in `app/frontend/tests/e2e/` (wyn3's `operator-compose.spec.ts` is the pattern donor): the two `Operator:` palette entries present with a mocked operator window and absent without; the retire path flyout-row → confirm dialog → confirm → success toast — mocking `**/api/operator-request*` and `**/api/windows/*/operator-request*` WITH trailing `*` (withServer appends `?server=`; a no-star mock silently falls through to live tmux) <!-- R6, R7, R8 -->

## Execution Order

- T001 → T002 first (registry flag + fact fields); T003/T004/T005 parallel after; T006 closes Phase 1
- T007 independent of T008; T008 blocks T009; T009 blocks T010; T011 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `requiresWaiting` exists on the registry entry and a zero-waiting `whats-stuck` request returns 409 "nothing is waiting on this server" with no delivery
- [x] A-002 R2: `operatorWindowFact` carries duration, PR rollup (PrURL-gated), and per-row transcript path with broken-ref ⇒ empty-path degradation; the operator window stays excluded
- [x] A-003 R3: `brief-me` renders every row waiting-first with the transcript-tail/own-window/read-only instructions and the unavailable-transcript note
- [x] A-004 R4: `whats-stuck` renders only waiting rows, names `rk mux send` and `rk notify --title` with verified flag surfaces, and carries the never-answer list
- [x] A-005 R5: `retire-tab` rides the window route with `requiresChatRef: true` and renders transcript-read + both note verbs (fab clause conditional) + exact bounded `tmux kill-window -t @N`
- [x] A-006 R6: `Operator: Brief me` / `Operator: What's stuck` render only when the server has an operator window and fire `sendServerOperatorRequest(server, template, "")` with the specified toasts
- [x] A-007 R7: `Tab: Retire (ask operator)` and the flyout `Retire…` row render under the shared availability triple (absent, never disabled), the row sits between fix-tab-name and pin with danger treatment, and one generalized predicate (`canRequestWindowOperatorAction`) serves fix-tab-name and retire
- [x] A-008 R8: both retire entry points open the shared confirm dialog; confirm fires exactly one `retire-tab` request (in-flight guarded); cancel fires nothing

### Behavioral Correctness

- [x] A-009 R2: wyn3's `renderSpawnTask`/`renderFindDiscussion` output is byte-unchanged and all pre-existing operator_test.go tests pass unmodified
- [x] A-010 R1: the zero-waiting 409 surfaces in the frontend failure toast as the server's structured message (throwOnError path)

### Scenario Coverage

- [x] A-011 R1, R2: Go tests cover the zero-waiting 409, the fact-field fill rules, and the broken-ref degradation
- [x] A-012 R3, R4, R5: Go tests assert rendered-prompt content per template (the fix-tab-name assertion style), incl. brief-me's waiting-first order and whats-stuck's waiting-rows-only filter
- [x] A-013 R5: Go tests cover `retire-tab` success on the window route and `brief-me`'s cross-scope 400 there
- [x] A-014 R6, R7, R8: unit tests cover palette gating + retire confirm flow; e2e (+ `.spec.md`) covers the palette entries and the retire confirm→toast path with trailing-`*` mocks

### Edge Cases & Error Handling

- [x] A-015 R3: brief-me on a server with zero non-operator windows still delivers (trivial digest) while whats-stuck rejects — the two empty-set behaviors are distinct and tested
- [x] A-016 R3: a window with no chat session appears in brief-me's table with the transcript-unavailable note (chat is optional for server-scoped rows; only `retire-tab`'s window scope requires it)
- [x] A-017 R6: client text sent to `brief-me`/`whats-stuck` hits the existing closed-lane 400 (no `acceptsText` declared) — covered by a test on at least one of the two ids

### Code Quality

- [x] A-018 Pattern consistency: new Go code follows `operator.go`'s landed conventions (declarative flags, render-func style, error vocabulary); new frontend code follows the `handleFixTabName`/`FixTabNameActionRow`/`operatorComposeActions` idioms (in-flight guards, omit-not-disable gating, toast copy shape)
- [x] A-019 No unnecessary duplication: fact derivation extends `buildServerOperatorFacts` (no parallel builder); the availability predicate is generalized, not copied; templates only RENDER command text for the operator (prose, not exec — no new subprocess surface)
- [x] A-020 No client text reaches the brief-me/whats-stuck/retire-tab rendered prompts (closed lane preserved, Constitution I)
- [x] A-021 New behavior is test-covered (Go + unit + e2e with companion `.spec.md`) per code-quality.md

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- This branch contains wyn3's commits (rebased on its unmerged branch, PR #712). rfz2's PR will stack on wyn3 until #712 merges; after the merge, a rebase onto main drops the shared commits automatically.

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant (the one superseded symbol, `canRequestFixTabName`, was renamed in place to `canRequestWindowOperatorAction` with all call sites updated — no dead code remains).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Zero-waiting `whats-stuck` returns 409 (not 404/200) with "nothing is waiting on this server", via a declarative `requiresWaiting` flag | Intake left exact status plan-stage; 409 is the seam's valid-request-wrong-state class and the flag matches the landed `requiresChatRef`/`acceptsText` idiom | S:70 R:90 A:85 D:75 |
| 2 | Confident | Digest fields ride the shared `operatorWindowFact` (wyn3's), not a parallel table; waiting-first sorting happens in the rfz2 render funcs over a copy | One derivation site (Constitution X); reordering the shared builder would risk wyn3's shipped template output | S:70 R:85 A:85 D:80 |
| 3 | Confident | Palette entries call the landed `sendServerOperatorRequest(server, template, "")` with empty text rather than changing its signature | Backend admits empty text on closed templates; a signature change would touch wyn3's shipped call sites for zero benefit | S:75 R:90 A:90 D:85 |
| 4 | Confident | Retire confirm is one shared Dialog-based confirm for both entry points, not the palette `confirmLabel` sub-step | Intake names "a small confirm dialog"; `confirmLabel` cannot serve the flyout arm | S:75 R:85 A:80 D:70 |
| 5 | Confident | The fix-tab-name availability predicate is renamed/generalized (`canRequestWindowOperatorAction`) rather than duplicated or aliased | Intake says "reuse/extend"; identical triple, two consumers | S:70 R:85 A:85 D:80 |
| 6 | Confident | Retire flyout row carries the danger (red-rail) treatment | "Green means interactive, red means destructive" DD in status-signals memory; retire ends in a window kill | S:65 R:95 A:90 D:85 |
| 7 | Confident | Success toasts name the operator tab as where results land | Intake: toasts name where the result lands; copy trivially adjustable | S:70 R:95 A:85 D:80 |
| 8 | Confident | `rk mux send @N "<answer>" --answer` is the routine-answer verb — the pane target (window @N resolves to its agent pane) plus the `--answer` flag, which a waiting pane requires | Verified against `rk mux send --help` at apply time: "waiting refuses unless --answer"; the R4 plan text names only `rk mux send`, the flag surface check adds the gate flag | S:70 R:90 A:85 D:75 |

8 assumptions (0 certain, 8 confident, 0 tentative).

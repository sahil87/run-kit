# Plan: Operator Semantic Tab Coloring

**Change**: 260824-4940-operator-semantic-tab-coloring
**Intake**: `intake.md`

## Requirements

### Backend: The `color-tabs` template

#### R1: Registry entry rides the shared seam unchanged
The `operatorTemplates` registry SHALL gain a `color-tabs` entry with `serverScoped: true` and a `renderServer` func only — no `acceptsText`, no `requiresChatRef`, no `requiresWaiting`. The entry is served exclusively by `POST /api/operator-request?server=` through the existing pipeline (registry + scope validation → one `FetchSessions` → `buildServerOperatorFacts` → busy gate → `deliverOperatorPrompt`): no handler, route, or delivery-core change.

- **GIVEN** a server with an idle operator and body `{"template": "color-tabs"}`
- **WHEN** `POST /api/operator-request?server=` runs
- **THEN** exactly one FetchSessions occurs, the rendered prompt is injected into the operator's resolved pane, and the response is `200 {"ok":true}`.
- **AND GIVEN** `{"template": "color-tabs", "text": "x"}`, **THEN** 400 (closed text lane).
- **AND GIVEN** `color-tabs` on the window-scoped route, **THEN** 400 (wrong scope).
- **AND GIVEN** a busy operator, **THEN** 409 naming the state; no operator, **THEN** 404.

#### R2: Current label state joins the shared fact row
`operatorWindowFact` SHALL carry the subject window's current label state — `Color` (the `@color` value, "" when unset; `WindowInfo.Color` is `*string`, so the fact copies its dereferenced value or ""), `Marker`, and `Flair` — populated in the one `buildServerOperatorFacts` pass from the already-fetched `WindowInfo` (no second fetch, Constitution X). Existing templates' rendered output MUST be byte-identical (the digest row writer does not render the new fields).

- **GIVEN** a fetched window with `@color=blue`, `@rk_marker=solid`, unset flair
- **WHEN** `buildServerOperatorFacts` runs
- **THEN** its fact row carries `Color: "blue"`, `Marker: "solid"`, `Flair: ""`.
- **AND** `renderBriefMe`/`renderWhatsStuck`/`renderSpawnTask` output is unchanged for the same input.

#### R3: The rendered prompt
`renderColorTabs` SHALL compose (plain string concatenation, self-contained) in order: (1) the routing table — every non-operator window row via a color-tabs row writer that renders identity (session, `@N`, name), worktree, agent state, fab change/stage when non-empty, current labels as `labels: color=<v|-> marker=<v|-> flair=<v|->`, and the transcript path or a `transcript unavailable` note; (2) the read instruction — transcript JSONL tail (~30 lines, never capture-pane for agent tabs: alt-screen zero scrollback), with `rk mux capture @N` as the fallback for tabs with no transcript; (3) the categorize instruction — suggested default scheme (feature → `blue`, bugfix → `red`, infra/tooling → `slate`, docs → `teal`, experiments → `purple`), operator MAY substitute a better-fitting scheme but MUST apply one coherent scheme across all tabs; (4) the actuation commands with the closed vocabularies enumerated verbatim — `tmux set-option -t @N '@color' '<value>'` (10 family names, optional `-dark`/`-light` shade suffix), optional sparing `@rk_marker` (8 tokens) / `@rk_flair` (12 tokens) accents, and the unset form `tmux set-option -t @N -u '@color'`; (5) the judgment clauses — do nothing to a tab whose current labels already fit; existing manual colors may be reassigned (reversible via the label picker); (6) the repaint note — sidebar repaints within ~15 seconds of the last set-option, no further action needed; (7) the bounds — set only the three named options on listed windows only; do not rename, kill, or send keys to any window; do not reply. An empty routing table still renders a deliverable prompt (the brief-me posture — the operator reports nothing to color).

- **GIVEN** facts with two work windows (one labeled `color=blue`, one unlabeled with no transcript)
- **WHEN** `renderColorTabs` runs
- **THEN** the prompt contains both rows with their `labels:` clauses, the transcript path for the resolvable row, the `rk mux capture` fallback instruction, all three closed vocabularies verbatim, the coherent-scheme and do-nothing clauses, the unset form, the repaint note, and the bounds; the operator's own row never appears.
- **AND GIVEN** zero non-operator windows, **THEN** the prompt still renders (nothing-to-color posture) and delivery proceeds.

### Frontend: Palette entry

#### R4: `Operator: Color tabs` — direct-fire, degrade to absent
The palette SHALL gain an `Operator: Color tabs` entry (id `operator-color-tabs`) in `operatorComposeActions` (`app/frontend/src/app.tsx`), gated on the existing `hasOperatorWindow` (omit-not-disable), firing directly (non-destructive, no dialog, no confirm) via the existing `handleServerOperatorAction(server, "color-tabs", "Sent to operator — tabs will be colored shortly")`. Failure surfaces the server's structured message through the existing catch → toast path. No new client function, chord, dialog, or flyout row.

- **GIVEN** a server with an operator window
- **WHEN** the palette opens and `Operator: Color tabs` is selected
- **THEN** exactly one `sendServerOperatorRequest(server, "color-tabs", "")` fires and the success toast appears.
- **AND GIVEN** no operator window, **THEN** the entry is absent (not disabled).

### Non-Goals

- No `acceptsText` lane, no new registry flags, no endpoint/route/delivery changes.
- No rk CLI verb, no hub-wake change, no SSE/safety-poll cadence change (the ≤12s repaint lag is accepted — intake Assumption #3).
- Session-level colors (`@session_color`/`@rk_session_flair`) untouched; window rows only.
- Label picker, closed value sets, and `validate` package untouched.

### Design Decisions

#### Actuation via raw tmux set-option, accepting the safety-poll repaint lag
**Decision**: the prompt names `tmux set-option -t @N '@color' '<value>'` (and `-u` to unset) as the actuation, with the closed vocabularies enumerated verbatim; the repaint arrives on the ~12s safety poll.
**Why**: matches every shipped template's actuation style (rename-window, kill-window, rk riff, rk mux send); zero new failure modes (no daemon-URL resolution, works for remote-host operators); the operation is a minutes-long fire-and-forget batch, so a trailing ≤12s repaint is marginal. Invalid typed values degrade harmlessly (parseWindows drops unknown tokens; picker-reversible).
**Rejected**: instructing the operator to `curl POST $(rk url)/api/windows/@N/options` (immediate repaint + validation, but a longer fragile prompt introducing an operator→HTTP dependency no template has); a new rk label verb (CLI-surface expansion for a cosmetic-latency win).
*Introduced by*: 260824-4940-operator-semantic-tab-coloring

#### Label state rides the shared fact row
**Decision**: `Color`/`Marker`/`Flair` join `operatorWindowFact`, filled in the shared builder; only `renderColorTabs` renders them.
**Why**: the rfz2 precedent (digest fields ride the shared fact row) — one derivation site per Constitution X; templates that don't need the fields ignore them.
**Rejected**: a color-tabs-only parallel facts struct (duplicates the exclusion/iteration logic the shared builder owns).
*Introduced by*: 260824-4940-operator-semantic-tab-coloring

## Tasks

### Phase 1: Setup

*(none — no scaffolding needed; the change is additive to existing files)*

### Phase 2: Core Implementation

- [x] T001 Extend `operatorWindowFact` with `Color`, `Marker`, `Flair` string fields and populate them in `buildServerOperatorFacts` (deref `win.Color` to "" when nil) in `app/backend/api/operator.go` <!-- R2 -->
- [x] T002 Add `renderColorTabs(f serverOperatorFacts) string` in `app/backend/api/operator.go`: color-tabs row writer (identity, worktree, state, fab clause, `labels:` clause, transcript path/unavailable note), then the read/categorize/actuate/judgment/repaint/bounds blocks per R3 with the three closed vocabularies verbatim <!-- R3 -->
- [x] T003 Register `"color-tabs"` in `operatorTemplates` (`serverScoped: true`, `renderServer: renderColorTabs`) with a registry comment matching sibling entries, in `app/backend/api/operator.go` <!-- R1 -->
- [x] T004 Add `Operator: Color tabs` entry (id `operator-color-tabs`) to `operatorComposeActions` in `app/frontend/src/app.tsx`, firing `handleServerOperatorAction(server, "color-tabs", "Sent to operator — tabs will be colored shortly")` <!-- R4 -->

### Phase 3: Integration & Edge Cases

- [x] T005 Backend tests in `app/backend/api/operator_test.go`: `renderColorTabs` content assertions (rows with labels clause, capture fallback, vocabularies, bounds, empty-table posture, operator row excluded); fact-builder label-field population (incl. nil `Color` → ""); handler tests — color-tabs on the server route delivers 200 via one fetch, text on color-tabs → 400, color-tabs on the window route → 400; existing digest render tests still pass byte-identical (R2 no-drift) <!-- R1 -->
- [x] T006 Frontend test in `app/frontend/src/app.test.tsx`: `operator-color-tabs` palette entry fires `sendServerOperatorRequest` with `"color-tabs"` and is absent without an operator window (extend the existing operator palette test block at app.test.tsx:931) <!-- R4 -->

### Phase 4: Polish

*(none — memory updates belong to hydrate)*

## Execution Order

- T001 blocks T002 (renderer reads the new fields); T003 after T002 (references the renderer). T004 independent of backend tasks. T005 after T003; T006 after T004.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `color-tabs` resolves in the registry as server-scoped and delivers through the unchanged seam (200 on idle operator, 409 busy, 404 no-operator)
- [x] A-002 R2: fact rows carry current Color/Marker/Flair from the single fetch; nil `Color` maps to ""
- [x] A-003 R3: the rendered prompt contains all seven content blocks (table with labels clauses, read+fallback, scheme, actuation with verbatim vocabularies + unset form, judgment, repaint note, bounds)
- [x] A-004 R4: the palette entry exists, direct-fires the template, and toasts success/failure

### Behavioral Correctness

- [x] A-005 R1: non-empty `text` on `color-tabs` → 400; `color-tabs` on the window-scoped route → 400
- [x] A-006 R2: existing template renders (brief-me, whats-stuck, spawn-task, find-discussion) are byte-identical for identical inputs after the fact-row extension

### Scenario Coverage

- [x] A-007 R3: empty routing table still renders a deliverable prompt (test exists)
- [x] A-008 R3: a transcript-less row renders the `rk mux capture` fallback path; the operator's own row is excluded (test exists)
- [x] A-009 R4: no operator window ⇒ palette entry absent, not disabled (test exists)

### Edge Cases & Error Handling

- [x] A-010 R1: busy operator → 409 naming the state with no injection; no operator → 404 `"no operator on this server"` (existing seam tests cover the shared paths; color-tabs inherits them via the registry)

### Code Quality

- [x] A-011 Pattern consistency: registry entry, renderer, row writer, palette entry, and tests match the shapes of their rfz2/wyn3 siblings
- [x] A-012 No unnecessary duplication: the shared fact builder and `handleServerOperatorAction` are reused; no parallel facts struct, no new client function
- [x] A-013 Tests cover added behavior (backend render/handler/builder + frontend palette gating)
- [x] A-014 No magic strings: vocabularies in the prompt come from (or are asserted against) the `validate` closed sets where practical

### Security

- [x] A-015 R1: no new input lane — `color-tabs` rejects client text (closed posture, Constitution I); no new subprocess pattern

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Prompt vocabularies are written as literal strings in the renderer (asserted against `validate.MarkerValues`/`FlairValues` in tests) rather than generated from the validate package at render time | Sibling renderers are plain literals; a test-side assertion catches drift without coupling the prompt to set-iteration order | S:55 R:90 A:80 D:70 |
| 2 | Confident | The repaint note says "~15 seconds" (safety-poll ~12s + margin) rather than exposing internals | Operator-facing wording; exact cadence is an implementation detail | S:50 R:95 A:85 D:80 |
| 3 | Certain | Success toast copy: "Sent to operator — tabs will be colored shortly" | Matches the sibling toast pattern verbatim (rename/summarize precedents) | S:70 R:95 A:95 D:90 |

3 assumptions (1 certain, 2 confident, 0 tentative).

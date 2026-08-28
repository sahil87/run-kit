# Intake: Update-Annotations Operator Template & Tile Notes

**Change**: 260827-8n6k-update-annotations-tile-note
**Created**: 2026-08-27

## Origin

Natural-language follow-up to the shipped change **260824-bb5n-tab-status-note / PR #734** (the `@rk_note` per-tab status note) and its design study `docs/wiki/tab-note-design-studies.html`. The extensions map for that study is tracked as backlog **[8fjh]**; this change implements the session-tiles display idea plus the operator-writer portion of it — but it is a **new natural-language change, not backlog-ID-driven**: [8fjh] is NOT consumed or closed and no `--change-id` was passed (the rest of [8fjh] — whats-stuck note triage, board subtitles, note search, handoff seeding, etc. — stays open).

> Make the shipped `@rk_note` per-tab status note (260824-bb5n, PR #734) actually useful — four decided changes: (1) Server-page session tiles render the note (+ relative age, 24h stale dimming) as the tile body INSTEAD of the captured terminal preview when a window has one; no note → preview exactly as today. (2) A new server-scoped operator template `update-annotations` in the closed registry: the operator reads each tab's transcript tail and writes/refreshes a one-line `@rk_note` per tab, with an optional `session` scope on the server-scoped route body. (3) The session flyout card gains an "Update annotations" action row (session-scoped) and the palette gains `Operator: Update annotations` (server-wide). (4) The window flyout card's "Annotate tab" action row is REMOVED (it took prime real estate in the hover popup); the palette entry and the backend `annotate-tab` template stay. (5) The `retire-tab` operator template is RETIRED end-to-end — registry entry, prompt, confirm dialog, window-card row, palette entry — because its close-out note lands in `fab/backlog.md`, a list of things to do, where a "what happened" paragraph has no consumer and gets lost; without a trusted sink the verb degrades to a slower kill.

Interaction mode: promptless dispatch (decisions synthesized from a prior design conversation; captured verbatim below, no re-litigation).

## Why

The `@rk_note` plumbing shipped in 260824-bb5n end-to-end (schema `<epoch>:<text>` on the `@rk_note` window option, tolerant parse, `note`/`noteEpoch` on the sessions payload, the window flyout `NoteLine` display, the `Window: Set note…` prompt, and the window-scoped `annotate-tab` operator template), but in practice it is under-used:

1. **Notes are invisible where they would pay off most.** The tmux Server page's session tiles show a raw terminal capture preview per window — useful for "is it printing something", useless for "why is this tab here / what is it blocked on". A written note answers exactly that question, but today it renders only in the sidebar row's hover flyout. If we don't surface notes on the monitoring-density view, nobody bothers writing them and the feature decays.
2. **Writing notes is one-tab-at-a-time.** `annotate-tab` is window-scoped: annotating a 12-tab server means 12 hover-and-click cycles. There is no "sweep the server (or one session) and refresh every note" verb, which is the natural operator batch job — the exact shape `color-tabs` and `brief-me` already have.
3. **The window flyout's "Annotate tab" action row earns its slot poorly.** The user objected to it taking prime real estate in the hover popup: it is a per-tab nicety used rarely, and the palette already reaches it (Constitution V — the palette is the action registry of record). The hover card should keep the note DISPLAY, not the per-tab write trigger.

4. **`retire-tab` writes to a sink nobody reads.** Its close-out note ("what was done / decided / left open") goes to the flat backlog via `idea` — the backlog is a to-do list, not a history log, so the note dilutes real ideas and is never consumed. A destructive verb whose only advantage over plain kill is an unread note is net-negative surface (Constitution IV); the user decided to retire it rather than find it a new sink.

Approach over alternatives: a **separate dedicated `update-annotations` template** rather than folding note-writing into `brief-me` — the fold was explicitly rejected because it would change brief-me's digest contract (read-only, reply-in-own-window) and be un-scopeable (brief-me has no session parameter and adding one for the fold's sake would widen two contracts at once).

## What Changes

### 1. Server-page session tiles: note replaces the preview body (render-only)

File: `app/frontend/src/components/session-tiles/session-tiles.tsx` (the `/$server` index route's monitoring-density view).

- When a window tile's `win.note` is non-empty, render the note **as the tile body INSTEAD of** the captured terminal preview (the `previews[win.windowId]` block, currently the `h-40` bottom-anchored `AnsiText` box at ~lines 207–231, testid `window-tile-preview-{windowId}`).
- The note body shows the note text **plus its relative age**, reusing the existing conventions from the window flyout's `NoteLine` (`app/frontend/src/components/sidebar/row-flyout-card.tsx:377`): age derived from `win.noteEpoch` (`· 2h ago` via `formatDuration`), **24h stale dimming** via the exported `NOTE_STALE_SECONDS` constant (`row-flyout-card.tsx:369`, `24 * 3600`) — stale notes render dimmed (opacity-50 / secondary text), never hidden; epoch-0 tolerant-parse notes render text-only with no age.
- **No note → the preview renders exactly as today** (degrade-to-absent; zero behavior change for un-noted windows). Ghost (optimistic) windows keep their current no-preview behavior.
- The note body renders compact (note + age lines) rather than inside the fixed `h-40` preview box. <!-- assumed: compact tile note body (no fixed h-40 box) — visual judgment the description doesn't pin; the alternative keeps the h-40 box for grid-height uniformity -->


- **Render-only**: `note`/`noteEpoch` already ride the sessions payload (`app/frontend/src/types.ts:121,124`) and the SSE stream — no backend or payload change. The preview capture scope machinery (`setPreviewScope`) is untouched (scope is per-session; a noted window's preview may still arrive and simply isn't rendered).

### 2. New server-scoped operator template `update-annotations` with optional `session` scope

File: `app/backend/api/operator.go` (+ `operator_test.go`).

**Registry entry** — a new key in the closed `operatorTemplates` registry (`operator.go:115`):

```go
// update-annotations: the operator reads every listed tab's transcript tail
// and writes/refreshes a one-line @rk_note per tab through its own shell;
// notes surface via the normal derive tick (~12s safety poll).
"update-annotations": {
    serverScoped: true,
    renderServer: renderUpdateAnnotations,
},
```

**Prompt content** (`renderUpdateAnnotations(f serverOperatorFacts) string`) — follows the existing `color-tabs`/`brief-me` per-row facts idiom: one row per non-operator window from the shared `buildServerOperatorFacts` table (identity `session/@N/name`, worktree, agent state + duration, fab change/stage when non-empty, and the per-row transcript JSONL path **or the `rk mux capture @N` fallback note** for a row with no transcript — plain shell windows have real scrollback, agent TUIs do not). For each tab the operator:

- reads the transcript tail (~30 JSONL lines; never capture-pane for an agent tab) or the capture fallback,
- writes/refreshes a one-line note via the exact epoch-prefixed actuation (the same bounded shape as `annotate-tab`, `renderAnnotateTab` at `operator.go:492`):

```
tmux set-option -wt @N @rk_note "$(date +%s):<one-line note>"
```

- bounded at **~100 characters**, with the explicit **skip-the-write instruction when there is nothing meaningful to say**, and the standard **do-not-reply / no-other-action** bound. An empty row table still delivers a trivially-answerable prompt (the brief-me posture; only `whats-stuck` rejects an empty subject set). The prompt names only the write form — skip leaves an existing note in place; no unset form is offered. <!-- assumed: write-form only, no `tmux set-option -wt @N -u @rk_note` unset instruction — notes never auto-expire and clearing stays a user action, though the color-tabs precedent does name its unset form -->

**Optional `session` scope** — the server-scoped route `POST /api/operator-request?server=` body (`operatorRequestBody`, `operator.go:540`) gains an optional field:

```go
type operatorRequestBody struct {
    Template string `json:"template"`
    Text     string `json:"text"`
    Session  string `json:"session"` // optional; template must declare it
}
```

- When present, the template renders **only that session's window facts**; when absent it covers **all tabs on the server**.
- Validated against the **live session names from the same one-`FetchSessions` facts block** (Constitution I — user-provided session names are validated before use; Constitution X — one fetch serves operator lookup, fact derivation, AND session validation, mirroring `handleServerOperatorRequest`'s existing single-pass shape at `operator.go:816`). An unknown session name is rejected with the route's existing absent-entity vocabulary (404-class `writeError`, e.g. `"no session <name> on this server"`).
- The closed posture mirrors `acceptsText`: a non-empty `session` on a template that does not declare session support is a **400** naming the template (a declarative registry flag beside `acceptsText`/`requiresWaiting`). Only `update-annotations` declares it in this change.

**DECIDED: `brief-me` is NOT renamed and NOT changed** — `update-annotations` is a separate dedicated template. (Rejected alternative: folding note-writing into `brief-me` — rejected because it would change brief-me's digest contract and be un-scopeable.)

### 3. Session flyout card action row + palette entry (the two fire surfaces)

- **Session card row**: the session tier's flyout card — whose content lives in `app/frontend/src/components/sidebar/session-row.tsx` (~lines 167–219; the shared `useRowFlyout` shell with `coarseOnly: true`), NOT in `row-flyout-card.tsx` as originally sketched — gains an **"Update annotations"** action row alongside `Change color…`/`Spawn agent…`/`New tab`/`Kill session`. Same busy/`mountedRef` in-flight-guard action-row shape as the existing operator rows (`FixTabNameActionRow` idiom, `row-flyout-card.tsx:565`). It fires the server-scoped `update-annotations` request **scoped to that session** (`session` field = the card's session name). Availability follows the seam's degrade-to-absent rule: rendered only when the server has an operator window (the `hasOperator` fact already derived in `sidebar/index.tsx:2450`); omitted, never disabled.
- **Palette entry**: `Operator: Update annotations` joins the server-scoped operator group in `app/frontend/src/app.tsx` (`operatorComposeActions`, ~line 3773 — beside `Operator: Brief me` / `Operator: Color tabs`), gated on the same `hasOperatorWindow` omit-not-disable rule, firing **server-wide** (no `session` field) via the existing `handleServerOperatorAction` shape (`app.tsx:2326`).
- **Client**: `sendServerOperatorRequest` (`app/frontend/src/api/client.ts:374`) carries the optional session — e.g. an optional trailing `session?: string` parameter included in the JSON body only when non-empty (existing callers unchanged).
- **Outcome surfacing**: both surfaces toast the outcome (success: hand-off copy in the sibling style, e.g. `"Sent to operator — notes will be updated shortly"`; failure: the server's structured 409/404 message via `throwOnError`). Results arrive via the normal SSE derive tick — user-option writes emit no control-mode event, so they ride the **~12s safety poll**; acceptable, **no spinner beyond the in-flight guard** (the annotate-tab precedent).

### 4. Window flyout card: REMOVE the "Annotate tab" action row

- Remove `AnnotateTabActionRow` (`app/frontend/src/components/sidebar/row-flyout-card.tsx:611–647`) and its `NoteIcon` glyph (`row-flyout-card.tsx:651`, if unused after removal), the `onAnnotateTab` prop + `annotateHandler` gate in `WindowFlyoutContent` (`row-flyout-card.tsx:775,794–797,834,952`), and the flyout-only prop plumbing: `window-row.tsx` (`onAnnotateTab` at lines 122, 218, 274–277, 312) and `sidebar/index.tsx` (lines 178, 212, 1842, 2251–2252, 2337, 2996, 3175), plus the `onAnnotateTab={handleAnnotateTab}` Sidebar prop at `app.tsx:4315`.
- **KEEP**: the palette entry `Operator: Annotate tab` (`app.tsx:2751–2760`) and its `handleAnnotateTab` handler (`app.tsx:2347` — still used by the palette), the backend `annotate-tab` template and its tests (`operator_test.go:1126+`), and the note DISPLAY line (`NoteLine`, `row-flyout-card.tsx:377`) in the card body. The palette is the registry of record (Constitution V) — only the hover-card action row goes.
- **Tests**: remove any tests exercising the flyout annotate row. Verified: the row's testid `row-flyout-annotate-action` is referenced by **no test file** (only by the component itself), so the removal is wiring-only; the `app.test.tsx` "CmdK Annotate Tab Action" palette-gate tests (~line 1100) cover the palette entry and STAY.

### 5. Retire the `retire-tab` operator template (removal, end-to-end)

Everything sits behind the closed registry, so it comes out cleanly with no replacement:

- **Backend** (`app/backend/api/operator.go`, `operator_test.go`): delete the `"retire-tab"` registry entry and `renderRetireTab`; delete its tests (`TestRenderRetireTab` and the retire scope/guard cases). No route changes — the window-scoped route simply no longer knows the id (an incoming `retire-tab` becomes the standard `unknown operator template` 400).
- **Frontend**: delete `app/frontend/src/components/retire-confirm-dialog.tsx` + `retire-confirm-dialog.test.tsx`; remove the `Retire…` action row from the window flyout card (`row-flyout-card.tsx` — the `onRetireTab` prop, `retireHandler` gate, and the row) and its prop chain through `window-row.tsx` and `sidebar/index.tsx`; remove the palette action and its handler/dialog state in `app.tsx`; remove any `retire-tab`-specific client helper if one exists (the generic `sendWindowOperatorRequest` stays). Remove the retire-related tests in `row-flyout-card.test.tsx` / `app.test.tsx`.
- **KEEP**: the plain `Kill window…` row and its confirm — retire's destructive sibling — unchanged. The `canRequestWindowOperatorAction` availability predicate stays (fix-tab-name still uses it); only its retire consumer goes.
- **Memory/docs**: hydrate removes the retire-tab requirement + design-decision entries from `operator-actuation`, the `Retire…` row from the window-card row order in `ui/status-signals`/`ui/sidebar`, and the palette action from `ui/keyboard-and-palette`. No backlog close-out semantics remain anywhere.
- **Non-goal**: no replacement close-out mechanism (fab-change note, PR comment, etc.) — nothing reads close-outs today; a solution can wait for a problem.

### Non-goals (decided)

- No `brief-me` changes (no rename, no note fold).
- No auto-fire of `update-annotations` on busy→idle (deferred — backlog [8fjh] territory; the `fix-tab-name` auto-name tracker is untouched).
- No palette find-by-note search (deferred).
- No board-card note subtitles (deferred).
- Backlog [8fjh] is NOT consumed or closed.

## Affected Memory

- `run-kit/operator-actuation`: (modify) add the `update-annotations` template requirement (server-scoped, per-row facts, epoch-prefixed `@rk_note` actuation, skip-clause, bounds) and the optional `session` scope on the server-scoped route (declarative registry flag, live-session validation, 400/404 vocabulary); amend the Frontend-availability requirement — `AnnotateTabActionRow` removed (palette entry stays), session-card + palette entry points for update-annotations added; REMOVE the `retire-tab` template requirement and its design decisions (the seam's destructive-template carve-out goes with it)
- `run-kit/ui/status-signals`: (modify) window flyout card — annotate AND `Retire…` action rows removed from the fixed row order (Kill stays); session card — "Update annotations" action row added
- `run-kit/ui/sidebar`: (modify) session card action list gains the Update annotations row (coarse-pointer card)
- `run-kit/ui/keyboard-and-palette`: (modify) palette actions — add `Operator: Update annotations` to the server-scoped operator group; `Operator: Annotate tab` unchanged but now palette-only; remove the retire-tab palette action
- `run-kit/ui/routes-and-shell`: (modify) session tiles — note body replaces the capture preview when a note exists (24h stale dimming, degrade-to-absent)

## Impact

- **Backend**: `app/backend/api/operator.go` (registry entry + render func + body field + session validation in `handleServerOperatorRequest`), `app/backend/api/operator_test.go` (new template render/scope/validation tests, mirroring the color-tabs/brief-me test shapes). No new routes, no new subprocess patterns (delivery rides the existing `deliverOperatorPrompt` core unchanged).
- **Frontend**: `session-tiles/session-tiles.tsx` (+ `session-tiles.test.tsx`), `sidebar/row-flyout-card.tsx` (annotate + retire row removal; `NoteLine`/`NOTE_STALE_SECONDS` reuse), `retire-confirm-dialog.tsx` + test (deleted), `sidebar/session-row.tsx` (new card row), `sidebar/window-row.tsx` + `sidebar/index.tsx` (prop-chain removal), `app.tsx` (palette entry add; Sidebar prop removal), `api/client.ts` (optional session param).
- **Tests**: Go tests for the template + session lane; Vitest for tile note body and session-card row; e2e `app/frontend/tests/e2e/session-tiles.spec.ts` + companion `session-tiles.spec.md` updated in the same commit (Constitution — Test Companion Docs) if tile behavior assertions change.
- **No schema/payload change**: `note`/`noteEpoch` already ride `/api/sessions` + SSE; `@rk_note` conventions (`<epoch>:<text>`, 24h staleness, never auto-expire) unchanged.

## Open Questions

- None — the design conversation resolved scope and surfaces; residual judgment calls are graded in Assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Session tiles render the note (+ age, 24h stale dimming per `NOTE_STALE_SECONDS`) INSTEAD of the capture preview when `win.note` is set; no note → preview exactly as today; render-only (payload fields already exist, verified `types.ts:121,124`) | Discussed — user chose note-replaces-preview; degrade-to-absent verbatim from the description | S:95 R:85 A:90 D:95 |
| 2 | Certain | `update-annotations` is a NEW dedicated server-scoped template; `brief-me` is NOT renamed and NOT changed | Discussed — user rejected the brief-me fold (would change its digest contract, un-scopeable) | S:95 R:80 A:90 D:95 |
| 3 | Certain | Optional `session` field on the server-scoped route body, validated against live sessions from the same one-FetchSessions block; present → that session's facts only, absent → whole server | Discussed — user specified the field, its validation source (Constitution I/X), and both scopes | S:90 R:80 A:85 D:90 |
| 4 | Certain | Per-tab actuation is `tmux set-option -wt @N @rk_note "$(date +%s):<note>"`, ≤ ~100 chars, skip-when-nothing-meaningful, do-not-reply — the annotate-tab bounded shape; per-row facts follow the color-tabs/brief-me idiom (transcript path or capture fallback) | Discussed — command, bound, and idiom given verbatim; matches shipped `renderAnnotateTab`/`renderColorTabs` | S:95 R:85 A:90 D:95 |
| 5 | Certain | Session card gains an "Update annotations" row (session-scoped fire); palette gains `Operator: Update annotations` (server-wide, no session field); both toast; results ride the ~12s safety-poll derive tick with no spinner beyond the in-flight guard | Discussed — both surfaces, scoping, and feedback posture decided (annotate-tab precedent) | S:90 R:80 A:85 D:90 |
| 6 | Certain | REMOVE the window flyout `AnnotateTabActionRow` + its prop chain; KEEP the `Operator: Annotate tab` palette entry, `handleAnnotateTab`, the backend `annotate-tab` template, and the `NoteLine` display | Discussed — user objected to the hover-popup real estate; palette is the registry of record (Constitution V) | S:95 R:85 A:90 D:95 |
| 7 | Certain | Non-goals: no brief-me changes, no busy→idle auto-fire, no note search, no board subtitles; [8fjh] noted in Origin but not consumed/closed | Discussed — deferred list given verbatim; NL change, no `--change-id` | S:95 R:90 A:90 D:95 |
| 8 | Confident | The session-card row is implemented in `sidebar/session-row.tsx` (the session tier's card content lives there, not in `row-flyout-card.tsx` as the description sketched), reusing the shared `CardActionRow`/busy-guard idioms exported from `row-flyout-card.tsx` | Verified in code — `session-row.tsx:167` builds the coarse-only session card; description's file pointer corrected to the real current layout (post-#732 reorg) | S:80 R:85 A:90 D:85 |
| 9 | Confident | A non-empty `session` on a template that does not declare session support is a 400 naming the template (declarative registry flag beside `acceptsText`); an unknown session name on a declaring template is a 404-class absent-entity error | Description says "404/400 per the route's existing vocabulary"; the registry's closed-lane posture (`validateOperatorText`) and the route's 404 absent-entity precedent (`no operator on this server`) make this the one consistent reading | S:70 R:80 A:80 D:70 |
| 10 | Confident | Session-scope filtering is applied to the shared builder's output (filter `facts.Windows`/`Corpus` to the named session) rather than reshaping `buildServerOperatorFacts` for all callers | Matches the shipped "waiting-first ordering lives in the consumer" design decision — the shared builder's natural order/content feeds other templates | S:65 R:85 A:85 D:75 |
| 11 | Confident | An empty fact-row set (e.g. a session whose only windows lack anything to annotate) still delivers a trivially-answerable prompt — the brief-me/color-tabs posture; only `whats-stuck` rejects | Shipped seam convention; the skip-clause already gives the operator the no-op path | S:60 R:85 A:85 D:80 |
| 12 | Confident | The session-card row renders only on coarse pointers (the session card is coarse-only by design; fine pointers keep identity tip + hover cluster); the server-wide palette entry is the keyboard/fine-pointer path, satisfying Constitution V for the action family | Verified — `useRowFlyout({coarseOnly: true})` in session-row.tsx; user decided exactly these two entry points, so no extra fine-pointer session-scoped surface is added | S:60 R:80 A:70 D:65 |
| 13 | Confident | Client shape: `sendServerOperatorRequest` gains an optional session argument, included in the body only when non-empty; existing callers unchanged | Smallest change consistent with the existing `withServer` + `throwOnError` shape; easily revised | S:60 R:90 A:85 D:80 |
| 14 | Tentative | The tile note body renders compact (note + age lines, no fixed `h-40` box) — the tile shrinks vs the preview box; alternative: keep the `h-40` box for grid-height uniformity | Visual judgment the description doesn't pin; reversible one-file styling decision for apply/review | S:40 R:85 A:55 D:45 |
| 15 | Tentative | The update-annotations prompt names only the WRITE form (skip = leave any existing note in place); it does not offer the unset form `tmux set-option -wt @N -u @rk_note` for obsolete notes | Description says "writes/refreshes … skip when nothing meaningful"; notes never auto-expire and clearing stays a user action — but color-tabs precedent does name its unset form, so the alternative is plausible | S:45 R:85 A:55 D:45 |

| 16 | Certain | Retire `retire-tab` end-to-end (registry entry, prompt, confirm dialog, window-card row, palette entry, tests); `Kill window…` and `canRequestWindowOperatorAction` stay | Discussed — user decided the backlog is the wrong sink for close-outs and the verb should go; footprint verified by grep (9 code files, 4 memory files) | S:95 R:80 A:90 D:95 |
| 17 | Confident | No replacement close-out mechanism is introduced | Nothing consumes close-outs today; adding a new sink would be speculative surface (Constitution IV) — cheap to add later if a reader appears | S:70 R:90 A:85 D:80 |

17 assumptions (8 certain, 7 confident, 2 tentative, 0 unresolved).

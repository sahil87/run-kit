# Plan: Terminal Tile Find

**Change**: 260819-zqf9-terminal-tile-find
**Intake**: `intake.md`

## Requirements

### Frontend: Shared FindBar component

#### R1: FindBar extraction with a props-driven contract
A shared presentational component `app/frontend/src/components/find-bar.tsx` SHALL render the find UI both consumers share: a text input, an `n/N` match counter with the active ordinal in accent green (`0/0` when nothing matches), ∧/∨ previous/next buttons, a ✕ close button, and a right-aligned key hint `Enter next · ⇧Enter prev · Esc close` suppressed on coarse pointers (`useCoarsePointer()`). The component SHALL be props-driven — `{ query, matchIndex, matchCount, onQueryChange, onNext, onPrev, onClose }` plus optional `toggles`, `disabled`, `statusText` (replaces the counter — the web cross-origin hint), and `scopeNote` (muted note appended to the hint area — the tty buffer-scope hint) — with the consumer owning the search mechanism. Enter SHALL advance, ⇧Enter go back, Escape close; the input SHALL autofocus when the bar mounts (or opens).

- **GIVEN** a consumer renders `<FindBar query="x" matchIndex={2} matchCount={7} …/>`
- **WHEN** the bar paints
- **THEN** the counter reads `3/7` with the ordinal in accent green, and Enter/⇧Enter/Escape invoke `onNext`/`onPrev`/`onClose`

#### R2: IframeWindow consumes FindBar with zero behavior change
`app/frontend/src/components/iframe-window.tsx` SHALL be refactored to render the shared `FindBar` in place of its inline bar markup, preserving every observable behavior: `data-testid="web-find-bar"` on the bar row, the cross-origin disabled state with the `page is cross-origin — find unavailable` hint, autofocus on open, the R8 per-load reset, and all aria labels. The existing web-tile find e2e specs (`web-tile-find.spec.ts`) MUST pass unmodified — the refactor-is-invisible proof. The web consumer renders no toggles.

- **GIVEN** the landed web-tile find e2e suite
- **WHEN** it runs against the refactored IframeWindow
- **THEN** every spec passes with no test edits

### Frontend: Find on the tty tile

#### R3: Search wiring over the scaffold's `searchAddonRef` seam
`SurfaceLayout` (`app/frontend/src/components/surface-layout.tsx`) SHALL own the tty find state (open, query, matchIndex/matchCount, case-sensitive + regex toggles), create the `SearchAddon` ref, and pass it as `searchAddonRef` to the PRIMARY tty `TerminalClient` only (the `wsRef`/`focusRef` primary-only precedent). Query, toggle, and navigation changes SHALL drive `findNext`/`findPrevious` with `ISearchOptions` mapping `Aa → caseSensitive` and `.* → regex`, always with `decorations` enabled; the counter SHALL derive from the addon's `onDidChangeResults` event. The scaffold's addon registration and `terminal-client.tsx` import block SHALL NOT be re-added or edited (the one permitted terminal-client edit is R5's constructor option).

- **GIVEN** a tty tile with pane output containing three occurrences of "FAIL"
- **WHEN** the user types `FAIL` in the find bar
- **THEN** the counter reports the addon's result count and Enter/∨ advances the active match (wrapping), ⇧Enter/∧ goes back

#### R4: Bar and button mount at the scaffold anchors only
The find bar row SHALL mount at the `{/* rk-slot: find-bar-row */}` anchor (below the tty tile header, the web tile's below-URL-row pattern), and a ⌕ header button SHALL replace `{/* rk-slot: find-button */}` (left of the pane segment, `aria-pressed` + accent-green while open — the web ⌕ vocabulary). Both render for the primary tty tile only. ONLY those anchor lines are edited — the adjacent `export-button`, `progress-chip`, and `progress-line` anchors belong to parallel siblings and MUST remain byte-identical.

- **GIVEN** the tty tile header on a desktop viewport
- **WHEN** the ⌕ button is clicked
- **THEN** the find bar row appears below the header, the button lights accent-green with `aria-pressed="true"`, and a second click closes it

#### R5: Decorations — buffer highlights + overview-ruler ticks
Searches SHALL run with `decorations` populated so matches highlight in the buffer and tick the overview ruler: amber for matches, accent-green for the active match (design study state 01, the label-color vocabulary), colors derived from the active theme (`#RRGGBB` as the addon requires). The Terminal constructor in `terminal-client.tsx` SHALL gain the `overviewRuler` width option (without it the ruler never renders). `clearDecorations()` SHALL run on close/Escape and on query clear; match state survives scrolling; closing the bar clears everything; the query does not persist across window switches.

- **GIVEN** an active query with matches
- **WHEN** the user presses Escape
- **THEN** the bar closes, all decorations and ruler ticks clear, and terminal focus returns to the pane

#### R6: Entry points — ⌘F chord, ⌕ button, palette action
A `terminal-find` keybinding SHALL be added to `DEFAULT_BINDINGS` (`app/frontend/src/lib/keybindings.ts`): `code: "KeyF"`, base `tier: "shifted"` (⇧Ctrl+F on Win/Linux — the GNOME Terminal/Konsole/Windows Terminal convention, since plain Ctrl+F is the pane's readline forward-char there), `macTier: "cmd"` (⌘F on mac hosts), `scope: "terminal"`, `ttyOnly: true`, `ignoreInputs: true`, `mapLabel: "find"`. The chord handler (gated by the existing `ttyGated` shape in `app.tsx` beside `webGated`) and a `Terminal: Find` palette action (registered while the rendered layout includes a tty tile — the `Web: Find in page` gating precedent) SHALL share one open seam: a `terminal-find:open` document CustomEvent that the mounted SurfaceLayout listens for (the `web-find:open` precedent). No `attachCustomKeyEventHandler` change is needed: the terminal seam already refuses shifted-tier matches on every platform and cmd-tier matches with metaKey on mac, so the chord bubbles to the dispatcher under terminal focus; elsewhere the browser's native find is untouched (the `ttyOnly` handler-absent fall-through).

- **GIVEN** a tty tile owning focus on a mac host
- **WHEN** the user presses ⌘F
- **THEN** the tty find bar opens with the input focused; with the web tile focused instead, the web bar opens (web-find); with neither, the browser's native find is untouched

#### R7: `findConflicts` gate-disjointness
On mac hosts `terminal-find` (cmd-tier KeyF, terminal scope, `ttyOnly`) shares its combo with `web-find` (cmd-tier KeyF, terminal scope, `webOnly`). `findConflicts` SHALL treat two bindings whose surface gates are disjoint (one `ttyOnly`, one `webOnly`) as non-conflicting — their handlers are never simultaneously present — keeping the shipped-defaults conflict-free invariant test green in every host. The dispatcher needs no change: it already fires the first match with a handler.

- **GIVEN** the shipped default bindings resolved for a mac host
- **WHEN** the conflict-free invariant test runs
- **THEN** it passes, and a genuinely conflicting equal-scope pair (neither gated, or same gate) is still flagged

#### R8: Buffer-scope hint
Once a search has run, the bar's hint area SHALL append a muted scope note stating that matches reflect the client buffer only (short copy, e.g. "since attach"). No server-side search is attempted.

- **GIVEN** an executed query on the tty bar
- **WHEN** the bar renders
- **THEN** the muted scope note is visible in the hint area

### Non-Goals

- No server-side / full-history search (`capture-pane` grep) — shqo's full-history export is the complete-record path.
- No changes to the web tile's find behavior beyond the invisible extraction refactor.
- No find on chat/code lenses; no search-history UI; no query persistence across window switches.
- No find affordance on duplicate (non-primary) tty tiles — the primary-tty precedent (`wsRef`/`focusRef`/dock).

### Design Decisions

#### terminal-find base tier is shifted with a mac cmd demotion
**Decision**: `terminal-find` ships as ⇧Ctrl+F on Win/Linux (`tier: "shifted"`) and ⌘F on mac (`macTier: "cmd"`), reusing the established demotion data (`go-back`/`sidebar-toggle` pattern).
**Why**: plain Ctrl+F belongs to the pane on Win/Linux (readline forward-char) and the terminal seam deliberately never refuses unmatched plain-Ctrl chords; the shifted tier is what every cross-platform terminal uses for find, and the seam's existing rules 1–2 make both chords bubble under terminal focus with zero xterm-handler changes.
**Rejected**: cmd-tier Ctrl+F everywhere (mirroring `web-find`) — it could never fire under terminal focus on Win/Linux without a new seam rule that steals readline's Ctrl+F from the pane.
*Introduced by*: 260819-zqf9-terminal-tile-find

#### One open seam per consumer, both CustomEvents
**Decision**: the tty chord handler and palette body dispatch `terminal-find:open` on `document`; SurfaceLayout is the single receiver. The ⌕ button toggles locally.
**Why**: byte-parallel with the landed `web-find:open` seam — the opener (app.tsx) and the state owner (SurfaceLayout) are far apart in the tree, and at most one terminal route's SurfaceLayout is mounted.
**Rejected**: threading an `openFindRef` through SurfaceLayout props — a new ref seam where an established event vocabulary already exists.
*Introduced by*: 260819-zqf9-terminal-tile-find

## Tasks

### Phase 1: Setup

- [x] T001 Run `just setup` in the worktree (frontend deps + playwright); verify `@xterm/addon-search@0.16.0` resolves (pre-landed by scaffold hqjo — no package.json edit) <!-- R3 -->

### Phase 2: Core Implementation

- [x] T002 Create `app/frontend/src/components/find-bar.tsx` — shared presentational FindBar per the R1 contract (input, n/N counter, ∧/∨, ✕, key hint via `useCoarsePointer`, optional `toggles`/`disabled`/`statusText`/`scopeNote`, autofocus, Enter/⇧Enter/Escape) + colocated `find-bar.test.tsx` <!-- R1 -->
- [x] T003 Refactor `app/frontend/src/components/iframe-window.tsx` to consume FindBar with zero behavior change (keep `data-testid="web-find-bar"`, cross-origin disabled+hint, per-load reset, aria labels); run the existing web-tile find unit + e2e specs unmodified <!-- R2 -->
- [x] T004 Add `overviewRuler` width option to the Terminal constructor in `app/frontend/src/components/terminal-client.tsx` (the only terminal-client edit) <!-- R5 -->
- [x] T005 Create the tty find engine module (e.g. `app/frontend/src/lib/terminal-find.ts`): `TERMINAL_FIND_OPEN_EVENT`, the `ISearchOptions` mapping (caseSensitive/regex + theme-derived `#RRGGBB` decoration colors — amber matches, accent-green active) + colocated unit tests <!-- R3, R5 -->
- [x] T006 Wire tty find state into `app/frontend/src/components/surface-layout.tsx`: searchAddonRef → primary tty TerminalClient, find open/query/toggles/counter state (`onDidChangeResults`), FindBar with `Aa`/`.*` toggles + scope note at the `rk-slot: find-bar-row` anchor, ⌕ button at `rk-slot: find-button`, the `terminal-find:open` listener, `clearDecorations` on close/Escape/query-clear, focus return to the pane on close; touch no sibling anchors <!-- R3, R4, R5, R8 -->

### Phase 3: Integration & Edge Cases

- [x] T007 Add the `terminal-find` binding row to `app/frontend/src/lib/keybindings.ts` (KeyF, shifted base, `macTier: "cmd"`, terminal scope, `ttyOnly`, `ignoreInputs`, `mapLabel: "find"`); extend `findConflicts` with the ttyOnly/webOnly gate-disjointness rule; update `keybindings.test.ts` (new row expectations + conflict-free invariant + disjointness unit) <!-- R6, R7 -->
- [x] T008 Wire `app.tsx`: `"terminal-find"` handler via the ttyGated shape dispatching `TERMINAL_FIND_OPEN_EVENT`, and the `Terminal: Find` palette action gated on a tty tile in the rendered layout <!-- R6 -->
- [x] T009 Verify gates: `cd app/frontend && npx tsc --noEmit`, `just test-frontend` (FindBar, terminal-find lib, keybindings, iframe-window units green) <!-- R1, R2, R3, R6, R7 -->

### Phase 4: Polish

- [x] T010 e2e `app/frontend/tests/e2e/terminal-tile-find.spec.ts` + companion `.spec.md`: ⌘F (via the shifted-tier chord the Linux rig resolves) opens the bar on a tty tile with real pane output, match count + Enter navigation, Escape closes and clears decorations, ⌕ button toggle; run it plus the unmodified `web-tile-find.spec.ts` via `just test-e2e` <!-- R2, R3, R4, R5, R6 -->

## Execution Order

- T002 blocks T003 and T006 (both consume FindBar)
- T004, T005 block T006; T005 blocks T008 (event constant)
- T007 blocks T008 (binding row before the handler); T009 gates T010

## Acceptance

### Functional Completeness

- [x] A-001 R1: `find-bar.tsx` exists with the props-driven contract (query/matchIndex/matchCount/onQueryChange/onNext/onPrev/onClose + toggles/disabled/statusText/scopeNote) and unit tests
- [x] A-002 R2: IframeWindow renders FindBar; no inline bar markup remains
- [x] A-003 R3: primary tty TerminalClient receives `searchAddonRef`; findNext/findPrevious drive navigation with caseSensitive/regex mapped from the toggles
- [x] A-004 R4: bar row and ⌕ button sit at their `rk-slot` anchors; `export-button`/`progress-chip`/`progress-line` anchor lines are byte-identical to HEAD
- [x] A-005 R5: searches pass `decorations` (amber match / accent-green active, valid `#RRGGBB`); Terminal gains `overviewRuler` width; `clearDecorations` fires on close/Escape/query-clear
- [x] A-006 R6: `terminal-find` binding row present (shifted base, macTier cmd, ttyOnly, ignoreInputs); handler + `Terminal: Find` palette action dispatch `terminal-find:open`
- [x] A-007 R8: the executed-query scope note renders in the bar's hint area

### Behavioral Correctness

- [x] A-008 R2: existing `web-tile-find.spec.ts` (+ its unit specs) pass with zero test-file edits
- [x] A-009 R6: with tty focus the chord opens the tty bar; with web focus ⌘F still opens the web bar; with neither, no handler fires and native find is untouched
- [x] A-010 R7: the conflict-free invariant test passes on mac + win/linux hosts; a same-gate equal-scope pair still conflicts

### Scenario Coverage

- [x] A-011 R3: e2e proves find + Enter navigation over real pane output on the port-3020 rig
- [x] A-012 R5: e2e proves Escape clears the bar and decorations

### Edge Cases & Error Handling

- [x] A-013 R3: zero-match query renders `0/0` and navigation no-ops; regex toggle with an invalid pattern does not throw (addon returns false / caught)
- [x] A-014 R5: closing the bar with an empty query is a clean no-op; window switch does not carry the query

### Code Quality

- [x] A-015 Pattern consistency: FindBar/terminal-find follow the pure-lib + colocated-test and CustomEvent-seam conventions; toggles use the existing button vocabulary
- [x] A-016 No unnecessary duplication: one FindBar serves both consumers; no forked bar markup; existing `ttyGated`/`webGated` shapes reused
- [x] A-017 No client polling: counter derives from `onDidChangeResults`, not intervals
- [x] A-018 Comment discipline: comments state constraints (anchor ownership, primary-tty rule), no narration or change-ID citations in code comments

### Security

- [x] A-019 R3: regex input is passed only to the addon's buffer search (no eval, no server round-trip)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change extracts the web tile's inline find bar into the shared `FindBar` (the old markup is removed in the same diff) and adds tty find without making other existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | terminal-find ships shifted-base ⇧Ctrl+F with macTier cmd (⌘F), not cmd-tier everywhere | Plain Ctrl+F is the pane's on Win/Linux and the seam's cmd rule is mac-only; shifted is the cross-platform terminal find convention; established demotion data pattern | S:70 R:85 A:90 D:80 |
| 2 | Confident | findConflicts gains a ttyOnly/webOnly gate-disjointness carve-out for the mac ⌘F share | The gates make handlers mutually exclusive by construction; the invariant test would otherwise fail; data-driven like the gates themselves | S:65 R:80 A:85 D:80 |
| 3 | Confident | Find UI renders on the primary tty tile only (duplicate ttys get none) | Mirrors the wsRef/focusRef/dock primary-only precedent; duplicate-tty find is a rare corner not worth per-occurrence state | S:60 R:85 A:85 D:75 |
| 4 | Confident | Decoration colors derive from the active theme (amber = signal-yellow family, active = accent-green) as #RRGGBB at search time | Addon requires #RRGGBB; theme system already derives xterm colors from the palette; exact derivation helper decided in code | S:60 R:90 A:80 D:75 |
| 5 | Confident | Scope-note copy is "since attach" (muted, hint area), shown once a search has run | Intake defers exact copy to apply with that example | S:70 R:95 A:90 D:85 |
| 6 | Confident | Terminal constructor gains `overviewRuler: { width }` in terminal-client.tsx despite the "don't edit terminal-client" note | The note guards the scaffold's import/registration block; the ruler cannot render without the option, and no parallel sibling touches the constructor | S:60 R:80 A:85 D:75 |
| 7 | Confident | Open seam is a `terminal-find:open` document CustomEvent received by SurfaceLayout | Byte-parallel with web-find:open; one mounted receiver per route | S:70 R:90 A:90 D:85 |

7 assumptions (0 certain, 7 confident, 0 tentative).

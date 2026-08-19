# Plan: Web Tile Keyboard Reclaim + Find-in-Page

**Change**: 260819-ie2i-web-tile-keyboard-find
**Intake**: `intake.md`

## Requirements

### Web Tile: Chord Reclaim (same-origin frames)

#### R1: IframeWindow's interaction seam upgrades from report-only to reclaiming
`IframeWindow`'s existing attach seam (`app/frontend/src/components/iframe-window.tsx:56-89`) SHALL, when a `shouldReclaimChord` predicate prop is provided, intercept capture-phase `keydown`s on the same-origin `contentDocument` that match the predicate: `preventDefault()` + `stopImmediatePropagation()` in the frame, then re-dispatch a synthetic bubbling `KeyboardEvent` on the parent **document** — mirroring `CodeSurface`'s `onKey` handler (`code-surface.tsx:157-174`) byte-for-byte in mechanism (key/code/modifier copy, `bubbles: true`). Non-matching keydowns MUST pass through untouched (typing into a form inside the frame is unchanged), and every keydown still reports `onInteract` first (tile-focus seam preserved). The listener re-attaches on every iframe `load` (each navigation replaces the document), `contentDocument` access stays try/catch-guarded, and cross-origin frames keep exactly the existing behavior: no reclaim, the parent-`window` `blur` fallback for `onInteract` only.

- **GIVEN** a web tile showing a same-origin `/present/…` page with focus inside the frame
- **WHEN** the user presses ⌘K (or any enabled non-surface-restricted registry chord)
- **THEN** the framed document never sees the unconsumed event, the parent document receives the synthetic keydown, and the command palette opens
- **AND** pressing a plain character or a non-registry chord reaches the framed page exactly as before

#### R2: The reclaim predicate becomes focused-kind-aware; `webOnly` joins `ttyOnly`
`hasReclaimableMatch` (`app/frontend/src/lib/keybindings.ts:432-437`) SHALL take the focused surface kind (the kind of the iframe the keydown arrived in) and reclaim a keydown only when some enabled match is meaningful under that focus: a `ttyOnly` binding is never reclaimable inside any iframe (unchanged semantics), and a binding carrying the new optional `webOnly?: boolean` data flag (the `ttyOnly` mirror: "only meaningful when the web tile owns focus") is reclaimable only when the kind is `"web"`. For the code iframe the result MUST be byte-identical to today for every existing binding (the split pair stays with code-server, ⌘K/⌘./⌘J/⌃` reclaim). Gate sites consult the flag as data, never actionId lists — the `app.tsx` dispatcher handler map SHALL treat a `webOnly` binding's handler as absent unless `focusedTileKind === "web"` (the exact `ttyOnly` gate pattern at `app.tsx:3314-3319`).

- **GIVEN** the effective binding map containing `web-find` (`webOnly`) and the split pair (`ttyOnly`)
- **WHEN** ⌘F is pressed inside the code-server iframe
- **THEN** it is NOT reclaimed (VS Code's own find keeps working)
- **AND WHEN** ⌘F is pressed inside a same-origin web-tile frame, it IS reclaimed and the find bar opens
- **AND WHEN** the split chord is pressed inside either frame, it is not reclaimed

#### R3: Predicate construction and wiring generalize from "the code surface's iframe" to any same-origin lens iframe
`app.tsx`'s reclaim predicate construction (`app.tsx:1040-1051`) SHALL generalize to a kind-aware form (e.g. a curried `(kind) => (e) => boolean` built over `hasReclaimableMatch(e, bindings, kind)`), and `SurfaceLayout` SHALL apply the kind at each iframe mount: `case "code"` passes the code-kind predicate (behavior unchanged), `case "web"` (`surface-layout.tsx:870-880`) passes the web-kind predicate into `IframeWindow`. The right-panel-era `web` surface has no separate mount — the single `renderContent` render site is the only `IframeWindow` mount in the layout, so panel-slot rendering inherits reclaim with no fork; this MUST be verified, not re-implemented.

- **GIVEN** the surface layout rendering both a `code` and a `web` tile
- **WHEN** each tile's iframe attaches its reclaim listener
- **THEN** each consults a predicate bound to its own kind, built from the one keybinding registry
- **AND** `IframeWindow` mounts anywhere in the layout (any slot, zoomed, hidden-remounted) carry the same wiring

### Web Tile: Find-in-Page (⌘F)

#### R4: `web-find` is a registry binding claimed only under web-tile focus, with palette and pointer entry points
A new `DEFAULT_BINDINGS` row SHALL ship: `actionId: "web-find"`, `code: "KeyF"`, `tier: "cmd"`, `scope: "terminal"`, `kind: "builtin"`, `webOnly: true`, `ignoreInputs: true` (a chrome-level opener — fires from the URL bar and the find input itself, the ⌘K/settings-open class). No `macTier`/`macCode` refinement: the cmd tier already yields ⌘F on mac and Ctrl+F on Win/Linux. Because the handler is `webOnly`-gated, the chord falls through to the browser's native find on every route/focus where no web tile owns focus — including terminal focus on Win/Linux, where the cmd-tier seam rule is mac-only, so plain Ctrl+F still reaches the pane (readline forward-char). Discovery surfaces: a `Web: Find in page` palette action (id `web-find` so the `withShortcutHints` join is free), registered in AppShell's `paletteActions` and shown only when the rendered layout includes an open `web` tile; and a ⌕ find button in the web tile's URL-bar row (the pointer/touch entry point). All three entry points open the find bar via one seam.

- **GIVEN** a window whose layout includes an open web tile
- **WHEN** the user presses ⌘F with the web tile focused (frame or tile), picks `Web: Find in page` from the palette, or clicks the ⌕ button
- **THEN** the find bar opens with its input focused
- **AND GIVEN** focus is anywhere else (terminal, sidebar, a non-web route), **WHEN** ⌘F/Ctrl+F is pressed, **THEN** the chord falls through untouched (native browser find, or the pane's Ctrl+F on Win/Linux terminal focus)

#### R5: Find bar UI — a row below the URL bar, per the approved design study (state 03)
When active, the find bar SHALL render as a row below the URL bar inside `IframeWindow` (`shrink-0`, matching the URL bar's border/background vocabulary), containing in order: a text input (autofocused on open), a match counter reading `n/N` with the active ordinal in accent green (`0/0` when the query has no matches), ∧ (previous) and ∨ (next) buttons, a ✕ close button, and a right-aligned key-hint `Enter next · ⇧Enter prev · Esc close` — the hint suppressed on coarse pointers per the education micro-copy rule (`useCoarsePointer()`; keyboard-chord copy never renders on touch). Input keydown handling: Enter advances to the next match, Shift+Enter to the previous (both wrap), Escape closes the bar and clears all highlights. Layout reference: `fab/changes/260819-v6y4-web-tile-browser-chrome/web-tile-chrome-design-study.html` state 03 (only the find bar row is this change's scope — the rest of that chrome belongs to sibling change v6y4).

- **GIVEN** an open find bar with query text matching 17 places, active match 3
- **WHEN** the user presses Enter
- **THEN** the counter reads `4/17`, the active-match highlight moves, and the new active match scrolls into view
- **AND WHEN** Escape is pressed, the bar closes and no highlights remain in the frame

#### R6: The find engine is parent-driven over the same-origin `contentDocument` — no script injection
A new pure module `app/frontend/src/lib/find-in-page.ts` (colocated `find-in-page.test.ts`, the `window-view.ts`/`surface-layout.ts` module contract) SHALL own: match collection — a case-insensitive TreeWalker walk over the document's text nodes producing DOM `Range`s (skipping non-rendered containers like `script`/`style`), and the match-state machine — active index, next/prev with wrap, reset. Highlight application SHALL use the CSS Custom Highlight API against the FRAME's own window (`contentWindow.CSS.highlights`) with a `<style>` element for the `::highlight()` rules placed into the frame's `<head>` — DOM manipulation from the same-origin parent, no script injected or executed in the frame. Two highlight names: all matches, and the active match (accent-green outline per the design study). The active match scrolls into view (`block: "nearest"`). Where the Highlight API is unavailable, `contentWindow.find()` is the best-effort fallback (navigation works; the `n/N` counter MAY read a dash/unknown form). All frame-DOM access carries the attach seam's try/catch posture.

- **GIVEN** a same-origin framed document containing the query text in several text nodes
- **WHEN** the search runs
- **THEN** every occurrence is highlighted in the frame, the counter reflects the total, and no `<script>` was added to the framed page
- **AND** the pure walker + state machine are unit-provable in jsdom without the Highlight API

#### R7: Cross-origin frames get a disabled find bar with an inline hint, and no reclaim
When the tile's frame is cross-origin (`contentDocument` access throws), the find bar — however opened — SHALL render disabled: input disabled, navigation buttons disabled, and the inline hint `page is cross-origin — find unavailable`. No search is attempted. Chord reclaim is likewise impossible for cross-origin frames; the existing `blur` fallback remains the only interaction signal, unchanged. (⌘F pressed while a CROSS-origin frame holds focus never reaches the parent at all — the disabled bar is reachable via the ⌕ button and the palette, which is the required affordance.)

- **GIVEN** a web tile pointed at an absolute external URL
- **WHEN** the user clicks the ⌕ button
- **THEN** the bar opens in its disabled state with the cross-origin hint and the input cannot be typed into

#### R8: Find and highlight state reset on iframe `load`
On every iframe `load` (navigation, ↻ reload, an agent re-`present`), the match state, counter, and frame highlights SHALL reset and the search term SHALL NOT persist (assumption 7 of the intake: no term persistence across navigations). The bar's open/closed state itself is not required to change.

- **GIVEN** an open find bar with active matches
- **WHEN** the frame navigates (the `load` event fires with a new document)
- **THEN** no stale highlight or count survives against the new document

### Non-Goals

- Cross-origin find via the Electron `WebContentsView` path — separate, deferred discussion.
- URL bar, reload, back/forward, error states, tile visuals — sibling change `260819-v6y4-web-tile-browser-chrome`.
- `@rk_url` substrate contract and the proxy — untouched.
- No new route, no backend, no Electron changes.

### Design Decisions

#### `webOnly` mirrors `ttyOnly` rather than generalizing to a `surface` field
**Decision**: add a sibling optional boolean `webOnly` to `KeyBinding`, and give `hasReclaimableMatch` a focused-kind parameter consulted against both flags.
**Why**: `ttyOnly` is shipped data consumed at two gate sites with tests; a second boolean is the smallest diff that keeps both gates data-driven, and no third surface-restricted binding exists to justify a generalized enum field.
**Rejected**: replacing `ttyOnly` with `surface?: SurfaceKind` — touches the shipped flag's consumers and tests for zero behavioral gain now; trivially refactorable later if a third surface restriction appears.
*Introduced by*: 260819-ie2i-web-tile-keyboard-find

#### The find-bar open seam is a document CustomEvent
**Decision**: chord handler, palette body, and any future opener dispatch a `web-find:open` CustomEvent on `document`; `IframeWindow` listens while mounted (the `window-heading:rename` / `theme-selector:open` precedent). The ⌕ button toggles locally.
**Why**: `IframeWindow` is presentational and the find bar's state belongs inside it; a CustomEvent avoids threading an imperative ref through `SurfaceLayout` for one action, and only one web tile can exist per layout (kinds don't repeat except tty), so there is no ambiguity about the receiver.
**Rejected**: a `findBarRef` threaded app.tsx → SurfaceLayout → IframeWindow (three touched signatures for one opener); lifting find state into app.tsx (drags search state into the shell for no consumer).
*Introduced by*: 260819-ie2i-web-tile-keyboard-find

#### Highlight styling enters the frame as a `<style>` element, not injected script
**Decision**: the engine registers Highlight objects on the frame window's `CSS.highlights` and appends one `<style>` with `::highlight(rk-find)` / `::highlight(rk-find-active)` rules to the frame's head, removed/replaced on reset.
**Why**: `::highlight()` pseudo-elements must be styled in the document that owns the ranges; a style element is inert DOM (no execution), which honors the intake's no-script-injection constraint while keeping the search fully parent-driven.
**Rejected**: `window.find()` as the primary (no match count, engine-inconsistent); wrapping matches in `<mark>` elements (mutates the framed page's DOM structure — breaks pages that read their own DOM, and unwinding on reset is error-prone).
*Introduced by*: 260819-ie2i-web-tile-keyboard-find

## Tasks

### Phase 1: Registry + engine foundations

- [x] T001 Add the `webOnly?: boolean` flag to `KeyBinding`, the `web-find` row to `DEFAULT_BINDINGS` (`KeyF`, `cmd`, `terminal`, `webOnly`, `ignoreInputs`), and the focused-kind parameter on `hasReclaimableMatch` in `app/frontend/src/lib/keybindings.ts`; extend `keybindings.test.ts` — kind-aware reclaim matrix (web-find reclaimed only under `web`; split pair never; unrestricted chords under both kinds), defaults still conflict-free on every host, `web-find` resolution on mac (⌘F) and Win/Linux (Ctrl+F) <!-- R2, R4 -->
- [x] T002 [P] Create `app/frontend/src/lib/find-in-page.ts` — case-insensitive TreeWalker match collection over text nodes (skip `script`/`style`), the match-state machine (active index, next/prev wrap, reset), and the guarded highlight-application half (frame-window `CSS.highlights` + `<style>` install/teardown, `window.find()` fallback, scroll-into-view) — with colocated `find-in-page.test.ts` covering the walker and state machine in jsdom <!-- R6 -->

### Phase 2: Core implementation

- [x] T003 Upgrade `IframeWindow`'s attach seam (`app/frontend/src/components/iframe-window.tsx`) to reclaiming: new optional `shouldReclaimChord` prop; the capture-phase keydown handler reports `onInteract` then, on a predicate match, prevents default, stops immediate propagation, and re-dispatches the synthetic KeyboardEvent on the parent document (mirror `code-surface.tsx:157-174`); cross-origin/blur fallback and re-attach-on-load unchanged <!-- R1 -->
- [x] T004 Add the find bar to `IframeWindow`: open/query/match state, the bar row per design-study state 03 (input autofocus, `n/N` counter with accent-green active ordinal, ∧/∨, ✕, coarse-suppressed key hint), Enter/Shift+Enter/Escape handling, the ⌕ URL-bar-row button, the `web-find:open` document CustomEvent listener, engine integration via `lib/find-in-page.ts`, cross-origin disabled state with hint, and reset-on-`load` (clear matches, highlights, and query) <!-- R5, R6, R7, R8 -->
- [x] T005 Wire the seam through the mounts: in `app/frontend/src/app.tsx` generalize the reclaim construction (`app.tsx:1040-1051`) to a kind-aware predicate factory over `hasReclaimableMatch`; in `app/frontend/src/components/surface-layout.tsx` pass the code-kind predicate to `CodeSurface` (behavior unchanged) and the web-kind predicate into `IframeWindow` at `case "web"` <!-- R3 -->
- [x] T006 In `app/frontend/src/app.tsx`: extend the dispatcher handler-map gate so `webOnly` bindings' handlers are absent unless `focusedTileKind === "web"` (beside the `ttyOnly` gate at `app.tsx:3314-3319`); register the `Web: Find in page` palette action (id `web-find`, shown only when the rendered layout includes `web`) whose body dispatches `web-find:open`; the chord resolves the same body via `fromPalette` <!-- R2, R4 -->

### Phase 3: Integration, edge cases & tests

- [x] T007 Extend `app/frontend/src/components/iframe-window.test.tsx`: reclaim attach (matching chord prevented + re-dispatched on parent document, non-matching untouched), find bar open via CustomEvent and ⌕ button, counter/next/prev/Escape behavior against a jsdom same-origin frame, cross-origin disabled state, reset-on-load <!-- R1, R5, R7, R8 -->
- [x] T008 New e2e `app/frontend/tests/web-tile-find.spec.ts` + sibling `web-tile-find.spec.md` on the real-tmux port-3020 rig (the `web-view-lens.spec.ts` `_tmux.ts` pattern, `@rk_url` via `tmux set-option -w`): (a) ⌘K opens the palette while focus is inside a same-origin web-tile frame on a `/present/`-style page; (b) ⌘F opens the find bar, a query highlights and counts matches on a presented HTML file, Enter advances `n/N`, Escape closes; (c) a cross-origin tile (absolute URL that bypasses `toProxySrc`, e.g. the `http://0.0.0.0:<port>` origin trick) shows the disabled bar + hint via the ⌕ button. Keep the flows at ≤2 tiles (the h1 connection-pool budget) <!-- R1, R4, R5, R7 -->
- [x] T009 Verify inheritance + run the gates: confirm the single `IframeWindow` render site means panel-slot/web-surface mounts inherit reclaim+find (no fork added anywhere); then `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, and the touched e2e specs via `just test-e2e "web-tile-find.spec.ts"` (plus `shortcut-registry` and `web-view-lens` if their surfaces were touched) <!-- R3 -->

## Execution Order

- T001 and T002 are independent ([P]); both block Phase 2
- T003 blocks T004 (same file, seam first); T005 needs T001+T003; T006 needs T001
- T007–T009 follow Phase 2

## Acceptance

### Functional Completeness

- [x] A-001 R1: A registry chord (⌘K) pressed with focus inside a same-origin web-tile frame opens the palette; a non-registry key reaches the framed page unchanged
- [x] A-002 R2: `hasReclaimableMatch` is kind-aware; `webOnly` gates both the reclaim predicate and the dispatcher handler map as data flags
- [x] A-003 R3: The code iframe's reclaim behavior is byte-identical to before (split pair passes through; ⌘F is NOT reclaimed there); both iframe kinds get kind-bound predicates from one construction
- [x] A-004 R4: `web-find` ships as ⌘F/Ctrl+F (cmd tier, terminal scope), with the `Web: Find in page` palette action and the ⌕ button as entry points; the palette hint renders the effective combo
- [x] A-005 R5: The find bar matches design-study state 03: input, `n/N` counter, ∧/∨, ✕, key hint; Enter/Shift+Enter cycle with wrap; Escape closes and clears
- [x] A-006 R6: Matches highlight via the frame-window Highlight API with the active match accent-outlined and scrolled into view; no script element is added to the framed document
- [x] A-007 R7: A cross-origin tile renders the disabled bar with `page is cross-origin — find unavailable`; no search is attempted

### Behavioral Correctness

- [x] A-008 R4: With no web tile focused, ⌘F falls through untouched — native browser find elsewhere in the app, and plain Ctrl+F still reaches the pane under terminal focus on Win/Linux
- [x] A-009 R1: Typing into a form inside the framed page is unaffected (only claimed chords are consumed)
- [x] A-010 R8: On iframe `load`, match state, highlights, and the search term reset

### Scenario Coverage

- [x] A-011 R1: e2e proves ⌘K while web-tile-frame-focused (scenario a)
- [x] A-012 R5: e2e proves ⌘F open → match count → Enter navigation → Escape close on a presented HTML file (scenario b)
- [x] A-013 R7: e2e proves the cross-origin disabled hint (scenario c); the new spec ships its `.spec.md` companion

### Edge Cases & Error Handling

- [x] A-014 R6: A query with zero matches renders `0/0` with navigation no-ops; an empty query clears highlights
- [x] A-015 R6: Highlight-API-unavailable environments degrade to the `window.find()` fallback without throwing; all frame access is try/catch-guarded (pre-load and cross-origin frames no-op silently)

### Code Quality

- [x] A-016 Pattern consistency: new code follows the pure-module + colocated-test convention (`find-in-page.ts`), the CustomEvent opener precedent, and the existing attach-seam idioms
- [x] A-017 No unnecessary duplication: the reclaim mechanism reuses `hasReclaimableMatch`/the CodeSurface handler shape rather than a parallel implementation; no second reclaim predicate source
- [x] A-018 Type narrowing over assertions: no `as` casts on the new seams (event/prop typing via guards)
- [x] A-019 New keyboard shortcut documented in the palette registration (`Web: Find in page` carries the id-join hint), per the project review rule

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new capability (web-tile reclaim + find-in-page) and generalizes the existing reclaim predicate in place; no existing symbol, file, or branch became redundant or unused (the report-only attach path remains the live fallback when `shouldReclaimChord` is absent).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `webOnly` boolean mirrors `ttyOnly` instead of a generalized `surface` field | Smallest diff; two shipped gate sites already consume the boolean pattern; refactorable when a third restriction appears | S:60 R:85 A:85 D:70 |
| 2 | Confident | `web-find` = `KeyF`, `cmd` tier, `terminal` scope, `ignoreInputs: true`, no mac refinement | cmd tier natively yields ⌘F/Ctrl+F; ignoreInputs matches the chrome-opener class (⌘K, settings) so the chord works from the URL bar and the find input | S:65 R:85 A:80 D:75 |
| 3 | Confident | Find-bar open seam is a `web-find:open` document CustomEvent | `window-heading:rename` precedent; at most one web tile per layout, so a single receiver is guaranteed | S:55 R:90 A:80 D:70 |
| 4 | Confident | Highlight styling via frame-head `<style>` + frame-window `CSS.highlights` | The only way to style `::highlight()` in the owning document; inert DOM honors no-script-injection | S:60 R:80 A:75 D:75 |
| 5 | Confident | On `load` the query clears too, but the bar's open state persists | Intake mandates no term persistence; keeping the bar open avoids surprising closes on agent-driven re-presents | S:55 R:90 A:75 D:65 |
| 6 | Confident | `window.find()` fallback may show a degraded counter (navigation only) | Highlight API is baseline in target browsers; the fallback is explicitly best-effort per intake assumption 5 | S:50 R:85 A:70 D:60 |

6 assumptions (0 certain, 6 confident, 0 tentative).

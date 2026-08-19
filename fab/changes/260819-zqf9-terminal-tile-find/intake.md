# Intake: Terminal Tile Find

**Change**: 260819-zqf9-terminal-tile-find
**Created**: 2026-08-19

## Origin

Conversational — the same `/fab-discuss` addon-audit session that produced `260819-shqo-terminal-tile-export`; this is the second of three approved changes (order: export → **find** → progress). The design study (`terminal-tile-addons-design-study.html`, state 01) shows the approved find-bar anatomy on the tty tile.

> Create the terminal-tile find intake: ⌘F find-in-terminal on the tty tile via @xterm/addon-search — the same find bar the web tile is getting in 260819-ie2i, extracted into a shared component, plus terminal-native case/regex toggles and overview-ruler match ticks

Key decisions from the discussion:

- **One find grammar product-wide**: the tty find bar deliberately mirrors `260819-ie2i-web-tile-keyboard-find`'s bar (input, n/N counter, ∧/∨, close, Enter/⇧Enter/Esc keys, accent-green active match) so web and terminal find feel like one feature. The user asked for "a find button that acts like the new web search being built (visually)".
- **Sequenced behind ie2i**: ie2i lands first with the find bar built in place; THIS change extracts that bar into a shared `FindBar` component consumed by both `IframeWindow` and the tty tile. The fallback (build the shared component here and have ie2i consume it) was noted but not planned for.
- Entry points: a ⌕ button on the tty tile header (left of the pane segment, beside the ⇩ export button from shqo) + ⌘F while a tty tile owns focus + a palette action.
- Scope honesty: addon-search searches the **xterm client buffer** (what streamed since attach), not tmux history. This is acceptable because shqo's "Full history" export covers the complete-record case; the find bar does not attempt server-side search.

## Why

1. **Pain point**: there is no way to search terminal output in run-kit. Long agent runs (a fab pipeline, a test sweep) scroll error details far out of view; finding "FAIL" or a filename means manual scrolling — on mobile, effectively impossible.
2. **Consequence if unfixed**: the web tile gets find (ie2i) while the product's PRIMARY surface — the terminal — stays unsearchable, an inverted priority. Keyboard-First (Constitution V) is also unserved: no keyboard path to locate text in a pane.
3. **Why this approach**: `@xterm/addon-search` (0.16.0, the 6.0.0 release train) is the upstream-maintained search over the xterm buffer with decoration support (match highlights + overview-ruler ticks) — VS Code's terminal find uses the same addon. Sharing ie2i's bar is reuse, not new architecture (code-quality: no duplicate utilities), and gives the product one find UX.

## What Changes

### 1. Shared `FindBar` component (extraction from ie2i)

Extract the find bar ie2i builds inside `iframe-window.tsx` into a shared presentational component (e.g. `app/frontend/src/components/find-bar.tsx`): text input, match counter (`n/N`), ∧/∨ prev/next, close button, key-hint text; Enter = next, ⇧Enter = previous, Escape closes. Props-driven contract: `{ query, matchIndex, matchCount, onQueryChange, onNext, onPrev, onClose, toggles? }` — the consumer owns the search mechanism (contentDocument walk for web, addon-search for tty). `IframeWindow` is refactored to consume it with zero behavior change; its e2e specs must stay green unmodified (the refactor-is-invisible proof).

### 2. Find on the tty tile

- **Addon**: `@xterm/addon-search@^0.16.0` added to `app/frontend/package.json`, statically imported and registered in `TerminalClient` alongside the existing addons (the static-import rule from the board-route dynamic-import hang).
- **Bar placement**: a row that appears below the tty tile header when active (the web tile's below-URL-row pattern), mounting the shared `FindBar`.
- **Terminal-native toggles**: two small toggles in the bar, tty consumer only — `Aa` (case sensitive) and `.*` (regex) — mapping to `ISearchOptions.caseSensitive` / `.regex`. The web consumer renders no toggles (its mechanism has no regex support planned in ie2i).
- **Decorations**: search with `decorations` enabled — match highlights in the buffer plus overview-ruler ticks on the right edge (amber matches, accent-green active match, matching the design study's state 01 and the label-color vocabulary). `findNext`/`findPrevious` drive navigation; `clearDecorations` on close/Escape and on query clear.
- **Entry points**: ⌕ header button (left of the pane segment; renders active/`on` state while the bar is open) + ⌘F + palette action `Terminal: Find`.
- **⌘F claim scope**: claimed only while a tty tile owns focus, riding the existing focused-kind machinery (`onFocusedKindChange` → app.tsx's mirrored focused kind, the `ttyOnly` gate's seam). xterm captures keydowns when the terminal is focused, so the tty claim uses `terminal.attachCustomKeyEventHandler` (or the existing keybinding tier if it already intercepts pre-xterm) to catch ⌘F before xterm swallows it; elsewhere the browser's native find is untouched.
- **Reset semantics**: match state and decorations survive scrolling; new pane output re-runs the active query (addon handles incremental refresh); closing the bar clears everything. No persistence of the query across window switches.

### 3. Buffer-scope hint

The bar's key-hint area appends a muted scope note when the search has run: matches reflect the client buffer only. Exact copy decided at apply (short, e.g. "since attach"); no server-side search is attempted (see Non-goals).

### Non-goals

- No server-side / full-history search (`capture-pane` grep) — shqo's full-history export is the complete-record path; a server search is a separate future discussion.
- No changes to the web tile's find behavior beyond the invisible extraction refactor.
- No find on chat/code lenses.
- No search-history / recent-queries UI.

## Affected Memory

- `run-kit/ui/terminal`: (modify) xterm addons list gains addon-search; find bar mechanics + decorations
- `run-kit/ui/lenses-and-layout`: (modify) tty tile header gains the ⌕ button; shared FindBar component noted where the web tile's bar is described
- `run-kit/ui/keyboard-and-palette`: (modify) ⌘F claim extended to tty-tile focus scope; `Terminal: Find` palette action
- `run-kit/ui/focus-ownership`: (modify) the focused-kind seam gains the tty ⌘F claim consumer

## Impact

- **Frontend only**: `app/frontend/src/components/find-bar.tsx` (new), `app/frontend/src/components/iframe-window.tsx` (consume shared bar — extraction refactor), `app/frontend/src/components/surface-layout.tsx` (tty header button + bar row mount), the `TerminalClient` module (addon registration, search wiring, custom key handler), keybindings/palette registries, `app/frontend/package.json`.
- **Depends on**: `260819-ie2i-web-tile-keyboard-find` landing first (the bar to extract). If ie2i has not landed when this change starts, STOP at apply entry and surface the ordering rather than forking a parallel bar.
- **Tests**: Vitest for the FindBar contract and the search-option mapping; e2e proving ⌘F opens the bar on a tty tile, finds and navigates matches in real pane output, Escape clears decorations, and the web tile's existing find specs still pass; `.spec.md` companions per constitution.

## Open Questions

- None.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Tty find mirrors ie2i's bar via a shared extracted FindBar component; one find grammar product-wide | Discussed — user explicitly asked for find "like the new web search being built (visually)"; design study state 01 approved | S:90 R:80 A:95 D:90 |
| 2 | Certain | Sequenced behind ie2i; this change extracts, never forks — apply STOPs if ie2i is unlanded | Discussed — agreed ordering (export → find → progress) with ie2i-first extraction | S:85 R:80 A:90 D:85 |
| 3 | Certain | Mechanism is @xterm/addon-search with decorations (highlights + overview-ruler ticks) | Discussed and shown in the approved study; the addon is the upstream-standard terminal search | S:85 R:80 A:95 D:90 |
| 4 | Confident | ⌘F claimed only while a tty tile owns focus, via the existing focused-kind seam + attachCustomKeyEventHandler | Same scoping ie2i assumed for web (its assumption 3); the ttyOnly gate seam already mirrors focused kind | S:60 R:80 A:80 D:75 |
| 5 | Confident | Aa / regex toggles are tty-only FindBar extras; web consumer renders none | Terminal-native capability the web mechanism lacks; shown in the study; trivially adjustable | S:55 R:90 A:80 D:75 |
| 6 | Confident | FindBar contract is props-driven with consumer-owned search mechanism | Standard extraction shape; keeps the web/tty mechanisms decoupled behind one UI | S:55 R:85 A:85 D:80 |
| 7 | Confident | Client-buffer-only scope with a muted hint; no server-side search | Discussed constraint (tmux owns history; shqo covers full record); hint copy deferred to apply | S:60 R:85 A:85 D:80 |
| 8 | Confident | addon-search imported statically, registered unconditionally | Static-import rule (board-route dynamic-import hang class); passive until used | S:60 R:90 A:85 D:80 |

8 assumptions (3 certain, 5 confident, 0 tentative, 0 unresolved).

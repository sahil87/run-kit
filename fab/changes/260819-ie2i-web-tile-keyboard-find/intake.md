# Intake: Web Tile Keyboard Reclaim + Find-in-Page

**Change**: 260819-ie2i-web-tile-keyboard-find
**Created**: 2026-08-19

## Origin

Conversational — a `/fab-discuss` session compared the Web tile against browser/webview implementations in peer tools (VS Code Simple Browser, Vibe Kanban, Cursor, Claude Code Desktop, OpenHands) and identified that run-kit sits in the iframe+proxy class, whose ceiling is same-origin scripting. The user asked for two intakes; this is the first (items 1+2 of the discussed improvement list).

> Web tile keyboard reclaim + find-in-page: wire IframeWindow into the CodeSurface chord-reclaim seam for same-origin frames, and add a find bar (⌘F) operating on contentDocument for same-origin content, disabled with hint for cross-origin

Key context established during discussion (verified against source by a code sweep):

- Once focus enters the web tile's iframe, keydowns go to the framed document and never reach the parent: the command palette (⌘K), view-cycle (⌘.), ⌘J, ⌃\` are all swallowed.
- The chord-reclaim machinery that solves exactly this **already exists and is proven for the code tile**: `hasReclaimableMatch` (`app/frontend/src/lib/keybindings.ts:423-431`), the reclaim wiring on `CodeSurface` (`surface-layout.tsx:888-902`), and the predicate construction (`app.tsx:1040-1046`, explicitly scoped to "the code surface's iframe"). `IframeWindow` instead attaches a **report-only** listener (`iframe-window.tsx:56-89`): capture-phase `pointerdown`/`keydown` on the same-origin `contentDocument`, re-attached on every `load`, plus a parent-`window` `blur` fallback for cross-origin frames — it never `preventDefault`s and never re-dispatches.
- Find-in-page does not exist anywhere in the product; the Electron shell binds no ⌘F accelerator (`app/desktop/src/menu.ts:235-284`), so in the desktop app ⌘F inside a web tile does nothing useful.
- `docs/specs/right-panel.md` § Open Question 1 posed the iframe keyboard-capture problem generally and solved it only for the code lens — the web tile is the unclaimed half of that answer.
- Same-origin coverage is the dominant use case: `/proxy/{port}/…` and `/present/@N/…` URLs (via `toProxySrc`, `iframe-window.tsx:193-201`) are same-origin with the SPA; only absolute external URLs are cross-origin.

## Why

1. **Pain point**: clicking into a web tile (a presented doc, a dev server) traps the keyboard. The app's own shortcuts die — ⌘K stops opening the palette until the user clicks out — which contradicts the Keyboard-First constitution principle (V). And there is no way to search the framed page at all: ⌘F falls through to the framed document's (usually absent) handling, and in Electron the native find never fires.
2. **Consequence if unfixed**: the web tile stays a second-class surface — users avoid keeping it open because it breaks their keyboard flow, and presented change-plans/docs (the `rk present` flow) can't be searched, which is a daily-use papercut for long documents.
3. **Why this approach**: the reclaim seam is proven on the code tile and the reviewer-facing machinery (`hasReclaimableMatch`, claimed-chord semantics) already encodes the right policy — extending it to `IframeWindow` is reuse, not new architecture (code-quality: don't duplicate existing utilities). Find-in-page is feasible precisely because the proxy makes frame content same-origin: the parent can read `contentDocument` directly, no script injection needed. Peer tools in the same architecture class (Vibe Kanban) skipped find — this is a differentiator the iframe+proxy class *can* have.

## What Changes

### 1. Chord reclaim for the web tile (same-origin frames)

Upgrade `IframeWindow`'s existing `onInteract` attach seam (`iframe-window.tsx:56-89`) from report-only to reclaiming, mirroring `CodeSurface` semantics:

- On every iframe `load`, when `contentDocument` is accessible (same-origin), attach the capture-phase `keydown` listener that consults the reclaim predicate (`hasReclaimableMatch` / `shouldReclaimChord`) and, for claimed chords only, prevents default in the frame and re-dispatches/handles in the parent — exactly the code-lens behavior.
- Wire `shouldReclaimChord` (and `onProgrammaticFocus` if applicable) through `surface-layout.tsx`'s `case "web"` tile mount (`surface-layout.tsx:870-880`), which today passes neither (`surface-layout.tsx:888-902` wires them only to `CodeSurface`).
- Generalize the predicate construction at `app.tsx:1040-1046` from "the code surface's iframe" to any same-origin lens iframe.
- Non-claimed keys MUST continue to reach the framed page untouched — typing into a form inside the frame must not change behavior.
- Cross-origin frames: no reclaim is possible; the existing `blur` fallback stays as-is.
- The right-panel `web` surface reuses the same lens renderer in the panel slot, so it inherits reclaim with no extra wiring — verify, don't fork.

### 2. Find-in-page (⌘F) for same-origin frames

A find bar in the web tile chrome (a row that appears below the URL bar when active):

- **Affordances**: text input, match counter (`n/N`), next/prev buttons; Enter = next, Shift+Enter = previous, Escape closes the bar and clears highlights. A small find button in the tile's URL-bar row provides the pointer/touch entry point; a palette action (e.g. `Web: Find in page`) provides discovery per the palette-registration review rule.
- **Binding**: ⌘F is claimed **only while a web tile owns focus** (it rides the reclaim seam from change area 1, and is additionally bound at the tile level when the tile has focus but the frame does not). When focus is anywhere else, the browser's native find is untouched.
- **Mechanism**: parent-driven search over the same-origin `contentDocument` — walk text nodes (TreeWalker/Range), highlight matches via the CSS Custom Highlight API, scroll the active match into view. (`window.find()` is the non-standard fallback if the highlight API proves insufficient; either way no script is injected into the framed page.)
- **Cross-origin frames**: the find bar renders disabled with an inline hint ("page is cross-origin — find unavailable"). No attempt to search.
- **Frame navigation/reload**: highlights and match state reset on iframe `load` (the attach seam already re-fires there).
- **Visual placement**: the find bar's layout (a row below the URL bar: input, `n/N` counter, ∧/∨, close, key-hint text; active match outlined in accent green) follows the user-approved design study checked in at `fab/changes/260819-v6y4-web-tile-browser-chrome/web-tile-chrome-design-study.html` (state 03).

### Non-goals

- No find for cross-origin external URLs (impossible from a web-served parent; the Electron `WebContentsView` path is a separate, deferred discussion).
- No changes to the URL bar, reload, back/forward, error states, or tile visuals — those are the sibling change `260819-*-web-tile-browser-chrome` (drafted alongside this one).
- No changes to the `@rk_url` substrate contract or the proxy.

## Affected Memory

- `run-kit/ui/lenses-and-layout`: (modify) IframeWindow gains the reclaim wiring and the find bar; the report-only `onInteract` description changes
- `run-kit/ui/keyboard-and-palette`: (modify) ⌘F enters the claimed-key set (web-tile-focused scope); new palette action; reclaim scope now covers web + code lenses
- `run-kit/ui/focus-ownership`: (modify) the reclaim/focus seams gain a second consumer (web tile) alongside the code lens

## Impact

- **Frontend only**: `app/frontend/src/components/iframe-window.tsx` (attach seam upgrade + find bar UI/logic), `app/frontend/src/components/surface-layout.tsx` (prop wiring for the web tile), `app/frontend/src/app.tsx` (reclaim predicate generalization), `app/frontend/src/lib/keybindings.ts` (⌘F claim, if the claimed-set is static), palette action registry.
- No backend, no Electron changes (the reclaim makes ⌘F work inside the SPA view, which covers the desktop shell too).
- **Tests**: unit tests for the find walker/highlight state machine and the reclaim predicate scope; e2e proving (a) ⌘K works while web-tile-focused on a `/present/` page, (b) ⌘F opens the bar, finds, and navigates matches on a presented HTML file, (c) cross-origin tile shows the disabled hint. Playwright specs need sibling `.spec.md` companions per constitution.

## Open Questions

- None.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Reclaim + find scoped to same-origin frames only; cross-origin gets a disabled find bar with hint and no reclaim (blur fallback unchanged) | Discussed — user approved the "1+2 as one change" scope with exactly this split; cross-origin is technically impossible from a web parent | S:90 R:85 A:95 D:90 |
| 2 | Certain | Reuse the existing chord-reclaim machinery (`hasReclaimableMatch`, the CodeSurface attach-seam pattern) rather than building a parallel mechanism | Code-quality anti-pattern rule (no duplicate utilities); the seam is proven and the right-panel spec poses this as its intended completion | S:85 R:80 A:95 D:90 |
| 3 | Confident | ⌘F is claimed only while a web tile owns focus; elsewhere native browser find is untouched | Standard scoping; keyboard-and-palette tier system supports focus-scoped claims; hijacking find app-wide would regress terminal-only windows | S:60 R:80 A:75 D:70 |
| 4 | Confident | Find bar UI: input + n/N counter + next/prev, Enter/Shift+Enter cycle, Escape closes; entry via tile button + palette action | Universal browser find-bar convention; palette registration required by project review rules | S:65 R:85 A:80 D:80 |
| 5 | Confident | Highlight mechanism: TreeWalker/Range walk + CSS Custom Highlight API, `window.find()` as fallback; no script injection | Implementation detail, easily swapped later; Highlight API is baseline-available in the browsers run-kit targets | S:50 R:80 A:60 D:50 |
| 6 | Confident | Right-panel web surface inherits reclaim + find via the shared lens renderer (verify, no fork) | right-panel spec states the panel reuses the lens renderer; inheriting is the zero-cost default | S:55 R:85 A:75 D:75 |
| 7 | Confident | Find/highlight state resets on iframe `load`; no persistence of search term across navigations | Matches browser behavior and the existing re-attach-on-load seam; persistence adds state for no discussed need | S:50 R:90 A:80 D:75 |

7 assumptions (2 certain, 5 confident, 0 tentative, 0 unresolved).

# Intake: Web Tile Iframe Click Focus

**Change**: 260815-41t9-web-tile-iframe-click-focus
**Created**: 2026-08-15

## Origin

Promptless dispatch (`/fab-proceed` create-new) from a live debugging conversation. The diagnosis was verified against the code and screenshot-confirmed before intake.

> On the terminal route's surface layout (desktop, arity > 1), clicking inside the web tile's iframe content never moves tile focus — the accent-green focused border stays on the terminal tile. The user cannot bring the web tile into focus by clicking its content (~95% of the tile's area). Screenshot-confirmed on a split-h tty|web layout with a `/present/…` page in the web tile.

Key decisions from the conversation: fix shape decided in three parts — (1) an optional `onInteract` prop on `IframeWindow` mirroring `CodeSurface`'s same-origin contentDocument listener pattern, (2) a cross-origin parent-window `blur` + `document.activeElement` fallback, (3) wiring in `surface-layout.tsx`'s `renderContent` `"web"` case exactly like the code tile, plus correcting the stale focusin claim in the comment block around surface-layout.tsx:885.

## Why

**Problem**: The focused-tile mechanism (260812-wfic R2 — accent-green border + kind glyph, the tmux active-pane metaphor) assigns focus via two seams on the tile wrapper in `app/frontend/src/components/surface-layout.tsx` (~lines 907-908):

```tsx
onPointerDownCapture={slot >= 0 ? () => focusSlot(slot) : undefined}
onFocus={slot >= 0 ? () => focusSlot(slot) : undefined}
```

Both seams are blind to clicks inside an iframe's content:

- A click inside an iframe lands in the iframe's **own document** — no `pointerdown` event reaches the parent document, capture phase or not.
- When focus enters iframe content, `document.activeElement` becomes the `<iframe>` element, but browsers dispatch **no focusin event in the parent document** — so React's `onFocus` (focusin-backed) never fires.

The code comment at surface-layout.tsx:885 asserts "clicking into the code iframe focuses the iframe element in the parent document" — i.e. that focusin covers click-to-focus. That assumption is **false** and must be corrected.

The **code tile** already solved this: `CodeSurface` (`app/frontend/src/components/code-surface.tsx`) attaches capture-phase `pointerdown`/`keydown` listeners inside its same-origin `contentDocument` after every iframe `load` and reports interaction via an `onInteract` callback, wired in `renderContent` (~line 836) as `onInteract={slot >= 0 ? () => focusSlot(slot) : undefined}`. The **web tile** (`IframeWindow`, `app/frontend/src/components/iframe-window.tsx`) has no such seam — it renders a bare `<iframe>` (~line 116). Clicking the web tile's parent-DOM chrome (URL bar, refresh button, header strip) does move focus; only in-iframe clicks — ~95% of the tile's area — are dead.

**Consequence if unfixed**: the primary interaction with the web tile (clicking its content) never updates the focused tile. The accent border lies about where focus is, and — because the focused kind feeds the shell's `ttyOnly` chord gate via `onFocusedKindChange` — keyboard-shortcut gating is driven by a stale focus state.

**Why this approach**: mirror the proven `CodeSurface` pattern rather than inventing a new mechanism — same load-event re-attach, same capture-phase listeners, same optional callback prop, same wiring shape in `surface-layout.tsx`. The cross-origin fallback (window `blur` + `activeElement === iframe`) is the standard "focus entered an iframe" detection and covers exactly the cases the contentDocument path cannot.

## What Changes

### 1. `IframeWindow` gains an optional `onInteract` seam (same-origin path)

`app/frontend/src/components/iframe-window.tsx`: add an optional `onInteract?: () => void` prop mirroring `CodeSurface`'s. After each iframe `load` event, attach capture-phase `pointerdown` and `keydown` listeners on the iframe's `contentDocument`, calling `onInteract`.

- Follow `CodeSurface`'s existing pattern precisely: re-attach on every `load` (each navigation replaces the document); guard `contentDocument` access with try/catch (cross-origin access throws — silently skip); remove listeners from the attached document on cleanup; hold the callback in a ref so the effect doesn't churn on prop identity.
- This covers the common same-origin cases: `toProxySrc` maps localhost URLs to `/proxy/<port>/…` (same origin), and `/present/…` pages are served by rk itself.
- The prop MUST be optional and behavior unchanged when omitted — `IframeWindow` is also mounted by other contexts (e.g. legacy/right-panel mounts) where no `onInteract` is passed.

### 2. Cross-origin fallback (window blur + activeElement)

External URLs pass through `toProxySrc` unchanged and render cross-origin, where `contentDocument` is inaccessible. Fallback: a parent-window `blur` listener that checks `document.activeElement === iframe` and, if so, calls `onInteract` — the standard "focus entered an iframe" detection.

- Known limitation, accepted in the conversation: window `blur` fires only when focus **leaves** the parent window; once the iframe holds focus, subsequent in-iframe clicks fire no parent events. This is acceptable — the tile is already focused at that point. Any refocus bookkeeping (so repeated cycles work after focus returns to the parent) is a design detail for the plan.
- Listener lifecycle: attach on mount, remove on unmount.

### 3. Wiring + comment fix in `surface-layout.tsx`

`app/frontend/src/components/surface-layout.tsx`:

- In `renderContent`'s `"web"` case, pass `onInteract` to `IframeWindow` exactly like the code tile:

```tsx
onInteract={slot >= 0 ? () => focusSlot(slot) : undefined}
```

- Correct the stale focus-assignment comment block (~line 885): the claim "clicking into the code iframe focuses the iframe element in the parent document" (focusin covering click-to-focus for iframes) is false — no parent-document focusin fires when focus enters iframe content. Rewrite it to state the real contract: in-iframe interaction arrives via each iframe surface's `onInteract` (contentDocument listeners same-origin, window-blur fallback cross-origin); the wrapper's `pointerdown` (capture) + focusin seams cover parent-DOM interaction only.

### Existing behavior explicitly unchanged

- The focused-kind report (`onFocusedKindChange`) feeding the shell's `ttyOnly` chord gate is existing behavior — focus moving to the web tile correctly disables tty-only shortcuts. No change to the gate; this fix just makes the report truthful for in-iframe clicks.
- `CodeSurface` is untouched (its `/code/` embed is always same-origin; it needs no blur fallback).

### Tests

Per code-quality.md, the changed behavior needs test coverage:

- `app/frontend/src/components/iframe-window.test.tsx` (exists — extend): jsdom can simulate same-origin iframe `contentDocument` listener attachment — assert `onInteract` fires on a synthetic `pointerdown` in the frame document after `load`, re-attaches after a second `load`, no-ops when the prop is omitted, and the blur-fallback path fires when `document.activeElement` is the iframe at window `blur`.
- `surface-layout` wiring: assert the `"web"` case passes `onInteract` (in `surface-layout`'s own test if wiring is asserted there, mirroring how the code-tile wiring is covered).
- E2E only via `just test-e2e` (never raw playwright); whether to add an e2e case (e.g. in `web-view-lens.spec.ts`, which drives a real same-origin `/proxy/` web tile) is decided at plan time within the e2e perf budget (plaintext origin, ≤2 tiles per flow).

## Affected Memory

- `run-kit/ui/lenses-and-layout`: (modify) § Surface Layout → Focused tile (accent state) — the focus-assignment seams list gains `IframeWindow`'s `onInteract` (contentDocument listeners + cross-origin blur fallback) alongside `CodeSurface`'s; § Iframe Window — the component's prop surface gains the optional `onInteract`.

## Impact

- **Files**: `app/frontend/src/components/iframe-window.tsx` (+ `iframe-window.test.tsx`), `app/frontend/src/components/surface-layout.tsx` (wiring + comment fix; + its test if wiring is asserted there).
- **Scale**: small — one prop + one effect in `IframeWindow`, one prop pass-through + one comment rewrite in `surface-layout.tsx`, tests.
- **No API/backend impact**: lens/focus state is frontend-only by design (no Go/API surface participates).
- **Behavior surface**: focused-tile highlight correctness on desktop multi-tile layouts; `ttyOnly` chord-gate correctness when interacting with web-tile content.
- **Verification gates** (code-quality.md): `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, then `just test` / `just build`.

## Open Questions

- None — the diagnosis is code-verified and the fix shape was decided in the originating conversation. Remaining details (blur-fallback refocus bookkeeping, e2e case inclusion) are plan-level design decisions, recorded as assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix shape: optional `onInteract` prop on `IframeWindow` with load-event re-attached capture-phase `pointerdown`/`keydown` `contentDocument` listeners, mirroring `CodeSurface` | Discussed — decided in conversation; the `CodeSurface` precedent is verified in code (code-surface.tsx:92-196) | S:95 R:85 A:95 D:95 |
| 2 | Certain | Wire the seam in `surface-layout.tsx` `renderContent` `"web"` case as `onInteract={slot >= 0 ? () => focusSlot(slot) : undefined}`, and rewrite the stale focusin comment (~line 885) | Discussed — exact wiring value given verbatim; comment falsity verified against browser focus semantics and the reproduced bug | S:95 R:90 A:95 D:95 |
| 3 | Certain | `onInteract` is optional; `IframeWindow` behavior is unchanged when the prop is omitted (other mount contexts unaffected) | Discussed — explicit constraint in the conversation; matches `CodeSurface`'s optional-prop shape | S:90 R:85 A:95 D:90 |
| 4 | Confident | Cross-origin fallback = parent-window `blur` listener checking `document.activeElement === iframe`; skipping repeated-click refocus bookkeeping is acceptable (once the iframe holds focus the tile is already focused), with any bookkeeping left as a plan design detail | Discussed — mechanism decided; the accepted-limitation reasoning was stated in the conversation, exact bookkeeping deliberately deferred to plan | S:80 R:75 A:80 D:70 |
| 5 | Certain | No change to the `ttyOnly` chord gate / `onFocusedKindChange` contract — web-tile focus disabling tty-only shortcuts is existing, correct behavior | Discussed — explicitly noted as existing behavior; confirmed in memory (lenses-and-layout § Focused tile) | S:90 R:90 A:95 D:95 |
| 6 | Certain | Test coverage: extend colocated `iframe-window.test.tsx` (jsdom same-origin contentDocument + blur-fallback + omitted-prop cases) and assert the surface-layout wiring; an e2e case is optional, decided at plan time within the ≤2-tile e2e perf budget | code-quality.md mandates tests for changed behavior and SHOULD-level e2e; jsdom feasibility stated in conversation; exact e2e inclusion left to plan | S:75 R:90 A:85 D:70 |
| 7 | Certain | `CodeSurface` is untouched — its `/code/` embed is same-origin by construction, so it needs no blur fallback | Verified in code/memory: `codeServerSrc` returns a relative path on the app origin | S:85 R:90 A:95 D:95 |

7 assumptions (6 certain, 1 confident, 0 tentative, 0 unresolved).

# Intake: Compose Strip Pane Alignment

**Change**: 260812-fryz-compose-strip-pane-alignment
**Created**: 2026-08-12

## Origin

Conversational (`/fab-discuss` session, 2026-08-12). The user observed, with a screenshot of a
tty+code split layout on the terminal route:

> The Compose text section needs be linked to the xterm window. Not full width. Right now it
> comes below the code-server editor also. Thoughts on this?

Discussion established the design below. Two later user arguments resolved the board-route
question in favor of pane-alignment everywhere:

1. **Stand-in argument**: on boards, the compose strip simply replaces the agent's own typing
   line inside the pane — and that line was always width-constrained to the pane. So a
   width-constrained compose box loses nothing.
2. **Disambiguation argument**: a full-page-width strip below a multi-pane board makes it
   non-obvious which pane the text will be sent to. Pane-alignment doubles as target
   disambiguation.

The agent's counter-considerations (live focused target, selection broadcast has no single
anchor, footer-dock refit mechanics) were accepted as **fallback cases and constraints**, not
as reasons to keep full width in the normal case.

## Why

1. **The pain point**: the compose strip (`ComposeStrip`) is docked full-width in the shell
   footer. With the surface-layout core merged (PR #569), the terminal route routinely shows
   multi-tile layouts (e.g. tty left, code-server right). A full-width strip spans below
   surfaces it does not send to — visually it claims to compose into the code editor. On the
   board route (N panes), full width gives no visual cue which pane receives the text; the only
   linkage is the small `→ {window}` header label.
2. **If we don't fix it**: the mis-scoping gets worse as more non-tty surfaces land (web, chat,
   code tiles), and board users will keep second-guessing the send target.
3. **Why this approach**: align the strip's horizontal extent to the focused terminal pane's
   measured rect, while KEEPING the shell-level footer mount. The mount location is load-bearing
   for two reasons that alternatives break: (a) the strip's target is the *live focused
   terminal* read at send time — it must survive focus moves between tiles/panes and route
   navigation, so it cannot live inside any one tile; (b) the docked strip growing the footer
   grid row is what shrinks the `1fr` content row and lets every terminal's ResizeObserver
   refit automatically (decision 260718-dhdj). Alternatives rejected: mounting the strip inside
   the tty tile (breaks selection broadcast, breaks boards, per-tile refit plumbing); keeping
   full width and only accent-highlighting the target pane (cheaper but does not address the
   actual complaint — the strip still spans under the editor).

## What Changes

All frontend (`app/frontend/src/`). No backend, no API changes.

### 1. Geometry channel: focused pane exposes its DOM container

`FocusedTerminalContext` (`src/contexts/focused-terminal-context.tsx`) currently registers
`{ wsRef, server, session, windowId, windowName? }` — **no DOM element**, so the strip has
nothing to measure today. Extend the `FocusedTerminal` type with a container ref:

```ts
export type FocusedTerminal = {
  wsRef: React.RefObject<WebSocket | null>;
  /** The focused pane's outer DOM container — measured by the compose strip
   *  for pane-aligned docking. */
  containerRef: React.RefObject<HTMLElement | null>;
  server: string;
  session: string;
  windowId: string;
  windowName?: string;
} | null;
```

Both producers register it:
- `TerminalClient` (`src/components/terminal-client.tsx`) — terminal route; registers on
  mount, clears on unmount (existing behavior, plus the new ref).
- `BoardPane` (board route, see `src/components/board/`) — registers on focus events (click,
  cycle, initial pane); keep the existing no-clear-on-focus-loss / clear-on-unmount-iff-still-
  registered semantics documented in the context header.

The ref should point at the element whose box visually IS the pane (the tile/pane container,
not the inner xterm canvas), so alignment matches what the user perceives as "the window".

### 2. Pane-aligned strip geometry

`ComposeStrip` (`src/components/compose-strip.tsx`) stays mounted where it is — the shell
footer grid area in `app.tsx` (~line 3496) and the board route's mount in
`src/components/board/board-page.tsx` (~line 1055). The footer row-growth/refit behavior is
untouched. What changes is the strip's **inner horizontal extent**:

- When a normal focused target exists, measure `focused.containerRef.current
  .getBoundingClientRect()` and apply `left`/`width` (e.g. via `margin-left` + `width`, or
  absolute inline style on an inner wrapper) so the strip's visible box sits under the focused
  pane's horizontal span. The strip's outer element keeps occupying the full footer row (so
  row-height mechanics don't change); only the visible chrome (border, background, input,
  buttons) narrows.
- **Re-measure** on: focused-target change, window resize, and pane-size changes (ResizeObserver
  on the container element; sidebar open/close and layout ratio drags change pane rects without
  a window resize). A rAF-debounced measure is fine; this is not a hot path.
- **Min-width clamp**: clamp the visible box to a minimum usable width (proposed **420px** —
  wide enough for the placeholder text, attach button, and Insert/Send cluster; see
  Assumptions) and to the viewport (never overflow). When a narrow board pane forces the clamp,
  the strip overhangs its neighbors — centered on the target pane's span where possible,
  shifted to stay inside the viewport.
- **Full-width fallbacks** (unchanged behavior):
  - **Selection broadcast mode** (`selectionTarget` prop set — multi-window frozen target,
    `Selection: Send prompt`): no single anchor exists; stay full width.
  - **No-target disabled state** (`focused === null`): stay full width.
- **Motion**: transition `left`/`width` on focus change (the slide visualizes the retarget —
  a feature, not a side effect). Under `prefers-reduced-motion`, zero the transition per the
  project's animation rules (`fab/project/context.md` § Conventions: animations are zeroed,
  static states remain).
- The `→ {window}` target label stays — it remains the textual confirmation of the target,
  and the sole indicator in the full-width fallback modes.

### 3. Mobile

On mobile (`isMobileViewport()`), the single visible pane effectively fills the content width,
so pane-aligned and full-width converge; no special-casing beyond not breaking the existing
mobile layout. Verify at 375px (project convention) that the strip does not shrink below the
clamp or overflow.

## Affected Memory

- `run-kit/ui-patterns`: (modify) compose-strip section — document pane-aligned geometry, the
  containerRef geometry channel on FocusedTerminalContext, the min-width clamp, and the
  full-width fallback modes (selection broadcast, no target).

## Impact

- `src/contexts/focused-terminal-context.tsx` — type + doc header extension.
- `src/components/terminal-client.tsx` — register containerRef.
- `src/components/board/board-pane.tsx` (or wherever BoardPane registers focus) — register
  containerRef.
- `src/components/compose-strip.tsx` — measurement + geometry application; the bulk of the
  change.
- `src/app.tsx` (~3496) / `src/components/board/board-page.tsx` (~1055) — mount sites;
  likely unchanged or minimal prop threading.
- Tests: `compose-strip.test.tsx` (unit — fallback modes, clamp math if extracted as a pure
  helper; extract the clamp/positioning computation into a pure function for unit testing),
  `tests/e2e/compose-strip.spec.ts` + companion `.spec.md` (constitution: Test Companion
  Docs) — assert the strip aligns under the focused pane on a split layout and under the
  focused board pane, and stays full-width in selection-broadcast mode. Run via `just
  test-e2e` / `just pw` only (port isolation).
- Related in-flight changes (do not conflict, but coordinate if both active):
  `260801-cyth-per-target-persistent-compose-drafts` (drafts keying),
  `260808-5zwu-selection-bulk-close-send-prompt` (selection broadcast — this change keeps its
  full-width mode intact).

## Open Questions

- None blocking. The board-route behavior (pane-aligned there too) was explicitly decided by
  the user; the exact min-width value is a Tentative assumption below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Keep the shell-level footer mount; only the strip's visible horizontal extent changes | Discussed — refit mechanics (260718-dhdj) and live-target semantics depend on the mount; user's ask is visual scoping, not re-mounting | S:85 R:80 A:90 D:90 |
| 2 | Certain | Pane-alignment applies on BOTH the terminal route and boards | Discussed — user made the stand-in + disambiguation arguments explicitly resolving the board question | S:95 R:85 A:90 D:95 |
| 3 | Certain | Selection-broadcast and no-target states stay full width | Discussed — multi-window frozen target has no single anchor; user accepted as fallback | S:85 R:85 A:90 D:90 |
| 4 | Confident | Geometry channel = extend FocusedTerminal registration with `containerRef` measured via getBoundingClientRect + ResizeObserver | Both producers already register on mount/focus; adding a ref is the minimal channel; no alternative surfaced in discussion | S:70 R:75 A:85 D:75 |
| 5 | Confident | Min-width clamp value 420px, overhang neighbors centered on target, clamped to viewport | Value not discussed — chosen to fit placeholder + attach + Insert/Send; easily tuned during apply | S:40 R:90 A:55 D:45 |
| 6 | Certain | Animate left/width on retarget; zero under prefers-reduced-motion | Discussed ("animate the slide… zero it under prefers-reduced-motion") and matches project animation rules | S:75 R:90 A:85 D:80 |

6 assumptions (4 certain, 2 confident, 0 tentative, 0 unresolved).

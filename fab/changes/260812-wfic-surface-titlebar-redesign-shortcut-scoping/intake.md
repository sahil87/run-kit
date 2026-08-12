# Intake: Surface Tile Title-Bar Redesign + tty-Scoped tmux Shortcuts

**Change**: 260812-wfic-surface-titlebar-redesign-shortcut-scoping
**Created**: 2026-08-12

## Origin

Conversational session reviewing a screenshot of a split-h Terminal|Code layout rendered by
`SurfaceLayout` (change 260812-ab5v-surface-layout-core, spec `docs/specs/surface-layout.md`).
The current tile chrome (R7) was recreated, an HTML redesign mock was produced, and the user
replied **"Agreed with all"** to the mock's spec deltas, then added one more requirement:

> "you need to restrict the tmux specific shortcuts (like Cmd+D) to the tmux tile only. Right
> now, that shortcut spills over to code-server also."

Dispatched promptless via `/fab-proceed` — decisions from the conversation are encoded below;
none required deferral (the mock deltas were approved verbatim).

A reference mock exists at
`/tmp/claude-1001/-home-sahil-code-sahil87-run-kit-worktrees-lucid-kite/451b25aa-2aa3-4e3e-95c0-c42b64b0b864/scratchpad/surface-titlebar-mock.html`
(session scratch — may not persist; the deltas in § What Changes are the binding content).

## Why

The surface-layout core shipped a deliberately slim tile chrome; in real multi-tile use it has
seven concrete problems (all identified against `surface-layout.tsx:531-583`):

1. **No visual separation between adjacent tiles' title bars** — headers share the content
   background (`bg-bg-primary`) with a single continuous `border-b`; the divider is invisible
   at rest (only hover/drag shows `bg-accent-green`). Two bars read as one strip.
2. **Verb buttons far too small** — bare glyphs with `px-0.5` (~14px hit targets) in a 24px
   (`h-6`) bar; the project's own top-bar sizing token is 28×28 (`TOP_BAR_BUTTON*` in
   `top-bar-overflow-menu.tsx`).
3. **Verbs are hover-only** (`opacity-0 group-hover:opacity-100`) — zero discoverability.
4. **No focused-tile signal** — with 2–3 tiles nothing shows which surface owns the keyboard.
5. **Header bg equals content bg**, so chrome doesn't read as chrome (the Code tile header
   visually merges with code-server's own toolbar below it).
6. **Weak label/meta hierarchy** — "Code lucid-kite" reads as one phrase.
7. **No zoom-state feedback** — the ⏶ glyph is identical zoomed and unzoomed; ◧ is cryptic.

Separately (part B), tmux-targeting keyboard shortcuts fire while the user is working inside
the code-server tile. The mechanism is grounded in code: `CodeSurface` attaches a
capture-phase keydown listener to the same-origin code-server iframe and re-dispatches any
chord matching an ENABLED registry binding to the parent document (`code-surface.tsx:73-119`);
the predicate is `reclaimChord` in `app.tsx:843-846`, which matches **all** enabled bindings
(`findMatches(e, keybindings.bindings).length > 0`). The window-level dispatcher
(`use-keybinding-dispatch.ts`, mounted at `app.tsx:3070`) then fires the handler — so ⌘D
(mac `split-horizontal`, `lib/keybindings.ts:176`) splits the tmux pane while the user is
typing in the editor, and code-server's own ⌘D (add-selection-to-next-match) never fires.
If we don't fix it, the editor tile is keyboard-hostile; if we don't fix the chrome, the
multi-tile layout stays hard to parse and mouse-hostile.

Approach: one change, because the fix for part B (a focused-tile gate) is the same new state
part A's design needs (the focused-tile accent border) — building them separately would
invent the state twice.

## What Changes

### A. Title-bar / tile chrome redesign (`surface-layout.tsx`)

All deltas approved verbatim by the user ("Agreed with all"):

1. **Framed tiles**: the tile grid becomes a `gap-[3px]` grid on `bg-bg-inset`; each tile gets
   `border border-border rounded` and keeps `overflow-hidden`. The gutter itself is the
   separation; **divider drag mechanics stay unchanged** (the absolutely-positioned dividers at
   `surface-layout.tsx:643-662` keep their hit zones over the gutter; hover/drag still floods
   `bg-accent-green`).
2. **Focused-tile state (new)**: track which tile last received pointer/keyboard focus; the
   focused tile's border goes `accent-green` (the tmux active-pane metaphor) and its kind
   glyph also turns `accent-green`. State ownership: lifted to `app.tsx` (see part B — the
   shortcut gate needs it), with `SurfaceLayout` reporting focus changes via a callback,
   preserving the presentational contract (component owns only transient interaction state).
   Focus assignment seams: pointerdown anywhere in a tile (including its header) and focus
   entering the tile's content (the code iframe gaining focus counts — a keydown arriving via
   the reclaim listener implies the code tile is focused). Default focused tile = slot A;
   when the focused tile closes, focus falls back to slot A. At arity 1 the accent highlight
   is suppressed (no ambiguity — same rule as verbs hidden on `single`).
3. **Header**: `h-6`/10px/`bg-bg-primary` → **30px (`h-[30px]`) / 11px / `bg-bg-card`**, with a
   kind glyph before the label reusing the right-rail icon vocabulary — `SURFACE_GLYPH` in
   `lib/surface-layout.ts:138-143` (`>_` tty, `◫` web, `⌸` chat, `{}` code) — the single
   shared source so rail/sheet/header never drift.
4. **Verb buttons**: 22×22 boxed buttons (26×26 on coarse pointers via the `coarse:` variant),
   **visible at rest at ~65% opacity** (replacing `opacity-0 group-hover:opacity-100`), hover
   gives `bg-bg-inset` + full opacity; the close (✕) button's hover turns `text-signal-red`; a
   1px hairline rule separates close from the safe verbs. Keep the existing `Tip` tooltip
   component for labels.
5. **Zoom feedback**: the zoom glyph becomes **⛶** and stays `accent-green` while zoomed
   (tooltip already flips Zoom/Unzoom — keep); **promote ◧ and swap ⇄ are hidden while that
   tile is zoomed** (they're no-ops there).
6. **Meta chip**: the meta text (`tileMeta` — git-root basename for code, `@rk_url` host for
   web, `surface-layout.tsx:286-299`) moves into an inset chip (`bg-bg-inset rounded px-1.5`,
   10px, truncating) clearly subordinate to the label.
7. **Status dot (tty tile)**: the tty tile header shows the agent-state dot reusing the
   existing `StatusDot` component (`components/status-dot.tsx` — the sidebar/dashboard/pane
   vocabulary: hue=phase, shape=health, waiting halo). Grounded: `WindowInfo.agentState`
   already rides the SSE window record (`src/types.ts:90`; `app.tsx:3456` uses
   `currentWindow?.agentState` for the chat busy signal), and `StatusDot` consumes a
   `WindowInfo` — so `app.tsx` passes the current `WindowInfo` (or the needed slice) to
   `SurfaceLayout` as a new prop; **no new backend/SSE plumbing**. The user approved this with
   phasing latitude ("agreed, may phase") — it ships here since the data is already present;
   if apply finds `WindowInfo` threading disproportionate, it may split to a follow-up and
   record that in the plan.

Mobile (R13) renders no header chrome — unchanged (`renderTile`'s `!mobile` branch).

### B. Scope tmux-specific shortcuts to the focused tty tile

Verbatim requirement: tmux/terminal-specific shortcuts must apply only when the tty surface is
the focused tile; global app shortcuts (palette, sidebar, navigation, view/layout toggles)
stay global. The focused-tile state from part A is the gate.

**Which chords are "tmux-specific"** (enumerated from `DEFAULT_BINDINGS`,
`lib/keybindings.ts:144-212`): exactly the pane-targeting split pair —
`split-horizontal` (mac ⌘D via `macCode: "KeyD"` + `macTier: "cmd"`; Win/Linux ⇧Ctrl+\) and
`split-vertical` (mac ⇧⌘D; Win/Linux ⇧Ctrl+−). Everything else is app/route-level and stays
ungated: `view-cycle`, `panel-toggle`, `layout-cycle`, `chat-toggle`, `compose-toggle`,
`open-last-used`, `kill-window` (window-level confirm flow, not pane-targeting),
window/session creation and navigation chords, ⌘K.

**Mechanism** (two seams, both in existing code):

1. **Registry flag**: add a data marker on the two bindings (e.g. `ttyOnly: true` on
   `KeyBinding`) so "tmux-specific" is registry data, not a hardcoded list at the gate sites.
2. **Dispatcher seam**: the `useKeybindingDispatch` handler map in `app.tsx` (handlers built
   at `app.tsx:3031-3050`, mount at `:3070`) consults the focused-tile state — a `ttyOnly`
   binding's handler is treated as absent when the focused tile is not `tty`, so the chord
   falls through untouched (rule 3 of the dispatcher contract — no `preventDefault`).
3. **Reclaim seam**: `reclaimChord` (`app.tsx:843-846`) must NOT reclaim `ttyOnly` bindings
   from the code-server iframe — a keydown arriving there means the code tile owns focus, so
   ⌘D passes through to code-server's own keybinding service (its add-next-match works again).
   Non-`ttyOnly` registry chords keep being reclaimed exactly as today.

Note the tty-side path is untouched: with focus in the xterm, `shouldRefuseTerminalChord`
(`lib/keybindings.ts:410-418`) refuses the chord from the pane so it bubbles to the window
dispatcher — with the tty tile focused, the gate passes and splits fire as today. On mobile
(single visible tile, R13) the gate is trivially satisfied by treating the visible/active
slot as focused.

**Keyboard parity (Constitution V)**: the pointer can set the focused tile, so keyboard must
too — add palette entries (e.g. `Layout: Focus Terminal/Code/Web/Chat` for open tiles),
following the ab5v amendment precedent (palette-reachable rather than new direct chords).
The split palette actions themselves (`Window: Split Horizontal|Vertical`) remain reachable
from anywhere — the gate applies to the **chords**, not the palette rows (palette invocation
is an explicit act; the spillover problem is accidental chord capture).

### C. Tests

- **Unit**: `surface-layout.test.tsx:193-197` asserts the old hover-cluster pattern
  (`opacity-0` / `group-hover:opacity-100`) — update to the rest-visible spec. New unit
  coverage for: focused-tile callback/gating predicate, `ttyOnly` registry data
  (`keybindings.test.ts`), dispatcher gating (`use-keybinding-dispatch.test.ts` or app-level),
  zoom-glyph/verb-hiding while zoomed, meta chip, status-dot presence on tty header.
- **e2e**: `tests/e2e/surface-layout.spec.ts` (370 lines) interacts with verbs via
  `tile.hover()` + accessible names (`:141-154`) — hover still works with rest-visible verbs,
  but comments/steps and any chrome-geometry assertions need updating; add specs for the
  focused-tile border and the ⌘D gate (chord fires in tty tile, does not split when the code
  tile is focused). Companion `.spec.md` updated in the same commit (constitution: Test
  Companion Docs). `code-surface.spec.ts:95` / `right-panel.spec.ts:74` use tile testids only
  — keep `surface-tile-*` testids stable. Run via `just test-e2e` / `just pw` only.

### Constraints carried from the discussion

- Presentational contract: (shape, order) layout state lives in `app.tsx`; `SurfaceLayout`
  owns only transient interaction state — the focused-tile state is lifted because part B's
  gate needs it in the shell.
- Hide-never-unmount (P3), duplicate-tty rules, divider drag mechanics, and ratio persistence
  must not regress (the flat single-array render at `surface-layout.tsx:606-641` and its
  React-key discipline stay).
- No changes to `?layout=` encoding, the ladder, or localStorage keys — chrome + gating only.

## Affected Memory

- `run-kit/ui-patterns`: (modify) surface layout manager — tile chrome (framed tiles, 30px
  header, rest-visible boxed verbs, zoom feedback, meta chip, tty status dot), the new
  focused-tile state, and the keybindings section's `ttyOnly` gating (split pair scoped to
  the focused tty tile; reclaim-predicate carve-out).

## Impact

- `app/frontend/src/components/surface-layout.tsx` — tile chrome rewrite (grid gutter, header,
  verbs, focus reporting, status dot mount).
- `app/frontend/src/app.tsx` — focused-tile state + default/fallback rules; gated handler map;
  `reclaimChord` carve-out; `WindowInfo` prop to `SurfaceLayout`; `Layout: Focus …` palette
  entries.
- `app/frontend/src/lib/keybindings.ts` — `ttyOnly` field on `KeyBinding` + the two split rows.
- `app/frontend/src/lib/palette-layout.ts` (or sibling) — focus palette actions.
- Possibly `app/frontend/src/components/status-dot.tsx` import-site only (component reused,
  not modified); `lib/surface-layout.ts` unchanged (`SURFACE_GLYPH` already shared).
- Tests: `surface-layout.test.tsx`, `keybindings.test.ts`, `use-keybinding-dispatch.test.ts`,
  `tests/e2e/surface-layout.spec.ts` + `.spec.md`; type check + `just test-e2e`.
- No backend, API, or route changes. No new localStorage keys (focused tile is transient,
  like zoom).

## Open Questions

- None — the mock deltas were approved verbatim; the shortcut enumeration and state-ownership
  decisions were delegated to intake and are recorded as graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Framed tiles: `gap-[3px]` grid on `bg-bg-inset`, per-tile `border border-border rounded` + `overflow-hidden`; divider drag mechanics unchanged | Discussed — mock delta approved verbatim ("Agreed with all") | S:95 R:85 A:90 D:95 |
| 2 | Certain | Header becomes 30px / 11px / `bg-bg-card` with a `SURFACE_GLYPH` kind glyph before the label | Approved mock delta; glyph vocabulary already shared in `lib/surface-layout.ts` | S:95 R:85 A:90 D:95 |
| 3 | Certain | Verbs become 22×22 boxed buttons (26×26 coarse), visible at rest ~65% opacity, hover `bg-bg-inset` + full opacity, ✕ hover `signal-red`, hairline before ✕, `Tip` kept | Approved mock delta | S:95 R:85 A:90 D:95 |
| 4 | Certain | Zoom glyph ⛶, `accent-green` while zoomed, tooltip flips; ◧ and ⇄ hidden while zoomed | Approved mock delta | S:95 R:90 A:90 D:95 |
| 5 | Certain | Meta moves into an inset chip (`bg-bg-inset rounded px-1.5`, 10px, truncating) | Approved mock delta | S:95 R:90 A:90 D:95 |
| 6 | Certain | Focused-tile state exists; focused tile border + kind glyph turn `accent-green` (tmux active-pane metaphor) | Approved mock delta | S:90 R:80 A:85 D:90 |
| 7 | Certain | tmux-specific chords gate on the tty tile being focused; global app chords stay global | Verbatim user requirement | S:90 R:75 A:85 D:90 |
| 8 | Certain | Mobile (R13) unchanged: no header chrome, no focus ring; the visible slot counts as focused | Mock states mobile unchanged; R13 branch renders no chrome today | S:85 R:85 A:90 D:90 |
| 9 | Confident | Focused-tile state lifts to `app.tsx` (SurfaceLayout reports via callback) rather than staying component-local | The gate consumers (`reclaimChord`, dispatcher handler map) live in app.tsx; description explicitly steered "the shortcut gate likely needs the focused state visible to the shell"; preserves the presentational contract | S:80 R:60 A:85 D:80 |
| 10 | Confident | "tmux-specific" = exactly the split pair (`split-horizontal`, `split-vertical`), marked via a registry flag (`ttyOnly`); view/layout/nav/compose/kill-window chords stay ungated | Enumerated from `DEFAULT_BINDINGS` — the split pair are the only pane-targeting chords; ⌘D is the user's named example; flag-as-data follows the registry's declarative design | S:75 R:70 A:80 D:70 |
| 11 | Confident | Two gate seams: dispatcher handler map treats `ttyOnly` handlers as absent when tty is unfocused (chord falls through, no preventDefault); `reclaimChord` stops reclaiming `ttyOnly` chords so code-server's own ⌘D works | Grounded in code reading (app.tsx:843, :3031-3070; code-surface.tsx:73-119); both paths independently deliver the chord today | S:70 R:65 A:85 D:75 |
| 12 | Confident | Status dot ships in this change: reuse `StatusDot` with the SSE `WindowInfo` passed to `SurfaceLayout`; no new plumbing; apply may split to follow-up if threading proves disproportionate | User approved with "may phase" latitude; investigation confirmed `agentState` already on `WindowInfo` (types.ts:90) and consumed in app.tsx | S:70 R:75 A:80 D:70 |
| 13 | Confident | Focus highlight suppressed at arity 1 (`single` layouts) | tmux active-pane metaphor (no highlight with one pane); mirrors the existing verbs-hidden-on-single rule | S:55 R:90 A:80 D:75 |
| 14 | Confident | Default focused tile = slot A on route entry / after the focused tile closes | Slot A is the layout model's "main" slot; cheap, trivially reversible | S:55 R:85 A:75 D:75 |
| 15 | Confident | Keyboard parity via palette entries (`Layout: Focus …`) rather than new direct chords; split palette rows stay reachable from anywhere (the gate applies to chords, not palette invocation) | Constitution V + the ab5v amendment precedent (verbs shipped palette-reachable); palette invocation is explicit, not accidental capture | S:60 R:85 A:80 D:70 |

15 assumptions (8 certain, 7 confident, 0 tentative, 0 unresolved).

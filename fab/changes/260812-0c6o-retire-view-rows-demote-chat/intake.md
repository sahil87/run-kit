# Intake: Retire View Rows, Demote Chat, Rebind Ctrl+`

**Change**: 260812-0c6o-retire-view-rows-demote-chat
**Created**: 2026-08-12

## Origin

Conversational (`/fab-discuss` session, 2026-08-12). Three user requests, made in sequence with
a screenshot of the top-bar chevron menu (VIEW section showing `View: Terminal` / `View: Code`
/ `View: Chat`, then Fixed width and Terminal font rows) and the right rail (tty/chat/code
toggles):

> Also remove the view options from this menu bar. Just the right rail and Cmd+K is enough.

> Also — the chat view is just a half built feature. Remove it from the right rail. Lets toggle
> that only from the Command Palette.

> The Ctrl+` keybinding for chat-toggle — remove it. It's a precious keybinding we can use for
> something else (suggestions? Maybe "Zoom tile"?)

Key decisions from the discussion:
- "View options" = the three `View: …` lens rows only. **Fixed width and Terminal font stay**
  as menu rows (sticky device preferences, not view switches; the rail doesn't cover them).
- Chat's rail demotion is implemented as a registry-level flag, NOT a filter inside the rail
  component, so the rail and the mobile surface sheet stay consistent and un-hiding when chat
  ships = deleting one flag (the codebase's established n2n4/oiho demote-by-flag pattern).
- Ctrl+` goes to the layout zoom toggle (tmux `prefix+z` / VS Code Ctrl+` muscle memory; zoom
  is high-frequency and currently palette-only).
- An optional severable rider — extending the board `Cmd+[`/`Cmd+]` focus-cycle chords to
  terminal-route tiles — was agreed to as "(Optional rider)"; see § What Changes 5 for its
  honest scoping.
- The rest of the surface-layout spec's Phase 3 sweep (`@rk_type` identity → hint, the `>_`
  POST retirement, snapshot option-set update, `view-cycle` retirement) is explicitly OUT of
  scope — it touches the backend and is its own change.

## Why

1. **Redundant view UI**: the surface-layout core (PR #569) made views non-exclusive tiles;
   the right rail's open-tile toggles + the ▦ layout chip + the Cmd+K palette now cover
   everything the `View: …` chevron-menu rows did. The retirement is already sentenced in
   `docs/specs/surface-layout.md` § What dies, what stays: *"The ViewSwitcher pill + `View:`
   chevron-menu rows (R4) — Dies — replaced by rail toggles + the ▦ chip."* This change
   executes the UI-only slice of that sentence.
2. **Half-built chat advertised in primary chrome**: the chat lens is incomplete (the same
   reason the ViewSwitcher pill was demoted to menu-only in 260722-n2n4), yet the rail offers
   it one click away. Demoting it to palette-only removes the advertisement without removing
   the capability. The rail's "availability + attention" role is not violated: right-panel P4
   forbids hiding *state that wants a human*, and chat has no attention channel today.
3. **A precious chord parked on the half-built feature**: Ctrl+` is one of the few chords
   proven to win over xterm focus (the interception plumbing exists for `chat-toggle`).
   Rebinding it to the layout zoom toggle serves a high-frequency transient verb that today
   requires a palette round-trip, and inherits strong muscle memory (tmux `prefix+z`, VS Code
   Ctrl+`).
4. **If we don't**: dead/duplicated affordances accumulate in the top-bar menu, users keep
   stumbling into the unfinished chat lens, and the best terminal-safe chord stays parked.

## What Changes

All frontend (`app/frontend/src/`). No backend, no API changes.

### 1. Remove the `View: …` chevron-menu rows and the ViewSwitcher

- `src/components/top-bar.tsx`: delete the `view-switcher` registry entry (first entry in
  `rightItems`, ~line 538 — `menuOnly: true, menuGroup: "view"`, rendering
  `ViewSwitcher`/`ViewSwitcherMenuRows`). Its comment already documents it as kept-but-
  unreachable pending exactly this decision.
- `src/components/view-switcher.tsx`: delete `ViewSwitcher` and `ViewSwitcherMenuRows` (and
  the file, if nothing else remains) plus the import at `top-bar.tsx:18`.
- Prune the now-unused TopBar props that existed only for the switcher (`availableViews`,
  `activeView`, `onSelectView` — verify no other registry entry reads them before pruning)
  and their threading from `app.tsx`.
- **Stays**: the `fixed-width` and `terminal-font` menu rows (`menuGroup: "view"` — the VIEW
  section header remains as long as any row occupies it); the command-palette `View: …` lens
  actions built by `buildViewActions` (`src/lib/palette-view.ts`, consumed in `app.tsx`
  `viewActions` ~line 2486) — the palette is now the only lens-switch surface, which is the
  user's stated intent ("Just the right rail and Cmd+K is enough"); the `view-cycle` chord
  (dies later, in the full Phase 3 sweep).
- Tests: top-bar unit tests asserting the `View:` rows / ViewSwitcher (search
  `view-switcher`, `ViewSwitcherMenuRows`, `View: Terminal` across `*.test.tsx` and
  `tests/e2e/*.spec.ts`); update companion `.spec.md` files where e2e steps change
  (constitution: Test Companion Docs).

### 2. Hide the chat surface from the right rail and the mobile surface sheet

- `src/lib/surface-layout.ts`: add a per-surface demotion flag — e.g.
  `export const SURFACE_RAIL_HIDDEN: ReadonlySet<SurfaceKind> = new Set(["chat"]);`
  with a comment stating the un-hide path (delete the entry when chat ships).
- **`availableTiles` is deliberately UNCHANGED** — chat remains an available surface, so the
  palette's `Layout: Add Chat` / `Layout: Close Chat` entries (`src/lib/palette-layout.ts`,
  built from the same registry) keep working. They become chat's only entry points. Do NOT
  gate `availableTiles` on the flag — that would silently remove the palette entries too.
- Consumers of the flag (filter at render, not at availability):
  - the right rail (`src/components/right-panel.tsx` — the ~38px rail rendering one toggle
    per available surface; `right-panel-rail` testid),
  - the mobile surface sheet (`src/components/mobile-surface-sheet.tsx`).
- Edge case: a chat tile already OPEN in a layout (via palette or a persisted `?layout=` /
  localStorage value) must still render and be closable — the flag hides the rail/sheet
  *toggle*, never the tile. A lit-rail-toggle for an open chat tile is NOT shown (the rail
  simply has no chat button); closing happens via the tile's ✕, `Layout: Close Chat`, or
  layout verbs.
- Tests: rail unit tests (chat button absent while web/code remain; `Layout: Add Chat` still
  present in palette actions), sheet test if one exists.

### 3. Remove the `chat-toggle` keybinding

- `src/lib/keybindings.ts:209`: delete the registry entry
  (`{ actionId: "chat-toggle", code: "Backquote", tier: "ctrl", scope: "terminal", ... }`).
- `src/app.tsx`: remove the `chat-toggle` dispatch handler (in the keybinding action map near
  the `panel-toggle`/`layout-cycle` handlers, ~line 3056) and the effective-combo hint lookup
  (`bindingByAction.get("chat-toggle")`, ~line 2516).
- `src/lib/palette-view.ts`: the `chat` half of `ViewShortcutHints` / `shortcutFor` loses its
  binding — pass an empty string for the chat hint (the file documents that an empty string
  renders no hint). Simplify `shortcutFor`/`CHAT_SHORTCUT` accordingly rather than leaving a
  dead default. Update `palette-view` unit tests.
- Check for the binding in the shortcuts overlay / cheatsheet and settings keybinding map —
  registry-driven surfaces update automatically, but any hardcoded mention must go.
- Users with a persisted override for `chat-toggle` in localStorage: stale override keys for
  unknown actionIds are ignored by the loader (verify — `parsed` entries are keyed by
  actionId; ensure an unknown id is harmless, which the existing code appears to guarantee).

### 4. Bind Ctrl+` to the layout zoom toggle

- `src/lib/keybindings.ts`: new entry, taking the freed default:
  `{ actionId: "layout-zoom", code: "Backquote", tier: "ctrl", scope: "terminal", kind: "builtin", label: "Zoom tile", description: "toggle layout zoom", mapLabel: "zoom" }`.
- `src/app.tsx`: dispatch handler calls the existing zoom seam —
  `layoutZoomToggleRef.current?.()` (ref declared ~line 814, registered by `SurfaceLayout`
  via `zoomToggleRef` prop ~line 3473, flips reported via `onZoomChange`).
- **Semantics (deliberate)**: this is the existing **slot-A zoom toggle** — the same action as
  the palette's `Layout: Zoom` / `Layout: Unzoom` entries (`src/lib/palette-layout.ts`), NOT a
  "zoom the focused tile" verb. A focused-tile zoom would require a tile-focus concept the
  terminal route does not have (see 5). Zoom is transient component state (R6) inside
  `SurfaceLayout` (`src/components/surface-layout.tsx`); a single-tile layout renders one cell
  regardless, so the chord is a visual no-op there — acceptable.
- Palette parity: the `Layout: Zoom`/`Unzoom` entries should carry the new chord as their
  shortcut hint (registry-driven via `bindingByAction.get("layout-zoom")`).
- Tests: keybindings registry test (no conflict on ctrl+Backquote after the swap — the
  conflict detector must stay green), a unit test that the chord reaches the zoom ref.

### 5. Severable rider: keyboard tile-focus cycling on the terminal route

Agreed as optional. Honest scoping discovered during drafting: boards have `focusedIndex`
(positional focus state in `board-page.tsx`), but the terminal route's `SurfaceLayout` has NO
tile-focus concept — xterm focus lives inside the tty tile and web/code tiles are iframes.
Extending `Cmd+[`/`Cmd+]` (currently `board-cycle-prev`/`board-cycle-next`, scope `board`)
to terminal-route tiles therefore requires introducing a lightweight focused-tile notion
first. Additional caveat: on macOS `go-back`/`go-forward` default to Cmd+[/] (`macTier:
"cmd"`), so a terminal-scoped tile-cycle on the same combos shadows history navigation there
(boards already made this exact tradeoff; the top-bar history arrows remain).

**Include only if a lightweight mechanism suffices** (e.g. tracking the last
clicked/promoted/zoomed slot in `SurfaceLayout`'s existing transient state). If it inflates —
new context, cross-component focus protocol — DROP the rider and file it as its own backlog
item; items 1–4 must not wait for it.

### Non-goals

- The rest of the surface-layout Phase 3 sweep: `@rk_type` identity → hint, the `>_` button's
  `POST @rk_type: null`, snapshot round-trip option-set update, retiring `view-cycle`
  (Cmd+.) and the lens model itself. Backend-touching; its own change.
- Any chat feature work; deciding a new tenant for Cmd+. (freed later by the sweep).

## Affected Memory

- `run-kit/ui-patterns`: (modify) top-bar chrome section (ViewSwitcher/`View:` rows removed),
  right-rail section (chat demotion flag + palette-only access), keybindings section
  (`chat-toggle` removed, `layout-zoom` added on ctrl+Backquote).

## Impact

- `src/components/top-bar.tsx`, `src/components/view-switcher.tsx` (likely deleted),
  `src/lib/surface-layout.ts`, `src/components/right-panel.tsx`,
  `src/components/mobile-surface-sheet.tsx`, `src/lib/keybindings.ts`,
  `src/lib/palette-view.ts`, `src/lib/palette-layout.ts` (zoom hint), `src/app.tsx`
  (prop pruning, handler swap, hint plumbing).
- Tests: top-bar / view-switcher / rail / keybindings / palette-view unit tests; e2e specs
  touching the chevron menu's `View:` rows or the rail's chat toggle, with companion
  `.spec.md` updates. Run via `just test-e2e` / `just pw` only (port isolation).
- Constitution V (keyboard-first) is preserved: every removed affordance keeps a palette
  path (`View: …` lens actions, `Layout: Add/Close Chat`), and the zoom verb GAINS a chord.

## Open Questions

- None blocking. The rider's include-or-drop condition is encoded in § What Changes 5.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Remove only the three `View: …` rows; Fixed width + Terminal font menu rows stay | Discussed and confirmed in the agreed change list ("Fixed width and Terminal font stay") | S:90 R:85 A:90 D:90 |
| 2 | Certain | Chat demotion via a registry-level flag consumed by rail + mobile sheet; `availableTiles` and palette `Layout: Add/Close Chat` unchanged | Discussed — flag approach chosen explicitly over a rail-component filter; palette is the intended sole entry point | S:90 R:85 A:85 D:85 |
| 3 | Certain | Delete `chat-toggle`; rebind ctrl+Backquote to the layout zoom toggle | Explicit user instruction; zoom endorsed by user ("Maybe Zoom tile?") and agreed in the change list | S:95 R:90 A:90 D:90 |
| 4 | Confident | Ctrl+` triggers the existing SLOT-A zoom toggle (palette `Layout: Zoom` parity), not a focused-tile zoom | Discovered during drafting: the only existing zoom seam is slot-A (`zoomToggleRef`); focused-tile zoom needs a tile-focus concept that doesn't exist — deferring that keeps the change UI-only; revisit if a tile-focus notion lands | S:60 R:85 A:80 D:65 |
| 5 | Confident | An open chat tile keeps rendering and stays closable; the flag hides only the rail/sheet toggle | Follows from "remove from the rail, toggle from the palette" — hiding an open tile would strand state | S:65 R:80 A:85 D:80 |
| 6 | Confident | Rider (tile focus cycle on Cmd+[/]) included only if a lightweight focused-slot mechanism suffices; otherwise dropped to backlog | User agreed to it as "(Optional rider)"; drafting surfaced the missing tile-focus concept and the macOS history-nav shadowing — severable with an explicit drop condition, items 1–4 never wait on it | S:45 R:85 A:55 D:45 |

6 assumptions (3 certain, 3 confident, 0 tentative, 0 unresolved).

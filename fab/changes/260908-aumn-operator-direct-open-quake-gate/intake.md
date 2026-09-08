# Intake: Operator: direct sidebar open vs. quick-terminal (quake console) access

**Change**: 260908-aumn-operator-direct-open-quake-gate
**Created**: 2026-09-08

## Origin

Dispatched from the operator chat console itself (an "Operator dispatch" routed through the running
run-kit session), carrying the user's exact words verbatim:

> "Whenever you start the operator from the left panel, don't open the quick terminal. Let the quick
> terminal be only for those cases when you are trying to open the operator from other tabs. If you
> are opening it directly from the left panel, let the operator open like a normal terminal. Whatever
> extra code you have added to catch the operator action from the left panel, maybe you can remove
> that. Essentially after this change, what happens is the operator gets two modes of access: 1.
> Directly from the left panel 2. From the quick terminal and the related UI shortcuts. When you are
> on the operator you can disable the ways to open the quick terminal, both UI-based and
> shortcut-based, because operator on operator doesn't make any sense."

One-shot dispatch, not a live conversation — the dispatching agent was instructed to investigate the
actual current behavior first (grep the sidebar operator-row handler and the console component),
confirm the exact special-casing to remove, then create this intake via `/fab-new` rather than editing
code directly. The investigation below is that confirmed read of the current code (an `Explore`
subagent pass over `app/frontend/src`), not a guess.

## Why

**The problem**: the operator chat console ("Quake Terminal", change `qa85`/PR #839, iterated on in
PRs #866/#867) is a global pull-down overlay meant for glancing at / steering the operator without
leaving the current route. Today the sidebar's own pinned operator row is wired to open THAT overlay
instead of navigating to the operator's terminal tab like every other sidebar row — so a user who
explicitly clicks the operator in the left panel, wanting to work in it as an ordinary terminal, is
instead dropped into the peek-and-steer drawer. That is backwards: the drawer's entire reason to exist
is to reach the operator from somewhere else without navigating away; when the user is already
intentionally navigating TO the operator (the sidebar row), the drawer adds a layer with no purpose.

**Consequence of not fixing it**: sidebar navigation behaves inconsistently (one row in the tree does
something structurally different from every other row for no discoverable reason), and the "peek from
elsewhere" quick-terminal metaphor is muddled by also being the direct-open path — the two use cases
collapse into one confusing entry point.

**Why this approach**: delete the sidebar row's special-case entirely (per the user's own instruction
— "whatever extra code you have added to catch the operator action from the left panel, maybe you can
remove that") so the row falls through to the SAME plain `onSelectWindow` navigation every other
sidebar row uses. This cleanly separates the two access modes the user names explicitly: (1) direct
left-panel navigation to the operator's own terminal route, (2) the quick-terminal drawer + its
shortcuts, reserved for reaching the operator from OTHER tabs. Once separated, gating away the
quick-terminal openers while the operator route is already the active view is the natural completion
— "operator on operator doesn't make any sense" is the user's own framing, and it mirrors a pattern
the console already uses elsewhere (the mobile tongue already renders a "return" state instead of
"open" when the current route IS the operator's own route — this change generalizes that same
"already there" idea to the desktop drawer's openers).

## What Changes

### 1. Sidebar pinned operator row: remove the console special-case, fall through to plain navigation

Two activation sites currently special-case `role === "operator"` and call `onOpenOperatorConsole`
instead of `onSelectWindow`:

- **Pointer click** — `app/frontend/src/components/sidebar/window-row.tsx:867-891`. Current code:
  ```tsx
  onClick={(e) => {
    if (onRowClick?.(srv, session, win.windowId, { meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey })) {
      e.preventDefault();
      return;
    }
    // The pinned operator row's plain activation opens the operator
    // console for its server rather than navigating away to the
    // operator window's tab.
    if (win.role === "operator" && onOpenOperatorConsole) {
      onOpenOperatorConsole(srv);
      return;
    }
    onSelectWindow(srv, session, win.windowId);
  }}
  ```
  **Change**: delete the `if (win.role === "operator" && onOpenOperatorConsole) { ... }` block
  entirely. The handler becomes: consult `onRowClick` first (selection gestures, unchanged), else
  always `onSelectWindow(srv, session, win.windowId)` — byte-identical to every non-operator row.

- **Keyboard Enter/Space (roving-tabindex tree)** — `app/frontend/src/components/sidebar/index.tsx:1505-1533`.
  Current code has the mirrored special-case:
  ```tsx
  if (identity.operator && onOpenOperatorConsole) {
    onOpenOperatorConsole(identity.server);
    break;
  }
  onSelectWindow(identity.server, identity.session, identity.windowId);
  ```
  **Change**: delete the `if (identity.operator && onOpenOperatorConsole)` block; Enter/Space on the
  pinned row always calls `onSelectWindow`.

- **Prop removal** — `onOpenOperatorConsole` becomes fully dead once both call sites above are gone.
  Remove the prop end-to-end, not stub it out:
  - `WindowRow`'s `onOpenOperatorConsole` prop (declared `window-row.tsx:184`, destructured `:274`)
  - Its threading through `ServerGroup` (`sidebar/index.tsx:1886`) and `Sidebar` (`:2338`, `:2418`,
    `:2939`)
  - The seam handler in `app.tsx:4355-4361`:
    ```tsx
    const handleOpenOperatorConsole = useCallback(
      (srv: string) => {
        requestOperatorConsole({ action: "open", server: srv });
        if (isMobile) setSidebarOpen(false);
      },
      [isMobile, setSidebarOpen],
    );
    ```
    and its wiring at `app.tsx:4575` (passed as `onOpenOperatorConsole={handleOpenOperatorConsole}` to
    `Sidebar`). Delete the handler and the prop pass-through. Confirm via grep that no other call site
    references `onOpenOperatorConsole` before deleting the `identity.operator` / `win.role ===
    "operator"` flags entirely IF those flags exist solely to feed this removed branch — check whether
    `identity.operator` (the roving-tabindex identity shape) is used anywhere else (e.g., rendering,
    aria) before removing it; do not remove a flag still consumed elsewhere.

  **Net effect**: clicking or Enter/Space-ing the sidebar's pinned operator row now navigates to
  `/$server/$window` for the operator window exactly like any other terminal tab — full route change,
  ordinary top-bar heading, ordinary compose strip/bottom-bar chrome, no overlay involved. This is
  access mode **(1) Directly from the left panel** in the user's own framing.

### 2. Gate the quick-terminal (drawer) openers while already on the operator's own route

**The mechanism to reuse**: "already on the operator's own terminal route" is currently computed
ad hoc, identically, in two places — `routeServer === srv && routeWindow === tgt.window.windowId` — at
`app/frontend/src/components/operator-console.tsx:290` (mobile navigation arm's idempotence guard) and
`:773-775` (mobile tongue's return-state gate). Both derive `routeServer` from the shared
`useCurrentServerFromRoute()` (`app/frontend/src/contexts/session-context.tsx:299-311`); `routeWindow`
is a locally duplicated deepest-first walk of the `window` route param at each site — there is no
shared `useCurrentWindowFromRoute()` today.

**Change**: extract this comparison into one shared hook/helper in `app/frontend/src/lib/operator-console.ts`
— e.g. `useIsOnOperatorRoute(): boolean`, built from `useCurrentServerFromRoute()` + a new (also
promoted) `useCurrentWindowFromRoute()`-shaped walk + `useOperatorConsoleContext()`'s resolved target
(`findOperatorWindow`) — so there is exactly one implementation of "is the current route the operator
window's own terminal route", consumed by:

- **The document-event listener itself** (`operator-console.tsx`'s `onRequest` handler, currently
  lines ~310-331) — on DESKTOP, when the resolved hook says "already on the operator route", every
  request action (`"toggle"`, `"open"`, `"button"`) becomes a no-op: do not call
  `setConsoleMachineState(...)`, do not apply `pinnedServer`/`pendingSend`. This is the single
  authoritative gate — defense in depth, since it fires regardless of which trigger dispatched the
  event, including any future entry point that forgets to check the route itself.
- **Top-bar ◉ button** (`OperatorConsoleButton`, `app/frontend/src/components/top-bar-overflow-menu.tsx:180-220`)
  — hide the button while on the operator's own route (mirrors the codebase's existing
  "omit-not-disable" availability pattern used elsewhere in this same feature for the no-operator-window
  case, rather than rendering it visibly inert).
- **Top-bar overflow-menu row** (`OperatorConsoleMenuRow`, same file, `:135-158`) — hidden the same way
  while on the operator's own route.
- **⌘J chord** (`app/frontend/src/app.tsx:349-358`, `"operator-console": () =>
  requestOperatorConsole({ action: "toggle" })`) — no code change needed at the dispatch site itself:
  the event still fires, but the listener's new gate (above) makes it inert while on the operator
  route. This satisfies the "shortcut-based" half of the user's request without touching the
  keybinding registry.
- **Palette action `Operator: Open console`** (`app/frontend/src/lib/palette/operator-console.ts:19-25`)
  and **the palette's Ask-operator fallback row** (gated by `shouldShowAskOperatorRow`,
  `operator-console.ts:126-129`, wired `app.tsx:466-477`) — the user's phrasing groups "the quick
  terminal and the related UI shortcuts" as one bucket; treat the palette action + fallback row as
  additional UI-based openers and gate them the same way: while on the operator's own route, hide the
  palette action row and skip the Ask-operator fallback offer (same `shouldShowAskOperatorRow`-style
  omission the no-operator-window case already uses).
- **Mobile tongue** (`operator-console.tsx:755-836`) — already correct, no change: it already renders a
  "return" state (not "operator"/open) exactly when `routeServer === server && routeWindow ===
  target.window.windowId`, i.e. it already never offers to "open the console" while already on the
  operator's own route. Extracting the shared hook MAY be used to de-duplicate the tongue's own inline
  check for consistency, but this is not required for correctness.

**What is explicitly OUT of scope for this gate**: the top-bar **omnibox**
(`app/frontend/src/components/operator-omnibox.tsx`) itself is a compose surface, not a
"browse/open the quick terminal" affordance — its own click-to-engage / Enter-to-send behavior is left
unchanged by this change. The omnibox mounts on every route (including the operator's own route) and
sending a message from it while already on the operator route is, at worst, a redundant duplicate view
of content the user is already looking at, not a broken interaction; if the apply-stage agent finds
that engaging the omnibox on the operator's own route currently force-opens the drawer in a way that
visibly conflicts with the "operator on operator doesn't make sense" goal, note it as a follow-up
rather than expanding this change's scope.

### 3. Documentation updates (memory)

Both memory files below currently describe the OLD sidebar special-case as the documented, intentional
behavior — they must be corrected as part of this change's hydrate step, not left stale:

- `docs/memory/run-kit/ui/sidebar.md` § "Operator Pinned Row" (`role === "operator"`), specifically the
  "Activation opens the operator console" bullet (current line ~282), which documents exactly the
  `onOpenOperatorConsole` seam this change deletes. Rewrite it to state the pinned row now activates
  identically to every other row (`onSelectWindow`, full navigation to `/$server/$window`) — no special
  case, on desktop or mobile.
- `docs/memory/run-kit/ui/operator-console.md`:
  - Update "Requirement: One document-event seam for every entry point" — the sidebar pinned row is no
    longer an entry point that dispatches `rk:operator-console`; remove it from the entry-point list.
  - Add a new requirement/section documenting the operator-route gate: which openers it covers (chord,
    top-bar ◉ button, overflow-menu row, palette action, palette fallback row), the shared
    detection mechanism, and that mobile's tongue already satisfied this via its pre-existing
    return-state.
  - **Also correct a pre-existing doc/code drift found during investigation, unrelated to this
    change's own scope but touching the same file**: the doc's "⌘J three-state machine" requirement
    (`rest → focused → open → rest`) describes a state that no longer exists in code — PR #866
    collapsed the machine to two states (`type ConsoleMachineState = "rest" | "open"`,
    `lib/operator-console.ts:331`, `cycleConsoleMachine` at `:359-361`) and the doc was never updated
    to match. Fix this stale description while touching this section for the gating work.

## Affected Memory

- `run-kit/ui/sidebar.md`: (modify) Operator Pinned Row's "Activation opens the operator console"
  bullet rewritten to plain navigation (no console special-case, no `onOpenOperatorConsole` seam).
- `run-kit/ui/operator-console.md`: (modify) remove the sidebar row as a `rk:operator-console` entry
  point; add the operator-route gate covering the remaining desktop openers (chord, top-bar button,
  overflow-menu row, palette action, palette fallback row); correct the stale three-state ⌘J machine
  description to the shipped two-state `rest ⇄ open` machine (PR #866 drift, found during
  investigation).

## Impact

Frontend-only (`app/frontend/src`), no backend/API changes:

- `app/frontend/src/components/sidebar/window-row.tsx` — remove click special-case, remove
  `onOpenOperatorConsole` prop
- `app/frontend/src/components/sidebar/index.tsx` — remove Enter/Space special-case, remove prop
  threading (`ServerGroup`, `Sidebar`)
- `app/frontend/src/app.tsx` — remove `handleOpenOperatorConsole` and its wiring; keep the ⌘J chord
  dispatch as-is (gate lives downstream in the listener)
- `app/frontend/src/lib/operator-console.ts` — new shared "on operator route" hook/helper (promoting
  the duplicated `routeServer === … && routeWindow === …` comparison), likely alongside a new
  `useCurrentWindowFromRoute()`-shaped helper
- `app/frontend/src/components/operator-console.tsx` — the desktop branch of the `onRequest` event
  listener gains the route-gate no-op; the mobile tongue MAY be refactored to consume the shared hook
  (optional)
- `app/frontend/src/components/top-bar-overflow-menu.tsx` — `OperatorConsoleButton` and
  `OperatorConsoleMenuRow` gain the route-based hide condition
- `app/frontend/src/lib/palette/operator-console.ts` and `app/frontend/src/hooks/use-global-palette-actions.ts`
  (or wherever the palette action's visibility is gated) — hide the `Operator: Open console` action
  while on the operator's own route
- `app/frontend/src/app.tsx` (Ask-operator fallback gate, `shouldShowAskOperatorRow` consumer at
  `:466-477`) — extend the existing gate to also omit the fallback row on the operator's own route

**Tests likely needing updates** (confirmed present during investigation):
- `app/frontend/src/components/sidebar/index.test.tsx` (~lines 3073-3109) — pinned-row activation
  tests (click, Enter/Space, "seam unwired" fallback case) must now assert plain navigation, not
  console-open; the "seam unwired" case likely collapses since the seam itself is removed
- `app/frontend/src/components/operator-console.test.tsx` — new coverage for the operator-route gate
  no-op on `toggle`/`open`/`button` requests
- `app/frontend/src/components/operator-console-button.test.tsx` and
  `app/frontend/src/components/top-bar-overflow-menu.test.tsx` — new hidden-while-on-operator-route
  coverage for the button and menu row
- `app/frontend/src/lib/palette/operator-console.test.ts` — action visibility gate coverage
- `app/frontend/src/lib/operator-console.test.ts` — new hook/helper unit coverage
- E2E: `app/frontend/tests/e2e/operator-pinned-row.spec.ts` (rewrite the "activation opens console"
  assertions to "activation navigates"), `app/frontend/tests/e2e/operator-console.spec.ts` (add
  operator-route gating coverage)

**Scale**: medium — a genuine multi-file plan (7-9 source files + memory + several test files), not a
single-spot edit, hence routed through fab rather than a direct commit.

## Open Questions

- (none blocking — see Assumptions below for the design calls made to avoid asking)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Delete the sidebar row's `onOpenOperatorConsole` special-case entirely (both click and Enter/Space sites), falling through to plain `onSelectWindow` navigation, exactly as every other sidebar row behaves. | User's own words: "whatever extra code you have added to catch the operator action from the left panel, maybe you can remove that" — explicit instruction, confirmed against the actual current code via investigation (both call sites read verbatim into this intake). One obvious interpretation; trivially reversible; codebase gives the exact answer. | S:95 R:90 A:95 D:95 |
| 2 | Certain | Remove `onOpenOperatorConsole` prop-threading end-to-end (WindowRow → ServerGroup → Sidebar → app.tsx's `handleOpenOperatorConsole`), not a no-op stub — confirmed via investigation that no other call site references it. | User explicitly asked for the extra code's removal, not its deactivation; investigation found a single call chain with no other consumers. | S:90 R:85 A:90 D:90 |
| 3 | Confident | Centralize the operator-route gate inside the console's own `rk:operator-console` document-event listener (desktop branch), as a single no-op check, rather than modifying every trigger site (chord dispatch, palette action, etc.) individually to skip firing the event. | The event-seam architecture is already the codebase's established idiom for "one crossing point, many callers" (per the console's own design decisions); gating at the single listener is defense-in-depth (covers every current AND future caller) and is the smaller, more consistent diff. Reversible via `/fab-clarify` if apply finds a per-trigger gate reads better. | S:75 R:80 A:80 D:75 |
| 4 | Confident | Hide (omit), not visibly-disable, the top-bar ◉ button, the overflow-menu row, and the palette action/fallback row while on the operator's own route. | Mirrors the codebase's own existing "omit-not-disable" pattern for the no-operator-window availability case (documented in operator-console.md's "Availability degrades to absent" requirement) — a consistent precedent already in this exact feature, not an invented one; user said "disable" but a hidden control is the more polished realization of that intent and matches the mobile tongue's precedent of changing behavior entirely rather than showing an inert control. | S:70 R:80 A:80 D:75 |
| 5 | Confident | Treat the palette action (`Operator: Open console`) and the Ask-operator fallback row as additional "UI-based ways to open the quick terminal" in scope for the gate, alongside the top-bar button/menu row and the ⌘J chord. | User's phrasing "the ways to open the quick terminal, both UI-based and shortcut-based" is broad/plural ("shortcuts" plural, "UI-based" as a category) rather than naming only the top-bar button; the palette is a UI surface that opens the exact same drawer via the exact same event action. Reasonably reversible (a palette-visibility condition is a small, isolated diff) if this reading is wrong. | S:70 R:75 A:70 D:70 |
| 6 | Confident | Scope OUT any change to the top-bar omnibox's own click-to-engage / Enter-to-send behavior — it is a compose surface, not a "browse and open the quick terminal" affordance, and is left untouched even while on the operator's own route. | The user's request is framed entirely around "opening"/"starting" the operator and "ways to open the quick terminal" — a browsing/access-mode framing — not the compose/send seam; the omnibox's own three-state-machine interactions were already substantially reworked by the prior PR #866 and re-touching them is a distinct, unscoped risk. Moderately reversible as a documented follow-up if apply finds a real conflict. | S:65 R:75 A:65 D:65 |
| 7 | Certain | `change_type: feat` — this redefines the operator's access model into two distinct, named modes (direct left-panel navigation vs. quick-terminal + shortcuts) and adds new route-aware gating behavior; it is not a pure defect fix. | Explicit in the dispatch instruction ("pin change_type appropriately") and consistent with sibling entry-model changes on this same console (`h7tx` tongue-return, `sh7y` resize/glass/paste) which were themselves pinned `feat` rather than `fix` for the same reason — an access-model change, not a correction of broken behavior. | S:85 R:90 A:90 D:85 |

7 assumptions (3 certain, 4 confident, 0 tentative, 0 unresolved).

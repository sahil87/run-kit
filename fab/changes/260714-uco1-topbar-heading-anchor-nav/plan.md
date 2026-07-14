# Plan: Top-Bar Window Heading — Stable Anchor, Hierarchy Dropdown, Window Rename, History Nav Arrows

**Change**: 260714-uco1-topbar-heading-anchor-nav
**Intake**: `intake.md`

## Requirements

All four sub-features live in the top-bar center page heading
(`app/frontend/src/components/top-bar.tsx`), a 3-column grid
`grid-cols-[1fr_auto_1fr]` (left breadcrumb · center `PageType: name` heading ·
right button cluster). The `TopBar` is mounted once at the persistent
`AppLayout`/`RootTopBar` root (above the router `<Outlet>`); its `mode` is
route-derived and its data/handler props arrive via the top-bar slot context.
No backend changes, no new routes.

### Heading: Stable Left Anchor

#### R1: The center heading's left edge is pinned by an inner min-width container
The center heading SHALL keep its outer cell centered in the grid while an inner
heading container carries a `sm:`-gated min-width with left-aligned content, so
the heading's left edge stops drifting as the instance name length changes. The
min-width applies at `sm+` only; below `sm` current behavior is unchanged.

- **GIVEN** a terminal route whose window name changes length (`abc` → `abcdefghijk`)
- **WHEN** the heading re-renders at `sm+`
- **THEN** the heading's inner container reserves at least the min-width and its
  content is left-aligned, so the left edge does not jump
- **AND** below `sm` the heading behaves as before (no reserved min-width)

#### R2: The inline-rename input is left-aligned (not centered)
The `WindowHeading` inline-rename input SHALL be left-aligned (drop `text-center`)
so the text does not jump horizontally when entering edit mode.

- **GIVEN** a terminal route window heading at rest
- **WHEN** the user clicks the name to enter inline edit
- **THEN** the input renders left-aligned, matching the resting name's anchor
  (no horizontal jump on edit entry)

### Heading: Static `Window:` Prefix (spec R4 reversal)

#### R3: The terminal-route heading prefix is a static `Window:` in all lenses
The terminal-route center heading prefix SHALL be a static `Window:` regardless
of the active view lens (tty / web / chat). The lens-following
`terminalHeadingPrefix()` and the `WEB_PREFIX`/`CHAT_PREFIX` constants are
retired; a single `WINDOW_PREFIX = "Window:"` replaces `TERMINAL_PREFIX`. Lens
indication belongs to the L1 `ViewSwitcher`, not the heading. This is a
deliberate reversal of `docs/specs/window-views.md` R4's "the center page
heading follows the lens" sentence, which SHALL be updated within this change.

- **GIVEN** a window offering tty + chat (or tty + web) lenses
- **WHEN** the viewer switches lens via the `ViewSwitcher` / `Cmd+.` / `Ctrl+\``
- **THEN** the center heading reads `Window: <name>` in every lens (the anchor
  position no longer jumps on lens switch)
- **AND** the R4 sentence in `docs/specs/window-views.md` records the reversal

### Heading: Ancestor Hierarchy Dropdown

#### R4: A hierarchy ▾ on the prefix opens the current page's ancestor chain
A small ▾ SHALL bind to the prefix word, before the colon (`Window ▾: name`),
opening a dropdown listing exactly the ancestor chain of the current page — no
lateral jumps. On a terminal (window) route the ancestors are
`Server Cabin: {server}` (→ `/{server}`) and `Cockpit` (→ `/`). The dropdown
reuses the existing `BreadcrumbDropdown`. Clicking the prefix must never enter
inline rename.

- **GIVEN** a terminal route `/{server}/{window}` at `sm+`
- **WHEN** the user opens the prefix ▾
- **THEN** the dropdown lists `Server Cabin: {server}` then `Cockpit`, and
  selecting one navigates up (no window/lateral entries)
- **AND** clicking the prefix / ▾ never starts an inline rename

#### R5: The hierarchy ▾ renders on every mode that has ancestors; the solo Cockpit gets none
The hierarchy ▾ SHALL render on the terminal, board, and root (Server Cabin)
modes (each of which has at least `Cockpit` as an ancestor), and SHALL NOT render
on the solo `Cockpit` heading (it has no ancestors). Board and root ancestor
chains list `Cockpit` (→ `/`). Below `sm` the ▾ rides with the hidden prefix
span (no hierarchy dropdown on mobile — the hamburger/sidebar covers navigation).

- **GIVEN** a board route (or a Server Cabin route) at `sm+`
- **WHEN** the user opens the prefix ▾
- **THEN** the dropdown lists `Cockpit`
- **AND** on the solo `Cockpit` heading no hierarchy ▾ renders
- **AND** below `sm` no hierarchy ▾ renders in any mode

### Heading: Browser-History Nav Arrows

#### R6: Back/Forward arrows sit left of the prefix and drive browser history
Fixed-width ◀ ▶ arrows SHALL render to the LEFT of the heading prefix, inside the
anchored center box, on ALL four page modes. They SHALL call TanStack Router's
`router.history.back()` / `.forward()` (browser history), NOT sibling-window
cycling. Being fixed-width, they do not shift the heading's text anchor (R1).
The forward disabled/dim state is best-effort only — always-active (like browser
chrome) is acceptable since `canGoForward` is not reliably exposed.

- **GIVEN** any page mode (terminal / board / root / cockpit)
- **WHEN** the user clicks ◀ (or ▶)
- **THEN** the app navigates back (forward) in browser history
- **AND** the arrows render on every mode, left of the prefix, fixed-width

### Palette Parity (Constitution V)

#### R7: History and hierarchy navigation are reachable from the command palette
New command-palette actions SHALL be added via a pure `lib/palette-*.ts` builder
with a colocated unit test: `Go: Back` / `Go: Forward` (browser history), plus
ancestor-navigation entries (e.g. `Go: Server Cabin` / `Go: Cockpit`) matching
the hierarchy dropdown's targets for the current route. No new dedicated
app-level keybindings are added beyond the palette (browser-native Alt+←/→
already cover history; avoid clobbering).

- **GIVEN** the command palette (`Cmd+K`) on a terminal route
- **WHEN** the user opens it
- **THEN** `Go: Back` and `Go: Forward` are listed and invoke history nav, and
  ancestor entries (`Go: Server Cabin`, `Go: Cockpit`) navigate up
- **AND** the visibility/target composition lives in a pure, unit-tested builder

### Testing

#### R8: Existing prefix/centering assertions are updated to the new spec; new behavior is covered
All existing tests asserting the retired `Terminal:` / `Web:` / `Chat:` prefixes
or the centered rename input SHALL be updated to the `Window:` prefix / left
alignment (tests conform to spec — constitution Test Integrity). New Playwright
e2e coverage SHALL be added for anchor stability, the `Window:` prefix, the
hierarchy dropdown navigation, and the back/forward arrows, each with its sibling
`.spec.md` companion updated in the same change. All e2e runs via
`just test-e2e` / `just pw` (port 3020).

- **GIVEN** the test suite before this change (asserts `Terminal:`/`Web:`/`Chat:`)
- **WHEN** this change lands
- **THEN** those assertions read `Window:` (or the lens is proven via
  `view-toggle`/`chat-view` presence + URL instead of the heading prefix), and
  new e2e + `.spec.md` cover the four sub-features

### Non-Goals

- The left breadcrumb's long-term fate (its redundancy with the hierarchy
  dropdown) — deferred, out of scope.
- Sibling-window cycling on the arrows — explicitly rejected (browser history only).
- Far-left brand-adjacent arrow placement — rejected (arrows sit left of the heading).
- Reliable forward-disabled state — best-effort only (`canGoForward` unavailable).

### Design Decisions

1. **Min-width + left-align over fixed-width + truncate**: the inner container
   reserves `sm:min-w-[Nch]` with `justify-start`; the outer cell stays centered.
   *Why*: user chose it; long names grow rightward (accepted). *Rejected*:
   fixed-width + truncate (hides the tail of long names).
2. **Static `Window:` prefix**: the heading identifies the substrate (window);
   the lens is shown by the `ViewSwitcher`. *Why*: substrate-vs-lens model
   (window-views.md), palette already uses `Window:` vocabulary. *Rejected*:
   keeping the lens-following prefix (the anchor jumps on lens switch).
3. **Reuse `BreadcrumbDropdown` for the hierarchy ▾**: it already provides
   items/label/title/onNavigate + shared a11y. *Why*: no new component needed.
4. **Browser-history arrows via `router.history`**: TanStack Router's
   `useRouter().history.back()/.forward()`. *Why*: predictable, global. *Rejected*:
   sibling-window cycling.
5. **Palette actions via a pure builder**: mirrors `palette-move`/`palette-view`
   /`palette-update` — pure builder + colocated `.test.ts`, thin wiring in
   `app.tsx`. *Why*: unit-testable gating without mounting the shell.

## Tasks

### Phase 1: Prefix Rename + Stable Anchor (top-bar.tsx)

- [x] T001 Replace `TERMINAL_PREFIX`/`WEB_PREFIX`/`CHAT_PREFIX` with a single `WINDOW_PREFIX = "Window:"` constant and remove `terminalHeadingPrefix()`; pass the static `WINDOW_PREFIX` into `WindowHeading` (drop the `activeView`-derived prefix at the `<WindowHeading … prefix={…} />` call site in the center cell). Keep `BOARD_PREFIX`/`CABIN_PREFIX`/`COCKPIT_SOLO` unchanged. In `app/frontend/src/components/top-bar.tsx`. <!-- R3 -->
- [x] T002 Left-align the inline-rename `<input>` in `WindowHeading`: replace `text-center` with a left alignment on the input's className (`app/frontend/src/components/top-bar.tsx`, ~line 1049). <!-- R2 -->
- [x] T003 Add the stable left anchor: give the center cell's inner heading container a `sm:`-gated min-width + left-aligned content (`sm:min-w-[Nch]` + `justify-start`) while the outer `flex … justify-center` cell stays centered. Apply uniformly so it holds across all four modes. Starting value `28ch` (§ Assumptions #2), accounting for `Window: ` being 2ch shorter than `Terminal: `; tune visually. In `app/frontend/src/components/top-bar.tsx` (center cell ~line 343). <!-- R1 -->

### Phase 2: History Arrows + Hierarchy Dropdown (top-bar.tsx)

- [x] T004 Add a `HistoryNav` sub-component rendering fixed-width ◀ ▶ buttons wired to `useRouter().history.back()` / `.forward()` (TanStack Router), styled like the existing top-bar icon buttons (`rk-glint`, `coarse:` touch sizing, `aria-label`s). Render it at the LEFT of the heading prefix inside the center box on ALL four modes. Forward is always-active (best-effort dim only if trivially derivable). In `app/frontend/src/components/top-bar.tsx`. <!-- R6 -->
- [x] T005 Add a `HierarchyDropdown` sub-component reusing `BreadcrumbDropdown` (bare-▾ trigger, `title="Navigate up"`), whose items are the current page's ancestor chain — terminal: `Server Cabin: {server}` (→ `/{server}`) + `Cockpit` (→ `/`); board & root: `Cockpit` (→ `/`); solo cockpit: not rendered. Bind it to the prefix, before the colon, in each mode branch of the center cell; hide it below `sm` (rides with the hidden prefix span). Ensure clicking it never enters inline rename (it is a sibling of the rename button, like the existing window ▾). In `app/frontend/src/components/top-bar.tsx`. <!-- R4 R5 -->

### Phase 3: Palette Parity (pure builder + app.tsx wiring)

- [x] T006 Create a pure builder `app/frontend/src/lib/palette-nav.ts` exporting `buildNavActions(...)` that returns the history actions (`Go: Back`, `Go: Forward`) and the route-appropriate ancestor actions (`Go: Server Cabin`, `Go: Cockpit`) as `{ id, label, onSelect }[]`, gated by route context (ancestors present) — action bodies are thin wrappers passed in by the caller. Mirror `lib/palette-view.ts`'s shape. <!-- R7 -->
- [x] T007 [P] Add `app/frontend/src/lib/palette-nav.test.ts` unit-testing `buildNavActions` gating/label composition (history always present; ancestor entries only when applicable; correct targets per route). <!-- R7 -->
- [x] T008 Wire `buildNavActions` into `app/frontend/src/app.tsx`'s palette (a `navActions` `useMemo`, added to the `paletteActions` composition array), passing `router.history.back/forward` and `navigate(...)` bodies for the ancestor targets. Import `useRouter` from `@tanstack/react-router` for the history handle. <!-- R7 -->

### Phase 4: Tests + Spec Reversal

- [x] T009 Update `docs/specs/window-views.md` R4: replace the sentence "The center page heading follows the lens: `Terminal: <window>`, `Web: <window>`, `Chat: <window>`, `Desktop: <window>`." with the static-`Window:` reversal note (heading identifies the substrate; lens indication is the switcher's job). Leave the rest of R4 (switcher chip, palette parity, shortcut) intact. <!-- R3 -->
- [x] T010 Update the unit tests asserting the retired prefixes to `Window:`: `app/frontend/src/components/top-bar.test.tsx` (the `renders a static \`Terminal:\` prefix sibling …` test and the solo-cockpit "no `Terminal:` prefix" assertion). Verify `app/frontend/src/app.test.tsx` needs no change (its `Terminal:` mention is a stale comment, not a live assertion). <!-- R8 -->
- [x] T011 Update the e2e prefix assertions to the new spec and their `.spec.md` companions in the same change: `tests/e2e/window-heading.spec.ts` (+`.spec.md`) — `Terminal:` → `Window:`; `tests/e2e/web-view-lens.spec.ts` (+`.spec.md`) — `Web:` assertion → `Window:` (lens still proven by the web chip/iframe); `tests/e2e/chat-view.spec.ts` (+`.spec.md`) — `Terminal:`/`Chat:` heading assertions → `Window:` (lens proven via `view-toggle`/`chat-view` presence + `?view=` URL, which already accompany each assertion). In `app/frontend/`. <!-- R8 -->
- [x] T012 Add new Playwright e2e coverage for the four sub-features with a sibling `.spec.md`: (a) anchor stability across name lengths at `sm+`; (b) the static `Window:` prefix persists across a lens switch; (c) the hierarchy ▾ lists ancestors and navigates up (terminal → Server Cabin / Cockpit); (d) the ◀ ▶ arrows drive browser history. Prefer extending `tests/e2e/window-heading.spec.ts` (+`.spec.md`) to reuse its session lifecycle; run via `just pw` / `just test-e2e` (port 3020). <!-- R8 R1 R4 R6 -->

## Execution Order

- Phase 1 (T001–T003) is the prefix + anchor foundation; T001 must precede the test updates in T010/T011.
- Phase 2 (T004, T005) depends on the center-box structure from Phase 1 (the arrows sit inside the anchored box; the ▾ binds to the prefix).
- Phase 3: T006 blocks T007 and T008; T007 is `[P]` with T008.
- Phase 4: T009 (spec) is independent. T010/T011 depend on T001–T005 (assert the shipped behavior). T012 depends on T001–T005.

## Acceptance

### Functional Completeness

- [x] A-001 R1: At `sm+`, the center heading's inner container reserves a min-width with left-aligned content while the outer cell stays centered; the heading's left edge does not drift as the window name length changes. Below `sm`, behavior is unchanged.
- [x] A-002 R2: The inline-rename input renders left-aligned (no `text-center`); entering edit mode causes no horizontal text jump.
- [x] A-003 R3: The terminal-route heading reads `Window:` in all lenses; `terminalHeadingPrefix()`, `WEB_PREFIX`, `CHAT_PREFIX` are gone, replaced by a single `WINDOW_PREFIX`.
- [x] A-004 R4: The prefix ▾ opens a dropdown listing exactly the current page's ancestors (terminal: `Server Cabin: {server}` + `Cockpit`), navigation works, and clicking the prefix/▾ never enters inline rename.
- [x] A-005 R5: The hierarchy ▾ renders on terminal/board/root (board & root list `Cockpit`), is absent on the solo Cockpit, and is absent below `sm` in all modes.
- [x] A-006 R6: Fixed-width ◀ ▶ arrows render left of the prefix inside the anchored center box on all four modes and invoke `router.history.back()`/`.forward()` (not sibling cycling).
- [x] A-007 R7: `Go: Back` / `Go: Forward` and the route-appropriate ancestor entries (`Go: Server Cabin` / `Go: Cockpit`) are present in the command palette and navigate correctly.

### Behavioral Correctness

- [x] A-008 R3: Switching lens (tty↔web↔chat) leaves the heading reading `Window: <name>` — the anchor no longer jumps on a lens switch — and the `ViewSwitcher` remains the lens indicator.
- [x] A-009 R6: The arrows' fixed width means the heading's text anchor (A-001) is unaffected by their presence.

### Removal Verification

- [x] A-010 R3: No references to `terminalHeadingPrefix`, `WEB_PREFIX`, `CHAT_PREFIX`, or `TERMINAL_PREFIX` remain in `top-bar.tsx` (grep-clean); the `docs/specs/window-views.md` R4 lens-following sentence is replaced with the reversal note.

### Scenario Coverage

- [x] A-011 R8: New Playwright e2e exercises anchor stability, the `Window:` prefix across a lens switch, hierarchy-dropdown navigation, and the back/forward arrows; every touched `.spec.ts` has its `.spec.md` companion updated in the same change (constitution Test Companion Docs).
- [x] A-012 R8: Pre-existing prefix/centering assertions (`window-heading`, `web-view-lens`, `chat-view` e2e; `top-bar.test.tsx`) are updated to the `Window:`/left-aligned spec and pass.

### Edge Cases & Error Handling

- [x] A-013 R5: Below `sm`, no hierarchy ▾ renders (rides with the hidden prefix span) and the 375px top bar stays single-line with no horizontal overflow.
- [x] A-014 R6: Forward arrow always-active (best-effort dim) is acceptable — clicking it with no forward history is a harmless no-op (browser-chrome semantics).

### Code Quality

- [x] A-015 Pattern consistency: New code follows the surrounding top-bar conventions (icon-button styling `rk-glint`+`coarse:` sizing, `BreadcrumbDropdown` reuse, pure `lib/palette-*.ts` builder + colocated unit test, type narrowing over assertions).
- [x] A-016 No unnecessary duplication: The hierarchy dropdown reuses `BreadcrumbDropdown` (not a new component); the palette builder mirrors the existing `palette-*` pattern; no new keybindings duplicate browser-native history.
- [x] A-017 Minimal surface (Constitution IV): No new routes and no new backend surface are added — the change is affordances on the existing top bar.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- The `ch` min-width value is monospace-exact; tune visually across all four modes during T003.
- After the `Window:` reversal, the chat/web e2e specs can no longer distinguish lenses by the heading prefix — they distinguish via `view-toggle`/`chat-view`/iframe presence + the `?view=` URL (which those tests already assert alongside the prefix).

## Deletion Candidates

- `WindowHeading` prefix-flip replay machinery (`prevPrefixRef` + the prefix-keyed effect, `app/frontend/src/components/top-bar.tsx` ~:1053 and :1108–:1114) — the sole call site now passes the constant `WINDOW_PREFIX`, so the lens-switch prefix-change branch can never fire; the `prefix` prop itself is now a single-constant pass-through that could be inlined.
- `buildNavActions` `"board"`/`"cockpit"` `NavMode` values (`app/frontend/src/lib/palette-nav.ts`) — no production call site passes them (AppShell only passes `terminal`/`root`); either wire `buildNavActions("board", …)` into `boardRouteActions` (board-page.tsx, the dual-mount pattern used by `buildUpdateActions`/`buildMaintenanceActions`) to make them live, or narrow the type domain.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Stable anchor = centered outer cell + inner container `sm:min-w-[Nch]` + left-aligned content (min-width over fixed-width+truncate) | Intake #1 — user explicitly chose min-width; long-name rightward growth accepted | S:95 R:85 A:90 D:95 |
| 2 | Confident | Starting min-width `28ch`, tuned visually across all four modes; `Window: ` is 2ch shorter than `Terminal: ` | Intake #2 — exact value delegated to visual tuning; narrow band, easily adjusted | S:70 R:95 A:75 D:60 |
| 3 | Certain | Min-width gated at `sm+` only; below `sm` unchanged | Intake #3 — prefix span already `hidden sm:inline`; space scarce at 375px | S:90 R:90 A:90 D:90 |
| 4 | Certain | Inline-rename input left-aligned (drop `text-center`) | Intake #4 — required so text doesn't jump on edit entry | S:95 R:95 A:95 D:95 |
| 5 | Certain | Single `WINDOW_PREFIX = "Window:"` in all lenses; `terminalHeadingPrefix()`/`WEB_PREFIX`/`CHAT_PREFIX` retired; R4 reversal recorded in window-views.md this change | Intake #5 — substrate-vs-lens rationale; palette uses `Window:` vocabulary | S:95 R:80 A:90 D:90 |
| 6 | Certain | Hierarchy ▾ binds to the prefix before the colon; contents = ancestors only; terminal lists `Server Cabin: {server}` + `Cockpit` | Intake #6 — approved mockup; lateral jumps excluded | S:90 R:85 A:85 D:85 |
| 7 | Confident | Hierarchy ▾ renders on terminal/board/root (board & root list `Cockpit`); solo `Cockpit` gets none | Intake #7 — "ancestor chain of current page" + mockup rendering `◀ ▶ Cockpit` with no ▾ | S:55 R:85 A:70 D:55 |
| 8 | Certain | No hierarchy dropdown below `sm` — ▾ rides with the hidden prefix span | Intake #8 — explicitly accepted; hamburger/sidebar covers mobile nav | S:90 R:90 A:90 D:90 |
| 9 | Certain | Arrows = browser history (`useRouter().history.back()/.forward()`, TanStack Router), NOT sibling cycling | Intake #9 — user clarified directly | S:100 R:85 A:95 D:95 |
| 10 | Certain | Arrows left of the prefix inside the anchored center box, fixed-width, on all four modes | Intake #10 — approved mockup; far-left placement rejected | S:95 R:85 A:90 D:90 |
| 11 | Certain | Forward disabled/dim best-effort only; always-active acceptable | Intake #11 — `canGoForward` not reliably exposed | S:90 R:95 A:85 D:90 |
| 12 | Confident | Palette entries `Go: Back`/`Go: Forward` + ancestor entries via a pure `lib/palette-nav.ts` builder + colocated test; no new app-level keybindings | Intake #12 — Constitution V requires palette reachability; browser natives cover history | S:60 R:90 A:70 D:55 |
| 13 | Confident | Reuse `BreadcrumbDropdown` for the hierarchy dropdown | Intake #13 — existing component provides items/label/title/onNavigate + a11y | S:50 R:95 A:85 D:70 |
| 14 | Certain | Playwright e2e for the new behaviors + sibling `.spec.md`, via `just test-e2e`/`just pw` (port 3020) | Intake #14 — code-quality SHOULD + constitution Test Companion Docs MUST | S:85 R:90 A:95 D:95 |
| 15 | Certain | Existing `Terminal:`/`Web:`/`Chat:` prefix + centered-alignment assertions updated to the new spec (not preserved) | Intake #15 — constitution Test Integrity; sites enumerated in Impact | S:70 R:90 A:90 D:80 |

15 assumptions (11 certain, 4 confident, 0 tentative).

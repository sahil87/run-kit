# Plan: Full-Width Topbar as Navbar

**Change**: 260702-6m46-full-width-topbar-navbar
**Intake**: `intake.md`

## Requirements

### Shell: Full-Width Topbar Grid

#### R1: Desktop topbar spans both columns
The desktop Shell grid MUST place the topbar across both columns so it spans full width, with the sidebar occupying rows 2–3 (content + bottombar) only. `gridTemplateColumns`, `gridTemplateRows`, and the 150ms collapse transition MUST be unchanged. The mobile branch and drawer overlay (grid rows `2 / 4`) MUST be untouched.

- **GIVEN** the app renders in a Shell at desktop width (≥ 640px)
- **WHEN** the grid style is computed
- **THEN** `gridTemplateAreas` is `"topbar topbar" "sidebar content" "sidebar bottombar"`
- **AND** `gridTemplateColumns` stays `${sidebarWidth}px 1fr` (open) / `0 1fr` (collapsed) and `gridTemplateRows` stays `auto 1fr auto`
- **AND** at mobile width the single-column areas (`"topbar" "content" "bottombar"`) and the overlay are unchanged

#### R2: Shell topology comment matches the new grid
The ASCII topology comment in `shell.tsx` MUST be updated so the documented desktop `grid-template-areas` matches the implemented full-width-topbar topology.

- **GIVEN** a reader inspects the `Shell` doc comment
- **WHEN** they read the desktop topology block and the `grid-template-areas` line
- **THEN** both describe the topbar spanning both columns above a rows-2–3 sidebar

### TopBar: Instance-Name Navbar

#### R3: Brand is the left-most root crumb
The brand (logo icon + "Run Kit" wordmark) MUST render as the left-most element of the topbar as a single `<a href="/">`, reusing the existing responsive image pair (icon always visible; wordmark `hidden sm:inline`). The former right-side "Run Kit" anchor MUST be removed.

- **GIVEN** any route rendering the TopBar
- **WHEN** the topbar renders
- **THEN** the first element in the left nav is an `<a href="/">` containing the icon and (≥ sm) the "Run Kit" wordmark
- **AND** there is no "Run Kit" anchor in the right-hand control cluster

#### R4: Hamburger sits between brand and crumbs, only where a sidebar exists
On routes that have a sidebar (terminal, server-cabin/`root`, board) the hamburger sidebar toggle MUST render between the brand crumb and the first breadcrumb. It MUST NOT render in cockpit mode (the Cockpit has no sidebar).

- **GIVEN** a terminal / server-cabin / board route
- **WHEN** the topbar renders
- **THEN** the hamburger (`aria-label="Toggle navigation"`) appears after the brand and before the crumbs
- **AND** **GIVEN** cockpit mode **THEN** no hamburger renders

#### R5: Server crumb — link vs. current-page leaf
A server crumb MUST render for server-cabin (`root`) and terminal modes using the full server name. When a `$window` is present (terminal), the server crumb MUST be a plain link navigating to `/$server`. When no `$window` is present (server-cabin leaf), the server crumb MUST be non-link text carrying `aria-current="page"`. This replaces the literal "Dashboard" label, which MUST NOT appear anywhere.

- **GIVEN** the terminal route (`server`, `$window` present)
- **WHEN** the topbar renders
- **THEN** a server-name link to `/$server` renders before the session crumb
- **AND** **GIVEN** the server-cabin route (no `$window`) **THEN** the server name renders as `aria-current="page"` non-link text and no "Dashboard" text exists
- **AND** the literal string "Dashboard" is absent in every mode

#### R6: Session and window crumbs keep dropdown behavior
The session and window crumbs MUST keep their existing `BreadcrumbDropdown` behavior unchanged: session switch jumps to the session's first window, window switch navigates to the window id, and the `+ New Session` / `+ New Window` actions are preserved. The session-crumb `max-w-[7ch] truncate` styling MAY stay.

- **GIVEN** a terminal route with session + window
- **WHEN** the user opens the session or window dropdown and picks an item or a `+ New` action
- **THEN** navigation / creation behaves exactly as before this change

#### R7: Separator is `›` (U+203A)
The breadcrumb separator MUST be `›` (U+203A) rendered as `aria-hidden`, replacing the previous `/` separator. It MUST appear between crumb levels (after the hamburger before the first content crumb where a content crumb exists, and between server/session/window crumbs).

- **GIVEN** any multi-crumb route
- **WHEN** the topbar renders
- **THEN** crumb levels are separated by `›` (U+203A), and no `/` text separator remains
- **AND** each separator is `aria-hidden`

#### R8: Board mode composition
Board mode MUST render brand + hamburger + `›` + the existing `BoardModeBreadcrumb`, whose internal `Board ▸ {name} ▾ …` rendering is unchanged. Board mode MUST keep hiding the connection dot.

- **GIVEN** the board route
- **WHEN** the topbar renders
- **THEN** brand, hamburger, a `›` separator, and the existing `BoardModeBreadcrumb` render in order
- **AND** no connection dot renders

#### R9: Mobile collapse to brand icon + leaf crumb
At `< sm` the brand MUST collapse to the bare icon and intermediate crumbs MUST be hidden, showing only brand icon + the leaf crumb (leaf = window dropdown on terminal, server name on server-cabin, board name on board). The topbar MUST remain a single line at 375px.

- **GIVEN** a viewport `< sm`
- **WHEN** the topbar renders on a terminal route
- **THEN** the wordmark and intermediate crumbs (server, session) are hidden and only the icon + window leaf crumb show
- **AND** the topbar is a single line at 375px

### TopBar: Right Cluster

#### R10: Connection dot is right-most and cockpit-excluded
With the brand anchor removed, the connection dot MUST become the right-most element of the right cluster. Its render condition MUST exclude both `board` and `cockpit` modes (it stays for `terminal` and `root`). The route-agnostic controls (`FixedWidthToggle`, `NotificationControl`, `ThemeToggle`) keep their order; the icon-ordering comment block MUST be rewritten to match the anchor-less reality.

- **GIVEN** a terminal or server-cabin route
- **WHEN** the right cluster renders
- **THEN** the connection dot is the last (right-most) element
- **AND** **GIVEN** board or cockpit mode **THEN** no connection dot renders
- **AND** the ordering comment no longer references a "Run Kit anchor"

### TopBar: Cockpit Mode

#### R11: New `cockpit` TopBar mode
`TopBarMode` MUST gain a `"cockpit"` value alongside `"terminal" | "board" | "root"`. In cockpit mode the TopBar MUST render brand crumb only — no hamburger, no connection dot, no terminal-font control, no split/close buttons — while keeping `FixedWidthToggle`, `NotificationControl`, and `ThemeToggle`. Session/server-dependent props MUST tolerate the Cockpit context (empty sessions, empty server).

- **GIVEN** `mode="cockpit"` with empty sessions and empty server
- **WHEN** the topbar renders
- **THEN** it renders the brand link and the three route-agnostic controls, and renders no hamburger, no connection dot, no terminal-font control, no split/close buttons
- **AND** no runtime error occurs from the empty session/server props

#### R12: Cockpit adopts the shared TopBar
`ServerListPage` MUST replace its ad-hoc `<header>` (logo + "Run Kit" span) with `<TopBar mode="cockpit" …>` pinned above the scrollable content (`flex-col h-screen`, TopBar outside the `flex-1 overflow-y-auto` div). No sidebar and no Shell grid are added to the page. ~~The removed in-content header MUST NOT be replaced by a "Cockpit" heading.~~ *Superseded during the post-apply visual pass (user decision, revising intake assumption #11): the page carries the retro `PageHeading` per R14.*

- **GIVEN** the Cockpit route (`/`)
- **WHEN** the page renders
- **THEN** a `TopBar` in cockpit mode is pinned above the scrollable server list and the old ad-hoc logo+span header is gone
- **AND** the FixedWidthToggle / Notification / Theme controls are reachable on `/`

#### R13: Breadcrumb interactivity affordances *(post-apply addition, user-requested)*
Interactive crumbs MUST advertise their interactivity without hover. `BreadcrumbDropdown` triggers with a label MUST render a persistent `▾` caret (`aria-hidden`, `text-base`/16px — user-tuned for visibility) after the label — a label-less trigger already IS a bare caret and gets no second one. The two link crumbs (brand, server) MUST carry an always-visible link affordance via the shared `LINK_CRUMB_CLASS` constant in `top-bar.tsx`: the **bordered chip** treatment (reusing the right-cluster's "bordered = clickable" language), chosen by the user after live comparison of three candidates (chip / accent color / dotted underline); the unused variant definitions were removed at lock-in. Non-interactive crumbs (the `aria-current` leaf) carry neither affordance.

- **GIVEN** a terminal route
- **WHEN** the topbar renders
- **THEN** the session and window dropdown triggers show a trailing `▾` caret, the brand and server link crumbs render with the active `LINK_CRUMB_CLASS` treatment, and the leaf crumb shows neither affordance

#### R14: Retro page heading on the page-like surfaces *(post-apply addition, user-requested)*
A shared `PageHeading` component (`app/frontend/src/components/page-heading.tsx`) MUST render a one-line bracketed BBS-menu-tag heading — `[ page · name ]────… side` — on exactly the two page-like surfaces: the Cockpit (`/`, `[ cockpit ]`, no instance, no side-text) and the Server Cabin header row (`/$server`, `[ server cabin · {server} ]` with the sessions/windows stats **right-aligned** after the rule). The bracket group holds the canonical page word (lowercase) and, when the page is about an instance, the instance name after a `·`; the page word renders secondary when an instance follows (the name is the subject) and primary standalone. Workspace surfaces (Terminal, Board) carry no page heading. Brackets, separator, and the CSS-border rule are `aria-hidden`; the `<h1>` is the accessible structure with a clean word-separated name (e.g. "server cabin testServer"). Instance names are never case-transformed. **Vocabulary split**: the breadcrumb speaks *instance names* (where you are); page headings speak *canonical page names* (what the page is) — this deliberately supersedes the intake's "canonical names stay docs-only" for page headings (intake assumption #11, revised twice by user decision during the visual pass).

- **GIVEN** the Cockpit route (`/`)
- **WHEN** the page renders
- **THEN** an `<h1>` reading `cockpit` renders above the HOST HEALTH section inside the bracket-tag heading
- **GIVEN** the Server Cabin route (`/$server`)
- **WHEN** the tiles view renders
- **THEN** an `<h1>` reading `server cabin · {server}` renders as the pinned header row with the `{N} sessions, {M} windows` stats right-aligned, replacing the plain stats line

#### R15: Cockpit BOARDS zone *(post-apply addition, user-requested)*
The Cockpit MUST render a BOARDS section between HOST HEALTH and TMUX SERVERS, listing cross-server pane boards via the existing `useBoards()` hook (plain `/api/boards` fetch + the shared SSE pool — no new API). Each board renders as a tile (name + `{N} pin(s)`, same tile idiom as the server tiles) navigating to `/board/$name` on click. The section heading row follows the shared idiom (`gap-3`, count side-text, `loading…` before first fetch). The section is always visible: with zero boards it shows the sidebar's "Pin a window to start a board" hint instead of appearing/vanishing with the first/last board.

- **GIVEN** the Cockpit route (`/`) with boards `main` (3 pins) and `review` (1 pin)
- **WHEN** the page renders
- **THEN** section order is HOST HEALTH → BOARDS → TMUX SERVERS → SERVICES, the BOARDS zone shows `2 boards` and a tile per board, and clicking `main` navigates to `/board/main`
- **GIVEN** zero boards
- **WHEN** the page renders
- **THEN** the BOARDS section still renders, showing `0 boards` and the pin-to-start hint

### Non-Goals

- No new routes (Constitution IV) — cockpit is a TopBar *mode*, not a route.
- Server-crumb dropdown (server switching stays in the command palette).
- Changing `BoardModeBreadcrumb` internals or the session/window dropdown internals.
- Adding a bounded fallback / any behavioral change to the create-server waiting flow.
- Backend / API changes.

### Design Decisions

1. **Cockpit mode carries the same `TopBarProps` shape, made tolerant of empty session/server**: `sessions=[]`, `currentSession=null`, `currentWindow=null`, `sessionName=""`, `server=""` — mirroring how board mode already passes empty values. *Why*: keeps one prop surface; board mode is the precedent. *Rejected*: a separate narrowed cockpit prop type (more surface, diverges from board's pattern).
2. **`hasSidebar` is derived from `mode` inside TopBar** (hamburger renders unless `mode === "cockpit"`) rather than threading a new boolean prop. *Why*: the only sidebar-less mode is cockpit; deriving avoids a redundant prop. *Rejected*: new `showHamburger` prop (redundant with mode).
3. **Server crumb rendered inline in TopBar** (a plain `<a>` or `<span aria-current>`), not via `BreadcrumbDropdown` (no dropdown per R5/intake assumption 4).
4. **Two-affordance vocabulary for crumb interactivity** (R13): links that navigate carry the `LINK_CRUMB_CLASS` treatment; dropdowns that open a switcher carry a persistent `▾` caret; the current-page leaf carries neither — the absence of affordance is itself meaningful. *Why*: hover-only cues (`hover:text-text-primary`) are invisible to first-time users. *Rejected*: accent-colored links as the default (hue vocabulary is reserved by the StatusDot phases); one shared affordance for both interaction types (erases the navigate-vs-menu distinction). *Final pick*: bordered chip — the user compared all three treatments live (chip, accent, dotted underline) and chose the chip; dotted underline additionally left the mobile icon-only brand with no affordance.
5. **Bracketed BBS-tag page heading speaking canonical page names** (R14): `[ page · name ]────… side`. *Why*: the user compared four one-line retro idioms live (tmux pane-title rule, shell prompt, inverse block, bracket tag) and chose the bracket tag, then split the bracket content into page word + instance name with stats right-aligned. This establishes the vocabulary split — breadcrumb = instance names (where), page headings = canonical page names (what) — deliberately revising the intake's "canonical names stay docs-only" decision (assumption #11). *Rejected*: figlet banners / multi-line boxes (vertical cost on a density view, 375px overflow); uppercase transforms (server names are case-sensitive identifiers).

## Tasks

### Phase 1: Shell grid

- [x] T001 Update the desktop grid in `app/frontend/src/components/shell/shell.tsx` so `gridTemplateAreas` is `'"topbar topbar" "sidebar content" "sidebar bottombar"'` (columns/rows/transition unchanged; mobile branch untouched). <!-- R1 -->
- [x] T002 Rewrite the ASCII topology comment + the `grid-template-areas` doc line in `shell.tsx` to match the full-width-topbar topology. <!-- R2 -->
- [x] T003 [P] Update `app/frontend/src/components/shell/shell.test.tsx` to assert the new desktop `gridTemplateAreas` (`"topbar topbar"`, `"sidebar content"`, `"sidebar bottombar"`) and that columns/rows/transition and the mobile branch are unchanged. <!-- R1 -->

### Phase 2: TopBar navbar + right cluster + cockpit mode

- [x] T004 In `app/frontend/src/components/top-bar.tsx`, add `"cockpit"` to `TopBarMode` and update the `TopBarProps` doc comment to describe the cockpit mode and the tolerated empty session/server props. <!-- R11 -->
- [x] T005 Move the brand (logo icon + `hidden sm:inline` "Run Kit" wordmark) into the left `<nav>` as the left-most `<a href="/">`, and remove the right-side "Run Kit" anchor. Icon always visible; wordmark hidden `< sm`. <!-- R3 -->
- [x] T006 Render the hamburger between the brand and the crumbs; suppress it in `mode === "cockpit"` (derive `hasSidebar = mode !== "cockpit"`). <!-- R4 -->
- [x] T007 Add an inline server crumb for `root`/`terminal` modes: a `›` separator (aria-hidden) then the full server name — a plain `<a href="/$server">` link when `windowName`/`currentWindow` is present (terminal), else non-link `<span aria-current="page">` (server-cabin leaf). Remove the literal "Dashboard" fallback branch. <!-- R5 -->
- [x] T008 Replace the `/` separators between session and window crumbs with `›` (U+203A, aria-hidden), keeping the existing session/window `BreadcrumbDropdown` invocations and their `+ New` actions intact. <!-- R7 R6 -->
- [x] T009 In board mode, render a `›` separator (aria-hidden) between the hamburger and the existing `BoardModeBreadcrumb` (brand + hamburger already handled by T005/T006); leave `BoardModeBreadcrumb` internals unchanged. <!-- R8 -->
- [x] T010 Reorder the right cluster so the connection dot is right-most; extend its render condition to exclude `board` AND `cockpit` (`mode !== "board" && mode !== "cockpit"`); rewrite the icon-ordering comment block to drop the "Run Kit anchor" framing. <!-- R10 -->
- [x] T011 Gate the terminal-font control out of cockpit mode as well (`mode !== "root" && mode !== "cockpit"` — cockpit has no terminal to size). <!-- R11 -->
- [x] T012 Apply mobile-collapse: brand wordmark `hidden sm:inline` (icon-only `< sm`), and hide intermediate crumbs (server + session + their separators) at `< sm` so only the leaf crumb shows; keep the topbar a single line. <!-- R9 -->

### Phase 3: Consumers (prop threading)

- [x] T013 In `app/frontend/src/components/server-list-page.tsx`, replace the ad-hoc `<header>` (logo + "Run Kit" span) with `<TopBar mode="cockpit" …>` pinned above the `flex-1 overflow-y-auto` content (page stays `flex-col h-screen`, no sidebar/Shell). Pass tolerant empty props (sessions `[]`, currentSession/currentWindow `null`, sessionName/windowName `""`, server `""`, no-op callbacks, `isConnected={false}`, `sidebarOpen={false}`). Do not add a "Cockpit" heading. <!-- R12 R11 -->
- [x] T014 Verify `app/frontend/src/app.tsx` TopBar invocation still type-checks with the new `TopBarMode` (its `topBarMode` is `"terminal" | "root"` — unaffected). Adjust only if the mode-derivation or props need it. <!-- R11 -->
- [x] T015 Verify `app/frontend/src/components/board/board-page.tsx` TopBar invocation still type-checks and renders brand + hamburger + `›` + BoardModeBreadcrumb correctly with `mode="board"`. Adjust only if props need it. <!-- R8 -->

### Phase 4: Tests

- [x] T016 Update `app/frontend/src/components/top-bar.test.tsx`: replace the "Dashboard" assertions with server-crumb leaf (`aria-current="page"`) + terminal server-crumb link assertions; assert brand-as-root-crumb `<a href="/">` at left and no right-side brand anchor; assert `›` separator (and no `/`); add cockpit-mode rendering assertions (brand + 3 controls, no hamburger/dot/font-control/split/close). Update the existing `/`-separator and "Run Kit branding" tests. <!-- R3 R5 R7 R10 R11 -->
- [x] T017 [P] Update `app/frontend/src/components/server-list-page.test.tsx` to render the shared TopBar (cockpit mode) — mock/provide TopBar context so the page mounts — and assert the TopBar is present with no hamburger and no connection dot; confirm the ad-hoc logo header is gone. <!-- R12 -->

### Phase 5: Breadcrumb affordances *(post-apply addition, user-requested)*

- [x] T018 Add a persistent `▾` caret to the `BreadcrumbDropdown` trigger (`app/frontend/src/components/breadcrumb-dropdown.tsx`): label wrapped in a truncating span, caret `aria-hidden` and omitted for label-less triggers; update the `breadcrumb-dropdown.test.tsx` textContent assertion to include the caret. <!-- R13 -->
- [x] T019 Introduce `LINK_CRUMB_CLASS` in `app/frontend/src/components/top-bar.tsx` and apply it to the brand and server link crumbs. Three treatments (bordered chip / accent color / dotted underline) were compared live; the user picked the **bordered chip** and the unused variants were removed at lock-in. <!-- R13 -->
- [x] T020 Create the shared `PageHeading` component (`app/frontend/src/components/page-heading.tsx`) — bracketed BBS tag `[ page · name ]` + flex-1 trailing rule + right-aligned side-text, decorations `aria-hidden`, whitespace text nodes keeping the `<h1>` accessible name word-separated — with `page-heading.test.tsx` covering heading roles/names, page-word emphasis, side-text, and decorative markup. <!-- R14 -->
- [x] T021 Mount `PageHeading` on the two page-like surfaces: Cockpit (`server-list-page.tsx`, `[ cockpit ]`, above HOST HEALTH; flip the old "no Cockpit heading" test to assert the new heading) and Server Cabin (`session-tiles.tsx`, `[ server cabin · {server} ]` + right-aligned stats, replacing the plain stats line). Includes the Cockpit spacing cleanup (`pt-6` on the scroll container; heading rows `gap-3`; hostname side-text demoted to secondary). <!-- R14 R12 -->
- [x] T022 Add the Cockpit BOARDS zone (`server-list-page.tsx`): `useBoards()` consumption, section between HOST HEALTH and TMUX SERVERS with heading-row idiom + count/loading side-text, board tiles (name + pin count) navigating to `/board/$name`, zero-boards hint; tests mock the `use-boards` hook seam and cover tile navigation, section order, and the empty state. <!-- R15 -->

## Execution Order

- T001 → T002 (same file); T003 can run alongside.
- Phase 2 (T004–T012) all touch `top-bar.tsx` — sequential, T004 first.
- Phase 3 depends on Phase 2 (`cockpit` mode must exist).
- Phase 4 depends on the implementation in Phases 1–3.

## Acceptance

### Functional Completeness

- [ ] A-001 R1: Desktop Shell grid `gridTemplateAreas` spans the topbar across both columns (`"topbar topbar" "sidebar content" "sidebar bottombar"`); columns/rows/transition and mobile branch unchanged.
- [ ] A-002 R2: The `shell.tsx` topology comment and `grid-template-areas` doc line match the implemented full-width topbar.
- [ ] A-003 R3: The brand renders as the left-most `<a href="/">` (icon always, wordmark `hidden sm:inline`); no right-side "Run Kit" anchor remains.
- [ ] A-004 R4: The hamburger renders between brand and crumbs on terminal/root/board and is absent in cockpit mode.
- [ ] A-005 R5: The server crumb is a link to `/$server` on terminal and a non-link `aria-current="page"` leaf on server-cabin; the literal "Dashboard" text is gone in all modes.
- [ ] A-006 R6: Session/window dropdowns and their `+ New Session` / `+ New Window` actions behave exactly as before.
- [ ] A-007 R7: The separator is `›` (U+203A, aria-hidden); no `/` text separator remains.
- [ ] A-008 R8: Board mode renders brand + hamburger + `›` + the unchanged `BoardModeBreadcrumb` and still hides the connection dot.
- [ ] A-009 R9: At `< sm` only brand icon + leaf crumb render (intermediate crumbs hidden) and the topbar stays a single line.
- [ ] A-010 R10: The connection dot is the right-most right-cluster element and is excluded in board AND cockpit modes; the ordering comment is rewritten.
- [ ] A-011 R11: `TopBarMode` includes `"cockpit"`; cockpit mode renders brand + FixedWidth/Notification/Theme only (no hamburger/dot/font/split/close) without errors on empty session/server props.
- [ ] A-012 R12: `ServerListPage` renders `<TopBar mode="cockpit">` pinned above scrollable content, the ad-hoc header is removed, and no "Cockpit" heading is added.

### Behavioral Correctness

- [ ] A-013 R5: On the server-cabin route the server-name leaf replaces what was formerly the "Dashboard" label, and clicking a terminal-route server crumb navigates to `/$server`.
- [ ] A-014 R10: Removing the brand anchor does not shift the remaining right-cluster controls' order (FixedWidth → Notification → Theme → dot).

### Scenario Coverage

- [ ] A-015 R3 R5 R7 R11: `top-bar.test.tsx` covers brand-as-root-crumb, server crumb link vs. leaf `aria-current`, `›` separator, "Dashboard" removal, and cockpit-mode rendering.
- [ ] A-016 R12: `server-list-page.test.tsx` covers TopBar presence and absence of hamburger + connection dot in the Cockpit.
- [ ] A-017 R1: `shell.test.tsx` covers the new full-width-topbar desktop grid areas.

### Edge Cases & Error Handling

- [ ] A-018 R11: Cockpit mode with empty `sessions`/`server`/null `currentSession`/`currentWindow` renders without throwing (dropdown/branch guards tolerate empties).
- [ ] A-019 R9: A long server name does not break the single-line 375px topbar because intermediate crumbs are hidden `< sm`.

### Code Quality

- [ ] A-020 Pattern consistency: New TopBar crumb/mode code follows the existing responsive `hidden sm:*` idioms, the `mode`-switch structure, and the `BreadcrumbDropdown` usage patterns of surrounding code.
- [ ] A-021 No unnecessary duplication: Reuses the existing responsive image pair, `BreadcrumbDropdown`, and the `mode` prop rather than adding new components or props where a derived value suffices.
- [ ] A-022 Type narrowing over assertions: The new `cockpit` mode is handled via discriminated `mode` checks and guarded optional props — no `as` casts introduced (code-quality § Frontend).
- [ ] A-023 Keyboard-first (Constitution V): Every new interactive element (brand link, server-crumb link) is a native anchor/button and keyboard-reachable; server switching remains in the command palette.
- [ ] A-024 No new routes (Constitution IV): Cockpit is a TopBar mode; the route set is unchanged.
- [ ] A-025 R13: Dropdown crumb triggers (session, window, board) display a persistent `▾` caret without hover; the brand and server link crumbs display the active `LINK_CRUMB_CLASS` affordance; the `aria-current` leaf crumb displays neither.
- [ ] A-026 R14: Both page-like surfaces render the shared `PageHeading` (Cockpit: `[ cockpit ]`; Server Cabin: `[ server cabin · {server} ]` with right-aligned stats) as a one-line `<h1>` whose accessible name is word-separated and free of decorative brackets/separator/rule; Terminal and Board render no page heading.
- [ ] A-027 R15: The Cockpit renders the BOARDS zone between HOST HEALTH and TMUX SERVERS — board tiles navigate to `/board/$name`, the count side-text follows the shared heading idiom, and the zero-boards state shows the pin-to-start hint without hiding the section; no new HTTP endpoint is introduced (reuses `useBoards`).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- e2e: existing specs assert no old-topbar layout, "Dashboard" breadcrumb text, or right-side brand position, so none are structurally broken by this change (verified: matches are incidental — comments and unrelated `aria-current`/hamburger usage). The intake's suggestion to add a mobile-layout single-line/leaf-crumb assertion is deferred as optional polish to avoid the mandatory `.spec.md` companion churn for a low-risk visual property already covered by unit tests; flagged for the user's local visual check.

## Deletion Candidates

- None — every piece of code this change made redundant was removed inline as part of the same edit (the right-side "Run Kit" brand anchor and the `/` separators in `top-bar.tsx`, the literal "Dashboard" leaf branch in `top-bar.tsx`, the ad-hoc `<header>` logo+span in `server-list-page.tsx`, and the plain stats line in `session-tiles.tsx`). No orphaned symbols, dead exports, or now-unused imports remain (verified: `tsc --noEmit` clean; no residual `icon.svg`/`LogoSpinner` references in `server-list-page.tsx`). The sidebar's `boards-section.tsx` is NOT redundant — it still drives the actual sidebar; the Cockpit BOARDS zone is a parallel surface (see the Should-fix duplicated-logic note for the un-shared board-tile markup).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Desktop `gridTemplateAreas` becomes `"topbar topbar" / "sidebar content" / "sidebar bottombar"`; columns/rows/transition and mobile branch unchanged | Intake §1 states the exact before/after grid; one-line edit | S:95 R:90 A:95 D:95 |
| 2 | Confident | `hasSidebar`/hamburger suppression is derived from `mode === "cockpit"` rather than a new prop | Only cockpit lacks a sidebar; deriving avoids a redundant prop and matches how board/terminal already key off `mode` | S:80 R:85 A:85 D:75 |
| 3 | Confident | Cockpit reuses the existing `TopBarProps` shape with empty/null session/server values and no-op callbacks (board-mode precedent) | Intake §3 says "optional props or a narrowed cockpit prop surface, whichever fits"; board mode already passes empties, so reuse is the lowest-surface fit | S:80 R:80 A:85 D:70 |
| 4 | Confident | Server crumb is rendered inline (plain `<a>` / `<span aria-current>`), not through `BreadcrumbDropdown` | Intake assumption 4 fixes "no dropdown"; inline anchor is the simplest keyboard-reachable form | S:85 R:85 A:85 D:80 |
| 5 | Confident | At `< sm`, intermediate crumbs (server + session) AND their `›` separators are hidden via `hidden sm:*`, leaving brand icon + leaf crumb | Intake §2 mobile bullet + assumption 7; existing `hidden sm:inline` idiom; single-line 375px invariant | S:75 R:85 A:80 D:70 |
| 6 | Confident | Cockpit `ServerListPage` keeps its `flex-col h-screen` pinning, placing TopBar outside the `flex-1 overflow-y-auto` div (same pinning as today's header), no Shell grid | Intake §3 specifies this exact pinning; page has no sidebar | S:85 R:80 A:85 D:80 |
| 7 | Confident | e2e specs need no mandatory edits; the optional mobile single-line assertion is deferred (avoids `.spec.md` churn for a unit-covered property) | Grep confirmed no spec asserts old topbar layout / "Dashboard" text / right-side brand; intake marks e2e updates conditional and constitution ties `.spec.ts` edits to `.spec.md` | S:70 R:80 A:75 D:70 |
| 8 | Confident | Board mode gets an explicit `›` separator between hamburger and `BoardModeBreadcrumb`; the breadcrumb's internal `Board ▸ … ▾` is untouched | Intake §2 board bullet + assumption 10; direct composition of the decided scheme | S:80 R:85 A:85 D:80 |
| 9 | Certain | The literal "Dashboard" fallback branch is deleted; the server-name leaf replaces it | Intake §2/§4 + assumption 8; documented stale leftover from the deleted Dashboard component | S:90 R:90 A:90 D:90 |

9 assumptions (2 certain, 7 confident, 0 tentative).

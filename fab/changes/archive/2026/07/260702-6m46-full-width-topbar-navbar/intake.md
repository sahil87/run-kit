# Intake: Full-Width Topbar as Navbar

**Change**: 260702-6m46-full-width-topbar-navbar
**Created**: 2026-07-02

## Origin

Conversational — a `/fab-discuss` session exploring the chrome layout, iterating ASCII mockups. The user's raw ask:

> Static topbar always. Topbar also acts as the navbar. For this we need two important changes:
> 1) A full width top bar instead of a full height left panel. Left panel now starts below the top bar.
> 2) The left part of the top bar needs to act like a nav bar. For this, move the runkit logo from the right most to the left most. After that: Cockpit > {tmuxServerName} Cabin > Session {SessionName} > {WindowName}.

Two follow-up rounds refined the crumb design:

- **"Cabin" vs "SERVER" prefix debate** → resolved as **neither**: breadcrumbs show *instance names only* (position conveys the level). The user spotted that the sidebar panel says "SERVERS" while a "Cabin" crumb would name the same thing differently; the agent's counter-proposal (bare names, no type-prefix words) was accepted.
- **Brand placement** → the user asked where "Run Kit" lives in the new topbar; **Option A** was chosen: the brand (logo + wordmark) IS the root crumb, left-most, linking to `/`. A separate "Cockpit" text crumb was rejected as a duplicate home affordance. Consequence: all four canonical page names (Cockpit / Server Cabin / Terminal / Board, per `260702-nuup`) remain docs-and-conversation vocabulary — none appear in the chrome.

## Why

1. **Navigation gap**: there is no in-chrome path from a Terminal (`/$server/$window`) back to the Server Cabin tile view (`/$server`) — the current breadcrumb shows only `session / window`, never the server. Users must edit the URL or use the sidebar.
2. **Stale label**: the no-window state on `/$server` shows a literal "Dashboard" label ([top-bar.tsx:187](app/frontend/src/components/top-bar.tsx#L187)) — a cosmetic leftover from the Dashboard component deleted by `260701-70a0`. The server-name crumb replaces it.
3. **Chrome inconsistency**: the Cockpit (`/`) has no topbar at all today (`ServerListPage` renders its own ad-hoc header), so theme/notification/fixed-width controls are unreachable there and the brand renders in a different place than on every other route.
4. **Visual hierarchy**: a full-width topbar reads as the app's primary chrome; the current full-height sidebar visually dominates and the topbar reads as content-local.

If not fixed: the tile-grid view (`260701-70a0`) stays hard to reach from a terminal, and every future route re-fights the "where does chrome live" question.

## What Changes

### 1. Shell grid — full-width topbar (`app/frontend/src/components/shell/shell.tsx`)

Desktop `gridTemplateAreas` changes so the topbar spans both columns and the sidebar occupies rows 2–3 only:

```
// before                                    // after
"sidebar topbar"                             "topbar  topbar"
"sidebar content"                            "sidebar content"
"sidebar bottombar"                          "sidebar bottombar"
```

`gridTemplateColumns` (sidebar width + `1fr`, 150ms collapse transition) and `gridTemplateRows` (`auto 1fr auto`) are unchanged. The mobile branch is already topbar-first single-column — **no mobile grid change**; the drawer overlay (grid rows `2 / 4`) is untouched. The ASCII topology comment in `shell.tsx` (lines 48–55) must be updated to match.

### 2. Breadcrumb → instance-name navbar (`app/frontend/src/components/top-bar.tsx`)

The left side of the topbar becomes, per route:

```
Cockpit (/):        ◆ Run Kit
Server Cabin:       ◆ Run Kit  ☰  › feisty-chamois
Terminal:           ◆ Run Kit  ☰  › feisty-chamois › agents ▾ › claude ▾
Board:              ◆ Run Kit  ☰  › Board ▸ main ▾ …
```

- **Brand root crumb**: the logo icon + "Run Kit" wordmark move from the right cluster (currently the right-most element, [top-bar.tsx:274-291](app/frontend/src/components/top-bar.tsx#L274-L291)) to the **left-most** position as a single `<a href="/">`. Reuse the existing responsive image pair (icon always visible; wordmark `hidden sm:inline`). The right-side anchor is removed.
- **Hamburger** (sidebar toggle) sits **between brand and crumbs** on server/terminal/board routes. Not rendered on the Cockpit (no sidebar there).
- **Server crumb**: the full server name is the click target, a plain link navigating to `/$server`. **No dropdown** — server switching stays in the command palette (`Server: Switch to …` already exists). When `/$server` is the current page (no `$window` param), the server crumb is the leaf: render as non-link text with `aria-current="page"`. This **replaces the literal "Dashboard" label**.
- **Session crumb**: existing `BreadcrumbDropdown` behavior unchanged (switch items jump to the session's first window; `+ New Session` action; `max-w-[7ch] truncate` styling may stay).
- **Window crumb**: existing `BreadcrumbDropdown` behavior unchanged (`+ New Window` action).
- **No type-prefix words**: no "SERVER", no "Cabin", no "session" labels in crumbs — instance names only.
- **Separator**: `›` (U+203A, `aria-hidden`), replacing the current `/` — matches the established palette-label convention (`<session> › <name>`).
- **Board mode**: brand + hamburger + `›` + the existing `BoardModeBreadcrumb` (its internal `Board ▸ {name} ▾` rendering is out of scope).
- **Mobile (`< sm`)**: brand collapses to the bare icon, and intermediate crumbs are hidden — show only **brand icon + leaf crumb** (leaf = window dropdown on Terminal, server name on Server Cabin, board name on Board). The topbar must remain a single line at 375px (documented invariant in `fab/project/context.md`).

### 3. Cockpit adopts the shared TopBar (`app/frontend/src/components/server-list-page.tsx`)

- Add a TopBar mode for the Cockpit (e.g. `mode="cockpit"` alongside the existing `"root" | "terminal" | "board"` values). In this mode: brand crumb only — **no hamburger, no connection dot** (it is per-server; the Cockpit has no per-server SSE stream), no terminal-font control, no split/close buttons. The route-agnostic right-cluster controls **stay**: `FixedWidthToggle`, `NotificationControl`, `ThemeToggle`.
- `ServerListPage` replaces its own ad-hoc header (`<header>` with logo + "Run Kit" span, server-list-page.tsx:188-192) with the shared `<TopBar mode="cockpit" …>` pinned above the scrollable content (`flex-col h-screen`, TopBar outside the `flex-1 overflow-y-auto` div — same pinning as today's header). No sidebar and no Shell grid on this page.
- Session/server-dependent TopBar props must tolerate the Cockpit context (no sessions, no server) — optional props or a narrowed cockpit prop surface, whichever fits the existing `TopBarProps` shape.
- The removed in-content header is **not** replaced by a "Cockpit" heading — canonical page names stay docs-only. <!-- assumed: Cockpit page gets no in-content page heading after its ad-hoc header is removed; the user floated putting the word "Cockpit" in page content but did not decide — revisit if the page feels headerless -->

### 4. Right cluster

Ordering unchanged except the brand anchor is gone — the connection dot becomes the right-most element. The code comment block describing icon ordering ("pinned to the Run Kit anchor", top-bar.tsx:192-198, 237-238, 254-255) must be rewritten to match the new anchor-less reality. The connection-dot visibility condition extends to also exclude the cockpit mode (currently `mode !== "board"`).

### 5. Tests

- Colocated unit tests: `top-bar.test.tsx` (brand-as-root-crumb link, server crumb link vs. leaf `aria-current`, separator `›`, per-mode rendering incl. cockpit, "Dashboard" literal removal), `server-list-page.test.tsx` (TopBar presence, no hamburger/dot), `shell.test.tsx` (grid areas), `app.test.tsx` (prop threading) — update as touched.
- Playwright e2e: update any spec asserting the old topbar layout, the "Dashboard" breadcrumb text, or the right-side brand position; mobile-layout specs must verify the single-line topbar at 375px with leaf-only crumbs. Per the constitution, every touched `*.spec.ts` updates its sibling `*.spec.md` in the same commit.

## Affected Memory

- `run-kit/ui-patterns`: (modify) — chrome/topbar/breadcrumb sections: full-width grid topology, brand-as-root-crumb, instance-name crumb scheme, server crumb navigation, Cockpit TopBar adoption, death of the "Dashboard" literal label, canonical-names-stay-docs-only note.

## Impact

Frontend-only — no backend, no API, no new routes (Constitution IV). Touched: `shell.tsx`, `top-bar.tsx`, `server-list-page.tsx`, `app.tsx` (prop threading), `board-page.tsx` (TopBar invocation, if its props change), colocated unit tests, Playwright specs + `.spec.md` companions. Keyboard-first (Constitution V) preserved: crumbs are anchors/buttons (keyboard-reachable), dropdowns unchanged, `Cmd+\` sidebar toggle unchanged, palette untouched.

## Open Questions

None — the design was fully resolved in the preceding discussion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Full-width topbar via desktop `gridTemplateAreas` change; sidebar occupies rows 2–3; mobile grid untouched | Explicit user request; one-line grid edit, mobile already topbar-first | S:95 R:90 A:95 D:95 |
| 2 | Certain | Brand (logo + wordmark) becomes the left-most root crumb linking to `/`; right-side Run Kit anchor removed | User explicitly chose Option A over a separate "Cockpit" crumb | S:95 R:85 A:90 D:90 |
| 3 | Certain | Crumbs are instance names only — no "SERVER"/"Cabin"/"session" type-prefix words | User accepted this after the Cabin-vs-SERVER debate; resolves the SERVERS-panel vocabulary mismatch | S:90 R:90 A:90 D:85 |
| 4 | Confident | Server crumb is a plain link to `/$server`, no dropdown; server switching stays in the palette | Discussed and recommended (split link/dropdown interaction is fiddly); user did not object; easily added later | S:80 R:85 A:80 D:70 |
| 5 | Confident | Separator becomes `›` (U+203A), replacing `/` | Matches the documented palette-label convention; trivially reversible | S:70 R:95 A:90 D:80 |
| 6 | Confident | Cockpit adopts shared TopBar via a new mode: no hamburger, no connection dot, no font control; keeps FixedWidthToggle/Notification/Theme | "Static topbar always" implies `/` gets it; dot is per-server and Cockpit has no server stream; mode precedent exists (`board` hides the dot) | S:80 R:80 A:80 D:70 |
| 7 | Confident | Mobile collapses to brand icon + leaf crumb only; single-line topbar at 375px preserved | Width math discussed (long server names don't fit); standard breadcrumb-collapse pattern; existing `hidden sm:inline` idiom | S:70 R:85 A:75 D:65 |
| 8 | Confident | On `/$server` (no window) the server crumb is the leaf: non-link text with `aria-current="page"`, replacing the "Dashboard" literal | Standard breadcrumb convention (current page not a link); "Dashboard" is a documented stale leftover | S:75 R:90 A:85 D:75 |
| 9 | Certain | Session/window crumbs keep existing dropdown behavior including `+ New` actions and window-id hrefs | Explicit user instruction ("act as dropdown, like they do now") | S:90 R:90 A:95 D:90 |
| 10 | Confident | Board route: brand + hamburger + `›` + existing `BoardModeBreadcrumb` unchanged internally; board keeps hiding the connection dot | Direct composition of the decided scheme with the existing board breadcrumb; low blast radius | S:75 R:85 A:85 D:80 |
| 11 | Tentative | Cockpit page gets no replacement in-content heading (no "Cockpit" title) after its ad-hoc header is removed | User floated surfacing the word "Cockpit" in page content but did not decide; cheap to add later | S:40 R:70 A:40 D:30 |
| 12 | Confident | Right cluster order otherwise unchanged; connection dot becomes right-most; ordering comment rewritten | Mechanical consequence of removing the anchor; comment explicitly references the moved element | S:80 R:95 A:90 D:85 |

12 assumptions (4 certain, 7 confident, 1 tentative, 0 unresolved).

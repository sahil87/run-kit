# Intake: Top-Bar Overlap Fixes

**Change**: 260715-q8ey-top-bar-overlap-fixes
**Created**: 2026-07-15

## Origin

Conversational (`/fab-discuss` session, 2026-07-15). The user shared a screenshot of the top bar at a mid width (~760 CSS px, terminal route `/testServer/2`) where the left breadcrumb text ("testServer", session crumb) painted directly over the centered `Window: GA1` heading — garbled, unreadable overlap.

> "I want you to make a series of fixes on the new topbar nav area (the center section of the top bar). 1) How do we fix the problem we see in the screenshot? At this width, the layout breaks down."

Follow-up direction from the same conversation: "Have a min width for breadcrumbs (+ the clip backstop you proposed). Have a min width for the heading sections (The center section)." The user approved the diagnosed fix set (items 1, 2, 4 below). A companion change (top-bar right-cluster overflow chevron menu, drafted separately) handles the right cluster; this change is the standalone correctness fix and deliberately does NOT touch the right cluster.

## Why

**Problem.** The top bar is a 3-column grid `grid-cols-[1fr_auto_1fr]` (`app/frontend/src/components/top-bar.tsx`, header grid ~line 383). In the band between the `sm` breakpoint (640px) and roughly 900px, the bar's content cannot fit, and the failure mode is *unclipped overlap*, not graceful degradation:

1. The left `<nav>` grid item carries `min-w-0` (~line 384), so its **grid track** can compress toward zero. But the two crumb wrapper spans inside it — the server link crumb (`hidden sm:flex items-center gap-1.5`, ~line 436) and the session crumb (~line 452) — have **no `min-w-0`**. A nested flex item defaults to `min-width: auto`, which blocks the `truncate max-w-[16ch]` already present on the server anchor and the session `BreadcrumbDropdown` trigger from ever engaging. The crumbs refuse to shrink, overflow the nav's box (overflow is visible), and paint straight over the centered heading.
2. The center `auto` column's content floor grew in 260714-uco1 (history ◀ ▶ arrows + hierarchy ▾ + the stable-anchor `sm:min-w-[28ch]` inner box, ~line 488) — roughly 260px+ of non-negotiable width exactly where space runs out. Additionally, the center cell's *outer* wrapper (~line 487) carries `min-w-0`, meaning the center track itself can also be squeezed below its content, producing center-side overlap in the other direction.
3. The right cluster is rigid (`shrink-0`, items hide only below `sm`), so all squeeze lands on the left column.

**Consequence if unfixed.** Any window with sidebars open / mid-width browser panes (a primary run-kit use case — VS Code side panels, half-screen windows) renders a garbled, unreadable, unusable top bar: rename affordance, window switcher, and breadcrumb all visually collide.

**Why this approach.** Root cause is the blocked flex shrink chain; fixing it (adding `min-w-0` at the blocked links) makes the existing `truncate` classes do their job. Clip backstops and explicit min-widths convert any *residual* pressure into clean clipping instead of overlap. Demoting the server crumb to `md:` is safe because the 260714-uco1 hierarchy ▾ in the center heading already provides "go to Server Cabin" navigation. Alternatives rejected: demoting the `sm:min-w-[28ch]` stable anchor to `md:` was considered and **superseded** — the companion overflow-chevron change makes the right cluster absorb squeeze, so the center keeps its anchor at `sm:`.

## What Changes

All in `app/frontend/src/components/top-bar.tsx` (line refs as of commit 29a2c73; locate by element if drifted).

### 1. Unblock crumb truncation (root cause)

Add `min-w-0` to the two crumb wrapper spans in the left nav:

- Server link crumb wrapper (~line 436): `hidden sm:flex items-center gap-1.5` → `hidden md:flex items-center gap-1.5 min-w-0` (the `md:` demotion is change area 4, folded into the same class edit)
- Session crumb wrapper (~line 452): `hidden sm:flex items-center gap-1.5` → `hidden sm:flex items-center gap-1.5 min-w-0`

Under pressure the crumbs then compress to ellipsis (the anchors/triggers already carry `truncate max-w-[16ch]`) instead of overflowing the nav box. The `BreadcrumbSeparator`, brand chip, and hamburger stay `shrink-0` — they are the protected identity floor.

### 2. Nav min-width + clip backstop

On the `<nav aria-label="Breadcrumb">` element (~line 384):

- Add `overflow-hidden` so content past the shrunk floor **clips** instead of painting over the center heading. Overlap becomes impossible rather than unlikely.
- Replace the bare `min-w-0` with an explicit breakpoint-aware floor, e.g. `min-w-[76px] sm:min-w-[180px]`. Intent: below `sm` the floor guarantees brand icon + hamburger (~76px); at `sm+` it additionally guarantees a usable sliver of the session crumb. Exact values are implementer-tunable via Playwright at 375 / 640 / 700 / 768 / 1024px — the *mechanism* (explicit floor + clip) is the requirement, the pixel values are not.
  <!-- assumed: min-width values 76px / 180px are starting points to be tuned visually, not hard requirements -->

### 3. Center section min-width protection

On the center cell's outer wrapper (~line 487, `flex items-center justify-center min-w-0`): **remove `min-w-0`** so the `auto` grid column never shrinks below the heading's content floor. That floor is already bounded (it cannot grow unbounded) because:

- the heading name spans carry `max-w-[16ch] sm:max-w-[28ch]` + `truncate` (WindowHeading button ~line 1300 and PageHeadingDisplay ~line 1407),
- the history arrows, hierarchy ▾, and window/board ▾ switchers are fixed-width `shrink-0`,
- the `sm:min-w-[28ch]` stable anchor on the inner box (~line 488) **stays at `sm:` unchanged** (decision: NOT demoted to `md:` — superseded by the companion overflow change).

Net effect: left and right columns absorb squeeze; the center heading is never compressed into overlap.

### 4. Server crumb demoted to `md:`

The server link crumb (wrapper ~line 436) renders only at `md+` instead of `sm+`. Rationale: since 260714-uco1 the hierarchy ▾ inside the heading prefix (`Window ▾:`) lists `Server Cabin: {server}` → `Cockpit`, so the left server crumb is redundant navigation at cramped widths and is the natural first element to give way. The session crumb (with its switcher + `+ New Session` action) stays at `sm+`.

### 5. Accepted interim behavior (right cluster untouched)

This change does NOT add `min-w-0`/clip to the right cluster. With left/center floors in place, extreme narrowness can push the grid wider than the viewport so the right cluster's rightmost items (connection dot first) clip at the app-shell edge. This is accepted and *transitional*: the companion overflow-chevron change gives the right cluster its proper degradation (buttons collapse into a menu). Do not attempt a partial right-cluster fix here — a plain `overflow-hidden` on the right cluster would clip the always-block L3/dot end first (flex overflow spills toward inline-end), which is the wrong end to lose.

### 6. Tests

Playwright e2e (constitution: run via `just pw` / `just test-e2e`, never raw playwright; companion `.spec.md` updated in the same commit — likely extending `app/frontend/tests/e2e/window-heading.spec.ts` or a new `top-bar-overlap.spec.ts`):

- At ~700×800 viewport on a terminal route with a long window name and long session name: assert the breadcrumb nav's bounding box and the center heading's bounding box do **not** intersect.
- Assert crumbs show ellipsis (not overflow) under pressure; assert the server crumb is hidden below `md` and visible at `md+`.
- Re-verify 375px (mobile leaf layout unchanged) and 1024px+ (no visual regression, anchor intact).

## Affected Memory

- `run-kit/ui-patterns`: (modify) TopBar universal-page-heading section — record the degradation ladder (crumbs truncate → server crumb hides below `md` → nav clips at its floor; center protected by content floor + 28ch anchor; right cluster degradation deferred to the overflow-chevron change) and the min-w-0-chain/clip-backstop rules.

## Impact

- `app/frontend/src/components/top-bar.tsx` — class-level changes only (~4 elements); no component API, prop, routing, or backend changes.
- `app/frontend/tests/e2e/` — new/extended Playwright spec + companion `.spec.md`.
- `app/frontend/src/components/top-bar.test.tsx` — may need class-assertion updates if it asserts the touched class strings.
- No Go/backend impact. No new dependencies.

## Open Questions

- (none — the tunable min-width pixel values are recorded as a Tentative assumption rather than a blocking question)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Add `min-w-0` to both crumb wrapper spans to unblock the existing `truncate` | Discussed and user-approved (fix 1); standard nested-flex min-width fix; trivially reversible | S:90 R:95 A:95 D:90 |
| 2 | Certain | Clip backstop: `overflow-hidden` on the breadcrumb `<nav>` | Discussed and user-approved (fix 2, re-confirmed "+ the clip backstop you proposed") | S:90 R:95 A:90 D:90 |
| 3 | Confident | Server crumb demoted `sm:`→`md:` | User-approved (fix 4); hierarchy ▾ covers the navigation; easily reverted | S:85 R:90 A:85 D:75 |
| 4 | Confident | Keep `sm:min-w-[28ch]` center anchor at `sm:` (do NOT demote to `md:`) | Earlier fix-3 idea explicitly superseded once the companion overflow change absorbs right-side squeeze; user approved the two-change split | S:75 R:90 A:80 D:70 |
| 5 | Confident | Center protection implemented by removing the outer wrapper's `min-w-0` (content-floor protection) rather than a new explicit pixel min | User asked for "a min width for the center section"; the heading's floor is already bounded by existing `max-w` caps + fixed-width controls, so protecting the content floor satisfies the intent without a magic number | S:60 R:85 A:85 D:65 |
| 6 | Tentative | Nav min-width floor values `min-w-[76px] sm:min-w-[180px]` | Mechanism (explicit floor) is agreed; exact pixels are visual-tuning territory — implementer adjusts via Playwright sweep | S:45 R:90 A:70 D:50 |
| 7 | Confident | Right cluster untouched; possible right-edge clipping at extreme narrowness accepted as interim until the overflow-chevron change | User's design assigns right-cluster degradation to the companion change ("the right section pays the price" via the chevron menu) | S:80 R:85 A:80 D:75 |

7 assumptions (2 certain, 4 confident, 1 tentative, 0 unresolved).

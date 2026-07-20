# Intake: Mobile View-Switcher Overflow

**Change**: 260717-6anu-mobile-view-switcher-overflow
**Created**: 2026-07-17

## Origin

One-shot `/fab-new` invocation with a screenshot-backed description:

> On mobile, the top bar's tty/chat mode toggle (the inline pill next to the PageType heading, currently rendered directly in the top bar) crowds out horizontal space needed for the page heading text. Move the tty/chat toggle out of the inline top bar on mobile and into a menu (e.g. the existing overflow chevron menu or a similar dropdown) so the heading has room to breathe. Screenshot reference: a phone-width capture where the green 'chat' toggle pill is squeezed right next to a truncated 'operator...' heading in the top bar.

The "e.g." on the mechanism signals flexibility about *how* the toggle leaves the bar; the firm requirement is the outcome (heading room on phone widths). During intake the agent grounded the design in the current code (see What Changes) — the deciding finding is that change `260715-h1ck` already built exactly the needed machinery (the priority+ overflow registry feeding the chevron menu) and the ViewSwitcher is merely *exempted* from it.

## Why

1. **Pain point**: On phone widths (375px), the terminal route's right cluster keeps three exempt items inline at all times — the ViewSwitcher pill, the overflow chevron, and the connection dot. The pill is by far the widest of these (~70–80px for two segments, more with three). The center heading's name span is already capped at `max-w-[16ch]` below `sm`, and with the pill reserved the grid has no room left even for that floor — the heading truncates aggressively ("operator…") and the pill sits jammed against it, exactly as the screenshot shows. Agent windows routinely carry long worktree-derived names, so this is the common case on mobile, not an edge.
2. **Consequence of not fixing**: The heading is the page identity anchor on mobile (breadcrumb crumbs hide below `sm`, so the centered leaf is the only place the window name appears). Crowding it makes windows hard to tell apart on the primary mobile use case (chat view — the pill is widest precisely when chat capability exists).
3. **Why this approach**: The top bar already degrades via the 260715-h1ck priority+ overflow registry — an ordered candidate list where controls that don't fit collapse into the always-present chevron menu ("More controls"). That change deliberately killed per-item `hidden sm:*` breakpoint cliffs. Making the ViewSwitcher a registry *candidate* (ending its exemption) reuses the proven mechanism, is space-driven (the pill yields exactly when the heading needs room, on any narrow viewport — phone or squeezed desktop window — and stays inline when there is genuinely room), and adds no new mobile-detection branch. A hard mobile gate (`hidden sm:*` + always-in-menu-on-mobile) was rejected: it would reintroduce the exact cliff pattern 260715-h1ck removed.

## What Changes

### 1. ViewSwitcher becomes the first overflow-registry candidate (`top-bar.tsx`)

Current state (all in `app/frontend/src/components/top-bar.tsx`):

- The pill renders as a **leading exempt** control outside the candidate list (`top-bar.tsx:931-943`), gated on `mode === "terminal" && currentWindow && onSelectView && availableViews && availableViews.length > 1`.
- Its measured width is **reserved** ahead of candidate fitting: `viewSwitcherRef` (`top-bar.tsx:594`) feeds `reserved = trailing + gap + (vsw > 0 ? vsw + gap : 0)` (`top-bar.tsx:613-618`), and the ResizeObserver observes the pill node (`top-bar.tsx:642`).

Change:

- Add a new entry `{ id: "view-switcher", modes: ["terminal"], hidden: <same gate as today>, barRender: () => <ViewSwitcher …/>, menuRender: () => <ViewSwitcherMenuRows …/> }` as the **first** element of `rightItems` (`top-bar.tsx:441`), ahead of `split-vertical`. Registry order is both display order and drop priority (overflow consumes FROM THE FRONT — `top-bar.tsx:430-431`, `lib/top-bar-overflow.ts:8-13`), so the pill keeps its current leftmost position in the bar and becomes the **first control to yield** when width shrinks. This preserves the "surviving in-bar set is a suffix" invariant (`top-bar.tsx:619-623`) — no changes to `computeVisibleCount` are needed.
- The `hidden` predicate must mirror the full current render gate (including `availableViews.length > 1`) so single-view windows contribute no phantom slot or probe width.
- Remove the exempt machinery for the pill: the leading exempt render block, `viewSwitcherRef`, its term in `reserved`, and its `ro.observe` line. The pill's width is now measured like every other candidate via the hidden probe row (which renders each candidate's `barRender`). The `availableViews`/`activeView` entries in the measure effect's dep array stay — the pill's probe width still changes with segment count and active segment.
- The trailing exempt block (chevron + connection dot) is untouched; `reserved` simplifies to `trailing + RIGHT_GAP_PX`.

No oscillation risk: the center `auto` column is sized by heading *content* (name capped at `max-w-[16ch]`/`sm:max-w-[28ch]`), not by leftover space, so collapsing the pill does not feed back into the cell width the observer measures.

### 2. Menu representation: per-view rows (`ViewSwitcherMenuRows`)

When overflowed, the pill is represented in the chevron menu as **one row per available view**, following the existing multi-row `menuRender` precedent (`NotificationMenuRows`, `top-bar.tsx:556`) and the palette's naming vocabulary (`View: Terminal` / `View: Web` / `View: Chat` from `lib/palette-view.ts`):

- Row label: `View: {VIEW_LABEL[view]}` reusing the label map from `view-switcher.tsx:26-30`; rows in the pill's fixed display order (tty first, `DISPLAY_ORDER`, `view-switcher.tsx:48`).
- The **active** view's row is visually marked (inverse-video accent-green treatment matching the pill's active segment, `view-switcher.tsx:92-94`) and exposed via `aria-pressed`/equivalent state so the menu remains the lens indicator while the pill is collapsed.
- Row activation calls the same `onSelectView(view)` callback (the `switchView` plumbing in `app.tsx` is untouched) and closes the menu, following the established row conventions in `top-bar-overflow-menu.tsx`.
- Component lives alongside the pill (in `view-switcher.tsx` or as a sibling in `top-bar.tsx` matching where `NotificationMenuRows` lives — follow the existing file placement pattern at implementation time).

### 3. Spec note (`docs/specs/window-views.md` R4)

Amend R4 with one sentence recording that the segmented chip participates in the right-cluster overflow registry (drops first, before L1) and is represented by per-view menu rows when collapsed — mirroring how R4 already records the 260714-uco1 heading reversal. The "sole lens indicator" language gains the qualifier that, while collapsed, the marked menu row (plus the view content itself) carries lens identity; there is deliberately **no** new inline lens indicator in the bar.

### 4. Tests

- `app/frontend/tests/e2e/chat-view.spec.ts:257-273` — the 375px "single-line top bar with chat toggle visible" test changes contract: at phone width with a realistically long window name the pill now lives in the "More controls" menu (assert the menu rows + heading room) rather than inline. Make the scenario deterministic (long window name → collapsed; the space-driven design legitimately keeps the pill inline for very short headings).
- `app/frontend/tests/e2e/web-view-lens.spec.ts:244` — the "switcher visible on mobile unlike its `hidden sm:*` siblings" assertion is superseded by the registry contract; update to the new expectation.
- `app/frontend/tests/e2e/mobile-layout.spec.ts` / `top-bar-overflow.spec.ts` — extend the overflow coverage to include the view-switcher candidate (first-to-drop ordering, menu rows render, activation switches lens).
- Every touched `.spec.ts` updates its sibling `.spec.md` in the same commit (constitution: Test Companion Docs).
- Unit: `view-switcher.test.tsx` extends for the new menu-rows component; `lib/top-bar-overflow.test.ts` unchanged (pure function untouched).
- Playwright-driven verification per project convention: 375×812 and 1024px+ viewports, before/after screenshots of a long-named chat-capable window.

### Explicitly out of scope

- No change to lens semantics, `?view=` URL state, localStorage keys, default-view hints, or `window-view.ts`.
- Keyboard/palette parity (Ctrl+` toggle, Cmd+. cycle, `View:` palette actions) is untouched — Constitution V remains satisfied by existing affordances even while the pill is collapsed.
- No change to the heading's `max-w-[16ch]` mobile cap or the center-cell grid contract (260715-q8ey).
- The chevron + connection dot stay exempt.

## Affected Memory

- `run-kit/ui-patterns`: (modify) — the chrome/top-bar section: the ViewSwitcher moves from the overflow registry's exempt set to its first candidate (drops first, per-view menu rows); the window-view lens model bullet's "visible at ALL breakpoints" claim is superseded.

## Impact

- **Code**: `app/frontend/src/components/top-bar.tsx` (registry entry, exempt-machinery removal, measurement simplification), `app/frontend/src/components/view-switcher.tsx` (menu-rows component + comment updates — the "visible at ALL breakpoints" doc comment at `view-switcher.tsx:75-78` is now wrong), possibly `top-bar-overflow-menu.tsx` (only if row conventions need a shared export). `lib/top-bar-overflow.ts` untouched.
- **Spec**: `docs/specs/window-views.md` R4 amendment (one sentence + qualifier).
- **Tests**: `chat-view.spec.ts`(+`.spec.md`), `web-view-lens.spec.ts`(+`.spec.md`), `mobile-layout.spec.ts`(+`.spec.md`), `top-bar-overflow.spec.ts`(+`.spec.md`), `view-switcher.test.tsx`.
- **No backend, API, or route changes.** No new dependencies.

## Open Questions

- None — the input was specific and the codebase machinery (260715-h1ck registry) answers the mechanism question decisively.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Space-driven overflow (registry candidate) instead of a hard mobile breakpoint gate | User's "e.g." signals mechanism flexibility; stated goal is heading room, which space-driven delivers on any narrow viewport; 260715-h1ck deliberately killed per-item breakpoint cliffs; trivially convertible to a hard gate later. Side effect accepted: with a very short heading on mobile the pill can legitimately stay inline (no crowding exists then). | S:55 R:80 A:80 D:50 |
| 2 | Confident | Pill joins as the FIRST candidate — leftmost display position kept, first to drop on squeeze (before L1 splits) | Preserves the front-consumption suffix invariant and `computeVisibleCount` untouched; the pill is the widest control and every lens action has palette/keyboard parity, so yielding it first best serves the heading; a custom collapse order would complicate the proven measurement design. | S:50 R:85 A:75 D:60 |
| 3 | Confident | Menu form = per-view rows (`View: Terminal/Web/Chat`), active row marked, click switches lens + closes menu | Follows the NotificationMenuRows multi-row precedent and the palette's naming vocabulary; menu rows are action-shaped, embedding the raw segmented pill in a menu row would fight the menu's keyboard/ARIA model. | S:45 R:85 A:80 D:60 |
| 4 | Confident | No new inline lens indicator while the pill is collapsed | The marked menu row + the view content itself (chat bubbles vs terminal) carry lens identity; heading stays static `Window:` per spec R4's 260714-uco1 reversal; an indicator can be added later if real usage misses it. | S:40 R:85 A:65 D:55 |
| 5 | Certain | Keyboard/palette parity untouched | Ctrl+` toggle, Cmd+. cycle, and `View:` palette actions live outside the bar and satisfy Constitution V regardless of pill visibility; no code path in scope touches them. | S:70 R:90 A:95 D:90 |
| 6 | Confident | Spec R4 gets a one-sentence amendment recording overflow participation | Specs are human-curated but R4 already records change-driven reversals (260714-uco1); leaving it stale would contradict the shipped behavior it specifies. | S:40 R:90 A:70 D:65 |

6 assumptions (1 certain, 5 confident, 0 tentative, 0 unresolved).

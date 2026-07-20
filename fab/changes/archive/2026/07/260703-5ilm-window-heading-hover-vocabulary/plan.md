# Plan: Centered Window Heading & Hover-Animation Vocabulary

**Change**: 260703-5ilm-window-heading-hover-vocabulary
**Intake**: `intake.md`

## Requirements

### Part A: Centered Window Heading (Terminal route)

#### R1: Header layout becomes a centering 3-column grid
The top-bar header row SHALL use CSS grid `grid-template-columns: 1fr auto 1fr` so the center cell is truly centered regardless of asymmetric left/right widths. The left cell holds the existing breadcrumb `<nav>`, the center cell holds the new window heading (terminal mode only), the right cell holds the existing button cluster right-aligned within its `1fr`.

- **GIVEN** the top bar rendered in any mode
- **WHEN** the header row lays out
- **THEN** it uses a 3-column grid (`1fr auto 1fr`) with left=breadcrumb, center=heading slot, right=controls
- **AND** the center slot is empty in root/board/cockpit modes (heading renders only in terminal mode)

#### R2: Breadcrumb ends at the session crumb; window identity moves to the center
The terminal-mode breadcrumb SHALL end at the session crumb. The window `BreadcrumbDropdown` (window switcher with `+ New Window`) SHALL NOT render as the trailing breadcrumb crumb; instead a small `▾` switcher button SHALL sit beside the centered heading (name-click = edit, ▾-click = switch). The window name SHALL NOT appear in both the breadcrumb and the center slot.

- **GIVEN** a terminal route with a current window
- **WHEN** the top bar renders
- **THEN** the breadcrumb shows brand › [server] › session (no trailing window crumb)
- **AND** the window name renders once, in the centered heading
- **AND** a `▾` switcher (reusing `BreadcrumbDropdown` with the window items + `+ New Window` action) sits beside the heading

#### R3: In-place rename via an identically-styled inline input
Clicking the centered heading name SHALL swap it for an inline `<input>` styled identically (monospace, centered, width sized in `ch`, grows as you type). Enter commits, Escape cancels, blur commits. Empty/whitespace-only input on commit SHALL cancel (no rename). Commit SHALL wire to the existing `renameWindow()` API via the `useOptimisticAction` + toast-on-error pattern and the optimistic window-store rename (`renameWindowStore` `pendingName` + `clearRename`), matching the sidebar's inline rename so heading and sidebar stay consistent.

- **GIVEN** the centered heading in display state
- **WHEN** the user clicks the name
- **THEN** it becomes an inline text input pre-filled with the current name, focused and selected
- **WHEN** the user presses Enter (or blurs) with a non-empty trimmed value
- **THEN** `renameWindow(server, windowId, trimmed)` is invoked optimistically and the input reverts to display state showing the new name
- **WHEN** the user presses Escape, or commits an empty/whitespace value
- **THEN** the edit is cancelled with no API call and the original name is shown

#### R4: Command-palette rename rewired to the inline edit (keyboard path)
The rename action SHALL remain reachable from the command palette (Constitution V). The EXISTING `Window: Rename` palette action (`app.tsx`, currently `dialogs.openRenameDialog`) SHALL be rewired to trigger the new inline edit via a `CustomEvent` (mirroring the `theme-selector:open` pattern) rather than opening the rename dialog. The rename dialog path SHALL be retired if the palette was its sole entry point.

- **GIVEN** a terminal route with a current window
- **WHEN** the user invokes `Window: Rename` from the command palette
- **THEN** the centered heading enters inline-edit state (not a modal dialog)
- **AND** the palette action stays registered/documented per the command-palette convention

#### R5: Decode hover animation on the heading
The heading hover animation SHALL be "decode": characters scramble through random glyphs and resolve left-to-right (~28ms/frame, reveal ~0.9 chars/step). Guards: (a) a ~140ms hover-intent delay before scramble starts so cursor transit toward the right-side buttons does not replay it; (b) on edit start the scramble timer SHALL be cancelled and the input binds to the real name state (never scrambled DOM text); (c) the decode SHALL replay once after a committed rename (rename-confirmation animation).

- **GIVEN** the heading in display state and reduced-motion NOT set
- **WHEN** the pointer hovers the heading for ≥140ms
- **THEN** the name scrambles and resolves left-to-right, settling on the real name
- **WHEN** the pointer leaves before 140ms, or edit starts
- **THEN** no scramble runs (or a running scramble is cancelled) and the real name is shown
- **WHEN** a rename commits (local or via displayed-name change)
- **THEN** the decode replays once

#### R6: Rest state reads as highlighted
The heading rest state SHALL be font-weight 600 + primary text color (surrounding crumbs are secondary, so weight+color read as highlighted).

- **GIVEN** the heading in display state
- **WHEN** it renders at rest
- **THEN** it uses `font-semibold`/weight-600 and primary text color

#### R7: Mobile single-line no-wrap; heading is the mobile leaf
On mobile (<sm) the centered heading SHALL be the visible leaf (intermediate crumbs are already `hidden sm:flex`). The 375px top bar SHALL remain single-line — long names truncate in the center cell (max-width + `truncate`), never wrap or squeeze neighbors. The `▾` switcher SHALL stay visible on mobile (it becomes the only in-bar window switcher once the crumb moves) and keep the `+ New Window` action.

- **GIVEN** a 375px viewport on a terminal route
- **WHEN** the top bar renders with a long window name
- **THEN** the bar stays one line (no wrap, no horizontal page overflow) and the name truncates
- **AND** the `▾` window switcher is visible and offers `+ New Window`

### Part B: Hover-Animation Vocabulary (CSS-only)

#### R8: Glitch = brand only
The top-left "Run Kit" brand chip SHALL get a one-shot RGB-split glitch on hover (~300ms, `text-shadow` keyframes, `steps(2)`). The wordmark is hidden below `sm`, so on mobile only the icon jitters (accepted).

- **GIVEN** the brand chip and reduced-motion NOT set
- **WHEN** the pointer hovers it
- **THEN** a one-shot ~300ms RGB-split glitch plays once

#### R9: Brackets + caret = page titles
`PageHeading` (Cockpit `/` + Server Cabin `/$server`) SHALL, on hover of the bracket group ONLY: (a) step its dim `[`/`]` bracket spans outward (`translateX(∓3px)`, no layout shift) and turn accent; (b) show a blinking block caret `▊` (1.06s `steps(1)` blink) in an ALWAYS-RESERVED cell (transparent at rest so width never shifts) before the closing bracket — after the instance name in the `[ cabin · name▊ ]` form. Hover scope SHALL be the bracket group only (not the whole heading row / rule / `side` slot).

- **GIVEN** the PageHeading and reduced-motion NOT set
- **WHEN** the pointer hovers the bracket group
- **THEN** brackets step outward + turn accent and a blinking caret appears in the reserved cell, with no layout shift
- **WHEN** the pointer hovers the rule or side text (outside the bracket group)
- **THEN** no animation triggers

#### R10: Caret-only = section labels
A blinking-caret-on-hover treatment SHALL apply to section labels: sidebar panel headings (the `collapsible-panel.tsx` uppercase title span + the sidebar `SESSIONS` heading) and the Cockpit zone subheadings (HOST HEALTH / BOARDS / TMUX SERVERS / SERVICES h2s in `server-list-page.tsx`). It SHALL be purely decorative and color-neutral (headings stay non-interactive-looking). Both idioms SHALL share one treatment (a shared utility class).

- **GIVEN** a section label and reduced-motion NOT set
- **WHEN** the pointer hovers the label
- **THEN** a blinking caret appears after the label text, color-neutral, with no layout shift
- **AND** the sidebar panel headings and Cockpit zone h2s use the same shared treatment

#### R11: CRT glint = buttons
Chip buttons in the top-bar right cluster (splits, close, Aa, bell, theme, fixed-width) and the bottom-bar `KBD_CLASS` buttons SHALL get a skewed highlight strip sweeping across the button face on hover (`::after` pseudo-element, one-shot ~450ms). Requires `overflow: hidden` on the button (verified safe — font/bell popovers are siblings of their trigger buttons, not children). One shared utility class.

- **GIVEN** a chip button and reduced-motion NOT set
- **WHEN** the pointer hovers it
- **THEN** a skewed highlight sweeps across the button face once (~450ms)
- **AND** the button's popover (font/bell) still renders fully (overflow-hidden does not clip it — it is a sibling)

#### R12: Reduced-motion gate
ALL animations (Parts A and B) SHALL be disabled entirely under `@media (prefers-reduced-motion: reduce)`. Keyframes and shared utility classes SHALL live in `globals.css` beside the existing `logo-chase` keyframes and `coarse` custom variant.

- **GIVEN** `prefers-reduced-motion: reduce` is set
- **WHEN** any hover treatment (decode, glitch, brackets+caret, caret, glint) would run
- **THEN** it is disabled — no scramble, no keyframe animation, no caret blink, no glint sweep

### Design Decisions

1. **Decode implemented in JS, all other treatments CSS-only**: The decode scramble needs per-frame random glyph substitution and left-to-right reveal keyed on the real name — a React/JS animation (timer + state). — *Why*: intake specifies exact frame timing + reveal rate + three stateful guards (hover-intent, edit-cancel, replay) that CSS keyframes cannot express. — *Rejected*: pure-CSS decode (cannot randomize glyphs or key on name state).
2. **Replay keyed on displayed-name change**: The decode replay-after-rename is implemented by keying replay on the displayed name changing, so a committed rename replays for free and an SSE-delivered external name change (and a route change to a different window) also replays. — *Why*: trivial once name-change-keyed; covers the nice-to-have (intake A17) and route-change (A22) with one mechanism. — *Rejected*: separate replay triggers per source (more code, same effect).
3. **Reuse `BreadcrumbDropdown` for the ▾ switcher**: The relocated window switcher reuses the existing `BreadcrumbDropdown` (window items + `+ New Window` action) rather than a new component. — *Why*: it already carries the a11y semantics (role=menu, Escape, arrow-nav) and the `+ New Window` action; a label-less trigger renders as a bare `▾` caret. — *Rejected*: a bespoke switcher button (duplicates a11y).
4. **Shared CSS utility classes in `globals.css`**: Glint, caret, brackets-step, and glitch ship as reusable class names / keyframes in `globals.css` (Tailwind CSS 4 `@layer`/plain CSS), applied via `className`. — *Why*: intake frames Part B as CSS-only and globals.css is the established keyframe home; utility classes let both sidebar and cockpit share one caret treatment. — *Rejected*: per-component inline `<style>` (duplication, no single reduced-motion gate).

### Non-Goals

- Backend changes — the rename endpoint (`POST /api/windows/{windowId}/rename`) already exists and is already `POST`.
- New routes / pages (Constitution IV).
- Pixel-level animation assertions in e2e (class-presence + reduced-motion emulation is the stable seam).
- Recoloring or restyling breadcrumb crumbs beyond removing the trailing window crumb.

## Tasks

### Phase 1: CSS foundation (globals.css)

- [x] T001 [P] <!-- rework DONE: dropped `overflow: hidden` from `.rk-label-caret::after` (kept width:0) so the ▊ glyph overflows the 0-width cell and paints on hover with zero layout shift; verified empirically (rest vs hover right-strip differs on fix, identical under the old clipping) --> Add Part B keyframes + shared utility classes to `app/frontend/src/globals.css`, all gated behind `@media (prefers-reduced-motion: reduce)` (disabled): (a) `.rk-glint` — `position:relative; overflow:hidden` + `::after` skewed highlight strip with a `@keyframes rk-glint-sweep` (~450ms one-shot on `:hover`); (b) `.rk-brand-glitch` — `@keyframes rk-glitch` RGB-split `text-shadow`, ~300ms `steps(2)` one-shot on `:hover`; (c) `.rk-label-caret` — blinking `▊` caret via `::after` + `@keyframes rk-caret-blink` (1.06s `steps(1)`), appears on `:hover`, color-neutral, reserved so no layout shift; (d) `.rk-bracket-group`/bracket-step classes — `translateX(∓3px)` + accent on group `:hover`, plus the reserved blinking-caret cell (`@keyframes rk-caret-blink` reused). Reduced-motion block sets `animation: none` and hides carets/sweeps. <!-- R8 R9 R10 R11 R12 -->

### Phase 2: WindowHeading component + decode (top-bar.tsx)

- [x] T002 <!-- rework DONE: (1)+(4) removed the remount `key` so the instance persists — decode now genuinely replays on window navigation (matches Design Decision 2 / doc comments) AND an in-progress edit survives; added an identity-change effect that CANCELS a stale edit on external windowId/server switch (the retired modal's window-pinned equivalent); (2) extracted the shared `useWindowRename()` hook (src/hooks/use-window-rename.ts) now used by BOTH top-bar WindowHeading and sidebar/index.tsx; (3) dropped the dead `typeof window !== "undefined"` guard in prefersReducedMotion (kept the matchMedia capability guard for jsdom); (5) added `coarse:min-h-[30px]` + inline-flex centering to the heading rename button (mobile-leaf primary affordance, matches top-bar control convention) --> Add a `WindowHeading` component in `app/frontend/src/components/top-bar.tsx` with three states — display / decode / edit. Display: centered `font-semibold text-text-primary` monospace name (R6), `max-w` + `truncate` (R7). Edit: identically-styled inline `<input>` sized in `ch` growing with content, `autoFocus` + select-on-focus; Enter commits, Escape cancels, blur commits; empty/whitespace-trim commit cancels (R3). Decode: JS scramble (~28ms/frame, ~0.9 chars/step) with 140ms hover-intent delay, edit-start cancel, and replay-once keyed on displayed-name change (R5, decision 2). Wire commit to `renameWindow()` via `useOptimisticAction` + `useToast` + the window-store `renameWindow`/`clearRename` optimistic pattern (R3). Respect `prefers-reduced-motion` in JS (skip scramble entirely). <!-- R3 R5 R6 -->
- [x] T003 Refactor the `TopBar` header row in `app/frontend/src/components/top-bar.tsx` from `flex justify-between` (line 187) to a 3-column CSS grid (`grid grid-cols-[1fr_auto_1fr] items-center`), moving the breadcrumb `<nav>` into the left cell, the right button cluster into the right cell (`justify-self-end`), and adding the center cell. Render `<WindowHeading>` + the relocated `▾` window switcher in the center cell ONLY when `mode === "terminal"` && `currentWindow`; empty center cell otherwise (R1). <!-- R1 -->
- [x] T004 In `app/frontend/src/components/top-bar.tsx`, remove the trailing window `BreadcrumbDropdown` from the breadcrumb (R2) so the breadcrumb ends at the session crumb; relocate the window switcher beside the centered heading as a label-less `BreadcrumbDropdown` (bare `▾` trigger) carrying `windowItems` + the `+ New Window` action, staying visible on mobile (R2, R7). Ensure the session crumb still renders (and the server crumb) unchanged. <!-- R2 R7 -->

### Phase 3: Palette rewire + brand glitch + right-cluster glint (top-bar.tsx, app.tsx)

- [x] T005 Rewire the `Window: Rename` palette action in `app/frontend/src/app.tsx` (line ~898) to dispatch a `CustomEvent` (e.g. `window-heading:rename`) instead of `dialogs.openRenameDialog`; add a document-level listener in `WindowHeading` (or TopBar) that enters inline-edit state (R4, decision mirrors `theme-selector:open`). Retire the now-unused window rename dialog wiring in `app.tsx`/`use-dialog-state.ts` only if the palette was its sole entry point (verify no other caller of `openRenameDialog`). Keep the palette action registered. <!-- R4 -->
- [x] T006 [P] Apply the `.rk-brand-glitch` class to the brand anchor in `app/frontend/src/components/top-bar.tsx` (line ~193) so the logo+wordmark chip glitches once on hover (R8). <!-- R8 -->
- [x] T007 [P] Apply the `.rk-glint` class to the top-bar right-cluster chip buttons in `app/frontend/src/components/top-bar.tsx` (SplitButton, ClosePaneButton, TerminalFontControl trigger, NotificationControl trigger, ThemeToggle, FixedWidthToggle) — the `rounded border border-border` chips — adding `overflow:hidden` via the utility (R11). Verify the font/bell popovers still render (siblings, not children). <!-- R11 -->

### Phase 4: PageHeading brackets+caret, section-label carets, bottom-bar glint

- [x] T008 [P] <!-- rework DONE: removed the dead `group/ph` named-group token from page-heading.tsx:41 (no `*/ph` consumer exists repo-wide) --> Update `app/frontend/src/components/page-heading.tsx`: scope a hover group to the bracket cluster only (the inner `flex items-center gap-1.5 ... max-w-[60%]` group at line 38), apply the bracket-step + accent treatment to the `[`/`]` spans, and add an always-reserved blinking-caret cell (`▊`) before the closing bracket / after the instance name (R9). No layout shift at rest; rule + `side` slot excluded from hover scope. <!-- R9 -->
- [x] T009 [P] <!-- rework DONE: applied `.rk-label-caret` to the Server Cabin "Sessions" zone subheading (session-tiles.tsx:93), restoring the one-treatment-per-category vocabulary alongside collapsible-panel, sidebar SESSIONS, and the Cockpit zone h2s --> Apply the `.rk-label-caret` treatment to the section labels: the `collapsible-panel.tsx` uppercase `title` span (line ~287) and the sidebar `SESSIONS` heading span (`sidebar/index.tsx` line ~1081), plus the Cockpit zone `h2`s (HOST HEALTH / BOARDS / TMUX SERVERS / SERVICES) in `app/frontend/src/components/server-list-page.tsx` (lines ~204, ~229, ~267, ~327). Color-neutral, decorative, shared class (R10). <!-- R10 -->
- [x] T010 [P] Apply the `.rk-glint` treatment to the bottom-bar `KBD_CLASS` buttons in `app/frontend/src/components/bottom-bar.tsx` (line 48) — add the glint class to `KBD_CLASS` (R11). <!-- R11 -->

### Phase 5: Tests + companions

- [x] T011 Update `app/frontend/src/components/top-bar.test.tsx` for the relocated window identity: the window name now renders in the centered `WindowHeading` (not a trailing `Switch window` breadcrumb crumb); update the `+ New Window` test to open the relocated `▾` switcher; add tests for the heading display/edit states (click → input, Enter commits via `renameWindow`, Escape cancels, empty-cancel) and the `window-heading:rename` CustomEvent entering edit. Add/adjust `page-heading.test.tsx` for the new reserved-caret cell decoration count. Provide the window-store/toast providers the heading needs. Run `just test-frontend`. <!-- R2 R3 R4 R5 R6 -->
- [x] T012 <!-- rework DONE: (1) removed the unused escapeRegExp helper from window-heading.spec.ts; (2) added the `section-label caret (rk-label-caret) actually appears on hover` e2e test — asserts opacity + the ▊ glyph PAINTS via a right-of-label screenshot strip (proven to FAIL under the old width:0+overflow:hidden no-op and PASS on the fix); (3) fixed the stale use-dialog-state.test.tsx:53 title (openRenameDialog → openRenameSessionDialog); (4) updated the window-heading.spec.md companion for the new test --> Add a Playwright e2e spec `app/frontend/tests/e2e/window-heading.spec.ts` + sibling `window-heading.spec.md` covering: (a) centered heading renders the current window name on a terminal route; (b) click name → inline input → type + Enter commits (name updates); (c) Escape cancels; (d) command-palette `Window: Rename` enters inline edit; (e) 375px single-line no-wrap / no horizontal overflow with the heading present; (f) animation treatments asserted via class presence + `prefers-reduced-motion` emulation (decode/glint/caret classes present with motion, gated when reduced) — NO pixel assertions. Run `just test-e2e "window-heading"`. <!-- R1 R3 R4 R7 R12 -->

## Execution Order

- T001 (CSS) blocks T006, T007, T008, T009, T010 (they apply the classes it defines).
- T002 (WindowHeading) blocks T003, T004, T005 (grid + relocation + palette rewire consume it).
- T003 blocks T004 (both edit the same header JSX; grid first, then breadcrumb relocation).
- T011, T012 depend on Phases 2–4 being complete.

## Acceptance

### Functional Completeness

- [x] A-001 R1: The top-bar header row uses a `1fr auto 1fr` grid; center cell holds the heading in terminal mode and is empty in root/board/cockpit.
- [x] A-002 R2: The breadcrumb ends at the session crumb (no trailing window crumb); the window name renders once in the centered heading with a `▾` switcher beside it.
- [x] A-003 R3: Clicking the heading opens an identically-styled inline input; Enter/blur commit via `renameWindow()` (optimistic + toast on error), Escape and empty-trim cancel.
- [x] A-004 R4: `Window: Rename` in the command palette enters the inline heading edit (via CustomEvent), and the action stays registered.
- [x] A-005 R5: Hovering the heading ≥140ms runs the decode scramble; edit-start cancels it; a committed/displayed-name-change replays it once.
- [x] A-006 R6: The heading at rest is weight-600 + primary text color.
- [x] A-007 R7: At 375px the top bar stays single-line with the heading as the leaf (long name truncates), the `▾` switcher visible with `+ New Window`, and no horizontal page overflow.
- [x] A-008 R8: The brand chip plays a one-shot RGB-split glitch on hover.
- [x] A-009 R9: PageHeading brackets step outward + accent and a reserved blinking caret appears, on bracket-group hover only, with no layout shift.
- [x] A-010 R10: Sidebar panel headings, the Server Cabin "Sessions" subheading, and Cockpit zone h2s show a shared color-neutral blinking caret on hover. — MET (T001 rework): dropped `overflow: hidden` from `.rk-label-caret::after` (kept `width: 0`) so the `▊` glyph overflows the 0-width cell and paints on hover with no layout shift; the Server Cabin "Sessions" subheading now carries the class too (T009). Verified in headless Chromium (rest-vs-hover right-of-label strip differs on the fix, identical under the old clipping) and by a new e2e guard that fails against the old no-op.
- [x] A-011 R11: Top-bar right-cluster chips and bottom-bar `KBD_CLASS` buttons show a one-shot CRT glint on hover; popovers still render.
- [x] A-012 R12: All animations are disabled under `prefers-reduced-motion: reduce`.

### Behavioral Correctness

- [x] A-013 R2: The window name is no longer duplicated (breadcrumb + center) — it appears exactly once.
- [x] A-014 R4: The window rename modal dialog path is retired if the palette was its sole entry point (no dead/duplicate rename surface); otherwise the dialog is left intact with justification.
- [x] A-015 R5: The decode never leaks scrambled text into the rename input (edit binds to real name state).

### Scenario Coverage

- [x] A-016 R3: A unit test proves click → input → Enter calls `renameWindow` with the trimmed value; Escape/empty-trim make no call.
- [x] A-017 R1 R7: An e2e test proves the centered heading renders on a terminal route and the 375px bar stays single-line with no horizontal overflow.
- [x] A-018 R12: An e2e test asserts animation classes are present with motion enabled and the treatments are gated under `prefers-reduced-motion: reduce` emulation (class-presence, not pixels).

### Edge Cases & Error Handling

- [x] A-019 R3: A failed rename surfaces a toast and rolls back the optimistic store rename (matches sidebar behavior).
- [x] A-020 R11: `overflow:hidden` on glint buttons does NOT clip the font/bell popovers (they are siblings of their triggers).

### Code Quality

- [x] A-021 Pattern consistency: New code follows the surrounding top-bar / component patterns (useOptimisticAction, useToast, BreadcrumbDropdown reuse, Tailwind class idioms), and type narrowing over `as` casts.
- [x] A-022 No unnecessary duplication: The window switcher reuses `BreadcrumbDropdown`; the caret/glint treatments are single shared utility classes; the optimistic rename reuses the existing window-store pattern rather than reimplementing it.
- [x] A-023 Test companion docs: The new Playwright spec ships a sibling `.spec.md` documenting each test (what it proves + steps) per the constitution.
- [x] A-024 Keyboard-first: The rename is reachable from the command palette and the inline input + `▾` switcher are keyboard-operable (Constitution V).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/frontend/src/app.tsx` ("Rename window" `<Dialog>` JSX + `dialogs.showRenameDialog` in the `dialogOpenRef` OR-chain) — made redundant by the centered-heading inline rename and ALREADY DELETED within this change; re-verified this review cycle: repo-wide grep finds zero surviving `openRenameDialog`/`showRenameDialog`/window-`handleRename` references.
- `app/frontend/src/hooks/use-dialog-state.ts` (`showRenameDialog`/`renameName` state, `openRenameDialog`/`closeRenameDialog`/`handleRename`, the window `executeRenameWindow` wiring + `lastRenameWindowRef`, the `renameWindow` API import) — the command palette was the dialog's sole entry point (verified) and now dispatches `window-heading:rename`; ALREADY DELETED within this change. The hook's remaining session-rename/kill state and its `windowId` option stay live (`handleKillWindow`).
- `app/frontend/src/components/sidebar/index.tsx` (the inline ~25-line `executeRenameWindow` `useOptimisticAction` block + its `lastRenameWindowRef` and `renameWindow` import) — superseded by the shared `useWindowRename()` hook and ALREADY DELETED within this change (replaced by the one-line hook call).
- Nothing further — the shared `Dialog` component (session rename/kill/create dialogs), `BreadcrumbDropdown` (whose previously fallback-only label-less `▾` trigger is now live in the center cell), `windowItems`, the `windowName` TopBar prop, and the window-store `renameWindow`/`clearRename` actions all retain live call sites; no other existing code became redundant or unreachable.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Header row becomes CSS grid `1fr auto 1fr`; heading center cell renders in terminal mode only | Intake A2/A3 — user approved; only layout that truly centers with asymmetric sides | S:95 R:90 A:90 D:90 |
| 2 | Certain | Breadcrumb ends at session; window switcher becomes a label-less `▾` `BreadcrumbDropdown` beside the heading (name=edit, ▾=switch), reusing the existing component | Intake A3 + codebase precedent (BreadcrumbDropdown already carries `+ New Window` + a11y) | S:90 R:85 A:90 D:85 |
| 3 | Certain | Inline rename via ch-sized growing input; Enter/blur commit, Escape/empty-trim cancel; wired to existing `renameWindow()` + `useOptimisticAction` + window-store `renameWindow`/`clearRename` | Intake A4/A16 — exact semantics given; sidebar precedent at index.tsx:397 | S:90 R:85 A:90 D:90 |
| 4 | Certain | Decode: ~28ms/frame, ~0.9 chars/step, 140ms hover-intent delay, edit-start cancel, replay-once keyed on displayed-name change | Intake A5 — user chose decode + the three guards explicitly | S:95 R:90 A:85 D:90 |
| 5 | Certain | Decode implemented in JS (per-frame random glyphs, name-keyed reveal); Part B treatments are CSS-only utility classes/keyframes in globals.css | Intake specifies frame timing + stateful guards CSS cannot express; frames Part B as CSS-only | S:85 R:85 A:85 D:80 |
| 6 | Certain | Vocabulary map: glitch=brand, brackets+caret=page titles, caret-only=section labels, CRT glint=buttons; all behind prefers-reduced-motion | Intake A8/A9/A10/A11/A12/A13 — user assigned the map + parameters explicitly | S:95 R:85 A:90 D:95 |
| 7 | Certain | Replay decode on displayed-name change covers committed-rename + external SSE change + route-to-other-window with one mechanism | Intake A17/A22 — nice-to-haves; trivial once name-change-keyed | S:70 R:90 A:80 D:75 |
| 8 | Confident | Rewire the EXISTING `Window: Rename` palette action (app.tsx:898) to a CustomEvent (à la `theme-selector:open`); retire the rename-dialog path only if the palette is its sole entry | Intake A15 gap-analysis — action exists; verified `openRenameDialog` callers before retiring | S:55 R:80 A:80 D:60 |
| 9 | Confident | ▾ switcher stays visible on mobile and keeps `+ New Window` (it becomes the only in-bar window switcher once the crumb moves) | Intake A18 — removing it would regress mobile window nav | S:60 R:85 A:80 D:70 |
| 10 | Confident | Long names truncate (`max-w` + `truncate`) in the center cell rather than wrap or squeeze neighbors at 375px | Intake A19 — no-wrap-at-375px requirement forces it; matches existing crumb `truncate` pattern | S:60 R:90 A:85 D:75 |
| 11 | Confident | E2E asserts heading render + inline rename + palette path + 375px no-wrap + animation class-presence with reduced-motion emulation (not pixels) | Intake A21 — constitution mandates .spec.md + e2e; class-presence is the stable CSS-animation seam | S:60 R:85 A:80 D:70 |
| 12 | Confident | Caret treatment is one shared utility class applied to both sidebar panel headings and Cockpit zone h2s | Intake A11 — user assigned both idioms to one treatment; a shared class is the DRY realization | S:60 R:90 A:85 D:75 |
| 13 | Certain | T001 rework fix: DROP `overflow: hidden` from `.rk-label-caret::after` (keep `width: 0`) rather than reserve `width: 1ch` — the glyph overflows the 0-width cell and paints with zero reserved trailing space and no layout shift | Rework note offered both; empirically both render, but width:0-no-clip avoids permanent trailing whitespace after every label; verified rest-vs-hover in headless Chromium | S:85 R:90 A:90 D:80 |
| 14 | Certain | T002 rework fix items 1+4: REMOVE the remount `key` so the WindowHeading instance persists — the decode genuinely replays on window navigation (honoring Design Decision 2 / the doc comments) and an in-progress edit is no longer destroyed; an added identity-change effect CANCELS a stale edit on external windowId/server switch (the retired modal's window-pinned equivalent) | Rework note said "make the replay actually happen; pick the honest option"; removing the key is the honest realization since DD2 already claims navigation-replay; React remount semantics are deterministic and verified by the e2e replay/edit tests | S:80 R:75 A:85 D:80 |

14 assumptions (9 certain, 5 confident, 0 tentative).

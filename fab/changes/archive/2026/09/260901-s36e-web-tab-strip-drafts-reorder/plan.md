# Plan: Web-Tab Strip Rework — Draft Tabs, Reorder, Richer Chrome

**Change**: 260901-s36e-web-tab-strip-drafts-reorder
**Intake**: `intake.md`

## Requirements

### Backend: Move Verb

#### R1: Web-tab move verb
The backend SHALL expose `POST /api/windows/{windowId}/web/{n}/move` with body `{"to": m}` beside the existing add/remove/select verbs (`api/windows_web.go`, route in `api/router.go`). A new `tmux.WebMove` in `internal/tmux/webtabs.go` MUST permute the `@rk_win_web_<n>` URL values AND their `@rk_win_web_<n>_root` companions as pairs (the `shiftWebTabs` paired-handling precedent), repoint `@rk_win_web_active` so the active pointer follows tab identity (not its old index), and keep slots dense and 1-based. Out-of-range `n` or `to` MUST return the existing `ErrWebTabRange` 400 shape; `n == to` is a no-op success. The handler MUST wake the SSE hub like the sibling verbs.

- **GIVEN** a window with tabs `[A, B, C]` and `_active = 3` (C)
- **WHEN** `POST …/web/1/move {"to": 3}` lands
- **THEN** the family reads `[B, C, A]` with roots moved alongside, and `_active` reads `2` (still C)

- **GIVEN** a window with 2 tabs
- **WHEN** `POST …/web/5/move {"to": 1}` lands
- **THEN** the response is the `ErrWebTabRange` 400 shape and no tmux write occurs

#### R2: CLI mv twin
`rk tab web mv <n> <m>` SHALL be added in `app/backend/cmd/rk/tab_web.go` beside add/rm/select/ls, accepting the same slot address grammar as rm/select (`@N/web/<n>`, `web/<n>`, or bare `<n>` on the caller's own tab; `<m>` is a bare 1-based index). It MUST stay thin (resolve address → tmux write via `WebMove` → print the resulting address on stdout) and work with `rk serve` down.

- **GIVEN** a tab with 3 web tabs, from a pane inside that tab
- **WHEN** `rk tab web mv 3 1` runs
- **THEN** slot 3's URL+root pair becomes slot 1, the others shift, and stdout prints the resulting `@N/web/1` address

### Frontend: Draft Tabs & Strip Visibility

#### R3: Client-side draft tabs
The web tile SHALL support viewer-local draft tabs: the strip's `+` (and R13's double-click) appends a dashed "new tab" entry rendered after all real tabs and focuses the address bar for it. Enter in the address bar while a draft is selected MUST materialize it through the existing add path (`onAddTab` → `POST /web`, then select the resolved index) and remove the draft; Esc or the draft's own × discards only that draft. Multiple concurrent drafts MUST be allowed. Drafts are per-window ephemeral state, dropped on window switch/unmount, and MUST never be POSTed or written to tmux options.

- **GIVEN** a window with 1 real tab and the web tile open
- **WHEN** the user clicks `+`, types `localhost:5173`, and presses Enter
- **THEN** exactly one `POST /api/windows/{id}/web` fires, the new slot is selected, the draft disappears, and tmux holds 2 dense slots

- **GIVEN** two open drafts
- **WHEN** the user presses Esc with the second selected
- **THEN** only the second draft disappears and no POST fires

#### R4: NEW-TAB arm mode retirement
The one-shot NEW-TAB arm mode on the address bar SHALL be removed: the arm/disarm logic in `iframe-window.tsx`, the `+`-with-empty-draft arm branch, and the `web-address:focus` `detail.newTab` plumbing (`WEB_ADDRESS_FOCUS_EVENT` consumers in `lib/web-url.ts` / `iframe-window.tsx`). The palette entry `Web: New tab from address` (id `web-tab-new`) SHALL be replaced by a draft-opening `Web: New tab` entry in `lib/palette/web-tabs.ts`, offered at ≥1 tab. `Web: Focus address bar` (plain, no newTab detail) survives unchanged.

- **GIVEN** the reworked tile
- **WHEN** the codebase is searched for the arm mode (`detail.newTab`, the one-shot arm state)
- **THEN** no functional references remain (spec/memory prose updates ride R14/hydrate)

- **GIVEN** a window with 1 tab
- **WHEN** the palette runs `Web: New tab`
- **THEN** the mounted web tile opens a draft and focuses the address bar

#### R5: Always-visible strip
The strip SHALL render whenever `tabs.length >= 1` OR at least one draft exists (retiring the `tabs.length >= 2` gate), so `+` is always reachable from any window with a tab. Onboarding (empty family, no drafts) keeps today's stripless chrome, and the palette `Web: New tab` entry is absent at 0 tabs (onboarding's address bar is the sole entry there).

- **GIVEN** a window with exactly 1 web tab
- **WHEN** the web tile renders
- **THEN** the tab strip is present with the single tab and the `+` affordance

- **GIVEN** a window with 0 web tabs and no drafts
- **WHEN** the web tile renders
- **THEN** the onboarding state renders with no strip

### Frontend: Reorder

#### R6: Drag-to-reorder
The strip SHALL support pointer-based drag-to-reorder with a drop-side indicator on the hovered target tab (per the approved design study `web-tab-strip-design-study.html`). Drop commits one move via the R9 wiring; a sub-threshold pointer movement stays a click (select). Draft tabs are not drag targets or sources.

- **GIVEN** tabs `[A, B, C]`
- **WHEN** the user drags A past B and drops on B's right half
- **THEN** one move POST fires (`n=1, to=2`) and the strip shows `[B, A, C]`

#### R7: Keyboard move-tab keys
The focused tablist SHALL support ⌥⇧←/⌥⇧→ to move the active tab one slot left/right, implemented component-local in the strip's existing roving-tablist keydown handler (beside ←/→/Home/End/Enter/Delete). They MUST NOT be registered in the keybinding registry (`matchesCombo` rejects Alt by design — "Alt is no tier"; component-local is the Alt+1–9 shell-switcher territory). At a boundary the key is a no-op.

- **GIVEN** the strip focused with the active tab at slot 2 of 3
- **WHEN** ⌥⇧→ is pressed
- **THEN** the active tab moves to slot 3 and remains active

#### R8: Palette move entries
`buildWebTabActions` (`lib/palette/web-tabs.ts`) SHALL add `Web: Move tab left` / `Web: Move tab right` (ids `web-tab-move-left` / `web-tab-move-right`) acting on the active tab, offered at ≥2 tabs like the next/prev/close entries, POSTing the move directly (the palette's non-optimistic convention) with an error toast on rejection. Boundary entries are omitted, not disabled (the `Tab: Move up/down` boundary-exclusion precedent).

- **GIVEN** 3 tabs with slot 1 active
- **WHEN** the palette opens
- **THEN** `Web: Move tab right` is listed and `Web: Move tab left` is absent

#### R9: Optimistic move
Move SHALL ride the existing `webOverride` optimistic machinery: a pure `webFamilyAfterMove(tabs, active, n, to)` beside `webFamilyAfterRemove` in `store/window-store.ts` (display-only mirror of the backend permute+repoint rule), wired in `surface-layout.tsx` like select/remove — compounding on in-flight overrides, SSE reconcile clears, rejection reverts + toasts. A `moveWebTab(server, windowId, n, to)` client helper joins add/remove/select in `api/client.ts`.

- **GIVEN** an in-flight move override
- **WHEN** a second move lands before the SSE tick
- **THEN** the second override compounds on the first's family, not the stale payload

Rejection semantics (added in review cycle 3): move POSTs are serialized in order, and a REJECTED move MUST cancel every queued dependent move whose indices were computed from the now-rolled-back optimistic family — the override reverts to the SSE-confirmed family, the queued dependents never fire, and one error toast surfaces. Dependent moves are never "rebased" onto the reverted family (a silent reinterpretation of the user's gesture); they are dropped.

- **GIVEN** tabs `[A, B, C]` with an optimistic move 1→2 in flight and a second move 2→3 queued on its result
- **WHEN** the first POST is rejected
- **THEN** the queued 2→3 is cancelled (no POST fires), the strip reverts to `[A, B, C]`, and a toast reports the failure

### Frontend: Tab Chrome

#### R10: Per-frame page titles
The active-frame-only `onPageMeta` title read SHALL extend per-frame: every same-origin frame reports its document title on load into the URL-keyed chrome-state map, and each tab's label shows its tracked title, falling back to `webTabTitle(url)`. Titles stay display-only — never POSTed, never written to tmux. The tile header's active-tab title behavior is unchanged.

- **GIVEN** two same-origin tabs whose documents carry titles
- **WHEN** both frames have loaded
- **THEN** both tab labels show document titles while only the active tab's title feeds the tile header

- **GIVEN** a cross-origin tab
- **WHEN** its title is unreadable
- **THEN** its label falls back to `webTabTitle(url)`

#### R11: Favicons
Each tab SHALL show a favicon in its icon slot: same-origin frames read the document's icon `<link>` (absent → the frame origin's `/favicon.ico`); `external`-kind tabs use `https://{host}/favicon.ico`. The `classifyAddress` kind-dot (green present / amber proxy / blue external) remains the fallback for kinds without an icon source and for missing/failed icon loads (an `onerror` degrade, never a broken-image glyph).

- **GIVEN** an external tab whose host serves no favicon
- **WHEN** the icon fetch fails
- **THEN** the tab shows the blue external kind-dot

#### R12: Per-tab load spinner
While a frame loads, its tab's icon slot SHALL show a spinner derived from `WebFrame`'s existing per-frame load state, replaced by the favicon/kind-dot on load. Under `prefers-reduced-motion` the spinner renders as a static treatment (the load-progress-line precedent: feedback is never motion-only).

- **GIVEN** a tab whose frame is mid-load
- **WHEN** the strip renders
- **THEN** that tab shows the spinner and other tabs show their icons

#### R13: Muscle-memory gestures
Middle-click (`auxclick`, button 1) on a tab SHALL close it through the same `onCloseTab` path as ×. Double-click on empty strip space SHALL open a draft (R3).

- **GIVEN** 3 tabs
- **WHEN** the user middle-clicks tab 2
- **THEN** the remove verb fires for slot 2 and the family renumbers densely

### Specs

#### R14: Spec updates
`docs/specs/ui-state.md` SHALL be updated as part of this change: § Web Tabs — the strip-visibility rule (renders at ≥1 tab or draft; hidden only in onboarding), move semantics (dense permute + active repoint), and a draft-tab note distinguishing viewer-local drafts from declared tabs; § `rk tab` — the `web mv` row in the verb listing.

- **GIVEN** the shipped change
- **WHEN** `docs/specs/ui-state.md` is read
- **THEN** § Web Tabs and § `rk tab` describe the move verb, the visibility rule, and drafts

### Non-Goals

- Raising the 8-slot family cap — discussed, deliberately out of scope.
- Any new tmux option — drafts are client-side; move permutes existing values.
- Changing add idempotence, URL identity, slot density, frame mount policy (hidden-never-unmounted, URL-keyed), or agent flows (`rk tab web add`, `rk present`).
- Reordering across windows or persisting drafts.

### Design Decisions

#### Draft tabs are viewer-local, not a stored sentinel
**Decision**: The empty-tab flow is client-side draft state that materializes into a real slot on first Enter; nothing lands in tmux until an address exists.
**Why**: A stored blank fights three spec decisions at once — identity-is-the-URL (two blanks collide with idempotent add), "absent and empty read alike as unset" (an empty option value cannot exist), and "declared only". The One Rule classes drafts as viewer preferences (the compose-draft class).
**Rejected**: An `about:blank`/`/newtab` sentinel URL — needs an idempotence exemption and makes blanks shared state with no shared content.
*Introduced by*: 260901-s36e-web-tab-strip-drafts-reorder

#### Move-tab keys are component-local, not registry chords
**Decision**: ⌥⇧←/⌥⇧→ live in the strip's roving-tablist keydown handler; palette entries carry the discoverable parity.
**Why**: The keybinding registry rejects all Alt chords by design (`matchesCombo` drops `e.altKey`; macOS character composition), and the strip's ←/→/Home/End/Enter/Delete are already component-local. Arrows compose no characters, so the Alt objection doesn't apply inside the tablist.
**Rejected**: Registry-registered chords — structurally impossible without weakening the Alt exclusion for every surface.
*Introduced by*: 260901-s36e-web-tab-strip-drafts-reorder

## Tasks

### Phase 1: Backend + CLI

- [x] T001 Add `WebMove(ctx, server, windowID, n, to)` to `app/backend/internal/tmux/webtabs.go` — permute URL+`_root` pairs, repoint `@rk_win_web_active` to follow the moved tab's identity, `ErrWebTabRange` on out-of-range, `n == to` no-op; unit tests in `webtabs_test.go` covering active-follows-identity, root pairing, boundaries <!-- R1 -->
- [x] T002 Add `handleWindowWebMove` to `app/backend/api/windows_web.go` (decode `{"to": m}`, `webSlotParam` for `n`, 400 on range errors, wake the SSE hub) and register `POST /api/windows/{windowId}/web/{n}/move` beside the sibling routes in `app/backend/api/router.go`; handler tests in `windows_web_test.go` <!-- R1 -->
- [x] T003 [P] Add `mv` subcommand to `app/backend/cmd/rk/tab_web.go` with the rm/select address grammar (bare `<n>`, `web/<n>`, `@N/web/<n>`; `<m>` bare index), printing the resulting address on stdout; tests beside the existing tab-web CLI tests; help text conforming to the `shll standards` help posture used by its siblings <!-- R2 -->

### Phase 2: Frontend Core

- [x] T004 [P] Add pure `webFamilyAfterMove(tabs, active, n, to)` beside `webFamilyAfterRemove` in `app/frontend/src/store/window-store.ts` + unit tests (`window-store.test.ts`) mirroring the backend permute+repoint rule <!-- R9 -->
- [x] T005 [P] Add `moveWebTab(server, windowId, n, to)` beside add/remove/select in `app/frontend/src/api/client.ts` (same `withServer` + `throwOnError` shape) <!-- R1 -->
- [x] T006 Implement draft-tab state and rendering in `app/frontend/src/components/iframe-window.tsx`: draft list rendered after real tabs (dashed styling per the design study), `+` opens a draft and focuses the address bar, Enter materializes via `onAddTab` → select → remove draft, Esc / draft × discards, multiple drafts, per-window lifetime (state keyed/reset on the tile's window key) <!-- R3 -->
- [x] T007 Change the strip visibility gate in `iframe-window.tsx` from `tabs.length >= 2` to `tabs.length >= 1 || drafts.length > 0`, keep onboarding stripless, and keep `+` rendered with the strip <!-- R5 -->
- [x] T008 Retire the NEW-TAB arm mode: remove the one-shot arm state and `+`-empty-draft arm branch from `iframe-window.tsx`, drop `detail.newTab` handling from the `web-address:focus` seam (`lib/web-url.ts` consumers), and replace `Web: New tab from address` with the draft-opening `Web: New tab` (id `web-tab-new`, gated ≥1 tab) in `app/frontend/src/lib/palette/web-tabs.ts` + its wiring in `app.tsx` (the palette entry dispatches the tile's draft-open seam); update `palette/web-tabs.test.ts` <!-- R4 -->
- [x] T009 Wire optimistic move in `app/frontend/src/components/surface-layout.tsx`: `onMoveTab(n, to)` prop into `IframeWindow`, `useOptimisticAction` over `webOverride` with `webFamilyAfterMove`, POST via `moveWebTab`, reconcile/revert/toast per the select/remove pattern <!-- R9 -->
- [x] T010 Implement pointer drag-to-reorder in the strip (`iframe-window.tsx`): drag threshold so clicks stay selects, drop-side indicator on the hovered tab per the design study, drop commits one `onMoveTab`; drafts excluded from drag <!-- R6 -->
- [x] T011 [P] Add ⌥⇧←/⌥⇧→ to the strip's roving-tablist keydown handler in `iframe-window.tsx` (move active tab via `onMoveTab`, boundary no-op, component-local only) <!-- R7 -->
- [x] T012 [P] Add `Web: Move tab left` / `Web: Move tab right` to `buildWebTabActions` (`lib/palette/web-tabs.ts` + tests): ≥2 tabs, boundary entries omitted, direct `moveWebTab` POST with error toast <!-- R8 -->

### Phase 3: Tab Chrome & Gestures

- [x] T013 Extend per-frame title tracking in `iframe-window.tsx`/`WebFrame`: every same-origin frame reports its document title on load into the URL-keyed chrome-state map; tab labels prefer the tracked title with `webTabTitle(url)` fallback; the tile-header/`onPageMeta` active-tab behavior unchanged <!-- R10 -->
- [x] T014 Add favicon + spinner to the tab icon slot in `iframe-window.tsx`: same-origin document icon `<link>` (else frame-origin `/favicon.ico`), external `https://{host}/favicon.ico`, kind-dot fallback on missing/failed load (`onerror`); spinner from `WebFrame`'s per-frame load state, static under `prefers-reduced-motion` <!-- R11, R12 -->
- [x] T015 [P] Add gestures in `iframe-window.tsx`: `auxclick` button-1 close via `onCloseTab`, double-click on empty strip space opens a draft; update `iframe-window.test.tsx` for drafts, visibility, gestures, and label fallback <!-- R13 -->

### Phase 4: e2e + Specs

- [x] T016 Extend `app/frontend/tests/e2e/web-tabs.spec.ts` (real-tmux rig, `stampWebTabs` seeding): always-visible strip at 1 tab, draft open/materialize/discard (tmux family asserted via `_tmux.ts`), reorder via drag + ⌥⇧arrows + palette with `@rk_win_web_<n>`/`_active` permutation asserted, middle-click close renumber; every new `test()` carries the Constitution Test Intent JSDoc (Proves/Steps) and the file header notes new shared setup <!-- R3, R5, R6, R7, R8, R13 -->
- [x] T017 [P] Update `docs/specs/ui-state.md`: § Web Tabs strip-visibility rule + move semantics + viewer-local draft note; § `rk tab` gains the `web mv` row <!-- R14 -->

## Execution Order

- T001 → T002 (handler needs `WebMove`); T003 needs T001.
- T004, T005 → T009 (wiring needs helper + client verb); T009 → T010/T011/T012 (all reorder surfaces commit through `onMoveTab`/`moveWebTab`).
- T006 → T007, T008, T015 (visibility, arm retirement, and dblclick reference draft state).
- T016 last (exercises everything); T017 independent.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `POST /api/windows/{id}/web/{n}/move {"to": m}` permutes URL+root pairs, repoints `_active` to follow tab identity, keeps slots dense; Go tests cover it
- [x] A-002 R2: `rk tab web mv` exists with the rm/select address grammar, prints the resulting address, works with `rk serve` down
- [x] A-003 R3: Draft tabs open from `+`, materialize on Enter through one add POST + select, discard on Esc/×, allow multiple, and never touch tmux
- [x] A-004 R5: The strip renders at 1 tab (and with any draft); onboarding stays stripless
- [x] A-005 R6: Drag-to-reorder works with a drop-side indicator and commits exactly one move per drop
- [x] A-006 R7: ⌥⇧←/→ move the active tab from the focused tablist; no registry entry was added
- [x] A-007 R8: `Web: Move tab left/right` palette entries exist at ≥2 tabs with boundary omission
- [x] A-008 R10: Tab labels show tracked per-frame titles with `webTabTitle` fallback
- [x] A-009 R11: Favicons render per the source rules with kind-dot fallback on failure
- [x] A-010 R12: A loading frame's tab shows the spinner; reduced motion gets a static form
- [x] A-011 R13: Middle-click closes a tab; double-click on empty strip space opens a draft
- [x] A-012 R14: `docs/specs/ui-state.md` § Web Tabs and § `rk tab` describe move, visibility, and drafts

### Behavioral Correctness

- [x] A-013 R4: The NEW-TAB arm mode and `detail.newTab` plumbing are gone; `Web: New tab` (draft-opening, ≥1 tab) replaces `Web: New tab from address`; `Web: Focus address bar` still works plain
- [x] A-014 R9: Optimistic move compounds on in-flight overrides, reconciles on the SSE tick, reverts + toasts on rejection
- [x] A-015 R1: `n == to` is a no-op success; the move handler wakes the SSE hub (repaint does not wait for the safety poll)

### Removal Verification

- [x] A-016 R4: No functional references to the arm mode remain in `app/frontend/src` or `app/frontend/tests` (grep `detail.newTab` / the arm state; the removal sweep includes e2e specs)

### Scenario Coverage

- [x] A-017 R1: The R1 GIVEN/WHEN/THEN permute+repoint scenario is exercised by a Go test asserting active-follows-identity
- [x] A-018 R3, R6, R7, R8, R13: The new e2e cases in `web-tabs.spec.ts` cover drafts, all three reorder surfaces, and middle-click, each with a Test Intent JSDoc

### Edge Cases & Error Handling

- [x] A-019 R1: Out-of-range `n`/`to` returns the `ErrWebTabRange` 400 shape with zero tmux writes
- [x] A-020 R3: Materializing a draft whose URL already exists in the family rides add idempotence (existing index returned + selected; the draft still clears)
- [x] A-021 R7: Boundary ⌥⇧ presses and single-tab moves are silent no-ops (no POST)
- [x] A-022 R11: A failed favicon load degrades to the kind-dot, never a broken image
- [x] A-030 R9: A rejected move cancels every queued dependent move (no stale-index POST fires), the override reverts to the SSE family, one toast surfaces; a rejection-chain unit test pins it
- [x] A-031 R2: The parent `rk tab --help` summary names `mv` among the web verbs (help contract)

### Code Quality

- [x] A-023 Pattern consistency: New code follows naming/structure of surrounding code (verb handlers mirror siblings; palette builder stays pure; strip keys stay in the roving handler)
- [x] A-024 No unnecessary duplication: reuses `webOverride`/`useOptimisticAction`, `classifyAddress`/`webTabTitle`, `WebFrame` load state, existing CLI address resolution
- [x] A-025 Go subprocess discipline: all new tmux interaction goes through `internal/tmux/` with `exec.CommandContext` + timeout (no shell strings)
- [x] A-026 Type narrowing over assertions in new frontend code; no `as` casts where a guard serves
- [x] A-027 No client polling: repaint rides the SSE stream (hub wake), no `setInterval` + fetch
- [x] A-028 Tests included for added behavior: Go verb tests, `window-store`/palette/component unit tests, e2e extensions

### Security

- [x] A-029 R1: The move endpoint validates `windowId`, `n`, and `to` before any tmux call (integer parse + range; the `validate` posture of sibling handlers); no new scheme surface is introduced (favicon URLs are derived, never stored)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- The approved UI authority for all states is `web-tab-strip-design-study.html` in this change folder.

## Deletion Candidates

None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The palette's `Web: New tab` reaches the tile through a document-CustomEvent draft-open seam (the `web-find:open` single-receiver precedent), replacing the `detail.newTab` arm dispatch | The one-IframeWindow-per-layout receiver pattern is established; exact event name is apply's call | S:70 R:85 A:85 D:75 |
| 2 | Confident | `webFamilyAfterMove` lives in `store/window-store.ts` beside `webFamilyAfterRemove`; the client verb `moveWebTab` beside its siblings in `api/client.ts` | Direct codebase inspection places the existing helpers there | S:80 R:90 A:90 D:85 |
| 3 | Confident | Favicon loads use plain `<img>` with `onerror` fallback to the kind-dot; no backend proxy or caching for icons | Simplest mechanism; a failed load degrades exactly like a missing icon; no new API surface | S:65 R:85 A:80 D:70 |
| 4 | Confident | Keyboard/palette move surfaces ride the same optimistic `onMoveTab` wiring as drag (single commit path), while palette entries POST directly per the established palette non-optimistic convention | Mirrors the existing select/remove split between strip verbs and palette verbs | S:70 R:85 A:80 D:75 |
| 5 | Tentative | Same-origin favicon resolution reads the document's `<link rel~="icon">` at the frame's `load` event with the frame-origin `/favicon.ico` as fallback <!-- assumed: same-origin icon read at load-event time — the chord-reclaim attach seam is the established per-load hook; cross-origin frames skip silently --> | The attach-seam posture (try/catch, per-navigation re-attach) is established, but icon-link reading specifics have no in-repo precedent | S:55 R:80 A:60 D:55 |

5 assumptions (0 certain, 4 confident, 1 tentative).

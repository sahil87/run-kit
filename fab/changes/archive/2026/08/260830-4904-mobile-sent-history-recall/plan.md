# Plan: Mobile Sent-History Recall

**Change**: 260830-4904-mobile-sent-history-recall
**Intake**: `intake.md`

## Requirements

### Compose Strip: Sent-History Recall Affordance

#### R1: A history chip in the compose card
`ComposeStrip` SHALL render a keyed `↑` chip sibling in its card-form chip row (`app/frontend/src/components/compose-strip.tsx`) whenever the current draft target's sent history is non-empty. The chip MUST follow the established chip conventions of its siblings: `onMouseDown={preventFocusSteal}`, the shared `chipTone`, `rk-glint`, and the coarse touch-target floor (`coarse:min-h-[36px] coarse:min-w-[36px]`). The chip MUST NOT be gated on an empty composer, and MUST NOT be gated on pointer type.

- **GIVEN** a focused terminal target whose `getComposeSentHistory(draftKey)` is empty
- **WHEN** the strip renders in card form
- **THEN** no history chip is present

- **GIVEN** a focused terminal target with at least one recorded send
- **WHEN** the strip renders in card form (coarse: textarea focused / multi-line / attachments; fine: draft presence or the latch)
- **THEN** the `↑` history chip renders in the chip row, enabled, on both coarse and fine pointers
- **AND** it stays enabled while the composer holds text

#### R2: A portalled flyout listing recent sends
Tapping the chip SHALL open a flyout listing that target's sent history, newest first, rendered through `FloatingPortal` with `strategy: "fixed"`. The flyout MUST be mounted only while open, MUST anchor to the chip, MUST prefer a placement above the chip (the strip is docked at the bottom of the viewport) with a flip fallback, MUST cap its own width and height against the viewport, and MUST dismiss on Escape and on outside press. Each row MUST render the entry in monospace with whitespace preserved and be clamped to about two lines. The flyout MUST NOT move focus on open and MUST NOT steal focus from the textarea when a row is pressed.

- **GIVEN** the history chip is rendered
- **WHEN** the user taps it
- **THEN** a portalled flyout opens listing every stored entry for that target, newest first, capped at the store's 10

- **GIVEN** the flyout is open at a 375px-wide viewport
- **WHEN** the page's horizontal extent is measured
- **THEN** `document.body.scrollWidth` has not grown past the viewport width (the `strategy: "fixed"` containment contract)

- **GIVEN** the flyout is open
- **WHEN** the user presses Escape or clicks outside it
- **THEN** the flyout closes and nothing is written to the draft

#### R3: A row loads the entry into the composer and never re-sends
Selecting a flyout row SHALL write that entry's text into the current draft via the strip's store setter, close the flyout, and return focus to the textarea. It MUST NOT transmit anything — no relay `send`, no `POST /paste`, no `pushComposeSentHistory`.

- **GIVEN** the flyout is open over a live, OPEN relay target
- **WHEN** the user selects a row
- **THEN** the textarea holds that entry's exact stored text, the flyout is closed, the textarea is focused
- **AND** no bytes were written to the websocket and the sent history is unchanged

#### R4: Loading an entry ends any in-progress recall walk
A flyout load is a programmatic text mutation, so it SHALL call `endRecall()` — the same discipline `handleUpload` and `removeFile` already follow. A subsequent `↑` MUST therefore start a fresh walk from the newest entry rather than stepping from a stale index.

- **GIVEN** an in-progress `↑`/`↓` walk (`recallIndexRef` past the newest entry)
- **WHEN** the user loads an older entry from the flyout
- **THEN** the walk is torn down
- **AND** the next `↑` on the loaded (non-empty) text is left native, and the next `↑` after clearing the composer recalls the NEWEST entry, not the one after the abandoned index

#### R5: Palette registration
A `Compose: Recall sent…` action SHALL be registered in the command palette (`app/frontend/src/app.tsx`, alongside `View: Text Input` / `Compose: Focus`), offered when a session is resolved AND the compose strip is enabled. It SHALL reach the mounted strip through a module-level opener registry in `app/frontend/src/lib/compose-strip-events.ts`, mirroring the shipped `registerComposeStripFocuser` / `focusComposeStrip` pair — production code MUST NOT locate the strip by test id. The opener MUST decline (return `false`) when there is no target or no history, and a decline MUST be a silent no-op.

- **GIVEN** the compose strip is enabled and its target has sent history
- **WHEN** the user runs `Compose: Recall sent…` from the palette
- **THEN** the recall flyout opens, identically to a chip tap

- **GIVEN** the compose strip is enabled but its target has no sent history
- **WHEN** the user runs the action
- **THEN** the opener declines and nothing visible happens

- **GIVEN** the compose strip is disabled
- **WHEN** the palette is opened
- **THEN** `Compose: Recall sent…` is not offered

### Non-Goals

- **No change to the sent-history store.** `app/frontend/src/lib/compose-draft-store.ts` is read-only for this change — no schema change, no new localStorage key, no new prune policy, no new subscriber seam.
- **No change to send semantics or the Enter matrix.** The transports, the clear-on-delivery rule, `classifyComposeEnter`, and the wire bytes are untouched.
- **No touch port of the `↑`/`↓` walk.** The keyboard walk stays exactly as shipped; the flyout is an additional reader of the same store.
- **No "send again" row action.** Rows load only.
- **No new mobile sheet primitive.** The flyout is a small local floating-ui surface, not a new shared component family.

### Design Decisions

#### A list, not a touch port of the walk
**Decision**: Reach the per-target sent history on touch through a tappable, newest-first list opened from an `↑` chip in the compose card, leaving the `↑`/`↓` keyboard walk untouched as the power path.
**Why**: The walk exists because a textarea has arrow keys lying around, not because a blind linear scan is good recovery UX. Touch devices have no arrow keys at all, so the store the strip already writes on every send (`pushComposeSentHistory`, cap 10) is unreachable precisely on the device where a silently-swallowed send hurts most. A list shows every candidate at once and costs no keyboard.
**Rejected**: Long-press on Send (collides with iOS text-selection and context menus, and hides recovery behind the button that caused the loss); swipe-down on the textarea (undiscoverable, fights scroll, no gesture vocabulary on the strip); a timed "Sent · Undo" pill (wrong lifetime — a lost prompt is noticed after waiting on the pane, not within seconds).
*Introduced by*: 260830-4904-mobile-sent-history-recall

#### A row loads into the composer and never re-sends
**Decision**: Selecting a flyout row writes the entry into the draft, closes the flyout, and focuses the textarea. It transmits nothing.
**Why**: Delivery is unverifiable at all three hops (queued relay bytes, a discarded `ptmx.Write` error, a TUI that swallows the bytes at a prompt), which is the whole reason the history exists. Blind re-send of a prompt whose delivery could not be confirmed is exactly how a double-send happens — the user must be able to see the candidate in the composer and decide.
**Rejected**: A secondary "send again" affordance per row — it optimizes the case the feature cannot verify.
*Introduced by*: 260830-4904-mobile-sent-history-recall

#### A local floating-ui surface, not `useRowFlyout`
**Decision**: The flyout is a small dedicated component (`compose-history-flyout.tsx`) built directly on `@floating-ui/react` — `FloatingPortal` + `strategy: "fixed"` + `flip`/`shift`/`size` + `useDismiss` — rather than a reuse of `sidebar/row-flyout-card.tsx`'s `useRowFlyout`.
**Why**: `useRowFlyout` is anchored on the premise that its reference is a full-bleed sidebar ROW. Its coarse arm caps the card at `rects.reference.width - STATUS_RAIL_WIDTH_PX - 8` (floored at 120px), so a 36px chip reference yields a 120px-wide card on exactly the pointer type this change targets. It also carries a rail-scrub registry, a held-row tint contract, a row-aligned notch, and hover/focus row triggers that a chip must not inherit. Parameterizing that shared hook would put a heavily-covered three-tier sidebar surface at risk for a compose-strip feature.
**Rejected**: `useRowFlyout` with `coarseOnly` (same 120px cap, and it forces the sidebar placement arm); a `PinPopover`-style non-portalled `absolute` popover (`.app-shell` and the terminal column both set `overflow: hidden`, so a popover rising above the docked strip would be clipped).
*Introduced by*: 260830-4904-mobile-sent-history-recall

#### The chip lives in the card form on both pointers
**Decision**: The chip renders in the card form only — on coarse and fine pointers alike — and is gated solely on the target's history being non-empty.
**Why**: On coarse pointers `isCard` is already `textFocused || multiline || files.length > 0`, so tapping the composer opens the card and the chip is one tap away with no new state to reach. The compact row at 375px has no width budget for another chip. On fine pointers the same list is strictly better than the walk for the recovery job, so shipping one mental model beats a mobile-only dialect; the compact (empty-composer) state there is already covered by `↑` and by the palette action.
**Rejected**: A coarse-only chip (creates a mobile dialect); rendering in the compact row too (blows the 375px single-row budget the bottom-bar/compose sizing work pinned).
*Introduced by*: 260830-4904-mobile-sent-history-recall

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add a module-level recall-opener registry to `app/frontend/src/lib/compose-strip-events.ts`, mirroring the existing focuser pair exactly: `registerComposeRecallOpener(open: () => boolean): () => void` (unregisters only if the slot still points at this opener) and `openComposeRecall(): boolean` (returns `false` when nothing is registered or the strip declines). Document the slot in the file's existing comment idiom. <!-- R5 -->
- [x] T002 Add `app/frontend/src/components/compose-history-flyout.tsx` — a `ComposeHistoryFlyout` component taking `{ anchor: HTMLElement | null; entries: readonly string[]; onSelect: (entry: string) => void; onClose: () => void }`. Build it on `@floating-ui/react`: `useFloating({ open: true, elements: { reference: anchor }, placement: "top-start", strategy: "fixed", middleware: [offset(6), flip({ fallbackPlacements: ["bottom-start"] }), shift({ padding: 8 }), size(...)], whileElementsMounted: autoUpdate })` with `useDismiss` and `useRole({ role: "dialog" })`; render inside `FloatingPortal` + `FloatingFocusManager` (`modal={false}`, `initialFocus={-1}`, `returnFocus={false}`, `order={["reference", "content"]}`). `size()` caps `maxWidth`/`maxHeight` against the middleware's `availableWidth`/`availableHeight` so the card never grows the page. Rows are a `<ul>` of full-width `<button>`s carrying `onMouseDown` focus-steal prevention, `coarse:min-h-[36px]`, monospace `text-xs`, `whitespace-pre-wrap`, and `line-clamp-2`; the container wears `bg-bg-card border border-border rounded-md rk-popup-elev`. Add `data-testid="compose-history-flyout"` on the card and `data-testid="compose-history-entry"` on each row. Carry a file-header comment stating the fixed-strategy containment constraint and the loads-never-sends contract. <!-- R2 -->
- [x] T003 Wire the chip and flyout into `app/frontend/src/components/compose-strip.tsx`: read `getComposeSentHistory(draftKey)` at render (documenting why the non-subscribed read is sufficient — a delivered send clears the draft, which notifies the store seam, and a target switch re-renders too); hold `historyOpen` state and the chip element in state for the floating anchor; add a keyed `historyChip` descriptor (glyph `↑`, `aria-label="Recall sent text"`, `data-testid="compose-strip-history"`, `onMouseDown={preventFocusSteal}`, shared `chipTone`/`rk-glint`, `coarse:min-h-[36px] coarse:min-w-[36px]`) rendered in the card branch of the render body when the history is non-empty; render `<ComposeHistoryFlyout>` while open; on row select call `endRecall()`, write the entry through the existing `setText` setter, close, and focus the textarea. Register/unregister the recall opener (declining when `draftKey === null` or the history is empty). Extend the component's file-header comment with the recall-list affordance. <!-- R1 --> <!-- R3 --> <!-- R4 -->
- [x] T004 Register the `Compose: Recall sent…` palette action in `app/frontend/src/app.tsx`'s `viewActions` memo beside `text-input` / `compose-focus` — id `compose-recall`, offered when `sessionName` resolves AND `composeStripEnabled` is true, `onSelect: () => { openComposeRecall(); }`. Note in a comment why it is gated on the strip being enabled (the action operates on the mounted strip's live target and history; the sibling `Compose: Focus` already owns the open-the-strip verb) and why the decline is a silent no-op. <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T005 Extend `app/frontend/src/components/compose-strip.test.tsx` under the existing sent-history section: the chip is absent with empty history and appears once a send records one; it renders in the card form on both pointer types (via the file's `stubPointer` helper) and stays enabled with text in the composer; tapping it opens the flyout listing entries newest-first; selecting a row loads that exact text, closes the flyout, and sends nothing (the fake ws records no writes and `getComposeSentHistory` is unchanged); a load ends an in-progress walk (after loading, clear the composer and assert `↑` recalls the NEWEST entry); `openComposeRecall()` opens the flyout and declines (`false`) with no history and with no target. <!-- R1 --> <!-- R2 --> <!-- R3 --> <!-- R4 --> <!-- R5 -->
- [x] T006 Add a Playwright test to the existing `coarse pointer card morph` describe in `app/frontend/tests/e2e/compose-strip.spec.ts` (375×812, `hasTouch: true`), with the constitution-required `Proves:`/`Steps:` JSDoc: send a line through the strip so history is recorded, tap the `↑` chip, assert the flyout lists the sent text, assert `document.body.scrollWidth <= 375` while it is open (the fixed-strategy containment regression), tap the row, assert the textarea holds the text and the flyout is gone, and assert the pane received nothing new (the loads-never-sends contract). Update the spec file's header comment to cover the new affordance. <!-- R2 --> <!-- R3 -->

## Execution Order

- T001 and T002 are independent; T003 depends on both; T004 depends on T001; T005 depends on T003 and T004; T006 depends on T003.

## Acceptance

### Functional Completeness

- [x] A-001 R1: The `↑` history chip renders in the compose card exactly when the current target's sent history is non-empty, on both coarse and fine pointers, and is not gated on composer emptiness.
- [x] A-002 R2: Tapping the chip opens a portalled, `strategy: "fixed"` flyout listing that target's stored sends newest-first.
- [x] A-003 R3: Selecting a row writes the entry into the composer, closes the flyout, and focuses the textarea.
- [x] A-004 R4: A flyout load calls `endRecall()`, so a later `↑` starts a fresh walk from the newest entry.
- [x] A-005 R5: `Compose: Recall sent…` is registered in the palette, reaches the strip through the module opener registry (no test-id lookup in production code), and is offered only when the strip is enabled.

### Behavioral Correctness

- [x] A-006 R3: No transmission path is reachable from the flyout — selecting a row performs no relay `send`, no `POST /paste`, and no `pushComposeSentHistory`.
- [x] A-007 R1: `app/frontend/src/lib/compose-draft-store.ts` is unchanged — the change adds a second reader of the existing store and no schema, key, cap, or prune behavior moves.
- [x] A-008 R2: The existing `↑`/`↓` walk (`handleRecallKey`, its four exits, and the eager `draftKey` teardown) behaves exactly as before; all pre-existing recall tests still pass unmodified.

### Scenario Coverage

- [x] A-009 R1: Unit coverage proves chip presence/absence against history state on both pointer types.
- [x] A-010 R2: Unit coverage proves the flyout lists entries newest-first; e2e coverage at 375×812 with `hasTouch` proves the chip → flyout → load round trip and that `document.body.scrollWidth` does not exceed the viewport while the flyout is open.
- [x] A-011 R4: Unit coverage proves the walk is torn down by a flyout load.
- [x] A-012 R5: Unit coverage proves `openComposeRecall()` opens the flyout and declines silently with no history and with no target.

### Edge Cases & Error Handling

- [x] A-013 R1: With `draftKey === null` (the disabled "no target" state) the chip does not render and the registered opener declines.
- [x] A-014 R2: The flyout dismisses on Escape and on outside press without writing to the draft, and closes cleanly when the target switches out from under it.
- [x] A-015 R2: A multi-line entry renders with whitespace preserved and clamped to ~2 lines rather than expanding the flyout unbounded; the flyout's width and height stay capped against the viewport.

### Code Quality

- [x] A-016 Pattern consistency: The chip follows its keyed-sibling neighbours (`preventFocusSteal`, `chipTone`, `rk-glint`, coarse touch floors) and the opener registry mirrors `registerComposeStripFocuser` / `focusComposeStrip` verbatim in shape.
- [x] A-017 No unnecessary duplication: The change reuses `getComposeSentHistory`, `setComposeText`, `endRecall`, and the repo's existing `@floating-ui/react` idiom rather than adding a store, a sheet family, or a second history reader path.
- [x] A-018 Type narrowing over type assertions: No `as` casts are introduced in the new component or wiring.
- [x] A-019 Comment discipline: New comments state constraints the code cannot show (the fixed-strategy containment rule, why the history read is not subscribed, why the palette entry is strip-gated); none narrate the next line, address the reviewer, or cite change IDs / PR numbers.
- [x] A-020 Test intent comments: The new Playwright `test()` carries a `Proves:` / `Steps:` JSDoc block and the spec file header covers the added affordance.
- [x] A-021 Verification gates: `cd app/frontend && npx tsc --noEmit` is clean, and the frontend unit suite plus the `compose-strip` e2e spec pass through the `just` recipes.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | A tappable newest-first list, not a touch port of the `↑`/`↓` walk | Settled in the intake's origin discussion and re-derived here; the walk is a blind linear scan and touch has no arrow keys at all | S:95 R:90 A:95 D:95 |
| 2 | Certain | A row loads into the composer and never re-sends | Settled in the intake; blind re-send of an unconfirmed prompt is the double-send failure mode the history exists to avoid | S:95 R:95 A:95 D:95 |
| 3 | Certain | `compose-draft-store.ts` is consumed read-only | `getComposeSentHistory` is already exported and hydrated; this adds a second reader and nothing else | S:95 R:95 A:90 D:95 |
| 4 | Certain | The chip lives in the card form, gated only on non-empty history | Read from `isCard` in `compose-strip.tsx`; coarse pointers already open the card on textarea focus, and the compact row has no 375px width budget | S:90 R:90 A:90 D:95 |
| 5 | Confident | Build a dedicated `compose-history-flyout.tsx` on `@floating-ui/react` instead of reusing `useRowFlyout` | Inspection of `sidebar/row-flyout-card.tsx` shows its coarse `size()` cap is `reference.width − 56 − 8` floored at 120px, so a 36px chip reference yields a 120px card on the exact pointer type this targets; it also carries scrub-registry, held-row, and hover-trigger contracts a chip must not inherit. This supersedes intake assumption 6 | S:85 R:75 A:85 D:75 |
| 6 | Confident | A non-portalled `absolute` popover is not viable | `.app-shell` and the terminal column both set `overflow: hidden`, so a popover rising above the docked strip would be clipped; the portal + `strategy: "fixed"` pairing is also the documented fix for the 375px `scrollWidth` regression | S:85 R:85 A:90 D:85 |
| 7 | Confident | Loading an entry must call `endRecall()` and then focus the textarea | Mirrors the existing `handleUpload` / `removeFile` discipline; the focus move is a direct response to a user tap, not the after-send steal the focus contract forbids | S:85 R:90 A:85 D:80 |
| 8 | Confident | The palette action is offered only while the compose strip is enabled | It acts on the mounted strip's live target and history; the sibling `Compose: Focus` already owns the open-the-strip verb, and an always-listed entry that silently no-ops when the strip is closed is worse than one that is absent | S:70 R:85 A:80 D:70 |
| 9 | Confident | Ship the chip on fine pointers as well as coarse | The intake's recommendation on its one open question; one mental model beats a mobile-only dialect, and the card-form-only rule keeps the fine compact row's density unchanged. This resolves intake assumption 9 | S:75 R:85 A:80 D:70 |
| 10 | Confident | Reading `getComposeSentHistory` at render is sufficient without a subscription | The store deliberately notifies no subscriber on push, but every push is immediately followed by a draft clear (which does notify) and a target switch re-renders on its own, so the chip cannot be stale in practice | S:80 R:85 A:85 D:75 |
| 11 | Confident | The e2e coverage extends the existing `coarse pointer card morph` describe rather than adding a new spec file | That describe is already 375×812 with `hasTouch` against a live `cat` pane and carries the shared session fixtures; a new file would duplicate the whole tmux setup | S:85 R:90 A:90 D:80 |

11 assumptions (4 certain, 7 confident, 0 tentative).

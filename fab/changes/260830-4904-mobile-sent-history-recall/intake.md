# Intake: Mobile Sent-History Recall

**Change**: 260830-4904-mobile-sent-history-recall
**Created**: 2026-08-30

## Origin

Conversational, via `/fab-discuss`. The user opened with:

> "I want to discuss the UX of the compose box. Right now on the compose box on a desktop I can press the up and down keys in case I lose any prompts. Losing the prompts means whenever I type something wrong and press Enter, sometimes it doesn't make it to the tui in question. Now for desktop it's fine because the up and down arrows exist but on mobile once a prompt is lost because there's no way for me to select the compose box and then press up or down. Can you figure out better UX options for this?"

The discussion ranged wider (delivery verification, the WS-vs-paste transport split) and produced a second change, `260830-s7wp-unify-compose-send-path`. This change is the **original ask, deliberately split out** so it can ship independently of any transport work. The user confirmed the split: *"Breaking into 2 changes is okay (1 separately and 2-5 as the other one)"*, and explicitly asked that this item not be lost as the discussion widened.

**Key decisions from the discussion:**

- The affordance should be a **list, not a walk**. The desktop ↑/↓ history walk exists because a textarea has arrow keys lying around, not because stepping blindly backwards is good recovery UX. When you have lost a prompt you want to *see* the candidates and point at one.
- Therefore: do **not** port the ↑/↓ walk to touch. Add the list affordance, and keep the keyboard walk as the power path.
- Rejected: long-press on Send (collides with iOS text-selection/context menus; hides recovery behind the button that caused the loss); swipe-down on the textarea (undiscoverable, fights scroll, the strip has no gesture vocabulary); a timed "Sent · Undo" pill (wrong lifetime — a lost prompt is noticed *after* waiting on the pane, not within 8s).
- The list should be considered for fine pointers too — it is strictly better than the walk for the recovery job — but that is a judgement call left to apply (see Open Questions).

## Why

**The problem.** `ComposeStrip` records every transmitted text per target (`pushComposeSentHistory`, cap 10, `runkit-compose-sent-history`) precisely so a lost send is recoverable. The *only* way to reach that history is `handleRecallKey` (`compose-strip.tsx:595`) — a bare ↑/↓ walk inside the textarea. Touch devices have no arrow keys, so on mobile the history is written but **unreachable**. The recovery feature that exists specifically for the "my prompt vanished" case is inaccessible on the device where that case is most common and most painful (see `260806-kadm`'s "Recovery over verification" decision — sends can be lost silently at any of three hops, and no confirmation scheme closes that).

**The consequence if unfixed.** Mobile users retype lost prompts from scratch, or give up. The stored history is dead weight on those devices — persisted, pruned, and never readable.

**Why this approach.** A tap-to-open list of the last 10 sends is both reachable on touch *and* a better fit for the job than the walk: it shows all candidates at once rather than forcing a blind linear scan, and it costs no keyboard. It reuses the history store exactly as-is — no new persistence, no new lifecycle, no change to send semantics.

## What Changes

### 1. A history chip in the compose card

A new keyed chip sibling in `ComposeStrip`'s chip row (`compose-strip.tsx`, alongside `attachChip` / `newlineChip` / `insertChip` / `sendChip`), rendered when `getComposeSentHistory(draftKey).length > 0`.

- **Glyph**: `↑` (matches the placeholder's existing `↑ history` microcopy — the strip's only current surfacing of the feature).
- **Placement**: card form. On coarse pointers `isCard` is `textFocused || multiline || files.length > 0` (`compose-strip.tsx:368`), so tapping the composer already opens the card — the chip is one tap away with no new state to reach.
- **Sizing**: follows the established coarse token — `coarse:min-h-[36px] coarse:min-w-[36px]`, `chipTone`, `rk-glint`. At 375px the card row holds 📎 + ↑ + ⏎ + Send (~170px of chips) under a full-width textarea; it fits.
- **`onMouseDown={preventFocusSteal}`** like every sibling chip.
- **Do NOT gate on an empty composer.** Desktop's ↑ is gated on empty for a keyboard reason (↑ means caret movement otherwise); a chip has no such conflict. The realistic mobile case is "I gave up, typed something else, *then* noticed the first never landed."

### 2. A flyout listing recent sends

Tapping the chip opens a list of that target's history, newest first.

- **Primitive**: reuse `components/sidebar/row-flyout-card.tsx` (the repo's existing portalled flyout card, already exercised under touch). Do not invent a new mobile sheet.
- **Portal caution**: per `docs/memory/` — a `FloatingPortal` flyout needs `strategy: "fixed"`, or body `scrollWidth` grows and 375px width-sweep specs fail.
- **Rows**: each entry truncated to ~2 lines, monospace, whitespace preserved enough to distinguish multi-line entries.
- **Tap loads, never sends.** The row writes the text into the composer via `setComposeText(draftKey, entry)` and closes the flyout. Blind re-send of a prompt whose delivery you could not confirm is exactly how a double-send happens.
- **Empty state** cannot occur — the chip only renders when the history is non-empty.

### 3. Recall-walk interaction

Loading an entry from the flyout is a **text mutation like any other**, so it must call `endRecall()` (`compose-strip.tsx:270`) — the same discipline `handleUpload` and `removeFile` already follow. Leaving a walk armed after a flyout load would let the next ↑ drop the loaded text.

### 4. Command palette registration

Register a `Compose: Recall sent…` action opening the same flyout. Constitution V requires every user-facing action be reachable from the palette, and it gives fine pointers a non-chord entry.

## Affected Memory

- `run-kit/ui/compose-and-bottom-bar`: (modify) § Docked Compose Strip — the sent-history recall paragraph gains the chip + flyout as a second reader of the history store alongside the ↑/↓ walk; add a Design Decision covering list-over-walk and tap-loads-never-sends
- `run-kit/ui/keyboard-and-palette`: (modify) the new `Compose: Recall sent…` palette action

## Impact

- `app/frontend/src/components/compose-strip.tsx` — new chip descriptor + render-body entry; flyout open/close state; `endRecall()` on load. **Note**: `260830-s7wp` also touches this file, in `send()` (`:443`). Different regions; whoever lands second rebases.
- `app/frontend/src/components/sidebar/row-flyout-card.tsx` — consumed, likely unmodified.
- `app/frontend/src/lib/compose-draft-store.ts` — **read-only**. `getComposeSentHistory` is already exported. No schema change, no new key, no new prune policy.
- Command palette registry.
- Tests: `compose-strip.test.tsx` unit coverage; an e2e spec at 375×812 with `hasTouch` (per the e2e mobile conventions in memory — direct `goto` + `__rkTerminals` poll, not `gotoWindow`). Constitution requires the Proves/Steps JSDoc on any new `test()`.

**No backend surface.** Frontend-only.

## Open Questions

- Should the chip render on fine pointers too, or stay coarse-only? The list is strictly better than the walk for recovery, and shipping both unifies the mental model rather than creating a mobile-only dialect — but it adds a chip to a desktop row that already carries Insert. Recommendation: ship on both, keep ↑/↓ untouched.
- Should a flyout row offer a secondary "send again" action, or strictly load-into-composer? Recommendation: strictly load, per the double-send rationale above.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | A tappable list of recent sends, not a touch port of the ↑/↓ walk | Discussed — a walk is a blind linear scan; recovery wants to see candidates and point at one. User agreed and asked to keep this item when the discussion widened | S:95 R:90 A:95 D:95 |
| 2 | Certain | Tapping a row loads the text into the composer and never re-sends | Discussed — blind re-send of an unconfirmed prompt is the double-send failure mode | S:95 R:95 A:95 D:95 |
| 3 | Certain | The history store is consumed read-only; no schema or persistence change | `getComposeSentHistory` is already exported and hydrated; this change adds a second reader, nothing more | S:95 R:95 A:90 D:95 |
| 4 | Certain | Chip lives in the card form, which coarse pointers already open on `textFocused` | Read from `isCard` at `compose-strip.tsx:368` — no new state needed to reach it | S:90 R:90 A:90 D:95 |
| 5 | Certain | The chip is NOT gated on an empty composer | Discussed — desktop's empty-gate is a keyboard-conflict artifact; a chip has no such conflict, and the real case is noticing the loss after typing something else | S:90 R:90 A:90 D:90 |
| 6 | Confident | `row-flyout-card.tsx` is the right primitive rather than a new sheet component | It is the repo's existing portalled card and already works under touch; apply should confirm it takes an arbitrary-content child | S:80 R:85 A:80 D:80 |
| 7 | Confident | Loading an entry must call `endRecall()` | Mirrors the existing `handleUpload` / `removeFile` discipline for programmatic text mutation | S:85 R:90 A:85 D:85 |
| 8 | Confident | Palette registration is required, not optional | Constitution V — the palette is the complete action registry | S:90 R:90 A:85 D:80 |
| 9 | Tentative | Ship the chip on fine pointers as well as coarse | Argued for (one mental model, better than the walk) but not decided; desktop row density is the counterweight. See Open Questions | S:60 R:80 A:70 D:55 |

9 assumptions (5 certain, 3 confident, 1 tentative, 0 unresolved).

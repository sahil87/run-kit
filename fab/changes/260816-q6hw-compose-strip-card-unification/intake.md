# Intake: Compose Strip Card Unification

**Change**: 260816-q6hw-compose-strip-card-unification
**Created**: 2026-08-17

## Origin

Promptless dispatch (Create-Intake Procedure, `{questioning-mode} = promptless-defer`) from a synthesized design-conversation description. The design was validated interactively with a 375px/800px mock (both pointers, all states including the fine-pointer hysteresis latch, verified programmatically: type→card true, erase-all→card true, blur-empty→false) at
`/tmp/claude-1001/-home-sahil-code-sahil87-run-kit-worktrees-scarlet-vicuna/9a2d7ebd-7a9d-42f7-9b40-77d3bf4a39c0/scratchpad/compose-mock/index.html`.

> Rework `ComposeStrip`'s layout into ONE card layout model shared by both pointer types, replacing the current `coarsePointer ?` render fork. Layout + chip-visibility change only: Enter policy (`classifyComposeEnter`), send semantics/payloads, the module draft store, sent-history recall, focus contracts (focus-on-open, no-steal, Escape-blurs), enterKeyHint, and the bottom-bar hide-while-composing seam are all UNTOUCHED.

## Why

**Coarse pointers (validated with the interactive mock at 375px).** The strip is one bottom-aligned row — `📎 · a| · textarea(flex-1) · ⏎ · Send` — so chips + gaps eat ~180px of a 375px screen. A grown (auto-grow, `items-end`) textarea gets ~50% width with dead columns above the flanking chips: a typical dictated sentence wraps to 8 lines and hits the 6-row cap's internal scroll. Under the card model the same sentence renders 3 full-width lines.

**Fine pointers.** The strip always spends ~112px (header row + 2-row textarea floor + button row) per tty tile even when idle/empty — a permanent tax on terminal rows for a surface that is usually not being typed into.

**If not fixed**: the strip stays the worst-width composer exactly on the screen size where typing space matters most (phone with keyboard up), and every desktop tty tile permanently loses ~112px to empty chrome.

**Why this approach**: one card model deletes the `coarsePointer ?` render fork (two layouts to maintain, test, and document become one), the compact state returns the idle height on both pointers, and the per-pointer morph triggers are the only fork that must remain — because the two pointer types differ physically (the OS keyboard slide masks a layout jump on touch; on fine pointers every strip resize refits xterm).

**Alternatives rejected (from the design discussion):**
- Grouping all buttons on the right of the row: returns zero width, just consolidates dead space.
- Right-side vertical chip stack in the grown state: column height quantizes to chip count (2-line textarea fits 2 chips, 📎 needs 3 lines); reflow jankier than the masked card morph.
- Focus-triggered morph on fine pointers: xterm refit churn on every click in/out.
- Instant compact snap on empty (no latch): refits xterm mid-typing when a draft is backspaced away.

## What Changes

All in `app/frontend/src/components/compose-strip.tsx` (both docks — the in-tile `ttyDockContent` slot in `surface-layout.tsx` and the shell footers in `app.tsx` / `board-page.tsx` — render this one component; no dock-side changes expected).

### 1. The card model (both pointers)

One bordered card (`bg-bg-card`, rounded, accent border when the textarea is focused) containing, top to bottom:

1. **Attachment-preview row** (when files exist) — previews move INSIDE the card above the textarea on both pointers, replacing the current above-the-row placement.
2. **Full-width auto-grow textarea** — transparent background, no inner border (the card carries the chrome), `MAX_TEXTAREA_ROWS = 6` cap unchanged.
3. **One quiet chip row** — chips borderless / faint-bg inside the card. Send keeps its existing neutral-when-empty / accent-when-text faces and its enabled-when-target rule including the empty bare-`\r` submit.

### 2. Compact state (both pointers)

When there is no draft, the strip is a single compact row instead of the card:

- **Coarse compact**: `📎 · textarea(flex-1, 1-row) · Send`. Placeholder keeps the `→ {name}…` target fold (260814-ink6's header-fold companion).
- **Fine compact**: `📎 · a| · textarea(flex-1, 1-row, education placeholder) · Send`. Insert is hidden while empty (it would be disabled anyway).

### 3. Morph triggers (deliberately different per pointer)

- **Coarse**: card when `focused OR multi-line draft OR attachments`; compact otherwise. Focus-triggered is fine on touch — the OS keyboard slide masks the layout jump. Multi-line detection per the validation mock: draft contains `\n` OR the single-row textarea's rendered content wraps (`scrollHeight` above the one-line height).
- **Fine**: card on DRAFT PRESENCE (first character or attachments), NEVER on focus — there is no keyboard slide to mask it and every strip resize refits xterm (scrollback jump on stray clicks). With a **hysteresis latch**: once morphed, the card stays through any backspacing (never snaps mid-edit); the latch releases to compact only on blur-while-empty.

### 4. Chip roster per pointer (the only layout fork that remains)

- **Coarse card row**: `📎 · ⏎ · (spacer) · Send`.
  - The `a|` closer is DROPPED entirely on coarse — redundant (the bottom-bar `a▏` chip, the `View: Text Input` palette action, and ⇧⌘E remain; closing is lossless via the draft store).
  - The ⏎ local-newline chip is hidden while the composer is empty; it stays hidden in selection-broadcast mode as today.
- **Fine card row**: `📎 · a| · (spacer) · Insert · Send`. `a|` stays on fine — with the header folded (§5) it becomes the sole on-strip closer.
- Coarse chips keep the 36px min touch-target floors; fine chips keep current sizing.

### 5. Header fold on fine (in-tile dock)

The `→ {target} · Uploading… · ×` header row folds on fine pointers **at the terminal-target in-tile dock** — the tile frame already names the target (the stated rationale of the 260813-j3jb pane-geometry retirement). The header MUST still render where it carries real signal: selection-broadcast mode (`→ N selected`), the disabled no-target state, and coarse's existing rules are unchanged (coarse already folds it per 260814-ink6). Note: the footer dock on fine is used by selection broadcast / no-tty layouts, which keep the header anyway — so in practice the fold applies exactly where the in-tile dock renders a terminal-target strip.

### 6. 2-row floor retired

`rows={coarsePointer ? 1 : 2}` becomes `rows={1}` everywhere; the compact state supersedes 260724-2bmy's floor ("typing space is the strip's whole purpose" was premised on the always-expanded stack; the first character now delivers the full-width card). Explicitly confirmed by the user in the design conversation.

### 7. Uploading indicator

Replace the `Uploading…` text (header on fine, inline row on coarse) with a busy/spinner state on the 📎 chip itself, both pointers — the text currently steals row width exactly when an upload appends path lines.

### 8. Untouched contracts (explicit non-goals)

- Enter policy: `classifyComposeEnter`, surface split (`"strip"` / `"chat"`), Alt+Enter raw insert.
- Send semantics and payloads (`\r` / `\n` / byte-exact), empty bare-`\r` submit, guard-blocked-send draft preservation.
- Module draft store (`compose-draft-store.ts`), per-target keys, sent-history recall (↑/↓ walk).
- Focus contracts: focus-on-open, no-steal, Escape-blurs; `enterKeyHint` values.
- Bottom-bar hide-while-composing seam (`setComposeStripFocused` module store).
- Selection-broadcast and no-target states keep their current behavior: header shown, submit-only policy, disabled states.
- The outer element stays an unstyled box (`data-compose-strip` root) so the row-growth/refit mechanic keeps working at both docks — all card chrome lives on inner wrappers.

### 9. Tests

- `app/frontend/src/components/compose-strip.test.tsx` asserts on the current two layouts and test-ids — rework to the card/compact model (morph triggers, latch, chip visibility per pointer/state).
- New unit coverage for the fine hysteresis latch (type→card, erase-all→still card, blur-empty→compact) and the coarse trigger set.
- E2E specs referencing the strip need review: `tests/e2e/compose-strip.spec.ts` (primary), plus `status-bar.spec.ts`, `focus-restore.spec.ts`, `sidebar-multiselect.spec.ts` (selector-level touchers). Any modified `.spec.ts` requires its sibling `.spec.md` updated in the same commit per the constitution (Test Companion Docs).
- Playwright verification at 375px and 1024px+ per the project's Playwright-driven-development workflow.

## Affected Memory

- `run-kit/ui/compose-and-bottom-bar`: (modify) The strip's layout sections are rewritten by this change — "Layout forks on pointer type" (two-row stack / one-row collapse → card + compact model with per-pointer morph triggers), "Coarse header fold + the ⏎ chip" (⏎ becomes hidden-while-empty; `a|` dropped on coarse), the fine header fold at the in-tile dock, the `rows` fork retirement, the uploading indicator's move onto 📎, previews inside the card, and the Design Decisions entries premised on the 260724-2bmy two-row floor and the 260814-ink6 coarse collapse.

## Impact

- `app/frontend/src/components/compose-strip.tsx` — the whole render section (shared descriptors + the `coarsePointer ?` fork → card/compact model, morph state, latch); behavior seams listed in §8 untouched.
- `app/frontend/src/components/compose-strip.test.tsx` — layout/test-id assertions reworked; new morph/latch coverage.
- `app/frontend/tests/e2e/compose-strip.spec.ts` (+ sibling `.spec.md`) — primary e2e; `status-bar.spec.ts`, `focus-restore.spec.ts`, `sidebar-multiselect.spec.ts` reviewed for selector fallout.
- No backend, routing, store, or dock-caller changes expected. Both docks keep working because the outer element stays an unstyled box.
- xterm refit behavior: compact↔card morphs resize the strip, which the terminal `ResizeObserver` → `fitAndSync` already handles; the fine-pointer trigger design (draft presence + latch, never focus) exists specifically to bound that refit churn.

## Open Questions

- None — the design conversation resolved the layout model, triggers, chip rosters, and floor retirement explicitly, and the interactive mock pinned the remaining mechanics (multi-line detection, latch release).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | One card layout model shared by both pointers replaces the `coarsePointer ?` render fork; layout + chip visibility only, behavior contracts untouched | Discussed — the change's core statement, with an explicit untouched-contracts list | S:95 R:70 A:90 D:95 |
| 2 | Certain | Fine morph trigger is draft presence (first character or attachments), never focus, with a hysteresis latch releasing only on blur-while-empty | Discussed — user chose this over focus-trigger and over instant-snap (both explicitly rejected); mock-verified programmatically | S:95 R:75 A:90 D:95 |
| 3 | Certain | Coarse morph trigger is `focused OR multi-line draft OR attachments` (keyboard slide masks the jump) | Discussed — stated verbatim with rationale | S:95 R:75 A:90 D:90 |
| 4 | Certain | The a-bar closer chip is dropped entirely on coarse; kept on fine as the sole on-strip closer once the header folds | Discussed — redundancy argument stated (bottom-bar `a▏`, palette action, ⇧⌘E remain; lossless close) | S:90 R:80 A:85 D:90 |
| 5 | Certain | The 2-row fine floor (260724-2bmy) is retired — `rows={1}` everywhere; compact state supersedes it | Discussed — "Explicitly confirmed by the user in this conversation" | S:95 R:80 A:90 D:95 |
| 6 | Certain | `Uploading…` text is replaced by a busy/spinner state on the 📎 chip, both pointers | Discussed — stated with rationale (text steals width exactly during uploads) | S:90 R:85 A:85 D:85 |
| 7 | Certain | Header folds on fine only at the terminal-target in-tile dock; selection-broadcast, no-target, and all coarse rules unchanged | Discussed — fold scope and MUST-render exceptions stated verbatim | S:90 R:70 A:85 D:85 |
| 8 | Certain | ⏎ chip hidden while composer is empty (coarse card row); stays hidden in selection-broadcast as today | Discussed — stated in the chip-roster spec | S:90 R:85 A:85 D:90 |
| 9 | Confident | Coarse "multi-line draft" = text contains `\n` OR the rendered content wraps past one line (scrollHeight probe) | Mock reference — the validated mock implements exactly this (`multiline()`: newline OR scrollHeight threshold); description says "multi-line" without pinning the mechanism | S:60 R:80 A:75 D:70 |
| 10 | Confident | Selection-broadcast and no-target states are exempt from the compact morph — they render the header + card-form stack as today | Description pins "keep their current behavior (header shown, submit-only policy, disabled states)"; a compact single row cannot carry the required header, so exemption is the consistent reading | S:55 R:75 A:70 D:60 |
| 11 | Confident | Fine latch releases ONLY on blur-while-empty, by the letter: removing the last attachment while blurred leaves the card until the next blur-while-empty (never an immediate snap) | Mock reference — latch is cleared only in the blur handler; matches the stated never-snap-mid-edit rationale | S:55 R:80 A:70 D:60 |
| 12 | Confident | Existing test-ids (`compose-strip-input`, `-send`, `-insert`, `-newline`, `-a-close`, `-close`, `-target`, `-previews`, `-uploading` where the control survives) are kept stable; only controls that disappear per state lose their id in that state | Project convention — e2e selectors depend on them; minimizes spec fallout | S:50 R:85 A:75 D:65 |
| 13 | Confident | Compact→card and card→compact morphs rely on the existing `ResizeObserver` → `fitAndSync` reflow class (no new refit wiring) | Codebase signal — toggling the strip already reflows this way (memory: compose-and-bottom-bar § Toggle + persistence) | S:60 R:80 A:80 D:75 |
| 14 | Certain | Coarse chips keep `coarse:min-h-[36px]`/`min-w` touch-target floors; fine chips keep current sizing | Discussed — stated constraint; matches project touch-target rules in context.md | S:90 R:85 A:90 D:90 |
| 15 | Certain | Modified `.spec.ts` files ship sibling `.spec.md` updates in the same commit | Constitution — Test Companion Docs is a MUST | S:95 R:90 A:95 D:95 |

15 assumptions (10 certain, 5 confident, 0 tentative, 0 unresolved).

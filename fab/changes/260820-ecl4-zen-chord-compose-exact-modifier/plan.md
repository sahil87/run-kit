# Plan: Zen chord fires from compose surfaces (exact-modifier Enter classifier)

**Change**: 260820-ecl4-zen-chord-compose-exact-modifier
**Intake**: `intake.md`

## Requirements

### Compose Enter Policy: Exact-Modifier Submit

#### R1: Shift-carrying meta/ctrl+Enter falls through the classifier
`classifyComposeEnter` (`app/frontend/src/lib/compose-keys.ts`) MUST return `"submit"` for a meta- or ctrl-carrying Enter only when `shiftKey` is NOT held; a meta/ctrl+Enter WITH `shiftKey` held MUST return `"default"`, unconditionally (regardless of `altKey`). All other precedence rules are unchanged: non-Enter / IME-composing → `"default"`; alt (without meta/ctrl) → `"insert"`; shift alone → `"default"`; plain Enter → `"insert-line"` on the strip, `"default"` in chat. The header comment and the `classifyComposeEnter` docstring MUST state the new precedence, noting that Shift+Cmd/Ctrl+Enter deliberately falls through for the global zen chord.

- **GIVEN** an Enter keydown with `metaKey: true, shiftKey: true` (or `ctrlKey: true, shiftKey: true`, or `metaKey: true, shiftKey: true, altKey: true`), not IME-composing
- **WHEN** classified for either surface (`"strip"` or `"chat"`)
- **THEN** the classifier returns `"default"`

- **GIVEN** an Enter keydown with `metaKey: true` (or `ctrlKey: true`) and `shiftKey: false`
- **WHEN** classified for either surface
- **THEN** the classifier returns `"submit"` (the only submit chord, now exact on shift)

#### R2: The zen chord bubbles un-consumed from both compose surfaces
With R1 in place, a ⇧⌘⏎ / ⇧Ctrl+⏎ keydown on the compose strip's textarea (`app/frontend/src/components/compose-strip.tsx`) and on the chat send form's textarea (`app/frontend/src/components/chat-view.tsx`) MUST NOT be consumed: no `preventDefault()`, no `stopPropagation()`, nothing sent — both call sites already early-return on `"default"` before their consume block, so R2 requires NO call-site logic change; it is verified by non-consumption tests so the keydown provably bubbles to the global chord dispatcher, where `zen-toggle` (`keybindings.ts` — `tier: "shifted"`, `code: "Enter"`, `ignoreInputs: true`) matches it.

- **GIVEN** focus in the compose strip textarea (or the chat send form textarea) with a non-empty draft
- **WHEN** ⇧⌘⏎ (or ⇧Ctrl+⏎) is pressed
- **THEN** the keydown is not consumed (no send/submit fires, `defaultPrevented` is false) and it propagates past the handler

### Non-Goals

- No change to `zen-toggle`'s binding, scope, or `ignoreInputs` handling — `keybindings.ts` is untouched (its existing exact-modifier dispatch tests already cover the terminal-focus case)
- No change to `composeSubmitKeycap()` or the Send tooltips (they already render the shift-less chord)
- No call-site logic changes in `compose-strip.tsx` / `chat-view.tsx` (they already fall through on `"default"`)
- Multi-window and ⌘N/⌘T/⇧⌘T rebinding topics from the originating conversation — separate future change

### Design Decisions

#### Exact-modifier submit over zen rebind
**Decision**: Fix the classifier — meta/ctrl+Enter WITH shift returns `"default"` — instead of rebinding zen off ⇧⌘⏎.
**Why**: The design intent was always exact-modifier disjointness (the zen binding's comment claims the submit chords "never carry Shift"); the documented contract everywhere states Cmd/Ctrl+Enter without Shift is the ONLY submit chord; ⇧⌘⏎ matches iTerm2's maximize-pane convention.
**Rejected**: Rebinding zen to ⌘Y — mac-browser History key with uncertain page-interceptability, Ctrl+Y is readline yank so win/linux could never mirror it, and it would paper over the classifier drift instead of fixing it.
*Introduced by*: 260820-ecl4-zen-chord-compose-exact-modifier

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add the shift guard to the submit branch in `app/frontend/src/lib/compose-keys.ts` (`key.shiftKey ? "default" : "submit"` inside the meta/ctrl branch) and update the header comment + `classifyComposeEnter` docstring to state the exact-modifier precedence and the zen fall-through rationale <!-- R1 -->
- [x] T002 Update `app/frontend/src/lib/compose-keys.test.ts`: flip the `metaKey+shiftKey → "submit"` assertion in the "modifier precedence" test to `"default"` (reframe the test name), and add cases on BOTH surfaces for `ctrlKey+shiftKey → "default"` and `metaKey+shiftKey+altKey → "default"`; keep `metaKey`/`ctrlKey` alone → `"submit"`, `altKey+shiftKey → "insert"`, and the IME/plain-Enter cases green <!-- R1 -->

### Phase 3: Integration & Edge Cases

- [x] T003 [P] Add a non-consumption test to `app/frontend/src/components/compose-strip.test.tsx`: dispatch a ⇧⌘⏎ keydown on the focused strip textarea and assert nothing is sent and the event is not consumed (`defaultPrevented` false / send spy not called) <!-- R2 -->
- [x] T004 [P] Add the same non-consumption test to `app/frontend/src/components/chat-view.test.tsx` for the chat send form (⇧Ctrl+⏎ variant welcome) <!-- R2 -->
- [x] T005 Run the scoped verification gates: frontend unit tests for the three touched suites and `npx tsc --noEmit` in `app/frontend` <!-- R1 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `classifyComposeEnter` returns `"default"` for shift+meta, shift+ctrl, and shift+meta+alt Enter on both surfaces, and `"submit"` for shift-less meta/ctrl Enter on both surfaces
- [x] A-002 R2: A ⇧⌘⏎ / ⇧Ctrl+⏎ keydown on either compose surface's textarea is not consumed (no send, `defaultPrevented` false) — proven by per-surface tests

### Behavioral Correctness

- [x] A-003 R1: The previously drifted behavior (shift+meta/ctrl+Enter submitting the draft) is gone; the classifier's docstring/header state the exact-modifier precedence including the zen fall-through

### Scenario Coverage

- [x] A-004 R1: The unchanged classifier rows remain pinned green: alt+shift (no meta/ctrl) → insert, shift alone → default, plain-Enter per-surface divergence, IME-composing guard, non-Enter keys
- [x] A-005 R2: `keybindings.test.ts`'s existing zen-toggle exact-modifier dispatch coverage still passes (terminal-focus leg of the chain, untouched)

### Code Quality

- [x] A-006 Pattern consistency: The fix follows the classifier's existing pure-function, first-match-wins style; comments state constraints, not narration
- [x] A-007 No unnecessary duplication: No new utilities; tests extend the existing matrices/suites in place
- [x] A-008 Tests included: The changed behavior is covered by unit tests (new features/bug fixes MUST include tests per code-quality.md)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change tightens one branch in `classifyComposeEnter` and adds tests; no existing symbol, file, or branch became redundant or unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The shift guard is unconditional within the meta/ctrl branch (shift+meta+alt → default too) | Intake decision #4 carried forward — uniform fall-through of shift-carrying meta/ctrl chords is the simplest disjointness rule; alt-without-meta/ctrl keeps its insert row | S:70 R:85 A:75 D:65 |
| 2 | Confident | Non-consumption tests assert `defaultPrevented === false` + send-spy not called, rather than a full-chain zen-zoom e2e | Intake decision #5 — the chain decomposes into already-tested halves; code-quality.md's e2e rule is SHOULD-where-possible and no zen e2e surface exists | S:60 R:85 A:75 D:60 |
| 3 | Certain | Memory edits (compose-and-bottom-bar, chat, keyboard-and-palette Enter-policy lines) are hydrate-stage work, not apply tasks | Pipeline contract — hydrate owns memory; the intake's Affected Memory section carries the targets | S:90 R:95 A:95 D:90 |

3 assumptions (1 certain, 2 confident, 0 tentative).

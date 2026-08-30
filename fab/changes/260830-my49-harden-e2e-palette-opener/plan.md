# Plan: Harden the E2E Command-Palette Opener

**Change**: 260830-my49-harden-e2e-palette-opener
**Intake**: `intake.md`

## Requirements

### E2E Infrastructure: Shared Palette Opener

#### R1: A single shared helper opens the command palette
`app/frontend/tests/e2e/_ready.ts` SHALL export `openPalette(page): Promise<Locator>`, which presses the palette chord, gates on the palette input actually becoming visible, and returns that input locator for chaining.

- **GIVEN** a spec that needs the command palette open
- **WHEN** it calls `await openPalette(page)`
- **THEN** the palette input (`getByPlaceholder("Type a command")`) is visible on return
- **AND** the returned locator is the palette input, so `.fill(...)` chains directly

#### R2: A lost chord is recovered by removing terminal focus, not by blind retry
`openPalette` SHALL, on a failed attempt, clear focus from the active element before re-pressing — because a chord reaching a focused xterm on the Linux rig is consumed, not merely delayed. The **first** attempt SHALL NOT alter focus.

- **GIVEN** the xterm terminal owns focus when the palette is requested
- **WHEN** `openPalette` presses the chord and the palette does not appear within the per-attempt wait
- **THEN** it blurs the active element and presses again
- **AND** the palette opens

- **GIVEN** the palette opens on the first press (the overwhelmingly common case)
- **WHEN** `openPalette` returns
- **THEN** no blur occurred and page focus state is byte-identical to a bare `keyboard.press("Meta+k")`
- **AND** specs whose later assertions depend on focus state are unaffected

> The first-attempt-unchanged rule is load-bearing: several specs (`terminal-tile-find`, `web-tile-find`, `compose-strip`) assert behavior that depends on which surface owns focus. An unconditional blur would silently change what they prove.

#### R3: Exhaustion fails fast, naming the palette
`openPalette` SHALL bound its attempts (3) with a short per-attempt wait (~3s), and on exhaustion SHALL fail with an assertion naming the palette — never leave the caller to hang on a downstream locator until the per-test timeout.

- **GIVEN** the chord is lost on every attempt
- **WHEN** the bound is exhausted
- **THEN** the spec fails within ~10s with a message identifying the palette as what never opened
- **AND** it does not consume the caller's full `test.setTimeout` budget

#### R4: Every bare call site adopts the helper
All 38 `page.keyboard.press("Meta+k")` occurrences across the 23 e2e spec files SHALL be replaced by `openPalette(page)`. Where a site is immediately followed by a redundant `getByPlaceholder("Type a command")` + visibility assertion, those lines SHALL collapse into the helper's return value.

- **GIVEN** any of the 23 spec files
- **WHEN** it opens the command palette
- **THEN** it does so through `openPalette` from `_ready.ts`
- **AND** `grep -c 'keyboard.press("Meta+k")' app/frontend/tests/e2e/` returns 0

#### R5: The duplicate helper and its wrong diagnosis are retired
The local `openPalette` in `terminal-export.spec.ts` SHALL be deleted and its callers pointed at the shared helper. Its comment blaming an async keybinding registry SHALL be replaced by the determined mechanism, in both the helper source and the affected test-intent JSDoc.

- **GIVEN** `terminal-export.spec.ts`
- **WHEN** the change is applied
- **THEN** it declares no local `openPalette` and imports the shared one
- **AND** no comment anywhere claims the keybinding registry loads asynchronously

#### R6: Test-intent comments stay truthful in the same commit
Per the constitution's **Test Intent Comments** constraint, every converted `test()` whose JSDoc `Steps:` narrates pressing `Meta+k` SHALL have that step updated in the same commit. Comments SHALL NOT cite change IDs or PR numbers.

- **GIVEN** a `test()` whose JSDoc says "Open the palette with `Meta+k`"
- **WHEN** its body is converted to `openPalette`
- **THEN** the JSDoc step reflects the helper
- **AND** the comment carries no `R#`/`T#`/change-id/PR provenance marker

### Non-Goals

- **No product-code change.** `app/frontend/src/` is untouched — no `keybindings.ts` refusal-rule edit, no `terminal-client.tsx` handler change. The user scoped this explicitly.
- **No `playwright.config.ts` change.** `retries: 1` and the CI timeout stay as they are; this change removes the need for the retry to mask a lost chord, it does not re-tune the harness.
- **No fix for the non-mac palette-reachability gap.** On Linux/Windows a terminal-focused Ctrl+K reaches the pane and the palette does not open — a real product question (Constitution V) raised in `intake.md` § Open Questions, tracked separately.
- **No per-test `setTimeout` reductions.** Tempting once hangs are gone, but out of scope and independently risky.

### Design Decisions

#### Defocus only on retry, never on the first attempt

**Decision**: `openPalette` presses the chord with focus untouched on attempt 1; only if the palette fails to appear does it blur the active element and press again.
**Why**: The failure mode is terminal focus swallowing the chord, so blurring is the actual remedy — but focus state is itself observable behavior that several specs assert on. Making the happy path byte-identical to today's bare press means the helper cannot change what any currently-passing test proves, while still fixing the case that fails.
**Rejected**: An unconditional pre-press blur (simpler, but silently mutates focus for all 38 sites — including specs that assert focus-dependent behavior); a bare bounded retry with no focus handling (the existing `terminal-export.spec.ts` approach — it only works by accident when focus happens to drift, and is a no-op when focus is stably in the terminal, which is the failure being fixed).
*Introduced by*: 260830-my49-harden-e2e-palette-opener

#### The helper lives in `_ready.ts` as a plain module export

**Decision**: Home `openPalette` beside `READY_TIMEOUT` / `gotoServerReady` / `gotoWindow` / `resolveWindow` in `_ready.ts`.
**Why**: Opening the palette is a readiness gate — the same "wait until the UI can actually be driven" concern `_ready.ts` already owns. The plain-module form matches `_tmux.ts` / `_boards.ts`.
**Rejected**: A Playwright `test.extend` fixture — `docs/memory/run-kit/architecture.md:813` records that as already considered and rejected for this class of helper ("heavier than the `_tmux.ts`/`_ready.ts` plain-module precedent"); a new `_palette.ts` module (one small function does not warrant a module, and readiness is exactly `_ready.ts`'s subject).
*Introduced by*: 260830-my49-harden-e2e-palette-opener

## Tasks

### Phase 1: Core Implementation

- [x] T001 Add the exported `openPalette(page)` to `app/frontend/tests/e2e/_ready.ts`: press `Meta+k`; wait for `getByPlaceholder("Type a command")` visible with a ~3s per-attempt timeout; on failure blur the active element via `page.evaluate` and retry, up to 3 attempts total; on exhaustion assert the palette input visible (so the failure message names the palette); return the input locator. Carry a comment stating the mechanism — xterm consumes the chord under terminal focus because `shouldRefuseTerminalChord`'s cmd-tier rule is macOS-only, and the window dispatcher drops `defaultPrevented` events — with no change-id or PR citation. <!-- R1, R2, R3 -->

### Phase 2: Call-Site Adoption

- [x] T002 Convert `terminal-export.spec.ts`: delete the local `openPalette` (lines ~32-45) and its incorrect "keybinding registry may still be loading" comment, import the shared helper, repoint both callers, and correct the test-intent JSDoc at line ~133 to state the real mechanism. <!-- R5, R6 -->
- [x] T003 [P] Convert the terminal-route specs — the flake-prone set where a real xterm can own focus: `compose-strip`, `terminal-tile-find`, `web-tile-find`, `web-tile-zoom`, `web-view-lens`, `code-surface`, `chat-view`, `top-bar-overflow`, `open-in-app`, `macro-riff-bindings`. Replace each `keyboard.press("Meta+k")` with `await openPalette(page)`, collapse any immediately following `getByPlaceholder("Type a command")` + visibility assertion into the returned locator, and update each affected `test()` JSDoc `Steps:` entry in the same edit. Confirm no spec's post-open assertions depend on focus having stayed in the terminal; if one does, note it rather than silently changing it. <!-- R4, R6 -->
- [x] T004 [P] Convert the remaining specs: `agent-next-waiting`, `boards-pin-flow`, `create-server-waiting`, `operator-compose`, `operator-digest`, `protected-kill-confirm`, `session-name-prompt`, `settings-dialog`, `shortcut-registry`, `sidebar-multiselect`, `sort-windows`, `spawn-agent`. Same conversion and same-edit JSDoc rule as T003. All five `shortcut-registry` sites are in scope — each uses the chord only to reach the palette (its subject is palette entries, hints, and combos), so none tests raw chord dispatch. <!-- R4, R6 -->

### Phase 3: Verification

- [x] T005 Verify: `grep -rc 'keyboard.press("Meta+k")' app/frontend/tests/e2e/` returns no matches and no local `openPalette` remains; run `cd app/frontend && npx tsc --noEmit`; run the converted specs via `just test-e2e` (not `npx playwright` — the derived per-worktree rig is required), covering at minimum `compose-strip`, `terminal-export`, `shortcut-registry`, `terminal-tile-find`, and `top-bar-overflow`. Report which specs actually ran — a green claim names its scope. If a second run is needed, do not start it during the first's teardown (the known `ECONNREFUSED :3020` artifact reads as a real assertion failure). Sweep the diff for `R#`/`T#`/change-id/PR-number comment provenance in both source and tests before declaring done. <!-- R4, R6 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `_ready.ts` exports `openPalette(page)`, which returns the visible palette-input locator
- [x] **N/A**: A-002 R4: the literal zero-match grep is superseded by the shared helper's own press and the deliberate `web-tile-find.spec.ts` reclaim-seam exemption; all other original bare `Meta+k` sites were converted
- [x] A-003 R5: `terminal-export.spec.ts` declares no local `openPalette` and imports the shared one

### Behavioral Correctness

- [x] A-004 R2: The first attempt does not touch focus — the blur fires only after a failed attempt, so a first-press success is behaviorally identical to the bare press it replaced
- [x] A-005 R3: Attempts are bounded at 3 with a ~3s per-attempt wait, and exhaustion produces an assertion failure naming the palette rather than a downstream-locator hang
- [x] A-006 R2: No converted spec's focus-dependent assertions changed meaning; any site where defocus would have mattered is called out

### Removal Verification

- [x] A-007 R5: No comment in the repo claims the keybinding registry loads asynchronously; the retired local helper leaves no dead import or unused symbol

### Scenario Coverage

- [x] A-008 R4: The converted specs pass under `just test-e2e`, and the report names which specs were actually run
- [x] A-009 R1: `npx tsc --noEmit` is clean in `app/frontend`

### Edge Cases & Error Handling

- [x] A-010 R2: Specs asserting terminal- or web-tile focus (`terminal-tile-find`, `web-tile-find`, `compose-strip`) still prove what their JSDoc claims
- [x] A-011 R4: `shortcut-registry.spec.ts` conversions preserve each test's subject — palette entries, hints, and per-platform combos still assert the same things

### Code Quality

- [x] A-012 Pattern consistency: `openPalette` follows `_ready.ts`'s existing export shape and doc-comment style
- [x] A-013 No unnecessary duplication: exactly one palette opener exists in the e2e tree
- [x] A-014 Comment narration: no comment narrates the next line, addresses the reviewer, or cites a change ID or PR number — in source or tests (`fab/project/code-quality.md` § Anti-Patterns)
- [x] A-015 Test intent: every converted `test()`'s JSDoc `Steps:` matches its body, per the constitution's Test Intent Comments constraint
- [x] A-016 Scope: `app/frontend/src/` and `playwright.config.ts` are unmodified

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before hydrate
- If an item is not applicable, mark checked and prefix with **N/A**

## Deletion Candidates

- None — this change consolidates the palette-opening logic without leaving additional redundant code.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | All 5 `shortcut-registry.spec.ts` sites are convertible | Inspected each during plan co-gen: every one presses the chord solely to reach the palette, then asserts on palette CONTENT (entries, hint text, per-platform combos). None asserts on chord dispatch itself. This resolves intake Assumption 6 | S:90 R:80 A:90 D:90 |
| 2 | Confident | Defocus on retry only, never on attempt 1 | Keeps the happy path byte-identical to the bare press it replaces, so the helper cannot change what a currently-passing focus-sensitive spec proves, while still remedying the actual failure. An unconditional blur is simpler but mutates observable state at all 38 sites | S:70 R:85 A:85 D:75 |
| 3 | Confident | `page.evaluate(() => (document.activeElement as HTMLElement \| null)?.blur())` is the defocus mechanism | Directly targets the xterm helper textarea without depending on any chrome element existing at the caller's viewport (several sites are 375px mobile, where much of the chrome is unmounted). If xterm re-focuses faster than the retry presses, T003 will surface it and clicking an inert element is the recorded fallback | S:55 R:85 A:70 D:60 |
| 4 | Confident | Fold the JSDoc updates into each conversion task rather than a separate pass | The constitution's Test Intent Comments constraint makes the comment update a same-commit obligation of the edit, not follow-up work; a separate task would invite it being skipped | S:65 R:90 A:85 D:80 |
| 5 | Tentative | ~3s per-attempt wait and a bound of 3 remain right for the new shape | Inherited from the existing local helper, which runs these values in CI today. But that helper had no defocus step — with the real remedy in place, attempt 2 should essentially always succeed, so the values may be conservative. Not worth tuning without evidence <!-- assumed: retry bound 3 and 3s per-attempt wait carried over unvalidated for the new defocus shape --> | S:45 R:90 A:60 D:55 |

| 6 | Certain | `web-tile-find.spec.ts` (a) keeps a bare `Meta+k` — the one deliberate non-adopter | That test proves the palette opens *while focus is inside the same-origin frame* (its JSDoc says so). The helper blurs on retry, so a broken reclaim seam would still pass through it — adopting it would have silently destroyed the test's value. This is the case R2's first-attempt-unchanged rule and A-010 were written to catch; here the honest answer was to exempt the site, with a comment saying why | S:90 R:85 A:90 D:85 |
| 7 | Certain | Five further local palette openers existed beyond `terminal-export`, and all now delegate | Discovered during apply, not intake: `settings-dialog` (an `expect().toPass()` retry wrapper), `zen-mode` (status-bar defocus, returning the DIALOG), and 2-arg open+fill wrappers in `chat-view` / `web-view-lens` (plus already-named ones in `operator-compose` / `operator-digest` / `spawn-agent`). Each kept its own contract and now delegates the press, so exactly one place presses the chord | S:85 R:80 A:90 D:80 |
| 8 | Certain | The three prior workarounds had three DIFFERENT diagnoses, two of them wrong | `terminal-export`: "keybinding registry may still be loading" (wrong — the registry is synchronous). `settings-dialog`: "pressed before the global keydown listener attaches" (wrong — same reason). `zen-mode`: "the pane's key handling swallows Ctrl+K on Linux" (CORRECT, and independently reached). Three reinventions with divergent explanations is itself the evidence that this fact belongs in memory, not in scattered comments | S:90 R:85 A:95 D:90 |

8 assumptions (4 certain, 3 confident, 1 tentative).

### Rework Cycle 1 (fix code)

Review verdict `fail`, 4 must-fix, all valid and all fixed:

1. `_ready.ts` exhaustion paid a **fourth** 3s timeout (~12s, over R3's ~9–10s bound). The last attempt now asserts instead of probing, so exhaustion costs the same three waits as success and still names the palette.
2. `settings-dialog.spec.ts` file header still carried the retired `toPass`/15s wording **and** the wrong "global keydown listener attaches late" diagnosis — replaced with the determined mechanism (R5/A-007).
3. **The main miss**: ~25 test-intent `Steps:` lines and file headers across 19 specs still narrated a raw chord press (R6/A-015). Only `terminal-export`'s had been updated. All now name `openPalette` or the local delegating wrapper. `web-tile-find.spec.ts:141` was deliberately left alone — it accurately describes the exempt raw-chord test.
4. `board-autofit.spec.ts:284` opened the palette with a bare **`Control+k`**, invisible to the `Meta+k` sweep that scoped this change. `matchesCombo`'s cmd tier accepts Ctrl on Linux, so it carried the identical failure mode. Converted; it proves palette content, not chord reclaim, so nothing is lost.

Re-verified after rework: `just check` clean; 30 e2e tests green across `board-autofit`, `settings-dialog`, `zen-mode`, `terminal-export`, `compose-strip`.

Scope grew by one file (24 → 25 specs + `_ready.ts`) because of finding 4.

## Notes — Apply Outcome

Verified green: 154 e2e tests across every converted spec, 0 failed, 0 flaky, in four batches — (1) `compose-strip` + `terminal-export` + `shortcut-registry` (44), (2) `terminal-tile-find` + `web-tile-find` + `zen-mode` + `settings-dialog` (18), (3) `top-bar-overflow` + `code-surface` + `web-tile-zoom` + `open-in-app` + `macro-riff-bindings` + `sidebar-multiselect` + `chat-view` (51), (4) `agent-next-waiting` + `boards-pin-flow` + `create-server-waiting` + `operator-compose` + `operator-digest` + `protected-kill-confirm` + `session-name-prompt` + `sort-windows` + `spawn-agent` (31), plus `web-view-lens` (10). `just check` (tsc) clean.

`compose-strip.spec.ts:830` — the test whose CI flake started this — passed on the first attempt in batch 1.

The `web-view-lens` memory note predicting local-only failures at :194/:412/:444/:521 did not reproduce: all 10 passed.

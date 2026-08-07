# Intake: Split-Action Keyboard Shortcuts

**Change**: 260807-phc4-split-keyboard-shortcuts
**Created**: 2026-08-07

## Origin

Promptless dispatch from `/fab-proceed`, synthesized from a `/fab-discuss` conversation (the sole source). Interaction mode: one-shot, all design decisions pre-resolved in discussion.

> Add keyboard shortcuts for the existing Split actions in run-kit: **⇧⌘\ (Shift+CmdOrCtrl+Backslash) for Split Horizontal** and **⇧⌘- (Shift+CmdOrCtrl+Minus) for Split Vertical**, registered in the declarative keybinding registry (`app/frontend/src/lib/keybindings.ts`).

Key decisions from the conversation (each verified against the code during intake):

- **Keycap-as-divider mnemonic**: Shift+\ types `|` (vertical divider → side-by-side → Split Horizontal); `-` is the horizontal divider (→ stacked → Split Vertical). Matches the SplitControl's own glyphs (`SplitHorizontalGlyph` draws a vertical divider) and sidesteps the horizontal/vertical naming ambiguity. Precedents: VS Code splits editors on ⌘\; Windows Terminal splits on Alt+Shift+Minus/Plus.
- **Shifted tier** for both, **no `macTier` demotion**: the `cmd` tier is unavailable as a base tier because on Windows/Linux it matches plain Ctrl chords, which belong to the pane (`shouldRefuseTerminalChord` never refuses plain-Ctrl there). Shifted-tier chords are always refused to the window dispatcher, so they fire even with terminal/pane focus.
- **Dual-scope registration**: same combos on `terminal` scope (`split-horizontal`/`split-vertical`) and `board` scope (`board-split-horizontal`/`board-split-vertical`) — the exact precedent of the ⌘[/⌘] board/history shadow pair.
- **Alternatives rejected**: iTerm2/Warp/Ghostty's ⌘D + ⇧⌘D pair is structurally unrepresentable (the registry keeps the key code constant cross-platform and varies only the tier — both splits on `KeyD` collapse to two identical Shift+Ctrl+D bindings on Windows/Linux, a hard `findConflicts` conflict); ⇧⌘D + ⇧⌘S is ambiguous (split-vs-stack) and ⇧⌘S sits on browser Save-As; `H`/`V`/`R` letters are taken (window-prev / Shift+Ctrl+V terminal paste on Windows/Linux / reload).
- **Known soft spot** (accepted): Chrome may treat ⌘⇧- as zoom-out, but browser zoom keys are interceptable via `preventDefault` — same class as other bound chords.

## Why

1. **Pain point**: splitting a pane is a frequent terminal/board action, but today it is reachable only through the mouse (the top-bar SplitControl chip) or the command palette (`Window: Split Horizontal` / `Board: Split Focused Pane Horizontal` and their Vertical twins) — two-plus interactions for a one-chord operation every comparable terminal app (iTerm2, VS Code, Windows Terminal, Warp, Ghostty) puts on a direct shortcut.
2. **Consequence of not fixing**: Constitution Principle V (Keyboard-First — "every user-facing action MUST be reachable via keyboard") is satisfied only in the weak palette sense; heavy split users pay the palette round-trip on every split, and run-kit's shortcut surface lags the terminal-app baseline users arrive with.
3. **Why this approach**: the declarative keybinding registry (260730-g40a) exists precisely so new chords are pure data rows plus per-route handler entries — no new listeners, automatic palette hints (`withShortcutHints`, since actionId doubles as the palette id), automatic shortcuts-overlay rows, per-device rebindability, and unit-testable conflict freedom. The chosen combos passed the claims check; the rejected alternatives are documented above.

## What Changes

### 1. Registry entries (`app/frontend/src/lib/keybindings.ts`)

Add four `DEFAULT_BINDINGS` rows — two terminal-scoped, two board-scoped — following the existing entry shape (label/description/mapLabel; order = overlay display order within each group):

```ts
// terminal route (palette ids at app.tsx ~line 1905)
{ actionId: "split-horizontal", code: "Backslash", tier: "shifted", scope: "terminal", kind: "builtin", label: "Split horizontal", description: "side-by-side panes (tmux -h)", mapLabel: "split |" },
{ actionId: "split-vertical",   code: "Minus",     tier: "shifted", scope: "terminal", kind: "builtin", label: "Split vertical",   description: "stacked panes",            mapLabel: "split -" },
// board route (palette ids at board-page.tsx ~line 824)
{ actionId: "board-split-horizontal", code: "Backslash", tier: "shifted", scope: "board", kind: "builtin", label: "Split focused pane horizontal", mapLabel: "split |" },
{ actionId: "board-split-vertical",   code: "Minus",     tier: "shifted", scope: "board", kind: "builtin", label: "Split focused pane vertical",   mapLabel: "split -" },
```

Exact `label`/`description`/`mapLabel` strings are presentational and may be tuned at apply to match overlay row conventions; the actionIds, codes, tier, scopes, and absence of `macTier`/`ignoreInputs` are the decided contract. No `macTier` on any of the four (decision above). No `ignoreInputs` — splits should suppress in real text inputs like other action chords.

Semantics reminder (run-kit naming, per the palette comments at both call sites, 260806-2x2h): "Split Horizontal" = tmux `-h` = side-by-side panes (vertical divider), the primary/default, listed first; "Split Vertical" = stacked (horizontal divider).

**Why this is conflict-free** (claims check, verified in `claimedKeys()`/`tiersCollide`/`scopesOverlap`):

- Shifted-tier `Backslash` and `Minus` are unclaimed on every host (shifted claims today: digits 1–9 win/linux, ⇧⌘3/4/5 mac screenshots, R, I win/linux, Q mac, C/V win/linux, N/T/W browser-only).
- ⌘\ (sidebar-toggle) and the mac-shell ⌘- zoom claim are on the disjoint `cmd` tier — `tiersCollide("shifted", "cmd")` is false.
- Terminal vs. board same-combo registration is not a conflict: `findConflicts` requires EQUAL scopes, and `scopesOverlap("terminal", "board")` is false (the routes never co-mount) — the established ⌘[/⌘] shape.

### 2. Terminal-route handlers (`app/frontend/src/app.tsx`)

Add two entries to the existing `keybindingHandlers` memo (~line 2629), reusing the palette bodies via the existing `fromPalette` lookup — the same pattern as `create-session`/`kill-window`:

```ts
"split-horizontal": fromPalette("split-horizontal"),
"split-vertical": fromPalette("split-vertical"),
```

The palette entries (app.tsx ~1905) already gate on `sessionName` and call `executeSplit(server, currentWindow.windowId, horizontal, currentWindow.worktreePath)`; an absent palette action yields `undefined` → the chord falls through untouched (existing dispatch-seam behavior). No changes to `hooks/use-keybinding-dispatch.ts` itself — handler maps only.

### 3. Board-route handlers (`app/frontend/src/components/board/board-page.tsx`)

Add two entries to the existing `boardKeyHandlers` memo (~line 356), gated on `focusedPane` and using the same body as the board palette entries (~line 824) — one derivation of the active-pane cwd via the shared `focusedPane` memo, per the parsimony note at that call site:

```ts
"board-split-horizontal": focusedPane ? () => executeSplit(focusedPane.server, focusedPane.windowId, true, focusedPane.cwd) : undefined,
"board-split-vertical":   focusedPane ? () => executeSplit(focusedPane.server, focusedPane.windowId, false, focusedPane.cwd) : undefined,
```

(`focusedPane` and any needed deps join the memo dep array. If extracting a shared callback consumed by both the palette entry and the handler is cleaner, apply may do so — behavior contract: focused tile's window, Horizontal → `horizontal: true`.)

### 4. Free riders (no code)

- **Palette hints**: `withShortcutHints` decorates palette actions whose id matches a binding actionId — all four palette entries pick up "⇧⌘\" / "⇧⌘-" (or "Shift+Ctrl+\" / "Shift+Ctrl+-") hints automatically.
- **Shortcuts overlay + tier map**: new rows/keycaps render from registry data.
- **Terminal focus**: `shouldRefuseTerminalChord` rule 1 (any enabled shifted-tier match) already routes the chords past xterm to the window dispatcher.
- **Rebindability/overrides**: the existing per-device override layer applies with no extra work.

### 5. Tests

Extend the colocated unit tests per project convention (constitution: tests for new behavior; Principle V keyboard reachability):

- `src/lib/keybindings.test.ts` — extend the `DEFAULT_BINDINGS integrity` suite with a per-action spec in the existing style (e.g., "split pair: ⇧⌘\ / ⇧⌘- on terminal AND board scopes, shifted tier, no mac demotion"), asserting actionId/code/tier/scope and no `macTier` for all four rows. The existing "has unique actionIds" and "ships conflict-free defaults in every host" tests automatically cover the additions.
- Handler-mounting tests colocated with the route shells if precedent exists for prior chord additions (follow whatever 260801-sm6g/260801-mqim did); `use-keybinding-dispatch.test.ts` needs no change (the seam is untouched).
- No Playwright e2e planned (no existing keybinding e2e spec; registry data + handler presence are unit-proven per existing convention). If apply does touch a `.spec.ts`, the sibling `.spec.md` companion MUST be updated in the same commit (constitution: Test Companion Docs).

## Affected Memory

- `run-kit/ui-patterns`: (modify) keybinding-registry section — the shifted-tier action set gains the four split bindings (dual-scope terminal/board same-combo pair, keycap-as-divider mnemonic, no mac demotion); palette entries for split now carry chord hints.

## Impact

- `app/frontend/src/lib/keybindings.ts` — four new `DEFAULT_BINDINGS` rows (data only).
- `app/frontend/src/lib/keybindings.test.ts` — extended integrity specs.
- `app/frontend/src/app.tsx` — two `keybindingHandlers` entries (terminal route).
- `app/frontend/src/components/board/board-page.tsx` — two `boardKeyHandlers` entries (board route).
- No backend, no API, no routes, no new listeners, no changes to the dispatch hook or overlay components. Frontend-only; low blast radius; fully rebindable/reversible per-device.

## Open Questions

- None — all decisions were resolved in the originating discussion and verified against the code during intake.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Chord assignment: ⇧⌘\ → Split Horizontal, ⇧⌘- → Split Vertical (keycap-as-divider mnemonic) | Discussed — user chose this over the ⌘D pair (structurally unrepresentable) and letter pairs (claimed/ambiguous); matches SplitControl glyphs and VS Code/Windows Terminal precedents | S:90 R:85 A:90 D:85 |
| 2 | Certain | Both bindings on the shifted tier with no `macTier` demotion | Discussed + code-verified: `cmd` base tier would match plain Ctrl on Win/Linux (pane territory, never refused by `shouldRefuseTerminalChord`); shifted chords are always refused to the dispatcher | S:90 R:85 A:95 D:90 |
| 3 | Certain | Dual-scope registration: same combos on `terminal` (`split-horizontal`/`split-vertical`) and `board` (`board-split-horizontal`/`board-split-vertical`) scopes | Discussed + code-verified: `scopesOverlap("terminal","board")` is false and `findConflicts` requires equal scopes — the ⌘[/⌘] shadow-pair precedent | S:90 R:85 A:95 D:90 |
| 4 | Certain | Combos are conflict-free: shifted `Backslash`/`Minus` unclaimed on every host; ⌘\ sidebar and mac-shell ⌘- zoom sit on the disjoint `cmd` tier | Verified during intake against `claimedKeys()` and `tiersCollide` in `keybindings.ts` | S:85 R:90 A:100 D:95 |
| 5 | Certain | Handler wiring reuses existing seams: `fromPalette` entries in app.tsx `keybindingHandlers`; `focusedPane`-gated `executeSplit` entries in board-page `boardKeyHandlers`; no dispatch-hook changes | Code-verified existing pattern (create-session/kill-window via fromPalette; board-cycle handlers gated on entries) — undefined handler = fall-through by design | S:85 R:90 A:90 D:85 |
| 6 | Confident | Chrome's ⌘⇧- zoom-out overlap is acceptable | Discussed — dispatcher `preventDefault` intercepts browser zoom keys; same class as other bound chords; per-device rebind is the escape hatch | S:75 R:85 A:70 D:70 |
| 7 | Confident | Exact `label`/`description`/`mapLabel` strings (e.g. "Split horizontal") are apply-time presentational choices within the decided contract | Registry entry shape is established; strings are trivially reversible and constrained by overlay conventions | S:65 R:95 A:80 D:70 |
| 8 | Confident | Test scope: extend `keybindings.test.ts` integrity suite (+ route-shell handler tests only if precedent exists); no new Playwright e2e | Follows the colocated-unit-test convention of prior chord additions (260801-sm6g, 260801-mqim); no keybinding e2e spec exists today; `.spec.md` rule binds only if a `.spec.ts` is touched | S:70 R:90 A:80 D:70 |

8 assumptions (5 certain, 3 confident, 0 tentative, 0 unresolved).

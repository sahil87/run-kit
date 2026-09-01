# Intake: Second Palette Chord for Win/Linux Terminal Focus

**Change**: 260831-m1v0-palette-shifted-chord-alias
**Created**: 2026-08-31

## Origin

Emerged from triaging a CI flake on PR #778. Hardening the e2e palette opener (change `260830-my49`, PR #779) required determining why a palette chord is sometimes lost on the Linux rig. The mechanism turned out to be a **product** property, not a test one, and the user asked to pursue it as its own change.

The user's first instinct was *"just take Ctrl+K for the command palette and move other things."* That is not available: Ctrl+K is not a run-kit shortcut. It is the byte `0x0B`, and what it means is decided by whatever program is attached to the pane — verified on this machine, both shells bind it:

```
bash readline:  "\C-k": kill-line
zsh ZLE:        "^K" kill-line
```

There is no registry entry to re-point; the binding lives in the user's shell. Our only lever over Ctrl+K is to swallow it, which removes kill-line from every pane with no way to give it back.

The user then asked what comparable tools do. Prior art is consistent — VS Code (`Ctrl+Shift+P`, plus a `terminal.integrated.commandsToSkipShell` allowlist that lets the palette bypass the shell), Windows Terminal (`Ctrl+Shift+P`), and the GNOME Terminal/Konsole convention of putting every app-level action on `Ctrl+Shift+*` precisely because `Ctrl+<letter>` belongs to the program in the pane. run-kit already encodes that convention as `tier: "shifted", macTier: "cmd"`; the palette is the only action that never got it.

A plain retier was then presented alongside two alternatives, and **the user explicitly chose to add a second chord rather than move the existing one**.

## Why

### The problem, verified

`command-palette` is `tier: "cmd"` at `keybindings.ts:317` with no per-platform refinement. The `cmd` tier accepts **Meta or Ctrl**, so the Win/Linux chord is plain **Ctrl+K**. Under terminal focus that chord dies:

- `shouldRefuseTerminalChord`'s cmd-tier rule (rule 2) is **macOS-gated by design** — on Win/Linux, cmd-tier combos *are* plain-Ctrl chords, and plain-Ctrl belongs to the pane. The source comment says so explicitly.
- So xterm handles Ctrl+K rather than refusing it, and `preventDefault`s it.
- `use-keybinding-dispatch.ts` drops it on its opening `if (e.defaultPrevented) return`.

Confirmed empirically with a throwaway probe on the real Linux e2e rig (written, run, then deleted):

```
PROBE_RESULT terminal-focus=SWALLOWED  chrome-focus=OPENED
```

This is **longstanding, not a regression**: rule 2 was *added* as a mac-only refinement, so Win/Linux never had it.

### Why it matters

Constitution Principle V makes the command palette the guaranteed keyboard fallback and requires every user-facing action be keyboard-reachable. On Windows and Linux the palette itself is currently unreachable by keyboard from the application's **primary focus context** — a terminal pane. A clickable ⌘K affordance exists in the status bar (`status-bar.tsx:580`) and bottom bar (`bottom-bar.tsx:465`), so the palette is mouse-reachable; a mouse-only path does not satisfy Principle V.

There is a second, sharper defect: both affordances render a `kbd` hint from `chordFor("command-palette")`, so the UI **actively advertises Ctrl+K** while that chord silently does nothing where the user usually is — and quietly eats their shell line instead.

### Why a second chord rather than moving the existing one

`⇧Ctrl+K` works under terminal focus with **no seam change at all**: rule 1 already refuses *any* enabled shifted-tier match on every platform, and its own stated rationale is that legacy TTY encoding cannot distinguish Ctrl+Shift+letter from Ctrl+letter — the pane would receive the same `0x0B` — so refusing costs the pane nothing.

But moving the palette *onto* it would regress Firefox users, so both chords stay. See § Rejected Alternatives.

## What Changes

### 1. A second binding for `command-palette` on the shifted tier

Win/Linux gains **⇧Ctrl+K** alongside today's **Ctrl+K**. macOS is untouched — ⌘K remains its only palette chord, byte-identical before and after.

| Host | Chord(s) | Works under terminal focus? |
|------|----------|------------------------------|
| mac (shell + browser) | ⌘K | yes (rule 2, unchanged) |
| Win/Linux Chrome | ⇧Ctrl+K **and** Ctrl+K | ⇧Ctrl+K yes; Ctrl+K no (unchanged) |
| Win/Linux Firefox | ⇧Ctrl+K **and** Ctrl+K | neither — ⇧Ctrl+K is eaten by Firefox's Web Console; Ctrl+K keeps working off-terminal exactly as today |

### 2. The alias model — the real design work

Two registry rows sharing one `actionId` **do not work today**. Established by reading the code, do not re-derive:

- `BindingOverrides` is `Record<actionId, BindingOverride>` and `resolveBindings` reads `overrides[def.actionId]` (`keybindings.ts:696`) — two rows sharing an actionId share **one override slot**, so rebinding one would rebind both.
- `byAction` is `new Map(bindings.map(b => [b.actionId, b]))` (`use-keybindings.ts:110`) — a duplicate actionId **silently collapses** (last wins), breaking palette hints and `chordFor`.
- No actionId currently repeats in `DEFAULT_BINDINGS`.

The plan MUST choose between, and justify:

- **(i) A distinct actionId for the alias row** (e.g. `command-palette-alt`) whose handler points at the same function. Cheap and touches little, but it surfaces as a separate row in the Shortcuts tab and needs a display decision so it does not read as a second, unrelated action.
- **(ii) A first-class `aliasOf` field** on `KeyBinding`, with `byAction`, the override layer, and conflict detection made alias-aware. More invasive, but a better model and more in keeping with the declarative `ttyOnly` / `webOnly` / `macTier` precedent this registry already uses.

### 3. Display decisions the plan must settle

- What a two-chord action renders as its **palette hint** (`withShortcutHints`, `keybindings.ts:958`). Note its existing contract: *disabled bindings contribute NO hint — a hint advertising a dead chord would lie.* That rule is directly load-bearing here (see § 4).
- What the **Settings → Shortcuts** keycap grid shows for an action with two chords.
- What the status-bar and bottom-bar **Tip `kbd`** labels show.
- Whether the alias is **independently rebindable / unbindable**, which largely follows from the model chosen in § 2.

### 4. Firefox and the claimed-keys table

Firefox reserves `Ctrl+Shift+K` for its Web Console and does not let pages intercept it. The claimed-keys table currently models only `platform: "mac"` entries plus a shell-vs-browser split — it has **no Firefox-vs-Chrome axis**.

Adding one is optional for correctness (the chord simply never fires in Firefox; Ctrl+K still works there off-terminal, so nothing regresses) but valuable for honesty: `withShortcutHints` already omits hints for browser-reserved bindings, so a claim would stop Firefox users being shown a chord that cannot fire. The plan MAY defer this; if it does, it must say so explicitly rather than leaving it unstated.

> **Verification caveat carried forward**: the Firefox behavior above comes from documentation, not from testing. The e2e rig is Chromium-only. Do not write a spec or memory claim that asserts verified Firefox behavior.

### 5. The e2e helper

`openPalette` in `app/frontend/tests/e2e/_ready.ts` must press the chord that works under terminal focus, so its blur-on-retry becomes a fallback rather than the mechanism. This is a **one-line change** only because change `260830-my49` (PR #779) just consolidated 39 call sites into that single helper; before it, this was a 39-site edit across 23 files.

## Affected Memory

- `run-kit/ui/keyboard-and-palette.md`: (modify) the tier table, the per-platform default-tier section, and § Dispatch seams → Terminal seam — record that the palette answers to two chords on Win/Linux and why the shifted one reaches it under terminal focus. The Terminal-seam § already carries the e2e consequence note added by `260830-my49`; update it to current truth rather than appending.
- `run-kit/architecture.md`: (modify) only if the `openPalette` description in § Testing layers names the chord it presses.

## Impact

**Product code:** `app/frontend/src/lib/keybindings.ts` (registry row(s), possibly `KeyBinding`/`EffectiveBinding` types, `withShortcutHints`, claimed keys), `app/frontend/src/hooks/use-keybindings.ts` (`byAction`), `app/frontend/src/components/settings-shortcuts-panel.tsx`, and wherever `chordFor` feeds Tip `kbd` labels (`status-bar.tsx`, `bottom-bar.tsx`).

**Deliberately NOT changed:** `terminal-client.tsx` and `shouldRefuseTerminalChord`. ⇧Ctrl+K already bubbles via rule 1; adding a refusal rule would be redundant and would risk the plain-Ctrl guarantee the seam deliberately protects.

**Tests:** `keybindings.test.ts` (per-platform default assertions, conflict detection, override round-trip), `settings-shortcuts-panel.test.tsx`, `command-palette.test.tsx` if hints are asserted, and the e2e helper.

**Branch:** stacked on PR #779 — the `openPalette` helper this updates is not yet on `main`. Rebase onto `main` once #779 merges.

**Risk:** low-to-moderate. The chord addition is additive and mac is untouched, so the blast radius is the registry model itself — an alias concept that `byAction`, the override layer, and the overlay all read. `tiersCollide("cmd","shifted")` is `false` (`keybindings.ts:743`), so the two rows do **not** trip `findConflicts` and need no carve-out.

## Open Questions

- None blocking. The two genuinely open decisions — the alias model (§ 2) and the Firefox claim (§ 4) — are recorded as plan-stage decisions with their constraints and trade-offs enumerated above, not as unresolved unknowns.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Add ⇧Ctrl+K as a SECOND chord; keep Ctrl+K; leave mac at ⌘K | Explicit user decision from a presented three-option set. The stated goal was that nobody regresses | S:95 R:75 A:90 D:95 |
| 2 | Certain | The palette chord is genuinely lost under terminal focus on Win/Linux | Traced through four code sites AND confirmed by a throwaway probe on the real Linux rig (`terminal-focus=SWALLOWED chrome-focus=OPENED`) — not inference | S:95 R:85 A:95 D:90 |
| 3 | Certain | No terminal-seam change is needed | Rule 1 already refuses every enabled shifted-tier match on every platform, and its rationale (Ctrl+Shift+letter encodes to the same control byte, so refusal is free) applies verbatim | S:90 R:80 A:90 D:85 |
| 4 | Certain | Stealing plain Ctrl+K was correctly rejected | `0x0B` is readline/ZLE `kill-line`, verified in both bash and zsh on this machine. Interception is a loss with no recourse short of a per-device unbind | S:90 R:80 A:95 D:90 |
| 5 | Confident | The alias needs a model change, not just a second array row | `overrides` and `byAction` are both keyed by `actionId` (read directly), so a naive duplicate shares an override slot and collapses in the hint map. Which of the two models to adopt is deliberately left to the plan | S:80 R:70 A:85 D:60 |
| 6 | Confident | Specs need no change | Grepped `docs/specs/`: `design.md` references ⌘K as a top-bar glyph and Principle V restatement, `architecture.md` as a filename comment. Neither specifies a per-platform chord table — the registry plus `docs/memory/` own that | S:70 R:80 A:85 D:75 |
| 7 | Tentative | The Firefox claimed-keys entry can be deferred | Nothing regresses without it (Ctrl+K still works off-terminal in Firefox), and the claims table has no Firefox-vs-Chrome axis today, so adding one is its own design step. But leaving it out means Firefox users are shown a hint for a chord that cannot fire — the exact defect § Why calls out. Genuinely a judgment call for the plan <!-- assumed: Firefox claimed-key entry deferrable; plan must decide explicitly rather than silently omit --> | S:50 R:70 A:55 D:45 |
| 8 | Tentative | Firefox reserves ⇧Ctrl+K and pages cannot intercept it | From documentation and reported cases of web apps losing Ctrl+Shift+P to Firefox — NOT verified by testing, and the e2e rig is Chromium-only. Load-bearing for the option chosen, so it must not be written into memory or specs as verified fact <!-- assumed: Firefox reservation of Ctrl+Shift+K is documented but untested here --> | S:55 R:65 A:45 D:50 |

8 assumptions (4 certain, 2 confident, 2 tentative, 0 unresolved).

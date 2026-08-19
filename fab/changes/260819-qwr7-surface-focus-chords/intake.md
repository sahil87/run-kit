# Intake: Surface Hide/Focus Shortcut Family

**Change**: 260819-qwr7-surface-focus-chords
**Created**: 2026-08-19

## Origin

Synthesized from a full design discussion with the user, dispatched promptless via `/fab-proceed` (any would-be questions recorded as deferred rows below, not asked — this run produced none: the discussion resolved every decision point).

> Surface hide/focus shortcut family — stateful surface chords (⌘B/⌘1/⌘2/⌘3/⌘I), zen mode (⇧⌘⏎), compose focus fix, palette parity gap-fills, Win/Linux shell switcher relocation.

The user analyzed the JetBrains tool-window model, iTerm2/Cursor/VS Code habits, and run-kit's declarative keybinding registry (`app/frontend/src/lib/keybindings.ts`; documented in `docs/memory/run-kit/ui/keyboard-and-palette.md`) and locked the full keymap, the stateful semantics, the focus-memory integration rules, the browser-degradation posture, and the Win/Linux switcher relocation. All chords, tiers, and rejected alternatives below were decided in that conversation and are final.

## Why

1. **No keyboard way to focus a specific surface.** There is no chord that *focuses* the sidebar, the terminal tile, the code tile, the web tile, or the compose strip. The user's concrete pain: after typing `rk riff` they focus the compose strip by pressing ⇧⌘E **twice** — hide then show — because the strip only focuses on open (the `markComposeStripFocusOnOpen` seam). A pure-toggle chord family cannot express "put my cursor there".
2. **No chord for zen/maximize.** The layout's existing Zoom verb (`Layout: Zoom`/`Unzoom`, the slot-A `zoomToggleRef` seam) is palette-only.
3. **Palette parity gaps (verified by grep against `src/app.tsx` / `src/lib/palette-*.ts`):** `sidebar-toggle` (⌘B) has NO palette entry; `window-prev`/`window-next` (⇧⌘H/L) have NO palette entries (`app.tsx:3302` documents this; the existing `Window: Move up/down` entries are *reordering*, a different action). This violates the spirit of Constitution V — the palette is the primary discovery mechanism, so every bound action should be discoverable there.
4. **If we don't fix it:** users keep paying the double-press tax on compose, mouse-only focus for every other surface, and the palette keeps advertising an incomplete action surface while muscle-memory builds on chords the palette cannot teach.
5. **Why this approach:** one *stateful* chord per surface (JetBrains tool-window model) halves keycap spend versus separate toggle/focus layers, gives every surface both verbs, and composes with the existing focus-memory/steal-guard machinery instead of adding a parallel focus system.

## What Changes

**Philosophy: shell-first (explicit user decision).** The desktop (Electron) app is the primary chord target; browser/PWA degrade gracefully — chords the browser blocks stay palette-reachable. No pre-ship browser-interception verification gate is required under this posture.

**Semantics: stateful JetBrains-tool-window model per surface chord** — one chord per target:

- hidden → show + focus
- visible but unfocused → focus
- focused → hide

No separate toggle layer, no separate focus layer.

### 1. Keymap (mac default / Win-Linux default)

| Chord | Target | Registry shape / notes |
|---|---|---|
| ⌘B / ⇧Ctrl+B | Sidebar | existing `sidebar-toggle` row kept (`KeyB`, `tier: "shifted"`, `macTier: "cmd"`, global scope — `keybindings.ts:212`); **semantics change** from pure toggle to stateful. Focus lands on the current window's sidebar row via a plain `.focus()` on that row — existing tab-order accessibility suffices. **Escape while focus is inside the sidebar returns focus to where it came from WITHOUT hiding.** The hide branch fires only when focus is already inside the sidebar. |
| ⌘1 / ⇧Ctrl+1 | Terminal tile | **new binding**, code `Digit1`, base tier `shifted`, `macTier: "cmd"` |
| ⌘2 / ⇧Ctrl+2 | Code tile | `code-toggle` actionId survives with a new default on `Digit2` (today `KeyJ` — `keybindings.ts:219`); **the ⌘J / ⇧Ctrl+J default is retired outright** (user decision — no legacy alias) |
| ⌘3 / ⇧Ctrl+3 | Web tile | **new binding**, code `Digit3`, same tiers as Digit1 |
| ⌘I / ⇧Ctrl+E | Compose strip | `compose-toggle` becomes stateful; Win/Linux default stays ⇧Ctrl+E (`KeyE`, shifted — ⇧Ctrl+I is the win/linux DevTools shell claim); mac default moves to ⌘I via `macCode: "KeyI"` + `macTier: "cmd"` (Cursor ⌘I Composer / VS Code inline-chat habit). **This deliberately supersedes the recorded "⇧⌘E do-not-move" constraint** (`docs/memory/run-kit/ui/keyboard-and-palette.md:51`) — hydrate must rewrite that line. `ignoreInputs: true` stays (the hide branch must fire from inside the strip's own textarea). |
| ⇧⌘⏎ / ⇧Ctrl+⏎ | Zen | **new binding**, code `Enter`, `shifted` tier on both platforms; toggles the existing Zoom verb on the focused tile via the app-level zoom ref seam — the `Layout: Zoom`/`Unzoom` palette bodies (`palette-layout.ts:144-150`, `zoomToggleRef` in `surface-layout.tsx`); no-op at arity 1 (zoom's existing gate). iTerm2 ⇧⌘⏎ maximize-pane habit; ⇧⌘M was rejected (one shift from ⌘M minimize, opposite meaning). Plain zoom only — no compound sidebar collapse. |
| ⌃` (unchanged) | tty⇄code focus hop | `focus-hop` untouched |

### 2. Focus-memory / steal-guard integration (load-bearing)

Per-window focus memory (`src/lib/focus-memory.ts`, `FocusKind = tty | compose | code`) and the code-server steal guard have a deliberate recording asymmetry the chords must respect:

- **⌘1-to-terminal records `tty`** — via the existing `recordTtySlot` / palette focus seam (the same recording the palette `Tile: Focus Terminal` path performs).
- **⌘I records `compose`** — genuine textarea focus fires the existing `onFocus` recorder; no new recording call needed.
- **⌘2-to-code records NOTHING** — only in-frame `onInteract` records `code`; a chord hop must never teach the guard a code preference, exactly like `focus-hop` (`app.tsx:3402` documents the same rule for ⌃`).
- **⌘B records nothing** — the sidebar is chrome, not a per-window `FocusKind`.

Mechanism reuse:

- **Show-hidden-tile** rides the existing open-then-focus mechanism — generalize the `focusCodeOnLandingRef` flag pattern (`app.tsx:947-951`) to a per-kind landing flag.
- **Focus-visible-tile** rides `layoutFocusTileRef` (`app.tsx:941`, registered by `surface-layout.tsx`).
- **Hide-when-focused** runs `togglePanel(surface)` (`app.tsx:862`) then returns focus via the restore router's `restoreFocus` (`app.tsx:967`) so focus never strands in a dead slot.
- **Compose show+focus** rides `toggleComposeStrip()` + the `markComposeStripFocusOnOpen`/`consumeComposeStripFocusOnOpen` seam; compose focus-when-visible rides `focusComposeStrip()` (`lib/compose-strip-events.ts:78`).

### 3. Sidebar stateful handler

`sidebar-toggle` is currently a component-local listener — `useSidebarKeyboardToggle` in `src/components/shell/shell.tsx:23`. It needs the stateful handler: show+focus when hidden, focus the current window's row when visible-unfocused, hide (then `restoreFocus`) when focus is inside the sidebar. Escape inside the sidebar returns focus to its origin WITHOUT hiding. Only the focus-current-row + Escape-return behaviors are in scope — **no roving/arrow-key navigation** (existing tab-order a11y suffices).

### 4. Win/Linux shell switcher relocation (IN scope — explicit user decision)

The desktop shell's server switcher currently owns ⇧Ctrl+1–9 on win/linux (`app/desktop/src/menu.ts:321-351` accelerators; `SHELL_SWITCHER_DIGITS` claims data in `keybindings.ts:267`). Move it to **Alt+digit** accelerators — Electron menu accelerators are not bound by the page-tier no-Alt rule, and the mac switcher already lives outside the tiers on ⌥⌘1–9 — freeing ⇧Ctrl+1/2/3 for the surface chords. Update the claimed-keys data accordingly (retire/replace `SHELL_SWITCHER_DIGITS`; Alt combos are inexpressible in the tier system, so like the mac ⌥⌘ move the new claim is unrepresentable — which is the point). Update `menu.ts`'s exhaustive bound-accelerator doc comment in the same change (the hand-maintained mirror rule). **mac shell needs NO menu changes** (⌘0 not used by the page — sidebar is on B; ⌥⌘1–9 untouched).

### 5. Reserved layer

⇧⌘digit combos stay deliberately unbound, recorded as a `DEFAULT_BINDINGS`-adjacent comment (the existing ⇧⌘P precedent, `keyboard-and-palette.md:51`) for possible future positional tile jumps. Note: mac ⇧⌘3/4/5 remain system screenshot claims (`MAC_SCREENSHOT_CLAIMS`) — the comment should acknowledge the layer is partial on mac.

### 6. Palette parity gap-fills

New palette entries: **`Sidebar: Toggle`**, **`Sidebar: Focus`**, **`Window: Next`**, **`Window: Previous`**, **`Compose: Focus`**. Tiles already have `Tile: Show/Hide/Focus <Surface>` (`src/lib/palette-layout.ts`) — the new chords resolve through those bodies where applicable; `withShortcutHints` decorates automatically.

Add a **unit-test parity invariant** (the `findConflicts` invariant-test precedent in `keybindings.test.ts`): every `DEFAULT_BINDINGS` actionId must resolve to a palette entry or a documented equivalence, so parity cannot regress.

### 7. Browser degradation (shell-first consequences)

- mac-browser ⌘1–3 are browser tab digits (already claimed in `MAC_BROWSER_CMD_CLAIMS` → resolve reserved → palette-only there).
- ⌘I in a mac browser is an interception *attempt* (view-source/similar class — attempt `preventDefault`, degrade to palette if blocked; no pre-ship verification gate required under shell-first).
- PWA display-mode detection is OUT of scope.

### 8. Mobile

Every new chord/behavior is desktop-only — no-op on `isMobileViewport()` (the restore-router precedent; auto-focus pops the mobile keyboard).

### Rejected alternatives (decided in discussion — do not revisit)

- **⌘0 for sidebar** (VS Code parity): 0 sits at the RIGHT end of the number row, breaking the spatial left→right mirror; ⌘B is the stronger cross-tool habit; "⌘digit = tile, in screen order" is the crisper rule (sidebar is chrome, not a tile).
- **Letter-mnemonic pairing** (⌘X toggle / ⇧⌘X focus over B/E/J/U/Y + ⇧⌘M): letters exhaust fast with weak mnemonics (U=web, Y=terminal), doubles keycap spend; stateful single chords halve it.
- **Positional digit semantics** (⌘N = Nth slot): kind-fixed wins for stable identity (toggling needs a stable target); positional is reserved for the ⇧⌘digit layer later.
- **Keeping ⌘J as a legacy alias** for code: user chose retire outright.
- **Compound zen** (zoom + sidebar collapse with restore): rejected for now — couples transient zoom state with persisted sidebar state; plain zoom only.
- **Stateful-⇧⌘E-only** (no key move): solves the compose double-press but breaks family coherence.

### Out of scope (explicit)

Sidebar roving/arrow-key navigation · a chat-tile chord (stays palette-only) · a hide-without-focus layer · positional ⇧⌘digit bindings · PWA display-mode detection.

## Affected Memory

- `run-kit/ui/keyboard-and-palette`: (modify) new Digit1/Digit3/Enter bindings, `code-toggle` default move to Digit2 (⌘J retired), `compose-toggle` mac `macCode: "KeyI"` move — rewrite the "⇧⌘E do-not-move" constraint line, stateful-chord semantics, claimed-keys changes (SHELL_SWITCHER_DIGITS retirement), reserved ⇧⌘digit layer comment, palette parity entries + invariant test
- `run-kit/ui/focus-ownership`: (modify) chord-family recording asymmetry (⌘1 records tty, ⌘I records compose, ⌘2/⌘B record nothing), restore-router interplay on the hide branch
- `run-kit/ui/lenses-and-layout`: (modify) stateful tile chords riding `layoutFocusTileRef`/`togglePanel`/landing-flag, zen chord riding the `zoomToggleRef` seam
- `run-kit/ui/compose-and-bottom-bar`: (modify) compose chord becomes stateful (show+focus / focus / hide), ⌘I mac default, focus-on-open seam consumers
- `run-kit/ui/sidebar`: (modify) sidebar focus-current-row behavior, Escape-return-without-hide, hide-when-focused
- `run-kit/desktop-shell`: (modify) win/linux Hosts switcher moves to Alt+digit accelerators; bound-accelerator doc mirror update

## Impact

- `app/frontend/src/lib/keybindings.ts` — `DEFAULT_BINDINGS` rows (sidebar unchanged shape, code-toggle recode, compose macCode/macTier, 3 new rows), `SHELL_SWITCHER_DIGITS` retirement, reserved-layer comment, keycap `mapLabel`s; colocated `keybindings.test.ts` (+ new parity invariant test)
- `app/frontend/src/app.tsx` — dispatch handler map (`fromPalette`), stateful chord handlers, generalized landing flag (`focusCodeOnLandingRef` → per-kind), `restoreFocus` on hide, zen handler via the zoom ref seam, `Window: Next/Previous` + `Compose: Focus` palette entries
- `app/frontend/src/components/surface-layout.tsx` — `layoutFocusTileRef` focus-by-kind seam, focused-slot state (consumer; changes only if the stateful branches need new outputs)
- `app/frontend/src/components/shell/shell.tsx` — `useSidebarKeyboardToggle` becomes the stateful handler + focus/Escape behavior; `Sidebar: Toggle`/`Sidebar: Focus` palette wiring
- `app/frontend/src/lib/focus-memory.ts` + `src/lib/compose-strip-events.ts` — consumers only (recording seams already exist)
- `app/frontend/src/lib/palette-layout.ts` (and siblings) — chords resolve through existing `Tile:` bodies; `withShortcutHints` decoration is automatic
- `app/desktop/src/menu.ts` — win/linux switcher accelerators ⇧Ctrl+digit → Alt+digit + doc-comment mirror
- Settings shortcuts panel, capture, hints: automatic via the registry (no bespoke work expected beyond `mapLabel`s)
- **Testing**: registry/unit changes in Vitest (`keybindings.test.ts` colocated); focus behaviors involving the code iframe need Playwright on the port-3020 rig (jsdom can't prove iframe focus — the `focus-restore.spec.ts` harness precedent). Constitution: every new/modified `.spec.ts` ships its sibling `.spec.md`. UI changes SHOULD include e2e where possible.

## Open Questions

None — all decision points were resolved in the design discussion or graded as assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Shell-first philosophy: desktop shell is the primary chord target; blocked browser chords degrade to palette-only, no pre-ship interception verification gate | Discussed — explicit user decision | S:95 R:70 A:90 D:90 |
| 2 | Certain | Stateful JetBrains-tool-window semantics per chord (hidden→show+focus, visible-unfocused→focus, focused→hide); no separate toggle/focus layers | Discussed — explicit user decision after weighing letter-pair alternative | S:95 R:60 A:85 D:90 |
| 3 | Certain | Keymap: ⌘B sidebar, ⌘1 tty (Digit1), ⌘2 code (Digit2), ⌘3 web (Digit3), ⌘I compose (macCode on KeyE row), ⇧⌘⏎/⇧Ctrl+⏎ zen; Win/Linux ⇧Ctrl variants; ⌃` untouched | Discussed — exact chords, codes, and tiers locked in conversation | S:95 R:65 A:90 D:95 |
| 4 | Certain | ⌘J/⇧Ctrl+J code-toggle default retired outright — no legacy alias | Discussed — user chose retire over alias | S:95 R:75 A:90 D:90 |
| 5 | Certain | Compose mac default moves ⇧⌘E → ⌘I, deliberately superseding the recorded "do-not-move" constraint (keyboard-and-palette.md:51); Win/Linux stays ⇧Ctrl+E (⇧Ctrl+I is the DevTools claim) | Discussed — explicit supersession; hydrate rewrites the memory line | S:95 R:60 A:85 D:90 |
| 6 | Certain | Win/Linux Hosts switcher relocates ⇧Ctrl+1–9 → Alt+digit menu accelerators, freeing the shifted digits; claims data updated; mac shell untouched | Discussed — explicit user decision; menu.ts digit-accelerator flakiness caveat acknowledged (same class as the accepted mac ⌥⌘ move) | S:90 R:70 A:80 D:85 |
| 7 | Certain | Focus-memory asymmetry: ⌘1 records `tty` (recordTtySlot seam), ⌘I records `compose` (textarea onFocus), ⌘2-to-code and ⌘B record NOTHING | Discussed — mirrors the focus-hop rule verified at app.tsx:3402 and focus-ownership memory | S:90 R:65 A:90 D:90 |
| 8 | Certain | Zen rides the existing `Layout: Zoom`/`Unzoom` palette bodies via the app-level zoom ref seam; no-op at arity 1; plain zoom only (compound rejected) | Discussed — seam verified (palette-layout.ts:144, zoomToggleRef) | S:90 R:75 A:90 D:90 |
| 9 | Certain | All new chords/behaviors are desktop-only — no-op on `isMobileViewport()` | Discussed — restore-router precedent; auto-focus pops the mobile IME | S:90 R:85 A:90 D:90 |
| 10 | Certain | Palette gap-fills: `Sidebar: Toggle`, `Sidebar: Focus`, `Window: Next`, `Window: Previous`, `Compose: Focus`; tile chords resolve through existing `Tile:` bodies | Discussed — parity gaps verified by grep (app.tsx:3302 confirms window-prev/next have no entries) | S:90 R:85 A:90 D:90 |
| 11 | Certain | Reserved ⇧⌘digit layer stays unbound, recorded as a DEFAULT_BINDINGS-adjacent comment (⇧⌘P precedent); out-of-scope list as stated | Discussed — explicit; mac ⇧⌘3/4/5 screenshot claims noted | S:90 R:90 A:90 D:90 |
| 12 | Certain | Sidebar focus behavior: focus the current window's row via plain `.focus()` (tab-order a11y suffices, no roving nav); Escape returns focus without hiding; hide branch only when focus is inside the sidebar | Discussed — explicit user decision on all three behaviors | S:90 R:70 A:85 D:85 |
| 13 | Confident | New tile bindings (Digit1/Digit3) and the zen binding take `scope: "terminal"`, matching `code-toggle` — tiles and zoom exist only on the window route | Not stated verbatim; registry pattern gives one obvious answer | S:60 R:85 A:85 D:75 |
| 14 | Confident | The hide branch no-ops when the target tile is the layout's only tile (arity 1), mirroring the palette's `Tile: Hide` omission on `single` layouts | Not stated; existing palette gate is the obvious analog | S:55 R:85 A:80 D:75 |
| 15 | Confident | New actionId names for the terminal/web/zen bindings follow the existing `code-toggle` naming family; exact names are apply-level | Low-stakes, reversible, settings panel reads registry labels | S:50 R:90 A:85 D:70 |
| 16 | Confident | Escape-return origin tracking: remember the focus origin at chord time and restore via the existing restore-router path; exact storage mechanism is apply-level | Reversible implementation detail; restoreFocus seam verified | S:55 R:85 A:75 D:60 |
| 17 | Confident | Parity invariant test enumerates palette resolution via a static known-entries/documented-equivalence map (findConflicts invariant precedent); exact mechanism is apply-level | Palette entries are runtime-built, so the test needs a static mirror; design choice is reversible | S:60 R:85 A:75 D:65 |
| 18 | Confident | Zen binding carries `ignoreInputs: true` so ⇧⌘⏎ fires from the compose textarea (distinct from the Ctrl/Cmd+Enter submit chords — no classifier collision) | Not discussed; chrome-level-chord precedent (compose-toggle, shortcuts-overlay); exact-modifier matching keeps submit safe | S:35 R:90 A:70 D:55 |
| 19 | Certain | Testing split: Vitest for registry invariants; Playwright on the port-3020 rig for iframe-focus behaviors; new/modified `.spec.ts` ship sibling `.spec.md` | Constitution (Test Companion Docs) + code-quality.md mandate this | S:85 R:90 A:95 D:90 |

19 assumptions (13 certain, 6 confident, 0 tentative, 0 unresolved).

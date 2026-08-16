# Intake: VS Code Shortcut Realignment

**Change**: 260816-sm66-vscode-shortcut-realignment
**Created**: 2026-08-16

## Origin

Synthesized from a `/fab-discuss` conversation, dispatched promptless via `/fab-proceed` (deferred decisions recorded below, not asked).

> Keyboard-shortcut realignment with VS Code conventions — sidebar toggle on B, dedicated code-editor toggle on J, retire panel-toggle, tty↔code focus hop on Ctrl+backtick.

The user analyzed VS Code's and Conductor's UI-chrome shortcuts against run-kit's declarative registry (`app/frontend/src/lib/keybindings.ts`; documented in `docs/memory/run-kit/ui/keyboard-and-palette.md`) and locked four binding decisions plus two standing constraints (tier policy, ⇧⌘P reservation). All specific chords, tiers, and rationale below were decided in that conversation.

## Why

1. **The pain point**: run-kit's chrome chords fight VS Code muscle memory. The current `sidebar-toggle` default ⌘\ is *split editor* in VS Code, while VS Code's most-pressed chrome chord — ⌘B, toggle primary sidebar — is unbound in run-kit. Users who live in VS Code (the target audience: the code-server surface embeds it) pay a mis-fire tax on every sidebar toggle.
2. **Wasted and missing keycaps**: `panel-toggle` (⇧⌘. / ⇧Ctrl+.) is a generic "toggle the non-tty surface" chord spent on a chat panel that isn't ready for use — a wasted keycap. Meanwhile the code-server surface — run-kit's actual secondary panel — has no dedicated toggle, and there is no keyboard gesture to hop focus between the tty tile and the code tile (VS Code's ⌃` gesture, which composes with the per-window focus-memory system).
3. **If we don't fix it**: the registry's keycap budget stays misallocated while the code surface matures; every later realignment gets more expensive as users build habits on the current chords.
4. **Why this approach**: borrow VS Code's exact keycaps (B for sidebar, J for the secondary panel, backtick for the focus hop) while keeping the registry's existing consistency axis — letter constant everywhere, modifier per platform, mac demotes to ⌘ wherever the browser permits, frequency drives tier. The rejected alternative (a strict ⇧⌘-for-toggles rule) has worse mac ergonomics on the most-pressed chords; VS Code itself keeps its high-frequency toggles unshifted.

## What Changes

All changes are data + wiring in the existing declarative registry system — no new mechanism except one additional terminal-seam refusal rule. Registry ground rules that bind the design: matching is on `e.code` (layout-independent), the three-tier system (`shifted` / `cmd` / `ctrl`), Alt is excluded from every tier (⌥⌘B is inexpressible), claimed-keys data drives browser reservation per host, and plain Ctrl always belongs to the pane on Win/Linux.

### 1. Move `sidebar-toggle` from ⌘\ to the B keycap

Current row (`keybindings.ts:201`):

```ts
{ actionId: "sidebar-toggle", code: "Backslash", tier: "cmd", scope: "global", kind: "builtin", label: "Toggle sidebar" }
```

New shape — the `macTier: "cmd"` demotion pattern of the shipped ⌘[/⌘]/⌘/ set:

```ts
{ actionId: "sidebar-toggle", code: "KeyB", tier: "shifted", macTier: "cmd", scope: "global", kind: "builtin", label: "Toggle sidebar", mapLabel: "sidebar" }
```

- **macOS, BOTH hosts**: ⌘B (no `macShellOnly` — ⌘B is `preventDefault`-interceptable in a mac browser, the same class as the shipped ⌘D/⌘[/⌘]/⌘/ interceptions; it is not a browser-chrome accelerator, and no claimed-keys entry exists on `KeyB` in any tier).
- **Win/Linux**: ⇧Ctrl+B (shifted tier). Plain Ctrl+B stays with the pane — readline back-char and a common tmux prefix. `KeyB` is free in every Win/Linux claim set (browser shifted claims are N/T/W; system C/V; shell R/I/digits).
- The component-local listener `useSidebarKeyboardToggle` in `app/frontend/src/components/shell/shell.tsx` (lines ~14–30) reads the binding through `byAction.get("sidebar-toggle")` + `matchesCombo`, so it picks up the new default with no logic change — update its ⌘\-citing comments. The terminal seam needs no change for this row: rule 1 (shifted) covers Win/Linux, rule 2 (mac cmd+meta) covers ⌘B under terminal focus.
- `mapLabel: "sidebar"` is newly meaningful: `KeyB` has a keycap cell in the overlay's tier-map grids (unlike the old `Backslash`, which has none — the `Period`/`Backslash`/`Comma` no-cell precedent).
- Existing ⌘\ users rebind via the override layer (user-accepted); ⌘\ becomes free, unclaimed real estate (see Non-Goals).

### 2. Retire `panel-toggle` entirely

Remove the binding row (`keybindings.ts:208`, ⇧⌘. / ⇧Ctrl+.) **and** the action — nothing else needs a generic "toggle the first non-tty surface" action once the dedicated `code-toggle` exists. The user's explicit judgment: the chat panel isn't ready for use, so the generic chord is a wasted keycap. Removal sites:

- `app.tsx` handler map entry (`"panel-toggle": …` at ~line 3411) and the `toggleShortcut` hint plumbing into `buildLayoutActions` (~line 2885).
- `lib/palette-layout.ts` `toggleTarget`/`toggleShortcut` options (+ `palette-layout.test.ts` coverage) — the `Layout: Add/Close <Surface>` entries stay; they just stop carrying the ⇧⌘. hint. If `code-toggle` reuses this hint seam for the code surface's Add/Close entries, keep the options and retarget them; otherwise delete them.
- `keybindings.test.ts` (5 references) and the e2e `right-panel.spec.ts:388–392` (`Shift+Control+Period` presses) + its `.spec.md` companion (constitution Test Companion Docs — same commit).
- Web-tile toggling stays keyboard-reachable via the palette (`Layout: Add Web` / `Layout: Close Web`) and the top-bar surface toggles — Constitution V satisfied via palette.
- No override migration: orphaned `panel-toggle` entries in `localStorage["runkit-keybindings"]` are inert under `parseOverrides`' tolerant posture (resolution never looks them up once the action is gone).

### 3. Add `code-toggle` on the J keycap

New registry row — VS Code's ⌘J toggle-panel semantics, matching because the code editor is run-kit's secondary panel:

```ts
{ actionId: "code-toggle", code: "KeyJ", tier: "shifted", macTier: "cmd", scope: "terminal", kind: "builtin", label: "Toggle code editor", description: "open/close the code tile", mapLabel: "code" }
```

- **macOS, BOTH hosts**: ⌘J. **Known risk to verify before shipping**: mac Chrome ⌘J is the Downloads accelerator but is believed `preventDefault`-interceptable (same class as the shipped ⌘D bookmark and ⌘[ back interceptions, not reserved like ⌘N/T/W). **Verification that interception actually suppresses Chrome's Downloads panel is required**; the recorded fallback if it fails is a one-field `macShellOnly: true` demotion (shell keeps ⌘J, mac browser reverts to the shifted ⇧⌘J default) plus a `browser`-owner claimed-keys row.
- **Win/Linux**: ⇧Ctrl+J. This shadows Chrome's DevTools-console accelerator there — acceptable: Ctrl+Shift+J is `preventDefault`-interceptable (pages can and do block it), and DevTools stays reachable via F12/⇧Ctrl+I. Surface this in the intake-level analysis; no claimed-keys entry needed (interceptable ≠ reserved).
- **Handler** (`app.tsx`): gated like `panel-toggle` was — desktop window route (`windowParam && !isMobile`) with the `code` surface available (`panelSurfaces.includes("code")`) — calling `togglePanel("code")` (→ `addSurface`/`closeSurface` → `applyLayout`). When the window has no code lens (no git root), the handler is absent and the chord falls through untouched per the dispatcher's fall-through rule.
- **Terminal seam**: no new rule — rule 1 covers ⇧Ctrl+J, rule 2 covers ⌘J.
- **Code-iframe reclaim**: `hasReclaimableMatch` already reclaims any non-`ttyOnly` match, so ⌘J pressed inside the code editor closes the tile — correct toggle symmetry, no reclaim change needed.
- Palette parity: the code surface's `Layout: Add Code` / `Layout: Close Code` entries carry the `code-toggle` hint (the retiring `toggleShortcut` seam retargeted, or `withShortcutHints` if the id join is made direct).

### 4. Add a tty↔code focus-hop on the Backquote keycap

New registry row — VS Code's ⌃` gesture transposed to run-kit's inverted primary/secondary relationship:

```ts
{ actionId: "focus-hop", code: "Backquote", tier: "shifted", macTier: "ctrl", scope: "terminal", kind: "builtin", label: "Focus terminal ↔ code", description: "hop focus between the tty and code tiles" }
```

- **macOS, BOTH hosts**: ⌃` — the registry's `ctrl` tier, currently empty of shipped defaults; **this is the first**, so tests asserting the ctrl tier ships empty (the synthetic-ctrl-row scaffolding in `keybindings.test.ts` ~lines 500–597) need review. No mac claim exists on `Backquote` in any tier.
- **Win/Linux**: ⇧Ctrl+` (plain Ctrl belongs to the pane by hard policy there; matching on `e.code` makes `Backquote` expressible).
- **Semantics**: hop focus between the tty tile and the code tile, composing with per-window focus memory (`docs/memory/run-kit/ui/focus-ownership.md`). Handler in `app.tsx`, desktop-only (the `Layout: Focus <Surface>` precedent — mobile's switcher is the sheet tabs): if `focusedTileKind === "code"` focus tty, else focus code, routed through the `layoutFocusTileRef` seam. Hopping TO code does **not** write focus memory (the recording asymmetry: only in-frame `onInteract` records `code`) — consistent with the steal-guard design; hopping to tty records via the palette focus seam (`recordTtySlot`) as `Layout: Focus` already does. When the window has no code lens the handler is absent → fall-through.
- **Terminal seam — the one new mechanism**: `shouldRefuseTerminalChord` currently transmits plain-Ctrl chords to the pane on every platform. Add a **third refusal rule — mac-only, enabled ctrl-tier match pressed with `ctrlKey`** — which steals NUL (the byte Ctrl+` encodes to) from the pane; near-zero cost, VS Code makes the same trade. The rule must NOT loosen rules 1–2: Win/Linux stays byte-identical (no ctrl-tier defaults resolve there — the base tier is shifted), and mac plain-Ctrl chords other than enabled ctrl-tier matches still pass through (Ctrl+[ is ESC).
- **Code-iframe reclaim**: ⌃` inside the code editor is reclaimed (non-`ttyOnly` match) and re-dispatched to the parent — deliberately preempting code-server's own ⌃` integrated-terminal toggle; the hop back to tty wins over the embedded app's binding, matching the reclaim seam's design.
- **Overlay**: the chord surfaces in the grouped TERMINAL rows and palette hints (`formatCombo` keeps the `` Ctrl+` `` spelling; the ctrl tier has no keycap-map layer — the ⇧⌘/⌘ picker is untouched).

### 5. Tier-policy constraint (not a task)

Do NOT force all UI toggles onto the shifted tier. Keep the existing consistency axis — letter constant everywhere, modifier per platform, mac demotes to ⌘ wherever the browser permits; frequency drives tier. This is a constraint on the implementation and on the memory-file framing, not an implementation item.

### 6. Reserve ⇧⌘P unbound (not a task)

⇧⌘P stays unbound, reserved for a future create/open-PR action (Conductor convention) — a do-not-spend constraint. Record it (e.g., a registry comment) so a later change doesn't spend the keycap.

### Test & docs surface

- `keybindings.test.ts`: new defaults, ctrl-tier first-shipped-default fallout, refusal-rule 3 units (mac ctrl-tier refusal, Win/Linux byte-identical, plain-Ctrl passthrough), conflict-free invariant re-run across hosts, claimed-keys non-collision.
- e2e `shortcut-registry.spec.ts` + `.spec.md` (constitution Test Companion Docs, same commit): ⇧Ctrl+B sidebar toggle, ⇧Ctrl+J code toggle, ⇧Ctrl+` hop on Linux; mac block additions for ⌘B/⌘J/⌃` where expressible (deep mac paths stay unit territory — e2e runs on Linux). `right-panel.spec.ts` ⇧Ctrl+. cases retire/retarget.
- ⌘J-in-mac-Chrome verification is a manual/documented gate before ship (item 3).
- Hydrate touches the four memory files listed below.

## Affected Memory

- `run-kit/ui/keyboard-and-palette`: (modify) default-binding table (B/J/backtick rows, panel-toggle removal), tier table (`ctrl` tier no longer empty of shipped defaults), terminal-seam third refusal rule, ⇧⌘P reservation, e2e section.
- `run-kit/ui/lenses-and-layout`: (modify) `panel-toggle` references (§ Surface Toggles chord, `buildLayoutActions` hint seam, Design Decisions entry) replaced by `code-toggle`.
- `run-kit/ui/boards`: (modify) the `Layout: Add/Close <Surface>` palette-table cell citing the ⇧⌘. chord.
- `run-kit/ui/focus-ownership`: (modify) the focus-hop gesture as a new consumer of focus memory / the focus-by-kind seam.

## Impact

- `app/frontend/src/lib/keybindings.ts` — binding rows, refusal rule 3, ⇧⌘P comment (+ `keybindings.test.ts`).
- `app/frontend/src/app.tsx` — handler map (`code-toggle`, `focus-hop`, remove `panel-toggle`), layout-palette hint plumbing.
- `app/frontend/src/components/shell/shell.tsx` — `useSidebarKeyboardToggle` comments only (logic is registry-driven).
- `app/frontend/src/lib/palette-layout.ts` (+ test) — `toggleTarget`/`toggleShortcut` retarget or removal.
- `app/frontend/src/components/code-surface.tsx` / `surface-layout.tsx` — expected no logic change (reclaim + focus seams are data-driven); verify.
- e2e: `tests/e2e/shortcut-registry.spec.ts` + `.spec.md`, `tests/e2e/right-panel.spec.ts` + `.spec.md`.
- Docs: the four memory files above.
- No backend, no API, no routes (Constitution IV untouched); overrides schema untouched (diffs-only, per-device).

## Open Questions

- When the code tile is **closed** (code lens available, tile not in the layout), does the focus-hop open-then-focus it (VS Code's ⌃` opens the hidden panel) or no-op? Deferred to the user — see Assumptions row 15.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `sidebar-toggle` moves to `KeyB`: ⌘B on macOS in both hosts (`macTier: "cmd"`, no `macShellOnly`), ⇧Ctrl+B on Win/Linux; plain Ctrl+B stays with the pane | Discussed — user locked; mirrors the shipped ⌘[/⌘]/⌘/ demotion pattern; KeyB free in every claim set | S:95 R:85 A:90 D:90 |
| 2 | Certain | `panel-toggle` (⇧⌘./⇧Ctrl+.) is retired entirely — binding and action; web-tile toggling stays palette/top-bar reachable | Discussed — user's explicit judgment (chat panel not ready); Constitution V satisfied via palette | S:95 R:80 A:90 D:90 |
| 3 | Certain | New `code-toggle` on `KeyJ`: ⌘J macOS both hosts, ⇧Ctrl+J Win/Linux, `scope: "terminal"`, toggles the code surface tile via `togglePanel("code")` | Discussed — user locked chord and semantics (VS Code ⌘J panel analog) | S:95 R:80 A:85 D:85 |
| 4 | Certain | New focus-hop on `Backquote`: ⌃` macOS (ctrl tier — first shipped default), ⇧Ctrl+` Win/Linux; third terminal-seam refusal rule, mac-only enabled-ctrl-tier match, stealing NUL from the pane | Discussed — user locked, including the seam mechanism and the NUL trade (VS Code makes the same trade) | S:90 R:75 A:85 D:85 |
| 5 | Certain | Tier policy: no forced shifted-tier-for-toggles; letter constant, modifier per platform, frequency drives tier; strict ⇧⌘ rule rejected | Discussed — explicit constraint with recorded rejected alternative | S:90 R:90 A:85 D:90 |
| 6 | Certain | ⇧⌘P stays unbound (reserved for future PR action); ⇧⌘E `compose-toggle` does not move | Discussed — explicit do-not-spend / do-not-move constraints | S:95 R:90 A:90 D:95 |
| 7 | Certain | Freeing ⌘\ to become a mac split alias is OUT of scope (non-goal) | Discussed — user leaned "later, not now"; concur (keeps the change purely realignment) | S:80 R:90 A:80 D:80 |
| 8 | Confident | actionIds: `code-toggle` (named in discussion) and `focus-hop` for the Backquote gesture; mapLabels `sidebar`/`code` | Registry kebab verb-noun convention; a pre-ship rename is trivial | S:60 R:95 A:75 D:60 |
| 9 | Confident | mac Chrome ⌘J Downloads is `preventDefault`-suppressible; a pre-ship verification gate is part of the change, with `macShellOnly` demotion (+ browser claim row) as the recorded fallback | Discussed — user flagged the risk and required verification; same accelerator class as shipped ⌘D/⌘[ interceptions; fallback is a one-field data change | S:70 R:80 A:55 D:70 |
| 10 | Confident | Win/Linux ⇧Ctrl+J shadowing Chrome's DevTools-console accelerator is acceptable (interceptable, not reserved; DevTools stays on F12/⇧Ctrl+I) | Agent-surfaced (not in discussion): pages can block Ctrl+Shift+J; consistent with the registry's interceptable-vs-reserved distinction | S:50 R:75 A:65 D:60 |
| 11 | Confident | With no code lens available on the window, `code-toggle` and the focus-hop handlers are absent and the chords fall through untouched | The dispatcher's established fall-through rule (`panel-toggle`/split precedent) answers this decisively | S:50 R:80 A:85 D:65 |
| 12 | Confident | No override migration: orphaned `panel-toggle` diffs stay inert in localStorage; ⌘\ users rebind via the override layer | Tolerant-parse posture makes orphans harmless; the rebind path is user-accepted in discussion | S:60 R:85 A:80 D:70 |
| 13 | Confident | ⌃`/⌘J inside the code iframe are reclaimed (non-`ttyOnly` matches), preempting code-server's own ⌃` integrated-terminal toggle | Existing reclaim-seam semantics (`hasReclaimableMatch`) produce this with zero code change; the preemption is the seam's documented design | S:55 R:70 A:75 D:65 |
| 14 | Confident | Hop-to-code focuses the tile via the `layoutFocusTileRef` seam, desktop-only, WITHOUT writing `code` into focus memory | The recording asymmetry (only in-frame `onInteract` records `code`) is load-bearing steal-guard design; the `Layout: Focus <Surface>` precedent is desktop-only | S:55 R:70 A:80 D:70 |
| 15 | Unresolved | Focus-hop behavior when the code tile is CLOSED: open-then-focus (VS Code's ⌃` opens the hidden panel) vs no-op | Deferred — promptless dispatch | S:40 R:65 A:45 D:35 |

15 assumptions (7 certain, 7 confident, 0 tentative, 1 unresolved).

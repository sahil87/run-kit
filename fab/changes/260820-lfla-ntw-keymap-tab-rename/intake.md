# Intake: N/T/W Keymap Realignment + "Tab" Copy Sweep

**Change**: 260820-lfla-ntw-keymap-tab-rename
**Created**: 2026-08-21

## Origin

Queued draft created via `/fab-draft` (promptless dispatch — no questions asked; would-be questions recorded as deferred Unresolved rows, of which there are none). Synthesized from a design discussion with the user; **user-decided points are FINAL**.

> **Feature: N/T/W keymap realignment + "tab" copy sweep** (mac desktop shell). Align run-kit with the universal macOS convention (⌘N = window, ⌘T = tab in Chrome/Safari/iTerm/JetBrains): ⌘T = new tab (tmux window), ⇧⌘T = new session, ⌘N = new APP window, ⌘W = close tab (unchanged), ⇧⌘W = close APP window — plus a user-approved rename of tmux "window" to "tab" in all user-facing copy, and a ⌘` `owner: "system"` claim row.

**DEPENDENCY (prominent, load-bearing)**: this change DEPENDS ON the desktop multi-window change (slug `desktop-multi-window`, created alongside this draft as a sibling queued draft; not yet present in `fab/changes/` at intake time) — specifically its **`shell:new-window` bridge channel**, which the repointed ⌘N action calls. This draft deliberately stays unactivated; it must not enter apply until that bridge channel exists (merged to main, or this branch is stacked on it).

## Why

1. **The pain point**: run-kit currently inverts the universal macOS muscle memory. In every mac app with a tab model (Chrome, Safari, iTerm2, JetBrains), ⌘N makes a new *window* and ⌘T makes a new *tab*. run-kit's mac shell binds ⌘N to `create-session` (keybindings.ts:176) — a session is not a window in the OS sense — and once the desktop shell gains real multi-window support (the `desktop-multi-window` prerequisite), there is no key for "new app window" at all while ⌘N is spent on the wrong thing.
2. **The consequence of not fixing it**: the multi-window feature ships reachable only by menu mouse-click, ⌘N keeps violating platform convention, and the vocabulary problem compounds — "window" would then mean two unrelated things (tmux window and app window) in shortcut labels, palette entries, and menus, with no way for copy to disambiguate.
3. **Why this approach**: the scheme generalizes cleanly — *unshifted = tab/tmux level, shifted = the bigger variant* (⌘T tab / ⇧⌘T session; ⌘W tab / ⇧⌘W app window). Sessions are created far less often than tabs/windows, so the shifted variant is frequency-correct. And renaming tmux windows to "tab" in user-facing copy (user-approved) resolves the two-meanings collision at the vocabulary level: "tab" for tmux windows, "window" for app windows. `create-window`'s own description already says "tab-analog" — the copy sweep makes the existing naming honest.

## What Changes

All binding changes are **data in the declarative registry** `app/frontend/src/lib/keybindings.ts` (DEFAULT_BINDINGS rows + claimed-keys maps), riding the existing `macTier`/`macCode`/`macShellOnly`/`defaultComboFor` machinery — no new resolver mechanics. Current rows being touched (keybindings.ts:176–178):

```ts
{ actionId: "create-session", code: "KeyN", tier: "shifted", macTier: "cmd", macShellOnly: true, ... label: "New session" }
{ actionId: "create-window",  code: "KeyT", tier: "shifted", macTier: "cmd", macShellOnly: true, ... label: "New window", description: "tab-analog in current session" }
{ actionId: "kill-window",    code: "KeyW", tier: "shifted", macTier: "cmd", macShellOnly: true, ... label: "Close window", description: "confirm flow" }
```

### 1. ⌘T = new tab (tmux window) — zero binding change

`create-window` already resolves to ⌘T in the mac shell. No combo change anywhere. The naming is made honest by the copy sweep (§6): label `New window` → `New tab`.

### 2. ⇧⌘T = new session

`create-session` moves from ⌘N (mac shell) to **⇧⌘T in-shell**. Win/Linux keeps ⇧Ctrl+N unchanged. In a mac **browser** ⇧⌘T is reserved (reopen-closed-tab — the existing `shifted`-tier `KeyT` browser claim, `label: "reopen tab"`), so the binding resolves disabled there — **the SAME availability story ⌘N-as-new-session has today** (⌘N is browser-reserved too); the palette covers the browser case, exactly as now. Likely data shape (plan decides the exact encoding): keep base `code: "KeyN", tier: "shifted"` for Win/Linux and refine mac via `macCode: "KeyT"` (staying on the shifted tier), reusing the split-pair `macCode` precedent — this puts `create-session` (⇧⌘T) and `create-window` (⌘T) tier-disjoint on one code, the exact shape the mac split pair (⌘D/⇧⌘D on `KeyD`) already ships, so `findConflicts` stays clean.

### 3. ⌘N = new APP window — an SPA binding, never a shell accelerator

A **new registry action** (e.g. `new-app-window`; plan picks the actionId/label) whose handler calls the `desktop-multi-window` change's **`shell:new-window` bridge channel**. The freed in-shell ⌘N default repoints to it.

- The shell's inviolable rule — **never bind the unshifted ⌘ tier as a menu accelerator** (`app/desktop/src/menu.ts` header: "the unshifted ⌘ tier is inviolable"; guaranteed fall-through set includes ⌘N) — is **untouched**. The shell menu's New Window item stays accelerator-less (the existing "Close Window" pattern, menu.ts:376–380; the menu item itself belongs to the prerequisite change).
- Implementing it as an SPA binding keeps New Window **rebindable**, present in the **shortcuts overlay**, and **palette-reachable**.
- Outside the shell the action resolves disabled (⌘N is browser-reserved — the existing `MAC_BROWSER_CMD_CLAIMS` "new window" row). On Win/Linux it is unbound (§5). Likely encoding: a keyless base (`code: ""` — the macro keyless-default precedent resolves it unbound) plus mac-shell refinement, or a mac claim-covered base; plan decides.

### 4. ⌘W = close tab (unchanged); ⇧⌘W = close APP window

`kill-window` (⌘W in-shell, keybindings.ts:178) is **unchanged** as a binding; its copy becomes `Close tab` (§6). A **new ⇧⌘W in-shell action** closes the app window via a bridge channel — **`shell:close-window` or the existing close seam; the plan decides which**. The mac Window menu's "Close Window" item is deliberately accelerator-less today and **stays so**. In a mac browser ⇧⌘W is reserved (the existing shifted `KeyW` "close window" browser claim) → resolves disabled. On Win/Linux the action is unbound (⇧Ctrl+W is `kill-window` there). This extends the scheme: unshifted = tab/tmux level, shifted = the bigger variant.

### 5. Mac-only by necessity

On Win/Linux plain Ctrl belongs to the terminal pane (Ctrl+N readline next-history, Ctrl+T transpose-chars), so Win/Linux keeps ⇧Ctrl+N/T/W exactly as-is and New Window stays menu-only there (the menu item is the prerequisite change's). The asymmetry rides the established `macTier` promotion pattern (260730-n789).

### 6. "Window" now means two things — rename tmux windows to "tab" in user-facing copy (user-approved)

Shortcut labels, palette entries, cheatsheet/overlay labels, and menu labels say **"tab"** (`New tab`, `Close tab`, `Previous tab`/`Next tab`, the `▾` switcher's `+ New Window` → `+ New tab`, kill-confirm copy, etc.). **"window" stays in tmux-facing internals** — actionIds (`create-window`, `kill-window`, `window-prev`, `window-next`), the tmux layer, and the API are all untouched.

This is an **explicit copy-sweep task, not a drive-by**: it touches the palette (including `Window:`-prefixed entry labels tied to tmux windows), the cheatsheet/shortcuts overlay (labels + `mapLabel`s like `new window`/`close win`/`prev win`/`next win`), and any menu labels (e.g. the top-bar chevron menu's Window-section rows). The sweep greps for user-facing "window" strings tied to **tmux** windows and **adjudicates each** — strings denoting the app window, the OS window, or tmux internals keep "window". (Grep caveat: `session-tiles.tsx` is NUL-poisoned for plain grep — use `grep -a` or perl, per project memory.)

### 7. ⌘` system claim

Register macOS "Move focus to next window" (⌘`) as an **`owner: "system"` claim row** in the registry's claimed-keys map — the ⇧⌘3/4/5 `MAC_SCREENSHOT_CLAIMS` precedent (`platform: "mac"`, applies in both hosts) — so rebind capture warns. No collision exists: the SPA's `focus-hop` is Ctrl+` on mac (`ctrl` tier), disjoint from ⌘` (`cmd` tier `Backquote`).

### Constraints

- Browser-reservation demotions ride the existing `defaultComboFor`/`macShellOnly` machinery — no new resolution seams.
- The hand-maintained claim mirrors (`claimedKeys`, `MAC_SHELL_CMD_CLAIMS`) MUST be updated in the same change wherever affected (the desktop-shell memory rule).
- `keybindings.test.ts` palette-parity invariant and claim tests are **updated, never deleted** (conflict-free-defaults invariant must keep passing on every host map).
- The zen-toggle ⇧⌘⏎ binding and the compose-Enter classifier (260820-ecl4) are **untouched**.
- Memory doc `docs/memory/run-kit/ui/keyboard-and-palette.md` (per-key table, per-platform tier sections, claimed-keys section) is updated at hydrate.

### Out of scope

- The multi-window shell mechanics themselves (the `desktop-multi-window` prerequisite change owns the bridge channels' shell side, the menu items, and window lifecycle).
- Win/Linux New Window accelerator (stays menu-only there).
- Any tmux-layer or backend renaming (window → tab is user-facing copy only).

## Affected Memory

- `run-kit/ui/keyboard-and-palette`: (modify) default-binding table rows for create-session/create-window/kill-window, the two new app-window actions, per-platform tier sections, claimed-keys section (⌘` system claim), label copy → "tab"
- `run-kit/desktop-shell`: (modify) keyboard-tier menu seam commentary — which page chords now ride the shell's guaranteed fall-through set (⌘N repointed, ⇧⌘T/⇧⌘W newly spent by the page); accelerator-less New Window/Close Window pattern references
- `run-kit/ui/top-bar`: (modify) chevron-menu Window-section row labels and window-switcher `+ New Window` copy renamed to "tab"

## Impact

- `app/frontend/src/lib/keybindings.ts` — DEFAULT_BINDINGS rows 176–178 reshaped, two new action rows, one new system claim row; `app/frontend/src/lib/keybindings.test.ts` updated.
- `app/frontend/src/app.tsx` (dispatcher handler map) — handlers for the two new actions calling the desktop bridge channels; feature-detection/no-handler fall-through outside the shell.
- Copy sweep across palette action labels, shortcuts-panel labels/`mapLabel`s, top-bar chevron menu rows, window-switcher entries, kill-window confirm copy — user-facing strings only.
- Preload/bridge consumption of `shell:new-window` (+ close channel) — SPA side only; the shell side belongs to `desktop-multi-window`.
- Tests: unit (registry invariants, resolution per host), e2e where labels are asserted (spec + sibling `.spec.md` updated together per constitution).
- **Sequencing**: blocked on `desktop-multi-window`'s bridge channel; this draft stays unactivated until it lands.

## Open Questions

None — the scheme was decided in discussion (user-decided points are final); the delegated details (close-window channel, exact registry data encoding, per-string copy adjudication) are recorded as graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | ⌘T = new tab (tmux window): `create-window` binding unchanged; naming made honest by the copy sweep | User-decided (final); zero binding change — the row's own description already says "tab-analog" | S:95 R:95 A:95 D:95 |
| 2 | Certain | `create-session` moves ⌘N → ⇧⌘T in the mac shell; mac browser resolves it reserved (reopen-closed-tab) → palette-only, the same availability story ⌘N has today; Win/Linux keeps ⇧Ctrl+N | User-decided (final); frequency-correct (sessions rarer than tabs) and precedented by existing shifted-KeyT browser claim | S:90 R:85 A:85 D:90 |
| 3 | Certain | ⌘N = new APP window as an SPA registry binding calling `shell:new-window` — never a shell accelerator; the shell's inviolable unshifted-⌘ rule and the accelerator-less menu-item pattern are untouched; rebindable, overlay-listed, palette-reachable | User-decided (final); matches menu.ts's documented fall-through design | S:90 R:80 A:85 D:90 |
| 4 | Certain | ⌘W (`kill-window`) unchanged; new ⇧⌘W in-shell action closes the app window via a bridge channel; Window-menu Close Window stays accelerator-less | User-decided (final); extends unshifted=tab / shifted=bigger-variant scheme | S:90 R:80 A:85 D:90 |
| 5 | Certain | Mac-only: Win/Linux keeps ⇧Ctrl+N/T/W as-is, New Window menu-only there | User-decided (final); plain Ctrl belongs to the pane on Win/Linux — the established macTier asymmetry | S:90 R:85 A:90 D:90 |
| 6 | Certain | Rename tmux "window" → "tab" in user-facing copy (labels, palette, cheatsheet, menus) as an explicit sweep task; actionIds/tmux layer/API keep "window" | User-approved (final); explicit sweep-and-adjudicate instruction from discussion | S:85 R:80 A:85 D:85 |
| 7 | Certain | Register ⌘` (macOS Move-focus-to-next-window) as an `owner: "system"` claim row, mac platform, both hosts | User-decided (final); MAC_SCREENSHOT_CLAIMS precedent; no collision — focus-hop is ctrl-tier Backquote | S:90 R:95 A:90 D:90 |
| 8 | Confident | Close-app-window bridge channel: `shell:close-window` vs the existing close seam — the plan decides | User explicitly delegated to plan; trivially reversible pre-ship; bridge patterns visible in codebase | S:55 R:85 A:75 D:60 |
| 9 | Confident | Exact registry data encoding — create-session via `macCode: "KeyT"` (shifted tier, split-pair precedent); new mac-shell-only actions likely keyless base + mac refinement (macro keyless-default precedent) — plan decides | Existing machinery (`defaultComboFor`, keyless resolution) covers every shape; data-only, easily revised | S:60 R:85 A:80 D:65 |
| 10 | Confident | Copy-sweep scope = every user-facing string where "window" denotes a tmux window (incl. `Window:` palette prefixes, `+ New Window`, prev/next labels, mapLabels, confirm copy); per-string adjudication happens at apply (decide-and-record) | User instructed grep-and-adjudicate-each; app/OS-window strings and internals keep "window" | S:70 R:90 A:75 D:70 |
| 11 | Confident | Sequencing: stays a queued unactivated draft; enters apply only once `desktop-multi-window`'s `shell:new-window` bridge exists (merged, or this branch stacked on it) | Dependency stated as final in discussion; queued-draft posture is the dispatch design; waiting is the obvious default | S:75 R:90 A:70 D:70 |
| 12 | Confident | On a shell build lacking the bridge channel (older shell), the new actions degrade gracefully (feature-detect → handler absent/no-op), mirroring the outside-shell disabled posture | Inferred — consistent with dispatcher no-handler fall-through rule and shell-strip no-handler precedent | S:50 R:85 A:70 D:60 |
| 13 | Confident | The "tab" copy applies on ALL platforms (Win/Linux labels say `New tab` on ⇧Ctrl+T too) — the rename is copy-level, not mac-gated; only the keymap changes are mac-only | Vocabulary collision is platform-independent; per-platform copy forks would be worse; consistent with letters-constant convention | S:65 R:90 A:80 D:70 |
| 14 | Certain | Claim mirrors (`claimedKeys`, `MAC_SHELL_CMD_CLAIMS`) updated in the same change where affected; `keybindings.test.ts` invariants updated never deleted; zen-toggle ⇧⌘⏎ and the compose-Enter classifier untouched | User-stated constraints (final); matches the desktop-shell hand-maintained-mirror memory rule | S:90 R:85 A:90 D:90 |

14 assumptions (8 certain, 6 confident, 0 tentative, 0 unresolved).

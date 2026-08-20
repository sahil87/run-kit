# Intake: Host Menu Shortcut + Digit Select

**Change**: 260820-nv0o-host-menu-shortcut-digit-select
**Created**: 2026-08-20

## Origin

Conversational (`/fab-discuss` session on the desktop-shell host switcher UX). User raised two issues against the titlebar-strip hosts menu:

> Issue 3: on the first line, the edit and delete icons are visible even without a hover. These should be visible only on a hover.
> Issue 4: The shortcut is tough to reach. Do an analysis if Shift+Cmd+Number is available for these shortcuts (as opposed to Cmd+Alt)

The ⇧⌘digit analysis concluded it is unavailable (⇧⌘3/4/5 are macOS system screenshot claims — `menu.ts:26-29` records the actual failure; the layer is also reserved for future positional tile jumps, `keybindings.ts:170-172`). The agreed replacement: a single easy chord that **opens** the hosts menu, with plain digits selecting a host while it is open. User explored shell-side bindings (⌘P, ⌘H, ⌘E, a menu accelerator) and, after discussion of the keystroke path (Electron is veto-not-relay; menu accelerators confiscate keys and create version-skew dead keys), approved: **SPA-registry binding on ⇧⌘M**, shell accelerators untouched.

## Why

1. **Pain point**: switching hosts by keyboard requires ⌥⌘1–9 — an awkward two-modifier stretch — and the mouse path needs a small click target. Separately, the menu's row action cluster (edit/remove/grip) is visible on the focused row even when the menu was opened by mouse, reading as visual noise (the active row receives programmatic focus on open, and the cluster reveals on `group-focus-within`).
2. **If unfixed**: host switching — a core multi-host workflow — stays keyboard-hostile for the common case, and the menu looks broken-by-default on open.
3. **Approach**: `⇧⌘M, <digit>` is two easy chords instead of one contorted one. Binding in the SPA registry (not a shell accelerator) ships on server-deploy cadence, is rebindable, appears in the cheatsheet/palette, and avoids the shell-accelerator failure mode (old SPA + new shell = swallowed dead key). ⌥⌘1–9 direct switching is untouched.

## What Changes

### 1. New SPA keybinding `host-menu-open` (⇧⌘M / ⇧Ctrl+M)

In `app/frontend/src/lib/keybindings.ts` `DEFAULT_BINDINGS`, add:

- `actionId: "host-menu-open"`, `code: "KeyM"`, `tier: "shifted"`, `scope: "global"`, `kind: "builtin"`, label like `"Host switcher"`, description like `"open the hosts menu"`, mapLabel `"hosts"`.
- No `macTier` demotion (⌘M is the shell's minimize claim — `MAC_SHELL_CMD_CLAIMS`), no `macCode`. ⇧⌘M mac / ⇧Ctrl+M win-linux. `KeyM` is verified free on the shifted tier in every claim set (shell, browser, system, win/linux).
- Handler mounts only where the shell titlebar strip renders (`ShellTitlebarStrip`) — the existing handler-presence gating pattern. In a browser host or on non-shell surfaces the binding resolves to no handler (palette/cheatsheet presentation follows the existing pattern for handler-gated actions).
- Handler behavior: open the strip's host dropdown (`setOpen(true)` + the existing open-time focus placement on the active row). If already open, close (toggle), matching the stateful-chord family convention.

### 2. Digit-select while the menu is open

In `app/frontend/src/components/shell-titlebar-strip.tsx`, extend the open-menu keydown handling (the existing roving-focus block around lines 425–507): plain digits `1`–`9` (no modifiers) select the corresponding host row — same order as the rendered list, which IS the ⌥⌘1–9 accelerator order — and trigger the same switch path as click/Enter (`switchToHost` seam). Digit N beyond the row count is a no-op. This must not fire while the Edit dialog or remove confirm is open (the existing `dialogOpen` guard).

### 3. Action cluster reveals on hover + keyboard focus only (issue 3 fix)

In `shell-titlebar-strip.tsx` (~line 695), the cluster currently uses `invisible … group-hover:visible group-focus-within:visible`. Programmatic focus on menu open makes the active row show pencil/minus/grip at rest. Replace `group-focus-within:visible` with a `:focus-visible`-based reveal (`group-has-[:focus-visible]:visible`, Tailwind 4 `has` variant) so:

- Mouse-opened menu: no cluster on the focused row (programmatic focus after pointer interaction does not match `:focus-visible` in Chromium).
- Keyboard navigation (arrows/Tab): cluster reveals on the focused row — Delete/F2/⌥↑↓ affordances stay discoverable.
- Tabbing into the cluster's own buttons keeps it visible (`has` covers descendants).
- The mirrored `group-hover:invisible group-focus-within:invisible` classes on the ⌥⌘n hint zone (lines ~668, ~682) must be updated in lockstep so the hint yields the zone under exactly the same conditions the cluster shows.

### 4. Palette registration

Register the action in the command palette (project review rule: new keyboard shortcuts must be documented in the palette registration) — e.g. `Host: Switcher` opening the same dropdown.

### Non-goals

- No shell/Electron changes at all — no menu accelerator, no IPC. ⌥⌘1–9 and the native Hosts menu are untouched.
- No welcome-page handling (that page has no strip; covered by change 260820-sywl-welcome-host-hub).

## Affected Memory

- `run-kit/ui/keyboard-and-palette`: (modify) new `host-menu-open` shifted-tier binding, its handler-presence gating, digit-select-while-open behavior
- `run-kit/ui/top-bar`: (modify) host switcher menu — digit selection, cluster reveal semantics (hover + focus-visible, not focus-within)

## Impact

- `app/frontend/src/lib/keybindings.ts` — one binding entry (+ its unit tests / conflict checks)
- `app/frontend/src/components/shell-titlebar-strip.tsx` — open handler wiring, digit-select in the menu keydown block, cluster visibility classes (+ `shell-titlebar-strip.test.tsx`)
- Palette registry — one action
- No backend, no desktop-shell changes

## Open Questions

- (none — chord, tier, ownership, and reveal semantics were all decided in the discussion)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Chord is ⇧⌘M (mac) / ⇧Ctrl+M (win-linux), code `KeyM`, shifted tier, no mac demotion | Discussed — user approved ⇧⌘M explicitly; KeyM verified free in every claim set; rebindable later so low stakes | S:95 R:90 A:95 D:90 |
| 2 | Certain | SPA-registry binding, NOT a shell menu accelerator | Discussed at length — user initially pushed shell-side; corrected on keystroke mechanics (veto-not-relay) and accepted SPA ownership | S:95 R:75 A:90 D:90 |
| 3 | Certain | Digits 1–9 select hosts while the menu is open, in rendered-list order (= ⌥⌘n order) | Discussed — explicit part of the accepted design ("⇧⌘M, 3") | S:90 R:90 A:90 D:85 |
| 4 | Confident | ⇧⌘M toggles (closes an already-open menu) | Matches the stateful-chord family convention (⌘B/⌘I); not explicitly discussed | S:60 R:90 A:85 D:75 |
| 5 | Confident | Cluster reveal via `group-has-[:focus-visible]:visible`, replacing `group-focus-within:visible`; hint-zone mirror classes updated in lockstep | Mechanism verified in code; exact Tailwind variant is implementation's choice, easily adjusted | S:80 R:85 A:80 D:70 |
| 6 | Confident | Palette action registered for the new shortcut | Project review rule requires it | S:70 R:95 A:90 D:85 |

6 assumptions (3 certain, 3 confident, 0 tentative, 0 unresolved).

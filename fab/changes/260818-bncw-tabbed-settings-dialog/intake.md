# Intake: Tabbed Settings Dialog

**Change**: 260818-bncw-tabbed-settings-dialog
**Created**: 2026-08-18

## Origin

Synthesized from a `/fab-discuss` conversation, dispatched promptless (`/fab-proceed`-style create-intake, `{questioning-mode} = promptless-defer`). The user's decision, verbatim intent:

> **Feature: consolidate all settings surfaces into a single tabbed settings dialog (GitHub-settings-inspired layout, but as a dialog).** Three tabs (General / Appearance / Shortcuts); desktop left nav rail inside the dialog; the shortcuts overlay's standalone shell is retired and its body becomes the Shortcuts tab; both existing chords survive as deep-links into the one dialog; mobile (<480px) collapses the rail to a horizontal scrollable tab strip; the persistence-scope labeling (This host / This device) survives the topic reorganization inside each tab.

Key conversation outcomes captured below in § What Changes; alternatives rejected and constraints are recorded in § What Changes and § Assumptions. A visual mock was built and accepted in direction during the discussion (session-local scratchpad file `settings-tabs-mock.html`, **not in the repo** — its accepted direction is transcribed in words in § What Changes / Visual direction, which is the authoritative record).

## Why

1. **The pain point**: settings live on two divergent shells. `app/frontend/src/components/settings-dialog.tsx` (494 lines) is the intended consolidation surface — mounted once at `AppLayout`, on the shared `Dialog` at `size="lg"` (`max-w-2xl` ≈672px), organized by persistence scope (**This host** / **This device**) via `PreferenceRow` + `ScopeHeading`. But `app/frontend/src/components/shortcuts-overlay.tsx` (1159 lines) is the outlier: its own custom `fixed inset-0` overlay shell at `max-w-3xl`, NOT on the shared `Dialog`, holding the shortcuts table + rebinding UI. Two shells means two focus traps, two escape paths, two visual languages, and no single place a user opens for "settings".
2. **If we don't fix it**: every future preference deepens the fork — the flat two-scope dialog does not scale past its current six controls (adding more rows makes one undifferentiated scroll), and the shortcuts surface stays a parallel world with its own chrome. The consolidation cost only grows as both files grow.
3. **Why this approach**: a tabbed dialog (Slack/Linear/VS Code modal-with-sidebar idiom) scales by topic while staying a dialog — Constitution §IV explicitly keeps "no settings pages" (reaffirmed in the discussion), so a routed settings page is off the table. Folding the shortcuts overlay in as a tab removes the outlier shell instead of perpetuating it.

## What Changes

### 1. Three tabs, topic-organized

`SettingsDialog` gains a tabbed structure with exactly three tabs:

| Tab | Controls (all existing — moved, not rebuilt) |
|-----|-----------------------------------------------|
| **General** | Instance display name (`TextSetting` / `useInstanceName`), SSH host (`TextSetting` / `getSSHHost`+`setSSHHost`), Notifications (`NotificationsControl` / `usePushSubscription()`) |
| **Appearance** | Theme mode + preferred dark/light theme selects (`ThemePairControl` / `useTheme()`+`useThemeActions()`), instance accent color (`AccentColorControl` / `SwatchPopover` + `useInstanceAccent().setColor`), terminal font size (`TerminalFontControl` / `ChromeContext.terminalFontSize` stepper) |
| **Shortcuts** | The full shortcuts/rebinding body folded in from `shortcuts-overlay.tsx` (see § 3) |

### 2. Scope signal survives topic reorganization (key design tension, resolved in discussion)

Today's dialog organizes by persistence scope and that labeling is load-bearing UX ("my font didn't sync to my phone" reads as designed, not broken). The topic-organized tabs keep the existing `ScopeHeading` groups (uppercase scope name left, storage hint right-aligned, `border-b` rule) **within each tab**:

- **General** mixes scopes: display name + SSH host under **This host**; notifications under **This device**.
- **Appearance** mixes scopes: theme pair + accent under **This host**; terminal font size under **This device**.
- `PreferenceRow` (grid, 190px label column, `min-[480px]:` collapse to label-over-control) is retained unchanged as the row primitive.

### 3. Shortcuts overlay folded in; standalone shell retired

- `shortcuts-overlay.tsx`'s custom `fixed inset-0` shell (own backdrop, own focus trap, `max-w-3xl`) is **retired**. Its **body** — the registry-driven shortcuts surface: sticky jump-nav chips, filter input, foldable keycap map grid + modifier picker, platform display toggle, grouped GLOBAL/TERMINAL/BOARD rows with click-to-rebind capture, the shell-owned locked subgroup, the `[ CUSTOM ]` macro section + inline add flow, the read-only `[ TMUX ]` section, and the reset-all footer — becomes the **Shortcuts tab panel**, functionally intact (nothing dropped).
- The standalone `LayoutShortcutsOverlay` mount in `app.tsx` goes away; all three existing entry points re-route to the Shortcuts tab: the `shortcuts-overlay` chord, the `Help: Keyboard Shortcuts` palette action, and the chevron menu's "Keyboard shortcuts" App-section row (today via the `shortcuts-overlay:open` document CustomEvent listener in `app.tsx:314`).
- The per-open data plumbing the layout mount owns today (`riffPresetNames` best-effort fetch while open on a session route, `paletteTargets` gating of the add flow, the tmux keybindings fetch scoped to `useSessionContext().currentServer`) moves with the panel and keeps its gating semantics.

### 4. Desktop layout: left nav rail + fixed-height dialog

- Left nav rail inside the dialog (Slack/Linear/VS Code-style modal-with-sidebar): tab list on the left, active panel on the right.
- **New `Dialog` `size` variant** on `components/dialog.tsx` (currently `size?: "sm" | "lg"`, `max-w-sm`/`max-w-2xl`): a wider variant ~`max-w-4xl` for the tabbed settings dialog.
- **Fixed dialog height** so the rail doesn't jump between the short General tab and the tall Shortcuts tab; each tab panel scrolls internally (`overflow-y-auto` on the panel, not the dialog). The existing `Dialog` panel scroll path (`max-h-[calc(100vh-2rem)]` + backdrop `p-4`) remains the outer bound.

### 5. Keyboard-first wiring (Constitution V)

- `SettingsDialogContext` (`contexts/settings-dialog-context.tsx`, currently `{ isOpen, openSettings, closeSettings }`) gains a tab parameter: **`openSettings(tab?)`**. Tab-less calls (top-bar gear chip, `Settings: Open` palette action) land on General.
- The existing **`settings-open` chord** (⌘, in the macOS shell / ⇧⌘, in a mac browser / ⇧Ctrl+, on Win/Linux) deep-links to **General**; the existing **`shortcuts-overlay` chord** (⌘/ on mac hosts / ⇧Ctrl+/ on Win/Linux; the discussion referred to it as the "`?`" chord — the registry binding is authoritative) deep-links to **Shortcuts**. Both chords survive with their registry identities; they just deep-link into the one dialog.
- **Command palette gains per-tab actions** (e.g. `Settings: Appearance`, `Settings: Shortcuts`) in the layout-level global groups (`use-global-palette-actions.ts`), decorated by `withShortcutHints` where a registry id matches (palette id doubles as registry actionId, so `settings-open` and `shortcuts-overlay` keep their hint joins).
- **Roving tablist semantics**: the tab list itself gets arrow-key navigation (proper `role="tablist"`/`role="tab"` with roving tabindex).
- **Both route shells wire the handlers** per the existing pattern: `keybindingHandlers` in `app.tsx` and `boardKeyHandlers` in `app/frontend/src/components/board/board-page.tsx` (both already handle `settings-open`; the board shell must gain/keep a `shortcuts-overlay` handler pointing at the new deep-link).

### 6. Mobile (<480px — the dialog's existing single breakpoint)

- The left rail collapses to a **horizontal scrollable tab strip under the dialog title** — the SAME tablist markup restyled at the one `min-[480px]:` breakpoint, preserving the dialog's "one responsive code path, no mobile fork" philosophy.
- Rows keep the existing 480px label-over-control collapse.
- **REJECTED in discussion**: drill-down navigation (GitHub-mobile/iOS-Settings category-list-then-push) — two navigation levels inside a modal plus a forked mobile code path, overkill at three tabs; revisit only if tab count grows past ~5–6.

### 7. Second-surface rule preserved

The top-bar `ThemeSelector` modal stays as the live-preview surface (unchanged, per the existing "Dialog theme controls are self-contained" decision). The dialog's Appearance tab reuses existing control models — `useTheme()`/`useThemeActions()`, `SwatchPopover` accent, `ChromeContext.terminalFontSize` stepper, `usePushSubscription()` — never rebuilding them.

### Visual direction (from the accepted mock)

Left rail with accent-tinted active tab state and nav-footer chord hints; mobile 375px frame with the horizontal tab strip; Shortcuts tab with grouped rows, filter input, kbd chips, hover rebind affordance, and a `custom` badge for device-local overrides (the overlay's existing modified/custom keycap vocabulary). Exact widths/heights are apply-time tuning within this direction.

## Affected Memory

- `run-kit/ui/dialogs-and-state`: (modify) § Settings Dialog rewrites for the tabbed structure (three tabs, scope groups within tabs, `openSettings(tab?)`, fixed height + internal panel scroll); § Dialog width variant gains the new `size` value; the "Settings dialog mounts at `AppLayout`" design decision is unchanged but its trigger list grows per-tab entries.
- `run-kit/ui/keyboard-and-palette`: (modify) § Shortcuts overlay is re-anchored as the Shortcuts tab (single-mount story moves from `LayoutShortcutsOverlay` to the settings dialog; entry points re-routed; `shortcuts-overlay:open` CustomEvent seam updated/retired); palette action list gains the per-tab `Settings:` actions.

## Impact

**Frontend only; no backend/API changes.** Affected code:

- `app/frontend/src/components/settings-dialog.tsx` (494 lines) — restructured into the tabbed shell + General/Appearance panels.
- `app/frontend/src/components/shortcuts-overlay.tsx` (1159 lines) — shell retired; body ported into the Shortcuts tab panel (the biggest acknowledged cost of the change).
- `app/frontend/src/components/dialog.tsx` — new `size` variant (~`max-w-4xl`) + fixed-height support.
- `app/frontend/src/contexts/settings-dialog-context.tsx` — `openSettings(tab?)`.
- `app/frontend/src/app.tsx` — `LayoutShortcutsOverlay` retirement, `shortcuts-overlay:open` listener re-route, `keybindingHandlers` deep-links.
- `app/frontend/src/components/board/board-page.tsx` — `boardKeyHandlers` deep-links.
- `app/frontend/src/hooks/use-global-palette-actions.ts` — per-tab palette actions.

**Tests** (the acknowledged porting cost):

- `shortcuts-overlay.test.tsx` re-anchored to the tab panel — **the ArrowDown "closes and releases key handling" assertion family is a known CI-flake area (proven flaky on clean main); the port MUST carry these assertions forward, not silently drop them.**
- `settings-dialog.test.tsx`, `dialog.test.tsx` (size-variant assertions), `settings-dialog-context.test.tsx`, `use-global-palette-actions.test.tsx` updated.
- E2E specs exercising the overlay/settings surfaces re-anchored with their `.spec.md` companions (Constitution Test Companion Docs): `shortcut-registry.spec.ts`, `macro-riff-bindings.spec.ts`, `top-bar-overflow.spec.ts` — selectors like `data-testid="shortcuts-overlay"` and the open/close choreography change.
- New coverage: tab switching (pointer + roving arrow keys), chord deep-links to the right tab, mobile tab strip at 375px, per-tab palette actions.

**Constraints**: Constitution §IV (dialog only, no settings routes); Constitution V (every tab/action keyboard-reachable, palette parity); one responsive code path (single 480px breakpoint, no mobile fork); second-surface rule (reuse control models).

## Open Questions

- None — the discussion resolved the design direction; remaining latitude (exact size values, chord re-fire semantics, tab-default behavior) is recorded as graded assumptions below rather than blocking questions.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The surface remains a dialog, never a routed page | Constitution §IV "no settings pages", explicitly reaffirmed in the discussion | S:95 R:90 A:100 D:95 |
| 2 | Certain | Three tabs with the exact control assignment (General: display name + SSH host + notifications; Appearance: theme mode/pair + accent + terminal font; Shortcuts: overlay body) | Discussed — decision 1 of the conversation, specific per-control mapping given | S:90 R:70 A:85 D:90 |
| 3 | Certain | Desktop = left nav rail inside the dialog, new `Dialog` size variant (~max-w-4xl), fixed dialog height with per-tab internal scroll | Discussed — decision 2; mock accepted in direction | S:90 R:75 A:80 D:85 |
| 4 | Certain | `ScopeHeading` persistence-scope groups are kept within each tab (both General and Appearance mix host + device scopes) | Discussed — the key design tension, resolved explicitly (decision 3) | S:85 R:80 A:85 D:85 |
| 5 | Certain | Mobile <480px = horizontal scrollable tab strip, same tablist markup restyled at the one existing breakpoint; drill-down navigation rejected | Discussed — decision 5 with explicit rejection + revisit condition (~5–6 tabs) | S:90 R:75 A:80 D:85 |
| 6 | Certain | Second-surface rule preserved: reuse `useTheme()`/`useThemeActions()`, `SwatchPopover`, `ChromeContext.terminalFontSize`, `usePushSubscription()`; top-bar `ThemeSelector` modal stays | Discussed — decision 6; matches the existing memory design decision | S:85 R:80 A:90 D:90 |
| 7 | Certain | All three overlay entry points (chord, `Help: Keyboard Shortcuts` palette action, chevron-menu row via `shortcuts-overlay:open`) re-route to the Shortcuts tab; the standalone `LayoutShortcutsOverlay` mount is retired | Follows directly from "the standalone shell is retired" + Constitution V palette parity | S:75 R:80 A:85 D:80 |
| 8 | Certain | The discussion's "`?` chord" means the registry `shortcuts-overlay` binding (⌘/ on mac hosts, ⇧Ctrl+/ on Win/Linux) | Registry (`lib/keybindings.ts`) and memory are authoritative; no `?` binding exists | S:60 R:90 A:95 D:85 |
| 9 | Certain | Test port carries the shortcuts-overlay assertions forward intact, including the ArrowDown close/release family (known CI-flake area); `.spec.md` companions updated with their specs | Stated as an explicit constraint in the discussion + Constitution Test Companion Docs | S:80 R:75 A:85 D:85 |
| 10 | Confident | Keyboard wiring shape: `openSettings(tab?)` on `SettingsDialogContext`, chord deep-links (settings-open→General, shortcuts-overlay→Shortcuts), per-tab palette actions, roving tablist arrow-key nav, handlers in both route shells | Discussed — decision 4; exact palette action naming/ids left to apply within the actionId-doubles-as-palette-id convention | S:85 R:75 A:80 D:80 |
| 11 | Confident | Registry actionIds `settings-open` and `shortcuts-overlay` stay unchanged (no rename) so stored per-device override diffs in `localStorage["runkit-keybindings"]` keep working | Not discussed explicitly; renaming would orphan user overrides — clear front-runner | S:50 R:60 A:85 D:80 |
| 12 | Confident | Per-binding chord semantics are preserved: the shortcuts chord keeps its TOGGLE behavior (pressing it while the dialog is open on Shortcuts closes the dialog); `settings-open` stays a pure opener (re-fire while open is a no-op/lands on General, never closes) | Not discussed; preserving each binding's documented semantics is the obvious default, easily revised | S:50 R:85 A:70 D:65 |
| 13 | Confident | Tab-less `openSettings()` (gear chip, `Settings: Open`) always lands on General; no last-visited-tab persistence | Not discussed; matches "settings-open deep-links to General" and avoids new persisted state | S:45 R:85 A:60 D:55 |
| 14 | Confident | The overlay body folds in functionally intact — key map grid + modifier picker, jump-nav chips, filter, grouped rows + rebind capture, CUSTOM macro section + add flow, TMUX section, platform toggle, reset-all footer — nothing dropped | "The full shortcuts/rebinding table folded in"; internal layout may adapt to the panel's narrower width | S:80 R:70 A:80 D:80 |
| 15 | Confident | Exact dimension values (final `max-w-*` token, the fixed height value) are apply-time visual tuning within the accepted mock direction | "~max-w-4xl" given as approximate; purely visual, trivially reversible | S:65 R:90 A:75 D:70 |

15 assumptions (9 certain, 6 confident, 0 tentative, 0 unresolved).

# Intake: macOS Cmd-Tier Demotion & Help-Palette Renames

**Change**: 260730-n789-macos-cmd-tier-shortcuts
**Created**: 2026-07-30

## Origin

Conversational — a follow-up session to the merged-and-released keyboard shortcut registry (PR #475, change `260730-g40a`; macro follow-up PR #476). The user probed why macOS should pay the Shift tax when the desktop shell was built precisely to free the unshifted ⌘ tier, and converged on a per-platform final table.

> User's raw asks, in sequence: "N T W L and [ → Is there no way for an electron app to capture these? (I believe there is — the shortcuts were the whole reason to build the desktop electron app)" → "I get why Windows/Linux need Shift+Ctrl. But for macOS to get Shift+Cmd doesn't make sense. Where all can you bring it down to just Cmd+<something>? Can you show the final table" → (separately) "In cmd+K, Help > Keyboard Shortcuts should be renamed to 'tmux Shortcuts'. And the other Help > Shortcuts should be renamed to Help > Keyboard Shortcuts. Any better idea?" → "Go ahead with the shortcuts changes also as discussed, and add the previous PR"

Key decisions from the discussion:

1. **The uniform-shifted-tier rule is relaxed per platform, letters stay constant.** Win/Linux keeps `Shift+Ctrl` for everything (plain Ctrl belongs to the pane — unchanged founding rule). macOS demotes to plain ⌘ wherever nothing immovable blocks it.
2. **The agreed final table** (letters constant, modifier varies):

   | Action | macOS shell | macOS browser | Win/Linux |
   |--------|------------|---------------|-----------|
   | New session (N) | ⌘N | palette only (browser-reserved even shifted) | ⇧Ctrl+N |
   | New window (T) | ⌘T | palette only | ⇧Ctrl+T |
   | Close window (W) | ⌘W | palette only | ⇧Ctrl+W |
   | Previous window (H) | ⇧⌘H | ⇧⌘H | ⇧Ctrl+H |
   | Next window (L) | ⇧⌘L | ⇧⌘L | ⇧Ctrl+L |
   | Back ([) | ⌘[ | ⌘[ | ⇧Ctrl+[ |
   | Forward (]) | ⌘] | ⌘] | ⇧Ctrl+] |
   | Next waiting agent (A) | ⇧⌘A | ⇧⌘A | ⇧Ctrl+A |
   | Shortcuts overlay (/) | ⌘/ | ⌘/ | ⇧Ctrl+/ |

3. **Immovable blockers stay shifted**: ⌘H is macOS Hide (OS/app-menu level, dead in both hosts; the shell's own app menu binds `role: hide`); ⌘A is select-all in browsers and the shell's Edit-menu `selectAll` role. H and L stay shifted **as a pair** — demoting L alone would split the H/L pair across tiers, the exact Conductor fragmentation the g40a tier decision rejected (recommended by the agent, accepted by the user via "as discussed").
4. **⌘N/⌘T/⌘W demote in the macOS shell only** — uninterceptable in browsers (and browser-dead even shifted: incognito / reopen-tab / close-window), but the shell deliberately leaves the unshifted tier unbound ("the unshifted Cmd/Ctrl tier is inviolable", `menu.ts`; ⌘W documented as unbound-by-design for exactly this).
5. **⌘[ / ⌘] / ⌘/ demote on macOS in both hosts** — all interceptable in browsers (the board pane-cycle already runs on cmd-tier [/]), and ⌘[/⌘] match native browser back/forward convention.
6. **Palette renames** (already applied in the working tree, riding this change): the tmux keybindings modal's palette entry `Help: Keyboard Shortcuts` → `Help: tmux Keybindings` (dialog title `Keyboard Shortcuts` → `tmux Keybindings`), and the registry overlay's `Help: Shortcuts` → `Help: Keyboard Shortcuts`. Rationale: the overlay is the primary shortcuts surface and should own the canonical name; "Keybindings" is tmux's own vocabulary (`bind-key`, `GET /api/keybindings`), maximizing palette-filter separation. The `Help:` family prefix is kept (palette grouping convention). Action ids are unchanged (`keyboard-shortcuts`, `shortcuts-overlay` — the latter doubles as the registry actionId and the stored-override key).
7. **"Add the previous PR"**: this intake records PR #475 (https://github.com/sahil87/run-kit/pull/475) as the predecessor change this builds on; the new PR description should link it.

## Why

The g40a registry chose a uniform `Shift+CmdOrCtrl` tier so one letter map works on every platform and host. That uniformity taxes macOS users — especially desktop-shell users — with a three-key chord where the shell was built precisely to hand the unshifted ⌘ tier to the SPA. The founding constraints were always platform-asymmetric: the pane-ownership rule that forces Shift is Win/Linux-only, and the browser-reservation problem is host-specific. Now that the registry resolves effective combos through one seam, per-platform/per-host defaults are cheap to express — the tier becomes data, not architecture.

If we don't do this: mac shell users press ⇧⌘N for an action the environment would happily give them as ⌘N, and the "the shell frees the page tier" premise stays unused by the SPA. The palette also currently has two confusingly-named Help entries where the *legacy tmux* modal owns the better name.

## What Changes

### 1. Per-platform/per-host default combos (schema, `lib/keybindings.ts`)

- `KeyBinding` defaults gain platform/host-conditional tiers. Suggested shape: keep `code`/`tier` as the base (Win/Linux value) and add an optional `macTier?: BindingTier` + `macShellOnly?: boolean` refinement — or an equivalent resolver-level mapping; exact shape is the apply agent's call, provided: (a) the stored override shape `{ [actionId]: { code, tier } | null }` is unchanged (per-device storage means per-platform is inherent), (b) `resolveCombo`/effective-map resolution takes `platform` + `isShell()` into account exactly once, in the resolver.
- Effective defaults per the final table: `go-back`/`go-forward`/`shortcuts-overlay` are cmd-tier on macOS (both hosts); `create-session`/`create-window`/`kill-window` are cmd-tier on macOS **only when `isShell()`** (mac browser keeps today's shifted defaults — still browser-claimed, palette-only); `window-prev`/`window-next`/`agent-next-waiting` stay shifted everywhere.

### 2. Claimed-keys data gains the mac cmd tier

The mac-shell cmd tier has its own claimed set for the overlay tier map / capture warnings: ⌘Q (quit), ⌘H (hide), ⌘M (minimize), ⌘R (shell reload), ⌘Z/X/C/V/A (shell Edit-menu roles), ⌘0/+/− (zoom) — from `app/desktop/src/menu.ts`. Mac-browser cmd tier: N/T/W/L and other browser-reserved keys as display data.

### 3. Board pane-cycle vs global mac ⌘[/⌘] (scope precedence)

On macOS the board-scoped pane-cycle (cmd [/]) and the now-cmd-tier global back/forward share combos. Resolution: **scoped beats global** — the board route keeps pane-cycle on ⌘[/⌘] (back/forward stays palette-reachable there); conflict detection treats a scoped/global shadow as precedence, not a user-facing conflict. On non-board routes ⌘[/⌘] are back/forward.

### 4. Terminal seam (macOS only)

`terminal-client.tsx`'s `attachCustomKeyEventHandler` additionally refuses **cmd-tier registry matches on macOS** so ⌘[/⌘]/⌘/ (and shell-host ⌘N/T/W) fire with the terminal focused. Win/Linux behavior is byte-identical to today (refuse shifted only — the plain-Ctrl aliasing hazard is why cmd-tier refusal is forbidden there; on macOS `metaKey` chords never reach the pane as control bytes, so refusal is safe).

### 5. Overlay + palette hints render host-aware effective combos

- The overlay's tier map, rows, and capture flow reflect the per-host defaults on the current device (the platform display toggle keeps working as a *rendering* toggle; effective bindings are always the current host's).
- Rows demoted only in the shell render their shell state when `isShell()` and their browser state otherwise (the existing browser-reserved row treatment already covers the mac-browser N/T/W case).
- Palette `shortcut` hints format from the effective map (already the case — hints follow automatically once the resolver is host-aware).

### 6. Help-palette renames (already in working tree)

As decision 6 above — verify, cover with the existing e2e (`shortcut-registry.spec.ts` palette-entry test already updated to type the new label), and keep `.spec.md` companions in sync.

### 7. Docs

PR description links PR #475 as the predecessor. Memory hydration per Affected Memory below.

## Affected Memory

- `run-kit/ui-patterns`: (modify) keyboard-shortcut registry section — per-platform/per-host tier table replaces the uniform-tier statement; renamed Help palette entries; scope-precedence rule; mac terminal-seam refusal
- `run-kit/desktop-shell`: (modify) tier-ownership note — the SPA now binds specific unshifted ⌘ keys inside the mac shell (N/T/W + [/]//), so the "no SPA code binds the page tier yet" statement updates; shell menu additions on the mac cmd tier must also check the registry

## Impact

- `app/frontend/src/lib/keybindings.ts` + `keybindings.test.ts` — schema/resolver/claimed-keys/conflict changes (pure, unit-testable)
- `app/frontend/src/hooks/use-keybinding-dispatch.ts`, `use-keybindings.ts` (+tests) — host-aware resolution seam
- `app/frontend/src/components/terminal-client.tsx` — mac cmd-tier refusal
- `app/frontend/src/components/shortcuts-overlay.tsx` (+test) — host-aware rendering
- `app/frontend/src/app.tsx`, `components/board/board-page.tsx`, `components/keyboard-shortcuts.tsx` — renames (done) + any dispatch precedence wiring
- `app/frontend/tests/e2e/shortcut-registry.spec.ts` + `.spec.md` — renamed-label test (done); new coverage for mac cmd-tier resolution where mockable (e2e runs are linux-platform, so mac-specific paths are unit-test territory)
- No backend changes. No shell (`app/desktop/`) changes — the shell already leaves these keys unbound.

## Open Questions

*(none — the per-key table, blockers, pair-symmetry call, and rename labels were all resolved in the discussion)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Final per-key table as in Origin decision 2 | Explicit table shown to and approved by the user ("as discussed") | S:90 R:85 A:95 D:90 |
| 2 | Certain | H/L stay shifted as a pair; A stays shifted | ⌘H/⌘A immovable (OS Hide; select-all + shell Edit role); pair-symmetry recommendation explicitly presented and accepted | S:85 R:90 A:95 D:85 |
| 3 | Certain | N/T/W demote only in the macOS shell; mac browser stays palette-only | Browser reservation is a hard constraint both shifted and unshifted; shell-only demotion was the presented table | S:85 R:85 A:95 D:90 |
| 4 | Certain | Renames: `Help: tmux Keybindings` (modal + dialog title) and `Help: Keyboard Shortcuts` (overlay); ids unchanged | User proposed the swap and asked for a better idea; the tmux-vocabulary refinement was presented and approved via "go ahead as discussed"; changing ids would break stored overrides | S:85 R:90 A:90 D:85 |
| 5 | Confident | Board collision resolves as scope-precedence (board pane-cycle keeps ⌘[/⌘] on board routes) | Flagged in discussion as the needed decision with this as the offered resolution; matches how the board's own dispatcher already shadows naturally | S:60 R:85 A:80 D:70 |
| 6 | Confident | Terminal seam refuses cmd-tier matches on macOS only; Win/Linux seam byte-identical | Direct consequence of the pane rule discussed; mac `metaKey` chords are not pane bytes | S:65 R:85 A:90 D:80 |
| 7 | Confident | Schema keeps stored-override shape unchanged; per-platform resolution lives in the resolver (exact field shape = apply's call) | Discussion named the need ("per-platform/per-host default combos") without pinning the field shape; storage compatibility is the binding constraint | S:60 R:80 A:85 D:65 |
| 8 | Confident | Mac cmd-tier claimed-keys set sourced from the shell menu accelerator table (Q/H/M/R/Z/X/C/V/A/zoom) | Derivable from `menu.ts` + desktop-shell memory; display/warning-only data | S:60 R:95 A:90 D:80 |
| 9 | Certain | PR description links PR #475 as predecessor | Direct user instruction ("add the previous PR") | S:75 R:95 A:90 D:85 |

9 assumptions (5 certain, 4 confident, 0 tentative, 0 unresolved).

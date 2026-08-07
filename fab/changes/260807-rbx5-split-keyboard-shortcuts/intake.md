# Intake: Split Pane Keyboard Shortcuts

**Change**: 260807-rbx5-split-keyboard-shortcuts
**Created**: 2026-08-07

## Origin

One-shot `/fab-new` invocation, no prior conversation context.

> Add keyboard shortcuts for split horizontal (Cmd+D) and split vertical (Cmd+Shift+D)

## Why

Splitting a pane is a frequent terminal-page action, but today it is reachable only via pointer-adjacent affordances: the top-bar Split split-button (`id: "split"` in `top-bar.tsx`) and the two command-palette entries (`Window: Split Horizontal` / `Window: Split Vertical` in `app.tsx`). The constitution (Principle V, Keyboard-First) requires every user-facing action be reachable via keyboard — the palette satisfies the letter of that, but a two-keystroke-plus-typing palette round-trip is slow for an action users fire many times a session. `⌘D` / `⇧⌘D` is the established convention for exactly this pair in iTerm2 and VS Code, so the requested chords match user muscle memory.

If we don't add this, split stays a palette-only action while comparable window operations (new window `⌘T`, close window `⌘W`, window cycling `⇧⌘H`/`⇧⌘L`) already carry direct chords — an inconsistency in the keyboard-first surface.

The approach is pure registry data: the app already has a declarative keybinding registry (`app/frontend/src/lib/keybindings.ts`, `260730-g40a`) where `actionId` doubles as the palette action id, and the palette action bodies already exist. No new endpoint, no new execution path — two new `DEFAULT_BINDINGS` rows plus two handler registrations.

## What Changes

### 1. Two new rows in `DEFAULT_BINDINGS` (`app/frontend/src/lib/keybindings.ts`)

Both on `code: "KeyD"` (layout-independent `e.code` matching, per the registry rule), `scope: "terminal"` (the `view-cycle` precedent — splits act on the current window; the palette bodies exist only on window routes), `kind: "builtin"`:

```ts
{ actionId: "split-horizontal", code: "KeyD", tier: "shifted", macTier: "cmd", scope: "terminal", kind: "builtin", label: "Split horizontal", description: "split the pane side-by-side", mapLabel: "split h" },
{ actionId: "split-vertical",   code: "KeyD", tier: "shifted", platform: "mac", scope: "terminal", kind: "builtin", label: "Split vertical", description: "split the pane stacked", mapLabel: "split v" },
```

Resulting effective defaults:

| Action | macOS (both hosts) | Win/Linux |
|--------|--------------------|-----------|
| `split-horizontal` | ⌘D (`macTier: "cmd"` demotion) | ⇧Ctrl+D |
| `split-vertical` | ⇧⌘D (base `shifted` tier) | unbound by default — palette-reachable, user-rebindable |

Direction semantics match the existing palette/top-bar convention (`260806-2x2h`): **Horizontal → `horizontal: true` (tmux `-h`, side-by-side); Vertical → `false` (stacked)**. Horizontal is the primary/default split (default-first, mirroring the SplitControl menus), which is why it gets the plain `⌘D` and the sole Win/Linux chord.

Rationale for the per-platform shape (constraints are all established registry rules):

- **Plain `Ctrl+D` can never be bound on Win/Linux** — the unshifted Ctrl tier belongs to the pane there (`Ctrl+D` is EOF; "plain Ctrl must always reach the pane"). So the user's literal `Cmd+D`/`Cmd+Shift+D` request maps to the mac tiers, and Win/Linux gets the shifted tier only.
- **Both actions cannot share `⇧Ctrl+D`** on Win/Linux — `findConflicts` is a test-enforced invariant that shipped defaults are conflict-free in every host, and these two rows would be equal-scope (`terminal`/`terminal`).
- **`⌘D` demotes on macOS in both hosts** (no `macShellOnly`): like the demoted `⌘[`/`⌘]`/`⌘/`, the mac-browser `⌘D` (bookmark) is page-interceptable via `preventDefault`, unlike the reserved N/T/W set. No new `browser`-owner claim entry is needed.

### 2. Minimal schema affordance: `platform?: "mac"` on `KeyBinding`

`split-vertical` needs "bound on mac, unbound elsewhere", which the current schema cannot express (`code` is platform-invariant; `macTier` varies only the modifier). Add one optional field, mirroring the claims data's existing `platform:` field vocabulary (`SHELL_SWITCHER_DIGITS` carries `platform: "other"`):

- `platform?: "mac" | "other"` — when set and the host platform does not match, `defaultComboFor`/`resolveBindings` resolve the binding's **default** as unbound (`enabled: false`, no combo, the same rendering the macro keyless-default path already produces — the overlay's `unbound` affordance covers it with zero new UI states).
- A **user override still applies verbatim**: a Win/Linux user can click-to-rebind `split-vertical` onto any free combo; only the shipped default is platform-gated.
- No other binding sets the field, so all existing resolution is byte-identical.

### 3. Handler registration in `keybindingHandlers` (`app.tsx` ~line 2620)

Two `fromPalette` lookups added to the AppShell dispatcher map:

```ts
"split-horizontal": fromPalette("split-horizontal"),
"split-vertical": fromPalette("split-vertical"),
```

The palette entries are gated on a current window + session, so on non-window routes `fromPalette` returns `undefined` → no handler → the chord falls through untouched (the dispatcher's existing rule). BoardPage mounts no split handlers (splits are terminal-route actions), matching `open-last-used`.

### 4. What needs NO code change (verify, don't build)

- **Terminal-seam refusal** (`shouldRefuseTerminalChord`): shifted-tier matches are refused on every platform, and mac `cmd`-tier matches with `metaKey` are refused — both new chords fire while the terminal owns focus, purely from the new registry data. Win/Linux plain `Ctrl+D` is never refused and still reaches the pane as EOF.
- **Palette hints**: `withShortcutHints` joins on `actionId` = palette id, so `Window: Split Horizontal` / `Window: Split Vertical` gain their chord hints automatically (and the Win/Linux unbound `split-vertical` correctly contributes no hint).
- **Shortcuts overlay**: the two rows appear in the TERMINAL scope group, the keycap map's D cell renders per layer (⇧⌘ layer → `split v`, ⌘ layer → `split h`), and click-to-rebind/reset work — all read from the effective map.

### 5. Test updates

- **`lib/keybindings.test.ts`**: extend the shipped-defaults-conflict-free-per-host invariant run (must pass with the new rows), add resolution cases for the `platform` gate (mac → ⇧⌘D bound; win/linux → unbound default, override applies), and refusal-predicate cases for `⌘D`/`⇧⌘D`.
- **`macro-riff-bindings.spec.ts` (+ its `.spec.md`, same commit — constitution § Test Companion Docs)**: the macro add-flow captures `⇧Ctrl+D`, which now collides with `split-horizontal`'s Win/Linux default (e2e runs on Linux) and would assert a steal instead of a clean capture. Move the test macro's chord to a free combo (e.g., `⇧Ctrl+Y`).
- **`shortcut-registry.spec.ts` (+ `.spec.md`)**: add coverage for `⇧Ctrl+D` splitting on the terminal route (mocked backend), and mac-block coverage that `⌘D`/`⇧⌘D` dispatch the split actions.

## Affected Memory

- `run-kit/ui-patterns`: (modify) § Keyboard Shortcuts — add the two rows to the default-binding-set table, document the `platform?:` schema affordance next to `macTier`/`macShellOnly`, and note the macro e2e chord move off `⇧Ctrl+D`.

## Impact

- `app/frontend/src/lib/keybindings.ts` — two `DEFAULT_BINDINGS` rows; `KeyBinding.platform?` field; `defaultComboFor`/`resolveBindings` platform gate (small, single-seam).
- `app/frontend/src/lib/keybindings.test.ts` — invariant + new resolution/refusal cases.
- `app/frontend/src/app.tsx` — two handler registrations in `keybindingHandlers`.
- `app/frontend/tests/macro-riff-bindings.spec.ts` + `.spec.md` — capture chord moves off `⇧Ctrl+D`.
- `app/frontend/tests/shortcut-registry.spec.ts` + `.spec.md` — new split-chord coverage.
- No backend changes, no new API surface, no new routes (Constitution IV untouched). `executeSplit` and the palette actions are reused as-is.

## Open Questions

- None — the mac chords are specified verbatim by the request, and the Win/Linux mapping follows from established registry constraints (recorded as assumptions below).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | ⌘D → split horizontal (side-by-side, tmux `-h`), ⇧⌘D → split vertical (stacked) | Chords specified verbatim in the request; direction semantics fixed by the existing palette/top-bar convention (260806-2x2h) | S:90 R:85 A:95 D:90 |
| 2 | Certain | Implement as registry data (`DEFAULT_BINDINGS` rows + `fromPalette` handlers), not component-local listeners | The declarative registry is the mandated home for every app chord (260730-g40a); actionIds already exist as palette ids | S:75 R:85 A:95 D:95 |
| 3 | Certain | Terminal-seam refusal and palette hints need no code changes | `shouldRefuseTerminalChord` refuses shifted-tier everywhere and mac cmd-tier+metaKey from data alone; `withShortcutHints` joins on actionId | S:60 R:85 A:90 D:85 |
| 4 | Confident | `split-horizontal` demotes to ⌘D on macOS in **both** hosts (`macTier: "cmd"`, no `macShellOnly`) | Mac-browser ⌘D (bookmark) is page-interceptable, matching the demoted ⌘[/⌘]/⌘/ precedent rather than the reserved N/T/W set | S:60 R:80 A:80 D:70 |
| 5 | Confident | Win/Linux: `split-horizontal` gets ⇧Ctrl+D; `split-vertical` ships unbound (palette-only, user-rebindable) via a new `platform?: "mac"` binding field | Request specifies mac chords only; plain Ctrl+D is pane-owned EOF on Win/Linux, both actions can't share ⇧Ctrl+D (conflict-free invariant), and horizontal is the primary/default split | S:40 R:75 A:70 D:55 |
| 6 | Confident | `scope: "terminal"` for both bindings | view-cycle precedent; split palette bodies exist only on window routes, so handler-presence gating does the rest | S:55 R:85 A:85 D:75 |
| 7 | Certain | Move the macro e2e capture chord off ⇧Ctrl+D (e.g., to ⇧Ctrl+Y) | e2e runs on Linux where ⇧Ctrl+D becomes split-horizontal's default; capturing it would assert a steal instead of a clean capture | S:50 R:90 A:90 D:85 |

7 assumptions (4 certain, 3 confident, 0 tentative, 0 unresolved).

## Revision (2026-08-07, in-PR)

Assumptions 5 and 7 are superseded. The Win/Linux half was reworked from "horizontal on ⇧Ctrl+D, vertical unbound via a `platform` default gate" to **bound-everywhere per-platform pairs** via a `macCode?: string` default refinement in `defaultComboFor` (composing with `macTier` under the one mac host gate; the `platform` field is removed):

- Base (Win/Linux) codes are keycap-as-divider mnemonics: `split-horizontal` = ⇧Ctrl+\ (shift+\ types `|`), `split-vertical` = ⇧Ctrl+-.
- Both rows carry `macCode: "KeyD"`, so macOS keeps the requested ⌘D/⇧⌘D pair unchanged.
- With shifted `KeyD` free again on Win/Linux, the macro/capture test suites revert to their original ⇧Ctrl+D chords (assumption 7 no longer applies).

Rationale: no action ships unbound-by-default, each platform gets a coherent pair, and the change is one deliberate exception to 260730-n789's letters-constant rule, recorded in the registry docs and `docs/memory/run-kit/ui-patterns.md` § Design Decisions.

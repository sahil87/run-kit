# Intake: Shortcuts Map Modifier Picker

**Change**: 260801-r8j2-shortcuts-map-modifier-picker
**Created**: 2026-08-01

## Origin

Promptless dispatch (no interactive questioning) from a synthesized change description captured in a `/fab-discuss` conversation reviewing the **merged** Keyboard Shortcuts Consolidation overlay (change `260801-sm6g`, PR #501, already on `main`). The description encodes user feedback on the shipped overlay plus an agreed three-requirement design; all decisions below were made in that conversation and are transferred here verbatim where specific.

> **Problem** (user feedback on the shipped overlay): the two stacked keyboard maps — "run-kit tier — ⇧⌘ + key" and "page tier — ⌘ + key" — leak the registry's implementation taxonomy (`tier: "shifted" | "cmd"` in `app/frontend/src/lib/keybindings.ts`). Users don't think in modifier tiers; the dual map duplicates what the tables below already answer (effective chords) in a harder-to-read form, and it encodes the browser-vs-desktop story indirectly (amber "claimed" cells + a "freed by the desktop shell" caption). Agreed division of labor: **tables are the authority, the map is a discovery/rebind tool**.
>
> **Decided design**: R1 — one keyboard map with a *holding ⇧⌘ | ⌘* modifier picker (replaces the two stacked maps). R2 — host-dependence moves into the table rows as per-row facts (`desktop` badge + other-host chord hint on exactly the `macTier: "cmd"` + `macShellOnly: true` trio). R3 — copy de-jargonization (drop "tier"; replace the freed-by-shell captions with a one-line claimed legend). Everything else in the merged overlay stays unchanged. This is a rendering/IA change, not a registry change.

## Why

1. **The pain point**: the shipped overlay renders two stacked keyboard maps whose headers name the registry's internal tier taxonomy ("run-kit tier", "page tier"). This is an implementation concept leaking into user-facing chrome. Users think "what does my keyboard do while I hold these modifiers", not "which tier is this binding in". The two maps also double the overlay's vertical mass, pushing the authoritative binding tables (and the TMUX section) below the fold on short viewports — the very problem 260801-sm6g's fold/auto-hide affordances were mitigating.
2. **The consequence of not fixing it**: the map keeps answering questions the tables already answer better (effective chords per action), in a redundant and harder-to-read form, while the genuinely useful browser-vs-desktop story stays encoded indirectly (amber cells + a caption) instead of appearing on the three rows it actually applies to. Discovery and rebinding both suffer.
3. **Why this approach**: the *holding-modifier* reframing ("hold this — here's what your keyboard does") is the physical model that Karabiner-Elements / Keyboard Maestro keyboard viewers use — it matches how people actually explore a layer. Making the tables the single authority for effective chords (with per-row host facts) and demoting the map to a discovery/rebind tool removes the duplication instead of restyling it. Alternatives implicitly rejected in discussion: keeping both maps with renamed headers (still double vertical mass, still duplicates the tables), and labeling the whole ⌘ layer "desktop-only" (factually wrong — most of the ⌘ layer works in a browser tab; only the macShellOnly trio differs).

## What Changes

All three requirements are contained to the overlay component (`app/frontend/src/components/shortcuts-overlay.tsx`); `DEFAULT_BINDINGS` and the registry schema in `app/frontend/src/lib/keybindings.ts` are **not** changed.

### R1 — One keyboard map with a modifier picker

Replace the two stacked maps (currently: the ⇧⌘ map at the top of the map block, then — mac display only — the "page tier — ⌘ + key" second map) with **one** map plus a small segmented control on the map header: **holding `⇧⌘` | `⌘`**.

- **Semantics**: the picker selects which modifier layer the single map renders. This reframes the map physically ("hold this — here's what your keyboard does").
- **`⌘` availability**: the `⌘` picker option appears **only on the macOS display** — the win/linux unshifted layer is plain Ctrl, which belongs to the pane. This is today's rule (the cmd map renders only when `displayPlatform === "mac"`; see the `cmdKeyStates` memo, currently `shortcuts-overlay.tsx` ~line 371) *relocated into the picker's availability*, not a new rule.
- **Default selection**: `⇧⌘` (the universal layer).
- **Implementation seam already exists**: `tierKeyStates(tier)` in the overlay is already parameterized by tier — the picker chooses which tier's state map feeds the (single) `KEY_ROWS` grid. No new state-derivation logic is needed.
- **Carried over unchanged**: the per-cell states (bound / custom / claimed / free, incl. the `Digit3`-keyed ellipsis-cell claim rendering), the fold ("collapse map" / "expand map", session-scoped `mapFolded` state), and the auto-hide-while-filtering behavior (`{!filtering && ...}` around the whole map block). The jump-nav "key map" chip target stays valid (same section anchor).
- **Effect**: halves the map's vertical mass on the mac display.

### R2 — Host-dependence moves into the table rows as per-row facts

The genuinely desktop-only demotions are **per-binding**, not per-map: exactly the `macTier: "cmd"` + `macShellOnly: true` bindings in `DEFAULT_BINDINGS` — `create-session` (⌘N), `create-window` (⌘T), `kill-window` (⌘W) — whose effective chord differs between a mac browser (⇧⌘ fallback, where it resolves browser-reserved) and the desktop shell (⌘).

- Their rows keep showing the **effective chord for THIS host** (unchanged — `resolveBindings`/`defaultComboFor` already produce this), plus:
  - a small **`desktop` badge**, and
  - the **other host's chord as a secondary hint** — e.g. on a desktop-shell host the row shows `⌘T` + badge with "in browser: ⇧⌘T". Exact presentation per existing row/badge idioms — `ScopeBadge` (pill) and the amber "browser" reserved pill are the precedents.
- Rows whose chord is host-invariant get **no badge**. Do **NOT** mislabel the whole ⌘ layer as desktop-only — most of it (⌘K, ⌘., ⌘[/⌘], ⌘/) works in a browser tab too; only the macShellOnly trio differs.
- **Data already available**: `EffectiveBinding` extends `KeyBinding`, and `resolveBindings` spreads `...def`, so `macTier`/`macShellOnly` are present on every effective row — badge derivation is `b.macTier != null && b.macShellOnly === true` plus host facts. The other-host chord is computable via the existing pure `defaultComboFor(def, { platform, shell })` seam (called with the flipped `shell` value); read the code first — a new helper is only warranted if the derivation doesn't stay a one-liner.

### R3 — Copy de-jargonization

- Map labels drop "tier": `run-kit tier — ⇧⌘ + key` → **"Holding ⇧⌘"**, and **"Holding ⌘"** for the other picker state (on the Win·Linux display the ⇧⌘ label renders with that display's keycaps, e.g. "Holding Shift Ctrl", per the existing `tierName` derivation).
- The `"freed by the desktop shell"` / `"browser keys stay claimed — the desktop shell frees them"` captions (currently on the ⌘ map header) are **replaced by a legend line on the claimed state**: `dimmed = taken by macOS / browser / app menu — the desktop app frees the browser ones` (final copy per legend space; keep it one line). Today's legend entry reads `claimed (shell · system · browser)` — this is the entry that grows the explanation.
- The **"plain Ctrl always reaches the pane"** note is kept — it explains why there's no Ctrl layer/picker option.

### Kept unchanged (explicit non-goals)

Everything else from the merged 260801-sm6g overlay: sticky jump-nav chips with live filter counts, the read-only TMUX section, the SHELL subgroup inside GLOBAL, CUSTOM macros (add flow, missing-preset badge), the rebind capture flow (capture is tier-aware via `captureFromEvent` and unaffected — this is a rendering/IA change, not a registry change), the platform display toggle, the footer/reset-all, and the `DEFAULT_BINDINGS` data (**no registry schema changes** — `macTier`/`macShellOnly` already carry the per-binding facts R2 needs).

### Tests

- **Unit** (`app/frontend/src/components/shortcuts-overlay.test.tsx`): existing tests assert the old chrome and must be updated — "macOS display adds the ⌘ page-tier map; Win·Linux display omits it" (asserts `/page tier —/` and the "browser keys stay claimed…" caption), the filter test (asserts `/run-kit tier —/` hides/restores), and the collapse-map test. New coverage for: picker renders with ⌘ option only on mac display, default ⇧⌘ selection, switching layers swaps the rendered key states, badge + hint on the macShellOnly trio rows (and absence on host-invariant rows), new legend line.
- **E2E** (`app/frontend/tests/e2e/shortcut-registry.spec.ts`): the spoofed-mac test `"⌘/ toggles the overlay on a mac host and the ⌘ page-tier map renders"` asserts `overlay.getByText(/page tier —/)` (~line 273) — update it to the picker (e.g. assert the ⌘ picker option is present on the mac display and selecting it renders the ⌘ layer). The jump-nav chip assertion (`"key map"` chip, ~line 150) stays valid. Update the sibling **`shortcut-registry.spec.md`** companion in the same commit (Constitution: Test Companion Docs) — its `⌘/ toggles the overlay…` section describes "the second 'page tier — ⌘ + key' keyboard map".

## Affected Memory

- `run-kit/ui-patterns`: (modify) the keybinding-registry/overlay section describes the dual tier maps and the freed-by-shell captions — update to the single map + modifier picker, per-row desktop badges, and the new legend copy.

## Impact

- `app/frontend/src/components/shortcuts-overlay.tsx` — the map block (picker, single grid, labels, legend) and `bindingRow` (desktop badge + other-host hint). Primary file.
- `app/frontend/src/components/shortcuts-overlay.test.tsx` — updated + new unit tests.
- `app/frontend/src/lib/keybindings.ts` — **likely untouched**; at most a small pure helper for row-badge/other-host-chord derivation if it doesn't stay a one-liner in the component (`defaultComboFor` is exported and probably suffices).
- `app/frontend/tests/e2e/shortcut-registry.spec.ts` + `shortcut-registry.spec.md` — one mac-display assertion updated + companion doc.
- No backend, no API, no routes (overlay stays a dialog — Constitution IV), no registry schema, no localStorage shape change.
- Verification gates: `cd app/frontend && npx tsc --noEmit`; Vitest via `just test-frontend`; targeted e2e via `just pw test shortcut-registry` / `just test-e2e` only (never raw playwright; check `lsof -i :3020` for cross-worktree squatters if e2e misbehaves).

## Open Questions

- None blocking. Presentation-level micro-decisions (exact badge/hint markup, final legend wording within the one-line constraint) are delegated to apply per existing idioms — recorded as graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is exactly R1+R2+R3, contained to the overlay; registry data/schema untouched | Discussed — the synthesized description fixes all three requirements and the keep-unchanged list explicitly | S:95 R:85 A:95 D:90 |
| 2 | Certain | No new registry fields: `macTier`/`macShellOnly` survive onto `EffectiveBinding` (spread in `resolveBindings`), so R2's badge derivation needs no schema change | Verified in `lib/keybindings.ts` — `EffectiveBinding = KeyBinding & {...}` and `resolveBindings` spreads `...def` | S:90 R:90 A:95 D:90 |
| 3 | Certain | Picker reuses the existing `tierKeyStates(tier)` seam; ⌘ option availability = the existing `displayPlatform === "mac"` gate relocated; default selection ⇧⌘ | Discussed (R1 verbatim) + verified the seam is already tier-parameterized | S:90 R:85 A:90 D:85 |
| 4 | Certain | Picker selection is session-scoped view state like `mapFolded` (not reset on close); switching the display to Win·Linux while ⌘ is selected falls back to ⇧⌘ (the option disappears) | Follows the component's stated precedent for map view state; the fallback is the only coherent behavior when the option is unavailable | S:70 R:85 A:85 D:75 |
| 5 | Confident | Desktop badge + hint gate on the physical host (`host.platform === "mac"`), not the display toggle: shell hosts hint "in browser: ⇧⌘X"; mac-browser hosts hint the desktop chord (alongside the existing amber "browser" reserved pill); win/linux hosts never show it | The description says rows show "the effective chord for THIS host" plus the OTHER host's chord — a host fact, matching the existing rule that effective bindings are host truths while the toggle only restyles keycaps | S:65 R:80 A:80 D:70 |
| 6 | Confident | Badge/hint render only when the row's effective combo is the host default (`isDefault`); a per-device override or unbound state collapses host divergence, so such rows carry no badge | Overrides are stored as a single `{code, tier}` applied verbatim regardless of shell (`resolveBindings`), so an overridden chord IS host-invariant | S:60 R:85 A:85 D:75 |
| 7 | Confident | Exact badge/hint markup: a `desktop` pill in the `ScopeBadge`/reserved-pill idiom with the other-host chord as adjacent secondary text or pill tooltip — final call at apply | Discussed — deliberately delegated to apply; purely presentational and trivially reversible | S:55 R:90 A:70 D:45 |
| 8 | Confident | Final legend copy: `dimmed = taken by macOS / browser / app menu — the desktop app frees the browser ones`, adjustable for legend space but kept to one line | Discussed — draft copy given with an explicit "final copy per legend space" latitude | S:60 R:95 A:75 D:55 |
| 9 | Confident | Change type `refactor` — a redesign of existing overlay presentation/IA with no new capability surface; the taxonomy's refactor keywords include "redesign" | Description says "likely refactor or feat, your call per the taxonomy"; the dominant character is redesign of shipped UI | S:65 R:90 A:80 D:60 |
| 10 | Certain | Test surface: update the three unit tests asserting old map chrome, the one e2e mac-display assertion (`/page tier —/`), and the `.spec.md` companion in the same commit | Verified by reading both test files; Constitution (Test Companion Docs) + code-quality.md (tests for changed behavior) mandate it | S:85 R:90 A:95 D:90 |

10 assumptions (5 certain, 5 confident, 0 tentative, 0 unresolved).

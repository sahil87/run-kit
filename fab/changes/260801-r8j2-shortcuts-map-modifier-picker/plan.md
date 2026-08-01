# Plan: Shortcuts Map Modifier Picker

**Change**: 260801-r8j2-shortcuts-map-modifier-picker
**Intake**: `intake.md`

## Requirements

### Shortcuts Overlay: Single keyboard map with a modifier picker

#### R1: One map, one modifier layer at a time
The overlay's map block MUST render exactly ONE keyboard grid, with the rendered modifier layer selected by a small segmented picker in the map header — **holding `⇧⌘` | `⌘`**. The `⌘` option MUST appear only on the macOS display (`displayPlatform === "mac"` — today's `cmdKeyStates` gate relocated into picker availability; the Win·Linux unshifted layer is plain Ctrl and belongs to the pane). Default selection MUST be `⇧⌘`. The picker selection is session-scoped view state like `mapFolded` (NOT reset on close); switching the display to Win·Linux while `⌘` is selected MUST fall back to rendering the `⇧⌘` layer (the option disappears; the stored selection may persist and reapply if the display returns to macOS). The existing `tierKeyStates(tier)` seam feeds the single `KEY_ROWS` grid — no new state-derivation logic. Carried over unchanged: per-cell states (bound / custom / claimed / free, incl. the `Digit3`-keyed ellipsis-cell claim), the fold (`mapFolded`, "collapse map" / "expand map"), the auto-hide-while-filtering (`{!filtering && …}` around the whole block), and the jump-nav "key map" chip anchor (same section ref).

- **GIVEN** the overlay is open on the macOS display
- **WHEN** the user looks at the map header
- **THEN** a segmented control offers `⇧⌘` and `⌘`, with `⇧⌘` selected by default and one grid rendered below
- **AND** selecting `⌘` swaps the grid's key states to the `cmd` tier's map (e.g. in a mac browser the `L` cell reads the "address bar" claim; the shifted-only "incognito" claim disappears)

- **GIVEN** the Win·Linux display is active (or the display is switched to Win·Linux while `⌘` was selected)
- **WHEN** the map renders
- **THEN** no `⌘` option is offered and the grid renders the `shifted` layer

#### R2: Host-dependence as per-row facts on the macShellOnly trio
Exactly the `macTier: "cmd"` + `macShellOnly: true` bindings (`create-session` ⌘N, `create-window` ⌘T, `kill-window` ⌘W) MUST additionally render, in their table rows, a small **`desktop` badge** plus the **other host's chord as a secondary hint** — gated on the **physical host** (`host.platform === "mac"`, not the display toggle) AND on the row's effective combo being the host default (`b.isDefault` — an override or unbound state collapses host divergence). On a desktop-shell host the hint reads the browser chord (e.g. "in browser: ⇧⌘T"); on a mac browser host it reads the desktop chord (e.g. "in desktop app: ⌘T", alongside the existing amber "browser" reserved pill). Host-invariant rows and win/linux hosts MUST render no badge. Derivation: `b.macTier != null && b.macShellOnly === true` (both fields survive onto `EffectiveBinding` via `resolveBindings`'s spread) + the other-host chord via the existing pure `defaultComboFor(def, { platform: "mac", shell: !host.shell })` seam, reading the base def from `DEFAULT_BINDINGS` (the effective row's `tier` field is overwritten by resolution, so the base def is the correct input). No registry schema change.

- **GIVEN** a mac desktop-shell host
- **WHEN** the New window row renders with its default `⌘T`
- **THEN** it carries a `desktop` badge and the hint "in browser: ⇧⌘T"

- **GIVEN** a mac browser host
- **WHEN** the New window row renders with its default (reserved) `⇧⌘T`
- **THEN** it carries the `desktop` badge + "in desktop app: ⌘T" hint alongside the amber "browser" pill

- **GIVEN** a win/linux host, or a mac host where the row's combo is overridden or unbound
- **WHEN** the row renders
- **THEN** no `desktop` badge or hint renders

#### R3: Copy de-jargonization
Map labels MUST drop "tier": the header reads **"Holding ⇧⌘"** / **"Holding ⌘"** per the picker state (on the Win·Linux display the label renders with that display's keycaps — "Holding Shift Ctrl" — per the existing `tierName` derivation). The `"freed by the desktop shell"` / `"browser keys stay claimed — the desktop shell frees them"` captions MUST be removed (they leave with the second map) and replaced by the legend's claimed entry growing the explanation to one line: `claimed — taken by the OS / browser / app menu (the desktop app frees the browser ones)`. The **"plain Ctrl always reaches the pane"** note MUST be kept. No user-facing "tier"/"page tier"/"run-kit tier" strings remain in the overlay chrome.

- **GIVEN** the overlay is open
- **WHEN** the map header renders
- **THEN** it reads "Holding" + the selected modifier caps and no "tier" wording appears anywhere in the map block
- **AND** the legend's claimed entry carries the one-line explanation and the plain-Ctrl note remains

#### R4: Test surface updated with the chrome
Unit tests asserting the old map chrome MUST be updated (the page-tier-map test, the filter test's `/run-kit tier —/` assertions, the collapse-map test's legend assertion), and new coverage added for: picker with `⌘` only on the mac display, default `⇧⌘` selection, layer switch swapping rendered key states, badge + hint on the macShellOnly trio (and absence on host-invariant rows / non-default combos), and the new legend line. The e2e spoofed-mac test asserting `overlay.getByText(/page tier —/)` MUST be updated to the picker (assert the `⌘` option is present on the mac display and selecting it renders the `⌘` layer), and the sibling `shortcut-registry.spec.md` companion MUST be updated in the same commit (Constitution: Test Companion Docs).

- **GIVEN** the change is complete
- **WHEN** `npx tsc --noEmit`, Vitest, and `just pw test shortcut-registry` run
- **THEN** all pass, with the updated + new assertions in place and the `.spec.md` companion matching the spec body

### Non-Goals

- No changes to `DEFAULT_BINDINGS`, the registry schema, `resolveBindings`, capture, or the localStorage shape — this is a rendering/IA change.
- Everything else from the merged 260801-sm6g overlay stays unchanged: jump-nav chips + live counts, the TMUX section, the SHELL subgroup, CUSTOM macros, the rebind capture flow, the platform display toggle, the footer/reset-all.
- No new routes, no backend, no API changes.

### Design Decisions

#### Picker is the label
**Decision**: The map header's left slot renders the word "Holding" followed by the segmented `⇧ ⌘` | `⌘` control on the macOS display (selected segment = the label's modifier caps), and a static "Holding **Shift Ctrl**" on the Win·Linux display (a one-option segmented control is dead chrome).
**Why**: R1's picker and R3's "Holding ⇧⌘" label are the same header element — merging them avoids duplicating the modifier caps in the header.
**Rejected**: A separate "Holding ⇧⌘" title plus a detached picker — duplicates the caps and widens the header row.
*Introduced by*: 260801-r8j2-shortcuts-map-modifier-picker

#### Fallback by derivation, not state reset
**Decision**: The active layer is derived — `displayPlatform === "mac" ? mapTier : "shifted"` — rather than resetting `mapTier` when the display toggles.
**Why**: Matches the intake's "the option disappears" framing; a user flipping the display back to macOS gets their `⌘` selection back, consistent with session-scoped view state.
**Rejected**: Resetting `mapTier` on display change — loses the selection on a round-trip for no benefit.
*Introduced by*: 260801-r8j2-shortcuts-map-modifier-picker

## Tasks

### Phase 1: Core Implementation

- [x] T001 Replace the dual-map state with the picker model in `app/frontend/src/components/shortcuts-overlay.tsx`: add `mapTier` state (`"shifted" | "cmd"`, default `"shifted"`, NOT reset on close), derive `activeMapTier` (`displayPlatform === "mac" ? mapTier : "shifted"`), collapse the `keyStates`/`cmdKeyStates` memos into one `tierKeyStates(activeMapTier)` memo, and delete the second grid + its header/captions <!-- R1 -->
- [x] T002 Rework the map header in `shortcuts-overlay.tsx`: "Holding" + segmented `⇧ ⌘`|`⌘` picker (mac display; `role="group"` `aria-label="Keyboard map modifier"`, `aria-pressed` per segment, the platform-toggle visual idiom) / static "Holding **Shift Ctrl**" (Win·Linux display); keep the plain-Ctrl note and the fold toggle in the same header row <!-- R1, R3 -->
- [x] T003 Update the legend's claimed entry in `shortcuts-overlay.tsx` to `claimed — taken by the OS / browser / app menu (the desktop app frees the browser ones)` (one line) <!-- R3 -->
- [x] T004 Add the `desktop` badge + other-host chord hint to `bindingRow` in `shortcuts-overlay.tsx`: gate `host.platform === "mac" && b.isDefault && b.macTier != null && b.macShellOnly === true`; other-host chord via `defaultComboFor(DEFAULT_BINDINGS-def, { platform: "mac", shell: !host.shell })`; hint copy "in browser: {chord}" (shell host) / "in desktop app: {chord}" (browser host); pill in the ScopeBadge/reserved-pill idiom <!-- R2 -->
- [x] T005 Update the component doc comment in `shortcuts-overlay.tsx` (single map + modifier picker, per-row desktop badges, new legend) <!-- R3 -->

### Phase 2: Tests

- [x] T006 Update the three existing unit tests in `app/frontend/src/components/shortcuts-overlay.test.tsx` that assert old chrome: the page-tier-map test (→ picker availability + layer swap), the filter test's `/run-kit tier —/` assertions (→ the "Holding" header), the collapse-map test's legend assertion (→ new legend line) <!-- R4 -->
- [x] T007 Add new unit tests in `shortcuts-overlay.test.tsx`: default `⇧⌘` selection (`aria-pressed`), `⌘` option absent on the Win·Linux display and the layer falling back to shifted when the display switches away from macOS, badge + hint on the trio rows on a spoofed mac host (browser: "in desktop app: ⌘N"; shell via `window.runkitShell`: "in browser: ⇧⌘N"), badge absence on host-invariant rows / on the default jsdom host / when the trio combo is overridden <!-- R4, R2 -->
- [x] T008 Update `app/frontend/tests/e2e/shortcut-registry.spec.ts` (~line 273): the spoofed-mac overlay test asserts the `⌘` picker option renders and selecting it renders the ⌘ layer (e.g. the `address bar` claimed cell) instead of `/page tier —/`; update the matching section of `shortcut-registry.spec.md` in the same commit <!-- R4 -->

### Phase 3: Verification Gates

- [x] T009 Run `cd app/frontend && npx tsc --noEmit` and the Vitest suite (`just test-frontend`); fix failures <!-- R4 -->
- [x] T010 Run `just pw test shortcut-registry` (check `lsof -i :3020` first if it misbehaves); fix failures <!-- R4 -->

## Execution Order

- T001 blocks T002 (header consumes the picker state); T003–T005 are independent of each other after T001.
- Phase 2 depends on Phase 1; T006/T007/T008 are mutually independent [P]-equivalent but share files (T006/T007 same file — run sequentially).

## Acceptance

### Functional Completeness

- [x] A-001 R1: The overlay renders exactly one keyboard grid; the map header carries the modifier picker with `⌘` offered only on the macOS display, `⇧⌘` selected by default — verified `shortcuts-overlay.tsx:831-839` (single `KEY_ROWS` render), picker `:797-820` gated on `displayPlatform === "mac"`, `mapTier` defaults `"shifted"` (`:269`)
- [x] A-002 R2: On mac hosts, exactly the `create-session`/`create-window`/`kill-window` rows (at their host defaults) carry a `desktop` badge + other-host chord hint; no other row does — gate at `:598-605` (`host.platform === "mac" && b.isDefault && b.macTier != null && b.macShellOnly === true`); the trio is the only `macTier`+`macShellOnly` set in `DEFAULT_BINDINGS`. Unit tests assert exactly 3 badges on both mac host flavors
- [x] A-003 R3: No "tier" wording remains in overlay chrome; the freed-by-shell captions are gone; the legend's claimed entry carries the one-line explanation; the plain-Ctrl note remains — repo grep for `page tier|run-kit tier|freed by the desktop shell|browser keys stay claimed` returns no hits in `src/`/`tests/`; legend `:843`, plain-Ctrl note `:821`. (Two stale *internal comments* still say "tier maps" — `:41`, `:781` — non-chrome; see should-fix)

### Behavioral Correctness

- [x] A-004 R1: Selecting `⌘` on the macOS display swaps the single grid's key states to the `cmd` tier map (claims + bound cells change accordingly); switching the display to Win·Linux falls back to the `⇧⌘` layer — `activeMapTier` derivation `:383`, memo dep added `:387`; unit test asserts `address bar` appears / `incognito` disappears on layer swap and reverses on display switch. E2E covers the same on a spoofed mac host
- [x] A-005 R1: The fold toggle, auto-hide-while-filtering, and the jump-nav "key map" chip anchor behave exactly as before the change — `{!filtering && …}` wrapper (`:785`) and `sectionRefs.current.map` anchor (`:787-789`) untouched by the diff; the collapse-map and filter unit tests pass with only their assertion *strings* updated
- [x] A-006 R2: The badge/hint gate on the physical host and `isDefault` — a win/linux host, an overridden combo, or an unbound row renders no badge — dedicated unit test covers the default jsdom (win/linux) host with the display toggled to macOS (still no badge, proving the physical-host gate) plus an override on `create-window` collapsing that row's badge while the other two survive

### Removal Verification

- [x] A-007 R1: The second (`page tier`) map block, its header, and both captions are deleted from `shortcuts-overlay.tsx` — no dead `cmdKeyStates` code remains — grep confirms `cmdKeyStates` and `tierName` are fully gone from `src/` and `tests/`; the retired `tierName` const (previously `:487`) was removed with the block

### Scenario Coverage

- [x] A-008 R4: Unit tests cover picker availability/default/layer-swap/display-fallback, badge + hint presence and absence, and the new legend line; the three stale assertions are updated — all three stale tests rewritten; 4 new cases added (layer survives close/reopen, mac-browser trio, mac-shell trio, absence cases). Full Vitest suite green: 118 files / 2129 tests
- [x] A-009 R4: The e2e spoofed-mac test asserts the picker (⌘ option present, ⌘ layer renders on selection) and `shortcut-registry.spec.md` matches the spec body — `shortcut-registry.spec.ts:263-285` updated; the companion's matching section rewritten to a 5-step list mirroring the new body (Constitution: Test Companion Docs satisfied). `just test-e2e shortcut-registry` → 12 passed

### Edge Cases & Error Handling

- [x] A-010 R2: A macro row (never carrying `macTier`) and the unbound/reserved row states render without badge interference — the badge cluster coexists with the amber "browser" pill on mac-browser trio rows — macro rows fail `b.macTier != null` (macros are built by `macroToBinding` with no `macTier`); unbound rows fail `b.isDefault` (`resolveBindings` returns `isDefault: false` for both `null`-override and keyless paths). The mac-browser test asserts 3 `desktop` badges AND 3 `browser` pills on the same rows

### Code Quality

- [x] A-011 Pattern consistency: New chrome follows the overlay's existing idioms (segmented control = platform-toggle idiom, pill = ScopeBadge/reserved idiom, session-scoped view state = `mapFolded` precedent) — picker (`:800-816`) mirrors the platform toggle's `flex border border-border rounded overflow-hidden` + `role="group"` + `bg-accent/20` selected treatment and additionally adds `aria-pressed` (which the older toggle lacks — an improvement, not a divergence); `desktop` pill (`:622-627`) matches the reserved-pill class string exactly; `mapTier` sits beside `mapFolded` and is excluded from the on-close reset effect (`:282-291`), matching its documented precedent
- [x] A-012 No unnecessary duplication: layer states reuse `tierKeyStates`; the other-host chord reuses `defaultComboFor` — no new derivation logic in `lib/keybindings.ts` — `lib/keybindings.ts` is untouched by the diff (`git diff --name-only` lists 4 files, none of them the registry); the two `useMemo`s collapsed into one

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/frontend/src/components/shortcuts-overlay.tsx:41` — the sm6g doc paragraph still says "The tier maps (app tiers only …) are FOLDABLE", contradicting the r8j2 paragraph 11 lines below it that describes ONE grid; the plural-map sentence is now redundant with the new paragraph and should be folded into it
- `app/frontend/src/components/shortcuts-overlay.tsx:781` — the JSX section comment `{/* ── tier maps (app tiers only; foldable — 260801-sm6g) ── */}` names the retired dual-map structure; the section it labels is now a single map
- `app/frontend/src/lib/keybindings.ts:168` — the `ClaimedKey.tier` doc comment references "the mac ⌘ page tier", user-facing naming this change retired; the registry field itself stays (it is load-bearing), only the prose is stale. Out of this change's declared scope (registry untouched by design) — flagged for a future docs pass, not for this diff

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Legend copy says "the OS" instead of the intake draft's "macOS" — `claimed — taken by the OS / browser / app menu (the desktop app frees the browser ones)` — because the legend is shared with the Win·Linux display, where system claims are the copy/paste convention, not macOS | Intake assumption 8 grants explicit "final copy per legend space" latitude; one line kept | S:60 R:95 A:80 D:60 |
| 2 | Confident | The picker and the "Holding …" label are one merged header element; the Win·Linux display renders a static label (no one-option picker) | R1+R3 name the same header; a single-option segmented control is dead chrome | S:60 R:90 A:80 D:60 |
| 3 | Confident | Mac-browser hint copy is "in desktop app: ⌘X" (mirror of the shell host's "in browser: ⇧⌘X" from the intake) | Intake gives only the shell-side example; the mirror is the only symmetric reading | S:60 R:95 A:80 D:65 |
| 4 | Confident | Layer fallback is derived (`displayPlatform !== "mac"` ⇒ shifted) with `mapTier` preserved, so returning to the macOS display restores the ⌘ selection | Intake assumption 4 says the option "disappears" — derivation matches that without destroying session-scoped state | S:55 R:90 A:85 D:70 |
| 5 | Certain | The other-host chord derivation reads the base def from `DEFAULT_BINDINGS` (not the effective row) because `resolveBindings` overwrites `tier` with the effective tier | Verified in `resolveBindings` — `...def, code: combo.code, tier: combo.tier` | S:85 R:90 A:95 D:90 |

5 assumptions (1 certain, 4 confident, 0 tentative).

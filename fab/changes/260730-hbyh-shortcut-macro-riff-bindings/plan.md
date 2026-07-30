# Plan: Macro Shortcut Bindings over Riff Presets

**Change**: 260730-hbyh-shortcut-macro-riff-bindings
**Intake**: `intake.md`

## Requirements

### Frontend: Macro Model & Persistence (`lib/macros.ts`)

#### R1: Macro actions are data with riff-preset or palette targets — no shell strings
A new pure module `app/frontend/src/lib/macros.ts` SHALL own the macro model. A `MacroAction` carries `actionId` (`"macro:<slug>"`, slug derived from the label, uniquified with `-2`/`-3` suffixes), `kind: "macro"`, a user-provided `label`, and a `target` discriminated union: `{ type: "riff"; preset: string }` or `{ type: "palette"; paletteActionId: string }`. **The riff target carries NO `args` field in v1** — verified against `app/backend/api/riff.go`: the `POST /api/riff` body has no args seam and `task` replaces preset panes (`composePanes`), so per-macro dynamic args are not expressible without a backend extension; pane arguments are encoded inside the preset definition in `fab/project/config.yaml` (the committed-config trust boundary). Macro definitions SHALL persist to `localStorage["runkit-macros"]` as a JSON array with a tolerant parser (malformed JSON, non-array roots, and invalid entries degrade to dropped/empty — the `parseOverrides` posture) and try/catch storage wrappers. A pure `macroCommandPreview(target)` SHALL render the overlay preview string (`rk riff --preset discuss` / `palette: {paletteActionId}`).

- **GIVEN** `localStorage["runkit-macros"]` containing `[{"actionId":"macro:discuss","kind":"macro","label":"riff: discuss","target":{"type":"riff","preset":"discuss"}}, "garbage"]`
- **WHEN** macros are read
- **THEN** exactly the one valid MacroAction is returned and nothing throws

#### R2: The registry's reserved `kind` slot ships; keyless bindings resolve unbound
`app/frontend/src/lib/keybindings.ts` SHALL extend `BindingKind` to `"builtin" | "macro"` (filling g40a's reserved slot). A `macroToBinding(macro)` helper SHALL project a MacroAction into a `KeyBinding` (`kind: "macro"`, `scope: "global"`, `code: ""` — macros ship no default combo; their combo lives solely in the `runkit-keybindings` override diff map, per the intake's persistence decision). `resolveBindings` SHALL treat a default whose effective combo has an empty `code` as **unbound**: `enabled: false`, `disabledReason: "user"` (the same state a steal victim lands in, reusing the overlay's unbound affordance). An override combo makes the macro live exactly like a builtin override, including browser-reserved disabling and steal-with-warning interop in **both** directions (a builtin capture can unbind a macro; a macro capture can unbind a builtin).

- **GIVEN** a macro with no entry in `runkit-keybindings`
- **WHEN** bindings resolve
- **THEN** the macro's effective binding is disabled (`reason: "user"`) and matches no chord
- **AND** with an override `{ "macro:discuss": { "code": "KeyD", "tier": "shifted" } }` it matches ⇧CmdOrCtrl+D, and capturing ⇧CmdOrCtrl+D for `window-next` unbinds the macro (steal)

### Frontend: Reactive Macro Layer (hooks)

#### R3: `useMacros` + macro-aware `useKeybindings`
A new `app/frontend/src/hooks/use-macros.ts` SHALL expose `{ macros, addMacro(label, target) → actionId, removeMacro(actionId) }` with the same in-module pub/sub + native `storage`-event reactivity as `use-keybindings.ts`. `useKeybindings` SHALL become macro-aware: the effective `bindings`/`byAction` include macro-derived bindings (defaults = `DEFAULT_BINDINGS` ∪ `macros.map(macroToBinding)`), and `setBinding` computes steal detection against a fresh read of both stores so capturing a macro-owned combo unbinds the macro. Because macros ride the shared effective map, the terminal seam (`attachCustomKeyEventHandler`), palette hints (`withShortcutHints`), and the overlay tier-map (`custom` keycap state) all pick up macro bindings with **zero changes** to those consumers. Deleting a macro SHALL also drop its `runkit-keybindings` diff entry (no orphaned overrides).

- **GIVEN** a macro bound to ⇧CmdOrCtrl+G
- **WHEN** any component reads `useKeybindings().bindings`
- **THEN** the macro binding is present and enabled, the G keycap renders `custom` on the tier map, and a focused terminal refuses the chord (it bubbles to the dispatcher)

### Frontend: Overlay CUSTOM Section (`components/shortcuts-overlay.tsx`)

#### R4: Editable CUSTOM section — rows, add-binding flow, missing-preset error state
The shortcuts overlay SHALL render a `[ CUSTOM ]` section (after SHELL, per the reviewed g40a mock): one row per macro with the label, a monospace command-preview chip (`macroCommandPreview`), the combo button (click-to-rebind via the existing capture flow; an unbound macro shows the amber `unbound` button), and a delete (`✕`) affordance that removes the macro definition and its binding diff. A `+ bind a key to a palette action or riff preset…` row SHALL open an inline add flow: a searchable target list (riff presets — fetched via the existing `GET /api/riff/presets` seam — plus the mount's palette actions, macros excluded), a name input pre-filled from the picked target, and an Add that creates the macro then immediately arms key capture on the new row. When the fetched preset list is known and a macro's riff preset is absent from it, the row SHALL render a `missing preset` error badge (no silent fallback). The add-flow's target data arrives via new optional props (`paletteTargets`, `riffPresetNames`); a mount that passes none (the board route in v1) renders the CUSTOM rows read/rebind/delete-only with no add row.

- **GIVEN** the overlay open on a terminal route with presets `["discuss"]` fetched
- **WHEN** the user clicks the add row, picks `riff: discuss`, keeps the name, clicks Add, and presses ⇧CmdOrCtrl+D
- **THEN** `runkit-macros` contains the macro, `runkit-keybindings` contains its combo diff, and the row shows the combo + preview `rk riff --preset discuss`
- **AND** a stored macro targeting preset `gone` renders the `missing preset` badge

### Frontend: Execution Path & Palette Exposure (`app.tsx`)

#### R5: Macro chords execute through existing seams only — no new backend surface
AppShell's `keybindingHandlers` SHALL merge a handler per macro. `{ type: "palette" }` targets resolve the palette action body by id at dispatch time (the g40a `fromPalette` convention; ids starting with `macro:` are never resolved as targets — no macro→macro recursion) — an absent palette action means no handler, so the chord falls through untouched. `{ type: "riff" }` targets are gated on a current session and call the existing `spawnRiff(server, session, { preset })` client (`POST /api/riff`) exactly as the spawn-agent dialog does: on success an info toast surfaces and, when `windowId` is truthy, the app navigates to the spawned window via `navigateToWindow`; on failure (including a 400 for a preset no longer in fabconfig) the error message surfaces as an error toast. No new endpoint, no new exec surface, no fire-and-forget. The board route mounts no macro handlers in v1 (chords fall through there, matching the handler-presence gating convention).

- **GIVEN** a macro `{ type: "riff", preset: "discuss" }` bound to ⇧CmdOrCtrl+D on a terminal route
- **WHEN** the chord is pressed
- **THEN** `POST /api/riff` receives `{ session, preset: "discuss" }` and on a 200 the app navigates to the returned window
- **AND** when the backend answers 400 (unknown preset) the error text appears as a toast and nothing navigates

#### R6: Macro actions are palette-reachable with effective-combo hints
Every macro SHALL also appear in AppShell's command palette as a kind-tagged entry `Macro: {label}` (id = the macro's `actionId`), executing the same path as its chord. Because `actionId` doubles as the palette id and macros ride `byAction`, `withShortcutHints` decorates macro entries with their effective combos automatically; unbound macros render no hint.

- **GIVEN** the macro above
- **WHEN** the palette is filtered to "Macro"
- **THEN** `Macro: riff: discuss` is listed with hint `Shift+Ctrl+D` (non-mac host) and selecting it POSTs the same spawn

### Frontend: Tests

#### R7: Unit + e2e coverage with `.spec.md` companion
Unit suites SHALL cover the macro model (parse tolerance, id uniquification, preview strings), keyless resolution + macro/builtin steal interop, `useMacros` reactivity, and the overlay CUSTOM section (rows, add flow, delete, missing-preset badge). A new mocked-backend Playwright spec `app/frontend/tests/e2e/macro-riff-bindings.spec.ts` (+ sibling `macro-riff-bindings.spec.md`, per the constitution) SHALL cover: add-macro → key capture → keypress → mocked `POST /api/riff` body assertion + navigation, the `Macro:` palette entry with hint, and the missing-preset error badge + 400-toast path. Route mocks carry trailing `*` globs (the `?server=` query).

- **GIVEN** `just test-e2e macro-riff-bindings`
- **WHEN** the spec runs against the mocked backend
- **THEN** all scenarios pass without touching real tmux/wt

### Non-Goals

- **No `args?: string[]` on riff targets in v1** — not expressible over the existing `POST /api/riff` (verified; see Assumption 1). A future backend `args` seam can extend the union without migration.
- **No preset-creation/editing UI** — presets are authored in `fab/project/config.yaml` (intake assumption 3, Constitution IV).
- **No backend changes** — the preset-list read seam (`GET /api/riff/presets`) already exists over HTTP.
- **No export/import of macros** — rides g40a's deferred override export.
- **No board-route macro execution or add-flow in v1** — the overlay's CUSTOM rows render there, chords fall through (handler-presence gating).
- **No macro→macro palette targets** — target lists exclude macros and execution never resolves `macro:` ids, precluding recursion.

### Design Decisions

#### Macro combos live in the keybindings diff map, not the macro definition
**Decision**: A macro definition (`runkit-macros`) carries no combo; its binding is an ordinary `runkit-keybindings` override entry keyed by the macro's actionId, and a macro without an entry resolves unbound (`disabledReason: "user"`).
**Why**: The intake mandates "their bindings in the existing runkit-keybindings diff map"; it also makes steal-with-warning, per-row reset, reserved-key disabling, palette hints, the tier map, and the terminal seam work on macros with the existing machinery — one binding store, one resolution path.
**Rejected**: Storing the combo inside the MacroAction (a second combo store that applyCapture/steal/reset could not see without parallel plumbing).
*Introduced by*: 260730-hbyh-shortcut-macro-riff-bindings

#### Keyless defaults (`code: ""`) instead of a macro-specific resolver
**Decision**: `resolveBindings` gains one rule — an effective combo with empty `code` resolves unbound — and macros enter resolution as ordinary defaults via `macroToBinding`.
**Why**: One resolver keeps every consumer (dispatch, hints, overlay, terminal seam, capture) macro-agnostic; builtins are unaffected (they always carry a code).
**Rejected**: A parallel `resolveMacroBindings` merged after the fact (duplicates the override/reserved/steal logic and forks the effective-map contract).
*Introduced by*: 260730-hbyh-shortcut-macro-riff-bindings

## Tasks

### Phase 1: Core model

- [x] T001 Create `app/frontend/src/lib/macros.ts`: `MacroTarget`/`MacroAction` types (riff target = `{preset}` only), `MACROS_STORAGE_KEY = "runkit-macros"`, tolerant `parseMacros`, `readStoredMacros`/`writeStoredMacros` (try/catch), `makeMacroActionId(label, existingIds)` (slug + `-2` uniquify), `macroToBinding(macro)` (kind `macro`, scope `global`, `code: ""`), `macroCommandPreview(target)` <!-- R1 R2 -->
- [x] T002 Extend `app/frontend/src/lib/keybindings.ts`: `BindingKind = "builtin" | "macro"`; `resolveBindings` resolves an empty-`code` effective combo as `enabled: false, isDefault: false, disabledReason: "user"` (builtins unaffected) <!-- R2 -->
- [x] T003 [P] Unit tests: new `app/frontend/src/lib/macros.test.ts` (parse tolerance, id uniquification, preview, `macroToBinding`); extend `app/frontend/src/lib/keybindings.test.ts` (keyless default unbound; override combo enables; browser-reserved macro combo disabled; steal both directions between macro and builtin) <!-- R1 R2 -->

### Phase 2: Reactive layer

- [x] T004 Create `app/frontend/src/hooks/use-macros.ts` (pub/sub + `storage` event, `addMacro`/`removeMacro`; `removeMacro` also drops the actionId's `runkit-keybindings` diff entry) with colocated `use-macros.test.ts` <!-- R3 -->
- [x] T005 Make `app/frontend/src/hooks/use-keybindings.ts` macro-aware: defaults = builtins ∪ `macroToBinding`; `setBinding` steal detection reads fresh macros; extend `use-keybindings.test.ts` (macro binding in effective map; capture steals from a macro) <!-- R3 -->

### Phase 3: UI + wiring

- [x] T006 Extend `app/frontend/src/components/shortcuts-overlay.tsx`: `[ CUSTOM ]` section (macro rows: preview chip, capture/unbound combo button, delete, missing-preset badge), `+ bind a key…` add flow (searchable riff-preset + palette-action target list, prefilled name, Add → arm capture), new optional `paletteTargets`/`riffPresetNames` props; extend `shortcuts-overlay.test.tsx` <!-- R4 -->
- [x] T007 Wire `app/frontend/src/app.tsx`: macro palette entries (`Macro: {label}`) folded into `paletteActions`, `executeMacro` (palette-body lookup excluding `macro:` ids; `spawnRiff` + toast + `navigateToWindow` for riff targets, session-gated), macro handlers merged into `keybindingHandlers`, best-effort `getRiffPresets` fetch while the overlay is open, overlay props passthrough <!-- R5 R6 -->

### Phase 4: E2E + verification

- [x] T008 Create `app/frontend/tests/e2e/macro-riff-bindings.spec.ts` + sibling `macro-riff-bindings.spec.md`: mocked `GET /api/riff/presets*` + `POST /api/riff*`; scenarios — overlay add-macro → capture → chord POSTs `{session, preset}` + navigates; `Macro:` palette entry with hint executes; seeded missing-preset macro shows the badge and the chord's 400 surfaces as a toast <!-- R7 -->
- [x] T009 Verification gates: `cd app/frontend && npx tsc --noEmit`; `just test-frontend`; `just test-e2e macro-riff-bindings` plus the adjacent `just test-e2e shortcut-registry` regression <!-- R1 R2 R3 R4 R5 R6 R7 -->

## Execution Order

- T001 → T002 → T003; T004/T005 after T001–T002; T006/T007 after T004–T005 (T006 and T007 touch disjoint files but T007 passes props T006 defines — implement T006 first); T008 after T007; T009 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `lib/macros.ts` exists and is pure; riff targets carry `{preset}` only; `runkit-macros` parsing tolerates malformed JSON/entries; ids are `macro:<slug>` and uniquified
- [x] A-002 R2: `BindingKind` includes `"macro"`; a keyless macro default resolves unbound (`disabledReason: "user"`) and an override combo makes it live, including reserved-key disabling
- [x] A-003 R3: `useMacros` is reactive (same-tab pub/sub + cross-tab `storage`); `useKeybindings` surfaces macro bindings in `bindings`/`byAction`; deleting a macro leaves no orphaned override diff
- [x] A-004 R4: The overlay renders the CUSTOM section with preview chips, rebind capture, unbound state, delete, the add-binding flow, and the missing-preset badge
- [x] A-005 R5: Macro chords execute palette targets in-place and riff targets via `POST /api/riff {session, preset}`; success toasts + navigates on truthy `windowId`; failure toasts; no new backend surface (zero `app/backend/` diff)
- [x] A-006 R6: Macros appear as `Macro: {label}` palette entries with effective-combo hints reflecting overrides; unbound macros show no hint

### Behavioral Correctness

- [x] A-007 R2 R3: Steal-with-warning works across kinds — capturing a macro-owned combo for a builtin unbinds the macro (and vice versa), flagged in the overlay until rebound/reset
- [x] A-008 R5: A chord for a macro whose preset no longer exists does nothing silently — the backend 400 surfaces as an error toast and no navigation occurs

### Scenario Coverage

- [x] A-009 R7: `macro-riff-bindings.spec.ts` covers add → capture → POST assertion + navigation, palette entry + hint, and the missing-preset badge + 400 toast, with an up-to-date `macro-riff-bindings.spec.md` companion
- [x] A-010 R1 R2 R3 R4: Unit suites cover the macro model, keyless resolution, cross-kind steal, `useMacros`, and the overlay CUSTOM section

### Edge Cases & Error Handling

- [x] A-011 R1 R3: Malformed `runkit-macros` (bad JSON, non-array, invalid entries) degrades without throwing; `reset all` unbinds macro combos but retains definitions (rows return to `unbound`) — parse tolerance is directly tested (`macros.test.ts`); the reset-all half is mechanically guaranteed (macro combos ARE ordinary diffs and `resetAll` writes `{}` without touching `runkit-macros`) but has no dedicated macro-scoped test (see Review notes)
- [x] A-012 R5: On the board route and on routes with no current session, macro chords fall through untouched (no handler); palette targets absent from the current mount likewise fall through — verified: `macroHandlers[id] = sessionName ? … : undefined` for riff targets, `fromPalette` returns `undefined` for unmounted palette targets, and `board-page.tsx` mounts no macro handlers

### Code Quality

- [x] A-013 Pattern consistency: pure lib + colocated tests (`palette-*.ts` convention); hooks mirror the `use-keybindings` pub/sub pattern; overlay reuses the existing capture flow, bracket headings, and theme tokens; no `as` casts where narrowing suffices — zero type assertions in the new code (`in`-narrowing throughout `isMacroTarget`/`isMacroAction`); one minor deviation: `visibleMacros`/`canAddMacro` are unmemoized while sibling derivations in the same file use `useMemo` (see Review notes)
- [x] A-014 No unnecessary duplication: reuses `spawnRiff`/`getRiffPresets` clients (no new wrappers), `applyCapture`/`resolveBindings` (no parallel macro resolver), and the `fromPalette` handler convention

### Security

- [x] A-015 R1 R5: Macro execution reaches process spawn only through the validated `POST /api/riff` preset path — no user-typed shell text is stored or transmitted; localStorage-sourced strings never reach an exec seam client-side — verified end-to-end: `MacroTarget` admits only `{preset}`/`{paletteActionId}` strings (`isMacroTarget` rejects any other shape, incl. a `{type:"shell",cmd}` blob — directly tested); the preset name is a **map-key lookup** against `fab/project/config.yaml`-defined presets (`riff.go:206-209`), so an attacker-controlled localStorage name never reaches argv — an unknown name is a `ValidationErr` → 400; zero `app/backend/` diff

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change fills g40a's deliberately-reserved `kind` slot and adds the executor behind it; it makes no existing symbol, branch, or file redundant. The one thing it *replaced* was already handled in-diff: the `BindingKind = "builtin"` reserved-slot comment in `lib/keybindings.ts:41-44` was rewritten rather than left stale.

Two **prose** claims are now false and belong to hydrate (documentation, not code deletion — listed so they are not lost):

- `docs/memory/run-kit/ui-patterns.md:1938` — "`kind` is `\"builtin\"`; `\"macro\"` is a reserved schema slot with no executor" — the slot now ships an executor.
- `docs/memory/run-kit/ui-patterns.md:1981` — "Export/import of overrides is not offered, and no macro rows render" — the CUSTOM section now renders macro rows (export/import is still deferred).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | v1 riff targets carry `{preset}` only — the intake schema's `args?: string[]` is dropped (resolves intake Tentative #4) | Verified against `api/riff.go`: the POST body has no `args` field and `task` replaces preset panes, so a passthrough needs a backend extension the intake rules out ("zero new process-execution surface"); both motivating examples work with args baked into the preset (committed-config trust boundary); reversible later as an additive union extension | S:70 R:75 A:90 D:80 |
| 2 | Certain | Macro combos are `runkit-keybindings` override entries; a macro without one resolves unbound via `disabledReason: "user"` | Intake states the diff-map decision verbatim; reusing the steal-victim state gives the overlay's unbound affordance for free | S:85 R:85 A:85 D:80 |
| 3 | Confident | Macro execution handlers + palette entries mount on AppShell only in v1; board-route chords fall through; the overlay's add flow renders only where target props are provided | Riff targets need a current session (the `Agent: Spawn` gating precedent); board palette actions are board-specific; matches g40a's handler-presence gating DD | S:55 R:85 A:80 D:70 |
| 4 | Confident | Riff-macro success = info toast + `navigateToWindow` when `windowId` is truthy; failure = error toast | Intake mandates "existing toast pattern; no fire-and-forget"; navigation mirrors the spawn dialog's `onSpawned` incl. its falsy-windowId guard | S:60 R:90 A:85 D:75 |
| 5 | Confident | Palette label prefix `Macro: {label}`, id = macro actionId | The `Family: name` palette convention; actionId-doubles-as-palette-id is the g40a join contract | S:50 R:95 A:80 D:75 |
| 6 | Confident | Missing-preset detection = best-effort `GET /api/riff/presets` while the overlay is open (badge only when the list is known); execution-time 400 toasts | The read seam already exists; a failed fetch means unknown, and the POST validates authoritatively either way — never silent | S:70 R:85 A:80 D:75 |
| 7 | Certain | actionId scheme `macro:<label-slug>` with `-2`/`-3` collision suffixes | Intake specifies `"macro:<user-slug>"`; suffixing mirrors riff's own `resolveWindowName` convention | S:75 R:90 A:90 D:85 |
| 8 | Confident | `reset all` clears macro combos (definitions retained, rows return to unbound); deleting a macro removes its diff entry | Combos ARE overrides (Assumption 2), so reset-all semantics follow; orphaned diffs would leak storage and confuse steal detection | S:45 R:90 A:75 D:65 |

8 assumptions (2 certain, 6 confident, 0 tentative).

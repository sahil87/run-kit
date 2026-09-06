# Intake: Dialog & Input Unification

**Change**: 260906-3i9e-dialog-input-unification
**Created**: 2026-09-06

## Origin

Operator dispatch — Slice 6 of the control-vocabulary retrofit, seeded from `fab/plans/sahil/26-09-06-control-retrofit-slices.md` (drafted against `ad1ade24`; slices 1–5 shipped as PRs #845, #847, #850, #851). One-shot dispatch: the intake seed plus the plan's Standing context block carry every decision — this slice consumes the shipped vocabulary, it does not re-derive it. `change_type` pinned to `fix` explicitly (inferred types flip at refresh seams).

> Dialogs join the coarse contract and text inputs get one focus treatment — the slice that removes the last control-layer blue.

Contract of record: `docs/wiki/control-state-audit.html` (evidence + §9 migration order) · `docs/wiki/control-contract-preview.html` (settled 2026-09-05: scheme C — neutral interaction, **green = state**, 40px coarse floor). Post-change truth lives in `docs/memory/run-kit/ui/visual-design.md`.

## Why

Slices 1–5 unified the top bar, bottom bar, menus/popovers, and sidebar onto the control contract (neutral hover, green = state, 40px coarse floor, shared `controls.ts` arms). Dialogs and text inputs are the last user-visible surfaces outside it:

1. **Dialogs have zero `coarse:` uses** — every dialog button and input renders at fine-pointer sizes on touch devices, below the 40px floor the rest of the app now guarantees. Dialogs are exactly the surfaces where a mistap is most expensive (Kill confirms).
2. **Input focus is three different colors** — `focus:border-accent` (blue: compose strip, host-form dialog, shortcuts-panel inputs), `focus:border-text-secondary` (find-bar, iframe URL bar, settings text fields, pin-popover, theme-picker search), and `border-accent-green/60` (operator omnibox active border) — plus ~17 inputs with naked `outline-none` and **no** focus treatment at all (palette input, inline renames, dialog fields, note prompts). The keyboard user gets an inconsistent or absent "you are typing here" signal.
3. **The kill-confirm recipe is re-typed and drifted** — `sidebar/kill-dialog.tsx` and `board/board-page.tsx` hand-roll the same Cancel/Kill pair (the sidebar copy has `text-sm`, the board copy doesn't) on raw `red-900`, while the flyout danger rows already use the `signal-red` token.
4. **Blue's retirement is one slice from done** — per the settled color algebra (hover = brightness · green = state · signal hues = status), blue survives only where a slice retires it. This is that slice for the control layer; leaving it half-done leaves two competing interaction hues indefinitely.

If skipped: the retrofit's user-visible goal (one vocabulary everywhere) fails exactly at the highest-stakes surfaces (destructive confirms) and the most-touched ones (text inputs).

## What Changes

All frontend, under `app/frontend/src/components/` (+ `board/`, `sidebar/` subdirs) and `app/frontend/src/globals.css` / `components/controls.ts` at the edges.

### 1. Dialogs adopt `coarse:`

Today zero `coarse:` uses in any dialog. Sites: kill-dialog (`src/components/sidebar/kill-dialog.tsx`), the board kill trio (`src/components/board/board-page.tsx:1122-1141` — Unpin instead / Kill / Cancel), spawn-agent-dialog, create-session-dialog, server-dialogs, host-form-dialog, session-name-prompt, window-note-prompt, operator-compose-dialog.

- **Buttons** → the wide-button recipe: 28px fine / `coarse:min-h-[40px]` coarse (the shared 40px floor; keep the lockstep comment naming the `--ctl-h-bar`/`--ctl-h-bar-coarse` tokens).
- **Inputs** → `coarse:min-h-[40px]` min-height.

### 2. Kill-dialog dedup → shared confirm pair in `controls.ts`

`sidebar/kill-dialog.tsx:32,38` (Cancel: `flex-1 text-sm py-1.5 border border-border rounded hover:border-text-secondary`; Kill: `flex-1 text-sm py-1.5 bg-red-900/30 border border-red-900 rounded hover:bg-red-900/50`) and `board/board-page.tsx:1125-1137` (same pair minus `text-sm`, plus "Unpin instead" on the neutral arm) are one re-typed recipe that already drifted. Extract a shared confirm-button pair into `components/controls.ts` — a neutral arm and a **danger arm on `signal-red`** (not raw `red-900`; the flyout danger rows already use `signal-red` — align). Consume at both sites (board's "Unpin instead" and "Cancel" take the neutral arm). Server-dialogs' red kill button (`server-dialogs.tsx:332`, same `red-900` recipe) joins the danger arm. The pair carries the coarse floor from §1.

### 3. Input focus → one idiom (green)

`focus:border-accent` is replaced by ONE live-input treatment: **`focus:border-accent-green`** (decided at intake per the color algebra — interaction typing focus is the keyboard's analogue of the green state family; scheme C, recorded as a Certain assumption below).

- Migrate the three existing colors to it: `focus:border-accent` (compose-strip:1011 + focus-within:1274, host-form-dialog:113/:126, settings-shortcuts-panel:706/:973/:1003), `focus:border-text-secondary` (text-setting-core:63, iframe-window:1469, find-bar:78, settings-all-panel:136/:404, theme-picker-list:257, pin-popover:227), and the omnibox's `border-accent-green/60` active border (operator-omnibox:149 — normalizes onto the same treatment).
- Give the ~17 naked `outline-none` inputs the same treatment: palette input (command-palette), inline renames (top-bar window heading edit at `top-bar.tsx:2044` — its `border-b border-accent` edit border goes green — plus sidebar session/window row renames), dialog fields (spawn-agent, create-session, server-dialogs, session-name-prompt, window-note-prompt, operator-compose), omnibox, note prompts. Sweep the full `outline-none` file list; text INPUTS get the border treatment (buttons/rows are covered by the global ring and are out of scope here).
- Pin-popover's stray `focus:` idiom joins the same treatment.
- **Inputs stay excluded from the global focus RING** — the slice-1 decision stands: border is the input idiom; `input`/`textarea`/`select` remain outside the unlayered `:focus-visible` ring selector.

### 4. Disabled sweep

Remaining `opacity-50`/`60` stragglers on dialog/panel **buttons** → the unified `opacity-40 + cursor-not-allowed + hover-neutralized` recipe (shipped in earlier slices). Verified sites include host-form-dialog:145, session-name-prompt:75, server-dialogs:196/:332, operator-compose-dialog:113, and the dialog-family buttons surfaced by the sweep. `window-note-prompt.tsx:47` **gains its missing disabled state** (its session-name twin at session-name-prompt.tsx:75 has one — adopt the twin's recipe; the disable condition follows the note prompt's own semantics, where empty input is a valid "clear" submit). Disabled treatment on *inputs* (`disabled:opacity-50` on text fields) aligns to the same opacity value. Non-dialog stragglers (top-bar segments, iframe toolbar) are touched only where they're already in scope of §1–3 edits — this is not a whole-app opacity sweep.

### 5. Acceptance grep — blue retired from the control layer

After this slice, `grep -rn "accent[^-]" src/components` over **control styling** should hit nothing: no interactive control (button, input, edit border, focus/focus-within border, selection fill) carries `accent` blue. Exempt by design: links and toast action links, status-bar clickability hover-reveals on text values, data-viz/status semantics, and the shortcuts-panel `bg-accent` modified-dot **if** the audit classifies it as status (the contract of record, `docs/wiki/control-state-audit.html`, is the classifier for any ambiguous hit). Any hit the audit classifies as control styling must be migrated or the slice is incomplete.

### Verification

`npx tsc --noEmit` + affected unit suites + scoped e2e only (full suite is never a gate — standing directive 2026-09-03). Known trap: dialogs' e2e coverage is thin; **unit tests assert some dialog classes — sweep both** `*.test.tsx` and `tests/e2e/*.spec.ts` for class assertions on the touched surfaces. The palette input is autofocused — verify the green border treatment doesn't flash on palette open. Tests conform to the spec (constitution Test Integrity); intent comments updated in the same edit; no change-ID citations in code comments.

### Standing context (the shipped vocabulary this slice consumes — do not re-derive, follow)

- **Tokens**: `--ctl-*` custom properties in `globals.css` `:root`; TS constants keep Tailwind literals with lockstep comments (the `COARSE_POINTER_QUERY` convention).
- **Shared arms** in `app/frontend/src/components/controls.ts`: `TOP_BAR_*`, `MENU_ROW_*`, `POPOVER_ROW_CLASS`, `LATCHED_ARM`, `LATCHED_ARM_RINGED`; `KBD_BASE`/`KBD_REST`/`KBD_CLASS` in `kbd-chip.ts`; `FN_ITEM_BASE`/`FN_ITEM_CLASS` in `bottom-bar.tsx`.
- **REST-swap rule** (load-bearing, proven on #845's review cycles): a latched/selected arm replaces the hover-carrying rest classes — never stacks on them (specificity ties resolve by compiled source order).
- **Global rules** (already shipped, do not duplicate per-site): unlayered `:focus-visible` green ring, `:active` pressed fill, long-press select guard, hue-free glint.
- **Color algebra**: hover = brightness only · green = state (latch/armed/open/checked) · signal hues = status · blue survives ONLY where a slice below retires it.
- **Coarse floor**: 40px (38 for inset segments). Fine sizes unchanged.

### Non-Goals

- The `Control` primitive + gallery route (slice 7, `control-primitive-gallery`).
- Menus/popovers and sidebar rows (slices 4–5, shipped).
- A whole-app opacity/disabled sweep beyond the dialog/panel-button scope above.
- Any behavior change — this is styling vocabulary only; handlers, focus management, and dialog logic are untouched.

## Affected Memory

- `run-kit/ui/visual-design`: (modify) Input live-focus idiom (three colors → `focus:border-accent-green`; inputs stay excluded from the global ring), new shared confirm-button pair constants in `controls.ts` (neutral + `signal-red` danger arms), unified disabled recipe on dialog buttons, blue fully retired from the control layer (accent's remaining non-state uses shrink to links/hover-reveals).
- `run-kit/ui/dialogs-and-state`: (modify) Dialog conventions gain the coarse contract (wide-button 28/40, input 40px coarse min-height) and the shared confirm pair; kill-confirm recipe now a `controls.ts` constant consumed by sidebar + board + server dialogs.
- `run-kit/ui/operator-console`: (modify) Omnibox/console input focus border joins the one live-input treatment (only if its section states the old border — verify at hydrate).

## Impact

- **Code**: ~15–20 files under `app/frontend/src/components/` (dialogs, prompts, inputs, `controls.ts`, possibly `globals.css` if a `--ctl-*` token is added for the confirm pair). Zero backend impact.
- **Tests**: unit tests asserting dialog/input classes (`*.test.tsx` colocated) and any e2e specs asserting the touched surfaces' classes or colors; scoped e2e per changed surface. Intent comments updated in-edit.
- **Risk surface**: palette input autofocus flash; e2e specs with class/color assertions on dialogs (coverage is thin — sweep, don't assume); the standing-row substring-collision rule applies to any new palette rows (none expected).
- **Dependencies**: none — slices 4–5 are merged; this branch is off fresh `origin/main` (455dac04).

## Open Questions

None — the operator plan and the settled contract (scheme C, 2026-09-05) carry every decision.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Live-input focus treatment is `focus:border-accent-green` (green family), replacing all three current colors | Plan directs "decide green at intake per the color algebra (interaction = keyboard's hover = green family)" citing scheme C, the settled contract of record | S:90 R:85 A:95 D:90 |
| 2 | Certain | Inputs stay excluded from the global `:focus-visible` ring — border is the input idiom | Slice-1 decision explicitly stands per the seed; documented in visual-design.md § Global Control-State Rules | S:95 R:85 A:95 D:95 |
| 3 | Certain | Shared confirm pair lives in `controls.ts` with the danger arm on `signal-red`, not raw `red-900` | Seed states it verbatim; flyout danger rows already use `signal-red`, so this aligns to shipped vocabulary | S:90 R:85 A:90 D:90 |
| 4 | Certain | Coarse floors: dialog buttons 28 fine / 40 coarse (wide-button recipe), dialog inputs 40px coarse min-height | Standing context fixes 40px as the coarse floor; seed gives the exact pair | S:90 R:85 A:95 D:90 |
| 5 | Confident | Unified disabled recipe is `opacity-40 + cursor-not-allowed + hover-neutralized`; hover-neutralized spelled per the shipped recipe from earlier slices (grep the existing `opacity-40` sites and match) | Seed names the target; exact hover-neutralization spelling is read off shipped sites rather than re-derived | S:80 R:85 A:80 D:75 |
| 6 | Confident | The seed's third focus color `accent-green/60` is the operator-omnibox active border (`operator-omnibox.tsx:149`); it normalizes onto the one treatment (full `accent-green`, focus-driven) | Verified: the only non-test `accent-green/60` input-border site; shortcuts-panel `/60` hits are hover outlines on binding chips, not input focus | S:75 R:80 A:80 D:70 |
| 7 | Confident | Acceptance-grep scope: "control styling" = interactive controls (buttons, inputs, edit/focus borders, selection fills); links, toast links, status-bar text hover-reveals, and status/data-viz hues are exempt; `docs/wiki/control-state-audit.html` classifies any ambiguous hit | Seed says "data-viz/status semantics unaffected"; the audit is the named contract of record for evidence-level classification | S:75 R:80 A:75 D:70 |
| 8 | Confident | `window-note-prompt.tsx:47` adopts its session-name twin's disabled recipe; the disable condition follows note-prompt semantics (empty = valid clear-submit, so disable only where the twin's pattern maps, e.g. in-flight submit) | Seed names the twin as the pattern; the note prompt's empty-means-clear contract is verified in code | S:70 R:85 A:75 D:70 |
| 9 | Confident | Non-dialog `opacity-50/60` stragglers (top-bar segments, iframe toolbar) are out of scope unless already touched by §1–3 edits | Seed scopes the sweep to "dialog/panel buttons"; a whole-app sweep would widen the slice against the ladder's sequencing | S:70 R:85 A:80 D:75 |

9 assumptions (4 certain, 5 confident, 0 tentative, 0 unresolved).

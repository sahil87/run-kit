# Intake: Control Primitive + Gallery

**Change**: 260906-6x7w-control-primitive-gallery
**Created**: 2026-09-06

## Origin

Operator dispatch (one-shot) executing Slice 7 — the final slice — of the control-vocabulary retrofit ladder, from `fab/plans/sahil/26-09-06-control-retrofit-slices.md`. Slices 1–3 shipped as PRs #845/#847; slices 4–6 shipped as PRs #850 (menu/popover unification, td2p), #851 (sidebar strays, xjex), #852 (dialog/input unification, 3i9e). After slice 6 the user-visible retrofit is complete; this slice is structural only.

> Fold the proven recipes into one `Control` component family and ship the standing regression guard. Structural only — zero visual change is itself the acceptance bar.
>
> 1. **`Control` primitive** (`components/control.tsx`): variants `icon | chip | toggle | segment | menu-row | wide | confirm` × sizes `bar | chip | row`, states derived from props (`pressed`, `open`, `disabled`, `danger`) composing the BASE/REST/LATCHED arms internally. Constants in `controls.ts`/`kbd-chip.ts` become its implementation detail; call sites migrate surface-by-surface within the slice (top bar → bottom bar/compose → menus → sidebar → dialogs), each group verified by its unit suite before the next.
> 2. **Gallery route** (dev-only, e.g. `/__controls`, excluded from prod build or gated on `import.meta.env.DEV`): the full variant × state matrix rendered from the REAL primitive with forced-state props; a Playwright spec screenshots it per pointer class (fine/coarse) as the drift guard. Respect Constitution IV: this is a dev surface, not a product page — gate it hard.
> 3. **Deletion-candidate finale**: with call sites on the primitive, remove the now-dead per-site recipes and the redundant utilities accumulated in earlier slices' Deletion Candidates sections (each archived change's `plan.md` lists them).
> 4. **Acceptance bar**: pixel-parity on the gallery screenshots against pre-migration captures of the same states; no rendered-class diffs beyond the mechanical substitution; all affected suites green.

The dispatch pinned `change_type: refactor` explicitly (inferred types flip at refresh seams).

**Contract of record** (settled 2026-09-05, do not re-derive): `docs/wiki/control-state-audit.html` (evidence + §9 migration order), `docs/wiki/control-contract-preview.html` (scheme C — neutral interaction, green = state, 40px coarse floor). Post-change truth lives in `docs/memory/run-kit/ui/visual-design.md`.

## Why

Slices 1–6 unified the control **vocabulary** — one green latch arm, one menu-row scale, one popover shell, one switch track, one confirm pair, one input-focus idiom, coarse floors everywhere — but the vocabulary still lives as ~20 exported className constants (`controls.ts`, `kbd-chip.ts`, module-local `FN_ITEM_*` in `bottom-bar.tsx`) that every call site must compose correctly by hand. Two failure modes remain open:

1. **Composition drift**: the REST-swap rule (a latched arm replaces the hover-carrying rest classes, never stacks on them — specificity ties resolve by compiled source order) is a convention enforced only by review. Slice 4–6 review cycles repeatedly caught call sites stacking arms or re-typing a subset of a constant. A `Control` component that derives its classes from props (`pressed`, `open`, `disabled`, `danger`) makes the REST-swap structural — a call site *cannot* stack arms it never composes.
2. **No regression guard**: nothing today detects visual drift in the control vocabulary. A future change can quietly break a coarse floor or a latch fill and no suite fails. A dev-only gallery rendering the full variant × state matrix from the real primitive, screenshotted per pointer class by a standing Playwright spec, turns any rendered-pixel drift into a test failure.

If we don't do this, the retrofit's guarantees decay one PR at a time — the exact drift the audit documented (four popover shells, three input focus colors, two confirm-button spellings) re-accumulates. The alternative (keep constants, add lint rules) was not pursued: lint can't see rendered composition, and the constants' consumers are exactly the surface-by-surface list below, so a one-slice migration is tractable now and only gets more expensive later.

## What Changes

### 1. `Control` primitive (`app/frontend/src/components/control.tsx`, new)

One component family expressing the shipped vocabulary:

- **Variants**: `icon | chip | toggle | segment | menu-row | wide | confirm` — mapping to today's recipes: `icon` = `TOP_BAR_BUTTON*` fixed squares (28/40), `chip` = `KBD_BASE/KBD_REST/KBD_CLASS` kbd chips + `FN_ITEM_*` bottom-bar items (33×35 fine / 40 coarse), `toggle` = latching buttons (`LATCHED_ARM` / `LATCHED_ARM_RINGED` on-state), `segment` = inset segments inside bordered chip wrappers (`TOP_BAR_SEGMENT_H`, 26/38 — the 2px-wrapper-border inset), `menu-row` = `MENU_ROW_*` family (28/40 floors, checked = `MENU_ROW_CHECKED` + green ✓), `wide` = `WIDE_BTN_BASE` dialog buttons (28/40 min-h), `confirm` = the `CONFIRM_NEUTRAL`/`CONFIRM_DANGER` pair (danger on `signal-red`).
- **Sizes**: `bar | chip | row` — the three height axes (`--ctl-h-bar` 28/40, `--ctl-chip-h/w` 33×35/40, menu-row floors).
- **States from props**: `pressed` (latch → the green arm, `aria-pressed`), `open` (open-latch idiom for menu/popover triggers, `aria-expanded` at call site), `disabled` (the unified `opacity-40 + cursor-not-allowed + hover-neutralized` recipe), `danger` (the `signal-red` confirm arm). State composition implements the **REST-swap rule internally**: the component emits `BASE + (state-arm | REST)`, never both — call sites can no longer stack arms.
- **Constants become implementation detail**: `controls.ts` / `kbd-chip.ts` constants move behind the primitive (internal or re-exported only where a non-migrating consumer remains — see Non-Goals). The `--ctl-*` custom properties in `globals.css` `:root` and the Tailwind-literal + lockstep-comment convention (`COARSE_POINTER_QUERY` style) are unchanged — the primitive keeps literal classes with the same lockstep comments.
- **Global rules stay global**: the unlayered `:focus-visible` green ring, `:active` pressed fill, long-press select guard, and hue-free glint remain in `globals.css` — the primitive does not duplicate them per-site (it composes `rk-glint` exactly where today's constants do).
- **Migration order (within this slice)**: top bar → bottom bar/compose → menus → sidebar → dialogs, each surface group verified by its unit suite before the next group starts.

### 2. Gallery route (dev-only)

- A route (e.g. `/__controls`) rendering the **full variant × state matrix from the real primitive** with forced-state props (rest/hover-n.a./pressed/open/disabled/danger per variant × size).
- **Hard-gated as a dev surface**: registered only when `import.meta.env.DEV` (or excluded from the prod bundle). Constitution IV's fixed route set is a product-surface rule; this is a dev harness, not a product page — the gate is what keeps it compliant. The prod build MUST NOT serve it.
- A Playwright spec screenshots the matrix **per pointer class** (fine and coarse — coarse via touch/pointer emulation) as the standing drift guard.
- **Baseline discipline**: the gallery + screenshot spec are built and captured **before** call-site migration (against the constants-composed rendering), so the pixel-parity acceptance comparison has a pre-migration baseline of the same states.

### 3. Deletion-candidate finale

With call sites on the primitive, remove:

- The now-dead per-site recipes (re-typed class strings the primitive replaces).
- The redundant utilities accumulated in the earlier slices' Deletion Candidates sections — enumerated in the archived plans: `fab/changes/archive/2026/09/260905-drcc-control-tokens-focus-glint/plan.md:167`, `260906-qqh1-latch-green-unification/plan.md:134`, `260906-td2p-menu-popover-unification/plan.md:137`, `260906-xjex-sidebar-control-strays/plan.md:138` (also `:40`), `260906-3i9e-dialog-input-unification/plan.md:170`. Plan generation reads these five sections and folds still-pending items into tasks.

### 4. Acceptance bar & verification

- **Pixel parity**: gallery screenshots after migration match the pre-migration captures of the same states (zero visual change is the acceptance bar).
- **No rendered-class diffs beyond the mechanical substitution** — unit suites that assert control classes are updated to assert via the primitive's output, conforming to the spec (constitution Test Integrity).
- **Per-surface gates**: `npx tsc --noEmit` + the touched surface's unit suites after each migration group; scoped e2e for touched surfaces only. Full e2e suite is never a gate (standing directive 2026-09-03); CI runs it sharded on the PR.
- Intent comments updated in the same edit; no change-ID citations in code comments.

### Non-Goals

- **No visual change** — zero pixel deltas, zero behavior deltas.
- **No new tokens, colors, or geometry** — the primitive expresses the shipped vocabulary; it does not extend it.
- Controls that genuinely don't fit the variant matrix (arrow-pad cells, swatch/marker-pad cells, switch tracks' per-site geometry) are out of the migration; their shared constants (`SWITCH_TRACK_*` etc.) stay exported where still consumed.
- The ship carries the previous slice's `fab/changes/archive/` bookkeeping move (3i9e archive already staged in this worktree).

## Affected Memory

- `run-kit/ui/visual-design`: (modify) Control constants section — the `MENU_ROW_*`/`TOP_BAR_*`/`LATCHED_ARM`/`WIDE_BTN`/`CONFIRM_*`/`INPUT_*` vocabulary becomes the `Control` primitive's implementation detail; document the primitive's variant × size × state API, the internalized REST-swap, and the gallery drift guard.
- `run-kit/ui/routes-and-shell`: (modify) note the dev-only `/__controls` gallery route and its DEV gate (Constitution IV posture).
- `run-kit/ui/top-bar`: (modify) control-cluster references to `TOP_BAR_BUTTON*` composition update to the primitive.
- `run-kit/ui/compose-and-bottom-bar`: (modify) `KBD_*`/`FN_ITEM_*` references update to the primitive.
- `run-kit/ui/sidebar`: (modify) migrated sidebar control references.
- `run-kit/ui/dialogs-and-state`: (modify) dialog button/confirm-pair references update to the primitive.

## Impact

- **Frontend only**: `app/frontend/src/components/` (new `control.tsx`; `controls.ts`, `kbd-chip.ts`, `bottom-bar.tsx`, `top-bar.tsx`, `top-bar-overflow-menu.tsx`, breadcrumb/split/open/layout popovers, sidebar files, dialog files — every consumer of the shared arms), a new dev-only route module, `app/frontend/tests/e2e/` (new gallery screenshot spec), and the unit suites asserting control classes across those surfaces.
- **Largest slice of the ladder** — widest file touch-count, though mechanically repetitive. The operator plan flags multi-cycle review as likely; rework budget is 3 cycles (code-review.md).
- Known trap surfaces (project memory): palette standing-row substring collisions (no new palette rows expected), `filter({ has })` needs page-rooted locators, row icon clusters need `.hover()` before icon clicks, e2e coarse emulation via the established pointer-class patterns.

## Open Questions

*(none — the intake seed and standing context carry the decisions; remaining choices are graded below)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `change_type` = `refactor`, pinned explicitly | Operator directive; structural-only slice; explicit source survives refresh seams | S:95 R:90 A:100 D:100 |
| 2 | Certain | Variant/size/state taxonomy exactly as seeded (`icon\|chip\|toggle\|segment\|menu-row\|wide\|confirm` × `bar\|chip\|row`; `pressed`/`open`/`disabled`/`danger`) | Given verbatim by the operator plan; maps 1:1 onto the shipped constants | S:90 R:70 A:90 D:90 |
| 3 | Certain | Consume the shipped vocabulary — REST-swap internalized, global rules stay in `globals.css`, `--ctl-*` lockstep convention unchanged, no new colors/geometry | Standing context block: "do not re-derive, follow"; contract of record settled 2026-09-05 | S:95 R:80 A:95 D:95 |
| 4 | Certain | Surface-by-surface migration order (top bar → bottom bar/compose → menus → sidebar → dialogs), each group unit-verified before the next | Given verbatim in the seed | S:90 R:85 A:90 D:90 |
| 5 | Confident | Gallery route at `/__controls`, registered only under `import.meta.env.DEV` (route absent from prod bundle) | Seed says "e.g. `/__controls`, excluded from prod build or gated on `import.meta.env.DEV`" — path is a suggestion, DEV-gating is the simpler of the two offered mechanisms and satisfies Constitution IV's hard gate | S:75 R:85 A:80 D:70 |
| 6 | Confident | Gallery + screenshot spec built and captured BEFORE call-site migration, so pre-migration baselines exist for the pixel-parity comparison | "pixel-parity … against pre-migration captures of the same states" implies capture-first sequencing; the only ordering that makes the acceptance bar checkable | S:70 R:80 A:80 D:75 |
| 7 | Confident | Screenshot drift-guard mechanics (baseline storage, `toHaveScreenshot` config, browser scope, CI interplay with the sharded suite) decided at plan from repo e2e conventions | Reversible test-infra choices with a clear front-runner (committed baselines, chromium-scoped); scoped-e2e directive bounds the blast radius | S:60 R:75 A:55 D:60 |
| 8 | Confident | Non-fitting controls (arrow-pad, swatch/marker cells, switch-track per-site geometry) stay off the primitive; their constants remain exported where consumed | Seed migrates "the proven recipes"; `SWITCH_TRACK_*` is color-only by design (geometry per-site) and the dense-picker cells are documented exceptions — forcing them into the matrix would extend the vocabulary, violating the zero-visual-change bar | S:65 R:70 A:70 D:60 |
| 9 | Certain | Verification = `npx tsc --noEmit` + affected unit suites + scoped e2e only; full suite never a gate | Standing directive 2026-09-03, restated in the seed | S:95 R:90 A:100 D:100 |
| 10 | Confident | Ship carries the staged 3i9e archive bookkeeping (already moved in this worktree) | Operator dispatch states it explicitly; established per-slice ladder convention | S:85 R:90 A:85 D:85 |

10 assumptions (5 certain, 5 confident, 0 tentative, 0 unresolved).

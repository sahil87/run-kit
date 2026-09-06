# Control Retrofit — Remaining Slices (4–7)

**Drafted**: 2026-09-06 · against `ad1ade24` · continuation of the control-vocabulary retrofit (slices 1–3 shipped as PR #845 and PR #847)
**Shape**: 4 changes, one repo (run-kit), strictly sequential — each slice starts from merged main
**Contract of record**: `docs/wiki/control-state-audit.html` (evidence + §9 migration order) · `docs/wiki/control-contract-preview.html` (settled 2026-09-05: scheme C — neutral interaction, **green = state**, 40px coarse floor) · post-change truth in `docs/memory/run-kit/ui/visual-design.md`

## Standing context (carry into every slice's intake)

The shipped vocabulary these slices consume — do not re-derive, follow:

- **Tokens**: `--ctl-*` custom properties in `globals.css` `:root`; TS constants keep Tailwind literals with lockstep comments (the `COARSE_POINTER_QUERY` convention).
- **Shared arms** in `app/frontend/src/components/controls.ts`: `TOP_BAR_*`, `MENU_ROW_*`, `POPOVER_ROW_CLASS`, `LATCHED_ARM`, `LATCHED_ARM_RINGED`; `KBD_BASE`/`KBD_REST`/`KBD_CLASS` in `kbd-chip.ts`; `FN_ITEM_BASE`/`FN_ITEM_CLASS` in `bottom-bar.tsx`.
- **REST-swap rule** (load-bearing, proven on #845's review cycles): a latched/selected arm replaces the hover-carrying rest classes — never stacks on them (specificity ties resolve by compiled source order).
- **Global rules** (already shipped, do not duplicate per-site): unlayered `:focus-visible` green ring, `:active` pressed fill, long-press select guard, hue-free glint.
- **Color algebra**: hover = brightness only · green = state (latch/armed/open/checked) · signal hues = status · blue survives ONLY where a slice below retires it.
- **Coarse floor**: 40px (38 for inset segments). Fine sizes unchanged.
- **Verification per slice**: `npx tsc --noEmit` + affected unit suites + scoped e2e only (full suite never a gate — standing directive 2026-09-03). Tests conform to the spec (constitution Test Integrity); intent comments updated in the same edit; no change-ID citations in code comments.

## Sequencing & merge topology

Strictly **sequential 4 → 5 → 6 → 7**, each as its own fab change + draft PR off fresh `origin/main`, merged manually on green CI (repo auto-merge is disabled). Slices 4–6 all touch `controls.ts`/`globals.css` at the edges, so parallel branches would conflict there; the ladder avoids it. Each slice's ship carries the previous change's `fab/changes/archive/` bookkeeping move.

After slice 6 the **user-visible** retrofit is complete; slice 7 is structural only.

---

## Slice 4 — menus & popovers (change slug: `menu-popover-unification`)

**Intake seed**: One menu system: a single row scale with a 40px coarse floor, one shared popover-shell recipe, and one selected/checked vocabulary (green ✓ / green tint — retiring `MENU_ROW_ACTIVE`'s inverse video and the last selection blues).

Sites (from the audit + slice-3 reviewer trackers):

1. **Row scales → one**: `MENU_ROW_*` (xs/px-2.5) is the survivor. Fold `POPOVER_ROW_CLASS` (11px/px-3) into it; `breadcrumb-dropdown.tsx` rows (sm/px-3, no constant) adopt it; the two hand-rolled version rows in `top-bar-overflow-menu.tsx` (~:543, ~:577) import instead of re-typing. All menu rows get `coarse:min-h-[40px]` (today: no touch floor).
2. **Selected/checked vocabulary → green**: `MENU_ROW_ACTIVE` inverse video (`bg-accent-green text-bg-primary`) → checked-row treatment (green ✓ trailing, `text-text-primary` row — the F▴/contract-preview idiom); LayoutChip popover's ✓ and the uncolored ✓s (autofit, fixed-width rows) align to the same green ✓; breadcrumb-dropdown `item.current` `text-accent` → the green checked treatment (this retires a deferred blue); `SurfaceToggleMenuRows` (`menuitemcheckbox` with NO checked affordance) gains the ✓.
3. **Popover shell**: one exported container recipe (`bg-bg-primary border border-border rounded-lg shadow-2xl py-1 z-50` + per-menu min/max-w) replacing the four ad-hoc versions (overflow menu, split/layout, open, breadcrumb); section labels unify on one padding (overflow's `px-2.5 pt-1.5 pb-0.5`).
4. **Settings pickers** (slice-3 reviewer tracker, recorded in qqh1's plan Non-Goals): ThemePairControl mode buttons (`settings-dialog.tsx:158-171`) and shortcuts-panel platform/tier/target selections (`settings-shortcuts-panel.tsx:689/:772/:980`) — mutually-exclusive **selection**: green selected treatment, blue retired.
5. **Breadcrumb-dropdown triggers** (`breadcrumb-dropdown.tsx:174`): the legacy `min-w-[24px] min-h-[24px]` gains the coarse floor (`coarse:min-h-[40px] coarse:min-w-[40px]`) — the audit's last top-bar-family stray.

Non-goals: dialogs/inputs (slice 6), sidebar rows (slice 5), the primitive (slice 7). Menu-row disabled recipe already unified via `MENU_ROW_DISABLED` — align `POPOVER_ROW_CLASS`'s 50 → 40 while folding.

Known e2e risk surface: palette/menu specs asserting row text or checked state; the standing-row substring-collision rule applies to any new palette rows (none expected).

## Slice 5 — sidebar strays (change slug: `sidebar-control-strays`)

**Intake seed**: The sidebar's interactive strays join the contract: one hover-reveal spelling, touch floors on every tappable, and the remaining ad-hoc recipes onto shared constants.

1. **Hover-reveal → one spelling**: the container-level `pointer-events-none` + `group-hover:pointer-events-auto` + `has-[:focus-visible]` idiom (window-row's, `window-row.tsx:949`) becomes the pattern; `status-panel.tsx:350` keeps its `coarse:` escape (fold that into the pattern); `host-panel.tsx:84` migrates off button-level-opacity-only.
2. **Sub-target strays to floors**: status-panel PR-copy cluster `min-h-[20px]` → 24 fine / 40 coarse; window-row icon cluster stays fine-only (by design) but its 24px cells get focus-visible RINGS (today: opacity-reveal only); `swatch-popover.tsx` 18px cells + `marker-pad.tsx` cells → 24px fine floor with coarse handled by their pad geometry (do not break `MARKER_WELL_*` lockstep); pin-popover's 22px Pin button → 24/40; `server-panel.tsx:132` "+" and board-header unpin (`board-header.tsx:85`) get real hit areas; operator context-chip ✕ (`operator-context-chip.tsx:42`) gets a floor.
3. **Row-hover alphas → one**: `bg-bg-card/50` is the survivor (window/session/boards/palette already use it); `/30` (`sidebar/index.tsx:2910`) and pin-popover's full `bg-bg-card` align.
4. **Protect switch** (`server-card.tsx:86`): adopts `ACTION_ROW_CLASS`'s min-h + focus ring (it sits in a `CardActionList` but ignores the row recipe today); its green track values already match BoolToggle — extract the shared switch-track recipe into `controls.ts` while both are in hand.
5. **Deletion candidates**: redundant `select-none` in `KBD_BASE`/`ARROW_BTN`-descendant recipes and now-redundant per-site `focus-visible:` utilities in sidebar files (the global ring outranks them) — sweep as the files are touched.

Known traps (project memory): the marker well width is hardcoded as a Tailwind literal in session-row (grep misses `MARKER_WELL_WIDTH`); `filter({ has })` e2e locators need page-rooted args; row icon clusters need `.hover()` before icon clicks in e2e.

## Slice 6 — dialogs & inputs (change slug: `dialog-input-unification`)

**Intake seed**: Dialogs join the coarse contract and text inputs get one focus treatment — the slice that removes the last control-layer blue.

1. **Dialogs adopt `coarse:`** (today zero uses in any dialog): kill-dialog, board kill trio, spawn-agent, create-session, server-dialogs, host-form, session-name/window-note prompts, operator-compose — buttons to the wide-button recipe (28 fine / 40 coarse), inputs to 40px coarse min-height.
2. **Kill-dialog dedup**: `kill-dialog.tsx:32,38` and `board-page.tsx:1125-1137` are one re-typed recipe that already drifted (`text-sm`) — extract a shared confirm-button pair into `controls.ts` (danger arm on `signal-red`, not raw `red-900`), consume at both sites; flyout danger rows already use `signal-red`, align.
3. **Input focus → one idiom**: `focus:border-accent` is replaced by ONE live-input treatment — decide green (`focus:border-accent-green`) at intake per the color algebra (interaction = keyboard's hover = green family; record as a Certain assumption citing scheme C). Migrate the three colors (`accent`, `text-secondary`, `accent-green/60`) and give the 17 naked `outline-none` inputs (palette input, inline renames, dialog fields, omnibox, note prompts) the same treatment; pin-popover's stray `focus:` idiom joins. Inputs stay excluded from the global focus RING (slice-1 decision stands — border is the input idiom).
4. **Disabled sweep**: the remaining `opacity-50`/`60` stragglers on dialog/panel buttons → the unified `opacity-40 + cursor-not-allowed + hover-neutralized`; `window-note-prompt.tsx:47` gains its missing disabled state (its session-name twin has one).
5. After this slice: `grep -rn "accent[^-]" src/components` over control styling should hit **nothing** — blue is fully retired from the control layer (data-viz/status semantics unaffected).

Known trap: dialogs' e2e coverage is thin; unit tests assert some dialog classes — sweep both. Palette input is autofocused; verify the border treatment doesn't flash on open.

## Slice 7 — the Control primitive + gallery (change slug: `control-primitive-gallery`)

**Intake seed**: Fold the proven recipes into one `Control` component family and ship the standing regression guard. Structural only — zero visual change is itself the acceptance bar.

1. **`Control` primitive** (`components/control.tsx`): variants `icon | chip | toggle | segment | menu-row | wide | confirm` × sizes `bar | chip | row`, states derived from props (`pressed`, `open`, `disabled`, `danger`) composing the BASE/REST/LATCHED arms internally. Constants in `controls.ts`/`kbd-chip.ts` become its implementation detail; call sites migrate surface-by-surface within the slice (top bar → bottom bar/compose → menus → sidebar → dialogs), each group verified by its unit suite before the next.
2. **Gallery route** (dev-only, e.g. `/__controls`, excluded from prod build or gated on `import.meta.env.DEV`): the full variant × state matrix rendered from the REAL primitive with forced-state props; a Playwright spec screenshots it per pointer class (fine/coarse) as the drift guard. Respect Constitution IV: this is a dev surface, not a product page — gate it hard.
3. **Deletion-candidate finale**: with call sites on the primitive, remove the now-dead per-site recipes and the redundant utilities accumulated in earlier slices' Deletion Candidates sections (each archived change's `plan.md` lists them).
4. **Acceptance bar**: pixel-parity on the gallery screenshots against pre-migration captures of the same states; no rendered-class diffs beyond the mechanical substitution; all affected suites green.

Largest slice — if the operator's task-count fork lands FULL (it will), expect multi-cycle review; budget accordingly.

---

## Operator run-book (per slice)

1. `/fab-new "<intake seed above, plus the Standing context block>"` → expect gate ≥ 3.0 with zero Unresolved (the seeds carry the decisions); pin `change_type` explicitly (`fix` for 4–6, `refactor` for 7) — inferred types flip at refresh seams.
2. `/fab-fff <change>` — dispatch quirks that WILL recur on this box (all in project memory):
   - kimi pane workers: open with `env -u TMUX_PANE`, then `tmux set-option -w window-size manual` + `resize-window -x 200 -y 50` before the readiness gate (viewer-sized windows carve ~20-col panes); trust wall = 1 Enter per worktree, amortized.
   - `fab dispatch deliver` refuses mid-stage continuations; a worker parked without its result file gets the typed-nudge recovery (raw `send-keys` one-liner restating the result-file + `fab status refresh` contract), never kill/restart.
   - review-pr: Copilot request 200/201 can silently drop — probe the issue timeline, fall back to the other request arm; prefix-match `copilot-pull-request-reviewer[bot]`.
3. Merge manually on green CI (`gh pr ready` → `gh pr checks --watch` → `gh pr merge --squash --delete-branch`; the local `main`-checkout error after merge is cosmetic — the primary checkout holds main). Auto-merge is disabled repo-wide; autopilot merge-arming will fail — don't stall on it.
4. `git branch -m racing-saola && git reset --hard origin/main` in the worktree, `fab change archive <id>` (rides the next PR), then the next slice.
5. Full e2e suite: never as a gate; CI runs it sharded on the PR.

**Stop conditions**: any slice's review exhausts its 3-cycle budget → park (`review: failed`) and escalate to the user rather than widening scope; any e2e failure that reproduces on clean origin/main → pre-existing, verify against the known-flaky list before bisecting.

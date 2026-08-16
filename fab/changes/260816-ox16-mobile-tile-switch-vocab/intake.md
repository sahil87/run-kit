# Intake: Mobile switch-to-tile verb + tile-verb palette vocabulary rename

**Change**: 260816-ox16-mobile-tile-switch-vocab
**Created**: 2026-08-16

## Origin

Synthesized from a `/fab-discuss` design session (2026-08-16/17), dispatched promptless via `/fab-proceed`-style create-intake (no questions asked; open points deferred as Unresolved assumptions).

> On mobile (`isMobileViewport()`), the surface-layout manager renders only slot A, and the only tile-switch affordance — the bottom-bar ▦ chip opening `components/mobile-surface-sheet.tsx` (transient `mobileActiveTile` swap, app.tsx:~986) — appears ONLY when the resolved layout is already multi-tile, which is rare on a phone (default `single:tty`). For the common case (layout `single:tty`, window has `@rk_url`), the phone's only paths to the web surface are the buried palette `View: Web` action or the overflow chevron's Tiles checkbox rows — which ADD a tile (making split-h with slot A still tty) rather than switching, so nothing visible changes. The reverse direction works (the web tile's URL bar has a `>_` switch-to-terminal button). Gap: tty → web in one tap, on a surface that exists in every lens. Additionally, the palette vocabulary is dishonest: `Layout: Add/Close <Surface>` are not layout (arrangement) commands — they show/hide one tile's renderer, destroying nothing.

All six decisions below were agreed in the discussion session; rejected alternatives and constraints were recorded there and are carried into this intake verbatim.

## Why

1. **The pain point**: a phone user on the default `single:tty` layout whose window has `@rk_url` cannot reach the web surface in one tap. The bottom-bar ▦ chip (→ `mobile-surface-sheet.tsx`) renders only when the resolved layout is already multi-tile — rare on a phone. The remaining paths are buried (palette `View: Web`) or actively misleading (overflow Tiles checkbox rows ADD a tile, producing `split-h` with slot A still tty — on mobile only slot A renders, so nothing visible changes). The reverse direction already works: the web tile's URL bar has a `>_` switch-to-terminal button. The asymmetry is the gap: tty → web in one tap, on a surface that exists in every lens.

2. **If not fixed**: the primary mobile flow (glance at agent terminal → check the app it's serving) stays a 3+-tap palette excursion, and the visible affordances (Tiles rows) silently no-op from the user's perspective.

3. **Why this approach**: reuse the existing top-bar `surface-toggles` group with a mobile render fork rather than a new component tree — same `SURFACE_GLYPH`/`Tip`/aria vocabulary, same ordered-registry entry, one tap instead of the sheet's two. Rejected alternatives (recorded from discussion):
   - **Bottom-bar tabs** — the bottom bar does not render on the web lens, so switch-to-web would strand the user; forking the bar-existence rule is a bigger change.
   - **Swipe gestures** — conflict with xterm touch scroll and iframe inner scrolling; possible later sugar, not the mechanism.

4. **Why the vocabulary rename**: `Layout: Add/Close <Surface>` are not arrangement commands — they show/hide one tile's renderer, destroying nothing (pane/page/editor keep running; the destructive verb is Close Pane, deliberately distinct). "Show/Hide" states what happens. "Tile" matches existing UI vocabulary (the overflow menu section is titled "Tiles"; toggle aria-labels are "<Label> tile") rather than inventing "Surface:" jargon.

## What Changes

### 1. New verb: switch-to-tile (mobile-primary)

Semantics, exactly as agreed:

- **Target surface already open in `renderLayout.order`** → set `mobileActiveTile` — the existing transient discipline (no URL/localStorage write). This preserves shared multi-tile arrangements arriving via `?layout=` URLs (surface-layout spec L3: write on user mutation only).
- **Target surface available-but-not-open** → `switchView(kind)` → `applyLayout(single:kind)` — the exact existing palette `View:` path. This persists per-window localStorage, mirrors the URL, and keeps the code-folder latch seeding intact — the latch keys on `layout.order.includes("code")`, so a transient-only mechanism would silently break latch seeding. That is why the not-open arm MUST go through `switchView`, not a transient swap.

### 2. Button surface: mobile render fork of the top-bar `surface-toggles` group

In `app/frontend/src/components/top-bar.tsx` (existing `SurfaceToggleGroup`, registry entry id `surface-toggles`):

- Below `isMobileViewport()`, render one glyph button per AVAILABLE non-hidden surface — `availableViews` computed over the latch-substituted effective window; the `SURFACE_RAIL_HIDDEN` filter still applies, so **chat renders no button** (chat's palette entries remain its only entry points).
- Render the group only when **≥2 surfaces are available**.
- **Radio semantics on mobile**: the currently VISIBLE surface (`mobileActiveTile ?? slot A`) renders pressed; tapping another button runs the switch-to-tile verb (§1).
- **Desktop semantics unchanged**: open-tile add/close toggles, lit = open.
- Same `SURFACE_GLYPH`/`Tip`/aria vocabulary, same ordered-registry entry — a render fork, not a new component tree.

### 3. Overflow pinning + status dots at mobile

- At mobile, when ≥2 surfaces are available, the group is **pinned in-bar** — it never drops into the overflow menu there (it is the primary mobile affordance); other chips drop first.
- The P4 availability/attention dots carry over to the mobile buttons. This gives `rk present` a visible nudge on the phone: the auto-opened web surface reads as an unpressed chip with a dot. The present auto-expand reaction still **NEVER auto-swaps the visible tile** — existing R13 rule preserved.

### 4. Remove the bottom-bar ▦ chip and `mobile-surface-sheet.tsx`

- Delete `app/frontend/src/components/mobile-surface-sheet.tsx` and its bottom-bar ▦ launcher chip in `components/bottom-bar.tsx`; remove the wiring in `src/app.tsx` (sheet open state, `mobileActiveSlot` handoff at app.tsx:~3862).
- The top-bar group subsumes them (one tap instead of two; the sheet was also a one-way-door risk). Bottom bar otherwise unchanged.

### 5. Palette vocabulary rename (all widths, desktop included)

In `app/frontend/src/lib/palette-layout.ts` (current ids/labels verified at palette-layout.ts:114–206):

| Current | New |
|---------|-----|
| `layout-add-${kind}` / `Layout: Add <Surface>` | `Tile: Show <Surface>` |
| `layout-close-${kind}` / `Layout: Close <Surface>` | `Tile: Hide <Surface>` |
| `layout-focus-${kind}` / `Layout: Focus <Surface>` | `Tile: Focus <Surface>` (targets a tile, not the arrangement) |

- The rename **includes chat's entries** — they are chat's ONLY entry points per `SURFACE_RAIL_HIDDEN`.
- The `⌘J` code-toggle hint stays on the code Show/Hide pair.
- `Layout:` keeps ONLY true arrangement verbs: `Promote`, `Swap`, `Zoom`/`Unzoom`, `Cycle Shape`, per-shape jumps.
- **NEW mobile palette entries**: `Tile: Switch to <Surface>` — the palette twin of the top-bar group (Constitution V parity). On mobile these **supersede** the `View: <X>` entries (collapse-to-single semantics a phone doesn't need).
- Desktop `View: Terminal/Web/Code/Chat` actions (`src/lib/palette-view.ts`) and the `⌘.` view-cycle chord stay **UNTOUCHED** in this change (separable later pass; `Tile: Solo <X>` noted as the honest future name).
- Palette ids are e2e hooks — the rename sweeps `palette-layout.ts` + colocated unit tests (`palette-layout.test.ts`), several `.spec.ts`/`.spec.md` matchers, and UI memory docs. Mechanical; no behavior change beyond labels/ids. <!-- assumed: new id scheme mirrors labels — tile-show-*/tile-hide-*/tile-focus-*/tile-switch-* replacing layout-add-*/layout-close-*/layout-focus-* -->

### 6. Spec + docs amendments

- `docs/specs/surface-layout.md` § Mobile (P5, currently "single tile plus the sheet pattern") amended to the top-bar switch group; R13 no-auto-swap note carried.
- Memory hydrate impact listed under Affected Memory.

## Affected Memory

- `run-kit/ui/lenses-and-layout`: (modify) switch-to-tile verb semantics, mobile single-tile + top-bar group model, sheet retirement
- `run-kit/ui/top-bar`: (modify) surface-toggles mobile render fork, radio semantics, mobile overflow pinning rule
- `run-kit/ui/compose-and-bottom-bar`: (modify) ▦ chip removal; bottom bar otherwise unchanged
- `run-kit/ui/keyboard-and-palette`: (modify) `Layout:` → `Tile:` vocabulary, new `Tile: Switch to <X>` mobile entries, View: supersession on mobile

## Impact

- **Components**: `app/frontend/src/components/top-bar.tsx` (surface-toggles group render fork + mobile pinning), `app/frontend/src/components/mobile-surface-sheet.tsx` (delete), `app/frontend/src/components/bottom-bar.tsx` (▦ chip removal), `app/frontend/src/app.tsx` (`mobileActiveTile` wiring at ~986/~3723/~3862, switch-to-tile callback, palette action assembly).
- **Palette libs**: `app/frontend/src/lib/palette-layout.ts` + `palette-layout.test.ts` (rename + new `Tile: Switch` entries), possibly `app/frontend/src/lib/palette-view.ts` (mobile supersession of `View:` entries).
- **e2e** (`app/frontend/tests/e2e/`): `surface-layout.spec.ts`, `right-panel.spec.ts`, `web-view-lens.spec.ts`, `chat-view.spec.ts`, `code-surface.spec.ts` + their `.spec.md` companions (Constitution test-companion rule: every touched `.spec.ts` updates its `.spec.md` in the same commit); new mobile switch coverage.
- **375px top-bar budget risk**: 2–3 buttons at the 30px coarse token (~60–90px) come out of the center heading's truncation room. Existing e2e assertions invert or need updating: surface-layout/right-panel suites assert "375px renders no surface toggles"; web-view-lens/chat-view 375px tests assert single-line top bar with long window names and no horizontal overflow. Fallback if genuinely too tight: a single cycle button (the `⌘.` view-cycle chord's mouse mirror, Constitution V) — but the segmented group is the primary design.
- **Constitution**: V (palette parity — `Tile: Switch to <X>` entries mirror the buttons), IV (no new routes/params; reuses existing layout state), test-companion-docs rule.
- **Spec**: `docs/specs/surface-layout.md` § Mobile amendment.

## Open Questions

- If the segmented group provably breaks the 375px single-line/no-overflow budget in e2e, does this change auto-substitute the single cycle-button fallback, or stop and escalate for a design call?
- What happens to the overflow chevron's "Tiles" checkbox rows (`SurfaceToggleMenuRows`) at mobile — keep unchanged, relabel to Show/Hide, or suppress now that the pinned group is the primary affordance (and its rows currently ADD tiles, the misleading path this change exists to fix)?

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Switch-to-tile semantics: open-in-`renderLayout.order` → transient `mobileActiveTile`; available-not-open → `switchView(kind)` → `applyLayout(single:kind)` | Discussed — chosen explicitly to preserve L3 write discipline AND code-folder latch seeding (keys on `layout.order.includes("code")`) | S:90 R:70 A:85 D:90 |
| 2 | Certain | Button surface is a mobile render fork of the existing top-bar `surface-toggles` group (radio semantics, `availableViews` over latch-substituted window, `SURFACE_RAIL_HIDDEN` filter, ≥2-surfaces gate); desktop semantics unchanged | Discussed — render fork over new component tree; group + registry entry verified at top-bar.tsx:139/353/566 | S:95 R:75 A:85 D:90 |
| 3 | Certain | Group pinned in-bar at mobile (never overflows; other chips drop first); P4 dots carry over; R13 never-auto-swap preserved | Discussed — primary mobile affordance; gives `rk present` its phone nudge | S:90 R:80 A:80 D:85 |
| 4 | Certain | Remove bottom-bar ▦ chip and delete `mobile-surface-sheet.tsx`; bottom bar otherwise unchanged | Discussed — top-bar group subsumes the sheet (one tap vs two; one-way-door risk) | S:95 R:60 A:90 D:90 |
| 5 | Certain | Palette rename at all widths: `Layout: Add/Close/Focus` → `Tile: Show/Hide/Focus` (chat included; `⌘J` hint stays on code pair); `Layout:` keeps only Promote/Swap/Zoom/Unzoom/Cycle Shape/per-shape jumps | Discussed — Show/Hide states what happens; "Tile" matches existing UI vocabulary (menu section title, aria-labels) | S:95 R:80 A:90 D:90 |
| 6 | Certain | New mobile-only `Tile: Switch to <Surface>` palette entries supersede `View: <X>` on mobile; desktop `View:` actions and `⌘.` cycle chord untouched (`Tile: Solo <X>` deferred as future rename) | Discussed — Constitution V parity for the new verb; desktop pass explicitly separated | S:90 R:75 A:80 D:85 |
| 7 | Confident | New palette id scheme mirrors labels: `tile-show-*` / `tile-hide-*` / `tile-focus-*` / `tile-switch-*` replacing `layout-add-*` / `layout-close-*` / `layout-focus-*`; sweep updates colocated unit tests, e2e matchers, `.spec.md` companions, and UI memory docs | Ids are e2e hooks; discussion fixed the labels — id shape follows the established `verb-kind` convention; mechanical rename | S:70 R:85 A:80 D:70 |
| 8 | Confident | With <2 available surfaces on mobile, no buttons render and no `Tile: Switch` entries appear (nothing to switch to); supersession of `View:` entries applies at mobile regardless | Follows directly from the ≥2 gate and radio semantics; single-surface `View:` is a no-op on a phone | S:60 R:85 A:70 D:65 |
| 9 | Confident | Existing 375px e2e assertions are updated, not deleted: "no surface toggles at 375px" assertions invert; single-line top bar + no-horizontal-overflow assertions at 375px with long window names are RETAINED and must pass with the group present | Discussed as a named constraint; Test Integrity rule — spec changes, tests follow | S:75 R:80 A:75 D:75 |
| 10 | Unresolved | 375px budget fallback authority: if the segmented group provably breaks the single-line/no-overflow budget, auto-substitute the single cycle-button fallback vs stop-and-escalate | Deferred — promptless dispatch | S:50 R:70 A:30 D:40 |
| 11 | Unresolved | Fate of the overflow chevron "Tiles" checkbox rows at mobile (keep unchanged / relabel Show-Hide / suppress in favor of the pinned group) | Deferred — promptless dispatch | S:30 R:80 A:35 D:35 |

11 assumptions (6 certain, 3 confident, 0 tentative, 2 unresolved).

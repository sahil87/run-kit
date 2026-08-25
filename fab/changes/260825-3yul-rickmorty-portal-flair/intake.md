# Intake: Rick and Morty Portal Flair

**Change**: 260825-3yul-rickmorty-portal-flair
**Created**: 2026-08-25

## Origin

One-shot `/fab-new` invocation:

> Add a new Rick and Morty style portal-gun animation to the flair/hover-animation vocabulary described in fab/project/context.md (the rk-* hover-animation treatments in globals.css, FLAIR_STATES/flairTokens closed-set lockstep) -- a green swirling portal opens and a small pixel-art Rick and/or Morty figure steps through/emerges, following the sprite-sheet mold, picker band, and reduced-motion conventions used by the existing named flairs (nyan, naruto, onepiece, pacman, spidey, duel) -- research 260824-164i-spidey-swing-flair and 260825-br6k-lightsaber-duel-flair as the freshest precedents before choosing the concrete design

The request fixes **placement** (the flair axis, named explicitly along with the closed-set lockstep and the reduced-motion convention) and fixes the **subject** (green swirling portal + a figure emerging), while leaving the concrete design — sheet geometry, frame cycle, traversal model, cadence, colors, and whether one figure or two — to research against the two named precedents. So the intake's job is neither to choose the axis (given) nor to invent the subject (given), but to turn "a portal opens and a figure steps through" into buildable geometry, and to enumerate the lockstep sweep on **this** base.

### Gap analysis (intake-time)

`grep -rn -iE "\bportal\b|\brick\b|\bmorty\b|portal-gun" app/ docs/` returns **no** treatment on any visual axis. Every `portal` hit is React-portal DOM terminology (`row-flyout-card.tsx`, `host-panel.tsx`, `tip.tsx`, the `Tip`/flyout memory prose); `rick` and `morty` return nothing at all. No existing flair, marker, or hover treatment covers this subject, and no name collision exists on the flair axis. The recorded design decision *Character homages land on the flair axis, never a hover treatment* (`visual-design.md` § Design Decisions, introduced by the spidey change) plus § *The motion split — markers hold still, flairs move* and § *Flair animation is always-on ambient* settle placement categorically. **No gap-analysis blocker.**

### Current state of the vocabulary — and why it is NOT 14

The two researched precedents are **both in flight and unmerged**, so their counts do not apply to this change's base:

| Change | Branch | State on this base |
|---|---|---|
| `260824-164i-spidey-swing-flair` | `260824-164i-spidey-swing-flair` (tip `539fb997`, PR #737) | **not merged** into `main` |
| `260825-br6k-lightsaber-duel-flair` | `260825-br6k-lightsaber-duel-flair` | **no commits of its own**; code is uncommitted working tree in the `starwars-duel` worktree |

This change branches from `main` (`38eb52f3`), where `FLAIR_STATES` holds `""` + **12 named** flairs: `rain`, `scan`, `nyan`, `naruto`, `onepiece`, `pacman`, `matrix`, `aquarium`, `roadrunner`, `invaders`, `cube`, `warp`. **This change makes it 13 named** — arithmetically the same growth step spidey took (12 → 13), not the 14th. Every "12"/"twelve" count in code comments, tests, and memory is a lockstep touch point, and every count in the *duel* intake (13 → 14) must be read as **+1 off** for this tree.

Consequence to expect at merge: spidey, duel, and this change all append to the same two closed sets and edit the same count comments and test arithmetic. Textual conflicts at those sites are **expected and mechanical** (append order in `FLAIR_STATES` / `flairTokens`, the `= NN options` total, the keyboard-walk arrays); whichever lands second re-derives the counts. Nothing about the treatments themselves interacts — the CSS blocks are disjoint.

## Why

The flair catalogue is run-kit's per-row personality channel — a user-opt-in decoration axis whose value grows with variety (10 color families × 3 shades × 8 markers × N flairs). Nothing breaks if this is not added; it is a pure vocabulary extension, and the picker was explicitly built for this growth ("constant height holds regardless of any axis's vocabulary growth").

What this addition contributes that the existing 12 do not: **every current character flair enters and leaves the row off-screen.** The mold's own rule says so — "sprite layers are no-repeat, sliding off-left negative → off-right `calc(100% + Npx)`" — and the loop-boundary discipline is built on it (pacman: "loop boundaries happen on a completely empty row"). A portal flair inverts that premise. The figure does not cross the row; it **arrives in it and departs from it**, and the arrival and departure are themselves the animation. That makes it the catalogue's first treatment with an **in-box entrance and exit**, and it needs a different mechanism for hiding the loop seam: instead of parking the sprite off-screen, the sprite parks **behind an opaque portal disc**. Same invariant (the loop point is never visible), earned a new way.

It also fills a gap the request implies: `invaders` aside, the catalogue's motion is all lateral travel. A portal is an *event* — something opens, something comes out, it closes. That is a genuinely different beat from a runner going past.

Why a flair rather than a hover treatment: settled by the recorded design decisions above, and the request already directs it there.

## What Changes

### 1. New flair value `portal` in both closed sets (lockstep)

- `app/frontend/src/themes.ts:494` — append `"portal"` to `FLAIR_STATES`:
  ```ts
  export const FLAIR_STATES = ["", "rain", "scan", "nyan", "naruto", "onepiece", "pacman", "matrix", "aquarium", "roadrunner", "invaders", "cube", "warp", "portal"] as const;
  ```
- `app/backend/internal/validate/validate.go:208` — append `"portal"` to `flairTokens` (the `@rk_flair` closed set). `FlairValues` and the user-facing error copy are both **derived** from this slice (`closedSet` / `validateClosedSet`), so the map and the message cannot drift — but the doc comment at `:271-273` enumerates the set by hand and does need the token.

The token is **`portal`** — one lowercase word naming the scene, matching the homage-nickname register (`naruto`, `onepiece`, `pacman`, `roadrunner`, `invaders`, and the in-flight `spidey`/`duel`). "Rick", "Morty", and "Rick and Morty" are Adult Swim / Cartoon Network marks and are all avoided; `rickmorty` was rejected on that ground, and `portalgun` as redundant once the artwork carries the identity. Sprites are original stylized pixel art embedded as inline SVG data URIs, consistent with every other flair — no external requests, no copyrighted assets.

### 2. `.rk-flair-portal` treatment in `globals.css` (sprite-sheet mold)

Placed **after the `.rk-flair-cube` block** (currently the last flair block, ending `globals.css:1085`) and **before** the `prefers-reduced-motion` gate at `:1222` — all flair blocks stay contiguous ahead of the gate, satisfying the source-order rule.

**The scene**: a portal swirls open at the row's left edge; Rick steps out of it and walks right across the row; a second portal opens at the right edge; he walks into it and is gone. Loop.

**Two pseudos, and the portals paint OVER the figure.** This is the treatment's one structural requirement: a figure must *emerge from behind* a portal, so the portal art has to be above the figure art in paint order.

- **`::after` — the FIGURE.** House convention (character on `::after`). Standard **centered 22px strip** (`top: 50%; height: 22px; margin-top: -11px`) — not spidey's bottom-anchored 30px deviation; a walk cycle needs no extra headroom. ONE no-repeat layer: a **16 × 88 sheet, four 22px frames** (frame *n* at `background-position-y: -22n`).
- **`::before` — the two PORTALS**, lifted above the figure with **`z-index: 6`**. This is not a new idiom: `.rk-flair-scan::after` already carries `z-index: 6` (`globals.css:588`) to lift a flair pseudo above its sibling. Borrowing that existing mechanism keeps the catalogue's *ambience-on-`::before`, character-on-`::after`* convention intact, where inverting the two pseudos would have broken it for every future reader.

**Positioning is PERCENTAGE, not px — and for a different reason than invaders.** Both pseudos use `background-position-x` in percent (`0%` maps the image's left edge to the box's left edge; `100%` maps image-right to box-right):

- entry portal at `0%`, exit portal at `100%` — **stationary**, no `-x` animation at all;
- the figure traverses `0%` → `100%`.

`invaders` uses percentage positioning to make an *alternate wander* box-agnostic. Here the reason is different and, on this treatment, mandatory: the traversal must **start and end at in-box anchor points** (the two portals) rather than off-screen, and those anchors must hold at every mounting box width. Fixed px offsets would break at small boxes — at an 18px picker preview cell, a px-anchored exit portal at `calc(100% - 24px)` lands at `-6px` and the figure's traversal range inverts. With percentages the geometry degrades gracefully instead: at 18px the two portal discs overlap almost exactly and read as one pulsing portal, which is the right thing for a cell that small. Zero transforms either way.

**Portal sheet — 20 × 220, ten 22px frames, ONE sheet phase-shifted per portal.** The sheet is the portal's full open/close arc, ordered so a single frame sequence serves both portals at different phases:

| # | y-offset | Frame |
|---|----------|-------|
| 0 | `0px` | full swirl A — 16px disc, bright rim, hot core |
| 1 | `-22px` | full swirl B — same disc, swirl arms rotated one step |
| 2 | `-44px` | ring 14px — collapsing, core dimming |
| 3 | `-66px` | ring 10px |
| 4 | `-88px` | spark 5px |
| 5 | `-110px` | **empty** |
| 6 | `-132px` | spark 5px — reopening |
| 7 | `-154px` | ring 10px |
| 8 | `-176px` | ring 14px |
| 9 | `-198px` | full swirl B |

Both portal layers ride ONE `step-end` keyframes rule with per-layer comma-separated values — the multi-layer composition pattern `pacman` uses on `-x`, applied here to `-y`. The **entry** layer starts at frame 0 (full, hiding the figure at the loop seam), collapses through frames 2→5 over roughly the first 18% of the cycle, and sits on frame 5 (empty) for the remainder. The **exit** layer sits on frame 5 (empty) until roughly 80%, reopens through frames 6→9→0, and **holds full through 100%** — so at the loop instant the figure is behind an opaque disc on the right while the entry disc is already full on the left. The seam is covered at both ends by artwork, which is what replaces the off-screen parking rule.

**Figure sheet — 16 × 88, four 22px frames**: a 4-pose walk cycle (left leg forward, passing pose, right leg forward, passing pose) with a 1px head bob, ~10px tall on a y=20 baseline, ~8px wide.

**Cadence — three animations, one of which is load-bearing:**

- **`::after` `-x` traversal**: `0% → 100%`, `linear`, **11s infinite**. Not `alternate` — the loop is hidden behind the portals, and a portal scene has a direction.
- **`::after` `-y` walk**: four frames on `step-end`, **0.6s infinite** (~6.7fps — nyan's cadence). A walk wants that; duel's 2fps would read as slow motion. Independent of the traversal, exactly as every other traversal flair composes its two longhands.
- **`::before` `-y` gate**: the ten-frame envelope on `step-end`, **11s infinite**. This period **MUST equal the traversal period** — it is the one hard sync in the treatment, because the portals' open/close has to line up with where the figure actually is. Everything else here is a tunable constant; this is a constraint.

Keyframe names follow the register: `rk-flair-portal-x` (traversal), `rk-flair-portal-walk` (frames), `rk-flair-portal-gate` (the portal envelope). Never shared with another flair.

**Colors** — the portal is the brightest thing in the box; the figure is near-silhouette:

- **Portal**: outer ring `#97ce4c` (the show's acid green), inner glow `#c7f06a`, hot core `#eaffc0`, plus two or three dissipating mote pixels just outside the rim at ~0.45 alpha. This green is deliberately **yellower** than the UI's accent green `#22c55e` (which means interactive / live-pane in the hover vocabulary), so the portal does not read as a status signal; `matrix` and `cube` already hardcode the accent-green family, so a green flair is not itself novel.
- **Rick**: lab coat `#d3dbe6`, spiky white hair `#f0f4f9` drawn as a 5px crest (the single most legible silhouette cue at 22px), skin `#e0ab86`, trousers `#39404f`, 1px limb strokes.
- `::after` opacity ~0.95; `::before` at full opacity.

**One figure, not two.** The request allows "Rick and/or Morty". Rick alone is the readability call at 22px: a second figure halves the per-figure pixel budget in a strip where the white-hair crest is already doing the identity work. A trailing Morty can be added to the same sheet frames later without touching anything else.

**No third ambient layer.** Both pseudos are spent (figure + portals), so unlike spidey's skyline backdrop and duel's corridor tile there is no ambience budget and therefore no "ship it or drop it" open item — the portals' own mote pixels carry the atmosphere.

**No transforms, no layout-affecting properties, no child spans.** `background-position` and `z-index` only, on the overlay's own pseudos, so the drag-ghost rule holds and the cube/warp child-span exception is **not** invoked. `FlairOverlay` needs **zero source change**.

### 3. Reduced-motion gate

Append `.rk-flair-portal::before, .rk-flair-portal::after` to the existing enumeration in the `prefers-reduced-motion` block (`globals.css:1249-1272`; the current last entries are the cube/warp child spans): `animation: none; display: none`. Flairs are motion-only decoration carrying no semantics, so they hide entirely — no static fallback, unlike the marker stripes which remain. The block's count comment at `:1249` ("all twelve named states") becomes thirteen. Base rules must precede the gate (source-order rule).

### 4. Consumers pick the value up from the closed sets

- **`FlairOverlay`** (`components/flair-overlay.tsx`) — the class is pure template interpolation (`` `rk-flair-${flair}` ``) with no registry; only `cube` and `warp` get child markup. `portal` renders the bare span, so **zero source change**. Its test's bare-span case currently renders a single `nyan` (`flair-overlay.test.tsx:15-20`) and should gain `portal` (spidey's precedent restructured this into a loop).
- **Picker flair band** (`swatch-popover.tsx:81-83`) — registration is automatic: `FLAIR_NAMED = FLAIR_STATES.slice(1)` grows 12 → 13 cells, split column-flow across two fixed 18px rows by `i % 2`. `portal` takes index 12 — **even, so it lands in row 1's last column** — making the split **7/6**. Row 1's width goes 6 → 7 cells = `7×18 + 6×3 = 144px`, still inside the ~190px panel, so the band does not begin scrolling and constant panel height holds. The keyboard grid (`:249-251`) derives its rows from the same constants, and arrow moves already call `scrollIntoView` for any future overflow. A new flair entry needs **nothing but the token**: the label is the token (`Tip label={state}`), the accessible name is `` `Flair ${state}` ``, and the "glyph" is the live overlay itself. **Three doc comments in this file carry the count and DO need updating**: `:53`, `:78`, `:624`.
- **Backend / API** — no route changes. `@rk_flair` (window, via the `POST /api/windows/{windowId}/options` allowlist) and `@rk_session_flair` (session, via `POST /api/sessions/{session}/flair`) both validate through `ValidateFlairValue`; `settings.go`'s `server_flairs` membership normalize gates on `validate.FlairValues`; the tmux parsers (`tmux.go:766`, `:1023`) and the snapshot capture/restore all route through the same map. None need a touch. Constitution IX untouched (no new endpoints, no new verbs); II and X untouched (the value still lives in tmux options).

### 5. Full enumeration sweep (verified at intake against THIS base)

Classes fail differently — a stale closed set is a runtime 400, a stale comment is cosmetic, a stale test is a red suite — so they are separated here to let review localize a failure to its class.

**A. Hard closed-set declarations (a stale one is a functional bug):**
- `app/frontend/src/themes.ts:494` — `FLAIR_STATES`
- `app/backend/internal/validate/validate.go:208` — `flairTokens`
- `app/backend/api/operator.go:444` — the **labeler-agent prompt token list**, a hardcoded literal: `(rain scan nyan naruto onepiece pacman matrix aquarium roadrunner invaders cube warp)`. This is a live closed-set surface an agent writes `@rk_flair` from; a stale list means the color-tabs operator never emits the new value, and any agent that guesses it gets a 400. It is **drift-guarded** — `operator_test.go:1006` parses the parenthesized run and `maps.Equal`s it against `closedSetTokens(validate.FlairValues)` — so forgetting it is a hard test failure, not silent rot.
- `app/frontend/src/globals.css` — the new `.rk-flair-portal` block + the reduced-motion pair

**B. Doc-comment enumerations and counts:**
- `app/backend/internal/validate/validate.go:271-273` — the `ValidateFlairValue` comment's value list
- `app/frontend/src/types.ts:66-70` (`SessionInfo.flair`) and `:104-109` (`WindowInfo.flair`) — both doc lists
- `app/frontend/src/globals.css:482-485` — the flair section-header name list
- `app/frontend/src/globals.css:1249` — `/* Flair overlays (all twelve named states) … */` → thirteen
- `app/frontend/src/components/swatch-popover.tsx:53`, `:78`, `:624` — three "12 named states" band comments
- `app/frontend/src/themes.ts:481-497` — while here, the `FLAIR_STATES` doc comment says flair is available on window and session rows "(NOT server group headers)", which `260820-arqw` falsified: the group header and the SERVER tile both mount flair now. One clause, adjacent to the line being edited, and wrong in a way a reader would act on.

**C. Tests that hardcode the set (all break on a 13th):**
- `app/frontend/src/themes.test.ts:531-532` — exact `FLAIR_STATES` array equality
- `app/backend/internal/validate/validate_test.go:528` (the "12 named states" comment), `:529` (the `valid` list), `:539` (the `invalid` list — add `"Portal"` / `" portal "`, matching how the case/whitespace forms are covered for the existing tokens; keep the standing *"marker tokens are NOT flairs — the axes are independent closed sets"* assertion intact)
- `app/backend/api/operator_test.go:960` — the prompt token-list substring
- `app/frontend/src/components/flair-overlay.test.tsx:15-20` — the bare-span case
- `app/frontend/src/components/sidebar/index.test.tsx:2069` (title "12 live cells"), `:2077-2079` (`toHaveLength(12)` → 13, plus a `data-flair-value='portal'` presence assertion)
- `app/frontend/src/components/swatch-popover.test.tsx:33` — the `FLAIR_NAMED` "12 named" comment
- `app/frontend/src/components/swatch-popover.test.tsx:406`, `:408` — **the total-options arithmetic**: `"30 colors + 8 markers + 12 flairs + 3 header − + panel − + ✕ = 55 options"` and `toHaveLength(55)` → **13 flairs, 56**
- `app/frontend/src/components/swatch-popover.test.tsx:457` — "the flair band lists the 12 states in display order" → 13, `portal` last
- `app/frontend/src/components/swatch-popover.test.tsx:791-829` — **the most brittle site.** The title "the flair rows walk 6 columns each" becomes "7 and 6"; row 1's right-edge clamp moves from col 5 (`cube`) to col 6 (`portal`); and the hardcoded left-walk array `["roadrunner","matrix","onepiece","nyan","rain","rain"]` must be re-derived as `["cube","roadrunner","matrix","onepiece","nyan","rain","rain"]`. Row 2 is unchanged (`portal` is even-indexed), so only one of the two walk arrays moves.

**D. The e2e companion doc — IN scope here, unlike in the precedents.** `app/frontend/tests/e2e/window-marker-gutter.spec.md:11` ("12-state closed set") and `:44` ("the flair band's 12 live cells") are **accurate on this base** and this change is what falsifies them. Both precedent intakes filed these lines as pre-existing drift — correctly, because on *their* trees the counts were already stale before they started. That reasoning does not transfer, so they are in scope as a two-line accuracy fix. The spec itself (`window-marker-gutter.spec.ts` — `expectFlair` at `:46`, band header at `:86`, the rain/scan test at `:164`) does not enumerate the closed set and needs no change; **if any `.spec.ts` IS touched, its sibling `.spec.md` MUST be updated in the same commit** (Constitution → Test Companion Docs).

**E. Sites that enumerate flairs but are ALREADY STALE — out of scope.** These name only `nyan`/`naruto`/`onepiece` (the `260814-2esh` set, three catalogue expansions ago) and were left alone by the spidey change too; the drift predates this work, and folding an unrelated cleanup into a vocabulary addition would inflate the diff and blur review. Enumerated so the sweep does not mistake them for missed lockstep:
`app/backend/internal/tmux/tmux.go:628, 696, 1023, 2317`; `app/backend/api/windows.go:418`; `app/backend/api/sessions.go:169`; `app/frontend/src/api/client.ts:789, 835`; `docs/specs/themes.md:203, 215` (human-curated by convention — "Specs are written and maintained by humans"; neither precedent touched `docs/specs/`); `docs/wiki/picker-layout-studies.html` (a deliberately frozen design study whose `FLAIRS_SHIPPED`/`FLAIRS_INCOMING` arrays record a historical moment).

One exception inside this class: `docs/memory/run-kit/architecture.md`'s four flair enumerations are equally stale at three tokens, but they are **Affected Memory** and cannot be skipped — appending `portal` to a list reading `nyan, naruto, onepiece` would produce nonsense. Bringing those four lines current to the full 13 is therefore unavoidable rather than opportunistic, and both precedents did exactly that.

## Affected Memory

- `run-kit/ui/visual-design`: (modify) add the `.rk-flair-portal` catalogue bullet to § Character Flair Overlays after the `.rk-flair-warp` bullet at `:270` (the two-pseudo split and the `z-index: 6` lift, both sheet geometries, the ten-frame phase-shifted gate, the three cadences and the mandatory 11s sync, percentage anchoring, colors); update the channel value list at `:252`, "**The twelve treatments**" at `:254`, the sheet-mold paragraph at `:256` (which currently says "Five treatments break the sheet mold" and must account for a sixth shape — an in-box entrance/exit rather than a traversal), "All twelve animate ambiently" at `:272`, the picker-band counts at `:276` and `:210`, and the "all twelve overlays" reduced-motion note at `:278`. **Two § Design Decisions entries are warranted**: (1) *the loop seam can be hidden behind artwork instead of off-screen* — the mold's off-screen parking rule is one implementation of "the loop point is never visible", and a portal scene satisfies the invariant by parking the sprite behind an opaque disc; (2) *percentage anchoring for in-box entrance/exit* — the same primitive invaders uses for a box-agnostic wander, adopted here for the distinct reason that the traversal endpoints are in-box anchors, with the 18px picker cell as the case that rules px offsets out.
- `run-kit/ui/sidebar`: (modify) § Row Flair closed-set enumeration at `:475` gains `portal`; "12 named states" at `:475` and the picker-band count at `:481` → 13.
- `run-kit/architecture`: (modify) the flair enumerations at `:95` (the `@rk_flair` bullet), `:119` (the `internal/validate` row — both the `FlairValues` set *and* the verbatim generated error-copy string), `:196` (the session-flair body union), and `:197` (the window-options `@rk_flair` list). All four are stale at the three-token `260814-2esh` set, so this touch necessarily brings them current to 13 (see § 5 class E).
- `run-kit/tmux-sessions`: (modify) the `@rk_*` user-option registry rows for `@rk_flair` (`:323`) and `@rk_session_flair` (`:335`) gain `portal`; "twelve named states" → thirteen.

## Impact

- **Frontend**: `themes.ts` (closed set + its stale server-header clause), `types.ts` (two doc comments), `globals.css` (section-header comment, the new keyframes + `::before`/`::after` block, the reduced-motion gate and its count comment), `swatch-popover.tsx` (three band count comments only — the band, its rows, and the keyboard grid all derive from `FLAIR_STATES`), and five test files. `flair-overlay.tsx` needs **no change at all**.
- **Backend**: `validate.go` one-line closed-set append + its doc comment, `operator.go` prompt token list, two tests. No API surface change.
- **Docs/memory**: four memory files — one new catalogue entry, two new Design Decisions entries, and count/enumeration touches — plus two count lines in the e2e companion doc.
- **No dependencies added.** Both sprites are inline SVG data URIs. Combined sheet area (16×88 + 20×220 = 5.8k px²) is smaller than duel's single 38×220 sheet, and the portal sheet's ten frames are highly repetitive (one disc at five radii, mirrored across the collapse/reopen arc), so the `<defs>` + `<use href='#id'>` compression idiom that `invaders` establishes applies and keeps the data URI to a few KB.
- **State remains derived** — the flair value lives in `@rk_flair` / `@rk_session_flair` tmux options and the `server_flairs` settings map (Constitution II and X untouched).
- **Merge interaction**: three in-flight changes (spidey, duel, this) append to the same closed sets and count sites; conflicts there are mechanical, and the CSS blocks are disjoint (see § Current state of the vocabulary).

## Open Questions

- (none — the request fixed the axis and the subject, and research against the two precedents plus the mold's own stated constraints resolved the geometry; every remaining choice is a graded assumption below, and none scored Unresolved)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The portal scene lands as a 13th named flair on the `.rk-flair-*` axis | Explicitly directed by the request (which names `FLAIR_STATES`/`flairTokens` and the reduced-motion convention), and independently settled by the recorded design decision *Character homages land on the flair axis, never a hover treatment* plus the motion-split and always-on-ambient rules | S:95 R:60 A:95 D:95 |
| 2 | Certain | This is the 12 → 13 step, not 13 → 14 — both researched precedents are unmerged, so this change branches from a 12-named-flair base | Verified: spidey's branch is unmerged (PR #737 open) and duel has no commits of its own; `FLAIR_STATES` on `main` holds 12 named states. Every count in the duel intake reads +1 off for this tree, and mis-taking the base would put wrong numbers in five test files | S:90 R:70 A:95 D:95 |
| 3 | Certain | Frontend `FLAIR_STATES` and backend `flairTokens` move in lockstep, with the full enumeration sweep (operator prompt list, doc comments, seven test sites, four memory files, the e2e companion counts) | The two closed sets are the documented validation contract for `@rk_flair` writes — diverging them 400s every write of the new value; the sweep sites were enumerated at intake against this base | S:80 R:85 A:95 D:95 |
| 4 | Certain | Reduced motion hides the flair entirely (`animation: none; display: none`), no static fallback | Explicit standing rule for ALL flairs (motion-only decoration carrying no semantics); the gate block enumerates every flair pseudo | S:85 R:90 A:100 D:100 |
| 5 | Certain | The portals must paint ABOVE the figure, achieved with `z-index: 6` on `::before` rather than by swapping the two pseudos' roles | "Emerging from behind a portal" is only possible if the portal art is above the figure art. `.rk-flair-scan::after` already lifts a flair pseudo with `z-index: 6`, so this reuses an existing idiom; inverting the ambience-on-`::before` / character-on-`::after` convention would have broken it for every future reader of the catalogue | S:55 R:80 A:90 D:85 |
| 6 | Certain | Positioning is percentage-based (`0%`/`100%` anchors, figure traversing `0%`→`100%`), not px offsets | The traversal endpoints are in-box anchors (the two portals), and px offsets break at small boxes — at an 18px picker cell a `calc(100% - 24px)` exit portal lands at `-6px` and the traversal range inverts. Percentage positioning is the documented box-agnostic zero-transform primitive (invaders), and it degrades gracefully at 18px (the discs overlap and read as one portal) | S:60 R:80 A:90 D:85 |
| 7 | Certain | The picker band absorbs the 13th cell with no layout work — `portal` takes even index 12, landing in row 1's last column for a 7/6 split | The band, its two rows, and the keyboard grid all derive from `FLAIR_STATES.slice(1)` with a computed `i % 2` split, not hardcoded rows. Row 1 grows to `7×18 + 6×3 = 144px`, inside the ~190px panel, so no scrolling starts and constant panel height holds; only comments and test expectations move | S:65 R:80 A:90 D:85 |
| 8 | Confident | Flair token is `portal` — one lowercase word naming the scene | Matches the homage-nickname register (`naruto`/`onepiece`/`pacman`/`roadrunner`/`invaders`) and avoids the Adult Swim marks (Rick / Morty / Rick and Morty); `rickmorty` rejected on that ground and `portalgun` as redundant once the artwork carries the identity. Stored `@rk_flair` values make a later rename costly (low R), but the pick has a clear front-runner | S:60 R:35 A:80 D:70 |
| 9 | Confident | The loop seam is hidden **behind an opaque portal disc** rather than by parking the sprite off-screen | The mold's off-screen-parking rule is one implementation of the real invariant ("the loop point is never visible"); a portal scene cannot satisfy it that way, because its whole premise is an in-box entrance and exit. Holding the exit portal full through 100% while the entry portal is already full at 0% covers the seam at both ends with artwork. This is the design's central deviation and the reason for a new Design Decisions entry | S:55 R:70 A:75 D:65 |
| 10 | Confident | The portal envelope is ONE ten-frame sheet phase-shifted per portal (entry collapsing over ~0–18%, exit reopening from ~80% and holding through 100%), driven by per-layer comma-separated values on one `step-end` keyframes rule | Ordering the sheet as a collapse-then-reopen arc lets both portals read from one sheet instead of two, and per-layer value lists on a shared keyframes rule is the established multi-layer composition pattern (`pacman` uses it on `-x`; this applies it to `-y`). Halves the sprite budget and keeps one authority for the disc art | S:45 R:80 A:75 D:60 |
| 11 | Confident | Cadence: 11s traversal, 0.6s four-frame walk (~6.7fps), 11s ten-frame portal gate — with the gate period **required** to equal the traversal period | Only the walk speed has a natural reference (nyan's 6.7fps; duel's 2fps would read as slow motion for a walk), so the traversal and gate numbers are chosen. The 11s sync is the one non-negotiable constant — the portals' open/close must line up with where the figure is — and the rest are pure CSS constants, trivially tuned at review | S:45 R:85 A:65 D:55 |
| 12 | Confident | Sheets are 16 × 88 (figure, 4 walk frames) and 20 × 220 (portal, 10 frames), both on the standard **centered 22px strip** | A walk cycle needs no extra headroom, so spidey's bottom-anchored 30px deviation is not invoked; staying in the mold keeps the px frame offsets valid at 24px rows, 36px coarse rows, SERVER tiles, and 18px picker cells. CSS-only, so a taller strip is cheap if review finds clipping | S:50 R:80 A:75 D:60 |
| 13 | Confident | ONE figure (Rick), not two — the request's "and/or" is resolved to Rick alone | Readability at 22px: a second figure halves the per-figure pixel budget in a strip where the 5px white-hair crest is already carrying the identity. A trailing Morty can be added to the same sheet frames later without touching any other file, which is what carries the grade | S:55 R:85 A:70 D:60 |
| 14 | Confident | Portal green is the show's yellower acid green (`#97ce4c` rim / `#c7f06a` glow / `#eaffc0` core), deliberately distinct from the UI accent green `#22c55e` | Accent green already means interactive / live-pane in the hover vocabulary, so a portal in that exact hue could read as a status signal. A yellower green keeps the homage while separating the semantics; `matrix` and `cube` already hardcode the accent-green family, so a green flair is not itself novel | S:40 R:85 A:75 D:65 |
| 15 | Confident | No third ambient layer — both pseudos are spent on figure + portals, so there is no "ship it or drop it" companion-layer question | Unlike spidey's skyline and duel's corridor tile, this treatment has no spare pseudo; the portals' own dissipating mote pixels carry the atmosphere. This removes an open item the two precedents both had to resolve at apply, rather than adding one | S:60 R:90 A:80 D:80 |
| 16 | Confident | The e2e companion doc's flair counts (`window-marker-gutter.spec.md:11, 44`) are IN scope, diverging from both precedents' scope call | Those lines are **accurate on this base** and this change is what falsifies them; the precedents filed them as pre-existing drift because on their trees the counts were already stale before they started, so that reasoning does not transfer. A two-line accuracy fix on a doc the constitution treats as part of the test definition | S:50 R:90 A:80 D:70 |
| 17 | Confident | Pre-existing stale flair enumerations (`tmux.go`, `windows.go`, `sessions.go`, `client.ts`, `docs/specs/themes.md`, the frozen wiki study) stay OUT of scope — with `architecture.md` as the one unavoidable exception | They still name only the three-token `260814-2esh` set and were left alone by the spidey change too, so the drift predates this work and cleaning it up would inflate the diff. `architecture.md` cannot be skipped the same way: it is Affected Memory, and appending `portal` to a list reading `nyan, naruto, onepiece` would be nonsense, so bringing those four lines current is forced rather than opportunistic | S:45 R:95 A:80 D:70 |
| 18 | Confident | `flair-overlay.tsx` needs zero source change; the treatment declines the cube/warp child-span transform exception | The class is pure template interpolation with no registry, and only the transform-driven flairs get child markup. Everything here is frame art plus stepped background sweeps and a static `z-index`, which cannot paint outside the element's own box — so the drag-ghost rule holds with no new markup | S:70 R:90 A:90 D:85 |

18 assumptions (7 certain, 11 confident, 0 tentative, 0 unresolved).

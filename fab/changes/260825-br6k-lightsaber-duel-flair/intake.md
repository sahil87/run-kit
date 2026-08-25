# Intake: Lightsaber Duel Flair

**Change**: 260825-br6k-lightsaber-duel-flair
**Created**: 2026-08-25

## Origin

One-shot `/fab-new` invocation:

> Add a new Star Wars lightsaber-duel flair to the rk-* flair vocabulary in globals.css (the .rk-flair-* per-row character animations — follow the closed-set lockstep, sprite-sheet mold, FlairOverlay, picker band, and reduced-motion conventions; the 260824-164i-spidey-swing-flair change is the freshest precedent for how a flair lands). The flair shows a duel between a Jedi and Darth Vader: two small pixel-art figures facing each other — the Jedi wields a BLUE lightsaber (1px glowing blade), Darth Vader a RED one; Vader in black with his helmet silhouette, the Jedi in lighter robes. They fight SLOWLY while the duel drifts from one side of the row to the other and back (a slow side-to-side wander, invaders-style alternate traversal suits a duel better than a one-way crossing). The fight cycle needs a few distinct actions encoded in the sheet frames: saber swings/clashes (blades crossing between them), a jump (one figure leaping over a low swing), advancing/retreating steps. Keep both sabers readable as blue vs red at row scale; blades are the brightest pixels, figures near-silhouette.

Unlike the spidey invocation (which delegated the *placement* decision to research), this request already fixes placement — the flair axis — and specifies the treatment in unusual detail: the two combatants, their blade colors, the traversal model (invaders-style alternate wander, explicitly preferred over a one-way crossing), the required action set, and the readability priority (blades brightest, figures near-silhouette). The intake's job is therefore not to *choose* the design but to make it concrete enough to build: exact sheet geometry, the frame-by-frame action cycle, timing, colors, and the full enumeration sweep.

### Gap analysis (intake-time)

`grep -rn -iE "lightsaber|jedi|vader|starwars|star-wars" app/ docs/` returns only unrelated `spidey`-adjacent lines — no existing duel, saber, or Star Wars treatment on any axis. The flair axis is the correct and only home: `docs/memory/run-kit/ui/visual-design.md` § Design Decisions → *Character homages land on the flair axis, never a hover treatment* (introduced by the spidey change) settles the placement question categorically, and § *The motion split — markers hold still, flairs move* plus § *Flair animation is always-on ambient* rule out any hover-gated or marker-axis alternative. No gap-analysis blocker.

### Current state of the vocabulary

`FLAIR_STATES` holds `""` + **13 named** flairs: `rain`, `scan`, `nyan`, `naruto`, `onepiece`, `pacman`, `matrix`, `aquarium`, `roadrunner`, `invaders`, `cube`, `warp`, `spidey`. This change makes it **14 named**. Every "13"/"thirteen" count in code comments, tests, and memory is a lockstep touch point.

## Why

The flair catalogue is run-kit's per-row personality channel — a deliberate, user-opt-in decoration axis whose value grows with variety (10 color families × 3 shades × 8 markers × N flairs). Nothing breaks if this is not added; it is a pure vocabulary extension, and the picker was explicitly built for this growth ("constant height holds regardless of any axis's vocabulary growth").

What this particular addition contributes that the existing 13 do not: **every current character flair is a solo traversal** — one character (or one glued convoy, as in pacman's chase) crossing the row. `invaders` is the only alternate-wander treatment, and it is a formation shuffle, not a scene. A two-figure duel is the catalogue's first *interaction* — two characters whose relationship to each other (closing, clashing, one leaping the other's swing, breaking apart) is the content, and whose relationship to the row is a slow drift rather than a crossing. The user's own reasoning names this: an alternate wander "suits a duel better than a one-way crossing", because a duel has no destination. That makes the treatment a genuine addition to the vocabulary's range rather than a sixth runner.

Why the invaders wander model specifically: it is also the only traversal that survives direction reversal *without mirrored artwork*. A runner drifting right-to-left would need a flipped sheet; two figures facing **each other** look correct traveling either way, because neither figure faces the direction of travel. The alternate traversal and the duel subject are a natural fit, not a compromise.

## What Changes

### 1. New flair value `duel` in the closed sets (lockstep)

- `app/frontend/src/themes.ts:494` — append `"duel"` to `FLAIR_STATES`:
  ```ts
  export const FLAIR_STATES = ["", "rain", "scan", "nyan", "naruto", "onepiece", "pacman", "matrix", "aquarium", "roadrunner", "invaders", "cube", "warp", "spidey", "duel"] as const;
  ```
- `app/backend/internal/validate/validate.go:208` — append `"duel"` to `flairTokens` (the `@rk_flair` closed set; `FlairValues` / `ValidateFlairValue` derive from it, and the user-facing error copy is generated from the same slice).

The token is **`duel`** — one lowercase word naming the scene, matching the homage-nickname register (`naruto`, `onepiece`, `pacman`, `roadrunner`, `spidey`, `invaders`) and avoiding trademarked terms. "Lightsaber", "Jedi", "Vader", and "Star Wars" are all Lucasfilm marks; `saber` was considered and rejected as generic (a real fencing weapon — it does not name *this* scene, and the identity is carried by the artwork). Sprites are original stylized pixel art embedded as an inline SVG data URI, consistent with every other flair — no external requests, no copyrighted assets.

### 2. `.rk-flair-duel` treatment in `globals.css` (sprite-sheet mold)

Placed **after the `.rk-flair-spidey` block** (currently the last flair block, `globals.css:1087–1156`) and **before** the `prefers-reduced-motion` gate — all flair blocks stay contiguous ahead of the gate, satisfying the source-order rule.

**Sheet geometry — 38 × 220, ten 22px frames** (frame *n* at `background-position-y: -22n`), on a **centered 22px strip** `::after` (`top: 50%; height: 22px; margin-top: -11px`). This is the standard mold, NOT spidey's bottom-anchored 30px deviation: the jump fits inside 22px by arithmetic — figures stand ~13px tall on a baseline at y=20 (head top at y≈7), the jump lifts ~5px (head top at y≈2), and blades are drawn *angled*, never held vertically overhead, so nothing needs the extra headroom. Keeping the mold means the frame offsets hold at every row height (24px rows, 36px coarse rows, SERVER tiles, 18px picker preview cells). If review finds the jump or a raised blade clipped, the sanctioned escape is spidey's documented taller-strip deviation — but it should not be needed.

**The two figures share ONE sheet** — a single glued scene per frame, not two independently-positioned background layers. The distance between the combatants *changes per frame* (that is what advancing and retreating are), which is precisely what the balanced-layer rule forbids for separate layers ("the traversal keyframes balance each layer's from/to constants so all layers displace by identical px and never separate"). Drawing both figures into each frame is the mold-conforming way to animate a varying gap.

**Frame cycle (10 frames)** — the "few distinct actions" the request asks for, in order:

| # | y-offset | Action |
|---|----------|--------|
| 0 | `0px` | **Guard** — both en garde, blades angled up-inward, gap ~12px, no contact |
| 1 | `-22px` | **Advance** — both step in (gap ~9px), lead feet forward, blades rising toward each other |
| 2 | `-44px` | **High clash** — blades cross high between them in an X; contact point is the brightest pixel pair in the sheet |
| 3 | `-66px` | **Press** — blades still locked in the bind, both torsos leaning in, rear legs braced |
| 4 | `-88px` | **Break, Vader low sweep** — the red blade swings LOW and level at knee height; the blue blade lifts clear |
| 5 | `-110px` | **Jedi jump** — the Jedi is airborne ~5px, knees tucked, blue blade held high; the red blade sweeps beneath his feet |
| 6 | `-132px` | **Land and downstrike** — the Jedi lands on the baseline, blue blade descending; the red blade rises to parry |
| 7 | `-154px` | **Low clash** — blades cross LOW near the baseline, bright contact point again |
| 8 | `-176px` | **Retreat** — both step back (gap ~14px), blades dropping toward guard |
| 9 | `-198px` | **Guard, opposite footing** — back en garde with the other foot forward, so looping to frame 0 reads as continued footwork rather than a snap |

**Colors** (blades are the brightest pixels; figures near-silhouette, per the request):

- **Jedi** — LEFT of the pair, facing right. Light robes `#c8cbd4` with a `#9aa1ae` hood/shadow tone; ~13px tall, 3px head with a hood profile; 1px limb strokes (spidey's proportion language).
- **Vader** — RIGHT of the pair, facing left. A very dark charcoal `#15181f` body with a **1px cool-gray `#4a5262` rim** on the silhouette edge, plus the helmet profile: a domed 4px crown, angular mask front, and flared cheek/neck flanges, with a short 2px cape trailing behind. **This rim is a deliberate deviation from the literal "Vader in black"**: rows are dark by default (the three-mode theme ships dark), and a pure-`#000` silhouette would vanish into the row background. The rim keeps the silhouette read intact on dark *and* light rows while the fill stays near-black, honoring the intent of the instruction.
- **Blue blade** — 1px stroke `#7fe3ff`, full opacity. **Red blade** — 1px stroke `#ff5b5b`, full opacity. Both blades are the only fully saturated, fully opaque strokes in the sheet, so they win the eye at row scale.
- **Clash flashes** (frames 2, 3, 7) — a 2×2 `#ffffff` block at the crossing point, the single brightest mark in the sheet.
- `::after` opacity ~0.95 (blades want more presence than spidey's 0.92; the near-silhouette figures carry the restraint instead).

**Motion — the two `background-position` longhands compose**, exactly as invaders does:

```css
@keyframes rk-flair-duel-wander {
  from { background-position-x: 0%; }
  to   { background-position-x: 100%; }
}
```

- **`-x` — the wander**: `background-position-x: 0% → 100%` with `steps(60, jump-none)` over **30s `alternate`** (60s round trip). Percentage positioning maps image-edge to box-edge, so the wander is box-agnostic with zero transforms — the whole reason invaders uses it. `alternate` gives the side-to-side drift the request asks for; no mirrored artwork is needed because neither figure faces the direction of travel.
- **`-y` — the fight**: the ten frames on `step-end` keyframes over a **5s** cycle, i.e. **0.5s per frame (2fps)** — the "SLOWLY" the request calls for, and slower than every existing character flair (spidey is ~3.3fps, nyan ~6.7fps). **Frame stepping uses an explicit `@keyframes` with eleven stops** (`0%`→`0px`, `10%`→`-22px`, … `90%`→`-198px`, `100%`→`-198px`, the final stop repeating the last frame so the loop does not smear), run `step-end` — NOT `steps()`. `steps()` appears in exactly one place in the whole stylesheet: the invaders *wander*, never a frame stepper.
- **The two cadences are synced 1:1**: 30s ÷ 60 steps = 0.5s per step = exactly one wander step per fight frame, so every footfall lands on an action — the invaders discipline ("each jump landing on the step-end y-wiggle so every step flips an arm"), applied to a fight instead of an arm flip. On a ~300px row each step advances the pair ~5px, which reads as footwork rather than sliding.

Keyframe names follow the register: `rk-flair-duel-wander` / `rk-flair-duel-fight` (invaders uses `-wander`/`-wiggle`; the traversal-flair `-x`/`-y` names belong to the linear-crossing treatments).

**Drawing idiom — use `<defs>` + `<use href='#id'>`.** Ten frames × two figures is the most repetitive sheet in the catalogue, and `invaders` already establishes the compression pattern (`<defs>` holding `#cb`/`#ia`/`#ib` symbols, then `<use>` with `transform='translate(x,y)'` per instance). Define the reusable parts once — Jedi torso/head, Vader torso/helmet, a limb stroke set, the blade strokes — and `<use>` them per frame with per-frame translate/rotate. This keeps the data URI to a few KB instead of ten hand-repeated figure pairs. Each frame is wrapped in `<g transform='translate(0,22n)'>` (the spidey idiom).

**No transforms, no layout-affecting properties** — `background-position` only, on the overlay's pseudos. The cube/warp child-span transform exception is explicitly NOT invoked: everything here is frame art plus a stepped background sweep, which cannot paint outside the element's own box (the drag-ghost rule), so `FlairOverlay` needs no new markup.

**Optional `::before` companion layer** — a faint industrial-corridor backdrop tile (~64px period, ~12px tall, hugging the box bottom in the spidey-skyline pattern: solid silhouette blocks only, two tone depths of neutral `#7a8394` at 0.08 / 0.13 fill — vertical struts and floor grating suggesting a reactor catwalk) on its own `rk-flair-duel-corridor` keyframes, drifting slowly and continuously in ONE direction (not `alternate` — there is no consistent traversal direction to parallax against, so a slow independent drift reads as ambient depth). **Drop this layer if it reads as noise at row scale** — the duel is a two-figure scene and is already busier than any existing flair; the spidey intake carried the same optionality for its companion layer. Never share keyframes with another flair.

### 3. Reduced-motion gate

Append `.rk-flair-duel::before, .rk-flair-duel::after` to the existing `prefers-reduced-motion` enumeration block (`globals.css:1344–1345` is the current spidey pair): `animation: none; display: none`. Flairs are motion-only decoration carrying no semantics, so they are hidden entirely — no static fallback (unlike marker stripes, which remain). Base rules must precede the gate block (source-order rule).

### 4. Consumers pick the value up from the closed sets

- **`FlairOverlay`** (`components/flair-overlay.tsx`) — the class is pure template interpolation (`` `rk-flair-${flair}` ``) with no registry; only `cube` and `warp` get child markup. `duel` renders the bare span, so this file needs **zero source change**. Its test enumerates bare-span flairs (`flair-overlay.test.tsx:15`, currently `["nyan", "spidey"]`) and should gain `duel`.
- **Picker flair band** (`swatch-popover.tsx:81–83`) — registration is automatic: `FLAIR_NAMED = FLAIR_STATES.slice(1)` grows 13 → 14 cells, split column-flow across two fixed 18px rows by `i % 2` (even → row 1, odd → row 2). `duel` takes index 13 — **odd, so it lands in row 2's last column** — making the split **7/7**. Today's split is 7/6, so the *maximum row width stays 7* and the 190px panel geometry cannot regress; this is a strictly safer growth step than the 12 → 13 one the spidey change absorbed. No layout rework expected, and the arrow-key `scrollIntoView` model already tolerates overflow. **Three doc comments in this file carry the count and DO need updating**: `:53`, `:78`, and `:624` all say "the 13 named states".
- **Backend / API** — no route changes. `@rk_flair` (window) and `@rk_session_flair` (session) write paths validate through `ValidateFlairValue`, which derives from the updated `flairTokens`; `settings.go` (`server_flairs`, `normalizeFlairValue`), `windows.go`, `sessions.go`, and the tmux parsers all route through `validate.FlairValues` and need no touch. Constitution IX untouched (no new endpoints, no new verbs).

### 5. Full enumeration sweep (verified at intake)

A `grep -rn "spidey"` sweep plus a review of `git show 8dff5908` (the spidey commit's file set) gives the authoritative lockstep list. All of these need `duel`:

**A. Hard closed-set declarations (a stale one is a functional bug):**
- `app/frontend/src/themes.ts:494` — `FLAIR_STATES`
- `app/backend/internal/validate/validate.go:208` — `flairTokens`
- `app/backend/api/operator.go:444` — the **labeler-agent prompt token list**. This is a live closed-set surface an agent writes `@rk_flair` from; a stale list means agents never emit the new value, and any that guess it get a 400.
- `app/frontend/src/globals.css` — the new `.rk-flair-duel` block + the reduced-motion pair

**B. Doc-comment enumerations and counts:**
- `app/backend/internal/validate/validate.go:273` — the `ValidateFlairValue` comment's value list
- `app/frontend/src/types.ts:68` and `:107` — `WindowInfo.flair` / `ProjectSession.flair` doc lists
- `app/frontend/src/globals.css:482–485` — the flair section-header name list
- `app/frontend/src/globals.css:1320` — `/* Flair overlays (all thirteen named states) … */` in the reduced-motion block → fourteen
- `app/frontend/src/components/swatch-popover.tsx:53`, `:78`, `:624` — three "13 named states" band comments

**C. Tests that hardcode the set (all break on a 14th):**
- `app/frontend/src/themes.test.ts:531–532` — exact `FLAIR_STATES` array equality
- `app/backend/internal/validate/validate_test.go:529` — the valid `@rk_flair` list; `:539` — the invalid-forms list, which should gain `"Duel"` / `" duel "` matching how `"Spidey"` / `" spidey "` were added
- `app/backend/api/operator_test.go:959–960` — the prompt token-list substring assertion
- `app/frontend/src/components/swatch-popover.test.tsx:33` — "The 13 named flair states" comment
- `app/frontend/src/components/swatch-popover.test.tsx:406, 408` — **the total-options arithmetic**: `"…8 markers + 13 flairs + 3 header − + panel − + ✕ = 56 options"` and `toHaveLength(56)` → **57**
- `app/frontend/src/components/swatch-popover.test.tsx:457` — "the flair band lists the 13 states in display order… spidey last" → 14 states, `duel` last
- `app/frontend/src/components/swatch-popover.test.tsx:552`, `:791`, `:798–810` — the keyboard walk: the title "the flair rows walk 7 and 6 columns" becomes 7 and 7, the col-6 clamp on row 1 changes, and the hardcoded left-walk array `["cube","roadrunner","matrix","onepiece","nyan","rain","rain"]` must be re-derived
- `app/frontend/src/components/flair-overlay.test.tsx:15` — bare-span coverage list `["nyan", "spidey"]`
- `app/frontend/src/components/sidebar/index.test.tsx:2069`, `:2077–2080` — "the server picker renders the flair band (13 live cells)", `toHaveLength(13)` → 14, and the `data-flair-value` presence assertion

No new e2e spec is expected. The one flair-touching Playwright file (`app/frontend/tests/e2e/window-marker-gutter.spec.ts` — `expectFlair` helper at `:46`, band header at `:86`, the rain/scan test at `:164`) does not enumerate the closed set, so it should need no change. **If it or any e2e spec IS touched, its sibling `.spec.md` MUST be updated in the same commit** (Constitution → Test Companion Docs).

**D. Sites that enumerate flairs but are ALREADY STALE — explicitly out of scope.** These were not updated by the spidey change (or earlier ones) and still name only `nyan`/`naruto`/`onepiece` or a "12" count. Do NOT chase them as part of this change; fixing drift that predates it would inflate the diff and blur review. Noted here so the sweep does not mistake them for missed lockstep:
`app/backend/internal/tmux/tmux.go:628, 696, 1023, 2317`; `app/backend/api/windows.go:418`; `app/backend/api/sessions.go:169`; `app/frontend/src/api/client.ts:789, 835`; `docs/specs/themes.md:203, 215`; `app/frontend/tests/e2e/window-marker-gutter.spec.md:11, 44`; `docs/wiki/picker-layout-studies.html` (a deliberately frozen design study).

## Affected Memory

- `run-kit/ui/visual-design`: (modify) add the `.rk-flair-duel` catalogue bullet to § Character Flair Overlays after the `spidey` bullet at `:271` (sheet geometry, the 10-frame action cycle, the synced wander/fight cadences, colors including the Vader rim, companion-layer disposition); update the channel value list at `:252`, the "**The thirteen treatments**" count at `:254`, the picker-band count at `:277` and `~:168`, and the "all thirteen overlays" reduced-motion note at `:279`. A § Design Decisions entry is warranted for the two-figure-scene-on-one-sheet rule (why an interaction flair cannot use the balanced-multi-layer pattern) and for the alternate-wander-needs-no-mirrored-art rationale.
- `run-kit/ui/sidebar`: (modify) § Row Flair closed-set enumeration at `:475` gains `duel`; "13 named states" at `:481` → 14.
- `run-kit/architecture`: (modify) the flair enumerations at `:95` (the `@rk_flair` bullet), `:119` (the `internal/validate` row — both the `FlairValues` set *and* the verbatim generated error-copy string), `:196` (the session-flair body union), and `:197` (the window-options `@rk_flair` list) gain `duel`.
- `run-kit/tmux-sessions`: (modify) the `@rk_*` user-option registry rows for `@rk_flair` (`:323`) and `@rk_session_flair` (`:335`) gain `duel`; "thirteen named states" → fourteen.

## Impact

- **Frontend**: `themes.ts` (closed set), `types.ts` (two doc comments), `globals.css` (section-header comment, the new keyframes + `::before`/`::after` block, the reduced-motion gate and its count comment), `swatch-popover.tsx` (three band count comments only — the band itself derives from `FLAIR_STATES`), and five test files. `flair-overlay.tsx` needs **no change at all**.
- **Backend**: `validate.go` one-line closed-set append + its doc comment, `operator.go` prompt token list, two tests. No API surface change.
- **Docs/memory**: four memory files — one new catalogue entry plus count/enumeration touches, and likely one or two new Design Decisions entries.
- **No dependencies added.** The sprite is an inline SVG data URI like every other sheet. This is the largest sheet in the catalogue (38 × 220 = ~8.4k px² of frame area vs spidey's 32 × 240) and will be the longest data URI in `globals.css`; that is a size note, not a concern — it is still a few KB of inline text in an already-large stylesheet.
- **State remains derived** — the flair value lives in `@rk_flair` / `@rk_session_flair` tmux options (Constitution II and X untouched).

## Open Questions

- (none — the request specified the subject, the traversal model, the required actions, and the readability priority; every remaining choice is a graded assumption below, and none scored Unresolved)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The duel lands as a 14th named flair on the `.rk-flair-*` axis | Explicitly directed by the request, and independently settled by the recorded design decision *Character homages land on the flair axis, never a hover treatment* plus the motion-split and always-on-ambient rules | S:95 R:60 A:95 D:95 |
| 2 | Certain | Traversal is the invaders model — `background-position-x: 0%→100%`, `steps(…, jump-none)`, `alternate` | Explicitly requested ("invaders-style alternate traversal suits a duel better than a one-way crossing"); percentage positioning is the documented box-agnostic zero-transform wander, and facing-each-other figures need no mirrored art when the direction reverses | S:90 R:80 A:90 D:85 |
| 3 | Certain | Both figures live on ONE sheet as a single glued scene, not two independently-positioned background layers | The gap between combatants must vary per frame (that IS advancing/retreating), which the balanced-layer rule forbids for separate layers — every layer must displace by identical px and never separate | S:60 R:85 A:90 D:85 |
| 4 | Certain | Frontend `FLAIR_STATES` and backend `flairTokens` move in lockstep, with the full enumeration sweep (operator prompt list, doc comments, six test sites, four memory files) | The two closed sets are the documented validation contract for `@rk_flair` writes — diverging them 400s every write of the new value; the sweep sites were enumerated at intake from the `spidey` grep | S:80 R:85 A:95 D:95 |
| 5 | Certain | Reduced motion hides the flair entirely (`animation: none; display: none`), no static fallback | Explicit standing rule for ALL flairs (motion-only decoration carrying no semantics); the gate block enumerates every flair pseudo | S:85 R:90 A:100 D:100 |
| 6 | Certain | The picker band absorbs the 14th cell with no layout work — `duel` takes odd index 13, landing in row 2's last column for a 7/7 split | The band derives from `FLAIR_STATES.slice(1)` and the split is computed (`i % 2`), not hardcoded; 14 cells keep the maximum row width at 7 — unchanged from today's 7/6 — so the 190px panel geometry cannot regress. Only comments and test expectations move | S:65 R:80 A:90 D:85 |
| 7 | Confident | Flair token is `duel` — one lowercase word naming the scene | Matches the homage-nickname register and avoids the Lucasfilm marks (Lightsaber/Jedi/Vader/Star Wars); `saber` rejected as generic. Stored `@rk_flair` values make a later rename costly (low R), but the pick has a clear front-runner | S:60 R:35 A:80 D:70 |
| 8 | Confident | Sheet is 38 × 220 with ten 22px frames on the standard **centered 22px strip**, not spidey's bottom-anchored 30px deviation | The jump fits by arithmetic (13px figure on a y=20 baseline, +5px lift, blades angled rather than vertical); staying in the mold keeps frame offsets valid at every mounting box height. CSS-only, so reworking to a taller strip is cheap if review finds clipping | S:55 R:80 A:70 D:55 |
| 9 | Confident | The ten-frame action cycle: guard → advance → high clash → press → break/low sweep → jump → land+downstrike → low clash → retreat → guard on opposite footing | The request enumerated the required actions (clashes, a jump over a low swing, advancing/retreating steps); this orders them into a loop that closes cleanly, with the mirrored-footing final frame preventing a visible snap at the loop point | S:70 R:85 A:65 D:60 |
| 10 | Confident | Cadence: 0.5s per frame (2fps, 5s fight cycle) and a 30s one-way wander in 60 steps — exactly one wander step per fight frame, 60s round trip | "SLOWLY" is the only timing signal given, so the numbers are chosen; the 1:1 sync is the documented invaders discipline (every step lands on an action), and 2fps is slower than every existing character flair. Pure CSS constants — trivially tuned at review | S:50 R:90 A:65 D:55 |
| 11 | Confident | Vader is drawn as near-black charcoal `#15181f` with a 1px cool-gray `#4a5262` silhouette rim, rather than pure black | A deliberate, surfaced deviation from the literal "Vader in black": rows ship dark by default, where a pure-`#000` silhouette vanishes into the background. The rim preserves the near-silhouette intent while keeping the figure readable on both dark and light rows | S:40 R:85 A:75 D:60 |
| 12 | Confident | An optional `::before` industrial-corridor backdrop tile (64px period, bottom-hugging, neutral gray at 0.08/0.13, own keyframes, one-direction drift — NOT alternate), to be dropped if it reads as noise | Not requested; added on the spidey-skyline precedent for depth. A one-direction drift is chosen because an alternate wander has no consistent direction to parallax against. Fully reversible — deleting the pseudo costs nothing, which is what carries the grade | S:30 R:90 A:45 D:35 |
| 13 | Confident | The sheet is drawn with `<defs>` + `<use href='#id'>` symbols rather than ten hand-repeated figure pairs | Ten frames × two figures is the catalogue's most repetitive sheet; `invaders` already establishes the `<defs>`/`<use>` compression idiom, and it keeps the largest data URI in `globals.css` to a few KB. Purely an authoring technique — the rendered result is identical either way | S:35 R:95 A:85 D:75 |
| 14 | Confident | Pre-existing stale flair enumerations (`tmux.go`, `windows.go`, `sessions.go`, `client.ts`, `docs/specs/themes.md`, the e2e `.spec.md` counts, the frozen wiki study) stay OUT of scope | They already name only `nyan`/`naruto`/`onepiece` or a "12" count and were not updated by the spidey change either — the drift predates this work. Folding an unrelated cleanup into a vocabulary addition would inflate the diff and blur review; they are enumerated in the intake so the sweep does not mistake them for missed lockstep | S:40 R:95 A:80 D:70 |

14 assumptions (6 certain, 8 confident, 0 tentative, 0 unresolved).

---
type: memory
description: "The screen-break Easter eggs — a one-shot, whole-viewport event layer clipping the .app-root glass with a real evenodd hole, seeded cracks/shards, a 4.2 s timeline, two creatures: a green fist on PR merged (smash), an eye on update available (peek). Derived client-side triggers fire once per identity (runkit-egg-smash/-peek localStorage keys); two global palette entries fire on demand (force, never rate limited); reduced motion never mounts; viewports < 640 px no-op."
---
# run-kit UI — Screen-Break Easter Eggs

**Domain**: run-kit/ui

## Overview

The screen-break Easter eggs are the product's one-shot, whole-viewport **event layer**: when an occasion fires, the screen cracks open, nine glass shards fall away, a creature appears in (or punches out of) the hole, and ~4.2 s later the UI is whole again. It is the viewport-scoped counterpart of the row-scoped flair catalogue ([visual-design](/run-kit/ui/visual-design.md) § Character Flair Overlays) — NOT a 17th flair. The mechanism is documented end-to-end in the design study at `docs/wiki/screen-break-easter-egg-studies.html` (a self-contained, runnable mock — open it in a browser).

Two eggs ship (kp2l):

- **`smash` — the green fist.** Fires when the PR of the *viewed window* flips to **merged**. The fist emerges through the hole and is *released* in front of the app with a drop shadow.
- **`peek` — the eye.** Fires when the top-bar UpdateChip lights (update available). The eye stays clipped inside the hole the whole flight, blinks twice, and its pupil follows the pointer.

Both sprites are original inline SVG — an allusion, never a name or face (the `spidey`/`ironman` IP posture; `app/frontend/src/components/screen-break-sprites.tsx`). The eye's iris gradient reads the instance accent via `var(--color-accent, #5b8af0)`.

## Mount and the glass contract

`<ScreenBreakController />` (the `<ScreenBreak />` layer plus `useScreenBreakTriggers()`) mounts exactly once in `AppLayoutContent` (`app/frontend/src/app.tsx`), as a **sibling of the `.app-root` div** beside `<LayoutCommandPalette />` — never inside `.app-root` and never per route. While idle the layer renders `null` and registers no listeners beyond its store subscription. (kp2l)

The **glass** is the `.app-root` div itself (top bar + routed content + quake drawer + settings dialog). The layout exposes it via a ref callback into the store — `registerGlass(el | null)` / `getGlass()` in `lib/screen-break-store.ts` — never a DOM query by class. While an egg is in flight the layer applies exactly these inline mutations to it:

- `style.clipPath = "url(#rk-sb-appclip)"` — the evenodd hole; the real UI is *removed* inside the hole, not painted over
- the shake `style.transform` (a decaying ±5/±4 px jitter for `t < 0.16`, `"none"` after)
- `style.position = "relative"` — only when its computed position is `static` (under `html.fullbleed` it is already `fixed`) — plus `style.zIndex = "1"`, so the fixed below-group can paint under it

Every mutation is cleared (empty strings) on finish, on unmount, and on cancel; a flight on a route where the glass ref is unregistered (`null`) is a safe no-op.

## Layer stack and clip paths

The layer renders two `position: fixed; inset: 0; pointer-events: none` groups around the glass, all `aria-hidden="true"`, all below the `z-50` palette/toast layers:

| Group | z-index | Contents |
|---|---|---|
| below group | 0 | the dark inside-ground (`#03040a` in both themes) with a radial glow at the impact point in the creature's color; the hole-clipped creature |
| `.app-root` (glass) | 1 (inline, flight-only) | the whole app, clipped by the evenodd hole + shaken |
| above group | 2 | the cracks `<svg>` (clipped by the same evenodd path, so no crack draws inside the hole), the released creature, the shards `<svg>`, the flash overlay |

The layer's `<defs>` holds two `<clipPath clipPathUnits="objectBoundingBox">` elements sharing **one hole string written once per frame** and assigned to both paths:

- `#rk-sb-appclip` — one `<path clip-rule="evenodd" d="M0 0H1V1H0Z {hole}">` (outer rect + hole polygon, normalized 0–1)
- `#rk-sb-hole` — `<path d="{hole}">`

The fist's release (losing the clip alone is not enough — an unclipped element in the below group still paints under the glass) is implemented as **two stacked creature slots**: a hole-clipped slot in the below group and an unclipped slot in the above group, sharing the same per-frame transform, swapping visibility at the release threshold.

Static styling lives in the `§ Screen break` block of `globals.css` (`rk-sb-*` classes — the two fixed groups, ground/flash, crack strokes with their light-theme variant via `html[data-theme="light"]`); every per-frame value (opacities, dash offsets, transforms, the hole `d`, the glass mutations) is written **inline** by the layer.

## Seeded geometry

`app/frontend/src/lib/screen-break-geometry.ts` is a pure, dependency-free port of the study's generator (no DOM, no React). `buildBreak({ W, H, P, R, n = 9, seed = 7, rings = [] })` runs a fixed-seed LCG (`s = (s·1664525 + 1013904223) >>> 0`) and returns:

- **9 radial crack polylines** from the impact point to past the viewport box (radial step 24–64 px, angular jitter ±0.14 rad)
- **ring cracks** at the caller's radii (the layer passes `[1.7R, 2.7R]`; 18 vertices each, per-vertex radius factor 0.88–1.12, angle jitter ±0.075 rad)
- **an 18-vertex jagged hole** — `holePts(h)` alternating crack vertices at `R·h·j` (`j ∈ [0.82, 1.18]`) and mid-angle vertices at `R·h·k` (`k ∈ [0.5, 0.75]`), `R·h` floored at 0.02
- **9 shard sectors** between adjacent cracks (from 0.2R to the final hole edge), each with centroid, unit radial `dir`, `speed ∈ [90, 260]` px, `spin ∈ ±260°`

Plus `normalizeHole(pts, W, H)` (the 0–1 path string), `holePathAt(geo, h)`, `pickImpact(W, H)`, `radiusFor(W)`, and the easing helpers `clamp`/`smooth`/`easeOut`/`easeIn`. **Determinism contract**: identical `{W, H, P, R}` ⇒ byte-identical output (unit-tested); the seed is fixed and only the impact point varies per run.

At fire time the controller picks the impact point uniformly inside the central viewport box (`x ∈ [0.25W, 0.75W]`, `y ∈ [0.25H, 0.75H]`) and `R = clamp(0.105·W, 64, 160)` (~10.5 % of viewport width; sprites scale by `R / 76`). Geometry is generated once per flight; the two SVGs use `viewBox="0 0 W H"` + `preserveAspectRatio="none"`, so a mid-flight resize stretches rather than regenerates.

## The 4.2 s timeline

One `requestAnimationFrame` loop drives `t = clamp((now − startedAt) / 4200, 0, 1)`; there are no `setTimeout`/`setInterval` timers. Per frame:

```
flash      = t < 0.05 ? 1 − t/0.05 : 0     (flash overlay opacity = flash·0.7)
shake      = t < 0.16 ? 1 − t/0.16 : 0     (glass translate(sin(t·420)·5·shake, cos(t·330)·4·shake))
cracks     = easeOut(t / 0.2)              → stroke-dashoffset = len·(1 − cracks)
rings      = easeOut((t − 0.05) / 0.22)    → same on the ring paths
hole       = easeOut((t − 0.05) / 0.15) · (1 − easeIn((t − 0.76) / 0.16))   → hole open amount; ground opacity = min(1, hole·1.6)
shards sp  = clamp((t − 0.07) / 0.45)      → translate(dir·speed·sp + (0, 420·sp²)) rotate(spin·sp); opacity 1 − smooth((sp − 0.45)/0.55) once t > 0.06
em         = smooth((t − 0.22) / 0.3) · (1 − smooth((t − 0.6) / 0.2))       → the creature's emerge amount
cracksFade = 1 − clamp((t − 0.88) / 0.12)  → cracks svg opacity
```

Cracks draw in via `stroke-dasharray = len` / `stroke-dashoffset`, rendered as two stacked path sets per geometry string: a dark 2.4 px stroke (rings 1.6 px at .8 opacity) plus a 0.9 px white highlight translated (0.8, 0.8). Shards are glass-tinted polygons (`rgba(226,232,255,.22)` fill; the light theme swaps to `rgba(255,255,255,.75)` / `rgba(30,41,59,.55)`), never UI copies — there is no pixel capture.

At `t ≥ 1` the loop stops, the glass mutations clear, `finish()` empties the store, and the layer returns to its idle `null` render.

### `smash` — the fist's per-frame rule

`scale = (0.1 + 1.15·em)·(R/76)`, `rotate = (1−em)·−28°`, opacity `1` once `em > 0` and the hole has opened (or it is released); **released at `em > 0.4`** — the inside slot hides, the above slot shows, and both sprites gain `drop-shadow(0 16·em px 20·em px rgba(0,0,0,.65))`. Ground glow: `rgba(34,197,94,.3)`.

### `peek` — the eye's per-frame rule

Never released — clipped to `#rk-sb-hole` for the whole flight, above slot always hidden. `scale = 0.78·(R/76)` (sclera ≈ 1.5× the hole) with `scaleY(1 − b)` where `b = max(blink(0.40), blink(0.585))` and `blink(c) = |t−c| < 0.03 ? 1 − |t−c|/0.03 : 0`. The pupil (`data-part="pupil"`) follows the pointer — offset `clamp((px − P.x)/260, −1, 1)·22` / `clamp((py − P.y)/180, −1, 1)·14` — drifting sinusoidally (`sin(t·9)·16, cos(t·6)·8`) when no pointer has been seen. The pointer comes from the layer's one permitted event listener: a passive `pointermove` on `window` registered only while the eye is in flight, writing a ref, removed on finish. Opacity: `hole > 0.02 ? min(1, hole·2) : 0`. Ground glow: `rgba(192,132,252,.25)`.

## The store — gates and once-per-identity

`app/frontend/src/lib/screen-break-store.ts` is a dependency-free module store: `fire(egg, opts?): boolean`, `subscribe(listener)` (consumed via `useSyncExternalStore`), `getState()` (`{ flight: null | { egg, startedAt, P, R, W, H } }`), `finish()`, `registerGlass`/`getGlass`, and the key constants `SMASH_KEY = "runkit-egg-smash"` / `PEEK_KEY = "runkit-egg-peek"`. `fire` returns `false` with no side effects when:

- `prefersReducedMotion()` is true (the `lib/motion.ts` helper) — the layer never mounts, nothing is written; **no static fallback**
- `window.innerWidth < 640` — the shards need room to fall
- a flight is already in progress — dropped, never queued (palette spam and back-to-back merges both drop)
- a non-force `identity` equals the value stored under the egg's key

A non-force fire with an identity **writes the identity to localStorage BEFORE the flight starts** (try/catch; storage failure still fires). `force: true` (the palette) bypasses the identity check and **writes nothing**. Storage access is try/catch-wrapped; absence (private mode) degrades to "fire".

## Triggers — client-side derived transitions

`useScreenBreakTriggers()` (`hooks/use-screen-break-triggers.ts`, mounted inside `ScreenBreakController`) derives both occasions from data the frontend already receives — no backend change, no `rk` verb, no API route, no tmux option, no trigger file.

- **`smash`** resolves the viewed window from the deepest `useMatches()` params (`server`, `window`) against `SessionContext`'s sessions (the same walk `useGlobalPaletteActions` uses) and watches that window's `prState`: only an **observed** `"open"`/`"closed"` → `"merged"` flip with a defined `prNumber` fires, with identity `String(prNumber)`. The first observation of a window never fires (merged is a terminal state visible forever on old windows); switching windows resets the observed-previous; routes without a `window` param never fire.
- **`peek`** watches `useUpdateNotification()`'s `showChip` and `key`: `showChip` becoming true — **including the first observation with the chip already lit** — or a `key` change while lit, fires with identity `key ?? latest ?? ""` (skipped when empty). The stored `runkit-egg-peek` key is what makes a reload with the chip already showing idempotent; a later release (new key) fires once. Any route.

## Palette entries

Two global entries (every route), built by the pure `buildEasterEggActions(fire)` in `lib/palette/easter-eggs.ts` (the `lib/palette/version.ts` pure-builder pattern) and composed by `use-global-palette-actions.ts`:

| id | label | description | onSelect |
|---|---|---|---|
| `easter-egg-smash` | `Easter egg: Smash` | `the screen cracks open` | `fire("smash", { force: true })` |
| `easter-egg-peek` | `Easter egg: Peek` | `something in there is watching` | `fire("peek", { force: true })` |

Palette fires are `force`: never rate limited, never persisted — the only silent no-ops are the environmental gates (reduced motion, < 640 px, in-flight). No keyboard chord — the palette IS the chord (Constitution V).

## Tests

Colocated Vitest covers the geometry determinism and counts (`screen-break-geometry.test.ts`), the store's gates/identity semantics (`screen-break-store.test.ts`), the layer's mount/cleanup/clip behavior (`screen-break.test.tsx`), the trigger flips (`use-screen-break-triggers.test.tsx`), and the palette builder (`easter-eggs.test.ts`). The e2e spec `app/frontend/tests/e2e/screen-break.spec.ts` proves the palette's Smash entry mounts `[data-testid="screen-break"]` and that it detaches within 6 s with `.app-root` left clean — under `test.use({ contextOptions: { reducedMotion: "no-preference" } })`, since `playwright.config.ts` sets `reducedMotion: "reduce"` globally — and that under the default reduce context the same action never mounts the layer.

## Design Decisions

### The glass is `.app-root`, and the layer is its sibling
**Decision**: The clipped and shaken element is the `.app-root` div in `AppLayoutContent` (top bar + routed content + quake drawer + settings dialog), exposed via a ref callback into the store; `<ScreenBreak />` mounts as its sibling next to `<LayoutCommandPalette />`.
**Why**: `.app-root` is the one persistent element that contains everything the user perceives as "the screen" while excluding the palette, toasts, and server dialogs (fixed siblings), so the whole visible UI cracks and the egg layer can never be clipped by its own glass. `clip-path` on an ancestor clips fixed descendants and `transform` re-anchors them, so the layer must live outside.
**Rejected**: `.app-shell` (`Shell` in `shell.tsx`) — it excludes the top bar, so the crack would stop at the bar's edge, and it has two consumers (AppShell, BoardPage) to wire. A DOM query by class — a ref is explicit.
*Introduced by*: 260915-kp2l-screen-break-easter-eggs

### Stacking: two fixed groups around a temporarily positioned glass
**Decision**: Below group `z-index: 0`, glass `z-index: 1` (with `position: relative` set inline only when the glass computes `static`; under `html.fullbleed` it is already `fixed`), above group `z-index: 2`. All below the `z-50` palette/toast layers.
**Why**: A fixed ground can only paint under `.app-root` if `.app-root` is positioned with a higher z-index; making it a stacking context for 4.2 s is harmless (its internal z-50 popovers simply sit under the pointer-transparent cracks for the flight).
**Rejected**: `z-[70]` above everything — the eggs should never cover a toast or an open palette; the study's stack has the shell in the middle, not at the bottom.
*Introduced by*: 260915-kp2l-screen-break-easter-eggs

### Identity is written before the flight, and force writes nothing
**Decision**: A non-force automatic fire records its identity in localStorage synchronously before starting; a palette (`force`) fire never touches storage.
**Why**: Writing first makes a mid-flight reload idempotent (the transition already counted) and keeps the palette a pure "show me" action that cannot consume a future automatic occasion.
**Rejected**: Writing on finish — a reload during the 4.2 s would replay the egg. Having the palette write the identity — pressing Smash would silently eat the next real merge's celebration.
*Introduced by*: 260915-kp2l-screen-break-easter-eggs

### Shell clip over overlay clip — kept on measurement
**Decision**: The shell clip is kept. Measured 2026-09-16 on the dev rig (headless Chromium — no GPU, so a pessimistic bound; vsync-locked timing may mask sub-frame jank), viewport 1280×800, on a route with a full-width terminal tile: 278 frames over the flight window, median 16.70 ms, p95 16.70 ms, max 16.80 ms — no frame above the 32 ms threshold that would have switched the design to the documented fallback (a fixed dark glass overlay above the shell receives the evenodd clip instead; the hole then reveals the ground through the overlay; shake and shards unchanged). The fallback is not implemented.
**Why**: Removing the UI is what makes the crack read as real; the fallback is only ~90 % as good but never stutters.
**Rejected**: Choosing the overlay up front without measuring — it gives up the effect's best quality on an unverified fear.
*Introduced by*: 260915-kp2l-screen-break-easter-eggs

### e2e opts back into motion explicitly
**Decision**: `screen-break.spec.ts` uses `test.use({ contextOptions: { reducedMotion: "no-preference" } })` for the mount test and the default config (`reducedMotion: "reduce"`) for the never-mounts test.
**Why**: `playwright.config.ts` sets `reducedMotion: "reduce"` globally, so the egg's own gate would hide it from every default-context test — the same opt-back-in five existing specs use.
**Rejected**: Disabling the gate under a test flag — the gate is the feature's accessibility contract and must be what the test exercises.
*Introduced by*: 260915-kp2l-screen-break-easter-eggs

### A one-shot event layer, not a 17th flair
**Decision**: The eggs are a viewport-scoped, one-shot layer mounted at the app root — not another entry in the row-scoped flair catalogue. What carries over from `FlairOverlay` is the *discipline*: `aria-hidden`, `pointer-events: none`, per-frame writes limited to transforms/opacity/filter/SVG attributes, one rAF loop, and a reduced-motion posture of never mounting (no static fallback — a non-animating crack reads as a broken UI).
**Why**: Flairs are row-scoped, persistent, CSS-only, keyed by a tmux option — the wrong shape for a 4.2 s viewport event. The eggs are motion-only, so under `prefers-reduced-motion: reduce` they simply do not exist — the same hide-entirely posture the flairs take.
**Rejected**: A 17th flair keyed by `@rk_win_flair`/`@rk_ses_flair` — flairs are ambient and persistent; the eggs are one-shot and viewport-scoped, and a tmux option is persistent state that would leave the egg "on".
*Introduced by*: 260915-kp2l-screen-break-easter-eggs

### Triggers are derived transitions, never a pushed channel
**Decision**: Both automatic occasions are previous→next comparisons on data the frontend already has (the viewed window's `prState`; the UpdateChip's `showChip`/`key`), fired once per event identity stored per viewer in localStorage. There is no daily cap.
**Why**: A trigger file under `$XDG_STATE_HOME/run-kit/` would be a hand-rolled event queue with a watcher and a consume-once contract — exactly what Constitution II (no state store) and X (hooks carry only the underivable) exist to prevent. A daily cap misfires in the wrong direction: two merges in a day both deserve the fist.
**Rejected**: A trigger file under `$XDG_STATE_HOME/run-kit/`; an `rk tab smash` CLI one-shot (no ephemeral event channel exists — flairs are persistent state and would leave the egg "on"); a Konami code on the terminal (the keys go to the tmux pane); a daily cap.
*Introduced by*: 260915-kp2l-screen-break-easter-eggs

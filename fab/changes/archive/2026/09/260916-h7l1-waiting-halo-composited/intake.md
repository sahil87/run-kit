# Intake: Waiting Halo and Seam Composited

**Change**: 260916-h7l1-waiting-halo-composited
**Created**: 2026-09-16

## Origin

> The waiting halo pulses via a composited pseudo-element ring (transform + opacity) instead of an animated box-shadow, and the board pane's waiting seam via a composited overlay instead of animated border-color, so N waiting agents cost within noise of zero — the ring stays visible and static under reduced motion as today.
>
> Full context lives in `fab/plans/sahil/26-09-16-idle-cpu.md` — read the whole file before starting, especially "## Change 2 — waiting halo and seam without main-thread paint", "## Pre-intake research" R3 (do this first), "## Standing context", "## Decisions of record" (attention stays visible without motion), and the "## Measurements" table. This is change 2 of 5 in the plan — full lane. Use `just perf-idle-cpu` (already merged to main) for before/after acceptance.

One-shot `/fab-new` invocation from a `wt create` worktree (`waiting-halo-composited`) off `main` at `f3f58812`. The plan of record is `fab/plans/sahil/26-09-16-idle-cpu.md` (drafted 2026-09-16 from a `/fab-discuss` session on Electron-app CPU). Change 0 of that plan (the instrument, `260916-yqbo-perf-idle-cpu-instrument`, `just perf-idle-cpu`) is merged to main. Change 1 (flairs, `flair-compositor-only`) runs in parallel from its own worktree and is file-disjoint (different `globals.css` sections, different components). The user directed the **full lane** and asked that the whole pipeline (`/fab-fff`) run after intake.

**Pre-intake research R3 was executed during intake** (results below, § R3 findings). Key corrections to the plan's assumptions: the `/__controls` gallery renders no `StatusDot`, so its PNG baselines are NOT changed surface; the dot no longer has a `done` square (every dot is `rounded-full`), so the "square corners" check is moot; the reduced-motion e2e asserts the static ring via the dot's `box-shadow`, so it must move to the pseudo-element's computed style.

## Why

**The problem.** The desktop app sits at 20–30 % of a core while agents run and nobody touches it. Measured on 2026-09-16 (plan § Measurements, headless Chromium, 30 s idle samples), the renderer's JavaScript is 1–3 % of a core; the rest is **continuous main-thread painting**. The waiting halo is one of the two painters: `/` host overview idles at 3.1 % renderer with 0 style recalcs per 30 s; the same page with 4 injected `.rk-waiting-halo` dots idles at 6.7 % renderer, 1.0 % GPU and **1802 style recalcs per 30 s** (60/s). That is +3.6 points for four dots, and it scales with waiting agents × render sites — one waiting window typically renders 4 dots at once on a desktop tty route (sidebar row, tty tile header, status bar, PANE panel header), so 3 waiting agents ≈ 12 pulsing halos ≈ +10 points of a core for a signal that is supposed to be idle.

**Why it paints.** Both attention animations animate **non-composited** properties: the halo keyframes animate `box-shadow` (spread 1.5 px → 3 px, alpha 55 % → 85 %) and the board-pane seam keyframes animate `border-color`. Blink cannot run either on the compositor, so every frame is a style recalc + paint on the renderer main thread for as long as the agent waits. Only `transform` and `opacity` (and `filter`) animate on the compositor thread with zero main-thread cost per frame.

**What happens if we do nothing.** Every waiting agent costs a constant ~1 point per visible dot for the whole time it waits — the state that is by definition the user's *absence*. Change 1 (flairs) removes the other painter; leaving the halo would keep the "idle app burns CPU" symptom alive exactly when several agents are parked on questions.

**Why this approach.** Decisions of record (plan § Decisions of record): (a) *attention stays visible without motion* — the halo already has a static reduced-motion form (a yellow ring) and whatever replaces the box-shadow pulse must keep the ring visible while waiting; motion is additive, never the only encoding (`docs/specs/status-pyramid.md` § The Channel Model); (b) selection is by **measured marginal gain** against the instrument's ~3-point noise floor, never by code review; (c) the halo's timing, colour and semantics are not in scope — this is a rendering-mechanism swap. A pseudo-element ring animated with `transform: scale()` + `opacity` reproduces the growing-ring look on the compositor; the seam's pulse becomes a full-yellow pseudo-element ring fading over a 55 %-yellow static border. Rejected: removing or slowing the pulse (changes the signal — out of scope by decision); a JS-driven `requestAnimationFrame` pulse (moves the cost, does not remove it); `will-change` on the existing box-shadow rule (box-shadow is never composited, `will-change` cannot make it so).

## What Changes

### 1. `.rk-waiting-halo` → a composited `::after` ring (`app/frontend/src/globals.css` ≈ lines 453–478 at `f3f58812`)

Today:

```css
@keyframes rk-waiting-halo {
  0%, 100% { box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--color-signal-yellow) 55%, transparent); }
  50% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-signal-yellow) 85%, transparent); }
}
.rk-waiting-halo { animation: rk-waiting-halo 1.4s ease-in-out infinite; }
```

Becomes — the class turns the dot into a positioned host and the ring lives on a pseudo-element:

```css
/* Waiting halo = attention overlay (status-pyramid.md § The Channel Model).
   Renders whenever an agent is `waiting`. A constant-YELLOW pulsing ring on a
   ::after pseudo-element (border, not box-shadow) animated with transform +
   opacity ONLY, so N waiting dots tick the compositor, never the main thread —
   an animated box-shadow cost ~1 point of a core per visible dot (2026-09-16).
   The dot's own core hue + shape are untouched (family identity must survive
   attention). `border-radius: inherit` keeps the ring on the dot's silhouette.
   The ring colour is the 85% peak; opacity 0.65 → 1 walks it 55% → 85%.
   Reduced motion: a STATIC 2px yellow ring, no animation (gated below). */
@keyframes rk-waiting-halo {
  0%, 100% { transform: scale(1); opacity: 0.65; }
  50% { transform: scale(1.3); opacity: 1; }
}
.rk-waiting-halo { position: relative; }
.rk-waiting-halo::after {
  content: "";
  position: absolute;
  inset: -1.5px;
  border: 1.5px solid color-mix(in srgb, var(--color-signal-yellow) 85%, transparent);
  border-radius: inherit;
  pointer-events: none;
  animation: rk-waiting-halo 1.4s ease-in-out infinite;
}
```

Geometry: the pseudo box is the dot plus 1.5 px on every side (10 px on a 7 px dot, 12 px on a 9 px flagged dot). At `scale(1.3)` its outer edge reaches ≈ 3 px past a 7 px dot (≈ 3.75 px past a 9 px flagged dot) — the old 3 px spread. Scaling moves the ring's inner edge outward too, leaving a ≈ 1 px gap between the dot and the ring at the peak of the pulse; this "lift-off" is accepted as the composited approximation of the growing shadow (§ Assumptions #1). **Fallback if the eye review of the screenshot pair rejects the gap**: two pseudo-elements animated with `opacity` only — `::before` a static 1.5 px ring at 55 % (`inset: -1.5px`) and `::after` a 3 px ring at 85 % (`inset: -3px`) fading 0 → 1 → 0; both forms are composited and either satisfies acceptance.

Every `StatusDot` host already works as a `::after` host: unflagged dots are bare spans (blockified as flex items by their parents), flagged dots are `relative inline-flex` spans with child spans (an absolutely positioned pseudo is out of flow, so `items-center justify-center` never sees it). No host carries `overflow: hidden`. `position: relative` on the dot does not change the watched-underbar wrapper's containing block (the bar is a sibling of the dot inside the wrapper, not a child).

The existing comment block above the keyframes is rewritten: it currently explains why there is **no `border-radius`** on the rule in terms of a waiting `done` square rendered with `rounded-none` — the dot has no square any more (purple/orange and the done square were retired; every dot is `rounded-full`), and the comment cites a change ID (`260706-y1ar`), which code-quality forbids. The new comment states the compositing constraint (transform/opacity only) and the `border-radius: inherit` rule without citing changes.

### 2. `.rk-waiting-seam` → static 55 % border + a composited `::after` ring (`globals.css` ≈ lines 495–502)

Today:

```css
@keyframes rk-waiting-seam {
  0%, 100% { border-color: color-mix(in srgb, var(--color-signal-yellow) 55%, transparent); }
  50% { border-color: var(--color-signal-yellow); }
}
.rk-waiting-seam { border-color: var(--color-signal-yellow); animation: rk-waiting-seam 1.4s ease-in-out infinite; }
```

Becomes:

```css
/* Waiting seam = the board-pane form of the attention overlay. The pane's own
   3px border (board-pane.tsx switches to border-[3px] and adds this class) is
   the 55% trough; a full-yellow ::after ring over the border fades in and out
   with opacity ONLY (composited), so the seam never ticks the main thread.
   Reduced motion: the border alone at full yellow, the ring hidden (gated below). */
@keyframes rk-waiting-seam {
  0%, 100% { opacity: 0; }
  50% { opacity: 1; }
}
.rk-waiting-seam {
  border-color: color-mix(in srgb, var(--color-signal-yellow) 55%, transparent);
}
.rk-waiting-seam::after {
  content: "";
  position: absolute;
  inset: -3px;
  border: 3px solid var(--color-signal-yellow);
  border-radius: inherit;
  pointer-events: none;
  animation: rk-waiting-seam 1.4s ease-in-out infinite;
}
```

`board-pane.tsx`'s root is already `relative flex flex-col h-full` with no overflow rule; `inset: -3px` on an absolutely positioned pseudo is measured from the padding box, so the ring sits exactly over the 3 px border. `border-radius: inherit` follows the desktop `rounded-md` card (and the square mobile-carousel pane). The focused-AND-waiting variant's `shadow-[0_0_0_1px_var(--color-accent-green)]` box-shadow is static (not animated) and sits outside the border, untouched. `board-pane.tsx` needs **no logic change**; its header comment at line ≈ 41 ("reduced-motion — see globals.css `.rk-waiting-seam`") and the border-precedence comment at ≈ 167–170 stay true and are re-read for wording ("3px pulsing yellow seam" remains accurate).

### 3. Reduced-motion gate (`globals.css` `@media (prefers-reduced-motion: reduce)` block, ≈ lines 2083–2084)

Today:

```css
.rk-waiting-halo { animation: none; box-shadow: 0 0 0 2px var(--color-signal-yellow); }
.rk-waiting-seam { animation: none; border-color: var(--color-signal-yellow); }
```

Becomes — same visual contract (a static 2 px full-yellow ring; a static full-yellow seam), now carried by the pseudo / the border:

```css
/* Waiting overlay → static yellow ring / seam (attention never motion-only). */
.rk-waiting-halo::after {
  animation: none;
  inset: -2px;
  border-width: 2px;
  border-color: var(--color-signal-yellow);
  opacity: 1;
  transform: none;
}
.rk-waiting-seam { border-color: var(--color-signal-yellow); }
.rk-waiting-seam::after { display: none; }
```

Source order matters (the same discipline as today and as `.rk-window-switch-mask`): the base rules and keyframes sit before the reduced-motion block so the equal-specificity overrides win by later source order.

### 4. `status-dot.tsx` — comments only, no logic change

`app/frontend/src/components/status-dot.tsx` keeps appending `rk-waiting-halo` at line 103 unchanged. Three comments describe the halo as a box-shadow and are corrected to the pseudo ring: the file header's ATTENTION bullet ("it is a box-shadow ring layered over ANY tier … Static yellow ring under prefers-reduced-motion"), the inline comment above `const halo` ("a box-shadow ring, static under reduced-motion … box-shadow renders outside the border-box"), and the watched-underbar comment ("the bar clears the waiting halo's 3px box-shadow reach … the halo paints outside the dot's border-box"). The additive contract — the halo never touches the core hue or shape; the class rides the dot element itself — is preserved verbatim in intent.

### 5. e2e: the reduced-motion assertion moves to the pseudo-element (`app/frontend/tests/e2e/agent-next-waiting.spec.ts` ≈ lines 118–155)

The test "waiting halo is a static ring under prefers-reduced-motion" currently proves the static ring by `getComputedStyle(el).animationName === "none"` and a non-`none` `boxShadow` on the dot. After the change the dot has no box-shadow; the assertions become, on `getComputedStyle(el, "::after")`: `animationName === "none"`, `borderTopWidth === "2px"`, and `borderTopColor` not `rgba(0, 0, 0, 0)` (the full-yellow static ring painted). The `Proves:` / `Steps:` intent comment is updated in the same commit (Constitution § Test Intent Comments) — it currently narrates "a visible box-shadow ring remains". The class assertion (`toHaveClass(/rk-waiting-halo/)`) stays. Run with `just test-e2e "e2e/agent-next-waiting"` (one spec per run).

Non-reduced-motion behaviour is additionally probed by the instrument (below): `document.getAnimations()` includes pseudo-element animations, so the instrument's `## animations` histogram must still report the `rk-waiting-halo` and `rk-waiting-seam` animations as `running` — the pulse must not be silently stopped.

### 6. Unit tests — no change expected

`status-dot.test.tsx` (class assertions at lines 154, 163, 170, 175, 291) and `window-row.test.tsx:366` assert only the class string, which is unchanged; jsdom cannot evaluate `globals.css` pseudo-elements or animations, so no new Vitest is added. Run `just test-frontend` to confirm green.

### 7. Acceptance measurement (recorded in `plan.md` as a before/after table)

Instrument: `just perf-idle-cpu <path> [seconds] --url http://127.0.0.1:3000 [--inject <js>] [--reduced-motion]`. **Always pass `--url http://127.0.0.1:3000`** — the live daemon listens there (HTTP 200 verified at intake); this worktree's `rk url` derives `http://0.0.0.0:3524`, which has no listener, so the default would fail to load. Prerequisite: `just setup` in this worktree (`app/frontend/node_modules` is absent; the instrument refuses to start without Playwright). Run one instrument instance at a time (concurrent runs skew each other). Noise floor ≈ 3 points of one core.

The halo probe (8 dots, double the plan's 4-dot probe) — one shell-quoted `--inject` argument:

```js
(() => { const c = document.createElement("div"); c.style.cssText = "position:fixed;top:8px;left:8px;display:flex;gap:6px;z-index:9999"; for (let i = 0; i < 8; i++) { const s = document.createElement("span"); s.className = "rk-waiting-halo"; s.style.cssText = "display:inline-block;width:9px;height:9px;border-radius:9999px;border:1.8px solid #60a5fa"; c.appendChild(s); } document.body.appendChild(c); })()
```

The seam probe — one injected fixed box wearing the pane's classes:

```js
(() => { const d = document.createElement("div"); d.className = "rk-waiting-seam"; d.style.cssText = "position:fixed;top:40px;left:8px;width:240px;height:120px;border:3px solid;border-radius:6px;z-index:9999"; document.body.appendChild(d); })()
```

Runs, each 30 s: (a) `/` plain — the baseline; (b) `/` + halo probe **before** the CSS edit; (c) `/` + halo probe **after**; (d) `/` + seam probe before and after; (e) one tty route (`/<server>/@<id>`) with a live waiting window if one exists at run time (compare before/after), else the tty route + the halo probe. **Pass**: after-runs (c) and (d) have `renderer=` within 3 points of (a) and `recalcs=` within 200 of (a), while `anims=` still reports the injected animations as running (8 for the halo probe, 1 for the seam probe). The plan's 2026-09-16 numbers for reference: `/` 3.1 % renderer, 0 recalcs; `/` + 4 dots 6.7 % renderer, 1.0 % GPU, 1802 recalcs.

`will-change: transform` on the pseudo is **not** added up front: Chromium promotes transform/opacity animations to the compositor on its own. It is added only if run (c) still shows ~1800 recalcs — then re-measure.

### 8. Screenshot pair (visual parity)

One before/after screenshot pair of a waiting dot at 1× and 2× (the sidebar row or an injected dot, mid-pulse and at rest) and one of a waiting board pane, reviewed by eye: only the ring's rendering may differ (sub-pixel edge, the ≈ 1 px peak gap), never the dot's core hue, shape, or the seam's 3 px width. A static-form pair under `--reduced-motion` confirms the 2 px full-yellow ring and the full-yellow seam are unchanged.

## R3 findings (pre-intake research, executed 2026-09-16 against `f3f58812`)

- **Simultaneous waiting dots for one waiting window.** `StatusDot` mounts: `sidebar/window-row.tsx:892` (sidebar row), `surface-layout.tsx:1848` (tty tile header), `status-bar.tsx:921` (desktop status bar — rendered twice: the live segment plus a `decorative` hidden measurement probe copy; a hidden copy's CSS animation still ticks today), `sidebar/status-panel.tsx:233` (PANE panel header, when open), `session-tiles/session-tiles.tsx:178` (server page only), `watched-table.tsx:68` (console only). Typical desktop tty route: 4 visible + 1 probe = 5 halo animations per waiting window.
- **The `done` square is gone.** `status-dot.tsx` renders every dot `rounded-full` (ring, solid, flagged ring, flagged bullseye); the `globals.css` comment about `rounded-none` squares is stale. `border-radius: inherit` on the pseudo remains the correct rule (it also covers the injected 9999 px probe dots).
- **Control gallery is NOT changed surface.** `control-gallery.tsx` imports no `StatusDot` and the spec has no waiting cell; the PNG baselines in `control-gallery.spec.ts-snapshots/` are not regenerated by this change.
- **Reduced-motion e2e couples to `box-shadow`.** `agent-next-waiting.spec.ts` ≈ 118–155 (see § What Changes 5).
- **Seam host is pseudo-ready.** `board-pane.tsx` root: `relative`, no overflow rule, no existing `::before`/`::after`; `.rk-card-border` (the idle border) is a plain `border-color` rule.
- **Live daemon**: `http://127.0.0.1:3000` answers; this worktree's derived `rk url` (`:3524`) does not.

## Affected Memory

- `run-kit/ui/status-signals`: (modify) § Waiting halo (≈ line 110: "pulsing yellow box-shadow ring … box-shadow renders outside the border-box") → the composited `::after` ring, transform + opacity, `border-radius: inherit`; § Watched underbar (≈ 112: "the waiting halo's 3px box-shadow reach") → the ring's 3 px reach; § Call sites (≈ 162: "the halo keyframe is the only bespoke CSS") → keyframe + pseudo rule, and the e2e now asserts the pseudo's computed style; § Board-pane waiting seam (≈ 283) → 55 % static border + composited full-yellow `::after` ring; Design Decisions → "Waiting attention is an additive halo, never a hue-flip" (≈ 456–459: "box-shadow ring") reworded, plus a NEW entry "Attention overlays run on the compositor" recording the 2026-09-16 measurement (+3.6 points and 1802 recalcs / 30 s for four dots) and the rejected alternatives (box-shadow + will-change; JS pulse; dropping the pulse).
- `run-kit/ui/boards` and `run-kit/ui/visual-design`: verify at hydrate — their seam sentences ("3px pulsing amber/yellow seam, `border-[3px]` + `rk-waiting-seam`, static under reduced-motion") remain true; no edit expected.
- `docs/specs/status-pyramid.md`: no change — the channel model is unchanged (attention = additive constant-yellow pulsing halo; reduced motion = static ring). Its one descriptive phrase "the halo owns the perimeter up to 3px of box-shadow" (≈ line 131) is an implementation aside; confirm during hydrate and leave the spec alone unless the human curator wants the word changed.

## Impact

- **Code**: `app/frontend/src/globals.css` (three regions: halo base + keyframes ≈ 453–478, seam base + keyframes ≈ 495–502, reduced-motion overrides ≈ 2083–2084); `app/frontend/src/components/status-dot.tsx` (comments only); `app/frontend/src/components/board/board-pane.tsx` (comment wording check only). No TypeScript logic changes, no new classes, no markup changes, no settings (Constitution IV), no new user action (V).
- **Tests**: `app/frontend/tests/e2e/agent-next-waiting.spec.ts` (one test's assertions + intent comment); `status-dot.test.tsx`, `window-row.test.tsx` unchanged and expected green.
- **Verification** (plan § Standing context — never the full suite as a gate): `cd app/frontend && npx tsc --noEmit`; `just test-frontend` (or the two affected Vitest files); `just test-e2e "e2e/agent-next-waiting"`; the instrument runs in § What Changes 7 with the before/after table recorded in `plan.md`; the screenshot pair in § 8.
- **Runtime**: each waiting dot and seam now owns one compositor layer (a tiny pseudo box) instead of a per-frame main-thread paint; GPU memory impact is negligible at 10–15 px boxes. Tab-hidden behaviour is unchanged (Chromium suspends compositor frames for hidden tabs either way).
- **Parallel change**: change 1 (`flair-compositor-only`) edits `globals.css` § Flair overlays (≈ 670–1846) and the flair rows of the same reduced-motion block; this change touches ≈ 453–502 and the two waiting lines of the block. Merge conflicts are unlikely and, if any, are confined to the reduced-motion block.
- **Out of scope** (plan Non-goals): the halo's timing, colour or semantics; the watched underbar (static already); the status bar's hidden probe copy of the dot (a second animation per status-bar mount — composited, it now costs nothing, so it is left as is); the `Server not found` JS loop (`[a2ep]`).

## Open Questions

- None blocking. The one open aesthetic call — whether the ≈ 1 px lift-off gap at the pulse peak reads acceptably at 1× — is decided by the screenshot pair at apply, with the two-ring opacity-only form as the documented fallback (§ What Changes 1).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Halo = a single `::after` ring animated with `transform: scale(1 → 1.3)` + `opacity 0.65 → 1` (ring colour at the 85 % peak), accepting a ≈ 1 px lift-off gap at the pulse peak; the two-ring opacity-only form is the documented fallback if the screenshot pair rejects the gap | Plan § Change 2 step 1 names transform + opacity on a `::after` ring; the gap is geometric and small at 7 px; both forms composite and either passes acceptance | S:90 R:85 A:80 D:75 |
| 2 | Certain | Reduced-motion form stays a static 2 px full-yellow ring, now rendered by the pseudo with `animation: none`; the seam's reduced-motion form is the full-yellow border with the pseudo hidden | Decision of record "attention stays visible without motion"; today's override is exactly 2 px full yellow; source-order discipline already documented | S:95 R:90 A:95 D:95 |
| 3 | Certain | `/__controls` gallery PNG baselines are NOT regenerated | R3 verified `control-gallery.tsx` renders no `StatusDot` and the spec has no waiting cell, so the drift guard is not changed surface (code-quality § Verification) | S:85 R:95 A:95 D:90 |
| 4 | Certain | Seam = static 55 % yellow `border-color` on the pane's 3 px border + a full-yellow `::after` ring at `inset: -3px` fading `opacity 0 → 1 → 0`; reproduces the old 55 % → 100 % keyframes exactly | The pane root is `relative` with no overflow rule; opacity-only is the cheapest composited form; the trough and peak colours are the old keyframe endpoints | S:85 R:85 A:80 D:75 |
| 5 | Confident | `will-change` is NOT added up front; added only if the after-run still shows ~1800 recalcs, then re-measured | Chromium composites transform/opacity animations without a hint; adding layers speculatively trades GPU memory for nothing measurable; the oracle decides | S:70 R:95 A:70 D:70 |
| 6 | Certain | Every instrument run passes `--url http://127.0.0.1:3000`; `just setup` runs in this worktree first | Verified at intake: `:3000` answers HTTP 200, the worktree's `rk url` (`:3524`) does not; `node_modules` is absent | S:90 R:95 A:95 D:95 |
| 7 | Confident | Acceptance probes: 8 injected halo dots on `/` and one injected seam box on `/`; a live waiting tty window is used when one exists at run time, else the tty route plus the halo probe substitutes | Plan § Change 2 step 4 fixes the 8-dot probe and the "one real check"; a live waiting agent cannot be guaranteed at run time, so the substitute keeps the check executable | S:80 R:90 A:75 D:70 |
| 8 | Certain | The stale `done`-square comment in `globals.css` is rewritten; `border-radius: inherit` on the pseudo is the rule; no change-ID citations in the new comments | R3 verified every dot is `rounded-full`; code-quality forbids comment citations of change IDs | S:85 R:95 A:95 D:95 |
| 9 | Certain | The reduced-motion e2e assertion moves to `getComputedStyle(el, "::after")` (animation-name none, 2 px non-transparent border) with its Proves/Steps comment updated in the same commit | Constitution § Test Intent Comments; the test's purpose (static ring still paints) is unchanged, only the property that proves it | S:85 R:90 A:90 D:85 |
| 10 | Certain | Memory: `ui/status-signals.md` is the only file rewritten (halo, underbar reach, call sites, seam, DD reword + one new DD); `boards.md`, `visual-design.md` and the status-pyramid spec are verified unchanged at hydrate | Plan § Change 2 memory note; the channel model is unchanged; the other files' seam sentences stay true | S:85 R:95 A:85 D:85 |
| 11 | Certain | The status bar's hidden probe copy of the waiting dot (a second animation per mount) is out of scope | Once composited it costs nothing measurable; removing the probe animation would be a status-bar change outside the plan's Non-goals boundary | S:70 R:95 A:80 D:80 |
| 12 | Confident | One scale factor (1.3) serves both the 7 px and the 9 px flagged footprints (the flagged ring reaches ≈ 3.75 px instead of 3 px) | A second keyframe set for flagged dots buys 0.75 px; the flagged dot is rare and the pair review catches anything visible | S:70 R:95 A:75 D:60 |
| 13 | Certain | No new Vitest; existing class assertions stand; the e2e is the behavioural gate and the instrument is the performance gate | jsdom evaluates neither pseudo-elements nor `globals.css` animations (already the documented reason the static-ring check lives in e2e) | S:80 R:90 A:85 D:80 |

13 assumptions (10 certain, 3 confident, 0 tentative, 0 unresolved).

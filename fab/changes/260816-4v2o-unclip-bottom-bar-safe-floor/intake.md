# Intake: Unclip Bottom-Bar Safe Floor

**Change**: 260816-4v2o-unclip-bottom-bar-safe-floor
**Created**: 2026-08-16

## Origin

Conversational (`/fab-discuss` session, 2026-08-16). User reported with an iPhone screenshot:

> The gap that was supposed to be added from the bottom of the phone to prevent the curvature of the iPhone eating up the bottom doesn't seem to be working

The session diagnosed the root cause together (geometry math + git archaeology), the agent proposed the fix shape (content-size the frame; strengthen the e2e to assert real geometry), and the user approved with "go ahead".

## Why

1. **Pain point**: On iPhone (coarse pointer, keyboard collapsed) the bottom-bar chips sit ~3px from the physical screen bottom instead of the intended 16px — the corner arc / home-indicator zone eats into the extreme chips (`⇥` left, `⌨` right). This is exactly the clipping that change 260805-fi9m (PR #523) was shipped to fix, and it is device-confirmed still broken (screenshot 2026-08-16).

2. **Root cause** (verified): the raised safe floor IS applied — the toolbar row's `pb-[max(var(--bottom-bar-floor,0.375rem),env(safe-area-inset-bottom))]` (`bottom-bar.tsx:388`) computes to 16px on coarse pointers with the keyboard collapsed (`globals.css:929-933`). But the row lives inside a **fixed `h-[48px]` frame** (`bottom-bar.tsx:376`, border-box, so the 3px top seam leaves 45px of content). The coarse row needs 6px `pt` + 36px chips + 16px floor = **58px**. The 13px overflow extends below the frame, past the viewport bottom, where `.app-shell`'s `overflow: hidden` clips it. Visible gap below the chips: 45 − 6 − 36 = **3px**. Even the kb-open state (6+36+6 = 48 > 45) is clipped by 3px.

3. **This never worked**: the 48px frame predates the floor — it existed at the call sites since March 2026 (commit `dda9d83b`), PR #523 (2026-08-05) changed only the padding, and PR #598 (2026-08-14, 260814) moved the frame inside `BottomBar` unchanged. The floor has been silently clipped since it shipped.

4. **Why the e2e never caught it**: `bottom-bar-safe-floor.spec.ts` asserts only the toolbar's **computed `padding-bottom`** (which really is 16px) — never the chips' actual rendered distance from the viewport bottom. The clipping is invisible to a computed-style assertion.

5. **Consequence of not fixing**: mobile users keep losing the bottom-row chips under the corner arc; memory (`visual-design.md` § Safe-Area Insets) continues to document a clearance that doesn't exist ("Accepted cost: flat-screen touch devices spend ~10px of terminal height they didn't need" — they never spent it).

## What Changes

### 1. Content-size the bottom-bar frame (`app/frontend/src/components/bottom-bar.tsx`)

Replace the fixed height on the frame div (currently line 376):

```tsx
// before
<div className="border-t-[3px] border-border px-1.5 h-[48px]">
// after
<div className="border-t-[3px] border-border px-1.5 min-h-[48px]">
```

- `min-h-[48px]` (not bare content-sizing) pins today's minimum so no state renders shorter than the current bar; the frame grows to content where the floor needs room.
- Resulting heights (coarse, the only pointer type that renders the bar per 260814-ldbs): keyboard collapsed → 3px seam + 6px pt + 36px chips + 16px floor = **61px**; kb-open → 3+6+36+6 = **51px**. The Shell grid's `bottombar` row is `auto`-sized, so the terminal column shrinks accordingly and xterm's FitAddon re-fits on the resize.
- The PR #598 invariant is untouched: the frame stays INSIDE `BottomBar` behind the single `if (!coarse || composeFocused) return null` predicate — no reserved height when hidden. Both render sites (app shell footer and the board twin) get the fix for free.
- Update the frame's code comment (it currently says "3px seam + 48px row") to state the min-height + content-growth contract and why fixed height must not return (it clips the safe floor).

### 2. Verify no fixed-48px consumers remain

Grep for `h-[48px]` / hardcoded 48 assumptions tied to the bottom bar (unit tests asserting the class, layout math, board twin call-site comments). Update any that assert the old fixed height. The call-site comments in `app.tsx` / `board-page.tsx` mention "48px frame" — adjust wording if they state fixed height.

### 3. Strengthen the e2e (`app/frontend/tests/e2e/bottom-bar-safe-floor.spec.ts`)

Keep the existing computed-`padding-bottom` assertions, and ADD real geometry assertions in the touch describe (hasTouch, 375×812):

- Keyboard collapsed: the toolbar's last chip's bounding box must end ≥ 16px above the viewport bottom — `812 - (box.y + box.height) >= 16` (assert against the known `RAISED_FLOOR`).
- With `html.kb-open` set: the gap reverts toward the base floor — `>= 6` and `< 16`.
- This is the assertion class that would have caught the clipping: it measures rendered position, not style.

### 4. Update the sibling `.spec.md` (constitution: Test Companion Docs)

`app/frontend/tests/e2e/bottom-bar-safe-floor.spec.md` — document the new geometry assertions (what they prove: the floor is visible screen gap, not just computed padding; steps mirroring the test body).

### 5. Gate the `env()` arm on keyboard-collapsed (amendment, 2026-08-17)

Device-confirmed after the frame fix released (iPhone screenshot, installed PWA, keyboard open): the pad stays ~34pt above the keyboard. Root cause: standalone PWA mode is the one environment where `env(safe-area-inset-bottom)` reports the real 34pt home-indicator inset — and `env()` is layout-viewport-based, so it KEEPS reporting 34pt while the keyboard covers that zone. `kb-open` correctly drops the floor arm to 6px, but `max(6px, 34pt)` keeps the full pad. The "genuine inset reporting still wins" premise (260805-fi9m) is wrong in exactly the kb-open state.

Fix: move the whole pad into a `globals.css`-owned property so the keyboard gate covers BOTH arms:

```css
:root { --bottom-bar-pad: max(var(--bottom-bar-floor, 0.375rem), env(safe-area-inset-bottom)); }
html.kb-open { --bottom-bar-pad: var(--bottom-bar-floor, 0.375rem); }
```

The toolbar row becomes `pb-[var(--bottom-bar-pad,0.375rem)]`. Keyboard collapsed: unchanged everywhere (floor in-browser, real inset wins in the PWA). Keyboard open: flat 6px in both. Existing e2e computed-padding assertions (16px collapsed / 6px kb-open, Chromium env()=0) hold unchanged; the env arm stays out of e2e reach (device-verified only). Compose strip audited: no `env(safe-area-inset-bottom)` usage — the bar is the sole bottom-edge consumer.

## Affected Memory

- `run-kit/ui/compose-and-bottom-bar`: (modify) Frame description (`px-1.5 h-[48px]` → `min-h-[48px]` content-growth) in the bar-anatomy paragraph and the row-geometry paragraph; note the clip-vs-floor interaction (a fixed frame height silently swallows the floor).
- `run-kit/ui/visual-design`: (modify) § Safe-Area Insets bottom-bar bullet — add the constraint that the floor is only real if the frame height accommodates it; correct the "Accepted cost ~10px" line (the cost is now actually paid: ~13px of terminal height on coarse/collapsed).

## Impact

- **Code**: `app/frontend/src/components/bottom-bar.tsx` (one class + comment), possibly `app/frontend/src/app.tsx` / `board-page.tsx` comment wording, any unit test asserting `h-[48px]`.
- **Tests**: `app/frontend/tests/e2e/bottom-bar-safe-floor.spec.ts` + `.spec.md`.
- **Behavior**: coarse-pointer bar grows 48→61px (collapsed) / 48→51px (kb-open); terminal loses that height on phones — the cost 260805-fi9m already declared and believed paid. Fine pointers unaffected (bar doesn't render).
- **Memory**: two ui files (above). No spec impact.

## Open Questions

*(none — root cause verified in-session, fix shape approved by user)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Root cause is the fixed `h-[48px]` frame clipping the raised floor (not the floor CSS, not kb-open detection) | Verified: geometry math (45px content vs 58px need), git history (frame predates floor, #523 never touched it), screenshot matches predicted 3px gap | S:90 R:90 A:95 D:95 |
| 2 | Confident | Fix = `min-h-[48px]` on the frame (content growth) rather than bare auto height or a calc() height | Discussed — user approved "let it size to content... or keep min-h-[48px]"; min-h pins today's minimum, inner paddings already define geometry, Shell row is auto | S:70 R:85 A:80 D:70 |
| 3 | Confident | E2E adds bounding-box gap assertions (≥16 collapsed, ≥6 and <16 under kb-open) alongside the kept computed-padding checks | Proposed in-session and approved; measures the property the user actually reported | S:75 R:90 A:85 D:80 |
| 4 | Confident | Nothing else depends on the bar being exactly 48px (Shell `bottombar` grid row is auto; FitAddon handles resize) | Strong signal from PR #598's design notes; verified at apply via grep (What Changes §2) — easily reversed if a consumer surfaces | S:60 R:85 A:75 D:75 |
| 5 | Confident | The keyboard-open pad leak is the `env()` arm in standalone PWA mode (inset stays 34pt under the keyboard), not a `kb-open` signal failure | Screenshot geometry matches max(6px, 34pt); no-browser-chrome screenshots indicate PWA; env() is layout-viewport-based by spec; also retro-explains the generous collapsed gap | S:75 R:85 A:80 D:75 |
| 6 | Confident | Fix = globals.css-owned `--bottom-bar-pad` with a `html.kb-open` floor-only override, consumed via `pb-[var(--bottom-bar-pad,0.375rem)]` | Discussed — user approved; single-place geometry (the drift-prone two-place mirror was rejected in this change's own DD); existing e2e assertions hold unchanged | S:80 R:90 A:85 D:80 |

6 assumptions (1 certain, 5 confident, 0 tentative, 0 unresolved).

# Intake: Custom GIF Flair Slot

**Change**: 260825-eust-custom-gif-flair-slot
**Created**: 2026-08-25

## Origin

Conversational session following the `260825-axzg-ironman-nuke-catch-flair` change. The user asked whether a user-supplied animated GIF can run looping as a row flair:

> Imagine that I will give you the GIF, right? I just want to make sure that it can run on the loop as a FLAIR. Is that possible?
> [after confirmation] This is the GIF I was talking about. Use this and then create a flare out of it. Let's see how it goes.

The user supplied a real asset: `.uploads/260825150721-ezgif.com-crop.gif` (640×360, 14MB, GIF89a) — a clip cropped from film footage. A dedicated feasibility research pass (run earlier this session as a background agent) mapped the design space and endorsed exactly one shape, which this change implements: a **user-supplied "custom flair" slot** — one new closed-set token whose image asset lives in the user's config dir at runtime and is **never committed to the repository**.

**Copyright boundary (binding, from the research)**: the mechanism is content-neutral infrastructure. The repo ships no image asset; the catalogue's "original pixel art, no copyrighted assets" invariant holds for everything IN the repo. What a user loads into their own instance's config dir is outside the repo and on their side. `.uploads/` is verified gitignored (the user's source file cannot enter a commit), and no task in this change may `git add` any image file.

## Why

The 14 CSS flairs are drawn, catalogue-owned decorations. Users also want *their own* moving image on a row — the request that keeps recurring is "take this clip I have and loop it on the row." Embedding such content in the repo is categorically off (copyright + the research's five-way cost analysis), but a runtime slot the user fills themselves is clean: the repo gains only a token, a serve route, one CSS rule, and a reduced-motion guard. Without this change there is no sanctioned way to run a personal animated image as a flair, and the pressure lands on the wrong door (committing binaries to the catalogue).

## What Changes

### 1. New flair value `custom` in both closed sets (lockstep)

- `app/frontend/src/themes.ts` — append `"custom"` to `FLAIR_STATES` (after the branch's last token, `"spidey"` — this change branches from `origin/main` and does NOT contain the ironman PR #739; a trivial adjacent-line merge conflict between the two open PRs is expected and accepted, whichever lands second appends after the other).
- `app/backend/internal/validate/validate.go` — append `"custom"` to `flairTokens` (same position note).

Same append-only, lockstep discipline as every catalogue addition. On this branch the picker renders 14 named cells (computed 7/7 alternating split) with zero component change; after both PRs merge it is 15 (8/7).

### 2. Asset convention: fixed config-dir filenames, no upload surface

Convention over configuration (Constitution VII) and minimal surface area (Constitution IV — no new settings key, no upload UI/endpoint): the server looks for the asset at a **fixed path in the config root**, checked in preference order:

1. `~/.config/run-kit/custom-flair.webp` (preferred format — full alpha, smaller)
2. `~/.config/run-kit/custom-flair.gif`

The user places the file there by hand (documented in the route's code comment and memory). No settings-registry key, no path configuration — fixed filenames only, so no user-controlled path ever reaches the filesystem API (Constitution I: no traversal surface).

### 3. Serve route: `GET /api/flair/custom`

A single read-only route in the Go backend:

- Reads the file **at request time** from the fixed paths above (Constitution II — derive from the filesystem, no cache; a deleted file 404s on the next request).
- `Content-Type` from the matched extension (`image/webp` / `image/gif`); content-derived `ETag`; `Cache-Control: no-cache` (the file can change; ETag makes revalidation a 304).
- **404 when absent** — the `custom` token is inert until a file exists (a failed CSS background fetch paints nothing; no client error handling needed).
- Add the route to the Vite dev-proxy config (`app/frontend/vite.config.ts`, mirroring the `/generated-icons` proxy entry) so `just dev` serves it.

### 4. `.rk-flair-custom` treatment in `globals.css`

- `::after` with `background-image: url("/api/flair/custom")`, `background-size: cover; background-position: center`, and a readability scrim: `opacity: 0.4` on the pseudo so row text stays legible over full-motion footage (a tunable constant with a comment).
- The animation is the image's own (GIF/WebP loop flag) — **no keyframes, no `animation:` property**. The overlay contract holds (absolute inset-0, z-5, pointer-events-none, overlay-owns-clip).
- Cover (not the 22px height-locked strip) because the expected content is full-bleed rectangular footage; a film-strip repeat of a movie frame read as the worse default in the research. Recorded as a design decision with the strip as the rejected alternative.

### 5. Reduced-motion: JS gate in `FlairOverlay` (deliberate component change)

CSS `animation: none` cannot pause a raster's own loop, so for `flair === "custom"` ONLY, `FlairOverlay` short-circuits to `null` under `matchMedia("(prefers-reduced-motion: reduce)")` — no element, no decode. The CSS gate block also gains `.rk-flair-custom::after` for uniformity. This is a sanctioned exception to the "flairs need no component change" norm and to the sidebar memory's "the animation itself is CSS-only" claim — both get memory updates. The media query is read via the component's existing render path (a module-level `matchMedia` read is acceptable v1; no listener/re-render machinery — the value changes only with OS settings, and the next mount reflects it).

### 6. Tests

- Closed-set enumerations gain `custom`: `themes.test.ts`, `validate_test.go`, `flair-overlay.test.tsx`, `swatch-popover.test.tsx`, `sidebar/index.test.tsx`, plus the `operator.go` help text / `types.ts` JSDoc enumerations touched by prior flair additions.
- New Go handler test: route 404s when no file, serves with correct content-type/ETag when a fixture exists (write a tiny generated 1×1 GIF fixture in the test — generated bytes, not a committed binary asset).
- `flair-overlay.test.tsx`: the `custom` reduced-motion short-circuit (mock `matchMedia`), and the bare-span shape for `custom` when motion is allowed.

### 7. Local seeding (session action, NOT part of the commit)

After the change lands, copy the user's supplied file to `~/.config/run-kit/custom-flair.gif` on this machine so their instance shows their clip when they pick `custom`. This is machine-local setup — explicitly not a repo artifact and not a task that touches git.

## Affected Memory

- `run-kit/ui/visual-design`: (modify) new `custom` entry in § Character Flair Overlays (runtime-asset flair: serve route, cover+scrim, loop owned by the image; counts 14→15); amend the "no external requests, no copyrighted assets" invariant to note the same-origin runtime asset exception (repo still ships no image); reduced-motion section gains the JS-gate note.
- `run-kit/ui/sidebar`: (modify) § Row Flair enumeration gains `custom`; amend the "animation is CSS-only, no JS" claim with the custom-slot exception.
- `run-kit/architecture`: (modify) new route in the API surface list; validate closed-set enumeration gains `custom`.
- `run-kit/tmux-sessions`: (modify) `@rk_flair` value list gains `custom`.
- `run-kit/configuration`: (modify) the config-root inventory gains the fixed `custom-flair.webp|gif` filename convention (a config-dir file that is not a settings key).

## Impact

- **Backend**: one new GET route + handler test; one-line closed-set append + test. No POST surface, no settings key, no state store (file read at request time).
- **Frontend**: `themes.ts`, `globals.css` (one rule + gate entry), `flair-overlay.tsx` (the deliberate JS reduced-motion gate), `vite.config.ts` (dev proxy), tests.
- **Docs/memory**: five files.
- **No repo binaries, no dependencies.** The 14MB user GIF stays in `.uploads/` (gitignored) and `~/.config/run-kit/` (outside the repo).

## Open Questions

- (none — the design was resolved by the research pass and the user's explicit confirmation of the bring-your-own-GIF shape)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The asset is NEVER committed; the repo gains only content-neutral infrastructure | The research's binding boundary; `.uploads/` verified gitignored; user's file is film footage that must not ship in the binary | S:85 R:90 A:95 D:95 |
| 2 | Confident | Fixed config-dir filenames (`custom-flair.webp` then `.gif`), no upload UI and no settings key | Constitution IV (one settings surface, resist creep) + VII (convention over configuration); an upload endpoint was the research's sketch but the fixed-path variant is strictly smaller and serves the same need | S:65 R:75 A:85 D:70 |
| 3 | Confident | Serve route reads the file at request time, 404-when-absent, ETag + no-cache | Constitution II (derive from filesystem, no cache); mirrors the SPA's non-hashed-asset caching posture from the research | S:70 R:85 A:90 D:85 |
| 4 | Confident | `background-size: cover` + center + `opacity: 0.4` scrim (tunable), not the 22px height-locked strip | Expected content is full-bleed footage; a tiled film-strip read worse; opacity keeps row text legible per the research's layering warning | S:55 R:90 A:70 D:60 |
| 5 | Certain | Reduced-motion for `custom` is a JS mount gate in FlairOverlay (plus the CSS enumeration entry) | A raster's loop cannot be paused by CSS; skipping the mount is the only guarantee — the research's explicit finding | S:80 R:85 A:90 D:90 |
| 6 | Certain | Both closed sets updated in lockstep; picker absorbs the 15th cell via the computed 8/7 split | The documented validation contract; the split is computed by index parity (verified in code this session) | S:80 R:90 A:100 D:95 |
| 7 | Confident | Single shared slot (one file = one custom flair instance-wide), not per-row asset selection | The flair value vocabulary is a closed set by design; per-row assets need a value→asset mapping and an unbounded surface — out of v1 scope; the slot can grow later without breaking the token | S:60 R:70 A:75 D:65 |
| 8 | Confident | The user's 14MB 640×360 GIF is seeded as-is locally, with a recorded recommendation to re-export at ~64px height for memory weight | The slot must serve whatever the user provides (their side of the boundary); the weight warning is advisory, from the research's decode-cost analysis | S:70 R:85 A:80 D:80 |

8 assumptions (3 certain, 5 confident, 0 tentative, 0 unresolved).

# Intake: Tile Content Zoom with Gesture Triggers

**Change**: 260823-cwvv-tile-content-zoom-gestures
**Created**: 2026-08-23

## Origin

Synthesized from a discussion session (dispatched promptless via /fab-proceed — no questions asked; open decisions deferred to the Assumptions table). The discussion covered a 4-item agenda; items 1–3 are in scope, item 4 was explicitly severed out of scope (see Exclusions under What Changes).

> Feature: content zoom on the terminal tile and the web tile, with shared gesture triggers. (1) Resolve the naming collision with the existing tile-maximize "Zoom" verb. (2) Give the web tile a content-zoom mechanism (scale wrapper) with a browser-chrome control and palette actions. (3) Add shared gesture triggers — Ctrl/Cmd+wheel and touchpad pinch — to both tiles. Item 4 (claiming Cmd/Ctrl+Plus/Minus/Digit0 shortcuts, Electron setZoomFactor) severed out of scope.

Current state verified in code during the discussion (re-verified at intake):

- The terminal tile already has content zoom as font-size stepping: `ChromeContext.terminalFontSize` (`app/frontend/src/contexts/chrome-context.tsx`), persisted to localStorage key `runkit-terminal-font-size` (chrome-context.tsx:15), device default 11px mobile / 13px desktop, applied live to xterm via `options.fontSize` (`app/frontend/src/components/terminal-client.tsx:554`). Its only triggers today: palette actions `terminal-font-increase`/`terminal-font-decrease`/`terminal-font-reset` (`app/frontend/src/hooks/use-global-palette-actions.ts:104-106`), the settings dialog, and the overflow-menu `TerminalFontMenuRow` (`app/frontend/src/components/top-bar.tsx:2449`, id `terminal-font`, menu-only, modes terminal+board).
- The web tile (`app/frontend/src/components/iframe-window.tsx`, ~760 lines) has zero zoom machinery.
- Neither tile has gesture triggers: no Ctrl/Cmd+wheel handler, no pinch handler. The terminal's touch handler translates swipes into tmux SGR scroll sequences (terminal-client.tsx:637+) and must not be broken.
- Web-tile addresses have four kinds (`app/frontend/src/lib/web-url.ts` `classifyAddress`): `present`, `proxy`, `relative` (all same-origin — loopback URLs ride `toProxySrc` → `/proxy/{port}`) and `external` (cross-origin absolute http(s) URLs).
- "Zoom" is already a taken term in the UI: the tile-header `ZoomGlyph` (`app/frontend/src/components/top-bar-icons.tsx:138`) and the palette's `Layout: Zoom`/`Unzoom` entries mean *maximize a tile* (surface-layout.tsx R6 transient zoom state).

## Why

1. **Pain point**: The web tile has no content zoom at all — an embedded code-server tile, a docs site, or a proxied dev server renders at whatever size the guest page picks, with no way to magnify or shrink it. The terminal tile *has* content zoom (font stepping) but only via palette/menu/settings — none of the muscle-memory gestures (Ctrl/Cmd+wheel, touchpad pinch) that every browser and editor honors. And the term "Zoom" is already claimed by the tile-maximize verb, so adding content magnification without resolving the vocabulary creates two different "Zoom"s in the palette and tile chrome.

2. **Consequence of not fixing**: Web tiles stay unreadable-or-cramped with no recourse (the `external` kind cannot even be helped by browser page zoom, since that zooms the whole dashboard); users keep reaching for pinch/Ctrl+wheel on the terminal and getting nothing; and the first future feature that says "zoom" doubles down on the naming collision.

3. **Why this approach**: The scale-wrapper mechanism is the only one that covers all four address kinds including cross-origin `external`, and it reproduces real browser-zoom semantics (shrinking the iframe's CSS viewport so responsive guest layouts adapt). Gesture triggers step the *existing* per-surface zoom state rather than inventing a parallel one. The rejected alternative — injecting CSS `zoom` into the guest document — is same-origin only and reaches into proxied content (prior scar tissue: the proxy HTML-rewrite stale Content-Length incident).

## What Changes

### 1. Naming disambiguation (discussion item 1)

**Resolved**: the tile-maximize verb is renamed, and "Zoom" becomes the content-magnification vocabulary on both surfaces. <!-- clarified: user chose option 2 (rename tile-maximize) over the per-surface-naming working default -->

- The tile-maximize verb (`ZoomGlyph` in the tile header, palette `Layout: Zoom`/`Unzoom`, the surface-layout R6 transient state) gets a new user-facing name — working label **"Expand"** (`Layout: Expand`/`Restore`; see Assumptions #13 for the exact-label decision). Palette action **ids** stay stable where they persist in user macros/overrides; only user-facing labels change.
- Content magnification is user-facing **"Zoom"** everywhere: the web tile's control and palette actions (`Web: Zoom in`/`Zoom out`/`Reset zoom`), and the terminal's existing font actions MAY adopt zoom vocabulary in labels while keeping their existing action ids (`terminal-font-*`).

### 2. Web-tile content zoom (discussion item 2)

**Mechanism — scale wrapper on the iframe** in `iframe-window.tsx`. For zoom level `s`, render the iframe at:

```css
width: calc(100% / s);
height: calc(100% / s);
transform: scale(s);
transform-origin: 0 0;
```

- Works for all four address kinds (`present`/`proxy`/`relative`/`external`) — no reaching into the guest document.
- Gives correct browser-zoom semantics: zooming in shrinks the iframe's CSS viewport so responsive guest layouts adapt like real browser zoom.
- **Rejected alternative**: injecting CSS `zoom` into the guest document — same-origin only, and reaches into proxied content (prior scar: proxy HTML-rewrite stale Content-Length).

**Controls**:
- A zoom control in the web tile's browser chrome (next to the address bar / FindBar area) — the universal floor trigger, and the only trigger that works over an `external` iframe.
- Palette actions for parity (Constitution V — every UI-reachable action must be palette-registered): Web-surface zoom in / zoom out / reset (working labels `Web: Zoom in` / `Web: Zoom out` / `Web: Reset zoom`; final labels follow the naming resolution above).
- The shared-FindBar / ⌘F ttyOnly-webOnly precedent is the template for per-surface implementations of a shared control shape.

**Persistence** (Constitution IV — per-viewer state lives in localStorage; no new settings surfaces): web zoom is per-viewer localStorage, keyed by target origin (or proxy port for `proxy`/loopback kinds) — matching browser per-origin zoom expectations; a code-server tile and a docs site want different levels.

### 3. Shared gesture triggers (discussion item 3)

Ctrl/Cmd+wheel and touchpad pinch (pinch arrives as a `wheel` event with `ctrlKey: true`; Safari additionally needs `gesturestart`/`gesturechange`) via **non-passive** listeners calling `preventDefault`, stepping the surface's zoom:

- **Terminal**: listener on the xterm container; steps `terminalFontSize` (the existing per-device global — reusing the existing increase/decrease/reset semantics and bounds). Must not break the terminal's existing touch-scroll-to-tmux handler (terminal-client.tsx:637+) or xterm's own wheel handling — only ctrl-modified wheel and `gesture*` events are intercepted.
- **Web tile**: the parent document can't see wheel events over an iframe, so for same-origin kinds (`present`/`proxy`/`relative`) attach the listener to `iframe.contentWindow` on load (no proxy HTML rewriting). For the `external` kind gestures are unreachable — accepted platform limit; degrade to the header control / palette actions.

### 4. Terminal persistence unchanged

The terminal font stays the existing single per-device global (`runkit-terminal-font-size`); gestures are a new trigger for the existing state, not a new per-window state.

### Constraints

- Constitution V (keyboard-first, palette as complete action registry): all new actions register in the palette.
- Constitution IV: per-viewer state in localStorage; no new settings surfaces.
- Do not break the terminal's existing touch-scroll-to-tmux handler or xterm wheel handling.
- code-review.md: new keyboard shortcuts must be documented in the command palette registration; UI changes should include Playwright e2e where possible; Test Companion Docs rule (`.spec.md` siblings for any new/modified `.spec.ts`).

### Explicit exclusions (out of scope — severed discussion item 4)

- Claiming Cmd/Ctrl + Plus/Minus/Digit0 keyboard shortcuts: deliberately shell-owned/browser-reserved (`app/frontend/src/lib/keybindings.ts:386-388` — `Digit0`/`Equal`/`Minus` at `cmd` tier, owner `shell`, label "zoom" — and `use-global-palette-actions.ts:98`'s deliberate no-claim comment). Reversing that reservation is a separate future decision.
- Electron desktop-shell `webContents.setZoomFactor` for zooming `external` tiles in the desktop app.

## Affected Memory

- `run-kit/ui/lenses-and-layout`: (modify) Web tile (IframeWindow) gains content zoom — scale wrapper, browser-chrome control next to the address bar/FindBar, per-origin localStorage persistence, same-origin contentWindow gesture attachment, `external`-kind degradation.
- `run-kit/ui/terminal`: (modify) Terminal font-size preference gains gesture triggers (Ctrl/Cmd+wheel + pinch on the xterm container); touch-scroll handler documented as untouched.
- `run-kit/ui/keyboard-and-palette`: (modify) New web-surface zoom palette actions (webOnly per the FindBar precedent), gesture-trigger documentation, and the content-zoom vs tile-maximize naming disambiguation.
- `run-kit/ui/top-bar`: (modify) Only if the naming resolution touches `ZoomGlyph` / the shared control-glyph register in `top-bar-icons.tsx` or the `TerminalFontMenuRow` labeling — otherwise unchanged.

## Impact

- `app/frontend/src/components/iframe-window.tsx` — scale wrapper, zoom state, browser-chrome control, contentWindow gesture attachment (largest touched area).
- `app/frontend/src/components/terminal-client.tsx` — gesture listener on the xterm container stepping `terminalFontSize`; must coexist with the touch-scroll handler at :637+ and xterm wheel handling.
- `app/frontend/src/contexts/chrome-context.tsx` — possibly exposes step helpers reused by the gesture path (terminal side); no schema change to `runkit-terminal-font-size`.
- `app/frontend/src/hooks/use-global-palette-actions.ts` (or the web-surface action registration site) — new palette actions.
- `app/frontend/src/lib/web-url.ts` — read-only consumer (`classifyAddress` gates gesture attachment vs degradation); no change expected.
- New per-origin localStorage key for web zoom (per-viewer; no backend involvement — no API, no Go changes).
- Tests: Vitest units for zoom-step/persistence logic; Playwright e2e where possible with `.spec.md` companions.

## Open Questions

- ~~What is the final user-facing vocabulary?~~ **Resolved 2026-08-23**: rename the tile-maximize verb; "Zoom" means content magnification everywhere (see Assumptions #6, Clarifications session below).

## Clarifications

### Session 2026-08-23

**Q**: Final user-facing vocabulary — per-surface content-zoom names with `Layout: Zoom` untouched (working default), or rename the tile-maximize verb and let "Zoom" mean content magnification everywhere?
**A**: Rename the tile-maximize verb (option 2). "Zoom" = content magnification on both surfaces; palette action ids stay stable, labels change. Working replacement label "Expand" recorded as new Confident assumption #13.

### Session 2026-08-24 (bulk confirm)

| # | Action | Detail |
|---|--------|--------|
| 7 | Confirmed | — |
| 8 | Confirmed | — |
| 9 | Confirmed | — |
| 10 | Confirmed | — |
| 13 | Confirmed | — |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Web-tile zoom mechanism is a scale wrapper on the iframe (`width/height: 100%/s`, `transform: scale(s)`, origin 0 0) — covers all four address kinds incl. cross-origin `external`, correct browser-zoom semantics | Discussed — chosen over injecting CSS `zoom` into the guest document (same-origin only; reaches into proxied content, prior Content-Length scar) | S:90 R:70 A:85 D:90 |
| 2 | Certain | Gesture set is Ctrl/Cmd+wheel + touchpad pinch (`wheel` with `ctrlKey:true`; Safari `gesturestart`/`gesturechange`), non-passive listeners with `preventDefault`; terminal listener on the xterm container; web same-origin kinds attach to `iframe.contentWindow` on load; `external` degrades to header control/palette | Discussed — verified platform behavior; parent can't see wheel over an iframe | S:90 R:75 A:85 D:85 |
| 3 | Certain | Persistence split: web zoom is per-viewer localStorage keyed by target origin (or proxy port); terminal font stays the existing single per-device global | Discussed — Constitution IV (per-viewer state in localStorage); matches browser per-origin zoom expectations | S:85 R:70 A:90 D:85 |
| 4 | Certain | New web zoom actions register in the command palette (in/out/reset), per-surface-restricted following the shared-FindBar ttyOnly/webOnly precedent; the browser-chrome control is the universal floor trigger for `external` | Discussed — Constitution V: palette is the complete action registry | S:85 R:80 A:90 D:85 |
| 5 | Certain | Out of scope: claiming Cmd/Ctrl+Plus/Minus/Digit0 (shell-owned, keybindings.ts:386-388 + deliberate no-claim comment) and Electron `webContents.setZoomFactor` | Discussed — item 4 explicitly severed; reversing the key reservation is a separate future decision | S:95 R:85 A:90 D:95 |
| 6 | Certain | Rename the tile-maximize verb (`ZoomGlyph`, `Layout: Zoom`/`Unzoom`, R6 state); "Zoom" becomes the content-magnification vocabulary on both surfaces. Palette action ids stay stable; only user-facing labels change | Clarified — user changed to rename-the-tile-verb (option 2 over the per-surface working default). Dimensions re-scored for the resolved state: explicit user directive (S), label-only swap with stable ids (R), nothing left to infer (A), one interpretation (D) | S:95 R:70 A:90 D:90 |
| 7 | Certain | Web zoom uses a browser-standard discrete step ladder (50–300%, e.g. 50/67/75/80/90/100/110/125/150/175/200/250/300), default and reset = 100% | Clarified — user confirmed | S:95 R:75 A:80 D:75 |
| 8 | Confident | Web zoom control shape: compact control in the tile's browser chrome by the address bar/FindBar area (percent readout + in/out/reset affordance); exact layout at apply's discretion following the FindBar shared-control template | Clarified — user confirmed (composite stays below the Certain band) | S:95 R:80 A:75 D:65 |
| 9 | Certain | Web zoom persists under a single `runkit-*`-prefixed localStorage key holding an origin/proxy-port → level map | Clarified — user confirmed | S:95 R:70 A:85 D:75 |
| 10 | Certain | Terminal gesture steps reuse the existing font increase/decrease step size and bounds, with wheel-delta accumulation/thresholding so one pinch doesn't over-step | Clarified — user confirmed | S:95 R:85 A:80 D:75 |
| 11 | Certain | Terminal touch-scroll-to-tmux handler (terminal-client.tsx:637+) and xterm's own wheel handling stay untouched — only ctrl-modified wheel and `gesture*` events are intercepted | Discussed — explicit constraint | S:85 R:70 A:85 D:85 |
| 12 | Certain | Tests: Vitest units for step/persistence logic; Playwright e2e where possible with `.spec.md` companion docs | Project rules determine this — code-quality.md + constitution Test Companion Docs | S:80 R:85 A:95 D:90 |
| 13 | Confident | The tile-maximize verb's new label is "Expand" (`Layout: Expand`/`Restore` in the palette; tile-header tooltip "Expand"/"Restore") | Clarified — user confirmed (composite stays below the Certain band); "Expand" matches the maximize-corner-brackets glyph and reads naturally with "Restore" | S:95 R:80 A:75 D:65 |

13 assumptions (11 certain, 2 confident, 0 tentative, 0 unresolved).

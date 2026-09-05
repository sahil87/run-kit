# Intake: Quake Console v2 — Slide, Resize, Affordances, Glass, Image Paste

**Change**: 260905-sh7y-console-slide-resize-glass-paste
**Created**: 2026-09-05

## Origin

> quake console v2: slide animation, mouse resize, affordances (top-bar button + tongue), glass opacity setting, image paste fix

Conversational — first feedback round on the shipped operator console (qa85, PR #839, "the Quake Terminal"). The user tried it, loves it, and decided against live demos in an HTML design study (`quake-terminal-v2-studies.html`, presented 2026-09-05):

1. **Slide toggle** — approved as demoed ("toggle - good").
2. **Affordances** — "B and A": the top-bar ◉ operator button (B) plus the drawer tongue (A). The user asked about mobile (no top-bar space; suggested a bottom-bar button); resolution: the **tongue is the mobile standing affordance** — it hangs under the top bar so it costs no bar space, works on every route (the bottom bar exists only on terminal tty views and its 375px single-row budget is fixed), and gets a coarse-sized hit area. No bottom-bar chip.
3. **Glass** — user set the values: default opacity **0.90**, exposed in settings; blur **fixed 6px, not exposed**.
4. **Image paste** — "Yes, needs to be fixed" (⌘V with the console open currently pastes into the tab below).

This change also folds in the two parked should-fixes from qa85's review (recorded in that change's review result): the duplicated route-server param walk, and the console buttons' missing coarse touch targets + hover treatment.

## Why

**Problem**: the shipped console pops (a 10px nudge) instead of sliding, has fixed geometry, has no standing visual affordance (chord/palette/pinned-row only — nothing says "something slides down here"), swallows image paste incorrectly (a document-level file-paste listener forwards clipboard files to the global compose strip, which uploads to the ROUTE's focused target — the tab below — because the console's embedded terminal deliberately registers no focus), and is fully opaque where a quake terminal wants a little glass.

**If we don't fix it**: the console reads as a modal rather than a quake drawer, discoverability stays chord-gated, and image paste actively misfires — files land on the wrong window, which is a correctness bug, not polish.

**Why this approach**: every piece rides existing seams — CSS transform transitions, pointer-event grips + a localStorage geometry key, the TOP_BAR_BUTTON token grammar, the compose strip's `uploadFile` + send-lane delivery, xterm's `allowTransparency`. Zero backend changes. Alternatives rejected in discussion: a bottom-bar mobile chip (tight 375px single-row budget; bottom bar is tty-route-only), hover-reveal affordance (invisible — contradicts the goal), exposing blur (user fixed it at 6px), an `internal/settings` registry key for opacity (per-viewer preference — localStorage is its constitutional home; the settings dialog is still where it surfaces).

## What Changes

### 1. True quake slide (open AND close)

Replace the `rk-console-drop` nudge with a real slide: enter `translateY(-102%) → 0`, exit back up, ~240ms, ease-out (`cubic-bezier(.2,.9,.25,1)` class). The component stays mounted through the exit transition (the terminal stream tears down after the slide completes, not mid-animation) — an internal `closing` state drives the exit class and unmounts on `transitionend` (with a timeout fallback). The chord/Esc/✕/button all toggle through this path. `prefers-reduced-motion` zeroes both directions (extend the existing `rk-console-drop { animation: none }` rule to the new transition — reduced motion must also skip the mounted-through-exit delay).

### 2. Mouse resize — height and width, persisted per-viewer

Desktop drawer only (the mobile sheet stays full-height):

- **Height**: a bottom grip (the tongue — see § 3) drags height, clamped 25–85% of the viewport height.
- **Width**: side grips on both edges, symmetric about the center line (the console stays centered), clamped 420px–96vw.
- During drag the transition is suspended (no animated fighting); pointer capture on the grip.
- Geometry persists per-viewer in **localStorage** (one JSON key, e.g. `runkit-operator-console-geometry` holding `{heightVh, widthPx}`), read on mount with safe fallbacks (try/catch, defaults 55vh / 760px). Constitution IV: per-viewer state → localStorage.

### 3. Affordances — top-bar ◉ button (desktop standing) + tongue

- **B — top-bar operator button (desktop)**: a fixed-size button in the top bar's right cluster (the shared `TOP_BAR_BUTTON*` size token in `top-bar-overflow-menu.tsx`), rendering the ◉ operator glyph with a small **live agent-state dot** (grey `idle` / green `active` / amber `waiting`, derived from the console's resolved server's operator window on the sessions payload; no dot when no operator). Click toggles the console (dispatches the existing `OPERATOR_CONSOLE_EVENT` toggle). Rendered on desktop (fine-pointer) top bars on every route; hidden on mobile (no space — the tongue serves there). Tooltip/aria: `Operator console (⌘J)`. The button renders even when the server has no operator (the console's hint line is the answer — same posture as the palette open action).
- **A — drawer tongue**: a centered pull tab hanging under the top bar (~64×12px fine, with a coarse hit area ≥36px effective via padding/pseudo-element). Behavior by breakpoint:
  - **Desktop**: visible only while the console is OPEN, attached to the drawer's bottom edge as the height drag grip (it slides with the drawer). At rest the bar stays quiet — B is the standing affordance.
  - **Mobile** (`isMobileViewport()`): the tongue is the STANDING affordance — always visible under the top bar on every route; tap opens the sheet. It carries an **amber dot** when the resolved server's operator is `waiting`. No bottom-bar chip is added (375px single-row budget untouched; the bottom bar exists only on terminal tty views anyway). The existing overflow-menu row stays as a labeled backup.
- Both are palette-consistent: the existing `Operator: Open console` action remains the registry entry of record; the button/tongue are pointer affordances for the same event seam.

### 4. Glass — opacity setting (default 0.90), fixed 6px blur

- The desktop drawer's background becomes `rgba(bg-primary, α)` with `backdrop-filter: blur(6px)` (+ `-webkit-` prefix). Blur is a constant — not configurable.
- α is a **per-viewer setting**: default **0.90**, clamped **0.75–1.0**, stored in localStorage (`runkit-operator-console-opacity`), live-applied. α = 1.0 disables the backdrop-filter entirely (no blur cost when fully opaque).
- The embedded `TerminalClient` inside the console needs a transparent terminal: xterm `allowTransparency: true` + transparent theme background **for the console instance only** — thread as an opt-in prop so route/board terminals are untouched (no renderer cost outside the console).
- **Settings exposure**: a row in the existing settings dialog (the one settings surface, Constitution IV) — "Operator console opacity" with a slider/stepper, backed by the localStorage key (per-viewer, like the shortcuts panel's client-side residents), NOT an `internal/settings` registry key (that surface is per-instance daemon config; glass is per-eye). Mobile sheet stays opaque (full-height over content; glass buys nothing there) — the setting applies to the desktop drawer.

### 5. Image paste fix — route correctly, then support it in the console

Current bug: every mounted `TerminalClient` adds a document-level `paste` listener (`terminal-client.tsx` ~262) forwarding `clipboardData.files` to the global compose strip (`dispatchComposeStripAttach`), which uploads to the strip's focused target — the tab below the console. Two parts:

- **(a) Guard**: file-paste events originating inside the console (`e.target` within the console dialog, or simply: while the console is open — decide at apply from what the event targets actually are when xterm helper textareas are focused; the target-containment check is the narrow default) are NOT forwarded to the compose strip by the route terminals' listeners. Text paste is untouched (native textarea behavior in the console compose; xterm bracketed paste in terminals).
- **(b) Console file paste**: the console binds its own `paste` (and `drop`) handler on its root: clipboard/dropped files upload via the existing `uploadFile` client (`POST /api/sessions/{session}/upload` scoped to the OPERATOR window's session/worktree — mirror the compose strip's `useFileUpload` usage), and each returned path is delivered to the operator pane through the send lane as an **insert** (staged into the TUI composer — where Claude renders its `[Image #N]` chip, which the injection engine's echo probe already recognizes since #821), NOT submitted. The user's typed message then submits as usual and carries the staged image. Upload/in-flight state surfaces in the console (reuse the inline error line for failures; a minimal "uploading…" indicator is enough). When no operator window resolves, file paste in the console is a no-op with the inline hint.

### 6. Parked should-fixes from qa85's review

- Export `useCurrentServerFromRoute` from `contexts/session-context.tsx` and reuse it in `operator-console.tsx` and `app.tsx`'s `LayoutCommandPalette` (deleting the two inlined param-walk copies).
- The console's Send/✕ buttons adopt the compose strip's idiom: `coarse:` touch-target sizing (≥36px) and the `rk-glint` hover treatment.

### Non-goals

- No bottom-bar chip (decided against — budget + tty-only scope).
- No blur setting (fixed 6px), no `internal/settings` registry key, no backend changes of any kind.
- No mobile-sheet glass, no mobile resize (sheet stays full-height).
- The nice-to-haves from qa85's review (render-phase ref write, pendingSend narrow race) MAY be taken opportunistically if the touched lines overlap, but are not required scope.

## Affected Memory

- `run-kit/ui/operator-console`: (modify) slide mechanics, resize + geometry persistence, affordance pair (button/tongue by breakpoint), glass setting, console file-paste path
- `run-kit/ui/top-bar`: (modify) the ◉ operator button in the right cluster (size token, state dot, breakpoint)
- `run-kit/ui/compose-and-bottom-bar`: (modify) the file-paste routing guard (console-origin events excluded from the strip forward)
- `run-kit/ui/dialogs-and-state`: (modify) settings dialog — the per-viewer console-opacity row
- `run-kit/ui/keyboard-and-palette`: (modify) note the pointer affordances beside the chord/palette entries (registry unchanged)

## Impact

- **Frontend only**: `operator-console.tsx` (+ its lib/tests), `globals.css` (slide + tongue + reduced-motion), `terminal-client.tsx` (paste guard; `allowTransparency` opt-in prop), the top-bar cluster component, settings dialog panel, `contexts/session-context.tsx` (hook export), `app.tsx`. E2E: `operator-console.spec.ts` extensions (slide open/close semantics can be asserted via visibility + class; resize via drag; opacity via computed style; paste routing via mocked upload route with a trailing-`*` glob), plus the existing paste-interception behavior of terminal routes re-asserted.
- **Zero backend diff.**
- Watch the sibling-spec class from qa85: the top-bar button changes the right cluster — sweep `top-bar-overflow`/`top-bar-overlap` specs; the settings dialog row may touch settings-dialog specs.

## Open Questions

- None blocking — decisions were made interactively in the design round.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Slide = translateY(-102%)↔0, ~240ms, mounted-through-exit; reduced-motion zeroed | Demoed live; user approved "toggle - good" | S:90 R:90 A:90 D:90 |
| 2 | Certain | Affordances = B (top-bar ◉ + state dot, desktop) and A (tongue) | User: "B and A" | S:90 R:80 A:85 D:85 |
| 3 | Confident | Mobile standing affordance = the tongue (coarse hit area), NOT a bottom-bar chip | Answers the user's mobile question: no top-bar space needed, works on all routes; bottom bar is tty-only with a fixed 375px single-row budget | S:70 R:85 A:80 D:70 |
| 4 | Certain | Opacity default 0.90, exposed in settings; blur fixed 6px, not exposed | User's exact values | S:95 R:90 A:95 D:95 |
| 5 | Confident | Opacity stored per-viewer in localStorage, surfaced as a settings-dialog row; no registry key | Constitution IV layering; the dialog is the one settings surface and already hosts client-side residents (shortcuts) | S:70 R:85 A:85 D:75 |
| 6 | Confident | Opacity clamp 0.75–1.0; α=1 disables backdrop-filter | Readability floor from the study; zero-cost opaque path | S:60 R:90 A:85 D:80 |
| 7 | Certain | Image paste: guard the strip forward against console-origin file pastes + console-local upload→insert delivery to the operator composer | User: "needs to be fixed"; root cause verified in terminal-client.tsx; upload/send seams exist | S:85 R:80 A:85 D:80 |
| 8 | Confident | Console attachments deliver as send-lane INSERT (staged [Image #N] chip), user's Enter submits | Mirrors the TUI-composer behavior the #821 echo-probe work already recognizes; apply verifies the exact mode against the strip's delivery | S:60 R:75 A:70 D:65 |
| 9 | Confident | Geometry `{heightVh, widthPx}` in one localStorage JSON key; clamps 25–85vh / 420px–96vw | Demoed values; per-viewer convenience state with safe fallbacks | S:65 R:90 A:85 D:80 |
| 10 | Confident | Fold in qa85's two parked should-fixes (hook export + coarse/glint buttons) | Standing plan recorded at merge time; both files are already in this change's blast radius | S:75 R:90 A:90 D:85 |
| 11 | Confident | Console `TerminalClient` gets an opt-in transparency prop; route/board terminals untouched | Scopes the renderer cost; type-safe seam over a global option | S:60 R:85 A:80 D:75 |

11 assumptions (4 certain, 7 confident, 0 tentative, 0 unresolved).

## Amendment (2026-09-05): Operator omnibox — the top-bar center as the ask box

Second interactive design round on the same PR (#840), from the omnibox study
(`operator-omnibox-studies.html`, four variants + live ⌘J state machine + the one-input
before/after). User chose **V3 (split center) degrading to V2 (morph)**, confirmed the ⌘J cycle,
and approved the one-input consequence after seeing it drawn. Decisions:

1. **≥ lg (wide desktop)**: the center cell renders a compact heading (`{name} ▾` — the PageType
   prefix span hides at this rung, extending its existing below-`sm` hiding; name click still
   renames, ▾ still switches) beside a **standing omnibox** (`◉` + "Ask the operator…" + chord
   keycap). The omnibox is the console's compose RELOCATED — same `sendToWindow target:"agent"`
   lane, same image-paste upload path, same inline error (rendered at the drawer's top edge).
2. **md–lg (narrow desktop)**: today's heading plus a dim `· ◉ ask` ghost; the ghost or ⌘J
   MORPHS the center into the omnibox in place; Esc restores. One design at two widths.
3. **Mobile: untouched.** No omnibox; heading stays the leaf; tongue → sheet; **the sheet keeps
   its compose strip** (the one-input rule is per form factor).
4. **One-input rule (desktop)**: the drawer's compose strip is REMOVED on desktop — the drawer
   becomes output-only (embedded operator terminal + the inline error line under the omnibox).
5. **⌘J state machine**: rest →(⌘J) omnibox focused (select any draft) →(⌘J) drawer open (peek,
   nothing sent) →(⌘J) closed + blurred (full return). **Enter** (non-empty) sends and
   AUTO-OPENS the drawer, focus stays in the omnibox for follow-ups. **Esc** steps back one
   level (open → focused → blurred). The palette `Operator: Open console` action goes straight
   to open+focused; the Ask-operator fallback row still opens+sends.
6. The ◉ cluster-head button stays at all desktop rungs (state dot + toggle; it's also the
   overflow survivor). The omnibox is additive.

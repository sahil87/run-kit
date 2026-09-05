# Intake: Operator Tongue Return Toggle + Compose-Chip Glyph Fixes

**Change**: 260905-h7tx-operator-tongue-return-chip-glyphs
**Created**: 2026-09-05

## Origin

Promptless dispatch (`/fab-proceed` create-new lane) from a user-approved synthesized description — two mobile UX follow-ups to the just-released operator mobile-navigation change (260905-a9mn, PR #843, merged and archived). All decisions below were approved by the user in the originating conversation; the description is the source of truth.

> Two user-approved mobile UX follow-ups: (1) the operator tongue becomes a toggle — on the operator route it renders in a return state (tap navigates back: `?from=` origin window → router history back → server route) instead of hiding, visually flipped/distinct with the waiting dot suppressed; the compose-strip context chip's label becomes tappable as a secondary return affordance (✕ stays dismiss-only, desktop omnibox chip unchanged — opt-in prop). (2) Compose-strip footer chips: bump the history and newline glyph spans to match 📎's visual weight, replace the history glyph `↑` with `↺` (U+21BA), and reorder to attach 📎 first, newline ⏎ second, history third.

## Why

1. **The tongue is one-way today.** `OperatorConsoleTongue` (`app/frontend/src/components/operator-console.tsx:695`) hides while the current route IS the resolved operator window's route (`operator-console.tsx:711`). On mobile the user navigates INTO the operator easily, but getting back to the window they came from means the sidebar drawer or browser back — there is no standing affordance. Desktop has the ⌘J mental model: one affordance, in and out, same tab. Mobile should mirror it: tongue tap = down into the operator, tongue tap again = back out. Without this, the mobile operator flow released in 260905-a9mn is a one-way door and the `?from=` origin context (already carried in the URL) goes unused as a navigation fact.

2. **The compose-strip footer chips are visually imbalanced.** The three chips share identical button boxes (`px-2 py-1.5`, `coarse:min-h-[36px]` — `compose-strip.tsx:1030–1104`), but the GLYPH sizes differ: 📎 is a color emoji rendering ~20px while ↑ and ⏎ are text glyphs at `text-xs` (~12px) — the row reads as one big chip and two small ones. Additionally `↑` is a poor icon for "recall sent history" (it collides with the ↑-key recall walk's meaning of "cursor/older" and looks like a plain arrow); `↺` reads as "recall/history" directly. And the order (history second, newline third) puts the rarer action before the more frequent one on coarse pointers.

If left unfixed: the mobile operator loop stays awkward (the primary complaint driving the follow-up), and the chip row keeps looking unfinished on the highest-traffic mobile surface.

Approach: pure frontend, no new routes or persistence — the return state derives from route facts (`?from=`, router history, route params) the tongue already reads, and the glyph work is presentational. This matches Constitution IV (no new pages, ephemeral view state) and reuses the existing document-event/navigation seams.

## What Changes

### 1. Tongue becomes a toggle — return state on the operator route

`OperatorConsoleTongue` in `app/frontend/src/components/operator-console.tsx` currently returns `null` when `routeServer === server && routeWindow === target.window.windowId` (line 711). Change: in exactly that condition, render the tongue in a **return state** instead:

- **Tap behavior** — navigate BACK, priority order:
  - (a) the validated `?from=` origin window on the same server when present → navigate to `/$server/$from`;
  - (b) else router history back (TanStack Router history), when a back entry exists;
  - (c) else the server route (`/$server`).
  A `?from=` value that does not name a known same-server window (the same validation class the chat-subject stamping applies — unknown, cross-server, or self ids) falls through to (b)/(c) rather than navigating to a dead window.
- **Visual** — the return-state tab is visibly flipped/distinct from the blank down-tab: e.g. a `⌃` glyph or the origin window's name rendered in the tab (exact rendering is implementer judgment; the requirement is that in-state and return-state are distinguishable at a glance). Distinct `data-testid` or state attribute so tests can assert the state.
- **Waiting dot** — the amber `waiting` dot (`operator-console-tongue-waiting`) is SUPPRESSED in return state — the user is already looking at the operator.
- **Unchanged**: on non-operator routes the tongue keeps today's behavior (navigates to the operator via `requestOperatorConsole({action:"toggle"})`, amber dot when waiting); on operator-less servers it stays hidden (omitted, not disabled); the tongue remains mobile-only (`useIsMobile()` gate) — the desktop drawer's drag-grip tongue is untouched.

This gives mobile the desktop ⌘J mental model: one standing affordance, in = down, out = same tab.

### 2. Secondary return affordance — context chip label becomes tappable (operator-route compose strip only)

`OperatorContextChip` (`app/frontend/src/components/operator-context-chip.tsx`) renders `from: @N "name"` + ✕. Change: add an **opt-in navigate prop** (e.g. `onNavigate?: () => void` or equivalent) to the chip component; when provided, the LABEL span becomes a tappable button that navigates back to the origin window's terminal route. The ✕ stays dismiss-only (unchanged semantics: detach the envelope).

- The prop is passed ONLY at the operator-route compose-strip mount (`compose-strip.tsx:1232–1236`, the `operatorChatServer !== null` block) — the desktop omnibox mount (`operator-omnibox.tsx:204`) passes nothing and its chip behavior is byte-unchanged.
- Navigation target: the subject window's route on the same server (the subject is already validated at stamp time — see [operator-console memory § Context chip]).

### 3. Compose-strip chip glyph size + history glyph swap (`compose-strip.tsx` ~:1030–1104)

- **Bump the history and newline glyph spans** from `text-xs` to a larger step (`text-base` or `text-lg` — pick the one that visually matches 📎's ~20px emoji weight; implementer judgment on the exact step). Button boxes (`px-2 py-1.5`, `coarse:min-h-[36px] coarse:min-w-[36px]`) stay as they are — this is a glyph-span-only size change; verify the 375px single-row budget and card row height are not disturbed.
- **Replace the history glyph** `↑` with `↺` (U+21BA) at the larger size (`compose-strip.tsx:1062`). `aria-label="Recall sent text"` stays; `data-testid="compose-strip-history"` stays; the flyout, recall walk, and ↑-key readline/recall behavior are all untouched — glyph only. Update any tests asserting the `↑` glyph face (unit `compose-strip.test.tsx`; e2e `compose-strip.spec.ts` selects by testid, sweep for glyph-face assertions).
- **Fine-pointer `a|` close chip**: its glyph size MAY be bumped for consistency if trivial; else left alone (not user-required).

### 4. Chip reorder — attach, newline, history

Current card row order (`compose-strip.tsx:1261–1266`): `attachChip · closeChip(fine) · historyChip · newlineChip(coarse) · insertChip(fine) · sendChip`. Change to: attach 📎 first (unchanged), **newline ⏎ SECOND, history ↺ THIRD**:

```tsx
{attachChip}
{!coarsePointer && closeChip}
{coarsePointer && isCard && !isSelectionTarget && !composerEmpty && newlineChip}
{isCard && sentHistory.length > 0 && historyChip}
{!coarsePointer && isCard && insertChip}
{sendChip}
```

Each chip's render conditions are byte-unchanged — only relative position moves. Applies wherever the card lays these chips out; the compact-row arrangement follows the same relative order where both render (today's compact rows omit both history and ⏎, so this is vacuous there but the rule holds if compact ever gains them). The `a|` close chip keeps its current slot (immediately after 📎 on fine pointers — not user-specified, no reason to move it).

### 5. Tests

- **Unit**: `operator-console.test.tsx` tongue suites gain return-state cases (renders in return state on the operator route instead of null; tap priority a/b/c; waiting dot suppressed; non-operator routes unchanged); `compose-strip.test.tsx` chip order + ↺ glyph updates; `operator-context-chip` coverage for the opt-in navigate prop (label tap navigates when provided, inert otherwise; ✕ still dismisses) — colocated per project convention.
- **e2e**: `operator-console.spec.ts` mobile-navigation suite (`:805` onward) gains the return-toggle assertions (tongue visible in return state on the operator route, tap returns to the `?from=` origin, chip-label tap returns); compose-strip-adjacent specs swept for glyph/order assumptions. Mobile e2e uses direct `goto` + `__rkTerminals` poll (the established mobile pattern — `gotoWindow` is mobile-incompatible). Playwright `test()` intent comments (Proves/Steps JSDoc) updated in the same commit per the constitution's Test Intent Comments rule.

### Scope / constraints

- Frontend only; no backend, routes, or persistence changes (`?from=` already passes `validateTerminalSearch`).
- Desktop console (drawer, machine, omnibox) untouched except the shared chip component's opt-in navigate prop (unused at the omnibox mount).
- Keyboard reach (Constitution V): the return actions are pointer conveniences over navigation that already has keyboard/palette paths (browser back, sidebar, palette window rows) — no new palette registration required for the tongue/chip taps themselves; flag at review if a new user-facing action emerges.

## Affected Memory

- `run-kit/ui/operator-console`: (modify) tongue requirement — the affordance-pair requirement's "hides while the current route IS the operator route" clause becomes the return state (toggle semantics, tap-back priority, dot suppression); context-chip requirement gains the operator-route navigate affordance (opt-in prop, ✕ unchanged).
- `run-kit/ui/compose-and-bottom-bar`: (modify) chip roster section — chip order (📎 · ⏎ · ↺), history glyph ↺, glyph sizing (larger glyph spans in same button boxes).

## Impact

- `app/frontend/src/components/operator-console.tsx` — `OperatorConsoleTongue` return state (~40 lines touched).
- `app/frontend/src/components/operator-context-chip.tsx` — opt-in navigate prop (~15 lines).
- `app/frontend/src/components/compose-strip.tsx` — chip glyph spans, ↺ swap, row reorder, chip mount passes navigate prop (~20 lines).
- `app/frontend/src/components/operator-console.test.tsx`, `compose-strip.test.tsx` — updated/added unit suites.
- `app/frontend/tests/e2e/operator-console.spec.ts` — mobile-navigation suite additions; `compose-strip.spec.ts` sweep.
- No Go/backend, no API, no new routes, no localStorage/tmux state. Small-to-medium frontend change.

## Open Questions

- (none — promptless dispatch; no decision scored below the Unresolved threshold)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Tongue renders a RETURN state on the operator route (replacing today's hide), tap-back priority (a) validated `?from=` origin → (b) router history back → (c) server route | User-approved verbatim in the synthesized description | S:95 R:70 A:90 D:95 |
| 2 | Certain | Waiting dot suppressed in return state; non-operator routes and operator-less servers byte-unchanged; tongue stays mobile-only | User-approved; scope constraints explicit | S:95 R:85 A:90 D:95 |
| 3 | Confident | Return-state visual: a flipped/distinct tab (⌃ glyph or origin window name) with a testable state attribute — exact rendering is implementer judgment | Description says "e.g." and delegates the rendering; pure presentation, trivially revised | S:60 R:85 A:70 D:45 |
| 4 | Confident | History-back arm (b) uses TanStack Router's history with a can-go-back check; absent a back entry it falls to (c) the server route | Standard router capability; the (c) fallback bounds any detection gap | S:70 R:80 A:75 D:70 |
| 5 | Confident | A `?from=` naming an unknown/cross-server/self window at tap time falls through to (b)/(c) — same validation class as the chat-subject stamping | Mirrors the established `?from=` validation posture; navigating to a dead window would be a regression | S:60 R:80 A:80 D:70 |
| 6 | Certain | Chip label navigate affordance is an opt-in prop on `OperatorContextChip`, passed ONLY at the operator-route compose-strip mount; ✕ stays dismiss-only; omnibox mount unchanged | User-approved, including the expected prop shape | S:90 R:80 A:85 D:85 |
| 7 | Confident | Glyph size step: `text-base` or `text-lg` on the ↺/⏎ glyph spans, chosen to match 📎's visual weight; button boxes and the 375px row budget untouched | Description delegates the exact step ("apply judgment"); a one-class change either way | S:70 R:95 A:65 D:55 |
| 8 | Certain | History glyph ↑ → ↺ (U+21BA); aria-label, testid, flyout, recall walk, and ↑-key readline behavior untouched; glyph-face test assertions updated | User-approved verbatim, glyph-only | S:95 R:90 A:95 D:95 |
| 9 | Certain | Chip order becomes 📎 · ⏎ (second) · ↺ (third) with render conditions unchanged; compact row follows the same relative order where both render (vacuously today) | User-approved; single-line JSX reorder | S:90 R:90 A:90 D:90 |
| 10 | Confident | The fine-pointer close chip (the "a" + bar glyph): glyph bumped only if trivially consistent, else left alone; it keeps its current slot after 📎 on fine pointers | User marked it optional ("not user-required"); slot unspecified so status quo wins | S:65 R:95 A:80 D:70 |
| 11 | Confident | change_type = feat — the return affordance is new behavior; "glyph fixes" is visual polish riding along, not a defect fix | Dominant change adds a capability; type is data-only and correctable | S:65 R:90 A:75 D:65 |
| 12 | Certain | Tests: unit (tongue/chip/strip suites) + e2e (operator-console mobile suite return-toggle assertions, compose-strip sweep), mobile e2e via direct goto + `__rkTerminals` poll, Playwright intent comments updated in the same commit | Constitution (Test Intent Comments) + code-quality gates + established mobile e2e pattern | S:90 R:90 A:95 D:95 |
| 13 | Certain | Frontend only — no backend, routes, or persistence; desktop console untouched except the chip's opt-in prop | User-approved scope constraint | S:95 R:85 A:95 D:95 |

13 assumptions (7 certain, 6 confident, 0 tentative, 0 unresolved).

# Spec: Bound desktop relay WebSockets

**Change**: 260531-rus8-bound-desktop-relay-websockets
**Created**: 2026-05-31
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- **Changing mobile behavior** — `MobileCarousel` already suspends off-screen panes via `paused={idx !== carouselIndex}` (`board-page.tsx:627`). This change does not touch it.
- **Bounding connections on secure origins** — over HTTPS/h2 the ~6-connection ceiling does not exist (h2 multiplexes; the relay WS limit is ~255). The suspension feature is plaintext-only by design, so production over Tailscale HTTPS is provably unchanged.
- **Capping the number of pinned panes** — users may pin arbitrarily many windows. This change bounds *live relay connections*, not pins.
- **Backend, relay-protocol, or tmux changes** — the relay WS handshake and server-side teardown (`sync.Once`) are unchanged. This change only alters *when the client opens and closes* a relay connection.
- **Eliminating the reconnect flicker** — the existing `[reconnecting...]` UX (`terminal-client.tsx:481`) on pane re-entry is retained (already accepted on mobile swipe). Suppressing it (silent re-open keeping the xterm buffer) is a possible future enhancement, out of scope here.

## Frontend: Desktop board-pane relay-connection suspension

### Requirement: Off-screen desktop panes SHALL suspend their relay WebSocket on plaintext origins

On a plaintext (`http:`) origin, `DesktopRow` (`app/frontend/src/components/board/board-page.tsx:526`) SHALL drive each `BoardPane`'s `paused` prop from viewport visibility instead of the current hardcoded `paused={false}` (`:579`). A pane whose element is outside the `rowRef` horizontal-scroll viewport (`:570`, an `overflow-x-auto` strip), beyond a configurable pre-warm margin, SHALL be paused (`paused={true}`). A pane within the viewport or pre-warm margin SHALL be live (`paused={false}`). Visibility SHALL be determined by an `IntersectionObserver` whose `root` is the `rowRef` scroll container.

Pausing a pane unmounts its `<TerminalClient>` (`board-pane.tsx:98`), which runs the existing cleanup (`cancelled = true` + `ws.close()`, `terminal-client.tsx:495-497`); the `cancelled` flag prevents the `onclose` reconnect (`:474`), so the relay connection slot genuinely frees.

#### Scenario: Pane scrolled out of view pauses

- **GIVEN** a desktop board on `http://localhost:3020` with more pinned panes than fit in the viewport
- **WHEN** a pane is scrolled fully out of the `rowRef` viewport beyond the pre-warm margin
- **THEN** that pane's `paused` prop becomes `true`
- **AND** its `<TerminalClient>` unmounts and its `/relay/<wid>` WebSocket closes (the connection slot frees)

#### Scenario: Pane scrolled back into view resumes

- **GIVEN** a previously off-screen, paused desktop pane
- **WHEN** the pane is scrolled back into the viewport (or its pre-warm margin)
- **THEN** that pane's `paused` prop becomes `false`
- **AND** its `<TerminalClient>` re-mounts, re-opens the relay WebSocket, and replays terminal content (`needsReset` / `terminal.reset()`, `terminal-client.tsx:452`)

### Requirement: Live relay panes SHALL be capped at 4 on plaintext origins

On a plaintext origin, the number of simultaneously-live (unpaused) relay panes SHALL NOT exceed **4**, even when more than 4 panes are visible at once (e.g. a wide monitor showing many narrow panes). When visibility alone would leave more than 4 panes live, panes beyond the cap SHALL be paused, selecting the least-recently-focused live panes for pausing first. The cap value SHALL be a named constant (e.g. `MAX_LIVE_RELAY_PANES = 4`), not a magic number.

#### Scenario: More than 4 visible panes — excess paused

- **GIVEN** a desktop board on a plaintext origin where 6 panes are simultaneously within the viewport
- **WHEN** visibility is evaluated
- **THEN** at most 4 panes are live (`paused={false}`)
- **AND** the 2 least-recently-focused visible panes are paused

#### Scenario: Within cap — all visible panes live

- **GIVEN** a desktop board on a plaintext origin where 3 panes are within the viewport
- **WHEN** visibility is evaluated
- **THEN** all 3 visible panes are live and no pane is paused for cap reasons

### Requirement: The focused pane SHALL always remain live

The currently-focused pane (`focusedIndex`, `board-page.tsx:156`) SHALL never be paused, regardless of visibility or the live-pane cap. This preserves `Cmd+]`/`Cmd+[` focus cycling (`:174-177`), imperative focus on focus change (`:186`), and BottomBar targeting of the focused terminal (`board-pane.tsx:74-82`). When the cap forces a pause, the focused pane SHALL be exempt and a non-focused live pane SHALL be paused instead.

#### Scenario: Focused pane off-screen stays live

- **GIVEN** a desktop board on a plaintext origin where the focused pane has been scrolled out of the viewport
- **WHEN** visibility is evaluated
- **THEN** the focused pane remains live (`paused={false}`)
- **AND** `Cmd+]`/`Cmd+[` cycling and BottomBar targeting continue to work against it

#### Scenario: Cmd+] cycles to an off-screen paused pane

- **GIVEN** a desktop board on a plaintext origin with a paused, off-screen pane
- **WHEN** the user presses `Cmd+]` to focus that pane
- **THEN** the newly-focused pane becomes live (`paused={false}`) and its terminal re-attaches
- **AND** focus lands on it (imperative `focus()` via `paneRefs`)

### Requirement: Secure origins SHALL retain current behavior unchanged

On a secure (`https:`) origin, `DesktopRow` SHALL render every pane with `paused={false}` exactly as today (`board-page.tsx:579`). The `IntersectionObserver` SHALL NOT be created and the live-pane cap SHALL NOT apply. Origin classification SHALL use `window.location.protocol === "http:"` to mean "plaintext" (everything else, including `https:`, is treated as secure).

#### Scenario: HTTPS board keeps all panes live

- **GIVEN** a desktop board served over `https://` (e.g. Tailscale)
- **WHEN** panes are scrolled out of the viewport
- **THEN** no pane is paused — every pane stays live with its relay WebSocket open
- **AND** no `IntersectionObserver` is instantiated for the row

#### Scenario: Plaintext localhost classified as plaintext

- **GIVEN** the E2E/dev board path `http://localhost:3020`
- **WHEN** origin classification runs
- **THEN** the origin is classified as plaintext and the suspension feature is active

### Requirement: Reconnect thrash during scroll SHALL be mitigated by a pre-warm margin

To avoid rapid pause/resume churn (and the attendant `[reconnecting...]` flicker) as panes cross the viewport edge during scroll, the `IntersectionObserver` SHALL apply a pre-warm margin (an `IntersectionObserver` `rootMargin`) so panes are kept live slightly before they enter the strict viewport and paused slightly after they leave. The margin SHALL be a named constant. The initial value SHALL be one pane-width of horizontal `rootMargin` (left/right) with no debounce; a debounce SHALL be added only if pause/resume thrash is observed during Playwright tuning. The exact pixel value is empirical and MAY be tuned at apply/test time without re-spec.
<!-- clarified: pre-warm margin defaulted to one pane-width horizontal rootMargin, no debounce unless thrash observed — empirical/Playwright-tuned, reversible at apply/test time; resolved per assumption #11 -->

> *Apply-stage note*: The visibility+cap selection logic MAY be extracted into a hook/helper (e.g. `use-visible-panes` / `selectLivePanes`) or kept inline in `DesktopRow` — this is an apply-stage code-organization judgment with no downstream cascade. Default: extract only if the resulting `DesktopRow` complexity warrants it (which then mandates the colocated unit tests below); otherwise keep it inline and rely on E2E coverage.
<!-- clarified: extract-vs-inline left to apply-stage judgment with explicit default (extract only if complexity warrants, else inline) — no downstream cascade, reversible; resolved per assumption #12 -->

#### Scenario: Brief scroll-past does not thrash

- **GIVEN** a desktop board on a plaintext origin
- **WHEN** the user scrolls a pane just past the viewport edge and immediately back
- **THEN** the pane stays live throughout (it never left the pre-warm margin) — no unmount/remount cycle occurs

## Frontend: Test coverage

### Requirement: E2E coverage SHALL assert desktop pane suspension and resumption

A Playwright E2E test under `app/frontend/tests/` SHALL assert, on a plaintext origin, that (a) an off-screen desktop pane pauses — its relay WebSocket closes — and (b) scrolling it back re-establishes the terminal content. Per the Test Companion Docs constitution rule, the new/modified `*.spec.ts` SHALL ship with a sibling `*.spec.md` in the same commit documenting each `test()`'s intent and steps.

#### Scenario: E2E asserts off-screen pause and on-screen resume

- **GIVEN** a Playwright board test on a plaintext origin with multiple pinned panes
- **WHEN** the test scrolls a pane off-screen and then back
- **THEN** the test observes the pane's relay WebSocket close while off-screen and re-open (terminal content restored) on return
- **AND** a sibling `.spec.md` documents the test's what-it-proves and steps

### Requirement: The live-pane selection logic SHALL have unit coverage if extracted

If the visibility-plus-cap selection logic is extracted into a hook or pure function (e.g. `use-visible-panes` / a `selectLivePanes` helper), that unit SHALL have colocated unit-test coverage (`*.test.ts`/`*.test.tsx`) for the cap, focused-pane-exemption, and least-recently-focused-eviction rules. If the logic remains inline in `DesktopRow` and is not independently unit-testable, the E2E coverage above is sufficient.

#### Scenario: Cap-and-exempt logic unit-tested

- **GIVEN** the live-pane selection logic extracted into a testable unit
- **WHEN** given a set of visible panes exceeding the cap with a designated focused pane
- **THEN** the unit returns at most 4 live panes, always including the focused pane, pausing least-recently-focused panes first

## Design Decisions

1. **Mechanism: IntersectionObserver (not LRU-only cap)**
   - *Why*: Mirrors the proven mobile carousel model (`paused={idx !== carouselIndex}`), is geometry-accurate, and pauses only genuinely off-screen panes — minimizing connection churn and reconnect flicker for the common case (few panes, scroll to reveal more).
   - *Rejected*: A pure LRU cap with no geometry — simpler and gives a hard ceiling, but can pause a *visible* pane on a wide monitor (focus order ≠ visible order), degrading UX for no benefit when fewer than the cap are on-screen.

2. **Budget: static cap of 4, plaintext-only (not derived from attached-server count)**
   - *Why*: A constant is simple, predictable, and safely under the ~6-connection ceiling for the common single-server board (`1 SSE + 4 relay + headroom`). The cap is a backstop to the IntersectionObserver for the wide-monitor edge case.
   - *Rejected*: A budget derived as `6 − serverCount − (dev ? 1 : 0)` — adapts to multi-server boards but adds logic that must track `serverCount` (`board-page.tsx:299`) accurately across server attach/detach, more to test for marginal benefit. (`serverCount` is already computed for the TopBar, so this remains a future option if 4 proves too conservative.)

3. **Feature gated on `location.protocol === "http:"` (HTTP-only)**
   - *Why*: The 6-connection ceiling is a plaintext-HTTP/1.1 artifact; over HTTPS/h2 it does not exist. Gating the entire feature on protocol means production (Tailscale HTTPS) behavior is provably unchanged — no pausing, no IntersectionObserver, no flicker — and the smallest possible blast radius. The fix activates only where the problem exists (E2E/dev `http://localhost:3020`, raw-port `http://...` access).
   - *Rejected*: Running the IntersectionObserver on all origins (pausing off-screen panes everywhere to save resources) — reintroduces reconnect flicker on HTTPS scroll-back for no connection-budget reason, and changes production behavior.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | DesktopRow hardcodes `paused={false}` (`board-page.tsx:579`); MobileCarousel already suspends via `paused={idx !== carouselIndex}` (`:627`) | Confirmed from intake #1; re-verified board-page.tsx this session | S:95 R:90 A:95 D:95 |
| 2 | Certain | The `paused` plumbing frees the connection: unmount → `cancelled=true` + `ws.close()` (`terminal-client.tsx:495-497`), and `cancelled` blocks the `onclose` reconnect (`:474`) | Confirmed from intake #2; re-verified terminal-client.tsx this session | S:95 R:85 A:90 D:90 |
| 3 | Certain | Mechanism = IntersectionObserver rooted on `rowRef`, mirroring mobile | Confirmed from intake #5 (Clarified by user); the mobile model is proven and end-to-end correct | S:95 R:65 A:90 D:90 |
| 4 | Certain | Budget = static cap of 4 live relay panes, applied on plaintext HTTP only | Confirmed from intake #6 (Clarified by user); static cap is safe under the 6-conn ceiling for single-server boards | S:90 R:65 A:85 D:85 |
| 5 | Certain | Feature gated on `location.protocol === "http:"`; HTTPS keeps `paused={false}` with no IO and no cap | Confirmed from intake #9 (Clarified by user); the ceiling is plaintext-only so production is provably unchanged | S:90 R:70 A:90 D:90 |
| 6 | Certain | Focused pane is always live (never paused), exempt from both visibility-pause and the cap | Required to preserve `Cmd+]`/`Cmd+[` cycling, imperative focus (`:186`), and BottomBar targeting — derivable from existing code | S:90 R:80 A:90 D:90 |
| 7 | Certain | change_type = fix | Confirmed from intake #4; repairs the plaintext-origin board-route connection starvation | S:85 R:90 A:90 D:85 |
| 8 | Confident | ui-patterns memory gets a (modify): § Boards View documents mobile pane pause (`ui-patterns.md:114-118`) but NOT the desktop equivalent — add desktop suspension | Verified ui-patterns covers mobile carousel pause only; documenting the desktop counterpart at hydrate is the obvious default | S:80 R:85 A:85 D:85 |
| 9 | Confident | Reconnect flicker on scroll-back defaults to the accepted mobile behavior; pre-warm margin mitigates thrash; silent re-open is a future enhancement | Flicker is already accepted on mobile swipe (intake :33); a pre-warm `rootMargin` is the standard mitigation; silent re-open is layerable without rework | S:75 R:75 A:75 D:75 |
| 10 | Confident | E2E coverage is net-new (no existing board `*.spec.ts` in `app/frontend/tests/`) and requires a sibling `.spec.md` | Verified `tests/` has no board spec file; constitution Test Companion Docs rule mandates the `.spec.md` | S:80 R:80 A:90 D:85 |
| 11 | Certain | Pre-warm margin = one pane-width horizontal `rootMargin`, no debounce unless thrash observed | Clarified (auto) — safe default already in spec; empirical/Playwright-tuned and reversible at apply/test time, so no spec-level cascade | S:80 R:75 A:55 D:60 |
| 12 | Certain | Extract visibility+cap logic into hook/helper only if `DesktopRow` complexity warrants; otherwise keep inline | Clarified (auto) — apply-stage code-organization judgment with no downstream cascade; both branches already handled (unit-test requirement is conditional on extraction) | S:80 R:80 A:65 D:65 |

12 assumptions (9 certain, 3 confident, 0 tentative, 0 unresolved).

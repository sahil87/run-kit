# Intake: Operator Console Mobile Navigation

**Change**: 260905-a9mn-operator-console-mobile-navigation
**Created**: 2026-09-05

## Origin

Promptless dispatch from a user conversation (synthesized description is the source of truth). Interaction mode: conversational — the user reviewed alternatives and approved option (b), navigation.

> **Title direction**: Operator console mobile — retire the sheet, navigate to the operator terminal route.
>
> **Problem**: The operator quake console's mobile arm is a full-height sheet (`operator-console.tsx`, the `isMobile` branch) with its own chat textarea + Send button. Two concrete problems, both evidenced by user screenshots on iPhone:
> 1. The sheet's compose row uses plain `py-1.5` with no bottom safe-area handling, so the Send button and hint text sit under the iPhone home-indicator curve. The repo already owns the correct logic as the shared `--bottom-bar-pad` token (globals.css ~:1653–1678, changes 260805-fi9m + 260816-4v2o): `max(1rem coarse floor, env(safe-area-inset-bottom))` with an `html.kb-open` gate that drops the pad while the on-screen keyboard is up.
> 2. The sheet's chat textarea is the WRONG input model for a TUI. The operator window runs a Claude agent TUI: permission prompts, option pickers, and interrupts need arrow keys, Enter, Esc, Ctrl-C — none of which the chat textarea can send. The embedded TerminalClient mounts with `registerFocus={false}`, so the BottomBar (terminal key chips: Tab/Ctrl/Alt/F-keys/arrows/⌘K) — which is not even rendered in the sheet — would target the underlying route's pane, not the operator. The compose strip + bottom bar were built precisely to make terminal input work on mobile; the sheet forks away from them. Also the sheet's title strip (`◉ OPERATOR · <server> <state> ✕`) duplicates chrome one row below the top bar.
>
> **Decision (user-approved, option "b")**: On mobile, opening the operator console NAVIGATES to the operator window's ordinary terminal route (`/$server/$window`) instead of rendering the sheet. The terminal route's existing chrome is reused wholesale: universal top-bar `Terminal: <window>` heading (solves the wasteful title strip), compose strip, bottom bar key chips, and the `--bottom-bar-pad` safe-area handling (solves the clipped Send). The mobile sheet branch is RETIRED — deleted, not gated off. The operator console overlay (quake drawer, ⌘J three-state machine, top-bar omnibox, grips, glass, slide) becomes desktop-only and is otherwise UNTOUCHED.
>
> **Alternatives rejected**:
> - (a) Mount the shared ComposeStrip + BottomBar inside the mobile sheet, focus-registered to the operator pane: more parallel surface, more code; navigation gives maximal reuse (Constitution IV minimal surface).
> - Patch-only: add the safe-area pad to the sheet textarea and keep it: leaves the TUI-input gap (no arrows/Esc/Ctrl-C) unaddressed.

The description further scoped: all mobile entry points retarget to navigation; the palette fallback's `pendingSend` needs a home (e.g. seed the compose strip draft — decide or defer); the context chip / templated chat lane origin is lost under navigation unless carried (in-scope-if-cheap or defer); the operator-less-server fallback needs deciding or deferring; the tongue's amber waiting dot must survive; desktop has NO behavior change; tests updated; `docs/memory/run-kit/ui/operator-console.md` updated at hydrate.

## Why

1. **The pain**: On iPhone, the mobile operator sheet clips its Send button and hint under the home-indicator curve (no safe-area pad), and its chat-textarea input model cannot drive the operator's agent TUI at all — permission prompts, option pickers, and interrupts need arrow keys, Enter, Esc, Ctrl-C, which only the terminal-route compose strip + BottomBar key chips can send. The sheet renders neither (its `TerminalClient` mounts `registerFocus={false}`, and the BottomBar isn't in the sheet — were it, it would target the route below). The sheet's title strip also duplicates chrome one row under the top bar.

2. **If not fixed**: The mobile console stays a read-mostly surface — a user watching the operator hit a permission prompt on a phone has no way to answer it from the sheet; the clipped Send remains a daily paper cut; and the sheet remains a parallel input surface that must be maintained alongside the route chrome it forks from.

3. **Why this approach**: Navigation to the operator window's ordinary terminal route (`/$server/$window`) reuses the entire existing mobile terminal chrome wholesale — universal top-bar `Terminal: <window>` heading, compose strip, bottom bar key chips, and the `--bottom-bar-pad` safe-area token with its `html.kb-open` gate. Both stated problems dissolve without new code (Constitution IV: minimal surface, move-don't-copy). Alternative (a) — mounting ComposeStrip + BottomBar inside the sheet — was rejected as more parallel surface; the patch-only fix was rejected as leaving the TUI-input gap unaddressed. Open/closed remains ephemeral in spirit: navigation is a route, not a new persistence channel.

## What Changes

### 1. Mobile open = navigation (the fork at the event seam)

On mobile (`useIsMobile()` — the shared narrow-width-OR-coarse-pointer rule), an operator-console request no longer opens a sheet: it resolves the operator window for the relevant server and navigates to its terminal route.

- **Where the fork lives**: the `OPERATOR_CONSOLE_EVENT` document seam stays the single funnel — every entry point keeps its one-line `requestOperatorConsole(...)` dispatch unchanged. The layout-mounted listener (today the `onRequest` handler in `OperatorConsole`, `app/frontend/src/components/operator-console.tsx:234–252`) branches: desktop drives the ⌘J machine exactly as today; mobile resolves `{server, target}` and navigates:
  ```ts
  navigate({ to: "/$server/$window", params: { server, window: target.window.windowId }, search: {} });
  ```
  (the cross-server sidebar navigation pattern already in `app.tsx` ~:4284). Resolution reuses the existing rule: `detail.server` pin wins (sidebar pinned row), else `resolveConsoleServer(routeServer, servers, lastViewed)`; the operator window comes from `findOperatorWindow` (`role === "operator"`, server-scoped radio) — both in `app/frontend/src/lib/operator-console.ts`.
- **Actions collapse on mobile**: `toggle` / `open` / `button` all navigate (idempotent — already on the operator route means a no-op navigation); the desktop `toggle` step-cycle, `open` open+focused, and `button` open⇄rest mappings are untouched.

### 2. Retire the mobile sheet — deleted, not gated

In `app/frontend/src/components/operator-console.tsx`:

- Remove the `isMobile` sheet branch entirely: the `rk-console-drop absolute inset-0` sheet class arm, the mobile compose strip (textarea + Send button, ~:590–629), the mobile inline error block (~:576–584), the mobile focus/restore effects (~:302–317), the `isMobile ? "rest"/"open"` plain-toggle arms in the event and Esc handlers, `transparent={!isMobile}` becomes `transparent` (always true — the component is desktop-only), and the `if (isMobile) return drawer` tail.
- `OperatorConsole` becomes desktop-only: it renders nothing on mobile, and a desktop→mobile viewport flip resets the machine to `rest` (close any open drawer) so no effect or frame survives the gate (the self-gating-component lesson: the gate owns the frames and the effects).
- The `rk-console-drop` animation class in `globals.css` is removed if the sheet was its only consumer.
- The mobile title strip is gone with the sheet — the terminal route's top-bar `Terminal: <window>` heading is the replacement chrome. The desktop title strip (`◉ OPERATOR · server · state · ✕`) is unchanged.

### 3. Entry points retarget on mobile (dispatches unchanged, behavior forked at the seam)

All six mobile-reachable entry points keep their current one-line dispatch; the seam fork in §1 gives them navigation:

- **Mobile tongue** (`OperatorConsoleTongue`, `operator-console.tsx:695–720`): survives as the mobile standing affordance — a tap now navigates. The amber `waiting` dot (reading `useOperatorConsoleContext().target?.window.agentState === "waiting"`) survives. Its `open` gate (`useOperatorConsoleOpen()`) becomes: hide while the current route IS the operator window's route (the sheet-covers-it rule translated to navigation) — or stays visible; apply decides the minimal correct gate.
- **Chord** `operator-console` (⌘J/⇧Ctrl+J, `app.tsx:349`, `action: "toggle"`): navigates on mobile.
- **Palette action** `Operator: Open console` (`lib/palette/operator-console.ts`, `action: "open"`): navigates on mobile.
- **Palette Ask-operator fallback row** (`app.tsx:461`, `action: "open"` + `server` + `send`): navigates; the `send` payload's new home is §4.
- **Sidebar pinned operator row** (`app.tsx:4297–4299`, `action: "open"` + `server: srv`): navigates to that server's operator route (cross-server navigation per the existing sidebar pattern; the mobile sidebar drawer closes as sibling navigations do).
- **Top-bar overflow-menu row** (`top-bar-overflow-menu.tsx:219`, `action: "open"`): navigates on mobile.

### 4. Palette fallback `pendingSend` → seed the compose-strip draft

The Ask-operator fallback row carries the typed query as `send`. On mobile, after navigating, the query is seeded into the terminal route's compose-strip draft via the existing draft store (`setComposeText(draftKey, query)` in `app/frontend/src/lib/compose-draft-store.ts` — keys are `server:windowId` shaped, per its tests) rather than auto-sent: the user reviews in the compose strip and sends. The sheet's auto-send-on-resolve effect (`pendingSend` + `target` wait, `operator-console.tsx:359–366`) is deleted with the sheet; desktop `pendingSend` (via `sendOperatorMessage`) is unchanged.

### 5. Context chip / templated chat lane on mobile — carried via search param

On the sheet, a send from a terminal route carried the route window as chat subject and rode the templated lane (`sendOperatorRequest(..., "user-message", ...)`). Under navigation the origin rides a search param: when the mobile fork navigates from a terminal route, it navigates with `?from=<originWindowId>`; the operator route's compose strip renders the dismissable context chip from it and sends ride the templated chat lane, exactly the sheet's parity (dismissing the chip falls back to the direct lane). The param is ephemeral route state (Constitution IV — no new persistence); navigations from non-terminal routes carry no param and send direct. The desktop chip/lane fork is untouched. (User-confirmed — Assumptions #10.)

### 6. Operator-less server on mobile — hide tongue + hint

The sheet's hint (`no operator on this server — run rk operator`) has no navigation target. Decided (user-confirmed — Assumptions #11): the tongue hides when no operator window resolves (the omitted-not-disabled pattern), and the remaining openers (chord, palette action/fallback row, overflow row, sidebar pinned row on an operator-less server) show a brief inline hint carrying the same message instead of navigating. No navigation fires when `findOperatorWindow` resolves nothing.

### 7. Tests

- `app/frontend/src/components/operator-console.test.tsx`: the mobile-sheet suites (full-height sheet render ~:307, mobile sheet compose describe-block ~:431, tongue ~:563) rewrite to navigation behavior (tongue tap navigates; no sheet renders on mobile); desktop suites unchanged.
- `app/frontend/src/lib/operator-console.test.ts`: helper tests largely unchanged; any sheet-specific seam behavior updated.
- `app/frontend/tests/e2e/operator-console.spec.ts` (19 tests): the mobile specs — "mobile: the console is a full-height sheet…" (~:605) and "mobile: the tongue is the standing affordance…" (~:829) — rewrite to assert navigation to the operator terminal route with route chrome (compose strip + bottom bar visible, no sheet). Project memory gotcha: mobile e2e specs use direct `goto` + `__rkTerminals` poll patterns (not `gotoWindow`), and intent comments must be updated in the same commit (Constitution: Test Intent Comments).
- Sweep sibling e2e specs referencing the sheet/tongue (`operator-compose.spec.ts` has no mobile arm today; verify).

### 8. Explicitly out of scope

- Desktop: NO behavior change — quake drawer, ⌘J three-state machine, omnibox, context chip, grips, glass, slide, file paste, geometry/opacity stores all untouched.
- No new backend surface, routes, or persistence: navigation is the existing route set (Constitution IV).
- Palette entries stay (Constitution V — keyboard-first; every entry point remains palette-reachable).

## Affected Memory

- `run-kit/ui/operator-console`: (modify) retire the mobile-sheet requirement (§ Mobile full-height sheet), rewrite the mobile arm of the entry-point seam, affordance pair, compose seam ("one input per form factor" becomes desktop-only), availability-degrades, and anatomy requirements to navigation; update the tongue requirement and relevant Design Decisions.
- `run-kit/ui/keyboard-and-palette`: (modify) the `operator-console` chord row + prose ("plain sheet toggle on mobile" → navigates to the operator terminal route).
- `run-kit/ui/top-bar`: (modify) omnibox mobile note ("the sheet keeps its compose strip") and the ◉ button / overflow row's mobile framing (tongue as the mobile standing affordance now navigates).
- `run-kit/ui/routes-and-shell`: (modify) the overlay-mount paragraph's mobile geometry sentence (full-height sheet → desktop-only overlay; mobile navigates).
- `run-kit/ui/sidebar`: (modify) the operator pinned row's open-console activation gains its mobile navigation arm.

## Impact

- **Frontend only**: `app/frontend/src/components/operator-console.tsx` (sheet branch removal, tongue retarget, desktop-only gating), `app/frontend/src/lib/operator-console.ts` (seam fork or a navigation helper beside it; open-slot consumers reviewed), `app/frontend/src/app.tsx` (the seam listener's navigation arm lives where router access exists; pendingSend seeding), possibly `app/frontend/src/globals.css` (`rk-console-drop` removal). Entry-point files (`lib/palette/operator-console.ts`, `top-bar-overflow-menu.tsx`) expected unchanged.
- **Tests**: unit (`operator-console.test.tsx`, `operator-console.test.ts`) + e2e (`operator-console.spec.ts` mobile specs; sibling-spec sweep including spec intent comments per constitution).
- **No backend, API, or route-set changes**; no new localStorage/tmux/URL persistence beyond the ordinary route URL.
- **Risk**: low-moderate — the seam fork touches every entry point's mobile behavior; desktop regression risk is contained by leaving the machine/drawer code path untouched and by the existing desktop test suites.

## Open Questions

None — both former open questions (origin-context carriage, operator-less fallback) were resolved by the user on 2026-09-05 (Assumptions #10, #11).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Mobile console opens NAVIGATE to the operator window's terminal route `/$server/$window`; the sheet branch is deleted, not gated off | Discussed — user approved option (b) over (a) and patch-only; maximal reuse per Constitution IV | S:95 R:70 A:90 D:95 |
| 2 | Certain | Desktop console (quake drawer, ⌘J machine, omnibox, chip, grips, glass, slide, paste) has NO behavior change | Discussed — explicit "desktop-only and otherwise UNTOUCHED" | S:95 R:85 A:90 D:95 |
| 3 | Certain | All six mobile entry points (tongue, chord, palette action, palette fallback row, sidebar pinned row, overflow row) retarget via the existing `OPERATOR_CONSOLE_EVENT` seam; dispatches stay one-line | Discussed — entry points enumerated; the seam is the established idiom | S:90 R:75 A:85 D:90 |
| 4 | Certain | No new safe-area or input code: the route's `--bottom-bar-pad`, compose strip, and bottom bar solve both stated problems wholesale | Discussed — the token (globals.css ~:1653–1678) and chrome verified present | S:90 R:80 A:90 D:90 |
| 5 | Confident | The tongue survives as the mobile standing affordance (tap navigates) and keeps its amber `waiting` dot | Discussed — "the amber waiting dot should survive in whatever the mobile standing affordance becomes"; keeping the tongue is the minimal-change reading | S:75 R:75 A:75 D:70 |
| 6 | Confident | The mobile fork lives at the layout-mounted seam listener (navigate instead of driving the machine), not per entry point | The seam already centralizes every entry point; per-entry forks would copy the resolution six times | S:65 R:80 A:80 D:70 |
| 7 | Confident | `OperatorConsole` becomes desktop-only: renders nothing on mobile; a desktop→mobile viewport flip resets the machine to `rest` | Self-gating-component pattern (gate owns frames + effects); mobile has no drawer state to keep | S:55 R:80 A:75 D:70 |
| 8 | Confident | The chord on mobile navigates idempotently — no toggle-back to the previous route; the three-state machine stays desktop-only | Navigation has no "closed" state; back-nav is the browser/history arrows' job | S:55 R:80 A:70 D:60 |
| 9 | Confident | Palette fallback `pendingSend` on mobile seeds the operator route's compose-strip draft (`setComposeText`) after navigating, instead of auto-sending | Discussed — the description's own suggested home; user confirms before sending on a phone | S:55 R:75 A:55 D:45 |
| 10 | Certain | Origin-window context is carried: mobile navigation from a terminal route adds `?from=<originWindowId>`; the operator route's compose strip renders the dismissable context chip and sends ride the templated chat lane (dismiss ⇒ direct lane) | User confirmed 2026-09-05 (chose "search param" over dropping origin on mobile) | S:95 R:70 A:80 D:90 |
| 11 | Certain | Operator-less server on mobile: tongue hides (omitted-not-disabled); chord/palette/menu/sidebar activations show a brief inline hint (`no operator — run rk operator`) and do not navigate | User confirmed 2026-09-05 (chose "hide tongue + hint" over always-show and silent no-op) | S:95 R:75 A:80 D:90 |

11 assumptions (6 certain, 5 confident, 0 tentative, 0 unresolved).

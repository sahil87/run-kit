# Intake: Window Switch Slide Transition

**Change**: 260703-l4nf-window-switch-slide-transition
**Created**: 2026-07-03

## Origin

Promptless dispatch (`/fab-proceed` create-intake subagent, `{questioning-mode} = promptless-defer`), synthesized from a prior design conversation. The user's ask:

> An animated vertical slide transition when switching between terminal windows in run-kit — like the macOS Spaces swipe transition, but vertical (up/down), because the sidebar arranges windows vertically. A fire-and-forget animation that plays on window switch, explicitly NOT a gesture-scrubbed interactive drag.

The conversation settled the core mechanism (snapshot-based slide via the View Transitions API), the direction heuristic (flattened sidebar order), the no-resize-churn constraint, the fallback posture (progressive enhancement), and the first-paint-gated "polished" variant. It rejected the two-live-terminals macOS clone (architecturally blocked by relay connection identity) and the gesture-scrubbed swipe (out of scope). Four edge cases were left open; under promptless dispatch they are resolved as deferred defaults in `## Assumptions` (rows 9–12) rather than asked. All code references below were verified against the working tree at intake time.

## Why

1. **Pain point**: A window switch today is an instant in-place repaint — the route renders a single `TerminalClient` without a `key` (`app/frontend/src/app.tsx:1296`), so switching re-renders in place and the new window's redraw bytes simply overwrite the old content. Functional, but visually abrupt: there is no spatial cue connecting the switch to the sidebar's vertical arrangement, and rapid keyboard-driven switching between agent windows reads as a disorienting flat jump.
2. **Consequence of not doing it**: No functional harm — this is pure UX polish. The cost is continued lack of spatial continuity in the app's primary navigation gesture.
3. **Why this approach**: A true macOS-Spaces clone (two live terminal surfaces sliding past each other) is architecturally blocked: the relay's connection identity is (server, owning session) — the PTY attaches to the tmux session, and tmux shows exactly one active window per attached session (`app/frontend/src/components/terminal-client.tsx:519-534`), so two independent live views of two windows of the same session are impossible without per-window pin-session churn (the board's move-based `_rk-pin-*` pin-sessions exist precisely as that workaround and are far too heavy for a navigation animation). A snapshot-based slide via the browser View Transitions API (`document.startViewTransition`) captures the outgoing terminal as a static compositor snapshot — deliberately sidestepping the WebGL canvas readback problem (xterm's WebGL renderer canvas is not readable via `toDataURL` without `preserveDrawingBuffer`) — while the live terminal element slides in and repaints mid-slide when the new window's redraw bytes arrive. Frontend-only, no backend/Go changes.

## What Changes

### 1. View-transition wrapper around `navigateToWindow`

`navigateToWindow` (`app/frontend/src/app.tsx:480`) is the single same-server window-switch seam: it is reused by sidebar clicks (`handleSidebarSelectWindow`, app.tsx:1133-1147), command-palette `Window: Switch to …` actions (app.tsx:1108 — the keyboard switch path, constitution V), TopBar breadcrumb navigation (app.tsx:1251), and SessionTiles (app.tsx:1314). Wrapping this one function makes the animation apply identically to keyboard-driven and mouse-driven switches.

Wrap the body (URL `navigate` + `selectWindow`) in `document.startViewTransition` when ALL of:

- `document.startViewTransition` exists (feature detection);
- `prefers-reduced-motion: reduce` is NOT set (checked via `matchMedia` at switch time);
- an outgoing terminal window is in view (`windowParam` non-empty — see boundary rules in §6);
- both current and target windows resolve to indices in the flattened window order (§2).

Otherwise call the existing body directly — today's instant switch, byte-identical behavior.

TanStack Router (`@tanstack/react-router` ^1.168.22) has built-in `viewTransition` support on `navigate()`, but the **direct `document.startViewTransition` call is chosen** because the polished variant (§4) needs the async-callback seam (`startViewTransition` accepts an async callback; the router option exposes no way to await a custom first-paint signal). This is fire-and-forget — explicitly NOT a gesture-scrubbed interactive drag (rejected: requires both surfaces live).

### 2. Slide direction from the flattened sidebar order

The sidebar arranges windows vertically; direction comes from the two windows' indices in `flatWindows` (`app/frontend/src/app.tsx:515`) — the flattened `sessions.flatMap(...)` order derived from the SSE snapshot:

- `index(target) > index(current)` → target sits below → content slides **up** (new window enters from the bottom);
- `index(target) < index(current)` → target sits above → content slides **down**;
- either window missing from `flatWindows` (e.g. a just-created window not yet in the snapshot) → skip the transition (instant switch).

Set the direction as a data attribute on the document element immediately before `startViewTransition`, e.g. `document.documentElement.dataset.windowSwitchDirection = "up" | "down"`, following the existing root-attribute pattern (`data-theme`, `app/frontend/src/contexts/theme-context.tsx:83`). The `::view-transition-old/new` CSS keys off it.

Known accepted divergence: the sidebar's drag-reorder override (`orderOverrideRef`, `app/frontend/src/components/sidebar/index.tsx:242`) is component-local; `flatWindows` uses raw SSE order, so during a transient drag-reorder window the animation direction may briefly disagree with the visual sidebar order until SSE confirms. Accepted — rare and self-healing.

### 3. CSS animation (pure transform, no layout change)

In `app/frontend/src/globals.css`:

- Assign a `view-transition-name` (e.g. `terminal-surface`) to the terminal content container (the element wrapping the `TerminalClient` / `IframeWindow` branch, app.tsx:1273-1318) so **only the terminal region slides** — sidebar, top bar, and bottom bar stay static.
- `::view-transition-old(terminal-surface)` slides out and `::view-transition-new(terminal-surface)` slides in via pure `transform: translateY(...)` keyframes, ~180ms ease-out (within the discussed 150–200ms band), direction variants keyed off `:root[data-window-switch-direction="up" | "down"]`.
- Pure transforms mean **no layout change**: the terminal container's `ResizeObserver` (`terminal-client.tsx:336`) / `fitAndSync` (`terminal-client.tsx:144`) path never fires, so tmux sees no resize churn during the animation (hard constraint).

### 4. First-paint-gated new-state capture (the "polished" variant — ships)

Gate the new-state snapshot on the incoming window's first paint: `startViewTransition`'s async callback performs the navigation, then awaits a one-shot "first terminal write after the switch" signal with a **~300ms timeout**. On timeout the capture proceeds ungated — old content slides in and repaints when the redraw bytes arrive, which is exactly today's behavior plus motion (the deferred per-connection reset keeps old content painted until new bytes arrive, so the incoming surface is never blank). The timeout degradation IS the basic variant, so shipping the polished version subsumes it.

**Verified nuance (deviation from the conversation's stated hook)**: the conversation named `consumePendingReset()` (`terminal-client.tsx:740`) as the precise "new window's content just painted" hook. Verification shows `pendingReset` is armed only in `connect()` (`terminal-client.tsx:810`), i.e. it fires only on **reconnect** paths (cross-session switches, transient drops). Same-session window switches — the common case — ride the existing WebSocket with NO reconnect (`terminal-client.tsx:511-534`; the relay runs a session-scoped select and the attached PTY redraws by itself), so `consumePendingReset` never fires for them. The first-paint signal must therefore be a one-shot callback placed at the **shared write seams** — the three `consumePendingReset` call sites (coalesced flush at `terminal-client.tsx:751`, immediate text write at `:840`, immediate binary write at `:850`) — armed by the transition wrapper before navigating. `consumePendingReset` remains the correct reconnect-path marker but is not sufficient alone. Exact plumbing (prop, ref, or context — `FocusedTerminalContext` registration is an existing pattern) is a plan-time decision.

### 5. Rapid switching

A new `startViewTransition` while one is in-flight skips the in-flight transition (native browser behavior), degrading rapid keyboard next/prev-style switching to instant switches. Accepted — no queueing, no debouncing.

### 6. Scope boundaries (deferred defaults — see Assumptions 9–12)

- **SessionTiles → terminal** (no outgoing terminal; `windowParam` empty): skip the transition — slide semantics need an outgoing surface.
- **Cross-server navigation** (full reconnect): no transition — it never enters `navigateToWindow` (cross-server goes through the separate `navigate` branch at app.tsx:1138-1142), so this falls out of the seam choice naturally.
- **iframe windows** (`rkType === "iframe"`, app.tsx:1274): animate uniformly — View Transitions snapshots are paint-based and element-type-agnostic, and the transition wraps the shared container, not xterm specifically. The first-paint gate (§4) is terminal-only; iframe-target switches use the ungated capture.
- **Board routes** (`/board/$name`) and the Cockpit (`/`): untouched — the wrapper lives on the terminal-route switch path only.

### 7. Fallbacks (progressive enhancement)

Browsers without View Transitions support, and users with `prefers-reduced-motion: reduce`, get today's instant switch — the wrapper short-circuits to the unwrapped body. No functional change when the animation is unavailable. TypeScript note: if the project's TS lib lacks `Document.startViewTransition` typings, feature-detect via a narrow type guard rather than an `as` cast (code-quality: type narrowing over assertions).

### 8. Tests

- **E2E**: animations are a Playwright flake source — add reduced-motion emulation to `app/frontend/playwright.config.ts` (`use: { reducedMotion: "reduce" }`; the `use` block currently has only `baseURL` and `trace`), which disables the transition via the same media-query fallback the product honors. Existing window-switch e2e specs then run against instant switches, unchanged.
- **Unit (Vitest, colocated)**: direction computation (pure function over flattened order — up/down/missing-index cases) and wrapper skip conditions (no VT support, reduced motion, no outgoing window). New behavior MUST be covered per code-quality.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Add the window-switch slide transition — View Transitions wrapper on `navigateToWindow`, direction-from-flattened-sidebar-order data attribute, first-paint-gated capture with write-seam one-shot, reduced-motion/no-support fallback, e2e reduced-motion emulation — alongside the existing deferred per-connection reset + relay connection-identity entries it builds on.

## Impact

- `app/frontend/src/app.tsx` — transition wrapper around `navigateToWindow`, direction computation from `flatWindows`, root data attribute, `view-transition-name` on the terminal content container.
- `app/frontend/src/components/terminal-client.tsx` — one-shot first-write signal plumbed to the three existing write seams.
- `app/frontend/src/globals.css` — `::view-transition-old/new` keyframes + direction variants.
- `app/frontend/playwright.config.ts` — `reducedMotion: "reduce"` in the shared `use` block.
- Frontend-only; no Go/backend changes, no new routes (constitution IV), no persistent state (II). Keyboard-first (V) satisfied structurally: the wrapped seam serves palette, sidebar, breadcrumb, and tile navigation alike.
- Scale: ~4 files touched plus colocated unit tests; no dependency changes (View Transitions is a browser API; TanStack Router already present).

## Open Questions

None — the four edge cases the conversation left open are resolved as deferred defaults under promptless dispatch (Assumptions 9–12; Rationale `Deferred default — promptless dispatch`). Review or override them via `/fab-clarify`.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Snapshot-based slide via `document.startViewTransition` wrapping `navigateToWindow` (direct call, not TanStack's `viewTransition` option — the polished variant needs the async-callback seam) | Discussed — user chose this over the two-live-instances macOS clone (blocked by (server, owning session) relay identity) and the gesture-scrubbed swipe (out of scope); sidesteps WebGL readback | S:90 R:70 A:85 D:90 |
| 2 | Certain | Slide direction from the two windows' indices in `flatWindows` (app.tsx:515, SSE-derived flattened sidebar order), set as a root data attribute read by the VT CSS | Discussed — matches the sidebar's vertical arrangement; root-attribute pattern already established (`data-theme`) | S:85 R:90 A:85 D:85 |
| 3 | Certain | Pure CSS `translateY` transforms, ~150–200ms, no layout change — ResizeObserver/`fitAndSync` never fire, tmux sees no resize churn | Discussed — explicit constraint; transform-only animation is the standard mechanism | S:85 R:95 A:90 D:85 |
| 4 | Certain | Rapid switching: a new `startViewTransition` skips any in-flight transition, degrading to instant switches | Discussed — explicitly accepted behavior | S:80 R:90 A:85 D:85 |
| 5 | Certain | Progressive enhancement: no VT support or `prefers-reduced-motion` → today's instant switch, zero functional change | Discussed — explicit constraint | S:90 R:95 A:95 D:95 |
| 6 | Certain | E2E flake control via reduced-motion emulation in `playwright.config.ts` (`use: { reducedMotion: "reduce" }`) | Discussed — animations are a known Playwright flake source; config verified to have no such setting yet | S:75 R:95 A:90 D:85 |
| 7 | Confident | Default duration/easing: 180ms ease-out (within the discussed 150–200ms band) | Micro-decision inside an agreed band; trivially tunable | S:60 R:95 A:70 D:70 |
| 8 | Confident | First-paint signal = one-shot callback at the three shared write seams (terminal-client.tsx:751/:840/:850), not `consumePendingReset` alone | Verified against code — same-session switches ride the existing WS with no reconnect (terminal-client.tsx:511-534), so `pendingReset` (armed only in `connect()`, :810) never fires on the common path; conversation's stated hook refined accordingly | S:70 R:80 A:85 D:75 |
| 9 | Confident | SessionTiles → terminal navigation (no outgoing terminal): skip the transition | Deferred default — promptless dispatch: slide semantics need an outgoing surface; skip is the progressive-enhancement-consistent default over fade | S:40 R:90 A:70 D:60 |
| 10 | Confident | iframe windows (`rkType === "iframe"`): animate uniformly via the ungated capture; first-paint gate is terminal-only | Deferred default — promptless dispatch: VT snapshots are paint-based and element-type-agnostic; wrapper targets the shared container, so uniform is the no-special-case default | S:40 R:85 A:60 D:50 |
| 11 | Confident | Cross-server navigation: no transition | Deferred default — promptless dispatch: cross-server switches bypass `navigateToWindow` (app.tsx:1138) and full-reconnect; direction semantics across server groups are murky — exclusion falls out of the seam choice | S:50 R:90 A:80 D:70 |
| 12 | Confident | Ship the polished first-paint-gated variant (capture awaits the first-write signal, ~300ms timeout) | Deferred default — promptless dispatch: the timeout degradation IS the basic ungated behavior, so polished strictly subsumes basic; conversation spec'd the gate's mechanics in detail | S:45 R:85 A:45 D:60 |

12 assumptions (6 certain, 6 confident, 0 tentative, 0 unresolved).

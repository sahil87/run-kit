# Intake: Top-Bar Refresh Button

**Change**: 260703-p29w-topbar-refresh-button
**Created**: 2026-07-03

## Origin

Conversational — dispatched promptless via `/fab-proceed` from a live discussion in which the user made the key decisions.

> Add a refresh button to the top bar, next to the close (X) button, in the run-kit frontend. Refresh semantics: a full page reload via `window.location.reload()` — chosen explicitly "for now".

Decisions made in the conversation:

- **Refresh semantics**: full page reload via `window.location.reload()`. The user explicitly chose this "for now" over the softer alternatives.
- **Placement**: immediately next to the existing close (X) pane button in the top bar's right-side icon cluster.

Alternatives rejected in the conversation (record only — do NOT implement):

- **Reconnect-the-terminal** — remount `TerminalClient` via a React `key` bump to re-establish the WebSocket relay without a page load. Recommended during discussion but deferred by the user ("A full location.reload() for now").
- **tmux `respawn-pane`** — destructive; kills the running process in the pane. Dangerous next to live agent sessions.

## Why

1. **Pain point**: When a terminal view degrades (stale WebSocket relay, wedged xterm rendering, SSE drift), the only recovery today is the browser's own reload control — which is out of reach in chromeless contexts (PWA/standalone windows, kiosk-style layouts) and not discoverable as an in-app action. There is a per-iframe refresh precedent (`iframe-window.tsx`) but nothing for the app itself.
2. **Consequence of not fixing**: Users on degraded terminal views have no in-app recovery affordance; they must know to use browser chrome that may not be visible, or close/reopen the tab.
3. **Why this approach**: `window.location.reload()` is the simplest correct recovery — it re-establishes every connection (SSE, relay WebSockets) and re-derives all state, which is safe by design in run-kit: state is derived from tmux + filesystem at request time (constitution II) and tmux sessions are fully independent of the web client (constitution VI), so a page reload loses nothing. The finer-grained "reconnect just this terminal" option was considered and explicitly deferred by the user.

## What Changes

### 1. `RefreshButton` in the top bar (`app/frontend/src/components/top-bar.tsx`)

Add a new icon button component rendered inside the existing `currentWindow &&` terminal-only group in the right-side icon cluster (currently: split vertical → split horizontal → close, each wrapped in `<span className="hidden sm:flex">`, lines ~306–330). The refresh button renders **immediately after `ClosePaneButton`** (line ~324), wrapped in the same `<span className="hidden sm:flex">`, becoming the fourth item of that conditional group.

Behavior: `onClick={() => window.location.reload()}`. No confirmation dialog, no pending/spinner state — the page unloads synchronously so a spinner would never meaningfully render, and the action is non-destructive (constitution II/VI: all state re-derives on load; tmux is unaffected).

Follow the established cluster button pattern verbatim (see `ClosePaneButton`, `top-bar.tsx` lines ~586–631):

```tsx
<button
  type="button"
  onClick={() => window.location.reload()}
  aria-label="Refresh page"
  title="Refresh page"
  className="min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] rounded border border-border text-text-secondary hover:border-text-secondary transition-colors flex items-center justify-center"
>
  {/* 14px rotate-cw style refresh glyph, stroke="currentColor" strokeWidth="2",
      strokeLinecap/strokeLinejoin "round", aria-hidden — matches sibling SVGs */}
</button>
```

Notes:
- No `useOptimisticAction`/`isPending`/`LogoSpinner` wiring (unlike `ClosePaneButton`) — there is no async action to await.
- No `disabled` states needed.
- Icon: a rotate/refresh glyph (e.g., lucide `rotate-cw` path) drawn as a 14×14 stroke SVG consistent with the sibling split/close icons. The existing iframe refresh precedent (`iframe-window.tsx` ~line 70) uses a text glyph `&#x21bb;`, but the top-bar cluster convention is stroke SVGs — follow the cluster convention.

### 2. Command-palette action (`app/frontend/src/app.tsx`)

Constitution §V (Keyboard-First): every user-facing action MUST be reachable via keyboard, with the command palette (Cmd+K) as the primary discovery mechanism. Register a palette action in the existing `viewActions` family (~line 1009):

```ts
{
  id: "refresh-page",
  label: "View: Refresh Page",
  onSelect: () => window.location.reload(),
}
```

The palette action is **unconditional** (not gated on `sessionName`/route) — a page reload is meaningful on every route, unlike the button which lives in the terminal-only cluster group. It is appended to `viewActions`' static entries (alongside `toggle-fixed-width`), flowing into `paletteActions` (~line 1115) with no new wiring.

### 3. Tests

- **Unit** (`app/frontend/src/components/top-bar.test.tsx`): the refresh button renders when a current window exists (and not otherwise), carries `aria-label="Refresh page"`, and invokes a reload on click (stub `window.location.reload` — e.g., via `Object.defineProperty`/`vi.spyOn` on a replaced `location` object, since jsdom's `reload` is not directly spyable).
- **E2E** (Playwright, `app/frontend/tests/`): on a terminal window route, the refresh button is visible in the top bar next to the close button; clicking it reloads the page (observable by setting a `window` marker via `page.evaluate` before the click and asserting it is gone after navigation settles). Per the constitution's Test Companion Docs rule, any new/modified `*.spec.ts` MUST ship the matching `*.spec.md` update in the same commit. Tests run only through `just` recipes (`just test-e2e "<spec>"` / `just pw`), never Playwright directly.

### Non-changes (explicitly out of scope)

- No `TerminalClient` remount/reconnect path (rejected alternative — may return as a follow-up change).
- No tmux `respawn-pane` call, no backend/API change of any kind.
- No mobile-only affordance: below the `sm` breakpoint the button is hidden like its cluster siblings (mobile users retain pull-to-refresh/browser chrome; the palette action remains reachable).

## Affected Memory

- `run-kit/ui-patterns`: (modify) top-bar right-cluster composition gains a refresh button in the terminal-only group; command-palette View family gains "View: Refresh Page".

## Impact

- `app/frontend/src/components/top-bar.tsx` — new `RefreshButton` component + one render site in the `currentWindow` group.
- `app/frontend/src/app.tsx` — one new entry in `viewActions`.
- `app/frontend/src/components/top-bar.test.tsx` — unit coverage.
- `app/frontend/tests/` — Playwright e2e spec + sibling `.spec.md` (new or extended existing top-bar spec).
- No backend, API, routing, or state-model changes. No new dependencies.

## Open Questions

- None — all decision points were either resolved in the conversation (reload semantics, placement) or score Confident+ under SRAD with clear codebase defaults.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Refresh = full `window.location.reload()`, not a terminal reconnect | Discussed — user explicitly chose "A full location.reload() for now" over the `TerminalClient` remount alternative | S:95 R:90 A:95 D:95 |
| 2 | Certain | Button lives in the top bar's right-side icon cluster, adjacent to the close (X) button | Discussed — user specified "next to the close (X) button"; close button verified at `top-bar.tsx:324` | S:90 R:90 A:90 D:90 |
| 3 | Confident | Gated inside the existing `currentWindow &&` terminal-only group, rendered immediately after `ClosePaneButton` | "Next to the close button" implies the same conditional group; trivially relocatable if the user later wants it route-agnostic | S:70 R:90 A:75 D:65 |
| 4 | Certain | Wrapped in `<span className="hidden sm:flex">` (hidden below `sm`) like every sibling in the group | Uniform cluster pattern in code; mobile retains pull-to-refresh and the palette action | S:60 R:95 A:90 D:80 |
| 5 | Certain | Icon is a 14px stroke rotate/refresh SVG matching the cluster glyph style; `aria-label`/`title` "Refresh page" | Cluster convention is stroke SVGs (`strokeWidth 2`, `currentColor`); iframe precedent confirms "Refresh" labeling | S:55 R:95 A:90 D:85 |
| 6 | Certain | No confirmation dialog and no pending/spinner state | Page unloads synchronously (spinner never renders); reload is non-destructive per constitution II/VI — state re-derives, tmux unaffected | S:65 R:95 A:90 D:80 |
| 7 | Certain | A command-palette action is registered for the refresh action | Constitution §V mandates keyboard reachability with Cmd+K as primary discovery; code-review policy requires palette registration for new actions | S:80 R:90 A:95 D:90 |
| 8 | Confident | Palette action is route-agnostic (in `viewActions`, ungated), while the button stays terminal-gated | Reload is meaningful on every route; gating the palette entry would diverge from sibling static view actions for no benefit | S:50 R:95 A:80 D:70 |
| 9 | Confident | Test scope: unit test in `top-bar.test.tsx` + Playwright e2e with matching `.spec.md`, run via `just` recipes only | code-quality.md: new features MUST include tests, UI changes SHOULD include e2e; constitution mandates `.spec.md` companions and `just`-only test invocation | S:60 R:85 A:80 D:70 |

9 assumptions (6 certain, 3 confident, 0 tentative, 0 unresolved).

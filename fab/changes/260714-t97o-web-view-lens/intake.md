# Intake: Web View Lens — Iframe Viewing Retrofit

**Change**: 260714-t97o-web-view-lens
**Created**: 2026-07-14

## Origin

> Retrofit iframe viewing to the window-views lens model: per-viewer `?view=web`, tty always reachable, no `@rk_type` mutation on view switch.

Drafted during a `/fab-discuss` session (2026-07-14) that produced
[`docs/specs/window-views.md`](../../../docs/specs/window-views.md) (in the same PR as this
intake). The discussion identified that run-kit's three "parallel view" features — iframe
windows, desktop streaming (PR #71), the planned agent chat view — each invented a different
typing/view-state mechanism, and committed to a unifying model: **rows are substrates, views
are derived lenses**. This change is the first executable step: bring the shipped iframe
feature under that model. Interaction mode: conversational; the user endorsed the model and
asked for this intake to be executable by another agent. Read the spec before planning — it
is the authority for every rule cited below (R1–R7).

## Why

**Problem.** The iframe feature treats "which view am I in" as *window identity*: the `>_`
button in `IframeWindow` calls `updateWindowType(server, windowId, "")`, POSTing a mutation
of the `@rk_type` window option. Consequences:

1. **The flip is global** — every connected viewer's rendering changes, and the window's
   identity changes in tmux, when one person just wanted to peek at the logs.
2. **The tty is second-class** — getting back to the terminal *destroys* the web view state
   (`@rk_url` remains, but the window must be re-typed to see the iframe again), violating
   spec R3 (tty always reachable) and R7 (substrate state vs view state).
3. **Divergence compounds** — the chat view (planned, `?view=chat`) and desktop view
   (PR #71) will otherwise ship two *more* mechanisms. The spec's R4 requires one shared
   switcher; somebody must build it first, and this change is sequenced before chat
   change 3.

**If we don't fix it:** three parallel-view conventions harden in shipped code, the chat
plan's switcher gets built chat-shaped instead of general, and PR #71's successor has no
pattern to conform to.

**Why this approach:** per-viewer URL-carried view state is already the committed decision
in the chat plan's decision log and spec R2; retrofitting iframe first is the smallest
shipped-code change that forces the shared machinery (view resolution, switcher chip,
palette parity, heading behavior) into existence.

## What Changes

Frontend-only. No Go changes expected: the sessions payload already carries `rkType`/`rkUrl`
per window, and the window-option POST endpoints stay (the URL bar still uses
`updateWindowUrl`).

### 1. View state & resolution

- Add a validated `view` search param to `terminalRoute` in
  `app/frontend/src/router.tsx` (TanStack Router `validateSearch`). Accepted value today:
  `"web"`. Unknown values are dropped (treated as absent), not errored.
- New pure helper module `app/frontend/src/lib/window-view.ts`:
  - `availableViews(win): ViewName[]` — `["tty"]`, plus `"web"` when `win.rkUrl` is
    non-empty. Availability is decoupled from `rkType` (spec R1): an iframe-*typed* window
    with no URL offers only `tty` (this matches the current render gate, which already
    requires BOTH).
  - `defaultView(win): ViewName` — `"web"` when `win.rkType === "iframe"` and `rkUrl` is
    set, else `"tty"` (spec R5: `@rk_type=iframe` is demoted from identity to
    creation-time default-view hint; no data migration, existing windows keep working).
  - `resolveView(searchView, stored, win): ViewName` — precedence: URL param (if that view
    is available) → localStorage (if available) → `defaultView(win)`. Anything unavailable
    falls through to `tty`.
- **localStorage**: value-bearing key per window, e.g.
  `runkit-window-view:{server}:{windowId}` storing the view name; absent = default (spec
  R2 — value-bearing, NOT the key-present `board-autofit` convention; the spec explicitly
  supersedes the chat plan's localStorage detail). Written on every explicit view switch;
  follow the try/catch-noop localStorage pattern in
  `app/frontend/src/contexts/chrome-context.tsx`.
- Switching views updates the URL search param (`navigate` with `search`) so the state is
  copy-paste shareable and deep-linkable (push-notification-ready, same seam the chat plan
  banks on).
- Navigating to a *different* window drops the param; each window resolves its own
  last-view/default.

### 2. View switcher UI (the generalized machinery — chat change 3 reuses this)

- Segmented chip in the top-bar right cluster's **L1 tier** (terminal-route-only tier in
  `app/frontend/src/components/top-bar.tsx`, where splits + fixed-width live). Rendered
  only when `availableViews(win).length > 1`. Two-state form `[tty|web]`, active segment
  inverse-video, house hover vocabulary (CRT glint, `rk-*` classes), reduced-motion safe.
  Build it as a generic `ViewSwitcher` taking the available-view list — chat/desktop add
  segments, not components.
- **Palette parity** (Constitution V): `View: Terminal` / `View: Web` actions in
  `app/frontend/src/components/command-palette.tsx` registration (AppShell terminal-route
  actions), visible only when the corresponding view is available and not current. The
  existing `toggle-iframe-terminal` palette action is replaced by these (it currently
  mutates `@rk_type`).
- **Keyboard shortcut** to cycle views on the current window (pick a free binding at plan
  time from the existing shortcut registry; document it in the palette entry per
  code-review.md).
- **Center heading follows the lens** (spec R4): `Terminal: <window>` in tty view,
  `Web: <window>` in web view. Same static-prefix-span treatment (hidden below `sm`);
  window rename affordance (click-to-edit heading) works identically in both views.

### 3. IframeWindow decoupling

In `app/frontend/src/components/iframe-window.tsx`:

- The `>_` button becomes a *view switch* (sets `?view=tty` + localStorage) — it no longer
  calls `updateWindowType`. Remove that import/usage; keep the component's URL bar +
  refresh unchanged.
- The URL bar's Enter-commit keeps calling `updateWindowUrl` (global substrate state, spec
  R7 — everyone SHOULD see the new address; this is the window's content address, not a
  view preference).
- In `app/frontend/src/app.tsx`, the render branch stops keying on
  `rkType === "iframe" && rkUrl` and instead renders by `resolveView(...)`:
  `web` → `IframeWindow`, else `TerminalClient`.

### 4. Window-switch transition integration (load-bearing, easy to miss)

`app.tsx` keeps a `switchTransitionRef` whose `iframeIds` set classifies transition targets:
iframe-rendering targets use the **ungated** capture path (no first-write receipt seam),
terminal targets gate on `ws.onmessage` receipt (see the comment block around
`app.tsx:822`). This classification MUST now be computed from the *effective resolved view*
of each window (localStorage + default — the URL param is not yet known for a
navigation target), not from raw `rkType && rkUrl`. A window whose effective view is `tty`
has a receipt seam even if iframe-typed; a window resolving to `web` does not. Getting this
wrong reintroduces the blank-pane/hang class of bugs documented in memory — treat it as its
own task with its own test.

### 5. Explicitly unchanged (compat surface)

- `create-iframe-window` palette flow and `createWindow(..., "iframe", url)` — synthetic
  iframe windows still get created exactly as today (they now mean "default view = web").
- Cockpit SERVICES "Open in window" — still creates the synthetic window. The
  deep-link-to-owning-row upgrade is a follow-up per the spec's Migration Map, NOT this
  change.
- Backend endpoints, `@rk_type`/`@rk_url` option plumbing, board rendering (boards render
  panes, not lenses — board lens pins are out of scope per spec).
- Port→pane ownership derivation — separate follow-up change.

### 6. Tests & companions

- **Vitest**: `lib/window-view.test.ts` covering `availableViews`/`defaultView`/
  `resolveView` precedence + fallback matrix; switcher chip render gating; palette action
  visibility.
- **Playwright e2e** (via `just test-e2e`/`just pw` only — port 3020 isolation) + sibling
  `.spec.md` companion (constitution): chip appears only on web-capable windows; flipping
  to tty and back preserves the window and never POSTs an option mutation; deep link
  `?view=web` cold-loads into the iframe; `?view=web` on a window with no `rkUrl` falls
  back to terminal; legacy `@rk_type=iframe` window defaults to web with the chip present;
  last-view persistence across a window switch away and back. Verify 375px and desktop
  viewports.

## Affected Memory

- `run-kit/ui-patterns`: (modify) view switcher chip + `?view=` search param + heading-follows-lens + value-bearing localStorage convention + transition-classification change; iframe section rewritten from "window type" to "web lens"
- `run-kit/architecture`: (modify) note that `@rk_type` is a default-view hint, not identity; no API changes

## Impact

- `app/frontend/src/router.tsx` — search param validation on `terminalRoute`
- `app/frontend/src/lib/window-view.ts` (+ test) — new
- `app/frontend/src/app.tsx` — render branch, transition classification, palette actions
- `app/frontend/src/components/top-bar.tsx` (+ test) — ViewSwitcher chip, heading prefix
- `app/frontend/src/components/iframe-window.tsx` (+ test) — `>_` decoupling
- `app/frontend/src/components/command-palette.tsx` — action registration (via app.tsx)
- `app/frontend/tests/` — new e2e spec + `.spec.md`
- No Go changes; no new routes; no new dependencies.

Blast radius: the terminal route's render path and window-switch transition — regressions
here surface as blank panes or stuck transitions, which the e2e suite must catch.

## Open Questions

- Which keyboard binding cycles views? (Resolve at plan time against the live shortcut
  registry — low stakes, must not collide with existing terminal-route shortcuts.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | View choice is per-viewer via `?view=` search param; switching never mutates `@rk_type` | Spec R2/R7, committed in discussion and endorsed by user; chat plan decision log already chose the same seam | S:90 R:70 A:95 D:95 |
| 2 | Certain | tty view is always reachable on every window, including iframe-typed ones | Spec R3; core of the model | S:90 R:80 A:95 D:95 |
| 3 | Certain | Web availability = `rkUrl` non-empty; `@rk_type=iframe` demoted to default-view hint; no data migration | Spec R1/R5; matches current render gate's AND-condition so no existing window changes behavior | S:80 R:75 A:90 D:85 |
| 4 | Certain | Switcher chip in L1 top-bar tier with palette parity + keyboard shortcut; heading follows lens | Spec R4 + chat plan decision log (Constitution V makes parity mandatory) | S:85 R:80 A:85 D:80 |
| 5 | Confident | localStorage is value-bearing per window (stores view name; absent = default), superseding chat plan's key-present convention | Spec R2 explicitly supersedes; generalizes past two states for desktop/chat | S:75 R:85 A:80 D:70 |
| 6 | Confident | This change builds the generalized ViewSwitcher; chat change 3 reuses it | Spec R4 "whichever ships first builds it"; this change is sequenced first | S:70 R:75 A:75 D:70 |
| 7 | Confident | Scope excludes port→pane derivation, Cockpit deep-link upgrade, board lens pins, URL tiles | Spec Migration Map sequences them as follow-ups; keeps this change one-PR-sized | S:70 R:85 A:80 D:75 |
| 8 | Confident | Navigating to a different window drops `?view`; each window resolves its own last-view/default | Simplest semantics; per-window persistence covers the intent; easily revisited | S:55 R:85 A:75 D:65 |
| 9 | Confident | Frontend-only — no Go changes (payload already carries `rkType`/`rkUrl`; option endpoints unchanged) | Verified against `api/windows.go` + `internal/tmux/tmux.go` during discussion | S:65 R:80 A:85 D:80 |

9 assumptions (4 certain, 5 confident, 0 tentative, 0 unresolved).
